//! La superficie della griglia sul protocollo a byte: le finestre mostrano i
//! valori del file e quelli del giornale, le formule che leggono una cella
//! cambiata sono segnate, e salvare è l'innesto.

mod common;

use common::{one_sheet, sheet, Package};
use fub_abi::{
    grid_bytes_revision, GridApplyRequest, GridBytesCell, GridBytesProvider, GridBytesSession,
    GridBytesWindow, GridCellKey, GridCellPatch, GridInvalidation, GridJournal, GridValue,
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
    whole_window(provider, session, revision).cells
}

fn whole_window(
    provider: &mut XlsxGridProvider,
    session: &GridBytesSession,
    revision: &Revision,
) -> GridBytesWindow {
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
                known_media: Vec::new(),
            },
        )
        .unwrap()
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

    let whole = whole_window(&mut provider, &session, &session.revision);
    let cells = whole.cells.clone();
    let a1 = find(&cells, "A1");
    assert_eq!((a1.input.as_str(), a1.display.as_str()), ("1", "1"));
    let a1_style = &whole.styles[a1.style as usize];
    assert!(a1_style.bold && a1_style.italic);
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
    // Una formula nuova entra come comando (ADR 0219), e il giornale non è
    // più di celle.
    let formula = apply(
        &mut provider,
        &session,
        &undone.revision,
        vec![patch("B2", "=A2*3")],
    )
    .unwrap();
    assert_eq!(
        GridJournal::parse(&formula.edit.inserted)
            .unwrap()
            .commands()
            .len(),
        1
    );
}

