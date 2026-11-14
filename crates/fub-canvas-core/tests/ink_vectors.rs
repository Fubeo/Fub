//! I vettori dell'inchiostro della lavagna, scritti a mano
//! (`apps/client/src/__fixtures__/canvas-ink/`): la stessa cartella che
//! `crates/fub-canvas-wasm/tests/` e
//! `apps/client/src/editors/canvas/wasm/ink-vectors.test.ts` fanno girare
//! attraverso la facciata WebAssembly (`ink_layers`). Ogni vettore dà il testo
//! di una `.canvas` e i livelli che se ne leggono: dove stanno, se sono validi
//! o estranei e, per i validi, quali tratti si disegnano e la ragione di
//! quelli che no (`docs/reference/canvas-ink.md`). Un vettore che non passa si
//! corregge nel lettore, non nel vettore.
//!
//! Su ogni vettore si prova anche il giro: i livelli validi riscritti dal
//! modello danno lo stesso valore, e lo stesso sorgente byte per byte.

use std::path::PathBuf;

use fub_canvas_core::ink::{read_layers, LayerRead, LayerRef, LayerState, StrokeState, INK_KEY};
use fub_canvas_core::parse;
use fub_canvas_core::source::patch_source;
use serde_json::{json, Value};

/// Quanti vettori: gli stessi 28 che conta il test TypeScript. Uno che
/// sparisce si vede qui.
const VECTORS: usize = 28;

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src/__fixtures__/canvas-ink")
}

/// I vettori, in ordine di nome: `(nome senza .json, json)`.
fn read_vectors() -> Vec<(String, Value)> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder())
        .expect("la cartella dei vettori")
        .map(|entry| entry.expect("una voce della cartella").path())
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let stem = name
                .strip_suffix(".json")
                .unwrap_or_else(|| panic!("{name}: nella cartella solo vettori .json"))
                .to_owned();
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let json = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (stem, json)
        })
        .collect()
}

/// Un livello letto nella forma dei vettori.
fn as_vector(read: &LayerRead) -> Value {
    let (state, strokes) = match &read.state {
        LayerState::Foreign(_) => ("foreign", Vec::new()),
        LayerState::Ok { layer, strokes } => (
            "ok",
            layer
                .strokes
                .iter()
                .zip(strokes)
                .map(|(stroke, state)| match state {
                    StrokeState::Drawn(_) => json!({ "id": stroke.id, "drawn": true }),
                    StrokeState::Kept(reason) => {
                        json!({ "id": stroke.id, "drawn": false, "reason": reason.as_str() })
                    }
                })
                .collect(),
        ),
    };
    json!({ "layer": read.layer, "state": state, "strokes": strokes })
}

/// Fa girare un vettore: `Err` dice dove il nucleo non dà ciò che il vettore
/// si aspetta.
fn run(vector: &Value) -> Result<(), String> {
    let source = vector["source"].as_str().ok_or("manca source")?;
    let canvas = parse(source).map_err(|error| format!("la lavagna non si legge: {error}"))?;
    let layers = read_layers(&canvas);
    let given: Vec<Value> = layers.iter().map(as_vector).collect();
    let expected = vector
        .pointer("/expect/layers")
        .and_then(Value::as_array)
        .ok_or("manca expect.layers")?;
    if given != *expected {
        return Err(format!(
            "livelli\n  dati:   {}\n  attesi: {}",
            Value::Array(given),
            Value::Array(expected.clone())
        ));
    }
    for read in &layers {
        if let LayerState::Ok { layer, strokes } = &read.state {
            if strokes.len() != layer.strokes.len() {
                return Err(format!("{:?}: uno stato per ogni tratto", read.layer));
            }
        }
    }
    round_trip(source, &layers)
}

/// I livelli validi riscritti dal modello sono uguali a quelli del file, e il
/// sorgente che ne viene è lo stesso, byte per byte.
fn round_trip(source: &str, layers: &[LayerRead]) -> Result<(), String> {
    let before = parse(source).map_err(|error| error.to_string())?;
    let mut after = before.clone();
    for read in layers {
        let LayerState::Ok { layer, .. } = &read.state else {
            continue;
        };
        let rewritten = layer.to_value();
        let slot = match &read.layer {
            LayerRef::Board => after.extra.get_mut(INK_KEY),
            LayerRef::Node(id) => after
                .nodes
                .iter_mut()
                .find(|node| node.id == *id)
                .and_then(|node| node.extra.get_mut(INK_KEY)),
        }
        .ok_or_else(|| format!("{:?}: il livello non c'è", read.layer))?;
        if *slot != rewritten {
            return Err(format!(
                "{:?}: il giro cambia il livello\n  prima: {slot}\n  dopo:  {rewritten}",
                read.layer
            ));
        }
        *slot = rewritten;
    }
    if after != before {
        return Err("il giro cambia il modello".into());
    }
    let written = patch_source(source, &before, &after).map_err(|error| error.to_string())?;
    if written != source {
        return Err(format!(
            "il giro cambia il sorgente\n  dato:   {written:?}\n  atteso: {source:?}"
        ));
    }
    Ok(())
}

#[test]
fn every_ink_vector_reads_like_typescript() {
    let vectors = read_vectors();
    assert_eq!(
        vectors.len(),
        VECTORS,
        "i vettori dell'inchiostro sono {VECTORS}"
    );
    let failures: Vec<String> = vectors
        .iter()
        .filter_map(|(file, vector)| {
            if vector["name"].as_str() != Some(file.as_str()) {
                return Some(format!("{file}: name non è il nome del file"));
            }
            run(vector).err().map(|error| format!("{file}: {error}"))
        })
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
