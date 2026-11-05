//! Le toppe sul modello: i casi di `apps/client/src/editors/canvas/operation.test.ts`
//! portati in Rust, più i casi limite del task. Per ogni lista di toppe che
//! si applica, l'inversa applicata dopo ridà il modello di prima.

use fub_canvas_core::patch::{
    apply, draft, inverse, remove_edge_patch, remove_node_patch, same_value, upsert_edge_patch,
    upsert_node_patch, CanvasPatch, Null, PatchError, Subject,
};
use fub_canvas_core::{parse, Canvas, CanvasEdge, CanvasEdgeEnd, CanvasNode};
use serde_json::{json, Value};

/// La lavagna di `source()` in `operation.test.ts`.
fn source() -> Canvas {
    parse(
        r##"{
  "nodes": [
    {"id":"n1","type":"text","x":0,"y":0,"width":200,"height":120,"text":"vedi [[Nota]] e #tag"},
    {"id":"n2","type":"file","x":300,"y":0,"width":200,"height":120,"file":"foto.png"}
  ],
  "edges": [{"id":"e1","fromNode":"n1","toNode":"n2","toEnd":"arrow","label":"usa"}],
  "xFuture": {"nested": [1, 2]}
}"##,
    )
    .expect("la lavagna di prova si legge")
}

fn three() -> Canvas {
    parse(
        r#"{"nodes":[
  {"id":"a","type":"text","x":0,"y":0,"width":100,"height":100,"text":"a"},
  {"id":"b","type":"text","x":120,"y":0,"width":100,"height":100,"text":"b"},
  {"id":"c","type":"text","x":240,"y":0,"width":100,"height":100,"text":"c"}
]}"#,
    )
    .expect("la lavagna di prova si legge")
}

fn node(canvas: &Canvas, id: &str) -> CanvasNode {
    canvas
        .nodes
        .iter()
        .find(|node| node.id == id)
        .cloned()
        .expect("la scheda c'è")
}

fn ids(canvas: &Canvas) -> Vec<&str> {
    canvas.nodes.iter().map(|node| node.id.as_str()).collect()
}

/// Applica `patches` a `before`, poi l'inversa al risultato, e controlla che
/// torni `before`. Dà il modello di dopo.
fn round_trip(before: &Canvas, patches: &[CanvasPatch]) -> Canvas {
    let after = draft(before, patches).expect("le toppe si applicano");
    let undo = inverse(patches);
    let back = draft(&after, &undo).expect("l'inversa si applica");
    assert_eq!(&back, before, "l'inversa ridà il modello di prima");
    after
}

fn to_json(patch: &CanvasPatch) -> String {
    serde_json::to_string(patch).expect("una toppa si scrive")
}

fn from_json(text: &str) -> CanvasPatch {
    serde_json::from_str(text).expect("una toppa si legge")
}

// ── La forma JSON ──────────────────────────────────────────────────────────

