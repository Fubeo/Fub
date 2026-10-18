//! Il modello comune di un documento di videoscrittura: ciò che serve alla
//! ricerca, all'outline e all'anteprima, non al salvataggio.
//!
//! Gli `Span` sono vuoti: un file a byte non ha offset di testo da correggere,
//! e il provider non offre riscritture di link.

use std::sync::Arc;

use fub_abi::format::ParseContext;
use fub_abi::model::{
    Block, DocId, DocumentModel, Frontmatter, Heading, HeadingSlugs, Inline, Link, LinkTarget,
    ListItem, Span, TableCell, TableRow,
};
use wordcraft_doc::para::OBJ;
use wordcraft_doc::{Block as WcBlock, Document, InlineObject, Paragraph};

use crate::projection::{self, Mark, Role};

pub(crate) fn document_model(document: &Document, ctx: &ParseContext) -> DocumentModel {
    let mut walk = Walk {
        document,
        slugs: HeadingSlugs::new(),
        outline: Vec::new(),
        links: Vec::new(),
        text: Vec::new(),
    };
    let body = walk.blocks(&document.body);
    DocumentModel {
        id: DocId::new(ctx.doc_id.clone()),
        frontmatter: Frontmatter::default(),
        body,
        outline: walk.outline,
        links: walk.links,
        tags: Vec::new(),
        anchors: Vec::new(),
        text: walk.text.join("\n"),
        frontmatter_present: false,
    }
}

struct Walk<'a> {
    document: &'a Document,
    slugs: HeadingSlugs,
    outline: Vec<Heading>,
    links: Vec<Link>,
    text: Vec<String>,
}

impl Walk<'_> {
    fn blocks(&mut self, blocks: &[Arc<WcBlock>]) -> Vec<Block> {
        let mut out = Vec::new();
        // Le voci d'elenco consecutive diventano un elenco, annidato per livello.
        let mut list: Vec<(bool, u8, Vec<Inline>)> = Vec::new();
        for block in blocks {
            match &**block {
                WcBlock::Para(paragraph) => {
                    let inlines = self.inlines(paragraph);
                    match projection::role(self.document, &paragraph.props) {
                        Role::List { ordered, level } => {
                            list.push((ordered, level, inlines));
                            continue;
                        }
                        role => {
                            flush(&mut list, &mut out);
                            out.push(self.paragraph(role, inlines));
                        }
                    }
                }
                WcBlock::Table(table) => {
                    flush(&mut list, &mut out);
                    let rows = table
                        .rows
                        .iter()
                        .map(|row| TableRow {
                            cells: row
                                .cells
                                .iter()
                                .map(|cell| TableCell {
                                    inlines: self.cell(&cell.blocks),
                                    span: Span::EMPTY,
                                })
                                .collect(),
                        })
                        .collect();
                    out.push(Block::Table {
                        head: None,
                        rows,
                        align: Vec::new(),
                        anchor: None,
                        span: Span::EMPTY,
                    });
                }
            }
        }
        flush(&mut list, &mut out);
        out
    }

    /// Una cella del modello comune porta inline: i suoi paragrafi si
    /// uniscono con un a-capo, le tabelle annidate col loro testo.
    fn cell(&mut self, blocks: &[Arc<WcBlock>]) -> Vec<Inline> {
        let mut out = Vec::new();
        for block in blocks {
            let inlines = match &**block {
                WcBlock::Para(paragraph) => self.inlines(paragraph),
                WcBlock::Table(table) => {
                    let mut nested = Vec::new();
                    for cell in table.rows.iter().flat_map(|row| &row.cells) {
                        if !nested.is_empty() {
                            nested.push(Inline::Text(" ".into()));
                        }
                        nested.extend(self.cell(&cell.blocks));
                    }
                    nested
                }
            };
            if !out.is_empty() && !inlines.is_empty() {
                out.push(Inline::HardBreak);
            }
            out.extend(inlines);
        }
        out
    }

    fn paragraph(&mut self, role: Role, inlines: Vec<Inline>) -> Block {
        match role {
            Role::Heading { level } => {
                let text = plain(&inlines);
                let slug = self.slugs.next_slug(&text);
                let level = level.min(6);
                self.outline.push(Heading {
                    level,
                    text,
                    slug: slug.clone(),
                    span: Span::EMPTY,
                    explicit_anchor: None,
                });
                Block::Heading {
                    level,
                    inlines,
                    anchor: Some(slug),
                    span: Span::EMPTY,
                    explicit_anchor: None,
                }
            }
            Role::Quote => Block::Quote {
                blocks: vec![Block::Paragraph {
                    inlines,
                    anchor: None,
                    span: Span::EMPTY,
                }],
                anchor: None,
                span: Span::EMPTY,
            },
            _ => Block::Paragraph {
                inlines,
                anchor: None,
                span: Span::EMPTY,
            },
        }
    }

    fn inlines(&mut self, paragraph: &Paragraph) -> Vec<Inline> {
        let styles = &self.document.styles;
        let style = paragraph.props.style.as_deref();
        let mut out = Vec::new();
        let mut objects = paragraph.objects.iter();
        let mut text = String::new();
        for (range, props) in paragraph.run_ranges() {
            let marks = projection::marks(styles, style, props);
            let mut pieces: Vec<Inline> = Vec::new();
            let mut run = String::new();
            let flush_run = |run: &mut String, pieces: &mut Vec<Inline>| {
                if !run.is_empty() {
                    pieces.push(Inline::Text(std::mem::take(run)));
                }
            };
            for ch in paragraph.text[range].chars() {
                match ch {
                    OBJ => {
                        flush_run(&mut run, &mut pieces);
                        if let Some(shown) = objects.next().and_then(shown_text) {
                            pieces.push(Inline::Text(shown));
                        }
                    }
                    '\n' => {
                        flush_run(&mut run, &mut pieces);
                        pieces.push(Inline::HardBreak);
                    }
                    '\u{000C}' | '\u{000E}' => flush_run(&mut run, &mut pieces),
                    '\u{00AD}' => {}
                    ch => run.push(ch),
                }
            }
            flush_run(&mut run, &mut pieces);
            if pieces.is_empty() {
                continue;
            }
            for piece in &pieces {
                if let Inline::Text(t) = piece {
                    text.push_str(t);
                } else {
                    text.push(' ');
                }
            }
            let mut wrapped = pieces;
            for mark in marks.iter().rev() {
                wrapped = match mark {
                    Mark::B => vec![Inline::Strong(wrapped)],
                    Mark::I => vec![Inline::Emph(wrapped)],
                    Mark::S => vec![Inline::Strikethrough(wrapped)],
                    Mark::Sup => vec![Inline::Superscript(wrapped)],
                    _ => wrapped,
                };
            }
            if let Some(href) = props.link.as_deref().filter(|h| !h.starts_with('#')) {
                let target = LinkTarget::Url(href.to_string());
                self.links.push(Link {
                    target: target.clone(),
                    embed: false,
                    span: Span::EMPTY,
                    context: None,
                });
                wrapped = vec![Inline::Link {
                    target,
                    label: Some(wrapped),
                    embed: false,
                    span: Span::EMPTY,
                }];
            }
            out.extend(wrapped);
        }
        let text = text.trim();
        if !text.is_empty() {
            self.text.push(text.to_string());
        }
        out
    }
}

