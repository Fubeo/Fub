//! La superficie della griglia sul protocollo a byte: le finestre mostrano i
//! valori del file e quelli del giornale, le formule che leggono una cella
//! cambiata sono segnate, e salvare è l'innesto.

mod common;

use common::{one_sheet, sheet, Package};
use fub_abi::{
    grid_bytes_revision, GridApplyRequest, GridBytesCell, GridBytesProvider, GridBytesSession,
    GridCellKey, GridCellPatch, GridCommand, GridInvalidation, GridJournal, GridValue,
    GridWindowRequest, PluginError, Revision,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};
use gridcraft_core::{CellRef, Value};

const BODY: &str = r#"<dimension ref="A1:D3"/><sheetData><row r="1"><c r="A1" s="3"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>7</v></c></row><row r="2"><c r="A2" s="1"><v>0.5</v></c><c r="B2"><f>A2*2</f><v>1</v></c><c r="C2"><f>B2+1</f><v>2</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>tre</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="C1:D1"/></mergeCells>"#;

fn key(a1: &str) -> GridCellKey {
    let cell = CellRef::parse(a1).unwrap();
    GridCellKey {
        sheet: "s1".into(),
        row: format!("r{}", cell.row),
        column: format!("c{}", cell.col),
    }
}

fn open(bytes: &[u8], journal: &GridJournal) -> (XlsxGridProvider, GridBytesSession) {
    let mut provider = XlsxGridProvider::new();
    let session = provider
        .open(XLSX_GRID_SURFACE, bytes, Revision::of_bytes(bytes), journal)
        .unwrap();
    (provider, session)
}

fn window(
    provider: &mut XlsxGridProvider,
    session: &GridBytesSession,
    revision: &Revision,
) -> Vec<GridBytesCell> {
    provider
        .window(
            &session.instance,
            GridWindowRequest {
                revision: revision.clone(),
                sheet: "s1".into(),
                row_start: 0,
                row_count: 10,
                column_start: 0,
                column_count: 6,
            },
        )
        .unwrap()
        .cells
}

fn find<'a>(cells: &'a [GridBytesCell], a1: &str) -> &'a GridBytesCell {
    let key = key(a1);
    cells
        .iter()
        .find(|cell| cell.key == key)
        .unwrap_or_else(|| panic!("{a1} is not in the window"))
}

fn patch(a1: &str, after: &str) -> GridCellPatch {
    GridCellPatch {
        cell: key(a1),
        before: None,
        after: after.into(),
    }
}

fn apply(
    provider: &mut XlsxGridProvider,
    session: &GridBytesSession,
    revision: &Revision,
    patches: Vec<GridCellPatch>,
) -> Result<fub_abi::GridCommit, PluginError> {
    provider.apply(
        &session.instance,
        GridApplyRequest {
            revision: revision.clone(),
            patches,
        },
    )
}

fn value(bytes: &[u8], a1: &str) -> Value {
    let read = fub_format_xlsx::read(bytes).unwrap();
    read.workbook.sheets[0].value(CellRef::parse(a1).unwrap())
}

fn workbook_xml(bytes: &[u8]) -> String {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut text = String::new();
    archive
        .by_name("xl/workbook.xml")
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    text
}

#[test]
fn la_sessione_mostra_i_fogli_e_i_valori_del_file() {
    let bytes = Package {
        sheets: vec![
            sheet("Primo", BODY),
            common::SheetPart {
                name: "Nascosto",
                body: "<sheetData/>",
                hidden: true,
            },
        ],
        ..Package::default()
    }
    .bytes();
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    assert_eq!(
        session.revision,
        grid_bytes_revision(&Revision::of_bytes(&bytes), "")
    );
    let ids: Vec<_> = session
        .sheets
        .iter()
        .map(|sheet| sheet.id.as_str())
        .collect();
    assert_eq!(ids, ["s1", "s2"]);
    assert_eq!(session.active, "s1");
    assert_eq!(session.hidden, ["s2"]);
    assert!(session.conflicts.is_empty());
    assert!(session.sheets[0].row_count >= 100 && session.sheets[0].column_count >= 26);

    let cells = window(&mut provider, &session, &session.revision);
    let a1 = find(&cells, "A1");
    assert_eq!((a1.input.as_str(), a1.display.as_str()), ("1", "1"));
    assert!(a1.style.bold && a1.style.italic);
    assert_eq!(find(&cells, "A2").display, "50.00%");
    let b2 = find(&cells, "B2");
    assert_eq!(b2.input, "=A2*2");
    assert_eq!(b2.value, GridValue::Number(1.0));
    assert!(!b2.stale && b2.lock.is_none());
    assert_eq!(find(&cells, "A3").value, GridValue::Text("tre".into()));
    assert_eq!(find(&cells, "C1").lock, None);
    // D1 è vuota e unita a C1: la finestra la porta col suo blocco, perché la
    // shell non ci scriva.
    let d1 = find(&cells, "D1");
    assert_eq!(
        (d1.input.as_str(), d1.lock.as_deref()),
        ("", Some("merged"))
    );
}

