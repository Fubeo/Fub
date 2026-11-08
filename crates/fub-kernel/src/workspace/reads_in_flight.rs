//! Le letture **in volo**: i comandi di sola lettura che girano col loro frame
//! ([`PreparedReadOnlyCommand`](super::PreparedReadOnlyCommand)) e che il
//! turno di scrittura non vede più.
//!
//! Il frame condiviso diceva da sé che un provider era in uso
//! (`in_provider_call`), e la chiusura del vault aspettava il turno, cioè il
//! comando. Una lettura senza turno lo deve dire in un altro modo: si iscrive
//! qui al prepare, con il suo proprietario e la bandiera con cui la si può
//! fermare, e si cancella quando il token muore — anche se il provider va in
//! panico o la fine non viene mai chiamata. Lo smontaggio di un proprietario
//! con letture in volo risponde `Busy`; la chiusura le ferma e le aspetta.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

/// Il registro delle letture in volo di un workspace. Si clona come un `Arc`:
/// l'host ne tiene una copia per aspettare **senza** il lucchetto del
/// workspace.
#[derive(Clone, Default)]
pub struct ReadsInFlight(Arc<Shared>);

#[derive(Default)]
struct Shared {
    state: Mutex<State>,
    idle: Condvar,
}

#[derive(Default)]
struct State {
    next: u64,
    live: HashMap<u64, Entry>,
}

struct Entry {
    owner: String,
    cancel: Arc<AtomicBool>,
}

impl Shared {
    /// Il dato protetto è una tabella di iscrizioni indipendenti: un panico a
    /// metà non lascia invarianti rotti, quindi il veleno non conta.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl ReadsInFlight {
    /// Iscrive una lettura di `owner`; la guardia la cancella quando muore.
    pub(crate) fn enter(&self, owner: &str, cancel: Arc<AtomicBool>) -> ReadInFlight {
        let mut state = self.0.lock();
        let id = state.next;
        state.next = state.next.wrapping_add(1);
        state.live.insert(
            id,
            Entry {
                owner: owner.to_string(),
                cancel,
            },
        );
        ReadInFlight {
            shared: Arc::clone(&self.0),
            id,
        }
    }

    /// `owner` ha letture in volo? Allora i suoi provider sono in uso.
    pub fn busy(&self, owner: &str) -> bool {
        self.0
            .lock()
            .live
            .values()
            .any(|entry| entry.owner == owner)
    }

    /// Quante letture sono in volo adesso.
    pub fn count(&self) -> usize {
        self.0.lock().live.len()
    }

    /// Alza la bandiera di ogni lettura in volo: il loro host smette di
    /// servirle alla prossima chiamata, e l'esito torna `Cancelled`.
    pub fn cancel_all(&self) {
        for entry in self.0.lock().live.values() {
            entry.cancel.store(true, Ordering::Relaxed);
        }
    }

    /// Alza la bandiera delle sole letture di `owner`, prima di smontarne i
    /// provider.
    pub fn cancel_owner(&self, owner: &str) {
        for entry in self.0.lock().live.values() {
            if entry.owner == owner {
                entry.cancel.store(true, Ordering::Relaxed);
            }
        }
    }

    /// Torna quando nessuna lettura è più in volo. Va chiamata **senza** il
    /// lucchetto del workspace: una lettura, per finire, ne prende un prestito
    /// condiviso.
    pub fn wait_idle(&self) {
        let state = self.0.lock();
        let _idle = self
            .0
            .idle
            .wait_while(state, |state| !state.live.is_empty())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }
}

impl ReadsInFlight {
    /// Torna quando `owner` non ha più letture in volo. Come
    /// [`wait_idle`](Self::wait_idle), senza il lucchetto del workspace e
    /// senza il turno: una lettura che chiede il turno lo deve poter avere.
    pub fn wait_owner_idle(&self, owner: &str) {
        let state = self.0.lock();
        let _idle = self
            .0
            .idle
            .wait_while(state, |state| {
                state.live.values().any(|entry| entry.owner == owner)
            })
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }
}

/// L'iscrizione di una lettura in volo: vive dentro il token e lo segue.
pub(crate) struct ReadInFlight {
    shared: Arc<Shared>,
    id: u64,
}

impl Drop for ReadInFlight {
    fn drop(&mut self) {
        let mut state = self.shared.lock();
        state.live.remove(&self.id);
        // Chi aspetta un proprietario solo si sveglia anche se altre letture
        // restano in volo.
        self.shared.idle.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dropped_guard_leaves_the_owner_and_wakes_the_waiter() {
        let reads = ReadsInFlight::default();
        let cancel = Arc::new(AtomicBool::new(false));
        let guard = reads.enter("a", Arc::clone(&cancel));
        assert!(reads.busy("a"));
        assert!(!reads.busy("b"));
        reads.cancel_all();
        assert!(cancel.load(Ordering::Relaxed));
        std::thread::scope(|s| {
            let waiter = s.spawn(|| reads.wait_idle());
            drop(guard);
            waiter.join().expect("the waiter wakes");
        });
        assert!(!reads.busy("a"));
        assert_eq!(reads.count(), 0);
    }
}
