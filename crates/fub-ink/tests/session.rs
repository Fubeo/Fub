//! Il ciclo di vita del tratto, una regola alla volta.
//!
//! Gli scenari sono quelli di `common` (gli stessi che `ts_mirror` scrive nella
//! fixture per la copia TypeScript); qui ciascuno dice a parole che cosa deve
//! succedere. In fondo, le invarianti che valgono per ogni scenario del
//! catalogo e le prove dei grandi numeri.

mod common;

use common::*;
use fub_ink::{
    CancelReason, ConfigError, Effect, FinishedStroke, PenCurve, PointerKind, PointerRole, Sample,
    Session, SessionConfig, StabilizerConfig, MAX_SAMPLES,
};

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

fn run_named(name: &str) -> Trace {
    run(&scenario(name))
}

fn ends(trace: &Trace) -> Vec<&FinishedStroke> {
    trace
        .all()
        .into_iter()
        .filter_map(|e| match e {
            Effect::End(done) => Some(done),
            _ => None,
        })
        .collect()
}

fn cancels(trace: &Trace) -> Vec<CancelReason> {
    trace
        .all()
        .into_iter()
        .filter_map(|e| match e {
            Effect::Cancel { reason, .. } => Some(*reason),
            _ => None,
        })
        .collect()
}

fn starts(trace: &Trace) -> usize {
    trace
        .all()
        .into_iter()
        .filter(|e| matches!(e, Effect::Start(_)))
        .count()
}

fn xs(samples: &[Sample]) -> Vec<f64> {
    samples.iter().map(|s| s.x).collect()
}

fn ts(samples: &[Sample]) -> Vec<f64> {
    samples.iter().map(|s| s.t).collect()
}

fn ps(samples: &[Sample]) -> Vec<Option<f64>> {
    samples.iter().map(|s| s.p).collect()
}

/// Il ruolo di `pointer` dopo l'evento `step` di uno scenario.
fn role(script: &Script, trace: &Trace, step: usize, pointer: i64) -> Option<PointerRole> {
    let _ = script;
    trace.roles[step]
        .iter()
        .find(|(id, _)| *id == pointer)
        .and_then(|(_, role)| *role)
}

fn assert_close(actual: &[f64], expected: &[f64]) {
    assert_eq!(
        actual.len(),
        expected.len(),
        "{actual:?} contro {expected:?}"
    );
    for (a, e) in actual.iter().zip(expected) {
        assert!(close(*a, *e), "{actual:?} contro {expected:?}");
    }
}

// --- Il tratto ---------------------------------------------------------------

#[test]
fn il_mouse_disegna_senza_pressione_e_i_coalescenti_entrano_nell_ordine() {
    let trace = run_named("mouse_stroke");
    assert_eq!(starts(&trace), 1);
    let done = &ends(&trace)[0].clone();
    assert_eq!(done.start.kind, PointerKind::Mouse);
    assert!(
        !done.start.pressure,
        "il mouse non ha il canale della pressione"
    );
    assert_eq!(xs(&done.samples), [10.0, 15.0, 20.0, 30.0, 35.0]);
    assert_eq!(ts(&done.samples), [0.0, 5.0, 10.0, 20.0, 30.0]);
    assert!(ps(&done.samples).iter().all(Option::is_none));
    assert!(!done.tilt && !done.split);
    // La piattaforma cattura il puntatore all'inizio e lo rilascia alla fine.
    let all = trace.all();
    assert_eq!(all.first(), Some(&&Effect::Capture(1)));
    assert!(matches!(all.last(), Some(Effect::End(_))));
    assert!(all.contains(&&Effect::Release(1)));
}

#[test]
fn i_campioni_arrivano_dentro_l_evento_che_li_porta() {
    let trace = run_named("mouse_stroke");
    // Down: Capture, Start, il primo campione. Move: i due nuovi, subito.
    assert!(trace.effects[0]
        .iter()
        .any(|e| matches!(e, Effect::Samples { samples, .. } if samples.len() == 1)));
    let second = &trace.effects[1];
    assert!(
        matches!(&second[..], [Effect::Samples { samples, .. }] if xs(samples) == [15.0, 20.0]),
        "{second:?}"
    );
}

