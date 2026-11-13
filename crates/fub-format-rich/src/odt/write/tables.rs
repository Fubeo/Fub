//! Le tabelle: colonne e celle unite, le tabelle nuove con lo stile delle
//! loro celle, e l'XML degli oggetti nuovi.

use crate::odt::keys::{self, opening, CellKey, RowKey, TableKey};
use crate::odt::xml::{self, escape_text};
use crate::projection::{AtomKind, Cell, Inline, Row, Table};
use crate::RichError;
use crate::{blob, fresh};

use super::markup::{attr, set_attr, text};
use super::{bare_cell, Writer};

/// Le colonne che le righe di una tabella occupano, celle coperte comprese.
pub(super) fn width(table: &Table) -> Result<usize, RichError> {
    let covered = |xml: &str| xml.matches("<table:covered-table-cell").count();
    let mut width = 0;
    for row in &table.rows {
        let mut n = match &row.k {
            Some(k) => covered(&blob::decode::<RowKey>(k)?.lead),
            None => 0,
        };
        for cell in &row.cells {
            let span = cell.span.unwrap_or(1) as usize;
            n += match &cell.k {
                // Le celle coperte che seguono, tolte quelle di uno span che
                // la shell ha cambiato.
                Some(k) => {
                    let key = blob::decode::<CellKey>(k)?;
                    (1 + covered(&key.tail) + span).saturating_sub(spanned(&key.open))
                }
                None => span,
            };
        }
        width = width.max(n);
    }
    Ok(width)
}

/// Le colonne che una cella dice di coprire.
fn spanned(open: &str) -> usize {
    keys::tag(open)
        .and_then(|(_, attrs)| {
            attr(&attrs, "table:number-columns-spanned").and_then(|n| n.parse().ok())
        })
        .unwrap_or(1)
        .max(1)
}

/// Una cella a cui la shell ha cambiato le colonne coperte (unendo o
/// dividendo celle): lo span nel tag e le celle coperte che la seguono.
/// Con celle unite anche in altezza le celle coperte non sono soltanto sue,
/// e una coperta che ha un contenuto lo perderebbe: in quei casi no.
fn respan(mut key: CellKey, span: usize, movable: bool) -> Result<CellKey, RichError> {
    if span == spanned(&key.open) {
        return Ok(key);
    }
    if span == 0 || span > wordcraft_doc::table::MAX_COLS {
        return Err(RichError::Malformed(
            "a cell spanning no or too many columns".into(),
        ));
    }
    if !movable || key.tail.contains("</table:covered-table-cell>") {
        return Err(RichError::Codec(
            "odt: cells of a table with cells merged across rows cannot be merged or split".into(),
        ));
    }
    let Some((name, mut attrs)) = keys::tag(&key.open) else {
        return Err(RichError::Malformed("a table cell".into()));
    };
    let wanted = (span > 1).then(|| span.to_string());
    set_attr(&mut attrs, "table:number-columns-spanned", wanted);
    key.open = xml::open_tag(&name, &attrs, key.open.ends_with("/>"));
    let mut tail = key.tail.as_str();
    let mut kept = String::new();
    while let Some(at) = tail.find("<table:covered-table-cell") {
        let end = at + tail[at..].find('>').map_or(tail.len() - at, |e| e + 1);
        kept.push_str(&tail[..at]);
        tail = &tail[end..];
    }
    kept.push_str(tail);
    key.tail = "<table:covered-table-cell/>".repeat(span - 1) + &kept;
    Ok(key)
}

