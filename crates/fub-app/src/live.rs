//! La sessione live (ADR 0204) affacciata alla shell.
//!
//! `fub-live` apre il listener, parla con lo scrittore e tiene i commit finché
//! la shell non risponde; non sa niente di finestre né di Tauri. Qui c'è ciò
//! che serve a darlo a una finestra:
//!
//! - **il registro** delle sessioni aperte, con la finestra che le possiede.
//!   Una sessione per documento; un'altra finestra non la vede, e riceve
//!   `not_found` come per una sessione che non c'è;
//! - **la pompa**, che porta i gruppi di eventi dalla coda della sessione al
//!   canale della finestra, un invio per gruppo. Se il canale non porta più,
//!   la finestra non c'è e nessuno risponderebbe ai commit: la sessione si
//!   chiude;
//! - **le chiusure** che non passano da `live_stop`: la pagina che si
//!   ricarica, la finestra distrutta, l'app che esce. Tutte con
//!   [`EndReason::HostClosing`]; la chiusura del documento la manda la shell,
//!   che la conosce;
//! - **la scelta dell'indirizzo** fra quelli privati del PC, il nome del PC
//!   per il QR e la traduzione degli errori in [`PluginError`].
//!
//! Una sessione finita da sé, per un documento diventato in sola lettura,
//! resta nel registro finché la shell non chiama `live_stop`: è `live_stop`
//! che restituisce i commit a cui nessuno ha risposto.
//!
//! Il registro è generico su [`Hosted`], [`Events`] e [`Sink`] per le prove:
//! fuori da `fub-live` una sessione vera ascolta solo su un indirizzo privato,
//! che la CI non ha.

use std::collections::HashMap;
use std::future::Future;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use fub_abi::settings::SettingEntry;
use fub_abi::text::{Arg, Text};
use fub_abi::PluginError;
use fub_live::host::{
    EndReason, LiveConfig, LiveEvent, LiveEvents, LiveHost, LiveStatus, Pairing, RenewError,
    SendError, SessionInfo, ShellMessage, StartError, StopReport,
};
use fub_live::net::{candidate_addresses, Candidate, ListenAddr};
use fub_live::pairing::valid_host_name;
use fub_live::protocol::{DocumentInfo, Snapshot};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

/// Il tempo che l'app concede alle sessioni quando esce. `fub-live` ne usa al
/// più due secondi e mezzo per mandare `bye` e chiudere con lo scrittore;
/// oltre è un difetto, e l'app esce lo stesso.
const EXIT_WAIT: Duration = Duration::from_secs(3);

/// Ciò che la shell chiede a `live_start`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveStart {
    /// Il documento della sessione.
    pub document: DocumentInfo,
    /// Il documento com'è all'avvio.
    pub snapshot: Snapshot,
    /// L'indirizzo scelto dall'utente fra quelli di `addresses`; senza, quello
    /// della rotta predefinita.
    #[serde(default)]
    pub address: Option<Ipv4Addr>,
}

/// La risposta di `live_start`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStarted {
    /// Dove ascolta la sessione e con che certificato.
    pub session: SessionInfo,
    /// Il primo QR.
    pub pairing: Pairing,
    /// Gli indirizzi privati del PC, quello della rotta predefinita per primo:
    /// con più di uno la shell lascia scegliere, e riapre la sessione
    /// sull'indirizzo scelto.
    pub addresses: Vec<LiveAddress>,
}

/// Un indirizzo privato del PC su cui una sessione può ascoltare.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAddress {
    /// L'indirizzo IPv4.
    pub addr: String,
    /// Il nome dell'interfaccia, come lo dà il sistema.
    pub interface: String,
    /// È l'indirizzo da cui esce la rotta predefinita.
    pub default_route: bool,
}

impl From<&Candidate> for LiveAddress {
    fn from(candidate: &Candidate) -> LiveAddress {
        LiveAddress {
            addr: candidate.addr.to_string(),
            interface: candidate.interface.clone(),
            default_route: candidate.default_route,
        }
    }
}

/// Ciò che il registro chiede a una sessione. In produzione è [`LiveHost`].
pub(crate) trait Hosted: Send + 'static {
    fn info(&self) -> &SessionInfo;
    fn pairing(&self) -> Option<Pairing>;
    fn renew_pairing(&self) -> Result<Pairing, RenewError>;
    fn send(&self, message: ShellMessage) -> Result<(), SendError>;
    fn status(&self) -> LiveStatus;
    fn stop(self, reason: EndReason) -> impl Future<Output = StopReport> + Send + 'static;
}

impl Hosted for LiveHost {
    fn info(&self) -> &SessionInfo {
        LiveHost::info(self)
    }

    fn pairing(&self) -> Option<Pairing> {
        LiveHost::pairing(self)
    }

    fn renew_pairing(&self) -> Result<Pairing, RenewError> {
        LiveHost::renew_pairing(self)
    }

    fn send(&self, message: ShellMessage) -> Result<(), SendError> {
        LiveHost::send(self, message)
    }

