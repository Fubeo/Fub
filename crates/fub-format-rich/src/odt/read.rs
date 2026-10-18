//! Da `content.xml` alla proiezione.
//!
//! Ogni nodo della proiezione porta con sé i byte originali che la superficie
//! non mostra: il tag d'apertura del paragrafo e degli elenchi che lo
//! contengono, quelli degli involucri di un tratto, l'XML intero di un
//! oggetto, i tag di tabelle, righe e celle (vedi [`keys`](super::keys)).
//! Tutto ciò che sta fra i blocchi del corpo e la proiezione non mostra —
//! dichiarazioni, moduli, indici, cornici ancorate alla pagina, i confini delle
//! sezioni, i commenti XML — resta un intervallo di byte fisso, che lo
//! scrittore rimette al suo posto.
//!
//! Il testo segue la regola degli spazi di ODF: una sequenza di spazi, tab e
//! a-capo letterali vale uno spazio, e all'inizio del paragrafo nessuno;
//! `text:s`, `text:tab` e `text:line-break` contano sempre.
//!
//! Ciò che il lettore non sa rappresentare senza perdite (un elenco con una
//! voce vuota, una tabella con righe ripetute, un contenitore sconosciuto con
//! dei paragrafi dentro) è [`RichError::Codec`]: il documento si apre allora
//! con l'importatore, in sola lettura.

use std::ops::Range;

use super::keys::{AtomKey, CellKey, Level, ParaKey, RowKey, RunKey, TableKey};
use super::styles::{LevelKind, Styles};
use super::xml::{Kind, NodeId, Tree};
use crate::blob;
use crate::projection::{AtomKind, Block, Cell, Inline, Look, Para, Role, Row, Table};
use crate::{ReadOnly, RichError};

/// Più spazi di così in un solo `text:s` non sono un documento ma un attacco.
const MAX_SPACES: usize = 10_000;

/// Un pezzo del corpo del documento.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Unit {
    /// Byte che la proiezione non mostra e lo scrittore rimette com'erano.
    Fixed(Range<usize>),
    /// Un paragrafo, un elenco o una tabella: i blocchi che mostra.
    Blocks {
        span: Range<usize>,
        blocks: Vec<Block>,
        /// L'elemento di ciascun blocco: il paragrafo o la tabella.
        nodes: Vec<NodeId>,
    },
}

/// Il corpo letto.
#[derive(Clone, Debug)]
pub(crate) struct Body {
    /// Dove comincia e finisce il contenuto di `office:text`.
    pub inner: Range<usize>,
    pub units: Vec<Unit>,
    pub readonly: Option<ReadOnly>,
}

impl Body {
    pub fn blocks(&self) -> Vec<Block> {
        self.units
            .iter()
            .flat_map(|unit| match unit {
                Unit::Blocks { blocks, .. } => blocks.clone(),
                Unit::Fixed(_) => Vec::new(),
            })
            .collect()
    }
}

pub(crate) fn unsupported(what: impl std::fmt::Display) -> RichError {
    RichError::Codec(format!("odt: {what} is not supported"))
}

struct Reader<'a> {
    tree: &'a Tree,
    styles: &'a Styles,
    readonly: Option<ReadOnly>,
    /// Due elenchi vicini con lo stesso tag d'apertura: riscritti, si
    /// fonderebbero in uno.
    merge: bool,
}

