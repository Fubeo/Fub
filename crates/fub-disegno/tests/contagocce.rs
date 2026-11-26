//! Le opzioni del Contagocce dalla fila del Completo (K6 T14, giro 8): ogni scelta
//! manda `disegno.eyedropper.setOptions` col valore giusto, il motore lo accetta e
//! `disegno.prefs.get` lo rilegge; il clic dopo un cambio usa le opzioni nuove.

mod common;

use common::{apri, ops_di};
use fub_abi::{DrawingCommandRequest, DrawingGesture, DrawingOutcome, DrawingRefusal, PluginError};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const DISEGNO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#ff0000\" stroke=\"#0000ff\" stroke-width=\"2\"/>\n    <rect id=\"ob2b2b2b2\" x=\"220\" y=\"100\" width=\"60\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n";

/// Il comando con il valore, sul disegno (nessuna selezione).
fn comando(d: &mut Disegno, id: &str, valore: Value) -> Result<DrawingOutcome, PluginError> {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: id.into(),
        selection: Vec::new(),
        value: valore,
        preview: false,
    })
}

/// La lettura delle preferenze del Contagocce (`disegno.prefs.get`).
fn letto(d: &mut Disegno) -> Value {
    let esito =
        comando(d, "disegno.prefs.get", json!({"key": "eyedropper"})).expect("la lettura vale");
    assert_eq!(esito.refused, None, "{esito:?}");
    esito.reading.expect("una lettura delle preferenze")
}

