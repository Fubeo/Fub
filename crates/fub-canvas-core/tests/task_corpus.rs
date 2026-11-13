//! Il corpus dei compiti (`apps/client/src/__fixtures__/canvas-tasks/`): venti
//! richieste come le scriverebbe una persona, ciascuna con la sua lavagna di
//! partenza, la soluzione con le operazioni di main (`ops_today`) e quella con
//! le operazioni del piano (`ops`). Dice quanto costa ogni compito, e che cosa
//! manca ancora. Le regole stanno in `docs/development/canvas-parity.md`, «Il
//! corpus».
//!
//! Un compito è `{about, prompt, before, ops_today, ops, needs?, checks}`:
//! - `ops_today` è `null` se con le operazioni di main il compito non si può;
//! - `needs` (facoltativo, vuoto di serie) elenca le operazioni (`align`) e i
//!   campi (`add_card.near`) che `ops` usa e il nucleo non ha ancora. Il runner
//!   vuole che sia esatto: un nome che manca, uno di troppo, o uno che ora
//!   compila (il cricchetto) fallisce;
//! - con `needs` vuoto anche `ops` deve compilare e passare i controlli;
//! - le schede si nominano per testo, o per file con il sottopercorso, o per
//!   indirizzo: un nome deve identificare una scheda sola.
//!
//! Con `FUB_CANVAS_ESITI=<cartella>` il test legge `<compito>.json` (la lista
//! delle operazioni scritta da un modello, fuori dal test), la applica a
//! `before` e dice quali passano. Senza la variabile non fa nulla: in CI non
//! gira nessun modello.

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use fub_canvas_core::layout::{self, CardKind};
use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::patch::draft;
use fub_canvas_core::{parse, Canvas, CanvasColor, CanvasNode, CanvasNodeType, PresetColor};
use serde::Deserialize;
use serde_json::{Map, Value};

/// La cartella dei compiti, dalla radice del crate.
const FOLDER: &str = "../../apps/client/src/__fixtures__/canvas-tasks";
/// Quanti compiti ha il corpus.
const TASKS: usize = 20;
/// Il seme con cui si compilano le operazioni: stesso seme, stessi id.
const SEED: u64 = 1;
/// La variabile con la cartella delle risposte di un modello.
const ESITI_VAR: &str = "FUB_CANVAS_ESITI";
/// I campi di primo livello di un compito; `needs` è il solo facoltativo.
const FIELDS: [&str; 7] = [
    "about",
    "prompt",
    "before",
    "ops_today",
    "ops",
    "needs",
    "checks",
];
/// Le specie che `count` accetta, oltre a `edge` e `card` (tutte le schede
/// tranne i gruppi).
const SPECIES: [&str; 10] = [
    "text", "note", "document", "sheet", "pdf", "image", "web", "craft", "file", "group",
];
/// Dove sta l'inchiostro di una scheda o della radice: la chiave che il nucleo
/// conserva senza leggerla (`extra`).
const INK: &str = "fub:ink";

/// Un compito letto dal suo file.
struct Task {
    name: String,
    before: Canvas,
    ops_today: Option<Vec<Value>>,
    ops: Vec<Value>,
    needs: Vec<String>,
    checks: Vec<Check>,
}

