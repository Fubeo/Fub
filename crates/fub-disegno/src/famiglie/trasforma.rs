//! La famiglia `trasforma` della mappa: il suo stato e i suoi comandi
//! (`docs/architecture/disegno-completo.md`). Giro 1 di T13: la sezione
//! «Allinea» dell'ispettore, con `object.align`, `object.distribute` e
//! `object.distributeSpacing`. T13, giro «disponi»: le voci `addon.arrange.*`
//! di ≡ › Oggetto › Disponi.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;
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

/// Le voci di ≡ › Oggetto › Sposta e Distorci (K6 T13, giro «sposta»): spostano o deformano
/// gli oggetti scelti, e un tratto dell'inchiostro di Fub non si cambia (`unmapped`, come Disponi).
const SPOSTA_E_DISTORCI: [&str; 2] = ["object.nudge", "object.distort"];

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
        if SPOSTA_E_DISTORCI.contains(&id) && sceglie_inchiostro(copia, selezione) {
            return Some(DrawingDisabledReason::FubInk);
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

    /// Una voce di Disponi, Sposta leggermente o Distorci su un inchiostro di Fub non gira:
    /// l'inchiostro non è un oggetto del motore, e il comando lo rifiuta come `unmapped`, come il colore.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if id == RENDI_PERFETTO {
            // L'inchiostro di Fub non è un oggetto del motore (`unmapped`); un oggetto nascosto il
            // motore lo sposterebbe lo stesso, e Fub non lo tocca: niente da fare (`empty`).
            if sceglie_inchiostro(copia, selezione) {
                return Some(DrawingRefusal::Unmapped);
            }
            return scelto_nascosto(copia, selezione).then_some(DrawingRefusal::Empty);
        }
        let inchiostro = DISPONI.contains(&id) || SPOSTA_E_DISTORCI.contains(&id);
        (inchiostro && sceglie_inchiostro(copia, selezione)).then_some(DrawingRefusal::Unmapped)
    }

    /// Gli angoli di Distorci (TL, TR, BR, BL) devono formare un quadrilatero: due angoli
    /// uguali, cioè un lato di lunghezza zero, o quattro angoli allineati danno una trasformazione
    /// che schiaccia il tracciato (il motore ne scrive un punto solo, in 0 0). Angoli che si
    /// incrociano (un quadrilatero che si rovescia) sono uno specchio, e valgono.
    fn argomenti_della_copia(id: &str, _copia: &Copia, valore: Value) -> Result<Value, PluginError> {
        if id == "object.distort" {
            let angoli = valore.get("corners").unwrap_or(&Value::Null);
            quadrilatero_valido(angoli).map_err(|perche| PluginError::BadArgs(format!("{id}: {perche}").into()))?;
        }
        Ok(valore)
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

/// Vero se `angoli` sono quattro punti `[x, y]` che formano un quadrilatero: nessun lato di
/// lunghezza zero, e un'area con segno diversa da zero. Il perché, in italiano, se no.
fn quadrilatero_valido(angoli: &Value) -> Result<(), &'static str> {
    let Some(pari) = angoli.as_array() else {
        return Err("gli angoli sono quattro punti [x, y]");
    };
    let mut punti = Vec::with_capacity(4);
    for p in pari {
        match p.as_array().map(Vec::as_slice) {
            Some([x, y]) => match (x.as_f64(), y.as_f64()) {
                (Some(x), Some(y)) if x.is_finite() && y.is_finite() => punti.push((x, y)),
                _ => return Err("le coordinate degli angoli sono numeri"),
            },
            _ => return Err("gli angoli sono quattro punti [x, y]"),
        }
    }
    if punti.len() != 4 {
        return Err("gli angoli sono quattro punti [x, y]");
    }
    for i in 0..4 {
        let (a, b) = (punti[i], punti[(i + 1) % 4]);
        if (a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9 {
            return Err("due angoli coincidono: gli angoli devono formare un quadrilatero");
        }
    }
    let area2: f64 = (0..4)
        .map(|i| {
            let (a, b) = (punti[i], punti[(i + 1) % 4]);
            a.0 * b.1 - b.0 * a.1
        })
        .sum();
    if area2.abs() < 1e-9 {
        return Err("gli angoli sono allineati: non formano un quadrilatero");
    }
    Ok(())
}
