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
//!   e cedere.
//!
//! Il verso dei due registri conta: *tenere* si toglie **prima** di rilasciare il
//! mutex (altrimenti il prossimo titolare troverebbe il proprio fatto cancellato
//! dal rilascio del precedente), e *aspettare* si toglie dopo averlo ottenuto.
//!
//! Nessun altro file di questo crate, a parte `managed.rs` (che non tocca
//! istanze), chiama `.lock()` o `.try_lock()`: lo verifica
//! `tests/instance_door.rs`. Il comportamento, invece, lo prova
//! `tests/the_instance_and_the_turn.rs` con un componente vero.

use std::ops::{Deref, DerefMut};
use std::sync::{Mutex, MutexGuard, TryLockError};

use fub_host::waits::{hold_instance, wait_instance, InstanceHold};

use crate::component::{instance_identity, Instance};

/// L'istanza è avvelenata: un panico l'ha interrotta a metà.
pub(crate) struct Poisoned;

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
    fn lock_instance(&self) -> Result<HeldInstance<'_>, Poisoned>;
}

impl LockInstance for Mutex<Instance> {
    fn lock_instance(&self) -> Result<HeldInstance<'_>, Poisoned> {
        let token = instance_identity(self) as usize;
        let guard = match self.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::Poisoned(_)) => return Err(Poisoned),
            Err(TryLockError::WouldBlock) => {
                let _waiting = wait_instance(token);
                self.lock().map_err(|_| Poisoned)?
            }
        };
        Ok(HeldInstance {
            _hold: hold_instance(token),
            guard,
        })
    }
}
