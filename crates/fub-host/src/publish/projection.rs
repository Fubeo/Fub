//! Static projection from the document AST. Never runs a dynamic block or
//! follows a link to an unapproved vault document.
use fub_abi::html::{attr, escape};
use fub_abi::model::{custom_kind, Block, DocId, DocumentModel, Inline, LinkTarget};
use fub_abi::rules::loads::text_payload;
use fub_abi::rules::path::resolution_key;
use fub_format_canvas::{parse_canvas, CanvasNodeType};
use std::borrow::Cow;
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

/// Perché un costrutto non si proietta. Quasi sempre una frase fissa; il kind
/// di un `Custom` sconosciuto invece si legge nel modello.
type Refused = Cow<'static, str>;

/// Una pagina che non si proietta: la nota e il costrutto che la fermano.
///
/// Una sola nota rifiutata ferma l'export dell'intero sito, quindi l'errore
/// deve dire quale nota aprire e che cosa cercarci dentro.
#[derive(Debug)]
pub struct Refusal {
    pub doc: String,
    pub reason: Refused,
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "`{}` cannot be published: {}", self.doc, self.reason)
    }
}

/// The local references of one page, already resolved by the vault index
/// (`IndexQuery::Resolve`): the rule the app follows when it navigates, so a
/// short `[[Note]]` reaches `dir/Note.md` and a link needs no `.md` guess.
/// Keys are written forms: a wikilink's page, a local link's path without its
/// fragment. A reference missing here resolved to nothing.
#[derive(Debug, Default)]
pub struct Resolved {
    pub wiki: BTreeMap<String, DocId>,
    pub paths: BTreeMap<String, DocId>,
}

/// What projecting one page knows besides its model.
#[derive(Clone, Copy)]
struct Projection<'a> {
    /// The projected document: relative asset paths start here.
    source: &'a str,
    site: &'a str,
    /// Approved pages: document id -> route inside the site.
    pages: &'a BTreeMap<String, String>,
    /// Approved assets, by exact vault path.
    assets: &'a BTreeSet<String>,
    links: &'a Resolved,
    notes: &'a Notes,
}

pub fn page(
    model: &DocumentModel,
    site_id: &str,
    pages: &BTreeMap<String, String>,
    assets: &BTreeSet<String>,
    links: &Resolved,
) -> Result<String, Refusal> {
    let mut html = String::new();
    let notes = Notes::of(&model.body);
    let projection = Projection {
        source: &model.id.0,
        site: site_id,
        pages,
        assets,
        links,
        notes: &notes,
    };
    blocks(&model.body, projection, &mut html, 0).map_err(|reason| Refusal {
        doc: model.id.0.clone(),
        reason,
    })?;
    Ok(html)
}

/// Le note a piè di pagina della pagina.
///
/// Richiami e definizioni li ha già abbinati il provider: un richiamo senza
/// definizione arriva `unresolved`, una definizione senza richiami
/// `unreferenced`. Qui resta soltanto da legarli con un'ancora. L'ancora è
/// `fn-N`, con N l'ordine della definizione nella pagina, quindi è sicura
/// qualunque cosa contenga l'etichetta. Le etichette si confrontano con
/// [`resolution_key`], perché comrak abbina richiamo e definizione senza
/// badare al caso. Se due definizioni portano la stessa etichetta, il
/// richiamo porta alla prima.
#[derive(Default)]
struct Notes {
    /// Chiave dell'etichetta -> numero della prima definizione che la porta.
    targets: BTreeMap<String, usize>,
    /// Le definizioni già scritte. Le due visite vanno nello stesso ordine,
    /// quindi la prossima definizione scritta ha il numero seguente.
    written: Cell<usize>,
}

impl Notes {
    fn of(body: &[Block]) -> Self {
        let mut notes = Notes::default();
        let mut shown = 0;
        notes.collect(body, &mut shown, 0);
        notes
    }

