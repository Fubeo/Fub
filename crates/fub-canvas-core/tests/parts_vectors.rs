//! I vettori degli estratti della lavagna, scritti a mano
//! (`apps/client/src/__fixtures__/canvas-parts/`): la stessa cartella che
//! `apps/client/src/editors/canvas/parts.test.ts` fa girare sul lettore
//! TypeScript. Le regole sono in `docs/reference/canvas-parts.md`. Un vettore
//! che non passa si corregge nel lettore, non nel vettore.
//!
//! - `read-*.json`: il testo di una `.canvas` (`source`) e, per ogni scheda col
//!   campo `fub:parts`, nell'ordine di `nodes`, che cosa se ne legge: valido
//!   (`ok`, col campo riscritto come `JSON.stringify` in `parts` e, per le
//!   pagine, il `layout` che vale) o conservato (`kept`, con la ragione), e il
//!   `subpath` che la scheda mostra (`shows`). Su ogni vettore si prova anche
//!   il giro (il campo riscritto dà gli stessi byte del campo codificato allo
//!   stesso modo) e lo spostamento: spostare la scheda non tocca un byte del
//!   suo `fub:parts`.
//! - `write-*.json`: un estratto scelto (`parts`) per il file `file` e che
//!   cosa Fub scrive: `written`, col `subpath` e il campo come
//!   `JSON.stringify` (`null`: niente campo), o `refused` con la ragione.

use std::path::PathBuf;

use fub_canvas_core::commit::Core;
use fub_canvas_core::js::encode;
use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::parts::{
    node_parts, read_parts, write_parts, CanvasParts, PartsRefused, PartsState, PARTS_KEY,
};
use fub_canvas_core::source::node_at;
use fub_canvas_core::{parse, Canvas};
use serde_json::{json, Value};

/// Quanti vettori: gli stessi che conta il test TypeScript. Uno che sparisce
/// si vede qui.
const READ_VECTORS: usize = 30;
const WRITE_VECTORS: usize = 16;

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/canvas-parts")
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

/// Un campo letto nella forma dei vettori.
fn as_vector(canvas: &Canvas, node: &str, state: &PartsState) -> Value {
    let shows = canvas
        .nodes
        .iter()
        .find(|card| card.id == node)
        .and_then(|card| card.subpath.clone());
    match state {
        PartsState::Ok(parts) => {
            let mut card = json!({
                "node": node,
                "state": "ok",
                "parts": encode(&parts.to_value()),
                "shows": shows,
            });
            if let Some(layout) = parts.layout() {
                card["layout"] = json!(layout.as_str());
            }
            card
        }
        PartsState::Kept(reason) => json!({
            "node": node,
            "state": "kept",
            "reason": reason.as_str(),
            "shows": shows,
        }),
    }
}

fn run_read(vector: &Value) -> Result<(), String> {
    let source = vector["source"].as_str().ok_or("manca source")?;
    let canvas = parse(source).map_err(|error| format!("la lavagna non si legge: {error}"))?;
    let reads = read_parts(&canvas);
    let given: Vec<Value> = reads
        .iter()
        .map(|read| as_vector(&canvas, &read.node, &read.state))
        .collect();
    let expected = vector
        .pointer("/expect/cards")
        .and_then(Value::as_array)
        .ok_or("manca expect.cards")?;
    if given != *expected {
        return Err(format!(
            "schede\n  date:   {}\n  attese: {}",
            Value::Array(given),
            Value::Array(expected.clone())
        ));
    }
    for read in &reads {
        let card = canvas
            .nodes
            .iter()
            .find(|card| card.id == read.node)
            .ok_or("la scheda non c'è")?;
        if let PartsState::Ok(parts) = &read.state {
            let original = encode(&card.extra[PARTS_KEY]);
            let rewritten = encode(&parts.to_value());
            if original != rewritten {
                return Err(format!(
                    "{}: il giro cambia il campo\n  prima: {original}\n  dopo:  {rewritten}",
                    read.node
                ));
            }
        }
        moving_keeps_parts(source, &read.node, &read.state)?;
    }
    Ok(())
}

/// Sposta la scheda `node` di 40 a destra: il tratto cambiato finisce prima
/// della chiave `fub:parts` della scheda, che resta byte per byte, e il campo
/// si rilegge uguale.
fn moving_keeps_parts(source: &str, node: &str, state: &PartsState) -> Result<(), String> {
    let mut core = Core::open(source).map_err(|error| error.to_string())?;
    let index = core
        .canvas()
        .nodes
        .iter()
        .position(|card| card.id == node)
        .ok_or("la scheda non c'è")?;
    let key = format!("\"{PARTS_KEY}\"");
    let at = source
        .match_indices(&key)
        .map(|(at, _)| at)
        .find(|&at| node_at(source, at) == Some(index))
        .ok_or_else(|| format!("{node}: la chiave non è nel sorgente"))?;
    let op = CanvasOp::Move {
        ids: vec![node.to_owned()],
        dx: 40,
        dy: 0,
    };
    let compiled = compile(core.canvas(), &[op], 0).map_err(|error| error.to_string())?;
    let committed = core
        .commit(&compiled.patches)
        .map_err(|error| error.to_string())?;
    if committed.edit.end > at {
        return Err(format!(
            "{node}: lo spostamento tocca il campo (cambia {}..{}, la chiave è a {at})",
            committed.edit.start, committed.edit.end
        ));
    }
    let moved = &core.canvas().nodes[index];
    if moved.x != 40 {
        return Err(format!("{node}: la scheda non si è spostata"));
    }
    if node_parts(moved).as_ref() != Some(state) {
        return Err(format!("{node}: il campo spostato si legge diverso"));
    }
    Ok(())
}

