//! La Curvatura come comando del disegno (piano K6, T12, giro curvatura):
//! `path.curvature` crea un tracciato che passa per i punti, o con `element`
//! ne sostituisce la forma; `path.setAnchors` sostituisce la geometria di un
//! tracciato con i suoi punti. Gli altri comandi di Curvatura (la modifica di
//! un punto, il rimodella) stanno in `tracciati_punti.rs`, come i comandi su un
//! punto, perché nominano il tracciato con `element` e un numero.
//!
//! - Il tracciato si nomina con `element` (l'id di Fub), mai con `id` (un id
//!   del motore): `id` è `bad_args`, come nei comandi su un punto.
//! - I punti vanno da coordinate di scena a quelle del documento del motore,
//!   anche nei punti di `path.setAnchors` (`x`, `y`, `in`, `out`).
//! - Un elemento bloccato è `locked`, un tratto della penna di Fub è `unmapped`,
//!   uno che non è un tracciato è `unsupported` (dalla stessa regola dei comandi
//!   su un punto, `tracciati_punti::tracciato`).

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use serde_json::{json, Map, Value};
use vectorcraft_geom::{Affine, Point};

use super::su_un_punto::tracciato;
use crate::apertura::Copia;

/// I comandi della Curvatura che vogliono i punti come geometria.
pub(super) const CURVA: [&str; 2] = ["path.curvature", "path.setAnchors"];

/// Il comando non si fa con il valore: l'elemento non si cambia. `None` per
/// un valore senza `element` (`path.curvature` lo crea; `path.setAnchors` lo
/// vuole, e lo dice [`argomenti`]).
pub(super) fn rifiuto_valore(copia: &Copia, valore: &Value) -> Option<DrawingRefusal> {
    let element = valore.get("element")?.as_str()?;
    tracciato(copia, element).err()
}

/// Spenti solo a disegno in sola lettura: un tracciato nuovo non dipende dalla
/// scelta, e `path.setAnchors` sceglie il suo tracciato dal valore.
pub(super) fn spento(copia: &Copia) -> Option<DrawingDisabledReason> {
    (!copia.modificabile).then_some(DrawingDisabledReason::ReadOnly)
}

fn sbagliato(id: &str, perche: impl std::fmt::Display) -> PluginError {
    PluginError::BadArgs(format!("{id}: {perche}").into())
}

/// Un numero in JSON; uno che non è finito resta com'era (il motore lo rifiuta).
fn numero(x: f64) -> Value {
    serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// Porta un punto `x`, `y` con le sue maniglie `in`, `out` dalla scena al
/// documento del motore, dove ci sono; il resto lo controlla il motore.
fn porta(o: &mut Map<String, Value>, radice: Affine) {
    if let (Some(x), Some(y)) = (o.get("x").and_then(Value::as_f64), o.get("y").and_then(Value::as_f64)) {
        let p = radice * Point::new(x, y);
        o.insert("x".into(), numero(p.x));
        o.insert("y".into(), numero(p.y));
    }
    for chiave in ["in", "out"] {
        if let Some([x, y]) = o.get(chiave).and_then(coppia) {
            let p = radice * Point::new(x, y);
            o.insert(chiave.into(), json!([numero(p.x), numero(p.y)]));
        }
    }
}

/// Le coordinate `[x, y]` di `v`, se sono due numeri.
fn coppia(v: &Value) -> Option<[f64; 2]> {
    match v.as_array()?.as_slice() {
        [x, y] => Some([x.as_f64()?, y.as_f64()?]),
        _ => None,
    }
}

/// Gli argomenti di `path.curvature` e `path.setAnchors` come li vuole il
/// motore: `element` diventa l'`id` del suo oggetto (per `path.curvature` sostituisce
/// la forma, senza `element` crea un tracciato), e i punti passano nel documento.
pub(super) fn argomenti(id: &str, copia: &Copia, mut valore: Value) -> Result<Value, PluginError> {
    let o = valore
        .as_object_mut()
        .ok_or_else(|| sbagliato(id, "the value must be an object"))?;
    if o.contains_key("id") {
        return Err(sbagliato(id, "name the path with `element`, not `id`"));
    }
    match o.remove("element") {
        Some(v) => {
            let element = v
                .as_str()
                .ok_or_else(|| sbagliato(id, "`element` must be the id of a path"))?;
            let nodo = tracciato(copia, element)
                .map_err(|_| sbagliato(id, format!("`{element}` is not a path to edit")))?;
            o.insert("id".into(), json!(nodo.0));
        }
        None if id == "path.setAnchors" => return Err(sbagliato(id, "missing `element`")),
        None => {}
    }
    let radice = copia.radice;
    match id {
        "path.curvature" => {
            if let Some(Value::Array(punti)) = o.get_mut("points") {
                for p in punti.iter_mut() {
                    if let Some(q) = p.as_object_mut() {
                        porta(q, radice);
                    }
                }
            }
        }
        _ => {
            let subpaths = o
                .get_mut("subpaths")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| sbagliato(id, "missing `subpaths`"))?;
            for sp in subpaths.iter_mut() {
                if let Some(anchors) = sp.get_mut("anchors").and_then(Value::as_array_mut) {
                    for a in anchors.iter_mut() {
                        if let Some(q) = a.as_object_mut() {
                            porta(q, radice);
                        }
                    }
                }
            }
        }
    }
    Ok(valore)
}
