//! Le coppie testo → lavagna di `from_mermaid` e `from_outline`
//! (`apps/client/src/__fixtures__/canvas-import/`, una per file).
//!
//! Ogni coppia ha `about`, `before` (una lavagna, vuota se manca), `seed`
//! facoltativo (0 se manca), `op` (l'operazione, col testo) ed
//! `expect {outcome, after?, created?, notes?, notes_omitted?, error?}`.
//! `outcome` è `applied` (l'operazione si compila: le toppe applicate a
//! `before` danno `after`, l'inversa ridà `before`, e le note sono `notes`) o
//! `rejected` (`compile` dà l'errore `error`: `kind`, `index` e, se c'è, `id`).
//!
//! `UPDATE_MIRROR=1 cargo test -p fub-canvas-core --test import_vectors`
//! riscrive `expect` di ogni coppia con ciò che il nucleo dà, tenendo
//! `outcome`: il diff si rilegge prima di tenerlo.

use std::path::PathBuf;

use fub_canvas_core::check::{check, WarningCode};
use fub_canvas_core::ops::{compile, CanvasOp, OpError, MAX_NOTES};
use fub_canvas_core::patch::{draft, inverse, same_value};
use fub_canvas_core::{parse, Canvas, CanvasNodeType};
use serde_json::{json, Map, Value};

/// Le coppie sono quindici o più: con meno la cartella è sbagliata.
const MIN_PAIRS: usize = 15;

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/canvas-import")
}

fn updating() -> bool {
    std::env::var_os("UPDATE_MIRROR").is_some_and(|value| value == "1")
}

/// Le coppie, in ordine di nome: `(percorso, nome, json)`.
fn read_pairs() -> Vec<(PathBuf, String, Value)> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder())
        .expect("la cartella delle coppie")
        .map(|entry| entry.expect("una voce della cartella").path())
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .expect("un nome di file")
                .to_string_lossy()
                .into_owned();
            assert!(name.ends_with(".json"), "{name}: solo file .json");
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let json = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (path, name, json)
        })
        .collect()
}

fn canvas_of(name: &str, value: &Value) -> Canvas {
    if value.is_null() {
        return Canvas::default();
    }
    let text = serde_json::to_string(value).expect("un valore JSON si scrive");
    parse(&text).unwrap_or_else(|e| panic!("{name}: non è una lavagna valida: {e}"))
}

fn as_value(canvas: &Canvas) -> Value {
    serde_json::to_value(canvas).expect("il modello si scrive")
}

/// L'errore come lo scrive una coppia.
fn describe(error: &OpError) -> Value {
    match error {
        OpError::UnknownNode { index, id } => {
            json!({"kind": "UnknownNode", "index": index, "id": id})
        }
        OpError::UnknownEdge { index, id } => {
            json!({"kind": "UnknownEdge", "index": index, "id": id})
        }
        OpError::DuplicateId { index, id } => {
            json!({"kind": "DuplicateId", "index": index, "id": id})
        }
        OpError::TooMany { index, .. } | OpError::TooManyMoved { index, .. } => {
            json!({"kind": "TooMany", "index": index})
        }
        OpError::Invalid { index, .. } => json!({"kind": "Invalid", "index": index}),
    }
}

