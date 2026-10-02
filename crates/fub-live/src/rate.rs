//! La finestra dei messaggi al secondo.
//!
//! Una finestra scorrevole esatta: al più `limit` messaggi in ogni intervallo
//! di un secondo, non in ogni secondo del calendario, dove 240 messaggi alla
//! fine di un secondo e 240 all'inizio del successivo passerebbero entrambi.

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
}