/// Legge il corpo di `content.xml`. `settings` è `settings.xml`, se c'è.
pub(crate) fn body(
    tree: &Tree,
    styles: &Styles,
    settings: Option<&Tree>,
) -> Result<Body, RichError> {
    if tree.name(tree.root) != "office:document-content" {
        return Err(unsupported(format!("root {}", tree.name(tree.root))));
    }
    let text = tree
        .child(tree.root, "office:body")
        .and_then(|body| tree.child(body, "office:text"))
        .ok_or_else(|| unsupported("a document without office:text"))?;
    if tree
        .element(text)
        .is_some_and(|e| e.open == tree.nodes[text].span)
    {
        return Err(unsupported("an empty office:text"));
    }
    let mut reader = Reader {
        tree,
        styles,
        readonly: None,
        merge: false,
    };
    let inner = inner(tree, text);
    let mut units = Vec::new();
    reader.scope(text, inner.clone(), &mut units)?;
    let mut readonly = reader.readonly;
    if readonly.is_none() && reader.merge {
        readonly = Some(ReadOnly::Projection);
    }
    if let Some(settings) = settings {
        readonly = policy(settings, readonly);
    }
    Ok(Body {
        inner,
        units,
        readonly,
    })
}

/// Ciò che le impostazioni dicono del documento, se il corpo non ha già detto
/// di più: le revisioni vengono prima della registrazione, e questa prima
/// della protezione.
fn policy(settings: &Tree, found: Option<ReadOnly>) -> Option<ReadOnly> {
    let mut record = false;
    let mut protect = false;
    for node in &settings.nodes {
        let Kind::Element(e) = &node.kind else {
            continue;
        };
        if e.name != "config:config-item" {
            continue;
        }
        let on = e
            .children
            .iter()
            .any(|&c| matches!(&settings.nodes[c].kind, Kind::Text(t) if t.trim() == "true"));
        match e.attr("config:name") {
            Some("RecordChanges") => record |= on,
            Some("LoadReadonly") => protect |= on,
            _ => {}
        }
    }
    match found {
        Some(ReadOnly::Revisions) => found,
        _ if record => Some(ReadOnly::TrackChanges),
        Some(_) => found,
        None if protect => Some(ReadOnly::Protected),
        None => None,
    }
}

/// I byte fra il tag d'apertura e quello di chiusura di un elemento.
pub(crate) fn inner(tree: &Tree, id: NodeId) -> Range<usize> {
    let node = &tree.nodes[id];
    let Kind::Element(e) = &node.kind else {
        return node.span.clone();
    };
    if e.open == node.span {
        return node.span.end..node.span.end;
    }
    let end = match e.children.last() {
        Some(&last) => {
            // Dopo l'ultimo figlio può esserci soltanto ciò che non è un nodo
            // (un commento) e poi la chiusura.
            tree.source[tree.nodes[last].span.end..node.span.end]
                .windows(2)
                .rposition(|w| w == b"</")
                .map_or(node.span.end, |at| tree.nodes[last].span.end + at)
        }
        None => tree.source[e.open.end..node.span.end]
            .windows(2)
            .rposition(|w| w == b"</")
            .map_or(node.span.end, |at| e.open.end + at),
    };
    e.open.end..end
}

/// I figli coprono tutto il contenuto: niente commenti o istruzioni fra loro,
/// che una riscrittura perderebbe.
fn tiles(tree: &Tree, id: NodeId) -> Result<(), RichError> {
    let range = inner(tree, id);
    let mut at = range.start;
    for &child in tree.children(id) {
        let span = &tree.nodes[child].span;
        if span.start != at {
            return Err(unsupported(format!("markup inside {}", tree.name(id))));
        }
        at = span.end;
    }
    if at != range.end {
        return Err(unsupported(format!("markup inside {}", tree.name(id))));
    }
    Ok(())
}

fn is_blank(tree: &Tree, id: NodeId) -> bool {
    matches!(&tree.nodes[id].kind, Kind::Text(t) if t.chars().all(is_space))
}

pub(crate) fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

/// Gli elementi del corpo che non hanno paragrafi da mostrare, o i cui
/// paragrafi non sono di chi scrive (indici generati, cornici della pagina).
fn fixed(name: &str) -> bool {
    matches!(
        name,
        "text:sequence-decls"
            | "text:variable-decls"
            | "text:user-field-decls"
            | "text:dde-connection-decls"
            | "office:forms"
            | "text:soft-page-break"
            | "text:table-of-content"
            | "text:illustration-index"
            | "text:table-index"
            | "text:object-index"
            | "text:user-index"
            | "text:alphabetical-index"
            | "text:bibliography"
    ) || name.starts_with("draw:")
        || name.starts_with("dr3d:")
}

