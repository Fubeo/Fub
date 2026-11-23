//! I punti scelti e la famiglia `tracciati` (piano K6, T12;
//! `docs/architecture/disegno-strumenti.md`, «I tracciati e i punti»): lo
//! stato del gesto dice i punti scelti, i comandi sui punti li riprendono dal
//! `value` (`anchors`) e li controllano sulla copia, e gli strumenti dei
//! tracciati non toccano l'inchiostro di Fub.

#![cfg(feature = "completo")]

mod common;

use common::apri;
use fub_abi::{
    DrawingAnchor, DrawingCommandRequest, DrawingDisabledReason, DrawingGesture, DrawingRefusal,
    PluginError, MAX_DRAWING_ANCHORS,
};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/tracciati/base.svg");
const SEGHETTATO: &str = include_str!("famiglie/tracciati/seghettato.svg");

fn ev(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn gesto(
    strumento: &str,
    fase: &str,
    eventi: Vec<Value>,
    tasti: Vec<Value>,
    scelti: &[&str],
) -> DrawingGesture {
    serde_json::from_value(json!({
        "phase": fase, "tool": { "engine": { "id": strumento } }, "layer": null, "selection": scelti,
        "zoom": 1, "snap": { "grid": null, "free": false },
        "style": { "stroke": "#000000", "width": 2, "fill": null },
        "events": eventi, "inputs": tasti,
    }))
    .expect("il gesto si legge")
}

fn clic(x: f64, y: f64) -> Vec<Value> {
    vec![ev("down", x, y), ev("up", x, y)]
}

fn tasto(k: &str) -> Value {
    json!({ "kind": "key", "key": k, "code": k, "pressed": true })
}

fn comando(
    d: &mut Disegno,
    id: &str,
    scelti: &[&str],
    valore: Value,
) -> Result<fub_abi::DrawingOutcome, PluginError> {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: scelti.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    })
}

fn punto(element: &str, subpath: u32, anchor: u32, at: [f64; 2], end: bool) -> Value {
    json!({ "element": element, "subpath": subpath, "anchor": anchor, "at": at, "end": end })
}

#[test]
fn la_selezione_diretta_dice_i_punti_scelti() {
    let (mut d, _) = apri(BASE);
    let esito = d
        .gesto(gesto(
            "directSelection",
            "commit",
            clic(300.0, 200.0),
            vec![],
            &[],
        ))
        .expect("il gesto vale");
    let stato = esito.state.expect("lo stato dello strumento");
    assert_eq!(
        stato.anchors,
        vec![DrawingAnchor {
            element: "op7a7a7a7".into(),
            subpath: 0,
            anchor: 0,
            at: [300.0, 200.0],
            end: false
        }]
    );
    // Un clic nel vuoto non lascia punti.
    let esito = d
        .gesto(gesto(
            "directSelection",
            "commit",
            clic(10.0, 290.0),
            vec![],
            &[],
        ))
        .expect("il gesto vale");
    assert!(esito.state.expect("lo stato").anchors.is_empty());
}

#[test]
fn i_comandi_sui_punti_sono_spenti_col_perche() {
    let (d, _) = apri(BASE);
    let perche = |scelti: &[&str]| -> Vec<(String, Option<DrawingDisabledReason>)> {
        let scelti: Vec<String> = scelti.iter().map(|s| s.to_string()).collect();
        let mut v: Vec<_> = d
            .comandi(&scelti)
            .into_iter()
            .filter(|c| {
                ["convertAnchors", "cutAtAnchors", "join", "removeAnchors"]
                    .iter()
                    .any(|n| c.id == format!("disegno.path.{n}"))
            })
            .map(|c| {
                (
                    c.id.trim_start_matches("disegno.path.").to_string(),
                    c.disabled_reason,
                )
            })
            .collect();
        v.sort_by(|a, b| a.0.cmp(&b.0));
        v
    };
    use DrawingDisabledReason::*;
    let nessuno = [None; 4].map(|_: Option<()>| NoSelection);
    assert_eq!(
        perche(&[])
            .into_iter()
            .map(|(_, r)| r.expect("spento"))
            .collect::<Vec<_>>(),
        nessuno.to_vec()
    );
    assert_eq!(
        perche(&["oc1c1c1c1"]),
        vec![
            ("convertAnchors".into(), None),
            ("cutAtAnchors".into(), Some(NeedsAnchors)),
            ("join".into(), None),
            ("removeAnchors".into(), Some(NeedsAnchors)),
        ]
    );
    // La carta sta fuori dal motore ed è bloccata, come in ogni famiglia: «un oggetto scelto è bloccato».
    let carta = perche(&["fub-paper"]);
    assert!(
        carta
            .iter()
            .all(|(_, r)| *r == Some(DrawingDisabledReason::ReadOnly)),
        "{carta:?}"
    );
    // L'inchiostro di Fub non si cambia dai punti, nemmeno insieme a un tracciato.
    let inchiostro = perche(&["oc1c1c1c1", "oi8b8b8b8"]);
    assert!(
        inchiostro.iter().all(|(_, r)| *r == Some(FubInk)),
        "{inchiostro:?}"
    );
}

