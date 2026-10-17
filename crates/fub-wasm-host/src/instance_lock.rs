//! **La sola porta da cui si prende un'istanza** (FUB-019).
//!
//! Plugin e provider di uno stesso componente condividono un `Mutex<Instance>`.
//! Prenderlo con un `.lock()` nudo è invisibile a chi deve capire se un thread
//! sta aspettando ciò che un altro tiene: un salvataggio che tiene il turno di
//! scrittura del vault e chiede il parser, un hook, un indice o un handler di
//! evento aspetta l'istanza, e un job che la tiene e chiede il turno aspetta il
//! salvataggio. Il grafo di queste attese sta in [`fub_host::waits`]; questa
//! porta lo alimenta.
//!
//! - quando l'istanza è libera si prende e basta (`try_lock`), e si registra che
//!   questo thread la tiene;
//! - quando non lo è si registra che questo thread **la aspetta** e solo allora
//!   ci si mette in fila, così chi sta dall'altra parte può accorgersi del ciclo
//!   e cedere;
//! - quella registrazione **controlla** che l'attesa non chiuda un ciclo di sole
//!   istanze (A tiene X e aspetta Y, B tiene Y e aspetta X, senza il turno di
//!   scrittura di mezzo): l'ultimo che arriva non si mette in fila e riceve
//!   [`Unavailable::Cycle`], che il chiamante riporta come `Conflict`. Chi
//!   ignora l'errore e ritenta trova lo stesso ciclo e lo stesso errore finché
//!   l'altro lato non ha restituito l'istanza: non si ferma per sempre.
//!
//! Il verso dei due registri conta: *tenere* si toglie **prima** di rilasciare il
//! mutex (altrimenti il prossimo titolare troverebbe il proprio fatto cancellato
//! dal rilascio del precedente), e *aspettare* si toglie dopo averlo ottenuto.
//!
//! Nessun altro file di questo crate, a parte `managed.rs` (che non tocca
//! istanze), chiama `.lock()` o `.try_lock()`: lo verifica
//! `tests/instance_door.rs`. Il comportamento, invece, lo prova
//! `tests/the_instance_and_the_turn.rs` con un componente vero.

use std::fmt;
use std::ops::{Deref, DerefMut};
use std::sync::{Mutex, MutexGuard, TryLockError};

use fub_abi::text::Text;
use fub_abi::PluginError;
use fub_host::waits::{hold_instance, try_wait_instance, InstanceHold};

use crate::component::{instance_identity, Instance};

/// Perché un'istanza non si è potuta prendere.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Unavailable {
    /// L'istanza è avvelenata: un panico l'ha interrotta a metà.
    Poisoned,
    /// Aspettarla chiuderebbe un ciclo: chi la tiene aspetta, di seguito, ciò che
    /// questo thread tiene. Si riprova quando l'altro lato ha restituito la sua.
    Cycle,
}

impl fmt::Display for Unavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Unavailable::Poisoned => f.write_str("component instance is poisoned"),
            Unavailable::Cycle => {
                f.write_str("component instance is held by a call that waits for this one")
            }
        }
    }
}

impl From<Unavailable> for PluginError {
    fn from(why: Unavailable) -> PluginError {
        match why {
            Unavailable::Poisoned => PluginError::Internal(why.to_string().into()),
            // Né colpa di chi chiama né difetto del componente: il lavoro va
            // ricalcolato, come per il turno (`host.turn.cycle`).
            Unavailable::Cycle => {
                PluginError::Conflict(Text::message("host.instance.cycle", vec![]))
            }
        }
    }
}

/// L'istanza di un componente, in mano a questo thread.
pub(crate) struct HeldInstance<'a> {
    // Prima del mutex: vedi il doc del modulo. I campi si rilasciano in ordine
    // di dichiarazione.
    _hold: InstanceHold,
    guard: MutexGuard<'a, Instance>,
}

impl Deref for HeldInstance<'_> {
    type Target = Instance;
    fn deref(&self) -> &Instance {
        &self.guard
    }
}

impl DerefMut for HeldInstance<'_> {
    fn deref_mut(&mut self) -> &mut Instance {
        &mut self.guard
    }
}

/// Prendere l'istanza passando dal grafo delle attese.
pub(crate) trait LockInstance {
    fn lock_instance(&self) -> Result<HeldInstance<'_>, Unavailable>;
}

impl LockInstance for Mutex<Instance> {
    fn lock_instance(&self) -> Result<HeldInstance<'_>, Unavailable> {
        let (hold, guard) = lock_tracked(self, instance_identity(self) as usize)?;
        Ok(HeldInstance { _hold: hold, guard })
    }
}

