// L'inchiostro effimero del tablet sull'overlay del PC.
//
// I campioni arrivano in coordinate del documento con `ink.pts` e si
// disegnano prima del commit: è la parte della sessione che deve stare nei
// budget di latenza. Ogni tratto si ricostruisce come lo scriverà il commit:
// i campioni portati nelle coordinate del livello, quantizzati come
// `fub:ink`, e il contorno di pf1 con lo stesso pennello. Così, quando
// l'elemento vero arriva, la forma non cambia: l'overlay si toglie nello
// stesso giro in cui il painter disegna l'elemento (`settle`), e nessun
// fotogramma resta senza l'uno o l'altro.
//
// I messaggi di un fotogramma si raccolgono in un solo disegno, e un
// fotogramma in ritardo disegna in un colpo tutti i campioni arrivati, senza
// saltarne. Senza un foglio montato non si disegna niente: i tratti in corso
// tornano a vista appena un foglio si monta (`redraw`).

import type { LiveEvent } from "../../../host/contract";
import { parseBrush, type Pf1Brush } from "../ink/brush";
import { pf1Outline } from "../ink/pf1";
import { INK_MAX_SAMPLES, quantizeInk, type InkSample } from "../ink/sample";
import type { InkPreview } from "../painter/overlay";
import { apply, IDENTITY, invert, type Matrix } from "../scene/matrix";
import type { LiveStage } from "./registry";

type InkBegin = Extract<LiveEvent, { t: "inkBegin" }>;
type InkPoints = Extract<LiveEvent, { t: "inkPoints" }>;

/// Quanto aspetta il commit di un tratto finito prima di toglierlo.
export const INK_COMMIT_MS = 3000;
/// I campioni che l'overlay tiene in tutto: oltre, i tratti più vecchi si
/// buttano, come fa l'host con quelli che la shell non legge.
export const INK_MAX_HELD = 256 * 1024;

interface Stroke {
  readonly s: string;
  readonly layer: string;
  readonly color: string;
  readonly opacity: number;
  readonly brush: Pf1Brush;
  readonly pressure: boolean;
  /// In coordinate del documento, col tempo dal primo campione.
  readonly samples: InkSample[];
  /// Il tempo del primo campione sull'orologio del tablet.
  start: number | null;
  ended: boolean;
  dirty: boolean;
  /// I tempi sul tablet dei campioni non ancora mostrati, per la latenza.
  fresh: number[];
  timer: ReturnType<typeof setTimeout> | null;
}

export interface LiveInkOptions {
  /// I fogli su cui disegnare.
  stages(): readonly LiveStage[];
  /// La latenza di un campione appena mostrato, in millisecondi.
  latency(ms: number): void;
  /// Tratti persi: caduti nell'host, senza commit in tempo, buttati per misura.
  lost(count: number): void;
}

