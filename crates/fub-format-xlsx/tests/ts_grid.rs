//! La fixture che lega la griglia della shell alla superficie della cartella:
//! `xlsx-grid.json` è ciò che `XlsxGridProvider` risponde su una cartella con
//! un po' di tutto. Porta la sessione, la prima finestra di ogni foglio
//! visibile, una modifica con la finestra che ne segue, e un giornale che i
//! byte non confermano. La griglia la mostra e ci scrive
//! (`apps/client/src/editors/grid/*.test.ts`). La scrive questo file con
//! `UPDATE_MIRROR=1`.
//!
//! I codici chiusi della superficie (i blocchi, le parti non mostrate) sono
//! anche in `apps/client/src/editors/grid/engine.ts`: uno che manca lì si
//! direbbe con una frase generica, e qui il test lo dice.

mod common;

use std::collections::BTreeSet;
use std::path::PathBuf;

use common::{sheet, Package, SheetPart};
use fub_abi::{
    GridApplyRequest, GridBytesProvider, GridBytesSession, GridCellKey, GridCellPatch, GridJournal,
    GridWindowRequest, Revision,
};
use fub_format_xlsx::display::NotShown;
use fub_format_xlsx::grid::{XlsxGridProvider, SHEET_SHAPE_LOCK, XLSX_GRID_SURFACE};
use fub_format_xlsx::locks::Lock;
use serde_json::{json, Value};

fn client(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src")
        .join(path)
}

/// Una cartella di due fogli visibili e uno nascosto: valori di ogni tipo con i
/// loro formati, l'aspetto, una matrice dinamica versata, una formula senza
/// valore salvato, una cella unita, colonne e righe con le loro dimensioni.
fn workbook() -> Vec<u8> {
    let conti = r#"<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="20" customWidth="1"/><col min="4" max="4" width="9" hidden="1"/></cols><sheetData>
<row r="1"><c r="A1" s="3" t="inlineStr"><is><t>Voce</t></is></c><c r="B1" s="3" t="inlineStr"><is><t>Importo</t></is></c><c r="C1" s="3" t="inlineStr"><is><t>Quota</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>Affitto</t></is></c><c r="B2"><v>800</v></c><c r="C2" s="1"><v>0.5</v></c><c r="E2" s="5"><v>45000</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>Spesa</t></is></c><c r="B3" s="6"><v>-120</v></c><c r="C3" s="1"><f>B3/B4</f><v>-0.15</v></c><c r="E3" t="b"><v>1</v></c></row>
<row r="4" ht="24" customHeight="1"><c r="A4" s="4" t="inlineStr"><is><t>Totale</t></is></c><c r="B4" s="4"><f>SUM(B2:B3)</f><v>680</v></c><c r="C4" t="e"><v>#DIV/0!</v></c><c r="F4" cm="1"><f t="array" ref="F4:F6">_xlfn.SEQUENCE(3)</f><v>1</v></c></row>
<row r="5"><c r="F5"><v>2</v></c></row>
<row r="6" hidden="1"><c r="F6"><v>3</v></c></row>
</sheetData><mergeCells count="1"><mergeCell ref="G1:H1"/></mergeCells>"#;
    let note = r#"<sheetData><row r="1"><c r="A1" s="7" t="inlineStr"><is><t>Una nota</t></is></c><c r="B1"><f>A1&amp;"!"</f></c></row></sheetData>"#;
    let segreto = r#"<sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData>"#;
    Package {
        sheets: vec![
            sheet("Conti", conti),
            sheet("Note", note),
            SheetPart {
                name: "Segreto",
                body: segreto,
                hidden: true,
            },
        ],
        ..Package::default()
    }
    .bytes()
}

fn first_window(
    session: &GridBytesSession,
    sheet: usize,
    revision: &Revision,
) -> GridWindowRequest {
    let sheet = &session.sheets[sheet];
    GridWindowRequest {
        revision: revision.clone(),
        sheet: sheet.id.clone(),
        row_start: 0,
        row_count: sheet.row_count.min(256),
        column_start: 0,
        column_count: sheet.column_count.min(128),
    }
}