    /// Numera le definizioni visibili nell'ordine in cui [`blocks`] le scrive.
    fn collect(&mut self, source: &[Block], shown: &mut usize, depth: usize) {
        if depth >= 64 {
            return;
        }
        for block in source {
            match block {
                Block::List { items, .. } => {
                    for item in items {
                        self.collect(&item.blocks, shown, depth + 1);
                    }
                }
                Block::Quote { blocks, .. } => self.collect(blocks, shown, depth + 1),
                Block::Custom {
                    custom_kind: kind,
                    attrs,
                    blocks,
                    ..
                } => {
                    if kind == custom_kind::FOOTNOTE_DEFINITION && !flag(attrs, "unreferenced") {
                        *shown += 1;
                        if let Some(label) = label(attrs) {
                            self.targets.entry(resolution_key(label)).or_insert(*shown);
                        }
                    }
                    self.collect(blocks, shown, depth + 1);
                }
                _ => {}
            }
        }
    }

    /// Il numero della definizione che [`blocks`] sta per scrivere.
    fn next(&self) -> usize {
        let number = self.written.get() + 1;
        self.written.set(number);
        number
    }

    /// Il numero della definizione a cui porta un richiamo, se è nella pagina.
    fn target(&self, label: &str) -> Option<usize> {
        self.targets.get(&resolution_key(label)).copied()
    }
}

fn flag(attrs: &serde_json::Value, key: &str) -> bool {
    attrs.get(key).and_then(|value| value.as_bool()) == Some(true)
}

fn label(attrs: &serde_json::Value) -> Option<&str> {
    attrs.get("label").and_then(|value| value.as_str())
}

/// The site route of a resolved vault document, if it is an approved page.
fn route_of<'a>(p: Projection<'a>, doc: Option<&DocId>) -> Option<&'a String> {
    p.pages.get(doc?.as_str())
}