export interface LiveInk {
  /// Un tratto nuovo; `pressure` è falso se lo scrittore non la misura.
  begin(event: InkBegin, pressure: boolean): void;
  points(event: InkPoints): void;
  end(s: string): void;
  cancel(s: string): void;
  /// L'host ha buttato l'inchiostro di questi tratti: il loro commit arriva
  /// lo stesso e li sostituisce.
  gap(strokes: readonly string[]): void;
  /// Il commit di questi tratti ha avuto risposta: l'overlay si toglie
  /// adesso, nello stesso giro del painter.
  settle(ids: Iterable<string>): void;
  /// Lo scrittore è uscito: i tratti non finiti non finiranno.
  abandon(): void;
  /// I fogli sono cambiati, o il documento: tutto si ridisegna.
  redraw(): void;
  /// Lo scarto fra gli orologi, `null` finché non si conosce.
  setClock(offsetMs: number | null): void;
  dispose(): void;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function createLiveInk(options: LiveInkOptions): LiveInk {
  const strokes = new Map<string, Stroke>();
  let held = 0;
  let offset: number | null = null;
  let frame: number | null = null;
  let disposed = false;

  const key = (s: string): string => `live:${s}`;

  const flush = (): void => {
    for (const { stage } of options.stages()) stage.overlay.flush();
  };

  const drop = (stroke: Stroke): void => {
    if (stroke.timer !== null) clearTimeout(stroke.timer);
    stroke.timer = null;
    strokes.delete(stroke.s);
    held -= stroke.samples.length;
    for (const { stage } of options.stages()) stage.overlay.setInk(key(stroke.s), null);
  };

  const preview = (stroke: Stroke, matrix: Matrix): InkPreview | null => {
    if (stroke.samples.length === 0) return null;
    const inverse = matrix === IDENTITY ? null : invert(matrix);
    const local = inverse === null
      ? stroke.samples
      : stroke.samples.map((sample): InkSample => {
          const [x, y] = apply(inverse, [sample.x, sample.y]);
          return sample.p === undefined ? { x, y, t: sample.t } : { x, y, p: sample.p, t: sample.t };
        });
    try {
      const outline = pf1Outline(quantizeInk(local), stroke.brush, { last: stroke.ended });
      return outline.length === 0 ? null : { outline, matrix, color: stroke.color, opacity: stroke.opacity };
    } catch {
      return null;
    }
  };

  const draw = (time: number): void => {
    frame = null;
    if (disposed) return;
    const stages = options.stages();
    if (stages.length === 0) return;
    const shown = stages.some((entry) => entry.visible());
    const now = performance.timeOrigin + time;
    for (const stroke of strokes.values()) {
      if (!stroke.dirty) continue;
      stroke.dirty = false;
      for (const { stage } of stages) {
        // Il livello che il tratto dice; uno che il disegno non ha, o la
        // radice, è l'identità: il commit dirà dove sta davvero.
        stage.overlay.setInk(key(stroke.s), preview(stroke, stage.layerMatrix(stroke.layer) ?? IDENTITY));
      }
      if (shown && offset !== null) for (const at of stroke.fresh) options.latency(now - (at + offset));
      stroke.fresh = [];
    }
    flush();
  };

  const schedule = (): void => {
    if (disposed || frame !== null || options.stages().length === 0) return;
    frame = requestAnimationFrame(draw);
  };

  return {
    begin(event, pressure) {
      if (disposed || strokes.has(event.s)) return;
      let brush: Pf1Brush;
      try {
        brush = parseBrush(event.brush);
      } catch {
        // Un pennello che non si legge non ha un contorno: il commit dirà.
        return;
      }
      strokes.set(event.s, {
        s: event.s,
        layer: event.layer,
        color: event.fill,
        opacity: Number.isFinite(event.fillOpacity) ? clamp01(event.fillOpacity) : 1,
        brush,
        pressure,
        samples: [],
        start: null,
        ended: false,
        dirty: false,
        fresh: [],
        timer: null,
      });
    },
    points(event) {
      const stroke = strokes.get(event.s);
      if (disposed || stroke === undefined || stroke.ended) return;
      const tracking = options.stages().length > 0;
      for (const [x, y, p, at] of event.pts) {
        // Oltre questo il tratto non si scrive: il commit lo dividerà o lo
        // rifiuterà, e l'anteprima resta com'è.
        if (stroke.samples.length >= INK_MAX_SAMPLES) break;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(at)) continue;
        stroke.start ??= at;
        const t = at - stroke.start;
        stroke.samples.push(stroke.pressure ? { x, y, p: Number.isFinite(p) ? clamp01(p) : 0.5, t } : { x, y, t });
        held++;
        if (tracking) stroke.fresh.push(at);
      }
      stroke.dirty = true;
      let lost = 0;
      // I tratti più vecchi per primi: la mappa ricorda l'ordine d'arrivo.
      for (const old of strokes.values()) {
        if (held <= INK_MAX_HELD) break;
        drop(old);
        lost++;
      }
      if (lost > 0) {
        flush();
        options.lost(lost);
      }
      schedule();
    },
    end(s) {
      const stroke = strokes.get(s);
      if (disposed || stroke === undefined || stroke.ended) return;
      stroke.ended = true;
      stroke.dirty = true;
      stroke.timer = setTimeout(() => {
        if (strokes.get(s) !== stroke) return;
        drop(stroke);
        flush();
        options.lost(1);
      }, INK_COMMIT_MS);
      schedule();
    },
    cancel(s) {
      const stroke = strokes.get(s);
      if (stroke === undefined) return;
      drop(stroke);
      flush();
    },
    gap(gone) {
      let lost = 0;
      for (const s of gone) {
        const stroke = strokes.get(s);
        if (stroke !== undefined) drop(stroke);
        lost++;
      }
      flush();
      if (lost > 0) options.lost(lost);
    },
    settle(ids) {
      let any = false;
      for (const id of ids) {
        const stroke = strokes.get(id);
        if (stroke === undefined) continue;
        drop(stroke);
        any = true;
      }
      if (any) flush();
    },
    abandon() {
      let any = false;
      for (const stroke of [...strokes.values()]) {
        if (stroke.ended) continue;
        drop(stroke);
        any = true;
      }
      if (any) flush();
    },
    redraw() {
      for (const stroke of strokes.values()) stroke.dirty = true;
      schedule();
    },
    setClock(offsetMs) {
      offset = offsetMs;
    },
    dispose() {
      if (disposed) return;
      for (const stroke of [...strokes.values()]) drop(stroke);
      flush();
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
