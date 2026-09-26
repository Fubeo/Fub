//! Import templates with sample preview + the staging pipeline
//! (preflight / staging / manifest / preview / commit / cancel).
//!
//! Templates are versioned JSON (`schema: 1`) with source variables
//! (`source_url`, `title`, `clipped_at`, `excerpt` — the exact set the
//! clipper exposes via `template_vars()`), shared with the browser capture
//! without mixing network access and pure transformation: the template never
//! fetches, it only renders `{{var}}` over already-converted Markdown.
//!
//! The staging pipeline wraps the existing transfer ports without touching
//! kernel/host code: `Preflight` checks (size, extension, prologue) → copy
//! into this bundle's private data space (`staging/<job>/source`) →
//! `Manifest` JSON (`imports/staging/<job>.json`, capped at
//! [`MAX_MANIFEST_BYTES`]) → provider `Preview` → loss report → `Commit`
//! (apply on the same bytes) or `Cancel` (staged blobs removed, idempotent).
//! Re-imports are repeatable: the manifest carries `source_sha`, and commit
//! refuses a changed staging blob (`Conflict`).

use fub_abi::traits::HostApi;
use fub_abi::transfer::{
    ImportMode, ImportProvider, ImportReport, ImportRequest, ImportSource, SourceContent,
};
use fub_abi::PluginError;

use crate::common::{bad_args, content_hash_hex, MAX_MANIFEST_BYTES, MAX_SOURCE_BYTES};

pub const TEMPLATE_SCHEMA: u32 = 1;
pub const STAGING_PREFIX: &str = "staging/";
pub const MANIFEST_PREFIX: &str = "imports/staging/";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ImportTemplate {
    pub schema: u32,
    pub name: String,
    /// Destination folder inside the vault (`""` = root).
    pub folder: String,
    /// Body with `{{source_url}}`, `{{title}}`, `{{clipped_at}}`,
    /// `{{excerpt}}`, `{{body}}`.
    pub body: String,
    #[serde(default)]
    pub variables: Vec<String>,
}

impl ImportTemplate {
    pub fn parse(json: &str) -> Result<Self, PluginError> {
        let t: ImportTemplate = serde_json::from_str(json)
            .map_err(|e| bad_args(format!("template is not valid JSON: {e}")))?;
        if t.schema != TEMPLATE_SCHEMA {
            return Err(bad_args(format!(
                "template schema {} unsupported (expected {TEMPLATE_SCHEMA})",
                t.schema
            )));
        }
        if t.name.trim().is_empty() {
            return Err(bad_args("template has no name"));
        }
        for v in &t.variables {
            if !crate::clipper::template_vars().contains(v) && v != "body" {
                return Err(bad_args(format!("template variable `{{{{{v}}}}}` unknown")));
            }
        }
        Ok(t)
    }

    /// Render over converted Markdown + clip variables. Pure: no network.
    pub fn render(
        &self,
        markdown_body: &str,
        vars: &std::collections::BTreeMap<String, String>,
    ) -> String {
        let mut out = self.body.clone();
        for (k, v) in vars {
            out = out.replace(&format!("{{{{{k}}}}}"), v);
        }
        let excerpt: String = markdown_body.chars().take(300).collect();
        out = out.replace("{{excerpt}}", &excerpt);
        out = out.replace("{{body}}", markdown_body);
        out
    }

    /// Preview on a sample: returns the rendered text plus the variable
    /// table, without touching the vault.
    pub fn preview(
        &self,
        sample_markdown: &str,
        vars: &std::collections::BTreeMap<String, String>,
    ) -> (String, Vec<(String, String)>) {
        let table: Vec<(String, String)> =
            vars.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        (self.render(sample_markdown, vars), table)
    }
}

// --- staging pipeline -------------------------------------------------------

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StagingManifest {
    pub schema: u32,
    pub job: String,
    pub source_name: String,
    pub source_sha: String,
    pub staged_at: u64,
    pub preview: ImportReport,
    /// Loss lines carried from preview to the commit decision.
    pub losses: Vec<String>,
    #[serde(default)]
    pub request: Option<ImportRequest>,
    #[serde(default)]
    pub media_type: Option<String>,
}

impl StagingManifest {
    pub fn manifest_path(job: &str) -> String {
        format!("{MANIFEST_PREFIX}{job}.json")
    }

    pub fn staging_path(job: &str) -> String {
        format!("{STAGING_PREFIX}{job}/source")
    }