impl Task {
    /// Legge un compito e ne controlla la forma. `name` è il nome del file
    /// senza estensione.
    fn read(name: &str, text: &str) -> Result<Self, String> {
        let value: Value =
            serde_json::from_str(text).map_err(|e| format!("{name}: non è JSON: {e}"))?;
        let object = value
            .as_object()
            .ok_or_else(|| format!("{name}: non è un oggetto"))?;
        if let Some(key) = object.keys().find(|key| !FIELDS.contains(&key.as_str())) {
            return Err(format!("{name}: campo sconosciuto {key:?}"));
        }
        for key in FIELDS.iter().filter(|key| **key != "needs") {
            if !object.contains_key(*key) {
                return Err(format!("{name}: manca `{key}`"));
            }
        }
        text_field(name, object, "about")?;
        text_field(name, object, "prompt")?;
        let before = parse(&object["before"].to_string())
            .map_err(|e| format!("{name}: `before` non è una lavagna: {e}"))?;
        let ops_today = match &object["ops_today"] {
            Value::Null => None,
            value => Some(operations(name, "ops_today", value)?),
        };
        let ops = operations(name, "ops", &object["ops"])?;
        let needs: Vec<String> = match object.get("needs") {
            None => Vec::new(),
            Some(Value::Array(list)) => list
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| format!("{name}: `needs` è una lista di testi"))
                })
                .collect::<Result<_, _>>()?,
            Some(_) => return Err(format!("{name}: `needs` è una lista di testi")),
        };
        let mut seen = BTreeSet::new();
        if let Some(twice) = needs.iter().find(|need| !seen.insert(need.as_str())) {
            return Err(format!("{name}: «{twice}» è in needs due volte"));
        }
        let checks: Vec<Check> = serde_json::from_value(object["checks"].clone())
            .map_err(|e| format!("{name}: `checks` non si legge: {e}"))?;
        for check in &checks {
            check.validate().map_err(|e| format!("{name}: {e}"))?;
        }
        Ok(Self {
            name: name.to_owned(),
            before,
            ops_today,
            ops,
            needs,
            checks,
        })
    }
}

fn text_field(name: &str, object: &Map<String, Value>, field: &str) -> Result<String, String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| format!("{name}: `{field}` è un testo vuoto o manca"))
}

/// Una lista di operazioni: un array di oggetti, ognuno con il campo `op`.
fn operations(name: &str, field: &str, value: &Value) -> Result<Vec<Value>, String> {
    let list = value
        .as_array()
        .ok_or_else(|| format!("{name}: `{field}` è una lista di operazioni"))?;
    for op in list {
        if op.get("op").and_then(Value::as_str).is_none() {
            return Err(format!("{name}: in `{field}` c'è un'operazione senza `op`"));
        }
    }
    Ok(list.clone())
}