#[test]
fn le_modifiche_che_non_si_scrivono_si_rifiutano() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let revision = &session.revision;
    assert!(matches!(
        apply(
            &mut provider,
            &session,
            revision,
            vec![patch("A1", "=SUM(")]
        ),
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

#[test]
fn una_formula_sotto_le_righe_usate_non_cambia_la_misura_dei_fogli() {
    // IMP-142: «=(1» scritta in D6 di una cartella di tre righe. La formula
    // si chiude da sola, come in Excel; la misura dei fogli resta quella
    // della sessione, che il `GridCommit` non porta e su cui la shell
    // controlla ogni finestra.
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let rows = session.sheets[0].row_count;
    let columns = session.sheets[0].column_count;
    assert!(
        rows < 10 + 100,
        "la prova deve scrivere oltre il margine: {rows}"
    );
    // Una costante sotto le righe usate, nel giornale di celle: entrando nei
    // comandi conta anche lei.
    let constant = apply(
        &mut provider,
        &session,
        &session.revision,
        vec![patch("A8", "5")],
    )
    .unwrap();
    let opened = apply(
        &mut provider,
        &session,
        &constant.revision,
        vec![patch("D6", "=(1")],
    )
    .unwrap();
    let shown = whole_window(&mut provider, &session, &opened.revision);
    assert_eq!((shown.total_rows, shown.total_columns), (rows, columns));
    let d6 = find(&shown.cells, "D6");
    assert_eq!(d6.input, "=(1)");
    assert_eq!(d6.value, GridValue::Number(1.0));
    // Già nei comandi, una formula ancora più in basso.
    let lower = apply(
        &mut provider,
        &session,
        &opened.revision,
        vec![patch("A10", "=1+2")],
    )
    .unwrap();
    let shown = whole_window(&mut provider, &session, &lower.revision);
    assert_eq!((shown.total_rows, shown.total_columns), (rows, columns));
    assert_eq!(find(&shown.cells, "A10").value, GridValue::Number(3.0));
    // Il primo comando dopo porta i fogli contati di nuovo, con il margine
    // sotto l'ultima formula.
    let outcome = provider
        .command(
            &session.instance,
            fub_abi::GridCommandRequest {
                revision: lower.revision.clone(),
                command: fub_abi::GridCommand {
                    id: "range.setValues".into(),
                    params: r#"{"range":"B5","values":[["7"]]}"#.into(),
                    sheet: "s1".into(),
                    selection: "B5".into(),
                    active: "B5".into(),
                },
            },
        )
        .unwrap();
    assert_eq!(outcome.sheets[0].row_count, 10 + 100);
    let grown = whole_window(&mut provider, &session, &outcome.commit.revision);
    assert_eq!(grown.total_rows, 10 + 100);
}

#[test]
fn una_formula_entra_anche_dopo_un_innesto_che_chiede_di_ricalcolare() {
    // IMP-617: l'innesto di una costante letta da una formula scrive
    // `fullCalcOnLoad="1"`; la riscrittura per la formula di dopo non deve
    // contarlo come una perdita, e il file salvato chiede ancora di
    // ricalcolare.
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let commit = apply(
        &mut provider,
        &session,
        &session.revision,
        vec![patch("A2", "0.25")],
    )
    .unwrap();
    let grafted = provider
        .bytes_to_write(&session.instance, commit.revision.clone())
        .unwrap();
    assert!(workbook_xml(&grafted).contains("fullCalcOnLoad=\"1\""));

    let (mut provider, session) = open(&grafted, &GridJournal::new());
    let commit = apply(
        &mut provider,
        &session,
        &session.revision,
        vec![patch("D3", "=SUM(A1:A2)"), patch("E3", "=B1*C1")],
    )
    .unwrap();
    let saved = provider
        .bytes_to_write(&session.instance, commit.revision.clone())
        .unwrap();
    let read = fub_format_xlsx::read(&saved).unwrap();
    let sheet = &read.workbook.sheets[0];
    let formula = |a1: &str| {
        sheet
            .cell(CellRef::parse(a1).unwrap())
            .and_then(|cell| cell.formula.as_ref())
            .map(|formula| formula.text.clone())
    };
    assert_eq!(formula("D3").as_deref(), Some("SUM(A1:A2)"));
    assert_eq!(formula("E3").as_deref(), Some("B1*C1"));
    assert_eq!(value(&saved, "D3"), Value::Number(1.25));
    assert_eq!(value(&saved, "A2"), Value::Number(0.25));
    assert!(workbook_xml(&saved).contains("fullCalcOnLoad=\"1\""));
}

#[test]
fn cinque_righe_scritte_di_fila_coi_salvataggi_in_mezzo_arrivano_tutte_nel_file() {
    // La prova di IMP-310, IMP-414, IMP-512 e IMP-617 sul provider vero:
    // una cartella nuova di Fub, 5 righe per 4 colonne scritte una cella
    // alla volta (testi ripetuti, numeri, prodotti e somme su intervalli),
    // un salvataggio e una riapertura dopo ogni cella o dopo ogni riga, come
    // il salvataggio automatico con chi scrive piano o svelto; poi una
    // quantità corretta (l'innesto chiede di ricalcolare) e una formula
    // dopo. Si rilegge il file cella per cella.
    let rows: [[&str; 4]; 5] = [
        ["Voce", "Quantità", "Prezzo", "Totale"],
        ["Farina", "2", "3", "=B2*C2"],
        ["Farina integrale", "3", "4", "=B3*C3"],
        ["Farina", "4", "5", "=B4*C4"],
        ["Totale", "=SUM(B2:B4)", "Fari", "=SUM(D2:D4)"],
    ];
    let columns = ["A", "B", "C", "D", "E"];
    // Scrive le celle date in una sessione nuova sui byte, e salva.
    let write = |bytes: &[u8], cells: &[(usize, usize, &str)]| -> Vec<u8> {
        let (mut provider, session) = open(bytes, &GridJournal::new());
        let sheet = session.sheets[0].id.clone();
        let mut revision = session.revision.clone();
        for &(r, c, input) in cells {
            let cell = GridCellKey {
                sheet: sheet.clone(),
                row: format!("r{r}"),
                column: format!("c{c}"),
            };
            let patch = GridCellPatch {
                cell,
                before: None,
                after: input.into(),
            };
            revision = apply(&mut provider, &session, &revision, vec![patch])
                .unwrap_or_else(|error| panic!("{}{}: {error:?}", columns[c], r + 1))
                .revision;
        }
        provider
            .bytes_to_write(&session.instance, revision)
            .unwrap_or_else(|error| panic!("salvataggio: {error:?}"))
    };
    let cells: Vec<(usize, usize, &str)> = rows
        .iter()
        .enumerate()
        .flat_map(|(r, row)| row.iter().enumerate().map(move |(c, input)| (r, c, *input)))
        .collect();
    let blank = fub_format_xlsx::blank("Conti.xlsx", "Foglio1").unwrap();
    let per_cell = cells
        .iter()
        .fold(blank.clone(), |bytes, cell| write(&bytes, &[*cell]));
    let per_row = cells.chunks(4).fold(blank, |bytes, row| write(&bytes, row));

    for bytes in [per_cell, per_row] {
        check_rows(&rows, &columns, &bytes);
        for (a1, expected) in [
            ("D2", 6.0),
            ("D3", 12.0),
            ("D4", 20.0),
            ("B5", 9.0),
            ("D5", 38.0),
        ] {
            assert_eq!(value(&bytes, a1), Value::Number(expected), "{a1}");
        }
        let corrected = write(&bytes, &[(2, 1, "6")]);
        assert!(workbook_xml(&corrected).contains("fullCalcOnLoad=\"1\""));
        let bytes = write(&corrected, &[(1, 4, "=SUM(D2:D4)")]);
        let mut rows = rows;
        rows[2][1] = "6";
        check_rows(&rows, &columns, &bytes);
        let read = fub_format_xlsx::read(&bytes).unwrap();
        let formula = read.workbook.sheets[0]
            .cell(CellRef::parse("E2").unwrap())
            .and_then(|cell| cell.formula.as_ref())
            .map(|formula| formula.text.clone());
        assert_eq!(formula.as_deref(), Some("SUM(D2:D4)"));
        // I valori in cache delle formule di prima restano quelli del file:
        // il segno dice a chi apre di ricalcolarli.
        assert!(workbook_xml(&bytes).contains("fullCalcOnLoad=\"1\""));
    }
}

/// Ogni cella di `rows` nel file: la formula scritta, o il numero o il testo.
fn check_rows(rows: &[[&str; 4]; 5], columns: &[&str], bytes: &[u8]) {
    let read = fub_format_xlsx::read(bytes).unwrap();
    let sheet = &read.workbook.sheets[0];
    for (r, row) in rows.iter().enumerate() {
        for (c, input) in row.iter().enumerate() {
            let a1 = format!("{}{}", columns[c], r + 1);
            let at = CellRef::parse(&a1).unwrap();
            match input.strip_prefix('=') {
                Some(formula) => assert_eq!(
                    sheet
                        .cell(at)
                        .and_then(|cell| cell.formula.as_ref())
                        .map(|f| f.text.as_str()),
                    Some(formula),
                    "formula in {a1}"
                ),
                None => match input.parse::<f64>() {
                    Ok(expected) => assert_eq!(sheet.value(at), Value::Number(expected), "{a1}"),
                    Err(_) => assert_eq!(sheet.value(at), Value::from(*input), "{a1}"),
                },
            }
        }
    }
}
