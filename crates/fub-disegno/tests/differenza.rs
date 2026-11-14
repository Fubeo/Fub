//! La differenza fra la copia e il documento del motore cambiato a mano,
//! confrontata con le operazioni che il client scrive (i vettori dei gesti).

mod common;

use std::collections::HashMap;

use common::{confronta_ops, ops_di, Confronto};
use fub_abi::DrawingRefusal;
use fub_scene::Item;
use serde_json::{json, Value};
use vectorcraft_doc::{Document, NodeId, Scaling};
use vectorcraft_geom::Affine;

/// Il percorso di ogni elemento con id nel testo.
fn percorsi(testo: &str) -> HashMap<String, Vec<usize>> {
    fub_scene::read(testo)
        .expect("si legge")
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Element(e) => e.id.clone().map(|id| (id, e.path.clone())),
            _ => None,
        })
        .collect()
}

fn matrice(s: &str) -> Affine {
    let n: Vec<f64> = s
        .trim_start_matches("matrix(")
        .trim_end_matches(')')
        .split(' ')
        .map(|t| t.parse().expect("numero"))
        .collect();
    Affine::new([n[0], n[1], n[2], n[3], n[4], n[5]])
}

fn sposta(doc: &mut Document, nodo: NodeId, m: Affine) {
    let n = doc.node_mut(nodo).expect("l'oggetto c'è");
    n.transform(m, Scaling::from(true));
}

/// Le operazioni attese, se sono solo `ident` e `set` della `transform`: i
/// gesti che spostano, ridimensionano e ruotano.
fn solo_trasformazioni(ops: &Value) -> Option<Vec<Value>> {
    let lista = ops.as_array()?;
    let piatte: Vec<Value> = match lista.first() {
        Some(b) if b["op"] == "batch" => b["ops"].as_array()?.clone(),
        _ => lista.clone(),
    };
    piatte
        .iter()
        .all(|op| {
            op["op"] == "ident"
                || (op["op"] == "set"
                    && op["attrs"]
                        .as_object()
                        .is_some_and(|a| a.len() == 1 && a.contains_key("transform")))
        })
        .then_some(piatte)
}

#[test]
fn un_elemento_senza_id_spostato_a_mano_da_ident_e_set_sullo_stesso_id() {
    let vettore = common::vettori()
        .into_iter()
        .find(|v| v.nome == "sposta-senza-id")
        .expect("il vettore c'è");
    let (mut disegno, _) = common::apri(&vettore.input);
    let esito = disegno
        .a_mano(|doc, trova| {
            sposta(
                doc,
                trova(&[2, 0]).expect("il rettangolo senza id è mappato"),
                Affine::translate((20.0, 10.0)),
            )
        })
        .expect("valido");
    assert_eq!(esito.refused, None);
    let ops = ops_di(&esito);
    let batch = ops[0]["ops"].as_array().expect("un batch");
    assert_eq!(batch.len(), 2, "{ops}");
    assert_eq!(batch[0]["op"], "ident");
    assert_eq!(batch[1]["op"], "set");
    assert_eq!(batch[0]["id"], batch[1]["id"], "lo stesso id");
    let id = batch[0]["id"].as_str().expect("un id");
    assert!(
        fub_disegno::id::e_nuovo(id, fub_disegno::id::Specie::Oggetto),
        "{id}"
    );
    assert_eq!(confronta_ops(&vettore.ops, &ops, None), Confronto::Uguali);
    // La sessione è tornata alla copia: lo stesso cambio dà un id nuovo da
    // capo, non un `set` sull'id di prima.
    let ancora = disegno
        .a_mano(|doc, trova| {
            sposta(
                doc,
                trova(&[2, 0]).expect("mappato"),
                Affine::translate((20.0, 10.0)),
            )
        })
        .expect("valido");
    assert_eq!(
        confronta_ops(&vettore.ops, &ops_di(&ancora), None),
        Confronto::Uguali
    );
}

