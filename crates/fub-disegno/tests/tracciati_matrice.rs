#![cfg(feature = "completo")]
//! «Fai scorrere il punto» su un tracciato chiuso: il differ scrive il risultato come una matrice
//! `transform` quando il nuovo contorno è un'affinità del vecchio (un triangolo lo è sempre: tre punti
//! determinano una affinità). Questo test lo verifica senza fidarsi del differ: il contorno che il motore
//! mostra dopo il comando (l'anteprima, nelle coordinate del documento) deve coincidere, a 0,01 pt, con i
//! punti del file riaperto dopo le operazioni applicate (e la sua `transform`).

mod casi;
mod common;

use fub_abi::{DrawingCommandRequest, DrawingOverlay};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const TOLLERANZA: f64 = 0.01;

/// Il file con un solo tracciato chiuso, `id`, di contorno `d`.
fn svg(id: &str, d: &str) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\"><rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/><g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\"><path id=\"{id}\" d=\"{d}\" fill=\"#cccccc\"/></g></svg>"
    )
}

/// I numeri a coppie di un `d` fatto di sole rette (`M`, `L`, `Z`): i punti, nell'ordine.
fn punti(d: &str) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    let numeri: Vec<f64> = d
        .split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == 'e'))
        .filter(|t| !t.is_empty())
        .map(|t| t.parse().expect("un numero"))
        .collect();
    assert!(!d.contains('C'), "il test vuole solo rette: {d}");
    for coppia in numeri.chunks(2) {
        out.push((coppia[0], coppia[1]));
    }
    out
}

/// La `transform` (matrix) dell'elemento `id` nel testo, o l'identità.
fn tag_di<'a>(testo: &'a str, id: &str) -> &'a str {
    let dentro = testo.find(&format!("id=\"{id}\"")).expect("l'elemento c'è");
    let da = testo[..dentro].rfind('<').expect("un tag aperto");
    let fine = dentro + testo[dentro..].find("/>").expect("il tag si chiude");
    &testo[da..fine]
}

fn matrice_di(testo: &str, id: &str) -> [f64; 6] {
    let tag = tag_di(testo, id);
    let Some(i) = tag.find("transform=\"matrix(") else {
        return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    };
    let inizio = i + "transform=\"matrix(".len();
    let fine_m = inizio + tag[inizio..].find(')').expect("una matrice chiusa");
    let v: Vec<f64> = tag[inizio..fine_m]
        .split_whitespace()
        .map(|t| t.parse().unwrap())
        .collect();
    [v[0], v[1], v[2], v[3], v[4], v[5]]
}

fn senza_ripetuto(mut p: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    if p.len() > 1
        && (p[0].0 - p[p.len() - 1].0).abs() < 1e-9
        && (p[0].1 - p[p.len() - 1].1).abs() < 1e-9
    {
        p.pop();
    }
    p
}

fn vicini(a: &[(f64, f64)], b: &[(f64, f64)]) -> bool {
    let (a, b) = (senza_ripetuto(a.to_vec()), senza_ripetuto(b.to_vec()));
    let (a, b) = (a.as_slice(), b.as_slice());
    a.len() == b.len()
        && a.iter().all(|p| {
            b.iter()
                .any(|q| (p.0 - q.0).abs() < TOLLERANZA && (p.1 - q.1).abs() < TOLLERANZA)
        })
}

/// Il contorno che il motore mostra dopo il comando, nelle coordinate del documento.
fn contorno_del_motore(testo: &str, id: &str, valore: &Value) -> Vec<(f64, f64)> {
    let disegni = casi::disegni_di_prova();
    let (mut d, _) = Disegno::apri_con(&disegni, testo).expect("il disegno si apre");
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.addon.pathtools.slideAnchor".into(),
            selection: vec![id.into()],
            value: valore.clone(),
            preview: true,
        })
        .expect("il comando risponde");
    assert_eq!(esito.refused, None, "{esito:?}");
    let anteprima = esito.preview.expect("l'anteprima c'è");
    let d_nuovo = anteprima
        .overlays
        .iter()
        .find_map(|o| match o {
            DrawingOverlay::Path { d, .. } => Some(d.clone()),
            _ => None,
        })
        .expect("il contorno nuovo c'è");
    punti(&d_nuovo)
}

/// I punti del file riaperto, dopo le operazioni applicate: il `d` di `id` con la sua `transform`.
fn contorno_riaperto(testo_dopo: &str, id: &str, d_prima: &str) -> Vec<(f64, f64)> {
    let _ = d_prima;
    let tag = tag_di(testo_dopo, id);
    let di = tag.find(" d=\"").expect("un d") + 4;
    let d = &tag[di..tag[di..].find('"').expect("un d chiuso") + di];
    let [a, b, c, dd, e, f] = matrice_di(testo_dopo, id);
    punti(d)
        .into_iter()
        .map(|(x, y)| (a * x + c * y + e, b * x + dd * y + f))
        .collect()
}

fn verifica(nome: &str, id: &str, d: &str, valore: Value) {
    let testo = svg(id, d);
    let attesi = contorno_del_motore(&testo, id, &valore);
    let disegni = casi::disegni_di_prova();
    let (mut motore, _) = Disegno::apri_con(&disegni, &testo).unwrap();
    let esito = motore
        .comando(DrawingCommandRequest {
            revision: motore.revisione(),
            id: "disegno.addon.pathtools.slideAnchor".into(),
            selection: vec![id.into()],
            value: valore,
            preview: false,
        })
        .unwrap();
    let ops: Value = serde_json::from_str(&esito.ops.expect("le operazioni")).unwrap();
    let dopo = common::applica::applica(&testo, &ops).expect("le operazioni si applicano");
    let riaperti = contorno_riaperto(&dopo, id, d);
    assert!(
        vicini(&attesi, &riaperti),
        "{nome}: il contorno del motore {attesi:?} non è quello riaperto {riaperti:?}; operazioni {ops}\n{dopo}"
    );
}

#[test]
fn il_triangolo_scorre_come_dice_il_motore() {
    verifica(
        "triangolo",
        "op7a7a7a7",
        "M300 200 L360 200 L330 260 Z",
        json!({"element":"op7a7a7a7","anchor":0,"t":0.3}),
    );
}

#[test]
fn il_rettangolo_scorre_come_dice_il_motore() {
    verifica(
        "rettangolo",
        "or1r1r1r1",
        "M100 100 L200 100 L200 150 L100 150 Z",
        json!({"element":"or1r1r1r1","anchor":1,"t":0.3}),
    );
}
