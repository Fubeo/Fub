//! Il ciclo di vita del tratto: dai campioni del puntatore ai tratti.
//!
//! Una [`Session`] riceve i campioni di una superficie, uno scenario di eventi
//! alla volta, e restituisce gli [`Effect`] che ne seguono: l'inizio di un
//! tratto, i campioni, la predizione, la fine, l'annullamento, e le due
//! richieste alla piattaforma (catturare il puntatore, rilasciarlo). Non
//! disegna e non conosce strumenti, camera, DOM o prodotti: le coordinate
//! arrivano già nello spazio del tratto, e gli effetti vanno a chi disegna
//! l'anteprima e a chi scrive il tratto.
//!
//! È un riduttore puro: lo stesso scenario dà gli stessi effetti, sempre. Lo
//! scrivono due volte, questo crate e `apps/client/src/ink/input/session.ts`,
//! e un file di scenari (`apps/client/src/ink/__fixtures__/ink-samples.json`)
//! generato da qui obbliga la copia TypeScript a rispondere come Rust.
//!
//! Le regole:
//!
//! - **Subito.** I campioni nuovi si consegnano dentro l'evento che li porta,
//!   mai dopo: l'anteprima li disegna appena arrivano.
//! - **Tutti i campioni.** Gli eventi coalescenti entrano nell'ordine in cui
//!   sono avvenuti; un doppione (stesso istante, stessi valori) o un evento
//!   più vecchio dell'ultimo accettato si scarta. Gli eventi predetti vanno
//!   solo all'anteprima, e ogni volta sostituiscono la predizione precedente.
//!   Non entrano mai nel tratto.
//! - **Niente tratti a metà.** `pointercancel`, la perdita della cattura, la
//!   finestra che perde il fuoco, la pagina nascosta, un palmo riconosciuto
//!   tardi, un secondo dito, un `pointerup` perso e la distruzione annullano il
//!   tratto intero: a [`Effect::End`] arriva solo un tratto concluso alzando il
//!   puntatore (o il tasto principale del mouse) o chiuso al limite dei
//!   campioni.
//! - **La penna preme.** Una penna appoggiata con pressione 0 non disegna
//!   finché non preme; una penna sospesa non disegna mai. Il mouse disegna col
//!   tasto principale, senza canale di pressione: il pennello la simula. Lo
//!   stesso per il dito.
//! - **La penna ha tre tratti.** La punta fa il tratto dell'inchiostro, la
//!   gomma della penna girata e il tasto laterale fanno il loro, che
//!   [`StrokeStart::role`] distingue: chi disegna decide che cosa farne. Ogni
//!   tratto vive finché è premuto il suo tasto (il bit 1, 32 o 2 di
//!   `buttons`).
//! - **Il palmo non disegna.** I ruoli dei puntatori sono quelli di
//!   [`crate::roles`].
//! - **Al massimo `max_samples` campioni.** Oltre, il tratto si chiude e ne
//!   comincia un altro dallo stesso punto, senza buchi: l'ultimo campione del
//!   primo è il primo del secondo, con `t = 0`. Il primo finisce con
//!   `split: true`, il secondo comincia con `continued: true`.
//! - **Un tocco è un segno.** Un tocco senza movimento ha due campioni nello
//!   stesso punto: di un punto solo il contorno del tratto farebbe un
//!   trattino verso destra e in basso.
//!
//! I campioni hanno `x` e `y` nello spazio del tratto, `t` in millisecondi dal
//! primo campione, `p` 0…1 per la penna, e l'inclinazione quando la penna la
//! dà. L'inclinazione è del tratto: se nessun campione ne ha dato una vera, il
//! tratto concluso non la porta.
//!
//! La pressione scritta è quella che la curva di chi disegna dà alla pressione
//! della penna: il file porta il tratto come si è visto. L'azimut si misura
//! dall'asse x della scena: su un foglio girato si toglie l'angolo della vista.
//!
//! Con uno stabilizzatore acceso ([`SessionConfig::stabilizer`]) i campioni
//! del tratto sono quelli del pennino e non quelli del puntatore, e la
//! predizione non si consegna: sarebbe davanti a un pennino che sta indietro.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::pointer::{PointerKind, PointerSample};
use crate::pressure::PenCurve;
use crate::roles::{classify_pointer, PointerRole, RoleContext, TouchPolicy};
use crate::sample::{Sample, MAX_SAMPLES};
use crate::stabilizer::{Stabilizer, StabilizerConfig};
use crate::tilt::{pen_angles, reports_tilt, PenAngles};