/// Ogni vettore che sposta, ridimensiona o ruota: lo stesso cambio fatto a
/// mano sull'oggetto del motore dà le operazioni del client.
#[test]
fn le_trasformazioni_a_mano_danno_le_operazioni_del_client() {
    let ammesse =
        common::ammesse(&common::radice().join("crates/fub-disegno/tests/differenza.tsv"));
    let mut provati = 0;
    for v in common::vettori() {
        let Some(ops) = solo_trasformazioni(&v.ops) else {
            continue;
        };
        // I vettori hanno la radice senza scala e gli elementi senza
        // `transform`: la matrice sulla scena è quella del documento del motore.
        assert!(!v.input.contains("transform="), "{}", v.nome);
        let percorsi = percorsi(&v.input);
        let mut nuovi: HashMap<String, Vec<usize>> = HashMap::new();
        let mut cambi: Vec<(Vec<usize>, Affine)> = Vec::new();
        for op in &ops {
            let id = op["id"].as_str().expect("un id").to_string();
            if op["op"] == "ident" {
                let percorso: Vec<usize> =
                    serde_json::from_value(op["path"].clone()).expect("percorso");
                nuovi.insert(id, percorso);
                continue;
            }
            let percorso = nuovi
                .get(&id)
                .or_else(|| percorsi.get(&id))
                .cloned()
                .expect("l'elemento c'è");
            cambi.push((
                percorso,
                matrice(op["attrs"]["transform"].as_str().expect("transform")),
            ));
        }
        let (mut disegno, _) = common::apri(&v.input);
        let esito = disegno
            .a_mano(|doc, trova| {
                for (percorso, m) in &cambi {
                    sposta(doc, trova(percorso).expect("mappato"), *m);
                }
            })
            .expect("valido");
        assert_eq!(esito.refused, None, "{}", v.nome);
        match confronta_ops(
            &v.ops,
            &ops_di(&esito),
            ammesse.get(&v.nome).map(String::as_str),
        ) {
            Confronto::Uguali | Confronto::Ammessa(_) => {}
            Confronto::Diverse(perche) => panic!("{}: {perche}", v.nome),
        }
        provati += 1;
    }
    assert!(
        provati >= 15,
        "i vettori di spostamento, misura e rotazione: {provati}"
    );
}

#[test]
fn nessun_cambio_nessuna_operazione() {
    let (mut disegno, _) = common::apri(&common::vettori()[0].input);
    let esito = disegno.a_mano(|_, _| {}).expect("valido");
    assert_eq!(esito.ops, None);
    assert_eq!(esito.refused, None);
}

const CON_TRASFORMAZIONI: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 200 100\" width=\"400\" height=\"200\">\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\" transform=\"translate(10 0)\">\n    <g id=\"ogruppo01\" transform=\"scale(2)\">\n      <rect id=\"oa1a1a1a1\" x=\"10\" y=\"10\" width=\"10\" height=\"5\" fill=\"#000000\" transform=\"translate(5 5)\"/>\n      <rect id=\"oc3c3c3c3\" x=\"0\" y=\"0\" width=\"2\" height=\"2\" fill=\"#000000\"/>\n    </g>\n    <rect id=\"ob2b2b2b2\" x=\"0\" y=\"0\" width=\"10\" height=\"10\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\"/>\n  </g>\n</svg>\n";

#[test]
fn la_transform_nuova_tiene_conto_della_radice_e_degli_antenati() {
    let (mut disegno, aperto) = common::apri(CON_TRASFORMAZIONI);
    assert_eq!(aperto.unmapped, 0, "{:?}", aperto.losses);
    let percorsi = percorsi(CON_TRASFORMAZIONI);
    // 10 unità del documento del motore a destra: la radice scala per 2, il
    // gruppo per 2, quindi 2,5 unità nello spazio del rettangolo.
    let esito = disegno
        .a_mano(|doc, trova| {
            sposta(
                doc,
                trova(&percorsi["oa1a1a1a1"]).expect("mappato"),
                Affine::translate((10.0, 0.0)),
            )
        })
        .expect("valido");
    let attese = json!([{ "op": "set", "id": "oa1a1a1a1", "attrs": { "transform": "matrix(1 0 0 1 7.5 5)" } }]);
    assert_eq!(
        confronta_ops(&attese, &ops_di(&esito), None),
        Confronto::Uguali,
        "{:?}",
        esito.ops
    );
}

#[test]
fn un_gruppo_mosso_tutto_insieme_riceve_la_transform_lui() {
    let (mut disegno, _) = common::apri(CON_TRASFORMAZIONI);
    let percorsi = percorsi(CON_TRASFORMAZIONI);
    let esito = disegno
        .a_mano(|doc, trova| {
            sposta(
                doc,
                trova(&percorsi["ogruppo01"]).expect("mappato"),
                Affine::translate((0.0, 20.0)),
            )
        })
        .expect("valido");
    // 20 unità del motore sono 10 nello spazio del livello: il gruppo ha
    // `scale(2)`, quindi translate(0 10)·scale(2).
    let attese = json!([{ "op": "set", "id": "ogruppo01", "attrs": { "transform": "matrix(2 0 0 2 0 10)" } }]);
    assert_eq!(
        confronta_ops(&attese, &ops_di(&esito), None),
        Confronto::Uguali,
        "{:?}",
        esito.ops
    );
}

