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
        OpError::TooMany { index, .. } | OpError::TooManyMoved { index, .. } => {
            json!({"kind": "TooMany", "index": index})
        }
        OpError::Invalid { index, .. } => json!({"kind": "Invalid", "index": index}),
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
    for name in ["agent-board.json", "move-with-ink.json"] {
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
        "color",
        "align",
        "distribute",
        "duplicate",
        "reverse",
        "group",
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

/// Un gruppo `g` grande quanto la lavagna, con `inside` schede di testo dentro
/// (`c0`, `c1`…): il `move` con `contents` le porta tutte.
fn canvas_with_group(inside: usize) -> Canvas {
    let mut group = text_node("g".to_owned());
    group.node_type = CanvasNodeType::Group;
    group.text = None;
    group.width = 10_000;
    group.height = 10_000;
    let mut nodes = vec![group];
    for i in 0..inside {
        let mut card = text_node(format!("c{i}"));
        card.x = i64::try_from(i % 100).expect("una colonna") * 20 + 10;
        card.y = i64::try_from(i / 100).expect("una riga") * 20 + 10;
        nodes.push(card);
    }
    let canvas = Canvas {
        nodes,
        ..Canvas::default()
    };
    canvas.validate().expect("il gruppo e le schede vanno bene");
    canvas
}

fn move_ops(value: Value) -> Vec<CanvasOp> {
    serde_json::from_value(json!([value])).expect("la lista si legge")
}

/// Il tetto di `move` con `contents` conta le schede che tocca: quelle di `ids`
/// e quelle dei gruppi, una volta sola. Mille vanno bene, mille e una no.
#[test]
fn move_con_contents_tocca_al_piu_mille_schede_e_oltre_e_too_many_moved() {
    let ops = move_ops(json!({ "op": "move", "ids": ["g"], "dx": 5, "dy": 0, "contents": true }));
    // Il gruppo e 999 schede dentro: 1000 toccate, al tetto.
    let canvas = canvas_with_group(999);
    let compiled = compile(&canvas, &ops, 0).expect("mille schede entrano");
    assert_eq!(compiled.patches.len(), 1000);
    let after = draft(&canvas, &compiled.patches).expect("le toppe si applicano");
    after.validate().expect("il modello di dopo è valido");
    let moved = after
        .nodes
        .iter()
        .zip(&canvas.nodes)
        .filter(|(new, old)| new.x == old.x + 5)
        .count();
    assert_eq!(moved, 1000, "ogni scheda si sposta una volta sola");

    // Il gruppo e 1000 schede dentro: 1001, oltre il tetto.
    let canvas = canvas_with_group(1000);
    let error = compile(&canvas, &ops, 0).expect_err("oltre il tetto non si compila");
    assert_eq!(
        error,
        OpError::TooManyMoved {
            index: 0,
            limit: 1000
        }
    );
    assert!(error.to_string().contains("at most 1000 cards"), "{error}");

    // `c0` è in `ids` e dentro il gruppo: conta una volta sola, quindi con 999
    // schede dentro il totale è ancora 1000, e con 1000 è 1001.
    let listed = move_ops(json!({
        "op": "move", "ids": ["g", "c0"], "dx": 5, "dy": 0, "contents": true
    }));
    assert!(compile(&canvas_with_group(999), &listed, 0).is_ok());
    assert!(matches!(
        compile(&canvas, &listed, 0),
        Err(OpError::TooManyMoved { index: 0, .. })
    ));
}

/// Il tetto è di `contents`: uno spostamento senza `contents` non ne ha, e con
/// `contents` le `ids` da sole contano prima di cercare i gruppi.
#[test]
fn move_senza_contents_non_ha_il_tetto_e_con_contents_le_ids_oltre_il_tetto_si_rifiutano() {
    let canvas = Canvas {
        nodes: (0..1001).map(|i| text_node(format!("t{i}"))).collect(),
        ..Canvas::default()
    };
    let ids: Vec<String> = (0..1001).map(|i| format!("t{i}")).collect();
    let plain = move_ops(json!({ "op": "move", "ids": ids, "dx": 1, "dy": 0 }));
    let compiled = compile(&canvas, &plain, 0).expect("senza contents non c'è tetto");
    assert_eq!(compiled.patches.len(), 1001);

    let with_contents =
        move_ops(json!({ "op": "move", "ids": ids, "dx": 1, "dy": 0, "contents": true }));
    assert_eq!(
        compile(&canvas, &with_contents, 0).expect_err("oltre il tetto"),
        OpError::TooManyMoved {
            index: 0,
            limit: 1000
        }
    );
}

/// L'errore dice la posizione dell'operazione che lo causa, e la lista non dà
/// toppe a metà: con un errore non esce niente.
#[test]
fn il_tetto_dice_la_posizione_dell_operazione() {
    let canvas = canvas_with_group(1000);
    let ops: Vec<CanvasOp> = serde_json::from_value(json!([
        { "op": "move", "ids": ["c0"], "dx": 1, "dy": 0 },
        { "op": "move", "ids": ["g"], "dx": 5, "dy": 0, "contents": true }
    ]))
    .expect("la lista si legge");
    let error = compile(&canvas, &ops, 0).expect_err("la seconda operazione è oltre il tetto");
    assert_eq!(error.index(), 1);
    assert!(matches!(error, OpError::TooManyMoved { .. }), "{error:?}");
}

/// Duplicare e raggruppare oltre il limite danno `TooMany`, come aggiungere una
/// scheda: la copia che porta a 100 000 entra, la successiva no. Un gruppo conta
/// come scheda.
#[test]
fn duplicare_e_raggruppare_oltre_il_limite_e_too_many() {
    let canvas = Canvas {
        nodes: (0..99_999).map(|i| text_node(format!("n{i}"))).collect(),
        ..Canvas::default()
    };
    let two: Vec<CanvasOp> =
        serde_json::from_value(json!([{"op": "duplicate", "ids": ["n0", "n1"]}]))
            .expect("l'operazione si legge");
    let error = compile(&canvas, &two, 0).expect_err("due copie superano il limite");
    assert!(
        matches!(
            error,
            OpError::TooMany {
                index: 0,
                what: "nodes",
                limit: 100_000
            }
        ),
        "{error:?}"
    );
    let ops: Vec<CanvasOp> = serde_json::from_value(json!([
        {"op": "duplicate", "ids": ["n0"]},
        {"op": "group", "ids": ["n1"]}
    ]))
    .expect("le operazioni si leggono");
    let error = compile(&canvas, &ops, 0).expect_err("il gruppo sarebbe la 100 001ª scheda");
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
    let one = compile(&canvas, &ops[..1], 0).expect("la copia è la 100 000ª scheda");
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
        {"op": "align", "ids": ["a", "b"], "to": "middle"},
        {"op": "distribute", "ids": ["a", "b", "c"], "axis": "y"},
        {"op": "duplicate", "ids": ["a"]},
        {"op": "duplicate", "ids": ["a"], "dx": 0, "dy": 216, "as": ["b"]},
        {"op": "reverse", "ids": ["e1"]},
        {"op": "group", "ids": ["a"], "id": "g", "label": "Gruppo", "color": "red"}
    ]);
    let read: Vec<CanvasOp> = serde_json::from_value(ops.clone()).expect("si leggono");
    assert_eq!(serde_json::to_value(&read).expect("si scrivono"), ops);
}
