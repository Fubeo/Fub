//! **La sintassi della barra di ricerca**: una riga di testo → [`QueryExpr`].
//!
//! La semantica sta in [`QueryExpr`] (OR di clausole AND di letterali), e
//! questa regola è soltanto la sua forma scritta. Sta nel contratto perché le
//! stesse parole devono dire la stessa cosa nella barra della shell, nella
//! CLI, in una query salvata e in un blocco `query` incorporato: una copia per
//! consumatore sarebbe una semantica per consumatore. La gemella TypeScript è
//! `apps/client/src/rules/search-syntax.ts`, legata da `rules_mirror`.
//!
//! # Il linguaggio
//!
//! - parole separate da spazi: tutte presenti (AND); le parole semplici
//!   consecutive formano **un** predicato di testo, così il ranking le pesa
//!   insieme;
//! - `"frase esatta"`; `\"` dentro le virgolette è una virgoletta;
//! - `-x` nega l'elemento che segue (una parola, una frase, un operatore);
//! - `OR` (maiuscolo, da solo) separa le alternative; `( … )` raggruppa, e i
//!   gruppi si distribuiscono;
//! - `/regex/` cerca un'espressione regolare nel testo;
//! - `[chiave]` la proprietà c'è; `[chiave:valore]` la contiene (elenco o
//!   sottostringa); `[chiave:>v]` e `[chiave:<v]` la confrontano. Il valore
//!   diventa numero, booleano o data ISO quando lo è, altrimenti testo;
//! - operatori `nome:valore`, con valore anche fra virgolette: `tag:`,
//!   `path:` (sottostringa, o glob se contiene `*`/`?`), `folder:`, `file:`
//!   (nel nome), `content:` (nel corpo), `heading:`, `ext:`, `task:todo` /
//!   `task:done`, `match-case:` (testo con maiuscole esatte).
//!
//! Un `nome:valore` con un nome che non è un operatore è testo: `ore 10:30` o
//! un URL non diventano un errore. Un errore porta la specie e l'offset in
//! **byte** del punto in cui la riga smette di avere senso.
use crate::model::{PropertyDate, PropertyScalar, PropertyValue};
use crate::query::{
    QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TaskStatus, TextField, TextMode,
    TextQuery,
};
use crate::traits::{PropertyFilter, PropertyTest};

/// Quante alternative può avere un'espressione dopo la distribuzione, e
/// quanti letterali una clausola: gli stessi tetti che la shell applica a una
/// `QueryExpr` scritta a mano.
pub const MAX_CLAUSES: usize = 32;
pub const MAX_LITERALS: usize = 32;
/// Quanti gruppi uno dentro l'altro. Il parser scende di un livello per
/// gruppo, e così la distribuzione: senza un tetto una riga di migliaia di `(`
/// esauriva lo stack. Oltre, la riga è `TooComplex` sulla `(` di troppo.
pub const MAX_DEPTH: usize = 32;

/// Perché una riga non è una ricerca.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchFaultKind {
    UnclosedQuote,
    UnclosedRegex,
    UnclosedProperty,
    UnclosedGroup,
    UnexpectedClose,
    DanglingOr,
    EmptyValue,
    BadValue,
    NegatedGroup,
    TooComplex,
}

impl SearchFaultKind {
    /// L'etichetta stabile che attraversa la fixture e che la shell traduce.
    pub fn label(self) -> &'static str {
        match self {
            Self::UnclosedQuote => "unclosed-quote",
            Self::UnclosedRegex => "unclosed-regex",
            Self::UnclosedProperty => "unclosed-property",
            Self::UnclosedGroup => "unclosed-group",
            Self::UnexpectedClose => "unexpected-close",
            Self::DanglingOr => "dangling-or",
            Self::EmptyValue => "empty-value",
            Self::BadValue => "bad-value",
            Self::NegatedGroup => "negated-group",
            Self::TooComplex => "too-complex",
        }
    }
}

/// Un errore di sintassi e dove sta, in byte dall'inizio della riga.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SearchFault {
    pub kind: SearchFaultKind,
    pub at: usize,
}

fn fault(kind: SearchFaultKind, at: usize) -> SearchFault {
    SearchFault { kind, at }
}

/// Un pezzo della riga già riconosciuto.
enum Item {
    /// Una parola semplice, candidata a fondersi con le vicine.
    Word(String),
    Literal(QueryLiteral),
    Group(Vec<Vec<Item>>),
}

