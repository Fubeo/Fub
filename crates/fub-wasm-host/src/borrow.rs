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
//! solo dentro [`with_guest`], e ogni host function lo legge da lì.
//!
//! # L'invariante, per esteso
//!
//! Il puntatore è scritto da [`with_guest`] e cancellato dal suo `Drop`, che
//! gira anche se il corpo va in panico. Fra i due istanti il riferimento
//! originale è vivo per costruzione — è il parametro della funzione che sta
//! chiamando — e nessuno può prendere lo `Store` senza attraversare la stessa
//! funzione, perché lo `Store` sta dietro un `Mutex` che solo i proxy di questo
//! crate aprono. Fuori da quella parentesi il campo è `None`, e una host
//! function che ci arrivasse lo stesso trova `None`: risponde
//! [`PluginError::Internal`] invece di leggere memoria altrui.
//!
//! Il `Send` a mano è la conseguenza dichiarata: un `*mut` non è `Send`, ma il
//! solo momento in cui questo campo non è nullo è dentro `with_guest`, che non
//! attraversa nessun confine di thread. Lo `Store` invece i thread li
//! attraversa — un job gira sul pool — e ci arriva sempre **vuoto**.

use fub_abi::traits::HostApi;
use fub_abi::PluginError;
use wasmtime::{Store, StoreLimits};

/// L'host prestato. `'static` per finta: la vita vera è quella della parentesi
/// di [`with_guest`], e l'invariante che la sostituisce è scritta lì sopra.
/// Ciò che una host function ha davanti quando la chiamano.
type Guest = *mut (dyn HostApi + 'static);

/// Il tetto di memoria di questa istanza (`crate::limits`).
pub(crate) struct State {
    guest: Option<Guest>,
    ///
    /// Sta qui e non nel modulo che lo decide perché `Store::limiter` non vuole
    /// un valore, vuole una **chiusura che peschi il limitatore dal dato dello
    /// store**: è la forma con cui wasmtime permette a un limitatore di
    /// ricordarsi di ciò che ha già concesso. Il dato dello store è questo
    /// tipo, quindi il tetto abita qui — accanto al prestito dell'host, con cui
    /// non ha niente da spartire se non l'indirizzo.
    /// non ha niente da spartire se non l'indirizzo.
    limits: StoreLimits,
}

// SAFETY: vedi l'invariante del modulo — fuori da `with_guest` il campo
// `guest` è `None`, e `with_guest` non attraversa thread. `limits` sono dati
// semplici e attraversano da sé. Il `Send` scritto a mano copre però **tutto**
// il tipo, compreso ciò che ci finirà domani: chi aggiunge un campo qui deve
// poter aggiungere anche la riga che lo dichiara sicuro.
unsafe impl Send for State {}

impl State {
    pub(crate) fn empty() -> Self {
        State {
            guest: None,
            limits: crate::limits::ceiling(),
        }
    }

    /// Il tetto di memoria, per la chiusura di `Store::limiter`.
    pub(crate) fn limits(&mut self) -> &mut StoreLimits {
        &mut self.limits
    }

    /// Le capacità di questa chiamata.
    ///
    /// L'errore non è teorico solo in apparenza: è ciò che succederebbe se un
    /// componente riuscisse a chiamare una host function da un callback che
    /// l'host non ha aperto lui. Dirlo con un `plugin-error` invece che con un
    /// `unwrap` è la stessa scelta di `trappable_imports` spento — un guasto
    /// che si racconta vale più di un'istanza abbattuta.
    pub(crate) fn guest(&mut self) -> Result<&mut dyn HostApi, PluginError> {
        match self.guest {
            // SAFETY: il puntatore è stato scritto da `with_guest`, che è
            // ancora nella propria parentesi — altrimenti il campo sarebbe
            // `None` — e quindi il riferimento originale è vivo.
            Some(p) => Ok(unsafe { &mut *p }),
            None => Err(PluginError::Internal(
                "host capabilities requested outside a contract call".into(),
            )),
        }
    }
}

/// Presta `host` allo `store` per la durata di `f`.
pub(crate) fn with_guest<R>(
    store: &mut Store<State>,
    host: &mut dyn HostApi,
    f: impl FnOnce(&mut Store<State>) -> R,
) -> R {
    // La parentesi del prestito è anche la parentesi della **chiamata**, ed è
    // l'unica che questo crate abbia per chi l'host se lo merita: `activate`,
    // `deactivate`, `run_job` e `invoke` passano tutt'e quattro di qui e da
    // nessun'altra parte. Le due che non ci passano — `manifest` e l'elenco dei
    // comandi — sono le due che si fanno senza host, e rinnovano a mano la
    // scadenza che qui si rinnova da sé. Quindi è qui che il
    // cronometro del componente riparte. La scadenza a epoche è assoluta — vedi
    // `crate::limits::rinnova` — e armarla solo alla nascita dell'istanza
    // vorrebbe dire che un plugin montato all'avvio è già scaduto al primo job
    // del pomeriggio: il budget è per chiamata, e questa è la chiamata.
    crate::limits::renew(store);

    // La bugia sulla vita, in un punto solo e dichiarato: il puntatore vale
    // finché `host` vale, cioè finché questa funzione non è tornata.
    // finché `host` vale, cioè finché questa funzione non è tornata.
    let ptr: *mut (dyn HostApi + '_) = host;
    let ptr: Guest = unsafe { std::mem::transmute(ptr) };

    let previous = store.data_mut().guest.replace(ptr);
    let guard = Return { store, previous };
    f(&mut *guard.store)
}

/// Rimette a posto ciò che c'era prima, anche uscendo per un panico.
struct Return<'s> {
    store: &'s mut Store<State>,
    previous: Option<Guest>,
}

impl Drop for Return<'_> {
    fn drop(&mut self) {
        self.store.data_mut().guest = self.previous;
    }
}
