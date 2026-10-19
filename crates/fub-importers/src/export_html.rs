//! L'export **HTML**: una nota diventa un file `.html` che si apre da solo, in
//! qualunque browser, senza il vault accanto.
//!
//! Il corpo è la resa di stampa del documento (`IndexQuery::RenderPrint`):
//! quella del formato e dei renderer registrati, la stessa che la shell manda
//! alla stampa, non una seconda resa scritta qui. Ciò che quella resa lascia
//! alla shell lo risolve questo exporter, perché un file fuori dal vault non
//! ha una shell che lo idrati:
//!
//! - un'immagine del vault (`![](foto.png)`, `![[foto.png]]`) entra nel file
//!   come `data:` URI, entro un tetto per immagine e per file;
//! - una nota incorporata (`![[Altra nota]]`, anche una sua sezione o un suo
//!   blocco) entra con la sua resa, fino a [`MAX_DEPTH`] livelli e senza
//!   giri.
//!
//! # Nessuna perdita silenziosa
//!
//! Ciò che non entra lo dice il rapporto, con la nota a cui si riferisce: una
//! parte interattiva (un diagramma, una query, una vista) che solo la shell
//! sa disegnare, un'immagine remota che resta un collegamento, un riferimento
//! che non si risolve, un'immagine oltre il tetto.
//!
//! # Un file inerte
//!
//! L'HTML di un renderer di terze parti non è fidato. Il file porta una
//! Content-Security-Policy che non lascia eseguire script né caricare niente
//! da fuori: immagini soltanto da `data:`, stili soltanto quelli scritti qui.

use std::collections::{BTreeMap, BTreeSet};

use fub_abi::model::{DocId, LinkTarget};
use fub_abi::render::RenderedDocument;
use fub_abi::rules::path::strip_ext;
use fub_abi::traits::{IndexQuery, IndexResult, ReadApi};
use fub_abi::transfer::{
    artifact_key, ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportTarget,
    TransferNote,
};
use fub_abi::PluginError;

use crate::common::bad_args;

pub const TARGET_HTML: &str = "importers.html";

/// Quante note esporta una richiesta: ogni file sta in memoria finché la
/// shell non lo posa.
const MAX_DOCUMENTS: usize = 256;
/// Quanti livelli di note incorporate dentro note incorporate.
pub const MAX_DEPTH: usize = 4;
/// Il tetto di un'immagine incorporata, e quello di tutte le immagini di un
/// file: oltre, l'immagine resta il suo nome e il rapporto lo dice.
const MAX_IMAGE: usize = 16 * 1024 * 1024;
const MAX_IMAGES: usize = 64 * 1024 * 1024;

/// Il foglio di stile del file: leggibile, chiaro e scuro, e stampabile.
const STYLE: &str = "\
:root{color-scheme:light dark;--fg:#1f1d1a;--bg:#fdfcf9;--muted:#6b665d;--rule:#d9d4ca;--code:#f2efe8}\
@media (prefers-color-scheme:dark){:root{--fg:#e9e6df;--bg:#1b1a18;--muted:#a19b90;--rule:#3a3732;--code:#262421}}\
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 Georgia,'Iowan Old Style',serif}\
article{max-width:42rem;margin:0 auto;padding:3rem 1.25rem}\
h1,h2,h3,h4{line-height:1.25;font-family:system-ui,sans-serif}\
a{color:inherit}a.wikilink,a.internal-path{text-decoration:underline dotted}\
img{max-width:100%;height:auto}\
pre,code{font:0.9em/1.5 ui-monospace,Menlo,monospace;background:var(--code)}\
pre{padding:.75rem 1rem;overflow-x:auto}\
blockquote,.embed{margin:1rem 0;padding:0 1rem;border-left:3px solid var(--rule)}\
table{border-collapse:collapse}th,td{border:1px solid var(--rule);padding:.25rem .5rem}\
.ui-slot{margin:1rem 0;padding:.5rem;border:1px dashed var(--rule);color:var(--muted);font:0.85em system-ui,sans-serif}\
.ui-slot::before{content:attr(data-custom-kind)}\
@media print{body{background:#fff;color:#000}article{padding:0}}";

#[derive(Default)]
pub struct HtmlExport;

impl HtmlExport {
    pub fn boxed() -> Box<dyn ExportProvider> {
        Box::new(HtmlExport)
    }
}

