//! L'innesto dei valori: i byte di una cartella con alcune celle cambiate, e
//! tutto il resto com'era.
//!
//! L'innesto è a livello di riga. Ogni voce dello zip non toccata si copia
//! così com'è, compressa compresa e nell'ordine dello zip; nei fogli non
//! toccati non cambia un byte. In un foglio toccato le righe non toccate
//! restano i loro byte, e in una riga toccata ogni cella non toccata resta i
//! suoi. La cella cambiata tiene il suo stile (`s`); una cella nuova prende lo
//! stile della riga o della colonna, come in Excel. Un testo nuovo si scrive
//! come stringa in linea, e la tabella delle stringhe condivise non cambia.
//!
//! Niente si ricalcola. Quando una formula legge una cella cambiata, o una
//! formula si toglie, la cartella chiede a chi la apre di ricalcolare
//! (`fullCalcOnLoad`); quando una formula si toglie, esce anche la catena di
//! calcolo, che Excel ricostruisce.
//!
//! Il risultato si rilegge prima di uscire: ogni cella non toccata deve avere
//! lo stesso input, lo stesso valore salvato e lo stesso stile, ogni cella
//! cambiata il valore voluto. Una forma che l'innesto non sa trattare è un
//! errore, e i byte di partenza restano quelli.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::{Cursor, Write};

use gridcraft_core::{CellRef, RangeRef, Value};
use gridcraft_model::{Cell, Sheet, StyleTable, Workbook};
use quick_xml::escape::escape;
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::input::{number_input, NewValue, MAX_TEXT_CHARS};
use crate::locks::{Lock, SheetLocks};
use crate::package::{self, attr, local, normalize, rels_of, Package, PackageError};
use crate::sheet_xml::{self, CellSpan, RowSpan, SheetLayout};
use crate::XlsxError;

/// Il nuovo valore di una cella.
#[derive(Clone, Debug, PartialEq)]
pub struct CellEdit {
    /// L'indice del foglio nel modello.
    pub sheet: usize,
    pub cell: CellRef,
    pub value: NewValue,
}

/// I byte innestati, e che cosa l'innesto ha dovuto dire al file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Grafted {
    pub bytes: Vec<u8>,
    /// La cartella chiede di ricalcolare all'apertura.
    pub recalc: bool,
    /// La catena di calcolo è uscita.
    pub calc_chain_removed: bool,
}

