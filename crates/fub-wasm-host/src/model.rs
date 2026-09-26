//! **L'albero più grande del contratto, tradotto.**
//!
//! `document-model` — blocchi, intestazioni, link, proprietà, frontmatter — è
//! la ragione per cui `read-model` rispondeva `unserved` al primo passo di M5:
//! non perché la capacità mancasse, ma perché tradurre l'albero è un lavoro
//! suo. Sta in un modulo separato da `translate.rs` per la stessa ragione per
//! cui il WIT lo dichiara in un'interfaccia sua: è grande, ed è l'unica parte
//! del contratto in cui una conversione ricorsiva può sbagliare in silenzio.
//!
//! # L'albero di qua, l'arena di là
//!
//! Lato Rust il corpo è un albero vero: `Vec<Block>`, e dentro un `Block::Quote`
//! altri `Vec<Block>`. Il WIT non ha tipi ricorsivi — un `record` non può
//! contenere sé stesso — e il contratto risolve la cosa come la risolvono i
//! compilatori: **un'arena piatta più degli indici**. `document-tree` porta
//! tutti i blocchi in una lista, tutti gli inline in un'altra, e le radici in
//! ordine di lettura; ogni figlio è un `u32` dentro quelle liste.
//!
//! La conseguenza pratica è che si deposita **in post-ordine**: un padre non si
//! può scrivere prima di conoscere gli indici dei figli, quindi i figli entrano
//! nell'arena per primi e il padre subito dopo. Chi legge di là ricostruisce
//! l'albero seguendo gli indici, e le radici gli dicono da dove.
//!
//! # Il verso
//!
//! Qui c'è solo `to_*` (dal Rust di `fub-abi` al WIT che il componente riceve),
//! ed è ciò che il contratto dice di questo albero **oggi**: `read-model` lo
//! passa a un guest, e nessuna interfaccia servita dall'host lo riceve indietro.
//! Il giorno che `format.parse` attraverserà — un componente che *è* un
//! `FormatProvider` e restituisce il modello che ha parsato — servirà il `from_*`,
//! e sarà un altro passo con le sue domande (gli indici fuori range, che di
//! qua sono impossibili per costruzione e di là sono dato di un estraneo).

use fub_abi::arena;
use fub_abi::format::ParseContext;
use fub_abi::model as rm;
use fub_abi::{FormatError, PluginError};

use crate::contract::fub::abi::model as wm;
use crate::translate as tr;
// Lo `span` a 64 bit del confine, dal `usize` di casa, è la stessa conversione
// per chiunque attraversi — un albero di documento, un `reveal`, un `text-edit`
// — e per questo sta in `translate`. Ne era nata una copia qui quando quella
// era privata al proprio modulo; non lo è più.
use crate::translate::to_span;

/// Quanti livelli di annidamento questa traduzione scende prima di rifiutarsi.
///
/// La conversione è ricorsiva perché l'albero lo è — una citazione dentro una
/// voce di lista dentro una citazione — e quanto un documento sia profondo non
/// lo decide l'host: lo decide chi scrive il file. Diecimila `>` in testa a una
/// riga sono venti kilobyte di file e diecimila `Block::Quote` annidati nel
/// modello; senza un tetto, tradurli è uno stack overflow del thread del job, e
/// uno stack overflow non è un errore che si legge — è il processo che muore,
/// cioè l'app dell'utente portata giù da un documento. Il §16.1 promette il
/// contrario, e questa costante è metà di quella promessa.
///
/// **Sessantaquattro** perché è oltre il doppio di ciò che una prosa umana
/// annida davvero (una lista a sei rientri è già illeggibile, una citazione a
/// dodici non esiste), e perché sessantaquattro frame di questa ricorsione —
/// poche decine di byte l'uno — restano in una manciata di kilobyte anche sullo
/// stack di un thread del pool. Un tetto più alto non renderebbe leggibile
/// nessun documento in più; uno più basso rifiuterebbe file che qualcuno ha
/// scritto sul serio.
///
/// Il presidio sta **qui** e non nel provider markdown perché il modello può
/// arrivare da chiunque implementi `FormatProvider`: chi traduce è l'ultimo a
/// poter dire di no prima che la ricorsione parta davvero.
pub(crate) const MAX_DEPTH: u32 = rm::MAX_DOCUMENT_DEPTH;

// ---------------------------------------------------------------------------
// Il documento intero
// ---------------------------------------------------------------------------

/// Il modello di documento, dal Rust del kernel al WIT che il componente riceve.
///
/// Fallisce solo per l'albero: le tabelle piatte (outline, link, tag, ancore) e
/// il frontmatter sono conversioni totali, l'unica domanda che può ricevere un
/// «no» è quanto è profondo il corpo.
pub(crate) fn to_document(m: rm::DocumentModel) -> Result<wm::DocumentModel, PluginError> {
    if exceeds_depth(&m.body) {
        discard_document_model(m);
        return Err(too_deep());
    }
    Ok(wm::DocumentModel {
        id: m.id.0.clone(),
        frontmatter: to_frontmatter(&m.frontmatter),
        body: to_tree(&m.body)?,
        outline: m.outline.iter().map(to_heading).collect(),
        links: m.links.iter().map(to_link).collect(),
        tags: m.tags.iter().map(to_tag).collect(),
        anchors: m.anchors.iter().map(to_anchor).collect(),
        text: m.text.clone(),
        frontmatter_present: m.frontmatter_present,
    })
}

/// Reconstituisce un modello consegnato da un guest, dopo averlo trattato come
/// input non fidato. `source` è la sorgente dalla quale il provider ha
/// calcolato gli span: non accettiamo coordinate in un altro spazio.
pub(crate) fn from_document(
    m: wm::DocumentModel,
    ctx: &ParseContext,
    source: &fub_abi::format::DocumentSource,
) -> Result<rm::DocumentModel, FormatError> {
    if m.id != ctx.doc_id {
        return Err(parse_error(format!(
            "document id {:?} does not match parse context {:?}",
            m.id, ctx.doc_id
        )));
    }
    let frontmatter: serde_json::Value = serde_json::from_str(&m.frontmatter)
        .map_err(|e| parse_error(format!("invalid frontmatter JSON: {e}")))?;
    let frontmatter = frontmatter
        .as_object()
        .cloned()
        .ok_or_else(|| parse_error("frontmatter JSON must be an object"))?;
    validate_metadata(&m, source)?;
    preflight(&m.body, source)?;
    let body = arena_tree(&m.body)?
        .rebuild()
        .map_err(|e| parse_error(e.to_string()))?;
    Ok(rm::DocumentModel {
        id: rm::DocId::new(m.id),
        frontmatter: rm::Frontmatter(frontmatter),
        body,
        outline: m
            .outline
            .into_iter()
            .map(from_heading)
            .collect::<Result<_, _>>()?,
        links: m
            .links
            .into_iter()
            .map(from_link)
            .collect::<Result<_, _>>()?,
        tags: m.tags.into_iter().map(from_tag).collect::<Result<_, _>>()?,
        anchors: m
            .anchors
            .into_iter()
            .map(from_anchor)
            .collect::<Result<_, _>>()?,
        text: m.text,
        frontmatter_present: m.frontmatter_present,
    })
}

