use std::collections::BTreeMap;
use std::fs;

use camino::Utf8PathBuf;
use fub_host::{Host, SnapshotHostError};

use fub_kernel::snapshot::{SnapshotBundle, SnapshotError};

fn retarget_snapshot(base: &SnapshotBundle, desired: &SnapshotBundle) -> SnapshotBundle {
    let files = desired
        .manifest()
        .entries
        .iter()
        .map(|entry| {
            (
                entry.path.clone(),
                desired.bytes(&entry.path).expect("target bytes").to_vec(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    SnapshotBundle::new(
        desired.manifest().clone(),
        base.base_revision().clone(),
        files,
    )
    .expect("target snapshot")
}

fn assert_no_transaction_artifacts(root: &Utf8PathBuf) {
    let prefix = format!(
        ".fub-snapshot-{}-",
        root.file_name().expect("vault root name")
    );
    let leftovers = fs::read_dir(root.parent().expect("vault parent"))
        .expect("transaction parent")
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with(&prefix))
        .collect::<Vec<_>>();
    assert!(
        leftovers.is_empty(),
        "snapshot transaction artifacts remain: {leftovers:?}"
    );
}

#[test]
fn host_rejects_open_vault_and_reopens_after_offline_apply() {
    let directory = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(directory.path().join("vault")).expect("utf8 root");
    fs::create_dir(&root).expect("vault root");
    fs::write(root.join("note.md"), b"before").expect("note");
    let canonical_root = root.canonicalize_utf8().expect("canonical root");
    let conflict_snapshot = SnapshotBundle::capture(&root).expect("conflict snapshot");

    let host = Host::without_watcher();
    host.open(&root).expect("open");
    let error = host
        .apply_snapshot(&canonical_root, &conflict_snapshot)
        .expect_err("open vault is not quiescent");
    assert!(matches!(
        error,
        SnapshotHostError::Lifecycle(fub_abi::PluginError::Conflict(_))
    ));
    assert!(host.close().is_empty());
    let base = SnapshotBundle::capture(&root).expect("base snapshot");
    fs::write(root.join("note.md"), b"offline").expect("target note");
    let desired = SnapshotBundle::capture(&root).expect("desired snapshot");
    fs::write(root.join("note.md"), b"before").expect("restore note");
    let target = retarget_snapshot(&base, &desired);

    host.apply_snapshot(&canonical_root, &target)
        .expect("apply and reopen");
    host.wait_indexed(None).expect("reopen indexing");
    assert_eq!(fs::read(root.join("note.md")).expect("note"), b"offline");
    assert!(host.close().is_empty());
}

#[test]
fn host_recovery_requires_quiescent_vault() {
    let directory = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(directory.path().join("vault")).expect("utf8 root");
    fs::create_dir(&root).expect("vault root");
    fs::write(root.join("note.md"), b"stable").expect("note");

    let host = Host::without_watcher();
    host.open(&root).expect("open");
    let error = host
        .recover_snapshot_artifacts(&root)
        .expect_err("recovery must conflict with an open vault");
    assert!(matches!(
        error,
        SnapshotHostError::Lifecycle(fub_abi::PluginError::Conflict(_))
    ));
    assert!(host.close().is_empty());
}

#[test]
fn host_open_reports_not_found_for_missing_and_non_directory_roots() {
    let directory = tempfile::tempdir().expect("tempdir");
    let missing = Utf8PathBuf::from_path_buf(directory.path().join("missing")).expect("missing");
    let missing_nested =
        Utf8PathBuf::from_path_buf(directory.path().join("missing/vault")).expect("nested");
    let file = Utf8PathBuf::from_path_buf(directory.path().join("vault.txt")).expect("file");
    fs::write(&file, b"not a vault").expect("file");
    let host = Host::without_watcher();

    assert!(matches!(
        host.open(&missing),
        Err(fub_abi::PluginError::NotFound(_))
    ));
    assert!(matches!(
        host.open(&file),
        Err(fub_abi::PluginError::NotFound(_))
    ));
    assert!(matches!(
        host.open(&missing_nested),
        Err(fub_abi::PluginError::NotFound(_))
    ));
}

#[cfg(unix)]
#[test]
fn host_rejects_symlink_alias_for_snapshot_apply() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(directory.path().join("vault")).expect("utf8 root");
    let alias = Utf8PathBuf::from_path_buf(directory.path().join("alias")).expect("utf8 alias");
    fs::create_dir(&root).expect("vault root");
    fs::write(root.join("note.md"), b"stable").expect("note");
    symlink(&root, &alias).expect("alias");
    let snapshot = SnapshotBundle::capture(&root).expect("snapshot");

    let host = Host::without_watcher();
    let error = host
        .apply_snapshot(&alias, &snapshot)
        .expect_err("alias apply must be rejected");
    assert!(matches!(
        error,
        SnapshotHostError::Lifecycle(fub_abi::PluginError::Conflict(_))
    ));
    assert_eq!(fs::read(root.join("note.md")).expect("note"), b"stable");
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
    assert_no_transaction_artifacts(&root);
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
        fs::write(root.join("note.md"), b"old").expect("old note");
        let base = SnapshotBundle::capture(&root).expect("base snapshot");
        fs::write(root.join("note.md"), b"new").expect("new note");
        let desired = SnapshotBundle::capture(&root).expect("desired snapshot");
        fs::write(root.join("note.md"), b"old").expect("restore note");
        let target = retarget_snapshot(&base, &desired);
        assert!(matches!(
            fub_kernel::snapshot::SnapshotApplier::apply_with_fault(&root, &target, Some(fault)),
            Err(SnapshotError::FaultInjected(_))
        ));
        assert!(!root.exists());

        let host = Host::without_watcher();
        host.open(&root).expect("recovery before mount");
        host.wait_indexed(None).expect("indexing");
        let expected = if matches!(fault, fub_kernel::snapshot::SnapshotFault::AfterOldMoved) {
            b"old".as_slice()
        } else {
            b"new".as_slice()
        };
        assert_eq!(fs::read(root.join("note.md")).expect("note"), expected);
        assert!(host.close().is_empty());
    }
}
