//! La famiglia `testo` della mappa: il suo stato (`docs/architecture/disegno-completo.md`).
//!
//! Le facce dei caratteri aggiunte: pesano, ma non si svuotano senza rompere i testi che le usano.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};
use vectorcraft_doc::NodeId;

use super::{byte_delle_tabelle, libera_le_tabelle, nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// Le tabelle del motore che la famiglia fa crescere (patch 0008).
pub(crate) const TABELLE: &[&str] = &["font_faces"];

/// I comandi del testo scelto che il motore vuole su un testo solo
/// (`text.setRangeStyle` senza `id` prende «il» testo scelto): Fub li fa
/// girare una volta per testo, e Carattere e Paragrafo cambiano tutti i
/// testi scelti in un passo.
const SU_UN_TESTO: &[&str] = &["text.setRangeStyle", "text.setStyle"];

/// Gli oggetti del motore dei `<text>` scelti, nell'ordine della selezione.
fn testi_scelti(copia: &Copia, selezione: &[String]) -> Vec<NodeId> {
    selezione
        .iter()
        .filter_map(|id| copia.mappa.elemento(copia.mappa.dell_id(id)?))
        .filter(|e| e.testo.is_some())
        .filter_map(|e| e.nodo)
        .collect()
}

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

    /// Carattere e Paragrafo vogliono almeno un testo scelto, che si possa
    /// cambiare.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if !SU_UN_TESTO.contains(&id) {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        match nodi_scelti(copia, selezione) {
            Ok(_) => {}
            Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
        }
        testi_scelti(copia, selezione)
            .is_empty()
            .then_some(DrawingDisabledReason::NeedsText)
    }

    /// Un testo alla volta: gli altri oggetti scelti restano come sono.
    fn uno_alla_volta(id: &str, copia: &Copia, selezione: &[String]) -> Option<Vec<NodeId>> {
        SU_UN_TESTO
            .contains(&id)
            .then(|| testi_scelti(copia, selezione))
    }
}
