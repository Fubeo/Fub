//! Le forme composte e Espandi forma (piano K6, T13; la famiglia `forme`,
//! `src/famiglie/forme.rs`).
//!
//! Una forma composta nasce dagli oggetti scelti, si salva come un elemento
//! solo (un `g` col disegno espanso e la ricetta, `src/ricetta.rs`) e si
//! riapre composta, coi metodi dei suoi membri: Metodo forma la cambia,
//! Rilascia rimette i membri, Espandi lascia il tracciato del disegno. Ogni
//! comando è un passo solo (un `batch`), e ciò che non si può fare è spento
//! col perché e rifiutato senza cambiare niente.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::applica::applica;
use common::{disegni, ops_di};
use fub_abi::{DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome, DrawingRefusal};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use fub_scene::{Item, Role};
use serde_json::{json, Value};
use vectorcraft_doc::{Node, NodeKind, ShapeMode};

const COMPOSTE: &str = include_str!("famiglie/forme/composte.svg");

/// I due quadrati che si sovrappongono: `oa1a1a1a1` sotto, `ob2b2b2b2` sopra.
const SOTTO: &str = "oa1a1a1a1";
/// Un rettangolo arrotondato del Completo, con la sua ricetta.
const ARROTONDATO: &str = include_str!("famiglie/forme/roundedrectangle-4.svg");
const VIVO: &str = "oeopq71hl";
const SOPRA: &str = "ob2b2b2b2";

/// Un motore con tutte le righe accese: le prove non dipendono dallo stato
/// della mappa.
fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, aperto) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    assert!(
        aperto.losses.is_empty(),
        "perdite all'apertura: {:?}",
        aperto.losses
    );
    d
}

fn comando(d: &mut Disegno, id: &str, scelti: &[&str], valore: Value) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: scelti.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    })
    .expect("il comando gira")
}

/// Il perché di una voce spenta, `None` se è accesa.
fn spenta(d: &Disegno, id: &str, scelti: &[&str]) -> Option<DrawingDisabledReason> {
    let scelti: Vec<String> = scelti.iter().map(|s| s.to_string()).collect();
    let info = d
        .comandi(&scelti)
        .into_iter()
        .find(|c| c.id == format!("disegno.{id}"))
        .unwrap_or_else(|| panic!("manca la voce {id}"));
    assert_eq!(
        info.enabled,
        info.disabled_reason.is_none(),
        "{id}: {info:?}"
    );
    info.disabled_reason
}

/// Le operazioni di un esito, che devono essere un passo solo: un `batch`.
fn un_passo(esito: &DrawingOutcome) -> Value {
    assert!(esito.refused.is_none(), "rifiutato: {esito:?}");
    let ops = ops_di(esito);
    let elenco = ops.as_array().expect("ops in un elenco");
    assert_eq!(elenco.len(), 1, "più di un passo: {ops}");
    assert_eq!(elenco[0]["op"], "batch", "non è un passo solo: {ops}");
    ops
}

/// Gli oggetti aggiunti da un passo, come (tag, id): un `elem` o un
/// frammento `raw` (un oggetto con la ricetta). La `metadata` con le ricette
/// non è un oggetto.
fn aggiunte(ops: &Value) -> Vec<(String, String)> {
    ops[0]["ops"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["op"] == "add")
        .filter_map(|o| match (o["elem"].as_object(), o["raw"].as_str()) {
            (Some(e), _) => Some((
                e["tag"].as_str()?.to_string(),
                e["attrs"]["id"].as_str()?.to_string(),
            )),
            (None, Some(raw)) if !raw.starts_with("<metadata") => {
                let tag = raw[1..]
                    .split(|c: char| c.is_whitespace() || c == '>' || c == '/')
                    .next()?;
                let id = raw.split("id=\"").nth(1)?.split('"').next()?;
                Some((tag.to_string(), id.to_string()))
            }
            _ => None,
        })
        .collect()
}

/// Gli id tolti da un passo.
fn tolti(ops: &Value) -> Vec<&str> {
    ops[0]["ops"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["op"] == "remove")
        .filter_map(|o| o["target"].as_str())
        .collect()
}

/// L'elemento del file con `id`, come lo legge il Semplice.
fn ruolo_nel_semplice(testo: &str, id: &str) -> Role {
    let scena = fub_scene::read(testo).expect("il file si legge");
    scena
        .items
        .iter()
        .find_map(|i| match i {
            Item::Element(e) if e.id.as_deref() == Some(id) => Some(e.role),
            _ => None,
        })
        .unwrap_or_else(|| panic!("il Semplice non vede {id}"))
}