/// L'inizio di un tratto.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct StrokeStart {
    /// Unico per questa sessione, crescente.
    pub id: u32,
    pub kind: PointerKind,
    /// Il tratto ha il canale `p`: vero solo per la penna. Senza, il pennello
    /// simula la pressione.
    pub pressure: bool,
    /// Il tempo del primo campione.
    pub time_stamp: f64,
    /// Il tratto continua quello appena chiuso al limite dei campioni.
    pub continued: bool,
    /// Chi fa il tratto: la punta ([`PointerRole::Ink`]), la gomma della
    /// penna girata o il tasto laterale.
    pub role: PointerRole,
}

/// Un tratto concluso alzando il puntatore, o chiuso al limite dei campioni.
#[derive(Clone, Debug, PartialEq)]
pub struct FinishedStroke {
    pub start: StrokeStart,
    /// I campioni del tratto, da 1 a `max_samples`; il primo ha `t = 0`.
    pub samples: Vec<Sample>,
    /// I campioni portano l'inclinazione.
    pub tilt: bool,
    /// Il tratto è stato chiuso al limite e continua in quello successivo.
    pub split: bool,
}

/// Perché un tratto è stato annullato.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CancelReason {
    PointerCancel,
    LostCapture,
    Blur,
    Hidden,
    Palm,
    Gesture,
    Api,
    Destroy,
}

impl CancelReason {
    /// Il nome della ragione, lo stesso che usa il lato TypeScript.
    pub fn name(self) -> &'static str {
        match self {
            CancelReason::PointerCancel => "pointercancel",
            CancelReason::LostCapture => "lostcapture",
            CancelReason::Blur => "blur",
            CancelReason::Hidden => "hidden",
            CancelReason::Palm => "palm",
            CancelReason::Gesture => "gesture",
            CancelReason::Api => "api",
            CancelReason::Destroy => "destroy",
        }
    }
}

/// Che cosa succede in seguito a un evento, nell'ordine in cui accade.
#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    /// Chiedere alla piattaforma di catturare il puntatore.
    Capture(i64),
    /// Chiedere alla piattaforma di rilasciarlo.
    Release(i64),
    Start(StrokeStart),
    /// Campioni nuovi del tratto, nell'ordine, da aggiungere a quelli già dati.
    Samples {
        id: u32,
        samples: Vec<Sample>,
    },
    /// La predizione corrente: sostituisce la precedente; vuota la cancella.
    Predicted {
        id: u32,
        samples: Vec<Sample>,
    },
    End(FinishedStroke),
    /// Il tratto non esiste più: l'anteprima si cancella, niente si scrive.
    Cancel {
        id: u32,
        reason: CancelReason,
    },
}

/// Come si comporta una sessione.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct SessionConfig {
    /// Che cosa fa un dito quando nessuna penna è vicina.
    pub touch: TouchPolicy,
    /// Campioni per tratto prima di dividerlo, da 2 a [`MAX_SAMPLES`].
    pub max_samples: usize,
    /// La curva della pressione della penna; senza, la pressione è com'è.
    pub curve: Option<PenCurve>,
    /// Lo stabilizzatore dei tratti che cominciano da adesso.
    pub stabilizer: StabilizerConfig,
}

impl Default for SessionConfig {
    fn default() -> SessionConfig {
        SessionConfig {
            touch: TouchPolicy::Auto,
            max_samples: MAX_SAMPLES,
            curve: None,
            stabilizer: StabilizerConfig::default(),
        }
    }
}

