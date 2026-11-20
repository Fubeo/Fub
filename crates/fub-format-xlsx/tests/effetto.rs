//! L'effetto dei comandi dei fogli, provato: ogni comando che il catalogo dice
//! `Legge` o `Mostra`, dato con i parametri di partenza del suo schema a una
//! cartella preparata (dati, formule, un nome, uno scenario, una tabella
//! pivot, un grafico, un commento), va a buon fine e non scrive nel giornale:
//! `commit.edit` resta vuoto. Un comando che non gira è un errore del test,
//! non un comando saltato.

mod common;

use common::{sheet, Package};
use fub_abi::{
    GridBytesProvider, GridCommand, GridCommandRequest, GridJournal, PluginError, Revision, Text,
};
use fub_format_xlsx::catalogo::comandi;
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};
use fub_motori::{Campo, Effetto, Tipo};
use serde_json::{json, Map, Value};

const DATI: &str = r#"<dimension ref="A1:E5"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Regione</t></is></c><c r="B1" t="inlineStr"><is><t>Mese</t></is></c><c r="C1" t="inlineStr"><is><t>Vendite</t></is></c><c r="D1" t="inlineStr"><is><t>Doppio</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Nord</t></is></c><c r="B2"><v>1</v></c><c r="C2"><v>10</v></c><c r="D2"><f>C2*2</f><v>20</v></c><c r="E2"><f>D2+1</f><v>21</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Sud</t></is></c><c r="B3"><v>2</v></c><c r="C3"><v>20</v></c><c r="D3"><f>C3*2</f><v>40</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Nord</t></is></c><c r="B4"><v>3</v></c><c r="C4"><v>30</v></c><c r="D4"><f>C4*2</f><v>60</v></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>Sud</t></is></c><c r="B5"><v>4</v></c><c r="C5"><v>40</v></c><c r="D5"><f>SUM(C2:C4)</f><v>60</v></c></row></sheetData>"#;

const SECONDO: &str = r#"<dimension ref="A1"/><sheetData><row r="1"><c r="A1"><f>Foglio1!C2+1</f><v>11</v></c></row></sheetData>"#;

/// L'inizio del rifiuto di GridCraft quando il sistema non ha un elenco di
/// parole per l'ortografia.
const SENZA_DIZIONARIO: &str = "No dictionary is available on this system";

/// I comandi che preparano la cartella, con i loro parametri.
const PREPARA: &[(&str, &str)] = &[
    (
        "formulas.defineName",
        r#"{"name":"Vendite","refersTo":"=Foglio1!$C$2:$C$5"}"#,
    ),
    (
        "data.scenarioAdd",
        r#"{"name":"Alto","changing":"C2:C3","values":[100,200]}"#,
    ),
    (
        "insert.pivotTable",
        r#"{"source":"Foglio1!$A$1:$C$5","destination":"Foglio1!H3","rows":["Regione"],"values":["Vendite"]}"#,
    ),
    (
        "insert.chart",
        r#"{"range":"A1:C5","type":"column","at":"F10"}"#,
    ),
    (
        "review.newComment",
        r#"{"cell":"B2","text":"da guardare","author":"Ada"}"#,
    ),
];

fn command(id: &str, params: &str) -> GridCommand {
    GridCommand {
        id: id.into(),
        params: params.into(),
        sheet: "s1".into(),
        selection: "D2".into(),
        active: "D2".into(),
    }
}

/// Il valore di partenza di un campo obbligatorio: dal tipo, e dal nome per i
/// testi che il comando deve poter usare.
fn valore(campo: &Campo) -> Value {
    match &campo.tipo {
        Tipo::Testo | Tipo::Segreto => match campo.nome.as_str() {
            "formula" => json!("=SUM(C2:C5)"),
            "what" => json!("Nord"),
            "input" => json!("5"),
            "reference" => json!("B3"),
            "word" => json!("vendite"),
            _ => json!("prova"),
        },
        Tipo::Numero => json!(1),
        Tipo::SiNo => json!(true),
        Tipo::Cella => json!("C2"),
        Tipo::Intervallo => json!("A1:C5"),
        Tipo::Foglio => json!("Foglio1"),
        Tipo::Scelta { valori, .. } => json!(valori[0]),
        Tipo::Json => json!([]),
    }
}

/// I parametri di partenza: i campi obbligatori della forma principale, uno
/// solo per gruppo di alternative.
fn parametri(campi: &[Campo]) -> String {
    let mut params = Map::new();
    let mut gruppi = Vec::new();
    for campo in campi.iter().filter(|campo| !campo.facoltativo) {
        if let Some(gruppo) = campo.uno_fra {
            if gruppi.contains(&gruppo) {
                continue;
            }
            gruppi.push(gruppo);
        }
        params.insert(campo.nome.clone(), valore(campo));
    }
    Value::Object(params).to_string()
}

