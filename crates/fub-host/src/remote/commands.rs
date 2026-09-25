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
    Ok(CommandOutcome::notify(Text::key("queued")))
}

/// Le stringhe dei comandi, aggiunte ai cataloghi del bundle
/// ([`super::views::catalog`]).
pub(crate) fn catalog_rows(
    it: fub_abi::text::StringCatalog,
    en: fub_abi::text::StringCatalog,
) -> (fub_abi::text::StringCatalog, fub_abi::text::StringCatalog) {
    let it = it
        .with("cmd.push", "Sincronizzazione: invia ora")
        .with("cmd.push.desc", "Manda al server le modifiche in coda (un passaggio solo).")
        .with("cmd.pull", "Sincronizzazione: ricevi ora")
        .with("cmd.pull.desc", "Riceve dal server, verifica e applica le modifiche remote (un passaggio solo).")
        .with("cmd.pause", "Sincronizzazione: metti in pausa")
        .with("cmd.pause.desc", "Ferma le nuove operazioni senza perdere la coda. Si riprende quando si vuole.")
        .with("cmd.resume", "Sincronizzazione: riprendi")
        .with("cmd.resume.desc", "Riprende una sincronizzazione in pausa.")
        .with("cmd.retry", "Sincronizzazione: riprova il conflitto")
        .with("cmd.retry.desc", "Rimanda la nota al prossimo passaggio. Non sovrascrive niente.")
        .with("cmd.restore", "Sincronizzazione: ripristina una versione")
        .with("cmd.restore.desc", "Riporta una nota a una sua versione sul server, come una scrittura nuova.")
        .with("cmd.invite", "Sincronizzazione: invita")
        .with("cmd.invite.desc", "Crea un invito al vault; il codice va consegnato per un altro canale.")
        .with("cmd.accept", "Sincronizzazione: accetta un invito")
        .with("cmd.accept.desc", "Accetta il codice d'invito letto da FUB_SYNC_INVITE_TOKEN_FILE.")
        .with("cmd.revoke", "Sincronizzazione: revoca un accesso")
        .with("cmd.revoke.desc", "Toglie a un account l'accesso futuro; le copie già scaricate restano.")
        .with("cmd.rekey", "Sincronizzazione: ruota la chiave del vault")
        .with("cmd.rekey.desc", "Ruota la chiave per le scritture future; ogni dispositivo deve ricevere la nuova chiave per un altro canale.")
        .with("param.doc", "Nota")
        .with("param.version", "Versione")
        .with("param.role", "Ruolo (reader, writer o admin)")
        .with("param.account", "Id dell'account")
        .with("queued", "Operazione di sincronizzazione in coda.")
        .with("dry_run", "Simulazione: nessuna operazione in coda.");
    let en = en
        .with("cmd.push", "Sync: push now")
        .with("cmd.push.desc", "Push the queued changes to the server (a single pass).")
        .with("cmd.pull", "Sync: pull now")
        .with("cmd.pull.desc", "Pull, verify and apply the remote changes (a single pass).")
        .with("cmd.pause", "Sync: pause")
        .with("cmd.pause.desc", "Stop new operations without losing the queue. Resume at any time.")
        .with("cmd.resume", "Sync: resume")
        .with("cmd.resume.desc", "Resume a paused sync.")
        .with("cmd.retry", "Sync: retry conflict")
        .with("cmd.retry.desc", "Send the note again on the next pass. Nothing is overwritten.")
        .with("cmd.restore", "Sync: restore version")
        .with("cmd.restore.desc", "Take a note back to one of its server versions, as a new write.")
        .with("cmd.invite", "Sync: invite")
        .with("cmd.invite.desc", "Create a vault invite; the token must be delivered through another channel.")
        .with("cmd.accept", "Sync: accept invite")
        .with("cmd.accept.desc", "Accept the invite token read from FUB_SYNC_INVITE_TOKEN_FILE.")
        .with("cmd.revoke", "Sync: revoke")
        .with("cmd.revoke.desc", "Revoke an account's future access; copies already downloaded remain.")
        .with("cmd.rekey", "Sync: rotate vault key")
        .with("cmd.rekey.desc", "Rotate the key for future writes; every device needs the new key through another channel.")
        .with("param.doc", "Note")
        .with("param.version", "Version")
        .with("param.role", "Role (reader, writer or admin)")
        .with("param.account", "Account ID")
        .with("queued", "Sync operation queued.")
        .with("dry_run", "Dry run: no operation queued.");
    (it, en)
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
    let mut s = CommandSpec::new(id, Text::key(title))
        .describing(Text::key(description))
        .with_scope(scope);
    for p in params {
        s = s.with_param(p);
    }
    s
}

fn doc_param() -> ParamSpec {
    ParamSpec::new("doc", Text::key("param.doc"), ParamKind::Document).required()
}

fn version_param() -> ParamSpec {
    // Versioni come stringhe (u64-as-string): testo libero, validato nel job.
    ParamSpec::new("version", Text::key("param.version"), ParamKind::Text).required()
}

impl CommandProvider for SyncCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            spec(
                SYNC_PUSH_NOW,
                "cmd.push",
                "cmd.push.desc",
                CommandScope::writing(CommandReach::Vault),
                vec![],
            ),
            spec(
                SYNC_PULL_NOW,
                "cmd.pull",
                "cmd.pull.desc",
                CommandScope::writing(CommandReach::Vault),
                vec![],
            ),
            spec(
                SYNC_PAUSE,
                "cmd.pause",
                "cmd.pause.desc",
                CommandScope::writing(CommandReach::Session),
                vec![],
            ),
            spec(
                SYNC_RESUME,
                "cmd.resume",
                "cmd.resume.desc",
                CommandScope::writing(CommandReach::Session),
                vec![],
            ),
            spec(
                SYNC_RETRY_CONFLICT,
                "cmd.retry",
                "cmd.retry.desc",
                CommandScope::writing(CommandReach::Document),
                vec![doc_param()],
            ),
            spec(
                SYNC_RESTORE_VERSION,
                "cmd.restore",
                "cmd.restore.desc",
                CommandScope::writing(CommandReach::Document),
                vec![doc_param(), version_param()],
            ),
            spec(
                SYNC_INVITE,
                "cmd.invite",
                "cmd.invite.desc",
                CommandScope::writing(CommandReach::Vault),
                vec![ParamSpec::new("role", Text::key("param.role"), ParamKind::Text).required()],
            ),
            spec(
                SYNC_ACCEPT,
                "cmd.accept",
                "cmd.accept.desc",
                CommandScope::writing(CommandReach::Vault),
                vec![],
            ),
            spec(
                SYNC_REVOKE,
                "cmd.revoke",
                "cmd.revoke.desc",
                CommandScope::writing(CommandReach::Vault),
                vec![
                    ParamSpec::new("account_id", Text::key("param.account"), ParamKind::Text)
                        .required(),
                ],
            ),
            spec(
                SYNC_REKEY,
                "cmd.rekey",
                "cmd.rekey.desc",
                CommandScope::writing(CommandReach::Vault),
                vec![],
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
            return Ok(CommandOutcome::notify(Text::key("dry_run")));
        }
        enqueue_pass(host, op, payload)
    }
}