impl Reader<'_> {
    fn src(&self, range: Range<usize>) -> Result<String, RichError> {
        String::from_utf8(self.tree.source[range].to_vec())
            .map_err(|_| RichError::Codec("odt: content.xml is not UTF-8".into()))
    }

    fn has_paragraphs(&self, id: NodeId) -> bool {
        self.tree.find(id, "text:p").is_some() || self.tree.find(id, "text:h").is_some()
    }

    /// Il corpo, o l'interno di una sezione: blocchi e byte fissi.
    fn scope(
        &mut self,
        id: NodeId,
        range: Range<usize>,
        units: &mut Vec<Unit>,
    ) -> Result<(), RichError> {
        let tree = self.tree;
        let mut at = range.start;
        let mut last_list: Option<Vec<u8>> = None;
        for &child in tree.children(id) {
            let span = tree.nodes[child].span.clone();
            if span.start > at {
                units.push(Unit::Fixed(at..span.start));
            }
            at = span.end;
            let name = tree.name(child);
            if name != "text:list" && !is_blank(tree, child) && name != "text:soft-page-break" {
                last_list = None;
            }
            match name {
                "" if is_blank(tree, child) => units.push(Unit::Fixed(span)),
                "" => return Err(unsupported("text outside paragraphs")),
                "text:p" | "text:h" => {
                    let para = self.para(child, Vec::new())?;
                    units.push(Unit::Blocks {
                        span,
                        blocks: vec![Block::Para(para)],
                        nodes: vec![child],
                    });
                }
                "text:list" => {
                    let open = tree.open_tag(child).to_vec();
                    if last_list.as_ref() == Some(&open) {
                        self.merge = true;
                    }
                    last_list = Some(open);
                    let mut found = Vec::new();
                    self.list(child, &mut Vec::new(), &mut Vec::new(), &mut found)?;
                    let (blocks, nodes) = found.into_iter().unzip();
                    units.push(Unit::Blocks {
                        span,
                        blocks,
                        nodes,
                    });
                }
                "table:table" => {
                    let table = self.table(child)?;
                    units.push(Unit::Blocks {
                        span,
                        blocks: vec![Block::Table(table)],
                        nodes: vec![child],
                    });
                }
                "text:section" => {
                    let section = tree.element(child).expect("an element");
                    if section.attr("text:protected") == Some("true") {
                        self.readonly.get_or_insert(ReadOnly::Protected);
                    }
                    let inside = inner(tree, child);
                    units.push(Unit::Fixed(span.start..inside.start));
                    self.scope(child, inside.clone(), units)?;
                    units.push(Unit::Fixed(inside.end..span.end));
                }
                "text:tracked-changes" => {
                    let e = tree.element(child).expect("an element");
                    if tree.elements(child).next().is_some() {
                        self.readonly = Some(ReadOnly::Revisions);
                    } else if e.attr("text:track-changes") == Some("true") {
                        self.readonly.get_or_insert(ReadOnly::TrackChanges);
                    }
                    units.push(Unit::Fixed(span));
                }
                name if fixed(name) || !self.has_paragraphs(child) => {
                    units.push(Unit::Fixed(span));
                }
                name => return Err(unsupported(name)),
            }
        }
        if range.end > at {
            units.push(Unit::Fixed(at..range.end));
        }
        Ok(())
    }

    /// I blocchi di una cella: paragrafi, elenchi, tabelle.
    fn cell_blocks(&mut self, id: NodeId) -> Result<Vec<Block>, RichError> {
        let tree = self.tree;
        tiles(tree, id)?;
        let mut out = Vec::new();
        let mut last_list: Option<Vec<u8>> = None;
        for &child in tree.children(id) {
            match tree.name(child) {
                "" if is_blank(tree, child) => continue,
                "text:soft-page-break" => continue,
                "text:p" | "text:h" => out.push(Block::Para(self.para(child, Vec::new())?)),
                "text:list" => {
                    let open = tree.open_tag(child).to_vec();
                    if last_list.as_ref() == Some(&open) {
                        self.merge = true;
                    }
                    last_list = Some(open);
                    let mut found = Vec::new();
                    self.list(child, &mut Vec::new(), &mut Vec::new(), &mut found)?;
                    out.extend(found.into_iter().map(|(block, _)| block));
                    continue;
                }
                "table:table" => out.push(Block::Table(self.table(child)?)),
                "" => return Err(unsupported("text outside paragraphs")),
                name => return Err(unsupported(format!("{name} in a cell"))),
            }
            last_list = None;
        }
        Ok(out)
    }

    /// Un elenco, appiattito nei suoi paragrafi. `chain` sono i livelli che lo
    /// contengono; `pending` dice, per ognuno, se la sua voce corrente non ha
    /// ancora dato un paragrafo.
    fn list(
        &mut self,
        id: NodeId,
        chain: &mut Vec<(String, String)>,
        pending: &mut Vec<bool>,
        out: &mut Vec<(Block, NodeId)>,
    ) -> Result<(), RichError> {
        let tree = self.tree;
        tiles(tree, id)?;
        let list_tag = self.src(tree.element(id).expect("an element").open.clone())?;
        if list_tag.ends_with("/>") {
            return Err(unsupported("an empty list"));
        }
        let mut items = 0;
        for &item in tree.children(id) {
            match tree.name(item) {
                "" if is_blank(tree, item) => continue,
                "text:list-item" | "text:list-header" => {}
                name => return Err(unsupported(format!("{name} in a list"))),
            }
            items += 1;
            tiles(tree, item)?;
            let item_tag = self.src(tree.element(item).expect("an element").open.clone())?;
            chain.push((list_tag.clone(), item_tag));
            pending.push(true);
            for &child in tree.children(item) {
                match tree.name(child) {
                    "" if is_blank(tree, child) => {}
                    "text:soft-page-break" => {}
                    "text:p" | "text:h" => {
                        let levels = chain
                            .iter()
                            .zip(pending.iter())
                            .map(|((list, item), open)| Level {
                                list: list.clone(),
                                item: item.clone(),
                                open: *open,
                            })
                            .collect();
                        pending.iter_mut().for_each(|p| *p = false);
                        out.push((Block::Para(self.para(child, levels)?), child));
                    }
                    "text:list" => self.list(child, chain, pending, out)?,
                    name => return Err(unsupported(format!("{name} in a list item"))),
                }
            }
            if pending.pop() == Some(true) {
                return Err(unsupported("an empty list item"));
            }
            chain.pop();
        }
        if items == 0 {
            return Err(unsupported("a list without items"));
        }
        Ok(())
    }

    fn para(&mut self, id: NodeId, list: Vec<Level>) -> Result<Para, RichError> {
        let tree = self.tree;
        tiles(tree, id)?;
        let e = tree.element(id).expect("an element");
        let style = e.attr("text:style-name");
        let mut inlines = Inlines {
            reader: self,
            para_style: style,
            out: Vec::new(),
            ignore: true,
            wrappers: Vec::new(),
            current: None,
        };
        inlines.walk(id)?;
        let c = inlines.out;
        // Un paragrafo vuoto (`<text:p/>`) e uno senza contenuto
        // (`<text:p></text:p>`) sono lo stesso paragrafo: il tag si conserva
        // nella forma che si riapre.
        let key = ParaKey {
            tag: super::keys::opening(&self.src(e.open.clone())?),
            list,
        };
        let role = role(self.styles, &key);
        Ok(Para {
            role,
            align: self.styles.align(style),
            k: Some(blob::encode(&key)?),
            sect: None,
            p: self.styles.layout(style),
            s: (role == Role::Body)
                .then(|| self.styles.common_of(style))
                .flatten(),
            f: self.styles.text(style, &[]).base(),
            c,
        })
    }

    fn table(&mut self, id: NodeId) -> Result<Table, RichError> {
        let tree = self.tree;
        tiles(tree, id)?;
        let e = tree.element(id).expect("an element");
        if e.open == tree.nodes[id].span {
            return Err(unsupported("an empty table"));
        }
        let mut head_end = None;
        let mut rows = Vec::new();
        let mut movable = true;
        for &child in tree.children(id) {
            let name = tree.name(child);
            let header = match name {
                "table:table-row" => false,
                "table:table-header-rows" => true,
                "" if is_blank(tree, child) => continue,
                "text:soft-page-break" if head_end.is_some() => continue,
                "table:table-column"
                | "table:table-columns"
                | "table:table-column-group"
                | "table:table-header-columns"
                | "table:title"
                | "table:desc"
                | "text:soft-page-break"
                    if head_end.is_none() =>
                {
                    continue
                }
                name => return Err(unsupported(format!("{name} in a table"))),
            };
            head_end.get_or_insert(tree.nodes[child].span.start);
            if header {
                tiles(tree, child)?;
                for &row in tree.children(child) {
                    match tree.name(row) {
                        "table:table-row" => rows.push(self.row(row, true, &mut movable)?),
                        "" if is_blank(tree, row) => {}
                        "text:soft-page-break" => {}
                        name => return Err(unsupported(format!("{name} in header rows"))),
                    }
                }
            } else {
                rows.push(self.row(child, false, &mut movable)?);
            }
        }
        let head_end = head_end.ok_or_else(|| unsupported("a table without rows"))?;
        let key = TableKey {
            open: self.src(e.open.clone())?,
            head: self.src(e.open.end..head_end)?,
            rows: movable,
        };
        Ok(Table {
            k: Some(blob::encode(&key)?),
            rows,
        })
    }

    fn row(&mut self, id: NodeId, header: bool, movable: &mut bool) -> Result<Row, RichError> {
        let tree = self.tree;
        tiles(tree, id)?;
        let e = tree.element(id).expect("an element");
        if e.attr("table:number-rows-repeated")
            .is_some_and(|n| n != "1")
        {
            return Err(unsupported("repeated table rows"));
        }
        let inside = inner(tree, id);
        let mut cells: Vec<(NodeId, Range<usize>)> = Vec::new();
        let mut lead_end = None;
        for &child in tree.children(id) {
            let span = tree.nodes[child].span.clone();
            match tree.name(child) {
                "table:table-cell" => {
                    let cell = tree.element(child).expect("an element");
                    if cell
                        .attr("table:number-columns-repeated")
                        .is_some_and(|n| n != "1")
                    {
                        return Err(unsupported("repeated table cells"));
                    }
                    if cell
                        .attr("table:number-rows-spanned")
                        .is_some_and(|n| n != "1")
                    {
                        *movable = false;
                    }
                    lead_end.get_or_insert(span.start);
                    if let Some(last) = cells.last_mut() {
                        last.1.end = span.start;
                    }
                    cells.push((child, span.end..inside.end));
                }
                "table:covered-table-cell" | "text:soft-page-break" => {
                    if cells.is_empty() {
                        *movable = false;
                    }
                }
                "" if is_blank(tree, child) => {}
                name => return Err(unsupported(format!("{name} in a table row"))),
            }
        }
        let lead_end = lead_end.ok_or_else(|| unsupported("a table row without cells"))?;
        let key = RowKey {
            open: self.src(e.open.clone())?,
            header,
            lead: self.src(inside.start..lead_end)?,
        };
        let cells = cells
            .into_iter()
            .map(|(cell, tail)| {
                let e = tree.element(cell).expect("an element");
                let key = CellKey {
                    open: self.src(e.open.clone())?,
                    tail: self.src(tail)?,
                };
                let span = e.attr("table:number-columns-spanned");
                Ok(Cell {
                    k: Some(blob::encode(&key)?),
                    span: span.and_then(|n| n.parse().ok()).filter(|n| *n > 1),
                    blocks: self.cell_blocks(cell)?,
                })
            })
            .collect::<Result<_, RichError>>()?;
        Ok(Row {
            k: Some(blob::encode(&key)?),
            cells,
        })
    }
}

