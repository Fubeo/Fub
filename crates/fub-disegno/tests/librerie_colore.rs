//! Le librerie di campioni (piano K6, T14, librerie; la famiglia `colore`): salvarne una
//! (`swatch.library.save`) e caricarne una dai suoi dati (`swatch.library.load`) sono letture del
//! motore. Il file del disegno non cambia e non c'è un passo d'annulla. Il banco dei casi
//! (`tests/famiglie/colore.json`) prova i comandi; qui si prova ciò che il banco non vede: che le
//! preferenze non tengono le librerie (un motore nuovo non le ritrova), che il motore non controlla il
//! nome già preso, che la copia nell'utente resta da fare, e le frasi in italiano.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::disegni;
use fub_abi::{DrawingCommandRequest, DrawingOutcome, DrawingRefusal, PluginError};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const CAMPIONI: &str = include_str!("famiglie/colore/campioni.svg");
const BASE: &str = include_str!("famiglie/colore/base.svg");
const GPL: &str = "GIMP Palette\nName: Mia\n#\n255   0   0 Rosso\n";

fn motore(filtro: Filtro) -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(filtro);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, _) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    d
}

fn comando(d: &mut Disegno, id: &str, valore: Value) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: vec![],
        value: valore,
        preview: false,
    })
    .expect("il comando gira")
}

fn errore_di(d: &mut Disegno, id: &str, valore: Value) -> String {
    match d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: vec![],
        value: valore,
        preview: false,
    }) {
        Err(PluginError::BadArgs(msg)) => msg.to_string(),
        altro => panic!("doveva dare bad_args: {altro:?}"),
    }
}

