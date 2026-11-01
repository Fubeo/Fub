//! Il risolutore dei componenti: una sola definizione di «acceso», «richiesto
//! da» e «non serve più».
//!
//! Host, CLI, MCP e test chiedono a questo crate, e a nessun altro, che cosa è
//! acceso in uno [`Stato`] e che cosa cambia quando si accende, si spegne o si
//! applica un profilo. Il crate è puro: non fa I/O, non conosce il vault né il
//! manifest dei componenti, e non dipende da `fub-abi`. Chi costruisce la
//! [`Mappa`] traduce le righe del proprio catalogo in [`Componente`].
//!
//! # Le regole
//!
//! - Un requisito (`requires`) si risolve per id o, se nessun componente ha
//!   quell'id, per `provides`. I `uses` («usa se c'è») non accendono niente e
//!   possono nominare un id che la mappa non ha.
//! - Acceso vuol dire: nel nucleo, oppure scelto, oppure in attesa di una
//!   risposta, oppure richiesto (a catena) da uno di questi.
//! - Il nucleo non si spegne.
//! - Spegnere un componente che serve a qualcun altro di acceso è rifiutato
//!   ([`Errore::Richiesto`]), a meno di spegnere anche chi lo richiede
//!   ([`Mappa::spegni_con_dipendenti`]).
//! - Ciò che dopo uno spegnimento non serve più (gli orfani) non si spegne da
//!   solo: va in `in_attesa` e resta acceso finché chi chiama non risponde con
//!   [`Mappa::togli`] o [`Mappa::tieni`].

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::{Deserialize, Serialize};

/// L'identificativo di un componente, o il nome di ciò che offre.
pub type Id = String;

/// Una riga della mappa: un componente con ciò che richiede, usa e offre.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Componente {
    pub id: Id,
    /// Senza questi il componente non funziona: accenderlo li accende.
    pub requires: Vec<Id>,
    /// Usa se c'è: non accende niente, e può nominare un id che non esiste.
    pub uses: Vec<Id>,
    /// Il gruppo in cui lo mostra chi lo elenca (`scrivere`, `supporto`, …).
    pub gruppo: Option<String>,
    /// I nomi con cui un requisito lo può trovare, oltre al suo id.
    pub provides: Vec<Id>,
}

/// Che cosa ha chiesto chi usa l'app.
///
/// `scelti` sono i componenti accesi a mano o dal profilo; `in_attesa` gli
/// orfani di uno spegnimento, ancora accesi in attesa di Togli o Tienili. Un id
/// che la mappa non conosce non accende niente e resta dov'è.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stato {
    pub scelti: BTreeSet<Id>,
    pub in_attesa: BTreeSet<Id>,
}

/// Che cosa un'operazione ha cambiato oltre al componente nominato.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Effetto {
    /// Accesi perché richiesti («Attivati anche …: … non funziona senza»).
    pub accesi_anche: Vec<Id>,
    /// Spenti insieme al componente nominato, o dal profilo.
    pub spenti_anche: Vec<Id>,
    /// Non servono più: sono in `in_attesa`, ancora accesi.
    pub orfani: Vec<Id>,
    /// `(chi lo chiede, id)` per ogni id che la mappa non ha.
    pub mancanti: Vec<(Id, Id)>,
}

/// Perché un componente è acceso, o che non lo è.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Perche {
    /// Fa parte del nucleo: è sempre acceso.
    Nucleo,
    /// Scelto a mano o dal profilo.
    Scelto,
    /// Acceso perché questi componenti accesi lo richiedono direttamente.
    RichiestoDa(Vec<Id>),
    /// Non serve più a nessuno: acceso finché non si risponde.
    InAttesa,
    Spento,
    /// La mappa non ha questo id.
    Sconosciuto,
}

/// Un profilo: un nome e i componenti che sceglie.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profilo {
    pub nome: Id,
    pub componenti: Vec<Id>,
}

/// Perché una mappa non si costruisce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroreMappa {
    /// Due righe con lo stesso id.
    IdDoppio(Id),
    /// `di` richiede `requisito`, e nessuno ha quell'id né lo offre.
    RequisitoSenzaOfferta { di: Id, requisito: Id },
    /// `requisito` non è un id e lo offrono più componenti.
    RequisitoAmbiguo {
        di: Id,
        requisito: Id,
        offerto_da: Vec<Id>,
    },
    /// Un ciclo nei `requires`: il primo e l'ultimo elemento coincidono.
    Ciclo(Vec<Id>),
    /// Il nucleo nomina un id che la mappa non ha.
    NucleoSconosciuto(Id),
}