/// Una configurazione che non si può usare.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ConfigError {
    /// `max_samples` fuori da 2…[`MAX_SAMPLES`]. Con meno di due campioni la
    /// continuazione, che parte dal punto di giunzione, sarebbe di nuovo
    /// piena: un ciclo senza fine.
    MaxSamples(usize),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::MaxSamples(n) => {
                write!(f, "maxSamples fuori da 2…{MAX_SAMPLES}: {n}")
            }
        }
    }
}

impl std::error::Error for ConfigError {}

struct PointerEntry {
    kind: PointerKind,
    role: PointerRole,
}

struct Stroke {
    pointer_id: i64,
    kind: PointerKind,
    /// Chi fa il tratto; il suo bit di `buttons` lo tiene vivo.
    role: PointerRole,
    pressure: bool,
    continued: bool,
    /// `None` finché il tratto non è annunciato con [`Effect::Start`]: una
    /// penna appoggiata senza pressione.
    id: Option<u32>,
    /// Il tempo del primo campione.
    origin: f64,
    samples: Vec<Sample>,
    /// L'ultimo evento accettato, per riconoscere i doppioni.
    last: Option<PointerSample>,
    tilt: bool,
    /// Una predizione non vuota è stata consegnata e non ancora cancellata.
    predicted: bool,
    stabilizer: Stabilizer,
}

/// Il ciclo di vita dei tratti di una superficie.
pub struct Session {
    max_samples: usize,
    touch: TouchPolicy,
    curve: Option<PenCurve>,
    stabilizer: StabilizerConfig,
    /// I puntatori giù su questa superficie, col loro ruolo.
    pointers: BTreeMap<i64, PointerEntry>,
    /// Le penne sospese sopra la superficie o appoggiate.
    near_pens: BTreeSet<i64>,
    pen_seen: bool,
    stroke: Option<Stroke>,
    next_id: u32,
    destroyed: bool,
    effects: Vec<Effect>,
}

/// Due campioni dello stesso istante con gli stessi valori sono lo stesso
/// campione, consegnato due volte.
fn same_sample(a: &PointerSample, b: &PointerSample) -> bool {
    a.x == b.x && a.y == b.y && a.pressure == b.pressure && a.tilt == b.tilt
}

/// La pressione di un campione, entro 0…1. Pointer Events vuole 0,5 per un
/// dispositivo senza pressione: è anche il ripiego per un valore che un motore
/// non sa dare.
fn pressure_of(sample: &PointerSample) -> f64 {
    if sample.pressure.is_finite() {
        sample.pressure.clamp(0.0, 1.0)
    } else {
        0.5
    }
}

impl Session {
    /// Una sessione con la configurazione `config`.
    pub fn new(config: SessionConfig) -> Result<Session, ConfigError> {
        if config.max_samples < 2 || config.max_samples > MAX_SAMPLES {
            return Err(ConfigError::MaxSamples(config.max_samples));
        }
        Ok(Session {
            max_samples: config.max_samples,
            touch: config.touch,
            curve: config.curve,
            stabilizer: config.stabilizer,
            pointers: BTreeMap::new(),
            near_pens: BTreeSet::new(),
            pen_seen: false,
            stroke: None,
            next_id: 1,
            destroyed: false,
            effects: Vec::new(),
        })
    }

    /// Il ruolo di un puntatore giù su questa superficie, `None` se non c'è.
    /// Può cambiare mentre il puntatore è giù: un dito diventa palmo quando
    /// arriva la penna, un dito che disegnava diventa navigazione quando se ne
    /// appoggia un secondo.
    pub fn role_of(&self, pointer_id: i64) -> Option<PointerRole> {
        self.pointers.get(&pointer_id).map(|entry| entry.role)
    }

    /// Su questa superficie si è vista una penna.
    pub fn pen_seen(&self) -> bool {
        self.pen_seen
    }

    /// Un tratto è in corso.
    pub fn drawing(&self) -> bool {
        self.stroke.as_ref().is_some_and(|s| s.id.is_some())
    }

