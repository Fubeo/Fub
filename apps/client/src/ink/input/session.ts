// Il ciclo di vita del tratto: dai campioni del puntatore ai tratti.
//
// Una `Session` riceve i campioni di una superficie, un evento alla volta, e
// restituisce gli `Effect` che ne seguono: l'inizio di un tratto, i campioni,
// la predizione, la fine, l'annullamento, e le due richieste alla piattaforma
// (catturare il puntatore, rilasciarlo). Non disegna e non conosce strumenti,
// camera, DOM o prodotti: le coordinate arrivano già nello spazio del tratto, e
// gli effetti vanno a chi disegna l'anteprima e a chi scrive il tratto.
//
// È un riduttore: lo stesso scenario dà gli stessi effetti, sempre. È la copia
// TypeScript di `crates/fub-ink/src/session.rs`, che fa fede per le regole:
// l'inchiostro è un percorso caldo (un evento per fotogramma o più) e il client
// non ha una toolchain wasm (DEC-23), quindi il riduttore vive nei due
// linguaggi e un file di scenari (`__fixtures__/ink-samples.json`), generato da
// Rust, obbliga questa copia a rispondere come l'altra (`ink/mirror.test.ts`).
//
// Le regole:
//
// - **Subito.** I campioni nuovi si consegnano dentro l'evento che li porta,
//   mai dopo: l'anteprima li disegna appena arrivano.
// - **Tutti i campioni.** Gli eventi coalescenti entrano nell'ordine in cui
//   sono avvenuti; un doppione (stesso istante, stessi valori) o un evento più
//   vecchio dell'ultimo accettato si scarta. Gli eventi predetti vanno solo
//   all'anteprima, e ogni volta sostituiscono la predizione precedente. Non
//   entrano mai nel tratto.
// - **Niente tratti a metà.** `pointercancel`, la perdita della cattura, la
//   finestra che perde il fuoco, la pagina nascosta, un palmo riconosciuto
//   tardi, un secondo dito, un `pointerup` perso e la distruzione annullano il
//   tratto intero: a `end` arriva solo un tratto concluso alzando il puntatore
//   (o il tasto principale del mouse) o chiuso al limite dei campioni.
// - **La penna preme.** Una penna appoggiata con pressione 0 non disegna
//   finché non preme; una penna sospesa non disegna mai. Il mouse disegna col
//   tasto principale, senza canale di pressione: il pennello la simula
//   (`sim=1`). Lo stesso per il dito.
// - **Il palmo non disegna.** I ruoli dei puntatori sono quelli di `roles.ts`.
// - **Al massimo `maxSamples` campioni.** Oltre, il tratto si chiude e ne
//   comincia un altro dallo stesso punto, senza buchi: l'ultimo campione del
//   primo è il primo del secondo, con `t = 0`. Il primo finisce con
//   `split: true`, il secondo comincia con `continued: true`.
// - **Un tocco è un segno.** Un tocco senza movimento ha due campioni nello
//   stesso punto: di un punto solo il contorno del tratto farebbe un trattino
//   verso destra e in basso.
//
// I campioni hanno `x` e `y` nello spazio del tratto, `t` in millisecondi dal
// primo campione, `p` 0…1 per la penna, `a` e `z` in gradi quando la penna li
// dà. L'inclinazione è del tratto: se nessun campione ne ha dato una vera, il
// tratto concluso non la porta. La pressione scritta è quella che la curva di
// chi disegna dà alla pressione della penna; l'azimut si misura dall'asse x
// della scena, e su un foglio girato si toglie l'angolo della vista.
//
// Con uno stabilizzatore acceso (`stabilizer`) i campioni del tratto sono
// quelli del pennino e non quelli del puntatore, e la predizione non si
// consegna: sarebbe davanti a un pennino che sta indietro.

