//! Gli scenari del ciclo di vita, scritti una volta sola.
//!
//! Un [`Script`] è una configurazione e una sequenza di eventi; [`run`] lo passa
//! a una [`Session`] e restituisce gli effetti di ogni evento. Lo usano due
//! test: `session.rs`, che dice a parole che cosa deve succedere, e
//! `ts_mirror.rs`, che scrive gli stessi scenari con le risposte di Rust nella
//! fixture che la copia TypeScript deve rispettare.

#![allow(dead_code)]

use std::f64::consts::PI;

use fub_ink::{
    CancelReason, Effect, PenCurve, PointerKind, PointerRole, PointerSample, Sample, Session,
    SessionConfig, StabilizerConfig, Tilt, TouchPolicy, View,
};
use serde_json::{json, Map, Value};

/// Un evento della superficie.
#[derive(Clone, Debug)]
pub enum Step {
    Down(PointerSample),
    Move {
        coalesced: Vec<PointerSample>,
        event: PointerSample,
        predicted: Vec<PointerSample>,
    },
    Up(PointerSample),
    PointerCancel(i64),
    LostCapture(i64),
    Leave(i64, PointerKind),
    Interrupt(CancelReason),
    Cancel,
    Destroy,
    Touch(TouchPolicy),
}

/// Uno scenario.
#[derive(Clone, Debug)]
pub struct Script {
    pub name: &'static str,
    pub config: SessionConfig,
    pub steps: Vec<Step>,
}

/// Che cosa ha prodotto uno scenario.
pub struct Trace {
    /// Gli effetti di ogni evento.
    pub effects: Vec<Vec<Effect>>,
    /// Il ruolo di ogni puntatore nominato dallo scenario, dopo ogni evento.
    pub roles: Vec<Vec<(i64, Option<PointerRole>)>>,
    /// `drawing` e `pen_seen` dopo ogni evento.
    pub states: Vec<(bool, bool)>,
}

impl Trace {
    /// Tutti gli effetti, nell'ordine.
    pub fn all(&self) -> Vec<&Effect> {
        self.effects.iter().flatten().collect()
    }
}

/// Gli identificatori dei puntatori che uno scenario nomina.
fn pointer_ids(script: &Script) -> Vec<i64> {
    let mut ids = std::collections::BTreeSet::new();
    for step in &script.steps {
        match step {
            Step::Down(e) | Step::Up(e) => {
                ids.insert(e.pointer_id);
            }
            Step::Move { event, .. } => {
                ids.insert(event.pointer_id);
            }
            Step::PointerCancel(id) | Step::LostCapture(id) | Step::Leave(id, _) => {
                ids.insert(*id);
            }
            _ => {}
        }
    }
    ids.into_iter().collect()
}

pub fn run(script: &Script) -> Trace {
    let mut session = Session::new(script.config).expect("configurazione valida");
    let ids = pointer_ids(script);
    let mut trace = Trace {
        effects: Vec::new(),
        roles: Vec::new(),
        states: Vec::new(),
    };
    for step in &script.steps {
        let effects = match step {
            Step::Down(e) => session.pointer_down(e),
            Step::Move {
                coalesced,
                event,
                predicted,
            } => session.pointer_move(coalesced, event, predicted),
            Step::Up(e) => session.pointer_up(e),
            Step::PointerCancel(id) => session.pointer_cancel(*id),
            Step::LostCapture(id) => session.lost_capture(*id),
            Step::Leave(id, kind) => {
                session.pointer_leave(*id, *kind);
                Vec::new()
            }
            Step::Interrupt(reason) => session.interrupt(*reason),
            Step::Cancel => session.cancel(),
            Step::Destroy => session.destroy(),
            Step::Touch(policy) => {
                session.set_touch_policy(*policy);
                Vec::new()
            }
        };
        trace.effects.push(effects);
        trace
            .roles
            .push(ids.iter().map(|id| (*id, session.role_of(*id))).collect());
        trace.states.push((session.drawing(), session.pen_seen()));
    }
    trace
}

// --- I costruttori degli eventi --------------------------------------------

pub fn pen(id: i64, x: f64, y: f64, t: f64, pressure: f64) -> PointerSample {
    PointerSample {
        pressure,
        ..PointerSample::new(id, PointerKind::Pen, x, y, t)
    }
}

pub fn mouse(id: i64, x: f64, y: f64, t: f64) -> PointerSample {
    PointerSample::new(id, PointerKind::Mouse, x, y, t)
}

pub fn finger(id: i64, x: f64, y: f64, t: f64) -> PointerSample {
    PointerSample::new(id, PointerKind::Touch, x, y, t)
}

/// L'evento senza tasti premuti: una penna sospesa, un mouse che passa.
pub fn hovering(e: PointerSample) -> PointerSample {
    PointerSample { buttons: 0, ..e }
}

/// L'evento col tasto `button` (il mouse dalla parte del tasto secondario).
pub fn button(e: PointerSample, button: i32) -> PointerSample {
    PointerSample { button, ..e }
}

