//! I vettori delle operazioni d'intento, scritti a mano
//! (`apps/client/src/__fixtures__/canvas-ops/`, uno per file).
//!
//! Ogni vettore ha `about`, `before` (una lavagna), `seed` facoltativo (0 se
//! manca), `ops` e `expect {outcome, after?, created?, error?}`. `outcome` è
//! `applied` (le operazioni si compilano: le toppe, applicate con `draft` a
//! `before`, danno `after`, e la loro inversa ridà `before`), `rejected`
//! (`compile` dà l'errore `error`: `kind`, `index` e, se c'è, `id`) o
//! `malformed` (le operazioni non si leggono). I modelli si confrontano come
//! valori JSON (R9). Il TypeScript leggerà gli stessi file.

use std::path::PathBuf;

use fub_canvas_core::ops::{compile, CanvasOp, Compiled, IdSource, OpError};
use fub_canvas_core::patch::{draft, inverse, same_value};
use fub_canvas_core::{parse, Canvas, CanvasNode, CanvasNodeType};
use serde_json::{json, Value};

const MIN_VECTORS: usize = 20;

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src/__fixtures__/canvas-ops")
}

/// I vettori, in ordine di nome: `(file, json)`. Un file che non si legge
/// fa fallire il test.
fn read_vectors() -> Vec<(String, Value)> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder())
        .expect("la cartella dei vettori")
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
            (name, json)
        })
        .collect()
}

/// Una lavagna del vettore, letta e validata come un file.
fn canvas(name: &str, field: &str, value: &Value) -> Canvas {
    let text = serde_json::to_string(value).expect("un valore JSON si scrive");
    parse(&text).unwrap_or_else(|e| panic!("{name}: {field} non è una lavagna valida: {e}"))
}

fn same_canvas(left: &Canvas, right: &Canvas) -> bool {
    let left = serde_json::to_value(left).expect("il modello si scrive");
    let right = serde_json::to_value(right).expect("il modello si scrive");
    same_value(&left, &right)
}

/// L'errore come lo scrive un vettore.
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
        OpError::TooMany { index, .. } => json!({"kind": "TooMany", "index": index}),
        OpError::Invalid { index, .. } => json!({"kind": "Invalid", "index": index}),
        OpError::UnknownStroke { index, id } => {
            json!({"kind": "UnknownStroke", "index": index, "id": id})
        }
        OpError::ForeignLayer { index, .. } => json!({"kind": "ForeignLayer", "index": index}),
    }
}

