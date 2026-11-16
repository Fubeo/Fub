//! **L'host che si presta per la durata di una chiamata.**
//!
//! Il contratto passa le capacità come `&mut dyn HostApi` o `&dyn ReadApi`, e
//! le passa *a ogni chiamata*. Non c'è nessun momento in cui un plugin «ha»
//! l'host: ce l'ha mentre lo stanno chiamando, e un istante prima o dopo quel
//! riferimento non esiste.
//!
//! Wasmtime vuole il contrario: le host function leggono lo stato dal
//! `Store<T>`, che vive quanto l'istanza. Le due forme non combaciano, e questo
//! modulo è la giunzione: lo `Store` tiene un **puntatore** all'host, valido
//! solo dentro [`with_read_guest`] o [`with_guest`], e ogni host function lo
//! legge da lì.
//!
//! Il puntatore è scritto da una di quelle funzioni e cancellato dal suo
//! `Drop`, che gira anche se il corpo va in panico. Fra i due istanti il
//! riferimento originale è vivo per costruzione — è il parametro della
//! funzione che sta chiamando — e nessuno può prendere lo `Store` senza
//! attraversare la stessa funzione. Fuori da quella parentesi il campo è
//! `None`, e una host function che ci arrivasse lo stesso trova `None`:
//! risponde [`PluginError::Internal`] invece di leggere memoria altrui.
//!
//! Il `Send` a mano è la conseguenza dichiarata: i puntatori non sono `Send`,
//! ma il solo momento in cui questo campo non è nullo è dentro una parentesi
//! che non attraversa nessun confine di thread. Lo `Store` invece i thread li
//! attraversa — un job gira sul pool — e ci arriva sempre **vuoto**.

use fub_abi::traits::{HostApi, ReadApi};
use fub_abi::PluginError;
use wasmtime::Store;

/// L'host prestato. `'static` per finta: la vita vera è quella della parentesi
/// di [`with_guest`], e l'invariante che la sostituisce è scritta lì sopra.
type Guest = *mut (dyn HostApi + 'static);
type ReadGuest = *const (dyn ReadApi + 'static);

enum BorrowedGuest {
    Read(ReadGuest),
    Write(Guest),
}

/// Ciò che una host function ha davanti quando la chiamano.
pub(crate) struct State {
    guest: Option<BorrowedGuest>,
    /// Il tetto di memoria di questa istanza (`crate::limits`).
    ///
    /// Sta qui e non nel modulo che lo decide perché `Store::limiter` non vuole
    /// un valore, vuole una **chiusura che peschi il limitatore dal dato dello
    /// store**: è la forma con cui wasmtime permette a un limitatore di
    /// ricordarsi di ciò che ha già concesso. Il dato dello store è questo
    /// tipo, quindi il tetto abita qui — accanto al prestito dell'host, con cui
    /// non ha niente da spartire se non l'indirizzo.
    limits: crate::limits::Limiter,
    /// I byte di `wasi:random` che la chiamata in corso può ancora chiedere
    /// (`crate::limits::RANDOM_BUDGET`): li rimette [`crate::limits::renew`]
    /// all'inizio di ogni chiamata del contratto.
    random_left: u64,
}

// SAFETY: i puntatori sono valorizzati solo durante una chiamata sincrona.
unsafe impl Send for State {}

impl State {
    pub(crate) fn empty() -> Self {
        State {
            guest: None,
            limits: crate::limits::ceiling(),
            random_left: crate::limits::RANDOM_BUDGET,
        }
    }

    pub(crate) fn limits(&mut self) -> &mut crate::limits::Limiter {
        &mut self.limits
    }

    /// Rimette il budget di `wasi:random` della chiamata che comincia.
    pub(crate) fn refill_random(&mut self) {
        self.random_left = crate::limits::RANDOM_BUDGET;
    }

    /// Toglie `len` byte dal budget di `wasi:random`, o rifiuta senza toccarlo
    /// se non bastano: chi rifiuta qui ferma il guest con una trap.
    pub(crate) fn take_random(&mut self, len: u64) -> Result<(), RandomBudgetSpent> {
        match self.random_left.checked_sub(len) {
            Some(left) => {
                self.random_left = left;
                Ok(())
            }
            None => Err(RandomBudgetSpent {
                asked: len,
                left: self.random_left,
            }),
        }
    }

    /// Capacità di lettura disponibili durante una chiamata.
    pub(crate) fn reader(&self) -> Result<&dyn ReadApi, PluginError> {
        match self.guest.as_ref() {
            Some(BorrowedGuest::Read(p)) => {
                // SAFETY: il puntatore è vivo per la parentesi di prestito.
                Ok(unsafe { &**p })
            }
            Some(BorrowedGuest::Write(p)) => {
                // SAFETY: HostApi estende ReadApi e il puntatore è vivo per la
                // parentesi di prestito.
                Ok(unsafe { &**p })
            }
            None => Err(PluginError::Internal(
                "host capabilities requested outside a contract call".into(),
            )),
        }
    }

    /// Capacità mutabili disponibili solo durante una chiamata in scrittura.
    pub(crate) fn writer(&mut self) -> Result<&mut dyn HostApi, PluginError> {
        match self.guest.as_mut() {
            Some(BorrowedGuest::Write(p)) => {
                // SAFETY: il puntatore è vivo per la parentesi di prestito.
                Ok(unsafe { &mut **p })
            }
            Some(BorrowedGuest::Read(_)) => Err(PluginError::Internal(
                "write capability requested during a read-only call".into(),
            )),
            None => Err(PluginError::Internal(
                "host capabilities requested outside a contract call".into(),
            )),
        }
    }
}

/// Presta capacità read-only allo `store` per la durata di `f`.
pub(crate) fn with_read_guest<R>(
    store: &mut Store<State>,
    host: &dyn ReadApi,
    f: impl FnOnce(&mut Store<State>) -> R,
) -> R {
    crate::limits::renew(store);
    let ptr: *const (dyn ReadApi + '_) = host;
    let ptr: ReadGuest = unsafe { std::mem::transmute(ptr) };
    let previous = store.data_mut().guest.replace(BorrowedGuest::Read(ptr));
    let guard = Return { store, previous };
    f(&mut *guard.store)
}

/// Presta capacità mutabili allo `store` per la durata di `f`.
pub(crate) fn with_guest<R>(
    store: &mut Store<State>,
    host: &mut dyn HostApi,
    f: impl FnOnce(&mut Store<State>) -> R,
) -> R {
    crate::limits::renew(store);
    let ptr: *mut (dyn HostApi + '_) = host;
    let ptr: Guest = unsafe { std::mem::transmute(ptr) };
    let previous = store.data_mut().guest.replace(BorrowedGuest::Write(ptr));
    let guard = Return { store, previous };
    f(&mut *guard.store)
}

/// Il budget di `wasi:random` della chiamata non basta per la richiesta.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RandomBudgetSpent {
    pub(crate) asked: u64,
    pub(crate) left: u64,
}

impl std::fmt::Display for RandomBudgetSpent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "wasi:random: {} byte richiesti, ne restano {} dei {} di questa chiamata",
            self.asked,
            self.left,
            crate::limits::RANDOM_BUDGET
        )
    }
}

impl std::error::Error for RandomBudgetSpent {}

struct Return<'s> {
    store: &'s mut Store<State>,
    previous: Option<BorrowedGuest>,
}

impl Drop for Return<'_> {
    fn drop(&mut self) {
        self.store.data_mut().guest = self.previous.take();
    }
}
