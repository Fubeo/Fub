//! Rendering HTML **dal modello comune** (non dalla sorgente): così il render
//! è una funzione pura del `DocumentModel`, esattamente come vuole il trait, e
//! la navigazione dei wikilink passa per data-attribute che il frontend risolve.

use fub_abi::format::RenderOptions;
use fub_abi::model::{
    custom_kind, Block, ColumnAlign, DocumentModel, Inline, LinkTarget, TableRow,
};
use fub_abi::rules::loads;

use fub_abi::html::{attr, escape};
use std::fmt::Write;

pub fn render_html(model: &DocumentModel, opts: &RenderOptions) -> String {
    // La capacità si stima dal corpo: il numero di blocchi per una media
    // grezza di byte resi. Non tocca i byte, solo le riallocazioni.
    let mut out = String::with_capacity(model.body.len() * 128);
    render_top_blocks(&model.body, opts, &mut out);
    out
}

/// I blocchi di primo livello, coi ripiegabili (K2): un `<details>` accoppiato
/// alla sua chiusura avvolge i blocchi fra loro, come in Lettura
/// (`pairDetails` in `details.ts`). Un'apertura senza chiusura resta HTML.
fn render_top_blocks(blocks: &[Block], opts: &RenderOptions, out: &mut String) {
    let roles = details_roles(blocks);
    let mut toc: Option<Vec<TocEntry>> = None;
    for (block, role) in blocks.iter().zip(roles) {
        // L'indice (K4): un recinto `toc` diventa i titoli della nota, come
        // in Lettura (`toc.ts`).
        if let Block::CodeBlock {
            lang: Some(lang),
            code,
            ..
        } = block
        {
            if lang.eq_ignore_ascii_case("toc") {
                let entries = toc.get_or_insert_with(|| toc_entries(blocks));
                render_toc(block, code, entries, out);
                continue;
            }
        }
        match role {
            Some(DetailsRole::Open { open, summary }) => write!(
                out,
                "<details class=\"fub-details\"{}{}><summary>{}</summary>",
                block_attrs(block),
                if open { " open" } else { "" },
                escape(summary.unwrap_or_default())
            )
            .unwrap(),
            Some(DetailsRole::Close) => out.push_str("</details>"),
            None => render_block(block, opts, out),
        }
    }
}

/// Un titolo per l'indice: il livello, il testo, l'id che la resa gli dà.
struct TocEntry {
    level: u8,
    text: String,
    id: String,
}

