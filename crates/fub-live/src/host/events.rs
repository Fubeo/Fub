//! Gli eventi dell'host verso la shell, e la coda che li raccoglie.
//!
//! La shell li riceve con un canale che non è autorevole (ADR 0184): ciò che
//! conta davvero — i commit — resta anche nello stato dell'host finché la
//! shell non risponde, e torna da `status`. La coda invece serve il ritmo: chi
//! la legge prende in un colpo tutto ciò che è arrivato dall'ultima lettura,
//! con i campioni consecutivi dello stesso tratto riuniti in un evento solo e
//! la vista sostituita dall'ultima. Così una shell che resta indietro disegna
//! tutti i campioni in un frame, senza buchi (§6).
//!
//! Una shell che non legge affatto non fa crescere la memoria senza misura:
//! oltre [`EVENT_INK_POINTS`] campioni l'inchiostro in coda si butta e resta un
//! `inkGap` con i tratti toccati. Il commit di quei tratti arriva lo stesso, e
//! lo sostituisce.

use std::collections::VecDeque;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use crate::clock::ClockEstimate;
use crate::counter::{Counter, WriterId};
use crate::limits::EVENT_INK_POINTS;
use crate::protocol::{Caps, CloseCode, Device, InkBegin, InkPoints, Ops, StrokeId, View};

/// Un evento della sessione per la shell. In JSON ha il tipo in `t`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LiveEvent {
    /// Uno scrittore è entrato, per la prima volta o con una ripresa.
    WriterConnected {
        /// L'abbinamento.
        writer: WriterId,
        /// Il dispositivo.
        device: Device,
        /// Le capacità della penna.
        caps: Caps,
        /// È una ripresa dello stesso abbinamento.
        resumed: bool,
    },
    /// La connessione dello scrittore si è chiusa.
    WriterDisconnected {
        /// L'abbinamento.
        writer: WriterId,
        /// Perché.
        reason: LeaveReason,
        /// Lo scrittore può tornare con la ripresa entro 2 minuti; se no
        /// l'abbinamento è finito.
        resumable: bool,
    },
    /// Uno scrittore fuori dalla connessione ha perso l'abbinamento: non può
    /// più tornare con la ripresa.
    WriterReleased {
        /// L'abbinamento.
        writer: WriterId,
        /// Perché.
        reason: ReleaseReason,
    },
    /// L'inizio di un tratto.
    InkBegin(InkBegin),
    /// I campioni di un tratto, riuniti se ne sono arrivati più messaggi.
    InkPoints(InkPoints),
    /// La fine di un tratto.
    InkEnd {
        /// Il tratto.
        s: StrokeId,
    },
    /// Un tratto annullato.
    InkCancel {
        /// Il tratto.
        s: StrokeId,
    },
    /// L'inchiostro in coda di questi tratti è stato buttato perché la shell
    /// non leggeva: l'overlay di questi tratti va cancellato.
    InkGap {
        /// I tratti toccati.
        strokes: Vec<StrokeId>,
    },
    /// La vista dello scrittore, l'ultima arrivata.
    View(View),
    /// Un commit da applicare. Resta in attesa nell'host finché la shell non
    /// risponde `ack` o `nack`.
    Commit {
        /// L'abbinamento.
        writer: WriterId,
        /// Il contatore del commit.
        c: Counter,
        /// Le operazioni, opache.
        ops: Ops,
    },
    /// Una nuova stima dello scarto fra gli orologi, l'ultima arrivata.
    Clock(ClockEstimate),
    /// Il segreto del QR è scaduto: per abbinare serve un QR nuovo.
    PairingExpired,
    /// Le operazioni dopo l'ultimo snapshot pesano troppo: l'host chiede uno
    /// snapshot nuovo, che serve a chi entra.
    SnapshotWanted,
    /// La sessione è finita. È l'ultimo evento.
    Ended {
        /// Perché.
        reason: EndReason,
    },
}

