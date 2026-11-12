//! La Selezione del motore del disegno: ogni vettore dei gesti della
//! selezione (`apps/client/src/__fixtures__/disegno-gesti/`) rigiocato sul
//! motore deve dare le stesse operazioni, lo stesso rifiuto e la stessa
//! selezione; una differenza è ammessa solo se `tests/gesti/selezione.tsv`
//! la nomina col perché. Poi i casi che i vettori non coprono.

mod common;

use std::path::Path;

use common::{ammesse, apri, confronta_ops, ops_di, vettori, Confronto};
use fub_abi::{DrawingGesture, DrawingOutcome, DrawingRefusal};
use serde_json::{json, Value};

fn percorso_tsv() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/gesti/selezione.tsv")
}

fn rifiuto(r: Option<DrawingRefusal>) -> Option<String> {
    r.map(|r| {
        serde_json::to_value(r)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default()
    })
}

fn gesto(v: Value) -> DrawingGesture {
    serde_json::from_value(v).expect("il gesto si legge")
}

/// La selezione con gli id nuovi scritti `@1`, `@2`… nell'ordine in cui
/// le operazioni li danno, come nei vettori.
fn con_gli_id_dei_vettori(ops: &Value, selezione: &[String]) -> Vec<String> {
    fn raccogli(v: &Value, nuovi: &mut Vec<String>) {
        match v {
            Value::Array(a) => a.iter().for_each(|x| raccogli(x, nuovi)),
            Value::Object(o) => {
                if o.get("op").and_then(Value::as_str) == Some("ident") {
                    if let Some(id) = o.get("id").and_then(Value::as_str) {
                        if !nuovi.iter().any(|n| n == id) {
                            nuovi.push(id.to_string());
                        }
                    }
                }
                o.values().for_each(|x| raccogli(x, nuovi));
            }
            _ => {}
        }
    }
    let mut nuovi = Vec::new();
    raccogli(ops, &mut nuovi);
    selezione
        .iter()
        .map(|id| match nuovi.iter().position(|n| n == id) {
            Some(i) => format!("@{}", i + 1),
            None => id.clone(),
        })
        .collect()
}

#[test]
fn rigioca_i_vettori_della_selezione() {
    let ammesse = ammesse(&percorso_tsv());
    let mut diverse = Vec::new();
    let mut nomi = Vec::new();
    for v in vettori() {
        if v.gesto["tool"] != "select" {
            continue;
        }
        nomi.push(v.nome.clone());
        // Il client tiene il testo a capo LF.
        let (mut disegno, _) = apri(&v.input.replace("\r\n", "\n"));
        let esito = disegno.gesto(gesto(v.gesto.clone())).expect("il gesto");
        let ammessa = ammesse.get(&v.nome).map(String::as_str);
        match confronta_ops(&v.ops, &ops_di(&esito), ammessa) {
            Confronto::Uguali | Confronto::Ammessa(_) => {}
            Confronto::Diverse(perche) => diverse.push(format!("{}: {perche}", v.nome)),
        }
        if ammessa.is_none() {
            if rifiuto(esito.refused) != v.rifiuto {
                diverse.push(format!(
                    "{}: rifiuto {:?} ≠ {:?}",
                    v.nome,
                    rifiuto(esito.refused),
                    v.rifiuto
                ));
            }
            let selezione = con_gli_id_dei_vettori(&ops_di(&esito), &esito.selection);
            if selezione != v.selezione {
                diverse.push(format!(
                    "{}: selezione {:?} ≠ {:?}",
                    v.nome, selezione, v.selezione
                ));
            }
        }
    }
    assert!(
        nomi.len() >= 26,
        "i vettori della selezione sono {}: ne mancano",
        nomi.len()
    );
    for (nome, perche) in &ammesse {
        assert!(
            nomi.contains(nome),
            "selezione.tsv nomina {nome}, che non è un vettore della selezione"
        );
        assert!(!perche.is_empty(), "selezione.tsv: {nome} non dice perché");
    }
    assert!(diverse.is_empty(), "{}", diverse.join("\n"));
}

