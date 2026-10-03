//! Il client dello scrittore in Rust, quello dei percorsi B e C.
//!
//! Si collega con il contenuto del QR e, prima di mandare qualunque byte
//! dell'applicazione, verifica che il certificato dell'host abbia l'impronta
//! del QR («Certificato e TLS» in `docs/reference/live-session.md`). Tiene i
//! commit finché l'host non risponde; dopo una caduta riprende con il gettone
//! entro 2 minuti, scarta i commit fino a `lastC` e rimanda gli altri in
//! ordine («Ripresa»). Con `ping` e `pong` stima lo scarto fra il proprio
//! orologio e quello del PC («Orologi»).
//!
//! L'inchiostro è effimero: i campioni dello stesso tratto in coda si
//! riuniscono in un messaggio, e mentre la connessione è caduta l'inchiostro
//! si butta. Le viste partono a distanza di almeno [`VIEW_INTERVAL`]: in coda
//! ne resta una sola, l'ultima, che parte appena l'intervallo è passato, così
//! la posizione finale arriva sempre; dopo una ripresa il client la rimanda.
//!
//! Il client non manda più di [`CLIENT_RATE`] messaggi al secondo, metà del
//! limite dell'host, così una raffica che la rete consegna tutta insieme dopo
//! un intoppo non lo supera; e non tiene in volo più commit di quanti l'host
//! ne faccia aspettare.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;
use std::io;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Notify};
use tokio::task::JoinHandle;
use tokio::time::{interval, sleep_until, timeout, timeout_at, Instant, MissedTickBehavior};
use tokio_rustls::TlsConnector;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode as WireCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::{Error as WsError, Message, Utf8Bytes};
use tokio_tungstenite::{client_async_with_config, WebSocketStream};
use zeroize::Zeroizing;

use crate::clock::{wall_clock_ms, ClientClock, ClockEstimate};
use crate::counter::Counter;
use crate::host::Io;
use crate::limits::{
    Limits, CLOSE_GRACE, HEARTBEAT, HELLO_TIMEOUT, MAX_COMMIT, MAX_OPS_PER_COMMIT,
    MAX_PENDING_BYTES, MAX_PENDING_COMMITS, RESUME_WINDOW, VIEW_INTERVAL, WRITE_TIMEOUT,
};
use crate::pairing::{allowed_host, PairingTarget};
use crate::protocol::{
    truncate, Ack, Caps, CloseCode, Commit, Credential, Device, DocumentInfo, Hello, HostMessage,
    InkBegin, InkPoints, Nack, Ops, OpsMessage, Ping, Retry, Snapshot, StrokeId, View, Violation,
    WriterMessage,
};
use crate::rate::RateWindow;
use crate::tls::{client_config, server_name, websocket_config, FINGERPRINT_MISMATCH};
use crate::token::ResumeToken;

/// I messaggi al secondo che il client manda: metà dei 240 dell'host.
pub const CLIENT_RATE: usize = 120;
/// Il silenzio dell'host oltre il quale la connessione è caduta: due
/// heartbeat e mezzo.
const IDLE: Duration = Duration::from_secs(25);
/// Gli eventi che aspettano l'applicazione prima che il client smetta di
/// leggere dalla rete.
const EVENT_BUFFER: usize = 256;
/// L'attesa fra i tentativi di ripresa: raddoppia da 250 ms a 5 s.
const BACKOFF_MIN: Duration = Duration::from_millis(250);
const BACKOFF_MAX: Duration = Duration::from_secs(5);
/// I campioni di un `ink.pts`: 256 campioni di quattro numeri stanno sotto i
/// 64 KiB anche con la grafia più lunga di un `f64`.
const POINTS_PER_MESSAGE: usize = 256;
/// I messaggi effimeri in coda: oltre, l'inchiostro nuovo si butta.
const OUTGOING_LIMIT: usize = 1024;
/// I commit in volo, senza risposta: metà di quelli che l'host fa aspettare,
/// così una ripresa che li rimanda tutti non supera il suo tetto.
const IN_FLIGHT_COMMITS: usize = MAX_PENDING_COMMITS / 2;
const IN_FLIGHT_BYTES: usize = MAX_PENDING_BYTES / 2;
/// I `nack` già segnalati, per non ripeterli quando l'host li rimanda dopo una
/// ripresa.
const NACK_MEMORY: usize = 256;

/// La configurazione del client.
#[derive(Clone)]
pub struct ClientConfig {
    /// Il dispositivo, come lo mostra il PC.
    pub device: Device,
    /// Le capacità della penna.
    pub caps: Caps,
    /// L'intervallo dei `ping`: 1 secondo per la spec.
    pub ping_interval: Duration,
    /// L'orologio dello scrittore in millisecondi: lo stesso dei `t` di
    /// `ink.pts`, perché lo scarto stimato vale per quelli.
    pub clock: Arc<dyn Fn() -> f64 + Send + Sync>,
}

impl ClientConfig {
    /// La configurazione con il `ping` ogni secondo e l'orologio di sistema.
    pub fn new(device: Device, caps: Caps) -> ClientConfig {
        ClientConfig {
            device,
            caps,
            ping_interval: Duration::from_secs(1),
            clock: Arc::new(wall_clock_ms),
        }
    }
}

impl fmt::Debug for ClientConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ClientConfig")
            .field("device", &self.device)
            .field("caps", &self.caps)
            .field("ping_interval", &self.ping_interval)
            .finish_non_exhaustive()
    }
}

