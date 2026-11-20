//! Le prove dei tag del PDF accessibile: l'albero della struttura com'è nel
//! file (riletto con `lopdf`), l'ordine di lettura, gli artefatti, i
//! collegamenti nella struttura, gli avvisi e gli elenchi rotti.

use std::collections::BTreeMap;

use lopdf::content::Content;
use lopdf::{Dictionary, Document, Object, ObjectId};

use super::tags::per_le_prove::fila;
use super::tests::{elenco, faccia, testo, Banco, NEWSREADER};
use super::*;

fn nodo(specie: Specie, genitore: Option<usize>) -> Nodo {
    Nodo {
        specie,
        genitore,
        livello: None,
        alt: String::new(),
        lingua: String::new(),
        ambito: None,
        numerato: None,
    }
}

fn titolo(livello: u8) -> Nodo {
    Nodo {
        livello: Some(livello),
        ..nodo(Specie::Titolo, None)
    }
}

fn con_nodo(mut pezzo: Pezzo, n: usize) -> Pezzo {
    match &mut pezzo {
        Pezzo::Testo { nodo, .. } | Pezzo::Vettore { nodo, .. } | Pezzo::Immagine { nodo, .. } => {
            *nodo = Some(n)
        }
        Pezzo::Riquadro { .. } => panic!("un riquadro non ha nodo"),
    }
    pezzo
}

fn accessibile() -> Opzioni {
    Opzioni {
        accessibile: true,
        ..Opzioni::default()
    }
}

struct Sempre;

impl Controllo for Sempre {
    fn continua(&mut self, _: usize, _: usize) -> Result<(), Interruzione> {
        Ok(())
    }
}

fn scrivi_accessibile(e: &ElencoPagine) -> Scritto {
    scrivi_con(e, &Banco::default(), &accessibile(), &mut Sempre).expect("il PDF si scrive")
}

const DIAGRAMMA: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40"><rect x="5" y="5" width="90" height="30" fill="#36c"/></svg>"##;

/// Una nota con un po' di tutto: un titolo, un paragrafo con un
/// collegamento, un elenco, una tabella con l'intestazione, un diagramma col
/// suo testo alternativo, e il numero di pagina che è un artefatto.
fn nota() -> ElencoPagine {
    let struttura = vec![
        titolo(1),                           // 0
        nodo(Specie::Paragrafo, None),       // 1
        nodo(Specie::Collegamento, Some(1)), // 2
        Nodo {
            numerato: Some(true),
            ..nodo(Specie::Elenco, None) // 3
        },
        nodo(Specie::Voce, Some(3)),         // 4
        nodo(Specie::Etichetta, Some(4)),    // 5
        nodo(Specie::CorpoVoce, Some(4)),    // 6
        nodo(Specie::Tabella, None),         // 7
        nodo(Specie::Riga, Some(7)),         // 8
        nodo(Specie::Intestazione, Some(8)), // 9
        nodo(Specie::Riga, Some(7)),         // 10
        nodo(Specie::Cella, Some(10)),       // 11
        Nodo {
            alt: "Il flusso: dalla nota al PDF".into(),
            ..nodo(Specie::Figura, None) // 12
        },
    ];
    let pezzi = vec![
        con_nodo(testo(20.0, 30.0, 0, 18.0, "Relazione", 10.0), 0),
        con_nodo(testo(20.0, 60.0, 0, 12.0, "Vedi", 7.0), 1),
        con_nodo(testo(52.0, 60.0, 0, 12.0, "sito", 7.0), 2),
        con_nodo(testo(84.0, 60.0, 0, 12.0, "oggi.", 7.0), 1),
        con_nodo(testo(20.0, 90.0, 0, 12.0, "1.", 7.0), 5),
        con_nodo(testo(40.0, 90.0, 0, 12.0, "Primo", 7.0), 6),
        con_nodo(testo(20.0, 120.0, 0, 12.0, "Nome", 7.0), 9),
        Pezzo::Riquadro {
            x: 20.0,
            y: 124.0,
            w: 100.0,
            h: 1.0,
            colore: [0.0, 0.0, 0.0, 1.0],
        },
        con_nodo(testo(20.0, 140.0, 0, 12.0, "Ada", 7.0), 11),
        con_nodo(
            Pezzo::Vettore {
                x: 20.0,
                y: 160.0,
                w: 100.0,
                h: 40.0,
                svg: DIAGRAMMA.into(),
                nodo: None,
            },
            12,
        ),
        testo(180.0, 280.0, 0, 9.0, "1", 6.0),
    ];
    let mut e = elenco(
        vec![faccia("Newsreader Variable", NEWSREADER, &[])],
        vec![pezzi],
    );
    e.lingua = "it".into();
    e.pagine[0].collegamenti.push(Collegamento {
        x: 52.0,
        y: 50.0,
        w: 28.0,
        h: 14.0,
        destinazione: Destinazione::Fuori {
            url: "https://fub.example/".into(),
        },
        nodo: Some(2),
    });
    e.struttura = struttura;
    e
}

