//! Gli alberi del modello **come attraversano il confine**: arena piatta.
//!
//! WIT non ammette tipi ricorsivi, e [`Block`](crate::model::Block),
//! [`Inline`](crate::model::Inline) e [`UiNode`](crate::ui::UiNode) lo sono. La
//! decisione (vedi `docs/architecture/traits.md`, "Alberi ricorsivi al confine")
//! è che al confine viaggino come **arena**: una lista piatta di nodi più indici
//! `u32` al posto dei riferimenti diretti. I tipi nativi restano alberi veri —
//! il kernel e i provider nativi non pagano niente.
//!
//! Questo modulo è la conversione, e sta qui e non nel proxy WASM per una
//! ragione precisa: **esiste prima del proxy**. Al freeze di M4 il contratto
//! dichiara una rappresentazione al confine, e una rappresentazione dichiarata
//! senza codice che la sappia produrre e riassorbire è una promessa non
//! verificata. Il proxy di M5 non la reimplementa: la chiama.
//!
//! Tre conversioni, tutte load-bearing:
//!
//! 1. **albero → arena** ([`DocumentTree::flatten`], [`UiTree::flatten`]):
//!    sempre possibile, nessun errore.
//! 2. **arena → albero** ([`DocumentTree::rebuild`], [`UiTree::rebuild`]): può
//!    fallire, perché un'arena è solo *una lista con dei numeri dentro* e chi
//!    la manda potrebbe essere un plugin sbagliato o ostile. Indici fuori
//!    range e cicli sono [`ArenaError`], non panic.
//! 3. **`usize` ↔ `u64`** per gli span ([`Span`]): il modello nativo indicizza
//!    `&str` in memoria (`usize`), il confine ha una larghezza fissa (`u64`).
//!    Verso il confine è sempre lecito; al ritorno è una conversione
//!    controllata — su wasm32 `usize` è a 32 bit.
//!
//! I nomi dei tipi qui rispecchiano quelli del WIT (`block`, `inline`,
//! `ui-node`, `document-tree`, `ui-tree`, `span`): sono omonimi di quelli di
//! [`crate::model`] e [`crate::ui`] perché *sono* la stessa cosa vista dal
//! confine, e il test di conformità li confronta uno a uno con il contratto.

use serde::{Deserialize, Serialize};

use crate::model;
use crate::ui;

/// Gli indici delle arene sono **newtype e non alias** di `u32`: un indice di
/// blocco e uno di inline puntano a due arene diverse, e scambiarli è un bug che
/// il compilatore può intercettare invece di lasciarlo diventare un nodo
/// sbagliato. (Ed è anche ciò che permette al test di conformità di verificare
/// che nel WIT quegli alias siano `u32` e non, per esempio, `u64`.)
macro_rules! arena_ref {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(
            Copy, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub u32);

        impl $name {
            /// L'indice come posizione in una `Vec`.
            fn at(self) -> usize {
                self.0 as usize
            }
        }
    };
}

arena_ref! {
    /// Indice in [`DocumentTree::blocks`]. Fuori range = arena malformata.
    BlockRef
}
arena_ref! {
    /// Indice in [`DocumentTree::inlines`]. Fuori range = arena malformata.
    InlineRef
}
arena_ref! {
    /// Indice in [`UiTree::nodes`]. Fuori range = arena malformata.
    UiRef
}

/// Ciò che può andare storto **riassorbendo** un'arena che arriva dal confine.
///
/// Non esiste il caso contrario: un albero vero si appiattisce sempre. Questi
/// errori descrivono un'arena che *non è un albero*, ed è la ragione per cui
/// `rebuild` restituisce un `Result` invece di fidarsi.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ArenaError {
    #[error("{arena}: indice {index} fuori range (l'arena ha {len} nodi)")]
    OutOfRange { arena: String, index: u32, len: u32 },
    /// Un nodo che si raggiunge da sé: l'arena è un grafo, non un albero, e
    /// ricostruirla alla lettera non terminerebbe.
    #[error("{arena}: l'indice {index} si raggiunge da sé, l'arena non è un albero")]
    Cycle { arena: String, index: u32 },
    /// Uno span più grande di quanto la piattaforma possa indicizzare (wasm32).
    #[error("span: {value} non entra in un usize su questa piattaforma")]
    SpanTooWide { value: u64 },
}

fn out_of_range(arena: &str, index: u32, len: usize) -> ArenaError {
    ArenaError::OutOfRange {
        arena: arena.to_string(),
        index,
        len: u32::try_from(len).unwrap_or(u32::MAX),
    }
}

fn cycle(arena: &str, index: u32) -> ArenaError {
    ArenaError::Cycle {
        arena: arena.to_string(),
        index,
    }
}

/// L'indice del prossimo nodo di un'arena.
///
/// Il `expect` non è pigrizia: gli indici sono `u32` *nel contratto*, quindi
/// un'arena con più di 4 miliardi di nodi non sarebbe esprimibile — e nemmeno
/// costruibile, visto che ogni nodo occupa decine di byte.
fn next_index(len: usize) -> u32 {
    u32::try_from(len).expect("un'arena con più di 2^32 nodi non è esprimibile nel contratto")
}

