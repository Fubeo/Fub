//! Il modello comune di una cartella: ciò che serve alla ricerca, all'outline e
//! all'anteprima.
//!
//! Ogni foglio visibile è un titolo e un'anteprima in tabella delle sue prime
//! righe e colonne; il testo per la ricerca è quello che le celle mostrano, con
//! un tetto. I valori sono quelli salvati nel file: l'indice non ricalcola.
//!
//! Gli `Span` sono vuoti: un file a byte non ha offset di testo da correggere,
//! e il provider non offre riscritture di link.

use fub_abi::format::ParseContext;
use fub_abi::model::{
    Block, DocId, DocumentModel, Frontmatter, Heading, HeadingSlugs, Inline, Span, TableCell,
    TableRow,
};
use gridcraft_core::{CellRef, Value};
use gridcraft_model::{Sheet, Visibility, Workbook};
use gridcraft_numfmt::{format_value, NumberFormat};

/// Le righe e le colonne dell'anteprima di un foglio.
const PREVIEW_ROWS: u32 = 50;
const PREVIEW_COLUMNS: u32 = 20;
/// Il testo più lungo che la cartella dà alla ricerca.
const MAX_TEXT_BYTES: usize = 1024 * 1024;

pub(crate) fn document_model(workbook: &Workbook, ctx: &ParseContext) -> DocumentModel {
    let mut slugs = HeadingSlugs::new();
    let mut outline = Vec::new();
    let mut body = Vec::new();
    let mut text = Text::default();
    for sheet in &workbook.sheets {
        if sheet.visibility != Visibility::Visible {
            continue;
        }
        let slug = slugs.next_slug(&sheet.name);
        outline.push(Heading {
            level: 1,
            text: sheet.name.clone(),
            slug: slug.clone(),
            span: Span::EMPTY,
            explicit_anchor: None,
        });
        body.push(Block::Heading {
            level: 1,
            inlines: vec![Inline::Text(sheet.name.clone())],
            anchor: Some(slug),
            span: Span::EMPTY,
            explicit_anchor: None,
        });
        text.push(&sheet.name);
        if let Some(table) = preview(workbook, sheet) {
            body.push(table);
        }
        for (at, _) in sheet.cells.iter() {
            if text.full() {
                break;
            }
            let shown = shown(workbook, sheet, at);
            if !shown.is_empty() {
                text.push(&shown);
            }
        }
    }
    DocumentModel {
        id: DocId::new(ctx.doc_id.clone()),
        frontmatter: Frontmatter::default(),
        body,
        outline,
        links: Vec::new(),
        tags: Vec::new(),
        anchors: Vec::new(),
        text: text.out,
        frontmatter_present: false,
    }
}

/// Le prime righe e colonne del foglio, fino all'ultima cella con un valore.
fn preview(workbook: &Workbook, sheet: &Sheet) -> Option<Block> {
    let used = sheet.cells.used_range()?;
    let last_row = used.end.row.min(PREVIEW_ROWS - 1);
    let last_column = used.end.col.min(PREVIEW_COLUMNS - 1);
    let rows: Vec<TableRow> = (0..=last_row)
        .map(|row| TableRow {
            cells: (0..=last_column)
                .map(|col| {
                    let shown = shown(workbook, sheet, CellRef::new(row, col));
                    TableCell {
                        inlines: if shown.is_empty() {
                            Vec::new()
                        } else {
                            vec![Inline::Text(shown)]
                        },
                        span: Span::EMPTY,
                    }
                })
                .collect(),
        })
        .collect();
    Some(Block::Table {
        head: None,
        rows,
        align: Vec::new(),
        anchor: None,
        span: Span::EMPTY,
    })
}

/// Il valore salvato di una cella come la cella lo mostra.
fn shown(workbook: &Workbook, sheet: &Sheet, at: CellRef) -> String {
    let value = sheet.value(at);
    if matches!(value, Value::Empty) {
        return String::new();
    }
    let style = workbook.styles.get(sheet.style_id(at));
    format_value(
        &value,
        &NumberFormat::parse_cached(style.num_fmt.as_str()),
        workbook.date_system,
    )
    .text
}

#[derive(Default)]
struct Text {
    out: String,
}

impl Text {
    fn full(&self) -> bool {
        self.out.len() >= MAX_TEXT_BYTES
    }

    fn push(&mut self, piece: &str) {
        if self.full() {
            return;
        }
        if !self.out.is_empty() {
            self.out.push('\n');
        }
        let room = MAX_TEXT_BYTES.saturating_sub(self.out.len());
        let mut end = piece.len().min(room);
        while !piece.is_char_boundary(end) {
            end -= 1;
        }
        self.out.push_str(&piece[..end]);
    }
}