/// Il ruolo di un paragrafo dalle sue chiavi: lo stesso calcolo per il
/// paragrafo letto e per quello che lo scrittore riceve indietro.
pub(crate) fn role(styles: &Styles, key: &ParaKey) -> Role {
    let Some((name, attrs)) = super::keys::tag(&key.tag) else {
        return Role::Body;
    };
    let style = attrs
        .iter()
        .find(|(k, _)| k == "text:style-name")
        .map(|(_, v)| v.as_str());
    if name == "text:h" {
        let level = attrs
            .iter()
            .find(|(k, _)| k == "text:outline-level")
            .and_then(|(_, v)| v.trim().parse::<u8>().ok())
            .unwrap_or(1);
        return Role::Heading {
            level: level.clamp(1, 9),
        };
    }
    if let Some(deepest) = key.list.last() {
        if deepest.open && deepest.item.starts_with("<text:list-item") {
            let depth = key.list.len() - 1;
            let level = u8::try_from(depth).unwrap_or(u8::MAX);
            let list_style = list_style(styles, &key.list, style);
            match styles.level_kind(list_style.as_deref(), level) {
                LevelKind::Number => {
                    return Role::List {
                        ordered: true,
                        level: level.min(8),
                    }
                }
                LevelKind::Bullet => {
                    return Role::List {
                        ordered: false,
                        level: level.min(8),
                    }
                }
                LevelKind::Unnumbered => {}
            }
        }
    }
    if styles.is_quote(style) {
        return Role::Quote;
    }
    Role::Body
}

