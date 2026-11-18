//! Le parti di una cartella che una nota incorpora (T43): il comando
//! `fub.part` dice dove sta un foglio, un intervallo, un nome definito o una
//! tabella, legge soltanto e, se la parte non c'è, elenca quelle che ci sono.

mod common;

use common::{sheet, Package};
use fub_abi::{
    GridBytesProvider, GridBytesSession, GridCommand, GridCommandOutcome, GridCommandRequest,
    GridJournal, PluginError, Revision,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};
use serde_json::Value as Json;

/// Il primo foglio comincia a C3; il secondo ha i conti in A1:E7 e una
/// tabella in B2:C4.
const NOTE: &str = r#"<dimension ref="C3:D5"/><sheetData><row r="3"><c r="C3" t="inlineStr"><is><t>da fare</t></is></c></row><row r="5"><c r="D5"><v>4</v></c></row></sheetData>"#;
const BUDGET: &str = r#"<dimension ref="A1:E7"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Voce</t></is></c><c r="E1" t="inlineStr"><is><t>Usato</t></is></c></row><row r="2"><c r="B2" t="inlineStr"><is><t>Voce</t></is></c><c r="C2" t="inlineStr"><is><t>Importo</t></is></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>Trasporti</t></is></c><c r="C3"><v>860</v></c></row><row r="4"><c r="B4" t="inlineStr"><is><t>Stampa</t></is></c><c r="C4"><v>0</v></c></row><row r="7"><c r="A7" t="inlineStr"><is><t>Totale</t></is></c><c r="C7"><f>SUM(C3:C4)</f><v>860</v></c></row></sheetData><tableParts count="1"><tablePart r:id="rT1"/></tableParts>"#;
const TABLE: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Spese" displayName="Spese" ref="B2:C4" totalsRowShown="0"><autoFilter ref="B2:C4"/><tableColumns count="2"><tableColumn id="1" name="Voce"/><tableColumn id="2" name="Importo"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>"#;
const NAMES: &str = r#"<definedNames><definedName name="Totali">Budget!$A$7:$E$7</definedName><definedName name="Locale" localSheetId="1">$B$2:$C$3</definedName><definedName name="Tasso">0.07</definedName><definedName name="Nascosto" hidden="1">Budget!$A$1</definedName></definedNames>"#;

fn workbook() -> Vec<u8> {
    Package {
        sheets: vec![sheet("Note", NOTE), sheet("Budget", BUDGET)],
        workbook_tail: NAMES,
        parts: vec![(
            "xl/tables/table1.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml",
            TABLE.as_bytes().to_vec(),
        )],
        sheet_rels: vec![(
            1,
            r#"<Relationship Id="rT1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>"#.to_owned(),
        )],
        ..Package::default()
    }
    .bytes()
}

fn open(bytes: &[u8]) -> (XlsxGridProvider, GridBytesSession) {
    let mut provider = XlsxGridProvider::new();
    let session = provider
        .open(
            XLSX_GRID_SURFACE,
            bytes,
            Revision::of_bytes(bytes),
            &GridJournal::new(),
        )
        .unwrap();
    (provider, session)
}

fn ask(
    provider: &mut XlsxGridProvider,
    session: &GridBytesSession,
    params: &str,
) -> Result<GridCommandOutcome, PluginError> {
    provider.command(
        &session.instance,
        GridCommandRequest {
            revision: session.revision.clone(),
            command: GridCommand {
                id: "fub.part".into(),
                params: params.into(),
                sheet: session.active.clone(),
                selection: "A1".into(),
                active: "A1".into(),
            },
        },
    )
}

/// La risposta, come JSON.
fn part(provider: &mut XlsxGridProvider, session: &GridBytesSession, text: &str) -> Json {
    let params = serde_json::json!({ "part": text }).to_string();
    let outcome = ask(provider, session, &params).unwrap();
    serde_json::from_str(outcome.result.as_deref().unwrap()).unwrap()
}

/// L'id del foglio di nome `name` nella sessione.
fn id(session: &GridBytesSession, name: &str) -> String {
    session
        .sheets
        .iter()
        .find(|sheet| sheet.name == name)
        .unwrap()
        .id
        .clone()
}

fn found(json: &Json) -> (String, String, String) {
    assert_eq!(json["found"], true, "{json}");
    (
        json["kind"].as_str().unwrap().to_owned(),
        json["sheet"].as_str().unwrap().to_owned(),
        json["range"].as_str().unwrap().to_owned(),
    )
}

#[test]
fn il_comando_della_parte_sta_nel_catalogo_e_legge_soltanto() {
    let (provider, session) = open(&workbook());
    let state = session
        .commands
        .iter()
        .find(|command| command.id == "fub.part")
        .expect("fub.part nel catalogo");
    assert!(state.enabled);
    drop(provider);
}

