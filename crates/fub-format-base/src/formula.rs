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

/// Limiti del valutatore (congelati con la matrice delle funzioni).
pub const MAX_FORMULA_BYTES: usize = 8 * 1024;
pub const MAX_FORMULA_DEPTH: usize = 32;
pub const MAX_FORMULA_STEPS: u64 = 50_000;
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

struct Parser<'a> {
    bytes: &'a [u8],
    source: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            bytes: source.as_bytes(),
            source,
            pos: 0,
        }
    }

    fn skip_ws(&mut self) {
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn parse_expr(&mut self) -> Result<FormulaAst, String> {
        self.parse_or()
    }

    fn parse_or(&mut self) -> Result<FormulaAst, String> {
        let mut left = self.parse_and()?;
        loop {
            self.skip_ws();
            if self.eat("||") {
                let right = self.parse_and()?;
                left = FormulaAst::Binary(BinaryOp::Or, Box::new(left), Box::new(right));
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_and(&mut self) -> Result<FormulaAst, String> {
        let mut left = self.parse_equality()?;
        loop {
            self.skip_ws();
            if self.eat("&&") {
                let right = self.parse_equality()?;
                left = FormulaAst::Binary(BinaryOp::And, Box::new(left), Box::new(right));
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_equality(&mut self) -> Result<FormulaAst, String> {
        let mut left = self.parse_comparison()?;
        loop {
            self.skip_ws();
            if self.eat("==") {
                let right = self.parse_comparison()?;
                left = FormulaAst::Binary(BinaryOp::Eq, Box::new(left), Box::new(right));
            } else if self.eat("!=") {
                let right = self.parse_comparison()?;
                left = FormulaAst::Binary(BinaryOp::NotEq, Box::new(left), Box::new(right));
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_comparison(&mut self) -> Result<FormulaAst, String> {
        let mut left = self.parse_add()?;
        loop {
            self.skip_ws();
            if self.eat(">=") {
                let right = self.parse_add()?;
                left = FormulaAst::Binary(BinaryOp::Gte, Box::new(left), Box::new(right));
            } else if self.eat("<=") {
                let right = self.parse_add()?;
                left = FormulaAst::Binary(BinaryOp::Lte, Box::new(left), Box::new(right));
            } else if self.eat('>') {
                let right = self.parse_add()?;
                left = FormulaAst::Binary(BinaryOp::Gt, Box::new(left), Box::new(right));
            } else if self.eat('<') {
                let right = self.parse_add()?;
                left = FormulaAst::Binary(BinaryOp::Lt, Box::new(left), Box::new(right));
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_add(&mut self) -> Result<FormulaAst, String> {
        let mut left = self.parse_mul()?;
        loop {
            self.skip_ws();
            if self.eat('+') {
                let right = self.parse_mul()?;
                left = FormulaAst::Binary(BinaryOp::Add, Box::new(left), Box::new(right));
            } else if self.eat('-') {
                let right = self.parse_mul()?;
                left = FormulaAst::Binary(BinaryOp::Sub, Box::new(left), Box::new(right));
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_mul(&mut self) -> Result<FormulaAst, String> {
        let mut left = self.parse_unary()?;
        loop {
            self.skip_ws();
            if self.eat('*') {
                let right = self.parse_unary()?;
                left = FormulaAst::Binary(BinaryOp::Mul, Box::new(left), Box::new(right));
            } else if self.eat('/') {
                let right = self.parse_unary()?;
                left = FormulaAst::Binary(BinaryOp::Div, Box::new(left), Box::new(right));
            } else if self.eat('%') {
                let right = self.parse_unary()?;
                left = FormulaAst::Binary(BinaryOp::Mod, Box::new(left), Box::new(right));
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_unary(&mut self) -> Result<FormulaAst, String> {
        self.skip_ws();
        if self.eat('-') {
            return Ok(FormulaAst::Unary(
                UnaryOp::Minus,
                Box::new(self.parse_unary()?),
            ));
        }
        if self.eat('+') {
            return Ok(FormulaAst::Unary(
                UnaryOp::Plus,
                Box::new(self.parse_unary()?),
            ));
        }
        if self.eat('!') {
            // `!=` è già stato consumato sopra; qui `!` è negazione.
            return Ok(FormulaAst::Unary(
                UnaryOp::Not,
                Box::new(self.parse_unary()?),
            ));
        }
        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> Result<FormulaAst, String> {
        let mut node = self.parse_primary()?;
        loop {
            self.skip_ws();
            if self.eat('.') {
                let field = self.parse_ident()?;
                // Chiamata metodo `x.f(...)`: zucchero per `f(x, ...)`.
                self.skip_ws();
                if self.eat('(') {
                    let mut args = vec![node];
                    args.extend(self.parse_args()?);
                    node = FormulaAst::Call(field, args);
                } else {
                    node = FormulaAst::Field(Box::new(node), field);
                }
            } else {
                return Ok(node);
            }
        }
    }

    fn parse_primary(&mut self) -> Result<FormulaAst, String> {
        self.skip_ws();
        if self.eat('(') {
            let inner = self.parse_expr()?;
            self.skip_ws();
            if !self.eat(')') {
                return Err("`)` attesa".to_string());
            }
            return Ok(inner);
        }
        if self.eat('[') {
            let mut items = Vec::new();
            self.skip_ws();
            if self.eat(']') {
                return Ok(FormulaAst::List(items));
            }
            loop {
                items.push(self.parse_expr()?);
                self.skip_ws();
                if self.eat(',') {
                    continue;
                }
                if self.eat(']') {
                    return Ok(FormulaAst::List(items));
                }
                return Err("`,` o `]` attesi in lista".to_string());
            }
        }
        if let Some(text) = self.parse_string()? {
            return Ok(FormulaAst::Text(text));
        }
        if let Some(number) = self.parse_number() {
            return Ok(FormulaAst::Number(number));
        }
        if self.eat_keyword("true") {
            return Ok(FormulaAst::Bool(true));
        }
        if self.eat_keyword("false") {
            return Ok(FormulaAst::Bool(false));
        }
        if self.eat_keyword("empty") {
            return Ok(FormulaAst::Empty);
        }
        // Identificatore: namespaceeref (`prop.x`), chiamata o errore nome.
        let ident = self.parse_ident()?;
        self.skip_ws();
        if self.eat('(') {
            let args = self.parse_args()?;
            return Ok(FormulaAst::Call(ident, args));
        }
        if matches!(ident.as_str(), "prop" | "file" | "container" | "formula") {
            self.skip_ws();
            if !self.eat('.') {
                return Err(format!("`{ident}.<nome>` atteso"));
            }
            let name = self.parse_ident()?;
            let reference = match ident.as_str() {
                "prop" => FormulaRef::Prop(name),
                "file" => FormulaRef::File(name),
                "container" => FormulaRef::Container(name),
                "formula" => FormulaRef::Formula(name),
                _ => unreachable!(),
            };
            return Ok(FormulaAst::Ref(reference));
        }
        // Nome nudo: scorciatoia per `prop.<nome>` (come nelle basi: `status`).
        if is_bare_name(&ident) {
            return Ok(FormulaAst::Ref(FormulaRef::Prop(ident)));
        }
        Err(format!("nome sconosciuto `{ident}`"))
    }

    fn parse_args(&mut self) -> Result<Vec<FormulaAst>, String> {
        let mut args = Vec::new();
        self.skip_ws();
        if self.eat(')') {
            return Ok(args);
        }
        loop {
            args.push(self.parse_expr()?);
            self.skip_ws();
            if self.eat(',') {
                continue;
            }
            if self.eat(')') {
                return Ok(args);
            }
            return Err("`,` o `)` attesi in chiamata".to_string());
        }
    }

    fn parse_ident(&mut self) -> Result<String, String> {
        self.skip_ws();
        let start = self.pos;
        while self.pos < self.bytes.len()
            && (self.bytes[self.pos].is_ascii_alphanumeric() || self.bytes[self.pos] == b'_')
        {
            self.pos += 1;
        }
        if start == self.pos {
            return Err("identificatore atteso".to_string());
        }
        Ok(self.source[start..self.pos].to_string())
    }

    fn parse_string(&mut self) -> Result<Option<String>, String> {
        self.skip_ws();
        let quote = match self.bytes.get(self.pos) {
            Some(b'"') => b'"',
            Some(b'\'') => b'\'',
            _ => return Ok(None),
        };
        self.pos += 1;
        let mut out = String::new();
        while let Some(&b) = self.bytes.get(self.pos) {
            if b == quote {
                self.pos += 1;
                return Ok(Some(out));
            }
            if b == b'\\' {
                self.pos += 1;
                match self.bytes.get(self.pos) {
                    Some(b'n') => out.push('\n'),
                    Some(b't') => out.push('\t'),
                    Some(b'\\') => out.push('\\'),
                    Some(b'"') => out.push('"'),
                    Some(b'\'') => out.push('\''),
                    Some(other) => {
                        return Err(format!("escape non valido `\\{}`", *other as char));
                    }
                    None => return Err("stringa non chiusa".to_string()),
                }
                self.pos += 1;
            } else {
                let ch_start = self.pos;
                let ch = self.source[ch_start..]
                    .chars()
                    .next()
                    .ok_or_else(|| "stringa non chiusa".to_string())?;
                out.push(ch);
                self.pos += ch.len_utf8();
            }
        }
        Err("stringa non chiusa".to_string())
    }

    fn parse_number(&mut self) -> Option<f64> {
        self.skip_ws();
        let start = self.pos;
        let mut seen_digit = false;
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
            self.pos += 1;
            seen_digit = true;
        }
        if self.pos < self.bytes.len() && self.bytes[self.pos] == b'.' {
            // `1.` non è un numero valido qui: serve la parte frazionaria.
            if self.pos + 1 < self.bytes.len() && self.bytes[self.pos + 1].is_ascii_digit() {
                self.pos += 1;
                while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
                    self.pos += 1;
                    seen_digit = true;
                }
            }
        }
        if !seen_digit {
            self.pos = start;
            return None;
        }
        // Non consumare un identificatore che inizia con cifre (`123abc`).
        if self.pos < self.bytes.len()
            && (self.bytes[self.pos].is_ascii_alphabetic() || self.bytes[self.pos] == b'_')
        {
            self.pos = start;
            return None;
        }
        self.source[start..self.pos].parse::<f64>().ok()
    }

    fn eat_keyword(&mut self, word: &str) -> bool {
        self.skip_ws();
        let end = self.pos + word.len();
        if self.source.get(self.pos..end) != Some(word) {
            return false;
        }
        // Confine di parola: `truex` non è `true`.
        if let Some(&b) = self.bytes.get(end) {
            if b.is_ascii_alphanumeric() || b == b'_' {
                return false;
            }
        }
        self.pos = end;
        true
    }

    fn eat(&mut self, pat: impl EatPattern) -> bool {
        pat.eat(self)
    }
}

trait EatPattern {
    fn eat(self, parser: &mut Parser<'_>) -> bool;
}

impl EatPattern for char {
    fn eat(self, parser: &mut Parser<'_>) -> bool {
        if parser.bytes.get(parser.pos) == Some(&(self as u8)) {
            parser.pos += 1;
            true
        } else {
            false
        }
    }
}

impl EatPattern for &str {
    fn eat(self, parser: &mut Parser<'_>) -> bool {
        if parser.source.get(parser.pos..parser.pos + self.len()) == Some(self) {
            parser.pos += self.len();
            true
        } else {
            false
        }
    }
}

fn is_bare_name(ident: &str) -> bool {
    !ident.is_empty()
        && ident
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        && !matches!(ident, "true" | "false" | "empty")
}

fn eval(
    ast: &FormulaAst,
    ctx: &RowContext,
    budget: &mut EvalBudget,
    depth: usize,
) -> Result<BaseValue, EvalError> {
    if depth > MAX_FORMULA_DEPTH {
        return Err(EvalError::Parse("annidamento eccessivo".to_string()));
    }
    budget.step()?;
    match ast {
        FormulaAst::Number(n) => Ok(BaseValue::Number(*n)),
        FormulaAst::Text(s) => Ok(BaseValue::Text(s.clone())),
        FormulaAst::Bool(b) => Ok(BaseValue::Bool(*b)),
        FormulaAst::Empty => Ok(BaseValue::Empty),
        FormulaAst::Ref(reference) => Ok(resolve_ref(reference, ctx)),
        FormulaAst::Unary(op, inner) => {
            let value = eval(inner, ctx, budget, depth + 1)?;
            eval_unary(*op, value)
        }
        FormulaAst::Binary(op, left, right) => {
            // `and`/`or` con cortocircuito; il resto valuta entrambi i rami.
            match op {
                BinaryOp::And => {
                    let l = eval(left, ctx, budget, depth + 1)?;
                    if !truthy(&l) {
                        return Ok(BaseValue::Bool(false));
                    }
                    let r = eval(right, ctx, budget, depth + 1)?;
                    Ok(BaseValue::Bool(truthy(&r)))
                }
                BinaryOp::Or => {
                    let l = eval(left, ctx, budget, depth + 1)?;
                    if truthy(&l) {
                        return Ok(BaseValue::Bool(true));
                    }
                    let r = eval(right, ctx, budget, depth + 1)?;
                    Ok(BaseValue::Bool(truthy(&r)))
                }
                _ => {
                    let l = eval(left, ctx, budget, depth + 1)?;
                    let r = eval(right, ctx, budget, depth + 1)?;
                    eval_binary(*op, l, r)
                }
            }
        }
        FormulaAst::Call(name, args) => eval_call(name, args, ctx, budget, depth),
        FormulaAst::Field(base, field) => {
            let value = eval(base, ctx, budget, depth + 1)?;
            eval_field(&value, field)
        }
        FormulaAst::List(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(eval(item, ctx, budget, depth + 1)?);
            }
            Ok(BaseValue::List(out))
        }
    }
}

fn resolve_ref(reference: &FormulaRef, ctx: &RowContext) -> BaseValue {
    match reference {
        FormulaRef::Prop(name) => ctx.props.get(name).cloned().unwrap_or(BaseValue::Empty),
        FormulaRef::File(name) => ctx.file.get(name).cloned().unwrap_or(BaseValue::Empty),
        FormulaRef::Container(name) => ctx.container.get(name).cloned().unwrap_or(BaseValue::Empty),
        FormulaRef::Formula(name) => ctx.formulas.get(name).cloned().unwrap_or(BaseValue::Empty),
    }
}

fn truthy(value: &BaseValue) -> bool {
    match value {
        BaseValue::Empty => false,
        BaseValue::Bool(b) => *b,
        BaseValue::Number(n) => *n != 0.0,
        BaseValue::Text(s) => !s.is_empty(),
        BaseValue::Date(_) | BaseValue::Duration(_) => true,
        BaseValue::List(v) => !v.is_empty(),
        BaseValue::Object(m) => !m.is_empty(),
        BaseValue::File { .. } | BaseValue::Link { .. } => true,
        BaseValue::Error(_) => false,
    }
}

fn eval_unary(op: UnaryOp, value: BaseValue) -> Result<BaseValue, EvalError> {
    match op {
        UnaryOp::Plus => match value {
            BaseValue::Number(n) => Ok(BaseValue::Number(n)),
            other => Err(EvalError::Value(format!("+ su {}", other.type_name()))),
        },
        UnaryOp::Minus => match value {
            BaseValue::Number(n) => Ok(BaseValue::Number(-n)),
            other => Err(EvalError::Value(format!("- su {}", other.type_name()))),
        },
        UnaryOp::Not => Ok(BaseValue::Bool(!truthy(&value))),
    }
}

fn eval_binary(op: BinaryOp, left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    // Errori in ingresso: si propagano (nessun valore finto).
    if let BaseValue::Error(code) = left {
        return Ok(BaseValue::Error(code));
    }
    if let BaseValue::Error(code) = right {
        return Ok(BaseValue::Error(code));
    }
    match op {
        BinaryOp::Add => add_values(left, right),
        BinaryOp::Sub => sub_values(left, right),
        BinaryOp::Mul => mul_values(left, right),
        BinaryOp::Div => div_values(left, right),
        BinaryOp::Mod => mod_values(left, right),
        BinaryOp::Eq => Ok(BaseValue::Bool(values_equal(&left, &right))),
        BinaryOp::NotEq => Ok(BaseValue::Bool(!values_equal(&left, &right))),
        BinaryOp::Gt | BinaryOp::Gte | BinaryOp::Lt | BinaryOp::Lte => {
            compare_values(op, left, right)
        }
        BinaryOp::And | BinaryOp::Or => unreachable!("cortocircuito sopra"),
    }
}

fn add_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a + b)),
        (BaseValue::Text(a), BaseValue::Text(b)) => concat_text(&a, &b),
        (BaseValue::Text(a), b) => concat_text(&a, &b.display()),
        (a, BaseValue::Text(b)) => concat_text(&a.display(), &b),
        (BaseValue::Date(ms), BaseValue::Duration(d))
        | (BaseValue::Duration(d), BaseValue::Date(ms)) => {
            Ok(BaseValue::Date(ms.saturating_add(d)))
        }
        (BaseValue::Duration(a), BaseValue::Duration(b)) => {
            Ok(BaseValue::Duration(a.saturating_add(b)))
        }
        (BaseValue::List(mut a), BaseValue::List(b)) => {
            if a.len().saturating_add(b.len()) > MAX_TEXT_LIST_ITEMS {
                return Err(EvalError::Value("lista oltre il limite".to_string()));
            }
            a.extend(b);
            Ok(BaseValue::List(a))
        }
        (a, b) => Err(EvalError::Value(format!(
            "+ fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

/// Concat di stringhe con tetto PRIMA dell'allocazione (Main: nessun controllo
/// solo sul JSON finale).
fn concat_text(left: &str, right: &str) -> Result<BaseValue, EvalError> {
    if left.len().saturating_add(right.len()) > MAX_TEXT_BYTES {
        return Err(EvalError::Value("stringa oltre il limite".to_string()));
    }
    let mut out = String::with_capacity(left.len().saturating_add(right.len()));
    out.push_str(left);
    out.push_str(right);
    Ok(BaseValue::Text(out))
}

fn sub_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a - b)),
        (BaseValue::Date(a), BaseValue::Date(b)) => Ok(BaseValue::Duration(a.saturating_sub(b))),
        (BaseValue::Date(ms), BaseValue::Duration(d)) => Ok(BaseValue::Date(ms.saturating_sub(d))),
        (BaseValue::Duration(a), BaseValue::Duration(b)) => {
            Ok(BaseValue::Duration(a.saturating_sub(b)))
        }
        (a, b) => Err(EvalError::Value(format!(
            "- fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

fn mul_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a * b)),
        (a, b) => Err(EvalError::Value(format!(
            "* fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

fn div_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (_, BaseValue::Number(0.0)) => Err(EvalError::DivZero),
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a / b)),
        (a, b) => Err(EvalError::Value(format!(
            "/ fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

fn mod_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (_, BaseValue::Number(0.0)) => Err(EvalError::DivZero),
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a % b)),
        (a, b) => Err(EvalError::Value(format!(
            "% fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

fn values_equal(left: &BaseValue, right: &BaseValue) -> bool {
    match (left, right) {
        (BaseValue::Empty, BaseValue::Empty) => true,
        (BaseValue::Number(a), BaseValue::Number(b)) => a == b,
        (BaseValue::Text(a), BaseValue::Text(b)) => a == b,
        (BaseValue::Bool(a), BaseValue::Bool(b)) => a == b,
        (BaseValue::Date(a), BaseValue::Date(b)) => a == b,
        (BaseValue::Duration(a), BaseValue::Duration(b)) => a == b,
        (BaseValue::List(a), BaseValue::List(b)) => a == b,
        (BaseValue::Object(a), BaseValue::Object(b)) => a == b,
        (BaseValue::File { path: a, .. }, BaseValue::File { path: b, .. }) => a == b,
        (BaseValue::Link { target: a, .. }, BaseValue::Link { target: b, .. }) => a == b,
        _ => false,
    }
}

fn compare_values(op: BinaryOp, left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    let ordering = match (&left, &right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => a.partial_cmp(b),
        (BaseValue::Text(a), BaseValue::Text(b)) => Some(a.cmp(b)),
        (BaseValue::Bool(a), BaseValue::Bool(b)) => Some(a.cmp(b)),
        (BaseValue::Date(a), BaseValue::Date(b)) => Some(a.cmp(b)),
        (BaseValue::Duration(a), BaseValue::Duration(b)) => Some(a.cmp(b)),
        _ => None,
    };
    let Some(ordering) = ordering else {
        return Err(EvalError::Value(format!(
            "confronto fra {} e {}",
            left.type_name(),
            right.type_name()
        )));
    };
    let result = match op {
        BinaryOp::Gt => ordering == std::cmp::Ordering::Greater,
        BinaryOp::Gte => ordering != std::cmp::Ordering::Less,
        BinaryOp::Lt => ordering == std::cmp::Ordering::Less,
        BinaryOp::Lte => ordering != std::cmp::Ordering::Greater,
        _ => unreachable!(),
    };
    Ok(BaseValue::Bool(result))
}

fn eval_field(value: &BaseValue, field: &str) -> Result<BaseValue, EvalError> {
    match value {
        BaseValue::Object(map) => Ok(map.get(field).cloned().unwrap_or(BaseValue::Empty)),
        BaseValue::File { path, label } => match field {
            "path" => Ok(BaseValue::Text(path.clone())),
            "label" | "name" => Ok(label
                .clone()
                .map(BaseValue::Text)
                .unwrap_or(BaseValue::Empty)),
            _ => Err(EvalError::Name(format!("campo file.{field} sconosciuto"))),
        },
        BaseValue::Link { target, label } => match field {
            "target" | "path" => Ok(BaseValue::Text(target.clone())),
            "label" => Ok(label
                .clone()
                .map(BaseValue::Text)
                .unwrap_or(BaseValue::Empty)),
            _ => Err(EvalError::Name(format!("campo link.{field} sconosciuto"))),
        },
        BaseValue::Text(s) => eval_text_method(s, field, &[]),
        BaseValue::List(items) => eval_list_method(items, field, &[]),
        BaseValue::Date(ms) => eval_date_field(*ms, field),
        BaseValue::Duration(ms) => eval_duration_field(*ms, field),
        other => Err(EvalError::Value(format!(
            "campo .{field} su {}",
            other.type_name()
        ))),
    }
}

/// Matrice delle funzioni supportate (congelata: nome -> (min,max) argomenti).
/// Qualunque nome fuori matrice è `#NAME?`, mai un valore inventato.
fn function_arity(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        // Condizioni e conversioni globali.
        "if" => (3, 3),
        "number" => (1, 1),
        "text" | "string" => (1, 1),
        "bool" => (1, 1),
        "date" => (1, 1),
        "duration" => (1, 1),
        "link" => (1, 2),
        "file" => (1, 1),
        "list" => (1, 1),
        "folder" | "tags" | "keys" | "values" => (1, 1),
        "get" | "has" => (2, 2),
        "object" => (0, 2 * MAX_TEXT_LIST_ITEMS),
        "is_empty" | "isEmpty" => (1, 1),
        "is_truthy" | "isTruthy" => (1, 1),
        "type_of" | "isType" => (1, 2),
        // Numeri globali.
        "min" => (1, usize::MAX),
        "max" => (1, usize::MAX),
        "sum" => (1, usize::MAX),
        "average" | "avg" => (1, usize::MAX),
        "round" => (1, 2),
        "floor" => (1, 1),
        "ceil" => (1, 1),
        "abs" => (1, 1),
        // Date/durate globali.
        "today" => (0, 0),
        "now" => (0, 0),
        // Stringhe: forma funzione e forma metodo condividono l'implementazione.
        "lower" => (1, 1),
        "upper" => (1, 1),
        "trim" => (1, 1),
        "length" | "len" => (1, 1),
        "contains" => (2, 2),
        "contains_all" | "containsAll" => (2, usize::MAX),
        "contains_any" | "containsAny" => (2, usize::MAX),
        "starts_with" | "startsWith" => (2, 2),
        "ends_with" | "endsWith" => (2, 2),
        "replace" => (3, 3),
        "slice" => (2, 3),
        "split" => (2, 2),
        "join" => (1, 2),
        "reverse" => (1, 1),
        // Liste.
        "unique" | "uniq" => (1, 1),
        "sort" => (1, 1),
        "flat" => (1, 1),
        "first" => (1, 1),
        "last" => (1, 1),
        _ => return None,
    })
}

fn eval_call(
    name: &str,
    args: &[FormulaAst],
    ctx: &RowContext,
    budget: &mut EvalBudget,
    depth: usize,
) -> Result<BaseValue, EvalError> {
    let Some((min, max)) = function_arity(name) else {
        return Err(EvalError::Name(format!("funzione sconosciuta `{name}`")));
    };
    // Valuta gli argomenti una volta sola, in ordine.
    let mut values = Vec::with_capacity(args.len());
    for arg in args {
        values.push(eval(arg, ctx, budget, depth + 1)?);
    }
    if values.len() < min || values.len() > max {
        return Err(EvalError::Value(format!(
            "`{name}` vuole {min}..{max} argomenti"
        )));
    }
    // Errori negli argomenti: si propagano (nessun valore finto).
    for value in &values {
        if let BaseValue::Error(code) = value {
            return Ok(BaseValue::Error(*code));
        }
    }
    call_known(name, values, ctx)
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
            if args.len() % 2 != 0 {
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
/// `replace` con tetto PRIMA dell'allocazione: stima conservativa
/// `haystack + occorrenze × replacement`.
fn budgeted_replace(
    haystack: &str,
    needle: &str,
    replacement: &str,
) -> Result<BaseValue, EvalError> {
    if needle.is_empty() {
        return Err(EvalError::Value("replace con pattern vuoto".to_string()));
    }
    let occurrences = haystack.matches(needle).count().min(1_000_000);
    let estimate = haystack
        .len()
        .saturating_add(occurrences.saturating_mul(replacement.len()));
    if estimate > MAX_TEXT_BYTES {
        return Err(EvalError::Value("stringa oltre il limite".to_string()));
    }
    Ok(BaseValue::Text(haystack.replace(needle, replacement)))
}

/// `split` con tetto sul numero di pezzi PRIMA di collezionarli.
fn budgeted_split(haystack: &str, needle: &str) -> Result<BaseValue, EvalError> {
    if needle.is_empty() {
        return Err(EvalError::Value("split con pattern vuoto".to_string()));
    }
    if haystack.matches(needle).count() + 1 > MAX_TEXT_LIST_ITEMS {
        return Err(EvalError::Value("lista oltre il limite".to_string()));
    }
    Ok(BaseValue::List(
        haystack
            .split(needle)
            .map(|s| BaseValue::Text(s.to_string()))
            .collect(),
    ))
}

/// `join` con tetto PRIMA dell'allocazione del risultato.
fn budgeted_join(items: &[BaseValue], sep: &str) -> Result<BaseValue, EvalError> {
    let mut total = sep.len().saturating_mul(items.len().saturating_sub(1));
    for item in items {
        // Stima sui byte del display senza materializzarlo due volte.
        total = total.saturating_add(display_bytes(item));
        if total > MAX_TEXT_BYTES {
            return Err(EvalError::Value("stringa oltre il limite".to_string()));
        }
    }
    Ok(BaseValue::Text(
        items
            .iter()
            .map(BaseValue::display)
            .collect::<Vec<_>>()
            .join(sep),
    ))
}

/// Byte del display senza allocare la stringa intera per la stima.
fn display_bytes(value: &BaseValue) -> usize {
    match value {
        BaseValue::Empty => 0,
        BaseValue::Text(s) => s.len(),
        BaseValue::Number(n) => BaseValue::Number(*n).display().len(),
        BaseValue::Bool(_) => 5,
        BaseValue::Date(_) | BaseValue::Duration(_) => 20,
        BaseValue::List(items) => items
            .iter()
            .map(display_bytes)
            .fold(0, usize::saturating_add)
            .saturating_add(items.len().saturating_mul(2)),
        BaseValue::Object(map) => map.iter().fold(0, |acc, (k, v)| {
            acc.saturating_add(k.len()).saturating_add(display_bytes(v))
        }),
        BaseValue::File { path, label } => path
            .len()
            .saturating_add(label.as_ref().map_or(0, String::len)),
        BaseValue::Link { target, label } => target
            .len()
            .saturating_add(label.as_ref().map_or(0, String::len)),
        BaseValue::Error(_) => 7,
    }
}

fn eval_text_method(text: &str, method: &str, rest: &[BaseValue]) -> Result<BaseValue, EvalError> {
    let base = BaseValue::Text(text.to_string());
    match method {
        "lower" | "upper" | "trim" | "reverse" | "length" | "len" | "isEmpty" | "is_empty" => {
            if !rest.is_empty() {
                return Err(EvalError::Value(format!("troppi argomenti per .{method}")));
            }
            call_known(method, vec![base], &RowContext::default())
        }
        _ => Err(EvalError::Name(format!(
            "metodo stringa sconosciuto .{method}"
        ))),
    }
}

fn eval_list_method(
    items: &[BaseValue],
    method: &str,
    rest: &[BaseValue],
) -> Result<BaseValue, EvalError> {
    let base = BaseValue::List(items.to_vec());
    match method {
        "length" | "len" | "reverse" | "unique" | "uniq" | "sort" | "flat" | "first" | "last"
        | "join" | "isEmpty" | "is_empty" => {
            let mut args = vec![base];
            args.extend(rest.iter().cloned());
            // Arity oltre il limite = errore valore (mai panico).
            match function_arity(method) {
                Some((min, max)) if args.len() >= min && args.len() <= max => {
                    call_known(method, args, &RowContext::default())
                }
                _ => Err(EvalError::Value(format!("argomenti errati per .{method}"))),
            }
        }
        _ => Err(EvalError::Name(format!(
            "metodo lista sconosciuto .{method}"
        ))),
    }
}

fn eval_date_field(ms: i64, field: &str) -> Result<BaseValue, EvalError> {
    // Giorno civile su epoch-ms (UTC): sufficiente per ordinare/raggruppare.
    let days = ms.div_euclid(86_400_000);
    match field {
        "epoch" | "value" => Ok(BaseValue::Number(ms as f64)),
        "day" | "date" => Ok(BaseValue::Date(days * 86_400_000)),
        "isEmpty" | "is_empty" => Ok(BaseValue::Bool(false)),
        _ => Err(EvalError::Name(format!("campo data sconosciuto .{field}"))),
    }
}

fn eval_duration_field(ms: i64, field: &str) -> Result<BaseValue, EvalError> {
    match field {
        "millis" | "value" => Ok(BaseValue::Number(ms as f64)),
        "days" => Ok(BaseValue::Number(ms as f64 / 86_400_000.0)),
        "hours" => Ok(BaseValue::Number(ms as f64 / 3_600_000.0)),
        _ => Err(EvalError::Name(format!(
            "campo durata sconosciuto .{field}"
        ))),
    }
}

fn to_number(value: &BaseValue) -> Result<BaseValue, EvalError> {
    match value {
        BaseValue::Number(n) => Ok(BaseValue::Number(*n)),
        BaseValue::Bool(true) => Ok(BaseValue::Number(1.0)),
        BaseValue::Bool(false) => Ok(BaseValue::Number(0.0)),
        BaseValue::Empty => Ok(BaseValue::Empty),
        BaseValue::Text(s) => s
            .trim()
            .parse::<f64>()
            .map(BaseValue::Number)
            .map_err(|_| EvalError::Value(format!("`{s}` non è un numero"))),
        BaseValue::Date(ms) => Ok(BaseValue::Number(*ms as f64)),
        BaseValue::Duration(ms) => Ok(BaseValue::Number(*ms as f64)),
        other => Err(EvalError::Value(format!(
            "number() su {}",
            other.type_name()
        ))),
    }
}

fn parse_date_value(value: &BaseValue) -> Result<BaseValue, EvalError> {
    match value {
        BaseValue::Date(ms) => Ok(BaseValue::Date(*ms)),
        BaseValue::Text(s) => parse_iso_date_ms(s.trim())
            .map(BaseValue::Date)
            .ok_or_else(|| EvalError::Value(format!("`{s}` non è una data ISO"))),
        BaseValue::Empty => Ok(BaseValue::Empty),
        other => Err(EvalError::Value(format!("date() su {}", other.type_name()))),
    }
}

fn parse_duration_value(value: &BaseValue) -> Result<BaseValue, EvalError> {
    match value {
        BaseValue::Duration(ms) => Ok(BaseValue::Duration(*ms)),
        BaseValue::Number(n) => Ok(BaseValue::Duration(*n as i64)),
        BaseValue::Text(s) => parse_duration_ms(s.trim())
            .map(BaseValue::Duration)
            .ok_or_else(|| EvalError::Value(format!("`{s}` non è una durata"))),
        BaseValue::Empty => Ok(BaseValue::Empty),
        other => Err(EvalError::Value(format!(
            "duration() su {}",
            other.type_name()
        ))),
    }
}

fn string_arg(value: &BaseValue, _fn: &str) -> Result<String, EvalError> {
    match value {
        BaseValue::Text(s) => Ok(s.clone()),
        BaseValue::Empty => Ok(String::new()),
        BaseValue::Number(n) => Ok(BaseValue::Number(*n).display()),
        BaseValue::Bool(b) => Ok(b.to_string()),
        other => Err(EvalError::Value(format!(
            "testo atteso, trovato {}",
            other.type_name()
        ))),
    }
}

fn number_arg(value: &BaseValue, _fn: &str) -> Result<f64, EvalError> {
    match value {
        BaseValue::Number(n) => Ok(*n),
        BaseValue::Bool(true) => Ok(1.0),
        BaseValue::Bool(false) => Ok(0.0),
        BaseValue::Text(s) => s
            .trim()
            .parse::<f64>()
            .map_err(|_| EvalError::Value(format!("`{s}` non è un numero"))),
        other => Err(EvalError::Value(format!(
            "numero atteso, trovato {}",
            other.type_name()
        ))),
    }
}

fn list_arg(value: &BaseValue, _fn: &str) -> Result<Vec<BaseValue>, EvalError> {
    match value {
        BaseValue::List(v) => Ok(v.clone()),
        BaseValue::Empty => Ok(Vec::new()),
        other => Err(EvalError::Value(format!(
            "lista attesa, trovata {}",
            other.type_name()
        ))),
    }
}

fn aggregate_numbers(name: &str, args: Vec<BaseValue>) -> Result<BaseValue, EvalError> {
    let mut numbers = Vec::new();
    for arg in args {
        match arg {
            BaseValue::List(items) => {
                for item in items {
                    numbers.push(number_arg(&item, name)?);
                }
            }
            BaseValue::Empty => {}
            other => numbers.push(number_arg(&other, name)?),
        }
    }
    if numbers.is_empty() {
        return Ok(BaseValue::Empty);
    }
    match name {
        "min" => Ok(BaseValue::Number(
            numbers.into_iter().reduce(f64::min).unwrap_or(0.0),
        )),
        "max" => Ok(BaseValue::Number(
            numbers.into_iter().reduce(f64::max).unwrap_or(0.0),
        )),
        "sum" => Ok(BaseValue::Number(numbers.iter().sum())),
        "average" | "avg" => Ok(BaseValue::Number(
            numbers.iter().sum::<f64>() / numbers.len() as f64,
        )),
        _ => unreachable!(),
    }
}

fn eval_contains(haystack: &BaseValue, needle: &BaseValue) -> Result<BaseValue, EvalError> {
    match (haystack, needle) {
        (BaseValue::Text(h), BaseValue::Text(n)) => Ok(BaseValue::Bool(h.contains(n.as_str()))),
        (BaseValue::List(items), needle) => Ok(BaseValue::Bool(items.contains(needle))),
        (BaseValue::Empty, _) => Ok(BaseValue::Bool(false)),
        (h, n) => Err(EvalError::Value(format!(
            "contains fra {} e {}",
            h.type_name(),
            n.type_name()
        ))),
    }
}

fn eval_contains_all(haystack: &BaseValue, needles: &[BaseValue]) -> Result<BaseValue, EvalError> {
    for needle in needles {
        if !truthy(&eval_contains(haystack, needle)?) {
            return Ok(BaseValue::Bool(false));
        }
    }
    Ok(BaseValue::Bool(true))
}

fn eval_contains_any(haystack: &BaseValue, needles: &[BaseValue]) -> Result<BaseValue, EvalError> {
    for needle in needles {
        if truthy(&eval_contains(haystack, needle)?) {
            return Ok(BaseValue::Bool(true));
        }
    }
    Ok(BaseValue::Bool(false))
}

fn eval_slice(args: &[BaseValue]) -> Result<BaseValue, EvalError> {
    if args.len() < 2 || args.len() > 3 {
        return Err(EvalError::Value("slice vuole start[, end]".to_string()));
    }
    let start = match &args[1] {
        BaseValue::Number(n) => *n as i64,
        other => {
            return Err(EvalError::Value(format!(
                "slice start su {}",
                other.type_name()
            )))
        }
    };
    let end = if args.len() > 2 {
        match &args[2] {
            BaseValue::Number(n) => Some(*n as i64),
            other => {
                return Err(EvalError::Value(format!(
                    "slice end su {}",
                    other.type_name()
                )))
            }
        }
    } else {
        None
    };
    let normalize = |index: i64, len: i64| -> usize {
        if index < 0 {
            len.saturating_add(index).max(0) as usize
        } else {
            (index as usize).min(len as usize)
        }
    };
    match &args[0] {
        BaseValue::Text(s) => {
            let chars: Vec<char> = s.chars().collect();
            let len = chars.len() as i64;
            let from = normalize(start, len);
            let to = end.map(|e| normalize(e, len)).unwrap_or(len as usize);
            let (from, to) = (from.min(to), to.max(from));
            Ok(BaseValue::Text(
                chars[from..to.min(chars.len())].iter().collect(),
            ))
        }
        BaseValue::List(items) => {
            let len = items.len() as i64;
            let from = normalize(start, len);
            let to = end.map(|e| normalize(e, len)).unwrap_or(len as usize);
            let (from, to) = (from.min(to), to.max(from));
            Ok(BaseValue::List(items[from..to.min(items.len())].to_vec()))
        }
        other => Err(EvalError::Value(format!("slice su {}", other.type_name()))),
    }
}

fn sort_key(value: &BaseValue) -> String {
    match value {
        BaseValue::Number(n) => format!("n:{n:020.6}"),
        BaseValue::Text(s) => format!("t:{s}"),
        BaseValue::Bool(b) => format!("b:{b}"),
        BaseValue::Date(ms) => format!("d:{ms:020}"),
        BaseValue::Duration(ms) => format!("u:{ms:020}"),
        _ => format!("x:{}", value.display()),
    }
}

/// `YYYY-MM-DD[ HH:mm[:ss]]` -> epoch-ms UTC. Solo ISO rigido.
fn parse_iso_date_ms(text: &str) -> Option<i64> {
    let (date, time) = match text.split_once(['T', 't', ' ']) {
        Some((d, t)) => (d, Some(t)),
        None => (text, None),
    };
    let mut parts = date.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (hour, minute, second) = match time {
        None => (0, 0, 0),
        Some(t) => {
            let t = t.trim_end_matches(['Z', 'z']);
            // Fuso `+HH:mm` supportato solo come scarto ore/minuti.
            let (t, offset_min): (&str, i64) = match t.rfind(['+', '-']) {
                Some(at) if at > 0 => {
                    let (head, zone) = t.split_at(at);
                    let sign = if zone.starts_with('-') { -1 } else { 1 };
                    let (h, m) = match zone[1..].split_once(':') {
                        Some((h, m)) => (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?),
                        None => (zone[1..].parse::<i64>().ok()?, 0),
                    };
                    (head, sign * (h * 60 + m))
                }
                _ => (t, 0),
            };
            let mut tp = t.split(':');
            let h: i64 = tp.next()?.parse().ok()?;
            let m: i64 = tp.next().map(str::parse).transpose().ok()?.unwrap_or(0);
            let s: i64 = tp
                .next()
                .map(|v| v.split('.').next().unwrap_or("0").parse())
                .transpose()
                .ok()?
                .unwrap_or(0);
            if tp.next().is_some() || h > 23 || m > 59 || s > 60 {
                return None;
            }
            (
                h * 3_600_000 + m * 60_000 + s * 1_000 - offset_min * 60_000,
                0,
                0,
            )
        }
    };
    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400_000 + hour + minute + second)
}

fn parse_duration_ms(text: &str) -> Option<i64> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    // Millisecondi nudi.
    if let Ok(ms) = text.parse::<i64>() {
        return Some(ms);
    }
    let (amount, unit) = split_amount_unit(text)?;
    let amount: i64 = amount.parse().ok()?;
    let per = match unit {
        "ms" | "millisecond" | "milliseconds" => 1,
        "s" | "sec" | "secs" | "second" | "seconds" => 1_000,
        "m" | "min" | "mins" | "minute" | "minutes" => 60_000,
        "h" | "hour" | "hours" => 3_600_000,
        "d" | "day" | "days" => 86_400_000,
        "w" | "week" | "weeks" => 604_800_000,
        _ => return None,
    };
    amount.checked_mul(per)
}

fn split_amount_unit(text: &str) -> Option<(&str, &str)> {
    let split = text
        .find(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(text.len());
    let (amount, unit) = text.split_at(split);
    if amount.trim().is_empty() || unit.trim().is_empty() {
        return None;
    }
    Some((amount.trim(), unit.trim()))
}

fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (month + 9).rem_euclid(12);
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn start_of_day_ms(now_ms: i64) -> i64 {
    now_ms.div_euclid(86_400_000) * 86_400_000
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> RowContext {
        RowContext {
            props: BTreeMap::from([
                ("status".into(), BaseValue::Text("done".into())),
                ("rating".into(), BaseValue::Number(4.5)),
                (
                    "tags".into(),
                    BaseValue::List(vec![BaseValue::Text("a".into())]),
                ),
            ]),
            file: BTreeMap::from([("name".into(), BaseValue::Text("note.md".into()))]),
            container: BTreeMap::from([("folder".into(), BaseValue::Text("Projects".into()))]),
            formulas: BTreeMap::new(),
            now_ms: 0,
        }
    }

    fn value_of(source: &str) -> BaseValue {
        let formula = Formula::parse(source).unwrap();
        formula.evaluate(&ctx(), &mut EvalBudget::new(MAX_FORMULA_STEPS))
    }

    #[test]
    fn tipi_operatori_e_funzioni() {
        assert_eq!(value_of("1 + 2 * 3"), BaseValue::Number(7.0));
        assert_eq!(
            value_of("if(rating >= 4, \"top\", \"altro\")"),
            BaseValue::Text("top".into())
        );
        assert_eq!(value_of("tags.contains(\"a\")"), BaseValue::Bool(true));
        assert_eq!(value_of("status.upper()"), BaseValue::Text("DONE".into()));
        assert_eq!(
            value_of("1 / 0"),
            BaseValue::Error(FormulaErrorCode::DivZero)
        );
    }
    #[test]
    fn frozen_list_object_link_tag_folder_matrix_and_typed_unknowns() {
        assert_eq!(
            value_of("slice('abcd', 1, 3)"),
            BaseValue::Text("bc".into())
        );
        assert_eq!(
            value_of("slice([1, 2, 3], 1)"),
            BaseValue::List(vec![BaseValue::Number(2.0), BaseValue::Number(3.0)])
        );
        let cases = [
            ("[3, 1, 3].unique().length", BaseValue::Number(2.0)),
            (
                "object('owner', 'Ada', 'score', 2).owner",
                BaseValue::Text("Ada".into()),
            ),
            (
                "object('status', true).has('status')",
                BaseValue::Bool(true),
            ),
            ("object('status', true).get('missing')", BaseValue::Empty),
            (
                "object('status', true).keys().first()",
                BaseValue::Text("status".into()),
            ),
            (
                "object('rating', 2).values().first()",
                BaseValue::Number(2.0),
            ),
            ("tags(prop.tags).contains('a')", BaseValue::Bool(true)),
            (
                "folder(file('Projects/task.md'))",
                BaseValue::Text("Projects".into()),
            ),
            (
                "folder(link('Projects/task.md'))",
                BaseValue::Text("Projects".into()),
            ),
            (
                "link('target.md', 'Label').target",
                BaseValue::Text("target.md".into()),
            ),
            ("container.folder", BaseValue::Text("Projects".into())),
            ("object('a')", BaseValue::Error(FormulaErrorCode::Value)),
            (
                "imaginary(prop.tags)",
                BaseValue::Error(FormulaErrorCode::Name),
            ),
        ];
        for (source, expected) in cases {
            assert_eq!(value_of(source), expected, "{source}");
        }
    }

    #[test]
    fn funzione_sconosciuta_e_un_errore_non_un_valore() {
        assert_eq!(
            value_of("pippo(status)"),
            BaseValue::Error(FormulaErrorCode::Name)
        );
        assert!(Formula::parse("status == ").is_err());
    }

    #[test]
    fn budget_e_valori_mancanti() {
        let formula = Formula::parse("prop.manca + 1").unwrap();
        assert_eq!(
            formula.evaluate(&ctx(), &mut EvalBudget::new(MAX_FORMULA_STEPS)),
            BaseValue::Error(FormulaErrorCode::Value)
        );
        let mut budget = EvalBudget::new(1);
        let formula = Formula::parse("1 + 1 + 1 + 1").unwrap();
        assert_eq!(
            formula.evaluate(&ctx(), &mut budget),
            BaseValue::Error(FormulaErrorCode::Budget)
        );
    }
}
