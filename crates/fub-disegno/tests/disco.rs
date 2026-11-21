//! Il motore del disegno non tocca il disco (piano K6, T28;
//! `docs/architecture/disegno-completo.md#il-disco`).
//!
//! Prima di toccare il motore, le cartelle in cui un programma scrive di
//! solito (`HOME`, le `XDG_*`, `TMPDIR`, `APPDATA`, `LOCALAPPDATA`) e la
//! cartella corrente diventano cartelle vuote del test. Ambiente e cartella
//! corrente sono del processo: si preparano una volta ([`ambiente`]), così la
//! prova vale sia con `cargo test` sia con nextest. Poi un disegno del corpus
//! si apre, cambia e torna indietro solo come byte; ogni comando del motore
//! che prende un percorso si rifiuta prima del motore; e dopo ogni caso le
//! cartelle sono ancora vuote. Così anche dopo ogni caso del banco delle
//! righe (`tests/famiglie/` e `tests/casi-prova/`, piano K6, T5).

#[cfg(feature = "completo")]
mod casi;
mod common;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use fub_abi::{
    DrawingChange, DrawingCommandRequest, DrawingSync, PluginError, DRAWING_COMMAND_STROKE_COLOR,
};
use fub_disegno::disco;
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};
use vectorcraft_engine::file_access;

/// Le variabili d'ambiente che puntano dove un programma legge e scrive i
/// suoi file.
const VARIABILI: [&str; 8] = [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "TMPDIR",
    "APPDATA",
    "LOCALAPPDATA",
];

/// Le cartelle del test: una per variabile, più la cartella corrente.
struct Ambiente {
    radice: PathBuf,
    cartelle: Vec<PathBuf>,
    corrente: PathBuf,
}

/// L'ambiente del processo, preparato una volta prima di toccare il motore.
fn ambiente() -> &'static Ambiente {
    static AMBIENTE: OnceLock<Ambiente> = OnceLock::new();
    AMBIENTE.get_or_init(|| {
        let radice =
            Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("disco-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&radice);
        let mut cartelle = Vec::new();
        for variabile in VARIABILI {
            let cartella = radice.join(variabile.to_lowercase());
            std::fs::create_dir_all(&cartella).expect("la cartella del test");
            std::env::set_var(variabile, &cartella);
            cartelle.push(cartella);
        }
        let corrente = radice.join("corrente");
        std::fs::create_dir_all(&corrente).expect("la cartella corrente del test");
        std::env::set_current_dir(&corrente).expect("cambio la cartella corrente");
        Ambiente {
            radice,
            cartelle,
            corrente,
        }
    })
}

/// I casi girano uno alla volta: le cartelle sono di tutti.
fn in_fila() -> std::sync::MutexGuard<'static, ()> {
    static FILA: Mutex<()> = Mutex::new(());
    FILA.lock().unwrap_or_else(|e| e.into_inner())
}

/// Le cartelle del test sono ancora vuote, e accanto alla cartella corrente
/// non è nato niente (`../fuori`).
fn ancora_vuote(caso: &str) {
    let a = ambiente();
    for cartella in a.cartelle.iter().chain([&a.corrente]) {
        let dentro: Vec<_> = std::fs::read_dir(cartella)
            .expect("la cartella c'è")
            .filter_map(|e| e.ok().map(|e| e.file_name()))
            .collect();
        assert!(
            dentro.is_empty(),
            "{caso}: il motore ha scritto in {}: {dentro:?}",
            cartella.display()
        );
    }
    let mut accanto: Vec<String> = std::fs::read_dir(&a.radice)
        .expect("la radice del test")
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
        .collect();
    accanto.sort();
    let mut attese: Vec<String> = VARIABILI.iter().map(|v| v.to_lowercase()).collect();
    attese.push("corrente".into());
    attese.sort();
    assert_eq!(accanto, attese, "{caso}: il motore ha scritto accanto");
}

/// Un disegno del corpus (un modello di Fub), letto dal test.
fn dal_corpus() -> String {
    let file = common::radice().join("crates/fub-features/templates/diagram.it.svg");
    std::fs::read_to_string(&file)
        .unwrap_or_else(|e| panic!("{}: {e}", file.display()))
        .replace("\r\n", "\n")
}

fn richiesta(revisione: u64, id: &str, selezione: &[&str], valore: Value) -> DrawingCommandRequest {
    DrawingCommandRequest {
        revision: revisione,
        id: id.into(),
        selection: selezione.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    }
}

/// Un comando che deve rifiutarsi prima del motore, con l'argomento non
/// valido di K5 (A1).
fn rifiutato(d: &mut Disegno, id: &str, valore: Value) -> String {
    match d.comando(richiesta(0, id, &[], valore.clone())) {
        Err(PluginError::BadArgs(messaggio)) => messaggio.to_string(),
        altro => panic!("{id} {valore}: atteso il rifiuto prima del motore, ho {altro:?}"),
    }
}