#[test]
fn i_comandi_sui_punti_non_toccano_l_inchiostro() {
    let (mut d, _) = apri(BASE);
    let prima = d.revisione();
    for id in ["path.convertAnchors", "path.join"] {
        let esito = comando(&mut d, id, &["oi8b8b8b8"], json!({ "to": "smooth" }))
            .expect("la richiesta vale");
        assert_eq!(
            (esito.refused, esito.ops),
            (Some(DrawingRefusal::Unmapped), None),
            "{id}"
        );
    }
    assert_eq!(d.revisione(), prima);
}

#[test]
fn oggetto_tracciato_sull_inchiostro_dice_perche_e_non_cambia_niente() {
    let (mut d, _) = apri(BASE);
    let prima = d.revisione();
    let scelti = vec!["oi8b8b8b8".to_string()];
    let ids = [
        "path.reverse",
        "object.path.outlineStroke",
        "object.compoundPath.make",
        "addon.pathtools.smooth",
    ];
    // Spenti col perché vero: l'Inchiostro è di Fub, non un tracciato.
    let stato = d.comandi(&scelti);
    for id in ids {
        let info = stato
            .iter()
            .find(|c| c.id == format!("disegno.{id}"))
            .unwrap_or_else(|| panic!("{id} elencato"));
        assert_eq!(
            info.disabled_reason,
            Some(DrawingDisabledReason::FubInk),
            "{id}"
        );
    }
    // E se il comando arriva lo stesso, il motore lo rifiuta e niente cambia.
    for id in ids {
        let esito = comando(&mut d, id, &["oi8b8b8b8"], json!({})).expect("la richiesta vale");
        assert_eq!(
            (esito.refused, esito.ops),
            (Some(DrawingRefusal::Unmapped), None),
            "{id}"
        );
    }
    assert_eq!(d.revisione(), prima);
}

/// Le finestre dei tracciati (T12, giro 3) e i loro argomenti di prova.
const FINESTRE: [(&str, &str, &str, &str); 5] = [
    (
        "object.path.simplify",
        BASE,
        "oc1c1c1c1",
        r#"{"level": 100, "cornerAngle": 30, "straightLines": true}"#,
    ),
    (
        "object.path.smooth",
        SEGHETTATO,
        "os9c9c9c9",
        r#"{"level": 50}"#,
    ),
    (
        "object.path.offsetPath",
        BASE,
        "of4f4f4f4",
        r#"{"offset": 10, "joins": "round", "miterLimit": 4}"#,
    ),
    (
        "object.expand",
        BASE,
        "oc1c1c1c1",
        r#"{"object": true, "fill": true, "stroke": true}"#,
    ),
    (
        "addon.pathtools.divideDashes",
        BASE,
        "oc1c1c1c1",
        r#"{"dash": 20, "gap": 10, "fit": false, "removeGaps": true}"#,
    ),
];

/// L'anteprima di una finestra dei tracciati: i contorni nuovi sul foglio,
/// nessuna operazione, la revisione ferma e il disegno uguale; OK, con gli
/// stessi argomenti, scrive.
#[test]
fn l_anteprima_delle_finestre_non_scrive_e_ok_si() {
    for (id, disegno, scelto, argomenti) in FINESTRE {
        let (mut d, _) = apri(disegno);
        let prima = d.revisione();
        let valore: Value = serde_json::from_str(argomenti).expect("json");
        let richiesta = |d: &Disegno, preview| DrawingCommandRequest {
            revision: d.revisione(),
            id: format!("disegno.{id}"),
            selection: vec![scelto.to_string()],
            value: valore.clone(),
            preview,
        };
        // Due anteprime di fila: nessuna scrive, la seconda vede la copia
        // di partenza, non la prima anteprima.
        for _ in 0..2 {
            let esito = d.comando(richiesta(&d, true)).expect("l'anteprima vale");
            assert_eq!((esito.refused, &esito.ops), (None, &None), "{id}");
            let segni = esito.preview.map(|p| p.overlays).unwrap_or_default();
            assert!(
                !segni.is_empty(),
                "{id}: l'anteprima mostra i contorni nuovi"
            );
            assert_eq!(esito.selection, vec![scelto.to_string()], "{id}");
            assert_eq!(
                d.revisione(),
                prima,
                "{id}: l'anteprima non cambia la revisione"
            );
        }
        let fermo = d.a_mano(|_, _| {}).expect("il motore si rilegge");
        assert!(fermo.ops.is_none(), "{id}: il motore è tornato alla copia");
        let esito = d.comando(richiesta(&d, false)).expect("OK vale");
        assert!(
            esito.refused.is_none() && esito.ops.is_some(),
            "{id}: OK scrive"
        );
        assert!(esito.preview.is_none(), "{id}");
    }
}

