//! Generic registry entry points for staged imports and portable exports.
//! Command invocation only validates and queues; the plugin runner owns I/O.
//! The importer and the exporter are the ones the host has registered
//! (`HostServices::run_import` / `run_export`), not a list carried here: a
//! third-party provider takes part in the same dispatch as the bundled ones.

use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind,
    ParamSpec,
};
use fub_abi::text::Text;
use fub_abi::traits::{HostApi, JobProgress, JobSpec};
use fub_abi::transfer::{ExportRequest, ImportMode, ImportRequest, ImportSource, SourceContent};
use fub_abi::PluginError;

use crate::common::bad_args;
use crate::template::StagingManifest;

pub const IMPORT_PREPARE: &str = "import.prepare";
pub const IMPORT_SAMPLE: &str = "import.sample";
pub const IMPORT_STATUS: &str = "import.status";
pub const IMPORT_COMMIT: &str = "import.commit";
pub const IMPORT_CANCEL: &str = "import.cancel";
pub const IMPORT_ROLLBACK: &str = "import.rollback";
pub const IMPORT_ABANDON: &str = "import.abandon";
pub const EXPORT_RUN: &str = "export.run";
pub const TRANSFER_JOB: &str = "import.transfer";
/// Il namespace dell'effetto di un comando che ha accodato il job.
pub const TRANSFER_QUEUED: &str = "fub.transfer.queued";

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
        spec(IMPORT_ABANDON, "Abandon interrupted import", "Keep the vault as it is: discard the journal and preimages of an interrupted import without touching any target. Use it when rollback cannot prove which targets are the import's. A committed import is rolled back instead.", true,
            vec![param("job", "Stable import ID")]),
        // Un export non scrive nel vault, ma accodarlo è un effetto: dichiarato
        // di sola lettura, il comando gira su un host in simulazione e il
        // guardiano gli nega il job.
        spec(EXPORT_RUN, "Export documents", "Run a registered export target; job result contains portable artifact bytes. request_json is a serialized ExportRequest.", false,
            vec![param("request_json", "ExportRequest JSON")])
            .with_scope(CommandScope::writing(CommandReach::Session)),
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
                "raw API tokens cannot be queued or persisted: save the token with `connector.token`, or use token_env",
            ));
        }
        let job = required(&args, "job")?;
        StagingManifest::validate_job(job)?;
        // I byte non viaggiano nel payload del job: un JSON di numeri costa
        // decine di volte la sorgente, e la coda lo terrebbe in memoria fino
        // alla partenza. Si depositano subito nello spazio privato, e il job li
        // rilegge da lì.
        let SourceContent::Bytes(bytes) = &source.content else {
            unreachable!("controllato sopra")
        };
        let mut payload = serde_json::json!({
            "op": "prepare",
            "job": job,
            "source": ImportSource { content: SourceContent::Bytes(Vec::new()), ..source.clone() },
            "request": request,
        });
        if !mode.is_dry_run() {
            host.data_write(&incoming_path(job), bytes)?;
            payload["incoming"] = serde_json::Value::Bool(true);
        }
        payload
    } else if command == EXPORT_RUN {
        let request: ExportRequest = serde_json::from_str(required(&args, "request_json")?)
            .map_err(|e| bad_args(format!("request_json is not an ExportRequest: {e}")))?;
        if !host
            .export_targets()?
            .iter()
            .any(|t| t.id == request.target)
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
    let op = payload["op"].as_str().unwrap_or("").to_owned();
    let id = host.spawn_job(JobSpec {
        job: TRANSFER_JOB.to_string(),
        payload,
    })?;
    // L'id del job nell'esito, tipizzato: chi aspetta il `job_done` lo
    // riconosce da questo, non dalla frase.
    Ok(
        CommandOutcome::notify(Text::from(format!("{command} queued (job {})", id.0))).with_effect(
            CommandEffect::Custom {
                ns: TRANSFER_QUEUED.into(),
                payload: serde_json::json!({ "job_id": id.0.to_string(), "op": op }),
            },
        ),
    )
}

/// Dove `import.prepare` deposita i byte della sorgente per il job.
fn incoming_path(job: &str) -> String {
    format!("{}{job}/incoming", crate::template::STAGING_PREFIX)
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
            let mut source: ImportSource = serde_json::from_value(payload["source"].clone())
                .map_err(|e| bad_args(format!("invalid job source: {e}")))?;
            let incoming = payload["incoming"].as_bool() == Some(true);
            if incoming {
                let bytes = host
                    .data_read(&incoming_path(name))?
                    .ok_or_else(|| bad_args(format!("the source of `{name}` is gone")))?;
                source.content = SourceContent::Bytes(bytes);
            }
            let request: ImportRequest = serde_json::from_value(payload["request"].clone())
                .map_err(|e| bad_args(format!("invalid job request: {e}")))?;
            let now_ms = host.now_unix_millis();
            let prepared =
                StagingManifest::prepare_registered(name, &source, &request, host, now_ms);
            // La copia di passaggio non serve più, riuscito o no: la
            // preparazione ha la sua, verificata, accanto al manifest.
            if incoming {
                host.data_remove(&incoming_path(name))?;
            }
            result(prepared?)?
        }
        "commit" => {
            let name = required(&payload, "job")?;
            result(crate::migration::commit_registered(name, host)?)?
        }
        "cancel" => {
            StagingManifest::cancel(required(&payload, "job")?, host)?;
            serde_json::json!({"cancelled":true})
        }
        "rollback" => {
            crate::migration::rollback(required(&payload, "job")?, host)?;
            serde_json::json!({"rolled_back":true})
        }
        "abandon" => {
            crate::migration::abandon(required(&payload, "job")?, host)?;
            serde_json::json!({"abandoned":true})
        }
        "export" => {
            let request: ExportRequest = serde_json::from_value(payload["request"].clone())
                .map_err(|e| bad_args(format!("invalid export request: {e}")))?;
            result(host.run_export(&request)?)?
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
