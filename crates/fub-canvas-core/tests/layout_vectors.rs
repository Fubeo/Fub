//! I vettori delle misure e dei posti, scritti a mano
//! (`apps/client/src/__fixtures__/canvas-layout.json`): un array di casi
//! `{about, fn, args, expect}`. Ogni caso chiama una funzione pubblica di
//! `fub_canvas_core::layout` con `args` e confronta il risultato con `expect`.
//! I valori attesi si calcolano dalle regole, a mano, non dall'uscita del
//! codice: chi cambia una regola deve cambiare il vettore, e il test lo dice.
//!
//! Il formato dei valori (JSON non ha quello che serve, quindi):
//! - un numero è un numero JSON, o la stringa `"NaN"`, `"Infinity"`,
//!   `"-Infinity"`;
//! - un testo è una stringa, `null` (assente), oppure `{join, item, count}`:
//!   `item` ripetuto `count` volte e separato da `join`;
//! - una lavagna è `{nodes, stack}`: `nodes` sono le sue schede, e `stack`
//!   (`{count, x, y, width, height, gap}`) aggiunge `count` testi vuoti
//!   impilati, `s0`, `s1`…, a `y + i·(height + gap)`;
//! - una misura del contenuto è `null` o `[larghezza, altezza]`;
//! - un rettangolo è `{x, y, width, height}`, e `expect: null` vuol dire `None`;
//! - `align` e `distribute` ricevono rettangoli e un lato (`left`, `center`,
//!   `right`, `top`, `middle`, `bottom`) o un asse (`horizontal`, `vertical`);
//! - `grid`, `row` e `column` ricevono le misure `[[larghezza, altezza], …]`, il
//!   `gap` e l'origine `[x, y]`; `tree` riceve le misure, gli archi `[[da, a], …]`
//!   come indici, un verso (`down`, `up`, `right`, `left`) e il `gap`;
//! - le posizioni attese sono `[[x, y], …]`, una per scheda, nell'ordine dato.

use std::collections::BTreeMap;
use std::path::PathBuf;

use fub_canvas_core::layout::arrange::{
    align, column, distribute, grid, row, tree, Align, Axis, Direction,
};
use fub_canvas_core::layout::{
    auto_place, born_size, card_kind, estimate_text_height, group_rect, inside, nearest_sides,
    place_near, snap, CardKind, Rect,
};
use fub_canvas_core::{parse, Canvas, CanvasEdgeSide, CanvasNode};
use serde_json::{json, Value};

/// Quanti casi almeno: meno vuol dire che il file si è perso qualcosa.
const MIN_CASES: usize = 120;

/// Quanti casi almeno per ogni funzione: una regola senza vettori non è provata.
const MIN_PER_FN: [(&str, usize); 15] = [
    ("snap", 9),
    ("card_kind", 21),
    ("born_size", 36),
    ("estimate_text_height", 9),
    ("auto_place", 9),
    ("place_near", 26),
    ("inside", 8),
    ("nearest_sides", 9),
    ("group_rect", 6),
    ("align", 12),
    ("distribute", 8),
    ("grid", 5),
    ("row", 1),
    ("column", 1),
    ("tree", 12),
];

/// Le specie con il loro nome nel file. `Craft` c'è, anche se `card_kind` non la
/// produce ancora: la sua misura di nascita va provata.
const KINDS: [(&str, CardKind); 10] = [
    ("text", CardKind::Text),
    ("note", CardKind::Note),
    ("document", CardKind::Document),
    ("sheet", CardKind::Sheet),
    ("pdf", CardKind::Pdf),
    ("image", CardKind::Image),
    ("web", CardKind::Web),
    ("craft", CardKind::Craft),
    ("file", CardKind::File),
    ("group", CardKind::Group),
];

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/canvas-layout.json")
}

/// I casi del file. Un file che non si legge, o che non è un array, fa fallire.
fn cases() -> Vec<Value> {
    let path = fixture();
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    match serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display())) {
        Value::Array(list) => list,
        _ => panic!("{}: serve un array di casi", path.display()),
    }
}

/// Un numero: un numero JSON, o una delle tre stringhe per i non finiti.
fn num(value: &Value) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().expect("un numero JSON è un f64"),
        Value::String(text) => match text.as_str() {
            "NaN" => f64::NAN,
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            other => panic!("numero atteso, letto {other:?}"),
        },
        other => panic!("numero atteso, letto {other}"),
    }
}

