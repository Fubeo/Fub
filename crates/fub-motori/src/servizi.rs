//! Ciò che i motori hanno in comune.

use std::sync::{Arc, OnceLock};

use crate::{Budget, Lavori, Tetto};

/// Come nascono dei [`Servizi`].
#[derive(Debug)]
pub struct Config {
    /// Quanti thread avrà il gruppo dei motori; `None` li conta dalla
    /// macchina (`available_parallelism() - 1`, fra 1 e 8).
    pub fili: Option<usize>,
    /// Il tetto della memoria delle cache.
    pub tetto: Tetto,
}

impl Default for Config {
    /// La configurazione del processo: thread contati dalla macchina e tetto
    /// del sistema.
    fn default() -> Self {
        Self {
            fili: None,
            tetto: Tetto::dal_sistema(),
        }
    }
}

/// I servizi comuni dei motori: il gruppo di thread e il budget della
/// memoria.
///
/// I campi sono privati e si raggiungono con un metodo ciascuno, così che un
/// servizio nuovo (la scheda grafica, l'archivio dei caratteri: arrivano con
/// il primo motore che li usa, ADR 0236) si aggiunge senza cambiare chi usa
/// quelli che ci sono.
///
/// Costruirli non avvia thread e non legge file: il gruppo nasce al primo
/// lavoro, il tetto alla prima domanda.
#[derive(Debug)]
pub struct Servizi {
    lavori: Lavori,
    memoria: Budget,
}

static PROCESSO: OnceLock<Arc<Servizi>> = OnceLock::new();

impl Servizi {
    /// I servizi del processo, uno solo per processo.
    pub fn processo() -> Arc<Servizi> {
        Arc::clone(PROCESSO.get_or_init(|| Servizi::nuovi(Config::default())))
    }

    /// Servizi nuovi, separati da quelli del processo: per le prove, o per
    /// chi vuole un tetto o un numero di thread suoi.
    pub fn nuovi(config: Config) -> Arc<Servizi> {
        Arc::new(Servizi {
            lavori: Lavori::nuovi(config.fili),
            memoria: Budget::nuovo(config.tetto),
        })
    }

    /// Il gruppo di thread dei motori.
    pub fn lavori(&self) -> &Lavori {
        &self.lavori
    }

    /// Il budget della memoria delle cache.
    pub fn memoria(&self) -> &Budget {
        &self.memoria
    }
}
