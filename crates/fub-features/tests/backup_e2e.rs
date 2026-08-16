#![cfg(feature = "backup")]
//! Backup locale end-to-end: snapshot nello spazio plugin, ripristino note mancanti.

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{UiKind, UiNode};
use fub_features::{
    BackupCommands, BackupView, BACKUP_ID, BACKUP_VIEW, VAULT_BACKUP, VAULT_BACKUP_RESTORE,
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
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            PluginManifest::core(BACKUP_ID, BACKUP_ID)
                .speaking("it", fub_features::backup::catalog()),
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

fn titoli(tree: &UiNode) -> Vec<String> {
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
fn backup_e_restore_di_una_nota_cancellata() {
    let vault = Vault::new();
    vault.put("Inbox/a.md", "# A\n");
    vault.put("b.md", "# B\n");
    let mut ws = vault.open();

    ws.invoke_command(VAULT_BACKUP, serde_json::json!({}), InvokeMode::Apply, Actor::User)
        .expect("backup");

    let tree = ws
        .render_view(&ViewInstance::only(BACKUP_VIEW))
        .unwrap();
    let titoli = titoli(&tree);
    assert!(
        titoli.iter().any(|t| t.contains("2 note")),
        "{titoli:?}"
    );

    ws.delete_document(&DocId::new("Inbox/a.md"))
        .expect("cestina");
    assert!(
        ws.read_source(&DocId::new("Inbox/a.md")).is_err(),
        "cestinata"
    );

    let id = titoli
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
fn dry_run_non_scrive() {
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
    let tree = ws
        .render_view(&ViewInstance::only(BACKUP_VIEW))
        .unwrap();
    let titoli = titoli(&tree);
    assert!(
        titoli.is_empty(),
        "dry-run non deve lasciare snapshot: {titoli:?}"
    );
}

#[test]
fn i_comandi_sono_nel_registro() {
    let vault = Vault::new();
    let ws = vault.open();
    let ids: Vec<String> = ws.commands().into_iter().map(|c| c.id).collect();
    assert!(ids.contains(&VAULT_BACKUP.to_string()), "{ids:?}");
    assert!(ids.contains(&VAULT_BACKUP_RESTORE.to_string()), "{ids:?}");
}