    /// Il tratto in corso, annunciato o no, è di questo puntatore: chi adatta
    /// una piattaforma lo chiede per non raccogliere eventi coalescenti e
    /// predetti di un puntatore che non disegna.
    pub fn tracks(&self, pointer_id: i64) -> bool {
        self.stroke
            .as_ref()
            .is_some_and(|s| s.pointer_id == pointer_id)
    }

    pub fn set_touch_policy(&mut self, policy: TouchPolicy) {
        self.touch = policy;
    }

    /// La curva della pressione per i campioni da adesso.
    pub fn set_curve(&mut self, curve: Option<PenCurve>) {
        self.curve = curve;
    }

    /// Lo stabilizzatore dei tratti che cominciano da adesso; quello di un
    /// tratto in corso non cambia.
    pub fn set_stabilizer(&mut self, config: StabilizerConfig) {
        self.stabilizer = config;
    }

    /// Un puntatore si appoggia.
    pub fn pointer_down(&mut self, event: &PointerSample) -> Vec<Effect> {
        if self.destroyed {
            return Vec::new();
        }
        // Lo stesso puntatore giù una seconda volta vuol dire che il suo
        // `pointerup` si è perso: un tasto in più del mouse non manda
        // `pointerdown`, e penna e dito si alzano prima di riappoggiarsi. La
        // fine del tratto non si è vista, quindi il tratto si annulla.
        if self
            .stroke
            .as_ref()
            .is_some_and(|s| s.pointer_id == event.pointer_id)
        {
            self.cancel_stroke(CancelReason::LostCapture);
        }
        let kind = event.kind;
        if kind == PointerKind::Pen {
            self.note_pen(event.pointer_id);
        }
        let mut role = classify_pointer(
            kind,
            event.button,
            &RoleContext {
                touch: self.touch,
                pen_seen: self.pen_seen,
                pen_near: self.pen_near(),
                touches_down: self.touches_down(),
            },
        );
        // Un secondo dito: il primo smette di disegnare e diventa navigazione.
        if kind == PointerKind::Touch && role == PointerRole::Navigate {
            let first = self
                .stroke
                .as_ref()
                .filter(|s| s.kind == PointerKind::Touch)
                .map(|s| s.pointer_id);
            if let Some(first) = first {
                if let Some(entry) = self.pointers.get_mut(&first) {
                    entry.role = PointerRole::Navigate;
                }
                self.cancel_stroke(CancelReason::Gesture);
            }
        }
        // Un tratto alla volta.
        if role.strokes() && self.stroke.is_some() {
            role = PointerRole::Ignore;
        }
        self.pointers
            .insert(event.pointer_id, PointerEntry { kind, role });
        if !role.strokes() {
            return self.take_effects();
        }
        self.effects.push(Effect::Capture(event.pointer_id));
        let mut stroke = Stroke {
            pointer_id: event.pointer_id,
            kind,
            role,
            pressure: kind == PointerKind::Pen,
            continued: false,
            id: None,
            origin: event.time,
            samples: Vec::new(),
            last: None,
            tilt: false,
            predicted: false,
            stabilizer: Stabilizer::new(self.stabilizer, event.view.scale),
        };
        self.feed(&mut stroke, std::slice::from_ref(event));
        self.stroke = Some(stroke);
        self.take_effects()
    }

