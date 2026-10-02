//! L'host della sessione: il listener sul PC, lo stato della sessione e
//! l'API che la shell usa attraverso l'adattatore di Tauri (FD-303).
//!
//! [`LiveHost::start`] apre il listener sull'indirizzo privato scelto, genera
//! il certificato e il primo QR, e restituisce la coda degli eventi. La shell
//! risponde ai commit con [`LiveHost::send`], legge lo stato con
//! [`LiveHost::status`] e chiude con [`LiveHost::stop`]. Un `LiveHost`
//! lasciato cadere chiude la sessione come l'app che si chiude.

mod api;
mod conn;
pub(crate) use conn::Io;
mod events;
mod outbox;
mod server;
mod session;

use std::io;
use std::net::SocketAddrV4;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use ring::rand::SystemRandom;
use tokio::net::TcpListener;
use tokio::sync::{watch, Notify};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::tungstenite::Utf8Bytes;

pub use api::{
    LiveStatus, Pairing, PendingCommit, SendError, SessionInfo, ShellMessage, Stats, StopReport,
    WriterStatus,
};
pub use events::{EndReason, LeaveReason, LiveEvent, LiveEvents, ReleaseReason};
pub use session::RenewError;

use events::EventQueue;
use server::{supervise, Listener};
use session::{OfferError, Session, Setup};

use crate::limits::{MAX_MESSAGE, MAX_SNAPSHOT};
use crate::net::ListenAddr;
use crate::pairing::{valid_host_name, QrTooLong};
use crate::protocol::{encode_snapshot, DocumentInfo, Snapshot};
use crate::tls::{server_identity, TlsError};
use crate::token::{RandomUnavailable, SessionId};

/// La configurazione di una sessione.
#[derive(Debug, Clone)]
pub struct LiveConfig {
    /// L'indirizzo privato su cui ascoltare, quello scritto nel QR.
    pub listen: ListenAddr,
    /// La porta: 0 per una porta libera, o quella fissata da `live.port`.
    pub port: u16,
    /// Il nome del PC, che lo scrittore mostra prima di collegarsi.
    pub host_name: Option<String>,
    /// Il documento della sessione.
    pub document: DocumentInfo,
    /// Lo snapshot iniziale: il documento com'è all'avvio.
    pub snapshot: Snapshot,
}