// ---------------------------------------------------------------------------
// Span: la larghezza fissa del confine
// ---------------------------------------------------------------------------

/// Un intervallo `[start, end)` in byte, **alla larghezza del confine**.
///
/// Lato nativo è [`model::Span`], con campi `usize`: indicizza `&str` in
/// memoria, e scrivere `as usize` a ogni slice per compiacere il confine sarebbe
/// la coda che muove il cane. La divergenza è deliberata, e da qui in poi è
/// anche *presidiata*: le due direzioni sono [`From`] e [`TryFrom`], con dei
/// test sopra.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub start: u64,
    pub end: u64,
}

impl From<model::Span> for Span {
    /// `usize` → `u64`: sempre lecita, su ogni piattaforma.
    fn from(s: model::Span) -> Self {
        Span {
            start: s.start as u64,
            end: s.end as u64,
        }
    }
}

impl TryFrom<Span> for model::Span {
    type Error = ArenaError;

    /// `u64` → `usize`: controllata. Su 64 bit non fallisce mai; su wasm32
    /// fallirebbe per un documento più grande di 4 GiB, che non entrerebbe
    /// comunque nella memoria di un modulo.
    fn try_from(s: Span) -> Result<Self, Self::Error> {
        let fit = |v: u64| usize::try_from(v).map_err(|_| ArenaError::SpanTooWide { value: v });
        Ok(model::Span {
            start: fit(s.start)?,
            end: fit(s.end)?,
        })
    }
}

// ---------------------------------------------------------------------------
// I nodi piatti
// ---------------------------------------------------------------------------

/// [`model::Inline`] con i figli sostituiti da indici.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
// Tag adiacente: alcune varianti portano uno scalare, e col tag interno
// `serde_json` fallirebbe a serializzarle (vedi il § in testa al modulo).
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Inline {
    Text(String),
    Emph(Vec<InlineRef>),
    Strong(Vec<InlineRef>),
    Code(String),
    Link {
        target: model::LinkTarget,
        label: Option<Vec<InlineRef>>,
        embed: bool,
        span: Span,
    },
    TagRef {
        name: String,
        span: Span,
    },
    Custom {
        custom_kind: String,
        attrs: serde_json::Value,
        span: Span,
    },
}

/// [`model::ListItem`] con i blocchi sostituiti da indici.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ListItem {
    pub blocks: Vec<BlockRef>,
    pub task: Option<TaskMarker>,
    pub span: Span,
}

/// [`model::TableCell`] con gli inline sostituiti da indici.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TableCell {
    pub inlines: Vec<InlineRef>,
    pub span: Span,
}

/// [`model::TableRow`] al confine.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
}

/// [`model::TaskMarker`] alla larghezza del confine (lo span cambia tipo).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskMarker {
    pub symbol: Option<char>,
    pub span: Span,
}

impl From<model::TaskMarker> for TaskMarker {
    fn from(m: model::TaskMarker) -> Self {
        TaskMarker {
            symbol: m.symbol,
            span: m.span.into(),
        }
    }
}

impl TryFrom<TaskMarker> for model::TaskMarker {
    type Error = ArenaError;

    fn try_from(m: TaskMarker) -> Result<Self, Self::Error> {
        Ok(model::TaskMarker {
            symbol: m.symbol,
            span: m.span.try_into()?,
        })
    }
}

/// [`model::Block`] con i figli sostituiti da indici.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Block {
    Heading {
        level: u8,
        inlines: Vec<InlineRef>,
        anchor: Option<String>,
        span: Span,
    },
    Paragraph {
        inlines: Vec<InlineRef>,
        anchor: Option<String>,
        span: Span,
    },
    List {
        ordered: bool,
        items: Vec<ListItem>,
        anchor: Option<String>,
        span: Span,
    },
    CodeBlock {
        lang: Option<String>,
        code: String,
        anchor: Option<String>,
        span: Span,
    },
    Quote {
        blocks: Vec<BlockRef>,
        anchor: Option<String>,
        span: Span,
    },
    ThematicBreak {
        anchor: Option<String>,
        span: Span,
    },
    Custom {
        custom_kind: String,
        attrs: serde_json::Value,
        blocks: Vec<BlockRef>,
        anchor: Option<String>,
        span: Span,
    },
    Table {
        head: Option<TableRow>,
        rows: Vec<TableRow>,
        align: Vec<model::ColumnAlign>,
        anchor: Option<String>,
        span: Span,
    },
}

