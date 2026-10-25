//! Grid v2 end-to-end: a real component serves `grid-bytes`, and the host
//! opens it on a document's bytes through the same registry and checks as a
//! native provider.

mod common;

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::grid::{GridApplyRequest, GridCellKey, GridCellPatch, GridWindowRequest};
use fub_abi::model::DocId;
use fub_abi::{grid_bytes_revision, GridBytesProvider, GridJournal, PluginError, Revision};
use fub_host::Host;
use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;

const SURFACE: &str = "example.grid:lines";
const SOURCE: &[u8] = b"uno\ndue\ntre";

fn provider() -> Box<dyn GridBytesProvider> {
    WasmBundle::from_file(&common::grid(), Trust::Community)
        .expect("grid component loads")
        .grid_bytes_provider()
        .expect("grid-bytes declared")
        .expect("grid-bytes export present")
}

fn key(row: u32) -> GridCellKey {
    GridCellKey {
        sheet: "lines".into(),
        row: format!("r{row}"),
        column: "c0".into(),
    }
}

fn window(row_count: u32, revision: &Revision) -> GridWindowRequest {
    GridWindowRequest {
        revision: revision.clone(),
        sheet: "lines".into(),
        row_start: 0,
        row_count,
        column_start: 0,
        column_count: 1,
    }
}

#[test]
fn the_journal_crosses_the_component_and_the_bytes_come_back_grafted() {
    let mut grid = provider();
    let surfaces = grid.surfaces();
    assert_eq!(surfaces.len(), 1);
    assert_eq!(
        (surfaces[0].id.as_str(), surfaces[0].protocol_version),
        (SURFACE, 2)
    );
    let revision = Revision::of_bytes(SOURCE);
    let session = grid
        .open(SURFACE, SOURCE, revision.clone(), &GridJournal::new())
        .expect("opens on the bytes");
    assert_eq!(session.revision, grid_bytes_revision(&revision, ""));
    assert_eq!(session.notices[0].code, "lines");

    let cells = grid
        .window(&session.instance, window(4, &session.revision))
        .expect("window")
        .cells;
    let inputs: Vec<_> = cells.iter().map(|cell| cell.input.as_str()).collect();
    assert_eq!(inputs, ["uno", "due", "tre"]);

    let commit = grid
        .apply(
            &session.instance,
            GridApplyRequest {
                revision: session.revision.clone(),
                patches: vec![GridCellPatch {
                    cell: key(1),
                    before: Some("due".into()),
                    after: "DUE".into(),
                }],
            },
        )
        .expect("the patch enters the journal");
    let journal = GridJournal::parse(&commit.edit.inserted).expect("canonical journal");
    assert_eq!(journal.get(&key(1)), Some(("due", "DUE")));
    assert_eq!(
        commit.revision,
        grid_bytes_revision(&revision, &commit.edit.inserted)
    );
    // A stale preimage is a conflict, as on the native side.
    let stale = grid.apply(
        &session.instance,
        GridApplyRequest {
            revision: commit.revision.clone(),
            patches: vec![GridCellPatch {
                cell: key(1),
                before: Some("due".into()),
                after: "Due".into(),
            }],
        },
    );
    assert!(matches!(stale, Err(PluginError::Conflict(_))), "{stale:?}");

    let bytes = grid
        .bytes_to_write(&session.instance, commit.revision.clone())
        .expect("grafted bytes");
    assert_eq!(bytes, b"uno\nDUE\ntre");
    grid.close(&session.instance).expect("closes");
    assert!(grid.close(&session.instance).is_err());

    // The same journal on other bytes is a conflict the window shows.
    let other = b"uno\naltro\ntre";
    let reopened = grid
        .open(SURFACE, other, Revision::of_bytes(other), &journal)
        .expect("opens with a conflict");
    assert_eq!(reopened.conflicts, vec![key(1)]);
    let cells = grid
        .window(&reopened.instance, window(2, &reopened.revision))
        .unwrap()
        .cells;
    assert!(cells[1].conflict && cells[1].input == "DUE");
    grid.shutdown().expect("shutdown");
}

#[test]
fn a_mounted_component_serves_the_host_bytes_port() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 path");
    std::fs::write(root.join("note.md"), SOURCE).expect("seed vault");
    let host = Host::without_watcher().with_job_threads(1);
    host.open(&root).expect("vault opens");
    host.wait_indexed(None).expect("indexing finishes");
    let bundle =
        WasmBundle::from_file(&common::grid(), Trust::Community).expect("grid component loads");
    host.mount_bundle(None, Arc::new(bundle))
        .expect("grid bundle mounts");
    let surface = host
        .grid_surfaces(None)
        .unwrap()
        .into_iter()
        .find(|surface| surface.id == SURFACE)
        .expect("the v2 surface is registered");
    assert_eq!(surface.protocol_version, 2);
    // The v1 port does not call a v2 surface.
    assert!(matches!(
        host.grid_open(None, SURFACE, "x", Revision::of("x")),
        Err(PluginError::Unserved(_))
    ));

    let doc = DocId::new("note.md");
    let (_, revision) = host.read_document(None, &doc).unwrap();
    let session = host
        .grid_bytes_open(None, SURFACE, &doc, "", Revision::of_bytes(SOURCE))
        .expect("the host reads the bytes and opens the component");
    assert_eq!(revision, Revision::of(std::str::from_utf8(SOURCE).unwrap()));
    let window = host
        .grid_bytes_window(
            None,
            SURFACE,
            &session.instance,
            window(3, &session.revision),
        )
        .expect("window through the kernel checks");
    assert_eq!(window.cells.len(), 3);
    host.grid_bytes_close(None, SURFACE, &session.instance)
        .expect("closes");
    assert!(host
        .unmount_bundle(None, "example.grid")
        .expect("bundle unmounts")
        .is_empty());
    assert!(matches!(
        host.grid_bytes_open(None, SURFACE, &doc, "", Revision::of_bytes(SOURCE)),
        Err(PluginError::Unserved(_))
    ));
    assert!(host.close().is_empty());
}

#[test]
fn the_component_follows_the_shared_v2_lifecycle() {
    fub_sdk::testing::conformance::a_grid_bytes_provider_supports_the_lifecycle(
        provider().as_mut(),
        fub_sdk::testing::conformance::GridBytesLifecycleFixture {
            surface: SURFACE,
            source: SOURCE,
            cell: key(0),
            input: "uno",
            replacement: "UNO",
            saved_matches: |saved| saved == b"UNO\ndue\ntre",
        },
    );
}
