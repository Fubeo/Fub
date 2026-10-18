//! I link verso una nota portati su un'altra che esiste già, dall'host dei job:
//! il piano si fotografa sotto la lettura del workspace, il provider di formato
//! scrive gli edit fuori, e applicarli è una scrittura con la sua revisione.

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::traits::{VaultRead, VaultWrite};
use fub_abi::PluginError;
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, JobHost};
use fub_kernel::{FormatRegistry, Workspace};

const OWNER: &str = "fub.retarget-probe";

fn host(files: &[(&str, &str)]) -> (tempfile::TempDir, JobHost) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    for (rel, body) in files {
        std::fs::write(root.join(rel), body).unwrap();
    }
    let mut formats = FormatRegistry::new();
    formats.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&root, formats).unwrap();
    ws.reindex().unwrap();
    let workspace = Custody::new("retarget test", ws);
    workspace
        .write()
        .unwrap()
        .register_core_feature(OWNER, "Retarget probe")
        .unwrap();
    (dir, JobHost::new(workspace, OWNER))
}

#[test]
fn the_plan_moves_every_reference_and_keeps_alias_and_heading() {
    let (_dir, mut host) = host(&[
        ("Vecchia.md", "# Parte\nTesto"),
        ("Nuova.md", "Altro"),
        ("Lettore.md", "[[Vecchia]] e [[Vecchia#Parte|la parte]]"),
    ]);
    let from = DocId::new("Vecchia.md");
    let to = DocId::new("Nuova.md");
    let edits = host.link_retarget_edits(&from, &to).unwrap();
    let docs: Vec<&str> = edits.iter().map(|edit| edit.doc.as_str()).collect();
    assert_eq!(docs, ["Lettore.md"]);
    // Il piano non scrive: il lettore è com'era.
    assert_eq!(
        host.read_document(&DocId::new("Lettore.md")).unwrap(),
        "[[Vecchia]] e [[Vecchia#Parte|la parte]]"
    );
    for edit in edits {
        host.apply_edit(&edit.doc, edit.edit).unwrap();
    }
    assert_eq!(
        host.read_document(&DocId::new("Lettore.md")).unwrap(),
        "[[Nuova]] e [[Nuova#Parte|la parte]]"
    );
}

#[test]
fn a_plan_on_a_changed_document_is_a_conflict_not_a_wrong_write() {
    let (_dir, mut host) = host(&[
        ("Vecchia.md", "Testo"),
        ("Nuova.md", "Altro"),
        ("Lettore.md", "[[Vecchia]]"),
    ]);
    let edits = host
        .link_retarget_edits(&DocId::new("Vecchia.md"), &DocId::new("Nuova.md"))
        .unwrap();
    let reader = DocId::new("Lettore.md");
    host.write_document(&reader, "Riscritto: [[Vecchia]]", WriteBase::Dictated)
        .unwrap();
    for edit in edits {
        let refused = host.apply_edit(&edit.doc, edit.edit);
        assert!(
            matches!(refused, Err(PluginError::Conflict(_))),
            "{refused:?}"
        );
    }
    assert_eq!(
        host.read_document(&reader).unwrap(),
        "Riscritto: [[Vecchia]]"
    );
}

#[test]
fn a_missing_note_is_named() {
    let (_dir, host) = host(&[("Nuova.md", "Altro")]);
    let missing = host.link_retarget_edits(&DocId::new("Assente.md"), &DocId::new("Nuova.md"));
    assert!(
        matches!(missing, Err(PluginError::NotFound(_))),
        "{missing:?}"
    );
}
