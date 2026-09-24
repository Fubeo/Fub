//! Fub importers — P10 (F29/F30): official `ImportProvider`/`ExportProvider`
//! implementations plus the conversion commands of P10.5.
//!
//! Local parsers (HTML/CSV/ZIP/Textbundle/ENEX/Tomboy-XML/generic
//! XML/JSON/TXT), application connectors with documented, authorized network
//! calls (Notion, Airtable) and real adapters with explicit prerequisites where
//! the OS or credentials are unavailable (OneNote binaries, Apple
//! Notes/Journal), faithful CSV and PDF export, import templates with sample
//! preview, syntax conversions as commands with dry-run plans, and the
//! staging/manifest/preview/commit/cancel pipeline around the existing
//! transfer ports.
//!
//! Ownership: Markdown stays `fub-format-markdown`; `.base` stays
//! `fub-format-base` (DataViewsOwner); `.canvas` stays `fub-format-canvas`
//! (CanvasOwner); print/clipboard/media plumbing stays MediaOwner. This crate
//! never writes `*.base` / `*.canvas` / `*.fubsheet` itself: CSV rows that
//! look tabular arrive as notes plus a `convertible_to_base` manifest flag,
//! and archives containing those formats keep them verbatim. No new ABI/WIT
//! families, no new shell families, no new format ids.
//!
//! Mount (for Main — exact snippet, applied serially by Main):
//!
//! ```rust,ignore
//! registrar.register_import_provider(fub_importers::EnexImport::boxed())?;
//! registrar.register_import_provider(fub_importers::TomboyImport::boxed())?;
//! registrar.register_import_provider(fub_importers::GenericXmlImport::boxed())?;
//! registrar.register_import_provider(fub_importers::TextpackImport::boxed())?;
//! registrar.register_import_provider(fub_importers::OneNoteImport::boxed())?;
//! registrar.register_import_provider(fub_importers::AppleImport::boxed())?;
//! registrar.register_import_provider(fub_importers::ArchiveImport::boxed())?;
//! registrar.register_import_provider(fub_importers::CsvImport::boxed())?;
//! registrar.register_import_provider(fub_importers::HtmlImport::boxed())?;
//! registrar.register_import_provider(fub_importers::JsonImport::boxed())?;
//! registrar.register_import_provider(fub_importers::TextImport::boxed())?;
//! registrar.register_import_provider(fub_importers::NotionApiImport::boxed())?;
//! registrar.register_import_provider(fub_importers::AirtableApiImport::boxed())?;
//! registrar.register_export_provider(fub_importers::CsvExport::boxed())?;
//! registrar.register_export_provider(fub_importers::PdfExport::boxed())?;
//! registrar.register_command_provider(Box::new(fub_importers::ImportCommands))?;
//! ```
//!
//! Bundle id `fub.importers`, manifest [`manifest()`]. `fub.markdown` stays
//! mounted first; none of the providers below claims `.md`/`.markdown`, so
//! markdown dispatch is unaffected. The two synthetic network providers only
//! claim `notion://` / `airtable://` source names and never a file extension.

pub mod apple;
pub mod archive;
pub mod clipper;
pub mod common;
pub mod connectors;
pub mod csv;
pub mod enex;
pub mod export_csv;
pub mod export_pdf;
pub mod html;
pub mod json_import;
pub mod migration;
pub mod normalize;
pub mod onenote;
pub mod pipeline;
mod tar;
pub mod template;
pub mod textpack;
pub mod tomboy;
pub mod transfer_commands;
pub mod xml_generic;
mod xml_helper;
pub mod zip;

pub use apple::AppleImport;
pub use archive::ArchiveImport;
pub use clipper::{
    clip_html, html_to_markdown, markdown_for_selection, template_vars, ClipAsset, ClipNote,
    ClipResult, MAX_ASSETS, MAX_INPUT,
};
pub use common::TextImport;
pub use connectors::{AirtableApiImport, NotionApiImport};
pub use csv::CsvImport;
pub use enex::EnexImport;
pub use export_csv::{CsvExport, TARGET_CSV};
pub use export_pdf::{PdfExport, TARGET_PDF};
pub use html::HtmlImport;
pub use json_import::JsonImport;
pub use normalize::{ImportCommands, IMPORT_CONVERT_LEGACY, IMPORT_DEDUPE, IMPORT_NORMALIZE};
pub use onenote::OneNoteImport;
pub use textpack::TextpackImport;
pub use tomboy::TomboyImport;
pub use xml_generic::GenericXmlImport;

use fub_abi::traits::{
    CommandProvider, HostApi, Plugin, PluginManifest, PluginPermissions, ABI_VERSION,
};
use fub_abi::transfer::{ExportProvider, ImportProvider};

/// Bundle id: the data-space namespace and the registration owner.
pub const PLUGIN_ID: &str = "fub.importers";
/// Human name for menus/logs.
pub const PLUGIN_NAME: &str = "Importers";
/// Crate version, kept in step with the workspace.
pub const PLUGIN_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The official manifest for Main's bundle table: vault read/write plus
/// network restricted to the two documented API hosts.
pub fn manifest() -> PluginManifest {
    let mut granted = PluginPermissions::core().granted;
    granted.set(
        fub_abi::options::permission::NETWORK,
        serde_json::json!(["api.notion.com", "api.airtable.com"]),
    );
    PluginManifest {
        id: PLUGIN_ID.to_string(),
        name: PLUGIN_NAME.to_string(),
        version: PLUGIN_VERSION.to_string(),
        abi_version: ABI_VERSION.to_string(),
        permissions: PluginPermissions { granted },
        provides: Vec::new(),
        requires: Vec::new(),
        settings: Vec::new(),
        strings: Vec::new(),
        default_locale: String::new(),
        timers: Vec::new(),
    }
}

/// Job runner for the transfer commands. The host bundle mounts this under
/// the same `fub.importers` identity as its registered command providers.
pub struct ImportPlugin;

impl ImportPlugin {
    pub fn boxed() -> Box<dyn Plugin> {
        Box::new(Self)
    }
}

impl Plugin for ImportPlugin {
    fn manifest(&self) -> PluginManifest {
        manifest()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), fub_abi::PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), fub_abi::PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, fub_abi::PluginError> {
        transfer_commands::run_job(job, payload, host)
    }
}

/// Every import provider in dispatch order (after `fub.markdown`).
pub fn import_providers() -> Vec<Box<dyn ImportProvider>> {
    vec![
        EnexImport::boxed(),
        TomboyImport::boxed(),
        GenericXmlImport::boxed(),
        TextpackImport::boxed(),
        OneNoteImport::boxed(),
        AppleImport::boxed(),
        ArchiveImport::boxed(),
        CsvImport::boxed(),
        HtmlImport::boxed(),
        JsonImport::boxed(),
        TextImport::boxed(),
        NotionApiImport::boxed(),
        AirtableApiImport::boxed(),
    ]
}

/// Every export provider in this bundle.
pub fn export_providers() -> Vec<Box<dyn ExportProvider>> {
    vec![CsvExport::boxed(), PdfExport::boxed()]
}

/// The conversion commands of P10.5.
pub fn command_provider() -> impl CommandProvider {
    ImportCommands
}
