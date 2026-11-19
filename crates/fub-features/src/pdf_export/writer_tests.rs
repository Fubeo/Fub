//! Le prove dello scrittore: i dati del documento, i collegamenti, i limiti
//! e il controllo che ferma la scrittura. Il PDF si rilegge con `lopdf`.

use lopdf::{Document, Object};

use super::tests::{elenco, faccia, lettere, ridisegna, testo, Banco, NEWSREADER};
use super::writer::{etichetta_di_lingua, indirizzo_ammesso};
use super::*;

fn una_pagina(n: usize) -> ElencoPagine {
    let facce = vec![faccia("Newsreader Variable", NEWSREADER, &[("opsz", 12.0)])];
    let pagine = (0..n)
        .map(|i| vec![testo(20.0, 40.0, 0, 12.0, &format!("Pagina{i}"), 7.0)])
        .collect();
    elenco(facce, pagine)
}

fn rileggi(pdf: &[u8]) -> Document {
    Document::load_mem(pdf).expect("il PDF si rilegge")
}

fn testo_di(doc: &Document, o: &Object) -> String {
    let o = match o {
        Object::Reference(r) => doc.get_object(*r).unwrap(),
        o => o,
    };
    lopdf::decode_text_string(o).expect("una stringa di testo")
}

/// Il dizionario `Info` del trailer.
fn dati(doc: &Document) -> lopdf::Dictionary {
    let r = doc.trailer.get(b"Info").unwrap().as_reference().unwrap();
    doc.get_dictionary(r).unwrap().clone()
}

/// Le annotazioni di ogni pagina, nell'ordine delle pagine.
fn annotazioni(doc: &Document) -> Vec<Vec<lopdf::Dictionary>> {
    doc.get_pages()
        .values()
        .map(|id| {
            let pagina = doc.get_dictionary(*id).unwrap();
            match pagina.get(b"Annots") {
                Ok(Object::Array(voci)) => voci
                    .iter()
                    .map(|v| {
                        doc.get_dictionary(v.as_reference().unwrap())
                            .unwrap()
                            .clone()
                    })
                    .collect(),
                _ => Vec::new(),
            }
        })
        .collect()
}

fn numeri(o: &Object) -> Vec<f32> {
    o.as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_float().unwrap())
        .collect()
}

#[test]
fn pdf_export_titolo_autore_e_lingua_nei_dati_del_pdf() {
    let mut e = una_pagina(1);
    e.titolo = "Relazione sull'àcqua".into();
    e.autore = "Ada Lovelace".into();
    e.lingua = "it-IT".into();
    let scritto = scrivi(&e, &Banco::default()).unwrap();
    assert!(scritto.avvisi.is_empty(), "{:?}", scritto.avvisi);
    let doc = rileggi(&scritto.pdf);
    let info = dati(&doc);
    assert_eq!(
        testo_di(&doc, info.get(b"Title").unwrap()),
        "Relazione sull'àcqua"
    );
    assert_eq!(testo_di(&doc, info.get(b"Author").unwrap()), "Ada Lovelace");
    assert_eq!(testo_di(&doc, info.get(b"Producer").unwrap()), "Fub");
    // Niente date: lo stesso elenco dà gli stessi byte.
    assert!(info.get(b"CreationDate").is_err());
    let catalogo = doc.catalog().unwrap();
    assert_eq!(testo_di(&doc, catalogo.get(b"Lang").unwrap()), "it-IT");
    let preferenze = catalogo.get(b"ViewerPreferences").unwrap();
    let preferenze = match preferenze {
        Object::Dictionary(d) => d.clone(),
        Object::Reference(r) => doc.get_dictionary(*r).unwrap().clone(),
        other => panic!("{other:?}"),
    };
    assert!(preferenze
        .get(b"DisplayDocTitle")
        .unwrap()
        .as_bool()
        .unwrap());
}

#[test]
fn pdf_export_senza_dati_il_pdf_non_ne_inventa() {
    let mut e = una_pagina(1);
    e.titolo = String::new();
    let doc = rileggi(&scrivi(&e, &Banco::default()).unwrap().pdf);
    let info = dati(&doc);
    assert!(info.get(b"Title").is_err());
    assert!(info.get(b"Author").is_err());
    assert!(doc.catalog().unwrap().get(b"Lang").is_err());
}

#[test]
fn pdf_export_una_lingua_che_non_e_un_etichetta_resta_fuori_con_un_avviso() {
    let mut e = una_pagina(1);
    e.lingua = "italiano corrente".into();
    let scritto = scrivi(&e, &Banco::default()).unwrap();
    assert_eq!(
        scritto.avvisi,
        vec![Avviso::LinguaScartata {
            lingua: "italiano corrente".into()
        }]
    );
    assert!(rileggi(&scritto.pdf)
        .catalog()
        .unwrap()
        .get(b"Lang")
        .is_err());
    assert!(etichetta_di_lingua("en"));
    assert!(etichetta_di_lingua("zh-Hant-TW"));
    assert!(!etichetta_di_lingua("x"));
    assert!(!etichetta_di_lingua("it_IT"));
    assert!(!etichetta_di_lingua("it-"));
}

