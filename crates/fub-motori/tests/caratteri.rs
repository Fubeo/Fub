//! I caratteri dati dall'host: assenti prima, gli stessi dopo, dati una volta
//! sola, la stessa `Arc` per tutti i thread.

use std::sync::{Arc, Barrier};
use std::thread;

use fub_motori::{Caratteri, Config, Generiche, Servizi, Tetto};

fn servizi() -> Arc<Servizi> {
    Servizi::nuovi(Config {
        fili: Some(1),
        tetto: Tetto::fisso(0),
    })
}

static UNA: &[u8] = b"faccia una";
static DUE: &[u8] = b"faccia due";

fn generiche() -> Generiche {
    Generiche {
        serif: "Literata".into(),
        sans: "Inter".into(),
        mono: "JetBrains Mono".into(),
    }
}

fn caratteri() -> Caratteri {
    Caratteri::nuovi([UNA, DUE], generiche())
}

#[test]
fn prima_che_l_host_li_dia_non_ci_sono() {
    assert!(servizi().caratteri().is_none());
}

#[test]
fn dopo_fornisci_sono_le_stesse_facce() {
    let servizi = servizi();
    assert_eq!(servizi.fornisci_caratteri(caratteri()), Ok(()));

    let dati = servizi.caratteri().expect("i caratteri sono stati dati");
    assert_eq!(dati.facce().len(), 2);
    // Le stesse facce, non copie: gli stessi byte allo stesso indirizzo.
    assert!(std::ptr::eq(dati.facce()[0], UNA));
    assert!(std::ptr::eq(dati.facce()[1], DUE));
    assert_eq!(dati.serif(), "Literata");
    assert_eq!(dati.sans(), "Inter");
    assert_eq!(dati.mono(), "JetBrains Mono");
}

#[test]
fn il_secondo_fornisci_e_rifiutato_e_restituito() {
    let servizi = servizi();
    servizi
        .fornisci_caratteri(caratteri())
        .expect("i primi caratteri si prendono");

    let secondi = Caratteri::nuovi(
        [DUE],
        Generiche {
            serif: "Altra".into(),
            sans: "Altra".into(),
            mono: "Altra".into(),
        },
    );
    let rifiutati = servizi
        .fornisci_caratteri(secondi.clone())
        .expect_err("i secondi caratteri si rifiutano");
    assert_eq!(rifiutati, secondi);

    // Restano i primi.
    let dati = servizi.caratteri().expect("i primi restano");
    assert_eq!(*dati, caratteri());
}

#[test]
fn zero_facce_sono_ammesse() {
    let servizi = servizi();
    let vuoti = Caratteri::nuovi(Vec::new(), generiche());
    assert_eq!(servizi.fornisci_caratteri(vuoti), Ok(()));
    let dati = servizi.caratteri().expect("dati anche senza facce");
    assert!(dati.facce().is_empty());
    assert_eq!(dati.sans(), "Inter");
}

#[test]
fn servizi_separati_hanno_caratteri_separati() {
    let primi = servizi();
    let secondi = servizi();
    primi.fornisci_caratteri(caratteri()).expect("dati ai primi");
    assert!(secondi.caratteri().is_none());
}

#[test]
fn dieci_thread_che_leggono_insieme_vedono_la_stessa_arc() {
    let servizi = servizi();
    servizi.fornisci_caratteri(caratteri()).expect("dati");

    let partenza = Arc::new(Barrier::new(10));
    let viste: Vec<Arc<Caratteri>> = (0..10)
        .map(|_| {
            let servizi = Arc::clone(&servizi);
            let partenza = Arc::clone(&partenza);
            thread::spawn(move || {
                partenza.wait();
                servizi.caratteri().expect("visti da ogni thread")
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|filo| filo.join().expect("il thread non va in panico"))
        .collect();

    let prima = &viste[0];
    for vista in &viste {
        assert!(Arc::ptr_eq(prima, vista));
    }
}

#[test]
fn dieci_thread_che_danno_insieme_uno_solo_vince() {
    let servizi = servizi();
    let partenza = Arc::new(Barrier::new(10));
    let esiti: Vec<(usize, bool)> = (0..10)
        .map(|n| {
            let servizi = Arc::clone(&servizi);
            let partenza = Arc::clone(&partenza);
            thread::spawn(move || {
                let propri = Caratteri::nuovi(
                    [UNA],
                    Generiche {
                        serif: format!("serif {n}"),
                        sans: "Inter".into(),
                        mono: "JetBrains Mono".into(),
                    },
                );
                partenza.wait();
                (n, servizi.fornisci_caratteri(propri).is_ok())
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|filo| filo.join().expect("il thread non va in panico"))
        .collect();

    let vincitori: Vec<usize> = esiti
        .iter()
        .filter(|(_, preso)| *preso)
        .map(|(n, _)| *n)
        .collect();
    assert_eq!(vincitori.len(), 1, "uno solo dà i caratteri: {esiti:?}");
    let dati = servizi.caratteri().expect("dati");
    assert_eq!(dati.serif(), format!("serif {}", vincitori[0]));
}

#[test]
fn il_debug_non_stampa_i_byte() {
    let testo = format!("{:?}", caratteri());
    assert!(testo.contains("facce: 2"), "{testo}");
    assert!(!testo.contains("[102"), "nessun byte nel Debug: {testo}");
}