/// Un disegno di 400×300 con `corpo` nel livello.
fn disegno(corpo: &str) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    {corpo}\n  </g>\n</svg>\n"
    )
}

const A: &str =
    "<rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>";

fn evento(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn richiesta(phase: &str, selezione: &[&str], eventi: Vec<Value>) -> DrawingGesture {
    gesto(json!({
        "phase": phase,
        "tool": "select",
        "layer": null,
        "selection": selezione,
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": null,
        "events": eventi,
    }))
}

/// Un trascinamento da `da` ad `a` sul disegno `testo`.
fn tira(testo: &str, selezione: &[&str], da: (f64, f64), a: (f64, f64)) -> DrawingOutcome {
    let (mut d, _) = apri(testo);
    d.gesto(richiesta(
        "commit",
        selezione,
        vec![
            evento("down", da.0, da.1),
            evento("drag", (da.0 + a.0) / 2.0, (da.1 + a.1) / 2.0),
            evento("drag", a.0, a.1),
            evento("up", a.0, a.1),
        ],
    ))
    .expect("il gesto")
}

fn clic(testo: &str, selezione: &[&str], p: (f64, f64)) -> DrawingOutcome {
    tira(testo, selezione, p, p)
}

/// La `transform` che le operazioni scrivono sull'oggetto `id`.
fn trasformazione(esito: &DrawingOutcome, id: &str) -> Option<String> {
    fn cerca(v: &Value, id: &str) -> Option<String> {
        match v {
            Value::Array(a) => a.iter().find_map(|x| cerca(x, id)),
            Value::Object(o) => {
                if o.get("op").and_then(Value::as_str) == Some("set")
                    && o.get("id").and_then(Value::as_str) == Some(id)
                {
                    if let Some(t) = o["attrs"]["transform"].as_str() {
                        return Some(t.to_string());
                    }
                }
                o.values().find_map(|x| cerca(x, id))
            }
            _ => None,
        }
    }
    cerca(&ops_di(esito), id)
}

#[test]
fn un_clic_sceglie_l_oggetto_in_cima_e_il_gruppo() {
    let sopra =
        "<rect id=\"ob2b2b2b2\" x=\"150\" y=\"120\" width=\"100\" height=\"50\" fill=\"#ff0000\"/>";
    let testo = disegno(&format!("{A}\n    {sopra}"));
    let esito = clic(&testo, &[], (160.0, 130.0));
    assert_eq!(esito.selection, ["ob2b2b2b2"]);
    assert_eq!(esito.ops, None);
    assert_eq!(esito.refused, None);
    // Un oggetto dentro un gruppo: si sceglie il gruppo.
    let testo = disegno(&format!("<g id=\"og1g1g1g1\">{A}</g>"));
    let esito = clic(&testo, &[], (150.0, 125.0));
    assert_eq!(esito.selection, ["og1g1g1g1"]);
    // Lo stesso clic sulla stessa selezione non cambia niente.
    let esito = clic(&testo, &["og1g1g1g1"], (150.0, 125.0));
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty));
    assert_eq!(esito.selection, ["og1g1g1g1"]);
}

#[test]
fn un_oggetto_scelto_dentro_un_gruppo_si_sposta_da_solo() {
    let altro = "<rect id=\"ob2b2b2b2\" x=\"250\" y=\"100\" width=\"50\" height=\"50\"/>";
    let testo = disegno(&format!("<g id=\"og1g1g1g1\">{A}{altro}</g>"));
    let esito = tira(&testo, &["oa1a1a1a1"], (150.0, 125.0), (170.0, 135.0));
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(1 0 0 1 20 10)")
    );
    assert_eq!(trasformazione(&esito, "og1g1g1g1"), None);
    assert_eq!(trasformazione(&esito, "ob2b2b2b2"), None);
    assert_eq!(esito.selection, ["oa1a1a1a1"]);
}

#[test]
fn vicino_all_angolo_dentro_la_forma_si_sposta() {
    // Qui il motore prenderebbe la maniglia della sua cornice; per Fub è
    // l'oggetto (a più di 6 px dalla maniglia della cornice).
    let testo = disegno(A);
    let esito = tira(&testo, &["oa1a1a1a1"], (101.0, 101.0), (121.0, 111.0));
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(1 0 0 1 20 10)")
    );
}

