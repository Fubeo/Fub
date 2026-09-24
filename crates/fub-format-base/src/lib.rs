//! Formato nativo `.base`: definizioni di vista YAML sopra le proprietà
//! delle note, con valutatore di formule limitato (mai `eval`).
//!
//! Le proprietà delle note restano autorevoli: questo crate possiede solo il
//! modello persistito della definizione (filtri, viste, formule come testo),
//! i limiti di parsing/valutazione e il motore puro di calcolo riga per riga.
//! La selezione delle righe resta del core (`query_index` con `Documents`);
//! `BaseIndex` in `fub-features` valuta definizioni sulle righe selezionate.
pub mod embed;
pub mod formula;
pub mod model;
pub use embed::{
    catalog as embed_catalog, BaseRenderer, BaseRule, BASE_CUSTOM_KIND,
    BASE_FORMAT as BASE_EMBED_FORMAT, BASE_NS as BASE_EMBED_NS, BASE_RENDERER_ID, BASE_RULE_ID,
    MARKDOWN_FORMAT,
};
pub use model::{
    AggregateKind, BaseDefinition, BaseDocumentView, BaseViewDef, ColumnDef, FilterDef, GroupDef,
    MapDef, SortDef, SummaryDef, ViewType, BASE_FORMAT_ID, BASE_SCHEMA_VERSION,
    MAX_BASE_SOURCE_BYTES, MAX_COLUMNS, MAX_DEFINITION_BYTES, MAX_FILTER_BYTES, MAX_FORMULA_DEFS,
    MAX_SUMMARIES, MAX_VIEWS, MAX_VIEW_BYTES,
};

use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{Block, DocumentModel, Span};
use fub_abi::{DocId, FormatError, FormatProvider};

/// Provider `.base` (dialetto YAML compatibile con la sintassi documentata).
#[derive(Default)]
pub struct BaseProvider;

impl BaseProvider {
    pub fn new() -> Self {
        BaseProvider
    }

    /// Comodo costruttore già in `Box` per la registrazione nel kernel.
    pub fn boxed() -> Box<dyn FormatProvider> {
        Box::new(BaseProvider)
    }
}

impl FormatProvider for BaseProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text(BASE_FORMAT_ID, "Fub Base", &["base"])
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
        // The composer renders HTML from blocks when a renderer is registered:
        // even invalid/future YAML needs a fallback block or its source vanishes.
        // No view is invented when parsing fails or the definition has none.
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = text.to_string();
        let attrs = match BaseDefinition::parse(text) {
            Ok(definition) => serde_json::json!({
                "source": text,
                "view": definition.views.first().map(|view| &view.name),
                "views": definition.views.iter().map(|view| &view.name).collect::<Vec<_>>(),
                "container": ctx.doc_id,
            }),
            Err(_) => {
                serde_json::json!({ "source": text, "view": null, "views": [], "container": ctx.doc_id })
            }
        };
        model.body.push(Block::Custom {
            custom_kind: BASE_CUSTOM_KIND.into(),
            attrs,
            blocks: vec![],
            anchor: None,
            span: Span {
                start: 0,
                end: text.len(),
            },
        });
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        // The composer passes fallback blocks in a fragment with empty `text`.
        // Use the unchanged source attribute there; never interpret it as HTML.
        let source = model
            .body
            .iter()
            .find_map(|block| match block {
                Block::Custom {
                    custom_kind, attrs, ..
                } if custom_kind == BASE_CUSTOM_KIND => {
                    attrs.get("source").and_then(serde_json::Value::as_str)
                }
                _ => None,
            })
            .unwrap_or(&model.text);
        Ok(format!(
            "<pre class=\"block-base-source\">{}</pre>",
            fub_abi::html::escape(source)
        ))
    }

    fn serialize(&self, _model: &DocumentModel) -> Result<String, FormatError> {
        Err(FormatError::Serialize(
            "la serializzazione generativa di .base non è supportata: si scrive YAML".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_e_testo_non_link() {
        let provider = BaseProvider::new();
        let ctx = ParseContext::bare("note.base");
        let model = provider
            .parse(&DocumentSource::Text("filters:\n  and: []\n".into()), &ctx)
            .unwrap();
        assert!(model.links.is_empty());
        assert!(model.outline.is_empty());
        assert_eq!(
            model.body.first().and_then(|block| match block {
                Block::Custom { attrs, .. } =>
                    attrs.get("container").and_then(serde_json::Value::as_str),
                _ => None,
            }),
            Some("note.base")
        );
        let html = provider
            .render_html(&model, &RenderOptions::preview())
            .unwrap();
        assert!(html.contains("block-base-source"));
    }

    #[test]
    fn rifiuta_sorgente_bytes() {
        let provider = BaseProvider::new();
        let ctx = ParseContext::bare("note.base");
        let err = provider
            .parse(&DocumentSource::Bytes(vec![1, 2, 3]), &ctx)
            .unwrap_err();
        assert!(matches!(err, FormatError::Unsupported { .. }));
    }
}
