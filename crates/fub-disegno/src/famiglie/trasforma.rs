//! La famiglia `trasforma` della mappa: il suo stato e i suoi comandi
//! (`docs/architecture/disegno-completo.md`). Giro 1 di T13: la sezione
//! «Allinea» dell'ispettore, con `object.align`, `object.distribute` e
//! `object.distributeSpacing`. T13, giro «disponi»: le voci `addon.arrange.*`
//! di ≡ › Oggetto › Disponi.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use fub_motori::{ErroreMotore, Servizi};
use vectorcraft_doc::{Document, Node, NodeId};

/// Due decimali, come li scrive la differenza per la geometria (`DECIMALI_GEOMETRIA`): uno scarto
/// più piccolo di così non si vede e non si scrive.
fn arrotonda(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

use super::tracciati::sceglie_inchiostro;
use super::{nodi_scelti, selezione_spenta, StatoFamiglia};
use crate::apertura::Copia;

/// Le voci di ≡ › Oggetto › Disponi (`addon.arrange.*`, K6 T13): il motore le fa
/// sulla selezione, e ognuna vuole un numero di oggetti suo.
const DISPONI: [&str; 7] = [
    "addon.arrange.grid",
    "addon.arrange.swap",
    "addon.arrange.replace",
    "addon.arrange.size",
    "addon.arrange.groupOverlapping",
    "addon.arrange.randomizeOpacity",
    "addon.arrange.sort",
];

/// Quanti oggetti scelti vuole una voce di Disponi, come dice il motore: lo
/// scambio esattamente due, le sostituzioni, il raggruppamento e l'ordine almeno
/// due, le altre uno.
fn quanti_servono(id: &str) -> (usize, Option<usize>) {
    match id {
        "addon.arrange.swap" => (2, Some(2)),
        "addon.arrange.replace" | "addon.arrange.groupOverlapping" | "addon.arrange.sort" => (2, None),
        _ => (1, None),
    }
}

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

    /// Allineare e distribuire vogliono qualcosa di scelto, e la selezione
    /// senza pezzi che il motore non tocca (o bloccati). Quanti oggetti servono
    /// dipende da «allinea a» (un oggetto solo si allinea alla tavola), e lo
    /// decide la sezione del client: qui non si dice `needs_two`. Le voci di
    /// Disponi dicono quanti ne vogliono, col perché.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if DISPONI.contains(&id) {
            return disponi_spenta(id, copia, selezione);
        }
        if id == RENDI_PERFETTO && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        let allinea = matches!(id, "object.align" | "object.distribute" | "object.distributeSpacing");
        if allinea && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        selezione_spenta(copia, selezione)
    }

    /// Una voce di Disponi su un inchiostro di Fub non gira: l'inchiostro non è un
    /// oggetto del motore, e il comando lo rifiuta come `unmapped`, come il colore.
    /// «Rendi perfetto al pixel» su oggetti già allineati non cambia niente, anche se il motore scrive di
    /// nuovo la stessa matrice (la matrice si scrive con quattro decimali, e il riquadro che ne esce è
    /// più preciso di così): il passo non si fa. Vale se il riquadro (a due decimali) e la larghezza del
    /// tratto di ognuno sono gli stessi.
    fn rifiuto_dopo(id: &str, copia: &Copia, dopo: &Document, scelti_dopo: &[NodeId]) -> Option<DrawingRefusal> {
        if id != RENDI_PERFETTO || scelti_dopo.is_empty() {
            return None;
        }
        let invariato = scelti_dopo.iter().all(|n| {
            let (Some(prima), Some(dopo)) = (copia.documento.node(*n), dopo.node(*n)) else {
                return false;
            };
            let riquadro = |nodo: &Node| nodo.geometric_bounds().map(|b| [b.x0, b.y0, b.x1, b.y1].map(arrotonda));
            riquadro(prima) == riquadro(dopo) && arrotonda(prima.appearance.stroke_width()) == arrotonda(dopo.appearance.stroke_width())
        });
        invariato.then_some(DrawingRefusal::Empty)
    }

    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if id == RENDI_PERFETTO {
            // L'inchiostro di Fub non è un oggetto del motore (`unmapped`); un oggetto nascosto il
            // motore lo sposterebbe lo stesso, e Fub non lo tocca: niente da fare (`empty`).
            if sceglie_inchiostro(copia, selezione) {
                return Some(DrawingRefusal::Unmapped);
            }
            return scelto_nascosto(copia, selezione).then_some(DrawingRefusal::Empty);
        }
        (DISPONI.contains(&id) && sceglie_inchiostro(copia, selezione)).then_some(DrawingRefusal::Unmapped)
    }
}

/// «Rendi perfetto al pixel» (`object.makePixelPerfect`, K6 T13): sposta e arrotonda gli oggetti scelti
/// col motore (una matrice `transform`, e la larghezza del tratto a un numero intero). Un oggetto scelto
/// nascosto, o dentro un livello nascosto, non si tocca.
const RENDI_PERFETTO: &str = "object.makePixelPerfect";

/// Vero se uno degli oggetti scelti è nascosto, da sé o perché sta in un livello o un gruppo nascosto.
fn scelto_nascosto(copia: &Copia, selezione: &[String]) -> bool {
    selezione.iter().any(|id| {
        let mut i = copia.mappa.dell_id(id);
        while let Some(indice) = i {
            let Some(elemento) = copia.mappa.elemento(indice) else { break };
            if elemento.nascosto {
                return true;
            }
            i = elemento.genitore;
        }
        false
    })
}

/// Una voce di Disponi (K6 T13): una selezione che il motore tocca, col numero di
/// oggetti che la voce vuole. Un bloccato o un oggetto che la mappa non ha la
/// spengono come le altre voci della famiglia; l'inchiostro di Fub è `FubInk`.
fn disponi_spenta(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
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
    if sceglie_inchiostro(copia, selezione) {
        return Some(DrawingDisabledReason::FubInk);
    }
    let (minimo, massimo) = quanti_servono(id);
    let scelti = selezione.len();
    (scelti < minimo || massimo.is_some_and(|m| scelti > m)).then_some(DrawingDisabledReason::NeedsTwo)
}