#[test]
fn le_radici_del_processo_sono_quelle_vuote_di_disco() {
    let _fila = in_fila();
    ambiente();
    let (_d, _) = common::apri(&dal_corpus());
    let in_vigore = file_access::current().expect("il motore nasce con le radici in vigore");
    assert!(std::sync::Arc::ptr_eq(&in_vigore, disco::nessuna()));
    // Un secondo motore nello stesso processo trova le stesse radici.
    disco::confina().expect("le radici in vigore sono già quelle di disco.rs");
    assert!(file_access::check_read("/etc/hostname").is_err());
    assert!(file_access::check_write(&ambiente().corrente.join("x").to_string_lossy()).is_err());
    // I caratteri del sistema restano fuori.
    assert!(!vectorcraft_text::system_fonts());
    assert!(vectorcraft_text::system_font_dirs().is_empty());
    ancora_vuote("le radici");
}

#[test]
fn un_disegno_del_corpus_entra_cambia_ed_esce_come_byte() {
    let _fila = in_fila();
    ambiente();
    let testo = dal_corpus();
    let (mut d, aperto) = common::apri(&testo);
    assert!(aperto.mapped > 0, "{aperto:?}");
    // Un comando sul disegno: l'esito sono operazioni, non un file.
    let esito = d
        .comando(richiesta(
            0,
            DRAWING_COMMAND_STROKE_COLOR,
            &["oinizio01"],
            json!("#ff0000"),
        ))
        .expect("il comando vale");
    assert_eq!(esito.refused, None, "{esito:?}");
    assert!(esito.ops.is_some(), "{esito:?}");
    // Fub salva il testo cambiato e lo passa al motore: di nuovo byte.
    let cambiato = testo.replacen("stroke-width=\"4\"", "stroke-width=\"6\"", 1);
    assert_ne!(cambiato, testo);
    d.sincronizza(DrawingSync {
        revision: 1,
        change: DrawingChange::Text {
            text: cambiato.clone(),
        },
    })
    .expect("il testo intero passa");
    assert!(d.aspetta_il_reimport(std::time::Duration::from_secs(30)));
    assert_eq!(d.testo(), cambiato);
    let esito = d
        .comando(richiesta(
            1,
            DRAWING_COMMAND_STROKE_COLOR,
            &["oinizio01"],
            json!("#00ff00"),
        ))
        .expect("il comando vale");
    assert_eq!(esito.refused, None, "{esito:?}");
    ancora_vuote("apri, cambia, salva");
}

#[test]
fn ogni_comando_che_prende_un_percorso_si_rifiuta_prima_del_motore() {
    let _fila = in_fila();
    let a = ambiente();
    let (mut d, _) = common::apri(&dal_corpus());
    let percorsi = disco::percorsi();
    assert!(
        percorsi.len() > 20,
        "pochi comandi con un percorso: {percorsi:?}"
    );
    let valori = [
        json!("/etc/hostname"),
        json!(a.corrente.to_string_lossy()),
        json!("../fuori"),
    ];
    let mut ids: Vec<_> = percorsi.keys().copied().collect();
    ids.sort_unstable();
    for id in ids {
        for argomento in &percorsi[id] {
            for valore in &valori {
                for forma in [valore.clone(), json!([valore])] {
                    let messaggio = rifiutato(&mut d, id, json!({ argomento: forma }));
                    assert!(messaggio.contains(id), "{id}: {messaggio}");
                }
            }
        }
        ancora_vuote(id);
    }
}

#[test]
fn profili_preset_e_librerie_con_un_percorso_si_rifiutano() {
    let _fila = in_fila();
    ambiente();
    let (mut d, _) = common::apri(&dal_corpus());
    for (id, argomento) in [
        ("color.loadProfile", "path"),
        ("perspective.presets.import", "path"),
        ("swatch.library.load", "path"),
        ("brush.loadLibrary", "path"),
        ("library.import", "path"),
    ] {
        assert!(
            disco::percorsi()
                .get(id)
                .is_some_and(|a| a.iter().any(|x| x == argomento)),
            "{id}: lo schema non dice più `{argomento}`"
        );
        let messaggio = rifiutato(&mut d, id, json!({ argomento: "/etc/hostname" }));
        assert!(
            messaggio.contains("non prende percorsi"),
            "{id}: {messaggio}"
        );
        ancora_vuote(id);
    }
}

#[test]
fn i_comandi_esclusi_e_quelli_di_fub_non_arrivano_al_motore() {
    let _fila = in_fila();
    ambiente();
    let (mut d, _) = common::apri(&dal_corpus());
    let elenco = disco::elenco().expect("l'elenco si legge");
    assert!(!elenco.esclusi.is_empty() && !elenco.serviti.is_empty());
    for id in elenco.esclusi.keys().chain(elenco.serviti.iter()) {
        let messaggio = rifiutato(&mut d, id, json!({}));
        assert!(messaggio.contains(id.as_str()), "{id}: {messaggio}");
        ancora_vuote(id);
    }
}

#[cfg(feature = "completo")]
#[test]
fn ogni_caso_del_banco_delle_righe_lascia_le_cartelle_vuote() {
    let _fila = in_fila();
    ambiente();
    let mut tutti = casi::leggi_cartella(&casi::cartella_famiglie()).expect("i casi si leggono");
    tutti.extend(
        casi::leggi_file(&casi::cartella_prova().join("prova.json"))
            .expect("i casi di prova si leggono"),
    );
    assert!(!tutti.is_empty(), "almeno i casi di prova");
    let disegni = casi::disegni_di_prova();
    for caso in &tutti {
        if let Err(errore) = casi::esegui(&disegni, caso) {
            panic!("{errore}");
        }
        ancora_vuote(&caso.nome());
    }
}