/// I titoli della nota in ordine, anche quelli dentro citazioni ed elenchi.
fn toc_entries(blocks: &[Block]) -> Vec<TocEntry> {
    fn walk(blocks: &[Block], out: &mut Vec<TocEntry>) {
        for block in blocks {
            match block {
                Block::Heading {
                    level,
                    inlines,
                    anchor: Some(id),
                    ..
                } if !id.is_empty() => {
                    let mut text = String::new();
                    plain_text(inlines, &mut text);
                    out.push(TocEntry {
                        level: (*level).clamp(1, 6),
                        text: text.trim().to_owned(),
                        id: id.clone(),
                    });
                }
                Block::Quote { blocks, .. } => walk(blocks, out),
                Block::List { items, .. } => {
                    for item in items {
                        walk(&item.blocks, out);
                    }
                }
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(blocks, &mut out);
    out
}

/// I livelli che il recinto chiede con `livelli: a-b` (o `levels:`); tutti
/// se non lo dice.
fn toc_levels(code: &str) -> (u8, u8) {
    for line in code.lines() {
        let line = line.trim();
        let Some(rest) = strip_ci(line, "livelli").or_else(|| strip_ci(line, "levels")) else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix(':') else {
            continue;
        };
        let level = |text: &str| match text.trim().parse::<u8>() {
            Ok(n @ 1..=6) => Some(n),
            _ => None,
        };
        let parsed = match rest.split_once('-') {
            Some((a, b)) => level(a).zip(level(b)),
            None => level(rest).map(|n| (n, n)),
        };
        if let Some((a, b)) = parsed {
            return (a.min(b), a.max(b));
        }
    }
    (1, 6)
}

fn render_toc(block: &Block, code: &str, entries: &[TocEntry], out: &mut String) {
    let (from, to) = toc_levels(code);
    let shown: Vec<&TocEntry> = entries
        .iter()
        .filter(|entry| entry.level >= from && entry.level <= to)
        .collect();
    let Some(top) = shown.iter().map(|entry| entry.level).min() else {
        write!(
            out,
            "<div class=\"fub-toc\" data-empty=\"true\"{}></div>",
            block_attrs(block)
        )
        .unwrap();
        return;
    };
    write!(out, "<div class=\"fub-toc\"{}><ul>", block_attrs(block)).unwrap();
    for entry in shown {
        write!(
            out,
            "<li class=\"fub-toc-item\" data-depth=\"{}\"><a{}>{}</a></li>",
            entry.level - top,
            attr("href", &format!("#{}", entry.id)),
            escape(&entry.text)
        )
        .unwrap();
    }
    out.push_str("</ul></div>");
}

#[derive(Clone, Copy)]
enum DetailsRole<'a> {
    Open {
        open: bool,
        summary: Option<&'a str>,
    },
    Close,
}

fn html_block(block: &Block) -> Option<&str> {
    match block {
        Block::Custom {
            custom_kind, attrs, ..
        } if custom_kind == custom_kind::HTML => attrs.get("html")?.as_str(),
        _ => None,
    }
}

/// Chi apre e chi chiude, accoppiati dall'interno; il resto non ha ruolo.
fn details_roles(blocks: &[Block]) -> Vec<Option<DetailsRole<'_>>> {
    let mut roles = vec![None; blocks.len()];
    let mut stack: Vec<(usize, DetailsRole<'_>)> = Vec::new();
    for (at, block) in blocks.iter().enumerate() {
        let Some(html) = html_block(block) else {
            continue;
        };
        if let Some((open, summary)) = details_head(html) {
            stack.push((at, DetailsRole::Open { open, summary }));
        } else if is_details_close(html) {
            if let Some((opened, role)) = stack.pop() {
                roles[opened] = Some(role);
                roles[at] = Some(DetailsRole::Close);
            }
        }
    }
    roles
}

/// Gli spazi e le tabulazioni in testa.
fn blank(text: &str) -> &str {
    text.trim_start_matches([' ', '\t'])
}

/// Il prefisso `prefix`, senza badare alle maiuscole.
fn strip_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

/// Fino a tre spazi o tabulazioni di rientro, come un blocco HTML.
fn strip_indent(text: &str) -> Option<&str> {
    let rest = blank(text);
    (text.len() - rest.len() <= 3).then_some(rest)
}

/// L'apertura di un ripiegabile: `<details>` o `<details open>`, poi
/// facoltativo `<summary>testo</summary>` sulla stessa riga o sulla seguente,
/// e nient'altro. È `HEAD` di `details.ts`.
fn details_head(html: &str) -> Option<(bool, Option<&str>)> {
    let text = strip_indent(html.trim_end_matches(['\n', '\r']))?;
    let rest = strip_ci(text, "<details")?;
    let (open, rest) = match strip_ci(blank(rest), "open") {
        Some(after) if blank(rest).len() < rest.len() => match blank(after).strip_prefix('=') {
            Some(value) => {
                let value = blank(value);
                let rest = ["\"\"", "''", "\"open\"", "'open'"]
                    .iter()
                    .find_map(|quoted| strip_ci(value, quoted))?;
                (true, rest)
            }
            None => (true, after),
        },
        _ => (false, rest),
    };
    let rest = blank(blank(rest).strip_prefix('>')?);
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))
        .map(blank)
        .unwrap_or(rest);
    if rest.is_empty() {
        return Some((open, None));
    }
    let inner = strip_ci(rest, "<summary>")?;
    let end = inner.find(['<', '\n', '\r'])?;
    let (summary, tail) = inner.split_at(end);
    blank(strip_ci(tail, "</summary>")?)
        .is_empty()
        .then_some((open, Some(summary)))
}

/// La chiusura `</details>`, da sola.
fn is_details_close(html: &str) -> bool {
    strip_indent(html.trim_end_matches(['\n', '\r']))
        .and_then(|rest| strip_ci(rest, "</details"))
        .and_then(|rest| blank(rest).strip_prefix('>'))
        .is_some_and(|rest| blank(rest).is_empty())
}

fn render_blocks(blocks: &[Block], opts: &RenderOptions, out: &mut String) {
    for block in blocks {
        render_block(block, opts, out);
    }
}

/// Gli attributi comuni della radice HTML di un blocco. L'ancora la rende
/// indirizzabile; lo span conserva il collegamento con i byte UTF-8 della
/// sorgente anche quando il markup Markdown non ha una controparte visibile.
fn block_attrs(block: &Block) -> String {
    let mut attrs = match block.anchor() {
        Some(id) => attr("id", id),
        None => String::new(),
    };
    let span = block.span();
    write!(
        attrs,
        " data-fub-source-start=\"{}\" data-fub-source-end=\"{}\"",
        span.start, span.end
    )
    .unwrap();
    attrs
}