fn parse_error(message: impl Into<String>) -> FormatError {
    FormatError::Parse(message.into())
}

fn span(s: wm::Span, source: &fub_abi::format::DocumentSource) -> Result<arena::Span, FormatError> {
    let bytes = source.bytes();
    if s.start > s.end || s.end > bytes.len() as u64 {
        return Err(parse_error(format!(
            "invalid span [{}, {})",
            s.start, s.end
        )));
    }
    if let Some(text) = source.text() {
        let (start, end) = (s.start as usize, s.end as usize);
        if !text.is_char_boundary(start) || !text.is_char_boundary(end) {
            return Err(parse_error(format!(
                "span [{}, {}) is not on UTF-8 boundaries",
                s.start, s.end
            )));
        }
    }
    Ok(arena::Span {
        start: s.start,
        end: s.end,
    })
}

fn validate_span(s: wm::Span, source: &fub_abi::format::DocumentSource) -> Result<(), FormatError> {
    span(s, source).map(|_| ())
}

fn validate_metadata(
    m: &wm::DocumentModel,
    source: &fub_abi::format::DocumentSource,
) -> Result<(), FormatError> {
    for h in &m.outline {
        validate_span(h.span, source)?;
    }
    for l in &m.links {
        validate_span(l.span, source)?;
    }
    for t in &m.tags {
        validate_span(t.span, source)?;
    }
    for a in &m.anchors {
        validate_span(a.span, source)?;
        validate_span(a.marker, source)?;
    }
    Ok(())
}

fn arena_tree(t: &wm::DocumentTree) -> Result<arena::DocumentTree, FormatError> {
    Ok(arena::DocumentTree {
        blocks: t.blocks.iter().map(from_block).collect::<Result<_, _>>()?,
        inlines: t
            .inlines
            .iter()
            .map(from_inline)
            .collect::<Result<_, _>>()?,
        roots: t.roots.iter().copied().map(arena::BlockRef).collect(),
    })
}

fn from_span(s: wm::Span) -> Result<rm::Span, FormatError> {
    arena::Span {
        start: s.start,
        end: s.end,
    }
    .try_into()
    .map_err(|e: arena::ArenaError| parse_error(e.to_string()))
}
pub(crate) fn from_target(t: wm::LinkTarget) -> rm::LinkTarget {
    match t {
        wm::LinkTarget::Wiki(v) => rm::LinkTarget::Wiki {
            page: v.page,
            heading: v.heading,
            block: v.block,
        },
        wm::LinkTarget::Url(v) => rm::LinkTarget::Url(v),
        wm::LinkTarget::Path(v) => rm::LinkTarget::Path(v),
    }
}
fn from_heading(h: wm::Heading) -> Result<rm::Heading, FormatError> {
    Ok(rm::Heading {
        level: h.level,
        text: h.text,
        slug: h.slug,
        span: from_span(h.span)?,
        explicit_anchor: h.explicit_anchor,
    })
}
fn from_link(l: wm::Link) -> Result<rm::Link, FormatError> {
    Ok(rm::Link {
        target: from_target(l.target),
        embed: l.embed,
        span: from_span(l.span)?,
        context: l.context,
    })
}
fn from_tag(t: wm::Tag) -> Result<rm::Tag, FormatError> {
    Ok(rm::Tag {
        name: t.name,
        span: from_span(t.span)?,
    })
}
fn from_anchor(a: wm::Anchor) -> Result<rm::Anchor, FormatError> {
    Ok(rm::Anchor {
        id: a.id,
        span: from_span(a.span)?,
        marker: from_span(a.marker)?,
    })
}

