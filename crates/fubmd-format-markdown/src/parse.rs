//! Parsing: AST comrak → `DocumentModel` comune.

use comrak::nodes::{AstNode, ListType, NodeValue};
use comrak::{Arena, Options};
use fubmd_abi::format::ParseContext;
use fubmd_abi::model::{
    Block, DocId, DocumentModel, Frontmatter, Heading, Inline, Link, LinkTarget, Span, Tag,
};
use fubmd_abi::FormatError;
use fubmd_sdk::scan;

use crate::offsets::Offsets;
use crate::util::slugify;

/// Costruisce le opzioni comrak per il dialetto Obsidian.
pub fn build_options(ctx: &ParseContext) -> Options<'static> {
    let mut o = Options::default();
    o.extension.front_matter_delimiter = Some("---".to_string());
    o.extension.strikethrough = true;
    o.extension.table = true;
    o.extension.tasklist = true;
    o.extension.superscript = true;
    o.extension.alerts = true; // GitHub alerts ≈ callout Obsidian
    if ctx.parse_wikilinks {
        o.extension.wikilinks_title_after_pipe = true;
    }
    o
}

/// Accumulatore delle tabelle piatte estratte durante la visita.
#[derive(Default)]
struct Acc {
    links: Vec<Link>,
    tags: Vec<Tag>,
    outline: Vec<Heading>,
    text: String,
}

pub fn parse_markdown(source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
    let offsets = Offsets::new(source);
    let arena = Arena::new();
    let options = build_options(ctx);
    let root = comrak::parse_document(&arena, source, &options);

    let mut acc = Acc::default();
    let mut frontmatter = Frontmatter::default();
    let mut body = Vec::new();

    for child in root.children() {
        let value = &child.data.borrow().value;
        if let NodeValue::FrontMatter(raw) = value {
            frontmatter = parse_frontmatter(raw);
            continue;
        }
        if let Some(block) = convert_block(child, source, &offsets, ctx, &mut acc) {
            body.push(block);
        }
    }

    Ok(DocumentModel {
        id: DocId::new(ctx.doc_id.clone()),
        frontmatter,
        body,
        outline: acc.outline,
        links: acc.links,
        tags: acc.tags,
        text: acc.text.trim().to_string(),
    })
}

fn span_of<'a>(node: &'a AstNode<'a>, offsets: &Offsets) -> Span {
    let sp = node.data.borrow().sourcepos;
    Span::new(
        offsets.byte(sp.start.line, sp.start.column),
        // la colonna di fine è inclusiva in comrak: +1 per l'estremo esclusivo.
        offsets.byte(sp.end.line, sp.end.column + 1),
    )
}

fn convert_block<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets,
    ctx: &ParseContext,
    acc: &mut Acc,
) -> Option<Block> {
    let span = span_of(node, offsets);
    let value = node.data.borrow().value.clone();
    match value {
        NodeValue::Heading(h) => {
            let mut text = String::new();
            let inlines = convert_inlines(node, source, offsets, ctx, acc, &mut text);
            acc.text.push_str(&text);
            acc.text.push('\n');
            acc.outline.push(Heading {
                level: h.level,
                text: text.trim().to_string(),
                slug: slugify(text.trim()),
                span,
            });
            Some(Block::Heading {
                level: h.level,
                inlines,
                span,
            })
        }
        NodeValue::Paragraph => {
            let link_base = acc.links.len();
            let mut text = String::new();
            let inlines = convert_inlines(node, source, offsets, ctx, acc, &mut text);
            let ptext = text.trim().to_string();
            // I link scoperti in questo paragrafo ereditano il testo come contesto.
            for link in &mut acc.links[link_base..] {
                if link.context.is_none() {
                    link.context = Some(ptext.clone());
                }
            }
            acc.text.push_str(&ptext);
            acc.text.push('\n');
            Some(Block::Paragraph { inlines, span })
        }
        NodeValue::List(list) => {
            let ordered = matches!(list.list_type, ListType::Ordered);
            let mut items = Vec::new();
            for item in node.children() {
                let mut item_blocks = Vec::new();
                for b in item.children() {
                    if let Some(block) = convert_block(b, source, offsets, ctx, acc) {
                        item_blocks.push(block);
                    }
                }
                items.push(item_blocks);
            }
            Some(Block::List {
                ordered,
                items,
                span,
            })
        }
        NodeValue::CodeBlock(cb) => {
            let lang = cb
                .info
                .split_whitespace()
                .next()
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            acc.text.push_str(&cb.literal);
            acc.text.push('\n');
            Some(Block::CodeBlock {
                lang,
                code: cb.literal,
                span,
            })
        }
        NodeValue::BlockQuote => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc);
            Some(Block::Quote { blocks, span })
        }
        NodeValue::Alert(alert) => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc);
            let kind = format!("{:?}", alert.alert_type).to_lowercase();
            Some(Block::Custom {
                custom_kind: "callout".to_string(),
                attrs: serde_json::json!({ "type": kind, "title": alert.title }),
                blocks,
                span,
            })
        }
        NodeValue::ThematicBreak => Some(Block::ThematicBreak { span }),
        // Tabelle, HTML block, ecc.: escape hatch generico per M1.
        other => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc);
            if blocks.is_empty() {
                None
            } else {
                Some(Block::Custom {
                    custom_kind: node_kind(&other).to_string(),
                    attrs: serde_json::Value::Null,
                    blocks,
                    span,
                })
            }
        }
    }
}

