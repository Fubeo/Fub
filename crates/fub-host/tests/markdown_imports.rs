//! Dopo il montaggio, import/export markdown sono **registrati**: una sorgente
//! `.md` entra nel vault, le destinazioni di export ci sono. È il buco che la
//! roadmap marcava aperto — i provider esistevano, `fub_host::mount` non li
//! montava.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::transfer::{ImportMode, ImportRequest, ImportSource};
use fub_format_markdown::{TARGET_FILES, TARGET_SINGLE};
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, root)
}

fn mount(root: &Utf8PathBuf) -> fub_host::Mounted {
    fub_host::mount::mount(
        root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("mount succeeds")
}

#[test]
fn after_mount_a_markdown_enters_the_vault() {
    let (_dir, root) = vault();
    let mut mounted = mount(&root);
    let source = ImportSource::text_source("Nuova.md", "# Nuova\n\nciao\n");
    let report = mounted
        .workspace
        .import(&source, &ImportRequest::apply())
        .expect("markdown provider is mounted");
    assert_eq!(report.mode, ImportMode::Apply);
    assert_eq!(report.documents.len(), 1);
    assert_eq!(report.documents[0].doc, DocId::new("Nuova.md"));
    assert!(
        mounted
            .workspace
            .documents()
            .contains(&DocId::new("Nuova.md")),
        "note is in the vault"
    );
    let content = mounted
        .workspace
        .read_source(&DocId::new("Nuova.md"))
        .expect("note exists");
    assert!(content.contains("# Nuova"), "{content}");
}

#[test]
fn after_mount_markdown_export_targets_exist() {
    let (_dir, root) = vault();
    let mounted = mount(&root);
    let ids: Vec<String> = mounted
        .workspace
        .export_targets()
        .into_iter()
        .map(|t| t.id)
        .collect();
    assert!(ids.contains(&TARGET_FILES.to_string()), "{ids:?}");
    assert!(ids.contains(&TARGET_SINGLE.to_string()), "{ids:?}");
}
