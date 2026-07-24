//! `FormatProvider` — l'astrazione centrale su "come si comporta un formato di
//! documento". Il markdown è la prima implementazione (nativa, in
//! `fubmd-format-markdown`); domani org-mode/AsciiDoc sono altri provider senza
//! toccare il kernel.
//!
//! **Regola d'oro (vale da subito, per non dipingerci in un angolo col WASM):**
//! ogni argomento e ogni valore di ritorno è un tipo di `fubmd-abi`,
//! `Serialize + Deserialize`, esprimibile come record WIT. Niente reference con
//! lifetime nella memoria del kernel, niente trait object, niente closure nelle
//! firme. Così l'impl nativa è veloce e quella WASM-proxy (M5) è meccanica.

use serde::{Deserialize, Serialize};

use crate::error::FormatError;
use crate::model::DocumentModel;

/// Descrittore statico di un formato.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatDescriptor {
    /// Id stabile, es. `"markdown"`.
    pub id: String,
    /// Nome leggibile, es. `"Markdown (Obsidian)"`.
    pub name: String,
    /// Estensioni rivendicate, senza punto: `["md", "markdown"]`.
    pub extensions: Vec<String>,
}

/// Capacità sintattiche di un provider — utile alla UI per decidere cosa
/// mostrare (es. abilitare la navigazione wikilink solo se supportata).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatCapabilities {
    pub wikilinks: bool,
    pub tags: bool,
    pub frontmatter: bool,
    pub callouts: bool,
    pub embeds: bool,
}

/// Config a livello di vault passata al parse (così lo stesso provider può
/// comportarsi diversamente per vault: es. parsing dei tag on/off).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParseContext {
    /// Id del documento che stiamo parsando (per riempire `DocumentModel.id`).
    pub doc_id: String,
    pub parse_tags: bool,
    pub parse_wikilinks: bool,
}

impl ParseContext {
    /// Contesto di default "alla Obsidian": tag e wikilink attivi.
    pub fn obsidian(doc_id: impl Into<String>) -> Self {
        ParseContext {
            doc_id: doc_id.into(),
            parse_tags: true,
            parse_wikilinks: true,
        }
    }
}

/// Opzioni di rendering per il pannello di anteprima.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderOptions {
    /// Se il rendering deve produrre HTML per attributi wikilink risolvibili
    /// dal frontend (data-attribute anziché href reali).
    pub wikilinks_as_data_attrs: bool,
}

/// Il trait centrale. **Object-safe**: nessun metodo generico, nessun `async fn`
/// nel trait (l'I/O vive nell'`HostApi`, non qui — parse/render/serialize sono
/// funzioni CPU pure).
pub trait FormatProvider: Send + Sync {
    /// Quali estensioni / content-type rivendica questo provider.
    fn descriptor(&self) -> FormatDescriptor;

    /// Capacità sintattiche.
    fn capabilities(&self) -> FormatCapabilities;

    /// Parsa la sorgente grezza nel modello comune.
    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError>;

    /// Rende il modello a HTML per il pannello di anteprima.
    fn render_html(
        &self,
        model: &DocumentModel,
        opts: &RenderOptions,
    ) -> Result<String, FormatError>;

    /// Serializza un modello (eventualmente modificato) di nuovo a sorgente.
    /// Per M1 può essere best-effort; la fedeltà round-trip cresce nel tempo.
    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError>;
}