/// [`ui::UiNode`] con i figli sostituiti da indici.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "node", rename_all = "snake_case")]
pub enum UiNode {
    Stack {
        dir: ui::Axis,
        gap: u8,
        children: Vec<UiRef>,
    },
    Text {
        content: String,
    },
    Heading {
        level: u8,
        content: String,
    },
    List {
        items: Vec<UiRef>,
    },
    ListItem {
        title: String,
        subtitle: Option<String>,
        action: Option<ui::ActionId>,
    },
    Button {
        label: String,
        intent: ui::Intent,
        action: ui::ActionId,
    },
    Html {
        html: String,
    },
    WebView {
        url: String,
        height: u32,
    },
}

// ---------------------------------------------------------------------------
// Il corpo di un documento
// ---------------------------------------------------------------------------

/// Il corpo di un documento al confine: due arene (blocchi e inline) più le
/// radici in ordine di lettura. Lato nativo è `Vec<model::Block>`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DocumentTree {
    pub blocks: Vec<Block>,
    pub inlines: Vec<Inline>,
    pub roots: Vec<BlockRef>,
}

impl DocumentTree {
    /// Albero → arena. Post-order: quando un nodo entra, i suoi figli ci sono già.
    pub fn flatten(body: &[model::Block]) -> Self {
        let mut tree = DocumentTree::default();
        let roots = body.iter().map(|b| tree_push_block(&mut tree, b)).collect();
        tree.roots = roots;
        tree
    }

    /// Arena → albero. Fallisce su indici fuori range e su cicli, che sono i
    /// due modi in cui un'arena può non essere un albero.
    pub fn rebuild(&self) -> Result<Vec<model::Block>, ArenaError> {
        self.roots
            .iter()
            .map(|r| self.block(*r, &mut Vec::new()))
            .collect()
    }

    fn block(&self, at: BlockRef, path: &mut Vec<BlockRef>) -> Result<model::Block, ArenaError> {
        let node = self
            .blocks
            .get(at.at())
            .ok_or_else(|| out_of_range("blocks", at.0, self.blocks.len()))?;
        if path.contains(&at) {
            return Err(cycle("blocks", at.0));
        }
        path.push(at);
        let block = match node {
            Block::Heading {
                level,
                inlines,
                anchor,
                span,
            } => model::Block::Heading {
                level: *level,
                inlines: self.inlines(inlines, &mut Vec::new())?,
                anchor: anchor.clone(),
                span: (*span).try_into()?,
            },
            Block::Paragraph {
                inlines,
                anchor,
                span,
            } => model::Block::Paragraph {
                inlines: self.inlines(inlines, &mut Vec::new())?,
                anchor: anchor.clone(),
                span: (*span).try_into()?,
            },
            Block::List {
                ordered,
                items,
                anchor,
                span,
            } => model::Block::List {
                ordered: *ordered,
                items: items
                    .iter()
                    .map(|item| {
                        Ok(model::ListItem {
                            blocks: self.blocks(&item.blocks, path)?,
                            task: item.task.map(model::TaskMarker::try_from).transpose()?,
                            span: item.span.try_into()?,
                        })
                    })
                    .collect::<Result<_, ArenaError>>()?,
                anchor: anchor.clone(),
                span: (*span).try_into()?,
            },
            Block::CodeBlock {
                lang,
                code,
                anchor,
                span,
            } => model::Block::CodeBlock {
                lang: lang.clone(),
                code: code.clone(),
                anchor: anchor.clone(),
                span: (*span).try_into()?,
            },
            Block::Quote {
                blocks,
                anchor,
                span,
            } => model::Block::Quote {
                blocks: self.blocks(blocks, path)?,
                anchor: anchor.clone(),
                span: (*span).try_into()?,
            },
            Block::ThematicBreak { anchor, span } => model::Block::ThematicBreak {
                anchor: anchor.clone(),
                span: (*span).try_into()?,
            },
            Block::Custom {
                custom_kind,
                attrs,
                blocks,
                anchor,
                span,
            } => model::Block::Custom {
                custom_kind: custom_kind.clone(),
                attrs: attrs.clone(),
                blocks: self.blocks(blocks, path)?,
                anchor: anchor.clone(),
                span: (*span).try_into()?,
            },
            Block::Table {
                head,
                rows,
                align,
                anchor,
                span,
            } => model::Block::Table {
                head: head.as_ref().map(|r| self.row(r)).transpose()?,
                rows: rows
                    .iter()
                    .map(|r| self.row(r))
                    .collect::<Result<_, ArenaError>>()?,
                align: align.clone(),
                anchor: anchor.clone(),
                span: (*span).try_into()?,
            },
        };
        path.pop();
        Ok(block)
    }

    /// Una riga di tabella: le celle portano inline, che hanno un'arena loro e
    /// quindi non possono partecipare a un ciclo fra blocchi (il `path` degli
    /// inline riparte vuoto a ogni cella, come per gli altri contenitori).
    fn row(&self, row: &TableRow) -> Result<model::TableRow, ArenaError> {
        Ok(model::TableRow {
            cells: row
                .cells
                .iter()
                .map(|c| {
                    Ok(model::TableCell {
                        inlines: self.inlines(&c.inlines, &mut Vec::new())?,
                        span: c.span.try_into()?,
                    })
                })
                .collect::<Result<_, ArenaError>>()?,
        })
    }

