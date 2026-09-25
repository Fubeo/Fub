//! P16 views leggono snapshot persistiti dal job nella root trusted del bundle.
//! Non leggono view-state per-esemplare fuori dal contesto di una view e non
//! eseguono rete durante il render.

use fub_abi::event::{EventKind, EventMask};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    HostApi, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiNode, ViewUpdate};
use fub_abi::PluginError;

/// Provider id (registration + view-state namespace).
pub const SYNC_ID: &str = "fub.sync";
/// Status view: outbox/cursor/conflicts lifeline.
pub const SYNC_STATUS_VIEW: &str = "sync.status";
/// Versions + conflicts view for restore/retry.
pub const SYNC_VERSIONS_VIEW: &str = "sync.versions";
/// Conflicts view (same data, conflict-first ordering).
pub const SYNC_CONFLICTS_VIEW: &str = "sync.conflicts";

/// Snapshot non autorevole: cursor/outbox rimangono sotto la root trusted.
const SNAPSHOT_FILE: &str = "sync-snapshot.json";

/// Actions served by `on_action` (payload keys documented per action).
pub const ACTION_PAUSE: &str = "pause";
pub const ACTION_RESUME: &str = "resume";
pub const ACTION_RESTORE: &str = "restore";
/// Il sì alla domanda che «Ripristina» fa prima di riscrivere la nota.
pub const ACTION_RESTORE_CONFIRM: &str = "restore_confirm";
pub const ACTION_RESTORE_CANCEL: &str = "restore_cancel";
pub const ACTION_RETRY: &str = "retry";

/// La versione di cui si sta chiedendo il ripristino, finché non si risponde.
const CONFIRM_STATE: &str = "restore_confirm";

// Le chiavi del catalogo: le qualifica l'host con l'id del bundle.
const T_STATUS: &str = "view.status";
const T_VERSIONS: &str = "view.versions";
const T_CONFLICTS: &str = "view.conflicts";
const T_NOT_CONFIGURED: &str = "not_configured";
const T_LAST_ERROR: &str = "last_error";
const T_RUNNING: &str = "status.running";
const T_PAUSED: &str = "status.paused";
const T_PAUSE: &str = "pause";
const T_RESUME: &str = "resume";
const T_ENTRY: &str = "entry";
const T_ENTRY_DETAIL: &str = "entry.detail";
const T_TRUNCATED: &str = "truncated";
const T_LOG: &str = "log";
const T_NO_CONFLICTS: &str = "no_conflicts";
const T_NO_VERSIONS: &str = "no_versions";
const T_RETRY: &str = "retry";
const T_VERSION: &str = "version";
const T_VERSION_DETAIL: &str = "version.detail";
const T_RESTORE: &str = "restore";
const T_RESTORE_QUESTION: &str = "restore.question";
const T_RESTORE_CONFIRM: &str = "restore.confirm";
const T_CANCEL: &str = "cancel";
const F_SNAPSHOT_CORRUPT: &str = "fault.snapshot_corrupt";
const F_SNAPSHOT_UNREADABLE: &str = "fault.snapshot_unreadable";
const F_VERSIONS_CORRUPT: &str = "fault.versions_corrupt";
const F_VERSIONS_UNREADABLE: &str = "fault.versions_unreadable";
const F_CONFLICTS_CORRUPT: &str = "fault.conflicts_corrupt";
const F_CONFLICTS_UNREADABLE: &str = "fault.conflicts_unreadable";

