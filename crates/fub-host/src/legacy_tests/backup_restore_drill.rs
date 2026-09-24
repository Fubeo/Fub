//! Fixture versionata e manifesto autorevole per il backup/restore drill.
//!
//! Il manifesto qui sotto è intenzionalmente scritto a mano: la scansione del
//! fixture può solo essere confrontata con esso, non può contribuire a crearlo.

use fub_abi::model::DocId;
use fub_abi::{Fnv1a, SchemaVersion};
use fub_host::{Host, NoWatcher};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryClass {
    Derived,
    Draft,
    Journal,
    Markdown,
    PluginBlob,
    VersioningMeta,
    VersioningSnapshot,
    Settings,
    TrashItem,
    TrashSidecar,
    Unknown,
    Workspace,
    Binary,
}

#[derive(Debug, PartialEq, Eq)]
struct ExpectedEntry {
    path: &'static str,
    class: EntryClass,
    size: u64,
    hash: u64,
    schema: Option<SchemaVersion>,
}

const ORACLE: &[ExpectedEntry] = &[
    ExpectedEntry {
        path: ".fub/data/entries.json",
        class: EntryClass::Derived,
        size: 38,
        hash: 0xbceb_03c0_ba28_5b5d,
        schema: Some(SchemaVersion::new(5)),
    },
    ExpectedEntry {
        path: ".fub/data/trash/Deleted.md.json",
        class: EntryClass::TrashSidecar,
        size: 65,
        hash: 0xf28e_82c7_f00c_9446,
        schema: Some(SchemaVersion::new(1)),
    },
    ExpectedEntry {
        path: ".fub/drafts/notes-README.md.json",
        class: EntryClass::Draft,
        size: 97,
        hash: 0xff6f_2ea5_d4eb_c1c9,
        schema: Some(SchemaVersion::new(1)),
    },
    ExpectedEntry {
        path: ".fub/journal.jsonl",
        class: EntryClass::Journal,
        size: 162,
        hash: 0xd0a0_e85b_ca2c_54c8,
        schema: Some(SchemaVersion::new(1)),
    },
    ExpectedEntry {
        path: ".fub/plugins/com.example.archive/index.bin",
        class: EntryClass::PluginBlob,
        size: 15,
        hash: 0xf0d3_cbad_2923_4316,
        schema: None,
    },
    ExpectedEntry {
        path: ".fub/plugins/fub.versioning/doc-archive/1700000000000.md",
        class: EntryClass::VersioningSnapshot,
        size: 45,
        hash: 0xc183_c36d_0afe_c965,
        schema: None,
    },
    ExpectedEntry {
        path: ".fub/plugins/fub.versioning/doc-archive/meta.json",
        class: EntryClass::VersioningMeta,
        size: 47,
        hash: 0x4d55_4be0_a1d8_4398,
        schema: None,
    },
    ExpectedEntry {
        path: ".fub/settings.json",
        class: EntryClass::Settings,
        size: 26,
        hash: 0x1ce3_cd5a_dcdd_0a54,
        schema: Some(SchemaVersion::new(1)),
    },
    ExpectedEntry {
        path: ".fub/workspace.json",
        class: EntryClass::Workspace,
        size: 14,
        hash: 0xd437_e219_016e_1068,
        schema: Some(SchemaVersion::new(1)),
    },
    ExpectedEntry {
        path: ".trash/Deleted.md",
        class: EntryClass::TrashItem,
        size: 47,
        hash: 0xf905_cb1b_8fb0_ffbe,
        schema: None,
    },
    ExpectedEntry {
        path: "attachments/non-utf8.bin",
        class: EntryClass::Binary,
        size: 16,
        hash: 0x07f5_1fcb_0724_8b6b,
        schema: None,
    },
    ExpectedEntry {
        path: "notes/README.md",
        class: EntryClass::Markdown,
        size: 82,
        hash: 0xa156_e6ea_734e_bcdd,
        schema: None,
    },
    ExpectedEntry {
        path: "unknown.data",
        class: EntryClass::Unknown,
        size: 23,
        hash: 0x478d_96e7_997a_0c6d,
        schema: None,
    },
];

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/backup-restore-drill")
}
fn collect_files(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("enumerate {}: {error}", dir.display()))
        .map(|entry| entry.unwrap_or_else(|error| panic!("enumerate {}: {error}", dir.display())))
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let kind = fs::symlink_metadata(&path)
            .unwrap_or_else(|error| panic!("enumerate {}: {error}", path.display()))
            .file_type();
        if kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) {
            panic!("enumerate {}: unsupported entry type", path.display());
        }
        if kind.is_dir() {
            collect_files(root, &path, out);
        } else {
            out.push(
                path.strip_prefix(root)
                    .unwrap_or_else(|error| panic!("enumerate {}: {error}", path.display()))
                    .to_str()
                    .unwrap_or_else(|| panic!("enumerate {}: non-UTF-8 path", path.display()))
                    .replace('\\', "/"),
            );
        }
    }
}