#[test]
fn la_penna_porta_pressione_e_inclinazione_e_l_alzata_presta_il_campione_prima() {
    let trace = run_named("pen_pressure_and_tilt");
    let done = &ends(&trace)[0].clone();
    assert!(done.start.pressure);
    // L'alzata ha pressione 0 per specifica: il tratto non termina a zero.
    assert_eq!(
        ps(&done.samples),
        [Some(0.1), Some(0.4), Some(0.8), Some(0.8)]
    );
    assert!(done.tilt);
    assert!(done.samples.iter().all(|s| s.tilt.is_some()));
    // L'alzata ha anche l'inclinazione del campione prima.
    assert_eq!(done.samples[2].tilt, done.samples[3].tilt);
}

#[test]
fn una_penna_senza_sensore_non_scrive_l_inclinazione() {
    let trace = run_named("pen_without_a_tilt_sensor");
    let done = &ends(&trace)[0].clone();
    assert!(!done.tilt);
    assert!(done.samples.iter().all(|s| s.tilt.is_none()));
    assert!(done.samples.iter().all(|s| s.p.is_some()));
}

#[test]
fn gli_angoli_dell_evento_valgono_piu_delle_inclinazioni() {
    let trace = run_named("pen_angles_beat_tilt");
    let done = &ends(&trace)[0].clone();
    let (a, z) = done.samples[0].tilt.expect("l'inclinazione c'è");
    assert!(close(a, 45.0) && close(z, 90.0), "{a} {z}");
    let (a, z) = done.samples[1].tilt.unwrap();
    assert!(close(a, 60.0) && close(z, 180.0), "{a} {z}");
}

#[test]
fn su_un_foglio_girato_l_azimut_si_misura_dall_asse_della_scena() {
    let trace = run_named("a_turned_sheet_turns_the_azimuth");
    let done = &ends(&trace)[0].clone();
    let azimuths: Vec<f64> = done.samples.iter().map(|s| s.tilt.unwrap().1).collect();
    // tiltX 20 → 0°, tiltY 20 → 90°, tiltX −20 → 180°; meno 30°, 30°, 200°.
    assert_close(&azimuths[..3], &[330.0, 60.0, 340.0]);
    assert!(
        azimuths.iter().all(|z| (0.0..360.0).contains(z)),
        "{azimuths:?}"
    );
}

// --- La penna preme -----------------------------------------------------------

#[test]
fn una_penna_disegna_solo_quando_preme() {
    let script = scenario("pen_draws_only_when_it_presses");
    let trace = run(&script);
    // Sospesa e appoggiata senza premere: niente tratto, nemmeno l'annuncio.
    assert!(
        trace.effects[0].is_empty(),
        "sospesa: {:?}",
        trace.effects[0]
    );
    assert_eq!(trace.effects[1], [Effect::Capture(5)]);
    assert!(trace.effects[2].is_empty());
    assert_eq!(starts(&trace), 1);
    let done = &ends(&trace)[0].clone();
    // Il tratto comincia dal primo campione con pressione, non dal tocco.
    assert_eq!(done.start.time_stamp, 30.0);
    assert_eq!(xs(&done.samples), [4.0, 6.0, 7.0]);
    assert_eq!(ts(&done.samples), [0.0, 10.0, 20.0]);
    assert_eq!(ps(&done.samples), [Some(0.3), Some(0.6), Some(0.6)]);
}

#[test]
fn una_penna_che_si_alza_senza_premere_se_ne_va_in_silenzio() {
    let trace = run_named("pen_lifted_without_pressing");
    assert_eq!(starts(&trace), 0);
    assert!(ends(&trace).is_empty());
    assert!(cancels(&trace).is_empty());
    let all = trace.all();
    assert_eq!(all, [&Effect::Capture(6), &Effect::Release(6)]);
}

// --- Coalescenti e predetti -----------------------------------------------------

#[test]
fn i_doppioni_e_gli_eventi_piu_vecchi_si_scartano() {
    let trace = run_named("coalesced_events_are_all_taken");
    let done = &ends(&trace)[0].clone();
    // 1 (doppio), 9 (più vecchio) e il 5 in coda due volte non entrano due volte.
    assert_eq!(xs(&done.samples), [0.0, 1.0, 2.0, 3.0, 3.5, 5.0]);
    assert!(ts(&done.samples).windows(2).all(|w| w[0] <= w[1]));
}

