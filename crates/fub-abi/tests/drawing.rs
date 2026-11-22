//! Il contratto del disegno (`fub_abi::drawing`): la forma JSON, i vettori
//! dei gesti di `apps/client/src/__fixtures__/disegno-gesti/` letti come
//! sono, e ogni rifiuto di `validate()`.

use std::path::PathBuf;

use fub_abi::{
    DrawingAnchor, DrawingCommandInfo, DrawingDisabledReason, DrawingInput, DrawingKeyMods,
    DrawingOverlay, DrawingOverlayRole, DrawingToolState, DRAWING_COMMAND_FAMILY_PREPARE,
    DRAWING_COMMAND_TOOL_OPTION, DRAWING_COMMAND_TOOL_STATE, DRAWING_FAMILIES, MAX_DRAWING_ANCHORS,
    MAX_DRAWING_INPUTS, MAX_DRAWING_OVERLAY_TEXT_BYTES, MAX_DRAWING_TOOL_ID_BYTES,
};
use fub_abi::{
    DrawingChange, DrawingCommandRequest, DrawingEdit, DrawingFrame, DrawingGesture, DrawingLoss,
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
        frame: None,
        inputs: Vec::new(),
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
            overlays: Vec::new(),
        }),
        ops: None,
        selection: vec!["oa1a1a1a1".into()],
        losses: Vec::new(),
        refused: None,
        frame: None,
        state: None,
        reading: None,
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
            preview: false,
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
fn the_kept_frame_is_optional_and_invertible() {
    // Chi non la manda (i vettori, un client di prima) la lascia `None`.
    let mut value = serde_json::to_value(gesture()).unwrap();
    value.as_object_mut().unwrap().remove("frame");
    let read: DrawingGesture = serde_json::from_value(value).unwrap();
    assert_eq!(read.frame, None);
    let mut value = serde_json::to_value(outcome()).unwrap();
    value.as_object_mut().unwrap().remove("frame");
    let read: DrawingOutcome = serde_json::from_value(value).unwrap();
    assert_eq!(read.frame, None);

    // Una cornice girata di 30° e allungata passa, e torna uguale.
    let (s, c) = 30f64.to_radians().sin_cos();
    let girata = DrawingFrame {
        matrix: [1.5 * c, 1.5 * s, -s, c, 12.0, -4.0],
        bounds: [95.0, 95.0, 205.0, 155.0],
        geometry: [100.0, 100.0, 200.0, 150.0],
    };
    let mut g = gesture();
    g.frame = Some(girata);
    g.validate().unwrap();
    let value = serde_json::to_value(&g).unwrap();
    assert_eq!(value["frame"]["bounds"], json!([95.0, 95.0, 205.0, 155.0]));
    let back: DrawingGesture = serde_json::from_value(value).unwrap();
    assert_eq!(back.frame, Some(girata));
    let mut o = outcome();
    o.frame = Some(girata);
    o.validate().unwrap();
    // Una linea: la geometria può non avere altezza.
    let mut o = outcome();
    o.frame = Some(DrawingFrame {
        geometry: [0.0, 5.0, 10.0, 5.0],
        ..girata
    });
    o.validate().unwrap();

    // Una matrice non finita o senza inversa: `BadArgs`.
    for bad in [
        [1.0, 0.0, 0.0, 1.0, f64::NAN, 0.0],
        [f64::INFINITY, 0.0, 0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        [1.0, 2.0, 2.0, 4.0, 0.0, 0.0],
        [1e-200, 0.0, 0.0, 1e-200, 0.0, 0.0],
    ] {
        let frame = DrawingFrame {
            matrix: bad,
            ..girata
        };
        let mut g = gesture();
        g.frame = Some(frame);
        refused(g.validate(), "frame.matrix");
        let mut o = outcome();
        o.frame = Some(frame);
        refused(o.validate(), "frame.matrix");
    }
    // Un riquadro non finito o rovesciato: `BadArgs`.
    for bad in [[0.0, 0.0, f64::NAN, 1.0], [10.0, 0.0, 5.0, 1.0]] {
        let mut g = gesture();
        g.frame = Some(DrawingFrame {
            bounds: bad,
            ..girata
        });
        refused(g.validate(), "frame.bounds");
        let mut g = gesture();
        g.frame = Some(DrawingFrame {
            geometry: bad,
            ..girata
        });
        refused(g.validate(), "frame.geometry");
    }
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
        preview: false,
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
            preview: false,
        };
        refused(request.validate(), "value");
    }
    let request = DrawingCommandRequest {
        revision: 1,
        id: String::new(),
        selection: Vec::new(),
        value: Value::Null,
        preview: false,
    };
    refused(request.validate(), "id");
}