    /// Un puntatore si muove: `coalesced` sono gli eventi che il motore ha
    /// riunito in `event`, nell'ordine in cui sono avvenuti, e `predicted`
    /// quelli che prevede. Una piattaforma che non li dà passa liste vuote.
    pub fn pointer_move(
        &mut self,
        coalesced: &[PointerSample],
        event: &PointerSample,
        predicted: &[PointerSample],
    ) -> Vec<Effect> {
        if self.destroyed {
            return Vec::new();
        }
        if event.kind == PointerKind::Pen {
            self.note_pen(event.pointer_id);
        }
        let mut stroke = match self.take_stroke_of(event.pointer_id) {
            Some(stroke) => stroke,
            None => return self.take_effects(),
        };
        // Il tasto del tratto rilasciato con un altro ancora premuto non manda
        // `pointerup`: il tratto finisce qui.
        if event.buttons & stroke.role.button_mask() == 0 {
            self.finish(stroke, Vec::new(), None);
            return self.take_effects();
        }
        // L'evento stesso in coda: dove la lista lo contiene già è un doppione
        // e si scarta, dove non lo contiene è l'ultimo campione.
        let mut events: Vec<PointerSample> = coalesced.to_vec();
        events.push(*event);
        self.feed(&mut stroke, &events);
        self.predict(&mut stroke, predicted);
        self.stroke = Some(stroke);
        self.take_effects()
    }

    /// Un puntatore si alza.
    pub fn pointer_up(&mut self, event: &PointerSample) -> Vec<Effect> {
        if self.destroyed {
            return Vec::new();
        }
        self.pointers.remove(&event.pointer_id);
        let mut stroke = match self.take_stroke_of(event.pointer_id) {
            Some(stroke) => stroke,
            None => return self.take_effects(),
        };
        if stroke.id.is_none() {
            self.finish(stroke, Vec::new(), None);
            return self.take_effects();
        }
        // `pointerup` ha la posizione finale ma pressione 0: se il puntatore si
        // è mosso dopo l'ultimo campione, l'ultimo punto prende pressione e
        // inclinazione del campione prima.
        //
        // Un tocco senza movimento avrebbe un campione solo, e di un punto
        // solo il contorno farebbe un trattino verso destra e in basso. Con il
        // campione dell'alzata, anche nello stesso punto, i campioni sono due
        // e il segno è un punto tondo centrato dove si è toccato.
        let mut batch = Vec::new();
        let moved = match &stroke.last {
            None => true,
            Some(last) => stroke.samples.len() == 1 || event.x != last.x || event.y != last.y,
        };
        let fresh = match &stroke.last {
            None => true,
            Some(last) => event.time >= last.time,
        };
        let mut lifted = None;
        if moved && fresh && event.x.is_finite() && event.y.is_finite() && event.time.is_finite() {
            let carry = stroke.samples.last().copied();
            let sample = self.sample_of(&stroke, event, carry.as_ref());
            self.accept(&mut stroke, sample, &mut batch);
            stroke.last = Some(*event);
            lifted = Some(sample);
        }
        self.finish(stroke, batch, lifted);
        self.take_effects()
    }

    /// Il motore annulla un puntatore (`pointercancel`).
    pub fn pointer_cancel(&mut self, pointer_id: i64) -> Vec<Effect> {
        if self.destroyed {
            return Vec::new();
        }
        self.pointers.remove(&pointer_id);
        self.near_pens.remove(&pointer_id);
        if self
            .stroke
            .as_ref()
            .is_some_and(|s| s.pointer_id == pointer_id)
        {
            self.cancel_stroke(CancelReason::PointerCancel);
        }
        self.take_effects()
    }

    /// La superficie perde la cattura del puntatore.
    pub fn lost_capture(&mut self, pointer_id: i64) -> Vec<Effect> {
        if self.destroyed {
            return Vec::new();
        }
        if self
            .stroke
            .as_ref()
            .is_some_and(|s| s.pointer_id == pointer_id)
        {
            self.cancel_stroke(CancelReason::LostCapture);
        }
        self.take_effects()
    }

    /// Un puntatore esce dalla superficie. Una penna lo manda anche quando esce
    /// dal raggio di hover.
    pub fn pointer_leave(&mut self, pointer_id: i64, kind: PointerKind) {
        if !self.destroyed && kind == PointerKind::Pen {
            self.near_pens.remove(&pointer_id);
        }
    }

    /// La finestra o la pagina non ricevono più eventi: il tratto si annulla, e
    /// i puntatori ricordati non sono più affidabili.
    pub fn interrupt(&mut self, reason: CancelReason) -> Vec<Effect> {
        if self.destroyed {
            return Vec::new();
        }
        self.cancel_stroke(reason);
        self.pointers.clear();
        self.near_pens.clear();
        self.take_effects()
    }

