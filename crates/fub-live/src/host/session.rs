//! Lo stato della sessione, senza I/O: l'abbinamento, lo scrittore, i commit
//! in attesa della shell e il registro che serve a chi entra.
//!
//! Ogni metodo è una transizione sincrona sotto il lucchetto della sessione, e
//! ogni connessione si presenta con il proprio id: un compito in ritardo, una
//! connessione già sostituita o chiusa, non tocca lo stato di quella nuova
//! (ADR 0193). Le uscite sono due code: gli eventi della shell e la coda della
//! connessione, entrambe riempite sotto lo stesso lucchetto, così l'ordine
//! dei messaggi è l'ordine delle decisioni.
//!
//! Il commit resta in attesa finché la shell non risponde (ADR 0184). Il
//! `lastC` del `welcome` dice allo scrittore quali commit l'host ha già
//! trattato: quelli prima del primo commit ancora in attesa, o tutti i
//! ricevuti se nessuno aspetta. Le risposte arrivate fuori ordine, sopra
//! `lastC`, si ricordano e si rimandano quando lo scrittore rimanda il commit;
//! i `nack` sotto `lastC` si rimandano dopo ogni `welcome`, perché lo scrittore
//! quei commit non li rimanda e senza il `nack` non saprebbe del rifiuto.

use std::collections::{BTreeMap, VecDeque};
use std::net::SocketAddrV4;
use std::sync::Arc;

use ring::rand::SystemRandom;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Utf8Bytes;

use super::api::{
    LiveStatus, Pairing, PendingCommit, SendError, ShellMessage, Stats, WriterStatus,
};
use super::events::{EndReason, EventQueue, LeaveReason, LiveEvent, ReleaseReason};
use super::outbox::{CloseRequest, Kind, Outbox};
use crate::clock::{wall_clock_ms, HostClock};
use crate::counter::{Counter, WriterId};
use crate::limits::{
    Limits, LOG_HARD_BYTES, LOG_SOFT_BYTES, MAX_MESSAGE, MAX_PENDING_BYTES, MAX_PENDING_COMMITS,
    MAX_SNAPSHOT, PAIRING_TTL, RATE_COOLDOWN, RESUME_WINDOW, RETAINED_NACKS,
};
use crate::pairing::{qr_svg, PairingTarget, QrTooLong};
use crate::protocol::{
    encode_snapshot, Ack, Caps, CloseCode, Credential, Device, DocumentInfo, Hello, HostMessage,
    Nack, NackReason, Ops, OpsMessage, Pong, Violation, Welcome, WriterMessage,
};
use crate::token::{Fingerprint, PairingSecret, RandomUnavailable, ResumeToken, SessionId};

/// L'id di una connessione: cresce a ogni socket accettato e non torna.
pub(crate) type ConnId = u64;

/// Il dettaglio di un `nack` della shell: lo stesso limite che il client
/// applica ai testi liberi dell'host.
const MAX_DETAIL: usize = 64 * 1024;

/// Il QR in corso.
struct Offer {
    secret: PairingSecret,
    expires: Instant,
    pairing: Pairing,
}

/// Una risposta già data, da rimandare se lo scrittore rimanda il commit.
struct Answer {
    text: Utf8Bytes,
    nack: bool,
}

/// La connessione in corso dello scrittore.
struct Connection {
    id: ConnId,
    outbox: Arc<Outbox>,
    /// È arrivato il primo messaggio dopo il `welcome`: il gettone precedente
    /// non vale più.
    confirmed: bool,
    /// L'ultimo `c` ricevuto su questa connessione: crescono.
    last_c: Option<Counter>,
}

/// L'abbinamento dello scrittore: sopravvive alla connessione per la finestra
/// della ripresa.
struct Binding {
    id: WriterId,
    device: Device,
    caps: Caps,
    token: ResumeToken,
    /// Il gettone usato per l'ultima ripresa, valido finché la nuova
    /// connessione non manda il primo messaggio («Ripresa» in
    /// `docs/reference/live-session.md`).
    previous: Option<ResumeToken>,
    connection: Option<Connection>,
    disconnected_at: Option<Instant>,
    cooldown_until: Option<Instant>,
    /// Il `c` più alto ricevuto e trattato: inoltrato alla shell o rifiutato
    /// dall'host.
    max_received: Counter,
    /// L'ultimo `lastC` mandato: non torna indietro.
    last_c: Counter,
    answers: BTreeMap<Counter, Answer>,
    answers_bytes: usize,
    clock: HostClock,
}