fn class_of(path: &str) -> EntryClass {
    match path {
        ".fub/data/entries.json" => EntryClass::Derived,
        ".fub/data/trash/Deleted.md.json" => EntryClass::TrashSidecar,
        ".fub/drafts/notes-README.md.json" => EntryClass::Draft,
        ".fub/journal.jsonl" => EntryClass::Journal,
        ".fub/plugins/com.example.archive/index.bin" => EntryClass::PluginBlob,
        ".fub/plugins/fub.versioning/doc-archive/1700000000000.md" => {
            EntryClass::VersioningSnapshot
        }
        ".fub/plugins/fub.versioning/doc-archive/meta.json" => EntryClass::VersioningMeta,
        ".fub/settings.json" => EntryClass::Settings,
        ".fub/workspace.json" => EntryClass::Workspace,
        ".trash/Deleted.md" => EntryClass::TrashItem,
        "attachments/non-utf8.bin" => EntryClass::Binary,
        "notes/README.md" => EntryClass::Markdown,
        "unknown.data" => EntryClass::Unknown,
        other => panic!("unclassified fixture path: {other}"),
    }
}

fn schema_value(bytes: &[u8], path: &str) -> Option<SchemaVersion> {
    if path == ".fub/journal.jsonl" {
        return serde_json::from_slice::<serde_json::Value>(
            bytes
                .split(|byte| *byte == b'\n')
                .find(|line| !line.is_empty())
                .unwrap_or(bytes),
        )
        .ok()
        .and_then(|value| value.get("v").and_then(serde_json::Value::as_u64))
        .map(|value| SchemaVersion::new(value as u32));
    }
    serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .and_then(|value| {
            value
                .get("v")
                .or_else(|| value.get("version"))
                .or_else(|| value.get("schema_version"))
                .and_then(serde_json::Value::as_u64)
                .map(|value| SchemaVersion::new(value as u32))
        })
}

fn copy_tree(source: &Path, destination: &Path) {
    let kind = fs::symlink_metadata(source)
        .unwrap_or_else(|error| panic!("capture source {}: {error}", source.display()))
        .file_type();
    if kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) {
        panic!(
            "capture source {}: unsupported entry type",
            source.display()
        );
    }
    if kind.is_dir() {
        fs::create_dir_all(destination).unwrap_or_else(|error| {
            panic!("capture destination {}: {error}", destination.display())
        });
        let mut entries: Vec<_> = fs::read_dir(source)
            .unwrap_or_else(|error| panic!("capture enumerate {}: {error}", source.display()))
            .map(|entry| {
                entry.unwrap_or_else(|error| {
                    panic!("capture enumerate {}: {error}", source.display())
                })
            })
            .collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            copy_tree(&entry.path(), &destination.join(entry.file_name()));
        }
    } else {
        fs::copy(source, destination)
            .unwrap_or_else(|error| panic!("capture file {}: {error}", source.display()));
    }
}

