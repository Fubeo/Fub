//! Lo strato dei motori: un posto solo per costruire i motori quando servono,
//! per il gruppo di thread che li fa lavorare e per il budget delle loro cache
//! (ADR 0236, `docs/architecture/motori.md`).
//!
//! Il crate non nomina nessun motore. Dà i pezzi con cui un adattatore porta
//! il suo:
//!
//! - [`Pigro`], il motore costruito alla prima richiesta e una volta sola;
//! - [`Servizi`], ciò che i motori hanno in comune: il gruppo di thread
//!   ([`Lavori`]) e il budget della memoria ([`Budget`]);
//! - [`Cache`], la forma con cui una cache di un motore si fa contare e
//!   svuotare dal budget;
//! - [`Motori`], il registro dove ogni adattatore iscrive il suo motore
//!   ([`Voce`]) con il suo spazio e le sue estensioni.
//!
//! Le regole che valgono per tutto il crate:
//!
//! - **niente all'avvio**: costruire [`Servizi`] o [`Motori`] non avvia
//!   thread, non legge file e non costruisce motori; tutto arriva alla prima
//!   richiesta;
//! - **un lucchetto mai tenuto** mentre un motore si costruisce o lavora, o
//!   mentre si chiama una cache o una voce: si prende l'`Arc`, si lascia il
//!   lucchetto, poi si chiama;
//! - **chiudere libera**: le cache si svuotano e la memoria torna al sistema
//!   ([`rilascia_al_sistema`]).

mod lavori;
mod memoria;
mod pigro;
pub mod pressione;
mod registro;
mod servizi;

pub use lavori::Lavori;
pub use memoria::{rilascia_al_sistema, Budget, Cache, Resoconto};
pub use pigro::{Crea, Pigro};
pub use pressione::Tetto;
pub use registro::{Motori, StatoVoce, Voce};
pub use servizi::{Config, Servizi};

/// Ciò che può andare storto nello strato dei motori.
///
/// È `Clone` perché un errore di costruzione arriva a tutti quelli che la
/// stavano aspettando, non soltanto a chi l'ha avviata.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ErroreMotore {
    /// Un thread è andato in panico tenendo il lucchetto nominato: lo stato
    /// che proteggeva non è più affidabile.
    #[error("il lucchetto {0} è avvelenato: un thread è andato in panico tenendolo")]
    LucchettoAvvelenato(&'static str),
    /// La costruzione di un motore (o del gruppo di thread) non è riuscita.
    /// Il motivo è quello che ha dato chi costruiva, o il messaggio del panico.
    #[error("la creazione del motore non è riuscita: {motivo}")]
    CreazioneFallita {
        /// Perché, nelle parole di chi costruiva.
        motivo: String,
    },
    /// Nessun motore è iscritto con questo spazio.
    #[error("nessun motore è iscritto con lo spazio «{0}»")]
    MotoreSconosciuto(String),
    /// Uno spazio si iscrive una volta sola nel registro.
    #[error("lo spazio «{0}» è già iscritto nel registro dei motori")]
    SpazioGiaIscritto(String),
    /// Un'estensione appartiene a un motore solo.
    #[error("l'estensione «{estensione}» è già del motore «{spazio}»")]
    EstensioneContesa {
        /// L'estensione chiesta, senza punto e in minuscolo.
        estensione: String,
        /// Lo spazio che la possiede già.
        spazio: String,
    },
}

impl ErroreMotore {
    /// La creazione fallita con il suo motivo.
    pub fn creazione(motivo: impl Into<String>) -> Self {
        Self::CreazioneFallita {
            motivo: motivo.into(),
        }
    }
}
