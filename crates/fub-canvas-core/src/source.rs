//! Il sorgente di una `.canvas` si ritocca, non si riscrive: si cambiano solo
//! i valori e gli oggetti toccati, il resto del file resta byte per byte.
//!
//! È l'unica copia di queste regole: la tela la usa compilata in WebAssembly
//! (`crates/fub-canvas-wasm`). Le regole di scrittura
//! (R6, R7, R10) sono in `docs/reference/canvas-format.md` § «Scrittura».
//!
//! - **Lo scanner** legge il sorgente una volta e ne tiene gli intervalli in
//!   byte UTF-8, senza decodificare né riscrivere un valore che non serve.
//!   Conta come spazio solo lo spazio JSON (spazio, `\t`, `\n`, `\r`), salta
//!   un BOM iniziale lasciandolo fuori dalla radice e rifiuta una chiave
//!   doppia a qualunque profondità, anche sconosciuta. Ogni intervallo
//!   comincia e finisce su un byte ASCII (o alla fine del testo): non taglia
//!   mai un carattere a metà.
//! - **Il ritocco** ([`patch_source`]) confronta il modello di prima e quello
//!   di dopo come valori JSON (le chiavi in qualunque ordine, i numeri per
//!   valore) e riscrive solo ciò che è cambiato.
//!
//! Nessuna funzione va in panico su un input: ogni errore è un
//! [`SourceError`].

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};
use thiserror::Error;

use crate::js::{encode, encode_pretty, js_entries, js_string};
use crate::model::{Canvas, CanvasEdge, CanvasNode};
use crate::patch::{same_map, same_value};
use crate::read::is_blank;

/// Il BOM UTF-8, come testo.
const BOM: &str = "\u{feff}";

/// La profondità massima di array e oggetti annidati. Il lettore
/// (`serde_json`) si ferma a 128: un sorgente che ha letto sta sotto, e il
/// limite tiene lo scanner e il ritocco, che sono ricorsivi, lontani dalla
/// fine dello stack anche in WebAssembly.
pub const MAX_DEPTH: usize = 256;

/// Fino a quanti campi un oggetto cerca le chiavi doppie una per una.
const SMALL_OBJECT: usize = 16;

