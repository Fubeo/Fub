//! La ricetta di un elemento (piano K6, T27): l'andata e ritorno di ogni
//! riga «scena» e «ricetta» della tabella, la ricetta che resta a uno
//! spostamento e cade a un cambio fatto fuori da Fub, la versione più nuova,
//! i metadati sconosciuti e il base64 rotto.
//!
//! Le operazioni si applicano al testo con l'applicatore piccolo delle prove
//! (`common::applica`): il motore delle operazioni vero è quello del client.

mod common;

use std::sync::Arc;

use common::ops_di;
use fub_abi::{DrawingLoss, DrawingLossKind};
use fub_disegno::ricetta::{self, Costrutto, Esito};
use serde_json::Value;
use vectorcraft_doc::color::{BlendMode, Paint};
use vectorcraft_doc::{AppearanceItem, Document, LiveShape, Node, NodeId, NodeKind, Scaling};
use vectorcraft_geom::Affine;

const BASE: &str = include_str!("ricetta/base.svg");
const CON_ALTRI_METADATI: &str = include_str!("ricetta/altri-metadati.svg");

/// Il tracciato di `BASE` che le prove cambiano.
const TRACCIATO: &[usize] = &[1, 0];

// ---------------------------------------------------------------------------
// L'applicatore
// ---------------------------------------------------------------------------

// L'applicatore vive in `common::applica`; qui fallisce la prova.

fn elementi(testo: &str) -> Vec<fub_scene::ElementItem> {
    common::applica::elementi(testo).unwrap_or_else(|e| panic!("{e}"))
}

fn span_dell_id(testo: &str, id: &str) -> [usize; 2] {
    common::applica::span_dell_id(testo, id).unwrap_or_else(|e| panic!("{e}"))
}

fn applica(testo: &str, ops: &Value) -> String {
    common::applica::applica(testo, ops).unwrap_or_else(|e| panic!("{e}: {ops}"))
}

use common::applica::piatte;

// ---------------------------------------------------------------------------
// Il disegno
// ---------------------------------------------------------------------------

/// Apre `testo`, fa `f` sull'oggetto in `percorso` e dà il testo con le
/// operazioni applicate.
fn cambia(
    testo: &str,
    percorso: &[usize],
    f: impl FnOnce(&mut Node, &mut Document),
) -> (Value, String) {
    let (mut d, _) = common::apri(testo);
    let esito = d
        .a_mano(|doc, trova| {
            let id = trova(percorso).expect("l'oggetto è mappato");
            let mut n = doc.node(id).expect("c'è").clone();
            f(&mut n, doc);
            *doc.node_mut(id).expect("c'è") = n;
        })
        .expect("valido");
    assert_eq!(esito.refused, None, "rifiutato: {:?}", esito);
    let ops = ops_di(&esito);
    let nuovo = applica(testo, &ops);
    (ops, nuovo)
}

/// L'oggetto del motore dell'elemento `id` di `testo`, e le perdite.
fn oggetto(testo: &str, id: &str) -> (Node, Vec<DrawingLoss>) {
    let percorso = elementi(testo)
        .into_iter()
        .find(|e| e.id.as_deref() == Some(id))
        .unwrap_or_else(|| panic!("{id} c'è"))
        .path;
    let (mut d, aperto) = common::apri(testo);
    let mut fuori = None;
    let _ = d.a_mano(|doc, trova| {
        let nodo = trova(&percorso).expect("mappato");
        fuori = doc.node(nodo).cloned();
    });
    (fuori.expect("l'oggetto c'è"), aperto.losses)
}

fn avvisi(perdite: &[DrawingLoss]) -> Vec<&DrawingLoss> {
    perdite
        .iter()
        .filter(|p| p.detail.starts_with(ricetta::AVVISO))
        .collect()
}

fn sola_lettura(perdite: &[DrawingLoss]) -> bool {
    perdite.iter().any(|p| {
        p.element == "svg"
            && p.kind == DrawingLossKind::Unsupported
            && p.detail.starts_with("sola lettura")
    })
}

/// L'id dell'oggetto che le operazioni aggiungono come grafica semplice.
fn id_aggiunto(ops: &Value) -> String {
    let raw = piatte(ops)
        .into_iter()
        .find(|o| o["op"] == "add" && o["parent"] != "#root")
        .and_then(|o| o["raw"].as_str().map(str::to_string))
        .unwrap_or_else(|| panic!("un add raw: {ops}"));
    let da = raw.find(" id=\"").expect("un id") + 5;
    raw[da..da + raw[da..].find('"').expect("chiuso")].to_string()
}