/// Perché il primo ingresso non è riuscito.
#[derive(Debug, thiserror::Error)]
pub enum ConnectError {
    /// Il QR indica un indirizzo che non è privato.
    #[error("{0} is not a private IPv4 address")]
    NotPrivate(Ipv4Addr),
    /// Il dispositivo è oltre i limiti del protocollo.
    #[error("the device name or kind exceeds the protocol limits")]
    InvalidDevice,
    /// L'host non si raggiunge.
    #[error("cannot reach the host: {0}")]
    Unreachable(io::Error),
    /// Il certificato dell'host non ha l'impronta del QR: dall'altra parte c'è
    /// un altro.
    #[error("the host certificate does not match the fingerprint of the QR code")]
    FingerprintMismatch,
    /// Il handshake TLS è fallito.
    #[error("TLS handshake failed: {0}")]
    Tls(io::Error),
    /// L'upgrade WebSocket è fallito.
    #[error("WebSocket handshake failed: {0}")]
    Handshake(String),
    /// L'host ha chiuso invece di rispondere `welcome`.
    #[error("the host closed the connection with {code}: {detail}")]
    Refused {
        /// Il codice di chiusura.
        code: u16,
        /// Il dettaglio dell'host.
        detail: String,
    },
    /// L'host ha mandato qualcosa fuori dal protocollo.
    #[error("the host broke the protocol: {0}")]
    Protocol(Violation),
    /// Nessun `welcome` entro 5 secondi.
    #[error("the host did not answer within 5 seconds")]
    Timeout,
}

/// Un messaggio d'inchiostro.
#[derive(Debug, Clone, PartialEq)]
pub enum Ink {
    /// L'inizio di un tratto.
    Begin(InkBegin),
    /// Campioni di un tratto.
    Points(InkPoints),
    /// La fine di un tratto.
    End(StrokeId),
    /// Un tratto annullato.
    Cancel(StrokeId),
}

/// Un messaggio che il protocollo non ammette, rifiutato prima di partire.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid message: {0}")]
pub struct InvalidMessage(&'static str);

/// Perché un commit non è partito.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CommitError {
    /// Più di 10 000 operazioni.
    #[error("{count} operations exceed the limit of {MAX_OPS_PER_COMMIT}")]
    TooManyOperations {
        /// Le operazioni.
        count: usize,
    },
    /// Oltre gli 8 MiB.
    #[error("a commit of {size} bytes exceeds {MAX_COMMIT}")]
    TooLarge {
        /// I byte delle operazioni.
        size: usize,
    },
    /// La sessione è finita.
    #[error("the live session has ended")]
    Ended,
}

/// Perché la sessione è finita per il client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndCause {
    /// L'host ha chiuso con un codice che non si riprova.
    Closed {
        /// Il codice.
        code: u16,
        /// Il dettaglio dell'host.
        detail: String,
    },
    /// Sono passati 2 minuti dalla caduta senza una ripresa riuscita.
    ResumeExpired,
    /// Alla ripresa il certificato non era più quello del QR.
    FingerprintMismatch,
    /// L'host ha violato il protocollo e il client ha chiuso.
    Protocol(Violation),
    /// L'applicazione ha chiuso.
    Local,
}

/// Un evento del client per l'applicazione.
#[derive(Debug, Clone)]
pub enum ClientEvent {
    /// L'ingresso o una ripresa: i commit fino a `last_c` sono trattati, gli
    /// altri ripartono. Segue lo snapshot.
    Connected {
        /// È una ripresa.
        resumed: bool,
        /// Il documento.
        doc: DocumentInfo,
        /// I limiti della sessione.
        limits: Limits,
        /// Il contatore del documento.
        seq: Counter,
        /// L'ultimo commit trattato dall'host.
        last_c: Counter,
    },
    /// Il documento intero. I commit in attesa ([`LiveClient::pending`]) vanno
    /// riapplicati sopra.
    Snapshot(Snapshot),
    /// Operazioni nate sul PC.
    Ops(OpsMessage),
    /// Un commit applicato.
    Ack(Ack),
    /// Un commit rifiutato.
    Nack(Nack),
    /// Una nuova stima dello scarto fra gli orologi.
    Clock(ClockEstimate),
    /// La connessione è caduta; il client prova a riprendere.
    Disconnected {
        /// Che cosa fa il client.
        retry: Retry,
    },
    /// La sessione è finita: i commit senza risposta restano
    /// all'applicazione, che può salvarli come disegno separato («Il client
    /// in Rust» in `docs/reference/live-session.md`).
    Ended {
        /// Perché.
        cause: EndCause,
        /// I commit senza risposta, in ordine.
        unconfirmed: Vec<Commit>,
    },
}

/// Gli eventi del client.
pub struct ClientEvents {
    receiver: mpsc::Receiver<ClientEvent>,
}

impl ClientEvents {
    /// Il prossimo evento; `None` dopo [`ClientEvent::Ended`].
    pub async fn recv(&mut self) -> Option<ClientEvent> {
        self.receiver.recv().await
    }
}

/// Un messaggio in uscita.
enum Outgoing {
    Ink(WriterMessage),
    View(View),
    Commit(Counter),
    Ping(u64),
}

#[derive(Default)]
struct State {
    next_c: u64,
    pending: BTreeMap<Counter, Ops>,
    outgoing: VecDeque<Outgoing>,
    /// L'ultima vista dell'applicazione: torna in coda dopo ogni ripresa.
    view: Option<View>,
    /// Quando è partita l'ultima vista: la prossima aspetta [`VIEW_INTERVAL`].
    view_sent_at: Option<Instant>,
    connected: bool,
    closing: bool,
    ended: bool,
    clock: Option<ClockEstimate>,
}