/// Perché l'innesto non si fa.
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum GraftError {
    /// La cella è bloccata.
    #[error("cell {cell} of sheet {sheet} is locked ({})", lock.code())]
    Locked {
        sheet: usize,
        cell: CellRef,
        lock: Lock,
    },
    /// Il modello non ha questo foglio.
    #[error("sheet {0} does not exist")]
    NoSheet(usize),
    /// Il valore non si scrive: un numero non finito, un testo troppo lungo,
    /// due valori per la stessa cella.
    #[error("invalid edit: {0}")]
    Edit(String),
    /// Il pacchetto non si legge come serve.
    #[error("package: {0}")]
    Package(String),
    /// Il file ha una forma che l'innesto non tratta.
    #[error("unsupported shape: {0}")]
    Shape(String),
    /// La rilettura del risultato non è quella attesa.
    #[error("verification failed: {0}")]
    Verify(String),
    /// Il codec non rilegge il risultato.
    #[error(transparent)]
    Read(#[from] XlsxError),
}

impl From<PackageError> for GraftError {
    fn from(error: PackageError) -> Self {
        GraftError::Package(error.to_string())
    }
}

fn shape(what: impl Into<String>) -> GraftError {
    GraftError::Shape(what.into())
}

/// Innesta `edits` nei byte `original`, di cui `model` è la lettura.
/// `recalc` dice che una formula legge una cella cambiata.
pub fn graft(
    original: &[u8],
    model: &Workbook,
    edits: &[CellEdit],
    recalc: bool,
) -> Result<Grafted, GraftError> {
    let mut by_sheet: BTreeMap<usize, BTreeMap<CellRef, &NewValue>> = BTreeMap::new();
    for edit in edits {
        if edit.sheet >= model.sheets.len() {
            return Err(GraftError::NoSheet(edit.sheet));
        }
        match &edit.value {
            NewValue::Number(number) if !number.is_finite() => {
                return Err(GraftError::Edit(format!("{} is not finite", edit.cell)));
            }
            NewValue::Text(text) if text.chars().count() > MAX_TEXT_CHARS => {
                return Err(GraftError::Edit(format!("{} text is too long", edit.cell)));
            }
            _ => {}
        }
        if by_sheet
            .entry(edit.sheet)
            .or_default()
            .insert(edit.cell, &edit.value)
            .is_some()
        {
            return Err(GraftError::Edit(format!("{} edited twice", edit.cell)));
        }
    }
    if by_sheet.is_empty() {
        return Ok(Grafted {
            bytes: original.to_vec(),
            recalc: false,
            calc_chain_removed: false,
        });
    }

    let mut package = Package::open(original)?;
    if package.has_duplicates() {
        return Err(shape("two zip entries with the same name"));
    }
    let workbook = package.workbook_part()?;
    let sheets = package.worksheets(&workbook)?;
    if sheets.len() != model.sheets.len() {
        return Err(shape("the worksheets do not match the model"));
    }
    let mut replaced: HashMap<String, Vec<u8>> = HashMap::new();
    let mut formula_removed = false;
    for (&index, cells) in &by_sheet {
        let part = &sheets[index].part;
        let bytes = package
            .read(part)?
            .ok_or_else(|| GraftError::Package(format!("{part} is missing")))?;
        let wanted: BTreeSet<u32> = cells.keys().map(|cell| cell.row).collect();
        let layout =
            sheet_xml::scan(&bytes, &wanted).map_err(|error| shape(format!("{part}: {error}")))?;
        if !layout.facts.ordered {
            return Err(shape(format!("{part}: rows or cells out of order")));
        }
        let sheet = &model.sheets[index];
        let locks = SheetLocks::new(sheet, &layout.facts, &model.styles);
        for &cell in cells.keys() {
            if let Some(lock) = locks.at(sheet, cell) {
                return Err(GraftError::Locked {
                    sheet: index,
                    cell,
                    lock,
                });
            }
        }
        let (xml, removed) = rewrite_sheet(&bytes, &layout, cells)?;
        formula_removed |= removed;
        replaced.insert(normalize(part), xml);
    }

    let recalc = recalc || formula_removed;
    if recalc {
        let xml = package
            .read(&workbook)?
            .ok_or_else(|| GraftError::Package(format!("{workbook} is missing")))?;
        replaced.insert(normalize(&workbook), full_calc_on_load(&xml)?);
    }
    let mut removed = BTreeSet::new();
    let mut calc_chain_removed = false;
    if formula_removed {
        let chain = package
            .rels(&workbook)?
            .into_iter()
            .find(|rel| rel.kind == "calcChain" && !rel.external);
        if let Some(chain) = chain {
            let target = normalize(&chain.target);
            let rels_name = normalize(&rels_of(&workbook));
            let rels = package
                .read(&rels_name)?
                .ok_or_else(|| GraftError::Package(format!("{rels_name} is missing")))?;
            replaced.insert(
                rels_name,
                remove_empty(&rels, b"Relationship", |id| id == chain.id, b"Id")?,
            );
            if let Some(types) = package.read("[Content_Types].xml")? {
                replaced.insert(
                    "[content_types].xml".into(),
                    remove_empty(
                        &types,
                        b"Override",
                        |name| normalize(name) == target,
                        b"PartName",
                    )?,
                );
            }
            if package.has(&target) {
                removed.insert(target);
            }
            calc_chain_removed = true;
        }
    }
    drop(package);

    let bytes = rezip(original, replaced, &removed)?;
    verify(model, &bytes, &by_sheet)?;
    Ok(Grafted {
        bytes,
        recalc,
        calc_chain_removed,
    })
}

/// I byte di una cartella con `fullCalcOnLoad` nel calcolo: Excel ricalcola
/// tutto quando la apre. Ogni altra voce dello zip resta com'è.
pub(crate) fn recalc_on_open(bytes: &[u8]) -> Result<Vec<u8>, GraftError> {
    let mut package = Package::open(bytes)?;
    let workbook = package.workbook_part()?;
    let xml = package
        .read(&workbook)?
        .ok_or_else(|| GraftError::Package(format!("{workbook} is missing")))?;
    let replaced = HashMap::from([(normalize(&workbook), full_calc_on_load(&xml)?)]);
    drop(package);
    rezip(bytes, replaced, &BTreeSet::new())
}

/// Un pezzo del foglio da sostituire: `start..end` diventa `bytes`.
struct Splice {
    start: usize,
    end: usize,
    bytes: Vec<u8>,
}

fn apply(bytes: &[u8], mut splices: Vec<Splice>) -> Result<Vec<u8>, GraftError> {
    splices.sort_by_key(|splice| (splice.start, splice.end));
    let mut out =
        Vec::with_capacity(bytes.len() + splices.iter().map(|s| s.bytes.len()).sum::<usize>());
    let mut at = 0;
    for splice in splices {
        if splice.start < at || splice.end < splice.start || splice.end > bytes.len() {
            return Err(shape("overlapping edits"));
        }
        out.extend_from_slice(&bytes[at..splice.start]);
        out.extend_from_slice(&splice.bytes);
        at = splice.end;
    }
    out.extend_from_slice(&bytes[at..]);
    Ok(out)
}

/// Il nome qualificato con il prefisso del foglio.
fn qname(prefix: Option<&[u8]>, name: &str) -> Vec<u8> {
    match prefix {
        Some(prefix) => {
            let mut out = prefix.to_vec();
            out.push(b':');
            out.extend_from_slice(name.as_bytes());
            out
        }
        None => name.as_bytes().to_vec(),
    }
}

/// Un tag d'apertura riscritto: gli attributi `first` in testa, quelli di
/// `drop` tolti, gli altri come li scrive il file.
fn retag(
    tag: &[u8],
    drop: &[&[u8]],
    first: &[(&str, String)],
    close: Option<bool>,
) -> Result<Vec<u8>, GraftError> {
    let mut reader = Reader::from_reader(tag);
    let (element, empty) = match reader.read_event() {
        Ok(Event::Start(element)) => (element, false),
        Ok(Event::Empty(element)) => (element, true),
        _ => return Err(shape("a tag does not parse")),
    };
    let mut out = b"<".to_vec();
    out.extend_from_slice(element.name().as_ref());
    for (key, value) in first {
        out.push(b' ');
        out.extend_from_slice(key.as_bytes());
        out.extend_from_slice(b"=\"");
        out.extend_from_slice(escape(value.as_str()).as_bytes());
        out.push(b'"');
    }
    for attribute in element.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| shape(error.to_string()))?;
        let key = attribute.key.as_ref();
        if drop.contains(&key) || first.iter().any(|(name, _)| name.as_bytes() == key) {
            continue;
        }
        // Il valore resta i byte del file. Un valore con `"` veniva fra
        // apici, e non può contenerne uno: torna fra apici.
        let value = attribute.value.as_ref();
        let quote = if value.contains(&b'"') { b'\'' } else { b'"' };
        out.push(b' ');
        out.extend_from_slice(key);
        out.push(b'=');
        out.push(quote);
        out.extend_from_slice(value);
        out.push(quote);
    }
    out.extend_from_slice(if close.unwrap_or(empty) { b"/>" } else { b">" });
    Ok(out)
}

