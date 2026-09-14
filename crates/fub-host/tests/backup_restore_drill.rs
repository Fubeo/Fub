//! Fixture versionata e manifesto autorevole per il backup/restore drill.
//!
//! Il manifesto qui sotto è intenzionalmente scritto a mano: la scansione del
//! fixture può solo essere confrontata con esso, non può contribuire a crearlo.

use fub_abi::{Fnv1a, SchemaVersion};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

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
        .expect("fixture directory reads")
        .map(Result::unwrap)
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, out);
        } else {
            out.push(
                path.strip_prefix(root)
                    .unwrap()
                    .to_str()
                    .unwrap()
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
