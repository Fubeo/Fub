//! Una rinomina che trova occupato lo spazio per-documento della destinazione
//! non deve consegnare alla raccolta i dati della nota rinominata.
//!
//! La destinazione è libera come documento (il kernel rifiuta un rename verso
//! una nota che esiste), quindi una cartella dati già lì è il residuo di una
//! nota che non c'è più. I dati della nota rinominata la seguono; il residuo
//! si sposta di lato, sotto un nome che la raccolta non tocca.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_kernel::storage::{DirEntry, FsStorage, Merge, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Workspace};
use fub_testkit::{doc, Bench, Mounted, SampleText};

const SPACE: &str = ".fub/plugins/prova.plugin/doc";

/// Il residuo si posa dopo l'apertura: la raccolta dell'apertura l'avrebbe
/// già tolto, ed è il caso di una nota cancellata in questa sessione.
fn vault() -> Mounted {
    let ws = Bench::new()
        .with_plugin("prova.plugin")
        .with_file("Vecchia.md", "# Vecchia\n")
        .with_file(
            &format!("{SPACE}/Vecchia.md/annotazione"),
            "dati di Vecchia",
        )
        .mounts();
    ws.write(
        &format!("{SPACE}/Nuova.md/annotazione"),
        "residuo di una nota cancellata",
    );
    ws
}

fn displaced(ws: &Mounted) -> Vec<String> {
    std::fs::read_dir(ws.root().join(SPACE))
        .expect("doc space")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .into_string()
                .expect("utf-8")
        })
        .filter(|name| name.starts_with("Nuova.md~"))
        .collect()
}

#[test]
fn a_rename_onto_an_occupied_space_keeps_the_data_of_the_renamed_note() {
    let mut ws = vault();

    ws.rename_document(&doc("Vecchia.md"), &doc("Nuova.md"))
        .expect("rename");
    ws.collect_doc_data().expect("collection");

    assert_eq!(
        ws.read(&format!("{SPACE}/Nuova.md/annotazione")),
        "dati di Vecchia",
        "the renamed note lost its data to the collection"
    );
    assert!(!ws.exists(&format!("{SPACE}/Vecchia.md")));
    let aside = displaced(&ws);
    assert_eq!(aside.len(), 1, "the remnant is set aside, once: {aside:?}");
    assert_eq!(
        ws.read(&format!("{SPACE}/{}/annotazione", aside[0])),
        "residuo di una nota cancellata",
        "and keeps its bytes, out of reach of the collection"
    );
}

#[test]
fn a_restarted_collection_still_leaves_the_set_aside_remnant_alone() {
    let mut ws = vault();
    ws.rename_document(&doc("Vecchia.md"), &doc("Nuova.md"))
        .expect("rename");

    ws.collect_doc_data().expect("first collection");
    ws.collect_doc_data().expect("second collection");

    assert_eq!(displaced(&ws).len(), 1);
}

/// Un supporto che non lascia spostare lo spazio di `Vecchia.md` di un solo
/// plugin: una cartella tenuta aperta da qualcun altro, come succede su
/// Windows.
struct OneSpaceStuck {
    inner: FsStorage,
    stuck: &'static str,
}

impl VaultStorage for OneSpaceStuck {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        if from.ends_with(self.stuck) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "la cartella è in uso",
            ));
        }
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// **Finché il file non si è mosso, uno spazio che non può seguire ferma la
/// rinomina.** Lasciato sotto l'id vecchio di una nota che ha cambiato nome,
/// la raccolta successiva lo prenderebbe per lo spazio di una nota che non
/// esiste più.
///
/// E il rifiuto disfa **soltanto** ciò che si è mosso: lo spazio dell'altro
/// plugin torna indietro, e ciò che occupava la sua destinazione torna al suo
/// posto. Una migrazione al contrario, invece, avrebbe spostato anche quello.
#[test]
fn a_space_that_cannot_follow_stops_the_rename_and_everything_goes_back() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let put = |rel: &str, body: &str| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("folders");
        std::fs::write(path, body).expect("written");
    };
    let get = |rel: &str| std::fs::read_to_string(root.join(rel)).ok();
    put("Vecchia.md", "# Vecchia\n");
    put(".fub/plugins/a/doc/Vecchia.md/x", "a di Vecchia");
    put(".fub/plugins/b/doc/Vecchia.md/x", "b di Vecchia");
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(SampleText::by_extension("md")))
        .expect("no conflict");
    let storage = Arc::new(OneSpaceStuck {
        inner: FsStorage,
        stuck: "plugins/b/doc/Vecchia.md",
    });
    let mut ws = Workspace::on(
        &root,
        registry,
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("open");
    ws.reindex().expect("index");
    // Dopo l'apertura, la cui raccolta l'avrebbe già tolto.
    put(".fub/plugins/a/doc/Nuova.md/x", "residuo di a");

    let refused = ws.rename_document(&doc("Vecchia.md"), &doc("Nuova.md"));

    let error = refused.expect_err("the rename went ahead without the data of b");
    assert!(
        error.to_string().contains("la cartella è in uso"),
        "the refusal says why: {error}"
    );
    assert_eq!(get("Vecchia.md").as_deref(), Some("# Vecchia\n"));
    assert!(get("Nuova.md").is_none());
    assert_eq!(
        get(".fub/plugins/b/doc/Vecchia.md/x").as_deref(),
        Some("b di Vecchia")
    );
    assert_eq!(
        get(".fub/plugins/a/doc/Vecchia.md/x").as_deref(),
        Some("a di Vecchia"),
        "the space that did move came back"
    );
    assert_eq!(
        get(".fub/plugins/a/doc/Nuova.md/x").as_deref(),
        Some("residuo di a"),
        "and what occupied its destination is where it was"
    );
    let names: Vec<_> = std::fs::read_dir(root.join(".fub/plugins/a/doc"))
        .expect("space")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .into_string()
                .expect("utf-8")
        })
        .collect();
    // Su Windows la rinomina senza sostituzione passa dai compagni di lock
    // (`.Nuova.md~displaced.lock`), che restano accanto ai nomi toccati: il
    // residuo da non lasciare è la cartella spostata, non il suo lock.
    assert!(
        !names
            .iter()
            .any(|name| !name.starts_with('.') && name.contains('~')),
        "{names:?}"
    );

    ws.collect_doc_data().expect("collection");
    assert_eq!(
        get(".fub/plugins/b/doc/Vecchia.md/x").as_deref(),
        Some("b di Vecchia")
    );
    assert_eq!(
        get(".fub/plugins/a/doc/Vecchia.md/x").as_deref(),
        Some("a di Vecchia")
    );
}
