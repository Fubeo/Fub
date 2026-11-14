//! Le forme del motore del disegno: ogni vettore dei gesti di rettangolo,
//! ellisse, linea e freccia (`apps/client/src/__fixtures__/disegno-gesti/`)
//! rigiocato sul motore deve dare le stesse operazioni, lo stesso rifiuto e
//! la stessa selezione; una differenza è ammessa solo se
//! `tests/gesti/forme.tsv` la nomina col perché. Poi i casi che i vettori
//! non coprono: l'anteprima a pezzi, l'annullamento, gli zoom estremi, la
//! pressione zero, i modificatori che il motore leggerebbe a modo suo, un
//! livello trasformato.

mod common;

use std::path::Path;

use common::{ammesse, apri, confronta_ops, ops_di, vettori, Confronto};
use fub_abi::{DrawingGesture, DrawingOutcome, DrawingPhase, DrawingRefusal};
use serde_json::{json, Value};

const FORME: [&str; 4] = ["rect", "ellipse", "line", "arrow"];

fn percorso_tsv() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/gesti/forme.tsv")
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

#[test]
fn rigioca_i_vettori_delle_forme() {
    let ammesse = ammesse(&percorso_tsv());
    let mut diverse = Vec::new();
    let mut nomi = Vec::new();
    for v in vettori() {
        if !FORME.contains(&v.gesto["tool"].as_str().unwrap_or_default()) {
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
            if esito.selection != v.selezione {
                diverse.push(format!(
                    "{}: selezione {:?} ≠ {:?}",
                    v.nome, esito.selection, v.selezione
                ));
            }
        }
    }
    assert!(
        nomi.len() >= 20,
        "i vettori delle forme sono {}: ne mancano",
        nomi.len()
    );
    for (nome, perche) in &ammesse {
        assert!(
            nomi.contains(nome),
            "forme.tsv nomina {nome}, che non è un vettore delle forme"
        );
        assert!(!perche.is_empty(), "forme.tsv: {nome} non dice perché");
    }
    assert!(diverse.is_empty(), "{}", diverse.join("\n"));
}

const DISEGNO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n";

fn evento(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn richiesta(tool: &str, zoom: f64, phase: &str, eventi: Vec<Value>) -> DrawingGesture {
    gesto(json!({
        "phase": phase,
        "tool": tool,
        "layer": null,
        "selection": [],
        "zoom": zoom,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#000000", "width": 4, "fill": null },
        "events": eventi,
    }))
}

fn tirato(tool: &str, zoom: f64, da: (f64, f64), a: (f64, f64)) -> DrawingOutcome {
    let (mut d, _) = apri(DISEGNO);
    d.gesto(richiesta(
        tool,
        zoom,
        "commit",
        vec![
            evento("down", da.0, da.1),
            evento("drag", a.0, a.1),
            evento("up", a.0, a.1),
        ],
    ))
    .expect("il gesto")
}

fn elem_aggiunto(esito: &DrawingOutcome) -> Value {
    let ops = ops_di(esito);
    assert_eq!(ops[0]["op"], "add", "{ops}");
    ops[0]["elem"].clone()
}

#[test]
fn anteprima_a_pezzi_poi_il_commit() {
    let (mut d, _) = apri(DISEGNO);
    let primo = d
        .gesto(richiesta(
            "ellipse",
            1.0,
            "preview",
            vec![evento("down", 40.0, 40.0), evento("drag", 80.0, 60.0)],
        ))
        .expect("anteprima");
    assert_eq!(primo.ops, None);
    let forma = primo.preview.and_then(|p| p.shape).expect("la forma");
    assert_eq!(
        forma,
        json!({ "tag": "ellipse", "attrs": { "id": "preview", "cx": "60", "cy": "50", "rx": "20", "ry": "10", "fill": "none", "stroke": "#000000", "stroke-width": "4" } })
    );
    let secondo = d
        .gesto(richiesta(
            "ellipse",
            1.0,
            "preview",
            vec![evento("drag", 140.0, 100.0)],
        ))
        .expect("anteprima");
    let forma = secondo.preview.and_then(|p| p.shape).expect("la forma");
    assert_eq!(forma["attrs"]["rx"], "50");
    let fine = d
        .gesto(richiesta(
            "ellipse",
            1.0,
            "commit",
            vec![evento("up", 140.0, 100.0)],
        ))
        .expect("commit");
    let elem = elem_aggiunto(&fine);
    assert_eq!(elem["attrs"]["cx"], "90");
    assert_eq!(elem["attrs"]["ry"], "30");
    assert_eq!(fine.refused, None);
}

#[test]
fn anteprima_sotto_la_misura_minima_e_annullamento() {
    let (mut d, _) = apri(DISEGNO);
    let piccola = d
        .gesto(richiesta(
            "rect",
            1.0,
            "preview",
            vec![evento("down", 40.0, 40.0), evento("drag", 42.0, 42.0)],
        ))
        .expect("anteprima");
    assert!(piccola.preview.and_then(|p| p.shape).is_none());
    let via = d
        .gesto(richiesta("rect", 1.0, "cancel", vec![]))
        .expect("annullato");
    assert_eq!((via.ops, via.refused), (None, None));
    // Dopo l'annullamento il disegno è quello di prima: un gesto nuovo parte
    // da lì.
    let dopo = d
        .gesto(richiesta(
            "rect",
            1.0,
            "commit",
            vec![
                evento("down", 10.0, 10.0),
                evento("drag", 60.0, 40.0),
                evento("up", 60.0, 40.0),
            ],
        ))
        .expect("il gesto");
    assert_eq!(ops_di(&dopo).as_array().map(Vec::len), Some(1));
}

#[test]
fn zoom_estremi() {
    // Al 6400% la misura minima è 0,0625 unità.
    let piccolo = tirato("rect", 64.0, (10.0, 10.0), (10.05, 10.05));
    assert_eq!(piccolo.refused, Some(DrawingRefusal::Empty));
    let elem = elem_aggiunto(&tirato("rect", 64.0, (10.0, 10.0), (10.1, 10.2)));
    assert_eq!(elem["attrs"]["width"], "0.1");
    assert_eq!(elem["attrs"]["height"], "0.2");
    // All'1% è 400 unità: anche un tratto lungo è un tocco.
    for a in [(150.0, 10.0), (310.0, 10.0)] {
        let esito = tirato("line", 0.01, (10.0, 10.0), a);
        assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "fino a {a:?}");
        assert_eq!(esito.ops, None);
    }
    let elem = elem_aggiunto(&tirato("line", 0.01, (-100.0, 10.0), (390.0, 10.0)));
    assert_eq!(elem["attrs"]["x1"], "-100");
}

