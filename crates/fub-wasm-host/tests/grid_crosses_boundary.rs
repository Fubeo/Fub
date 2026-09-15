//! Il provider grid reale attraversa il component model e passa la stessa suite
//! usata dal provider nativo.

mod common;

use fub_abi::grid::GridCellKey;
use fub_kernel::Trust;
use fub_sdk::testing::conformance::{a_grid_supports_the_lifecycle, GridLifecycleFixture};
use fub_wasm_host::WasmBundle;

#[test]
fn a_wasm_grid_passes_the_shared_lifecycle() {
    fn is_replacement(source: &str) -> bool {
        source == "dopo"
    }

    let wasm = common::component("grid-wasm", "grid_wasm", "");
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("grid component loads");
    let mut provider = bundle
        .grid_provider()
        .expect("grid provider prepares")
        .expect("grid export exists");

    a_grid_supports_the_lifecycle(
        provider.as_mut(),
        GridLifecycleFixture {
            surface: "example.grid:sheet",
            source: "prima",
            input: "prima",
            replacement: "dopo",
            cell: GridCellKey {
                sheet: "sheet-1".into(),
                row: "row-1".into(),
                column: "column-1".into(),
            },
            serialized_matches: is_replacement,
        },
    );
}