/// Ciò che un oggetto mostra come testo: il risultato di un campo, la base di
/// un rubi, un'equazione nella forma lineare.
fn shown_text(object: &InlineObject) -> Option<String> {
    let text = match object {
        InlineObject::Field { result, .. } => result.as_str(),
        InlineObject::Ruby { base, .. } => base.as_str(),
        InlineObject::Equation { linear, .. } => linear.as_str(),
        InlineObject::Opaque { text, .. } => text.as_str(),
        _ => return None,
    };
    (!text.is_empty()).then(|| text.to_string())
}

fn plain(inlines: &[Inline]) -> String {
    let mut out = String::new();
    fn walk(inlines: &[Inline], out: &mut String) {
        for inline in inlines {
            match inline {
                Inline::Text(t) | Inline::Code(t) => out.push_str(t),
                Inline::Strong(i)
                | Inline::Emph(i)
                | Inline::Strikethrough(i)
                | Inline::Superscript(i) => walk(i, out),
                Inline::Link { label: Some(i), .. } => walk(i, out),
                Inline::HardBreak | Inline::SoftBreak => out.push(' '),
                _ => {}
            }
        }
    }
    walk(inlines, &mut out);
    out.trim().to_string()
}

/// Chiude l'elenco in corso: le voci di livello più alto diventano un elenco
/// dentro l'ultima voce del livello sopra.
fn flush(list: &mut Vec<(bool, u8, Vec<Inline>)>, out: &mut Vec<Block>) {
    if list.is_empty() {
        return;
    }
    let items = std::mem::take(list);
    let base = items.iter().map(|(_, level, _)| *level).min().unwrap_or(0);
    out.extend(nest(&items, base));
}

fn nest(items: &[(bool, u8, Vec<Inline>)], level: u8) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut current: Option<(bool, Vec<ListItem>)> = None;
    let mut i = 0;
    while i < items.len() {
        let (ordered, item_level, inlines) = &items[i];
        if *item_level > level {
            // Le voci più profonde vanno nell'ultima voce di questo livello.
            let end = items[i..]
                .iter()
                .position(|(_, l, _)| *l <= level)
                .map_or(items.len(), |p| i + p);
            let nested = nest(&items[i..end], level + 1);
            match current.as_mut().and_then(|(_, items)| items.last_mut()) {
                Some(last) => last.blocks.extend(nested),
                None => blocks.extend(nested),
            }
            i = end;
            continue;
        }
        if current.as_ref().is_some_and(|(o, _)| o != ordered) {
            push_list(&mut blocks, current.take());
        }
        let item = ListItem {
            blocks: vec![Block::Paragraph {
                inlines: inlines.clone(),
                anchor: None,
                span: Span::EMPTY,
            }],
            task: None,
            span: Span::EMPTY,
        };
        current
            .get_or_insert_with(|| (*ordered, Vec::new()))
            .1
            .push(item);
        i += 1;
    }
    push_list(&mut blocks, current);
    blocks
}

fn push_list(blocks: &mut Vec<Block>, list: Option<(bool, Vec<ListItem>)>) {
    if let Some((ordered, items)) = list {
        blocks.push(Block::List {
            ordered,
            items,
            anchor: None,
            span: Span::EMPTY,
            start: None,
        });
    }
}
