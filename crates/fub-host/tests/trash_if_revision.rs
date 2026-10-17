//! Il cestinamento condizionato alla revisione: confronto e cestino sotto lo
//! stesso turno di scrittura, così un salvataggio non si inserisce fra i due.

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::traits::{VaultRead, VaultStructure, VaultWrite};
use fub_abi::PluginError;
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, JobHost};
use fub_kernel::{FormatRegistry, Workspace};

const OWNER: &str = "fub.trash-if-probe";

#[test]
fn a_newer_revision_is_never_trashed_by_a_decision_taken_on_an_older_one() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    std::fs::write(root.join("Nota.md"), "# Prima\n").unwrap();
    let mut formats = FormatRegistry::new();
    formats.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&root, formats).unwrap();
    ws.reindex().unwrap();
    let workspace = Custody::new("trash-if test", ws);
    workspace
        .write()
        .unwrap()
        .register_core_feature(OWNER, "Trash probe")
        .unwrap();
    let mut host = JobHost::new(workspace, OWNER);
    let id = DocId::new("Nota.md");

    let seen = host.document_revision(&id).unwrap();
    // Un salvataggio locale supera la revisione su cui si era deciso.
    host.write_document(&id, "# Dopo\n", WriteBase::Dictated)
        .unwrap();

    let refused = host.trash_document_if(&id, &seen);
    assert!(
        matches!(refused, Err(PluginError::Conflict(_))),
        "la revisione è cambiata: {refused:?}"
    );
    assert_eq!(host.read_document(&id).unwrap(), "# Dopo\n");

    let current = host.document_revision(&id).unwrap();
    host.trash_document_if(&id, &current).unwrap();
    assert!(matches!(
        host.read_document(&id),
        Err(PluginError::NotFound(_))
    ));
}