/// Perché un sorgente non si ritocca.
#[derive(Debug, Error)]
pub enum SourceError {
    /// Il testo non è JSON che lo scanner sa leggere; `offset` è il byte
    /// dove si è fermato.
    #[error("invalid canvas JSON at byte {offset}: {what}")]
    Syntax { offset: usize, what: &'static str },
    /// Una chiave ripetuta nello stesso oggetto, a qualunque profondità;
    /// `offset` è il byte della virgoletta che apre la seconda.
    #[error("duplicate canvas JSON key {key:?} at byte {offset}")]
    DuplicateKey { offset: usize, key: String },
    /// Array e oggetti annidati oltre [`MAX_DEPTH`].
    #[error("canvas JSON nested deeper than {limit} levels")]
    TooDeep { limit: usize },
    /// Il modello non diventa un valore JSON (non succede con un modello
    /// costruito dai tipi del nucleo).
    #[error("canvas model cannot be encoded: {0}")]
    Model(#[from] serde_json::Error),
}

/// Il sorgente di dopo: `source` (che si legge come `before`) con i soli
/// cambiamenti da `before` ad `after`.
///
/// - Un sorgente vuoto (R1) diventa `after` scritto per intero, rientrato di
///   due spazi e chiuso da `"\n"`; tiene il BOM e, se il file ne aveva, i
///   terminatori CRLF.
/// - Un valore uguale (come valore JSON) resta byte per byte.
/// - Un oggetto che tiene tutti i suoi campi e non ne aggiunge cambia solo i
///   valori; altrimenti si ricompone con il prefisso, il separatore e il
///   suffisso che aveva: i campi tolti cadono, quelli nuovi vanno in fondo,
///   compatti.
/// - Un `null` del sorgente che il modello legge come assente (un campo noto
///   facoltativo, R7) resta dov'è finché il campo resta assente: non conta
///   come tolto e l'oggetto non si ricompone per lui. Se il campo prende un
///   valore, il valore va al posto del `null`.
/// - Un `nodes` o un `edges` che il sorgente non ha non si aggiunge finché
///   resta vuoto; con la prima voce arriva in fondo alla radice.
/// - Gli array di oggetti con `id` si accoppiano per id; le voci nuove si
///   scrivono compatte, nell'ordine di R10.
///
/// Il lavoro è lineare nella lunghezza del sorgente e nel numero di schede.
pub fn patch_source(source: &str, before: &Canvas, after: &Canvas) -> Result<String, SourceError> {
    if is_blank(source) {
        let mut fresh = encode_pretty(&canvas_value(after)?);
        fresh.push('\n');
        if source.contains("\r\n") {
            fresh = fresh.replace('\n', "\r\n");
        }
        let bom = if source.starts_with(BOM) { BOM } else { "" };
        return Ok(format!("{bom}{fresh}"));
    }
    let root = scan(source)?;
    let mut out = String::with_capacity(source.len() + 64);
    out.push_str(slice(source, 0, root.start)?);
    Patcher { source }.root(&mut out, &root, before, after)?;
    out.push_str(slice(source, root.end, source.len())?);
    Ok(out)
}

/// L'indice della scheda il cui oggetto nel sorgente contiene `byte_offset`
/// (contato dall'inizio del testo, BOM compreso), o `None` se l'offset cade
/// fuori da ogni scheda (anche fra due schede) o il sorgente non si legge.
/// Le schede tengono nel modello l'ordine dell'array, quindi l'indice è
/// anche quello del modello.
pub fn node_at(source: &str, byte_offset: usize) -> Option<usize> {
    let root = scan(source).ok()?;
    let SpanKind::Object(fields) = &root.kind else {
        return None;
    };
    let nodes = fields.iter().find(|field| field.key == "nodes")?;
    let SpanKind::Array(items) = &nodes.value.kind else {
        return None;
    };
    items
        .iter()
        .position(|item| item.start <= byte_offset && byte_offset < item.end)
}

/// La lavagna come valore JSON, con le chiavi nell'ordine in cui si
/// scrivono: `nodes`, `edges`, poi i campi sconosciuti della radice. `nodes`
/// ed `edges` ci sono sempre, anche vuoti, come nel modello TypeScript.
pub fn canvas_value(canvas: &Canvas) -> Result<Value, SourceError> {
    let mut map = Map::new();
    let nodes = canvas
        .nodes
        .iter()
        .map(node_value)
        .collect::<Result<Vec<_>, _>>()?;
    let edges = canvas
        .edges
        .iter()
        .map(edge_value)
        .collect::<Result<Vec<_>, _>>()?;
    map.insert("nodes".to_owned(), Value::Array(nodes));
    map.insert("edges".to_owned(), Value::Array(edges));
    Ok(Value::Object(with_extra(map, &canvas.extra)))
}

/// Una scheda come valore JSON, con le chiavi nell'ordine di R10 (id, type,
/// x, y, width, height, color, text, file, subpath, url, label, background,
/// backgroundStyle; le assenti non ci sono), poi le sconosciute nel loro
/// ordine. Una chiave sconosciuta con il nome di una nota non passa: vince il
/// campo noto.
pub fn node_value(node: &CanvasNode) -> Result<Value, SourceError> {
    let mut map = Map::new();
    map.insert("id".to_owned(), Value::String(node.id.clone()));
    map.insert("type".to_owned(), serde_json::to_value(node.node_type)?);
    map.insert("x".to_owned(), Value::from(node.x));
    map.insert("y".to_owned(), Value::from(node.y));
    map.insert("width".to_owned(), Value::from(node.width));
    map.insert("height".to_owned(), Value::from(node.height));
    if let Some(color) = &node.color {
        map.insert("color".to_owned(), serde_json::to_value(color)?);
    }
    let texts = [
        ("text", &node.text),
        ("file", &node.file),
        ("subpath", &node.subpath),
        ("url", &node.url),
        ("label", &node.label),
        ("background", &node.background),
        ("backgroundStyle", &node.background_style),
    ];
    for (key, text) in texts {
        if let Some(text) = text {
            map.insert(key.to_owned(), Value::String(text.clone()));
        }
    }
    Ok(Value::Object(with_extra(map, &node.extra)))
}

/// Un arco come valore JSON, con le chiavi nell'ordine di R10 (id,
/// fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label; le
/// assenti non ci sono), poi le sconosciute nel loro ordine.
pub fn edge_value(edge: &CanvasEdge) -> Result<Value, SourceError> {
    let mut map = Map::new();
    map.insert("id".to_owned(), Value::String(edge.id.clone()));
    map.insert("fromNode".to_owned(), Value::String(edge.from_node.clone()));
    if let Some(side) = edge.from_side {
        map.insert("fromSide".to_owned(), serde_json::to_value(side)?);
    }
    if let Some(end) = edge.from_end {
        map.insert("fromEnd".to_owned(), serde_json::to_value(end)?);
    }
    map.insert("toNode".to_owned(), Value::String(edge.to_node.clone()));
    if let Some(side) = edge.to_side {
        map.insert("toSide".to_owned(), serde_json::to_value(side)?);
    }
    if let Some(end) = edge.to_end {
        map.insert("toEnd".to_owned(), serde_json::to_value(end)?);
    }
    if let Some(color) = &edge.color {
        map.insert("color".to_owned(), serde_json::to_value(color)?);
    }
    if let Some(label) = &edge.label {
        map.insert("label".to_owned(), Value::String(label.clone()));
    }
    Ok(Value::Object(with_extra(map, &edge.extra)))
}

/// Aggiunge in fondo i campi sconosciuti, nel loro ordine, saltando quelli
/// che hanno il nome di un campo già scritto. Il resto della regola di
/// JavaScript (le chiavi che sembrano indici prima) lo applica chi scrive
/// ([`encode`]).
fn with_extra(mut map: Map<String, Value>, extra: &Map<String, Value>) -> Map<String, Value> {
    for (key, value) in extra {
        if !map.contains_key(key) {
            map.insert(key.clone(), value.clone());
        }
    }
    map
}

fn same(left: Option<&Value>, right: &Value) -> bool {
    left.is_some_and(|left| same_value(left, right))
}

/// `source[start..end]` senza panico: gli intervalli dello scanner cadono
/// sempre su confini di carattere, ma un errore resta un errore.
fn slice(source: &str, start: usize, end: usize) -> Result<&str, SourceError> {
    source.get(start..end).ok_or(SourceError::Syntax {
        offset: start,
        what: "span off a character boundary",
    })
}

// --- Lo scanner -----------------------------------------------------------

/// Dove sta un valore JSON nel sorgente, in byte: `start` è il primo byte,
/// `end` quello dopo l'ultimo.
struct Span<'a> {
    start: usize,
    end: usize,
    kind: SpanKind<'a>,
}

enum SpanKind<'a> {
    /// Una stringa, un numero, `true`, `false` o `null`.
    Scalar,
    Array(Vec<Span<'a>>),
    Object(Vec<Field<'a>>),
}

/// Un membro di un oggetto: `start` è il byte della virgoletta che apre la
/// chiave, `key` la chiave decodificata.
struct Field<'a> {
    key: Cow<'a, str>,
    start: usize,
    value: Span<'a>,
}

/// Legge `source` (un BOM iniziale si salta e resta fuori dalla radice) e
/// rifiuta una chiave doppia a qualunque profondità.
fn scan(source: &str) -> Result<Span<'_>, SourceError> {
    let mut scanner = Scanner {
        source,
        bytes: source.as_bytes(),
        pos: if source.starts_with(BOM) {
            BOM.len()
        } else {
            0
        },
    };
    let root = scanner.value(0)?;
    scanner.space();
    if scanner.pos != scanner.bytes.len() {
        return Err(scanner.error("trailing content"));
    }
    Ok(root)
}

