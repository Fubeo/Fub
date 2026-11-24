//! Lo strumento Larghezza di VectorCraft (`width`, `distort/width.rs`): si
//! trascina dal contorno di una linea per allargarla o stringerla in un
//! punto, e il profilo dello spessore va nel file come linea a spessore
//! variabile del formato (`fub:shape="width"`, `profilo::motore`).

#![cfg(feature = "completo")]

mod common;

use std::time::Duration;

use fub_abi::{DrawingChange, DrawingGesture, DrawingOutcome, DrawingSync, DrawingToolState};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/pennelli/spessore.svg");
const STRUMENTO: &str = "width";

fn apri(testo: &str) -> (Disegno, usize) {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (d, aperto) = Disegno::apri_con(&disegni, testo).expect("il disegno si apre");
    (d, aperto.losses.len())
}

fn evento(kind: &str, x: f64, y: f64, alt: bool) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": alt, "cmd": false })
}

fn tasto(key: &str) -> Value {
    json!({ "kind": "key", "key": key, "code": key, "pressed": true })
}

fn gesto(d: &mut Disegno, phase: &str, eventi: Vec<Value>, ingressi: Vec<Value>) -> DrawingOutcome {
    let g: DrawingGesture = serde_json::from_value(json!({
        "phase": phase,
        "tool": { "engine": { "id": STRUMENTO } },
        "layer": null,
        "selection": [],
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#000000", "width": 2, "fill": null },
        "events": eventi,
        "inputs": ingressi,
    }))
    .expect("il gesto si legge");
    let esito = d.gesto(g).expect("il gesto");
    assert_eq!(esito.refused, None, "{esito:?}");
    esito
}

/// Trascina da `da` a `a` (con Alt se `alt`): il file dopo, applicato a `testo`.
fn trascina(d: &mut Disegno, testo: &str, da: (f64, f64), a: (f64, f64), alt: bool) -> String {
    gesto(
        d,
        "preview",
        vec![
            evento("down", da.0, da.1, alt),
            evento("drag", a.0, a.1, alt),
        ],
        vec![],
    );
    let esito = gesto(d, "commit", vec![evento("up", a.0, a.1, alt)], vec![]);
    scritto(testo, &esito)
}

fn scritto(testo: &str, esito: &DrawingOutcome) -> String {
    let ops: Value =
        serde_json::from_str(esito.ops.as_deref().expect("le operazioni")).expect("JSON");
    common::applica::applica(testo, &ops).expect("le operazioni si applicano")
}

