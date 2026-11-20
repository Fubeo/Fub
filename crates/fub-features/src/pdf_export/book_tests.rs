//! Le prove del libro: come i capitoli diventano un elenco solo, dove portano
//! i rimandi, i segnalibri, i casi limite e il comando.

use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::error::PluginError;
use fub_sdk::testing::MemoryHost;
use serde_json::json;

use super::book::*;
use super::tags::{Nodo, Specie};
use super::{
    Collegamento, Destinazione, ElencoPagine, ErroreEsportazione, Faccia, Pagina, Pezzo,
    Segnalibro, VERSIONE,
};

fn faccia(file: &str) -> Faccia {
    Faccia {
        famiglia: "Inter Variable".into(),
        file: file.into(),
        corsivo: false,
        assi: Vec::new(),
    }
}

fn testo(faccia: usize, parola: &str) -> Pezzo {
    let n = parola.chars().count();
    Pezzo::Testo {
        x: 20.0,
        y: 40.0,
        larghezza: 8.0 * n as f64,
        faccia,
        corpo: 12.0,
        colore: [0.0, 0.0, 0.0, 1.0],
        testo: parola.into(),
        posizioni: (0..n).map(|i| i as f64 * 8.0).collect(),
        sottolineato: false,
        barrato: false,
        nodo: None,
    }
}

/// Le pagine di una nota: una per parola, un segnalibro per pagina col nome
/// della parola, sempre nella faccia di Inter.
fn pagine(titolo: &str, parole: &[&str]) -> ElencoPagine {
    ElencoPagine {
        versione: VERSIONE,
        larghezza: 400.0,
        altezza: 300.0,
        titolo: titolo.into(),
        autore: String::new(),
        lingua: String::new(),
        facce: vec![faccia("/fonts/inter-latin-wght-normal.woff2")],
        pagine: parole
            .iter()
            .map(|p| Pagina {
                pezzi: vec![testo(0, p)],
                ..Pagina::default()
            })
            .collect(),
        segnalibri: parole
            .iter()
            .enumerate()
            .map(|(i, p)| Segnalibro {
                titolo: (*p).into(),
                livello: 1,
                pagina: i,
                y: 30.0,
            })
            .collect(),
        struttura: Vec::new(),
    }
}

fn capitolo(nota: &str, titolo: &str, parole: &[&str]) -> Capitolo {
    Capitolo {
        nota: Some(nota.into()),
        titolo: titolo.into(),
        pagine: pagine("", parole),
        rimandi: Vec::new(),
    }
}

fn rimando(pagina: usize, nota: &str) -> Rimando {
    Rimando {
        pagina,
        x: 20.0,
        y: 30.0,
        w: 40.0,
        h: 14.0,
        nota: nota.into(),
        sezione: None,
        url: None,
        nodo: None,
    }
}

fn libro(capitoli: Vec<Capitolo>) -> Libro {
    Libro {
        versione: VERSIONE_LIBRO,
        titolo: "Progetto".into(),
        autore: "Ada".into(),
        lingua: "it".into(),
        capitoli,
    }
}

fn destinazioni(elenco: &ElencoPagine, pagina: usize) -> Vec<Destinazione> {
    elenco.pagine[pagina]
        .collegamenti
        .iter()
        .map(|c| c.destinazione.clone())
        .collect()
}

#[test]
fn pdf_export_libro_le_pagine_vanno_in_fila_e_le_facce_in_una_tavola() {
    let mut secondo = capitolo("B.md", "Bi", &["Due", "Tre"]);
    // Il secondo capitolo ha in più un corsivo, e lo nomina per primo.
    secondo
        .pagine
        .facce
        .insert(0, faccia("/fonts/inter-latin-wght-italic.woff2"));
    for pagina in &mut secondo.pagine.pagine {
        pagina.pezzi = vec![testo(1, "x"), testo(0, "y")];
    }
    // Un collegamento dentro la nota, alla sua seconda pagina.
    secondo.pagine.pagine[0].collegamenti.push(Collegamento {
        x: 1.0,
        y: 1.0,
        w: 1.0,
        h: 1.0,
        destinazione: Destinazione::Dentro { pagina: 1, y: 5.0 },
        nodo: None,
    });
    let composto = componi(&libro(vec![capitolo("A.md", "A", &["Uno"]), secondo])).unwrap();
    let elenco = composto.elenco;
    assert_eq!(elenco.pagine.len(), 3);
    assert_eq!(elenco.titolo, "Progetto");
    assert_eq!(elenco.autore, "Ada");
    assert_eq!(
        elenco.facce.len(),
        2,
        "Inter una volta sola, più il corsivo"
    );
    assert_eq!(elenco.facce[0].file, "/fonts/inter-latin-wght-normal.woff2");
    let facce: Vec<usize> = elenco.pagine[1]
        .pezzi
        .iter()
        .map(|p| match p {
            Pezzo::Testo { faccia, .. } => *faccia,
            _ => unreachable!(),
        })
        .collect();
    assert_eq!(
        facce,
        vec![0, 1],
        "Inter resta la prima faccia del libro, il corsivo è la seconda"
    );
    assert_eq!(
        destinazioni(&elenco, 1),
        vec![Destinazione::Dentro { pagina: 2, y: 5.0 }],
        "il collegamento interno segue la sua nota"
    );
    assert!(composto.avvisi.is_empty());
    // L'elenco composto lo scrittore lo accetta.
    super::writer::valida(&elenco).unwrap();
}