// ---------------------------------------------------------------------------
// Un esempio per ogni riga
// ---------------------------------------------------------------------------

fn effetto(id: &str) -> vectorcraft_doc::Effect {
    serde_json::from_value(serde_json::json!({ "id": id })).expect("un effetto")
}

fn contorno(n: &mut Node) -> &mut vectorcraft_doc::StrokeLayer {
    let a = &mut *n.appearance;
    if a.stroke().is_none() {
        a.items.push(AppearanceItem::Stroke(serde_json::from_value(serde_json::json!({
            "paint": { "type": "solid", "color": { "model": "rgb", "r": 0.0, "g": 0.0, "b": 1.0 } },
            "width": 2.0
        })).expect("un contorno")));
    }
    a.items
        .iter_mut()
        .find_map(|i| match i {
            AppearanceItem::Stroke(s) => Some(s),
            _ => None,
        })
        .expect("il contorno")
}

fn riempimento(n: &mut Node) -> &mut vectorcraft_doc::FillLayer {
    n.appearance
        .items
        .iter_mut()
        .find_map(|i| match i {
            AppearanceItem::Fill(f) => Some(f),
            _ => None,
        })
        .expect("il riempimento")
}

macro_rules! da_json {
    ($v:expr) => {{
        let v: Value = $v;
        serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{v}: {e}"))
    }};
}

