wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:format/format",
    generate_all,
});
use exports::fub::abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatError, FormatErrorUnsupported,
    Guest as FormatGuest, ParseContext, RenderOptions, RenderTarget, SourceKind,
};
use exports::fub::abi::format_edits::{Guest as FormatEditsGuest, TextEdit as EditsTextEdit};
use exports::fub::abi::format_links::{
    Guest as FormatLinksGuest, LinkRewrite, TextEdit as LinksTextEdit,
};
use exports::fub::abi::plugin::{Guest as PluginGuest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::model::{Block, BlockParagraph, DocumentModel, DocumentTree, Inline, Span};
#[cfg(feature = "stateful-activation")]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(feature = "stateful-activation")]
static ACTIVATED: AtomicBool = AtomicBool::new(false);

const ID: &str = "example.format";
const TEXT: &str = "PARSE_ERROR";

struct Componente;

impl PluginGuest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: ID.to_string(),
            name: "Example Format".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.2.0".to_string(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        #[cfg(feature = "stateful-activation")]
        ACTIVATED.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn deactivate() -> Result<(), PluginError> {
        #[cfg(feature = "stateful-activation")]
        ACTIVATED.store(false, Ordering::SeqCst);
        Ok(())
    }
    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Err(PluginError::UnknownJob(fub::abi::text::Text::Literal(job)))
    }
}

impl FormatGuest for Componente {
    fn descriptor() -> FormatDescriptor {
        FormatDescriptor {
            id: ID.to_string(),
            name: "Example Format".to_string(),
            extensions: vec!["fubfmt".to_string()],
            source: SourceKind::Text,
        }
    }

    fn capabilities() -> FormatCapabilities {
        FormatCapabilities { syntax: vec![] }
    }

    fn parse(source: DocumentSource, ctx: ParseContext) -> Result<DocumentModel, FormatError> {
        let text = match source {
            DocumentSource::Text(text) => text,
            DocumentSource::Bytes(_) => {
                return Err(FormatError::Unsupported(FormatErrorUnsupported {
                    format: ID.to_string(),
                    got: SourceKind::Bytes,
                }))
            }
        };
        #[cfg(feature = "stateful-activation")]
        if !ACTIVATED.load(Ordering::SeqCst) {
            return Err(FormatError::Parse(
                "format parse observed no plugin activation".to_string(),
            ));
        }
        if cfg!(feature = "trap-on-parse") {
            panic!("example format parse trap");
        }
        if text == TEXT {
            return Err(FormatError::Parse(
                "declared example parse error".to_string(),
            ));
        }

        let span = Span {
            start: 0,
            end: text.len() as u64,
        };
        let inline = Inline::Text(text.clone());
        let root = if cfg!(feature = "malformed-model") {
            9
        } else {
            0
        };
        Ok(DocumentModel {
            id: ctx.doc_id,
            frontmatter: "{}".to_string(),
            body: DocumentTree {
                blocks: vec![Block::Paragraph(BlockParagraph {
                    inlines: vec![0],
                    anchor: None,
                    span,
                })],
                inlines: vec![inline],
                roots: vec![root],
            },
            outline: vec![],
            links: vec![],
            tags: vec![],
            anchors: vec![],
            text,
            frontmatter_present: false,
        })
    }

    fn render_html(model: DocumentModel, opts: RenderOptions) -> Result<String, FormatError> {
        let target = match opts.target {
            RenderTarget::Screen => "screen",
            RenderTarget::Print => "print",
            RenderTarget::Pdf => "pdf",
            RenderTarget::StaticSite => "static-site",
        };
        let text = render_body(&model.body)?;
        Ok(format!(
            "<p data-format=\"example-format\" data-target=\"{target}\">{}</p>",
            fub_abi::html::escape(&text)
        ))
    }

    fn serialize(model: DocumentModel) -> Result<String, FormatError> {
        Ok(format!("fubfmt:{}", model.text))
    }
}

impl FormatLinksGuest for Componente {
    fn rewrite_links(
        source: DocumentSource,
        _ctx: ParseContext,
        rewrites: Vec<LinkRewrite>,
    ) -> Result<Option<Vec<LinksTextEdit>>, FormatError> {
        let text = match source {
            DocumentSource::Text(text) => text,
            DocumentSource::Bytes(_) => {
                return Err(FormatError::Unsupported(FormatErrorUnsupported {
                    format: ID.to_string(),
                    got: SourceKind::Bytes,
                }))
            }
        };
        let mut edits = Vec::with_capacity(rewrites.len());
        for rewrite in &rewrites {
            edits.push(rewrite_one(&text, rewrite)?);
        }
        edits.sort_by_key(|edit| (edit.span.start, edit.span.end));
        for pair in edits.windows(2) {
            if pair[1].span.start < pair[0].span.end {
                return Err(FormatError::Parse(
                    "format link rewrites overlap; refusing a partial rename".to_string(),
                ));
            }
        }
        Ok(Some(edits))
    }
}

/// `fubfmt` scrive un riferimento a pagina come `[[pagina]]`, con `!` davanti
/// se incorpora, e l'etichetta dopo `|`. Non ha task: la risposta è «non
/// supportato», che deve attraversare il confine come tale.
impl FormatEditsGuest for Componente {
    fn format_link(
        _ctx: ParseContext,
        link: fub::abi::model::LinkInsert,
    ) -> Result<Option<String>, FormatError> {
        let fub::abi::model::LinkTarget::Wiki(wiki) = link.target else {
            return Ok(None);
        };
        if wiki.page.contains(['[', ']', '|']) {
            return Err(FormatError::Serialize(format!(
                "«{}» non si scrive in un wikilink",
                wiki.page
            )));
        }
        let bang = if link.embed { "!" } else { "" };
        Ok(Some(match link.label {
            Some(label) => format!("{bang}[[{}|{label}]]", wiki.page),
            None => format!("{bang}[[{}]]", wiki.page),
        }))
    }

