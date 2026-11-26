//! La famiglia `effetti` della mappa: «Applica effetto» (`effect.apply`, il
//! comando dietro ogni voce del menu Effetto), i comandi della pila degli
//! effetti di un oggetto che la sezione «Aspetto» manda (togli, opzioni,
//! duplica, sposta, luci 3D predefinite, espandi aspetto) e la regola che li
//! accende (`docs/architecture/disegno-completo.md`). La lettura della pila
//! (`effect.list`) non cambia il disegno e vale sempre.

use std::sync::Arc;

use fub_abi::DrawingDisabledReason;
use fub_motori::{ErroreMotore, Servizi};

use super::{selezione_spenta, StatoFamiglia};
use crate::apertura::Copia;

/// I comandi che cambiano gli effetti degli oggetti scelti: valgono con la
/// stessa regola di Applica effetto.
const SUGLI_SCELTI: [&str; 7] = [
    "effect.apply",
    "effect.remove",
    "effect.setParams",
    "effect.duplicate",
    "effect.move",
    "effect.lightingPreset",
    "effect.expandAppearance",
];

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
    /// una copia di sola lettura. Un posto della pila che l'oggetto non ha lo
    /// rifiuta il motore.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if !SUGLI_SCELTI.contains(&id) {
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
