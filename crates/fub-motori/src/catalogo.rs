//! Il catalogo dei comandi di un motore, tradotto in comandi di Fub.
//!
//! Un motore copiato porta il suo elenco di comandi: un id, un'etichetta in
//! inglese, il posto nel suo menu (`["Home", "Font"]`) e i parametri come
//! schema a parole. [`importa`] ne fa dei [`ComandoFub`]: l'id con lo spazio
//! del motore davanti, la chiave del titolo nei cataloghi delle lingue, il
//! posto nella barra di Fub, il [`Modulo`] dei parametri e chi dice se il
//! comando si può usare (il motore, [`Delega`]).
//!
//! Il crate non nomina nessun motore: la tabella che porta un percorso del
//! menu del motore a una scheda di Fub, e il lessico dei nomi dei parametri,
//! li dà l'adattatore ([`Adattamento`]). Un percorso che la tabella non
//! conosce è un errore, non un comando senza posto: un comando nuovo del
//! motore si fa vedere nel test dell'adattatore.
//!
//! [`verifica_copertura`] è il controllo che nessun comando si perde: ogni
//! comando del motore è nel catalogo, oppure l'adattatore dice perché non lo
//! serve.

use std::collections::BTreeSet;
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
}

/// Dove un comando compare nella shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Posto {
    /// In una scheda della barra, nel gruppo dato o nella scheda senza un
    /// gruppo preciso.
    Barra {
        /// L'id della scheda: `home`.
        scheda: &'static str,
        /// L'id del gruppo nella scheda: `font`.
        gruppo: Option<&'static str>,
    },
    /// Soltanto nella tavolozza dei comandi.
    Tavolozza,
}

/// Ciò che l'adattatore sa del suo motore e il crate non può sapere.
#[derive(Debug, Clone, Copy)]
pub struct Adattamento<'a> {
    /// Ogni percorso del menu del motore con il suo posto in Fub. Il
    /// percorso si confronta per intero. Un comando con il menu vuoto va
    /// nella tavolozza senza bisogno di una riga.
    pub posti: &'a [(&'a [&'a str], Posto)],
    /// Il tipo dei nomi di parametro che lo schema del motore usa senza
    /// valore (`{cell, word}`): si veda [`Modulo::da_schema`].
    pub nomi: &'a [(&'a str, Tipo)],
    /// Il tipo di un nome in un comando solo, quando lì vuol dire un'altra
    /// cosa (`header` è un sì/no in un comando e un margine in un altro):
    /// vale prima di [`Adattamento::nomi`].
    pub nomi_del_comando: &'a [(&'a str, &'a [(&'a str, Tipo)])],
}

impl Adattamento<'_> {
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
    /// Dove il comando compare.
    pub posto: Posto,
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Copertura {
    /// I comandi del motore nel catalogo.
    pub importati: usize,
    /// I comandi che l'adattatore non serve, ciascuno con il suo perché.
    pub non_serviti: usize,
    /// I comandi del catalogo che stanno soltanto nella tavolozza.
    pub solo_tavolozza: usize,
    /// Fra questi, quelli che già nel motore non avevano un menu.
    pub senza_menu: usize,
}

impl fmt::Display for Copertura {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} comandi nel catalogo, {} non serviti; {} soltanto nella tavolozza, di cui {} senza menu nel motore",
            self.importati, self.non_serviti, self.solo_tavolozza, self.senza_menu
        )
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
    let mut mancanze = Vec::new();
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
        let posto = if spec.menu.is_empty() {
            Some(Posto::Tavolozza)
        } else {
            adattamento
                .posti
                .iter()
                .find(|(percorso, _)| {
                    percorso
                        .iter()
                        .copied()
                        .eq(spec.menu.iter().map(String::as_str))
                })
                .map(|(_, posto)| *posto)
        };
        let Some(posto) = posto else {
            mancanze.push(Mancanza::PostoSconosciuto {
                id: spec.id.clone(),
                menu: spec.menu.clone(),
            });
            continue;
        };
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

/// Controlla che ogni comando del `motore` si raggiunga: è nel `catalogo`,
/// oppure `non_servito` ne dà il perché (non vuoto). Un comando non può
/// essere tutte e due le cose, e il catalogo non può avere comandi che il
/// motore non ha.
pub fn verifica_copertura(
    motore: &[SpecMotore],
    catalogo: &[ComandoFub],
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
    for comando in catalogo {
        copertura.importati += 1;
        if comando.posto == Posto::Tavolozza {
            copertura.solo_tavolozza += 1;
            if comando.menu_motore.is_empty() {
                copertura.senza_menu += 1;
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
