//! La Selezione del motore del disegno: ogni vettore dei gesti della
//! selezione (`apps/client/src/__fixtures__/disegno-gesti/`) rigiocato sul
//! motore deve dare le stesse operazioni, lo stesso rifiuto e la stessa
//! selezione; una differenza è ammessa solo se `tests/gesti/selezione.tsv`
//! la nomina col perché. Poi i casi che i vettori non coprono.

mod common;

use std::path::Path;

use common::{ammesse, apri, confronta_ops, ops_di, vettori, Confronto};
use fub_abi::{DrawingFrame, DrawingGesture, DrawingOutcome, DrawingRefusal};
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

fn con_ctrl(mut e: Value) -> Value {
    e["cmd"] = json!(true);
    e
}

#[test]
fn ctrl_sceglie_e_sposta_dentro_i_gruppi() {
    let b = "<rect id=\"ob2b2b2b2\" x=\"250\" y=\"100\" width=\"50\" height=\"50\"/>";
    let testo = disegno(&format!(
        "<g id=\"og1g1g1g1\"><g id=\"og2g2g2g2\">{A}</g>{b}</g>"
    ));
    // Un clic: l'oggetto più dentro, attraverso i due gruppi.
    let (mut d, _) = apri(&testo);
    let esito = d
        .gesto(richiesta(
            "commit",
            &[],
            vec![
                con_ctrl(evento("down", 150.0, 125.0)),
                con_ctrl(evento("up", 150.0, 125.0)),
            ],
        ))
        .expect("commit");
    assert_eq!(esito.ops, None);
    assert_eq!(esito.selection, ["oa1a1a1a1"]);
    // Trascinato: si sposta lui solo, senza la griglia (Ctrl/⌘ la scioglie).
    let (mut d, _) = apri(&testo);
    let mut con_griglia = richiesta(
        "commit",
        &[],
        vec![
            con_ctrl(evento("down", 150.0, 125.0)),
            con_ctrl(evento("drag", 163.0, 131.0)),
            con_ctrl(evento("up", 163.0, 131.0)),
        ],
    );
    con_griglia.snap.grid = Some(20.0);
    let esito = d.gesto(con_griglia).expect("commit");
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(1 0 0 1 13 6)")
    );
    assert_eq!(trasformazione(&esito, "og1g1g1g1"), None);
    assert_eq!(trasformazione(&esito, "og2g2g2g2"), None);
    assert_eq!(esito.selection, ["oa1a1a1a1"]);
    // Senza Ctrl lo stesso clic sceglie il gruppo in cima.
    let esito = clic(&testo, &[], (150.0, 125.0));
    assert_eq!(esito.selection, ["og1g1g1g1"]);
}

#[test]
fn la_soglia_passata_resta_passata() {
    let testo = disegno(A);
    // Oltre la soglia e di nuovo a un passo dalla pressione: lo spostamento
    // è quel passo.
    let esito = tira(&testo, &[], (150.0, 125.0), (151.0, 125.0));
    assert_eq!(esito.ops, None, "senza passare la soglia non si sposta");
    let (mut d, _) = apri(&testo);
    let esito = d
        .gesto(richiesta(
            "commit",
            &[],
            vec![
                evento("down", 150.0, 125.0),
                evento("drag", 170.0, 125.0),
                evento("drag", 151.0, 125.0),
                evento("up", 151.0, 125.0),
            ],
        ))
        .expect("commit");
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(1 0 0 1 1 0)")
    );
    // Lo stesso a pezzi: la sessione ricorda la soglia fra un pezzo e
    // l'altro, e l'anteprima la segue.
    let (mut d, _) = apri(&testo);
    d.gesto(richiesta(
        "preview",
        &[],
        vec![evento("down", 150.0, 125.0), evento("drag", 170.0, 125.0)],
    ))
    .expect("anteprima");
    let indietro = d
        .gesto(richiesta(
            "preview",
            &[],
            vec![evento("drag", 151.0, 125.0)],
        ))
        .expect("anteprima");
    assert_eq!(
        indietro.preview.and_then(|p| p.matrix),
        Some([1.0, 0.0, 0.0, 1.0, 1.0, 0.0])
    );
    let esito = d
        .gesto(richiesta("commit", &[], vec![evento("up", 151.0, 125.0)]))
        .expect("commit");
    assert_eq!(
        trasformazione(&esito, "oa1a1a1a1").as_deref(),
        Some("matrix(1 0 0 1 1 0)")
    );
    // Un gesto nuovo ricomincia sotto la soglia.
    let esito = d
        .gesto(richiesta(
            "commit",
            &[],
            vec![evento("down", 150.0, 125.0), evento("up", 151.0, 125.0)],
        ))
        .expect("commit");
    assert_eq!(esito.ops, None);
}

