//! Publish commands (P17 automation): `PublishCommands` CommandProvider.
//!
//! No new ABI families: reuses `CommandSpec`/`CommandScope`/`CommandReach`/
//! `ParamKind` exactly. Main registers the built objects; this module only
//! implements them.
//!
//! Invoke is REAL (HTTP via `HostNetwork::fetch` on the real `HostApi`,
//! plugin data-space snapshots for the views), never a stub: DryRun plans
//! without side effects, Apply executes. Endpoint + token come from the same
//! explicit sources as the sync coordinator (env explicit, else
//! `publish.server_url` setting; never implicit loopback here — missing
//! both is `BadArgs`, CLI exit 2). Missing token is `PermissionDenied`
//! (CLI exit 4), mirroring `PublishClientError::MissingCredentials`.
//!
//! `u64`-as-string on the wire for every version/count identity
//! (`version`, `to_version`, `live_version`, `versions`), numbers also
//! accepted on read, garbage = error. Page/asset counts stay numbers.

use super::site::{self, ExportSnapshot};
use fub_abi::command::{
    Args, CommandOutcome, CommandReach, CommandScope, CommandSpec, ParamKind, ParamSpec,
};
use fub_abi::net::{HttpMethod, HttpRequest};
use fub_abi::text::Text;
use fub_abi::traits::HostApi;
use fub_abi::{CommandProvider, PluginError};

/// Provider id (registration namespace).
pub const PUBLISH_COMMANDS_ID: &str = "fub.publish.commands";

/// Command ids (stable: shortcuts, macros and automations name these).
pub const PUBLISH_DRY_RUN: &str = "publish.dry_run";
pub const PUBLISH_COMMIT: &str = "publish.commit";
pub const PUBLISH_UNPUBLISH: &str = "publish.unpublish";
pub const PUBLISH_ROLLBACK: &str = "publish.rollback";

/// Endpoint setting (mirror of the registered `publish.server_url` key:
/// the name is the contract, not the symbol).
pub const SETTING_SERVER_URL: &str = "publish.server_url";

const PUBLISH_PROTOCOL: &str = super::PUBLISH_PROTOCOL;

/// Composition root for the publish slice (Main-owned wiring): the TRUSTED
/// `state_root` captured once at construction from the composition root
/// (never from env, cwd, JSON payload, or per-call settings). `None` =
/// explicit `MissingConfiguration` on every op, never an invented path.
/// `PublishPlugin` (job body), `PublishRunner` (pass execution) and
/// `PublishCommands` (enqueue-only) all inherit this root.
pub struct PublishBundle {
    state_root: Option<camino::Utf8PathBuf>,
}

impl PublishBundle {
    /// Definitive constructor (see yield): Main passes the trusted state
    /// root (or `None` when the instance has none); everything below
    /// inherits it. No payload, env, or cwd path is ever honored.
    pub fn new(state_root: Option<camino::Utf8PathBuf>) -> Self {
        Self { state_root }
    }

    pub fn commands(&self) -> PublishCommands {
        PublishCommands
    }

    pub fn runner(&self) -> PublishRunner {
        PublishRunner {
            state_root: self.state_root.clone(),
        }
    }

    pub fn plugin(&self) -> PublishPlugin {
        PublishPlugin {
            state_root: self.state_root.clone(),
        }
    }

    pub fn views(&self) -> super::views::PublishViews {
        super::views::PublishViews
    }

    fn manifest_inner(&self) -> fub_abi::PluginManifest {
        fub_abi::PluginManifest::core("fub.publish", "Publish")
    }
}

impl crate::registry::Bundle for PublishBundle {
    fn manifest(&self) -> fub_abi::PluginManifest {
        self.manifest_inner()
    }

    fn trust(&self) -> fub_kernel::Trust {
        fub_kernel::Trust::Core
    }

    fn plugin(&self) -> Box<dyn fub_abi::traits::Plugin> {
        Box::new(self.plugin())
    }

    fn register(&self, registrar: &mut crate::registry::Registrar<'_>) -> Vec<String> {
        let mut failures = Vec::new();
        if let Err(error) = registrar.register_view_provider(Box::new(self.views())) {
            failures.push(format!("publish views NOT registered: {error}"));
            return failures;
        }
        if let Err(error) = registrar.register_command_provider(Box::new(self.commands())) {
            failures.push(format!("publish commands NOT registered: {error}"));
        }
        failures
    }
}

