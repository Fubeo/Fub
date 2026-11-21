//! La famiglia `nucleo` della mappa: il suo stato, vuoto finché il task della
//! famiglia non lo riempie (`docs/architecture/disegno-completo.md`).

use std::sync::Arc;

use fub_motori::{ErroreMotore, Servizi};

use super::StatoFamiglia;

/// Lo stato della famiglia: non tiene niente.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        0
    }

    fn libera(&self) -> u64 {
        0
    }
}