/// Il qualificatore `t` e il contenuto di un valore non vuoto.
fn content(prefix: Option<&[u8]>, value: &NewValue) -> (Option<&'static str>, Vec<u8>) {
    let element = |name: &str, text: &str| {
        let name = qname(prefix, name);
        let mut out = b"<".to_vec();
        out.extend_from_slice(&name);
        out.push(b'>');
        out.extend_from_slice(escape(text).as_bytes());
        out.extend_from_slice(b"</");
        out.extend_from_slice(&name);
        out.push(b'>');
        out
    };
    match value {
        NewValue::Blank => (None, Vec::new()),
        NewValue::Number(number) => (None, element("v", &number_input(*number))),
        NewValue::Bool(flag) => (Some("b"), element("v", if *flag { "1" } else { "0" })),
        NewValue::Error(error) => (Some("e"), element("v", error.as_str())),
        NewValue::Text(text) => {
            let is = qname(prefix, "is");
            let t = qname(prefix, "t");
            let mut out = b"<".to_vec();
            out.extend_from_slice(&is);
            out.extend_from_slice(b"><");
            out.extend_from_slice(&t);
            if text.starts_with([' ', '\t', '\n', '\r'])
                || text.ends_with([' ', '\t', '\n', '\r'])
                || text.contains(['\n', '\t'])
            {
                out.extend_from_slice(b" xml:space=\"preserve\"");
            }
            out.push(b'>');
            out.extend_from_slice(escape(encode_xstring(text).as_str()).as_bytes());
            out.extend_from_slice(b"</");
            out.extend_from_slice(&t);
            out.extend_from_slice(b"></");
            out.extend_from_slice(&is);
            out.push(b'>');
            (Some("inlineStr"), out)
        }
    }
}