/// Ogni variante si scrive come la costruisce `operation.ts` (`kind`,
/// `before`, `after`, `at`), e si rilegge uguale. I JSON sono scritti a mano.
#[test]
fn every_patch_has_the_typescript_json_shape() {
    let canvas = source();
    let n1 = r#"{"id":"n1","type":"text","x":0,"y":0,"width":200,"height":120,"text":"vedi [[Nota]] e #tag"}"#;
    let n1_moved = r#"{"id":"n1","type":"text","x":8,"y":8,"width":200,"height":120,"text":"vedi [[Nota]] e #tag"}"#;
    let e1 = r#"{"id":"e1","fromNode":"n1","toNode":"n2","toEnd":"arrow","label":"usa"}"#;
    let e1_relabeled =
        r#"{"id":"e1","fromNode":"n1","toNode":"n2","toEnd":"arrow","label":"dipende"}"#;

    let mut moved = node(&canvas, "n1");
    moved.x = 8;
    moved.y = 8;
    let mut relabeled = canvas.edges[0].clone();
    relabeled.label = Some("dipende".into());

    let cases = [
        (
            upsert_node_patch(&canvas, &moved).expect("cambia"),
            format!(r#"{{"kind":"upsert-node","before":{n1},"after":{n1_moved}}}"#),
        ),
        (
            CanvasPatch::UpsertNode {
                before: None,
                after: node(&canvas, "n1"),
                at: Some(0),
            },
            format!(r#"{{"kind":"upsert-node","before":null,"after":{n1},"at":0}}"#),
        ),
        (
            remove_node_patch(&canvas, "n1").expect("c'è"),
            format!(r#"{{"kind":"remove-node","before":{n1},"after":null,"at":0}}"#),
        ),
        (
            upsert_edge_patch(&canvas, &relabeled).expect("cambia"),
            format!(r#"{{"kind":"upsert-edge","before":{e1},"after":{e1_relabeled}}}"#),
        ),
        (
            CanvasPatch::UpsertEdge {
                before: None,
                after: canvas.edges[0].clone(),
                at: None,
            },
            format!(r#"{{"kind":"upsert-edge","before":null,"after":{e1}}}"#),
        ),
        (
            CanvasPatch::UpsertEdge {
                before: None,
                after: canvas.edges[0].clone(),
                at: Some(0),
            },
            format!(r#"{{"kind":"upsert-edge","before":null,"after":{e1},"at":0}}"#),
        ),
        (
            remove_edge_patch(&canvas, "e1").expect("c'è"),
            format!(r#"{{"kind":"remove-edge","before":{e1},"after":null,"at":0}}"#),
        ),
        (
            CanvasPatch::RemoveEdge {
                before: canvas.edges[0].clone(),
                after: Null,
                at: None,
            },
            format!(r#"{{"kind":"remove-edge","before":{e1},"after":null}}"#),
        ),
        (
            CanvasPatch::Reorder {
                before: vec!["a".into(), "b".into()],
                after: vec!["b".into(), "a".into()],
            },
            r#"{"kind":"reorder","before":["a","b"],"after":["b","a"]}"#.to_owned(),
        ),
    ];
    for (patch, expected) in cases {
        assert_eq!(to_json(&patch), expected);
        assert_eq!(from_json(&expected), patch);
    }
}

/// Le chiavi si leggono in qualunque ordine, `kind` compreso, e i campi
/// sconosciuti delle schede viaggiano con la toppa.
#[test]
fn a_patch_reads_in_any_key_order_and_keeps_unknown_fields() {
    let patch = from_json(
        r#"{"at":1,"after":{"xVendor":{"keep":true},"text":"t","height":10,"width":10,"y":0,"x":0,"type":"text","id":"t"},"before":null,"kind":"upsert-node"}"#,
    );
    let CanvasPatch::UpsertNode {
        before: None,
        after,
        at: Some(1),
    } = &patch
    else {
        panic!("non è un upsert-node: {patch:?}");
    };
    assert_eq!(after.extra.get("xVendor"), Some(&json!({"keep": true})));
}

/// `after` di una toppa che toglie è `null` e nient'altro; un `kind` che non
/// esiste e un `at` che non è una posizione sono errori di lettura.
#[test]
fn a_malformed_patch_does_not_read() {
    let e = r#"{"id":"e","fromNode":"a","toNode":"b"}"#;
    for text in [
        format!(r#"{{"kind":"remove-edge","before":{e},"after":{{}}}}"#),
        format!(r#"{{"kind":"remove-edge","before":{e},"after":[]}}"#),
        format!(r#"{{"kind":"remove-edge","before":{e},"after":{e}}}"#),
        format!(r#"{{"kind":"remove-edge","before":{e}}}"#),
        format!(r#"{{"kind":"remove-link","before":{e},"after":null}}"#),
        r#"{"kind":"reorder","before":["a"],"after":"a"}"#.to_owned(),
        r#"{"before":[],"after":[]}"#.to_owned(),
    ] {
        assert!(
            serde_json::from_str::<CanvasPatch>(&text).is_err(),
            "si è letta: {text}"
        );
    }
    let n = r#"{"id":"n","type":"text","x":0,"y":0,"width":1,"height":1,"text":""}"#;
    for at in ["-1", "1.5", "\"0\""] {
        let text = format!(r#"{{"kind":"upsert-node","before":null,"after":{n},"at":{at}}}"#);
        assert!(
            serde_json::from_str::<CanvasPatch>(&text).is_err(),
            "{text}"
        );
    }
    assert_eq!(serde_json::to_string(&Null).expect("si scrive"), "null");
}

// ── I casi di operation.test.ts ────────────────────────────────────────────

/// «valida tutte le preimmagini prima di mutare un singolo nodo»
#[test]
fn every_preimage_is_checked_before_anything_changes() {
    let mut canvas = source();
    let mut moved = node(&canvas, "n1");
    moved.x = 16;
    let valid = upsert_node_patch(&canvas, &moved).expect("cambia");
    let mut far = node(&canvas, "n2");
    far.x = 400;
    let mut wrong = node(&canvas, "n2");
    wrong.x = 9999;
    let stale = CanvasPatch::UpsertNode {
        before: Some(wrong),
        after: far,
        at: None,
    };
    let error = apply(&mut canvas, &[valid, stale]).expect_err("la seconda è vecchia");
    assert_eq!(
        error,
        PatchError::Stale {
            index: 1,
            subject: Subject::Node("n2".into())
        }
    );
    assert_eq!(canvas, source());
}

/// «sposta, duplica logica e annulla come una sola operazione con preimmagini»
#[test]
fn a_move_and_a_relabel_undo_together() {
    let mut canvas = source();
    let mut moved = node(&canvas, "n1");
    moved.x = 8;
    moved.y = 8;
    let mut relabeled = canvas.edges[0].clone();
    relabeled.label = Some("dipende".into());
    let patches = [
        upsert_node_patch(&canvas, &moved).expect("cambia"),
        upsert_edge_patch(&canvas, &relabeled).expect("cambia"),
    ];
    let after = round_trip(&canvas, &patches);
    assert_eq!(node(&after, "n1").x, 8);
    assert_eq!(after.edges[0].label.as_deref(), Some("dipende"));

    apply(&mut canvas, &patches).expect("si applica");
    assert_eq!(canvas, after);
    apply(&mut canvas, &inverse(&patches)).expect("l'inversa si applica");
    assert_eq!(node(&canvas, "n1").x, 0);
    assert_eq!(canvas.edges[0].label.as_deref(), Some("usa"));
}

/// «rifiuta la rimozione di un nodo con archi»
#[test]
fn a_node_with_edges_is_not_removed() {
    let mut canvas = source();
    let remove = remove_node_patch(&canvas, "n1").expect("c'è");
    assert_eq!(
        apply(&mut canvas, &[remove]),
        Err(PatchError::NodeHasEdges {
            index: 0,
            id: "n1".into(),
            edge: "e1".into()
        })
    );
    assert_eq!(canvas.nodes.len(), 2);
    assert_eq!(remove_node_patch(&canvas, "assente"), None);
    assert_eq!(remove_edge_patch(&canvas, "assente"), None);
}

/// «rimuove e ripristina insieme due nodi e il loro arco senza stati parziali»
#[test]
fn two_nodes_and_their_edge_go_and_come_back_together() {
    let canvas = source();
    let patches = [
        remove_edge_patch(&canvas, "e1").expect("c'è"),
        remove_node_patch(&canvas, "n1").expect("c'è"),
        remove_node_patch(&canvas, "n2").expect("c'è"),
    ];
    let after = round_trip(&canvas, &patches);
    assert!(after.nodes.is_empty());
    assert!(after.edges.is_empty());
    assert_eq!(after.extra, canvas.extra);
}

/// «rifiuta una patch finale non valida senza mutare il documento»: la
/// bozza controlla la struttura, non `Canvas::validate`; il modello di dopo
/// non valido lo rifiuta il commit. Qui si fissa che la bozza lo lascia
/// passare senza toccare l'originale, e che l'inversa lo riporta indietro.
#[test]
fn the_draft_leaves_validation_to_the_commit() {
    let canvas = source();
    let mut invalid = node(&canvas, "n1");
    invalid.width = 0;
    let mut relabeled = canvas.edges[0].clone();
    relabeled.label = Some("nuova".into());
    let patches = [
        upsert_edge_patch(&canvas, &relabeled).expect("cambia"),
        upsert_node_patch(&canvas, &invalid).expect("cambia"),
    ];
    let after = round_trip(&canvas, &patches);
    assert!(after.validate().is_err());
    assert_eq!(node(&canvas, "n1").width, 200);
    assert_eq!(
        canvas.extra.get("xFuture"),
        Some(&json!({"nested": [1, 2]}))
    );
}

/// «riconnette un estremo mantenendo attributi futuri e inverte la patch intera»
#[test]
fn a_reconnected_edge_keeps_its_unknown_fields_and_undoes() {
    let mut canvas = three();
    canvas.edges.push(
        serde_json::from_value(json!({
            "id": "e", "fromNode": "a", "toNode": "b", "fromEnd": "arrow", "toSide": "top",
            "color": "#abcdef", "label": "note", "vendor": {"keep": true}
        }))
        .expect("l'arco si legge"),
    );
    canvas.extra.insert("xFuture".into(), Value::Bool(true));
    let mut reconnected = canvas.edges[0].clone();
    reconnected.to_node = "c".into();
    reconnected.to_end = Some(CanvasEdgeEnd::None);
    let patch = upsert_edge_patch(&canvas, &reconnected).expect("cambia");
    let after = round_trip(&canvas, &[patch]);
    let edge = &after.edges[0];
    assert_eq!(edge.to_node, "c");
    assert_eq!(edge.from_end, Some(CanvasEdgeEnd::Arrow));
    assert_eq!(edge.extra.get("vendor"), Some(&json!({"keep": true})));
    assert_eq!(after.extra.get("xFuture"), Some(&Value::Bool(true)));
}

/// «non scarta chiavi future che collidono col prototipo JavaScript» e
/// «riordina card senza riemettere i byte ignoti»: la parte sul modello
/// (quella sul sorgente è del commit).
#[test]
fn prototype_keys_and_reorders_keep_unknown_fields() {
    let canvas = parse(
        r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a","constructor":{"keep":1},"future":{"escaped":"\\u0055"}},{"id":"b","type":"text","x":20,"y":0,"width":10,"height":10,"text":"b"}],"edges":[],"__proto__":{"own":true}}"#,
    )
    .expect("si legge");
    let mut moved = node(&canvas, "a");
    moved.x = 8;
    let after = round_trip(
        &canvas,
        &[upsert_node_patch(&canvas, &moved).expect("cambia")],
    );
    assert_eq!(
        node(&after, "a").extra.get("constructor"),
        Some(&json!({"keep": 1}))
    );
    assert_eq!(after.extra.get("__proto__"), Some(&json!({"own": true})));

    let reorder = CanvasPatch::Reorder {
        before: vec!["a".into(), "b".into()],
        after: vec!["b".into(), "a".into()],
    };
    let after = round_trip(&canvas, &[reorder]);
    assert_eq!(ids(&after), ["b", "a"]);
    assert_eq!(after.nodes[1], canvas.nodes[0]);
}

// ── I casi limite ──────────────────────────────────────────────────────────

/// Una toppa che non cambia niente si applica e non cambia niente; chi
/// costruisce le toppe non la fa nemmeno.
#[test]
fn a_patch_that_changes_nothing() {
    let canvas = source();
    let same = node(&canvas, "n1");
    assert_eq!(upsert_node_patch(&canvas, &same), None);
    assert_eq!(upsert_edge_patch(&canvas, &canvas.edges[0]), None);
    let patches = [
        CanvasPatch::UpsertNode {
            before: Some(same.clone()),
            after: same,
            at: None,
        },
        CanvasPatch::Reorder {
            before: vec!["n1".into(), "n2".into()],
            after: vec!["n1".into(), "n2".into()],
        },
    ];
    assert_eq!(round_trip(&canvas, &patches), canvas);
    assert_eq!(round_trip(&canvas, &[]), canvas);
}

/// Due toppe sulla stessa scheda: la seconda parte da dove arriva la prima.
#[test]
fn two_patches_on_the_same_node() {
    let canvas = source();
    let original = node(&canvas, "n1");
    let mut first = original.clone();
    first.x = 10;
    let mut second = first.clone();
    second.y = 20;
    let chained = [
        CanvasPatch::UpsertNode {
            before: Some(original.clone()),
            after: first.clone(),
            at: None,
        },
        CanvasPatch::UpsertNode {
            before: Some(first),
            after: second.clone(),
            at: None,
        },
    ];
    assert_eq!(node(&round_trip(&canvas, &chained), "n1"), second);

    // La seconda con l'immagine di prima della prima non torna più.
    let crossed = [
        chained[0].clone(),
        CanvasPatch::UpsertNode {
            before: Some(original),
            after: second,
            at: None,
        },
    ];
    assert_eq!(
        draft(&canvas, &crossed),
        Err(PatchError::Stale {
            index: 1,
            subject: Subject::Node("n1".into())
        })
    );

    // Aggiunta e tolta nello stesso giro.
    let mut fresh = node(&canvas, "n1");
    fresh.id = "n3".into();
    let born_and_gone = [
        CanvasPatch::UpsertNode {
            before: None,
            after: fresh.clone(),
            at: None,
        },
        CanvasPatch::RemoveNode {
            before: fresh,
            after: Null,
            at: None,
        },
    ];
    assert_eq!(round_trip(&canvas, &born_and_gone), canvas);
}

/// `at` fra le schede inserisce lì, `at` uguale alla lunghezza mette in
/// fondo, `at` oltre la fine è un errore; senza `at` si va in fondo.
#[test]
fn at_inside_at_the_end_and_past_the_end() {
    let canvas = three();
    let mut fresh = node(&canvas, "a");
    fresh.id = "d".into();
    let insert = |at| CanvasPatch::UpsertNode {
        before: None,
        after: fresh.clone(),
        at,
    };
    assert_eq!(
        ids(&round_trip(&canvas, &[insert(Some(1))])),
        ["a", "d", "b", "c"]
    );
    assert_eq!(
        ids(&round_trip(&canvas, &[insert(Some(3))])),
        ["a", "b", "c", "d"]
    );
    assert_eq!(
        ids(&round_trip(&canvas, &[insert(None)])),
        ["a", "b", "c", "d"]
    );
    assert_eq!(
        draft(&canvas, &[insert(Some(4))]),
        Err(PatchError::AtOutOfRange {
            index: 0,
            at: 4,
            len: 3,
            list: "nodes"
        })
    );
    // L'inversa di un inserimento non porta `at`, come in TypeScript:
    // togliere non ne ha bisogno.
    assert_eq!(
        inverse(&[insert(Some(1))]),
        [CanvasPatch::RemoveNode {
            before: fresh.clone(),
            after: Null,
            at: None
        }]
    );
    // Su una scheda che c'è `at` non conta: si cambia al suo posto.
    let mut moved = node(&canvas, "c");
    moved.x = 1;
    let update = CanvasPatch::UpsertNode {
        before: Some(node(&canvas, "c")),
        after: moved,
        at: Some(99),
    };
    assert_eq!(
        ids(&draft(&canvas, &[update]).expect("si applica")),
        ["a", "b", "c"]
    );
}

/// Una scheda tolta senza `at` torna in fondo: è il comportamento di
/// `inverseCanvasPatches`.
#[test]
fn a_removal_without_at_comes_back_on_top() {
    let canvas = three();
    let remove = CanvasPatch::RemoveNode {
        before: node(&canvas, "a"),
        after: Null,
        at: None,
    };
    let after = draft(&canvas, std::slice::from_ref(&remove)).expect("si applica");
    let back = draft(&after, &inverse(&[remove])).expect("l'inversa si applica");
    assert_eq!(ids(&back), ["b", "c", "a"]);
}

/// Togliere schede in qualunque ordine, con gli `at` presi sul modello di
/// partenza: l'inversa le rimette dalla posizione più bassa e ognuna torna
/// al suo posto.
#[test]
fn removals_in_any_order_come_back_in_place() {
    let canvas = three();
    let patches = [
        remove_node_patch(&canvas, "c").expect("c'è"),
        remove_node_patch(&canvas, "a").expect("c'è"),
        remove_node_patch(&canvas, "b").expect("c'è"),
    ];
    let undo = inverse(&patches);
    let at: Vec<Option<usize>> = undo
        .iter()
        .map(|patch| match patch {
            CanvasPatch::UpsertNode { at, .. } => *at,
            other => panic!("non è un inserimento: {other:?}"),
        })
        .collect();
    assert_eq!(at, [Some(0), Some(1), Some(2)]);
    assert!(round_trip(&canvas, &patches).nodes.is_empty());
}

/// Togliere una scheda e i suoi archi nello stesso giro: prima gli archi.
#[test]
fn a_node_and_its_edges_in_the_same_round() {
    let canvas = source();
    let edge = remove_edge_patch(&canvas, "e1").expect("c'è");
    let node = remove_node_patch(&canvas, "n2").expect("c'è");
    let after = round_trip(&canvas, &[edge.clone(), node.clone()]);
    assert_eq!(ids(&after), ["n1"]);
    assert_eq!(
        draft(&canvas, &[node, edge]),
        Err(PatchError::NodeHasEdges {
            index: 0,
            id: "n2".into(),
            edge: "e1".into()
        })
    );
}

/// Un arco nuovo verso una scheda nuova dello stesso giro va bene; verso una
/// scheda che non c'è è un errore.
#[test]
fn an_edge_needs_both_its_nodes() {
    let canvas = three();
    let mut fresh = node(&canvas, "a");
    fresh.id = "d".into();
    let edge: CanvasEdge =
        serde_json::from_value(json!({"id": "e", "fromNode": "a", "toNode": "d"}))
            .expect("si legge");
    let patches = [
        CanvasPatch::UpsertNode {
            before: None,
            after: fresh,
            at: None,
        },
        CanvasPatch::UpsertEdge {
            before: None,
            after: edge.clone(),
            at: None,
        },
    ];
    assert_eq!(
        round_trip(&canvas, &patches).edges,
        std::slice::from_ref(&edge)
    );
    assert_eq!(
        draft(&canvas, &patches[1..]),
        Err(PatchError::MissingEndpoint {
            index: 0,
            id: "e".into(),
            node: "d".into()
        })
    );
}

/// Mettere ciò che c'è già come nuovo, o cambiare ciò che non c'è, sono
/// immagini di prima che non tornano.
#[test]
fn a_missing_or_unexpected_preimage_is_stale() {
    let canvas = source();
    let n1 = node(&canvas, "n1");
    let e1 = canvas.edges[0].clone();
    let mut ghost = n1.clone();
    ghost.id = "ghost".into();
    let mut ghost_edge = e1.clone();
    ghost_edge.id = "ghost".into();
    let cases = [
        (
            CanvasPatch::UpsertNode {
                before: None,
                after: n1.clone(),
                at: None,
            },
            Subject::Node("n1".into()),
        ),
        (
            CanvasPatch::UpsertNode {
                before: Some(ghost.clone()),
                after: ghost.clone(),
                at: None,
            },
            Subject::Node("ghost".into()),
        ),
        (
            CanvasPatch::RemoveNode {
                before: ghost,
                after: Null,
                at: Some(0),
            },
            Subject::Node("ghost".into()),
        ),
        (
            CanvasPatch::UpsertEdge {
                before: None,
                after: e1,
                at: Some(0),
            },
            Subject::Edge("e1".into()),
        ),
        (
            CanvasPatch::UpsertEdge {
                before: Some(ghost_edge.clone()),
                after: ghost_edge.clone(),
                at: None,
            },
            Subject::Edge("ghost".into()),
        ),
        (
            CanvasPatch::RemoveEdge {
                before: ghost_edge,
                after: Null,
                at: Some(0),
            },
            Subject::Edge("ghost".into()),
        ),
    ];
    for (patch, subject) in cases {
        assert_eq!(
            draft(&canvas, &[patch]),
            Err(PatchError::Stale { index: 0, subject })
        );
    }
}

/// `reorder`: l'ordine di prima deve essere quello del modello; quello
/// nuovo una sua permutazione, senza id che non ci sono né ripetuti.
#[test]
fn reorder_with_a_missing_a_repeated_or_a_stale_id() {
    let canvas = three();
    let reorder = |before: &[&str], after: &[&str]| CanvasPatch::Reorder {
        before: before.iter().map(|id| (*id).to_owned()).collect(),
        after: after.iter().map(|id| (*id).to_owned()).collect(),
    };
    let current = ["a", "b", "c"];
    assert_eq!(
        ids(&round_trip(&canvas, &[reorder(&current, &["c", "a", "b"])])),
        ["c", "a", "b"]
    );
    for after in [
        &["a", "b", "x"][..],
        &["a", "b", "b"][..],
        &["a", "b"][..],
        &["a", "b", "c", "c"][..],
    ] {
        assert_eq!(
            draft(&canvas, &[reorder(&current, after)]),
            Err(PatchError::NotAPermutation { index: 0 }),
            "{after:?}"
        );
    }
    for before in [
        &["b", "a", "c"][..],
        &["a", "b"][..],
        &["a", "b", "c", "x"][..],
    ] {
        assert_eq!(
            draft(&canvas, &[reorder(before, &current)]),
            Err(PatchError::Stale {
                index: 0,
                subject: Subject::Order
            }),
            "{before:?}"
        );
    }
}

// ── R9: l'immagine di prima come valore JSON ──────────────────────────────

#[test]
fn same_value_compares_json_values() {
    let equal = [
        (json!({"a": 1, "b": [1, 2]}), json!({"b": [1, 2], "a": 1})),
        (json!(1), json!(1.0)),
        (json!(0), json!(-0.0)),
        (
            json!(100),
            serde_json::from_str::<Value>("1e2").expect("si legge"),
        ),
        (
            serde_json::from_str::<Value>("9007199254740993").expect("si legge"),
            json!(9_007_199_254_740_992_u64),
        ),
        (json!(-5), json!(-5.0)),
        (json!(null), json!(null)),
        (
            json!({"x": {"y": [true, "s"]}}),
            json!({"x": {"y": [true, "s"]}}),
        ),
    ];
    for (left, right) in &equal {
        assert!(same_value(left, right), "{left} == {right}");
        assert!(same_value(right, left), "{right} == {left}");
    }
    let different = [
        (json!([1, 2]), json!([2, 1])),
        (json!({"a": 1}), json!({"a": 1, "b": 1})),
        (json!({"a": null}), json!({})),
        (json!(1), json!("1")),
        (json!(0), json!(false)),
        (json!(null), json!(false)),
        (json!(1.5), json!(1)),
        (json!([]), json!({})),
    ];
    for (left, right) in &different {
        assert!(!same_value(left, right), "{left} != {right}");
        assert!(!same_value(right, left), "{right} != {left}");
    }
}

/// Un'immagine di prima con i campi sconosciuti in un altro ordine e i
/// numeri scritti in un altro modo torna lo stesso (oggi `sameValue` di
/// TypeScript confronta `JSON.stringify` e la rifiuterebbe).
#[test]
fn a_preimage_matches_by_value_not_by_spelling() {
    let canvas = parse(
        r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a","v":{"p":1,"q":[2.0,3]}}]}"#,
    )
    .expect("si legge");
    let before: CanvasNode = serde_json::from_str(
        r#"{"v":{"q":[2,3.0],"p":1.0},"text":"a","height":10,"width":10,"y":0,"x":0,"type":"text","id":"a"}"#,
    )
    .expect("si legge");
    let mut after = before.clone();
    after.x = 5;
    let patch = CanvasPatch::UpsertNode {
        before: Some(before),
        after,
        at: None,
    };
    assert_eq!(draft(&canvas, &[patch]).expect("torna").nodes[0].x, 5);
}

/// L'inversa si scrive e si rilegge uguale: l'annulla può viaggiare come
/// JSON.
#[test]
fn the_inverse_travels_as_json() {
    let canvas = source();
    let patches = [
        remove_edge_patch(&canvas, "e1").expect("c'è"),
        remove_node_patch(&canvas, "n1").expect("c'è"),
        CanvasPatch::Reorder {
            before: vec!["n2".into()],
            after: vec!["n2".into()],
        },
    ];
    let undo = inverse(&patches);
    let text = serde_json::to_string(&undo).expect("si scrive");
    let read: Vec<CanvasPatch> = serde_json::from_str(&text).expect("si rilegge");
    assert_eq!(read, undo);
    round_trip(&canvas, &patches);
}

/// Un arco tolto con [`remove_edge_patch`] porta la sua posizione, e
/// l'inversa lo rimette lì; tolto senza `at`, torna in fondo alla lista.
#[test]
fn a_removed_edge_comes_back_at_its_place() {
    let canvas = three_edges();
    let order = |canvas: &Canvas| -> Vec<String> {
        canvas.edges.iter().map(|edge| edge.id.clone()).collect()
    };
    let remove = [remove_edge_patch(&canvas, "e2").expect("c'è")];
    assert!(matches!(
        remove[0],
        CanvasPatch::RemoveEdge { at: Some(1), .. }
    ));
    let after = draft(&canvas, &remove).expect("si applica");
    assert_eq!(order(&after), ["e1", "e3"]);
    let back = draft(&after, &inverse(&remove)).expect("l'inversa si applica");
    assert_eq!(order(&back), ["e1", "e2", "e3"]);
    round_trip(&canvas, &remove);

    let CanvasPatch::RemoveEdge { before, .. } = remove[0].clone() else {
        unreachable!()
    };
    let without_at = [CanvasPatch::RemoveEdge {
        before,
        after: Null,
        at: None,
    }];
    let after = draft(&canvas, &without_at).expect("si applica");
    let back = draft(&after, &inverse(&without_at)).expect("l'inversa si applica");
    assert_eq!(order(&back), ["e1", "e3", "e2"]);
    assert_eq!(back.nodes, canvas.nodes);
}

/// Tre archi tolti nello stesso giro, in qualunque ordine, con gli `at` del
/// modello di partenza: l'inversa li rimette per `at` crescente, e la lista
/// torna com'era.
#[test]
fn edges_removed_together_come_back_in_their_order() {
    let canvas = three_edges();
    let patches: Vec<CanvasPatch> = ["e3", "e1", "e2"]
        .iter()
        .map(|id| remove_edge_patch(&canvas, id).expect("c'è"))
        .collect();
    let after = draft(&canvas, &patches).expect("le toppe si applicano");
    assert!(after.edges.is_empty());
    let back = draft(&after, &inverse(&patches)).expect("l'inversa si applica");
    let order: Vec<&str> = back.edges.iter().map(|edge| edge.id.as_str()).collect();
    assert_eq!(order, ["e1", "e2", "e3"]);
    round_trip(&canvas, &patches);
}

/// Togliere una scheda e i suoi archi nello stesso giro, poi annullare: le
/// schede tornano prima degli archi, e gli archi nel loro ordine.
#[test]
fn a_node_and_its_edges_come_back_in_their_order() {
    let mut canvas = three_edges();
    canvas.edges.push(
        serde_json::from_value(json!({"id": "e4", "fromNode": "a", "toNode": "c"}))
            .expect("l'arco si legge"),
    );
    let mut patches: Vec<CanvasPatch> = ["e3", "e1", "e2"]
        .iter()
        .map(|id| remove_edge_patch(&canvas, id).expect("c'è"))
        .collect();
    patches.push(remove_node_patch(&canvas, "b").expect("c'è"));
    let undo = inverse(&patches);
    assert!(matches!(
        undo[0],
        CanvasPatch::UpsertNode { before: None, .. }
    ));
    let after = draft(&canvas, &patches).expect("le toppe si applicano");
    assert_eq!(ids(&after), ["a", "c"]);
    let back = draft(&after, &undo).expect("l'inversa si applica");
    let order: Vec<&str> = back.edges.iter().map(|edge| edge.id.as_str()).collect();
    assert_eq!(order, ["e1", "e2", "e3", "e4"]);
    assert_eq!(ids(&back), ["a", "b", "c"]);
    round_trip(&canvas, &patches);
}

/// Un arco nuovo va in `at`; un `at` oltre la fine degli archi è un errore,
/// e su un arco che c'è `at` non conta.
#[test]
fn a_new_edge_goes_at_its_place() {
    let canvas = three_edges();
    let fresh: CanvasEdge =
        serde_json::from_value(json!({"id": "e0", "fromNode": "c", "toNode": "a"}))
            .expect("si legge");
    let insert = |at| CanvasPatch::UpsertEdge {
        before: None,
        after: fresh.clone(),
        at,
    };
    let order = |canvas: &Canvas| -> Vec<String> {
        canvas.edges.iter().map(|edge| edge.id.clone()).collect()
    };
    let after = draft(&canvas, &[insert(Some(0))]).expect("si applica");
    assert_eq!(order(&after), ["e0", "e1", "e2", "e3"]);
    let after = draft(&canvas, &[insert(Some(3))]).expect("si applica");
    assert_eq!(order(&after), ["e1", "e2", "e3", "e0"]);
    assert_eq!(
        draft(&canvas, &[insert(Some(4))]),
        Err(PatchError::AtOutOfRange {
            index: 0,
            at: 4,
            len: 3,
            list: "edges"
        })
    );
    assert_eq!(
        PatchError::AtOutOfRange {
            index: 0,
            at: 4,
            len: 3,
            list: "edges"
        }
        .to_string(),
        "canvas patch 0: position 4 is past the end of the 3 edges"
    );
    let mut relabeled = canvas.edges[2].clone();
    relabeled.label = Some("tre".into());
    let patch = CanvasPatch::UpsertEdge {
        before: Some(canvas.edges[2].clone()),
        after: relabeled,
        at: Some(0),
    };
    assert_eq!(
        order(&draft(&canvas, &[patch]).expect("si applica")),
        ["e1", "e2", "e3"]
    );
}

/// `three()` con tre archi: e1 a→b, e2 b→c, e3 c→b.
fn three_edges() -> Canvas {
    let mut canvas = three();
    for (id, from, to) in [("e1", "a", "b"), ("e2", "b", "c"), ("e3", "c", "b")] {
        canvas.edges.push(
            serde_json::from_value(json!({"id": id, "fromNode": from, "toNode": to}))
                .expect("l'arco si legge"),
        );
    }
    canvas
}