/// Ciò che il nucleo dà per una coppia, nella forma di `expect`.
fn outcome_of(name: &str, pair: &Value) -> Value {
    let object = pair
        .as_object()
        .unwrap_or_else(|| panic!("{name}: non è un oggetto"));
    for key in object.keys() {
        assert!(
            matches!(key.as_str(), "about" | "before" | "seed" | "op" | "expect"),
            "{name}: campo sconosciuto {key:?}"
        );
    }
    assert!(
        pair["about"]
            .as_str()
            .is_some_and(|about| !about.is_empty()),
        "{name}: manca `about`"
    );
    let op_name = pair["op"]["op"].as_str().unwrap_or_default();
    assert!(
        matches!(op_name, "from_mermaid" | "from_outline"),
        "{name}: l'operazione è from_mermaid o from_outline, non {op_name:?}"
    );
    let before = canvas_of(name, &pair["before"]);
    let seed = match &pair["seed"] {
        Value::Null => 0,
        seed => seed
            .as_u64()
            .unwrap_or_else(|| panic!("{name}: `seed` non è un intero senza segno")),
    };
    let op: CanvasOp = serde_json::from_value(pair["op"].clone())
        .unwrap_or_else(|e| panic!("{name}: l'operazione non si legge: {e}"));
    let ops = vec![op];
    match compile(&before, &ops, seed) {
        Err(error) => json!({"outcome": "rejected", "error": describe(&error)}),
        Ok(compiled) => {
            let after = draft(&before, &compiled.patches)
                .unwrap_or_else(|e| panic!("{name}: le toppe non si applicano: {e}"));
            after
                .validate()
                .unwrap_or_else(|e| panic!("{name}: il modello di dopo non è valido: {e}"));
            let back = draft(&after, &inverse(&compiled.patches))
                .unwrap_or_else(|e| panic!("{name}: l'inversa non si applica: {e}"));
            assert!(
                same_value(&as_value(&back), &as_value(&before)),
                "{name}: l'inversa non ridà `before`"
            );
            let again = compile(&before, &ops, seed).expect("si ricompila");
            assert_eq!(
                again, compiled,
                "{name}: la compilazione non è deterministica"
            );
            let mut expect = Map::new();
            expect.insert("outcome".to_owned(), json!("applied"));
            expect.insert("after".to_owned(), as_value(&after));
            expect.insert("created".to_owned(), json!(compiled.created));
            expect.insert("notes".to_owned(), json!(compiled.notes));
            if compiled.notes_omitted > 0 {
                expect.insert("notes_omitted".to_owned(), json!(compiled.notes_omitted));
            }
            Value::Object(expect)
        }
    }
}

