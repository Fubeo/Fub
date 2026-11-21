//! Gli strumenti del motore come sono (`DrawingTool::Engine`): la penna con
//! più clic in un gesto solo, il rettangolo del motore, il testo con l'IME;
//! i segni che tornano al client (coordinate di scena, ruolo al posto del
//! colore), lo stato dello strumento, l'annullamento, lo strumento che non
//! c'è e l'opzione di uno strumento.

mod common;

use common::{apri, ops_di};
use fub_abi::{
    DrawingCommandRequest, DrawingGesture, DrawingOutcome, DrawingOverlay, DrawingOverlayRole,
    DrawingRefusal, PluginError, DRAWING_COMMAND_FAMILY_PREPARE, DRAWING_COMMAND_TOOL_OPTION,
};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const DISEGNO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n";

fn evento(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn clic(x: f64, y: f64) -> Vec<Value> {
    vec![evento("down", x, y), evento("up", x, y)]
}

fn richiesta(id: &str, phase: &str, eventi: Vec<Value>, ingressi: Vec<Value>) -> DrawingGesture {
    serde_json::from_value(json!({
        "phase": phase,
        "tool": { "engine": { "id": id } },
        "layer": null,
        "selection": [],
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#000000", "width": 2, "fill": null },
        "events": eventi,
        "inputs": ingressi,
    }))
    .expect("il gesto si legge")
}

fn gesto(
    d: &mut Disegno,
    id: &str,
    phase: &str,
    eventi: Vec<Value>,
    ingressi: Vec<Value>,
) -> DrawingOutcome {
    d.gesto(richiesta(id, phase, eventi, ingressi))
        .expect("il gesto")
}

fn segni(esito: &DrawingOutcome) -> &[DrawingOverlay] {
    esito
        .preview
        .as_ref()
        .map(|p| p.overlays.as_slice())
        .unwrap_or_default()
}

fn tasto(key: &str) -> Value {
    json!({ "kind": "key", "key": key, "code": key, "pressed": true })
}

#[test]
fn la_penna_fa_un_tracciato_con_piu_clic_in_un_passo_solo() {
    let (mut d, _) = apri(DISEGNO);
    // Tre clic, ognuno in una richiesta di anteprima: il gesto continua.
    let mut ultimo = None;
    for (x, y) in [(20.0, 20.0), (80.0, 20.0), (80.0, 70.0)] {
        let esito = gesto(&mut d, "pen", "preview", clic(x, y), vec![]);
        assert_eq!(esito.refused, None, "{esito:?}");
        assert_eq!(esito.ops, None);
        let stato = esito.state.clone().expect("lo stato della penna");
        assert!(stato.busy, "il tracciato aperto tiene il gesto: {stato:?}");
        ultimo = Some(esito);
    }
    // Il tracciato a metà si vede: un contorno in coordinate di scena e i
    // suoi punti.
    let ultimo = ultimo.unwrap();
    let contorni: Vec<&str> = segni(&ultimo)
        .iter()
        .filter_map(|s| match s {
            DrawingOverlay::Path { d, .. } => Some(d.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        contorni
            .iter()
            .any(|d| d.starts_with("M20 20") && d.contains("80 70")),
        "{:?}",
        segni(&ultimo)
    );
    let punti = segni(&ultimo)
        .iter()
        .filter(|s| matches!(s, DrawingOverlay::Anchor { .. }))
        .count();
    assert!(punti >= 3, "{:?}", segni(&ultimo));
    for s in segni(&ultimo) {
        s.validate().expect("ogni segno è valido");
    }
    // Invio chiude il tracciato; il commit dà un'aggiunta sola.
    let fine = gesto(&mut d, "pen", "commit", vec![], vec![tasto("Enter")]);
    assert_eq!(fine.refused, None, "{fine:?}");
    let ops = ops_di(&fine);
    let aggiunte: Vec<&Value> = ops
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["op"] == "add")
        .collect();
    assert_eq!(aggiunte.len(), 1, "{ops}");
    let elem = &aggiunte[0]["elem"];
    assert_eq!(elem["tag"], "path", "{ops}");
    let dd = elem["attrs"]["d"].as_str().unwrap_or_default();
    assert!(dd.starts_with("M20 20") && dd.contains("80 70"), "{dd}");
    assert_eq!(fine.state.as_ref().map(|s| s.busy), Some(false));
    // Il gesto dopo il commit ricomincia: niente del tracciato di prima.
    let dopo = gesto(
        &mut d,
        "pen",
        "preview",
        vec![evento("move", 5.0, 5.0)],
        vec![],
    );
    assert!(
        !segni(&dopo)
            .iter()
            .any(|s| matches!(s, DrawingOverlay::Path { d, .. } if d.contains("80 70"))),
        "{:?}",
        segni(&dopo)
    );
}

#[test]
fn il_rettangolo_del_motore_si_disegna_e_si_vede_prima() {
    let (mut d, _) = apri(DISEGNO);
    let anteprima = gesto(
        &mut d,
        "rectangle",
        "preview",
        vec![evento("down", 10.0, 10.0), evento("drag", 60.0, 40.0)],
        vec![],
    );
    assert_eq!(anteprima.refused, None, "{anteprima:?}");
    let stato = anteprima.state.clone().expect("lo stato");
    assert!(stato.busy, "{stato:?}");
    assert!(!stato.cursor.is_empty());
    assert!(
        stato
            .cursor
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
        "{}",
        stato.cursor
    );
    let fine = gesto(
        &mut d,
        "rectangle",
        "commit",
        vec![evento("up", 60.0, 40.0)],
        vec![],
    );
    assert_eq!(fine.refused, None, "{fine:?}");
    let ops = ops_di(&fine);
    let add = ops
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["op"] == "add")
        .unwrap_or_else(|| panic!("{ops}"));
    let elem = &add["elem"];
    let testo = elem.to_string();
    assert_eq!(
        [
            &elem["tag"],
            &elem["attrs"]["x"],
            &elem["attrs"]["y"],
            &elem["attrs"]["width"],
            &elem["attrs"]["height"]
        ],
        [
            &json!("rect"),
            &json!("10"),
            &json!("10"),
            &json!("50"),
            &json!("30")
        ],
        "{testo}"
    );
    assert_eq!(fine.selection.len(), 1, "{fine:?}");
}

#[test]
fn il_testo_del_motore_compone_con_l_ime_poi_scrive() {
    let (mut d, _) = apri(DISEGNO);
    let pronto = gesto(&mut d, "type", "preview", clic(30.0, 200.0), vec![]);
    assert_eq!(pronto.refused, None, "{pronto:?}");
    assert!(
        pronto.state.as_ref().is_some_and(|s| s.wants_text),
        "{:?}",
        pronto.state
    );
    let composto = gesto(
        &mut d,
        "type",
        "preview",
        vec![],
        vec![json!({ "kind": "ime", "preedit": "かな", "active": [0, 2] })],
    );
    assert_eq!(composto.refused, None, "{composto:?}");
    assert!(
        composto.state.as_ref().is_some_and(|s| s.composing),
        "{:?}",
        composto.state
    );
    let fine = gesto(
        &mut d,
        "type",
        "commit",
        vec![],
        vec![
            json!({ "kind": "ime", "preedit": "", "active": null }),
            json!({ "kind": "text", "text": "仮名" }),
            tasto("Escape"),
        ],
    );
    assert_eq!(fine.refused, None, "{fine:?}");
    let ops = ops_di(&fine).to_string();
    assert!(ops.contains("仮名"), "{ops}");
    assert!(!ops.contains("かな"), "la composizione non resta: {ops}");
}

#[test]
fn annullare_un_tracciato_a_meta_non_lascia_niente() {
    let (mut d, _) = apri(DISEGNO);
    gesto(&mut d, "pen", "preview", clic(20.0, 20.0), vec![]);
    gesto(&mut d, "pen", "preview", clic(60.0, 20.0), vec![]);
    let annullato = gesto(&mut d, "pen", "cancel", vec![], vec![]);
    assert_eq!(annullato.ops, None);
    assert_eq!(annullato.refused, None);
    // Un commit dopo l'annullamento non ha niente da dare.
    let vuoto = gesto(&mut d, "pen", "commit", vec![], vec![tasto("Enter")]);
    assert_eq!(vuoto.ops, None, "{vuoto:?}");
    assert_eq!(vuoto.refused, Some(DrawingRefusal::Empty));
}

#[test]
fn cambiare_strumento_a_meta_annulla_il_gesto_di_prima() {
    let (mut d, _) = apri(DISEGNO);
    gesto(&mut d, "pen", "preview", clic(20.0, 20.0), vec![]);
    gesto(&mut d, "pen", "preview", clic(60.0, 20.0), vec![]);
    let altro = gesto(
        &mut d,
        "rectangle",
        "commit",
        vec![
            evento("down", 200.0, 200.0),
            evento("drag", 250.0, 260.0),
            evento("up", 250.0, 260.0),
        ],
        vec![],
    );
    assert_eq!(altro.refused, None, "{altro:?}");
    let ops = ops_di(&altro);
    let aggiunte = ops
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["op"] == "add")
        .count();
    assert_eq!(aggiunte, 1, "il tracciato a metà non entra: {ops}");
    assert!(!ops.to_string().contains("M20 20"), "{ops}");
}