/// Un controllo del corpus. Ogni nome di scheda deve identificare una scheda
/// sola: il corpus usa testi unici.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Check {
    HasCard(HasCard),
    HasEdge(HasEdge),
    NoOverlap(NoOverlap),
    Aligned(Aligned),
    Spaced(Spaced),
    Count(Count),
    InGroup(InGroup),
    Strokes(Strokes),
    Color(Color),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HasCard {
    text: Option<String>,
    file: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HasEdge {
    from_text: String,
    to_text: String,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NoOverlap {
    texts: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Aligned {
    texts: Vec<String>,
    axis: Alignment,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Spaced {
    texts: Vec<String>,
    axis: Axis,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Count {
    kind: String,
    n: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct InGroup {
    label: String,
    texts: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Strokes {
    on_text: Option<String>,
    n: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Color {
    texts: Vec<String>,
    color: String,
}

/// Il bordo che `aligned` confronta. `center_x` e `center_y` confrontano il
/// centro lungo un asse.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Alignment {
    Left,
    Right,
    Top,
    Bottom,
    CenterX,
    CenterY,
}

/// L'asse lungo cui `spaced` misura lo spazio fra i bordi.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Axis {
    X,
    Y,
}

impl Check {
    fn label(&self) -> &'static str {
        match self {
            Check::HasCard(_) => "has_card",
            Check::HasEdge(_) => "has_edge",
            Check::NoOverlap(_) => "no_overlap",
            Check::Aligned(_) => "aligned",
            Check::Spaced(_) => "spaced",
            Check::Count(_) => "count",
            Check::InGroup(_) => "in_group",
            Check::Strokes(_) => "strokes",
            Check::Color(_) => "color",
        }
    }

    /// La forma del controllo: quello che si può dire senza guardare la lavagna.
    fn validate(&self) -> Result<(), String> {
        match self {
            Check::HasCard(args) => match (&args.text, &args.file) {
                (Some(_), None) | (None, Some(_)) => Ok(()),
                _ => Err("has_card vuole `text` oppure `file`, uno solo".to_owned()),
            },
            Check::Aligned(args) => at_least(&args.texts, 2, "aligned"),
            Check::Spaced(args) => at_least(&args.texts, 3, "spaced"),
            Check::InGroup(args) => at_least(&args.texts, 1, "in_group"),
            Check::Color(args) => {
                at_least(&args.texts, 1, "color")?;
                canonical_color(&args.color)
                    .map(|_| ())
                    .ok_or_else(|| format!("color: il colore {:?} non c'è", args.color))
            }
            Check::Count(args) => {
                if args.kind == "edge"
                    || args.kind == "card"
                    || SPECIES.contains(&args.kind.as_str())
                {
                    Ok(())
                } else {
                    Err(format!("count: il tipo {:?} non c'è", args.kind))
                }
            }
            Check::HasEdge(_) | Check::NoOverlap(_) | Check::Strokes(_) => Ok(()),
        }
    }

    /// Il controllo sul modello di dopo: `Ok` se regge, altrimenti il perché.
    fn run(&self, canvas: &Canvas) -> Result<(), String> {
        match self {
            Check::HasCard(args) => match (&args.text, &args.file) {
                (Some(text), _) => only(canvas, &format!("con il testo «{text}»"), |node| {
                    node.text.as_deref() == Some(text.as_str())
                })
                .map(|_| ()),
                (None, Some(file)) => only(canvas, &format!("con il file «{file}»"), |node| {
                    node.node_type == CanvasNodeType::File
                        && name_of(node).as_deref() == Some(file.as_str())
                })
                .map(|_| ()),
                (None, None) => Err("has_card senza testo né file".to_owned()),
            },
            Check::HasEdge(args) => {
                let from = named(canvas, &args.from_text)?;
                let to = named(canvas, &args.to_text)?;
                let found = canvas.edges.iter().any(|edge| {
                    edge.from_node == from.id
                        && edge.to_node == to.id
                        && args
                            .label
                            .as_ref()
                            .is_none_or(|label| edge.label.as_ref() == Some(label))
                });
                if found {
                    Ok(())
                } else {
                    Err(format!(
                        "nessun arco da «{}» a «{}»",
                        args.from_text, args.to_text
                    ))
                }
            }
            Check::NoOverlap(args) => {
                let cards: Vec<&CanvasNode> = match &args.texts {
                    Some(texts) => named_all(canvas, texts)?,
                    None => canvas
                        .nodes
                        .iter()
                        .filter(|node| node.node_type != CanvasNodeType::Group)
                        .collect(),
                };
                for (index, first) in cards.iter().enumerate() {
                    for second in &cards[index + 1..] {
                        if overlaps(first, second) {
                            return Err(format!(
                                "«{}» e «{}» si sovrappongono",
                                label_of(first),
                                label_of(second)
                            ));
                        }
                    }
                }
                Ok(())
            }
            Check::Aligned(args) => {
                let values: Vec<i64> = named_all(canvas, &args.texts)?
                    .into_iter()
                    .map(|node| alignment_value(node, args.axis))
                    .collect();
                if values.windows(2).all(|pair| pair[0] == pair[1]) {
                    Ok(())
                } else {
                    Err(format!("non sono allineate: {values:?}"))
                }
            }
            Check::Spaced(args) => {
                let mut cards = named_all(canvas, &args.texts)?;
                cards.sort_by_key(|node| axis_start(node, args.axis));
                let gaps: Vec<i64> = cards
                    .windows(2)
                    .map(|pair| axis_start(pair[1], args.axis) - axis_end(pair[0], args.axis))
                    .collect();
                if gaps.windows(2).all(|pair| pair[0] == pair[1]) {
                    Ok(())
                } else {
                    Err(format!("lo spazio fra le schede non è uguale: {gaps:?}"))
                }
            }
            Check::Count(args) => {
                let n = match args.kind.as_str() {
                    "edge" => canvas.edges.len(),
                    "card" => canvas
                        .nodes
                        .iter()
                        .filter(|node| node.node_type != CanvasNodeType::Group)
                        .count(),
                    kind => canvas
                        .nodes
                        .iter()
                        .filter(|node| species(node) == kind)
                        .count(),
                };
                if n == args.n {
                    Ok(())
                } else {
                    Err(format!("ci sono {n} «{}», ne vuole {}", args.kind, args.n))
                }
            }
            Check::InGroup(args) => {
                let group = only(canvas, &format!("il gruppo «{}»", args.label), |node| {
                    node.node_type == CanvasNodeType::Group
                        && node.label.as_deref() == Some(args.label.as_str())
                })?;
                for text in &args.texts {
                    let card = named(canvas, text)?;
                    if !layout::inside(card, group) {
                        return Err(format!("«{text}» non è dentro «{}»", args.label));
                    }
                }
                Ok(())
            }
            Check::Strokes(args) => {
                let n = strokes_of(canvas, args.on_text.as_deref())?;
                if n == args.n {
                    Ok(())
                } else {
                    Err(format!("ci sono {n} tratti, ne vuole {}", args.n))
                }
            }
            Check::Color(args) => {
                let want = canonical_color(&args.color)
                    .ok_or_else(|| format!("il colore {:?} non c'è", args.color))?;
                for text in &args.texts {
                    let node = named(canvas, text)?;
                    let have = node
                        .color
                        .as_ref()
                        .map_or_else(|| "nessuno".to_owned(), color_value);
                    if have != want {
                        return Err(format!("«{text}» ha colore {have}, ne vuole {want}"));
                    }
                }
                Ok(())
            }
        }
    }
}

fn at_least(texts: &[String], min: usize, check: &str) -> Result<(), String> {
    if texts.len() >= min {
        Ok(())
    } else {
        Err(format!("{check}: servono almeno {min} schede in `texts`"))
    }
}

/// Il nome di una scheda: il testo, il file con il suo sottopercorso (`#page=1`),
/// o l'indirizzo. Un gruppo non ha un nome di scheda: si nomina per etichetta.
fn name_of(node: &CanvasNode) -> Option<String> {
    if node.node_type == CanvasNodeType::Group {
        return None;
    }
    node.text
        .clone()
        .or_else(|| {
            node.file
                .as_ref()
                .map(|file| format!("{file}{}", node.subpath.as_deref().unwrap_or_default()))
        })
        .or_else(|| node.url.clone())
}

fn label_of(node: &CanvasNode) -> String {
    name_of(node).unwrap_or_else(|| node.id.clone())
}

/// Le schede che rispondono a `matches`, e la sola che c'è. Zero schede, o più
/// d'una, fallisce: un nome deve dire quale scheda.
fn only<'a>(
    canvas: &'a Canvas,
    what: &str,
    matches: impl Fn(&CanvasNode) -> bool,
) -> Result<&'a CanvasNode, String> {
    let found: Vec<&CanvasNode> = canvas.nodes.iter().filter(|node| matches(node)).collect();
    match found.as_slice() {
        [node] => Ok(*node),
        [] => Err(format!("{what}: nessuna scheda")),
        many => Err(format!(
            "{what}: {} schede con questo nome, i testi del corpus sono unici",
            many.len()
        )),
    }
}

fn named<'a>(canvas: &'a Canvas, name: &str) -> Result<&'a CanvasNode, String> {
    only(canvas, &format!("«{name}»"), |node| {
        name_of(node).as_deref() == Some(name)
    })
}

fn named_all<'a>(canvas: &'a Canvas, texts: &[String]) -> Result<Vec<&'a CanvasNode>, String> {
    texts.iter().map(|text| named(canvas, text)).collect()
}

