use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{Cell, CellKey, ColumnId, RowId, Sheet, SheetError, SheetId, Workbook};

const MAX_RANGE_CELLS: usize = 1_000_000;
/// Quanti livelli una formula può annidare: parentesi, segni, potenze,
/// argomenti di funzione e anelli di una catena di operatori contano uno
/// ciascuno. Il parser, la valutazione, la raccolta delle dipendenze e perfino
/// il `Drop` dell'albero scendono di un frame per livello: senza un tetto
/// `=((((…1))))` con ventimila parentesi esauriva lo stack e chiudeva il
/// processo. Oltre, la formula è `#PARSE!`.
const MAX_FORMULA_DEPTH: usize = 256;
/// Quanti livelli di valutazione (una cella, un nodo) possono essere aperti
/// insieme. Una formula al tetto ne apre al più `2 * MAX_FORMULA_DEPTH`, e
/// una cella fuori da un anello ne apre soltanto per sé, perché
/// [`Evaluator::settle`] le consegna le dipendenze già valutate: il budget si
/// esaurisce soltanto dentro un anello lungo, che è `#CYCLE!` comunque.
const MAX_EVALUATION_FRAMES: usize = 4 * MAX_FORMULA_DEPTH;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormulaErrorCode {
    Parse,
    Ref,
    Name,
    Value,
    DivZero,
    Num,
    Cycle,
}

