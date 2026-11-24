#![cfg(feature = "completo")]
//! I casi della famiglia `elaborazione` e `testo` che hanno bisogno di Inter (K6 T12 e T16).
//!
//! Stanno in un binario a sé, e non in `famiglie.rs`: `disegni_con_inter()` aggiunge le facce di
//! Inter alla `FontDb` del processo (`crates/fub-disegno/src/motore.rs`, `dai_caratteri`), e una volta
//! lì restano per tutto il processo. Nello stesso binario i casi di `famiglie.rs` misurano il testo
//! con Inter e non più col ripiego, e cambiano esito a seconda dell'ordine dei test (quattro rossi di
//! `cargo test`, che nextest, un processo per test, non vedeva). Così ognuno dei due binari ha il suo
//! stato dei caratteri.

mod casi;
mod common;

use casi::{cartella_famiglie, leggi_cartella};
use serde_json::json;

/// Un testo entra nell'Elaborazione tracciati col contorno delle sue lettere
/// quando il motore ha i caratteri (T12, giro 5): Unione del quadrato
/// oa1a1a1a1 e di «Ciao» in Inter toglie i due oggetti e scrive un tracciato
/// solo, il quadrato più le lettere. Senza caratteri lo stesso caso di
/// `tracciati.json` è `unmapped`: il testo sparirebbe senza entrare.
#[test]
fn l_elaborazione_usa_le_lettere_di_un_testo() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let caso = casi
        .iter()
        .find(|c| c.id == "object.pathfinder.unite" && c.selezione == ["oa1a1a1a1", "od4d4d4d4"])
        .expect("il caso di Unione col testo");
    let (mut disegno, _) =
        fub_disegno::motore::Disegno::apri_con(&disegni, &caso.disegno).expect("si apre");
    let esito = casi::esegui_sul_disegno(&mut disegno, caso)
        .expect("si esegue")
        .expect("senza errore");
    assert_eq!(esito.refused, None, "il testo con Inter entra");
    let ops: serde_json::Value =
        serde_json::from_str(&esito.ops.expect("le operazioni")).expect("json");
    let ops = ops[0]["ops"].as_array().expect("un passo solo").clone();
    let tolti: Vec<&str> = ops
        .iter()
        .filter(|o| o["op"] == "remove")
        .filter_map(|o| o["target"].as_str())
        .collect();
    assert_eq!(tolti.len(), 2, "{ops:?}");
    assert!(tolti.contains(&"oa1a1a1a1") && tolti.contains(&"od4d4d4d4"));
    let aggiunti: Vec<&serde_json::Value> = ops.iter().filter(|o| o["op"] == "add").collect();
    assert_eq!(aggiunti.len(), 1, "{ops:?}");
    let d = aggiunti[0]["elem"]["attrs"]["d"]
        .as_str()
        .expect("un tracciato");
    // Il quadrato e le lettere: C, i (asta e punto), a, o (con i buchi).
    assert!(d.matches('M').count() >= 6, "solo il quadrato? {d}");
}

/// Crea profili scrive i contorni delle lettere quando il motore ha i
/// caratteri (K6 T16): «Una riga» in Inter diventa un gruppo nuovo, con un
/// tracciato per lettera, al posto del testo. Senza caratteri lo stesso
/// caso di `testo.json` è `unsupported`: il testo sparirebbe senza contorni.
#[test]
fn crea_profili_scrive_le_lettere() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let caso = casi
        .iter()
        .find(|c| c.id == "type.createOutlines")
        .expect("il caso di Crea profili");
    let (mut disegno, _) =
        fub_disegno::motore::Disegno::apri_con(&disegni, &caso.disegno).expect("si apre");
    let esito = casi::esegui_sul_disegno(&mut disegno, caso)
        .expect("si esegue")
        .expect("senza errore");
    assert_eq!(esito.refused, None, "il testo con Inter ha i contorni");
    let ops: serde_json::Value =
        serde_json::from_str(&esito.ops.expect("le operazioni")).expect("json");
    let ops = ops[0]["ops"].as_array().expect("un passo solo").clone();
    assert_eq!(ops[0], json!({"op": "remove", "target": "ot2t2t2t2"}));
    assert_eq!(ops[1]["elem"]["tag"], "g", "{ops:?}");
    let gruppo = ops[1]["elem"]["attrs"]["id"]
        .as_str()
        .expect("l'id del gruppo");
    let lettere = ops[2..]
        .iter()
        .filter(|o| o["op"] == "add" && o["parent"] == gruppo && o["elem"]["tag"] == "path")
        .count();
    // «Una riga»: sette lettere con l'inchiostro, lo spazio no.
    assert_eq!(lettere, 7, "{ops:?}");
    assert_eq!(ops.len(), 2 + lettere, "{ops:?}");
}