impl ExportProvider for HtmlExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: TARGET_HTML.to_string(),
            name: "HTML (un file per nota, con le immagini dentro)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        if request.target != TARGET_HTML {
            return Err(bad_args(format!(
                "`{}` non è una destinazione di questo provider",
                request.target
            )));
        }
        let docs = request.selection.resolve(host)?;
        if docs.is_empty() {
            return Err(bad_args("niente di scelto: l'HTML sarebbe vuoto"));
        }
        if docs.len() > MAX_DOCUMENTS {
            return Err(bad_args(format!(
                "più di {MAX_DOCUMENTS} note: esportane meno alla volta"
            )));
        }
        let mut report = ExportReport::default();
        for (doc, name) in docs.iter().zip(html_names(&docs)) {
            let rendered = match host.query_index(IndexQuery::RenderPrint { doc: doc.clone() }) {
                Ok(IndexResult::RenderPrint(rendered)) => rendered,
                Ok(other) => {
                    return Err(PluginError::Internal(
                        format!("la resa di stampa ha risposto `{}`", other.kind_name()).into(),
                    ))
                }
                Err(error) => {
                    report.log.push(
                        TransferNote::warning(format!("non si rende: {error}"))
                            .about(doc.to_string()),
                    );
                    continue;
                }
            };
            let page = page(host, doc, rendered, &mut report);
            let h = out.open_artifact(&name, "text/html")?;
            out.write_artifact(h, page.as_bytes())?;
            report.artifacts.push(out.close_artifact(h)?);
        }
        if report.artifacts.is_empty() {
            // La ragione della prima che non si è resa: con una nota sola è
            // l'unica, e un «non si rende» senza perché non aiuta nessuno.
            let why = report
                .log
                .first()
                .map(|note| format!(": {}", note.message))
                .unwrap_or_default();
            return Err(bad_args(format!(
                "nessuna delle note scelte si rende in HTML{why}"
            )));
        }
        Ok(report)
    }
}

/// La pagina intera di `doc`, e nel rapporto ciò che non vi è entrato.
fn page(
    host: &dyn ReadApi,
    doc: &DocId,
    rendered: RenderedDocument,
    report: &mut ExportReport,
) -> String {
    let mut inliner = Inliner {
        host,
        images: 0,
        lost: Lost::default(),
        visited: BTreeSet::from([doc.clone()]),
    };
    inliner.parts(&rendered);
    let body = inliner.inline(&rendered.html, doc, 0);
    inliner.lost.into_notes(doc, report);
    let title = fub_abi::html::escape(file_stem(doc));
    format!(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">\
<meta name=\"generator\" content=\"Fub\">\
<title>{title}</title><style>{STYLE}</style></head>\n<body><article>\n{body}\n</article></body></html>\n"
    )
}

/// Ciò che non è entrato in un file, contato per specie.
#[derive(Default)]
struct Lost {
    /// Le parti interattive, per `custom_kind`.
    parts: BTreeMap<String, usize>,
    remote: usize,
    unresolved: BTreeSet<String>,
    too_big: BTreeSet<String>,
    too_deep: BTreeSet<String>,
    cycles: BTreeSet<String>,
}

impl Lost {
    fn into_notes(self, doc: &DocId, report: &mut ExportReport) {
        let about = |message: String| TransferNote::warning(message).about(doc.to_string());
        if !self.parts.is_empty() {
            let kinds = self
                .parts
                .iter()
                .map(|(kind, n)| format!("{kind} ×{n}"))
                .collect::<Vec<_>>()
                .join(", ");
            report.log.push(about(format!(
                "le parti interattive ({kinds}) le disegna soltanto Fub: nel file resta un riquadro col loro nome"
            )));
        }
        if self.remote > 0 {
            report.log.push(about(format!(
                "{} immagini remote restano un collegamento: il file non carica niente da fuori",
                self.remote
            )));
        }
        for (set, what) in [
            (&self.unresolved, "non si trova nel vault"),
            (&self.too_big, "è oltre il tetto delle immagini del file"),
            (
                &self.too_deep,
                "è incorporata oltre il quarto livello: resta il suo nome",
            ),
            (
                &self.cycles,
                "si incorpora in un giro: la seconda volta resta il suo nome",
            ),
        ] {
            for name in set {
                report.log.push(about(format!("`{name}` {what}")));
            }
        }
    }
}