fn convert_block_children<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets,
    ctx: &ParseContext,
    acc: &mut Acc,
) -> Vec<Block> {
    node.children()
        .filter_map(|c| convert_block(c, source, offsets, ctx, acc))
        .collect()
}

fn convert_inlines<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets,
    ctx: &ParseContext,
    acc: &mut Acc,
    text_out: &mut String,
) -> Vec<Inline> {
    let mut out = Vec::new();
    for child in node.children() {
        let span = span_of(child, offsets);
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Text(s) => {
                let s: String = s.to_string();
                text_out.push_str(&s);
                push_text_features(&s, span.start, ctx, acc, &mut out);
            }
            NodeValue::SoftBreak | NodeValue::LineBreak => {
                text_out.push(' ');
                out.push(Inline::Text(" ".to_string()));
            }
            NodeValue::Emph => {
                out.push(Inline::Emph(convert_inlines(
                    child, source, offsets, ctx, acc, text_out,
                )));
            }
            NodeValue::Strong => {
                out.push(Inline::Strong(convert_inlines(
                    child, source, offsets, ctx, acc, text_out,
                )));
            }
            NodeValue::Code(code) => {
                text_out.push_str(&code.literal);
                out.push(Inline::Code(code.literal));
            }
            NodeValue::Link(link) => {
                let mut label_text = String::new();
                let label = convert_inlines(child, source, offsets, ctx, acc, &mut label_text);
                text_out.push_str(&label_text);
                let target = classify_url(&link.url);
                acc.links.push(Link {
                    target: target.clone(),
                    span,
                    context: None,
                });
                out.push(Inline::Link {
                    target,
                    label: Some(label),
                    span,
                });
            }
            NodeValue::WikiLink(wl) => {
                let embed = span.start > 0 && source.as_bytes()[span.start - 1] == b'!';
                let parsed = scan::parse_wikilink_inner(&wl.url, embed);
                let mut label_text = String::new();
                let label = convert_inlines(child, source, offsets, ctx, acc, &mut label_text);
                text_out.push_str(&label_text);
                acc.links.push(Link {
                    target: parsed.target.clone(),
                    span,
                    context: None,
                });
                out.push(Inline::Link {
                    target: parsed.target,
                    label: Some(label),
                    span,
                });
            }
            NodeValue::Image(img) => {
                let mut label_text = String::new();
                let label = convert_inlines(child, source, offsets, ctx, acc, &mut label_text);
                out.push(Inline::Link {
                    target: classify_url(&img.url),
                    label: Some(label),
                    span,
                });
            }
            _ => {
                // Sotto-inline sconosciuti: recupera almeno il testo.
                let nested = convert_inlines(child, source, offsets, ctx, acc, text_out);
                out.extend(nested);
            }
        }
    }
    out
}