    fn status(&self) -> LiveStatus {
        LiveHost::status(self)
    }

    fn stop(self, reason: EndReason) -> impl Future<Output = StopReport> + Send + 'static {
        LiveHost::stop(self, reason)
    }
}

/// La coda degli eventi di una sessione. In produzione è [`LiveEvents`].
pub(crate) trait Events: Send + 'static {
    /// Il prossimo gruppo di eventi; `None` quando la sessione è finita.
    fn recv(&mut self) -> impl Future<Output = Option<Vec<LiveEvent>>> + Send;
}

impl Events for LiveEvents {
    fn recv(&mut self) -> impl Future<Output = Option<Vec<LiveEvent>>> + Send {
        LiveEvents::recv(self)
    }
}

/// Il canale verso la finestra. In produzione è il `Channel` che la shell
/// passa a `live_start`.
pub(crate) trait Sink: Send + 'static {
    /// Consegna un gruppo di eventi; `false` se la finestra non c'è più.
    fn deliver(&self, events: Vec<LiveEvent>) -> bool;
}

impl Sink for tauri::ipc::Channel<Vec<LiveEvent>> {
    fn deliver(&self, events: Vec<LiveEvent>) -> bool {
        self.send(events).is_ok()
    }
}

struct Entry<S> {
    host: S,
    /// L'etichetta della finestra che ha aperto la sessione.
    owner: String,
    /// L'id del documento.
    document: String,
}

type Entries<S> = Arc<Mutex<HashMap<String, Entry<S>>>>;

/// Le sessioni live aperte, per id di sessione.
pub(crate) struct LiveSessions<S = LiveHost> {
    entries: Entries<S>,
    /// Le chiusure in corso. Quelle partite da una finestra che sparisce
    /// girano per conto loro, e quando sparisce l'ultima l'app esce subito
    /// dopo: l'uscita le aspetta, perché i loro compiti cadrebbero con il
    /// runtime prima del `bye` allo scrittore.
    closing: Arc<watch::Sender<usize>>,
}

impl<S> Default for LiveSessions<S> {
    fn default() -> Self {
        LiveSessions {
            entries: Arc::new(Mutex::new(HashMap::new())),
            closing: Arc::new(watch::Sender::new(0)),
        }
    }
}

/// Una chiusura in corso, contata finché esiste.
struct Closing(Arc<watch::Sender<usize>>);

impl Closing {
    fn begin(counter: &Arc<watch::Sender<usize>>) -> Closing {
        counter.send_modify(|count| *count += 1);
        Closing(counter.clone())
    }
}

impl Drop for Closing {
    fn drop(&mut self) {
        self.0.send_modify(|count| *count -= 1);
    }
}

impl LiveSessions<LiveHost> {
    /// Il registro vuoto, con le sessioni vere.
    pub(crate) fn new() -> Self {
        LiveSessions::default()
    }

    /// Apre una sessione per la finestra `owner` e restituisce la risposta per
    /// la shell e la pompa degli eventi, da avviare sul runtime.
    pub(crate) async fn start<K: Sink>(
        &self,
        owner: &str,
        request: LiveStart,
        port: u16,
        sink: K,
    ) -> Result<(LiveStarted, impl Future<Output = ()> + Send + 'static), PluginError> {
        let document = request.document.id.clone();
        self.ensure_free(&document)?;
        let candidates = candidate_addresses()
            .map_err(|error| PluginError::Io(text(INTERFACES, &[("why", error.to_string())])))?;
        let listen = choose_address(&candidates, request.address)?;
        let config = LiveConfig {
            listen,
            port,
            host_name: host_name(),
            document: request.document,
            snapshot: request.snapshot,
        };
        let (host, events) = LiveHost::start(config).await.map_err(start_error)?;
        let addresses = candidates.iter().map(LiveAddress::from).collect();
        self.admit(owner, document, host, events, sink, addresses)
    }
}

impl<S: Hosted> LiveSessions<S> {
    /// Un documento ha al più una sessione: due QR per lo stesso disegno
    /// sarebbero due scrittori.
    fn ensure_free(&self, document: &str) -> Result<(), PluginError> {
        free(&self.entries.lock(), document)
    }

    /// Registra una sessione appena aperta. Se nel frattempo un'altra chiamata
    /// ha aperto una sessione sullo stesso documento, questa cade: il
    /// `LiveHost` lasciato cadere chiude il listener da sé.
    fn admit<E: Events, K: Sink>(
        &self,
        owner: &str,
        document: String,
        host: S,
        events: E,
        sink: K,
        addresses: Vec<LiveAddress>,
    ) -> Result<(LiveStarted, impl Future<Output = ()> + Send + 'static), PluginError> {
        let pairing = host.pairing().ok_or_else(|| {
            let why = "a new session has no pairing to show".to_string();
            PluginError::Internal(text(INTERNAL, &[("why", why)]))
        })?;
        let session = host.info().clone();
        let id = session.session.encode();
        {
            let mut entries = self.entries.lock();
            free(&entries, &document)?;
            entries.insert(
                id.clone(),
                Entry {
                    host,
                    owner: owner.to_owned(),
                    document,
                },
            );
        }
        let started = LiveStarted {
            session,
            pairing,
            addresses,
        };
        let pump = pump(self.entries.clone(), self.closing.clone(), id, events, sink);
        Ok((started, pump))
    }

