//! Le toppe mirate del `.base`: una modifica di una vista cambia solo le
//! righe della sua chiave, e ogni altro byte del file resta com'era.
//!
//! Il `.base` è YAML scritto a mano: commenti, ordine delle chiavi, virgolette
//! e rientri sono di chi lo scrive. Riscriverlo dal modello li perderebbe, e
//! per questo la toppa non rigenera il documento: lavora sulle righe della
//! vista che cambia e restituisce le modifiche di testo con lo span di ogni
//! riga toccata.
//!
//! La toppa legge il testo a righe e accetta solo la forma che sa toccare con
//! sicurezza: blocchi con l'indentazione, nessuna ancora, nessun alias, nessuna
//! tabulazione, un solo documento. Dove la forma non basta (YAML di flusso
//! sulla chiave toccata, un'indentazione che non si riconosce) non scrive e
//! lo dice con un [`PatchError`].
//!
//! Prima di restituire una toppa, il testo nuovo deve rileggersi come
//! [`BaseDefinition`] valida e il suo albero YAML deve essere quello del file
//! di prima con la sola modifica chiesta. Se non lo è, la toppa non esce.

use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::model::Span;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use thiserror::Error;

use crate::model::{
    BaseDefinition, BaseError, FilterDef, GroupDef, MapDef, SortDef, SummaryDef, ViewType,
    MAX_BASE_SOURCE_BYTES,
};

#[cfg(test)]
mod tests;

/// Una chiave di vista che una toppa può scrivere. L'ordine è quello di
/// [`BaseViewDef`](crate::model::BaseViewDef): una chiave nuova va al posto
/// che le spetta fra quelle che ci sono già.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewKey {
    Name,
    Type,
    Order,
    Filters,
    Sort,
    Group,
    Summaries,
    Limit,
    Search,
    Map,
}

impl ViewKey {
    const ALL: [ViewKey; 10] = [
        ViewKey::Name,
        ViewKey::Type,
        ViewKey::Order,
        ViewKey::Filters,
        ViewKey::Sort,
        ViewKey::Group,
        ViewKey::Summaries,
        ViewKey::Limit,
        ViewKey::Search,
        ViewKey::Map,
    ];

    /// Il nome della chiave nel file.
    pub fn as_str(self) -> &'static str {
        match self {
            ViewKey::Name => "name",
            ViewKey::Type => "type",
            ViewKey::Order => "order",
            ViewKey::Filters => "filters",
            ViewKey::Sort => "sort",
            ViewKey::Group => "group",
            ViewKey::Summaries => "summaries",
            ViewKey::Limit => "limit",
            ViewKey::Search => "search",
            ViewKey::Map => "map",
        }
    }

    /// La chiave che ha questo nome, se è una che una toppa scrive.
    pub fn parse(name: &str) -> Option<ViewKey> {
        ViewKey::ALL.into_iter().find(|key| key.as_str() == name)
    }

    fn rank(self) -> usize {
        ViewKey::ALL
            .iter()
            .position(|key| *key == self)
            .unwrap_or(0)
    }

    /// `name` e `type` ci sono in ogni vista: una toppa non le toglie.
    fn required(self) -> bool {
        matches!(self, ViewKey::Name | ViewKey::Type)
    }

    /// Il valore ha la forma che il modello dà alla chiave.
    fn accepts(self, value: &Value) -> bool {
        match self {
            ViewKey::Name => value.as_str().is_some_and(|name| !name.trim().is_empty()),
            ViewKey::Type => fits::<ViewType>(value),
            ViewKey::Order => fits::<Vec<String>>(value),
            ViewKey::Filters => fits::<FilterDef>(value),
            ViewKey::Sort => fits::<Vec<SortDef>>(value),
            ViewKey::Group => fits::<GroupDef>(value),
            ViewKey::Summaries => fits::<Vec<SummaryDef>>(value),
            ViewKey::Limit => fits::<u32>(value),
            ViewKey::Search => fits::<String>(value),
            ViewKey::Map => fits::<MapDef>(value),
        }
    }
}

fn fits<T: DeserializeOwned>(value: &Value) -> bool {
    serde_json::from_value::<T>(value.clone()).is_ok()
}

/// Una modifica al file: una chiave di una vista, una vista in più, una vista
/// in meno.
#[derive(Clone, Debug, PartialEq)]
pub enum BaseChange {
    /// Scrive la chiave `key` della vista `view`. Senza valore (o con `null`)
    /// la toglie.
    SetKey {
        view: String,
        key: ViewKey,
        value: Option<Value>,
    },
    /// Aggiunge in fondo alla lista una vista con nome e tipo; le altre chiavi
    /// si scrivono dopo, con [`BaseChange::SetKey`].
    AddView { name: String, view_type: ViewType },
    /// Toglie la vista `view` con tutte le sue chiavi.
    RemoveView { view: String },
}