/// Una riga → l'espressione. `typing` dice che l'utente sta ancora scrivendo:
/// l'ultima parola semplice, se la riga non finisce con uno spazio, cerca anche
/// i prefissi (`partial_last_term`).
pub fn parse(input: &str, typing: bool) -> Result<QueryExpr, SearchFault> {
    let mut parser = Parser { src: input, pos: 0 };
    let alternatives = parser.alternatives(0)?;
    if parser.pos < input.len() {
        return Err(fault(SearchFaultKind::UnexpectedClose, parser.pos));
    }
    let partial = typing && !input.ends_with(char::is_whitespace);
    let mut clauses = Vec::new();
    for alternative in alternatives {
        clauses.extend(distribute(alternative, input.len())?);
    }
    if clauses.len() > MAX_CLAUSES {
        return Err(fault(SearchFaultKind::TooComplex, input.len()));
    }
    if partial {
        mark_partial(&mut clauses);
    }
    // Una riga vuota (o fatta solo di gruppi vuoti) è ogni documento, come
    // `QueryExpr::all()`.
    let clauses: Vec<QueryClause> = clauses.into_iter().filter(|c| !c.all.is_empty()).collect();
    Ok(QueryExpr { any: clauses })
}

/// La prefissa vale soltanto per l'ultimo predicato di testo semplice
/// (Terms, non negato) di ciascuna alternativa: è quello che si sta digitando.
fn mark_partial(clauses: &mut [QueryClause]) {
    for clause in clauses {
        if let Some(QueryLiteral {
            negated: false,
            predicate: QueryPredicate::Text(text),
        }) = clause.all.last_mut()
        {
            if text.mode == TextMode::Terms && text.fields.is_empty() && !text.case_sensitive {
                text.partial_last_term = true;
            }
        }
    }
}

/// Una sequenza AND di elementi → le sue clausole (prodotto dei gruppi).
fn distribute(items: Vec<Item>, end: usize) -> Result<Vec<QueryClause>, SearchFault> {
    let mut clauses = vec![QueryClause { all: Vec::new() }];
    let mut words: Vec<String> = Vec::new();
    let flush = |words: &mut Vec<String>, clauses: &mut Vec<QueryClause>| {
        if words.is_empty() {
            return;
        }
        let text = words.join(" ");
        words.clear();
        for clause in clauses.iter_mut() {
            clause.all.push(literal(
                false,
                text_predicate(text.clone(), TextMode::Terms, vec![], false),
            ));
        }
    };
    for item in items {
        match item {
            Item::Word(word) => words.push(word),
            Item::Literal(lit) => {
                flush(&mut words, &mut clauses);
                for clause in &mut clauses {
                    clause.all.push(lit.clone());
                }
            }
            Item::Group(alternatives) => {
                flush(&mut words, &mut clauses);
                let mut inner = Vec::new();
                for alternative in alternatives {
                    inner.extend(distribute(alternative, end)?);
                }
                let mut next = Vec::new();
                for clause in &clauses {
                    for extra in &inner {
                        let mut all = clause.all.clone();
                        all.extend(extra.all.iter().cloned());
                        next.push(QueryClause { all });
                    }
                    if inner.is_empty() {
                        next.push(clause.clone());
                    }
                }
                if next.len() > MAX_CLAUSES {
                    return Err(fault(SearchFaultKind::TooComplex, end));
                }
                clauses = next;
            }
        }
    }
    flush(&mut words, &mut clauses);
    if clauses.iter().any(|c| c.all.len() > MAX_LITERALS) {
        return Err(fault(SearchFaultKind::TooComplex, end));
    }
    Ok(clauses)
}

fn literal(negated: bool, predicate: QueryPredicate) -> QueryLiteral {
    QueryLiteral { negated, predicate }
}

fn text_predicate(
    text: String,
    mode: TextMode,
    fields: Vec<TextField>,
    case_sensitive: bool,
) -> QueryPredicate {
    QueryPredicate::Text(TextQuery {
        text,
        mode,
        fields,
        tolerance: Default::default(),
        partial_last_term: false,
        case_sensitive,
    })
}