#[test]
fn uno_strumento_che_non_c_e_e_rifiutato() {
    let (mut d, _) = apri(DISEGNO);
    let esito = gesto(
        &mut d,
        "pennarelloMagico",
        "commit",
        clic(10.0, 10.0),
        vec![],
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::UnknownTool));
    assert_eq!(esito.ops, None);
    // Un id con caratteri fuori dall'insieme non passa nemmeno il contratto.
    let male = serde_json::from_value::<DrawingGesture>(json!({
        "phase": "commit",
        "tool": { "engine": { "id": "pen tool" } },
        "layer": null, "selection": [], "zoom": 1,
        "snap": { "grid": null, "free": false }, "style": null, "events": [],
    }))
    .expect("si legge");
    assert!(matches!(d.gesto(male), Err(PluginError::BadArgs(_))));
}

#[test]
fn gli_ingressi_sono_solo_per_gli_strumenti_del_motore() {
    let (mut d, _) = apri(DISEGNO);
    let g = serde_json::from_value::<DrawingGesture>(json!({
        "phase": "commit",
        "tool": "rect",
        "layer": null, "selection": [], "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#000000", "width": 2, "fill": null },
        "events": [],
        "inputs": [tasto("Enter")],
    }))
    .expect("si legge");
    assert!(matches!(d.gesto(g), Err(PluginError::BadArgs(_))));
}

