// La pipeline della penna: dagli eventi del puntatore ai tratti.
//
// Si attacca a un elemento e trasforma i suoi eventi in un ciclo di vita per
// tratto: inizio, campioni, campioni predetti, fine, annullamento. Non
// disegna e non conosce strumenti né camera: le coordinate arrivano da
// `toScene`, che la camera fornisce, e i campioni vanno a chi disegna
// l'anteprima e a chi scrive il tratto.
//
// Le regole:
//
// - **Subito.** I campioni nuovi si consegnano dentro il gestore
//   dell'evento, mai al fotogramma dopo: l'anteprima li disegna appena
//   arrivano, ed è lì che si gioca il budget di un fotogramma.
// - **Tutti i campioni.** Gli eventi coalescenti (`getCoalescedEvents`), dove
//   ci sono, entrano nell'ordine in cui sono avvenuti; un doppione (stesso
//   istante, stessi valori) o un evento più vecchio dell'ultimo accettato si
//   scarta. Gli eventi predetti (`getPredictedEvents`) vanno solo
//   all'anteprima con `onPredicted`, che ogni volta sostituisce la predizione
//   precedente, e non entrano mai nel tratto.
// - **Niente tratti a metà.** Durante il tratto il puntatore è catturato.
//   `pointercancel`, la perdita della cattura, la finestra che perde il fuoco,
//   la pagina nascosta, un palmo riconosciuto tardi, un secondo dito, un
//   `pointerup` perso e `destroy` annullano il tratto intero con `onCancel`: a
//   `onEnd` arriva solo un tratto concluso alzando il puntatore (o il tasto
//   principale del mouse) o chiuso al limite dei campioni.
// - **La penna preme.** Una penna appoggiata con pressione 0 non disegna
//   finché non preme; una penna sospesa non disegna mai. Il mouse disegna col
//   tasto principale, senza canale di pressione: il pennello la simula
//   (`sim=1`). Lo stesso per il dito.
// - **Il palmo non disegna.** I ruoli dei puntatori sono quelli di
//   `roles.ts`; `roleOf` li espone a strumenti e camera.
// - **Al massimo `INK_MAX_SAMPLES` campioni.** Oltre, il tratto si chiude e ne
//   comincia un altro dallo stesso punto, senza buchi: l'ultimo campione del
//   primo è il primo del secondo, con `t = 0`. Il primo finisce con
//   `split: true`, il secondo comincia con `continued: true`, così chi sceglie
//   il pennello può togliere l'assottigliamento alla giunzione.
//
// I campioni hanno `x` e `y` nella scena, `t` in millisecondi dal primo
// campione del tratto (da `event.timeStamp`), `p` 0…1 per la penna, `a` e `z`
// in gradi quando la penna ne dà. L'inclinazione è del tratto: se nessun
// campione ne ha dato una vera, il tratto concluso non la porta. Un tocco
// fermo ha due campioni nello stesso punto (vedi `pointerup`).
//
// L'elemento deve avere `touch-action: none` (altrimenti il browser si prende
// il dito per scorrere e manda `pointercancel`) e `user-select: none`: sono
// regole di presentazione e le mette la superficie. La pipeline ascolta in
// cattura, così ruoli e stato sono già aggiornati quando gli ascoltatori della
// camera, in bolla sullo stesso elemento, li leggono.

import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { INK_MAX_SAMPLES, type InkSample } from "../ink/sample";
import { classifyPointer, type PointerRole, type TouchPolicy } from "./roles";
import { penAngles, reportsTilt } from "./tilt";

export type InkPointerType = "pen" | "mouse" | "touch";

