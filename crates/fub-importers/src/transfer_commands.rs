//! Generic registry entry points for staged imports and portable exports.
//! Command invocation only validates and queues; the plugin runner owns I/O.

use fub_abi::command::{
    CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::text::Text;
use fub_abi::traits::{HostApi, JobProgress, JobSpec};
use fub_abi::transfer::{
    ArtifactHandle, ArtifactSink, ExportArtifact, ExportRequest, ImportMode, ImportRequest,
    ImportSource, SourceContent,
};
use fub_abi::PluginError;

use crate::common::bad_args;
use crate::template::StagingManifest;

pub const IMPORT_PREPARE: &str = "import.prepare";
pub const IMPORT_SAMPLE: &str = "import.sample";
pub const IMPORT_STATUS: &str = "import.status";
pub const IMPORT_COMMIT: &str = "import.commit";
pub const IMPORT_CANCEL: &str = "import.cancel";
pub const IMPORT_ROLLBACK: &str = "import.rollback";
pub const EXPORT_RUN: &str = "export.run";
pub const TRANSFER_JOB: &str = "import.transfer";

fn param(name: &str, label: &str) -> ParamSpec {
    ParamSpec::new(name, Text::from(label), ParamKind::Text).required()
}
fn spec(
    id: &str,
    label: &str,
    description: &str,
    writes: bool,
    params: Vec<ParamSpec>,
) -> CommandSpec {
    let mut spec = CommandSpec::new(id, Text::from(label)).describing(Text::from(description));
    if writes {
        spec = spec.with_scope(CommandScope::writing(CommandReach::Vault));
    }
    for param in params {
        spec = spec.with_param(param);
    }
    spec
}
pub fn specs() -> Vec<CommandSpec> {
    vec![
        spec(IMPORT_PREPARE, "Prepare import", "Stage a source and receive its complete preview. source_json is a serialized ImportSource with in-hand bytes; request_json is an optional serialized ImportRequest. Stream handles expire before jobs run.", true,
            vec![param("job", "Stable import ID"), param("source_json", "ImportSource JSON"), ParamSpec::new("request_json", "ImportRequest JSON", ParamKind::Text)]),
        spec(IMPORT_SAMPLE, "Sample import preview", "Read at most 20 planned documents and the loss report from a staged import.", false,
            vec![param("job", "Stable import ID"), ParamSpec::new("count", "Sample size", ParamKind::Number)]),
        spec(IMPORT_STATUS, "Import status", "Inspect a staged import and its commit/recovery state after restart.", false,
            vec![param("job", "Stable import ID")]),
        spec(IMPORT_COMMIT, "Commit staged import", "Recheck preview and preimages, then apply; repeat returns its prior receipt.", true,
            vec![param("job", "Stable import ID")]),
        spec(IMPORT_CANCEL, "Cancel staged import", "Remove uncommitted staged input. An active journal must be rolled back first.", true,
            vec![param("job", "Stable import ID")]),
        spec(IMPORT_ROLLBACK, "Roll back import", "Restore preimages if no later user edit conflicts.", true,
            vec![param("job", "Stable import ID")]),
        spec(EXPORT_RUN, "Export documents", "Run a registered export target; job result contains portable artifact bytes. request_json is a serialized ExportRequest.", false,
            vec![param("request_json", "ExportRequest JSON")]),
    ]
}
fn required<'a>(args: &'a serde_json::Value, key: &str) -> Result<&'a str, PluginError> {
    args.get(key)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| bad_args(format!("`{key}` must be text")))
}
fn result(value: impl serde::Serialize) -> Result<serde_json::Value, PluginError> {
    serde_json::to_value(value)
        .map_err(|e| bad_args(format!("transfer result cannot be encoded: {e}")))
}