fn from_inline(i: &wm::Inline) -> Result<arena::Inline, FormatError> {
    Ok(match i {
        wm::Inline::Text(v) => arena::Inline::Text(v.clone()),
        wm::Inline::Emph(v) => {
            arena::Inline::Emph(v.iter().copied().map(arena::InlineRef).collect())
        }
        wm::Inline::Strong(v) => {
            arena::Inline::Strong(v.iter().copied().map(arena::InlineRef).collect())
        }
        wm::Inline::Code(v) => arena::Inline::Code(v.clone()),
        wm::Inline::Link(v) => arena::Inline::Link {
            target: from_target(v.target.clone()),
            label: v
                .label
                .as_ref()
                .map(|x| x.iter().copied().map(arena::InlineRef).collect()),
            embed: v.embed,
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Inline::TagRef(v) => arena::Inline::TagRef {
            name: v.name.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Inline::Custom(v) => arena::Inline::Custom {
            custom_kind: v.custom_kind.clone(),
            attrs: serde_json::from_str(&v.attrs)
                .map_err(|e| parse_error(format!("invalid custom attrs JSON: {e}")))?,
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Inline::Superscript(v) => {
            arena::Inline::Superscript(v.iter().copied().map(arena::InlineRef).collect())
        }
        wm::Inline::Strikethrough(v) => {
            arena::Inline::Strikethrough(v.iter().copied().map(arena::InlineRef).collect())
        }
        wm::Inline::HardBreak => arena::Inline::HardBreak,
        wm::Inline::SoftBreak => arena::Inline::SoftBreak,
    })
}

fn from_row(r: &wm::TableRow) -> Result<arena::TableRow, FormatError> {
    Ok(arena::TableRow {
        cells: r
            .cells
            .iter()
            .map(|c| {
                Ok(arena::TableCell {
                    inlines: c.inlines.iter().copied().map(arena::InlineRef).collect(),
                    span: arena::Span {
                        start: c.span.start,
                        end: c.span.end,
                    },
                })
            })
            .collect::<Result<_, FormatError>>()?,
    })
}
fn from_block(b: &wm::Block) -> Result<arena::Block, FormatError> {
    Ok(match b {
        wm::Block::Heading(v) => arena::Block::Heading {
            level: v.level,
            inlines: v.inlines.iter().copied().map(arena::InlineRef).collect(),
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
            explicit_anchor: v.explicit_anchor.clone(),
        },
        wm::Block::Paragraph(v) => arena::Block::Paragraph {
            inlines: v.inlines.iter().copied().map(arena::InlineRef).collect(),
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Block::List(v) => arena::Block::List {
            ordered: v.ordered,
            items: v
                .items
                .iter()
                .map(|x| arena::ListItem {
                    blocks: x.blocks.iter().copied().map(arena::BlockRef).collect(),
                    task: x.task.as_ref().map(|t| arena::TaskMarker {
                        symbol: t.symbol,
                        span: arena::Span {
                            start: t.span.start,
                            end: t.span.end,
                        },
                    }),
                    span: arena::Span {
                        start: x.span.start,
                        end: x.span.end,
                    },
                })
                .collect(),
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
            start: v.start,
        },
        wm::Block::CodeBlock(v) => arena::Block::CodeBlock {
            lang: v.lang.clone(),
            code: v.code.clone(),
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Block::Quote(v) => arena::Block::Quote {
            blocks: v.blocks.iter().copied().map(arena::BlockRef).collect(),
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Block::ThematicBreak(v) => arena::Block::ThematicBreak {
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Block::Custom(v) => arena::Block::Custom {
            custom_kind: v.custom_kind.clone(),
            attrs: serde_json::from_str(&v.attrs)
                .map_err(|e| parse_error(format!("invalid custom attrs JSON: {e}")))?,
            blocks: v.blocks.iter().copied().map(arena::BlockRef).collect(),
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Block::Table(v) => arena::Block::Table {
            head: v.head.as_ref().map(from_row).transpose()?,
            rows: v.rows.iter().map(from_row).collect::<Result<_, _>>()?,
            align: v
                .align
                .iter()
                .map(|a| match a {
                    wm::ColumnAlign::None => rm::ColumnAlign::None,
                    wm::ColumnAlign::Left => rm::ColumnAlign::Left,
                    wm::ColumnAlign::Center => rm::ColumnAlign::Center,
                    wm::ColumnAlign::Right => rm::ColumnAlign::Right,
                })
                .collect(),
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
        wm::Block::ReferenceDefinition(v) => arena::Block::ReferenceDefinition {
            label: v.label.clone(),
            url: v.url.clone(),
            title: v.title.clone(),
            anchor: v.anchor.clone(),
            span: arena::Span {
                start: v.span.start,
                end: v.span.end,
            },
        },
    })
}

#[derive(Copy, Clone)]
enum GuestNode {
    Block(usize),
    Inline(usize),
}

/// Host-side upper bound for the amount of guest-owned materialisation.
///
/// Costs are memoized per arena node, while root occurrences and repeated
/// edges are charged separately.  Thus ordinary DAG reuse remains valid, but
/// a compact graph whose rebuild would amplify exponentially is rejected before
/// `DocumentTree::rebuild`.
const MAX_MATERIALIZATION_UNITS: u64 = 8 * 1024 * 1024;

fn preflight(
    t: &wm::DocumentTree,
    source: &fub_abi::format::DocumentSource,
) -> Result<(), FormatError> {
    let block_count = t.blocks.len();
    let inline_count = t.inlines.len();
    let total = block_count
        .checked_add(inline_count)
        .ok_or_else(|| parse_error("document tree is too large"))?;
    let mut colour = vec![0u8; total];
    let mut height = vec![0u32; total];
    let mut cost = vec![0u64; total];
    let mut roots = Vec::with_capacity(t.roots.len());
    let mut root_seen = vec![false; block_count];

    for root in &t.roots {
        let at = usize::try_from(*root)
            .map_err(|_| parse_error("root reference does not fit host usize"))?;
        if at >= block_count {
            return Err(parse_error(format!("dangling block reference {root}")));
        }
        root_seen[at] = true;
        roots.push(at);
    }
    let _ = root_seen;

    let mut work = Vec::new();
    for start in 0..total {
        let node = if start < block_count {
            GuestNode::Block(start)
        } else {
            GuestNode::Inline(start - block_count)
        };
        if colour[start] != 0 {
            continue;
        }
        work.push((node, false));
        while let Some((node, leaving)) = work.pop() {
            let at = match node {
                GuestNode::Block(i) => i,
                GuestNode::Inline(i) => block_count + i,
            };
            if leaving {
                let mut children = Vec::new();
                let local = match node {
                    GuestNode::Block(i) => {
                        block_children(&t.blocks[i], source, block_count, &mut children)?;
                        block_cost(&t.blocks[i])
                    }
                    GuestNode::Inline(i) => {
                        inline_children(&t.inlines[i], source, block_count, &mut children)?;
                        inline_cost(&t.inlines[i])
                    }
                };
                let mut h = 1u32;
                let mut c = local;
                for child in children {
                    h = h.max(height[child].saturating_add(1));
                    c = c.saturating_add(cost[child]);
                }
                if h > MAX_DEPTH {
                    return Err(parse_error(format!(
                        "document tree exceeds {MAX_DEPTH} levels of nesting"
                    )));
                }
                height[at] = h;
                cost[at] = c;
                colour[at] = 2;
                continue;
            }
            if colour[at] == 1 {
                return Err(parse_error("document tree contains a cycle"));
            }
            if colour[at] == 2 {
                continue;
            }
            colour[at] = 1;
            work.push((node, true));
            let mut children = Vec::new();
            match node {
                GuestNode::Block(i) => {
                    block_children(&t.blocks[i], source, block_count, &mut children)?
                }
                GuestNode::Inline(i) => {
                    inline_children(&t.inlines[i], source, block_count, &mut children)?
                }
            }
            for child in children.into_iter().rev() {
                if child >= total {
                    return Err(parse_error("document tree contains a dangling reference"));
                }
                if colour[child] == 1 {
                    return Err(parse_error("document tree contains a cycle"));
                }
                if colour[child] == 0 {
                    work.push((
                        if child < block_count {
                            GuestNode::Block(child)
                        } else {
                            GuestNode::Inline(child - block_count)
                        },
                        false,
                    ));
                }
            }
        }
    }

    let mut materialized = 0u64;
    for root in roots {
        materialized = materialized.saturating_add(cost[root]);
        if materialized > MAX_MATERIALIZATION_UNITS {
            return Err(parse_error(format!(
                "document tree materialization exceeds host budget \
                 ({MAX_MATERIALIZATION_UNITS} units)"
            )));
        }
    }
    Ok(())
}

fn block_children(
    b: &wm::Block,
    source: &fub_abi::format::DocumentSource,
    blocks: usize,
    out: &mut Vec<usize>,
) -> Result<(), FormatError> {
    let mut refs = |r: &u32| {
        out.push(usize::try_from(*r).unwrap_or(usize::MAX));
    };
    match b {
        wm::Block::Heading(v) => {
            validate_span(v.span, source)?;
            v.inlines.iter().for_each(|r| {
                out.push(blocks.saturating_add(usize::try_from(*r).unwrap_or(usize::MAX)))
            });
        }
        wm::Block::Paragraph(v) => {
            validate_span(v.span, source)?;
            v.inlines.iter().for_each(|r| {
                out.push(blocks.saturating_add(usize::try_from(*r).unwrap_or(usize::MAX)))
            });
        }
        wm::Block::List(v) => {
            validate_span(v.span, source)?;
            for item in &v.items {
                validate_span(item.span, source)?;
                if let Some(task) = item.task {
                    validate_span(task.span, source)?;
                }
                item.blocks.iter().for_each(&mut refs);
            }
        }
        wm::Block::CodeBlock(v) => validate_span(v.span, source)?,
        wm::Block::Quote(v) => {
            validate_span(v.span, source)?;
            v.blocks.iter().for_each(&mut refs);
        }
        wm::Block::ThematicBreak(v) => validate_span(v.span, source)?,
        wm::Block::Custom(v) => {
            validate_span(v.span, source)?;
            serde_json::from_str::<serde_json::Value>(&v.attrs)
                .map_err(|e| parse_error(format!("invalid custom attrs JSON: {e}")))?;
            v.blocks.iter().for_each(&mut refs);
        }
        wm::Block::Table(v) => {
            validate_span(v.span, source)?;
            for row in v.head.iter().chain(v.rows.iter()) {
                for cell in &row.cells {
                    validate_span(cell.span, source)?;
                    cell.inlines.iter().for_each(|r| {
                        out.push(blocks.saturating_add(usize::try_from(*r).unwrap_or(usize::MAX)))
                    });
                }
            }
        }
        wm::Block::ReferenceDefinition(v) => validate_span(v.span, source)?,
    }
    Ok(())
}

fn inline_children(
    i: &wm::Inline,
    source: &fub_abi::format::DocumentSource,
    blocks: usize,
    out: &mut Vec<usize>,
) -> Result<(), FormatError> {
    let mut refs = |r: &u32| {
        out.push(blocks.saturating_add(usize::try_from(*r).unwrap_or(usize::MAX)));
    };
    match i {
        wm::Inline::Emph(v)
        | wm::Inline::Strong(v)
        | wm::Inline::Superscript(v)
        | wm::Inline::Strikethrough(v) => v.iter().for_each(&mut refs),
        wm::Inline::Link(v) => {
            validate_span(v.span, source)?;
            if let Some(label) = &v.label {
                label.iter().for_each(&mut refs);
            }
        }
        wm::Inline::TagRef(v) => validate_span(v.span, source)?,
        wm::Inline::Custom(v) => {
            validate_span(v.span, source)?;
            serde_json::from_str::<serde_json::Value>(&v.attrs)
                .map_err(|e| parse_error(format!("invalid custom attrs JSON: {e}")))?;
        }
        wm::Inline::Text(_)
        | wm::Inline::Code(_)
        | wm::Inline::HardBreak
        | wm::Inline::SoftBreak => {}
    }
    Ok(())
}

fn block_cost(b: &wm::Block) -> u64 {
    1u64.saturating_add(match b {
        wm::Block::CodeBlock(v) => (v.lang.as_ref().map_or(0, String::len) as u64)
            .saturating_add(v.code.len() as u64)
            .saturating_add(v.anchor.as_ref().map_or(0, String::len) as u64),
        wm::Block::Heading(v) => v
            .anchor
            .as_ref()
            .map_or(0, String::len)
            .saturating_add(v.explicit_anchor.as_ref().map_or(0, String::len))
            as u64,
        wm::Block::Paragraph(v) => v.anchor.as_ref().map_or(0, String::len) as u64,
        wm::Block::List(v) => (v.items.len() as u64)
            .saturating_add(v.anchor.as_ref().map_or(0, String::len) as u64)
            .saturating_add(v.items.iter().map(|i| u64::from(i.task.is_some())).sum()),
        wm::Block::Quote(v) => v.anchor.as_ref().map_or(0, String::len) as u64,
        wm::Block::Custom(v) => (v.custom_kind.len() as u64)
            .saturating_add(v.attrs.len() as u64)
            .saturating_add(v.anchor.as_ref().map_or(0, String::len) as u64),
        wm::Block::Table(v) => {
            let cells = v
                .head
                .iter()
                .chain(v.rows.iter())
                .flat_map(|r| r.cells.iter())
                .count() as u64;
            (v.rows.len() as u64)
                .saturating_add(cells)
                .saturating_add(v.align.len() as u64)
                .saturating_add(v.anchor.as_ref().map_or(0, String::len) as u64)
        }
        wm::Block::ThematicBreak(v) => v.anchor.as_ref().map_or(0, String::len) as u64,
        wm::Block::ReferenceDefinition(v) => (v.label.len() as u64)
            .saturating_add(v.url.len() as u64)
            .saturating_add(v.title.as_ref().map_or(0, String::len) as u64)
            .saturating_add(v.anchor.as_ref().map_or(0, String::len) as u64),
    })
}

fn target_cost(t: &wm::LinkTarget) -> u64 {
    match t {
        wm::LinkTarget::Wiki(v) => (v.page.len() as u64)
            .saturating_add(v.heading.as_ref().map_or(0, String::len) as u64)
            .saturating_add(v.block.as_ref().map_or(0, String::len) as u64),
        wm::LinkTarget::Url(v) | wm::LinkTarget::Path(v) => v.len() as u64,
    }
}

fn inline_cost(i: &wm::Inline) -> u64 {
    1u64.saturating_add(match i {
        wm::Inline::Text(v) | wm::Inline::Code(v) => v.len() as u64,
        wm::Inline::Link(v) => target_cost(&v.target),
        wm::Inline::TagRef(v) => v.name.len() as u64,
        wm::Inline::Custom(v) => (v.custom_kind.len() as u64).saturating_add(v.attrs.len() as u64),
        _ => 0,
    })
}
enum Pending<'a> {
    Blocks(&'a [rm::Block], u32),
    Inlines(&'a [rm::Inline], u32),
}

/// Controlla la profondità senza attraversare l'albero con lo stack del thread.
fn exceeds_depth(body: &[rm::Block]) -> bool {
    let mut pending = vec![Pending::Blocks(body, 1)];
    while let Some(work) = pending.pop() {
        match work {
            Pending::Blocks(blocks, depth) => {
                if depth > MAX_DEPTH {
                    return true;
                }
                let down = depth.saturating_add(1);
                for block in blocks.iter().rev() {
                    match block {
                        rm::Block::Heading { inlines, .. }
                        | rm::Block::Paragraph { inlines, .. } => {
                            pending.push(Pending::Inlines(inlines, down));
                        }
                        rm::Block::List { items, .. } => {
                            for item in items.iter().rev() {
                                pending.push(Pending::Blocks(&item.blocks, down));
                            }
                        }
                        rm::Block::Quote { blocks, .. } | rm::Block::Custom { blocks, .. } => {
                            pending.push(Pending::Blocks(blocks, down));
                        }
                        rm::Block::Table { head, rows, .. } => {
                            for row in rows.iter().rev() {
                                for cell in row.cells.iter().rev() {
                                    pending.push(Pending::Inlines(&cell.inlines, down));
                                }
                            }
                            if let Some(row) = head {
                                for cell in row.cells.iter().rev() {
                                    pending.push(Pending::Inlines(&cell.inlines, down));
                                }
                            }
                        }
                        rm::Block::CodeBlock { .. }
                        | rm::Block::ThematicBreak { .. }
                        | rm::Block::ReferenceDefinition { .. } => {}
                    }
                }
            }
            Pending::Inlines(inlines, depth) => {
                if depth > MAX_DEPTH {
                    return true;
                }
                let down = depth.saturating_add(1);
                for inline in inlines.iter().rev() {
                    match inline {
                        rm::Inline::Emph(children)
                        | rm::Inline::Strong(children)
                        | rm::Inline::Superscript(children)
                        | rm::Inline::Strikethrough(children) => {
                            pending.push(Pending::Inlines(children, down));
                        }
                        rm::Inline::Link {
                            label: Some(label), ..
                        } => {
                            pending.push(Pending::Inlines(label, down));
                        }
                        rm::Inline::Text(_)
                        | rm::Inline::Code(_)
                        | rm::Inline::Link { label: None, .. }
                        | rm::Inline::TagRef { .. }
                        | rm::Inline::Custom { .. }
                        | rm::Inline::HardBreak
                        | rm::Inline::SoftBreak => {}
                    }
                }
            }
        }
    }
    false
}

/// Smonta iterativamente un modello rifiutato, così anche il suo `Drop` non
/// percorre ricorsivamente un albero costruito da un documento ostile.
fn discard_document_model(m: rm::DocumentModel) {
    let rm::DocumentModel {
        body,
        id,
        frontmatter,
        outline,
        links,
        tags,
        anchors,
        text,
        frontmatter_present,
    } = m;
    drop((
        id,
        frontmatter,
        outline,
        links,
        tags,
        anchors,
        text,
        frontmatter_present,
    ));
    discard_blocks(body);
}

fn discard_blocks(body: Vec<rm::Block>) {
    let mut pending = vec![body];
    while let Some(blocks) = pending.pop() {
        for block in blocks {
            match block {
                rm::Block::Heading { inlines, .. } | rm::Block::Paragraph { inlines, .. } => {
                    discard_inlines(inlines)
                }
                rm::Block::List { items, .. } => {
                    for item in items {
                        pending.push(item.blocks);
                    }
                }
                rm::Block::Quote { blocks, .. } | rm::Block::Custom { blocks, .. } => {
                    pending.push(blocks);
                }
                rm::Block::Table { head, rows, .. } => {
                    if let Some(row) = head {
                        discard_row(row);
                    }
                    for row in rows {
                        discard_row(row);
                    }
                }
                rm::Block::CodeBlock { .. }
                | rm::Block::ThematicBreak { .. }
                | rm::Block::ReferenceDefinition { .. } => {}
            }
        }
    }
}

fn discard_row(row: rm::TableRow) {
    for cell in row.cells {
        discard_inlines(cell.inlines);
    }
}

fn discard_inlines(inlines: Vec<rm::Inline>) {
    let mut pending = vec![inlines];
    while let Some(inlines) = pending.pop() {
        for inline in inlines {
            match inline {
                rm::Inline::Emph(children)
                | rm::Inline::Strong(children)
                | rm::Inline::Superscript(children)
                | rm::Inline::Strikethrough(children) => pending.push(children),
                rm::Inline::Link {
                    label: Some(label), ..
                } => pending.push(label),
                rm::Inline::Text(_)
                | rm::Inline::Code(_)
                | rm::Inline::Link { label: None, .. }
                | rm::Inline::TagRef { .. }
                | rm::Inline::Custom { .. }
                | rm::Inline::HardBreak
                | rm::Inline::SoftBreak => {}
            }
        }
    }
}

/// Il frontmatter attraversa come JSON, che al confine è una stringa.
///
/// È la **verità grezza** — ciò che il file dice, ordine delle chiavi compreso
/// (il workspace accende `serde_json/preserve_order`) — e non la sua lettura
/// normalizzata: `property-value` esiste nel WIT ma non dentro `document-model`,
/// perché chi legge un modello vuole il documento com'è e chi vuole «questa
/// proprietà è una data» lo chiede all'indice.
fn to_frontmatter(f: &rm::Frontmatter) -> String {
    serde_json::to_string(&f.0).expect("frontmatter is always serializable")
}

// ---------------------------------------------------------------------------
// Le tabelle piatte: outline, link, tag, ancore
// ---------------------------------------------------------------------------

fn to_heading(h: &rm::Heading) -> wm::Heading {
    wm::Heading {
        level: h.level,
        text: h.text.clone(),
        slug: h.slug.clone(),
        span: to_span(h.span),
        explicit_anchor: h.explicit_anchor.clone(),
    }
}

pub(crate) fn to_target(t: &rm::LinkTarget) -> wm::LinkTarget {
    match t {
        rm::LinkTarget::Wiki {
            page,
            heading,
            block,
        } => wm::LinkTarget::Wiki(wm::LinkTargetWiki {
            page: page.clone(),
            heading: heading.clone(),
            block: block.clone(),
        }),
        rm::LinkTarget::Url(u) => wm::LinkTarget::Url(u.clone()),
        rm::LinkTarget::Path(p) => wm::LinkTarget::Path(p.clone()),
    }
}

fn to_link(the: &rm::Link) -> wm::Link {
    wm::Link {
        target: to_target(&the.target),
        embed: the.embed,
        span: to_span(the.span),
        context: the.context.clone(),
    }
}

fn to_tag(t: &rm::Tag) -> wm::Tag {
    wm::Tag {
        name: t.name.clone(),
        span: to_span(t.span),
    }
}

fn to_anchor(a: &rm::Anchor) -> wm::Anchor {
    wm::Anchor {
        id: a.id.clone(),
        span: to_span(a.span),
        marker: to_span(a.marker),
    }
}

// ---------------------------------------------------------------------------
// Il corpo: l'albero che diventa arena
// ---------------------------------------------------------------------------

/// Il corpo del documento appiattito nelle due liste del contratto.
fn to_tree(body: &[rm::Block]) -> Result<wm::DocumentTree, PluginError> {
    let mut arena = Arena::default();
    let roots = arena.blocks(body, 1)?;
    Ok(wm::DocumentTree {
        blocks: arena.blocks,
        inlines: arena.inline,
        roots,
    })
}

/// Le due liste di `document-tree` mentre si riempiono.
///
/// Non è una comodità: è l'unico posto in cui un indice viene assegnato, e
/// tenerlo unico è ciò che rende impossibile un `block-ref` che punta
/// altrove — «fuori range = modello malformato», dice il WIT, e di qua il caso
/// non si può nemmeno scrivere.
#[derive(Default)]
struct Arena {
    blocks: Vec<wm::Block>,
    inline: Vec<wm::Inline>,
}

impl Arena {
    /// Deposita un blocco già tradotto e restituisce il suo `block-ref`.
    fn place_block(&mut self, b: wm::Block) -> Result<u32, PluginError> {
        let index = reference(self.blocks.len())?;
        self.blocks.push(b);
        Ok(index)
    }

    /// Deposita un inline già tradotto e restituisce il suo `inline-ref`.
    fn place_inline(&mut self, the: wm::Inline) -> Result<u32, PluginError> {
        let index = reference(self.inline.len())?;
        self.inline.push(the);
        Ok(index)
    }

    fn blocks(&mut self, v: &[rm::Block], depth: u32) -> Result<Vec<u32>, PluginError> {
        v.iter().map(|b| self.block(b, depth)).collect()
    }

    fn inline(&mut self, v: &[rm::Inline], depth: u32) -> Result<Vec<u32>, PluginError> {
        v.iter().map(|the| self.single_inline(the, depth)).collect()
    }

    /// Un blocco e tutto ciò che porta dentro, in post-ordine.
    ///
    /// `depth` è il livello di **questo** blocco (le radici stanno a 1) e
    /// non un contatore condiviso: due rami paralleli non si sommano, perché ciò
    /// che consuma lo stack è la discesa, non la larghezza.
    ///
    /// La `match` è esaustiva senza `_ =>`, e non è pignoleria: è il presidio
    /// che il modulo `translate` dichiara in testa a sé stesso. Il giorno che
    /// `Block` cresce di una variante — e cresce, la 0003 ha già promosso la
    /// tabella e lasciato in coda footnote e definition list — questo file
    /// smette di compilare e nomina la riga. Con un `_ =>` che ingoia il caso
    /// nuovo, invece, il blocco nuovo arriverebbe di là come qualcos'altro (o
    /// non arriverebbe affatto) e nessuno lo saprebbe fino a un bug di rendering
    /// in casa di un terzo.
    fn block(&mut self, b: &rm::Block, depth: u32) -> Result<u32, PluginError> {
        if depth > MAX_DEPTH {
            return Err(too_deep());
        }
        let down = depth + 1;
        let translated = match b {
            rm::Block::Heading {
                level,
                inlines,
                anchor,
                span,
                explicit_anchor,
            } => wm::Block::Heading(wm::BlockHeading {
                level: *level,
                inlines: self.inline(inlines, down)?,
                anchor: anchor.clone(),
                span: to_span(*span),
                explicit_anchor: explicit_anchor.clone(),
            }),
            rm::Block::Paragraph {
                inlines,
                anchor,
                span,
            } => wm::Block::Paragraph(wm::BlockParagraph {
                inlines: self.inline(inlines, down)?,
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
            rm::Block::List {
                ordered,
                items,
                anchor,
                span,
                start,
            } => {
                let mut entries = Vec::with_capacity(items.len());
                for v in items {
                    entries.push(self.entry(v, down)?);
                }
                wm::Block::List(wm::BlockList {
                    ordered: *ordered,
                    items: entries,
                    anchor: anchor.clone(),
                    span: to_span(*span),
                    start: *start,
                })
            }
            rm::Block::CodeBlock {
                lang,
                code,
                anchor,
                span,
            } => wm::Block::CodeBlock(wm::BlockCodeBlock {
                lang: lang.clone(),
                code: code.clone(),
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
            rm::Block::Quote {
                blocks,
                anchor,
                span,
            } => wm::Block::Quote(wm::BlockQuote {
                blocks: self.blocks(blocks, down)?,
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
            rm::Block::ThematicBreak { anchor, span } => {
                wm::Block::ThematicBreak(wm::BlockThematicBreak {
                    anchor: anchor.clone(),
                    span: to_span(*span),
                })
            }
            rm::Block::Custom {
                custom_kind,
                attrs,
                blocks,
                anchor,
                span,
            } => wm::Block::Custom(wm::BlockCustom {
                custom_kind: custom_kind.clone(),
                attrs: tr::to_json(attrs),
                blocks: self.blocks(blocks, down)?,
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
            rm::Block::Table {
                head,
                rows,
                align,
                anchor,
                span,
            } => {
                // Le celle portano **inline**, ed è la ragione per cui la
                // tabella non stava dentro `Custom`: qui si vede in una riga,
                // perché è l'unico ramo che scende negli inline passando da un
                // record che non è un blocco.
                let head = match head {
                    Some(r) => Some(self.row(r, down)?),
                    None => None,
                };
                let mut converted_rows = Vec::with_capacity(rows.len());
                for r in rows {
                    converted_rows.push(self.row(r, down)?);
                }
                wm::Block::Table(wm::BlockTable {
                    head,
                    rows: converted_rows,
                    align: align.iter().map(|a| to_alignment(*a)).collect(),
                    anchor: anchor.clone(),
                    span: to_span(*span),
                })
            }
            rm::Block::ReferenceDefinition {
                label,
                url,
                title,
                anchor,
                span,
            } => wm::Block::ReferenceDefinition(wm::BlockReferenceDefinition {
                label: label.clone(),
                url: url.clone(),
                title: title.clone(),
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
        };
        self.place_block(translated)
    }

    /// Una voce di lista: i suoi blocchi, e la task se è una task.
    fn entry(&mut self, v: &rm::ListItem, depth: u32) -> Result<wm::ListItem, PluginError> {
        Ok(wm::ListItem {
            blocks: self.blocks(&v.blocks, depth)?,
            task: v.task.as_ref().map(to_marker),
            span: to_span(v.span),
        })
    }

    fn row(&mut self, r: &rm::TableRow, depth: u32) -> Result<wm::TableRow, PluginError> {
        let mut cells = Vec::with_capacity(r.cells.len());
        for c in &r.cells {
            cells.push(wm::TableCell {
                inlines: self.inline(&c.inlines, depth)?,
                span: to_span(c.span),
            });
        }
        Ok(wm::TableRow { cells })
    }

    /// Un inline e ciò che porta dentro, in post-ordine.
    ///
    /// Gli inline si annidano quanto i blocchi — un `**grassetto con *corsivo*
    /// dentro**`, l'etichetta di un link che è a sua volta enfasi — e il tetto è
    /// lo stesso: la discesa costa stack qui esattamente come di sopra, e due
    /// budget separati vorrebbero dire che il caso peggiore è la loro somma.
    ///
    /// Si chiama `single_inline` perché `inline` è già il plurale del suo
    /// chiamante; un nome è la firma che si legge dal punto di chiamata.
    fn single_inline(&mut self, the: &rm::Inline, depth: u32) -> Result<u32, PluginError> {
        if depth > MAX_DEPTH {
            return Err(too_deep());
        }
        let down = depth + 1;
        let translated = match the {
            rm::Inline::Text(s) => wm::Inline::Text(s.clone()),
            rm::Inline::Emph(v) => wm::Inline::Emph(self.inline(v, down)?),
            rm::Inline::Strong(v) => wm::Inline::Strong(self.inline(v, down)?),
            rm::Inline::Code(s) => wm::Inline::Code(s.clone()),
            rm::Inline::Link {
                target,
                label,
                embed,
                span,
            } => {
                // L'etichetta assente e l'etichetta vuota sono due cose diverse:
                // `[[Nota]]` non ha etichetta (la si genera dal bersaglio),
                // `[](nota.md)` ne ha una vuota. Il `match` esplicito invece di
                // un `map` perché dentro c'è un `?`.
                let label = match label {
                    Some(v) => Some(self.inline(v, down)?),
                    None => None,
                };
                wm::Inline::Link(wm::InlineLink {
                    target: to_target(target),
                    label,
                    embed: *embed,
                    span: to_span(*span),
                })
            }
            rm::Inline::TagRef { name, span } => wm::Inline::TagRef(wm::InlineTagRef {
                name: name.clone(),
                span: to_span(*span),
            }),
            rm::Inline::Custom {
                custom_kind,
                attrs,
                span,
            } => wm::Inline::Custom(wm::InlineCustom {
                custom_kind: custom_kind.clone(),
                attrs: tr::to_json(attrs),
                span: to_span(*span),
            }),
            rm::Inline::Superscript(v) => wm::Inline::Superscript(self.inline(v, down)?),
            rm::Inline::Strikethrough(v) => wm::Inline::Strikethrough(self.inline(v, down)?),
            rm::Inline::HardBreak => wm::Inline::HardBreak,
            rm::Inline::SoftBreak => wm::Inline::SoftBreak,
        };
        self.place_inline(translated)
    }
}

fn to_marker(t: &rm::TaskMarker) -> wm::TaskMarker {
    wm::TaskMarker {
        symbol: t.symbol,
        span: to_span(t.span),
    }
}

fn to_alignment(a: rm::ColumnAlign) -> wm::ColumnAlign {
    match a {
        rm::ColumnAlign::None => wm::ColumnAlign::None,
        rm::ColumnAlign::Left => wm::ColumnAlign::Left,
        rm::ColumnAlign::Center => wm::ColumnAlign::Center,
        rm::ColumnAlign::Right => wm::ColumnAlign::Right,
    }
}

/// L'indice di un nodo nell'arena, alla larghezza che il contratto dichiara.
///
/// `block-ref` e `inline-ref` sono `u32`, e un `as u32` avrebbe **troncato** in
/// silenzio: il nodo quattro-miliardi-e-uno avrebbe ricevuto l'indice 1, cioè
/// un albero che di là si ricostruisce sbagliato invece di non ricostruirsi. Il
/// caso non capita — un documento con quattro miliardi di nodi non entra nella
/// memoria di nessuno — ma «non capita» e «non si può scrivere» sono due
/// affermazioni diverse, e solo la seconda regge senza qualcuno che la
/// ricontrolli.
fn reference(len: usize) -> Result<u32, PluginError> {
    u32::try_from(len).map_err(|_| {
        PluginError::Internal(
            "the document tree has more nodes than a 32-bit reference can name".into(),
        )
    })
}

/// Il rifiuto di un albero troppo profondo.
///
/// `Internal` e non `BadArgs`: chi ha chiesto il modello non ha sbagliato
/// niente — ha nominato un documento che esiste — ed è l'host a non saperlo
/// portare di là. Il messaggio dice il tetto, perché un limite senza il proprio
/// numero è indistinguibile da un guasto.
fn too_deep() -> PluginError {
    PluginError::Internal(
        format!(
            "l'albero del documento supera i {MAX_DEPTH} livelli di annidamento \
             che l'host traduce"
        )
        .into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::format::DocumentSource;

    fn span() -> rm::Span {
        rm::Span::new(0, 0)
    }

    /// Una citazione dentro l'altra, `n` volte.
    fn quotes(n: u32) -> rm::Block {
        let mut b = rm::Block::Paragraph {
            inlines: vec![rm::Inline::Text("bottom".into())],
            anchor: None,
            span: span(),
        };
        for _ in 0..n {
            b = rm::Block::Quote {
                blocks: vec![b],
                anchor: None,
                span: span(),
            };
        }
        b
    }

    /// L'arena è in post-ordine e le radici sono in ordine di lettura: il figlio
    /// esiste **prima** del padre, ed è ciò che rende ogni riferimento valido
    /// nel momento in cui viene scritto.
    #[test]
    fn the_child_enters_the_arena_before_the_parent() {
        let tree = to_tree(&[quotes(1)]).expect("two levels pass");
        assert_eq!(tree.roots, vec![1], "the root is the quote, not the text");
        assert_eq!(tree.blocks.len(), 2);
        assert_eq!(tree.inlines.len(), 1);
        let wm::Block::Quote(q) = &tree.blocks[1] else {
            panic!("the root is the quote");
        };
        assert_eq!(q.blocks, vec![0], "the child is the first block deposited");
    }

    /// Il tetto è quello dichiarato: l'ultimo livello ammesso passa, il primo di
    /// troppo riceve un errore che nomina il numero invece di un `SIGSEGV`.
    #[test]
    fn a_too_deep_tree_is_rejected_instead_of_crashing_the_stack() {
        // Le radici stanno a 1, e il testo dentro il paragrafo occupa un livello
        // suo — è il budget unico dichiarato in `single_inline`. Quindi
        // `MAX_DEPTH - 2` citazioni mettono l'inline più interno
        // esattamente sull'ultimo livello lecito.
        let at_the_limit = quotes(MAX_DEPTH - 2);
        assert!(
            to_tree(&[at_the_limit]).is_ok(),
            "the last allowed level passes"
        );

        let one_too_many = quotes(MAX_DEPTH - 1);
        let error = to_tree(&[one_too_many]).expect_err("one more level should fail");
        assert!(
            matches!(&error, PluginError::Internal(t)
                if t.as_literal().is_some_and(|m| m.contains(&MAX_DEPTH.to_string()))),
            "the refusal names the ceiling: {error}"
        );
    }

    /// Duemila `>` in testa a una riga sono due kilobyte di file, e trentuno
    /// volte il tetto: senza il tetto questo test non fallirebbe, **morirebbe**.
    #[test]
    fn a_malformed_document_does_not_bring_down_the_thread() {
        let error = to_tree(&[quotes(2_000)]).expect_err("no tree that deep passes");
        assert!(matches!(error, PluginError::Internal(_)));
    }

    #[test]
    fn inbound_roundtrip_rebuilds_a_nontrivial_model() {
        let mut model = rm::DocumentModel::empty(rm::DocId::new("nota.md"));
        model.text = "hello".into();
        model.body.push(rm::Block::Paragraph {
            inlines: vec![
                rm::Inline::Strong(vec![rm::Inline::Text("hello".into())]),
                rm::Inline::SoftBreak,
            ],
            anchor: Some("p".into()),
            span: rm::Span::new(0, 5),
        });
        let wire = to_document(model.clone()).expect("native model translates");
        let got = from_document(
            wire,
            &ParseContext::bare("nota.md"),
            &DocumentSource::Text("hello".into()),
        )
        .expect("guest model rebuilds");
        assert_eq!(got, model);
    }
    #[test]
    fn inbound_rejects_compact_doubling_dag_by_materialization_budget() {
        let mut wire = to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        let mut child = 0u32;
        wire.body
            .blocks
            .push(wm::Block::Paragraph(wm::BlockParagraph {
                inlines: vec![],
                anchor: None,
                span: wm::Span { start: 0, end: 0 },
            }));
        for _ in 0..32 {
            let index = u32::try_from(wire.body.blocks.len()).expect("test arena fits u32");
            wire.body.blocks.push(wm::Block::Quote(wm::BlockQuote {
                blocks: vec![child, child],
                anchor: None,
                span: wm::Span { start: 0, end: 0 },
            }));
            child = index;
        }
        wire.body.roots = vec![child];
        let error = from_document(
            wire,
            &ParseContext::bare("nota.md"),
            &DocumentSource::Text(String::new()),
        )
        .expect_err("exponential rebuild must be bounded");
        assert!(
            matches!(&error, FormatError::Parse(message) if message.contains("materialization")),
            "expected materialization budget error, got {error}"
        );
    }

    #[test]
    fn inbound_preflight_charges_repeated_url_payload_before_rebuild() {
        let mut wire = to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        let url = "u".repeat((MAX_MATERIALIZATION_UNITS / 2 + 1) as usize);
        wire.body.inlines.push(wm::Inline::Link(wm::InlineLink {
            target: wm::LinkTarget::Url(url),
            label: None,
            embed: false,
            span: wm::Span { start: 0, end: 0 },
        }));
        wire.body
            .blocks
            .push(wm::Block::Paragraph(wm::BlockParagraph {
                inlines: vec![0, 0],
                anchor: None,
                span: wm::Span { start: 0, end: 0 },
            }));
        wire.body.roots = vec![0];

        let error = preflight(&wire.body, &DocumentSource::Text(String::new()))
            .expect_err("repeated URL payload must exceed the materialization budget");
        assert!(
            matches!(&error, FormatError::Parse(message) if message.contains("materialization")),
            "expected materialization budget error, got {error}"
        );
    }

    #[test]
    fn inbound_rejects_a_mismatched_document_id() {
        let wire = to_document(rm::DocumentModel::empty(rm::DocId::new("guest.md"))).unwrap();
        let error = from_document(
            wire,
            &ParseContext::bare("ctx.md"),
            &DocumentSource::Text(String::new()),
        )
        .expect_err("id mismatch");
        assert!(matches!(error, FormatError::Parse(message) if message.contains("does not match")));
    }

    #[test]
    fn inbound_rejects_dangling_and_cyclic_references() {
        let mut dangling =
            to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        dangling.body.roots.push(9);
        assert!(
            matches!(from_document(dangling, &ParseContext::bare("nota.md"), &DocumentSource::Text(String::new())), Err(FormatError::Parse(m)) if m.contains("dangling"))
        );

        let mut cyclic = to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        cyclic.body.blocks.push(wm::Block::Quote(wm::BlockQuote {
            blocks: vec![0],
            anchor: None,
            span: wm::Span { start: 0, end: 0 },
        }));
        cyclic.body.roots.push(0);
        assert!(
            matches!(from_document(cyclic, &ParseContext::bare("nota.md"), &DocumentSource::Text(String::new())), Err(FormatError::Parse(m)) if m.contains("cycle"))
        );
    }

    #[test]
    fn inbound_accepts_dag_reuse_and_rejects_depth_json_and_spans() {
        let mut dag = to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        dag.body
            .blocks
            .push(wm::Block::Paragraph(wm::BlockParagraph {
                inlines: vec![],
                anchor: None,
                span: wm::Span { start: 0, end: 0 },
            }));
        dag.body.blocks.push(wm::Block::Quote(wm::BlockQuote {
            blocks: vec![0, 0],
            anchor: None,
            span: wm::Span { start: 0, end: 0 },
        }));
        dag.body.roots.push(1);
        assert!(from_document(
            dag,
            &ParseContext::bare("nota.md"),
            &DocumentSource::Text(String::new())
        )
        .is_ok());
        let bytes_wire = to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        assert!(from_document(
            bytes_wire,
            &ParseContext::bare("nota.md"),
            &DocumentSource::Bytes(vec![0xff])
        )
        .is_ok());

        let mut bad_json =
            to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        bad_json.frontmatter = "[]".into();
        assert!(matches!(
            from_document(
                bad_json,
                &ParseContext::bare("nota.md"),
                &DocumentSource::Text(String::new())
            ),
            Err(FormatError::Parse(_))
        ));

        let mut bad_span =
            to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        bad_span.outline.push(wm::Heading {
            level: 1,
            text: "x".into(),
            slug: "x".into(),
            span: wm::Span { start: 0, end: 1 },
            explicit_anchor: None,
        });
        assert!(matches!(
            from_document(
                bad_span,
                &ParseContext::bare("nota.md"),
                &DocumentSource::Text("".into())
            ),
            Err(FormatError::Parse(_))
        ));
    }
    #[test]
    fn inbound_enforces_depth_and_custom_json() {
        fn nested_quotes(n: u32) -> wm::DocumentModel {
            let mut wire =
                to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
            let mut child = None;
            for _ in 0..n {
                let index = wire.body.blocks.len() as u32;
                let blocks = child.into_iter().collect();
                wire.body.blocks.push(wm::Block::Quote(wm::BlockQuote {
                    blocks,
                    anchor: None,
                    span: wm::Span { start: 0, end: 0 },
                }));
                child = Some(index);
            }
            wire.body.roots = child.into_iter().collect();
            wire
        }

        assert!(from_document(
            nested_quotes(MAX_DEPTH),
            &ParseContext::bare("nota.md"),
            &DocumentSource::Text(String::new())
        )
        .is_ok());
        assert!(matches!(
            from_document(nested_quotes(MAX_DEPTH + 1), &ParseContext::bare("nota.md"), &DocumentSource::Text(String::new())),
            Err(FormatError::Parse(message)) if message.contains("64")
        ));

        let mut bad = to_document(rm::DocumentModel::empty(rm::DocId::new("nota.md"))).unwrap();
        bad.body.blocks.push(wm::Block::Custom(wm::BlockCustom {
            custom_kind: "x".into(),
            attrs: "{not-json".into(),
            blocks: vec![],
            anchor: None,
            span: wm::Span { start: 0, end: 0 },
        }));
        bad.body.roots.push(0);
        assert!(
            matches!(from_document(bad, &ParseContext::bare("nota.md"), &DocumentSource::Text(String::new())), Err(FormatError::Parse(message)) if message.contains("JSON"))
        );
    }

    #[test]
    fn a_rejected_document_is_discarded_without_recursive_drop() {
        let mut model = rm::DocumentModel::empty(rm::DocId::new("profondo.md"));
        model.body.push(quotes(2_000));
        let error = to_document(model).expect_err("no tree that deep crosses");
        assert!(matches!(error, PluginError::Internal(_)));
    }
}