/// Mette su `n`, il tracciato, un esempio del costrutto `c`; `None` per i
/// costrutti che un tracciato non porta o che non vanno nella ricetta.
fn esempio(c: Costrutto, n: &mut Node) -> Option<()> {
    use Costrutto::*;
    let quadrato = || n_path_box();
    match c {
        Livello | Gruppo | Tracciato | TracciatoComposto | Testo | FormaSemplice | AttributiSvg => {
            return None
        }
        // Un simbolo, un'immagine e un documento collocato non hanno una
        // grafica semplice, e un'immagine o un documento porterebbero un
        // file: li scrive la famiglia nella forma della scena.
        Simbolo | Immagine | DocumentoCollocato => return None,
        EffettoDellaScena => n.appearance.effects.push(effetto("blur.gaussian")),
        EffettoVivo => n.appearance.effects.push(effetto("distort.roughen")),
        ModoDiFusione => n.blend = BlendMode::Multiply,
        Opacita => n.opacity = 0.5,
        SostituzioniDelSimbolo => {
            n.extras_mut().symbol_overrides = vec![da_json!(
                serde_json::json!({ "path": [0], "appearance": null })
            )]
        }
        Ripetizione => {
            let figlio = Arc::new(n.clone());
            n.kind = da_json!(serde_json::json!({ "type": "repeat", "source": [],
                "kind": { "type": "radial", "instances": 4, "radius": 60.0, "center": [150.0, 125.0] } }));
            if let Some(f) = n.children_mut() {
                f.push(figlio);
            }
        }
        SpessoreVariabile => {
            contorno(n).profile = Some(da_json!(
                serde_json::json!({ "points": [[0.0, 1.0, 1.0], [1.0, 3.0, 3.0]] })
            ))
        }
        Sfumatura => {
            riempimento(n).paint = da_json!(serde_json::json!({ "type": "gradient",
            "gradient": { "kind": "Linear", "stops": [
                { "offset": 0.0, "color": { "model": "rgb", "r": 1.0, "g": 0.0, "b": 0.0 } },
                { "offset": 1.0, "color": { "model": "rgb", "r": 0.0, "g": 0.0, "b": 1.0 } }
            ] } }))
        }
        Motivo => return None,
        Penna => contorno(n).end_arrow = Some(da_json!(serde_json::json!("Triangle"))),
        // Un tratteggio semplice è `stroke-dasharray` sull'elemento (`differenza::scrivi_stile_del_tratto`,
        // i casi `stroke.set` di `tests/famiglie/aspetto.json`); spostato, va con la ricetta.
        Tratteggio => {
            contorno(n).dash = Some(da_json!(
                serde_json::json!({ "pattern": [4.0, 2.0], "offset": 1.0 })
            ))
        }
        Maschera => n.extras_mut().mask = Some(da_json!(serde_json::json!({ "art": quadrato() }))),
        Ritaglio => {
            if let NodeKind::Path { clipping, .. } = &mut n.kind {
                *clipping = true;
            }
        }
        AspettoImpilato => {
            let secondo = riempimento(n).clone();
            n.appearance.items.push(AppearanceItem::Fill(secondo));
        }
        FormaViva => {
            if let NodeKind::Path { live, .. } = &mut n.kind {
                *live = Some(Box::new(da_json!(serde_json::json!({ "shape": "polygon",
                    "radius": 50.0, "sides": 6, "xf": [1.0, 0.0, 0.0, 1.0, 150.0, 125.0] }))));
            }
        }
        FusioneDiOggetti => {
            let a = Arc::new(n.clone());
            let mut b = n.clone();
            b.id = NodeId(9_999);
            b.transform(Affine::translate((0.0, 60.0)), Scaling::from(true));
            n.kind = da_json!(serde_json::json!({ "type": "blend", "children": [], "spec": {} }));
            if let Some(f) = n.children_mut() {
                f.push(a);
                f.push(Arc::new(b));
            }
        }
        Busta => {
            let figlio = Arc::new(n.clone());
            n.kind = da_json!(serde_json::json!({ "type": "envelope", "content": [],
                "kind": { "type": "warp", "style": "arc", "bend": 0.5 } }));
            if let Some(f) = n.children_mut() {
                f.push(figlio);
            }
        }
        Maglia => return None,
        Intreccio => {
            let figlio = Arc::new(n.clone());
            n.kind = da_json!(serde_json::json!({ "type": "intertwine", "children": [] }));
            if let Some(f) = n.children_mut() {
                f.push(figlio);
            }
        }
        Isolamento => n.isolate = true,
        AllineamentoDelContorno => contorno(n).align = da_json!(serde_json::json!("Inside")),
        Sovrastampa => riempimento(n).overprint = true,
        Pressione => contorno(n).pressure = Some(Default::default()),
        Ricalco => n.extras_mut().trace = Some(Box::new(serde_json::json!({ "preset": "x" }))),
        TestoAvvolto => n.extras_mut().wrap = Some(Default::default()),
        Grafico => n.extras_mut().series_index = Some(1),
        ContorniDelTesto => n.extras_mut().type_outlines = true,
        Pixelato => n.extras_mut().pixelated = true,
        FormaDisegnata => n.extras_mut().shaper = Some(Default::default()),
        StileGrafico => n.extras_mut().graphic_style = Some(3),
        Fetta => n.extras_mut().slice = Some(Default::default()),
        Prospettiva => n.extras_mut().perspective = Some(Default::default()),
        Quota => {
            n.extras_mut().dimension = Some(Box::new(da_json!(
                serde_json::json!({ "mode": "linear", "a": [100.0, 100.0], "b": [200.0, 100.0], "vertex": [100.0, 100.0], "offset": 10.0, "length": 100.0, "options": {}, "source": null })
            )))
        }
        PitturaViva => n.extras_mut().live_paint_gaps = Some(Default::default()),
        OggettiSulTracciato => {
            n.extras_mut().objects_on_path =
                Some(Box::new(da_json!(serde_json::json!({ "path": 2 }))))
        }
        Colorazione => {
            n.extras_mut().colorize = Some(Box::new(da_json!(serde_json::json!({
            "type": "solid", "color": { "model": "rgb", "r": 0.0, "g": 1.0, "b": 0.0 } }))))
        }
        FormaComposta => n.extras_mut().compound_shape = true,
    }
    Some(())
}

fn n_path_box() -> Value {
    serde_json::json!({ "id": 9_998, "kind": { "type": "path", "path": { "subpaths": [
        { "anchors": [{ "p": [90.0, 90.0] }, { "p": [210.0, 90.0] }, { "p": [210.0, 160.0] }],
          "closed": true }] } } })
}

// ---------------------------------------------------------------------------
// Le prove
// ---------------------------------------------------------------------------