fn render_block(block: &Block, opts: &RenderOptions, out: &mut String) {
    // Non confondere gli attributi HTML con il payload JSON di Block::Custom.
    let html_attrs = block_attrs(block);
    match block {
        Block::Heading { level, inlines, .. } => {
            let the = (*level).clamp(1, 6);
            write!(out, "<h{the}{html_attrs}>").unwrap();
            render_inlines(inlines, opts, out);
            write!(out, "</h{the}>").unwrap();
        }
        Block::Paragraph { inlines, .. } => {
            // Un paragrafo che è soltanto una formula `$$…$$` è un blocco: la
            // stessa radice del recinto `math`, che la resa compone a display.
            if let Some(source) = display_math(inlines) {
                write!(
                    out,
                    "<div{html_attrs} class=\"math-block\"{}>{}</div>",
                    attr("data-tex", source.trim()),
                    escape(source.trim())
                )
                .unwrap();
            } else if let Some(caption) = lone_image_caption(inlines) {
                // Un'immagine da sola nel paragrafo è una figura, con la
                // didascalia dal testo alternativo, come in Lettura (K10).
                write!(out, "<figure{html_attrs}>").unwrap();
                render_inlines(inlines, opts, out);
                write!(
                    out,
                    "<figcaption>{}</figcaption></figure>",
                    escape(&caption)
                )
                .unwrap();
            } else {
                write!(out, "<p{html_attrs}>").unwrap();
                render_inlines(inlines, opts, out);
                out.push_str("</p>");
            }
        }
        Block::List {
            ordered,
            items,
            start,
            ..
        } => {
            let tag = if *ordered { "ol" } else { "ul" };
            // `<ol start>` è il campo `start` del modello: senza, una lista che
            // nel file comincia da 3 si legge da 1 in anteprima, cioè il testo
            // e ciò che se ne vede dicono due cose diverse.
            let from = match start {
                Some(n) if *ordered && *n != 1 => format!(" start=\"{n}\""),
                _ => String::new(),
            };
            write!(out, "<{tag}{html_attrs}{from}>").unwrap();
            for item in items {
                match &item.task {
                    Some(t) => {
                        // La casella è **disabilitata**: spuntare da anteprima è
                        // una scrittura sul documento, e passa da un'azione del
                        // protocollo, non da uno stato del DOM che nessuno legge.
                        let checked = if t.checked() { " checked" } else { "" };
                        let symbol = t.symbol.map(String::from).unwrap_or_default();
                        write!(
                            out,
                            "<li class=\"task\"{}><input type=\"checkbox\" disabled{checked}>",
                            attr("data-task", &symbol)
                        )
                        .unwrap();
                    }
                    None => out.push_str("<li>"),
                }
                render_blocks(&item.blocks, opts, out);
                out.push_str("</li>");
            }
            write!(out, "</{tag}>").unwrap();
        }
        Block::Table {
            head, rows, align, ..
        } => {
            write!(out, "<table{html_attrs}>").unwrap();
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
                Some(the) => write!(
                    out,
                    "<pre{html_attrs}><code{}>",
                    attr("class", &format!("language-{the}"))
                )
                .unwrap(),
                None => write!(out, "<pre{html_attrs}><code>").unwrap(),
            }
            out.push_str(&escape(code));
            out.push_str("</code></pre>");
        }
        Block::Quote { blocks, .. } => {
            write!(out, "<blockquote{html_attrs}>").unwrap();
            render_blocks(blocks, opts, out);
            out.push_str("</blockquote>");
        }
        Block::ThematicBreak { .. } => write!(out, "<hr{html_attrs}>").unwrap(),
        Block::ReferenceDefinition {
            label, url, title, ..
        } => {
            // La resa è **visibile** come quella del frontmatter illeggibile:
            // una definizione è metadata, non prosa, ma un `<div>` vuoto
            // sarebbe la sparizione muta di una riga che l'utente ha scritto.
            // Non è un link (`<a>`) e non ha semantica di paragrafo: è un
            // contenitore con l'etichetta come attributo, e il titolo accanto
            // alla destinazione, entrambi escapati — dati, non markup.
            let title = title
                .as_deref()
                .map(|t| format!(" {}", escape(t)))
                .unwrap_or_default();
            write!(
                out,
                "<div{html_attrs} class=\"reference-definition\"{}>{}{}</div>",
                attr("data-label", label),
                escape(url),
                title
            )
            .unwrap();
        }
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            ..
        } => {
            if custom_kind == custom_kind::FOOTNOTE_DEFINITION
                && attrs.get("unreferenced").and_then(|v| v.as_bool()) == Some(true)
            {
                // Una nota che nessuno richiama non ha un posto nella resa:
                // comrak la toglieva, e il modello la porta solo perché sta
                // nel file.
            } else if custom_kind == custom_kind::CALLOUT {
                let ty = attrs.get("type").and_then(|v| v.as_str()).unwrap_or("note");
                write!(
                    out,
                    "<div{html_attrs} class=\"callout\"{}>",
                    attr("data-callout", ty)
                )
                .unwrap();
                if let Some(title) = attrs.get("title").and_then(|v| v.as_str()) {
                    if !title.is_empty() {
                        write!(out, "<div class=\"callout-title\">{}</div>", escape(title))
                            .unwrap();
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
                let reason = attrs.get("error").and_then(|v| v.as_str()).unwrap_or("");
                let text = attrs.get("text").and_then(|v| v.as_str()).unwrap_or("");
                write!(
                    out,
                    "<div{html_attrs} class=\"block-frontmatter-unparsed\">\
                     <div class=\"frontmatter-error\">{}</div><pre>{}</pre></div>",
                    escape(reason),
                    escape(text)
                )
                .unwrap();
            } else {
                // Ogni altro kind — registrato o no — degrada a resa generica,
                // col suo `custom_kind` come classe. L'HTML grezzo di
                // `custom_kind::HTML` resta **dato** e non torna markup: la
                // decisione su cosa sia lecito eseguire è della sanitizzazione
                // (5.3), non del provider che ha letto il file.
                let label = attrs
                    .get("label")
                    .and_then(|v| v.as_str())
                    .map(|the| attr("data-label", the))
                    .unwrap_or_default();
                write!(
                    out,
                    "<div{html_attrs}{}{label}>",
                    attr("class", &css_class("block", custom_kind))
                )
                .unwrap();
                // Un blocco **senza figli** non ha niente da rendere per questa
                // strada, e finiva in un `<div>` vuoto: la frase qui sopra
                // diceva che l'HTML grezzo «resta dato», e invece non restava
                // affatto. Il contenuto di questi kind sta negli `attrs` — è la
                // forma che `parse.rs` dà a un `NodeValue::HtmlBlock`, ed è
                // quella che una `SyntaxRule` produce — quindi va letto di lì.
                if blocks.is_empty() {
                    out.push_str(&escape(
                        text_content(custom_kind, attrs).unwrap_or_default(),
                    ));
                } else {
                    render_blocks(blocks, opts, out);
                }
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
    for (the, cell) in row.cells.iter().enumerate() {
        let tag = if header { "th" } else { "td" };
        let style = match align.get(the).copied().unwrap_or(ColumnAlign::None) {
            ColumnAlign::None => String::new(),
            ColumnAlign::Left => " style=\"text-align:left\"".into(),
            ColumnAlign::Center => " style=\"text-align:center\"".into(),
            ColumnAlign::Right => " style=\"text-align:right\"".into(),
        };
        write!(out, "<{tag}{style}>").unwrap();
        render_inlines(&cell.inlines, opts, out);
        write!(out, "</{tag}>").unwrap();
    }
    out.push_str("</tr>");
}

/// Il sorgente della formula `$$…$$` che è **tutto** il paragrafo, spazi e
/// a-capo a parte.
fn display_math(inlines: &[Inline]) -> Option<&str> {
    let mut found = None;
    for inline in inlines {
        match inline {
            Inline::Custom {
                custom_kind, attrs, ..
            } if custom_kind == custom_kind::MATH
                && found.is_none()
                && attrs.get("display").and_then(|v| v.as_bool()) == Some(true) =>
            {
                found = attrs.get("source").and_then(|v| v.as_str());
            }
            Inline::Text(text) if text.trim().is_empty() => {}
            Inline::SoftBreak | Inline::HardBreak => {}
            _ => return None,
        }
    }
    found
}

/// La didascalia di un paragrafo fatto soltanto di un'immagine `![alt](x)`:
/// il testo alternativo senza la dimensione (`alt|320`). Senza testo
/// alternativo non c'è didascalia, e il paragrafo resta un paragrafo.
fn lone_image_caption(inlines: &[Inline]) -> Option<String> {
    let mut found = None;
    for inline in inlines {
        match inline {
            Inline::Link {
                target: LinkTarget::Path(_) | LinkTarget::Url(_),
                label,
                embed: true,
                ..
            } if found.is_none() => {
                let mut text = String::new();
                plain_text(label.as_deref().unwrap_or_default(), &mut text);
                found = Some(text);
            }
            Inline::Text(text) if text.trim().is_empty() => {}
            _ => return None,
        }
    }
    let text = found?;
    let alt = match text.rsplit_once('|') {
        Some((alt, size)) if is_size(size) => alt,
        _ => text.as_str(),
    };
    let alt = alt.trim();
    (!alt.is_empty()).then(|| alt.to_owned())
}

/// `320` o `320x200`: la dimensione dopo la barra del testo alternativo.
fn is_size(text: &str) -> bool {
    let mut parts = text.splitn(2, 'x');
    let number = |part: &str| {
        (1..=5).contains(&part.len())
            && part.bytes().all(|b| b.is_ascii_digit())
            && !part.starts_with('0')
    };
    parts.next().is_some_and(number) && parts.next().is_none_or(number)
}

fn plain_text(inlines: &[Inline], out: &mut String) {
    for inline in inlines {
        match inline {
            Inline::Text(text) | Inline::Code(text) => out.push_str(text),
            Inline::SoftBreak | Inline::HardBreak => out.push(' '),
            Inline::Emph(children)
            | Inline::Strong(children)
            | Inline::Strikethrough(children)
            | Inline::Superscript(children)
            | Inline::Subscript(children) => plain_text(children, out),
            _ => {}
        }
    }
}

fn render_inlines(inlines: &[Inline], opts: &RenderOptions, out: &mut String) {
    for (at, inline) in inlines.iter().enumerate() {
        match paired_html(inlines, at) {
            Some(tag) => out.push_str(&tag),
            None => render_inline(inline, opts, out),
        }
    }
}

/// I tag HTML in riga che la resa ricostruisce: quelli di testo, nudi, senza
/// attributi. È lo stesso vocabolario chiuso di `INLINE_HTML` in
/// `render-inline.ts`, così la stampa e l'export dicono ciò che dice la
/// Lettura: `Premi <kbd>Ctrl</kbd>` mostra un tasto, `<u>` sottolinea. Ogni
/// altro tag resta testo escapato.
const INLINE_HTML: &[&str] = &[
    "em", "strong", "del", "ins", "mark", "sub", "sup", "small", "abbr", "kbd", "samp", "var",
    "code", "span", "u",
];

/// I nove colori del contenuto, come Notion (K1): `<span class="fub-color-*">`
/// per il testo, `fub-bg-*` per il fondo. Lo stesso vocabolario chiuso di
/// `CONTENT_COLORS` in `ui/sanitize.ts`; i colori veri li dà il tema.
const CONTENT_COLORS: &[&str] = &[
    "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
];

/// Le classi di `<span>` e `<mark>` che la resa tiene: soltanto quelle dei
/// colori, al più una per il testo e una per il fondo. Altrimenti il tag resta
/// testo, come ogni tag con attributi.
fn content_classes(value: &str) -> Option<String> {
    let mut text = None;
    let mut fill = None;
    for token in value.split_ascii_whitespace() {
        let (slot, color) = if let Some(color) = token.strip_prefix("fub-color-") {
            (&mut text, color)
        } else if let Some(color) = token.strip_prefix("fub-bg-") {
            (&mut fill, color)
        } else {
            return None;
        };
        if slot.is_some() || !CONTENT_COLORS.contains(&color) {
            return None;
        }
        *slot = Some(token);
    }
    let classes: Vec<&str> = text.into_iter().chain(fill).collect();
    (!classes.is_empty()).then(|| classes.join(" "))
}

/// `name class="…"` (o con l'apice semplice): il nome e le classi dei colori,
/// se il tag ha soltanto quell'attributo e il nome è `span` o `mark`.
fn colored_tag(inner: &str) -> Option<(&'static str, String)> {
    let (name, rest) = inner.split_once(|c: char| c.is_ascii_whitespace())?;
    let name: &'static str = match name.to_ascii_lowercase().as_str() {
        "span" => "span",
        "mark" => "mark",
        _ => return None,
    };
    let value = rest
        .trim()
        .strip_prefix("class")?
        .trim_start()
        .strip_prefix('=')?
        .trim_start();
    let quote = value.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let value = value[1..].strip_suffix(quote)?;
    if value.contains(quote) {
        return None;
    }
    Some((name, content_classes(value)?))
}

enum HtmlTag {
    Break,
    Element {
        name: &'static str,
        closing: bool,
        classes: Option<String>,
    },
}

fn html_tag(inline: &Inline) -> Option<HtmlTag> {
    let Inline::Custom {
        custom_kind, attrs, ..
    } = inline
    else {
        return None;
    };
    if custom_kind != custom_kind::HTML {
        return None;
    }
    let raw = attrs.get("html")?.as_str()?;
    let original = raw.strip_prefix('<')?.strip_suffix('>')?;
    if let Some((name, classes)) = colored_tag(original) {
        return Some(HtmlTag::Element {
            name,
            closing: false,
            classes: Some(classes),
        });
    }
    let inner = original.to_ascii_lowercase();
    if let Some(rest) = inner.strip_prefix("br") {
        let rest = rest.trim_start();
        return rest
            .strip_prefix('/')
            .unwrap_or(rest)
            .is_empty()
            .then_some(HtmlTag::Break);
    }
    let (closing, name) = match inner.strip_prefix('/') {
        Some(name) => (true, name),
        None => (false, inner.as_str()),
    };
    let name = INLINE_HTML.iter().find(|known| **known == name)?;
    Some(HtmlTag::Element {
        name,
        closing,
        classes: None,
    })
}

/// Il tag in `at`, se è del vocabolario e ha il suo compagno fra i fratelli:
/// un `<em>` lasciato aperto il browser lo riaprirebbe nei paragrafi seguenti.
fn paired_html(inlines: &[Inline], at: usize) -> Option<String> {
    let (name, closing, classes) = match html_tag(&inlines[at])? {
        HtmlTag::Break => return Some("<br />".into()),
        HtmlTag::Element {
            name,
            closing,
            classes,
        } => (name, closing, classes),
    };
    let others: Box<dyn Iterator<Item = &Inline>> = if closing {
        Box::new(inlines[..at].iter().rev())
    } else {
        Box::new(inlines[at + 1..].iter())
    };
    let mut depth = 0usize;
    for other in others {
        let Some(HtmlTag::Element {
            name: other_name,
            closing: other_closing,
            ..
        }) = html_tag(other)
        else {
            continue;
        };
        if other_name != name {
            continue;
        }
        if other_closing == closing {
            depth += 1;
        } else if depth == 0 {
            let slash = if closing { "/" } else { "" };
            let class = classes
                .as_deref()
                .map(|classes| format!(" class=\"{classes}\""))
                .unwrap_or_default();
            return Some(format!("<{slash}{name}{class}>"));
        } else {
            depth -= 1;
        }
    }
    None
}

fn render_inline(inline: &Inline, opts: &RenderOptions, out: &mut String) {
    match inline {
        Inline::Text(s) => out.push_str(&escape(s)),
        Inline::Emph(children) => {
            out.push_str("<em>");
            render_inlines(children, opts, out);
            out.push_str("</em>");
        }
        // L'apice e il barrato hanno un elemento loro — `<sup>` e `<del>` —
        // e non collassano in un unico stile: la resa distingue i due
        // costrutti come li distingue il modello.
        Inline::Superscript(children) => {
            out.push_str("<sup>");
            render_inlines(children, opts, out);
            out.push_str("</sup>");
        }
        Inline::Subscript(children) => {
            out.push_str("<sub>");
            render_inlines(children, opts, out);
            out.push_str("</sub>");
        }
        Inline::Strikethrough(children) => {
            out.push_str("<del>");
            render_inlines(children, opts, out);
            out.push_str("</del>");
        }
        Inline::Strong(children) => {
            out.push_str("<strong>");
            render_inlines(children, opts, out);
            out.push_str("</strong>");
        }
        // Il duro cambia riga davvero; il morbido è uno spazio — la stessa
        // resa che il browser dà a un a-capo singolo nel testo.
        Inline::HardBreak => out.push_str("<br />"),
        Inline::SoftBreak => out.push(' '),
        Inline::Code(s) => {
            out.push_str("<code>");
            out.push_str(&escape(s));
            out.push_str("</code>");
        }
        Inline::TagRef { name, .. } => {
            write!(
                out,
                "<span class=\"tag\"{}>#{}</span>",
                attr("data-tag", name),
                escape(name)
            )
            .unwrap();
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
            if attrs.get("unresolved").and_then(|v| v.as_bool()) == Some(true) {
                // Un richiamo che non porta a nessuna nota si legge com'è
                // scritto, come lo mostrava comrak quando era solo testo.
                out.push_str(&escape(&format!("[^{label}]")));
            } else if attrs.get("inline").and_then(|v| v.as_bool()) == Some(true) {
                write!(
                    out,
                    "<sup class=\"footnote-inline\"{}>{}</sup>",
                    attr("data-label", label),
                    escape(label)
                )
                .unwrap();
            } else {
                write!(
                    out,
                    "<sup class=\"footnote-ref\"{}>{}</sup>",
                    attr("data-label", label),
                    escape(label)
                )
                .unwrap();
            }
        }
        // Una formula fra dollari: il segnaposto inerte che la shell compone
        // con KaTeX, come quelli di Lettura. Un `$$…$$` in mezzo al testo
        // resta in riga; da solo nel paragrafo lo prende `display_math`.
        Inline::Custom {
            custom_kind, attrs, ..
        } if custom_kind == custom_kind::MATH => {
            let source = attrs.get("source").and_then(|v| v.as_str()).unwrap_or("");
            write!(
                out,
                "<span class=\"math-inline\"{}>{}</span>",
                attr("data-tex", source),
                escape(source)
            )
            .unwrap();
        }
        // Il degrado generico degli inline. **Prima non c'era**: un
        // `Inline::Custom` che il provider non riconosceva spariva dalla
        // resa, in silenzio — ed era il gemello inline del difetto che il
        // §3.2 nomina sui blocchi, con l'aggravante che qui non restava
        // nemmeno il testo. Un kind che porta i propri byte sotto la chiave
        // che il contratto dichiara (la tabella per il core, `source` per i
        // terzi — §25.7) li mostra dentro uno span con la sua classe: chi ha
        // un tema lo veste, chi non ce l'ha lo legge.
        // Un commento è testo dell'autore per sé: resta nel file, non nella
        // resa.
        Inline::Custom { custom_kind, .. }
            if custom_kind == fub_abi::model::custom_kind::COMMENT => {}
        Inline::Custom {
            custom_kind, attrs, ..
        } => {
            // La stessa domanda del degrado dei blocchi, e la stessa
            // espressione: qui si guardava solo `text`, e un inline che portasse
            // il proprio contenuto sotto un altro nome del registro spariva
            // esattamente come sparivano i blocchi. Adesso la domanda la fa
            // `carichi::carico_testuale`, come per i blocchi.
            let text = text_content(custom_kind, attrs).unwrap_or_default();
            write!(
                out,
                "<span{}>{}</span>",
                attr("class", &css_class("inline", custom_kind)),
                escape(text)
            )
            .unwrap();
        }
    }
}

/// **Il testo che un `Custom` porta negli `attrs`**, quando è lui tutto il
/// contenuto che il blocco ha.
///
/// I `custom_kind` che non hanno figli portano i byte dell'utente in un attrs,
/// e **la chiave la dichiara il contratto**, non questo file: la domanda sta
/// in [`carichi::carico_testuale`] — la tabella [`custom_kind::CARICHI`] per i
/// kind del core, la chiave convenzionale `source` per quelli di terzi
/// (§25.7). Prima erano tre stringhe a campione (`html`, `source`, `text`)
/// scritte qui dentro, cioè lo stesso elenco di `model.rs` copiato in un
/// renderer: un kind del core che chiamasse il proprio contenuto in un quarto
/// modo si rendeva vuoto, e la copia non aveva nessuno che la tenesse
/// allineata all'originale.
///
/// Sta in una funzione sola perché il degrado dei blocchi e quello degli inline
/// facevano la stessa domanda in due punti, e la facevano diversa: l'inline
/// guardava `text` e il blocco non guardava niente. Chiedere due volte la stessa
/// cosa in due modi è il difetto, non la ripetizione.
///
/// **Il limite, dichiarato**: un kind di terzi che non porta i byte sotto la
/// chiave convenzionale si rende vuoto — è il prezzo della forma (b) della
/// §25.7, e oggi nessun plugin lo paga. «Sostituire il campione con niente»
/// è ciò che la riga vecchia rifiutava: non è niente, è la **chiave
/// dichiarata** in `rules::loads`, e chi la segue rende come prima.
fn text_content<'a>(kind: &str, attrs: &'a serde_json::Value) -> Option<&'a str> {
    loads::text_payload(kind, attrs)
}