/// Due schede si sovrappongono se i loro interni si toccano. Un bordo in
/// comune non conta.
fn overlaps(first: &CanvasNode, second: &CanvasNode) -> bool {
    first.x < second.x + second.width
        && second.x < first.x + first.width
        && first.y < second.y + second.height
        && second.y < first.y + first.height
}

fn alignment_value(node: &CanvasNode, alignment: Alignment) -> i64 {
    match alignment {
        Alignment::Left => node.x,
        Alignment::Right => node.x + node.width,
        Alignment::Top => node.y,
        Alignment::Bottom => node.y + node.height,
        // Il doppio del centro, così il confronto resta intero.
        Alignment::CenterX => 2 * node.x + node.width,
        Alignment::CenterY => 2 * node.y + node.height,
    }
}

fn axis_start(node: &CanvasNode, axis: Axis) -> i64 {
    match axis {
        Axis::X => node.x,
        Axis::Y => node.y,
    }
}

fn axis_end(node: &CanvasNode, axis: Axis) -> i64 {
    match axis {
        Axis::X => node.x + node.width,
        Axis::Y => node.y + node.height,
    }
}

/// La specie di una scheda, con i nomi di `count`.
fn species(node: &CanvasNode) -> &'static str {
    match layout::card_kind(node) {
        CardKind::Text => "text",
        CardKind::Note => "note",
        CardKind::Document => "document",
        CardKind::Sheet => "sheet",
        CardKind::Pdf => "pdf",
        CardKind::Image => "image",
        CardKind::Web => "web",
        CardKind::Craft => "craft",
        CardKind::File => "file",
        CardKind::Group => "group",
    }
}