    fn set_task_state(
        _source: DocumentSource,
        _marker: fub::abi::model::TaskMarker,
        _done: bool,
    ) -> Result<Option<Vec<EditsTextEdit>>, FormatError> {
        Ok(None)
    }
}

/// Una riscrittura: Wiki cambia il page e lascia heading/blocco/alias intatti,
/// Path riscrive l'intero URI-like. La grammatica è quella di `fubfmt`, un
/// testo con wikilink `[[..]]`/`![[..]]` e link `(path)`: lo span copre il
/// riferimento intero nei byte della sorgente, come il kernel lo osserva.
fn rewrite_one(source: &str, rewrite: &LinkRewrite) -> Result<LinksTextEdit, FormatError> {
    use fub::abi::model::{LinkTarget, Span as ModelSpan};
    let span = ModelSpan {
        start: rewrite.span.start,
        end: rewrite.span.end,
    };
    let slice = source.get(span.start as usize..span.end as usize).ok_or_else(|| {
        FormatError::Parse("link rewrite span is outside the source".to_string())
    })?;
    match &rewrite.target {
        LinkTarget::Wiki(w) => {
            let (open, close) = if let Some(rest) = slice.strip_prefix("![[") {
                ("![[", rest)
            } else if let Some(rest) = slice.strip_prefix("[[") {
                ("[[", rest)
            } else {
                return Err(FormatError::Parse(
                    "link rewrite span does not cover a wikilink".to_string(),
                ));
            };
            let _ = close.strip_suffix("]]").ok_or_else(|| {
                FormatError::Parse("link rewrite span does not cover a wikilink".to_string())
            })?;
            let inner = &slice[open.len()..slice.len() - 2];
            let parsed = fub_abi::model::parse_wikilink_inner(inner);
            let same = match &parsed.target {
                fub_abi::model::LinkTarget::Wiki { page, heading, block } => {
                    page == &w.page && heading == &w.heading && block == &w.block
                }
                _ => false,
            };
            if !same {
                return Err(FormatError::Parse(
                    "link rewrite target changed under us".to_string(),
                ));
            }
            let mut base = rewrite.replacement.clone();
            if let fub_abi::model::LinkTarget::Wiki { heading, block, .. } = &parsed.target {
                if let Some(heading) = heading {
                    base.push('#');
                    base.push_str(heading);
                }
                if let Some(block) = block {
                    if heading.is_none() {
                        base.push('#');
                    }
                    base.push('^');
                    base.push_str(block);
                }
            }
            if let Some(alias) = parsed.alias {
                base.push('|');
                base.push_str(&alias);
            }
            let inner_start = span.start as usize + open.len();
            let inner_end = span.end as usize - 2;
            Ok(LinksTextEdit {
                span: ModelSpan {
                    start: inner_start as u64,
                    end: inner_end as u64,
                },
                text: base,
            })
        }
        LinkTarget::Path(_) => {
            let (open, close) = slice.split_once('(').ok_or_else(|| {
                FormatError::Parse("link rewrite span does not cover a path link".to_string())
            })?;
            let (current, _) = close.split_once(')').ok_or_else(|| {
                FormatError::Parse("link rewrite span does not cover a path link".to_string())
            })?;
            let start = span.start as usize + open.len() + 1;
            let end = start + current.len();
            Ok(LinksTextEdit {
                span: ModelSpan {
                    start: start as u64,
                    end: end as u64,
                },
                text: rewrite.replacement.clone(),
            })
        }
        LinkTarget::Url(_) => Err(FormatError::Parse(
            "format rewrite of a remote URL is not a vault rename".to_string(),
        )),
    }
}

fn render_body(body: &DocumentTree) -> Result<String, FormatError> {
    if body.roots.is_empty() {
        return Err(FormatError::Render(
            "document body has no roots".to_string(),
        ));
    }

    let mut text = String::new();
    for (root_position, root) in body.roots.iter().enumerate() {
        let block_index = usize::try_from(*root).map_err(|_| {
            FormatError::Render(format!("document root {root_position} is out of range"))
        })?;
        let block = body.blocks.get(block_index).ok_or_else(|| {
            FormatError::Render(format!("document root {root_position} is out of range"))
        })?;
        let paragraph = match block {
            Block::Paragraph(paragraph) => paragraph,
            _ => {
                return Err(FormatError::Render(format!(
                    "document root {root_position} is not a paragraph"
                )));
            }
        };

        for (inline_position, inline_ref) in paragraph.inlines.iter().enumerate() {
            let inline_index = usize::try_from(*inline_ref).map_err(|_| {
                FormatError::Render(format!(
                    "paragraph inline {inline_position} is out of range"
                ))
            })?;
            match body.inlines.get(inline_index) {
                Some(Inline::Text(value)) => text.push_str(value),
                Some(_) => {
                    return Err(FormatError::Render(format!(
                        "paragraph inline {inline_position} is unsupported"
                    )));
                }
                None => {
                    return Err(FormatError::Render(format!(
                        "paragraph inline {inline_position} is out of range"
                    )));
                }
            }
        }
    }
    Ok(text)
}

export!(Componente);
