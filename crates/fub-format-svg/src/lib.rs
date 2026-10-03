//! # fub-format-svg
//!
//! Il [`FormatProvider`] `svg`: le scene di FubDraw, cioè file SVG validi con
//! pochi attributi `fub:*`. Il contratto è il [formato della
//! scena](../../../docs/reference/scene-format.md), e i `§` dei commenti sono
//! le sue sezioni; la lettura la fa `fub-scene`, qui si traduce ciò che legge
//! nelle quattro proiezioni che il contratto chiede a un provider.
//!
//! - [`parse`](FormatProvider::parse): il modello di §9, per indice, ricerca,
//!   grafo e outline. Il documento intero è un blocco `fub.scene.summary`, e
//!   dentro ci sono titolo, descrizione, testi, collegamenti e immagini del
//!   vault con lo span del loro elemento.
//! - [`render_html`](FormatProvider::render_html): solo il segnaposto
//!   `figure.fub-scene`. Il disegno lo mette la shell, con la risoluzione dei
//!   media che ha già; qui non nasce mai un `<img>` né un URL di risorsa
//!   ([ADR 0203](../../../docs/decisions/0203-superfici-spaziali.md)).
//! - [`serialize`](FormatProvider::serialize): un documento nuovo, con radice,
//!   titolo, carta e «Livello 1» (§2).
//! - [`rewrite_links`](FormatProvider::rewrite_links) e
//!   [`format_link`](FormatProvider::format_link): il valore di un `href`
//!   riscritto sul posto quando la destinazione cambia nome, e il riferimento
//!   relativo con cui un disegno punta un documento del vault.
//!
//! Il [`FormatProvider`] `fubann` legge allo stesso modo le annotazioni di un
//! PDF: un file `<nome>.pdf.fubann` accanto a `<nome>.pdf`, con sintassi SVG e
//! la radice che nomina il PDF ([formato delle
//! annotazioni](../../../docs/reference/annotation-format.md)). Lettura,
//! albero del modello e riscrittura sono quelli dei disegni, con tre cose in
//! più:
//!
//! - il PDF annotato è un collegamento, quindi compare nei backlink e nel
//!   grafo, e quando cambia nome si riscrive il valore di `fub:annotates`;
//! - ogni gruppo di pagina è un blocco [`PAGE_KIND`], e ogni nota un blocco
//!   [`NOTE_KIND`] il cui corpo entra nella ricerca;
//! - l'anteprima elenca testi e note per pagina, e ogni pagina apre il PDF a
//!   quel punto.
//!
//! Impronta e numero di pagine del PDF li verifica chi lo apre: il provider
//! riceve solo la sorgente del `.fubann`.
//!
//! Il provider non modifica i documenti: le operazioni sul disegno le applica
//! la superficie della shell, come patch testuali sulla sorgente.

mod escape;
mod links;
mod listing;
mod parse;
mod render;
mod serialize;

use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, LinkInsert, LinkRewrite, ParseContext,
    RenderOptions,
};
use fub_abi::model::DocumentModel;
use fub_abi::{FormatError, FormatProvider, TextEdit};

pub use parse::{ANNOTATIONS_KIND, NOTE_KIND, PAGE_KIND, PAGE_SECTION, SUMMARY_KIND};

/// L'id del formato: è anche il profilo con cui la shell sceglie la superficie.
pub const FORMAT_ID: &str = "svg";

/// L'id del formato delle annotazioni di un PDF.
pub const ANNOTATIONS_FORMAT_ID: &str = "fubann";

/// Provider delle scene di FubDraw, sorgente testuale UTF-8.
#[derive(Default)]
pub struct SvgProvider;

impl SvgProvider {
    pub fn new() -> Self {
        SvgProvider
    }

    /// Comodo costruttore già in `Box` per la registrazione nel kernel.
    pub fn boxed() -> Box<dyn FormatProvider> {
        Box::new(SvgProvider)
    }

    /// L'errore di chi riceve byte invece di testo.
    fn refuses(&self, source: &DocumentSource) -> FormatError {
        refuses(FORMAT_ID, source)
    }
}

/// L'errore di un provider di questo crate che riceve byte invece di testo.
fn refuses(format: &str, source: &DocumentSource) -> FormatError {
    FormatError::Unsupported {
        format: format.to_owned(),
        got: source.kind(),
    }
}

impl FormatProvider for SvgProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text(FORMAT_ID, "SVG (FubDraw)", &["svg"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        // Nessuna sintassi: un disegno non ha wikilink, tag né frontmatter, e
        // non è prosa. I suoi collegamenti sono `href` del vault, che il
        // provider legge e riscrive da sé.
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let text = source.text().ok_or_else(|| self.refuses(source))?;
        parse::parse(text, ctx)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(render::placeholder(model))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        serialize::new_document(model)
    }

    fn rewrite_links(
        &self,
        source: &DocumentSource,
        _ctx: &ParseContext,
        rewrites: &[LinkRewrite],
    ) -> Result<Option<Vec<TextEdit>>, FormatError> {
        let text = source.text().ok_or_else(|| self.refuses(source))?;
        links::rewrite(text, rewrites).map(Some)
    }

    fn format_link(
        &self,
        ctx: &ParseContext,
        link: &LinkInsert,
    ) -> Result<Option<String>, FormatError> {
        links::format(ctx, link)
    }
}

/// Provider delle annotazioni di un PDF, sorgente testuale UTF-8.
#[derive(Default)]
pub struct FubannProvider;

impl FubannProvider {
    pub fn new() -> Self {
        FubannProvider
    }

    /// Comodo costruttore già in `Box` per la registrazione nel kernel.
    pub fn boxed() -> Box<dyn FormatProvider> {
        Box::new(FubannProvider)
    }
}

impl FormatProvider for FubannProvider {
    fn descriptor(&self) -> FormatDescriptor {
        // L'estensione è l'ultimo segmento del nome: `Bando.pdf.fubann` è un
        // `fubann`, e il PDF accanto resta un PDF.
        FormatDescriptor::text(
            ANNOTATIONS_FORMAT_ID,
            "Annotazioni PDF (FubDraw)",
            &["fubann"],
        )
    }

    fn capabilities(&self) -> FormatCapabilities {
        // Come un disegno: nessuna sintassi di prosa, e i riferimenti sono
        // valori di attributi che il provider legge e riscrive da sé.
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let text = source
            .text()
            .ok_or_else(|| refuses(ANNOTATIONS_FORMAT_ID, source))?;
        parse::parse_annotations(text, ctx)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(listing::listing(model))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        serialize::new_annotations(model)
    }

    fn rewrite_links(
        &self,
        source: &DocumentSource,
        _ctx: &ParseContext,
        rewrites: &[LinkRewrite],
    ) -> Result<Option<Vec<TextEdit>>, FormatError> {
        let text = source
            .text()
            .ok_or_else(|| refuses(ANNOTATIONS_FORMAT_ID, source))?;
        links::rewrite_annotations(text, rewrites).map(Some)
    }

    fn format_link(
        &self,
        ctx: &ParseContext,
        link: &LinkInsert,
    ) -> Result<Option<String>, FormatError> {
        links::format(ctx, link)
    }
}