#[test]
fn la_predizione_sostituisce_la_precedente_e_non_entra_mai_nel_tratto() {
    let trace = run_named("predicted_replaces_the_previous_one");
    let predicted: Vec<Vec<f64>> = trace
        .all()
        .into_iter()
        .filter_map(|e| match e {
            Effect::Predicted { samples, .. } => Some(xs(samples)),
            _ => None,
        })
        .collect();
    assert_eq!(
        predicted,
        [
            vec![6.0, 8.0],
            vec![10.0],
            // Vuota dopo piena: cancella. Vuota dopo vuota: niente.
            vec![],
            vec![16.0],
            // L'alzata cancella la predizione prima della fine.
            vec![],
        ]
    );
    let done = &ends(&trace)[0].clone();
    assert_eq!(xs(&done.samples), [0.0, 4.0, 8.0, 12.0, 13.0, 14.0, 15.0]);
    // I predetti hanno il tempo del tratto, non quello assoluto.
    let first = trace
        .all()
        .into_iter()
        .find_map(|e| match e {
            Effect::Predicted { samples, .. } if !samples.is_empty() => Some(ts(samples)),
            _ => None,
        })
        .unwrap();
    assert_eq!(first, [12.0, 16.0]);
}

#[test]
fn con_lo_stabilizzatore_la_predizione_non_si_consegna() {
    let trace = run_named("stabilizer_drops_the_prediction");
    assert!(trace
        .all()
        .iter()
        .all(|e| !matches!(e, Effect::Predicted { .. })));
}

// --- Il tratto si annulla intero -----------------------------------------------

#[test]
fn ogni_interruzione_annulla_il_tratto_intero() {
    let cases = [
        ("cancelled_by_pointercancel", CancelReason::PointerCancel),
        ("cancelled_by_lost_capture", CancelReason::LostCapture),
        ("cancelled_by_blur", CancelReason::Blur),
        ("cancelled_by_hidden", CancelReason::Hidden),
        ("cancelled_by_the_api", CancelReason::Api),
    ];
    for (name, reason) in cases {
        let trace = run_named(name);
        assert_eq!(cancels(&trace), [reason], "{name}");
        // Il tratto interrotto non scrive niente: solo il successivo ha una fine.
        let done = ends(&trace);
        assert_eq!(done.len(), 1, "{name}");
        assert_eq!(done[0].start.id, 2, "{name}");
        assert_eq!(xs(&done[0].samples), [20.0, 21.0], "{name}");
        // Dopo l'annullamento il puntatore non disegna più finché non si alza.
        assert_eq!(starts(&trace), 2, "{name}");
    }
}

#[test]
fn la_distruzione_annulla_il_tratto_e_chiude_la_sessione() {
    let trace = run_named("cancelled_by_destroy");
    assert_eq!(cancels(&trace), [CancelReason::Destroy]);
    assert!(ends(&trace).is_empty(), "dopo la distruzione nessun tratto");
    assert_eq!(starts(&trace), 1);

    let trace = run_named("a_destroyed_session_does_nothing");
    assert_eq!(cancels(&trace), [CancelReason::Destroy]);
    assert!(trace.effects[2..].iter().all(Vec::is_empty));
}

#[test]
fn il_puntatore_annullato_non_disegna_piu_fino_a_che_non_si_alza() {
    let trace = run_named("cancelled_by_lost_capture");
    // Gli eventi fra l'annullamento e l'alzata non producono niente.
    assert!(trace.effects[3].is_empty() && trace.effects[4].is_empty());
}

#[test]
fn un_pointerup_perso_annulla_il_tratto_e_ne_comincia_uno_nuovo() {
    let trace = run_named("a_lost_pointerup_cancels_the_stroke");
    assert_eq!(cancels(&trace), [CancelReason::LostCapture]);
    let done = &ends(&trace)[0].clone();
    assert_eq!(done.start.id, 2);
    assert_eq!(xs(&done.samples), [50.0, 54.0]);
    assert_eq!(ts(&done.samples), [0.0, 10.0]);
}

#[test]
fn il_tasto_principale_rilasciato_con_un_altro_premuto_chiude_il_tratto() {
    let trace = run_named("primary_button_released_ends_the_stroke");
    let done = ends(&trace);
    assert_eq!(done.len(), 1);
    assert_eq!(xs(&done[0].samples), [0.0, 4.0]);
    assert!(cancels(&trace).is_empty());
    // Il puntatore è ancora giù e non ricomincia a disegnare da solo.
    assert!(trace.effects[3].is_empty());
}