/// Lo stile d'elenco che vale per un paragrafo: quello dell'elenco più vicino
/// che lo nomina, altrimenti quello dello stile del paragrafo.
pub(crate) fn list_style(styles: &Styles, list: &[Level], para: Option<&str>) -> Option<String> {
    list.iter()
        .rev()
        .find_map(|level| {
            super::keys::tag(&level.list).and_then(|(_, attrs)| {
                attrs
                    .into_iter()
                    .find(|(k, _)| k == "text:style-name")
                    .map(|(_, v)| v)
            })
        })
        .or_else(|| styles.para_list_style(para).map(str::to_string))
}

struct Wrapper {
    tag: String,
    styles: Vec<String>,
    href: Option<String>,
}

struct Inlines<'r, 'a> {
    reader: &'r mut Reader<'a>,
    para_style: Option<&'a str>,
    out: Vec<Inline>,
    /// Il prossimo spazio letterale non conta.
    ignore: bool,
    wrappers: Vec<Wrapper>,
    /// `k`, enfasi, link e aspetto del testo agli involucri correnti.
    current: Option<Current>,
}

type Current = (
    Option<String>,
    Vec<crate::projection::Mark>,
    Option<String>,
    Look,
);

impl<'a> Inlines<'_, 'a> {
    fn walk(&mut self, id: NodeId) -> Result<(), RichError> {
        let tree = self.reader.tree;
        for &child in tree.children(id) {
            let element = match &tree.nodes[child].kind {
                Kind::Text(text) => {
                    let mut out = String::new();
                    for c in text.chars() {
                        if is_space(c) {
                            if !self.ignore {
                                out.push(' ');
                                self.ignore = true;
                            }
                        } else if c == wordcraft_doc::para::OBJ {
                            return Err(unsupported("an object replacement character"));
                        } else {
                            out.push(c);
                            self.ignore = false;
                        }
                    }
                    self.text(&out)?;
                    continue;
                }
                Kind::Element(e) => e,
            };
            match element.name.as_str() {
                "text:s" => {
                    let n = element
                        .attr("text:c")
                        .map_or(Ok(1), |c| c.trim().parse::<usize>())
                        .map_err(|_| unsupported("a malformed text:s"))?;
                    if n > MAX_SPACES {
                        return Err(unsupported("too many spaces"));
                    }
                    self.text(&" ".repeat(n))?;
                    self.ignore = false;
                }
                "text:tab" => {
                    self.text("\t")?;
                    self.ignore = false;
                }
                "text:line-break" => {
                    self.text("\n")?;
                    self.ignore = false;
                }
                "text:span" | "text:a" | "loext:content-control" => {
                    tiles(tree, child)?;
                    let mut styles: Vec<String> = element
                        .attr("text:class-names")
                        .map(|names| names.split_whitespace().map(str::to_string).collect())
                        .unwrap_or_default();
                    if let Some(style) = element.attr("text:style-name") {
                        styles.push(style.to_string());
                    }
                    self.wrappers.push(Wrapper {
                        tag: self.reader.src(element.open.clone())?,
                        styles,
                        href: (element.name == "text:a")
                            .then(|| element.attr("xlink:href").unwrap_or("").to_string()),
                    });
                    self.current = None;
                    if element.open != tree.nodes[child].span {
                        self.walk(child)?;
                    }
                    self.wrappers.pop();
                    self.current = None;
                }
                _ => {
                    let atom = self.atom(child)?;
                    self.out.push(atom);
                }
            }
        }
        Ok(())
    }

    fn text(&mut self, x: &str) -> Result<(), RichError> {
        if x.is_empty() {
            return Ok(());
        }
        if self.current.is_none() {
            let k = if self.wrappers.is_empty() {
                None
            } else {
                Some(blob::encode(&RunKey {
                    wrap: self.wrappers.iter().map(|w| w.tag.clone()).collect(),
                })?)
            };
            let layers: Vec<Vec<String>> = self.wrappers.iter().map(|w| w.styles.clone()).collect();
            let props = self.reader.styles.text(self.para_style, &layers);
            let m = props.marks();
            let f = props.look(&self.reader.styles.text(self.para_style, &[]));
            let href = self.wrappers.iter().rev().find_map(|w| w.href.clone());
            self.current = Some((k, m, href, f));
        }
        let (k, m, href, f) = self.current.clone().expect("just set");
        if let Some(Inline::Text {
            x: previous,
            k: pk,
            m: pm,
            href: ph,
            f: pf,
        }) = self.out.last_mut()
        {
            if *pk == k && *pm == m && *ph == href && *pf == f {
                previous.push_str(x);
                return Ok(());
            }
        }
        self.out.push(Inline::Text {
            x: x.to_string(),
            k,
            m,
            href,
            f,
        });
        Ok(())
    }

    fn atom(&mut self, id: NodeId) -> Result<Inline, RichError> {
        let tree = self.reader.tree;
        let key = AtomKey {
            wrap: self.wrappers.iter().map(|w| w.tag.clone()).collect(),
            xml: self.reader.src(tree.nodes[id].span.clone())?,
        };
        let (kind, label, size) = describe(tree, id);
        Ok(Inline::Atom {
            k: Some(blob::encode(&key)?),
            kind,
            label,
            w: size.map(|(w, _)| w),
            h: size.map(|(_, h)| h),
            data: None,
            note: None,
            end: false,
        })
    }
}