/// L'evento col tasto `button` e i tasti premuti `buttons`.
pub fn pressed(e: PointerSample, button: i32, buttons: u32) -> PointerSample {
    PointerSample {
        button,
        buttons,
        ..e
    }
}

pub fn tilted(e: PointerSample, tilt_x: f64, tilt_y: f64) -> PointerSample {
    PointerSample {
        tilt: Tilt {
            tilt_x: Some(tilt_x),
            tilt_y: Some(tilt_y),
            ..Tilt::default()
        },
        ..e
    }
}

/// I valori di una penna senza sensore d'inclinazione: quelli di default di
/// Pointer Events.
pub fn untilted(e: PointerSample) -> PointerSample {
    PointerSample {
        tilt: Tilt {
            tilt_x: Some(0.0),
            tilt_y: Some(0.0),
            altitude: Some(PI / 2.0),
            azimuth: Some(0.0),
        },
        ..e
    }
}

pub fn angled(e: PointerSample, altitude: f64, azimuth: f64) -> PointerSample {
    PointerSample {
        tilt: Tilt {
            altitude: Some(altitude),
            azimuth: Some(azimuth),
            ..Tilt::default()
        },
        ..e
    }
}

pub fn seen_from(e: PointerSample, turn: f64, scale: f64) -> PointerSample {
    PointerSample {
        view: View { turn, scale },
        ..e
    }
}

pub fn moved(e: PointerSample) -> Step {
    Step::Move {
        coalesced: Vec::new(),
        event: e,
        predicted: Vec::new(),
    }
}

pub fn script(name: &'static str, steps: Vec<Step>) -> Script {
    Script {
        name,
        config: SessionConfig::default(),
        steps,
    }
}

pub fn script_with(name: &'static str, config: SessionConfig, steps: Vec<Step>) -> Script {
    Script {
        name,
        config,
        steps,
    }
}

// --- Il catalogo ----------------------------------------------------------

/// Una linea di `n` mosse del mouse dal punto (0, 0), una ogni 10 ms.
fn mouse_line(id: i64, n: usize) -> Vec<Step> {
    let mut steps = vec![Step::Down(mouse(id, 0.0, 0.0, 100.0))];
    for i in 1..=n {
        steps.push(moved(mouse(
            id,
            i as f64 * 10.0,
            (i % 3) as f64,
            100.0 + i as f64 * 10.0,
        )));
    }
    steps
}

/// Un tratto del mouse interrotto da `cut` a metà, e poi un tratto nuovo.
fn cut_stroke(name: &'static str, id: i64, cut: Step) -> Script {
    script(
        name,
        vec![
            Step::Down(mouse(id, 0.0, 0.0, 0.0)),
            moved(mouse(id, 5.0, 0.0, 10.0)),
            cut,
            moved(mouse(id, 9.0, 0.0, 30.0)),
            Step::Up(mouse(id, 9.0, 0.0, 40.0)),
            // Poi un tratto nuovo comincia come niente fosse.
            Step::Down(mouse(id, 20.0, 0.0, 100.0)),
            Step::Up(mouse(id, 21.0, 0.0, 110.0)),
        ],
    )
}