#[test]
fn i_comandi_riprendono_i_punti_e_li_controllano() {
    let (mut d, _) = apri(BASE);
    // Il punto che il client ha visto: il comando lo toglie.
    let esito = comando(
        &mut d,
        "path.removeAnchors",
        &["oc1c1c1c1"],
        json!({ "anchors": [punto("oc1c1c1c1", 0, 1, [100.0, 60.0], false)] }),
    )
    .expect("la richiesta vale");
    assert_eq!(esito.refused, None, "{esito:?}");
    assert!(
        esito
            .ops
            .as_deref()
            .is_some_and(|o| o.contains("M40 60 L160 60 L160 120")),
        "{esito:?}"
    );

    // Un punto che non è più dove il client l'ha visto: `stale`, niente cambia.
    let (mut d, _) = apri(BASE);
    let esito = comando(
        &mut d,
        "path.removeAnchors",
        &["oc1c1c1c1"],
        json!({ "anchors": [punto("oc1c1c1c1", 0, 1, [101.0, 60.0], false)] }),
    )
    .expect("la richiesta vale");
    assert_eq!(
        (esito.refused, esito.ops),
        (Some(DrawingRefusal::Stale), None)
    );
    // Un punto che il tracciato non ha.
    let esito = comando(
        &mut d,
        "path.removeAnchors",
        &["oc1c1c1c1"],
        json!({ "anchors": [punto("oc1c1c1c1", 0, 9, [100.0, 60.0], false)] }),
    )
    .expect("la richiesta vale");
    assert_eq!(esito.refused, Some(DrawingRefusal::Stale));
    // Un elemento che il disegno non ha.
    let esito = comando(
        &mut d,
        "path.removeAnchors",
        &["oc1c1c1c1"],
        json!({ "anchors": [punto("ozzzzzzzz", 0, 0, [0.0, 0.0], false)] }),
    )
    .expect("la richiesta vale");
    assert!(esito.refused.is_some() && esito.ops.is_none(), "{esito:?}");

    // Una forma sbagliata, o troppi punti: argomenti sbagliati.
    let male = comando(
        &mut d,
        "path.removeAnchors",
        &["oc1c1c1c1"],
        json!({ "anchors": "tutti" }),
    );
    assert!(matches!(male, Err(PluginError::BadArgs(_))), "{male:?}");
    let troppi: Vec<Value> = (0..=MAX_DRAWING_ANCHORS)
        .map(|_| punto("oc1c1c1c1", 0, 1, [100.0, 60.0], false))
        .collect();
    let male = comando(
        &mut d,
        "path.removeAnchors",
        &["oc1c1c1c1"],
        json!({ "anchors": troppi }),
    );
    assert!(matches!(male, Err(PluginError::BadArgs(_))), "{male:?}");
}

#[test]
fn convertire_e_unire_i_punti_scelti() {
    let (mut d, _) = apri(BASE);
    let esito = comando(
        &mut d,
        "path.convertAnchors",
        &["op7a7a7a7"],
        json!({ "to": "smooth", "anchors": [punto("op7a7a7a7", 0, 0, [300.0, 200.0], false)] }),
    )
    .expect("la richiesta vale");
    let ops = esito.ops.expect("le operazioni");
    assert!(ops.contains("\"op7a7a7a7\"") && ops.contains(" C"), "{ops}");
    // Solo il punto scelto diventa morbido: il vertice in basso resta d'angolo.
    assert!(ops.contains("L330 260"), "{ops}");

    let (mut d, _) = apri(BASE);
    let esito = comando(
        &mut d,
        "path.join",
        &["oc1c1c1c1", "od2d2d2d2"],
        json!({ "anchors": [punto("oc1c1c1c1", 0, 3, [160.0, 120.0], true), punto("od2d2d2d2", 0, 0, [166.0, 124.0], true)] }),
    )
    .expect("la richiesta vale");
    let ops = esito.ops.expect("le operazioni");
    assert!(
        ops.contains("\"remove\"") && ops.contains("L160 120 L166 124 L230 124"),
        "{ops}"
    );
}