    /// Il QR in corso, o uno nuovo con `renew`.
    pub(crate) fn pairing(
        &self,
        owner: &str,
        session: &str,
        renew: bool,
    ) -> Result<Option<Pairing>, PluginError> {
        self.with(owner, session, |host| {
            if renew {
                host.renew_pairing().map(Some).map_err(renew_error)
            } else {
                Ok(host.pairing())
            }
        })?
    }

    /// Manda allo scrittore un messaggio della shell.
    pub(crate) fn send(
        &self,
        owner: &str,
        session: &str,
        message: ShellMessage,
    ) -> Result<(), PluginError> {
        self.with(owner, session, |host| {
            host.send(message).map_err(send_error)
        })?
    }

    /// Lo stato della sessione, commit in attesa compresi.
    pub(crate) fn status(&self, owner: &str, session: &str) -> Result<LiveStatus, PluginError> {
        self.with(owner, session, Hosted::status)
    }

    /// Chiude la sessione e restituisce i commit a cui la shell non ha
    /// risposto.
    pub(crate) async fn stop(
        &self,
        owner: &str,
        session: &str,
        reason: EndReason,
    ) -> Result<StopReport, PluginError> {
        let host = {
            let mut entries = self.entries.lock();
            match entries.get(session) {
                Some(entry) if entry.owner == owner => entries.remove(session).map(|e| e.host),
                _ => None,
            }
        };
        let host = host.ok_or_else(|| unknown(session))?;
        let _closing = Closing::begin(&self.closing);
        Ok(host.stop(reason).await)
    }

    /// Toglie dal registro le sessioni della finestra `owner`, la cui pagina
    /// si ricarica o che non c'è più, e restituisce la loro chiusura da avviare
    /// sul runtime. `None` se la finestra non ne ha.
    pub(crate) fn close_owned_by(
        &self,
        owner: &str,
        why: &'static str,
    ) -> Option<impl Future<Output = ()> + Send + 'static> {
        let hosts: Vec<S> = {
            let mut entries = self.entries.lock();
            let ids: Vec<String> = entries
                .iter()
                .filter(|(_, entry)| entry.owner == owner)
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter()
                .filter_map(|id| entries.remove(id))
                .map(|entry| entry.host)
                .collect()
        };
        if hosts.is_empty() {
            return None;
        }
        let closing = Closing::begin(&self.closing);
        Some(async move {
            close(hosts, why).await;
            drop(closing);
        })
    }

    /// Chiude tutte le sessioni e aspetta le chiusure già in corso: l'app
    /// esce. Non aspetta oltre [`EXIT_WAIT`].
    pub(crate) async fn close_on_exit(&self) {
        let hosts: Vec<S> = self
            .entries
            .lock()
            .drain()
            .map(|(_, entry)| entry.host)
            .collect();
        let mut idle = self.closing.subscribe();
        let all = async move {
            close(hosts, "the app is exiting").await;
            // Il mittente vive in `self`, quindi l'attesa non fallisce.
            let _ = idle.wait_for(|count| *count == 0).await;
        };
        if tokio::time::timeout(EXIT_WAIT, all).await.is_err() {
            tracing::error!(
                target: "fub.app",
                "live sessions did not close within {EXIT_WAIT:?}; the app exits anyway"
            );
        }
    }

    fn with<T>(
        &self,
        owner: &str,
        session: &str,
        act: impl FnOnce(&S) -> T,
    ) -> Result<T, PluginError> {
        let entries = self.entries.lock();
        match entries.get(session) {
            Some(entry) if entry.owner == owner => Ok(act(&entry.host)),
            _ => Err(unknown(session)),
        }
    }
}

fn free<S>(entries: &HashMap<String, Entry<S>>, document: &str) -> Result<(), PluginError> {
    if entries.values().any(|entry| entry.document == document) {
        Err(PluginError::AlreadyExists(text(
            BUSY,
            &[("document", document.to_string())],
        )))
    } else {
        Ok(())
    }
}

/// Porta i gruppi di eventi alla finestra finché la sessione vive.
async fn pump<S: Hosted, E: Events, K: Sink>(
    entries: Entries<S>,
    closing: Arc<watch::Sender<usize>>,
    id: String,
    mut events: E,
    sink: K,
) {
    while let Some(batch) = events.recv().await {
        if sink.deliver(batch) {
            continue;
        }
        // La finestra non c'è più: nessuno risponderebbe ai commit, e lo
        // scrittore aspetterebbe per niente.
        let orphan = entries.lock().remove(&id);
        if let Some(entry) = orphan {
            let _closing = Closing::begin(&closing);
            let report = entry.host.stop(EndReason::HostClosing).await;
            closed("the window no longer receives its events", &report);
        }
        return;
    }
}

