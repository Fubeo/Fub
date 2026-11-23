//! La carta fuori dal motore (K6, livelli e carta): un disegno di Fub con la carta e i suoi
//! livelli apre i livelli come livelli del motore, e ogni passo («salva e riapri», Annulla e
//! Ripeti) lascia la carta prima di tutto, i livelli com'erano e nessuna perdita.
//!
//! Ogni scenario applica al testo le operazioni del motore (`common::applica`, come il client),
//! riapre il file scritto, poi rimette nel motore il testo di prima e quello di dopo (Annulla e
//! Ripeti del client sono testo) e controlla che la copia li tenga al byte.

#![cfg(feature = "completo")]

mod common;

use std::time::Duration;

use fub_abi::{DrawingChange, DrawingCommandRequest, DrawingGesture, DrawingSync};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const A4: &str = include_str!("../../fub-features/templates/a4-landscape.en.svg");
const DOPPIO: &str = include_str!("famiglie/livelli/doppio.svg");
const SENZA_CARTA: &str = include_str!("famiglie/livelli/senza-carta.svg");
const ESTRANEO: &str = include_str!("famiglie/livelli/estraneo.svg");
const TRE_DUE_FERMI: &str =
    include_str!("famiglie/livelli/tre-livelli-uno-bloccato-uno-nascosto.svg");

/// Apre un testo con tutte le righe accese, come le prove delle famiglie.
fn apri(testo: &str) -> (Disegno, fub_abi::DrawingOpen) {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    Disegno::apri_con(&disegni, testo).expect("il disegno si apre")
}

fn comando(d: &mut Disegno, id: &str, selezione: &[&str], valore: Value) -> Value {
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: format!("disegno.{id}"),
            selection: selezione.iter().map(|s| s.to_string()).collect(),
            value: valore,
            preview: false,
        })
        .unwrap_or_else(|e| panic!("{id}: {e:?}"));
    assert_eq!(esito.refused, None, "{id} rifiutato");
    serde_json::from_str(esito.ops.as_deref().expect("il comando dà operazioni"))
        .expect("le operazioni sono JSON")
}

/// Un rettangolo tirato con lo strumento di Fub, sul livello corrente (nessuno scelto).
fn rettangolo(d: &mut Disegno, x: f64, y: f64) -> Value {
    let evento = |kind: &str, x: f64, y: f64| json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false });
    let gesto: DrawingGesture = serde_json::from_value(json!({
        "tool": "rect",
        "layer": null,
        "selection": [],
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#000000", "width": 2, "fill": null },
        "events": [evento("down", x, y), evento("drag", x + 40.0, y + 30.0), evento("up", x + 40.0, y + 30.0)],
    }))
    .expect("il gesto si legge");
    let esito = d.gesto(gesto).expect("il gesto");
    assert_eq!(esito.refused, None, "il rettangolo è rifiutato");
    common::ops_di(&esito)
}

/// I figli della radice: (id, è un livello di Fub).
fn radice(testo: &str) -> Vec<(String, bool)> {
    common::applica::elementi(testo)
        .expect("il testo si legge")
        .into_iter()
        .filter(|e| e.path.len() == 1)
        .map(|e| (e.id.unwrap_or_default(), e.layer.is_some()))
        .collect()
}

fn livelli(testo: &str) -> Vec<String> {
    radice(testo)
        .into_iter()
        .filter(|(_, livello)| *livello)
        .map(|(id, _)| id)
        .collect()
}

/// Il passo intero: le operazioni sul testo, il file riaperto senza perdite e con la carta
/// dov'era, poi Annulla e Ripeti come testo nel motore. Dà il testo scritto.
fn passo(d: &mut Disegno, prima: &str, ops: &Value) -> String {
    assert!(!ops.is_null(), "il passo dà operazioni");
    let dopo = common::applica::applica(prima, ops).expect("le operazioni si applicano al testo");
    assert_ne!(dopo, prima, "il passo cambia il testo");
    // La carta resta il primo figlio della radice, se c'era.
    let carta_prima = radice(prima).first().map(|(id, _)| id == "fub-paper");
    let carta_dopo = radice(&dopo).first().map(|(id, _)| id == "fub-paper");
    assert_eq!(carta_prima, carta_dopo, "la carta resta dov'era:\n{dopo}");
    // Salva e riapri.
    let (riaperto, aperto) = apri(&dopo);
    assert!(
        aperto.losses.is_empty(),
        "perdite alla riapertura: {:?}\n{dopo}",
        aperto.losses
    );
    assert_eq!(aperto.unmapped, 0, "tutto resta modificabile:\n{dopo}");
    assert_eq!(riaperto.testo(), dopo);
    // Annulla e Ripeti: il client rimette il testo, il motore lo tiene al byte.
    for testo in [prima, &dopo[..]] {
        d.sincronizza(DrawingSync {
            revision: d.revisione() + 1,
            change: DrawingChange::Text {
                text: testo.to_string(),
            },
        })
        .expect("il testo passa");
        assert!(d.aspetta_il_reimport(Duration::from_secs(30)));
        assert_eq!(d.testo(), testo, "Annulla e Ripeti al byte");
    }
    dopo
}