fn blocks(
    source: &[Block],
    p: Projection<'_>,
    out: &mut String,
    depth: usize,
) -> Result<(), Refused> {
    if depth >= 64 {
        return Err("publish projection depth exceeded".into());
    }
    for block in source {
        match block {
            Block::Heading {
                level,
                inlines,
                anchor,
                ..
            } if (1..=6).contains(level) => {
                out.push_str(&format!("<h{level}"));
                if let Some(anchor) = anchor {
                    out.push_str(&attr("id", anchor));
                }
                out.push('>');
                inlines_into(inlines, p, out, depth + 1)?;
                out.push_str(&format!("</h{level}>\n"));
            }
            Block::Paragraph { inlines, .. } => {
                out.push_str("<p>");
                inlines_into(inlines, p, out, depth + 1)?;
                out.push_str("</p>\n");
            }
            Block::List {
                ordered,
                items,
                start,
                ..
            } => {
                if *ordered {
                    out.push_str("<ol");
                    if let Some(start) = start {
                        out.push_str(&attr("start", &start.to_string()));
                    }
                    out.push('>');
                } else {
                    out.push_str("<ul>");
                }
                for item in items {
                    out.push_str("<li>");
                    blocks(&item.blocks, p, out, depth + 1)?;
                    out.push_str("</li>");
                }
                out.push_str(if *ordered { "</ol>\n" } else { "</ul>\n" });
            }
            Block::Quote { blocks: inner, .. } => {
                out.push_str("<blockquote>");
                blocks(inner, p, out, depth + 1)?;
                out.push_str("</blockquote>\n");
            }
            Block::CodeBlock { code, .. } => {
                out.push_str("<pre><code>");
                out.push_str(&escape(code));
                out.push_str("</code></pre>\n");
            }
            Block::ThematicBreak { .. } => out.push_str("<hr>\n"),
            Block::Table { head, rows, .. } => {
                out.push_str("<table>");
                if let Some(head) = head {
                    out.push_str("<thead><tr>");
                    for cell in &head.cells {
                        out.push_str("<th>");
                        inlines_into(&cell.inlines, p, out, depth + 1)?;
                        out.push_str("</th>");
                    }
                    out.push_str("</tr></thead>");
                }
                out.push_str("<tbody>");
                for row in rows {
                    out.push_str("<tr>");
                    for cell in &row.cells {
                        out.push_str("<td>");
                        inlines_into(&cell.inlines, p, out, depth + 1)?;
                        out.push_str("</td>");
                    }
                    out.push_str("</tr>");
                }
                out.push_str("</tbody></table>\n");
            }
            // Un callout è una citazione col suo tipo e il suo titolo. Il sito
            // non ha un tema: il tipo resta un attributo per chi porta il
            // proprio CSS, e il titolo si legge in grassetto.
            Block::Custom {
                custom_kind: kind,
                attrs,
                blocks: inner,
                ..
            } if kind == custom_kind::CALLOUT => {
                let callout = attrs
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("note");
                out.push_str("<blockquote class=\"callout\"");
                out.push_str(&attr("data-callout", callout));
                out.push('>');
                if let Some(title) = attrs
                    .get("title")
                    .and_then(|value| value.as_str())
                    .filter(|title| !title.is_empty())
                {
                    out.push_str("<p class=\"callout-title\"><strong>");
                    out.push_str(&escape(title));
                    out.push_str("</strong></p>");
                }
                blocks(inner, p, out, depth + 1)?;
                out.push_str("</blockquote>\n");
            }
            Block::Custom {
                custom_kind: kind,
                attrs,
                blocks: inner,
                ..
            } if kind == custom_kind::FOOTNOTE_DEFINITION => {
                // Una definizione che nessun richiamo usa sta nel file, non
                // nella resa: lo stesso che fa l'anteprima.
                if flag(attrs, "unreferenced") {
                    continue;
                }
                let label = label(attrs).ok_or("footnote without label")?;
                let number = p.notes.next();
                out.push_str(&format!(
                    "<div class=\"block-footnote-definition\" id=\"fn-{number}\"><p>"
                ));
                out.push_str("<sup class=\"footnote-label\">");
                out.push_str(&escape(label));
                out.push_str("</sup>");
                // L'etichetta apre il primo paragrafo invece di stare da sola
                // su una riga.
                let rest = match inner.split_first() {
                    Some((Block::Paragraph { inlines, .. }, rest)) => {
                        out.push(' ');
                        inlines_into(inlines, p, out, depth + 1)?;
                        rest
                    }
                    _ => inner.as_slice(),
                };
                out.push_str("</p>\n");
                blocks(rest, p, out, depth + 1)?;
                out.push_str("</div>\n");
            }
            // Una definizione di riferimento è un indirizzo, non prosa: comrak
            // l'ha già messa nei link che la usano, e la pagina non la mostra.
            // L'anteprima la lascia leggere a chi scrive, che la sta scrivendo.
            Block::ReferenceDefinition { .. } => {}
            // Il recinto `math`: lo stesso TeX fra dollari della formula a
            // display in linea, in un blocco suo e su righe sue, come lo si
            // scrive.
            Block::Custom {
                custom_kind: kind,
                attrs,
                ..
            } if kind == custom_kind::MATH => {
                let tex = text_payload(kind, attrs).ok_or("formula without source")?;
                out.push_str("<div class=\"math-block\">");
                let tex = tex.trim_end_matches(['\r', '\n']);
                out.push_str(&escape(&format!("$$\n{tex}\n$$")));
                out.push_str("</div>\n");
            }
            // Un sito statico non ha un motore di diagrammi: resta il sorgente,
            // il blocco di codice che la nota ha scritto, col suo motore.
            Block::Custom {
                custom_kind: kind,
                attrs,
                ..
            } if kind == custom_kind::DIAGRAM => {
                let source = text_payload(kind, attrs).ok_or("diagram without source")?;
                let engine = attrs
                    .get("engine")
                    .and_then(|value| value.as_str())
                    .ok_or("diagram without engine")?;
                out.push_str("<pre class=\"diagram\"");
                out.push_str(&attr("data-engine", engine));
                out.push_str("><code>");
                out.push_str(&escape(source));
                out.push_str("</code></pre>\n");
            }
            // Blocchi dinamici o di terzi non hanno un significato statico
            // verificato. Meglio rifiutare che perdere contenuto in silenzio,
            // e il rifiuto dice quale.
            other => return Err(unsupported_block(other)),
        }
    }
    Ok(())
}