#[test]
fn la_penna_aperta_resta_aperta_in_un_passo() {
    // Tre clic, poi lo strumento cambiato (il commit senza tasti): un solo
    // `add`, il tracciato aperto.
    for chiude in [vec![], vec![tasto("Escape")], vec![tasto("Enter")]] {
        let (mut d, _) = apri(BASE);
        for (x, y) in [(20.0, 200.0), (80.0, 200.0), (80.0, 260.0)] {
            let anteprima = d
                .gesto(gesto("pen", "preview", clic(x, y), vec![], &[]))
                .expect("il gesto vale");
            assert_eq!(anteprima.ops, None);
            assert!(
                anteprima.state.expect("lo stato").busy,
                "la penna lavora fra i clic"
            );
        }
        let esito = d
            .gesto(gesto("pen", "commit", vec![], chiude.clone(), &[]))
            .expect("il gesto vale");
        let ops: Value =
            serde_json::from_str(esito.ops.as_deref().expect("le operazioni")).expect("json");
        let ops = ops.as_array().expect("un elenco");
        assert_eq!(ops.len(), 1, "un passo: {ops:?}");
        assert_eq!(ops[0]["op"], "add");
        assert_eq!(
            ops[0]["elem"]["attrs"]["d"], "M20 200 L80 200 L80 260",
            "{chiude:?}"
        );
        assert!(!esito.state.expect("lo stato").busy);
        // Un secondo Esc non ha più niente da chiudere.
        let ancora = d
            .gesto(gesto("pen", "commit", vec![], vec![tasto("Escape")], &[]))
            .expect("il gesto vale");
        assert_eq!(
            (ancora.refused, ancora.ops),
            (Some(DrawingRefusal::Empty), None)
        );
    }
}

#[test]
fn gli_strumenti_dei_tracciati_non_toccano_l_inchiostro() {
    let trascina = |punti: &[(f64, f64)]| -> Vec<Value> {
        let mut v: Vec<Value> = punti
            .iter()
            .enumerate()
            .map(|(n, (x, y))| ev(if n == 0 { "down" } else { "drag" }, *x, *y))
            .collect();
        let (x, y) = punti[punti.len() - 1];
        v.push(ev("up", x, y));
        v
    };
    let sopra = trascina(&[(110.0, 210.0), (140.0, 230.0), (170.0, 250.0)]);
    for (strumento, eventi) in [
        ("knife", sopra.clone()),
        ("scissors", clic(140.0, 220.0)),
        ("eraser", sopra.clone()),
        ("eraser", clic(140.0, 220.0)),
    ] {
        let (mut d, _) = apri(BASE);
        let prima = d.revisione();
        let esito = d
            .gesto(gesto(strumento, "commit", eventi, vec![], &["oi8b8b8b8"]))
            .expect("il gesto vale");
        assert_eq!(
            (esito.refused, esito.ops),
            (Some(DrawingRefusal::Unmapped), None),
            "{strumento}"
        );
        assert_eq!(d.revisione(), prima, "{strumento}: niente cambia");
    }
}

/// Un quadrilatero con la radice scalata (`width` doppio del `viewBox`) e
/// spostata (`viewBox` che non parte da zero): la scena e il documento del
/// motore non coincidono. Quattro punti, perché il cambio di un triangolo è
/// sempre una matrice e la differenza lo scriverebbe come `transform`.
const SCALATO: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="100 50 400 300" width="800" height="600">
  <g id="l1a2b3c4d" fub:layer="Livello 1">
    <path id="op7a7a7a7" d="M300 200 L360 200 L360 260 L300 260 Z" fill="#cccccc"/>
  </g>
</svg>"##;

/// Le operazioni di un esito riuscito, in un passo.
fn riuscito(esito: &fub_abi::DrawingOutcome) -> Value {
    assert!(esito.refused.is_none(), "rifiutato: {esito:?}");
    let ops = common::ops_di(esito);
    assert_eq!(ops.as_array().map(Vec::len), Some(1), "un passo: {ops}");
    ops
}

/// Il `d` del tracciato `id` nel testo `svg`.
fn d_di<'a>(svg: &'a str, id: &str) -> &'a str {
    let inizio = svg.find(&format!("id=\"{id}\"")).expect("l'elemento c'è");
    let resto = &svg[inizio..];
    let d = resto.find(" d=\"").expect("il d c'è") + 4;
    &resto[d..d + resto[d..].find('"').expect("il d finisce")]
}