/// Perché una toppa non scrive.
#[derive(Debug, Error)]
pub enum PatchError {
    /// Il file non si legge come `.base`: nessuna toppa si applica a ciò che
    /// il modello rifiuta.
    #[error("il file non si legge come .base")]
    Unreadable,
    /// Il file o il risultato supera un limite o una regola del modello.
    #[error("il modello .base rifiuta il risultato: {0}")]
    Model(BaseError),
    #[error("la vista «{0}» non c'è")]
    NoView(String),
    #[error("la vista «{0}» c'è già")]
    DuplicateView(String),
    #[error("la chiave {0:?} non si toglie")]
    RequiredKey(ViewKey),
    #[error("il valore non va bene per la chiave {0:?}")]
    BadValue(ViewKey),
    /// Un costrutto della riga che la toppa non sa cambiare senza riscrivere.
    #[error("riga {line}: {construct:?}")]
    Unsafe { line: usize, construct: Construct },
    /// Una chiave, una vista o la lista delle viste scritta come YAML di
    /// flusso: si cambia dal sorgente, non da qui.
    #[error("YAML di flusso in {place:?}")]
    Flow { place: Place },
    /// La rilettura del file scritto non dà l'albero atteso.
    #[error("la rilettura non dà la definizione attesa")]
    Verify,
}

/// Dove sta il YAML di flusso che ha fermato la toppa.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    /// La chiave `key` di una vista.
    Key(ViewKey),
    /// Una vista intera, come voce di lista in flusso.
    View,
    /// La lista delle viste, `views: [...]`.
    Views,
}

/// Il costrutto che ha fermato la toppa.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Construct {
    /// Una tabulazione nell'indentazione.
    Tab,
    /// Un'ancora o un alias (`&x`, `*x`).
    Anchor,
    /// Un'etichetta (`!tag`).
    Tag,
    /// Una direttiva `%…` o un fine documento `...`.
    Directive,
    /// Più di un documento YAML nel file.
    Documents,
    /// Un'indentazione che non è né di una chiave né del suo valore.
    Indentation,
    /// Una riga dentro una vista che non è una chiave.
    NotAKey,
    /// Una chiave ripetuta nella stessa vista.
    RepeatedKey,
    /// Le viste non sono una lista di blocco (né `views: []`).
    ViewsShape,
}

/// Le modifiche di testo che cambiano `source` come chiede `change`.
///
/// Un vettore vuoto vuol dire che il file è già così: niente da scrivere. Le
/// modifiche sono disgiunte e vanno tutte sulla revisione di `source`, in
/// un'unica richiesta di modifica.
pub fn apply(source: &str, change: &BaseChange) -> Result<Vec<TextEdit>, PatchError> {
    // Prima i costrutti che non si toccano, poi il modello: un file con due
    // documenti è rifiutato per quello che è, non per il modello che non legge.
    let doc = Doc::read(source)?;
    let root = parse_root(source)?;
    let views = doc.views(&root)?;
    let now = root
        .get("views")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut expected = root.clone();
    let splices = match change {
        BaseChange::SetKey { view, key, value } => {
            let index = position(&now, view)?;
            let value = value
                .as_ref()
                .filter(|value| !value.is_null())
                .map(strip_nulls);
            if value.is_none() && key.required() {
                return Err(PatchError::RequiredKey(*key));
            }
            if let Some(value) = &value {
                check_value(*key, value)?;
            }
            if let (ViewKey::Name, Some(name)) = (*key, value.as_ref().and_then(Value::as_str)) {
                if taken(&now, name, Some(index)) {
                    return Err(PatchError::DuplicateView(name.to_string()));
                }
            }
            let current = now.get(index).and_then(|view| view.get(key.as_str()));
            if current == value.as_ref() {
                return Ok(Vec::new());
            }
            let items = views.items(now.len())?;
            let map = expected_views(&mut expected)?
                .get_mut(index)
                .and_then(Value::as_object_mut)
                .ok_or(PatchError::Verify)?;
            match &value {
                Some(value) => {
                    map.insert(key.as_str().to_string(), value.clone());
                }
                None => {
                    map.remove(key.as_str());
                }
            }
            let item = items.get(index).ok_or(PatchError::Verify)?;
            set_key_splices(&doc, item, *key, value)?
        }
        BaseChange::AddView { name, view_type } => {
            check_value(ViewKey::Name, &Value::String(name.clone()))?;
            if taken(&now, name, None) {
                return Err(PatchError::DuplicateView(name.clone()));
            }
            let view = json!({ "name": name, "type": view_type });
            expected_views_or_create(&mut expected)?.push(view);
            add_view_splices(&doc, &views, name, *view_type)?
        }
        BaseChange::RemoveView { view } => {
            let index = position(&now, view)?;
            let items = views.items(now.len())?;
            expected_views(&mut expected)?.remove(index);
            remove_view_splices(&doc, &views, items, index)?
        }
    };
    finish(source, &doc, &root, &expected, splices)
}