/// Perché la sessione non è partita.
#[derive(Debug, thiserror::Error)]
pub enum StartError {
    /// L'id o il titolo del documento sono oltre i limiti del protocollo.
    #[error("the document id or title exceeds the protocol limits")]
    InvalidDocument,
    /// Il nome del PC è vuoto, troppo lungo o ha caratteri di controllo.
    #[error("the PC name must have 1 to 64 characters and no control characters")]
    InvalidHostName,
    /// Il documento è troppo grande per una sessione: è in sola lettura (4008).
    #[error("the snapshot of {size} bytes exceeds the session limits: the document is read-only")]
    SnapshotTooLarge {
        /// I byte.
        size: usize,
    },
    /// Il listener non si è aperto: porta occupata, indirizzo assente.
    #[error("cannot listen on {addr}: {source}")]
    Bind {
        /// L'indirizzo.
        addr: SocketAddrV4,
        /// L'errore del sistema.
        source: io::Error,
    },
    /// Il certificato effimero.
    #[error(transparent)]
    Tls(#[from] TlsError),
    /// Il generatore casuale.
    #[error(transparent)]
    Random(#[from] RandomUnavailable),
    /// Il QR.
    #[error(transparent)]
    Qr(#[from] QrTooLong),
}

impl From<OfferError> for StartError {
    fn from(error: OfferError) -> StartError {
        match error {
            OfferError::Random(error) => StartError::Random(error),
            OfferError::Qr(error) => StartError::Qr(error),
        }
    }
}

/// Lo stato condiviso fra il supervisore, le connessioni e il `LiveHost`.
pub(crate) struct Shared {
    pub(crate) session: Mutex<Session>,
    pub(crate) events: Arc<EventQueue>,
    /// Sveglia il supervisore quando cambia una scadenza.
    pub(crate) wake: Notify,
    pub(crate) rng: SystemRandom,
    pub(crate) acceptor: TlsAcceptor,
    /// L'unica origine che una pagina può dichiarare: quella dell'host.
    pub(crate) origin: String,
    /// I compiti vivi della sessione, supervisore compreso.
    pub(crate) tasks: Arc<AtomicUsize>,
}

/// Conta un compito vivo finché esiste.
pub(crate) struct Alive(Arc<AtomicUsize>);

impl Alive {
    pub(crate) fn new(tasks: &Arc<AtomicUsize>) -> Alive {
        tasks.fetch_add(1, Ordering::AcqRel);
        Alive(tasks.clone())
    }
}

impl Drop for Alive {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Una sessione live in corso.
pub struct LiveHost {
    shared: Arc<Shared>,
    info: SessionInfo,
    stop: watch::Sender<Option<EndReason>>,
    supervisor: Option<JoinHandle<StopReport>>,
}

impl LiveHost {
    /// Apre la sessione: listener, certificato, primo QR. Va chiamata dentro
    /// il runtime di Tokio, su cui gira la sessione.
    pub async fn start(config: LiveConfig) -> Result<(LiveHost, LiveEvents), StartError> {
        let snapshot = check(&config)?;
        let addr = SocketAddrV4::new(config.listen.ip(), config.port);
        let listener = TcpListener::bind(addr)
            .await
            .map_err(|source| StartError::Bind { addr, source })?;
        let bound = match listener.local_addr() {
            Ok(std::net::SocketAddr::V4(bound)) => bound,
            Ok(other) => {
                return Err(StartError::Bind {
                    addr,
                    source: io::Error::other(format!("bound to {other}")),
                })
            }
            Err(source) => return Err(StartError::Bind { addr, source }),
        };
        LiveHost::launch(config, snapshot, bound, Listener::Tcp(listener))
    }

    fn launch(
        config: LiveConfig,
        snapshot: Utf8Bytes,
        addr: SocketAddrV4,
        listener: Listener,
    ) -> Result<(LiveHost, LiveEvents), StartError> {
        let rng = SystemRandom::new();
        let id = SessionId::generate(&rng)?;
        let identity = server_identity(*addr.ip())?;
        let events = EventQueue::new();
        let setup = Setup {
            id,
            addr,
            fingerprint: identity.fingerprint,
            host_name: config.host_name.clone(),
            document: config.document,
            seq: config.snapshot.seq,
            snapshot,
        };
        let session = Session::new(setup, events.clone(), &rng, Instant::now())?;
        let shared = Arc::new(Shared {
            session: Mutex::new(session),
            events: events.clone(),
            wake: Notify::new(),
            rng,
            acceptor: TlsAcceptor::from(identity.config),
            origin: format!("https://{addr}"),
            tasks: Arc::new(AtomicUsize::new(0)),
        });
        let (stop, stopped) = watch::channel(None);
        let supervisor = tokio::spawn(supervise(shared.clone(), listener, stopped));
        let info = SessionInfo {
            session: id,
            addr,
            fingerprint: identity.fingerprint,
            host_name: config.host_name,
        };
        let host = LiveHost {
            shared,
            info,
            stop,
            supervisor: Some(supervisor),
        };
        Ok((host, LiveEvents::new(events)))
    }

    /// La sessione in memoria, per le prove con il tempo in pausa.
    #[cfg(test)]
    pub(crate) fn start_in_memory(
        config: LiveConfig,
    ) -> Result<(LiveHost, LiveEvents, crate::tests::net::MemoryNet), StartError> {
        let snapshot = check(&config)?;
        let (net, incoming) = crate::tests::net::MemoryNet::new();
        let port = if config.port == 0 { 4000 } else { config.port };
        let addr = SocketAddrV4::new(config.listen.ip(), port);
        let (host, events) = LiveHost::launch(config, snapshot, addr, Listener::Memory(incoming))?;
        Ok((host, events, net))
    }

    /// Dove ascolta la sessione e con che certificato.
    pub fn info(&self) -> &SessionInfo {
        &self.info
    }

    /// Il QR in corso, finché il segreto vale: non dopo il primo ingresso, né
    /// dopo 5 minuti.
    pub fn pairing(&self) -> Option<Pairing> {
        self.shared.session.lock().pairing(Instant::now())
    }

    /// Un QR nuovo, con un segreto nuovo valido 5 minuti. Non si può mentre uno
    /// scrittore è collegato; uno scrittore fuori dalla connessione perde la
    /// ripresa.
    pub fn renew_pairing(&self) -> Result<Pairing, RenewError> {
        let pairing = self
            .shared
            .session
            .lock()
            .renew_pairing(&self.shared.rng, Instant::now());
        self.shared.wake.notify_one();
        pairing
    }

    /// Manda allo scrittore un messaggio della shell.
    pub fn send(&self, message: ShellMessage) -> Result<(), SendError> {
        let sent = self.shared.session.lock().send(message);
        if let Err(SendError::SnapshotTooLarge { .. }) = sent {
            self.stop
                .send_if_modified(|stop| request(stop, EndReason::ReadOnly));
        }
        sent
    }

    /// Lo stato della sessione, commit in attesa compresi.
    pub fn status(&self) -> LiveStatus {
        self.shared.session.lock().status(Instant::now())
    }

    /// Chiude la sessione e aspetta che listener e connessioni siano chiusi.
    /// Restituisce i commit a cui la shell non ha risposto.
    pub async fn stop(mut self, reason: EndReason) -> StopReport {
        self.stop.send_if_modified(|stop| request(stop, reason));
        let joined = match self.supervisor.take() {
            Some(supervisor) => supervisor.await.ok(),
            None => None,
        };
        joined.unwrap_or_else(|| {
            // Il supervisore è caduto: la shell riceve comunque la fine.
            let pending = self.shared.session.lock().pending();
            self.shared
                .events
                .close_with(Some(LiveEvent::Ended { reason }));
            StopReport { pending }
        })
    }

    /// I compiti ancora vivi della sessione.
    #[cfg(test)]
    pub(crate) fn live_tasks(&self) -> Arc<AtomicUsize> {
        self.shared.tasks.clone()
    }
}

/// Vale la prima richiesta di chiusura: una sessione già chiusa in sola
/// lettura resta chiusa per quel motivo.
fn request(stop: &mut Option<EndReason>, reason: EndReason) -> bool {
    if stop.is_none() {
        *stop = Some(reason);
        true
    } else {
        false
    }
}

impl Drop for LiveHost {
    fn drop(&mut self) {
        // Il supervisore chiude da solo; se il runtime si ferma prima, i
        // compiti cadono con lui e i socket con loro.
        self.stop
            .send_if_modified(|stop| request(stop, EndReason::HostClosing));
    }
}

/// Controlla la configurazione e restituisce il messaggio dello snapshot
/// iniziale.
fn check(config: &LiveConfig) -> Result<Utf8Bytes, StartError> {
    if !config.document.is_valid() {
        return Err(StartError::InvalidDocument);
    }
    if config
        .host_name
        .as_deref()
        .is_some_and(|name| !valid_host_name(name))
    {
        return Err(StartError::InvalidHostName);
    }
    let size = config.snapshot.text.len();
    if size > MAX_SNAPSHOT {
        return Err(StartError::SnapshotTooLarge { size });
    }
    // Lo snapshot deve stare anche in un messaggio, con gli escape del JSON.
    let message = encode_snapshot(config.snapshot.seq, &config.snapshot.text);
    if message.len() > MAX_MESSAGE {
        return Err(StartError::SnapshotTooLarge {
            size: message.len(),
        });
    }
    Ok(message.into())
}
