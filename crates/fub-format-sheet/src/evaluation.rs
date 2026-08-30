use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::model::{CellKey, Sheet, SheetId, Workbook};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormulaError {
    Parse,
    Reference,
    DivisionByZero,
    Value,
    Name,
    Cycle,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum CellValue {
    Blank,
    Number(f64),
    Text(String),
    Boolean(bool),
    Error(FormulaError),
}

impl CellValue {
    pub fn display(&self) -> String {
        match self {
            Self::Blank => String::new(),
            Self::Number(value) => {
                if value.fract() == 0.0 {
                    format!("{value:.0}")
                } else {
                    value.to_string()
                }
            }
            Self::Text(value) => value.clone(),
            Self::Boolean(true) => "TRUE".into(),
            Self::Boolean(false) => "FALSE".into(),
            Self::Error(FormulaError::Parse) => "#PARSE!".into(),
            Self::Error(FormulaError::Reference) => "#REF!".into(),
            Self::Error(FormulaError::DivisionByZero) => "#DIV/0!".into(),
            Self::Error(FormulaError::Value) => "#VALUE!".into(),
            Self::Error(FormulaError::Name) => "#NAME?".into(),
            Self::Error(FormulaError::Cycle) => "#CYCLE!".into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EvaluatedCell {
    pub value: CellValue,
    pub dependencies: Vec<CellKey>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SheetEvaluation {
    cells: HashMap<CellKey, EvaluatedCell>,
}

impl SheetEvaluation {
    pub fn cell(&self, key: &CellKey) -> Option<&EvaluatedCell> {
        self.cells.get(key)
    }

    pub fn cells(&self) -> impl Iterator<Item = (&CellKey, &EvaluatedCell)> {
        self.cells.iter()
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct WorkbookEvaluation {
    sheets: HashMap<SheetId, SheetEvaluation>,
}

impl WorkbookEvaluation {
    pub fn sheet(&self, id: &SheetId) -> Option<&SheetEvaluation> {
        self.sheets.get(id)
    }
}

pub fn evaluate_workbook(workbook: &Workbook) -> WorkbookEvaluation {
    let mut sheets = HashMap::with_capacity(workbook.sheets.len());
    for sheet in &workbook.sheets {
        sheets.insert(sheet.id.clone(), evaluate_sheet(sheet));
    }
    WorkbookEvaluation { sheets }
}

fn evaluate_sheet(sheet: &Sheet) -> SheetEvaluation {
    let inputs: HashMap<CellKey, &str> = sheet
        .cells
        .iter()
        .map(|cell| {
            (
                CellKey {
                    row: cell.row.clone(),
                    column: cell.column.clone(),
                },
                cell.input.as_str(),
            )
        })
        .collect();
    let mut evaluator = Evaluator {
        sheet,
        inputs,
        states: HashMap::new(),
    };
    let keys: Vec<CellKey> = evaluator.inputs.keys().cloned().collect();
    for key in &keys {
        evaluator.evaluate_cell(key);
    }
    let cells = evaluator
        .states
        .into_iter()
        .filter_map(|(key, state)| match state {
            CellState::Done(cell) => Some((key, cell)),
            CellState::Visiting => None,
        })
        .collect();
    SheetEvaluation { cells }
}

#[derive(Clone, Debug)]
enum CellState {
    Visiting,
    Done(EvaluatedCell),
}

struct Evaluator<'a> {
    sheet: &'a Sheet,
    inputs: HashMap<CellKey, &'a str>,
    states: HashMap<CellKey, CellState>,
}

impl Evaluator<'_> {
    fn evaluate_cell(&mut self, key: &CellKey) -> CellValue {
        match self.states.get(key) {
            Some(CellState::Visiting) => return CellValue::Error(FormulaError::Cycle),
            Some(CellState::Done(cell)) => return cell.value.clone(),
            None => {}
        }
        let Some(input) = self.inputs.get(key).copied() else {
            return CellValue::Blank;
        };
        self.states.insert(key.clone(), CellState::Visiting);

        let mut dependencies = HashSet::new();
        let value = if let Some(formula) = input.strip_prefix('=') {
            match Parser::new(formula).parse() {
                Ok(expression) => self.evaluate_expression(&expression, &mut dependencies),
                Err(error) => CellValue::Error(error),
            }
        } else if input.is_empty() {
            CellValue::Blank
        } else if let Ok(number) = input.parse::<f64>() {
            CellValue::Number(number)
        } else {
            CellValue::Text(input.to_string())
        };

        let mut dependencies: Vec<CellKey> = dependencies.into_iter().collect();
        dependencies.sort_by(|left, right| {
            left.row
                .cmp(&right.row)
                .then_with(|| left.column.cmp(&right.column))
        });
        self.states.insert(
            key.clone(),
            CellState::Done(EvaluatedCell {
                value: value.clone(),
                dependencies,
            }),
        );
        value
    }

    fn evaluate_expression(
        &mut self,
        expression: &Expression,
        dependencies: &mut HashSet<CellKey>,
    ) -> CellValue {
        match expression {
            Expression::Number(value) => CellValue::Number(*value),
            Expression::Text(value) => CellValue::Text(value.clone()),
            Expression::Reference(reference) => {
                let Some(key) = self.key_for(reference) else {
                    return CellValue::Error(FormulaError::Reference);
                };
                dependencies.insert(key.clone());
                self.evaluate_cell(&key)
            }
            Expression::Range(_, _) => CellValue::Error(FormulaError::Value),
            Expression::Unary { operator, value } => {
                let value = self.evaluate_expression(value, dependencies);
                let CellValue::Number(number) = value else {
                    return propagate_or(FormulaError::Value, value);
                };
                CellValue::Number(if *operator == UnaryOperator::Negative {
                    -number
                } else {
                    number
                })
            }
            Expression::Binary {
                operator,
                left,
                right,
            } => {
                let left = self.evaluate_expression(left, dependencies);
                if matches!(left, CellValue::Error(_)) {
                    return left;
                }
                let right = self.evaluate_expression(right, dependencies);
                if matches!(right, CellValue::Error(_)) {
                    return right;
                }
                evaluate_binary(*operator, left, right)
            }
            Expression::Call { name, arguments } => {
                self.evaluate_call(name, arguments, dependencies)
            }
        }
    }

    fn evaluate_call(
        &mut self,
        name: &str,
        arguments: &[Expression],
        dependencies: &mut HashSet<CellKey>,
    ) -> CellValue {
        match name {
            "SUM" | "AVERAGE" | "MIN" | "MAX" => {
                let mut numbers = Vec::new();
                for argument in arguments {
                    if let Err(error) = self.collect_numbers(argument, dependencies, &mut numbers) {
                        return CellValue::Error(error);
                    }
                }
                match name {
                    "SUM" => CellValue::Number(numbers.iter().sum()),
                    "AVERAGE" if numbers.is_empty() => {
                        CellValue::Error(FormulaError::DivisionByZero)
                    }
                    "AVERAGE" => {
                        CellValue::Number(numbers.iter().sum::<f64>() / numbers.len() as f64)
                    }
                    "MIN" => numbers
                        .into_iter()
                        .reduce(f64::min)
                        .map(CellValue::Number)
                        .unwrap_or(CellValue::Number(0.0)),
                    "MAX" => numbers
                        .into_iter()
                        .reduce(f64::max)
                        .map(CellValue::Number)
                        .unwrap_or(CellValue::Number(0.0)),
                    _ => unreachable!(),
                }
            }
            "IF" => {
                if arguments.len() != 3 {
                    return CellValue::Error(FormulaError::Value);
                }
                let condition = self.evaluate_expression(&arguments[0], dependencies);
                match truthy(condition) {
                    Ok(true) => self.evaluate_expression(&arguments[1], dependencies),
                    Ok(false) => self.evaluate_expression(&arguments[2], dependencies),
                    Err(error) => CellValue::Error(error),
                }
            }
            _ => CellValue::Error(FormulaError::Name),
        }
    }

    fn collect_numbers(
        &mut self,
        expression: &Expression,
        dependencies: &mut HashSet<CellKey>,
        numbers: &mut Vec<f64>,
    ) -> Result<(), FormulaError> {
        if let Expression::Range(from, to) = expression {
            let Some(keys) = self.keys_in_range(from, to) else {
                return Err(FormulaError::Reference);
            };
            for key in keys {
                dependencies.insert(key.clone());
                match self.evaluate_cell(&key) {
                    CellValue::Number(value) => numbers.push(value),
                    CellValue::Blank | CellValue::Text(_) => {}
                    CellValue::Boolean(_) => return Err(FormulaError::Value),
                    CellValue::Error(error) => return Err(error),
                }
            }
            return Ok(());
        }

        match self.evaluate_expression(expression, dependencies) {
            CellValue::Number(value) => {
                numbers.push(value);
                Ok(())
            }
            CellValue::Blank | CellValue::Text(_) => Ok(()),
            CellValue::Boolean(_) => Err(FormulaError::Value),
            CellValue::Error(error) => Err(error),
        }
    }

    fn key_for(&self, reference: &A1Reference) -> Option<CellKey> {
        let row = self.sheet.rows.get(reference.row.checked_sub(1)?)?;
        let column = self.sheet.columns.get(reference.column.checked_sub(1)?)?;
        Some(CellKey {
            row: row.id.clone(),
            column: column.id.clone(),
        })
    }

    fn keys_in_range(&self, from: &A1Reference, to: &A1Reference) -> Option<Vec<CellKey>> {
        let row_start = from.row.min(to.row).checked_sub(1)?;
        let row_end = from.row.max(to.row);
        let column_start = from.column.min(to.column).checked_sub(1)?;
        let column_end = from.column.max(to.column);
        if row_end > self.sheet.rows.len() || column_end > self.sheet.columns.len() {
            return None;
        }
        let mut keys = Vec::with_capacity((row_end - row_start) * (column_end - column_start));
        for row in &self.sheet.rows[row_start..row_end] {
            for column in &self.sheet.columns[column_start..column_end] {
                keys.push(CellKey {
                    row: row.id.clone(),
                    column: column.id.clone(),
                });
            }
        }
        Some(keys)
    }
}

fn propagate_or(error: FormulaError, value: CellValue) -> CellValue {
    match value {
        CellValue::Error(error) => CellValue::Error(error),
        _ => CellValue::Error(error),
    }
}

fn truthy(value: CellValue) -> Result<bool, FormulaError> {
    match value {
        CellValue::Boolean(value) => Ok(value),
        CellValue::Number(value) => Ok(value != 0.0),
        CellValue::Blank => Ok(false),
        CellValue::Text(_) => Err(FormulaError::Value),
        CellValue::Error(error) => Err(error),
    }
}

fn evaluate_binary(operator: BinaryOperator, left: CellValue, right: CellValue) -> CellValue {
    if operator == BinaryOperator::Concatenate {
        return CellValue::Text(format!("{}{}", left.display(), right.display()));
    }
    if operator.is_comparison() {
        return compare(operator, left, right);
    }
    let CellValue::Number(left) = left else {
        return CellValue::Error(FormulaError::Value);
    };
    let CellValue::Number(right) = right else {
        return CellValue::Error(FormulaError::Value);
    };
    match operator {
        BinaryOperator::Add => CellValue::Number(left + right),
        BinaryOperator::Subtract => CellValue::Number(left - right),
        BinaryOperator::Multiply => CellValue::Number(left * right),
        BinaryOperator::Divide if right == 0.0 => CellValue::Error(FormulaError::DivisionByZero),
        BinaryOperator::Divide => CellValue::Number(left / right),
        BinaryOperator::Power => CellValue::Number(left.powf(right)),
        _ => unreachable!(),
    }
}

fn compare(operator: BinaryOperator, left: CellValue, right: CellValue) -> CellValue {
    let ordering = match (&left, &right) {
        (CellValue::Number(left), CellValue::Number(right)) => left.partial_cmp(right),
        (CellValue::Text(left), CellValue::Text(right)) => Some(left.cmp(right)),
        (CellValue::Boolean(left), CellValue::Boolean(right)) => Some(left.cmp(right)),
        (CellValue::Blank, CellValue::Blank) => Some(std::cmp::Ordering::Equal),
        _ => None,
    };
    let Some(ordering) = ordering else {
        return CellValue::Error(FormulaError::Value);
    };
    let value = match operator {
        BinaryOperator::Equal => ordering.is_eq(),
        BinaryOperator::NotEqual => !ordering.is_eq(),
        BinaryOperator::Less => ordering.is_lt(),
        BinaryOperator::LessEqual => !ordering.is_gt(),
        BinaryOperator::Greater => ordering.is_gt(),
        BinaryOperator::GreaterEqual => !ordering.is_lt(),
        _ => unreachable!(),
    };
    CellValue::Boolean(value)
}

#[derive(Clone, Debug, PartialEq)]
enum Expression {
    Number(f64),
    Text(String),
    Reference(A1Reference),
    Range(A1Reference, A1Reference),
    Unary {
        operator: UnaryOperator,
        value: Box<Expression>,
    },
    Binary {
        operator: BinaryOperator,
        left: Box<Expression>,
        right: Box<Expression>,
    },
    Call {
        name: String,
        arguments: Vec<Expression>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UnaryOperator {
    Positive,
    Negative,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BinaryOperator {
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Concatenate,
    Add,
    Subtract,
    Multiply,
    Divide,
    Power,
}

impl BinaryOperator {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct A1Reference {
    row: usize,
    column: usize,
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Text(String),
    Identifier(String),
    Reference(A1Reference),
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Ampersand,
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
    End,
}

struct Lexer<'a> {
    source: &'a [u8],
    cursor: usize,
}

impl<'a> Lexer<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source: source.as_bytes(),
            cursor: 0,
        }
    }

    fn tokens(mut self) -> Result<Vec<Token>, FormulaError> {
        let mut tokens = Vec::new();
        loop {
            let token = self.next()?;
            let end = token == Token::End;
            tokens.push(token);
            if end {
                return Ok(tokens);
            }
        }
    }

    fn next(&mut self) -> Result<Token, FormulaError> {
        while self
            .source
            .get(self.cursor)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.cursor += 1;
        }
        let Some(&byte) = self.source.get(self.cursor) else {
            return Ok(Token::End);
        };
        self.cursor += 1;
        match byte {
            b'+' => Ok(Token::Plus),
            b'-' => Ok(Token::Minus),
            b'*' => Ok(Token::Star),
            b'/' => Ok(Token::Slash),
            b'^' => Ok(Token::Caret),
            b'&' => Ok(Token::Ampersand),
            b'(' => Ok(Token::LeftParen),
            b')' => Ok(Token::RightParen),
            b',' | b';' => Ok(Token::Comma),
            b':' => Ok(Token::Colon),
            b'=' => {
                self.take(b'=');
                Ok(Token::Equal)
            }
            b'!' if self.take(b'=') => Ok(Token::NotEqual),
            b'<' if self.take(b'=') => Ok(Token::LessEqual),
            b'<' if self.take(b'>') => Ok(Token::NotEqual),
            b'<' => Ok(Token::Less),
            b'>' if self.take(b'=') => Ok(Token::GreaterEqual),
            b'>' => Ok(Token::Greater),
            b'"' => self.string(),
            b'.' | b'0'..=b'9' => self.number(byte),
            b'$' | b'A'..=b'Z' | b'a'..=b'z' | b'_' => self.word(byte),
            _ => Err(FormulaError::Parse),
        }
    }

    fn take(&mut self, expected: u8) -> bool {
        if self.source.get(self.cursor) == Some(&expected) {
            self.cursor += 1;
            true
        } else {
            false
        }
    }

    fn string(&mut self) -> Result<Token, FormulaError> {
        let mut value = Vec::new();
        while let Some(&byte) = self.source.get(self.cursor) {
            self.cursor += 1;
            if byte != b'"' {
                value.push(byte);
                continue;
            }
            if self.take(b'"') {
                value.push(b'"');
                continue;
            }
            return String::from_utf8(value)
                .map(Token::Text)
                .map_err(|_| FormulaError::Parse);
        }
        Err(FormulaError::Parse)
    }

    fn number(&mut self, first: u8) -> Result<Token, FormulaError> {
        let start = self.cursor - 1;
        if first == b'.' && !self.source.get(self.cursor).is_some_and(u8::is_ascii_digit) {
            return Err(FormulaError::Parse);
        }
        while self.source.get(self.cursor).is_some_and(u8::is_ascii_digit) {
            self.cursor += 1;
        }
        if self.take(b'.') {
            while self.source.get(self.cursor).is_some_and(u8::is_ascii_digit) {
                self.cursor += 1;
            }
        }
        if self
            .source
            .get(self.cursor)
            .is_some_and(|byte| matches!(byte, b'e' | b'E'))
        {
            self.cursor += 1;
            if self
                .source
                .get(self.cursor)
                .is_some_and(|byte| matches!(byte, b'+' | b'-'))
            {
                self.cursor += 1;
            }
            let exponent = self.cursor;
            while self.source.get(self.cursor).is_some_and(u8::is_ascii_digit) {
                self.cursor += 1;
            }
            if exponent == self.cursor {
                return Err(FormulaError::Parse);
            }
        }
        let source = std::str::from_utf8(&self.source[start..self.cursor])
            .map_err(|_| FormulaError::Parse)?;
        source
            .parse::<f64>()
            .map(Token::Number)
            .map_err(|_| FormulaError::Parse)
    }

    fn word(&mut self, first: u8) -> Result<Token, FormulaError> {
        let start = self.cursor - 1;
        while self
            .source
            .get(self.cursor)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'$'))
        {
            self.cursor += 1;
        }
        let source = std::str::from_utf8(&self.source[start..self.cursor])
            .map_err(|_| FormulaError::Parse)?;
        if let Some(reference) = parse_reference(source) {
            return Ok(Token::Reference(reference));
        }
        if first == b'$' {
            return Err(FormulaError::Parse);
        }
        Ok(Token::Identifier(source.to_ascii_uppercase()))
    }
}

fn parse_reference(source: &str) -> Option<A1Reference> {
    let compact: String = source
        .chars()
        .filter(|character| *character != '$')
        .collect();
    let split = compact.find(|character: char| character.is_ascii_digit())?;
    let (letters, digits) = compact.split_at(split);
    if letters.is_empty()
        || digits.is_empty()
        || !letters.bytes().all(|byte| byte.is_ascii_alphabetic())
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let mut column = 0_usize;
    for byte in letters.bytes() {
        column = column
            .checked_mul(26)?
            .checked_add((byte.to_ascii_uppercase() - b'A' + 1) as usize)?;
    }
    let row = digits.parse::<usize>().ok()?;
    if row == 0 || column == 0 {
        return None;
    }
    Some(A1Reference { row, column })
}

struct Parser {
    tokens: Vec<Token>,
    cursor: usize,
}

impl Parser {
    fn new(source: &str) -> Self {
        Self {
            tokens: Lexer::new(source)
                .tokens()
                .unwrap_or_else(|_| vec![Token::End]),
            cursor: 0,
        }
    }

    fn parse(mut self) -> Result<Expression, FormulaError> {
        if self.tokens.len() == 1 {
            return Err(FormulaError::Parse);
        }
        let expression = self.comparison()?;
        if self.peek() != &Token::End {
            return Err(FormulaError::Parse);
        }
        Ok(expression)
    }

    fn comparison(&mut self) -> Result<Expression, FormulaError> {
        let mut expression = self.concatenation()?;
        while let Some(operator) = match self.peek() {
            Token::Equal => Some(BinaryOperator::Equal),
            Token::NotEqual => Some(BinaryOperator::NotEqual),
            Token::Less => Some(BinaryOperator::Less),
            Token::LessEqual => Some(BinaryOperator::LessEqual),
            Token::Greater => Some(BinaryOperator::Greater),
            Token::GreaterEqual => Some(BinaryOperator::GreaterEqual),
            _ => None,
        } {
            self.cursor += 1;
            expression = Expression::Binary {
                operator,
                left: Box::new(expression),
                right: Box::new(self.concatenation()?),
            };
        }
        Ok(expression)
    }

    fn concatenation(&mut self) -> Result<Expression, FormulaError> {
        let mut expression = self.term()?;
        while self.peek() == &Token::Ampersand {
            self.cursor += 1;
            expression = Expression::Binary {
                operator: BinaryOperator::Concatenate,
                left: Box::new(expression),
                right: Box::new(self.term()?),
            };
        }
        Ok(expression)
    }

    fn term(&mut self) -> Result<Expression, FormulaError> {
        let mut expression = self.factor()?;
        loop {
            let operator = match self.peek() {
                Token::Plus => BinaryOperator::Add,
                Token::Minus => BinaryOperator::Subtract,
                _ => return Ok(expression),
            };
            self.cursor += 1;
            expression = Expression::Binary {
                operator,
                left: Box::new(expression),
                right: Box::new(self.factor()?),
            };
        }
    }

    fn factor(&mut self) -> Result<Expression, FormulaError> {
        let mut expression = self.power()?;
        loop {
            let operator = match self.peek() {
                Token::Star => BinaryOperator::Multiply,
                Token::Slash => BinaryOperator::Divide,
                _ => return Ok(expression),
            };
            self.cursor += 1;
            expression = Expression::Binary {
                operator,
                left: Box::new(expression),
                right: Box::new(self.power()?),
            };
        }
    }

    fn power(&mut self) -> Result<Expression, FormulaError> {
        let expression = self.unary()?;
        if self.peek() != &Token::Caret {
            return Ok(expression);
        }
        self.cursor += 1;
        Ok(Expression::Binary {
            operator: BinaryOperator::Power,
            left: Box::new(expression),
            right: Box::new(self.power()?),
        })
    }

    fn unary(&mut self) -> Result<Expression, FormulaError> {
        let operator = match self.peek() {
            Token::Plus => Some(UnaryOperator::Positive),
            Token::Minus => Some(UnaryOperator::Negative),
            _ => None,
        };
        let Some(operator) = operator else {
            return self.primary();
        };
        self.cursor += 1;
        Ok(Expression::Unary {
            operator,
            value: Box::new(self.unary()?),
        })
    }

    fn primary(&mut self) -> Result<Expression, FormulaError> {
        match self.advance().clone() {
            Token::Number(value) => Ok(Expression::Number(value)),
            Token::Text(value) => Ok(Expression::Text(value)),
            Token::Reference(from) if self.peek() == &Token::Colon => {
                self.cursor += 1;
                let Token::Reference(to) = self.advance().clone() else {
                    return Err(FormulaError::Parse);
                };
                Ok(Expression::Range(from, to))
            }
            Token::Reference(reference) => Ok(Expression::Reference(reference)),
            Token::Identifier(name) if self.peek() == &Token::LeftParen => {
                self.cursor += 1;
                let mut arguments = Vec::new();
                if self.peek() != &Token::RightParen {
                    loop {
                        arguments.push(self.comparison()?);
                        if self.peek() != &Token::Comma {
                            break;
                        }
                        self.cursor += 1;
                    }
                }
                if self.advance() != &Token::RightParen {
                    return Err(FormulaError::Parse);
                }
                Ok(Expression::Call { name, arguments })
            }
            Token::LeftParen => {
                let expression = self.comparison()?;
                if self.advance() != &Token::RightParen {
                    return Err(FormulaError::Parse);
                }
                Ok(expression)
            }
            _ => Err(FormulaError::Parse),
        }
    }

    fn peek(&self) -> &Token {
        self.tokens.get(self.cursor).unwrap_or(&Token::End)
    }

    fn advance(&mut self) -> &Token {
        let cursor = self.cursor;
        self.cursor += 1;
        self.tokens.get(cursor).unwrap_or(&Token::End)
    }
}
