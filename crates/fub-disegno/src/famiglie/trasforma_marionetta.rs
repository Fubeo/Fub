//! «Altera marionetta» (`object.puppetWarp`, K6 T13): gli spilli e lo spostamento in un solo comando.
//!
//! - Il comando vuole `pins` (dove sono gli spilli, sull'oggetto) e `moved` (dove vanno), della stessa
//!   lunghezza. Non tiene niente fra un comando e l'altro: gli spilli sono nel valore, non nello stato
//!   della sessione (la modalità «rest» dello spillo è un'altra strada, che Fub non usa). Per questo un
//!   comando solo basta, e Fub non deve azzerare nulla dopo.
//! - I punti vanno da coordinate di scena a quelle del documento, come nei comandi su un punto.
//! - Uno spillo fuori dagli oggetti scelti non li tocca: il comando non cambia niente (`empty`).
//! - Un gruppo è rifiutato (il motore non ne deforma i figli in questo modo), e un tratto dell'Inchiostro
//!   di Fub non si cambia (`unmapped`), come per Sposta e Distorci.
//! - `object.puppetWarp.pins` legge gli spilli che il motore propone per gli oggetti scelti.

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use serde_json::{json, Value};
use vectorcraft_doc::NodeKind;
use vectorcraft_geom::{Affine, Point};

use super::super::nodi_scelti;
use super::super::tracciati::sceglie_inchiostro;
use crate::apertura::Copia;

/// La marionetta: deforma gli oggetti scelti con gli spilli dati.
pub(super) const MARIONETTA: &str = "object.puppetWarp";
/// Gli spilli che il motore propone per gli oggetti scelti (una lettura).
pub(super) const MARIONETTA_PINS: &str = "object.puppetWarp.pins";

/// Il perché della marionetta su un gruppo spenta e rifiutata.
const GRUPPO: &str = "La marionetta non vale su un gruppo: scegli i suoi oggetti.";

/// Il perché della marionetta su un rettangolo o un'ellisse primitivi: il file non li deforma (sono
/// forme vive, e la marionetta vuole un tracciato).
const PRIMITIVA: &str = "La marionetta non vale su un rettangolo o un'ellisse primitivi: il file non li deforma.";

/// Vero se il nodo è una forma viva (un rettangolo o un'ellisse primitivi).
fn primitiva(nodo: &vectorcraft_doc::Node) -> bool {
    matches!(nodo.kind, NodeKind::Path { live: Some(_), .. })
}

/// Il perché della marionetta senza spilli.
const SENZA_SPILLI: &str = "servono gli spilli: `pins` e `moved`, uno per ogni punto, con almeno uno";

/// Quanto uno spillo può stare fuori dalla scatola dell'oggetto (in pt) prima di non contare.
const TOLLERANZA: f64 = 1.0;

/// Spento: senza scelta, con un inchiostro di Fub, o con un gruppo.
pub(super) fn spento(copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    if selezione.is_empty() {
        return Some(DrawingDisabledReason::NoSelection);
    }
    if sceglie_inchiostro(copia, selezione) {
        return Some(DrawingDisabledReason::FubInk);
    }
    let nodi = match nodi_scelti(copia, selezione) {
        Ok(nodi) => nodi,
        Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
        Err(_) => return Some(DrawingDisabledReason::Unmapped),
    };
    if nodi.iter().any(|n| copia.documento.node(*n).is_some_and(|nodo| matches!(nodo.kind, NodeKind::Group { .. }))) {
        return Some(DrawingDisabledReason::Other { text: GRUPPO.into() });
    }
    nodi.iter()
        .any(|n| copia.documento.node(*n).is_some_and(primitiva))
        .then(|| DrawingDisabledReason::Other { text: PRIMITIVA.into() })
}

/// Il rifiuto prima del motore: l'inchiostro è `unmapped`, un gruppo è `unsupported`.
pub(super) fn rifiuto(copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
    if sceglie_inchiostro(copia, selezione) {
        return Some(DrawingRefusal::Unmapped);
    }
    let nodi = nodi_scelti(copia, selezione).ok()?;
    nodi.iter()
        .any(|n| copia.documento.node(*n).is_some_and(|nodo| matches!(nodo.kind, NodeKind::Group { .. }) || primitiva(nodo)))
        .then_some(DrawingRefusal::Unsupported)
}

/// Gli spilli che stanno fuori dagli oggetti scelti non li toccano: `empty`.
pub(super) fn rifiuto_valore(copia: &Copia, selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
    let spilli = punti(valore, "pins").ok()?;
    let nodi = nodi_scelti(copia, selezione).ok()?;
    let scatola = copia.documento.bounds_of(&nodi, false)?;
    let dentro = |p: Point| {
        p.x >= scatola.x0 - TOLLERANZA
            && p.x <= scatola.x1 + TOLLERANZA
            && p.y >= scatola.y0 - TOLLERANZA
            && p.y <= scatola.y1 + TOLLERANZA
    };
    let indietro = copia.radice.inverse();
    spilli
        .iter()
        .any(|p| !dentro(indietro * *p))
        .then_some(DrawingRefusal::Empty)
}

/// Gli argomenti della marionetta come li vuole il motore: spilli e spostamenti nel documento, con le
/// stesse lunghezze e numeri finiti. Gli angoli, se ci sono, restano come sono.
pub(super) fn argomenti(id: &str, copia: &Copia, mut valore: Value) -> Result<Value, PluginError> {
    let sbagliato = |perche: &str| PluginError::BadArgs(format!("{id}: {perche}").into());
    if id == MARIONETTA_PINS {
        return Ok(valore);
    }
    let pins = punti(&valore, "pins").map_err(&sbagliato)?;
    let moved = punti(&valore, "moved").map_err(&sbagliato)?;
    if pins.len() != moved.len() {
        return Err(sbagliato("`pins` e `moved` hanno lunghezze diverse"));
    }
    let o = valore
        .as_object_mut()
        .ok_or_else(|| sbagliato("il valore è un oggetto"))?;
    let radice: Affine = copia.radice;
    o.insert("pins".into(), punti_del_documento(&pins, radice));
    o.insert("moved".into(), punti_del_documento(&moved, radice));
    Ok(valore)
}

/// La lista di punti `[x, y]` della chiave `chiave`, in scena. Un errore in italiano se manca, è vuota
/// o non è una lista di coppie di numeri finiti.
fn punti(valore: &Value, chiave: &str) -> Result<Vec<Point>, &'static str> {
    let lista = valore.get(chiave).and_then(Value::as_array).ok_or(SENZA_SPILLI)?;
    if lista.is_empty() {
        return Err(SENZA_SPILLI);
    }
    lista
        .iter()
        .map(|p| match p.as_array().map(Vec::as_slice) {
            Some([x, y]) => match (x.as_f64(), y.as_f64()) {
                (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Ok(Point::new(x, y)),
                _ => Err("gli spilli sono coppie di numeri"),
            },
            _ => Err("gli spilli sono coppie [x, y]"),
        })
        .collect()
}

/// I punti di scena in una lista `[[x, y]…]` del documento.
fn punti_del_documento(punti: &[Point], radice: Affine) -> Value {
    Value::Array(
        punti
            .iter()
            .map(|p| {
                let q = radice * *p;
                json!([q.x, q.y])
            })
            .collect(),
    )
}