/// I metodi dei membri della forma composta `id` nel motore, dopo
/// l'apertura; `None` se `id` non è una forma composta.
fn metodi(d: &mut Disegno, id: &str) -> Option<Vec<ShapeMode>> {
    leggi(d, id, |n| {
        n.is_compound_shape().then(|| {
            n.children()
                .unwrap()
                .iter()
                .map(|c| c.extras().shape_mode)
                .collect()
        })
    })
}

/// Vero se l'oggetto `id` del file, nel motore, è una forma dal vivo.
fn dal_vivo(d: &mut Disegno, id: &str) -> bool {
    leggi(d, id, |n| {
        matches!(&n.kind, NodeKind::Path { live: Some(_), .. })
    })
}

/// `leggi` dell'oggetto `id` del file, com'è nel motore, senza cambiare
/// niente.
fn leggi<T: Default>(d: &mut Disegno, id: &str, leggi: impl FnOnce(&Node) -> T) -> T {
    let mut fuori = T::default();
    let testo = d.testo().to_string();
    let scena = fub_scene::read(&testo).expect("il file si legge");
    let percorso = scena
        .items
        .iter()
        .find_map(|i| match i {
            Item::Element(e) if e.id.as_deref() == Some(id) => Some(e.path.clone()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("manca {id}"));
    let mut leggi = Some(leggi);
    let esito = d
        .a_mano(|doc, trova| {
            if let (Some(nodo), Some(leggi)) =
                (trova(&percorso).and_then(|n| doc.node(n)), leggi.take())
            {
                fuori = leggi(nodo);
            }
        })
        .expect("il motore si legge");
    assert!(
        esito.ops.is_none(),
        "leggere non cambia niente: {:?}",
        esito.ops
    );
    fuori
}

/// Crea la forma composta dei due quadrati con `metodo`: il passo e il file
/// dopo, con l'id della composta.
fn crea(ds: &Arc<Disegni>, metodo: &str) -> (Value, String, String) {
    let mut d = apri(ds, COMPOSTE);
    let esito = comando(
        &mut d,
        "object.compoundShape.make",
        &[SOTTO, SOPRA],
        json!({ "mode": metodo }),
    );
    let ops = un_passo(&esito);
    let dopo = applica(COMPOSTE, &ops).expect("le operazioni si applicano");
    assert_eq!(
        esito.selection.len(),
        1,
        "la composta resta scelta: {:?}",
        esito.selection
    );
    (ops, dopo, esito.selection[0].clone())
}

#[test]
fn crea_una_forma_composta_che_si_salva_e_si_riapre_uguale() {
    let ds = motore();
    let (ops, dopo, id) = crea(&ds, "subtract");
    // I due quadrati escono dal file ed entra un elemento solo, un gruppo.
    assert_eq!(tolti(&ops), [SOPRA, SOTTO]);
    let nuovi = aggiunte(&ops);
    assert_eq!(nuovi.len(), 1, "{ops}");
    assert_eq!(nuovi[0], ("g".to_string(), id.clone()));
    assert!(
        dopo.contains("vectorcraft:recipe"),
        "la ricetta manca:\n{dopo}"
    );
    // Il Semplice la vede come un gruppo.
    assert_eq!(ruolo_nel_semplice(&dopo, &id), Role::Group);
    // Riaperta senza perdite, è ancora composta, coi metodi di prima; e
    // senza cambiamenti non riscrive niente.
    let mut riaperta = apri(&ds, &dopo);
    assert_eq!(
        metodi(&mut riaperta, &id),
        Some(vec![ShapeMode::Subtract, ShapeMode::Subtract])
    );
    // Salvata ancora (riaperta dal suo testo), resta la stessa.
    let mut di_nuovo = apri(&ds, riaperta.testo());
    assert_eq!(
        metodi(&mut di_nuovo, &id),
        Some(vec![ShapeMode::Subtract, ShapeMode::Subtract])
    );
}

#[test]
fn metodo_forma_cambia_una_composta_riaperta() {
    let ds = motore();
    let (_, dopo, id) = crea(&ds, "subtract");
    let mut d = apri(&ds, &dopo);
    assert_eq!(spenta(&d, "object.compoundShape.setMode", &[&id]), None);
    let esito = comando(
        &mut d,
        "object.compoundShape.setMode",
        &[&id],
        json!({ "mode": "intersect" }),
    );
    let ops = un_passo(&esito);
    let cambiato = applica(&dopo, &ops).expect("le operazioni si applicano");
    let mut riaperta = apri(&ds, &cambiato);
    let id_dopo = esito.selection.first().cloned().unwrap_or(id);
    assert_eq!(
        metodi(&mut riaperta, &id_dopo),
        Some(vec![ShapeMode::Intersect, ShapeMode::Intersect])
    );
    assert_eq!(ruolo_nel_semplice(&cambiato, &id_dopo), Role::Group);
    // Lo stesso metodo non cambia niente.
    let mut d = apri(&ds, &cambiato);
    let esito = comando(
        &mut d,
        "object.compoundShape.setMode",
        &[&id_dopo],
        json!({ "mode": "intersect" }),
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "{esito:?}");
}

#[test]
fn rilascia_rimette_i_membri_nel_file() {
    let ds = motore();
    let (_, dopo, id) = crea(&ds, "subtract");
    let mut d = apri(&ds, &dopo);
    let esito = comando(&mut d, "object.compoundShape.release", &[&id], json!({}));
    let ops = un_passo(&esito);
    assert_eq!(tolti(&ops), [id.as_str()]);
    let nuovi = aggiunte(&ops);
    assert_eq!(nuovi.len(), 2, "{ops}");
    assert!(nuovi.iter().all(|(tag, _)| tag == "path"), "{ops}");
    let fuori = applica(&dopo, &ops).expect("le operazioni si applicano");
    assert!(
        !fuori.contains("vectorcraft:recipe"),
        "la ricetta resta:\n{fuori}"
    );
    // I membri tornano scelti, e coi loro colori.
    assert_eq!(esito.selection.len(), 2);
    assert!(
        fuori.contains("#3366aa") && fuori.contains("#ff0000"),
        "{fuori}"
    );
    apri(&ds, &fuori);
}

#[test]
fn espandi_forma_composta_lascia_un_tracciato() {
    let ds = motore();
    let (_, dopo, id) = crea(&ds, "subtract");
    let mut d = apri(&ds, &dopo);
    let esito = comando(&mut d, "object.compoundShape.expand", &[&id], json!({}));
    let ops = un_passo(&esito);
    assert_eq!(tolti(&ops), [id.as_str()]);
    let nuovi = aggiunte(&ops);
    assert_eq!(nuovi.len(), 1, "{ops}");
    assert_eq!(nuovi[0].0, "path");
    let fuori = applica(&dopo, &ops).expect("le operazioni si applicano");
    assert!(
        !fuori.contains("vectorcraft:recipe"),
        "la ricetta resta:\n{fuori}"
    );
    assert_eq!(ruolo_nel_semplice(&fuori, &nuovi[0].1), Role::Path);
}

#[test]
fn una_composta_che_non_disegna_niente_e_empty() {
    let ds = motore();
    // Due quadrati che non si toccano, in Intersezione: il disegno è vuoto, e
    // nel file sarebbe un `g` vuoto che riaperto perde la ricetta.
    let mut d = apri(&ds, COMPOSTE);
    let esito = comando(
        &mut d,
        "object.compoundShape.make",
        &[SOTTO, "oc3c3c3c3"],
        json!({ "mode": "intersect" }),
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "{esito:?}");
    assert!(esito.ops.is_none());
    // Lo stesso per Metodo forma che svuoterebbe una composta.
    let mut d = apri(&ds, COMPOSTE);
    let esito = comando(
        &mut d,
        "object.compoundShape.make",
        &[SOTTO, "oc3c3c3c3"],
        json!({ "mode": "add" }),
    );
    let ops = un_passo(&esito);
    let dopo = applica(COMPOSTE, &ops).expect("le operazioni si applicano");
    let id = esito.selection[0].clone();
    let mut d = apri(&ds, &dopo);
    let esito = comando(
        &mut d,
        "object.compoundShape.setMode",
        &[&id],
        json!({ "mode": "intersect" }),
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "{esito:?}");
    assert!(esito.ops.is_none());
}

#[test]
fn crea_vuole_due_oggetti_che_il_motore_compone() {
    let ds = motore();
    let mut d = apri(&ds, COMPOSTE);
    let crea = "object.compoundShape.make";
    // Niente di scelto, un oggetto solo.
    assert_eq!(
        spenta(&d, crea, &[]),
        Some(DrawingDisabledReason::NoSelection)
    );
    assert_eq!(
        spenta(&d, crea, &[SOTTO]),
        Some(DrawingDisabledReason::NeedsTwo)
    );
    let esito = comando(&mut d, crea, &[SOTTO], json!({}));
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty));
    // Un'immagine il motore non la compone.
    assert_eq!(
        spenta(&d, crea, &[SOTTO, "oh7h7h7h7"]),
        Some(DrawingDisabledReason::NeedsPath)
    );
    let esito = comando(&mut d, crea, &[SOTTO, "oh7h7h7h7"], json!({}));
    assert_eq!(esito.refused, Some(DrawingRefusal::Unmapped));
    // Un oggetto bloccato.
    assert_eq!(
        spenta(&d, crea, &[SOTTO, "oe5e5e5e5"]),
        Some(DrawingDisabledReason::ReadOnly)
    );
    let esito = comando(&mut d, crea, &[SOTTO, "oe5e5e5e5"], json!({}));
    assert_eq!(esito.refused, Some(DrawingRefusal::Locked));
    // Un tratto della penna di Fub perderebbe il suo inchiostro.
    assert_eq!(
        spenta(&d, crea, &[SOTTO, "oi8b8b8b8"]),
        Some(DrawingDisabledReason::FubInk)
    );
    let esito = comando(&mut d, crea, &[SOTTO, "oi8b8b8b8"], json!({}));
    assert_eq!(esito.refused, Some(DrawingRefusal::Unmapped));
    // Un gruppo e un testo entrano.
    assert_eq!(spenta(&d, crea, &[SOTTO, "og6g6g6g6"]), None);
    assert_eq!(spenta(&d, crea, &[SOTTO, "od4d4d4d4"]), None);
}