// --- Palmo, dita, dispositivi ----------------------------------------------------

#[test]
fn quando_arriva_la_penna_il_dito_che_disegnava_e_il_palmo() {
    let script = scenario("pen_arriving_turns_a_finger_into_a_palm");
    let trace = run(&script);
    // La penna sospesa annulla il tratto del dito e lo mette a ignorare.
    assert_eq!(cancels(&trace), [CancelReason::Palm]);
    assert_eq!(role(&script, &trace, 2, 20), Some(PointerRole::Ignore));
    assert!(
        trace.effects[3].is_empty(),
        "il palmo che si muove non disegna"
    );
    assert!(ends(&trace).is_empty());
    // Con la penna vicina un dito nuovo è palmo.
    assert_eq!(role(&script, &trace, 5, 22), Some(PointerRole::Ignore));
    assert!(trace.effects[5].is_empty());
    // Andata via la penna, su questa superficie se n'è vista una: il dito muove
    // la vista invece di disegnare.
    assert_eq!(role(&script, &trace, 9, 23), Some(PointerRole::Navigate));
    assert_eq!(starts(&trace), 1);
}

#[test]
fn un_secondo_dito_trasforma_il_disegno_in_navigazione() {
    let script = scenario("a_second_finger_turns_drawing_into_navigation");
    let trace = run(&script);
    assert_eq!(cancels(&trace), [CancelReason::Gesture]);
    assert_eq!(role(&script, &trace, 2, 30), Some(PointerRole::Navigate));
    assert_eq!(role(&script, &trace, 2, 31), Some(PointerRole::Navigate));
    assert!(ends(&trace).is_empty());
    assert!(trace.effects[2].contains(&Effect::Release(30)));
}

#[test]
fn la_politica_del_tocco_decide_per_un_dito_solo() {
    // `Ink`: il dito disegna anche dopo una penna.
    let trace = run_named("touch_policy_ink_draws_after_a_pen");
    assert_eq!(ends(&trace).len(), 1);
    assert_eq!(ends(&trace)[0].start.kind, PointerKind::Touch);
    // `Navigate`: il dito non disegna mai.
    let trace = run_named("touch_policy_navigate_never_draws");
    assert_eq!(starts(&trace), 0);
    // `Auto`: disegna finché non si è vista una penna; poi muove la vista.
    let script = scenario("touch_policy_auto_draws_until_a_pen_is_seen");
    let trace = run(&script);
    let done = ends(&trace);
    assert_eq!(done.len(), 2, "il dito, poi la penna");
    assert_eq!(done[0].start.kind, PointerKind::Touch);
    assert_eq!(done[1].start.kind, PointerKind::Pen);
    assert_eq!(role(&script, &trace, 5, 44), Some(PointerRole::Ignore));
    assert_eq!(role(&script, &trace, 8, 45), Some(PointerRole::Navigate));
}

#[test]
fn il_cambio_di_dispositivo_da_un_tratto_per_tipo() {
    let trace = run_named("device_change");
    let done = ends(&trace);
    let kinds: Vec<PointerKind> = done.iter().map(|d| d.start.kind).collect();
    assert_eq!(
        kinds,
        [PointerKind::Mouse, PointerKind::Pen, PointerKind::Touch]
    );
    let pressure: Vec<bool> = done.iter().map(|d| d.start.pressure).collect();
    assert_eq!(pressure, [false, true, false]);
    assert!(done[0].samples.iter().all(|s| s.p.is_none()));
    assert!(done[1].samples.iter().all(|s| s.p.is_some()));
    assert!(done[2].samples.iter().all(|s| s.p.is_none()));
    let ids: Vec<u32> = done.iter().map(|d| d.start.id).collect();
    assert_eq!(ids, [1, 2, 3]);
}

#[test]
fn un_tratto_alla_volta() {
    let script = scenario("one_stroke_at_a_time");
    let trace = run(&script);
    assert_eq!(starts(&trace), 1);
    assert_eq!(role(&script, &trace, 1, 61), Some(PointerRole::Ignore));
    assert_eq!(ends(&trace)[0].start.kind, PointerKind::Mouse);
    assert!(cancels(&trace).is_empty());
}