impl fmt::Display for ErroreMappa {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::IdDoppio(id) => write!(f, "il componente «{id}» compare due volte"),
            Self::RequisitoSenzaOfferta { di, requisito } => write!(
                f,
                "«{di}» richiede «{requisito}», che nessun componente è né offre"
            ),
            Self::RequisitoAmbiguo {
                di,
                requisito,
                offerto_da,
            } => write!(
                f,
                "«{di}» richiede «{requisito}», che offrono in più: {}",
                offerto_da.join(", ")
            ),
            Self::Ciclo(giro) => write!(f, "ciclo nei requisiti: {}", giro.join(" → ")),
            Self::NucleoSconosciuto(id) => {
                write!(f, "il nucleo nomina «{id}», che la mappa non ha")
            }
        }
    }
}

impl std::error::Error for ErroreMappa {}

/// Perché un'operazione su uno stato è rifiutata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Errore {
    /// La mappa non ha questo id.
    Sconosciuto(Id),
    /// Il nucleo non si spegne.
    Nucleo,
    /// Serve a questi componenti accesi (a catena).
    Richiesto { da: Vec<Id> },
}

impl fmt::Display for Errore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sconosciuto(id) => write!(f, "nessun componente «{id}»"),
            Self::Nucleo => write!(f, "il nucleo non si spegne"),
            Self::Richiesto { da } => write!(f, "serve a {}", da.join(", ")),
        }
    }
}

impl std::error::Error for Errore {}

/// La mappa dei componenti, con i requisiti già risolti e senza cicli.
#[derive(Debug, Clone)]
pub struct Mappa {
    righe: BTreeMap<Id, Componente>,
    /// I requisiti diretti di ogni componente, risolti in id, ordinati.
    richiesti: BTreeMap<Id, Vec<Id>>,
    nucleo: BTreeSet<Id>,
}

impl Mappa {
    /// Costruisce la mappa: risolve i requisiti, controlla il nucleo e cerca i
    /// cicli. Chi costruisce la propria mappa da un dato fisso la prova in un
    /// test, così l'errore si vede a build time.
    pub fn nuova<I>(righe: Vec<Componente>, nucleo: I) -> Result<Mappa, ErroreMappa>
    where
        I: IntoIterator,
        I::Item: Into<Id>,
    {
        let mut per_id: BTreeMap<Id, Componente> = BTreeMap::new();
        for riga in righe {
            if per_id.contains_key(&riga.id) {
                return Err(ErroreMappa::IdDoppio(riga.id));
            }
            per_id.insert(riga.id.clone(), riga);
        }

        let mut offerte: BTreeMap<&str, Vec<&Id>> = BTreeMap::new();
        for c in per_id.values() {
            for nome in &c.provides {
                let chi = offerte.entry(nome.as_str()).or_default();
                if !chi.contains(&&c.id) {
                    chi.push(&c.id);
                }
            }
        }

        let mut richiesti: BTreeMap<Id, Vec<Id>> = BTreeMap::new();
        for c in per_id.values() {
            let mut diretti = BTreeSet::new();
            for requisito in &c.requires {
                if per_id.contains_key(requisito) {
                    diretti.insert(requisito.clone());
                    continue;
                }
                match offerte.get(requisito.as_str()).map(Vec::as_slice) {
                    None | Some([]) => {
                        return Err(ErroreMappa::RequisitoSenzaOfferta {
                            di: c.id.clone(),
                            requisito: requisito.clone(),
                        })
                    }
                    Some([unico]) => {
                        diretti.insert((*unico).clone());
                    }
                    Some(molti) => {
                        return Err(ErroreMappa::RequisitoAmbiguo {
                            di: c.id.clone(),
                            requisito: requisito.clone(),
                            offerto_da: molti.iter().map(|id| (*id).clone()).collect(),
                        })
                    }
                }
            }
            richiesti.insert(c.id.clone(), diretti.into_iter().collect());
        }

        let mut set_nucleo = BTreeSet::new();
        for id in nucleo {
            let id: Id = id.into();
            if !per_id.contains_key(&id) {
                return Err(ErroreMappa::NucleoSconosciuto(id));
            }
            set_nucleo.insert(id);
        }

        if let Some(giro) = trova_ciclo(&richiesti) {
            return Err(ErroreMappa::Ciclo(giro));
        }

        Ok(Mappa {
            righe: per_id,
            richiesti,
            nucleo: set_nucleo,
        })
    }

    /// La riga di un componente.
    pub fn componente(&self, id: &str) -> Option<&Componente> {
        self.righe.get(id)
    }

    /// Tutte le righe, in ordine di id.
    pub fn componenti(&self) -> impl Iterator<Item = &Componente> {
        self.righe.values()
    }

    /// I requisiti diretti di `id`, risolti in id (vuoto se `id` non c'è).
    pub fn richiesti(&self, id: &str) -> &[Id] {
        self.richiesti.get(id).map(Vec::as_slice).unwrap_or(&[])
    }