/// Il testo come `ST_Xstring`: i caratteri che XML non ammette diventano
/// `_xHHHH_`, e un `_xHHHH_` già nel testo protegge il suo `_`. È l'inversa
/// della lettura del codec.
fn encode_xstring(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let looks_like_escape = |at: usize| {
        chars.get(at + 1) == Some(&'x')
            && chars.get(at + 6) == Some(&'_')
            && (at + 2..at + 6).all(|k| chars.get(k).is_some_and(char::is_ascii_hexdigit))
    };
    let mut out = String::with_capacity(text.len());
    for (at, &ch) in chars.iter().enumerate() {
        let xml_char = matches!(ch, '\t' | '\n' | '\r')
            || (!ch.is_control() && !matches!(ch as u32, 0xD800..=0xDFFF | 0xFFFE | 0xFFFF));
        if ch == '_' && looks_like_escape(at) {
            out.push_str("_x005F_");
        } else if !xml_char {
            out.push_str(&format!("_x{:04X}_", ch as u32 & 0xFFFF));
        } else {
            out.push(ch);
        }
    }
    out
}

/// Una cella intera: `<c r s t>contenuto</c>`, oppure `<c r s/>` vuota.
fn render_cell(
    name: &[u8],
    tag: Option<&[u8]>,
    pos: CellRef,
    style: Option<u32>,
    prefix: Option<&[u8]>,
    value: &NewValue,
) -> Result<Option<Vec<u8>>, GraftError> {
    let (kind, body) = content(prefix, value);
    let mut first = vec![("r", pos.to_string())];
    if let Some(style) = style {
        first.push(("s", style.to_string()));
    }
    if let Some(kind) = kind {
        first.push(("t", kind.to_string()));
    }
    let open = match tag {
        Some(tag) => {
            // `s` resta quello del file; il resto che descriveva il vecchio
            // valore esce.
            let drop: &[&[u8]] = &[b"r", b"t", b"cm", b"vm", b"ph"];
            let open = retag(tag, drop, &first, Some(body.is_empty()))?;
            if body.is_empty() && !has_attributes_besides_r(&open)? {
                return Ok(None);
            }
            open
        }
        None => {
            if body.is_empty() {
                return Ok(None);
            }
            let mut open = b"<".to_vec();
            open.extend_from_slice(name);
            for (key, value) in &first {
                open.extend_from_slice(format!(" {key}=\"{value}\"").as_bytes());
            }
            open.push(b'>');
            open
        }
    };
    let mut out = open;
    if !body.is_empty() {
        out.extend_from_slice(&body);
        out.extend_from_slice(b"</");
        out.extend_from_slice(element_name(&out)?.as_slice());
        out.push(b'>');
    }
    Ok(Some(out))
}

fn element_name(tag: &[u8]) -> Result<Vec<u8>, GraftError> {
    let mut reader = Reader::from_reader(tag);
    match reader.read_event() {
        Ok(Event::Start(element) | Event::Empty(element)) => Ok(element.name().as_ref().to_vec()),
        _ => Err(shape("a tag does not parse")),
    }
}

fn has_attributes_besides_r(tag: &[u8]) -> Result<bool, GraftError> {
    let mut reader = Reader::from_reader(tag);
    match reader.read_event() {
        Ok(Event::Start(element) | Event::Empty(element)) => Ok(element
            .attributes()
            .with_checks(false)
            .flatten()
            .any(|attribute| attribute.key.as_ref() != b"r")),
        _ => Err(shape("a tag does not parse")),
    }
}

/// `spans` copre la colonna (da 0)?
fn spans_cover(spans: &str, col: u32) -> bool {
    spans.split_whitespace().any(|span| {
        let mut ends = span.split(':').map(|end| end.parse::<u32>().ok());
        match (ends.next().flatten(), ends.next().flatten()) {
            (Some(min), Some(max)) => min <= col + 1 && col < max,
            _ => false,
        }
    })
}

/// Allarga `bounds` fino a `pos`.
fn grow(pos: CellRef, bounds: &mut Option<RangeRef>) {
    let cell = RangeRef::cell(pos);
    *bounds = Some(bounds.map_or(cell, |range| range.union(&cell)));
}

