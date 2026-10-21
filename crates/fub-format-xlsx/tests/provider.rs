//! Il provider di formato: il modello comune di una cartella per la ricerca,
//! l'outline e l'anteprima.

mod common;

use common::{sheet, Package, SheetPart};
use fub_abi::model::{Block, Inline};
use fub_abi::{DocumentSource, FormatError, FormatProvider, ParseContext, SourceKind};
use fub_format_xlsx::{XlsxProvider, EXTENSIONS, FORMAT_ID};
use fub_sdk::testing::conformance;

fn workbook() -> Vec<u8> {
    Package {
        sheets: vec![
            sheet(
                "Conti",
                r#"<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Affitto</t></is></c><c r="B1" s="1"><v>0.5</v></c></row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row></sheetData>"#,
            ),
            SheetPart {
                name: "Segreto",
                body: r#"<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>nascosto</t></is></c></row></sheetData>"#,
                hidden: true,
            },
            sheet("Vuoto", "<sheetData/>"),
        ],
        ..Package::default()
    }
    .bytes()
}

fn parse(bytes: Vec<u8>) -> Result<fub_abi::model::DocumentModel, FormatError> {
    XlsxProvider::new().parse(
        &DocumentSource::Bytes(bytes),
        &ParseContext::bare("Conti.xlsx"),
    )
}

#[test]
fn il_formato_rispetta_il_contratto() {
    let provider = XlsxProvider::new();
    conformance::a_format_respects_the_contract(&provider);
    let descriptor = provider.descriptor();
    assert_eq!(descriptor.id, FORMAT_ID);
    assert_eq!(descriptor.source, SourceKind::Bytes);
    assert_eq!(descriptor.extensions, EXTENSIONS);
    // Il testo non è di questo formato.
    let refused = provider.parse(
        &DocumentSource::Text("a,b".into()),
        &ParseContext::bare("Conti.xlsx"),
    );
    assert!(matches!(
        refused,
        Err(FormatError::Unsupported {
            got: SourceKind::Text,
            ..
        })
    ));
}

#[test]
fn un_foglio_visibile_è_un_titolo_con_la_sua_anteprima() {
    let model = parse(workbook()).unwrap();
    conformance::the_model_matches_the_given_id(&model, &ParseContext::bare("Conti.xlsx"));
    conformance::a_heading_slug_matches_the_contract(&model);
    conformance::flat_tables_are_the_tree_projection(&model);
    let outline: Vec<_> = model.outline.iter().map(|h| h.text.as_str()).collect();
    assert_eq!(outline, ["Conti", "Vuoto"]);
    let Block::Table { rows, .. } = &model.body[1] else {
        panic!("l'anteprima del primo foglio: {:?}", model.body[1]);
    };
    let text = |row: usize, col: usize| match &rows[row].cells[col].inlines[..] {
        [Inline::Text(text)] => text.clone(),
        [] => String::new(),
        other => panic!("{other:?}"),
    };
    assert_eq!(
        (text(0, 0), text(0, 1), text(1, 0), text(1, 1)),
        ("Affitto".into(), "50.00%".into(), "2".into(), String::new())
    );
    // Il foglio vuoto ha il titolo e niente tabella.
    assert!(matches!(model.body[2], Block::Heading { .. }));
    assert_eq!(model.body.len(), 3);
    // La ricerca trova ciò che le celle mostrano, non i fogli nascosti.
    assert!(model.text.contains("Affitto") && model.text.contains("50.00%"));
    assert!(!model.text.contains("nascosto"));
}

#[test]
fn una_cartella_illeggibile_è_un_errore_di_lettura() {
    assert!(matches!(
        parse(common::encrypted()),
        Err(FormatError::Parse(_))
    ));
    assert!(matches!(
        parse(b"ciao".to_vec()),
        Err(FormatError::Parse(_))
    ));
}

#[test]
fn la_resa_è_quella_del_modello_comune() {
    let provider = XlsxProvider::new();
    let model = parse(workbook()).unwrap();
    let html = provider
        .render_html(&model, &fub_abi::RenderOptions::default())
        .unwrap();
    assert!(html.contains("Affitto"), "{html}");
    assert!(provider.serialize(&model).is_err());
}
