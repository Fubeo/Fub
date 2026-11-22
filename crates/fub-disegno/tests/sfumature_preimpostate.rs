//! Le sfumature preimpostate della sezione Sfumatura (piano K6, T15, giro 6;
//! `docs/product/drawing-properties.md`): l'elenco del motore, applicarne una in
//! un passo con le regole di `paint.editGradient`, salvare quella degli oggetti
//! scelti e toglierla. Le salvate stanno nelle preferenze del motore, che l'host
//! tiene in `draw.motore`: l'istanza dice il cambio, e un disegno aperto con le
//! preferenze salvate le ritrova.

#![cfg(feature = "completo")]

mod common;

use common::{disegni, ops_di};
use fub_abi::{
    DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome, DrawingRefusal, PluginError,
};
use fub_disegno::motore::Disegno;
use fub_disegno::preferenze::{di_serie, e_di_serie};
use serde_json::{json, Map, Value};

/// Un rettangolo con una sfumatura privata, uno rosso pieno e un testo.
const DISEGNO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <defs id=\"fub-defs\">\n    <linearGradient id=\"rg1g1g1g1\" fub:role=\"private\" gradientUnits=\"userSpaceOnUse\" x1=\"100\" y1=\"125\" x2=\"200\" y2=\"125\">\n      <stop offset=\"0\" stop-color=\"#ff0000\"/>\n      <stop offset=\"1\" stop-color=\"#0000ff\"/>\n    </linearGradient>\n  </defs>\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"og1g1g1g1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"url(#rg1g1g1g1) #800080\" stroke=\"#000000\" stroke-width=\"2\"/>\n    <rect id=\"oa1a1a1a1\" x=\"250\" y=\"100\" width=\"100\" height=\"50\" fill=\"#ff0000\"/>\n    <text id=\"ot1t1t1t1\" x=\"100\" y=\"250\" fill=\"#000000\" font-family=\"Inter, sans-serif\" font-size=\"24\"><tspan x=\"100\" dy=\"0\">Ciao</tspan></text>\n  </g>\n</svg>\n";

fn apri(salvate: &Map<String, Value>) -> Disegno {
    let (disegno, _, avvisi) = Disegno::apri_con_preferenze(&disegni(), DISEGNO, salvate)
        .unwrap_or_else(|e| panic!("il disegno non si apre: {e}"));
    assert!(avvisi.is_empty(), "{avvisi:?}");
    disegno
}

fn comando(
    d: &mut Disegno,
    id: &str,
    scelti: &[&str],
    valore: Value,
) -> Result<DrawingOutcome, PluginError> {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: scelti.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    })
}

/// La lettura di un comando che non cambia il disegno.
fn leggi(d: &mut Disegno, id: &str, scelti: &[&str], valore: Value) -> Value {
    let esito = comando(d, id, scelti, valore).expect("la richiesta vale");
    assert_eq!(esito.refused, None, "{esito:?}");
    assert!(
        esito.ops.is_none(),
        "una lettura non cambia il disegno: {esito:?}"
    );
    esito.reading.expect("una lettura")
}

/// Le preimpostate dell'elenco: nome, tema e se è del motore.
fn elenco(d: &mut Disegno) -> Vec<(String, Value, bool)> {
    let lettura = leggi(d, "gradient.presets.list", &[], json!({}));
    lettura["presets"]
        .as_array()
        .expect("le preimpostate")
        .iter()
        .map(|p| {
            (
                p["name"].as_str().expect("il nome").to_string(),
                p["library"].clone(),
                p["builtIn"].as_bool().expect("builtIn"),
            )
        })
        .collect()
}

fn perche(d: &Disegno, id: &str, scelti: &[&str]) -> Option<DrawingDisabledReason> {
    let scelti: Vec<String> = scelti.iter().map(|s| s.to_string()).collect();
    let info = d
        .comandi(&scelti)
        .into_iter()
        .find(|c| c.id == format!("disegno.{id}"))
        .unwrap_or_else(|| panic!("{id} elencato"));
    assert_eq!(info.enabled, info.disabled_reason.is_none(), "{id}");
    info.disabled_reason
}

#[test]
fn l_elenco_ha_le_preimpostate_del_motore_per_tema() {
    let mut d = apri(&Map::new());
    let tutte = elenco(&mut d);
    assert!(tutte.len() > 40, "{tutte:?}");
    assert!(tutte
        .iter()
        .all(|(_, tema, del_motore)| *del_motore && tema.is_string()));
    assert_eq!(tutte[0].0, "Spectrum");
    assert!(tutte.iter().any(|(nome, _, _)| nome == "Dawn"));
    assert!(
        d.prendi_le_preferenze_cambiate().vuoto(),
        "leggere non cambia"
    );
}

