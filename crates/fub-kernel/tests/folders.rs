//! Le **cartelle** nel kernel (§14.3) e la lista **per cartella** (§14.4).
//!
//! Le proprietà sotto esame sono tre, e nessuna delle tre si può nemmeno
//! esprimere finché le cartelle nascono dai path dei file:
//!
//! 1. **Una cartella esiste perché il disco ce l'ha.** Una cartella vuota non
//!    compare in nessun path, e c'è; una che resta vuota perché la sua ultima
//!    nota è finita nel cestino resta lì, perché sul disco c'è ancora.
//! 2. **Si chiede un livello per volta**, con i conti che dicono se ha senso
//!    aprirla — senza che chi disegna debba interrogarla per saperlo.
//! 3. **La lista si chiede per cartella**, e il filtro sta *prima* della
//!    finestra: una pagina di una cartella è una pagina di quella cartella.

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EntryKind, FolderScope, IndexQuery, IndexResult, Page, VaultEntry, VaultFolder,
};
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Workspace};

/// Il minimo per avere dei documenti: qui non si prova il parsing.
struct Note;

impl FormatProvider for Note {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("note", "Note (test)", &["md"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::of(&[])
    }

    fn parse(
        &self,
        _source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        Ok(DocumentModel::empty(DocId::new(ctx.doc_id.clone())))
    }

    fn render_html(
        &self,
        _model: &DocumentModel,
        _options: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(String::new())
    }

    fn serialize(&self, _model: &DocumentModel) -> Result<String, FormatError> {
        Ok(String::new())
    }
}

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

    fn write(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        std::fs::create_dir_all(path.parent().expect("has a parent")).expect("directories");
        std::fs::write(path, body).expect("write");
    }

    fn mkdir(&self, rel: &str) {
        std::fs::create_dir_all(self.root.join(rel)).expect("directory");
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry.register(Box::new(Note)).expect("no conflict");
        let mut ws = Workspace::new(&self.root, registry).expect("vault opens successfully");
        ws.reindex().expect("reindex");
        ws
    }
}

fn folders(ws: &Workspace, under: Option<FolderScope>) -> Vec<VaultFolder> {
    let IndexResult::Folders(page) = ws
        .query_index(IndexQuery::Folders { under, page: None })
        .expect("the kernel serves folders")
    else {
        panic!("expected folders");
    };
    page.items
}

fn entries(
    ws: &Workspace,
    of_kind: Option<EntryKind>,
    within: Option<FolderScope>,
    page: Option<Page>,
) -> (Vec<VaultEntry>, u32) {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind,
            within,
            page,
        })
        .expect("the kernel serves the entry store")
    else {
        panic!("expected entry store");
    };
    (page.items, page.total)
}

fn paths(folders: &[VaultFolder]) -> Vec<&str> {
    folders.iter().map(|f| f.path.as_str()).collect()
}

// --- la cartella come cittadino ---------------------------------------------

#[test]
fn an_empty_folder_exists_and_says_it_is_empty() {
    let v = Vault::new();
    v.write("Progetti/Alpha.md", "a");
    // Nessun path la nomina: prima di questa voce non c'era modo di sapere che
    // esistesse — l'albero nasceva dai path delle note.
    v.mkdir("Archivio");

    let ws = v.open();
    let all = folders(&ws, None);
    assert_eq!(
        paths(&all),
        vec!["Archivio", "Progetti"],
        "an empty folder is a folder"
    );

    let archive = &all[0];
    assert_eq!((archive.folders, archive.entries), (0, 0));
    let projects = &all[1];
    assert_eq!(
        (projects.folders, projects.entries),
        (0, 1),
        "the counts tell whether it makes sense to open it, without opening it"
    );
}

#[test]
fn the_folder_survives_when_its_last_notes_goes_to_trash() {
    let v = Vault::new();
    v.write("Bozze/unica.md", "a");
    let mut ws = v.open();
    assert_eq!(paths(&folders(&ws, None)), vec!["Bozze"]);

    ws.delete_document(&DocId::new("Bozze/unica.md"))
        .expect("trashed");

    // Il file se n'è andato, la directory no: dire che la cartella è sparita
    // sarebbe raccontare qualcosa che sul disco non è successo.
    let after = folders(&ws, None);
    assert_eq!(paths(&after), vec!["Bozze"]);
    assert_eq!((after[0].folders, after[0].entries), (0, 0));
    assert!(
        v.root.join("Bozze").is_dir(),
        "and it is true on disk too, which is the point"
    );
}

#[test]
fn a_created_notes_brings_along_the_folders_it_traverses() {
    let v = Vault::new();
    v.write("radice.md", "a");
    let mut ws = v.open();
    assert!(folders(&ws, None).is_empty());

    ws.write_document(&DocId::new("a/b/nuova.md"), "x", WriteBase::Dictated)
        .expect("written");

    assert_eq!(
        paths(&folders(&ws, None)),
        vec!["a", "a/b"],
        "without waiting for the vault to reopen"
    );
}

#[test]
fn folders_are_queried_one_level_at_a_time() {
    let v = Vault::new();
    v.write("a/b/c/nota.md", "x");
    v.write("a/sorella.md", "x");
    v.write("altra/nota.md", "x");
    let ws = v.open();

    assert_eq!(
        paths(&folders(&ws, Some(FolderScope::direct("")))),
        vec!["a", "altra"],
        "the root children are one level, not the vault"
    );
    assert_eq!(
        paths(&folders(&ws, Some(FolderScope::direct("a")))),
        vec!["a/b"]
    );
    assert_eq!(
        paths(&folders(
            &ws,
            Some(FolderScope {
                path: "a".into(),
                descendants: true,
            })
        )),
        vec!["a/b", "a/b/c"],
        "with descendants, the subtree — and never itself"
    );
}

// --- la lista per cartella ---------------------------------------------------

#[test]
fn the_list_is_for_folder_and_the_page_is_of_that_folder() {
    let v = Vault::new();
    for the in 0..6 {
        v.write(&format!("dentro/nota{the}.md"), "x");
    }
    for the in 0..20 {
        v.write(&format!("fuori/nota{the}.md"), "x");
    }
    v.write("dentro/foto.png", "\u{89}PNG");
    v.write("dentro/sotto/nascosta.md", "x");
    let ws = v.open();

    let (items, total) = entries(&ws, None, Some(FolderScope::direct("dentro")), None);
    assert_eq!(
        total, 7,
        "six notes and one attachment: direct children, not the tree"
    );
    assert!(
        items
            .iter()
            .all(|and| and.id.as_str().starts_with("dentro/")),
        "and nothing from the neighboring folder"
    );

    // Il filtro sta **prima** della finestra: una pagina da tre presa dopo aver
    // filtrato è tre righe di questa cartella, non tre righe del vault fra cui
    // cercarle.
    let (page, total) = entries(
        &ws,
        Some(EntryKind::Document),
        Some(FolderScope::direct("dentro")),
        Some(Page::new(2, 3)),
    );
    assert_eq!(total, 6, "the count is that of the folder's documents");
    assert_eq!(
        page.iter().map(|and| and.id.as_str()).collect::<Vec<_>>(),
        vec!["dentro/nota2.md", "dentro/nota3.md", "dentro/nota4.md"]
    );

    // Senza cartella la domanda è quella di prima: tutto il vault.
    let (_, all) = entries(&ws, Some(EntryKind::Document), None, None);
    assert_eq!(all, 27);
}
