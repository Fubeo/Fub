//! **La mappa dei componenti si costruisce, e dice ciò che dice il codice.**
//!
//! `fub_features::componenti::righe` è un dato fisso: che la mappa che ne esce
//! non abbia cicli né requisiti senza nessuno che li offra si prova qui, in
//! ogni combinazione di feature che si compila, e non a runtime. Le righe delle
//! feature ufficiali si confrontano con l'inventario da cui `fub_host::mount`
//! le monta.

use std::collections::BTreeSet;

use fub_abi::Delivery;
use fub_componenti::ErroreMappa;
use fub_features::componenti::{self, Riga, NUCLEO, SOLO_DELLA_MAPPA};

#[test]
fn la_mappa_si_costruisce() {
    if let Err(errore) = componenti::prova_mappa() {
        panic!("la mappa dei componenti di questa build non si costruisce: {errore}");
    }
    let mappa = componenti::mappa();
    for id in NUCLEO {
        assert!(mappa.componente(id).is_some(), "il nucleo nomina «{id}»");
    }
}

#[test]
fn gli_id_sono_unici_e_tutti_inclusi() {
    let righe = componenti::righe();
    let mut visti = BTreeSet::new();
    for riga in &righe {
        assert!(visti.insert(riga.id), "«{}» compare due volte", riga.id);
        assert_eq!(
            riga.delivery,
            Delivery::Included,
            "«{}»: in K1 tutto è incluso",
            riga.id
        );
        assert_eq!(
            riga.nome,
            format!("component.{}.name", riga.id.strip_prefix("fub.").unwrap()),
            "la chiave del nome di «{}»",
            riga.id
        );
    }
}

/// Un requisito che una build parziale non compila non è un panic a runtime:
/// la mappa non si costruisce, e l'errore nomina chi e che cosa.
#[test]
fn un_requisito_spento_e_un_errore_chiaro() {
    let righe: Vec<_> = componenti::righe()
        .into_iter()
        .filter(|riga| riga.id != "fub.penna")
        .map(|riga| riga.componente())
        .collect();
    let errore = fub_componenti::Mappa::nuova(righe, NUCLEO).unwrap_err();
    assert_eq!(
        errore,
        ErroreMappa::RequisitoSenzaOfferta {
            di: "fub.lavagna".into(),
            requisito: "fub.penna".into(),
        }
    );
    assert_eq!(
        errore.to_string(),
        "«fub.lavagna» richiede «fub.penna», che nessun componente è né offre"
    );
}

/// Ogni voce di `ui` è una cartella del client.
#[test]
fn ogni_ui_e_una_cartella_del_client() {
    let client = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src");
    let mut viste = 0;
    for riga in componenti::righe() {
        for pezzo in riga.ui {
            assert!(
                client.join(pezzo).is_dir(),
                "«{}» carica «{pezzo}», che non è una cartella sotto apps/client/src/",
                riga.id
            );
            viste += 1;
        }
    }
    assert!(
        viste > 0,
        "nessuna riga dichiara una ui: il presidio non guarda niente"
    );
}

/// Nessun bundle è di supporto: un componente di supporto si spegne quando
/// nessuno lo richiede, ed è un cambiamento visibile.
#[test]
fn nessun_bundle_e_di_supporto() {
    for riga in componenti::righe() {
        assert!(
            !(riga.bundle && riga.gruppo == "supporto"),
            "«{}» è un bundle nel gruppo `supporto`",
            riga.id
        );
    }
}

/// Ciò che sta solo nella mappa è davvero una riga senza bundle o del nucleo,
/// e il perché è scritto.
#[test]
fn i_requisiti_solo_della_mappa_hanno_un_perche() {
    let righe = componenti::righe();
    for (id, perche) in SOLO_DELLA_MAPPA {
        assert!(!perche.is_empty(), "«{id}» senza perché");
        if let Some(riga) = righe.iter().find(|riga| riga.id == *id) {
            assert!(
                !riga.bundle || NUCLEO.contains(id),
                "«{id}» è un bundle fuori dal nucleo: il suo requisito va nel manifest"
            );
        }
    }
}

/// Ogni feature ufficiale ha la sua riga, e la riga dice ciò che dice
/// l'inventario: id, cargo feature, `provides`, e i `requires` del manifest.
#[test]
fn ogni_feature_ufficiale_e_una_riga() {
    let righe = componenti::righe();
    let riga = |id: &str| -> &Riga {
        righe
            .iter()
            .find(|riga| riga.id == id)
            .unwrap_or_else(|| panic!("«{id}» è nell'inventario e non nella mappa"))
    };
    for feature in fub_features::every_official_feature() {
        let riga = riga(feature.id);
        assert!(riga.bundle, "«{}» è un bundle", feature.id);
        assert_eq!(riga.cargo_feature, feature.id.strip_prefix("fub."));
        assert_eq!(
            riga.provides, feature.provides,
            "provides di «{}»",
            feature.id
        );
        assert_eq!(
            riga.requires_del_manifest(),
            feature.requires,
            "requires di «{}», tolti quelli solo della mappa",
            feature.id
        );
    }
    let ufficiali = fub_features::every_official_feature().len();
    let note = righe
        .iter()
        .filter(|riga| riga.gruppo == "scrivere" && riga.requires.contains(&"fub.markdown"))
        .count();
    let disegni = usize::from(cfg!(feature = "draw"));
    assert_eq!(
        note + disegni,
        ufficiali,
        "ogni feature ufficiale delle note richiede le note"
    );
}