/// I tratti di un livello `fub:ink`: `{v, strokes: [...]}`. Il nucleo non lo
/// interpreta: conta l'array.
fn layer_strokes(layer: Option<&Value>) -> usize {
    layer
        .and_then(|layer| layer.get("strokes"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn strokes_of(canvas: &Canvas, on_text: Option<&str>) -> Result<usize, String> {
    match on_text {
        Some(text) => Ok(layer_strokes(named(canvas, text)?.extra.get(INK))),
        None => Ok(layer_strokes(canvas.extra.get(INK))
            + canvas
                .nodes
                .iter()
                .map(|node| layer_strokes(node.extra.get(INK)))
                .sum::<usize>()),
    }
}

fn preset_value(color: PresetColor) -> &'static str {
    match color {
        PresetColor::Red => "1",
        PresetColor::Orange => "2",
        PresetColor::Yellow => "3",
        PresetColor::Green => "4",
        PresetColor::Cyan => "5",
        PresetColor::Purple => "6",
    }
}

/// Il colore di una scheda come lo scrive il file: `"1"`…`"6"` o `#rrggbb`.
fn color_value(color: &CanvasColor) -> String {
    match color {
        CanvasColor::Preset(preset) => preset_value(*preset).to_owned(),
        CanvasColor::Hex(hex) => hex.to_ascii_lowercase(),
    }
}

/// Un colore come lo dà un compito: un nome di colore di scheda (`red`…
/// `purple`), `"1"`…`"6"`, o `#rrggbb`. Dà la forma del file.
fn canonical_color(name: &str) -> Option<String> {
    let value = match name {
        "red" => "1",
        "orange" => "2",
        "yellow" => "3",
        "green" => "4",
        "cyan" => "5",
        "purple" => "6",
        "1" | "2" | "3" | "4" | "5" | "6" => name,
        _ => {
            let hex = name.strip_prefix('#')?;
            return (hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()))
                .then(|| name.to_ascii_lowercase());
        }
    };
    Some(value.to_owned())
}

/// L'errore di serde per `{"op": op}`, con un campo `field` a `null` in più.
/// `None` se l'operazione si legge.
fn read_error(op: &str, field: Option<&str>) -> Option<String> {
    let mut object = Map::new();
    object.insert("op".to_owned(), Value::String(op.to_owned()));
    if let Some(field) = field {
        object.insert(field.to_owned(), Value::Null);
    }
    serde_json::from_value::<CanvasOp>(Value::Object(object))
        .err()
        .map(|error| error.to_string())
}

fn op_known(op: &str) -> bool {
    read_error(op, None).is_none_or(|error| !error.starts_with("unknown variant"))
}

fn field_known(op: &str, field: &str) -> bool {
    op_known(op)
        && read_error(op, Some(field))
            .is_none_or(|error| !error.contains(&format!("unknown field `{field}`")))
}

/// Un nome di `needs`: un'operazione (`align`) o un campo (`add_card.near`).
/// Vero se il nucleo lo ha già.
fn known(name: &str) -> bool {
    match name.split_once('.') {
        None => op_known(name),
        Some((op, field)) => field_known(op, field),
    }
}

/// Le operazioni e i campi che `ops` usa e il nucleo non ha: è ciò che `needs`
/// deve elencare.
fn expected_needs(ops: &[Value]) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for op in ops {
        let name = op.get("op").and_then(Value::as_str).unwrap_or_default();
        if !op_known(name) {
            names.insert(name.to_owned());
            continue;
        }
        if let Some(object) = op.as_object() {
            for field in object.keys().filter(|field| field.as_str() != "op") {
                if !field_known(name, field) {
                    names.insert(format!("{name}.{field}"));
                }
            }
        }
    }
    names
}