    fn blocks(
        &self,
        refs: &[BlockRef],
        path: &mut Vec<BlockRef>,
    ) -> Result<Vec<model::Block>, ArenaError> {
        refs.iter().map(|r| self.block(*r, path)).collect()
    }

    fn inline(
        &self,
        at: InlineRef,
        path: &mut Vec<InlineRef>,
    ) -> Result<model::Inline, ArenaError> {
        let node = self
            .inlines
            .get(at.at())
            .ok_or_else(|| out_of_range("inlines", at.0, self.inlines.len()))?;
        if path.contains(&at) {
            return Err(cycle("inlines", at.0));
        }
        path.push(at);
        let inline = match node {
            Inline::Text(s) => model::Inline::Text(s.clone()),
            Inline::Emph(v) => model::Inline::Emph(self.inlines(v, path)?),
            Inline::Strong(v) => model::Inline::Strong(self.inlines(v, path)?),
            Inline::Code(s) => model::Inline::Code(s.clone()),
            Inline::Link {
                target,
                label,
                embed,
                span,
            } => model::Inline::Link {
                target: target.clone(),
                label: label.as_ref().map(|v| self.inlines(v, path)).transpose()?,
                embed: *embed,
                span: (*span).try_into()?,
            },
            Inline::TagRef { name, span } => model::Inline::TagRef {
                name: name.clone(),
                span: (*span).try_into()?,
            },
            Inline::Custom {
                custom_kind,
                attrs,
                span,
            } => model::Inline::Custom {
                custom_kind: custom_kind.clone(),
                attrs: attrs.clone(),
                span: (*span).try_into()?,
            },
        };
        path.pop();
        Ok(inline)
    }

    fn inlines(
        &self,
        refs: &[InlineRef],
        path: &mut Vec<InlineRef>,
    ) -> Result<Vec<model::Inline>, ArenaError> {
        refs.iter().map(|r| self.inline(*r, path)).collect()
    }
}

/// Appiattisce un blocco nativo dentro l'arena e restituisce il suo indice.
///
/// Funzione libera e non metodo perché prende `&mut DocumentTree` mentre
/// ricorre: come metodo il borrow checker vedrebbe un `&mut self` annidato.
fn tree_push_block(tree: &mut DocumentTree, b: &model::Block) -> BlockRef {
    let node = match b {
        model::Block::Heading {
            level,
            inlines,
            anchor,
            span,
        } => Block::Heading {
            level: *level,
            inlines: tree_push_inlines(tree, inlines),
            anchor: anchor.clone(),
            span: (*span).into(),
        },
        model::Block::Paragraph {
            inlines,
            anchor,
            span,
        } => Block::Paragraph {
            inlines: tree_push_inlines(tree, inlines),
            anchor: anchor.clone(),
            span: (*span).into(),
        },
        model::Block::List {
            ordered,
            items,
            anchor,
            span,
        } => Block::List {
            ordered: *ordered,
            items: items
                .iter()
                .map(|item| ListItem {
                    blocks: tree_push_blocks(tree, &item.blocks),
                    task: item.task.map(TaskMarker::from),
                    span: item.span.into(),
                })
                .collect(),
            anchor: anchor.clone(),
            span: (*span).into(),
        },
        model::Block::CodeBlock {
            lang,
            code,
            anchor,
            span,
        } => Block::CodeBlock {
            lang: lang.clone(),
            code: code.clone(),
            anchor: anchor.clone(),
            span: (*span).into(),
        },
        model::Block::Quote {
            blocks,
            anchor,
            span,
        } => Block::Quote {
            blocks: tree_push_blocks(tree, blocks),
            anchor: anchor.clone(),
            span: (*span).into(),
        },
        model::Block::ThematicBreak { anchor, span } => Block::ThematicBreak {
            anchor: anchor.clone(),
            span: (*span).into(),
        },
        model::Block::Custom {
            custom_kind,
            attrs,
            blocks,
            anchor,
            span,
        } => Block::Custom {
            custom_kind: custom_kind.clone(),
            attrs: attrs.clone(),
            blocks: tree_push_blocks(tree, blocks),
            anchor: anchor.clone(),
            span: (*span).into(),
        },
        model::Block::Table {
            head,
            rows,
            align,
            anchor,
            span,
        } => Block::Table {
            head: head.as_ref().map(|r| tree_push_row(tree, r)),
            rows: rows.iter().map(|r| tree_push_row(tree, r)).collect(),
            align: align.clone(),
            anchor: anchor.clone(),
            span: (*span).into(),
        },
    };
    let at = BlockRef(next_index(tree.blocks.len()));
    tree.blocks.push(node);
    at
}

fn tree_push_blocks(tree: &mut DocumentTree, blocks: &[model::Block]) -> Vec<BlockRef> {
    blocks.iter().map(|b| tree_push_block(tree, b)).collect()
}

