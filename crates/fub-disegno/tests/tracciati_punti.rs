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
