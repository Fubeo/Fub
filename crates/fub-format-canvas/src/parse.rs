//! Parse `.canvas` → modello persistito + [`DocumentModel`].
//!
//! Due livelli, due responsabilità:
//! - il [`Canvas`] tipizzato (serde) valida e conserva gli `extra` verbatim;
//! - [`json_map`](super::json_map) dà le posizioni esatte di ogni literale nel
//!   sorgente, con mappa per char fra testo decodificato e byte JSON grezzi.
//!
//! Card testuali: grammatica markdown **reale**, riusando il provider markdown
//! (`fub_format_markdown::MarkdownProvider`) sul testo decodificato della card.
//! Niente scanner locale di `[[..]]`: codice fenced/inline, link markdown,
//! escape e tutto il resto valgono come nel markdown — ciò che lì non è un
//! link qui non è un link. Link/tag/heading tornano con span decodificati che
//! si rimappano in byte grezzi assoluti via mappa esatta: con escape nel
//! literale o link ripetuti, ogni occorrenza è identificata dal suo span, mai
//! dalla prima che somiglia.
//!
//! Card file: `LinkTarget::Path` normalizzato dalla radice con percent-encoding
//! (DocId letterale relativo al vault, non URL relativo alla nota) + span
//! esatto del contenuto del literale; il `subpath` resta fragment e non sposta
//! gli archi. Card link/gruppi/edge-label: testo per indice e anteprima, mai
//! archi.
//!
//! I literali sono legati al **percorso JSON** (`nodes[i].text|file|url|label`,
//! `edges[j].label`) via [`json_map::canvas_literals`]: un `"text"` dentro
//! `extra`, alla radice o in un'altra card non è mai scambiato per quello del
//! nodo corrente, a prescindere da chiavi arbitrarie e ordinamenti.

use fub_abi::format::{DocumentSource, ParseContext};
use fub_abi::model::{
    Block, DocId, DocumentModel, Frontmatter, Heading, HeadingSlugs, Link, LinkTarget, Span, Tag,
};
use fub_abi::options::{syntax, OptionMap};
use fub_abi::rules::{path as rules_path, tag};
use fub_abi::{FormatError, FormatProvider};

use super::json_map::{canvas_literals, decoded_to_raw, find_edge_literal, find_node_literal};
use super::json_map::{CanvasField, MappedLiteral};
use super::model::{Canvas, CanvasError, CanvasNodeType, MAX_SOURCE_BYTES};

pub fn parse_canvas(source: &str) -> Result<Canvas, CanvasError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(CanvasError::Limit {
            what: "source bytes",
            limit: MAX_SOURCE_BYTES,
        });
    }
    if source.trim().is_empty() {
        return Ok(Canvas::default());
    }
    let canvas: Canvas = serde_json::from_str(source)?;
    canvas.validate()?;
    Ok(canvas)
}