#[test]
fn pdf_export_libro_un_segnalibro_per_nota_e_i_suoi_titoli_sotto() {
    let mut fronte = Capitolo {
        nota: None,
        titolo: String::new(),
        pagine: pagine("", &["Indice"]),
        rimandi: Vec::new(),
    };
    fronte.pagine.segnalibri[0].livello = 1;
    let mut a = capitolo("A.md", "", &["Uno"]);
    a.pagine.titolo = "Alfa".into();
    a.pagine.segnalibri[0].livello = 6;
    let b = capitolo("Cartella/Beta.md", "", &["Due", "Tre"]);
    let elenco = componi(&libro(vec![fronte, a, b])).unwrap().elenco;
    let voci: Vec<(&str, u8, usize)> = elenco
        .segnalibri
        .iter()
        .map(|s| (s.titolo.as_str(), s.livello, s.pagina))
        .collect();
    assert_eq!(
        voci,
        vec![
            ("Indice", 1, 0),
            ("Alfa", 1, 1),
            ("Uno", 6, 1),
            ("Beta", 1, 2),
            ("Due", 2, 2),
            ("Tre", 2, 3),
        ],
        "le pagine del libro tengono i loro segnalibri; ogni nota ne ha uno, col titolo \
         dell'elenco o il nome del file, e i suoi titoli un livello sotto (al più 6)"
    );
}

#[test]
fn pdf_export_libro_i_rimandi_fra_le_note_diventano_interni() {
    let mut a = capitolo("A.md", "A", &["Uno"]);
    a.rimandi = vec![
        rimando(0, "C.md"),
        Rimando {
            sezione: Some(" quattro ".into()),
            ..rimando(0, "/C.md")
        },
        Rimando {
            sezione: Some("Manca".into()),
            ..rimando(0, "C.md")
        },
        Rimando {
            url: Some("https://fub.example/Fuori".into()),
            ..rimando(0, "Fuori.md")
        },
        rimando(0, "Assente.md"),
        rimando(0, "Assente.md"),
        // Una nota che porta a sé stessa.
        rimando(0, "A.md"),
    ];
    let b = capitolo("B.md", "B", &["Due"]);
    let c = capitolo("C.md", "C", &["Tre", "Quattro"]);
    let composto = componi(&libro(vec![a, b, c])).unwrap();
    assert_eq!(
        destinazioni(&composto.elenco, 0),
        vec![
            Destinazione::Dentro { pagina: 2, y: 0.0 },
            Destinazione::Dentro { pagina: 3, y: 30.0 },
            Destinazione::Dentro { pagina: 2, y: 0.0 },
            Destinazione::Fuori {
                url: "https://fub.example/Fuori".into()
            },
            Destinazione::Dentro { pagina: 0, y: 0.0 },
        ],
        "alla nota, alla sezione (senza badare alle maiuscole), all'inizio se la sezione \
         non c'è, verso fuori se la nota non è nel libro"
    );
    assert_eq!(
        composto.avvisi,
        vec![
            AvvisoLibro::NotaNonEsportata {
                nota: "Assente.md".into()
            },
            AvvisoLibro::SezioneNonTrovata {
                nota: "C.md".into(),
                sezione: "Manca".into()
            },
        ],
        "un avviso per nota, anche se i collegamenti sono due"
    );
}

#[test]
fn pdf_export_libro_le_pagine_del_libro_portano_alle_note() {
    let mut indice = Capitolo {
        nota: None,
        titolo: String::new(),
        pagine: pagine("", &["Indice"]),
        rimandi: vec![rimando(0, "A.md"), rimando(0, "B.md")],
    };
    indice.pagine.segnalibri.clear();
    let composto = componi(&libro(vec![
        indice,
        capitolo("A.md", "A", &["Uno", "Due"]),
        capitolo("B.md", "B", &["Tre"]),
    ]))
    .unwrap();
    assert_eq!(
        destinazioni(&composto.elenco, 0),
        vec![
            Destinazione::Dentro { pagina: 1, y: 0.0 },
            Destinazione::Dentro { pagina: 3, y: 0.0 },
        ]
    );
}