/// Riscrive un foglio, e dice se una formula è uscita.
fn rewrite_sheet(
    bytes: &[u8],
    layout: &SheetLayout,
    cells: &BTreeMap<CellRef, &NewValue>,
) -> Result<(Vec<u8>, bool), GraftError> {
    let prefix = layout.prefix.as_deref();
    let mut by_row: BTreeMap<u32, Vec<(u32, &NewValue)>> = BTreeMap::new();
    for (cell, value) in cells {
        by_row.entry(cell.row).or_default().push((cell.col, value));
    }
    let mut splices = Vec::new();
    let mut formula_removed = false;
    let mut bounds: Option<RangeRef> = None;

    // Le righe nuove, e quelle esistenti che cambiano.
    let mut new_rows: BTreeMap<u32, Vec<u8>> = BTreeMap::new();
    let mut touched: BTreeMap<usize, &[(u32, &NewValue)]> = BTreeMap::new();
    for (&row, values) in &by_row {
        match layout.rows.binary_search_by_key(&row, |span| span.row) {
            Ok(index) => {
                touched.insert(index, values);
            }
            Err(_) => {
                let mut xml = Vec::new();
                for &(col, value) in values {
                    let pos = CellRef::new(row, col);
                    let style = layout.inherited_style(None, col);
                    if let Some(cell) =
                        render_cell(&qname(prefix, "c"), None, pos, style, prefix, value)?
                    {
                        grow(pos, &mut bounds);
                        xml.extend_from_slice(&cell);
                    }
                }
                if !xml.is_empty() {
                    let name = qname(prefix, "row");
                    let mut out = b"<".to_vec();
                    out.extend_from_slice(&name);
                    out.extend_from_slice(format!(" r=\"{}\">", row + 1).as_bytes());
                    out.extend_from_slice(&xml);
                    out.extend_from_slice(b"</");
                    out.extend_from_slice(&name);
                    out.push(b'>');
                    new_rows.insert(row, out);
                }
            }
        }
    }

    // Una riga senza `r` che dopo una riga nuova non sarebbe più la stessa
    // prende la sua coordinata.
    let mut needs_r = BTreeSet::new();
    {
        let mut next_row = 0u32;
        let mut news = new_rows.keys().peekable();
        for (index, row) in layout.rows.iter().enumerate() {
            while let Some(&&new) = news.peek() {
                if new > row.row {
                    break;
                }
                next_row = new + 1;
                news.next();
            }
            if !row.explicit && row.row != next_row {
                needs_r.insert(index);
            }
            next_row = row.row + 1;
        }
    }

    for (index, row) in layout.rows.iter().enumerate() {
        match touched.get(&index) {
            Some(values) => {
                let cells = layout.cells.get(&index).map(Vec::as_slice).unwrap_or(&[]);
                formula_removed |= rewrite_row(
                    bytes,
                    layout,
                    row,
                    cells,
                    values,
                    needs_r.contains(&index),
                    &mut splices,
                    &mut |pos| grow(pos, &mut bounds),
                )?;
            }
            None if needs_r.contains(&index) => {
                let tag = &bytes[row.span.start..row.span.tag_end];
                splices.push(Splice {
                    start: row.span.start,
                    end: row.span.tag_end,
                    bytes: retag(tag, &[b"r"], &[("r", (row.row + 1).to_string())], None)?,
                });
            }
            None => {}
        }
    }

    // Le righe nuove al loro posto.
    if !new_rows.is_empty() {
        let data = layout.sheet_data;
        if data.empty() {
            let tag = &bytes[data.start..data.tag_end];
            let mut out = retag(tag, &[], &[], Some(false))?;
            for xml in new_rows.values() {
                out.extend_from_slice(xml);
            }
            out.extend_from_slice(b"</");
            out.extend_from_slice(&element_name(tag)?);
            out.push(b'>');
            splices.push(Splice {
                start: data.start,
                end: data.end,
                bytes: out,
            });
        } else {
            for (row, xml) in new_rows {
                let at = layout
                    .rows
                    .iter()
                    .find(|span| span.row > row)
                    .map(|span| span.span.start)
                    .or_else(|| layout.rows.last().map(|span| span.span.end))
                    .unwrap_or(data.tag_end);
                splices.push(Splice {
                    start: at,
                    end: at,
                    bytes: xml,
                });
            }
        }
    }

    if let (Some((span, reference)), Some(bounds)) = (&layout.dimension, bounds) {
        if let Some(current) = RangeRef::parse(reference) {
            let wider = current.union(&bounds);
            if wider != current {
                let tag = &bytes[span.start..span.end];
                splices.push(Splice {
                    start: span.start,
                    end: span.end,
                    bytes: retag(tag, &[b"ref"], &[("ref", wider.to_string())], None)?,
                });
            }
        }
    }

    Ok((apply(bytes, splices)?, formula_removed))
}

