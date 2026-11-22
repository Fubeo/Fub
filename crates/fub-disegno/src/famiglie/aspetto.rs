//! La famiglia `aspetto` della mappa (K6 T15, giro 2): l'opacità e il metodo di fusione dell'oggetto
//! scelto, `transparency.set`. Il resto dell'aspetto (la pila, il contorno, le maschere di opacità, il
//! gruppo a foratura) aspetta il suo giro (`docs/architecture/disegno-completo.md`).

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};

use super::{nodi_scelti, StatoFamiglia};
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

    /// `transparency.set` spento col suo perché, prima di chiedere al motore: senza una scelta; sul
    /// disegno di sola lettura; con una scelta che la mappa non ha, o con un oggetto bloccato (che non
    /// si scrive). Gli altri comandi della famiglia non sono ancora nella mappa.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if id != "transparency.set" {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        match nodi_scelti(copia, selezione) {
            Ok(_) => None,
            Err(DrawingRefusal::Locked) => Some(DrawingDisabledReason::ReadOnly),
            Err(_) => Some(DrawingDisabledReason::Unmapped),
        }
    }
}