fn opt_num(value: &Value) -> Option<f64> {
    (!value.is_null()).then(|| num(value))
}

/// Un testo: stringa, `null`, o la forma `{join, item, count}`.
fn text_arg(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        Value::Object(spec) => {
            let item = spec["item"].as_str().expect("`item` è una stringa");
            let join = spec["join"].as_str().expect("`join` è una stringa");
            let count = spec["count"].as_u64().expect("`count` è un intero") as usize;
            Some(vec![item; count].join(join))
        }
        other => panic!("testo atteso, letto {other}"),
    }
}

/// Una misura del contenuto: `null`, o `[larghezza, altezza]`.
fn content_arg(value: &Value) -> Option<(f64, f64)> {
    match value {
        Value::Null => None,
        Value::Array(pair) => {
            assert_eq!(pair.len(), 2, "una misura è [larghezza, altezza]");
            Some((num(&pair[0]), num(&pair[1])))
        }
        other => panic!("misura attesa, letta {other}"),
    }
}

/// Un rettangolo, o `None` per `null`.
fn rect_arg(value: &Value) -> Option<Rect> {
    (!value.is_null()).then(|| Rect {
        x: num(&value["x"]),
        y: num(&value["y"]),
        width: num(&value["width"]),
        height: num(&value["height"]),
    })
}

/// Un elenco di rettangoli, come `align` e `distribute` lo ricevono.
fn rects_arg(value: &Value) -> Vec<Rect> {
    value
        .as_array()
        .expect("un elenco di rettangoli")
        .iter()
        .map(|rect| rect_arg(rect).expect("una scheda non è null"))
        .collect()
}

/// Una coppia `[a, b]`: una misura o una posizione.
fn pair_arg(value: &Value) -> (f64, f64) {
    let pair = value
        .as_array()
        .unwrap_or_else(|| panic!("attesa una coppia, letto {value}"));
    assert_eq!(pair.len(), 2, "una coppia è [a, b]");
    (num(&pair[0]), num(&pair[1]))
}

fn sizes_arg(value: &Value) -> Vec<(f64, f64)> {
    value
        .as_array()
        .expect("un elenco di misure")
        .iter()
        .map(pair_arg)
        .collect()
}

fn edges_arg(value: &Value) -> Vec<(usize, usize)> {
    value
        .as_array()
        .expect("un elenco di archi")
        .iter()
        .map(|edge| {
            let pair = edge.as_array().expect("un arco è [da, a]");
            assert_eq!(pair.len(), 2, "un arco è [da, a]");
            let index = |value: &Value| value.as_u64().expect("un indice") as usize;
            (index(&pair[0]), index(&pair[1]))
        })
        .collect()
}

fn align_arg(value: &Value) -> Align {
    match value.as_str() {
        Some("left") => Align::Left,
        Some("center") => Align::Center,
        Some("right") => Align::Right,
        Some("top") => Align::Top,
        Some("middle") => Align::Middle,
        Some("bottom") => Align::Bottom,
        _ => panic!("lato sconosciuto {value}"),
    }
}

fn axis_arg(value: &Value) -> Axis {
    match value.as_str() {
        Some("horizontal") => Axis::Horizontal,
        Some("vertical") => Axis::Vertical,
        _ => panic!("asse sconosciuto {value}"),
    }
}

fn direction_arg(value: &Value) -> Direction {
    match value.as_str() {
        Some("down") => Direction::Down,
        Some("up") => Direction::Up,
        Some("right") => Direction::Right,
        Some("left") => Direction::Left,
        _ => panic!("verso sconosciuto {value}"),
    }
}

/// Le posizioni attese, una coppia per scheda, nell'ordine dato.
fn assert_positions(name: &str, actual: &[(f64, f64)], expect: &Value) {
    let expected = expect
        .as_array()
        .unwrap_or_else(|| panic!("{name}: attesa una lista di coppie"));
    assert_eq!(actual.len(), expected.len(), "{name}: numero di schede");
    for (index, (position, want)) in actual.iter().zip(expected).enumerate() {
        assert_eq!(*position, pair_arg(want), "{name}: scheda {index}");
    }
}

fn node_arg(value: &Value) -> CanvasNode {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("scheda {value}: {e}"))
}

