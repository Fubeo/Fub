//! L'inventario della parità (`apps/client/src/__fixtures__/canvas-parity/`):
//! ogni azione che si fa dalla GUI di una fonte, e la forma in codice che la
//! fa. Le regole R1–R6 stanno in `docs/development/canvas-parity.md`; R7, la
//! GUI vera, sta in `apps/client/src/editors/canvas/parity.test.ts`.
//!
//! `board.json` dice quali fonti sono in `merged` (quelle già in `main`) e
//! porta la lavagna di prova; `main.json`, `n4.json` e `n6.json` hanno le voci
//! di una fonte ciascuno. Ogni test controlla una regola e raccoglie tutti gli
//! errori, non solo il primo: ognuno nomina la voce e la regola.

use std::collections::HashSet;
use std::path::PathBuf;

use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::{parse, spec, Canvas};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

/// La cartella dei fixture, dalla radice del crate.
const FOLDER: &str = "../../apps/client/src/__fixtures__/canvas-parity";
/// Gli stati di una voce (R1), come nella tabella di `canvas-parity.md`.
const STATES: [&str; 7] = [
    "code",
    "composed",
    "port",
    "by_hand",
    "missing",
    "view",
    "exception",
];
const SOURCES: [&str; 3] = ["main", "N4", "N6"];
const WRITES: [&str; 3] = ["file", "nothing", "other-file"];
/// I tipi di `gui`: dove sta la voce nella GUI, o `plan` finché la fonte non è in main.
const GUI_KINDS: [&str; 7] = [
    "menu",
    "toolbar",
    "field",
    "key",
    "gesture",
    "clipboard",
    "plan",
];
/// Le operazioni dei piani (T9–T20) e delle fonti N4 e N6: nomi ammessi in `ops` e
/// `target_ops` anche prima che il nucleo le abbia.
const PIANO_OPS: [&str; 19] = [
    "color",
    "align",
    "distribute",
    "duplicate",
    "reverse",
    "group",
    "convert",
    "insert",
    "layout",
    "spread_pages",
    "excerpt",
    "draw",
    "erase_along",
    "from_mermaid",
    "from_outline",
    "add_strokes",
    "erase_strokes",
    "move_strokes",
    "restyle_strokes",
];
/// Quante operazioni almeno deve avere `spec::OPS`: meno vuol dire che la lista
/// si è svuotata o accorciata per errore.
const MIN_CORE_OPS: usize = 7;
/// Il seme con cui R2 e R4 compilano le operazioni su `board`.
const SEED: u64 = 1;

type Errors = Vec<String>;

/// Il file `board.json`: la lavagna di prova e le fonti in `merged`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BoardFile {
    version: u32,
    about: String,
    merged: Vec<String>,
    board: Value,
    ops_without_gui: Vec<String>,
}

/// Un file di una fonte. Le voci restano `Value` finché non si leggono una per
/// una, così un errore in una voce non nasconde quelli delle altre.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PartFile {
    version: u32,
    source: String,
    max_missing: usize,
    entries: Vec<Value>,
}

/// Una voce come la scrive «La parità». I campi che la voce non ha sono `None`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    name: String,
    source: String,
    gui: Vec<Value>,
    writes: String,
    state: String,
    ops: Option<Vec<Value>>,
    port: Option<String>,
    computes: Option<String>,
    target_ops: Option<Vec<Value>>,
    task: Option<String>,
    note: Option<String>,
}

/// Un file di una fonte, letto.
struct Part {
    name: &'static str,
    source: String,
    max_missing: usize,
    entries: Vec<Entry>,
}

struct Inventory {
    board: Canvas,
    merged: Vec<String>,
    ops_without_gui: Vec<String>,
    parts: Vec<Part>,
}

fn read_json<T: DeserializeOwned>(name: &str) -> T {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FOLDER)
        .join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// Legge i quattro file. Un file che non si legge fa fallire il test; una voce
