//! Lo stabilizzatore del tratto: leviga i campioni del puntatore prima che
//! diventino inchiostro, per chi ha la mano che trema o scrive col mouse.
//!
//! Due modi:
//!
//! - **la corda** (`pulled_string`, il «lazy mouse»): il pennino è legato al
//!   puntatore da una corda lunga `amount × 100` pixel dello schermo e si muove
//!   solo quando la corda è tesa, dalla parte del puntatore. Un tremito più
//!   corto della corda non muove niente;
//! - **la media** (esponenziale): a ogni 16 ms di tempo del tratto il pennino
//!   percorre una frazione della strada verso il puntatore. Conta il tempo e
//!   non il numero di eventi: lo stesso gesto dà lo stesso tratto con un mouse
//!   a 1000 Hz e con uno a 60 Hz. Con `catch_up` il pennino continua ad
//!   avvicinarsi anche se il puntatore si ferma, senza si ferma con lui.
//!
//! Con `catch_up_on_end` il tratto finisce dov'è finito il puntatore, non dove
//! era rimasto indietro il pennino.
//!
//! # Provenienza
//!
//! Derivato da codice di PhotoCraft, Copyright (c) 2026 ArtCraft Team and the
//! PhotoCraft contributors, sotto licenza MIT: il testo è in
//! `THIRD_PARTY_NOTICES.md`, alla radice.
//!
//! Le regole e i numeri (corda di 100 px al massimo, passo di 16 ms, tetto di
//! 64 passi per evento, `0,95` come media più lenta) sono quelli originali, e i
//! test originali sono portati qui. Cambia l'involucro:
//!
//! - il punto è un [`Sample`], non uno `StrokePoint`: niente pennello,
//!   inclinazione a due assi, ruota del mouse;
//! - la corda è in unità della scena e si divide per la scala della vista
//!   (`adjust_for_zoom` dell'originale qui è sempre acceso: i campioni sono
//!   già in unità della scena);
//! - `enabled` non c'è: con `amount` a 0 lo stabilizzatore è spento;
//! - non c'è `lagging` né `string`, che servono a chi disegna la corda sullo
//!   schermo e a chi tiene il tempo scorrere con il puntatore fermo: nessun
//!   prodotto di Fub li usa ancora;
//! - edizione 2021, senza `let` concatenati.

use crate::sample::Sample;

/// La lunghezza massima della corda con `amount` a 1, in pixel dello schermo.
pub const MAX_STRING_PX: f64 = 100.0;

/// Il tempo del tratto in cui la media percorre la sua frazione di strada,
/// in millisecondi.
pub const SMOOTHING_STEP_MS: f64 = 16.0;

/// Quanti passi al più per un evento: un evento dopo una lunga pausa non
/// produce una raffica di campioni.
const MAX_STEPS: f64 = 64.0;

/// La media più lenta: con `amount` a 1 il pennino fa comunque il 5 % della
/// strada a ogni passo.
const SLOWEST: f64 = 0.95;

/// Come si stabilizza un tratto.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct StabilizerConfig {
    /// Da 0 (spento) a 1 (il massimo).
    pub amount: f64,
    /// La corda invece della media.
    pub pulled_string: bool,
    /// Con la media, il pennino continua ad avvicinarsi al puntatore fermo.
    pub catch_up: bool,
    /// Il tratto finisce dove è finito il puntatore.
    pub catch_up_on_end: bool,
}

impl Default for StabilizerConfig {
    fn default() -> StabilizerConfig {
        StabilizerConfig {
            amount: 0.0,
            pulled_string: false,
            catch_up: true,
            catch_up_on_end: true,
        }
    }
}

impl StabilizerConfig {
    /// Vero se la configurazione cambia i campioni.
    pub fn is_active(&self) -> bool {
        self.amount.is_finite() && self.amount > 0.0
    }
}