import { INK_MAX_SAMPLES, type InkSample, type InkTilt } from "../sample";
import type { InkPointerType, PointerSample } from "./pointer";
import { classifyPointer, type PointerRole, type TouchPolicy } from "./roles";
import { Stabilizer, type StabilizerConfig, NO_STABILIZER } from "./stabilizer";
import { penAngles, reportsTilt, type PenAngles } from "./tilt";

/// L'inizio di un tratto.
export interface StrokeStart {
  /// Unico per questa sessione, crescente.
  readonly id: number;
  readonly pointerType: InkPointerType;
  /// Il tratto ha il canale `p`: vero solo per la penna. Senza, `sim=1`.
  readonly pressure: boolean;
  /// `timeStamp` del primo campione, sull'orologio di `performance.now()`.
  readonly timeStamp: number;
  /// Il tratto continua quello appena chiuso al limite dei campioni.
  readonly continued: boolean;
}

/// Un tratto concluso alzando il puntatore, o chiuso al limite dei campioni.
export interface FinishedStroke extends StrokeStart {
  /// I campioni del tratto, da 1 a `maxSamples`; il primo ha `t = 0`.
  readonly samples: readonly InkSample[];
  /// I campioni portano `a` e `z`.
  readonly tilt: boolean;
  /// Il tratto è stato chiuso al limite e continua in quello successivo.
  readonly split: boolean;
}

/// Perché un tratto è stato annullato.
export type CancelReason =
  | "pointercancel"
  | "lostcapture"
  | "blur"
  | "hidden"
  | "palm"
  | "gesture"
  | "api"
  | "destroy";

/// Che cosa succede in seguito a un evento, nell'ordine in cui accade.
export type Effect =
  /// Chiedere alla piattaforma di catturare il puntatore.
  | { readonly fx: "capture"; readonly pointer: number }
  /// Chiedere alla piattaforma di rilasciarlo.
  | { readonly fx: "release"; readonly pointer: number }
  | ({ readonly fx: "start" } & StrokeStart)
  /// Campioni nuovi del tratto, nell'ordine, da aggiungere a quelli già dati.
  | { readonly fx: "samples"; readonly id: number; readonly samples: readonly InkSample[] }
  /// La predizione corrente: sostituisce la precedente; vuota la cancella.
  | { readonly fx: "predicted"; readonly id: number; readonly samples: readonly InkSample[] }
  | ({ readonly fx: "end" } & FinishedStroke)
  /// Il tratto non esiste più: l'anteprima si cancella, niente si scrive.
  | { readonly fx: "cancel"; readonly id: number; readonly reason: CancelReason };

/// La curva della pressione: dalla pressione della penna, 0…1, a quella del
/// tratto.
export type PressureMap = (pressure: number) => number;

/// Come si comporta una sessione.
export interface SessionConfig {
  /// Che cosa fa un dito quando nessuna penna è vicina (default `auto`).
  readonly touch?: TouchPolicy;
  /// Campioni per tratto prima di dividerlo, da 2 a `INK_MAX_SAMPLES` (default
  /// `INK_MAX_SAMPLES`).
  readonly maxSamples?: number;
  /// La curva della pressione della penna; senza, la pressione è com'è.
  readonly curve?: PressureMap | null;
  /// Lo stabilizzatore dei tratti che cominciano da adesso (default spento).
  readonly stabilizer?: StabilizerConfig;
}

/// Il bit del tasto principale in `PointerEvent.buttons`.
const PRIMARY_BUTTON = 1;

interface PointerEntry {
  readonly kind: InkPointerType;
  role: PointerRole;
}

interface Stroke {
  readonly pointerId: number;
  readonly kind: InkPointerType;
  readonly pressure: boolean;
  continued: boolean;
  /// `null` finché il tratto non è annunciato con `start`: una penna
  /// appoggiata senza pressione.
  id: number | null;
  /// `timeStamp` del primo campione.
  origin: number;
  samples: InkSample[];
  /// L'ultimo evento accettato, per riconoscere i doppioni.
  last: PointerSample | null;
  tilt: boolean;
  /// Una predizione non vuota è stata consegnata e non ancora cancellata.
  predicted: boolean;
  readonly stabilizer: Stabilizer;
}