#[test]
fn an_engine_tool_is_an_object_and_its_id_is_checked() {
    let tool: DrawingTool = serde_json::from_value(json!({"engine": {"id": "pen"}})).unwrap();
    assert_eq!(tool, DrawingTool::Engine { id: "pen".into() });
    assert_eq!(
        serde_json::to_value(&tool).unwrap(),
        json!({"engine": {"id": "pen"}})
    );
    assert_eq!(
        serde_json::to_value(DrawingTool::Rect).unwrap(),
        json!("rect")
    );
    let mut g = gesture();
    g.tool = tool;
    g.validate().unwrap();
    let lungo = "a".repeat(MAX_DRAWING_TOOL_ID_BYTES + 1);
    for id in ["", "pen tool", "pénna", lungo.as_str()] {
        g.tool = DrawingTool::Engine { id: id.to_string() };
        refused(g.validate(), "tool.engine.id");
    }
}

#[test]
fn inputs_default_to_none_and_belong_to_engine_tools() {
    // Un gesto di K5 senza `inputs` si legge come prima.
    let mut raw = serde_json::to_value(gesture()).unwrap();
    raw.as_object_mut().unwrap().remove("inputs");
    let g: DrawingGesture = serde_json::from_value(raw).unwrap();
    assert!(g.inputs.is_empty());
    let input: DrawingInput = serde_json::from_value(
        json!({"kind": "key", "key": "Enter", "code": "Enter", "pressed": true}),
    )
    .unwrap();
    assert_eq!(
        input,
        DrawingInput::Key {
            key: "Enter".into(),
            code: "Enter".into(),
            mods: DrawingKeyMods::default(),
            pressed: true
        }
    );
    let mut g = gesture();
    g.inputs = vec![input.clone()];
    refused(g.validate(), "inputs");
    g.tool = DrawingTool::Engine { id: "type".into() };
    g.validate().unwrap();
    for (bad, field) in [
        (
            json!({"kind": "key", "key": "", "code": "", "pressed": true}),
            "inputs.key",
        ),
        (json!({"kind": "text", "text": ""}), "inputs.text"),
        (
            json!({"kind": "ime", "preedit": "かな", "active": [1, 3]}),
            "inputs.active",
        ),
        (
            json!({"kind": "ime", "preedit": "かな", "active": [2, 1]}),
            "inputs.active",
        ),
    ] {
        g.inputs = vec![serde_json::from_value(bad).unwrap()];
        refused(g.validate(), field);
    }
    // L'IME conta i caratteri, non i byte: [0, 2] su due caratteri giapponesi.
    g.inputs =
        vec![
            serde_json::from_value(json!({"kind": "ime", "preedit": "かな", "active": [0, 2]}))
                .unwrap(),
        ];
    g.validate().unwrap();
    g.inputs = vec![input; MAX_DRAWING_INPUTS + 1];
    refused(g.validate(), "inputs");
}

