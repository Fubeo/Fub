//! **L'host che si presta per la durata di una chiamata.**
//!
//! Il contratto passa le capacità come `&mut dyn HostApi`, e le passa *a ogni
//! chiamata*: `run_job(&self, …, host: &mut dyn HostApi)`. Non c'è nessun
//! momento in cui un plugin «ha» l'host — ce l'ha mentre lo stanno chiamando, e
//! un istante prima o dopo quel riferimento non esiste. È deliberato: è ciò che
//! permette al kernel di dare a ogni chiamata un host **incappucciato**
//! diversamente (sola lettura per un `dry-run`, coi permessi di *quel* plugin,
//! §7.3).
//!
//! Wasmtime vuole il contrario: le host function leggono lo stato dal
//! `Store<T>`, che vive quanto l'istanza. Le due forme non combaciano, e questo
//! modulo è la giunzione: lo `Store` tiene un **puntatore** all'host, valido
//! solo dentro [`con_ospite`], e ogni host function lo legge da lì.
//!
//! # L'invariante, per esteso
//!
//! Il puntatore è scritto da [`con_ospite`] e cancellato dal suo `Drop`, che
//! gira anche se il corpo va in panico. Fra i due istanti il riferimento
//! originale è vivo per costruzione — è il parametro della funzione che sta
//! chiamando — e nessuno può prendere lo `Store` senza attraversare la stessa
//! funzione, perché lo `Store` sta dietro un `Mutex` che solo i proxy di questo
//! crate aprono. Fuori da quella parentesi il campo è `None`, e una host
//! function che ci arrivasse lo stesso trova `None`: risponde
//! [`PluginError::Internal`] invece di leggere memoria altrui.
//!
//! Il `Send` a mano è la conseguenza dichiarata: un `*mut` non è `Send`, ma il
//! solo momento in cui questo campo non è nullo è dentro `con_ospite`, che non
//! attraversa nessun confine di thread. Lo `Store` invece i thread li
//! attraversa — un job gira sul pool — e ci arriva sempre **vuoto**.

use fub_abi::traits::HostApi;
use fub_abi::PluginError;
use wasmtime::Store;

/// L'host prestato. `'static` per finta: la vita vera è quella della parentesi
/// di [`con_ospite`], e l'invariante che la sostituisce è scritta lì sopra.
type Ospite = *mut (dyn HostApi + 'static);

/// Ciò che una host function ha davanti quando la chiamano.
pub(crate) struct Stato {
    ospite: Option<Ospite>,
}

// SAFETY: vedi l'invariante del modulo — fuori da `con_ospite` il campo è
// `None`, e `con_ospite` non attraversa thread.
unsafe impl Send for Stato {}

impl Stato {
    pub(crate) fn vuoto() -> Self {
        Stato { ospite: None }
    }

    /// Le capacità di questa chiamata.
    ///
    /// L'errore non è teorico solo in apparenza: è ciò che succederebbe se un
    /// componente riuscisse a chiamare una host function da un callback che
    /// l'host non ha aperto lui. Dirlo con un `plugin-error` invece che con un
    /// `unwrap` è la stessa scelta di `trappable_imports` spento — un guasto
    /// che si racconta vale più di un'istanza abbattuta.
    pub(crate) fn ospite(&mut self) -> Result<&mut dyn HostApi, PluginError> {
        match self.ospite {
            // SAFETY: il puntatore è stato scritto da `con_ospite`, che è
            // ancora nella propria parentesi — altrimenti il campo sarebbe
            // `None` — e quindi il riferimento originale è vivo.
            Some(p) => Ok(unsafe { &mut *p }),
            None => Err(PluginError::Internal(
                "capacità dell'host chiesta fuori da una chiamata del contratto".into(),
            )),
        }
    }
}

/// Presta `host` allo `store` per la durata di `f`.
pub(crate) fn con_ospite<R>(
    store: &mut Store<Stato>,
    host: &mut dyn HostApi,
    f: impl FnOnce(&mut Store<Stato>) -> R,
) -> R {
    // La bugia sulla vita, in un punto solo e dichiarato: il puntatore vale
    // finché `host` vale, cioè finché questa funzione non è tornata.
    let ptr: *mut (dyn HostApi + '_) = host;
    let ptr: Ospite = unsafe { std::mem::transmute(ptr) };

    let precedente = store.data_mut().ospite.replace(ptr);
    let restituzione = Restituzione { store, precedente };
    f(&mut *restituzione.store)
}

/// Rimette a posto ciò che c'era prima, anche uscendo per un panico.
struct Restituzione<'s> {
    store: &'s mut Store<Stato>,
    precedente: Option<Ospite>,
}

impl Drop for Restituzione<'_> {
    fn drop(&mut self) {
        self.store.data_mut().ospite = self.precedente;
    }
}