/// Le colonne di una tabella a cui la shell ne ha aggiunte (`delta` positivo)
/// o tolte. Colonne tutte uguali si riscrivono, quante servono; fra colonne
/// diverse non si sa quale sia cambiata, e il salvataggio lo rifiuta.
fn columns(head: &str, delta: isize) -> Result<String, RichError> {
    let mut had = 0;
    let mut same: Option<Option<Vec<(String, String)>>> = None;
    let mut rest = head.trim_start();
    while let Some(end) = rest.starts_with('<').then(|| rest.find('>')).flatten() {
        let tag = &rest[..=end];
        rest = rest[end + 1..].trim_start();
        let Some((name, mut attrs)) = keys::tag(tag) else {
            same = Some(None);
            continue;
        };
        if name != "table:table-column" {
            same = Some(None);
            continue;
        }
        had += attr(&attrs, "table:number-columns-repeated")
            .and_then(|n| n.parse::<usize>().ok())
            .unwrap_or(1);
        set_attr(&mut attrs, "table:number-columns-repeated", None);
        let plain = tag.ends_with("/>").then_some(attrs);
        same = match same {
            None => Some(plain),
            Some(seen) => Some(seen.filter(|seen| Some(seen) == plain.as_ref())),
        };
    }
    let width = had as isize + delta;
    match same {
        Some(Some(mut attrs)) if rest.is_empty() && width >= 1 => {
            if width > 1 {
                attrs.push(("table:number-columns-repeated".into(), width.to_string()));
            }
            Ok(xml::open_tag("table:table-column", &attrs, true))
        }
        _ => Err(RichError::Codec(
            "odt: columns of a table whose columns differ cannot be added or removed".into(),
        )),
    }
}

impl<'a> Writer<'a> {
    // ── Tabelle ─────────────────────────────────────────────────────────────

    pub(super) fn table(&mut self, table: &Table, out: &mut String) -> Result<Table, RichError> {
        let fresh = table.k.is_none();
        let key: TableKey = match &table.k {
            Some(k) => blob::decode(k)?,
            None => self.new_table(table),
        };
        if !key.rows {
            let base = self
                .tables
                .iter()
                .find(|(k, ..)| *k == table.k)
                .ok_or_else(|| RichError::Missing("a table".into()))?;
            let rows: Vec<&Option<String>> = table.rows.iter().map(|r| &r.k).collect();
            if rows.len() != base.1.len() || rows.iter().zip(&base.1).any(|(a, b)| *a != b) {
                return Err(RichError::Codec(
                    "odt: rows of a table with cells merged across rows cannot be added, \
                     moved or removed"
                        .into(),
                ));
            }
        }
        if table.rows.is_empty() || table.rows.iter().any(|row| row.cells.is_empty()) {
            return Err(RichError::Malformed("table without rows or cells".into()));
        }
        out.push_str(&self.fresh(&key.open, false));
        // Le colonne cambiano se la shell ne ha aggiunte o tolte rispetto alla
        // tabella di partenza, non se il file le dichiarava male.
        let had = self.tables.iter().find(|(k, ..)| *k == table.k);
        let delta = match had {
            Some((.., had)) if !fresh => width(table)? as isize - *had as isize,
            _ => 0,
        };
        match delta {
            0 => out.push_str(&key.head),
            delta => out.push_str(&columns(&key.head, delta)?),
        }
        let mut header = false;
        let mut headers_done = false;
        let mut rows = Vec::new();
        for row in &table.rows {
            let rk: RowKey = match &row.k {
                Some(k) => blob::decode(k)?,
                None => RowKey {
                    open: "<table:table-row>".into(),
                    header: false,
                    lead: String::new(),
                },
            };
            if rk.header != header {
                if rk.header {
                    if headers_done {
                        return Err(RichError::Codec(
                            "odt: header rows must stay together".into(),
                        ));
                    }
                    out.push_str("<table:table-header-rows>");
                } else {
                    out.push_str("</table:table-header-rows>");
                    headers_done = true;
                }
                header = rk.header;
            }
            out.push_str(&self.fresh(&rk.open, false));
            out.push_str(&rk.lead);
            let mut cells = Vec::new();
            for cell in &row.cells {
                let ck: CellKey = match &cell.k {
                    Some(k) => blob::decode(k)?,
                    None => CellKey {
                        open: match fresh {
                            true => format!(
                                "<table:table-cell table:style-name=\"{}\" \
                                 office:value-type=\"string\">",
                                self.grid_cell()
                            ),
                            false => "<table:table-cell office:value-type=\"string\">".into(),
                        },
                        tail: String::new(),
                    },
                };
                let ck = respan(ck, cell.span.unwrap_or(1) as usize, key.rows)?;
                let blocks = if bare_cell(&cell.blocks) {
                    if ck.open.ends_with("/>") {
                        out.push_str(&ck.open);
                    } else {
                        out.push_str(&ck.open);
                        out.push_str("</table:table-cell>");
                    }
                    Vec::new()
                } else {
                    out.push_str(&opening(&ck.open));
                    let blocks = self.cell(&cell.blocks, out)?;
                    out.push_str("</table:table-cell>");
                    blocks
                };
                out.push_str(&ck.tail);
                cells.push(Cell {
                    k: cell.k.clone(),
                    span: cell.span,
                    blocks,
                });
            }
            out.push_str("</table:table-row>");
            rows.push(Row {
                k: row.k.clone(),
                cells,
            });
        }
        if header {
            out.push_str("</table:table-header-rows>");
        }
        out.push_str("</table:table>");
        Ok(Table {
            locked: false,
            k: table.k.clone(),
            rows,
        })
    }