    /// Annulla il tratto in corso ([`CancelReason::Api`]); il puntatore smette
    /// di disegnare finché non si alza.
    pub fn cancel(&mut self) -> Vec<Effect> {
        if !self.destroyed {
            self.cancel_stroke(CancelReason::Api);
        }
        self.take_effects()
    }

    /// Annulla il tratto in corso e chiude la sessione, che da qui non fa più
    /// niente. Si può chiamare più volte.
    pub fn destroy(&mut self) -> Vec<Effect> {
        if self.destroyed {
            return Vec::new();
        }
        self.destroyed = true;
        self.cancel_stroke(CancelReason::Destroy);
        self.pointers.clear();
        self.near_pens.clear();
        self.take_effects()
    }

    fn take_effects(&mut self) -> Vec<Effect> {
        std::mem::take(&mut self.effects)
    }

    /// Il tratto in corso, tolto dalla sessione, se è di questo puntatore.
    fn take_stroke_of(&mut self, pointer_id: i64) -> Option<Stroke> {
        if self
            .stroke
            .as_ref()
            .is_some_and(|s| s.pointer_id == pointer_id)
        {
            self.stroke.take()
        } else {
            None
        }
    }

    fn pen_near(&self) -> bool {
        !self.near_pens.is_empty()
            || self
                .pointers
                .values()
                .any(|entry| entry.kind == PointerKind::Pen)
    }

    fn touches_down(&self) -> usize {
        self.pointers
            .values()
            .filter(|entry| entry.kind == PointerKind::Touch && entry.role != PointerRole::Ignore)
            .count()
    }

    /// Una penna è arrivata: le dita già giù sono palmo, e un loro tratto si
    /// annulla.
    fn note_pen(&mut self, pointer_id: i64) {
        self.pen_seen = true;
        if !self.near_pens.insert(pointer_id) {
            return;
        }
        for entry in self.pointers.values_mut() {
            if entry.kind == PointerKind::Touch {
                entry.role = PointerRole::Ignore;
            }
        }
        if self
            .stroke
            .as_ref()
            .is_some_and(|s| s.kind == PointerKind::Touch)
        {
            self.cancel_stroke(CancelReason::Palm);
        }
    }

    /// Annulla il tratto in corso. Il puntatore resta giù ma non disegna più.
    fn cancel_stroke(&mut self, reason: CancelReason) {
        if let Some(stroke) = self.stroke.take() {
            self.retire(stroke.pointer_id);
            if let Some(id) = stroke.id {
                self.effects.push(Effect::Cancel { id, reason });
            }
        }
    }

    /// Il tratto non è più in corso: se il puntatore resta giù non disegna più
    /// finché non si alza, e la cattura torna al browser.
    fn retire(&mut self, pointer_id: i64) {
        if let Some(entry) = self.pointers.get_mut(&pointer_id) {
            if entry.role.strokes() {
                entry.role = PointerRole::Ignore;
            }
        }
        self.effects.push(Effect::Release(pointer_id));
    }

    /// La pressione della penna passata per la curva, entro 0…1.
    fn curved(&self, pressure: f64) -> f64 {
        match &self.curve {
            None => pressure,
            Some(curve) => {
                let out = curve.apply(pressure);
                if out.is_finite() {
                    out.clamp(0.0, 1.0)
                } else {
                    pressure
                }
            }
        }
    }

    /// Gli angoli della penna, con l'azimut dall'asse x della scena.
    fn scene_angles(&self, event: &PointerSample) -> Option<PenAngles> {
        let angles = pen_angles(&event.tilt)?;
        let turn = event.view.turn;
        if turn == 0.0 || !turn.is_finite() {
            return Some(angles);
        }
        let mut z = (angles.z - turn) % 360.0;
        if z < 0.0 {
            z += 360.0;
        }
        Some(PenAngles { a: angles.a, z })
    }