/// Ogni riga «scena» e «ricetta» che un tracciato porta: l'oggetto ricco si
/// scrive come grafica semplice con la sua ricetta, e alla riapertura il
/// motore ha di nuovo il costrutto.
#[test]
fn ogni_riga_torna_dalla_ricetta() {
    let mut provate = Vec::new();
    for c in Costrutto::TUTTI {
        let mut esempio_messo = false;
        let mut del_motore = String::new();
        let (ops, testo) = {
            let (mut d, _) = common::apri(BASE);
            let esito = d
                .a_mano(|doc, trova| {
                    let id = trova(TRACCIATO).expect("mappato");
                    let mut n = doc.node(id).expect("c'è").clone();
                    if esempio(c, &mut n).is_some() {
                        esempio_messo = true;
                        *doc.node_mut(id).expect("c'è") = n;
                        del_motore = disegno_del_documento(doc);
                    }
                })
                .expect("valido");
            if !esempio_messo {
                continue;
            }
            assert_eq!(esito.refused, None, "{c:?} rifiutato");
            let ops = ops_di(&esito);
            let testo = applica(BASE, &ops);
            (ops, testo)
        };
        assert_ne!(c.esito(), Esito::Corpo, "{c:?}");
        assert!(
            piatte(&ops)
                .iter()
                .any(|o| o["op"] == "add" && o["parent"] != "#root"),
            "{c:?}: {ops}"
        );
        let id = id_aggiunto(&ops);
        let ricette = vectorcraft_svg::recipes(&testo);
        assert_eq!(ricette.len(), 1, "{c:?}: {testo}");
        assert_eq!(ricette[0].for_id, id, "{c:?}");
        let (n, perdite) = oggetto(&testo, &id);
        assert!(avvisi(&perdite).is_empty(), "{c:?}: {perdite:?}");
        assert!(
            ricetta::costrutti(&n).contains(&c),
            "{c:?} non torna: {:?}",
            ricetta::costrutti(&n)
        );
        // Il corpo scritto si disegna come il motore disegna l'oggetto.
        if let Err(e) = stessi_pixel(&testo, &del_motore) {
            panic!("{c:?}: il corpo scritto e il disegno del motore {e}\n{testo}");
        }
        provate.push(c);
    }
    assert!(provate.len() >= 25, "{provate:?}");
}

/// La tabella: ogni costrutto ha la sua riga, e i tre esiti ci sono tutti.
#[test]
fn la_tabella_ha_ogni_esito() {
    for e in [Esito::Corpo, Esito::Scena, Esito::Ricetta] {
        assert!(Costrutto::TUTTI.iter().any(|c| c.esito() == e), "{e:?}");
    }
    let mut visti = std::collections::HashSet::new();
    assert!(Costrutto::TUTTI.iter().all(|c| visti.insert(*c)), "doppi");
}

/// Un SVG senza ricette: un gesto semplice non tocca i metadati.
#[test]
fn senza_ricette_niente_metadati() {
    let (ops, testo) = cambia(BASE, TRACCIATO, |n, _| {
        n.transform(Affine::translate((5.0, 0.0)), Scaling::from(true))
    });
    assert!(piatte(&ops).iter().all(|o| o["op"] == "set"), "{ops}");
    assert!(!testo.contains("vectorcraft"), "{testo}");
}

/// Un oggetto con la ricetta: alla riapertura il motore ha la sua forma.
fn con_ricetta() -> (String, String) {
    let (ops, testo) = cambia(BASE, TRACCIATO, |n, _| {
        n.appearance.effects.push(effetto("distort.roughen"))
    });
    (id_aggiunto(&ops), testo)
}

/// Il disegno che il motore fa del documento: l'esportazione della prima
/// tavola, come l'oracolo del banco delle righe.
fn disegno_del_documento(doc: &Document) -> String {
    vectorcraft_svg::export(
        doc,
        &vectorcraft_svg::ExportOptions {
            artboard: Some(0),
            ..Default::default()
        },
    )
}

/// `Ok` se i due SVG si disegnano uguali con la tolleranza del cancello
/// (`casi/mod.rs`); se no quanti pixel differiscono.
fn stessi_pixel(a: &str, b: &str) -> Result<(), String> {
    use fub_testkit::pixel::{confronta, disegna, Opzioni};
    let opzioni = Opzioni {
        larghezza: 800,
        facce: &[],
    };
    let x = disegna(a, &opzioni)?;
    let y = disegna(b, &opzioni)?;
    let c = confronta(&x, &y, 8, None)?;
    if c.diversi as f64 / c.totali.max(1) as f64 > 0.002 {
        return Err(format!(
            "differiscono in {} pixel su {} ({:?})",
            c.diversi, c.totali, c.riquadro
        ));
    }
    Ok(())
}

