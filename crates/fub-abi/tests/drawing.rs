//! Il contratto del disegno (`fub_abi::drawing`): la forma JSON, i vettori
//! dei gesti di `apps/client/src/__fixtures__/disegno-gesti/` letti come
//! sono, e ogni rifiuto di `validate()`.

use std::path::PathBuf;

use fub_abi::{
    DrawingChange, DrawingCommandRequest, DrawingEdit, DrawingGesture, DrawingLoss,
    DrawingLossKind, DrawingOpen, DrawingOutcome, DrawingPhase, DrawingPointer, DrawingPointerKind,
    DrawingPreview, DrawingRefusal, DrawingSnap, DrawingStyle, DrawingSync, DrawingTool,
    PluginError, DRAWING_COMMAND_FILL_COLOR, DRAWING_COMMAND_STROKE_COLOR, DRAWING_COMMAND_WIDTH,
    MAX_DRAWING_LOSSES, MAX_DRAWING_OPS_BYTES, MAX_DRAWING_TEXT_BYTES, MAX_GESTURE_EVENTS,
};
use serde_json::{json, Value};

fn vectors() -> Vec<(String, Value)> {
    let dir = PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/client/src/__fixtures__/disegno-gesti"
    ));
    let mut out: Vec<(String, Value)> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            (path.extension()? == "json").then_some(path)
        })
        .map(|path| {
            let text = std::fs::read_to_string(&path).expect("vettore leggibile");
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            (name, serde_json::from_str(&text).expect("vettore JSON"))
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    assert!(out.len() >= 40, "pochi vettori dei gesti: {}", out.len());
    out
}

fn pointer(kind: DrawingPointerKind, x: f64, y: f64) -> DrawingPointer {
    DrawingPointer {
        kind,
        x,
        y,
        pressure: 0.5,
        shift: false,
        alt: false,
        cmd: false,
    }
}

fn gesture() -> DrawingGesture {
    DrawingGesture {
        revision: 3,
        phase: DrawingPhase::Preview,
        tool: DrawingTool::Rect,
        layer: Some("l1a2b3c4d".into()),
        selection: vec!["oa1a1a1a1".into()],
        zoom: 1.5,
        snap: DrawingSnap {
            grid: Some(10.0),
            free: false,
        },
        style: Some(DrawingStyle {
            stroke: "#000000".into(),
            width: 4.0,
            fill: None,
        }),
        text: None,
        events: vec![
            pointer(DrawingPointerKind::Down, 10.0, 10.0),
            pointer(DrawingPointerKind::Drag, 40.0, 30.0),
        ],
    }
}

fn outcome() -> DrawingOutcome {
    DrawingOutcome {
        revision: 3,
        preview: Some(DrawingPreview {
            shape: Some(json!({"tag": "rect", "attrs": {"x": "0"}})),
            matrix: Some([1.0, 0.0, 0.0, 1.0, 7.0, 5.0]),
            marquee: Some([0.0, 0.0, 10.0, 10.0]),
        }),
        ops: None,
        selection: vec!["oa1a1a1a1".into()],
        losses: Vec::new(),
        refused: None,
    }
}

/// Il rifiuto è `BadArgs` e nomina il campo.
fn refused(result: Result<(), PluginError>, field: &str) {
    match result {
        Err(PluginError::BadArgs(message)) => assert!(
            message
                .as_literal()
                .is_some_and(|m| m.contains(&format!("`{field}"))),
            "il rifiuto «{message}» non nomina `{field}`"
        ),
        other => panic!("atteso BadArgs su `{field}`, avuto {other:?}"),
    }
}

#[test]
fn every_vector_gesture_deserializes_as_a_drawing_gesture() {
    for (name, vector) in vectors() {
        let raw = vector
            .get("gesture")
            .unwrap_or_else(|| panic!("{name}: nessun gesture"));
        let gesture: DrawingGesture = serde_json::from_value(raw.clone())
            .unwrap_or_else(|e| panic!("{name}: il gesture non è un DrawingGesture: {e}"));
        gesture
            .validate()
            .unwrap_or_else(|e| panic!("{name}: il gesture non passa validate(): {e:?}"));
        // I vettori portano il gesto intero, senza revisione né fase.
        assert_eq!(gesture.revision, 0, "{name}");
        assert_eq!(gesture.phase, DrawingPhase::Commit, "{name}");
        assert_eq!(
            gesture.events.len(),
            raw["events"].as_array().unwrap().len(),
            "{name}"
        );
    }
}

#[test]
fn every_vector_refusal_is_a_drawing_refusal() {
    let mut seen = std::collections::BTreeSet::new();
    for (name, vector) in vectors() {
        let raw = &vector["expect"]["refused"];
        if raw.is_null() {
            continue;
        }
        let refusal: DrawingRefusal = serde_json::from_value(raw.clone())
            .unwrap_or_else(|e| panic!("{name}: `{raw}` non è un DrawingRefusal: {e}"));
        seen.insert(format!("{refusal:?}"));
    }
    for kind in ["Empty", "Locked", "Hidden"] {
        assert!(
            seen.contains(kind),
            "nessun vettore rifiuta con {kind}: {seen:?}"
        );
    }
}

#[test]
fn the_json_shape_is_the_mirror_one() {
    let value = serde_json::to_value(gesture()).unwrap();
    assert_eq!(
        value["revision"],
        json!("3"),
        "la revisione viaggia come stringa"
    );
    assert_eq!(value["phase"], json!("preview"));
    assert_eq!(value["tool"], json!("rect"));
    assert_eq!(value["events"][0]["kind"], json!("down"));
    let back: DrawingGesture = serde_json::from_value(value).unwrap();
    assert_eq!(back, gesture());

    let double: DrawingPointerKind = serde_json::from_value(json!("double_click")).unwrap();
    assert_eq!(double, DrawingPointerKind::DoubleClick);
    assert_eq!(
        serde_json::to_value(DrawingRefusal::NotReady).unwrap(),
        json!("not_ready")
    );

    let sync = DrawingSync {
        revision: 4,
        change: DrawingChange::Text {
            text: "<svg/>".into(),
        },
    };
    assert_eq!(
        serde_json::to_value(&sync).unwrap(),
        json!({"revision": "4", "change": {"kind": "text", "value": {"text": "<svg/>"}}})
    );
    // In lettura la revisione si accetta anche come numero.
    let read: DrawingSync = serde_json::from_value(
        json!({"revision": 4, "change": {"kind": "text", "value": {"text": "<svg/>"}}}),
    )
    .unwrap();
    assert_eq!(read, sync);
}

#[test]
fn good_requests_pass() {
    gesture().validate().unwrap();
    let mut text = gesture();
    text.tool = DrawingTool::Text;
    text.style = None;
    text.text = Some("Testo".into());
    text.validate().unwrap();
    outcome().validate().unwrap();
    DrawingSync {
        revision: 1,
        change: DrawingChange::Edits {
            edits: vec![
                DrawingEdit {
                    from: 0,
                    to: 1,
                    deleted: "a".into(),
                    inserted: "😀".into(),
                },
                DrawingEdit {
                    from: 3,
                    to: 3,
                    deleted: String::new(),
                    inserted: "z".into(),
                },
            ],
            length_before: 4,
            length_after: 6,
        },
    }
    .validate()
    .unwrap();
    DrawingOpen {
        instance: "d1".into(),
        revision: 0,
        mapped: 3,
        unmapped: 1,
        losses: vec![DrawingLoss {
            element: "/svg/g[1]/foreignObject[1]".into(),
            kind: DrawingLossKind::Unmapped,
            detail: "foreignObject".into(),
        }],
    }
    .validate()
    .unwrap();
    for (id, value) in [
        (DRAWING_COMMAND_STROKE_COLOR, json!("#ff0000")),
        (DRAWING_COMMAND_FILL_COLOR, Value::Null),
        (DRAWING_COMMAND_WIDTH, json!(2.5)),
        ("disegno.futuro", json!({"qualsiasi": true})),
    ] {
        DrawingCommandRequest {
            revision: 1,
            id: id.into(),
            selection: vec!["oa".into()],
            value,
        }
        .validate()
        .unwrap();
    }
}

#[test]
fn a_text_over_the_limit_is_refused() {
    let sync = DrawingSync {
        revision: 1,
        change: DrawingChange::Text {
            text: "a".repeat(MAX_DRAWING_TEXT_BYTES + 1),
        },
    };
    refused(sync.validate(), "change.text");
    let at = DrawingSync {
        revision: 1,
        change: DrawingChange::Text {
            text: "a".repeat(MAX_DRAWING_TEXT_BYTES),
        },
    };
    at.validate().unwrap();

    let mut text = gesture();
    text.tool = DrawingTool::Text;
    text.text = Some("a".repeat(MAX_DRAWING_TEXT_BYTES + 1));
    refused(text.validate(), "text");
}

#[test]
fn too_many_events_are_refused() {
    let mut g = gesture();
    g.events = vec![pointer(DrawingPointerKind::Drag, 1.0, 1.0); MAX_GESTURE_EVENTS];
    g.validate().unwrap();
    g.events.push(pointer(DrawingPointerKind::Up, 1.0, 1.0));
    refused(g.validate(), "events");
}

#[test]
fn a_non_finite_number_is_refused() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut g = gesture();
        g.events[1].x = bad;
        refused(g.validate(), "events.x");
        let mut g = gesture();
        g.events[0].y = bad;
        refused(g.validate(), "events.y");
        let mut g = gesture();
        g.zoom = bad;
        refused(g.validate(), "zoom");

        let mut o = outcome();
        o.preview.as_mut().unwrap().matrix = Some([1.0, 0.0, 0.0, 1.0, bad, 0.0]);
        refused(o.validate(), "preview.matrix");
        let mut o = outcome();
        o.preview.as_mut().unwrap().marquee = Some([bad, 0.0, 1.0, 1.0]);
        refused(o.validate(), "preview.marquee");
    }
    let mut g = gesture();
    g.events[0].pressure = f32::NAN;
    refused(g.validate(), "events.pressure");
    let mut g = gesture();
    g.style.as_mut().unwrap().width = f64::NAN;
    refused(g.validate(), "style.width");
}

