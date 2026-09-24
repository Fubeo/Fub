//! Sync commands (P16 automation): `SyncCommands` CommandProvider, enqueue-only.
//!
//! `invoke` (sotto workspace lock) SOLO valida e accoda
//! `host.spawn_job(JobSpec{job:"sync.pass", payload})`, poi torna subito con
//! outcome "accodato". Mai rete, mai state-dir da payload/env/cwd: il payload
//! porta solo op/ID/parametri validati. Il lavoro reale gira in
//! [`super::bundle::SyncRunner::run_job`] FUORI dal lock via JobHost, con la
//! TRUSTED root del bundle. Unità stateless: `SyncCommands::boxed()`.
//!
//! No new ABI families: reuses `CommandSpec`/`CommandScope`/`CommandReach`/
//! `ParamKind` exactly. Main registers the built objects.

use fub_abi::command::{
    Args, CommandOutcome, CommandReach, CommandScope, CommandSpec, ParamKind, ParamSpec,
};
use fub_abi::text::Text;
use fub_abi::traits::{HostApi, JobSpec};
use fub_abi::{CommandProvider, PluginError};

use super::bundle::SYNC_PASS_JOB;

/// Provider id (registration namespace).
pub const SYNC_COMMANDS_ID: &str = "fub.sync.commands";

/// Command ids (stable: shortcuts, macros and automations name these).
pub const SYNC_PUSH_NOW: &str = "sync.push_now";
pub const SYNC_PULL_NOW: &str = "sync.pull_now";
pub const SYNC_PAUSE: &str = "sync.pause";
pub const SYNC_RESUME: &str = "sync.resume";
pub const SYNC_RETRY_CONFLICT: &str = "sync.retry_conflict";
pub const SYNC_RESTORE_VERSION: &str = "sync.restore_version";
pub const SYNC_INVITE: &str = "sync.invite";
pub const SYNC_ACCEPT: &str = "sync.accept";
pub const SYNC_REVOKE: &str = "sync.revoke";
pub const SYNC_REKEY: &str = "sync.rekey";

/// Accoda il job `sync.pass`: payload solo op/parametri validati, mai path
fn enqueue_pass(
    host: &mut dyn HostApi,
    op: &str,
    mut payload: serde_json::Map<String, serde_json::Value>,
) -> Result<CommandOutcome, PluginError> {
    payload.insert("op".to_string(), serde_json::Value::String(op.to_string()));
    host.spawn_job(JobSpec {
        job: SYNC_PASS_JOB.to_string(),
        payload: serde_json::Value::Object(payload),
    })?;
    Ok(CommandOutcome::notify(Text::from(format!(
        "sync {op}: accodato"
    ))))
}

/// The command set. Stateless unit struct (`boxed()` builds it; invoke solo
/// valida e accoda `sync.pass`, mai rete/path/segreti qui).
pub struct SyncCommands;

impl SyncCommands {
    pub fn boxed() -> Box<dyn CommandProvider> {
        Box::new(Self)
    }
}

fn spec(
    id: &str,
    title: &str,
    description: &str,
    scope: CommandScope,
    params: Vec<ParamSpec>,
) -> CommandSpec {
    let mut s = CommandSpec::new(id, Text::from(title.to_string()))
        .describing(Text::from(description.to_string()))
        .with_scope(scope);
    for p in params {
        s = s.with_param(p);
    }
    s
}

fn doc_param() -> ParamSpec {
    ParamSpec::new("doc", Text::from("Document"), ParamKind::Document).required()
}

fn version_param() -> ParamSpec {
    // Versioni come stringhe (u64-as-string): testo libero, validato nel job.
    ParamSpec::new("version", Text::from("Version"), ParamKind::Text).required()
}