#[test]
fn maiusc_su_un_oggetto_scelto_trascinato_e_tornato_non_lo_lascia() {
    let b = "<rect id=\"ob2b2b2b2\" x=\"250\" y=\"200\" width=\"50\" height=\"50\"/>";
    let testo = disegno(&format!("{A}\n    {b}"));
    let (mut d, _) = apri(&testo);
    let mut giu = evento("down", 150.0, 125.0);
    giu["shift"] = json!(true);
    let esito = d
        .gesto(richiesta(
            "commit",
            &["oa1a1a1a1", "ob2b2b2b2"],
            vec![
                giu,
                evento("drag", 170.0, 125.0),
                evento("drag", 150.0, 125.0),
                evento("up", 150.0, 125.0),
            ],
        ))
        .expect("commit");
    assert_eq!(esito.ops, None);
    assert_eq!(esito.selection, ["oa1a1a1a1", "ob2b2b2b2"]);
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty));
}

// --- La cornice tenuta fra un gesto e l'altro ---------------------------------

/// Il secondo rettangolo: il riquadro comune con A va da (100, 100) a
/// (320, 220), il centro è (210, 160), la maniglia tonda (210, 72).
const B_LONTANO: &str =
    "<rect id=\"ob2b2b2b2\" x=\"260\" y=\"180\" width=\"60\" height=\"40\" fill=\"#e69f00\"/>";

/// A e il secondo rettangolo, con la `transform` data.
fn due(trasformazione: Option<&str>) -> String {
    let con = |rect: &str| match trasformazione {
        Some(t) => rect.replace("/>", &format!(" transform=\"{t}\"/>")),
        None => rect.to_string(),
    };
    disegno(&format!("{}\n    {}", con(A), con(B_LONTANO)))
}

/// Un trascinamento da `da` ad `a` sul disegno `testo`, con la selezione
/// `selezione` e la cornice tenuta `frame`.
fn tira_nella_cornice(
    testo: &str,
    selezione: &[&str],
    frame: Option<DrawingFrame>,
    da: (f64, f64),
    a: (f64, f64),
) -> Result<DrawingOutcome, fub_abi::PluginError> {
    let (mut d, _) = apri(testo);
    let mut g = richiesta(
        "commit",
        selezione,
        vec![
            evento("down", da.0, da.1),
            evento("drag", (da.0 + a.0) / 2.0, (da.1 + a.1) / 2.0),
            evento("drag", a.0, a.1),
            evento("up", a.0, a.1),
        ],
    );
    g.frame = frame;
    d.gesto(g)
}

const AB: [&str; 2] = ["oa1a1a1a1", "ob2b2b2b2"];
/// Il trascinamento della maniglia tonda di 30° in senso orario.
const GIRA: ((f64, f64), (f64, f64)) = ((210.0, 72.0), (254.0, 83.79));
/// Il trascinamento della maniglia di destra della cornice girata di 30°, 40
/// unità lungo il suo asse: da (324, 160) a (364, 160) nella cornice.
const ALLUNGA: ((f64, f64), (f64, f64)) = ((308.727, 217.0), (343.368, 237.0));
/// Ciò che il client scrive per i due gesti di fila, registrato da
/// `createDrawEditor` con gli stessi eventi (`selection-gestures.ts`,
/// `applyFrame`, che tiene la cornice in `ctx.kept`): la stessa
/// trasformazione per i due oggetti.
const GIRATI: &str = "matrix(0.866 0.5 -0.5 0.866 108.1347 -83.5641)";
const ALLUNGATI: &str = "matrix(1.0235 0.5909 -0.5 0.866 92.3891 -92.6548)";

fn vicine(a: [f64; 6], b: [f64; 6]) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6)
}

/// Il riquadro comune dei due rettangoli, senza contorno.
const RIQUADRO: [f64; 4] = [100.0, 100.0, 320.0, 220.0];

