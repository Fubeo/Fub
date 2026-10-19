//! Righe, blocchi e sezioni del corpo: l'unità dentro cui
//! [`QueryPredicate::Scoped`](fub_abi::query::QueryPredicate::Scoped) vuole
//! tutti i suoi termini.
//!
//! Il testo piatto del documento (`DocumentModel::text`) non le sa dire: un
//! a-capo morbido ci diventa uno spazio e due paragrafi sono due righe come due
//! righe dello stesso paragrafo. La forma qui si ricava dall'albero dei blocchi,
//! una volta all'indicizzazione, e si memorizza accanto al corpo (`layout`):
//! le sezioni separate da `GS`, i blocchi da `RS`, le righe da `\n`. I tre
//! separatori sono caratteri di controllo che un testo non porta: se ci sono,
//! si tolgono prima.
//!
//! Il confronto è quello di chi cerca, non quello di tantivy: parole intere
//! (l'ultima anche incompleta se si sta scrivendo), senza maiuscole se non
//! chieste. La tolleranza ai refusi non si onora e restringe, come promette il
//! contratto: i candidati li trova l'indice, qui si sceglie fra loro.

use fub_abi::model::{Block, DocumentModel, Inline, LinkTarget};
use fub_abi::query::{TextMode, TextQuery, TextScope};

const SECTION: char = '\u{1d}';
const BLOCK: char = '\u{1e}';

/// La forma memorizzata del corpo di `doc`.
pub(super) fn layout(doc: &DocumentModel) -> String {
    let mut out = Layout::default();
    out.blocks(&doc.body);
    out.text
}

#[derive(Default)]
struct Layout {
    text: String,
}

impl Layout {
    fn section(&mut self) {
        if !self.text.is_empty() {
            self.text.push(SECTION);
        }
    }

    fn begin(&mut self) {
        if !self.text.is_empty() && !self.text.ends_with(SECTION) {
            self.text.push(BLOCK);
        }
    }

    fn push(&mut self, s: &str) {
        self.text
            .extend(s.chars().filter(|&c| c != SECTION && c != BLOCK));
    }

    fn blocks(&mut self, blocks: &[Block]) {
        for block in blocks {
            match block {
                Block::Heading { inlines, .. } => {
                    self.section();
                    self.begin();
                    self.inlines(inlines);
                }
                Block::Paragraph { inlines, .. } => {
                    self.begin();
                    self.inlines(inlines);
                }
                // Una voce è il suo paragrafo: chi è annidato è un blocco suo.
                Block::List { items, .. } => {
                    for item in items {
                        self.blocks(&item.blocks);
                    }
                }
                Block::CodeBlock { code, .. } => {
                    self.begin();
                    let lines: Vec<&str> = code.lines().filter(|l| !l.trim().is_empty()).collect();
                    self.push(&lines.join("\n"));
                }
                Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => self.blocks(blocks),
                Block::Table { head, rows, .. } => {
                    self.begin();
                    for (at, row) in head.iter().chain(rows).enumerate() {
                        if at > 0 {
                            self.text.push('\n');
                        }
                        for (cell_at, cell) in row.cells.iter().enumerate() {
                            if cell_at > 0 {
                                self.text.push(' ');
                            }
                            self.inlines(&cell.inlines);
                        }
                    }
                }
                Block::ThematicBreak { .. } | Block::ReferenceDefinition { .. } => {}
            }
        }
    }

    fn inlines(&mut self, inlines: &[Inline]) {
        for inline in inlines {
            match inline {
                Inline::Text(s) | Inline::Code(s) => self.push(s),
                Inline::Emph(children)
                | Inline::Strong(children)
                | Inline::Superscript(children)
                | Inline::Strikethrough(children) => self.inlines(children),
                Inline::Link {
                    label: Some(label), ..
                } => self.inlines(label),
                Inline::Link {
                    label: None,
                    target,
                    ..
                } => match target {
                    LinkTarget::Wiki { page, .. } => self.push(page),
                    LinkTarget::Url(s) | LinkTarget::Path(s) => self.push(s),
                },
                Inline::TagRef { name, .. } => {
                    self.text.push('#');
                    self.push(name);
                }
                Inline::Custom { .. } => {}
                Inline::SoftBreak | Inline::HardBreak => self.text.push('\n'),
            }
        }
    }
}

/// Le unità di `layout` per `scope`.
fn units(layout: &str, scope: TextScope) -> Vec<&str> {
    let sections = layout.split(SECTION);
    match scope {
        TextScope::Section => sections.collect(),
        TextScope::Block => sections.flat_map(|s| s.split(BLOCK)).collect(),
        TextScope::Line => sections
            .flat_map(|s| s.split(BLOCK))
            .flat_map(|b| b.split('\n'))
            .collect(),
    }
}

/// Le parole cercate, pronte da confrontare con un'unità.
pub(super) struct Matcher {
    words: Vec<regex::Regex>,
}