/// Il mutex di `token` passando dal grafo delle attese. Generica sul contenuto,
/// perché il comportamento non dipende da cosa c'è dentro l'istanza e così si
/// prova senza un componente.
fn lock_tracked<T>(
    mutex: &Mutex<T>,
    token: usize,
) -> Result<(InstanceHold, MutexGuard<'_, T>), Unavailable> {
    let guard = match mutex.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::Poisoned(_)) => return Err(Unavailable::Poisoned),
        Err(TryLockError::WouldBlock) => {
            let _waiting = try_wait_instance(token).map_err(|_| Unavailable::Cycle)?;
            mutex.lock().map_err(|_| Unavailable::Poisoned)?
        }
    };
    Ok((hold_instance(token), guard))
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_host::waits::thread_waits_for_an_instance;
    use std::sync::mpsc;
    use std::thread::ThreadId;

    fn token_of<T>(mutex: &Mutex<T>) -> usize {
        std::ptr::from_ref(mutex) as usize
    }

    /// Aspetta che `thread` sia davvero in fila su un'istanza: è un fatto del
    /// grafo, non una questione di tempo.
    fn until_waiting(thread: ThreadId) {
        while !thread_waits_for_an_instance(thread) {
            std::thread::yield_now();
        }
    }

    /// A tiene X e vuole Y, B tiene Y e vuole X: senza il controllo i due
    /// restano in attesa per sempre; con il controllo l'ultimo a chiedere
    /// riceve `Cycle` e, restituendo la sua, libera l'altro.
    #[test]
    fn two_instances_waiting_for_each_other_do_not_wait_forever() {
        let (x, y) = (Mutex::new(()), Mutex::new(()));
        let (x, y) = (&x, &y);
        let (a_ready_tx, a_ready_rx) = mpsc::channel();
        let (b_ready_tx, b_ready_rx) = mpsc::channel();

        let (a_outcome, b_outcome) = std::thread::scope(|s| {
            let a = s.spawn(move || {
                let _x = lock_tracked(x, token_of(x)).expect("X è libera");
                a_ready_tx.send(std::thread::current().id()).unwrap();
                b_ready_rx.recv().unwrap();
                // A chiede Y, che B tiene: si mette in fila.
                lock_tracked(y, token_of(y)).map(|_| ())
            });
            let b = s.spawn(move || {
                let _y = lock_tracked(y, token_of(y)).expect("Y è libera");
                b_ready_tx.send(()).unwrap();
                until_waiting(a_ready_rx.recv().unwrap());
                // B chiede X, che A tiene mentre aspetta Y, che B tiene: ciclo.
                // `_y` si restituisce all'uscita, e solo allora A prosegue.
                lock_tracked(x, token_of(x)).map(|_| ())
            });
            (a.join().unwrap(), b.join().unwrap())
        });
        assert_eq!(
            b_outcome,
            Err(Unavailable::Cycle),
            "l'ultimo a chiedere cede"
        );
        assert_eq!(
            a_outcome,
            Ok(()),
            "chi ha chiesto per primo prosegue appena l'altro restituisce"
        );
    }

    /// Chi ignora l'errore e ritenta riceve lo stesso errore finché l'altro lato
    /// tiene: non si mette in fila su un ciclo.
    #[test]
    fn a_retry_meets_the_same_cycle() {
        let (x, y) = (Mutex::new(()), Mutex::new(()));
        let (x, y) = (&x, &y);
        let (a_ready_tx, a_ready_rx) = mpsc::channel();
        let (b_ready_tx, b_ready_rx) = mpsc::channel();

        let refusals = std::thread::scope(|s| {
            let a = s.spawn(move || {
                let _x = lock_tracked(x, token_of(x)).expect("X è libera");
                a_ready_tx.send(std::thread::current().id()).unwrap();
                b_ready_rx.recv().unwrap();
                let _y = lock_tracked(y, token_of(y)).expect("B restituisce Y");
            });
            let b = s.spawn(move || {
                let _y = lock_tracked(y, token_of(y)).expect("Y è libera");
                b_ready_tx.send(()).unwrap();
                until_waiting(a_ready_rx.recv().unwrap());
                (0..5)
                    .filter(|_| lock_tracked(x, token_of(x)).map(|_| ()) == Err(Unavailable::Cycle))
                    .count()
            });
            let refusals = b.join().unwrap();
            a.join().unwrap();
            refusals
        });
        assert_eq!(refusals, 5, "ogni tentativo vede il ciclo");
    }

    /// Un'istanza occupata da chi non aspetta niente non è un ciclo: si aspetta.
    #[test]
    fn waiting_for_a_busy_instance_that_waits_for_nothing_is_allowed() {
        let x = Mutex::new(());
        let x = &x;
        let (held_tx, held_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        std::thread::scope(|s| {
            let holder = s.spawn(move || {
                let _x = lock_tracked(x, token_of(x)).expect("X è libera");
                held_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            });
            held_rx.recv().unwrap();
            let waiter = s.spawn(move || lock_tracked(x, token_of(x)).map(|_| ()));
            // Il waiter è davvero in fila prima di rilasciare.
            until_waiting(waiter.thread().id());
            release_tx.send(()).unwrap();
            holder.join().unwrap();
            assert_eq!(waiter.join().unwrap(), Ok(()));
        });
    }

    #[test]
    fn a_cycle_is_a_conflict_and_a_poisoned_instance_is_internal() {
        assert!(matches!(
            PluginError::from(Unavailable::Cycle),
            PluginError::Conflict(Text::Message(message)) if message.key == "host.instance.cycle"
        ));
        assert!(matches!(
            PluginError::from(Unavailable::Poisoned),
            PluginError::Internal(_)
        ));
    }

    #[test]
    fn a_poisoned_instance_is_reported_as_such() {
        let x = Mutex::new(());
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = x.lock().unwrap();
            panic!("un panico a metà");
        }));
        assert_eq!(
            lock_tracked(&x, token_of(&x)).map(|_| ()),
            Err(Unavailable::Poisoned)
        );
    }
}