/// Due campioni dello stesso istante con gli stessi valori sono lo stesso
/// campione, consegnato due volte.
function sameSample(a: PointerSample, b: PointerSample): boolean {
  return a.x === b.x && a.y === b.y && a.pressure === b.pressure
    && a.tiltX === b.tiltX && a.tiltY === b.tiltY
    && a.altitudeAngle === b.altitudeAngle && a.azimuthAngle === b.azimuthAngle;
}

/// La pressione di un campione, entro 0…1. Pointer Events vuole 0,5 per un
/// dispositivo senza pressione: è anche il ripiego per un valore che un motore
/// non sa dare.
function pressureOf(sample: PointerSample): number {
  const { pressure } = sample;
  return Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0.5;
}

/// Un campione con i soli canali che ha: niente chiavi `undefined`, perché il
/// campione si confronta e si serializza com'è.
function inkSample(x: number, y: number, p: number | undefined, t: number, tilt: PenAngles | null): InkSample {
  if (p === undefined) return { x, y, t };
  return tilt === null ? { x, y, p, t } : { x, y, p, t, a: tilt.a, z: tilt.z };
}

function tiltOf(sample: InkTilt): PenAngles | null {
  return sample.a === undefined ? null : { a: sample.a, z: sample.z };
}

/// Il ciclo di vita dei tratti di una superficie.
export class Session {
  private readonly maxSamples: number;
  private touch: TouchPolicy;
  private curve: PressureMap | null;
  private stabilizer: StabilizerConfig;
  /// I puntatori giù su questa superficie, col loro ruolo.
  private readonly pointers = new Map<number, PointerEntry>();
  /// Le penne sospese sopra la superficie o appoggiate.
  private readonly nearPens = new Set<number>();
  private seenPen = false;
  private stroke: Stroke | null = null;
  private nextId = 1;
  private destroyed = false;
  private effects: Effect[] = [];

  /// Lancia `RangeError` se `maxSamples` non è un intero in 2…`INK_MAX_SAMPLES`:
  /// con meno di due campioni la continuazione, che parte dal punto di
  /// giunzione, sarebbe di nuovo piena, un ciclo senza fine.
  constructor(config: SessionConfig = {}) {
    const maxSamples = config.maxSamples ?? INK_MAX_SAMPLES;
    if (!Number.isInteger(maxSamples) || maxSamples < 2 || maxSamples > INK_MAX_SAMPLES) {
      throw new RangeError(`maxSamples fuori da 2…${INK_MAX_SAMPLES}: ${maxSamples}`);
    }
    this.maxSamples = maxSamples;
    this.touch = config.touch ?? "auto";
    this.curve = config.curve ?? null;
    this.stabilizer = config.stabilizer ?? NO_STABILIZER;
  }

  /// Il ruolo di un puntatore giù su questa superficie, `null` se non c'è.
  /// Può cambiare mentre il puntatore è giù: un dito diventa palmo quando
  /// arriva la penna, un dito che disegnava diventa navigazione quando se ne
  /// appoggia un secondo.
  roleOf(pointerId: number): PointerRole | null {
    return this.pointers.get(pointerId)?.role ?? null;
  }

  /// Su questa superficie si è vista una penna.
  get penSeen(): boolean {
    return this.seenPen;
  }

  /// Un tratto è in corso.
  get drawing(): boolean {
    return this.stroke !== null && this.stroke.id !== null;
  }

  /// Il tratto in corso, annunciato o no, è di questo puntatore: chi adatta una
  /// piattaforma lo chiede per non raccogliere eventi coalescenti e predetti
  /// di un puntatore che non disegna.
  tracks(pointerId: number): boolean {
    return this.stroke?.pointerId === pointerId;
  }

  setTouchPolicy(policy: TouchPolicy): void {
    this.touch = policy;
  }

  /// La curva della pressione per i campioni da adesso.
  setCurve(curve: PressureMap | null): void {
    this.curve = curve;
  }