#[test]
fn un_punto_spostato_si_salva_e_torna_uguale() {
    let (mut d, _) = apri(BASE);
    let valore = json!({ "element": "op7a7a7a7", "anchor": 1, "x": 370, "y": 190 });
    let esito = comando(&mut d, "path.moveAnchor", &["op7a7a7a7"], valore).expect("vale");
    let salvato = common::applica::applica(BASE, &riuscito(&esito)).expect("si applica");
    assert_eq!(d_di(&salvato, "op7a7a7a7"), "M300 200 L370 190 L330 260 Z");

    // Riaperto, il punto sta dove lo si è lasciato: la Selezione diretta lo
    // prende lì.
    let (mut riaperto, _) = apri(&salvato);
    let esito = riaperto
        .gesto(gesto(
            "directSelection",
            "commit",
            clic(370.0, 190.0),
            vec![],
            &[],
        ))
        .expect("il gesto vale");
    let stato = esito.state.expect("lo stato dello strumento");
    assert_eq!(
        stato.anchors,
        vec![DrawingAnchor {
            element: "op7a7a7a7".into(),
            subpath: 0,
            anchor: 1,
            at: [370.0, 190.0],
            end: false
        }]
    );
    // La maniglia e il punto aggiunto passano dal file allo stesso modo.
    let valore = json!({ "element": "op7a7a7a7", "anchor": 0, "which": "out", "x": 320, "y": 180 });
    let esito = comando(&mut riaperto, "path.setHandle", &["op7a7a7a7"], valore).expect("vale");
    let curvo = common::applica::applica(&salvato, &riuscito(&esito)).expect("si applica");
    let (mut terzo, _) = apri(&curvo);
    let valore = json!({ "element": "op7a7a7a7", "segment": 1, "t": 0.5 });
    let esito = comando(&mut terzo, "path.insertAnchor", &["op7a7a7a7"], valore).expect("vale");
    let piu = common::applica::applica(&curvo, &riuscito(&esito)).expect("si applica");
    assert_eq!(
        d_di(&piu, "op7a7a7a7"),
        "M300 200 C320 180 370 190 370 190 L350 225 L330 260 Z"
    );
    // Riaperto ancora, un comando che non cambia la forma (spostare il punto
    // dov'è già) riscrive lo stesso `d`: niente si perde nell'andata e ritorno.
    let (mut quarto, _) = apri(&piu);
    let valore = json!({ "element": "op7a7a7a7", "anchor": 2, "x": 350, "y": 225 });
    let esito = comando(&mut quarto, "path.moveAnchor", &["op7a7a7a7"], valore).expect("vale");
    let ops = common::ops_di(&esito);
    if let Some(elenco) = ops.as_array().filter(|e| !e.is_empty()) {
        let rifatto =
            common::applica::applica(&piu, &Value::Array(elenco.clone())).expect("si applica");
        assert_eq!(d_di(&rifatto, "op7a7a7a7"), d_di(&piu, "op7a7a7a7"));
    }
}

#[test]
fn le_coordinate_della_scena_passano_nel_documento_del_motore() {
    // Il punto va dove la scena dice, anche se la radice scala e sposta.
    let (mut d, _) = apri(SCALATO);
    let valore = json!({ "element": "op7a7a7a7", "anchor": 1, "x": 370, "y": 190 });
    let esito = comando(&mut d, "path.moveAnchor", &["op7a7a7a7"], valore).expect("vale");
    let salvato = common::applica::applica(SCALATO, &riuscito(&esito)).expect("si applica");
    assert_eq!(
        d_di(&salvato, "op7a7a7a7"),
        "M300 200 L370 190 L360 260 L300 260 Z",
        "{esito:?}"
    );
    // Lo spostamento dei punti scelti è della scena: 10 a destra, 10 in su.
    let (mut d, _) = apri(SCALATO);
    let valore = json!({
        "dx": 10, "dy": -10,
        "anchors": [punto("op7a7a7a7", 0, 2, [360.0, 260.0], false)]
    });
    let esito = comando(&mut d, "path.moveAnchors", &["op7a7a7a7"], valore).expect("vale");
    let salvato = common::applica::applica(SCALATO, &riuscito(&esito)).expect("si applica");
    assert_eq!(
        d_di(&salvato, "op7a7a7a7"),
        "M300 200 L360 200 L370 250 L300 260 Z",
        "{esito:?}"
    );
}

#[test]
fn i_comandi_su_un_punto_dicono_perche_non_si_fanno() {
    let (mut d, _) = apri(BASE);
    let prima = d.revisione();
    // Un elemento che il disegno non ha: `unmapped`, come la selezione.
    let esito = comando(
        &mut d,
        "path.moveAnchor",
        &[],
        json!({ "element": "nessuno", "anchor": 0, "x": 1, "y": 1 }),
    )
    .expect("vale");
    assert_eq!(esito.refused, Some(DrawingRefusal::Unmapped));
    // Senza `element`, con un numero che non è un numero o senza il punto:
    // argomenti sbagliati.
    for valore in [
        json!({ "anchor": 0, "x": 1, "y": 1 }),
        json!({ "element": "op7a7a7a7", "anchor": "uno", "x": 1, "y": 1 }),
        json!({ "element": "op7a7a7a7", "x": 1, "y": 1 }),
    ] {
        let r = comando(&mut d, "path.moveAnchor", &["op7a7a7a7"], valore.clone());
        assert!(matches!(r, Err(PluginError::BadArgs(_))), "{valore}: {r:?}");
    }
    assert_eq!(d.revisione(), prima, "niente cambia");
    // I comandi su un punto sono accesi in un disegno che si cambia: il
    // tracciato lo nominano nel valore.
    let accesi = d.comandi(&[]);
    for id in ["path.moveAnchor", "path.close", "path.split"] {
        let voce = accesi
            .iter()
            .find(|c| c.id == format!("disegno.{id}"))
            .unwrap_or_else(|| panic!("{id} c'è"));
        assert_eq!(voce.disabled_reason, None, "{id}");
    }
}

