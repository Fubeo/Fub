//! Grid protocol end-to-end: native and WASM providers share one SheetSession.

mod common;

use fub_abi::grid::{
    GridApplyRequest, GridCellKey, GridCellPatch, GridProvider, GridWindowRequest,
};
use fub_abi::Revision;
use fub_host::sheet::{SheetGridProvider, SHEET_GRID_SURFACE};
use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;
const SOURCE: &str = r#"{"version":1,"sheets":[{"id":"s","name":"Foglio","rows":[{"id":"r1"},{"id":"r2"}],"columns":[{"id":"c1"},{"id":"c2"}],"cells":[{"row":"r1","column":"c1","input":"1"},{"row":"r1","column":"c2","input":"=A1+2"}]}]}"#;
const RELOADED: &str = r#"{"version":1,"sheets":[{"id":"s","name":"Foglio","rows":[{"id":"r1"},{"id":"r2"}],"columns":[{"id":"c1"},{"id":"c2"}],"cells":[{"row":"r1","column":"c1","input":"9"},{"row":"r1","column":"c2","input":"=A1+2"}]}]}"#;

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

    assert_eq!(native.surfaces(), wasm.surfaces());
    let native_open = native
        .open(SHEET_GRID_SURFACE, SOURCE, revision.clone())
        .expect("native open");
    let wasm_open = wasm
        .open(SHEET_GRID_SURFACE, SOURCE, revision.clone())
        .expect("wasm open");
    assert_eq!(native_open, wasm_open);

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
        .open(SHEET_GRID_SURFACE, SOURCE, Revision::of(SOURCE))
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
fn unknown_grid_family_is_rejected_before_open_and_traps_become_fallback_errors() {
    let wasm = common::component("grid-wasm", "grid_wasm", "incompatible-grid");
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("component loads");
    let error = match bundle.grid_provider() {
        Ok(_) => panic!("unknown family was accepted"),
        Err(error) => error.to_string(),
    };
    assert!(error.contains("unsupported grid family or protocol version"));
    let mut malformed = wasm_grid("malformed-window").expect("malformed component loads");
    let malformed_open = malformed
        .open(SHEET_GRID_SURFACE, SOURCE, Revision::of(SOURCE))
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
        .open(SHEET_GRID_SURFACE, SOURCE, Revision::of(SOURCE))
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
