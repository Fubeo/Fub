//! I casi delle righe della mappa (piano K6, T5): li leggono il banco di
//! prova delle righe (`famiglie.rs`) e la prova del disco (`disco.rs`), e il
//! client (`apps/client/src/editors/spatial/completo/casi.test.ts`) applica
//! le loro operazioni.
//!
//! Un file di casi è `tests/famiglie/<famiglia>.json` (o un file di
//! `tests/casi-prova/`, i casi che provano il banco stesso):
//! `{"casi": [ … ]}`, e ogni caso ha
//!
//! - `id` e `fonte` (di serie `motore`): la riga della mappa che prova;
//! - `disegno`: il nome di un `.svg` nella cartella accanto
//!   (`tests/famiglie/<famiglia>/`), o il testo stesso se comincia con `<`;
//! - `selezione` e `argomenti` (il `value` del comando; per un effetto i
//!   suoi valori, `{"effect": id, "params": argomenti}`, e senza quelli di
//!   serie);
//! - `prima`, facoltativo: i comandi che preparano il motore prima del caso,
//!   ognuno `{"id", "selezione"?, "argomenti"?}`, in ordine sullo stesso
//!   disegno (copiare o importare negli appunti; ogni caso parte da un motore
//!   nuovo). Un passo che cambia il disegno o rifiuta fa cadere il caso;
//! - `gesto`, per uno strumento: i passi del gesto, ognuno
//!   `{"phase", "events", "inputs"}`; l'esito è quello dell'ultimo;
//! - `atteso`: `{"ops": […]}` (gli id nuovi sono id validi qualunque: il
//!   confronto li rinomina nell'ordine), `{"lettura": …}`,
//!   `{"selezione": […]}` (niente operazioni, niente lettura, e la selezione
//!   dopo, gli id di Fub nell'ordine; un gesto che sceglie e basta può
//!   rispondere `empty`, come in K5),
//!   `{"rifiuto": "unsupported"}` o `{"errore": "bad_args"}`; in una lettura un
//!   testo `"*"` vale qualunque testo (i byte di un PNG dipendono dalla build);
//! - `dopo`: il `.svg` del disegno dopo le operazioni, che il client
//!   controlla byte per byte; per un effetto anche l'oracolo a pixel lo
//!   confronta col disegno del motore stesso, e con il disegno di partenza
//!   a cui si applicano le operazioni che Fub ha dato (`common::applica`):
//!   ciò che Fub scrive sul disco;
//! - `prova`, per una voce dell'interfaccia o un pannello (che il motore non
//!   esegue): il test del client che la prova, che deve esistere e nominare
//!   l'id. Anche uno strumento della vista (`hand`, `zoom`, `rotateView`)
//!   ha solo la `prova`, senza gesto: il motore non lo fa (è un suo
//!   strumento vuoto), la vista è di Fub.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fub_abi::{DrawingCommandRequest, DrawingGesture, DrawingOutcome, DRAWING_FAMILIES};
use fub_disegno::catalogo::{FonteMappa, RigaMappa, Stato};
use fub_disegno::famiglie::{Filtro, PREFISSO};
use fub_disegno::motore::{Disegni, Disegno};
use fub_testkit::pixel::{confronta, disegna, Opzioni};
use serde_json::{json, Value};

use super::common;

/// La larghezza delle immagini dell'oracolo, come il cancello di K5.
pub const LARGHEZZA: u32 = 1000;
/// La differenza di un canale sotto cui due pixel sono uguali (K5).
pub const SOGLIA: u8 = 8;
/// La parte di pixel diversi oltre cui due disegni non sono uguali (K5).
pub const TETTO: f64 = 0.002;

/// La cartella dei casi delle famiglie.
pub fn cartella_famiglie() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/famiglie")
}

/// La cartella dei casi che provano il banco.
pub fn cartella_prova() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/casi-prova")
}