// Un catalogo si legge meglio come una serie di scenari commentati, uno per
// push, che come un unico `vec![]` di centinaia di righe.
#[allow(clippy::vec_init_then_push)]
pub fn catalog() -> Vec<Script> {
    let mut all = Vec::new();

    // Il mouse: niente pressione, il coalescente entra nell'ordine.
    all.push(script(
        "mouse_stroke",
        vec![
            Step::Down(mouse(1, 10.0, 10.0, 100.0)),
            Step::Move {
                coalesced: vec![mouse(1, 15.0, 10.0, 105.0)],
                event: mouse(1, 20.0, 10.0, 110.0),
                predicted: vec![],
            },
            moved(mouse(1, 30.0, 12.0, 120.0)),
            Step::Up(mouse(1, 35.0, 15.0, 130.0)),
        ],
    ));

    // La penna: pressione, inclinazione, l'alzata presta il campione prima.
    all.push(script(
        "pen_pressure_and_tilt",
        vec![
            Step::Down(tilted(pen(2, 0.0, 0.0, 0.0, 0.1), 10.0, 5.0)),
            moved(tilted(pen(2, 5.0, 1.0, 8.0, 0.4), 12.0, 5.0)),
            moved(tilted(pen(2, 10.0, 3.0, 16.0, 0.8), 15.0, 6.0)),
            Step::Up(tilted(pen(2, 12.0, 4.0, 24.0, 0.0), 15.0, 6.0)),
        ],
    ));

    // Una penna senza sensore dà i default: il tratto non porta l'inclinazione.
    all.push(script(
        "pen_without_a_tilt_sensor",
        vec![
            Step::Down(untilted(pen(3, 0.0, 0.0, 0.0, 0.5))),
            moved(untilted(pen(3, 4.0, 0.0, 8.0, 0.6))),
            Step::Up(untilted(pen(3, 8.0, 0.0, 16.0, 0.0))),
        ],
    ));

    // Gli angoli dell'evento valgono più delle inclinazioni.
    all.push(script(
        "pen_angles_beat_tilt",
        vec![
            Step::Down(angled(pen(4, 0.0, 0.0, 0.0, 0.5), PI / 4.0, PI / 2.0)),
            moved(angled(pen(4, 4.0, 0.0, 8.0, 0.5), PI / 3.0, PI)),
            Step::Up(angled(pen(4, 8.0, 0.0, 16.0, 0.0), PI / 3.0, PI)),
        ],
    ));

    // Una penna sospesa non disegna; appoggiata senza premere nemmeno;
    // comincia quando preme.
    all.push(script(
        "pen_draws_only_when_it_presses",
        vec![
            Step::Move {
                coalesced: vec![],
                event: hovering(pen(5, 1.0, 1.0, 0.0, 0.0)),
                predicted: vec![],
            },
            Step::Down(pen(5, 2.0, 2.0, 10.0, 0.0)),
            moved(pen(5, 3.0, 3.0, 20.0, 0.0)),
            moved(pen(5, 4.0, 4.0, 30.0, 0.3)),
            moved(pen(5, 6.0, 4.0, 40.0, 0.6)),
            Step::Up(pen(5, 7.0, 4.0, 50.0, 0.0)),
        ],
    ));

    // Una penna che si alza senza aver premuto se ne va in silenzio.
    all.push(script(
        "pen_lifted_without_pressing",
        vec![
            Step::Down(pen(6, 2.0, 2.0, 10.0, 0.0)),
            Step::Up(pen(6, 2.0, 2.0, 20.0, 0.0)),
        ],
    ));

    // Il coalescente: un doppione, un evento più vecchio, un evento in coda.
    all.push(script(
        "coalesced_events_are_all_taken",
        vec![
            Step::Down(mouse(7, 0.0, 0.0, 100.0)),
            Step::Move {
                coalesced: vec![
                    mouse(7, 1.0, 0.0, 102.0),
                    mouse(7, 1.0, 0.0, 102.0),
                    mouse(7, 9.0, 9.0, 101.0),
                    mouse(7, 2.0, 0.0, 104.0),
                ],
                event: mouse(7, 3.0, 0.0, 106.0),
                predicted: vec![],
            },
            // Stesso istante dell'ultimo ma altri valori: è un campione nuovo.
            moved(mouse(7, 3.5, 0.5, 106.0)),
            // L'evento in coda è già nella lista: un doppione.
            Step::Move {
                coalesced: vec![mouse(7, 5.0, 0.0, 110.0)],
                event: mouse(7, 5.0, 0.0, 110.0),
                predicted: vec![],
            },
            Step::Up(mouse(7, 5.0, 0.0, 111.0)),
        ],
    ));

    // La predizione sostituisce la precedente e non entra mai nel tratto.
    all.push(script(
        "predicted_replaces_the_previous_one",
        vec![
            Step::Down(pen(8, 0.0, 0.0, 0.0, 0.5)),
            Step::Move {
                coalesced: vec![],
                event: pen(8, 4.0, 0.0, 8.0, 0.5),
                predicted: vec![pen(8, 6.0, 0.0, 12.0, 0.5), pen(8, 8.0, 0.0, 16.0, 0.5)],
            },
            Step::Move {
                coalesced: vec![],
                event: pen(8, 8.0, 1.0, 16.0, 0.5),
                predicted: vec![pen(8, 10.0, 1.0, 20.0, 0.5)],
            },
            // Una predizione vuota dopo una piena la cancella.
            Step::Move {
                coalesced: vec![],
                event: pen(8, 12.0, 1.0, 24.0, 0.5),
                predicted: vec![],
            },
            // E una vuota dopo una vuota non dice niente.
            Step::Move {
                coalesced: vec![],
                event: pen(8, 13.0, 1.0, 32.0, 0.5),
                predicted: vec![],
            },
            Step::Move {
                coalesced: vec![],
                event: pen(8, 14.0, 1.0, 40.0, 0.5),
                predicted: vec![pen(8, 16.0, 1.0, 44.0, 0.5)],
            },
            Step::Up(pen(8, 15.0, 1.0, 48.0, 0.0)),
        ],
    ));

    // Il tratto si annulla intero, per ogni ragione.
    all.push(cut_stroke(
        "cancelled_by_pointercancel",
        9,
        Step::PointerCancel(9),
    ));
    all.push(cut_stroke(
        "cancelled_by_lost_capture",
        10,
        Step::LostCapture(10),
    ));
    all.push(cut_stroke(
        "cancelled_by_blur",
        11,
        Step::Interrupt(CancelReason::Blur),
    ));
    all.push(cut_stroke(
        "cancelled_by_hidden",
        12,
        Step::Interrupt(CancelReason::Hidden),
    ));
    all.push(cut_stroke("cancelled_by_the_api", 13, Step::Cancel));
    all.push(cut_stroke("cancelled_by_destroy", 14, Step::Destroy));

    // Un dito che disegna e arriva una penna: il dito è il palmo.
    all.push(script(
        "pen_arriving_turns_a_finger_into_a_palm",
        vec![
            Step::Down(finger(20, 5.0, 5.0, 0.0)),
            moved(finger(20, 6.0, 5.0, 10.0)),
            Step::Move {
                coalesced: vec![],
                event: hovering(pen(21, 50.0, 50.0, 15.0, 0.0)),
                predicted: vec![],
            },
            moved(finger(20, 7.0, 5.0, 20.0)),
            Step::Up(finger(20, 7.0, 5.0, 30.0)),
            // Con la penna vicina un dito nuovo è palmo.
            Step::Down(finger(22, 8.0, 8.0, 40.0)),
            moved(finger(22, 9.0, 8.0, 50.0)),
            Step::Up(finger(22, 9.0, 8.0, 60.0)),
            // La penna esce dal raggio: il dito non disegna lo stesso, perché
            // su questa superficie si è vista una penna.
            Step::Leave(21, PointerKind::Pen),
            Step::Down(finger(23, 8.0, 8.0, 70.0)),
            Step::Up(finger(23, 8.0, 8.0, 80.0)),
        ],
    ));

    // Un secondo dito: il primo smette di disegnare e diventa navigazione.
    all.push(script(
        "a_second_finger_turns_drawing_into_navigation",
        vec![
            Step::Down(finger(30, 0.0, 0.0, 0.0)),
            moved(finger(30, 2.0, 0.0, 10.0)),
            Step::Down(finger(31, 50.0, 0.0, 15.0)),
            moved(finger(30, 3.0, 0.0, 20.0)),
            moved(finger(31, 51.0, 0.0, 20.0)),
            Step::Up(finger(30, 3.0, 0.0, 30.0)),
            Step::Up(finger(31, 51.0, 0.0, 30.0)),
        ],
    ));

    // La politica del tocco decide per un dito solo.
    for (name, policy) in [
        ("touch_policy_ink_draws_after_a_pen", TouchPolicy::Ink),
        ("touch_policy_navigate_never_draws", TouchPolicy::Navigate),
    ] {
        all.push(script(
            name,
            vec![
                Step::Touch(policy),
                Step::Move {
                    coalesced: vec![],
                    event: hovering(pen(40, 90.0, 90.0, 0.0, 0.0)),
                    predicted: vec![],
                },
                Step::Leave(40, PointerKind::Pen),
                Step::Down(finger(41, 5.0, 5.0, 10.0)),
                moved(finger(41, 6.0, 5.0, 20.0)),
                Step::Up(finger(41, 6.0, 5.0, 30.0)),
            ],
        ));
    }
    all.push(script(
        "touch_policy_auto_draws_until_a_pen_is_seen",
        vec![
            Step::Down(finger(42, 5.0, 5.0, 10.0)),
            moved(finger(42, 6.0, 5.0, 20.0)),
            Step::Up(finger(42, 6.0, 5.0, 30.0)),
            Step::Down(pen(43, 1.0, 1.0, 40.0, 0.5)),
            Step::Up(pen(43, 1.0, 1.0, 50.0, 0.0)),
            // La penna è ancora vicina: il dito è il palmo.
            Step::Down(finger(44, 5.0, 5.0, 55.0)),
            Step::Up(finger(44, 5.0, 5.0, 58.0)),
            // La penna se n'è andata, ma si è vista: il dito muove la vista.
            Step::Leave(43, PointerKind::Pen),
            Step::Down(finger(45, 5.0, 5.0, 60.0)),
            Step::Up(finger(45, 5.0, 5.0, 70.0)),
        ],
    ));

    // Il cambio di dispositivo: mouse, penna, dito (con la politica `Ink`, che
    // lascia disegnare il dito anche dopo la penna, uscita dal raggio).
    all.push(script_with(
        "device_change",
        SessionConfig {
            touch: TouchPolicy::Ink,
            ..SessionConfig::default()
        },
        vec![
            Step::Down(mouse(50, 0.0, 0.0, 0.0)),
            moved(mouse(50, 4.0, 0.0, 10.0)),
            Step::Up(mouse(50, 4.0, 0.0, 20.0)),
            Step::Down(pen(51, 10.0, 0.0, 30.0, 0.5)),
            moved(pen(51, 14.0, 0.0, 40.0, 0.7)),
            Step::Up(pen(51, 14.0, 0.0, 50.0, 0.0)),
            Step::Leave(51, PointerKind::Pen),
            Step::Down(finger(52, 20.0, 0.0, 60.0)),
            moved(finger(52, 24.0, 0.0, 70.0)),
            Step::Up(finger(52, 24.0, 0.0, 80.0)),
        ],
    ));

    // Un tratto alla volta.
    all.push(script(
        "one_stroke_at_a_time",
        vec![
            Step::Down(mouse(60, 0.0, 0.0, 0.0)),
            Step::Down(pen(61, 5.0, 5.0, 5.0, 0.5)),
            moved(mouse(60, 3.0, 0.0, 10.0)),
            moved(pen(61, 6.0, 5.0, 12.0, 0.5)),
            Step::Up(pen(61, 6.0, 5.0, 14.0, 0.0)),
            Step::Up(mouse(60, 3.0, 0.0, 20.0)),
        ],
    ));

    // I tasti: il secondario del mouse e un tasto strano della penna non
    // disegnano; il centrale muove la vista.
    all.push(script(
        "buttons_decide_the_role",
        vec![
            Step::Down(button(mouse(70, 0.0, 0.0, 0.0), 2)),
            Step::Up(button(mouse(70, 0.0, 0.0, 5.0), 2)),
            Step::Down(button(mouse(71, 0.0, 0.0, 10.0), 1)),
            Step::Up(button(mouse(71, 0.0, 0.0, 15.0), 1)),
            Step::Down(button(pen(72, 0.0, 0.0, 20.0, 0.5), 3)),
            Step::Up(button(pen(72, 0.0, 0.0, 25.0, 0.0), 3)),
        ],
    ));

    // La penna girata fa un tratto da gomma, tenuto vivo dal bit 32; il tasto
    // laterale un tratto suo, tenuto dal bit 2, che finisce quando si
    // rilascia anche se la punta resta giù.
    all.push(script(
        "the_pen_eraser_and_barrel_make_their_strokes",
        vec![
            Step::Down(pressed(pen(73, 0.0, 0.0, 0.0, 0.5), 5, 32)),
            moved(pressed(pen(73, 4.0, 0.0, 10.0, 0.5), -1, 32)),
            Step::Up(pressed(pen(73, 6.0, 0.0, 20.0, 0.0), 5, 0)),
            Step::Down(pressed(pen(74, 0.0, 9.0, 100.0, 0.5), 2, 2)),
            moved(pressed(pen(74, 4.0, 9.0, 110.0, 0.5), -1, 2)),
            moved(pressed(pen(74, 6.0, 9.0, 120.0, 0.5), -1, 1)),
            Step::Up(pressed(pen(74, 6.0, 9.0, 130.0, 0.0), 0, 0)),
        ],
    ));

    // Un tocco senza movimento ha due campioni nello stesso punto.
    all.push(script(
        "a_tap_has_two_samples",
        vec![
            Step::Down(mouse(80, 5.0, 5.0, 0.0)),
            Step::Up(mouse(80, 5.0, 5.0, 40.0)),
            Step::Down(pen(81, 9.0, 9.0, 100.0, 0.6)),
            Step::Up(pen(81, 9.0, 9.0, 130.0, 0.0)),
        ],
    ));

    // Il tasto principale rilasciato con un altro premuto: il tratto finisce.
    all.push(script(
        "primary_button_released_ends_the_stroke",
        vec![
            Step::Down(mouse(82, 0.0, 0.0, 0.0)),
            moved(mouse(82, 4.0, 0.0, 10.0)),
            Step::Move {
                coalesced: vec![],
                event: PointerSample {
                    buttons: 2,
                    ..mouse(82, 6.0, 0.0, 20.0)
                },
                predicted: vec![],
            },
            moved(mouse(82, 8.0, 0.0, 30.0)),
        ],
    ));

    // Un `pointerup` perso: lo stesso puntatore giù due volte annulla il primo.
    all.push(script(
        "a_lost_pointerup_cancels_the_stroke",
        vec![
            Step::Down(mouse(83, 0.0, 0.0, 0.0)),
            moved(mouse(83, 4.0, 0.0, 10.0)),
            Step::Down(mouse(83, 50.0, 50.0, 100.0)),
            moved(mouse(83, 54.0, 50.0, 110.0)),
            Step::Up(mouse(83, 54.0, 50.0, 120.0)),
        ],
    ));

    // Un tratto lungo si divide al limite dei campioni, senza buchi.
    let mut long = mouse_line(84, 9);
    long.push(Step::Up(mouse(84, 100.0, 1.0, 200.0)));
    all.push(script_with(
        "a_long_stroke_splits_at_the_limit",
        SessionConfig {
            max_samples: 4,
            ..SessionConfig::default()
        },
        long,
    ));

    // L'alzata cade quando il tratto è pieno: si divide lì.
    all.push(script_with(
        "the_lift_can_split_a_full_stroke",
        SessionConfig {
            max_samples: 3,
            ..SessionConfig::default()
        },
        vec![
            Step::Down(pen(85, 0.0, 0.0, 0.0, 0.5)),
            moved(pen(85, 5.0, 0.0, 10.0, 0.6)),
            moved(pen(85, 10.0, 0.0, 20.0, 0.7)),
            Step::Up(pen(85, 15.0, 0.0, 30.0, 0.0)),
        ],
    ));

    // Il foglio girato: l'azimut si toglie l'angolo della vista.
    all.push(script(
        "a_turned_sheet_turns_the_azimuth",
        vec![
            Step::Down(seen_from(
                tilted(pen(86, 0.0, 0.0, 0.0, 0.5), 20.0, 0.0),
                30.0,
                1.0,
            )),
            moved(seen_from(
                tilted(pen(86, 4.0, 0.0, 8.0, 0.5), 0.0, 20.0),
                30.0,
                1.0,
            )),
            moved(seen_from(
                tilted(pen(86, 8.0, 0.0, 16.0, 0.5), -20.0, 0.0),
                200.0,
                1.0,
            )),
            Step::Up(seen_from(
                tilted(pen(86, 9.0, 0.0, 24.0, 0.0), -20.0, 0.0),
                200.0,
                1.0,
            )),
        ],
    ));

    // La curva della pressione.
    all.push(script_with(
        "the_pressure_curve_shapes_the_stroke",
        SessionConfig {
            curve: PenCurve::new(0.5, 0.1, 0.9),
            ..SessionConfig::default()
        },
        vec![
            Step::Down(pen(87, 0.0, 0.0, 0.0, 0.0001)),
            moved(pen(87, 4.0, 0.0, 8.0, 0.25)),
            moved(pen(87, 8.0, 0.0, 16.0, 0.5)),
            moved(pen(87, 12.0, 0.0, 24.0, 0.95)),
            Step::Up(pen(87, 13.0, 0.0, 32.0, 0.0)),
        ],
    ));

    // Valori che un motore non sa dare: un punto non finito si scarta, una
    // pressione non finita vale 0,5.
    all.push(script(
        "values_that_are_not_numbers",
        vec![
            Step::Down(pen(88, 0.0, 0.0, 0.0, 0.5)),
            moved(pen(88, f64::NAN, 0.0, 8.0, 0.5)),
            moved(pen(88, 4.0, f64::INFINITY, 12.0, 0.5)),
            moved(pen(88, 6.0, 0.0, 16.0, f64::NAN)),
            moved(pen(88, 8.0, 0.0, 24.0, 7.0)),
            Step::Up(pen(88, 9.0, 0.0, 32.0, 0.0)),
        ],
    ));

    // Un istante che non è un numero scarta l'evento come un punto: anche il
    // primo, una predizione e l'alzata. Uno infinito non fa scartare come
    // vecchi gli eventi dopo.
    all.push(script(
        "times_that_are_not_numbers",
        vec![
            Step::Down(pen(89, 0.0, 0.0, f64::NAN, 0.5)),
            moved(pen(89, 2.0, 0.0, 8.0, 0.5)),
            moved(pen(89, 4.0, 0.0, f64::NAN, 0.5)),
            moved(pen(89, 6.0, 0.0, f64::INFINITY, 0.5)),
            Step::Move {
                coalesced: Vec::new(),
                event: pen(89, 8.0, 0.0, 16.0, 0.5),
                predicted: vec![
                    pen(89, 10.0, 0.0, f64::NAN, 0.5),
                    pen(89, 12.0, 0.0, 24.0, 0.5),
                ],
            },
            Step::Up(pen(89, 14.0, 0.0, f64::INFINITY, 0.0)),
        ],
    ));

    // Lo stabilizzatore a corda: un tremito non muove il pennino, e il tratto
    // finisce dove è finito il puntatore.
    all.push(script_with(
        "stabilizer_pulled_string",
        SessionConfig {
            stabilizer: StabilizerConfig {
                amount: 0.2,
                pulled_string: true,
                ..StabilizerConfig::default()
            },
            ..SessionConfig::default()
        },
        vec![
            Step::Down(seen_from(mouse(90, 0.0, 0.0, 0.0), 0.0, 1.0)),
            moved(mouse(90, 5.0, 0.0, 8.0)),
            moved(mouse(90, 0.0, 0.0, 16.0)),
            moved(mouse(90, 40.0, 0.0, 24.0)),
            moved(mouse(90, 60.0, 10.0, 32.0)),
            Step::Up(mouse(90, 70.0, 10.0, 40.0)),
        ],
    ));

    // La corda si accorcia con lo zoom: gli stessi pixel sono meno unità.
    all.push(script_with(
        "stabilizer_string_follows_the_zoom",
        SessionConfig {
            stabilizer: StabilizerConfig {
                amount: 0.4,
                pulled_string: true,
                catch_up_on_end: false,
                ..StabilizerConfig::default()
            },
            ..SessionConfig::default()
        },
        vec![
            Step::Down(seen_from(mouse(91, 0.0, 0.0, 0.0), 0.0, 2.0)),
            moved(seen_from(mouse(91, 50.0, 0.0, 8.0), 0.0, 2.0)),
            moved(seen_from(mouse(91, 100.0, 0.0, 16.0), 0.0, 2.0)),
            Step::Up(seen_from(mouse(91, 100.0, 0.0, 24.0), 0.0, 2.0)),
        ],
    ));

    // La media: conta il tempo, non il numero di eventi; il tratto recupera.
    all.push(script_with(
        "stabilizer_average",
        SessionConfig {
            stabilizer: StabilizerConfig {
                amount: 0.8,
                ..StabilizerConfig::default()
            },
            ..SessionConfig::default()
        },
        vec![
            Step::Down(pen(92, 0.0, 0.0, 0.0, 0.5)),
            moved(pen(92, 100.0, 0.0, 16.0, 0.6)),
            moved(pen(92, 100.0, 0.0, 48.0, 0.6)),
            moved(pen(92, 100.0, 50.0, 500.0, 0.7)),
            Step::Up(pen(92, 100.0, 50.0, 520.0, 0.0)),
        ],
    ));

    // Con la stabilizzazione la predizione non si consegna.
    all.push(script_with(
        "stabilizer_drops_the_prediction",
        SessionConfig {
            stabilizer: StabilizerConfig {
                amount: 0.5,
                ..StabilizerConfig::default()
            },
            ..SessionConfig::default()
        },
        vec![
            Step::Down(pen(93, 0.0, 0.0, 0.0, 0.5)),
            Step::Move {
                coalesced: vec![],
                event: pen(93, 10.0, 0.0, 16.0, 0.5),
                predicted: vec![pen(93, 20.0, 0.0, 32.0, 0.5)],
            },
            Step::Up(pen(93, 10.0, 0.0, 32.0, 0.0)),
        ],
    ));

    // Un tocco stabilizzato ha lo stesso i due campioni.
    all.push(script_with(
        "stabilizer_tap_keeps_two_samples",
        SessionConfig {
            stabilizer: StabilizerConfig {
                amount: 0.6,
                pulled_string: true,
                ..StabilizerConfig::default()
            },
            ..SessionConfig::default()
        },
        vec![
            Step::Down(mouse(94, 5.0, 5.0, 0.0)),
            Step::Up(mouse(94, 5.0, 5.0, 40.0)),
        ],
    ));

    // La stabilizzazione e il limite dei campioni: il tempo del seguito parte
    // dalla giunzione.
    let mut stabilised = mouse_line(95, 8);
    stabilised.push(Step::Up(mouse(95, 90.0, 0.0, 200.0)));
    all.push(script_with(
        "stabilizer_with_a_split",
        SessionConfig {
            max_samples: 3,
            stabilizer: StabilizerConfig {
                amount: 0.5,
                ..StabilizerConfig::default()
            },
            ..SessionConfig::default()
        },
        stabilised,
    ));

    // Una sessione distrutta non fa più niente.
    all.push(script(
        "a_destroyed_session_does_nothing",
        vec![
            Step::Down(mouse(96, 0.0, 0.0, 0.0)),
            Step::Destroy,
            Step::Down(mouse(96, 1.0, 0.0, 10.0)),
            moved(mouse(96, 2.0, 0.0, 20.0)),
            Step::Up(mouse(96, 2.0, 0.0, 30.0)),
            Step::Destroy,
        ],
    ));

    all
}

