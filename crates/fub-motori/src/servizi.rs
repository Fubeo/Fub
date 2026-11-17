//! Ciò che i motori hanno in comune.

use std::sync::{Arc, OnceLock};

use crate::{Budget, Caratteri, Lavori, Tetto};

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

/// I servizi comuni dei motori: il gruppo di thread, il budget della
/// memoria e i caratteri dati dall'host.
///
/// I campi sono privati e si raggiungono con un metodo ciascuno, così che un
/// servizio nuovo si aggiunge senza cambiare chi usa quelli che ci sono. I
/// caratteri sono arrivati così, con il disegno (K5); la scheda grafica
/// arriverà con il primo motore che la usa (ADR 0236).
///
/// Costruirli non avvia thread e non legge file: il gruppo nasce al primo
/// lavoro, il tetto alla prima domanda, i caratteri quando l'host li dà.
#[derive(Debug)]
pub struct Servizi {
    lavori: Lavori,
    memoria: Budget,
    caratteri: OnceLock<Arc<Caratteri>>,
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
            caratteri: OnceLock::new(),
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

    /// Dà ai motori i caratteri dell'host, una volta sola.
    ///
    /// I primi caratteri dati restano per tutta la vita dei servizi: una
    /// seconda chiamata non li cambia e restituisce in `Err` ciò che ha
    /// ricevuto, così che chi chiama sappia che non sono stati presi.
    pub fn fornisci_caratteri(&self, caratteri: Caratteri) -> Result<(), Caratteri> {
        let mut dati = Some(caratteri);
        self.caratteri.get_or_init(|| {
            // `get_or_init` chiama la chiusura al più una volta, e solo qui
            // `dati` viene preso.
            Arc::new(dati.take().expect("i caratteri si prendono una volta sola"))
        });
        match dati {
            None => Ok(()),
            Some(rifiutati) => Err(rifiutati),
        }
    }

    /// I caratteri dati dall'host, o `None` se non li ha ancora dati: il
    /// motore che li vuole risponde allora che non è pronto.
    pub fn caratteri(&self) -> Option<Arc<Caratteri>> {
        self.caratteri.get().map(Arc::clone)
    }
}
