//! L'anteprima di un `.fubann`: le annotazioni elencate per pagina.
//!
//! È HTML statico e inerte, come quello degli altri provider: testi e note
//! escapati, i riferimenti come collegamenti interni `data-path` che la shell
//! risolve, mai un `<img>` né un URL di risorsa. Il PDF e le pagine non si
//! disegnano qui: lo fa la shell, che sa caricare i media del vault.
//!
//! La resa dipende solo dai blocchi e dai loro `attrs`. Con dei renderer
//! registrati il kernel passa un frammento che ha solo i blocchi, e un embed
//! di sezione (`![[Bando.pdf.fubann#page=3]]`) arriva con la sezione scelta in
//! `attrs.section` del riepilogo.
//!
//! L'HTML non ha parole, tranne l'etichetta `p. k` dei titoli di pagina: il
//! provider non conosce la lingua di chi legge, e classi e `data-*` dicono il
//! resto. *(Proposta del 3 ottobre 2026, da rivedere.)*

use std::fmt::Write as _;

use fub_abi::custom::SECTION_ATTR;
use fub_abi::html::{attr, escape};
use fub_abi::model::{Block, DocumentModel, Inline, LinkTarget};
use fub_abi::rules::path::{percent_decode, split_fragment};
use serde_json::Value;

use crate::parse::{ANNOTATIONS_KIND, NOTE_KIND, PAGE_KIND, PAGE_SECTION};

/// L'elenco delle annotazioni di `model`.
///
/// Ogni riepilogo è una `section.fub-annotations` con il PDF annotato e il
/// numero di pagine in `data-*`. Dentro, in ordine di documento: il titolo
/// (`h1`), la descrizione, il collegamento al PDF, ciò che sta fuori dalle
/// pagine e una `section.fub-annotations-page` per gruppo di pagina, col
/// titolo che apre il PDF a quella pagina e un elenco di testi e note.
pub(crate) fn listing(model: &DocumentModel) -> String {
    let mut out = String::new();
    for block in &model.body {
        match block {
            Block::Custom {
                custom_kind, attrs, ..
            } if custom_kind == ANNOTATIONS_KIND => summary(block, attrs, &mut out),
            other => render(other, &Pdf::default(), &mut out),
        }
    }
    out
}

/// Il PDF annotato, letto dal riepilogo.
#[derive(Default)]
struct Pdf<'a> {
    /// Il percorso com'è scritto in `fub:annotates`.
    path: Option<&'a str>,
}

impl Pdf<'_> {
    /// Il riferimento alla pagina `number`: il percorso senza frammento, e
    /// `#page=k` come lo apre il visualizzatore dei PDF.
    fn page(&self, number: u64) -> Option<String> {
        let (path, _) = split_fragment(self.path?);
        Some(format!("{path}#{PAGE_SECTION}{number}"))
    }
}

fn summary(block: &Block, attrs: &Value, out: &mut String) {
    let pdf = Pdf {
        path: attrs.get("annotates").and_then(Value::as_str),
    };
    // Una sezione di pagina sceglie i suoi gruppi; il titolo, o nessuna
    // sezione, l'insieme intero.
    let page = attrs
        .get(SECTION_ATTR)
        .and_then(Value::as_str)
        .and_then(|section| section.strip_prefix(PAGE_SECTION))
        .and_then(|number| number.parse::<u64>().ok());
    out.push_str("<section class=\"fub-annotations\"");
    if let Some(path) = pdf.path {
        out.push_str(&attr("data-annotates", path));
    }
    if let Some(pages) = attrs.get("pages").and_then(Value::as_u64) {
        out.push_str(&attr("data-pages", &pages.to_string()));
    }
    out.push_str(&source_attrs(block));
    out.push('>');
    for child in children(block) {
        match (page, child) {
            (None, child) if is_target(child, &pdf) => target(child, &pdf, out),
            (None, child) => render(child, &pdf, out),
            (Some(wanted), child @ Block::Custom { attrs, .. })
                if is_kind(child, PAGE_KIND) && page_number(attrs) == Some(wanted) =>
            {
                render(child, &pdf, out);
            }
            (Some(_), _) => {}
        }
    }
    out.push_str("</section>");
}

/// Il blocco del PDF annotato: un paragrafo fatto solo del collegamento
/// senza etichetta a quel percorso.
fn is_target(block: &Block, pdf: &Pdf<'_>) -> bool {
    let Block::Paragraph { inlines, .. } = block else {
        return false;
    };
    matches!(
        inlines.as_slice(),
        [Inline::Link {
            target: LinkTarget::Path(path),
            label: None,
            embed: false,
            ..
        }] if Some(path.as_str()) == pdf.path
    )
}

fn target(block: &Block, pdf: &Pdf<'_>, out: &mut String) {
    let _ = write!(
        out,
        "<p class=\"fub-annotations-target\"{}>",
        source_attrs(block)
    );
    if let Some(path) = pdf.path {
        internal(path, &escape(&percent_decode(path)), out);
    }
    out.push_str("</p>");
}