struct Scanner<'a> {
    source: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Scanner<'a> {
    fn error(&self, what: &'static str) -> SourceError {
        SourceError::Syntax {
            offset: self.pos,
            what,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    /// Salta lo spazio JSON (RFC 8259 §2), e nient'altro.
    fn space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn value(&mut self, depth: usize) -> Result<Span<'a>, SourceError> {
        self.space();
        let start = self.pos;
        let kind = match self.peek() {
            Some(b'{') => SpanKind::Object(self.object(depth + 1)?),
            Some(b'[') => SpanKind::Array(self.array(depth + 1)?),
            Some(b'"') => {
                self.string()?;
                SpanKind::Scalar
            }
            Some(b'-' | b'0'..=b'9' | b't' | b'f' | b'n') => {
                self.scalar();
                SpanKind::Scalar
            }
            Some(_) => return Err(self.error("unexpected character")),
            None => return Err(self.error("unexpected end")),
        };
        Ok(Span {
            start,
            end: self.pos,
            kind,
        })
    }

    /// Un numero o una parola (`true`, `false`, `null`): fino al primo byte
    /// che non può farne parte. Il valore non si decodifica: il lettore l'ha
    /// già controllato.
    fn scalar(&mut self) {
        while matches!(
            self.peek(),
            Some(b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'+' | b'-' | b'.')
        ) {
            self.pos += 1;
        }
    }

    /// Una stringa, dalla virgoletta di apertura a quella di chiusura
    /// compresa. Dice se aveva escape.
    fn string(&mut self) -> Result<bool, SourceError> {
        let start = self.pos;
        self.pos += 1;
        let mut escaped = false;
        while let Some(byte) = self.peek() {
            match byte {
                b'\\' => {
                    escaped = true;
                    // Il byte dopo la barra è ASCII in un JSON valido; se non
                    // lo è, la stringa resta comunque chiusa da una `"`, e i
                    // byte di continuazione UTF-8 non sono mai `"` né `\`.
                    self.pos += 2;
                }
                b'"' => {
                    self.pos += 1;
                    return Ok(escaped);
                }
                _ => self.pos += 1,
            }
        }
        Err(SourceError::Syntax {
            offset: start,
            what: "unterminated string",
        })
    }

    fn key(&mut self) -> Result<Cow<'a, str>, SourceError> {
        let start = self.pos;
        let escaped = self.string()?;
        let raw = slice(self.source, start, self.pos)?;
        if !escaped {
            // Senza escape la chiave è il testo fra le virgolette.
            return Ok(Cow::Borrowed(slice(self.source, start + 1, self.pos - 1)?));
        }
        serde_json::from_str::<String>(raw)
            .map(Cow::Owned)
            .map_err(|_| SourceError::Syntax {
                offset: start,
                what: "invalid key string",
            })
    }

    fn object(&mut self, depth: usize) -> Result<Vec<Field<'a>>, SourceError> {
        if depth > MAX_DEPTH {
            return Err(SourceError::TooDeep { limit: MAX_DEPTH });
        }
        self.pos += 1;
        let mut fields: Vec<Field<'a>> = Vec::new();
        // Un oggetto piccolo (una scheda ha una quindicina di campi) cerca
        // la chiave doppia fra i campi; uno grande passa a un insieme, così
        // il lavoro resta lineare.
        let mut keys: Option<HashSet<Cow<'a, str>>> = None;
        self.space();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(fields);
        }
        loop {
            self.space();
            if self.peek() != Some(b'"') {
                return Err(self.error("expected a key"));
            }
            let start = self.pos;
            let key = self.key()?;
            let repeated = match &mut keys {
                Some(keys) => !keys.insert(key.clone()),
                None => {
                    let repeated = fields.iter().any(|field| field.key == key);
                    if fields.len() >= SMALL_OBJECT {
                        let mut set: HashSet<Cow<'a, str>> =
                            fields.iter().map(|field| field.key.clone()).collect();
                        set.insert(key.clone());
                        keys = Some(set);
                    }
                    repeated
                }
            };
            if repeated {
                return Err(SourceError::DuplicateKey {
                    offset: start,
                    key: key.into_owned(),
                });
            }
            self.space();
            if self.peek() != Some(b':') {
                return Err(self.error("expected `:`"));
            }
            self.pos += 1;
            let value = self.value(depth)?;
            fields.push(Field { key, start, value });
            self.space();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(fields);
                }
                _ => return Err(self.error("expected `,` or `}`")),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<Vec<Span<'a>>, SourceError> {
        if depth > MAX_DEPTH {
            return Err(SourceError::TooDeep { limit: MAX_DEPTH });
        }
        self.pos += 1;
        let mut items = Vec::new();
        self.space();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(items);
        }
        loop {
            items.push(self.value(depth)?);
            self.space();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(items);
                }
                _ => return Err(self.error("expected `,` or `]`")),
            }
        }
    }
}

