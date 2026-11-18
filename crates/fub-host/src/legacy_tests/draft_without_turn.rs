//! #485: una bozza non aspetta il turno di scrittura di un salvataggio in volo.
//!
//! La bozza esiste per coprire il tempo in cui il disco non ha ancora il testo.
//! Quando `save_draft` prendeva il turno, una scrittura lenta (un `.docx` sotto
//! carico I/O: 20–35 s sull'app vera) teneva ferma anche la bozza dei gesti
//! fatti nel frattempo, e un crash in quei secondi perdeva l'ultimo testo.

use std::sync::{mpsc, Arc};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use fub_kernel::drafts::drafts_dir;

use super::FREE_WITHIN;
use crate::{Host, NoWatcher};

const HELD_WITHIN: Duration = Duration::from_secs(10);

fn drafts_on_disk(root: &Utf8PathBuf) -> usize {
    match std::fs::read_dir(drafts_dir(root)) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
            .count(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => panic!("la cartella delle bozze non si legge: {error}"),
    }
}

#[test]
fn a_draft_is_written_and_discarded_while_a_save_holds_the_write_turn() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("nota.md"), "# Nota\n").expect("seed note");
    let host = Arc::new(Host::new().with_watcher(Box::new(NoWatcher)));
    host.open(&root).expect("the vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");
    let workspace = host.debug_workspace(None).expect("debug custody");
    let before = drafts_on_disk(&root);

    // Il salvataggio lento: tiene il turno finché il test non lo lascia.
    let (held_tx, held_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel::<()>(1);
    let holder = std::thread::spawn(move || {
        let _turn = workspace.write_turn();
        held_tx.send(()).expect("the test waits for the turn");
        let _ = release_rx.recv();
    });
    held_rx
        .recv_timeout(HELD_WITHIN)
        .expect("the slow save takes the turn");
    assert!(host.is_write_turn_held(None).expect("probe"));

    let (done_tx, done_rx) = mpsc::channel();
    let (next_tx, next_rx) = mpsc::sync_channel::<()>(1);
    let drafting = Arc::clone(&host);
    let drafter = std::thread::spawn(move || {
        let id = DocId::new("nota.md");
        let saved = drafting.save_draft(
            None,
            &id,
            "# Nota\n\nbattuta nuova\n",
            Some(Revision::new("rev-1")),
        );
        done_tx.send(("save", saved)).expect("the test listens");
        if next_rx.recv().is_err() {
            return;
        }
        let discarded = drafting.discard_draft(None, &id);
        done_tx
            .send(("discard", discarded))
            .expect("the test listens");
    });

    let saved = done_rx.recv_timeout(FREE_WITHIN);
    let on_disk = drafts_on_disk(&root);
    let _ = next_tx.send(());
    let discarded = done_rx.recv_timeout(FREE_WITHIN);
    let after = drafts_on_disk(&root);
    // Si lascia il turno prima di ogni verifica: una prova che cade non deve
    // lasciare un thread appeso.
    let _ = release_tx.send(());
    drop(next_tx);
    holder.join().expect("the turn holder does not panic");
    drafter.join().expect("the drafter does not panic");

    let (step, saved) = saved.expect("save_draft waited for the write turn of the save in flight");
    assert_eq!(step, "save");
    saved.expect("the draft is written");
    assert_eq!(
        on_disk,
        before + 1,
        "the draft is on disk while the save holds the turn"
    );
    let (step, discarded) = discarded.expect("discard_draft waited for the write turn");
    assert_eq!(step, "discard");
    discarded.expect("the draft is discarded");
    assert_eq!(after, before);
}