#[test]
fn pdf_export_i_collegamenti_portano_fuori_e_dentro_il_documento() {
    let mut e = una_pagina(3);
    e.pagine[0].collegamenti = vec![
        Collegamento {
            x: 20.0,
            y: 30.0,
            w: 100.0,
            h: 14.0,
            destinazione: Destinazione::Fuori {
                url: "https://fub.example/àncora?a=1 b".into(),
            },
        },
        Collegamento {
            x: 20.0,
            y: 60.0,
            w: 80.0,
            h: 14.0,
            destinazione: Destinazione::Dentro {
                pagina: 2,
                y: 100.0,
            },
        },
    ];
    let scritto = scrivi(&e, &Banco::default()).unwrap();
    assert!(scritto.avvisi.is_empty(), "{:?}", scritto.avvisi);
    let doc = rileggi(&scritto.pdf);
    let pagine: Vec<_> = doc.get_pages().values().copied().collect();
    let annotazioni = annotazioni(&doc);
    assert_eq!(annotazioni[0].len(), 2);
    assert!(annotazioni[1].is_empty() && annotazioni[2].is_empty());

    let fuori = &annotazioni[0][0];
    assert_eq!(fuori.get(b"Subtype").unwrap().as_name().unwrap(), b"Link");
    // Il riquadro in punti, con la `y` dal basso: la pagina è alta 300 px.
    assert_eq!(
        numeri(fuori.get(b"Rect").unwrap()),
        vec![15.0, 192.0, 90.0, 202.5]
    );
    let azione = fuori.get(b"A").unwrap().as_dict().unwrap();
    assert_eq!(azione.get(b"S").unwrap().as_name().unwrap(), b"URI");
    assert_eq!(
        azione.get(b"URI").unwrap().as_str().unwrap(),
        b"https://fub.example/%C3%A0ncora?a=1%20b"
    );

    let dentro = &annotazioni[0][1];
    let azione = dentro.get(b"A").unwrap().as_dict().unwrap();
    assert_eq!(azione.get(b"S").unwrap().as_name().unwrap(), b"GoTo");
    let d = azione.get(b"D").unwrap().as_array().unwrap();
    assert_eq!(d[0].as_reference().unwrap(), pagine[2]);
    assert_eq!(d[1].as_name().unwrap(), b"XYZ");
    assert_eq!(d[3].as_float().unwrap(), 225.0 - 75.0);
}

#[test]
fn pdf_export_un_indirizzo_che_il_pdf_non_deve_aprire_resta_testo() {
    let mut e = una_pagina(1);
    e.pagine[0].collegamenti = ["javascript:alert(1)", "file:///etc/passwd", "fub://nota"]
        .iter()
        .map(|url| Collegamento {
            x: 0.0,
            y: 0.0,
            w: 10.0,
            h: 10.0,
            destinazione: Destinazione::Fuori { url: (*url).into() },
        })
        .collect();
    let scritto = scrivi(&e, &Banco::default()).unwrap();
    assert_eq!(scritto.avvisi.len(), 3);
    assert!(scritto
        .avvisi
        .iter()
        .all(|a| matches!(a, Avviso::CollegamentoScartato { .. })));
    assert!(annotazioni(&rileggi(&scritto.pdf))[0].is_empty());
    assert_eq!(lettere(&scritto.pdf), vec!["Pagina0".to_string()]);
    assert_eq!(
        indirizzo_ammesso("MAILTO:ada@example.org").as_deref(),
        Some("mailto:ada@example.org")
    );
    assert_eq!(indirizzo_ammesso("https:"), None);
}

