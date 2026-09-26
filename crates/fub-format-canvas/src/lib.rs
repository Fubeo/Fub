//! Formato `.canvas`: JSON Canvas 1.0 reale, interoperabile.
//!
//! Questo crate possiede il modello persistito (parse/serialize) e le tre
//! proiezioni che il contratto chiede al provider: [`DocumentModel`] per
//! indice/grafo, HTML statico per anteprima/embed, [`rewrite_links`] per la
//! rinomina chirurgica dei riferimenti.
//!
//! Regola d'oro: **i byte che non si interpretano non si toccano**. Ogni nodo,
//! arco e oggetto radice conserva i campi sconosciuti (`extra`), e il
//! serializzatore li riemette verbatim. La riscrittura dei link tocca il solo
//! literale del valore interessato, mai il resto del documento.

mod json_map;
mod model;
mod parse;
mod render;
mod rewrite;
mod serialize;

use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, LinkRewrite, ParseContext, RenderOptions,
};
use fub_abi::model::DocumentModel;
use fub_abi::{FormatError, FormatProvider, TextEdit};

pub use model::{
    Canvas, CanvasColor, CanvasEdge, CanvasEdgeEnd, CanvasEdgeSide, CanvasError, CanvasNode,
    CanvasNodeType, FORMAT_ID, SCHEMA_VERSION,
};
pub use parse::parse_canvas;
pub use rewrite::rewrite_canvas_links;

pub const JSON_SCHEMA: &str = include_str!("../schema/canvas-v1.schema.json");

/// Provider `.canvas`: JSON Canvas 1.0, sorgente testuale UTF-8.
#[derive(Default)]
pub struct CanvasProvider;

impl CanvasProvider {
    pub fn new() -> Self {
        CanvasProvider
    }

    /// Comodo costruttore già in `Box` per la registrazione nel kernel.
    pub fn boxed() -> Box<dyn FormatProvider> {
        Box::new(CanvasProvider)
    }
}

impl FormatProvider for CanvasProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text(FORMAT_ID, "Canvas (JSON Canvas)", &["canvas"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        // La tela non introduce una nuova grammatica: le card testuali usano
        // la grammatica markdown normale (wikilink, tag, embed), i file usano
        // path del vault. Nessuna voce propria: la forma `fub:canvas` vive nel
        // renderer namespace della shell, non nelle sintassi. Che le card
        // siano Markdown lo dice `EMBEDDED_GRAMMAR`: chi le rende usa le
        // sintassi che il vault dà alle note, innesti compresi.
        let mut capabilities = FormatCapabilities::of(&[
            fub_abi::options::syntax::WIKILINKS,
            fub_abi::options::syntax::TAGS,
            fub_abi::options::syntax::EMBEDS,
        ]);
        capabilities.syntax.set(
            fub_abi::options::source::EMBEDDED_GRAMMAR,
            fub_format_markdown::MarkdownProvider::new().descriptor().id,
        );
        capabilities
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let text = source.text().ok_or_else(|| FormatError::Unsupported {
            format: self.descriptor().id,
            got: source.kind(),
        })?;
        parse::parse_document(text, ctx)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(render::render_html(model, opts))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        serialize::serialize(model)
    }

    fn rewrite_links(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
        rewrites: &[LinkRewrite],
    ) -> Result<Option<Vec<TextEdit>>, FormatError> {
        let text = source.text().ok_or_else(|| FormatError::Unsupported {
            format: self.descriptor().id,
            got: source.kind(),
        })?;
        rewrite::rewrite_links(text, ctx, rewrites).map(Some)
    }
}