/// La classe CSS di un `Custom`: il prefisso del lato che lo rende — `block` o
/// `inline` — e poi il `custom_kind` **intero**, namespace compreso.
///
/// **Sta in una funzione sola perché i due lati la componevano diversa**, e la
/// differenza non era estetica: il blocco scriveva il kind intero, l'inline lo
/// faceva passare per un `class_of` che tagliava tutto ciò che stava prima del
/// `:`. Così `terzi:spoiler` e `altri:spoiler` — due estensioni omonime di due
/// autori diversi, che è il caso per cui il namespace esiste — uscivano
/// **entrambe** su `.inline-spoiler`, e un tema che ne vestisse una vestiva
/// anche l'altra. Il namespace nel modello li teneva distinti fin qui, e qui si
/// perdeva.
///
/// Il commento che difendeva il taglio diceva che le due restavano
/// distinguibili «dal `data-kind` che il blocco porta»: **quell'attributo non
/// lo emette nessun ramo**, né qui né altrove nel workspace. Era una premessa
/// che sembrava vera perché argomentava.
///
/// I kind del core non hanno namespace, quindi per loro non cambia niente:
/// `highlight` resta `.inline-highlight`, che è il selettore su cui il tema
/// della shell è scritto (`apps/client/src/theme/serie/pelle.css`). Il `:` in un nome di
/// classe è lecito in HTML; in un selettore CSS si scrive `\:`, ed è la stessa
/// forma che i blocchi emettono già da prima di questa riga.
fn css_class(side: &str, custom_kind: &str) -> String {
    format!("{side}-{custom_kind}")
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
    prefix: &str,
    page: &str,
    heading: &Option<String>,
    block: &Option<String>,
) -> String {
    let mut out = attr(&format!("data-{prefix}-page"), page);
    if let Some(h) = heading {
        out.push_str(&attr(&format!("data-{prefix}-heading"), h));
    }
    if let Some(b) = block {
        out.push_str(&attr(&format!("data-{prefix}-block"), b));
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
                // carico). Vedi ../../../docs/architecture/frontend-and-ipc.md.
                write!(
                    out,
                    "<div class=\"embed\"{}>",
                    wiki_attrs("embed", page, heading, block)
                )
                .unwrap();
                render_link_label(label, &inner(target, page), opts, out);
                out.push_str("</div>");
                return;
            }
            // Le stesse tre coordinate, con l'altro prefisso: il **blocco** il
            // parser lo legge dalla 0003, e fino alla 0049 si fermava qui —
            // `[[Nota#^blocco]]` arrivava alla shell come un link alla nota e
            // basta. Adesso c'è una risposta in cui metterlo
            // (`resolved-ref.at`), e questo è il primo centimetro del giro.
            // Wikilink come data-attribute: il frontend risolve la navigazione.
            write!(
                out,
                "<a class=\"wikilink\"{}",
                wiki_attrs("wikilink", page, heading, block)
            )
            .unwrap();
            out.push_str(" href=\"#\"");
            out.push('>');
            render_link_label(label, &inner(target, page), opts, out);
            out.push_str("</a>");
        }
        // Un riferimento incorporato che non è un wikilink è, quasi sempre,
        // un'immagine. Anche qui si emette il **segnaposto** del protocollo di
        // transclusion e non un `<img>`: caricare una risorsa — del vault o
        // peggio remota — è una decisione della shell (13.1 per gli allegati,
        // 5.3 e 23 per il contenuto remoto), non del provider che ha letto il
        // file. Chi disegna sa dove sta il vault; questo codice no.
        LinkTarget::Url(url) if embed => {
            write!(out, "<div class=\"embed\"{}>", attr("data-embed-url", url)).unwrap();
            render_link_label(label, url, opts, out);
            out.push_str("</div>");
        }
        LinkTarget::Path(p) if embed => {
            write!(out, "<div class=\"embed\"{}>", attr("data-embed-path", p)).unwrap();
            render_link_label(label, p, opts, out);
            out.push_str("</div>");
        }
        LinkTarget::Url(url) => {
            write!(out, "<a{}>", attr("href", url)).unwrap();
            render_link_label(label, url, opts, out);
            out.push_str("</a>");
        }
        LinkTarget::Path(p) => {
            write!(
                out,
                "<a class=\"internal-path\"{} href=\"#\">",
                attr("data-path", p)
            )
            .unwrap();
            render_link_label(label, p, opts, out);
            out.push_str("</a>");
        }
    }
}