/// che non si legge è un errore come gli altri.
fn load() -> (Inventory, Errors) {
    let mut errors = Vec::new();
    let board: BoardFile = read_json("board.json");
    if board.version != 1 {
        errors.push(format!(
            "board.json (R1): version è {}, vuole 1",
            board.version
        ));
    }
    if board.about.trim().is_empty() {
        errors.push("board.json (R1): manca `about`".to_owned());
    }
    let canvas = parse(&board.board.to_string())
        .unwrap_or_else(|e| panic!("board.json: la lavagna non si legge: {e}"));
    let mut parts = Vec::new();
    for name in ["main.json", "n4.json", "n6.json"] {
        let part: PartFile = read_json(name);
        if part.version != 1 {
            errors.push(format!("{name} (R1): version è {}, vuole 1", part.version));
        }
        let mut entries = Vec::new();
        for (index, value) in part.entries.into_iter().enumerate() {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("?")
                .to_owned();
            match serde_json::from_value::<Entry>(value) {
                Ok(entry) => entries.push(entry),
                Err(error) => errors.push(format!(
                    "`{id}` ({name}, voce {index}): non si legge: {error}"
                )),
            }
        }
        parts.push(Part {
            name,
            source: part.source,
            max_missing: part.max_missing,
            entries,
        });
    }
    let inventory = Inventory {
        board: canvas,
        merged: board.merged,
        ops_without_gui: board.ops_without_gui,
        parts,
    };
    (inventory, errors)
}

/// Tutte le voci, con il file che le contiene.
fn voices(inv: &Inventory) -> impl Iterator<Item = (&Part, &Entry)> + '_ {
    inv.parts
        .iter()
        .flat_map(|part| part.entries.iter().map(move |entry| (part, entry)))
}

/// I nomi delle operazioni del nucleo: una voce di `spec::OPS` per variante.
/// Che `OPS` coincida con serde lo dice `tests/spec.rs`.
fn core_names() -> Vec<String> {
    spec::OPS.iter().map(|op| op.name.to_owned()).collect()
}

/// Una voce di `gui`: un oggetto con un solo campo, il tipo, che dà il testo.
fn gui_pair(value: &Value) -> Result<(&str, &str), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{value}: non è un oggetto"))?;
    let mut pairs = object.iter();
    let (Some((kind, text)), None) = (pairs.next(), pairs.next()) else {
        return Err(format!("{value}: vuole un solo campo"));
    };
    if !GUI_KINDS.contains(&kind.as_str()) {
        return Err(format!("tipo «{kind}» sconosciuto"));
    }
    let text = text
        .as_str()
        .ok_or_else(|| format!("«{kind}» non dà un testo"))?;
    Ok((kind.as_str(), text))
}