#[test]
fn una_modifica_entra_nel_giornale_e_segna_le_formule_che_la_leggono() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let commit = apply(
        &mut provider,
        &session,
        &session.revision,
        vec![patch("A2", "0.250")],
    )
    .unwrap();
    // L'input si scrive nella sua forma: `0.250` è `0.25`.
    let text = r#"{"version":1,"cells":[{"sheet":"s1","row":"r1","column":"c0","before":"0.5","after":"0.25"}]}"#;
    assert_eq!((commit.edit.from, commit.edit.to), (0, 0));
    assert_eq!(commit.edit.inserted, text);
    assert_eq!(
        commit.revision,
        grid_bytes_revision(&Revision::of_bytes(&bytes), text)
    );
    let GridInvalidation::Cells(invalid) = &commit.invalidation else {
        panic!("{:?}", commit.invalidation);
    };
    assert_eq!(invalid, &vec![key("A2"), key("B2"), key("C2")]);

    let cells = window(&mut provider, &session, &commit.revision);
    let a2 = find(&cells, "A2");
    assert_eq!((a2.input.as_str(), a2.display.as_str()), ("0.25", "25.00%"));
    assert!(!a2.stale);
    // Le dipendenti mostrano il valore del file, segnato.
    for a1 in ["B2", "C2"] {
        assert!(find(&cells, a1).stale, "{a1}");
    }
    assert_eq!(find(&cells, "B2").value, GridValue::Number(1.0));
    assert!(!find(&cells, "B1").stale);

    // La cella che torna al suo input esce dal giornale.
    let back = apply(
        &mut provider,
        &session,
        &commit.revision,
        vec![patch("A2", "0.5")],
    )
    .unwrap();
    assert_eq!(
        (back.edit.deleted.as_str(), back.edit.inserted.as_str()),
        (text, "")
    );
    assert_eq!(back.revision, session.revision);
    let cells = window(&mut provider, &session, &back.revision);
    assert!(!find(&cells, "B2").stale);

    // Sopra una formula si scrive un valore, e annullarlo riscrive la
    // formula del file: l'unica che si può scrivere, perché toglie la voce.
    let over = apply(
        &mut provider,
        &session,
        &back.revision,
        vec![patch("B2", "9")],
    )
    .unwrap();
    assert!(GridJournal::parse(&over.edit.inserted)
        .unwrap()
        .get(&key("B2"))
        .is_some());
    let undone = apply(
        &mut provider,
        &session,
        &over.revision,
        vec![patch("B2", "=A2*2")],
    )
    .unwrap();
    assert_eq!(undone.edit.inserted, "");
    assert_eq!(undone.revision, session.revision);
    assert!(matches!(
        apply(
            &mut provider,
            &session,
            &undone.revision,
            vec![patch("B2", "=A2*3")]
        ),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn le_modifiche_che_non_si_scrivono_si_rifiutano() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let revision = &session.revision;
    assert!(matches!(
        apply(&mut provider, &session, revision, vec![patch("A1", "=B1")]),
        Err(PluginError::BadArgs(_))
    ));
    assert!(matches!(
        apply(&mut provider, &session, revision, vec![patch("D1", "1")]),
        Err(PluginError::PermissionDenied(_))
    ));
    assert!(matches!(
        apply(
            &mut provider,
            &session,
            &Revision("vecchia".into()),
            vec![patch("A1", "1")]
        ),
        Err(PluginError::Conflict(_))
    ));
    let mut stale = patch("A1", "5");
    stale.before = Some("2".into());
    assert!(matches!(
        apply(&mut provider, &session, revision, vec![stale]),
        Err(PluginError::Conflict(_))
    ));
    // Un'operazione si applica tutta o niente.
    assert!(apply(
        &mut provider,
        &session,
        revision,
        vec![patch("A1", "5"), patch("D1", "1")]
    )
    .is_err());
    let cells = window(&mut provider, &session, revision);
    assert_eq!(find(&cells, "A1").input, "1");
}

#[test]
fn salvare_innesta_il_giornale_e_chiede_di_ricalcolare() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let commit = apply(
        &mut provider,
        &session,
        &session.revision,
        vec![patch("A2", "0.25"), patch("A3", "'12"), patch("E5", "TRUE")],
    )
    .unwrap();
    let saved = provider
        .bytes_to_write(&session.instance, commit.revision.clone())
        .unwrap();
    assert_eq!(value(&saved, "A2"), Value::Number(0.25));
    assert_eq!(value(&saved, "A3"), Value::text("12"));
    assert_eq!(value(&saved, "E5"), Value::Bool(true));
    // Niente si ricalcola: la dipendente ha il valore salvato, e il file
    // chiede di ricalcolare a chi lo apre.
    assert_eq!(value(&saved, "B2"), Value::Number(1.0));
    assert!(workbook_xml(&saved).contains("fullCalcOnLoad=\"1\""));
    assert!(matches!(
        provider.bytes_to_write(&session.instance, session.revision.clone()),
        Err(PluginError::Conflict(_))
    ));

    // Lo stesso giornale sui byte salvati è già applicato.
    let journal = GridJournal::parse(&commit.edit.inserted).unwrap();
    let (mut again, reopened) = open(&saved, &journal);
    assert!(reopened.conflicts.is_empty());
    assert_eq!(
        again
            .bytes_to_write(&reopened.instance, reopened.revision.clone())
            .unwrap(),
        saved
    );
}

