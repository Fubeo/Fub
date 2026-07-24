//! Event bus del kernel: pub/sub semplice basato su canali std.
//!
//! È un handle clonabile (Arc interno) così che thread esterni — es. il file
//! watcher nell'app — possano emettere eventi. Il frontend riceve gli eventi
//! via il ponte Tauri, che fa da subscriber.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use fubmd_abi::Event;

#[derive(Clone, Default)]
pub struct EventBus {
    subscribers: Arc<Mutex<Vec<Sender<Event>>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Crea un nuovo subscriber e restituisce il capo ricevente.
    pub fn subscribe(&self) -> Receiver<Event> {
        let (tx, rx) = channel();
        self.subscribers.lock().unwrap().push(tx);
        rx
    }

    /// Emette un evento a tutti i subscriber vivi; scarta quelli chiusi.
    pub fn emit(&self, event: Event) {
        let mut subs = self.subscribers.lock().unwrap();
        subs.retain(|tx| tx.send(event.clone()).is_ok());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::model::DocId;

    #[test]
    fn delivers_to_subscribers() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        bus.emit(Event::DocumentChanged {
            id: DocId::new("a.md"),
        });
        assert_eq!(
            rx.recv().unwrap(),
            Event::DocumentChanged {
                id: DocId::new("a.md")
            }
        );
    }
}