#[test]
fn un_tratto_della_penna_dentro_un_gruppo_non_entra() {
    let ds = motore();
    // Il tratto della penna, dentro un gruppo.
    let riga = COMPOSTE.lines().find(|l| l.contains("oi8b8b8b8")).unwrap();
    let testo = COMPOSTE.replace(
        riga,
        &format!("    <g id=\"on9n9n9n9\">\n  {riga}\n    </g>"),
    );
    assert!(testo.contains("<g id=\"on9n9n9n9\">"), "{testo}");
    let mut d = apri(&ds, &testo);
    let crea = "object.compoundShape.make";
    assert_eq!(
        spenta(&d, crea, &[SOTTO, "on9n9n9n9"]),
        Some(DrawingDisabledReason::FubInk)
    );
    let esito = comando(&mut d, crea, &[SOTTO, "on9n9n9n9"], json!({}));
    assert_eq!(esito.refused, Some(DrawingRefusal::Unmapped));
}

#[test]
fn senza_una_composta_scelta_le_sue_voci_sono_spente() {
    let ds = motore();
    let mut d = apri(&ds, COMPOSTE);
    for id in [
        "object.compoundShape.setMode",
        "object.compoundShape.release",
        "object.compoundShape.expand",
    ] {
        assert_eq!(
            spenta(&d, id, &[]),
            Some(DrawingDisabledReason::NoSelection),
            "{id}"
        );
        let perche = spenta(&d, id, &[SOTTO, "og6g6g6g6"]);
        assert!(
            matches!(&perche, Some(DrawingDisabledReason::Other { text }) if text.contains("forma composta")),
            "{id}: {perche:?}"
        );
        let valore = if id.ends_with("setMode") {
            json!({ "mode": "add" })
        } else {
            json!({})
        };
        let esito = comando(&mut d, id, &[SOTTO, "og6g6g6g6"], valore);
        assert_eq!(
            esito.refused,
            Some(DrawingRefusal::Empty),
            "{id}: {esito:?}"
        );
        assert!(esito.ops.is_none());
    }
}