/// Ciò che si legge di un wikilink **senza alias**: l'interno intero, non la
/// sola pagina.
///
/// `label: None` vuol dire «l'autore non ha scritto un alias», e allora ciò che
/// si vede è ciò che sta fra le due parentesi — `Nota#Sezione`, non `Nota`.
/// Finché il parser sintetizzava l'etichetta dal bersaglio la differenza non si
/// vedeva mai da qui; adesso che non la sintetizza più, il ripiego sulla sola
/// `page` mangerebbe l'heading a schermo.
fn inner(target: &LinkTarget, page: &str) -> String {
    target.wiki_inner().unwrap_or_else(|| page.to_string())
}

/// L'etichetta di un link, **con le opzioni di chi ha chiesto la resa**.
///
/// Un'etichetta non è testo piatto: è una fetta di inline come le altre, e può
/// contenere un wikilink (`[vai a [[Nota]]](url)`, l'`alt` di un'immagine). Qui
/// si costruiva un `RenderOptions::default()` sul posto, cioè **le opzioni di
/// nessuno**: gli inline dentro l'etichetta venivano resi come se il chiamante
/// non avesse chiesto niente, e `WIKILINKS_AS_DATA_ATTRS` — l'unica opzione che
/// la resa legge, quella che l'anteprima del kernel accende sempre — smetteva di
/// valere appena un link entrava dentro l'etichetta di un altro. Lo stesso
/// wikilink usciva con l'`href="#"` in mezzo a un paragrafo e senza dentro
/// un'etichetta, e a dirlo non c'era niente.
///
/// La riparazione è passare le `opts` che il chiamante ha già in mano, come fa
/// ogni altro ramo della resa: così **un'opzione nuova la ereditano tutti e sei
/// i siti** che rendono un'etichetta, e ogni inline annidato la vede a qualunque
/// profondità, senza che nessuno debba ricordarsene di nuovo.
fn render_link_label(
    label: Option<&[Inline]>,
    fallback: &str,
    opts: &RenderOptions,
    out: &mut String,
) {
    match label {
        Some(inlines) if !inlines.is_empty() => render_inlines(inlines, opts, out),
        _ => out.push_str(&escape(fallback)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::Span;
    use serde_json::json;

    fn custom_html(kind: &str, attrs: serde_json::Value, blocks: Vec<Block>) -> String {
        let block = Block::Custom {
            custom_kind: kind.into(),
            attrs,
            blocks,
            anchor: Some("anchor".into()),
            span: Span { start: 7, end: 42 },
        };
        let mut out = String::new();
        render_block(&block, &RenderOptions::default(), &mut out);
        out
    }

    #[test]
    fn custom_fallback_keeps_html_attributes_separate_from_payload() {
        let html = custom_html(
            "com.example:convenzione",
            json!({ "source": "GIRO-DEI-BYTE", "text": "TESTO-SBAGLIATO" }),
            vec![],
        );
        assert_eq!(
            html,
            concat!(
                "<div id=\"anchor\" data-fub-source-start=\"7\" data-fub-source-end=\"42\"",
                " class=\"block-com.example:convenzione\">GIRO-DEI-BYTE</div>"
            )
        );
    }

    #[test]
    fn callout_keeps_its_anchor_and_span_without_leaking_payload() {
        let html = custom_html(
            custom_kind::CALLOUT,
            json!({ "type": "warning", "title": "Attenzione", "private": "NON-PUBBLICARE" }),
            vec![],
        );
        assert_eq!(
            html,
            concat!(
                "<div id=\"anchor\" data-fub-source-start=\"7\" data-fub-source-end=\"42\"",
                " class=\"callout\" data-callout=\"warning\">",
                "<div class=\"callout-title\">Attenzione</div></div>"
            )
        );
    }

    #[test]
    fn unreadable_frontmatter_renders_only_its_declared_fields() {
        let html = custom_html(
            custom_kind::FRONTMATTER_UNPARSED,
            json!({ "error": "Errore", "text": "titolo: [", "private": "NON-PUBBLICARE" }),
            vec![],
        );
        assert_eq!(
            html,
            concat!(
                "<div id=\"anchor\" data-fub-source-start=\"7\" data-fub-source-end=\"42\"",
                " class=\"block-frontmatter-unparsed\">",
                "<div class=\"frontmatter-error\">Errore</div><pre>titolo: [</pre></div>"
            )
        );
    }

    #[test]
    fn custom_payloads_remain_escaped_in_every_rendering_branch() {
        let hostile = "\"><script>alert('x')</script>&";
        for kind in [
            custom_kind::CALLOUT,
            custom_kind::FRONTMATTER_UNPARSED,
            "com.example:custom",
        ] {
            let html = custom_html(
                kind,
                json!({
                    "type": hostile, "title": hostile, "error": hostile,
                    "text": hostile, "source": hostile, "label": hostile,
                    "private": "NON-PUBBLICARE"
                }),
                vec![],
            );
            assert!(html.starts_with("<div id=\"anchor\" "), "{kind}: {html}");
            assert!(html.contains(&escape(hostile)), "{kind}: {html}");
            assert!(!html.contains("<script>"), "{kind}: {html}");
            assert!(!html.contains("NON-PUBBLICARE"), "{kind}: {html}");
        }
    }

    #[test]
    fn custom_children_take_precedence_over_source_without_losing_their_spans() {
        let html = custom_html(
            "com.example:container",
            json!({ "source": "NON-PUBBLICARE" }),
            vec![Block::Paragraph {
                inlines: vec![Inline::Text("Figlio".into())],
                anchor: None,
                span: Span { start: 12, end: 18 },
            }],
        );
        assert_eq!(
            html,
            concat!(
                "<div id=\"anchor\" data-fub-source-start=\"7\" data-fub-source-end=\"42\"",
                " class=\"block-com.example:container\">",
                "<p data-fub-source-start=\"12\" data-fub-source-end=\"18\">Figlio</p></div>"
            )
        );
    }

    #[test]
    fn a_custom_block_without_source_does_not_dump_other_attributes() {
        let html = custom_html(
            "com.example:empty",
            json!({ "text": "NON-PUBBLICARE" }),
            vec![],
        );
        assert_eq!(
            html,
            concat!(
                "<div id=\"anchor\" data-fub-source-start=\"7\" data-fub-source-end=\"42\"",
                " class=\"block-com.example:empty\"></div>"
            )
        );
    }
}
