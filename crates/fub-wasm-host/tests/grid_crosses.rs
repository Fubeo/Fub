//! Grid protocol end-to-end: native and WASM providers share one SheetSession.

mod common;

use camino::Utf8PathBuf;
use fub_abi::grid::{
    GridApplyRequest, GridCellKey, GridCellPatch, GridProvider, GridWindowRequest,
};
use fub_abi::Revision;
use fub_format_sheet::grid::{SheetGridProvider, SHEET_GRID_SURFACE};
use fub_host::Host;
use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;
use std::sync::Arc;
const SOURCE: &str = r#"{"version":1,"sheets":[{"id":"s","name":"Foglio","rows":[{"id":"r1"},{"id":"r2"}],"columns":[{"id":"c1"},{"id":"c2"}],"cells":[{"row":"r1","column":"c1","input":"1"},{"row":"r1","column":"c2","input":"=A1+2"}]}]}"#;
const RELOADED: &str = r#"{"version":1,"sheets":[{"id":"s","name":"Foglio","rows":[{"id":"r1"},{"id":"r2"}],"columns":[{"id":"c1"},{"id":"c2"}],"cells":[{"row":"r1","column":"c1","input":"9"},{"row":"r1","column":"c2","input":"=A1+2"}]}]}"#;
const WASM_GRID_SURFACE: &str = "example.grid:sheet";

fn wasm_grid(feature: &str) -> Result<Box<dyn GridProvider>, String> {
    let wasm = common::component("grid-wasm", "grid_wasm", feature);
    let bundle =
        WasmBundle::from_file(&wasm, Trust::Community).map_err(|error| error.to_string())?;
    bundle
        .grid_provider()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "grid export missing".to_owned())
}

fn patch_request(revision: Revision, after: &str) -> GridApplyRequest {
    GridApplyRequest {
        revision,
        patches: vec![GridCellPatch {
            cell: GridCellKey {
                sheet: "s".to_owned(),
                row: "r1".to_owned(),
                column: "c1".to_owned(),
            },
            before: Some("1".to_owned()),
            after: after.to_owned(),
        }],
    }
}