#[test]
fn numbers_outside_their_range_are_refused() {
    for zoom in [0.0, -1.0] {
        let mut g = gesture();
        g.zoom = zoom;
        refused(g.validate(), "zoom");
    }
    for pressure in [-0.01, 1.01] {
        let mut g = gesture();
        g.events[0].pressure = pressure;
        refused(g.validate(), "events.pressure");
    }
    for grid in [0.0, -5.0, f64::NAN] {
        let mut g = gesture();
        g.snap.grid = Some(grid);
        refused(g.validate(), "snap.grid");
    }
    let mut g = gesture();
    g.style.as_mut().unwrap().width = -1.0;
    refused(g.validate(), "style.width");
    let mut o = outcome();
    o.preview.as_mut().unwrap().marquee = Some([0.0, 0.0, -1.0, 1.0]);
    refused(o.validate(), "preview.marquee");
}

#[test]
fn a_repeated_id_in_a_selection_is_refused() {
    let twice = vec!["oa".to_string(), "ob".into(), "oa".into()];
    let mut g = gesture();
    g.selection = twice.clone();
    refused(g.validate(), "selection");
    let mut o = outcome();
    o.selection = twice.clone();
    refused(o.validate(), "selection");
    let request = DrawingCommandRequest {
        revision: 1,
        id: DRAWING_COMMAND_WIDTH.into(),
        selection: twice,
        value: json!(1),
    };
    refused(request.validate(), "selection");

    let mut g = gesture();
    g.selection = vec![String::new()];
    refused(g.validate(), "selection");
}