/// Le categorie delle librerie che il motore elenca: `loaded` sono quelle caricate in questa sessione.
fn categorie(d: &mut Disegno) -> Vec<String> {
    let lista = comando(d, "swatch.library.list", json!({}));
    let lettura = lista.reading.expect("l'elenco torna come lettura");
    lettura["libraries"]
        .as_array()
        .expect("le librerie sono un elenco")
        .iter()
        .map(|l| l["category"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[test]
fn salvare_una_libreria_torna_il_contenuto_e_non_cambia_il_disegno() {
    let ds = motore(Filtro::Tutte);
    let mut d = apri(&ds, CAMPIONI);
    let _ = d.prendi_le_preferenze_cambiate();
    let prima = d.testo().to_string();
    let salvata = comando(
        &mut d,
        "swatch.library.save",
        json!({ "format": "gpl", "name": "Mia" }),
    );
    assert!(salvata.refused.is_none(), "{salvata:?}");
    assert!(
        salvata.ops.is_none(),
        "salvare non è un passo del disegno: {salvata:?}"
    );
    assert_eq!(d.testo(), prima, "il disegno non cambia");
    let lettura = salvata.reading.expect("la libreria torna come lettura");
    assert_eq!(lettura["count"], json!(3));
    assert!(
        lettura["data"]
            .as_str()
            .is_some_and(|t| t.starts_with("GIMP Palette")),
        "{lettura}"
    );
    assert!(
        d.prendi_le_preferenze_cambiate().dopo.is_empty(),
        "salvare non tocca le preferenze"
    );
}

#[test]
fn caricare_una_libreria_la_tiene_nel_motore_ma_un_motore_nuovo_non_la_ritrova() {
    // Le preferenze non tengono le librerie: il motore le tiene nella sua sessione. Un motore nuovo,
    // anche con le preferenze di prima, non le ritrova. Dove stia la libreria salvata è la domanda
    // aperta (ui.saveSwatchLibrary, BLOCCATO).
    let ds = motore(Filtro::Tutte);
    let mut d = apri(&ds, BASE);
    let caricata = comando(
        &mut d,
        "swatch.library.load",
        json!({ "name": "Mia", "data": GPL }),
    );
    assert!(caricata.refused.is_none(), "{caricata:?}");
    assert!(
        caricata.ops.is_none(),
        "caricare non è un passo del disegno: {caricata:?}"
    );
    assert!(
        categorie(&mut d).contains(&"loaded".to_string()),
        "la libreria caricata si elenca"
    );
    let ds2 = motore(Filtro::Tutte);
    let mut nuovo = apri(&ds2, BASE);
    assert!(
        !categorie(&mut nuovo).contains(&"loaded".to_string()),
        "un motore nuovo non ha la libreria"
    );
}

#[test]
fn in_sola_lettura_si_salva_e_si_carica_una_libreria_il_colore_no() {
    let testo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\"><rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"100\" fill=\"#00ff00\"/></svg>";
    let ds = motore(Filtro::Tutte);
    let mut d = apri(&ds, testo);
    let prima = d.testo().to_string();
    let salvata = comando(&mut d, "swatch.library.save", json!({ "format": "gpl" }));
    assert!(salvata.refused.is_none(), "{salvata:?}");
    let caricata = comando(
        &mut d,
        "swatch.library.load",
        json!({ "name": "Mia", "data": GPL }),
    );
    assert!(caricata.refused.is_none(), "{caricata:?}");
    assert_eq!(d.testo(), prima, "il disegno in sola lettura non cambia");
    // Un colore del disegno, invece, si rifiuta: il disegno è davvero in sola lettura.
    let colore = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.paint.setFill".into(),
            selection: vec!["oa1a1a1a1".into()],
            value: json!({ "color": "#00aa00" }),
            preview: false,
        })
        .expect("il comando gira");
    assert!(
        matches!(colore.refused, Some(DrawingRefusal::Unsupported)),
        "{colore:?}"
    );
}

#[test]
fn un_nome_gia_preso_non_e_controllato_dal_motore() {
    // Il motore non tiene le librerie, quindi un nome già usato da una libreria caricata non è un errore
    // qui: il controllo spetta alla finestra, quando la libreria avrà un posto.
    let ds = motore(Filtro::Tutte);
    let mut d = apri(&ds, BASE);
    let _ = comando(
        &mut d,
        "swatch.library.load",
        json!({ "name": "Mia", "data": GPL }),
    );
    let salvata = comando(
        &mut d,
        "swatch.library.save",
        json!({ "name": "Mia", "format": "gpl" }),
    );
    assert!(salvata.refused.is_none(), "{salvata:?}");
}

#[test]
fn la_copia_nell_utente_resta_da_fare_e_non_arriva_al_motore() {
    // La riga è «da fare»: con il filtro di serie dell'IPC il comando non è servito («non ancora
    // pronto») e non arriva al motore. Due copie di fila danno lo stesso esito, e non c'è nessuna
    // cartella utente su disco che il motore possa scrivere.
    let ds = motore(Filtro::Fatte);
    let mut d = apri(&ds, BASE);
    for _ in 0..2 {
        let esito = d.comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.swatch.library.copyToUser".into(),
            selection: vec![],
            value: json!({ "library": "loaded/Mia" }),
            preview: false,
        });
        assert!(matches!(esito, Err(PluginError::Unserved(_))), "{esito:?}");
        assert!(
            format!("{esito:?}").contains("host.drawing.not_done"),
            "{esito:?}"
        );
    }
}

#[test]
fn i_rifiuti_delle_librerie_dicono_il_perche_in_italiano() {
    let ds = motore(Filtro::Tutte);
    let mut d = apri(&ds, CAMPIONI);
    assert_eq!(
        errore_di(&mut d, "swatch.library.save", json!({ "format": "pdf" })),
        "Il formato non c'è: scegli vcswatches, gpl, ase o css."
    );
    assert_eq!(
        errore_di(&mut d, "swatch.library.save", json!({ "name": "" })),
        "La libreria ha bisogno di un nome."
    );
    assert_eq!(
        errore_di(&mut d, "swatch.library.save", json!({ "user": true })),
        "Questa operazione non può scrivere o leggere un file."
    );
    assert_eq!(
        errore_di(&mut d, "swatch.library.load", json!({})),
        "La libreria da caricare non ha un contenuto: scegli di nuovo il file."
    );
    assert_eq!(
        errore_di(
            &mut d,
            "swatch.library.load",
            json!({ "dataBase64": "@@@" })
        ),
        "Il contenuto della libreria non si legge: scegli di nuovo il file."
    );
    assert_eq!(
        errore_di(
            &mut d,
            "swatch.library.load",
            json!({ "data": "non e' una libreria" })
        ),
        "Il file non è una libreria di campioni che Fub legge: sono vcswatches, gpl, ase o acb."
    );
}
