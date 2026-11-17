//! Test unitari dello snapshot globale: formato, preflight, applicazione,
//! fault injection e recovery.

use super::*;
use tempfile::TempDir;

fn root() -> (TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    fs::create_dir(&root).expect("root");
    (dir, root)
}

fn assert_no_transaction_artifacts(root: &Utf8Path) {
    let prefix = format!(
        "{TRANSACTION_PREFIX}{}-",
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
fn manifest_revision_is_deterministic_and_sorted() {
    let first = entry_for_path("a.md", b"a").expect("entry");
    let second = entry_for_path("b.md", b"b").expect("entry");
    let forward = SnapshotManifest::new(vec![first.clone(), second.clone()]).expect("manifest");
    let reversed = SnapshotManifest::new(vec![second, first]).expect("manifest");

    assert_eq!(forward.entries, reversed.entries);
    assert_eq!(forward.digest(), reversed.digest());
    assert_eq!(
        forward
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        ["a.md", "b.md"]
    );
    assert!(forward.digest().as_str().starts_with("sha256:"));
}

#[test]
fn capture_excludes_marked_derived_but_keeps_unknown() {
    let (_dir, root) = root();
    fs::create_dir_all(root.join(".fub/data/plugins/x")).expect("cache");
    fs::write(root.join(".fub/data/plugins/x/.fub-cache-root"), b"cache\n").expect("cache marker");
    fs::write(root.join(".fub/data/plugins/x/index.bin"), b"derived").expect("cache");
    fs::create_dir_all(root.join(".fub/data")).expect("data");
    fs::write(root.join(".fub/data/unknown.bin"), b"keep").expect("unknown");
    fs::write(root.join("note.md"), b"note").expect("note");
    let snapshot = SnapshotBundle::capture(&root).expect("capture");
    assert!(snapshot.bytes(".fub/data/plugins/x/index.bin").is_none());
    assert_eq!(snapshot.bytes(".fub/data/unknown.bin"), Some(&b"keep"[..]));
}

#[test]
fn unmarked_plugin_cache_is_legacy_authority_and_survives_apply() {
    let (_dir, root) = root();
    let legacy = root.join(".fub/data/plugins/legacy");
    fs::create_dir_all(&legacy).expect("legacy plugin root");
    fs::write(legacy.join("state.json"), b"legacy").expect("legacy state");
    let marked = root.join(".fub/data/plugins/cache");
    fs::create_dir_all(&marked).expect("marked plugin root");
    fs::write(marked.join(crate::workspace::PLUGIN_CACHE_MARK), b"cache\n").expect("cache marker");
    fs::write(marked.join("index.bin"), b"derived").expect("derived cache");

    let captured = SnapshotBundle::capture(&root).expect("capture");
    assert_eq!(
        captured.bytes(".fub/data/plugins/legacy/state.json"),
        Some(&b"legacy"[..])
    );
    assert!(captured
        .bytes(".fub/data/plugins/cache/index.bin")
        .is_none());

    fs::remove_file(legacy.join("state.json")).expect("remove legacy");
    let current = SnapshotBundle::capture(&root).expect("current");
    let target = SnapshotBundle::new(
        captured.manifest.clone(),
        current.base_revision.clone(),
        captured.files.clone(),
    )
    .expect("target");
    SnapshotApplier::apply(&root, &target).expect("apply legacy");
    assert_eq!(
        fs::read(legacy.join("state.json")).expect("restored legacy"),
        b"legacy"
    );
    let leftovers = fs::read_dir(root.parent().expect("parent"))
        .expect("transaction parent")
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .any(|name| name.ends_with(".record"));
    assert!(!leftovers, "successful apply leaves no recovery record");
}

#[test]
fn preflight_rejects_future_schema_duplicate_traversal_and_corrupt_payload() {
    let (_dir, root) = root();
    fs::write(root.join("note.md"), b"note").expect("note");
    let original = SnapshotBundle::capture(&root).expect("capture");

    let mut future = original.manifest.clone();
    future.schema_version = SchemaVersion::new(2);
    assert!(matches!(
        future.validate_structure(),
        Err(SnapshotError::FutureSchema { .. })
    ));

    let entry = original.manifest.entries[0].clone();
    let duplicate = SnapshotManifest {
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        entries: vec![entry.clone(), entry],
    };
    assert!(matches!(
        duplicate.validate_structure(),
        Err(SnapshotError::DuplicatePath(_))
    ));

    let traversal = SnapshotManifest {
        schema_version: SNAPSHOT_SCHEMA_VERSION,

        entries: vec![SnapshotEntry {
            path: "../outside".into(),
            class: SnapshotClass::User,
            owner: "user".into(),
            schema: None,
            size: 0,
            digest: Revision::of_bytes(b""),
        }],
    };
    assert!(matches!(
        traversal.validate_structure(),
        Err(SnapshotError::InvalidPath(_))
    ));

    let mut corrupt = original.files.clone();
    corrupt.insert("note.md".into(), b"changed".to_vec());
    assert!(matches!(
        original.manifest.validate_files(&corrupt),
        Err(SnapshotError::SizeMismatch { .. }) | Err(SnapshotError::DigestMismatch { .. })
    ));
    assert_eq!(fs::read(root.join("note.md")).expect("old"), b"note");
}

#[cfg(unix)]
#[test]
fn capture_rejects_symlink_without_reading_target() {
    use std::os::unix::fs::symlink;

    let (directory, root) = root();
    let outside = directory.path().join("outside.txt");
    fs::write(&outside, b"outside").expect("outside");
    symlink(&outside, root.join("link.txt")).expect("symlink");
    assert!(matches!(
        SnapshotBundle::capture(&root),
        Err(SnapshotError::UnsupportedFile(path)) if path == "link.txt"
    ));
}

#[test]
fn path_preflight_rejects_noncanonical_forms() {
    for path in ["a//b", "a/", "a/./b"] {
        let manifest = SnapshotManifest {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            entries: vec![SnapshotEntry {
                path: path.into(),
                class: SnapshotClass::User,
                owner: "user".into(),
                schema: None,
                size: 0,
                digest: Revision::of_bytes(b""),
            }],
        };
        assert!(matches!(
            manifest.validate_structure(),
            Err(SnapshotError::InvalidPath(found)) if found == path
        ));
    }
}

#[test]
fn path_preflight_rejects_windows_reserved_syntax_on_every_platform() {
    for path in [
        "a:b",
        "a<b",
        "a>b",
        "a\"b",
        "a|b",
        "a?b",
        "a*b",
        "CON",
        "con.txt",
        "PrN.md",
        "AUX.data",
        "nul.bin",
        "COM1.log",
        "com9",
        "COM¹.log",
        "com²",
        "COM³.txt",
        "LPT1.txt",
        "lpt9",
        "LPT¹.log",
        "lpt²",
        "LPT³.txt",
        "CONIN$",
        "conout$.txt",
        "trailing.",
        "trailing ",
        "control\u{1}.txt",
    ] {
        assert!(matches!(
            validate_relative_path(path),
            Err(SnapshotError::InvalidPath(found)) if found == path
        ));
    }
    for path in [
        "CONSOLE.txt",
        "COM10.txt",
        "COM⁴.txt",
        "LPT0.txt",
        "LPT⁴.txt",
        "CONINPUT.txt",
        "CONOUT.txt",
        "normal.txt",
        "dir/NULable.txt",
    ] {
        assert!(
            validate_relative_path(path).is_ok(),
            "valid near-case rejected: {path}"
        );
    }
}

#[cfg(unix)]
#[test]
fn apply_normalizes_new_tree_permissions_to_private_modes() {
    use std::os::unix::fs::PermissionsExt;

    let (_dir, root) = root();
    let nested = root.join("nested");
    fs::create_dir(&nested).expect("nested");
    fs::write(nested.join("note.md"), b"note").expect("note");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).expect("root mode");
    fs::set_permissions(&nested, fs::Permissions::from_mode(0o755)).expect("nested mode");
    fs::set_permissions(nested.join("note.md"), fs::Permissions::from_mode(0o644))
        .expect("file mode");

    let snapshot = SnapshotBundle::capture(&root).expect("capture");
    SnapshotApplier::apply(&root, &snapshot).expect("apply");

    assert_eq!(
        fs::metadata(&root)
            .expect("root metadata")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(&nested)
            .expect("nested metadata")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(nested.join("note.md"))
            .expect("file metadata")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}

#[test]
fn artifact_rejects_payload_not_listed_in_manifest() {
    let (_dir, root) = root();
    fs::write(root.join("note.md"), b"note").expect("note");
    let snapshot = SnapshotBundle::capture(&root).expect("capture");
    let artifact = root.parent().expect("parent").join("snapshot-artifact");
    snapshot.write_to(&artifact).expect("write artifact");
    fs::write(artifact.join("payload/rogue.bin"), b"rogue").expect("rogue");
    assert!(matches!(
        SnapshotBundle::read_from(&artifact),
        Err(SnapshotError::UnexpectedEntry(path)) if path == "rogue.bin"
    ));
    assert!(matches!(
        snapshot.write_to(&artifact),
        Err(SnapshotError::AlreadyExists(path)) if path == artifact
    ));
}

#[test]
fn recovery_handles_root_absence_and_unknown_records_idempotently() {
    for fault in [SnapshotFault::AfterOldMoved, SnapshotFault::AfterPublished] {
        let (_dir, root) = root();
        fs::write(root.join("note.md"), b"old").expect("old note");
        let base = SnapshotBundle::capture(&root).expect("base snapshot");
        let target_bytes = b"new";
        let target_files = BTreeMap::from([("note.md".to_owned(), target_bytes.to_vec())]);
        let target_manifest = SnapshotManifest::new(
            target_files
                .iter()
                .map(|(path, bytes)| entry_for_path(path, bytes).expect("entry"))
                .collect(),
        )
        .expect("target manifest");
        let target =
            SnapshotBundle::new(target_manifest, base.base_revision().clone(), target_files)
                .expect("target snapshot");
        assert!(matches!(
            SnapshotApplier::apply_with_fault(&root, &target, Some(fault)),
            Err(SnapshotError::FaultInjected(_))
        ));
        assert!(!root.exists());
        let recovered = SnapshotApplier::recover(&root).expect("recover missing root");
        assert_eq!(recovered.recovered, 1);
        let expected = if matches!(fault, SnapshotFault::AfterOldMoved) {
            b"old".as_slice()
        } else {
            b"new".as_slice()
        };
        assert_eq!(
            fs::read(root.join("note.md")).expect("recovered note"),
            expected
        );
        assert_no_transaction_artifacts(&root);
        assert_eq!(
            SnapshotApplier::recover(&root)
                .expect("idempotent recovery")
                .recovered,
            0
        );
    }

    let (_dir, root) = root();
    fs::write(root.join("note.md"), b"stable").expect("note");
    let parent = root.parent().expect("parent");
    let future = parent.join(".fub-snapshot-vault-future.record");
    fs::write(&future, br#"{"schema_version":99}"#).expect("future record");
    let foreign = parent.join(".foreign-vault-artifact");
    fs::write(&foreign, b"keep").expect("foreign artifact");
    assert_eq!(
        SnapshotApplier::recover(&root)
            .expect("future recovery")
            .recovered,
        0
    );
    assert!(future.exists());
    assert!(foreign.exists());
}

#[test]
fn stale_base_and_fault_before_commit_leave_old_bytes_untouched() {
    let (_dir, root) = root();
    fs::write(root.join("note.md"), b"before").expect("before");
    let snapshot = SnapshotBundle::capture(&root).expect("capture");
    fs::write(root.join("note.md"), b"newer").expect("newer");
    let before = fs::read(root.join("note.md")).expect("before bytes");
    assert!(matches!(
        SnapshotApplier::apply(&root, &snapshot),
        Err(SnapshotError::BaseRevisionStale { .. })
    ));
    assert_eq!(fs::read(root.join("note.md")).expect("unchanged"), before);

    let same = SnapshotBundle::capture(&root).expect("capture newer");
    assert!(matches!(
        SnapshotApplier::apply_with_fault(&root, &same, Some(SnapshotFault::BeforeWrite)),
        Err(SnapshotError::FaultInjected(_))
    ));
    assert_eq!(fs::read(root.join("note.md")).expect("unchanged"), before);
    assert!(matches!(
        SnapshotApplier::apply_with_fault(
            &root,
            &same,
            Some(SnapshotFault::DuringWrite { entries: 0 })
        ),
        Err(SnapshotError::FaultInjected(_))
    ));
    assert_eq!(fs::read(root.join("note.md")).expect("unchanged"), before);
}

#[test]
fn during_write_with_multiple_entries_cleans_staging_and_keeps_original_root() {
    let (_dir, root) = root();
    fs::write(root.join("a.md"), b"old-a").expect("old a");
    fs::write(root.join("b.md"), b"old-b").expect("old b");
    let base = SnapshotBundle::capture(&root).expect("base snapshot");

    let target_files = BTreeMap::from([
        ("a.md".to_owned(), b"new-a".to_vec()),
        ("b.md".to_owned(), b"new-b".to_vec()),
    ]);
    let target_manifest = SnapshotManifest::new(
        target_files
            .iter()
            .map(|(path, bytes)| entry_for_path(path, bytes).expect("entry"))
            .collect(),
    )
    .expect("target manifest");
    let target = SnapshotBundle::new(target_manifest, base.base_revision().clone(), target_files)
        .expect("target snapshot");

    assert!(matches!(
        SnapshotApplier::apply_with_fault(
            &root,
            &target,
            Some(SnapshotFault::DuringWrite { entries: 1 })
        ),
        Err(SnapshotError::FaultInjected(_))
    ));
    assert_eq!(fs::read(root.join("a.md")).expect("original a"), b"old-a");
    assert_eq!(fs::read(root.join("b.md")).expect("original b"), b"old-b");
    assert_no_transaction_artifacts(&root);
}

/// Una root pubblicata che non è quella attesa non chiude il vault per
/// sempre: torna la precedente, e la pubblicata resta accanto.
#[test]
fn a_published_root_that_does_not_match_rolls_back_and_is_set_aside() {
    for crash_between_renames in [false, true] {
        let (_dir, root) = root();
        fs::write(root.join("note.md"), b"old").expect("old note");
        let base = SnapshotBundle::capture(&root).expect("base snapshot");
        let target_files = BTreeMap::from([("note.md".to_owned(), b"new".to_vec())]);
        let target_manifest =
            SnapshotManifest::new(vec![entry_for_path("note.md", b"new").expect("entry")])
                .expect("target manifest");
        let target = SnapshotBundle::new(target_manifest, base.base_revision.clone(), target_files)
            .expect("target snapshot");
        assert!(matches!(
            SnapshotApplier::apply_with_fault(&root, &target, Some(SnapshotFault::AfterCommit)),
            Err(SnapshotError::FaultInjected(_))
        ));
        // Qualcuno scrive nella root pubblicata prima della finalize.
        fs::write(root.join("later.md"), b"written after publish").expect("later write");
        let id = fs::read_dir(root.parent().expect("parent"))
            .expect("parent listing")
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .find_map(|name| name.strip_suffix(RECORD_SUFFIX).map(str::to_owned))
            .expect("a pending record");
        let rejected = root
            .parent()
            .expect("parent")
            .join(format!("{id}{REJECTED_SUFFIX}"));
        if crash_between_renames {
            fs::rename(&root, &rejected).expect("first rename of the rollback");
        }

        let report = SnapshotApplier::recover(&root).expect("the recovery unblocks the vault");
        assert_eq!(report.recovered, 1);
        assert_eq!(
            fs::read(root.join("note.md")).expect("old note back"),
            b"old"
        );
        assert!(!root.join("later.md").exists());
        assert_eq!(
            fs::read(rejected.join("later.md")).expect("the published root is kept"),
            b"written after publish"
        );
        if !crash_between_renames {
            // Il ripristino parla con la root canonica: su macOS il
            // tempdir passa da `/var`, e il path scritto qui no.
            let canonical = |path: &Utf8Path| fs::canonicalize(path).expect("canonical");
            assert_eq!(
                report
                    .set_aside
                    .iter()
                    .map(|path| canonical(path))
                    .collect::<Vec<_>>(),
                vec![canonical(&rejected)]
            );
        }
        assert_eq!(
            SnapshotApplier::recover(&root)
                .expect("idempotent")
                .recovered,
            0,
            "the rollback must close the transaction"
        );
    }
}

#[test]
fn restart_recovery_rolls_back_prepare_and_finalizes_commit() {
    let (_dir, root) = root();
    fs::write(root.join("note.md"), b"stable").expect("note");
    let base = SnapshotBundle::capture(&root).expect("capture");
    let before = fs::read(root.join("note.md")).expect("before");
    assert!(matches!(
        SnapshotApplier::apply_with_fault(&root, &base, Some(SnapshotFault::AfterPrepare)),
        Err(SnapshotError::FaultInjected(_))
    ));
    let recovered = SnapshotApplier::recover(&root).expect("rollback prepare");
    assert_eq!(recovered.recovered, 1);
    assert_eq!(
        fs::read(root.join("note.md")).expect("after rollback"),
        before
    );
    assert_no_transaction_artifacts(&root);

    let target_bytes = b"restored".to_vec();
    let target_files = BTreeMap::from([("note.md".to_owned(), target_bytes.clone())]);
    let target_manifest = SnapshotManifest::new(vec![
        entry_for_path("note.md", &target_bytes).expect("entry")
    ])
    .expect("target manifest");
    let target = SnapshotBundle::new(target_manifest, base.base_revision.clone(), target_files)
        .expect("target snapshot");
    assert!(matches!(
        SnapshotApplier::apply_with_fault(&root, &target, Some(SnapshotFault::AfterCommit)),
        Err(SnapshotError::FaultInjected(_))
    ));
    assert_eq!(
        fs::read(root.join("note.md")).expect("published"),
        target_bytes
    );
    let recovered = SnapshotApplier::recover(&root).expect("finalize commit");
    assert_eq!(recovered.recovered, 1);
    assert_eq!(
        fs::read(root.join("note.md")).expect("after finalize"),
        b"restored"
    );
}