#[test]
fn i_tasti_decidono_il_ruolo() {
    let script = scenario("buttons_decide_the_role");
    let trace = run(&script);
    assert_eq!(starts(&trace), 0);
    assert_eq!(role(&script, &trace, 0, 70), Some(PointerRole::Ignore));
    assert_eq!(role(&script, &trace, 2, 71), Some(PointerRole::Navigate));
    assert_eq!(role(&script, &trace, 4, 72), Some(PointerRole::Ignore));
    // Nessun puntatore che non disegna viene catturato.
    assert!(!trace.all().iter().any(|e| matches!(e, Effect::Capture(_))));
}

// --- Tratti molto corti e molto lunghi ---------------------------------------------

#[test]
fn un_tocco_senza_movimento_ha_due_campioni_nello_stesso_punto() {
    let trace = run_named("a_tap_has_two_samples");
    let done = ends(&trace);
    assert_eq!(done.len(), 2);
    assert_eq!(xs(&done[0].samples), [5.0, 5.0]);
    assert_eq!(ts(&done[0].samples), [0.0, 40.0]);
    assert_eq!(xs(&done[1].samples), [9.0, 9.0]);
    assert_eq!(ps(&done[1].samples), [Some(0.6), Some(0.6)]);
    assert_eq!(ts(&done[1].samples), [0.0, 30.0]);
}

#[test]
fn con_lo_stabilizzatore_un_tocco_ha_lo_stesso_due_campioni() {
    let trace = run_named("stabilizer_tap_keeps_two_samples");
    let done = &ends(&trace)[0].clone();
    assert_eq!(done.samples.len(), 2);
    assert_eq!((done.samples[0].x, done.samples[0].y), (5.0, 5.0));
    assert_eq!((done.samples[1].x, done.samples[1].y), (5.0, 5.0));
}

#[test]
fn un_tratto_lungo_si_divide_al_limite_senza_buchi() {
    let trace = run_named("a_long_stroke_splits_at_the_limit");
    let done = ends(&trace);
    let counts: Vec<usize> = done.iter().map(|d| d.samples.len()).collect();
    assert_eq!(counts, [4, 4, 4, 2]);
    let splits: Vec<bool> = done.iter().map(|d| d.split).collect();
    assert_eq!(splits, [true, true, true, false]);
    let continued: Vec<bool> = done.iter().map(|d| d.start.continued).collect();
    assert_eq!(continued, [false, true, true, true]);
    let ids: Vec<u32> = done.iter().map(|d| d.start.id).collect();
    assert_eq!(ids, [1, 2, 3, 4]);
    for pair in done.windows(2) {
        let (last, first) = (pair[0].samples.last().unwrap(), &pair[1].samples[0]);
        // L'ultimo campione di un tratto è il primo del successivo, con t = 0.
        assert_eq!((last.x, last.y, last.p), (first.x, first.y, first.p));
        assert_eq!(first.t, 0.0);
        assert_eq!(pair[1].start.time_stamp, pair[0].start.time_stamp + last.t);
    }
    // 1 + 10 mosse + l'alzata = 11 campioni, 3 dei quali condivisi.
    let unique: usize = counts.iter().sum::<usize>() - (done.len() - 1);
    assert_eq!(unique, 11);
    // Il tempo del seguito è dalla giunzione, non dall'inizio del primo tratto.
    assert_eq!(ts(&done[1].samples), [0.0, 10.0, 20.0, 30.0]);
}

#[test]
fn l_alzata_puo_dividere_un_tratto_pieno() {
    let trace = run_named("the_lift_can_split_a_full_stroke");
    let done = ends(&trace);
    assert_eq!(done.len(), 2);
    assert!(done[0].split && !done[1].split);
    assert_eq!(xs(&done[0].samples), [0.0, 5.0, 10.0]);
    assert_eq!(xs(&done[1].samples), [10.0, 15.0]);
    assert_eq!(ts(&done[1].samples), [0.0, 10.0]);
    // L'alzata presta la pressione anche attraverso la giunzione.
    assert_eq!(ps(&done[1].samples), [Some(0.7), Some(0.7)]);
}