/// Lo stato del registro delle operazioni dopo l'ultimo snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LogState {
    /// Chi entra riceve snapshot e registro.
    Fresh,
    /// Il registro ha superato la soglia morbida: la shell sa che serve uno
    /// snapshot.
    Wanted,
    /// Il registro ha superato la soglia dura e si è buttato: chi entra
    /// aspetta il prossimo snapshot.
    Stale,
}

/// Ciò che serve a far partire la sessione.
pub(crate) struct Setup {
    pub(crate) id: SessionId,
    pub(crate) addr: SocketAddrV4,
    pub(crate) fingerprint: Fingerprint,
    pub(crate) host_name: Option<String>,
    pub(crate) document: DocumentInfo,
    /// Il contatore dello snapshot iniziale.
    pub(crate) seq: Counter,
    /// Il messaggio dello snapshot iniziale, già nei limiti.
    pub(crate) snapshot: Utf8Bytes,
}

/// Il QR non si è potuto preparare.
#[derive(Debug, thiserror::Error)]
pub(crate) enum OfferError {
    #[error(transparent)]
    Random(#[from] RandomUnavailable),
    #[error(transparent)]
    Qr(#[from] QrTooLong),
}

/// Perché un QR nuovo non si può fare.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RenewError {
    /// La sessione è finita.
    #[error("the live session has ended")]
    Ended,
    /// Uno scrittore è collegato: un secondo non entrerebbe (4003).
    #[error("a writer is connected to the session")]
    WriterConnected,
    /// Il generatore casuale o il QR hanno fallito.
    #[error("the pairing could not be prepared: {0}")]
    Unavailable(String),
}

pub(crate) struct Session {
    id: SessionId,
    addr: SocketAddrV4,
    fingerprint: Fingerprint,
    host_name: Option<String>,
    document: DocumentInfo,
    ended: Option<EndReason>,
    offer: Option<Offer>,
    writer: Option<Binding>,
    next_writer: u64,
    seq: Counter,
    snapshot: Utf8Bytes,
    log: VecDeque<Utf8Bytes>,
    log_bytes: usize,
    log_state: LogState,
    pending: BTreeMap<(WriterId, Counter), Ops>,
    pending_bytes: usize,
    stats: Stats,
    events: Arc<EventQueue>,
}

/// La connessione `conn` dello scrittore, se è quella in corso.
fn current(writer: &mut Option<Binding>, conn: ConnId) -> Option<&mut Binding> {
    writer
        .as_mut()
        .filter(|binding| binding.connection.as_ref().is_some_and(|c| c.id == conn))
}

fn millis_until(deadline: Instant, now: Instant) -> u32 {
    u32::try_from(deadline.saturating_duration_since(now).as_millis()).unwrap_or(u32::MAX)
}

impl Session {
    pub(crate) fn new(
        setup: Setup,
        events: Arc<EventQueue>,
        rng: &SystemRandom,
        now: Instant,
    ) -> Result<Session, OfferError> {
        let mut session = Session {
            id: setup.id,
            addr: setup.addr,
            fingerprint: setup.fingerprint,
            host_name: setup.host_name,
            document: setup.document,
            ended: None,
            offer: None,
            writer: None,
            next_writer: 1,
            seq: setup.seq,
            snapshot: setup.snapshot,
            log: VecDeque::new(),
            log_bytes: 0,
            log_state: LogState::Fresh,
            pending: BTreeMap::new(),
            pending_bytes: 0,
            stats: Stats::default(),
            events,
        };
        session.offer = Some(session.new_offer(rng, now)?);
        Ok(session)
    }