fn rileggi(pdf: &[u8]) -> Document {
    Document::load_mem(pdf).expect("il PDF si rilegge")
}

fn catalogo(doc: &Document) -> &Dictionary {
    let r = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    doc.get_dictionary(r).unwrap()
}

fn dizionario<'a>(doc: &'a Document, o: &'a Object) -> &'a Dictionary {
    match o {
        Object::Reference(r) => doc.get_dictionary(*r).unwrap(),
        Object::Dictionary(d) => d,
        other => panic!("non è un dizionario: {other:?}"),
    }
}

fn nome(d: &Dictionary, k: &[u8]) -> String {
    String::from_utf8_lossy(d.get(k).unwrap().as_name().unwrap()).into_owned()
}

/// Un elemento della struttura come lo legge la prova: il suo tag, la sua
/// profondità e ciò che contiene.
#[derive(Debug)]
struct Elemento {
    tag: String,
    profondita: usize,
    id: ObjectId,
    /// Gli `MCID` delle sue sequenze, con la loro pagina.
    sequenze: Vec<(ObjectId, i64)>,
    /// Le annotazioni che contiene (`OBJR`).
    oggetti: Vec<ObjectId>,
}

/// L'albero della struttura in ordine di lettura, dal documento in giù.
fn albero(doc: &Document) -> Vec<Elemento> {
    let radice = catalogo(doc)
        .get(b"StructTreeRoot")
        .unwrap()
        .as_reference()
        .unwrap();
    let radice_d = doc.get_dictionary(radice).unwrap();
    assert_eq!(nome(radice_d, b"Type"), "StructTreeRoot");
    let mut fuori = Vec::new();
    let k = radice_d.get(b"K").unwrap().as_reference().unwrap();
    visita(doc, k, radice, 0, &mut fuori);
    fuori
}

fn visita(
    doc: &Document,
    id: ObjectId,
    genitore: ObjectId,
    profondita: usize,
    fuori: &mut Vec<Elemento>,
) {
    let d = doc.get_dictionary(id).unwrap();
    assert_eq!(nome(d, b"Type"), "StructElem");
    assert_eq!(
        d.get(b"P").unwrap().as_reference().unwrap(),
        genitore,
        "ogni elemento nomina il suo genitore"
    );
    let posto = fuori.len();
    fuori.push(Elemento {
        tag: nome(d, b"S"),
        profondita,
        id,
        sequenze: Vec::new(),
        oggetti: Vec::new(),
    });
    let figli = match d.get(b"K") {
        Ok(Object::Array(figli)) => figli.clone(),
        Ok(altro) => vec![altro.clone()],
        Err(_) => Vec::new(),
    };
    for figlio in figli {
        match &figlio {
            Object::Reference(r) => {
                let fd = doc.get_dictionary(*r).unwrap();
                match nome(fd, b"Type").as_str() {
                    "StructElem" => visita(doc, *r, id, profondita + 1, fuori),
                    "OBJR" => unreachable!("un OBJR non è indiretto"),
                    altro => panic!("figlio sconosciuto {altro}"),
                }
            }
            Object::Dictionary(fd) => match nome(fd, b"Type").as_str() {
                "MCR" => {
                    let pagina = fd.get(b"Pg").unwrap().as_reference().unwrap();
                    let mcid = fd.get(b"MCID").unwrap().as_i64().unwrap();
                    fuori[posto].sequenze.push((pagina, mcid));
                }
                "OBJR" => {
                    let obj = fd.get(b"Obj").unwrap().as_reference().unwrap();
                    fuori[posto].oggetti.push(obj);
                }
                altro => panic!("figlio sconosciuto {altro}"),
            },
            altro => panic!("figlio sconosciuto {altro:?}"),
        }
    }
}

