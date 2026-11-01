//! La mappa dei componenti e i profili del piano K1, come dato.
//!
//! Il test dice che la mappa si costruisce (niente cicli, niente requisiti che
//! nessuno offre), che ogni profilo accende ciò che deve, e che le frasi
//! d'esempio del piano escono dal risolutore così come sono scritte.

use std::collections::BTreeSet;

use fub_componenti::{Componente, Errore, Id, Mappa, Perche, Profilo, Stato};

/// `(gruppo, id, richiede, usa se c'è)`.
const MAPPA: &[(&str, &str, &[&str], &[&str])] = &[
    ("scrivere", "note", &[], &[]),
    ("scrivere", "grafo", &["note"], &[]),
    ("scrivere", "correttore", &["note", "dizionari"], &[]),
    ("leggere", "pdf", &["motore-pdf", "penna"], &["ocr"]),
    (
        "leggere",
        "pdf-completo",
        &["pdf", "caratteri"],
        &["pdf-script"],
    ),
    ("leggere", "ocr", &["motore-pdf"], &[]),
    ("leggere", "pdf-script", &["pdf-completo"], &[]),
    (
        "pensare",
        "lavagna",
        &["penna", "motore-vettoriale"],
        &["pdf", "fogli", "documenti"],
    ),
    ("disegnare", "disegno", &["motore-vettoriale", "penna"], &[]),
    (
        "disegnare",
        "disegno-completo",
        &["disegno", "caratteri", "colore"],
        &[],
    ),
    (
        "foto",
        "foto",
        &["motore-foto", "colore", "gpu"],
        &["penna", "raw"],
    ),
    (
        "foto",
        "libreria-foto",
        &["motore-libreria", "colore", "gpu", "raw"],
        &["ia-foto"],
    ),
    ("foto", "ia-foto", &["libreria-foto"], &[]),
    (
        "ufficio",
        "documenti",
        &["motore-documenti", "caratteri"],
        &["penna", "dizionari"],
    ),
    ("ufficio", "fogli", &["motore-fogli"], &["penna"]),
    ("altro", "agenti", &[], &[]),
    ("altro", "tablet", &["penna"], &[]),
    ("supporto", "penna", &[], &[]),
    ("supporto", "motore-pdf", &[], &[]),
    ("supporto", "motore-vettoriale", &["caratteri"], &[]),
    ("supporto", "motore-foto", &["caratteri"], &[]),
    ("supporto", "motore-libreria", &[], &[]),
    ("supporto", "motore-documenti", &[], &[]),
    ("supporto", "motore-fogli", &[], &[]),
    ("supporto", "caratteri", &[], &[]),
    ("supporto", "colore", &[], &[]),
    ("supporto", "gpu", &[], &[]),
    ("supporto", "raw", &[], &[]),
    ("supporto", "dizionari", &[], &[]),
];

const PROFILI: &[(&str, &[&str])] = &[
    ("note", &["note"]),
    ("pdf", &["pdf", "pdf-completo"]),
    (
        "studio",
        &[
            "note",
            "grafo",
            "correttore",
            "pdf",
            "lavagna",
            "documenti",
            "fogli",
            "tablet",
        ],
    ),
    ("grafica", &["note", "lavagna", "disegno-completo", "foto"]),
    ("fotografia", &["note", "libreria-foto", "foto"]),
];

fn ids(v: &[&str]) -> Vec<Id> {
    v.iter().map(|s| s.to_string()).collect()
}

fn insieme(v: &[&str]) -> BTreeSet<Id> {
    v.iter().map(|s| s.to_string()).collect()
}

fn righe() -> Vec<Componente> {
    MAPPA
        .iter()
        .map(|(gruppo, id, requires, uses)| Componente {
            id: id.to_string(),
            requires: ids(requires),
            uses: ids(uses),
            gruppo: Some(gruppo.to_string()),
            provides: Vec::new(),
        })
        .collect()
}

fn mappa() -> Mappa {
    Mappa::nuova(righe(), Vec::<Id>::new()).expect("la mappa del piano si costruisce")
}

fn profilo(nome: &str) -> Profilo {
    if nome == "tutto" {
        return Profilo {
            nome: nome.into(),
            componenti: MAPPA
                .iter()
                .filter(|(gruppo, ..)| *gruppo != "supporto")
                .map(|(_, id, ..)| id.to_string())
                .collect(),
        };
    }
    let (_, componenti) = PROFILI
        .iter()
        .find(|(n, _)| *n == nome)
        .unwrap_or_else(|| panic!("nessun profilo {nome}"));
    Profilo {
        nome: nome.into(),
        componenti: ids(componenti),
    }
}