#[test]
fn ops_over_the_limit_are_refused_by_who_writes_them() {
    let mut o = outcome();
    o.ops = Some(format!("[{}]", " ".repeat(MAX_DRAWING_OPS_BYTES - 2)));
    o.validate().unwrap();
    o.ops = Some(format!("[{}]", " ".repeat(MAX_DRAWING_OPS_BYTES - 1)));
    refused(o.validate(), "ops");

    let mut o = outcome();
    o.ops = Some("[]".into());
    o.refused = Some(DrawingRefusal::Locked);
    refused(o.validate(), "refused");
}

#[test]
fn an_empty_instance_is_refused() {
    let open = DrawingOpen {
        instance: String::new(),
        revision: 0,
        mapped: 0,
        unmapped: 0,
        losses: Vec::new(),
    };
    refused(open.validate(), "instance");
}

#[test]
fn too_many_losses_are_refused() {
    let loss = DrawingLoss {
        element: "e".into(),
        kind: DrawingLossKind::Unsupported,
        detail: String::new(),
    };
    let open = DrawingOpen {
        instance: "d1".into(),
        revision: 0,
        mapped: 0,
        unmapped: 0,
        losses: vec![loss.clone(); MAX_DRAWING_LOSSES + 1],
    };
    refused(open.validate(), "losses");
    let mut o = outcome();
    o.losses = vec![loss; MAX_DRAWING_LOSSES + 1];
    refused(o.validate(), "losses");
}

