//! La lavagna come codice (`fub_canvas_core::describe`): l'outline, il codice e
//! il JSON, con i casi esatti e con il giro su tutti i vettori.
//!
//! Il giro è la prova che il codice ricrea la lavagna: per ogni lavagna che si
//! apre in `apps/client/src/__fixtures__/canvas-ops/` e in
//! `apps/client/src/__fixtures__/canvas-read/`, `compile(vuota, code(c), 1)`
//! dà schede e archi uguali a `c`, nello stesso ordine. La radice sconosciuta
//! non c'è nel codice (nessuna operazione la scrive), e il giro non la chiede.

use std::path::PathBuf;

use std::collections::HashSet;

use fub_canvas_core::describe::{code, json, outline, DescribeOptions};
use fub_canvas_core::ops::{compile, CanvasOp, OpError};
use fub_canvas_core::patch;
use fub_canvas_core::source::canvas_value;
use fub_canvas_core::{parse, Canvas};
use serde_json::{json as j, Value};

/// Quante lavagne almeno per cartella (oggi 33 si aprono in `canvas-read`, e
/// 38 vettori di `canvas-ops` hanno una lavagna prima e, se va, una dopo): meno
/// vuol dire che la cartella si è persa qualcosa.
const MIN_OPS_BOARDS: usize = 30;
const MIN_READ_BOARDS: usize = 30;

/// Le lavagne con un id uguale su una scheda e su un arco. Il formato le lascia
/// (`remove-ambiguous-id.json`), le operazioni no: un id è di una sola cosa.
/// Il codice le dà lo stesso, e `compile` dice `DuplicateId`. Chi aggiunge un
/// vettore così lo scrive qui.
const SHARED_ID_BOARDS: &[&str] = &["remove-ambiguous-id.json (prima)"];

fn board(source: &str) -> Canvas {
    parse(source).expect("una lavagna che si apre")
}

fn ids(list: &[&str]) -> DescribeOptions {
    DescribeOptions {
        ids: Some(list.iter().map(|id| (*id).to_owned()).collect()),
        max_chars: None,
    }
}

/// La lavagna del piano: tre schede e un arco.
const SMALL: &str = r##"{
  "nodes": [
    {"id":"t1","type":"text","x":0,"y":0,"width":320,"height":160,"text":"Ciclo dell'acqua","color":"5"},
    {"id":"t2","type":"text","x":368,"y":0,"width":320,"height":160,"text":"Evaporazione"},
    {"id":"f1","type":"file","file":"Scienze/nuvole.png","x":0,"y":184,"width":320,"height":360}
  ],
  "edges": [{"id":"e1","fromNode":"t1","toNode":"t2","toEnd":"arrow","label":"usa"}]
}"##;

const SMALL_OUTLINE: &str = "cards 3 edges 1 groups 0 bounds 0 0 688×544\n\
1 t1 text \"Ciclo dell'acqua\" 0 0 320×160 color=5\n\
2 t2 text \"Evaporazione\" 368 0 320×160\n\
3 f1 image \"Scienze/nuvole.png\" 0 184 320×360\n\
e1 t1 -> t2 \"usa\"";

#[test]
fn the_outline_reads_a_small_board_line_by_line() {
    assert_eq!(
        outline(&board(SMALL), &DescribeOptions::default()),
        SMALL_OUTLINE
    );
}

#[test]
fn an_empty_board_has_the_counts_and_no_bounds() {
    assert_eq!(
        outline(&board(""), &DescribeOptions::default()),
        "cards 0 edges 0 groups 0 bounds -"
    );
}

#[test]
fn a_text_with_quotes_and_line_breaks_stays_on_one_line() {
    let text = "Dice \"ciao\"\r\nriga due\tTab";
    let canvas = Canvas {
        nodes: vec![serde_json::from_value(j!({
            "id": "a", "type": "text", "x": 0, "y": 0, "width": 320, "height": 160,
            "text": text
        }))
        .unwrap()],
        ..Canvas::default()
    };
    let lines = outline(&canvas, &DescribeOptions::default());
    assert_eq!(
        lines,
        "cards 1 edges 0 groups 0 bounds 0 0 320×160\n\
         1 a text \"Dice \\\"ciao\\\"\\r\\nriga due\\tTab\" 0 0 320×160"
    );
    assert_eq!(lines.lines().count(), 2);
}

