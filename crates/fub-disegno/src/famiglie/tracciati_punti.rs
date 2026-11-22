//! I comandi su un punto di un tracciato (piano K6, T12, «punti»): spostare
//! un punto o una maniglia, aggiungere, eliminare o convertire un punto,
//! chiudere, continuare o dividere un tracciato.
//!
//! Il motore li vuole con l'id del suo oggetto (`id`) e le coordinate del suo
//! documento. Da Fub arrivano con l'id dell'elemento nel file (`element`) e le
//! coordinate della scena, come i punti dello stato dello strumento
//! ([`fub_abi::DrawingAnchor`]): qui si traducono, sulla copia, prima del
//! motore. Un `id` nel valore è rifiutato: un id del motore scavalcherebbe la
//! mappa, e con lei il lucchetto e l'inchiostro.
//!
//! - Un elemento che il motore non conosce, o un tratto della penna di Fub, è
//!   `unmapped`; uno bloccato (lui, un antenato, o la carta) `locked`; uno che
//!   non è un tracciato `unsupported`. Chiudere un tracciato già chiuso è
//!   `empty`. Niente cambia.
//! - Un sottotracciato, un punto o un segmento che il tracciato non ha è un
//!   argomento sbagliato (`bad_args`), col perché: il comando nomina il punto
//!   per numero, senza la posizione dove il client l'ha visto (i comandi sui
//!   punti scelti la portano, e lì un punto sparito è `stale`).

use fub_abi::{DrawingRefusal, PluginError};
use fub_scene::Role;
use serde_json::{json, Map, Value};
use vectorcraft_doc::NodeId;
use vectorcraft_geom::{Affine, PathData, Point};

use super::nodi_scelti;
use crate::apertura::Copia;

/// I comandi che nominano un tracciato con `element` e un suo punto (o
/// segmento, o sottotracciato) per numero.
pub(crate) const SU_UN_PUNTO: [&str; 8] = [
    "path.moveAnchor",
    "path.setHandle",
    "path.insertAnchor",
    "path.removeAnchor",
    "path.convertAnchor",
    "path.close",
    "path.appendAnchor",
    "path.split",
];

/// Sposta i punti scelti (o gli oggetti scelti interi) di `dx`, `dy`: lo
/// spostamento arriva nella scena e va al motore nel suo documento.
pub(crate) const SPOSTA_I_PUNTI: &str = "path.moveAnchors";

/// L'oggetto del motore del tracciato `element`, o perché non si cambia.
fn tracciato(copia: &Copia, element: &str) -> Result<NodeId, DrawingRefusal> {
    let nodo = nodi_scelti(copia, &[element.to_owned()])?
        .into_iter()
        .next()
        .ok_or(DrawingRefusal::Unmapped)?;
    let inchiostro = copia
        .mappa
        .dell_id(element)
        .and_then(|i| copia.mappa.elemento(i))
        .is_some_and(|e| matches!(e.ruolo, Role::Stroke | Role::Width));
    if inchiostro {
        return Err(DrawingRefusal::Unmapped);
    }
    let n = copia.documento.node(nodo).ok_or(DrawingRefusal::Unmapped)?;
    // La carta è bloccata per il motore.
    if n.locked {
        return Err(DrawingRefusal::Locked);
    }
    if n.path_data().is_none() {
        return Err(DrawingRefusal::Unsupported);
    }
    Ok(nodo)
}

/// Perché il comando su un punto `id` non si fa con il valore `valore`, prima
/// degli argomenti: l'elemento non si cambia, o il tracciato da chiudere è già
/// chiuso. `None` anche quando il valore è sbagliato: lo dice
/// [`argomenti_del_punto`].
pub(crate) fn punto_rifiutato(id: &str, copia: &Copia, valore: &Value) -> Option<DrawingRefusal> {
    if !SU_UN_PUNTO.contains(&id) {
        return None;
    }
    let element = valore.get("element")?.as_str()?;
    let nodo = match tracciato(copia, element) {
        Ok(nodo) => nodo,
        Err(r) => return Some(r),
    };
    if id != "path.close" {
        return None;
    }
    let dati = copia.documento.node(nodo)?.path_data()?;
    let aperto = match valore.get("subpath") {
        None => dati.subpaths.iter().any(|sp| !sp.closed),
        Some(v) => !dati.subpaths.get(usize::try_from(v.as_u64()?).ok()?)?.closed,
    };
    (!aperto).then_some(DrawingRefusal::Empty)
}

/// Un argomento sbagliato, col perché.
fn sbagliato(id: &str, perche: impl std::fmt::Display) -> PluginError {
    PluginError::BadArgs(format!("{id}: {perche}").into())
}

/// Il numero intero `chiave` del valore, se c'è.
fn intero(id: &str, o: &Map<String, Value>, chiave: &str) -> Result<Option<usize>, PluginError> {
    match o.get(chiave) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .map(Some)
            .ok_or_else(|| sbagliato(id, format!("`{chiave}` must be a whole number"))),
    }
}