#[test]
fn overlays_have_a_role_and_are_checked() {
    let raw = json!([
        {"kind": "marquee", "rect": [0.0, 0.0, 10.0, 10.0]},
        {"kind": "path", "d": "M0 0 L1 1", "role": "preview", "width": 1.0, "dashed": false},
        {"kind": "line", "a": [0.0, 0.0], "b": [1.0, 1.0], "role": "guide", "dashed": true},
        {"kind": "anchor", "at": [0.0, 0.0], "role": "selection", "filled": true, "size": 7.0},
        {"kind": "curve_point", "at": [0.0, 0.0], "role": "selection", "filled": false, "size": 6.0},
        {"kind": "handle", "at": [0.0, 0.0], "role": "selection"},
        {"kind": "label", "at": [0.0, 0.0], "text": "anchor", "role": "guide"},
        {"kind": "measure", "at": [0.0, 0.0], "text": "W: 10"},
        {"kind": "distance", "a": [0.0, 0.0], "b": [0.0, 5.0], "text": "5", "role": "measure"},
        {"kind": "highlight", "quad": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], "role": "selection"},
        {"kind": "swatch", "at": [0.0, 0.0], "color": "#d55e00ff", "selected": true},
        {"kind": "grid_line", "a": [0.0, 0.0], "b": [9.0, 9.0], "role": "perspective"},
    ]);
    let overlays: Vec<DrawingOverlay> = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(overlays.len(), 12);
    let mut o = outcome();
    o.preview.as_mut().unwrap().overlays = overlays.clone();
    o.validate().unwrap();
    assert_eq!(serde_json::to_value(&overlays).unwrap(), raw);
    // Un esito di K5 senza i campi nuovi si legge come prima.
    let mut vecchio = serde_json::to_value(outcome()).unwrap();
    for k in ["state", "reading"] {
        vecchio.as_object_mut().unwrap().remove(k);
    }
    vecchio["preview"]
        .as_object_mut()
        .unwrap()
        .remove("overlays");
    let letto: DrawingOutcome = serde_json::from_value(vecchio).unwrap();
    assert_eq!(letto, outcome());
    let guida = DrawingOverlayRole::Guide;
    for bad in [
        DrawingOverlay::Marquee {
            rect: [0.0, 0.0, -1.0, 1.0],
        },
        DrawingOverlay::Handle {
            at: [f64::NAN, 0.0],
            role: guida,
        },
        DrawingOverlay::Anchor {
            at: [0.0, 0.0],
            role: guida,
            filled: true,
            size: -1.0,
        },
        DrawingOverlay::Measure {
            at: [0.0, 0.0],
            text: "x".repeat(MAX_DRAWING_OVERLAY_TEXT_BYTES + 1),
        },
        DrawingOverlay::Swatch {
            at: [0.0, 0.0],
            color: String::new(),
            selected: false,
        },
    ] {
        let mut o = outcome();
        o.preview.as_mut().unwrap().overlays = vec![bad.clone()];
        assert!(o.validate().is_err(), "{bad:?}");
    }
}

#[test]
fn the_tool_state_and_the_disabled_reason_have_their_shape() {
    let mut o = outcome();
    o.state = Some(DrawingToolState {
        busy: true,
        transforming: false,
        wants_text: true,
        composing: false,
        cursor: "pen_close".into(),
        options: json!({"rubber_band": true}),
        anchors: Vec::new(),
    });
    o.reading = Some(json!({"w": 1}));
    o.validate().unwrap();
    let v = serde_json::to_value(&o).unwrap();
    assert_eq!(v["state"]["cursor"], "pen_close");
    // Senza punti scelti `anchors` non si scrive, e se manca vale vuoto.
    assert!(v["state"].get("anchors").is_none());
    let letto: DrawingToolState = serde_json::from_value(v["state"].clone()).unwrap();
    assert!(letto.anchors.is_empty());
    let punto = DrawingAnchor {
        element: "p1".into(),
        subpath: 0,
        anchor: 3,
        at: [1.0, 2.0],
        end: false,
    };
    let mut con = o.clone();
    con.state.as_mut().unwrap().anchors = vec![punto.clone(); MAX_DRAWING_ANCHORS];
    con.validate().unwrap();
    assert_eq!(
        serde_json::to_value(&con).unwrap()["state"]["anchors"][0],
        json!({"element": "p1", "subpath": 0, "anchor": 3, "at": [1.0, 2.0], "end": false})
    );
    // Troppi punti, un elemento vuoto o un punto non finito: lo stato non parte.
    con.state.as_mut().unwrap().anchors.push(punto.clone());
    assert!(con.validate().is_err());
    let mut vuoto = punto.clone();
    vuoto.element.clear();
    con.state.as_mut().unwrap().anchors = vec![vuoto];
    assert!(con.validate().is_err());
    let mut lontano = punto;
    lontano.at = [f64::NAN, 0.0];
    con.state.as_mut().unwrap().anchors = vec![lontano];
    assert!(con.validate().is_err());
    assert_eq!(v["reading"], json!({"w": 1}));
    for (r, s) in [
        (DrawingRefusal::NoMemory, "no_memory"),
        (DrawingRefusal::NoPreview, "no_preview"),
        (DrawingRefusal::UnknownTool, "unknown_tool"),
    ] {
        assert_eq!(serde_json::to_value(r).unwrap(), json!(s));
    }
    let info: DrawingCommandInfo =
        serde_json::from_value(json!({"id": DRAWING_COMMAND_WIDTH, "enabled": true})).unwrap();
    assert_eq!(info.disabled_reason, None);
    let spento = DrawingCommandInfo {
        id: DRAWING_COMMAND_WIDTH.into(),
        enabled: false,
        disabled_reason: Some(DrawingDisabledReason::Other {
            text: "perché".into(),
        }),
    };
    assert_eq!(
        serde_json::to_value(&spento).unwrap()["disabled_reason"],
        json!({"other": {"text": "perché"}})
    );
    assert_eq!(
        serde_json::to_value(DrawingDisabledReason::NeedsPath).unwrap(),
        json!("needs_path")
    );
    assert_eq!(
        serde_json::to_value(DrawingDisabledReason::NeedsAnchors).unwrap(),
        json!("needs_anchors")
    );
}

