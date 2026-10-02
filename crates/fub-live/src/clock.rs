//! Lo scarto fra l'orologio dello scrittore e quello del PC («Orologi» in
//! `docs/reference/live-session.md`).
//!
//! Il metodo è quello del prototipo: fra i campioni recenti vale quello con il
//! ritardo di andata e ritorno minimo, perché è quello in cui la rete ha
//! aggiunto meno rumore. Lo scarto è ciò che si somma all'orologio dello
//! scrittore per ottenere quello del PC.
//!
//! Il client misura il giro intero (`ping` e `pong`). L'host vede solo
//! l'andata: `b − a` è lo scarto più il ritardo di andata, e il ritardo lo
//! stima con la metà del giro più breve dei propri heartbeat.

use std::collections::VecDeque;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// I campioni che una stima ricorda: abbastanza per scavalcare un picco di
/// rete, pochi abbastanza da seguire un orologio che deriva.
const SAMPLES: usize = 32;

/// Una stima dello scarto.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockEstimate {
    /// Millisecondi da sommare all'orologio dello scrittore per avere quello
    /// del PC.
    pub offset_ms: f64,
    /// Il giro più breve fra i campioni recenti, in millisecondi; `None` finché
    /// l'host non ne ha misurato uno.
    pub rtt_ms: Option<f64>,
}

/// L'orologio del PC che viaggia in `pong.b`: millisecondi dall'epoca Unix,
/// con i decimali. È l'orologio di `fub:at`, e la shell lo confronta con il
/// proprio `Date.now()`.
pub(crate) fn wall_clock_ms() -> f64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => elapsed.as_secs_f64() * 1000.0,
        Err(_) => 0.0,
    }
}

/// La stima del client: ogni campione è un giro completo.
#[derive(Debug, Default)]
pub(crate) struct ClientClock {
    samples: VecDeque<(f64, f64)>,
}

impl ClientClock {
    /// Un `pong`: `a` mandato, `b` del PC, `now` all'arrivo sull'orologio dello
    /// scrittore.
    pub(crate) fn sample(&mut self, a: f64, b: f64, now: f64) -> Option<ClockEstimate> {
        let rtt = now - a;
        if !(rtt.is_finite() && rtt >= 0.0 && b.is_finite()) {
            return self.estimate();
        }
        if self.samples.len() == SAMPLES {
            self.samples.pop_front();
        }
        self.samples.push_back((rtt, b - (a + rtt / 2.0)));
        self.estimate()
    }

    pub(crate) fn estimate(&self) -> Option<ClockEstimate> {
        self.samples
            .iter()
            .min_by(|x, y| x.0.total_cmp(&y.0))
            .map(|(rtt, offset)| ClockEstimate {
                offset_ms: *offset,
                rtt_ms: Some(*rtt),
            })
    }
}

/// La stima dell'host: le andate dei `ping` e i giri degli heartbeat.
#[derive(Debug, Default)]
pub(crate) struct HostClock {
    one_way: VecDeque<f64>,
    rtts: VecDeque<Duration>,
}

impl HostClock {
    /// Un `ping` con l'orologio `a` dello scrittore, arrivato quando il PC
    /// segnava `b`.
    pub(crate) fn ping(&mut self, a: f64, b: f64) -> Option<ClockEstimate> {
        let difference = b - a;
        if difference.is_finite() {
            if self.one_way.len() == SAMPLES {
                self.one_way.pop_front();
            }
            self.one_way.push_back(difference);
        }
        self.estimate()
    }

    /// Il giro di un heartbeat.
    pub(crate) fn heartbeat(&mut self, rtt: Duration) {
        if self.rtts.len() == SAMPLES {
            self.rtts.pop_front();
        }
        self.rtts.push_back(rtt);
    }

    pub(crate) fn estimate(&self) -> Option<ClockEstimate> {
        let fastest = self.one_way.iter().copied().min_by(f64::total_cmp)?;
        let rtt = self.rtts.iter().min().map(|rtt| rtt.as_secs_f64() * 1000.0);
        Some(ClockEstimate {
            offset_ms: fastest - rtt.unwrap_or(0.0) / 2.0,
            rtt_ms: rtt,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_client_keeps_the_sample_with_the_shortest_round_trip() {
        // Il PC è 1000 ms avanti; l'andata e il ritorno costano 5 ms ciascuno,
        // salvo un campione con 40 ms di coda all'andata.
        let mut clock = ClientClock::default();
        let slow = clock
            .sample(100.0, 100.0 + 1000.0 + 40.0, 100.0 + 45.0)
            .unwrap();
        assert!((slow.offset_ms - 1017.5).abs() < 1e-9);
        let fast = clock
            .sample(200.0, 200.0 + 1000.0 + 5.0, 200.0 + 10.0)
            .unwrap();
        assert!((fast.offset_ms - 1000.0).abs() < 1e-9);
        assert_eq!(fast.rtt_ms, Some(10.0));
        // Un campione con il giro negativo (orologio tornato indietro) non conta.
        assert_eq!(clock.sample(300.0, 1300.0, 290.0), Some(fast));
    }

    #[test]
    fn the_host_subtracts_half_of_its_shortest_heartbeat() {
        let mut clock = HostClock::default();
        assert_eq!(clock.estimate(), None);
        let first = clock.ping(100.0, 1105.0).unwrap();
        assert_eq!(
            first,
            ClockEstimate {
                offset_ms: 1005.0,
                rtt_ms: None
            }
        );
        clock.heartbeat(Duration::from_millis(30));
        clock.heartbeat(Duration::from_millis(10));
        let estimate = clock.ping(200.0, 1220.0).unwrap();
        assert_eq!(
            estimate,
            ClockEstimate {
                offset_ms: 1000.0,
                rtt_ms: Some(10.0)
            }
        );
    }

    #[test]
    fn old_samples_leave_the_window() {
        let mut clock = ClientClock::default();
        clock.sample(0.0, 1001.0, 2.0);
        for i in 1..=SAMPLES {
            let a = i as f64 * 1000.0;
            clock.sample(a, a + 2005.0, a + 10.0);
        }
        // Il campione veloce del primo istante è uscito: resta lo scarto nuovo.
        assert!((clock.estimate().unwrap().offset_ms - 2000.0).abs() < 1e-9);
    }
}