/// Il numero intero `chiave` che il comando vuole.
fn intero_dovuto(id: &str, o: &Map<String, Value>, chiave: &str) -> Result<usize, PluginError> {
    intero(id, o, chiave)?.ok_or_else(|| sbagliato(id, format!("missing `{chiave}`")))
}

/// Controlla che il punto, il segmento o il sottotracciato che il comando
/// nomina ci siano nel tracciato `dati`.
fn controlla_gli_indici(id: &str, o: &Map<String, Value>, dati: &PathData) -> Result<(), PluginError> {
    let quanti = dati.subpaths.len();
    let sotto = intero(id, o, "subpath")?;
    let sottotracciato = |si: usize| {
        dati.subpaths
            .get(si)
            .ok_or_else(|| sbagliato(id, format!("the path has {quanti} subpaths, there is no subpath {si}")))
    };
    let punto = |ai: usize| -> Result<(), PluginError> {
        let si = sotto.unwrap_or(0);
        let n = sottotracciato(si)?.anchors.len();
        if ai < n {
            Ok(())
        } else {
            Err(sbagliato(id, format!("subpath {si} has {n} anchors, there is no anchor {ai}")))
        }
    };
    let segmento = |sg: usize| -> Result<(), PluginError> {
        let si = sotto.unwrap_or(0);
        let n = sottotracciato(si)?.segment_count();
        if sg < n {
            Ok(())
        } else {
            Err(sbagliato(id, format!("subpath {si} has {n} segments, there is no segment {sg}")))
        }
    };
    match id {
        "path.moveAnchor" | "path.setHandle" | "path.removeAnchor" | "path.convertAnchor" => {
            punto(intero_dovuto(id, o, "anchor")?)
        }
        "path.insertAnchor" => segmento(intero_dovuto(id, o, "segment")?),
        "path.split" => match (intero(id, o, "anchor")?, intero(id, o, "segment")?) {
            (Some(ai), _) => punto(ai),
            (None, Some(sg)) => segmento(sg),
            (None, None) => Err(sbagliato(id, "missing `anchor` or `segment`")),
        },
        // Chiudere e continuare: senza `subpath` il motore sceglie l'ultimo aperto.
        _ => sotto.map_or(Ok(()), |si| sottotracciato(si).map(|_| ())),
    }
}

/// Le coordinate `[x, y]` di `v`, se sono due numeri.
fn coppia(v: &Value) -> Option<[f64; 2]> {
    match v.as_array()?.as_slice() {
        [x, y] => Some([x.as_f64()?, y.as_f64()?]),
        _ => None,
    }
}

/// Un numero in JSON; uno che non è finito resta com'era (il motore lo
/// rifiuta).
fn numero(x: f64) -> Value {
    serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// Porta nel documento del motore le coordinate della scena del valore: il
/// punto `x`, `y` (se ci sono tutti e due, numeri) e le maniglie `in`, `out`.
/// Il resto lo controlla il motore, che rifiuta ciò che non è un numero.
fn nel_documento(o: &mut Map<String, Value>, radice: Affine) {
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

/// Gli argomenti del comando su un punto `id` come li vuole il motore:
/// `element` diventa l'`id` del suo oggetto, le coordinate passano nel
/// documento del motore, e gli indici si controllano sulla copia.
/// `path.moveAnchors` porta lo spostamento nel documento. Gli altri comandi
/// restano come sono.
pub(crate) fn argomenti_del_punto(id: &str, copia: &Copia, mut valore: Value) -> Result<Value, PluginError> {
    if id == SPOSTA_I_PUNTI {
        if let Some(o) = valore.as_object_mut() {
            let dx = o.get("dx").and_then(Value::as_f64);
            let dy = o.get("dy").and_then(Value::as_f64);
            if dx.is_some() || dy.is_some() {
                // Uno spostamento: la parte lineare della radice, senza la traslazione.
                let [a, b, c, d, _, _] = copia.radice.as_coeffs();
                let (x, y) = (dx.unwrap_or(0.0), dy.unwrap_or(0.0));
                o.insert("dx".into(), numero(a * x + c * y));
                o.insert("dy".into(), numero(b * x + d * y));
            }
        }
        return Ok(valore);
    }
    if !SU_UN_PUNTO.contains(&id) {
        return Ok(valore);
    }
    let o = valore
        .as_object_mut()
        .ok_or_else(|| sbagliato(id, "the value must be an object"))?;
    if o.contains_key("id") {
        return Err(sbagliato(id, "name the path with `element`, not `id`"));
    }
    let element = o
        .remove("element")
        .and_then(|v| v.as_str().map(str::to_owned))
        .ok_or_else(|| sbagliato(id, "missing `element`"))?;
    // `punto_rifiutato` ha già detto perché l'elemento non si cambia.
    let nodo = tracciato(copia, &element).map_err(|_| sbagliato(id, format!("`{element}` is not a path to edit")))?;
    let dati = copia
        .documento
        .node(nodo)
        .and_then(|n| n.path_data())
        .ok_or_else(|| sbagliato(id, format!("`{element}` is not a path to edit")))?;
    controlla_gli_indici(id, o, dati)?;
    nel_documento(o, copia.radice);
    o.insert("id".into(), json!(nodo.0));
    Ok(valore)
}