fn scelti(v: &[&str]) -> Stato {
    Stato {
        scelti: insieme(v),
        in_attesa: BTreeSet::new(),
    }
}

#[test]
fn la_mappa_si_costruisce_e_i_profili_nominano_solo_componenti_veri() {
    let mappa = mappa();
    assert_eq!(mappa.componenti().count(), MAPPA.len());
    for (nome, componenti) in PROFILI {
        for c in *componenti {
            assert!(
                mappa.componente(c).is_some(),
                "il profilo {nome} nomina «{c}»"
            );
        }
    }
    for c in mappa.componenti() {
        for u in &c.uses {
            assert!(mappa.componente(u).is_some(), "«{}» usa «{u}»", c.id);
        }
    }
}

#[test]
fn ogni_profilo_accende_i_suoi_requisiti() {
    let mappa = mappa();
    let attesi: &[(&str, &[&str])] = &[
        ("note", &["note"]),
        (
            "pdf",
            &["pdf", "pdf-completo", "motore-pdf", "penna", "caratteri"],
        ),
        (
            "studio",
            &[
                "note",
                "grafo",
                "correttore",
                "dizionari",
                "pdf",
                "motore-pdf",
                "penna",
                "lavagna",
                "motore-vettoriale",
                "caratteri",
                "documenti",
                "motore-documenti",
                "fogli",
                "motore-fogli",
                "tablet",
            ],
        ),
        (
            "grafica",
            &[
                "note",
                "lavagna",
                "penna",
                "motore-vettoriale",
                "caratteri",
                "disegno-completo",
                "disegno",
                "colore",
                "foto",
                "motore-foto",
                "gpu",
            ],
        ),
        (
            "fotografia",
            &[
                "note",
                "libreria-foto",
                "motore-libreria",
                "colore",
                "gpu",
                "raw",
                "foto",
                "motore-foto",
                "caratteri",
            ],
        ),
    ];
    for (nome, accesi) in attesi {
        let (stato, effetto) = mappa.applica_profilo(&Stato::default(), &profilo(nome));
        assert_eq!(mappa.attivi(&stato), insieme(accesi), "profilo {nome}");
        assert!(effetto.mancanti.is_empty(), "profilo {nome}");
        assert!(stato.in_attesa.is_empty(), "profilo {nome}");
    }

    // «Solo PDF»: gli accesi in più sono i requisiti, non i due scelti.
    let (_, effetto) = mappa.applica_profilo(&Stato::default(), &profilo("pdf"));
    assert_eq!(
        effetto.accesi_anche,
        ids(&["caratteri", "motore-pdf", "penna"])
    );

    // «Tutto» accende ogni componente: ogni supporto serve a qualcuno.
    let (stato, _) = mappa.applica_profilo(&Stato::default(), &profilo("tutto"));
    let tutti: BTreeSet<Id> = mappa.componenti().map(|c| c.id.clone()).collect();
    assert_eq!(mappa.attivi(&stato), tutti);

    // Passare da un profilo all'altro spegne ciò che il nuovo non vuole.
    let (da, _) = mappa.applica_profilo(&Stato::default(), &profilo("pdf"));
    let (_, effetto) = mappa.applica_profilo(&da, &profilo("note"));
    assert_eq!(
        effetto.spenti_anche,
        ids(&["caratteri", "motore-pdf", "pdf", "pdf-completo", "penna"])
    );
}

#[test]
fn un_profilo_con_un_id_sconosciuto_applica_il_resto() {
    let mappa = mappa();
    let vecchio = Profilo {
        nome: "vecchio".into(),
        componenti: ids(&["note", "sparito"]),
    };
    let (stato, effetto) = mappa.applica_profilo(&Stato::default(), &vecchio);
    assert_eq!(stato.scelti, insieme(&["note"]));
    assert_eq!(effetto.mancanti, vec![("vecchio".into(), "sparito".into())]);
}

