//! Backup locale del vault, nello spazio dati del plugin.
//!
//! Non è un backup fuori dal vault: `HostApi` non scrive oltre il recinto, e
//! `permission::EXTERNAL_FS` oggi non ha un consumatore. I byte stanno in
//! `.fub/plugins/fub.backup/<data>/…`, che il vault non indicizza. Ripristino
//! = `create_document` delle note che nel vault non ci sono più.

use fub_abi::command::{
    Args, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::locale::civil_from_days;
use fub_abi::model::DocId;
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiNode, ViewUpdate};
use serde::{Deserialize, Serialize};

/// Id del componente (spazio dati/registrazione).
pub const BACKUP_ID: &str = "fub.backup";
/// Id della `ViewSpec`.
pub const BACKUP_VIEW: &str = "backup";
/// Crea uno snapshot delle note.
pub const VAULT_BACKUP: &str = "vault.backup";
/// Ripristina le note mancanti da uno snapshot.
pub const VAULT_BACKUP_RESTORE: &str = "vault.backup.restore";

const MANIFEST: &str = "snapshots.json";
const SCHEMA: u32 = 1;
const RUN: &str = "run";
const RESTORE: &str = "restore";
const ID: &str = "id";

const VIEW_TITLE: &str = "view_title";
const EMPTY: &str = "empty";
const RUN_LABEL: &str = "run_label";
const RESTORE_LABEL: &str = "restore_label";
const SNAPSHOT: &str = "snapshot";
const E_MISSING: &str = "e_missing";
const P_BACKUP: &str = "p_backup";
const P_RESTORE: &str = "p_restore";
const FAILED: &str = "failed";

/// Le stringhe del pannello e dei comandi.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Backup")
            .with(EMPTY, "Nessuno snapshot.")
            .with(RUN_LABEL, "Backup ora")
            .with(RESTORE_LABEL, "Ripristina")
            .with(SNAPSHOT, "{id} ({n} note)")
            .with(E_MISSING, "Nessuno snapshot «{id}».")
            .with(P_BACKUP, "Salvate {n} note in «{id}»")
            .with(P_RESTORE, "Ripristinate {n} note da «{id}»")
            .with(FAILED, "Backup: {reason}")
            .with("vault.backup.title", "Backup del vault")
            .with(
                "vault.backup.desc",
                "Copia le note nello spazio dati del plugin, per data.",
            )
            .with("vault.backup.restore.title", "Ripristina backup")
            .with(
                "vault.backup.restore.desc",
                "Ricrea le note dello snapshot che nel vault non ci sono più.",
            )
            .with("vault.backup.restore.id.title", "Id")
            .with(
                "vault.backup.restore.id.desc",
                "La data dello snapshot, YYYY-MM-DD.",
            ),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Backup")
            .with(EMPTY, "No snapshots.")
            .with(RUN_LABEL, "Back up now")
            .with(RESTORE_LABEL, "Restore")
            .with(SNAPSHOT, "{id} ({n} notes)")
            .with(E_MISSING, "No snapshot «{id}».")
            .with(P_BACKUP, "Saved {n} notes in «{id}»")
            .with(P_RESTORE, "Restored {n} notes from «{id}»")
            .with(FAILED, "Backup: {reason}")
            .with("vault.backup.title", "Back up vault")
            .with(
                "vault.backup.desc",
                "Copies notes into the plugin data space, keyed by date.",
            )
            .with("vault.backup.restore.title", "Restore backup")
            .with(
                "vault.backup.restore.desc",
                "Recreates snapshot notes that are no longer in the vault.",
            )
            .with("vault.backup.restore.id.title", "Id")
            .with(
                "vault.backup.restore.id.desc",
                "The snapshot date, YYYY-MM-DD.",
            ),
    ]
}

/// Il pannello degli snapshot.
pub struct BackupView;

