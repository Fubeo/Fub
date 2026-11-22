//! La famiglia `nucleo` della mappa: il suo stato, vuoto finché il task della
//! famiglia non lo riempie (`docs/architecture/disegno-completo.md`).

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;

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

    /// I comandi del nucleo spenti, col perché, prima di chiedere al motore:
    /// Seleziona tutto e Inversa valgono sempre; Deseleziona vuole qualcosa di
    /// scelto; l'oggetto sopra o sotto e l'ordine vogliono oggetti che il
    /// motore conosce (l'ordine cambia il file: non in sola lettura, non su
    /// un oggetto bloccato); Separa vuole un gruppo.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        let cambia = id.starts_with("object.");
        match id {
            "select.all" | "select.inverse" => return None,
            _ if selezione.is_empty() => return Some(DrawingDisabledReason::NoSelection),
            "select.none" => return None,
            _ if cambia && !copia.modificabile => return Some(DrawingDisabledReason::ReadOnly),
            _ => {}
        }
        match nodi_scelti(copia, selezione) {
            Err(DrawingRefusal::Locked) if cambia => return Some(DrawingDisabledReason::ReadOnly),
            Err(DrawingRefusal::Locked) => {}
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
            Ok(_) => {}
        }
        if id == "object.ungroup" {
            let gruppo = |nome: &String| {
                copia.mappa.dell_id(nome).and_then(|i| copia.mappa.elemento(i)).is_some_and(|e| e.ruolo == Role::Group)
            };
            if !selezione.iter().any(gruppo) {
                return Some(DrawingDisabledReason::NeedsGroup);
            }
        }
        None
    }
}