/// Un comando del motore con Inter su `svg`: il file dopo, applicate le
/// operazioni, e le operazioni.
fn con_inter(
    disegni: &std::sync::Arc<fub_disegno::motore::Disegni>,
    svg: &str,
    id: &str,
    scelti: &[&str],
    valore: serde_json::Value,
) -> (String, serde_json::Value) {
    let (mut disegno, _) = fub_disegno::motore::Disegno::apri_con(disegni, svg).expect("si apre");
    let esito = disegno
        .comando(fub_abi::DrawingCommandRequest {
            revision: disegno.revisione(),
            id: format!("disegno.{id}"),
            selection: scelti.iter().map(|s| s.to_string()).collect(),
            value: valore,
            preview: false,
        })
        .expect("senza errore");
    assert_eq!(esito.refused, None, "{id}: {esito:?}");
    let ops: serde_json::Value =
        serde_json::from_str(&esito.ops.expect("le operazioni")).expect("json");
    let dopo = common::applica::applica(svg, &ops).expect("le operazioni si applicano");
    (dopo, ops)
}

/// L'elemento `<text>` di `id` in `svg`, con le righe.
fn il_testo<'a>(svg: &'a str, id: &str) -> &'a str {
    let da = svg
        .find(&format!("<text id=\"{id}\""))
        .expect("il testo c'è");
    let a = svg[da..].find("</text>").expect("il testo si chiude") + da;
    &svg[da..a]
}

#[test]
fn testo_in_area_va_e_torna() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let base = include_str!("famiglie/testo/base.svg");
    // Converti in testo in area: lo stesso id, `fub:wrap`, le due righe.
    let (area, ops) = con_inter(
        &disegni,
        base,
        "type.convertToAreaType",
        &["ot1t1t1t1"],
        json!({}),
    );
    let ops = &ops[0]["ops"];
    assert_eq!(ops[0], json!({"op": "remove", "target": "ot1t1t1t1"}));
    assert_eq!(ops[1]["elem"]["attrs"]["id"], "ot1t1t1t1", "{ops}");
    let testo = il_testo(&area, "ot1t1t1t1");
    assert!(testo.contains("fub:wrap=\""), "{testo}");
    assert!(
        testo.contains(">Pioggia</tspan><tspan x=\"40\" dy=\"40\">sul mare<"),
        "{testo}"
    );
    // Riaperto, è un testo in area: le maiuscole lo fanno andare a capo nel
    // suo riquadro, con `fub:join` fra le righe dello stesso paragrafo.
    let (grande, _) = con_inter(
        &disegni,
        &area,
        "type.changeCase",
        &["ot1t1t1t1"],
        json!({"case": "upper"}),
    );
    let testo = il_testo(&grande, "ot1t1t1t1");
    assert!(testo.contains("fub:wrap=\""), "{testo}");
    assert!(testo.contains("PIOGGIA"), "{testo}");
    assert!(testo.contains("fub:join=\"space\""), "{testo}");
    // Al centro: `x` è il centro del riquadro.
    let (centro, _) = con_inter(
        &disegni,
        &area,
        "text.setStyle",
        &["ot1t1t1t1"],
        json!({"justify": "center"}),
    );
    let testo = il_testo(&centro, "ot1t1t1t1");
    assert!(testo.contains("text-anchor=\"middle\""), "{testo}");
    assert!(!testo.contains("x=\"40\""), "{testo}");
    // Converti in testo di punto: niente `fub:wrap`, le righe di prima.
    let (punto, _) = con_inter(
        &disegni,
        &area,
        "type.convertToPointType",
        &["ot1t1t1t1"],
        json!({}),
    );
    let testo = il_testo(&punto, "ot1t1t1t1");
    assert!(!testo.contains("fub:wrap"), "{testo}");
    assert!(!testo.contains("fub:join"), "{testo}");
    assert!(testo.contains("sul mare"), "{testo}");
}