#[test]
fn pdf_export_libro_due_note_con_lo_stesso_titolo_si_distinguono_col_percorso() {
    let elenco = componi(&libro(vec![
        capitolo("2024/Diario.md", "Diario", &["Uno"]),
        capitolo("2025/Diario.md", "diario ", &["Due"]),
        capitolo("v1.2/Altro", "Altro", &["Tre"]),
    ]))
    .unwrap()
    .elenco;
    let capitoli: Vec<&str> = elenco
        .segnalibri
        .iter()
        .filter(|s| s.livello == 1)
        .map(|s| s.titolo.as_str())
        .collect();
    assert_eq!(
        capitoli,
        vec!["Diario (2024/Diario)", "diario (2025/Diario)", "Altro"]
    );
}

#[test]
fn pdf_export_libro_cento_note_stanno_in_un_libro() {
    let capitoli: Vec<Capitolo> = (0..100)
        .map(|i| {
            let mut c = capitolo(&format!("Note/{i:03}.md"), "", &["Pagina"]);
            c.rimandi = vec![rimando(0, &format!("Note/{:03}.md", (i + 1) % 100))];
            c
        })
        .collect();
    let elenco = componi(&libro(capitoli)).unwrap().elenco;
    assert_eq!(elenco.pagine.len(), 100);
    assert_eq!(elenco.facce.len(), 1);
    assert_eq!(elenco.segnalibri.len(), 200);
    assert_eq!(
        destinazioni(&elenco, 99),
        vec![Destinazione::Dentro { pagina: 0, y: 0.0 }]
    );
    super::writer::valida(&elenco).unwrap();
}

#[test]
fn pdf_export_libro_i_libri_sbagliati_si_dicono_per_nome() {
    let mut futuro = libro(vec![capitolo("A.md", "A", &["x"])]);
    futuro.versione = 2;
    assert_eq!(
        componi(&futuro).unwrap_err(),
        ErroreLibro::Versione { trovata: 2 }
    );
    assert_eq!(
        componi(&libro(Vec::new())).unwrap_err(),
        ErroreLibro::NumeroCapitoli { capitoli: 0 }
    );

    let mut largo = capitolo("B.md", "B", &["x"]);
    largo.pagine.larghezza = 500.0;
    assert_eq!(
        componi(&libro(vec![capitolo("A.md", "A", &["x"]), largo])).unwrap_err(),
        ErroreLibro::MisureDiverse { capitolo: 1 }
    );

    assert_eq!(
        componi(&libro(vec![
            capitolo("A.md", "A", &["x"]),
            capitolo("/A.md", "A", &["y"]),
        ]))
        .unwrap_err(),
        ErroreLibro::NotaRipetuta {
            nota: "A.md".into()
        }
    );

    // Un collegamento interno che esce dal suo capitolo non finisce nella
    // nota dopo: è un capitolo rotto.
    let mut fuori = capitolo("A.md", "A", &["x"]);
    fuori.pagine.pagine[0].collegamenti.push(Collegamento {
        x: 1.0,
        y: 1.0,
        w: 1.0,
        h: 1.0,
        destinazione: Destinazione::Dentro { pagina: 1, y: 0.0 },
        nodo: None,
    });
    let e = componi(&libro(vec![fuori, capitolo("B.md", "B", &["y"])])).unwrap_err();
    assert!(
        matches!(
            &e,
            ErroreLibro::Capitolo {
                capitolo: 0,
                nota: Some(nota),
                motivo: ErroreEsportazione::CollegamentoRotto { .. },
            } if nota == "A.md"
        ),
        "{e:?}"
    );

    let mut storto = capitolo("A.md", "A", &["x"]);
    storto.rimandi = vec![rimando(0, "A.md"), rimando(1, "A.md")];
    assert_eq!(
        componi(&libro(vec![storto])).unwrap_err(),
        ErroreLibro::RimandoRotto {
            capitolo: 0,
            nota: Some("A.md".into()),
            rimando: 1
        }
    );
    let mut infinito = capitolo("A.md", "A", &["x"]);
    infinito.rimandi = vec![Rimando {
        w: f64::NAN,
        ..rimando(0, "A.md")
    }];
    assert!(matches!(
        componi(&libro(vec![infinito])).unwrap_err(),
        ErroreLibro::RimandoRotto { rimando: 0, .. }
    ));

    assert!(matches!(
        leggi("{\"versione\": 1, \"capitoli\": [], \"altro\": 1}").unwrap_err(),
        ErroreLibro::Illeggibile { .. }
    ));
    assert!(matches!(
        leggi(&" ".repeat(super::MAX_ELENCO_BYTE + 1)).unwrap_err(),
        ErroreLibro::TroppoGrande { .. }
    ));
}