/// Che cosa deve dare un caso.
#[derive(Clone, Debug, PartialEq)]
pub enum Atteso {
    Ops(Value),
    Lettura(Value),
    /// Una lettura in parte: i campi dell'atteso (`lettura_parziale`), per le letture
    /// con campi che cambiano da una prova all'altra.
    LetturaParziale(Value),
    /// Nessuna operazione e nessuna lettura: la selezione dopo, gli id di Fub.
    Selezione(Vec<String>),
    /// Un rifiuto del motore, come lo scrive il contratto (`unsupported`).
    Rifiuto(String),
    /// Un errore tipato, col suo `kind` (`bad_args`).
    Errore(String),
}

/// Un caso letto, col disegno già preso dal suo file.
#[derive(Clone, Debug)]
pub struct Caso {
    /// Il file dei casi (senza `.json`): la famiglia, o un nome di prova.
    pub gruppo: String,
    pub fonte: FonteMappa,
    pub id: String,
    pub disegno: String,
    pub selezione: Vec<String>,
    pub argomenti: Value,
    pub gesto: Vec<Value>,
    pub atteso: Atteso,
    /// Il testo del disegno dopo, se il caso lo dà.
    pub dopo: Option<String>,
    /// Il test del client che prova una voce dell'interfaccia.
    pub prova: Option<String>,
    /// I passi che preparano il motore prima del comando del caso (`prima`):
    /// copiare o importare negli appunti, senza operazioni. Girano in ordine
    /// sullo stesso disegno, perché ogni caso parte da un motore nuovo.
    pub prima: Vec<Passo>,
}

/// Un passo di `prima`: un comando del motore, con la sua selezione e i suoi
/// argomenti, che non cambia il disegno.
#[derive(Clone, Debug)]
pub struct Passo {
    /// L'id del comando del motore, senza il prefisso `disegno.`.
    pub id: String,
    pub selezione: Vec<String>,
    pub argomenti: Value,
}

impl Caso {
    /// Come si chiama nei messaggi.
    pub fn nome(&self) -> String {
        format!("{}:{}:{}", self.gruppo, self.fonte.nome(), self.id)
    }
}

/// Il testo di un `.svg` dei casi, con gli a capo di Unix.
fn leggi_svg(cartella: &Path, nome: &str) -> Result<String, String> {
    if nome.trim_start().starts_with('<') {
        return Ok(nome.to_string());
    }
    let file = cartella.join(nome);
    std::fs::read_to_string(&file)
        .map(|t| t.replace("\r\n", "\n"))
        .map_err(|e| format!("{}: {e}", file.display()))
}

/// I casi di un file.
pub fn leggi_file(file: &Path) -> Result<Vec<Caso>, String> {
    let gruppo = file
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("{}: il nome non si legge", file.display()))?
        .to_string();
    let accanto = file.with_file_name(&gruppo);
    let testo = std::fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let radice: Value =
        serde_json::from_str(&testo).map_err(|e| format!("{}: {e}", file.display()))?;
    let elenco = match &radice {
        Value::Array(a) => a.clone(),
        Value::Object(o) => o
            .get("casi")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| format!("{}: manca `casi`", file.display()))?,
        _ => {
            return Err(format!(
                "{}: né un elenco né `{{\"casi\": …}}`",
                file.display()
            ))
        }
    };
    let mut casi = Vec::new();
    for (n, v) in elenco.iter().enumerate() {
        let dove = format!("{} caso {n}", file.display());
        let id = v["id"]
            .as_str()
            .ok_or_else(|| format!("{dove}: manca l'id"))?
            .to_string();
        let fonte = match v.get("fonte").and_then(Value::as_str) {
            None => FonteMappa::Motore,
            Some(f) => FonteMappa::da_nome(f).ok_or_else(|| format!("{dove}: la fonte «{f}»"))?,
        };
        let atteso = &v["atteso"];
        let atteso = if let Some(ops) = atteso.get("ops") {
            Atteso::Ops(ops.clone())
        } else if let Some(l) = atteso.get("lettura") {
            Atteso::Lettura(l.clone())
        } else if let Some(l) = atteso.get("lettura_parziale") {
            Atteso::LetturaParziale(l.clone())
        } else if let Some(s) = atteso.get("selezione").and_then(Value::as_array) {
            Atteso::Selezione(
                s.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect(),
            )
        } else if let Some(r) = atteso.get("rifiuto").and_then(Value::as_str) {
            Atteso::Rifiuto(r.to_string())
        } else if let Some(e) = atteso.get("errore").and_then(Value::as_str) {
            Atteso::Errore(e.to_string())
        } else if solo_prova(fonte, &id) {
            Atteso::Lettura(Value::Null)
        } else {
            return Err(format!(
                "{dove}: `atteso` vuole ops, lettura, selezione, rifiuto o errore"
            ));
        };
        let disegno = match v.get("disegno").and_then(Value::as_str) {
            Some(d) => leggi_svg(&accanto, d).map_err(|e| format!("{dove}: {e}"))?,
            None if solo_prova(fonte, &id) => String::new(),
            None => return Err(format!("{dove}: manca il disegno")),
        };
        let dopo = match v.get("dopo").and_then(Value::as_str) {
            Some(d) => Some(leggi_svg(&accanto, d).map_err(|e| format!("{dove}: {e}"))?),
            None => None,
        };
        casi.push(Caso {
            gruppo: gruppo.clone(),
            fonte,
            id,
            disegno,
            selezione: v["selezione"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            argomenti: v.get("argomenti").cloned().unwrap_or_else(|| json!({})),
            gesto: v["gesto"].as_array().cloned().unwrap_or_default(),
            atteso,
            dopo,
            prova: v.get("prova").and_then(Value::as_str).map(str::to_string),
            prima: leggi_prima(v, &dove)?,
        });
    }
    Ok(casi)
}