#[test]
fn una_cella_cambiata_sul_disco_e_un_conflitto_che_il_salvataggio_scrive() {
    let bytes = one_sheet(BODY);
    let mut journal = GridJournal::new();
    journal.record(key("A1"), "9".into(), "3".into()).unwrap();
    journal
        .record(
            GridCellKey {
                sheet: "s7".into(),
                row: "r0".into(),
                column: "c0".into(),
            },
            "".into(),
            "1".into(),
        )
        .unwrap();
    let (mut provider, session) = open(&bytes, &journal);
    assert_eq!(session.conflicts.len(), 2);
    let cells = window(&mut provider, &session, &session.revision);
    let a1 = find(&cells, "A1");
    assert!(a1.conflict);
    assert_eq!(a1.input, "3");
    // Il foglio non c'è più: il salvataggio non ha dove scrivere.
    assert!(matches!(
        provider.bytes_to_write(&session.instance, session.revision.clone()),
        Err(PluginError::Conflict(_))
    ));

    let mut journal = GridJournal::new();
    journal.record(key("A1"), "9".into(), "3".into()).unwrap();
    let (mut provider, session) = open(&bytes, &journal);
    let saved = provider
        .bytes_to_write(&session.instance, session.revision.clone())
        .unwrap();
    assert_eq!(value(&saved, "A1"), Value::Number(3.0));
}

#[test]
fn un_giornale_di_comandi_non_si_apre_come_vuoto() {
    let bytes = one_sheet(BODY);
    let mut journal = GridJournal::new();
    journal
        .push_command(GridCommand {
            id: "home.bold".into(),
            params: "{}".into(),
            sheet: "s1".into(),
            selection: "A1".into(),
            active: "A1".into(),
        })
        .unwrap();
    let mut provider = XlsxGridProvider::new();
    assert!(matches!(
        provider.open(
            XLSX_GRID_SURFACE,
            &bytes,
            Revision::of_bytes(&bytes),
            &journal
        ),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn una_sorgente_che_non_e_la_sua_revisione_non_si_apre() {
    let bytes = one_sheet(BODY);
    let mut provider = XlsxGridProvider::new();
    assert!(matches!(
        provider.open(
            XLSX_GRID_SURFACE,
            &bytes,
            Revision("altra".into()),
            &GridJournal::new()
        ),
        Err(PluginError::Conflict(_))
    ));
    assert!(matches!(
        provider.open(
            "altra",
            &bytes,
            Revision::of_bytes(&bytes),
            &GridJournal::new()
        ),
        Err(PluginError::NotFound(_))
    ));
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    provider.close(&session.instance).unwrap();
    assert!(provider.close(&session.instance).is_err());
}

#[test]
fn la_superficie_segue_il_lifecycle_condiviso_della_versione_2() {
    let bytes = one_sheet(BODY);
    fub_sdk::testing::conformance::a_grid_bytes_provider_supports_the_lifecycle(
        &mut XlsxGridProvider::new(),
        fub_sdk::testing::conformance::GridBytesLifecycleFixture {
            surface: XLSX_GRID_SURFACE,
            source: &bytes,
            cell: key("A1"),
            input: "1",
            replacement: "4",
            saved_matches: |saved| value(saved, "A1") == Value::Number(4.0),
        },
    );
}