/// La cornice dei due rettangoli girata di 30° attorno a (210, 160).
fn girata() -> DrawingFrame {
    let (s, c) = 30f64.to_radians().sin_cos();
    DrawingFrame {
        matrix: [
            c,
            s,
            -s,
            c,
            210.0 - c * 210.0 + s * 160.0,
            160.0 - s * 210.0 - c * 160.0,
        ],
        bounds: RIQUADRO,
        geometry: RIQUADRO,
    }
}

#[test]
fn piu_oggetti_girati_tengono_la_cornice_al_gesto_dopo() {
    // Il primo gesto gira la selezione di 30°, e l'esito rimanda la cornice.
    let primo = tira_nella_cornice(&due(None), &AB, None, GIRA.0, GIRA.1).expect("il gesto");
    assert_eq!(primo.refused, None);
    for id in AB {
        assert_eq!(trasformazione(&primo, id).as_deref(), Some(GIRATI), "{id}");
    }
    assert_eq!(primo.selection, AB);
    let frame = primo.frame.expect("la cornice girata");
    assert!(
        vicine(frame.matrix, girata().matrix),
        "{frame:?} ≠ {:?}",
        girata()
    );
    assert_eq!((frame.bounds, frame.geometry), (RIQUADRO, RIQUADRO));

    // Il secondo, con quella cornice, allunga lungo il suo asse come il
    // client.
    let girati = due(Some(GIRATI));
    let secondo =
        tira_nella_cornice(&girati, &AB, Some(frame), ALLUNGA.0, ALLUNGA.1).expect("il gesto");
    assert_eq!(secondo.refused, None);
    for id in AB {
        assert_eq!(
            trasformazione(&secondo, id).as_deref(),
            Some(ALLUNGATI),
            "{id}"
        );
    }
    assert_eq!(secondo.selection, AB);
    // La cornice dopo: girata di 30° e lunga 260/220 lungo il suo asse, coi
    // riquadri di prima (`movedFrame`).
    let dopo = secondo.frame.expect("la cornice allungata");
    assert_eq!((dopo.bounds, dopo.geometry), (RIQUADRO, RIQUADRO));
    let dopo = dopo.matrix;
    let (s, c) = 30f64.to_radians().sin_cos();
    let k = 260.0 / 220.0;
    assert!(
        (dopo[0] - k * c).abs() < 1e-3 && (dopo[1] - k * s).abs() < 1e-3,
        "{dopo:?}"
    );
    assert!(
        (dopo[2] + s).abs() < 1e-6 && (dopo[3] - c).abs() < 1e-6,
        "{dopo:?}"
    );

    // Senza la cornice lo stesso gesto non tira la maniglia girata.
    let senza = tira_nella_cornice(&girati, &AB, None, ALLUNGA.0, ALLUNGA.1).expect("il gesto");
    assert_ne!(
        trasformazione(&senza, "oa1a1a1a1").as_deref(),
        Some(ALLUNGATI)
    );
}

#[test]
fn la_cornice_si_lascia_se_la_selezione_e_cambiata() {
    let girati = due(Some(GIRATI));
    // Un id che non c'è più cambia la selezione: il gesto è quello senza
    // cornice.
    let con = ["oa1a1a1a1", "ob2b2b2b2", "osparito1"];
    let lasciata =
        tira_nella_cornice(&girati, &con, Some(girata()), ALLUNGA.0, ALLUNGA.1).expect("il gesto");
    let senza = tira_nella_cornice(&girati, &con, None, ALLUNGA.0, ALLUNGA.1).expect("il gesto");
    assert_eq!(lasciata, senza);
    // Un clic che sceglie un oggetto solo: la cornice non torna.
    let (s, c) = 30f64.to_radians().sin_cos();
    let centro_a = (210.0 - c * 60.0 + s * 35.0, 160.0 - s * 60.0 - c * 35.0);
    let (mut d, _) = apri(&girati);
    let mut g = richiesta(
        "commit",
        &AB,
        vec![
            evento("down", centro_a.0, centro_a.1),
            evento("up", centro_a.0, centro_a.1),
        ],
    );
    g.frame = Some(girata());
    let esito = d.gesto(g).expect("il gesto");
    assert_eq!(esito.frame, None);
}

