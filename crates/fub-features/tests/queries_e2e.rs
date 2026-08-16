#![cfg(feature = "queries")]
//! Query salvate end-to-end attraverso il kernel vero: persistenza, elenco,
//! esecuzione su una cartella.

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::query::{QueryExpr, QueryPredicate};
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{FieldValue, UiAction, UiKind, UiNode, UiValue, ViewUpdate};
use fub_features::{
    QueriesCommands, QueriesView, COLLECTIONS_VIEW, QUERIES_DELETE, QUERIES_ID, QUERIES_RUN,
    QUERIES_SAVE, QUERIES_VIEW,
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
            PluginManifest::core(QUERIES_ID, QUERIES_ID)
                .speaking("it", fub_features::queries::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(QUERIES_ID, Box::new(QueriesView))
            .expect("view");
        ws.register_command_provider(QUERIES_ID, Box::new(QueriesCommands))
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
            UiKind::Form { children, .. } => children.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

fn cartella_inbox() -> QueryExpr {
    QueryExpr::of(QueryPredicate::Folder {
        path: "Inbox".into(),
        descendants: true,
    })
}

/// `queries.save` dichiara `expr: ParamKind::Text`: l'host rifiuta un oggetto
/// prima di `invoke`. Il comando sa comunque leggere JSON da stringa.
fn expr_come_testo(expr: &QueryExpr) -> String {
    serde_json::to_string(expr).expect("QueryExpr è serializzabile")
}

#[test]
fn save_run_delete_su_una_cartella() {
    let vault = Vault::new();
    vault.put("Inbox/a.md", "# A\n");
    vault.put("fuori.md", "# no\n");
    let mut ws = vault.open();

    ws.invoke_command(
        QUERIES_SAVE,
        serde_json::json!({
            "id": "inbox",
            "name": "Inbox",
            "expr": expr_come_testo(&cartella_inbox()),
        }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("save");

    let esito = ws
        .invoke_command(
            QUERIES_RUN,
            serde_json::json!({ "id": "inbox" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("run");
    match esito.effect {
        fub_abi::command::CommandEffect::Navigate { doc } => {
            assert_eq!(doc, DocId::new("Inbox/a.md"));
        }
        other => panic!("atteso Navigate sulla sola nota in Inbox, {other:?}"),
    }

    ws.invoke_command(
        QUERIES_DELETE,
        serde_json::json!({ "id": "inbox" }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("delete");
    let err = ws
        .invoke_command(
            QUERIES_RUN,
            serde_json::json!({ "id": "inbox" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect_err("cancellata");
    let _ = err;
}

#[test]
fn la_view_elenca_e_lancia() {
    let vault = Vault::new();
    vault.put("Inbox/a.md", "# A\n");
    vault.put("Inbox/b.md", "# B\n");
    let mut ws = vault.open();
    ws.invoke_command(
        QUERIES_SAVE,
        serde_json::json!({
            "id": "inbox",
            "name": "Inbox",
            "expr": expr_come_testo(&cartella_inbox()),
        }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("save");

    let tree = ws
        .render_view(&ViewInstance::only(QUERIES_VIEW))
        .unwrap();
    let elenco = titoli(&tree);
    assert!(
        elenco.iter().any(|t| t.contains("Inbox")),
        "{elenco:?}"
    );

    ws.view_action(
        &ViewInstance::only(QUERIES_VIEW),
        UiAction::new("run").with_payload(serde_json::json!({ "id": "inbox" })),
    )
    .expect("run");
    let dopo = ws
        .render_view(&ViewInstance::only(QUERIES_VIEW))
        .unwrap();
    let elenco = titoli(&dopo);
    assert!(
        elenco.iter().any(|t| t.contains("Inbox/a.md")),
        "{elenco:?}"
    );
    assert!(
        elenco.iter().any(|t| t.contains("Inbox/b.md")),
        "{elenco:?}"
    );
}

#[test]
fn form_salva_da_testo() {
    let vault = Vault::new();
    vault.put("a.md", "ciao rust\n");
    let mut ws = vault.open();
    let update = ws
        .view_action(
            &ViewInstance::only(QUERIES_VIEW),
            UiAction::new("save").with_fields(vec![
                FieldValue {
                    field: "new_name".into(),
                    value: UiValue::Text("Rust".into()),
                },
                FieldValue {
                    field: "new_text".into(),
                    value: UiValue::Text("rust".into()),
                },
            ]),
        )
        .expect("save");
    assert!(matches!(update, ViewUpdate::Replace { .. }));
    let tree = ws
        .render_view(&ViewInstance::only(QUERIES_VIEW))
        .unwrap();
    let titoli = titoli(&tree);
    assert!(titoli.iter().any(|t| t.contains("Rust")), "{titoli:?}");
}

#[test]
fn i_comandi_sono_nel_registro() {
    let vault = Vault::new();
    let ws = vault.open();
    let ids: Vec<String> = ws.commands().into_iter().map(|c| c.id).collect();
    assert!(ids.contains(&QUERIES_SAVE.to_string()), "{ids:?}");
    assert!(ids.contains(&QUERIES_RUN.to_string()), "{ids:?}");
    assert!(ids.contains(&QUERIES_DELETE.to_string()), "{ids:?}");
}

#[test]
fn dry_run_non_scrive() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.invoke_command(
        QUERIES_SAVE,
        serde_json::json!({
            "id": "x",
            "name": "X",
            "expr": expr_come_testo(&QueryExpr::all()),
        }),
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("dry_run");
    let err = ws
        .invoke_command(
            QUERIES_RUN,
            serde_json::json!({ "id": "x" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect_err("non salvata");
    let _ = err;
}

#[test]
fn le_collezioni_elencano_le_query_salvate() {
    let vault = Vault::new();
    vault.put("Inbox/a.md", "# A\n");
    let mut ws = vault.open();
    ws.invoke_command(
        QUERIES_SAVE,
        serde_json::json!({
            "id": "inbox",
            "name": "Inbox",
            "expr": expr_come_testo(&cartella_inbox()),
        }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("save");

    let tree = ws
        .render_view(&ViewInstance::only(COLLECTIONS_VIEW))
        .unwrap();
    let elenco = titoli(&tree);
    assert!(
        elenco.iter().any(|t| t.contains("Inbox")),
        "{elenco:?}"
    );
}