fn unsupported_block(block: &Block) -> Refused {
    match block {
        Block::Custom { custom_kind, .. } => {
            format!("the `{custom_kind}` block has no static projection").into()
        }
        Block::ReferenceDefinition { .. } => {
            "a link reference definition has no static projection".into()
        }
        Block::Heading { level, .. } => {
            format!("a level {level} heading has no static projection").into()
        }
        _ => "this block has no static projection".into(),
    }
}

fn inlines_into(
    source: &[Inline],
    p: Projection<'_>,
    out: &mut String,
    depth: usize,
) -> Result<(), Refused> {
    if depth >= 64 {
        return Err("publish inline depth exceeded".into());
    }
    for inline in source {
        match inline {
            Inline::Text(text) | Inline::Code(text) => {
                if matches!(inline, Inline::Code(_)) {
                    out.push_str("<code>");
                }
                out.push_str(&escape(text));
                if matches!(inline, Inline::Code(_)) {
                    out.push_str("</code>");
                }
            }
            Inline::Emph(inner)
            | Inline::Strong(inner)
            | Inline::Superscript(inner)
            | Inline::Strikethrough(inner) => {
                let tag = match inline {
                    Inline::Emph(_) => "em",
                    Inline::Strong(_) => "strong",
                    Inline::Superscript(_) => "sup",
                    _ => "del",
                };
                out.push_str(&format!("<{tag}>"));
                inlines_into(inner, p, out, depth + 1)?;
                out.push_str(&format!("</{tag}>"));
            }
            Inline::TagRef { name, .. } => {
                out.push('#');
                out.push_str(&escape(name));
            }
            Inline::HardBreak => out.push_str("<br>"),
            Inline::SoftBreak => out.push(' '),
            Inline::Link {
                target,
                label,
                embed,
                ..
            } => {
                let destination = match target {
                    LinkTarget::Url(url) if !*embed && safe_external(url) => url.clone(),
                    LinkTarget::Path(path) => {
                        let (path, fragment) = path.split_once('#').unwrap_or((path, ""));
                        if !fragment
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                        {
                            return Err("unsafe link anchor".into());
                        }
                        let id = source_path(p.source, path).ok_or("unsafe link path")?;
                        if *embed {
                            if !is_image(&id) || !p.assets.contains(&id) {
                                return Err("image requires approved asset projection".into());
                            }
                            format!("/s/{}/{}", p.site, id)
                        } else {
                            let route = route_of(p, p.links.paths.get(path))
                                .ok_or("link target is not published")?;
                            format!(
                                "/s/{}/{}{}{}",
                                p.site,
                                route,
                                if fragment.is_empty() { "" } else { "#" },
                                fragment
                            )
                        }
                    }
                    LinkTarget::Wiki {
                        page,
                        heading,
                        block,
                    } if !*embed => {
                        if block.is_some() {
                            return Err("block link needs verified projection".into());
                        }
                        let route = if target.names_host() {
                            p.pages.get(p.source)
                        } else {
                            route_of(p, p.links.wiki.get(page))
                        }
                        .ok_or("wikilink target is not published")?;
                        let fragment = heading.as_deref().unwrap_or("");
                        if !fragment
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                        {
                            return Err("unsupported heading link".into());
                        }
                        format!(
                            "/s/{}/{}{}{}",
                            p.site,
                            route,
                            if fragment.is_empty() { "" } else { "#" },
                            fragment
                        )
                    }
                    _ => return Err("remote embed or unsafe link has no static projection".into()),
                };
                if *embed {
                    out.push_str("<img");
                    out.push_str(&attr("src", &destination));
                    out.push_str(&attr(
                        "alt",
                        label
                            .as_ref()
                            .and_then(|l| l.first())
                            .and_then(|n| match n {
                                Inline::Text(t) => Some(t.as_str()),
                                _ => None,
                            })
                            .unwrap_or(""),
                    ));
                    out.push('>');
                } else {
                    out.push_str("<a");
                    out.push_str(&attr("href", &destination));
                    out.push('>');
                    if let Some(label) = label {
                        inlines_into(label, p, out, depth + 1)?;
                    } else {
                        out.push_str(&escape(match target {
                            LinkTarget::Wiki { page, .. } => page,
                            LinkTarget::Url(url) => url,
                            LinkTarget::Path(path) => path,
                        }));
                    }
                    out.push_str("</a>");
                }
            }
            // A static site has no TeX engine: a formula publishes as its TeX
            // source between its dollars, the text the note itself carries.
            Inline::Custom {
                custom_kind, attrs, ..
            } if custom_kind == custom_kind::MATH => {
                let tex = text_payload(custom_kind, attrs).ok_or("formula without source")?;
                let dollars = if attrs.get("display").and_then(|v| v.as_bool()) == Some(true) {
                    "$$"
                } else {
                    "$"
                };
                out.push_str(&escape(&format!("{dollars}{tex}{dollars}")));
            }
            Inline::Custom {
                custom_kind: kind,
                attrs,
                ..
            } if kind == custom_kind::FOOTNOTE_REFERENCE => {
                let label = label(attrs).ok_or("footnote without label")?;
                if flag(attrs, "unresolved") {
                    // Un richiamo che non trova la sua definizione si legge
                    // com'è scritto.
                    out.push_str(&escape(&format!("[^{label}]")));
                } else if flag(attrs, "inline") {
                    out.push_str("<sup class=\"footnote-inline\">");
                    out.push_str(&escape(label));
                    out.push_str("</sup>");
                } else {
                    out.push_str("<sup class=\"footnote-ref\">");
                    match p.notes.target(label) {
                        Some(number) => {
                            out.push_str(&format!("<a href=\"#fn-{number}\">"));
                            out.push_str(&escape(label));
                            out.push_str("</a>");
                        }
                        None => out.push_str(&escape(label)),
                    }
                    out.push_str("</sup>");
                }
            }
            // `<mark>` non è fra i tag che il servizio accetta senza
            // isolamento: l'evidenziato è uno span, e il testo resta.
            Inline::Custom {
                custom_kind: kind,
                attrs,
                ..
            } if kind == custom_kind::HIGHLIGHT => {
                let text = text_payload(kind, attrs).ok_or("highlight without text")?;
                out.push_str("<span class=\"inline-highlight\">");
                out.push_str(&escape(text));
                out.push_str("</span>");
            }
            // Un commento è testo dell'autore per sé: resta nel file e non
            // arriva in rete.
            Inline::Custom {
                custom_kind: kind, ..
            } if kind == custom_kind::COMMENT => {}
            Inline::Custom { custom_kind, .. } => {
                return Err(format!("the `{custom_kind}` inline has no static projection").into())
            }
        }
    }
    Ok(())
}