/// Le sequenze della pagina: per ogni `MCID` il tag con cui si apre, e quanti
/// artefatti ci sono. Ogni operatore che disegna sta dentro l'una o l'altro.
fn sequenze(doc: &Document, pagina: ObjectId) -> (BTreeMap<i64, String>, usize) {
    let contenuto = Content::decode(&doc.get_page_content(pagina)).unwrap();
    let mut mcid = BTreeMap::new();
    let mut artefatti = 0;
    let mut aperte: Vec<bool> = Vec::new();
    for op in &contenuto.operations {
        match op.operator.as_str() {
            "BDC" => {
                let tag = String::from_utf8_lossy(op.operands[0].as_name().unwrap()).into_owned();
                let props = op.operands[1].as_dict().unwrap();
                let id = props.get(b"MCID").unwrap().as_i64().unwrap();
                assert!(mcid.insert(id, tag).is_none(), "un MCID una volta sola");
                aperte.push(true);
            }
            "BMC" => {
                assert_eq!(op.operands[0].as_name().unwrap(), b"Artifact");
                artefatti += 1;
                aperte.push(true);
            }
            "EMC" => {
                aperte.pop().expect("ogni EMC chiude una sequenza");
            }
            "Tj" | "TJ" | "Do" | "f" => {
                assert!(
                    !aperte.is_empty(),
                    "«{}» fuori da ogni sequenza",
                    op.operator
                );
            }
            _ => {}
        }
    }
    assert!(aperte.is_empty(), "ogni sequenza si chiude");
    (mcid, artefatti)
}

#[test]
fn pdf_export_l_ordine_dei_figli_infila_il_contenuto_fra_i_nodi() {
    // Un paragrafo: «Vedi» (passo 1), il collegamento (nodo 2, dal passo 2),
    // «oggi.» (passo 3).
    assert_eq!(
        fila(&[(1, 0, 0), (3, 0, 2)], &[2], &[None, None, Some(2)]),
        vec!["S0.0", "N2", "S0.2"]
    );
    // Un figlio vuoto non tira avanti il contenuto che viene dopo di lui.
    assert_eq!(
        fila(&[(5, 0, 0)], &[1, 2], &[None, None, Some(9)]),
        vec!["N1", "S0.0", "N2"]
    );
    // I figli restano nell'ordine della vista anche se la pagina li disegna
    // al contrario: l'ordine di lettura è quello della struttura.
    assert_eq!(
        fila(&[], &[1, 2], &[None, Some(7), Some(3)]),
        vec!["N1", "N2"]
    );
}