  /// Lo stabilizzatore dei tratti che cominciano da adesso; quello di un tratto
  /// in corso non cambia.
  setStabilizer(config: StabilizerConfig): void {
    this.stabilizer = config;
  }

  /// Un puntatore si appoggia.
  pointerDown(event: PointerSample): Effect[] {
    if (this.destroyed) return [];
    // Lo stesso puntatore giù una seconda volta vuol dire che il suo
    // `pointerup` si è perso: un tasto in più del mouse non manda
    // `pointerdown`, e penna e dito si alzano prima di riappoggiarsi. La fine
    // del tratto non si è vista, quindi il tratto si annulla.
    if (this.stroke?.pointerId === event.pointerId) this.cancelStroke("lostcapture");
    const kind = event.pointerType;
    if (kind === "pen") this.notePen(event.pointerId);
    let role = classifyPointer(event, {
      touch: this.touch,
      penSeen: this.seenPen,
      penNear: this.penNear(),
      touchesDown: this.touchesDown(),
    });
    // Un secondo dito: il primo smette di disegnare e diventa navigazione.
    if (kind === "touch" && role === "navigate" && this.stroke?.kind === "touch") {
      const entry = this.pointers.get(this.stroke.pointerId);
      if (entry !== undefined) entry.role = "navigate";
      this.cancelStroke("gesture");
    }
    // Un tratto alla volta.
    if (role === "ink" && this.stroke !== null) role = "ignore";
    this.pointers.set(event.pointerId, { kind, role });
    if (role !== "ink") return this.takeEffects();
    this.effects.push({ fx: "capture", pointer: event.pointerId });
    const stroke: Stroke = {
      pointerId: event.pointerId,
      kind,
      pressure: kind === "pen",
      continued: false,
      id: null,
      origin: event.timeStamp,
      samples: [],
      last: null,
      tilt: false,
      predicted: false,
      stabilizer: new Stabilizer(this.stabilizer, event.scale),
    };
    this.feed(stroke, [event]);
    this.stroke = stroke;
    return this.takeEffects();
  }

  /// Un puntatore si muove: `coalesced` sono gli eventi che il motore ha
  /// riunito in `event`, nell'ordine in cui sono avvenuti, e `predicted` quelli
  /// che prevede. Una piattaforma che non li dà passa liste vuote.
  pointerMove(coalesced: readonly PointerSample[], event: PointerSample, predicted: readonly PointerSample[]): Effect[] {
    if (this.destroyed) return [];
    if (event.pointerType === "pen") this.notePen(event.pointerId);
    const stroke = this.takeStrokeOf(event.pointerId);
    if (stroke === null) return this.takeEffects();
    // Il tasto principale rilasciato con un altro ancora premuto non manda
    // `pointerup`: il tratto finisce qui.
    if ((event.buttons & PRIMARY_BUTTON) === 0) {
      this.finish(stroke, [], null);
      return this.takeEffects();
    }
    // L'evento stesso in coda: dove la lista lo contiene già è un doppione e si
    // scarta, dove non lo contiene è l'ultimo campione.
    const events = coalesced.length === 0 ? [event] : [...coalesced, event];
    this.feed(stroke, events);
    this.predict(stroke, predicted);
    this.stroke = stroke;
    return this.takeEffects();
  }