struct Parser<'a> {
    src: &'a str,
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<char> {
        self.src[self.pos..].chars().next()
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if !c.is_whitespace() {
                break;
            }
            self.pos += c.len_utf8();
        }
    }

    /// Alternative separate da `OR`, fino a `)` (se `depth > 0`) o alla fine.
    fn alternatives(&mut self, depth: usize) -> Result<Vec<Vec<Item>>, SearchFault> {
        let mut alternatives = Vec::new();
        let mut current: Vec<Item> = Vec::new();
        let mut pending_or: Option<usize> = None;
        loop {
            self.skip_ws();
            let Some(c) = self.peek() else {
                if depth > 0 {
                    return Err(fault(SearchFaultKind::UnclosedGroup, self.src.len()));
                }
                break;
            };
            if c == ')' {
                if depth == 0 {
                    return Err(fault(SearchFaultKind::UnexpectedClose, self.pos));
                }
                self.pos += 1;
                break;
            }
            if self.at_or() {
                if current.is_empty() {
                    return Err(fault(SearchFaultKind::DanglingOr, self.pos));
                }
                pending_or = Some(self.pos);
                self.pos += 2;
                alternatives.push(std::mem::take(&mut current));
                continue;
            }
            pending_or = None;
            current.push(self.item(depth)?);
        }
        if let Some(at) = pending_or {
            return Err(fault(SearchFaultKind::DanglingOr, at));
        }
        alternatives.push(current);
        Ok(alternatives)
    }

    /// `OR` da solo: seguito da spazio, `(`, `)` o fine riga.
    fn at_or(&self) -> bool {
        let rest = &self.src[self.pos..];
        rest.starts_with("OR")
            && rest[2..]
                .chars()
                .next()
                .is_none_or(|c| c.is_whitespace() || c == '(' || c == ')')
    }

    fn item(&mut self, depth: usize) -> Result<Item, SearchFault> {
        let start = self.pos;
        let negated = self.peek() == Some('-')
            && self.src[self.pos + 1..]
                .chars()
                .next()
                .is_some_and(|c| !c.is_whitespace() && c != ')');
        if negated {
            self.pos += 1;
        }
        match self.peek() {
            Some('(') => {
                if negated {
                    return Err(fault(SearchFaultKind::NegatedGroup, start));
                }
                if depth >= MAX_DEPTH {
                    return Err(fault(SearchFaultKind::TooComplex, start));
                }
                self.pos += 1;
                Ok(Item::Group(self.alternatives(depth + 1)?))
            }
            Some('"') => {
                let phrase = self.quoted()?;
                Ok(Item::Literal(literal(
                    negated,
                    text_predicate(phrase, TextMode::Phrase, vec![], false),
                )))
            }
            Some('/') => {
                let pattern = self.regex()?;
                Ok(Item::Literal(literal(
                    negated,
                    QueryPredicate::Regex {
                        pattern,
                        fields: vec![],
                    },
                )))
            }
            Some('[') => Ok(Item::Literal(literal(negated, self.property()?))),
            _ => self.word_or_operator(negated),
        }
    }

    /// `"…"` con `\"` e `\\` come escape; la posizione è sulla virgoletta.
    fn quoted(&mut self) -> Result<String, SearchFault> {
        let open = self.pos;
        self.pos += 1;
        let mut out = String::new();
        let mut chars = self.src[self.pos..].char_indices();
        while let Some((i, c)) = chars.next() {
            match c {
                '\\' => {
                    if let Some((_, next)) = chars.next() {
                        out.push(next);
                    }
                }
                '"' => {
                    self.pos += i + 1;
                    return Ok(out);
                }
                other => out.push(other),
            }
        }
        Err(fault(SearchFaultKind::UnclosedQuote, open))
    }

    /// `/…/` con `\/` come barra letterale (le altre escape restano del regex).
    fn regex(&mut self) -> Result<String, SearchFault> {
        let open = self.pos;
        let body = &self.src[self.pos + 1..];
        let mut escaped = false;
        for (i, c) in body.char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            match c {
                '\\' => escaped = true,
                '/' => {
                    let pattern = body[..i].replace("\\/", "/");
                    if pattern.is_empty() {
                        return Err(fault(SearchFaultKind::EmptyValue, open));
                    }
                    self.pos += 1 + i + 1;
                    return Ok(pattern);
                }
                _ => {}
            }
        }
        Err(fault(SearchFaultKind::UnclosedRegex, open))
    }

    /// `[chiave]`, `[chiave:valore]`, `[chiave:>v]`, `[chiave:<v]`.
    fn property(&mut self) -> Result<QueryPredicate, SearchFault> {
        let open = self.pos;
        let body = &self.src[self.pos + 1..];
        let Some(close) = body.find(']') else {
            return Err(fault(SearchFaultKind::UnclosedProperty, open));
        };
        let inside = &body[..close];
        self.pos += 1 + close + 1;
        let (key, value) = match inside.split_once(':') {
            Some((key, value)) => (key.trim(), Some(value.trim())),
            None => (inside.trim(), None),
        };
        if key.is_empty() {
            return Err(fault(SearchFaultKind::EmptyValue, open));
        }
        let test = match value {
            None => PropertyTest::Exists,
            Some("") => return Err(fault(SearchFaultKind::EmptyValue, open)),
            Some(v) => {
                if let Some(rest) = v.strip_prefix('>') {
                    PropertyTest::GreaterThan(PropertyValue::from(comparable(rest.trim(), open)?))
                } else if let Some(rest) = v.strip_prefix('<') {
                    PropertyTest::LessThan(PropertyValue::from(comparable(rest.trim(), open)?))
                } else {
                    PropertyTest::Contains(scalar(unquote(v)))
                }
            }
        };
        Ok(QueryPredicate::Property {
            filter: PropertyFilter {
                key: key.to_string(),
                test,
            },
        })
    }

    fn word_or_operator(&mut self, negated: bool) -> Result<Item, SearchFault> {
        let start = self.pos;
        let rest = &self.src[self.pos..];
        let end = rest
            .char_indices()
            .find(|&(_, c)| c.is_whitespace() || c == '(' || c == ')')
            .map_or(rest.len(), |(i, _)| i);
        let word = &rest[..end];
        if let Some((name, value)) = word.split_once(':') {
            if let Some(op) = Operator::named(name) {
                self.pos += name.len() + 1;
                let (value, quoted) = if self.peek() == Some('"') {
                    (self.quoted()?, true)
                } else {
                    self.pos += value.len();
                    (value.to_string(), false)
                };
                if value.is_empty() {
                    return Err(fault(SearchFaultKind::EmptyValue, start));
                }
                let predicate = op
                    .predicate(value, quoted)
                    .ok_or(fault(SearchFaultKind::BadValue, start))?;
                return Ok(Item::Literal(literal(negated, predicate)));
            }
        }
        self.pos += end;
        if negated {
            return Ok(Item::Literal(literal(
                true,
                text_predicate(word.to_string(), TextMode::Terms, vec![], false),
            )));
        }
        Ok(Item::Word(word.to_string()))
    }
}