#[test]
fn testo_in_area_del_file_si_converte() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let area = include_str!("famiglie/testo/area.svg");
    // Il riquadro largo 200 tiene le righe del file: Converti in testo di
    // punto le scrive una per riga, senza unioni.
    let (punto, _) = con_inter(
        &disegni,
        area,
        "type.convertToPointType",
        &["oz1z1z1z1"],
        json!({}),
    );
    let testo = il_testo(&punto, "oz1z1z1z1");
    assert!(!testo.contains("fub:wrap"), "{testo}");
    assert_eq!(testo.matches("<tspan").count(), 2, "{testo}");
    assert!(testo.contains(">Le onde del mare</tspan>"), "{testo}");
    assert!(testo.contains(">tornano a riva</tspan>"), "{testo}");
    // L'interlinea di un testo in area si scrive nei `dy`.
    let (alto, _) = con_inter(
        &disegni,
        area,
        "text.setRangeStyle",
        &["oz1z1z1z1"],
        json!({"leading": 30}),
    );
    let testo = il_testo(&alto, "oz1z1z1z1");
    assert!(testo.contains("fub:wrap=\"200\""), "{testo}");
    assert!(
        testo.contains("fub:join=\"space\" x=\"40\" dy=\"30\""),
        "{testo}"
    );
}

#[test]
fn lo_strumento_trascinato_crea_un_testo_in_area() {
    // Il Testo trascinato e il Testo in area, come in VectorCraft, fanno lo stesso riquadro.
    for strumento in ["type", "areaType"] {
        trascinato_in_area(strumento);
    }
}

fn trascinato_in_area(strumento: &str) {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let caso = casi
        .iter()
        .find(|c| c.id == strumento && c.gesto.iter().any(|p| p.to_string().contains("\"drag\"")))
        .expect("il caso dello strumento trascinato");
    let (mut disegno, _) =
        fub_disegno::motore::Disegno::apri_con(&disegni, &caso.disegno).expect("si apre");
    let esito = casi::esegui_sul_disegno(&mut disegno, caso)
        .expect("si esegue")
        .expect("senza errore");
    assert_eq!(
        esito.refused, None,
        "{strumento}: con Inter il testo si dispone"
    );
    let ops: serde_json::Value =
        serde_json::from_str(&esito.ops.expect("le operazioni")).expect("json");
    let elem = &ops[0]["elem"];
    assert_eq!(elem["tag"], "text", "{ops}");
    // Il riquadro trascinato da 200 a 360: largo 160, la prima riga sotto il
    // suo bordo alto.
    assert_eq!(elem["attrs"]["fub:wrap"], "160", "{ops}");
    assert_eq!(elem["attrs"]["x"], "200", "{ops}");
    let y: f64 = elem["attrs"]["y"].as_str().unwrap().parse().unwrap();
    assert!(y > 220.0 && y < 260.0, "{ops}");
    let righe = elem["children"].as_array().expect("le righe");
    assert!(righe.len() >= 2, "{ops}");
    assert_eq!(righe[1]["attrs"]["fub:join"], "space", "{ops}");
    let parole: Vec<&str> = righe.iter().map(|r| r["text"].as_str().unwrap()).collect();
    assert_eq!(parole.join(" "), "Onde del mare che tornano", "{ops}");
}