pub fn invoke(
    command: &str,
    args: serde_json::Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let spec = specs()
        .into_iter()
        .find(|spec| spec.id == command)
        .ok_or_else(|| PluginError::UnknownCommand(command.to_string().into()))?;
    spec.validate_args(&args)?;
    if command == IMPORT_SAMPLE || command == IMPORT_STATUS {
        let job = required(&args, "job")?;
        let manifest = StagingManifest::load(job, host)?;
        let value = if command == IMPORT_SAMPLE {
            let count = match args.get("count") {
                Some(value) => value
                    .as_u64()
                    .filter(|count| (1..=20).contains(count))
                    .ok_or_else(|| bad_args("sample count must be an integer between 1 and 20"))?
                    as usize,
                None => 10,
            };
            result(manifest.sample(count))?
        } else {
            result(serde_json::json!({
                "manifest": manifest,
                "status": crate::migration::status(job, host)?,
            }))?
        };
        return Ok(CommandOutcome::notify(Text::from(value.to_string())));
    }
    let payload = if command == IMPORT_PREPARE {
        let source: ImportSource = serde_json::from_str(required(&args, "source_json")?)
            .map_err(|e| bad_args(format!("source_json is not an ImportSource: {e}")))?;
        if !matches!(&source.content, SourceContent::Bytes(_)) {
            return Err(bad_args("a streamed source handle expires before the background job; provide selected source bytes"));
        }
        let request: ImportRequest =
            match args.get("request_json").and_then(serde_json::Value::as_str) {
                Some(raw) => serde_json::from_str(raw)
                    .map_err(|e| bad_args(format!("request_json is not an ImportRequest: {e}")))?,
                None => ImportRequest::apply(),
            };
        if request.mode != ImportMode::Apply {
            return Err(bad_args(
                "prepare needs an apply request; it runs its own read-only preview",
            ));
        }
        if request
            .options
            .get("token")
            .and_then(serde_json::Value::as_str)
            .is_some()
        {
            return Err(bad_args(
                "raw API tokens cannot be queued or persisted; use token_env",
            ));
        }
        serde_json::json!({"op":"prepare", "job":required(&args,"job")?, "source":source, "request":request})
    } else if command == EXPORT_RUN {
        let request: ExportRequest = serde_json::from_str(required(&args, "request_json")?)
            .map_err(|e| bad_args(format!("request_json is not an ExportRequest: {e}")))?;
        if !export_providers()
            .iter()
            .any(|p| p.targets().iter().any(|t| t.id == request.target))
        {
            return Err(bad_args(format!(
                "unknown export target `{}`",
                request.target
            )));
        }
        serde_json::json!({"op":"export", "request":request})
    } else {
        serde_json::json!({"op":command.strip_prefix("import.").unwrap_or(""), "job":required(&args,"job")?})
    };
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::from(format!(
            "{command}: would queue {TRANSFER_JOB}"
        ))));
    }
    let id = host.spawn_job(JobSpec {
        job: TRANSFER_JOB.to_string(),
        payload,
    })?;
    Ok(CommandOutcome::notify(Text::from(format!(
        "{command} queued (job {})",
        id.0
    ))))
}

fn import_provider(
    source: &ImportSource,
) -> Result<Box<dyn fub_abi::transfer::ImportProvider>, PluginError> {
    let markdown = fub_format_markdown::MarkdownImport::boxed();
    if markdown.can_handle(source) {
        return Ok(markdown);
    }
    crate::import_providers()
        .into_iter()
        .find(|p| p.can_handle(source))
        .ok_or_else(|| bad_args(format!("no importer accepts `{}`", source.name)))
}
fn export_providers() -> Vec<Box<dyn fub_abi::transfer::ExportProvider>> {
    let mut providers = vec![fub_format_markdown::MarkdownExport::boxed()];
    providers.extend(crate::export_providers());
    providers
}