    /// Preflight + stage: checks, copies bytes into private data space,
    /// runs provider preview, writes the manifest. No vault writes.
    pub fn stage(
        job: &str,
        source: &ImportSource,
        preview: ImportReport,
        losses: Vec<String>,
        host: &mut dyn HostApi,
        now_ms: u64,
    ) -> Result<StagingManifest, PluginError> {
        Self::validate_job(job)?;
        preflight(source, MAX_SOURCE_BYTES)?;
        if host.data_read(&Self::manifest_path(job))?.is_some() {
            return Err(PluginError::Conflict(
                format!("staged job `{job}` already exists").into(),
            ));
        }
        let bytes = match &source.content {
            SourceContent::Bytes(b) => b.clone(),
            SourceContent::Streamed(_) => {
                return Err(bad_args(
                    "staging needs in-hand bytes: read the source first",
                ));
            }
        };
        let sha = content_hash_hex(&bytes);
        host.data_write(&Self::staging_path(job), &bytes)?;
        let manifest = StagingManifest {
            schema: 1,
            job: job.to_string(),
            source_name: source.name.clone(),
            source_sha: sha,
            staged_at: now_ms,
            preview,
            losses,
            request: None,
            media_type: source.media_type.clone(),
        };
        let raw = serde_json::to_vec(&manifest)
            .map_err(|e| bad_args(format!("manifest unrestorable: {e}")))?;
        if raw.len() > MAX_MANIFEST_BYTES {
            host.data_remove(&Self::staging_path(job))?;
            return Err(bad_args("staging manifest exceeds 1 MiB"));
        }
        if let Err(e) = host.data_write(&Self::manifest_path(job), &raw) {
            host.data_remove(&Self::staging_path(job))?;
            return Err(e);
        }
        Ok(manifest)
    }

    /// Load a staged manifest (commit/cancel decision point).
    pub fn load(job: &str, host: &dyn HostApi) -> Result<StagingManifest, PluginError> {
        Self::validate_job(job)?;
        let raw = host
            .data_read(&Self::manifest_path(job))?
            .ok_or_else(|| bad_args(format!("no staged job `{job}`")))?;
        if raw.len() > MAX_MANIFEST_BYTES {
            return Err(bad_args("staged manifest exceeds 1 MiB"));
        }
        let manifest: StagingManifest = serde_json::from_slice(&raw)
            .map_err(|e| bad_args(format!("staged manifest unreadable: {e}")))?;
        if manifest.schema != 1 && manifest.schema != 2 {
            return Err(bad_args(format!(
                "unsupported staged manifest schema {}",
                manifest.schema
            )));
        }
        if manifest.job != job {
            return Err(bad_args("staged manifest job does not match its path"));
        }
        Ok(manifest)
    }

    /// Cancel: remove staged bytes + manifest. Idempotent.
    pub fn cancel(job: &str, host: &mut dyn HostApi) -> Result<(), PluginError> {
        Self::validate_job(job)?;
        if host
            .data_read(&crate::migration::journal_path(job))?
            .is_some()
        {
            return Err(PluginError::Conflict(format!("job `{job}` has a commit journal: roll back or finish it before cancelling staging").into()));
        }
        host.data_remove(&Self::staging_path(job))?;
        host.data_remove(&Self::manifest_path(job))?;
        Ok(())
    }

    /// Verify the staged blob is unchanged since preview (repeatability).
    pub fn verify(&self, host: &dyn HostApi) -> Result<Vec<u8>, PluginError> {
        let bytes = host
            .data_read(&Self::staging_path(&self.job))?
            .ok_or_else(|| bad_args(format!("staged source for `{}` is gone", self.job)))?;
        let sha = content_hash_hex(&bytes);
        if sha != self.source_sha {
            return Err(PluginError::Conflict(
                format!("staged source changed since preview (job `{}`)", self.job).into(),
            ));
        }
        Ok(bytes)
    }