    fn new_offer(&self, rng: &SystemRandom, now: Instant) -> Result<Offer, OfferError> {
        let secret = PairingSecret::generate(rng)?;
        let target = PairingTarget {
            addr: self.addr,
            session: self.id,
            secret: secret.clone(),
            fingerprint: self.fingerprint,
            host_name: self.host_name.clone(),
        };
        let payload = target.to_payload();
        let svg = qr_svg(&payload)?;
        let expires = now + PAIRING_TTL;
        Ok(Offer {
            secret,
            expires,
            pairing: Pairing {
                payload,
                qr_svg: svg,
                expires_in_ms: millis_until(expires, now),
            },
        })
    }

    // --- Le connessioni ---------------------------------------------------

    /// Un socket accettato.
    pub(crate) fn accepted(&mut self) {
        self.stats.accepted += 1;
    }

    /// Un socket chiuso appena accettato.
    pub(crate) fn refused(&mut self) {
        self.stats.refused += 1;
    }

    /// Una connessione chiusa prima del `welcome`.
    pub(crate) fn rejected(&mut self) {
        self.stats.rejected += 1;
    }

    /// Il `hello` di una connessione. Se lo accetta, accoda `welcome`,
    /// snapshot, registro e `nack` da rimandare, e la connessione diventa
    /// quella dello scrittore.
    pub(crate) fn admit(
        &mut self,
        hello: Hello,
        conn: ConnId,
        outbox: &Arc<Outbox>,
        rng: &SystemRandom,
        now: Instant,
    ) -> Result<WriterId, Violation> {
        if self.ended.is_some() {
            return Err(Violation::new(
                CloseCode::HostClosing,
                "the live session is ending",
            ));
        }
        // L'ordine dei controlli è quello di «Ingresso»: versione (già letta
        // con il `hello`), sessione, scrittore presente, segreto.
        if !SessionId::parse(&hello.session).is_some_and(|id| id.matches(&self.id)) {
            return Err(Violation::new(CloseCode::UnknownSession, "unknown session"));
        }
        let fresh = ResumeToken::generate(rng).map_err(|_| {
            Violation::new(
                CloseCode::HostClosing,
                "the host cannot generate a resume token",
            )
        })?;
        let resumed = match &hello.credential {
            Credential::Secret(text) => {
                if self.writer.is_some() {
                    return Err(Violation::new(
                        CloseCode::WriterPresent,
                        "another writer is paired with this session",
                    ));
                }
                let offer = self
                    .offer
                    .as_ref()
                    .filter(|offer| now < offer.expires)
                    .ok_or_else(|| {
                        Violation::new(
                            CloseCode::SecretRejected,
                            "the pairing secret expired or was used",
                        )
                    })?;
                let valid =
                    PairingSecret::parse(text).is_some_and(|secret| secret.matches(&offer.secret));
                if !valid {
                    return Err(Violation::new(
                        CloseCode::SecretRejected,
                        "the pairing secret is wrong",
                    ));
                }
                self.offer = None;
                let id = WriterId(self.next_writer);
                self.next_writer += 1;
                self.writer = Some(Binding {
                    id,
                    device: hello.device.clone(),
                    caps: hello.caps,
                    token: fresh,
                    previous: None,
                    connection: None,
                    disconnected_at: None,
                    cooldown_until: None,
                    max_received: Counter(0),
                    last_c: Counter(0),
                    answers: BTreeMap::new(),
                    answers_bytes: 0,
                    clock: HostClock::default(),
                });
                false
            }
            Credential::Resume(text) => {
                let rejected =
                    || Violation::new(CloseCode::SecretRejected, "the resume token is not valid");
                let binding = self.writer.as_mut().ok_or_else(rejected)?;
                let token = ResumeToken::parse(text).ok_or_else(rejected)?;
                // Entrambi i confronti, sempre: il tempo non dice quale dei due
                // gettoni era quello giusto.
                let current = token.matches(&binding.token);
                let previous = binding
                    .previous
                    .as_ref()
                    .is_some_and(|old| token.matches(old));
                if !(current | previous) {
                    return Err(rejected());
                }
                if binding
                    .disconnected_at
                    .is_some_and(|at| now >= at + RESUME_WINDOW)
                {
                    return Err(Violation::new(
                        CloseCode::SecretRejected,
                        "the resume window has passed",
                    ));
                }
                if binding.cooldown_until.is_some_and(|until| now < until) {
                    return Err(Violation::new(
                        CloseCode::TooMuchTraffic,
                        "wait 5 seconds after 4006 before resuming",
                    ));
                }
                // Una ripresa valida prende il posto della connessione in
                // corso, anche se l'host non si è accorto che era caduta. Per
                // la shell è una caduta seguita da una ripresa.
                if let Some(old) = binding.connection.take() {
                    old.outbox.close(CloseRequest {
                        code: CloseCode::WriterPresent,
                        detail: "replaced by a newer connection of the same writer".into(),
                        reason: LeaveReason::Lost,
                        drain: false,
                    });
                    self.events.push(LiveEvent::WriterDisconnected {
                        writer: binding.id,
                        reason: LeaveReason::Lost,
                        resumable: true,
                    });
                }
                binding.previous = Some(token);
                binding.token = fresh;
                binding.device = hello.device.clone();
                binding.caps = hello.caps;
                binding.disconnected_at = None;
                binding.cooldown_until = None;
                true
            }
        };

        let Some(binding) = self.writer.as_mut() else {
            return Err(Violation::new(
                CloseCode::HostClosing,
                "the writer binding vanished",
            ));
        };
        let last_c = last_c(binding, &self.pending);
        binding.last_c = last_c;
        prune(binding, &self.pending);
        let welcome = HostMessage::Welcome(Welcome {
            session: self.id,
            resume: binding.token.clone(),
            doc: self.document.clone(),
            limits: Limits::V1,
            seq: self.seq,
            last_c,
        });
        outbox.push(Kind::Other, welcome.to_json().into());
        if self.log_state == LogState::Stale {
            // Il registro non basta più a ricostruire il documento: lo
            // scrittore riceve il prossimo snapshot della shell.
            self.events.push(LiveEvent::SnapshotWanted);
        } else {
            outbox.push(Kind::Snapshot, self.snapshot.clone());
            for ops in &self.log {
                outbox.push(Kind::Ops, ops.clone());
            }
        }
        for answer in binding.answers.range(..=last_c).map(|(_, answer)| answer) {
            if answer.nack {
                outbox.push(Kind::Other, answer.text.clone());
            }
        }
        binding.connection = Some(Connection {
            id: conn,
            outbox: outbox.clone(),
            confirmed: false,
            last_c: None,
        });
        self.stats.admitted += 1;
        let writer = binding.id;
        self.events.push(LiveEvent::WriterConnected {
            writer,
            device: binding.device.clone(),
            caps: binding.caps,
            resumed,
        });
        Ok(writer)
    }

