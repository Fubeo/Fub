//! La lavagna come codice (`fub_canvas_core::describe`): l'outline, il codice e
//! il JSON, con i casi esatti e con il giro su tutti i vettori.
//!
//! Il giro è la prova che il codice ricrea la lavagna: per ogni lavagna che si
//! apre in `apps/client/src/__fixtures__/canvas-ops/` e in
//! `apps/client/src/__fixtures__/canvas-read/`, `compile(vuota, code(c), 1)`
//! dà schede e archi uguali a `c`, nello stesso ordine. La radice sconosciuta
//! non c'è nel codice (nessuna operazione la scrive), e il giro non la chiede.
//! L'inchiostro sì: il giro passa anche per i vettori di
//! `apps/client/src/__fixtures__/canvas-ink/`, e chiede uguale anche il livello
//! libero quando il codice lo porta.

use std::path::PathBuf;

use std::collections::HashSet;

use fub_canvas_core::describe::{code, ink_read, json, outline, DescribeOptions};
use fub_canvas_core::ink::LayerRef;
use fub_canvas_core::ink::INK_KEY;
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
/// Quante lavagne almeno da `canvas-ink` (oggi 28, e si aprono tutte).
const MIN_INK_BOARDS: usize = 28;

/// Le lavagne il cui inchiostro libero il codice non porta: un livello della
/// radice estraneo, con un tratto che non si disegna, con campi in più o vuoto.
/// Come la radice sconosciuta, nessuna operazione lo scrive: lo dà `json`. Chi
/// aggiunge un vettore così lo scrive qui.
const BOARD_INK_NOT_IN_CODE: &[&str] = &[
    "erase-strokes-not-drawn.json (prima)",
    "move-with-ink.json (prima)",
    "move-with-ink.json (dopo)",
    "card-on-board.json",
    "color-three-digits.json",
    "layer-not-object.json",
    "reason-brush.json",
    "reason-color.json",
    "reason-ink.json",
    "reason-order.json",
    "two-foreign-layers.json",
];

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
fn opened_boards() -> (Boards, Boards, Boards) {
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
    let mut ink_boards = Vec::new();
    for (name, vector) in vectors("canvas-ink") {
        let source = vector["source"].as_str().expect("un sorgente");
        if let Ok(canvas) = parse(source) {
            ink_boards.push((name, canvas));
        }
    }
    (ops_boards, read_boards, ink_boards)
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
/// con quelli di `canvas`, nell'ordine, e il livello libero se il codice lo
/// porta. Il resto della radice sconosciuta non si confronta. Si confronta il
/// testo JSON, non i valori: con `preserve_order` l'uguaglianza di due oggetti
/// ignora l'ordine delle chiavi, e il giro lo deve tenere.
fn round_trip(canvas: &Canvas) -> Result<(), String> {
    let ops = code(canvas, &DescribeOptions::default());
    let board_ink = carries_board_ink(&ops);
    let compiled = compile(&Canvas::default(), &ops, 1)
        .map_err(|error| format!("il codice non si compila: {error}"))?;
    let mut board = Canvas::default();
    patch::apply(&mut board, &compiled.patches)
        .map_err(|error| format!("le toppe non si applicano: {error:?}"))?;
    let seen = canvas_value(&board).map_err(|error| format!("{error:?}"))?;
    let expected = canvas_value(canvas).map_err(|error| format!("{error:?}"))?;
    if written(&seen["nodes"]) != written(&expected["nodes"])
        || written(&seen["edges"]) != written(&expected["edges"])
    {
        return Err(format!(
            "schede o archi diversi\n  dato:   {seen}\n  atteso: {expected}"
        ));
    }
    let text = |value: &Value| value.get(INK_KEY).map(Value::to_string);
    if board_ink && text(&seen) != text(&expected) {
        return Err(format!(
            "inchiostro libero diverso\n  dato:   {seen}\n  atteso: {expected}"
        ));
    }
    Ok(())
}

/// Il valore scritto come testo JSON: due testi uguali hanno anche le chiavi
/// nello stesso ordine, due `Value` uguali no.
fn written(value: &Value) -> String {
    value.to_string()
}

/// Il codice porta l'inchiostro libero: una `add_strokes` sulla radice.
fn carries_board_ink(ops: &[CanvasOp]) -> bool {
    ops.iter().any(|op| {
        matches!(
            op,
            CanvasOp::AddStrokes {
                layer: LayerRef::Board,
                ..
            }
        )
    })
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
    let (ops_boards, read_boards, ink_boards) = opened_boards();
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
    assert!(
        ink_boards.len() >= MIN_INK_BOARDS,
        "{} lavagne da canvas-ink",
        ink_boards.len()
    );

    let mut failures = Vec::new();
    let mut shared = Vec::new();
    let mut board_ink_left = Vec::new();
    for (name, canvas) in ops_boards.iter().chain(&read_boards).chain(&ink_boards) {
        if canvas.extra.contains_key(INK_KEY)
            && !carries_board_ink(&code(canvas, &DescribeOptions::default()))
        {
            board_ink_left.push(name.clone());
        }
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
    assert_eq!(
        board_ink_left, BOARD_INK_NOT_IN_CODE,
        "le lavagne con un inchiostro libero che il codice non porta sono cambiate"
    );
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

/// Il pennello di serie dei vettori dell'inchiostro, con la penna.
const BALLPOINT: &str = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";

/// La lavagna di un vettore di `canvas-ink`.
fn ink_vector(name: &str) -> Canvas {
    let (_, vector) = vectors("canvas-ink")
        .into_iter()
        .find(|(file, _)| file == name)
        .unwrap_or_else(|| panic!("manca il vettore {name}"));
    board(vector["source"].as_str().expect("un sorgente"))
}

fn values_of(ops: &[CanvasOp]) -> Vec<Value> {
    ops.iter()
        .map(|op| serde_json::to_value(op).unwrap())
        .collect()
}

#[test]
fn the_outline_gives_each_ink_layer_its_strokes_and_their_box() {
    // La scheda `f1` ha un tratto da 120,5 30,2 a 121,06 30,12; quello libero va
    // da 40 25 a 42,15 25,3. La riga libera viene subito dopo i conti.
    assert_eq!(
        outline(
            &ink_vector("board-and-card.json"),
            &DescribeOptions::default()
        ),
        "cards 2 edges 0 groups 0 bounds 0 0 980×420\n\
         ink board 1 40 25 2.2×0.4\n\
         1 f1 sheet \"Corsi/Statistica/voti.xlsx\" 0 0 640×420 ink=1 120.5 30.1 0.6×0.1\n\
         2 n2 text \"Perché la media è così bassa?\" 700 40 280×90"
    );
}

#[test]
fn a_stroke_that_is_not_drawn_is_counted_and_left_out_of_the_box() {
    // Un'ancora `free` su una scheda è fuori posto: il tratto si conta, non si
    // disegna, e il riquadro è quello dell'altro.
    let lines = outline(
        &ink_vector("free-on-card.json"),
        &DescribeOptions::default(),
    );
    assert_eq!(
        lines.lines().nth(1),
        Some("1 n1 text \"x\" 0 0 300×200 ink=2 bad=1 120.5 30.1 0.6×0.1")
    );
    // Nessun tratto che si disegna: il riquadro è `-`.
    let lines = outline(
        &ink_vector("reason-order.json"),
        &DescribeOptions::default(),
    );
    assert_eq!(lines.lines().nth(1), Some("ink board 4 bad=4 -"));
}

#[test]
fn a_foreign_layer_is_named_and_not_read() {
    let lines = outline(
        &ink_vector("layer-version-two.json"),
        &DescribeOptions::default(),
    );
    assert_eq!(
        lines.lines().nth(1),
        Some("1 n1 text \"x\" 0 0 300×200 ink=foreign")
    );
    let lines = outline(
        &ink_vector("two-foreign-layers.json"),
        &DescribeOptions::default(),
    );
    assert!(lines.contains("ink=foreign"), "{lines}");
}

#[test]
fn ids_leave_out_the_free_ink() {
    let canvas = ink_vector("board-and-card.json");
    let lines = outline(&canvas, &ids(&["f1"]));
    assert!(!lines.contains("ink board"), "{lines}");
    assert!(lines.contains("ink=1"), "{lines}");
    assert!(!carries_board_ink(&code(&canvas, &ids(&["f1"]))));
    let read = ink_read(&canvas, &ids(&["f1"]));
    assert_eq!(read.as_array().unwrap().len(), 1);
    assert_eq!(read[0]["layer"], j!({"node": "f1"}));
}

#[test]
fn the_ink_of_an_image_follows_the_card_as_it_is_now() {
    // Scritto sulla scheda a 100 × 100, la scheda ora è 200 × 100: un'immagine
    // scala di min(2, 1) = 1 e si centra, quindi tutto va 50 a destra. Una
    // scheda di nota della stessa misura resta com'era.
    let source = |file: &str| {
        j!({"nodes": [{"id": "a", "type": "file", "file": file, "x": 0, "y": 0,
            "width": 200, "height": 100,
            INK_KEY: {"v": 1, "strokes": [{"id": "s1", "tool": "pen", "brush": BALLPOINT,
                "color": "#0072b2", "anchor": {"kind": "card", "width": 100, "height": 100},
                "ink": "1 s10 cxy 100,200 100,0"}]}}],
            "edges": []})
        .to_string()
    };
    let image = board(&source("foto.PNG"));
    let lines = outline(&image, &DescribeOptions::default());
    assert!(lines.ends_with("ink=1 60 20 10×0"), "{lines}");
    let read = ink_read(&image, &DescribeOptions::default());
    let stroke = &read[0]["strokes"][0];
    assert_eq!(stroke["points"], j!([[60, 20], [70, 20]]));
    assert_eq!(stroke["size"], 3);

    let note = board(&source("nota.md"));
    let lines = outline(&note, &DescribeOptions::default());
    assert!(lines.ends_with("ink=1 10 20 10×0"), "{lines}");
}

#[test]
fn code_writes_the_strokes_with_add_strokes_and_their_exact_strings() {
    let canvas = ink_vector("board-and-card.json");
    let values = values_of(&code(&canvas, &DescribeOptions::default()));
    assert_eq!(values.len(), 4);
    // La scheda torna alla forma breve: il livello non è più un campo
    // sconosciuto, ma la `add_strokes` che la segue.
    assert_eq!(values[0]["op"], "add_card");
    assert_eq!(values[0]["file"], "Corsi/Statistica/voti.xlsx");
    assert!(values[0].get("node").is_none());
    assert_eq!(
        values[1],
        j!({"op": "add_strokes", "layer": {"node": "f1"}, "strokes": [{
            "id": "s-mh0k2q1x-4f9a-1", "tool": "pen", "at": "2026-11-02T09:20:31.250Z",
            "brush": BALLPOINT, "color": "#0072b2",
            "anchor": {"kind": "card", "width": 640, "height": 420},
            "ink": "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8"}]})
    );
    assert_eq!(values[2]["op"], "add_card");
    assert_eq!(values[3]["op"], "add_strokes");
    assert_eq!(values[3]["layer"], "board");
    assert_eq!(
        values[3]["strokes"][0]["ink"],
        "1 s100 cxy 4000,2500 120,40 95,-10"
    );
    assert_eq!(round_trip(&canvas), Ok(()));
}

#[test]
fn code_keeps_a_layer_that_add_strokes_cannot_write_inside_the_card() {
    // Un tratto che non si disegna, un livello estraneo, un livello con `v`
    // scritto `1.0`: la scheda va intera, col livello com'è nel file.
    for name in [
        "free-on-card.json",
        "layer-version-two.json",
        "numbers-by-value.json",
    ] {
        let canvas = ink_vector(name);
        let values = values_of(&code(&canvas, &DescribeOptions::default()));
        assert!(
            values
                .iter()
                .all(|value| value["op"] != "add_strokes" || value["layer"] == "board"),
            "{name}: {values:?}"
        );
        let expected = canvas_value(&canvas).unwrap();
        assert_eq!(
            values[0]["node"][INK_KEY], expected["nodes"][0][INK_KEY],
            "{name}"
        );
        assert_eq!(round_trip(&canvas), Ok(()), "{name}");
    }
}

#[test]
fn ink_read_gives_the_strokes_decoded_and_the_reason_of_those_not_drawn() {
    let read = ink_read(
        &ink_vector("board-and-card.json"),
        &DescribeOptions::default(),
    );
    assert_eq!(
        read[0],
        j!({"layer": {"node": "f1"}, "state": "ok", "strokes": [{
            "id": "s-mh0k2q1x-4f9a-1", "color": "#0072b2", "size": 3, "tool": "pen",
            "pen": "ballpoint",
            "bounds": {"x": 120.5, "y": 30.1, "width": 0.6, "height": 0.1},
            "points": [[120.5, 30.2], [120.8, 30.2], [121.1, 30.1]]}]})
    );
    assert_eq!(read[1]["layer"], "board");
    assert_eq!(
        read[1]["strokes"][0]["points"],
        j!([[40, 25], [41.2, 25.4], [42.2, 25.3]])
    );

    // Un tratto che non si disegna dice solo l'id e la ragione: un suo campo
    // sconosciuto `bad` non si confonde con la ragione, perché resta nel modello.
    let read = ink_read(
        &ink_vector("free-on-card.json"),
        &DescribeOptions::default(),
    );
    assert_eq!(read[0]["strokes"][0], j!({"id": "s-1", "bad": "anchor"}));
    assert!(read[0]["strokes"][1].get("points").is_some());

    // Un livello estraneo non elenca tratti.
    let read = ink_read(
        &ink_vector("layer-version-two.json"),
        &DescribeOptions::default(),
    );
    assert_eq!(
        read,
        j!([{"layer": {"node": "n1"}, "state": "foreign", "strokes": []}])
    );
    // Una lavagna senza inchiostro ha una lettura vuota.
    assert_eq!(ink_read(&board(SMALL), &DescribeOptions::default()), j!([]));
}

#[test]
fn json_keeps_the_ink_as_the_file_writes_it() {
    for name in [
        "board-and-card.json",
        "free-on-card.json",
        "layer-version-two.json",
    ] {
        let canvas = ink_vector(name);
        assert_eq!(
            json(&canvas, &DescribeOptions::default())
                .unwrap()
                .to_string(),
            canvas_value(&canvas).unwrap().to_string(),
            "{name}"
        );
    }
}

#[test]
fn a_card_read_as_json_and_sent_back_with_set_keeps_its_ink() {
    // Un modello legge la lavagna, cambia il testo di una scheda e la rimanda
    // intera con `set`: l'inchiostro resta quello del file, byte per byte.
    let canvas = ink_vector("board-and-card.json");
    let model = json(&canvas, &DescribeOptions::default()).unwrap();
    let mut fields = model["nodes"][0].as_object().unwrap().clone();
    fields.remove("id");
    fields.remove("type");
    fields.insert("x".to_owned(), j!(40));
    let ops: Vec<CanvasOp> =
        serde_json::from_value(j!([{"op": "set", "id": "f1", "fields": fields}])).unwrap();
    let compiled = compile(&canvas, &ops, 1).expect("set va");
    let mut after = canvas.clone();
    patch::apply(&mut after, &compiled.patches).unwrap();
    let before = canvas_value(&canvas).unwrap();
    let after = canvas_value(&after).unwrap();
    assert_eq!(after["nodes"][0]["x"], 40);
    assert_eq!(
        after["nodes"][0][INK_KEY].to_string(),
        before["nodes"][0][INK_KEY].to_string()
    );
}

#[test]
fn code_keeps_inside_the_card_a_layer_that_is_not_its_last_field() {
    // `add_strokes` rimetterebbe il livello in fondo: con un campo dopo, il
    // livello resta nella scheda intera, e il giro tiene l'ordine.
    let canvas = board(
        &j!({"nodes": [{"id": "a", "type": "text", "text": "a", "x": 0, "y": 0,
            "width": 320, "height": 160,
            INK_KEY: {"v": 1, "strokes": [{"id": "s1", "tool": "pen", "brush": BALLPOINT,
                "color": "#0072b2", "anchor": {"kind": "card", "width": 320, "height": 160},
                "ink": "1 s10 cxy 100,200 100,0"}]},
            "fub:tag": "x"}], "edges": []})
        .to_string(),
    );
    let values = values_of(&code(&canvas, &DescribeOptions::default()));
    assert_eq!(values.len(), 1);
    assert!(values[0]["node"].get(INK_KEY).is_some());
    assert_eq!(round_trip(&canvas), Ok(()));

    // Un tratto coi campi in un altro ordine da quello di Fub: lo stesso.
    let canvas = board(
        &j!({"nodes": [{"id": "a", "type": "text", "text": "a", "x": 0, "y": 0,
            "width": 320, "height": 160,
            INK_KEY: {"v": 1, "strokes": [{"tool": "pen", "id": "s1", "brush": BALLPOINT,
                "color": "#0072b2", "anchor": {"kind": "card", "width": 320, "height": 160},
                "ink": "1 s10 cxy 100,200 100,0"}]}}], "edges": []})
        .to_string(),
    );
    let values = values_of(&code(&canvas, &DescribeOptions::default()));
    assert_eq!(values.len(), 1);
    assert_eq!(round_trip(&canvas), Ok(()));
}

#[test]
fn ink_read_cuts_a_hundred_thousand_samples_to_max_chars() {
    // Undici tratti liberi da 10 000 campioni: 110 000 in tutto.
    let deltas = vec!["1,1"; 9_999].join(" ");
    let strokes: Vec<Value> = (0..11)
        .map(|i| {
            j!({"id": format!("s{i}"), "tool": "pen", "brush": BALLPOINT, "color": "#0072b2",
                "anchor": {"kind": "free"}, "ink": format!("1 s10 cxy 0,{} {deltas}", i * 10)})
        })
        .collect();
    let canvas =
        board(&j!({"nodes": [], "edges": [], INK_KEY: {"v": 1, "strokes": strokes}}).to_string());
    let points = |stroke: &Value| stroke["points"].as_array().unwrap().len();
    let read_with = |max_chars| {
        ink_read(
            &canvas,
            &DescribeOptions {
                ids: None,
                max_chars,
            },
        )
    };

    let whole = read_with(None);
    let total: usize = whole[0]["strokes"]
        .as_array()
        .unwrap()
        .iter()
        .map(points)
        .sum();
    assert_eq!(total, 110_000);

    let limit = 20_000;
    let cut = read_with(Some(limit));
    assert!(cut.to_string().chars().count() <= limit);
    let strokes = cut[0]["strokes"].as_array().unwrap();
    assert_eq!(strokes.len(), 11, "i tratti restano tutti");
    let shown: usize = strokes.iter().map(points).sum();
    let omitted: u64 = strokes
        .iter()
        .map(|stroke| stroke["points_omitted"].as_u64().unwrap_or(0))
        .sum();
    assert!(shown > 1_000, "{shown}");
    assert_eq!(shown as u64 + omitted, 110_000);
    // Il riquadro resta quello di tutti i punti.
    assert_eq!(
        strokes[0]["bounds"],
        j!({"x": 0, "y": 0, "width": 999.9, "height": 999.9})
    );
    // Si taglia dalla fine: i punti mostrati sono i primi, nell'ordine.
    assert_eq!(strokes[0]["points"][1], j!([0.1, 0.1]));
    assert_eq!(points(&strokes[10]), 0);

    // Un limite più piccolo della lettura senza punti: i tratti escono senza.
    let tiny = read_with(Some(10));
    assert!(tiny[0]["strokes"]
        .as_array()
        .unwrap()
        .iter()
        .all(|stroke| points(stroke) == 0 && stroke["points_omitted"] == 10_000));
}