#[test]
fn pressione_zero_e_trascinare_all_indietro() {
    let (mut d, _) = apri(DISEGNO);
    let mut eventi = vec![
        evento("down", 160.0, 90.0),
        evento("drag", 100.0, 60.0),
        evento("drag", 40.0, 40.0),
        evento("up", 40.0, 40.0),
    ];
    for e in &mut eventi {
        e["pressure"] = json!(0.0);
    }
    let esito = d
        .gesto(richiesta("arrow", 1.0, "commit", eventi))
        .expect("il gesto");
    let elem = elem_aggiunto(&esito);
    assert_eq!(elem["attrs"]["fub:geom"], "160 90 40 40");
    let rett = elem_aggiunto(&tirato("rect", 1.0, (300.0, 200.0), (220.0, 250.0)));
    assert_eq!(
        (
            &rett["attrs"]["x"],
            &rett["attrs"]["y"],
            &rett["attrs"]["width"],
            &rett["attrs"]["height"]
        ),
        (&json!("220"), &json!("200"), &json!("80"), &json!("50"))
    );
}

#[test]
fn alt_e_ctrl_non_cambiano_la_forma() {
    // Nel motore Alt disegnerebbe dal centro e Ctrl/⌘ presterebbe la
    // selezione; in Fub non fanno niente alle forme senza griglia.
    let (mut d, _) = apri(DISEGNO);
    let mut eventi = vec![
        evento("down", 10.0, 10.0),
        evento("drag", 60.0, 40.0),
        evento("up", 60.0, 40.0),
    ];
    for e in &mut eventi {
        e["alt"] = json!(true);
        e["cmd"] = json!(true);
    }
    let esito = d
        .gesto(richiesta("rect", 1.0, "commit", eventi))
        .expect("il gesto");
    let elem = elem_aggiunto(&esito);
    assert_eq!(
        elem,
        json!({ "tag": "rect", "attrs": { "id": elem["attrs"]["id"], "x": "10", "y": "10", "width": "50", "height": "30", "fill": "none", "stroke": "#000000", "stroke-width": "4" } })
    );
}

#[test]
fn livello_trasformato_e_livelli_tutti_chiusi() {
    let scalato = DISEGNO.replace(
        "fub:layer=\"Livello 1\"",
        "fub:layer=\"Livello 1\" transform=\"matrix(2 0 0 2 0 0)\"",
    );
    let (mut d, _) = apri(&scalato);
    let mut g = richiesta(
        "rect",
        1.0,
        "commit",
        vec![
            evento("down", 20.0, 20.0),
            evento("drag", 60.0, 40.0),
            evento("up", 60.0, 40.0),
        ],
    );
    g.events.iter_mut().for_each(|e| e.shift = true);
    let elem = elem_aggiunto(&d.gesto(g).expect("il gesto"));
    // Nello spazio del livello, quadrato lì, col contorno scelto.
    assert_eq!(
        (
            &elem["attrs"]["x"],
            &elem["attrs"]["width"],
            &elem["attrs"]["height"],
            &elem["attrs"]["stroke-width"]
        ),
        (&json!("10"), &json!("20"), &json!("20"), &json!("4"))
    );

    let chiuso = DISEGNO.replace(
        "fub:layer=\"Livello 1\"",
        "fub:layer=\"Livello 1\" fub:locked=\"true\"",
    );
    let (mut d, _) = apri(&chiuso);
    let esito = d
        .gesto(richiesta(
            "line",
            1.0,
            "commit",
            vec![evento("down", 10.0, 10.0), evento("up", 90.0, 10.0)],
        ))
        .expect("il gesto");
    assert_eq!(
        (esito.ops, esito.refused),
        (None, Some(DrawingRefusal::Locked))
    );

    let (mut d, _) = apri(DISEGNO);
    let mut g = richiesta("line", 1.0, "commit", vec![evento("down", 10.0, 10.0)]);
    g.layer = Some("lnonesiste".into());
    g.phase = DrawingPhase::Commit;
    let esito = d.gesto(g).expect("il gesto");
    assert_eq!(esito.refused, Some(DrawingRefusal::Locked));
}
