//! Il ritocco del sorgente (`source::patch_source`, `source::node_at`): lo
//! scanner, i terminatori di riga e il BOM, più i casi limite. I testi
//! attesi sono scritti a mano; per ognuno il testo di dopo, riletto con
//! `parse`, dà il modello di dopo (`patched`).

use std::time::Instant;

use fub_canvas_core::read::is_blank;
use fub_canvas_core::source::{node_at, patch_source, SourceError};
use fub_canvas_core::{parse, Canvas, CanvasEdge, CanvasNode};
use serde_json::json;

const CARD: &str = r#"{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"t"}"#;

/// Il ritocco da `before` ad `after`; il testo di dopo, riletto, dà `after`.
fn patched(source: &str, before: &Canvas, after: &Canvas) -> String {
    let written = patch_source(source, before, after)
        .unwrap_or_else(|error| panic!("{source:?} should patch: {error}"));
    let reread = parse(&written).unwrap_or_else(|error| panic!("{written:?} should read: {error}"));
    assert_eq!(&reread, after, "{written:?} should read as the model after");
    written
}

/// Legge `source`, applica `change` al modello e controlla il testo di dopo.
/// Restituisce i due modelli, per l'annulla.
fn check(source: &str, change: impl FnOnce(&mut Canvas), expected: &str) -> (Canvas, Canvas) {
    let before = parse(source).unwrap();
    let mut after = before.clone();
    change(&mut after);
    assert_eq!(patched(source, &before, &after), expected);
    (before, after)
}

fn node(json: &str) -> CanvasNode {
    serde_json::from_str(json).unwrap()
}

fn edge(json: &str) -> CanvasEdge {
    serde_json::from_str(json).unwrap()
}

fn text_node(id: &str, x: i64, y: i64, width: i64, height: i64, text: &str) -> CanvasNode {
    node(
        &json!({"id": id, "type": "text", "x": x, "y": y, "width": width, "height": height, "text": text})
            .to_string(),
    )
}

// --- Lo scanner e le schede -----------------------------------------------

