//! `fub-ink` dietro un'interfaccia C, per misurarlo in WebAssembly.
//!
//! È il banco della misura di T17 (piano N3): `apps/client/src/ink/wasm.bench.ts`
//! carica il modulo e passa al riduttore ([`Session`]) gli stessi tratti che
//! `pipeline.bench.ts` passa alla copia TypeScript. La shell non lo usa.
//!
//! # Il confine
//!
//! Niente `wasm-bindgen`: il modulo esporta funzioni `extern "C"` con numeri
//! soltanto, e i campioni passano dalla memoria lineare come `f64`.
//!
//! - **Dentro.** [`ink_input`] prepara il buffer d'ingresso per `n` campioni e
//!   ne dà l'indirizzo; chi chiama ci scrive i campioni, [`FIELDS`] numeri
//!   ciascuno nell'ordine di [`decode`], e poi chiama un evento.
//! - **Fuori.** Ogni evento scrive i suoi effetti nel buffer d'uscita, che
//!   [`ink_output`] e [`ink_output_len`] descrivono (il formato è in
//!   [`encode`]), e restituisce quanti sono.
//!
//! I due buffer sono `Vec` del modulo: l'host scrive e legge memoria che il
//! modulo possiede già, quindi qui non serve nessun `unsafe`. Un indirizzo
//! vale fino alla chiamata successiva, che può far crescere la memoria:
//! l'host lo rilegge ogni volta.
//!
//! Le sessioni sono maniglie: un numero da 1 in su, 0 se la configurazione è
//! sbagliata. Una maniglia sconosciuta dà [`UNKNOWN`] invece di un conto.

use std::cell::RefCell;

use fub_ink::{
    CancelReason, Effect, PointerKind, PointerRole, PointerSample, Sample, Session, SessionConfig,
    StabilizerConfig, StrokeStart, Tilt, View,
};

/// Quanti `f64` occupa un campione del puntatore nel buffer d'ingresso.
pub const FIELDS: usize = 15;

/// Il conto che restituisce un evento su una maniglia che non esiste.
pub const UNKNOWN: u32 = u32::MAX;

#[derive(Default)]
struct State {
    sessions: Vec<Option<Session>>,
    input: Vec<f64>,
    output: Vec<f64>,
    coalesced: Vec<PointerSample>,
    predicted: Vec<PointerSample>,
}

thread_local! {
    // `wasm32-unknown-unknown` ha un filo solo: è lo stato del modulo.
    static STATE: RefCell<State> = RefCell::new(State::default());
}

/// Un numero dell'host come facoltativo: `NaN` è «assente».
fn optional(value: f64) -> Option<f64> {
    if value.is_nan() {
        None
    } else {
        Some(value)
    }
}

/// Un facoltativo verso l'host: «assente» è `NaN`.
fn number(value: Option<f64>) -> f64 {
    value.unwrap_or(f64::NAN)
}

fn flag(value: bool) -> f64 {
    if value {
        1.0
    } else {
        0.0
    }
}

/// Il campione `index` del buffer d'ingresso. L'ordine dei campi: `pointerId`,
/// tipo (0 mouse, 1 penna, 2 tocco), `x`, `y`, pressione, `tiltX`, `tiltY`,
/// altitudine, azimut (`NaN` se mancano), rotazione, `buttons`, `button`,
/// tempo, rotazione e scala della vista. `None` se il buffer è più corto.
fn decode(input: &[f64], index: usize) -> Option<PointerSample> {
    let f = input.get(index * FIELDS..(index + 1) * FIELDS)?;
    let kind = match f[1] as u32 {
        1 => PointerKind::Pen,
        2 => PointerKind::Touch,
        _ => PointerKind::Mouse,
    };
    Some(PointerSample {
        pointer_id: f[0] as i64,
        kind,
        x: f[2],
        y: f[3],
        pressure: f[4],
        tilt: Tilt {
            tilt_x: optional(f[5]),
            tilt_y: optional(f[6]),
            altitude: optional(f[7]),
            azimuth: optional(f[8]),
        },
        twist: f[9],
        buttons: f[10] as u32,
        button: f[11] as i32,
        time: f[12],
        view: View {
            turn: f[13],
            scale: f[14],
        },
    })
}

fn kind_code(kind: PointerKind) -> f64 {
    match kind {
        PointerKind::Mouse => 0.0,
        PointerKind::Pen => 1.0,
        PointerKind::Touch => 2.0,
    }
}

fn role_code(role: PointerRole) -> f64 {
    match role {
        PointerRole::Ink => 0.0,
        PointerRole::Erase => 1.0,
        PointerRole::Barrel => 2.0,
        PointerRole::Navigate => 3.0,
        PointerRole::Ignore => 4.0,
    }
}

fn reason_code(reason: CancelReason) -> f64 {
    match reason {
        CancelReason::PointerCancel => 0.0,
        CancelReason::LostCapture => 1.0,
        CancelReason::Blur => 2.0,
        CancelReason::Hidden => 3.0,
        CancelReason::Palm => 4.0,
        CancelReason::Gesture => 5.0,
        CancelReason::Api => 6.0,
        CancelReason::Destroy => 7.0,
    }
}