fn chiave(e: &PluginError) -> String {
    let PluginError::BadArgs(testo) = e else {
        panic!("{e:?}");
    };
    serde_json::to_value(testo).unwrap()["key"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

fn args(libro: &Libro, target: &str) -> serde_json::Value {
    json!({ "book": serde_json::to_string(libro).unwrap(), "target": target })
}

#[test]
fn pdf_export_libro_il_comando_accoda_il_lavoro_della_nota_con_gli_avvisi() {
    let mut a = capitolo("A.md", "A", &["Uno"]);
    a.rimandi = vec![rimando(0, "Assente.md")];
    let libro = libro(vec![a, capitolo("B.md", "B", &["Due"])]);
    let mut host = MemoryHost::new();

    let piano = invoke(args(&libro, "Libro.pdf"), InvokeMode::DryRun, &mut host).unwrap();
    assert!(matches!(piano.effect, CommandEffect::Plan(_)));

    let esito = invoke(args(&libro, "Libro.pdf"), InvokeMode::Apply, &mut host).unwrap();
    let CommandEffect::Custom { ns, payload } = esito.effect else {
        panic!("il comando accoda un lavoro");
    };
    assert_eq!(ns, super::lavoro::PDF_QUEUED);
    assert_eq!(payload["path"], "Libro.pdf");
    assert_eq!(
        payload["warnings"],
        json!([{ "avviso": "nota_non_esportata", "nota": "Assente.md" }])
    );

    let e = invoke(
        json!({ "book": "{", "target": "Libro.pdf" }),
        InvokeMode::Apply,
        &mut host,
    )
    .unwrap_err();
    assert_eq!(chiave(&e), "e_pdf_book_unreadable");
    let doppio = super::book::Libro {
        capitoli: vec![capitolo("A.md", "A", &["x"]), capitolo("A.md", "A", &["y"])],
        ..libro.clone()
    };
    let e = invoke(args(&doppio, "Libro.pdf"), InvokeMode::Apply, &mut host).unwrap_err();
    assert_eq!(chiave(&e), "e_pdf_book_repeated");
    // La destinazione la controlla il comando di una nota, con la sua frase.
    let e = invoke(args(&libro, "Libro.txt"), InvokeMode::Apply, &mut host).unwrap_err();
    assert_eq!(chiave(&e), "e_pdf_target_not_pdf");
}

#[test]
fn pdf_export_libro_la_spec_chiede_libro_e_destinazione() {
    let spec = super::book::spec();
    assert_eq!(spec.id, PDF_WRITE_BOOK);
    let richiesti: Vec<&str> = spec
        .params
        .iter()
        .filter(|p| p.required)
        .map(|p| p.name.as_str())
        .collect();
    assert_eq!(richiesti, vec!["book", "target"]);
}

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

#[test]
fn la_struttura_di_ogni_capitolo_resta_sua_nel_libro() {
    // Due note accessibili: ognuna con una sezione e un paragrafo dentro,
    // il testo nel paragrafo e, nella seconda, un collegamento.
    let mut a = capitolo("A.md", "A", &["Uno"]);
    let mut b = capitolo("B.md", "B", &["Due"]);
    for c in [&mut a, &mut b] {
        c.pagine.struttura = vec![
            nodo(Specie::Sezione, None),
            nodo(Specie::Paragrafo, Some(0)),
        ];
        if let Pezzo::Testo { nodo, .. } = &mut c.pagine.pagine[0].pezzi[0] {
            *nodo = Some(1);
        }
    }
    b.pagine.struttura.push(nodo(Specie::Collegamento, Some(1)));
    let mut r = rimando(0, "A.md");
    r.nodo = Some(2);
    b.rimandi.push(r);

    let elenco = componi(&libro(vec![a, b])).unwrap().elenco;
    // I nodi della seconda nota vengono dopo quelli della prima, coi
    // genitori spostati: nessun ramo finisce dentro l'altra nota.
    let genitori: Vec<_> = elenco.struttura.iter().map(|n| n.genitore).collect();
    assert_eq!(genitori, [None, Some(0), None, Some(2), Some(3)]);
    let nodi: Vec<_> = elenco
        .pagine
        .iter()
        .map(|p| match &p.pezzi[0] {
            Pezzo::Testo { nodo, .. } => *nodo,
            _ => None,
        })
        .collect();
    assert_eq!(nodi, [Some(1), Some(3)]);
    assert_eq!(elenco.pagine[1].collegamenti[0].nodo, Some(4));
}
