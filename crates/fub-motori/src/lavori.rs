//! Il gruppo di thread dei motori.

use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex, PoisonError};

use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::pigro::messaggio_del_panico;
use crate::ErroreMotore;

/// Il numero massimo di thread del gruppo, qualunque sia la macchina.
const MASSIMO: usize = 8;

/// Il gruppo di thread dei motori: un `rayon::ThreadPool` suo, non quello
/// globale (lo usa già tantivy per gli indici).
///
/// Nasce alla prima richiesta, non quando nascono i servizi: un Fub che non
/// apre mai un motore non ha nemmeno un thread in più. I thread si chiamano
/// `fub-motore-{n}` e sono `available_parallelism() - 1`, almeno 1 e al più
/// 8, così il thread di chi chiede resta libero.
///
/// Un panico dentro un lavoro in sottofondo si scrive nel log e non chiude il
/// processo; dentro [`Lavori::installa`] torna a chi ha chiamato, come se il
/// lavoro fosse girato sul suo thread.
pub struct Lavori {
    quanti: usize,
    gruppo: Mutex<Option<Arc<ThreadPool>>>,
}

impl Lavori {
    /// Un gruppo non ancora costruito. `fili` sceglie quanti thread avrà;
    /// `None` li conta dalla macchina.
    pub fn nuovi(fili: Option<usize>) -> Self {
        let quanti = fili.unwrap_or_else(|| {
            let macchina = std::thread::available_parallelism().map_or(1, NonZeroUsize::get);
            macchina.saturating_sub(1)
        });
        Self {
            quanti: quanti.clamp(1, MASSIMO),
            gruppo: Mutex::new(None),
        }
    }

    /// Quanti thread ha, o avrà, il gruppo.
    pub fn quanti(&self) -> usize {
        self.quanti
    }

    /// Vero se il gruppo è già costruito, cioè se qualcuno gli ha già chiesto
    /// un lavoro.
    pub fn avviato(&self) -> bool {
        self.gruppo
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }

    /// Il gruppo, costruito adesso se è la prima richiesta. Se la costruzione
    /// non riesce, la richiesta dopo riprova.
    fn gruppo(&self) -> Result<Arc<ThreadPool>, ErroreMotore> {
        // Il lucchetto copre soltanto la costruzione del gruppo, non i lavori:
        // si prende l'`Arc` e lo si lascia prima di chiamare.
        let mut gruppo = self.gruppo.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(pronto) = gruppo.as_ref() {
            return Ok(Arc::clone(pronto));
        }
        let nuovo = ThreadPoolBuilder::new()
            .num_threads(self.quanti)
            .thread_name(|n| format!("fub-motore-{n}"))
            .panic_handler(|panico| {
                let messaggio = messaggio_del_panico(panico.as_ref());
                tracing::error!(%messaggio, "fub-motori: un lavoro in sottofondo è andato in panico");
            })
            .build()
            .map_err(|errore| {
                ErroreMotore::creazione(format!("il gruppo di thread dei motori: {errore}"))
            })?;
        let nuovo = Arc::new(nuovo);
        *gruppo = Some(Arc::clone(&nuovo));
        Ok(nuovo)
    }

    /// Avvia `lavoro` sul gruppo e torna subito.
    ///
    /// Se il gruppo non si può costruire, il lavoro non parte e l'errore si
    /// scrive nel log: nessun lavoro in sottofondo è necessario a una
    /// risposta, e chi ne ha bisogno lo rifà con [`Lavori::installa`].
    pub fn in_sottofondo<F>(&self, lavoro: F)
    where
        F: FnOnce() + Send + 'static,
    {
        match self.gruppo() {
            Ok(gruppo) => gruppo.spawn(lavoro),
            Err(errore) => {
                tracing::error!(%errore, "fub-motori: il lavoro in sottofondo non è partito");
            }
        }
    }

    /// Esegue `lavoro` dentro il gruppo e ne aspetta il risultato. Il
    /// parallelismo di `rayon` usato dentro (`par_iter`, `join`) resta nel
    /// gruppo dei motori.
    ///
    /// Se il gruppo non si può costruire, il lavoro gira sul thread di chi
    /// chiama: più lento, ma la risposta arriva lo stesso.
    pub fn installa<F, R>(&self, lavoro: F) -> R
    where
        F: FnOnce() -> R + Send,
        R: Send,
    {
        match self.gruppo() {
            Ok(gruppo) => gruppo.install(lavoro),
            Err(errore) => {
                tracing::warn!(%errore, "fub-motori: il lavoro gira sul thread di chi chiama");
                lavoro()
            }
        }
    }
}

impl std::fmt::Debug for Lavori {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Lavori")
            .field("quanti", &self.quanti)
            .field("avviato", &self.avviato())
            .finish()
    }
}