#[test]
fn ridimensionare_col_contorno_tira_il_riquadro_col_contorno() {
    // Il riquadro col contorno va da 95 a 205: la maniglia a destra è a 209.
    let testo = disegno(
        "<rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"none\" stroke=\"#000000\" stroke-width=\"10\"/>",
    );
    let esito = tira(&testo, &["oa1a1a1a1"], (209.0, 125.0), (259.0, 125.0));
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(1.4545 0 0 1 -43.1818 0)")
    );
}

#[test]
fn ridimensionare_sotto_la_misura_minima() {
    let testo = disegno(A);
    let esito = tira(&testo, &["oa1a1a1a1"], (204.0, 125.0), (20.0, 125.0));
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(0.01 0 0 1 99 0)")
    );
}

#[test]
fn ridimensionare_una_cornice_inclinata_lungo_i_suoi_assi() {
    // La cornice è inclinata: la maniglia di destra, a metà altezza, sta a
    // (204, 125) nella cornice e a (266,5, 125) nella scena.
    let testo = disegno(
        "<rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" transform=\"matrix(1 0 0.5 1 0 0)\"/>",
    );
    let esito = tira(&testo, &["oa1a1a1a1"], (266.5, 125.0), (306.5, 125.0));
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(1.4 0 0.5 1 -40 0)")
    );
}

#[test]
fn ruotare_una_cornice_inclinata() {
    // La maniglia tonda: 24 px sopra il lato in alto della cornice col
    // margine, a metà.
    let ly = (0.3f64 * 0.3 + 1.0).sqrt();
    let y0 = 100.0 - 4.0 / ly;
    let presa = (150.0 + 0.3 * y0, y0 - 24.0);
    let perno = (187.5, 125.0);
    // Un quarto di giro in senso orario attorno al centro.
    let fine = (perno.0 - (presa.1 - perno.1), perno.1 + (presa.0 - perno.0));
    let testo = disegno(
        "<rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" transform=\"matrix(1 0 0.3 1 0 0)\"/>",
    );
    let esito = tira(&testo, &["oa1a1a1a1"], presa, fine);
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(0 1 -1 0.3 312.5 -62.5)")
    );
}

#[test]
fn una_forma_in_un_livello_spostato() {
    let testo = disegno(A).replace(
        "fub:layer=\"Livello 1\"",
        "fub:layer=\"Livello 1\" transform=\"translate(10 0)\"",
    );
    let esito = tira(&testo, &[], (160.0, 125.0), (180.0, 135.0));
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(1 0 0 1 20 10)")
    );
    assert_eq!(esito.selection, ["oa1a1a1a1"]);
}

#[test]
fn un_id_che_non_c_e_piu_esce_dalla_selezione() {
    let testo = disegno(A);
    let esito = clic(&testo, &["osparito1"], (300.0, 250.0));
    assert_eq!(esito.refused, None);
    assert!(esito.selection.is_empty(), "{:?}", esito.selection);
    let esito = clic(&testo, &["osparito1", "oa1a1a1a1"], (150.0, 125.0));
    assert_eq!(esito.selection, ["oa1a1a1a1"]);
}

#[test]
fn l_anteprima_e_la_matrice_e_il_riquadro() {
    let testo = disegno(A);
    let (mut d, _) = apri(&testo);
    let primo = d
        .gesto(richiesta(
            "preview",
            &[],
            vec![evento("down", 150.0, 125.0), evento("drag", 151.0, 125.0)],
        ))
        .expect("anteprima");
    // Sotto la soglia del trascinamento non si muove niente.
    assert_eq!(primo.preview.and_then(|p| p.matrix), None);
    let secondo = d
        .gesto(richiesta(
            "preview",
            &[],
            vec![evento("drag", 170.0, 135.0)],
        ))
        .expect("anteprima");
    assert_eq!(
        secondo.preview.and_then(|p| p.matrix),
        Some([1.0, 0.0, 0.0, 1.0, 20.0, 10.0])
    );
    let fine = d
        .gesto(richiesta("commit", &[], vec![evento("up", 170.0, 135.0)]))
        .expect("commit");
    assert_eq!(
        trasformazione(&fine, "oa1a1a1a1").as_deref(),
        Some("matrix(1 0 0 1 20 10)")
    );

    let (mut d, _) = apri(&testo);
    let riquadro = d
        .gesto(richiesta(
            "preview",
            &[],
            vec![evento("down", 300.0, 250.0), evento("drag", 250.0, 200.0)],
        ))
        .expect("anteprima");
    assert_eq!(
        riquadro.preview.and_then(|p| p.marquee),
        Some([250.0, 200.0, 50.0, 50.0])
    );
}

