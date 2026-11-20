//! I tempi della lettura e dell'apertura nella griglia (la sessione e la
//! prima finestra) delle cartelle di una cartella del disco: `FUB_XLSX_TEMPI=<cartella> cargo test --release -p fub-format-xlsx
//! --test tempi -- --ignored --nocapture`.

mod common;

use std::time::Instant;

use fub_abi::{
    GridApplyRequest, GridBytesProvider, GridCellKey, GridCellPatch, GridJournal,
    GridWindowRequest, Revision,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};

#[test]
#[ignore = "misura i tempi dei file di FUB_XLSX_TEMPI"]
fn tempi() {
    let Ok(dir) = std::env::var("FUB_XLSX_TEMPI") else {
        return;
    };
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .expect("cartella")
        .map(|entry| entry.expect("voce").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "xlsx"))
        .collect();
    paths.sort();
    for path in paths {
        let bytes = std::fs::read(&path).expect("file");
        let start = Instant::now();
        let read = fub_format_xlsx::read(&bytes).map(|_| ());
        let read_time = start.elapsed();
        let start = Instant::now();
        let mut grid = XlsxGridProvider::new();
        let open = grid
            .open(
                XLSX_GRID_SURFACE,
                &bytes,
                Revision::of_bytes(&bytes),
                &GridJournal::new(),
            )
            .and_then(|session| {
                grid.window(
                    &session.instance,
                    GridWindowRequest {
                        revision: session.revision.clone(),
                        sheet: session.active.clone(),
                        row_start: 0,
                        row_count: 50,
                        column_start: 0,
                        column_count: 20,
                        known_media: Vec::new(),
                    },
                )
            })
            .map(|window| window.cells.len());
        let open_time = start.elapsed();
        println!(
            "{:<24} {:>9} B  lettura {:>10.2?} {:?}  griglia {:>10.2?} {:?}",
            path.file_name().unwrap().to_string_lossy(),
            bytes.len(),
            read_time,
            read.err(),
            open_time,
            open,
        );
    }
}

/// Il ricalcolo dopo una modifica, su un foglio di 10.000 celle con 1.000
/// formule in catena: la modifica di A1 le tocca tutte. `cargo test --release
/// -p fub-format-xlsx --test tempi -- --ignored --nocapture ricalcolo`.
#[test]
#[ignore = "misura il ricalcolo di 1.000 formule"]
fn ricalcolo_di_mille_formule() {
    let mut body = String::from("<sheetData>");
    for row in 1..=1_000 {
        body.push_str(&format!("<row r=\"{row}\">"));
        for (index, column) in "ABCDEFGHI".chars().enumerate() {
            body.push_str(&format!(
                "<c r=\"{column}{row}\"><v>{}</v></c>",
                row + index
            ));
        }
        let previous = if row == 1 {
            String::new()
        } else {
            format!("+J{}", row - 1)
        };
        body.push_str(&format!(
            "<c r=\"J{row}\"><f>SUM(A{row}:I{row}){previous}</f><v>0</v></c></row>"
        ));
    }
    body.push_str("</sheetData>");
    let bytes = common::one_sheet(&body);
    let mut grid = XlsxGridProvider::new();
    let start = Instant::now();
    let session = grid
        .open(
            XLSX_GRID_SURFACE,
            &bytes,
            Revision::of_bytes(&bytes),
            &GridJournal::new(),
        )
        .unwrap();
    let open_time = start.elapsed();
    let mut revision = session.revision.clone();
    for (round, value) in ["1000", "2000", "3000"].into_iter().enumerate() {
        let start = Instant::now();
        let commit = grid
            .apply(
                &session.instance,
                GridApplyRequest {
                    revision: revision.clone(),
                    patches: vec![GridCellPatch {
                        cell: GridCellKey {
                            sheet: "s1".into(),
                            row: "r0".into(),
                            column: "c0".into(),
                        },
                        before: None,
                        after: value.into(),
                    }],
                },
            )
            .unwrap();
        let apply_time = start.elapsed();
        let start = Instant::now();
        let saved = grid
            .bytes_to_write(&session.instance, commit.revision.clone())
            .unwrap();
        let save_time = start.elapsed();
        let last = fub_format_xlsx::read(&saved).unwrap().workbook.sheets[0]
            .value(gridcraft_core::CellRef::parse("J1000").unwrap());
        println!(
            "giro {round}: apertura {open_time:>10.2?}  conferma {apply_time:>10.2?}  salvataggio {save_time:>10.2?}  J1000 = {last:?}"
        );
        revision = commit.revision;
    }
}
