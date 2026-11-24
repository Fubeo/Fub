//! Le prove delle famiglie: la mappa, le tabelle, la nascita pigra, il
//! `Budget`, la preparazione e il filtro.

use std::collections::BTreeSet;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

use fub_abi::{PluginError, DRAWING_FAMILIES};
use fub_motori::{Cache, Config, Servizi, Tetto};

use super::*;

fn servizi() -> Arc<Servizi> {
    Servizi::nuovi(Config {
        fili: Some(2),
        tetto: Tetto::fisso(u64::MAX / 2),
    })
}

const ATTESA: Duration = Duration::from_secs(10);

#[test]
fn le_famiglie_sono_quelle_del_contratto() {
    let nomi: Vec<&str> = Famiglia::TUTTE.iter().map(|f| f.nome()).collect();
    assert_eq!(nomi, DRAWING_FAMILIES);
    for f in Famiglia::TUTTE {
        assert_eq!(Famiglia::da_nome(f.nome()), Some(f));
        assert_eq!(
            f.indice(),
            Famiglia::TUTTE.iter().position(|g| *g == f).unwrap()
        );
    }
}

/// Una famiglia della mappa che `Famiglia` non conosce fa cadere questa
/// prova, e così una famiglia che la mappa non nomina più.
#[test]
fn ogni_famiglia_della_mappa_si_conosce() {
    let mut nominate = BTreeSet::new();
    for r in righe() {
        match r.nome_famiglia.as_str() {
            "fub" | "escluso" => assert!(r.famiglia.is_none(), "{r:?}"),
            nome => {
                assert!(
                    r.famiglia.is_some(),
                    "la riga `{}` nomina la famiglia `{nome}`, che `Famiglia` non conosce",
                    r.id
                );
                nominate.insert(nome);
            }
        }
    }
    let tutte: BTreeSet<&str> = DRAWING_FAMILIES.into_iter().collect();
    assert_eq!(nominate, tutte, "ogni famiglia ha le sue righe");
    // Solo il motore, gli effetti e gli strumenti.
    assert!(righe().len() > 1000, "{}", righe().len());
}

#[test]
fn la_famiglia_di_un_comando_viene_dalla_mappa() {
    assert_eq!(famiglia_di("document.inspect"), Some(Famiglia::Nucleo));
    assert_eq!(famiglia_di("path.setFillRule"), Some(Famiglia::Tracciati));
    assert_eq!(famiglia_di("threeD.extrude"), Some(Famiglia::TreD));
    assert_eq!(famiglia_di("file.new"), None, "una riga `fub`");
    assert_eq!(famiglia_di("non.esiste"), None);
}

#[test]
fn una_mappa_con_uno_stato_ignoto_non_si_legge() {
    let testo = "fonte\tid\tfamiglia\tstato\tpigro\nmotore\ta.b\tnucleo\tforse\tnucleo\n";
    assert!(leggi(testo).is_err());
    let testo = "fonte\tid\tfamiglia\tpigro\nmotore\ta.b\tnucleo\tnucleo\n";
    assert!(leggi(testo).is_err(), "senza la colonna stato");
}

/// Ogni tabella della patch 0008 appartiene a una famiglia sola, e ogni
/// nome che una famiglia dice è una tabella del motore.
#[test]
fn ogni_tabella_del_motore_ha_la_sua_famiglia() {
    let dette: Vec<(&str, &str)> = [
        ("colore", colore::TABELLE),
        ("formati", formati::TABELLE),
        ("immagini", immagini::TABELLE),
        ("raster", raster::TABELLE),
        ("testo", testo::TABELLE),
    ]
    .into_iter()
    .flat_map(|(f, t)| t.iter().map(move |n| (f, *n)))
    .collect();
    let del_motore: Vec<&str> = vectorcraft_engine::tables::tables()
        .iter()
        .map(|t| t.name)
        .collect();
    for (famiglia, nome) in &dette {
        assert!(
            del_motore.contains(nome),
            "la famiglia `{famiglia}` dice la tabella `{nome}`, che il motore non ha"
        );
    }
    for nome in &del_motore {
        let quante = dette.iter().filter(|(_, n)| n == nome).count();
        assert_eq!(quante, 1, "la tabella `{nome}` ha {quante} famiglie");
    }
}

