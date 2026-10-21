//! La fixture che lega la proiezione della shell a quella del codec:
//! `xlsx-projection.json` è la proiezione di una cartella con un po' di tutto,
//! e la griglia la legge e la mostra (`apps/client/src/editors/grid/*.test.ts`).
//! La scrive questo file con `UPDATE_MIRROR=1`.
//!
//! Le liste chiuse della proiezione (i tipi di avviso, le parti non mostrate)
//! sono anche in `apps/client/src/editors/grid/workbook.ts`: un valore che
//! manca lì rende illeggibile la proiezione, e qui il test lo dice.

mod common;

use std::path::PathBuf;

use common::{sheet, Package, SheetPart};
use fub_format_xlsx::open;
use fub_format_xlsx::projection::{NotShown, NoticeKind};
use serde_json::{json, Value};

fn client(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src")
        .join(path)
}

/// Una cartella di due fogli visibili e uno nascosto: valori di ogni tipo con i
/// loro formati, l'aspetto, una matrice dinamica versata, una cella unita,
/// colonne e righe con le loro dimensioni.
fn workbook() -> Vec<u8> {
    let conti = r#"<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="20" customWidth="1"/><col min="4" max="4" width="9" hidden="1"/></cols><sheetData>
<row r="1"><c r="A1" s="3" t="inlineStr"><is><t>Voce</t></is></c><c r="B1" s="3" t="inlineStr"><is><t>Importo</t></is></c><c r="C1" s="3" t="inlineStr"><is><t>Quota</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>Affitto</t></is></c><c r="B2"><v>800</v></c><c r="C2" s="1"><v>0.5</v></c><c r="E2" s="5"><v>45000</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>Spesa</t></is></c><c r="B3" s="6"><v>-120</v></c><c r="C3" s="1"><f>B3/B4</f><v>-0.15</v></c><c r="E3" t="b"><v>1</v></c></row>
<row r="4" ht="24" customHeight="1"><c r="A4" s="4" t="inlineStr"><is><t>Totale</t></is></c><c r="B4" s="4"><f>SUM(B2:B3)</f><v>680</v></c><c r="C4" t="e"><v>#DIV/0!</v></c><c r="F4" cm="1"><f t="array" ref="F4:F6">_xlfn.SEQUENCE(3)</f><v>1</v></c></row>
<row r="5"><c r="F5"><v>2</v></c></row>
<row r="6" hidden="1"><c r="F6"><v>3</v></c></row>
</sheetData><mergeCells count="1"><mergeCell ref="G1:H1"/></mergeCells>"#;
    let note = r#"<sheetData><row r="1"><c r="A1" s="7" t="inlineStr"><is><t>Una nota</t></is></c></row></sheetData>"#;
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

#[test]
fn la_fixture_della_shell_è_la_proiezione_del_codec() {
    let projection = open(&workbook()).unwrap();
    let path = client("__fixtures__/xlsx-projection.json");
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        let mut out = serde_json::to_string_pretty(&json!({ "source": projection })).unwrap();
        out.push('\n');
        std::fs::write(&path, out).expect("scrive la fixture");
        return;
    }
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let value: Value = serde_json::from_str(&raw).expect("fixture JSON");
    assert_eq!(
        value["source"].as_str().expect("campo source"),
        projection,
        "la fixture della shell è stantia: rigenerala con \
         `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --test ts_projection`"
    );
}

/// Ogni tipo di avviso, una volta: il `match` senza ramo di riserva non
/// compila finché un tipo nuovo non entra anche qui.
fn every_notice_kind() -> Vec<NoticeKind> {
    let all = [
        NoticeKind::Macros,
        NoticeKind::ExternalLinks,
        NoticeKind::Incomplete,
        NoticeKind::NotShown,
        NoticeKind::Recalculated,
        NoticeKind::Truncated,
    ];
    for kind in all {
        match kind {
            NoticeKind::Macros
            | NoticeKind::ExternalLinks
            | NoticeKind::Incomplete
            | NoticeKind::NotShown
            | NoticeKind::Recalculated
            | NoticeKind::Truncated => {}
        }
    }
    all.to_vec()
}

/// Le stringhe fra virgolette della lista `export const <name>` in `source`.
fn listed<'a>(source: &'a str, name: &str) -> Vec<&'a str> {
    let start = source
        .find(&format!("export const {name}"))
        .unwrap_or_else(|| panic!("{name} in workbook.ts"));
    let list = &source[start..start + source[start..].find(']').unwrap()];
    list.split('"').skip(1).step_by(2).collect()
}

#[test]
fn la_shell_conosce_ogni_avviso_e_ogni_parte_non_mostrata() {
    let path = client("editors/grid/workbook.ts");
    let source = std::fs::read_to_string(&path).unwrap();
    let kinds: Vec<String> = every_notice_kind()
        .into_iter()
        .map(|kind| {
            serde_json::to_value(kind)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(
        listed(&source, "WORKBOOK_NOTICES"),
        kinds,
        "{}",
        path.display()
    );
    let parts: Vec<&str> = NotShown::ALL.iter().map(|part| part.id()).collect();
    assert_eq!(
        listed(&source, "WORKBOOK_NOT_SHOWN"),
        parts,
        "{}",
        path.display()
    );
}