#[test]
fn node_at_finds_the_card_whose_source_object_holds_the_offset() {
    let source =
        "{\"edges\":[],\"nodes\":[{\"id\":\"a\"},\n  {\"id\":\"b\",\"text\":\"x\"}],\"extra\":1}";
    let first = source.find(r#"{"id":"a"}"#).unwrap();
    let second = source.find(r#"{"id":"b""#).unwrap();
    let len = r#"{"id":"a"}"#.len();
    assert_eq!(node_at(source, first), Some(0));
    assert_eq!(node_at(source, first + len - 1), Some(0));
    // La virgola e lo spazio fra due carte non sono di nessuna.
    assert_eq!(node_at(source, first + len), None);
    assert_eq!(node_at(source, second + 5), Some(1));
    assert_eq!(node_at(source, source.find(r#""extra""#).unwrap()), None);
}

#[test]
fn node_at_invents_no_card_without_nodes_or_in_an_unreadable_source() {
    assert_eq!(node_at(r#"{"edges":[]}"#, 3), None);
    assert_eq!(node_at(r#"{"nodes":["#, 9), None);
    assert_eq!(node_at("", 0), None);
    assert_eq!(node_at(r#"[{"id":"a"}]"#, 1), None);
    assert_eq!(node_at(r#"{"nodes":[{"id":"a"}]}"#, usize::MAX), None);
}

#[test]
fn blank_is_an_optional_bom_then_json_whitespace_not_trim() {
    for blank in ["", " \t\r\n", "\u{feff}", "\u{feff}\r\n"] {
        assert!(is_blank(blank), "{blank:?}");
    }
    for full in [
        "\u{a0}",
        "\u{85}",
        "\u{2028}",
        " \u{feff}",
        "\u{feff}\u{feff}",
        "{}",
    ] {
        assert!(!is_blank(full), "{full:?}");
    }
}

/// I casi di `inspectCanvasJson` che sono della lettura (R4, R5): in Rust li
/// fa `parse`, dentro una lavagna. `["x\uDBFF"]` con il surrogato crudo non
/// esiste in Rust, dove una `&str` è sempre UTF-8 valido.
#[test]
fn the_reader_rejects_a_lone_surrogate_and_a_number_beyond_a_f64_not_the_rest() {
    for bad in [
        r#"{"a":"\ud800"}"#,
        r#"{"\udc00":1}"#,
        r#"{"a":[1e400]}"#,
        r#"{"a":[-1e999]}"#,
    ] {
        assert!(parse(bad).is_err(), "{bad}");
    }
    for good in [
        r#"{"a":"\ud83d\ude00"}"#,
        r#"{"a":["😀","\n\u0041"]}"#,
        r#"{"a":[1e308,-0,true,null]}"#,
    ] {
        let canvas = parse(good).unwrap();
        assert_eq!(patched(good, &canvas, &canvas), good);
    }
}

#[test]
fn a_repeated_key_is_an_error_at_any_depth_with_its_byte_offset() {
    let source = r#"{"a":1,"nodes":[{"id":"x","k":{"q":1,"q":2},"id":"y"}],"a":2}"#;
    let empty = Canvas::default();
    match patch_source(source, &empty, &empty) {
        Err(SourceError::DuplicateKey { offset, key }) => {
            assert_eq!(key, "q");
            assert_eq!(offset, source.find(r#""q":2"#).unwrap());
        }
        other => panic!("expected a duplicate key, got {other:?}"),
    }
    assert_eq!(node_at(source, source.find(r#"{"id""#).unwrap()), None);
}

#[test]
fn keys_compare_decoded_and_the_leading_bom_is_skipped() {
    let source = "\u{feff} {\"\\u0061\":1,\"a\":2}";
    let empty = Canvas::default();
    match patch_source(source, &empty, &empty) {
        Err(SourceError::DuplicateKey { offset, key }) => {
            assert_eq!(key, "a");
            assert_eq!(offset, source.find(r#""a""#).unwrap());
        }
        other => panic!("expected a duplicate key, got {other:?}"),
    }
    let distinct = r#"{"a":{"b":1},"c":[{"b":2}]}"#;
    let canvas = parse(distinct).unwrap();
    assert_eq!(patched(distinct, &canvas, &canvas), distinct);
}

#[test]
fn the_rewriter_still_rejects_any_repeated_key_unknown_too() {
    let source = format!(r#"{{"nodes":[{CARD}],"meta":{{"z":1,"z":2}}}}"#);
    let before = parse(&source).unwrap();
    let mut after = before.clone();
    after.nodes[0].x = 5;
    assert!(matches!(
        patch_source(&source, &before, &after),
        Err(SourceError::DuplicateKey { key, .. }) if key == "z"
    ));
}

#[test]
fn only_json_whitespace_counts_as_space() {
    assert_eq!(node_at(&format!(r#"{{"nodes":[ {CARD}]}}"#), 11), Some(0));
    assert_eq!(node_at(&format!("{{\"nodes\":[\u{a0}{CARD}]}}"), 11), None);
}

#[test]
fn the_bom_stays_outside_the_root() {
    let source = format!("\u{feff}{{\"nodes\":[{CARD}],\"edges\":[]}}");
    let expected = source.replace(r#""x":0"#, r#""x":5"#);
    check(&source, |c| c.nodes[0].x = 5, &expected);
}

#[test]
fn a_blank_board_with_bom_and_crlf_keeps_them_when_filled() {
    let after = parse(&format!(r#"{{"nodes":[{CARD}]}}"#)).unwrap();
    let pretty = "{\n  \"nodes\": [\n    {\n      \"id\": \"a\",\n      \"type\": \"text\",\n      \"x\": 0,\n      \"y\": 0,\n      \"width\": 10,\n      \"height\": 10,\n      \"text\": \"t\"\n    }\n  ],\n  \"edges\": []\n}\n";
    let empty = Canvas::default();
    assert_eq!(patched("", &empty, &after), pretty);
    assert_eq!(patched(" \n", &empty, &after), pretty);
    assert_eq!(
        patched("\u{feff}\r\n", &empty, &after),
        format!("\u{feff}{}", pretty.replace('\n', "\r\n"))
    );
    assert_eq!(
        patched("\u{feff}", &empty, &after),
        format!("\u{feff}{pretty}")
    );
}

/// R7 e R11: il `null` di un campo noto resta dov'è quando la sua scheda
/// cambia, e anche in quella che non cambia.
#[test]
fn the_null_of_a_known_field_stays_when_its_card_changes() {
    let a = CARD.replace('}', r#","color":null}"#);
    let b = CARD
        .replace(r#""a""#, r#""b""#)
        .replace('}', r#","label":null}"#);
    let source = format!(r#"{{"nodes":[{a},{b}],"edges":null}}"#);
    let expected = format!(
        r#"{{"nodes":[{},{b}],"edges":null}}"#,
        a.replace(r#""x":0"#, r#""x":5"#)
    );
    check(&source, |c| c.nodes[0].x = 5, &expected);
}

/// Una scheda che si ricompone (perde un campo) tiene i suoi `null` al loro
/// posto, con il separatore che aveva.
#[test]
fn the_null_stays_in_a_card_that_is_recomposed() {
    let source = r#"{"nodes":[{"id":"a", "type":"file", "x":0, "y":0, "width":10, "height":10, "color":null, "file":"a.md", "subpath":null, "label":"via", "background":null}]}"#;
    check(
        source,
        |c| c.nodes[0].label = None,
        r#"{"nodes":[{"id":"a", "type":"file", "x":0, "y":0, "width":10, "height":10, "color":null, "file":"a.md", "subpath":null, "background":null}]}"#,
    );
}

/// Un `null` che prende un valore lo prende al suo posto, non in fondo.
#[test]
fn a_null_that_takes_a_value_takes_it_in_place() {
    let source = CARD.replace(r#""x":0"#, r#""color":null,"x":0"#);
    let source = format!(r#"{{"nodes":[{source}]}}"#);
    check(
        &source,
        |c| c.nodes[0].color = Some(fub_canvas_core::CanvasColor::Hex("#ff0000".into())),
        &source.replace(r#""color":null"#, r##""color":"#ff0000""##),
    );
}

/// Un `null` di un campo che il tipo della scheda non usa (`url` su una
/// scheda di testo) resta come gli altri.
#[test]
fn the_null_of_a_field_the_type_does_not_use_stays() {
    let source = format!(
        r#"{{"nodes":[{}]}}"#,
        CARD.replace('}', r#","url":null,"xFuture":1}"#)
    );
    check(
        &source,
        |c| {
            c.nodes[0].extra.remove("xFuture");
        },
        &format!(r#"{{"nodes":[{}]}}"#, CARD.replace('}', r#","url":null}"#)),
    );
}

/// Un campo noto che c'era e che Fub toglie va via, anche accanto a un
/// `null` che resta.
#[test]
fn a_removed_field_goes_and_the_null_beside_it_stays() {
    let source = format!(
        r#"{{"nodes":[{}]}}"#,
        CARD.replace('}', r#","color":"2","label":null}"#)
    );
    check(
        &source,
        |c| c.nodes[0].color = None,
        &format!(
            r#"{{"nodes":[{}]}}"#,
            CARD.replace('}', r#","label":null}"#)
        ),
    );
}

/// Il `null` di un arco resta come quello di una scheda.
#[test]
fn the_null_of_an_edge_field_stays() {
    let source = format!(
        r#"{{"nodes":[{A},{B}],"edges":[{{"id":"e","fromNode":"a","fromSide":null,"toNode":"b","label":null}}]}}"#
    );
    check(
        &source,
        |c| c.edges[0].to_node = "a".into(),
        &source.replace(r#""toNode":"b""#, r#""toNode":"a""#),
    );
}

/// Un `null` su un campo obbligatorio resta un errore di lettura (R7).
#[test]
fn a_null_on_a_required_field_does_not_read() {
    assert!(parse(&format!(
        r#"{{"nodes":[{}]}}"#,
        CARD.replace(r#""x":0"#, r#""x":null"#)
    ))
    .is_err());
}

// --- Terminatori di riga e BOM --------------------------------------------

const LF: &str = "{\n  \"nodes\": [\n    {\"id\":\"a\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":200,\"height\":100,\"text\":\"uno\"},\n    {\"id\":\"b\",\"type\":\"text\",\"x\":300,\"y\":0,\"width\":200,\"height\":100,\"text\":\"due\"}\n  ],\n  \"edges\": [\n    {\"id\":\"e\",\"fromNode\":\"a\",\"toNode\":\"b\"}\n  ]\n}\n";

const A: &str = r#"{"id":"a","type":"text","x":0,"y":0,"width":200,"height":100,"text":"uno"}"#;
const B: &str = r#"{"id":"b","type":"text","x":300,"y":0,"width":200,"height":100,"text":"due"}"#;
const C: &str = r#"{"id":"c","type":"text","x":0,"y":300,"width":100,"height":50,"text":"tre"}"#;
const E: &str = r#"{"id":"e","fromNode":"a","toNode":"b"}"#;
const F: &str = r#"{"id":"f","fromNode":"b","toNode":"a"}"#;

/// Un cambiamento del modello, il testo atteso dopo (su `LF`) e quello atteso
/// dopo l'annulla.
struct Change {
    name: &'static str,
    apply: fn(&mut Canvas),
    after: String,
    undone: String,
}

fn changes() -> Vec<Change> {
    vec![
        Change {
            name: "sposta una card",
            apply: |c| c.nodes[1].x = 888,
            after: LF.replace(r#""x":300"#, r#""x":888"#),
            undone: LF.to_owned(),
        },
        Change {
            name: "aggiunge una card",
            apply: |c| c.nodes.push(text_node("c", 0, 300, 100, 50, "tre")),
            after: format!(
                "{{\n  \"nodes\": [\n    {A},\n    {B},\n    {C}\n  ],\n  \"edges\": [\n    {E}\n  ]\n}}\n"
            ),
            undone: LF.to_owned(),
        },
        Change {
            name: "toglie un arco e una card",
            apply: |c| {
                c.edges.clear();
                c.nodes.truncate(1);
            },
            after: format!("{{\n  \"nodes\": [\n    {A}\n  ],\n  \"edges\": []\n}}\n"),
            // La card torna come oggetto compatto, con il separatore di un
            // array a una voce; l'arco torna in un array che era vuoto.
            undone: format!("{{\n  \"nodes\": [\n    {A},{B}\n  ],\n  \"edges\": [{E}]\n}}\n"),
        },
        Change {
            name: "aggiunge un arco",
            apply: |c| c.edges.push(edge(F)),
            after: format!(
                "{{\n  \"nodes\": [\n    {A},\n    {B}\n  ],\n  \"edges\": [\n    {E},{F}\n  ]\n}}\n"
            ),
            undone: LF.to_owned(),
        },
    ]
}

/// Le quattro varianti del file: lo stesso testo con o senza BOM e CRLF.
fn variants(text: &str) -> [(&'static str, String); 4] {
    let crlf = text.replace('\n', "\r\n");
    [
        ("LF", text.to_owned()),
        ("CRLF", crlf.clone()),
        ("BOM", format!("\u{feff}{text}")),
        ("BOM+CRLF", format!("\u{feff}{crlf}")),
    ]
}

fn assert_endings(variant: &str, original: &str, written: &str) {
    assert_eq!(
        written.starts_with('\u{feff}'),
        original.starts_with('\u{feff}'),
        "{variant}"
    );
    if original.contains("\r\n") {
        assert!(
            !written.replace("\r\n", "").contains('\n'),
            "{variant}: {written:?}"
        );
    } else {
        assert!(!written.contains('\r'), "{variant}: {written:?}");
    }
}

#[test]
fn crlf_and_bom_boards_keep_endings_and_bom_and_undo_returns_to_the_model_before() {
    for change in changes() {
        let expected = variants(&change.after);
        let undone = variants(&change.undone);
        for (index, (variant, original)) in variants(LF).iter().enumerate() {
            let before = parse(original).unwrap();
            assert_eq!(before.nodes.len(), 2, "{variant}: si apre");
            let mut after = before.clone();
            (change.apply)(&mut after);
            let written = patched(original, &before, &after);
            assert_eq!(written, expected[index].1, "{variant}: {}", change.name);
            assert_endings(variant, original, &written);
            let back = patched(&written, &after, &before);
            assert_eq!(back, undone[index].1, "{variant}: annulla {}", change.name);
            assert_endings(variant, original, &back);
        }
    }
}

// --- I casi limite ---------------------------------------------------------

#[test]
fn a_one_line_file_keeps_its_comma_separator() {
    let source = format!(r#"{{"nodes":[{A},{B}],"edges":[]}}"#);
    check(
        &source,
        |c| c.nodes.push(text_node("c", 0, 300, 100, 50, "tre")),
        &format!(r#"{{"nodes":[{A},{B},{C}],"edges":[]}}"#),
    );
    check(
        &source,
        |c| {
            c.nodes.remove(0);
        },
        &format!(r#"{{"nodes":[{B}],"edges":[]}}"#),
    );
}

const THREE: &str = "{\n  \"nodes\": [\n    {A},\n    {B},\n    {C}\n  ],\n  \"edges\": []\n}\n";

fn three() -> String {
    THREE.replace("{A}", A).replace("{B}", B).replace("{C}", C)
}

#[test]
fn a_card_removed_in_the_middle() {
    check(
        &three(),
        |c| {
            c.nodes.remove(1);
        },
        &format!("{{\n  \"nodes\": [\n    {A},\n    {C}\n  ],\n  \"edges\": []\n}}\n"),
    );
}

#[test]
fn the_first_and_the_last_card_removed_leave_no_stray_comma() {
    check(
        &three(),
        |c| {
            c.nodes.remove(2);
            c.nodes.remove(0);
        },
        &format!("{{\n  \"nodes\": [\n    {B}\n  ],\n  \"edges\": []\n}}\n"),
    );
    check(
        &three(),
        |c| c.nodes.clear(),
        "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
    );
}

#[test]
fn reordered_cards_keep_their_own_text() {
    let source = format!("{{\n  \"nodes\": [\n    {A},\n    {B}\n  ]}}");
    check(
        &source,
        |c| c.nodes.swap(0, 1),
        // `edges` resta assente: è vuoto (R11).
        &format!("{{\n  \"nodes\": [\n    {B},\n    {A}\n  ]}}"),
    );
}

#[test]
fn nodes_absent_then_a_new_card() {
    check(
        r#"{"edges":[]}"#,
        |c| c.nodes.push(text_node("c", 0, 300, 100, 50, "tre")),
        &format!(r#"{{"edges":[],"nodes":[{C}]}}"#),
    );
    check(
        "{\n  \"edges\": []\n}",
        |c| c.nodes.push(text_node("c", 0, 300, 100, 50, "tre")),
        &format!("{{\n  \"edges\": [],\"nodes\":[{C}]\n}}"),
    );
    // `"nodes": null` vale assente (R7): il valore va al posto del `null`, e
    // `edges`, vuoto, non arriva.
    check(
        r#"{"nodes": null}"#,
        |c| c.nodes.push(text_node("c", 0, 300, 100, 50, "tre")),
        &format!(r#"{{"nodes": [{C}]}}"#),
    );
}

/// `edges` assente resta assente quando una scheda arriva e va via; con il
/// primo arco arriva in fondo alla radice.
#[test]
fn edges_absent_stays_absent_until_the_first_edge() {
    let source = format!("{{\r\n\t\"nodes\": [{A}],\r\n\t\"xFuture\": 1\r\n}}");
    let (_, with_b) = check(
        &source,
        |c| c.nodes.push(text_node("b", 300, 0, 200, 100, "due")),
        &format!("{{\r\n\t\"nodes\": [{A},{B}],\r\n\t\"xFuture\": 1\r\n}}"),
    );
    let written = patched(&source, &parse(&source).unwrap(), &with_b);
    let mut without_b = with_b.clone();
    without_b.nodes.pop();
    assert_eq!(patched(&written, &with_b, &without_b), source);
    let mut without_a = parse(&source).unwrap();
    without_a.nodes.clear();
    assert_eq!(
        patched(&source, &parse(&source).unwrap(), &without_a),
        "{\r\n\t\"nodes\": [],\r\n\t\"xFuture\": 1\r\n}"
    );
    let mut connected = with_b.clone();
    connected.edges.push(edge(E));
    assert_eq!(
        patched(&written, &with_b, &connected),
        format!("{{\r\n\t\"nodes\": [{A},{B}],\r\n\t\"xFuture\": 1,\r\n\t\"edges\":[{E}]\r\n}}")
    );
}

/// Una radice senza `nodes` né `edges` che cambia solo per un campo
/// sconosciuto non li riceve.
#[test]
fn an_empty_root_does_not_get_nodes_or_edges() {
    let source = "\u{feff}{\"xFuture\":1}";
    check(
        source,
        |c| {
            c.extra.insert("xFuture".into(), json!(2));
        },
        "\u{feff}{\"xFuture\":2}",
    );
}

#[test]
fn an_unchanged_board_stays_byte_for_byte_even_without_edges() {
    let source = format!("\u{feff}\r\n {{ \"nodes\" : [ {A} ] , \"x:y\" : 1.50 }} \r\n");
    let canvas = parse(&source).unwrap();
    assert_eq!(patched(&source, &canvas, &canvas), source);
}

#[test]
fn four_byte_characters_in_a_text_count_as_four_bytes() {
    let a = A.replace("uno", "😀 uno");
    let b = B.replace("due", "due 𝄞");
    let source = format!(r#"{{"nodes":[{a},{b}],"edges":[]}}"#);
    let expected = format!(
        r#"{{"nodes":[{a},{}],"edges":[]}}"#,
        B.replace("due", "tre 🎉")
    );
    check(
        &source,
        |c| c.nodes[1].text = Some("tre 🎉".to_owned()),
        &expected,
    );

    let second = source.find(r#"{"id":"b""#).unwrap();
    assert_eq!(node_at(&source, second), Some(1));
    assert_eq!(node_at(&source, second - 2), Some(0));
    // Un offset in mezzo a un carattere cade nella sua scheda, senza panico.
    let emoji = source.find('😀').unwrap();
    assert_eq!(node_at(&source, emoji + 1), Some(0));
}

#[test]
fn a_nested_unknown_field_changes_alone() {
    let source = r#"{"nodes":[],"edges":[],"meta":{"deep":{"k":1, "j":[1, 2]},"keep":1.50}}"#;
    check(
        source,
        |c| c.extra["meta"]["deep"]["j"][1] = json!(3),
        r#"{"nodes":[],"edges":[],"meta":{"deep":{"k":1, "j":[1, 3]},"keep":1.50}}"#,
    );
    // Una chiave nuova ricompone solo l'oggetto che la riceve, e va in fondo
    // dopo il separatore che l'oggetto usava (qui `", "`).
    check(
        source,
        |c| c.extra["meta"]["deep"]["n"] = json!("x/é"),
        r#"{"nodes":[],"edges":[],"meta":{"deep":{"k":1, "j":[1, 2], "n":"x/é"},"keep":1.50}}"#,
    );
}

#[test]
fn nested_repeated_keys_are_refused() {
    let source = r#"{"nodes":[],"meta":{"a":[{"b":{"c":1,"c":2}}]}}"#;
    let canvas = parse(source).unwrap();
    assert!(matches!(
        patch_source(source, &canvas, &canvas),
        Err(SourceError::DuplicateKey { offset, key }) if key == "c" && offset == source.find(r#""c":2"#).unwrap()
    ));
}

#[test]
fn a_key_added_to_an_existing_card_goes_last() {
    check(
        LF,
        |c| c.nodes[0].color = serde_json::from_value(json!("1")).unwrap(),
        &LF.replace(r#""text":"uno"}"#, r#""text":"uno","color":"1"}"#),
    );
}

#[test]
fn new_cards_and_edges_are_written_in_the_r10_order() {
    let source = r#"{"nodes":[],"edges":[]}"#;
    check(
        source,
        |c| {
            c.nodes.push(node(
                r##"{"z":1,"0":2,"text":"t","height":5,"width":4,"y":3,"x":2,"type":"text","id":"c","color":"#ff0000"}"##,
            ));
            c.edges.push(edge(
                r#"{"label":"x","color":"1","toEnd":"arrow","toSide":"left","toNode":"c","fromEnd":"none","fromSide":"right","fromNode":"c","id":"f"}"#,
            ));
        },
        r##"{"nodes":[{"0":2,"id":"c","type":"text","x":2,"y":3,"width":4,"height":5,"color":"#ff0000","text":"t","z":1}],"edges":[{"id":"f","fromNode":"c","fromSide":"right","fromEnd":"none","toNode":"c","toSide":"left","toEnd":"arrow","color":"1","label":"x"}]}"##,
    );
}

#[test]
fn equal_numbers_count_as_equal_whatever_their_spelling() {
    // `"keep": 1.50` resta com'è: il modello lo legge 1.5 prima e dopo.
    // `"n": 1e2` si legge come un decimale, il modello di dopo ha l'intero
    // 100: per JavaScript sono lo stesso numero, e il testo non cambia.
    let source = r#"{"nodes":[],"edges":[],"keep":1.50,"n":1e2}"#;
    let before = parse(source).unwrap();
    let mut after = before.clone();
    after.extra["n"] = json!(100);
    assert_eq!(patch_source(source, &before, &after).unwrap(), source);
}

#[test]
fn a_card_equal_only_as_a_value_stays_byte_for_byte() {
    // Il modello di dopo ha l'intero 1 dove il sorgente ha `1.0`: le struct
    // sono diverse, i valori JSON no. Il testo non cambia, e la radice non
    // riceve l'`edges` che non aveva.
    let source = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":1,"height":1,"text":"","k":1.0}]}"#;
    let before = parse(source).unwrap();
    let mut after = before.clone();
    after.nodes[0].extra["k"] = json!(1);
    assert_ne!(before, after);
    assert_eq!(patch_source(source, &before, &after).unwrap(), source);
}

#[test]
fn a_broken_source_is_an_error_not_a_panic() {
    let empty = Canvas::default();
    let deep = "[".repeat(300) + &"]".repeat(300);
    for bad in [
        r#"{"nodes":["#,
        r#"{"a":1,}"#,
        r#"{"a":}"#,
        r#"{"a":"\"#,
        r#"{"a" 1}"#,
        r#"{"a":1}x"#,
        r#"{"a":@}"#,
        "\u{feff}\u{feff}{}",
        deep.as_str(),
    ] {
        assert!(patch_source(bad, &empty, &empty).is_err(), "{bad:?}");
        assert_eq!(node_at(bad, 0), None, "{bad:?}");
    }
    assert!(matches!(
        patch_source(&deep, &empty, &empty),
        Err(SourceError::TooDeep { .. })
    ));
}

#[test]
fn a_model_that_does_not_match_the_source_is_still_written_right() {
    // Il modello di prima dice due schede, il sorgente ne ha una: l'array si
    // scrive per intero, e il testo di dopo si legge come il modello di dopo.
    let source = format!(r#"{{"nodes":[{A}]}}"#);
    let mut before = parse(&source).unwrap();
    before.nodes.push(text_node("b", 300, 0, 200, 100, "due"));
    let mut after = before.clone();
    after.nodes[1].x = 1;
    let written = patched(&source, &before, &after);
    assert_eq!(
        written,
        format!(
            r#"{{"nodes":[{A},{}]}}"#,
            B.replace(r#""x":300"#, r#""x":1"#)
        )
    );
}

/// Una lavagna di 2000 schede con una scheda cambiata: il testo di dopo
/// cambia solo quella. Con `--nocapture` stampa il tempo di `patch_source`.
#[test]
fn a_large_board_changes_one_card_only() {
    let cards: Vec<String> = (0..2000)
        .map(|i| {
            format!(
                r#"{{"id":"n{i:015}","type":"text","x":{},"y":{},"width":240,"height":120,"text":"scheda {i} con un po' di testo","fub:ink":{{"v":1}}}}"#,
                i * 10,
                i * 7
            )
        })
        .collect();
    let source = format!(
        "{{\n  \"nodes\": [\n    {}\n  ],\n  \"edges\": []\n}}\n",
        cards.join(",\n    ")
    );
    let before = parse(&source).unwrap();
    let mut after = before.clone();
    after.nodes[1000].x = -5;
    let started = Instant::now();
    let written = patch_source(&source, &before, &after).unwrap();
    eprintln!(
        "patch_source, 2000 schede, {} byte: {:?}",
        source.len(),
        started.elapsed()
    );
    assert_eq!(written, source.replace(r#""x":10000,"#, r#""x":-5,"#));
    assert_eq!(parse(&written).unwrap(), after);
}