/// Lo scenario `name` del catalogo.
pub fn scenario(name: &str) -> Script {
    catalog()
        .into_iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("scenario sconosciuto: {name}"))
}

// --- Gli effetti, come testo -----------------------------------------------

pub fn sample_json(s: &Sample) -> Value {
    let mut object = Map::new();
    object.insert("x".into(), json!(s.x));
    object.insert("y".into(), json!(s.y));
    if let Some(p) = s.p {
        object.insert("p".into(), json!(p));
    }
    object.insert("t".into(), json!(s.t));
    if let Some((a, z)) = s.tilt {
        object.insert("a".into(), json!(a));
        object.insert("z".into(), json!(z));
    }
    Value::Object(object)
}

fn samples_json(samples: &[Sample]) -> Value {
    Value::Array(samples.iter().map(sample_json).collect())
}

pub fn effect_json(effect: &Effect) -> Value {
    match effect {
        Effect::Capture(id) => json!({"fx": "capture", "pointer": id}),
        Effect::Release(id) => json!({"fx": "release", "pointer": id}),
        Effect::Start(start) => json!({
            "fx": "start",
            "id": start.id,
            "pointerType": start.kind.name(),
            "pressure": start.pressure,
            "timeStamp": start.time_stamp,
            "continued": start.continued,
            "role": start.role.name(),
        }),
        Effect::Samples { id, samples } => {
            json!({"fx": "samples", "id": id, "samples": samples_json(samples)})
        }
        Effect::Predicted { id, samples } => {
            json!({"fx": "predicted", "id": id, "samples": samples_json(samples)})
        }
        Effect::End(done) => json!({
            "fx": "end",
            "id": done.start.id,
            "pointerType": done.start.kind.name(),
            "pressure": done.start.pressure,
            "timeStamp": done.start.time_stamp,
            "continued": done.start.continued,
            "role": done.start.role.name(),
            "samples": samples_json(&done.samples),
            "tilt": done.tilt,
            "split": done.split,
        }),
        Effect::Cancel { id, reason } => {
            json!({"fx": "cancel", "id": id, "reason": reason.name()})
        }
    }
}

