//! La toppa `ink` sul modello e sul sorgente: una scheda con 2000 tratti
//! cambia nel file solo per il tratto nuovo, la forma JSON della toppa, la
//! sua inversa e i casi limite del task (il livello che nasce e sparisce, un
//! gruppo, un livello estraneo).
//!
//! Le due misure in byte del piano (N4 T10) si stampano con
//! `cargo test -p fub-canvas-core --test ink_patch -- --nocapture`.

use fub_canvas_core::commit::Core;
use fub_canvas_core::ink::{layer, InkStroke, LayerRef, LayerState, StrokeState, INK_KEY};
use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::patch::{draft, inverse, upsert_node_patch, CanvasPatch, PatchError, Subject};
use fub_canvas_core::{parse, Canvas};
use serde_json::{json, Value};

const BRUSH: &str = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 \
                     taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";

/// Quanti tratti sulla scheda grande.
const STROKES: usize = 2000;

/// Quanti campioni per tratto: un tratto di scrittura a mano di circa un
/// secondo a 120 Hz.
const SAMPLES: usize = 120;

/// La stringa `ink` di un tratto di `SAMPLES` campioni, con pressione e
/// tempo (`cxypt`), che parte da `(x, y)`.
fn ink_text(x: i64, y: i64) -> String {
    let mut text = format!("1 s100 cxypt {x},{y},128,0");
    for sample in 1..SAMPLES {
        let pressure = if sample % 2 == 0 { 2 } else { -2 };
        text.push_str(&format!(" 25,-3,{pressure},8"));
    }
    text
}

fn card_stroke(id: &str, x: i64, y: i64) -> Value {
    json!({
        "id": id,
        "tool": "pen",
        "at": "2026-11-02T09:20:31.250Z",
        "brush": BRUSH,
        "color": "#0072b2",
        "anchor": {"kind": "card", "width": 640, "height": 420},
        "ink": ink_text(x, y),
    })
}

fn stroke(value: &Value) -> InkStroke {
    InkStroke::from_value(value).expect("un tratto con id")
}

/// Una lavagna scritta come la scrive Fub (rientrata di due spazi), con la
/// scheda `f1` che porta `STROKES` tratti e una scheda di testo accanto.
fn big_source() -> String {
    let strokes: Vec<Value> = (0..STROKES)
        .map(|i| {
            let i = i64::try_from(i).expect("pochi tratti");
            card_stroke(&format!("s-{i}"), 100 + i % 500, 100 + i / 5)
        })
        .collect();
    let canvas = json!({
        "nodes": [
            {"id": "f1", "type": "file", "file": "Corsi/Statistica/voti.xlsx",
             "x": 0, "y": 0, "width": 640, "height": 420,
             "fub:ink": {"v": 1, "strokes": strokes}},
            {"id": "n2", "type": "text", "text": "Perché la media è così bassa?",
             "x": 700, "y": 40, "width": 280, "height": 90}
        ],
        "edges": []
    });
    let mut text = serde_json::to_string_pretty(&canvas).expect("si scrive");
    text.push('\n');
    text
}