struct Inliner<'a> {
    host: &'a dyn ReadApi,
    images: usize,
    lost: Lost,
    /// Le note già aperte sulla strada fino a qui: incorporarne una di nuovo
    /// è un giro.
    visited: BTreeSet<DocId>,
}

impl Inliner<'_> {
    fn parts(&mut self, rendered: &RenderedDocument) {
        for part in &rendered.parts {
            *self.lost.parts.entry(part.kind.clone()).or_default() += 1;
        }
    }

    /// `html` con i segnaposti di incorporamento sostituiti da ciò che
    /// incorporano. `from` è la nota in cui sono scritti: i path relativi
    /// partono dalla sua cartella.
    fn inline(&mut self, html: &str, from: &DocId, depth: usize) -> String {
        let mut out = String::with_capacity(html.len());
        let mut rest = html;
        while let Some(at) = rest.find(EMBED_OPEN) {
            out.push_str(&rest[..at]);
            let Some(slot) = Slot::parse(&rest[at..]) else {
                out.push_str(EMBED_OPEN);
                rest = &rest[at + EMBED_OPEN.len()..];
                continue;
            };
            out.push_str(&self.replace(&slot, from, depth));
            rest = &rest[at + slot.len..];
        }
        out.push_str(rest);
        out
    }

    fn replace(&mut self, slot: &Slot, from: &DocId, depth: usize) -> String {
        let keep = || format!("<div class=\"embed\">{}</div>", slot.label);
        if let Some(url) = slot.attr("data-embed-url") {
            self.lost.remote += 1;
            return format!("<a{}>{}</a>", fub_abi::html::attr("href", &url), slot.label);
        }
        let (target, name) = if let Some(path) = slot.attr("data-embed-path") {
            (LinkTarget::Path(path.clone()), path)
        } else if let Some(page) = slot.attr("data-embed-page") {
            let target = LinkTarget::Wiki {
                page: page.clone(),
                heading: slot.attr("data-embed-heading"),
                block: slot.attr("data-embed-block"),
            };
            (target, page)
        } else {
            return keep();
        };
        let resolved = match self.host.query_index(IndexQuery::Resolve {
            target: target.clone(),
            from: Some(from.clone()),
        }) {
            Ok(IndexResult::Resolved(Some(resolved))) => resolved.doc,
            _ => {
                self.lost.unresolved.insert(name);
                return keep();
            }
        };
        if let Some(mime) =
            fub_abi::rules::media::mime_of(&resolved).filter(|mime| mime.starts_with("image/"))
        {
            return self
                .image(&resolved, mime, &slot.label)
                .unwrap_or_else(keep);
        }
        self.note(&target, &resolved, depth).unwrap_or_else(keep)
    }

    fn image(&mut self, id: &DocId, mime: &str, label: &str) -> Option<String> {
        let bytes = match self.host.read_document_bytes(id) {
            Ok(bytes) => bytes,
            Err(_) => {
                self.lost.unresolved.insert(id.to_string());
                return None;
            }
        };
        if bytes.len() > MAX_IMAGE || self.images + bytes.len() > MAX_IMAGES {
            self.lost.too_big.insert(id.to_string());
            return None;
        }
        self.images += bytes.len();
        Some(format!(
            "<img alt=\"{}\" src=\"data:{mime};base64,{}\">",
            text_of(label),
            base64(&bytes)
        ))
    }

    fn note(&mut self, target: &LinkTarget, id: &DocId, depth: usize) -> Option<String> {
        if depth >= MAX_DEPTH {
            self.lost.too_deep.insert(id.to_string());
            return None;
        }
        if self.visited.contains(id) {
            self.lost.cycles.insert(id.to_string());
            return None;
        }
        let (heading, block) = match target {
            LinkTarget::Wiki { heading, block, .. } => (heading.clone(), block.clone()),
            _ => (None, None),
        };
        // La pagina si nomina col suo id risolto: il ritaglio è di quella nota,
        // non di un'omonima che il nome scritto potrebbe trovare da un'altra
        // cartella.
        let embed = match self.host.query_index(IndexQuery::RenderEmbed {
            page: strip_ext(id.as_str()),
            heading,
            block,
        }) {
            Ok(IndexResult::RenderEmbed(embed)) => embed,
            _ => {
                self.lost.unresolved.insert(id.to_string());
                return None;
            }
        };
        self.parts(&embed.content);
        self.visited.insert(id.clone());
        let inner = self.inline(&embed.content.html, id, depth + 1);
        self.visited.remove(id);
        Some(format!("<div class=\"embed\">{inner}</div>"))
    }
}