#[test]
fn un_intervallo_col_foglio_davanti_e_il_foglio_e_il_rettangolo() {
    let (mut provider, session) = open(&workbook());
    let budget = id(&session, "Budget");
    assert_eq!(
        found(&part(&mut provider, &session, "Budget!A1:E7")),
        ("range".into(), budget.clone(), "A1:E7".into())
    );
    // Fra apici, coi dollari, con le maiuscole sbagliate: lo stesso posto.
    assert_eq!(
        found(&part(&mut provider, &session, "'budget'!$B$2:$C$3")),
        ("range".into(), budget.clone(), "B2:C3".into())
    );
    // Senza foglio, il foglio attivo.
    assert_eq!(
        found(&part(&mut provider, &session, "B2:D4")),
        ("range".into(), id(&session, "Note"), "B2:D4".into())
    );
    // Le colonne intere valgono fin dove il foglio ha qualcosa.
    assert_eq!(
        found(&part(&mut provider, &session, "Budget!A:C")),
        ("range".into(), budget, "A1:C7".into())
    );
}

#[test]
fn un_foglio_intero_e_nessuna_parte_cominciano_dalla_prima_cella_usata() {
    let (mut provider, session) = open(&workbook());
    assert_eq!(
        found(&part(&mut provider, &session, "Budget")),
        ("sheet".into(), id(&session, "Budget"), "A1:E7".into())
    );
    assert_eq!(
        found(&part(&mut provider, &session, "")),
        ("active".into(), id(&session, "Note"), "C3:D5".into())
    );
    // Senza `part` nei parametri, come la parte vuota.
    let outcome = ask(&mut provider, &session, "{}").unwrap();
    let json: Json = serde_json::from_str(outcome.result.as_deref().unwrap()).unwrap();
    assert_eq!(json["kind"], "active");
}

#[test]
fn un_nome_definito_e_una_tabella_nominano_il_loro_rettangolo() {
    let (mut provider, session) = open(&workbook());
    let budget = id(&session, "Budget");
    assert_eq!(
        found(&part(&mut provider, &session, "totali")),
        ("name".into(), budget.clone(), "A7:E7".into())
    );
    // Un nome di un foglio, senza foglio nella formula: quel foglio.
    assert_eq!(
        found(&part(&mut provider, &session, "Locale")),
        ("name".into(), budget.clone(), "B2:C3".into())
    );
    assert_eq!(
        found(&part(&mut provider, &session, "Spese")),
        ("table".into(), budget, "B2:C4".into())
    );
}

#[test]
fn una_parte_che_non_ce_elenca_quelle_che_ci_sono() {
    let (mut provider, session) = open(&workbook());
    for missing in [
        "Conti!A1:E7",
        "Tasso",
        "Nascosto",
        "Mai visto",
        "Budget!ZZZ",
    ] {
        let json = part(&mut provider, &session, missing);
        assert_eq!(json["found"], false, "{missing}: {json}");
        let parts: Vec<(String, String)> = json["parts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|part| {
                (
                    part["kind"].as_str().unwrap().to_owned(),
                    part["name"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        // Una costante (`Tasso`) e un nome nascosto non sono parti.
        assert_eq!(
            parts,
            [
                ("sheet".to_owned(), "Note".to_owned()),
                ("sheet".to_owned(), "Budget".to_owned()),
                ("name".to_owned(), "Totali".to_owned()),
                ("name".to_owned(), "Locale".to_owned()),
                ("table".to_owned(), "Spese".to_owned()),
            ],
            "{missing}"
        );
    }
}

#[test]
fn leggere_la_parte_non_cambia_la_sessione_e_i_parametri_sbagliati_si_rifiutano() {
    let (mut provider, session) = open(&workbook());
    let outcome = ask(&mut provider, &session, r#"{"part":"Budget!A1:E7"}"#).unwrap();
    assert_eq!(outcome.commit.revision, session.revision);
    assert_eq!(outcome.commit.edit.from, outcome.commit.edit.to);
    assert!(outcome.commit.edit.inserted.is_empty());
    // Un'altra domanda sulla stessa revisione risponde ancora: la sessione
    // non è passata alla modalità a comandi.
    assert_eq!(part(&mut provider, &session, "Spese")["found"], true);
    for params in [r#"{"part":7}"#, "non json"] {
        assert!(
            matches!(
                ask(&mut provider, &session, params),
                Err(PluginError::BadArgs(_))
            ),
            "{params}"
        );
    }
}

/// La scheda che scrive porta la griglia alla prima cella della parte con
/// `selection.set`: anche su un altro foglio, il giornale resta com'è.
#[test]
fn portare_la_selezione_alla_parte_non_scrive_niente() {
    let (mut provider, session) = open(&workbook());
    let moved = provider
        .command(
            &session.instance,
            GridCommandRequest {
                revision: session.revision.clone(),
                command: GridCommand {
                    id: "selection.set".into(),
                    params: r#"{"range":"'Budget'!B2","active":"'Budget'!B2"}"#.into(),
                    sheet: session.active.clone(),
                    selection: "A1".into(),
                    active: "A1".into(),
                },
            },
        )
        .unwrap();
    assert_eq!(moved.commit.revision, session.revision);
    assert!(moved.commit.edit.inserted.is_empty() && moved.commit.edit.deleted.is_empty());
    assert_eq!(moved.selection.sheet, id(&session, "Budget"));
    assert_eq!(moved.selection.active, "B2");
}