#[test]
fn a_text_of_sixty_characters_stays_and_a_longer_one_is_cut_with_an_ellipsis() {
    let text_of = |text: &str| {
        let canvas = Canvas {
            nodes: vec![serde_json::from_value(j!({
                "id": "a", "type": "text", "x": 0, "y": 0, "width": 320, "height": 160,
                "text": text
            }))
            .unwrap()],
            ..Canvas::default()
        };
        outline(&canvas, &DescribeOptions::default())
            .lines()
            .nth(1)
            .unwrap()
            .to_owned()
    };
    // Sessanta caratteri, anche se sono quattro byte l'uno: entrano.
    let exact = "😀".repeat(60);
    assert!(text_of(&exact).contains(&format!("\"{exact}\"")));
    // Sessantuno: cinquantanove caratteri e il `…`, in tutto sessanta.
    let longer = "😀".repeat(61);
    let cut = format!("\"{}…\"", "😀".repeat(59));
    assert!(text_of(&longer).contains(&cut), "{}", text_of(&longer));
}

#[test]
fn an_edge_shows_its_sides_colour_and_ends_only_when_they_differ() {
    let canvas = board(
        r##"{
          "nodes": [
            {"id":"a","type":"text","x":0,"y":0,"width":100,"height":60,"text":"a"},
            {"id":"b","type":"text","x":300,"y":0,"width":100,"height":60,"text":"b"}
          ],
          "edges": [
            {"id":"e1","fromNode":"a","toNode":"b"},
            {"id":"e2","fromNode":"a","toNode":"b","label":"x","color":"3",
             "fromSide":"right","toSide":"left","fromEnd":"arrow","toEnd":"none"},
            {"id":"e3","fromNode":"a","toNode":"b","toEnd":"arrow"},
            {"id":"e4","fromNode":"a","toNode":"b","color":"#ff8800"}
          ]
        }"##,
    );
    assert_eq!(
        outline(&canvas, &DescribeOptions::default()),
        "cards 2 edges 4 groups 0 bounds 0 0 400×60\n\
         1 a text \"a\" 0 0 100×60\n\
         2 b text \"b\" 300 0 100×60\n\
         e1 a -> b\n\
         e2 a -> b \"x\" color=3 fromSide=right toSide=left fromEnd=arrow toEnd=none\n\
         e3 a -> b\n\
         e4 a -> b color=#ff8800"
    );
}

#[test]
fn a_card_shows_the_smallest_group_that_holds_it() {
    let canvas = board(
        r##"{
          "nodes": [
            {"id":"g1","type":"group","x":0,"y":0,"width":1000,"height":1000,"label":"Tutto"},
            {"id":"g2","type":"group","x":0,"y":0,"width":500,"height":500,"label":"Dentro"},
            {"id":"c1","type":"text","x":40,"y":40,"width":100,"height":60,"text":"uno"},
            {"id":"c2","type":"text","x":600,"y":600,"width":100,"height":60,"text":"due"},
            {"id":"c3","type":"text","x":1200,"y":0,"width":100,"height":60,"text":"tre"}
          ]
        }"##,
    );
    assert_eq!(
        outline(&canvas, &DescribeOptions::default()),
        "cards 5 edges 0 groups 2 bounds 0 0 1300×1000\n\
         1 g1 group \"Tutto\" 0 0 1000×1000\n\
         2 g2 group \"Dentro\" 0 0 500×500 in=g1\n\
         3 c1 text \"uno\" 40 40 100×60 in=g2\n\
         4 c2 text \"due\" 600 600 100×60 in=g1\n\
         5 c3 text \"tre\" 1200 0 100×60"
    );
}