/// L'inizio di un segnaposto di incorporamento, come lo scrivono i provider:
/// è il protocollo di transclusion che la shell idrata.
const EMBED_OPEN: &str = "<div class=\"embed\"";

/// Un segnaposto `<div class="embed" …>etichetta</div>`.
struct Slot {
    attrs: Vec<(String, String)>,
    /// L'etichetta, HTML già reso.
    label: String,
    /// Quanti byte occupa, dal `<` al `</div>`.
    len: usize,
}

impl Slot {
    fn parse(html: &str) -> Option<Slot> {
        let open_end = html.find('>')?;
        let tag = &html[EMBED_OPEN.len()..open_end];
        let close = html[open_end..].find("</div>")? + open_end;
        let label = &html[open_end + 1..close];
        // Un'etichetta non contiene blocchi: un `<div` dentro vuol dire che non
        // è un segnaposto, e si lascia com'è.
        if label.contains("<div") {
            return None;
        }
        Some(Slot {
            attrs: attributes(tag)?,
            label: label.to_string(),
            len: close + "</div>".len(),
        })
    }

    fn attr(&self, name: &str) -> Option<String> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    }
}

/// Gli attributi ` nome="valore"` come li scrive [`fub_abi::html::attr`],
/// con i valori riportati al testo.
fn attributes(mut tag: &str) -> Option<Vec<(String, String)>> {
    let mut attrs = Vec::new();
    loop {
        tag = tag.trim_start();
        if tag.is_empty() {
            return Some(attrs);
        }
        let eq = tag.find("=\"")?;
        let name = tag[..eq].to_string();
        let value_start = eq + 2;
        let value_end = tag[value_start..].find('"')? + value_start;
        attrs.push((name, unescape(&tag[value_start..value_end])));
        tag = &tag[value_end + 1..];
    }
}

fn unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// Il testo di un frammento HTML, ancora con le sue entità: va bene così in
/// un attributo, che con le virgolette escapate non si chiude.
fn text_of(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut inside = false;
    for c in html.chars() {
        match c {
            '<' => inside = true,
            '>' => inside = false,
            '"' if !inside => out.push_str("&quot;"),
            c if !inside => out.push(c),
            _ => {}
        }
    }
    out
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn file_stem(doc: &DocId) -> &str {
    let name = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

/// Un nome per nota, col path della nota senza estensione; due note che
/// darebbero lo stesso file tengono la loro estensione nel nome.
fn html_names(docs: &[DocId]) -> Vec<String> {
    let stem_key = |doc: &DocId| artifact_key(&strip_ext(doc.as_str()));
    let mut stems: BTreeMap<String, usize> = BTreeMap::new();
    for doc in docs {
        *stems.entry(stem_key(doc)).or_default() += 1;
    }
    let mut taken = BTreeSet::new();
    docs.iter()
        .map(|doc| {
            let base = match stems[&stem_key(doc)] {
                1 => strip_ext(doc.as_str()),
                _ => doc.to_string(),
            };
            (0u32..)
                .map(|n| match n {
                    0 => format!("{base}.html"),
                    n => format!("{base} {n}.html"),
                })
                .find(|name| taken.insert(artifact_key(name)))
                .expect("la sequenza dei candidati è infinita")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0x00]), "//4A");
    }

    #[test]
    fn a_placeholder_is_read_back_with_its_attributes_and_label() {
        let html =
            "<div class=\"embed\" data-embed-path=\"img/a &amp; b.png\">alt <em>x</em></div>coda";
        let slot = Slot::parse(html).unwrap();
        assert_eq!(
            slot.attr("data-embed-path").as_deref(),
            Some("img/a & b.png")
        );
        assert_eq!(slot.label, "alt <em>x</em>");
        assert_eq!(&html[slot.len..], "coda");
        assert_eq!(text_of(&slot.label), "alt x");
        assert!(Slot::parse("<div class=\"embed\"><div>x</div></div>").is_none());
    }
}