impl Matcher {
    /// `None` se il testo non ha parole: come per la foglia di testo, una
    /// domanda vuota non seleziona niente.
    pub(super) fn new(text: &TextQuery) -> Option<Matcher> {
        let words: Vec<&str> = text
            .text
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect();
        if words.is_empty() {
            return None;
        }
        let flags = if text.case_sensitive { "" } else { "(?i)" };
        let tail = if text.partial_last_term { "" } else { r"\b" };
        let patterns: Vec<String> = match text.mode {
            TextMode::Phrase => {
                let body = words
                    .iter()
                    .map(|w| regex::escape(w))
                    .collect::<Vec<_>>()
                    .join(r"[^\p{L}\p{N}]+");
                vec![format!(r"{flags}\b{body}\b")]
            }
            TextMode::Terms => {
                let last = words.len() - 1;
                words
                    .iter()
                    .enumerate()
                    .map(|(at, w)| {
                        let end = if at == last { tail } else { r"\b" };
                        format!(r"{flags}\b{}{end}", regex::escape(w))
                    })
                    .collect()
            }
        };
        let words = patterns
            .iter()
            .map(|p| regex::Regex::new(p).expect("parole con escape: un'espressione valida"))
            .collect();
        Some(Matcher { words })
    }

    /// Una unità di `layout` le contiene tutte?
    pub(super) fn within(&self, layout: &str, scope: TextScope) -> bool {
        units(layout, scope)
            .into_iter()
            .any(|unit| self.words.iter().all(|w| w.is_match(unit)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::{DocId, ListItem, Span};

    fn para(parts: Vec<Inline>) -> Block {
        Block::Paragraph {
            inlines: parts,
            anchor: None,
            span: Span::new(0, 0),
        }
    }

    fn heading(text: &str) -> Block {
        Block::Heading {
            level: 2,
            inlines: vec![Inline::Text(text.into())],
            anchor: None,
            span: Span::new(0, 0),
            explicit_anchor: None,
        }
    }

    fn doc(body: Vec<Block>) -> DocumentModel {
        let mut doc = DocumentModel::empty(DocId::new("n.md"));
        doc.body = body;
        doc
    }

    fn t(s: &str) -> Inline {
        Inline::Text(s.into())
    }

    #[test]
    fn lines_blocks_and_sections_come_from_the_tree() {
        let d = doc(vec![
            para(vec![t("rosa rossa"), Inline::SoftBreak, t("spina")]),
            para(vec![t("gambo")]),
            heading("Giardino"),
            Block::List {
                ordered: false,
                items: vec![ListItem {
                    blocks: vec![para(vec![t("ape"), Inline::HardBreak, t("miele")])],
                    task: None,
                    span: Span::new(0, 0),
                }],
                anchor: None,
                span: Span::new(0, 0),
                start: None,
            },
        ]);
        let layout = layout(&d);
        let m = |q: &str| Matcher::new(&TextQuery::terms(q)).unwrap();
        // Lo stesso paragrafo, due righe.
        assert!(m("rosa rossa").within(&layout, TextScope::Line));
        assert!(!m("rosa spina").within(&layout, TextScope::Line));
        assert!(m("rosa spina").within(&layout, TextScope::Block));
        // Due paragrafi, la stessa sezione.
        assert!(!m("rosa gambo").within(&layout, TextScope::Block));
        assert!(m("rosa gambo").within(&layout, TextScope::Section));
        // Il titolo apre la sua sezione e ne fa parte.
        assert!(!m("gambo giardino").within(&layout, TextScope::Section));
        assert!(m("giardino miele").within(&layout, TextScope::Section));
        assert!(!m("ape miele").within(&layout, TextScope::Line));
    }

    #[test]
    fn words_are_whole_unless_still_being_typed() {
        let layout = layout(&doc(vec![para(vec![t("Architettura del Lago")])]));
        let q = TextQuery::terms("lago arch");
        assert!(!Matcher::new(&q).unwrap().within(&layout, TextScope::Line));
        assert!(Matcher::new(&q.while_typing())
            .unwrap()
            .within(&layout, TextScope::Line));
        let mut exact = TextQuery::terms("lago");
        exact.case_sensitive = true;
        assert!(!Matcher::new(&exact)
            .unwrap()
            .within(&layout, TextScope::Line));
        let phrase = TextQuery {
            mode: TextMode::Phrase,
            ..TextQuery::terms("del lago")
        };
        assert!(Matcher::new(&phrase)
            .unwrap()
            .within(&layout, TextScope::Line));
        assert!(Matcher::new(&TextQuery::terms(" , ")).is_none());
    }

    #[test]
    fn separators_written_in_the_text_do_not_cut_it() {
        let layout = layout(&doc(vec![para(vec![t("rosa\u{1e}spina")])]));
        assert!(Matcher::new(&TextQuery::terms("rosaspina"))
            .unwrap()
            .within(&layout, TextScope::Line));
    }
}