/// Una lavagna: le schede e lo `stack`, letta e validata come un file.
fn canvas_arg(value: &Value) -> Canvas {
    let mut nodes: Vec<Value> = value
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(stack) = value.get("stack") {
        let count = stack["count"].as_u64().expect("`stack.count` è un intero");
        let x = stack["x"].as_i64().expect("`stack.x` è un intero");
        let y = stack["y"].as_i64().expect("`stack.y` è un intero");
        let width = stack["width"].as_i64().expect("`stack.width` è un intero");
        let height = stack["height"]
            .as_i64()
            .expect("`stack.height` è un intero");
        let gap = stack["gap"].as_i64().expect("`stack.gap` è un intero");
        for index in 0..count {
            nodes.push(json!({
                "id": format!("s{index}"),
                "type": "text",
                "x": x,
                "y": y + index as i64 * (height + gap),
                "width": width,
                "height": height,
                "text": "",
            }));
        }
    }
    let text = json!({ "nodes": nodes }).to_string();
    parse(&text).unwrap_or_else(|e| panic!("lavagna del caso non valida: {e}"))
}

fn kind_arg(value: &Value) -> CardKind {
    let name = value.as_str().expect("una specie è una stringa");
    KINDS
        .iter()
        .find(|(known, _)| *known == name)
        .map(|(_, kind)| *kind)
        .unwrap_or_else(|| panic!("specie sconosciuta {name:?}"))
}

fn kind_name(kind: CardKind) -> &'static str {
    KINDS
        .iter()
        .find(|(_, known)| *known == kind)
        .map(|(name, _)| *name)
        .expect("ogni specie ha il suo nome")
}

fn side_arg(value: &Value) -> CanvasEdgeSide {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("lato {value}: {e}"))
}

/// Il confronto di un numero con il valore atteso (un numero JSON).
fn assert_num(name: &str, actual: f64, expect: &Value) {
    assert_eq!(actual, num(expect), "{name}");
}

/// Una coppia `[x, y]` o `[larghezza, altezza]`.
fn assert_pair(name: &str, actual: (f64, f64), expect: &Value) {
    let pair = expect
        .as_array()
        .unwrap_or_else(|| panic!("{name}: attesa una coppia, letto {expect}"));
    assert_eq!(pair.len(), 2, "{name}: una coppia");
    assert_eq!(actual, (num(&pair[0]), num(&pair[1])), "{name}");
}

/// Un rettangolo, o nessuno per `null`.
fn assert_rect(name: &str, actual: Option<Rect>, expect: &Value) {
    match (actual, expect) {
        (None, Value::Null) => {}
        (Some(rect), object) if object.is_object() => {
            assert_eq!(rect.x, num(&object["x"]), "{name}: x");
            assert_eq!(rect.y, num(&object["y"]), "{name}: y");
            assert_eq!(rect.width, num(&object["width"]), "{name}: larghezza");
            assert_eq!(rect.height, num(&object["height"]), "{name}: altezza");
        }
        (actual, expect) => panic!("{name}: atteso {expect}, ottenuto {actual:?}"),
    }
}