pub fn parse_document(source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
    let canvas = parse_canvas(source).map_err(|e| match &e {
        CanvasError::Json(_) => FormatError::Parse(e.to_string()),
        CanvasError::Limit { .. } => FormatError::Parse(e.to_string()),
        CanvasError::Invalid(_) => FormatError::Parse(e.to_string()),
    })?;
    let literals = canvas_literals(source).map_err(FormatError::Parse)?;

    let id = DocId::new(ctx.doc_id.clone());
    let mut links: Vec<Link> = Vec::new();
    let mut tags: Vec<Tag> = Vec::new();
    let mut slugs = HeadingSlugs::new();
    let mut outline: Vec<Heading> = Vec::new();
    let mut text_parts: Vec<String> = Vec::new();

    for (node_index, node) in canvas.nodes.iter().enumerate() {
        match node.node_type {
            CanvasNodeType::Text => {
                if let Some(text) = node.text.as_deref() {
                    let Some(lit) = find_node_literal(&literals, node_index, CanvasField::Text)
                    else {
                        return Err(FormatError::Parse(
                            "canvas text card has no matching JSON literal".to_string(),
                        ));
                    };
                    if lit.decoded != text {
                        return Err(FormatError::Parse(
                            "canvas text literal does not match the validated model".to_string(),
                        ));
                    }
                    index_text_card(
                        lit.decoded.as_str(),
                        lit,
                        ctx,
                        &mut links,
                        &mut tags,
                        &mut outline,
                        &mut slugs,
                        &mut text_parts,
                    )?;
                }
            }
            CanvasNodeType::File => {
                if let Some(file) = node.file.as_deref() {
                    let Some(lit) = find_node_literal(&literals, node_index, CanvasField::File)
                    else {
                        return Err(FormatError::Parse(
                            "canvas file card has no matching JSON literal".to_string(),
                        ));
                    };
                    if lit.decoded != file {
                        return Err(FormatError::Parse(
                            "canvas file literal does not match the validated model".to_string(),
                        ));
                    }
                    links.push(Link {
                        target: vault_path_target(file),
                        embed: is_media_path(file),
                        span: Span::new(lit.content_start, lit.content_end),
                        context: Some(file.to_string()),
                    });
                    if let Some(label) = node.label.as_deref() {
                        if let Some(lit) =
                            find_node_literal(&literals, node_index, CanvasField::Label)
                        {
                            if lit.decoded == label {
                                index_label_tags(label, lit, ctx, &mut tags);
                            }
                        }
                        text_parts.push(label.to_string());
                    }
                }
            }
            CanvasNodeType::Link => {
                if let Some(url) = node.url.as_deref() {
                    // URL remoto: mai un arco del grafo; contesto per indice.
                    let Some(lit) = find_node_literal(&literals, node_index, CanvasField::Url)
                    else {
                        return Err(FormatError::Parse(
                            "canvas link card has no matching JSON literal".to_string(),
                        ));
                    };
                    if lit.decoded != url {
                        return Err(FormatError::Parse(
                            "canvas url literal does not match the validated model".to_string(),
                        ));
                    }
                    links.push(Link {
                        target: LinkTarget::Url(url.to_string()),
                        embed: false,
                        span: Span::new(lit.content_start, lit.content_end),
                        context: Some(url.to_string()),
                    });
                    text_parts.push(url.to_string());
                }
            }
            CanvasNodeType::Group => {
                if let Some(label) = node.label.as_deref() {
                    if let Some(lit) = find_node_literal(&literals, node_index, CanvasField::Label)
                    {
                        if lit.decoded == label {
                            if ctx.enabled(syntax::TAGS) {
                                index_label_tags(label, lit, ctx, &mut tags);
                            }
                            outline.push(Heading {
                                level: 2,
                                text: label.trim().to_string(),
                                slug: slugs.next_slug(label.trim()),
                                span: Span::new(lit.content_start, lit.content_end),
                                explicit_anchor: None,
                            });
                        } else {
                            outline.push(Heading {
                                level: 2,
                                text: label.trim().to_string(),
                                slug: slugs.next_slug(label.trim()),
                                span: Span::EMPTY,
                                explicit_anchor: None,
                            });
                        }
                    } else {
                        outline.push(Heading {
                            level: 2,
                            text: label.trim().to_string(),
                            slug: slugs.next_slug(label.trim()),
                            span: Span::EMPTY,
                            explicit_anchor: None,
                        });
                    }
                    text_parts.push(label.to_string());
                }
            }
        }
    }
    // Edge labels: testo per indice/anteprima, mai archi del grafo.
    for (edge_index, edge) in canvas.edges.iter().enumerate() {
        if let Some(label) = edge.label.as_deref() {
            if ctx.enabled(syntax::TAGS) {
                if let Some(lit) = find_edge_literal(&literals, edge_index) {
                    if lit.decoded == label {
                        index_label_tags(label, lit, ctx, &mut tags);
                    }
                }
            }
            text_parts.push(label.to_string());
        }
    }

    // Body: un CodeBlock per card (testo verbatim per anteprima). Nessun
    // Custom: la tela non inventa kind.
    let mut body: Vec<Block> = Vec::new();
    for node in &canvas.nodes {
        match node.node_type {
            CanvasNodeType::Text => {
                if let Some(text) = node.text.as_deref() {
                    body.push(Block::CodeBlock {
                        lang: Some("canvas-text".to_string()),
                        code: text.to_string(),
                        anchor: Some(node.id.clone()),
                        span: Span::EMPTY,
                    });
                }
            }
            CanvasNodeType::File => {
                if let Some(file) = node.file.as_deref() {
                    body.push(Block::CodeBlock {
                        lang: Some("canvas-file".to_string()),
                        code: display_file(file, node.subpath.as_deref()),
                        anchor: Some(node.id.clone()),
                        span: Span::EMPTY,
                    });
                }
            }
            CanvasNodeType::Link => {
                if let Some(url) = node.url.as_deref() {
                    body.push(Block::CodeBlock {
                        lang: Some("canvas-url".to_string()),
                        code: url.to_string(),
                        anchor: Some(node.id.clone()),
                        span: Span::EMPTY,
                    });
                }
            }
            CanvasNodeType::Group => {
                if let Some(label) = node.label.as_deref() {
                    body.push(Block::CodeBlock {
                        lang: Some("canvas-group".to_string()),
                        code: label.to_string(),
                        anchor: Some(node.id.clone()),
                        span: Span::EMPTY,
                    });
                }
            }
        }
    }

    Ok(DocumentModel {
        id,
        frontmatter: Frontmatter::default(),
        body,
        outline,
        links,
        tags,
        anchors: Vec::new(),
        text: text_parts.join("\n\n").trim().to_string(),
        frontmatter_present: false,
    })
}

fn display_file(file: &str, subpath: Option<&str>) -> String {
    match subpath {
        Some(sub) => format!("{file}{sub}"),
        None => file.to_string(),
    }
}

/// Stesso normalizzatore per il rewrite: confronta il valore logico del
/// literale col target osservato dal kernel senza duplicare la regola.
pub(crate) fn vault_path_target_for_rewrite(file: &str) -> LinkTarget {
    vault_path_target(file)
}