/// Ogni id di un profilo è una riga della mappa, oppure sta nel suo «arriva
/// con…», che lo rende «più avanti»: un profilo non nomina niente a caso.
#[test]
fn ogni_id_dei_profili_esiste_o_e_piu_avanti() {
    let mappa = componenti::mappa();
    let profili = componenti::profili();
    let mut nomi = BTreeSet::new();
    for profilo in &profili {
        assert!(nomi.insert(profilo.nome), "«{}» due volte", profilo.nome);
        assert_eq!(profilo.etichetta, format!("profile.{}.name", profilo.nome));
        for id in &profilo.componenti {
            assert!(
                mappa.componente(id).is_some(),
                "«{}» sceglie «{id}», che la mappa non ha",
                profilo.nome
            );
        }
        for id in &profilo.arriva_con {
            assert!(
                mappa.componente(id).is_none(),
                "«{}» aspetta «{id}», che c'è già",
                profilo.nome
            );
        }
    }
    let piu_avanti: BTreeSet<&str> = profili
        .iter()
        .filter(|profilo| profilo.piu_avanti())
        .map(|profilo| profilo.nome)
        .collect();
    assert_eq!(
        piu_avanti,
        BTreeSet::from(["solo-pdf", "grafica", "fotografia"])
    );
}

/// «Studio» accende anche ciò che i suoi componenti richiedono: la penna per
/// lavagna e PDF, i motori per documenti e fogli.
#[test]
fn studio_accende_la_penna_e_i_motori() {
    let mappa = componenti::mappa();
    let studio = componenti::profilo("studio").expect("il profilo «Studio»");
    let (stato, _) = mappa.applica_profilo(&Default::default(), &studio.profilo());
    let attivi = mappa.attivi(&stato);
    for id in ["fub.penna", "fub.lavagna", "fub.pdf"] {
        assert!(attivi.contains(id), "«{id}» con «Studio»");
    }
    // Grafo e correttore sono righe solo nelle build che li compilano.
    #[cfg(feature = "graph")]
    assert!(attivi.contains("fub.graph"));
    #[cfg(feature = "proof")]
    assert!(attivi.contains("fub.proof"));
    #[cfg(feature = "rich")]
    assert!(attivi.contains("fub.motore-documenti"));
    #[cfg(feature = "xlsx")]
    assert!(attivi.contains("fub.motore-fogli"));
}

/// «Note» sono le note e il gruppo `scrivere`, senza grafo e correttore; un
/// profilo che non è «Tutto» non nomina i gruppi che lascia stare.
#[test]
fn note_e_i_gruppi_che_un_profilo_non_tocca() {
    let note = componenti::profilo("note").unwrap();
    assert!(note.componenti.contains(&"fub.markdown"));
    assert!(!note.componenti.contains(&"fub.graph"));
    assert!(!note.componenti.contains(&"fub.proof"));
    assert_eq!(
        componenti::profilo("solo-note").unwrap().componenti,
        note.componenti
    );
    for profilo in componenti::profili() {
        let tutto = profilo.nome == componenti::PROFILO_TUTTO;
        for id in &profilo.componenti {
            let riga = componenti::riga(id).unwrap();
            assert_ne!(riga.gruppo, "supporto", "«{}» sceglie «{id}»", profilo.nome);
            if !tutto {
                assert!(
                    !componenti::GRUPPI_FUORI_DAI_PROFILI.contains(&riga.gruppo),
                    "«{}» tocca «{id}»",
                    profilo.nome
                );
            }
        }
    }
    let tutto = componenti::profilo(componenti::PROFILO_TUTTO).unwrap();
    for riga in componenti::righe() {
        assert_eq!(
            tutto.componenti.contains(&riga.id),
            riga.gruppo != "supporto",
            "«Tutto» e «{}»",
            riga.id
        );
    }
}

#[test]
fn i_gruppi_sono_quelli_con_almeno_una_riga() {
    let righe = componenti::righe();
    let gruppi = componenti::gruppi();
    for riga in &righe {
        assert!(
            componenti::GRUPPI.contains(&riga.gruppo),
            "«{}» sta nel gruppo «{}», che la pagina non ha",
            riga.id,
            riga.gruppo
        );
        assert!(gruppi.contains(&riga.gruppo), "«{}»", riga.gruppo);
    }
    for gruppo in &gruppi {
        assert!(
            righe.iter().any(|riga| riga.gruppo == *gruppo),
            "«{gruppo}» non ha righe e si disegnerebbe vuoto"
        );
    }
    let ordine: Vec<&str> = componenti::GRUPPI
        .into_iter()
        .filter(|gruppo| gruppi.contains(gruppo))
        .collect();
    assert_eq!(gruppi, ordine, "i gruppi, nell'ordine della pagina");
    // In questa build nessuna riga è una foto: il gruppo non compare.
    assert!(!gruppi.contains(&"foto"), "{gruppi:?}");
}

/// Le righe con un editor dicono quale: la pagina lo carica da lì.
#[test]
fn le_righe_con_un_editor_dicono_quale() {
    let attese: &[(&str, &[&str])] = &[
        ("fub.pdf", &["editors/media"]),
        ("fub.lavagna", &["editors/canvas"]),
        #[cfg(feature = "rich")]
        ("fub.rich", &["editors/rich"]),
        #[cfg(feature = "xlsx")]
        ("fub.xlsx", &["editors/grid"]),
        #[cfg(feature = "draw")]
        ("fub.draw", &["editors/spatial"]),
    ];
    for (id, ui) in attese {
        let riga = componenti::riga(id).unwrap_or_else(|| panic!("«{id}» è una riga"));
        assert_eq!(riga.ui, *ui, "«{id}»");
    }
}