#[test]
fn espandi_forma_fa_di_una_forma_dal_vivo_un_tracciato() {
    let ds = motore();
    // Un rettangolo arrotondato disegnato nel Completo è una forma dal vivo
    // (con la sua ricetta): diventa un tracciato, in un passo.
    let mut d = apri(&ds, ARROTONDATO);
    assert!(dal_vivo(&mut d, VIVO));
    assert_eq!(spenta(&d, "object.expandShape", &[VIVO]), None);
    let esito = comando(&mut d, "object.expandShape", &[VIVO], json!({}));
    let ops = un_passo(&esito);
    let fuori = applica(ARROTONDATO, &ops).expect("le operazioni si applicano");
    let id = esito.selection[0].clone();
    assert_eq!(id, VIVO);
    // Riaperto, è un tracciato qualsiasi (la ricetta che resta tiene il suo
    // aspetto, che il formato della scena non dice).
    let mut riaperto = apri(&ds, &fuori);
    assert!(!dal_vivo(&mut riaperto, VIVO), "{ops}");
    // Un tracciato, o un'ellisse del file (che si apre come tracciato), non
    // hanno niente da espandere.
    let mut d = apri(&ds, COMPOSTE);
    for scelto in [SOTTO, "om3m3m3m3"] {
        let esito = comando(&mut d, "object.expandShape", &[scelto], json!({}));
        assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "{esito:?}");
    }
}