/// `T` seguito da cifre, come `T9`.
fn is_task(task: &str) -> bool {
    task.strip_prefix('T')
        .is_some_and(|digits| !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
}

fn has_list(list: &Option<Vec<Value>>) -> bool {
    list.as_ref().is_some_and(|items| !items.is_empty())
}

fn has_text(text: &Option<String>) -> bool {
    text.as_ref().is_some_and(|text| !text.trim().is_empty())
}

/// Le operazioni come le legge il nucleo; un'operazione che non si legge dà il motivo.
fn ops_of(list: &[Value]) -> Result<Vec<CanvasOp>, String> {
    list.iter()
        .enumerate()
        .map(|(index, value)| {
            serde_json::from_value::<CanvasOp>(value.clone())
                .map_err(|error| format!("l'operazione {index} non si legge: {error}"))
        })
        .collect()
}

/// Il nome dell'operazione di un valore di `ops` o `target_ops`.
fn op_name(op: &Value) -> Option<&str> {
    op.get("op").and_then(Value::as_str)
}

/// R1: id unici col prefisso della fonte, e i vocabolari di stati, fonti,
/// scritture, tipi di `gui` e nomi di operazione.
fn check_vocabulary(inv: &Inventory, errors: &mut Errors) {
    let core = core_names();
    let known_op = |name: &str| core.iter().any(|c| c == name) || PIANO_OPS.contains(&name);
    let mut ids = HashSet::new();
    for part in &inv.parts {
        if !SOURCES.contains(&part.source.as_str()) {
            errors.push(format!(
                "{} (R1): fonte «{}» sconosciuta",
                part.name, part.source
            ));
        }
    }
    for source in &inv.merged {
        if !SOURCES.contains(&source.as_str()) {
            errors.push(format!(
                "board.json (R1): `merged` dice «{source}», che non è una fonte"
            ));
        }
    }
    if !inv.merged.iter().any(|source| source == "main") {
        errors.push("board.json (R1): `merged` non contiene main".to_owned());
    }
    for name in &inv.ops_without_gui {
        if !known_op(name) {
            errors.push(format!(
                "board.json (R1): `ops_without_gui` dice «{name}», operazione sconosciuta"
            ));
        }
    }
    for (part, entry) in voices(inv) {
        let id = entry.id.as_str();
        if !ids.insert(id) {
            errors.push(format!("`{id}` (R1): id ripetuto"));
        }
        if !id.starts_with(&format!("{}.", entry.source)) {
            errors.push(format!(
                "`{id}` (R1): l'id non comincia con la fonte `{}`",
                entry.source
            ));
        }
        if entry.source != part.source {
            errors.push(format!(
                "`{id}` (R1): la voce è in {} ma la sua fonte è {}",
                part.name, entry.source
            ));
        }
        if !SOURCES.contains(&entry.source.as_str()) {
            errors.push(format!("`{id}` (R1): fonte «{}» sconosciuta", entry.source));
        }
        if !STATES.contains(&entry.state.as_str()) {
            errors.push(format!("`{id}` (R1): stato «{}» sconosciuto", entry.state));
        }
        if !WRITES.contains(&entry.writes.as_str()) {
            errors.push(format!(
                "`{id}` (R1): writes «{}» sconosciuto",
                entry.writes
            ));
        }
        if entry.name.trim().is_empty() {
            errors.push(format!("`{id}` (R1): manca `name`"));
        }
        if entry.gui.is_empty() {
            errors.push(format!("`{id}` (R1): manca `gui`"));
        }
        for value in &entry.gui {
            match gui_pair(value) {
                Err(reason) => errors.push(format!("`{id}` (R1): gui {reason}")),
                Ok(("plan", text)) => {
                    if entry.source == "main" {
                        errors.push(format!(
                            "`{id}` (R1): una voce di main nomina la GUI vera, non `plan`"
                        ));
                    } else if !text.starts_with(&format!("{} T", entry.source)) {
                        errors.push(format!(
                            "`{id}` (R1): `plan` dice «{text}», vuole «{} T<n>»",
                            entry.source
                        ));
                    }
                }
                Ok(_) => {}
            }
        }
        if let Some(task) = &entry.task {
            if !is_task(task) {
                errors.push(format!(
                    "`{id}` (R1): task «{task}», vuole T seguito da un numero"
                ));
            }
        }
        for op in entry
            .ops
            .iter()
            .flatten()
            .chain(entry.target_ops.iter().flatten())
        {
            match op_name(op) {
                Some(name) if known_op(name) => {}
                Some(name) => errors.push(format!("`{id}` (R1): operazione «{name}» sconosciuta")),
                None => errors.push(format!("`{id}` (R1): un'operazione senza il campo `op`")),
            }
        }
    }
}

/// R2: le `ops` delle fonti in `merged` compilano su `board` col seme 1. Una
/// fonte in `merged` non ha più voci `plan`: quando arriva, i suoi gui sono veri.
fn check_merged(inv: &Inventory, errors: &mut Errors) {
    for (_, entry) in voices(inv).filter(|(_, entry)| inv.merged.contains(&entry.source)) {
        let id = entry.id.as_str();
        if entry
            .gui
            .iter()
            .filter_map(|value| gui_pair(value).ok())
            .any(|(kind, _)| kind == "plan")
        {
            errors.push(format!(
                "`{id}` (R2): la fonte è in merged, ma la voce ha ancora `plan`: si scrivono i gui veri"
            ));
        }
        let Some(ops) = &entry.ops else { continue };
        match ops_of(ops) {
            Err(reason) => errors.push(format!("`{id}` (R2): {reason}")),
            Ok(list) => {
                if let Err(error) = compile(&inv.board, &list, SEED) {
                    errors.push(format!(
                        "`{id}` (R2): le ops non compilano su board col seme {SEED}: {error}"
                    ));
                }
            }
        }
    }
}

/// R3: ogni stato ha i suoi campi, e `view` non scrive il file.
fn check_fields(inv: &Inventory, errors: &mut Errors) {
    for (_, entry) in voices(inv) {
        let id = entry.id.as_str();
        for problem in field_problems(entry) {
            errors.push(format!("`{id}` (R3): {problem}"));
        }
    }
}

/// Un campo di una voce: se c'è, e come si chiama.
type Field<'a> = (bool, &'a str);

