//! La stampa di una cartella: l'export in PDF dai byte salvati, con ciò che il
//! PDF non porta contato nel rapporto, e l'anteprima e il PDF della sessione
//! della griglia, che leggono la cartella com'è adesso e non la cambiano.

mod common;

use base64::Engine as _;
use common::{sheet, Package};
use fub_abi::transfer::NoteLevel;
use fub_abi::{
    GridBytesProvider, GridBytesSession, GridCommand, GridCommandOutcome, GridCommandRequest,
    GridJournal, PluginError, Revision,
};
use fub_format_xlsx::export::{print, Sheets};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};
use serde_json::Value as Json;

const CONTI: &str = r#"<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Affitto</t></is></c><c r="B1"><v>800</v></c></row><row r="2"><c r="B2"><f>B1*12</f></c></row></sheetData>"#;
const NASCOSTO: &str = r#"<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>riservato</t></is></c></row></sheetData>"#;
const VUOTO: &str = r#"<sheetData/>"#;

/// Tre fogli: «Conti» con una formula salvata senza valore, «Nascosto»
/// nascosto e «Vuoto» senza celle.
fn cartella() -> Vec<u8> {
    Package {
        sheets: vec![
            sheet("Conti", CONTI),
            common::SheetPart {
                hidden: true,
                ..sheet("Nascosto", NASCOSTO)
            },
            sheet("Vuoto", VUOTO),
        ],
        ..Package::default()
    }
    .bytes()
}

fn messages(level: NoteLevel, notes: &[fub_abi::transfer::TransferNote]) -> Vec<String> {
    notes
        .iter()
        .filter(|note| note.level == level)
        .map(|note| note.message.clone())
        .collect()
}

#[test]
fn il_pdf_si_stampa_dai_byte_e_dice_ciò_che_non_porta() {
    let printed = print(&cartella(), Sheets::All, "Conti.xlsx".into()).unwrap();
    assert!(printed.bytes.starts_with(b"%PDF-"), "non è un PDF");
    assert_eq!(printed.pages, 1, "soltanto «Conti» ha qualcosa da stampare");
    let warnings = messages(NoteLevel::Warning, &printed.losses);
    assert!(
        warnings.contains(&"1 foglio nascosto non si stampa".to_string()),
        "{warnings:?}"
    );
    assert!(
        warnings
            .contains(&"1 formula senza un valore salvato nel file si stampa vuota".to_string()),
        "{warnings:?}"
    );
    let infos = messages(NoteLevel::Info, &printed.losses);
    assert!(
        infos.contains(&"1 foglio senza niente da stampare non ha pagine".to_string()),
        "{infos:?}"
    );
    // La nota su ciò che un PDF non porta in nessun caso c'è sempre.
    assert!(infos
        .iter()
        .any(|info| info.starts_with("il PDF è una stampa")));
}

#[test]
fn il_foglio_attivo_si_stampa_da_solo_e_lo_dice() {
    let printed = print(&cartella(), Sheets::Active, "Conti.xlsx".into()).unwrap();
    assert_eq!(printed.pages, 1);
    let infos = messages(NoteLevel::Info, &printed.losses);
    assert!(
        infos.contains(&"si stampa soltanto il foglio attivo del file, su 3 fogli".to_string()),
        "{infos:?}"
    );
    // Il foglio nascosto non si stampa comunque: non è una perdita di questa
    // scelta.
    let warnings = messages(NoteLevel::Warning, &printed.losses);
    assert!(
        !warnings.iter().any(|warning| warning.contains("nascost")),
        "{warnings:?}"
    );
}

#[test]
fn byte_che_non_sono_una_cartella_non_si_stampano() {
    assert!(print(b"not a workbook", Sheets::All, "x.xlsx".into()).is_err());
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

fn give(
    provider: &mut XlsxGridProvider,
    instance: &str,
    revision: &Revision,
    id: &str,
    params: &str,
    at: &str,
) -> Result<GridCommandOutcome, PluginError> {
    provider.command(
        instance,
        GridCommandRequest {
            revision: revision.clone(),
            command: GridCommand {
                id: id.into(),
                params: params.into(),
                sheet: "s1".into(),
                selection: at.into(),
                active: at.split(':').next().unwrap().into(),
            },
        },
    )
}

fn result(outcome: &GridCommandOutcome) -> Json {
    serde_json::from_str(outcome.result.as_deref().expect("the command answers")).unwrap()
}

#[test]
fn l_anteprima_e_il_pdf_della_sessione_seguono_la_cartella_e_non_la_cambiano() {
    let bytes = cartella();
    let (mut provider, session) = open(&bytes);
    let served = |id: &str| session.commands.iter().any(|command| command.id == id);
    assert!(served("file.printPreview") && served("file.exportPdf"));
    // Gli altri comandi del gruppo File restano della shell.
    assert!(!served("file.print") && !served("file.save"));

    let preview = give(
        &mut provider,
        &session.instance,
        &session.revision,
        "file.printPreview",
        "{}",
        "A1",
    )
    .unwrap();
    assert_eq!(preview.commit.revision, session.revision);
    assert_eq!(result(&preview)["pages"], 1);
    assert_eq!(result(&preview)["pageList"][0]["sheet"], "Conti");

    // Una cella lontana allunga la stampa: l'anteprima la vede prima del
    // salvataggio.
    let written = give(
        &mut provider,
        &session.instance,
        &session.revision,
        "range.setValues",
        r#"{"range":"A400","values":[["fine"]]}"#,
        "A400",
    )
    .unwrap();
    let revision = written.commit.revision.clone();
    let preview = give(
        &mut provider,
        &session.instance,
        &revision,
        "file.printPreview",
        "{}",
        "A1",
    )
    .unwrap();
    let pages = result(&preview)["pages"].as_u64().unwrap();
    assert!(pages > 1, "{pages}");

    let pdf = give(
        &mut provider,
        &session.instance,
        &revision,
        "file.exportPdf",
        r#"{"sheets":"active"}"#,
        "A1",
    )
    .unwrap();
    // Il PDF non entra nel giornale.
    assert_eq!(pdf.commit.revision, revision);
    assert_eq!(pdf.commit.edit.inserted, "");
    let answer = result(&pdf);
    assert_eq!(answer["pages"].as_u64(), Some(pages));
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(answer["base64"].as_str().unwrap())
        .unwrap();
    assert!(decoded.starts_with(b"%PDF-"));

    // Un percorso non si scrive mai: la facciata non ha il disco.
    let refused = give(
        &mut provider,
        &session.instance,
        &revision,
        "file.exportPdf",
        r#"{"path":"/tmp/fuori.pdf"}"#,
        "A1",
    );
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );
}
