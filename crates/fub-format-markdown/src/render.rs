//! Rendering HTML **dal modello comune** (non dalla sorgente): così il render
//! è una funzione pura del `DocumentModel`, esattamente come vuole il trait, e
//! la navigazione dei wikilink passa per data-attribute che il frontend risolve.

use fub_abi::format::RenderOptions;
use fub_abi::model::{
    custom_kind, Block, ColumnAlign, DocumentModel, Inline, LinkTarget, TableRow,
};
use fub_abi::options::render_option;

use fub_abi::html::{attr, escape};

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
        Some(id) => attr("id", id),
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
                            "<li class=\"task\"{}><input type=\"checkbox\" disabled{checked}>",
                            attr("data-task", &symbol)
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
                    "<pre{id}><code{}>",
                    attr("class", &format!("language-{l}"))
                )),
                None => out.push_str(&format!("<pre{id}><code>")),
            }
            out.push_str(&escape(code));
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
                    "<div{id} class=\"callout\"{}>",
                    attr("data-callout", ty)
                ));
                if let Some(title) = attrs.get("title").and_then(|v| v.as_str()) {
                    if !title.is_empty() {
                        out.push_str(&format!(
                            "<div class=\"callout-title\">{}</div>",
                            escape(title)
                        ));
                    }
                }
                render_blocks(blocks, opts, out);
                out.push_str("</div>");
            } else if custom_kind == custom_kind::FRONTMATTER_UNPARSED {
                // Il degrado generico qui non basterebbe: questo blocco non ha
                // figli, e un `<div>` vuoto è di nuovo la sparizione muta —
                // l'utente ha sbagliato una virgola nelle proprietà e vedrebbe
                // le proprietà svanire senza un avviso. Il testo resta **dato**
                // (escapato), e il motivo si legge accanto.
                let motivo = attrs.get("error").and_then(|v| v.as_str()).unwrap_or("");
                let text = attrs.get("text").and_then(|v| v.as_str()).unwrap_or("");
                out.push_str(&format!(
                    "<div{id} class=\"block-frontmatter-unparsed\">\
                     <div class=\"frontmatter-error\">{}</div><pre>{}</pre></div>",
                    escape(motivo),
                    escape(text)
                ));
            } else {
                // Ogni altro kind — registrato o no — degrada a resa generica,
                // col suo `custom_kind` come classe. L'HTML grezzo di
                // `custom_kind::HTML` resta **dato** e non torna markup: la
                // decisione su cosa sia lecito eseguire è della sanitizzazione
                // (5.3), non del provider che ha letto il file.
                let label = attrs
                    .get("label")
                    .and_then(|v| v.as_str())
                    .map(|l| attr("data-label", l))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "<div{id}{}{label}>",
                    attr("class", &format!("block-{custom_kind}"))
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
        Inline::Text(s) => out.push_str(&escape(s)),
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
            out.push_str(&escape(s));
            out.push_str("</code>");
        }
        Inline::TagRef { name, .. } => {
            out.push_str(&format!(
                "<span class=\"tag\"{}>#{}</span>",
                attr("data-tag", name),
                escape(name)
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
                "<sup class=\"footnote-ref\"{}>{}</sup>",
                attr("data-label", label),
                escape(label)
            ));
        }
        // Il degrado generico degli inline. **Prima non c'era**: un
        // `Inline::Custom` che il provider non riconosceva spariva dalla
        // resa, in silenzio — ed era il gemello inline del difetto che il
        // §3.2 nomina sui blocchi, con l'aggravante che qui non restava
        // nemmeno il testo. Un kind che porta il proprio `text` (è la forma
        // che una `SyntaxRule` inline produce) lo mostra dentro uno span con
        // la sua classe: chi ha un tema lo veste, chi non ce l'ha lo legge.
        Inline::Custom {
            custom_kind, attrs, ..
        } => {
            let text = attrs.get("text").and_then(|v| v.as_str()).unwrap_or("");
            out.push_str(&format!(
                "<span{}>{}</span>",
                attr("class", &format!("inline-{}", class_of(custom_kind))),
                escape(text)
            ));
        }
    }
}