#[test]
fn a_new_stroke_on_a_card_with_2000_strokes_changes_only_the_new_stroke() {
    let source = big_source();
    let mut core = Core::open(source.clone()).expect("la lavagna grande si apre");
    let new = card_stroke("s-nuovo", 320, 200);
    let new_text = serde_json::to_string(&new).expect("si scrive");
    let patch = CanvasPatch::Ink {
        layer: LayerRef::Node("f1".into()),
        at: STROKES,
        before: None,
        after: Some(stroke(&new)),
    };
    let committed = core
        .commit(std::slice::from_ref(&patch))
        .expect("il tratto entra");
    let edit = &committed.edit;
    // Il tratto cambiato è il tratto nuovo con il separatore del file
    // davanti (`,\n          `): niente altro del livello si riscrive.
    assert_eq!(edit.start, edit.end, "nessun byte di prima si tocca");
    assert!(edit.text.ends_with(&new_text), "{:?}", edit.text);
    let separator = &edit.text[..edit.text.len() - new_text.len()];
    assert!(
        separator.trim_start_matches(',').trim().is_empty() && separator.starts_with(','),
        "solo il separatore oltre il tratto: {separator:?}"
    );
    // L'annulla toglie esattamente quei byte.
    let undone = core.commit(&committed.inverse).expect("l'annulla");
    assert_eq!(undone.source, source);
    assert_eq!(undone.edit.end - undone.edit.start, edit.text.len());
    assert!(undone.edit.text.is_empty());

    let move_patch = {
        let canvas = parse(&source).expect("si legge");
        let mut moved = canvas.nodes[0].clone();
        moved.x += 40;
        upsert_node_patch(&canvas, &moved).expect("la scheda si sposta")
    };
    let move_bytes = serde_json::to_string(&move_patch).expect("si scrive").len();
    let ink_bytes = serde_json::to_string(&patch).expect("si scrive").len();
    let moved = core.commit(&[move_patch]).expect("lo spostamento");
    // Nel file lo spostamento cambia solo `x` (da `0` a `40`: il tratto
    // minimo è il `4` davanti allo `0`).
    assert_eq!(
        (moved.edit.end - moved.edit.start, moved.edit.text.as_str()),
        (0, "4")
    );
    println!(
        "N4 T10 · scheda con {STROKES} tratti di {SAMPLES} campioni, sorgente di {} byte",
        source.len()
    );
    println!(
        "  spostare la scheda: toppa upsert-node di {move_bytes} byte (due copie del livello), \
         nel sorgente {} byte cambiati",
        moved.edit.text.len()
    );
    println!(
        "  un tratto nuovo: toppa ink di {ink_bytes} byte, nel sorgente {} byte aggiunti \
         ({} del tratto), {} tolti",
        edit.text.len(),
        new_text.len(),
        edit.end - edit.start
    );
    // La toppa di spostamento porta il livello intero due volte.
    assert!(move_bytes > 2 * STROKES * SAMPLES);
    assert!(ink_bytes < 2 * new_text.len());
}

fn small() -> Canvas {
    parse(
        r#"{"nodes":[
  {"id":"g","type":"group","x":-20,"y":-20,"width":300,"height":200,"label":"G"},
  {"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"text":"a","fub:tag":"z"}
],"edges":[]}"#,
    )
    .expect("si legge")
}

fn short(id: &str, kind: &str) -> InkStroke {
    let anchor = if kind == "free" {
        json!({"kind": "free"})
    } else {
        json!({"kind": "card", "width": 100, "height": 50})
    };
    stroke(&json!({
        "id": id, "tool": "pen", "brush": BRUSH, "color": "#0072b2",
        "anchor": anchor, "ink": "1 s100 cxy 100,100 10,0"
    }))
}

fn keys(canvas: &Canvas, id: &str) -> Vec<String> {
    canvas
        .nodes
        .iter()
        .find(|node| node.id == id)
        .expect("la scheda c'è")
        .extra
        .keys()
        .cloned()
        .collect()
}

#[test]
fn the_patch_has_the_json_shape_of_the_vectors() {
    let patch = CanvasPatch::Ink {
        layer: LayerRef::Board,
        at: 0,
        before: None,
        after: Some(short("s1", "free")),
    };
    let text = serde_json::to_string(&patch).expect("si scrive");
    assert!(
        text.starts_with(
            r#"{"kind":"ink","layer":"board","at":0,"before":null,"after":{"id":"s1","tool":"pen""#
        ),
        "{text}"
    );
    let back: CanvasPatch = serde_json::from_str(&text).expect("si rilegge");
    assert_eq!(back, patch);
    let node: CanvasPatch = serde_json::from_value(json!({
        "kind": "ink", "layer": {"node": "a"}, "at": 3, "before": {"id": "s1"}, "after": null
    }))
    .expect("si legge");
    assert!(
        matches!(node, CanvasPatch::Ink { layer: LayerRef::Node(ref id), at: 3, after: None, .. } if id == "a")
    );
    // Un tratto senza id, un `at` negativo, un livello sconosciuto: errori
    // di lettura.
    for bad in [
        json!({"kind": "ink", "layer": "board", "at": 0, "before": null, "after": {"tool": "pen"}}),
        json!({"kind": "ink", "layer": "board", "at": -1, "before": null, "after": {"id": "s"}}),
        json!({"kind": "ink", "layer": "nodes", "at": 0, "before": null, "after": {"id": "s"}}),
    ] {
        assert!(
            serde_json::from_value::<CanvasPatch>(bad.clone()).is_err(),
            "{bad}"
        );
    }
}