fn field_problems(entry: &Entry) -> Vec<String> {
    let state = entry.state.as_str();
    // Ciò che lo stato vuole e ciò che non vuole.
    let (wants, refuses): (Vec<Field>, Vec<Field>) = match state {
        "code" => (
            vec![(has_list(&entry.ops), "ops")],
            vec![
                (entry.port.is_some(), "port"),
                (entry.computes.is_some(), "computes"),
            ],
        ),
        "composed" => (
            vec![
                (has_list(&entry.ops), "ops"),
                (has_text(&entry.port), "port"),
            ],
            vec![(entry.computes.is_some(), "computes")],
        ),
        "port" => (
            vec![(has_text(&entry.port), "port")],
            vec![
                (entry.ops.is_some(), "ops"),
                (entry.computes.is_some(), "computes"),
            ],
        ),
        "by_hand" => (
            vec![
                (has_list(&entry.ops), "ops"),
                (has_text(&entry.computes), "computes"),
                (has_list(&entry.target_ops), "target_ops"),
                (has_text(&entry.task), "task"),
            ],
            vec![],
        ),
        "missing" => (
            vec![
                (has_text(&entry.computes), "computes"),
                (has_list(&entry.target_ops), "target_ops"),
                (has_text(&entry.task), "task"),
            ],
            vec![(entry.ops.is_some(), "ops")],
        ),
        "view" => (
            vec![],
            vec![
                (entry.ops.is_some(), "ops"),
                (entry.port.is_some(), "port"),
                (entry.computes.is_some(), "computes"),
                (entry.target_ops.is_some(), "target_ops"),
                (entry.task.is_some(), "task"),
            ],
        ),
        "exception" => (
            vec![(has_text(&entry.note), "note")],
            vec![
                (entry.ops.is_some(), "ops"),
                (entry.port.is_some(), "port"),
                (entry.computes.is_some(), "computes"),
                (entry.target_ops.is_some(), "target_ops"),
                (entry.task.is_some(), "task"),
            ],
        ),
        _ => (vec![], vec![]),
    };
    let mut problems: Vec<String> = wants
        .into_iter()
        .filter(|(present, _)| !present)
        .map(|(_, what)| format!("lo stato {state} vuole {what}"))
        .collect();
    problems.extend(
        refuses
            .into_iter()
            .filter(|(present, _)| *present)
            .map(|(_, what)| format!("lo stato {state} non vuole {what}")),
    );
    if entry.ops.as_ref().is_some_and(Vec::is_empty) {
        problems.push("`ops` è vuoto".to_owned());
    }
    if entry.target_ops.as_ref().is_some_and(Vec::is_empty) {
        problems.push("`target_ops` è vuoto".to_owned());
    }
    if has_list(&entry.target_ops) && !has_text(&entry.task) {
        problems.push("ha target_ops senza task".to_owned());
    }
    if state == "view" && entry.writes != "nothing" {
        problems.push(format!(
            "lo stato view non scrive: writes deve essere «nothing», è «{}»",
            entry.writes
        ));
    }
    problems
}