/// Riscrive una riga toccata, e dice se una formula è uscita.
#[allow(clippy::too_many_arguments)]
fn rewrite_row(
    bytes: &[u8],
    layout: &SheetLayout,
    row: &RowSpan,
    cells: &[CellSpan],
    values: &[(u32, &NewValue)],
    needs_r: bool,
    splices: &mut Vec<Splice>,
    grow: &mut dyn FnMut(CellRef),
) -> Result<bool, GraftError> {
    let prefix = layout.prefix.as_deref();
    let mut formula_removed = false;
    // L'esito di ogni cella esistente toccata: `None` esce.
    let mut replaced: BTreeMap<usize, Option<Vec<u8>>> = BTreeMap::new();
    let mut inserts: Vec<(u32, Vec<u8>)> = Vec::new();
    for &(col, value) in values {
        let pos = CellRef::new(row.row, col);
        match cells.binary_search_by_key(&col, |cell| cell.pos.col) {
            Ok(index) => {
                let cell = &cells[index];
                formula_removed |= cell.formula;
                let tag = &bytes[cell.span.start..cell.span.tag_end];
                let name = element_name(tag)?;
                let out = render_cell(&name, Some(tag), pos, None, prefix, value)?;
                if out.is_some() && *value != NewValue::Blank {
                    grow(pos);
                }
                replaced.insert(index, out);
            }
            Err(_) => {
                let style = layout.inherited_style(Some(row), col);
                if let Some(out) =
                    render_cell(&qname(prefix, "c"), None, pos, style, prefix, value)?
                {
                    grow(pos);
                    inserts.push((col, out));
                }
            }
        }
    }

    // Una cella senza `r` la cui coordinata cambierebbe prende la sua.
    let mut fixes = Vec::new();
    {
        let mut next_col = 0u32;
        let mut news = inserts.iter().map(|(col, _)| *col).peekable();
        for (index, cell) in cells.iter().enumerate() {
            while let Some(&new) = news.peek() {
                if new > cell.pos.col {
                    break;
                }
                next_col = new + 1;
                news.next();
            }
            match replaced.get(&index) {
                Some(None) => continue,
                Some(Some(_)) => {}
                None if !cell.explicit && cell.pos.col != next_col => fixes.push(index),
                None => {}
            }
            next_col = cell.pos.col + 1;
        }
    }

    let spans_ok = row
        .spans
        .as_deref()
        .is_none_or(|spans| inserts.iter().all(|(col, _)| spans_cover(spans, *col)));
    let mut drop: Vec<&[u8]> = Vec::new();
    let mut first = Vec::new();
    if !spans_ok {
        drop.push(b"spans");
    }
    if needs_r || !row.explicit {
        drop.push(b"r");
        first.push(("r", (row.row + 1).to_string()));
    }
    let tag = &bytes[row.span.start..row.span.tag_end];

    if row.span.empty() {
        // `<row/>` con celle nuove diventa `<row>…</row>`.
        if inserts.is_empty() {
            if needs_r {
                splices.push(Splice {
                    start: row.span.start,
                    end: row.span.end,
                    bytes: retag(tag, &drop, &first, None)?,
                });
            }
            return Ok(formula_removed);
        }
        let mut out = retag(tag, &drop, &first, Some(false))?;
        for (_, xml) in inserts {
            out.extend_from_slice(&xml);
        }
        out.extend_from_slice(b"</");
        out.extend_from_slice(&element_name(tag)?);
        out.push(b'>');
        splices.push(Splice {
            start: row.span.start,
            end: row.span.end,
            bytes: out,
        });
        return Ok(formula_removed);
    }

    if !spans_ok || needs_r {
        splices.push(Splice {
            start: row.span.start,
            end: row.span.tag_end,
            bytes: retag(tag, &drop, &first, None)?,
        });
    }
    for (index, out) in replaced {
        let cell = &cells[index];
        splices.push(Splice {
            start: cell.span.start,
            end: cell.span.end,
            bytes: out.unwrap_or_default(),
        });
    }
    for index in fixes {
        let cell = &cells[index];
        let tag = &bytes[cell.span.start..cell.span.tag_end];
        splices.push(Splice {
            start: cell.span.start,
            end: cell.span.tag_end,
            bytes: retag(tag, &[b"r"], &[("r", cell.pos.to_string())], None)?,
        });
    }
    for (col, xml) in inserts {
        let at = cells
            .iter()
            .find(|cell| cell.pos.col > col)
            .map(|cell| cell.span.start)
            .or_else(|| cells.last().map(|cell| cell.span.end))
            .unwrap_or(row.span.tag_end);
        splices.push(Splice {
            start: at,
            end: at,
            bytes: xml,
        });
    }
    Ok(formula_removed)
}