#[test]
fn applicare_una_preimpostata_e_un_passo_con_le_regole_della_sfumatura() {
    let mut d = apri(&Map::new());
    // Sul rettangolo pieno: la sfumatura dell'Alba (tre punti) al riempimento, in un'operazione.
    let esito = comando(
        &mut d,
        "gradient.presets.apply",
        &["oa1a1a1a1"],
        json!({"name": "Dawn", "stroke": false}),
    )
    .expect("la richiesta vale");
    assert_eq!(esito.refused, None, "{esito:?}");
    let ops = ops_di(&esito);
    assert_eq!(
        ops.as_array().map(Vec::len),
        Some(1),
        "un passo solo: {ops}"
    );
    let testo = ops.to_string();
    assert_eq!(testo.matches(r#""tag":"stop""#).count(), 3, "{testo}");
    assert!(testo.contains(r#""fill":"url(#"#), "{testo}");
    // Sulla sfumatura che c'è: i punti cambiano, gli estremi restano.
    let esito = comando(
        &mut d,
        "gradient.presets.apply",
        &["og1g1g1g1"],
        json!({"name": "Dawn", "stroke": false}),
    )
    .expect("la richiesta vale");
    let testo = ops_di(&esito).to_string();
    assert!(
        testo.contains(r#""x1":"100""#) && testo.contains(r#""x2":"200""#),
        "{testo}"
    );
    // Spenta come paint.editGradient: senza scelta, su soli testi.
    use DrawingDisabledReason::*;
    assert_eq!(perche(&d, "gradient.presets.apply", &[]), Some(NoSelection));
    assert_eq!(
        perche(&d, "gradient.presets.apply", &["ot1t1t1t1"]),
        Some(NeedsPath)
    );
    assert_eq!(perche(&d, "gradient.presets.apply", &["oa1a1a1a1"]), None);
    // Un nome che non c'è è un errore della richiesta, e niente cambia.
    let errore = comando(
        &mut d,
        "gradient.presets.apply",
        &["oa1a1a1a1"],
        json!({"name": "Nessuna"}),
    );
    assert!(matches!(errore, Err(PluginError::BadArgs(_))), "{errore:?}");
}

#[test]
fn salvare_e_togliere_una_preimpostata_passa_dalle_preferenze() {
    let mut d = apri(&Map::new());
    // Niente da togliere: il motore non fa niente, e niente cambia.
    let vuota = comando(
        &mut d,
        "gradient.presets.delete",
        &[],
        json!({"name": "Mare"}),
    )
    .expect("la richiesta vale");
    assert_eq!(vuota.refused, Some(DrawingRefusal::Empty), "{vuota:?}");
    assert!(d.prendi_le_preferenze_cambiate().vuoto());
    let salvata = leggi(
        &mut d,
        "gradient.presets.save",
        &["og1g1g1g1"],
        json!({"name": "Mare"}),
    );
    assert_eq!(salvata, json!({"name": "Mare"}));
    // L'istanza dice il cambio all'host: prima la lista vuota, dopo con la preimpostata.
    let cambio = d.prendi_le_preferenze_cambiate();
    assert_eq!(cambio.prima.get("gradientPresets"), Some(&json!([])));
    let salvate = cambio.dopo.clone();
    let lista = &salvate["gradientPresets"];
    assert_eq!(lista[0]["name"], "Mare", "{lista}");
    assert!(!e_di_serie(&di_serie(), "gradientPresets", lista));
    let ultima = elenco(&mut d).pop().expect("l'ultima");
    assert_eq!(ultima, ("Mare".to_string(), Value::Null, false));
    // Un nome già preso è un errore, e niente cambia.
    let doppia = comando(
        &mut d,
        "gradient.presets.save",
        &["og1g1g1g1"],
        json!({"name": "mare"}),
    );
    assert!(matches!(doppia, Err(PluginError::BadArgs(_))), "{doppia:?}");
    assert!(d.prendi_le_preferenze_cambiate().vuoto());

    // Un disegno aperto con ciò che l'host ha salvato la ritrova.
    let mut altro = apri(&salvate);
    assert!(elenco(&mut altro)
        .iter()
        .any(|(nome, _, del_motore)| nome == "Mare" && !del_motore));
    // Una del motore non si toglie.
    let del_motore = comando(
        &mut altro,
        "gradient.presets.delete",
        &[],
        json!({"name": "Dawn"}),
    );
    assert!(
        matches!(del_motore, Err(PluginError::BadArgs(_))),
        "{del_motore:?}"
    );
    // Togliere l'ultima è un cambio: la lista vuota, che l'host non tiene.
    let tolta = leggi(
        &mut altro,
        "gradient.presets.delete",
        &[],
        json!({"name": "Mare"}),
    );
    assert_eq!(tolta, json!({"deleted": "Mare"}));
    let cambio = altro.prendi_le_preferenze_cambiate();
    assert_eq!(
        cambio.dopo.get("gradientPresets"),
        Some(&json!([])),
        "{cambio:?}"
    );
    assert!(e_di_serie(&di_serie(), "gradientPresets", &json!([])));
    assert!(!elenco(&mut altro).iter().any(|(nome, _, _)| nome == "Mare"));
}
