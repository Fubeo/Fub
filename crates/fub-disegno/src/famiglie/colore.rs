//! La famiglia `colore` della mappa: il suo stato (`docs/architecture/disegno-completo.md`).
//!
//! I profili colore caricati: pesano, ma non si svuotano senza rompere i documenti che li nominano.

use std::sync::Arc;

use fub_motori::{ErroreMotore, Servizi};

use super::{byte_delle_tabelle, libera_le_tabelle, StatoFamiglia};

/// Le tabelle del motore che la famiglia fa crescere (patch 0008).
pub(crate) const TABELLE: &[&str] = &["user_profiles"];

/// Lo stato della famiglia: le sue tabelle nel motore.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        byte_delle_tabelle(TABELLE)
    }

    fn libera(&self) -> u64 {
        libera_le_tabelle(TABELLE)
    }
}