/// Gli errori di `needs` rispetto a `ops`, e la regola che `ops_today` null
/// porta con sé: senza main serve dire che cosa manca.
fn needs_errors(task: &Task) -> Vec<String> {
    let mut errors = Vec::new();
    let declared: BTreeSet<&str> = task.needs.iter().map(String::as_str).collect();
    let expected = expected_needs(&task.ops);
    for name in &task.needs {
        if known(name) {
            errors.push(format!(
                "{}: «{name}» ora compila: toglilo da needs (cricchetto)",
                task.name
            ));
        } else if !expected.contains(name) {
            errors.push(format!(
                "{}: needs dice «{name}», ma ops non lo usa",
                task.name
            ));
        }
    }
    for name in expected
        .iter()
        .filter(|name| !declared.contains(name.as_str()))
    {
        errors.push(format!(
            "{}: ops usa «{name}», che il nucleo non ha: va in needs",
            task.name
        ));
    }
    if task.ops_today.is_none() && task.needs.is_empty() {
        errors.push(format!(
            "{}: ops_today è null ma needs è vuoto: needs dice che cosa manca",
            task.name
        ));
    }
    errors
}

/// Compila `ops` su `before` con il seme del corpus e applica le toppe.
fn apply(before: &Canvas, ops: &[Value]) -> Result<Canvas, String> {
    let ops: Vec<CanvasOp> = serde_json::from_value(Value::Array(ops.to_vec()))
        .map_err(|e| format!("non si leggono: {e}"))?;
    let compiled = compile(before, &ops, SEED).map_err(|e| format!("non compilano: {e}"))?;
    draft(before, &compiled.patches).map_err(|e| format!("le toppe non si applicano: {e}"))
}

/// I controlli che il modello di dopo non passa, uno per riga.
fn failed_checks(checks: &[Check], after: &Canvas) -> Vec<String> {
    checks
        .iter()
        .filter_map(|check| {
            check
                .run(after)
                .err()
                .map(|error| format!("{}: {error}", check.label()))
        })
        .collect()
}

/// Gli errori di un compito: `needs`, `ops_today` se c'è, e `ops` se `needs`
/// è vuoto.
fn task_errors(task: &Task) -> Vec<String> {
    let mut errors = needs_errors(task);
    if let Some(ops) = &task.ops_today {
        errors.extend(outcome(task, "ops_today", ops));
    }
    if task.needs.is_empty() {
        errors.extend(outcome(task, "ops", &task.ops));
    }
    errors
}

fn outcome(task: &Task, which: &str, ops: &[Value]) -> Vec<String> {
    match apply(&task.before, ops) {
        Err(error) => vec![format!("{}: {which} {error}", task.name)],
        Ok(after) => failed_checks(&task.checks, &after)
            .into_iter()
            .map(|failed| format!("{}: {which}: {failed}", task.name))
            .collect(),
    }
}

/// Il numero di caratteri di una lista di operazioni, nella forma compatta.
fn chars(ops: &[Value]) -> usize {
    serde_json::to_string(ops).map_or(0, |text| text.chars().count())
}

/// La tabella: il compito, i caratteri di `ops_today` e di `ops`, e quanti nomi
/// mancano al nucleo.
fn table(tasks: &[Task]) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "{:<36} {:>7} {:>7} {:>7}",
        "compito", "oggi", "piano", "servono"
    );
    for task in tasks {
        let today = task
            .ops_today
            .as_ref()
            .map_or_else(|| "—".to_owned(), |ops| chars(ops).to_string());
        let _ = writeln!(
            out,
            "{:<36} {:>7} {:>7} {:>7}",
            task.name,
            today,
            chars(&task.ops),
            task.needs.len()
        );
    }
    out
}

