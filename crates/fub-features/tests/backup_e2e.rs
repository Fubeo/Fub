#![cfg(feature = "backup")]
//! Backup locale end-to-end: snapshot nello spazio plugin, ripristino note mancanti.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{UiKind, UiNode};
use fub_features::{
    BackupCommands, BackupView, BACKUP_ID, BACKUP_KEEP_KEY, BACKUP_VIEW, VAULT_BACKUP,
    VAULT_BACKUP_RESTORE,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn put(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn open(&self) -> Workspace {
        self.open_at(Arc::new(fub_kernel::time::SystemClock))
    }

    /// Il vault con un orologio scelto: i backup prendono il nome dal giorno.
    fn open_at(&self, clock: Arc<dyn fub_kernel::time::Clock>) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry)
            .expect("l'apertura del vault riesce")
            .with_clock(clock);
        ws.register_plugin(
            PluginManifest::core(BACKUP_ID, BACKUP_ID)
                .speaking("it", fub_features::backup::catalog())
                .configuring(fub_features::backup::settings()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(BACKUP_ID, Box::new(BackupView))
            .expect("view");
        ws.register_command_provider(BACKUP_ID, Box::new(BackupCommands))
            .expect("comandi");
        ws.reindex().expect("reindex");
        ws
    }
}

fn titles(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::ListItem { title, .. } => out.push(format!("{title}")),
            UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

#[test]
fn backup_and_restore_deleted_notes() {
    let vault = Vault::new();
    vault.put("Inbox/a.md", "# A\n");
    vault.put("b.md", "# B\n");
    let mut ws = vault.open();

    ws.invoke_command(
        VAULT_BACKUP,
        serde_json::json!({}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("backup");

    let tree = ws.render_view(&ViewInstance::only(BACKUP_VIEW)).unwrap();
    let titles = titles(&tree);
    assert!(titles.iter().any(|t| t.contains("2 note")), "{titles:?}");

    ws.delete_document(&DocId::new("Inbox/a.md"))
        .expect("cestina");
    assert!(
        ws.read_source(&DocId::new("Inbox/a.md")).is_err(),
        "cestinata"
    );

    let id = titles
        .iter()
        .find_map(|t| t.split_whitespace().next().map(str::to_string))
        .expect("id snapshot");
    ws.invoke_command(
        VAULT_BACKUP_RESTORE,
        serde_json::json!({ "id": id }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("restore");

    let src = ws
        .read_source(&DocId::new("Inbox/a.md"))
        .expect("ripristinata");
    assert!(src.contains("# A"), "{src}");
}

#[test]
fn dry_run_not_writes() {
    let vault = Vault::new();
    vault.put("a.md", "# A\n");
    let mut ws = vault.open();
    ws.invoke_command(
        VAULT_BACKUP,
        serde_json::json!({}),
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("dry_run");
    let tree = ws.render_view(&ViewInstance::only(BACKUP_VIEW)).unwrap();
    let titles = titles(&tree);
    assert!(
        titles.is_empty(),
        "dry-run non deve lasciare snapshot: {titles:?}"
    );
}

#[test]
fn the_commands_are_in_the_record() {
    let vault = Vault::new();
    let ws = vault.open();
    let ids: Vec<String> = ws.commands().into_iter().map(|c| c.id).collect();
    assert!(ids.contains(&VAULT_BACKUP.to_string()), "{ids:?}");
    assert!(ids.contains(&VAULT_BACKUP_RESTORE.to_string()), "{ids:?}");
}

/// Un orologio che avanza a mano, un giorno alla volta.
struct Days(AtomicU64);

impl fub_kernel::time::Clock for Days {
    fn now_unix_millis(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

const DAY_MS: u64 = 86_400_000;

/// Gli snapshot che hanno ancora file sul disco, per nome di cartella.
fn snapshot_dirs(vault: &Vault) -> Vec<String> {
    let dir = vault.root.join(".fub/plugins").join(BACKUP_ID);
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().is_dir() && std::fs::read_dir(entry.path()).unwrap().next().is_some()
        })
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// Gli snapshot ruotano: dopo un backup restano i più recenti che
/// l'impostazione dice, e i file degli altri se ne vanno dal vault.
#[test]
fn old_snapshots_rotate_out_of_the_vault() {
    let vault = Vault::new();
    vault.put("a.md", "# A\n");
    // 2026-09-20 a mezzogiorno UTC.
    let clock = Arc::new(Days(AtomicU64::new(1_789_905_600_000)));
    let mut ws = vault.open_at(clock.clone());
    ws.set_setting(BACKUP_KEEP_KEY, SettingValue::Number(2.0))
        .expect("the setting is declared");
    for _ in 0..3 {
        ws.invoke_command(
            VAULT_BACKUP,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("backup");
        clock.0.fetch_add(DAY_MS, Ordering::SeqCst);
    }
    assert_eq!(snapshot_dirs(&vault), ["2026-09-21", "2026-09-22"]);
    let tree = ws.render_view(&ViewInstance::only(BACKUP_VIEW)).unwrap();
    let titles = titles(&tree);
    assert_eq!(titles.len(), 2, "{titles:?}");
    assert!(
        titles.iter().all(|t| !t.contains("2026-09-20")),
        "{titles:?}"
    );

    // Zero li tiene tutti.
    ws.set_setting(BACKUP_KEEP_KEY, SettingValue::Number(0.0))
        .unwrap();
    for _ in 0..2 {
        ws.invoke_command(
            VAULT_BACKUP,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("backup");
        clock.0.fetch_add(DAY_MS, Ordering::SeqCst);
    }
    assert_eq!(snapshot_dirs(&vault).len(), 4);
}

/// Rifare il backup nello stesso giorno sostituisce lo snapshot di oggi, e
/// ciò che non c'è più nel vault non ci resta.
#[test]
fn a_second_backup_on_the_same_day_replaces_todays_snapshot() {
    let vault = Vault::new();
    vault.put("a.md", "# A\n");
    vault.put("b.md", "# B\n");
    let clock = Arc::new(Days(AtomicU64::new(1_789_905_600_000)));
    let mut ws = vault.open_at(clock);
    let backup = |ws: &mut Workspace| {
        ws.invoke_command(
            VAULT_BACKUP,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("backup")
    };
    backup(&mut ws);
    ws.delete_document(&DocId::new("b.md")).expect("cestina");
    backup(&mut ws);
    let today = vault
        .root
        .join(".fub/plugins")
        .join(BACKUP_ID)
        .join("2026-09-20");
    assert!(today.join("a.md").exists());
    assert!(
        !today.join("b.md").exists(),
        "the snapshot follows the vault"
    );
}