/// The command set. Stateless unit struct (`boxed()` builds it; no root
/// needed — invoke only validates site/op params and enqueues `publish.pass`
/// jobs, payload = site_id/op/validated params only, then returns at once).
/// The heavy work (endpoint/token, HTTP, snapshots) runs in [`PublishRunner`]
/// under `run_job`, on the existing `HostApi` — no new ABI families.
pub struct PublishCommands;

impl PublishCommands {
    pub fn boxed() -> Box<dyn CommandProvider> {
        Box::new(Self)
    }
}

/// Job entry point served by the host-side publish runner (`publish.pass`).
pub const PUBLISH_PASS_JOB: &str = "publish.pass";

fn spec(
    id: &str,
    title: &str,
    description: &str,
    scope: CommandScope,
    params: Vec<ParamSpec>,
) -> CommandSpec {
    let mut out = CommandSpec::new(id, Text::from(title)).describing(Text::from(description));
    for param in params {
        out = out.with_param(param);
    }
    out.with_scope(scope)
}

fn site_param() -> ParamSpec {
    ParamSpec::new("site", Text::from("Site"), ParamKind::Text).required()
}

fn version_param() -> ParamSpec {
    // Versions travel as strings (u64-as-string): free text, validated here.
    ParamSpec::new("to_version", Text::from("Version"), ParamKind::Text).required()
}

impl CommandProvider for PublishCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            spec(
                PUBLISH_DRY_RUN,
                "Publish: dry run",
                "Preview what a selective manifest would publish (no side effects).",
                CommandScope::read_only(),
                vec![site_param()],
            ),
            spec(
                PUBLISH_COMMIT,
                "Publish: commit",
                "Atomically publish the selective manifest for a site.",
                CommandScope::writing(CommandReach::Vault),
                vec![site_param()],
            ),
            spec(
                PUBLISH_UNPUBLISH,
                "Publish: unpublish",
                "Remove the live tree (versions and record stay). Irreversible.",
                CommandScope::writing(CommandReach::Vault).irreversible(),
                vec![site_param()],
            ),
            spec(
                PUBLISH_ROLLBACK,
                "Publish: rollback",
                "Restore the live tree to a prior snapshot version.",
                CommandScope::writing(CommandReach::Vault),
                vec![site_param(), version_param()],
            ),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: fub_abi::command::InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        use fub_abi::traits::JobSpec;
        let map = Args::new(&args);
        let dry = mode.is_dry_run();
        // Validate everything up front: unknown command, missing site,
        // garbage version — all before any job is queued.
        let (op, site, extra) = match command {
            PUBLISH_DRY_RUN => {
                let site = site_of(&map)?;
                ("dry-run", site, serde_json::json!({}))
            }
            PUBLISH_COMMIT => {
                let site = site_of(&map)?;
                ("commit", site, serde_json::json!({}))
            }
            PUBLISH_UNPUBLISH => {
                let site = site_of(&map)?;
                ("unpublish", site, serde_json::json!({}))
            }
            PUBLISH_ROLLBACK => {
                let site = site_of(&map)?;
                let to_version = version_of(&map)?;
                (
                    "rollback",
                    site,
                    serde_json::json!({ "to_version": to_version }),
                )
            }
            _ => return Err(PluginError::UnknownCommand(command.to_string().into())),
        };
        if dry {
            return Ok(CommandOutcome::notify(Text::from(format!(
                "{command}: would queue publish.pass for {site}"
            ))));
        }
        // No state_dir/site path in the payload — only validated site/op
        // params. The runner inherits the TRUSTED root from the bundle.
        let id = host.spawn_job(JobSpec {
            job: PUBLISH_PASS_JOB.to_string(),
            payload: serde_json::json!({
                "site_id": site,
                "op": op,
                "extra": extra,
            }),
        })?;
        Ok(CommandOutcome::notify(Text::from(format!(
            "{command} on {site} queued (job {})",
            id.0
        ))))
    }
}

fn site_of(args: &Args) -> Result<String, PluginError> {
    let site = args.text("site").map(str::trim).unwrap_or("");
    if !site::valid_site_id(site) {
        return Err(PluginError::BadArgs(
            "site must be 1-64 lowercase letters, digits, - or _".into(),
        ));
    }
    Ok(site.to_string())
}

