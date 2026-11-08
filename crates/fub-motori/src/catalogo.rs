//! Il catalogo dei comandi di un motore, tradotto in comandi di Fub.
//!
//! Un motore copiato porta il suo elenco di comandi: un id, un'etichetta in
//! inglese, il posto nel suo menu (`["Home", "Font"]`) e i parametri come
//! schema a parole. [`importa`] ne fa dei [`ComandoFub`]: l'id con lo spazio
//! del motore davanti, la chiave del titolo nei cataloghi delle lingue, il
//! posto nel menu di Fub (una scheda e un gruppo, sempre tutti e due),
//! l'[`Effetto`] sulla cartella, il [`Modulo`] dei parametri e chi dice se il
//! comando si può usare (il motore, [`Delega`]).
//!
//! Il crate non nomina nessun motore: l'elenco delle schede e dei gruppi del
//! menu, la tabella che porta un percorso del menu del motore (o un comando
//! preciso) a un posto, il lessico dei nomi dei parametri e l'effetto di ogni
//! comando li dà l'adattatore ([`Adattamento`], [`SpecMotore::effetto`]). Un
//! comando servito senza posto è un errore, non un comando che si trova
//! soltanto cercandolo: un comando nuovo del motore si fa vedere nel test
//! dell'adattatore.
//!
//! [`verifica_copertura`] è il controllo che nessun comando si perde: ogni
//! comando del motore è nel catalogo, oppure l'adattatore dice perché non lo
//! serve; e ogni gruppo del menu ha almeno un comando.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::modulo::{ErroreSchema, Modulo, Tipo};

/// Un comando come il motore lo descrive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecMotore {
    /// L'id nel motore: `home.fontBold`.
    pub id: String,
    /// L'etichetta in inglese che il motore mostra.
    pub etichetta: String,
    /// Il percorso nel menu del motore: `["Home", "Font"]`; vuoto se il
    /// comando non ha un posto nel menu (si trova soltanto cercandolo).
    pub menu: Vec<String>,
    /// Lo schema a parole dei parametri; vuoto se non ne ha.
    pub parametri: String,
    /// Che cosa fa il comando alla cartella: lo decide l'adattatore da ciò
    /// che il motore dice del comando (se si annulla, se va nel giornale).
    pub effetto: Effetto,
}

/// Che cosa fa un comando al documento. La sola lettura spegne i comandi
/// che cambiano; nel dubbio un comando è [`Effetto::Cambia`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Effetto {
    /// Cambia il documento (anche annulla e ripeti).
    Cambia,
    /// Legge il documento e ne dà un risultato, senza cambiarlo.
    Legge,
    /// Cambia soltanto ciò che si vede: la selezione, il foglio attivo, la
    /// vista.
    Mostra,
}

impl Effetto {
    /// Il nome nei file generati per la shell.
    pub fn nome(self) -> &'static str {
        match self {
            Effetto::Cambia => "cambia",
            Effetto::Legge => "legge",
            Effetto::Mostra => "mostra",
        }
    }
}

/// Dove un comando compare nel menu di Fub: una scheda e un gruppo
/// dell'elenco dell'adattatore ([`Adattamento::schede`]), tutti e due
/// sempre pieni.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Posto {
    /// L'id della scheda: `home`.
    pub scheda: &'static str,
    /// L'id del gruppo nella scheda: `font`.
    pub gruppo: &'static str,
}

/// Una scheda del menu dei comandi, con i suoi gruppi nell'ordine del menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scheda {
    /// L'id della scheda: `home`.
    pub id: &'static str,
    /// La scheda c'è soltanto nel menu, non nella barra.
    pub solo: bool,
    /// Il contesto della selezione che la fa comparire (`table`, `chart`):
    /// `None` per una scheda che c'è sempre.
    pub contesto: Option<&'static str>,
    /// I gruppi, nell'ordine del menu.
    pub gruppi: &'static [Gruppo],
}

/// Un gruppo di una [`Scheda`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Gruppo {
    /// L'id del gruppo nella scheda: `font`.
    pub id: &'static str,
    /// Il gruppo c'è soltanto nel menu, non nella barra.
    pub solo: bool,
}

