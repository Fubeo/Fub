//! La famiglia `immagini` della mappa: il suo stato (`docs/architecture/disegno-completo.md`).
//!
//! Le immagini decodificate e le arti dei mezzitoni: si svuotano, e il motore le rifà quando servono.
//!
//! Ritaglia immagine e Incorpora immagine li fa il client, che ha i byte delle immagini del vault
//! e il codec del browser (`docs/product/drawing-images.md`): qui si dice solo quando sono accesi,
//! cioè con un'immagine scelta che si può cambiare.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;

use super::{byte_delle_tabelle, libera_le_tabelle, StatoFamiglia};
use crate::apertura::Copia;

/// I comandi delle immagini che fa il client: vogliono un'immagine scelta.
const DEL_CLIENT: &[&str] = &["object.cropImage", "links.embed"];

/// Perché sono spenti senza un'immagine fra gli oggetti scelti.
const SENZA_IMMAGINE: &str = "Scegli un'immagine.";

/// Le tabelle del motore che la famiglia fa crescere (patch 0008).
pub(crate) const TABELLE: &[&str] = &["image_cache", "halftone_cache"];

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

    /// Il motore non vede i byte delle immagini del vault, e il suo ritaglio riscriverebbe i pixel:
    /// li rifiuta, e la voce resta accesa per il client.
    fn rifiuto(id: &str, _copia: &Copia, _selezione: &[String]) -> Option<DrawingRefusal> {
        DEL_CLIENT.contains(&id).then_some(DrawingRefusal::Unsupported)
    }

    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if !DEL_CLIENT.contains(&id) {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        let mappa = &copia.mappa;
        let bloccata = |mut i: usize| loop {
            let Some(e) = mappa.elemento(i) else { return false };
            if e.bloccato {
                return true;
            }
            match e.genitore {
                Some(g) => i = g,
                None => return false,
            }
        };
        let immagini: Vec<usize> = selezione
            .iter()
            .filter_map(|id| mappa.dell_id(id))
            .filter(|i| mappa.elemento(*i).is_some_and(|e| e.ruolo == Role::Image))
            .collect();
        if immagini.is_empty() {
            return Some(DrawingDisabledReason::Other { text: SENZA_IMMAGINE.into() });
        }
        if !copia.modificabile || immagini.iter().all(|i| bloccata(*i)) {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        None
    }
}
