//! Fail-closed proprietary source gates. The import ports expose no process
//! execution and no macOS Notes-store grant, so claiming to convert these
//! formats would fabricate data. A caller must supply a real platform
//! converter/store adapter before either source can be imported.
//!
//! OneNote `.one`/`.onepkg` needs an authorized Graph export or a verified
//! local converter. Apple Notes needs macOS Full Disk Access and the private
//! Notes store. Journal HTML remains separately consent-gated.

use fub_abi::traits::HostApi;
use fub_abi::transfer::{ImportProvider, ImportReport, ImportRequest, ImportSource};
use fub_abi::PluginError;

use crate::common::{bad_args, unserved};

fn media_base(media: Option<&str>) -> Option<&str> {
    media.map(|m| m.split(';').next().unwrap_or(m).trim())
}

pub const ONENOTE_CONVERTER_OPTION: &str = "converter";
pub const ONENOTE_DEFAULT_CONVERTER: &str = "onenote-export";
pub const APPLE_NOTES_ROOT_OPTION: &str = "notes_root";

#[derive(Default)]
pub struct OneNoteImport;

impl OneNoteImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(OneNoteImport)
    }

    /// The configured converter command. The binary format is proprietary;
    /// this crate never parses it directly — that would be a fake parser.
    /// Verification requires `<converter> --version` on an explicitly
    /// authorized platform adapter; this importer does not execute it.
    pub fn converter(request: &ImportRequest) -> String {
        request
            .options
            .get(ONENOTE_CONVERTER_OPTION)
            .and_then(|v| v.as_str())
            .unwrap_or(ONENOTE_DEFAULT_CONVERTER)
            .to_string()
    }
}

impl ImportProvider for OneNoteImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("one" | "onepkg") => true,
            Some(_) => false,
            None => media_base(source.media_type.as_deref())
                .is_some_and(|m| matches!(m, "application/x-onenote" | "application/one")),
        }
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        _host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let converter = Self::converter(request);
        Err(unserved(format!(
            "OneNote `{}` requires an authorized Microsoft Graph export or an installed `{converter}` converter with a platform execution adapter (`{converter} --version`); no converter is invoked and the source is untouched",
            source.name
        )))
    }
}

#[derive(Default)]
pub struct AppleImport;

impl AppleImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(AppleImport)
    }
}

impl ImportProvider for AppleImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("applenotes" | "applenotesindex") => return true,
            Some(_) => {}
            None => {}
        }
        if source.name.starts_with("apple-journal://") {
            return true;
        }
        media_base(source.media_type.as_deref())
            .is_some_and(|m| matches!(m, "application/x-apple-notes" | "text/apple-journal-html"))
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        _host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        // Never synthesize a Notes/Journal document from a private store.
        // Journal HTML export: the HTML side IS convertible — but only with
        // an explicit grant, because journal data is personal by default.
        if source.name.starts_with("apple-journal://") {
            let granted = request
                .options
                .get("journal_grant")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !granted {
                return Err(unserved(format!(
                    "Apple Journal import needs explicit consent (`options.journal_grant: true`); personal entries are never published by default; source `{}` untouched",
                    source.name
                )));
            }
            // Granted: the bytes still arrive through the normal source; the
            // HTML importer owns the conversion. Hand off explicitly.
            return Err(bad_args(format!(
                "`{}`: journal grant recorded — re-submit these bytes as `.html` to convert (this adapter never reinterprets bytes itself)",
                source.name
            )));
        }
        // Local Notes store: needs Full Disk Access + an explicit root.
        let root = request
            .options
            .get(APPLE_NOTES_ROOT_OPTION)
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if root.is_empty() {
            return Err(unserved(format!(
                "Apple Notes lives in a private local store: set `options.notes_root` to the authorized store path and grant Full Disk Access; locked notes, scans and attachments need the same grant; source `{}` untouched",
                source.name
            )));
        }
        Err(unserved(format!(
            "Apple Notes `{}` requires macOS, Full Disk Access, an authorized Notes-store reader for `{root}`, and access to locked notes and attachments; this adapter cannot read that store on this platform and writes nothing",
            source.name
        )))
    }
}