  /// Un puntatore si alza.
  pointerUp(event: PointerSample): Effect[] {
    if (this.destroyed) return [];
    this.pointers.delete(event.pointerId);
    const stroke = this.takeStrokeOf(event.pointerId);
    if (stroke === null) return this.takeEffects();
    if (stroke.id === null) {
      this.finish(stroke, [], null);
      return this.takeEffects();
    }
    // `pointerup` ha la posizione finale ma pressione 0: se il puntatore si è
    // mosso dopo l'ultimo campione, l'ultimo punto prende pressione e
    // inclinazione del campione prima.
    //
    // Un tocco senza movimento avrebbe un campione solo, e di un punto solo il
    // contorno farebbe un trattino verso destra e in basso. Con il campione
    // dell'alzata, anche nello stesso punto, i campioni sono due e il segno è
    // un punto tondo centrato dove si è toccato.
    const batch: InkSample[] = [];
    const { last } = stroke;
    const moved = last === null || stroke.samples.length === 1 || event.x !== last.x || event.y !== last.y;
    const fresh = last === null || event.timeStamp >= last.timeStamp;
    let lifted: InkSample | null = null;
    if (moved && fresh && Number.isFinite(event.x) && Number.isFinite(event.y)) {
      const sample = this.sampleOf(stroke, event, stroke.samples[stroke.samples.length - 1] ?? null);
      this.accept(stroke, sample, batch);
      stroke.last = event;
      lifted = sample;
    }
    this.finish(stroke, batch, lifted);
    return this.takeEffects();
  }

  /// Il motore annulla un puntatore (`pointercancel`).
  pointerCancel(pointerId: number): Effect[] {
    if (this.destroyed) return [];
    this.pointers.delete(pointerId);
    this.nearPens.delete(pointerId);
    if (this.stroke?.pointerId === pointerId) this.cancelStroke("pointercancel");
    return this.takeEffects();
  }

  /// La superficie perde la cattura del puntatore.
  lostCapture(pointerId: number): Effect[] {
    if (this.destroyed) return [];
    if (this.stroke?.pointerId === pointerId) this.cancelStroke("lostcapture");
    return this.takeEffects();
  }

  /// Un puntatore esce dalla superficie. Una penna lo manda anche quando esce
  /// dal raggio di hover.
  pointerLeave(pointerId: number, kind: InkPointerType): void {
    if (!this.destroyed && kind === "pen") this.nearPens.delete(pointerId);
  }

  /// La finestra o la pagina non ricevono più eventi: il tratto si annulla, e i
  /// puntatori ricordati non sono più affidabili.
  interrupt(reason: CancelReason): Effect[] {
    if (this.destroyed) return [];
    this.cancelStroke(reason);
    this.pointers.clear();
    this.nearPens.clear();
    return this.takeEffects();
  }

  /// Annulla il tratto in corso (`api`); il puntatore smette di disegnare
  /// finché non si alza.
  cancel(): Effect[] {
    if (!this.destroyed) this.cancelStroke("api");
    return this.takeEffects();
  }

  /// Annulla il tratto in corso e chiude la sessione, che da qui non fa più
  /// niente. Si può chiamare più volte.
  destroy(): Effect[] {
    if (this.destroyed) return [];
    this.destroyed = true;
    this.cancelStroke("destroy");
    this.pointers.clear();
    this.nearPens.clear();
    return this.takeEffects();
  }

  private takeEffects(): Effect[] {
    const effects = this.effects;
    this.effects = [];
    return effects;
  }

  /// Il tratto in corso, tolto dalla sessione, se è di questo puntatore.
  private takeStrokeOf(pointerId: number): Stroke | null {
    const { stroke } = this;
    if (stroke === null || stroke.pointerId !== pointerId) return null;
    this.stroke = null;
    return stroke;
  }

  private penNear(): boolean {
    if (this.nearPens.size > 0) return true;
    for (const entry of this.pointers.values()) if (entry.kind === "pen") return true;
    return false;
  }

  private touchesDown(): number {
    let count = 0;
    for (const entry of this.pointers.values()) if (entry.kind === "touch" && entry.role !== "ignore") count++;
    return count;
  }

  /// Una penna è arrivata: le dita già giù sono palmo, e un loro tratto si
  /// annulla.
  private notePen(pointerId: number): void {
    this.seenPen = true;
    if (this.nearPens.has(pointerId)) return;
    this.nearPens.add(pointerId);
    for (const entry of this.pointers.values()) if (entry.kind === "touch") entry.role = "ignore";
    if (this.stroke?.kind === "touch") this.cancelStroke("palm");
  }