/// L'andata e ritorno di un oggetto ricco, col corpo espanso: `f` lo fa
/// ricco nel motore, Fub scrive. Il corpo scritto si disegna come il motore
/// lo disegna; riaperto, l'oggetto ha di nuovo il costrutto `c` dalla
/// ricetta e il motore lo disegna ancora uguale (il costrutto non si applica
/// due volte, sul corpo già espanso); un secondo salvataggio senza modifiche
/// non cambia niente.
fn andata_e_ritorno(c: Costrutto, f: impl FnOnce(&mut Node)) -> String {
    let mut del_motore = String::new();
    let (mut d, _) = common::apri(BASE);
    let esito = d
        .a_mano(|doc, trova| {
            let id = trova(TRACCIATO).expect("mappato");
            let mut n = doc.node(id).expect("c'è").clone();
            f(&mut n);
            *doc.node_mut(id).expect("c'è") = n;
            del_motore = disegno_del_documento(doc);
        })
        .expect("valido");
    assert_eq!(esito.refused, None, "rifiutato: {esito:?}");
    let ops = ops_di(&esito);
    let testo = applica(BASE, &ops);
    let id = id_aggiunto(&ops);
    // 1. Ciò che Fub scrive è il disegno del motore.
    if let Err(e) = stessi_pixel(&testo, &del_motore) {
        panic!("{c:?}: il corpo scritto e il disegno del motore {e}\n{testo}");
    }
    // 2. Riaperto, l'oggetto ha di nuovo il costrutto, e il motore lo
    // disegna come prima: non due volte.
    let (n, perdite) = oggetto(&testo, &id);
    assert!(avvisi(&perdite).is_empty(), "{c:?}: {perdite:?}");
    assert!(
        ricetta::costrutti(&n).contains(&c),
        "{c:?} non torna: {:?}",
        ricetta::costrutti(&n)
    );
    let (mut riaperto, _) = common::apri(&testo);
    let mut di_nuovo = String::new();
    let secondo = riaperto
        .a_mano(|doc, _| di_nuovo = disegno_del_documento(doc))
        .expect("valido");
    if let Err(e) = stessi_pixel(&di_nuovo, &del_motore) {
        panic!("{c:?}: riaperto, il motore lo disegna diverso: {e}\n{testo}");
    }
    // 3. Un secondo salvataggio senza modifiche non cambia niente.
    assert_eq!(secondo.refused, None, "{secondo:?}");
    assert!(secondo.ops.is_none(), "{c:?}: {:?}", secondo.ops);
    testo
}

#[test]
fn un_effetto_vivo_si_scrive_applicato_e_torna_vivo() {
    let testo = andata_e_ritorno(Costrutto::EffettoVivo, |n| {
        n.appearance.effects.push(
            serde_json::from_value(serde_json::json!({
                "id": "stylize.roundCorners", "params": { "radius": 40.0 }
            }))
            .expect("un effetto"),
        )
    });
    // Gli angoli tondi sono nel corpo: curve, non la geometria di partenza.
    let corpo = &testo[testo.find("<path id=").expect("il corpo")..];
    assert!(
        corpo[..corpo.find("/>").expect("chiuso")].contains(" C"),
        "{testo}"
    );
}

#[test]
fn un_aspetto_impilato_si_scrive_espanso_e_torna_impilato() {
    let testo = andata_e_ritorno(Costrutto::AspettoImpilato, |n| {
        // Sotto, un contorno largo blu; sopra, il riempimento e un contorno
        // stretto giallo.
        let mut largo = contorno(n).clone();
        largo.width = 12.0;
        let mut stretto = largo.clone();
        stretto.width = 3.0;
        stretto.paint = da_json!(serde_json::json!({ "type": "solid",
            "color": { "model": "rgb", "r": 1.0, "g": 0.8, "b": 0.0 } }));
        n.appearance
            .items
            .retain(|i| !matches!(i, AppearanceItem::Stroke(_)));
        n.appearance.items.insert(0, AppearanceItem::Stroke(largo));
        n.appearance.items.push(AppearanceItem::Stroke(stretto));
    });
    // L'aspetto in pila è più elementi in un `<g>` con l'id dell'oggetto.
    let da = testo.find("<g id=\"o").expect("il gruppo del corpo");
    let gruppo = &testo[da..da + testo[da..].find("</g>").expect("chiuso")];
    let pezzi = gruppo.matches("<path").count() + gruppo.matches("<polygon").count();
    assert_eq!(pezzi, 3, "{testo}");
}

