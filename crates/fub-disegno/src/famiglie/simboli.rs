//! La famiglia `simboli` della mappa (`docs/reference/scene-format-symbols.md`):
//! il motore tiene i simboli nel documento, e la scrittura nel file sta in
//! [`crate::simboli`] e nella differenza. Lo stato non tiene niente: il
//! simbolo corrente lo tiene la fila degli strumenti e lo passa a ogni
//! comando.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};

use super::{nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// Lo stato della famiglia: non tiene niente.
pub(crate) struct Stato;

/// I comandi che VectorCraft accende solo con una scelta (`has_selection`).
const VOGLIONO_LA_SCELTA: [&str; 4] = [
    "symbol.new",
    "symbol.breakLink",
    "symbol.update",
    "symbol.replace",
];

/// I comandi che leggono la scelta: con un elemento che la mappa non ha si
/// spengono, perché `esegui` li rifiuterebbe. Gli altri prendono il simbolo
/// o i punti dal valore.
const LEGGONO_LA_SCELTA: [&str; 5] = [
    "symbol.new",
    "symbol.breakLink",
    "symbol.update",
    "symbol.replace",
    "symbol.adjust",
];

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

    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if VOGLIONO_LA_SCELTA.contains(&id) && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if LEGGONO_LA_SCELTA.contains(&id)
            && matches!(nodi_scelti(copia, selezione), Err(DrawingRefusal::Unmapped))
        {
            return Some(DrawingDisabledReason::Unmapped);
        }
        None
    }
}