fn version_of(args: &Args) -> Result<String, PluginError> {
    let raw = args
        .text("to_version")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PluginError::BadArgs("rollback needs to_version".into()))?;
    // u64-as-string: digits only, no sign, no decimals; numbers accepted by
    // callers arrive here as text already (spec kind is Text).
    if !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(PluginError::BadArgs("to_version must be a u64".into()));
    }
    raw.parse::<u64>()
        .map(|_| raw.to_string())
        .map_err(|_| PluginError::BadArgs("to_version must be a u64".into()))
}

// ---------------------------------------------------------------------------
// Host-side runner + plugin: `publish.pass` job body on the existing `HostApi`.
// Both inherit the TRUSTED root from `PublishBundle` — never payload/env/cwd.
// ---------------------------------------------------------------------------

/// Host-side runner owning the `publish.pass` job body. Inherits the TRUSTED
/// root from [`PublishBundle::runner`]; constructed per use, never from JSON.
pub struct PublishRunner {
    state_root: Option<camino::Utf8PathBuf>,
}

/// Job-body plugin owning `publish.pass` for the job dispatcher. Inherits
/// the TRUSTED root from [`PublishBundle::plugin`]; `run_job` delegates to
/// a bundle-rooted [`PublishRunner`]. Main registers this, not a bare runner.
pub struct PublishPlugin {
    state_root: Option<camino::Utf8PathBuf>,
}

impl PublishPlugin {
    /// Bundle-side constructor (see [`PublishBundle::plugin`]).
    pub fn new(state_root: Option<camino::Utf8PathBuf>) -> Self {
        Self { state_root }
    }

    pub fn job_name() -> &'static str {
        PUBLISH_PASS_JOB
    }

    /// `Plugin::run_job` body: payload `{site_id, op, extra}` only.
    pub fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        if job != PUBLISH_PASS_JOB {
            return Err(PluginError::UnknownJob(job.to_string().into()));
        }
        PublishRunner::new(self.state_root.clone()).run_job(&payload, host)
    }
}

impl fub_abi::traits::Plugin for PublishPlugin {
    fn manifest(&self) -> fub_abi::PluginManifest {
        fub_abi::PluginManifest::core("fub.publish", "Publish")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        PublishPlugin::run_job(self, job, payload, host)
    }
}

impl PublishRunner {
    /// Bundle-side constructor (see [`PublishBundle::runner`]). `None` root
    /// = every op fails `MissingConfiguration` explicitly, never cwd.
    pub fn new(state_root: Option<camino::Utf8PathBuf>) -> Self {
        Self { state_root }
    }

    fn require_root(&self) -> Result<&camino::Utf8PathBuf, PluginError> {
        self.state_root
            .as_ref()
            .ok_or_else(|| PluginError::BadArgs("publish not configured".into()))
    }

    /// Job body for `publish.pass`: `{site_id, op, extra}` only — validated
    /// site/op params, never paths. The TRUSTED root comes from `self`
    /// (bundle-inherited); `None` = explicit `BadArgs`, never env/cwd.
    /// Runs the real HTTP pass on the job `HostApi` (fetch, snapshots),
    /// never in the sync command path.
    pub fn run_job(
        &self,
        payload: &serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let _root = self.require_root()?;
        let site = payload
            .get("site_id")
            .and_then(|v| v.as_str())
            .filter(|s| site::valid_site_id(s))
            .ok_or_else(|| PluginError::BadArgs("publish.pass needs valid site_id".into()))?;
        let op = payload.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let extra = payload
            .get("extra")
            .cloned()
            .unwrap_or(serde_json::json!({}));
        let outcome = match op {
            "dry-run" => {
                let preview = dry_run_live(host, site)?;
                persist_dry_run(host, site, &preview)?;
                let diff = &preview.plan.diff;
                format!(
                    "dry run {site}: + [{}], ~ [{}], = [{}], - [{}]; {} private excluded; warnings: [{}]",
                    diff.added.join(", "), diff.modified.join(", "),
                    diff.unchanged.join(", "), diff.removed.join(", "),
                    preview.plan.excluded_private.len(), preview.plan.warnings.join("; ")
                )
            }
            "commit" => {
                let version = commit_live(host, site)?;
                format!("published {site} v{version}")
            }
            "unpublish" => {
                unpublish_live(host, site)?;
                format!("unpublished {site} (versions kept)")
            }
            "rollback" => {
                let to_version = extra
                    .get("to_version")
                    .and_then(|v| v.as_str())
                    .and_then(|raw| raw.parse::<u64>().ok())
                    .ok_or_else(|| {
                        PluginError::BadArgs("rollback needs a u64 to_version".into())
                    })?;
                rollback_live(host, site, to_version)?;
                format!("rolled back {site} to v{to_version}")
            }
            _ => return Err(PluginError::UnknownJob(op.to_string().into())),
        };
        Ok(serde_json::json!({ "ok": true, "message": outcome }))
    }
}

