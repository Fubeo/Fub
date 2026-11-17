//! I perché e i risultati dei comandi dei fogli, per la shell.
//!
//! `apps/client/src/editors/grid/motivi.generated.json` porta ogni frase con
//! cui il motore e l'adattatore spengono un comando o lo rifiutano: quelle che
//! il catalogo dà su cartelle diverse (vuota e piena, senza niente da
//! annullare, con gli appunti vuoti, senza commenti, con e senza una tabella,
//! un grafico, una tabella pivot, una cartella che la riscrittura perderebbe),
//! e quelle scritte nei sorgenti delle condizioni di GridCraft
//! (`vendor/gridcraft/crates/engine/src/cmd/`) e dell'adattatore
//! (`src/commands.rs`, `src/grid.rs`). Una frase con un parametro ci sta con
//! il segnaposto (`{n}`, `{error}`), non con il valore. La shell traduce ogni
//! frase (`editors/grid/motivi.ts`), e il suo test fallisce per una frase che
//! non sa tradurre.
//!
//! `apps/client/src/editors/grid/risultati.generated.json` porta, per ogni
//! comando che legge, le chiavi, le colonne e le parole inglesi fisse del suo
//! risultato, ciascuna con la chiave della sua traduzione, e mai i valori.
//! La forma è quella che la finestra del risultato
//! (`editors/grid/risultato.ts`) mostra: le chiavi di un oggetto sono righe
//! (quelle di un oggetto dentro un oggetto si leggono di seguito), un elenco
//! di oggetti è una tabella con le sue colonne, e dentro una cella un oggetto
//! o un elenco di oggetti non si apre. Le parole fisse sono i valori delle
//! chiavi che il motore riempie con un elenco chiuso di parole (`ELENCHI`).
//!
//! Il file deve essere lo stesso su ogni macchina: i comandi che usano
//! l'elenco di parole del sistema (l'ortografia) hanno qui la loro forma
//! scritta (`DIZIONARIO`), che il test confronta con quella vera quando
//! l'elenco c'è. Li scrive questo file con `UPDATE_MIRROR=1`, e il test
//! fallisce se sono stantii.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use common::{one_sheet, sheet, Package};
use fub_abi::{
    GridBytesProvider, GridCommand, GridCommandRequest, GridJournal, GridSelection, PluginError,
    Revision, Text,
};
use fub_format_xlsx::catalogo::comandi;
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};
use fub_motori::{Campo, Effetto, Tipo};
use serde_json::{json, Map, Value};

const RIGENERA: &str = "UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --test ts_risultati";

fn client(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src")
        .join(path)
}

