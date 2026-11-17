//! I quattro provider di formato dei file Craft: a byte, in sola lettura.
//!
//! Il modello porta ciò che serve al vault (il titolo come proprietà, il testo
//! per la ricerca, i file collegati come link), e la resa è una figura che la
//! shell riempie con l'anteprima. Fub non scrive mai un file Craft: `serialize`
//! rifiuta, e la riscrittura dei link resta quella di serie, che non tocca
//! niente.

use fub_abi::html;
use fub_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fub_abi::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatError, FormatProvider,
    ParseContext, RenderOptions, SourceKind,
};

use crate::apps::CraftApp;
use crate::{container, xmp};

/// La chiave del frontmatter in cui sta il titolo che il file dice.
pub const TITLE_KEY: &str = "title";

/// Il provider di una famiglia di file Craft.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CraftProvider {
    app: CraftApp,
}

impl CraftProvider {
    pub fn new(app: CraftApp) -> Self {
        CraftProvider { app }
    }

    pub fn boxed(app: CraftApp) -> Box<dyn FormatProvider> {
        Box::new(CraftProvider::new(app))
    }

    /// La famiglia che il provider legge.
    pub fn app(&self) -> CraftApp {
        self.app
    }

    fn refuses(&self, source: &DocumentSource) -> FormatError {
        FormatError::Unsupported {
            format: self.app.format_id().to_owned(),
            got: source.kind(),
        }
    }

    /// Il modello di un disegno, di un'immagine o di un progetto. Un file
    /// rotto o troppo grande dà il modello vuoto con il suo id: il file resta
    /// nel vault e si trova per nome.
    fn container_model(&self, ctx: &ParseContext, bytes: &[u8]) -> DocumentModel {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        let Ok(contents) = container::read_meta(self.app, bytes) else {
            return model;
        };
        if let Some(title) = contents.title {
            model
                .frontmatter
                .0
                .insert(TITLE_KEY.to_owned(), serde_json::Value::String(title));
        }
        model.text = contents.text;
        model.links = contents
            .links
            .into_iter()
            .map(|path| Link {
                target: LinkTarget::Path(path),
                embed: true,
                span: Span::EMPTY,
                context: None,
            })
            .collect();
        model
    }
}

/// I quattro provider, nell'ordine di [`CraftApp::ALL`].
pub fn providers() -> Vec<Box<dyn FormatProvider>> {
    CraftApp::ALL
        .into_iter()
        .map(CraftProvider::boxed)
        .collect()
}

impl FormatProvider for CraftProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: self.app.format_id().to_owned(),
            name: self.app.name().to_owned(),
            extensions: self
                .app
                .extensions()
                .iter()
                .map(|extension| (*extension).to_owned())
                .collect(),
            source: SourceKind::Bytes,
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        // Nessuna sintassi del vault: un file Craft non ha wikilink né tag
        // scritti a mano.
        FormatCapabilities::of(&[])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let DocumentSource::Bytes(bytes) = source else {
            return Err(self.refuses(source));
        };
        Ok(match self.app {
            CraftApp::Xmp => xmp::document_model(ctx, bytes),
            CraftApp::VectorCraft | CraftApp::PhotoCraft | CraftApp::FigCraft => {
                self.container_model(ctx, bytes)
            }
        })
    }

    /// `<figure class="fub-craft" data-embed-kind="craft" …>` con il nome del
    /// file nella didascalia: la shell ci mette l'anteprima, e la didascalia è
    /// il nome accessibile della figura.
    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        let kind = match self.app {
            CraftApp::Xmp => "craft-xmp",
            CraftApp::VectorCraft | CraftApp::PhotoCraft | CraftApp::FigCraft => "craft",
        };
        let id = model.id.as_str();
        let name = id.rsplit('/').next().unwrap_or(id);
        Ok(format!(
            "<figure class=\"fub-craft\"{}{}{}><figcaption>{}</figcaption></figure>",
            html::attr("data-embed-kind", kind),
            html::attr("data-embed-doc", id),
            html::attr("data-craft-app", self.app.id()),
            html::escape(name)
        ))
    }

    fn serialize(&self, _model: &DocumentModel) -> Result<String, FormatError> {
        Err(FormatError::Unsupported {
            format: self.app.format_id().to_owned(),
            got: SourceKind::Text,
        })
    }
}