/// Un punto della scena, in unità locali del tratto.
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/// L'inizio di un tratto.
export interface StrokeStart {
  /// Unico per questa pipeline, crescente.
  readonly id: number;
  readonly pointerType: InkPointerType;
  /// Il tratto ha il canale `p`: vero solo per la penna. Senza, `sim=1`.
  readonly pressure: boolean;
  /// `event.timeStamp` del primo campione, sull'orologio di `performance.now()`.
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

export interface PenInputOptions {
  /// Da coordinate del client a coordinate della scena. La fornisce la camera
  /// e si chiama per ogni campione, così un cambio di vista vale da subito.
  readonly toScene: (clientX: number, clientY: number) => ScenePoint;
  readonly onStart: (stroke: StrokeStart) => void;
  /// Campioni nuovi del tratto, nell'ordine, da aggiungere a quelli già dati.
  readonly onSamples: (id: number, samples: readonly InkSample[]) => void;
  /// La predizione corrente: sostituisce la precedente; vuota la cancella.
  readonly onPredicted?: (id: number, samples: readonly InkSample[]) => void;
  readonly onEnd: (stroke: FinishedStroke) => void;
  /// Il tratto non esiste più: l'anteprima si cancella, niente si scrive.
  readonly onCancel: (id: number, reason: CancelReason) => void;
  /// Che cosa fa un dito quando nessuna penna è vicina (default `auto`).
  readonly touch?: TouchPolicy;
  /// Campioni per tratto prima di dividerlo (default `INK_MAX_SAMPLES`).
  readonly maxSamples?: number;
}

export interface PenInput {
  /// Il ruolo di un puntatore giù su questa superficie, `null` se non c'è.
  /// Può cambiare mentre il puntatore è giù: un dito diventa palmo quando
  /// arriva la penna, un dito che disegnava diventa navigazione quando se ne
  /// appoggia un secondo.
  roleOf(pointerId: number): PointerRole | null;
  /// Su questa superficie si è vista una penna.
  readonly penSeen: boolean;
  /// Un tratto è in corso.
  readonly drawing: boolean;
  setTouchPolicy(policy: TouchPolicy): void;
  /// Annulla il tratto in corso (`reason: "api"`); il puntatore smette di
  /// disegnare finché non si alza.
  cancel(): void;
  /// Annulla il tratto in corso e toglie ogni ascoltatore. Idempotente.
  destroy(): void;
}

interface PointerEntry {
  readonly type: InkPointerType;
  role: PointerRole;
}

interface Stroke {
  readonly pointerId: number;
  readonly type: InkPointerType;
  readonly pressure: boolean;
  readonly continued: boolean;
  /// `null` finché il tratto non è annunciato con `onStart`: una penna
  /// appoggiata senza pressione, o la continuazione mentre `onEnd` del primo
  /// pezzo è in corso.
  id: number | null;
  /// `timeStamp` del primo campione.
  origin: number;
  readonly samples: InkSample[];
  /// L'ultimo evento accettato, per riconoscere i doppioni.
  last: PointerEvent | null;
  tilt: boolean;
  /// Una predizione non vuota è stata consegnata e non ancora cancellata.
  predicted: boolean;
}

/// Il bit del tasto principale in `PointerEvent.buttons`.
const PRIMARY_BUTTON = 1;

function pointerTypeOf(type: string): InkPointerType {
  return type === "pen" || type === "touch" ? type : "mouse";
}

function pressureOf(event: PointerEvent): number {
  const { pressure } = event;
  // Pointer Events vuole 0,5 per un dispositivo senza pressione: è anche il
  // ripiego per un valore che un motore non sa dare.
  return Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0.5;
}

/// Due eventi dello stesso istante con gli stessi valori sono lo stesso
/// campione, consegnato due volte.
function sameSample(a: PointerEvent, b: PointerEvent): boolean {
  return a.clientX === b.clientX && a.clientY === b.clientY && a.pressure === b.pressure
    && a.tiltX === b.tiltX && a.tiltY === b.tiltY
    && a.altitudeAngle === b.altitudeAngle && a.azimuthAngle === b.azimuthAngle;
}

/// Attacca la pipeline a `element`. Vive finché `owner` non si chiude o
/// finché non si chiama `destroy`.
export function attachPenInput(element: HTMLElement, options: PenInputOptions, owner: Lifetime): PenInput {
  const maxSamples = options.maxSamples ?? INK_MAX_SAMPLES;
  // Con meno di due campioni la continuazione, che parte dal punto di
  // giunzione, sarebbe di nuovo piena: un ciclo senza fine.
  if (!Number.isInteger(maxSamples) || maxSamples < 2 || maxSamples > INK_MAX_SAMPLES) {
    throw new RangeError(`maxSamples fuori da 2…${INK_MAX_SAMPLES}: ${maxSamples}`);
  }
  let touch: TouchPolicy = options.touch ?? "auto";
  const life = openLifetime();
  const doc = element.ownerDocument;
  const view = doc.defaultView;

  /// I puntatori giù su questa superficie, col loro ruolo.
  const pointers = new Map<number, PointerEntry>();
  /// Le penne sospese sopra la superficie o appoggiate.
  const nearPens = new Set<number>();
  let penSeen = false;
  let stroke: Stroke | null = null;
  let nextId = 1;
  let destroyed = false;

  /// Vero finché `s` è ancora il tratto in corso: dopo ogni callback, perché
  /// chi la riceve può annullare o distruggere.
  const alive = (s: Stroke): boolean => !destroyed && stroke === s;

  function penNear(): boolean {
    if (nearPens.size > 0) return true;
    for (const entry of pointers.values()) if (entry.type === "pen") return true;
    return false;
  }

  function touchesDown(): number {
    let count = 0;
    for (const entry of pointers.values()) if (entry.type === "touch" && entry.role !== "ignore") count++;
    return count;
  }

  function capture(pointerId: number): void {
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // Un puntatore che il motore non considera attivo non si cattura: il
      // tratto prosegue con gli eventi che arrivano, e `pointerup` si ascolta
      // sul documento apposta.
    }
  }