fn collect_manifest(root: &Path) -> Vec<ExpectedEntry> {
    let mut paths = Vec::new();
    collect_files(root, root, &mut paths);
    let expected: BTreeMap<_, _> = ORACLE.iter().map(|entry| (entry.path, entry)).collect();
    assert_eq!(
        paths,
        ORACLE
            .iter()
            .map(|entry| entry.path.to_owned())
            .collect::<Vec<_>>(),
        "capture: paths must stay sorted, unique, and complete"
    );
    paths
        .into_iter()
        .map(|path| {
            let bytes = fs::read(root.join(&path))
                .unwrap_or_else(|error| panic!("capture read {path}: {error}"));
            let entry = expected[path.as_str()];
            let actual = ExpectedEntry {
                path: entry.path,
                class: class_of(&path),
                size: bytes.len() as u64,
                hash: Fnv1a::hash(&bytes),

                schema: schema_value(&bytes, &path),
            };
            assert_eq!(actual, *entry, "capture: oracle mismatch for {path}");
            actual
        })
        .collect()
}
fn validate_after_host(root: &Path, expected: &[ExpectedEntry]) {
    let expected_by_path: BTreeMap<_, _> =
        expected.iter().map(|entry| (entry.path, entry)).collect();

    // Prima si verifica che ogni voce autorevole non derivata sia ancora presente.
    for entry in expected
        .iter()
        .filter(|entry| entry.class != EntryClass::Derived)
    {
        let path = root.join(entry.path);
        assert!(
            path.is_file(),
            "verify: missing expected file {}",
            entry.path
        );
        let bytes =
            fs::read(&path).unwrap_or_else(|error| panic!("verify read {}: {error}", entry.path));
        assert_eq!(bytes.len() as u64, entry.size, "verify size {}", entry.path);
        assert_eq!(
            Fnv1a::hash(&bytes),
            entry.hash,
            "verify hash {}",
            entry.path
        );
        assert_eq!(
            schema_value(&bytes, entry.path),
            entry.schema,
            "verify schema {}",
            entry.path
        );
    }

    let mut paths = Vec::new();
    collect_files(root, root, &mut paths);
    for path in paths {
        if expected_by_path.contains_key(path.as_str()) {
            continue;
        }
        let journal_lock = path == ".fub/.journal.jsonl.lock";
        if journal_lock {
            let lock_file = fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(root.join(&path))
                .unwrap_or_else(|error| panic!("verify open lock {path}: {error}"));
            lock_file
                .try_lock()
                .unwrap_or_else(|error| panic!("verify lock is still held {path}: {error}"));
            continue;
        }
        let allowed_search_manifest = path == ".fub/plugins/fub.search/manifest.json";
        let allowed_search_index = path.starts_with(".fub/plugins/fub.search/index/");
        let allowed_versioning_index = path == ".fub/plugins/fub.versioning/versions.json";
        assert!(
            allowed_search_manifest || allowed_search_index || allowed_versioning_index,
            "verify: unexpected Host output {path}"
        );
    }
}

fn validate_manifest(root: &Path, expected: &[ExpectedEntry]) {
    let actual = collect_manifest(root);
    assert_eq!(
        actual,
        expected,
        "validate: manifest mismatch at {}",
        root.display()
    );
}
fn validate_restore_manifest(
    root: &Path,
    expected: &[ExpectedEntry],
    phase: &str,
) -> Result<(), String> {
    for entry in expected {
        let path = root.join(entry.path);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(format!(
                    "{phase} {}: missing authoritative entry",
                    entry.path
                ));
            }
            Err(error) => return Err(format!("{phase} {}: read failed: {error}", entry.path)),
        };
        let actual = Fnv1a::hash(&bytes);
        if actual != entry.hash {
            return Err(format!(
                "{phase} {}: hash mismatch (expected {:#018x}, actual {:#018x})",
                entry.path, entry.hash, actual
            ));
        }
        if bytes.len() as u64 != entry.size {
            return Err(format!(
                "{phase} {}: size mismatch (expected {}, actual {})",
                entry.path,
                entry.size,
                bytes.len()
            ));
        }
    }
    Ok(())
}