#[test]
fn pdf_export_la_struttura_dei_tag_segue_la_nota() {
    let scritto = scrivi_accessibile(&nota());
    assert!(scritto.avvisi.is_empty(), "{:?}", scritto.avvisi);
    let doc = rileggi(&scritto.pdf);
    let cat = catalogo(&doc);
    let marcato = dizionario(&doc, cat.get(b"MarkInfo").unwrap());
    assert!(marcato.get(b"Marked").unwrap().as_bool().unwrap());
    assert_eq!(
        lopdf::decode_text_string(cat.get(b"Lang").unwrap()).unwrap(),
        "it"
    );

    let el = albero(&doc);
    let forma: Vec<(usize, &str)> = el.iter().map(|e| (e.profondita, e.tag.as_str())).collect();
    assert_eq!(
        forma,
        vec![
            (0, "Document"),
            (1, "H1"),
            (1, "P"),
            (2, "Link"),
            (1, "L"),
            (2, "LI"),
            (3, "Lbl"),
            (3, "LBody"),
            (1, "Table"),
            (2, "TR"),
            (3, "TH"),
            (2, "TR"),
            (3, "TD"),
            (1, "Figure"),
        ]
    );

    // Il testo del paragrafo prima e dopo il collegamento, nell'ordine della
    // pagina: «Vedi», il collegamento, «oggi.».
    let p = doc.get_dictionary(el[2].id).unwrap();
    let figli = p.get(b"K").unwrap().as_array().unwrap();
    assert_eq!(figli.len(), 3);
    assert!(figli[0].as_dict().is_ok(), "prima una sequenza");
    assert_eq!(figli[1].as_reference().unwrap(), el[3].id);
    assert!(figli[2].as_dict().is_ok(), "poi un'altra");

    // Gli attributi: l'elenco numerato, l'ambito dell'intestazione, il testo
    // alternativo della figura.
    let attributi = |id: ObjectId| -> Dictionary {
        let d = doc.get_dictionary(id).unwrap();
        d.get(b"A").unwrap().as_array().unwrap()[0]
            .as_dict()
            .unwrap()
            .clone()
    };
    let l = attributi(el[4].id);
    assert_eq!(nome(&l, b"O"), "List");
    assert_eq!(nome(&l, b"ListNumbering"), "Decimal");
    let th = attributi(el[10].id);
    assert_eq!(nome(&th, b"O"), "Table");
    assert_eq!(nome(&th, b"Scope"), "Column");
    let figura = doc.get_dictionary(el[13].id).unwrap();
    assert_eq!(
        lopdf::decode_text_string(figura.get(b"Alt").unwrap()).unwrap(),
        "Il flusso: dalla nota al PDF"
    );

    // Ogni sequenza della pagina sta nella struttura, col tag del suo
    // elemento; il riquadro e il numero di pagina sono artefatti.
    let pagina = *doc.get_pages().values().next().unwrap();
    let (mcid, artefatti) = sequenze(&doc, pagina);
    assert_eq!(artefatti, 2, "il filo della tabella e il numero di pagina");
    let mut nella_struttura: BTreeMap<i64, String> = BTreeMap::new();
    for e in &el {
        for (pg, id) in &e.sequenze {
            assert_eq!(*pg, pagina);
            nella_struttura.insert(*id, e.tag.clone());
        }
    }
    assert_eq!(mcid, nella_struttura);
    assert_eq!(mcid.len(), 9);

    // Il `ParentTree` riporta ogni MCID al suo elemento.
    let pagina_d = doc.get_dictionary(pagina).unwrap();
    assert_eq!(pagina_d.get(b"StructParents").unwrap().as_i64().unwrap(), 0);
    assert_eq!(nome(pagina_d, b"Tabs"), "S");
    let radice = dizionario(&doc, cat.get(b"StructTreeRoot").unwrap());
    let alberello = dizionario(&doc, radice.get(b"ParentTree").unwrap());
    let nums = alberello.get(b"Nums").unwrap().as_array().unwrap();
    assert_eq!(nums[0].as_i64().unwrap(), 0);
    let della_pagina = doc
        .get_object(nums[1].as_reference().unwrap())
        .unwrap()
        .as_array()
        .unwrap();
    assert_eq!(della_pagina.len(), mcid.len());
    for (id, elem) in della_pagina.iter().enumerate() {
        let e = el
            .iter()
            .find(|e| e.id == elem.as_reference().unwrap())
            .expect("un elemento dell'albero");
        assert!(e.sequenze.iter().any(|(_, m)| *m == id as i64));
    }

    // Il collegamento: l'annotazione sta nel suo elemento `Link`, porta la
    // chiave del `ParentTree` e dice dove porta.
    let annot_id = pagina_d.get(b"Annots").unwrap().as_array().unwrap()[0]
        .as_reference()
        .unwrap();
    assert_eq!(el[3].oggetti, vec![annot_id]);
    let annot = doc.get_dictionary(annot_id).unwrap();
    let chiave = annot.get(b"StructParent").unwrap().as_i64().unwrap();
    assert_eq!(chiave, 1, "dopo le chiavi delle pagine");
    assert_eq!(nums[2].as_i64().unwrap(), 1);
    assert_eq!(nums[3].as_reference().unwrap(), el[3].id);
    assert_eq!(
        lopdf::decode_text_string(annot.get(b"Contents").unwrap()).unwrap(),
        "sito",
        "il collegamento dice il suo testo, prima dell'indirizzo"
    );
    assert_eq!(
        radice.get(b"ParentTreeNextKey").unwrap().as_i64().unwrap(),
        2
    );
}