fn tree_push_row(tree: &mut DocumentTree, row: &model::TableRow) -> TableRow {
    TableRow {
        cells: row
            .cells
            .iter()
            .map(|c| TableCell {
                inlines: tree_push_inlines(tree, &c.inlines),
                span: c.span.into(),
            })
            .collect(),
    }
}

fn tree_push_inline(tree: &mut DocumentTree, i: &model::Inline) -> InlineRef {
    let node = match i {
        model::Inline::Text(s) => Inline::Text(s.clone()),
        model::Inline::Emph(v) => Inline::Emph(tree_push_inlines(tree, v)),
        model::Inline::Strong(v) => Inline::Strong(tree_push_inlines(tree, v)),
        model::Inline::Code(s) => Inline::Code(s.clone()),
        model::Inline::Link {
            target,
            label,
            embed,
            span,
        } => Inline::Link {
            target: target.clone(),
            label: label.as_ref().map(|v| tree_push_inlines(tree, v)),
            embed: *embed,
            span: (*span).into(),
        },
        model::Inline::TagRef { name, span } => Inline::TagRef {
            name: name.clone(),
            span: (*span).into(),
        },
        model::Inline::Custom {
            custom_kind,
            attrs,
            span,
        } => Inline::Custom {
            custom_kind: custom_kind.clone(),
            attrs: attrs.clone(),
            span: (*span).into(),
        },
    };
    let at = InlineRef(next_index(tree.inlines.len()));
    tree.inlines.push(node);
    at
}

fn tree_push_inlines(tree: &mut DocumentTree, inlines: &[model::Inline]) -> Vec<InlineRef> {
    inlines.iter().map(|i| tree_push_inline(tree, i)).collect()
}

// ---------------------------------------------------------------------------
// L'albero di UI
// ---------------------------------------------------------------------------

/// Un albero di UI dichiarativa al confine: arena dei nodi + radice. Lato
/// nativo è un [`ui::UiNode`], che è già un albero intero.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UiTree {
    pub nodes: Vec<UiNode>,
    pub root: UiRef,
}

impl UiTree {
    pub fn flatten(root: &ui::UiNode) -> Self {
        let mut nodes = Vec::new();
        let root = ui_push(&mut nodes, root);
        UiTree { nodes, root }
    }

    pub fn rebuild(&self) -> Result<ui::UiNode, ArenaError> {
        self.node(self.root, &mut Vec::new())
    }

    fn node(&self, at: UiRef, path: &mut Vec<UiRef>) -> Result<ui::UiNode, ArenaError> {
        let node = self
            .nodes
            .get(at.at())
            .ok_or_else(|| out_of_range("nodes", at.0, self.nodes.len()))?;
        if path.contains(&at) {
            return Err(cycle("nodes", at.0));
        }
        path.push(at);
        let out = match node {
            UiNode::Stack { dir, gap, children } => ui::UiNode::Stack {
                dir: *dir,
                gap: *gap,
                children: self.children(children, path)?,
            },
            UiNode::Text { content } => ui::UiNode::Text {
                content: content.clone(),
            },
            UiNode::Heading { level, content } => ui::UiNode::Heading {
                level: *level,
                content: content.clone(),
            },
            UiNode::List { items } => ui::UiNode::List {
                items: self.children(items, path)?,
            },
            UiNode::ListItem {
                title,
                subtitle,
                action,
            } => ui::UiNode::ListItem {
                title: title.clone(),
                subtitle: subtitle.clone(),
                action: action.clone(),
            },
            UiNode::Button {
                label,
                intent,
                action,
            } => ui::UiNode::Button {
                label: label.clone(),
                intent: *intent,
                action: action.clone(),
            },
            UiNode::Html { html } => ui::UiNode::Html { html: html.clone() },
            UiNode::WebView { url, height } => ui::UiNode::WebView {
                url: url.clone(),
                height: *height,
            },
        };
        path.pop();
        Ok(out)
    }

    fn children(
        &self,
        refs: &[UiRef],
        path: &mut Vec<UiRef>,
    ) -> Result<Vec<ui::UiNode>, ArenaError> {
        refs.iter().map(|r| self.node(*r, path)).collect()
    }
}