    pub fn nucleo(&self) -> &BTreeSet<Id> {
        &self.nucleo
    }

    /// Gli accesi: il nucleo, più la chiusura dei `requires` a partire dal
    /// nucleo, da `scelti` e da `in_attesa`. Un id sconosciuto non accende
    /// niente; `uses` non accende niente.
    pub fn attivi(&self, stato: &Stato) -> BTreeSet<Id> {
        let mut attivi = BTreeSet::new();
        let mut da_fare: Vec<&Id> = self
            .nucleo
            .iter()
            .chain(stato.scelti.iter())
            .chain(stato.in_attesa.iter())
            .filter(|id| self.righe.contains_key(*id))
            .collect();
        while let Some(id) = da_fare.pop() {
            if attivi.insert(id.clone()) {
                da_fare.extend(self.richiesti(id));
            }
        }
        attivi
    }

    /// Accende `id`: lo toglie da `in_attesa` e lo mette in `scelti`.
    /// Accendere un componente già scelto, o del nucleo, non cambia niente.
    pub fn accendi(&self, stato: &Stato, id: &str) -> Result<(Stato, Effetto), Errore> {
        self.conosciuto(id)?;
        if self.nucleo.contains(id) || stato.scelti.contains(id) {
            return Ok((stato.clone(), Effetto::default()));
        }
        let prima = self.attivi(stato);
        let mut nuovo = stato.clone();
        nuovo.in_attesa.remove(id);
        nuovo.scelti.insert(id.to_string());
        let dopo = self.attivi(&nuovo);
        let accesi_anche = dopo
            .difference(&prima)
            .filter(|a| a.as_str() != id)
            .cloned()
            .collect();
        Ok((
            nuovo,
            Effetto {
                accesi_anche,
                ..Effetto::default()
            },
        ))
    }

    /// Spegne `id`, se nessun componente acceso lo richiede (a catena);
    /// altrimenti [`Errore::Richiesto`] con chi lo richiede. Spegnere un
    /// componente già spento non cambia niente.
    pub fn spegni(&self, stato: &Stato, id: &str) -> Result<(Stato, Effetto), Errore> {
        self.spegni_interno(stato, id, false)
    }

    /// Spegne `id` e tutti i componenti accesi che lo richiedono, a catena
    /// (`Effetto::spenti_anche`).
    pub fn spegni_con_dipendenti(
        &self,
        stato: &Stato,
        id: &str,
    ) -> Result<(Stato, Effetto), Errore> {
        self.spegni_interno(stato, id, true)
    }

    /// Togli: gli orfani escono da `in_attesa` e si spengono.
    pub fn togli(&self, stato: &Stato, orfani: &[Id]) -> Stato {
        let mut nuovo = stato.clone();
        for id in orfani {
            nuovo.in_attesa.remove(id);
        }
        nuovo
    }

    /// Tienili: gli orfani passano da `in_attesa` a `scelti`. Un id che non è
    /// in attesa resta dov'è.
    pub fn tieni(&self, stato: &Stato, orfani: &[Id]) -> Stato {
        let mut nuovo = stato.clone();
        for id in orfani {
            if nuovo.in_attesa.remove(id) {
                nuovo.scelti.insert(id.clone());
            }
        }
        nuovo
    }

    /// Perché `id` è acceso, o che è spento.
    pub fn perche(&self, stato: &Stato, id: &str) -> Perche {
        if !self.righe.contains_key(id) {
            return Perche::Sconosciuto;
        }
        if self.nucleo.contains(id) {
            return Perche::Nucleo;
        }
        if stato.scelti.contains(id) {
            return Perche::Scelto;
        }
        let attivi = self.attivi(stato);
        if !attivi.contains(id) {
            return Perche::Spento;
        }
        let da: Vec<Id> = attivi
            .iter()
            .filter(|a| self.richiesti(a).iter().any(|r| r == id))
            .cloned()
            .collect();
        if !da.is_empty() {
            return Perche::RichiestoDa(da);
        }
        debug_assert!(stato.in_attesa.contains(id), "acceso senza ragione: {id}");
        Perche::InAttesa
    }

    /// Applica un profilo: `scelti` diventa i componenti del profilo, e
    /// `in_attesa` si svuota (il profilo è una risposta completa). Un id che la
    /// mappa non ha finisce in `Effetto::mancanti`, e il resto si applica.
    pub fn applica_profilo(&self, stato: &Stato, profilo: &Profilo) -> (Stato, Effetto) {
        let prima = self.attivi(stato);
        let mut nuovo = Stato::default();
        let mut mancanti = Vec::new();
        for id in &profilo.componenti {
            if self.righe.contains_key(id) {
                nuovo.scelti.insert(id.clone());
            } else {
                mancanti.push((profilo.nome.clone(), id.clone()));
            }
        }
        let dopo = self.attivi(&nuovo);
        let accesi_anche = dopo
            .difference(&prima)
            .filter(|a| !nuovo.scelti.contains(*a))
            .cloned()
            .collect();
        let spenti_anche = prima.difference(&dopo).cloned().collect();
        (
            nuovo,
            Effetto {
                accesi_anche,
                spenti_anche,
                orfani: Vec::new(),
                mancanti,
            },
        )
    }