// --- Il ritocco -----------------------------------------------------------
//
// L'algoritmo è uno, su due rappresentazioni:
// i valori JSON per i campi sconosciuti, e i tipi del modello per la radice,
// le schede e gli archi. Così una scheda uguale prima e dopo si confronta
// come struct, senza diventare un valore JSON: su una lavagna grande con una
// scheda cambiata si costruisce il valore di quella sola.

/// Una voce di `nodes` o di `edges`: ha un id e diventa un valore JSON.
trait Entry: PartialEq {
    fn id(&self) -> &str;
    fn value(&self) -> Result<Value, SourceError>;
}

impl Entry for CanvasNode {
    fn id(&self) -> &str {
        &self.id
    }
    fn value(&self) -> Result<Value, SourceError> {
        node_value(self)
    }
}

impl Entry for CanvasEdge {
    fn id(&self) -> &str {
        &self.id
    }
    fn value(&self) -> Result<Value, SourceError> {
        edge_value(self)
    }
}

/// Due voci uguali come valori JSON. L'uguaglianza delle struct basta quasi
/// sempre; quando manca (un campo sconosciuto `1` contro `1.0`) decide il
/// confronto dei valori.
fn same_entry<T: Entry>(left: &T, right: &T) -> Result<bool, SourceError> {
    Ok(left == right || same_value(&left.value()?, &right.value()?))
}