impl Scheda {
    /// Se l'elenco `schede` ha la scheda e il gruppo del `posto`.
    pub fn ha(schede: &[Scheda], posto: Posto) -> bool {
        schede.iter().any(|scheda| {
            scheda.id == posto.scheda && scheda.gruppi.iter().any(|g| g.id == posto.gruppo)
        })
    }
}

/// Ciò che l'adattatore sa del suo motore e il crate non può sapere.
#[derive(Debug, Clone, Copy)]
pub struct Adattamento<'a> {
    /// Le schede e i gruppi del menu dei comandi, nell'ordine del menu: ogni
    /// posto ne nomina una scheda e un gruppo.
    pub schede: &'a [Scheda],
    /// Ogni percorso del menu del motore con il suo posto in Fub. Il
    /// percorso si confronta per intero.
    pub posti: &'a [(&'a [&'a str], Posto)],
    /// Il posto di un comando preciso, che vale prima del suo percorso: un
    /// comando con il menu del motore vuoto, o uno che Fub mostra in un
    /// altro gruppo da quello del suo percorso.
    pub posti_del_comando: &'a [(&'a str, Posto)],
    /// Il tipo dei nomi di parametro che lo schema del motore usa senza
    /// valore (`{cell, word}`): si veda [`Modulo::da_schema`].
    pub nomi: &'a [(&'a str, Tipo)],
    /// Il tipo di un nome in un comando solo, quando lì vuol dire un'altra
    /// cosa (`header` è un sì/no in un comando e un margine in un altro):
    /// vale prima di [`Adattamento::nomi`].
    pub nomi_del_comando: &'a [(&'a str, &'a [(&'a str, Tipo)])],
}

impl Adattamento<'_> {
    /// Il posto del comando `spec`: la riga del suo id, poi quella del suo
    /// percorso.
    fn posto(&self, spec: &SpecMotore) -> Option<Posto> {
        if let Some((_, posto)) = self.posti_del_comando.iter().find(|(id, _)| *id == spec.id) {
            return Some(*posto);
        }
        if spec.menu.is_empty() {
            return None;
        }
        self.posti
            .iter()
            .find(|(percorso, _)| {
                percorso
                    .iter()
                    .copied()
                    .eq(spec.menu.iter().map(String::as_str))
            })
            .map(|(_, posto)| *posto)
    }

    /// Il lessico per il comando `id`: i suoi nomi, poi quelli di tutti.
    fn lessico(&self, id: &str) -> Vec<(&str, Tipo)> {
        self.nomi_del_comando
            .iter()
            .filter(|(comando, _)| *comando == id)
            .flat_map(|(_, nomi)| nomi.iter())
            .chain(self.nomi.iter())
            .map(|(nome, tipo)| (*nome, tipo.clone()))
            .collect()
    }
}

/// Chi dice se un comando si può usare in questo momento.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delega {
    /// Il motore, chiedendogli del comando con questo id.
    Motore(String),
}

/// Un comando del motore come Fub lo conosce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComandoFub {
    /// L'id in Fub: `«spazio».«id del motore»`.
    pub id: String,
    /// L'id nel motore.
    pub motore: String,
    /// La chiave del titolo nei cataloghi delle lingue:
    /// `«spazio».cmd.«id del motore»`.
    pub titolo: String,
    /// L'etichetta inglese del motore, il punto di partenza dei cataloghi.
    pub etichetta: String,
    /// Il percorso nel menu del motore, com'era.
    pub menu_motore: Vec<String>,
    /// Dove il comando compare nel menu (se la barra lo mostra in più posti,
    /// il primo nell'ordine della barra).
    pub posto: Posto,
    /// Che cosa fa alla cartella.
    pub effetto: Effetto,
    /// La scorciatoia: nessuna per ora, la danno le scorciatoie della shell.
    pub tasti: Option<String>,
    /// I parametri.
    pub parametri: Modulo,
    /// Chi dice se si può usare.
    pub abilitato: Delega,
}