#[test]
fn pdf_export_senza_richiesta_niente_tag_e_senza_struttura_un_avviso() {
    // La struttura c'è ma il PDF accessibile non è chiesto: niente tag.
    let scritto = scrivi(&nota(), &Banco::default()).unwrap();
    let doc = rileggi(&scritto.pdf);
    assert!(catalogo(&doc).get(b"StructTreeRoot").is_err());
    assert!(catalogo(&doc).get(b"MarkInfo").is_err());
    let pagina = *doc.get_pages().values().next().unwrap();
    let contenuto = Content::decode(&doc.get_page_content(pagina)).unwrap();
    assert!(!contenuto
        .operations
        .iter()
        .any(|op| op.operator == "BDC" || op.operator == "BMC"));

    // Chiesto senza struttura: niente tag, e lo dice.
    let mut senza = nota();
    senza.struttura.clear();
    for p in &mut senza.pagine {
        for c in &mut p.collegamenti {
            c.nodo = None;
        }
        for pezzo in &mut p.pezzi {
            if let Pezzo::Testo { nodo, .. } | Pezzo::Vettore { nodo, .. } = pezzo {
                *nodo = None;
            }
        }
    }
    let scritto = scrivi_accessibile(&senza);
    assert_eq!(scritto.avvisi, vec![Avviso::StrutturaMancante]);
    assert!(catalogo(&rileggi(&scritto.pdf))
        .get(b"StructTreeRoot")
        .is_err());
}

#[test]
fn pdf_export_una_figura_senza_alt_e_una_tabella_senza_intestazione_sono_avvisi() {
    let mut e = nota();
    // La figura perde il suo testo alternativo, l'intestazione diventa una
    // cella qualunque, e c'è una formula senza alt in pagina 2.
    e.struttura[12].alt.clear();
    e.struttura[9].specie = Specie::Cella;
    e.struttura.push(nodo(Specie::Formula, None));
    e.pagine.push(Pagina {
        pezzi: vec![con_nodo(
            Pezzo::Vettore {
                x: 20.0,
                y: 20.0,
                w: 100.0,
                h: 40.0,
                svg: DIAGRAMMA.into(),
                nodo: None,
            },
            13,
        )],
        ..Pagina::default()
    });
    let scritto = scrivi_accessibile(&e);
    assert_eq!(
        scritto.avvisi,
        vec![
            Avviso::TabellaSenzaIntestazione {
                nodo: 7,
                pagina: Some(1)
            },
            Avviso::TestoAlternativoMancante {
                nodo: 12,
                pagina: Some(1)
            },
            Avviso::TestoAlternativoMancante {
                nodo: 13,
                pagina: Some(2)
            },
        ]
    );
    // Escono lo stesso: la tabella con le sue celle, la figura senza `Alt`.
    let doc = rileggi(&scritto.pdf);
    let el = albero(&doc);
    assert!(el.iter().any(|e| e.tag == "Table"));
    let figura = el.iter().find(|e| e.tag == "Figure").unwrap();
    assert!(doc.get_dictionary(figura.id).unwrap().get(b"Alt").is_err());
    let formula = el.iter().find(|e| e.tag == "Formula").unwrap();
    let pagine: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    assert_eq!(formula.sequenze, vec![(pagine[1], 0)]);
}

#[test]
fn pdf_export_un_paragrafo_su_due_pagine_e_una_lingua_sua() {
    let struttura = vec![
        nodo(Specie::Paragrafo, None),
        Nodo {
            lingua: "en-GB".into(),
            ..nodo(Specie::Citazione, None)
        },
        Nodo {
            lingua: "non è una lingua".into(),
            ..nodo(Specie::Paragrafo, None)
        },
    ];
    let mut e = elenco(
        vec![faccia("Newsreader Variable", NEWSREADER, &[])],
        vec![
            vec![con_nodo(testo(20.0, 280.0, 0, 12.0, "Inizio", 7.0), 0)],
            vec![
                con_nodo(testo(20.0, 30.0, 0, 12.0, "fine.", 7.0), 0),
                con_nodo(testo(20.0, 60.0, 0, 12.0, "Quote", 7.0), 1),
                con_nodo(testo(20.0, 90.0, 0, 12.0, "Altro", 7.0), 2),
            ],
        ],
    );
    e.struttura = struttura;
    let scritto = scrivi_accessibile(&e);
    assert_eq!(
        scritto.avvisi,
        vec![Avviso::LinguaScartata {
            lingua: "non è una lingua".into()
        }]
    );
    let doc = rileggi(&scritto.pdf);
    let pagine: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    let el = albero(&doc);
    assert_eq!(el[1].sequenze, vec![(pagine[0], 0), (pagine[1], 0)]);
    let citazione = doc.get_dictionary(el[2].id).unwrap();
    assert_eq!(
        lopdf::decode_text_string(citazione.get(b"Lang").unwrap()).unwrap(),
        "en-GB"
    );
    assert!(doc.get_dictionary(el[3].id).unwrap().get(b"Lang").is_err());
    // Ogni pagina ha la sua chiave nel `ParentTree`.
    for (i, p) in pagine.iter().enumerate() {
        let d = doc.get_dictionary(*p).unwrap();
        assert_eq!(d.get(b"StructParents").unwrap().as_i64().unwrap(), i as i64);
        assert!(
            d.get(b"Tabs").is_err(),
            "nessuna annotazione, nessun ordine"
        );
    }
}

