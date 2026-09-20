use std::fs;

use camino::Utf8PathBuf;
use fub_host::{Host, SnapshotHostError};
use fub_kernel::snapshot::{SnapshotBundle, SnapshotError};

#[test]
fn host_rejects_open_vault_and_reopens_after_offline_apply() {
    let directory = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(directory.path().join("vault")).expect("utf8 root");
    fs::create_dir(&root).expect("vault root");
    fs::write(root.join("note.md"), b"offline").expect("note");
    let snapshot = SnapshotBundle::capture(&root).expect("snapshot");

    let host = Host::without_watcher();
    host.open(&root).expect("open");
    let error = host
        .apply_snapshot(&root, &snapshot)
        .expect_err("open vault is not quiescent");
    assert!(matches!(
        error,
        SnapshotHostError::Lifecycle(fub_abi::PluginError::Conflict(_))
    ));
    assert!(host.close().is_empty());
    let snapshot = SnapshotBundle::capture(&root).expect("current snapshot");

    host.apply_snapshot(&root, &snapshot)
        .expect("apply and reopen");
    host.wait_indexed(None).expect("reopen indexing");
    assert_eq!(fs::read(root.join("note.md")).expect("note"), b"offline");
    assert!(host.close().is_empty());
}

#[test]
fn host_startup_recovery_runs_before_mount() {
    let directory = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(directory.path().join("vault")).expect("utf8 root");
    fs::create_dir(&root).expect("vault root");
    fs::write(root.join("note.md"), b"offline").expect("note");
    let snapshot = SnapshotBundle::capture(&root).expect("snapshot");
    let fault = fub_kernel::snapshot::SnapshotApplier::apply_with_fault(
        &root,
        &snapshot,
        Some(fub_kernel::snapshot::SnapshotFault::AfterPrepare),
    );
    assert!(matches!(fault, Err(SnapshotError::FaultInjected(_))));

    let host = Host::without_watcher();
    host.open(&root).expect("recovery before mount");
    host.wait_indexed(None).expect("indexing");
    assert_eq!(fs::read(root.join("note.md")).expect("note"), b"offline");
    assert!(host.close().is_empty());
}

#[test]
fn host_recovers_root_absence_before_mount() {
    for fault in [
        fub_kernel::snapshot::SnapshotFault::AfterOldMoved,
        fub_kernel::snapshot::SnapshotFault::AfterPublished,
    ] {
        let directory = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(directory.path().join("vault")).expect("utf8 root");
        fs::create_dir(&root).expect("vault root");
        fs::write(root.join("note.md"), b"offline").expect("note");
        let snapshot = SnapshotBundle::capture(&root).expect("snapshot");
        assert!(matches!(
            fub_kernel::snapshot::SnapshotApplier::apply_with_fault(&root, &snapshot, Some(fault)),
            Err(SnapshotError::FaultInjected(_))
        ));
        assert!(!root.exists());

        let host = Host::without_watcher();
        host.open(&root).expect("recovery before mount");
        host.wait_indexed(None).expect("indexing");
        assert_eq!(fs::read(root.join("note.md")).expect("note"), b"offline");
        assert!(host.close().is_empty());
    }
}