/// Il `d` del contorno pieno della linea nel file.
fn contorno(testo: &str) -> &str {
    let id = testo.find(r#"id="oc3c3c3c3""#).expect("la linea c'è");
    let da = testo[..id].rfind('<').expect("il suo tag");
    assert!(
        testo[da..].starts_with("<path") && testo[da..id].contains(r#"fub:shape="width""#),
        "la linea è una linea a spessore variabile: {}",
        &testo[da..]
    );
    let d = testo[da..].find(" d=\"").expect("il contorno") + da + 4;
    let fine = testo[d..].find('"').expect("la fine del d") + d;
    &testo[d..fine]
}

#[test]
fn un_trascinamento_dal_contorno_allarga_la_linea_in_quel_punto() {
    let (mut d, _) = apri(BASE);
    // Da un quarto della linea (x = 150) giù fino a 20 dal centro: là la
    // linea è larga 40, ai capi resta 10.
    let dopo = trascina(&mut d, BASE, (150.0, 201.0), (150.0, 220.0), false);
    assert!(!dopo.contains("vectorcraft:recipe"), "{dopo}");
    let c = contorno(&dopo);
    assert!(c.contains("150 180") && c.contains("150 220"), "{c}");
    assert!(c.contains("100 195") && c.contains("100 205"), "{c}");
    // La linea resta dov'era, sotto il triangolo.
    assert!(dopo.find("oc3c3c3c3") < dopo.find("op7a7a7a7"), "{dopo}");
    // Riaperto, il profilo è ancora del motore: un altro punto si aggiunge.
    let (mut d, perdite) = apri(&dopo);
    assert_eq!(perdite, 0, "il profilo si riapre intero");
    let ancora = trascina(&mut d, &dopo, (250.0, 201.0), (250.0, 210.0), false);
    let c = contorno(&ancora);
    assert!(c.contains("150 180") && c.contains("250 210"), "{c}");
}

/// Un disegno aperto che segue il suo testo come l'editor: ogni commit si
/// applica, va al disegno come revisione nuova, e il gesto dopo parte da lì
/// (il ponte rimette a capo lo strumento a ogni revisione).
struct Prova {
    d: Disegno,
    testo: String,
    rev: u64,
}

impl Prova {
    fn nuova(testo: &str) -> Prova {
        let (d, _) = apri(testo);
        Prova {
            d,
            testo: testo.to_string(),
            rev: 0,
        }
    }

    /// Un pezzo di gesto alla revisione di adesso, con Maiusc su ogni evento se `shift`.
    fn gesto(
        &mut self,
        phase: &str,
        mut eventi: Vec<Value>,
        ingressi: Vec<Value>,
        shift: bool,
    ) -> DrawingOutcome {
        for e in &mut eventi {
            e["shift"] = json!(shift);
        }
        let g: DrawingGesture = serde_json::from_value(json!({
            "revision": self.rev.to_string(),
            "phase": phase,
            "tool": { "engine": { "id": STRUMENTO } },
            "layer": null,
            "selection": [],
            "zoom": 1,
            "snap": { "grid": null, "free": false },
            "style": { "stroke": "#000000", "width": 2, "fill": null },
            "events": eventi,
            "inputs": ingressi,
        }))
        .expect("il gesto si legge");
        self.d.gesto(g).expect("il gesto")
    }

    /// Il commit `esito` nel testo, e il testo nuovo al disegno.
    fn applica(&mut self, esito: &DrawingOutcome) {
        assert_eq!(esito.refused, None, "{esito:?}");
        self.testo = scritto(&self.testo, esito);
        self.rev += 1;
        let sync = DrawingSync {
            revision: self.rev,
            change: DrawingChange::Text {
                text: self.testo.clone(),
            },
        };
        self.d.sincronizza(sync).expect("il sync passa");
        assert!(
            self.d.aspetta_il_reimport(Duration::from_secs(30)),
            "il reimport finisce"
        );
    }

    fn trascina(
        &mut self,
        da: (f64, f64),
        a: (f64, f64),
        alt: bool,
        shift: bool,
    ) -> DrawingOutcome {
        let e = self.gesto(
            "preview",
            vec![
                evento("down", da.0, da.1, alt),
                evento("drag", a.0, a.1, alt),
            ],
            vec![],
            shift,
        );
        assert_eq!(e.refused, None, "{e:?}");
        let esito = self.gesto("commit", vec![evento("up", a.0, a.1, alt)], vec![], shift);
        self.applica(&esito);
        esito
    }

    /// Un clic fermo in `p`, con Maiusc se `shift`: lo stato dello strumento dopo.
    fn clic(&mut self, p: (f64, f64), shift: bool) -> DrawingToolState {
        let e = self.gesto(
            "preview",
            vec![evento("down", p.0, p.1, false)],
            vec![],
            shift,
        );
        assert_eq!(e.refused, None, "{e:?}");
        let esito = self.gesto("commit", vec![evento("up", p.0, p.1, false)], vec![], shift);
        let stato = esito.state.clone().expect("lo stato");
        if esito.refused.is_none() {
            self.applica(&esito);
        }
        stato
    }

    /// Il tasto `key` allo strumento, in un gesto senza puntatore.
    fn tasto(&mut self, key: &str) -> DrawingOutcome {
        self.gesto("commit", vec![], vec![tasto(key)], false)
    }
}

#[test]
fn con_alt_si_allarga_un_lato_solo_e_canc_toglie_il_punto() {
    let mut p = Prova::nuova(BASE);
    p.trascina((200.0, 201.0), (200.0, 220.0), false, false);
    // Alt sul capo di sopra della maniglia (200, 180): sale solo quel lato.
    let alt = p.trascina((200.0, 180.0), (200.0, 170.0), true, false);
    let c = contorno(&p.testo).to_string();
    assert!(c.contains("200 170") && c.contains("200 220"), "{c}");
    // Il punto resta scelto anche alla revisione nuova: lo strumento prende Canc,
    // Backspace ed Esc prima delle scorciatoie.
    let stato = alt.state.expect("lo stato");
    assert_eq!(stato.claims_keys, ["Delete", "Backspace", "Escape"]);
    // Canc lo toglie e la linea torna larga 10.
    let esito = p.tasto("Delete");
    assert!(
        esito
            .state
            .as_ref()
            .is_some_and(|s| s.claims_keys.is_empty()),
        "{esito:?}"
    );
    p.applica(&esito);
    let c = contorno(&p.testo);
    assert!(!c.contains("200 170") && !c.contains("200 220"), "{c}");
}

#[test]
fn con_maiusc_si_scelgono_piu_punti_e_canc_li_toglie_insieme() {
    let mut p = Prova::nuova(BASE);
    p.trascina((150.0, 201.0), (150.0, 220.0), false, false);
    p.trascina((250.0, 201.0), (250.0, 210.0), false, false);
    // Scelto l'ultimo; Maiusc e un clic sul centro del primo lo aggiunge.
    let stato = p.clic((150.0, 200.0), true);
    assert!(
        stato.claims_keys.contains(&"Delete".to_string()),
        "{stato:?}"
    );
    let esito = p.tasto("Backspace");
    p.applica(&esito);
    let c = contorno(&p.testo);
    assert!(
        !c.contains("150 180") && !c.contains("250 210"),
        "via tutti e due: {c}"
    );
}

#[test]
fn esc_toglie_la_scelta_e_canc_poi_non_tocca_la_linea() {
    let mut p = Prova::nuova(BASE);
    p.trascina((200.0, 201.0), (200.0, 220.0), false, false);
    let esito = p.tasto("Escape");
    assert!(esito.ops.is_none(), "Esc non scrive: {esito:?}");
    assert!(
        esito
            .state
            .as_ref()
            .is_some_and(|s| s.claims_keys.is_empty()),
        "{esito:?}"
    );
    // Senza punti scelti lo strumento non prende Canc, e niente cambia.
    let esito = p.tasto("Delete");
    assert!(esito.ops.is_none(), "{esito:?}");
    assert!(contorno(&p.testo).contains("200 220"));
}