    /// Una tabella nuova: un nome che il documento non ha, una colonna per
    /// cella della riga più lunga, come la griglia di Word.
    fn new_table(&mut self, table: &Table) -> TableKey {
        let cols = table.rows.iter().map(|row| row.cells.len()).max();
        let repeated = match cols.unwrap_or(1) {
            0 | 1 => String::new(),
            n => format!(" table:number-columns-repeated=\"{n}\""),
        };
        let source = String::from_utf8_lossy(&self.base.content.source);
        let name = loop {
            self.named += 1;
            let name = format!("Tabella{}", self.named);
            if !source.contains(&format!("table:name=\"{name}\"")) {
                break name;
            }
        };
        TableKey {
            open: format!("<table:table table:name=\"{name}\">"),
            head: format!("<table:table-column{repeated}/>"),
            rows: true,
        }
    }

    /// L'XML di un oggetto nuovo: un'immagine in una cornice nel testo, con
    /// il file fra le immagini del pacchetto, o una nota con il suo testo.
    pub(super) fn new_atom(&mut self, atom: &Inline) -> Result<(AtomKind, String), RichError> {
        let source = String::from_utf8_lossy(&self.base.content.source).into_owned();
        match atom {
            // Un disegno nuovo: l'SVG di FubDraw e, per chi non legge l'SVG,
            // il PNG di ripiego nella stessa cornice. Riletto, è un'immagine.
            Inline::Atom {
                kind: AtomKind::Drawing,
                svg: Some(svg),
                data: Some(data),
                ink: None,
                float: None,
                note: None,
                end: false,
                toc: None,
                label,
                w,
                h,
                ..
            } => {
                let png = fresh::png(data)?;
                let (w, h) = fresh::size(*w, *h)?;
                if svg.len() > crate::projection::MAX_SHOWN_SVG_BYTES || !svg.contains("<svg") {
                    return Err(RichError::Malformed("a new drawing that is not SVG".into()));
                }
                let stem = format!("{:016x}", fub_abi::Fnv1a::hash(svg.as_bytes()));
                let (svg_path, png_path) = (
                    format!("Pictures/{stem}.svg"),
                    format!("Pictures/{stem}.png"),
                );
                let name = loop {
                    self.framed += 1;
                    let name = format!("Disegno{}", self.framed);
                    if !source.contains(&format!("draw:name=\"{name}\"")) {
                        break name;
                    }
                };
                let image = |path: &str| {
                    format!(
                        "<draw:image xlink:href=\"{path}\" xlink:type=\"simple\" \
                         xlink:show=\"embed\" xlink:actuate=\"onLoad\"/>"
                    )
                };
                let mut xml = format!(
                    "<draw:frame draw:name=\"{name}\" text:anchor-type=\"as-char\" \
                     svg:width=\"{w:.2}pt\" svg:height=\"{h:.2}pt\" draw:z-index=\"0\">{}{}",
                    image(&svg_path),
                    image(&png_path)
                );
                if !label.is_empty() {
                    xml.push_str("<svg:title>");
                    escape_text(label, &mut xml);
                    xml.push_str("</svg:title>");
                }
                xml.push_str("</draw:frame>");
                for (path, mime, bytes) in [
                    (svg_path, "image/svg+xml", svg.as_bytes().to_vec()),
                    (png_path, "image/png", png),
                ] {
                    if !self.pictures.iter().any(|(p, ..)| *p == path) {
                        self.pictures.push((path, mime, bytes));
                    }
                }
                Ok((AtomKind::Image, xml))
            }
            Inline::Atom {
                kind: AtomKind::Ink,
                ..
            } => Err(RichError::Malformed(
                "ink in an OpenDocument file is written as a drawing".into(),
            )),
            Inline::Atom {
                kind: AtomKind::Image,
                data: Some(data),
                note: None,
                end: false,
                toc: None,
                float: None,
                label,
                w,
                h,
                ..
            } => {
                let image = fresh::image(data, *w, *h)?;
                let path = format!("Pictures/{}", image.name());
                let name = loop {
                    self.framed += 1;
                    let name = format!("Immagine{}", self.framed);
                    if !source.contains(&format!("draw:name=\"{name}\"")) {
                        break name;
                    }
                };
                let mut xml = format!(
                    "<draw:frame draw:name=\"{name}\" text:anchor-type=\"as-char\" \
                     svg:width=\"{:.2}pt\" svg:height=\"{:.2}pt\" draw:z-index=\"0\">\
                     <draw:image xlink:href=\"{path}\" xlink:type=\"simple\" \
                     xlink:show=\"embed\" xlink:actuate=\"onLoad\"/>",
                    image.w, image.h
                );
                if !label.is_empty() {
                    xml.push_str("<svg:title>");
                    escape_text(label, &mut xml);
                    xml.push_str("</svg:title>");
                }
                xml.push_str("</draw:frame>");
                if !self.pictures.iter().any(|(p, ..)| *p == path) {
                    self.pictures.push((path, image.mime, image.bytes));
                }
                Ok((AtomKind::Image, xml))
            }
            Inline::Atom {
                kind: AtomKind::Note,
                data: None,
                note: Some(text),
                end,
                toc: None,
                ..
            } => {
                let text = fresh::note(text)?;
                let (class, prefix, style) = if *end {
                    ("endnote", "edn", "Endnote")
                } else {
                    ("footnote", "ftn", "Footnote")
                };
                let id = loop {
                    self.noted += 1;
                    let id = format!("{prefix}{}", self.noted);
                    if !source.contains(&format!("text:id=\"{id}\"")) {
                        break id;
                    }
                };
                // Il numero lo ricalcola chi apre il file: qui basta che ci sia.
                let cited = &mut self.cited[usize::from(*end)];
                *cited += 1;
                let citation = source
                    .matches(&format!("text:note-class=\"{class}\""))
                    .count()
                    + *cited;
                let style = if self.styles.common("paragraph", style) {
                    format!(" text:style-name=\"{style}\"")
                } else {
                    String::new()
                };
                let mut xml = format!(
                    "<text:note text:id=\"{id}\" text:note-class=\"{class}\">\
                     <text:note-citation>{citation}</text:note-citation>\
                     <text:note-body><text:p{style}>"
                );
                let mut space_ok = false;
                self::text(text, &mut space_ok, &mut xml)?;
                xml.push_str("</text:p></text:note-body></text:note>");
                Ok((AtomKind::Note, xml))
            }
            _ => Err(RichError::Malformed(
                "an object that is neither kept nor a new image or note".into(),
            )),
        }
    }

    /// Lo stile delle celle di una tabella nuova: il bordo sottile della
    /// griglia di Word.
    fn grid_cell(&mut self) -> String {
        if let Some(name) = &self.grid_cell {
            return name.clone();
        }
        let name = self.styles.fresh("FubC");
        self.auto_xml.push_str(&format!(
            "<style:style style:name=\"{name}\" style:family=\"table-cell\">\
             <style:table-cell-properties fo:padding=\"0.04in\" \
             fo:border=\"0.5pt solid #000000\"/></style:style>"
        ));
        self.grid_cell = Some(name.clone());
        name
    }
}