/// Un clic senza trascinare con lo strumento del Contagocce, sulla selezione `selezione`.
fn clic_contagocce(d: &mut Disegno, selezione: &[&str], x: f64, y: f64) -> DrawingOutcome {
    let evento = |kind: &str| json!({"kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false});
    let gesto: DrawingGesture = serde_json::from_value(json!({
        "phase": "commit",
        "tool": {"engine": {"id": "eyedropper"}},
        "layer": null,
        "selection": selezione,
        "zoom": 1,
        "snap": {"grid": null, "free": false},
        "style": null,
        "events": [evento("down"), evento("up")],
        "inputs": [],
    }))
    .expect("il gesto si legge");
    d.gesto(gesto).expect("il gesto")
}

/// Il valore che la fila manda per ogni scelta del campione e per ogni casella della copia,
/// come `opzioni-contagocce.ts` (`comandoDelCampione` e `comandoDellaCopia`).
fn valori_della_fila() -> Vec<Value> {
    let mut v: Vec<Value> = [1, 3, 5].iter().map(|n| json!({"sampleSize": n})).collect();
    for acceso in [false, true] {
        for ramo in [
            json!({"appearance": {"fill": acceso}}),
            json!({"appearance": {"stroke": acceso}}),
            json!({"appearance": {"transparency": acceso}}),
            json!({"character": acceso, "paragraph": acceso}),
        ] {
            v.push(json!({"pickUp": ramo.clone(), "apply": ramo}));
        }
    }
    v
}

/// Ogni foglia di `atteso` sta in `prefs` allo stesso percorso. Un bool su un ramo (`fill`)
/// vale per tutte le sue foglie, come dice il motore (`merge_flags`).
fn contiene(prefs: &Value, atteso: &Value, dove: &str) {
    match (atteso, prefs) {
        (Value::Object(o), _) => o
            .iter()
            .for_each(|(k, v)| contiene(&prefs[k], v, &format!("{dove}.{k}"))),
        (Value::Bool(b), Value::Object(_)) => foglie(prefs, *b, dove),
        _ => assert_eq!(prefs, atteso, "{dove}"),
    }
}

fn foglie(prefs: &Value, b: bool, dove: &str) {
    match prefs {
        Value::Object(o) => o
            .iter()
            .for_each(|(k, v)| foglie(v, b, &format!("{dove}.{k}"))),
        _ => assert_eq!(prefs, &Value::Bool(b), "{dove}"),
    }
}

#[test]
fn ogni_scelta_della_fila_e_accettata_dal_motore_e_torna_con_prefs_get() {
    let (mut d, _) = apri(DISEGNO);
    for valore in valori_della_fila() {
        let esito = comando(&mut d, "disegno.eyedropper.setOptions", valore.clone())
            .unwrap_or_else(|e| panic!("il motore rifiuta {valore}: {e:?}"));
        // `empty` vuol dire: il valore era già quello (il campione di serie), niente cambia.
        assert!(
            matches!(esito.refused, None | Some(DrawingRefusal::Empty)),
            "{valore}: {esito:?}"
        );
        contiene(&letto(&mut d), &valore, &valore.to_string());
    }
}

#[test]
fn il_campione_di_tre_punti_si_legge_come_scelto_e_un_numero_fuori_no() {
    let (mut d, _) = apri(DISEGNO);
    comando(
        &mut d,
        "disegno.eyedropper.setOptions",
        json!({"sampleSize": 3}),
    )
    .expect("3 punti");
    assert_eq!(letto(&mut d)["sampleSize"], json!(3));
    assert!(comando(
        &mut d,
        "disegno.eyedropper.setOptions",
        json!({"sampleSize": 4})
    )
    .is_err());
}

#[test]
fn con_il_riempimento_spento_il_clic_non_copia_il_riempimento_ma_il_contorno_si() {
    // Prima: con il riempimento acceso il clic porta il rosso di oa1 su ob2.
    let (mut d, _) = apri(DISEGNO);
    let acceso = clic_contagocce(&mut d, &["ob2b2b2b2"], 150.0, 125.0);
    let fill_acceso = ops_di(&acceso).to_string();
    assert!(
        fill_acceso.contains("#ff0000"),
        "il riempimento di serie: {fill_acceso}"
    );

    // Dopo: la casella del riempimento spenta (la fila manda questo ramo).
    let (mut d, _) = apri(DISEGNO);
    comando(
        &mut d,
        "disegno.eyedropper.setOptions",
        json!({"pickUp": {"appearance": {"fill": false}}, "apply": {"appearance": {"fill": false}}}),
    )
    .expect("riempimento spento");
    let spento = clic_contagocce(&mut d, &["ob2b2b2b2"], 150.0, 125.0);
    let ops = ops_di(&spento).to_string();
    assert!(
        !ops.contains("#ff0000"),
        "con il riempimento spento il rosso non arriva: {ops}"
    );
    assert!(ops.contains("#0000ff"), "il contorno resta copiato: {ops}");
}

#[test]
fn con_il_testo_spento_il_clic_sugli_oggetti_non_cambia_il_testo() {
    // Il testo non è coinvolto dal clic su un rettangolo: la prova è che il comando passa
    // con il ramo del testo spento, e che il motore lo accetta.
    let (mut d, _) = apri(DISEGNO);
    comando(
        &mut d,
        "disegno.eyedropper.setOptions",
        json!({"pickUp": {"character": false, "paragraph": false}, "apply": {"character": false, "paragraph": false}}),
    )
    .expect("testo spento");
    let prefs = letto(&mut d);
    assert_eq!(prefs["pickUp"]["character"], json!(false));
    let esito = clic_contagocce(&mut d, &["ob2b2b2b2"], 150.0, 125.0);
    assert_eq!(esito.refused, None, "{esito:?}");
}

#[test]
fn un_comando_del_punto_senza_il_prefisso_disegno_non_arriva_al_motore() {
    // La fila dei punti (opzioni-punto.ts) manda `path.convertAnchors`. Fub risponde solo agli id
    // con il prefisso `disegno.`: l'id nudo è `unsupported`, quello prefissato no.
    let (mut d, _) = apri(DISEGNO);
    let nudo = comando(
        &mut d,
        "path.convertAnchors",
        json!({"to": "corner", "anchors": []}),
    );
    let con_prefisso = comando(
        &mut d,
        "disegno.path.convertAnchors",
        json!({"to": "corner", "anchors": []}),
    );
    assert_eq!(
        nudo.map(|e| e.refused),
        Ok(Some(DrawingRefusal::Unsupported))
    );
    assert_ne!(
        con_prefisso.map(|e| e.refused),
        Ok(Some(DrawingRefusal::Unsupported))
    );
}