impl ViewProvider for BackupView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            BACKUP_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::RightSidebar,
        )
        .with_icon("backup")
        .ordered(7)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host, None)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            RUN => command_then_tree(host, VAULT_BACKUP, serde_json::json!({})),
            RESTORE => {
                let Some(id) = action.payload.get(ID).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                command_then_tree(host, VAULT_BACKUP_RESTORE, serde_json::json!({ ID: id }))
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

fn command_then_tree(
    host: &mut dyn HostApi,
    id: &str,
    args: serde_json::Value,
) -> Result<ViewUpdate, PluginError> {
    match host.run_command(id, args) {
        Ok(_) => Ok(ViewUpdate::Replace {
            root: tree(host, None)?,
        }),
        Err(and) => Ok(ViewUpdate::Replace {
            root: tree(
                host,
                Some(Text::message(
                    FAILED,
                    vec![Arg::text("reason", and.to_string())],
                )),
            )?,
        }),
    }
}

fn tree(host: &dyn ReadApi, warning: Option<Text>) -> Result<UiNode, PluginError> {
    let store = load(host)?;
    let mut children = Vec::new();
    if let Some(warning) = warning {
        children.push(UiNode::failed(warning, None));
    }
    children.push(UiNode::button(
        Text::key(RUN_LABEL),
        Intent::Primary,
        ActionRef::new(RUN),
    ));
    if store.snapshots.is_empty() {
        children.push(UiNode::empty_state(Text::key(EMPTY)));
    } else {
        children.push(UiNode::list(
            store
                .snapshots
                .iter()
                .rev()
                .map(|s| {
                    let payload = serde_json::json!({ ID: s.id });
                    UiNode::keyed(
                        &s.id,
                        fub_abi::ui::UiKind::Stack {
                            dir: fub_abi::ui::Axis::Row,
                            gap: 1,
                            children: vec![
                                UiNode::list_item(
                                    Text::message(
                                        SNAPSHOT,
                                        vec![
                                            Arg::text(ID, s.id.clone()),
                                            Arg::int("n", s.n as i64),
                                        ],
                                    ),
                                    None,
                                    None,
                                ),
                                UiNode::button(
                                    Text::key(RESTORE_LABEL),
                                    Intent::Primary,
                                    ActionRef::with(RESTORE, payload),
                                ),
                            ],
                        },
                    )
                })
                .collect(),
        ));
    }
    Ok(UiNode::column(1, children))
}

/// I comandi `vault.backup` / `vault.backup.restore`.
pub struct BackupCommands;

impl CommandProvider for BackupCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            command(VAULT_BACKUP).with_scope(CommandScope::writing(CommandReach::Vault)),
            command(VAULT_BACKUP_RESTORE)
                .with_param(parameter(VAULT_BACKUP_RESTORE, ID, ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Vault)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            VAULT_BACKUP => backup(mode, host),
            VAULT_BACKUP_RESTORE => restore(Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn command(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(format!("{id}.title")))
        .describing(Text::key(format!("{id}.desc")))
}

fn parameter(command: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{command}.{name}.title")), kind)
        .describing(Text::key(format!("{command}.{name}.desc")))
}

fn backup(mode: InvokeMode, host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    let id = today(host);
    let docs = host.list_documents(None)?.items;
    let n = docs.len() as i64;
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            P_BACKUP,
            vec![Arg::int("n", n), Arg::text(ID, &id)],
        )));
    }
    for path in host.data_list(&id)? {
        host.data_remove(&path)?;
    }
    for doc in &docs {
        let src = host.read_document(doc)?;
        host.data_write(&format!("{id}/{}", doc.as_str()), src.as_bytes())?;
    }
    let mut store = load(host)?;
    if let Some(existing) = store.snapshots.iter_mut().find(|s| s.id == id) {
        existing.n = docs.len() as u32;
    } else {
        store.snapshots.push(Snapshot {
            id: id.clone(),
            n: docs.len() as u32,
        });
    }
    persist(host, &store)?;
    Ok(CommandOutcome::notify(Text::message(
        P_BACKUP,
        vec![Arg::int("n", n), Arg::text(ID, id)],
    )))
}

fn restore(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let id = args
        .text(ID)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::message(E_MISSING, vec![Arg::text(ID, "")])))?
        .to_string();
    let store = load(host)?;
    if !store.snapshots.iter().any(|s| s.id == id) {
        return Err(PluginError::BadArgs(Text::message(
            E_MISSING,
            vec![Arg::text(ID, &id)],
        )));
    }
    let files = host.data_list(&id)?;
    let existing: std::collections::BTreeSet<String> = host
        .list_documents(None)?
        .items
        .into_iter()
        .map(|d| d.0)
        .collect();
    let prefix = format!("{id}/");
    let from_create: Vec<(DocId, String)> = files
        .into_iter()
        .filter_map(|path| {
            let rel = path.strip_prefix(&prefix)?;
            if existing.contains(rel) {
                return None;
            }
            Some(DocId::new(rel))
        })
        .filter_map(|doc| {
            let path = format!("{id}/{}", doc.as_str());
            let bytes = host.data_read(&path).ok().flatten()?;
            String::from_utf8(bytes).ok().map(|src| (doc, src))
        })
        .collect();
    let n = from_create.len() as i64;
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            P_RESTORE,
            vec![Arg::int("n", n), Arg::text(ID, &id)],
        )));
    }
    for (doc, src) in from_create {
        host.create_document(&doc, &src)?;
    }
    Ok(CommandOutcome::notify(Text::message(
        P_RESTORE,
        vec![Arg::int("n", n), Arg::text(ID, id)],
    )))
}

fn today(host: &dyn ReadApi) -> String {
    let locale = host.user_locale();
    let civil = locale.to_civil_millis(host.now_unix_millis());
    let days = civil.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Store {
    schema_version: u32,
    snapshots: Vec<Snapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Snapshot {
    id: String,
    n: u32,
}

fn load(host: &dyn ReadApi) -> Result<Store, PluginError> {
    match host.data_read(MANIFEST)? {
        None => Ok(Store {
            schema_version: SCHEMA,
            snapshots: Vec::new(),
        }),
        Some(bytes) => serde_json::from_slice(&bytes)
            .map_err(|and| PluginError::Internal(format!("snapshots.json: {and}").into())),
    }
}

fn persist(host: &mut dyn HostApi, store: &Store) -> Result<(), PluginError> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|and| PluginError::Internal(format!("snapshots.json: {and}").into()))?;
    host.data_write(MANIFEST, &bytes)
}