/// Le risposte di un modello: `<compito>.json` in `folder`, la lista delle
/// operazioni. Una riga per compito: passa, non passa (e perché), o salta.
fn esiti(folder: &Path, tasks: &[Task]) -> Vec<String> {
    tasks
        .iter()
        .map(|task| {
            let path = folder.join(format!("{}.json", task.name));
            let text = match std::fs::read_to_string(&path) {
                Ok(text) => text,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return format!("{}: salta, nessun file {}", task.name, path.display());
                }
                Err(error) => return format!("{}: non si legge: {error}", task.name),
            };
            let answer = serde_json::from_str::<Value>(&text)
                .map_err(|e| format!("non è JSON: {e}"))
                .and_then(|value| operations(&task.name, "risposta", &value));
            let ops = match answer {
                Ok(ops) => ops,
                Err(error) => return format!("{}: non passa: {error}", task.name),
            };
            match apply(&task.before, &ops) {
                Err(error) => format!("{}: non passa: {error}", task.name),
                Ok(after) => {
                    let failed = failed_checks(&task.checks, &after);
                    if failed.is_empty() {
                        format!("{}: passa", task.name)
                    } else {
                        format!("{}: non passa: {}", task.name, failed.join("; "))
                    }
                }
            }
        })
        .collect()
}

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FOLDER)
}

/// Tutti i compiti della cartella, in ordine di nome. Un file che non è `.json`
/// o non si legge fa fallire la lettura.
fn read_tasks(folder: &Path) -> Result<Vec<Task>, String> {
    let entries = std::fs::read_dir(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in entries {
        let path = entry
            .map_err(|e| format!("{}: {e}", folder.display()))?
            .path();
        if path.extension().is_none_or(|ext| ext != "json") {
            return Err(format!("{}: solo file .json", path.display()));
        }
        paths.push(path);
    }
    paths.sort();
    paths
        .iter()
        .map(|path| {
            let name = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            let text = std::fs::read_to_string(path).map_err(|e| format!("{name}: {e}"))?;
            Task::read(&name, &text)
        })
        .collect()
}

#[test]
fn il_corpus_ha_venti_compiti_e_ciascuno_regge() {
    let tasks = read_tasks(&folder()).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(
        tasks.len(),
        TASKS,
        "il corpus ha {} compiti, ne servono {TASKS}",
        tasks.len()
    );
    let errors: Vec<String> = tasks.iter().flat_map(task_errors).collect();
    // La tabella esce con `-- --nocapture`: il conto dei caratteri del corpus.
    print!("{}", table(&tasks));
    assert!(
        errors.is_empty(),
        "il corpus non regge:\n{}",
        errors.join("\n")
    );
}

/// Le risposte di un modello, se `FUB_CANVAS_ESITI` le indica. Non fallisce:
/// dice quali passano e quali compiti non hanno un file.
#[test]
fn esiti_di_un_modello_se_richiesti() {
    let Ok(dir) = std::env::var(ESITI_VAR) else {
        println!("esiti: {ESITI_VAR} non è impostata, nessuna risposta da leggere");
        return;
    };
    let tasks = read_tasks(&folder()).unwrap_or_else(|error| panic!("{error}"));
    for line in esiti(Path::new(&dir), &tasks) {
        println!("{line}");
    }
}

#[test]
fn un_nome_ripetuto_non_identifica_una_scheda() {
    let canvas = parse(
        r#"{"nodes":[
            {"id":"a","type":"text","text":"Idea","x":0,"y":0,"width":10,"height":10},
            {"id":"b","type":"text","text":"Idea","x":40,"y":0,"width":10,"height":10}
        ]}"#,
    )
    .expect("la lavagna si legge");
    let check: Check = serde_json::from_str(r#"{"has_card":{"text":"Idea"}}"#).expect("si legge");
    let error = check
        .run(&canvas)
        .expect_err("due schede con lo stesso testo");
    assert!(error.contains("2 schede"), "{error}");
}

