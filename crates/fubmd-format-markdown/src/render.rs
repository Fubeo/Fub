//! Rendering HTML **dal modello comune** (non dalla sorgente): così il render
//! è una funzione pura del `DocumentModel`, esattamente come vuole il trait, e
//! la navigazione dei wikilink passa per data-attribute che il frontend risolve.

use fubmd_abi::format::RenderOptions;
use fubmd_abi::model::{
    custom_kind, Block, ColumnAlign, DocumentModel, Inline, LinkTarget, TableRow,
};

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

/// L'attributo con cui un blocco diventa **indirizzabile** nella pagina: è la
/// resa dell'ancora del modello, e senza di essa un link a blocco arriverebbe
/// al documento giusto senza avere dove atterrare.
fn anchor_attr(block: &Block) -> String {
    match block.anchor() {
        Some(id) => format!(" id=\"{}\"", escape_attr(id)),
        None => String::new(),
    }
}

fn render_block(block: &Block, opts: &RenderOptions, out: &mut String) {
    let id = anchor_attr(block);
    match block {
        Block::Heading { level, inlines, .. } => {
            let l = (*level).clamp(1, 6);
            out.push_str(&format!("<h{l}{id}>"));
            render_inlines(inlines, opts, out);
            out.push_str(&format!("</h{l}>"));
        }
        Block::Paragraph { inlines, .. } => {
            out.push_str(&format!("<p{id}>"));
            render_inlines(inlines, opts, out);
            out.push_str("</p>");
        }
        Block::List { ordered, items, .. } => {
            let tag = if *ordered { "ol" } else { "ul" };
            out.push_str(&format!("<{tag}{id}>"));
            for item in items {
                match &item.task {
                    Some(t) => {
                        // La casella è **disabilitata**: spuntare da anteprima è
                        // una scrittura sul documento, e passa da un'azione del
                        // protocollo, non da uno stato del DOM che nessuno legge.
                        let checked = if t.checked() { " checked" } else { "" };
                        let symbol = t.symbol.map(String::from).unwrap_or_default();
                        out.push_str(&format!(
                            "<li class=\"task\" data-task=\"{}\"><input type=\"checkbox\" disabled{checked}>",
                            escape_attr(&symbol)
                        ));
                    }
                    None => out.push_str("<li>"),
                }
                render_blocks(&item.blocks, opts, out);
                out.push_str("</li>");
            }
            out.push_str(&format!("</{tag}>"));
        }
        Block::Table {
            head, rows, align, ..
        } => {
            out.push_str(&format!("<table{id}>"));
            if let Some(h) = head {
                out.push_str("<thead>");
                render_row(h, align, true, opts, out);
                out.push_str("</thead>");
            }
            out.push_str("<tbody>");
            for r in rows {
                render_row(r, align, false, opts, out);
            }
            out.push_str("</tbody></table>");
        }
        Block::CodeBlock { lang, code, .. } => {
            match lang {
                Some(l) => out.push_str(&format!(
                    "<pre{id}><code class=\"language-{}\">",
                    escape_attr(l)
                )),
                None => out.push_str(&format!("<pre{id}><code>")),
            }
            out.push_str(&escape_html(code));
            out.push_str("</code></pre>");
        }
        Block::Quote { blocks, .. } => {
            out.push_str(&format!("<blockquote{id}>"));
            render_blocks(blocks, opts, out);
            out.push_str("</blockquote>");
        }
        Block::ThematicBreak { .. } => out.push_str(&format!("<hr{id}>")),
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            ..
        } => {
            if custom_kind == custom_kind::CALLOUT {
                let ty = attrs.get("type").and_then(|v| v.as_str()).unwrap_or("note");
                out.push_str(&format!(
                    "<div{id} class=\"callout\" data-callout=\"{}\">",
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
                // Ogni altro kind — registrato o no — degrada a resa generica,
                // col suo `custom_kind` come classe. L'HTML grezzo di
                // `custom_kind::HTML` resta **dato** e non torna markup: la
                // decisione su cosa sia lecito eseguire è della sanitizzazione
                // (5.3), non del provider che ha letto il file.
                let label = attrs
                    .get("label")
                    .and_then(|v| v.as_str())
                    .map(|l| format!(" data-label=\"{}\"", escape_attr(l)))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "<div{id} class=\"block-{}\"{label}>",
                    escape_attr(custom_kind)
                ));
                render_blocks(blocks, opts, out);
                out.push_str("</div>");
            }
        }
    }
}

fn render_row(
    row: &TableRow,
    align: &[ColumnAlign],
    header: bool,
    opts: &RenderOptions,
    out: &mut String,
) {
    out.push_str("<tr>");
    for (i, cell) in row.cells.iter().enumerate() {
        let tag = if header { "th" } else { "td" };
        let style = match align.get(i).copied().unwrap_or(ColumnAlign::None) {
            ColumnAlign::None => String::new(),
            ColumnAlign::Left => " style=\"text-align:left\"".into(),
            ColumnAlign::Center => " style=\"text-align:center\"".into(),
            ColumnAlign::Right => " style=\"text-align:right\"".into(),
        };
        out.push_str(&format!("<{tag}{style}>"));
        render_inlines(&cell.inlines, opts, out);
        out.push_str(&format!("</{tag}>"));
    }
    out.push_str("</tr>");
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
        Inline::Link {
            target,
            label,
            embed,
            ..
        } => render_link(target, label.as_deref(), *embed, opts, out),
        Inline::Custom {
            custom_kind, attrs, ..
        } if custom_kind == custom_kind::FOOTNOTE_REFERENCE => {
            let label = attrs.get("label").and_then(|v| v.as_str()).unwrap_or("");
            out.push_str(&format!(
                "<sup class=\"footnote-ref\" data-label=\"{}\">{}</sup>",
                escape_attr(label),
                escape_html(label)
            ));
        }
        Inline::Custom { .. } => {}
    }
}

fn render_link(
    target: &LinkTarget,
    label: Option<&[Inline]>,
    embed: bool,
    opts: &RenderOptions,
    out: &mut String,
) {
    match target {
        LinkTarget::Wiki { page, heading, .. } => {
            if embed {
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
        // Un riferimento incorporato che non è un wikilink è, quasi sempre,
        // un'immagine. Anche qui si emette il **segnaposto** del protocollo di
        // transclusion e non un `<img>`: caricare una risorsa — del vault o
        // peggio remota — è una decisione della shell (13.1 per gli allegati,
        // 5.3 e 23 per il contenuto remoto), non del provider che ha letto il
        // file. Chi disegna sa dove sta il vault; questo codice no.
        LinkTarget::Url(url) if embed => {
            out.push_str(&format!(
                "<div class=\"embed\" data-embed-url=\"{}\">",
                escape_attr(url)
            ));
            render_link_label(label, url, out);
            out.push_str("</div>");
        }
        LinkTarget::Path(p) if embed => {
            out.push_str(&format!(
                "<div class=\"embed\" data-embed-path=\"{}\">",
                escape_attr(p)
            ));
            render_link_label(label, p, out);
            out.push_str("</div>");
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