#[test]
fn each_file_card_has_the_kind_that_layout_gives_it() {
    let canvas = board(
        r##"{
          "nodes": [
            {"id":"n","type":"file","file":"Note/a.md","subpath":"#Titolo","x":0,"y":0,"width":10,"height":10},
            {"id":"d","type":"file","file":"b.docx","x":0,"y":0,"width":10,"height":10},
            {"id":"s","type":"file","file":"c.XLSX","x":0,"y":0,"width":10,"height":10},
            {"id":"p","type":"file","file":"d.pdf","x":0,"y":0,"width":10,"height":10},
            {"id":"i","type":"file","file":"e.PNG","x":0,"y":0,"width":10,"height":10},
            {"id":"f","type":"file","file":"cartella.v2/nota","x":0,"y":0,"width":10,"height":10},
            {"id":"w","type":"link","url":"https://example.org","x":0,"y":0,"width":10,"height":10}
          ]
        }"##,
    );
    let lines: Vec<String> = outline(&canvas, &DescribeOptions::default())
        .lines()
        .skip(1)
        .map(str::to_owned)
        .collect();
    let kinds: Vec<&str> = lines
        .iter()
        .map(|line| line.split(' ').nth(2).unwrap())
        .collect();
    assert_eq!(
        kinds,
        ["note", "document", "sheet", "pdf", "image", "file", "web"]
    );
    assert!(lines[0].contains("\"Note/a.md#Titolo\""), "{}", lines[0]);
    assert!(lines[6].contains("\"https://example.org\""), "{}", lines[6]);
}

#[test]
fn an_id_with_a_space_is_quoted_so_the_line_stays_readable() {
    let canvas = board(
        r##"{
          "nodes": [
            {"id":"uno due","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a"},
            {"id":"t2","type":"text","x":20,"y":0,"width":10,"height":10,"text":"b"}
          ],
          "edges": [{"id":"e 1","fromNode":"uno due","toNode":"t2"}]
        }"##,
    );
    let text = outline(&canvas, &DescribeOptions::default());
    assert!(
        text.contains("\n1 \"uno due\" text \"a\" 0 0 10×10\n"),
        "{text}"
    );
    assert!(text.ends_with("\n\"e 1\" \"uno due\" -> t2"), "{text}");
}

#[test]
fn a_long_outline_is_cut_to_whole_lines_with_the_rest_count() {
    let canvas = board(SMALL);
    let full = outline(&canvas, &DescribeOptions::default());
    let lines: Vec<&str> = full.lines().collect();
    assert_eq!(lines.len(), 5);
    let chars = |text: &str| text.chars().count();

    // Il limite che esatto entra due righe e il `…+3`.
    let fits = format!("{}\n{}\n…+3", lines[0], lines[1]);
    let at_limit = DescribeOptions {
        ids: None,
        max_chars: Some(chars(&fits)),
    };
    assert_eq!(outline(&canvas, &at_limit), fits);

    // Un carattere in meno: resta solo la prima riga.
    let one_less = DescribeOptions {
        ids: None,
        max_chars: Some(chars(&fits) - 1),
    };
    assert_eq!(outline(&canvas, &one_less), format!("{}\n…+4", lines[0]));

    // Il limite più piccolo della prima riga: la prima riga esce comunque.
    let tiny = DescribeOptions {
        ids: None,
        max_chars: Some(3),
    };
    assert_eq!(outline(&canvas, &tiny), format!("{}\n…+4", lines[0]));

    // Un limite che entra tutto non taglia nulla.
    let roomy = DescribeOptions {
        ids: None,
        max_chars: Some(10_000),
    };
    assert_eq!(outline(&canvas, &roomy), full);
}

#[test]
fn ids_keep_those_cards_and_the_edges_between_them() {
    let canvas = board(SMALL);
    assert_eq!(
        outline(&canvas, &ids(&["t2", "zzz", "f1"])),
        "cards 2 edges 0 groups 0 bounds 0 0 688×544\n\
         2 t2 text \"Evaporazione\" 368 0 320×160\n\
         3 f1 image \"Scienze/nuvole.png\" 0 184 320×360"
    );
    let both = outline(&canvas, &ids(&["t1", "t2"]));
    assert!(both.ends_with("\ne1 t1 -> t2 \"usa\""), "{both}");
    assert!(
        both.starts_with("cards 2 edges 1 groups 0 bounds 0 0 688×160\n"),
        "{both}"
    );
}

#[test]
fn ids_with_no_card_in_the_board_are_ignored_and_the_counts_say_so() {
    let canvas = board(SMALL);
    assert_eq!(
        outline(&canvas, &ids(&["nessuna"])),
        "cards 0 edges 0 groups 0 bounds -"
    );
}

