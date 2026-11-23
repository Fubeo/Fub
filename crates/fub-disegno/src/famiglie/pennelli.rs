//! La famiglia `pennelli` della mappa (`docs/architecture/disegno-completo.md`).
//!
//! Gli strumenti che deformano (Altera, Vortice, Contrai, Gonfia, Smerla, Cristallizza,
//! Raggrinzisci) sono lo strumento `LiquifyTool` di VectorCraft, e il loro comando è
//! `object.liquify`: con una selezione cambia i tracciati scelti, senza tutti quelli sotto il
//! pennello. Un tratto della penna di Fub non si deforma: scelto è `unmapped` prima del motore,
//! toccato dal pennello senza selezione lo è dopo, e niente cambia.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};
use vectorcraft_doc::{Document, NodeId};

use super::tracciati::{inchiostro_toccato, sceglie_inchiostro};
use super::{selezione_spenta, StatoFamiglia};
use crate::apertura::Copia;

/// Il comando dei pennelli che deformano.
pub(crate) const LIQUEFA: &str = "object.liquify";

/// Gli strumenti che deformano, con lo stesso comando: spostano i punti dei tracciati.
pub(crate) const STRUMENTI_LIQUEFA: [&str; 7] =
    ["warp", "twirl", "pucker", "bloat", "scallop", "crystallize", "wrinkle"];

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

    /// Spento con un tratto della penna di Fub nella selezione, o con un pezzo che il motore non ha
    /// o che è bloccato; senza selezione è acceso, e il pennello prende ciò che ha sotto.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if id != LIQUEFA || selezione.is_empty() {
            return None;
        }
        if sceglie_inchiostro(copia, selezione) {
            return Some(DrawingDisabledReason::FubInk);
        }
        selezione_spenta(copia, selezione)
    }

    /// Un tratto della penna di Fub scelto non si deforma: `unmapped`.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        (id == LIQUEFA && sceglie_inchiostro(copia, selezione)).then_some(DrawingRefusal::Unmapped)
    }

    /// Senza selezione il pennello prende ciò che ha sotto: se ha toccato un tratto della penna
    /// di Fub, `unmapped`, e niente cambia.
    fn rifiuto_dopo(
        id: &str,
        copia: &Copia,
        dopo: &Document,
        _scelti_dopo: &[NodeId],
    ) -> Option<DrawingRefusal> {
        (id == LIQUEFA && inchiostro_toccato(copia, dopo)).then_some(DrawingRefusal::Unmapped)
    }
}