/// Divide un frammento di testo in `Text`/`TagRef`, registrando i tag in `acc`.
/// `base` è l'offset in byte del frammento nella sorgente.
/// Elabora un frammento di testo estraendo, nell'ordine, gli embed
/// `![[...]]` (che comrak non riconosce) e poi i `#tag` dai segmenti restanti.
fn push_text_features(
    text: &str,
    base: usize,
    ctx: &ParseContext,
    acc: &mut Acc,
    out: &mut Vec<Inline>,
) {
    let embeds = if ctx.parse_wikilinks {
        find_embeds(text)
    } else {
        Vec::new()
    };
    if embeds.is_empty() {
        push_plain_or_tags(text, base, ctx, acc, out);
        return;
    }
    let mut cursor = 0;
    for (span, inner) in embeds {
        if span.start > cursor {
            push_plain_or_tags(&text[cursor..span.start], base + cursor, ctx, acc, out);
        }
        let parsed = scan::parse_wikilink_inner(&inner, true);
        let abs = Span::new(base + span.start, base + span.end);
        acc.links.push(Link {
            target: parsed.target.clone(),
            span: abs,
            context: None,
        });
        out.push(Inline::Link {
            target: parsed.target,
            label: None,
            span: abs,
        });
        cursor = span.end;
    }
    if cursor < text.len() {
        push_plain_or_tags(&text[cursor..], base + cursor, ctx, acc, out);
    }
}

/// Trova gli embed `![[...]]`, restituendo (span nel frammento, contenuto interno).
fn find_embeds(text: &str) -> Vec<(Span, String)> {
    let mut res = Vec::new();
    let mut i = 0;
    while i < text.len() {
        if !text.is_char_boundary(i) {
            i += 1;
            continue;
        }
        if text[i..].starts_with("![[") {
            if let Some(rel) = text[i + 3..].find("]]") {
                let inner = text[i + 3..i + 3 + rel].to_string();
                let end = i + 3 + rel + 2;
                res.push((Span::new(i, end), inner));
                i = end;
                continue;
            }
        }
        i += 1;
    }
    res
}

/// Segmento senza embed: estrae i `#tag` (se abilitati) o emette testo piatto.
fn push_plain_or_tags(
    text: &str,
    base: usize,
    ctx: &ParseContext,
    acc: &mut Acc,
    out: &mut Vec<Inline>,
) {
    if !ctx.parse_tags {
        if !text.is_empty() {
            out.push(Inline::Text(text.to_string()));
        }
        return;
    }
    let tags = scan::extract_tags(text);
    if tags.is_empty() {
        if !text.is_empty() {
            out.push(Inline::Text(text.to_string()));
        }
        return;
    }
    let mut cursor = 0;
    for tag in tags {
        if tag.span.start > cursor {
            out.push(Inline::Text(text[cursor..tag.span.start].to_string()));
        }
        let abs = Span::new(base + tag.span.start, base + tag.span.end);
        out.push(Inline::TagRef {
            name: tag.name.clone(),
            span: abs,
        });
        acc.tags.push(Tag {
            name: tag.name,
            span: abs,
        });
        cursor = tag.span.end;
    }
    if cursor < text.len() {
        out.push(Inline::Text(text[cursor..].to_string()));
    }
}

fn classify_url(url: &str) -> LinkTarget {
    if url.contains("://") || url.starts_with("mailto:") {
        LinkTarget::Url(url.to_string())
    } else {
        LinkTarget::Path(url.to_string())
    }
}

fn parse_frontmatter(raw: &str) -> Frontmatter {
    // `raw` include i delimitatori `---`; li togliamo prima di parsare lo YAML.
    let inner = raw
        .trim()
        .trim_start_matches("---")
        .trim_end_matches("---")
        .trim();
    if inner.is_empty() {
        return Frontmatter::default();
    }
    match serde_yaml_ng::from_str::<serde_json::Value>(inner) {
        Ok(serde_json::Value::Object(map)) => Frontmatter(map),
        _ => Frontmatter::default(),
    }
}

fn node_kind(value: &NodeValue) -> &'static str {
    match value {
        NodeValue::Table(_) => "table",
        NodeValue::HtmlBlock(_) => "html",
        NodeValue::TaskItem(_) => "task",
        _ => "block",
    }
}