/// Il `file` JSON Canvas è un DocId letterale relativo al vault — **non** un
/// URL relativo alla nota. Si normalizza con le regole path del contratto
/// (percent-decode → segmenti → join) e si marca dalla radice con `/`:
/// altrimenti il grafo risolverebbe una card di `Boards/tela.canvas` a partire
/// da `Boards/`, anziché dalla radice del vault.
fn vault_path_target(file: &str) -> LinkTarget {
    let (path, fragment) = rules_path::split_fragment(file);
    let decoded = rules_path::percent_decode(path.trim());
    let mut segments: Vec<&str> = Vec::new();
    for seg in decoded.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    let mut out = format!("/{}", segments.join("/"));
    out.push_str(fragment);
    LinkTarget::Path(out)
}

fn is_media_path(file: &str) -> bool {
    let (path, _) = rules_path::split_fragment(file);
    let lower = path.to_ascii_lowercase();
    [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp", ".ico", ".mp4", ".webm",
        ".ogv", ".mov", ".mp3", ".ogg", ".wav", ".flac", ".pdf",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

/// Contesto di lettura della card: le stesse sintassi accese del documento,
/// così un flag spento fuori resta spento dentro.
fn card_ctx(ctx: &ParseContext) -> ParseContext {
    let mut options = OptionMap::new();
    for name in [
        syntax::WIKILINKS,
        syntax::TAGS,
        syntax::EMBEDS,
        syntax::FRONTMATTER,
        syntax::CALLOUTS,
        syntax::FOOTNOTES,
        syntax::DEFINITION_LISTS,
        syntax::DIAGRAMS,
        syntax::MATH,
        syntax::HIGHLIGHT,
    ] {
        if ctx.enabled(name) {
            options = options.on(name);
        }
    }
    ParseContext {
        doc_id: ctx.doc_id.clone(),
        options,
    }
}

/// Card testo con grammatica markdown reale: si parsa il decodificato col
/// provider markdown e si rimappano link, tag e heading in byte grezzi
/// assoluti via mappa esatta. Ogni occorrenza è identificata dal suo span —
/// con escape o link ripetuti non c'è nessuna ricerca per contenuto.
#[allow(clippy::too_many_arguments)]
fn index_text_card(
    lit_decoded: &str,
    lit: &MappedLiteral,
    ctx: &ParseContext,
    links: &mut Vec<Link>,
    tags: &mut Vec<Tag>,
    outline: &mut Vec<Heading>,
    slugs: &mut HeadingSlugs,
    text_parts: &mut Vec<String>,
) -> Result<(), FormatError> {
    let card_ctx = card_ctx(ctx);
    let card = fub_format_markdown::MarkdownProvider::new()
        .parse(&DocumentSource::Text(lit_decoded.to_string()), &card_ctx)
        .map_err(|e| match e {
            FormatError::Unsupported { .. } => {
                FormatError::Parse("canvas text card is not a text source".to_string())
            }
            other => other,
        })?;
    let raw_len = lit.content_end - lit.content_start;
    for link in &card.links {
        let Some((rs, re)) = decoded_to_raw(&lit.map, raw_len, link.span.start, link.span.end)
        else {
            return Err(FormatError::Parse(
                "canvas text link does not map to JSON bytes".to_string(),
            ));
        };
        links.push(Link {
            target: link.target.clone(),
            embed: link.embed,
            span: Span::new(lit.content_start + rs, lit.content_start + re),
            context: link.context.clone(),
        });
    }
    for tag_found in &card.tags {
        let Some((rs, re)) =
            decoded_to_raw(&lit.map, raw_len, tag_found.span.start, tag_found.span.end)
        else {
            return Err(FormatError::Parse(
                "canvas text tag does not map to JSON bytes".to_string(),
            ));
        };
        tags.push(Tag {
            name: tag_found.name.clone(),
            span: Span::new(lit.content_start + rs, lit.content_start + re),
        });
    }
    for heading in &card.outline {
        let span = decoded_to_raw(&lit.map, raw_len, heading.span.start, heading.span.end)
            .map(|(rs, re)| Span::new(lit.content_start + rs, lit.content_start + re))
            .unwrap_or(Span::EMPTY);
        outline.push(Heading {
            level: heading.level,
            text: heading.text.clone(),
            slug: slugs.next_slug(&heading.text),
            span,
            explicit_anchor: heading.explicit_anchor.clone(),
        });
    }
    if card.text.is_empty() {
        text_parts.push(lit_decoded.to_string());
    } else {
        text_parts.push(card.text.clone());
    }
    Ok(())
}

/// Tag dentro un'etichetta (gruppi, file, edge): testo semplice, span
/// rimappati in byte grezzi assoluti come per le card.
fn index_label_tags(label: &str, lit: &MappedLiteral, ctx: &ParseContext, tags: &mut Vec<Tag>) {
    if !ctx.enabled(syntax::TAGS) {
        return;
    }
    let _ = label;
    let raw_len = lit.content_end - lit.content_start;
    for found in tag::scan_tags(&lit.decoded) {
        if let Some((rs, re)) = decoded_to_raw(&lit.map, raw_len, found.span.start, found.span.end)
        {
            tags.push(Tag {
                name: found.name,
                span: Span::new(lit.content_start + rs, lit.content_start + re),
            });
        }
    }
}
