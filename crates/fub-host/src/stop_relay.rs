//! Una bandiera di annullamento sola per chi ne ha più d'una.
//!
//! Il filo ([`HostNetwork`](fub_abi::traits::HostNetwork)) guarda **una**
//! bandiera a ogni pezzo letto. Chi chiama a volte ne ha di più — il job, le
//! letture che lo contengono, la bandiera del chiamante — o un tempo limite
//! suo (le tessere delle mappe). [`StopRelay`] dà al filo una bandiera che si
//! alza appena si alza una di quelle, o alla scadenza.
//!
//! # Perché un filo di guardia, e non una lista di bandiere fino al filo
//!
//! Una lista che il lettore guarda a ogni pezzo toglierebbe il filo di guardia,
//! ma cambierebbe la firma di `HostNetwork` in `fub-abi`, che è il contratto dei
//! plugin, e ogni suo implementatore: un prezzo da contratto per un dettaglio
//! dell'host. Il filo di guardia resta dentro `fub-host` e costa poco dove
//! serve: nasce solo quando c'è davvero più di una cosa da guardare (una
//! bandiera sola passa così com'è, senza filo), dura quanto il lavoro, e chi
//! lavora lo sveglia quando torna.
//!
//! Le bandiere sono `AtomicBool`: chi le alza non sveglia nessuno, quindi il
//! filo le rilegge ogni [`POLL`]. Una scadenza sola invece non ha niente da
//! rileggere, e il filo dorme fino alla scadenza o al ritorno del lavoro.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use fub_abi::text::Text;
use fub_abi::PluginError;

/// Ogni quanto il filo di guardia rilegge le bandiere: sotto la finestra con
/// cui il filo di rete guarda la sua (50 ms in `net.rs`), così l'annullamento
/// non arriva sensibilmente più tardi.
const POLL: Duration = Duration::from_millis(10);

/// La bandiera di chi non ha un annullamento suo: nessuno la alza, e
/// [`StopRelay`] non la guarda.
///
/// Sta qui, privata del crate, perché nessuno fuori da `fub-host` la possa
/// alzare: una bandiera locale `AtomicBool::new(false)` farebbe lo stesso
/// lavoro, ma il relè non potrebbe sapere che nessuno la alzerà, e aprirebbe un
/// filo di guardia per niente.
static NO_STOP: AtomicBool = AtomicBool::new(false);

/// Vedi [`NO_STOP`].
pub(crate) fn no_stop() -> &'static AtomicBool {
    &NO_STOP
}

/// Il sistema non ha dato il filo di guardia: il lavoro non è partito.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RelayUnavailable;

/// Per chi lo dice all'utente: è un guasto della macchina, non della rete né
/// di chi chiama, e riprovare è la risposta.
impl From<RelayUnavailable> for PluginError {
    fn from(_: RelayUnavailable) -> Self {
        PluginError::Io(Text::key("host.net.relay_unavailable"))
    }
}

/// Le bandiere da guardare e la scadenza, se c'è.
pub(crate) struct StopRelay<'a> {
    stops: Vec<&'a AtomicBool>,
    deadline: Option<Duration>,
}

impl<'a> StopRelay<'a> {
    /// Guarda `stops`. La stessa bandiera nominata due volte si guarda una, e
    /// [`no_stop`] non si guarda.
    pub(crate) fn watching(stops: impl IntoIterator<Item = &'a AtomicBool>) -> Self {
        let mut unique: Vec<&AtomicBool> = Vec::new();
        for stop in stops {
            if !std::ptr::eq(stop, &NO_STOP) && !unique.iter().any(|seen| std::ptr::eq(*seen, stop))
            {
                unique.push(stop);
            }
        }
        StopRelay {
            stops: unique,
            deadline: None,
        }
    }

    /// Alza la bandiera anche dopo `limit`, contato da quando parte il lavoro.
    pub(crate) fn until(mut self, limit: Duration) -> Self {
        self.deadline = Some(limit);
        self
    }

    /// `true` se una delle bandiere è già alzata: chi chiama lo guarda prima
    /// di partire, così un lavoro già annullato non tocca il filo.
    pub(crate) fn raised(&self) -> bool {
        self.stops.iter().any(|stop| stop.load(Ordering::Relaxed))
    }

    /// Esegue `work` con la bandiera che si alza appena se ne alza una di
    /// quelle guardate, o alla scadenza.
    ///
    /// Senza scadenza e con una bandiera sola, `work` riceve quella, senza filo
    /// di guardia. Se il sistema non dà il filo, `work` non parte e torna
    /// [`RelayUnavailable`]: partire senza guardia vorrebbe dire un lavoro che
    /// l'annullamento o la scadenza non fermano.
    pub(crate) fn run<T>(self, work: impl FnOnce(&AtomicBool) -> T) -> Result<T, RelayUnavailable> {
        self.run_on(std::thread::Builder::new(), work)
    }

