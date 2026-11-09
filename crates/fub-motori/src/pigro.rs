//! Il motore costruito alla prima richiesta, una volta sola.

use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};

use crate::{ErroreMotore, Servizi};

/// Come si costruisce un motore: riceve i servizi del processo (o quelli di
/// una prova) e dà il motore, o il motivo per cui non c'è.
pub type Crea<T> = fn(&Arc<Servizi>) -> Result<T, ErroreMotore>;

/// Un motore che nasce alla prima richiesta.
///
/// Lo stato è uno fra **Vuoto**, **In costruzione** e **Pronto**. Il primo che
/// chiede ([`Pigro::prendi`]) trova Vuoto, segna In costruzione, lascia il
/// lucchetto e costruisce; chi arriva intanto aspetta su una `Condvar`, senza
/// lucchetto tenuto mentre `crea` lavora, e riceve lo stesso motore o lo
/// stesso errore. Così la costruzione avviene una volta sola.
///
/// Se `crea` fallisce, o va in panico, lo stato torna Vuoto: la richiesta
/// dopo riprova. Un panico diventa un [`ErroreMotore::CreazioneFallita`] con
/// il suo messaggio, e non lascia mai lo stato In costruzione per sempre.
///
/// [`Pigro::libera`] toglie il motore dal `Pigro`, ma non lo distrugge sotto
/// i piedi di nessuno: chi tiene già l'`Arc` continua a usarlo, e il motore
/// se ne va quando cade l'ultimo.
///
/// `nuovo` è `const`: un adattatore può tenere il suo motore in uno `static`.
pub struct Pigro<T> {
    crea: Crea<T>,
    interno: Mutex<Interno<T>>,
    cambiato: Condvar,
}

struct Interno<T> {
    stato: Stato<T>,
    /// Il numero dell'ultima costruzione avviata: chi aspetta sa quale
    /// costruzione sta aspettando, anche se intanto ne parte un'altra.
    giro: u64,
    /// L'errore dell'ultima costruzione fallita, con il suo giro.
    fallita: Option<(u64, ErroreMotore)>,
}

enum Stato<T> {
    Vuoto,
    InCostruzione,
    Pronto(Arc<T>),
}

const LUCCHETTO: &str = "del motore pigro";

impl<T> Pigro<T> {
    /// Un motore non ancora costruito. Non costruisce niente e non avvia
    /// niente.
    pub const fn nuovo(crea: Crea<T>) -> Self {
        Self {
            crea,
            interno: Mutex::new(Interno {
                stato: Stato::Vuoto,
                giro: 0,
                fallita: None,
            }),
            cambiato: Condvar::new(),
        }
    }