fn restore_artifact(
    artifact: &Path,
    destination: &Path,
    expected: &[ExpectedEntry],
) -> Result<(), String> {
    validate_restore_manifest(artifact, expected, "validate artifact")?;
    let staging = destination.with_file_name(format!(
        "{}.staging",
        destination
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!(
                "stage {}: destination has no UTF-8 name",
                destination.display()
            ))?
    ));
    copy_tree(artifact, &staging);
    validate_restore_manifest(&staging, expected, "validate staging")?;
    if destination.exists() {
        return Err(format!(
            "publish {}: destination already exists; staging remains at {}",
            destination.display(),
            staging.display()
        ));
    }
    fs::rename(&staging, destination).map_err(|error| {
        format!(
            "publish {} -> {}: {error}",
            staging.display(),
            destination.display()
        )
    })?;
    Ok(())
}

#[test]
fn backup_restore_drill_captures_publishes_and_opens_cleanly() {
    let fixture = fixture_root();
    let source_area = TempDir::new().expect("capture: source tempdir");
    let source = source_area.path().join("source");
    copy_tree(&fixture, &source);

    let artifact_area = TempDir::new().expect("capture: artifact tempdir");
    let artifact = artifact_area.path().join("backup");
    copy_tree(&source, &artifact);
    let oracle = collect_manifest(&source);
    validate_manifest(&artifact, &oracle);

    let destination_area = TempDir::new().expect("stage: destination tempdir");
    let destination = destination_area.path().join("restored");
    restore_artifact(&artifact, &destination, &oracle)
        .unwrap_or_else(|error| panic!("restore failed: {error}"));
    assert!(
        !destination.with_file_name("restored.staging").exists(),
        "publish: staging remains after rename"
    );
    validate_manifest(&destination, &oracle);
    let host = Host::new().with_watcher(Box::new(NoWatcher));

    host.open(
        &camino::Utf8PathBuf::from_path_buf(destination.clone())
            .expect("verify: destination path is UTF-8"),
    )
    .unwrap_or_else(|error| panic!("verify open {}: {error}", destination.display()));
    host.wait_indexed(None)
        .unwrap_or_else(|error| panic!("verify index {}: {error}", destination.display()));
    let (document, _) = host
        .read_document(None, &DocId::new("notes/README.md"))
        .unwrap_or_else(|error| panic!("verify document read: {error}"));
    assert_eq!(
        document,
        "# Backup restore drill\n\nA deterministic Markdown document for the backup fixture.\n"
    );
    let workspace = host
        .debug_workspace(None)
        .expect("verify: workspace is open");
    assert!(
        workspace
            .read()
            .expect("verify workspace lock")
            .documents()
            .contains(&DocId::new("notes/README.md")),
        "verify: document is indexed"
    );
    for path in [
        "attachments/non-utf8.bin",
        "unknown.data",
        ".trash/Deleted.md",
        ".fub/plugins/com.example.archive/index.bin",
    ] {
        let expected = fs::read(destination.join(path))
            .unwrap_or_else(|error| panic!("verify bytes {path}: {error}"));
        assert_eq!(
            expected,
            fs::read(artifact.join(path))
                .unwrap_or_else(|error| panic!("verify artifact bytes {path}: {error}")),
            "verify bytes {path}"
        );
    }
    let close_errors = host.close();
    assert!(
        close_errors.is_empty(),
        "verify close errors: {close_errors:?}"
    );
    validate_after_host(&destination, &oracle);
}
#[test]
fn backup_restore_drill_rejects_corrupt_artifact_without_mutation() {
    let source_area = TempDir::new().expect("capture: source tempdir");
    let source = source_area.path().join("source");
    copy_tree(&fixture_root(), &source);
    let oracle = collect_manifest(&source);

    let artifact_area = TempDir::new().expect("capture: artifact tempdir");
    let artifact = artifact_area.path().join("backup");
    copy_tree(&source, &artifact);
    let corrupt_path = artifact.join("attachments/non-utf8.bin");
    let mut bytes = fs::read(&corrupt_path).expect("corrupt: read blob");
    bytes[0] ^= 0xff;
    fs::write(&corrupt_path, &bytes).expect("corrupt: write blob");

    let destination_area = TempDir::new().expect("stage: destination tempdir");
    let destination = destination_area.path().join("restored");
    let sentinel = b"destination sentinel";
    fs::write(&destination, sentinel).expect("publish: write sentinel");
    let error = restore_artifact(&artifact, &destination, &oracle).expect_err("corrupt accepted");
    assert!(error.contains("validate artifact"));
    assert!(error.contains("attachments/non-utf8.bin"));
    assert!(error.contains("expected") && error.contains("actual"));
    assert_eq!(
        fs::read(&destination).expect("publish: read sentinel"),
        sentinel
    );
    assert!(!destination.with_file_name("restored.staging").exists());
}