pub fn is_image(path: &str) -> bool {
    [".png", ".jpg", ".jpeg", ".webp", ".ico"]
        .iter()
        .any(|ext| path.ends_with(ext))
}

fn safe_external(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:"))
        && !url.contains(['<', '>', '"', '\'', '\\'])
        && !url.chars().any(char::is_control)
}

pub fn source_path(source: &str, path: &str) -> Option<String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with("//")
        || path.contains(['?', '#', '%', '\\', ':'])
    {
        return None;
    }
    let mut parts: Vec<&str> = source
        .rsplit_once('/')
        .map(|(parent, _)| parent.split('/').collect())
        .unwrap_or_default();
    for part in path.split('/') {
        match part {
            "." => {}
            ".." => {
                parts.pop()?;
            }
            "" => return None,
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

/// JSON Canvas has a deterministic, inert subset: text/group cards and
/// connections between them. The document is read by the canvas format's own
/// parser; this projector only narrows it. File/web cards, backgrounds and any
/// member the model keeps as unknown (`extra`) fail closed.
pub fn canvas(bytes: &[u8]) -> Result<String, &'static str> {
    if bytes.len() > 1_048_576 {
        return Err("canvas exceeds publish cap");
    }
    let source = std::str::from_utf8(bytes).map_err(|_| "bad canvas json")?;
    let canvas = parse_canvas(source).map_err(|_| "bad canvas json")?;
    if !canvas.extra.is_empty() {
        return Err("unknown canvas fields need a verified projector");
    }
    if canvas.nodes.len() > 256 || canvas.edges.len() > 1024 {
        return Err("canvas exceeds publish cap");
    }
    let mut out = String::from(
        "<h1>Canvas</h1><table><thead><tr><th>Card</th><th>Text</th></tr></thead><tbody>",
    );
    for node in &canvas.nodes {
        if !node.extra.is_empty() || node.background.is_some() || node.background_style.is_some() {
            return Err("unknown canvas node needs a verified projector");
        }
        let text = match node.node_type {
            CanvasNodeType::Text => node.text.as_deref(),
            CanvasNodeType::Group => node.label.as_deref(),
            CanvasNodeType::File | CanvasNodeType::Link => {
                return Err("canvas file or remote card cannot publish")
            }
        };
        // A text or group card that also names a file or a URL carries a
        // reference this projection would silently drop.
        if node.file.is_some() || node.subpath.is_some() || node.url.is_some() {
            return Err("canvas file or remote card cannot publish");
        }
        let text = text.ok_or("canvas card missing text")?;
        out.push_str("<tr><td>");
        out.push_str(&escape(&node.id));
        out.push_str("</td><td>");
        out.push_str(&escape(text));
        out.push_str("</td></tr>");
    }
    out.push_str("</tbody></table><h2>Connections</h2><ul>");
    // The parser has already refused duplicate cards and dangling edges.
    for edge in &canvas.edges {
        if !edge.extra.is_empty() {
            return Err("unknown canvas edge needs a verified projector");
        }
        out.push_str("<li>");
        out.push_str(&escape(&edge.from_node));
        out.push_str(" → ");
        out.push_str(&escape(&edge.to_node));
        out.push_str("</li>");
    }
    out.push_str("</ul>");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::Span;
    use serde_json::json;

    fn inline(kind: &str, attrs: serde_json::Value) -> Inline {
        Inline::Custom {
            custom_kind: kind.into(),
            attrs,
            span: Span::EMPTY,
        }
    }

    fn paragraph(inlines: Vec<Inline>) -> Block {
        Block::Paragraph {
            inlines,
            anchor: None,
            span: Span::EMPTY,
        }
    }

    fn definition(attrs: serde_json::Value, text: &str) -> Block {
        Block::Custom {
            custom_kind: custom_kind::FOOTNOTE_DEFINITION.into(),
            attrs,
            blocks: vec![paragraph(vec![Inline::Text(text.into())])],
            anchor: None,
            span: Span::EMPTY,
        }
    }

    fn project(body: Vec<Block>) -> Result<String, Refusal> {
        let mut model = DocumentModel::empty(DocId::new("dir/nota.md"));
        model.body = body;
        page(
            &model,
            "blog",
            &BTreeMap::new(),
            &BTreeSet::new(),
            &Resolved::default(),
        )
    }

    /// L'evidenziato e il commento sul modello; dalle regole reali di
    /// `fub.blocks` li fa passare `tests/publish_notes.rs`.
    #[test]
    fn a_highlight_keeps_its_text_and_a_comment_stays_out() {
        let html = project(vec![paragraph(vec![
            Inline::Text("a ".into()),
            inline(custom_kind::HIGHLIGHT, json!({ "text": "<x>" })),
            inline(custom_kind::COMMENT, json!({ "source": "%%segreto%%" })),
        ])])
        .unwrap();
        assert_eq!(
            html,
            "<p>a <span class=\"inline-highlight\">&lt;x&gt;</span></p>\n"
        );
    }

    /// Le due visite numerano nello stesso ordine: una definizione dentro
    /// una citazione prende il suo numero dove sta, una non richiamata non ne
    /// consuma uno, e un'etichetta ripetuta porta alla prima definizione. Il
    /// caso dell'etichetta non conta, né sul richiamo né sulla definizione.
    #[test]
    fn each_reference_reaches_the_anchor_of_its_definition() {
        let html = project(vec![
            paragraph(vec![
                inline(custom_kind::FOOTNOTE_REFERENCE, json!({ "label": "b" })),
                inline(custom_kind::FOOTNOTE_REFERENCE, json!({ "label": "A" })),
            ]),
            definition(json!({ "label": "mai", "unreferenced": true }), "nascosta"),
            Block::Quote {
                blocks: vec![definition(json!({ "label": "a" }), "prima")],
                anchor: None,
                span: Span::EMPTY,
            },
            definition(json!({ "label": "B" }), "seconda"),
            definition(json!({ "label": "b" }), "doppia"),
        ])
        .unwrap();
        assert!(
            html.starts_with(
                "<p><sup class=\"footnote-ref\"><a href=\"#fn-2\">b</a></sup>\
                 <sup class=\"footnote-ref\"><a href=\"#fn-1\">A</a></sup></p>\n"
            ),
            "{html}"
        );
        assert!(!html.contains("nascosta"), "{html}");
        for (number, text) in [(1, "prima"), (2, "seconda"), (3, "doppia")] {
            assert!(
                html.contains(&format!(
                    "id=\"fn-{number}\"><p><sup class=\"footnote-label\">"
                )) && html.contains(&format!("</sup> {text}</p>")),
                "{html}"
            );
        }
        assert_eq!(html.matches("<blockquote>").count(), 1, "{html}");
    }

    fn block(kind: &str, attrs: serde_json::Value) -> Block {
        Block::Custom {
            custom_kind: kind.into(),
            attrs,
            blocks: vec![],
            anchor: None,
            span: Span::EMPTY,
        }
    }

    /// La formula esce su righe sue qualunque terminatore chiuda il recinto,
    /// il diagramma col suo motore; senza i loro `attrs` la nota si ferma
    /// invece di pubblicare un blocco vuoto.
    #[test]
    fn formulas_and_diagrams_keep_their_source() {
        let html = project(vec![
            Block::ReferenceDefinition {
                label: "x".into(),
                url: "https://example.test".into(),
                title: Some("titolo".into()),
                anchor: None,
                span: Span::EMPTY,
            },
            block(
                custom_kind::MATH,
                json!({ "source": "a<b\r\n", "display": true }),
            ),
            block(custom_kind::MATH, json!({ "source": "c\n\nd" })),
            block(
                custom_kind::DIAGRAM,
                json!({ "engine": "d\"2", "source": "a -> <b>" }),
            ),
        ])
        .unwrap();
        assert_eq!(
            html,
            "<div class=\"math-block\">$$\na&lt;b\n$$</div>\n\
             <div class=\"math-block\">$$\nc\n\nd\n$$</div>\n\
             <pre class=\"diagram\" data-engine=\"d&quot;2\"><code>a -&gt; &lt;b&gt;</code></pre>\n"
        );
        for (body, reason) in [
            (
                block(custom_kind::MATH, json!({ "source": "" })),
                "formula without source",
            ),
            (
                block(custom_kind::DIAGRAM, json!({ "engine": "dot" })),
                "diagram without source",
            ),
            (
                block(custom_kind::DIAGRAM, json!({ "source": "a" })),
                "diagram without engine",
            ),
        ] {
            let refusal = project(vec![body]).unwrap_err();
            assert_eq!(refusal.reason, reason);
        }
    }

    #[test]
    fn an_unknown_inline_names_its_kind_and_its_note() {
        let refusal = project(vec![paragraph(vec![inline(
            "terzi.widget",
            json!({ "source": "x" }),
        )])])
        .unwrap_err();
        assert_eq!(
            refusal.to_string(),
            "`dir/nota.md` cannot be published: the `terzi.widget` inline has no static projection"
        );
    }

    #[test]
    fn canvas_refuses_remote_cards_and_projects_text_edges_as_inert_markup() {
        let public = br#"{"nodes":[{"id":"a","type":"text","text":"<secret>","x":0,"y":0,"width":100,"height":100},{"id":"b","type":"group","label":"Public","x":1,"y":1,"width":100,"height":100}],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}"#;
        let html = canvas(public).unwrap();
        assert!(html.contains("&lt;secret&gt;"));
        assert!(html.contains("a → b"));
        assert!(!html.contains("<secret>"));
        let remote = br#"{"nodes":[{"id":"a","type":"link","url":"https://example.test","x":0,"y":0,"width":100,"height":100}],"edges":[]}"#;
        assert!(canvas(remote).is_err());
    }
}
