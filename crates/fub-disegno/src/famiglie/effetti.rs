//! La famiglia `effetti` della mappa: «Applica effetto» (`effect.apply`, il
//! comando dietro ogni voce del menu Effetto) e la regola che lo accende
//! (`docs/architecture/disegno-completo.md`).

use std::sync::Arc;

use fub_abi::DrawingDisabledReason;
use fub_motori::{ErroreMotore, Servizi};

use super::{selezione_spenta, StatoFamiglia};
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

    /// Un effetto vale sugli oggetti scelti, come in VectorCraft: spento
    /// senza scelta, con un elemento che il disegno non ha o bloccato, e su
    /// una copia di sola lettura.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if id != "effect.apply" {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if let Some(r) = selezione_spenta(copia, selezione) {
            return Some(r);
        }
        (!copia.modificabile).then_some(DrawingDisabledReason::ReadOnly)
    }
}