/// Le stringhe della sincronizzazione, pannelli e comandi, nelle due lingue.
pub fn catalog() -> Vec<StringCatalog> {
    let it = StringCatalog::new("it")
        .with(T_STATUS, "Sincronizzazione")
        .with(T_VERSIONS, "Versioni sincronizzate")
        .with(T_CONFLICTS, "Conflitti di sincronizzazione")
        .with(
            T_NOT_CONFIGURED,
            "La sincronizzazione non è configurata: si imposta da Impostazioni › Sincronizzazione.",
        )
        .with(T_LAST_ERROR, "Ultimo errore: {reason}")
        .with(T_RUNNING, "Replica {replica} · attiva · {pending} in attesa · {applied} applicate")
        .with(T_PAUSED, "Replica {replica} · in pausa · {pending} in attesa · {applied} applicate")
        .with(T_PAUSE, "Metti in pausa")
        .with(T_RESUME, "Riprendi")
        .with(T_ENTRY, "{state} · locale {local} / server {server}")
        .with(T_ENTRY_DETAIL, "{state} · locale {local} / server {server} · {detail}")
        .with(T_TRUNCATED, "Sul server ci sono altri file: l'elenco si ferma a 5000.")
        .with(T_LOG, "{kind} · {when}")
        .with(T_NO_CONFLICTS, "Nessun conflitto.")
        .with(T_NO_VERSIONS, "Ancora nessuna versione sincronizzata.")
        .with(T_RETRY, "Riprova")
        .with(T_VERSION, "{doc} · versione {version}")
        .with(T_VERSION_DETAIL, "{when} · {hash}")
        .with(T_RESTORE, "Ripristina")
        .with(
            T_RESTORE_QUESTION,
            "Sostituire la nota con questa versione del server? Il testo di adesso resta nella cronologia.",
        )
        .with(T_RESTORE_CONFIRM, "Sì, ripristina")
        .with(T_CANCEL, "Annulla")
        .with(F_SNAPSHOT_CORRUPT, "Lo stato della sincronizzazione è danneggiato: serve un recupero.")
        .with(F_SNAPSHOT_UNREADABLE, "Lo stato della sincronizzazione non si legge.")
        .with(F_VERSIONS_CORRUPT, "L'elenco delle versioni è danneggiato: serve un recupero.")
        .with(F_VERSIONS_UNREADABLE, "L'elenco delle versioni non si legge.")
        .with(F_CONFLICTS_CORRUPT, "L'elenco dei conflitti è danneggiato: serve un recupero.")
        .with(F_CONFLICTS_UNREADABLE, "L'elenco dei conflitti non si legge.");
    let en = StringCatalog::new("en")
        .with(T_STATUS, "Sync")
        .with(T_VERSIONS, "Synced versions")
        .with(T_CONFLICTS, "Sync conflicts")
        .with(
            T_NOT_CONFIGURED,
            "Sync is not configured: set it up in Settings › Synchronization.",
        )
        .with(T_LAST_ERROR, "Last error: {reason}")
        .with(
            T_RUNNING,
            "Replica {replica} · running · {pending} pending · {applied} applied",
        )
        .with(
            T_PAUSED,
            "Replica {replica} · paused · {pending} pending · {applied} applied",
        )
        .with(T_PAUSE, "Pause")
        .with(T_RESUME, "Resume")
        .with(T_ENTRY, "{state} · local {local} / server {server}")
        .with(
            T_ENTRY_DETAIL,
            "{state} · local {local} / server {server} · {detail}",
        )
        .with(
            T_TRUNCATED,
            "More files on the server; the list stops at 5000.",
        )
        .with(T_LOG, "{kind} · {when}")
        .with(T_NO_CONFLICTS, "No conflicts.")
        .with(T_NO_VERSIONS, "No synced versions yet.")
        .with(T_RETRY, "Retry")
        .with(T_VERSION, "{doc} · version {version}")
        .with(T_VERSION_DETAIL, "{when} · {hash}")
        .with(T_RESTORE, "Restore")
        .with(
            T_RESTORE_QUESTION,
            "Replace the note with this server version? The current text stays in the history.",
        )
        .with(T_RESTORE_CONFIRM, "Yes, restore")
        .with(T_CANCEL, "Cancel")
        .with(
            F_SNAPSHOT_CORRUPT,
            "The sync state is damaged: recovery is needed.",
        )
        .with(F_SNAPSHOT_UNREADABLE, "The sync state cannot be read.")
        .with(
            F_VERSIONS_CORRUPT,
            "The version list is damaged: recovery is needed.",
        )
        .with(F_VERSIONS_UNREADABLE, "The version list cannot be read.")
        .with(
            F_CONFLICTS_CORRUPT,
            "The conflict list is damaged: recovery is needed.",
        )
        .with(F_CONFLICTS_UNREADABLE, "The conflict list cannot be read.");
    let (it, en) = super::commands::catalog_rows(it, en);
    vec![it, en]
}