#[test]
fn uno_spostamento_tiene_la_ricetta() {
    let (id, testo) = con_ricetta();
    let percorso = elementi(&testo)
        .into_iter()
        .find(|e| e.id.as_deref() == Some(id.as_str()))
        .expect("c'è")
        .path;
    let (ops, dopo) = cambia(&testo, &percorso, |n, _| {
        n.transform(
            Affine::translate((30.0, 10.0)) * Affine::rotate(0.3),
            Scaling::from(true),
        )
    });
    let lista = piatte(&ops);
    assert_eq!(lista.len(), 1, "{ops}");
    assert_eq!(lista[0]["op"], "set");
    assert!(lista[0]["attrs"].get("transform").is_some(), "{ops}");
    assert_eq!(
        vectorcraft_svg::recipes(&dopo),
        vectorcraft_svg::recipes(&testo)
            .into_iter()
            .map(|mut r| {
                let spostata = vectorcraft_svg::recipes(&dopo)[0].clone();
                r.range = spostata.range;
                r.metadata = spostata.metadata;
                r
            })
            .collect::<Vec<_>>(),
        "la ricetta resta"
    );
    let (n, perdite) = oggetto(&dopo, &id);
    assert!(avvisi(&perdite).is_empty(), "{perdite:?}");
    assert!(ricetta::costrutti(&n).contains(&Costrutto::EffettoVivo));
}

#[test]
fn un_cambio_fuori_da_fub_toglie_solo_la_ricetta_e_lo_dice() {
    let (id, testo) = con_ricetta();
    // Fuori da Fub il colore cambia.
    let [da, a] = span_dell_id(&testo, &id);
    let elemento = testo[da..a].replace("fill=\"#000000\"", "fill=\"#00ff00\"");
    assert_ne!(elemento, testo[da..a]);
    let cambiato = format!("{}{elemento}{}", &testo[..da], &testo[a..]);
    let (n, perdite) = oggetto(&cambiato, &id);
    assert!(!ricetta::costrutti(&n).contains(&Costrutto::EffettoVivo));
    let avvisi = avvisi(&perdite);
    assert_eq!(avvisi.len(), 1, "{perdite:?}");
    assert_eq!(avvisi[0].element, id);
    assert!(
        avvisi[0].detail.contains("fuori da Fub"),
        "{}",
        avvisi[0].detail
    );
    assert!(!sola_lettura(&perdite));
    // Resta modificabile come grafica semplice, e la ricetta vecchia cade
    // alla prossima scrittura senza essere riscritta.
    let percorso = elementi(&cambiato)
        .into_iter()
        .find(|e| e.id.as_deref() == Some(id.as_str()))
        .expect("c'è")
        .path;
    let (_, dopo) = cambia(&cambiato, &percorso, |n, _| {
        n.transform(Affine::translate((5.0, 5.0)), Scaling::from(true))
    });
    assert!(vectorcraft_svg::recipes(&dopo).is_empty(), "{dopo}");
    assert!(dopo.contains("fill=\"#00ff00\""));
}

#[test]
fn una_versione_piu_nuova_apre_in_sola_lettura() {
    let (id, testo) = con_ricetta();
    let piu_nuova = testo.replace(" v=\"1\"", " v=\"2\"");
    assert_ne!(piu_nuova, testo);
    let (n, perdite) = oggetto(&piu_nuova, &id);
    assert!(sola_lettura(&perdite), "{perdite:?}");
    let motivo = perdite
        .iter()
        .find(|p| p.element == "svg")
        .expect("la sola lettura");
    assert!(
        motivo.detail.contains("versione più nuova"),
        "{}",
        motivo.detail
    );
    assert!(!ricetta::costrutti(&n).contains(&Costrutto::EffettoVivo));
}