    /// Il campione di un evento, col tempo dell'evento (assoluto): entra nel
    /// tratto con [`Session::append`], che lo misura dall'origine del tratto
    /// com'è in quel momento, dopo un'eventuale divisione. `carry` presta
    /// pressione e inclinazione, per l'alzata, che per specifica ha pressione
    /// 0.
    fn sample_of(&self, stroke: &Stroke, event: &PointerSample, carry: Option<&Sample>) -> Sample {
        let t = event.time;
        if !stroke.pressure {
            return Sample {
                x: event.x,
                y: event.y,
                p: None,
                t,
                tilt: None,
            };
        }
        let p = carry
            .and_then(|c| c.p)
            .unwrap_or_else(|| self.curved(pressure_of(event)));
        let tilt = match carry {
            Some(c) => c.tilt,
            None => self.scene_angles(event).map(|angles| (angles.a, angles.z)),
        };
        Sample {
            x: event.x,
            y: event.y,
            p: Some(p),
            t,
            tilt,
        }
    }

    /// Annuncia un tratto con [`Effect::Start`].
    fn announce(&mut self, stroke: &mut Stroke) {
        let id = self.next_id;
        self.next_id += 1;
        stroke.id = Some(id);
        self.effects.push(Effect::Start(StrokeStart {
            id,
            kind: stroke.kind,
            pressure: stroke.pressure,
            time_stamp: stroke.origin,
            continued: stroke.continued,
            role: stroke.role,
        }));
    }

    fn finished(&self, stroke: &Stroke, split: bool) -> FinishedStroke {
        // L'inclinazione si scrive solo se il dispositivo l'ha data davvero, e
        // in ogni campione o in nessuno.
        let tilt = stroke.tilt && stroke.samples.iter().all(|s| s.tilt.is_some());
        let samples = if tilt || !stroke.pressure {
            stroke.samples.clone()
        } else {
            stroke
                .samples
                .iter()
                .map(|s| Sample { tilt: None, ..*s })
                .collect()
        };
        FinishedStroke {
            start: StrokeStart {
                id: stroke.id.unwrap_or(0),
                kind: stroke.kind,
                pressure: stroke.pressure,
                time_stamp: stroke.origin,
                continued: stroke.continued,
                role: stroke.role,
            },
            samples,
            tilt,
            split,
        }
    }

    /// Consegna i campioni in sospeso e, se serve, cancella la predizione.
    fn flush(&mut self, stroke: &mut Stroke, batch: &mut Vec<Sample>, clear_prediction: bool) {
        if let Some(id) = stroke.id {
            if !batch.is_empty() {
                self.effects.push(Effect::Samples {
                    id,
                    samples: std::mem::take(batch),
                });
            }
            if clear_prediction && stroke.predicted {
                stroke.predicted = false;
                self.effects.push(Effect::Predicted {
                    id,
                    samples: Vec::new(),
                });
            }
        }
    }

    /// Chiude il tratto con [`Effect::End`]. Un tratto mai annunciato (la
    /// penna che si alza senza aver premuto) se ne va in silenzio.
    ///
    /// `lifted` è il campione dell'alzata, se c'è: con uno stabilizzatore che
    /// non l'ha lasciato passare, un tocco avrebbe un campione solo.
    fn finish(&mut self, mut stroke: Stroke, mut batch: Vec<Sample>, lifted: Option<Sample>) {
        if stroke.id.is_none() {
            self.retire(stroke.pointer_id);
            return;
        }
        let mut tail = Vec::new();
        stroke.stabilizer.finish(&mut tail);
        for sample in tail {
            self.append(&mut stroke, sample, &mut batch);
        }
        if stroke.stabilizer.is_active() && stroke.samples.len() == 1 {
            if let Some(sample) = lifted {
                let first = stroke.samples[0];
                // Il segno dell'alzata è nel punto del primo campione.
                let at = Sample {
                    t: sample.t,
                    ..first
                };
                self.append(&mut stroke, at, &mut batch);
            }
        }
        self.flush(&mut stroke, &mut batch, true);
        self.retire(stroke.pointer_id);
        let finished = self.finished(&stroke, false);
        self.effects.push(Effect::End(finished));
    }