/// Togliere l'ultimo tratto fa sparire la chiave; l'annulla la rimette in
/// fondo ai campi della scheda (R10), dopo `fub:tag`.
#[test]
fn undoing_the_last_stroke_removal_puts_the_layer_last() {
    let first = CanvasPatch::Ink {
        layer: LayerRef::Node("a".into()),
        at: 0,
        before: None,
        after: Some(short("s1", "card")),
    };
    let with = draft(&small(), &[first]).expect("il livello nasce");
    assert_eq!(keys(&with, "a"), ["fub:tag", INK_KEY]);
    // Il livello in mezzo ai campi, come in un file scritto da altri.
    let mut middle = with.clone();
    let node = &mut middle.nodes[1];
    let tag = node.extra.shift_remove("fub:tag").expect("c'è");
    node.extra.insert("fub:tag".into(), tag);
    assert_eq!(keys(&middle, "a"), [INK_KEY, "fub:tag"]);
    let remove = [CanvasPatch::Ink {
        layer: LayerRef::Node("a".into()),
        at: 0,
        before: Some(short("s1", "card")),
        after: None,
    }];
    let gone = draft(&middle, &remove).expect("si toglie");
    assert_eq!(keys(&gone, "a"), ["fub:tag"]);
    let back = draft(&gone, &inverse(&remove)).expect("l'annulla");
    assert_eq!(keys(&back, "a"), ["fub:tag", INK_KEY]);
    assert_eq!(back, with);
}

#[test]
fn a_group_holds_a_layer_like_any_card() {
    let patches = [CanvasPatch::Ink {
        layer: LayerRef::Node("g".into()),
        at: 0,
        before: None,
        after: Some(stroke(&json!({
            "id": "s1", "tool": "pen", "brush": BRUSH, "color": "#0072b2",
            "anchor": {"kind": "card", "width": 300, "height": 200},
            "ink": "1 s100 cxy 100,100 10,0"
        }))),
    }];
    let after = draft(&small(), &patches).expect("si applica");
    let read = layer(&after, &LayerRef::Node("g".into())).expect("il livello c'è");
    let LayerState::Ok { strokes, .. } = read.state else {
        panic!("il livello del gruppo è valido");
    };
    assert!(matches!(strokes.as_slice(), [StrokeState::Drawn(_)]));
    // Il figlio non cambia.
    assert_eq!(after.nodes[1], small().nodes[1]);
    assert_eq!(
        draft(&after, &inverse(&patches)).expect("l'annulla"),
        small()
    );
}

