//! La forma di un foglio di lavoro come la legge l'innesto: dove cominciano e
//! finiscono `sheetData`, le righe e le celle, con le coordinate che dà loro il
//! lettore di GridCraft.
//!
//! Le coordinate seguono le regole del lettore: una riga senza `r` è quella
//! dopo la precedente, una cella senza `r` è quella dopo la precedente nella
//! riga. Ciò che il lettore scarta (una riga `r="0"`, una coordinata che non si
//! legge, oltre i limiti del modello) rende il foglio **disordinato**, e un
//! foglio disordinato non si innesta.
//!
//! Il resto è ciò che il modello non dice e i blocchi delle celle chiedono: le
//! origini delle formule condivise, le tabelle di dati e le celle con un valore
//! ricco.

use std::collections::{BTreeSet, HashMap};

use gridcraft_core::{CellRef, RangeRef, MAX_COLS, MAX_ROWS};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::package::{attr, local, prefix};

/// Un intervallo di byte del foglio.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Span {
    pub start: usize,
    /// La fine del tag d'apertura; per un elemento vuoto è `end`.
    pub tag_end: usize,
    pub end: usize,
}

impl Span {
    /// L'elemento si chiude da sé (`<x/>`).
    pub fn empty(&self) -> bool {
        self.tag_end == self.end
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RowSpan {
    pub span: Span,
    /// La riga, da 0.
    pub row: u32,
    /// Il file scrive `r`.
    pub explicit: bool,
    /// Lo stile della riga, quando la riga lo applica (`customFormat`).
    pub style: Option<u32>,
    /// `spans`, così come lo scrive il file.
    pub spans: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CellSpan {
    pub span: Span,
    pub pos: CellRef,
    pub explicit: bool,
    /// La cella ha una formula (`<f>`).
    pub formula: bool,
}

/// Lo stile di un gruppo di colonne (`<col>`), da 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ColStyle {
    pub min: u32,
    pub max: u32,
    pub style: u32,
}

/// Ciò che i blocchi delle celle chiedono al file.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct SheetFacts {
    /// Le celle d'origine delle formule condivise.
    pub shared_masters: Vec<CellRef>,
    /// Le aree delle tabelle di dati (`<f t="dataTable" ref>`).
    pub data_tables: Vec<RangeRef>,
    /// Le celle con un valore ricco (`vm`).
    pub rich: Vec<CellRef>,
    /// Righe in ordine crescente, celle in ordine crescente nella loro riga, e
    /// niente che il lettore scarti.
    pub ordered: bool,
}

pub(crate) struct SheetLayout {
    /// Il prefisso dello spazio dei nomi di `sheetData`, se ne ha uno.
    pub prefix: Option<Vec<u8>>,
    pub dimension: Option<(Span, String)>,
    pub cols: Vec<ColStyle>,
    pub sheet_data: Span,
    pub rows: Vec<RowSpan>,
    /// Le celle delle righe chieste, per indice in `rows`.
    pub cells: HashMap<usize, Vec<CellSpan>>,
    pub facts: SheetFacts,
}

impl SheetLayout {
    /// Lo stile che una cella nuova prende: quello della riga, altrimenti
    /// quello della colonna.
    pub fn inherited_style(&self, row: Option<&RowSpan>, col: u32) -> Option<u32> {
        row.and_then(|row| row.style).or_else(|| {
            self.cols
                .iter()
                .find(|cols| cols.min <= col && col <= cols.max)
                .map(|cols| cols.style)
                .filter(|&style| style != 0)
        })
    }
}

fn u32_attr(element: &BytesStart<'_>, name: &[u8]) -> Option<u32> {
    attr(element, name).and_then(|value| value.trim().parse().ok())
}

fn flag(element: &BytesStart<'_>, name: &[u8]) -> bool {
    attr(element, name).is_some_and(|value| matches!(value.trim(), "1" | "true"))
}

/// Legge la forma di un foglio. `wanted` sono le righe (da 0) di cui servono
/// le celle.
pub(crate) fn scan(bytes: &[u8], wanted: &BTreeSet<u32>) -> Result<SheetLayout, String> {
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        return Err("UTF-16 worksheet".into());
    }
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut depth = 0usize;
    let mut layout = SheetLayout {
        prefix: None,
        dimension: None,
        cols: Vec::new(),
        sheet_data: Span {
            start: 0,
            tag_end: 0,
            end: 0,
        },
        rows: Vec::new(),
        cells: HashMap::new(),
        facts: SheetFacts {
            ordered: true,
            ..SheetFacts::default()
        },
    };
    let mut seen_sheet_data = false;
    let mut in_sheet_data = false;
    let mut in_cols = false;
    // La riga e la cella aperte.
    let mut row: Option<RowSpan> = None;
    let mut row_cells: Option<Vec<CellSpan>> = None;
    let mut cell: Option<CellSpan> = None;
    let mut next_row = 0u32;
    let mut next_col = 0u32;
    let mut last_row: Option<u32> = None;
    let mut last_col: Option<u32> = None;
    loop {
        let start = reader.buffer_position() as usize;
        let event = reader.read_event().map_err(|error| error.to_string())?;
        let end = reader.buffer_position() as usize;
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                let empty = matches!(event, Event::Empty(_));
                let name = element.name();
                let name = local(name.as_ref());
                match (depth, name) {
                    // Soltanto la forma che i produttori scrivono, `<dimension ref/>`:
                    // un'altra resta com'è.
                    (1, b"dimension") if empty => {
                        if let Some(reference) = attr(element, b"ref") {
                            layout.dimension = Some((
                                Span {
                                    start,
                                    tag_end: end,
                                    end,
                                },
                                reference,
                            ));
                        }
                    }
                    (1, b"cols") => in_cols = !empty,
                    (2, b"col") if in_cols => {
                        if let (Some(min), Some(max)) =
                            (u32_attr(element, b"min"), u32_attr(element, b"max"))
                        {
                            if min >= 1 && max >= min {
                                layout.cols.push(ColStyle {
                                    min: min - 1,
                                    max: max - 1,
                                    style: u32_attr(element, b"style").unwrap_or(0),
                                });
                            }
                        }
                    }
                    (1, b"sheetData") => {
                        if seen_sheet_data {
                            return Err("two sheetData elements".into());
                        }
                        seen_sheet_data = true;
                        layout.prefix = prefix(element.name().as_ref()).map(<[u8]>::to_vec);
                        layout.sheet_data = Span {
                            start,
                            tag_end: end,
                            end,
                        };
                        in_sheet_data = !empty;
                    }
                    (2, b"row") if in_sheet_data => {
                        let index = match attr(element, b"r") {
                            Some(r) => match r.trim().parse::<u32>() {
                                Ok(r) if r >= 1 => Some((r - 1, true)),
                                Ok(_) => None,
                                Err(_) => Some((next_row, false)),
                            },
                            None => Some((next_row, false)),
                        };
                        let (r, explicit) = match index {
                            Some((r, explicit)) if r < MAX_ROWS => (r, explicit),
                            _ => {
                                layout.facts.ordered = false;
                                (u32::MAX, false)
                            }
                        };
                        if r != u32::MAX {
                            if last_row.is_some_and(|last| last >= r) {
                                layout.facts.ordered = false;
                            }
                            last_row = Some(r);
                            next_row = r + 1;
                        }
                        let style = flag(element, b"customFormat")
                            .then(|| u32_attr(element, b"s"))
                            .flatten();
                        let open = RowSpan {
                            span: Span {
                                start,
                                tag_end: end,
                                end,
                            },
                            row: r,
                            explicit,
                            style,
                            spans: attr(element, b"spans"),
                        };
                        next_col = 0;
                        last_col = None;
                        let collect = r != u32::MAX && wanted.contains(&r);
                        if empty {
                            if collect {
                                layout.cells.insert(layout.rows.len(), Vec::new());
                            }
                            layout.rows.push(open);
                        } else {
                            row = Some(open);
                            row_cells = collect.then(Vec::new);
                        }
                    }
                    (3, b"c") if row.is_some() => {
                        let current = row.as_ref().map(|row| row.row).unwrap_or(u32::MAX);
                        let (pos, explicit) = match attr(element, b"r") {
                            Some(r) => (CellRef::parse(r.trim()), true),
                            None => (Some(CellRef::new(current, next_col)), false),
                        };
                        let pos = match pos {
                            Some(pos)
                                if current != u32::MAX
                                    && pos.row < MAX_ROWS
                                    && pos.col < MAX_COLS =>
                            {
                                if pos.row != current
                                    || last_col.is_some_and(|last| last >= pos.col)
                                {
                                    layout.facts.ordered = false;
                                }
                                last_col = Some(pos.col);
                                next_col = pos.col + 1;
                                pos
                            }
                            _ => {
                                layout.facts.ordered = false;
                                CellRef::new(u32::MAX, u32::MAX)
                            }
                        };
                        if attr(element, b"vm").is_some_and(|vm| vm.trim() != "0") {
                            layout.facts.rich.push(pos);
                        }
                        let open = CellSpan {
                            span: Span {
                                start,
                                tag_end: end,
                                end,
                            },
                            pos,
                            explicit,
                            formula: false,
                        };
                        if empty {
                            if let Some(cells) = row_cells.as_mut() {
                                cells.push(open);
                            }
                        } else {
                            cell = Some(open);
                        }
                    }
                    (4, b"f") => {
                        if let Some(open) = cell.as_mut() {
                            open.formula = true;
                            let pos = open.pos;
                            match attr(element, b"t").as_deref().map(str::trim) {
                                Some("shared") if attr(element, b"ref").is_some() => {
                                    layout.facts.shared_masters.push(pos);
                                }
                                Some("dataTable") => {
                                    let area = attr(element, b"ref")
                                        .and_then(|r| RangeRef::parse(&r))
                                        .unwrap_or(RangeRef::cell(pos));
                                    layout.facts.data_tables.push(area);
                                }
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
                if !empty {
                    depth += 1;
                }
            }
            Event::End(ref element) => {
                depth = depth.saturating_sub(1);
                let name = element.name();
                match (depth, local(name.as_ref())) {
                    (1, b"cols") => in_cols = false,
                    (1, b"sheetData") => {
                        layout.sheet_data.end = end;
                        in_sheet_data = false;
                    }
                    (2, b"row") => {
                        if let Some(mut open) = row.take() {
                            open.span.end = end;
                            if let Some(cells) = row_cells.take() {
                                layout.cells.insert(layout.rows.len(), cells);
                            }
                            layout.rows.push(open);
                        }
                    }
                    (3, b"c") => {
                        if let Some(mut open) = cell.take() {
                            open.span.end = end;
                            if let Some(cells) = row_cells.as_mut() {
                                cells.push(open);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !seen_sheet_data {
        return Err("no sheetData".into());
    }
    Ok(layout)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(a1: &str) -> CellRef {
        CellRef::parse(a1).unwrap()
    }

    #[test]
    fn le_coordinate_implicite_seguono_il_lettore() {
        let xml = br#"<?xml version="1.0"?><worksheet xmlns="m"><dimension ref="A1:C3"/><cols><col min="2" max="3" style="4"/></cols><sheetData><row r="2" spans="1:3"><c r="A2"><v>1</v></c><c><v>2</v></c><c r="D2"><f t="shared" ref="D2:D4" si="0">A2</f></c></row><row s="7" customFormat="1"><c t="s"><v>0</v></c></row><row/></sheetData></worksheet>"#;
        let layout = scan(xml, &BTreeSet::from([1, 2])).unwrap();
        assert!(layout.facts.ordered);
        assert_eq!(
            layout.rows.iter().map(|row| row.row).collect::<Vec<_>>(),
            [1, 2, 3]
        );
        assert_eq!(layout.rows[1].style, Some(7));
        assert!(!layout.rows[1].explicit);
        assert_eq!(layout.rows[0].spans.as_deref(), Some("1:3"));
        assert!(layout.rows[2].span.empty());
        let cells = &layout.cells[&0];
        assert_eq!(
            cells.iter().map(|c| c.pos).collect::<Vec<_>>(),
            [cell("A2"), cell("B2"), cell("D2")]
        );
        assert!(cells[2].formula && !cells[0].formula);
        assert_eq!(
            &xml[cells[1].span.start..cells[1].span.end],
            b"<c><v>2</v></c>"
        );
        assert_eq!(layout.cells[&1][0].pos, cell("A3"));
        assert_eq!(layout.facts.shared_masters, [cell("D2")]);
        assert_eq!(layout.dimension.as_ref().unwrap().1, "A1:C3");
        assert_eq!(layout.inherited_style(None, 2), Some(4));
        assert_eq!(layout.inherited_style(None, 0), None);
        assert_eq!(
            &xml[layout.sheet_data.start..layout.sheet_data.tag_end],
            b"<sheetData>"
        );
        assert!(xml[..layout.sheet_data.end].ends_with(b"</sheetData>"));
    }

    #[test]
    fn un_foglio_disordinato_si_riconosce() {
        for xml in [
            &br#"<worksheet><sheetData><row r="3"/><row r="2"/></sheetData></worksheet>"#[..],
            br#"<worksheet><sheetData><row r="1"><c r="B1"/><c r="A1"/></row></sheetData></worksheet>"#,
            br#"<worksheet><sheetData><row r="1"><c r="A2"/></row></sheetData></worksheet>"#,
            br#"<worksheet><sheetData><row r="0"/></sheetData></worksheet>"#,
        ] {
            assert!(!scan(xml, &BTreeSet::new()).unwrap().facts.ordered);
        }
        let layout = scan(
            br#"<x:worksheet xmlns:x="m"><x:sheetData/></x:worksheet>"#,
            &BTreeSet::new(),
        )
        .unwrap();
        assert_eq!(layout.prefix.as_deref(), Some(&b"x"[..]));
        assert!(layout.sheet_data.empty());
    }
}