#[test]
fn una_famiglia_nasce_al_primo_uso_e_si_iscrive_nel_budget() {
    let servizi = servizi();
    let famiglie = Famiglie::nuove(Arc::clone(&servizi));
    assert!(famiglie.nate().is_empty());
    assert_eq!(servizi.memoria().quante(), 0, "nessuna cache prima");

    let nucleo = famiglie.prendi(Famiglia::Nucleo).unwrap();
    assert_eq!(nucleo.nome(), "disegno.nucleo");
    assert_eq!(famiglie.nate(), [Famiglia::Nucleo]);
    assert_eq!(servizi.memoria().quante(), 1);
    // La seconda chiamata trova lo stesso stato e non si iscrive di nuovo.
    let ancora = famiglie.prendi(Famiglia::Nucleo).unwrap();
    assert!(Arc::ptr_eq(&nucleo, &ancora));
    assert_eq!(servizi.memoria().quante(), 1);
    assert_eq!(famiglie.nascite(Famiglia::Nucleo), 1);
    drop((nucleo, ancora));

    famiglie.prendi(Famiglia::Tracciati).unwrap();
    assert_eq!(famiglie.nate(), [Famiglia::Nucleo, Famiglia::Tracciati]);
    assert_eq!(servizi.memoria().quante(), 2);
}

#[test]
fn svuotare_il_budget_rimette_le_famiglie_da_nascere() {
    let servizi = servizi();
    let famiglie = Famiglie::nuove(Arc::clone(&servizi));
    famiglie.prendi(Famiglia::Nucleo).unwrap();
    famiglie.prendi(Famiglia::Tracciati).unwrap();
    servizi.memoria().svuota_tutto();
    assert!(famiglie.nate().is_empty());
    assert_eq!(famiglie.byte(), 0);
    assert_eq!(servizi.memoria().quante(), 0, "le cache lasciano il budget");
    // La chiamata dopo la rifà.
    famiglie.prendi(Famiglia::Nucleo).unwrap();
    assert_eq!(famiglie.nascite(Famiglia::Nucleo), 2);
    assert_eq!(servizi.memoria().quante(), 1);
}

/// Il `Budget` libera una famiglia mentre un suo comando la tiene: il
/// comando tiene il suo stato, e la famiglia rinasce alla chiamata dopo.
#[test]
fn chi_tiene_lo_stato_lo_tiene_anche_liberato() {
    let servizi = servizi();
    let famiglie = Famiglie::nuove(Arc::clone(&servizi));
    let tenuta = famiglie.prendi(Famiglia::Nucleo).unwrap();
    servizi.memoria().svuota_tutto();
    assert!(famiglie.nate().is_empty());
    assert_eq!(tenuta.famiglia(), Famiglia::Nucleo);
    let nuova = famiglie.prendi(Famiglia::Nucleo).unwrap();
    assert!(!Arc::ptr_eq(&tenuta, &nuova));
    // Liberare quella vecchia non tocca quella nuova.
    Cache::libera(tenuta.as_ref(), u64::MAX);
    assert_eq!(famiglie.nate(), [Famiglia::Nucleo]);
}

#[test]
fn due_preparazioni_insieme_fanno_un_lavoro_solo() {
    let famiglie = Famiglie::nuove(servizi());
    let barriera = Arc::new(Barrier::new(2));
    let fili: Vec<_> = (0..2)
        .map(|_| {
            let famiglie = Arc::clone(&famiglie);
            let barriera = Arc::clone(&barriera);
            thread::spawn(move || {
                barriera.wait();
                famiglie.prepara(Famiglia::Testo).unwrap()
            })
        })
        .collect();
    for filo in fili {
        let stato = filo.join().unwrap();
        assert!(
            matches!(stato, Preparazione::InCorso | Preparazione::Pronta),
            "{stato:?}"
        );
    }
    assert!(famiglie.aspetta_i_lavori(ATTESA));
    assert_eq!(famiglie.lavori_avviati(), 1);
    assert_eq!(famiglie.nascite(Famiglia::Testo), 1);
    assert_eq!(
        famiglie.prepara(Famiglia::Testo).unwrap(),
        Preparazione::Pronta
    );
    assert_eq!(famiglie.lavori_avviati(), 1, "pronta: nessun lavoro nuovo");
}

/// Spente mentre un lavoro gira: l'esito del lavoro si butta, e nessuna
/// famiglia resta nata.
#[test]
fn l_esito_di_un_giro_passato_si_butta() {
    let famiglie = Famiglie::nuove(servizi());
    for _ in 0..20 {
        famiglie.prepara(Famiglia::Livelli).unwrap();
        famiglie.spegni();
        assert!(famiglie.aspetta_i_lavori(ATTESA));
        assert!(famiglie.nate().is_empty(), "{:?}", famiglie.nate());
    }
}