fn same_entries<T: Entry>(left: &[T], right: &[T]) -> Result<bool, SourceError> {
    if left.len() != right.len() {
        return Ok(false);
    }
    for (a, b) in left.iter().zip(right) {
        if !same_entry(a, b)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn entries_value<T: Entry>(entries: &[T]) -> Result<Value, SourceError> {
    entries
        .iter()
        .map(Entry::value)
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

/// Un campo della radice: `nodes`, `edges` o uno sconosciuto.
fn same_root_field(key: &str, before: &Canvas, after: &Canvas) -> Result<bool, SourceError> {
    match key {
        "nodes" => same_entries(&before.nodes, &after.nodes),
        "edges" => same_entries(&before.edges, &after.edges),
        _ => Ok(after
            .extra
            .get(key)
            .is_some_and(|next| same(before.extra.get(key), next))),
    }
}

fn same_canvas(before: &Canvas, after: &Canvas) -> Result<bool, SourceError> {
    Ok(same_entries(&before.nodes, &after.nodes)?
        && same_entries(&before.edges, &after.edges)?
        && same_map(&before.extra, &after.extra))
}

struct Patcher<'s> {
    source: &'s str,
}

impl Patcher<'_> {
    fn text(&self, start: usize, end: usize) -> Result<&str, SourceError> {
        slice(self.source, start, end)
    }

    fn verbatim(&self, out: &mut String, span: &Span<'_>) -> Result<(), SourceError> {
        out.push_str(self.text(span.start, span.end)?);
        Ok(())
    }

    /// La radice: come [`Patcher::render`] su un oggetto, con `nodes` ed
    /// `edges` presi dai tipi del modello.
    fn root(
        &self,
        out: &mut String,
        span: &Span<'_>,
        before: &Canvas,
        after: &Canvas,
    ) -> Result<(), SourceError> {
        if same_canvas(before, after)? {
            return self.verbatim(out, span);
        }
        let SpanKind::Object(fields) = &span.kind else {
            out.push_str(&encode(&canvas_value(after)?));
            return Ok(());
        };
        // L'ordine delle chiavi della radice di dopo, come la enumera
        // JavaScript: i valori non servono, solo i nomi.
        let mut keys = Map::new();
        keys.insert("nodes".to_owned(), Value::Null);
        keys.insert("edges".to_owned(), Value::Null);
        for key in after.extra.keys() {
            keys.entry(key.clone()).or_insert(Value::Null);
        }
        let present: HashSet<&str> = fields.iter().map(|field| field.key.as_ref()).collect();
        let mut added = Vec::new();
        for (key, _) in js_entries(&keys) {
            if present.contains(key) {
                continue;
            }
            // Un `nodes` o un `edges` che il file non ha arriva con la prima
            // voce, non prima (R11).
            let value = match key {
                "nodes" if after.nodes.is_empty() => continue,
                "edges" if after.edges.is_empty() => continue,
                "nodes" => encode(&entries_value(&after.nodes)?),
                "edges" => encode(&entries_value(&after.edges)?),
                _ => after.extra.get(key).map(encode).unwrap_or_default(),
            };
            added.push((key, value));
        }
        self.compose(
            out,
            span,
            fields,
            &|field| keys.contains_key(field.key.as_ref()),
            &|field| same_root_field(field.key.as_ref(), before, after),
            &|out, field| match field.key.as_ref() {
                "nodes" => self.entries(out, &field.value, &before.nodes, &after.nodes),
                "edges" => self.entries(out, &field.value, &before.edges, &after.edges),
                key => match after.extra.get(key) {
                    Some(next) => self.render(out, &field.value, before.extra.get(key), next),
                    None => Ok(()),
                },
            },
            added,
        )
    }

    /// Scrive in `out` il valore di `span` come diventa da `old` a `next`.
    /// `old` è `None` quando il modello di prima non ha la chiave che il
    /// sorgente ha (un `null` che vale assente, R7).
    fn render(
        &self,
        out: &mut String,
        span: &Span<'_>,
        old: Option<&Value>,
        next: &Value,
    ) -> Result<(), SourceError> {
        if same(old, next) {
            return self.verbatim(out, span);
        }
        match (&span.kind, old, next) {
            (SpanKind::Object(fields), Some(Value::Object(old)), Value::Object(next)) => {
                let present: HashSet<&str> =
                    fields.iter().map(|field| field.key.as_ref()).collect();
                let added = js_entries(next)
                    .into_iter()
                    .filter(|(key, _)| !present.contains(key))
                    .map(|(key, value)| (key, encode(value)))
                    .collect();
                // Un `null` che il modello di prima e quello di dopo non
                // hanno è un campo noto letto come assente (R7): resta.
                let kept_null = |field: &Field<'_>| {
                    let key = field.key.as_ref();
                    !old.contains_key(key) && !next.contains_key(key) && self.is_null(&field.value)
                };
                self.compose(
                    out,
                    span,
                    fields,
                    &|field| next.contains_key(field.key.as_ref()) || kept_null(field),
                    &|field| {
                        let key = field.key.as_ref();
                        Ok(kept_null(field)
                            || next.get(key).is_some_and(|value| same(old.get(key), value)))
                    },
                    &|out, field| match next.get(field.key.as_ref()) {
                        Some(value) => {
                            self.render(out, &field.value, old.get(field.key.as_ref()), value)
                        }
                        None => Ok(()),
                    },
                    added,
                )
            }
            (SpanKind::Array(items), Some(Value::Array(old)), Value::Array(next))
                if items.len() == old.len() =>
            {
                self.array(out, span, items, old, next)
            }
            // Un valore nuovo, di un altro tipo, o un array che non ha le
            // voci del modello: si scrive per intero, ed è comunque giusto.
            _ => {
                out.push_str(&encode(next));
                Ok(())
            }
        }
    }

    /// Il valore di `span` nel sorgente è il letterale `null`.
    fn is_null(&self, span: &Span<'_>) -> bool {
        matches!(span.kind, SpanKind::Scalar)
            && self.source.get(span.start..span.end) == Some("null")
    }

    /// Un oggetto che cambia. `kept` dice se un campo del sorgente resta
    /// (il modello di dopo ha ancora la chiave, o è un `null` che resta),
    /// `same_field` se il suo valore resta byte per byte, `render_field`
    /// scrive il valore di dopo; `added` sono le chiavi nuove, già scritte,
    /// nell'ordine di JavaScript.
    #[allow(clippy::too_many_arguments)]
    fn compose(
        &self,
        out: &mut String,
        span: &Span<'_>,
        fields: &[Field<'_>],
        kept: &dyn Fn(&Field<'_>) -> bool,
        same_field: &dyn Fn(&Field<'_>) -> Result<bool, SourceError>,
        render_field: &dyn Fn(&mut String, &Field<'_>) -> Result<(), SourceError>,
        added: Vec<(&str, String)>,
    ) -> Result<(), SourceError> {
        let all_kept = fields.iter().all(kept);
        if all_kept && added.is_empty() {
            // Solo i valori cambiano: il resto dell'oggetto resta com'era.
            let mut from = span.start;
            for field in fields {
                if same_field(field)? {
                    continue;
                }
                out.push_str(self.text(from, field.value.start)?);
                render_field(out, field)?;
                from = field.value.end;
            }
            out.push_str(self.text(from, span.end)?);
            return Ok(());
        }

        // Si ricompone con il prefisso, il separatore e il suffisso trovati.
        let (prefix, suffix) = match (fields.first(), fields.last()) {
            (Some(first), Some(last)) => (
                self.text(span.start + 1, first.start)?,
                self.text(last.value.end, span.end - 1)?,
            ),
            _ => ("", ""),
        };
        let separator = match fields {
            [first, second, ..] => self.text(first.value.end, second.start)?,
            _ => ",",
        };
        out.push('{');
        out.push_str(prefix);
        let mut first = true;
        for field in fields.iter().filter(|field| kept(field)) {
            if !first {
                out.push_str(separator);
            }
            first = false;
            out.push_str(self.text(field.start, field.value.start)?);
            if same_field(field)? {
                self.verbatim(out, &field.value)?;
            } else {
                render_field(out, field)?;
            }
        }
        for (key, value) in added {
            if !first {
                out.push_str(separator);
            }
            first = false;
            out.push_str(&js_string(key));
            out.push(':');
            out.push_str(&value);
        }
        out.push_str(suffix);
        out.push('}');
        Ok(())
    }

    /// `nodes` o `edges`: come [`Patcher::array`], con le voci confrontate
    /// come struct e convertite in valori JSON solo se cambiano.
    fn entries<T: Entry>(
        &self,
        out: &mut String,
        span: &Span<'_>,
        old: &[T],
        next: &[T],
    ) -> Result<(), SourceError> {
        if same_entries(old, next)? {
            return self.verbatim(out, span);
        }
        let items = match &span.kind {
            SpanKind::Array(items) if items.len() == old.len() => items,
            // `null`, un altro tipo o un array che non ha le voci del modello.
            _ => {
                out.push_str(&encode(&entries_value(next)?));
                return Ok(());
            }
        };
        let aligned =
            old.len() == next.len() && old.iter().zip(next).all(|(a, b)| a.id() == b.id());
        if aligned {
            let mut from = span.start;
            for ((item, old_entry), next_entry) in items.iter().zip(old).zip(next) {
                if old_entry == next_entry {
                    continue;
                }
                out.push_str(self.text(from, item.start)?);
                self.render(out, item, Some(&old_entry.value()?), &next_entry.value()?)?;
                from = item.end;
            }
            out.push_str(self.text(from, span.end)?);
            return Ok(());
        }
        if next.is_empty() {
            out.push_str("[]");
            return Ok(());
        }
        let positions: HashMap<&str, usize> = old
            .iter()
            .enumerate()
            .map(|(index, entry)| (entry.id(), index))
            .collect();
        let (prefix, suffix, separator) = self.array_frame(span, items)?;
        out.push('[');
        out.push_str(prefix);
        for (index, entry) in next.iter().enumerate() {
            if index > 0 {
                out.push_str(separator);
            }
            match positions
                .get(entry.id())
                .and_then(|&i| Some((items.get(i)?, old.get(i)?)))
            {
                Some((item, original)) if original == entry => self.verbatim(out, item)?,
                Some((item, original)) => {
                    self.render(out, item, Some(&original.value()?), &entry.value()?)?;
                }
                None => out.push_str(&encode(&entry.value()?)),
            }
        }
        out.push_str(suffix);
        out.push(']');
        Ok(())
    }

    /// Il prefisso, il suffisso e il separatore di un array: lo spazio dopo
    /// `[`, quello prima di `]` e ciò che sta fra le prime due voci (`,` se ce
    /// n'è una sola).
    fn array_frame(
        &self,
        span: &Span<'_>,
        items: &[Span<'_>],
    ) -> Result<(&str, &str, &str), SourceError> {
        let (prefix, suffix) = match (items.first(), items.last()) {
            (Some(first), Some(last)) => (
                self.text(span.start + 1, first.start)?,
                self.text(last.end, span.end - 1)?,
            ),
            _ => ("", ""),
        };
        let separator = match items {
            [first, second, ..] => self.text(first.end, second.start)?,
            _ => ",",
        };
        Ok((prefix, suffix, separator))
    }

    fn array(
        &self,
        out: &mut String,
        span: &Span<'_>,
        items: &[Span<'_>],
        old: &[Value],
        next: &[Value],
    ) -> Result<(), SourceError> {
        let old_ids = ids(old);
        let next_ids = ids(next);
        let aligned = match (&old_ids, &next_ids) {
            (None, _) => true,
            (Some(old_ids), Some(next_ids)) => old_ids == next_ids,
            (Some(_), None) => false,
        };
        if old.len() == next.len() && aligned {
            // Le stesse voci nello stesso ordine: si ritoccano una per una.
            let mut from = span.start;
            for ((item, old_value), next_value) in items.iter().zip(old).zip(next) {
                if same_value(old_value, next_value) {
                    continue;
                }
                out.push_str(self.text(from, item.start)?);
                self.render(out, item, Some(old_value), next_value)?;
                from = item.end;
            }
            out.push_str(self.text(from, span.end)?);
            return Ok(());
        }

        if next.is_empty() {
            out.push_str("[]");
            return Ok(());
        }
        let positions: HashMap<&str, usize> = old_ids
            .iter()
            .flatten()
            .enumerate()
            .map(|(index, id)| (*id, index))
            .collect();
        let (prefix, suffix, separator) = self.array_frame(span, items)?;
        out.push('[');
        out.push_str(prefix);
        for (index, entry) in next.iter().enumerate() {
            if index > 0 {
                out.push_str(separator);
            }
            let original = match &next_ids {
                Some(next_ids) => next_ids
                    .get(index)
                    .and_then(|id| positions.get(id).copied()),
                None => (index < old.len()).then_some(index),
            };
            match original.and_then(|i| Some((items.get(i)?, old.get(i)?))) {
                Some((item, old_value)) => self.render(out, item, Some(old_value), entry)?,
                None => out.push_str(&encode(entry)),
            }
        }
        out.push_str(suffix);
        out.push(']');
        Ok(())
    }
}

/// Gli id delle voci, se ogni voce è un oggetto con un `id` stringa.
fn ids(values: &[Value]) -> Option<Vec<&str>> {
    values
        .iter()
        .map(|value| value.get("id").and_then(Value::as_str))
        .collect()
}