#[test]
fn pdf_export_i_collegamenti_e_i_segnalibri_rotti_hanno_il_loro_errore() {
    let mut e = una_pagina(2);
    e.pagine[1].collegamenti = vec![Collegamento {
        x: 0.0,
        y: 0.0,
        w: 10.0,
        h: 10.0,
        destinazione: Destinazione::Dentro { pagina: 2, y: 0.0 },
    }];
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::CollegamentoRotto {
            pagina: 2,
            collegamento: 0
        }
    );
    let mut e = una_pagina(1);
    e.pagine[0].collegamenti = vec![Collegamento {
        x: f64::INFINITY,
        y: 0.0,
        w: 10.0,
        h: 10.0,
        destinazione: Destinazione::Fuori {
            url: "https://a.b".into(),
        },
    }];
    assert!(matches!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::CollegamentoRotto { .. }
    ));
    let mut e = una_pagina(1);
    e.pagine[0].collegamenti = vec![Collegamento {
        x: 0.0,
        y: 0.0,
        w: 1.0,
        h: 1.0,
        destinazione: Destinazione::Fuori {
            url: format!("https://a.b/{}", "x".repeat(MAX_URL_BYTE)),
        },
    }];
    assert!(matches!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::CollegamentoRotto { .. }
    ));
    let mut e = una_pagina(1);
    e.pagine[0].collegamenti = (0..=MAX_COLLEGAMENTI_PAGINA)
        .map(|_| Collegamento {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
            destinazione: Destinazione::Dentro { pagina: 0, y: 0.0 },
        })
        .collect();
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::TroppiCollegamenti { pagina: 1 }
    );
    for rotto in [
        Segnalibro {
            titolo: "Zero".into(),
            livello: 0,
            pagina: 0,
            y: 0.0,
        },
        Segnalibro {
            titolo: "Troppo giù".into(),
            livello: MAX_LIVELLO_SEGNALIBRO + 1,
            pagina: 0,
            y: 0.0,
        },
        Segnalibro {
            titolo: "Nessuna pagina".into(),
            livello: 1,
            pagina: 1,
            y: 0.0,
        },
    ] {
        let mut e = una_pagina(1);
        e.segnalibri = vec![rotto];
        assert_eq!(
            scrivi(&e, &Banco::default()).unwrap_err(),
            ErroreEsportazione::SegnalibroRotto { segnalibro: 0 }
        );
    }
    let mut e = una_pagina(1);
    e.autore = "a".repeat(MAX_TESTO_DATI + 1);
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::DatiTroppoLunghi
    );
}

/// Un controllo che annulla quando la pagina `alla` sta per cominciare, e
/// tiene il conto di ciò che ha visto.
struct Annulla {
    alla: usize,
    visti: Vec<(usize, usize)>,
}

impl Controllo for Annulla {
    fn continua(&mut self, fatte: usize, pagine: usize) -> Result<(), Interruzione> {
        self.visti.push((fatte, pagine));
        if fatte == self.alla {
            return Err(Interruzione::Annullato);
        }
        Ok(())
    }
}

#[test]
fn pdf_export_annullare_a_meta_ferma_la_scrittura_senza_un_pdf() {
    let e = una_pagina(3);
    let mut controllo = Annulla {
        alla: 1,
        visti: Vec::new(),
    };
    let errore = scrivi_con(&e, &Banco::default(), &Opzioni::default(), &mut controllo)
        .expect_err("annullato non dà un PDF");
    assert_eq!(errore, ErroreEsportazione::Annullato);
    assert_eq!(controllo.visti, vec![(0, 3), (1, 3)]);
}

#[test]
fn pdf_export_il_controllo_si_chiede_a_ogni_pagina_e_alla_fine() {
    let e = una_pagina(3);
    let mut controllo = Annulla {
        alla: usize::MAX,
        visti: Vec::new(),
    };
    let scritto = scrivi_con(&e, &Banco::default(), &Opzioni::default(), &mut controllo).unwrap();
    assert_eq!(controllo.visti, vec![(0, 3), (1, 3), (2, 3), (3, 3)]);
    assert_eq!(lettere(&scritto.pdf).len(), 3);
}

#[test]
fn pdf_export_il_tempo_scaduto_e_il_suo_errore() {
    struct Scaduto;
    impl Controllo for Scaduto {
        fn continua(&mut self, _: usize, _: usize) -> Result<(), Interruzione> {
            Err(Interruzione::TempoScaduto { secondi: 600 })
        }
    }
    assert_eq!(
        scrivi_con(
            &una_pagina(1),
            &Banco::default(),
            &Opzioni::default(),
            &mut Scaduto
        )
        .unwrap_err(),
        ErroreEsportazione::TempoScaduto { secondi: 600 }
    );
}

#[test]
fn pdf_export_un_collegamento_a_una_pagina_dopo_si_ridisegna() {
    // `hayro` rilegge il PDF coi collegamenti e i segnalibri, e la pagina ha
    // il suo testo.
    let mut e = una_pagina(2);
    e.pagine[0].collegamenti = vec![Collegamento {
        x: 20.0,
        y: 30.0,
        w: 60.0,
        h: 14.0,
        destinazione: Destinazione::Dentro { pagina: 1, y: 0.0 },
    }];
    e.segnalibri = vec![Segnalibro {
        titolo: "Due".into(),
        livello: 1,
        pagina: 1,
        y: 0.0,
    }];
    let scritto = scrivi(&e, &Banco::default()).unwrap();
    let img = ridisegna(&scritto.pdf, 1);
    assert_eq!((img.0, img.1), (400, 300));
    assert!(super::tests::inchiostro(&img, 15, 25, 120, 45) > 20);
}