/// Il file come lo legge il modello, o la ragione per cui non si tocca.
fn parse_root(source: &str) -> Result<Value, PatchError> {
    match BaseDefinition::parse(source) {
        Ok(_) => {}
        Err(error @ BaseError::Limit { .. }) => return Err(PatchError::Model(error)),
        Err(_) => return Err(PatchError::Unreadable),
    }
    serde_yaml_ng::from_str(source).map_err(|_| PatchError::Unreadable)
}

fn position(views: &[Value], name: &str) -> Result<usize, PatchError> {
    views
        .iter()
        .position(|view| view.get("name").and_then(Value::as_str) == Some(name))
        .ok_or_else(|| PatchError::NoView(name.to_string()))
}

fn taken(views: &[Value], name: &str, except: Option<usize>) -> bool {
    views.iter().enumerate().any(|(index, view)| {
        Some(index) != except && view.get("name").and_then(Value::as_str) == Some(name)
    })
}

/// Le viste dell'albero atteso. Il modello le ha già lette come lista, quindi
/// un'assenza qui è un errore di verifica e non un caso da gestire.
fn expected_views(root: &mut Value) -> Result<&mut Vec<Value>, PatchError> {
    root.get_mut("views")
        .and_then(Value::as_array_mut)
        .ok_or(PatchError::Verify)
}

fn expected_views_or_create(root: &mut Value) -> Result<&mut Vec<Value>, PatchError> {
    root.as_object_mut()
        .ok_or(PatchError::Verify)?
        .entry("views")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or(PatchError::Verify)
}

/// Toglie i `null` dalle mappe: un campo assente e uno `null` sono la stessa
/// cosa per il modello, e così il YAML scritto non porta `file: null`.
fn strip_nulls(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(_, value)| !value.is_null())
                .map(|(key, value)| (key.clone(), strip_nulls(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(strip_nulls).collect()),
        other => other.clone(),
    }
}

/// Un valore che va in una riga del YAML non ha a capo né caratteri di
/// controllo, e ha la forma che la chiave chiede.
fn check_value(key: ViewKey, value: &Value) -> Result<(), PatchError> {
    if !printable(value) || !key.accepts(value) {
        return Err(PatchError::BadValue(key));
    }
    Ok(())
}

fn printable(value: &Value) -> bool {
    match value {
        Value::String(text) => !text.chars().any(char::is_control),
        Value::Array(items) => items.iter().all(printable),
        Value::Object(map) => map
            .iter()
            .all(|(key, value)| !key.chars().any(char::is_control) && printable(value)),
        _ => true,
    }
}

// ---------------------------------------------------------------------------
// Il testo, a righe
// ---------------------------------------------------------------------------

/// Una sostituzione di righe: `lines[start..end]` diventano `with`. Le righe
/// di `with` portano già la loro fine.
#[derive(Debug)]
struct Splice {
    start: usize,
    end: usize,
    with: Vec<String>,
}

/// Un blocco di vista: la riga del trattino, quella dopo l'ultima di contenuto,
/// e la colonna del trattino.
#[derive(Clone, Copy, Debug)]
struct Item {
    start: usize,
    end: usize,
    dash: usize,
}

/// Una chiave di vista: la riga dove sta, la colonna dove comincia (la stessa
/// per tutte le chiavi della vista), la posizione dei due punti.
#[derive(Clone, Debug)]
struct Key {
    name: String,
    raw: String,
    line: usize,
    col: usize,
    colon: usize,
}

/// Dov'è la chiave `views` nel file.
enum Views {
    /// Il file non ha una chiave `views` in forma di blocco (e non la ha
    /// nemmeno il modello).
    Absent,
    /// `views: []`, anche con un commento.
    Empty { key: usize, colon: usize },
    /// Una lista di blocco, con le sue viste.
    Block {
        key: usize,
        colon: usize,
        items: Vec<Item>,
    },
}

impl Views {
    /// Le viste come blocchi, se sono tante quante le legge il modello.
    fn items(&self, count: usize) -> Result<&[Item], PatchError> {
        match self {
            Views::Block { items, .. } if items.len() == count => Ok(items.as_slice()),
            Views::Absent | Views::Empty { .. } if count == 0 => Ok(&[]),
            Views::Block { key, .. } => Err(PatchError::Unsafe {
                line: key + 1,
                construct: Construct::ViewsShape,
            }),
            Views::Absent | Views::Empty { .. } => Err(PatchError::Unsafe {
                line: 1,
                construct: Construct::ViewsShape,
            }),
        }
    }
}