/// R4: una `target_ops` che compila è il segno che la voce va spostata in `ops`.
fn check_target_ops(inv: &Inventory, errors: &mut Errors) {
    for (_, entry) in voices(inv) {
        let Some(targets) = &entry.target_ops else {
            continue;
        };
        if targets.is_empty() {
            continue;
        }
        if let Ok(list) = ops_of(targets) {
            if compile(&inv.board, &list, SEED).is_ok() {
                errors.push(format!(
                    "`{}` (R4): le target_ops compilano: spostale in ops e cambia lo stato",
                    entry.id
                ));
            }
        }
    }
}

/// R5: `max_missing` di ogni file è il numero delle voci `by_hand` e `missing`.
fn check_missing(inv: &Inventory, errors: &mut Errors) {
    for part in &inv.parts {
        let open = part
            .entries
            .iter()
            .filter(|entry| entry.state == "by_hand" || entry.state == "missing")
            .count();
        if open != part.max_missing {
            errors.push(format!(
                "{} (R5): max_missing è {}, le voci by_hand e missing sono {open}",
                part.name, part.max_missing
            ));
        }
    }
}

/// R6: ogni operazione del nucleo compare in `ops` o `target_ops` di una voce,
/// o in `ops_without_gui`.
fn check_core_ops(inv: &Inventory, core: &[String], errors: &mut Errors) {
    let mut covered: HashSet<String> = inv.ops_without_gui.iter().cloned().collect();
    for (_, entry) in voices(inv) {
        for op in entry
            .ops
            .iter()
            .flatten()
            .chain(entry.target_ops.iter().flatten())
        {
            if let Some(name) = op_name(op) {
                covered.insert(name.to_owned());
            }
        }
    }
    for name in core {
        if !covered.contains(name) {
            errors.push(format!(
                "operazione `{name}` (R6): nessuna voce la fa in ops o target_ops, e non è in ops_without_gui"
            ));
        }
    }
}

fn expect_clean(errors: Errors) {
    assert!(
        errors.is_empty(),
        "{} errori:\n- {}",
        errors.len(),
        errors.join("\n- ")
    );
}

#[test]
fn il_vocabolario_delle_voci_e_quello_del_piano() {
    let (inv, mut errors) = load();
    check_vocabulary(&inv, &mut errors);
    expect_clean(errors);
}

#[test]
fn le_fonti_in_merged_compilano_su_board() {
    let (inv, mut errors) = load();
    check_merged(&inv, &mut errors);
    expect_clean(errors);
}

#[test]
fn ogni_stato_ha_i_suoi_campi() {
    let (inv, mut errors) = load();
    check_fields(&inv, &mut errors);
    expect_clean(errors);
}

#[test]
fn le_target_ops_non_compilano_ancora() {
    let (inv, mut errors) = load();
    check_target_ops(&inv, &mut errors);
    expect_clean(errors);
}

#[test]
fn il_conto_di_max_missing_torna() {
    let (inv, mut errors) = load();
    check_missing(&inv, &mut errors);
    expect_clean(errors);
}

#[test]
fn ogni_operazione_del_nucleo_ha_una_voce() {
    let core = core_names();
    assert!(
        core.len() >= MIN_CORE_OPS,
        "il messaggio di serde per un'operazione sconosciuta è cambiato: {core:?}"
    );
    let (inv, mut errors) = load();
    check_core_ops(&inv, &core, &mut errors);
    expect_clean(errors);
}
