//! **Un file creato da un altro programma entra nel vault aperto** (IMP-6501).
//!
//! La catena intera, con il rilevatore vero (`notify`, una cartella per
//! osservatore su Linux) e il provider Markdown: il disco cambia da fuori,
//! l'evento attraversa il debouncer, il lotto entra nell'anagrafe, e il ponte
//! consegna `DocumentChanged` e `IndexUpdated` — i due fatti su cui l'albero e
//! il contatore «Tutte le note» si ridisegnano. Nessun riavvio.
//!
//! Le quattro forme del caso: un file nella radice, un file in una cartella
//! nata da fuori, cinquanta file insieme, e un file creato e subito cancellato
//! (che non deve restare nell'anagrafe).

#![cfg(target_os = "linux")]

use std::collections::BTreeSet;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::{Event, Notice};
use fub_host::{Delivery, EventSink, Host};

/// Quanto si aspetta un fatto che deve arrivare. Il debouncer ne mette 300 ms;
/// il resto è margine per una macchina carica, non un tempo del contratto.
const DEADLINE: Duration = Duration::from_secs(20);

struct Registered {
    output: Mutex<Sender<Notice>>,
}

impl EventSink for Registered {
    fn emit(&self, notice: &Notice, _vault: Option<&str>) -> Delivery {
        let _ = self
            .output
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .send(notice.clone());
        Delivery::Done
    }
}

struct OpenVault {
    _vault: tempfile::TempDir,
    _config: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
    notices: Receiver<Notice>,
    seen: Vec<Event>,
}

impl OpenVault {
    /// Un vault con una nota nella radice e qualche cartella, aperto con il
    /// rilevatore di serie e indicizzato.
    fn open() -> Self {
        let vault = tempfile::tempdir().expect("a vault");
        let config = tempfile::tempdir().expect("a config folder");
        let root = Utf8PathBuf::from_path_buf(vault.path().canonicalize().expect("canonical"))
            .expect("utf8");
        let config_dir = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).expect("utf8");
        for folder in ["Note", "Disegni", "PDF"] {
            std::fs::create_dir_all(root.join(folder)).expect("a folder");
        }
        std::fs::write(root.join("Home.md"), "# Home\n\nTesto.\n").expect("a note");
        std::fs::write(root.join("Note/Prima.md"), "# Prima\n").expect("a note");
        let (output, notices) = channel();
        let host = Host::new()
            .with_config_dir(&config_dir)
            .with_sink(Arc::new(Registered {
                output: Mutex::new(output),
            }));
        host.open(&root).expect("the vault opens");
        host.wait_indexed(None).expect("the first index completes");
        let mut open = OpenVault {
            _vault: vault,
            _config: config,
            root,
            host,
            notices,
            seen: Vec::new(),
        };
        open.drain();
        open
    }

    fn drain(&mut self) {
        self.seen
            .extend(self.notices.try_iter().map(|notice| notice.event));
    }

    /// Gli id dell'anagrafe, come li chiede l'albero.
    fn entries(&self) -> BTreeSet<String> {
        let IndexResult::Entries(page) = self
            .host
            .query_index(
                None,
                IndexQuery::Entries {
                    of_kind: None,
                    within: None,
                    page: None,
                },
            )
            .expect("the kernel serves the index")
        else {
            panic!("expected the entries");
        };
        page.items
            .iter()
            .map(|entry| entry.id.as_str().to_string())
            .collect()
    }

    /// Aspetta che il ponte abbia consegnato `DocumentChanged` per ciascuno
    /// di `ids`, e poi un `IndexUpdated` (o la fine di un lotto) dopo l'ultimo.
    fn wait_for_changes(&mut self, ids: &[String]) {
        let deadline = Instant::now() + DEADLINE;
        let mut missing: BTreeSet<&str> = ids.iter().map(String::as_str).collect();
        let mut refreshed = false;
        while !(missing.is_empty() && refreshed) {
            let left = deadline.saturating_duration_since(Instant::now());
            let notice = self.notices.recv_timeout(left).unwrap_or_else(|_| {
                panic!(
                    "the bridge did not deliver the external change: missing {missing:?}, \
                     refreshed {refreshed}, seen {:?}",
                    self.seen
                )
            });
            match &notice.event {
                Event::DocumentChanged { id, .. } => {
                    missing.remove(id.as_str());
                    refreshed = false;
                }
                Event::IndexUpdated | Event::BatchEnded { .. } if missing.is_empty() => {
                    refreshed = true;
                }
                _ => {}
            }
            self.seen.push(notice.event);
        }
    }

    fn write(&self, rel: &str) {
        let path = self.root.join(rel);
        std::fs::write(&path, format!("# {}\n", title(&path))).expect("written from outside");
    }
}

fn title(path: &Utf8Path) -> &str {
    path.file_stem().expect("a file name")
}

#[test]
fn a_file_written_by_another_program_reaches_the_tree() {
    let mut vault = OpenVault::open();
    let before = vault.entries();
    assert!(
        before.contains("Home.md"),
        "the seed is indexed: {before:?}"
    );

    vault.write("Nuova fuori 1.md");
    vault.wait_for_changes(&["Nuova fuori 1.md".to_string()]);
    let after = vault.entries();
    assert!(
        after.contains("Nuova fuori 1.md"),
        "the new file is in the entries the tree and the counter read: {after:?}"
    );
    assert_eq!(after.len(), before.len() + 1, "the counter grows by one");
}

#[test]
fn a_file_in_a_folder_created_from_outside_reaches_the_tree() {
    let mut vault = OpenVault::open();
    std::fs::create_dir(vault.root.join("Cartella fuori")).expect("a new folder from outside");
    vault.write("Cartella fuori/Dentro.md");
    vault.wait_for_changes(&["Cartella fuori/Dentro.md".to_string()]);
    assert!(vault.entries().contains("Cartella fuori/Dentro.md"));

    // La cartella nuova ha il suo osservatore: un file scritto dopo arriva
    // anche lui.
    vault.write("Cartella fuori/Dopo.md");
    vault.wait_for_changes(&["Cartella fuori/Dopo.md".to_string()]);
    assert!(vault.entries().contains("Cartella fuori/Dopo.md"));
}

#[test]
fn fifty_files_written_together_all_reach_the_tree() {
    let mut vault = OpenVault::open();
    let before = vault.entries().len();
    let ids: Vec<String> = (0..50).map(|i| format!("Molti {i:02}.md")).collect();
    for id in &ids {
        vault.write(id);
    }
    vault.wait_for_changes(&ids);
    let after = vault.entries();
    let absent: Vec<&String> = ids.iter().filter(|id| !after.contains(*id)).collect();
    assert!(
        absent.is_empty(),
        "every file is in the entries: missing {absent:?}"
    );
    assert_eq!(after.len(), before + 50);
}

#[test]
fn a_file_created_and_deleted_at_once_does_not_stay_in_the_tree() {
    let mut vault = OpenVault::open();
    let before = vault.entries();
    vault.write("Effimera.md");
    std::fs::remove_file(vault.root.join("Effimera.md")).expect("deleted from outside");
    // Un file scritto dopo fa da segnale: quando il suo lotto è passato,
    // anche quello del file effimero è passato.
    vault.write("Segnale.md");
    vault.wait_for_changes(&["Segnale.md".to_string()]);
    vault.drain();
    let after = vault.entries();
    assert!(
        !after.contains("Effimera.md"),
        "a file that is no longer on disk is not in the entries: {after:?}"
    );
    assert_eq!(after.len(), before.len() + 1, "only the signal was added");
}
