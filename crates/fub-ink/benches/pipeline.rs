//! Quanto costa il percorso caldo del tratto, evento per evento.
//!
//! Misura il riduttore (`Session`) con tre flussi tipici — il mouse, una penna
//! a 240 Hz con eventi coalescenti e predetti, e la stessa penna con lo
//! stabilizzatore a media — e lo stabilizzatore da solo. Stampa nanosecondi per
//! evento: serve a vedere una regressione di ordine di grandezza, non a
//! decidere un decimale. Si lancia con `cargo bench -p fub-ink`.
//!
//! Il budget è quello dell'input: a 240 Hz un evento ne ha 4 166 667 ns, e
//! l'anteprima ne vuole la parte maggiore. Il nucleo deve restare in poche
//! migliaia di nanosecondi per evento.

use std::hint::black_box;
use std::time::Instant;

use fub_ink::{
    PointerKind, PointerSample, Sample, Session, SessionConfig, Stabilizer, StabilizerConfig,
};

const EVENTS: usize = 200_000;

/// Il campione in `at`, misurato in eventi (frazionario per i coalescenti).
fn sample(kind: PointerKind, at: f64) -> PointerSample {
    let t = at * 4.0;
    let phase = at * 0.01;
    PointerSample {
        pressure: if kind == PointerKind::Pen {
            0.2 + 0.6 * (phase.sin() * 0.5 + 0.5)
        } else {
            0.5
        },
        ..PointerSample::new(
            1,
            kind,
            400.0 + 300.0 * phase.cos(),
            300.0 + 200.0 * phase.sin(),
            t,
        )
    }
}

/// Un tratto di `events` eventi; restituisce il numero di effetti, perché il
/// compilatore non possa buttare il lavoro.
fn stroke(config: SessionConfig, kind: PointerKind, coalesced: usize, predicted: usize) -> usize {
    let mut session = Session::new(config).expect("configurazione valida");
    let mut effects = session.pointer_down(&sample(kind, 0.0)).len();
    for i in 1..EVENTS {
        let now = i as f64;
        // I coalescenti stanno fra l'evento prima e questo.
        let before: Vec<PointerSample> = (1..=coalesced)
            .map(|k| sample(kind, now - 1.0 + k as f64 / (coalesced + 1) as f64))
            .collect();
        let ahead: Vec<PointerSample> = (1..=predicted)
            .map(|k| sample(kind, now + k as f64))
            .collect();
        effects += session
            .pointer_move(&before, &sample(kind, now), &ahead)
            .len();
    }
    effects += session.pointer_up(&sample(kind, EVENTS as f64)).len();
    effects
}

fn report(name: &str, events: usize, run: impl FnOnce() -> usize) {
    let start = Instant::now();
    let effects = black_box(run());
    let elapsed = start.elapsed();
    println!(
        "{name:<42} {:>8.0} ns/evento   ({effects} effetti, {:.1} ms)",
        elapsed.as_nanos() as f64 / events as f64,
        elapsed.as_secs_f64() * 1000.0
    );
}

fn main() {
    println!("fub-ink — percorso caldo, {EVENTS} eventi per flusso");
    let plain = SessionConfig::default();
    report("mouse, senza coalescenti", EVENTS, || {
        stroke(plain, PointerKind::Mouse, 0, 0)
    });
    report("penna 240 Hz, 4 coalescenti, 3 predetti", EVENTS, || {
        stroke(plain, PointerKind::Pen, 4, 3)
    });
    let smooth = SessionConfig {
        stabilizer: StabilizerConfig {
            amount: 0.6,
            ..StabilizerConfig::default()
        },
        ..plain
    };
    report("penna con stabilizzatore a media", EVENTS, || {
        stroke(smooth, PointerKind::Pen, 4, 3)
    });
    let string = SessionConfig {
        stabilizer: StabilizerConfig {
            amount: 0.3,
            pulled_string: true,
            ..StabilizerConfig::default()
        },
        ..plain
    };
    report("mouse con stabilizzatore a corda", EVENTS, || {
        stroke(string, PointerKind::Mouse, 0, 0)
    });
    report("stabilizzatore da solo (media)", EVENTS, || {
        let mut stabilizer = Stabilizer::new(smooth.stabilizer, 1.0);
        let mut out: Vec<Sample> = Vec::new();
        let mut produced = 0;
        for i in 0..EVENTS {
            let p = sample(PointerKind::Pen, i as f64);
            out.clear();
            stabilizer.push(
                Sample {
                    x: p.x,
                    y: p.y,
                    p: Some(p.pressure),
                    t: p.time,
                    tilt: None,
                },
                &mut out,
            );
            produced += out.len();
        }
        produced
    });
}