impl State {
    /// Il prossimo messaggio da mandare in `now`. Un commit parte solo se i
    /// commit più vecchi ancora senza risposta stanno nella finestra, e una
    /// vista solo a [`VIEW_INTERVAL`] dalla precedente; intanto passano i
    /// messaggi dietro di loro.
    fn next(&mut self, clock: &dyn Fn() -> f64, now: Instant) -> Option<String> {
        let mut index = 0;
        while index < self.outgoing.len() {
            if matches!(self.outgoing[index], Outgoing::View(_)) && self.view_due(now).is_some() {
                index += 1;
                continue;
            }
            if let Outgoing::Commit(c) = self.outgoing[index] {
                let Some(ops) = self.pending.get(&c) else {
                    // Già trattato: una risposta è arrivata prima dell'invio.
                    self.outgoing.remove(index);
                    continue;
                };
                let (count, bytes) = self
                    .pending
                    .range(..c)
                    .fold((0, 0), |(count, bytes), (_, older)| {
                        (count + 1, bytes + older.byte_len())
                    });
                let fits = count == 0
                    || (count < IN_FLIGHT_COMMITS && bytes + ops.byte_len() <= IN_FLIGHT_BYTES);
                if !fits {
                    index += 1;
                    continue;
                }
            }
            let entry = self.outgoing.remove(index)?;
            let message = match entry {
                Outgoing::Ink(message) => message,
                Outgoing::View(view) => {
                    self.view_sent_at = Some(now);
                    WriterMessage::View(view)
                }
                Outgoing::Ping(id) => WriterMessage::Ping(Ping { id, a: clock() }),
                Outgoing::Commit(c) => {
                    let ops = self.pending.get(&c)?.clone();
                    WriterMessage::Commit(Commit { c, ops })
                }
            };
            return Some(message.to_json());
        }
        None
    }

    fn has_queued(&self) -> bool {
        !self.outgoing.is_empty()
    }

    /// Quando può partire la prossima vista, se in `now` deve ancora aspettare.
    fn view_due(&self, now: Instant) -> Option<Instant> {
        self.view_sent_at
            .map(|at| at + VIEW_INTERVAL)
            .filter(|due| now < *due)
    }

    /// Quando può partire la vista in coda, se ce n'è una che aspetta.
    fn queued_view_due(&self, now: Instant) -> Option<Instant> {
        self.outgoing
            .iter()
            .any(|entry| matches!(entry, Outgoing::View(_)))
            .then(|| self.view_due(now))
            .flatten()
    }

    fn push_ephemeral(&mut self, entry: Outgoing) {
        if !self.connected || self.closing {
            return;
        }
        // In coda c'è al più una vista: prende il posto della precedente, e
        // non la ferma la coda piena, perché la posizione finale deve
        // arrivare.
        if let Outgoing::View(view) = entry {
            match self
                .outgoing
                .iter_mut()
                .find(|entry| matches!(entry, Outgoing::View(_)))
            {
                Some(slot) => *slot = Outgoing::View(view),
                None => self.outgoing.push_back(Outgoing::View(view)),
            }
            return;
        }
        if self.outgoing.len() >= OUTGOING_LIMIT {
            return;
        }
        match entry {
            Outgoing::Ink(WriterMessage::InkPoints(points)) => {
                if let Some(Outgoing::Ink(WriterMessage::InkPoints(last))) =
                    self.outgoing.back_mut()
                {
                    if last.s == points.s && last.pts.len() + points.pts.len() <= POINTS_PER_MESSAGE
                    {
                        last.pts.extend_from_slice(&points.pts);
                        return;
                    }
                }
                self.outgoing
                    .push_back(Outgoing::Ink(WriterMessage::InkPoints(points)));
            }
            other => self.outgoing.push_back(other),
        }
    }

    fn unconfirmed(&self) -> Vec<Commit> {
        self.pending
            .iter()
            .map(|(c, ops)| Commit {
                c: *c,
                ops: ops.clone(),
            })
            .collect()
    }
}

struct ClientShared {
    state: Mutex<State>,
    notify: Notify,
}

impl ClientShared {
    fn closing(&self) -> bool {
        self.state.lock().closing
    }

    /// Aspetta la chiusura locale.
    async fn closed(&self) {
        loop {
            let notified = self.notify.notified();
            if self.closing() {
                return;
            }
            notified.await;
        }
    }

    /// Aspetta la scadenza o la chiusura locale: `true` se l'applicazione ha
    /// chiuso.
    async fn wait_or_close(&self, deadline: Instant) -> bool {
        loop {
            let notified = self.notify.notified();
            if self.closing() {
                return true;
            }
            tokio::select! {
                () = sleep_until(deadline) => return self.closing(),
                () = notified => {}
            }
        }
    }
}

/// Il client dello scrittore.
pub struct LiveClient {
    shared: Arc<ClientShared>,
    task: Option<JoinHandle<()>>,
}

#[derive(Clone)]
enum Dialer {
    Tcp,
    #[cfg(test)]
    Memory(crate::tests::net::MemoryNet),
}

impl Dialer {
    async fn dial(&self, addr: SocketAddrV4) -> io::Result<Box<dyn Io>> {
        match self {
            Dialer::Tcp => {
                let stream = TcpStream::connect(addr).await?;
                stream.set_nodelay(true)?;
                Ok(Box::new(stream))
            }
            #[cfg(test)]
            Dialer::Memory(net) => Ok(Box::new(net.dial()?)),
        }
    }
}

type ClientWs = WebSocketStream<tokio_rustls::client::TlsStream<Box<dyn Io>>>;

impl LiveClient {
    /// Si collega all'host del QR con il segreto e aspetta il `welcome`.
    pub async fn connect(
        target: PairingTarget,
        config: ClientConfig,
    ) -> Result<(LiveClient, ClientEvents), ConnectError> {
        LiveClient::connect_with(Dialer::Tcp, target, config).await
    }

    /// Lo stesso, sulla rete in memoria delle prove.
    #[cfg(test)]
    pub(crate) async fn connect_in_memory(
        net: &crate::tests::net::MemoryNet,
        target: PairingTarget,
        config: ClientConfig,
    ) -> Result<(LiveClient, ClientEvents), ConnectError> {
        LiveClient::connect_with(Dialer::Memory(net.clone()), target, config).await
    }