/// Perché una connessione dello scrittore si è chiusa.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LeaveReason {
    /// Il socket si è chiuso o è caduto.
    Lost,
    /// Due heartbeat senza risposta.
    Heartbeat,
    /// Lo scrittore ha salutato con `bye`.
    WriterBye,
    /// La sessione finisce.
    SessionEnded,
    /// La coda verso lo scrittore è piena: la connessione è troppo lenta.
    Congested,
    /// Troppo traffico (4006): troppi messaggi al secondo, o troppi commit in
    /// attesa della shell.
    TooMuchTraffic,
    /// Un messaggio fuori dal protocollo.
    Violation {
        /// Il codice di chiusura.
        code: u16,
    },
}

/// Perché un abbinamento è finito mentre lo scrittore era fuori.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReleaseReason {
    /// Sono passati 2 minuti dalla caduta senza una ripresa.
    ResumeExpired,
    /// La shell ha chiesto un QR nuovo.
    PairingRenewed,
}

/// Perché la sessione finisce. È anche il motivo che la shell passa a
/// [`LiveHost::stop`](super::LiveHost::stop), e decide il codice con cui si
/// chiude la connessione dello scrittore.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EndReason {
    /// L'host chiude: l'app, la finestra, o il `LiveHost` lasciato cadere.
    /// Lo scrittore riceve `bye` e 1001.
    HostClosing,
    /// L'utente ha premuto «Termina». Lo scrittore riceve `bye` e 1000, e non
    /// riprova.
    Terminated,
    /// Il documento è stato chiuso: 4005.
    DocumentClosed,
    /// Il documento è in sola lettura o oltre i limiti: 4008.
    ReadOnly,
}

impl EndReason {
    /// Il codice e il dettaglio della chiusura.
    pub(crate) fn close(self) -> (CloseCode, &'static str) {
        match self {
            EndReason::HostClosing => (CloseCode::HostClosing, "the host is closing the session"),
            EndReason::Terminated => (CloseCode::Normal, "the session was terminated on the PC"),
            EndReason::DocumentClosed => (
                CloseCode::DocumentClosed,
                "the document was closed on the PC",
            ),
            EndReason::ReadOnly => (
                CloseCode::ReadOnly,
                "the document is read-only or beyond the session limits",
            ),
        }
    }
}

struct Queue {
    events: VecDeque<LiveEvent>,
    ink_points: usize,
    closed: bool,
}

/// La coda condivisa fra la sessione, che scrive, e la shell, che legge.
pub(crate) struct EventQueue {
    queue: Mutex<Queue>,
    notify: Notify,
}

impl EventQueue {
    pub(crate) fn new() -> Arc<EventQueue> {
        Arc::new(EventQueue {
            queue: Mutex::new(Queue {
                events: VecDeque::new(),
                ink_points: 0,
                closed: false,
            }),
            notify: Notify::new(),
        })
    }

    /// Accoda un evento, riunendolo con quello in coda se si può.
    pub(crate) fn push(&self, event: LiveEvent) {
        let mut queue = self.queue.lock();
        if queue.closed {
            return;
        }
        match event {
            LiveEvent::InkPoints(points) => {
                queue.ink_points += points.pts.len();
                match queue.events.back_mut() {
                    Some(LiveEvent::InkPoints(last)) if last.s == points.s => {
                        last.pts.extend_from_slice(&points.pts);
                    }
                    _ => queue.events.push_back(LiveEvent::InkPoints(points)),
                }
                if queue.ink_points > EVENT_INK_POINTS {
                    drop_ink(&mut queue);
                }
            }
            // La vista e l'orologio valgono solo nell'ultima versione: la nuova
            // prende il posto di quella in coda.
            LiveEvent::View(_) | LiveEvent::Clock(_) => {
                let same = std::mem::discriminant(&event);
                match queue
                    .events
                    .iter_mut()
                    .find(|queued| std::mem::discriminant(*queued) == same)
                {
                    Some(slot) => *slot = event,
                    None => queue.events.push_back(event),
                }
            }
            other => queue.events.push_back(other),
        }
        drop(queue);
        self.notify.notify_one();
    }

    /// Accoda l'ultimo evento e chiude la coda: chi legge riceve ciò che resta
    /// e poi la fine.
    pub(crate) fn close_with(&self, last: Option<LiveEvent>) {
        let mut queue = self.queue.lock();
        if !queue.closed {
            if let Some(event) = last {
                queue.events.push_back(event);
            }
            queue.closed = true;
        }
        drop(queue);
        self.notify.notify_one();
    }