    /// Chiude `stroke` al limite dei campioni e apre la continuazione dal suo
    /// ultimo campione, nello stesso `stroke`. `batch` diventa il campione di
    /// giunzione, che la continuazione consegna insieme a quelli che seguono.
    fn split(&mut self, stroke: &mut Stroke, batch: &mut Vec<Sample>) {
        self.flush(stroke, batch, true);
        let joint = stroke.samples[stroke.samples.len() - 1];
        let finished = self.finished(stroke, true);
        self.effects.push(Effect::End(finished));
        stroke.continued = true;
        stroke.id = None;
        stroke.origin += joint.t;
        stroke.samples = vec![Sample { t: 0.0, ..joint }];
        stroke.predicted = false;
        self.announce(stroke);
        batch.push(stroke.samples[0]);
    }

    /// Aggiunge un campione (col tempo assoluto) al tratto, chiudendolo prima
    /// se è pieno: il tempo si misura dall'origine del tratto che lo riceve.
    fn append(&mut self, stroke: &mut Stroke, raw: Sample, batch: &mut Vec<Sample>) {
        if stroke.samples.len() >= self.max_samples {
            self.split(stroke, batch);
        }
        let sample = Sample {
            t: raw.t - stroke.origin,
            ..raw
        };
        stroke.samples.push(sample);
        batch.push(sample);
    }

    /// Passa un campione dello stabilizzatore e aggiunge quelli che ne escono.
    fn accept(&mut self, stroke: &mut Stroke, sample: Sample, batch: &mut Vec<Sample>) {
        let mut produced = Vec::with_capacity(1);
        stroke.stabilizer.push(sample, &mut produced);
        for out in produced {
            self.append(stroke, out, batch);
        }
    }

    /// Aggiunge gli eventi al tratto: inizio della penna che preme, doppioni,
    /// limite dei campioni. Consegna i campioni nuovi.
    fn feed(&mut self, stroke: &mut Stroke, events: &[PointerSample]) {
        let mut batch = Vec::new();
        for event in events {
            if let Some(last) = &stroke.last {
                if event.time < last.time || (event.time == last.time && same_sample(event, last)) {
                    continue;
                }
            }
            // Una penna che non preme non comincia; una pressione che non è un
            // numero non preme.
            let pressing = event.pressure > 0.0;
            if stroke.id.is_none() && stroke.kind == PointerKind::Pen && !pressing {
                continue;
            }
            // Un istante infinito farebbe scartare come vecchi tutti gli
            // eventi dopo.
            if !event.x.is_finite() || !event.y.is_finite() || !event.time.is_finite() {
                continue;
            }
            if stroke.id.is_none() {
                stroke.origin = event.time;
                self.announce(stroke);
            }
            let sample = self.sample_of(stroke, event, None);
            self.accept(stroke, sample, &mut batch);
            stroke.last = Some(*event);
            if stroke.pressure && reports_tilt(&event.tilt) {
                stroke.tilt = true;
            }
        }
        self.flush(stroke, &mut batch, false);
    }

    fn predict(&mut self, stroke: &mut Stroke, predicted: &[PointerSample]) {
        let id = match stroke.id {
            Some(id) => id,
            None => return,
        };
        if stroke.stabilizer.is_active() {
            return;
        }
        let samples: Vec<Sample> = predicted
            .iter()
            .filter(|future| {
                future.x.is_finite() && future.y.is_finite() && future.time.is_finite()
            })
            .map(|future| {
                let raw = self.sample_of(stroke, future, None);
                Sample {
                    t: raw.t - stroke.origin,
                    ..raw
                }
            })
            .collect();
        // Una predizione vuota dopo una vuota non dice niente.
        if samples.is_empty() && !stroke.predicted {
            return;
        }
        stroke.predicted = !samples.is_empty();
        self.effects.push(Effect::Predicted { id, samples });
    }
}
