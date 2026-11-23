//! La famiglia `trasforma` della mappa: il suo stato e i suoi comandi
//! (`docs/architecture/disegno-completo.md`). Giro 1 di T13: la sezione
//! «Allinea» dell'ispettore, con `object.align`, `object.distribute` e
//! `object.distributeSpacing`. T13, giro «disponi»: le voci `addon.arrange.*`
//! di ≡ › Oggetto › Disponi.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;

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
        let allinea = matches!(id, "object.align" | "object.distribute" | "object.distributeSpacing");
        if allinea && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        selezione_spenta(copia, selezione)
    }

    /// Una voce di Disponi su un inchiostro di Fub non gira: l'inchiostro non è un
    /// oggetto del motore, e il comando lo rifiuta come `unmapped`, come il colore.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
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