/// Controlla un caso e dà il nome della sua funzione.
fn check(name: &str, case: &Value) -> String {
    let function = case["fn"]
        .as_str()
        .unwrap_or_else(|| panic!("{name}: manca `fn`"))
        .to_owned();
    let args = case["args"]
        .as_array()
        .unwrap_or_else(|| panic!("{name}: `args` è un array"));
    let expect = &case["expect"];
    match function.as_str() {
        "snap" => assert_num(name, snap(num(&args[0])), expect),
        "card_kind" => {
            let kind = card_kind(&node_arg(&args[0]));
            assert_eq!(Value::from(kind_name(kind)), *expect, "{name}");
        }
        "born_size" => {
            let text = text_arg(&args[1]);
            let size = born_size(kind_arg(&args[0]), text.as_deref(), content_arg(&args[2]));
            assert_pair(name, size, expect);
        }
        "estimate_text_height" => {
            let text = text_arg(&args[0]).unwrap_or_default();
            assert_num(name, estimate_text_height(&text, num(&args[1])), expect);
        }
        "auto_place" => {
            let canvas = canvas_arg(&args[0]);
            assert_pair(name, auto_place(&canvas, rect_arg(&args[1])), expect);
        }
        "place_near" => {
            let canvas = canvas_arg(&args[0]);
            let near = args[1].as_str().expect("`near` è un id");
            let text = text_arg(&args[5]);
            let placed = place_near(
                &canvas,
                near,
                side_arg(&args[2]),
                opt_num(&args[3]),
                kind_arg(&args[4]),
                text.as_deref(),
                content_arg(&args[6]),
            );
            assert_rect(name, placed, expect);
        }
        "inside" => {
            let answer = inside(&node_arg(&args[0]), &node_arg(&args[1]));
            assert_eq!(Value::from(answer), *expect, "{name}");
        }
        "nearest_sides" => {
            let (from, to) = nearest_sides(&node_arg(&args[0]), &node_arg(&args[1]));
            assert_eq!(
                json!([from, to]),
                *expect,
                "{name}: i lati si scrivono come nel modello"
            );
        }
        "group_rect" => {
            let rects: Vec<Rect> = args[0]
                .as_array()
                .expect("`rects` è un array")
                .iter()
                .map(|rect| rect_arg(rect).expect("una scheda non è null"))
                .collect();
            assert_rect(name, group_rect(&rects, num(&args[1])), expect);
        }
        "align" => assert_positions(
            name,
            &align(&rects_arg(&args[0]), align_arg(&args[1])),
            expect,
        ),
        "distribute" => assert_positions(
            name,
            &distribute(&rects_arg(&args[0]), axis_arg(&args[1])),
            expect,
        ),
        "grid" => assert_positions(
            name,
            &grid(&sizes_arg(&args[0]), num(&args[1]), pair_arg(&args[2])),
            expect,
        ),
        "row" => assert_positions(
            name,
            &row(&sizes_arg(&args[0]), num(&args[1]), pair_arg(&args[2])),
            expect,
        ),
        "column" => assert_positions(
            name,
            &column(&sizes_arg(&args[0]), num(&args[1]), pair_arg(&args[2])),
            expect,
        ),
        "tree" => assert_positions(
            name,
            &tree(
                &sizes_arg(&args[0]),
                &edges_arg(&args[1]),
                direction_arg(&args[2]),
                num(&args[3]),
            ),
            expect,
        ),
        other => panic!("{name}: funzione sconosciuta {other:?}"),
    }
    function
}

#[test]
fn ogni_caso_passa() {
    let list = cases();
    assert!(
        list.len() >= MIN_CASES,
        "servono almeno {MIN_CASES} casi, ce ne sono {}",
        list.len()
    );
    let mut per_fn: BTreeMap<String, usize> = BTreeMap::new();
    for (index, case) in list.iter().enumerate() {
        let about = case["about"]
            .as_str()
            .filter(|about| !about.is_empty())
            .unwrap_or_else(|| panic!("caso {index}: manca `about`"));
        for key in case.as_object().expect("un caso è un oggetto").keys() {
            assert!(
                matches!(key.as_str(), "about" | "fn" | "args" | "expect"),
                "caso {index}: campo sconosciuto {key:?}"
            );
        }
        let name = format!("caso {index} ({about})");
        let function = check(&name, case);
        *per_fn.entry(function).or_default() += 1;
    }
    for (function, minimum) in MIN_PER_FN {
        let seen = per_fn.get(function).copied().unwrap_or(0);
        assert!(
            seen >= minimum,
            "{function}: servono almeno {minimum} casi, ce ne sono {seen}"
        );
    }
}

/// Ogni specie ha una misura di nascita provata nel file, Craft compresa.
#[test]
fn ogni_specie_ha_la_sua_misura() {
    let mut seen = Vec::new();
    for case in cases() {
        if case["fn"] == "born_size" {
            seen.push(case["args"][0].as_str().expect("una specie").to_owned());
        }
    }
    for (name, _) in KINDS {
        assert!(
            seen.iter().any(|kind| kind == name),
            "nessun caso per {name:?}"
        );
    }
}

/// Un non finito non va in panico: il risultato non è finito, e chi chiama lo
/// rifiuta. Il testo non finito non si può scrivere in JSON, qui si prova in Rust.
#[test]
fn i_numeri_non_finiti_non_vanno_in_panico() {
    assert!(snap(f64::NAN).is_nan());
    assert!(snap(f64::INFINITY).is_infinite());
    assert_eq!(estimate_text_height("ciao", f64::NAN), 160.0);
    assert_eq!(
        born_size(CardKind::Pdf, None, Some((f64::NAN, 1.0))),
        (360.0, 480.0)
    );
    assert_eq!(
        born_size(CardKind::Image, None, Some((1.0, f64::INFINITY))),
        (480.0, 360.0)
    );
    let canvas = parse(
        r#"{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":320,"height":160,"text":""}]}"#,
    )
    .expect("una lavagna valida");
    let placed = place_near(
        &canvas,
        "n",
        CanvasEdgeSide::Right,
        Some(f64::NAN),
        CardKind::Text,
        Some(""),
        None,
    )
    .expect("near c'è");
    assert!(!placed.x.is_finite());
    let grown = group_rect(
        &[Rect {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        }],
        f64::INFINITY,
    )
    .expect("una scheda");
    assert!(!grown.width.is_finite());
}