/// Trascina con la Selezione diretta dal punto (100, 60) del tracciato
/// `oc1c1c1c1` di 30 in giù, coi punti scelti `punti` portati dal gesto.
fn trascina_il_punto(scelti: &[&str], punti: Vec<Value>) -> String {
    let (mut d, _) = apri(BASE);
    let evs = vec![
        ev("down", 100.0, 60.0),
        ev("drag", 100.0, 75.0),
        ev("drag", 100.0, 90.0),
        ev("up", 100.0, 90.0),
    ];
    let mut g = gesto("directSelection", "commit", evs, vec![], scelti);
    g.anchors = punti
        .into_iter()
        .map(|p| serde_json::from_value(p).expect("il punto si legge"))
        .collect();
    let esito = d.gesto(g).expect("il gesto vale");
    let salvato = common::applica::applica(BASE, &riuscito(&esito)).expect("si applica");
    d_di(&salvato, "oc1c1c1c1").to_string()
}

#[test]
fn la_selezione_diretta_su_un_tracciato_scelto_intero_lo_sposta_intero() {
    // Come in VectorCraft (`direct.rs`, `press_anchor`): un tracciato non
    // scelto si prende per il punto, che si sposta da solo; uno scelto intero
    // (tutti i punti pieni) si trascina intero da un suo punto.
    assert_eq!(
        trascina_il_punto(&[], vec![]),
        "M40 60 L100 90 L160 60 L160 120"
    );
    let intero = trascina_il_punto(&["oc1c1c1c1"], vec![]);
    assert_ne!(intero, "M40 60 L100 90 L160 60 L160 120");
}

#[test]
fn un_punto_spostato_resta_un_d_anche_quando_una_matrice_lo_spiegherebbe() {
    // Il punto finale da (160,120) a (180,140): i tre punti sulla retta y=60
    // restano, e la polilinea nuova è la vecchia inclinata e stirata, ma ciò
    // che si è fatto è spostare un punto. Il `d` cambia, la `transform` e lo
    // spessore no. Con un altro oggetto scelto, come dopo un clic altrove.
    let atteso = "M40 60 L100 60 L160 60 L180 140";
    let (mut d, _) = apri(BASE);
    let evs = vec![
        ev("down", 160.0, 120.0),
        ev("drag", 170.0, 130.0),
        ev("drag", 180.0, 140.0),
        ev("up", 180.0, 140.0),
    ];
    let esito = d
        .gesto(gesto(
            "directSelection",
            "commit",
            evs,
            vec![],
            &["op7a7a7a7"],
        ))
        .expect("il gesto vale");
    let ops = riuscito(&esito);
    let testo = ops.to_string();
    assert!(
        !testo.contains("transform") && !testo.contains("stroke-width"),
        "{testo}"
    );
    let salvato = common::applica::applica(BASE, &ops).expect("si applica");
    assert_eq!(d_di(&salvato, "oc1c1c1c1"), atteso);
    // Lo stesso col comando sul punto.
    let (mut d, _) = apri(BASE);
    let valore = json!({ "element": "oc1c1c1c1", "anchor": 3, "x": 180, "y": 140 });
    let esito = comando(&mut d, "path.moveAnchor", &["oc1c1c1c1"], valore).expect("vale");
    let ops = riuscito(&esito);
    let testo = ops.to_string();
    assert!(
        !testo.contains("transform") && !testo.contains("stroke-width"),
        "{testo}"
    );
    let salvato = common::applica::applica(BASE, &ops).expect("si applica");
    assert_eq!(d_di(&salvato, "oc1c1c1c1"), atteso);
}

#[test]
fn i_punti_scelti_passano_da_un_gesto_all_altro() {
    // Un clic sceglie il punto, e lo stato lo dice.
    let (mut d, _) = apri(BASE);
    let clic = d
        .gesto(gesto(
            "directSelection",
            "commit",
            clic(160.0, 60.0),
            vec![],
            &["oc1c1c1c1"],
        ))
        .expect("il gesto vale");
    let stato = clic.state.expect("lo stato c'è").anchors;
    assert_eq!(
        stato,
        vec![DrawingAnchor {
            element: "oc1c1c1c1".into(),
            subpath: 0,
            anchor: 2,
            at: [160.0, 60.0],
            end: false
        }]
    );
    // Il gesto dopo li porta: Maiusc+clic aggiunge (100, 60), e trascinare
    // uno dei due li sposta insieme.
    let portati = [punto("oc1c1c1c1", 0, 2, [160.0, 60.0], false)];
    let mut piu = gesto(
        "directSelection",
        "commit",
        vec![
            json!({ "kind": "down", "x": 100.0, "y": 60.0, "pressure": 0.5, "shift": true, "alt": false, "cmd": false }),
            json!({ "kind": "up", "x": 100.0, "y": 60.0, "pressure": 0.5, "shift": true, "alt": false, "cmd": false }),
        ],
        vec![],
        &["oc1c1c1c1"],
    );
    piu.revision = d.revisione();
    piu.anchors = portati
        .iter()
        .map(|p| serde_json::from_value(p.clone()).expect("si legge"))
        .collect();
    let due = d
        .gesto(piu)
        .expect("il gesto vale")
        .state
        .expect("lo stato c'è")
        .anchors;
    assert_eq!(
        due.iter().map(|a| a.anchor).collect::<Vec<_>>(),
        vec![1, 2],
        "Maiusc aggiunge al punto di prima: {due:?}"
    );
    let insieme = vec![
        punto("oc1c1c1c1", 0, 1, [100.0, 60.0], false),
        punto("oc1c1c1c1", 0, 2, [160.0, 60.0], false),
    ];
    assert_eq!(
        trascina_il_punto(&["oc1c1c1c1"], insieme),
        "M40 60 L100 90 L160 90 L160 120"
    );
}