/// Un numero come testo, perché JSON non scrive `NaN` né l'infinito.
fn number_json(value: f64) -> Value {
    if value.is_nan() {
        json!("NaN")
    } else if value == f64::INFINITY {
        json!("Infinity")
    } else if value == f64::NEG_INFINITY {
        json!("-Infinity")
    } else {
        json!(value)
    }
}

/// L'evento come lo scrive la fixture. Un campo al valore di un dispositivo
/// senza sensori (`PointerSample::new`) non si scrive: il lettore lo rimette,
/// e la fixture resta leggibile.
pub fn pointer_json(e: &PointerSample) -> Value {
    let mut object = Map::new();
    object.insert("pointerId".into(), json!(e.pointer_id));
    object.insert("pointerType".into(), json!(e.kind.name()));
    object.insert("x".into(), number_json(e.x));
    object.insert("y".into(), number_json(e.y));
    object.insert("timeStamp".into(), number_json(e.time));
    // `NaN != 0.5`: una pressione che non è un numero si scrive.
    if e.pressure != 0.5 {
        object.insert("pressure".into(), number_json(e.pressure));
    }
    let tilt = [
        ("tiltX", e.tilt.tilt_x),
        ("tiltY", e.tilt.tilt_y),
        ("altitudeAngle", e.tilt.altitude),
        ("azimuthAngle", e.tilt.azimuth),
    ];
    for (key, value) in tilt {
        if let Some(value) = value {
            object.insert(key.into(), number_json(value));
        }
    }
    if e.twist != 0.0 {
        object.insert("twist".into(), number_json(e.twist));
    }
    if e.buttons != 1 {
        object.insert("buttons".into(), json!(e.buttons));
    }
    if e.button != 0 {
        object.insert("button".into(), json!(e.button));
    }
    if e.view.turn != 0.0 {
        object.insert("turn".into(), number_json(e.view.turn));
    }
    if e.view.scale != 1.0 {
        object.insert("scale".into(), number_json(e.view.scale));
    }
    Value::Object(object)
}