    /// Un messaggio dello scrittore dopo il `welcome`. Il `bye` lo tratta la
    /// connessione, che chiude.
    pub(crate) fn inbound(
        &mut self,
        conn: ConnId,
        message: WriterMessage,
    ) -> Result<(), Violation> {
        let Some(binding) = current(&mut self.writer, conn) else {
            return Ok(());
        };
        if let Some(connection) = binding.connection.as_mut() {
            if !connection.confirmed {
                connection.confirmed = true;
                binding.previous = None;
            }
        }
        match message {
            WriterMessage::InkBegin(begin) => self.events.push(LiveEvent::InkBegin(begin)),
            WriterMessage::InkPoints(points) => self.events.push(LiveEvent::InkPoints(points)),
            WriterMessage::InkEnd(s) => self.events.push(LiveEvent::InkEnd { s }),
            WriterMessage::InkCancel(s) => self.events.push(LiveEvent::InkCancel { s }),
            WriterMessage::View(view) => self.events.push(LiveEvent::View(view)),
            WriterMessage::Ping(ping) => {
                let b = wall_clock_ms();
                let pong = HostMessage::Pong(Pong {
                    id: ping.id,
                    a: ping.a,
                    b,
                });
                if let Some(connection) = &binding.connection {
                    connection.outbox.push(Kind::Other, pong.to_json().into());
                }
                if let Some(estimate) = binding.clock.ping(ping.a, b) {
                    self.events.push(LiveEvent::Clock(estimate));
                }
            }
            WriterMessage::Commit(commit) => return self.commit(conn, commit.c, Ok(commit.ops)),
            WriterMessage::Hello(_) | WriterMessage::Bye => {}
        }
        Ok(())
    }