#[test]
fn un_punto_portato_che_non_sta_piu_li_si_lascia() {
    // Il punto 2 detto altrove (il disegno è cambiato sotto), e uno su un
    // elemento che non c'è: si lasciano, e il gesto vale sul punto preso.
    let vecchi = vec![
        punto("oc1c1c1c1", 0, 2, [500.0, 500.0], false),
        punto("nessuno", 0, 0, [40.0, 60.0], false),
        punto("oc1c1c1c1", 7, 0, [40.0, 60.0], false),
    ];
    assert_eq!(
        trascina_il_punto(&[], vecchi),
        "M40 60 L100 90 L160 60 L160 120"
    );
}

/// Il passaggio del mouse va allo strumento, come in VectorCraft: sopra un
/// punto del tracciato scelto la Selezione diretta lo illumina e cambia il
/// cursore; il clic dopo continua la stessa sessione e prende quel punto.
#[test]
fn il_passaggio_del_mouse_illumina_il_punto_e_cambia_il_cursore() {
    let (mut d, _) = apri(BASE);
    let scelti = &["op7a7a7a7"];
    let sopra = |d: &mut Disegno, x: f64, y: f64| {
        let mut g = gesto(
            "directSelection",
            "preview",
            vec![ev("move", x, y)],
            vec![],
            scelti,
        );
        g.revision = d.revisione();
        d.gesto(g).expect("il passaggio vale")
    };
    let esito = sopra(&mut d, 300.0, 200.0);
    assert_eq!(esito.refused, None);
    assert!(esito.ops.is_none(), "un passaggio non scrive niente");
    let stato = esito.state.expect("lo stato dello strumento");
    assert!(
        stato.cursor.starts_with("direct_anchor"),
        "sopra un punto il cursore lo dice: {}",
        stato.cursor
    );
    let segni = esito.preview.expect("i segni").overlays;
    let illuminato = segni.iter().any(|s| {
        matches!(s, fub_abi::DrawingOverlay::Anchor { at, filled: false, .. }
            if (at[0] - 300.0).abs() < 1e-6 && (at[1] - 200.0).abs() < 1e-6)
    });
    assert!(illuminato, "il punto sotto il mouse si illumina: {segni:?}");

    // Lontano dal tracciato il punto si spegne e il cursore torna quello di riposo.
    let esito = sopra(&mut d, 20.0, 280.0);
    let stato = esito.state.expect("lo stato dello strumento");
    assert!(
        !stato.cursor.starts_with("direct_anchor"),
        "{}",
        stato.cursor
    );

    // Il clic dopo il passaggio prende il punto, nella stessa sessione.
    let mut g = gesto(
        "directSelection",
        "commit",
        clic(300.0, 200.0),
        vec![],
        scelti,
    );
    g.revision = d.revisione();
    let esito = d.gesto(g).expect("il gesto vale");
    let stato = esito.state.expect("lo stato dello strumento");
    assert_eq!(stato.anchors.len(), 1);
    assert_eq!(stato.anchors[0].at, [300.0, 200.0]);
}

/// I punti scelti cambiati fra un passaggio e il clic (un altro gesto li ha
/// scelti, o la tastiera) preparano di nuovo lo strumento: Maiusc+clic
/// aggiunge ai punti di adesso, non a quelli del passaggio.
#[test]
fn il_clic_dopo_il_passaggio_vede_i_punti_di_adesso() {
    let (mut d, _) = apri(BASE);
    let mut g = gesto(
        "directSelection",
        "preview",
        vec![ev("move", 10.0, 290.0)],
        vec![],
        &["oc1c1c1c1"],
    );
    g.revision = d.revisione();
    d.gesto(g).expect("il passaggio vale");
    let maiusc = |kind: &str| json!({ "kind": kind, "x": 100.0, "y": 60.0, "pressure": 0.5, "shift": true, "alt": false, "cmd": false });
    let mut piu = gesto(
        "directSelection",
        "commit",
        vec![maiusc("down"), maiusc("up")],
        vec![],
        &["oc1c1c1c1"],
    );
    piu.revision = d.revisione();
    piu.anchors = vec![
        serde_json::from_value(punto("oc1c1c1c1", 0, 2, [160.0, 60.0], false)).expect("si legge"),
    ];
    let due = d
        .gesto(piu)
        .expect("il gesto vale")
        .state
        .expect("lo stato c'è")
        .anchors;
    assert_eq!(
        due.iter().map(|a| a.anchor).collect::<Vec<_>>(),
        vec![1, 2],
        "{due:?}"
    );
}

