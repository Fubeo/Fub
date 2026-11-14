//! Il controllo di una lista di operazioni, prima di scriverla: che cosa
//! cambierebbe, con gli avvisi che la GUI farebbe vedere a occhio, e i problemi
//! che impediscono di scriverla, con la correzione quando ce n'è una sola.
//!
//! [`check`] fa i passi nell'ordine della scrittura: la forma
//! ([`spec::validate`]), poi la lettura di serde, poi [`ops::compile`]. Un
//! problema di uno dei tre dà `ok: false`, e il rapporto non ha né riassunto né
//! lettura di dopo: le operazioni valgono tutte o nessuna. Con `ok: true` gli
//! avvisi si cercano solo sulle schede che le operazioni toccano: una scheda che
//! c'era già e che nessuno tocca non compare.
//!
//! Le regole e i codici stanno in `docs/reference/canvas-code.md`, «Il
//! controllo».

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;

use crate::describe::{self, DescribeOptions};
use crate::layout::{estimate_text_height, inside, overlaps, Rect};
use crate::model::{Canvas, CanvasNode, CanvasNodeType};
use crate::ops::{self, CanvasOp, OpError};
use crate::patch;
use crate::spec::{self, ProblemCode};
use crate::summary::{summarize, Summary};

/// Quanti nomi vicini si danno al più in un suggerimento: un id sbagliato di
/// una lavagna con cento schede simili non va elencato per intero.
const MAX_SUGGESTIONS: usize = 3;

/// Il lato di una cella della griglia degli avvisi, in unità della lavagna.
const CELL: i128 = 256;

/// Quante celle al più occupa una scheda nella griglia. Una scheda più grande
/// (un gruppo ampio) sta nella lista delle grandi, che si confronta con tutte.
const MAX_CELLS: i128 = 16;

/// Quanti avvisi al più porta il rapporto. Gli altri si contano in
/// [`CheckReport::warnings_omitted`], senza elencarli: un mucchio di schede nello
/// stesso punto dà milioni di coppie.
pub const MAX_WARNINGS: usize = 100;

/// Il rapporto di [`check`]. Con `ok: false` ci sono solo i problemi: `summary`
/// e `outline_after` sono `null`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CheckReport {
    /// Se la lista si scrive: nessun problema.
    pub ok: bool,
    /// I problemi che impediscono di scrivere, in ordine. La compilazione si
    /// ferma al primo, come [`ops::compile`].
    pub problems: Vec<Problem>,
    /// Gli avvisi sulle schede che la lista tocca: al più [`MAX_WARNINGS`], nell'ordine
    /// del testo, delle coperture e dei gruppi.
    pub warnings: Vec<Warning>,
    /// Quanti avvisi non entrano in `warnings`: il conto è esatto, ogni coppia
    /// si conta una volta. Di solito è `0`.
    pub warnings_omitted: usize,
    /// Che cosa cambierebbe.
    pub summary: Option<Summary>,
    /// La lettura della lavagna dopo la lista, come [`describe::outline`].
    pub outline_after: Option<String>,
}

impl CheckReport {
    fn refused(problems: Vec<Problem>) -> Self {
        Self {
            ok: false,
            problems,
            warnings: Vec::new(),
            warnings_omitted: 0,
            summary: None,
            outline_after: None,
        }
    }
}

/// Un problema di una lista, come lo dà [`check`]. Ha la stessa forma di
/// [`spec::Problem`], con i codici della compilazione in più.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Problem {
    /// Che cosa non va.
    pub code: Code,
    /// La posizione dell'operazione nella lista, da zero; `None` se il
    /// problema riguarda la lista intera.
    pub index: Option<usize>,
    /// Dove sta, come puntatore JSON (RFC 6901): `/2/ids/0`. Per la lista
    /// intera è `""`.
    pub path: String,
    /// Una frase fissa in inglese, come i messaggi di [`OpError`]. Le frasi per
    /// le persone le fa chi mostra il problema.
    pub message: String,
    /// Il nome o gli id più vicini, al più tre, a distanza al più 2.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    /// L'operazione intera con la correzione. C'è solo per la forma, quando la
    /// correzione è una sola.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<Value>,
}