/// Disegno nuovo (carta e un livello vuoto): il primo oggetto va nel livello, nessun livello nuovo,
/// e anche il secondo dopo la riapertura.
#[test]
fn il_disegno_nuovo_tiene_il_suo_livello_al_primo_oggetto() {
    let (mut d, aperto) = apri(A4);
    assert!(aperto.losses.is_empty(), "{:?}", aperto.losses);
    let ops = rettangolo(&mut d, 100.0, 100.0);
    assert_eq!(ops[0]["op"], "add", "{ops}");
    assert_eq!(
        ops[0]["parent"], "llivello1",
        "il primo oggetto va nel livello: {ops}"
    );
    let uno = passo(&mut d, A4, &ops);
    assert_eq!(livelli(&uno), ["llivello1"], "la struttura non cambia");
    let (mut d, _) = apri(&uno);
    let ops = rettangolo(&mut d, 300.0, 300.0);
    assert_eq!(ops[0]["parent"], "llivello1", "{ops}");
    let due = passo(&mut d, &uno, &ops);
    assert_eq!(livelli(&due), ["llivello1"]);
    let oggetti = common::applica::elementi(&due)
        .expect("il testo si legge")
        .into_iter()
        .filter(|e| e.path.len() == 2 && e.tag == "rect")
        .count();
    assert_eq!(oggetti, 2, "due rettangoli nel livello: {due}");
}

/// Disegno senza carta: i livelli sono livelli, il rettangolo va nel primo.
#[test]
fn il_disegno_senza_carta_disegna_nei_suoi_livelli() {
    let (mut d, aperto) = apri(SENZA_CARTA);
    assert!(aperto.losses.is_empty(), "{:?}", aperto.losses);
    let ops = rettangolo(&mut d, 20.0, 20.0);
    let parent = ops[0]["parent"].as_str().unwrap_or_default().to_string();
    assert!(
        parent.starts_with('l') && parent != "#root",
        "va in un livello: {ops}"
    );
    let dopo = passo(&mut d, SENZA_CARTA, &ops);
    assert_eq!(livelli(&dopo), ["l1a2b3c4d", "l2b2b2b2b"]);
}

/// Carta e oggetti estranei alla radice: la carta resta nel motore e nel file, come prima.
#[test]
fn con_un_oggetto_alla_radice_la_carta_resta() {
    const CON_CARTA: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"og1g1g1g1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#ff0000\"/>\n  </g>\n</svg>\n";
    for testo in [CON_CARTA, ESTRANEO] {
        let (mut d, aperto) = apri(testo);
        assert!(aperto.losses.is_empty(), "{:?}", aperto.losses);
        let ops = rettangolo(&mut d, 300.0, 200.0);
        let dopo = passo(&mut d, testo, &ops);
        assert_eq!(
            radice(&dopo).first(),
            radice(testo).first(),
            "il primo figlio resta quello di prima"
        );
        if testo == CON_CARTA {
            assert!(
                dopo.contains("<rect id=\"fub-paper\""),
                "la carta resta nel file"
            );
        }
    }
}

/// Tre livelli, uno bloccato e uno nascosto: Nascondi altri, poi Mostra tutti e Sblocca tutti.
#[test]
fn tre_livelli_fermi_si_nascondono_e_si_mostrano() {
    let (mut d, _) = apri(TRE_DUE_FERMI);
    let ops = comando(&mut d, "layer.hideOthers", &["oc3c3c3c3"], json!({}));
    let nascosti = passo(&mut d, TRE_DUE_FERMI, &ops);
    assert_eq!(livelli(&nascosti), ["l1a2b3c4d", "l2b2b2b2b", "l3c3c3c3c"]);
    let ops = comando(&mut d, "layer.showAll", &[], json!({}));
    let mostrati = passo(&mut d, &nascosti, &ops);
    assert!(!mostrati.contains("display=\"none\""), "{mostrati}");
    let ops = comando(&mut d, "layer.unlockAll", &[], json!({}));
    let liberi = passo(&mut d, &mostrati, &ops);
    assert!(!liberi.contains("fub:locked"), "{liberi}");
}

/// Un livello in fondo: va subito dopo la carta, che resta prima; e rovesciato di nuovo torna.
#[test]
fn il_livello_in_fondo_va_dopo_la_carta() {
    let (mut d, _) = apri(DOPPIO);
    let ops = comando(&mut d, "layer.reverse", &[], json!({ "ids": [3, 5] }));
    assert_eq!(ops[0]["pos"], json!({ "after": "fub-paper" }), "{ops}");
    let rovescio = passo(&mut d, DOPPIO, &ops);
    assert_eq!(livelli(&rovescio), ["l2b2b2b2b", "l1a2b3c4d"]);
    let (mut d, _) = apri(&rovescio);
    let ops = comando(&mut d, "layer.reverse", &[], json!({ "ids": [3, 5] }));
    let di_nuovo = passo(&mut d, &rovescio, &ops);
    assert_eq!(livelli(&di_nuovo), ["l1a2b3c4d", "l2b2b2b2b"]);
}

/// Un livello nuovo sotto l'ultimo (il primo dal basso): sopra la carta, mai sotto.
#[test]
fn il_livello_nuovo_sotto_resta_sopra_la_carta() {
    let (mut d, _) = apri(DOPPIO);
    let ops = comando(&mut d, "layer.new", &[], json!({ "below": true }));
    let dopo = passo(&mut d, DOPPIO, &ops);
    let livelli = livelli(&dopo);
    assert_eq!(livelli.len(), 3, "{dopo}");
    assert_eq!(livelli[0], "l1a2b3c4d", "{dopo}");
    assert_eq!(radice(&dopo)[0].0, "fub-paper");
}