#[test]
fn code_lists_the_cards_then_the_edges_in_short_form() {
    let ops = code(&board(SMALL), &DescribeOptions::default());
    let values: Vec<Value> = ops
        .iter()
        .map(|op| serde_json::to_value(op).unwrap())
        .collect();
    // Le misure di nascita non si scrivono; x e y sì; il colore è il nome.
    assert_eq!(
        values,
        [
            j!({"op": "add_card", "id": "t1", "text": "Ciclo dell'acqua", "x": 0, "y": 0,
                "color": "cyan"}),
            j!({"op": "add_card", "id": "t2", "text": "Evaporazione", "x": 368, "y": 0}),
            j!({"op": "add_card", "id": "f1", "file": "Scienze/nuvole.png", "x": 0, "y": 184,
                "width": 320}),
            j!({"op": "connect", "id": "e1", "from": "t1", "to": "t2", "label": "usa"}),
        ]
    );
}

#[test]
fn code_writes_the_whole_card_when_a_field_has_no_short_form() {
    let canvas = board(
        r##"{
          "nodes": [
            {"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a","xVendor":{"k":1}},
            {"id":"b","type":"text","x":0,"y":0,"width":320,"height":160,"text":"b","color":"#ABCDEF"},
            {"id":"g","type":"group","x":0,"y":0,"width":480,"height":320}
          ],
          "edges": [{"id":"e","fromNode":"a","toNode":"a","xEdge":[true]}]
        }"##,
    );
    let values: Vec<Value> = code(&canvas, &DescribeOptions::default())
        .iter()
        .map(|op| serde_json::to_value(op).unwrap())
        .collect();
    // Un campo sconosciuto, un colore maiuscolo e un gruppo senza etichetta
    // (la forma breve gli darebbe `""`) restano nella forma intera.
    assert_eq!(values[0]["node"]["xVendor"], j!({"k": 1}));
    assert_eq!(values[1]["node"]["color"], "#ABCDEF");
    assert_eq!(values[2]["node"]["type"], "group");
    assert_eq!(values[3]["edge"]["xEdge"], j!([true]));
}

#[test]
fn code_with_ids_is_the_cards_asked_and_their_edges() {
    let canvas = board(SMALL);
    let ops = code(&canvas, &ids(&["t1", "t2"]));
    assert_eq!(ops.len(), 3);
    assert!(matches!(ops[0], CanvasOp::AddCard(_)));
    assert!(matches!(ops[1], CanvasOp::AddCard(_)));
    assert!(matches!(ops[2], CanvasOp::Connect(_)));
    let only_f1 = code(&canvas, &ids(&["f1"]));
    assert_eq!(only_f1.len(), 1);
}

#[test]
fn the_board_recompiled_from_its_code_keeps_the_order_of_cards_and_edges() {
    // Gli id non sono in ordine alfabetico, e l'ordine degli archi non segue
    // quello delle schede: il giro li deve tenere com'erano.
    let canvas = board(
        r##"{
          "nodes": [
            {"id":"z","type":"text","x":0,"y":0,"width":10,"height":10,"text":"z"},
            {"id":"b","type":"text","x":20,"y":0,"width":10,"height":10,"text":"b"},
            {"id":"m","type":"text","x":40,"y":0,"width":10,"height":10,"text":"m"}
          ],
          "edges": [
            {"id":"e9","fromNode":"m","toNode":"z"},
            {"id":"e1","fromNode":"b","toNode":"m"}
          ]
        }"##,
    );
    assert_eq!(round_trip(&canvas), Ok(()));
}

#[test]
fn an_empty_board_has_no_operations_and_the_json_of_an_empty_file() {
    let empty = board("");
    assert!(code(&empty, &DescribeOptions::default()).is_empty());
    assert_eq!(
        json(&empty, &DescribeOptions::default()).unwrap(),
        j!({"nodes": [], "edges": []})
    );
}

#[test]
fn json_is_the_model_as_the_file_writes_it_and_ids_leave_out_the_root() {
    let canvas = board(
        r##"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a"},
                     {"id":"b","type":"text","x":20,"y":0,"width":10,"height":10,"text":"b"}],
            "edges":[],"meta":[1,2]}"##,
    );
    let whole = json(&canvas, &DescribeOptions::default()).unwrap();
    assert_eq!(whole, canvas_value(&canvas).unwrap());
    assert_eq!(whole["meta"], j!([1, 2]));

    let part = json(&canvas, &ids(&["b"])).unwrap();
    assert_eq!(part["nodes"].as_array().unwrap().len(), 1);
    assert_eq!(part["nodes"][0]["id"], "b");
    assert!(part.get("meta").is_none());
}