fn run_write(vector: &Value) -> Result<(), String> {
    let file = vector["file"].as_str().ok_or("manca file")?;
    // Un estratto che non si legge non si scrive, per la stessa ragione: un
    // campo che non vale (`writing_checks_like_reading` prova `write_parts`
    // sui campi dati a mano).
    let written = CanvasParts::from_value(&vector["parts"])
        .map_err(|_| PartsRefused::Field)
        .and_then(|parts| write_parts(file, &parts));
    let given = match written {
        Ok(write) => json!({
            "outcome": "written",
            "subpath": write.subpath,
            "parts": write.parts.as_ref().map(encode),
        }),
        Err(reason) => json!({ "outcome": "refused", "reason": reason.as_str() }),
    };
    if given != vector["expect"] {
        return Err(format!(
            "scritto\n  dato:   {given}\n  atteso: {}",
            vector["expect"]
        ));
    }
    Ok(())
}

#[test]
fn every_parts_vector_reads_and_writes_like_typescript() {
    let vectors = read_vectors();
    let reads = vectors
        .iter()
        .filter(|(file, _)| file.starts_with("read-"))
        .count();
    let writes = vectors
        .iter()
        .filter(|(file, _)| file.starts_with("write-"))
        .count();
    assert_eq!(
        reads, READ_VECTORS,
        "i vettori di lettura sono {READ_VECTORS}"
    );
    assert_eq!(
        writes, WRITE_VECTORS,
        "i vettori di scrittura sono {WRITE_VECTORS}"
    );
    assert_eq!(vectors.len(), reads + writes, "solo read-* e write-*");
    let failures: Vec<String> = vectors
        .iter()
        .filter_map(|(file, vector)| {
            if vector["name"].as_str() != Some(file.as_str()) {
                return Some(format!("{file}: name non è il nome del file"));
            }
            let outcome = if file.starts_with("read-") {
                run_read(vector)
            } else {
                run_write(vector)
            };
            outcome.err().map(|error| format!("{file}: {error}"))
        })
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

/// Il caso del piano, scritto per intero: un `fub:parts` di una specie futura
/// torna identico dopo uno spostamento, e cambia solo `x`.
#[test]
fn a_future_kind_survives_a_move_byte_for_byte() {
    let before = concat!(
        "{\n  \"nodes\": [\n",
        "    { \"id\": \"n1\", \"type\": \"file\", \"file\": \"Conti.xlsx\", \"subpath\": \"#Foglio1\", \"x\": 0, \"y\": 0, \"width\": 400, \"height\": 500,\n",
        "      \"fub:parts\": { \"kind\": \"cells\", \"sheet\": \"Foglio1\", \"range\": \"A1:C9\", \"zoom\": 1.50 } }\n",
        "  ],\n  \"edges\": []\n}\n",
    );
    let after = before.replacen("\"x\": 0", "\"x\": 40", 1);
    let mut core = Core::open(before).expect("la lavagna si apre");
    let op = CanvasOp::Move {
        ids: vec!["n1".to_owned()],
        dx: 40,
        dy: 0,
    };
    let compiled = compile(core.canvas(), &[op], 0).expect("lo spostamento si compila");
    let committed = core
        .commit(&compiled.patches)
        .expect("lo spostamento si scrive");
    assert_eq!(committed.source, after);
}

/// Un estratto che non si legge non si scrive: la scrittura rifà il controllo
/// della lettura sui campi dati a mano.
#[test]
fn writing_checks_like_reading() {
    use fub_canvas_core::parts::{PartRect, PartsKind};
    let flat = CanvasParts::new(PartsKind::Image {
        rect: PartRect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 1.0,
        },
        rotate: None,
    });
    assert_eq!(write_parts("foto.png", &flat), Err(PartsRefused::Field));
    let empty = CanvasParts::new(PartsKind::Sections {
        sections: Vec::new(),
    });
    assert_eq!(write_parts("Nota.md", &empty), Err(PartsRefused::Field));
    let nan = CanvasParts::new(PartsKind::Image {
        rect: PartRect::WHOLE,
        rotate: Some(f64::NAN),
    });
    assert_eq!(write_parts("foto.png", &nan), Err(PartsRefused::Field));
}