/// Una ragione per cui il catalogo non si fa, o non copre il motore.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Mancanza {
    /// Lo spazio dev'essere una parola in minuscolo, senza punti.
    #[error("lo spazio «{0}» non è valido: lettere minuscole e cifre, senza punti")]
    SpazioNonValido(String),
    /// L'id di un comando del motore non è un id.
    #[error("l'id «{0}» non è valido: lettere, cifre e «_ -», a pezzi divisi da un punto")]
    IdNonValido(String),
    /// Due comandi del motore hanno lo stesso id.
    #[error("il motore ha due comandi con l'id «{0}»")]
    IdDoppio(String),
    /// Un comando senza etichetta non ha un titolo da tradurre.
    #[error("il comando «{0}» non ha un'etichetta")]
    EtichettaVuota(String),
    /// Il percorso del menu del motore non ha un posto nella tabella.
    #[error(
        "il comando «{id}» sta nel menu {menu:?} del motore, che la tabella dei posti non conosce"
    )]
    PostoSconosciuto {
        /// Il comando.
        id: String,
        /// Il suo percorso nel menu del motore.
        menu: Vec<String>,
    },
    /// Un comando senza menu nel motore non ha una riga col suo id.
    #[error("il comando «{0}» non ha un menu nel motore, né una riga col suo id fra i posti")]
    SenzaPosto(String),
    /// Il posto di un comando nomina una scheda o un gruppo fuori elenco.
    #[error("il comando «{id}» va in «{scheda} › {gruppo}», che l'elenco delle schede non ha")]
    PostoFuoriElenco {
        /// Il comando.
        id: String,
        /// La scheda del posto.
        scheda: String,
        /// Il gruppo del posto.
        gruppo: String,
    },
    /// L'elenco delle schede ha due volte la stessa scheda.
    #[error("l'elenco delle schede ha due volte la scheda «{0}»")]
    SchedaDoppia(String),
    /// Una scheda dell'elenco ha due volte lo stesso gruppo.
    #[error("la scheda «{scheda}» ha due volte il gruppo «{gruppo}»")]
    GruppoDoppio {
        /// La scheda.
        scheda: String,
        /// Il gruppo.
        gruppo: String,
    },
    /// Una scheda dell'elenco non ha gruppi.
    #[error("la scheda «{0}» non ha gruppi")]
    SchedaVuota(String),
    /// Un gruppo dell'elenco non ha nessun comando del catalogo.
    #[error("il gruppo «{scheda} › {gruppo}» non ha nessun comando")]
    GruppoVuoto {
        /// La scheda.
        scheda: String,
        /// Il gruppo.
        gruppo: String,
    },
    /// Lo schema dei parametri non si legge.
    #[error("i parametri del comando «{id}» non si leggono: {errore}")]
    SchemaIlleggibile {
        /// Il comando.
        id: String,
        /// Dove e perché.
        errore: ErroreSchema,
    },
    /// Un comando del motore non è nel catalogo e nessuno dice perché.
    #[error(
        "il comando «{0}» del motore non è nel catalogo e non c'è scritto perché non è servito"
    )]
    Irraggiungibile(String),
    /// Il perché di un comando non servito è vuoto.
    #[error("il comando «{0}» non è servito, ma il perché è vuoto")]
    PercheVuoto(String),
    /// Un comando è nel catalogo e insieme fra i non serviti.
    #[error("il comando «{0}» è nel catalogo e anche fra i non serviti")]
    ServitoENonServito(String),
    /// Il catalogo ha un comando che il motore non ha.
    #[error("il catalogo ha il comando «{0}», che il motore non ha")]
    ImportatoSenzaMotore(String),
}

/// Il conto della copertura di un catalogo.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Copertura {
    /// I comandi del motore nel catalogo.
    pub importati: usize,
    /// I comandi che l'adattatore non serve, ciascuno con il suo perché.
    pub non_serviti: usize,
    /// I comandi del catalogo per scheda, nell'ordine dell'elenco delle
    /// schede.
    pub per_scheda: Vec<(&'static str, usize)>,
}