#[test]
fn colori_e_spessore_diventano_attributi() {
    let (mut disegno, _) = common::apri(CON_TRASFORMAZIONI);
    let percorsi = percorsi(CON_TRASFORMAZIONI);
    let esito = disegno
        .a_mano(|doc, trova| {
            let n = doc
                .node_mut(trova(&percorsi["ob2b2b2b2"]).expect("mappato"))
                .expect("c'è");
            let tratto = n.appearance.stroke_mut().expect("ha un tratto");
            tratto.width = 8.0;
            tratto.paint = vectorcraft_doc::color::Paint::solid(
                vectorcraft_doc::color::Color::from_hex("#0072b2").expect("colore"),
            );
        })
        .expect("valido");
    // Lo spessore del motore è nel documento: la radice scala per 2.
    let attese = json!([{ "op": "set", "id": "ob2b2b2b2", "attrs": { "stroke": "#0072b2", "stroke-width": "4" } }]);
    assert_eq!(
        confronta_ops(&attese, &ops_di(&esito), None),
        Confronto::Uguali,
        "{:?}",
        esito.ops
    );
}

#[test]
fn togliere_e_riordinare() {
    let (mut disegno, _) = common::apri(CON_TRASFORMAZIONI);
    let percorsi = percorsi(CON_TRASFORMAZIONI);
    let esito = disegno
        .a_mano(|doc, trova| {
            let rect = trova(&percorsi["ob2b2b2b2"]).expect("mappato");
            doc.remove(rect).expect("tolto");
        })
        .expect("valido");
    assert_eq!(
        confronta_ops(
            &json!([{ "op": "remove", "target": "ob2b2b2b2" }]),
            &ops_di(&esito),
            None
        ),
        Confronto::Uguali
    );
    let esito = disegno
        .a_mano(|doc, trova| {
            let livello = trova(&percorsi["l1a2b3c4d"]).expect("mappato");
            let rect = trova(&percorsi["ob2b2b2b2"]).expect("mappato");
            doc.move_node(rect, Some(livello), 0).expect("spostato");
        })
        .expect("valido");
    // Un `move` solo: il rettangolo va primo (il gruppo resta fermo).
    let attese = json!([{ "op": "move", "target": "ob2b2b2b2", "parent": "l1a2b3c4d", "pos": { "first": true } }]);
    assert_eq!(
        confronta_ops(&attese, &ops_di(&esito), None),
        Confronto::Uguali,
        "{:?}",
        esito.ops
    );
}

#[test]
fn un_oggetto_nuovo_diventa_un_add() {
    let (mut disegno, _) = common::apri(CON_TRASFORMAZIONI);
    let percorsi = percorsi(CON_TRASFORMAZIONI);
    let esito = disegno
        .a_mano(|doc, trova| {
            let livello = trova(&percorsi["l1a2b3c4d"]).expect("mappato");
            let mut copia = doc
                .node(trova(&percorsi["ob2b2b2b2"]).expect("mappato"))
                .expect("c'è")
                .clone();
            copia.id = doc.alloc_id();
            copia.name = None;
            copia.transform(Affine::translate((100.0, 0.0)), Scaling::from(true));
            let n = doc
                .node(livello)
                .and_then(|l| l.children().map(Vec::len))
                .expect("figli");
            doc.insert(Some(livello), n, copia).expect("inserito");
        })
        .expect("valido");
    // 100 unità del motore sono 50 nello spazio del livello.
    let attese = json!([{ "op": "add", "parent": "l1a2b3c4d", "pos": { "last": true }, "elem": { "tag": "path", "attrs": {
        "id": "@1", "d": "M50 0 L60 0 L60 10 L50 10 Z", "fill": "none", "stroke": "#000000", "stroke-width": "2"
    } } }]);
    assert_eq!(
        confronta_ops(&attese, &ops_di(&esito), None),
        Confronto::Uguali,
        "{:?}",
        esito.ops
    );
}

#[test]
fn un_oggetto_che_non_viene_da_fub_e_unmapped() {
    let vettore = common::vettori()
        .into_iter()
        .find(|v| v.nome == "sposta-estraneo")
        .expect("il vettore c'è");
    // `w` ha un rettangolo estraneo e una forma di Fub: spostare solo il
    // primo non è uno spostamento di `w`.
    let input = vettore.input.replace(
        "height=\"50\"/></g>",
        "height=\"50\"/><rect id=\"oa1a1a1a1\" x=\"10\" y=\"10\" width=\"5\" height=\"5\" fill=\"#000000\"/></g>",
    );
    assert!(input.contains("oa1a1a1a1"), "{input}");
    let (mut disegno, _) = common::apri(&input);
    // Il rettangolo estraneo dentro `w` non ha un elemento di Fub.
    let esito = disegno
        .a_mano(|doc, trova| {
            let w = trova(&[2, 0]).expect("w è mappato");
            let figlio = doc
                .node(w)
                .and_then(|n| n.children().and_then(|c| c.first().map(|c| c.id)))
                .expect("un figlio");
            sposta(doc, figlio, Affine::translate((5.0, 0.0)));
        })
        .expect("valido");
    assert_eq!(esito.refused, Some(DrawingRefusal::Unmapped));
}
