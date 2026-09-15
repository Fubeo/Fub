use fub_abi::grid::{
    GridApplyRequest, GridCellKey, GridCellPatch, GridCellSnapshot, GridCellValue,
    GridInvalidation, GridWindowRequest, GRID_PROTOCOL_VERSION,
};
use fub_abi::{PluginError, Revision};
use fub_host::registry::{Bundle, BundleError, OnlyProviders, Registrar};
use fub_host::sheet::{SheetGridProvider, SHEET_GRID_SURFACE};
use fub_kernel::Trust;
use fub_testkit::{Bench, Mounted};

const SHEET_SOURCE: &str = r#"{
  "version": 1,
  "sheets": [
    {
      "id": "sheet-1",
      "name": "Budget",
      "rows": [{ "id": "row-1" }],
      "columns": [{ "id": "column-a" }, { "id": "column-b" }],
      "cells": [
        { "row": "row-1", "column": "column-a", "input": "2" },
        { "row": "row-1", "column": "column-b", "input": "=A1*3" }
      ]
    }
  ]
}
"#;

fn vault() -> Mounted {
    Bench::new().mounts()
}

struct GridBundle(&'static str);

impl Bundle for GridBundle {
    fn manifest(&self) -> fub_abi::traits::PluginManifest {
        fub_abi::traits::PluginManifest::core(self.0, self.0)
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn fub_abi::traits::Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        registrar
            .register_grid_provider(Box::new(SheetGridProvider::new()))
            .err()
            .map(|error| vec![format!("grid: {error}")])
            .unwrap_or_default()
    }
}

#[test]
fn duplicate_grid_surface_ids_are_rejected_atomically_and_withdrawn() {
    const SURFACE: &str = SHEET_GRID_SURFACE;
    let mut ws = vault();
    let mut registry = fub_host::BundleRegistry::new();
    let first = GridBundle("test.grid.first");
    let second = GridBundle("test.grid.second");

    registry
        .mount(&first, &mut ws)
        .expect("first grid provider mounts");
    assert_eq!(registry.ids(), vec!["test.grid.first"]);
    assert_eq!(
        ws.grid_surfaces()
            .into_iter()
            .map(|surface| surface.id)
            .collect::<Vec<_>>(),
        vec![SURFACE],
    );

    let error = registry
        .mount(&second, &mut ws)
        .expect_err("a second provider cannot claim the same surface");
    assert!(matches!(error, BundleError::Registration { .. }));
    assert_eq!(registry.ids(), vec!["test.grid.first"]);
    assert_eq!(
        ws.grid_surfaces()
            .into_iter()
            .map(|surface| surface.id)
            .collect::<Vec<_>>(),
        vec![SURFACE],
        "the rejected provider did not replace or partially publish the incumbent",
    );

    let teardown = registry.unmount(&mut ws, "test.grid.first");
    assert!(
        teardown.is_empty(),
        "grid provider teardown failed: {teardown:?}"
    );
    assert!(registry.ids().is_empty());
    assert!(
        ws.grid_surfaces().is_empty(),
        "surface was withdrawn after unmount"
    );
    assert!(
        ws.prepare_grid_call(SURFACE).is_err(),
        "provider is no longer routable"
    );
}

#[test]
fn host_native_sheet_grid_completes_open_window_guarded_commit_reload_close() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 root");
    let source_path = root.join("budget.fubsheet");
    std::fs::write(&source_path, SHEET_SOURCE).expect("write workbook source");

    let host = fub_host::Host::new().with_watcher(Box::new(fub_host::NoWatcher));
    host.open(&root).expect("host opens the workbook vault");
    host.wait_indexed(None).expect("indexing completes");

    let surfaces = host.grid_surfaces(None).expect("grid discovery succeeds");
    assert_eq!(surfaces.len(), 1);
    assert_eq!(surfaces[0].id, SHEET_GRID_SURFACE);
    assert_eq!(surfaces[0].format, fub_format_sheet::FORMAT_ID);
    assert_eq!(surfaces[0].protocol_version, GRID_PROTOCOL_VERSION);

    let document = fub_abi::model::DocId::new("budget.fubsheet");
    let (source, revision) = host
        .read_document(None, &document)
        .expect("source-only workbook is readable");
    assert_eq!(source, SHEET_SOURCE);

    let opened = host
        .grid_open(None, SHEET_GRID_SURFACE, &source, revision)
        .expect("native sheet opens the workbook");
    assert_eq!(opened.sheets.len(), 1);
    assert_eq!(opened.sheets[0].id, "sheet-1");

    let request = GridWindowRequest {
        sheet: "sheet-1".into(),
        row_start: 0,
        row_count: 1,
        column_start: 0,
        column_count: 2,
    };
    let before_window = host
        .grid_window(None, SHEET_GRID_SURFACE, &opened.instance, request.clone())
        .expect("window opens");
    let before = before_window
        .cells
        .iter()
        .find(|cell| cell.key.column == "column-a")
        .expect("the edited cell is in the window")
        .snapshot
        .clone();
    assert_eq!(before.input, "2");

    let after = GridCellSnapshot {
        input: "7".into(),
        style: before.style.clone(),
    };
    let commit = host
        .grid_apply(
            None,
            SHEET_GRID_SURFACE,
            &opened.instance,
            GridApplyRequest {
                patches: vec![GridCellPatch {
                    cell: GridCellKey {
                        sheet: "sheet-1".into(),
                        row: "row-1".into(),
                        column: "column-a".into(),
                    },
                    before: Some(before),
                    after: Some(after),
                }],
            },
        )
        .expect("guarded patch commits");
    assert!(matches!(commit.invalidation, GridInvalidation::Cells(_)));

    let (changed_source, _) = commit
        .edit
        .apply_to(&source)
        .expect("GridCommit.edit applies to its guarded source");
    let changed_json: serde_json::Value =
        serde_json::from_str(&changed_source).expect("committed source remains workbook JSON");
    assert_eq!(
        changed_json.pointer("/sheets/0/cells/0/input"),
        Some(&serde_json::Value::String("7".into())),
    );
    std::fs::write(&source_path, &changed_source).expect("persist GridCommit.edit source");

    let reloaded = host
        .grid_reload(
            None,
            SHEET_GRID_SURFACE,
            &opened.instance,
            &changed_source,
            Revision::of(&changed_source),
        )
        .expect("reload accepts the committed source");
    assert_eq!(reloaded.instance, opened.instance);
    let after_window = host
        .grid_window(None, SHEET_GRID_SURFACE, &reloaded.instance, request)
        .expect("window reads the reloaded workbook");
    let cell = after_window
        .cells
        .iter()
        .find(|cell| cell.key.column == "column-a")
        .expect("reloaded cell is present");
    assert_eq!(cell.snapshot.input, "7");
    assert_eq!(cell.value, GridCellValue::Number(7.0));

    host.grid_close(None, SHEET_GRID_SURFACE, &reloaded.instance)
        .expect("workbook closes");
    assert!(host
        .grid_window(
            None,
            SHEET_GRID_SURFACE,
            &reloaded.instance,
            GridWindowRequest {
                sheet: "sheet-1".into(),
                row_start: 0,
                row_count: 1,
                column_start: 0,
                column_count: 1,
            },
        )
        .is_err());

    let errors = host.close_vault(&root).expect("host tears down the vault");
    assert!(errors.is_empty(), "host teardown failed: {errors:?}");
    assert!(host.vaults().is_empty(), "vault session was retired");
    assert!(matches!(
        host.grid_surfaces(Some(root.as_str())),
        Err(PluginError::NotFound(_))
    ));
}
