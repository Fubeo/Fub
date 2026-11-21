//! La famiglia `testo` della mappa: il suo stato (`docs/architecture/disegno-completo.md`).
//!
//! Le facce dei caratteri aggiunte: pesano, ma non si svuotano senza rompere i testi che le usano.

use std::sync::Arc;

use fub_motori::{ErroreMotore, Servizi};

use super::{byte_delle_tabelle, libera_le_tabelle, StatoFamiglia};

/// Le tabelle del motore che la famiglia fa crescere (patch 0008).
pub(crate) const TABELLE: &[&str] = &["font_faces"];

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