/// Snapshot per presentazione; l'assenza indica che il primo job non è passato.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncSnapshot {
    #[serde(default)]
    pub replica_id: String,
    #[serde(default)]
    pub vault_id: String,
    #[serde(default)]
    pub pending: usize,
    #[serde(default)]
    pub applied: usize,
    #[serde(default)]
    pub conflicts: Vec<SnapshotConflict>,
    #[serde(default)]
    pub versions: Vec<SnapshotVersion>,
    /// Per-document rows from the authenticated service, overlaid with the
    /// local durable outbox/cursor by the job (never guessed by the view).
    #[serde(default)]
    pub entries: Vec<super::sync::SyncStatusEntry>,
    #[serde(default)]
    pub log: Vec<SyncLogRow>,
    #[serde(default)]
    pub entries_truncated: bool,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub paused: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotConflict {
    pub doc_id: String,
    pub reason: String,
    #[serde(default)]
    pub replicas: Vec<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotVersion {
    pub doc_id: String,
    #[serde(with = "super::u64_string")]
    pub version: u64,
    pub hash: String,
    pub ts_ms: u64,
    pub vv_text: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncLogRow {
    pub doc_id: String,
    pub kind: String,
    pub ts_ms: u64,
}

/// Il path trusted viene catturato dal bundle al montaggio, mai da payload.
pub struct SyncViews {
    state_root: Option<camino::Utf8PathBuf>,
}

impl SyncViews {
    pub fn new(state_root: Option<camino::Utf8PathBuf>) -> Self {
        Self { state_root }
    }

    /// Lo stato da mostrare, e i guasti incontrati leggendolo (chiavi del
    /// catalogo: li scrive questa view, non il job).
    fn snapshot(&self, host: &dyn ReadApi) -> (SyncSnapshot, Vec<&'static str>) {
        let Some(root) = &self.state_root else {
            return (SyncSnapshot::default(), Vec::new());
        };
        let mut faults = Vec::new();
        let mut snap = match std::fs::read(root.join(SNAPSHOT_FILE)) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                faults.push(F_SNAPSHOT_CORRUPT);
                SyncSnapshot::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => SyncSnapshot::default(),
            Err(_) => {
                faults.push(F_SNAPSHOT_UNREADABLE);
                SyncSnapshot::default()
            }
        };
        match std::fs::read(root.join("versions.json")) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(versions) => snap.versions = versions,
                Err(_) => faults.push(F_VERSIONS_CORRUPT),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => faults.push(F_VERSIONS_UNREADABLE),
        }
        match std::fs::read(root.join("conflicts.json")) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(conflicts) => snap.conflicts = conflicts,
                Err(_) => faults.push(F_CONFLICTS_CORRUPT),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => faults.push(F_CONFLICTS_UNREADABLE),
        }
        snap.paused = root.join("sync-paused").exists()
            || matches!(
                host.setting(super::SETTING_PAUSED),
                Ok(fub_abi::settings::SettingValue::Toggle(true))
            );
        (snap, faults)
    }
}