fn repo(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

// --- Le cartelle di prova -------------------------------------------------

const DATI: &str = r#"<dimension ref="A1:E5"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Regione</t></is></c><c r="B1" t="inlineStr"><is><t>Mese</t></is></c><c r="C1" t="inlineStr"><is><t>Vendite</t></is></c><c r="D1" t="inlineStr"><is><t>Doppio</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Nord</t></is></c><c r="B2"><v>1</v></c><c r="C2"><v>10</v></c><c r="D2"><f>C2*2</f><v>20</v></c><c r="E2"><f>D2+1</f><v>21</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Sud</t></is></c><c r="B3"><v>2</v></c><c r="C3"><v>20</v></c><c r="D3"><f>C3*2</f><v>40</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Nord</t></is></c><c r="B4"><v>3</v></c><c r="C4"><v>30</v></c><c r="D4"><f>C4*2</f><v>60</v></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>Sud</t></is></c><c r="B5"><v>4</v></c><c r="C5"><v>40</v></c><c r="D5"><f>SUM(C2:C4)</f><v>60</v></c></row></sheetData>"#;

const SECONDO: &str = r#"<dimension ref="A1"/><sheetData><row r="1"><c r="A1"><f>Foglio1!C2+1</f><v>11</v></c></row></sheetData>"#;

/// Un foglio dal nome di partenza, con celle unite, un errore e un
/// riferimento circolare: i controlli degli errori e dell'accessibilità
/// hanno qualcosa da dire.
const TERZO: &str = r#"<dimension ref="A1:B3"/><sheetData><row r="1"><c r="A1"><f>1/0</f><v>#DIV/0!</v></c><c r="B1"><v>1</v></c></row><row r="2"><c r="A2"><f>B2</f><v>0</v></c><c r="B2"><f>A2</f><v>0</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A3:B3"/></mergeCells>"#;

/// Una cartella che la riscrittura perderebbe: GridCraft non tiene le celle
/// osservate.
const PERDE: &str = r#"<dimension ref="A1"/><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><cellWatches><cellWatch r="A1"/></cellWatches>"#;

/// L'inizio del rifiuto di GridCraft quando il sistema non ha un elenco di
/// parole per l'ortografia.
const SENZA_DIZIONARIO: &str = "No dictionary is available on this system";

/// I comandi che preparano la cartella piena, con i loro parametri.
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
    ("cell.set", r#"{"cell":"G2","input":"=SUM(C2:C3)"}"#),
];

/// La tabella, in una cartella a parte: sopra i dati che la tabella pivot
/// legge non ci sta.
const TABELLA: (&str, &str) = ("insert.table", r#"{"range":"A1:C5"}"#);

fn command(id: &str, params: &str) -> GridCommand {
    GridCommand {
        id: id.into(),
        params: params.into(),
        sheet: "s1".into(),
        selection: "D2".into(),
        active: "D2".into(),
    }
}

fn piena() -> Vec<u8> {
    Package {
        sheets: vec![
            sheet("Foglio1", DATI),
            sheet("Foglio2", SECONDO),
            sheet("Sheet3", TERZO),
        ],
        ..Package::default()
    }
    .bytes()
}

fn giornale(comandi: &[(&str, &str)]) -> GridJournal {
    let mut journal = GridJournal::new();
    for (id, params) in comandi {
        journal.push_command(command(id, params)).unwrap();
    }
    journal
}

fn apri(bytes: &[u8], journal: &GridJournal) -> (XlsxGridProvider, String, Revision) {
    let mut provider = XlsxGridProvider::new();
    let session = provider
        .open(XLSX_GRID_SURFACE, bytes, Revision::of_bytes(bytes), journal)
        .unwrap();
    (provider, session.instance, session.revision)
}

// --- I perché -------------------------------------------------------------

/// Le frasi che la ricerca nei sorgenti deve trovare: se una sparisce, la
/// ricerca non guarda più dove serve.
const NOTE: &[&str] = &[
    "no workbook open",
    "nothing to undo",
    "nothing to redo",
    "the clipboard is empty",
    "there are no comments in this workbook",
    "not available",
    "rewriting the workbook would lose {n} item(s)",
    "the workbook cannot be rewritten: {error}",
    "the workbook cannot be measured: {error}",
    "the workbook's sheets have no unique ids",
    "No dictionary is available on this system (GridCraft uses the system word list).",
    "select a cell in a PivotTable (or pass `pivot`)",
    "command `{0}` is not available right now: {1}",
    "invalid parameters for `{cmd}`: {msg}",
];

/// I corpi delle funzioni di `src` la cui firma (fino a `{`) contiene
/// `firma`, o che si chiamano come uno di `nomi`.
fn funzioni(src: &str, firma: Option<&str>, nomi: &[&str]) -> Vec<String> {
    let righe: Vec<&str> = src.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < righe.len() {
        let riga = righe[i];
        let rientro = riga.len() - riga.trim_start().len();
        let testa = riga.trim_start();
        let dopo_fn = ["fn ", "pub fn ", "pub(crate) fn ", "pub(super) fn "]
            .iter()
            .find_map(|inizio| testa.strip_prefix(inizio));
        let Some(dopo_fn) = dopo_fn else {
            i += 1;
            continue;
        };
        let nome: String = dopo_fn
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        let mut intestazione = String::new();
        let mut j = i;
        while j < righe.len() {
            intestazione.push_str(righe[j]);
            if righe[j].contains('{') || righe[j].trim_end().ends_with(';') {
                break;
            }
            j += 1;
        }
        let intestazione = intestazione
            .split('{')
            .next()
            .unwrap_or_default()
            .to_owned();
        let scelta = nomi.contains(&nome.as_str())
            || firma.is_some_and(|firma| intestazione.contains(firma));
        let chiusura = format!("{}}}", " ".repeat(rientro));
        let fine = (j..righe.len())
            .find(|&k| {
                righe[k].trim_end() == chiusura || (k == j && righe[k].trim_end().ends_with('}'))
            })
            .unwrap_or(righe.len() - 1);
        if scelta {
            out.push(righe[i..=fine].join("\n"));
        }
        i = fine + 1;
    }
    out
}

/// I letterali di stringa di `src` che sono frasi: almeno due parole.
fn frasi(src: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = src.chars().peekable();
    let mut prima = ' ';
    while let Some(c) = chars.next() {
        if c == '"' && prima != '\'' && prima != 'r' && prima != '#' {
            let mut testo = String::new();
            while let Some(c) = chars.next() {
                match c {
                    '\\' => {
                        if let Some(dopo) = chars.next() {
                            testo.push(dopo);
                        }
                    }
                    '"' => break,
                    _ => testo.push(c),
                }
            }
            if testo.contains(' ') && testo.chars().filter(|c| c.is_alphabetic()).count() > 3 {
                out.push(testo);
            }
            prima = '"';
        } else {
            prima = c;
        }
    }
    out
}

/// Una frase di `format!` con i segnaposto che la shell conosce: `{}` è un
/// numero (`{n}`), un segnaposto con il nome lo tiene.
fn segnaposto(frase: &str) -> String {
    frase.replace("{}", "{n}")
}

fn leggi(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Le frasi scritte nei sorgenti: le condizioni dei comandi di GridCraft (le
/// funzioni `fn(&Session) -> Result<(), String>`), il rifiuto senza elenco di
/// parole, e i perché dell'adattatore.
fn frasi_dei_sorgenti() -> BTreeMap<String, &'static str> {
    let mut out = BTreeMap::new();
    let cartella = repo("vendor/gridcraft/crates/engine/src/cmd");
    let mut file: Vec<PathBuf> = std::fs::read_dir(&cartella)
        .unwrap_or_else(|error| panic!("{}: {error}", cartella.display()))
        .map(|voce| voce.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .collect();
    file.sort();
    for path in &file {
        let src = leggi(path);
        for corpo in funzioni(
            &src,
            Some("Session) -> std::result::Result<(), String>"),
            &[],
        ) {
            for frase in frasi(&corpo) {
                out.insert(segnaposto(&frase), "motore");
            }
        }
        for frase in frasi(&src) {
            if frase.starts_with(SENZA_DIZIONARIO) {
                out.insert(frase, "motore");
            }
        }
        // Il perché di un comando che non si può dare adesso, quando è il
        // comando a dirlo e non la sua condizione.
        for (at, _) in src.match_indices("EngineError::Disabled(") {
            let resto = &src[at..];
            let fine = resto.find('\n').unwrap_or(resto.len());
            for frase in frasi(&resto[..fine]) {
                out.insert(frase, "motore");
            }
        }
    }
    // Le forme dei rifiuti del motore (`EngineError`), che avvolgono un
    // perché o un messaggio.
    let lib = leggi(&repo("vendor/gridcraft/crates/engine/src/lib.rs"));
    for (at, _) in lib.match_indices("#[error(") {
        let resto = &lib[at..];
        let fine = resto.find(")]").unwrap_or(resto.len());
        for frase in frasi(&resto[..fine]) {
            out.insert(frase, "motore");
        }
    }
    for (path, nomi) in [
        ("src/commands.rs", &["catalog", "loses", "measure"][..]),
        ("src/grid.rs", &["blocked"][..]),
    ] {
        let src = leggi(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(path));
        let corpi = funzioni(&src, None, nomi);
        assert_eq!(corpi.len(), nomi.len(), "{path}: le funzioni {nomi:?}");
        for corpo in corpi {
            for frase in frasi(&corpo) {
                out.entry(segnaposto(&frase)).or_insert("adattatore");
            }
        }
    }
    out
}

/// La frase di `motivo` fra quelle dei sorgenti: lo stesso testo, con un
/// valore al posto di ogni segnaposto e, dopo, al più `: ` e un dettaglio.
fn modello<'a>(motivo: &str, modelli: impl Iterator<Item = &'a String>) -> Option<String> {
    modelli
        .filter(|modello| {
            let pezzi: Vec<&str> = modello
                .split(['{', '}'])
                .enumerate()
                .filter(|(i, _)| i % 2 == 0)
                .map(|(_, pezzo)| pezzo)
                .collect();
            let mut resto = motivo;
            for (i, pezzo) in pezzi.iter().enumerate() {
                if i == 0 {
                    let Some(dopo) = resto.strip_prefix(pezzo) else {
                        return false;
                    };
                    resto = dopo;
                } else if pezzo.is_empty() {
                    resto = "";
                } else {
                    let Some(at) = resto.find(pezzo) else {
                        return false;
                    };
                    resto = &resto[at + pezzo.len()..];
                }
            }
            resto.is_empty() || resto.starts_with(": ")
        })
        .max_by_key(|modello| modello.len())
        .cloned()
}

/// Le cartelle su cui si chiede il catalogo, con il loro nome.
fn cartelle() -> Vec<(&'static str, Vec<u8>, GridJournal)> {
    vec![
        ("vuota", one_sheet("<sheetData/>"), GridJournal::new()),
        ("piena", piena(), giornale(PREPARA)),
        (
            "piena senza niente da annullare",
            piena(),
            GridJournal::new(),
        ),
        ("con una tabella", piena(), giornale(&[TABELLA])),
        (
            "che la riscrittura perderebbe",
            one_sheet(PERDE),
            GridJournal::new(),
        ),
    ]
}

/// I perché del catalogo su ogni cartella di prova.
fn frasi_dei_cataloghi() -> BTreeMap<String, BTreeSet<&'static str>> {
    let mut out: BTreeMap<String, BTreeSet<&'static str>> = BTreeMap::new();
    for (nome, bytes, journal) in cartelle() {
        let (mut provider, instance, _) = apri(&bytes, &journal);
        for selection in ["A1", "D2", "H4"] {
            let catalogo = provider
                .commands(
                    &instance,
                    GridSelection {
                        sheet: "s1".into(),
                        selection: selection.into(),
                        active: selection.into(),
                    },
                )
                .unwrap_or_else(|error| panic!("{nome}: {error:?}"));
            for stato in catalogo {
                if let Some(motivo) = stato.reason {
                    out.entry(motivo).or_default().insert(nome);
                }
            }
        }
    }
    out
}

fn motivi() -> Value {
    let sorgenti = frasi_dei_sorgenti();
    for nota in NOTE {
        assert!(
            sorgenti.contains_key(*nota),
            "la ricerca nei sorgenti non trova «{nota}»: {:?}",
            sorgenti.keys().collect::<Vec<_>>()
        );
    }
    let mut fonti: BTreeMap<String, BTreeSet<String>> = sorgenti
        .iter()
        .map(|(frase, fonte)| (frase.clone(), BTreeSet::from([(*fonte).to_owned()])))
        .collect();
    for (motivo, _) in frasi_dei_cataloghi() {
        let frase = modello(&motivo, sorgenti.keys()).unwrap_or(motivo);
        fonti
            .entry(frase)
            .or_default()
            .insert("catalogo".to_owned());
    }
    json!({
        "$generato": format!(
            "File generato da crates/fub-format-xlsx/tests/ts_risultati.rs, non modificare a mano; rigenera con {RIGENERA}"
        ),
        "frasi": fonti
            .into_iter()
            .map(|(frase, fonti)| json!({"frase": frase, "fonti": fonti}))
            .collect::<Value>(),
    })
}

// --- I risultati ----------------------------------------------------------

/// Le chiavi che il motore riempie con un elenco chiuso di parole inglesi: i
/// loro valori sono parole fisse, che la finestra del risultato traduce. Lo
/// stesso elenco è nel file generato, e la finestra lo legge da lì.
const ELENCHI: &[&str] = &[
    "anchorMode",
    "areas",
    "calcMode",
    "category",
    "func",
    "group",
    "h",
    "issue",
    "kind",
    "label",
    "layout",
    "mode",
    "orientation",
    "paper",
    "pattern",
    "scope",
    "showAs",
    "sort",
    "subtotals",
    "subtype",
    "type",
    "underline",
    "v",
    "vert",
    "visibility",
];

/// La forma scritta dei comandi che usano l'elenco di parole del sistema:
/// un esempio che ha tutte le chiavi del risultato vero.
fn dizionario(motore: &str) -> Option<Value> {
    match motore {
        "review.spelling" => Some(
            json!({"issues": [{"cell": "A1", "word": "x", "suggestions": ["y"]}], "done": false}),
        ),
        "review.thesaurus" => Some(json!({"value": ["x"]})),
        _ => None,
    }
}

#[derive(Default, PartialEq, Debug)]
struct Forma {
    chiavi: BTreeSet<String>,
    colonne: BTreeSet<String>,
    parole: BTreeSet<String>,
}

fn parola(forma: &mut Forma, chiave: &str, valore: &Value) {
    if !ELENCHI.contains(&chiave) {
        return;
    }
    match valore {
        Value::String(testo) if !testo.is_empty() => {
            forma.parole.insert(testo.clone());
        }
        Value::Array(voci) => {
            for voce in voci {
                if let Value::String(testo) = voce {
                    if !testo.is_empty() {
                        forma.parole.insert(testo.clone());
                    }
                }
            }
        }
        _ => {}
    }
}

/// Un elenco che diventa una tabella: di oggetti, o di elenchi.
fn tabella(valore: &Value) -> bool {
    matches!(valore, Value::Array(voci) if voci.iter().any(|voce| voce.is_object() || voce.is_array()))
}

/// Le righe di un oggetto: le chiavi, e dentro le chiavi degli oggetti; un
/// elenco di oggetti è una tabella a parte.
fn righe(forma: &mut Forma, oggetto: &Map<String, Value>) {
    for (chiave, valore) in oggetto {
        forma.chiavi.insert(chiave.clone());
        match valore {
            Value::Object(dentro) => righe(forma, dentro),
            _ if tabella(valore) => voci(forma, valore),
            _ => parola(forma, chiave, valore),
        }
    }
}

/// Le colonne di una tabella: le chiavi dei suoi oggetti. Dentro una cella
/// un oggetto o un elenco di oggetti non si apre.
fn voci(forma: &mut Forma, elenco: &Value) {
    let Value::Array(voci) = elenco else { return };
    for voce in voci {
        if let Value::Object(oggetto) = voce {
            for (chiave, valore) in oggetto {
                forma.colonne.insert(chiave.clone());
                parola(forma, chiave, valore);
            }
        }
    }
}

/// La forma di un risultato, come la finestra lo mostra: un oggetto con la
/// sola chiave `value` mostra il suo valore.
fn forma(risultato: &Value) -> Forma {
    let mut forma = Forma::default();
    let valore = match risultato {
        Value::Object(oggetto) if oggetto.len() == 1 && oggetto.contains_key("value") => {
            &oggetto["value"]
        }
        _ => risultato,
    };
    match valore {
        Value::Object(oggetto) => righe(&mut forma, oggetto),
        Value::Array(_) => voci(&mut forma, valore),
        Value::Null => {}
        _ => {
            forma.chiavi.insert("value".to_owned());
        }
    }
    forma
}

/// Il valore di partenza di un campo obbligatorio, come in `effetto.rs`.
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

fn chiavi(prefisso: &str, nomi: &BTreeSet<String>) -> Value {
    Value::Object(
        nomi.iter()
            .map(|nome| (nome.clone(), json!(format!("{prefisso}{nome}"))))
            .collect(),
    )
}

/// La chiave della traduzione di una parola fissa: minuscola, e un `_` al
/// posto di ciò che non è una lettera o una cifra.
fn chiave_parola(parola: &str) -> String {
    let mut out = String::from("fogli.result.word.");
    let mut prima = '_';
    for c in parola.chars() {
        let c = if c.is_ascii_alphanumeric() {
            c.to_ascii_lowercase()
        } else {
            '_'
        };
        if c == '_' && prima == '_' {
            continue;
        }
        out.push(c);
        prima = c;
    }
    out.trim_end_matches('_').to_owned()
}

fn risultati() -> Value {
    let catalogo = comandi().unwrap();
    let mut out = Map::new();
    let mut errori = Vec::new();
    for comando in catalogo
        .iter()
        .filter(|comando| comando.effetto == Effetto::Legge)
    {
        // Il risultato di una cartella e di un'altra: la tabella sta in una
        // cartella a parte, e le chiavi delle due si sommano.
        let mut tutta = Forma::default();
        for (prima, journal) in [(true, giornale(PREPARA)), (false, giornale(&[TABELLA]))] {
            let (mut provider, instance, revision) = apri(&piena(), &journal);
            let params = parametri(&comando.parametri.campi);
            let esito: Result<_, PluginError> = provider.command(
                &instance,
                GridCommandRequest {
                    revision,
                    command: command(&comando.motore, &params),
                },
            );
            let scritta = dizionario(&comando.motore).map(|esempio| forma(&esempio));
            let trovata = match esito {
                Ok(outcome) => {
                    let testo = outcome.result.unwrap_or_default();
                    let valore: Value = if testo.is_empty() {
                        Value::Null
                    } else {
                        serde_json::from_str(&testo).unwrap_or_else(|error| {
                            panic!("{}: il risultato non è JSON: {error}", comando.motore)
                        })
                    };
                    let trovata = forma(&valore);
                    if let Some(scritta) = &scritta {
                        // Con l'elenco di parole la forma vera e quella scritta
                        // sono la stessa, salvo un risultato vuoto.
                        if !trovata.chiavi.is_empty() || !trovata.colonne.is_empty() {
                            assert_eq!(
                                &trovata, scritta,
                                "{}: la forma scritta è vecchia",
                                comando.motore
                            );
                        }
                    }
                    trovata
                }
                Err(PluginError::BadArgs(Text::Literal(ref motivo)))
                    if scritta.is_some() && motivo.starts_with(SENZA_DIZIONARIO) =>
                {
                    Forma::default()
                }
                // Sulla cartella con la tabella un comando può non avere
                // niente da leggere (la tabella pivot non c'è): conta la
                // cartella piena.
                Err(error) => {
                    if prima {
                        errori.push(format!("{} {params}: {error:?}", comando.motore));
                    }
                    Forma::default()
                }
            };
            let trovata = scritta.unwrap_or(trovata);
            tutta.chiavi.extend(trovata.chiavi);
            tutta.colonne.extend(trovata.colonne);
            tutta.parole.extend(trovata.parole);
        }
        out.insert(
            comando.motore.clone(),
            json!({
                "chiavi": chiavi("fogli.result.key.", &tutta.chiavi),
                "colonne": chiavi("fogli.result.col.", &tutta.colonne),
                "parole": Value::Object(
                    tutta.parole.iter().map(|parola| (parola.clone(), json!(chiave_parola(parola)))).collect()
                ),
            }),
        );
    }
    assert!(errori.is_empty(), "{}", errori.join("\n"));
    json!({
        "$generato": format!(
            "File generato da crates/fub-format-xlsx/tests/ts_risultati.rs, non modificare a mano; rigenera con {RIGENERA}"
        ),
        "elenchi": ELENCHI,
        "comandi": out,
    })
}

fn testo(valore: &Value) -> String {
    let mut out = serde_json::to_string_pretty(valore).expect("è JSON");
    out.push('\n');
    out
}

fn confronta(path: &str, atteso: &str) {
    let path = client(path);
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, atteso).expect("scrive il file");
        return;
    }
    let scritto = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}; rigeneralo con `{RIGENERA}`", path.display()));
    assert!(
        scritto == atteso,
        "{} è stantio: rigeneralo con `{RIGENERA}`",
        path.display()
    );
}

