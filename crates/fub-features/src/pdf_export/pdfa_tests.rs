//! Le prove del PDF/A: il profilo di colore letto byte per byte, i metadati
//! XMP uguali al dizionario `Info`, l'identificativo del file, le annotazioni
//! stampabili, e ciò che il PDF/A non permette, detto senza scrivere il PDF.

use lopdf::{Dictionary, Document, Object};

use super::pdfa::{impronta, profilo_srgb, xmp};
use super::tests::{elenco, faccia, ridisegna, testo, Banco, NEWSREADER};
use super::*;

struct Sempre;

impl Controllo for Sempre {
    fn continua(&mut self, _: usize, _: usize) -> Result<(), Interruzione> {
        Ok(())
    }
}

fn pdfa() -> Opzioni {
    Opzioni {
        pdfa: true,
        ..Opzioni::default()
    }
}

fn scrivi_pdfa(e: &ElencoPagine) -> Result<Scritto, ErroreEsportazione> {
    scrivi_con(e, &Banco::default(), &pdfa(), &mut Sempre)
}

fn u32_a(p: &[u8], i: usize) -> u32 {
    u32::from_be_bytes(p[i..i + 4].try_into().unwrap())
}

fn s15f16_a(p: &[u8], i: usize) -> f64 {
    f64::from(u32_a(p, i) as i32) / 65536.0
}

fn catalogo(doc: &Document) -> &Dictionary {
    let r = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    doc.get_dictionary(r).unwrap()
}

fn una_nota() -> ElencoPagine {
    let mut e = elenco(
        vec![faccia("Newsreader Variable", NEWSREADER, &[])],
        vec![vec![testo(20.0, 40.0, 0, 14.0, "Archivio", 8.0)]],
    );
    e.titolo = "Relazione <finale> & \"bozza\"".into();
    e.autore = "Ada Lovelace".into();
    e.lingua = "it".into();
    e.pagine[0].collegamenti.push(Collegamento {
        x: 20.0,
        y: 28.0,
        w: 64.0,
        h: 16.0,
        destinazione: Destinazione::Fuori {
            url: "https://fub.example/".into(),
        },
        nodo: None,
    });
    e
}

