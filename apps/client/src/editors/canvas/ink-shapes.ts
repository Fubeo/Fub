// Le forme dal tratto, Maiusc e il righello sulla lavagna (T87). Una forma
// resta un tratto `fub:ink` (D-22 (a)): la stessa penna, lo stesso colore, lo
// stesso spessore, coi campioni lungo il suo contorno. Nessun formato nuovo.
//
// - **La penna ferma.** Un tratto a penna tenuto fermo mezzo secondo alla fine
//   diventa la forma a cui somiglia (`heldShape` del disegno): una linea, una
//   freccia, un rettangolo, un'ellisse, un poligono o una stella. Sotto
//   `HOLD_MIN_PX` sullo schermo resta inchiostro: è la misura della scrittura.
//   Finché la penna resta giù, muoverla regola la forma come nel disegno: la
//   fine di una linea la segue, una forma chiusa gira e cresce attorno al suo
//   centro; Maiusc la fa regolare (`regular`). All'alzata la lavagna scrive il
//   tratto com'era e poi la forma al suo posto: due passi d'annulla.
// - **Maiusc** durante il tratto lo tiene dritto dal primo punto all'ultimo, a
//   passi di `RULER_STEP` gradi; premuto a metà tratto, il tratto si raddrizza
//   da lì in poi, perché conta il tasto all'alzata.
// - **Il righello.** Un tratto che comincia vicino a un suo bordo lo segue: ogni
//   campione va sul bordo (`rulerEdge`, `alongEdge`). La misura del righello è
//   sullo schermo: nella lavagna è divisa per lo zoom di quando il tratto
//   comincia.
// - **L'evidenziatore** non diventa una forma, come nel disegno; Maiusc e il
//   righello valgono anche per lui.
//
// Il riconoscimento non corre a ogni campione: `add` guarda soltanto se la
// punta è uscita dal punto fermo; la forma si cerca una volta, quando il mezzo
// secondo è passato (`hold`).

import { straight } from "../../ink/geometry";
import type { InkPointerType } from "../../ink/input/pointer";
import { INK_MAX_SAMPLES, type InkSample } from "../../ink/sample";
import type { Point } from "../spatial/scene/matrix";
import { polygonalVertices } from "../spatial/scene/parametric";
import { centerOf, heldShape, regular, similar, starOf, type Recognized } from "../spatial/tools/recognize";
import { alongEdge, RULER_STEP, RULER_WIDTH_PX, rulerEdge, type Ruler, type RulerEdge } from "../spatial/tools/ruler";

export { HOLD_MIN_PX } from "../spatial/tools/recognize";
export type { Recognized } from "../spatial/tools/recognize";
export type { Ruler } from "../spatial/tools/ruler";

/** Quanto resta ferma la punta alla fine di un tratto perché diventi una forma, in millisecondi. */
export const HOLD_MS = 500;

/** Quanto può tremare la punta che sta ferma, in pixel: la penna e il dito non stanno mai fermi del tutto, il mouse sì. */
export const HOLD_PX: Readonly<Record<InkPointerType, number>> = { pen: 4, mouse: 3, touch: 8 };

/** Quanto vicino a un bordo del righello, in pixel dello schermo, un tratto lo segue (come nel disegno). */
export const RULER_REACH_PX: Readonly<Record<InkPointerType, number>> = { pen: 16, mouse: 12, touch: 24 };

/** La distanza fra i campioni lungo il contorno di una forma, in unità della lavagna: quella di un tratto tirato dritto. */
const SHAPE_STEP = 1.5;

/** I lati della punta di una freccia, in gradi dall'asta, come la freccia del disegno. */
const HEAD_DEGREES = 30;

