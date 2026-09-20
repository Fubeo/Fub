use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(path: &str) -> String {
    fs::read_to_string(root().join(path))
        .unwrap_or_else(|error| panic!("cannot read {path}: {error}"))
}

fn collect_family_constants(dir: &Path, found: &mut BTreeSet<String>) {
    for entry in fs::read_dir(dir).expect("read abi source directory") {
        let entry = entry.expect("read abi source entry");
        let path = entry.path();
        if path.is_dir() {
            collect_family_constants(&path, found);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("rs") {
            continue;
        }
        let source = fs::read_to_string(&path).expect("read abi source");
        for line in source.lines() {
            let line = line.trim();
            if !line.starts_with("pub const ") || !line.contains("_FAMILY:") {
                continue;
            }
            let Some((_, value)) = line.split_once('=') else {
                continue;
            };
            let value = value.trim().trim_end_matches(';').trim();
            if let Some(family) = value
                .strip_prefix('"')
                .and_then(|value| value.strip_suffix('"'))
            {
                found.insert(family.to_string());
            }
        }
    }
}

#[test]
fn every_public_surface_family_has_shell_fallback_mirror_native_and_wasm() {
    let mut published = BTreeSet::new();
    collect_family_constants(&root().join("crates/fub-abi/src"), &mut published);

    let delivered = BTreeMap::from([(
        "grid",
        [
            (
                "shell",
                "apps/client/src/editors/core/bootstrap.ts",
                "owner: \"fub.shell.grid\"",
            ),
            (
                "fallback",
                "apps/client/src/editors/grid/engine.ts",
                "dataset.gridProtocol = \"fallback\"",
            ),
            (
                "mirror",
                "apps/client/src/host/contract.ts",
                "export interface GridSurfaceSpec",
            ),
            (
                "native",
                "crates/fub-host/src/sheet.rs",
                "impl fub_abi::grid::GridProvider for SheetGridProvider",
            ),
            (
                "wasm",
                "crates/fub-wasm-host/tests/grid_crosses.rs",
                "native_and_wasm_grid_have_protocol_parity_and_clean_lifecycle",
            ),
        ],
    )]);

    let expected: BTreeSet<_> = delivered.keys().map(|family| family.to_string()).collect();
    assert_eq!(
        published, expected,
        "a public *_FAMILY was added or removed without updating its shell/fallback/mirror/native/WASM delivery guard"
    );

    for (family, evidence) in delivered {
        for (leg, path, marker) in evidence {
            let source = read(path);
            assert!(
                source.contains(marker),
                "public family {family} is missing its {leg} leg: {path} no longer contains {marker:?}"
            );
        }
    }

    assert!(
        read("crates/fub-abi/wit/fub/abi.wit").contains("interface grid"),
        "public family grid must remain represented in the live WIT"
    );
    assert!(
        read("apps/client/src/host/mirror.test.ts")
            .contains("GridSurfaceSpec: keysOf<GridSurfaceSpec>"),
        "public family grid must remain covered by the TypeScript mirror guard"
    );
}