/// Un rettangolo, un'ellisse spostata con `transform`, un cerchio e un
/// poligono: un punto spostato li deforma, e come in VectorCraft diventano
/// tracciati, al loro posto e con i loro attributi (K6, «Il tipo di una
/// forma»).
const FORME: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300">
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <g id="l1a1a1a1a" fub:layer="Livello 1">
    <rect id="or1r1r1r1" x="20" y="20" width="100" height="60" fill="#e69f00" stroke="#000000" stroke-width="2" opacity="0.5"><title>Tetto</title></rect>
    <ellipse id="oe1e1e1e1" transform="translate(10 0)" cx="250" cy="60" rx="50" ry="30" fill="#0072b2"/>
    <circle id="oo1o1o1o1" cx="80" cy="200" r="40" fill="#009e73"/>
    <polygon id="og1g1g1g1" points="200,150 300,150 250,250" fill="#cc79a7"/>
  </g>
</svg>
"##;

#[test]
fn una_forma_deformata_diventa_un_tracciato_al_suo_posto() {
    for (id, tag, geometria) in [
        (
            "or1r1r1r1",
            "rect",
            &[" x=", " y=", " width=", " height="][..],
        ),
        (
            "oe1e1e1e1",
            "ellipse",
            &[" cx=", " cy=", " rx=", " ry="][..],
        ),
        ("oo1o1o1o1", "circle", &[" cx=", " cy=", " r="][..]),
        ("og1g1g1g1", "polygon", &[" points="][..]),
    ] {
        let (mut d, _) = apri(FORME);
        let valore = json!({ "element": id, "anchor": 0, "x": 5, "y": 5 });
        let esito = comando(&mut d, "path.moveAnchor", &[id], valore).expect("vale");
        let ops = riuscito(&esito);
        let set = common::applica::piatte(&ops)
            .into_iter()
            .find(|o| o["op"] == "set" && o["id"] == id)
            .unwrap_or_else(|| panic!("{tag}: nessun set: {ops}"));
        assert_eq!(set["tag"], "path", "{tag}: {set}");
        let salvato = common::applica::applica(FORME, &ops).expect("si applica");
        let posto = salvato.find(&format!("id=\"{id}\"")).expect("c'è");
        let inizio = salvato[..posto].rfind('<').expect("il tag comincia");
        let elemento = &salvato[inizio..inizio + salvato[inizio..].find('>').expect("finisce")];
        assert!(elemento.starts_with("<path "), "{tag}: {elemento}");
        for g in geometria {
            assert!(!elemento.contains(g), "{tag}: resta {g} in {elemento}");
        }
        assert!(elemento.contains("fill=\""), "{tag}: {elemento}");
        // Il punto spostato sta nel `d`, nello spazio dell'elemento.
        let atteso = if tag == "ellipse" { "M-5 5" } else { "M5 5" };
        assert!(
            elemento.contains(&format!("d=\"{atteso}")),
            "{tag}: {elemento}"
        );
        // Gli altri attributi restano, anche il titolo.
        if tag == "rect" {
            assert!(
                elemento.contains("opacity=\"0.5\"") && elemento.contains("stroke-width=\"2\""),
                "{elemento}"
            );
            assert!(salvato.contains("<title>Tetto</title></path>"), "{salvato}");
        }
    }
}

/// Una forma con tutti i punti spostati insieme è solo spostata: resta
/// quella che era, con una `transform`.
#[test]
fn una_forma_spostata_resta_una_forma() {
    let (mut d, _) = apri(FORME);
    let tutti: Vec<Value> = [[20.0, 20.0], [120.0, 20.0], [120.0, 80.0], [20.0, 80.0]]
        .iter()
        .enumerate()
        .map(|(i, at)| punto("or1r1r1r1", 0, i as u32, *at, false))
        .collect();
    let valore = json!({ "dx": 10, "dy": 0, "anchors": tutti });
    let esito = comando(&mut d, "path.moveAnchors", &["or1r1r1r1"], valore).expect("vale");
    let ops = riuscito(&esito);
    let testo = ops.to_string();
    assert!(
        !testo.contains("\"tag\"") && !testo.contains("\"d\""),
        "{testo}"
    );
    let salvato = common::applica::applica(FORME, &ops).expect("si applica");
    assert!(
        salvato.contains("<rect transform=\"matrix(1 0 0 1 10 0)\" id=\"or1r1r1r1\""),
        "{salvato}"
    );
}