/// I codici dei problemi di [`check`]: quelli della forma (come
/// [`spec::ProblemCode`]) e quelli della compilazione (come [`OpError`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    /// La lista è vuota.
    Invalid,
    /// Il nome dell'operazione non c'è.
    UnknownOp,
    /// Un campo che l'operazione non ha.
    UnknownField,
    /// Un campo obbligatorio che manca.
    MissingField,
    /// Un tipo JSON sbagliato.
    WrongType,
    /// Un valore fuori dall'elenco ammesso.
    BadValue,
    /// Un id di scheda che non c'è: `move`, `resize`, `reorder`, o un estremo di
    /// `connect`.
    UnknownNode,
    /// Un id che non è né una scheda né un arco: `remove` o `set`.
    UnknownEdge,
    /// Un id che è già preso, o ripetuto nella stessa operazione.
    DuplicateId,
    /// La lavagna avrebbe più schede o archi del limite.
    TooMany,
    /// Un `move` con `contents` tocca più schede del tetto: la lista si divide.
    TooManyMoved,
}

impl Code {
    fn from_shape(code: ProblemCode) -> Self {
        match code {
            ProblemCode::Invalid => Self::Invalid,
            ProblemCode::UnknownOp => Self::UnknownOp,
            ProblemCode::UnknownField => Self::UnknownField,
            ProblemCode::MissingField => Self::MissingField,
            ProblemCode::WrongType => Self::WrongType,
            ProblemCode::BadValue => Self::BadValue,
        }
    }
}

impl Problem {
    fn shape(problem: spec::Problem) -> Self {
        Self {
            code: Code::from_shape(problem.code),
            index: problem.index,
            path: problem.path,
            message: problem.message.to_owned(),
            suggestion: problem.suggestion,
            fix: problem.fix,
        }
    }

    fn list(message: impl Into<String>) -> Self {
        Self {
            code: Code::Invalid,
            index: None,
            path: String::new(),
            message: message.into(),
            suggestion: None,
            fix: None,
        }
    }

    /// L'operazione `index` che serde non legge, dopo che la forma l'ha accettata.
    fn unread(index: usize) -> Self {
        Self {
            code: Code::Invalid,
            index: Some(index),
            path: format!("/{index}"),
            message: "the operation does not match its schema".to_owned(),
            suggestion: None,
            fix: None,
        }
    }

    fn compile(error: &OpError, raw: &Value, canvas: &Canvas) -> Self {
        let index = error.index();
        let (code, path, message, suggestion) = match error {
            OpError::UnknownNode { id, .. } => (
                Code::UnknownNode,
                locate(raw, index, id),
                "there is no node with this id".to_owned(),
                nearest(id, canvas.nodes.iter().map(|node| node.id.as_str())),
            ),
            OpError::UnknownEdge { id, .. } => (
                Code::UnknownEdge,
                locate(raw, index, id),
                "there is no node or edge with this id".to_owned(),
                nearest(
                    id,
                    canvas
                        .nodes
                        .iter()
                        .map(|node| node.id.as_str())
                        .chain(canvas.edges.iter().map(|edge| edge.id.as_str())),
                ),
            ),
            OpError::DuplicateId { id, .. } => (
                Code::DuplicateId,
                locate(raw, index, id),
                "the id is already taken or repeated".to_owned(),
                None,
            ),
            OpError::TooMany { what, limit, .. } => (
                Code::TooMany,
                format!("/{index}"),
                format!("a canvas holds at most {limit} {what}"),
                None,
            ),
            OpError::TooManyMoved { limit, .. } => (
                Code::TooManyMoved,
                format!("/{index}"),
                format!("`move` with `contents` moves at most {limit} cards"),
                None,
            ),
            OpError::Invalid { reason, .. } => {
                (Code::Invalid, format!("/{index}"), reason.clone(), None)
            }
        };
        Self {
            code,
            index: Some(index),
            path,
            message,
            suggestion,
            fix: None,
        }
    }
}