    fn conosciuto(&self, id: &str) -> Result<(), Errore> {
        if self.righe.contains_key(id) {
            Ok(())
        } else {
            Err(Errore::Sconosciuto(id.to_string()))
        }
    }

    /// Gli accesi diversi da `id` che lo richiedono, a catena.
    fn dipendenti(&self, attivi: &BTreeSet<Id>, id: &str) -> BTreeSet<Id> {
        let mut presi: BTreeSet<&str> = BTreeSet::from([id]);
        loop {
            let nuovi: Vec<&str> = attivi
                .iter()
                .map(Id::as_str)
                .filter(|a| !presi.contains(a))
                .filter(|a| self.richiesti(a).iter().any(|r| presi.contains(r.as_str())))
                .collect();
            if nuovi.is_empty() {
                break;
            }
            presi.extend(nuovi);
        }
        presi.remove(id);
        presi.into_iter().map(str::to_string).collect()
    }

    fn spegni_interno(
        &self,
        stato: &Stato,
        id: &str,
        con_dipendenti: bool,
    ) -> Result<(Stato, Effetto), Errore> {
        self.conosciuto(id)?;
        if self.nucleo.contains(id) {
            return Err(Errore::Nucleo);
        }
        let prima = self.attivi(stato);
        if !prima.contains(id) {
            return Ok((stato.clone(), Effetto::default()));
        }
        let dipendenti = self.dipendenti(&prima, id);
        if !dipendenti.is_empty() {
            if !con_dipendenti {
                return Err(Errore::Richiesto {
                    da: dipendenti.into_iter().collect(),
                });
            }
            if dipendenti.iter().any(|d| self.nucleo.contains(d)) {
                return Err(Errore::Nucleo);
            }
        }

        let mut spenti = dipendenti.clone();
        spenti.insert(id.to_string());
        let mut nuovo = stato.clone();
        nuovo.scelti.retain(|s| !spenti.contains(s));
        nuovo.in_attesa.retain(|s| !spenti.contains(s));

        let dopo = self.attivi(&nuovo);
        let orfani: Vec<Id> = prima
            .difference(&dopo)
            .filter(|o| !spenti.contains(*o) && !nuovo.scelti.contains(*o))
            .cloned()
            .collect();
        nuovo.in_attesa.extend(orfani.iter().cloned());

        Ok((
            nuovo,
            Effetto {
                spenti_anche: dipendenti.into_iter().collect(),
                orfani,
                ..Effetto::default()
            },
        ))
    }
}

/// Il primo ciclo nei requisiti risolti, come giro chiuso (`a → b → a`).
fn trova_ciclo(richiesti: &BTreeMap<Id, Vec<Id>>) -> Option<Vec<Id>> {
    #[derive(Clone, Copy, PartialEq)]
    enum Colore {
        Bianco,
        Grigio,
        Nero,
    }
    let mut colore: BTreeMap<&str, Colore> = richiesti
        .keys()
        .map(|id| (id.as_str(), Colore::Bianco))
        .collect();

    for partenza in richiesti.keys() {
        if colore[partenza.as_str()] != Colore::Bianco {
            continue;
        }
        // La pila del cammino: un nodo e l'indice del prossimo requisito.
        let mut cammino: Vec<(&str, usize)> = vec![(partenza.as_str(), 0)];
        colore.insert(partenza.as_str(), Colore::Grigio);
        while let Some(&(nodo, i)) = cammino.last() {
            let figli = &richiesti[nodo];
            if i == figli.len() {
                colore.insert(nodo, Colore::Nero);
                cammino.pop();
                continue;
            }
            let figlio = figli[i].as_str();
            if let Some(cima) = cammino.last_mut() {
                cima.1 += 1;
            }
            match colore[figlio] {
                Colore::Bianco => {
                    colore.insert(figlio, Colore::Grigio);
                    cammino.push((figlio, 0));
                }
                Colore::Grigio => {
                    let da = cammino
                        .iter()
                        .position(|(n, _)| *n == figlio)
                        .expect("un nodo grigio sta nel cammino");
                    let mut giro: Vec<Id> =
                        cammino[da..].iter().map(|(n, _)| n.to_string()).collect();
                    giro.push(figlio.to_string());
                    return Some(giro);
                }
                Colore::Nero => {}
            }
        }
    }
    None
}