#[test]
fn pdf_export_l_ordine_di_lettura_e_quello_della_struttura() {
    // La pagina disegna prima la colonna di destra; la vista dice che si
    // legge prima quella di sinistra.
    let mut e = elenco(
        vec![faccia("Newsreader Variable", NEWSREADER, &[])],
        vec![vec![
            con_nodo(testo(220.0, 30.0, 0, 12.0, "Destra", 7.0), 1),
            con_nodo(testo(20.0, 30.0, 0, 12.0, "Sinistra", 7.0), 0),
        ]],
    );
    e.struttura = vec![nodo(Specie::Paragrafo, None), nodo(Specie::Paragrafo, None)];
    let doc = rileggi(&scrivi_accessibile(&e).pdf);
    let el = albero(&doc);
    // Il primo paragrafo letto è «Sinistra», che la pagina ha disegnato per
    // secondo (MCID 1).
    assert_eq!(el[1].sequenze[0].1, 1);
    assert_eq!(el[2].sequenze[0].1, 0);
}

#[test]
fn pdf_export_le_strutture_rotte_hanno_il_loro_errore() {
    let rotto = |e: ElencoPagine| {
        scrivi_con(&e, &Banco::default(), &accessibile(), &mut Sempre)
            .expect_err("l'elenco è rotto")
    };
    let base = nota();

    let mut e = base.clone();
    e.struttura[1].genitore = Some(1);
    assert_eq!(rotto(e), ErroreEsportazione::NodoRotto { nodo: 1 });

    let mut e = base.clone();
    e.struttura[0].livello = None;
    assert_eq!(rotto(e), ErroreEsportazione::NodoRotto { nodo: 0 });

    let mut e = base.clone();
    e.struttura[0].livello = Some(7);
    assert_eq!(rotto(e), ErroreEsportazione::NodoRotto { nodo: 0 });

    let mut e = base.clone();
    e.struttura[1].livello = Some(2);
    assert_eq!(rotto(e), ErroreEsportazione::NodoRotto { nodo: 1 });

    let mut e = base.clone();
    e.struttura[11].ambito = Some(Ambito::Riga);
    assert_eq!(rotto(e), ErroreEsportazione::NodoRotto { nodo: 11 });

    let mut e = base.clone();
    e.struttura[12].alt = "x".repeat(MAX_TESTO_ALTERNATIVO + 1);
    assert_eq!(rotto(e), ErroreEsportazione::NodoRotto { nodo: 12 });

    let mut e = base.clone();
    e.pagine[0].pezzi[0] = con_nodo(testo(20.0, 30.0, 0, 18.0, "X", 10.0), 99);
    assert_eq!(
        rotto(e),
        ErroreEsportazione::NodoSconosciuto {
            pagina: 1,
            pezzo: 0
        }
    );

    // Un collegamento appartiene solo a un nodo `collegamento`.
    let mut e = base.clone();
    e.pagine[0].collegamenti[0].nodo = Some(1);
    assert_eq!(
        rotto(e),
        ErroreEsportazione::CollegamentoRotto {
            pagina: 1,
            collegamento: 0
        }
    );

    // La struttura si controlla anche quando i tag non si scrivono: un elenco
    // rotto è rotto comunque.
    let mut e = base;
    e.struttura[1].genitore = Some(5);
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::NodoRotto { nodo: 1 }
    );
}