fn encode_start(start: &StrokeStart, out: &mut Vec<f64>) {
    out.extend_from_slice(&[
        f64::from(start.id),
        kind_code(start.kind),
        flag(start.pressure),
        start.time_stamp,
        flag(start.continued),
        role_code(start.role),
    ]);
}

/// Sei numeri per campione: `x`, `y`, `p`, `t`, altitudine, azimut.
fn encode_samples(samples: &[Sample], out: &mut Vec<f64>) {
    out.push(samples.len() as f64);
    for s in samples {
        let (altitude, azimuth) = match s.tilt {
            Some((a, b)) => (a, b),
            None => (f64::NAN, f64::NAN),
        };
        out.extend_from_slice(&[s.x, s.y, number(s.p), s.t, altitude, azimuth]);
    }
}

/// Gli effetti nel buffer d'uscita, uno dopo l'altro, ognuno col suo codice:
///
/// - `0, puntatore` cattura; `1, puntatore` rilascia;
/// - `2, id, tipo, pressione, tempo, continua, ruolo` l'inizio;
/// - `3, id, n, n × 6` campioni; `4, id, n, n × 6` la predizione;
/// - `5`, l'inizio come sopra, `tilt, diviso, n, n × 6` la fine;
/// - `6, id, motivo` l'annullamento.
fn encode(effects: &[Effect], out: &mut Vec<f64>) {
    for effect in effects {
        match effect {
            Effect::Capture(id) => out.extend_from_slice(&[0.0, *id as f64]),
            Effect::Release(id) => out.extend_from_slice(&[1.0, *id as f64]),
            Effect::Start(start) => {
                out.push(2.0);
                encode_start(start, out);
            }
            Effect::Samples { id, samples } => {
                out.extend_from_slice(&[3.0, f64::from(*id)]);
                encode_samples(samples, out);
            }
            Effect::Predicted { id, samples } => {
                out.extend_from_slice(&[4.0, f64::from(*id)]);
                encode_samples(samples, out);
            }
            Effect::End(stroke) => {
                out.push(5.0);
                encode_start(&stroke.start, out);
                out.extend_from_slice(&[flag(stroke.tilt), flag(stroke.split)]);
                encode_samples(&stroke.samples, out);
            }
            Effect::Cancel { id, reason } => {
                out.extend_from_slice(&[6.0, f64::from(*id), reason_code(*reason)]);
            }
        }
    }
}

/// Il conto degli effetti come lo vuole l'host.
fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(UNKNOWN - 1)
}

/// Ciò che un evento può usare mentre lavora: il buffer d'ingresso e le due
/// liste d'appoggio dei coalescenti e dei predetti, che restano allocate da un
/// evento all'altro.
struct Work<'a> {
    input: &'a [f64],
    coalesced: &'a mut Vec<PointerSample>,
    predicted: &'a mut Vec<PointerSample>,
}

impl Work<'_> {
    /// Il campione `index` del buffer d'ingresso.
    fn sample(&self, index: usize) -> Option<PointerSample> {
        decode(self.input, index)
    }

    /// Un `pointermove` che comincia al campione `at`: `c` coalescenti,
    /// l'evento, `p` predetti.
    fn pointer_move(
        &mut self,
        session: &mut Session,
        at: usize,
        c: usize,
        p: usize,
    ) -> Option<Vec<Effect>> {
        self.coalesced.clear();
        for i in at..at + c {
            self.coalesced.push(decode(self.input, i)?);
        }
        let event = decode(self.input, at + c)?;
        self.predicted.clear();
        for i in at + c + 1..at + c + 1 + p {
            self.predicted.push(decode(self.input, i)?);
        }
        Some(session.pointer_move(self.coalesced, &event, self.predicted))
    }
}

/// Fa girare `run` sulla sessione `handle`. Il buffer d'uscita si svuota e
/// riceve ciò che `run` restituisce come effetti da scrivere; il risultato è
/// il conto che `run` dà, o [`UNKNOWN`] se la maniglia non c'è o il buffer
/// d'ingresso è troppo corto per l'evento.
fn on_session(
    handle: u32,
    run: impl FnOnce(&mut Session, &mut Work<'_>) -> Option<(Vec<Effect>, usize)>,
) -> u32 {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let State {
            sessions,
            input,
            output,
            coalesced,
            predicted,
        } = &mut *state;
        output.clear();
        let Some(session) = (handle as usize)
            .checked_sub(1)
            .and_then(|i| sessions.get_mut(i))
            .and_then(Option::as_mut)
        else {
            return UNKNOWN;
        };
        let mut work = Work {
            input,
            coalesced,
            predicted,
        };
        match run(session, &mut work) {
            Some((effects, n)) => {
                encode(&effects, output);
                count(n)
            }
            None => UNKNOWN,
        }
    })
}

/// Un evento normale: gli effetti si scrivono e il conto è quanti sono.
fn written(effects: Vec<Effect>) -> (Vec<Effect>, usize) {
    let n = effects.len();
    (effects, n)
}

