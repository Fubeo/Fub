//! Rendering HTML **dal modello comune** (non dalla sorgente): così il render
//! è una funzione pura del `DocumentModel`, esattamente come vuole il trait, e
//! la navigazione dei wikilink passa per data-attribute che il frontend risolve.

use fubmd_abi::format::RenderOptions;
use fubmd_abi::model::{Block, DocumentModel, Inline, LinkTarget};

use crate::util::{escape_attr, escape_html};

pub fn render_html(model: &DocumentModel, opts: &RenderOptions) -> String {
    let mut out = String::new();
    render_blocks(&model.body, opts, &mut out);
    out
}

fn render_blocks(blocks: &[Block], opts: &RenderOptions, out: &mut String) {
    for block in blocks {
        render_block(block, opts, out);
    }
}

fn render_block(block: &Block, opts: &RenderOptions, out: &mut String) {
    match block {
        Block::Heading { level, inlines, .. } => {
            let l = (*level).clamp(1, 6);
            out.push_str(&format!("<h{l}>"));
            render_inlines(inlines, opts, out);
            out.push_str(&format!("</h{l}>"));
        }
        Block::Paragraph { inlines, .. } => {
            out.push_str("<p>");
            render_inlines(inlines, opts, out);
            out.push_str("</p>");
        }
        Block::List { ordered, items, .. } => {
            let tag = if *ordered { "ol" } else { "ul" };
            out.push_str(&format!("<{tag}>"));
            for item in items {
                out.push_str("<li>");
                render_blocks(item, opts, out);
                out.push_str("</li>");
            }
            out.push_str(&format!("</{tag}>"));
        }
        Block::CodeBlock { lang, code, .. } => {
            match lang {
                Some(l) => out.push_str(&format!(
                    "<pre><code class=\"language-{}\">",
                    escape_attr(l)
                )),
                None => out.push_str("<pre><code>"),
            }
            out.push_str(&escape_html(code));
            out.push_str("</code></pre>");
        }
        Block::Quote { blocks, .. } => {
            out.push_str("<blockquote>");
            render_blocks(blocks, opts, out);
            out.push_str("</blockquote>");
        }
        Block::ThematicBreak { .. } => out.push_str("<hr>"),
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            ..
        } => {
            if custom_kind == "callout" {
                let ty = attrs.get("type").and_then(|v| v.as_str()).unwrap_or("note");
                out.push_str(&format!(
                    "<div class=\"callout\" data-callout=\"{}\">",
                    escape_attr(ty)
                ));
                if let Some(title) = attrs.get("title").and_then(|v| v.as_str()) {
                    if !title.is_empty() {
                        out.push_str(&format!(
                            "<div class=\"callout-title\">{}</div>",
                            escape_html(title)
                        ));
                    }
                }
                render_blocks(blocks, opts, out);
                out.push_str("</div>");
            } else {
                out.push_str(&format!(
                    "<div class=\"block-{}\">",
                    escape_attr(custom_kind)
                ));
                render_blocks(blocks, opts, out);
                out.push_str("</div>");
            }
        }
    }
}

fn render_inlines(inlines: &[Inline], opts: &RenderOptions, out: &mut String) {
    for inline in inlines {
        render_inline(inline, opts, out);
    }
}

fn render_inline(inline: &Inline, opts: &RenderOptions, out: &mut String) {
    match inline {
        Inline::Text(s) => out.push_str(&escape_html(s)),
        Inline::Emph(children) => {
            out.push_str("<em>");
            render_inlines(children, opts, out);
            out.push_str("</em>");
        }
        Inline::Strong(children) => {
            out.push_str("<strong>");
            render_inlines(children, opts, out);
            out.push_str("</strong>");
        }
        Inline::Code(s) => {
            out.push_str("<code>");
            out.push_str(&escape_html(s));
            out.push_str("</code>");
        }
        Inline::TagRef { name, .. } => {
            out.push_str(&format!(
                "<span class=\"tag\" data-tag=\"{}\">#{}</span>",
                escape_attr(name),
                escape_html(name)
            ));
        }
        Inline::Link { target, label, .. } => render_link(target, label.as_deref(), opts, out),
        Inline::Custom { .. } => {}
    }
}

fn render_link(
    target: &LinkTarget,
    label: Option<&[Inline]>,
    opts: &RenderOptions,
    out: &mut String,
) {
    match target {
        LinkTarget::Wiki {
            page,
            heading,
            embed,
            ..
        } => {
            if *embed {
                // Transclusion: `render_html` è una funzione pura per-documento
                // e NON può leggere altri documenti (niente HostApi qui). Si
                // emette un placeholder; il frontend chiama `render_embed` del
                // kernel e innesta il contenuto (profondità e cicli a suo
                // carico). Vedi docs/architecture/ui-protocol.md.
                let heading_attr = heading
                    .as_ref()
                    .map(|h| format!(" data-embed-heading=\"{}\"", escape_attr(h)))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "<div class=\"embed\" data-embed-page=\"{}\"{}>",
                    escape_attr(page),
                    heading_attr
                ));
                render_link_label(label, page, out);
                out.push_str("</div>");
                return;
            }
            let heading_attr = heading
                .as_ref()
                .map(|h| format!(" data-wikilink-heading=\"{}\"", escape_attr(h)))
                .unwrap_or_default();
            // Wikilink come data-attribute: il frontend risolve la navigazione.
            out.push_str(&format!(
                "<a class=\"wikilink\" data-wikilink-page=\"{}\"{}",
                escape_attr(page),
                heading_attr
            ));
            if opts.wikilinks_as_data_attrs {
                out.push_str(" href=\"#\"");
            }
            out.push('>');
            render_link_label(label, page, out);
            out.push_str("</a>");
        }
        LinkTarget::Url(url) => {
            out.push_str(&format!("<a href=\"{}\">", escape_attr(url)));
            render_link_label(label, url, out);
            out.push_str("</a>");
        }
        LinkTarget::Path(p) => {
            out.push_str(&format!(
                "<a class=\"internal-path\" data-path=\"{}\" href=\"#\">",
                escape_attr(p)
            ));
            render_link_label(label, p, out);
            out.push_str("</a>");
        }
    }
}

fn render_link_label(label: Option<&[Inline]>, fallback: &str, out: &mut String) {
    match label {
        Some(inlines) if !inlines.is_empty() => {
            render_inlines(inlines, &RenderOptions::default(), out)
        }
        _ => out.push_str(&escape_html(fallback)),
    }
}