/// Gli elementi della cartella che nello schema vengono dopo `calcPr`.
const AFTER_CALC_PR: [&[u8]; 9] = [
    b"oleSize",
    b"customWorkbookViews",
    b"pivotCaches",
    b"smartTagPr",
    b"smartTagTypes",
    b"webPublishing",
    b"fileRecoveryPr",
    b"webPublishObjects",
    b"extLst",
];

/// `xl/workbook.xml` con `fullCalcOnLoad="1"` nel calcolo.
fn full_calc_on_load(xml: &[u8]) -> Result<Vec<u8>, GraftError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut depth = 0usize;
    let mut prefix: Option<Vec<u8>> = None;
    let mut before: Option<usize> = None;
    loop {
        let start = reader.buffer_position() as usize;
        let event = reader
            .read_event()
            .map_err(|error| package::xml_error("workbook", error))?;
        let end = reader.buffer_position() as usize;
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                let empty = matches!(event, Event::Empty(_));
                let name = element.name();
                if depth == 0 {
                    prefix = package::prefix(name.as_ref()).map(<[u8]>::to_vec);
                }
                if depth == 1 {
                    let local = local(name.as_ref());
                    if local == b"calcPr" {
                        let tag = retag(
                            &xml[start..end],
                            &[b"fullCalcOnLoad"],
                            &[("fullCalcOnLoad", "1".into())],
                            None,
                        )?;
                        return apply(
                            xml,
                            vec![Splice {
                                start,
                                end,
                                bytes: tag,
                            }],
                        );
                    }
                    if before.is_none() && AFTER_CALC_PR.contains(&local) {
                        before = Some(start);
                    }
                }
                if !empty {
                    depth += 1;
                }
            }
            Event::End(_) => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let at = before.unwrap_or(start);
                    let mut tag = b"<".to_vec();
                    tag.extend_from_slice(&qname(prefix.as_deref(), "calcPr"));
                    tag.extend_from_slice(b" fullCalcOnLoad=\"1\"/>");
                    return apply(
                        xml,
                        vec![Splice {
                            start: at,
                            end: at,
                            bytes: tag,
                        }],
                    );
                }
            }
            Event::Eof => return Err(shape("workbook has no root")),
            _ => {}
        }
    }
}

/// Toglie gli elementi vuoti `name` il cui attributo `key` soddisfa `matches`.
fn remove_empty(
    xml: &[u8],
    name: &[u8],
    matches: impl Fn(&str) -> bool,
    key: &[u8],
) -> Result<Vec<u8>, GraftError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut splices = Vec::new();
    loop {
        let start = reader.buffer_position() as usize;
        let event = reader
            .read_event()
            .map_err(|error| package::xml_error("relationships", error))?;
        let end = reader.buffer_position() as usize;
        match event {
            Event::Empty(ref element)
                if local(element.name().as_ref()) == name
                    && attr(element, key).is_some_and(|value| matches(&value)) =>
            {
                splices.push(Splice {
                    start,
                    end,
                    bytes: Vec::new(),
                });
            }
            Event::Start(ref element)
                if local(element.name().as_ref()) == name
                    && attr(element, key).is_some_and(|value| matches(&value)) =>
            {
                return Err(shape("a relationship with content"));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    apply(xml, splices)
}

fn zip_error(error: impl std::fmt::Display) -> GraftError {
    GraftError::Package(format!("zip: {error}"))
}

/// Lo zip di partenza con le parti `replaced` riscritte e quelle `removed`
/// tolte; ogni altra voce si copia così com'è.
fn rezip(
    original: &[u8],
    mut replaced: HashMap<String, Vec<u8>>,
    removed: &BTreeSet<String>,
) -> Result<Vec<u8>, GraftError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(original)).map_err(zip_error)?;
    let mut out = zip::ZipWriter::new(Cursor::new(Vec::with_capacity(original.len())));
    for index in 0..archive.len() {
        let file = archive.by_index_raw(index).map_err(zip_error)?;
        let name = file.name().map_err(zip_error)?.to_string();
        let key = normalize(&name);
        if removed.contains(&key) {
            continue;
        }
        match replaced.remove(&key) {
            Some(bytes) => {
                // Il sistema e gli attributi sono quelli della voce del file:
                // senza, il crate scrive quelli della macchina, e lo stesso
                // innesto darebbe byte diversi su Windows.
                let mut options = zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated)
                    .compression_level(Some(6))
                    .system(file.system())
                    .external_attributes(file.external_attributes());
                if let Some(time) = file.last_modified() {
                    options = options.last_modified_time(time);
                }
                drop(file);
                out.start_file(name.as_str(), options).map_err(zip_error)?;
                out.write_all(&bytes).map_err(zip_error)?;
            }
            None => out.raw_copy_file(file).map_err(zip_error)?,
        }
    }
    if !replaced.is_empty() {
        return Err(shape("a replaced part is not in the zip"));
    }
    if !archive.comment().is_empty() {
        out.set_raw_comment(archive.comment().into())
            .map_err(zip_error)?;
    }
    Ok(out.finish().map_err(zip_error)?.into_inner())
}