/// Un avviso su una scheda che la lista tocca, con le schede coinvolte: dove
/// guardare nella lettura di dopo.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Warning {
    pub code: WarningCode,
    /// Le schede coinvolte: per `overlap` le due che si coprono, per
    /// `half_in_group` la scheda e il gruppo, per `text_overflow` la scheda.
    pub ids: Vec<String>,
    /// Per `text_overflow`: l'altezza che la stima di [`estimate_text_height`]
    /// vuole, più di quella data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_height: Option<i64>,
}

/// I codici degli avvisi di [`check`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WarningCode {
    /// Due schede che non sono gruppi si coprono.
    Overlap,
    /// Una scheda è in parte dentro un gruppo e in parte fuori.
    HalfInGroup,
    /// Il testo di una scheda non ci sta nell'altezza che ha.
    TextOverflow,
}

/// Controlla `raw`, una lista di operazioni, sulla lavagna `canvas`, con gli id
/// nuovi dal seme `seed` (come [`ops::compile`]). Non cambia `canvas`.
pub fn check(canvas: &Canvas, raw: &Value, seed: u64) -> CheckReport {
    let shape = spec::validate(raw);
    if !shape.is_empty() {
        return CheckReport::refused(shape.into_iter().map(Problem::shape).collect());
    }
    let Some(list) = raw.as_array() else {
        return CheckReport::refused(vec![Problem::list("the list is not an array")]);
    };
    let ops = match read_ops(list) {
        Ok(ops) => ops,
        Err(index) => return CheckReport::refused(vec![Problem::unread(index)]),
    };
    let compiled = match ops::compile(canvas, &ops, seed) {
        Ok(compiled) => compiled,
        Err(error) => return CheckReport::refused(vec![Problem::compile(&error, raw, canvas)]),
    };
    let after = match patch::draft(canvas, &compiled.patches) {
        Ok(after) => after,
        Err(_) => {
            return CheckReport::refused(vec![Problem::list(
                "the compiled operations do not apply",
            )])
        }
    };
    let summary = summarize(canvas, &compiled);
    let (warnings, warnings_omitted) = warnings(&after, &touched(&summary));
    CheckReport {
        ok: true,
        problems: Vec::new(),
        warnings,
        warnings_omitted,
        summary: Some(summary),
        outline_after: Some(describe::outline(&after, &DescribeOptions::default())),
    }
}

/// Le operazioni come le legge serde. `validate` ha già detto che la forma è
/// giusta: un'operazione che serde non legge è un divario fra i due. Si ferma
/// alla prima, e dà la sua posizione: il dettaglio di serde non esce.
fn read_ops(list: &[Value]) -> Result<Vec<CanvasOp>, usize> {
    list.iter()
        .enumerate()
        .map(|(index, value)| serde_json::from_value(value.clone()).map_err(|_| index))
        .collect()
}

/// Gli id delle schede che il riassunto dice nuove o cambiate.
fn touched(summary: &Summary) -> HashSet<&str> {
    summary
        .cards_added
        .iter()
        .map(|card| card.id.as_str())
        .chain(summary.cards_changed.iter().map(|card| card.id.as_str()))
        .collect()
}

