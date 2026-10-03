//! La coda dei messaggi verso una connessione dello scrittore.
//!
//! La sessione ci scrive sotto il proprio lucchetto, così l'ordine dei
//! messaggi è quello in cui la sessione li ha decisi: `welcome`, `snapshot` e
//! registro non si mescolano con un `ack` della shell arrivato nel frattempo.
//! Il compito della connessione li legge e li manda.
//!
//! La coda ha un tetto in byte e in messaggi: una connessione che non legge
//! non fa crescere la memoria dell'host. Oltre il tetto la coda si svuota e la
//! connessione si chiude con 1001: lo scrittore torna con la ripresa e riceve
//! uno snapshot nuovo.

use std::collections::VecDeque;

use parking_lot::Mutex;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Utf8Bytes;

use super::events::LeaveReason;
use crate::limits::{OUTBOX_BYTES, OUTBOX_ITEMS};
use crate::protocol::CloseCode;

/// Che cosa contiene un messaggio in coda: uno snapshot nuovo rende inutili
/// gli snapshot e le operazioni che lo precedono.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Snapshot,
    Ops,
    Other,
}

/// La richiesta di chiudere la connessione.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloseRequest {
    /// Il codice di chiusura.
    pub(crate) code: CloseCode,
    /// Il dettaglio per lo scrittore, in inglese.
    pub(crate) detail: String,
    /// Perché, per l'evento della shell.
    pub(crate) reason: LeaveReason,
    /// Prima si mandano i messaggi in coda.
    pub(crate) drain: bool,
}

struct State {
    items: VecDeque<(Kind, Utf8Bytes)>,
    bytes: usize,
    close: Option<CloseRequest>,
}

pub(crate) struct Outbox {
    state: Mutex<State>,
    notify: Notify,
}

/// Il prossimo passo del compito che scrive.
pub(crate) enum Next {
    Send(Utf8Bytes),
    Close(CloseRequest),
    Wait,
}

impl Outbox {
    pub(crate) fn new() -> Outbox {
        Outbox {
            state: Mutex::new(State {
                items: VecDeque::new(),
                bytes: 0,
                close: None,
            }),
            notify: Notify::new(),
        }
    }

    /// Accoda un messaggio. Dopo una richiesta di chiusura non accoda più.
    pub(crate) fn push(&self, kind: Kind, text: Utf8Bytes) {
        let mut state = self.state.lock();
        if state.close.is_some() {
            return;
        }
        if kind == Kind::Snapshot {
            // Lo snapshot contiene già tutto ciò che gli snapshot e le
            // operazioni in coda porterebbero.
            state.items.retain(|(queued, _)| *queued == Kind::Other);
            state.bytes = state.items.iter().map(|(_, text)| text.len()).sum();
        }
        state.bytes += text.len();
        state.items.push_back((kind, text));
        if state.bytes > OUTBOX_BYTES || state.items.len() > OUTBOX_ITEMS {
            state.items.clear();
            state.bytes = 0;
            state.close = Some(CloseRequest {
                code: CloseCode::HostClosing,
                detail: "the connection is too slow for the session".into(),
                reason: LeaveReason::Congested,
                drain: false,
            });
        }
        drop(state);
        self.notify.notify_one();
    }

    /// Chiede la chiusura. Vale la prima richiesta.
    pub(crate) fn close(&self, request: CloseRequest) {
        let mut state = self.state.lock();
        if state.close.is_none() {
            if !request.drain {
                state.items.clear();
                state.bytes = 0;
            }
            state.close = Some(request);
        }
        drop(state);
        self.notify.notify_one();
    }

    /// Il prossimo messaggio, o la chiusura quando la coda da mandare è vuota.
    pub(crate) fn next(&self) -> Next {
        let mut state = self.state.lock();
        if let Some((_, text)) = state.items.pop_front() {
            state.bytes -= text.len();
            return Next::Send(text);
        }
        match &state.close {
            Some(request) => Next::Close(request.clone()),
            None => Next::Wait,
        }
    }

    /// Aspetta un messaggio o una chiusura. Il permesso di `Notify` resta se
    /// arriva fra `next` e l'attesa.
    pub(crate) async fn changed(&self) {
        self.notify.notified().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(outbox: &Outbox) -> Vec<String> {
        let mut out = Vec::new();
        while let Next::Send(text) = outbox.next() {
            out.push(text.as_str().to_owned());
        }
        out
    }

    #[test]
    fn a_snapshot_supersedes_queued_snapshots_and_ops_but_not_answers() {
        let outbox = Outbox::new();
        outbox.push(Kind::Other, "welcome".into());
        outbox.push(Kind::Snapshot, "s1".into());
        outbox.push(Kind::Ops, "o1".into());
        outbox.push(Kind::Other, "ack".into());
        outbox.push(Kind::Snapshot, "s2".into());
        assert_eq!(texts(&outbox), ["welcome", "ack", "s2"]);
    }

    #[test]
    fn an_overflowing_queue_empties_and_asks_for_1001() {
        let outbox = Outbox::new();
        for _ in 0..=OUTBOX_ITEMS {
            outbox.push(Kind::Other, "x".into());
        }
        match outbox.next() {
            Next::Close(request) => {
                assert_eq!(request.code, CloseCode::HostClosing);
                assert_eq!(request.reason, LeaveReason::Congested);
            }
            _ => panic!("the queue should ask to close"),
        }
        outbox.push(Kind::Other, "late".into());
        assert!(matches!(outbox.next(), Next::Close(_)));
    }

    #[test]
    fn a_draining_close_sends_the_queue_first() {
        let outbox = Outbox::new();
        outbox.push(Kind::Other, "bye".into());
        let request = CloseRequest {
            code: CloseCode::HostClosing,
            detail: String::new(),
            reason: LeaveReason::SessionEnded,
            drain: true,
        };
        outbox.close(request.clone());
        assert!(matches!(outbox.next(), Next::Send(text) if text.as_str() == "bye"));
        assert!(matches!(outbox.next(), Next::Close(r) if r == request));
        let other = Outbox::new();
        other.push(Kind::Other, "lost".into());
        other.close(CloseRequest {
            drain: false,
            ..request
        });
        assert!(matches!(other.next(), Next::Close(_)));
    }
}