/// Lo stabilizzatore di un tratto: si alimenta un campione alla volta e
/// restituisce i campioni del pennino.
#[derive(Clone, Debug)]
pub struct Stabilizer {
    config: StabilizerConfig,
    zoom: f64,
    pos: Option<Sample>,
    last_input: Option<Sample>,
}

impl Stabilizer {
    /// `zoom` sono i pixel dello schermo per unità della scena; un valore non
    /// finito o più piccolo di 0,01 vale 0,01.
    pub fn new(config: StabilizerConfig, zoom: f64) -> Stabilizer {
        let zoom = if zoom.is_finite() {
            zoom.max(0.01)
        } else {
            1.0
        };
        Stabilizer {
            config,
            zoom,
            pos: None,
            last_input: None,
        }
    }

    /// Vero se lo stabilizzatore cambia i campioni.
    pub fn is_active(&self) -> bool {
        self.config.is_active()
    }

    /// Alimenta un campione del puntatore: i campioni del pennino per lui,
    /// nessuno se il pennino non si muove, più d'uno se recupera.
    pub fn push(&mut self, p: Sample, out: &mut Vec<Sample>) {
        let prev_input = self.last_input.replace(p);
        if !self.is_active() {
            out.push(p);
            return;
        }
        let pos = match self.pos {
            Some(pos) => pos,
            None => {
                self.pos = Some(p);
                out.push(p);
                return;
            }
        };
        let amount = self.config.amount.clamp(0.0, 1.0);
        if self.config.pulled_string {
            let len = amount * MAX_STRING_PX / self.zoom;
            let (dx, dy) = (p.x - pos.x, p.y - pos.y);
            let d = (dx * dx + dy * dy).sqrt();
            if d > len {
                let k = (d - len) / d;
                let next = Sample {
                    x: pos.x + dx * k,
                    y: pos.y + dy * k,
                    ..p
                };
                self.pos = Some(next);
                out.push(next);
            }
            return;
        }
        // La media: a ogni passo di tempo il pennino fa la frazione `a` della
        // strada verso il puntatore, così la sensazione non dipende da quanto
        // spesso il dispositivo riporta. Senza tempi, un passo per campione.
        let a = 1.0 - amount.min(SLOWEST);
        let dt = prev_input.map_or(0.0, |q| p.t - q.t);
        let still = prev_input.is_some_and(|q| q.x == p.x && q.y == p.y);
        if still && !self.config.catch_up {
            // Senza recupero il pennino si ferma mentre il puntatore è fermo.
            return;
        }
        let (iters, step) = if dt > 0.0 && dt.is_finite() {
            let steps = dt / SMOOTHING_STEP_MS;
            let iters = steps.ceil().clamp(1.0, MAX_STEPS);
            // Ciascuna delle `iters` mosse copre `steps / iters` passi.
            (
                iters as usize,
                1.0 - (1.0 - a).powf(steps.min(MAX_STEPS) / iters),
            )
        } else {
            (1, a)
        };
        let mut cur = pos;
        for _ in 0..iters {
            cur = Sample {
                x: cur.x + (p.x - cur.x) * step,
                y: cur.y + (p.y - cur.y) * step,
                ..p
            };
            out.push(cur);
        }
        self.pos = Some(cur);
    }