impl fmt::Display for Copertura {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} comandi nel catalogo, {} non serviti",
            self.importati, self.non_serviti
        )?;
        for (indice, (scheda, quanti)) in self.per_scheda.iter().enumerate() {
            let prima = if indice == 0 { "; per scheda: " } else { ", " };
            write!(f, "{prima}{scheda} {quanti}")?;
        }
        Ok(())
    }
}

fn spazio_valido(spazio: &str) -> bool {
    !spazio.is_empty()
        && spazio.starts_with(|c: char| c.is_ascii_lowercase())
        && spazio
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn id_valido(id: &str) -> bool {
    !id.is_empty()
        && id.split('.').all(|pezzo| {
            !pezzo.is_empty()
                && pezzo
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
        })
}

/// Traduce i comandi `specifiche` del motore dello spazio `spazio` in
/// comandi di Fub, nell'ordine in cui arrivano.
///
/// Se qualcosa non va restituisce tutte le mancanze trovate, non soltanto la
/// prima: un aggiornamento del motore si sistema in un giro.
pub fn importa(
    spazio: &str,
    specifiche: &[SpecMotore],
    adattamento: &Adattamento<'_>,
) -> Result<Vec<ComandoFub>, Vec<Mancanza>> {
    if !spazio_valido(spazio) {
        return Err(vec![Mancanza::SpazioNonValido(spazio.to_owned())]);
    }
    let mut mancanze = controlla_schede(adattamento.schede);
    let mut visti = BTreeSet::new();
    let mut comandi = Vec::with_capacity(specifiche.len());
    for spec in specifiche {
        if !id_valido(&spec.id) {
            mancanze.push(Mancanza::IdNonValido(spec.id.clone()));
            continue;
        }
        if !visti.insert(spec.id.as_str()) {
            mancanze.push(Mancanza::IdDoppio(spec.id.clone()));
            continue;
        }
        if spec.etichetta.trim().is_empty() {
            mancanze.push(Mancanza::EtichettaVuota(spec.id.clone()));
        }
        let Some(posto) = adattamento.posto(spec) else {
            mancanze.push(if spec.menu.is_empty() {
                Mancanza::SenzaPosto(spec.id.clone())
            } else {
                Mancanza::PostoSconosciuto {
                    id: spec.id.clone(),
                    menu: spec.menu.clone(),
                }
            });
            continue;
        };
        if !Scheda::ha(adattamento.schede, posto) {
            mancanze.push(Mancanza::PostoFuoriElenco {
                id: spec.id.clone(),
                scheda: posto.scheda.to_owned(),
                gruppo: posto.gruppo.to_owned(),
            });
            continue;
        }
        let parametri = match Modulo::da_schema(&spec.parametri, &adattamento.lessico(&spec.id)) {
            Ok(modulo) => modulo,
            Err(errore) => {
                mancanze.push(Mancanza::SchemaIlleggibile {
                    id: spec.id.clone(),
                    errore,
                });
                continue;
            }
        };
        comandi.push(ComandoFub {
            id: format!("{spazio}.{}", spec.id),
            motore: spec.id.clone(),
            titolo: format!("{spazio}.cmd.{}", spec.id),
            etichetta: spec.etichetta.clone(),
            menu_motore: spec.menu.clone(),
            posto,
            effetto: spec.effetto,
            tasti: None,
            parametri,
            abilitato: Delega::Motore(spec.id.clone()),
        });
    }
    if mancanze.is_empty() {
        Ok(comandi)
    } else {
        Err(mancanze)
    }
}

/// Le mancanze dell'elenco delle schede: una scheda o un gruppo due volte,
/// una scheda senza gruppi.
fn controlla_schede(schede: &[Scheda]) -> Vec<Mancanza> {
    let mut mancanze = Vec::new();
    let mut viste = BTreeSet::new();
    for scheda in schede {
        if !viste.insert(scheda.id) {
            mancanze.push(Mancanza::SchedaDoppia(scheda.id.to_owned()));
        }
        if scheda.gruppi.is_empty() {
            mancanze.push(Mancanza::SchedaVuota(scheda.id.to_owned()));
        }
        let mut visti = BTreeSet::new();
        for gruppo in scheda.gruppi {
            if !visti.insert(gruppo.id) {
                mancanze.push(Mancanza::GruppoDoppio {
                    scheda: scheda.id.to_owned(),
                    gruppo: gruppo.id.to_owned(),
                });
            }
        }
    }
    mancanze
}

/// Controlla che ogni comando del `motore` si raggiunga: è nel `catalogo`,
/// oppure `non_servito` ne dà il perché (non vuoto). Un comando non può
/// essere tutte e due le cose, e il catalogo non può avere comandi che il
/// motore non ha. Ogni gruppo delle `schede` deve avere almeno un comando
/// del catalogo: un gruppo vuoto nel menu è un errore.
pub fn verifica_copertura(
    motore: &[SpecMotore],
    catalogo: &[ComandoFub],
    schede: &[Scheda],
    non_servito: &dyn Fn(&str) -> Option<&'static str>,
) -> Result<Copertura, Vec<Mancanza>> {
    let mut mancanze = Vec::new();
    let del_motore: BTreeSet<&str> = motore.iter().map(|spec| spec.id.as_str()).collect();
    let nel_catalogo: BTreeSet<&str> = catalogo
        .iter()
        .map(|comando| comando.motore.as_str())
        .collect();
    for comando in catalogo {
        if !del_motore.contains(comando.motore.as_str()) {
            mancanze.push(Mancanza::ImportatoSenzaMotore(comando.motore.clone()));
        }
    }
    let mut copertura = Copertura::default();
    for spec in motore {
        let importato = nel_catalogo.contains(spec.id.as_str());
        match (importato, non_servito(&spec.id)) {
            (true, Some(_)) => mancanze.push(Mancanza::ServitoENonServito(spec.id.clone())),
            (true, None) => {}
            (false, None) => mancanze.push(Mancanza::Irraggiungibile(spec.id.clone())),
            (false, Some(perche)) if perche.trim().is_empty() => {
                mancanze.push(Mancanza::PercheVuoto(spec.id.clone()))
            }
            (false, Some(_)) => copertura.non_serviti += 1,
        }
    }
    let mut per_posto: BTreeMap<Posto, usize> = BTreeMap::new();
    for comando in catalogo {
        copertura.importati += 1;
        *per_posto.entry(comando.posto).or_default() += 1;
    }
    for scheda in schede {
        let mut nella_scheda = 0;
        for gruppo in scheda.gruppi {
            let posto = Posto {
                scheda: scheda.id,
                gruppo: gruppo.id,
            };
            match per_posto.remove(&posto) {
                Some(quanti) => nella_scheda += quanti,
                None => mancanze.push(Mancanza::GruppoVuoto {
                    scheda: scheda.id.to_owned(),
                    gruppo: gruppo.id.to_owned(),
                }),
            }
        }
        copertura.per_scheda.push((scheda.id, nella_scheda));
    }
    if !per_posto.is_empty() {
        for comando in catalogo {
            if per_posto.contains_key(&comando.posto) {
                mancanze.push(Mancanza::PostoFuoriElenco {
                    id: comando.motore.clone(),
                    scheda: comando.posto.scheda.to_owned(),
                    gruppo: comando.posto.gruppo.to_owned(),
                });
            }
        }
    }
    if mancanze.is_empty() {
        Ok(copertura)
    } else {
        Err(mancanze)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gli_id() {
        for sì in ["home.fontBold", "a", "data.what-if", "x_1.y"] {
            assert!(id_valido(sì), "{sì}");
        }
        for no in ["", ".a", "a.", "a..b", "a b", "a/b"] {
            assert!(!id_valido(no), "{no}");
        }
        assert!(spazio_valido("fogli"));
        for no in ["", "Fogli", "fo.gli", "1fogli", "fo-gli"] {
            assert!(!spazio_valido(no), "{no}");
        }
    }
}