  /// Annulla il tratto in corso. Il puntatore resta giù ma non disegna più.
  private cancelStroke(reason: CancelReason): void {
    const { stroke } = this;
    if (stroke === null) return;
    this.stroke = null;
    this.retire(stroke.pointerId);
    if (stroke.id !== null) this.effects.push({ fx: "cancel", id: stroke.id, reason });
  }

  /// Il tratto non è più in corso: se il puntatore resta giù non disegna più
  /// finché non si alza, e la cattura torna al browser.
  private retire(pointerId: number): void {
    const entry = this.pointers.get(pointerId);
    if (entry?.role === "ink") entry.role = "ignore";
    this.effects.push({ fx: "release", pointer: pointerId });
  }

  /// La pressione della penna passata per la curva, entro 0…1.
  private curved(pressure: number): number {
    if (this.curve === null) return pressure;
    const out = this.curve(pressure);
    return Number.isFinite(out) ? Math.min(1, Math.max(0, out)) : pressure;
  }

  /// Gli angoli della penna, con l'azimut dall'asse x della scena.
  private sceneAngles(event: PointerSample): PenAngles | null {
    const angles = penAngles(event);
    const { turn } = event;
    if (angles === null || turn === 0 || !Number.isFinite(turn)) return angles;
    let z = (angles.z - turn) % 360;
    if (z < 0) z += 360;
    return { a: angles.a, z };
  }

  /// Il campione di un evento, col tempo dell'evento (assoluto): entra nel
  /// tratto con `append`, che lo misura dall'origine del tratto com'è in quel
  /// momento, dopo un'eventuale divisione. `carry` presta pressione e
  /// inclinazione, per l'alzata, che per specifica ha pressione 0.
  private sampleOf(stroke: Stroke, event: PointerSample, carry: InkSample | null): InkSample {
    const t = event.timeStamp;
    if (!stroke.pressure) return { x: event.x, y: event.y, t };
    const p = carry?.p ?? this.curved(pressureOf(event));
    const tilt = carry === null ? this.sceneAngles(event) : tiltOf(carry);
    return inkSample(event.x, event.y, p, t, tilt);
  }

  /// Annuncia un tratto con `start`.
  private announce(stroke: Stroke): void {
    const id = this.nextId++;
    stroke.id = id;
    this.effects.push({
      fx: "start",
      id,
      pointerType: stroke.kind,
      pressure: stroke.pressure,
      timeStamp: stroke.origin,
      continued: stroke.continued,
    });
  }

  private finished(stroke: Stroke, split: boolean): FinishedStroke {
    // L'inclinazione si scrive solo se il dispositivo l'ha data davvero, e in
    // ogni campione o in nessuno.
    const tilt = stroke.tilt && stroke.samples.every((sample) => sample.a !== undefined);
    const samples = tilt || !stroke.pressure
      ? stroke.samples
      : stroke.samples.map(({ x, y, p, t }): InkSample => (p === undefined ? { x, y, t } : { x, y, p, t }));
    return {
      id: stroke.id ?? 0,
      pointerType: stroke.kind,
      pressure: stroke.pressure,
      timeStamp: stroke.origin,
      continued: stroke.continued,
      samples,
      tilt,
      split,
    };
  }

  /// Consegna i campioni in sospeso e, se serve, cancella la predizione.
  private flush(stroke: Stroke, batch: InkSample[], clearPrediction: boolean): void {
    const { id } = stroke;
    if (id === null) return;
    if (batch.length > 0) this.effects.push({ fx: "samples", id, samples: batch.splice(0) });
    if (clearPrediction && stroke.predicted) {
      stroke.predicted = false;
      this.effects.push({ fx: "predicted", id, samples: [] });
    }
  }