/// Gli avvisi della lavagna di dopo, solo per le coppie che hanno almeno una
/// scheda toccata. Il rapporto ne porta al più [`MAX_WARNINGS`], nell'ordine
/// del testo, delle coperture e dei gruppi; il conto di quelli che restano
/// fuori è esatto e si dà a parte. Ogni coppia si conta una volta sola.
fn warnings(after: &Canvas, touched: &HashSet<&str>) -> (Vec<Warning>, usize) {
    let nodes = &after.nodes;
    let touched_flags: Vec<bool> = nodes
        .iter()
        .map(|node| touched.contains(node.id.as_str()))
        .collect();
    let texts: Vec<Warning> = nodes
        .iter()
        .zip(&touched_flags)
        .filter(|(_, flag)| **flag)
        .filter_map(|(node, _)| {
            text_overflow(node).map(|height| Warning {
                code: WarningCode::TextOverflow,
                ids: vec![node.id.clone()],
                estimated_height: Some(height),
            })
        })
        .collect();

    let grid = Grid::new(nodes);
    let mut covered = Found::default();
    let mut straddling = Found::default();
    for (index, node) in nodes.iter().enumerate() {
        if !touched_flags[index] {
            continue;
        }
        for other in grid.candidates(node, nodes.len()) {
            // Una coppia di due schede toccate arriva da tutte e due le parti:
            // si conta solo dalla parte della scheda con l'indice più piccolo.
            if other == index || (touched_flags[other] && other < index) {
                continue;
            }
            let other_node = &nodes[other];
            if !covers(node, other_node) {
                continue;
            }
            match (
                node.node_type == CanvasNodeType::Group,
                other_node.node_type == CanvasNodeType::Group,
            ) {
                (false, false) => covered.add((index.min(other), index.max(other))),
                (false, true) => {
                    if !inside(node, other_node) {
                        straddling.add((index, other));
                    }
                }
                (true, false) => {
                    if !inside(other_node, node) {
                        straddling.add((other, index));
                    }
                }
                (true, true) => {}
            }
        }
    }

    let total = texts.len() + covered.total + straddling.total;
    let mut warnings = texts;
    warnings.extend(covered.first.into_iter().map(|(first, second)| Warning {
        code: WarningCode::Overlap,
        ids: vec![nodes[first].id.clone(), nodes[second].id.clone()],
        estimated_height: None,
    }));
    warnings.extend(straddling.first.into_iter().map(|(card, group)| Warning {
        code: WarningCode::HalfInGroup,
        ids: vec![nodes[card].id.clone(), nodes[group].id.clone()],
        estimated_height: None,
    }));
    warnings.truncate(MAX_WARNINGS);
    let omitted = total - warnings.len();
    (warnings, omitted)
}

/// Le coppie di un tipo: il conto di tutte, e le prime [`MAX_WARNINGS`] in ordine
/// di indice. Si tengono solo le prime, così due milioni di coppie non stanno in
/// memoria.
#[derive(Default)]
struct Found {
    total: usize,
    first: BTreeSet<(usize, usize)>,
}

impl Found {
    fn add(&mut self, pair: (usize, usize)) {
        self.total += 1;
        self.first.insert(pair);
        if self.first.len() > MAX_WARNINGS {
            self.first.pop_last();
        }
    }
}

/// L'altezza che [`estimate_text_height`] vuole per il testo di una scheda di
/// testo, se è più di quella che la scheda ha. Le altre schede non hanno un
/// testo da misurare.
fn text_overflow(node: &CanvasNode) -> Option<i64> {
    if node.node_type != CanvasNodeType::Text {
        return None;
    }
    let needed = estimate_text_height(node.text.as_deref().unwrap_or(""), node.width as f64);
    // La stima è un intero fra 160 e 1600: il cast è esatto.
    (needed > node.height as f64).then_some(needed as i64)
}

/// Se le due schede si coprono, con la regola di [`crate::layout`]: un bordo
/// che combacia non conta.
fn covers(first: &CanvasNode, second: &CanvasNode) -> bool {
    overlaps(&Rect::of_node(first), &Rect::of_node(second))
}

/// Le schede per cella: una scheda sta nelle celle che tocca. Una scheda che ne
/// toccherebbe troppe va nella lista delle grandi, che si confronta con tutte.
/// Due schede che si coprono hanno almeno una cella in comune, quindi la
/// griglia non perde nessuna coppia.
struct Grid {
    cells: HashMap<(i128, i128), Vec<usize>>,
    large: Vec<usize>,
}

impl Grid {
    fn new(nodes: &[CanvasNode]) -> Self {
        let mut grid = Self {
            cells: HashMap::new(),
            large: Vec::new(),
        };
        for (index, node) in nodes.iter().enumerate() {
            let range = CellRange::of(node);
            if range.is_large() {
                grid.large.push(index);
                continue;
            }
            for x in range.first_x..=range.last_x {
                for y in range.first_y..=range.last_y {
                    grid.cells.entry((x, y)).or_default().push(index);
                }
            }
        }
        grid
    }

    /// Le schede che possono coprire `node`, in ordine e senza ripetizioni.
    /// `node` può essere una di loro (la confronta con sé stessa, e l'avviso
    /// salta). `count` è il numero di schede della lavagna.
    fn candidates(&self, node: &CanvasNode, count: usize) -> Vec<usize> {
        let range = CellRange::of(node);
        if range.is_large() {
            return (0..count).collect();
        }
        let mut found = self.large.clone();
        for x in range.first_x..=range.last_x {
            for y in range.first_y..=range.last_y {
                if let Some(list) = self.cells.get(&(x, y)) {
                    found.extend_from_slice(list);
                }
            }
        }
        found.sort_unstable();
        found.dedup();
        found
    }
}