  function release(pointerId: number): void {
    try {
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      // Già rilasciata: è l'esito voluto.
    }
  }

  /// Annulla il tratto in corso. Il puntatore resta giù ma non disegna più.
  function cancelStroke(reason: CancelReason): void {
    const s = stroke;
    if (!s) return;
    stroke = null;
    retire(s);
    if (s.id !== null) options.onCancel(s.id, reason);
  }

  /// Il tratto non è più in corso: se il puntatore resta giù non disegna più
  /// finché non si alza, e la cattura torna al browser.
  function retire(s: Stroke): void {
    const entry = pointers.get(s.pointerId);
    if (entry?.role === "ink") entry.role = "ignore";
    release(s.pointerId);
  }

  /// Una penna è arrivata: le dita già giù sono palmo, e un loro tratto si
  /// annulla.
  function notePen(pointerId: number): void {
    penSeen = true;
    if (nearPens.has(pointerId)) return;
    nearPens.add(pointerId);
    for (const entry of pointers.values()) if (entry.type === "touch") entry.role = "ignore";
    if (stroke?.type === "touch") cancelStroke("palm");
  }

  function scenePoint(event: PointerEvent): ScenePoint | null {
    const point = options.toScene(event.clientX, event.clientY);
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  /// Il campione di un evento. `carry` presta pressione e inclinazione, per
  /// `pointerup`, che per specifica ha pressione 0.
  function sampleOf(s: Stroke, event: PointerEvent, point: ScenePoint, carry?: InkSample): InkSample {
    const { x, y } = point;
    const t = event.timeStamp - s.origin;
    if (!s.pressure) return { x, y, t };
    const p = carry?.p ?? pressureOf(event);
    const angles = carry ? (carry.a === undefined ? null : { a: carry.a, z: carry.z }) : penAngles(event);
    return angles ? { x, y, p, t, a: angles.a, z: angles.z } : { x, y, p, t };
  }

  /// Annuncia un tratto con `onStart`; `false` se chi lo riceve lo ha già
  /// annullato.
  function announce(s: Stroke): boolean {
    s.id = nextId++;
    options.onStart({
      id: s.id,
      pointerType: s.type,
      pressure: s.pressure,
      timeStamp: s.origin,
      continued: s.continued,
    });
    return alive(s);
  }

  function finished(s: Stroke, split: boolean): FinishedStroke {
    // L'inclinazione si scrive solo se il dispositivo l'ha data davvero, e in
    // ogni campione o in nessuno.
    const tilt = s.tilt && s.samples.every((sample) => sample.a !== undefined);
    const samples = tilt || !s.pressure
      ? s.samples
      : s.samples.map(({ x, y, p, t }): InkSample => (p === undefined ? { x, y, t } : { x, y, p, t }));
    return {
      id: s.id!,
      pointerType: s.type,
      pressure: s.pressure,
      timeStamp: s.origin,
      continued: s.continued,
      samples,
      tilt,
      split,
    };
  }

  /// Consegna i campioni in sospeso e cancella la predizione; `false` se nel
  /// frattempo il tratto è stato annullato.
  function flush(s: Stroke, batch: InkSample[], clearPrediction: boolean): boolean {
    if (batch.length > 0 && s.id !== null) {
      options.onSamples(s.id, batch);
      if (!alive(s)) return false;
    }
    if (clearPrediction && s.predicted && s.id !== null) {
      s.predicted = false;
      options.onPredicted?.(s.id, []);
      if (!alive(s)) return false;
    }
    return true;
  }

  /// Chiude il tratto con `onEnd`. Un tratto mai annunciato (la penna che si
  /// alza senza aver premuto) se ne va in silenzio.
  function finish(s: Stroke, batch: InkSample[]): void {
    if (s.id === null) {
      stroke = null;
      retire(s);
      return;
    }
    if (!flush(s, batch, true)) return;
    stroke = null;
    retire(s);
    options.onEnd(finished(s, false));
  }

  /// Chiude `s` al limite dei campioni e apre la continuazione dal suo ultimo
  /// campione. Restituisce la continuazione, o `null` se una callback ha
  /// annullato il gesto; il primo campione della continuazione, la giunzione,
  /// lo consegna con `onSamples` chi chiama, insieme a quelli che seguono.
  function split(s: Stroke, batch: InkSample[]): Stroke | null {
    if (!flush(s, batch, true)) return null;
    const joint = s.samples[s.samples.length - 1]!;
    const next: Stroke = {
      pointerId: s.pointerId,
      type: s.type,
      pressure: s.pressure,
      continued: true,
      id: null,
      origin: s.origin + joint.t,
      samples: [{ ...joint, t: 0 }],
      last: s.last,
      tilt: s.tilt,
      predicted: false,
    };
    // La continuazione è già il tratto in corso mentre `onEnd` del primo
    // pezzo gira: un `cancel` lì dentro la ferma prima che sia annunciata.
    stroke = next;
    options.onEnd(finished(s, true));
    if (!alive(next) || !announce(next)) return null;
    return next;
  }

  /// Aggiunge gli eventi al tratto: inizio della penna che preme, doppioni,
  /// limite dei campioni. Consegna i campioni nuovi e restituisce il tratto in
  /// corso alla fine, o `null` se una callback lo ha annullato.
  function feed(s: Stroke, events: readonly PointerEvent[]): Stroke | null {
    let current = s;
    let batch: InkSample[] = [];
    for (const event of events) {
      const last = current.last;
      if (last && (event.timeStamp < last.timeStamp || (event.timeStamp === last.timeStamp && sameSample(event, last)))) {
        continue;
      }
      if (current.id === null && current.type === "pen" && !(event.pressure > 0)) continue;
      const point = scenePoint(event);
      if (!point) continue;
      if (current.id === null) {
        current.origin = event.timeStamp;
        if (!announce(current)) return null;
      } else if (current.samples.length >= maxSamples) {
        const next = split(current, batch);
        if (!next) return null;
        current = next;
        batch = [current.samples[0]!];
      }
      const sample = sampleOf(current, event, point);
      current.samples.push(sample);
      batch.push(sample);
      current.last = event;
      if (current.pressure && reportsTilt(event)) current.tilt = true;
    }
    return flush(current, batch, false) ? current : null;
  }

  function predict(s: Stroke, event: PointerEvent): void {
    if (s.id === null || typeof event.getPredictedEvents !== "function") return;
    const predicted: InkSample[] = [];
    for (const future of event.getPredictedEvents()) {
      const point = scenePoint(future);
      if (point) predicted.push(sampleOf(s, future, point));
    }
    // Una predizione vuota dopo una vuota non dice niente.
    if (predicted.length === 0 && !s.predicted) return;
    s.predicted = predicted.length > 0;
    options.onPredicted?.(s.id, predicted);
  }

  life.listen(element, "pointerdown", (event) => {
    // Lo stesso puntatore giù una seconda volta vuol dire che il suo
    // `pointerup` si è perso: un tasto in più del mouse non manda
    // `pointerdown`, e penna e dito si alzano prima di riappoggiarsi. La fine
    // del tratto non si è vista, quindi il tratto si annulla.
    if (stroke?.pointerId === event.pointerId) {
      cancelStroke("lostcapture");
      if (destroyed) return;
    }
    const type = pointerTypeOf(event.pointerType);
    if (type === "pen") notePen(event.pointerId);
    let role = classifyPointer(event, { touch, penSeen, penNear: penNear(), touchesDown: touchesDown() });
    // Un secondo dito: il primo smette di disegnare e diventa navigazione.
    if (type === "touch" && role === "navigate" && stroke?.type === "touch") {
      const first = pointers.get(stroke.pointerId);
      if (first) first.role = "navigate";
      cancelStroke("gesture");
      if (destroyed) return;
    }
    // Un tratto alla volta.
    if (role === "ink" && stroke !== null) role = "ignore";
    pointers.set(event.pointerId, { type, role });
    if (role !== "ink") return;
    capture(event.pointerId);
    const s: Stroke = {
      pointerId: event.pointerId,
      type,
      pressure: type === "pen",
      continued: false,
      id: null,
      origin: event.timeStamp,
      samples: [],
      last: null,
      tilt: false,
      predicted: false,
    };
    stroke = s;
    feed(s, [event]);
  }, { capture: true });

  life.listen(element, "pointermove", (event) => {
    if (event.pointerType === "pen") notePen(event.pointerId);
    const s = stroke;
    if (!s || event.pointerId !== s.pointerId) return;
    // Il tasto principale rilasciato con un altro ancora premuto non manda
    // `pointerup`: il tratto finisce qui.
    if ((event.buttons & PRIMARY_BUTTON) === 0) {
      finish(s, []);
      return;
    }
    const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    // L'evento stesso in coda: dove la lista lo contiene già è un doppione e
    // si scarta, dove non lo contiene è l'ultimo campione.
    const current = feed(s, [...coalesced, event]);
    if (current) predict(current, event);
  }, { capture: true });

  // Sul documento, in cattura: il `pointerup` arriva anche se la cattura non
  // è riuscita e il puntatore si è alzato fuori dalla superficie.
  life.listen(doc, "pointerup", (event) => {
    pointers.delete(event.pointerId);
    const s = stroke;
    if (!s || event.pointerId !== s.pointerId) return;
    if (s.id === null) {
      finish(s, []);
      return;
    }
    // `pointerup` ha la posizione finale ma pressione 0: se il puntatore si è
    // mosso dopo l'ultimo campione, l'ultimo punto prende pressione e
    // inclinazione del campione prima.
    //
    // Un tocco senza movimento avrebbe un campione solo, e di un punto solo
    // `getStroke` fa un trattino verso destra e in basso (aggiunge un punto a
    // +1, +1). Con il campione dell'alzata, anche nello stesso punto, i
    // campioni sono due e il segno è un punto tondo centrato dove si è
    // toccato.
    const last = s.last;
    const batch: InkSample[] = [];
    let current: Stroke | null = s;
    const moved = last === null || s.samples.length === 1
      || event.clientX !== last.clientX || event.clientY !== last.clientY;
    const point = moved && (last === null || event.timeStamp >= last.timeStamp) ? scenePoint(event) : null;
    if (point) {
      if (s.samples.length >= maxSamples) {
        current = split(s, []);
        if (!current) return;
        batch.push(current.samples[0]!);
      }
      const sample = sampleOf(current, event, point, current.samples[current.samples.length - 1]);
      current.samples.push(sample);
      batch.push(sample);
      current.last = event;
    }
    finish(current, batch);
  }, { capture: true });

  life.listen(doc, "pointercancel", (event) => {
    pointers.delete(event.pointerId);
    nearPens.delete(event.pointerId);
    if (stroke?.pointerId === event.pointerId) cancelStroke("pointercancel");
  }, { capture: true });

  life.listen(element, "lostpointercapture", (event) => {
    if (stroke?.pointerId === event.pointerId) cancelStroke("lostcapture");
  });

  // `pointerleave` non risale: senza cattura arriva solo quando il puntatore
  // lascia l'elemento, non i suoi figli. Una penna lo manda anche quando esce
  // dal raggio di hover.
  life.listen(element, "pointerleave", (event) => {
    if (event.pointerType === "pen") nearPens.delete(event.pointerId);
  });

  /// La finestra o la pagina non ricevono più eventi: il tratto si annulla, e
  /// i puntatori ricordati non sono più affidabili.
  function interrupt(reason: CancelReason): void {
    cancelStroke(reason);
    pointers.clear();
    nearPens.clear();
  }

  if (view) life.listen(view, "blur", () => interrupt("blur"));
  life.listen(doc, "visibilitychange", () => {
    if (doc.visibilityState === "hidden") interrupt("hidden");
  });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    life.close();
    cancelStroke("destroy");
    pointers.clear();
    nearPens.clear();
  }
  owner.add(destroy);

  return {
    roleOf: (pointerId) => pointers.get(pointerId)?.role ?? null,
    get penSeen() {
      return penSeen;
    },
    get drawing() {
      return stroke !== null && stroke.id !== null;
    },
    setTouchPolicy(policy) {
      touch = policy;
    },
    cancel() {
      if (!destroyed) cancelStroke("api");
    },
    destroy,
  };
}