/// Il Testo in area sul contorno di un tracciato chiuso, come in VectorCraft (`text.createInPath`): il
/// rettangolo diventa la cornice del testo, che il file scrive in area largo quanto lui; il
/// triangolo no, perché il testo in area di Fub è un riquadro solo, e Fub rifiuta invece di perderlo.
#[test]
fn il_testo_in_area_sul_contorno_di_un_tracciato() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let clic: Vec<_> = casi
        .iter()
        .filter(|c| {
            c.id == "areaType" && !c.gesto.iter().any(|p| p.to_string().contains("\"drag\""))
        })
        .collect();
    assert_eq!(
        clic.len(),
        2,
        "il clic sul rettangolo e quello sul triangolo"
    );
    let esegui = |caso: &casi::Caso| {
        let (mut disegno, _) =
            fub_disegno::motore::Disegno::apri_con(&disegni, &caso.disegno).expect("si apre");
        casi::esegui_sul_disegno(&mut disegno, caso)
            .expect("si esegue")
            .expect("senza errore")
    };
    let esito = esegui(clic[0]);
    assert_eq!(esito.refused, None, "il rettangolo diventa la cornice");
    let ops: serde_json::Value =
        serde_json::from_str(&esito.ops.expect("le operazioni")).expect("json");
    let passi = ops[0]["ops"]
        .as_array()
        .expect("un passo solo, col rettangolo che se ne va");
    assert_eq!(
        passi[0],
        json!({"op": "remove", "target": "oa1a1a1a1"}),
        "{ops}"
    );
    let elem = &passi[1]["elem"];
    assert_eq!(elem["attrs"]["fub:wrap"], "100", "{ops}");
    assert_eq!(elem["attrs"]["x"], "250", "{ops}");
    let parole: Vec<&str> = elem["children"]
        .as_array()
        .expect("le righe")
        .iter()
        .map(|r| r["text"].as_str().unwrap())
        .collect();
    assert_eq!(parole, ["Onde", "del", "mare"], "{ops}");
    let esito = esegui(clic[1]);
    assert_eq!(
        esito.refused,
        Some(fub_abi::DrawingRefusal::Unsupported),
        "il triangolo: {esito:?}"
    );
}

/// La marionetta sul testo di punto con Inter (K6 T13, giro «marionetta»): i caratteri veri danno la
/// scatola del testo, e uno spillo proposto dal motore sul testo passa. Senza caratteri la scatola è
/// zero e il comando dà `empty` (lo prova il caso di `trasforma.json`, `t-marionetta`, che non c'è più).
#[test]
fn la_marionetta_sul_testo_di_punto_con_inter() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let svg = include_str!("famiglie/trasforma/testo.svg");
    let (mut d, aperto) = fub_disegno::motore::Disegno::apri_con(&disegni, svg).expect("si apre");
    let lettura = d
        .comando(fub_abi::DrawingCommandRequest {
            revision: aperto.revision,
            id: "disegno.object.puppetWarp.pins".into(),
            selection: vec!["ot1t1t1t1".into()],
            value: json!({}),
            preview: false,
        })
        .expect("la lettura risponde");
    let pins = lettura.reading.expect("la lettura c'è")["pins"][0].clone();
    let (x, y) = (pins[0].as_f64().unwrap(), pins[1].as_f64().unwrap());
    let esito = d
        .comando(fub_abi::DrawingCommandRequest {
            revision: aperto.revision,
            id: "disegno.object.puppetWarp".into(),
            selection: vec!["ot1t1t1t1".into()],
            value: json!({ "pins": [[x, y]], "moved": [[x, y + 10.0]] }),
            preview: false,
        })
        .expect("la marionetta risponde");
    assert_eq!(
        esito.refused, None,
        "la marionetta sul testo passa: {esito:?}"
    );
    let ops = esito.ops.expect("e dà operazioni");
    assert!(
        ops.contains("transform"),
        "la trasformazione va sul testo: {ops}"
    );
    assert!(ops.contains("ot1t1t1t1"), "il testo è il bersaglio: {ops}");
}

/// Mentre si scrive un Testo su tracciato, l'anteprima mostra il testo sul
/// tracciato, come VectorCraft: un `<g>` con l'id del tracciato del file, che
/// il motore ha tolto e il client nasconde, la risorsa della sola anteprima
/// col tracciato da seguire e il `<text>` col suo `textPath`. Prima
/// l'anteprima non c'era, e il testo si vedeva solo col rilascio.
#[test]
fn il_testo_su_tracciato_si_vede_mentre_si_scrive() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let mut caso = casi
        .iter()
        .find(|c| c.id == "typeOnPath")
        .expect("il caso del Testo su tracciato")
        .clone();
    // Il clic e le lettere, senza il commit.
    caso.gesto.truncate(2);
    let (mut disegno, _) =
        fub_disegno::motore::Disegno::apri_con(&disegni, &caso.disegno).expect("si apre");
    let esito = casi::esegui_sul_disegno(&mut disegno, &caso)
        .expect("si esegue")
        .expect("senza errore");
    assert_eq!(esito.refused, None);
    let forma = esito
        .preview
        .and_then(|p| p.shape)
        .expect("la forma del testo nell'anteprima");
    assert_eq!(forma["tag"], "g", "{forma}");
    assert_eq!(forma["attrs"]["id"], "op7a7a7a7", "{forma}");
    let risorsa = &forma["children"][0]["children"][0];
    assert_eq!(risorsa["attrs"]["id"], "fub-anteprima-tracciato", "{forma}");
    assert_eq!(
        risorsa["attrs"]["d"], "M50 200 C150 100 250 100 350 200",
        "{forma}"
    );
    let testo = &forma["children"][1];
    assert_eq!(testo["tag"], "text", "{forma}");
    assert_eq!(testo["attrs"]["font-size"], "32", "{forma}");
    let sul = &testo["children"][0];
    assert_eq!(sul["tag"], "textPath", "{forma}");
    assert_eq!(sul["attrs"]["href"], "#fub-anteprima-tracciato", "{forma}");
    assert_eq!(sul["text"], "Onde del mare", "{forma}");
}

