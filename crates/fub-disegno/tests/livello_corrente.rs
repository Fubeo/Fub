//! Sposta sul livello corrente (K6 T11): il livello corrente sta nel client, nella sessione del
//! documento, e arriva nel valore del comando (`layer`, l'id di Fub del livello). Il ponte lo toglie
//! prima del motore e mette gli oggetti scelti in cima a quel livello; se il livello non c'è più, o il
//! client non ne manda uno, va nel più alto né nascosto né bloccato. Un livello corrente nascosto o
//! bloccato si rifiuta col suo perché, e niente cambia.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use fub_abi::{DrawingCommandRequest, DrawingRefusal};
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const COMANDO: &str = "disegno.object.arrange.sendToCurrentLayer";

fn disegni() -> Arc<Disegni> {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    disegni
}

fn banco(nome: &str) -> String {
    std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/famiglie/livelli")
            .join(nome),
    )
    .expect("il banco si legge")
}

/// Il comando sugli oggetti `scelti` col valore `valore`: il file dopo, o il rifiuto.
fn sposta(
    disegni: &Arc<Disegni>,
    svg: &str,
    scelti: &[&str],
    valore: Value,
) -> Result<String, DrawingRefusal> {
    let (mut d, aperto) = Disegno::apri_con(disegni, svg).expect("si apre");
    let esito = d
        .comando(DrawingCommandRequest {
            revision: aperto.revision,
            id: COMANDO.into(),
            selection: scelti.iter().map(|s| s.to_string()).collect(),
            value: valore,
            preview: false,
        })
        .expect("il comando risponde");
    if let Some(rifiuto) = esito.refused {
        assert!(esito.ops.is_none(), "un rifiuto non scrive niente");
        return Err(rifiuto);
    }
    let ops: Value =
        serde_json::from_str(&esito.ops.expect("il comando dà operazioni")).expect("json");
    Ok(common::applica::applica(svg, &ops).expect("le operazioni si applicano"))
}

/// L'id del livello che contiene l'oggetto `id` nel file, e se è l'ultimo figlio di quel livello
/// (in cima). `None` se sta fuori dai livelli.
fn livello_di(svg: &str, id: &str) -> Option<(String, bool)> {
    let dove = svg.find(&format!("id=\"{id}\""))?;
    let prima = &svg[..dove];
    let apre = prima.rfind("<g ")?;
    if prima[apre..].contains("</g>") {
        return None;
    }
    let tag = &svg[apre..apre + svg[apre..].find('>')?];
    if !tag.contains("fub:layer=") {
        return None;
    }
    let livello = tag.split("id=\"").nth(1)?.split('"').next()?.to_string();
    let chiude = dove + svg[dove..].find("</g>")?;
    let in_cima = !svg[dove..chiude].contains('<');
    Some((livello, in_cima))
}

/// Il file riaperto non ha perdite in più dell'originale, e Annulla e Ripeti (il testo di prima e
/// quello di dopo, come li manda l'editor) tornano al byte.
fn riapre_e_annulla(disegni: &Arc<Disegni>, prima: &str, dopo: &str) {
    let (_, aperto_prima) = Disegno::apri_con(disegni, prima).expect("l'originale si apre");
    let (_, aperto) = Disegno::apri_con(disegni, dopo).expect("il file dopo si apre");
    assert!(
        aperto.losses.len() <= aperto_prima.losses.len(),
        "nessuna perdita in più: {:?}",
        aperto.losses
    );
    let (mut d, _) = Disegno::apri_con(disegni, prima).expect("si apre");
    for testo in [dopo, prima, dopo] {
        d.sincronizza(fub_abi::DrawingSync {
            revision: d.revisione() + 1,
            change: fub_abi::DrawingChange::Text {
                text: testo.to_string(),
            },
        })
        .expect("il testo passa");
        assert!(d.aspetta_il_reimport(std::time::Duration::from_secs(30)));
        assert_eq!(d.testo(), testo, "Annulla e Ripeti al byte");
    }
}

