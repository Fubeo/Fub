//! Le prove dei segnalibri: l'albero dai livelli, e il PDF che lo porta.

use lopdf::{Document, Object, ObjectId};

use super::outline::genitori;
use super::tests::{elenco, faccia, testo, Banco, NEWSREADER};
use super::*;

fn s(titolo: &str, livello: u8, pagina: usize) -> Segnalibro {
    Segnalibro {
        titolo: titolo.into(),
        livello,
        pagina,
        y: 0.0,
    }
}

#[test]
fn pdf_export_l_albero_lo_fanno_i_livelli() {
    let fila = [
        s("Due in cima", 2, 0),
        s("Uno", 1, 0),
        s("Tre sotto uno", 3, 0),
        s("Due", 2, 0),
        s("Tre", 3, 0),
        s("Uno bis", 1, 0),
    ];
    assert_eq!(
        genitori(&fila),
        vec![None, None, Some(1), Some(1), Some(3), None]
    );
    assert!(genitori(&[]).is_empty());
}

fn dizionario(doc: &Document, id: ObjectId) -> lopdf::Dictionary {
    doc.get_dictionary(id).unwrap().clone()
}

fn rif(d: &lopdf::Dictionary, chiave: &[u8]) -> ObjectId {
    d.get(chiave).unwrap().as_reference().unwrap()
}

fn titolo(d: &lopdf::Dictionary) -> String {
    lopdf::decode_text_string(d.get(b"Title").unwrap()).unwrap()
}

#[test]
fn pdf_export_i_segnalibri_si_rileggono_col_loro_albero_e_la_loro_pagina() {
    let facce = vec![faccia("Newsreader Variable", NEWSREADER, &[])];
    let mut e = elenco(
        facce,
        (0..3)
            .map(|i| vec![testo(10.0, 40.0, 0, 12.0, &format!("P{i}"), 7.0)])
            .collect(),
    );
    e.segnalibri = vec![
        s("Introduzione", 1, 0),
        s("Perché", 2, 0),
        s("Come", 2, 1),
        Segnalibro {
            y: 120.0,
            ..s("Conclusione àccentata", 1, 2)
        },
    ];
    let scritto = scrivi(&e, &Banco::default()).unwrap();
    let doc = Document::load_mem(&scritto.pdf).unwrap();
    let pagine: Vec<ObjectId> = doc.get_pages().values().copied().collect();

    // L'indice che `lopdf` ne ricava: livelli, titoli e pagine.
    let indice = doc.get_toc().expect("il PDF ha i segnalibri");
    let voci: Vec<(usize, String, usize)> = indice
        .toc
        .iter()
        .map(|v| (v.level, v.title.clone(), v.page))
        .collect();
    assert_eq!(
        voci,
        vec![
            (1, "Introduzione".into(), 1),
            (2, "Perché".into(), 1),
            (2, "Come".into(), 2),
            (1, "Conclusione àccentata".into(), 3),
        ]
    );

    // E l'albero come lo scrive il PDF: radice, fratelli, figli e conti.
    let radice = rif(doc.catalog().unwrap(), b"Outlines");
    let radice = dizionario(&doc, radice);
    assert_eq!(radice.get(b"Count").unwrap().as_i64().unwrap(), 4);
    let primo = dizionario(&doc, rif(&radice, b"First"));
    let ultimo = dizionario(&doc, rif(&radice, b"Last"));
    assert_eq!(titolo(&primo), "Introduzione");
    assert_eq!(titolo(&ultimo), "Conclusione àccentata");
    assert_eq!(primo.get(b"Count").unwrap().as_i64().unwrap(), 2);
    let figlio = dizionario(&doc, rif(&primo, b"First"));
    let secondo = dizionario(&doc, rif(&figlio, b"Next"));
    assert_eq!(titolo(&figlio), "Perché");
    assert_eq!(titolo(&secondo), "Come");
    assert!(secondo.get(b"Next").is_err());
    assert!(figlio.get(b"Prev").is_err());
    assert_eq!(dizionario(&doc, rif(&primo, b"Next")), ultimo);

    // La destinazione dell'ultimo: la terza pagina, 120 px dall'alto.
    let d = match ultimo.get(b"Dest").unwrap() {
        Object::Array(d) => d.clone(),
        other => panic!("{other:?}"),
    };
    assert_eq!(d[0].as_reference().unwrap(), pagine[2]);
    assert_eq!(d[1].as_name().unwrap(), b"XYZ");
    assert_eq!(d[3].as_float().unwrap(), 225.0 - 90.0);
}

#[test]
fn pdf_export_senza_segnalibri_niente_albero() {
    let e = elenco(vec![], vec![vec![]]);
    let doc = Document::load_mem(&scrivi(&e, &Banco::default()).unwrap().pdf).unwrap();
    assert!(doc.catalog().unwrap().get(b"Outlines").is_err());
}

#[test]
fn pdf_export_troppi_segnalibri_sono_un_errore() {
    let mut e = elenco(vec![], vec![vec![]]);
    e.segnalibri = (0..=MAX_SEGNALIBRI).map(|_| s("x", 1, 0)).collect();
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::TroppiSegnalibri {
            segnalibri: MAX_SEGNALIBRI + 1
        }
    );
}

#[test]
fn pdf_export_il_massimo_dei_segnalibri_si_scrive() {
    // Ventimila titoli allo stesso livello, tutti fratelli in cima.
    let mut e = elenco(vec![], vec![vec![]]);
    e.segnalibri = (0..MAX_SEGNALIBRI)
        .map(|i| s(&format!("T{i}"), 1, 0))
        .collect();
    let scritto = scrivi(&e, &Banco::default()).unwrap();
    let doc = Document::load_mem(&scritto.pdf).unwrap();
    let radice = dizionario(&doc, rif(doc.catalog().unwrap(), b"Outlines"));
    assert_eq!(
        radice.get(b"Count").unwrap().as_i64().unwrap(),
        MAX_SEGNALIBRI as i64
    );
}