#[derive(Clone, Copy)]
enum Operator {
    Tag,
    Path,
    Folder,
    File,
    Content,
    Heading,
    Ext,
    Task,
    MatchCase,
}

impl Operator {
    fn named(name: &str) -> Option<Self> {
        Some(match name {
            "tag" => Self::Tag,
            "path" => Self::Path,
            "folder" => Self::Folder,
            "file" => Self::File,
            "content" => Self::Content,
            "heading" => Self::Heading,
            "ext" => Self::Ext,
            "task" => Self::Task,
            "match-case" => Self::MatchCase,
            _ => return None,
        })
    }

    fn predicate(self, value: String, quoted: bool) -> Option<QueryPredicate> {
        let mode = if quoted {
            TextMode::Phrase
        } else {
            TextMode::Terms
        };
        Some(match self {
            Self::Tag => {
                let name = value.trim_start_matches('#');
                if name.is_empty() || name.contains(char::is_whitespace) {
                    return None;
                }
                QueryPredicate::Tag {
                    name: name.to_string(),
                    descendants: true,
                }
            }
            Self::Path => QueryPredicate::Path {
                glob: if value.contains(['*', '?']) {
                    value
                } else {
                    format!("**{value}**")
                },
            },
            Self::Folder => {
                // La forma della cartella è quella di tutto il contratto.
                let path = crate::rules::folders::normalized(&value);
                if path.is_empty() {
                    return None;
                }
                QueryPredicate::Folder {
                    path: path.to_string(),
                    descendants: true,
                }
            }
            Self::File => text_predicate(value, mode, vec![TextField::Name], false),
            Self::Content => text_predicate(value, mode, vec![TextField::Body], false),
            Self::Heading => text_predicate(value, mode, vec![TextField::Heading], false),
            Self::MatchCase => text_predicate(value, mode, vec![], true),
            Self::Ext => {
                let extension = value.trim_start_matches('.');
                if extension.is_empty() || extension.contains(['/', '\\', '.']) {
                    return None;
                }
                QueryPredicate::File {
                    extension: extension.to_string(),
                }
            }
            Self::Task => QueryPredicate::Task {
                status: match value.as_str() {
                    "todo" | "open" => TaskStatus::Open,
                    "done" => TaskStatus::Done,
                    _ => return None,
                },
            },
        })
    }
}

fn unquote(v: &str) -> &str {
    v.strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(v)
}

/// Un valore da confrontare: vuoto non si confronta con niente.
fn comparable(v: &str, at: usize) -> Result<PropertyScalar, SearchFault> {
    if v.is_empty() {
        return Err(fault(SearchFaultKind::EmptyValue, at));
    }
    Ok(scalar(unquote(v)))
}