#[test]
fn la_divisione_regge_anche_con_lo_stabilizzatore() {
    let trace = run_named("stabilizer_with_a_split");
    let done = ends(&trace);
    assert!(done.len() >= 2, "{} tratti", done.len());
    for d in &done {
        assert!(d.samples.len() <= 3);
        assert!(
            ts(&d.samples).iter().all(|t| *t >= 0.0),
            "{:?}",
            ts(&d.samples)
        );
    }
    for pair in done.windows(2) {
        assert_eq!(
            pair[0].samples.last().map(|s| (s.x, s.y)),
            Some((pair[1].samples[0].x, pair[1].samples[0].y))
        );
    }
}

#[test]
fn un_tratto_di_decine_di_migliaia_di_campioni_si_divide_senza_perdere_niente() {
    const EVENTS: usize = 25_000;
    let mut session = Session::new(SessionConfig::default()).unwrap();
    let mut effects = session.pointer_down(&mouse(1, 0.0, 0.0, 0.0));
    for i in 1..=EVENTS {
        let x = i as f64;
        effects.extend(session.pointer_move(&[], &mouse(1, x, (i % 7) as f64, x), &[]));
    }
    effects.extend(session.pointer_up(&mouse(1, EVENTS as f64 + 1.0, 0.0, EVENTS as f64 + 1.0)));
    let done: Vec<&FinishedStroke> = effects
        .iter()
        .filter_map(|e| match e {
            Effect::End(done) => Some(done),
            _ => None,
        })
        .collect();
    assert!(done.iter().all(|d| d.samples.len() <= MAX_SAMPLES));
    // Il 0, i 25 000 eventi e l'alzata, con un campione di giunzione per ogni
    // tratto dopo il primo.
    let total: usize = done.iter().map(|d| d.samples.len()).sum();
    assert_eq!(total - (done.len() - 1), EVENTS + 2);
    // Tutti, nell'ordine, senza buchi né doppioni.
    let mut x = -1.0;
    for (n, d) in done.iter().enumerate() {
        let skip = usize::from(n > 0);
        for s in &d.samples[skip..] {
            assert!(s.x > x, "{} dopo {}", s.x, x);
            x = s.x;
        }
    }
    assert_eq!(done.len(), 3);
}

#[test]
fn un_limite_di_due_campioni_non_gira_a_vuoto() {
    let config = SessionConfig {
        max_samples: 2,
        ..SessionConfig::default()
    };
    let mut session = Session::new(config).unwrap();
    let mut effects = session.pointer_down(&mouse(1, 0.0, 0.0, 0.0));
    for i in 1..=10 {
        effects.extend(session.pointer_move(&[], &mouse(1, i as f64, 0.0, i as f64), &[]));
    }
    effects.extend(session.pointer_up(&mouse(1, 11.0, 0.0, 11.0)));
    let counts: Vec<usize> = effects
        .iter()
        .filter_map(|e| match e {
            Effect::End(done) => Some(done.samples.len()),
            _ => None,
        })
        .collect();
    assert_eq!(counts, vec![2; 11]);
}

#[test]
fn il_limite_dei_campioni_ha_un_intervallo() {
    for bad in [0, 1, MAX_SAMPLES + 1] {
        let config = SessionConfig {
            max_samples: bad,
            ..SessionConfig::default()
        };
        assert_eq!(
            Session::new(config).err(),
            Some(ConfigError::MaxSamples(bad))
        );
    }
    for good in [2, 3, MAX_SAMPLES] {
        let config = SessionConfig {
            max_samples: good,
            ..SessionConfig::default()
        };
        assert!(Session::new(config).is_ok());
    }
}

// --- La pressione ------------------------------------------------------------------

#[test]
fn la_curva_della_pressione_da_la_pressione_scritta() {
    let curve = PenCurve::new(0.5, 0.1, 0.9).unwrap();
    let trace = run_named("the_pressure_curve_shapes_the_stroke");
    let done = &ends(&trace)[0].clone();
    let raw = [0.0001, 0.25, 0.5, 0.95];
    for (sample, raw) in done.samples.iter().zip(raw) {
        let expected = curve.apply(raw).clamp(0.0, 1.0);
        assert!(close(sample.p.unwrap(), expected), "{raw}: {:?}", sample.p);
    }
    let p: Vec<f64> = done.samples.iter().map(|s| s.p.unwrap()).collect();
    assert!(p.windows(2).all(|w| w[0] <= w[1]), "{p:?}");
    assert!(p[0] >= 0.1 && close(p[3], 1.0), "{p:?}");
}