/// Un blocco qualunque del riepilogo o di una pagina.
fn render(block: &Block, pdf: &Pdf<'_>, out: &mut String) {
    let attrs = source_attrs(block);
    match block {
        Block::Custom {
            attrs: page,
            blocks,
            ..
        } if is_kind(block, PAGE_KIND) => {
            out.push_str("<section class=\"fub-annotations-page\"");
            let number = page_number(page);
            if let Some(number) = number {
                out.push_str(&attr("data-page", &number.to_string()));
            }
            if let Some([width, height]) = page_size(page) {
                out.push_str(&attr("data-page-size", &format!("{width} {height}")));
            }
            out.push_str(&attrs);
            out.push_str("><h2>");
            if let Some(number) = number {
                let label = format!("p. {number}");
                match pdf.page(number) {
                    Some(path) => internal(&path, &label, out),
                    None => out.push_str(&label),
                }
            }
            out.push_str("</h2>");
            if !blocks.is_empty() {
                out.push_str("<ul>");
                for child in blocks {
                    item(child, pdf, out);
                }
                out.push_str("</ul>");
            }
            out.push_str("</section>");
        }
        Block::Custom { blocks, .. } if is_kind(block, NOTE_KIND) => {
            let _ = write!(out, "<div class=\"fub-annotations-note\"{attrs}>");
            note(blocks, out);
            out.push_str("</div>");
        }
        Block::Heading { level, inlines, .. } => {
            let level = (*level).clamp(1, 6);
            let _ = write!(out, "<h{level}{attrs}>");
            render_inlines(inlines, out);
            let _ = write!(out, "</h{level}>");
        }
        Block::Paragraph { inlines, .. } => {
            let _ = write!(out, "<p{attrs}>");
            render_inlines(inlines, out);
            out.push_str("</p>");
        }
        // Il provider non produce altri blocchi. Di un blocco custom che non
        // conosce si mostrano i figli.
        other => {
            let _ = write!(out, "<div{attrs}>");
            for child in children(other) {
                render(child, pdf, out);
            }
            out.push_str("</div>");
        }
    }
}

/// Una voce dell'elenco di una pagina: un testo, un riferimento o una nota.
fn item(block: &Block, pdf: &Pdf<'_>, out: &mut String) {
    let attrs = source_attrs(block);
    match block {
        Block::Paragraph { inlines, .. } => {
            let _ = write!(out, "<li class=\"fub-annotations-text\"{attrs}>");
            render_inlines(inlines, out);
            out.push_str("</li>");
        }
        Block::Custom { blocks, .. } if is_kind(block, NOTE_KIND) => {
            let _ = write!(out, "<li class=\"fub-annotations-note\"{attrs}>");
            note(blocks, out);
            out.push_str("</li>");
        }
        other => {
            let _ = write!(out, "<li{attrs}>");
            render(other, pdf, out);
            out.push_str("</li>");
        }
    }
}

/// Il contenuto di una nota: il testo disegnato, se c'è, e poi il corpo. Nel
/// modello il corpo viene prima, perché il suo valore sta nel tag d'apertura.
fn note(blocks: &[Block], out: &mut String) {
    let paragraphs: Vec<_> = blocks
        .iter()
        .filter(|block| matches!(block, Block::Paragraph { .. }))
        .collect();
    let (body, text) = match paragraphs.as_slice() {
        [body] => (Some(*body), None),
        [body, text, ..] => (Some(*body), Some(*text)),
        [] => (None, None),
    };
    for (block, class) in [(text, ""), (body, " class=\"fub-annotations-body\"")] {
        if let Some(block @ Block::Paragraph { inlines, .. }) = block {
            let _ = write!(out, "<p{class}{}>", source_attrs(block));
            render_inlines(inlines, out);
            out.push_str("</p>");
        }
    }
}

fn render_inlines(inlines: &[Inline], out: &mut String) {
    for inline in inlines {
        match inline {
            Inline::Text(text) | Inline::Code(text) => out.push_str(&escape(text)),
            Inline::Emph(inner)
            | Inline::Strong(inner)
            | Inline::Superscript(inner)
            | Inline::Strikethrough(inner) => render_inlines(inner, out),
            Inline::HardBreak => out.push_str("<br>"),
            Inline::SoftBreak => out.push(' '),
            // Un riferimento è sempre un collegamento interno, anche
            // un'immagine: l'anteprima delle annotazioni non carica media.
            Inline::Link {
                target: LinkTarget::Path(path),
                label,
                ..
            } => {
                let mut text = String::new();
                match label {
                    Some(label) if !label.is_empty() => render_inlines(label, &mut text),
                    _ => text.push_str(&escape(&percent_decode(path))),
                }
                internal(path, &text, out);
            }
            Inline::Link { label, .. } => {
                if let Some(label) = label {
                    render_inlines(label, out);
                }
            }
            Inline::TagRef { name, .. } => out.push_str(&escape(name)),
            Inline::Custom { .. } => {}
        }
    }
}

/// `<a class="internal-path" data-path="…" href="#">` con `html`, già
/// escapato, per contenuto.
fn internal(path: &str, html: &str, out: &mut String) {
    let _ = write!(
        out,
        "<a class=\"internal-path\"{} href=\"#\">{html}</a>",
        attr("data-path", path)
    );
}

/// I byte della sorgente di un blocco, come li scrivono gli altri provider:
/// la shell ci ritrova l'elemento.
fn source_attrs(block: &Block) -> String {
    let span = block.span();
    format!(
        " data-fub-source-start=\"{}\" data-fub-source-end=\"{}\"",
        span.start, span.end
    )
}

fn is_kind(block: &Block, kind: &str) -> bool {
    matches!(block, Block::Custom { custom_kind, .. } if custom_kind == kind)
}

fn children(block: &Block) -> &[Block] {
    match block {
        Block::Custom { blocks, .. } => blocks,
        _ => &[],
    }
}

fn page_number(attrs: &Value) -> Option<u64> {
    attrs.get("page").and_then(Value::as_u64)
}

fn page_size(attrs: &Value) -> Option<[f64; 2]> {
    match attrs.get("size")?.as_array()?.as_slice() {
        [width, height] => Some([width.as_f64()?, height.as_f64()?]),
        _ => None,
    }
}