/// Che cosa è un oggetto, che cosa mostra e quanto è grande.
fn describe(tree: &Tree, id: NodeId) -> (AtomKind, String, Option<(f32, f32)>) {
    let e = tree.element(id).expect("an element");
    let size = || {
        let w = e.attr("svg:width").and_then(points)?;
        let h = e.attr("svg:height").and_then(points)?;
        Some((w, h))
    };
    let text = || label(&text_of(tree, id));
    let name = e.name.as_str();
    match name {
        "draw:frame" => {
            let title = ["svg:title", "svg:desc"]
                .iter()
                .find_map(|t| tree.child(id, t).map(|c| label(&text_of(tree, c))))
                .filter(|t| !t.is_empty())
                .or_else(|| e.attr("draw:name").map(str::to_string))
                .unwrap_or_default();
            let kind = if tree.child(id, "draw:image").is_some() {
                AtomKind::Image
            } else if tree.child(id, "draw:text-box").is_some() {
                AtomKind::Shape
            } else {
                AtomKind::Graphic
            };
            (kind, title, size())
        }
        "draw:g" => (AtomKind::Group, String::new(), size()),
        "draw:a" => {
            let inner = tree.elements(id).next().map(|(c, _)| c);
            match inner {
                Some(inner) => describe(tree, inner),
                None => (AtomKind::Opaque, String::new(), None),
            }
        }
        "text:note" => {
            let citation = tree
                .child(id, "text:note-citation")
                .map(|c| label(&text_of(tree, c)))
                .unwrap_or_default();
            (AtomKind::Note, citation, None)
        }
        "text:ruby" => {
            let base = tree
                .child(id, "text:ruby-base")
                .map(|c| label(&text_of(tree, c)))
                .unwrap_or_default();
            (AtomKind::Ruby, base, None)
        }
        "text:soft-page-break"
        | "text:bookmark"
        | "text:bookmark-start"
        | "text:bookmark-end"
        | "text:reference-mark"
        | "text:reference-mark-start"
        | "text:reference-mark-end"
        | "office:annotation"
        | "office:annotation-end"
        | "text:alphabetical-index-mark"
        | "text:alphabetical-index-mark-start"
        | "text:alphabetical-index-mark-end"
        | "text:toc-mark"
        | "text:toc-mark-start"
        | "text:toc-mark-end"
        | "text:user-index-mark"
        | "text:user-index-mark-start"
        | "text:user-index-mark-end"
        | "text:change"
        | "text:change-start"
        | "text:change-end" => (AtomKind::Marker, String::new(), None),
        _ if name.starts_with("draw:") => (AtomKind::Shape, String::new(), size()),
        _ if name.starts_with("text:") => (AtomKind::Field, text(), None),
        _ => (AtomKind::Opaque, text(), None),
    }
}

fn text_of(tree: &Tree, id: NodeId) -> String {
    let mut out = String::new();
    let mut todo = vec![id];
    while let Some(next) = todo.pop() {
        match &tree.nodes[next].kind {
            Kind::Text(t) => out.push_str(t),
            Kind::Element(e) => todo.extend(e.children.iter().rev()),
        }
    }
    out
}

/// Il testo di un oggetto come etichetta: spazi compressi, al più 200
/// caratteri.
fn label(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    words.join(" ").chars().take(200).collect()
}

/// Una lunghezza ODF in punti.
pub(crate) fn points(value: &str) -> Option<f32> {
    let value = value.trim();
    let split = value
        .find(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(value.len());
    let (number, unit) = value.split_at(split);
    let n: f32 = number.trim().parse().ok()?;
    let factor = match unit {
        "pt" => 1.0,
        "cm" => 72.0 / 2.54,
        "mm" => 72.0 / 25.4,
        "in" | "inch" => 72.0,
        "pc" => 12.0,
        "px" => 0.75,
        _ => return None,
    };
    Some(n * factor).filter(|p| p.is_finite())
}