/// Numero, booleano, data ISO (`AAAA-MM-GG`) o testo, in quest'ordine.
fn scalar(v: &str) -> PropertyScalar {
    if let Some(date) = iso_date(v) {
        return PropertyScalar::Date(date);
    }
    match v {
        "true" => return PropertyScalar::Bool(true),
        "false" => return PropertyScalar::Bool(false),
        _ => {}
    }
    let numeric = !v.is_empty()
        && v.bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'+'))
        && v.bytes().any(|b| b.is_ascii_digit());
    if numeric {
        if let Ok(n) = v.parse::<f64>() {
            if n.is_finite() {
                return PropertyScalar::Number(n);
            }
        }
    }
    PropertyScalar::Text(v.to_string())
}

fn iso_date(v: &str) -> Option<PropertyDate> {
    let b = v.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u32> {
        let s = &v[r];
        s.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| s.parse().ok())?
    };
    let (year, month, day) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(PropertyDate {
        year: year as i32,
        month: month as u8,
        day: day as u8,
        time: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(expr: &QueryExpr) -> Vec<Vec<String>> {
        expr.any
            .iter()
            .map(|c| {
                c.all
                    .iter()
                    .map(|l| {
                        let sign = if l.negated { "-" } else { "" };
                        match &l.predicate {
                            QueryPredicate::Text(t) => {
                                format!("{sign}text:{}:{:?}:{:?}", t.text, t.mode, t.fields)
                            }
                            QueryPredicate::Tag { name, .. } => format!("{sign}tag:{name}"),
                            QueryPredicate::Path { glob } => format!("{sign}path:{glob}"),
                            QueryPredicate::Regex { pattern, .. } => format!("{sign}re:{pattern}"),
                            other => format!("{sign}{other:?}"),
                        }
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn words_merge_and_operators_split() {
        let e = parse("rosa rossa tag:#fiori -spine", false).unwrap();
        assert_eq!(
            texts(&e),
            vec![vec![
                "text:rosa rossa:Terms:[]".to_string(),
                "tag:fiori".to_string(),
                "-text:spine:Terms:[]".to_string(),
            ]]
        );
    }

    #[test]
    fn or_and_groups_distribute() {
        let e = parse("(a OR b) c", false).unwrap();
        assert_eq!(
            texts(&e),
            vec![
                vec!["text:a:Terms:[]".to_string(), "text:c:Terms:[]".to_string()],
                vec!["text:b:Terms:[]".to_string(), "text:c:Terms:[]".to_string()],
            ]
        );
    }

    #[test]
    fn faults_carry_their_place() {
        assert_eq!(
            parse("a \"b", false).unwrap_err(),
            fault(SearchFaultKind::UnclosedQuote, 2)
        );
        assert_eq!(
            parse("a OR", false).unwrap_err().kind,
            SearchFaultKind::DanglingOr
        );
        assert_eq!(
            parse("a)", false).unwrap_err(),
            fault(SearchFaultKind::UnexpectedClose, 1)
        );
        assert_eq!(
            parse("-(a)", false).unwrap_err().kind,
            SearchFaultKind::NegatedGroup
        );
        assert_eq!(
            parse("task:forse", false).unwrap_err().kind,
            SearchFaultKind::BadValue
        );
        assert_eq!(
            parse("[k:]", false).unwrap_err().kind,
            SearchFaultKind::EmptyValue
        );
    }

    #[test]
    fn unknown_names_and_times_stay_text() {
        let e = parse("ore 10:30 https://x.it", false).unwrap();
        assert_eq!(
            texts(&e),
            vec![vec!["text:ore 10:30 https://x.it:Terms:[]".to_string()]]
        );
    }

    #[test]
    fn typing_marks_only_the_word_being_written() {
        let e = parse("tag:a pro", true).unwrap();
        let QueryPredicate::Text(t) = &e.any[0].all[1].predicate else {
            panic!()
        };
        assert!(t.partial_last_term);
        let e = parse("pro ", true).unwrap();
        let QueryPredicate::Text(t) = &e.any[0].all[0].predicate else {
            panic!()
        };
        assert!(!t.partial_last_term);
    }

    #[test]
    fn empty_is_everything() {
        assert_eq!(parse("   ", false).unwrap(), QueryExpr::all());
    }

    #[test]
    fn a_deep_nest_is_a_fault_not_a_stack_overflow() {
        let hostile = "(".repeat(100_000);
        assert_eq!(
            parse(&hostile, false),
            Err(fault(SearchFaultKind::TooComplex, MAX_DEPTH))
        );
        let deepest = format!("{}a{}", "(".repeat(MAX_DEPTH), ")".repeat(MAX_DEPTH));
        assert!(parse(&deepest, false).is_ok());
    }
}