impl ViewProvider for SyncViews {
    fn views(&self) -> Vec<ViewSpec> {
        vec![
            ViewSpec::new(
                SYNC_STATUS_VIEW,
                Text::key(T_STATUS),
                ViewSurface::LeftSidebar,
            )
            .with_icon("sync")
            .ordered(20),
            ViewSpec::new(
                SYNC_VERSIONS_VIEW,
                Text::key(T_VERSIONS),
                ViewSurface::LeftSidebar,
            )
            .with_icon("history")
            .ordered(21),
            ViewSpec::new(
                SYNC_CONFLICTS_VIEW,
                Text::key(T_CONFLICTS),
                ViewSurface::LeftSidebar,
            )
            .with_icon("warning")
            .ordered(22),
        ]
    }

    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Outbox/cursor/conflicts move with the index, batches, and the
            // sync job itself. IndexUpdated implies BatchEnded pairing.
            refresh: EventMask::of([
                EventKind::IndexUpdated,
                EventKind::BatchEnded,
                EventKind::JobDone,
            ]),
            follows: Default::default(),
        }
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let (snap, faults) = self.snapshot(host);
        match instance.view.as_str() {
            SYNC_STATUS_VIEW => Ok(status_tree(&snap, &faults)),
            SYNC_VERSIONS_VIEW => {
                let asking = host.view_state(CONFIRM_STATE)?;
                Ok(versions_tree(&snap, asking.as_ref()))
            }
            SYNC_CONFLICTS_VIEW => Ok(conflicts_tree(&snap)),
            _ => Err(PluginError::UnknownView(instance.view.clone().into())),
        }
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            ACTION_PAUSE => {
                host.run_command("sync.pause", serde_json::Value::Null)?;
                Ok(ViewUpdate::None)
            }
            ACTION_RESUME => {
                host.run_command("sync.resume", serde_json::Value::Null)?;
                Ok(ViewUpdate::None)
            }
            // Ripristinare riscrive la nota con la versione del server: prima
            // si chiede, al posto del bottone.
            ACTION_RESTORE => {
                host.set_view_state(CONFIRM_STATE, Some(action.payload.clone()))?;
                Ok(ViewUpdate::Replace {
                    root: self.render_view(instance, host)?,
                })
            }
            ACTION_RESTORE_CANCEL => {
                host.set_view_state(CONFIRM_STATE, None)?;
                Ok(ViewUpdate::Replace {
                    root: self.render_view(instance, host)?,
                })
            }
            ACTION_RESTORE_CONFIRM => {
                host.set_view_state(CONFIRM_STATE, None)?;
                let doc = action
                    .payload
                    .get("doc_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let version = action
                    .payload
                    .get("version")
                    .and_then(|v| v.as_str())
                    .filter(|v| v.parse::<u64>().is_ok_and(|n| n > 0))
                    .ok_or_else(|| PluginError::BadArgs("restore needs version".into()))?;
                if doc.is_empty() {
                    return Err(PluginError::BadArgs("restore needs doc_id".into()));
                }
                host.run_command(
                    "sync.restore_version",
                    serde_json::json!({ "doc": doc, "version": version }),
                )?;
                Ok(ViewUpdate::Replace {
                    root: self.render_view(instance, host)?,
                })
            }
            ACTION_RETRY => {
                let doc = action
                    .payload
                    .get("doc_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if doc.is_empty() {
                    return Err(PluginError::BadArgs("retry needs doc_id".into()));
                }
                host.run_command("sync.retry_conflict", serde_json::json!({ "doc": doc }))?;
                Ok(ViewUpdate::None)
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

fn status_tree(snap: &SyncSnapshot, faults: &[&'static str]) -> UiNode {
    let mut children = Vec::new();
    for fault in faults {
        children.push(UiNode::failed(Text::key(*fault), None));
    }
    if let Some(error) = &snap.last_error {
        children.push(UiNode::failed(
            Text::message(T_LAST_ERROR, vec![Arg::text("reason", error.clone())]),
            None,
        ));
    }
    if snap.replica_id.is_empty() && snap.vault_id.is_empty() {
        children.push(UiNode::empty_state(Text::key(T_NOT_CONFIGURED)));
        return UiNode::column(1, children);
    }
    children.push(UiNode::text(Text::message(
        if snap.paused { T_PAUSED } else { T_RUNNING },
        vec![
            Arg::text("replica", short(&snap.replica_id)),
            Arg::int("pending", snap.pending as i64),
            Arg::int("applied", snap.applied as i64),
        ],
    )));
    if snap.paused {
        children.push(UiNode::button(
            Text::key(T_RESUME),
            Intent::Primary,
            ActionRef::new(ACTION_RESUME),
        ));
    } else {
        children.push(UiNode::button(
            Text::key(T_PAUSE),
            Intent::Neutral,
            ActionRef::new(ACTION_PAUSE),
        ));
    }
    if !snap.entries.is_empty() {
        children.push(UiNode::list(
            snap.entries
                .iter()
                .map(|entry| {
                    let mut args = vec![
                        Arg::text("state", entry.state.to_string()),
                        Arg::int("local", entry.local_counter as i64),
                        Arg::int("server", entry.server_counter as i64),
                    ];
                    let key = match &entry.detail {
                        Some(detail) => {
                            args.push(Arg::text("detail", detail.clone()));
                            T_ENTRY_DETAIL
                        }
                        None => T_ENTRY,
                    };
                    UiNode::keyed(
                        format!("status:{}", entry.doc_id),
                        fub_abi::ui::UiKind::Stack {
                            dir: fub_abi::ui::Axis::Column,
                            gap: 0,
                            children: vec![UiNode::list_item(
                                Text::from(entry.doc_id.clone()),
                                Some(Text::message(key, args)),
                                None,
                            )],
                        },
                    )
                })
                .collect::<Vec<_>>(),
        ));
    }
    if snap.entries_truncated {
        children.push(UiNode::text(Text::key(T_TRUNCATED)));
    }
    if !snap.log.is_empty() {
        children.push(UiNode::list(
            snap.log
                .iter()
                .map(|row| {
                    UiNode::list_item(
                        Text::from(row.doc_id.clone()),
                        Some(Text::message(
                            T_LOG,
                            vec![
                                Arg::text("kind", row.kind.clone()),
                                Arg::timestamp("when", row.ts_ms),
                            ],
                        )),
                        None,
                    )
                })
                .collect::<Vec<_>>(),
        ));
    }

    if snap.conflicts.is_empty() {
        children.push(UiNode::text(Text::key(T_NO_CONFLICTS)));
    } else {
        children.push(UiNode::list(
            snap.conflicts.iter().map(conflict_row).collect::<Vec<_>>(),
        ));
    }
    UiNode::column(1, children)
}

fn versions_tree(snap: &SyncSnapshot, asking: Option<&serde_json::Value>) -> UiNode {
    if snap.versions.is_empty() {
        return UiNode::column(1, vec![UiNode::empty_state(Text::key(T_NO_VERSIONS))]);
    }
    UiNode::column(
        1,
        vec![UiNode::list(
            snap.versions
                .iter()
                .map(|version| version_row(version, asking))
                .collect::<Vec<_>>(),
        )],
    )
}

fn conflicts_tree(snap: &SyncSnapshot) -> UiNode {
    if snap.conflicts.is_empty() {
        return UiNode::column(1, vec![UiNode::empty_state(Text::key(T_NO_CONFLICTS))]);
    }
    UiNode::column(
        1,
        vec![UiNode::list(
            snap.conflicts.iter().map(conflict_row).collect::<Vec<_>>(),
        )],
    )
}

fn conflict_row(c: &SnapshotConflict) -> UiNode {
    UiNode::keyed(
        format!("conflict:{}", c.doc_id),
        fub_abi::ui::UiKind::Stack {
            dir: fub_abi::ui::Axis::Column,
            gap: 0,
            children: vec![
                UiNode::list_item(
                    Text::from(c.doc_id.clone()),
                    Some(Text::from(c.reason.clone())),
                    None,
                ),
                UiNode::row(
                    1,
                    vec![UiNode::button(
                        Text::key(T_RETRY),
                        Intent::Primary,
                        ActionRef::with(ACTION_RETRY, serde_json::json!({ "doc_id": c.doc_id })),
                    )],
                ),
            ],
        },
    )
}

fn version_row(v: &SnapshotVersion, asking: Option<&serde_json::Value>) -> UiNode {
    let payload = serde_json::json!({ "doc_id": v.doc_id, "version": v.version.to_string() });
    let actions = if asking == Some(&payload) {
        vec![
            UiNode::text(Text::key(T_RESTORE_QUESTION)),
            UiNode::button(
                Text::key(T_RESTORE_CONFIRM),
                Intent::Danger,
                ActionRef::with(ACTION_RESTORE_CONFIRM, payload),
            ),
            UiNode::button(
                Text::key(T_CANCEL),
                Intent::Neutral,
                ActionRef::new(ACTION_RESTORE_CANCEL),
            ),
        ]
    } else {
        vec![UiNode::button(
            Text::key(T_RESTORE),
            Intent::Neutral,
            ActionRef::with(ACTION_RESTORE, payload),
        )]
    };
    let mut children = vec![UiNode::list_item(
        Text::message(
            T_VERSION,
            vec![
                Arg::text("doc", v.doc_id.clone()),
                Arg::text("version", v.version.to_string()),
            ],
        ),
        Some(Text::message(
            T_VERSION_DETAIL,
            vec![
                Arg::timestamp("when", v.ts_ms),
                Arg::text("hash", v.hash.chars().take(12).collect::<String>()),
            ],
        )),
        None,
    )];
    children.extend(actions);
    UiNode::keyed(
        format!("version:{}:{}", v.doc_id, v.version),
        fub_abi::ui::UiKind::Stack {
            dir: fub_abi::ui::Axis::Column,
            gap: 0,
            children,
        },
    )
}

fn short(id: &str) -> String {
    id.chars().take(8).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::ViewProvider;
    use fub_abi::ui::UiKind;
    use fub_sdk::testing::MemoryHost;

    fn action_of(node: &UiNode, wanted: &str) -> Option<ActionRef> {
        if let UiKind::Button { action, .. } = &node.kind {
            if action.action.0 == wanted {
                return Some(action.clone());
            }
        }
        node.children()
            .into_iter()
            .find_map(|child| action_of(child, wanted))
    }

    /// «Ripristina» su una versione del server chiede prima: il primo click
    /// disegna la domanda al posto del bottone, il no la toglie, e solo il sì
    /// fa partire il comando — che `MemoryHost` non sa eseguire, quindi un
    /// comando partito prima del sì sarebbe un errore.
    #[test]
    fn restoring_a_server_version_asks_first() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(
            root.join("versions.json"),
            serde_json::to_vec(&vec![SnapshotVersion {
                doc_id: "Nota.md".into(),
                version: 3,
                hash: "abcdef0123456789".into(),
                ts_ms: 1_700_000_000_000,
                vv_text: "a:3".into(),
            }])
            .unwrap(),
        )
        .unwrap();
        let mut views = SyncViews::new(Some(root));
        let mut host = MemoryHost::new().with_instance("e");
        let instance = ViewInstance::only(SYNC_VERSIONS_VIEW);
        let mut click = |host: &mut MemoryHost, action: ActionRef| {
            views.on_action(
                &instance,
                UiAction::new(action.action.0).with_payload(action.payload),
                host,
            )
        };

        let tree = SyncViews::new(None).render_view(&instance, &host).unwrap();
        assert!(
            action_of(&tree, ACTION_RESTORE).is_none(),
            "senza stato, niente versioni"
        );

        let tree = {
            let dir_views = SyncViews::new(Some(
                camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap(),
            ));
            dir_views.render_view(&instance, &host).unwrap()
        };
        let restore = action_of(&tree, ACTION_RESTORE).expect("il bottone c'è");
        let ViewUpdate::Replace { root } = click(&mut host, restore).unwrap() else {
            panic!("la domanda si disegna")
        };
        assert!(action_of(&root, ACTION_RESTORE).is_none());
        let yes = action_of(&root, ACTION_RESTORE_CONFIRM).expect("il sì c'è");

        let ViewUpdate::Replace { root } =
            click(&mut host, ActionRef::new(ACTION_RESTORE_CANCEL)).unwrap()
        else {
            panic!("il pannello si ridisegna")
        };
        assert!(
            action_of(&root, ACTION_RESTORE).is_some(),
            "torna il bottone"
        );

        let error = click(&mut host, yes).unwrap_err();
        assert!(
            matches!(&error, PluginError::UnknownCommand(command)
                if *command == "sync.restore_version"),
            "{error:?}"
        );
    }
}