/// Il file dopo `ops` si riapre senza perdite: ogni oggetto scritto è del motore.
fn si_riapre(disegni: &std::sync::Arc<fub_disegno::motore::Disegni>, svg: &str) {
    let (_, aperto) = fub_disegno::motore::Disegno::apri_con(disegni, svg).expect("si riapre");
    // Le risorse in `<defs>` (il tracciato privato di un testo su tracciato) non sono oggetti.
    let perse: Vec<_> = aperto
        .losses
        .iter()
        .filter(|p| !p.detail.starts_with("dentro <defs>"))
        .collect();
    assert!(perse.is_empty(), "{perse:?}\n{svg}");
}

/// Testo in area con Inter (Opzioni testo in area, Rimodella area di testo, il comando Testo
/// con un riquadro e Testo in area su una forma): il riquadro nuovo è il `fub:wrap`, le righe
/// vanno a capo nel riquadro, e il file si riapre senza perdite. Senza caratteri gli stessi casi
/// di `testo.json` sono `unsupported`: le righe del file non ridarebbero il testo uguale.
#[test]
fn il_riquadro_del_testo_in_area_cambia() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let area = include_str!("famiglie/testo/area.svg");
    // Opzioni testo in area: la larghezza.
    let (dopo, _) = con_inter(
        &disegni,
        area,
        "text.areaOptions",
        &["oz1z1z1z1"],
        json!({"width": 150}),
    );
    let testo = il_testo(&dopo, "oz1z1z1z1");
    assert!(testo.contains("fub:wrap=\"150\""), "{testo}");
    assert!(testo.contains(">riva</tspan>"), "{testo}");
    si_riapre(&disegni, &dopo);
    // Rimodella area di testo: il lato destro 20 più in là, col testo nominato dall'id.
    let (dopo, _) = con_inter(
        &disegni,
        area,
        "text.reshapeArea",
        &[],
        json!({"id": "oz1z1z1z1", "anchors": [[0, 1], [0, 2]], "dx": 20, "dy": 0}),
    );
    assert!(
        il_testo(&dopo, "oz1z1z1z1").contains("fub:wrap=\"220\""),
        "{dopo}"
    );
    si_riapre(&disegni, &dopo);
    // Un riquadro stretto: le parole vanno a capo.
    let (dopo, _) = con_inter(
        &disegni,
        area,
        "text.areaOptions",
        &["oz1z1z1z1"],
        json!({"width": 80}),
    );
    let testo = il_testo(&dopo, "oz1z1z1z1");
    assert!(testo.matches("<tspan").count() > 2, "{testo}");
    si_riapre(&disegni, &dopo);
}