    fn take(&self) -> Taken {
        let mut queue = self.queue.lock();
        if !queue.events.is_empty() {
            queue.ink_points = 0;
            return Taken::Events(queue.events.drain(..).collect());
        }
        if queue.closed {
            Taken::Closed
        } else {
            Taken::Empty
        }
    }

    fn abandon(&self) {
        let mut queue = self.queue.lock();
        queue.closed = true;
        queue.events.clear();
        queue.ink_points = 0;
    }
}

enum Taken {
    Events(Vec<LiveEvent>),
    Empty,
    Closed,
}

/// Butta l'inchiostro in coda e lascia al suo posto un `inkGap`.
fn drop_ink(queue: &mut Queue) {
    let mut strokes: Vec<StrokeId> = Vec::new();
    let mut note = |stroke: StrokeId| {
        if !strokes.contains(&stroke) {
            strokes.push(stroke);
        }
    };
    queue.events.retain(|event| match event {
        LiveEvent::InkBegin(begin) => {
            note(begin.s);
            false
        }
        LiveEvent::InkPoints(points) => {
            note(points.s);
            false
        }
        LiveEvent::InkEnd { s } | LiveEvent::InkCancel { s } => {
            note(*s);
            false
        }
        LiveEvent::InkGap { strokes: earlier } => {
            for stroke in earlier {
                note(*stroke);
            }
            false
        }
        _ => true,
    });
    queue.ink_points = 0;
    queue.events.push_back(LiveEvent::InkGap { strokes });
}

/// Il lato della shell: gli eventi della sessione, a gruppi.
pub struct LiveEvents {
    queue: Arc<EventQueue>,
}

impl LiveEvents {
    pub(crate) fn new(queue: Arc<EventQueue>) -> LiveEvents {
        LiveEvents { queue }
    }

    /// Aspetta e restituisce tutti gli eventi arrivati dall'ultima lettura,
    /// nell'ordine d'arrivo. `None` quando la sessione è finita e la coda è
    /// vuota: l'ultimo gruppo contiene [`LiveEvent::Ended`].
    pub async fn recv(&mut self) -> Option<Vec<LiveEvent>> {
        loop {
            // Il permesso di `Notify` resta se una notifica arriva fra la
            // lettura e l'attesa: nessun evento si perde in quel varco.
            let notified = self.queue.notify.notified();
            match self.queue.take() {
                Taken::Events(events) => return Some(events),
                Taken::Closed => return None,
                Taken::Empty => notified.await,
            }
        }
    }

    /// Gli eventi già arrivati, senza aspettare. Vuoto se non ce ne sono.
    pub fn try_recv(&mut self) -> Vec<LiveEvent> {
        match self.queue.take() {
            Taken::Events(events) => events,
            Taken::Empty | Taken::Closed => Vec::new(),
        }
    }
}