/// Endpoint: explicit env wins, else the `publish.server_url` setting.
/// Both empty = BadArgs (CLI exit 2), never implicit loopback.
fn endpoint(host: &dyn HostApi) -> Result<String, PluginError> {
    let configured = std::env::var("FUB_SERVICES_URL")
        .ok()
        .filter(|url| !url.trim().is_empty())
        .or_else(|| {
            host.setting(SETTING_SERVER_URL)
                .ok()
                .map(|value| setting_text(&value))
        })
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| PluginError::BadArgs("publish not configured".into()))?;
    crate::remote::validate_base_url(&configured).map_err(|_| {
        PluginError::BadArgs(
            "invalid publish endpoint (HTTPS or explicit loopback HTTP required)".into(),
        )
    })
}

fn setting_text(value: &fub_abi::settings::SettingValue) -> String {
    use fub_abi::settings::SettingValue;
    match value {
        SettingValue::Text(s) => s.clone(),
        _ => String::new(),
    }
}

/// Token: env-file/stdin discipline, same as the sync coordinator.
/// Absent = PermissionDenied (CLI exit 4), never an anonymous call.
fn token() -> Result<String, PluginError> {
    crate::remote::load_token()
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| PluginError::PermissionDenied("missing credentials".into()))
}

fn post(
    host: &dyn HostApi,
    path: &str,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, PluginError> {
    let base = endpoint(host)?;
    let bearer = token()?;
    let body = serde_json::to_vec(payload)
        .map_err(|e| PluginError::Internal(format!("publish encode: {e}").into()))?;
    let response = host.fetch(HttpRequest {
        url: format!("{base}{path}"),
        method: HttpMethod::Post,
        headers: vec![
            fub_abi::net::HttpHeader::new("content-type", "application/json"),
            fub_abi::net::HttpHeader::new("authorization", format!("Bearer {bearer}")),
        ],
        body: Some(body),
    })?;
    if !(200..300).contains(&response.status) {
        return Err(match response.status {
            401 | 403 | 429 => PluginError::PermissionDenied(
                format!("publish {} -> {}", path, response.status).into(),
            ),
            404 => PluginError::NotFound(format!("publish {} -> {}", path, response.status).into()),
            409 => PluginError::Conflict(format!("publish {} -> {}", path, response.status).into()),
            _ => PluginError::Io(format!("publish {} -> {}", path, response.status).into()),
        });
    }
    serde_json::from_slice(&response.body)
        .map_err(|e| PluginError::Internal(format!("publish {path}: invalid json: {e}").into()))
}

fn get(host: &dyn HostApi, path: &str) -> Result<serde_json::Value, PluginError> {
    let base = endpoint(host)?;
    let bearer = token()?;
    let response = host.fetch(HttpRequest {
        url: format!("{base}{path}"),
        method: HttpMethod::Get,
        headers: vec![fub_abi::net::HttpHeader::new(
            "authorization",
            format!("Bearer {bearer}"),
        )],
        body: None,
    })?;
    if !(200..300).contains(&response.status) {
        return Err(match response.status {
            401 | 403 | 429 => PluginError::PermissionDenied(
                format!("publish /v1/publish/status -> {}", response.status).into(),
            ),
            404 => PluginError::NotFound(
                format!("publish /v1/publish/status -> {}", response.status).into(),
            ),
            _ => {
                PluginError::Io(format!("publish /v1/publish/status -> {}", response.status).into())
            }
        });
    }
    serde_json::from_slice(&response.body).map_err(|e| {
        PluginError::Internal(format!("publish /v1/publish/status: invalid json: {e}").into())
    })
}

/// The preview and its exact rendered bytes are one derived cache record:
/// a dry-run never modifies authoritative site or vault data.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct PreviewSnapshot {
    plan: DryRunPlan,
    export: ExportSnapshot,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct DryRunPlan {
    would_publish: Vec<String>,
    excluded_private: Vec<String>,
    warnings: Vec<String>,
    diff: site::ManifestDiff,
}

fn dry_run_live(host: &dyn HostApi, site: &str) -> Result<PreviewSnapshot, PluginError> {
    let export = site::collect_export(host, site, 1)?;
    let value = post(
        host,
        "/v1/publish/dry-run",
        &serde_json::json!({
            "protocol": PUBLISH_PROTOCOL,
            "site_id": site,
            "manifest": export.manifest,
            "vault": export.vault,
        }),
    )?;
    let plan: DryRunPlan = serde_json::from_value(value)
        .map_err(|_| PluginError::Internal("publish /v1/publish/dry-run: bad plan body".into()))?;
    let mut excluded: Vec<_> = export
        .vault
        .iter()
        .filter(|doc| doc.excluded)
        .map(|doc| doc.doc_id.clone())
        .collect();
    excluded.sort();
    excluded.dedup();
    if plan.would_publish != export.manifest.allowlist || plan.excluded_private != excluded {
        return Err(PluginError::Internal(
            "publish /v1/publish/dry-run: plan mismatch".into(),
        ));
    }
    Ok(PreviewSnapshot { plan, export })
}

fn persist_dry_run(
    host: &mut dyn HostApi,
    site: &str,
    preview: &PreviewSnapshot,
) -> Result<(), PluginError> {
    let bytes = serde_json::to_vec(preview)
        .map_err(|e| PluginError::Internal(format!("publish plan encode: {e}").into()))?;
    host.cache_write(&format!("sites/{site}/export.json"), &bytes)
}

fn next_manifest_version(host: &dyn HostApi, site: &str) -> Result<u64, PluginError> {
    let status = match get(host, &format!("/v1/publish/status?site_id={site}")) {
        Ok(status) => status,
        Err(PluginError::NotFound(_)) => return Ok(1),
        Err(error) => return Err(error),
    };
    if status.get("site_id").and_then(|v| v.as_str()) != Some(site) {
        return Err(PluginError::Internal("publish status site mismatch".into()));
    }
    let versions = status
        .get("versions")
        .and_then(|value| value.as_array())
        .ok_or_else(|| PluginError::Internal("publish status versions missing".into()))?;
    let mut max = 0;
    for version in versions {
        max = max.max(
            wire_version(version)
                .ok_or_else(|| PluginError::Internal("publish status version invalid".into()))?,
        );
    }
    max.checked_add(1)
        .ok_or_else(|| PluginError::Conflict("publish version exhausted".into()))
}

fn commit_live(host: &mut dyn HostApi, site: &str) -> Result<String, PluginError> {
    let bytes = host
        .cache_read(&format!("sites/{site}/export.json"))?
        .ok_or_else(|| PluginError::BadArgs("publish requires a fresh dry-run".into()))?;
    let preview: PreviewSnapshot = serde_json::from_slice(&bytes)
        .map_err(|_| PluginError::BadArgs("publish preview is invalid".into()))?;
    if preview.export.manifest.site_id != site {
        return Err(PluginError::BadArgs(
            "publish preview belongs to another site".into(),
        ));
    }
    let mut export = site::collect_export(host, site, 1)?;
    if export != preview.export || export.manifest.pages.is_empty() {
        return Err(PluginError::Conflict(
            "publish source changed or preview is empty; dry-run again".into(),
        ));
    }
    export.manifest.version = next_manifest_version(host, site)?;
    let excluded_private = site::preflight_commit(
        site,
        &export.manifest,
        &export.pages,
        &export.assets,
        &export.vault,
    )
    .map_err(|reason| PluginError::BadArgs(reason.into()))?;
    let requested_version = export.manifest.version;
    let value = post(
        host,
        "/v1/publish/commit",
        &serde_json::json!({
            "protocol": PUBLISH_PROTOCOL,
            "site_id": site,
            "manifest": export.manifest,
            "pages": export.pages,
            "assets": export.assets,
            "excluded_private": excluded_private,
        }),
    )?;
    let version = value
        .get("version")
        .and_then(wire_version)
        .filter(|version| {
            *version == requested_version
                && value.get("site_id").and_then(|v| v.as_str()) == Some(site)
        })
        .ok_or_else(|| {
            PluginError::Internal("publish /v1/publish/commit: bad version body".into())
        })?;
    refresh_record(host, site)?;
    Ok(version.to_string())
}

fn unpublish_live(host: &mut dyn HostApi, site: &str) -> Result<(), PluginError> {
    let response = post(
        host,
        "/v1/publish/unpublish",
        &serde_json::json!({ "protocol": PUBLISH_PROTOCOL, "site_id": site }),
    )?;
    if response.get("site_id").and_then(|v| v.as_str()) != Some(site)
        || response.get("unpublished").and_then(|v| v.as_bool()) != Some(true)
    {
        return Err(PluginError::Internal(
            "publish /v1/publish/unpublish: bad response".into(),
        ));
    }
    refresh_record(host, site)
}

fn rollback_live(host: &mut dyn HostApi, site: &str, to_version: u64) -> Result<(), PluginError> {
    let response = post(
        host,
        "/v1/publish/rollback",
        &serde_json::json!({
            "protocol": PUBLISH_PROTOCOL,
            "site_id": site,
            "to_version": to_version.to_string(),
        }),
    )?;
    if response.get("site_id").and_then(|v| v.as_str()) != Some(site)
        || response.get("version").and_then(wire_version) != Some(to_version)
    {
        return Err(PluginError::Internal(
            "publish /v1/publish/rollback: bad response".into(),
        ));
    }
    refresh_record(host, site)
}

fn wire_version(value: &serde_json::Value) -> Option<u64> {
    value
        .as_str()
        .and_then(|text| {
            (!text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| text.parse::<u64>().ok())
                .flatten()
        })
        .or_else(|| value.as_u64())
}

/// Refresh the local record mirror from `GET /v1/publish/status` after every
/// mutation, so the views render fresh data without touching the network.
fn refresh_record(host: &mut dyn HostApi, site: &str) -> Result<(), PluginError> {
    let status = get(host, &format!("/v1/publish/status?site_id={site}"))?;
    let bad = || PluginError::Internal("publish /v1/publish/status: bad response".into());
    if status.get("site_id").and_then(|v| v.as_str()) != Some(site) {
        return Err(bad());
    }
    let live = match status.get("live_version").ok_or_else(bad)? {
        serde_json::Value::Null => None,
        value => Some(wire_version(value).ok_or_else(bad)?.to_string()),
    };
    let versions = status
        .get("versions")
        .and_then(|v| v.as_array())
        .ok_or_else(bad)?
        .iter()
        .map(|v| wire_version(v).map(|n| n.to_string()).ok_or_else(bad))
        .collect::<Result<Vec<_>, _>>()?;
    let pages = status
        .get("page_count")
        .and_then(|v| v.as_u64())
        .ok_or_else(bad)?;
    let assets = status
        .get("asset_count")
        .and_then(|v| v.as_u64())
        .ok_or_else(bad)?;
    let protected = status
        .get("password_protected")
        .and_then(|v| v.as_bool())
        .ok_or_else(bad)?;
    let record = serde_json::json!({
        "site_id": site,
        "live_version": live,
        "versions": versions,
        "page_count": pages,
        "asset_count": assets,
        "password_protected": protected,
    });
    let bytes = serde_json::to_vec(&record)
        .map_err(|e| PluginError::Internal(format!("publish record encode: {e}").into()))?;
    host.data_write(&format!("sites/{site}/record.json"), &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::DataRead;
    use fub_abi::InvokeMode;
    use fub_sdk::testing::MemoryHost;

    fn bundle() -> PublishBundle {
        PublishBundle::new(Some(camino::Utf8PathBuf::from("/tmp/publish-state")))
    }

    #[test]
    fn only_remote_backed_commands_are_registered() {
        let specs = bundle().commands().commands();
        assert_eq!(specs.len(), 4);
        let commit = specs.iter().find(|s| s.id == PUBLISH_COMMIT).unwrap();
        assert!(commit.scope.writes);
        assert!(commit.scope.reversible);
        let unpublish = specs.iter().find(|s| s.id == PUBLISH_UNPUBLISH).unwrap();
        assert!(!unpublish.scope.reversible);
    }

    #[test]
    fn invoke_enqueues_without_network() {
        let commands = bundle().commands();
        let mut host = MemoryHost::new();
        let outcome = commands
            .invoke(
                PUBLISH_DRY_RUN,
                serde_json::json!({ "site": "blog" }),
                InvokeMode::Apply,
                &mut host,
            )
            .unwrap();
        assert!(outcome.notify.is_some());
        // Enqueue only: no HTTP from the command path.
        assert!(host.network_requests().is_empty());
    }

    #[test]
    fn commit_requires_preview_and_never_sends_unreviewed_content() {
        let mut host = MemoryHost::new();
        let error = bundle()
            .runner()
            .run_job(
                &serde_json::json!({ "site_id": "blog", "op": "commit" }),
                &mut host,
            )
            .unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)));
        assert!(host.network_requests().is_empty());
    }

    #[test]
    fn dynamic_link_from_public_note_fails_before_network() {
        use fub_abi::format::ParseContext;
        use fub_abi::FormatProvider;
        let source = "---\npublish: true\n---\n[[Private]]";
        let model = fub_format_markdown::MarkdownProvider::new()
            .parse(&source.into(), &ParseContext::obsidian("public.md"))
            .unwrap();
        let mut host = MemoryHost::new()
            .with_document("public.md", source)
            .with_model("public.md", model);
        let error = bundle()
            .runner()
            .run_job(
                &serde_json::json!({ "site_id": "blog", "op": "dry-run" }),
                &mut host,
            )
            .unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)));
        assert!(host.network_requests().is_empty());
        assert!(host.cache_read("sites/blog/export.json").unwrap().is_none());
    }

    #[test]
    fn commit_rejects_vault_change_after_preview_before_http() {
        use fub_abi::format::ParseContext;
        use fub_abi::FormatProvider;
        let provider = fub_format_markdown::MarkdownProvider::new();
        let first = "---\npublish: true\n---\n# Public";
        let model = provider
            .parse(&first.into(), &ParseContext::obsidian("public.md"))
            .unwrap();
        let mut host = MemoryHost::new()
            .with_document("public.md", first)
            .with_model("public.md", model);
        let export = site::collect_export(&host, "blog", 1).unwrap();
        persist_dry_run(
            &mut host,
            "blog",
            &PreviewSnapshot {
                plan: DryRunPlan {
                    would_publish: vec!["public.html".into()],
                    excluded_private: vec![],
                    warnings: vec![],
                    diff: site::ManifestDiff {
                        added: vec!["public.html".into()],
                        modified: vec![],
                        unchanged: vec![],
                        removed: vec![],
                    },
                },
                export,
            },
        )
        .unwrap();
        let changed = "---\npublish: true\n---\n# Changed";
        let changed_model = provider
            .parse(&changed.into(), &ParseContext::obsidian("public.md"))
            .unwrap();
        host = host.with_model("public.md", changed_model);
        let error = bundle()
            .runner()
            .run_job(
                &serde_json::json!({ "site_id": "blog", "op": "commit" }),
                &mut host,
            )
            .unwrap_err();
        assert!(matches!(error, PluginError::Conflict(_)));
        assert!(host.network_requests().is_empty());
    }

    #[test]
    fn wire_version_preserves_u64_max_and_rejects_invalid() {
        assert_eq!(
            wire_version(&serde_json::json!("18446744073709551615")),
            Some(u64::MAX)
        );
        assert_eq!(
            wire_version(&serde_json::json!("18446744073709551616")),
            None
        );
        assert_eq!(wire_version(&serde_json::json!("-1")), None);
        assert_eq!(wire_version(&serde_json::json!("1x")), None);
    }

    #[test]
    fn rollback_rejects_garbage_version_before_queue() {
        let commands = bundle().commands();
        let mut host = MemoryHost::new();
        let err = commands
            .invoke(
                PUBLISH_ROLLBACK,
                serde_json::json!({ "site": "blog", "to_version": "1x" }),
                InvokeMode::Apply,
                &mut host,
            )
            .unwrap_err();
        assert!(matches!(err, PluginError::BadArgs(_)));
        assert!(host.network_requests().is_empty());
    }

    #[test]
    fn rootless_bundle_fails_explicitly_never_cwd() {
        let runner = PublishBundle::new(None).runner();
        let mut host = MemoryHost::new();
        let err = runner
            .run_job(
                &serde_json::json!({ "site_id": "blog", "op": "dry-run", "extra": {} }),
                &mut host,
            )
            .unwrap_err();
        assert!(matches!(err, PluginError::BadArgs(_)));
        assert!(host.network_requests().is_empty());
    }
}