pub fn step_json(step: &Step) -> Value {
    match step {
        Step::Down(e) => json!({"op": "down", "event": pointer_json(e)}),
        Step::Move {
            coalesced,
            event,
            predicted,
        } => json!({
            "op": "move",
            "coalesced": coalesced.iter().map(pointer_json).collect::<Vec<_>>(),
            "event": pointer_json(event),
            "predicted": predicted.iter().map(pointer_json).collect::<Vec<_>>(),
        }),
        Step::Up(e) => json!({"op": "up", "event": pointer_json(e)}),
        Step::PointerCancel(id) => json!({"op": "pointercancel", "pointer": id}),
        Step::LostCapture(id) => json!({"op": "lostcapture", "pointer": id}),
        Step::Leave(id, kind) => {
            json!({"op": "leave", "pointer": id, "pointerType": kind.name()})
        }
        Step::Interrupt(reason) => json!({"op": "interrupt", "reason": reason.name()}),
        Step::Cancel => json!({"op": "cancel"}),
        Step::Destroy => json!({"op": "destroy"}),
        Step::Touch(policy) => json!({"op": "touch", "policy": policy.name()}),
    }
}

pub fn config_json(c: &SessionConfig) -> Value {
    json!({
        "touch": c.touch.name(),
        "maxSamples": c.max_samples,
        "curve": c.curve.map(|curve| json!({"soft": curve.soft, "min": curve.min, "full": curve.full})),
        "stabilizer": {
            "amount": c.stabilizer.amount,
            "pulledString": c.stabilizer.pulled_string,
            "catchUp": c.stabilizer.catch_up,
            "catchUpOnEnd": c.stabilizer.catch_up_on_end,
        },
    })
}

/// Lo scenario con la risposta di Rust, nella forma della fixture: gli eventi in
/// `steps`, e per ciascuno, in `out`, gli effetti, i ruoli e lo stato.
pub fn scenario_json(script: &Script) -> Value {
    let trace = run(script);
    let out: Vec<Value> = (0..script.steps.len())
        .map(|i| {
            let roles: Map<String, Value> = trace.roles[i]
                .iter()
                .map(|(id, role)| {
                    (
                        id.to_string(),
                        role.map_or(Value::Null, |r| json!(r.name())),
                    )
                })
                .collect();
            json!({
                "effects": trace.effects[i].iter().map(effect_json).collect::<Vec<_>>(),
                "roles": roles,
                "drawing": trace.states[i].0,
                "penSeen": trace.states[i].1,
            })
        })
        .collect();
    json!({
        "name": script.name,
        "config": config_json(&script.config),
        "steps": script.steps.iter().map(step_json).collect::<Vec<_>>(),
        "out": out,
    })
}
