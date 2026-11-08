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
    /// I proprietari che si stanno smontando, con quante sbarre ciascuno:
    /// nessuna nuova lettura loro entra in volo finché la sbarra resta.
    barred: HashMap<String, usize>,
}

#[derive(Debug)]
struct Entry {
    owner: String,
    /// La bandiera della lettura sola.
    cancel: Arc<AtomicBool>,
    /// Le bandiere di chi la contiene (il job, le letture fuori): solo la
    /// chiusura del vault le alza.
    outer: Vec<Arc<AtomicBool>>,
}

impl ReadsInFlight {
    /// Iscrive una lettura di `owner`; la guardia la cancella quando muore.
    /// `None` se le nuove letture di `owner` sono sbarrate: il controllo e
    /// l'iscrizione stanno sotto lo stesso lucchetto, così chi sbarra e poi
    /// aspetta non si lascia scappare una lettura entrata nel mezzo.
    pub(crate) fn enter(
        &self,
        owner: &str,
        cancel: Arc<AtomicBool>,
        outer: Vec<Arc<AtomicBool>>,
    ) -> Option<ReadInFlight> {
        let mut state = self.0.acquire();
        if state.barred.contains_key(owner) {
            return None;
        }
        let id = state.next;
        state.next = state.next.wrapping_add(1);
        state.live.insert(
            id,
            Entry {
                owner: owner.to_string(),
                cancel,
                outer,
            },
        );
        Some(ReadInFlight {
            shared: Arc::clone(&self.0),
            id,
        })
    }

    /// Sbarra le **nuove** letture di `owner` finché la guardia vive: chi
    /// smonta un proprietario la prende prima di fermare e aspettare le sue
    /// letture, così fra l'attesa e il ritiro dei provider non ne entra
    /// un'altra (che girerebbe accanto al `deactivate`). Le letture già in
    /// volo non sono toccate.
    pub fn bar(&self, owner: &str) -> Barred {
        *self
            .0
            .acquire()
            .barred
            .entry(owner.to_string())
            .or_default() += 1;
        Barred {
            shared: Arc::clone(&self.0),
            owner: owner.to_string(),
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

    /// Alza la bandiera di ogni lettura in volo **e di chi la contiene**: è
    /// la chiusura del vault, e si ferma anche il job che leggeva. Il loro
    /// host smette di servirle alla prossima chiamata, e l'esito torna
    /// `Cancelled`.
    pub fn cancel_all(&self) {
        for entry in self.0.acquire().live.values() {
            entry.cancel.store(true, Ordering::Relaxed);
            for outer in &entry.outer {
                outer.store(true, Ordering::Relaxed);
            }
        }
    }

    /// Alza la bandiera delle sole letture di `owner`, prima di smontarne i
    /// provider. Chi le contiene non è fermato: il job che ha invocato la
    /// lettura riceve un `Cancelled` come da un comando che fallisce.
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

/// La sbarra di [`ReadsInFlight::bar`]: cade con la guardia.
#[must_use = "la sbarra vale finché la guardia vive"]
pub struct Barred {
    shared: Arc<Condition<State>>,
    owner: String,
}

impl Drop for Barred {
    fn drop(&mut self) {
        self.shared.change(|state| {
            if let Some(count) = state.barred.get_mut(&self.owner) {
                *count -= 1;
                if *count == 0 {
                    state.barred.remove(&self.owner);
                }
            }
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
        let job = Arc::new(AtomicBool::new(false));
        let guard = reads
            .enter("a", Arc::clone(&cancel), vec![Arc::clone(&job)])
            .expect("nothing bars `a`");
        reads.cancel_owner("a");
        assert!(cancel.load(Ordering::Relaxed));
        assert!(
            !job.load(Ordering::Relaxed),
            "an unmount does not stop the job"
        );
        cancel.store(false, Ordering::Relaxed);
        assert!(reads.busy("a"));
        assert!(!reads.busy("b"));
        reads.cancel_all();
        assert!(cancel.load(Ordering::Relaxed));
        assert!(job.load(Ordering::Relaxed), "the close stops the job too");
        std::thread::scope(|s| {
            let waiter = s.spawn(|| reads.wait_idle());
            drop(guard);
            waiter.join().expect("the waiter wakes");
        });
        assert!(!reads.busy("a"));
        assert_eq!(reads.count(), 0);
    }

    #[test]
    fn a_bar_lasts_as_long_as_its_guards() {
        let reads = ReadsInFlight::default();
        let enters = |owner: &str| {
            let cancel = Arc::new(AtomicBool::new(false));
            reads.enter(owner, cancel, Vec::new()).is_some()
        };
        let first = reads.bar("a");
        let second = reads.bar("a");
        assert!(!enters("a"));
        assert!(enters("b"));
        drop(first);
        assert!(!enters("a"), "one guard is still alive");
        drop(second);
        assert!(enters("a"));
    }
}