/** Il contorno di una forma: i suoi vertici in ordine, e se torna al primo. */
export interface ShapeOutline {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

/**
 * La forma del tratto `points` (coordinate della lavagna) tenuto fermo alla
 * fine, con lo zoom `zoom` e la punta che trema entro `still` pixel: `null`
 * per un tratto piccolo quanto la scrittura o che non somiglia a una forma.
 */
export function inkShapeOf(points: readonly Point[], zoom: number, still: number): Recognized | null {
  if (!(zoom > 0) || points.length < 2) return null;
  return heldShape(points, zoom, still);
}

/** Le sei forme che un tratto diventa, come si dicono. */
export type InkShapeKind = "line" | "arrow" | "rect" | "ellipse" | "polygon" | "star";

/** Quale delle sei forme è `shape`: un poligono che si incrocia a passi uguali è una stella. */
export function shapeKind(shape: Recognized): InkShapeKind {
  switch (shape.kind) {
    case "regular":
      return shape.ratio === null ? "polygon" : "star";
    case "polygon":
      return starOf(shape.points) === null ? "polygon" : "star";
    default:
      return shape.kind;
  }
}

/** `p` girato di `angle` gradi attorno a `center`. */
function turned(p: Point, center: Point, angle: number): Point {
  const radians = (angle * Math.PI) / 180;
  const [dx, dy] = [p[0] - center[0], p[1] - center[1]];
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
}

/**
 * I vertici della forma `shape` per un tratto largo `width`: la freccia è
 * l'asta e la punta aperta in un tratto solo (l'asta, un lato, di nuovo la
 * cima, l'altro lato), con la punta lunga 3 × `width` + 6 come quella del
 * disegno, mai più di metà asta; l'ellisse è un poligono fitto, con
 * `ellipseSides` lati.
 */
export function shapeOutline(shape: Recognized, width: number, ellipseSides = 96): ShapeOutline {
  switch (shape.kind) {
    case "line":
      return { points: [shape.from, shape.to], closed: false };
    case "arrow": {
      const { from, to } = shape;
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const head = Math.min(3 * width + 6, length / 2);
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
      const side = (HEAD_DEGREES * Math.PI) / 180;
      const left: Point = [to[0] - head * Math.cos(angle - side), to[1] - head * Math.sin(angle - side)];
      const right: Point = [to[0] - head * Math.cos(angle + side), to[1] - head * Math.sin(angle + side)];
      return { points: [from, to, left, to, right], closed: false };
    }
    case "rect": {
      const { center, width: w, height: h, angle } = shape;
      const [x, y] = center;
      const corners: Point[] = [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]];
      return { points: corners.map((p) => turned(p, center, angle)), closed: true };
    }
    case "ellipse": {
      const { center, rx, ry, angle } = shape;
      const sides = Math.max(8, Math.floor(ellipseSides));
      const points: Point[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (2 * Math.PI * k) / sides;
        points.push(turned([center[0] + rx * Math.cos(a), center[1] + ry * Math.sin(a)], center, angle));
      }
      return { points, closed: true };
    }
    case "polygon":
      return { points: shape.points, closed: true };
    case "regular":
      return {
        points: polygonalVertices({
          shape: shape.ratio === null ? "polygon" : "star",
          cx: shape.center[0],
          cy: shape.center[1],
          r: shape.r,
          count: shape.count,
          ratio: shape.ratio,
          rotation: shape.angle,
          corner: 0,
        }),
        closed: true,
      };
  }
}