#[test]
fn i_valori_che_non_sono_numeri_non_rompono_il_tratto() {
    let trace = run_named("values_that_are_not_numbers");
    let done = &ends(&trace)[0].clone();
    // Un punto non finito si scarta; una pressione non finita vale 0,5; una
    // pressione oltre 1 vale 1.
    assert_eq!(xs(&done.samples), [0.0, 6.0, 8.0, 9.0]);
    assert_eq!(
        ps(&done.samples),
        [Some(0.5), Some(0.5), Some(1.0), Some(1.0)]
    );
    assert!(done
        .samples
        .iter()
        .all(|s| s.x.is_finite() && s.y.is_finite() && s.t.is_finite()));
}

// --- Lo stabilizzatore ---------------------------------------------------------------

#[test]
fn la_corda_non_muove_il_pennino_per_un_tremito_e_il_tratto_finisce_dove_finisce_il_puntatore() {
    let trace = run_named("stabilizer_pulled_string");
    let done = &ends(&trace)[0].clone();
    let last = done.samples.last().unwrap();
    assert_eq!((last.x, last.y), (70.0, 10.0));
    // Dopo il primo punto, il pennino non si muove finché la corda non è tesa:
    // la corda è lunga 20.
    assert!(
        done.samples[1..].iter().all(|s| s.x >= 20.0 - 1e-9),
        "{:?}",
        xs(&done.samples)
    );
    assert!(done.samples.len() < 6, "meno campioni degli eventi");
}

#[test]
fn la_corda_si_accorcia_con_lo_zoom() {
    let trace = run_named("stabilizer_string_follows_the_zoom");
    let done = &ends(&trace)[0].clone();
    // A scala 2 la corda è di 20 unità: il puntatore a 100 lascia il pennino a 80.
    assert_close(&xs(&done.samples), &[0.0, 30.0, 80.0]);
}

#[test]
fn la_media_va_per_il_tempo_e_il_tratto_recupera() {
    let trace = run_named("stabilizer_average");
    let done = &ends(&trace)[0].clone();
    let last = done.samples.last().unwrap();
    assert_eq!((last.x, last.y), (100.0, 50.0));
    assert!(done.samples.len() > 5, "il recupero aggiunge campioni");
    assert!(xs(&done.samples).windows(2).all(|w| w[0] <= w[1] + 1e-12));
    assert!(ts(&done.samples).windows(2).all(|w| w[0] <= w[1]));
}

#[test]
fn lo_stabilizzatore_spento_lascia_il_tratto_com_e() {
    let off = SessionConfig {
        stabilizer: StabilizerConfig {
            amount: 0.0,
            pulled_string: true,
            ..StabilizerConfig::default()
        },
        ..SessionConfig::default()
    };
    let plain = script("mouse_stroke", scenario("mouse_stroke").steps);
    let with_off = script_with("mouse_stroke", off, plain.steps.clone());
    let a: Vec<Effect> = run(&plain).effects.into_iter().flatten().collect();
    let b: Vec<Effect> = run(&with_off).effects.into_iter().flatten().collect();
    assert_eq!(a, b);
}

// --- Per ogni scenario del catalogo -----------------------------------------------------

#[test]
fn lo_stesso_scenario_da_gli_stessi_effetti_sempre() {
    for script in catalog() {
        let a = run(&script);
        let b = run(&script);
        assert_eq!(a.effects, b.effects, "{}", script.name);
        assert_eq!(a.roles, b.roles, "{}", script.name);
        assert_eq!(a.states, b.states, "{}", script.name);
    }
}

#[test]
fn ogni_scenario_ha_un_nome_unico() {
    let mut names: Vec<&str> = catalog().iter().map(|s| s.name).collect();
    let all = names.len();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), all);
}

#[test]
fn gli_identificatori_dei_tratti_sono_unici_e_crescenti() {
    for script in catalog() {
        let trace = run(&script);
        let ids: Vec<u32> = trace
            .all()
            .into_iter()
            .filter_map(|e| match e {
                Effect::Start(start) => Some(start.id),
                _ => None,
            })
            .collect();
        let expected: Vec<u32> = (1..=ids.len() as u32).collect();
        assert_eq!(ids, expected, "{}", script.name);
    }
}