fn ui_push(nodes: &mut Vec<UiNode>, n: &ui::UiNode) -> UiRef {
    let node = match n {
        ui::UiNode::Stack { dir, gap, children } => UiNode::Stack {
            dir: *dir,
            gap: *gap,
            children: children.iter().map(|c| ui_push(nodes, c)).collect(),
        },
        ui::UiNode::Text { content } => UiNode::Text {
            content: content.clone(),
        },
        ui::UiNode::Heading { level, content } => UiNode::Heading {
            level: *level,
            content: content.clone(),
        },
        ui::UiNode::List { items } => UiNode::List {
            items: items.iter().map(|c| ui_push(nodes, c)).collect(),
        },
        ui::UiNode::ListItem {
            title,
            subtitle,
            action,
        } => UiNode::ListItem {
            title: title.clone(),
            subtitle: subtitle.clone(),
            action: action.clone(),
        },
        ui::UiNode::Button {
            label,
            intent,
            action,
        } => UiNode::Button {
            label: label.clone(),
            intent: *intent,
            action: action.clone(),
        },
        ui::UiNode::Html { html } => UiNode::Html { html: html.clone() },
        ui::UiNode::WebView { url, height } => UiNode::WebView {
            url: url.clone(),
            height: *height,
        },
    };
    let at = UiRef(next_index(nodes.len()));
    nodes.push(node);
    at
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        Block as B, ColumnAlign, Inline as I, LinkTarget, ListItem as LI, Span as S, TableCell,
        TableRow as TR, TaskMarker,
    };
    use crate::ui::{ActionId, Axis, Intent, UiNode as U};

    /// Un corpo che tocca ogni variante e annida a più livelli: se il
    /// round-trip regge qui, regge.
    fn corpo() -> Vec<B> {
        vec![
            B::Heading {
                level: 2,
                inlines: vec![
                    I::Text("Titolo con ".into()),
                    I::Strong(vec![I::Emph(vec![I::Text("enfasi".into())])]),
                ],
                anchor: Some("titolo-con-enfasi".into()),
                span: S::new(0, 30),
            },
            B::Paragraph {
                inlines: vec![
                    I::Code("codice".into()),
                    I::Link {
                        target: LinkTarget::wiki("Altra"),
                        label: Some(vec![I::Text("etichetta".into())]),
                        embed: false,
                        span: S::new(31, 60),
                    },
                    I::Link {
                        target: LinkTarget::Url("https://esempio".into()),
                        label: None,
                        embed: false,
                        span: S::new(61, 80),
                    },
                    I::Link {
                        target: LinkTarget::Path("allegati/foto.png".into()),
                        label: None,
                        embed: true,
                        span: S::new(81, 90),
                    },
                    I::TagRef {
                        name: "tag/annidato".into(),
                        span: S::new(91, 94),
                    },
                    I::Custom {
                        custom_kind: "math-inline".into(),
                        attrs: serde_json::json!({"tex": "x^2"}),
                        span: S::new(95, 105),
                    },
                ],
                anchor: Some("blocco-1".into()),
                span: S::new(31, 105),
            },
            B::List {
                ordered: true,
                items: vec![
                    LI {
                        blocks: vec![B::Paragraph {
                            inlines: vec![I::Text("primo".into())],
                            anchor: None,
                            span: S::new(106, 113),
                        }],
                        task: Some(TaskMarker {
                            symbol: Some('x'),
                            span: S::new(108, 111),
                        }),
                        span: S::new(106, 113),
                    },
                    LI {
                        blocks: vec![
                            B::Paragraph {
                                inlines: vec![I::Text("secondo".into())],
                                anchor: None,
                                span: S::new(114, 123),
                            },
                            B::Quote {
                                blocks: vec![B::ThematicBreak {
                                    anchor: None,
                                    span: S::new(124, 127),
                                }],
                                anchor: None,
                                span: S::new(124, 128),
                            },
                        ],
                        task: Some(TaskMarker {
                            symbol: None,
                            span: S::new(116, 119),
                        }),
                        span: S::new(114, 128),
                    },
                    LI {
                        blocks: vec![B::Paragraph {
                            inlines: vec![I::Text("non è una task".into())],
                            anchor: None,
                            span: S::new(129, 145),
                        }],
                        task: None,
                        span: S::new(129, 145),
                    },
                ],
                anchor: None,
                span: S::new(106, 145),
            },
            B::CodeBlock {
                lang: Some("rust".into()),
                code: "fn main() {}".into(),
                anchor: None,
                span: S::new(146, 160),
            },
            B::Table {
                head: Some(TR {
                    cells: vec![
                        TableCell {
                            inlines: vec![I::Text("a".into())],
                            span: S::new(161, 164),
                        },
                        TableCell {
                            inlines: vec![I::Strong(vec![I::Text("b".into())])],
                            span: S::new(165, 170),
                        },
                    ],
                }),
                rows: vec![TR {
                    cells: vec![TableCell {
                        inlines: vec![I::Link {
                            target: LinkTarget::wiki("Nota"),
                            label: None,
                            embed: false,
                            span: S::new(171, 179),
                        }],
                        span: S::new(171, 180),
                    }],
                }],
                align: vec![ColumnAlign::Left, ColumnAlign::None],
                anchor: Some("tabella".into()),
                span: S::new(161, 181),
            },
            B::Custom {
                custom_kind: "callout".into(),
                attrs: serde_json::json!({"tipo": "nota"}),
                blocks: vec![B::Paragraph {
                    inlines: vec![I::Text("dentro il callout".into())],
                    anchor: None,
                    span: S::new(190, 200),
                }],
                anchor: None,
                span: S::new(182, 201),
            },
        ]
    }

    fn albero_ui() -> U {
        U::Stack {
            dir: Axis::Column,
            gap: 6,
            children: vec![
                U::Heading {
                    level: 3,
                    content: "3 backlink".into(),
                },
                U::List {
                    items: vec![
                        U::ListItem {
                            title: "Nota".into(),
                            subtitle: Some("contesto".into()),
                            action: Some(ActionId("open:a.md".into())),
                        },
                        U::ListItem {
                            title: "Senza azione".into(),
                            subtitle: None,
                            action: None,
                        },
                    ],
                },
                U::Button {
                    label: "Fai".into(),
                    intent: Intent::Danger,
                    action: ActionId("fai".into()),
                },
                U::Html {
                    html: "<b>fidato</b>".into(),
                },
                U::WebView {
                    url: "https://esempio".into(),
                    height: 200,
                },
                U::Text {
                    content: "coda".into(),
                },
            ],
        }
    }

    #[test]
    fn document_tree_round_trip_is_the_identity() {
        let body = corpo();
        let tree = DocumentTree::flatten(&body);
        assert_eq!(tree.rebuild().expect("arena valida"), body);
    }

    #[test]
    fn ui_tree_round_trip_is_the_identity() {
        let root = albero_ui();
        let tree = UiTree::flatten(&root);
        assert_eq!(tree.rebuild().expect("arena valida"), root);
    }

    #[test]
    fn an_empty_body_is_an_empty_arena() {
        let tree = DocumentTree::flatten(&[]);
        assert!(tree.blocks.is_empty() && tree.inlines.is_empty() && tree.roots.is_empty());
        assert_eq!(tree.rebuild().unwrap(), Vec::<B>::new());
    }

    #[test]
    fn every_child_is_interned_before_its_parent() {
        // Post-order: un nodo non può riferire un indice più grande del proprio,
        // ed è ciò che rende impossibile costruire un ciclo appiattendo.
        let tree = DocumentTree::flatten(&corpo());
        for (i, block) in tree.blocks.iter().enumerate() {
            let figli: Vec<BlockRef> = match block {
                Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => blocks.clone(),
                Block::List { items, .. } => items
                    .iter()
                    .flat_map(|it| it.blocks.iter())
                    .copied()
                    .collect(),
                _ => Vec::new(),
            };
            for f in figli {
                assert!(
                    f.at() < i,
                    "il blocco {i} riferisce {f:?}, che non è ancora stato interned"
                );
            }
        }
    }

    #[test]
    fn an_index_out_of_range_is_an_error_not_a_panic() {
        let mut tree = DocumentTree::flatten(&corpo());
        tree.roots.push(BlockRef(9_999));
        assert!(matches!(
            tree.rebuild(),
            Err(ArenaError::OutOfRange { index: 9_999, .. })
        ));

        // Anche dentro un nodo, non solo fra le radici.
        let mut tree = DocumentTree::flatten(&corpo());
        tree.blocks.push(Block::Quote {
            blocks: vec![BlockRef(7_777)],
            anchor: None,
            span: Span::default(),
        });
        let at = BlockRef(next_index(tree.blocks.len()) - 1);
        tree.roots = vec![at];
        assert!(matches!(
            tree.rebuild(),
            Err(ArenaError::OutOfRange { index: 7_777, .. })
        ));

        // E negli inline, che hanno un'arena loro.
        let mut tree = DocumentTree::flatten(&corpo());
        tree.blocks.push(Block::Paragraph {
            inlines: vec![InlineRef(4_242)],
            anchor: None,
            span: Span::default(),
        });
        tree.roots = vec![BlockRef(next_index(tree.blocks.len()) - 1)];
        assert!(matches!(
            tree.rebuild(),
            Err(ArenaError::OutOfRange { index: 4_242, .. })
        ));

        let tree = UiTree {
            nodes: Vec::new(),
            root: UiRef(0),
        };
        assert!(matches!(
            tree.rebuild(),
            Err(ArenaError::OutOfRange {
                index: 0,
                len: 0,
                ..
            })
        ));
    }

    #[test]
    fn a_cycle_is_an_error_not_a_hang() {
        // Un blocco che contiene se stesso: appiattendo non può nascere, ma
        // arriva da fuori — ed è la ragione per cui `rebuild` non si fida.
        let tree = DocumentTree {
            blocks: vec![Block::Quote {
                blocks: vec![BlockRef(0)],
                anchor: None,
                span: Span::default(),
            }],
            inlines: Vec::new(),
            roots: vec![BlockRef(0)],
        };
        assert!(matches!(
            tree.rebuild(),
            Err(ArenaError::Cycle { index: 0, .. })
        ));

        // Anche attraverso una voce di lista, che dalla decisione 0003 è un record e non
        // più una `Vec` nuda: il `path` deve attraversarla.
        let tree = DocumentTree {
            blocks: vec![Block::List {
                ordered: false,
                items: vec![ListItem {
                    blocks: vec![BlockRef(0)],
                    task: None,
                    span: Span::default(),
                }],
                anchor: None,
                span: Span::default(),
            }],
            inlines: Vec::new(),
            roots: vec![BlockRef(0)],
        };
        assert!(matches!(
            tree.rebuild(),
            Err(ArenaError::Cycle { index: 0, .. })
        ));

        let tree = DocumentTree {
            blocks: vec![Block::Paragraph {
                inlines: vec![InlineRef(0)],
                anchor: None,
                span: Span::default(),
            }],
            inlines: vec![Inline::Emph(vec![InlineRef(0)])],
            roots: vec![BlockRef(0)],
        };
        assert!(matches!(
            tree.rebuild(),
            Err(ArenaError::Cycle { index: 0, .. })
        ));

        let tree = UiTree {
            nodes: vec![UiNode::Stack {
                dir: Axis::Row,
                gap: 0,
                children: vec![UiRef(0)],
            }],
            root: UiRef(0),
        };
        assert!(matches!(
            tree.rebuild(),
            Err(ArenaError::Cycle { index: 0, .. })
        ));
    }

    #[test]
    fn the_same_subtree_twice_is_not_a_cycle() {
        // Due riferimenti allo stesso nodo (un DAG) non sono un ciclo: si
        // ricostruisce due volte. Il rilevamento guarda il *percorso*, non
        // l'insieme dei visitati — confonderli rifiuterebbe arene legittime.
        let tree = DocumentTree {
            blocks: vec![
                Block::ThematicBreak {
                    anchor: None,
                    span: Span::default(),
                },
                Block::Quote {
                    blocks: vec![BlockRef(0), BlockRef(0)],
                    anchor: None,
                    span: Span::default(),
                },
            ],
            inlines: Vec::new(),
            roots: vec![BlockRef(1)],
        };
        let rebuilt = tree.rebuild().expect("un DAG è ricostruibile");
        assert_eq!(
            rebuilt,
            vec![B::Quote {
                blocks: vec![
                    B::ThematicBreak {
                        anchor: None,
                        span: S::EMPTY
                    },
                    B::ThematicBreak {
                        anchor: None,
                        span: S::EMPTY
                    }
                ],
                anchor: None,
                span: S::EMPTY,
            }]
        );
    }

    #[test]
    fn span_crosses_and_comes_back_unchanged() {
        for native in [S::EMPTY, S::new(0, 1), S::new(1_234, 5_678)] {
            let wide: Span = native.into();
            assert_eq!(wide.start as usize, native.start);
            assert_eq!(model::Span::try_from(wide).unwrap(), native);
        }
        // E il limite della piattaforma: su 64 bit ci sta tutto, su wasm32 no.
        let enorme = Span {
            start: 0,
            end: u64::MAX,
        };
        match model::Span::try_from(enorme) {
            Ok(s) => assert_eq!(s.end, usize::MAX, "su 64 bit u64::MAX entra in usize"),
            Err(e) => assert_eq!(e, ArenaError::SpanTooWide { value: u64::MAX }),
        }
    }

    #[test]
    fn spans_survive_the_whole_round_trip() {
        // Non basta che gli span convertano: devono restare attaccati al nodo
        // giusto dopo l'appiattimento, che riordina tutto.
        let body = corpo();
        let tree = DocumentTree::flatten(&body);
        let rebuilt = tree.rebuild().unwrap();
        let spans = |bs: &[B]| -> Vec<(usize, usize)> {
            bs.iter().map(|b| (b.span().start, b.span().end)).collect()
        };
        assert_eq!(spans(&body), spans(&rebuilt));
    }

    /// Le forme nuove della decisione 0003 attraversano e tornano: lo stato di una task, il
    /// suo marcatore, l'ancora di un blocco, le celle di una tabella.
    #[test]
    fn tasks_anchors_and_tables_survive_the_boundary() {
        let tree = DocumentTree::flatten(&corpo());
        let rebuilt = tree.rebuild().unwrap();

        let B::List { items, .. } = &rebuilt[2] else {
            panic!("la terza radice è una lista");
        };
        assert_eq!(
            items
                .iter()
                .map(|i| i.task.map(|t| t.checked()))
                .collect::<Vec<_>>(),
            vec![Some(true), Some(false), None]
        );
        assert_eq!(items[1].task.unwrap().span, S::new(116, 119));

        assert_eq!(rebuilt[0].anchor(), Some("titolo-con-enfasi"));
        assert_eq!(rebuilt[1].anchor(), Some("blocco-1"));
        assert_eq!(rebuilt[3].anchor(), None);

        let B::Table {
            head, rows, align, ..
        } = &rebuilt[4]
        else {
            panic!("la quinta radice è una tabella");
        };
        assert_eq!(head.as_ref().unwrap().cells.len(), 2);
        assert_eq!(align, &vec![ColumnAlign::Left, ColumnAlign::None]);
        assert_eq!(
            rows[0].cells[0].inlines,
            vec![I::Link {
                target: LinkTarget::wiki("Nota"),
                label: None,
                embed: false,
                span: S::new(171, 179),
            }]
        );
    }
}
