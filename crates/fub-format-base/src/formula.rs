//! Valutatore di formule limitato per `.base`: parser e interprete puri,
//! senza `eval`, con budget su passi/profondità e cicli rilevati dal chiamante
//! (grafo delle dipendenze fra formule, errore tipizzato sui cicli).
//!
//! Tipi: numeri (f64), stringhe, booleani, date/durate (millisecondi interi),
//! liste, oggetti piatti, file/link come record `{ path, label }`.
//! Namespace: `prop.<nome>` (proprietà della nota), `file.<campo>`
//! (metadati del file), `container.<campo>` (metadati del documento ospite),
//! `formula.<nome>` (altre formule della stessa base).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod args;
mod eval;
mod methods;
mod parse;

#[cfg(test)]
use args::civil_from_days;
use args::{
    aggregate_numbers, date_arg, eval_contains, eval_contains_all, eval_contains_any, eval_slice,
    format_date, link_target, list_arg, number_arg, parse_duration_ms, parse_iso_date_ms,
    relative_time, sort_key, start_of_day_ms, string_arg, tag_names,
};
use eval::{eval, function_arity, truthy};
use methods::{
    budgeted_join, budgeted_replace, budgeted_split, eval_date_field, eval_duration_field,
    eval_list_method, eval_text_method, parse_date_value, parse_duration_value, to_number,
};
use parse::Parser;

/// Limiti del valutatore (congelati con la matrice delle funzioni).
pub const MAX_FORMULA_BYTES: usize = 8 * 1024;
pub const MAX_FORMULA_DEPTH: usize = 32;
pub const MAX_FORMULA_STEPS: u64 = 50_000;
/// Quanti livelli il **parser** apre uno dentro l'altro: parentesi, segni,
/// anelli di una catena di operatori, campi, liste e argomenti contano uno
/// ciascuno. Non è un secondo limite semantico — quello resta
/// [`MAX_FORMULA_DEPTH`], che il valutatore applica — ma il tetto della
/// discesa ricorsiva: prima `((((…))))` in 8 KiB scendeva di una decina di
/// frame per parentesi ed esauriva lo stack prima di arrivare al valutatore.
/// È largo abbastanza da non rifiutare niente che il valutatore accetti.
const MAX_PARSE_DEPTH: usize = 4 * MAX_FORMULA_DEPTH;
/// Tetti sugli intermedi PRIMA di concat/allocazione (non solo JSON finale).
pub const MAX_TEXT_BYTES: usize = 256 * 1024;
pub const MAX_TEXT_LIST_ITEMS: usize = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormulaErrorCode {
    Parse,
    Name,
    Value,
    DivZero,
    Cycle,
    Budget,
}

impl FormulaErrorCode {
    pub fn display(self) -> &'static str {
        match self {
            Self::Parse => "#PARSE!",
            Self::Name => "#NAME?",
            Self::Value => "#VALUE!",
            Self::DivZero => "#DIV/0!",
            Self::Cycle => "#CYCLE!",
            Self::Budget => "#BUDGET!",
        }
    }
}

#[derive(Debug, Error)]
pub enum EvalError {
    #[error("formula: {0}")]
    Parse(String),
    #[error("nome sconosciuto: {0}")]
    Name(String),
    #[error("tipo non valido: {0}")]
    Value(String),
    #[error("divisione per zero")]
    DivZero,
    #[error("ciclo fra formule: {0}")]
    Cycle(String),
    #[error("budget formule esaurito")]
    Budget,
}

impl EvalError {
    pub fn code(&self) -> FormulaErrorCode {
        match self {
            Self::Parse(_) => FormulaErrorCode::Parse,
            Self::Name(_) => FormulaErrorCode::Name,
            Self::Value(_) => FormulaErrorCode::Value,
            Self::DivZero => FormulaErrorCode::DivZero,
            Self::Cycle(_) => FormulaErrorCode::Cycle,
            Self::Budget => FormulaErrorCode::Budget,
        }
    }
}

/// Valore di una formula (seriale sul confine custom).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum BaseValue {
    Empty,
    Number(f64),
    Text(String),
    Bool(bool),
    /// Millisecondi interi (date come epoch-ms, durate come ms).
    Date(i64),
    Duration(i64),
    List(Vec<BaseValue>),
    Object(BTreeMap<String, BaseValue>),
    /// File/link: record piatto, mai navigazione implicita.
    File {
        path: String,
        label: Option<String>,
    },
    Link {
        target: String,
        label: Option<String>,
    },
    Error(FormulaErrorCode),
}

