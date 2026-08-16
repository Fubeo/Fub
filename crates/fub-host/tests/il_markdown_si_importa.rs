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

fn monta(root: &Utf8PathBuf) -> fub_host::Mounted {
    fub_host::mount::mount(
        root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("il montaggio riesce")
}

#[test]
fn dopo_il_montaggio_un_markdown_entra_nel_vault() {
    let (_dir, root) = vault();
    let mut montato = monta(&root);
    let source = ImportSource::text_source("Nuova.md", "# Nuova\n\nciao\n");
    let report = montato
        .workspace
        .import(&source, &ImportRequest::apply())
        .expect("il provider markdown è montato");
    assert_eq!(report.mode, ImportMode::Apply);
    assert_eq!(report.documents.len(), 1);
    assert_eq!(report.documents[0].doc, DocId::new("Nuova.md"));
    assert!(
        montato.workspace.documents().contains(&DocId::new("Nuova.md")),
        "la nota è nel vault"
    );
    let testo = montato
        .workspace
        .read_source(&DocId::new("Nuova.md"))
        .expect("la nota c'è");
    assert!(testo.contains("# Nuova"), "{testo}");
}

#[test]
fn dopo_il_montaggio_le_destinazioni_markdown_ci_sono() {
    let (_dir, root) = vault();
    let montato = monta(&root);
    let ids: Vec<String> = montato
        .workspace
        .export_targets()
        .into_iter()
        .map(|t| t.id)
        .collect();
    assert!(ids.contains(&TARGET_FILES.to_string()), "{ids:?}");
    assert!(ids.contains(&TARGET_SINGLE.to_string()), "{ids:?}");
}