#[test]
fn il_riquadro_a_pezzi_sceglie_solo_cio_che_contiene() {
    let mezzo = "<rect id=\"ob2b2b2b2\" x=\"250\" y=\"100\" width=\"100\" height=\"50\"/>";
    let testo = disegno(&format!("{A}\n    {mezzo}"));
    let (mut d, _) = apri(&testo);
    d.gesto(richiesta(
        "preview",
        &[],
        vec![evento("down", 90.0, 90.0), evento("drag", 200.0, 160.0)],
    ))
    .expect("anteprima");
    let esito = d
        .gesto(richiesta(
            "commit",
            &[],
            vec![evento("drag", 300.0, 160.0), evento("up", 300.0, 160.0)],
        ))
        .expect("commit");
    assert_eq!(esito.ops, None);
    assert_eq!(esito.selection, ["oa1a1a1a1"]);
}

#[test]
fn maiusc_e_trascinare_un_oggetto_scelto_sposta_tutta_la_selezione() {
    let b = "<rect id=\"ob2b2b2b2\" x=\"250\" y=\"200\" width=\"50\" height=\"50\"/>";
    let testo = disegno(&format!("{A}\n    {b}"));
    // Già scelto, la selezione resta com'è; aggiunto, va in fondo, come in
    // `selectStart`.
    for (scelti, dopo) in [
        (&["ob2b2b2b2", "oa1a1a1a1"][..], ["ob2b2b2b2", "oa1a1a1a1"]),
        (&["ob2b2b2b2"][..], ["ob2b2b2b2", "oa1a1a1a1"]),
        (&["oa1a1a1a1", "ob2b2b2b2"][..], ["oa1a1a1a1", "ob2b2b2b2"]),
    ] {
        let (mut d, _) = apri(&testo);
        let mut giu = evento("down", 150.0, 125.0);
        giu["shift"] = json!(true);
        let mut su = evento("up", 170.0, 135.0);
        su["shift"] = json!(true);
        let esito = d
            .gesto(richiesta(
                "commit",
                scelti,
                vec![giu, evento("drag", 170.0, 135.0), su],
            ))
            .expect("commit");
        assert_eq!(esito.refused, None, "{scelti:?}");
        for id in ["oa1a1a1a1", "ob2b2b2b2"] {
            assert_eq!(
                trasformazione(&esito, id).as_deref(),
                Some("matrix(1 0 0 1 20 10)"),
                "{scelti:?}: {id}"
            );
        }
        assert_eq!(esito.selection, dopo);
    }
}

#[test]
fn maiusc_e_il_riquadro_aggiungono_alla_selezione() {
    let b = "<rect id=\"ob2b2b2b2\" x=\"250\" y=\"200\" width=\"50\" height=\"50\"/>";
    let testo = disegno(&format!("{A}\n    {b}"));
    let (mut d, _) = apri(&testo);
    let mut giu = evento("down", 240.0, 190.0);
    giu["shift"] = json!(true);
    let esito = d
        .gesto(richiesta(
            "commit",
            &["oa1a1a1a1"],
            vec![
                giu,
                evento("drag", 310.0, 260.0),
                evento("up", 310.0, 260.0),
            ],
        ))
        .expect("commit");
    assert_eq!(esito.selection, ["oa1a1a1a1", "ob2b2b2b2"]);
}