#[test]
fn the_errors_name_the_patch_and_the_layer() {
    let canvas = small();
    let missing = CanvasPatch::Ink {
        layer: LayerRef::Node("zzz".into()),
        at: 0,
        before: None,
        after: Some(short("s1", "card")),
    };
    assert_eq!(
        draft(&canvas, &[missing]),
        Err(PatchError::Stale {
            index: 0,
            subject: Subject::Node("zzz".into())
        })
    );
    let not_there = CanvasPatch::Ink {
        layer: LayerRef::Board,
        at: 0,
        before: Some(short("s1", "free")),
        after: None,
    };
    let error = draft(&canvas, &[not_there]).expect_err("non c'è nessun tratto");
    assert_eq!(error.reason(), "stale");
    assert_eq!(
        error.to_string(),
        "canvas patch 0: the ink stroke \"s1\" of the board is not what the patch expects"
    );
    let past = CanvasPatch::Ink {
        layer: LayerRef::Node("a".into()),
        at: 1,
        before: None,
        after: Some(short("s1", "card")),
    };
    let error = draft(&canvas, &[past]).expect_err("oltre la fine");
    assert!(matches!(
        error,
        PatchError::InkAtOutOfRange { at: 1, len: 0, .. }
    ));
    assert_eq!(error.reason(), "stale");

    let mut foreign = canvas.clone();
    foreign
        .extra
        .insert(INK_KEY.into(), json!({"v": 1, "strokes": {}}));
    let add = CanvasPatch::Ink {
        layer: LayerRef::Board,
        at: 0,
        before: None,
        after: Some(short("s1", "free")),
    };
    let error = draft(&foreign, std::slice::from_ref(&add)).expect_err("estraneo");
    assert!(matches!(error, PatchError::ForeignLayer { index: 0, .. }));
    assert_eq!(error.reason(), "invalid");
    // Con l'errore il modello resta com'era; il livello estraneo, con lui.
    let mut core = Core::open(r#"{"nodes":[],"fub:ink":{"v":1,"strokes":{}}}"#).expect("si apre");
    let refused = core.commit(&[add]).expect_err("estraneo");
    assert_eq!(refused.reason(), "invalid");
    assert_eq!(
        core.source(),
        r#"{"nodes":[],"fub:ink":{"v":1,"strokes":{}}}"#
    );
}

/// Cambiare un tratto nel suo id va bene; prendere l'id di un altro tratto
/// no.
#[test]
fn a_changed_stroke_may_not_take_the_id_of_another() {
    let two = draft(
        &small(),
        &[
            CanvasPatch::Ink {
                layer: LayerRef::Board,
                at: 0,
                before: None,
                after: Some(short("s1", "free")),
            },
            CanvasPatch::Ink {
                layer: LayerRef::Board,
                at: 1,
                before: None,
                after: Some(short("s2", "free")),
            },
        ],
    )
    .expect("due tratti");
    let rename = |id: &str| CanvasPatch::Ink {
        layer: LayerRef::Board,
        at: 1,
        before: Some(short("s2", "free")),
        after: Some(short(id, "free")),
    };
    assert!(draft(&two, &[rename("s3")]).is_ok());
    assert!(draft(&two, &[rename("s2")]).is_ok());
    assert!(matches!(
        draft(&two, &[rename("s1")]),
        Err(PatchError::DuplicateStroke { index: 0, .. })
    ));
}

/// Le operazioni compilano toppe `ink` con le posizioni giuste: cancellare
/// tre tratti in un ordine qualunque e annullare li rimette dov'erano.
#[test]
fn erase_strokes_in_any_order_undoes_to_the_same_layer() {
    let ops: Vec<CanvasOp> = serde_json::from_value(json!([
        {"op": "add_strokes", "layer": "board", "strokes": [
            {"id": "s1", "tool": "pen", "brush": BRUSH, "color": "#0072b2", "anchor": {"kind": "free"}, "ink": "1 s100 cxy 1,1 1,0"},
            {"id": "s2", "tool": "pen", "brush": BRUSH, "color": "#0072b2", "anchor": {"kind": "free"}, "ink": "1 s100 cxy 2,2 1,0"},
            {"id": "s3", "tool": "pen", "brush": BRUSH, "color": "#0072b2", "anchor": {"kind": "free"}, "ink": "1 s100 cxy 3,3 1,0"},
            {"id": "s4", "tool": "pen", "brush": BRUSH, "color": "#0072b2", "anchor": {"kind": "free"}, "ink": "1 s100 cxy 4,4 1,0"}
        ]}
    ]))
    .expect("si leggono");
    let base = small();
    let full =
        draft(&base, &compile(&base, &ops, 0).expect("si compila").patches).expect("si applica");
    let erase: Vec<CanvasOp> = serde_json::from_value(json!([
        {"op": "erase_strokes", "layer": "board", "ids": ["s3", "s1", "s4"]}
    ]))
    .expect("si legge");
    let compiled = compile(&full, &erase, 0).expect("si compila");
    let ats: Vec<usize> = compiled
        .patches
        .iter()
        .map(|patch| match patch {
            CanvasPatch::Ink { at, .. } => *at,
            other => panic!("solo toppe ink: {other:?}"),
        })
        .collect();
    assert_eq!(ats, [2, 0, 1]);
    let after = draft(&full, &compiled.patches).expect("si applica");
    assert_eq!(
        after.extra[INK_KEY]["strokes"]
            .as_array()
            .expect("un array")
            .iter()
            .map(|s| s["id"].as_str().expect("un id"))
            .collect::<Vec<_>>(),
        ["s2"]
    );
    assert_eq!(
        draft(&after, &inverse(&compiled.patches)).expect("l'annulla"),
        full
    );
}