#[test]
fn i_controlli_falliscono_quando_non_reggono() {
    let canvas = parse(
        r#"{"nodes":[
            {"id":"a","type":"text","text":"Uno","x":0,"y":0,"width":100,"height":100},
            {"id":"b","type":"text","text":"Due","x":50,"y":0,"width":100,"height":100},
            {"id":"c","type":"text","text":"Tre","x":300,"y":0,"width":100,"height":100}
        ],"edges":[
            {"id":"e","fromNode":"b","toNode":"a"}
        ]}"#,
    )
    .expect("la lavagna si legge");
    let cases = [
        r#"{"has_edge":{"from_text":"Uno","to_text":"Due"}}"#,
        r#"{"no_overlap":{}}"#,
        r#"{"aligned":{"texts":["Uno","Tre"],"axis":"left"}}"#,
        r#"{"spaced":{"texts":["Uno","Due","Tre"],"axis":"x"}}"#,
        r#"{"in_group":{"label":"Gruppo","texts":["Uno"]}}"#,
        r#"{"color":{"texts":["Uno"],"color":"red"}}"#,
        r#"{"strokes":{"n":1}}"#,
    ];
    for case in cases {
        let check: Check = serde_json::from_str(case).expect("il controllo si legge");
        assert!(check.run(&canvas).is_err(), "{case} dovrebbe fallire");
    }
    let holds: Check = serde_json::from_str(r#"{"has_edge":{"from_text":"Due","to_text":"Uno"}}"#)
        .expect("si legge");
    assert!(holds.run(&canvas).is_ok());
    let aligned: Check =
        serde_json::from_str(r#"{"aligned":{"texts":["Uno","Due"],"axis":"top"}}"#)
            .expect("si legge");
    assert!(aligned.run(&canvas).is_ok());
}

#[test]
fn il_cricchetto_chiede_di_togliere_ciò_che_compila() {
    let task = Task::read(
        "prova",
        r#"{"about":"a","prompt":"b","before":{"nodes":[]},"ops_today":[],
            "ops":[{"op":"move","ids":[],"dx":0,"dy":0}],
            "needs":["move"],"checks":[]}"#,
    )
    .expect("il compito si legge");
    let errors = needs_errors(&task);
    assert!(
        errors.iter().any(|e| e.contains("cricchetto")),
        "{errors:?}"
    );
}

#[test]
fn ops_today_null_senza_needs_non_si_legge() {
    let task = Task::read(
        "prova",
        r#"{"about":"a","prompt":"b","before":{"nodes":[]},"ops_today":null,
            "ops":[{"op":"align","ids":[],"to":"left"}],"checks":[]}"#,
    )
    .expect("il compito si legge");
    let errors = needs_errors(&task);
    assert!(
        errors.iter().any(|e| e.contains("ops_today è null")),
        "{errors:?}"
    );
    assert!(
        errors.iter().any(|e| e.contains("va in needs")),
        "{errors:?}"
    );
}

/// Con `needs` vuoto le operazioni del piano devono compilare e passare: il
/// percorso che il corpus userà quando un'operazione arriva.
#[test]
fn con_needs_vuoto_il_runner_compila_ops() {
    let good = r#"{"about":"a","prompt":"b",
        "before":{"nodes":[{"id":"a","type":"text","text":"Uno","x":0,"y":0,"width":10,"height":10}]},
        "ops_today":[{"op":"move","ids":["a"],"dx":8,"dy":0}],
        "ops":[{"op":"move","ids":["a"],"dx":8,"dy":0}],
        "checks":[{"has_card":{"text":"Uno"}},{"count":{"kind":"text","n":1}}]}"#;
    let task = Task::read("buono", good).expect("il compito si legge");
    assert!(task_errors(&task).is_empty(), "{:?}", task_errors(&task));

    let wrong = good.replace(
        r#""ops":[{"op":"move","ids":["a"],"dx":8,"dy":0}]"#,
        r#""ops":[{"op":"move","ids":["zz"],"dx":8,"dy":0}]"#,
    );
    let task = Task::read("sbagliato", &wrong).expect("il compito si legge");
    let errors = task_errors(&task);
    assert!(
        errors.iter().any(|e| e.contains("ops non compilano")),
        "{errors:?}"
    );
}

#[test]
fn senza_file_gli_esiti_saltano_e_lo_dicono() {
    let tasks = read_tasks(&folder()).unwrap_or_else(|error| panic!("{error}"));
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("esiti-vuoti");
    std::fs::create_dir_all(&dir).expect("la cartella di prova");
    let lines = esiti(&dir, &tasks);
    assert_eq!(lines.len(), TASKS);
    assert!(lines.iter().all(|line| line.contains("salta")), "{lines:?}");
}
