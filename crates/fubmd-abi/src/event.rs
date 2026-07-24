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
    /// Un documento ha cambiato path (l'identità È il path: chi tiene stato
    /// per-documento deve migrare la chiave, non trattarlo come remove+add).
    DocumentRenamed { from: DocId, to: DocId },
    /// L'indice/grafo è stato aggiornato dopo un batch di modifiche.
    IndexUpdated,
    /// Varco di estensione: eventi definiti dai plugin, con topic namespaced
    /// (`"<plugin-id>/<nome>"`). L'abbonamento è a grana `EventKind::Custom`;
    /// il filtro sul topic è a carico dell'handler.
    Custom {
        topic: String,
        payload: serde_json::Value,
    },
}

impl Event {
    pub fn kind(&self) -> EventKind {
        match self {
            Event::VaultOpened { .. } => EventKind::VaultOpened,
            Event::DocumentChanged { .. } => EventKind::DocumentChanged,
            Event::DocumentRemoved { .. } => EventKind::DocumentRemoved,
            Event::DocumentRenamed { .. } => EventKind::DocumentRenamed,
            Event::IndexUpdated => EventKind::IndexUpdated,
            Event::Custom { .. } => EventKind::Custom,
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
    DocumentRenamed,
    IndexUpdated,
    /// Eventi custom dei plugin (il topic sta nel payload dell'`Event`).
    Custom,
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
            EventKind::DocumentRenamed,
            EventKind::IndexUpdated,
            EventKind::Custom,
        ])
    }

    pub fn contains(&self, kind: EventKind) -> bool {
        self.0.contains(&kind)
    }
}