#[test]
fn native_and_wasm_grid_have_protocol_parity_and_clean_lifecycle() {
    let mut native = SheetGridProvider::new();
    let mut wasm = wasm_grid("").expect("real grid component loads");
    let revision = Revision::of(SOURCE);

    let native_surfaces = native.surfaces();
    let wasm_surfaces = wasm.surfaces();
    assert_eq!(native_surfaces.len(), wasm_surfaces.len());
    assert_eq!(native_surfaces[0].id, SHEET_GRID_SURFACE);
    assert_eq!(wasm_surfaces[0].id, WASM_GRID_SURFACE);
    assert_eq!(native_surfaces[0].format, wasm_surfaces[0].format);
    assert_eq!(native_surfaces[0].family, wasm_surfaces[0].family);
    assert_eq!(
        native_surfaces[0].protocol_version,
        wasm_surfaces[0].protocol_version
    );
    let native_open = native
        .open(SHEET_GRID_SURFACE, SOURCE, revision.clone())
        .expect("native open");
    let wasm_open = wasm
        .open(WASM_GRID_SURFACE, SOURCE, revision.clone())
        .expect("wasm open");

    let window_request = GridWindowRequest {
        revision: revision.clone(),
        sheet: "s".to_owned(),
        row_start: 0,
        row_count: 2,
        column_start: 0,
        column_count: 2,
    };
    assert_eq!(
        native
            .window(&native_open.instance, window_request.clone())
            .expect("native window"),
        wasm.window(&wasm_open.instance, window_request)
            .expect("wasm window")
    );

    let native_commit = native
        .apply(&native_open.instance, patch_request(revision.clone(), "3"))
        .expect("native apply");
    let wasm_commit = wasm
        .apply(&wasm_open.instance, patch_request(revision.clone(), "3"))
        .expect("wasm apply");
    assert_eq!(native_commit, wasm_commit);

    let native_reloaded = native
        .reload(
            &native_open.instance,
            native_commit.revision.clone(),
            RELOADED,
            Revision::of(RELOADED),
        )
        .expect("native reload");
    let wasm_reloaded = wasm
        .reload(
            &wasm_open.instance,
            wasm_commit.revision.clone(),
            RELOADED,
            Revision::of(RELOADED),
        )
        .expect("wasm reload");
    assert_eq!(native_reloaded, wasm_reloaded);

    let native_second = native
        .open(SHEET_GRID_SURFACE, SOURCE, Revision::of(SOURCE))
        .expect("native second open");
    let wasm_second = wasm
        .open(WASM_GRID_SURFACE, SOURCE, Revision::of(SOURCE))
        .expect("wasm second open");
    assert_eq!(native_second, wasm_second);

    native.close(&native_open.instance).expect("native close");
    wasm.close(&wasm_open.instance).expect("wasm close");
    native.shutdown().expect("native shutdown");
    wasm.shutdown().expect("wasm shutdown");

    assert!(native
        .window(
            &native_second.instance,
            GridWindowRequest {
                revision: Revision::of(SOURCE),
                sheet: "s".to_owned(),
                row_start: 0,
                row_count: 1,
                column_start: 0,
                column_count: 1,
            }
        )
        .is_err());
    assert!(wasm
        .window(
            &wasm_second.instance,
            GridWindowRequest {
                revision: Revision::of(SOURCE),
                sheet: "s".to_owned(),
                row_start: 0,
                row_count: 1,
                column_start: 0,
                column_count: 1,
            }
        )
        .is_err());
}
#[test]
fn real_grid_bundle_mounts_and_publishes_a_namespaced_surface() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 path");
    std::fs::write(root.join("note.md"), "# Grid\n").expect("seed vault");
    let host = Host::without_watcher().with_job_threads(1);
    host.open(&root).expect("vault opens");
    host.wait_indexed(None).expect("indexing finishes");
    let native_surfaces = host.grid_surfaces(None).expect("native grid registry");
    assert_eq!(native_surfaces.len(), 1);
    assert_eq!(native_surfaces[0].id, SHEET_GRID_SURFACE);

    let bundle =
        WasmBundle::from_file(&common::grid(), Trust::Community).expect("grid component loads");
    host.mount_bundle(None, Arc::new(bundle))
        .expect("grid bundle mounts through Bundle/Registrar");

    let inventory = host
        .bundles(None)
        .expect("bundle inventory")
        .into_iter()
        .find(|bundle| bundle.id == "example.grid")
        .expect("grid bundle is in the registry");
    assert!(inventory.mounted);
    let surfaces = host.grid_surfaces(None).expect("grid registry");
    assert_eq!(surfaces.len(), 2);
    assert!(surfaces
        .iter()
        .any(|surface| surface.id == SHEET_GRID_SURFACE));
    let wasm_surface = surfaces
        .iter()
        .find(|surface| surface.id == WASM_GRID_SURFACE)
        .expect("WASM grid surface is registered");
    assert_eq!(wasm_surface.family, "grid");
    assert_eq!(wasm_surface.protocol_version, 1);

    let opened = host
        .grid_open(None, WASM_GRID_SURFACE, SOURCE, Revision::of(SOURCE))
        .expect("mounted provider opens a session");
    assert_eq!(opened.sheets[0].id, "s");
    let window = host
        .grid_window(
            None,
            WASM_GRID_SURFACE,
            &opened.instance,
            GridWindowRequest {
                revision: Revision::of(SOURCE),
                sheet: "s".into(),
                row_start: 0,
                row_count: 2,
                column_start: 0,
                column_count: 2,
            },
        )
        .expect("mounted provider serves a window");
    assert_eq!(window.cells.len(), 2);
    host.grid_close(None, WASM_GRID_SURFACE, &opened.instance)
        .expect("grid session closes");
    assert!(host
        .unmount_bundle(None, "example.grid")
        .expect("bundle unmounts")
        .is_empty());
    assert!(host.close().is_empty());
}

#[test]
fn unknown_grid_family_is_an_optional_binding_and_traps_stay_errors() {
    let wasm = common::component("grid-wasm", "grid_wasm", "incompatible-grid");
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("component loads");
    assert!(bundle
        .grid_provider()
        .expect("unknown Grid family is ignored")
        .is_none());
    let mut malformed = wasm_grid("malformed-window").expect("malformed component loads");
    let malformed_open = malformed
        .open(WASM_GRID_SURFACE, SOURCE, Revision::of(SOURCE))
        .expect("open before malformed response");
    let error = malformed
        .window(
            &malformed_open.instance,
            GridWindowRequest {
                revision: Revision::of(SOURCE),
                sheet: "s".to_owned(),
                row_start: 0,
                row_count: 1,
                column_start: 0,
                column_count: 1,
            },
        )
        .expect_err("contextually malformed guest response is rejected");
    assert!(error
        .to_string()
        .contains("malformed grid provider response"));
    malformed
        .shutdown()
        .expect("teardown after malformed response");

    let mut trapped = wasm_grid("trap-on-window").expect("trap component loads");
    let opened = trapped
        .open(WASM_GRID_SURFACE, SOURCE, Revision::of(SOURCE))
        .expect("open before trap");
    let error = trapped
        .window(
            &opened.instance,
            GridWindowRequest {
                revision: Revision::of(SOURCE),
                sheet: "s".to_owned(),
                row_start: 0,
                row_count: 1,
                column_start: 0,
                column_count: 1,
            },
        )
        .expect_err("guest trap is recoverable as a provider error");
    assert!(error.to_string().contains("componente è caduto"));
    let _ = trapped.shutdown();
}
