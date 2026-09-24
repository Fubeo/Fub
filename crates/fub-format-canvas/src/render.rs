//! Anteprima/embed `.canvas`: HTML statico e inerte.
//!
//! La tela si rende come elenco di card — testo verbatim escapato, file come
//! link interni `data-path`, URL remoti come testo (mai fetch, mai iframe),
//! gruppi/edge-label come sezioni. I wikilink dentro le card testo escono con
//! gli stessi `data-wikilink-*` del markdown; gli embed `![[..]]` escono come
//! segnaposto `div.embed` che il frontend idrata via `render_embed`. Nessun
//! JavaScript, nessun iframe, nessun caricamento di asset: la shell decide.

use fub_abi::format::RenderOptions;
use fub_abi::html::{attr, escape};
use fub_abi::model::{Block, DocumentModel, Inline, LinkTarget};
use fub_abi::FormatProvider;

pub fn render_html(model: &DocumentModel, opts: &RenderOptions) -> String {
    let mut out = String::with_capacity(model.body.len() * 160);
    out.push_str("<div class=\"canvas-preview\">");
    render_blocks(&model.body, model, opts, &mut out);
    out.push_str("</div>");
    out
}

fn render_blocks(blocks: &[Block], model: &DocumentModel, opts: &RenderOptions, out: &mut String) {
    for block in blocks {
        render_block(block, model, opts, out);
    }
}

fn block_attrs(block: &Block) -> String {
    let mut attrs = match block.anchor() {
        Some(id) => attr("id", id),
        None => String::new(),
    };
    let span = block.span();
    attrs.push_str(&format!(
        " data-fub-source-start=\"{}\" data-fub-source-end=\"{}\"",
        span.start, span.end
    ));
    attrs
}

fn render_block(block: &Block, model: &DocumentModel, opts: &RenderOptions, out: &mut String) {
    let html_attrs = block_attrs(block);
    match block {
        Block::CodeBlock { lang, code, .. } => {
            let kind = lang.as_deref().unwrap_or("");
            match kind {
                "canvas-text" => {
                    out.push_str(&format!(
                        "<div class=\"canvas-card canvas-text\"{html_attrs}>"
                    ));
                    render_text_card(code, opts, out);
                    out.push_str("</div>");
                }
                "canvas-file" => {
                    out.push_str(&format!(
                        "<div class=\"canvas-card canvas-file\"{html_attrs}>"
                    ));
                    out.push_str(&format!(
                        "<a class=\"internal-path\"{} href=\"#\">{}</a>",
                        attr("data-path", code),
                        escape(code)
                    ));
                    out.push_str("</div>");
                }
                "canvas-url" => {
                    // URL remoto: testo inerte + apri-esterno via shell. Mai un
                    // fetch qui, mai un iframe: la web card è un'anteprima.
                    out.push_str(&format!(
                        "<div class=\"canvas-card canvas-url\"{html_attrs}>"
                    ));
                    out.push_str(&format!(
                        "<span class=\"canvas-url-text\"{}>{}</span>",
                        attr("data-url", code),
                        escape(code)
                    ));
                    out.push_str("</div>");
                }
                "canvas-group" => {
                    out.push_str(&format!(
                        "<section class=\"canvas-group\"{html_attrs}><h2>{}</h2></section>",
                        escape(code)
                    ));
                }
                _ => {
                    out.push_str(&format!("<pre{html_attrs}>{}</pre>", escape(code)));
                }
            }
        }
        Block::Paragraph { inlines, .. } => {
            out.push_str(&format!("<p{html_attrs}>"));
            render_inlines(inlines, opts, out);
            out.push_str("</p>");
        }
        Block::Heading { level, inlines, .. } => {
            let the = (*level).clamp(1, 6);
            out.push_str(&format!("<h{the}{html_attrs}>"));
            render_inlines(inlines, opts, out);
            out.push_str(&format!("</h{the}>"));
        }
        _ => {
            // La tela genera solo CodeBlock/Paragraph/Heading: altro = degrado
            // generico che non perde i byte.
            out.push_str(&format!("<div class=\"canvas-unknown\"{html_attrs}>"));
            out.push_str(&escape(&format!("{:?}", block)));
            out.push_str("</div>");
        }
    }
    let _ = model;
}

