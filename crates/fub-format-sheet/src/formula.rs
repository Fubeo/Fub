use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{Cell, CellKey, ColumnId, RowId, Sheet, SheetError, SheetId, Workbook};

const MAX_RANGE_CELLS: usize = 1_000_000;

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

struct Evaluator<'a> {
    sheets: Vec<IndexedSheet<'a>>,
    sheet_by_id: HashMap<&'a SheetId, usize>,
    sheet_by_name: HashMap<&'a str, usize>,
    cache: HashMap<CellKey, CellValue>,
    visiting: HashSet<CellKey>,
    dependencies: Vec<CellDependency>,
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
            dependencies: Vec::new(),
        }
    }

    fn evaluate_key(&mut self, key: &CellKey) -> CellValue {
        if let Some(value) = self.cache.get(key) {
            return value.clone();
        }
        if !self.visiting.insert(key.clone()) {
            self.cache
                .insert(key.clone(), CellValue::Error(FormulaErrorCode::Cycle));
            return CellValue::Error(FormulaErrorCode::Cycle);
        }
        let input = self
            .cell(key)
            .map(|cell| cell.input.clone())
            .unwrap_or_default();
        let value = if let Some(formula) = input.strip_prefix('=') {
            match Parser::parse(formula) {
                Ok(ast) => {
                    let mut direct = Vec::new();
                    self.collect_dependencies(&key.sheet, &ast, &mut direct);
                    direct.sort();
                    direct.dedup();
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
        self.visiting.remove(key);
        self.cache.insert(key.clone(), value.clone());
        value
    }

    fn cell(&self, key: &CellKey) -> Option<&Cell> {
        let sheet = self.sheets.get(*self.sheet_by_id.get(&key.sheet)?)?;
        sheet.cells.get(&(&key.row, &key.column)).copied()
    }

    fn evaluate_ast(&mut self, current_sheet: &SheetId, ast: &Ast) -> CellValue {
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
}

impl Parser {
    fn parse(source: &str) -> Result<Ast, ()> {
        let mut parser = Self {
            tokens: Lexer::tokenize(source)?,
            index: 0,
        };
        let expression = parser.comparison()?;
        if parser.index == parser.tokens.len() {
            Ok(expression)
        } else {
            Err(())
        }
    }

    fn comparison(&mut self) -> Result<Ast, ()> {
        let mut expression = self.additive()?;
        while let Some(operator) = self.take_comparison() {
            let right = self.additive()?;
            expression = Ast::Binary(operator, Box::new(expression), Box::new(right));
        }
        Ok(expression)
    }

    fn additive(&mut self) -> Result<Ast, ()> {
        let mut expression = self.multiplicative()?;
        loop {
            let operator = if self.take(&Token::Plus) {
                Binary::Add
            } else if self.take(&Token::Minus) {
                Binary::Subtract
            } else {
                break;
            };
            let right = self.multiplicative()?;
            expression = Ast::Binary(operator, Box::new(expression), Box::new(right));
        }
        Ok(expression)
    }

    fn multiplicative(&mut self) -> Result<Ast, ()> {
        let mut expression = self.power()?;
        loop {
            let operator = if self.take(&Token::Star) {
                Binary::Multiply
            } else if self.take(&Token::Slash) {
                Binary::Divide
            } else {
                break;
            };
            let right = self.power()?;
            expression = Ast::Binary(operator, Box::new(expression), Box::new(right));
        }
        Ok(expression)
    }

    fn power(&mut self) -> Result<Ast, ()> {
        let left = self.unary()?;
        if self.take(&Token::Caret) {
            let right = self.power()?;
            Ok(Ast::Binary(Binary::Power, Box::new(left), Box::new(right)))
        } else {
            Ok(left)
        }
    }

    fn unary(&mut self) -> Result<Ast, ()> {
        if self.take(&Token::Plus) {
            return Ok(Ast::Unary(Unary::Plus, Box::new(self.unary()?)));
        }
        if self.take(&Token::Minus) {
            return Ok(Ast::Unary(Unary::Minus, Box::new(self.unary()?)));
        }
        self.primary()
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
                let value = self.comparison()?;
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
        loop {
            arguments.push(self.comparison()?);
            if self.take(&Token::RightParen) {
                break;
            }
            if !self.take(&Token::Comma) {
                return Err(());
            }
        }
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