impl BaseValue {
    pub fn display(&self) -> String {
        self.display_capped(MAX_TEXT_BYTES)
    }

    /// Display con tetto: oltre il limite, errore di budget a chi chiama
    /// (nessuna stringa gigante materializzata per sbaglio).
    fn display_capped(&self, cap: usize) -> String {
        match self {
            Self::Empty => String::new(),
            Self::Number(n) => {
                if n.fract() == 0.0 && n.is_finite() {
                    format!("{}", *n as i64)
                } else {
                    format!("{n}")
                }
            }
            Self::Text(s) => s.clone(),
            Self::Bool(true) => "true".to_string(),
            Self::Bool(false) => "false".to_string(),
            Self::Date(ms) => format!("{ms}"),
            Self::Duration(ms) => format!("{ms}"),
            Self::List(items) => {
                let mut out = String::new();
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push_str(", ");
                    }
                    out.push_str(&item.display_capped(cap.saturating_sub(out.len())));
                    if out.len() > cap {
                        out.truncate(cap);
                        break;
                    }
                }
                out
            }
            Self::Object(map) => serde_json::to_string(map).unwrap_or_default(),
            Self::File { path, .. } => path.clone(),
            Self::Link { target, .. } => target.clone(),
            Self::Error(code) => code.display().to_string(),
        }
    }

    pub fn is_empty(&self) -> bool {
        matches!(self, Self::Empty)
            || matches!(self, Self::Text(s) if s.is_empty())
            || matches!(self, Self::List(v) if v.is_empty())
    }

    fn type_name(&self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Number(_) => "number",
            Self::Text(_) => "string",
            Self::Bool(_) => "bool",
            Self::Date(_) => "date",
            Self::Duration(_) => "duration",
            Self::List(_) => "list",
            Self::Object(_) => "object",
            Self::File { .. } => "file",
            Self::Link { .. } => "link",
            Self::Error(_) => "error",
        }
    }
}

/// Budget di valutazione (passi): condiviso fra tutte le formule di una riga.
#[derive(Clone, Debug)]
pub struct EvalBudget {
    pub steps_left: u64,
}

impl EvalBudget {
    pub fn new(steps: u64) -> Self {
        Self { steps_left: steps }
    }

    fn step(&mut self) -> Result<(), EvalError> {
        match self.steps_left.checked_sub(1) {
            Some(left) => {
                self.steps_left = left;
                Ok(())
            }
            None => Err(EvalError::Budget),
        }
    }
}

/// Contesto di una riga: proprietà normalizzate, metadati file, formule già
/// valutate (il chiamante risolve l'ordine e i cicli).
#[derive(Clone, Debug, Default)]
pub struct RowContext {
    pub props: BTreeMap<String, BaseValue>,
    pub file: BTreeMap<String, BaseValue>,
    /// Metadati del documento che contiene la definizione, non della riga.
    pub container: BTreeMap<String, BaseValue>,
    pub formulas: BTreeMap<String, BaseValue>,
    /// Millisecondi epoch "adesso" (iniettati dall'host, mai orologio qui).
    pub now_ms: i64,
}

/// AST della formula (non seriale: resta nel formato, al confine solo testo).
#[derive(Clone, Debug, PartialEq)]
pub enum FormulaAst {
    Number(f64),
    Text(String),
    Bool(bool),
    Empty,
    Ref(FormulaRef),
    Unary(UnaryOp, Box<FormulaAst>),
    Binary(BinaryOp, Box<FormulaAst>, Box<FormulaAst>),
    Call(String, Vec<FormulaAst>),
    Field(Box<FormulaAst>, String),
    List(Vec<FormulaAst>),
}