#[test]
fn pdf_export_il_profilo_srgb_e_un_icc_della_versione_2_ben_formato() {
    let p = profilo_srgb();
    assert_eq!(p, profilo_srgb(), "sempre gli stessi byte");
    assert_eq!(
        u32_a(&p, 0) as usize,
        p.len(),
        "la misura nell'intestazione"
    );
    assert_eq!(&p[8..12], &[2, 0x10, 0, 0], "la versione 2.1");
    assert_eq!(&p[12..16], b"mntr");
    assert_eq!(&p[16..20], b"RGB ");
    assert_eq!(&p[20..24], b"XYZ ");
    assert_eq!(&p[36..40], b"acsp");
    // L'illuminante dello spazio di connessione è il D50.
    assert!((s15f16_a(&p, 68) - 0.9642).abs() < 1e-4);
    assert!((s15f16_a(&p, 72) - 1.0).abs() < 1e-4);
    assert!((s15f16_a(&p, 76) - 0.8249).abs() < 1e-4);

    // La tabella dei tag: ogni tag dentro il profilo, allineato a 4, col tipo
    // giusto.
    let voci = u32_a(&p, 128) as usize;
    let mut tag = std::collections::BTreeMap::new();
    for v in 0..voci {
        let i = 132 + v * 12;
        let firma = String::from_utf8(p[i..i + 4].to_vec()).unwrap();
        let (dove, quanto) = (u32_a(&p, i + 4) as usize, u32_a(&p, i + 8) as usize);
        assert!(dove + quanto <= p.len(), "{firma} sta nel profilo");
        assert_eq!(dove % 4, 0, "{firma} allineato");
        tag.insert(firma, (dove, quanto));
    }
    let tipo = |firma: &str| {
        let (dove, _) = tag[firma];
        String::from_utf8(p[dove..dove + 4].to_vec()).unwrap()
    };
    for (firma, atteso) in [
        ("desc", "desc"),
        ("cprt", "text"),
        ("wtpt", "XYZ "),
        ("rXYZ", "XYZ "),
        ("gXYZ", "XYZ "),
        ("bXYZ", "XYZ "),
        ("rTRC", "curv"),
        ("gTRC", "curv"),
        ("bTRC", "curv"),
    ] {
        assert_eq!(tipo(firma), atteso, "il tipo di {firma}");
    }
    assert_eq!(tag.len(), 9);

    // I tre primari sommati danno il bianco del D50: la matrice è quella di
    // un profilo a matrice, adattata come vuole l'ICC.
    let mut somma = [0.0; 3];
    for firma in ["rXYZ", "gXYZ", "bXYZ"] {
        let (dove, _) = tag[firma];
        for (k, s) in somma.iter_mut().enumerate() {
            *s += s15f16_a(&p, dove + 8 + 4 * k);
        }
    }
    for (s, d50) in somma.iter().zip([0.9642, 1.0, 0.8249]) {
        assert!((s - d50).abs() < 2e-3, "{somma:?}");
    }

    // La descrizione dice che profilo è, e la curva va da 0 a 1 senza mai
    // scendere, col tratto lineare dello sRGB in basso.
    let (dove, _) = tag["desc"];
    let n = u32_a(&p, dove + 8) as usize;
    assert_eq!(&p[dove + 12..dove + 12 + n], b"sRGB IEC61966-2.1\0");
    let (dove, quanto) = tag["rTRC"];
    let punti = u32_a(&p, dove + 8) as usize;
    assert_eq!(quanto, 12 + 2 * punti);
    let curva: Vec<u16> = (0..punti)
        .map(|i| u16::from_be_bytes([p[dove + 12 + 2 * i], p[dove + 13 + 2 * i]]))
        .collect();
    assert_eq!(curva[0], 0);
    assert_eq!(*curva.last().unwrap(), u16::MAX);
    assert!(curva.windows(2).all(|w| w[0] <= w[1]));
    // A metà, lo sRGB vale circa 0,214.
    let meta = f64::from(curva[punti / 2]) / 65535.0;
    assert!((meta - 0.2147).abs() < 2e-3, "{meta}");
    assert_eq!(tag["rTRC"], tag["gTRC"]);
    assert_eq!(tag["rTRC"], tag["bTRC"]);
}

#[test]
fn pdf_export_l_xmp_dice_titolo_autore_e_pdfa_in_xml_pulito() {
    let x = xmp("A <b> & \"c\"\u{1}", "Ada", Some("it"), true);
    assert!(x.starts_with("<?xpacket begin=\"\u{FEFF}\""));
    assert!(x.ends_with("<?xpacket end=\"w\"?>"));
    assert!(x.contains(&format!(
        "<rdf:li xml:lang=\"x-default\">{}</rdf:li>",
        fub_abi::html::escape("A <b> & \"c\"")
    )));
    assert!(x.contains("<dc:creator><rdf:Seq><rdf:li>Ada</rdf:li></rdf:Seq></dc:creator>"));
    assert!(x.contains("<rdf:li>it</rdf:li>"));
    assert!(x.contains("<pdfaid:part>2</pdfaid:part>"));
    assert!(x.contains("<pdfaid:conformance>B</pdfaid:conformance>"));
    assert!(x.contains("<pdf:Producer>Fub</pdf:Producer>"));
    assert!(x.contains("<xmp:CreatorTool>Fub</xmp:CreatorTool>"));
    // Il PDF accessibile senza PDF/A: i metadati sì, l'identificazione no.
    let solo = xmp("T", "", None, false);
    assert!(!solo.contains("pdfaid"));
    assert!(!solo.contains("dc:creator"));
    assert!(!solo.contains("dc:language"));
}

