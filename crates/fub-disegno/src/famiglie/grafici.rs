//! La famiglia `grafici` della mappa: i grafici di VectorCraft
//! (`vendor/vectorcraft/crates/engine/src/cmd/graph/`). Lo stato non tiene niente.
//! Dati, Tipo, Colonna, Indicatore e Design senza valori non cambiano il grafico:
//! rendono com'è adesso (i dati come CSV, le opzioni, i design), e le finestre
//! partono da lì come in VectorCraft.

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

    /// Le cinque finestre del grafico, chiamate senza valori, leggono.
    fn legge(&self, id: &str) -> bool {
        LETTURE.contains(&id)
    }

    /// Le finestre del grafico vogliono un grafico scelto e mappato; Crea grafico no: prende
    /// il rettangolo dal valore.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if !LETTURE.contains(&id) {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if matches!(nodi_scelti(copia, selezione), Err(DrawingRefusal::Unmapped)) {
            return Some(DrawingDisabledReason::Unmapped);
        }
        None
    }
}

/// I comandi che, senza valori, rendono com'è il grafico scelto.
const LETTURE: [&str; 5] = [
    "graph.setData",
    "graph.setType",
    "graph.column",
    "graph.marker",
    "graph.design",
];