#[test]
fn pdf_export_la_struttura_si_legge_dal_json_della_vista() {
    let json = r#"{
        "versione": 1, "larghezza": 400, "altezza": 300,
        "facce": [{ "famiglia": "Newsreader", "file": "/fonts/newsreader-latin-opsz-normal.woff2" }],
        "struttura": [
            { "specie": "titolo", "livello": 2 },
            { "specie": "tabella" },
            { "specie": "riga", "genitore": 1 },
            { "specie": "intestazione", "genitore": 2, "ambito": "riga" },
            { "specie": "figura", "alt": "Un diagramma", "lingua": "it" },
            { "specie": "elenco", "numerato": false }
        ],
        "pagine": [{
            "pezzi": [
                { "tipo": "testo", "x": 20, "y": 30, "larghezza": 30, "faccia": 0, "corpo": 12,
                  "colore": [0, 0, 0, 1], "testo": "Ciao", "posizioni": [0, 7, 14, 21], "nodo": 0 },
                { "tipo": "immagine", "x": 20, "y": 60, "w": 10, "h": 10, "file": "x.png", "nodo": 4 }
            ],
            "collegamenti": []
        }]
    }"#;
    let e: ElencoPagine = serde_json::from_str(json).unwrap();
    assert_eq!(e.struttura[0].livello, Some(2));
    assert_eq!(e.struttura[3].ambito, Some(Ambito::Riga));
    assert_eq!(e.struttura[4].alt, "Un diagramma");
    assert_eq!(e.struttura[5].numerato, Some(false));
    assert!(matches!(
        e.pagine[0].pezzi[1],
        Pezzo::Immagine { nodo: Some(4), .. }
    ));
    // Una specie che il formato non conosce rende l'elenco illeggibile, come
    // ogni campo sconosciuto.
    let ignota = json.replace("\"tabella\"", "\"lavagna\"");
    assert!(serde_json::from_str::<ElencoPagine>(&ignota).is_err());
    // Un elenco senza struttura si scrive come prima, senza il campo.
    let mut senza = e.clone();
    senza.struttura.clear();
    let scritto = serde_json::to_value(&senza).unwrap();
    assert!(scritto.get("struttura").is_none());
}

#[test]
fn pdf_export_un_collegamento_dice_il_testo_alternativo_poi_il_suo_testo_poi_l_indirizzo() {
    // Quattro collegamenti: col testo alternativo, col testo dentro, verso
    // fuori senza testo, e verso dentro senza niente.
    let struttura = vec![
        nodo(Specie::Paragrafo, None), // 0
        Nodo {
            alt: "La guida".into(),
            ..nodo(Specie::Collegamento, Some(0))
        }, // 1
        nodo(Specie::Collegamento, Some(0)), // 2
        nodo(Specie::Collegamento, Some(0)), // 3
        nodo(Specie::Collegamento, Some(0)), // 4
        nodo(Specie::Testo, Some(2)),  // 5: dentro il 2
    ];
    let mut e = elenco(
        vec![faccia("Newsreader Variable", NEWSREADER, &[])],
        vec![vec![
            con_nodo(testo(20.0, 30.0, 0, 12.0, "Guida", 7.0), 1),
            con_nodo(testo(20.0, 60.0, 0, 12.0, "Il", 7.0), 2),
            con_nodo(testo(40.0, 60.0, 0, 12.0, "manuale", 7.0), 5),
            con_nodo(testo(20.0, 90.0, 0, 12.0, "Altro", 7.0), 0),
        ]],
    );
    let fuori = |url: &str| Destinazione::Fuori { url: url.into() };
    for (i, (nodo, destinazione)) in [
        (1, fuori("https://fub.example/guida")),
        (2, fuori("https://fub.example/manuale")),
        (3, fuori("https://fub.example/nudo")),
        (4, Destinazione::Dentro { pagina: 0, y: 0.0 }),
    ]
    .into_iter()
    .enumerate()
    {
        e.pagine[0].collegamenti.push(Collegamento {
            x: 10.0,
            y: 20.0 + 30.0 * i as f64,
            w: 60.0,
            h: 14.0,
            destinazione,
            nodo: Some(nodo),
        });
    }
    e.struttura = struttura;
    let doc = rileggi(&scrivi_accessibile(&e).pdf);
    let pagina = *doc.get_pages().values().next().unwrap();
    let annots = doc
        .get_dictionary(pagina)
        .unwrap()
        .get(b"Annots")
        .unwrap()
        .as_array()
        .unwrap()
        .clone();
    let descrizioni: Vec<Option<String>> = annots
        .iter()
        .map(|a| {
            let d = doc.get_dictionary(a.as_reference().unwrap()).unwrap();
            d.get(b"Contents")
                .ok()
                .map(|c| lopdf::decode_text_string(c).unwrap())
        })
        .collect();
    assert_eq!(
        descrizioni,
        vec![
            Some("La guida".into()),
            Some("Il manuale".into()),
            Some("https://fub.example/nudo".into()),
            None,
        ]
    );
}