#[test]
fn i_segni_hanno_un_ruolo_e_non_un_colore() {
    let (mut d, _) = apri(DISEGNO);
    // La selezione a riquadro del motore: un rettangolo tratteggiato.
    let esito = gesto(
        &mut d,
        "selection",
        "preview",
        vec![evento("down", -40.0, -40.0), evento("drag", 150.0, 120.0)],
        vec![],
    );
    assert_eq!(esito.refused, None, "{esito:?}");
    let json = serde_json::to_value(segni(&esito)).unwrap().to_string();
    assert!(!json.contains("color\":["), "{json}");
    assert!(
        segni(&esito).iter().any(|s| matches!(
            s,
            DrawingOverlay::Marquee { .. }
                | DrawingOverlay::Path {
                    role: DrawingOverlayRole::Selection,
                    ..
                }
        )),
        "{:?}",
        segni(&esito)
    );
    gesto(&mut d, "selection", "cancel", vec![], vec![]);
}

#[test]
fn l_opzione_di_uno_strumento_resta_per_i_gesti_dopo() {
    let (mut d, _) = apri(DISEGNO);
    let prima = gesto(
        &mut d,
        "rectangle",
        "preview",
        vec![evento("move", 1.0, 1.0)],
        vec![],
    );
    let opzioni = prima.state.expect("lo stato").options;
    let Some((chiave, valore)) = opzioni.as_object().and_then(|o| {
        o.iter()
            .find_map(|(k, v)| v.as_bool().map(|b| (k.clone(), Value::Bool(!b))))
    }) else {
        // Il rettangolo non ha opzioni sì/no: la prova la fa un altro
        // strumento con una opzione numerica.
        panic!("il rettangolo del motore non ha opzioni sì/no: {opzioni}");
    };
    gesto(&mut d, "rectangle", "cancel", vec![], vec![]);
    let richiesta = DrawingCommandRequest {
        revision: d.revisione(),
        id: DRAWING_COMMAND_TOOL_OPTION.into(),
        selection: Vec::new(),
        value: json!({ "strumento": "rectangle", "chiave": chiave, "valore": valore }),
        preview: false,
    };
    let esito = d.comando(richiesta.clone()).expect("l'opzione");
    assert_eq!(esito.refused, None, "{esito:?}");
    assert_eq!(esito.ops, None);
    assert_eq!(
        esito.state.as_ref().map(|s| &s.options[&chiave]),
        Some(&valore)
    );
    // Il gesto dopo la ritrova.
    let dopo = gesto(
        &mut d,
        "rectangle",
        "preview",
        vec![evento("move", 1.0, 1.0)],
        vec![],
    );
    assert_eq!(dopo.state.map(|s| s.options[&chiave].clone()), Some(valore));
    // Con l'anteprima non si fa.
    let senza = d
        .comando(DrawingCommandRequest {
            preview: true,
            ..richiesta.clone()
        })
        .expect("la risposta");
    assert_eq!(senza.refused, Some(DrawingRefusal::NoPreview));
    // Uno strumento che non c'è.
    let ignoto = d
        .comando(DrawingCommandRequest {
            value: json!({ "strumento": "nessuno", "chiave": "x", "valore": 1 }),
            ..richiesta.clone()
        })
        .expect("la risposta");
    assert_eq!(ignoto.refused, Some(DrawingRefusal::UnknownTool));
    // Una forma del valore sbagliata è `BadArgs`.
    let male = d.comando(DrawingCommandRequest {
        value: json!({ "chiave": "x", "valore": 1 }),
        ..richiesta
    });
    assert!(matches!(male, Err(PluginError::BadArgs(_))));
}

