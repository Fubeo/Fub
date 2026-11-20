//! Il registro dei motori: ogni adattatore iscrive il suo.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use crate::{ErroreMotore, Servizi};

/// Un motore come lo vede il registro. La implementa l'adattatore, di solito
/// sopra un [`crate::Pigro`] e le sue cache.
///
/// Il registro non tiene lucchetti mentre chiama una voce.
pub trait Voce: Send + Sync {
    /// Vero se il motore è costruito.
    fn acceso(&self) -> bool;
    /// Prepara il motore in sottofondo, senza aspettare
    /// ([`crate::Pigro::scalda`]).
    fn scalda(&self, servizi: &Arc<Servizi>);
    /// Svuota le cache del motore, senza spegnerlo; dice quanti byte se ne
    /// sono andati. Un motore spento ha zero byte da dare.
    fn svuota(&self) -> u64;
    /// Spegne il motore ([`crate::Pigro::libera`]): vero se era acceso.
    fn libera(&self) -> bool;
    /// I byte delle cache del motore, adesso; zero se è spento.
    fn byte(&self) -> u64;
}

/// Una riga di [`Motori::elenco`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatoVoce {
    /// Lo spazio del motore: «fogli», «documenti».
    pub spazio: String,
    /// Vero se il motore è costruito.
    pub acceso: bool,
    /// I byte delle sue cache.
    pub byte: u64,
}

struct Iscritto {
    voce: Arc<dyn Voce>,
}

#[derive(Default)]
struct Elenco {
    voci: BTreeMap<String, Iscritto>,
    /// Estensione (minuscola, senza punto) → spazio.
    estensioni: BTreeMap<String, String>,
}

/// Il registro dei motori di un processo.
///
/// `fub-motori` non nomina nessun motore: è ogni adattatore a iscrivere il
/// suo, con uno spazio («fogli», «documenti») e le estensioni dei file che
/// apre. Iscriversi non costruisce il motore.
pub struct Motori {
    servizi: Arc<Servizi>,
    elenco: Mutex<Elenco>,
}

static PROCESSO: OnceLock<Arc<Motori>> = OnceLock::new();

const LUCCHETTO: &str = "del registro dei motori";

/// L'estensione nella forma del registro: senza punto davanti, in minuscolo.
fn normale(estensione: &str) -> String {
    estensione.trim_start_matches('.').to_lowercase()
}

impl Motori {
    /// Il registro del processo, con i [`Servizi::processo`]. Uno solo per
    /// processo.
    pub fn processo() -> Arc<Motori> {
        Arc::clone(PROCESSO.get_or_init(|| Motori::nuovi(Servizi::processo())))
    }

    /// Un registro vuoto con questi servizi, separato da quello del processo.
    pub fn nuovi(servizi: Arc<Servizi>) -> Arc<Motori> {
        Arc::new(Motori {
            servizi,
            elenco: Mutex::new(Elenco::default()),
        })
    }

    /// I servizi con cui i motori di questo registro si scaldano.
    pub fn servizi(&self) -> &Arc<Servizi> {
        &self.servizi
    }

    fn blocca(&self) -> Result<MutexGuard<'_, Elenco>, ErroreMotore> {
        self.elenco
            .lock()
            .map_err(|_| ErroreMotore::LucchettoAvvelenato(LUCCHETTO))
    }

    /// Iscrive un motore con il suo spazio e le estensioni che apre.
    ///
    /// Uno spazio si iscrive una volta sola, e un'estensione appartiene a un
    /// motore solo: altrimenti è un errore e niente cambia.
    pub fn registra(
        &self,
        spazio: &str,
        estensioni: &[&str],
        voce: Arc<dyn Voce>,
    ) -> Result<(), ErroreMotore> {
        let mut elenco = self.blocca()?;
        if elenco.voci.contains_key(spazio) {
            return Err(ErroreMotore::SpazioGiaIscritto(spazio.to_owned()));
        }
        let estensioni: Vec<String> = estensioni.iter().map(|e| normale(e)).collect();
        if let Some((estensione, altro)) = estensioni
            .iter()
            .find_map(|e| elenco.estensioni.get(e).map(|altro| (e, altro)))
        {
            return Err(ErroreMotore::EstensioneContesa {
                estensione: estensione.clone(),
                spazio: altro.clone(),
            });
        }
        for estensione in estensioni {
            elenco.estensioni.insert(estensione, spazio.to_owned());
        }
        elenco.voci.insert(spazio.to_owned(), Iscritto { voce });
        Ok(())
    }

    /// Scalda il motore che apre questa estensione (`"xlsx"`, `".XLSX"`).
    /// Vero se un motore la apre; il motore si prepara in sottofondo.
    pub fn scalda_per(&self, estensione: &str) -> Result<bool, ErroreMotore> {
        let voce = {
            let elenco = self.blocca()?;
            elenco
                .estensioni
                .get(&normale(estensione))
                .and_then(|spazio| elenco.voci.get(spazio))
                .map(|iscritto| Arc::clone(&iscritto.voce))
        };
        match voce {
            Some(voce) => {
                voce.scalda(&self.servizi);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// La voce iscritta con questo spazio.
    pub fn voce(&self, spazio: &str) -> Result<Arc<dyn Voce>, ErroreMotore> {
        self.blocca()?
            .voci
            .get(spazio)
            .map(|iscritto| Arc::clone(&iscritto.voce))
            .ok_or_else(|| ErroreMotore::MotoreSconosciuto(spazio.to_owned()))
    }

    /// Ogni motore iscritto, in ordine di spazio, acceso o no e con i byte
    /// delle sue cache.
    pub fn elenco(&self) -> Result<Vec<StatoVoce>, ErroreMotore> {
        let voci: Vec<(String, Arc<dyn Voce>)> = self
            .blocca()?
            .voci
            .iter()
            .map(|(spazio, iscritto)| (spazio.clone(), Arc::clone(&iscritto.voce)))
            .collect();
        Ok(voci
            .into_iter()
            .map(|(spazio, voce)| StatoVoce {
                spazio,
                acceso: voce.acceso(),
                byte: voce.byte(),
            })
            .collect())
    }
}

impl std::fmt::Debug for Motori {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let spazi: Vec<String> = self
            .blocca()
            .map(|elenco| elenco.voci.keys().cloned().collect())
            .unwrap_or_default();
        f.debug_struct("Motori").field("spazi", &spazi).finish()
    }
}
