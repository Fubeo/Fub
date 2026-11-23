//! La riapertura dei file dell'Aspetto (K6 T15, aspetto; scenario «salva e riapri»): un file che il
//! disegno ha scritto si riapre con la stessa cosa, oppure la perdita è scritta nell'apertura.
//!
//! I file sono quelli che il disegno scrive: le operazioni di un comando si applicano al testo
//! (`common::applica`, come il client), il testo si riapre, e il comando dopo legge che cosa c'è.

#![cfg(feature = "completo")]

mod common;

use fub_abi::DrawingCommandRequest;
use serde_json::{json, Value};

/// Il «dopo» di Crea maschera di opacità su `base.svg` (oa1 e oe1): l'oggetto ha una maschera.
const MASCHERA: &str = include_str!("famiglie/aspetto/maschera-dopo.svg");

/// Il disegno di partenza dell'Aspetto (`base.svg`): un rettangolo rosso e un'ellisse blu.
const BASE: &str = include_str!("famiglie/aspetto/base.svg");

fn comando(id: &str, selezione: &[&str], valore: Value, revisione: u64) -> DrawingCommandRequest {
    DrawingCommandRequest {
        revision: revisione,
        id: id.into(),
        selection: selezione.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    }
}

/// Apre un testo con tutte le righe accese (il banco delle prove, come `famiglie.rs`).
fn apri_tutte(testo: &str) -> (fub_disegno::motore::Disegno, fub_abi::DrawingOpen) {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    fub_disegno::motore::Disegno::apri_con(&disegni, testo).expect("il disegno si apre")
}

/// Le operazioni che un comando dà, applicate al testo: il file che Fub scrive.
fn scritto(testo: &str, ops: &Option<String>) -> String {
    let ops: Value = serde_json::from_str(ops.as_deref().expect("il comando dà operazioni"))
        .expect("le operazioni sono JSON");
    common::applica::applica(testo, &ops).expect("le operazioni si applicano al testo")
}

#[test]
fn la_maschera_di_opacita_si_riapre_senza_perdite_e_resta_una_maschera() {
    let (mut disegno, aperto) = apri_tutte(MASCHERA);
    assert!(
        aperto.losses.is_empty(),
        "la riapertura non deve perdere niente: {:?}",
        aperto.losses
    );
    let esito = disegno
        .comando(comando(
            "disegno.transparency.opacityMaskInfo",
            &["oa1a1a1a1"],
            json!({}),
            aperto.revision,
        ))
        .expect("la lettura della maschera");
    let letta = esito.reading.expect("la lettura della maschera c'è");
    let maschere = letta.as_array().expect("un elenco di maschere");
    assert_eq!(maschere.len(), 1, "una maschera sola: {letta}");
    let m = &maschere[0];
    assert_eq!(m["clip"], json!(true), "{m}");
    assert_eq!(m["invert"], json!(false), "{m}");
    assert_eq!(m["disabled"], json!(false), "{m}");
    assert_eq!(m["linked"], json!(true), "{m}");
}

/// Svuota (`appearance.clear`) riscrive la ricetta dell'oggetto con la maschera in un corpo che non
/// disegna niente: l'import del motore non lo porta, e la ricetta, che vale, lo rimette al posto del suo
/// elemento (`ricetta::applica`). Il file si riapre senza perdite e l'oggetto resta una maschera; gli
/// altri comandi che riscrivono la ricetta sono in `ricette_riapertura.rs`.
#[test]
fn la_ricetta_riscritta_su_una_maschera_si_riapre_con_la_maschera() {
    let (mut disegno, aperto) = apri_tutte(MASCHERA);
    let svuotato = disegno
        .comando(comando(
            "disegno.appearance.clear",
            &["oa1a1a1a1"],
            json!({}),
            aperto.revision,
        ))
        .expect("Svuota");
    let testo = scritto(MASCHERA, &svuotato.ops);
    let (mut riaperto, riapre) = apri_tutte(&testo);
    assert!(
        riapre.losses.is_empty(),
        "perdite alla riapertura: {:?}",
        riapre.losses
    );
    let letta = riaperto
        .comando(comando(
            "disegno.transparency.opacityMaskInfo",
            &["oa1a1a1a1"],
            json!({}),
            riapre.revision,
        ))
        .expect("la lettura della maschera")
        .reading
        .expect("la lettura c'è");
    assert_eq!(
        letta.as_array().map(Vec::len),
        Some(1),
        "la maschera resta: {letta}"
    );
}

#[test]
fn un_oggetto_con_due_riempimenti_si_riapre_e_riduci_ne_toglie_uno_solo_una_volta() {
    // Il file con due riempimenti lo scrive la ricetta di Aggiungi riempimento, qui solo per avere il
    // file: Riduci ad aspetto di base su quel file dà un passo, e riaperto il file di Riduci non ne
    // dà più, perché c'è un riempimento solo.
    let (mut disegno, aperto) = apri_tutte(BASE);
    let con_due = disegno
        .comando(comando(
            "disegno.appearance.addFill",
            &["oa1a1a1a1"],
            json!({}),
            aperto.revision,
        ))
        .expect("Aggiungi riempimento");
    let testo_due = scritto(BASE, &con_due.ops);
    let (mut riaperto, riapre) = apri_tutte(&testo_due);
    assert!(riapre.losses.is_empty(), "perdite: {:?}", riapre.losses);
    let riduci = riaperto
        .comando(comando(
            "disegno.appearance.reduceToBasic",
            &["oa1a1a1a1"],
            json!({}),
            riapre.revision,
        ))
        .expect("Riduci ad aspetto di base");
    assert!(
        riduci.ops.is_some(),
        "due riempimenti riaperti: Riduci deve togliere uno: {riduci:?}"
    );
    let testo_uno = scritto(&testo_due, &riduci.ops);
    let (mut uno, aperto_uno) = apri_tutte(&testo_uno);
    assert!(
        aperto_uno.losses.is_empty(),
        "perdite: {:?}",
        aperto_uno.losses
    );
    let di_nuovo = uno
        .comando(comando(
            "disegno.appearance.reduceToBasic",
            &["oa1a1a1a1"],
            json!({}),
            aperto_uno.revision,
        ))
        .expect("Riduci ad aspetto di base");
    assert!(
        di_nuovo.ops.is_none(),
        "un riempimento solo riaperto: niente da togliere"
    );
    assert_eq!(di_nuovo.refused, Some(fub_abi::DrawingRefusal::Empty));
}