#[test]
fn i_metadati_sconosciuti_restano_parola_per_parola() {
    let rdf = "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description about=\"x\"/></rdf:RDF>";
    assert!(CON_ALTRI_METADATI.contains(rdf));
    let altro = "<altro:cosa xmlns:altro=\"urn:altro\">testo &amp; più</altro:cosa>";
    assert!(CON_ALTRI_METADATI.contains(altro));
    // Una ricetta nuova accanto a metadati che non sono suoi.
    let (ops, testo) = cambia(CON_ALTRI_METADATI, TRACCIATO, |n, _| {
        n.appearance.effects.push(effetto("distort.roughen"))
    });
    assert!(testo.contains(rdf), "{testo}");
    assert!(testo.contains(altro), "{testo}");
    assert!(testo.contains("inkscape:pageopacity=\"0\""), "{testo}");
    let id = id_aggiunto(&ops);
    // Poi l'oggetto si toglie: la ricetta cade, i metadati restano.
    let percorso = elementi(&testo)
        .into_iter()
        .find(|e| e.id.as_deref() == Some(id.as_str()))
        .expect("c'è")
        .path;
    let (mut d, _) = common::apri(&testo);
    let esito = d
        .a_mano(|doc, trova| {
            let nodo = trova(&percorso).expect("mappato");
            doc.remove(nodo).expect("si toglie");
        })
        .expect("valido");
    assert_eq!(esito.refused, None);
    let dopo = applica(&testo, &ops_di(&esito));
    assert!(vectorcraft_svg::recipes(&dopo).is_empty(), "{dopo}");
    assert!(dopo.contains(rdf) && dopo.contains(altro), "{dopo}");
}

#[test]
fn il_base64_rotto_si_ignora_con_un_avviso() {
    let (id, testo) = con_ricetta();
    let r = &vectorcraft_svg::recipes(&testo)[0];
    let rotto = format!(
        "{}!!{}",
        &testo[..r.range.end - "</vectorcraft:recipe>".len()],
        &testo[r.range.end - "</vectorcraft:recipe>".len()..]
    );
    let (n, perdite) = oggetto(&rotto, &id);
    assert!(!ricetta::costrutti(&n).contains(&Costrutto::EffettoVivo));
    let avvisi = avvisi(&perdite);
    assert_eq!(avvisi.len(), 1, "{perdite:?}");
    assert!(avvisi[0].detail.contains("base64"), "{}", avvisi[0].detail);
    assert!(!sola_lettura(&perdite));
    // La ricetta rotta resta nel file a una scrittura che la riscrive.
    let altro = elementi(&rotto)
        .into_iter()
        .find(|e| e.id.as_deref() == Some("ob2b2b2b2"))
        .expect("c'è")
        .path;
    let (_, dopo) = cambia(&rotto, &altro, |n, _| {
        n.appearance.effects.push(effetto("distort.roughen"))
    });
    let tutte = vectorcraft_svg::recipes(&dopo);
    assert_eq!(tutte.len(), 2, "{dopo}");
    assert!(tutte
        .iter()
        .any(|t| t.for_id == id && t.data.ends_with("!!")));
}

#[test]
fn due_ricette_per_un_id_vale_la_prima() {
    let (id, testo) = con_ricetta();
    let r = vectorcraft_svg::recipes(&testo)[0].clone();
    let seconda = testo[r.range.clone()].to_string();
    let doppio = format!(
        "{}{seconda}{}",
        &testo[..r.range.end],
        &testo[r.range.end..]
    );
    let (n, perdite) = oggetto(&doppio, &id);
    assert!(ricetta::costrutti(&n).contains(&Costrutto::EffettoVivo));
    let avvisi = avvisi(&perdite);
    assert_eq!(avvisi.len(), 1, "{perdite:?}");
    assert!(avvisi[0].detail.contains("doppia"));
}

/// Due elementi con lo stesso id: la scena apre il disegno solo da guardare
/// (K5 non rinomina: il codice vince sul piano) e il motore ha due oggetti
/// con lo stesso nome, quindi la ricetta non sa a quale andare. Lo dice con
/// l'avviso, nessun gesto scrive e la ricetta resta parola per parola.
#[test]
fn con_due_id_uguali_il_disegno_si_guarda_e_la_ricetta_resta() {
    let (id, testo) = con_ricetta();
    let [da, a] = span_dell_id(&testo, &id);
    let copia = testo[da..a].to_string();
    let doppio = format!("{}{copia}{}", &testo[..a], &testo[a..]);
    let (_, aperto) = common::apri(&doppio);
    assert!(sola_lettura(&aperto.losses), "{:?}", aperto.losses);
    assert!(
        aperto
            .losses
            .iter()
            .any(|p| p.element == "svg" && p.detail.contains("stesso id")),
        "{:?}",
        aperto.losses
    );
    let avvisi = avvisi(&aperto.losses);
    assert_eq!(avvisi.len(), 1, "{:?}", aperto.losses);
    assert_eq!(avvisi[0].element, id);
    assert!(
        avvisi[0].detail.contains("resta com'è"),
        "{}",
        avvisi[0].detail
    );
    assert_eq!(vectorcraft_svg::recipes(&doppio).len(), 1);
}