    /// La fine del tratto: con `catch_up_on_end` il pennino finisce dov'è
    /// l'ultimo campione del puntatore.
    pub fn finish(&mut self, out: &mut Vec<Sample>) {
        if !self.is_active() || !self.config.catch_up_on_end {
            return;
        }
        if let (Some(pos), Some(last)) = (self.pos, self.last_input) {
            if pos.x != last.x || pos.y != last.y {
                self.pos = Some(last);
                out.push(last);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(x: f64, y: f64, t: f64) -> Sample {
        Sample {
            x,
            y,
            p: Some(1.0),
            t,
            tilt: None,
        }
    }

    fn smooth(config: StabilizerConfig, zoom: f64, points: &[Sample]) -> Vec<Sample> {
        let mut stabilizer = Stabilizer::new(config, zoom);
        let mut out = Vec::new();
        for p in points {
            stabilizer.push(*p, &mut out);
        }
        stabilizer.finish(&mut out);
        out
    }

    fn config(amount: f64) -> StabilizerConfig {
        StabilizerConfig {
            amount,
            ..StabilizerConfig::default()
        }
    }

    /// Dai test dell'originale: la corda, la scala della vista, il recupero.
    #[test]
    fn la_corda_il_zoom_e_il_recupero() {
        // Un tremito più corto della corda non muove niente; il pennino resta
        // indietro della corda.
        let string = StabilizerConfig {
            amount: 0.2,
            pulled_string: true,
            catch_up_on_end: false,
            ..StabilizerConfig::default()
        };
        let jitter: Vec<Sample> = (0..20)
            .map(|i| point(if i % 2 == 0 { 0.0 } else { 5.0 }, 0.0, 0.0))
            .collect();
        assert_eq!(
            smooth(string, 1.0, &jitter).len(),
            1,
            "dentro la corda di 20 px: nessun moto"
        );
        let far = [point(0.0, 0.0, 0.0), point(100.0, 0.0, 0.0)];
        let out = smooth(string, 1.0, &far);
        assert!((out.last().unwrap().x - 80.0).abs() < 1e-4);
        // Al 200 % di zoom la corda è lunga la metà, in unità della scena.
        let out = smooth(string, 2.0, &far);
        assert!((out.last().unwrap().x - 90.0).abs() < 1e-4);

        // Il recupero: una pausa (con i tempi) fa convergere il pennino.
        let a = point(0.0, 0.0, 0.0);
        let b = point(100.0, 0.0, 16.0);
        let c = point(100.0, 0.0, 500.0);
        let catching = StabilizerConfig {
            amount: 0.8,
            catch_up: true,
            catch_up_on_end: false,
            ..StabilizerConfig::default()
        };
        let out = smooth(catching, 1.0, &[a, b, c]);
        assert!(out.last().unwrap().x > 99.0, "{}", out.last().unwrap().x);
        let waiting = StabilizerConfig {
            catch_up: false,
            ..catching
        };
        let out = smooth(waiting, 1.0, &[a, b, c]);
        assert!(out.last().unwrap().x < 70.0, "{}", out.last().unwrap().x);
    }

    #[test]
    fn spento_lascia_i_campioni_come_sono() {
        let points = [
            point(10.0, 20.0, 0.0),
            point(30.0, 8.0, 10.0),
            point(50.0, 20.0, 20.0),
        ];
        for pulled_string in [false, true] {
            let off = StabilizerConfig {
                amount: 0.0,
                pulled_string,
                ..StabilizerConfig::default()
            };
            assert!(!off.is_active());
            assert_eq!(smooth(off, 1.0, &points), points);
        }
    }

    #[test]
    fn la_media_va_per_il_tempo_e_non_per_la_frequenza_del_dispositivo() {
        // Il puntatore salta di 100 e resta lì per 32 ms, riportato a 1000 Hz
        // o a circa 60 Hz.
        let catching = StabilizerConfig {
            amount: 0.8,
            catch_up: true,
            catch_up_on_end: false,
            ..StabilizerConfig::default()
        };
        let run = |interval: f64| {
            let mut stabilizer = Stabilizer::new(catching, 1.0);
            let mut out = Vec::new();
            stabilizer.push(point(0.0, 0.0, 0.0), &mut out);
            let mut t = 0.0;
            while t < 32.0 {
                t += interval;
                stabilizer.push(point(100.0, 0.0, t), &mut out);
            }
            out.last().map_or(0.0, |p| p.x)
        };
        let (fast, slow) = (run(1.0), run(16.0));
        // Due passi di 16 ms con una frazione 0,2: 1 − 0,8² = il 36 %.
        assert!((slow - 36.0).abs() < 1e-4, "{slow}");
        assert!(
            (fast - slow).abs() < 1e-4,
            "1000 Hz {fast} contro 60 Hz {slow}"
        );
        // Senza tempi, un passo per campione.
        let mut stabilizer = Stabilizer::new(catching, 1.0);
        let mut out = Vec::new();
        for x in [0.0, 100.0] {
            stabilizer.push(point(x, 0.0, 0.0), &mut out);
        }
        assert!((out.last().map_or(0.0, |p| p.x) - 20.0).abs() < 1e-4);
    }

    #[test]
    fn senza_recupero_il_pennino_si_ferma_col_puntatore() {
        let waiting = StabilizerConfig {
            amount: 0.8,
            catch_up: false,
            catch_up_on_end: false,
            ..StabilizerConfig::default()
        };
        let mut stabilizer = Stabilizer::new(waiting, 1.0);
        let mut out = Vec::new();
        stabilizer.push(point(0.0, 0.0, 0.0), &mut out);
        stabilizer.push(point(100.0, 0.0, 16.0), &mut out);
        let n = out.len();
        for t in [32.0, 48.0, 64.0] {
            stabilizer.push(point(100.0, 0.0, t), &mut out);
        }
        assert_eq!(out.len(), n, "puntatore fermo: il pennino non si muove");
    }

    #[test]
    fn alla_fine_il_tratto_arriva_dove_e_il_puntatore() {
        let ending = StabilizerConfig {
            amount: 0.8,
            pulled_string: true,
            catch_up_on_end: true,
            ..StabilizerConfig::default()
        };
        let out = smooth(
            ending,
            1.0,
            &[point(0.0, 0.0, 0.0), point(100.0, 0.0, 10.0)],
        );
        let last = out.last().unwrap();
        assert_eq!((last.x, last.y), (100.0, 0.0));
        let stopped = StabilizerConfig {
            catch_up_on_end: false,
            ..ending
        };
        let out = smooth(
            stopped,
            1.0,
            &[point(0.0, 0.0, 0.0), point(100.0, 0.0, 10.0)],
        );
        assert!(out.last().unwrap().x < 100.0);
    }

    #[test]
    fn un_evento_dopo_una_lunga_pausa_non_fa_una_raffica() {
        let catching = StabilizerConfig {
            amount: 0.5,
            ..StabilizerConfig::default()
        };
        let mut stabilizer = Stabilizer::new(catching, 1.0);
        let mut out = Vec::new();
        stabilizer.push(point(0.0, 0.0, 0.0), &mut out);
        stabilizer.push(point(50.0, 0.0, 3_600_000.0), &mut out);
        assert!(out.len() <= 65, "{}", out.len());
    }

    #[test]
    fn il_pennino_porta_la_pressione_e_il_tempo_del_puntatore() {
        let mut stabilizer = Stabilizer::new(config(0.5), 1.0);
        let mut out = Vec::new();
        stabilizer.push(point(0.0, 0.0, 0.0), &mut out);
        let pressed = Sample {
            p: Some(0.25),
            tilt: Some((40.0, 10.0)),
            ..point(10.0, 0.0, 16.0)
        };
        stabilizer.push(pressed, &mut out);
        let last = out.last().unwrap();
        assert_eq!(
            (last.p, last.tilt, last.t),
            (Some(0.25), Some((40.0, 10.0)), 16.0)
        );
    }

    #[test]
    fn uno_zoom_che_non_si_puo_usare_vale_uno() {
        for zoom in [f64::NAN, f64::INFINITY] {
            let string = StabilizerConfig {
                amount: 0.2,
                pulled_string: true,
                catch_up_on_end: false,
                ..StabilizerConfig::default()
            };
            let out = smooth(
                string,
                zoom,
                &[point(0.0, 0.0, 0.0), point(100.0, 0.0, 0.0)],
            );
            assert!(out.last().unwrap().x.is_finite(), "{zoom}");
        }
    }
}
