//! P16 views leggono snapshot persistiti dal job nella root trusted del bundle.
//! Non leggono view-state per-esemplare fuori dal contesto di una view e non
//! eseguono rete durante il render.

use fub_abi::event::{EventKind, EventMask};
use fub_abi::text::Text;
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
pub const ACTION_RETRY: &str = "retry";

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

    fn snapshot(&self, host: &dyn ReadApi) -> SyncSnapshot {
        let Some(root) = &self.state_root else {
            return SyncSnapshot::default();
        };
        let mut snap = match std::fs::read(root.join(SNAPSHOT_FILE)) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| SyncSnapshot {
                last_error: Some("Sync snapshot corrupt; recovery required".into()),
                ..SyncSnapshot::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => SyncSnapshot::default(),
            Err(_) => SyncSnapshot {
                last_error: Some("Sync snapshot unreadable".into()),
                ..SyncSnapshot::default()
            },
        };
        match std::fs::read(root.join("versions.json")) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(versions) => snap.versions = versions,
                Err(_) => snap.last_error = Some("Sync versions corrupt; recovery required".into()),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => snap.last_error = Some("Sync versions unreadable".into()),
        }
        match std::fs::read(root.join("conflicts.json")) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(conflicts) => snap.conflicts = conflicts,
                Err(_) => {
                    snap.last_error = Some("Sync conflicts corrupt; recovery required".into())
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => snap.last_error = Some("Sync conflicts unreadable".into()),
        }
        snap.paused = root.join("sync-paused").exists()
            || matches!(
                host.setting(super::SETTING_PAUSED),
                Ok(fub_abi::settings::SettingValue::Toggle(true))
            );
        snap
    }
}

impl ViewProvider for SyncViews {
    fn views(&self) -> Vec<ViewSpec> {
        vec![
            ViewSpec::new(
                SYNC_STATUS_VIEW,
                Text::from("Sync status"),
                ViewSurface::LeftSidebar,
            )
            .with_icon("sync")
            .ordered(20),
            ViewSpec::new(
                SYNC_VERSIONS_VIEW,
                Text::from("Sync versions"),
                ViewSurface::LeftSidebar,
            )
            .with_icon("history")
            .ordered(21),
            ViewSpec::new(
                SYNC_CONFLICTS_VIEW,
                Text::from("Sync conflicts"),
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
        let snap = self.snapshot(host);
        match instance.view.as_str() {
            SYNC_STATUS_VIEW => Ok(status_tree(&snap)),
            SYNC_VERSIONS_VIEW => Ok(versions_tree(&snap)),
            SYNC_CONFLICTS_VIEW => Ok(conflicts_tree(&snap)),
            _ => Err(PluginError::UnknownView(instance.view.clone().into())),
        }
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
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
            ACTION_RESTORE => {
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
                Ok(ViewUpdate::None)
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

fn status_tree(snap: &SyncSnapshot) -> UiNode {
    let mut children = Vec::new();
    if let Some(error) = &snap.last_error {
        children.push(UiNode::failed(Text::from(error.clone()), None));
    }
    if snap.replica_id.is_empty() && snap.vault_id.is_empty() {
        children.push(UiNode::empty_state(Text::from(
            "Sync is not configured for this vault.",
        )));
        return UiNode::column(1, children);
    }
    let state = if snap.paused { "paused" } else { "running" };
    children.push(UiNode::text(Text::from(format!(
        "Replica {} · {state} · pending {} · applied {}",
        short(&snap.replica_id),
        snap.pending,
        snap.applied
    ))));
    if snap.paused {
        children.push(UiNode::button(
            Text::from("Resume"),
            Intent::Primary,
            ActionRef::new(ACTION_RESUME),
        ));
    } else {
        children.push(UiNode::button(
            Text::from("Pause"),
            Intent::Neutral,
            ActionRef::new(ACTION_PAUSE),
        ));
    }
    if !snap.entries.is_empty() {
        children.push(UiNode::list(
            snap.entries
                .iter()
                .map(|entry| {
                    UiNode::keyed(
                        format!("status:{}", entry.doc_id),
                        fub_abi::ui::UiKind::Stack {
                            dir: fub_abi::ui::Axis::Column,
                            gap: 0,
                            children: vec![UiNode::list_item(
                                Text::from(entry.doc_id.clone()),
                                Some(Text::from(format!(
                                    "{} · local {} / server {}{}",
                                    entry.state,
                                    entry.local_counter,
                                    entry.server_counter,
                                    entry
                                        .detail
                                        .as_ref()
                                        .map(|d| format!(" · {d}"))
                                        .unwrap_or_default()
                                ))),
                                None,
                            )],
                        },
                    )
                })
                .collect::<Vec<_>>(),
        ));
    }
    if snap.entries_truncated {
        children.push(UiNode::text(Text::from(
            "More files on server; status list limited to 5000.",
        )));
    }
    if !snap.log.is_empty() {
        children.push(UiNode::list(
            snap.log
                .iter()
                .map(|row| {
                    UiNode::list_item(
                        Text::from(row.doc_id.clone()),
                        Some(Text::from(format!("{} · {}", row.kind, row.ts_ms))),
                        None,
                    )
                })
                .collect::<Vec<_>>(),
        ));
    }

    if snap.conflicts.is_empty() {
        children.push(UiNode::text(Text::from("No conflicts.")));
    } else {
        children.push(UiNode::list(
            snap.conflicts.iter().map(conflict_row).collect::<Vec<_>>(),
        ));
    }
    UiNode::column(1, children)
}

fn versions_tree(snap: &SyncSnapshot) -> UiNode {
    if snap.versions.is_empty() {
        return UiNode::column(
            1,
            vec![UiNode::empty_state(Text::from("No synced versions yet."))],
        );
    }
    UiNode::column(
        1,
        vec![UiNode::list(
            snap.versions.iter().map(version_row).collect::<Vec<_>>(),
        )],
    )
}

fn conflicts_tree(snap: &SyncSnapshot) -> UiNode {
    if snap.conflicts.is_empty() {
        return UiNode::column(1, vec![UiNode::empty_state(Text::from("No conflicts."))]);
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
                        Text::from("Retry"),
                        Intent::Primary,
                        ActionRef::with(ACTION_RETRY, serde_json::json!({ "doc_id": c.doc_id })),
                    )],
                ),
            ],
        },
    )
}

fn version_row(v: &SnapshotVersion) -> UiNode {
    UiNode::keyed(
        format!("version:{}:{}", v.doc_id, v.version),
        fub_abi::ui::UiKind::Stack {
            dir: fub_abi::ui::Axis::Column,
            gap: 0,
            children: vec![
                UiNode::list_item(
                    Text::from(format!("{} v{}", v.doc_id, v.version)),
                    Some(Text::from(format!("{} · {}", v.hash, v.vv_text))),
                    None,
                ),
                UiNode::button(
                    Text::from("Restore"),
                    Intent::Neutral,
                    ActionRef::with(
                        ACTION_RESTORE,
                        serde_json::json!({ "doc_id": v.doc_id, "version": v.version.to_string() }),
                    ),
                ),
            ],
        },
    )
}

fn short(id: &str) -> String {
    id.chars().take(8).collect()
}
