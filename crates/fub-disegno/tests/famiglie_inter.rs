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
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let caso = casi
        .iter()
        .find(|c| c.id == "type" && c.gesto.iter().any(|p| p.to_string().contains("\"drag\"")))
        .expect("il caso dello strumento trascinato");
    let (mut disegno, _) =
        fub_disegno::motore::Disegno::apri_con(&disegni, &caso.disegno).expect("si apre");
    let esito = casi::esegui_sul_disegno(&mut disegno, caso)
        .expect("si esegue")
        .expect("senza errore");
    assert_eq!(esito.refused, None, "con Inter il testo si dispone");
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