/// Controlla un vettore; dà il suo `outcome`.
fn check(name: &str, vector: &Value) -> String {
    let object = vector
        .as_object()
        .unwrap_or_else(|| panic!("{name}: non è un oggetto"));
    for key in object.keys() {
        assert!(
            matches!(key.as_str(), "about" | "before" | "seed" | "ops" | "expect"),
            "{name}: campo sconosciuto {key:?}"
        );
    }
    assert!(
        vector["about"]
            .as_str()
            .is_some_and(|about| !about.is_empty()),
        "{name}: manca `about`"
    );
    let before = canvas(name, "before", &vector["before"]);
    let seed = match &vector["seed"] {
        Value::Null => 0,
        seed => seed
            .as_u64()
            .unwrap_or_else(|| panic!("{name}: `seed` non è un intero senza segno")),
    };
    let expect = &vector["expect"];
    let outcome = expect["outcome"]
        .as_str()
        .unwrap_or_else(|| panic!("{name}: manca `expect.outcome`"))
        .to_owned();
    let ops: Result<Vec<CanvasOp>, _> = serde_json::from_value(vector["ops"].clone());
    match outcome.as_str() {
        "malformed" => {
            assert!(ops.is_err(), "{name}: le operazioni si leggono: {ops:?}");
        }
        "rejected" => {
            let ops = ops.unwrap_or_else(|e| panic!("{name}: le operazioni non si leggono: {e}"));
            let error = compile(&before, &ops, seed)
                .err()
                .unwrap_or_else(|| panic!("{name}: le operazioni si compilano"));
            assert_eq!(describe(&error), expect["error"], "{name}: {error}");
            assert_eq!(
                error.index(),
                expect["error"]["index"].as_u64().unwrap_or(u64::MAX) as usize
            );
        }
        "applied" => {
            let ops = ops.unwrap_or_else(|e| panic!("{name}: le operazioni non si leggono: {e}"));
            let Compiled { patches, created } = compile(&before, &ops, seed)
                .unwrap_or_else(|e| panic!("{name}: le operazioni non si compilano: {e}"));
            let after = draft(&before, &patches)
                .unwrap_or_else(|e| panic!("{name}: le toppe non si applicano: {e}"));
            let expected = canvas(name, "expect.after", &expect["after"]);
            assert!(
                same_canvas(&after, &expected),
                "{name}: il modello di dopo\n{}\nnon è quello atteso\n{}",
                serde_json::to_string_pretty(&after).unwrap_or_default(),
                serde_json::to_string_pretty(&expected).unwrap_or_default(),
            );
            after
                .validate()
                .unwrap_or_else(|e| panic!("{name}: il modello di dopo non è valido: {e}"));
            let back = draft(&after, &inverse(&patches))
                .unwrap_or_else(|e| panic!("{name}: l'inversa non si applica: {e}"));
            // Un arco tolto torna al suo posto (`at`, R11): l'inversa ridà
            // `before` con gli archi nel loro ordine.
            assert!(
                same_canvas(&back, &before),
                "{name}: l'inversa non ridà `before`:\n{}",
                serde_json::to_string_pretty(&back).unwrap_or_default(),
            );
            let expected_created: Vec<String> = match &expect["created"] {
                Value::Null => Vec::new(),
                list => serde_json::from_value(list.clone())
                    .unwrap_or_else(|e| panic!("{name}: `created` non è una lista di id: {e}")),
            };
            assert_eq!(created, expected_created, "{name}: gli id creati");
            // Stesso seme, stesse toppe.
            let again = compile(&before, &ops, seed).expect("si ricompila");
            assert_eq!(
                again.patches, patches,
                "{name}: la compilazione non è deterministica"
            );
        }
        other => panic!("{name}: `outcome` sconosciuto {other:?}"),
    }
    outcome
}

#[test]
fn ogni_vettore_passa() {
    let vectors = read_vectors();
    assert!(
        vectors.len() >= MIN_VECTORS,
        "servono almeno {MIN_VECTORS} vettori, ce ne sono {}",
        vectors.len()
    );
    let mut outcomes = Vec::new();
    for (name, vector) in &vectors {
        outcomes.push(check(name, vector));
    }
    for outcome in ["applied", "rejected", "malformed"] {
        assert!(
            outcomes.iter().any(|seen| seen == outcome),
            "nessun vettore con outcome {outcome:?}"
        );
    }
}

#[test]
fn ci_sono_i_vettori_del_cancello_e_del_passo() {
    let names: Vec<String> = read_vectors().into_iter().map(|(name, _)| name).collect();
    for name in [
        "agent-board.json",
        "move-with-ink.json",
        "add-strokes-board.json",
        "add-strokes-card.json",
        "add-strokes-seed-id.json",
        "erase-strokes.json",
        "erase-strokes-unknown.json",
        "add-strokes-foreign.json",
        "move-card-with-ink.json",
        "resize-card-with-ink.json",
        "remove-card-with-ink.json",
    ] {
        assert!(names.iter().any(|seen| seen == name), "manca {name}");
    }
}

#[test]
fn ogni_operazione_ha_un_vettore() {
    let mut seen = std::collections::HashSet::new();
    for (_, vector) in read_vectors() {
        for op in vector["ops"].as_array().into_iter().flatten() {
            if let Some(op) = op["op"].as_str() {
                seen.insert(op.to_owned());
            }
        }
    }
    for op in [
        "add_card",
        "move",
        "resize",
        "connect",
        "remove",
        "set",
        "reorder",
        "add_strokes",
        "erase_strokes",
    ] {
        assert!(seen.contains(op), "nessun vettore usa {op:?}");
    }
}

