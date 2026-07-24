//! Eventi del sistema, smistati dall'event bus del kernel. I plugin
//! `EventHandler` vi si abbonano tramite una `EventMask`.

use serde::{Deserialize, Serialize};

use crate::model::DocId;

/// Un evento del ciclo di vita del vault.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Il vault è stato aperto/caricato (path radice).
    VaultOpened { root: String },
    /// Un documento è stato creato o modificato.
    DocumentChanged { id: DocId },
    /// Un documento è stato rimosso.
    DocumentRemoved { id: DocId },
    /// L'indice/grafo è stato aggiornato dopo un batch di modifiche.
    IndexUpdated,
}

impl Event {
    pub fn kind(&self) -> EventKind {
        match self {
            Event::VaultOpened { .. } => EventKind::VaultOpened,
            Event::DocumentChanged { .. } => EventKind::DocumentChanged,
            Event::DocumentRemoved { .. } => EventKind::DocumentRemoved,
            Event::IndexUpdated => EventKind::IndexUpdated,
        }
    }
}

/// Il "tipo" di un evento, senza payload — per gli abbonamenti.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    VaultOpened,
    DocumentChanged,
    DocumentRemoved,
    IndexUpdated,
}

/// Insieme di tipi di evento a cui un handler è abbonato.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventMask(pub Vec<EventKind>);

impl EventMask {
    pub fn all() -> Self {
        EventMask(vec![
            EventKind::VaultOpened,
            EventKind::DocumentChanged,
            EventKind::DocumentRemoved,
            EventKind::IndexUpdated,
        ])
    }

    pub fn contains(&self, kind: EventKind) -> bool {
        self.0.contains(&kind)
    }
}