/// Le misure enormi (il più grande intero sicuro, e più schede così) non danno
/// né `NaN` né `Infinity`: le posizioni restano finite.
#[test]
fn le_misure_enormi_restano_finite() {
    let huge = 9_007_199_254_740_991.0_f64;
    let sizes = vec![(huge, huge); 4];
    let edges = [(0, 1), (0, 2), (2, 3)];
    let rects: Vec<Rect> = (0..4)
        .map(|index| Rect {
            x: huge * index as f64,
            y: huge * index as f64,
            width: huge,
            height: huge,
        })
        .collect();
    let answers = [
        grid(&sizes, 24.0, (0.0, 0.0)),
        row(&sizes, 24.0, (0.0, 0.0)),
        column(&sizes, 24.0, (0.0, 0.0)),
        tree(&sizes, &edges, Direction::Down, 24.0),
        tree(&sizes, &edges, Direction::Left, 24.0),
        align(&rects, Align::Center),
        align(&rects, Align::Bottom),
        distribute(&rects, Axis::Horizontal),
        distribute(&rects, Axis::Vertical),
    ];
    for positions in answers {
        assert_eq!(positions.len(), 4);
        for (x, y) in positions {
            assert!(x.is_finite() && y.is_finite(), "posizione {x}, {y}");
        }
    }
}

/// Un albero di 2000 schede in fila (una catena e una stella) dà le posizioni
/// attese. Il metodo tidy è lineare (un contorno per strato, unito dal più
/// piccolo): il test prova il risultato, non il tempo, che sul PC carico non è
/// misurabile.
#[test]
fn un_albero_di_2000_schede_in_fila() {
    let sizes = vec![(100.0, 50.0); 2000];
    let chain: Vec<(usize, usize)> = (0..1999).map(|node| (node, node + 1)).collect();
    let down = tree(&sizes, &chain, Direction::Down, 24.0);
    for (node, &(x, y)) in down.iter().enumerate() {
        assert_eq!((x, y), (0.0, 146.0 * node as f64), "catena, scheda {node}");
    }
    // Una stella: la radice e 1999 figli in fila, la radice centrata sopra di loro.
    let star: Vec<(usize, usize)> = (1..2000).map(|child| (0, child)).collect();
    let fan = tree(&sizes, &star, Direction::Down, 24.0);
    assert_eq!(fan[0], (123_876.0, 0.0), "la radice centrata sui figli");
    for (child, &(x, y)) in fan.iter().enumerate().skip(1) {
        assert_eq!(
            (x, y),
            (124.0 * (child - 1) as f64, 146.0),
            "stella, figlio {child}"
        );
    }
}

/// Un valore non finito non va in panico: ogni funzione dà tante posizioni
/// quante schede ha, e chi chiama rifiuta i valori non finiti prima di scriverli.
#[test]
fn i_numeri_non_finiti_di_arrange_non_vanno_in_panico() {
    let sizes = [
        (f64::NAN, 1.0),
        (f64::INFINITY, 2.0),
        (3.0, f64::NEG_INFINITY),
    ];
    assert_eq!(grid(&sizes, 24.0, (0.0, 0.0)).len(), 3);
    assert_eq!(
        tree(&sizes, &[(0, 1), (1, 2), (2, 0)], Direction::Right, 24.0).len(),
        3
    );
    let rects = [
        Rect {
            x: f64::NAN,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
        Rect {
            x: 0.0,
            y: f64::INFINITY,
            width: f64::INFINITY,
            height: 1.0,
        },
        Rect {
            x: 2.0,
            y: 2.0,
            width: 3.0,
            height: f64::NAN,
        },
    ];
    assert_eq!(align(&rects, Align::Left).len(), 3);
    assert_eq!(distribute(&rects, Axis::Vertical).len(), 3);
}