impl FormulaErrorCode {
    pub fn display(self) -> &'static str {
        match self {
            Self::Parse => "#PARSE!",
            Self::Ref => "#REF!",
            Self::Name => "#NAME?",
            Self::Value => "#VALUE!",
            Self::DivZero => "#DIV/0!",
            Self::Num => "#NUM!",
            Self::Cycle => "#CYCLE!",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum CellValue {
    Blank,
    Number(f64),
    Text(String),
    Boolean(bool),
    Error(FormulaErrorCode),
}

impl CellValue {
    pub fn display(&self) -> String {
        match self {
            Self::Blank => String::new(),
            Self::Number(value) => value.to_string(),
            Self::Text(value) => value.clone(),
            Self::Boolean(value) => if *value { "TRUE" } else { "FALSE" }.to_owned(),
            Self::Error(error) => error.display().to_owned(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EvaluatedCell {
    pub sheet: SheetId,
    pub row: RowId,
    pub column: ColumnId,
    pub value: CellValue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellDependency {
    pub cell: CellKey,
    pub depends_on: Vec<CellKey>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkbookEvaluation {
    pub cells: Vec<EvaluatedCell>,
    pub dependencies: Vec<CellDependency>,
}

impl Workbook {
    pub fn evaluate(&self) -> Result<WorkbookEvaluation, SheetError> {
        self.validate()?;
        let mut evaluator = Evaluator::new(self);
        let keys: Vec<_> = self
            .sheets
            .iter()
            .flat_map(|sheet| {
                sheet.cells.iter().map(|cell| CellKey {
                    sheet: sheet.id.clone(),
                    row: cell.row.clone(),
                    column: cell.column.clone(),
                })
            })
            .collect();
        for key in &keys {
            evaluator.settle(key);
        }
        let mut cells = Vec::with_capacity(keys.len());
        for key in &keys {
            cells.push(EvaluatedCell {
                sheet: key.sheet.clone(),
                row: key.row.clone(),
                column: key.column.clone(),
                value: evaluator.evaluate_key(key),
            });
        }
        Ok(WorkbookEvaluation {
            cells,
            dependencies: evaluator.dependencies,
        })
    }
}

struct IndexedSheet<'a> {
    sheet: &'a Sheet,
    cells: HashMap<(&'a RowId, &'a ColumnId), &'a Cell>,
}

/// Lo stato di Tarjan per [`Evaluator::settle`].
#[derive(Default)]
struct Walk {
    /// Per cella visitata: (ordine di visita, minimo ordine raggiungibile).
    order: HashMap<CellKey, (usize, usize)>,
    /// Celle visitate la cui componente non è ancora chiusa.
    component: Vec<CellKey>,
    on_component: HashSet<CellKey>,
    /// La pila di chiamata esplicita: cella e dipendenze ancora da guardare.
    stack: Vec<(CellKey, std::vec::IntoIter<CellKey>)>,
}

impl Walk {
    fn open(&mut self, key: CellKey, direct: Vec<CellKey>) {
        let at = self.order.len();
        self.order.insert(key.clone(), (at, at));
        self.component.push(key.clone());
        self.on_component.insert(key.clone());
        self.stack.push((key, direct.into_iter()));
    }

    fn lower(&mut self, key: &CellKey, reached: usize) {
        if let Some((_, low)) = self.order.get_mut(key) {
            *low = (*low).min(reached);
        }
    }
}

struct Evaluator<'a> {
    sheets: Vec<IndexedSheet<'a>>,
    sheet_by_id: HashMap<&'a SheetId, usize>,
    sheet_by_name: HashMap<&'a str, usize>,
    cache: HashMap<CellKey, CellValue>,
    visiting: HashSet<CellKey>,
    /// Livelli di valutazione aperti, contro [`MAX_EVALUATION_FRAMES`].
    frames: usize,
    dependencies: Vec<CellDependency>,
    /// Formule già lette da [`Evaluator::settle`], con le loro dipendenze
    /// dirette: [`Evaluator::evaluate_key`] le consuma invece di rileggerle.
    parsed: HashMap<CellKey, (Result<Ast, ()>, Vec<CellKey>)>,
}

impl<'a> Evaluator<'a> {
    fn new(workbook: &'a Workbook) -> Self {
        let sheets: Vec<_> = workbook
            .sheets
            .iter()
            .map(|sheet| IndexedSheet {
                sheet,
                cells: sheet
                    .cells
                    .iter()
                    .map(|cell| ((&cell.row, &cell.column), cell))
                    .collect(),
            })
            .collect();
        let sheet_by_id = sheets
            .iter()
            .enumerate()
            .map(|(index, sheet)| (&sheet.sheet.id, index))
            .collect();
        let sheet_by_name = sheets
            .iter()
            .enumerate()
            .map(|(index, sheet)| (sheet.sheet.name.as_str(), index))
            .collect();
        Self {
            sheets,
            sheet_by_id,
            sheet_by_name,
            cache: HashMap::new(),
            visiting: HashSet::new(),
            frames: 0,
            dependencies: Vec::new(),
            parsed: HashMap::new(),
        }
    }

    /// Valuta `root` e tutto ciò da cui dipende senza ricorrere cella per
    /// cella: Tarjan iterativo, con una pila esplicita. Le componenti
    /// fortemente connesse escono in ordine topologico inverso e si valutano
    /// appena escono, quindi una cella trova in cache tutto ciò che sta fuori
    /// dalla sua componente. Prima una colonna di totali progressivi scritta
    /// dal basso (`A1=A2+1`, `A2=A3+1`, …) ricorreva una volta per riga ed
    /// esauriva lo stack. Dentro un anello la valutazione resta quella di
    /// sempre (è lei a dire `#CYCLE!`, e un `IF` che non prende il ramo non lo
    /// chiude), limitata da [`MAX_EVALUATION_FRAMES`].
    fn settle(&mut self, root: &CellKey) {
        if self.cache.contains_key(root) {
            return;
        }
        let mut walk = Walk::default();
        walk.open(root.clone(), self.read_formula(root));
        loop {
            let Some((key, pending)) = walk.stack.last_mut() else {
                break;
            };
            if let Some(dependency) = pending.next() {
                if self.cache.contains_key(&dependency) {
                    continue;
                }
                match walk.order.get(&dependency) {
                    None => {
                        let direct = self.read_formula(&dependency);
                        walk.open(dependency, direct);
                    }
                    Some(&(reached, _)) if walk.on_component.contains(&dependency) => {
                        let key = key.clone();
                        walk.lower(&key, reached);
                    }
                    Some(_) => {}
                }
                continue;
            }
            let Some((key, _)) = walk.stack.pop() else {
                break;
            };
            let (at, low) = walk.order[&key];
            if let Some(parent) = walk.stack.last().map(|(parent, _)| parent.clone()) {
                walk.lower(&parent, low);
            }
            if at == low {
                let mut members = Vec::new();
                while let Some(member) = walk.component.pop() {
                    walk.on_component.remove(&member);
                    let last = member == key;
                    members.push(member);
                    if last {
                        break;
                    }
                }
                for member in members.iter().rev() {
                    self.evaluate_key(member);
                }
            }
        }
    }

    /// Legge la formula di `key` (una volta) e ne restituisce le dipendenze
    /// dirette; una cella che non è una formula non ne ha.
    fn read_formula(&mut self, key: &CellKey) -> Vec<CellKey> {
        if let Some((_, direct)) = self.parsed.get(key) {
            return direct.clone();
        }
        let Some(formula) = self.cell(key).and_then(|cell| cell.input.strip_prefix('=')) else {
            return Vec::new();
        };
        let ast = Parser::parse(formula);
        let mut direct = Vec::new();
        if let Ok(ast) = &ast {
            self.collect_dependencies(&key.sheet, ast, &mut direct);
            direct.sort();
            direct.dedup();
        }
        self.parsed.insert(key.clone(), (ast, direct.clone()));
        direct
    }

    fn evaluate_key(&mut self, key: &CellKey) -> CellValue {
        if let Some(value) = self.cache.get(key) {
            return value.clone();
        }
        if self.frames >= MAX_EVALUATION_FRAMES || !self.visiting.insert(key.clone()) {
            self.cache
                .insert(key.clone(), CellValue::Error(FormulaErrorCode::Cycle));
            return CellValue::Error(FormulaErrorCode::Cycle);
        }
        self.frames += 1;
        let input = self
            .cell(key)
            .map(|cell| cell.input.clone())
            .unwrap_or_default();
        let value = if input.starts_with('=') {
            self.read_formula(key);
            let (ast, direct) = self
                .parsed
                .remove(key)
                .unwrap_or_else(|| (Err(()), Vec::new()));
            match ast {
                Ok(ast) => {
                    self.dependencies.push(CellDependency {
                        cell: key.clone(),
                        depends_on: direct,
                    });
                    self.evaluate_ast(&key.sheet, &ast)
                }
                Err(()) => CellValue::Error(FormulaErrorCode::Parse),
            }
        } else {
            literal_value(&input)
        };
        self.frames -= 1;
        self.visiting.remove(key);
        self.cache.insert(key.clone(), value.clone());
        value
    }

    fn cell(&self, key: &CellKey) -> Option<&Cell> {
        let sheet = self.sheets.get(*self.sheet_by_id.get(&key.sheet)?)?;
        sheet.cells.get(&(&key.row, &key.column)).copied()
    }

    fn evaluate_ast(&mut self, current_sheet: &SheetId, ast: &Ast) -> CellValue {
        if self.frames >= MAX_EVALUATION_FRAMES {
            return CellValue::Error(FormulaErrorCode::Cycle);
        }
        self.frames += 1;
        let value = self.evaluate_node(current_sheet, ast);
        self.frames -= 1;
        value
    }

    fn evaluate_node(&mut self, current_sheet: &SheetId, ast: &Ast) -> CellValue {
        match ast {
            Ast::Number(value) => finite(*value),
            Ast::Text(value) => CellValue::Text(value.clone()),
            Ast::Boolean(value) => CellValue::Boolean(*value),
            Ast::Reference(reference) => self
                .resolve_reference(current_sheet, reference)
                .map(|key| self.evaluate_key(&key))
                .unwrap_or(CellValue::Error(FormulaErrorCode::Ref)),
            Ast::Range(_, _) => CellValue::Error(FormulaErrorCode::Value),
            Ast::Unary(operator, value) => {
                let value = self.evaluate_ast(current_sheet, value);
                match (operator, number(value)) {
                    (_, Err(error)) => CellValue::Error(error),
                    (Unary::Plus, Ok(value)) => finite(value),
                    (Unary::Minus, Ok(value)) => finite(-value),
                }
            }
            Ast::Binary(operator, left, right) => {
                let left = self.evaluate_ast(current_sheet, left);
                if let CellValue::Error(error) = left {
                    return CellValue::Error(error);
                }
                let right = self.evaluate_ast(current_sheet, right);
                if let CellValue::Error(error) = right {
                    return CellValue::Error(error);
                }
                evaluate_binary(*operator, left, right)
            }
            Ast::Call(name, arguments) => self.evaluate_call(current_sheet, name, arguments),
        }
    }

    fn evaluate_call(
        &mut self,
        current_sheet: &SheetId,
        name: &str,
        arguments: &[Ast],
    ) -> CellValue {
        if matches_ignore_ascii_case(name, &["IF"]) {
            if arguments.len() != 3 {
                return CellValue::Error(FormulaErrorCode::Value);
            }
            let condition = self.evaluate_ast(current_sheet, &arguments[0]);
            return match truthy(condition) {
                Ok(true) => self.evaluate_ast(current_sheet, &arguments[1]),
                Ok(false) => self.evaluate_ast(current_sheet, &arguments[2]),
                Err(error) => CellValue::Error(error),
            };
        }
        if !matches_ignore_ascii_case(name, &["SUM", "AVERAGE", "MIN", "MAX"]) {
            return CellValue::Error(FormulaErrorCode::Name);
        }

        let mut values = Vec::new();
        for argument in arguments {
            match argument {
                Ast::Range(start, end) => {
                    let keys = match self.resolve_range(current_sheet, start, end) {
                        Ok(keys) => keys,
                        Err(error) => return CellValue::Error(error),
                    };
                    values.extend(keys.iter().map(|key| self.evaluate_key(key)));
                }
                _ => values.push(self.evaluate_ast(current_sheet, argument)),
            }
        }
        aggregate(name, values)
    }

    fn collect_dependencies(&self, current_sheet: &SheetId, ast: &Ast, output: &mut Vec<CellKey>) {
        match ast {
            Ast::Reference(reference) => {
                if let Some(key) = self.resolve_reference(current_sheet, reference) {
                    output.push(key);
                }
            }
            Ast::Range(start, end) => {
                if let Ok(keys) = self.resolve_range(current_sheet, start, end) {
                    output.extend(keys);
                }
            }
            Ast::Unary(_, value) => self.collect_dependencies(current_sheet, value, output),
            Ast::Binary(_, left, right) => {
                self.collect_dependencies(current_sheet, left, output);
                self.collect_dependencies(current_sheet, right, output);
            }
            Ast::Call(_, arguments) => {
                for argument in arguments {
                    self.collect_dependencies(current_sheet, argument, output);
                }
            }
            Ast::Number(_) | Ast::Text(_) | Ast::Boolean(_) => {}
        }
    }

    fn resolve_reference(&self, current_sheet: &SheetId, reference: &Reference) -> Option<CellKey> {
        let sheet_index = match &reference.sheet {
            Some(name) => *self.sheet_by_name.get(name.as_str())?,
            None => *self.sheet_by_id.get(current_sheet)?,
        };
        let sheet = self.sheets.get(sheet_index)?.sheet;
        let row = sheet.rows.get(reference.row)?.id.clone();
        let column = sheet.columns.get(reference.column)?.id.clone();
        Some(CellKey {
            sheet: sheet.id.clone(),
            row,
            column,
        })
    }

    fn resolve_range(
        &self,
        current_sheet: &SheetId,
        start: &Reference,
        end: &Reference,
    ) -> Result<Vec<CellKey>, FormulaErrorCode> {
        let sheet_index = match (start.sheet.as_deref(), end.sheet.as_deref()) {
            (None, None) => *self
                .sheet_by_id
                .get(current_sheet)
                .ok_or(FormulaErrorCode::Ref)?,
            (Some(name), None) => *self.sheet_by_name.get(name).ok_or(FormulaErrorCode::Ref)?,
            (Some(start), Some(end)) if start == end => {
                *self.sheet_by_name.get(start).ok_or(FormulaErrorCode::Ref)?
            }
            _ => return Err(FormulaErrorCode::Ref),
        };
        let sheet = self
            .sheets
            .get(sheet_index)
            .ok_or(FormulaErrorCode::Ref)?
            .sheet;
        if start.row >= sheet.rows.len()
            || end.row >= sheet.rows.len()
            || start.column >= sheet.columns.len()
            || end.column >= sheet.columns.len()
        {
            return Err(FormulaErrorCode::Ref);
        }
        let row_start = start.row.min(end.row);
        let row_end = start.row.max(end.row);
        let column_start = start.column.min(end.column);
        let column_end = start.column.max(end.column);
        let count = (row_end - row_start + 1)
            .checked_mul(column_end - column_start + 1)
            .ok_or(FormulaErrorCode::Num)?;
        if count > MAX_RANGE_CELLS {
            return Err(FormulaErrorCode::Num);
        }
        let mut keys = Vec::with_capacity(count);
        for row in row_start..=row_end {
            for column in column_start..=column_end {
                keys.push(CellKey {
                    sheet: sheet.id.clone(),
                    row: sheet.rows[row].id.clone(),
                    column: sheet.columns[column].id.clone(),
                });
            }
        }
        Ok(keys)
    }
}

fn literal_value(input: &str) -> CellValue {
    if input.is_empty() {
        CellValue::Blank
    } else if matches_ignore_ascii_case(input, &["TRUE"]) {
        CellValue::Boolean(true)
    } else if matches_ignore_ascii_case(input, &["FALSE"]) {
        CellValue::Boolean(false)
    } else if let Ok(value) = input.parse::<f64>() {
        finite(value)
    } else {
        CellValue::Text(input.to_owned())
    }
}

fn finite(value: f64) -> CellValue {
    if value.is_finite() {
        CellValue::Number(value)
    } else {
        CellValue::Error(FormulaErrorCode::Num)
    }
}

fn number(value: CellValue) -> Result<f64, FormulaErrorCode> {
    match value {
        CellValue::Number(value) => Ok(value),
        CellValue::Blank => Ok(0.0),
        CellValue::Error(error) => Err(error),
        CellValue::Text(_) | CellValue::Boolean(_) => Err(FormulaErrorCode::Value),
    }
}

fn truthy(value: CellValue) -> Result<bool, FormulaErrorCode> {
    match value {
        CellValue::Boolean(value) => Ok(value),
        CellValue::Number(value) => Ok(value != 0.0),
        CellValue::Blank => Ok(false),
        CellValue::Error(error) => Err(error),
        CellValue::Text(_) => Err(FormulaErrorCode::Value),
    }
}

fn evaluate_binary(operator: Binary, left: CellValue, right: CellValue) -> CellValue {
    if operator.is_comparison() {
        return CellValue::Boolean(compare(operator, &left, &right));
    }
    let left = match number(left) {
        Ok(value) => value,
        Err(error) => return CellValue::Error(error),
    };
    let right = match number(right) {
        Ok(value) => value,
        Err(error) => return CellValue::Error(error),
    };
    match operator {
        Binary::Add => finite(left + right),
        Binary::Subtract => finite(left - right),
        Binary::Multiply => finite(left * right),
        Binary::Divide if right == 0.0 => CellValue::Error(FormulaErrorCode::DivZero),
        Binary::Divide => finite(left / right),
        Binary::Power => finite(left.powf(right)),
        _ => unreachable!("comparison handled above"),
    }
}

fn compare(operator: Binary, left: &CellValue, right: &CellValue) -> bool {
    let ordering = match (left, right) {
        (CellValue::Number(left), CellValue::Number(right)) => left.partial_cmp(right),
        (CellValue::Text(left), CellValue::Text(right)) => Some(left.cmp(right)),
        (CellValue::Boolean(left), CellValue::Boolean(right)) => Some(left.cmp(right)),
        (CellValue::Blank, CellValue::Blank) => Some(std::cmp::Ordering::Equal),
        _ => None,
    };
    match operator {
        Binary::Equal => ordering == Some(std::cmp::Ordering::Equal),
        Binary::NotEqual => ordering != Some(std::cmp::Ordering::Equal),
        Binary::Less => ordering == Some(std::cmp::Ordering::Less),
        Binary::LessEqual => matches!(
            ordering,
            Some(std::cmp::Ordering::Less | std::cmp::Ordering::Equal)
        ),
        Binary::Greater => ordering == Some(std::cmp::Ordering::Greater),
        Binary::GreaterEqual => matches!(
            ordering,
            Some(std::cmp::Ordering::Greater | std::cmp::Ordering::Equal)
        ),
        _ => false,
    }
}

fn aggregate(name: &str, values: Vec<CellValue>) -> CellValue {
    let mut numbers = Vec::new();
    for value in values {
        match value {
            CellValue::Number(value) => numbers.push(value),
            CellValue::Error(error) => return CellValue::Error(error),
            CellValue::Blank | CellValue::Text(_) | CellValue::Boolean(_) => {}
        }
    }
    if matches_ignore_ascii_case(name, &["SUM"]) {
        return finite(numbers.into_iter().sum());
    }
    if matches_ignore_ascii_case(name, &["AVERAGE"]) {
        if numbers.is_empty() {
            return CellValue::Error(FormulaErrorCode::DivZero);
        }
        return finite(numbers.iter().sum::<f64>() / numbers.len() as f64);
    }
    if numbers.is_empty() {
        return CellValue::Number(0.0);
    }
    let reduce = if matches_ignore_ascii_case(name, &["MIN"]) {
        f64::min
    } else {
        f64::max
    };
    finite(numbers.into_iter().reduce(reduce).unwrap_or(0.0))
}

fn matches_ignore_ascii_case(value: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| value.eq_ignore_ascii_case(candidate))
}

#[derive(Clone, Debug, PartialEq)]
enum Ast {
    Number(f64),
    Text(String),
    Boolean(bool),
    Reference(Reference),
    Range(Reference, Reference),
    Unary(Unary, Box<Ast>),
    Binary(Binary, Box<Ast>, Box<Ast>),
    Call(String, Vec<Ast>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Reference {
    sheet: Option<String>,
    row: usize,
    column: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Unary {
    Plus,
    Minus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Binary {
    Add,
    Subtract,
    Multiply,
    Divide,
    Power,
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
}

impl Binary {
    fn is_comparison(self) -> bool {
        matches!(
            self,
            Self::Equal
                | Self::NotEqual
                | Self::Less
                | Self::LessEqual
                | Self::Greater
                | Self::GreaterEqual
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    String(String),
    QuotedName(String),
    Identifier(String),
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    LeftParen,
    RightParen,
    Comma,
    Colon,
    Bang,
}

struct Lexer<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl<'a> Lexer<'a> {
    fn tokenize(source: &'a str) -> Result<Vec<Token>, ()> {
        let mut lexer = Self {
            chars: source.chars().peekable(),
        };
        let mut tokens = Vec::new();
        while let Some(character) = lexer.chars.next() {
            if character.is_whitespace() {
                continue;
            }
            let token = match character {
                '+' => Token::Plus,
                '-' => Token::Minus,
                '*' => Token::Star,
                '/' => Token::Slash,
                '^' => Token::Caret,
                '=' => Token::Equal,
                '(' => Token::LeftParen,
                ')' => Token::RightParen,
                ',' | ';' => Token::Comma,
                ':' => Token::Colon,
                '!' => Token::Bang,
                '<' => match lexer.chars.peek() {
                    Some('=') => {
                        lexer.chars.next();
                        Token::LessEqual
                    }
                    Some('>') => {
                        lexer.chars.next();
                        Token::NotEqual
                    }
                    _ => Token::Less,
                },
                '>' => match lexer.chars.peek() {
                    Some('=') => {
                        lexer.chars.next();
                        Token::GreaterEqual
                    }
                    _ => Token::Greater,
                },
                '"' => Token::String(lexer.quoted('"')?),
                '\'' => Token::QuotedName(lexer.quoted('\'')?),
                value if value.is_ascii_digit() || value == '.' => {
                    Token::Number(lexer.number(value)?)
                }
                value if value.is_alphabetic() || value == '_' => {
                    Token::Identifier(lexer.identifier(value))
                }
                _ => return Err(()),
            };
            tokens.push(token);
        }
        Ok(tokens)
    }

    fn quoted(&mut self, quote: char) -> Result<String, ()> {
        let mut value = String::new();
        while let Some(character) = self.chars.next() {
            if character != quote {
                value.push(character);
                continue;
            }
            if self.chars.peek() == Some(&quote) {
                self.chars.next();
                value.push(quote);
                continue;
            }
            return Ok(value);
        }
        Err(())
    }

    fn number(&mut self, first: char) -> Result<f64, ()> {
        let mut value = String::from(first);
        let mut exponent = false;
        while let Some(character) = self.chars.peek().copied() {
            if character.is_ascii_digit() || character == '.' {
                value.push(character);
                self.chars.next();
            } else if (character == 'e' || character == 'E') && !exponent {
                exponent = true;
                value.push(character);
                self.chars.next();
                if matches!(self.chars.peek(), Some('+' | '-')) {
                    value.push(self.chars.next().ok_or(())?);
                }
            } else {
                break;
            }
        }
        value.parse().map_err(|_| ())
    }

    fn identifier(&mut self, first: char) -> String {
        let mut value = String::from(first);
        while let Some(character) = self.chars.peek().copied() {
            if character.is_alphanumeric() || matches!(character, '_' | '.') {
                value.push(character);
                self.chars.next();
            } else {
                break;
            }
        }
        value
    }
}

struct Parser {
    tokens: Vec<Token>,
    index: usize,
    /// Livelli aperti, contro [`MAX_FORMULA_DEPTH`]. Ogni funzione lo
    /// riporta dove l'ha trovato prima di tornare; un errore abbandona la
    /// formula intera, quindi non serve ripristinarlo sul ramo `Err`.
    depth: usize,
}

impl Parser {
    fn parse(source: &str) -> Result<Ast, ()> {
        let mut parser = Self {
            tokens: Lexer::tokenize(source)?,
            index: 0,
            depth: 0,
        };
        let expression = parser.comparison()?;
        if parser.index == parser.tokens.len() {
            Ok(expression)
        } else {
            Err(())
        }
    }

    /// Apre un livello. Un anello di una catena di operatori ne apre uno che
    /// resta aperto per il resto della catena: l'albero a sinistra si
    /// approfondisce di uno per anello anche senza ricorsione del parser.
    fn deeper(&mut self) -> Result<(), ()> {
        self.depth += 1;
        if self.depth > MAX_FORMULA_DEPTH {
            Err(())
        } else {
            Ok(())
        }
    }

    fn comparison(&mut self) -> Result<Ast, ()> {
        let entry = self.depth;
        let mut expression = self.additive()?;
        while let Some(operator) = self.take_comparison() {
            self.deeper()?;
            let right = self.additive()?;
            expression = Ast::Binary(operator, Box::new(expression), Box::new(right));
        }
        self.depth = entry;
        Ok(expression)
    }

    fn additive(&mut self) -> Result<Ast, ()> {
        let entry = self.depth;
        let mut expression = self.multiplicative()?;
        loop {
            let operator = if self.take(&Token::Plus) {
                Binary::Add
            } else if self.take(&Token::Minus) {
                Binary::Subtract
            } else {
                break;
            };
            self.deeper()?;
            let right = self.multiplicative()?;
            expression = Ast::Binary(operator, Box::new(expression), Box::new(right));
        }
        self.depth = entry;
        Ok(expression)
    }

    fn multiplicative(&mut self) -> Result<Ast, ()> {
        let entry = self.depth;
        let mut expression = self.power()?;
        loop {
            let operator = if self.take(&Token::Star) {
                Binary::Multiply
            } else if self.take(&Token::Slash) {
                Binary::Divide
            } else {
                break;
            };
            self.deeper()?;
            let right = self.power()?;
            expression = Ast::Binary(operator, Box::new(expression), Box::new(right));
        }
        self.depth = entry;
        Ok(expression)
    }

    fn power(&mut self) -> Result<Ast, ()> {
        let left = self.unary()?;
        if self.take(&Token::Caret) {
            let entry = self.depth;
            self.deeper()?;
            let right = self.power()?;
            self.depth = entry;
            Ok(Ast::Binary(Binary::Power, Box::new(left), Box::new(right)))
        } else {
            Ok(left)
        }
    }

    fn unary(&mut self) -> Result<Ast, ()> {
        let operator = if self.take(&Token::Plus) {
            Unary::Plus
        } else if self.take(&Token::Minus) {
            Unary::Minus
        } else {
            return self.primary();
        };
        let entry = self.depth;
        self.deeper()?;
        let value = self.unary()?;
        self.depth = entry;
        Ok(Ast::Unary(operator, Box::new(value)))
    }

    fn primary(&mut self) -> Result<Ast, ()> {
        let token = self.next().ok_or(())?;
        let mut expression = match token {
            Token::Number(value) => Ast::Number(value),
            Token::String(value) => Ast::Text(value),
            Token::Identifier(value) => {
                if self.peek_is(&Token::LeftParen) {
                    self.call(value)?
                } else if matches_ignore_ascii_case(&value, &["TRUE"]) {
                    Ast::Boolean(true)
                } else if matches_ignore_ascii_case(&value, &["FALSE"]) {
                    Ast::Boolean(false)
                } else {
                    Ast::Reference(self.reference_after_name(None, value)?)
                }
            }
            Token::QuotedName(sheet) => {
                if !self.take(&Token::Bang) {
                    return Err(());
                }
                let Token::Identifier(address) = self.next().ok_or(())? else {
                    return Err(());
                };
                Ast::Reference(reference(Some(sheet), &address)?)
            }
            Token::LeftParen => {
                let entry = self.depth;
                self.deeper()?;
                let value = self.comparison()?;
                self.depth = entry;
                if !self.take(&Token::RightParen) {
                    return Err(());
                }
                value
            }
            _ => return Err(()),
        };
        if self.take(&Token::Colon) {
            let Ast::Reference(start) = expression else {
                return Err(());
            };
            let end = self.reference_token()?;
            expression = Ast::Range(start, end);
        }
        Ok(expression)
    }

    fn call(&mut self, name: String) -> Result<Ast, ()> {
        if !self.take(&Token::LeftParen) {
            return Err(());
        }
        let mut arguments = Vec::new();
        if self.take(&Token::RightParen) {
            return Ok(Ast::Call(name, arguments));
        }
        let entry = self.depth;
        self.deeper()?;
        loop {
            arguments.push(self.comparison()?);
            if self.take(&Token::RightParen) {
                break;
            }
            if !self.take(&Token::Comma) {
                return Err(());
            }
        }
        self.depth = entry;
        Ok(Ast::Call(name, arguments))
    }

    fn reference_token(&mut self) -> Result<Reference, ()> {
        match self.next().ok_or(())? {
            Token::Identifier(value) => self.reference_after_name(None, value),
            Token::QuotedName(sheet) => {
                if !self.take(&Token::Bang) {
                    return Err(());
                }
                let Token::Identifier(address) = self.next().ok_or(())? else {
                    return Err(());
                };
                reference(Some(sheet), &address)
            }
            _ => Err(()),
        }
    }

    fn reference_after_name(
        &mut self,
        sheet: Option<String>,
        value: String,
    ) -> Result<Reference, ()> {
        if self.take(&Token::Bang) {
            let Token::Identifier(address) = self.next().ok_or(())? else {
                return Err(());
            };
            reference(Some(value), &address)
        } else {
            reference(sheet, &value)
        }
    }

    fn take_comparison(&mut self) -> Option<Binary> {
        let operator = match self.tokens.get(self.index)? {
            Token::Equal => Binary::Equal,
            Token::NotEqual => Binary::NotEqual,
            Token::Less => Binary::Less,
            Token::LessEqual => Binary::LessEqual,
            Token::Greater => Binary::Greater,
            Token::GreaterEqual => Binary::GreaterEqual,
            _ => return None,
        };
        self.index += 1;
        Some(operator)
    }

    fn next(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.index)?.clone();
        self.index += 1;
        Some(token)
    }

    fn take(&mut self, expected: &Token) -> bool {
        if self.peek_is(expected) {
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn peek_is(&self, expected: &Token) -> bool {
        self.tokens.get(self.index) == Some(expected)
    }
}

fn reference(sheet: Option<String>, address: &str) -> Result<Reference, ()> {
    let letters = address.bytes().take_while(u8::is_ascii_alphabetic).count();
    if letters == 0 || letters == address.len() {
        return Err(());
    }
    let (column, row) = address.split_at(letters);
    if !row.bytes().all(|byte| byte.is_ascii_digit()) || row.starts_with('0') {
        return Err(());
    }
    let mut column_index = 0usize;
    for byte in column.bytes() {
        column_index = column_index
            .checked_mul(26)
            .and_then(|value| value.checked_add(usize::from(byte.to_ascii_uppercase() - b'A' + 1)))
            .ok_or(())?;
    }
    Ok(Reference {
        sheet,
        row: row
            .parse::<usize>()
            .map_err(|_| ())?
            .checked_sub(1)
            .ok_or(())?,
        column: column_index.checked_sub(1).ok_or(())?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CellStyle, Column, Row};

    fn workbook() -> Workbook {
        let mut first = Sheet::new("sheet-1", "Main");
        first.rows = (1..=4)
            .map(|index| Row {
                id: format!("r{index}").into(),
                height: None,
                hidden: false,
            })
            .collect();
        first.columns = (1..=3)
            .map(|index| Column {
                id: format!("c{index}").into(),
                width: None,
                hidden: false,
            })
            .collect();
        first.cells = vec![
            cell("r1", "c1", "2"),
            cell("r2", "c1", "3"),
            cell("r1", "c2", "=A1+A2*2"),
            cell("r2", "c2", "=SUM(A1:A2)"),
            cell("r3", "c2", "=IF(B2=5,\"yes\",\"no\")"),
        ];
        let mut second = Sheet::new("sheet-2", "Other Sheet");
        second.rows = vec![Row {
            id: "other-r1".into(),
            height: None,
            hidden: false,
        }];
        second.columns = vec![Column {
            id: "other-c1".into(),
            width: None,
            hidden: false,
        }];
        second.cells = vec![cell("other-r1", "other-c1", "='Main'!B1")];
        Workbook::new(vec![first, second])
    }

    fn cell(row: &str, column: &str, input: &str) -> Cell {
        Cell {
            row: row.into(),
            column: column.into(),
            input: input.into(),
            style: CellStyle::default(),
        }
    }

    fn value(evaluation: &WorkbookEvaluation, sheet: &str, row: &str, column: &str) -> CellValue {
        evaluation
            .cells
            .iter()
            .find(|cell| {
                cell.sheet.as_ref() == sheet
                    && cell.row.as_ref() == row
                    && cell.column.as_ref() == column
            })
            .unwrap()
            .value
            .clone()
    }

    #[test]
    fn evaluates_precedence_ranges_if_and_cross_sheet_references() {
        let evaluation = workbook().evaluate().unwrap();
        assert_eq!(
            value(&evaluation, "sheet-1", "r1", "c2"),
            CellValue::Number(8.0)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r2", "c2"),
            CellValue::Number(5.0)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r3", "c2"),
            CellValue::Text("yes".into())
        );
        assert_eq!(
            value(&evaluation, "sheet-2", "other-r1", "other-c1"),
            CellValue::Number(8.0)
        );
    }

    #[test]
    fn returns_typed_errors_for_parse_ref_name_division_and_cycles() {
        let mut workbook = workbook();
        workbook.sheets[0].cells.extend([
            cell("r1", "c3", "=("),
            cell("r2", "c3", "=Z99"),
            cell("r3", "c3", "=NOPE(1)"),
            cell("r3", "c1", "=SUM(A1:'Other Sheet'!A1)"),
            cell("r4", "c1", "=1/0"),
            cell("r4", "c2", "=C4"),
            cell("r4", "c3", "=B4"),
        ]);
        let evaluation = workbook.evaluate().unwrap();
        assert_eq!(
            value(&evaluation, "sheet-1", "r1", "c3"),
            CellValue::Error(FormulaErrorCode::Parse)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r2", "c3"),
            CellValue::Error(FormulaErrorCode::Ref)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r3", "c3"),
            CellValue::Error(FormulaErrorCode::Name)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r3", "c1"),
            CellValue::Error(FormulaErrorCode::Ref)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r4", "c1"),
            CellValue::Error(FormulaErrorCode::DivZero)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r4", "c2"),
            CellValue::Error(FormulaErrorCode::Cycle)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r4", "c3"),
            CellValue::Error(FormulaErrorCode::Cycle)
        );
    }

    #[test]
    fn rejects_ranges_over_the_evaluation_limit_before_allocating_them() {
        let mut sheet = Sheet::new("sheet-wide", "Wide");
        sheet.rows = (1..=1_001)
            .map(|index| Row {
                id: format!("r{index}").into(),
                height: None,
                hidden: false,
            })
            .collect();
        sheet.columns = (1..=1_000)
            .map(|index| Column {
                id: format!("c{index}").into(),
                width: None,
                hidden: false,
            })
            .collect();
        sheet.cells = vec![cell("r1", "c1", "=SUM(A1:ALL1001)")];

        let evaluation = Workbook::new(vec![sheet]).evaluate().unwrap();
        assert_eq!(
            value(&evaluation, "sheet-wide", "r1", "c1"),
            CellValue::Error(FormulaErrorCode::Num)
        );
    }

    /// I100: una formula annidata oltre il tetto è `#PARSE!`, in ogni forma
    /// che scende di un livello — e non uno stack esaurito.
    #[test]
    fn a_hostile_nest_is_a_parse_error_not_a_stack_overflow() {
        let deep = 100_000;
        let hostile = [
            format!("={}1{}", "(".repeat(deep), ")".repeat(deep)),
            format!("={}", vec!["1"; deep].join("+")),
            format!("={}", vec!["2"; deep].join("^")),
            format!("={}1", "-".repeat(deep)),
            format!("={}1{}", "SUM(".repeat(deep), ")".repeat(deep)),
            format!("={}", vec!["1"; deep].join("=")),
        ];
        for formula in hostile {
            assert_eq!(Parser::parse(&formula[1..]), Err(()));
        }
        let mut workbook = workbook();
        workbook.sheets[0].cells.push(cell(
            "r4",
            "c1",
            &format!("={}1{}", "(".repeat(deep), ")".repeat(deep)),
        ));
        assert_eq!(
            value(&workbook.evaluate().unwrap(), "sheet-1", "r4", "c1"),
            CellValue::Error(FormulaErrorCode::Parse)
        );
    }

    /// Al tetto la formula si legge e si valuta ancora, sullo stack di un
    /// thread di test.
    #[test]
    fn a_formula_at_the_depth_limit_still_evaluates() {
        let mut workbook = workbook();
        workbook.sheets[0].cells.extend([
            cell(
                "r4",
                "c1",
                &format!("={}", vec!["1"; MAX_FORMULA_DEPTH + 1].join("+")),
            ),
            cell(
                "r4",
                "c2",
                &format!(
                    "={}1{}",
                    "(".repeat(MAX_FORMULA_DEPTH),
                    ")".repeat(MAX_FORMULA_DEPTH)
                ),
            ),
            cell(
                "r4",
                "c3",
                &format!(
                    "={}A1{}",
                    "SUM(".repeat(MAX_FORMULA_DEPTH),
                    ")".repeat(MAX_FORMULA_DEPTH)
                ),
            ),
        ]);
        let evaluation = workbook.evaluate().unwrap();
        assert_eq!(
            value(&evaluation, "sheet-1", "r4", "c1"),
            CellValue::Number((MAX_FORMULA_DEPTH + 1) as f64)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r4", "c2"),
            CellValue::Number(1.0)
        );
        assert_eq!(
            value(&evaluation, "sheet-1", "r4", "c3"),
            CellValue::Number(2.0)
        );
    }

    fn column_sheet(rows: usize, input: impl Fn(usize) -> String) -> Workbook {
        let mut sheet = Sheet::new("sheet-long", "Long");
        sheet.rows = (1..=rows)
            .map(|index| Row {
                id: format!("r{index}").into(),
                height: None,
                hidden: false,
            })
            .collect();
        sheet.columns = vec![Column {
            id: "c1".into(),
            width: None,
            hidden: false,
        }];
        sheet.cells = (1..=rows)
            .map(|index| cell(&format!("r{index}"), "c1", &input(index)))
            .collect();
        Workbook::new(vec![sheet])
    }

    /// Una colonna di totali scritta dal basso: ogni riga dipende dalla
    /// successiva. La valutazione ricorreva una volta per riga; ora ogni
    /// cella si valuta dopo le sue dipendenze, e il valore resta esatto.
    #[test]
    fn a_long_reference_chain_evaluates_without_deep_recursion() {
        let rows = 100_000;
        let workbook = column_sheet(rows, |index| {
            if index == rows {
                "1".to_string()
            } else {
                format!("=A{}+1", index + 1)
            }
        });
        let evaluation = workbook.evaluate().unwrap();
        assert_eq!(
            value(&evaluation, "sheet-long", "r1", "c1"),
            CellValue::Number(rows as f64)
        );
        assert_eq!(evaluation.dependencies.len(), rows - 1);
    }

    /// Un anello lungo resta `#CYCLE!` per ogni sua cella, senza scendere
    /// di un livello per cella.
    #[test]
    fn a_long_cycle_is_a_cycle_not_a_stack_overflow() {
        let rows = 20_000;
        let workbook = column_sheet(rows, |index| {
            format!("=A{}+1", if index == rows { 1 } else { index + 1 })
        });
        let evaluation = workbook.evaluate().unwrap();
        assert!(evaluation
            .cells
            .iter()
            .all(|cell| cell.value == CellValue::Error(FormulaErrorCode::Cycle)));
    }

    /// L'albero più profondo che il tetto ammette — una catena di segni
    /// come primo termine di una catena di somme — si valuta da solo, e due
    /// celle così che si citano esauriscono il budget invece dello stack.
    #[test]
    fn the_deepest_admitted_tree_fits_the_budget_even_inside_a_cycle() {
        let deepest = |tail: &str| {
            format!(
                "={}1{}",
                "-".repeat(MAX_FORMULA_DEPTH - 1),
                "+1".repeat(MAX_FORMULA_DEPTH - 1) + tail
            )
        };
        let workbook = column_sheet(3, |index| match index {
            1 => deepest(""),
            2 => deepest("+A3"),
            _ => deepest("+A2"),
        });
        let evaluation = workbook.evaluate().unwrap();
        assert_eq!(
            value(&evaluation, "sheet-long", "r1", "c1"),
            CellValue::Number((MAX_FORMULA_DEPTH - 2) as f64)
        );
        for row in ["r2", "r3"] {
            assert_eq!(
                value(&evaluation, "sheet-long", row, "c1"),
                CellValue::Error(FormulaErrorCode::Cycle)
            );
        }
    }

    /// Una catena aciclica lunga appesa a un anello: l'anello è `#CYCLE!`,
    /// la catena ha i suoi valori esatti — il budget dell'anello non la tocca,
    /// perché la sua componente si chiude e si valuta prima.
    #[test]
    fn a_chain_hanging_off_a_cycle_keeps_its_values() {
        let rows = 50_000;
        let workbook = column_sheet(rows, |index| match index {
            1 => "=A2+1".to_string(),
            2 => "=A1+A3".to_string(),
            last if last == rows => "1".to_string(),
            index => format!("=A{}+1", index + 1),
        });
        let evaluation = workbook.evaluate().unwrap();
        for row in ["r1", "r2"] {
            assert_eq!(
                value(&evaluation, "sheet-long", row, "c1"),
                CellValue::Error(FormulaErrorCode::Cycle)
            );
        }
        assert_eq!(
            value(&evaluation, "sheet-long", "r3", "c1"),
            CellValue::Number((rows - 2) as f64)
        );
    }

    /// Un anello che un `IF` non percorre non è un anello: la valutazione
    /// dentro una componente resta quella dinamica.
    #[test]
    fn a_cycle_that_an_if_never_takes_is_not_a_cycle() {
        let workbook = column_sheet(3, |index| match index {
            1 => "=IF(A3>0,A2,0)".to_string(),
            2 => "=IF(A3<0,A1,5)".to_string(),
            _ => "1".to_string(),
        });
        let evaluation = workbook.evaluate().unwrap();
        assert_eq!(
            value(&evaluation, "sheet-long", "r1", "c1"),
            CellValue::Number(5.0)
        );
        assert_eq!(
            value(&evaluation, "sheet-long", "r2", "c1"),
            CellValue::Number(5.0)
        );
    }

    #[test]
    fn dependencies_are_derived_and_not_part_of_the_serialized_workbook() {
        let workbook = workbook();
        let evaluation = workbook.evaluate().unwrap();
        let dependency = evaluation
            .dependencies
            .iter()
            .find(|entry| entry.cell.row.as_ref() == "r2" && entry.cell.column.as_ref() == "c2")
            .unwrap();
        assert_eq!(dependency.depends_on.len(), 2);
        let source = workbook.serialize().unwrap();
        let value: serde_json::Value = serde_json::from_str(&source).unwrap();
        assert!(value.get("dependencies").is_none());
    }
}
