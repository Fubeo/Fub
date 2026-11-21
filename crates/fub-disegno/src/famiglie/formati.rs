//! La famiglia `formati` della mappa: il suo stato (`docs/architecture/disegno-completo.md`).
//!
//! I documenti collocati, letti e disegnati: si svuotano, e il motore li rilegge quando servono.

use std::sync::Arc;

use fub_motori::{ErroreMotore, Servizi};

use super::{byte_delle_tabelle, libera_le_tabelle, StatoFamiglia};

/// Le tabelle del motore che la famiglia fa crescere (patch 0008).
pub(crate) const TABELLE: &[&str] = &["placed_bitmaps", "placed_files", "placed_reads"];

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