/// Una cache che pesa e non si libera: il budget resta sopra il tetto.
struct Piena;

impl Cache for Piena {
    fn nome(&self) -> &str {
        "prova.piena"
    }
    fn byte(&self) -> u64 {
        1_000
    }
    fn libera(&self, _quanto: u64) -> u64 {
        0
    }
    fn ultimo_uso(&self) -> Instant {
        Instant::now()
    }
}

#[test]
fn senza_memoria_una_famiglia_non_nasce() {
    let servizi = Servizi::nuovi(Config {
        fili: Some(1),
        tetto: Tetto::fisso(10),
    });
    let piena: Arc<dyn Cache> = Arc::new(Piena);
    servizi.memoria().registra(&piena);
    let famiglie = Famiglie::nuove(Arc::clone(&servizi));
    assert_eq!(
        famiglie.prepara(Famiglia::Nucleo).unwrap(),
        Preparazione::NoMemory
    );
    assert!(famiglie.per_un_comando(Famiglia::Nucleo).unwrap().is_none());
    assert!(famiglie.nate().is_empty());
    assert_eq!(famiglie.lavori_avviati(), 0);
    drop(piena);
    // Liberata la memoria, la famiglia nasce.
    assert!(famiglie.per_un_comando(Famiglia::Nucleo).unwrap().is_some());
}

#[test]
fn il_filtro_lascia_passare_le_righe_giuste() {
    let unserved = |r: Result<Option<(&Riga, Famiglia)>, PluginError>| {
        matches!(r, Err(PluginError::Unserved(_)))
    };
    // Nessuna riga è fatta: con `Fatte` una riga da fare è `Unserved`.
    assert!(unserved(riga_del_comando(
        "disegno.path.setFillRule",
        Filtro::Fatte
    )));
    let (riga, famiglia) = riga_del_comando("disegno.path.setFillRule", Filtro::Tutte)
        .unwrap()
        .unwrap();
    assert_eq!(riga.id, "path.setFillRule");
    assert_eq!(famiglia, Famiglia::Tracciati);
    // Una riga `fub` o esclusa non arriva al motore, con nessun filtro.
    assert!(riga_del_comando("disegno.file.new", Filtro::Tutte)
        .unwrap()
        .is_none());
    // Un id senza il prefisso, o che la mappa non ha.
    assert!(riga_del_comando("path.setFillRule", Filtro::Tutte)
        .unwrap()
        .is_none());
    assert!(riga_del_comando("disegno.non.esiste", Filtro::Tutte)
        .unwrap()
        .is_none());
}

#[test]
fn liberare_una_famiglia_svuota_le_sue_tabelle() {
    // Le tabelle sono del processo: qui si guarda soltanto che svuotarle
    // non cada e non renda più di ciò che c'era.
    let prima = byte_delle_tabelle(immagini::TABELLE);
    let reso = libera_le_tabelle(immagini::TABELLE);
    assert!(reso <= prima);
    assert_eq!(libera_le_tabelle(testo::TABELLE), 0, "non si svuotano");
}

#[test]
fn un_effetto_da_fare_passa_solo_col_filtro_delle_prove() {
    // Tutti gli effetti della mappa sono fatti: la regola si prova su una riga finta.
    let riga = |stato, sotto: Option<&str>| Riga {
        fonte: Fonte::Effetto,
        id: "prova.effetto".into(),
        nome_famiglia: "effetti".into(),
        famiglia: Some(Famiglia::Effetti),
        stato,
        sotto: sotto.map(Into::into),
    };
    let da_fare = riga(StatoRiga::DaFare, None);
    assert!(matches!(
        servito_dalla_riga(Some(&da_fare), Filtro::Fatte),
        Err(PluginError::Unserved(_))
    ));
    assert!(servito_dalla_riga(Some(&da_fare), Filtro::Tutte).unwrap());
    let fatto = riga(StatoRiga::Fatto, None);
    assert!(servito_dalla_riga(Some(&fatto), Filtro::Fatte).unwrap());
    for no in [
        riga(StatoRiga::Fub, None),
        riga(StatoRiga::Escluso, None),
        riga(StatoRiga::Fatto, Some("plugins")),
    ] {
        assert!(!servito_dalla_riga(Some(&no), Filtro::Tutte).unwrap());
    }
    assert!(!servito_dalla_riga(None, Filtro::Tutte).unwrap());
}