/// Prepara il buffer d'ingresso per `samples` campioni e ne dà l'indirizzo:
/// è l'allocatore del confine, e l'host ci copia i campioni prima dell'evento.
#[no_mangle]
pub extern "C" fn ink_input(samples: u32) -> *mut f64 {
    STATE.with(|state| {
        let input = &mut state.borrow_mut().input;
        input.resize(samples as usize * FIELDS, 0.0);
        input.as_mut_ptr()
    })
}

/// L'indirizzo del buffer d'uscita.
#[no_mangle]
pub extern "C" fn ink_output() -> *const f64 {
    STATE.with(|state| state.borrow().output.as_ptr())
}

/// Quanti `f64` ha scritto l'ultimo evento nel buffer d'uscita.
#[no_mangle]
pub extern "C" fn ink_output_len() -> u32 {
    STATE.with(|state| count(state.borrow().output.len()))
}

/// Una sessione nuova con lo stabilizzatore dato e il resto ai valori di
/// partenza; 0 se la configurazione non va.
#[no_mangle]
pub extern "C" fn ink_session_new(
    amount: f64,
    pulled_string: u32,
    catch_up: u32,
    catch_up_on_end: u32,
) -> u32 {
    let config = SessionConfig {
        stabilizer: StabilizerConfig {
            amount,
            pulled_string: pulled_string != 0,
            catch_up: catch_up != 0,
            catch_up_on_end: catch_up_on_end != 0,
        },
        ..SessionConfig::default()
    };
    let Ok(session) = Session::new(config) else {
        return 0;
    };
    STATE.with(|state| {
        let sessions = &mut state.borrow_mut().sessions;
        let slot = match sessions.iter().position(Option::is_none) {
            Some(free) => free,
            None => {
                sessions.push(None);
                sessions.len() - 1
            }
        };
        sessions[slot] = Some(session);
        count(slot + 1)
    })
}

/// Chiude la sessione `handle`; una maniglia sconosciuta non fa niente.
#[no_mangle]
pub extern "C" fn ink_session_free(handle: u32) {
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        if let Some(slot) = (handle as usize)
            .checked_sub(1)
            .and_then(|i| state.sessions.get_mut(i))
        {
            *slot = None;
        }
    });
}

/// `pointerdown` col campione 0 del buffer d'ingresso.
#[no_mangle]
pub extern "C" fn ink_pointer_down(handle: u32) -> u32 {
    on_session(handle, |session, work| {
        Some(written(session.pointer_down(&work.sample(0)?)))
    })
}

/// `pointerup` col campione 0 del buffer d'ingresso.
#[no_mangle]
pub extern "C" fn ink_pointer_up(handle: u32) -> u32 {
    on_session(handle, |session, work| {
        Some(written(session.pointer_up(&work.sample(0)?)))
    })
}

/// `pointermove`: nel buffer d'ingresso prima i `coalesced` coalescenti, poi
/// l'evento, poi i `predicted` predetti.
#[no_mangle]
pub extern "C" fn ink_pointer_move(handle: u32, coalesced: u32, predicted: u32) -> u32 {
    on_session(handle, |session, work| {
        Some(written(work.pointer_move(
            session,
            0,
            coalesced as usize,
            predicted as usize,
        )?))
    })
}

/// Un tratto intero in una chiamata sola: nel buffer d'ingresso il campione
/// di `pointerdown`, poi `moves` movimenti (ognuno coi suoi `coalesced`
/// coalescenti, l'evento e i `predicted` predetti), poi quello di `pointerup`.
/// Restituisce quanti effetti ci sono stati e non ne scrive nessuno: misura il
/// riduttore senza il confine.
#[no_mangle]
pub extern "C" fn ink_run_flow(handle: u32, moves: u32, coalesced: u32, predicted: u32) -> u32 {
    let (c, p) = (coalesced as usize, predicted as usize);
    on_session(handle, |session, work| {
        let mut effects = session.pointer_down(&work.sample(0)?).len();
        let mut at = 1;
        for _ in 0..moves {
            effects += work.pointer_move(session, at, c, p)?.len();
            at += c + 1 + p;
        }
        effects += session.pointer_up(&work.sample(at)?).len();
        Some((Vec::new(), effects))
    })
}

/// Il confine senza il riduttore: legge `samples` campioni dal buffer
/// d'ingresso e li riscrive in quello d'uscita come campioni del tratto (sei
/// numeri ciascuno, preceduti dal conto). Misura le copie e la decodifica.
#[no_mangle]
pub extern "C" fn ink_echo(samples: u32) -> u32 {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let State { input, output, .. } = &mut *state;
        output.clear();
        output.push(f64::from(samples));
        for i in 0..samples as usize {
            let Some(s) = decode(input, i) else {
                return UNKNOWN;
            };
            output.extend_from_slice(&[
                s.x,
                s.y,
                s.pressure,
                s.time,
                number(s.tilt.altitude),
                number(s.tilt.azimuth),
            ]);
        }
        samples
    })
}