#[test]
fn ogni_coppia_passa() {
    let pairs = read_pairs();
    assert!(
        pairs.len() >= MIN_PAIRS,
        "servono almeno {MIN_PAIRS} coppie, ce ne sono {}",
        pairs.len()
    );
    let mut failures = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for (path, name, pair) in &pairs {
        let got = outcome_of(name, pair);
        let wanted_outcome = pair["expect"]["outcome"].as_str().unwrap_or_default();
        assert!(
            matches!(wanted_outcome, "applied" | "rejected"),
            "{name}: `expect.outcome` è applied o rejected"
        );
        seen.insert((
            pair["op"]["op"].as_str().unwrap_or_default().to_owned(),
            wanted_outcome.to_owned(),
        ));
        if got["outcome"] != wanted_outcome {
            failures.push(format!(
                "{name}: atteso {wanted_outcome}, dato {}",
                serde_json::to_string_pretty(&got).unwrap_or_default()
            ));
            continue;
        }
        if updating() {
            let mut updated = pair.clone();
            updated["expect"] = got;
            let text = serde_json::to_string_pretty(&updated).expect("si scrive") + "\n";
            std::fs::write(path, text).unwrap_or_else(|e| panic!("{name}: {e}"));
            continue;
        }
        if !same_value(&got, &pair["expect"]) {
            failures.push(format!(
                "{name}: dato\n{}\natteso\n{}",
                serde_json::to_string_pretty(&got).unwrap_or_default(),
                serde_json::to_string_pretty(&pair["expect"]).unwrap_or_default()
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    for op in ["from_mermaid", "from_outline"] {
        for outcome in ["applied", "rejected"] {
            assert!(
                seen.contains(&(op.to_owned(), outcome.to_owned())),
                "nessuna coppia {op} con outcome {outcome}"
            );
        }
    }
}

fn mermaid(text: &str) -> Vec<CanvasOp> {
    vec![serde_json::from_value(json!({"op": "from_mermaid", "text": text})).expect("si legge")]
}

fn outline(text: &str) -> Vec<CanvasOp> {
    vec![serde_json::from_value(json!({"op": "from_outline", "text": text})).expect("si legge")]
}

fn too_many(error: OpError) -> (&'static str, usize) {
    match error {
        OpError::TooMany { what, limit, .. } => (what, limit),
        other => panic!("atteso TooMany, dato {other}"),
    }
}

/// Duemila nodi entrano, duemila e uno sono `TooMany`. Troppo grande per una
/// coppia su file.
#[test]
fn mermaid_porta_al_piu_duemila_nodi() {
    let chain = |count: usize| {
        let mut text = String::from("flowchart TD\n");
        for i in 0..count {
            text.push_str(&format!("n{i}\n"));
        }
        text
    };
    let compiled = compile(&Canvas::default(), &mermaid(&chain(2000)), 0).expect("duemila entrano");
    assert_eq!(compiled.created.len(), 2000);
    let error = compile(&Canvas::default(), &mermaid(&chain(2001)), 0).expect_err("oltre no");
    assert_eq!(too_many(error), ("cards and groups in one import", 2000));
}

#[test]
fn la_scaletta_porta_al_piu_duemila_righe() {
    let lines = |count: usize| {
        (0..count)
            .map(|i| format!("riga {i}\n"))
            .collect::<String>()
    };
    compile(&Canvas::default(), &outline(&lines(2000)), 0).expect("duemila entrano");
    let error = compile(&Canvas::default(), &outline(&lines(2001)), 0).expect_err("oltre no");
    assert_eq!(too_many(error), ("cards in one import", 2000));
}

/// Un testo di più di 256 KiB è `TooMany`, anche se fatto di spazi.
#[test]
fn il_testo_porta_al_piu_256_kib() {
    let mut text = String::from("a\n");
    text.push_str(&" ".repeat(256 * 1024 - text.len()));
    compile(&Canvas::default(), &outline(&text), 0).expect("256 KiB entrano");
    text.push(' ');
    let error = compile(&Canvas::default(), &outline(&text), 0).expect_err("oltre no");
    assert_eq!(too_many(error), ("bytes of text in one import", 256 * 1024));
    let error = compile(
        &Canvas::default(),
        &mermaid(&format!("graph TD\nA{text}")),
        0,
    )
    .expect_err("oltre no");
    assert_eq!(too_many(error).1, 256 * 1024);
}

/// Un `&` moltiplica gli archi: una riga di cento per cento nodi ne fa
/// diecimila, che entrano; uno in più è `TooMany`, prima di farli.
#[test]
fn gli_archi_di_un_import_hanno_un_tetto() {
    let side = |letter: char| {
        (0..100)
            .map(|i| format!("{letter}{i}"))
            .collect::<Vec<_>>()
            .join(" & ")
    };
    let text = format!("graph LR\n{} --> {}", side('a'), side('b'));
    let compiled = compile(&Canvas::default(), &mermaid(&text), 0).expect("diecimila entrano");
    assert_eq!(compiled.created.len(), 200 + 10_000);
    let error = compile(&Canvas::default(), &mermaid(&format!("{text}\nx --> y")), 0)
        .expect_err("oltre no");
    assert_eq!(too_many(error), ("edges in one import", 10_000));
}

/// Le note sono al più cento; le altre si contano, e il controllo le conta
/// fra gli avvisi omessi.
#[test]
fn le_note_hanno_un_tetto_e_il_controllo_le_conta() {
    let mut text = String::from("graph TD\nA\n");
    for i in 0..150 {
        text.push_str(&format!("style A fill:#{i:03}\n"));
    }
    let compiled = compile(&Canvas::default(), &mermaid(&text), 0).expect("si compila");
    assert_eq!(compiled.notes.len(), MAX_NOTES);
    assert_eq!(compiled.notes_omitted, 50);
    let report = check(
        &Canvas::default(),
        &json!([{"op": "from_mermaid", "text": text}]),
        0,
    );
    assert!(report.ok);
    assert_eq!(report.warnings.len(), 100);
    assert_eq!(report.warnings_omitted, 50);
    assert!(report
        .warnings
        .iter()
        .all(|warning| warning.code == WarningCode::LineSkipped
            && warning.index == Some(0)
            && warning.ids.is_empty()));
}

/// Il controllo dice le note come avvisi, con l'operazione e il dettaglio.
#[test]
fn il_controllo_mostra_le_note() {
    let report = check(
        &Canvas::default(),
        &json!([
            {"op": "add_card", "text": "Prima"},
            {"op": "from_mermaid", "text": "graph LR\nA((Cerchio)) -.-> B"}
        ]),
        0,
    );
    assert!(report.ok, "{:?}", report.problems);
    let codes: Vec<(WarningCode, Option<usize>)> = report
        .warnings
        .iter()
        .map(|warning| (warning.code, warning.index))
        .collect();
    assert_eq!(
        codes,
        vec![
            (WarningCode::ShapeDropped, Some(1)),
            (WarningCode::StyleDropped, Some(1))
        ]
    );
    assert!(report.warnings[0]
        .detail
        .as_deref()
        .is_some_and(|detail| detail.contains("circle")));
    let value = serde_json::to_value(&report.warnings[0]).expect("si scrive");
    assert_eq!(value["code"], "shape_dropped");
    assert_eq!(value["index"], 1);
}

/// Un id già preso è `DuplicateId`, e il controllo suggerisce un `prefix` con cui
/// l'operazione si compila.
#[test]
fn un_id_preso_suggerisce_un_prefix() {
    let before = canvas_of(
        "prova",
        &json!({"nodes": [
            {"id": "A", "type": "text", "x": 0, "y": 0, "width": 320, "height": 160, "text": "c'era"},
            {"id": "m1-B", "type": "text", "x": 0, "y": 200, "width": 320, "height": 160, "text": "anche"}
        ], "edges": []}),
    );
    let report = check(
        &before,
        &json!([{"op": "from_mermaid", "text": "graph TD\nA --> B"}]),
        0,
    );
    assert!(!report.ok);
    let problem = &report.problems[0];
    assert_eq!(problem.path, "/0");
    assert_eq!(problem.suggestion.as_deref(), Some("m2-"));
    let report = check(
        &before,
        &json!([{"op": "from_outline", "text": "a\nb", "prefix": ""}]),
        0,
    );
    // Gli id della scaletta con `prefix` vuoto sono i numeri delle righe: liberi.
    assert!(report.ok);
    let report = check(
        &canvas_of(
            "prova",
            &json!({"nodes": [{"id": "1", "type": "text", "x": 0, "y": 0, "width": 320, "height": 160, "text": "uno"}], "edges": []}),
        ),
        &json!([{"op": "from_outline", "text": "a\nb", "prefix": ""}]),
        0,
    );
    assert_eq!(report.problems[0].suggestion.as_deref(), Some("s1-"));
}

/// I gruppi stanno sotto le loro schede, e il blocco intero sta accanto a ciò
/// che c'è: nessuna scheda nuova ne copre un'altra.
#[test]
fn i_gruppi_stanno_sotto_e_nessuna_scheda_ne_copre_un_altra() {
    let text = "flowchart TD\n  subgraph a [Fuori]\n    subgraph b [Dentro]\n      X --> Y\n    end\n    Z\n  end\n  W --> a";
    let compiled = compile(&Canvas::default(), &mermaid(text), 0).expect("si compila");
    let after = draft(&Canvas::default(), &compiled.patches).expect("si applica");
    let position = |id: &str| after.nodes.iter().position(|node| node.id == id);
    assert!(position("a") < position("b"));
    assert!(position("b") < position("X"));
    let cards: Vec<_> = after
        .nodes
        .iter()
        .filter(|node| node.node_type == CanvasNodeType::Text)
        .collect();
    for (i, first) in cards.iter().enumerate() {
        for second in &cards[i + 1..] {
            let apart = first.x + first.width <= second.x
                || second.x + second.width <= first.x
                || first.y + first.height <= second.y
                || second.y + second.height <= first.y;
            assert!(apart, "{} e {} si coprono", first.id, second.id);
        }
    }
    let inside = |card: &str, group: &str| {
        let card = &after.nodes[position(card).expect("la scheda")];
        let group = &after.nodes[position(group).expect("il gruppo")];
        card.x >= group.x + 24
            && card.y >= group.y + 24
            && card.x + card.width <= group.x + group.width - 24
            && card.y + card.height <= group.y + group.height - 24
    };
    assert!(inside("X", "b") && inside("Y", "b") && inside("b", "a") && inside("Z", "a"));
    assert!(!inside("W", "a"));
    // L'arco verso il blocco va al gruppo.
    assert!(after
        .edges
        .iter()
        .any(|edge| edge.from_node == "W" && edge.to_node == "a"));
}