/// Una lavagna con il nome del vettore che l'ha data.
type Boards = Vec<(String, Canvas)>;

/// Le lavagne dei vettori che si aprono, `(nome, lavagna)`: quelle di
/// `canvas-ops` (la prima, e la seconda quando l'operazione va) e quelle di
/// `canvas-read`.
fn opened_boards() -> (Boards, Boards) {
    let mut ops_boards = Vec::new();
    for (name, vector) in vectors("canvas-ops") {
        let before: Result<Canvas, _> = serde_json::from_value(vector["before"].clone());
        if let Some(before) = before.ok().filter(|canvas| canvas.validate().is_ok()) {
            ops_boards.push((format!("{name} (prima)"), before));
        }
        if vector.pointer("/expect/outcome").and_then(Value::as_str) == Some("applied") {
            let after: Canvas = serde_json::from_value(vector["expect"]["after"].clone())
                .unwrap_or_else(|e| panic!("{name}: `after` non si legge: {e}"));
            after
                .validate()
                .unwrap_or_else(|e| panic!("{name}: `after` non passa: {e}"));
            ops_boards.push((format!("{name} (dopo)"), after));
        }
    }

    let mut read_boards = Vec::new();
    for (name, vector) in vectors("canvas-read") {
        let source = vector["source"].as_str().expect("un sorgente");
        if let Ok(canvas) = parse(source) {
            read_boards.push((name, canvas));
        }
    }
    (ops_boards, read_boards)
}

/// I vettori di una cartella di `apps/client/src/__fixtures__/`, in ordine di nome.
fn vectors(folder: &str) -> Vec<(String, Value)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__")
        .join(folder);
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|entry| entry.expect("una voce della cartella").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (name, value)
        })
        .collect()
}

/// Compila il codice di `canvas` su una lavagna vuota e confronta schede e archi
/// con quelli di `canvas`, nell'ordine. La radice sconosciuta non si confronta.
fn round_trip(canvas: &Canvas) -> Result<(), String> {
    let ops = code(canvas, &DescribeOptions::default());
    let compiled = compile(&Canvas::default(), &ops, 1)
        .map_err(|error| format!("il codice non si compila: {error}"))?;
    let mut board = Canvas::default();
    patch::apply(&mut board, &compiled.patches)
        .map_err(|error| format!("le toppe non si applicano: {error:?}"))?;
    let seen = canvas_value(&board).map_err(|error| format!("{error:?}"))?;
    let expected = canvas_value(canvas).map_err(|error| format!("{error:?}"))?;
    if seen["nodes"] != expected["nodes"] || seen["edges"] != expected["edges"] {
        return Err(format!(
            "schede o archi diversi\n  dato:   {seen}\n  atteso: {expected}"
        ));
    }
    Ok(())
}

/// Un id uguale su una scheda e su un arco: il caso che le operazioni non
/// scrivono (vedi [`SHARED_ID_BOARDS`]).
fn shares_an_id(canvas: &Canvas) -> bool {
    let nodes: HashSet<&str> = canvas.nodes.iter().map(|node| node.id.as_str()).collect();
    canvas
        .edges
        .iter()
        .any(|edge| nodes.contains(edge.id.as_str()))
}

#[test]
fn the_code_of_every_vector_recompiles_to_the_same_board() {
    let (ops_boards, read_boards) = opened_boards();
    assert!(
        ops_boards.len() >= MIN_OPS_BOARDS,
        "{} lavagne da canvas-ops",
        ops_boards.len()
    );
    assert!(
        read_boards.len() >= MIN_READ_BOARDS,
        "{} lavagne da canvas-read",
        read_boards.len()
    );

    let mut failures = Vec::new();
    let mut shared = Vec::new();
    for (name, canvas) in ops_boards.iter().chain(&read_boards) {
        if shares_an_id(canvas) {
            shared.push(name.clone());
            match compile(
                &Canvas::default(),
                &code(canvas, &DescribeOptions::default()),
                1,
            ) {
                Err(OpError::DuplicateId { .. }) => {}
                other => failures.push(format!("{name}: atteso DuplicateId, dato {other:?}")),
            }
            continue;
        }
        if let Err(error) = round_trip(canvas) {
            failures.push(format!("{name}: {error}"));
        }
    }
    assert_eq!(
        shared, SHARED_ID_BOARDS,
        "le lavagne con un id condiviso sono cambiate"
    );
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