#[test]
fn una_ricetta_orfana_cade_alla_prossima_scrittura() {
    let (id, testo) = con_ricetta();
    let orfano = testo.replacen(&format!("id=\"{id}\""), "id=\"oz9z9z9z9\"", 1);
    let (_, perdite) = oggetto(&orfano, "oz9z9z9z9");
    assert!(avvisi(&perdite).is_empty(), "{perdite:?}");
    let altro = elementi(&orfano)
        .into_iter()
        .find(|e| e.id.as_deref() == Some("ob2b2b2b2"))
        .expect("c'è")
        .path;
    let (_, dopo) = cambia(&orfano, &altro, |n, _| {
        n.transform(Affine::translate((1.0, 0.0)), Scaling::from(true))
    });
    assert!(vectorcraft_svg::recipes(&dopo).is_empty(), "{dopo}");
}

#[test]
fn una_ricetta_non_porta_file() {
    let (id, testo) = con_ricetta();
    let r = vectorcraft_svg::recipes(&testo)[0].clone();
    let mut json: Value = serde_json::from_slice(&r.bytes().expect("si legge")).expect("json");
    json["node"]["kind"] = serde_json::json!({ "type": "placeddocument",
        "link": { "path": "/etc/passwd" } });
    let byte = serde_json::to_vec(&json).expect("json");
    let nuova = vectorcraft_svg::recipe_element(&id, r.hash.as_deref().expect("hash"), &byte);
    let con_file = format!(
        "{}{nuova}{}",
        &testo[..r.range.start],
        &testo[r.range.end..]
    );
    let (n, perdite) = oggetto(&con_file, &id);
    assert!(matches!(n.kind, NodeKind::Path { .. }));
    let avvisi = avvisi(&perdite);
    assert_eq!(avvisi.len(), 1, "{perdite:?}");
    assert!(avvisi[0].detail.contains("file"), "{}", avvisi[0].detail);
}

#[test]
fn troppe_ricette_aprono_in_sola_lettura() {
    // Ricette corte, perché il file resti sotto il tetto dei byte: oltre il
    // limite il disegno si apre (non c'è errore) ma solo da guardare, e
    // nessuna ricetta si perde perché nessun gesto scrive.
    let una = "<vectorcraft:recipe for=\"oa1a1a1a1\" hash=\"0\" v=\"1\">e30=</vectorcraft:recipe>";
    let molte = una.repeat(ricetta::MAX_RICETTE + 1);
    let pieno = BASE.replace(
        "</svg>",
        &format!(
            "<metadata xmlns:vectorcraft=\"urn:vectorcraft:editing\">{molte}</metadata></svg>"
        ),
    );
    assert!(pieno.len() < fub_scene::MAX_EDIT_BYTES);
    let (_, aperto) = common::apri(&pieno);
    assert!(
        sola_lettura(&aperto.losses),
        "{:?}",
        &aperto.losses[..3.min(aperto.losses.len())]
    );
}

/// Una forma viva: senza la ricetta il motore la apre come tracciato.
#[test]
fn una_forma_viva_resta_viva() {
    let (ops, testo) = cambia(BASE, TRACCIATO, |n, _| {
        if let NodeKind::Path { live, .. } = &mut n.kind {
            *live = Some(Box::new(da_json!(serde_json::json!({ "shape": "polygon",
                "radius": 50.0, "sides": 6, "xf": [1.0, 0.0, 0.0, 1.0, 150.0, 125.0] }))));
        }
    });
    let id = id_aggiunto(&ops);
    let (n, _) = oggetto(&testo, &id);
    assert!(
        matches!(&n.kind, NodeKind::Path { live: Some(l), .. } if matches!(**l, LiveShape::Polygon { .. })),
        "{n:?}"
    );
    let _ = Paint::None;
}