fn b2(session: &GridBytesSession) -> GridCellKey {
    GridCellKey {
        sheet: session.sheets[0].id.clone(),
        row: "r1".into(),
        column: "c1".into(),
    }
}

fn fixture() -> Value {
    let bytes = workbook();
    let revision = Revision::of_bytes(&bytes);
    let mut provider = XlsxGridProvider::new();
    let surface = provider.surfaces().remove(0);
    let session = provider
        .open(
            XLSX_GRID_SURFACE,
            &bytes,
            revision.clone(),
            &GridJournal::new(),
        )
        .unwrap();
    let windows: Vec<_> = (0..session.sheets.len())
        .filter(|&index| !session.hidden.contains(&session.sheets[index].id))
        .map(|index| {
            provider
                .window(
                    &session.instance,
                    first_window(&session, index, &session.revision),
                )
                .unwrap()
        })
        .collect();
    let request = GridApplyRequest {
        revision: session.revision.clone(),
        patches: vec![GridCellPatch {
            cell: b2(&session),
            before: Some("800".into()),
            after: "900".into(),
        }],
    };
    let commit = provider.apply(&session.instance, request.clone()).unwrap();
    let after = provider
        .window(
            &session.instance,
            first_window(&session, 0, &commit.revision),
        )
        .unwrap();

    // Lo stesso giornale su byte in cui B2 non è più 800: un conflitto.
    let mut journal = GridJournal::new();
    journal
        .record(b2(&session), "700".into(), "900".into())
        .unwrap();
    let conflicted = provider
        .open(XLSX_GRID_SURFACE, &bytes, revision.clone(), &journal)
        .unwrap();
    let conflicted_window = provider
        .window(
            &conflicted.instance,
            first_window(&conflicted, 0, &conflicted.revision),
        )
        .unwrap();
    json!({
        "document_revision": revision,
        "surface": surface,
        "session": session,
        "windows": windows,
        "edit": { "request": request, "commit": commit, "window": after },
        "conflict": {
            "journal": journal.to_text(),
            "session": conflicted,
            "window": conflicted_window,
        },
    })
}

#[test]
fn la_fixture_della_shell_è_la_superficie_della_cartella() {
    let fixture = fixture();
    let path = client("__fixtures__/xlsx-grid.json");
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        let mut out = serde_json::to_string_pretty(&fixture).unwrap();
        out.push('\n');
        std::fs::write(&path, out).expect("scrive la fixture");
        return;
    }
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let value: Value = serde_json::from_str(&raw).expect("fixture JSON");
    assert_eq!(
        value, fixture,
        "la fixture della shell è stantia: rigenerala con \
         `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --test ts_grid`"
    );
}

/// Le chiavi della tabella `const <name>` di `source`, fino alla prima `};`.
fn keys(source: &str, name: &str) -> BTreeSet<String> {
    let start = source
        .find(&format!("const {name}"))
        .unwrap_or_else(|| panic!("{name} in engine.ts"));
    let body = &source[start..start + source[start..].find("};").unwrap()];
    body.lines()
        .skip(1)
        .filter_map(|line| line.trim().split_once(':'))
        .map(|(key, _)| key.trim_matches('"').to_owned())
        .collect()
}

#[test]
fn la_shell_conosce_ogni_blocco_e_ogni_parte_non_mostrata() {
    let path = client("editors/grid/engine.ts");
    let source = std::fs::read_to_string(&path).unwrap();
    let locks: BTreeSet<String> = Lock::ALL
        .iter()
        .map(|lock| lock.code())
        .chain([SHEET_SHAPE_LOCK])
        .map(str::to_owned)
        .collect();
    assert_eq!(keys(&source, "LOCK_KEYS"), locks, "{}", path.display());
    let parts: BTreeSet<String> = NotShown::ALL
        .iter()
        .map(|part| format!("not-shown-{}", part.id().replace('_', "-")))
        .collect();
    assert_eq!(keys(&source, "NOT_SHOWN_KEYS"), parts, "{}", path.display());
}