    fn blocca(&self) -> Result<MutexGuard<'_, Interno<T>>, ErroreMotore> {
        self.interno
            .lock()
            .map_err(|_| ErroreMotore::LucchettoAvvelenato(LUCCHETTO))
    }

    /// Il motore, costruito adesso se non c'è ancora.
    ///
    /// Durante una costruzione avviata da un altro thread aspetta che finisca
    /// e ne riceve l'esito: lo stesso `Arc`, o lo stesso errore.
    pub fn prendi(&self, servizi: &Arc<Servizi>) -> Result<Arc<T>, ErroreMotore> {
        let mut interno = self.blocca()?;
        let giro = loop {
            match &interno.stato {
                Stato::Pronto(motore) => return Ok(Arc::clone(motore)),
                Stato::Vuoto => {
                    interno.giro += 1;
                    interno.stato = Stato::InCostruzione;
                    break interno.giro;
                }
                Stato::InCostruzione => {
                    let atteso = interno.giro;
                    interno = self
                        .cambiato
                        .wait_while(interno, |i| {
                            matches!(i.stato, Stato::InCostruzione) && i.giro == atteso
                        })
                        .map_err(|_| ErroreMotore::LucchettoAvvelenato(LUCCHETTO))?;
                    if let Some((fallito, errore)) = &interno.fallita {
                        if *fallito == atteso {
                            return Err(errore.clone());
                        }
                    }
                    // Pronto, o già un'altra costruzione: si guarda di nuovo.
                }
            }
        };
        drop(interno);

        // Il lucchetto è lasciato: `crea` lavora senza tenerlo.
        let esito = catch_unwind(AssertUnwindSafe(|| (self.crea)(servizi)))
            .unwrap_or_else(|panico| Err(dal_panico(panico.as_ref())));

        // Qui il lucchetto si riprende anche se avvelenato: lasciare lo stato
        // In costruzione bloccherebbe per sempre chi aspetta. Le sezioni sotto
        // lucchetto di questo tipo non chiamano codice esterno, quindi i dati
        // che protegge restano coerenti.
        let mut interno = self.interno.lock().unwrap_or_else(PoisonError::into_inner);
        let risposta = match esito {
            Ok(motore) => {
                let motore = Arc::new(motore);
                interno.stato = Stato::Pronto(Arc::clone(&motore));
                interno.fallita = None;
                Ok(motore)
            }
            Err(errore) => {
                interno.stato = Stato::Vuoto;
                interno.fallita = Some((giro, errore.clone()));
                Err(errore)
            }
        };
        drop(interno);
        self.cambiato.notify_all();
        risposta
    }

    /// Il motore se è già costruito, senza costruirlo.
    ///
    /// Serve a chi vuole contarne le cache o svuotarle: un motore spento non
    /// si accende per dire che ha zero byte.
    pub fn se_acceso(&self) -> Option<Arc<T>> {
        match &self.blocca().ok()?.stato {
            Stato::Pronto(motore) => Some(Arc::clone(motore)),
            Stato::Vuoto | Stato::InCostruzione => None,
        }
    }

    /// Vero se il motore è costruito.
    pub fn acceso(&self) -> bool {
        self.blocca()
            .map(|interno| matches!(interno.stato, Stato::Pronto(_)))
            .unwrap_or(false)
    }

    /// Toglie il motore dal `Pigro`: la richiesta dopo lo ricostruisce.
    ///
    /// Vero se c'era un motore da togliere. Durante una costruzione non fa
    /// niente e dà falso: la costruzione arriva in fondo. Il motore non si
    /// distrugge sotto lucchetto, e chi ne tiene un `Arc` lo tiene vivo.
    pub fn libera(&self) -> bool {
        let Ok(mut interno) = self.blocca() else {
            return false;
        };
        if !matches!(interno.stato, Stato::Pronto(_)) {
            return false;
        }
        let tolto = std::mem::replace(&mut interno.stato, Stato::Vuoto);
        drop(interno);
        // Se era l'ultimo `Arc`, il motore cade qui, a lucchetto lasciato.
        drop(tolto);
        true
    }
}

impl<T: Send + Sync + 'static> Pigro<T> {
    /// Costruisce il motore in sottofondo, sul gruppo di thread dei servizi.
    ///
    /// Non aspetta: chi chiama [`Pigro::prendi`] dopo trova il motore pronto,
    /// o aspetta la costruzione già avviata. Un motore già acceso o in
    /// costruzione non avvia niente. Un errore si scrive nel log.
    pub fn scalda(self: &Arc<Self>, servizi: Arc<Servizi>) {
        match self.blocca() {
            Ok(interno) if matches!(interno.stato, Stato::Vuoto) => {}
            _ => return,
        }
        let pigro = Arc::clone(self);
        let lavori = Arc::clone(&servizi);
        lavori.lavori().in_sottofondo(move || {
            if let Err(errore) = pigro.prendi(&servizi) {
                tracing::warn!(%errore, "fub-motori: scaldare il motore non è riuscito");
            }
        });
    }
}

/// Il messaggio di un panico, quando è una stringa.
pub(crate) fn messaggio_del_panico(panico: &(dyn Any + Send)) -> String {
    if let Some(testo) = panico.downcast_ref::<&str>() {
        (*testo).to_owned()
    } else if let Some(testo) = panico.downcast_ref::<String>() {
        testo.clone()
    } else {
        "senza messaggio".to_owned()
    }
}

fn dal_panico(panico: &(dyn Any + Send)) -> ErroreMotore {
    let messaggio = messaggio_del_panico(panico);
    tracing::error!(%messaggio, "fub-motori: la costruzione di un motore è andata in panico");
    ErroreMotore::creazione(format!("panico durante la costruzione: {messaggio}"))
}