#[test]
fn preparare_una_famiglia_si_controlla_e_la_avvia() {
    let (mut d, _) = apri(DISEGNO);
    let richiesta = DrawingCommandRequest {
        revision: d.revisione(),
        id: DRAWING_COMMAND_FAMILY_PREPARE.into(),
        selection: Vec::new(),
        value: json!({ "famiglia": "tracciati" }),
        preview: false,
    };
    let esito = d.comando(richiesta.clone()).expect("la risposta");
    // Con il Completo la famiglia nasce in sottofondo e la risposta dice a
    // che punto è; senza, non ci sono famiglie.
    #[cfg(feature = "completo")]
    {
        assert_eq!(esito.refused, None, "{esito:?}");
        assert!(esito.ops.is_none(), "{esito:?}");
        let lettura = esito.reading.as_ref().expect("la lettura");
        assert_eq!(lettura["famiglia"], "tracciati");
        assert!(
            ["pronta", "in-corso"].contains(&lettura["stato"].as_str().unwrap_or_default()),
            "{lettura}"
        );
    }
    #[cfg(not(feature = "completo"))]
    assert_eq!(esito.refused, Some(DrawingRefusal::Unsupported));
    let ignota = d.comando(DrawingCommandRequest {
        value: json!({ "famiglia": "magia" }),
        ..richiesta
    });
    assert!(matches!(ignota, Err(PluginError::BadArgs(_))));
}

#[test]
fn la_carta_non_si_sposta_con_uno_strumento_del_motore() {
    let (mut d, _) = apri(DISEGNO);
    let esito = gesto(
        &mut d,
        "selection",
        "commit",
        vec![
            evento("down", 5.0, 5.0),
            evento("drag", 50.0, 50.0),
            evento("up", 50.0, 50.0),
        ],
        vec![],
    );

    assert!(
        !ops_di(&esito).to_string().contains("fub-paper"),
        "{esito:?}"
    );
}