pub fn run_job(
    job: &str,
    payload: serde_json::Value,
    host: &mut dyn HostApi,
) -> Result<serde_json::Value, PluginError> {
    if job != TRANSFER_JOB {
        return Err(PluginError::UnknownJob(job.to_string().into()));
    }
    let op = required(&payload, "op")?;
    host.report_progress(JobProgress {
        done: 0,
        total: Some(2),
        label: Some(op.to_string()),
    });
    let value = match op {
        "prepare" => {
            let name = required(&payload, "job")?;
            let source: ImportSource = serde_json::from_value(payload["source"].clone())
                .map_err(|e| bad_args(format!("invalid job source: {e}")))?;
            let request: ImportRequest = serde_json::from_value(payload["request"].clone())
                .map_err(|e| bad_args(format!("invalid job request: {e}")))?;
            let mut provider = import_provider(&source)?;
            let now_ms = host.now_unix_millis();
            result(StagingManifest::prepare(
                name,
                &source,
                &request,
                provider.as_mut(),
                host,
                now_ms,
            )?)?
        }
        "commit" => {
            let name = required(&payload, "job")?;
            let manifest = StagingManifest::load(name, host)?;
            let bytes = manifest.verify(host)?;
            let source = ImportSource {
                name: manifest.source_name,
                media_type: manifest.media_type,
                content: SourceContent::Bytes(bytes),
            };
            let mut provider = import_provider(&source)?;
            result(crate::migration::commit(name, provider.as_mut(), host)?)?
        }
        "cancel" => {
            StagingManifest::cancel(required(&payload, "job")?, host)?;
            serde_json::json!({"cancelled":true})
        }
        "rollback" => {
            crate::migration::rollback(required(&payload, "job")?, host)?;
            serde_json::json!({"rolled_back":true})
        }
        "export" => {
            let request: ExportRequest = serde_json::from_value(payload["request"].clone())
                .map_err(|e| bad_args(format!("invalid export request: {e}")))?;
            let provider = export_providers()
                .into_iter()
                .find(|p| p.targets().iter().any(|t| t.id == request.target))
                .ok_or_else(|| bad_args(format!("unknown export target `{}`", request.target)))?;
            let mut sink = BoundedSink::default();
            result(provider.export(&request, host, &mut sink)?)?
        }
        _ => return Err(bad_args(format!("unknown transfer job operation `{op}`"))),
    };
    host.report_progress(JobProgress {
        done: 2,
        total: Some(2),
        label: Some(format!("{op} complete")),
    });
    Ok(value)
}

#[derive(Default)]
struct BoundedSink {
    artifacts: Vec<Option<(String, String, Vec<u8>)>>,
    bytes: usize,
}
impl ArtifactSink for BoundedSink {
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<ArtifactHandle, PluginError> {
        if path.is_empty()
            || path.starts_with('/')
            || path
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
        {
            return Err(bad_args("export artifact path is not portable"));
        }
        self.artifacts
            .push(Some((path.to_string(), media_type.to_string(), Vec::new())));
        Ok(ArtifactHandle(self.artifacts.len() as u64))
    }
    fn write_artifact(&mut self, handle: ArtifactHandle, bytes: &[u8]) -> Result<(), PluginError> {
        let next = self
            .bytes
            .checked_add(bytes.len())
            .ok_or_else(|| bad_args("export exceeds 32 MiB"))?;
        if next > 32 * 1024 * 1024 {
            return Err(bad_args("export exceeds 32 MiB; select fewer documents"));
        }
        let entry = self
            .artifacts
            .get_mut(
                handle
                    .0
                    .checked_sub(1)
                    .ok_or_else(|| bad_args("invalid export handle"))? as usize,
            )
            .and_then(Option::as_mut)
            .ok_or_else(|| bad_args("export handle already closed"))?;
        entry.2.extend_from_slice(bytes);
        self.bytes = next;
        Ok(())
    }
    fn close_artifact(&mut self, handle: ArtifactHandle) -> Result<ExportArtifact, PluginError> {
        let entry = self
            .artifacts
            .get_mut(
                handle
                    .0
                    .checked_sub(1)
                    .ok_or_else(|| bad_args("invalid export handle"))? as usize,
            )
            .and_then(Option::take)
            .ok_or_else(|| bad_args("export handle already closed"))?;
        Ok(ExportArtifact::bytes(entry.0, entry.1, entry.2))
    }
}