    fn validate_job(job: &str) -> Result<(), PluginError> {
        if job.is_empty()
            || job.len() > 128
            || !job
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(bad_args(
                "job id must be a single ASCII alphanumeric, `_` or `-` component",
            ));
        }
        Ok(())
    }

    /// Generate the full write-free plan from exactly the bytes staged, with
    /// one given importer.
    pub fn prepare(
        job: &str,
        source: &ImportSource,
        request: &ImportRequest,
        provider: &mut dyn ImportProvider,
        host: &mut dyn HostApi,
        now_ms: u64,
    ) -> Result<Self, PluginError> {
        Self::prepare_with(
            job,
            source,
            request,
            Importer::Provider(provider),
            host,
            now_ms,
        )
    }

    /// Like [`prepare`](Self::prepare), with the importer the host has
    /// registered for the source ([`HostServices::run_import`]).
    ///
    /// [`HostServices::run_import`]: fub_abi::traits::HostServices::run_import
    pub fn prepare_registered(
        job: &str,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
        now_ms: u64,
    ) -> Result<Self, PluginError> {
        Self::prepare_with(job, source, request, Importer::Registered, host, now_ms)
    }

    fn prepare_with(
        job: &str,
        source: &ImportSource,
        request: &ImportRequest,
        mut importer: Importer<'_>,
        host: &mut dyn HostApi,
        now_ms: u64,
    ) -> Result<Self, PluginError> {
        Self::validate_job(job)?;
        preflight(source, MAX_SOURCE_BYTES)?;
        if request.options.get("token").is_some() {
            return Err(bad_args("staging does not persist API tokens: use options.token_env with an injected secret"));
        }
        importer.check(source)?;
        let bytes = match &source.content {
            SourceContent::Bytes(bytes) => bytes.clone(),
            SourceContent::Streamed(stream) => {
                let mut bytes = Vec::with_capacity(stream.len as usize);
                while bytes.len() < stream.len as usize {
                    let want = (stream.len as usize - bytes.len()).min(256 * 1024) as u32;
                    let chunk = host.read_source(stream.handle, bytes.len() as u64, want)?;
                    if chunk.is_empty() || chunk.len() > want as usize {
                        return Err(bad_args("staged source ended or grew while reading"));
                    }
                    bytes.extend_from_slice(&chunk);
                }
                if !host.read_source(stream.handle, stream.len, 1)?.is_empty() {
                    return Err(bad_args("staged source grew while reading"));
                }
                bytes
            }
        };
        let exact = ImportSource {
            name: source.name.clone(),
            media_type: source.media_type.clone(),
            content: SourceContent::Bytes(bytes),
        };
        let mut dry = request.clone();
        dry.mode = ImportMode::Preview;
        let preview = importer.import(&exact, &dry, host)?;
        let losses = preview
            .log
            .iter()
            .filter(|n| n.level != fub_abi::transfer::NoteLevel::Info)
            .map(|n| {
                format!(
                    "{}: {}",
                    n.entry.as_deref().unwrap_or(&exact.name),
                    n.message
                )
            })
            .collect();
        let mut manifest = Self::stage(job, &exact, preview, losses, host, now_ms)?;
        manifest.schema = 2;
        let mut apply = request.clone();
        apply.mode = ImportMode::Apply;
        manifest.request = Some(apply);
        let raw = serde_json::to_vec(&manifest)
            .map_err(|e| bad_args(format!("manifest unrestorable: {e}")))?;
        if raw.len() > MAX_MANIFEST_BYTES {
            Self::cancel(job, host)?;
            return Err(bad_args("staging manifest exceeds 1 MiB"));
        }
        host.data_write(&Self::manifest_path(job), &raw)?;
        Ok(manifest)
    }

    /// Display-only sample: keep full plan on disk for commit.
    pub fn sample(&self, count: usize) -> ImportReport {
        let limit = count.min(100);
        ImportReport {
            mode: self.preview.mode,
            documents: self.preview.documents.iter().take(limit).cloned().collect(),
            log: self.preview.log.iter().take(limit).cloned().collect(),
        }
    }
}

/// Who runs the import of a staged job: one given importer (benches, direct
/// callers) or the host registry, which picks the first registered importer
/// that recognizes the source.
pub(crate) enum Importer<'a> {
    Provider(&'a mut dyn ImportProvider),
    Registered,
}

impl Importer<'_> {
    /// A given importer must recognize the source; the registry answers for
    /// itself when asked to import.
    pub(crate) fn check(&self, source: &ImportSource) -> Result<(), PluginError> {
        match self {
            Importer::Provider(provider) if !provider.can_handle(source) => {
                Err(bad_args(format!("no importer for `{}`", source.name)))
            }
            _ => Ok(()),
        }
    }

    pub(crate) fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        match self {
            Importer::Provider(provider) => provider.import(source, request, host),
            Importer::Registered => host.run_import(source, request),
        }
    }
}

/// Preflight checks shared by every entry point: size + extension sanity.
/// Rejects an invalid source before any conversion.
pub fn preflight(source: &ImportSource, max_bytes: u64) -> Result<(), PluginError> {
    if source.len() > max_bytes {
        return Err(bad_args(format!(
            "`{}` is {} bytes (max {max_bytes})",
            source.name,
            source.len()
        )));
    }
    if source.stem().is_none() {
        return Err(bad_args(format!(
            "`{}` gives no usable document name",
            source.name
        )));
    }
    if source.name.contains('\0') {
        return Err(bad_args("source name contains NUL"));
    }
    Ok(())
}