#[test]
fn the_tool_option_and_the_family_requests_are_checked() {
    let request = |id: &str, value: Value| DrawingCommandRequest {
        revision: 1,
        id: id.into(),
        selection: Vec::new(),
        value,
        preview: false,
    };
    request(
        DRAWING_COMMAND_TOOL_OPTION,
        json!({"strumento": "pen", "chiave": "k", "valore": null}),
    )
    .validate()
    .unwrap();
    for (value, field) in [
        (json!(1), "value"),
        (json!({"strumento": "pen", "chiave": "k"}), "value.valore"),
        (
            json!({"strumento": "pen tool", "chiave": "k", "valore": 1}),
            "value.strumento",
        ),
        (
            json!({"strumento": "pen", "chiave": "", "valore": 1}),
            "value.chiave",
        ),
        (
            json!({"strumento": "pen", "chiave": "k", "valore": 1, "altro": 2}),
            "value.altro",
        ),
    ] {
        refused(
            request(DRAWING_COMMAND_TOOL_OPTION, value).validate(),
            field,
        );
    }
    request(
        DRAWING_COMMAND_TOOL_STATE,
        json!({"strumento": "directSelection"}),
    )
    .validate()
    .unwrap();
    for (value, field) in [
        (json!("pen"), "value"),
        (json!({}), "value.strumento"),
        (json!({"strumento": "pen tool"}), "value.strumento"),
        (json!({"strumento": "pen", "chiave": "k"}), "value.chiave"),
    ] {
        refused(request(DRAWING_COMMAND_TOOL_STATE, value).validate(), field);
    }
    assert_eq!(DRAWING_FAMILIES.len(), 26);
    for famiglia in DRAWING_FAMILIES {
        request(
            DRAWING_COMMAND_FAMILY_PREPARE,
            json!({"famiglia": famiglia}),
        )
        .validate()
        .unwrap();
    }
    for (value, field) in [
        (json!({"famiglia": "magia"}), "value.famiglia"),
        (json!({"famiglia": "testo", "x": 1}), "value.x"),
        (json!("testo"), "value"),
    ] {
        refused(
            request(DRAWING_COMMAND_FAMILY_PREPARE, value).validate(),
            field,
        );
    }
    // `preview` manca nelle richieste di prima: vale `false`.
    let letta: DrawingCommandRequest = serde_json::from_value(json!({
        "revision": "1", "id": DRAWING_COMMAND_WIDTH, "selection": [], "value": 2
    }))
    .unwrap();
    assert!(!letta.preview);
}
