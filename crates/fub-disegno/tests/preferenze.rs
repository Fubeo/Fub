//! Le preferenze del motore come impostazione di Fub (piano K6, T11): un
//! disegno nasce con le preferenze di `draw.motore`, i comandi `prefs.*` le
//! leggono e le cambiano senza le cartelle, e l'istanza dice all'host che
//! cosa è cambiato, così l'host lo salva o lo rimette.

mod common;

use common::disegni;
use fub_abi::{DrawingCommandRequest, PluginError, DRAWING_COMMAND_STROKE_COLOR};
use fub_disegno::motore::Disegno;
use fub_disegno::preferenze::CARTELLE;
use serde_json::{json, Map, Value};

const DISEGNO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\" stroke=\"#000000\" stroke-width=\"2\"/>\n  </g>\n</svg>\n";

fn richiesta(id: &str, selezione: &[&str], valore: Value) -> DrawingCommandRequest {
    DrawingCommandRequest {
        revision: 0,
        id: id.into(),
        selection: selezione.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    }
}

fn mappa(v: Value) -> Map<String, Value> {
    v.as_object().cloned().expect("un oggetto")
}

fn apri(salvate: Value) -> (Disegno, Vec<String>) {
    let (disegno, _, avvisi) = Disegno::apri_con_preferenze(&disegni(), DISEGNO, &mappa(salvate))
        .unwrap_or_else(|e| panic!("il disegno non si apre: {e}"));
    (disegno, avvisi)
}

/// La lettura di un comando delle preferenze.
fn leggi(d: &mut Disegno, id: &str, valore: Value) -> Value {
    let esito = d
        .comando(richiesta(id, &[], valore))
        .expect("la richiesta vale");
    assert_eq!(esito.refused, None, "{esito:?}");
    assert!(esito.ops.is_none(), "le preferenze non cambiano il testo");
    esito.reading.expect("una lettura")
}

#[test]
fn il_disegno_nasce_con_le_preferenze_salvate_e_salta_quelle_che_non_valgono() {
    let (mut d, avvisi) = apri(json!({
        "keyboardIncrement": 4.0,
        "constrainAngle": "storto",
        "fontsFolder": "/etc",
    }));
    assert_eq!(avvisi.len(), 2, "{avvisi:?}");
    assert_eq!(
        leggi(
            &mut d,
            "disegno.prefs.get",
            json!({"key": "keyboardIncrement"})
        ),
        json!(4.0)
    );
    assert_eq!(d.preferenze()["constrainAngle"], json!(0.0));
    assert!(
        d.prendi_le_preferenze_cambiate().vuoto(),
        "aprire non è un cambio"
    );
}

#[test]
fn prefs_set_cambia_e_l_istanza_lo_dice_una_volta() {
    let (mut d, _) = apri(json!({}));
    leggi(
        &mut d,
        "disegno.prefs.set",
        json!({"key": "keyboardIncrement", "value": 3}),
    );
    let cambio = d.prendi_le_preferenze_cambiate();
    assert_eq!(cambio.dopo, mappa(json!({"keyboardIncrement": 3.0})));
    assert_eq!(cambio.prima, mappa(json!({"keyboardIncrement": 1.0})));
    assert!(d.prendi_le_preferenze_cambiate().vuoto());

    // Un altro comando non le rimette com'erano e non è un cambio.
    let esito = d
        .comando(richiesta(
            DRAWING_COMMAND_STROKE_COLOR,
            &["oa1a1a1a1"],
            json!("#ff0000"),
        ))
        .expect("vale");
    assert_eq!(esito.refused, None);
    assert!(d.prendi_le_preferenze_cambiate().vuoto());
    assert_eq!(d.preferenze()["keyboardIncrement"], json!(3.0));

    // Leggere non cambia niente.
    leggi(&mut d, "disegno.prefs.list", json!({}));
    assert!(d.prendi_le_preferenze_cambiate().vuoto());
}

#[test]
fn rimettere_torna_al_valore_di_prima() {
    let (mut d, _) = apri(json!({}));
    leggi(
        &mut d,
        "disegno.prefs.set",
        json!({"values": {"keyboardIncrement": 7, "gridSubdivisions": 4}}),
    );
    let cambio = d.prendi_le_preferenze_cambiate();
    assert_eq!(cambio.dopo.len(), 2, "{cambio:?}");
    d.rimetti_le_preferenze(&cambio.prima);
    assert_eq!(d.preferenze()["keyboardIncrement"], json!(1.0));
    assert!(d.prendi_le_preferenze_cambiate().vuoto());
}

#[test]
fn prefs_reset_torna_ai_valori_di_serie_e_lo_dice() {
    let (mut d, _) = apri(json!({"keyboardIncrement": 9.0}));
    leggi(
        &mut d,
        "disegno.prefs.reset",
        json!({"category": "General"}),
    );
    let cambio = d.prendi_le_preferenze_cambiate();
    assert_eq!(cambio.dopo["keyboardIncrement"], json!(1.0));
}

#[test]
fn le_cartelle_non_si_leggono_ne_si_scrivono() {
    let (mut d, _) = apri(json!({}));
    let elenco = leggi(&mut d, "disegno.prefs.list", json!({}));
    let chiavi: Vec<&str> = elenco
        .as_array()
        .expect("un elenco")
        .iter()
        .filter_map(|r| r["key"].as_str())
        .collect();
    assert!(chiavi.contains(&"keyboardIncrement"));
    let tutte = leggi(&mut d, "disegno.prefs.get", json!({}));
    for cartella in CARTELLE {
        assert!(!chiavi.contains(&cartella), "{cartella} nell'elenco");
        assert!(tutte["prefs"].get(cartella).is_none(), "{cartella} in get");
        let scrivi = d.comando(richiesta(
            "disegno.prefs.set",
            &[],
            json!({"key": cartella, "value": "/tmp"}),
        ));
        assert!(
            matches!(scrivi, Err(PluginError::BadArgs(_))),
            "{cartella}: {scrivi:?}"
        );
    }
    assert!(d.prendi_le_preferenze_cambiate().vuoto());
}

#[test]
fn un_valore_che_non_vale_e_bad_args_e_non_cambia_niente() {
    let (mut d, _) = apri(json!({}));
    let esito = d.comando(richiesta(
        "disegno.prefs.set",
        &[],
        json!({"key": "keyboardIncrement", "value": "tanto"}),
    ));
    assert!(matches!(esito, Err(PluginError::BadArgs(_))), "{esito:?}");
    assert!(d.prendi_le_preferenze_cambiate().vuoto());
}