    async fn connect_with(
        dialer: Dialer,
        target: PairingTarget,
        config: ClientConfig,
    ) -> Result<(LiveClient, ClientEvents), ConnectError> {
        let ip = *target.addr.ip();
        if !allowed_host(ip) {
            return Err(ConnectError::NotPrivate(ip));
        }
        if !config.device.is_valid() {
            return Err(ConnectError::InvalidDevice);
        }
        let hello = Hello {
            session: target.session.encode(),
            credential: Credential::Secret(Zeroizing::new(target.secret.encode())),
            device: config.device.clone(),
            caps: config.caps,
        };
        let (ws, welcome) = enter(&dialer, &target, hello).await?;
        let shared = Arc::new(ClientShared {
            state: Mutex::new(State {
                next_c: 1,
                ..State::default()
            }),
            notify: Notify::new(),
        });
        let (sender, receiver) = mpsc::channel(EVENT_BUFFER);
        let mut driver = Driver {
            shared: shared.clone(),
            events: sender,
            dialer,
            target,
            config,
            token: welcome.resume.clone(),
            last_c: Counter(0),
            rate: RateWindow::new(CLIENT_RATE, Duration::from_secs(1)),
            clock: ClientClock::default(),
            next_ping: 0,
            nacked: BTreeSet::new(),
        };
        driver.welcomed(welcome, false).await;
        let task = tokio::spawn(driver.run(ws));
        Ok((
            LiveClient {
                shared,
                task: Some(task),
            },
            ClientEvents { receiver },
        ))
    }

    /// Manda inchiostro. Mentre la connessione è caduta si butta: è effimero.
    pub fn ink(&self, ink: Ink) -> Result<(), InvalidMessage> {
        let messages = match ink {
            Ink::Begin(begin) => {
                begin.check().map_err(InvalidMessage)?;
                vec![WriterMessage::InkBegin(begin)]
            }
            Ink::Points(points) => {
                points.check().map_err(InvalidMessage)?;
                points
                    .pts
                    .chunks(POINTS_PER_MESSAGE)
                    .map(|chunk| {
                        WriterMessage::InkPoints(InkPoints {
                            s: points.s,
                            pts: chunk.to_vec(),
                        })
                    })
                    .collect()
            }
            Ink::End(s) => vec![WriterMessage::InkEnd(s)],
            Ink::Cancel(s) => vec![WriterMessage::InkCancel(s)],
        };
        let mut state = self.shared.state.lock();
        for message in messages {
            state.push_ephemeral(Outgoing::Ink(message));
        }
        drop(state);
        self.shared.notify.notify_one();
        Ok(())
    }

    /// Manda la vista. Due viste partono ad almeno [`VIEW_INTERVAL`] l'una
    /// dall'altra: in coda vale solo l'ultima, che parte appena l'intervallo è
    /// passato. Dopo una ripresa l'ultima vista riparte da sé.
    pub fn view(&self, view: View) -> Result<(), InvalidMessage> {
        view.check().map_err(InvalidMessage)?;
        let mut state = self.shared.state.lock();
        state.view = Some(view);
        state.push_ephemeral(Outgoing::View(view));
        drop(state);
        self.shared.notify.notify_one();
        Ok(())
    }

    /// Un gesto concluso. Il commit resta al client finché l'host non
    /// risponde, e riparte dopo ogni ripresa.
    pub fn commit(&self, ops: Ops) -> Result<Counter, CommitError> {
        if ops.count() > MAX_OPS_PER_COMMIT {
            return Err(CommitError::TooManyOperations { count: ops.count() });
        }
        // L'involucro di un commit costa meno di 64 byte.
        if ops.byte_len() + 64 > MAX_COMMIT {
            return Err(CommitError::TooLarge {
                size: ops.byte_len(),
            });
        }
        let mut state = self.shared.state.lock();
        if state.ended || state.closing {
            return Err(CommitError::Ended);
        }
        let c = Counter(state.next_c);
        state.next_c += 1;
        state.pending.insert(c, ops);
        if state.connected {
            state.outgoing.push_back(Outgoing::Commit(c));
        }
        drop(state);
        self.shared.notify.notify_one();
        Ok(c)
    }

    /// I commit senza risposta, in ordine: vanno riapplicati sopra ogni
    /// snapshot.
    pub fn pending(&self) -> Vec<Commit> {
        self.shared.state.lock().unconfirmed()
    }

    /// La stima più recente dello scarto fra gli orologi.
    pub fn clock(&self) -> Option<ClockEstimate> {
        self.shared.state.lock().clock
    }

    /// Saluta con `bye`, chiude e restituisce i commit senza risposta.
    pub async fn close(mut self) -> Vec<Commit> {
        self.shared.state.lock().closing = true;
        self.shared.notify.notify_one();
        if let Some(mut task) = self.task.take() {
            let deadline = Instant::now() + CLOSE_GRACE + CLOSE_GRACE;
            if timeout_at(deadline, &mut task).await.is_err() {
                task.abort();
            }
        }
        self.shared.state.lock().unconfirmed()
    }
}

impl Drop for LiveClient {
    fn drop(&mut self) {
        // Il compito saluta e finisce da solo, entro la chiusura ordinata.
        self.shared.state.lock().closing = true;
        self.shared.notify.notify_one();
    }
}

/// Apre la connessione e si presenta, entro 5 secondi.
async fn enter(
    dialer: &Dialer,
    target: &PairingTarget,
    hello: Hello,
) -> Result<(ClientWs, crate::protocol::Welcome), ConnectError> {
    timeout(HELLO_TIMEOUT, async {
        let mut ws = open(dialer, target).await?;
        let welcome = join(&mut ws, hello).await?;
        Ok((ws, welcome))
    })
    .await
    .map_err(|_| ConnectError::Timeout)?
}

