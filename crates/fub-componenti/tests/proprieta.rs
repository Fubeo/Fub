//! Le proprietà del risolutore, su 10.000 mappe casuali.
//!
//! Niente proptest: il generatore è un xorshift deterministico con seme fisso,
//! come nei test del kernel. Ogni caso ha il suo seme, derivato dal numero del
//! caso, e il messaggio di un caso che fallisce lo stampa: per rifarlo basta
//! quel seme in `caso_da`.
//!
//! I requisiti il test li risolve da sé, mentre genera la mappa: confrontare il
//! risolutore con la propria risoluzione renderebbe il test cieco proprio sulla
//! regola che deve guardare.

use std::collections::{BTreeMap, BTreeSet};

use fub_componenti::{Componente, Errore, ErroreMappa, Id, Mappa, Perche, Profilo, Stato};

const CASI: u64 = 10_000;
const SEME: u64 = 0x5EED_C0DE_2026_1101;
const MAX_COMPONENTI: usize = 40;
const PASSI: usize = 8;

// --- PRNG deterministico (xorshift64) ----------------------------------------

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn coin(&mut self, una_su: usize) -> bool {
        self.below(una_su) == 0
    }
}

fn seme_del_caso(caso: u64) -> u64 {
    SEME ^ caso.wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

// --- generazione --------------------------------------------------------------

/// Una mappa casuale aciclica e i suoi requisiti, risolti dal test.
struct Caso {
    righe: Vec<Componente>,
    nucleo: Vec<Id>,
    /// I requisiti diretti di ogni id, risolti qui e non dal risolutore.
    archi: BTreeMap<Id, BTreeSet<Id>>,
    ids: Vec<Id>,
}

fn id(i: usize) -> Id {
    format!("c{i}")
}

fn offerta(i: usize) -> Id {
    format!("offre-{i}")
}

/// Aciclica per costruzione: `c{i}` richiede soltanto componenti con indice
/// minore, per id o per ciò che offrono.
fn caso_da(rng: &mut Rng) -> Caso {
    let n = rng.below(MAX_COMPONENTI + 1);
    let mut righe = Vec::with_capacity(n);
    let mut archi = BTreeMap::new();
    let mut offre = Vec::with_capacity(n);
    for i in 0..n {
        let provides = if rng.coin(3) {
            vec![offerta(i)]
        } else {
            Vec::new()
        };
        offre.push(!provides.is_empty());
        let mut requires = Vec::new();
        let mut diretti = BTreeSet::new();
        if i > 0 {
            for _ in 0..rng.below(4) {
                let j = rng.below(i);
                requires.push(if offre[j] && rng.coin(2) {
                    offerta(j)
                } else {
                    id(j)
                });
                diretti.insert(id(j));
            }
        }
        // Un `uses` può nominare chiunque, anche chi non esiste.
        let uses = (0..rng.below(3)).map(|_| id(rng.below(n + 5))).collect();
        let gruppo = Some(if rng.coin(3) { "supporto" } else { "altro" }.to_string());
        archi.insert(id(i), diretti);
        righe.push(Componente {
            id: id(i),
            requires,
            uses,
            gruppo,
            provides,
        });
    }
    let nucleo = if n == 0 {
        Vec::new()
    } else {
        (0..rng.below(3)).map(|_| id(rng.below(n))).collect()
    };
    let ids = (0..n).map(id).collect();
    Caso {
        righe,
        nucleo,
        archi,
        ids,
    }
}

/// Un id della mappa, o ogni tanto uno che la mappa non ha.
fn un_id(rng: &mut Rng, caso: &Caso) -> Id {
    if caso.ids.is_empty() || rng.coin(8) {
        format!("ignoto-{}", rng.below(4))
    } else {
        caso.ids[rng.below(caso.ids.len())].clone()
    }
}

fn stato_da(rng: &mut Rng, caso: &Caso) -> Stato {
    let mut stato = Stato::default();
    for _ in 0..rng.below(6) {
        stato.scelti.insert(un_id(rng, caso));
    }
    for _ in 0..rng.below(4) {
        stato.in_attesa.insert(un_id(rng, caso));
    }
    stato
}

fn sottoinsieme(rng: &mut Rng, da: &BTreeSet<Id>) -> Vec<Id> {
    da.iter().filter(|_| rng.coin(2)).cloned().collect()
}

/// Un passo casuale: una delle operazioni del risolutore, con gli errori che
/// lasciano lo stato com'è.
fn passo(rng: &mut Rng, mappa: &Mappa, caso: &Caso, stato: &Stato) -> Stato {
    match rng.below(6) {
        0 => match mappa.accendi(stato, &un_id(rng, caso)) {
            Ok((s, _)) => s,
            Err(_) => stato.clone(),
        },
        1 | 2 => {
            let bersaglio = un_id(rng, caso);
            let esito = if rng.coin(2) {
                mappa.spegni(stato, &bersaglio)
            } else {
                mappa.spegni_con_dipendenti(stato, &bersaglio)
            };
            match esito {
                Ok((s, e)) => match rng.below(3) {
                    0 => mappa.togli(&s, &e.orfani),
                    1 => mappa.tieni(&s, &e.orfani),
                    _ => s,
                },
                Err(_) => stato.clone(),
            }
        }
        3 => mappa.togli(stato, &sottoinsieme(rng, &stato.in_attesa)),
        4 => mappa.tieni(stato, &sottoinsieme(rng, &stato.in_attesa)),
        _ => {
            let profilo = Profilo {
                nome: "casuale".into(),
                componenti: (0..rng.below(5)).map(|_| un_id(rng, caso)).collect(),
            };
            mappa.applica_profilo(stato, &profilo).0
        }
    }
}

fn costruisci(caso: &Caso, dove: &str) -> Mappa {
    Mappa::nuova(caso.righe.clone(), caso.nucleo.clone())
        .unwrap_or_else(|e| panic!("{dove}: la mappa aciclica non si costruisce: {e}"))
}

/// Gira `CASI` casi, ognuno col suo seme.
fn per_ogni_caso(prova: impl Fn(&mut Rng, &str)) {
    for caso in 0..CASI {
        let seme = seme_del_caso(caso);
        let dove = format!("caso {caso}, seme {seme:#018x}");
        prova(&mut Rng::new(seme), &dove);
    }
}

// --- le proprietà --------------------------------------------------------------

#[test]
fn nessun_attivo_con_un_requisito_spento() {
    per_ogni_caso(|rng, dove| {
        let caso = caso_da(rng);
        let mappa = costruisci(&caso, dove);
        let mut stato = stato_da(rng, &caso);
        for n in 0..=PASSI {
            let attivi = mappa.attivi(&stato);
            for a in &attivi {
                for r in &caso.archi[a] {
                    assert!(
                        attivi.contains(r),
                        "{dove}, passo {n}: «{a}» è acceso e il suo requisito «{r}» no\n\
                         stato: {stato:?}\nattivi: {attivi:?}"
                    );
                }
            }
            stato = passo(rng, &mappa, &caso, &stato);
        }
    });
}

#[test]
fn accendi_poi_spegni_torna_a_prima() {
    let mut provati = 0;
    for caso_n in 0..CASI {
        let seme = seme_del_caso(caso_n);
        let dove = format!("caso {caso_n}, seme {seme:#018x}");
        let rng = &mut Rng::new(seme);
        let caso = caso_da(rng);
        let mappa = costruisci(&caso, &dove);
        let prima = stato_da(rng, &caso);
        let attivi = mappa.attivi(&prima);
        let spenti: Vec<&Id> = caso.ids.iter().filter(|i| !attivi.contains(*i)).collect();
        if spenti.is_empty() {
            continue;
        }
        let bersaglio = spenti[rng.below(spenti.len())].clone();
        let (acceso, _) = mappa
            .accendi(&prima, &bersaglio)
            .unwrap_or_else(|e| panic!("{dove}: accendi «{bersaglio}»: {e}"));
        let (spento, effetto) = mappa
            .spegni_con_dipendenti(&acceso, &bersaglio)
            .unwrap_or_else(|e| panic!("{dove}: spegni «{bersaglio}»: {e}"));
        let dopo = mappa.togli(&spento, &effetto.orfani);
        assert_eq!(
            dopo, prima,
            "{dove}: accendi, spegni e togli «{bersaglio}» non tornano allo stato di partenza\n\
             effetto dello spegnimento: {effetto:?}"
        );
        provati += 1;
    }
    assert!(
        provati > CASI / 2,
        "solo {provati} casi avevano un id spento"
    );
}

#[test]
fn un_ciclo_e_un_errore_della_mappa() {
    per_ogni_caso(|rng, dove| {
        let mut caso = caso_da(rng);
        if caso.ids.is_empty() {
            return;
        }
        // Da `c{i}` si scende lungo i requisiti fino a `c{k}` (anche zero
        // passi: un componente che richiede sé stesso), e `c{k}` richiede `c{i}`.
        let i = rng.below(caso.ids.len());
        let mut k = id(i);
        for _ in 0..rng.below(4) {
            let giu: Vec<&Id> = caso.archi[&k].iter().collect();
            if giu.is_empty() {
                break;
            }
            k = giu[rng.below(giu.len())].clone();
        }
        let indice_k: usize = k[1..].parse().expect("id della forma c{n}");
        let offre_i = caso.righe[i].provides.first().cloned();
        let nome = match offre_i {
            Some(o) if rng.coin(2) => o,
            _ => id(i),
        };
        caso.righe[indice_k].requires.push(nome);
        caso.archi.get_mut(&k).expect("k c'è").insert(id(i));

        match Mappa::nuova(caso.righe.clone(), caso.nucleo.clone()) {
            Err(ErroreMappa::Ciclo(giro)) => {
                assert!(giro.len() >= 2, "{dove}: giro troppo corto {giro:?}");
                assert_eq!(giro.first(), giro.last(), "{dove}: giro aperto {giro:?}");
                for coppia in giro.windows(2) {
                    assert!(
                        caso.archi[&coppia[0]].contains(&coppia[1]),
                        "{dove}: il giro {giro:?} passa per «{} → {}», che non è un requisito",
                        coppia[0],
                        coppia[1]
                    );
                }
            }
            Ok(_) => panic!(
                "{dove}: «{k}» richiede «{}» e la mappa col ciclo si costruisce",
                id(i)
            ),
            Err(altro) => panic!("{dove}: atteso un ciclo, trovato {altro:?}"),
        }
    });
}

#[test]
fn il_nucleo_non_si_spegne() {
    per_ogni_caso(|rng, dove| {
        let caso = caso_da(rng);
        let mappa = costruisci(&caso, dove);
        let mut stato = stato_da(rng, &caso);
        for n in 0..=PASSI {
            let attivi = mappa.attivi(&stato);
            for nucleo in &caso.nucleo {
                assert!(
                    attivi.contains(nucleo),
                    "{dove}, passo {n}: «{nucleo}» è del nucleo ed è spento\nstato: {stato:?}"
                );
                assert_eq!(
                    mappa.spegni(&stato, nucleo),
                    Err(Errore::Nucleo),
                    "{dove}, passo {n}: spegni «{nucleo}», del nucleo"
                );
                assert_eq!(
                    mappa.spegni_con_dipendenti(&stato, nucleo),
                    Err(Errore::Nucleo),
                    "{dove}, passo {n}: spegni con dipendenti «{nucleo}», del nucleo"
                );
                assert_eq!(mappa.perche(&stato, nucleo), Perche::Nucleo, "{dove}");
            }
            stato = passo(rng, &mappa, &caso, &stato);
        }
    });
}

// --- casi limite ----------------------------------------------------------------

fn riga(id: &str, requires: &[&str]) -> Componente {
    Componente {
        id: id.into(),
        requires: requires.iter().map(|r| r.to_string()).collect(),
        ..Componente::default()
    }
}

fn ids(v: &[&str]) -> Vec<Id> {
    v.iter().map(|s| s.to_string()).collect()
}

fn insieme(v: &[&str]) -> BTreeSet<Id> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn la_mappa_vuota() {
    let mappa = Mappa::nuova(Vec::new(), Vec::<Id>::new()).expect("vuota");
    let stato = Stato {
        scelti: insieme(&["x"]),
        in_attesa: insieme(&["y"]),
    };
    assert!(mappa.attivi(&stato).is_empty());
    assert_eq!(
        mappa.accendi(&stato, "x"),
        Err(Errore::Sconosciuto("x".into()))
    );
    assert_eq!(
        mappa.spegni(&stato, "x"),
        Err(Errore::Sconosciuto("x".into()))
    );
    assert_eq!(mappa.perche(&stato, "x"), Perche::Sconosciuto);
}

#[test]
fn gli_errori_della_mappa() {
    assert_eq!(
        Mappa::nuova(vec![riga("a", &[]), riga("a", &[])], Vec::<Id>::new()).unwrap_err(),
        ErroreMappa::IdDoppio("a".into())
    );
    assert_eq!(
        Mappa::nuova(vec![riga("a", &["b"])], Vec::<Id>::new()).unwrap_err(),
        ErroreMappa::RequisitoSenzaOfferta {
            di: "a".into(),
            requisito: "b".into()
        }
    );
    assert_eq!(
        Mappa::nuova(vec![riga("a", &[])], ["z"]).unwrap_err(),
        ErroreMappa::NucleoSconosciuto("z".into())
    );
    assert_eq!(
        Mappa::nuova(vec![riga("a", &["a"])], Vec::<Id>::new()).unwrap_err(),
        ErroreMappa::Ciclo(ids(&["a", "a"]))
    );
    let offre = |id: &str| Componente {
        id: id.into(),
        provides: ids(&["motore"]),
        ..Componente::default()
    };
    assert_eq!(
        Mappa::nuova(
            vec![riga("a", &["motore"]), offre("m1"), offre("m2")],
            Vec::<Id>::new()
        )
        .unwrap_err(),
        ErroreMappa::RequisitoAmbiguo {
            di: "a".into(),
            requisito: "motore".into(),
            offerto_da: ids(&["m1", "m2"])
        }
    );
}

#[test]
fn un_requisito_si_risolve_per_quello_che_si_offre() {
    let mappa = Mappa::nuova(
        vec![
            riga("a", &["motore"]),
            Componente {
                id: "m".into(),
                provides: ids(&["motore"]),
                ..Componente::default()
            },
        ],
        Vec::<Id>::new(),
    )
    .expect("mappa");
    let (stato, effetto) = mappa.accendi(&Stato::default(), "a").expect("accendi");
    assert_eq!(effetto.accesi_anche, ids(&["m"]));
    assert_eq!(mappa.attivi(&stato), insieme(&["a", "m"]));
}

#[test]
fn uses_verso_chi_non_esiste_e_permesso_e_non_accende_niente() {
    let mappa = Mappa::nuova(
        vec![
            Componente {
                id: "a".into(),
                uses: ids(&["fantasma", "b"]),
                ..Componente::default()
            },
            riga("b", &[]),
        ],
        Vec::<Id>::new(),
    )
    .expect("un uses verso chi non c'è è permesso");
    let (stato, effetto) = mappa.accendi(&Stato::default(), "a").expect("accendi");
    assert!(effetto.accesi_anche.is_empty());
    assert_eq!(mappa.attivi(&stato), insieme(&["a"]));
}

#[test]
fn accendere_un_gia_scelto_e_spegnere_un_gia_spento_non_fanno_niente() {
    let mappa =
        Mappa::nuova(vec![riga("a", &["b"]), riga("b", &[])], Vec::<Id>::new()).expect("mappa");
    let stato = Stato {
        scelti: insieme(&["a", "ignoto"]),
        in_attesa: insieme(&["perso"]),
    };
    let (dopo, effetto) = mappa.accendi(&stato, "a").expect("accendi");
    assert_eq!((dopo, effetto), (stato.clone(), Default::default()));

    let vuoto = Stato::default();
    let (dopo, effetto) = mappa.spegni(&vuoto, "a").expect("già spento");
    assert_eq!((dopo, effetto), (vuoto, Default::default()));

    // Gli id sconosciuti nello stato non accendono niente e restano dove sono.
    assert_eq!(mappa.attivi(&stato), insieme(&["a", "b"]));
    let (dopo, _) = mappa.spegni(&stato, "a").expect("spegni");
    assert!(dopo.scelti.contains("ignoto") && dopo.in_attesa.contains("perso"));
}

#[test]
fn gli_orfani_a_catena() {
    // a → b → c: spegnere `a` lascia orfani `b` e anche `c`, che `b` teneva acceso.
    let mappa = Mappa::nuova(
        vec![riga("a", &["b"]), riga("b", &["c"]), riga("c", &[])],
        Vec::<Id>::new(),
    )
    .expect("mappa");
    let (stato, _) = mappa.accendi(&Stato::default(), "a").expect("accendi");
    let (stato, effetto) = mappa.spegni(&stato, "a").expect("spegni");
    assert_eq!(effetto.orfani, ids(&["b", "c"]));
    assert_eq!(stato.in_attesa, insieme(&["b", "c"]));
    assert_eq!(mappa.attivi(&stato), insieme(&["b", "c"]), "restano accesi");
    assert_eq!(mappa.perche(&stato, "b"), Perche::InAttesa);
    assert_eq!(mappa.perche(&stato, "c"), Perche::RichiestoDa(ids(&["b"])));

    // Togli solo `b`: `c` resta in attesa, acceso.
    let tolto = mappa.togli(&stato, &ids(&["b"]));
    assert_eq!(mappa.attivi(&tolto), insieme(&["c"]));
    // Tienili: passano a `scelti`.
    let tenuti = mappa.tieni(&stato, &effetto.orfani);
    assert_eq!(tenuti.scelti, insieme(&["b", "c"]));
    assert!(tenuti.in_attesa.is_empty());
}
