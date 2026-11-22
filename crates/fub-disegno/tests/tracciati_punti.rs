//! I punti scelti e la famiglia `tracciati` (piano K6, T12;
//! `docs/architecture/disegno-completo.md`, «I tracciati e i punti»): lo
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
    // La carta è bloccata: non è un tracciato da cambiare.
    let carta = perche(&["fub-paper"]);
    assert!(
        carta.iter().all(|(_, r)| *r == Some(NeedsPath)),
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
