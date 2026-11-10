//! Le regole di lettura che Rust e TypeScript condividono (R1–R5, R7, R8 del
//! piano N3, `docs/reference/canvas-format.md` § «Lettura»), con i casi della
//! prova 2: un test per regola. Il lettore TypeScript ha gli stessi casi
//! (`apps/client/src/editors/canvas/`).

use fub_canvas_core::model::MAX_SAFE_INTEGER;
use fub_canvas_core::read::is_blank;
use fub_canvas_core::source::canvas_value;
use fub_canvas_core::{parse, Canvas, CanvasError};
use serde_json::{json, Value};

/// I campi di una scheda di testo minima, scritti come nel file.
const BASE_NODE: [(&str, &str); 7] = [
    ("id", r#""a""#),
    ("type", r#""text""#),
    ("text", r#""""#),
    ("x", "0"),
    ("y", "0"),
    ("width", "1"),
    ("height", "1"),
];

/// Una lavagna con una scheda di testo: `field` (scritto come nel file, per
/// esempio `"x":1e2`) prende il posto del campo di base con la stessa chiave,
/// o va in fondo. Un solo campo per chiave: i doppi si scrivono a mano.
fn node_with(field: &str) -> String {
    let (key, _) = field.split_once(':').expect("a `\"key\":value` field");
    let key = key.trim_matches('"');
    let mut fields: Vec<String> = BASE_NODE
        .iter()
        .filter(|(base, _)| *base != key)
        .map(|(base, value)| format!(r#""{base}":{value}"#))
        .collect();
    fields.push(field.to_owned());
    format!(r#"{{"nodes":[{{{}}}]}}"#, fields.join(","))
}

/// Una lavagna con una scheda i cui campi sono `fields`, così come sono.
fn node_raw(fields: &str) -> String {
    format!(r#"{{"nodes":[{{{fields}}}]}}"#)
}

fn json_error(source: &str) -> String {
    match parse(source) {
        Err(CanvasError::Json(error)) => error.to_string(),
        other => panic!("{source:?} should be a JSON error, got {other:?}"),
    }
}

#[test]
fn r1_blank_is_an_optional_bom_then_json_whitespace() {
    for blank in ["", " \t\r\n", "\u{feff}", "\u{feff} \n", "\r\n\r\n"] {
        assert!(is_blank(blank), "{blank:?}");
        assert_eq!(parse(blank).unwrap(), Canvas::default(), "{blank:?}");
    }
    // `str::trim` li conterebbe come spazio; JSON no.
    for not_blank in [
        "\u{85}",
        " \u{85} ",
        "\u{a0}",
        "\u{2028}",
        "\u{feff}\u{feff}",
        " \u{feff}",
    ] {
        assert!(!is_blank(not_blank), "{not_blank:?}");
        assert!(
            matches!(parse(not_blank), Err(CanvasError::Json(_))),
            "{not_blank:?}"
        );
    }
    // Il BOM si salta anche davanti a una lavagna piena.
    assert!(parse("\u{feff}{\"nodes\":[]}").unwrap().nodes.is_empty());
}

#[test]
fn r2_known_numbers_are_safe_integers_however_written() {
    for (written, value) in [
        ("1e2", 100),
        ("1.0", 1),
        ("-0", 0),
        ("-0.0", 0),
        ("1E+2", 100),
        ("9007199254740991", MAX_SAFE_INTEGER),
        ("-9007199254740991", -MAX_SAFE_INTEGER),
        ("9007199254740991.0", MAX_SAFE_INTEGER),
    ] {
        let canvas = parse(&node_with(&format!(r#""x":{written}"#)))
            .unwrap_or_else(|error| panic!("x = {written} should read: {error}"));
        assert_eq!(canvas.nodes[0].x, value, "x = {written}");
    }
    for field in ["x", "y", "width", "height"] {
        for written in [
            "1.5",
            "9007199254740992",
            "-9007199254740992",
            "9007199254740993",
            "18446744073709551616",
            "1e300",
            "0.1",
        ] {
            let error = json_error(&node_with(&format!(r#""{field}":{written}"#)));
            assert!(
                error.contains(&format!("`{field}`")),
                "{field} = {written}: {error}"
            );
        }
        // Una stringa o un booleano non è un numero.
        let error = json_error(&node_with(&format!(r#""{field}":"1""#)));
        assert!(
            error.contains(&format!("`{field}`")),
            "{field} = \"1\": {error}"
        );
    }
    // `width` e `height` almeno 1, come prima: `1e0` va, `0.0` no.
    assert_eq!(
        parse(&node_with(r#""width":1e0"#)).unwrap().nodes[0].width,
        1
    );
    assert!(matches!(
        parse(&node_with(r#""height":0.0"#)),
        Err(CanvasError::Invalid(_))
    ));
}

#[test]
fn r3_a_known_key_twice_is_an_error_an_unknown_one_keeps_the_last_value_first_place() {
    for source in [
        node_raw(r#""id":"a","type":"text","text":"","x":0,"y":0,"x":1,"width":1,"height":1"#),
        node_raw(r#""id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1,"height":2"#),
        node_raw(r#""id":"a","type":"text","text":"","text":"b","x":0,"y":0,"width":1,"height":1"#),
        node_raw(r#""id":"a","id":"b","type":"text","text":"","x":0,"y":0,"width":1,"height":1"#),
        node_raw(r#""id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1,"color":"1","color":"2""#),
        r#"{"nodes":[],"nodes":[]}"#.to_owned(),
        r#"{"edges":[],"edges":[]}"#.to_owned(),
        r#"{"nodes":[{"id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1}],"edges":[{"id":"e","fromNode":"a","toNode":"a","toNode":"a"}]}"#.to_owned(),
    ] {
        let error = json_error(&source);
        assert!(error.contains("duplicate field"), "{source}: {error}");
    }

    let canvas = parse(&node_raw(
        r#""id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1,"k":1,"z":2,"k":3"#,
    ))
    .unwrap();
    let extra: Vec<(&str, &Value)> = canvas.nodes[0]
        .extra
        .iter()
        .map(|(k, v)| (k.as_str(), v))
        .collect();
    assert_eq!(extra, [("k", &json!(3)), ("z", &json!(2))]);

    let canvas = parse(r#"{"k":1,"nodes":[],"z":2,"k":{"v":3}}"#).unwrap();
    let keys: Vec<&str> = canvas.extra.keys().map(String::as_str).collect();
    assert_eq!(keys, ["k", "z"]);
    assert_eq!(canvas.extra["k"], json!({"v": 3}));

    // Dentro un valore sconosciuto vale lo stesso.
    let canvas = parse(r#"{"fub:ink":{"a":1,"b":2,"a":3}}"#).unwrap();
    assert_eq!(
        serde_json::to_string(&canvas.extra["fub:ink"]).unwrap(),
        r#"{"a":3,"b":2}"#
    );
}

#[test]
fn r4_a_lone_surrogate_is_an_error_in_a_key_or_a_value() {
    for source in [
        node_with(r#""k":"\ud800""#),
        node_with(r#""k":"\udc00""#),
        node_with(r#""k":"\ud800x""#),
        node_with(r#""\ud800":1"#),
        r#"{"fub:ink":["\udfff"]}"#.to_owned(),
        r#"{"nodes":[{"id":"a","type":"text","text":"\ud800","x":0,"y":0,"width":1,"height":1}]}"#
            .to_owned(),
    ] {
        assert!(
            matches!(parse(&source), Err(CanvasError::Json(_))),
            "{source}"
        );
    }
    // Una coppia intera è un carattere come gli altri.
    let canvas = parse(&node_with(r#""k":"😀""#)).unwrap();
    assert_eq!(canvas.nodes[0].extra["k"], json!("\u{1f600}"));
}

#[test]
fn r5_a_number_beyond_a_f64_is_an_error_anywhere() {
    for source in [
        r#"{"fub:ink":1e400}"#.to_owned(),
        r#"{"fub:ink":[-1e400]}"#.to_owned(),
        r#"{"fub:ink":{"deep":{"n":1e309}}}"#.to_owned(),
        node_with(r#""k":1e400"#),
        node_with(r#""x":1e400"#),
    ] {
        assert!(
            matches!(parse(&source), Err(CanvasError::Json(_))),
            "{source}"
        );
    }
    // Il più grande `f64` finito si legge, e un numero che si arrotonda a zero
    // non è fuori campo.
    let canvas = parse(r#"{"big":1.7976931348623157e308,"tiny":1e-400}"#).unwrap();
    assert_eq!(canvas.extra["big"], json!(f64::MAX));
    assert_eq!(canvas.extra["tiny"], json!(0.0));
}

#[test]
fn r7_null_is_absent() {
    // `"nodes": null` con `"edges"` assente, e il contrario.
    let canvas = parse(r#"{"nodes":null}"#).unwrap();
    assert_eq!(canvas, Canvas::default());
    let canvas = parse(r#"{"nodes":null,"edges":null,"k":1}"#).unwrap();
    assert!(canvas.nodes.is_empty() && canvas.edges.is_empty());
    assert_eq!(canvas.extra["k"], json!(1));
    let canvas = parse(r#"{"edges":null,"nodes":[]}"#).unwrap();
    assert!(canvas.edges.is_empty());

    let source = r#"{"nodes":[
        {"id":"a","type":"text","text":"t","x":0,"y":0,"width":1,"height":1,
         "color":null,"file":null,"subpath":null,"url":null,"label":null,
         "background":null,"backgroundStyle":null},
        {"id":"b","type":"file","file":"n.md","subpath":null,"x":0,"y":0,"width":1,"height":1}
    ],"edges":[
        {"id":"e","fromNode":"a","toNode":"b","fromSide":null,"fromEnd":null,
         "toSide":null,"toEnd":null,"color":null,"label":null}
    ]}"#;
    let canvas = parse(source).unwrap();
    let node = &canvas.nodes[0];
    assert!(node.color.is_none() && node.file.is_none() && node.subpath.is_none());
    assert!(node.url.is_none() && node.label.is_none());
    assert!(node.background.is_none() && node.background_style.is_none());
    assert!(
        node.extra.is_empty(),
        "a known null is not an unknown field"
    );
    assert!(canvas.nodes[1].subpath.is_none());
    let edge = &canvas.edges[0];
    assert!(edge.from_side.is_none() && edge.from_end.is_none());
    assert!(edge.to_side.is_none() && edge.to_end.is_none());
    assert!(edge.color.is_none() && edge.label.is_none());
    assert!(edge.extra.is_empty());

    // Un campo obbligatorio `null` resta un errore.
    assert!(parse(&node_with(r#""text":null"#)).is_err());
    assert!(parse(&node_with(r#""x":null"#)).is_err());
    assert!(parse(&node_with(r#""id":null"#)).is_err());
}

#[test]
fn r8_background_style_keeps_any_string() {
    for style in ["cover", "ratio", "repeat", "tile", "", "Cover"] {
        let canvas = parse(&node_with(&format!(r#""backgroundStyle":"{style}""#))).unwrap();
        assert_eq!(canvas.nodes[0].background_style.as_deref(), Some(style));
    }
    // Una stringa, non qualunque valore.
    assert!(matches!(
        parse(&node_with(r#""backgroundStyle":1"#)),
        Err(CanvasError::Json(_))
    ));
}

#[test]
fn t47b_a_colour_fub_does_not_know_opens_and_reads_as_it_was() {
    // Un colore che Fub non conosce non ferma la lavagna: si apre, il testo
    // resta com'è e il modello lo riscrive uguale. Vale per una scheda e per un arco.
    for text in ["\"7\"", "\"rosso\"", "\"\"", "\"#12\"", "\"Rosso\""] {
        let source = node_with(&format!(r#""color":{text}"#));
        let canvas = parse(&source).unwrap_or_else(|error| panic!("{text}: {error}"));
        let color = canvas.nodes[0].color.as_ref().expect("il colore c'è");
        assert!(!color.is_known(), "{text}");
        let value = canvas_value(&canvas).expect("la lavagna si scrive");
        assert_eq!(value["nodes"][0]["color"], json!(text.trim_matches('"')));
        let edge = format!(
            r#"{{"nodes":[{{"id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1}}],"edges":[{{"id":"e","fromNode":"a","toNode":"a","color":{text}}}]}}"#
        );
        let canvas = parse(&edge).unwrap_or_else(|error| panic!("arco {text}: {error}"));
        assert!(!canvas.edges[0]
            .color
            .as_ref()
            .expect("il colore dell'arco")
            .is_known());
    }
    // `null` è assente (R7), e un valore che non è una stringa non è un colore.
    assert!(parse(&node_with(r#""color":null"#)).unwrap().nodes[0]
        .color
        .is_none());
    assert!(matches!(
        parse(&node_with(r#""color":7"#)),
        Err(CanvasError::Json(_))
    ));
}