#[test]
fn backup_restore_drill_rejects_missing_artifact_without_mutation() {
    let source_area = TempDir::new().expect("capture: source tempdir");
    let source = source_area.path().join("source");
    copy_tree(&fixture_root(), &source);
    let oracle = collect_manifest(&source);

    let artifact_area = TempDir::new().expect("capture: artifact tempdir");
    let artifact = artifact_area.path().join("backup");
    copy_tree(&source, &artifact);
    fs::remove_file(artifact.join("unknown.data")).expect("missing: remove authoritative entry");

    let destination_area = TempDir::new().expect("stage: destination tempdir");
    let destination = destination_area.path().join("restored");
    let sentinel = b"destination sentinel";
    fs::write(&destination, sentinel).expect("publish: write sentinel");
    let error = restore_artifact(&artifact, &destination, &oracle).expect_err("missing accepted");
    assert!(error.contains("validate artifact"));
    assert!(error.contains("unknown.data"));
    assert!(error.contains("missing"));
    assert_eq!(
        fs::read(&destination).expect("publish: read sentinel"),
        sentinel
    );
    assert!(!destination.with_file_name("restored.staging").exists());
}

#[test]
fn backup_restore_drill_rejects_occupied_destination_and_keeps_staging() {
    let source_area = TempDir::new().expect("capture: source tempdir");
    let source = source_area.path().join("source");
    copy_tree(&fixture_root(), &source);
    let oracle = collect_manifest(&source);

    let artifact_area = TempDir::new().expect("capture: artifact tempdir");
    let artifact = artifact_area.path().join("backup");
    copy_tree(&source, &artifact);

    let destination_area = TempDir::new().expect("stage: destination tempdir");
    let destination = destination_area.path().join("restored");
    let sentinel = b"destination sentinel";
    fs::write(&destination, sentinel).expect("publish: write sentinel");
    let error = restore_artifact(&artifact, &destination, &oracle).expect_err("occupied accepted");
    assert!(error.contains("publish"));
    assert!(error.contains("already exists"));
    assert_eq!(
        fs::read(&destination).expect("publish: read sentinel"),
        sentinel
    );
    let staging = destination.with_file_name("restored.staging");
    assert!(staging.is_dir(), "publish: staging must remain complete");
    validate_manifest(&staging, &oracle);
}

#[test]
fn backup_restore_drill_fixture_matches_the_independent_oracle() {
    let root = fixture_root();
    let mut paths = Vec::new();
    collect_files(&root, &root, &mut paths);
    let expected_paths: Vec<_> = ORACLE.iter().map(|entry| entry.path).collect();
    assert_eq!(
        paths, expected_paths,
        "fixture paths must stay sorted, unique, and complete"
    );

    let expected: BTreeMap<_, _> = ORACLE.iter().map(|entry| (entry.path, entry)).collect();
    let mut saw_non_utf8 = false;
    for path in paths {
        let entry = expected[path.as_str()];
        let bytes = fs::read(root.join(&path)).expect("fixture file reads");
        assert_eq!(class_of(&path), entry.class, "class changed for {path}");
        assert_eq!(bytes.len() as u64, entry.size, "size changed for {path}");
        assert_eq!(Fnv1a::hash(&bytes), entry.hash, "FNV-1a changed for {path}");
        assert_eq!(
            schema_value(&bytes, &path),
            entry.schema,
            "schema changed for {path}"
        );
        if path == "attachments/non-utf8.bin" {
            saw_non_utf8 = std::str::from_utf8(&bytes).is_err();
        }
    }
    assert!(
        saw_non_utf8,
        "the binary attachment must really not be UTF-8"
    );
}