/// Le celle che una scheda tocca, con il lato di [`CELL`].
struct CellRange {
    first_x: i128,
    last_x: i128,
    first_y: i128,
    last_y: i128,
}

impl CellRange {
    fn of(node: &CanvasNode) -> Self {
        let left = i128::from(node.x);
        let top = i128::from(node.y);
        // Una scheda ha almeno un'unità di lato: il modello la garantisce.
        let right = left + i128::from(node.width).max(1);
        let bottom = top + i128::from(node.height).max(1);
        Self {
            first_x: left.div_euclid(CELL),
            last_x: (right - 1).div_euclid(CELL),
            first_y: top.div_euclid(CELL),
            last_y: (bottom - 1).div_euclid(CELL),
        }
    }

    fn is_large(&self) -> bool {
        (self.last_x - self.first_x + 1) * (self.last_y - self.first_y + 1) > MAX_CELLS
    }
}

/// Il nome o i nomi più vicini a `given`, a distanza al più 2 come in
/// [`spec`]: al più [`MAX_SUGGESTIONS`], alla distanza minima, nell'ordine della
/// lavagna. Il confronto ignora le maiuscole ASCII di `given`.
fn nearest<'a>(given: &str, names: impl Iterator<Item = &'a str>) -> Option<String> {
    let mut best = usize::MAX;
    let mut near: Vec<&str> = Vec::new();
    for name in names {
        let Some(distance) = spec::distance(given, name) else {
            continue;
        };
        if distance < best {
            best = distance;
            near.clear();
        }
        if distance == best && near.len() < MAX_SUGGESTIONS {
            near.push(name);
        }
    }
    (!near.is_empty()).then(|| near.join(", "))
}

/// Il puntatore JSON del primo valore uguale a `text` nell'operazione `index`,
/// cercando in ampiezza: prima i campi di primo livello, poi quelli più in
/// fondo, così `/3/id` vince su `/3/fields/text`. Il valore `op` non conta. Se
/// il testo non c'è, il puntatore è quello dell'operazione.
fn locate(raw: &Value, index: usize, text: &str) -> String {
    let base = format!("/{index}");
    let Some(op) = raw.get(index) else {
        return base;
    };
    let mut level: Vec<(String, &Value)> = vec![(String::new(), op)];
    let mut depth = 0;
    while !level.is_empty() {
        let mut next: Vec<(String, &Value)> = Vec::new();
        for (path, value) in level {
            match value {
                Value::String(found) if found.as_str() == text => {
                    return format!("{base}{path}");
                }
                Value::Array(items) => next.extend(
                    items
                        .iter()
                        .enumerate()
                        .map(|(position, item)| (format!("{path}/{position}"), item)),
                ),
                Value::Object(fields) => next.extend(
                    fields
                        .iter()
                        .filter(|(key, _)| depth > 0 || key.as_str() != "op")
                        .map(|(key, item)| (format!("{path}/{}", escape(key)), item)),
                ),
                _ => {}
            }
        }
        level = next;
        depth += 1;
    }
    base
}

/// Un nome come segmento di puntatore JSON (RFC 6901).
fn escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// Un'operazione che la forma accetta ma serde non legge dà la sua posizione,
    /// e il rapporto dice la frase fissa, non il motivo di serde.
    #[test]
    fn un_errore_di_serde_non_esce_nel_rapporto() {
        let list = vec![
            json!({"op": "move", "ids": ["a"], "dx": 0, "dy": 0}),
            json!({"op": "move", "ids": ["a"]}),
        ];
        assert_eq!(read_ops(&list), Err(1));
        let problem = Problem::unread(1);
        assert_eq!(problem.code, Code::Invalid);
        assert_eq!(problem.index, Some(1));
        assert_eq!(problem.path, "/1");
        assert_eq!(problem.message, "the operation does not match its schema");
    }
}