#[test]
fn pdf_export_il_pdfa_porta_profilo_metadati_e_identificativo() {
    let e = una_nota();
    let scritto = scrivi_pdfa(&e).expect("il PDF/A si scrive");
    assert!(scritto.avvisi.is_empty(), "{:?}", scritto.avvisi);
    assert_eq!(
        scritto.pdf,
        scrivi_pdfa(&e).unwrap().pdf,
        "lo stesso elenco, gli stessi byte"
    );
    let doc = Document::load_mem(&scritto.pdf).unwrap();
    let cat = catalogo(&doc);

    // L'OutputIntent col profilo sRGB, a tre componenti.
    let intenti = cat.get(b"OutputIntents").unwrap().as_array().unwrap();
    assert_eq!(intenti.len(), 1);
    let intento = intenti[0].as_dict().unwrap();
    assert_eq!(intento.get(b"S").unwrap().as_name().unwrap(), b"GTS_PDFA1");
    let profilo = doc
        .get_object(
            intento
                .get(b"DestOutputProfile")
                .unwrap()
                .as_reference()
                .unwrap(),
        )
        .unwrap()
        .as_stream()
        .unwrap();
    assert_eq!(profilo.dict.get(b"N").unwrap().as_i64().unwrap(), 3);
    assert_eq!(profilo.decompressed_content().unwrap(), profilo_srgb());

    // I metadati in chiaro, con gli stessi titolo e autore di `Info`.
    let metadati = doc
        .get_object(cat.get(b"Metadata").unwrap().as_reference().unwrap())
        .unwrap()
        .as_stream()
        .unwrap();
    assert!(metadati.dict.get(b"Filter").is_err(), "in chiaro");
    let xml = String::from_utf8(metadati.content.clone()).unwrap();
    assert!(xml.contains(&fub_abi::html::escape("Relazione <finale> & \"bozza\"")));
    assert!(xml.contains("<rdf:li>Ada Lovelace</rdf:li>"));
    let info = doc
        .get_dictionary(doc.trailer.get(b"Info").unwrap().as_reference().unwrap())
        .unwrap();
    assert_eq!(
        lopdf::decode_text_string(info.get(b"Title").unwrap()).unwrap(),
        "Relazione <finale> & \"bozza\""
    );

    // L'identificativo: due volte l'impronta dell'elenco.
    let id = doc.trailer.get(b"ID").unwrap().as_array().unwrap();
    let atteso = impronta(&e);
    assert_eq!(id[0].as_str().unwrap(), atteso.as_slice());
    assert_eq!(id[1].as_str().unwrap(), atteso.as_slice());

    // Il collegamento si stampa.
    let pagina = *doc.get_pages().values().next().unwrap();
    let annot = doc
        .get_dictionary(
            doc.get_dictionary(pagina)
                .unwrap()
                .get(b"Annots")
                .unwrap()
                .as_array()
                .unwrap()[0]
                .as_reference()
                .unwrap(),
        )
        .unwrap();
    assert_eq!(annot.get(b"F").unwrap().as_i64().unwrap(), 4);

    // E si ridisegna come prima.
    let img = ridisegna(&scritto.pdf, 0);
    assert!(super::tests::inchiostro(&img, 20, 28, 80, 44) > 20);
}

#[test]
fn pdf_export_senza_pdfa_niente_profilo_e_niente_identificativo() {
    let scritto = scrivi(&una_nota(), &Banco::default()).unwrap();
    let doc = Document::load_mem(&scritto.pdf).unwrap();
    let cat = catalogo(&doc);
    assert!(cat.get(b"OutputIntents").is_err());
    assert!(cat.get(b"Metadata").is_err());
    assert!(doc.trailer.get(b"ID").is_err());
}

#[test]
fn pdf_export_nel_pdfa_il_titolo_perde_i_caratteri_che_l_xml_non_ammette() {
    let mut e = una_nota();
    e.titolo = "Uno\u{7}due".into();
    let doc = Document::load_mem(&scrivi_pdfa(&e).unwrap().pdf).unwrap();
    let info = doc
        .get_dictionary(doc.trailer.get(b"Info").unwrap().as_reference().unwrap())
        .unwrap();
    assert_eq!(
        lopdf::decode_text_string(info.get(b"Title").unwrap()).unwrap(),
        "Unodue"
    );
}