    /// Un commit oltre i limiti delle operazioni: l'host lo rifiuta da sé con
    /// `limit`.
    pub(crate) fn commit_over_limit(
        &mut self,
        conn: ConnId,
        c: Counter,
        detail: String,
    ) -> Result<(), Violation> {
        self.commit(conn, c, Err(detail))
    }

    /// Un commit: le operazioni, o il dettaglio del rifiuto per i limiti.
    fn commit(
        &mut self,
        conn: ConnId,
        c: Counter,
        ops: Result<Ops, String>,
    ) -> Result<(), Violation> {
        let Some(binding) = current(&mut self.writer, conn) else {
            return Ok(());
        };
        let Some(connection) = binding.connection.as_mut() else {
            return Ok(());
        };
        if let Some(last) = connection.last_c.filter(|last| c <= *last) {
            return Err(Violation::new(
                CloseCode::InvalidPayload,
                format!("commit {c} does not follow commit {last}"),
            ));
        }
        connection.last_c = Some(c);
        let outbox = connection.outbox.clone();
        self.stats.commits += 1;
        let writer = binding.id;
        if let Some(waiting) = self.pending.get(&(writer, c)) {
            // Rimandato dopo una ripresa, ancora in attesa: la risposta
            // arriverà. Con altre operazioni non è lo stesso commit.
            return if ops.as_ref().ok() == Some(waiting) {
                Ok(())
            } else {
                Err(Violation::new(
                    CloseCode::InvalidPayload,
                    format!("commit {c} was sent again with different operations"),
                ))
            };
        }
        if let Some(answer) = binding.answers.get(&c) {
            outbox.push(Kind::Other, answer.text.clone());
            return Ok(());
        }
        // Il `welcome` ha detto che fino a `lastC` è tutto trattato: un commit
        // lì sotto, senza una risposta da rimandare, è già nel documento, e
        // ripassarlo alla shell lo applicherebbe due volte.
        if c <= binding.last_c {
            return Err(Violation::new(
                CloseCode::InvalidPayload,
                format!("commit {c} is at or below lastC {}", binding.last_c),
            ));
        }
        let ops = match ops {
            Ok(ops) => ops,
            Err(detail) => {
                let nack = HostMessage::Nack(Nack {
                    c,
                    reason: NackReason::Limit,
                    detail,
                    index: None,
                });
                let text = Utf8Bytes::from(nack.to_json());
                outbox.push(Kind::Other, text.clone());
                binding.max_received = binding.max_received.max(c);
                remember(binding, c, Answer { text, nack: true });
                prune(binding, &self.pending);
                return Ok(());
            }
        };
        if self.pending.len() >= MAX_PENDING_COMMITS
            || self.pending_bytes + ops.byte_len() > MAX_PENDING_BYTES
        {
            return Err(Violation::new(
                CloseCode::TooMuchTraffic,
                "too many commits are waiting for the PC",
            ));
        }
        binding.max_received = binding.max_received.max(c);
        self.pending_bytes += ops.byte_len();
        self.pending.insert((writer, c), ops.clone());
        self.events.push(LiveEvent::Commit { writer, c, ops });
        Ok(())
    }

    /// Il giro di un heartbeat della connessione `conn`.
    pub(crate) fn heartbeat(&mut self, conn: ConnId, rtt: std::time::Duration) {
        if let Some(binding) = current(&mut self.writer, conn) {
            binding.clock.heartbeat(rtt);
        }
    }

    /// La connessione `conn` è finita. Se era quella dello scrittore,
    /// l'abbinamento aspetta la ripresa o finisce.
    pub(crate) fn closed(&mut self, conn: ConnId, reason: LeaveReason, now: Instant) {
        let Some(binding) = current(&mut self.writer, conn) else {
            return;
        };
        binding.connection = None;
        let writer = binding.id;
        let resumable = reason.resumable() && self.ended.is_none();
        if resumable {
            binding.disconnected_at = Some(now);
            if reason == LeaveReason::TooMuchTraffic {
                binding.cooldown_until = Some(now + RATE_COOLDOWN);
            }
        } else {
            self.writer = None;
        }
        self.events.push(LiveEvent::WriterDisconnected {
            writer,
            reason,
            resumable,
        });
    }