#[test]
fn i_comandi_che_leggono_o_mostrano_non_scrivono_nel_giornale() {
    let bytes = Package {
        sheets: vec![sheet("Foglio1", DATI), sheet("Foglio2", SECONDO)],
        ..Package::default()
    }
    .bytes();
    let mut journal = GridJournal::new();
    for (id, params) in PREPARA {
        journal.push_command(command(id, params)).unwrap();
    }
    let catalogo = comandi().unwrap();
    let provati: Vec<_> = catalogo
        .iter()
        .filter(|comando| comando.effetto != Effetto::Cambia)
        .collect();
    assert!(provati.len() > 50, "solo {} comandi provati", provati.len());
    let mut errori = Vec::new();
    let mut senza_dizionario = Vec::new();
    for comando in provati {
        // Una cartella nuova per ogni comando: la selezione o il foglio
        // attivo che un comando sposta non cambiano il comando dopo.
        let mut provider = XlsxGridProvider::new();
        let session = provider
            .open(
                XLSX_GRID_SURFACE,
                &bytes,
                Revision::of_bytes(&bytes),
                &journal,
            )
            .unwrap();
        let params = parametri(&comando.parametri.campi);
        let esito: Result<_, PluginError> = provider.command(
            &session.instance,
            GridCommandRequest {
                revision: session.revision.clone(),
                command: command(&comando.motore, &params),
            },
        );
        match esito {
            // L'ortografia di GridCraft legge l'elenco di parole del sistema
            // (`/usr/share/dict/words`), che i runner della CI non hanno:
            // senza, il motore rifiuta il controllo prima di toccare la
            // cartella, e non c'è niente da provare. Con l'elenco il comando
            // gira e la prova vale.
            Err(PluginError::BadArgs(Text::Literal(ref motivo)))
                if comando.motore.starts_with("review.")
                    && motivo.starts_with(SENZA_DIZIONARIO) =>
            {
                senza_dizionario.push(comando.motore.clone());
            }
            Err(error) => errori.push(format!("{} {params}: non gira: {error:?}", comando.motore)),
            Ok(outcome) => {
                let edit = &outcome.commit.edit;
                if !edit.inserted.is_empty() || !edit.deleted.is_empty() {
                    errori.push(format!(
                        "{} ({:?}) {params}: scrive nel giornale {:?}",
                        comando.motore, comando.effetto, edit.inserted
                    ));
                }
            }
        }
    }
    assert!(errori.is_empty(), "{}", errori.join("\n"));
    if !senza_dizionario.is_empty() {
        eprintln!("senza l'elenco di parole del sistema, non provati: {senza_dizionario:?}");
    }
}

/// I comandi che la regola direbbe «mostra» o «legge» e che il catalogo mette
/// fra i `Cambia` (`CAMBIANO`): con i parametri che li fanno lavorare, dopo il
/// comando che serve, scrivono nel giornale.
#[test]
fn i_comandi_messi_fra_quelli_che_cambiano_scrivono_nel_giornale() {
    let bytes = Package {
        sheets: vec![sheet("Foglio1", DATI), sheet("Foglio2", SECONDO)],
        ..Package::default()
    }
    .bytes();
    let catalogo = comandi().unwrap();
    for (prima, id, params) in [
        ("", "view.pageLayout", "{}"),
        ("", "view.pageBreakPreview", "{}"),
        ("view.pageLayout", "view.normal", "{}"),
        ("", "view.split", "{}"),
        ("", "view.customViews", r#"{"save":"Riepilogo"}"#),
        ("", "formulas.watchWindow", r#"{"add":"Foglio1!C2"}"#),
    ] {
        let comando = catalogo
            .iter()
            .find(|comando| comando.motore == id)
            .unwrap();
        assert_eq!(comando.effetto, Effetto::Cambia, "{id}");
        let mut journal = GridJournal::new();
        if !prima.is_empty() {
            journal.push_command(command(prima, "{}")).unwrap();
        }
        let mut provider = XlsxGridProvider::new();
        let session = provider
            .open(
                XLSX_GRID_SURFACE,
                &bytes,
                Revision::of_bytes(&bytes),
                &journal,
            )
            .unwrap();
        let outcome = provider
            .command(
                &session.instance,
                GridCommandRequest {
                    revision: session.revision.clone(),
                    command: command(id, params),
                },
            )
            .unwrap_or_else(|error| panic!("{id}: {error:?}"));
        assert!(outcome.commit.edit.inserted.contains(id), "{id}");
    }
}