#[test]
fn un_oggetto_solo_ha_la_sua_cornice() {
    // Una cornice data per un oggetto solo non conta, e l'esito non ne
    // rimanda nessuna: il lato destro di A è a 204.
    let storta = Some(DrawingFrame {
        matrix: [2.0, 0.0, 0.0, 0.5, -30.0, 7.0],
        ..girata()
    });
    let tira = |frame| {
        tira_nella_cornice(
            &disegno(A),
            &["oa1a1a1a1"],
            frame,
            (204.0, 125.0),
            (254.0, 125.0),
        )
        .expect("il gesto")
    };
    let con = tira(storta);
    assert_eq!(con, tira(None));
    assert_eq!(
        trasformazione(&con, "oa1a1a1a1").as_deref(),
        Some("matrix(1.5 0 0 1 -50 0)")
    );
    assert_eq!(con.frame, None);
}

#[test]
fn una_cornice_senza_inversa_e_bad_args() {
    for matrix in [
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        [1.0, 2.0, 2.0, 4.0, 5.0, 5.0],
    ] {
        let frame = DrawingFrame { matrix, ..girata() };
        let esito = tira_nella_cornice(&due(None), &AB, Some(frame), GIRA.0, GIRA.1);
        assert!(
            matches!(esito, Err(fub_abi::PluginError::BadArgs(_))),
            "{frame:?}: {esito:?}"
        );
    }
}

#[test]
fn spostare_porta_con_se_la_cornice_tenuta() {
    let girati = due(Some(GIRATI));
    // Il centro di A girato: (150, 125) attorno a (210, 160).
    let (s, c) = 30f64.to_radians().sin_cos();
    let a = (210.0 - c * 60.0 + s * 35.0, 160.0 - s * 60.0 - c * 35.0);
    let fine = (a.0 + 20.0, a.1 + 10.0);
    let esito = tira_nella_cornice(&girati, &AB, Some(girata()), a, fine).expect("il gesto");
    assert_eq!(esito.refused, None);
    let mut attesa = girata().matrix;
    attesa[4] += 20.0;
    attesa[5] += 10.0;
    let spostata = esito.frame.expect("la cornice spostata");
    assert!(vicine(spostata.matrix, attesa), "{spostata:?} ≠ {attesa:?}");
    assert_eq!(spostata.bounds, RIQUADRO);
    // Senza una cornice tenuta, il riquadro comune non si tiene.
    let esito = tira_nella_cornice(&girati, &AB, None, a, fine).expect("il gesto");
    assert_eq!(esito.refused, None);
    assert_eq!(esito.frame, None);
}

/// Il file `inkscape` del corpus dopo «Modifica», come il client lo adotta
/// (`fub:version` sulla radice).
fn inkscape() -> String {
    let testo = std::fs::read_to_string(
        common::radice().join("crates/fub-scene/tests/corpus/inkscape.svg"),
    )
    .expect("il file inkscape del corpus");
    let adottato = testo.replacen(
        "xmlns:dc=\"http://purl.org/dc/elements/1.1/\">",
        "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\">",
        1,
    );
    assert_ne!(adottato, testo, "la radice del file inkscape è cambiata");
    adottato
}

/// Le operazioni dell'esito devono essere `attese`, quelle che il client
/// scrive per lo stesso gesto.
fn come_il_client(esito: &DrawingOutcome, attese: Value) {
    assert_eq!(esito.refused, None);
    if let Confronto::Diverse(perche) = confronta_ops(&attese, &ops_di(esito), None) {
        panic!("non come il client: {perche}");
    }
}

// Un gruppo `inkscape:groupmode="layer"` è un livello per il lettore SVG del
// motore e un gruppo per Fub: la copia del motore lo tiene come un gruppo,
// e la Selezione lo sceglie, lo sposta e lo gira come il client. Le
// operazioni attese sono registrate dal client (`createDrawEditor`, gli
// stessi gesti).