/** La lunghezza del giro di `points`, chiuso se `closed`. */
function perimeter(points: readonly Point[], closed: boolean): number {
  let length = 0;
  const n = points.length;
  for (let i = 1; i < n + (closed ? 1 : 0); i++) {
    const a = points[i - 1]!;
    const b = points[i % n]!;
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}

/**
 * I punti lungo `outline`, al più `max`: ogni vertice, e fra un vertice e
 * l'altro un punto ogni `SHAPE_STEP` unità, o meno fitti se non ci stanno.
 * Un contorno chiuso torna al primo vertice. I vertici restano sempre, così gli
 * spigoli restano vivi; se da soli sono più di `max`, si tengono i primi.
 */
export function outlinePoints(outline: ShapeOutline, max: number = INK_MAX_SAMPLES): Point[] {
  const vertices = outline.closed && outline.points.length > 0 ? [...outline.points, outline.points[0]!] : [...outline.points];
  if (vertices.length <= 1 || vertices.length >= max) return vertices.slice(0, Math.max(1, max));
  const length = perimeter(vertices, false);
  const room = max - vertices.length;
  const step = Math.max(SHAPE_STEP, length / Math.max(1, room));
  const out: Point[] = [vertices[0]!];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Un punto ogni `step`, senza contare il vertice d'arrivo: i punti in mezzo
    // di tutti i lati insieme non superano `room`.
    const inner = Math.max(0, Math.ceil(span / step) - 1);
    for (let k = 1; k <= inner; k++) {
      const f = k / (inner + 1);
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    out.push(b);
  }
  return out.length <= max ? out : vertices;
}

/** La mediana dei valori `values`; `undefined` se non ce ne sono. */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * I campioni di un tratto che disegna la forma `shape`, come quelli del tratto
 * `like` da cui viene: la pressione è la mediana della sua (assente se il
 * tratto non l'aveva), l'inclinazione quella del suo primo campione, e il
 * tempo va da 0 alla sua durata, sempre in avanti di almeno un millisecondo.
 * Uno spessore uguale lungo tutta la forma: la punta corre a passi uguali.
 */
export function shapeSamples(shape: Recognized, like: readonly InkSample[], width: number): InkSample[] {
  const sides = Math.max(8, Math.min(96, INK_MAX_SAMPLES - 2));
  const points = outlinePoints(shapeOutline(shape, width, sides));
  const pressures = like.flatMap((sample) => (sample.p === undefined ? [] : [sample.p]));
  const p = median(pressures);
  const first = like[0];
  const tilt = first?.a !== undefined ? { a: first.a, z: first.z } : {};
  const duration = Math.max(like[like.length - 1]?.t ?? 0, points.length - 1);
  const k = points.length > 1 ? duration / (points.length - 1) : 0;
  return points.map(([x, y], i): InkSample => ({ x, y, t: Math.round(i * k), ...(p === undefined ? {} : { p }), ...tilt }));
}

/** La scia di un tratto guidato: i campioni da disegnare al posto di quelli presi. */
export interface GuidedTrail {
  readonly samples: readonly InkSample[];
  readonly predicted: readonly InkSample[];
  /**
   * `false`: i campioni crescono in coda come quelli presi (il righello), e
   * l'anteprima li prende un pezzo alla volta. `true`: cambiano tutti a ogni
   * evento (la linea dritta, la forma), e l'anteprima li rifà da capo.
   */
  readonly whole: boolean;
}

/** Che cosa scrivere all'alzata: il tratto, e la forma che prende il suo posto in un secondo passo. */
export interface GuidedStroke {
  readonly samples: readonly InkSample[];
  readonly shape: readonly InkSample[] | null;
}

export interface StrokeGuideOptions {
  readonly pointer: InkPointerType;
  /** Lo strumento del tratto: solo `pen` diventa una forma. */
  readonly tool: string;
  /** Lo spessore del pennello, in unità della lavagna. */
  readonly size: number;
  /** Lo zoom della lavagna quando il tratto comincia. */
  readonly zoom: number;
  /** Il righello sulla lavagna, se c'è. */
  readonly ruler: Ruler | null;
  /** Il pezzo continua un tratto spezzato al limite dei campioni: né Maiusc né forme. */
  readonly continued: boolean;
  /** Maiusc tenuto adesso. */
  readonly shift: () => boolean;
}

/** La forma presa dalla penna ferma e quanto la punta l'ha regolata dopo. */
interface Held {
  readonly shape: Recognized;
  readonly from: Point;
  end: Point;
  moved: boolean;
}

/**
 * Il tratto della punta in corso, guidato dal righello, da Maiusc o dalla penna
 * ferma. Si crea quando il tratto comincia e vive fino all'alzata.
 */
export class StrokeGuide {
  readonly #options: StrokeGuideOptions;
  /** Il bordo del righello che il tratto segue: deciso al primo campione; `undefined` prima. */
  #edge: RulerEdge | null | undefined = undefined;
  /** I campioni sul bordo del righello, uno per campione preso, nello stesso ordine. */
  readonly #ruled: InkSample[] = [];
  /** I punti presi, per la forma. */
  readonly #points: Point[] = [];
  /** Il punto fermo: da quando la punta non ne è uscita corre il mezzo secondo. */
  #still: Point | null = null;
  #held: Held | null = null;
  /** L'ultima scia della forma, finché la punta e Maiusc non cambiano. */
  #shown: { readonly key: string; readonly samples: InkSample[] } | null = null;

  constructor(options: StrokeGuideOptions) {
    this.#options = options;
  }

  /** Il tremito della punta ferma, in unità della lavagna. */
  get #stillRadius(): number {
    return HOLD_PX[this.#options.pointer] / this.#options.zoom;
  }

  /** Il tratto può diventare una forma: la penna, senza righello, non un pezzo che continua. */
  get holds(): boolean {
    return this.#options.tool === "pen" && !this.#options.continued && this.#edge === null;
  }

  /** Il tratto segue il bordo del righello. */
  get ruled(): boolean {
    return this.#edge !== null && this.#edge !== undefined;
  }

  /** La penna ferma ha fatto del tratto una forma. */
  get shaped(): boolean {
    return this.#held !== null;
  }

  /**
   * Campioni nuovi del tratto. `true` se la punta è uscita dal punto fermo: il
   * mezzo secondo riparte. Un confronto per campione, nessun riconoscimento.
   */
  add(samples: readonly InkSample[]): boolean {
    if (samples.length === 0) return false;
    if (this.#edge === undefined) this.#edge = this.#edgeAt(samples[0]!);
    const edge = this.#edge;
    if (edge !== null) {
      for (const sample of samples) this.#ruled.push(alongEdge(sample, edge));
      return false;
    }
    const radius = this.#stillRadius;
    const held = this.#held;
    if (held !== null) {
      const last = samples[samples.length - 1]!;
      held.end = [last.x, last.y];
      if (!held.moved && Math.hypot(last.x - held.from[0], last.y - held.from[1]) > radius) held.moved = true;
      return false;
    }
    let restart = false;
    for (const sample of samples) {
      this.#points.push([sample.x, sample.y]);
      if (this.#still !== null && Math.hypot(sample.x - this.#still[0], sample.y - this.#still[1]) <= radius) continue;
      this.#still = [sample.x, sample.y];
      restart = true;
    }
    return restart && this.holds;
  }

  #edgeAt(first: InkSample): RulerEdge | null {
    const { ruler, zoom, pointer, size } = this.#options;
    if (ruler === null || !(zoom > 0)) return null;
    return rulerEdge(ruler, [first.x, first.y], RULER_WIDTH_PX / 2 / zoom, RULER_REACH_PX[pointer] / zoom, size / 2);
  }

  /**
   * Il mezzo secondo fermo è passato: il tratto diventa la sua forma, se ne ha
   * una e Maiusc non lo tiene già dritto. `true` se l'è diventata.
   */
  hold(): boolean {
    if (this.#held !== null || this.#still === null || !this.holds || this.#options.shift()) return false;
    // Dall'ultimo punto fermo in poi la punta trema: `heldShape` non lo conta.
    const shape = inkShapeOf(this.#points, this.#options.zoom, HOLD_PX[this.#options.pointer]);
    if (shape === null) return false;
    this.#held = { shape, from: this.#still, end: this.#still, moved: false };
    return true;
  }

  /** La forma di adesso: regolata dalla punta dopo la presa, regolare con Maiusc. */
  shapeNow(): Recognized | null {
    const held = this.#held;
    if (held === null) return null;
    let shape = held.shape;
    if (held.moved) {
      const { from, end } = held;
      if (shape.kind === "line" || shape.kind === "arrow") {
        shape = { ...shape, to: [shape.to[0] + end[0] - from[0], shape.to[1] + end[1] - from[1]] };
      } else {
        const c = centerOf(shape);
        const before = Math.hypot(from[0] - c[0], from[1] - c[1]);
        if (before > 0) {
          const turn = ((Math.atan2(end[1] - c[1], end[0] - c[0]) - Math.atan2(from[1] - c[1], from[0] - c[0])) * 180) / Math.PI;
          shape = similar(shape, c, Math.hypot(end[0] - c[0], end[1] - c[1]) / before, turn);
        }
      }
    }
    return this.#options.shift() ? regular(shape) : shape;
  }

  /** I campioni della forma di adesso, tenuti finché la punta e Maiusc non cambiano. */
  #shapeSamples(like: readonly InkSample[]): InkSample[] | null {
    const held = this.#held;
    if (held === null) return null;
    const key = `${held.moved ? held.end.join(",") : ""}|${this.#options.shift() ? 1 : 0}`;
    if (this.#shown?.key === key) return this.#shown.samples;
    const shape = this.shapeNow();
    if (shape === null) return null;
    const samples = shapeSamples(shape, like, this.#options.size);
    this.#shown = { key, samples };
    return samples;
  }

  /** Maiusc raddrizza il tratto: non un pezzo che continua, non sul righello, non una forma. */
  #straightened(): boolean {
    return !this.#options.continued && !this.ruled && this.#held === null && this.#options.shift();
  }

  /**
   * Come si vede adesso il tratto coi campioni presi `samples` e quelli
   * predetti `predicted`; `null` se si vede com'è.
   */
  trail(samples: readonly InkSample[], predicted: readonly InkSample[]): GuidedTrail | null {
    const edge = this.#edge;
    if (edge) return { samples: this.#ruled, predicted: predicted.map((sample) => alongEdge(sample, edge)), whole: false };
    const shape = this.#shapeSamples(samples);
    if (shape !== null) return { samples: shape, predicted: [], whole: true };
    if (this.#straightened() && samples.length > 0) return { samples: straight(samples, RULER_STEP), predicted: [], whole: true };
    return null;
  }

  /**
   * Che cosa scrivere all'alzata del tratto `samples` (spezzato al limite se
   * `split`): sul righello, i campioni sul bordo; con Maiusc, la linea dritta;
   * con la forma, il tratto com'era e la forma.
   */
  finish(samples: readonly InkSample[], split: boolean): GuidedStroke {
    const edge = this.#edge;
    if (edge) return { samples: samples.map((sample) => alongEdge(sample, edge)), shape: null };
    if (split) return { samples, shape: null };
    const shape = this.#shapeSamples(samples);
    if (shape !== null) return { samples, shape };
    if (this.#straightened() && samples.length > 0) return { samples: straight(samples, RULER_STEP), shape: null };
    return { samples, shape: null };
  }
}