/// La classe CSS di un `custom_kind`: il nome senza il namespace, perché il
/// namespace serve a evitare le collisioni fra estensioni, non a finire in un
/// selettore. Due estensioni omonime restano distinguibili dal `data-kind` che
/// il blocco porta; una classe è per il tema.
fn class_of(custom_kind: &str) -> String {
    custom_kind
        .rsplit_once(':')
        .map(|(_, name)| name)
        .unwrap_or(custom_kind)
        .to_string()
}

/// Le coordinate di un wikilink come data-attribute, col prefisso di chi le
/// riceve: `data-wikilink-*` per un riferimento, `data-embed-*` per il
/// segnaposto di una transclusion.
///
/// **Sta in una funzione sola perché i due rami scrivevano due elenchi diversi
/// della stessa cosa.** Il link portava pagina, heading *e* blocco — glielo ha
/// dato la 0049 — l'embed solo pagina e heading: `![[Nota#^b]]` arrivava alla
/// shell senza l'ancora, cioè come un embed della nota intera, e a dirlo non
/// c'era niente perché il campo che mancava non è un campo che manchi al
/// compilatore. Un quinto campo di [`LinkTarget::Wiki`] adesso si scrive qui e
/// lo ereditano tutti e due.
///
/// Un campo assente **non si scrive**: un `data-embed-heading=""` non dice «non
/// c'è heading», dice «l'heading è quello che si chiama nulla», e chi legge
/// l'attributo con un `?? null` riceve la stringa vuota.
fn wiki_attrs(
    prefisso: &str,
    page: &str,
    heading: &Option<String>,
    block: &Option<String>,
) -> String {
    let mut out = attr(&format!("data-{prefisso}-page"), page);
    if let Some(h) = heading {
        out.push_str(&attr(&format!("data-{prefisso}-heading"), h));
    }
    if let Some(b) = block {
        out.push_str(&attr(&format!("data-{prefisso}-block"), b));
    }
    out
}

fn render_link(
    target: &LinkTarget,
    label: Option<&[Inline]>,
    embed: bool,
    opts: &RenderOptions,
    out: &mut String,
) {
    match target {
        LinkTarget::Wiki {
            page,
            heading,
            block,
        } => {
            if embed {
                // Transclusion: `render_html` è una funzione pura per-documento
                // e NON può leggere altri documenti (niente HostApi qui). Si
                // emette un placeholder; il frontend chiama `render_embed` del
                // kernel e innesta il contenuto (profondità e cicli a suo
                // carico). Vedi docs/architecture/ui-protocol.md.
                out.push_str(&format!(
                    "<div class=\"embed\"{}>",
                    wiki_attrs("embed", page, heading, block)
                ));
                render_link_label(label, page, out);
                out.push_str("</div>");
                return;
            }
            // Le stesse tre coordinate, con l'altro prefisso: il **blocco** il
            // parser lo legge dalla 0003, e fino alla 0049 si fermava qui —
            // `[[Nota#^blocco]]` arrivava alla shell come un link alla nota e
            // basta. Adesso c'è una risposta in cui metterlo
            // (`resolved-ref.at`), e questo è il primo centimetro del giro.
            // Wikilink come data-attribute: il frontend risolve la navigazione.
            out.push_str(&format!(
                "<a class=\"wikilink\"{}",
                wiki_attrs("wikilink", page, heading, block)
            ));
            if opts.enabled(render_option::WIKILINKS_AS_DATA_ATTRS) {
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
                "<div class=\"embed\"{}>",
                attr("data-embed-url", url)
            ));
            render_link_label(label, url, out);
            out.push_str("</div>");
        }
        LinkTarget::Path(p) if embed => {
            out.push_str(&format!(
                "<div class=\"embed\"{}>",
                attr("data-embed-path", p)
            ));
            render_link_label(label, p, out);
            out.push_str("</div>");
        }
        LinkTarget::Url(url) => {
            out.push_str(&format!("<a{}>", attr("href", url)));
            render_link_label(label, url, out);
            out.push_str("</a>");
        }
        LinkTarget::Path(p) => {
            out.push_str(&format!(
                "<a class=\"internal-path\"{} href=\"#\">",
                attr("data-path", p)
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
        _ => out.push_str(&escape(fallback)),
    }
}