#[test]
fn pdf_export_le_lettere_senza_glifo_fermano_il_pdfa_prima_del_file() {
    // Newsreader e Literata sono latini: l'ideogramma non c'è, e nemmeno lo
    // spazio ideografico, che senza PDF/A uscirebbe muto col glifo vuoto.
    let e = elenco(
        vec![faccia("Newsreader Variable", NEWSREADER, &[])],
        vec![vec![testo(10.0, 40.0, 0, 16.0, "a中\u{3000}b", 9.0)]],
    );
    let senza = scrivi(&e, &Banco::default()).expect("senza PDF/A si scrive");
    assert_eq!(
        senza.avvisi,
        vec![Avviso::LettereMancanti {
            famiglia: "Newsreader Variable".into(),
            lettere: "中".into()
        }]
    );
    let errore = scrivi_pdfa(&e).expect_err("il PDF/A non ammette il glifo vuoto");
    assert_eq!(
        errore,
        ErroreEsportazione::PdfaNonPossibile {
            ostacoli: vec![OstacoloPdfa::LettereSenzaGlifo {
                famiglia: "Newsreader Variable".into(),
                lettere: "\u{3000}中".into()
            }]
        }
    );
}

#[test]
fn pdf_export_un_vettore_che_non_sta_nel_pdfa_e_un_ostacolo_con_la_sua_pagina() {
    // Un'etichetta di diagramma con una lettera che i caratteri di Fub non
    // hanno: `svg2pdf` in PDF/A la rifiuta.
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50" viewBox="0 0 200 50"><text x="10" y="35" font-family="Literata" font-size="24" fill="#000">中</text></svg>"##;
    let vettore = Pezzo::Vettore {
        x: 0.0,
        y: 0.0,
        w: 200.0,
        h: 50.0,
        svg: svg.into(),
        nodo: None,
    };
    let e = elenco(vec![], vec![vec![], vec![vettore]]);
    let errore = scrivi_pdfa(&e).expect_err("il vettore non sta nel PDF/A");
    match errore {
        ErroreEsportazione::PdfaNonPossibile { ostacoli } => {
            assert!(
                matches!(
                    ostacoli.as_slice(),
                    [OstacoloPdfa::VettoreNonConforme { pagina: 2, .. }]
                ),
                "{ostacoli:?}"
            );
        }
        altro => panic!("{altro:?}"),
    }
}

#[test]
fn pdf_export_il_pdf_accessibile_porta_i_metadati_anche_senza_pdfa() {
    let mut e = una_nota();
    e.struttura = vec![Nodo {
        specie: Specie::Paragrafo,
        genitore: None,
        livello: None,
        alt: String::new(),
        lingua: String::new(),
        ambito: None,
        numerato: None,
    }];
    if let Pezzo::Testo { nodo, .. } = &mut e.pagine[0].pezzi[0] {
        *nodo = Some(0);
    }
    let opzioni = Opzioni {
        accessibile: true,
        ..Opzioni::default()
    };
    let scritto = scrivi_con(&e, &Banco::default(), &opzioni, &mut Sempre).unwrap();
    let doc = Document::load_mem(&scritto.pdf).unwrap();
    let cat = catalogo(&doc);
    let metadati = doc
        .get_object(cat.get(b"Metadata").unwrap().as_reference().unwrap())
        .unwrap()
        .as_stream()
        .unwrap();
    let xml = String::from_utf8(metadati.content.clone()).unwrap();
    assert!(xml.contains("<dc:title>"));
    assert!(!xml.contains("pdfaid"));
    assert!(cat.get(b"OutputIntents").is_err());
    assert!(matches!(
        cat.get(b"ViewerPreferences"),
        Ok(Object::Dictionary(_)) | Ok(Object::Reference(_))
    ));
}
