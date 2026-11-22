//! La famiglia `tracciati` della mappa (piano K6, T12;
//! `docs/architecture/disegno-completo.md`, «I tracciati e i punti»).
//!
//! - **I comandi sui punti scelti** (`SUI_PUNTI`): la selezione di Fub dice
//!   oggetti, non punti. I punti scelti col gesto tornano nel `value` del
//!   comando (`anchors`, [`fub_abi::DrawingAnchor`]); [`punti`] li legge e li
//!   controlla sulla copia, e chi esegue li mette nella selezione del motore.
//! - **L'inchiostro di Fub** (`fub:ink`): uno strumento della famiglia che
//!   cambierebbe o toglierebbe un tratto della penna di Fub è rifiutato con
//!   `unmapped`, e niente cambia ([`inchiostro_toccato`]): i tratti si fanno
//!   dai campioni, e un taglio li perderebbe in tracciati qualsiasi. Lo
//!   stesso per i comandi sui punti ([`sceglie_inchiostro`]).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use fub_abi::{DrawingAnchor, DrawingDisabledReason, DrawingRefusal, MAX_DRAWING_ANCHORS};
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;
use serde_json::Value;
use vectorcraft_doc::{Document, NodeId};

use super::{nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// I comandi che lavorano sui punti di ancoraggio scelti.
pub(crate) const SUI_PUNTI: [&str; 4] = [
    "path.convertAnchors",
    "path.cutAtAnchors",
    "path.join",
    "path.removeAnchors",
];

/// Quanto un punto può essersi spostato (in coordinate di scena) ed essere
/// ancora lui: sotto la precisione dei numeri che il file scrive.
const TOLLERANZA: f64 = 1e-3;

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

    /// I comandi sui punti spenti, col perché: vogliono un tracciato scelto,
    /// che il motore conosce, non bloccato e in un disegno modificabile.
    /// Tagliare ed eliminare i punti vogliono anche i punti scelti, che la
    /// selezione di oggetti non dice: da ≡ sono spenti, con `needs_anchors`;
    /// la fila dei punti li manda con i suoi punti.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if !SUI_PUNTI.contains(&id) {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        let nodi = match nodi_scelti(copia, selezione) {
            Ok(nodi) => nodi,
            Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
        };
        if sceglie_inchiostro(copia, selezione) {
            return Some(DrawingDisabledReason::Unmapped);
        }
        // La carta è bloccata per il motore: non è un tracciato da cambiare.
        let tracciato = |n: &NodeId| {
            copia
                .documento
                .node(*n)
                .is_some_and(|nodo| !nodo.locked && nodo.path_data().is_some())
        };
        if !nodi.iter().any(tracciato) {
            return Some(DrawingDisabledReason::NeedsPath);
        }
        if matches!(id, "path.cutAtAnchors" | "path.removeAnchors") {
            return Some(DrawingDisabledReason::NeedsAnchors);
        }
        None
    }
}

/// I punti scelti del `value` di un comando sui punti, tolti dal valore,
/// come il motore li vuole nella selezione: per oggetto, `(sottotracciato,
/// punto)`. Senza `anchors`, niente (il comando vale sugli oggetti scelti).
/// Un punto che la copia non ha più dove il client l'ha visto è `stale`; uno
/// su un elemento che il motore non conosce `unmapped`, su uno bloccato
/// `locked`; troppi punti o una forma sbagliata sono argomenti sbagliati.
pub(crate) fn punti(
    copia: &Copia,
    valore: &mut Value,
) -> Result<BTreeMap<NodeId, BTreeSet<(usize, usize)>>, Rifiuto> {
    let mut fuori: BTreeMap<NodeId, BTreeSet<(usize, usize)>> = BTreeMap::new();
    let Some(grezzi) = valore.as_object_mut().and_then(|o| o.remove("anchors")) else {
        return Ok(fuori);
    };
    let scelti: Vec<DrawingAnchor> = serde_json::from_value(grezzi)
        .map_err(|e| Rifiuto::Argomenti(format!("`anchors`: {e}")))?;
    if scelti.len() > MAX_DRAWING_ANCHORS {
        return Err(Rifiuto::Argomenti(format!(
            "`anchors` has {} anchors, at most {MAX_DRAWING_ANCHORS}",
            scelti.len()
        )));
    }
    let indietro = copia.radice.inverse();
    for punto in scelti {
        let nodo = nodi_scelti(copia, std::slice::from_ref(&punto.element))
            .map_err(Rifiuto::Motore)?
            .into_iter()
            .next()
            .ok_or(Rifiuto::Motore(DrawingRefusal::Unmapped))?;
        let (si, ai) = (punto.subpath as usize, punto.anchor as usize);
        let qui = copia
            .documento
            .node(nodo)
            .and_then(|n| n.path_data())
            .ok_or(Rifiuto::Motore(DrawingRefusal::Stale))?
            .subpaths
            .get(si)
            .and_then(|sp| sp.anchors.get(ai))
            .map(|a| indietro * a.p)
            .ok_or(Rifiuto::Motore(DrawingRefusal::Stale))?;
        if (qui.x - punto.at[0]).abs() > TOLLERANZA || (qui.y - punto.at[1]).abs() > TOLLERANZA {
            return Err(Rifiuto::Motore(DrawingRefusal::Stale));
        }
        fuori.entry(nodo).or_default().insert((si, ai));
    }
    Ok(fuori)
}

/// Perché i punti di un comando non si prendono.
#[derive(Debug)]
pub(crate) enum Rifiuto {
    /// Un rifiuto del disegno (`stale`, `unmapped`, `locked`).
    Motore(DrawingRefusal),
    /// Argomenti sbagliati.
    Argomenti(String),
}

/// La selezione ha un tratto della penna di Fub (`fub:ink`, ruolo `Stroke`
/// o `Width`): i comandi sui punti non lo cambiano, come gli strumenti.
pub(crate) fn sceglie_inchiostro(copia: &Copia, selezione: &[String]) -> bool {
    selezione.iter().any(|id| {
        copia
            .mappa
            .dell_id(id)
            .and_then(|i| copia.mappa.elemento(i))
            .is_some_and(|e| matches!(e.ruolo, Role::Stroke | Role::Width))
    })
}

/// Lo strumento della famiglia ha cambiato o tolto un tratto della penna di
/// Fub (`fub:ink`, ruolo `Stroke` o `Width`): il suo oggetto in `dopo` non è
/// più quello della copia.
pub(crate) fn inchiostro_toccato(copia: &Copia, dopo: &Document) -> bool {
    copia.mappa.elementi().iter().any(|e| {
        matches!(e.ruolo, Role::Stroke | Role::Width)
            && e.nodo.is_some_and(|n| match (copia.documento.node(n), dopo.node(n)) {
                (Some(prima), Some(ora)) => !std::ptr::eq(prima, ora),
                (Some(_), None) => true,
                _ => false,
            })
    })
}
