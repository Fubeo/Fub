use camino::Utf8PathBuf;
use fub_abi::format::FormatDescriptor;
use fub_abi::model::DocId;
use fub_abi::traits::{EntryKind, IndexQuery, IndexResult};
use fub_kernel::{FormatRegistry, Workspace};

struct TempDir(Utf8PathBuf);

impl TempDir {
    fn new() -> Self {
        let path = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("temp dir UTF-8")
            .join(format!("fub-source-only-{}", std::process::id()));
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

#[test]
fn source_only_files_are_discovered_and_synced_without_parsing_document_models() {
    let vault = TempDir::new();
    let path = vault.0.join("budget.fubsheet");
    std::fs::write(&path, "first").expect("write source-only document");

    let mut registry = FormatRegistry::new();
    registry
        .register_source(FormatDescriptor::text(
            "fubsheet",
            "Fub Sheet",
            &["fubsheet"],
        ))
        .expect("register source-only format");
    let mut workspace = Workspace::new(&vault.0, registry).expect("open vault");
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
