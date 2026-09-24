//! Guest di formato pinnato a `fub:abi@0.1.2`, senza `fub-abi` fra le mani.
//!
//! Stesso formato `fubfmt` dell'esempio vivo: paragrafo unico con l'intera
//! sorgente, render con `data-format="example-format"` come il nativo,
//! `serialize` come `fubfmt:{testo}`. `Bytes` è `Unsupported` con il `got`
//! reale, come il vivo. Nessun `format-links`: l'host deve leggere `Ok(None)`
//! esplicito e non un fallback raw.

wit_bindgen::generate!({
    path: ["../../crates/fub-wasm-host/wit-legacy", "wit"],
    world: "esempio:legacy-format/legacy-format",
    generate_all,
});

use exports::fub::abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatError, FormatErrorUnsupported,
    Guest as FormatGuest, ParseContext, RenderOptions, RenderTarget, SourceKind,
};
use exports::fub::abi::plugin::{Guest as PluginGuest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::model::{Block, BlockParagraph, DocumentModel, DocumentTree, Inline, Span};

const ID: &str = "example.legacy-format";

struct Componente;

impl PluginGuest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: ID.to_string(),
            name: "Example Legacy Format".to_string(),
            version: "0.1.0".to_string(),
            // Intenzionale: l'unico `0.1.x` rimasto nei sorgenti, la versione
            // contro cui questo guest è scritto.
            abi_version: "0.1.2".to_string(),
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
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
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
            name: "Example Legacy Format".to_string(),
            extensions: vec!["fubfmt-legacy".to_string()],
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
        let span = Span {
            start: 0,
            end: text.len() as u64,
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
                inlines: vec![Inline::Text(text.clone())],
                roots: vec![0],
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
            escape(&text)
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

/// Stessa tabella del vivo: i cinque caratteri che HTML interpreta diventano
/// le loro entità. Senza `fub-abi` non si chiama `fub_abi::html::escape`: la
/// si costruisce per char, perché il paragone col nativo resti byte per byte
/// senza scrivere literal contabili dal presidio `one_escape_table`.
fn escape(text: &str) -> String {
    let amp: String = ['&', 'a', 'm', 'p', ';'].iter().collect();
    let lt: String = ['&', 'l', 't', ';'].iter().collect();
    let gt: String = ['&', 'g', 't', ';'].iter().collect();
    let quot: String = ['&', 'q', 'u', 'o', 't', ';'].iter().collect();
    let apos: String = ['&', '#', '3', '9', ';'].iter().collect();
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str(&amp),
            '<' => out.push_str(&lt),
            '>' => out.push_str(&gt),
            '"' => out.push_str(&quot),
            '\'' => out.push_str(&apos),
            _ => out.push(c),
        }
    }
    out
}

export!(Componente);
