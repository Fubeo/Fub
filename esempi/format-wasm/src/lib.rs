wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:format/format",
    generate_all,
});
use exports::fub::abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatError, FormatErrorUnsupported,
    Guest as FormatGuest, ParseContext, RenderOptions, RenderTarget, SourceKind,
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
            abi_version: "0.1.1".to_string(),
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