    fn run_on<T>(
        self,
        builder: std::thread::Builder,
        work: impl FnOnce(&AtomicBool) -> T,
    ) -> Result<T, RelayUnavailable> {
        match (self.deadline, self.stops.as_slice()) {
            (None, []) => return Ok(work(&AtomicBool::new(false))),
            (None, [only]) => return Ok(work(only)),
            _ => {}
        }
        let combined = AtomicBool::new(self.raised());
        let done = AtomicBool::new(false);
        let until = self.deadline.map(|limit| Instant::now() + limit);
        std::thread::scope(|scope| {
            let guard = builder
                .name("fub-stop-relay".into())
                .spawn_scoped(scope, || loop {
                    if done.load(Ordering::Acquire) {
                        return;
                    }
                    let now = Instant::now();
                    if self.raised() || until.is_some_and(|until| now >= until) {
                        combined.store(true, Ordering::Relaxed);
                        return;
                    }
                    let to_deadline = until.map(|until| until - now);
                    let wait = match (self.stops.is_empty(), to_deadline) {
                        (true, Some(left)) => left,
                        (_, Some(left)) => left.min(POLL),
                        (_, None) => POLL,
                    };
                    std::thread::park_timeout(wait);
                })
                .map_err(|_| RelayUnavailable)?;
            let result = work(&combined);
            done.store(true, Ordering::Release);
            guard.thread().unpark();
            Ok(result)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// Una bandiera sola passa così com'è: nessun filo, e il lavoro riceve
    /// proprio quella.
    #[test]
    fn one_flag_reaches_the_work_as_it_is() {
        let flag = AtomicBool::new(false);
        let same = StopRelay::watching([&flag, &flag])
            .run_on(unspawnable(), |seen| std::ptr::eq(seen, &flag))
            .expect("no relay thread needed");
        assert!(same, "the flag itself, without a relay");
    }

    /// La bandiera di chi non ne ha una non si guarda: con quella di un job
    /// soltanto, il lavoro riceve la bandiera del job, senza filo.
    #[test]
    fn the_no_stop_flag_is_not_watched() {
        let job = AtomicBool::new(false);
        let same = StopRelay::watching([no_stop(), &job])
            .run_on(unspawnable(), |seen| std::ptr::eq(seen, &job))
            .expect("no relay thread needed");
        assert!(same);
    }

    /// Una bandiera qualsiasi fra quelle guardate alza quella del lavoro.
    #[test]
    fn any_watched_flag_stops_the_work() {
        for raise in 0..2 {
            let flags = [
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicBool::new(false)),
            ];
            let raiser = {
                let flag = Arc::clone(&flags[raise]);
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(30));
                    flag.store(true, Ordering::Relaxed);
                })
            };
            let started = Instant::now();
            let stopped = StopRelay::watching(flags.iter().map(Arc::as_ref))
                .run(|combined| wait_for(combined, Duration::from_secs(5)))
                .expect("relay");
            assert!(stopped, "flag {raise}");
            assert!(started.elapsed() < Duration::from_secs(2), "flag {raise}");
            raiser.join().expect("raiser");
        }
    }

    /// Una bandiera già alzata alza subito quella del lavoro.
    #[test]
    fn a_raised_flag_is_raised_from_the_start() {
        let (down, up) = (AtomicBool::new(false), AtomicBool::new(true));
        let relay = StopRelay::watching([&down, &up]);
        assert!(relay.raised());
        let seen = relay
            .run(|combined| combined.load(Ordering::Relaxed))
            .expect("relay");
        assert!(seen);
    }

    /// La scadenza alza la bandiera; un lavoro breve non la vede alzata, e
    /// torna subito anche con una scadenza lunga.
    #[test]
    fn the_deadline_stops_the_work_and_a_quick_work_returns_at_once() {
        let started = Instant::now();
        let quick = StopRelay::watching([])
            .until(Duration::from_secs(30))
            .run(|flag| flag.load(Ordering::Relaxed))
            .expect("relay");
        assert!(!quick);
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "woken, not waited"
        );
        let slow = StopRelay::watching([])
            .until(Duration::from_millis(20))
            .run(|flag| wait_for(flag, Duration::from_secs(5)))
            .expect("relay");
        assert!(slow);
    }

    /// Se il sistema non dà il filo, il lavoro non parte e l'errore lo dice.
    #[test]
    fn without_a_relay_thread_the_work_does_not_start() {
        let flags = [AtomicBool::new(false), AtomicBool::new(false)];
        let mut ran = false;
        let outcome = StopRelay::watching(&flags).run_on(unspawnable(), |_| ran = true);
        assert_eq!(outcome, Err(RelayUnavailable));
        assert!(!ran);
        assert!(matches!(
            PluginError::from(RelayUnavailable),
            PluginError::Io(_)
        ));
    }

    /// Un filo con una pila più grande dello spazio di indirizzi: il sistema
    /// lo rifiuta.
    fn unspawnable() -> std::thread::Builder {
        std::thread::Builder::new().stack_size(1 << 60)
    }

    fn wait_for(flag: &AtomicBool, limit: Duration) -> bool {
        let started = Instant::now();
        while started.elapsed() < limit {
            if flag.load(Ordering::Relaxed) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        false
    }
}