impl Drop for LiveEvents {
    fn drop(&mut self) {
        // Nessuno legge più: gli eventi successivi non si accumulano.
        self.queue.abandon();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Tool;

    fn stroke(id: &str) -> StrokeId {
        StrokeId::parse(id).unwrap()
    }

    fn points(id: &str, count: usize) -> LiveEvent {
        LiveEvent::InkPoints(InkPoints {
            s: stroke(id),
            pts: vec![[1.0, 2.0, 0.5, 3.0]; count],
        })
    }

    #[test]
    fn a_slow_reader_gets_every_sample_in_one_event() {
        let queue = EventQueue::new();
        let mut events = LiveEvents::new(queue.clone());
        queue.push(LiveEvent::InkBegin(InkBegin {
            s: stroke("oaaaaaaaa"),
            layer: "l00000000".into(),
            tool: Tool::Pen,
            fill: "#000000".into(),
            fill_opacity: 1.0,
            brush: "pf1".into(),
        }));
        for _ in 0..10 {
            queue.push(points("oaaaaaaaa", 3));
        }
        queue.push(LiveEvent::InkEnd {
            s: stroke("oaaaaaaaa"),
        });
        let batch = events.try_recv();
        assert_eq!(batch.len(), 3);
        assert!(matches!(&batch[1], LiveEvent::InkPoints(p) if p.pts.len() == 30));
        assert!(events.try_recv().is_empty());
    }

    #[test]
    fn the_last_view_and_clock_replace_the_queued_ones_in_place() {
        let queue = EventQueue::new();
        let mut events = LiveEvents::new(queue.clone());
        let view = |x: f64| {
            LiveEvent::View(View {
                x,
                y: 0.0,
                scale: 1.0,
                w: 1.0,
                h: 1.0,
            })
        };
        let clock = |offset_ms: f64| {
            LiveEvent::Clock(ClockEstimate {
                offset_ms,
                rtt_ms: None,
            })
        };
        queue.push(view(1.0));
        queue.push(clock(1.0));
        queue.push(LiveEvent::PairingExpired);
        queue.push(view(2.0));
        queue.push(clock(2.0));
        let batch = events.try_recv();
        assert_eq!(batch.len(), 3);
        assert!(matches!(batch[0], LiveEvent::View(View { x, .. }) if x == 2.0));
        assert!(
            matches!(batch[1], LiveEvent::Clock(ClockEstimate { offset_ms, .. }) if offset_ms == 2.0)
        );
    }

    #[test]
    fn a_reader_that_never_reads_costs_a_bounded_queue() {
        let queue = EventQueue::new();
        let mut events = LiveEvents::new(queue.clone());
        queue.push(LiveEvent::Commit {
            writer: WriterId(1),
            c: Counter(1),
            ops: Ops::parse(r#"[{"op":"add"}]"#, 1).unwrap(),
        });
        let chunk = 1000;
        for i in 0..=(EVENT_INK_POINTS / chunk) {
            let id = if i % 2 == 0 { "oaaaaaaaa" } else { "obbbbbbbb" };
            queue.push(points(id, chunk));
        }
        let batch = events.try_recv();
        // Il commit resta; l'inchiostro diventa un buco con i due tratti.
        assert!(matches!(batch[0], LiveEvent::Commit { .. }));
        let gaps: Vec<_> = batch
            .iter()
            .filter(|e| matches!(e, LiveEvent::InkGap { .. }))
            .collect();
        assert_eq!(gaps.len(), 1);
        assert!(matches!(gaps[0], LiveEvent::InkGap { strokes } if strokes.len() == 2));
        let samples: usize = batch
            .iter()
            .map(|e| {
                if let LiveEvent::InkPoints(p) = e {
                    p.pts.len()
                } else {
                    0
                }
            })
            .sum();
        assert!(samples <= EVENT_INK_POINTS);
    }

    #[tokio::test]
    async fn the_end_comes_after_the_queued_events_and_then_none() {
        let queue = EventQueue::new();
        let mut events = LiveEvents::new(queue.clone());
        queue.push(LiveEvent::PairingExpired);
        queue.close_with(Some(LiveEvent::Ended {
            reason: EndReason::HostClosing,
        }));
        queue.push(LiveEvent::SnapshotWanted);
        let batch = events.recv().await.unwrap();
        assert_eq!(batch.len(), 2);
        assert!(matches!(
            batch[1],
            LiveEvent::Ended {
                reason: EndReason::HostClosing
            }
        ));
        assert!(events.recv().await.is_none());
    }

    #[test]
    fn events_serialize_with_their_type_in_t() {
        let event = LiveEvent::Commit {
            writer: WriterId(2),
            c: Counter(9),
            ops: Ops::parse(r#"[{"op":"add"}]"#, 1).unwrap(),
        };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"t":"commit","writer":"2","c":"9","ops":[{"op":"add"}]}"#
        );
        let left = LiveEvent::WriterDisconnected {
            writer: WriterId(2),
            reason: LeaveReason::Violation { code: 1007 },
            resumable: false,
        };
        assert_eq!(
            serde_json::to_string(&left).unwrap(),
            r#"{"t":"writerDisconnected","writer":"2","reason":{"violation":{"code":1007}},"resumable":false}"#
        );
        let points = points("oaaaaaaaa", 1);
        assert_eq!(
            serde_json::to_string(&points).unwrap(),
            r#"{"t":"inkPoints","s":"oaaaaaaaa","pts":[[1.0,2.0,0.5,3.0]]}"#
        );
    }
}
