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
    /// Seleziona tutto e Inversa valgono sempre; le incolle, le letture del
    /// documento e la selezione per id non vogliono una selezione; Deseleziona,
    /// Pulisci, Duplica e gli oggetti vogliono qualcosa di scelto; l'oggetto
    /// sopra o sotto e l'ordine vogliono oggetti che il motore conosce (chi
    /// cambia il file non va in sola lettura, né su un oggetto bloccato); Separa
    /// vuole un gruppo.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        let cambia = cambia_il_file(id);
        match id {
            "select.all" | "select.inverse" => return None,
            _ if selezione.is_empty() && vuole_selezione(id) => return Some(DrawingDisabledReason::NoSelection),
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

    /// `object.setProps` non scrive il tratto a penna di Fub (`fub:ink`): il
    /// motore lo tiene come elemento grezzo, e lo riscriverebbe come un altro
    /// oggetto. Lo si dice come `unmapped`.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        let tratto = |nome: &String| copia.mappa.dell_id(nome).and_then(|i| copia.mappa.elemento(i)).is_some_and(|e| e.ruolo == Role::Stroke);
        (id == "object.setProps" && selezione.iter().any(tratto)).then_some(DrawingRefusal::Unmapped)
    }
}

/// I comandi che cambiano il file: gli oggetti, le incolle, pulisci e duplica,
/// taglia. In sola lettura non si fanno (la copia e le letture sì).
fn cambia_il_file(id: &str) -> bool {
    id.starts_with("object.") || id.starts_with("edit.paste") || matches!(id, "edit.clear" | "edit.duplicate" | "edit.cut")
}

/// I comandi che lavorano sulla selezione. Le incolle vanno dove sta il punto
/// del disegno, le letture del documento leggono tutto, e la selezione per id
/// prende i suoi id: nessuno di loro vuole una selezione. Nemmeno Sblocca
/// tutto e Mostra tutto, che lavorano su tutto il disegno.
fn vuole_selezione(id: &str) -> bool {
    !(id.starts_with("edit.paste")
        || id.starts_with("document.")
        || matches!(id, "select.set" | "select.add" | "select.toggle" | "edit.dropSelection" | "object.unlockAll" | "object.showAll"))
}