#[derive(Clone, Debug, PartialEq)]
pub enum FormulaRef {
    Prop(String),
    Container(String),
    File(String),
    Formula(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnaryOp {
    Plus,
    Minus,
    Not,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    NotEq,
    Gt,
    Gte,
    Lt,
    Lte,
    And,
    Or,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Formula {
    pub source: String,
    pub ast: FormulaAst,
    /// Nomi `formula.<x>` referenziati (per il rilevamento cicli del chiamante).
    pub dependencies: Vec<String>,
    /// Chiavi `prop.<x>` / nude referenziate (per pianificare la select).
    pub prop_deps: Vec<String>,
    /// Chiavi `file.<x>` referenziate (sintetizzate dal client, mai in select).
    pub file_deps: Vec<String>,
    /// Chiavi `container.<x>` referenziate (metadati del documento ospite).
    pub container_deps: Vec<String>,
}

impl Formula {
    pub fn parse(source: &str) -> Result<Self, EvalError> {
        if source.len() > MAX_FORMULA_BYTES {
            return Err(EvalError::Parse("formula troppo lunga".to_string()));
        }
        let mut parser = Parser::new(source);
        let ast = parser.parse_expr().map_err(EvalError::Parse)?;
        let mut dependencies = Vec::new();
        collect_formula_deps(&ast, &mut dependencies);
        dependencies.sort();
        dependencies.dedup();
        let mut prop_deps = Vec::new();
        let mut file_deps = Vec::new();
        let mut container_deps = Vec::new();
        collect_prop_file_deps(&ast, &mut prop_deps, &mut file_deps, &mut container_deps);
        prop_deps.sort();
        prop_deps.dedup();
        file_deps.sort();
        file_deps.dedup();
        container_deps.sort();
        container_deps.dedup();
        Ok(Self {
            source: source.to_string(),
            ast,
            dependencies,
            prop_deps,
            file_deps,
            container_deps,
        })
    }

    pub fn evaluate(&self, ctx: &RowContext, budget: &mut EvalBudget) -> BaseValue {
        match eval(&self.ast, ctx, budget, 0) {
            Ok(value) => value,
            Err(error) => BaseValue::Error(error.code()),
        }
    }
}

fn collect_formula_deps(ast: &FormulaAst, out: &mut Vec<String>) {
    match ast {
        FormulaAst::Ref(FormulaRef::Formula(name)) => out.push(name.clone()),
        FormulaAst::Unary(_, inner) => collect_formula_deps(inner, out),
        FormulaAst::Binary(_, l, r) => {
            collect_formula_deps(l, out);
            collect_formula_deps(r, out);
        }
        FormulaAst::Call(_, args) => {
            for arg in args {
                collect_formula_deps(arg, out);
            }
        }
        FormulaAst::Field(base, _) => collect_formula_deps(base, out),
        FormulaAst::List(items) => {
            for item in items {
                collect_formula_deps(item, out);
            }
        }
        _ => {}
    }
}

/// Chiavi `prop` (nude o `prop.<x>`) e `file.<x>` referenziate: servono al
/// chiamante per pianificare la select (prop) e sintetizzare i metadati
/// (file), mai per inventare valori.
fn collect_prop_file_deps(
    ast: &FormulaAst,
    props: &mut Vec<String>,
    files: &mut Vec<String>,
    containers: &mut Vec<String>,
) {
    match ast {
        FormulaAst::Ref(FormulaRef::Prop(name)) => props.push(name.clone()),
        FormulaAst::Ref(FormulaRef::File(name)) => files.push(name.clone()),
        FormulaAst::Ref(FormulaRef::Container(name)) => containers.push(name.clone()),
        FormulaAst::Unary(_, inner) => collect_prop_file_deps(inner, props, files, containers),
        FormulaAst::Binary(_, l, r) => {
            collect_prop_file_deps(l, props, files, containers);
            collect_prop_file_deps(r, props, files, containers);
        }
        FormulaAst::Call(_, args) => {
            for arg in args {
                collect_prop_file_deps(arg, props, files, containers);
            }
        }
        FormulaAst::Field(base, _) => collect_prop_file_deps(base, props, files, containers),
        FormulaAst::List(items) => {
            for item in items {
                collect_prop_file_deps(item, props, files, containers);
            }
        }
        _ => {}
    }
}

fn call_known(name: &str, args: Vec<BaseValue>, ctx: &RowContext) -> Result<BaseValue, EvalError> {
    match name {
        "if" => {
            let cond = truthy(&args[0]);
            Ok(if cond {
                args[1].clone()
            } else {
                args[2].clone()
            })
        }
        "number" => to_number(&args[0]),
        "text" | "string" => Ok(BaseValue::Text(args[0].display())),
        "bool" => Ok(BaseValue::Bool(truthy(&args[0]))),
        "date" => parse_date_value(&args[0]),
        "duration" => parse_duration_value(&args[0]),
        "title" => Ok(BaseValue::Text(title_case(&string_arg(&args[0], name)?))),
        "repeat" => {
            let text = string_arg(&args[0], name)?;
            let times = number_arg(&args[1], name)?;
            if !(0.0..=MAX_TEXT_BYTES as f64).contains(&times) {
                return Err(EvalError::Value("repeat fuori misura".to_string()));
            }
            let times = times as usize;
            if text.len().saturating_mul(times) > MAX_TEXT_BYTES {
                return Err(EvalError::Value("stringa oltre il limite".to_string()));
            }
            Ok(BaseValue::Text(text.repeat(times)))
        }
        "matches" => {
            let text = string_arg(&args[0], name)?;
            let pattern = string_arg(&args[1], name)?;
            // Il motore `regex` non fa backtracking: il costo è lineare nel
            // testo, e la dimensione del programma ha un tetto.
            let regex = regex::RegexBuilder::new(&pattern)
                .size_limit(1 << 20)
                .build()
                .map_err(|e| EvalError::Value(format!("espressione regolare: {e}")))?;
            Ok(BaseValue::Bool(regex.is_match(&text)))
        }
        "escapeHTML" | "escape_html" => {
            let out = fub_abi::html::escape(&string_arg(&args[0], name)?);
            if out.len() > MAX_TEXT_BYTES {
                return Err(EvalError::Value("stringa oltre il limite".to_string()));
            }
            Ok(BaseValue::Text(out))
        }
        "toFixed" | "to_fixed" => {
            let value = number_arg(&args[0], name)?;
            let digits = number_arg(&args[1], name)?;
            if !(0.0..=20.0).contains(&digits) || digits.fract() != 0.0 {
                return Err(EvalError::Value("toFixed vuole 0..20 cifre".to_string()));
            }
            Ok(BaseValue::Text(format!("{value:.*}", digits as usize)))
        }
        "format" => {
            let ms = date_arg(&args[0], name)?;
            Ok(BaseValue::Text(format_date(
                ms,
                &string_arg(&args[1], name)?,
            )))
        }
        "time" => Ok(BaseValue::Text(format_date(
            date_arg(&args[0], name)?,
            "HH:mm:ss",
        ))),
        "relative" => Ok(BaseValue::Text(relative_time(
            date_arg(&args[0], name)?,
            ctx.now_ms,
        ))),
        "hasTag" | "has_tag" => {
            let tags = tag_names(&args[0]);
            let wanted = args[1..]
                .iter()
                .map(|v| string_arg(v, name))
                .collect::<Result<Vec<_>, _>>()?;
            // Un tag cercato nomina anche i suoi discendenti: `a` trova `a/b`.
            Ok(BaseValue::Bool(wanted.iter().any(|want| {
                let want = want.trim_start_matches('#');
                tags.iter()
                    .any(|tag| tag == want || tag.starts_with(&format!("{want}/")))
            })))
        }
        "hasProperty" | "has_property" => {
            let key = string_arg(&args[0], name)?;
            Ok(BaseValue::Bool(
                ctx.props
                    .get(&key)
                    .is_some_and(|v| !matches!(v, BaseValue::Empty)),
            ))
        }
        "hasLink" | "has_link" | "linksTo" | "links_to" => {
            let wanted = link_target(&args[1]);
            let found = match &args[0] {
                BaseValue::List(items) => items.iter().any(|item| link_target(item) == wanted),
                single => link_target(single) == wanted,
            };
            Ok(BaseValue::Bool(found))
        }
        "inFolder" | "in_folder" => {
            let path = match &args[0] {
                BaseValue::File { path, .. } => path.clone(),
                BaseValue::Link { target, .. } => target.clone(),
                other => string_arg(other, name)?,
            };
            let folder = string_arg(&args[1], name)?;
            let folder = folder.trim_matches('/');
            Ok(BaseValue::Bool(
                folder.is_empty() || path.starts_with(&format!("{folder}/")),
            ))
        }
        "asLink" | "as_link" => {
            let target = match &args[0] {
                BaseValue::File { path, .. } => path.clone(),
                BaseValue::Link { target, .. } => target.clone(),
                other => string_arg(other, name)?,
            };
            let label = if args.len() > 1 {
                Some(string_arg(&args[1], name)?)
            } else {
                None
            };
            Ok(BaseValue::Link { target, label })
        }
        "asFile" | "as_file" => {
            let path = match &args[0] {
                BaseValue::File { path, .. } => path.clone(),
                BaseValue::Link { target, .. } => target.clone(),
                other => string_arg(other, name)?,
            };
            Ok(BaseValue::File { path, label: None })
        }
        "link" => {
            let target = string_arg(&args[0], name)?;
            let label = if args.len() > 1 {
                Some(string_arg(&args[1], name)?)
            } else {
                None
            };
            Ok(BaseValue::Link { target, label })
        }
        "file" => {
            let path = string_arg(&args[0], name)?;
            Ok(BaseValue::File { path, label: None })
        }
        "list" => match &args[0] {
            BaseValue::List(v) => Ok(BaseValue::List(v.clone())),
            BaseValue::Empty => Ok(BaseValue::List(Vec::new())),
            other => Ok(BaseValue::List(vec![other.clone()])),
        },
        "folder" => {
            let path = match &args[0] {
                BaseValue::File { path, .. } => path.as_str(),
                BaseValue::Link { target, .. } => target.as_str(),
                BaseValue::Text(path) => path.as_str(),
                other => return Err(EvalError::Value(format!("folder su {}", other.type_name()))),
            };
            Ok(BaseValue::Text(
                path.rsplit_once('/')
                    .map(|(folder, _)| folder)
                    .unwrap_or("")
                    .to_string(),
            ))
        }
        "tags" => match &args[0] {
            BaseValue::List(items) if items.len() <= MAX_TEXT_LIST_ITEMS => {
                Ok(BaseValue::List(items.clone()))
            }
            BaseValue::List(_) => Err(EvalError::Budget),
            BaseValue::Text(text) => {
                if text
                    .bytes()
                    .filter(|byte| *byte == b',')
                    .take(MAX_TEXT_LIST_ITEMS)
                    .count()
                    >= MAX_TEXT_LIST_ITEMS
                {
                    return Err(EvalError::Budget);
                }
                let items = text
                    .split(',')
                    .map(|tag| BaseValue::Text(tag.trim().to_string()))
                    .collect::<Vec<_>>();
                Ok(BaseValue::List(items))
            }
            BaseValue::Empty => Ok(BaseValue::List(Vec::new())),
            other => Err(EvalError::Value(format!("tags su {}", other.type_name()))),
        },
        "object" => {
            if !args.len().is_multiple_of(2) {
                return Err(EvalError::Value("object vuole coppie chiave/valore".into()));
            }
            let mut out = BTreeMap::new();
            for pair in args.chunks_exact(2) {
                let key = string_arg(&pair[0], name)?;
                if key.len() > MAX_TEXT_BYTES {
                    return Err(EvalError::Budget);
                }
                out.insert(key, pair[1].clone());
            }
            Ok(BaseValue::Object(out))
        }
        "keys" | "values" => match &args[0] {
            BaseValue::Object(map) if map.len() <= MAX_TEXT_LIST_ITEMS => {
                Ok(BaseValue::List(if name == "keys" {
                    map.keys().cloned().map(BaseValue::Text).collect()
                } else {
                    map.values().cloned().collect()
                }))
            }
            BaseValue::Object(_) => Err(EvalError::Budget),
            other => Err(EvalError::Value(format!("{name} su {}", other.type_name()))),
        },
        "get" | "has" => match &args[0] {
            BaseValue::Object(map) => {
                let key = string_arg(&args[1], name)?;
                Ok(if name == "get" {
                    map.get(&key).cloned().unwrap_or(BaseValue::Empty)
                } else {
                    BaseValue::Bool(map.contains_key(&key))
                })
            }
            other => Err(EvalError::Value(format!("{name} su {}", other.type_name()))),
        },
        "is_empty" | "isEmpty" => Ok(BaseValue::Bool(args[0].is_empty())),
        "is_truthy" | "isTruthy" => Ok(BaseValue::Bool(truthy(&args[0]))),
        "type_of" | "isType" => {
            if args.len() == 1 {
                return Ok(BaseValue::Text(args[0].type_name().to_string()));
            }
            let wanted = string_arg(&args[1], name)?;
            Ok(BaseValue::Bool(args[0].type_name() == wanted))
        }
        "min" | "max" | "sum" | "average" | "avg" => aggregate_numbers(name, args),
        "round" => {
            let n = number_arg(&args[0], name)?;
            let digits = if args.len() > 1 {
                number_arg(&args[1], name)? as i32
            } else {
                0
            };
            let factor = 10f64.powi(digits.clamp(-6, 6));
            Ok(BaseValue::Number((n * factor).round() / factor))
        }
        "floor" => Ok(BaseValue::Number(number_arg(&args[0], name)?.floor())),
        "ceil" => Ok(BaseValue::Number(number_arg(&args[0], name)?.ceil())),
        "abs" => Ok(BaseValue::Number(number_arg(&args[0], name)?.abs())),
        "today" => Ok(BaseValue::Date(start_of_day_ms(ctx.now_ms))),
        "now" => Ok(BaseValue::Date(ctx.now_ms)),
        // Stringhe e liste: primo argomento = ricevente del metodo.
        "lower" => Ok(BaseValue::Text(string_arg(&args[0], name)?.to_lowercase())),
        "upper" => Ok(BaseValue::Text(string_arg(&args[0], name)?.to_uppercase())),
        "trim" => Ok(BaseValue::Text(
            string_arg(&args[0], name)?.trim().to_string(),
        )),
        "length" | "len" => match &args[0] {
            BaseValue::Text(s) => Ok(BaseValue::Number(s.chars().count() as f64)),
            BaseValue::List(v) => Ok(BaseValue::Number(v.len() as f64)),
            BaseValue::Object(m) => Ok(BaseValue::Number(m.len() as f64)),
            BaseValue::Empty => Ok(BaseValue::Number(0.0)),
            other => Err(EvalError::Value(format!("length su {}", other.type_name()))),
        },
        "contains" => eval_contains(&args[0], &args[1]),
        "contains_all" | "containsAll" => eval_contains_all(&args[0], &args[1..]),
        "contains_any" | "containsAny" => eval_contains_any(&args[0], &args[1..]),
        "starts_with" | "startsWith" => Ok(BaseValue::Bool(
            string_arg(&args[0], name)?.starts_with(&string_arg(&args[1], name)?),
        )),
        "ends_with" | "endsWith" => Ok(BaseValue::Bool(
            string_arg(&args[0], name)?.ends_with(&string_arg(&args[1], name)?),
        )),
        "replace" => {
            let haystack = string_arg(&args[0], name)?;
            let needle = string_arg(&args[1], name)?;
            let replacement = string_arg(&args[2], name)?;
            budgeted_replace(&haystack, &needle, &replacement)
        }
        "slice" => eval_slice(&args),
        "split" => budgeted_split(&string_arg(&args[0], name)?, &string_arg(&args[1], name)?),
        "join" => {
            let items = list_arg(&args[0], name)?;
            let sep = if args.len() > 1 {
                string_arg(&args[1], name)?
            } else {
                ", ".to_string()
            };
            budgeted_join(&items, &sep)
        }
        "reverse" => match &args[0] {
            BaseValue::Text(s) => Ok(BaseValue::Text(s.chars().rev().collect())),
            BaseValue::List(v) => Ok(BaseValue::List(v.iter().rev().cloned().collect())),
            other => Err(EvalError::Value(format!(
                "reverse su {}",
                other.type_name()
            ))),
        },
        "unique" | "uniq" => {
            let items = list_arg(&args[0], name)?;
            let mut seen = Vec::new();
            for item in items {
                if !seen.contains(&item) {
                    seen.push(item);
                }
            }
            Ok(BaseValue::List(seen))
        }
        "sort" => {
            let mut items = list_arg(&args[0], name)?;
            items.sort_by_key(sort_key);
            Ok(BaseValue::List(items))
        }
        "flat" => {
            let items = list_arg(&args[0], name)?;
            let mut out = Vec::new();
            for item in items {
                match item {
                    BaseValue::List(inner) => out.extend(inner),
                    other => out.push(other),
                }
            }
            Ok(BaseValue::List(out))
        }
        "first" => match list_arg(&args[0], name)?.into_iter().next() {
            Some(first) => Ok(first),
            None => Ok(BaseValue::Empty),
        },
        "last" => match list_arg(&args[0], name)?.into_iter().last() {
            Some(last) => Ok(last),
            None => Ok(BaseValue::Empty),
        },
        _ => Err(EvalError::Name(format!("funzione sconosciuta `{name}`"))),
    }
}
/// Maiuscola a inizio parola, minuscola nel resto.
fn title_case(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut start = true;
    for c in text.chars() {
        if c.is_alphanumeric() {
            if start {
                out.extend(c.to_uppercase());
            } else {
                out.extend(c.to_lowercase());
            }
            start = false;
        } else {
            out.push(c);
            start = !(c == '\'' || c == '’');
        }
    }
    out
}

#[cfg(test)]
mod tests;