/// Chiude le sessioni tolte dal registro, tutte insieme.
async fn close<S: Hosted>(hosts: Vec<S>, why: &'static str) {
    let mut stopping = tokio::task::JoinSet::new();
    for host in hosts {
        stopping.spawn(host.stop(EndReason::HostClosing));
    }
    while let Some(report) = stopping.join_next().await {
        match report {
            Ok(report) => closed(why, &report),
            Err(error) => {
                tracing::error!(target: "fub.app", %error, "a live session did not close: {why}");
            }
        }
    }
}

fn closed(why: &str, report: &StopReport) {
    if report.pending.is_empty() {
        tracing::info!(target: "fub.app", "live session closed: {why}");
    } else {
        // Lo scrittore li tiene e li rimanda alla prossima sessione.
        tracing::warn!(
            target: "fub.app",
            pending = report.pending.len(),
            "live session closed with unanswered commits: {why}"
        );
    }
}

/// La porta delle sessioni, dall'impostazione di macchina `live.port`.
pub(crate) fn port(machine: &[SettingEntry]) -> u16 {
    fub_host::settings::live_port(
        machine
            .iter()
            .find(|entry| entry.spec.key == fub_host::settings::LIVE_PORT)
            .and_then(|entry| entry.value.as_number()),
    )
}

/// L'indirizzo su cui ascoltare: quello chiesto, se è ancora di
/// un'interfaccia attiva, o quello della rotta predefinita.
fn choose_address(
    candidates: &[Candidate],
    wanted: Option<Ipv4Addr>,
) -> Result<ListenAddr, PluginError> {
    match wanted {
        Some(ip) => candidates
            .iter()
            .find(|candidate| candidate.addr.ip() == ip)
            .map(|candidate| candidate.addr)
            .ok_or_else(|| PluginError::NotFound(text(ADDRESS, &[("address", ip.to_string())]))),
        None => candidates
            .first()
            .map(|candidate| candidate.addr)
            .ok_or_else(|| PluginError::Unserved(text(OFFLINE, &[]))),
    }
}

/// Il nome del PC che il tablet mostra prima di collegarsi.
fn host_name() -> Option<String> {
    gethostname::gethostname()
        .into_string()
        .ok()
        .and_then(|raw| pc_name(&raw))
}

/// Il nome di rete senza il `.local` che macOS aggiunge, tagliato ai 64
/// caratteri del QR. `None` se non resta un nome che il QR possa portare.
fn pc_name(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let name = match raw.len().checked_sub(".local".len()) {
        Some(cut) if raw.is_char_boundary(cut) && raw[cut..].eq_ignore_ascii_case(".local") => {
            &raw[..cut]
        }
        _ => raw,
    };
    let name: String = name.chars().take(64).collect();
    valid_host_name(&name).then_some(name)
}

fn unknown(session: &str) -> PluginError {
    PluginError::NotFound(text(UNKNOWN, &[("session", session.to_string())]))
}

// Le chiavi degli errori nel catalogo del core: la shell li riceve nella
// lingua di chi guarda. Ciò che viene dal sistema o dal protocollo passa come
// `why`, così com'è.
const OFFLINE: &str = "host.live.offline";
const INTERFACES: &str = "host.live.interfaces";
const ADDRESS: &str = "host.live.address";
const BIND: &str = "host.live.bind";
const BUSY: &str = "host.live.busy";
const UNKNOWN: &str = "host.live.unknown";
const DOCUMENT: &str = "host.live.document";
const TOO_LARGE: &str = "host.live.too_large";
const ENDED: &str = "host.live.ended";
const WRITER_CONNECTED: &str = "host.live.writer_connected";
const REFUSED: &str = "host.live.refused";
const INTERNAL: &str = "host.live.internal";

fn text(key: &str, args: &[(&str, String)]) -> Text {
    let args = args
        .iter()
        .map(|(name, value)| Arg::text(*name, value.as_str()))
        .collect();
    Text::message(key, args)
}

fn start_error(error: StartError) -> PluginError {
    let why = || vec![("why", error.to_string())];
    match &error {
        StartError::InvalidDocument => PluginError::BadArgs(text(DOCUMENT, &[])),
        StartError::SnapshotTooLarge { .. } => PluginError::BadArgs(text(TOO_LARGE, &[])),
        StartError::Bind { addr, source } => PluginError::Io(text(
            BIND,
            &[("address", addr.to_string()), ("why", source.to_string())],
        )),
        // Il nome del PC lo sceglie `host_name`, che scarta quelli fuori dai
        // limiti: se arriva qui è un difetto.
        StartError::InvalidHostName
        | StartError::Tls(_)
        | StartError::Random(_)
        | StartError::Qr(_) => PluginError::Internal(text(INTERNAL, &why())),
    }
}