#[test]
fn profilo_e_accensione_a_mano_si_distinguono() {
    // Chi chiama tiene il profilo, e lo dice «personalizzato» quando `scelti`
    // non è più quello del profilo: succede con `accendi`, non con
    // `applica_profilo`.
    let mappa = mappa();
    let pdf = profilo("pdf");
    let (stato, _) = mappa.applica_profilo(&Stato::default(), &pdf);
    let del_profilo: BTreeSet<Id> = pdf.componenti.iter().cloned().collect();
    assert_eq!(stato.scelti, del_profilo);
    let (stato, _) = mappa.accendi(&stato, "tablet").expect("accendi");
    assert_ne!(stato.scelti, del_profilo);
}

#[test]
fn attivati_anche_penna_e_motore_dei_pdf() {
    let mappa = mappa();
    let (stato, effetto) = mappa.accendi(&Stato::default(), "pdf").expect("accendi");
    assert_eq!(effetto.accesi_anche, ids(&["motore-pdf", "penna"]));
    assert_eq!(mappa.perche(&stato, "pdf"), Perche::Scelto);
    assert_eq!(
        mappa.perche(&stato, "penna"),
        Perche::RichiestoDa(ids(&["pdf"]))
    );
    assert_eq!(
        mappa.perche(&stato, "ocr"),
        Perche::Spento,
        "uses non accende"
    );
}

#[test]
fn spegnere_la_penna_serve_a_pdf_e_tablet() {
    let mappa = mappa();
    let stato = scelti(&["pdf", "tablet"]);
    assert_eq!(
        mappa.spegni(&stato, "penna"),
        Err(Errore::Richiesto {
            da: ids(&["pdf", "tablet"])
        })
    );
    assert_eq!(
        mappa.perche(&stato, "penna"),
        Perche::RichiestoDa(ids(&["pdf", "tablet"]))
    );

    let (dopo, effetto) = mappa
        .spegni_con_dipendenti(&stato, "penna")
        .expect("spegni con dipendenti");
    assert_eq!(effetto.spenti_anche, ids(&["pdf", "tablet"]));
    assert_eq!(effetto.orfani, ids(&["motore-pdf"]));
    assert!(dopo.scelti.is_empty());
    assert_eq!(dopo.in_attesa, insieme(&["motore-pdf"]));
}

#[test]
fn spegnere_la_lavagna_lascia_il_motore_vettoriale_in_attesa() {
    let mappa = mappa();
    let (dopo, effetto) = mappa
        .spegni(&scelti(&["lavagna"]), "lavagna")
        .expect("spegni");
    assert_eq!(
        effetto.orfani,
        ids(&["caratteri", "motore-vettoriale", "penna"])
    );
    assert!(dopo.in_attesa.contains("motore-vettoriale"));
    assert!(
        mappa.attivi(&dopo).contains("motore-vettoriale"),
        "resta acceso"
    );
    assert_eq!(mappa.perche(&dopo, "motore-vettoriale"), Perche::InAttesa);

    // Se qualcun altro lo richiede, non è orfano.
    let (dopo, effetto) = mappa
        .spegni(&scelti(&["lavagna", "disegno"]), "lavagna")
        .expect("spegni");
    assert!(effetto.orfani.is_empty());
    assert!(dopo.in_attesa.is_empty());
    assert_eq!(
        mappa.perche(&dopo, "motore-vettoriale"),
        Perche::RichiestoDa(ids(&["disegno"]))
    );

    // Togli spegne gli orfani, Tienili li sceglie.
    let (dopo, effetto) = mappa
        .spegni(&scelti(&["lavagna"]), "lavagna")
        .expect("spegni");
    assert!(mappa
        .attivi(&mappa.togli(&dopo, &effetto.orfani))
        .is_empty());
    let tenuti = mappa.tieni(&dopo, &effetto.orfani);
    assert_eq!(
        tenuti.scelti,
        insieme(&["caratteri", "motore-vettoriale", "penna"])
    );
}

#[test]
fn il_nucleo_della_mappa_del_piano() {
    let mappa = Mappa::nuova(righe(), ["note"]).expect("con nucleo");
    let vuoto = Stato::default();
    assert!(mappa.attivi(&vuoto).contains("note"));
    assert_eq!(mappa.spegni(&vuoto, "note"), Err(Errore::Nucleo));
    assert_eq!(mappa.perche(&vuoto, "note"), Perche::Nucleo);
    // Il grafo richiede le note: spegnerlo si può, le note restano.
    let (stato, effetto) = mappa.accendi(&vuoto, "grafo").expect("accendi");
    assert!(effetto.accesi_anche.is_empty());
    let (_, effetto) = mappa.spegni(&stato, "grafo").expect("spegni");
    assert!(effetto.orfani.is_empty());
}
