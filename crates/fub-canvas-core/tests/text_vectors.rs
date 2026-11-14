//! I vettori della misura e dell'allineamento del testo, scritti a mano
//! (`apps/client/src/__fixtures__/canvas-text/`): la stessa cartella che
//! `apps/client/src/editors/canvas/text-style.test.ts` fa girare sul lettore
//! TypeScript. Le regole sono nella sezione «La misura e l'allineamento del
//! testo» di `docs/reference/canvas-format.md`. Un vettore che non passa si
//! corregge nel lettore, non nel vettore.
//!
//! - `read-*.json`: il testo di una `.canvas` (`source`) e, per ogni scheda
//!   col campo `fub:text`, nell'ordine di `nodes`, che cosa se ne legge:
//!   valido (`ok`, col campo riscritto come `JSON.stringify` in `text`) o
//!   conservato (`kept`, con la ragione), e come la scheda si mostra (`size`,
//!   `align`). Su ogni vettore si prova anche il giro (il campo riscritto è
//!   uguale per valore a quello letto, i campi noti nel loro ordine) e lo
//!   spostamento:
//!   spostare la scheda non tocca un byte del suo `fub:text`.
//! - `write-*.json`: una scheda (`node`), la misura e l'allineamento scelti
//!   (`style`) e che cosa Fub scrive: `written`, col campo come
//!   `JSON.stringify` (`null`: niente campo), o `refused` con la ragione.

use std::path::PathBuf;

use fub_canvas_core::commit::Core;
use fub_canvas_core::js::encode;
use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::source::node_at;
use fub_canvas_core::text::{
    node_text, read_text, text_style, write_text, TextAlign, TextSize, TextState, TextStyle,
    TEXT_KEY,
};
use fub_canvas_core::{parse, Canvas};
use serde_json::{json, Value};

/// Quanti vettori: gli stessi che conta il test TypeScript. Uno che sparisce
/// si vede qui.
const READ_VECTORS: usize = 20;
const WRITE_VECTORS: usize = 14;

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src/__fixtures__/canvas-text")
}

/// I vettori, in ordine di nome: `(nome senza .json, json)`.
fn vectors() -> Vec<(String, Value)> {
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
fn as_vector(canvas: &Canvas, node: &str, state: &TextState) -> Value {
    let card = canvas
        .nodes
        .iter()
        .find(|card| card.id == node)
        .expect("la scheda c'è");
    let shown = text_style(card);
    assert_eq!(shown, state.style(), "{node}: text_style e lo stato");
    let mut out = match state {
        TextState::Ok(text) => {
            json!({ "node": node, "state": "ok", "text": encode(&text.to_value()) })
        }
        TextState::Kept(reason) => {
            json!({ "node": node, "state": "kept", "reason": reason.as_str() })
        }
    };
    out["size"] = json!(shown.size.as_str());
    out["align"] = json!(shown.align.as_str());
    out
}

fn run_read(vector: &Value) -> Result<(), String> {
    let source = vector["source"].as_str().ok_or("manca source")?;
    let canvas = parse(source).map_err(|error| format!("la lavagna non si legge: {error}"))?;
    let reads = read_text(&canvas);
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
        if let TextState::Ok(text) = &read.state {
            // Uguale per valore: i campi noti tornano nel loro ordine.
            let original = &card.extra[TEXT_KEY];
            let rewritten = text.to_value();
            if *original != rewritten {
                return Err(format!(
                    "{}: il giro cambia il campo\n  prima: {original}\n  dopo:  {rewritten}",
                    read.node
                ));
            }
        }
        moving_keeps_text(source, &read.node, &read.state)?;
    }
    Ok(())
}

/// Sposta la scheda `node` di 40 a destra: il tratto cambiato finisce prima
/// della chiave `fub:text` della scheda, che resta byte per byte, e il campo
/// si rilegge uguale.
fn moving_keeps_text(source: &str, node: &str, state: &TextState) -> Result<(), String> {
    let mut core = Core::open(source).map_err(|error| error.to_string())?;
    let index = core
        .canvas()
        .nodes
        .iter()
        .position(|card| card.id == node)
        .ok_or("la scheda non c'è")?;
    let key = format!("\"{TEXT_KEY}\"");
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
    if node_text(moved).as_ref() != Some(state) {
        return Err(format!("{node}: il campo spostato si legge diverso"));
    }
    Ok(())
}

fn run_write(vector: &Value) -> Result<(), String> {
    let source = json!({ "nodes": [vector["node"].clone()], "edges": [] }).to_string();
    let canvas = parse(&source).map_err(|error| format!("la scheda non si legge: {error}"))?;
    let node = canvas.nodes.first().ok_or("manca la scheda")?;
    let size = vector
        .pointer("/style/size")
        .and_then(Value::as_str)
        .and_then(TextSize::parse)
        .ok_or("style.size non vale")?;
    let align = vector
        .pointer("/style/align")
        .and_then(Value::as_str)
        .and_then(TextAlign::parse)
        .ok_or("style.align non vale")?;
    let given = match write_text(node, TextStyle { size, align }) {
        Ok(text) => json!({ "outcome": "written", "text": text.as_ref().map(encode) }),
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
fn every_text_vector_reads_and_writes_like_typescript() {
    let vectors = vectors();
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

/// Il caso del piano, scritto per intero: un `fub:text` di una versione
/// futura torna identico dopo uno spostamento, e cambia solo `x`.
#[test]
fn a_future_version_survives_a_move_byte_for_byte() {
    let before = concat!(
        "{\n  \"nodes\": [\n",
        "    { \"id\": \"t1\", \"type\": \"text\", \"text\": \"# Titolo\", \"x\": 0, \"y\": 0, \"width\": 300, \"height\": 120,\n",
        "      \"fub:text\": { \"v\": 2, \"size\": \"xxl\", \"leading\": 1.50 } }\n",
        "  ],\n  \"edges\": []\n}\n",
    );
    let after = before.replacen("\"x\": 0", "\"x\": 40", 1);
    let mut core = Core::open(before).expect("la lavagna si apre");
    let op = CanvasOp::Move {
        ids: vec!["t1".to_owned()],
        dx: 40,
        dy: 0,
    };
    let compiled = compile(core.canvas(), &[op], 0).expect("lo spostamento si compila");
    let committed = core
        .commit(&compiled.patches)
        .expect("lo spostamento si scrive");
    assert_eq!(committed.source, after);
}

/// I nomi nel file sono quelli dei vettori e del TypeScript, e i valori di
/// serie sono `m` e `start`.
#[test]
fn names_and_defaults() {
    let sizes: Vec<&str> = TextSize::ALL.iter().map(|size| size.as_str()).collect();
    assert_eq!(sizes, ["s", "m", "l", "xl"]);
    let aligns: Vec<&str> = TextAlign::ALL.iter().map(|align| align.as_str()).collect();
    assert_eq!(aligns, ["start", "center", "end"]);
    assert_eq!(
        TextStyle::default(),
        TextStyle {
            size: TextSize::M,
            align: TextAlign::Start
        }
    );
    for size in TextSize::ALL {
        assert_eq!(TextSize::parse(size.as_str()), Some(size));
    }
    for align in TextAlign::ALL {
        assert_eq!(TextAlign::parse(align.as_str()), Some(align));
    }
}
