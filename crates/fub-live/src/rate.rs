//! I ritmi che l'host fa rispettare.
//!
//! [`RateWindow`] è la finestra dei messaggi al secondo: una finestra
//! scorrevole esatta, al più `limit` messaggi in ogni intervallo di un
//! secondo, non in ogni secondo del calendario, dove 240 messaggi alla fine di
//! un secondo e 240 all'inizio del successivo passerebbero entrambi.
//!
//! [`BurstPace`] è il ritmo di un tipo di messaggio con una raffica ammessa:
//! `burst` messaggi di fila, poi uno ogni `pace`. È l'algoritmo GCRA, che
//! tiene un istante solo invece di uno per messaggio: una raffica grande non
//! costa memoria.

use std::collections::VecDeque;
use std::time::Duration;

use tokio::time::Instant;

pub(crate) struct RateWindow {
    stamps: VecDeque<Instant>,
    limit: usize,
    window: Duration,
}

impl RateWindow {
    pub(crate) fn new(limit: usize, window: Duration) -> RateWindow {
        RateWindow {
            stamps: VecDeque::with_capacity(limit),
            limit,
            window,
        }
    }

    fn expire(&mut self, now: Instant) {
        while let Some(front) = self.stamps.front() {
            if now.saturating_duration_since(*front) >= self.window {
                self.stamps.pop_front();
            } else {
                break;
            }
        }
    }

    /// Conta un messaggio arrivato in `now`: `false` se è oltre il limite, e
    /// allora non si conta.
    pub(crate) fn admit(&mut self, now: Instant) -> bool {
        self.expire(now);
        if self.stamps.len() >= self.limit {
            return false;
        }
        self.stamps.push_back(now);
        true
    }

    /// Quanto aspettare prima che un messaggio in più stia nel limite: è il
    /// ritmo del client, che resta sotto quello che l'host fa rispettare.
    pub(crate) fn wait(&mut self, now: Instant) -> Duration {
        self.expire(now);
        match self.stamps.front() {
            Some(front) if self.stamps.len() >= self.limit => self
                .window
                .saturating_sub(now.saturating_duration_since(*front)),
            _ => Duration::ZERO,
        }
    }
}

/// `burst` messaggi di fila, poi uno ogni `pace`.
///
/// `due` è l'istante teorico in cui il ritmo sarebbe di nuovo a riposo: ogni
/// messaggio ammesso lo sposta avanti di `pace`, e un messaggio è oltre il
/// limite quando `due` sta più di `(burst - 1) · pace` nel futuro. Chi rispetta
/// il ritmo non si avvicina mai al limite; chi è stato zitto ritrova tutta la
/// raffica.
pub(crate) struct BurstPace {
    pace: Duration,
    tolerance: Duration,
    due: Option<Instant>,
}

impl BurstPace {
    pub(crate) fn new(burst: u32, pace: Duration) -> BurstPace {
        assert!(
            burst > 0,
            "una raffica di zero messaggi non ne ammette nessuno"
        );
        BurstPace {
            pace,
            tolerance: pace * (burst - 1),
            due: None,
        }
    }

    /// Conta un messaggio arrivato in `now`: `false` se è oltre il limite, e
    /// allora non si conta.
    pub(crate) fn admit(&mut self, now: Instant) -> bool {
        let due = self.due.map_or(now, |due| due.max(now));
        if due.saturating_duration_since(now) > self.tolerance {
            return false;
        }
        self.due = Some(due + self.pace);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn the_window_slides_instead_of_resetting() {
        let mut window = RateWindow::new(240, Duration::from_secs(1));
        let start = Instant::now();
        // 240 messaggi negli ultimi 10 ms di un secondo…
        for i in 0..240 {
            assert!(
                window.admit(start + Duration::from_millis(990) + Duration::from_micros(i * 40))
            );
        }
        // …e il 241° all'inizio del secondo dopo è ancora nello stesso
        // intervallo di un secondo.
        assert!(!window.admit(start + Duration::from_millis(1010)));
        assert!(window.wait(start + Duration::from_millis(1010)) > Duration::ZERO);
        // Un secondo dopo il primo, quel posto si libera.
        assert!(window.admit(start + Duration::from_millis(1990)));
        assert_eq!(
            window.wait(start + Duration::from_millis(3000)),
            Duration::ZERO
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_steady_240_per_second_is_admitted_forever() {
        let mut window = RateWindow::new(240, Duration::from_secs(1));
        let start = Instant::now();
        let step = Duration::from_nanos(1_000_000_000u64.div_ceil(240));
        for i in 0..2400u32 {
            assert!(
                window.admit(start + step * i + Duration::from_nanos(u64::from(i % 2))),
                "{i}"
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_burst_is_admitted_whole_then_the_pace_counts() {
        let mut pace = BurstPace::new(240, Duration::from_millis(50));
        let start = Instant::now();
        for i in 0..240 {
            assert!(pace.admit(start), "{i}");
        }
        assert!(!pace.admit(start));
        // Un secondo dopo, il ritmo ne ha restituiti venti.
        let later = start + Duration::from_secs(1);
        for i in 0..20 {
            assert!(pace.admit(later), "{i}");
        }
        assert!(!pace.admit(later));
    }

    #[tokio::test(start_paused = true)]
    async fn the_pace_is_admitted_forever_and_silence_restores_the_burst() {
        let mut pace = BurstPace::new(3, Duration::from_millis(50));
        let start = Instant::now();
        // Al ritmo esatto, anche partendo dalla raffica piena, mai un rifiuto.
        for i in 0..3 {
            assert!(pace.admit(start), "{i}");
        }
        for i in 1..=1000u32 {
            assert!(pace.admit(start + Duration::from_millis(50) * i), "{i}");
        }
        // Ogni 40 ms invece di 50, ogni messaggio consuma 10 ms del margine di
        // 100: l'undicesimo dopo il primo è oltre.
        let now = start + Duration::from_secs(60);
        for k in 0..=10u32 {
            assert!(pace.admit(now + Duration::from_millis(40) * k), "{k}");
        }
        assert!(!pace.admit(now + Duration::from_millis(440)));
        // Dopo il silenzio torna tutta la raffica, e non di più.
        let quiet = now + Duration::from_secs(10);
        for i in 0..3 {
            assert!(pace.admit(quiet), "{i}");
        }
        assert!(!pace.admit(quiet));
    }
}