/// Card testo: si riusa la resa markdown reale sul decodificato, come il parse.
/// Niente scanner locale: codice fenced/inline e link markdown valgono come nel
/// markdown, e il fallback non inventa link dove il markdown non ne vede.
fn render_text_card(code: &str, opts: &RenderOptions, out: &mut String) {
    use fub_abi::format::{DocumentSource, ParseContext};
    use fub_abi::model::{DocId, DocumentModel};
    let provider = fub_format_markdown::MarkdownProvider::new();
    let model = provider
        .parse(
            &DocumentSource::Text(code.to_string()),
            &ParseContext::obsidian("canvas-card"),
        )
        .unwrap_or_else(|_| DocumentModel::empty(DocId::new("canvas-card")));
    out.push_str(
        &provider
            .render_html(&model, opts)
            .unwrap_or_else(|_| escape(code)),
    );
}

fn render_inlines(inlines: &[Inline], opts: &RenderOptions, out: &mut String) {
    for inline in inlines {
        match inline {
            Inline::Text(s) => out.push_str(&escape(s)),
            Inline::Link {
                target,
                label,
                embed,
                ..
            } => render_model_link(target, label.as_deref(), *embed, opts, out),
            Inline::TagRef { name, .. } => {
                out.push_str(&format!(
                    "<span class=\"tag\"{}>#{}</span>",
                    attr("data-tag", name),
                    escape(name)
                ));
            }
            _ => {}
        }
    }
}

fn render_model_link(
    target: &LinkTarget,
    label: Option<&[Inline]>,
    embed: bool,
    opts: &RenderOptions,
    out: &mut String,
) {
    let fallback = match target {
        LinkTarget::Wiki { page, .. } => page.clone(),
        LinkTarget::Path(p) => p.clone(),
        LinkTarget::Url(u) => u.clone(),
    };
    match target {
        LinkTarget::Wiki {
            page,
            heading,
            block,
        } => {
            if embed {
                out.push_str("<div class=\"embed\"");
                out.push_str(&attr("data-embed-page", page));
                if let Some(h) = heading {
                    out.push_str(&attr("data-embed-heading", h));
                }
                if let Some(b) = block {
                    out.push_str(&attr("data-embed-block", b));
                }
                out.push('>');
                render_label(label, &fallback, opts, out);
                out.push_str("</div>");
                return;
            }
            out.push_str("<a class=\"wikilink\"");
            out.push_str(&attr("data-wikilink-page", page));
            if let Some(h) = heading {
                out.push_str(&attr("data-wikilink-heading", h));
            }
            if let Some(b) = block {
                out.push_str(&attr("data-wikilink-block", b));
            }
            out.push_str(" href=\"#\">");
            render_label(label, &fallback, opts, out);
            out.push_str("</a>");
        }
        LinkTarget::Path(p) if embed => {
            out.push_str(&format!(
                "<div class=\"embed\"{}>",
                attr("data-embed-path", p)
            ));
            render_label(label, p, opts, out);
            out.push_str("</div>");
        }
        LinkTarget::Path(p) => {
            out.push_str(&format!(
                "<a class=\"internal-path\"{} href=\"#\">",
                attr("data-path", p)
            ));
            render_label(label, p, opts, out);
            out.push_str("</a>");
        }
        LinkTarget::Url(url) if embed => {
            out.push_str(&format!(
                "<div class=\"embed\"{}>",
                attr("data-embed-url", url)
            ));
            render_label(label, url, opts, out);
            out.push_str("</div>");
        }
        LinkTarget::Url(url) => {
            out.push_str(&format!("<a{}>", attr("href", url)));
            render_label(label, url, opts, out);
            out.push_str("</a>");
        }
    }
}

fn render_label(label: Option<&[Inline]>, fallback: &str, opts: &RenderOptions, out: &mut String) {
    match label {
        Some(inlines) if !inlines.is_empty() => render_inlines(inlines, opts, out),
        _ => out.push_str(&escape(fallback)),
    }
}
