use std::sync::mpsc;
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};

use super::*;
use crate::watcher::NoWatcher;

const WATCHDOG: Duration = Duration::from_secs(2);

#[test]
fn vault_registry_handle_progresses_while_workspace_write_lock_is_held() {
    let directory = tempfile::tempdir().expect("temporary vault");
    let root = Utf8PathBuf::from_path_buf(directory.path().to_path_buf())
        .expect("temporary path is UTF-8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("seed note");

    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&root).expect("the vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");

    // Il test prende la custodia dalla struttura privata della sessione:
    // nessuna API generica del workspace serve al percorso pubblico del
    // servizio.
    let workspace = {
        let sessions = host.sessions.read().expect("sessions are alive");
        sessions
            .slots
            .values()
            .find_map(|slot| match slot {
                SessionSlot::Open(session) => Some(session.workspace.clone()),
                SessionSlot::Applying(_) | SessionSlot::Closing(_) => None,
            })
            .expect("the opened session has a workspace")
    };
    let service = host.vault_registry();

    let (locked_tx, locked_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let locker = std::thread::spawn(move || {
        let _write = workspace.write().expect("workspace is not poisoned");
        locked_tx.send(()).expect("the lock observer remains alive");
        release_rx
            .recv_timeout(WATCHDOG)
            .expect("the lock owner receives the release");
    });
    locked_rx
        .recv_timeout(WATCHDOG)
        .expect("thread A holds the workspace write lock");

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let worker_service = service.clone();
    let service_worker = std::thread::spawn(move || {
        let result = worker_service.notes_opened(Utf8Path::new("/independent"), 7);
        done_tx
            .send(result)
            .expect("the service observer remains alive");
    });
    done_rx
        .recv_timeout(WATCHDOG)
        .expect("the independent service completes under the workspace lock")
        .expect("the in-memory registry accepts the update");

    release_tx.send(()).expect("thread A is released");
    locker.join().expect("thread A does not panic");
    service_worker.join().expect("thread B does not panic");

    assert!(
        service
            .list()
            .iter()
            .any(|entry| entry.root == "/independent" && entry.last_opened == 7),
        "the real service completed the operation while the workspace was locked"
    );

    assert!(
        host.close().is_empty(),
        "session teardown leaves no errors after the lock probe"
    );
    drop(host);
    assert!(
        service.is_shutdown(),
        "dropping the owner explicitly shuts down the shared service"
    );
}