  /// Chiude il tratto con `end`. Un tratto mai annunciato (la penna che si alza
  /// senza aver premuto) se ne va in silenzio.
  ///
  /// `lifted` è il campione dell'alzata, se c'è: con uno stabilizzatore che non
  /// l'ha lasciato passare, un tocco avrebbe un campione solo.
  private finish(stroke: Stroke, batch: InkSample[], lifted: InkSample | null): void {
    if (stroke.id === null) {
      this.retire(stroke.pointerId);
      return;
    }
    const tail: InkSample[] = [];
    stroke.stabilizer.finish(tail);
    for (const sample of tail) this.append(stroke, sample, batch);
    if (stroke.stabilizer.active && stroke.samples.length === 1 && lifted !== null) {
      // Il segno dell'alzata è nel punto del primo campione.
      this.append(stroke, { ...stroke.samples[0]!, t: lifted.t }, batch);
    }
    this.flush(stroke, batch, true);
    this.retire(stroke.pointerId);
    this.effects.push({ fx: "end", ...this.finished(stroke, false) });
  }

  /// Chiude `stroke` al limite dei campioni e apre la continuazione dal suo
  /// ultimo campione, nello stesso `stroke`. `batch` diventa il campione di
  /// giunzione, che la continuazione consegna insieme a quelli che seguono.
  private split(stroke: Stroke, batch: InkSample[]): void {
    this.flush(stroke, batch, true);
    const joint = stroke.samples[stroke.samples.length - 1]!;
    this.effects.push({ fx: "end", ...this.finished(stroke, true) });
    stroke.continued = true;
    stroke.id = null;
    stroke.origin += joint.t;
    stroke.samples = [{ ...joint, t: 0 }];
    stroke.predicted = false;
    this.announce(stroke);
    batch.push(stroke.samples[0]!);
  }

  /// Aggiunge un campione (col tempo assoluto) al tratto, chiudendolo prima se
  /// è pieno: il tempo si misura dall'origine del tratto che lo riceve.
  private append(stroke: Stroke, raw: InkSample, batch: InkSample[]): void {
    if (stroke.samples.length >= this.maxSamples) this.split(stroke, batch);
    const sample: InkSample = { ...raw, t: raw.t - stroke.origin };
    stroke.samples.push(sample);
    batch.push(sample);
  }

  /// Passa un campione dello stabilizzatore e aggiunge quelli che ne escono.
  private accept(stroke: Stroke, sample: InkSample, batch: InkSample[]): void {
    const produced: InkSample[] = [];
    stroke.stabilizer.push(sample, produced);
    for (const out of produced) this.append(stroke, out, batch);
  }

  /// Aggiunge gli eventi al tratto: inizio della penna che preme, doppioni,
  /// limite dei campioni. Consegna i campioni nuovi.
  private feed(stroke: Stroke, events: readonly PointerSample[]): void {
    const batch: InkSample[] = [];
    for (const event of events) {
      const { last } = stroke;
      if (last !== null && (event.timeStamp < last.timeStamp || (event.timeStamp === last.timeStamp && sameSample(event, last)))) {
        continue;
      }
      // Una penna che non preme non comincia; una pressione che non è un
      // numero non preme.
      const pressing = event.pressure > 0;
      if (stroke.id === null && stroke.kind === "pen" && !pressing) continue;
      if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) continue;
      if (stroke.id === null) {
        stroke.origin = event.timeStamp;
        this.announce(stroke);
      }
      this.accept(stroke, this.sampleOf(stroke, event, null), batch);
      stroke.last = event;
      if (stroke.pressure && reportsTilt(event)) stroke.tilt = true;
    }
    this.flush(stroke, batch, false);
  }

  private predict(stroke: Stroke, predicted: readonly PointerSample[]): void {
    const { id } = stroke;
    if (id === null || stroke.stabilizer.active) return;
    const samples: InkSample[] = [];
    for (const future of predicted) {
      if (!Number.isFinite(future.x) || !Number.isFinite(future.y)) continue;
      const raw = this.sampleOf(stroke, future, null);
      samples.push({ ...raw, t: raw.t - stroke.origin });
    }
    // Una predizione vuota dopo una vuota non dice niente.
    if (samples.length === 0 && !stroke.predicted) return;
    stroke.predicted = samples.length > 0;
    this.effects.push({ fx: "predicted", id, samples });
  }
}