/// TCP, TLS con l'impronta del QR, upgrade WebSocket.
async fn open(dialer: &Dialer, target: &PairingTarget) -> Result<ClientWs, ConnectError> {
    let io = dialer
        .dial(target.addr)
        .await
        .map_err(ConnectError::Unreachable)?;
    let config = client_config(target.fingerprint)
        .map_err(|error| ConnectError::Handshake(error.to_string()))?;
    let tls = TlsConnector::from(config)
        .connect(server_name(*target.addr.ip()), io)
        .await
        .map_err(|error| {
            let mismatch = error
                .get_ref()
                .and_then(|inner| inner.downcast_ref::<rustls::Error>())
                .is_some_and(|inner| *inner == FINGERPRINT_MISMATCH);
            if mismatch {
                ConnectError::FingerprintMismatch
            } else {
                ConnectError::Tls(error)
            }
        })?;
    let request = format!("wss://{}/live", target.addr)
        .into_client_request()
        .map_err(|error| ConnectError::Handshake(error.to_string()))?;
    let (ws, _) = client_async_with_config(request, tls, Some(websocket_config()))
        .await
        .map_err(|error| ConnectError::Handshake(error.to_string()))?;
    Ok(ws)
}

/// Manda il `hello` e aspetta il `welcome`.
async fn join(ws: &mut ClientWs, hello: Hello) -> Result<crate::protocol::Welcome, ConnectError> {
    let text = Zeroizing::new(WriterMessage::Hello(hello).to_json());
    ws.send(Message::Text(Utf8Bytes::from(text.as_str())))
        .await
        .map_err(|error| ConnectError::Handshake(error.to_string()))?;
    let mut farewell = None;
    loop {
        let message = match ws.next().await {
            None => {
                return Err(ConnectError::Unreachable(io::Error::from(
                    io::ErrorKind::UnexpectedEof,
                )))
            }
            Some(Err(error)) => {
                return Err(match host_violation(&error) {
                    Some(violation) => ConnectError::Protocol(violation),
                    None => ConnectError::Handshake(error.to_string()),
                })
            }
            Some(Ok(message)) => message,
        };
        match message {
            Message::Text(text) => {
                match HostMessage::parse(&text).map_err(ConnectError::Protocol)? {
                    HostMessage::Welcome(welcome) => return Ok(welcome),
                    HostMessage::Error(error) => farewell = Some(error.detail),
                    HostMessage::Bye(bye) => farewell = Some(bye.reason),
                    _ => {
                        return Err(ConnectError::Protocol(Violation::new(
                            CloseCode::InvalidPayload,
                            "a message before the welcome",
                        )))
                    }
                }
            }
            Message::Close(frame) => {
                let (code, reason) = close_parts(frame);
                return Err(ConnectError::Refused {
                    code,
                    detail: farewell.unwrap_or(reason),
                });
            }
            Message::Binary(_) => {
                return Err(ConnectError::Protocol(Violation::new(
                    CloseCode::UnsupportedData,
                    "binary frames are not part of the protocol",
                )))
            }
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}

fn close_parts(frame: Option<CloseFrame>) -> (u16, String) {
    // Senza codice la chiusura vale 1005, «nessun codice» di RFC 6455.
    frame.map_or((1005, String::new()), |frame| {
        (u16::from(frame.code), frame.reason.to_string())
    })
}

fn host_violation(error: &WsError) -> Option<Violation> {
    match error {
        WsError::Capacity(_) => Some(Violation::new(
            CloseCode::MessageTooBig,
            "the message exceeds 24 MiB",
        )),
        WsError::Utf8(_) => Some(Violation::new(
            CloseCode::InvalidPayload,
            "a text frame is not UTF-8",
        )),
        WsError::Protocol(error) => Some(Violation::new(
            CloseCode::ProtocolError,
            format!("WebSocket protocol error: {error}"),
        )),
        _ => None,
    }
}

/// Come è finita una connessione.
enum Disconnect {
    /// L'host ha chiuso con questo codice.
    Closed { code: u16, detail: String },
    /// Il trasporto è caduto o l'host tace.
    Lost,
    /// L'host ha violato il protocollo.
    Violation(Violation),
    /// L'applicazione ha chiuso.
    Local,
}

struct Driver {
    shared: Arc<ClientShared>,
    events: mpsc::Sender<ClientEvent>,
    dialer: Dialer,
    target: PairingTarget,
    config: ClientConfig,
    token: ResumeToken,
    last_c: Counter,
    rate: RateWindow,
    clock: ClientClock,
    next_ping: u64,
    nacked: BTreeSet<Counter>,
}

impl Driver {
    /// Consegna un evento. Un'applicazione che non legge ferma il client,
    /// che smette di leggere dalla rete: l'host se ne accorge dalla coda. Una
    /// che ha chiuso non lo ferma.
    async fn emit(&self, event: ClientEvent) {
        tokio::select! {
            biased;
            _ = self.events.send(event) => {}
            () = self.shared.closed() => {}
        }
    }

    /// Un `welcome`: i commit fino a `lastC` sono trattati, gli altri
    /// ripartono in ordine prima di ogni altro messaggio.
    async fn welcomed(&mut self, welcome: crate::protocol::Welcome, resumed: bool) {
        self.token = welcome.resume.clone();
        self.last_c = welcome.last_c;
        {
            let mut state = self.shared.state.lock();
            state.pending.retain(|c, _| *c > welcome.last_c);
            state.outgoing = state.pending.keys().map(|c| Outgoing::Commit(*c)).collect();
            state.connected = true;
            // L'host non sa dove guardava lo scrittore mentre era fuori.
            if let Some(view) = state.view {
                state.push_ephemeral(Outgoing::View(view));
            }
        }
        self.emit(ClientEvent::Connected {
            resumed,
            doc: welcome.doc,
            limits: welcome.limits,
            seq: welcome.seq,
            last_c: welcome.last_c,
        })
        .await;
    }

    async fn run(mut self, mut ws: ClientWs) {
        loop {
            let end = self.connected(&mut ws).await;
            {
                let mut state = self.shared.state.lock();
                state.connected = false;
                state.outgoing.clear();
            }
            let retry = match end {
                Disconnect::Local => return self.finish(EndCause::Local).await,
                Disconnect::Violation(violation) => {
                    return self.finish(EndCause::Protocol(violation)).await
                }
                Disconnect::Lost => Retry::Resume,
                Disconnect::Closed { code, detail } => {
                    match CloseCode::from_code(code).map_or(Retry::Never, CloseCode::retry) {
                        Retry::Never => {
                            return self.finish(EndCause::Closed { code, detail }).await
                        }
                        retry => retry,
                    }
                }
            };
            self.emit(ClientEvent::Disconnected { retry }).await;
            match self.resume(retry).await {
                Some(resumed) => ws = resumed,
                None => return,
            }
        }
    }

    async fn finish(&self, cause: EndCause) {
        let unconfirmed = {
            let mut state = self.shared.state.lock();
            state.ended = true;
            state.connected = false;
            state.unconfirmed()
        };
        self.emit(ClientEvent::Ended { cause, unconfirmed }).await;
    }

    /// Riprende entro 2 minuti dalla caduta. `None` se la sessione è finita,
    /// e allora l'evento `Ended` è già partito.
    async fn resume(&mut self, retry: Retry) -> Option<ClientWs> {
        let window = Instant::now() + RESUME_WINDOW;
        let mut wait = match retry {
            Retry::ResumeAfter(delay) => delay,
            _ => Duration::ZERO,
        };
        let mut backoff = BACKOFF_MIN;
        loop {
            if self
                .shared
                .wait_or_close((Instant::now() + wait).min(window))
                .await
            {
                self.finish(EndCause::Local).await;
                return None;
            }
            if Instant::now() >= window {
                self.finish(EndCause::ResumeExpired).await;
                return None;
            }
            let hello = Hello {
                session: self.target.session.encode(),
                credential: Credential::Resume(Zeroizing::new(self.token.encode())),
                device: self.config.device.clone(),
                caps: self.config.caps,
            };
            let attempt = tokio::select! {
                attempt = enter(&self.dialer, &self.target, hello) => attempt,
                true = self.shared.wait_or_close(window) => {
                    self.finish(EndCause::Local).await;
                    return None;
                }
            };
            wait = backoff;
            backoff = (backoff * 2).min(BACKOFF_MAX);
            match attempt {
                Ok((ws, welcome)) => {
                    self.welcomed(welcome, true).await;
                    return Some(ws);
                }
                Err(ConnectError::Refused { code, detail }) => {
                    match CloseCode::from_code(code).map_or(Retry::Never, CloseCode::retry) {
                        Retry::ResumeAfter(delay) => wait = delay,
                        Retry::Resume => {}
                        Retry::Never => {
                            self.finish(EndCause::Closed { code, detail }).await;
                            return None;
                        }
                    }
                }
                Err(ConnectError::FingerprintMismatch) => {
                    self.finish(EndCause::FingerprintMismatch).await;
                    return None;
                }
                Err(ConnectError::Protocol(violation)) => {
                    self.finish(EndCause::Protocol(violation)).await;
                    return None;
                }
                // La rete non c'è ancora: si riprova.
                Err(_) => {}
            }
        }
    }

    /// Una connessione accettata, fino alla sua fine.
    async fn connected(&mut self, ws: &mut ClientWs) -> Disconnect {
        let mut ping = interval(self.config.ping_interval);
        ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut idle = Instant::now() + IDLE;
        let mut farewell: Option<String> = None;
        loop {
            let notified = self.shared.notify.notified();
            if self.shared.closing() {
                return goodbye(ws).await;
            }
            // Si manda finché il ritmo lo consente; poi si aspetta il ritmo
            // solo se qualcosa è in coda, il turno di una vista che aspetta,
            // altrimenti una notifica, una risposta che libera la finestra dei
            // commit o il `ping`.
            let now = Instant::now();
            let wait = self.rate.wait(now);
            let pacing = if wait.is_zero() {
                let clock = self.config.clock.clone();
                let (next, view_due) = {
                    let mut state = self.shared.state.lock();
                    let next = state.next(clock.as_ref(), now);
                    (next, state.queued_view_due(now))
                };
                if let Some(text) = next {
                    self.rate.admit(now);
                    match timeout(WRITE_TIMEOUT, ws.send(Message::Text(text.into()))).await {
                        Ok(Ok(())) => continue,
                        _ => return Disconnect::Lost,
                    }
                }
                view_due
            } else {
                self.shared.state.lock().has_queued().then_some(now + wait)
            };
            tokio::select! {
                biased;
                frame = ws.next() => {
                    idle = Instant::now() + IDLE;
                    let message = match frame {
                        None => return Disconnect::Lost,
                        Some(Err(error)) => {
                            return match host_violation(&error) {
                                Some(violation) => refuse(ws, violation).await,
                                None => Disconnect::Lost,
                            }
                        }
                        Some(Ok(message)) => message,
                    };
                    match message {
                        Message::Text(text) => {
                            let handled = match HostMessage::parse(&text) {
                                Ok(message) => self.inbound(message, &mut farewell).await,
                                Err(violation) => Err(violation),
                            };
                            if let Err(violation) = handled {
                                return refuse(ws, violation).await;
                            }
                        }
                        Message::Binary(_) => {
                            let violation = Violation::new(
                                CloseCode::UnsupportedData,
                                "binary frames are not part of the protocol",
                            );
                            return refuse(ws, violation).await;
                        }
                        Message::Close(frame) => {
                            let (code, reason) = close_parts(frame);
                            // `tungstenite` ha accodato la risposta: si manda e
                            // si aspetta che l'host chiuda il socket.
                            let _ = timeout(CLOSE_GRACE, async {
                                let _ = ws.flush().await;
                                while let Some(Ok(_)) = ws.next().await {}
                            })
                            .await;
                            return Disconnect::Closed { code, detail: farewell.unwrap_or(reason) };
                        }
                        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
                    }
                }
                () = sleep_until(idle) => return Disconnect::Lost,
                _ = ping.tick() => {
                    self.next_ping += 1;
                    self.shared.state.lock().outgoing.push_back(Outgoing::Ping(self.next_ping));
                }
                () = notified => {}
                () = wait_for(pacing) => {}
            }
        }
    }

    /// Un messaggio dell'host dopo il `welcome`.
    async fn inbound(
        &mut self,
        message: HostMessage,
        farewell: &mut Option<String>,
    ) -> Result<(), Violation> {
        let event = match message {
            HostMessage::Welcome(_) => {
                return Err(Violation::new(
                    CloseCode::InvalidPayload,
                    "a second welcome",
                ))
            }
            HostMessage::Snapshot(snapshot) => Some(ClientEvent::Snapshot(snapshot)),
            HostMessage::Ops(ops) => Some(ClientEvent::Ops(ops)),
            HostMessage::Ack(ack) => {
                let known = self.shared.state.lock().pending.remove(&ack.c).is_some();
                known.then_some(ClientEvent::Ack(ack))
            }
            HostMessage::Nack(nack) => {
                let known = self.shared.state.lock().pending.remove(&nack.c).is_some();
                // Un `nack` di un commit già scartato al `welcome` è la notizia
                // del rifiuto: si segnala una volta.
                let fresh = self.nacked.insert(nack.c);
                if self.nacked.len() > NACK_MEMORY {
                    self.nacked.pop_first();
                }
                (known || (fresh && nack.c <= self.last_c)).then_some(ClientEvent::Nack(nack))
            }
            HostMessage::Pong(pong) => {
                let now = (self.config.clock)();
                let estimate = self.clock.sample(pong.a, pong.b, now);
                if estimate.is_some() {
                    self.shared.state.lock().clock = estimate;
                }
                estimate.map(ClientEvent::Clock)
            }
            HostMessage::Error(error) => {
                *farewell = Some(error.detail);
                None
            }
            HostMessage::Bye(bye) => {
                *farewell = Some(bye.reason);
                None
            }
        };
        if let Some(event) = event {
            self.emit(event).await;
        }
        Ok(())
    }
}

async fn wait_for(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

/// Chiude per una violazione dell'host.
async fn refuse(ws: &mut ClientWs, violation: Violation) -> Disconnect {
    close(ws, violation.code.code(), &violation.detail).await;
    Disconnect::Violation(violation)
}

/// Il saluto dell'applicazione: `bye`, poi la chiusura con 1000.
async fn goodbye(ws: &mut ClientWs) -> Disconnect {
    let _ = timeout(
        WRITE_TIMEOUT.min(CLOSE_GRACE),
        ws.send(Message::Text(WriterMessage::Bye.to_json().into())),
    )
    .await;
    close(ws, CloseCode::Normal.code(), "bye").await;
    Disconnect::Local
}

async fn close(ws: &mut ClientWs, code: u16, reason: &str) {
    let grace = Instant::now() + CLOSE_GRACE;
    let frame = CloseFrame {
        code: WireCode::from(code),
        reason: Utf8Bytes::from(truncate(reason, 123)),
    };
    let _ = timeout_at(grace, async {
        if ws.send(Message::Close(Some(frame))).await.is_ok() {
            while let Some(Ok(_)) = ws.next().await {}
        }
    })
    .await;
    let _ = timeout_at(grace, ws.get_mut().shutdown()).await;
}

// L'heartbeat dell'host tiene viva la connessione: il silenzio oltre `IDLE`
// vuol dire che è caduta.
const _: () = assert!(IDLE.as_secs() > 2 * HEARTBEAT.as_secs());

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::StrokeId;

    fn stroke(text: &str) -> StrokeId {
        StrokeId::parse(text).unwrap()
    }

    fn points(s: StrokeId, count: usize) -> Outgoing {
        let pts = (0..count).map(|i| [i as f64, 0.0, 0.5, i as f64]).collect();
        Outgoing::Ink(WriterMessage::InkPoints(InkPoints { s, pts }))
    }

    fn connected() -> State {
        State {
            next_c: 1,
            connected: true,
            ..State::default()
        }
    }

    fn view(x: f64) -> View {
        View {
            x,
            y: 0.0,
            scale: 1.0,
            w: 1.0,
            h: 1.0,
        }
    }

    fn drain(state: &mut State) -> Vec<WriterMessage> {
        drain_at(state, Instant::now())
    }

    /// Tutto ciò che in `now` può partire, come lo legge l'host.
    fn drain_at(state: &mut State, now: Instant) -> Vec<WriterMessage> {
        let clock = || 0.0;
        std::iter::from_fn(|| state.next(&clock, now))
            .map(|text| match crate::protocol::parse_writer(&text).unwrap() {
                crate::protocol::Parsed::Message(message) => message,
                other => panic!("{other:?}"),
            })
            .collect()
    }

    #[test]
    fn queued_samples_of_a_stroke_travel_together_up_to_256() {
        let mut state = connected();
        let (a, b) = (stroke("o00000001"), stroke("o00000002"));
        state.push_ephemeral(points(a, 200));
        state.push_ephemeral(points(a, 56));
        state.push_ephemeral(points(a, 1));
        state.push_ephemeral(points(b, 1));
        let sizes: Vec<_> = drain(&mut state)
            .into_iter()
            .map(|message| match message {
                WriterMessage::InkPoints(points) => (points.s, points.pts.len()),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(sizes, [(a, 256), (a, 1), (b, 1)]);
    }

    #[test]
    fn the_last_view_replaces_the_queued_one_in_its_place() {
        let mut state = connected();
        state.push_ephemeral(Outgoing::View(view(1.0)));
        state.push_ephemeral(Outgoing::Ink(WriterMessage::InkEnd(stroke("o00000001"))));
        state.push_ephemeral(Outgoing::View(view(2.0)));
        let sent = drain(&mut state);
        assert!(
            matches!(sent[..], [WriterMessage::View(v), WriterMessage::InkEnd(_)] if v.x == 2.0)
        );
    }

    #[test]
    fn views_leave_at_least_100_ms_apart_and_the_last_one_always_leaves() {
        let mut state = connected();
        let start = Instant::now();
        let mut sent = Vec::new();
        let mut record = |state: &mut State, now: Instant| {
            for message in drain_at(state, now) {
                match message {
                    WriterMessage::View(view) => sent.push((now, view.x)),
                    other => panic!("{other:?}"),
                }
            }
        };
        // Tre secondi a 60 viste al secondo, una per frame.
        let mut now = start;
        for i in 0..180u32 {
            now = start + Duration::from_nanos(u64::from(i) * 1_000_000_000 / 60);
            state.push_ephemeral(Outgoing::View(view(f64::from(i))));
            record(&mut state, now);
        }
        // Finita la raffica, la vista in coda parte appena è il suo turno.
        if let Some(due) = state.queued_view_due(now) {
            record(&mut state, due);
        }
        assert!(!state.has_queued());

        for pair in sent.windows(2) {
            assert!(pair[1].0 - pair[0].0 >= VIEW_INTERVAL, "{sent:?}");
        }
        for (i, (at, _)) in sent.iter().enumerate() {
            let second = sent[i..]
                .iter()
                .take_while(|(later, _)| *later < *at + Duration::from_secs(1))
                .count();
            assert!(second <= 10, "{second} views in a second: {sent:?}");
        }
        assert!(sent.len() >= 25, "{sent:?}");
        assert_eq!(sent.last().map(|(_, x)| *x), Some(179.0));
    }

    #[test]
    fn a_view_waiting_its_turn_holds_back_neither_ink_nor_commits() {
        let mut state = connected();
        let now = Instant::now();
        state.push_ephemeral(Outgoing::View(view(1.0)));
        assert!(matches!(
            drain_at(&mut state, now)[..],
            [WriterMessage::View(_)]
        ));

        state.push_ephemeral(Outgoing::View(view(2.0)));
        state.push_ephemeral(Outgoing::Ink(WriterMessage::InkEnd(stroke("o00000001"))));
        let ops = Ops::parse(r#"[{"op":"add"}]"#, 10).unwrap();
        state.pending.insert(Counter(1), ops);
        state.outgoing.push_back(Outgoing::Commit(Counter(1)));
        let early = now + VIEW_INTERVAL / 2;
        assert!(matches!(
            drain_at(&mut state, early)[..],
            [WriterMessage::InkEnd(_), WriterMessage::Commit(_)]
        ));
        assert_eq!(state.queued_view_due(early), Some(now + VIEW_INTERVAL));
        assert!(matches!(
            drain_at(&mut state, now + VIEW_INTERVAL)[..],
            [WriterMessage::View(v)] if v.x == 2.0
        ));
        assert_eq!(state.queued_view_due(now + VIEW_INTERVAL), None);
    }

    #[test]
    fn a_full_queue_still_takes_the_last_view() {
        let mut state = connected();
        for i in 0..OUTGOING_LIMIT {
            state.push_ephemeral(Outgoing::Ink(WriterMessage::InkEnd(stroke(&format!(
                "o{i:08}"
            )))));
        }
        state.push_ephemeral(Outgoing::View(view(1.0)));
        state.push_ephemeral(Outgoing::View(view(2.0)));
        assert_eq!(state.outgoing.len(), OUTGOING_LIMIT + 1);
        assert!(matches!(state.outgoing.back(), Some(Outgoing::View(v)) if v.x == 2.0));
    }

    #[test]
    fn ink_is_dropped_while_disconnected_and_beyond_the_queue() {
        let mut state = State::default();
        state.push_ephemeral(points(stroke("o00000001"), 1));
        assert!(state.outgoing.is_empty());
        let mut state = connected();
        for i in 0..OUTGOING_LIMIT + 10 {
            state.push_ephemeral(Outgoing::Ink(WriterMessage::InkEnd(stroke(&format!(
                "o{i:08}"
            )))));
        }
        assert_eq!(state.outgoing.len(), OUTGOING_LIMIT);
    }

    #[test]
    fn commits_beyond_the_window_wait_and_ink_goes_past_them() {
        let mut state = connected();
        let ops = Ops::parse(r#"[{"op":"add"}]"#, 10).unwrap();
        for c in 1..=IN_FLIGHT_COMMITS as u64 + 1 {
            state.pending.insert(Counter(c), ops.clone());
            state.outgoing.push_back(Outgoing::Commit(Counter(c)));
        }
        state.push_ephemeral(Outgoing::Ink(WriterMessage::InkEnd(stroke("o00000001"))));
        let sent = drain(&mut state);
        assert_eq!(sent.len(), IN_FLIGHT_COMMITS + 1);
        assert!(matches!(sent.last(), Some(WriterMessage::InkEnd(_))));
        // La risposta al primo libera il posto per l'ultimo.
        state.pending.remove(&Counter(1));
        let sent = drain(&mut state);
        assert!(
            matches!(&sent[..], [WriterMessage::Commit(commit)] if commit.c.0 == IN_FLIGHT_COMMITS as u64 + 1)
        );
        // Un commit già risposto prima dell'invio non parte.
        state.outgoing.push_back(Outgoing::Commit(Counter(1)));
        assert!(drain(&mut state).is_empty());
        assert!(!state.has_queued());
    }
}