fn text_node(id: String) -> CanvasNode {
    CanvasNode {
        id,
        node_type: CanvasNodeType::Text,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        color: None,
        text: Some(String::new()),
        file: None,
        subpath: None,
        url: None,
        label: None,
        background: None,
        background_style: None,
        extra: serde_json::Map::new(),
    }
}

/// La centomillesima scheda c'è, la centomilaunesima no: `TooMany`, mai un
/// modello oltre il limite. Troppo grande per un vettore su file.
#[test]
fn la_scheda_oltre_il_limite_e_too_many() {
    let canvas = Canvas {
        nodes: (0..99_999).map(|i| text_node(format!("n{i}"))).collect(),
        ..Canvas::default()
    };
    canvas.validate().expect("99 999 schede vanno bene");
    let card = json!({"op": "add_card", "node": {"type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": ""}});
    let ops: Vec<CanvasOp> =
        serde_json::from_value(json!([card.clone(), card])).expect("le operazioni si leggono");
    let error = compile(&canvas, &ops, 0).expect_err("la 100 001ª scheda non entra");
    assert!(
        matches!(
            error,
            OpError::TooMany {
                index: 1,
                what: "nodes",
                limit: 100_000
            }
        ),
        "{error:?}"
    );
    let one = compile(&canvas, &ops[..1], 0).expect("la 100 000ª scheda entra");
    let after = draft(&canvas, &one.patches).expect("le toppe si applicano");
    assert_eq!(after.nodes.len(), 100_000);
    after.validate().expect("il modello di dopo è valido");
}

/// SplitMix64 col seme 0 dà per primo 0xe220a8397b1dcdaf, il valore di
/// riferimento dell'algoritmo; i seguenti sono quelli dei vettori.
#[test]
fn il_seme_da_gli_id_di_splitmix64() {
    let mut ids = IdSource::new(0);
    assert_eq!(ids.next_id(), "e220a8397b1dcdaf");
    assert_eq!(ids.next_id(), "6e789e6aa1b965f4");
    let mut ids = IdSource::new(u64::MAX);
    let id = ids.next_id();
    assert_eq!(id.len(), 16);
    assert!(id
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
}

/// Un errore non lascia toppe a metà e non cambia il modello: `compile`
/// prende il modello per riferimento e dà tutto o niente.
#[test]
fn un_errore_non_da_toppe() {
    let canvas = parse(
        r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a"}]}"#,
    )
    .expect("si legge");
    let ops: Vec<CanvasOp> = serde_json::from_value(json!([
        {"op": "move", "ids": ["a"], "dx": 5, "dy": 5},
        {"op": "remove", "ids": ["b"]}
    ]))
    .expect("le operazioni si leggono");
    let error = compile(&canvas, &ops, 0).expect_err("b non c'è");
    assert_eq!(error.index(), 1);
    assert_eq!(
        error.to_string(),
        "canvas op 1: there is no node or edge \"b\""
    );
}

/// Le operazioni si riscrivono nella forma in cui si leggono.
#[test]
fn le_operazioni_si_riscrivono_uguali() {
    let ops = json!([
        {"op": "add_card", "node": {"type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": ""}},
        {"op": "move", "ids": ["a"], "dx": 1, "dy": -1},
        {"op": "resize", "id": "a", "width": 2, "height": 3},
        {"op": "connect", "edge": {"fromNode": "a", "toNode": "b"}},
        {"op": "remove", "ids": ["a"]},
        {"op": "set", "id": "a", "fields": {"color": null}},
        {"op": "reorder", "ids": ["a"]},
        {"op": "add_strokes", "layer": {"node": "a"}, "strokes": [{"tool": "pen"}]},
        {"op": "erase_strokes", "layer": "board", "ids": ["s1"]}
    ]);
    let read: Vec<CanvasOp> = serde_json::from_value(ops.clone()).expect("si leggono");
    assert_eq!(serde_json::to_value(&read).expect("si scrivono"), ops);
}