fn send_error(error: SendError) -> PluginError {
    let why = || vec![("why", error.to_string())];
    match &error {
        SendError::Ended => PluginError::Cancelled(text(ENDED, &[])),
        SendError::UnknownCommit { .. } => PluginError::NotFound(text(REFUSED, &why())),
        SendError::SeqRegression { .. } => PluginError::Conflict(text(REFUSED, &why())),
        SendError::TooLarge { .. } => PluginError::BadArgs(text(REFUSED, &why())),
        SendError::SnapshotTooLarge { .. } => PluginError::BadArgs(text(TOO_LARGE, &[])),
    }
}

fn renew_error(error: RenewError) -> PluginError {
    match &error {
        RenewError::Ended => PluginError::Cancelled(text(ENDED, &[])),
        RenewError::WriterConnected => PluginError::AlreadyExists(text(WRITER_CONNECTED, &[])),
        RenewError::Unavailable(_) => {
            PluginError::Internal(text(INTERNAL, &[("why", error.to_string())]))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use fub_live::counter::{Counter, WriterId};
    use fub_live::host::{PendingCommit, Stats};
    use fub_live::protocol::Ops;
    use fub_live::token::{Fingerprint, SessionId};
    use tokio::sync::mpsc;

    use super::*;

    #[derive(Default)]
    struct Log {
        sent: Vec<ShellMessage>,
        stopped: Vec<EndReason>,
    }

    struct FakeHost {
        info: SessionInfo,
        log: Arc<Mutex<Log>>,
        pending: Vec<PendingCommit>,
        /// Quanto dura `stop`; `None` per mai.
        takes: Option<Duration>,
    }

    impl FakeHost {
        fn new(first: char, log: &Arc<Mutex<Log>>) -> FakeHost {
            FakeHost {
                info: SessionInfo {
                    session: SessionId::parse(&format!("{first}AAAAAAAAAA")).unwrap(),
                    addr: "192.168.1.2:4000".parse().unwrap(),
                    fingerprint: Fingerprint::of_certificate(b"certificate"),
                    host_name: Some("Studio".into()),
                },
                log: log.clone(),
                pending: Vec::new(),
                takes: Some(Duration::ZERO),
            }
        }

        fn id(&self) -> String {
            self.info.session.encode()
        }
    }

    impl Hosted for FakeHost {
        fn info(&self) -> &SessionInfo {
            &self.info
        }

        fn pairing(&self) -> Option<Pairing> {
            Some(Pairing {
                payload: String::from("fubdraw://live?v=1").into(),
                qr_svg: "<svg/>".into(),
                expires_in_ms: 300_000,
            })
        }

        fn renew_pairing(&self) -> Result<Pairing, RenewError> {
            Err(RenewError::WriterConnected)
        }

        fn send(&self, message: ShellMessage) -> Result<(), SendError> {
            self.log.lock().sent.push(message);
            Ok(())
        }

        fn status(&self) -> LiveStatus {
            LiveStatus {
                ended: false,
                seq: Counter(4),
                pairing_expires_in_ms: Some(300_000),
                writer: None,
                pending: self.pending.clone(),
                stats: Stats::default(),
            }
        }

        async fn stop(self, reason: EndReason) -> StopReport {
            match self.takes {
                Some(takes) => tokio::time::sleep(takes).await,
                None => std::future::pending().await,
            }
            self.log.lock().stopped.push(reason);
            StopReport {
                pending: self.pending,
            }
        }
    }

    impl Events for mpsc::UnboundedReceiver<Vec<LiveEvent>> {
        fn recv(&mut self) -> impl Future<Output = Option<Vec<LiveEvent>>> + Send {
            mpsc::UnboundedReceiver::recv(self)
        }
    }

    #[derive(Clone, Default)]
    struct FakeSink {
        got: Arc<Mutex<Vec<Vec<LiveEvent>>>>,
        gone: Arc<AtomicBool>,
    }

    impl Sink for FakeSink {
        fn deliver(&self, events: Vec<LiveEvent>) -> bool {
            if self.gone.load(Ordering::SeqCst) {
                return false;
            }
            self.got.lock().push(events);
            true
        }
    }

    fn snapshot() -> ShellMessage {
        ShellMessage::Snapshot {
            seq: Counter(5),
            text: "<svg/>".into(),
        }
    }

    fn pending() -> PendingCommit {
        PendingCommit {
            writer: WriterId(1),
            c: Counter(2),
            ops: Ops::from_values(&[serde_json::json!({ "op": "add" })], 16).unwrap(),
        }
    }

    /// Registra una sessione finta e restituisce la coda dei suoi eventi.
    fn admit(
        sessions: &LiveSessions<FakeHost>,
        owner: &str,
        document: &str,
        host: FakeHost,
        sink: FakeSink,
    ) -> Result<
        (
            mpsc::UnboundedSender<Vec<LiveEvent>>,
            impl Future<Output = ()> + Send + 'static,
        ),
        PluginError,
    > {
        let (events, queue) = mpsc::unbounded_channel();
        let (started, pump) =
            sessions.admit(owner, document.into(), host, queue, sink, Vec::new())?;
        assert_eq!(started.pairing.expires_in_ms, 300_000);
        Ok((events, pump))
    }

    /// Registra una sessione senza la sua pompa: le prove del registro non
    /// guardano gli eventi.
    fn register(
        sessions: &LiveSessions<FakeHost>,
        owner: &str,
        document: &str,
        host: FakeHost,
    ) -> Result<(), PluginError> {
        admit(sessions, owner, document, host, FakeSink::default()).map(drop)
    }

    #[test]
    fn a_session_belongs_to_its_window_and_to_its_document() {
        let log = Arc::new(Mutex::new(Log::default()));
        let sessions = LiveSessions::default();
        let host = FakeHost::new('B', &log);
        let id = host.id();
        register(&sessions, "main", "a.svg", host).unwrap();

        // Un secondo QR per lo stesso disegno no, da nessuna finestra.
        assert!(matches!(
            sessions.ensure_free("a.svg"),
            Err(PluginError::AlreadyExists(_))
        ));
        let second = register(&sessions, "doc-1", "a.svg", FakeHost::new('C', &log));
        assert!(matches!(second, Err(PluginError::AlreadyExists(_))));
        assert!(sessions.ensure_free("b.svg").is_ok());

        // Un'altra finestra non la vede.
        assert!(matches!(
            sessions.status("doc-1", &id),
            Err(PluginError::NotFound(_))
        ));
        assert!(matches!(
            sessions.send("doc-1", &id, snapshot()),
            Err(PluginError::NotFound(_))
        ));
        assert!(log.lock().sent.is_empty());

        // La sua sì.
        assert_eq!(sessions.status("main", &id).unwrap().seq, Counter(4));
        sessions.send("main", &id, snapshot()).unwrap();
        assert_eq!(log.lock().sent, vec![snapshot()]);
        assert!(sessions.pairing("main", &id, false).unwrap().is_some());
        assert!(matches!(
            sessions.pairing("main", &id, true),
            Err(PluginError::AlreadyExists(_))
        ));
        assert!(matches!(
            sessions.status("main", "ZZZZZZZZZZZ"),
            Err(PluginError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn stop_returns_the_unanswered_commits_once() {
        let log = Arc::new(Mutex::new(Log::default()));
        let sessions = LiveSessions::default();
        let mut host = FakeHost::new('B', &log);
        host.pending = vec![pending()];
        let id = host.id();
        register(&sessions, "main", "a.svg", host).unwrap();

        let foreign = sessions.stop("doc-1", &id, EndReason::Terminated).await;
        assert!(matches!(foreign, Err(PluginError::NotFound(_))));
        let report = sessions
            .stop("main", &id, EndReason::Terminated)
            .await
            .unwrap();
        assert_eq!(report.pending, vec![pending()]);
        assert_eq!(log.lock().stopped, vec![EndReason::Terminated]);
        let again = sessions.stop("main", &id, EndReason::Terminated).await;
        assert!(matches!(again, Err(PluginError::NotFound(_))));
        // Il documento è di nuovo libero.
        assert!(sessions.ensure_free("a.svg").is_ok());
    }

    #[tokio::test]
    async fn a_reloaded_or_closed_window_takes_only_its_own_sessions() {
        let log = Arc::new(Mutex::new(Log::default()));
        let sessions = LiveSessions::default();
        let other = FakeHost::new('C', &log);
        let other_id = other.id();
        register(&sessions, "main", "a.svg", FakeHost::new('B', &log)).unwrap();
        register(&sessions, "doc-1", "b.svg", other).unwrap();

        let closing = sessions.close_owned_by("main", "the page is reloading");
        closing.expect("the main window has a session").await;
        assert_eq!(log.lock().stopped, vec![EndReason::HostClosing]);
        assert!(sessions.status("doc-1", &other_id).is_ok());
        assert!(sessions.close_owned_by("main", "again").is_none());

        sessions.close_on_exit().await;
        assert_eq!(
            log.lock().stopped,
            vec![EndReason::HostClosing, EndReason::HostClosing]
        );
        assert!(sessions.close_owned_by("doc-1", "again").is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn the_exit_waits_for_the_closes_already_under_way() {
        let log = Arc::new(Mutex::new(Log::default()));
        let sessions = LiveSessions::default();
        let mut slow = FakeHost::new('B', &log);
        slow.takes = Some(Duration::from_secs(1));
        register(&sessions, "doc-1", "a.svg", slow).unwrap();

        // L'ultima finestra sparisce e l'app esce subito dopo.
        let closing = sessions.close_owned_by("doc-1", "the window was destroyed");
        tokio::spawn(closing.expect("the window has a session"));
        let started = tokio::time::Instant::now();
        sessions.close_on_exit().await;
        assert_eq!(started.elapsed(), Duration::from_secs(1));
        assert_eq!(log.lock().stopped, vec![EndReason::HostClosing]);
    }

    #[tokio::test]
    async fn the_pump_forwards_every_batch_in_order() {
        let log = Arc::new(Mutex::new(Log::default()));
        let sessions = LiveSessions::default();
        let host = FakeHost::new('B', &log);
        let id = host.id();
        let sink = FakeSink::default();
        let (events, pump) = admit(&sessions, "main", "a.svg", host, sink.clone()).unwrap();
        let pump = tokio::spawn(pump);

        events.send(vec![LiveEvent::PairingExpired]).unwrap();
        events
            .send(vec![
                LiveEvent::SnapshotWanted,
                LiveEvent::Ended {
                    reason: EndReason::ReadOnly,
                },
            ])
            .unwrap();
        drop(events);
        pump.await.unwrap();

        let got = sink.got.lock();
        assert_eq!(got.len(), 2);
        assert!(matches!(got[0][..], [LiveEvent::PairingExpired]));
        assert!(matches!(
            got[1][..],
            [
                LiveEvent::SnapshotWanted,
                LiveEvent::Ended {
                    reason: EndReason::ReadOnly
                }
            ]
        ));
        // Finita da sé, la sessione aspetta `live_stop` con i suoi commit.
        assert!(sessions.status("main", &id).is_ok());
        assert!(log.lock().stopped.is_empty());
    }

    #[tokio::test]
    async fn a_window_that_no_longer_receives_closes_its_session() {
        let log = Arc::new(Mutex::new(Log::default()));
        let sessions = LiveSessions::default();
        let host = FakeHost::new('B', &log);
        let id = host.id();
        let sink = FakeSink::default();
        let (events, pump) = admit(&sessions, "main", "a.svg", host, sink.clone()).unwrap();
        let pump = tokio::spawn(pump);

        sink.gone.store(true, Ordering::SeqCst);
        events.send(vec![LiveEvent::PairingExpired]).unwrap();
        pump.await.unwrap();

        assert_eq!(log.lock().stopped, vec![EndReason::HostClosing]);
        assert!(matches!(
            sessions.status("main", &id),
            Err(PluginError::NotFound(_))
        ));
        assert!(sessions.ensure_free("a.svg").is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn the_app_does_not_wait_for_a_session_that_never_closes() {
        let log = Arc::new(Mutex::new(Log::default()));
        let sessions = LiveSessions::default();
        let mut stuck = FakeHost::new('B', &log);
        stuck.takes = None;
        register(&sessions, "main", "a.svg", stuck).unwrap();
        register(&sessions, "main", "b.svg", FakeHost::new('C', &log)).unwrap();
        let started = tokio::time::Instant::now();
        sessions.close_on_exit().await;
        assert_eq!(started.elapsed(), EXIT_WAIT);
        assert_eq!(log.lock().stopped, vec![EndReason::HostClosing]);
    }

    #[test]
    fn the_address_is_the_chosen_one_or_that_of_the_default_route() {
        let candidate = |ip: &str, default_route| Candidate {
            addr: ListenAddr::new(ip.parse().unwrap()).unwrap(),
            interface: "eth0".into(),
            default_route,
        };
        let candidates = [
            candidate("192.168.1.20", true),
            candidate("10.0.0.5", false),
        ];
        let ip = |wanted: Option<&str>| {
            choose_address(&candidates, wanted.map(|text| text.parse().unwrap()))
                .map(|addr| addr.ip().to_string())
        };
        assert_eq!(ip(None).unwrap(), "192.168.1.20");
        assert_eq!(ip(Some("10.0.0.5")).unwrap(), "10.0.0.5");
        assert!(matches!(
            ip(Some("10.0.0.6")),
            Err(PluginError::NotFound(_))
        ));
        assert!(matches!(
            choose_address(&[], None),
            Err(PluginError::Unserved(_))
        ));
        assert_eq!(
            LiveAddress::from(&candidates[0]),
            LiveAddress {
                addr: "192.168.1.20".into(),
                interface: "eth0".into(),
                default_route: true,
            }
        );
    }

    #[test]
    fn the_pc_name_fits_the_qr() {
        assert_eq!(pc_name("Studio.local").as_deref(), Some("Studio"));
        assert_eq!(pc_name("Studio.LOCAL\n").as_deref(), Some("Studio"));
        assert_eq!(pc_name("aula-3").as_deref(), Some("aula-3"));
        let long = "è".repeat(80);
        assert_eq!(pc_name(&long).map(|name| name.chars().count()), Some(64));
        for invalid in ["", "  ", ".local", "a\u{7}b"] {
            assert_eq!(pc_name(invalid), None, "{invalid:?}");
        }
    }

    #[test]
    fn the_start_request_is_read_strictly() {
        let request: LiveStart = serde_json::from_value(serde_json::json!({
            "document": { "id": "disegni/a.svg", "title": "A" },
            "snapshot": { "seq": "3", "text": "<svg/>" },
            "address": "192.168.1.20",
        }))
        .unwrap();
        assert_eq!(request.snapshot.seq, Counter(3));
        assert_eq!(request.address, Some(Ipv4Addr::new(192, 168, 1, 20)));
        let without: LiveStart = serde_json::from_value(serde_json::json!({
            "document": { "id": "a.svg", "title": "" },
            "snapshot": { "seq": "0", "text": "<svg/>" },
        }))
        .unwrap();
        assert_eq!(without.address, None);
        for invalid in [
            serde_json::json!({
                "document": { "id": "a.svg", "title": "" },
                "snapshot": { "seq": "0", "text": "<svg/>" },
                "port": 4000,
            }),
            serde_json::json!({
                "document": { "id": "a.svg", "title": "" },
                "snapshot": { "seq": 0, "text": "<svg/>" },
            }),
            serde_json::json!({
                "document": { "id": "a.svg", "title": "" },
                "snapshot": { "seq": "0", "text": "<svg/>", "extra": true },
            }),
        ] {
            assert!(
                serde_json::from_value::<LiveStart>(invalid.clone()).is_err(),
                "{invalid}"
            );
        }
    }

    #[test]
    fn errors_keep_what_the_shell_must_tell_apart() {
        let kind = |error: PluginError| serde_json::to_value(error).unwrap()["kind"].clone();
        assert_eq!(kind(send_error(SendError::Ended)), "cancelled");
        assert_eq!(
            kind(send_error(SendError::UnknownCommit {
                writer: WriterId(1),
                c: Counter(2)
            })),
            "not_found"
        );
        assert_eq!(
            kind(send_error(SendError::SeqRegression {
                seq: Counter(1),
                current: Counter(2)
            })),
            "conflict"
        );
        assert_eq!(
            kind(send_error(SendError::TooLarge { size: 2, limit: 1 })),
            "bad_args"
        );
        assert_eq!(
            kind(send_error(SendError::SnapshotTooLarge { size: 2 })),
            "bad_args"
        );
        assert_eq!(kind(renew_error(RenewError::Ended)), "cancelled");
        assert_eq!(
            kind(renew_error(RenewError::WriterConnected)),
            "already_exists"
        );
        assert_eq!(
            kind(renew_error(RenewError::Unavailable("qr".into()))),
            "internal"
        );
        assert_eq!(kind(start_error(StartError::InvalidDocument)), "bad_args");
        assert_eq!(
            kind(start_error(StartError::SnapshotTooLarge { size: 1 })),
            "bad_args"
        );
        assert_eq!(
            kind(start_error(StartError::Bind {
                addr: "192.168.1.2:4000".parse().unwrap(),
                source: std::io::Error::other("in use"),
            })),
            "io"
        );
        assert_eq!(kind(start_error(StartError::InvalidHostName)), "internal");
    }

    #[test]
    fn every_error_reads_in_italian_and_in_english() {
        let log = Arc::new(Mutex::new(Log::default()));
        let sessions = LiveSessions::default();
        register(&sessions, "main", "a.svg", FakeHost::new('B', &log)).unwrap();
        let errors = [
            register(&sessions, "main", "a.svg", FakeHost::new('C', &log)).unwrap_err(),
            sessions.status("main", "CAAAAAAAAAA").unwrap_err(),
            choose_address(&[], None).unwrap_err(),
            choose_address(&[], Some(Ipv4Addr::new(192, 168, 1, 2))).unwrap_err(),
            start_error(StartError::InvalidDocument),
            start_error(StartError::SnapshotTooLarge { size: 1 }),
            start_error(StartError::Bind {
                addr: "192.168.1.2:4000".parse().unwrap(),
                source: std::io::Error::other("in use"),
            }),
            start_error(StartError::InvalidHostName),
            send_error(SendError::Ended),
            send_error(SendError::UnknownCommit {
                writer: WriterId(1),
                c: Counter(2),
            }),
            send_error(SendError::SeqRegression {
                seq: Counter(1),
                current: Counter(2),
            }),
            send_error(SendError::TooLarge { size: 2, limit: 1 }),
            send_error(SendError::SnapshotTooLarge { size: 2 }),
            renew_error(RenewError::WriterConnected),
            renew_error(RenewError::Unavailable("qr".into())),
        ];
        let catalogs = fub_host::settings::core_catalog_assembled();
        for language in ["it", "en"] {
            for error in &errors {
                let Text::Message(message) = error.message() else {
                    panic!("{error:?} is not a catalog key");
                };
                let template = catalogs
                    .iter()
                    .filter(|catalog| catalog.locale == language)
                    .find_map(|catalog| catalog.entries.get(&message.key))
                    .unwrap_or_else(|| panic!("{} has no {language} text", message.key));
                // Ogni argomento ha il suo posto, e ogni posto il suo argomento.
                let places = template.matches('{').count();
                assert_eq!(places, message.args.len(), "{language} {}", message.key);
                for arg in &message.args {
                    assert!(
                        template.contains(&format!("{{{}}}", arg.name)),
                        "{language} {} has no {{{}}}",
                        message.key,
                        arg.name
                    );
                }
            }
        }
    }
}
