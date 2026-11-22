//! La famiglia `trasforma` della mappa: il suo stato e i suoi comandi
//! (`docs/architecture/disegno-completo.md`). Giro 1 di T13: la sezione
//! «Allinea» dell'ispettore, con `object.align`, `object.distribute` e
//! `object.distributeSpacing`.

use std::sync::Arc;

use fub_abi::DrawingDisabledReason;
use fub_motori::{ErroreMotore, Servizi};

use super::StatoFamiglia;
use crate::apertura::Copia;

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

    /// Allineare e distribuire vogliono qualcosa di scelto. Quanti oggetti
    /// servono dipende da «allinea a» (un oggetto solo si allinea alla tavola),
    /// e lo decide la sezione del client: qui non si dice `needs_two`.
    fn spento(id: &str, _copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        let allinea = matches!(id, "object.align" | "object.distribute" | "object.distributeSpacing");
        (allinea && selezione.is_empty()).then_some(DrawingDisabledReason::NoSelection)
    }
}