#[test]
fn ogni_tratto_annunciato_finisce_una_volta_sola() {
    for script in catalog() {
        let trace = run(&script);
        let mut open: Option<u32> = None;
        for effect in trace.all() {
            match effect {
                Effect::Start(start) => {
                    assert!(open.is_none(), "{}: due tratti aperti", script.name);
                    open = Some(start.id);
                }
                Effect::Samples { id, .. } | Effect::Predicted { id, .. } => {
                    assert_eq!(open, Some(*id), "{}: campioni senza tratto", script.name);
                }
                Effect::End(done) => {
                    assert_eq!(open, Some(done.start.id), "{}", script.name);
                    open = None;
                }
                Effect::Cancel { id, .. } => {
                    assert_eq!(open, Some(*id), "{}", script.name);
                    open = None;
                }
                Effect::Capture(_) | Effect::Release(_) => {}
            }
        }
        assert!(open.is_none(), "{}: tratto rimasto aperto", script.name);
    }
}

#[test]
fn ogni_cattura_ha_il_suo_rilascio() {
    for script in catalog() {
        let trace = run(&script);
        let mut captured: Vec<i64> = Vec::new();
        for effect in trace.all() {
            match effect {
                Effect::Capture(id) => {
                    assert!(!captured.contains(id), "{}: cattura doppia", script.name);
                    captured.push(*id);
                }
                Effect::Release(id) => {
                    assert!(
                        captured.contains(id),
                        "{}: rilascio di {id} mai catturato",
                        script.name
                    );
                    captured.retain(|c| c != id);
                }
                _ => {}
            }
        }
        assert!(
            captured.is_empty(),
            "{}: ancora catturati {captured:?}",
            script.name
        );
    }
}

#[test]
fn i_campioni_consegnati_sono_quelli_del_tratto_concluso() {
    for script in catalog() {
        let trace = run(&script);
        let mut delivered: Vec<(u32, Vec<Sample>)> = Vec::new();
        for effect in trace.all() {
            match effect {
                Effect::Start(start) => delivered.push((start.id, Vec::new())),
                Effect::Samples { id, samples } => {
                    let entry = delivered.iter_mut().find(|(i, _)| i == id).unwrap();
                    entry.1.extend_from_slice(samples);
                }
                Effect::End(done) => {
                    let entry = delivered.iter().find(|(i, _)| *i == done.start.id).unwrap();
                    // L'inclinazione dell'anteprima può mancare nel tratto: il
                    // resto è lo stesso.
                    let flat = |s: &Sample| (s.x, s.y, s.p, s.t);
                    let a: Vec<_> = entry.1.iter().map(flat).collect();
                    let b: Vec<_> = done.samples.iter().map(flat).collect();
                    assert_eq!(a, b, "{}", script.name);
                }
                _ => {}
            }
        }
    }
}

#[test]
fn i_campioni_di_un_tratto_hanno_il_tempo_che_non_torna_indietro() {
    for script in catalog() {
        let trace = run(&script);
        for effect in trace.all() {
            if let Effect::End(done) = effect {
                assert!(!done.samples.is_empty(), "{}", script.name);
                assert_eq!(done.samples[0].t, 0.0, "{}", script.name);
                let t = ts(&done.samples);
                assert!(t.windows(2).all(|w| w[0] <= w[1]), "{}: {t:?}", script.name);
                assert!(
                    done.samples.len() <= script.config.max_samples,
                    "{}",
                    script.name
                );
            }
        }
    }
}

#[test]
fn nessun_campione_e_non_finito() {
    for script in catalog() {
        let trace = run(&script);
        for effect in trace.all() {
            let samples: &[Sample] = match effect {
                Effect::Samples { samples, .. } | Effect::Predicted { samples, .. } => samples,
                Effect::End(done) => &done.samples,
                _ => continue,
            };
            for s in samples {
                assert!(
                    s.x.is_finite() && s.y.is_finite() && s.t.is_finite(),
                    "{}: {s:?}",
                    script.name
                );
                assert!(
                    s.p.is_none_or(|p| (0.0..=1.0).contains(&p)),
                    "{}",
                    script.name
                );
            }
        }
    }
}