#[test]
fn malformed_edits_are_refused() {
    let edit = |from, to, deleted: &str, inserted: &str| DrawingEdit {
        from,
        to,
        deleted: deleted.into(),
        inserted: inserted.into(),
    };
    let sync = |edits, before, after| DrawingSync {
        revision: 1,
        change: DrawingChange::Edits {
            edits,
            length_before: before,
            length_after: after,
        },
    };
    refused(
        sync(vec![edit(2, 1, "", "")], 4, 4).validate(),
        "change.edits[0]",
    );
    refused(
        sync(vec![edit(1, 3, "ab", ""), edit(2, 3, "b", "")], 4, 1).validate(),
        "change.edits[1]",
    );
    refused(
        sync(vec![edit(3, 5, "ab", "")], 4, 2).validate(),
        "change.edits[0]",
    );
    refused(
        sync(vec![edit(0, 2, "a", "")], 4, 2).validate(),
        "change.edits[0].deleted",
    );
    refused(
        sync(vec![edit(0, 1, "a", "bc")], 4, 4).validate(),
        "change.length_after",
    );
    refused(
        sync(
            Vec::new(),
            MAX_DRAWING_TEXT_BYTES as u32 + 1,
            MAX_DRAWING_TEXT_BYTES as u32 + 1,
        )
        .validate(),
        "change.length_before",
    );
}

#[test]
fn text_and_layer_have_their_place() {
    let mut g = gesture();
    g.text = Some("Testo".into());
    refused(g.validate(), "text");
    let mut g = gesture();
    g.tool = DrawingTool::Text;
    g.text = Some("due\nrighe".into());
    refused(g.validate(), "text");
    let mut g = gesture();
    g.layer = Some(String::new());
    refused(g.validate(), "layer");
    let mut g = gesture();
    g.style.as_mut().unwrap().stroke = String::new();
    refused(g.validate(), "style.stroke");
    let mut o = outcome();
    o.preview.as_mut().unwrap().shape = Some(json!("rect"));
    refused(o.validate(), "preview.shape");
}

#[test]
fn command_values_have_the_command_shape() {
    for (id, value) in [
        (DRAWING_COMMAND_STROKE_COLOR, Value::Null),
        (DRAWING_COMMAND_STROKE_COLOR, json!(3)),
        (DRAWING_COMMAND_FILL_COLOR, json!(true)),
        (DRAWING_COMMAND_WIDTH, json!(-1)),
        (DRAWING_COMMAND_WIDTH, json!("2")),
    ] {
        let request = DrawingCommandRequest {
            revision: 1,
            id: id.into(),
            selection: Vec::new(),
            value,
        };
        refused(request.validate(), "value");
    }
    let request = DrawingCommandRequest {
        revision: 1,
        id: String::new(),
        selection: Vec::new(),
        value: Value::Null,
    };
    refused(request.validate(), "id");
}
