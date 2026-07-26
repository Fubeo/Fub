//! Event bus del kernel: pub/sub semplice basato su canali std.
//!
//! È un handle clonabile (Arc interno) così che thread esterni — es. il file
//! watcher nell'app — possano emettere eventi. Il frontend riceve gli eventi
//! via il ponte Tauri, che fa da subscriber.
//!
//! Ciò che viaggia è un [`Notice`] — l'evento **e la sua origine** (§1.18) — la
//! stessa cosa che ricevono gli `EventHandler`: due canali che portassero forme
//! diverse dello stesso fatto sarebbero due verità da tenere allineate a mano.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use fubmd_abi::Notice;

#[derive(Clone, Default)]
pub struct EventBus {
    subscribers: Arc<Mutex<Vec<Sender<Notice>>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Crea un nuovo subscriber e restituisce il capo ricevente.
    pub fn subscribe(&self) -> Receiver<Notice> {
        let (tx, rx) = channel();
        self.subscribers.lock().unwrap().push(tx);
        rx
    }

    /// Emette un evento a tutti i subscriber vivi; scarta quelli chiusi.
    pub fn emit(&self, notice: Notice) {
        let mut subs = self.subscribers.lock().unwrap();
        subs.retain(|tx| tx.send(notice.clone()).is_ok());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::event::{Actor, BatchId, Origin};
    use fubmd_abi::model::DocId;
    use fubmd_abi::Event;

    #[test]
    fn delivers_to_subscribers_with_the_origin_attached() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        let notice = Notice::new(
            Event::DocumentChanged {
                id: DocId::new("a.md"),
            },
            Origin::by(Actor::Watcher).in_batch(Some(BatchId(3))),
        );
        bus.emit(notice.clone());
        assert_eq!(rx.recv().unwrap(), notice);
    }
}
