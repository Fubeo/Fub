use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::html::escape;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::{FormatError, FormatProvider};

use crate::codec;

#[derive(Default)]
pub struct SheetProvider;

impl SheetProvider {
    pub fn new() -> Self {
        Self
    }

    pub fn boxed() -> Box<dyn FormatProvider> {
        Box::new(Self)
    }
}

impl FormatProvider for SheetProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("fubsheet", "Fub Sheet", &["fubsheet"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
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
        let workbook = codec::parse(text).map_err(|error| FormatError::Parse(error.to_string()))?;
        Ok(workbook.project(DocId::new(ctx.doc_id.clone())))
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        let mut html = String::from("<section class=\"fub-sheet-projection\">");
        if !model.outline.is_empty() {
            html.push_str("<ol>");
            for sheet in &model.outline {
                html.push_str("<li>");
                html.push_str(&escape(&sheet.text));
                html.push_str("</li>");
            }
            html.push_str("</ol>");
        }
        if !model.text.is_empty() {
            html.push_str("<pre>");
            html.push_str(&escape(&model.text));
            html.push_str("</pre>");
        }
        html.push_str("</section>");
        Ok(html)
    }

    fn serialize(&self, _model: &DocumentModel) -> Result<String, FormatError> {
        Err(FormatError::Serialize(
            "a DocumentModel is a lossy fubsheet projection; serialize the authoritative Workbook"
                .into(),
        ))
    }
}
