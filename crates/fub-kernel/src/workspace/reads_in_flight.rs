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
use std::sync::Arc;

use crate::poison::Condition;

/// Il registro delle letture in volo di un workspace. Si clona come un `Arc`:
/// l'host ne tiene una copia per aspettare **senza** il lucchetto del
/// workspace.
///
/// Sta dietro una [`Condition`]: la tabella è fatta di iscrizioni
/// indipendenti, che un panico a metà non rende incredibili, e chi aspetta
/// riguarda lo stato con la sua condizione.
#[derive(Clone, Default)]
pub struct ReadsInFlight(Arc<Condition<State>>);

#[derive(Debug, Default)]
struct State {
    next: u64,
    live: HashMap<u64, Entry>,
}

#[derive(Debug)]
struct Entry {
    owner: String,
    cancel: Arc<AtomicBool>,
}

impl ReadsInFlight {
    /// Iscrive una lettura di `owner`; la guardia la cancella quando muore.
    pub(crate) fn enter(&self, owner: &str, cancel: Arc<AtomicBool>) -> ReadInFlight {
        let mut state = self.0.acquire();
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
            .acquire()
            .live
            .values()
            .any(|entry| entry.owner == owner)
    }

    /// Quante letture sono in volo adesso.
    pub fn count(&self) -> usize {
        self.0.acquire().live.len()
    }

    /// Alza la bandiera di ogni lettura in volo: il loro host smette di
    /// servirle alla prossima chiamata, e l'esito torna `Cancelled`.
    pub fn cancel_all(&self) {
        for entry in self.0.acquire().live.values() {
            entry.cancel.store(true, Ordering::Relaxed);
        }
    }

    /// Alza la bandiera delle sole letture di `owner`, prima di smontarne i
    /// provider.
    pub fn cancel_owner(&self, owner: &str) {
        for entry in self.0.acquire().live.values() {
            if entry.owner == owner {
                entry.cancel.store(true, Ordering::Relaxed);
            }
        }
    }

    /// Torna quando nessuna lettura è più in volo.
    ///
    /// Va chiamata **senza** il lucchetto del workspace: una lettura, per
    /// finire, ne prende un prestito condiviso. Chi tiene il turno alza prima
    /// le bandiere ([`cancel_all`](Self::cancel_all)): una lettura che chiede
    /// il turno lo chiede cedendo, e cede appena vede la sua.
    pub fn wait_idle(&self) {
        let state = self.0.acquire();
        let _idle = self.0.wait(state, |state| !state.live.is_empty());
    }

    /// Torna quando `owner` non ha più letture in volo, con le stesse regole
    /// di [`wait_idle`](Self::wait_idle) (e [`cancel_owner`](Self::cancel_owner)
    /// prima, se si tiene il turno).
    pub fn wait_owner_idle(&self, owner: &str) {
        let state = self.0.acquire();
        let _idle = self.0.wait(state, |state| {
            state.live.values().any(|entry| entry.owner == owner)
        });
    }
}

/// L'iscrizione di una lettura in volo: vive dentro il token e lo segue.
pub(crate) struct ReadInFlight {
    shared: Arc<Condition<State>>,
    id: u64,
}

impl Drop for ReadInFlight {
    fn drop(&mut self) {
        // `change` sveglia tutti: anche chi aspetta un proprietario solo
        // mentre altre letture restano in volo.
        self.shared.change(|state| {
            state.live.remove(&self.id);
        });
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