/// I passi di `prima` di un caso: un elenco di `{"id", "selezione"?,
/// "argomenti"?}`, senza `prima` un elenco vuoto.
fn leggi_prima(v: &Value, dove: &str) -> Result<Vec<Passo>, String> {
    let Some(passi) = v.get("prima") else {
        return Ok(Vec::new());
    };
    let passi = passi
        .as_array()
        .ok_or_else(|| format!("{dove}: `prima` vuole un elenco"))?;
    passi
        .iter()
        .map(|p| {
            let id = p["id"]
                .as_str()
                .ok_or_else(|| format!("{dove}: un passo di `prima` vuole l'id"))?
                .to_string();
            Ok(Passo {
                id,
                selezione: p["selezione"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|s| s.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                argomenti: p.get("argomenti").cloned().unwrap_or_else(|| json!({})),
            })
        })
        .collect()
}

/// Gli strumenti della vista: il motore non li fa (sono suoi strumenti
/// vuoti, `NoopTool`), la vista di Fub sì. Il loro caso è la prova del client.
pub const STRUMENTI_DELLA_VISTA: [&str; 3] = ["hand", "zoom", "rotateView"];

/// Una riga che il motore non esegue: il suo caso è solo la prova del client.
pub fn solo_prova(fonte: FonteMappa, id: &str) -> bool {
    matches!(fonte, FonteMappa::Interfaccia | FonteMappa::Pannello)
        || (fonte == FonteMappa::Strumento && STRUMENTI_DELLA_VISTA.contains(&id))
}

/// I casi di tutti i `.json` di una cartella, in ordine di nome.
pub fn leggi_cartella(cartella: &Path) -> Result<Vec<Caso>, String> {
    let mut file: Vec<PathBuf> = std::fs::read_dir(cartella)
        .map_err(|e| format!("{}: {e}", cartella.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    file.sort();
    let mut casi = Vec::new();
    for f in file {
        casi.extend(leggi_file(&f)?);
    }
    Ok(casi)
}

/// Un motore del disegno che esegue anche le righe da fare.
pub fn disegni_di_prova() -> Arc<Disegni> {
    let d = common::disegni();
    d.filtra(Filtro::Tutte);
    d
}

/// Una famiglia vera (una delle 26), non `fub` né `escluso`.
pub fn famiglia_vera(famiglia: &str) -> bool {
    DRAWING_FAMILIES.contains(&famiglia)
}

/// Le righe e i casi che non si tengono: una riga fatta di una famiglia
/// vera senza caso, un caso senza riga, un caso nel file di un'altra
/// famiglia. `file` dice quali file di casi ci sono.
pub fn controlla_righe(righe: &[RigaMappa], casi: &[Caso], file: &[String]) -> Vec<String> {
    let mut errori = Vec::new();
    for r in righe {
        if r.stato == Stato::Fatto
            && famiglia_vera(&r.famiglia)
            && !casi.iter().any(|c| c.fonte == r.fonte && c.id == r.id)
        {
            errori.push(format!(
                "la riga fatta {} «{}» non ha un caso in tests/famiglie/{}.json",
                r.fonte.nome(),
                r.id,
                r.famiglia
            ));
        }
    }
    for c in casi {
        match righe.iter().find(|r| r.fonte == c.fonte && r.id == c.id) {
            None => errori.push(format!("il caso {} non ha una riga nella mappa", c.nome())),
            Some(r) if r.famiglia != c.gruppo => errori.push(format!(
                "il caso {} sta nel file di «{}», ma la riga è della famiglia «{}»",
                c.nome(),
                c.gruppo,
                r.famiglia
            )),
            Some(_) => {}
        }
    }
    for f in DRAWING_FAMILIES {
        if !file.iter().any(|x| x == f) {
            errori.push(format!("manca il file dei casi tests/famiglie/{f}.json"));
        }
    }
    errori
}

/// Il testo di un esito: rifiuto, operazioni o lettura.
fn esito_in_breve(e: &DrawingOutcome) -> String {
    format!(
        "rifiuto {:?}, ops {:?}, lettura {:?}",
        e.refused,
        e.ops
            .as_deref()
            .map(|o| o.chars().take(400).collect::<String>()),
        e.reading
    )
}

/// Il nome di un rifiuto, come nel contratto.
fn nome_del_rifiuto(r: fub_abi::DrawingRefusal) -> String {
    serde_json::to_value(r)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Il `kind` di un errore tipato.
fn tipo_dell_errore(e: &fub_abi::PluginError) -> String {
    serde_json::to_value(e)
        .ok()
        .and_then(|v| v["kind"].as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Il valore di `effect.apply` per un effetto: l'effetto e, se il caso ne
/// dà, i suoi valori (`params`); senza, quelli di serie.
pub fn valore_dell_effetto(caso: &Caso) -> Value {
    match &caso.argomenti {
        Value::Object(o) if !o.is_empty() => json!({ "effect": caso.id, "params": o }),
        _ => json!({ "effect": caso.id }),
    }
}

/// Esegue il comando o il gesto del caso su `disegno`.
fn esegui_sul_disegno(
    disegno: &mut Disegno,
    caso: &Caso,
) -> Result<Result<DrawingOutcome, fub_abi::PluginError>, String> {
    let revisione = disegno.revisione();
    let comando = |id: String, valore: Value| DrawingCommandRequest {
        revision: revisione,
        id,
        selection: caso.selezione.clone(),
        value: valore,
        preview: false,
    };
    Ok(match caso.fonte {
        FonteMappa::Motore => disegno.comando(comando(
            format!("{PREFISSO}{}", caso.id),
            caso.argomenti.clone(),
        )),
        FonteMappa::Effetto => disegno.comando(comando(
            format!("{PREFISSO}effect.apply"),
            valore_dell_effetto(caso),
        )),
        FonteMappa::Strumento => {
            if caso.gesto.is_empty() {
                return Err(format!("{}: uno strumento vuole un gesto", caso.nome()));
            }
            let mut ultimo = None;
            for passo in &caso.gesto {
                let richiesta: DrawingGesture = serde_json::from_value(json!({
                    "phase": passo["phase"].as_str().unwrap_or("commit"),
                    "tool": { "engine": { "id": caso.id } },
                    "layer": passo.get("layer").cloned().unwrap_or(Value::Null),
                    "selection": caso.selezione,
                    "zoom": 1,
                    "snap": { "grid": null, "free": false },
                    "style": passo.get("style").cloned().unwrap_or_else(
                        || json!({ "stroke": "#000000", "width": 2, "fill": null })
                    ),
                    "events": passo.get("events").cloned().unwrap_or_else(|| json!([])),
                    "inputs": passo.get("inputs").cloned().unwrap_or_else(|| json!([])),
                }))
                .map_err(|e| format!("{}: il gesto non si legge: {e}", caso.nome()))?;
                ultimo = Some(disegno.gesto(richiesta));
            }
            ultimo.expect("almeno un passo")
        }
        FonteMappa::Interfaccia | FonteMappa::Pannello => {
            return Err(format!(
                "{}: il motore non esegue l'interfaccia",
                caso.nome()
            ))
        }
    })
}

/// Fa girare un caso su un motore che esegue anche le righe da fare, e
/// controlla l'esito, che il motore torni al disegno di partenza e, per un
/// effetto, l'oracolo a pixel.
pub fn esegui(disegni: &Arc<Disegni>, caso: &Caso) -> Result<(), String> {
    let nome = caso.nome();
    if solo_prova(caso.fonte, &caso.id) {
        return controlla_la_prova(caso);
    }
    let (mut disegno, _) = Disegno::apri_con(disegni, &caso.disegno)
        .map_err(|e| format!("{nome}: il disegno non si apre: {e}"))?;
    // I passi di `prima` preparano il motore (gli appunti): non cambiano il
    // disegno, e uno che rifiuta fa cadere il caso.
    for passo in &caso.prima {
        let richiesta = DrawingCommandRequest {
            revision: disegno.revisione(),
            id: format!("{PREFISSO}{}", passo.id),
            selection: passo.selezione.clone(),
            value: passo.argomenti.clone(),
            preview: false,
        };
        match disegno.comando(richiesta) {
            Ok(e)
                if e.ops.is_none()
                    && matches!(e.refused, None | Some(fub_abi::DrawingRefusal::Empty)) => {}
            Ok(e) => {
                return Err(format!(
                    "{nome}: il passo «{}» di `prima` non prepara il motore: {}",
                    passo.id,
                    esito_in_breve(&e)
                ))
            }
            Err(e) => {
                return Err(format!(
                    "{nome}: il passo «{}» di `prima` è un errore: {e:?}",
                    passo.id
                ))
            }
        }
    }
    let esito = esegui_sul_disegno(&mut disegno, caso)?;
    // Le operazioni che Fub scrive, per l'oracolo dell'effetto.
    let mut scritte: Option<Value> = None;
    match (&caso.atteso, esito) {
        (Atteso::Errore(kind), Err(e)) if tipo_dell_errore(&e) == *kind => {}
        (atteso, Err(e)) => return Err(format!("{nome}: atteso {atteso:?}, errore {e:?}")),
        (Atteso::Ops(attese), Ok(e)) => {
            if e.refused.is_some() || e.ops.is_none() {
                return Err(format!(
                    "{nome}: attese le operazioni, {}",
                    esito_in_breve(&e)
                ));
            }
            let ottenute = common::ops_di(&e);
            if ottenute.as_array().is_none_or(|a| a.is_empty()) {
                return Err(format!(
                    "{nome}: le operazioni non sono un passo: {ottenute}"
                ));
            }
            if let common::Confronto::Diverse(dove) = common::confronta_ops(attese, &ottenute, None)
            {
                return Err(format!("{nome}: operazioni diverse: {dove}"));
            }
            scritte = Some(ottenute);
        }
        (Atteso::Lettura(attesa), Ok(e)) => {
            let letta = e.reading.clone().unwrap_or(Value::Null);
            if e.refused.is_some() || e.ops.is_some() {
                return Err(format!(
                    "{nome}: attesa una lettura, {}",
                    esito_in_breve(&e)
                ));
            }
            if let common::Confronto::Diverse(dove) = common::confronta_ops(attesa, &letta, None) {
                return Err(format!("{nome}: lettura diversa: {dove}"));
            }
        }
        (Atteso::LetturaParziale(attesa), Ok(e)) => {
            let letta = e.reading.clone().unwrap_or(Value::Null);
            if e.refused.is_some() || e.ops.is_some() {
                return Err(format!(
                    "{nome}: attesa una lettura, {}",
                    esito_in_breve(&e)
                ));
            }
            if let Err(dove) = common::parziale(attesa, &letta, "") {
                return Err(format!("{nome}: lettura diversa: {dove}"));
            }
        }
        (Atteso::Selezione(attesa), Ok(e)) => {
            // Un gesto che sceglie e basta risponde `empty` con la selezione
            // nuova (la convenzione di K5); un comando, senza rifiuto.
            let scelta = matches!(e.refused, None | Some(fub_abi::DrawingRefusal::Empty));
            if !scelta || e.ops.is_some() || e.reading.is_some() {
                return Err(format!(
                    "{nome}: attesa la sola selezione, {}",
                    esito_in_breve(&e)
                ));
            }
            if e.selection != *attesa {
                return Err(format!(
                    "{nome}: selezione {:?}, attesa {attesa:?}",
                    e.selection
                ));
            }
        }
        (Atteso::Rifiuto(atteso), Ok(e)) => match e.refused {
            Some(r) if nome_del_rifiuto(r) == *atteso => {}
            _ => {
                return Err(format!(
                    "{nome}: atteso il rifiuto «{atteso}», {}",
                    esito_in_breve(&e)
                ))
            }
        },
        (Atteso::Errore(kind), Ok(e)) => {
            return Err(format!(
                "{nome}: atteso l'errore «{kind}», {}",
                esito_in_breve(&e)
            ))
        }
    }
    // Il motore torna alla copia: senza modifiche, nessuna differenza.
    let di_nuovo = disegno
        .a_mano(|_, _| {})
        .map_err(|e| format!("{nome}: il motore non si rilegge: {e:?}"))?;
    if di_nuovo.ops.is_some() {
        return Err(format!(
            "{nome}: il motore non è tornato al disegno di partenza: {:?}",
            di_nuovo.ops
        ));
    }
    if caso.fonte == FonteMappa::Effetto {
        match (&caso.dopo, &caso.atteso) {
            (Some(dopo), _) => oracolo_dell_effetto(caso, dopo, scritte.as_ref())?,
            (None, Atteso::Ops(_)) => {
                return Err(format!("{nome}: un effetto vuole il disegno `dopo`"))
            }
            (None, _) => {}
        }
    }
    Ok(())
}

/// Una voce dell'interfaccia o un pannello: il test del client che la
/// prova c'è e la nomina.
fn controlla_la_prova(caso: &Caso) -> Result<(), String> {
    let nome = caso.nome();
    let prova = caso
        .prova
        .as_deref()
        .ok_or_else(|| format!("{nome}: una voce dell'interfaccia vuole la sua `prova`"))?;
    let file = common::radice().join(prova);
    let testo = std::fs::read_to_string(&file)
        .map_err(|e| format!("{nome}: la prova {}: {e}", file.display()))?;
    if !testo.contains(caso.id.as_str()) {
        return Err(format!("{nome}: la prova {prova} non nomina «{}»", caso.id));
    }
    Ok(())
}

/// Il disegno senza il foglio di Fub: il motore lo leggerebbe come un
/// oggetto, e l'effetto lo cambierebbe.
pub fn senza_foglio(testo: &str) -> String {
    testo
        .lines()
        .filter(|l| !l.contains("fub:role=\"paper\""))
        .collect::<Vec<_>>()
        .join("\n")
}

/// I caratteri di Fub, per l'oracolo.
pub fn facce() -> Vec<&'static [u8]> {
    vec![
        include_bytes!("../../../fub-features/fonts/inter-400.ttf"),
        include_bytes!("../../../fub-features/fonts/inter-700.ttf"),
        include_bytes!("../../../fub-features/fonts/literata-400.ttf"),
        include_bytes!("../../../fub-features/fonts/jetbrains-mono-400.ttf"),
    ]
}

/// Il disegno che il motore stesso fa dell'effetto: il disegno del caso
/// (senza foglio) importato in una sessione sua, tutto scelto, l'effetto
/// coi valori del caso, e l'esportazione della prima tavola.
pub fn disegno_del_motore(caso: &Caso) -> Result<String, String> {
    let nome = caso.nome();
    let documento = vectorcraft_svg::import(&senza_foglio(&caso.disegno))
        .map_err(|e| format!("{nome}: il motore non importa il disegno: {e}"))?;
    let valore = valore_dell_effetto(caso);
    vectorcraft_engine::guard::catch_panic(move || {
        let mut sessione = vectorcraft_engine::Session::new();
        sessione.add_document(documento, None);
        sessione
            .execute("select.all", &json!({}))
            .map_err(|e| format!("select.all: {e}"))?;
        sessione
            .execute("effect.apply", &valore)
            .map_err(|e| format!("effect.apply: {e}"))?;
        let doc = &sessione.doc().map_err(|e| e.to_string())?.doc;
        Ok(vectorcraft_svg::export(
            doc,
            &vectorcraft_svg::ExportOptions {
                artboard: Some(0),
                ..Default::default()
            },
        ))
    })
    .map_err(|e| format!("{nome}: il motore è caduto: {e}"))?
    .map_err(|e: String| format!("{nome}: {e}"))
}

/// Le operazioni che Fub scrive per il caso, come le dà il motore (senza
/// il confronto con quelle attese): per le prove dell'oracolo.
pub fn ops_scritte(disegni: &Arc<Disegni>, caso: &Caso) -> Result<Value, String> {
    let nome = caso.nome();
    let (mut disegno, _) = Disegno::apri_con(disegni, &caso.disegno)
        .map_err(|e| format!("{nome}: il disegno non si apre: {e}"))?;
    let esito =
        esegui_sul_disegno(&mut disegno, caso)?.map_err(|e| format!("{nome}: errore {e:?}"))?;
    if esito.ops.is_none() {
        return Err(format!(
            "{nome}: nessuna operazione, {}",
            esito_in_breve(&esito)
        ));
    }
    Ok(common::ops_di(&esito))
}

/// L'oracolo di K5: il disegno `dopo` e quello del motore, a pixel, con la
/// tolleranza del cancello. Con le operazioni `scritte` (quelle che Fub ha
/// dato per il caso) anche il disegno di partenza con quelle applicate,
/// cioè ciò che Fub scrive davvero sul disco, è uguale a `dopo` e al
/// disegno del motore.
pub fn oracolo_dell_effetto(
    caso: &Caso,
    dopo: &str,
    scritte: Option<&Value>,
) -> Result<(), String> {
    let nome = caso.nome();
    let facce = facce();
    let opzioni = Opzioni {
        larghezza: LARGHEZZA,
        facce: &facce,
    };
    let del_motore = disegno_del_motore(caso)?;
    let a = disegna(&senza_foglio(dopo), &opzioni).map_err(|e| format!("{nome}: dopo: {e}"))?;
    let b = disegna(&del_motore, &opzioni).map_err(|e| format!("{nome}: motore: {e}"))?;
    let uguali = |x, y, cosa: &str| -> Result<(), String> {
        let c = confronta(x, y, SOGLIA, None).map_err(|e| format!("{nome}: {e}"))?;
        let parte = c.diversi as f64 / c.totali.max(1) as f64;
        if parte > TETTO {
            return Err(format!(
                "{nome}: {cosa} differiscono in {} pixel su {} ({:?})",
                c.diversi, c.totali, c.riquadro
            ));
        }
        Ok(())
    };
    uguali(&a, &b, "il disegno dopo e quello del motore")?;
    if let Some(ops) = scritte {
        let scritto = common::applica::applica(&caso.disegno, ops)
            .map_err(|e| format!("{nome}: le operazioni di Fub non si applicano: {e}"))?;
        let s = disegna(&senza_foglio(&scritto), &opzioni)
            .map_err(|e| format!("{nome}: scritto: {e}"))?;
        uguali(&s, &b, "il disegno che Fub scrive e quello del motore")?;
        uguali(&s, &a, "il disegno che Fub scrive e il disegno dopo")?;
    }
    Ok(())
}