#[test]
fn un_livello_di_inkscape_si_sposta_e_gira_come_nel_client() {
    let testo = inkscape();
    // `layer1` (bloccato per Inkscape, `sodipodi:insensitive`, non per Fub)
    // si sceglie col clic sul suo rettangolo, e si sposta.
    let esito = tira(&testo, &[], (40.0, 40.0), (50.0, 45.0));
    come_il_client(
        &esito,
        json!([{ "op": "set", "id": "layer1", "attrs": { "transform": "matrix(1 0 0 1 10 5)" } }]),
    );
    assert_eq!(esito.selection, ["layer1"]);
    // Dieci gradi con la maniglia tonda: 24 px sopra la cornice (y = 16),
    // attorno al centro (105, 70).
    let (perno, braccio) = ((105.0, 70.0), 78.0);
    let gradi = 10f64.to_radians();
    let fine = (
        perno.0 + braccio * gradi.sin(),
        perno.1 - braccio * gradi.cos(),
    );
    let esito = tira(&testo, &["layer1"], (105.0, -8.0), fine);
    come_il_client(
        &esito,
        json!([{ "op": "set", "id": "layer1", "attrs": { "transform": "matrix(0.9848 0.1736 -0.1736 0.9848 13.7506 -17.1696)" } }]),
    );
    assert_eq!(esito.selection, ["layer1"]);
    // Un quarto di giro: la stessa matrice del client, che in più allarga la
    // pagina (`page`), perché il rettangolo ne esce in alto.
    let esito = tira(&testo, &["layer1"], (105.0, -8.0), (183.0, 70.0));
    assert_eq!(esito.refused, None);
    assert_eq!(
        trasformazione(&esito, "layer1").as_deref(),
        Some("matrix(0 1 -1 0 175 -35)")
    );
}

#[test]
fn piu_livelli_di_inkscape_insieme() {
    let testo = inkscape();
    // `layer2` scelto: il clic sul cerchio dentro di lui sposta lui.
    let esito = tira(&testo, &["layer2"], (150.0, 60.0), (160.0, 70.0));
    come_il_client(
        &esito,
        json!([{ "op": "set", "id": "layer2", "attrs": { "transform": "matrix(1 0 0 1 10 10)" } }]),
    );
    assert_eq!(esito.selection, ["layer2"]);
    let esito = tira(&testo, &["layer1", "layer2"], (40.0, 40.0), (50.0, 45.0));
    come_il_client(
        &esito,
        json!([{ "op": "batch", "ops": [
            { "op": "set", "id": "layer1", "attrs": { "transform": "matrix(1 0 0 1 10 5)" } },
            { "op": "set", "id": "layer2", "attrs": { "transform": "matrix(1 0 0 1 10 5)" } },
        ] }]),
    );
    assert_eq!(esito.selection, ["layer1", "layer2"]);
}

/// Livelli di Inkscape uno dentro l'altro (con due figli: con uno solo la
/// differenza scrive la `transform` sul figlio), uno con la sua
/// `transform`, uno vuoto e uno nascosto.
const LIVELLI_INKSCAPE: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:inkscape=\"http://www.inkscape.org/namespaces/inkscape\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <g id=\"la\" inkscape:groupmode=\"layer\" transform=\"translate(10 0)\">\n    <rect id=\"ra\" x=\"40\" y=\"40\" width=\"60\" height=\"40\" fill=\"#000000\"/>\n    <g id=\"lb\" inkscape:groupmode=\"layer\"><rect id=\"rb\" x=\"200\" y=\"40\" width=\"60\" height=\"40\" fill=\"#ff0000\"/><rect id=\"rc\" x=\"280\" y=\"40\" width=\"40\" height=\"40\" fill=\"#00ff00\"/></g>\n  </g>\n  <g id=\"lv\" inkscape:groupmode=\"layer\"/>\n  <g id=\"ln\" inkscape:groupmode=\"layer\" display=\"none\"><rect id=\"rn\" x=\"40\" y=\"200\" width=\"60\" height=\"40\"/></g>\n</svg>\n";

#[test]
fn livelli_di_inkscape_dentro_vuoti_nascosti() {
    // Un livello con già una `transform`: la nuova la compone.
    let esito = tira(LIVELLI_INKSCAPE, &[], (60.0, 50.0), (80.0, 60.0));
    come_il_client(
        &esito,
        json!([{ "op": "set", "id": "la", "attrs": { "transform": "matrix(1 0 0 1 30 10)" } }]),
    );
    assert_eq!(esito.selection, ["la"]);
    // Il livello dentro un livello: scelto, si sposta da solo, nello spazio
    // del livello che lo contiene.
    let esito = tira(LIVELLI_INKSCAPE, &["lb"], (220.0, 50.0), (240.0, 60.0));
    come_il_client(
        &esito,
        json!([{ "op": "set", "id": "lb", "attrs": { "transform": "matrix(1 0 0 1 20 10)" } }]),
    );
    assert_eq!(esito.selection, ["lb"]);
    // Il livello nascosto non si sceglie: il clic va nel vuoto.
    let esito = clic(LIVELLI_INKSCAPE, &[], (60.0, 210.0));
    assert_eq!(esito.ops, None);
    assert!(esito.selection.is_empty(), "{:?}", esito.selection);
}