    // --- Il tempo ---------------------------------------------------------

    /// La prossima scadenza: il QR o la finestra della ripresa.
    pub(crate) fn next_deadline(&self) -> Option<Instant> {
        let offer = self.offer.as_ref().map(|offer| offer.expires);
        let resume = self
            .writer
            .as_ref()
            .and_then(|binding| binding.disconnected_at)
            .map(|at| at + RESUME_WINDOW);
        match (offer, resume) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    /// Applica le scadenze passate.
    pub(crate) fn tick(&mut self, now: Instant) {
        if self
            .offer
            .as_ref()
            .is_some_and(|offer| offer.expires <= now)
        {
            self.offer = None;
            self.events.push(LiveEvent::PairingExpired);
        }
        let expired = self
            .writer
            .as_ref()
            .and_then(|binding| binding.disconnected_at.map(|at| (binding.id, at)))
            .filter(|(_, at)| *at + RESUME_WINDOW <= now);
        if let Some((writer, _)) = expired {
            self.writer = None;
            self.events.push(LiveEvent::WriterReleased {
                writer,
                reason: ReleaseReason::ResumeExpired,
            });
        }
    }

    // --- La shell ---------------------------------------------------------

    /// Un messaggio della shell. Su errore lo stato non cambia, salvo lo
    /// snapshot troppo grande, che chiude la sessione in sola lettura.
    pub(crate) fn send(&mut self, message: ShellMessage) -> Result<(), SendError> {
        if self.ended.is_some() {
            return Err(SendError::Ended);
        }
        match message {
            ShellMessage::Ack {
                writer,
                c,
                seq,
                echo,
                duplicate,
            } => {
                if !self.pending.contains_key(&(writer, c)) {
                    return Err(SendError::UnknownCommit { writer, c });
                }
                if !duplicate && seq < self.seq {
                    return Err(SendError::SeqRegression {
                        seq,
                        current: self.seq,
                    });
                }
                let text = HostMessage::Ack(Ack {
                    c,
                    seq,
                    echo: echo.clone(),
                    duplicate,
                })
                .to_json();
                let log = if duplicate {
                    None
                } else {
                    Some(HostMessage::Ops(OpsMessage { seq, ops: echo }).to_json())
                };
                fits(&text)?;
                if let Some(log) = &log {
                    fits(log)?;
                }
                if let Some(log) = log {
                    self.seq = seq;
                    self.append_log(log.into());
                }
                self.answer(
                    writer,
                    c,
                    Answer {
                        text: text.into(),
                        nack: false,
                    },
                );
            }
            ShellMessage::Nack {
                writer,
                c,
                reason,
                detail,
                index,
            } => {
                if !self.pending.contains_key(&(writer, c)) {
                    return Err(SendError::UnknownCommit { writer, c });
                }
                if detail.len() > MAX_DETAIL {
                    return Err(SendError::TooLarge {
                        size: detail.len(),
                        limit: MAX_DETAIL,
                    });
                }
                let text = HostMessage::Nack(Nack {
                    c,
                    reason,
                    detail,
                    index,
                })
                .to_json();
                fits(&text)?;
                self.answer(
                    writer,
                    c,
                    Answer {
                        text: text.into(),
                        nack: true,
                    },
                );
            }
            ShellMessage::Ops { seq, ops } => {
                if seq < self.seq {
                    return Err(SendError::SeqRegression {
                        seq,
                        current: self.seq,
                    });
                }
                let text = Utf8Bytes::from(HostMessage::Ops(OpsMessage { seq, ops }).to_json());
                fits(&text)?;
                self.seq = seq;
                self.append_log(text.clone());
                self.to_writer(Kind::Ops, text);
            }
            ShellMessage::Snapshot { seq, text } => {
                if seq < self.seq {
                    return Err(SendError::SeqRegression {
                        seq,
                        current: self.seq,
                    });
                }
                // Un documento oltre i 20 MiB, o il cui messaggio con gli
                // escape supera il WebSocket, è in sola lettura («Limiti del
                // protocollo»).
                let message = (text.len() <= MAX_SNAPSHOT).then(|| encode_snapshot(seq, &text));
                let Some(message) = message.filter(|message| message.len() <= MAX_MESSAGE) else {
                    self.end(EndReason::ReadOnly);
                    return Err(SendError::SnapshotTooLarge { size: text.len() });
                };
                let message = Utf8Bytes::from(message);
                self.seq = seq;
                self.snapshot = message.clone();
                self.log.clear();
                self.log_bytes = 0;
                self.log_state = LogState::Fresh;
                self.to_writer(Kind::Snapshot, message);
            }
        }
        Ok(())
    }

    fn answer(&mut self, writer: WriterId, c: Counter, answer: Answer) {
        if let Some(ops) = self.pending.remove(&(writer, c)) {
            self.pending_bytes -= ops.byte_len();
        }
        self.stats.answered += 1;
        let Some(binding) = self.writer.as_mut().filter(|binding| binding.id == writer) else {
            // L'abbinamento è finito: la risposta non ha più a chi andare, ma le
            // operazioni sono nel documento e nel registro.
            return;
        };
        if let Some(connection) = &binding.connection {
            connection.outbox.push(Kind::Other, answer.text.clone());
        }
        remember(binding, c, answer);
        prune(binding, &self.pending);
    }

    fn to_writer(&self, kind: Kind, text: Utf8Bytes) {
        if let Some(connection) = self
            .writer
            .as_ref()
            .and_then(|binding| binding.connection.as_ref())
        {
            connection.outbox.push(kind, text);
        }
    }

    fn append_log(&mut self, text: Utf8Bytes) {
        if self.log_state == LogState::Stale {
            return;
        }
        self.log_bytes += text.len();
        self.log.push_back(text);
        if self.log_bytes > LOG_HARD_BYTES {
            self.log.clear();
            self.log_bytes = 0;
            self.log_state = LogState::Stale;
        } else if self.log_bytes > LOG_SOFT_BYTES && self.log_state == LogState::Fresh {
            self.log_state = LogState::Wanted;
            self.events.push(LiveEvent::SnapshotWanted);
        }
    }

    /// Un QR nuovo. Libera l'abbinamento di uno scrittore fuori dalla
    /// connessione, che non potrà più riprendere.
    pub(crate) fn renew_pairing(
        &mut self,
        rng: &SystemRandom,
        now: Instant,
    ) -> Result<Pairing, RenewError> {
        if self.ended.is_some() {
            return Err(RenewError::Ended);
        }
        if self
            .writer
            .as_ref()
            .is_some_and(|binding| binding.connection.is_some())
        {
            return Err(RenewError::WriterConnected);
        }
        let offer = self
            .new_offer(rng, now)
            .map_err(|error| RenewError::Unavailable(error.to_string()))?;
        if let Some(binding) = self.writer.take() {
            self.events.push(LiveEvent::WriterReleased {
                writer: binding.id,
                reason: ReleaseReason::PairingRenewed,
            });
        }
        let pairing = offer.pairing.clone();
        self.offer = Some(offer);
        Ok(pairing)
    }

    /// Il QR in corso, se il segreto vale ancora.
    pub(crate) fn pairing(&self, now: Instant) -> Option<Pairing> {
        self.offer
            .as_ref()
            .filter(|offer| now < offer.expires)
            .map(|offer| Pairing {
                expires_in_ms: millis_until(offer.expires, now),
                ..offer.pairing.clone()
            })
    }

    /// Chiude la sessione: niente più ingressi, e la connessione dello
    /// scrittore si chiude con il codice del motivo dopo i messaggi in coda.
    pub(crate) fn end(&mut self, reason: EndReason) {
        if self.ended.is_some() {
            return;
        }
        self.ended = Some(reason);
        self.offer = None;
        let (code, detail) = reason.close();
        if let Some(connection) = self
            .writer
            .as_ref()
            .and_then(|binding| binding.connection.as_ref())
        {
            connection.outbox.close(CloseRequest {
                code,
                detail: detail.into(),
                reason: LeaveReason::SessionEnded,
                drain: true,
            });
        }
    }

    pub(crate) fn end_reason(&self) -> Option<EndReason> {
        self.ended
    }

    pub(crate) fn pending(&self) -> Vec<PendingCommit> {
        self.pending
            .iter()
            .map(|((writer, c), ops)| PendingCommit {
                writer: *writer,
                c: *c,
                ops: ops.clone(),
            })
            .collect()
    }

    pub(crate) fn status(&self, now: Instant) -> LiveStatus {
        LiveStatus {
            ended: self.ended.is_some(),
            seq: self.seq,
            pairing_expires_in_ms: self.pairing(now).map(|pairing| pairing.expires_in_ms),
            writer: self.writer.as_ref().map(|binding| WriterStatus {
                writer: binding.id,
                device: binding.device.clone(),
                caps: binding.caps,
                connected: binding.connection.is_some(),
                resume_expires_in_ms: binding
                    .disconnected_at
                    .map(|at| millis_until(at + RESUME_WINDOW, now)),
                last_c: binding.last_c,
                clock: binding.clock.estimate(),
            }),
            pending: self.pending(),
            stats: self.stats,
        }
    }
}

/// Il testo sta in un messaggio WebSocket.
fn fits(text: &str) -> Result<(), SendError> {
    if text.len() > MAX_MESSAGE {
        Err(SendError::TooLarge {
            size: text.len(),
            limit: MAX_MESSAGE,
        })
    } else {
        Ok(())
    }
}

/// L'ultimo commit dello scrittore che l'host ha trattato: prima del primo
/// ancora in attesa, o l'ultimo ricevuto. Non torna sotto quello già detto.
fn last_c(binding: &Binding, pending: &BTreeMap<(WriterId, Counter), Ops>) -> Counter {
    let first_waiting = pending
        .range((binding.id, Counter(0))..=(binding.id, Counter(u64::MAX)))
        .next()
        .map(|((_, c), _)| *c);
    let treated = match first_waiting {
        // `c` parte da 1: il predecessore esiste.
        Some(c) => Counter(c.0.saturating_sub(1)),
        None => binding.max_received,
    };
    binding.last_c.max(treated)
}

fn remember(binding: &mut Binding, c: Counter, answer: Answer) {
    binding.answers_bytes += answer.text.len();
    if let Some(old) = binding.answers.insert(c, answer) {
        binding.answers_bytes -= old.text.len();
    }
}

/// Tiene delle risposte solo quelle che possono ancora servire, nei tetti di
/// memoria dei commit in attesa.
fn prune(binding: &mut Binding, pending: &BTreeMap<(WriterId, Counter), Ops>) {
    let last_c = last_c(binding, pending);
    // Un `ack` fino a `lastC` non serve: lo scrittore non rimanda quel commit,
    // e le operazioni gli arrivano con lo snapshot e il registro.
    let mut freed = 0;
    binding.answers.retain(|c, answer| {
        let keep = answer.nack || *c > last_c;
        if !keep {
            freed += answer.text.len();
        }
        keep
    });
    binding.answers_bytes -= freed;
    let old_nacks = binding.answers.range(..=last_c).count();
    let mut excess = old_nacks.saturating_sub(RETAINED_NACKS);
    while excess > 0
        || binding.answers.len() > MAX_PENDING_COMMITS + RETAINED_NACKS
        || binding.answers_bytes > MAX_PENDING_BYTES
    {
        let Some((_, answer)) = binding.answers.pop_first() else {
            break;
        };
        binding.answers_bytes -= answer.text.len();
        excess = excess.saturating_sub(1);
    }
}

impl LeaveReason {
    /// Lo scrittore può tornare con la ripresa.
    pub(crate) fn resumable(self) -> bool {
        matches!(
            self,
            LeaveReason::Lost
                | LeaveReason::Heartbeat
                | LeaveReason::Congested
                | LeaveReason::TooMuchTraffic
        )
    }
}