#[test]
fn il_comando_testo_crea_un_testo_in_area() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let base = include_str!("famiglie/testo/base.svg");
    let (dopo, ops) = con_inter(
        &disegni,
        base,
        "text.create",
        &[],
        json!({"x": 100, "y": 250, "text": "Ciao a tutti", "area": {"width": 120, "height": 40}}),
    );
    let nuovo = &ops[0]["elem"];
    assert_eq!(nuovo["tag"], "text", "{ops}");
    assert_eq!(nuovo["attrs"]["fub:wrap"], "120", "{ops}");
    assert_eq!(nuovo["attrs"]["font-family"], "Inter, sans-serif", "{ops}");
    si_riapre(&disegni, &dopo);
    // Testo in area dentro il rettangolo: il rettangolo diventa il riquadro del testo.
    let forme = include_str!("famiglie/testo/forme.svg");
    let (dopo, _) = con_inter(
        &disegni,
        forme,
        "text.createInPath",
        &[],
        json!({"path": "oa1a1a1a1", "text": "Dentro il riquadro"}),
    );
    assert!(!dopo.contains("id=\"oa1a1a1a1\""), "{dopo}");
    assert!(dopo.contains("fub:wrap=\"160\""), "{dopo}");
    si_riapre(&disegni, &dopo);
}

/// Un testo su tracciato del file: il punto d'inizio, il verso e il tracciato nuovi si scrivono
/// nel `textPath` e nel tracciato privato, e il testo riaperto è ancora del motore, con i valori
/// nuovi (non più solo da spostare).
#[test]
fn il_testo_su_tracciato_si_modifica() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let curva = include_str!("famiglie/testo/typeOnPath-curva.svg");
    si_riapre(&disegni, curva);
    let leggi = |svg: &str| {
        let (mut d, _) = fub_disegno::motore::Disegno::apri_con(&disegni, svg).expect("si apre");
        d.comando(fub_abi::DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.type.pathOptions".into(),
            selection: vec!["ok7thtlvb".into()],
            value: json!({}),
            preview: false,
        })
        .expect("senza errore")
        .reading
        .expect("la lettura")
    };
    let (dopo, _) = con_inter(
        &disegni,
        curva,
        "type.pathOptions",
        &["ok7thtlvb"],
        json!({"start": 0.1}),
    );
    si_riapre(&disegni, &dopo);
    let start = leggi(&dopo)["start"].as_f64().expect("start");
    assert!((start - 0.1).abs() < 1e-3, "{start}");
    // Rimodella tracciato del testo, poi ancora un punto d'inizio sul tracciato nuovo.
    let (dopo, _) = con_inter(
        &disegni,
        &dopo,
        "text.reshapePath",
        &["ok7thtlvb"],
        json!({"anchors": [[0, 1]], "dx": 0, "dy": 30}),
    );
    assert!(
        dopo.contains("d=\"M50 200 C150 100 250 130 350 230\""),
        "{dopo}"
    );
    si_riapre(&disegni, &dopo);
    let start = leggi(&dopo)["start"].as_f64().expect("start");
    assert!((start - 0.1).abs() < 1e-3, "{start}");
    let (dopo, _) = con_inter(
        &disegni,
        &dopo,
        "type.pathOptions",
        &["ok7thtlvb"],
        json!({"start": 0}),
    );
    assert!(!dopo.contains("startOffset"), "{dopo}");
    // Il verso girato: il tracciato va dall'altra parte, e il testo parte ancora dall'inizio.
    let (dopo, _) = con_inter(
        &disegni,
        &dopo,
        "type.pathOptions",
        &["ok7thtlvb"],
        json!({"flip": true}),
    );
    assert!(
        dopo.contains("d=\"M350 230 C250 130 150 100 50 200\""),
        "{dopo}"
    );
    si_riapre(&disegni, &dopo);
}

/// Un testo su tracciato che un altro editor scrive con più del suo `textPath` (un pezzo con un
/// aspetto suo, uno `startOffset` in percento) resta da spostare e basta: il motore lo approssima.
/// (Uno con attributi che la scena non conosce, come `side`, non è nemmeno un oggetto: resta com'è.)
#[test]
fn il_testo_su_tracciato_straniero_resta_approssimato() {
    let disegni = common::disegni_con_inter();
    let curva = include_str!("famiglie/testo/typeOnPath-curva.svg");
    for altro in [
        curva.replace("startOffset=\"172.17\"", "startOffset=\"50%\""),
        curva.replace(
            ">Onde del mare<",
            "><tspan fill=\"red\">Onde</tspan> del mare<",
        ),
    ] {
        let (_, aperto) =
            fub_disegno::motore::Disegno::apri_con(&disegni, &altro).expect("si apre");
        assert!(
            aperto.losses.iter().any(|p| p.element == "ok7thtlvb"),
            "{:?}\n{altro}",
            aperto.losses
        );
    }
}