impl CommandProvider for SyncCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            spec(
                SYNC_PUSH_NOW,
                "Sync: push now",
                "Push the durable outbox to the configured sync endpoint (single pass).",
                CommandScope::writing(CommandReach::Vault),
                vec![],
            ),
            spec(
                SYNC_PULL_NOW,
                "Sync: pull now",
                "Pull, verify (AAD recompute before any apply) and apply remote ops (single pass).",
                CommandScope::writing(CommandReach::Vault),
                vec![],
            ),
            spec(
                SYNC_PAUSE,
                "Sync: pause",
                "Pause sync (flag file + policy mirror). Reversible.",
                CommandScope::writing(CommandReach::Session),
                vec![],
            ),
            spec(
                SYNC_RESUME,
                "Sync: resume",
                "Resume a paused sync. Reversible.",
                CommandScope::writing(CommandReach::Session),
                vec![],
            ),
            spec(
                SYNC_RETRY_CONFLICT,
                "Sync: retry conflict",
                "Mark one conflicted doc for re-push on the next pass (conservative: never overwrites).",
                CommandScope::writing(CommandReach::Document),
                vec![doc_param()],
            ),
            spec(
                SYNC_RESTORE_VERSION,
                "Sync: restore version",
                "Restore one doc from its remote version chain (new write, never a vector replay).",
                CommandScope::writing(CommandReach::Document),
                vec![doc_param(), version_param()],
            ),
            spec(
                SYNC_INVITE, "Sync: invite", "Create a vault invite with a wrapped key; token returned by the job must be delivered out of band.",
                CommandScope::writing(CommandReach::Vault),
                vec![ParamSpec::new("role", Text::from("Role (reader/writer/admin)"), ParamKind::Text).required()],
            ),
            spec(
                SYNC_ACCEPT, "Sync: accept invite", "Accept an invite token read from FUB_SYNC_INVITE_TOKEN_FILE.",
                CommandScope::writing(CommandReach::Vault), vec![],
            ),
            spec(
                SYNC_REVOKE, "Sync: revoke", "Revoke an account's future access (existing downloaded copies survive).",
                CommandScope::writing(CommandReach::Vault),
                vec![ParamSpec::new("account_id", Text::from("Account ID"), ParamKind::Text).required()],
            ),
            spec(
                SYNC_REKEY, "Sync: rotate vault key", "Explicitly rotate the VDK for future writes; all devices need the new key out of band.",
                CommandScope::writing(CommandReach::Vault), vec![],
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
        let args = Args::new(&args);
        let mut payload = serde_json::Map::new();
        let op = match command {
            SYNC_PUSH_NOW => "push",
            SYNC_PULL_NOW => "pull",
            SYNC_PAUSE => "pause",
            SYNC_RESUME => "resume",
            SYNC_INVITE => {
                let role = args
                    .text("role")
                    .filter(|value| matches!(*value, "reader" | "writer" | "admin"))
                    .ok_or_else(|| {
                        PluginError::BadArgs("sync invite requires reader/writer/admin role".into())
                    })?;
                payload.insert("role".into(), role.into());
                "invite"
            }
            SYNC_ACCEPT => "accept",
            SYNC_REVOKE => {
                let account_id = args
                    .text("account_id")
                    .filter(|value| {
                        !value.is_empty()
                            && value.len() <= 128
                            && value
                                .bytes()
                                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                    })
                    .ok_or_else(|| {
                        PluginError::BadArgs("sync revoke requires account_id".into())
                    })?;
                payload.insert("account_id".into(), account_id.into());
                "revoke"
            }
            SYNC_REKEY => "rekey",
            SYNC_RETRY_CONFLICT | SYNC_RESTORE_VERSION => {
                let doc = args
                    .document("doc")
                    .ok_or_else(|| PluginError::BadArgs("sync command needs doc".into()))?;
                payload.insert("doc".to_string(), serde_json::Value::String(doc.0));
                if command == SYNC_RESTORE_VERSION {
                    let version = args
                        .text("version")
                        .filter(|value| {
                            !value.is_empty()
                                && value.bytes().all(|byte| byte.is_ascii_digit())
                                && value.parse::<u64>().is_ok_and(|value| value > 0)
                        })
                        .ok_or_else(|| {
                            PluginError::BadArgs("sync restore needs a version".into())
                        })?;
                    payload.insert("version".to_string(), version.into());
                    "restore"
                } else {
                    "retry"
                }
            }
            _ => return Err(PluginError::UnknownCommand(command.to_string().into())),
        };
        if mode.is_dry_run() {
            return Ok(CommandOutcome::notify(Text::from(format!(
                "sync {op}: simulazione, nessun job accodato"
            ))));
        }
        enqueue_pass(host, op, payload)
    }
}