#[test]
fn i_perché_della_shell_sono_quelli_del_motore() {
    confronta("editors/grid/motivi.generated.json", &testo(&motivi()));
}

#[test]
fn i_risultati_della_shell_sono_quelli_del_motore() {
    confronta(
        "editors/grid/risultati.generated.json",
        &testo(&risultati()),
    );
}

#[test]
fn la_ricerca_trova_le_frasi_con_un_parametro() {
    let sorgenti = frasi_dei_sorgenti();
    assert_eq!(
        modello(
            "rewriting the workbook would lose 2 item(s): 1 → 0: cellWatches",
            sorgenti.keys()
        )
        .as_deref(),
        Some("rewriting the workbook would lose {n} item(s)")
    );
    assert_eq!(
        modello("the workbook cannot be rewritten: codec", sorgenti.keys()).as_deref(),
        Some("the workbook cannot be rewritten: {error}")
    );
    assert_eq!(modello("a phrase nobody wrote", sorgenti.keys()), None);
}

#[test]
fn la_forma_non_porta_i_valori() {
    let forma = forma(
        &json!({"sheet": {"name": "Segreto", "cells": 3}, "value": [{"kind": "chart", "title": "Mio"}]}),
    );
    assert_eq!(
        forma.chiavi,
        BTreeSet::from([
            "sheet".into(),
            "name".into(),
            "cells".into(),
            "value".into()
        ])
    );
    assert_eq!(
        forma.colonne,
        BTreeSet::from(["kind".into(), "title".into()])
    );
    assert_eq!(forma.parole, BTreeSet::from(["chart".into()]));
}