/// Il file a righe, con la sua fine di riga e la chiave `views` di primo
/// livello, già controllato per i costrutti che la toppa non tocca.
struct Doc<'a> {
    lines: Vec<&'a str>,
    offsets: Vec<usize>,
    eol: &'static str,
    views_key: Option<(usize, usize)>,
}

impl<'a> Doc<'a> {
    fn read(source: &'a str) -> Result<Doc<'a>, PatchError> {
        let lines: Vec<&str> = source.split_inclusive('\n').collect();
        let eol = if source.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let mut offsets = Vec::with_capacity(lines.len() + 1);
        let mut at = 0;
        offsets.push(at);
        for line in &lines {
            at += line.len();
            offsets.push(at);
        }
        let mut views_key = None;
        let mut seen_content = false;
        for (index, raw) in lines.iter().enumerate() {
            let text = content(raw);
            if is_blank(text) || is_comment(text) {
                continue;
            }
            let fail = |construct| PatchError::Unsafe {
                line: index + 1,
                construct,
            };
            let lead = text.len() - text.trim_start_matches([' ', '\t']).len();
            if text[..lead].contains('\t') {
                return Err(fail(Construct::Tab));
            }
            let body = text.trim_start();
            if body.starts_with('%') || body == "..." || body.starts_with("... ") {
                return Err(fail(Construct::Directive));
            }
            if body == "---" || body.starts_with("--- ") {
                if seen_content || (body != "---" && !body["--- ".len()..].trim().starts_with('#'))
                {
                    return Err(fail(Construct::Documents));
                }
                seen_content = true;
                continue;
            }
            seen_content = true;
            if let Some(construct) = node_property(strip_comment(text)) {
                return Err(fail(construct));
            }
            if indent_of(text) == 0 {
                if let Some(key) = key_at(text, 0) {
                    if key.name == "views" {
                        if views_key.is_some() {
                            return Err(fail(Construct::RepeatedKey));
                        }
                        views_key = Some((index, key.colon));
                    }
                }
            }
        }
        Ok(Doc {
            lines,
            offsets,
            eol,
            views_key,
        })
    }

    fn views(&self, root: &Value) -> Result<Views, PatchError> {
        let Some((key, colon)) = self.views_key else {
            if root.get("views").is_some() {
                return Err(PatchError::Unsafe {
                    line: 1,
                    construct: Construct::ViewsShape,
                });
            }
            return Ok(Views::Absent);
        };
        let code = code_of(&content(self.lines[key])[colon + 1..]).trim();
        if code.is_empty() {
            let items = self.items(key + 1)?;
            return Ok(Views::Block { key, colon, items });
        }
        if code == "[]" {
            return Ok(Views::Empty { key, colon });
        }
        if code.starts_with('[') || code.starts_with('{') {
            return Err(PatchError::Flow {
                place: Place::Views,
            });
        }
        Err(PatchError::Unsafe {
            line: key + 1,
            construct: Construct::ViewsShape,
        })
    }

    /// I blocchi della lista che comincia dopo `from`. Le righe di commento e
    /// le vuote fra i blocchi non appartengono a nessuno.
    fn items(&self, from: usize) -> Result<Vec<Item>, PatchError> {
        let mut first: Option<usize> = None;
        let mut starts = Vec::new();
        let mut last = None;
        for index in from..self.lines.len() {
            let text = content(self.lines[index]);
            if is_blank(text) || is_comment(text) {
                continue;
            }
            let indent = indent_of(text);
            match first {
                None => {
                    if !is_dash(text, indent) {
                        return Err(PatchError::Unsafe {
                            line: index + 1,
                            construct: Construct::ViewsShape,
                        });
                    }
                    first = Some(indent);
                    starts.push(index);
                    last = Some(index);
                }
                Some(dash) => {
                    if indent == dash && is_dash(text, dash) {
                        starts.push(index);
                        last = Some(index);
                    } else if indent > dash {
                        last = Some(index);
                    } else {
                        break;
                    }
                }
            }
        }
        let (Some(dash), Some(last)) = (first, last) else {
            return Err(PatchError::Unsafe {
                line: from + 1,
                construct: Construct::ViewsShape,
            });
        };
        let mut items = Vec::with_capacity(starts.len());
        for (position, &start) in starts.iter().enumerate() {
            let limit = starts.get(position + 1).copied().unwrap_or(last + 1);
            items.push(Item {
                start,
                end: self.content_end(start, limit),
                dash,
            });
        }
        Ok(items)
    }

    /// La riga dopo l'ultima di contenuto fra `start` (inclusa) e `limit`
    /// (esclusa): è la fine del blocco senza i commenti e le vuote in coda.
    fn content_end(&self, start: usize, limit: usize) -> usize {
        (start..limit)
            .rev()
            .find(|&index| {
                let text = content(self.lines[index]);
                !is_blank(text) && !is_comment(text)
            })
            .map_or(start + 1, |index| index + 1)
    }

    /// Le chiavi di una vista, con la colonna in cui stanno.
    fn keys(&self, item: &Item) -> Result<(usize, Vec<Key>), PatchError> {
        let first = content(self.lines[item.start]);
        let after = &first[item.dash + 1..];
        let spaces = after.len() - after.trim_start_matches(' ').len();
        let rest = &after[spaces..];
        let inline = !(rest.is_empty() || rest.starts_with('#'));
        if inline && (rest.starts_with('{') || rest.starts_with('[')) {
            return Err(PatchError::Flow { place: Place::View });
        }
        let col = if inline {
            item.dash + 1 + spaces
        } else {
            let next = (item.start + 1..item.end)
                .map(|index| content(self.lines[index]))
                .find(|text| !is_blank(text) && !is_comment(text));
            match next {
                Some(text) => indent_of(text),
                None => {
                    return Err(PatchError::Unsafe {
                        line: item.start + 1,
                        construct: Construct::NotAKey,
                    })
                }
            }
        };
        let mut keys: Vec<Key> = Vec::new();
        for index in item.start..item.end {
            let text = content(self.lines[index]);
            if is_blank(text) || is_comment(text) {
                continue;
            }
            if index == item.start {
                if !inline {
                    continue;
                }
            } else {
                let indent = indent_of(text);
                if indent > col {
                    continue;
                }
                if indent < col {
                    return Err(PatchError::Unsafe {
                        line: index + 1,
                        construct: Construct::Indentation,
                    });
                }
                if is_dash(text, col) {
                    return Err(PatchError::Unsafe {
                        line: index + 1,
                        construct: Construct::Indentation,
                    });
                }
            }
            let key = key_at(text, col).ok_or(PatchError::Unsafe {
                line: index + 1,
                construct: Construct::NotAKey,
            })?;
            if keys.iter().any(|other| other.name == key.name) {
                return Err(PatchError::Unsafe {
                    line: index + 1,
                    construct: Construct::RepeatedKey,
                });
            }
            keys.push(Key {
                name: key.name,
                raw: key.raw,
                line: index,
                col,
                colon: key.colon,
            });
        }
        Ok((col, keys))
    }

    /// Le righe della chiave `keys[position]`: dalla sua riga fino alla prima
    /// riga di contenuto prima della chiave successiva (o della fine del
    /// blocco). I commenti in coda restano fuori.
    fn key_span(&self, keys: &[Key], position: usize, end: usize) -> (usize, usize) {
        let start = keys[position].line;
        let bound = keys.get(position + 1).map_or(end, |key| key.line);
        (start, self.content_end(start, bound).max(start + 1))
    }

    /// Dove va una chiave nuova: prima della prima chiave che viene dopo in
    /// ordine (e prima dei commenti che le stanno attaccati), altrimenti in
    /// fondo alla vista. La riga del trattino non si tocca mai.
    fn insertion_point(&self, item: &Item, keys: &[Key], key: ViewKey) -> usize {
        let next = keys
            .iter()
            .enumerate()
            .filter(|(_, other)| other.line != item.start)
            .find(|(_, other)| {
                ViewKey::parse(&other.name).is_some_and(|other| other.rank() > key.rank())
            })
            .map(|(position, _)| position);
        match next {
            None => item.end,
            Some(position) => {
                let floor = if position == 0 {
                    item.start + 1
                } else {
                    self.key_span(keys, position - 1, item.end).1
                };
                let mut at = keys[position].line;
                while at > floor && is_comment(content(self.lines[at - 1])) {
                    at -= 1;
                }
                at
            }
        }
    }

    /// Una riga nuova in `at`: se la riga prima non ha a capo (fine file), la
    /// chiude prima, così il file resta fatto di righe.
    fn insert_at(&self, at: usize, mut rows: Vec<String>) -> Splice {
        if at > 0 && !self.lines[at - 1].ends_with('\n') {
            // È la fine del file senza a capo: il capo che manca va fra le due
            // righe, e l'ultima riga nuova resta senza, come l'ultima di prima.
            if let Some(last) = rows.last_mut() {
                let cut = last.len() - ending(last).len();
                last.truncate(cut);
            }
            let mut with = vec![format!("{}{}", self.lines[at - 1], self.eol)];
            with.extend(rows);
            Splice {
                start: at - 1,
                end: at,
                with,
            }
        } else {
            Splice {
                start: at,
                end: at,
                with: rows,
            }
        }
    }

    /// Le sostituzioni di riga come modifiche di testo, nell'ordine del file.
    fn edits(&self, mut splices: Vec<Splice>) -> Vec<TextEdit> {
        splices.sort_by_key(|splice| splice.start);
        splices
            .into_iter()
            .filter(|splice| !(splice.start == splice.end && splice.with.is_empty()))
            .map(|splice| {
                TextEdit::replace(
                    Span::new(self.offsets[splice.start], self.offsets[splice.end]),
                    splice.with.concat(),
                )
            })
            .collect()
    }
}

fn set_key_splices(
    doc: &Doc<'_>,
    item: &Item,
    key: ViewKey,
    value: Option<Value>,
) -> Result<Vec<Splice>, PatchError> {
    let (col, keys) = doc.keys(item)?;
    let found = keys.iter().position(|other| other.name == key.as_str());
    match (found, value) {
        (Some(position), value) => {
            let (start, end) = doc.key_span(&keys, position, item.end);
            let existing = &keys[position];
            let on_line = &content(doc.lines[start])[existing.colon + 1..];
            let head = if code_of(on_line).trim().is_empty() {
                (start + 1..end)
                    .map(|index| content(doc.lines[index]))
                    .find(|text| !is_blank(text) && !is_comment(text))
                    .and_then(|text| text.trim_start().chars().next())
            } else {
                code_of(on_line).trim().chars().next()
            };
            if matches!(head, Some('[' | '{')) {
                return Err(PatchError::Flow {
                    place: Place::Key(key),
                });
            }
            match value {
                None => Ok(vec![Splice {
                    start,
                    end,
                    with: Vec::new(),
                }]),
                Some(value) => {
                    let prefix = &content(doc.lines[start])[..existing.col];
                    let rows = render_key(
                        &existing.raw,
                        prefix,
                        &value,
                        comment_of(on_line),
                        existing.col,
                    )?;
                    Ok(vec![Splice {
                        start,
                        end,
                        with: terminate(rows, doc.eol, ending(doc.lines[end - 1])),
                    }])
                }
            }
        }
        (None, None) => Ok(Vec::new()),
        (None, Some(value)) => {
            let at = doc.insertion_point(item, &keys, key);
            let rows = render_key(key.as_str(), &" ".repeat(col), &value, "", col)?;
            Ok(vec![doc.insert_at(at, terminate(rows, doc.eol, doc.eol))])
        }
    }
}

fn add_view_splices(
    doc: &Doc<'_>,
    views: &Views,
    name: &str,
    view_type: ViewType,
) -> Result<Vec<Splice>, PatchError> {
    let view = json!({ "name": name, "type": view_type });
    match views {
        Views::Absent => {
            let mut rows = vec!["views:".to_string()];
            rows.extend(item_rows(2, &view)?);
            Ok(vec![doc.insert_at(
                doc.lines.len(),
                terminate(rows, doc.eol, doc.eol),
            )])
        }
        Views::Empty { key, colon } => {
            let comment = comment_of(&content(doc.lines[*key])[colon + 1..]);
            let mut rows = vec![format!("views:{comment}")];
            rows.extend(item_rows(2, &view)?);
            Ok(vec![Splice {
                start: *key,
                end: key + 1,
                with: terminate(rows, doc.eol, ending(doc.lines[*key])),
            }])
        }
        Views::Block { items, .. } => {
            let first = items.first().ok_or(PatchError::Unsafe {
                line: 1,
                construct: Construct::ViewsShape,
            })?;
            let last = items.last().map_or(first.end, |item| item.end);
            let rows = item_rows(first.dash, &view)?;
            Ok(vec![doc.insert_at(last, terminate(rows, doc.eol, doc.eol))])
        }
    }
}

fn remove_view_splices(
    doc: &Doc<'_>,
    views: &Views,
    items: &[Item],
    index: usize,
) -> Result<Vec<Splice>, PatchError> {
    let item = *items.get(index).ok_or(PatchError::Verify)?;
    let remove = Splice {
        start: item.start,
        end: item.end,
        with: Vec::new(),
    };
    Ok(match views {
        // Tolta l'ultima vista la lista non si può lasciare vuota: il modello
        // legge `views:` senza niente come nulla, e `views: []` è la lista
        // vuota che resta.
        Views::Block { key, colon, .. } if items.len() == 1 => {
            let comment = comment_of(&content(doc.lines[*key])[colon + 1..]);
            vec![
                Splice {
                    start: *key,
                    end: key + 1,
                    with: terminate(
                        vec![format!("views: []{comment}")],
                        doc.eol,
                        ending(doc.lines[*key]),
                    ),
                },
                remove,
            ]
        }
        _ => vec![remove],
    })
}

/// La riga di una chiave con il suo valore. Un valore in una riga sola resta
/// sulla riga della chiave; un blocco va sotto, indentato di due spazi.
fn render_key(
    raw: &str,
    prefix: &str,
    value: &Value,
    comment: &str,
    col: usize,
) -> Result<Vec<String>, PatchError> {
    let body = yaml_body(value)?;
    // Una lista o una mappa piena va sotto la chiave anche se il suo YAML è
    // una riga sola: `- x` non sta dopo `chiave: `.
    if let [one] = body.as_slice() {
        if !is_block(value) {
            return Ok(vec![format!("{prefix}{raw}: {one}{comment}")]);
        }
    }
    let mut rows = vec![format!("{prefix}{raw}:{comment}")];
    rows.extend(
        body.iter()
            .map(|line| format!("{}{line}", " ".repeat(col + 2))),
    );
    Ok(rows)
}

/// Una lista o una mappa con voci va su più righe, sotto la chiave.
fn is_block(value: &Value) -> bool {
    match value {
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
        _ => false,
    }
}

/// La vista come blocco di una voce di lista, col trattino a colonna `dash`.
fn item_rows(dash: usize, view: &Value) -> Result<Vec<String>, PatchError> {
    let body = yaml_body(view)?;
    Ok(body
        .into_iter()
        .enumerate()
        .map(|(index, line)| {
            if index == 0 {
                format!("{}- {line}", " ".repeat(dash))
            } else {
                format!("{}{line}", " ".repeat(dash + 2))
            }
        })
        .collect())
}

/// Il YAML di un valore, riga per riga, senza il marcatore di documento.
fn yaml_body(value: &Value) -> Result<Vec<String>, PatchError> {
    let text = serde_yaml_ng::to_string(value).map_err(|_| PatchError::Verify)?;
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    if lines.first().is_some_and(|line| line == "---") {
        lines.remove(0);
    } else if let Some(first) = lines.first_mut() {
        if let Some(rest) = first.strip_prefix("--- ") {
            *first = rest.to_string();
        }
    }
    if lines.last().is_some_and(|line| line == "...") {
        lines.pop();
    }
    if lines.is_empty() {
        return Err(PatchError::Verify);
    }
    Ok(lines)
}

/// Le righe nuove con la loro fine: l'ultima prende `last`, così un file che
/// finisce senza a capo finisce così anche dopo la toppa.
fn terminate(rows: Vec<String>, eol: &str, last: &str) -> Vec<String> {
    let count = rows.len();
    rows.into_iter()
        .enumerate()
        .map(|(index, row)| {
            let end = if index + 1 == count { last } else { eol };
            format!("{row}{end}")
        })
        .collect()
}

/// La fine di riga di una riga del file (vuota se è l'ultima senza a capo).
fn ending(line: &str) -> &str {
    if line.ends_with("\r\n") {
        "\r\n"
    } else if line.ends_with('\n') {
        "\n"
    } else {
        ""
    }
}

/// Il contenuto di una riga, senza la sua fine di riga.
fn content(line: &str) -> &str {
    let line = line.strip_suffix('\n').unwrap_or(line);
    line.strip_suffix('\r').unwrap_or(line)
}

fn is_blank(text: &str) -> bool {
    text.trim().is_empty()
}

fn is_comment(text: &str) -> bool {
    text.trim_start().starts_with('#')
}

fn indent_of(text: &str) -> usize {
    text.len() - text.trim_start_matches(' ').len()
}

/// Un trattino di lista alla colonna `col` (da solo o seguito da spazio).
fn is_dash(text: &str, col: usize) -> bool {
    match text.get(col..) {
        Some(rest) => rest == "-" || rest.starts_with("- "),
        None => false,
    }
}

/// La prima posizione di un `#` che apre un commento, cioè preceduto da uno
/// spazio, fuori dalle virgolette del valore.
fn comment_start(value: &str) -> Option<usize> {
    let lead = value.len() - value.trim_start().len();
    let body = &value[lead..];
    let from = if body.starts_with('"') || body.starts_with('\'') {
        let quote = body.as_bytes()[0];
        let bytes = body.as_bytes();
        let mut index = 1;
        while index < bytes.len() {
            if quote == b'"' && bytes[index] == b'\\' {
                index += 2;
                continue;
            }
            if bytes[index] == quote {
                if quote == b'\'' && bytes.get(index + 1) == Some(&b'\'') {
                    index += 2;
                    continue;
                }
                break;
            }
            index += 1;
        }
        lead + index + 1
    } else {
        0
    };
    find_hash(value, from)
}

fn find_hash(value: &str, from: usize) -> Option<usize> {
    let bytes = value.as_bytes();
    (from..bytes.len()).find(|&index| {
        bytes[index] == b'#' && index > 0 && matches!(bytes[index - 1], b' ' | b'\t')
    })
}

/// Il valore senza il commento di fine riga.
fn code_of(value: &str) -> &str {
    match comment_start(value) {
        Some(hash) => &value[..hash],
        None => value,
    }
}

/// Il commento di fine riga, con lo spazio che lo precede, com'era scritto.
fn comment_of(value: &str) -> &str {
    match comment_start(value) {
        Some(hash) => {
            let bytes = value.as_bytes();
            let mut start = hash;
            while start > 0 && matches!(bytes[start - 1], b' ' | b'\t') {
                start -= 1;
            }
            &value[start..]
        }
        None => "",
    }
}

/// Una riga senza il commento, per cercarvi i costrutti che non si toccano.
fn strip_comment(text: &str) -> &str {
    match find_hash(text, 0) {
        Some(hash) => &text[..hash],
        None => text,
    }
}

/// Un'ancora, un alias o un'etichetta in posizione di nodo. Il controllo è
/// volutamente largo: meglio non scrivere che scrivere su un costrutto che non
/// si conosce.
fn node_property(code: &str) -> Option<Construct> {
    let bytes = code.as_bytes();
    for (index, &byte) in bytes.iter().enumerate() {
        if !matches!(byte, b'&' | b'*' | b'!') {
            continue;
        }
        let before = code[..index]
            .trim_end_matches([' ', '\t'])
            .chars()
            .next_back();
        let in_node = before.is_none_or(|c| matches!(c, ':' | '-' | '[' | '{' | ',' | '?'));
        if !in_node {
            continue;
        }
        let next = bytes.get(index + 1).copied();
        match byte {
            b'!' if next.is_some_and(|n| !n.is_ascii_whitespace()) => return Some(Construct::Tag),
            b'&' | b'*'
                if next.is_some_and(|n| n.is_ascii_alphanumeric() || n == b'_' || n == b'-') =>
            {
                return Some(Construct::Anchor)
            }
            _ => {}
        }
    }
    None
}

/// Una chiave di mappa che comincia alla colonna `col`, con i suoi punti.
struct KeyToken {
    raw: String,
    name: String,
    colon: usize,
}

fn key_at(text: &str, col: usize) -> Option<KeyToken> {
    let rest = text.get(col..)?;
    let first = rest.chars().next()?;
    if first == '"' || first == '\'' {
        let bytes = rest.as_bytes();
        let quote = first as u8;
        let mut name = String::new();
        let mut index = 1;
        loop {
            let byte = *bytes.get(index)?;
            if quote == b'"' && byte == b'\\' {
                return None;
            }
            if byte == quote {
                if quote == b'\'' && bytes.get(index + 1) == Some(&b'\'') {
                    name.push('\'');
                    index += 2;
                    continue;
                }
                break;
            }
            let ch = rest[index..].chars().next()?;
            name.push(ch);
            index += ch.len_utf8();
        }
        let after = index + 1;
        let spaces = rest[after..].len() - rest[after..].trim_start_matches(' ').len();
        let colon = after + spaces;
        if bytes.get(colon) != Some(&b':') || !matches!(bytes.get(colon + 1), None | Some(b' ')) {
            return None;
        }
        return Some(KeyToken {
            raw: rest[..=index].to_string(),
            name,
            colon: col + colon,
        });
    }
    if "-?:,[]{}#&*!|>'\"%@`".contains(first) {
        return None;
    }
    let bytes = rest.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b':' && matches!(bytes.get(index + 1), None | Some(b' ')) {
            break;
        }
        if bytes[index] == b'#' && index > 0 && bytes[index - 1] == b' ' {
            return None;
        }
        index += 1;
    }
    if index >= bytes.len() {
        return None;
    }
    let raw = rest[..index].trim_end().to_string();
    if raw.is_empty() {
        return None;
    }
    Some(KeyToken {
        name: raw.clone(),
        raw,
        colon: col + index,
    })
}

/// Il file dopo la toppa: deve rileggersi come `.base` valido e con l'albero
/// atteso. Solo allora le modifiche escono.
fn finish(
    source: &str,
    doc: &Doc<'_>,
    root: &Value,
    expected: &Value,
    splices: Vec<Splice>,
) -> Result<Vec<TextEdit>, PatchError> {
    let edits = doc.edits(splices);
    if edits.is_empty() {
        return if expected == root {
            Ok(edits)
        } else {
            Err(PatchError::Verify)
        };
    }
    let (output, _) = EditRequest::new(Revision::of(source), edits.clone())
        .apply_to(source)
        .map_err(|_| PatchError::Verify)?;
    if output.len() > MAX_BASE_SOURCE_BYTES {
        return Err(PatchError::Model(BaseError::Limit {
            what: "source bytes",
            limit: MAX_BASE_SOURCE_BYTES,
        }));
    }
    BaseDefinition::parse(&output).map_err(PatchError::Model)?;
    let read: Value = serde_yaml_ng::from_str(&output).map_err(|_| PatchError::Verify)?;
    if &read != expected {
        return Err(PatchError::Verify);
    }
    Ok(edits)
}