/// Due celle uguali per chi le legge: valore, formula e stile.
fn same_cell(a: &Cell, a_styles: &StyleTable, b: &Cell, b_styles: &StyleTable) -> bool {
    a.value == b.value
        && a.formula.as_ref().map(|f| (&f.text, f.array))
            == b.formula.as_ref().map(|f| (&f.text, f.array))
        && a_styles.get(a.style) == b_styles.get(b.style)
}

fn expected(value: &NewValue) -> Value {
    match value {
        NewValue::Blank => Value::Empty,
        NewValue::Number(number) => Value::Number(*number),
        NewValue::Text(text) => Value::text(text.as_str()),
        NewValue::Bool(flag) => Value::Bool(*flag),
        NewValue::Error(error) => Value::Error(*error),
    }
}

fn verify_sheet(
    index: usize,
    before: &Sheet,
    before_styles: &StyleTable,
    after: &Sheet,
    after_styles: &StyleTable,
    edits: Option<&BTreeMap<CellRef, &NewValue>>,
) -> Result<(), GraftError> {
    let fail = |what: String| Err(GraftError::Verify(format!("sheet {index}: {what}")));
    let edited = |pos: &CellRef| edits.is_some_and(|edits| edits.contains_key(pos));
    if before.name != after.name {
        return fail("the name changed".into());
    }
    if before.cells.len() != after.cells.len() && edits.is_none() {
        return fail("the cells changed".into());
    }
    for (pos, cell) in before.cells.iter() {
        if edited(&pos) {
            continue;
        }
        match after.cells.get(pos) {
            Some(other) if same_cell(cell, before_styles, other, after_styles) => {}
            _ => return fail(format!("{pos} changed")),
        }
    }
    for (pos, _) in after.cells.iter() {
        if !edited(&pos) && before.cells.get(pos).is_none() {
            return fail(format!("{pos} appeared"));
        }
    }
    if before.spill != after.spill
        || before.spill_ranges != after.spill_ranges
        || before.merges != after.merges
        || before.tables.len() != after.tables.len()
        || before.cell_pictures.keys().ne(after.cell_pictures.keys())
    {
        return fail("the sheet structure changed".into());
    }
    for (pos, value) in edits.into_iter().flatten() {
        let cell = after.cells.get(*pos);
        let value_now = cell.map(|cell| &cell.value).unwrap_or(&Value::Empty);
        if *value_now != expected(value) || cell.is_some_and(|cell| cell.formula.is_some()) {
            return fail(format!("{pos} does not hold the new value"));
        }
    }
    Ok(())
}

fn verify(
    model: &Workbook,
    bytes: &[u8],
    edits: &BTreeMap<usize, BTreeMap<CellRef, &NewValue>>,
) -> Result<(), GraftError> {
    let after = crate::read(bytes)?.workbook;
    if after.sheets.len() != model.sheets.len() {
        return Err(GraftError::Verify("the sheets changed".into()));
    }
    for (index, (before, now)) in model.sheets.iter().zip(&after.sheets).enumerate() {
        verify_sheet(
            index,
            before,
            &model.styles,
            now,
            &after.styles,
            edits.get(&index),
        )?;
    }
    Ok(())
}
