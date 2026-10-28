use camino::Utf8PathBuf;
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::format::FormatDescriptor;
use fub_abi::model::DocId;
use fub_abi::traits::{EntryKind, IndexQuery, IndexResult};
use fub_kernel::{FormatRegistry, KernelError, Workspace};

struct TempDir(Utf8PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let path = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("temp dir UTF-8")
            .join(format!("fub-source-only-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create temp vault");
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn sheets() -> FormatRegistry {
    let mut registry = FormatRegistry::new();
    registry
        .register_source(FormatDescriptor::text(
            "fubsheet",
            "Fub Sheet",
            &["fubsheet"],
        ))
        .expect("register source-only format");
    registry
}

fn entries(workspace: &Workspace) -> Vec<DocId> {
    let IndexResult::Entries(entries) = workspace
        .query_index(IndexQuery::Entries {
            of_kind: Some(EntryKind::Document),
            within: None,
            page: None,
        })
        .expect("source-only entry listing")
    else {
        panic!("expected vault entries");
    };
    entries.items.into_iter().map(|entry| entry.id).collect()
}

#[test]
fn source_only_files_are_discovered_and_synced_without_parsing_document_models() {
    let vault = TempDir::new("discovered");
    let path = vault.0.join("budget.fubsheet");
    std::fs::write(&path, "first").expect("write source-only document");

    let mut workspace = Workspace::new(&vault.0, sheets()).expect("open vault");
    workspace.reindex().expect("initial source-only stat");

    let id = DocId::new("budget.fubsheet");
    let IndexResult::Entries(entries) = workspace
        .query_index(IndexQuery::Entries {
            of_kind: Some(EntryKind::Document),
            within: None,
            page: None,
        })
        .expect("source-only entry listing")
    else {
        panic!("expected vault entries");
    };
    assert_eq!(entries.items.len(), 1);
    assert_eq!(entries.items[0].id, id);
    assert_eq!(workspace.read_source(&id).unwrap(), "first");

    std::fs::write(path, "second").expect("replace source-only document");
    workspace.reindex().expect("source-only stat after change");

    let IndexResult::Entries(entries) = workspace
        .query_index(IndexQuery::Entries {
            of_kind: Some(EntryKind::Document),
            within: None,
            page: None,
        })
        .expect("source-only entry listing after change")
    else {
        panic!("expected vault entries");
    };
    assert_eq!(entries.items.len(), 1);
    assert_eq!(entries.items[0].id, id);
    assert_eq!(workspace.read_source(&id).unwrap(), "second");
}

/// Il modello di un formato di sola sorgente è del suo editor: salvarlo non
/// chiede un parser al registro, e la guardia sulla base resta quella di ogni
/// testo.
#[test]
fn source_only_files_are_saved_without_a_parser_and_keep_the_base_guard() {
    let vault = TempDir::new("saved");
    let path = vault.0.join("budget.fubsheet");
    std::fs::write(&path, "first").expect("write source-only document");
    let mut workspace = Workspace::new(&vault.0, sheets()).expect("open vault");
    workspace.reindex().expect("initial source-only stat");
    let id = DocId::new("budget.fubsheet");

    let saved = workspace
        .write_document(
            &id,
            "second",
            WriteBase::DescendsFrom(Revision::of("first")),
        )
        .expect("save a source-only document");
    assert_eq!(saved, Revision::of("second"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");
    assert_eq!(workspace.document_revision(&id).unwrap(), saved);

    let stale =
        workspace.write_document(&id, "third", WriteBase::DescendsFrom(Revision::of("first")));
    assert!(matches!(stale, Err(KernelError::Stale(_))), "{stale:?}");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");

    let created = DocId::new("nuovo.fubsheet");
    workspace
        .write_document(&created, "new", WriteBase::Dictated)
        .expect("create a source-only document");
    assert_eq!(
        std::fs::read_to_string(vault.0.join("nuovo.fubsheet")).unwrap(),
        "new"
    );
    assert_eq!(entries(&workspace), vec![id, created]);
}

/// Un'estensione che nessuno ha dichiarato non diventa scrivibile come testo.
#[test]
fn an_undeclared_extension_still_has_no_provider() {
    let vault = TempDir::new("undeclared");
    let mut workspace = Workspace::new(&vault.0, sheets()).expect("open vault");
    let written = workspace.write_document(&DocId::new("dati.xyz"), "x", WriteBase::Dictated);
    assert!(
        matches!(written, Err(KernelError::NoProvider(_))),
        "{written:?}"
    );
    assert!(!vault.0.join("dati.xyz").exists());
}