#[test]
fn sposta_gli_oggetti_scelti_in_cima_al_livello_corrente() {
    let disegni = disegni();
    let svg = banco("tre-livelli.svg");
    // Dal livello 3 al livello 1, e dal 2 al 1 insieme.
    let dopo = sposta(
        &disegni,
        &svg,
        &["oc3c3c3c3"],
        json!({ "layer": "l1a2b3c4d" }),
    )
    .expect("si sposta");
    assert_eq!(
        livello_di(&dopo, "oc3c3c3c3"),
        Some(("l1a2b3c4d".into(), true)),
        "{dopo}"
    );
    assert_eq!(
        livello_di(&dopo, "oa1a1a1a1").map(|l| l.0),
        Some("l1a2b3c4d".into())
    );
    riapre_e_annulla(&disegni, &svg, &dopo);
    let due = sposta(
        &disegni,
        &svg,
        &["ob2b2b2b2", "oc3c3c3c3"],
        json!({ "layer": "l1a2b3c4d" }),
    )
    .expect("si spostano");
    for id in ["ob2b2b2b2", "oc3c3c3c3"] {
        assert_eq!(
            livello_di(&due, id).map(|l| l.0),
            Some("l1a2b3c4d".into()),
            "{id}: {due}"
        );
    }
    riapre_e_annulla(&disegni, &svg, &due);
}

#[test]
fn senza_livello_o_con_un_livello_sparito_va_nel_piu_alto_libero() {
    let disegni = disegni();
    let svg = banco("tre-livelli.svg");
    // Il client non ne ha uno con un id; o il livello scelto è stato cancellato da un altro riquadro.
    for valore in [json!({}), json!({ "layer": "lzzzzzzzz" }), Value::Null] {
        let dopo = sposta(&disegni, &svg, &["oa1a1a1a1"], valore.clone()).expect("si sposta");
        assert_eq!(
            livello_di(&dopo, "oa1a1a1a1").map(|l| l.0),
            Some("l3c3c3c3c".into()),
            "{valore}: {dopo}"
        );
    }
    // Il più alto è bloccato o nascosto: si salta.
    let misto = banco("tre-livelli-uno-bloccato-uno-nascosto.svg");
    let fermo = sposta(
        &disegni,
        &misto,
        &["oc3c3c3c3"],
        json!({ "layer": "lzzzzzzzz" }),
    );
    assert!(
        matches!(fermo, Err(DrawingRefusal::Empty)) || fermo.as_ref().is_ok_and(|s| s == &misto),
        "già in cima al livello 3: {fermo:?}"
    );
}

#[test]
fn livello_corrente_bloccato_o_nascosto_si_rifiuta() {
    let disegni = disegni();
    let svg = banco("tre-livelli-uno-bloccato-uno-nascosto.svg");
    assert_eq!(
        sposta(
            &disegni,
            &svg,
            &["oc3c3c3c3"],
            json!({ "layer": "l1a2b3c4d" })
        ),
        Err(DrawingRefusal::Locked)
    );
    assert_eq!(
        sposta(
            &disegni,
            &svg,
            &["oc3c3c3c3"],
            json!({ "layer": "l2b2b2b2b" })
        ),
        Err(DrawingRefusal::Hidden)
    );
}

#[test]
fn un_livello_che_non_e_testo_e_un_errore_degli_argomenti() {
    let disegni = disegni();
    let svg = banco("tre-livelli.svg");
    let (mut d, aperto) = Disegno::apri_con(&disegni, &svg).expect("si apre");
    let errore = d.comando(DrawingCommandRequest {
        revision: aperto.revision,
        id: COMANDO.into(),
        selection: vec!["oa1a1a1a1".into()],
        value: json!({ "layer": 3 }),
        preview: false,
    });
    assert!(
        matches!(errore, Err(fub_abi::PluginError::BadArgs(_))),
        "{errore:?}"
    );
}

#[test]
fn un_disegno_senza_livelli_porta_gli_oggetti_in_cima_alla_radice() {
    let disegni = disegni();
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"oa1a1a1a1\" x=\"10\" y=\"10\" width=\"50\" height=\"50\" fill=\"#ff0000\"/>\n  <rect id=\"ob2b2b2b2\" x=\"40\" y=\"40\" width=\"50\" height=\"50\" fill=\"#0000ff\"/>\n</svg>\n";
    let dopo = sposta(&disegni, svg, &["oa1a1a1a1"], json!({}));
    match dopo {
        Ok(dopo) => {
            let a = dopo.find("oa1a1a1a1").expect("c'è ancora");
            let b = dopo.find("ob2b2b2b2").expect("c'è ancora");
            assert!(a > b, "il rosso va in cima: {dopo}");
            riapre_e_annulla(&disegni, svg, &dopo);
        }
        Err(r) => panic!("un disegno senza livelli si sposta in cima alla radice: {r:?}"),
    }
}
