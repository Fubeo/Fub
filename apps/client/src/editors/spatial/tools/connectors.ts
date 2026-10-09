// I connettori nell'editor (Disegni, connettori; formato della scena,
// connettori): dove un capo tocca l'oggetto a cui è agganciato, che strada
// fa la linea fra i due capi, e come linee ed etichette seguono gli oggetti.
//
// - **Si calcola nella scena.** I contorni, i capi e il percorso stanno nelle
//   coordinate della radice; il percorso si scrive poi in quelle del
//   connettore, che può stare in un altro livello o in un gruppo.
// - **Il capo tocca il bordo che si vede.** Il raggio dal centro
//   dell'oggetto verso il punto d'aggancio esce dal contorno disegnato, le
//   corde della sua geometria, più mezzo spessore del contorno: una linea
//   verso un cerchio o un triangolo ne tocca il bordo, non il riquadro. Un
//   gruppo ha il contorno dei suoi oggetti visibili; un contorno di troppe
//   corde, o che il raggio non incontra, è il riquadro.
// - **Il gomito** è il percorso più corto su una griglia di righe e colonne
//   che passano per le uscite dei due capi, per i bordi dei due oggetti
//   allargati dell'uscita e per le vie di mezzo: nessun tratto entra nei due
//   oggetti, ogni curva costa, e a parità vince la via di mezzo. Gira attorno
//   ai due oggetti che unisce, non agli altri.
// - **Seguire** ([`followConnectors`]) è un seguito del motore: dopo ogni
//   operazione, i connettori di ciò che è cambiato si ricalcolano nello
//   stesso passo e nello stesso annulla, e le loro etichette con loro.
//   Spostare un connettore da solo ne stacca i capi; togliere un oggetto
//   stacca il capo che vi era agganciato. Un connettore o un'etichetta in un
//   livello o in un gruppo bloccato non si riscrivono, come vuole il motore.

import type { Role } from "../scene/analysis";
import type { ConnectorFacts } from "../scene/classify";
import { formatNumber, roundHalfUp } from "../number";
import { connectorAttrs, connectorPath, connectorSegments, writeConnectorEnd, writeConnectorGeom, writeLabelPlace, type Anchor, type ConnectorEnd, type ConnectorKind, type LabelPlace } from "../scene/connectors";
import { BoundsBuilder, chords, Track, type Bounds, type Segment } from "../scene/geometry";
import { apply, compose, IDENTITY, invert, translate, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { length } from "../scene/values";
import { elemOf, fubAttributes, plainAttributes } from "./arrange";
import { gesture, transformValue, type Destination, type NewIds } from "./edit";
import { strokeHalf, textExtent } from "./effects";
import { among, Changes, lockedAbove, movedBy, namedBy, SceneMatrices, touchedBy } from "./follow";
import { labelTarget } from "./label-hosts";
import { shapeSegments, type Unit } from "./hit";
import type { Measure } from "./measure";

/// Quanto un gomito esce dritto da un oggetto prima di girare, e quanto
/// gira lontano dai due oggetti che unisce.
export const STUB = 20;

/// Quanto costa una curva di un gomito, in lunghezza: un giro più lungo di
/// 40 unità vale una curva in meno.
const BEND = 2 * STUB;

/// Le corde oltre le quali il contorno di un oggetto è il suo riquadro: un
/// gruppo di mille tracciati non rallenta un trascinamento.
const MAX_CHORDS = 4000;

/// La distanza di partenza fra un'etichetta e la sua linea.
export const LABEL_GAP = 4;

/// Sotto questo spostamento un'etichetta resta dov'è: un `transform` scritto
/// arrotonda, e rifare il conto non deve riscriverlo.
const LABEL_STILL = 0.01;

/// La distanza sotto la quale due coordinate sono la stessa.
const EPSILON = 1e-6;

type Side = Exclude<Anchor, "auto" | "center">;

type Chord = readonly [Point, Point];

// ---------------------------------------------------------------------------
// A che cosa ci si aggancia.
// ---------------------------------------------------------------------------

/// I ruoli degli oggetti a cui un capo si aggancia.
const ATTACHABLE: ReadonlySet<Role> = new Set<Role>([
  "group",
  "link",
  "stroke",
  "arrow",
  "ngon",
  "star",
  "width",
  "path",
  "rect",
  "ellipse",
  "circle",
  "line",
  "polyline",
  "polygon",
  "text",
  "image",
]);

/// Vero se un capo si aggancia a `node`: un oggetto, non un livello, la
/// carta, una tavola, una risorsa o un altro connettore. Un oggetto senza id
/// ne riceve uno quando ci si aggancia.
export function attachable(node: ElementPart): boolean {
  const role = node.details?.role;
  return role !== undefined && ATTACHABLE.has(role);
}

/// Vero se `container` contiene `node`, `node` escluso.
function holds(container: ElementPart, node: ElementPart): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at === container) return true;
  return false;
}

/// L'oggetto a cui `connector` si può agganciare con l'id `id`; `null` se
/// non c'è o non vale: un capo così è libero.
export function targetOf(connector: ElementPart, id: string, find: (id: string) => ElementPart | null): ElementPart | null {
  const node = find(id);
  return node !== null && node !== connector && attachable(node) && !holds(node, connector) ? node : null;
}

// ---------------------------------------------------------------------------
// Piccoli conti.
// ---------------------------------------------------------------------------

const plus = (p: Point, v: Point, k: number): Point => [p[0] + v[0] * k, p[1] + v[1] * k];

const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/// `v` lungo 1; `null` per un vettore nullo.
function unit([x, y]: Point): Point | null {
  const l = Math.hypot(x, y);
  return l > EPSILON ? [x / l, y / l] : null;
}

/// `v` dopo la parte lineare di `m`.
const linear = (m: Matrix, [x, y]: Point): Point => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];

/// Di quanto `m` allarga le lunghezze, in media.
const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/// I quattro lati di `box`, in giro.
function boxChords({ min, max }: Bounds): Chord[] {
  const corners: Point[] = [min, [max[0], min[1]], max, [min[0], max[1]]];
  return corners.map((p, i) => [p, corners[(i + 1) % 4]!] as const);
}

// ---------------------------------------------------------------------------
// Il contorno di un oggetto.
// ---------------------------------------------------------------------------

/// Il contorno di un oggetto nelle sue coordinate: le corde, `null` se sono
/// troppe; il riquadro; mezzo spessore del contorno più largo.
interface Local {
  readonly chords: readonly Chord[] | null;
  readonly frame: Bounds;
  readonly reach: number;
}

/// Vero se `node` disegna qualcosa che fa parte del contorno di chi lo
/// contiene: non i titoli, le descrizioni, i connettori, gli estranei, ciò
/// che è nascosto e le etichette nelle forme, che un connettore non tocca
/// nemmeno quando escono dalla loro forma.
function outlined(node: ElementPart): boolean {
  const details = node.details;
  if (details === null || details.hidden === true) return false;
  if (details.inside !== undefined && labelTarget(node) !== null) return false;
  return details.role !== "title" && details.role !== "desc" && details.role !== "connector";
}

/// Le corde di una foglia nelle sue coordinate: la sua geometria, o il
/// riquadro di un testo o di un'immagine; vuote se non disegna niente che si
/// sappia.
function leafChords(node: ElementPart, measure: Measure): readonly Chord[] {
  const elem = elemOf(node);
  if (elem === null) return [];
  if (elem.tag === "text") {
    const box = textExtent(node, measure);
    return box === null ? [] : boxChords(box);
  }
  if (elem.tag === "image") {
    const x = length(elem.attrs.x ?? "0");
    const y = length(elem.attrs.y ?? "0");
    const width = elem.attrs.width === undefined ? null : length(elem.attrs.width);
    const height = elem.attrs.height === undefined ? null : length(elem.attrs.height);
    if (x === null || y === null || width === null || height === null || !(width > 0) || !(height > 0)) return [];
    return boxChords({ min: [x, y], max: [x + width, y + height] });
  }
  return chords(shapeSegments(elem.tag, Object.entries(elem.attrs)));
}

/// Il contorno di `node` nelle sue coordinate, prima del suo `transform`;
/// `null` se non disegna niente che si sappia.
function localOf(node: ElementPart, measure: Measure, own: (node: ElementPart) => Matrix): Local | null {
  const frame = new BoundsBuilder();
  const out: Chord[] = [];
  let full = true;
  let reach = 0;
  const visit = (part: ElementPart, m: Matrix): void => {
    if (part.kind === "container") {
      for (const child of elementChildren(part)) if (outlined(child)) visit(child, compose(m, own(child)));
      return;
    }
    const found = leafChords(part, measure);
    if (found.length === 0) return;
    reach = Math.max(reach, strokeHalf(part) * scaleOf(m));
    for (const [a, b] of found) {
      const p = apply(m, a);
      const q = apply(m, b);
      frame.include(p);
      frame.include(q);
      if (!full) continue;
      if (out.length >= MAX_CHORDS) {
        full = false;
        out.length = 0;
        continue;
      }
      out.push([p, q]);
    }
  };
  visit(node, IDENTITY);
  const box = frame.finish();
  return box === null ? null : { chords: full ? out : null, frame: box, reach };
}

/// Il contorno di un oggetto nella scena, come lo usano i capi.
export interface Outline {
  /// Le corde del contorno.
  readonly chords: readonly Chord[];
  /// Il riquadro nelle coordinate dell'oggetto, prima del suo `transform`.
  readonly frame: Bounds;
  /// Dalle coordinate dell'oggetto alla scena.
  readonly matrix: Matrix;
  /// Il centro del riquadro, nella scena.
  readonly centre: Point;
  /// Mezzo spessore del contorno, nella scena.
  readonly reach: number;
  /// Il riquadro nella scena, contorno compreso.
  readonly box: Bounds;
}

/// Vero se le due matrici hanno gli stessi sei numeri.
function sameMatrix(a: Matrix, b: Matrix): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5];
}

/// Chi legge i contorni e le matrici della scena per un'operazione o per un
/// gesto: ogni oggetto si legge una volta, e il suo contorno si ricalcola
/// soltanto se la sua matrice è cambiata. `shift` dice di quanto un gesto in
/// corso porta un oggetto nella scena, `null` per niente: il trascinamento
/// sposta i contorni senza rileggerli.
export class Router {
  private readonly locals = new Map<ElementPart, Local | null>();
  private readonly matrices = new SceneMatrices();
  private readonly seen = new Map<ElementPart, { readonly matrix: Matrix; readonly outline: Outline | null }>();
  private readonly extents = new Map<ElementPart, Bounds | null>();
  shift: (node: ElementPart) => Matrix | null = () => null;

  constructor(private readonly measure: Measure) {}

  /// Dalle coordinate di `node` alla scena, col suo `transform`.
  matrixOf(node: ElementPart): Matrix {
    const moved = this.shift(node);
    const base = this.matrices.of(node);
    return moved === null ? base : compose(moved, base);
  }

  /// Il `transform` di `node` da solo: si legge una volta.
  own(node: ElementPart): Matrix {
    return this.matrices.own(node);
  }

  /// Il riquadro delle righe del testo `node`, nelle sue coordinate; `null`
  /// se non ne ha. Il testo non cambia durante un gesto: si misura una volta.
  extent(node: ElementPart): Bounds | null {
    let box = this.extents.get(node);
    if (box === undefined) {
      box = textExtent(node, this.measure);
      this.extents.set(node, box);
    }
    return box;
  }

  /// Il contorno di `node` nella scena; `null` se non disegna niente che si
  /// sappia. Chi lo chiede due volte con la stessa matrice riceve lo stesso
  /// contorno.
  outline(node: ElementPart): Outline | null {
    let local = this.locals.get(node);
    if (local === undefined) {
      local = localOf(node, this.measure, (part) => this.own(part));
      this.locals.set(node, local);
    }
    if (local === null) return null;
    const m = this.matrixOf(node);
    const known = this.seen.get(node);
    if (known !== undefined && sameMatrix(known.matrix, m)) return known.outline;
    const outline = outlineIn(local, m);
    this.seen.set(node, { matrix: m, outline });
    return outline;
  }
}

/// Il contorno di `local` portato nella scena da `m`. Le corde di un
/// contorno si seguono: il punto dove una finisce è quello dove comincia la
/// prossima, e si porta una volta sola.
function outlineIn(local: Local, m: Matrix): Outline | null {
  const lines: Chord[] = [];
  const out = new BoundsBuilder();
  let before: Point | null = null;
  let after: Point | null = null;
  for (const [a, b] of local.chords ?? boxChords(local.frame)) {
    let p: Point;
    if (before !== null && Object.is(a[0], before[0]) && Object.is(a[1], before[1])) {
      p = after!;
    } else {
      p = apply(m, a);
      out.include(p);
    }
    const q = apply(m, b);
    out.include(q);
    lines.push([p, q]);
    before = b;
    after = q;
  }
  const box = out.finish();
  if (box === null) return null;
  const reach = local.reach * scaleOf(m);
  const { min, max } = local.frame;
  return {
    chords: lines,
    frame: local.frame,
    matrix: m,
    centre: apply(m, [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2]),
    reach,
    box: { min: [box.min[0] - reach, box.min[1] - reach], max: [box.max[0] + reach, box.max[1] + reach] },
  };
}

// ---------------------------------------------------------------------------
// I capi.
// ---------------------------------------------------------------------------

/// Dove un capo tocca l'oggetto, e da che parte ne esce la linea.
export interface Port {
  readonly at: Point;
  /// La direzione in cui la linea lascia il capo, lunga 1.
  readonly dir: Point;
  /// Il riquadro dell'oggetto nella scena; `null` per un capo libero.
  readonly box: Bounds | null;
}

/// Dove il raggio da `from` lungo `u`, lungo 1, esce dalle corde `lines`: la
/// distanza più lontana entro `limit`, o comunque la più lontana; `null` se il
/// raggio non le incontra.
function farthest(lines: readonly Chord[], from: Point, u: Point, limit: number): number | null {
  // Le distanze non sono mai negative: -1 vuol dire nessuna.
  let near = -1;
  let far = -1;
  for (const [a, b] of lines) {
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const across = u[0] * ey - u[1] * ex;
    if (Math.abs(across) < 1e-12) continue;
    const wx = a[0] - from[0];
    const wy = a[1] - from[1];
    const s = (wx * ey - wy * ex) / across;
    const t = (wx * u[1] - wy * u[0]) / across;
    if (!(s >= -EPSILON && t >= -EPSILON && t <= 1 + EPSILON)) continue;
    const reach = Math.max(0, s);
    if (reach > far) far = reach;
    if (reach <= limit + EPSILON && reach > near) near = reach;
  }
  return far < 0 ? null : near >= 0 ? near : far;
}

/// Il capo sul raggio dal centro di `o` lungo `u`: dove il raggio esce dal
/// contorno per l'ultima volta entro `limit`, o comunque per l'ultima volta,
/// più mezzo spessore del contorno. Un raggio che non incontra il contorno,
/// come quello di un tracciato aperto, esce dal riquadro.
function cast(o: Outline, u: Point, limit: number): Port {
  const s = farthest(o.chords, o.centre, u, limit) ?? farthest(boxChords(o.frame).map(([a, b]): Chord => [apply(o.matrix, a), apply(o.matrix, b)]), o.centre, u, limit) ?? 0;
  return { at: plus(o.centre, u, s + o.reach), dir: u, box: o.box };
}

/// Le direzioni dei lati nelle coordinate di un oggetto.
const SIDE_DIRS: Readonly<Record<Side, Point>> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

const isSide = (anchor: Anchor): anchor is Side => anchor !== "auto" && anchor !== "center";

/// I capi sui lati di un contorno già calcolati: un contorno ha quattro lati,
/// e ogni connettore agganciato lo chiede più volte.
const SIDE_PORTS = new WeakMap<Outline, Partial<Record<Side, Port>>>();

/// Il capo al centro del lato `side` di `o`, nel verso dell'oggetto: dove il
/// raggio dal centro verso il punto di mezzo di quel lato esce dal contorno.
function sidePort(o: Outline, side: Side): Port {
  let ports = SIDE_PORTS.get(o);
  if (ports === undefined) {
    ports = {};
    SIDE_PORTS.set(o, ports);
  }
  return (ports[side] ??= cast(o, unit(linear(o.matrix, SIDE_DIRS[side])) ?? SIDE_DIRS[side], Infinity));
}

/// Il capo di `o` sulla linea dal suo centro verso `aim`.
function towardPort(o: Outline, aim: Point): Port {
  const v: Point = [aim[0] - o.centre[0], aim[1] - o.centre[1]];
  return cast(o, unit(v) ?? [1, 0], Math.hypot(v[0], v[1]));
}

/// Il lato di `o` rivolto verso `aim`: il riquadro diviso dalle diagonali,
/// nelle coordinate dell'oggetto.
function facing(o: Outline, aim: Point): Side {
  const back = invert(o.matrix);
  const [x, y] = back === null ? aim : apply(back, aim);
  const { min, max } = o.frame;
  const dx = (x - (min[0] + max[0]) / 2) / Math.max((max[0] - min[0]) / 2, EPSILON);
  const dy = (y - (min[1] + max[1]) / 2) / Math.max((max[1] - min[1]) / 2, EPSILON);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/// Un capo da calcolare: l'oggetto a cui è agganciato, col suo contorno, e
/// l'aggancio; o, senza contorno, un capo libero col suo punto.
export interface EndSpec {
  readonly outline: Outline | null;
  readonly anchor: Anchor;
  /// Dove sta il capo libero, nella scena.
  readonly free: Point;
}

/// Il punto che l'altro capo guarda di `end`: il suo punto, se è libero o
/// agganciato a un lato; altrimenti il centro del suo oggetto.
function aimOf(end: EndSpec): Point {
  if (end.outline === null) return end.free;
  return isSide(end.anchor) ? sidePort(end.outline, end.anchor).at : end.outline.centre;
}

/// Il capo `end` di una linea di tipo `kind` che guarda `aim`.
function portOf(end: EndSpec, aim: Point, kind: ConnectorKind): Port {
  const o = end.outline;
  if (o === null) return { at: end.free, dir: unit([aim[0] - end.free[0], aim[1] - end.free[1]]) ?? [1, 0], box: null };
  if (isSide(end.anchor)) return sidePort(o, end.anchor);
  if (end.anchor === "center" || kind === "straight") return towardPort(o, aim);
  return sidePort(o, facing(o, aim));
}

/// Il percorso di un connettore di tipo `kind` fra i capi `from` e `to`,
/// nella scena: i punti di `fub:geom`, dal primo all'ultimo.
export function route(kind: ConnectorKind, from: EndSpec, to: EndSpec): Point[] {
  const a = portOf(from, aimOf(to), kind);
  const b = portOf(to, aimOf(from), kind);
  if (kind === "straight") return [a.at, b.at];
  if (kind === "curved") return curve(a, b, from.outline !== null, to.outline !== null);
  return elbow(a, b);
}

// ---------------------------------------------------------------------------
// La curva.
// ---------------------------------------------------------------------------

/// Un punto da `p` verso `q`, a `reach` al più e a metà strada al più.
function toward(p: Point, q: Point, reach: number): Point {
  const u = unit([q[0] - p[0], q[1] - p[1]]);
  return u === null ? p : plus(p, u, Math.min(reach, distance(p, q) / 2));
}

/// La curva fra `a` e `b`: i punti di controllo escono da ogni capo
/// agganciato nella sua direzione, a 0,4 volte la distanza fra i capi, e
/// almeno a una volta e mezzo l'uscita di un gomito o alla distanza stessa;
/// quello di un capo libero punta verso l'altro controllo. Fra due capi
/// liberi la curva è dritta.
function curve(a: Port, b: Port, fromFixed: boolean, toFixed: boolean): Point[] {
  if (!fromFixed && !toFixed) return [a.at, lerp(a.at, b.at, 1 / 3), lerp(a.at, b.at, 2 / 3), b.at];
  const span = distance(a.at, b.at);
  const reach = Math.max(0.4 * span, Math.min(1.5 * STUB, span));
  const c1 = fromFixed ? plus(a.at, a.dir, reach) : null;
  const c2 = toFixed ? plus(b.at, b.dir, reach) : null;
  return [a.at, c1 ?? toward(a.at, c2!, reach), c2 ?? toward(b.at, c1!, reach), b.at];
}

// ---------------------------------------------------------------------------
// Il gomito.
// ---------------------------------------------------------------------------

/// Le quattro direzioni del gomito: destra, giù, sinistra, su. La direzione
/// opposta di `d` è `(d + 2) % 4`.
const AXES: readonly Point[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/// La direzione del gomito più vicina a `v`.
const axisOf = ([x, y]: Point): number => (Math.abs(x) >= Math.abs(y) ? (x >= 0 ? 0 : 2) : y >= 0 ? 1 : 3);

const grown = (box: Bounds, by: number): Bounds => ({ min: [box.min[0] - by, box.min[1] - by], max: [box.max[0] + by, box.max[1] + by] });

/// Vero se il punto (`x`, `y`) sta dentro `box`, bordi esclusi.
function within(box: Bounds | null, x: number, y: number): boolean {
  return box !== null && x > box.min[0] + EPSILON && x < box.max[0] - EPSILON && y > box.min[1] + EPSILON && y < box.max[1] - EPSILON;
}

/// Dove il gomito esce dal capo `port`: dritto lungo `axis`, almeno di
/// `margin`, e comunque fino al bordo di `box`.
function exit(port: Port, axis: number, box: Bounds | null, margin: number): Point {
  let s = margin;
  if (box !== null) {
    const [x, y] = port.at;
    s = Math.max(s, axis === 0 ? box.max[0] - x : axis === 1 ? box.max[1] - y : axis === 2 ? x - box.min[0] : y - box.min[1]);
  }
  return plus(port.at, AXES[axis]!, s);
}

/// I valori in ordine, quelli più vicini di [`EPSILON`] una volta sola.
function sortedUnique(values: number[]): number[] {
  values.sort((p, q) => p - q);
  const out: number[] = [];
  for (const v of values) if (out.length === 0 || v - out[out.length - 1]! > EPSILON) out.push(v);
  return out;
}

/// Il primo posto di `list` che vale `v`, o -1.
function indexIn(list: readonly number[], v: number): number {
  for (let i = 0; i < list.length; i++) if (Math.abs(list[i]! - v) <= EPSILON) return i;
  return -1;
}

/// Una coda di priorità per il percorso più corto: a parità di costo esce
/// prima chi è entrato prima, così il percorso è sempre lo stesso. Si
/// riusa da un gomito all'altro, senza ridare la memoria.
class Queue {
  private costs = new Float64Array(256);
  private orders = new Int32Array(256);
  private states = new Int32Array(256);
  private count = 0;
  private seq = 0;
  /// Il costo dell'ultimo estratto.
  cost = 0;

  get size(): number {
    return this.count;
  }

  /// Svuota la coda.
  clear(): void {
    this.count = 0;
    this.seq = 0;
  }

  private less(i: number, j: number): boolean {
    const a = this.costs[i]!;
    const b = this.costs[j]!;
    return a < b || (a === b && this.orders[i]! < this.orders[j]!);
  }

  private put(i: number, cost: number, order: number, state: number): void {
    this.costs[i] = cost;
    this.orders[i] = order;
    this.states[i] = state;
  }

  private swap(i: number, j: number): void {
    const cost = this.costs[i]!;
    const order = this.orders[i]!;
    const state = this.states[i]!;
    this.put(i, this.costs[j]!, this.orders[j]!, this.states[j]!);
    this.put(j, cost, order, state);
  }

  push(cost: number, state: number): void {
    if (this.count === this.costs.length) {
      const costs = new Float64Array(this.count * 2);
      const orders = new Int32Array(this.count * 2);
      const states = new Int32Array(this.count * 2);
      costs.set(this.costs);
      orders.set(this.orders);
      states.set(this.states);
      this.costs = costs;
      this.orders = orders;
      this.states = states;
    }
    this.put(this.count, cost, this.seq++, state);
    for (let i = this.count++; i > 0;) {
      const up = (i - 1) >> 1;
      if (!this.less(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }

  /// Lo stato di costo minore, il suo costo in `cost`.
  pop(): number {
    const top = this.states[0]!;
    this.cost = this.costs[0]!;
    const last = --this.count;
    this.put(0, this.costs[last]!, this.orders[last]!, this.states[last]!);
    if (last > 0) {
      for (let i = 0; ;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let least = i;
        if (left < last && this.less(left, least)) least = left;
        if (right < last && this.less(right, least)) least = right;
        if (least === i) break;
        this.swap(i, least);
        i = least;
      }
    }
    return top;
  }
}

/// La coda e le tabelle del gomito che si sta cercando: uno per volta.
const QUEUE = new Queue();
let COSTS = new Float64Array(256);
let BACKS = new Int32Array(256);

/// Toglie i punti ripetuti e quelli in mezzo a un tratto dritto.
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last[0] - p[0]) <= EPSILON && Math.abs(last[1] - p[1]) <= EPSILON) continue;
    const before = out[out.length - 2];
    if (before !== undefined && last !== undefined) {
      const vertical = Math.abs(before[0] - last[0]) <= EPSILON && Math.abs(last[0] - p[0]) <= EPSILON;
      const horizontal = Math.abs(before[1] - last[1]) <= EPSILON && Math.abs(last[1] - p[1]) <= EPSILON;
      if (vertical || horizontal) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/// Il gomito più corto da `a`, che esce lungo `from`, a `b`, in cui si
/// entra contro `to`, girando attorno ai riquadri dei due oggetti allargati
/// di `margin`, o senza riquadri; `null` se non c'è.
function grid(a: Port, b: Port, from: number, to: number, margin: number, boxes: boolean): Point[] | null {
  const boxA = boxes && a.box !== null ? grown(a.box, margin) : null;
  const boxB = boxes && b.box !== null ? grown(b.box, margin) : null;
  const start = exit(a, from, boxA, margin);
  const goal = exit(b, to, boxB, margin);
  const blocked = (x: number, y: number): boolean => within(boxA, x, y) || within(boxB, x, y);
  if (blocked(start[0], start[1]) || blocked(goal[0], goal[1])) return null;
  const xs = [start[0], goal[0]];
  const ys = [start[1], goal[1]];
  const midX = [(start[0] + goal[0]) / 2];
  const midY = [(start[1] + goal[1]) / 2];
  for (const box of [boxA, boxB]) {
    if (box === null) continue;
    xs.push(box.min[0], box.max[0]);
    ys.push(box.min[1], box.max[1]);
  }
  if (boxA !== null && boxB !== null) {
    if (boxA.max[0] < boxB.min[0]) midX.push((boxA.max[0] + boxB.min[0]) / 2);
    if (boxB.max[0] < boxA.min[0]) midX.push((boxB.max[0] + boxA.min[0]) / 2);
    if (boxA.max[1] < boxB.min[1]) midY.push((boxA.max[1] + boxB.min[1]) / 2);
    if (boxB.max[1] < boxA.min[1]) midY.push((boxB.max[1] + boxA.min[1]) / 2);
  }
  const X = sortedUnique([...xs, ...midX]);
  const Y = sortedUnique([...ys, ...midY]);
  // Le colonne e le righe di mezzo costano un soffio meno.
  const midCols = new Uint8Array(X.length);
  const midRows = new Uint8Array(Y.length);
  for (const x of midX) midCols[indexIn(X, x)] = 1;
  for (const y of midY) midRows[indexIn(Y, y)] = 1;
  const rows = Y.length;
  const first = indexIn(X, start[0]) * rows + indexIn(Y, start[1]);
  const last = indexIn(X, goal[0]) * rows + indexIn(Y, goal[1]);
  // Si entra nell'uscita di `b` andando verso `b`; arrivarci nel verso
  // opposto vorrebbe un'inversione.
  const arrive = (to + 2) % 4;
  // Uno stato è un punto della griglia con la direzione da cui ci si arriva.
  const states = X.length * rows * 4;
  if (COSTS.length < states) {
    COSTS = new Float64Array(states * 2);
    BACKS = new Int32Array(states * 2);
  }
  const cost = COSTS;
  const back = BACKS;
  cost.fill(Infinity, 0, states);
  back.fill(-1, 0, states);
  const queue = QUEUE;
  queue.clear();
  cost[first * 4 + from] = 0;
  queue.push(0, first * 4 + from);
  let best = Infinity;
  let end = -1;
  while (queue.size > 0) {
    const state = queue.pop();
    const c = queue.cost;
    if (c > cost[state]!) continue;
    if (c >= best) break;
    const at = state >> 2;
    const dir = state & 3;
    if (at === last && dir !== to) {
      const total = dir === arrive ? c : c + BEND;
      if (total < best) {
        best = total;
        end = state;
      }
    }
    const i = Math.floor(at / rows);
    const j = at % rows;
    const px = X[i]!;
    const py = Y[j]!;
    for (let next = 0; next < 4; next++) {
      if (next === (dir + 2) % 4) continue;
      const ni = i + (next === 0 ? 1 : next === 2 ? -1 : 0);
      const nj = j + (next === 1 ? 1 : next === 3 ? -1 : 0);
      if (ni < 0 || nj < 0 || ni >= X.length || nj >= rows) continue;
      const qx = X[ni]!;
      const qy = Y[nj]!;
      // Il tratto è verticale o orizzontale: un asse non cambia, e la lunghezza
      // è la differenza dell'altro.
      if (blocked(qx, qy) || blocked(px + (qx - px) * 0.5, py + (qy - py) * 0.5)) continue;
      const middle = next % 2 === 0 ? midRows[j] === 1 : midCols[i] === 1;
      const step = (Math.abs(qx - px) + Math.abs(qy - py)) * (middle ? 0.999 : 1) + (next === dir ? 0 : BEND);
      const target = (ni * rows + nj) * 4 + next;
      if (c + step < cost[target]!) {
        cost[target] = c + step;
        back[target] = state;
        queue.push(c + step, target);
      }
    }
  }
  if (end < 0) return null;
  const points: Point[] = [];
  for (let state = end; state >= 0; state = back[state]!) {
    const at = state >> 2;
    points.push([X[Math.floor(at / rows)]!, Y[at % rows]!]);
  }
  points.reverse();
  return simplify([a.at, ...points, b.at]);
}

/// Lo spazio attorno ai due oggetti per il primo gomito: l'uscita intera, o
/// metà dello spazio fra i due quando sono più vicini di due uscite, così il
/// gomito passa in mezzo invece di girare loro attorno.
function marginOf(a: Port, b: Port): number {
  if (a.box === null || b.box === null) return STUB;
  const gap = Math.max(b.box.min[0] - a.box.max[0], a.box.min[0] - b.box.max[0], b.box.min[1] - a.box.max[1], a.box.min[1] - b.box.max[1]);
  return gap > 0 && gap < 2 * STUB ? gap / 2 : STUB;
}

/// Il gomito fra `a` e `b`: prima attorno ai due oggetti con l'uscita
/// intera, o fra i due se sono vicini, poi con un'uscita più corta, poi senza
/// guardare gli oggetti; e, se nemmeno così, una Z per la via di mezzo.
function elbow(a: Port, b: Port): Point[] {
  const from = axisOf(a.dir);
  const to = axisOf(b.dir);
  const room = marginOf(a, b);
  const tries: ReadonlyArray<readonly [number, boolean]> = [[room, true], [Math.min(room, STUB / 4), true], [STUB, false]];
  for (const [margin, boxes] of tries) {
    const path = grid(a, b, from, to, margin, boxes);
    if (path !== null && path.length >= 2 && path.length <= 64) return path;
  }
  const start = plus(a.at, AXES[from]!, STUB);
  const goal = plus(b.at, AXES[to]!, STUB);
  const [mx, my] = lerp(start, goal, 0.5);
  const path = simplify(from % 2 === 0
    ? [a.at, start, [mx, start[1]], [mx, goal[1]], goal, b.at]
    : [a.at, start, [start[0], my], [goal[0], my], goal, b.at]);
  return path.length >= 2 ? path : [a.at, b.at];
}

// ---------------------------------------------------------------------------
// Le etichette.
// ---------------------------------------------------------------------------

/// Il riquadro di un'etichetta nella scena: il centro e le misure.
interface LabelBox {
  readonly centre: Point;
  readonly width: number;
  readonly height: number;
}

/// Il riquadro delle righe di `label` nella scena; `null` se non ne ha.
function labelBox(label: ElementPart, router: Router): LabelBox | null {
  const extent = router.extent(label);
  if (extent === null) return null;
  const m = router.matrixOf(label);
  const out = new BoundsBuilder();
  for (const [corner] of boxChords(extent)) out.include(apply(m, corner));
  const box = out.finish();
  if (box === null) return null;
  return { centre: lerp(box.min, box.max, 0.5), width: box.max[0] - box.min[0], height: box.max[1] - box.min[1] };
}

/// La normale della linea di direzione `d` dalla parte positiva delle
/// etichette, quella che guarda in alto a destra: sopra una linea
/// orizzontale, a destra di una verticale, e di una obliqua quella delle due
/// perpendicolari che va più verso l'alto a destra, `(1, -1)`. Una linea
/// parallela a `(1, -1)` ha le due perpendicolari alla pari: vale quella in
/// alto a sinistra.
export function labelNormal([dx, dy]: Point): Point {
  const sum = dy + dx;
  return sum > 0 || (sum === 0 && dx > 0) ? [dy, -dx] : [-dy, dx];
}

/// Quanto `box` arriva dal suo centro lungo la normale `n`.
const reachAlong = (n: Point, box: Pick<LabelBox, "width" | "height">): number => (Math.abs(n[0]) * box.width) / 2 + (Math.abs(n[1]) * box.height) / 2;

/// Dove va il centro dell'etichetta `box`, larga e alta così, messa a
/// `place` lungo `track`.
export function labelCentre(track: Track, place: LabelPlace, box: Pick<LabelBox, "width" | "height">): Point | null {
  const at = track.at(place.t * track.length);
  if (at === null) return null;
  const n = labelNormal(at.direction);
  const e = reachAlong(n, box);
  return plus(at.at, n, place.offset >= 0 ? place.offset + e : place.offset - e);
}

/// Il posto lungo `track` dell'etichetta `box` dov'è adesso, sulla linea
/// `id`: un'etichetta lasciata sopra la linea la tocca dalla sua parte.
function placeOf(track: Track, box: LabelBox, id: string): LabelPlace | null {
  const s = track.nearest(box.centre);
  const at = track.at(s);
  if (at === null || !(track.length > 0)) return null;
  const n = labelNormal(at.direction);
  const e = reachAlong(n, box);
  const d = (box.centre[0] - at.at[0]) * n[0] + (box.centre[1] - at.at[1]) * n[1];
  // Sotto la linea anche toccandola: −0 si scriverebbe 0, sopra.
  return { id, t: s / track.length, offset: d >= 0 ? Math.max(0, d - e) : Math.min(-0.01, d + e) };
}

/// Il `transform` di `label` spostata di `delta` nella scena; `undefined` se
/// resta dov'è o non si sposta.
function movedLabel(label: ElementPart, delta: Point, router: Router): string | null | undefined {
  if (Math.hypot(delta[0], delta[1]) < LABEL_STILL || label.parent === null) return undefined;
  const pm = router.matrixOf(label.parent);
  const back = invert([pm[0], pm[1], pm[2], pm[3], 0, 0]);
  if (back === null) return undefined;
  const [x, y] = apply(back, delta);
  return transformValue(compose(translate(x, y), router.own(label)));
}

/// Il `transform` che mette `label` a `place` lungo `segments`, nella
/// scena; `undefined` se c'è già o non si sa.
function placedLabel(label: ElementPart, place: LabelPlace, segments: readonly Segment[], router: Router): string | null | undefined {
  const box = labelBox(label, router);
  const track = new Track(segments);
  if (box === null || !(track.length > 0)) return undefined;
  const centre = labelCentre(track, place, box);
  return centre === null ? undefined : movedLabel(label, [centre[0] - box.centre[0], centre[1] - box.centre[1]], router);
}

/// Il posto di un'etichetta nuova, o messa di nuovo: a metà, sopra la linea.
export function labelPlace(id: string): LabelPlace {
  return { id, t: 0.5, offset: LABEL_GAP };
}

// ---------------------------------------------------------------------------
// Seguire.
// ---------------------------------------------------------------------------

/// I connettori e le etichette del disegno, in ordine di documento.
function scan(model: DocumentModel): { readonly lines: ElementPart[]; readonly labels: ElementPart[] } {
  const lines: ElementPart[] = [];
  const labels: ElementPart[] = [];
  const walk = (container: ContainerNode): void => {
    for (const child of elementChildren(container)) {
      const details = child.details;
      if (details === null) continue;
      if (details.connector !== undefined) lines.push(child);
      else if (details.along !== undefined) labels.push(child);
      else if (child.kind === "container" && (details.role === "layer" || details.role === "group" || details.role === "link")) walk(child);
    }
  };
  walk(model.root);
  return { lines, labels };
}

/// I due capi di `line`: gli oggetti a cui sono agganciati, `null` per un
/// capo libero o che non vale.
function targetsOf(line: ElementPart, facts: ConnectorFacts, find: (id: string) => ElementPart | null): readonly [ElementPart | null, ElementPart | null] {
  return [facts.from === null ? null : targetOf(line, facts.from.id, find), facts.to === null ? null : targetOf(line, facts.to.id, find)];
}

/// Il percorso di `line` fra `targets`, nella scena: i capi liberi restano
/// dove sono.
function routeOf(line: ElementPart, facts: ConnectorFacts, targets: readonly [ElementPart | null, ElementPart | null], router: Router): Point[] {
  const m = router.matrixOf(line);
  const points = facts.geom.points;
  const spec = (i: 0 | 1): EndSpec => {
    const node = targets[i];
    const end = i === 0 ? facts.from : facts.to;
    return { outline: node === null ? null : router.outline(node), anchor: end?.anchor ?? "auto", free: apply(m, i === 0 ? points[0]! : points[points.length - 1]!) };
  };
  return route(facts.geom.kind, spec(0), spec(1));
}

/// Un capo come lo dà chi fa o cambia un connettore: agganciato a `node`
/// con `anchor`, o libero in `at`, nella scena.
export type EndInput = { readonly node: ElementPart; readonly anchor: Anchor } | { readonly at: Point };

/// Il percorso di tipo `kind` fra i capi `from` e `to`, nella scena: i punti
/// di `fub:geom`, prima di passare nelle coordinate del connettore. Un
/// oggetto che non disegna niente che si sappia vale come un capo libero nel
/// suo centro.
export function sceneRoute(kind: ConnectorKind, from: EndInput, to: EndInput, measure: Measure, router: Router = new Router(measure)): Point[] {
  const spec = (end: EndInput): EndSpec => {
    if ("at" in end) return { outline: null, anchor: "auto", free: end.at };
    const outline = router.outline(end.node);
    return { outline, anchor: end.anchor, free: outline?.centre ?? apply(router.matrixOf(end.node), [0, 0]) };
  };
  return route(kind, spec(from), spec(to));
}

/// I cinque punti d'aggancio di `node` nella scena: il centro e il centro
/// dei quattro lati, nel verso dell'oggetto, dove il capo lo tocca. `null`
/// se `node` non disegna niente che si sappia.
export function anchorPoints(node: ElementPart, measure: Measure, router: Router = new Router(measure)): ReadonlyMap<Exclude<Anchor, "auto">, Point> | null {
  const o = router.outline(node);
  if (o === null) return null;
  const out = new Map<Exclude<Anchor, "auto">, Point>([["center", o.centre]]);
  for (const side of ["top", "right", "bottom", "left"] as const) out.set(side, sidePort(o, side).at);
  return out;
}

/// I capi di `line` come sono adesso: agganciati al loro oggetto, o liberi
/// dove sono, nella scena. `null` se `line` non è un connettore.
export function endInputs(line: ElementPart, find: (id: string) => ElementPart | null, measure: Measure, router: Router = new Router(measure)): [EndInput, EndInput] | null {
  const facts = line.details?.connector;
  if (facts === undefined) return null;
  const m = router.matrixOf(line);
  const points = facts.geom.points;
  const input = (end: ConnectorEnd | null, at: Point): EndInput => {
    const node = end === null ? null : targetOf(line, end.id, find);
    return node !== null ? { node, anchor: end!.anchor } : { at: apply(m, at) };
  };
  return [input(facts.from, points[0]!), input(facts.to, points[points.length - 1]!)];
}

/// `fub:geom` e `d` di `line` di tipo `kind` fra i capi `from` e `to`, nelle
/// coordinate del connettore: come li scriverebbe il seguito. `null` se le
/// coordinate del connettore non si invertono.
export function connectorAttrsFor(line: ElementPart, kind: ConnectorKind, from: EndInput, to: EndInput, measure: Measure, router: Router = new Router(measure)): { readonly "fub:geom": string; readonly d: string } | null {
  const back = invert(router.matrixOf(line));
  if (back === null) return null;
  return connectorAttrs({ kind, points: sceneRoute(kind, from, to, measure, router).map((p) => apply(back, p)) });
}

/// `fub:geom` e `d` di `line` di tipo `kind` coi capi `from` e `to`: un capo
/// agganciato tocca il suo oggetto, uno libero resta dov'è adesso. Serve a
/// chi cambia il tipo o un aggancio. `null` se `line` non è un connettore.
export function connectorRoute(
  line: ElementPart,
  kind: ConnectorKind,
  from: ConnectorEnd | null,
  to: ConnectorEnd | null,
  find: (id: string) => ElementPart | null,
  measure: Measure,
): { readonly "fub:geom": string; readonly d: string } | null {
  const router = new Router(measure);
  const now = endInputs(line, find, measure, router);
  if (now === null) return null;
  const input = (end: ConnectorEnd | null, current: EndInput): EndInput => {
    const node = end === null ? null : targetOf(line, end.id, find);
    if (node !== null) return { node, anchor: end!.anchor };
    // Un capo che si stacca resta dove tocca adesso il suo oggetto.
    return "at" in current ? current : { at: sceneRoute(kind, current, current, measure, router)[0]! };
  };
  return connectorAttrsFor(line, kind, input(from, now[0]), input(to, now[1]), measure, router);
}

/// Il contorno di `node` nella scena, come lo tocca un capo, in segmenti;
/// `null` se non disegna niente che si sappia.
export function outlineSegments(node: ElementPart, measure: Measure, router: Router = new Router(measure)): Segment[] | null {
  const o = router.outline(node);
  if (o === null) return null;
  const out: Segment[] = [];
  for (const [a, b] of o.chords) out.push({ kind: "move", to: a }, { kind: "line", to: b });
  return out;
}

/// Le etichette dei connettori che sono in `nodes` o vi stanno dentro, e
/// che non ci stanno già: vanno con loro quando si eliminano, si copiano o
/// si duplicano. In ordine di documento.
export function labelsOf(model: DocumentModel, nodes: readonly ElementPart[]): ElementPart[] {
  const taken = new Changes(new Set(nodes));
  const { lines, labels } = scan(model);
  const ids = new Set(lines.filter((line) => line.facts.id !== null && taken.under(line)).map((line) => line.facts.id!));
  return ids.size === 0 ? [] : labels.filter((label) => ids.has(label.details!.along!.id) && !taken.under(label));
}

/// Come si vede un connettore nuovo: il colore del contorno, lo spessore e
/// l'id del marcatore della punta alla fine.
export interface LineStyle {
  readonly paint: string;
  readonly width: number;
  readonly tip: string;
}

/// L'elemento di un connettore nuovo di tipo `kind`, coi punti `points`
/// nelle coordinate del suo genitore, i capi `from` e `to` e lo stile
/// `style`: senza riempimento, con gli estremi e gli angoli tondi.
export function connectorElem(id: string, kind: ConnectorKind, points: readonly Point[], from: ConnectorEnd | null, to: ConnectorEnd | null, style: LineStyle): Elem {
  const written = connectorAttrs({ kind, points });
  const attrs: Record<string, string> = { id, "fub:shape": "connector", "fub:geom": written["fub:geom"] };
  if (from !== null) attrs["fub:from"] = writeConnectorEnd(from);
  if (to !== null) attrs["fub:to"] = writeConnectorEnd(to);
  Object.assign(attrs, {
    d: written.d,
    fill: "none",
    stroke: style.paint,
    "stroke-width": formatNumber(style.width, 2),
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "marker-end": `url(#${style.tip})`,
  });
  return { tag: "path", attrs };
}

/// Ciò che fa «Collega le forme scelte»: gli `ident` degli oggetti che
/// ricevono un id, da fare per primi; gli `add` dei connettori; i loro id, e
/// quante coppie erano già unite.
export interface Connected {
  readonly idents: readonly Op[];
  readonly adds: readonly Op[];
  readonly lines: readonly string[];
  readonly skipped: number;
}

/// «Collega le forme scelte»: unisce ogni oggetto di `units` a cui ci si
/// aggancia al seguente, con un connettore di tipo `kind` e lo stile
/// `style`, agganci automatici, in cima a `to`. L'ordine è quello in cui gli
/// oggetti stanno sul foglio, perché la selezione non ricorda i clic: da
/// sinistra a destra se i centri sono più distesi in larghezza che in
/// altezza, se no dall'alto in basso. Due oggetti già uniti, in un verso o
/// nell'altro, non si uniscono di nuovo. `null` se gli oggetti da unire
/// sono meno di due.
export function connectOps(model: DocumentModel, units: readonly Unit[], kind: ConnectorKind, style: LineStyle, to: Destination, ids: NewIds, measure: Measure): Connected | null {
  const centres = new Map<Unit, Point>();
  for (const unit of units) {
    if (unit.bounds !== null && attachable(unit.node)) centres.set(unit, [(unit.bounds.min[0] + unit.bounds.max[0]) / 2, (unit.bounds.min[1] + unit.bounds.max[1]) / 2]);
  }
  if (centres.size < 2) return null;
  const spread = (axis: 0 | 1): number => {
    const values = [...centres.values()].map((p) => p[axis]);
    return Math.max(...values) - Math.min(...values);
  };
  const [first, second] = spread(0) >= spread(1) ? [0, 1] : [1, 0];
  const ordered = [...centres.keys()].sort((a, b) => centres.get(a)![first]! - centres.get(b)![first]! || centres.get(a)![second]! - centres.get(b)![second]!);
  const joined = new Set<string>();
  for (const line of scan(model).lines) {
    const facts = line.details!.connector!;
    if (facts.from === null || facts.to === null) continue;
    joined.add(`${facts.from.id} ${facts.to.id}`);
    joined.add(`${facts.to.id} ${facts.from.id}`);
  }
  const idents: Op[] = [];
  const named = new Map<Unit, string>();
  const idOf = (unit: Unit): string => {
    let id = unit.id ?? named.get(unit);
    if (id === undefined) {
      id = ids.next("object");
      named.set(unit, id);
      idents.push({ op: "ident", path: unit.path, tag: unit.tag, id });
    }
    return id;
  };
  const router = new Router(measure);
  const adds: Op[] = [];
  const lines: string[] = [];
  let skipped = 0;
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1]!;
    const next = ordered[i]!;
    if (from.id !== null && next.id !== null && joined.has(`${from.id} ${next.id}`)) {
      skipped++;
      continue;
    }
    const scene = sceneRoute(kind, { node: from.node, anchor: "auto" }, { node: next.node, anchor: "auto" }, measure, router);
    const id = ids.next("object");
    const elem = connectorElem(id, kind, scene.map((p) => apply(to.inverse, p)), { id: idOf(from), anchor: "auto" }, { id: idOf(next), anchor: "auto" }, style);
    adds.push({ op: "add", parent: to.parent, pos: { last: true }, elem });
    lines.push(id);
  }
  return { idents, adds, lines, skipped };
}

/// Un capo di un connettore del disegno, nella scena.
export interface LineEnd {
  readonly line: ElementPart;
  readonly id: string;
  readonly end: "from" | "to";
  readonly at: Point;
}

/// I capi dei connettori del disegno che si possono riagganciare: non quelli
/// bloccati, nascosti, o in un contenitore bloccato.
export function lineEnds(model: DocumentModel, measure: Measure, router: Router = new Router(measure)): LineEnd[] {
  const out: LineEnd[] = [];
  for (const line of scan(model).lines) {
    const id = line.facts.id;
    const facts = line.details!.connector!;
    if (id === null || line.details!.locked === true || line.details!.hidden === true || lockedAbove(line)) continue;
    const m = router.matrixOf(line);
    const points = facts.geom.points;
    out.push({ line, id, end: "from", at: apply(m, points[0]!) }, { line, id, end: "to", at: apply(m, points[points.length - 1]!) });
  }
  return out;
}

/// `fub:geom` e `d` di un connettore di tipo `kind` con i punti `points`,
/// come li scrive [`connectorAttrs`], e i punti come si rileggono da
/// `fub:geom`. Il `d` è quello della geometria riletta da ciò che si scrive, e
/// basta arrotondare ogni coordinata come si scrive, a due decimali: senza
/// comporre il testo di `fub:geom` per rileggerlo, che a trecento connettori
/// per fotogramma si vede.
function writtenAttrs(kind: ConnectorKind, points: readonly Point[]): { readonly "fub:geom": string; readonly d: string; readonly read: readonly Point[] } {
  const read = writtenPoints(points);
  return { "fub:geom": writeConnectorGeom({ kind, points }), d: connectorPath({ kind, points: read }), read };
}

/// I punti `points` come si rileggono da ciò che si scrive: a due decimali.
function writtenPoints(points: readonly Point[]): Point[] {
  return points.map(([x, y]): Point => [roundHalfUp(x, 100) / 100, roundHalfUp(y, 100) / 100]);
}

/// Il `d` di un connettore di tipo `kind` con i punti `points`, come lo
/// scrive [`connectorAttrs`].
function writtenPath(kind: ConnectorKind, points: readonly Point[]): string {
  return connectorPath({ kind, points: writtenPoints(points) });
}

/// Vero se i punti `a` e `b` hanno gli stessi numeri.
function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1]);
}

/// I segmenti di `line` nella scena, come è scritta.
function writtenSegments(line: ElementPart, facts: ConnectorFacts, router: Router): Segment[] {
  const m = router.matrixOf(line);
  return connectorSegments({ kind: facts.geom.kind, points: facts.geom.points.map((p) => apply(m, p)) });
}

/// Le operazioni che tengono i connettori agganciati ai loro oggetti, dopo
/// un'operazione che ha toccato `touched`, e le etichette al loro posto; il
/// motore le applica nello stesso passo. `op` è l'operazione chiesta: un
/// connettore che sposta da solo, senza i suoi oggetti, si stacca; un
/// oggetto tolto stacca i capi che vi erano agganciati, e la linea tiene
/// l'ultima geometria; un'etichetta spostata da sola prende il posto nuovo
/// lungo la linea. `null` se non c'è niente da fare.
export function followConnectors(model: DocumentModel, touched: ReadonlySet<string>, find: (id: string) => ElementPart | null, measure: Measure, op: Op | null = null): Op | null {
  if (touched.size === 0) return null;
  const { lines, labels } = scan(model);
  if (lines.length === 0 && labels.length === 0) return null;
  const { changes, removed } = touchedBy(touched, find);
  const moved = op === null ? new Set<string>() : movedBy(op);
  const named = op === null ? touched : namedBy(op);
  const router = new Router(measure);
  const sets: Op[] = [];
  const routed = new Map<string, readonly Segment[]>();
  for (const line of lines) {
    const id = line.facts.id;
    const facts = line.details!.connector!;
    if (id === null || lockedAbove(line)) continue;
    const attrs: Record<string, string | null> = {};
    if (facts.from !== null && removed.has(facts.from.id)) attrs["fub:from"] = null;
    if (facts.to !== null && removed.has(facts.to.id)) attrs["fub:to"] = null;
    const targets = targetsOf(line, facts, find);
    const followed = targets.some((node) => node !== null && changes.changed(node));
    // Il connettore stesso cambiato da chi ha chiesto l'operazione, come un
    // aggancio scelto nel pannello o un livello spostato; non da un seguito,
    // come i capi che un giro prima ha staccato.
    const asked = changes.under(line) && among(line, named);
    if (!followed && !asked && Object.keys(attrs).length === 0) continue;
    if (among(line, moved) && !followed) {
      // Spostato da solo: i capi si staccano, e la linea resta dove la si è
      // messa.
      if (facts.from !== null) attrs["fub:from"] = null;
      if (facts.to !== null) attrs["fub:to"] = null;
      if (Object.keys(attrs).length > 0) sets.push({ op: "set", id, attrs });
      continue;
    }
    const back = invert(router.matrixOf(line));
    if ((followed || asked) && back !== null && targets.some((node) => node !== null)) {
      const scene = routeOf(line, facts, targets, router);
      const written = writtenAttrs(facts.geom.kind, scene.map((p) => apply(back, p)));
      // Se i numeri sono altri anche il testo lo è, senza rileggerlo: lo si
      // rilegge soltanto per i connettori che non si sono mossi.
      const same = samePoints(facts.geom.points, written.read) && written["fub:geom"] === fubAttributes(line).get("geom") && written.d === plainAttributes(line).get("d");
      if (!same) {
        attrs["fub:geom"] = written["fub:geom"];
        attrs.d = written.d;
      }
      routed.set(id, connectorSegments({ kind: facts.geom.kind, points: scene }));
    }
    if (Object.keys(attrs).length > 0) sets.push({ op: "set", id, attrs });
  }
  for (const label of labels) {
    const id = label.facts.id;
    const place = label.details!.along!;
    if (id === null || lockedAbove(label)) continue;
    if (removed.has(place.id)) {
      sets.push({ op: "set", id, attrs: { "fub:along": null } });
      continue;
    }
    const line = find(place.id);
    const facts = line?.details?.connector;
    if (line === null || facts === undefined) {
      // Il connettore è diventato un tracciato qualunque: l'etichetta resta
      // un testo.
      if (line !== null && changes.changed(line)) sets.push({ op: "set", id, attrs: { "fub:along": null } });
      continue;
    }
    const lineMoved = routed.has(place.id) || changes.under(line);
    if (!lineMoved && !changes.under(label)) continue;
    const segments = routed.get(place.id) ?? writtenSegments(line, facts, router);
    if (among(label, moved) && !lineMoved) {
      // Spostata da sola: il posto nuovo lungo la linea.
      const box = labelBox(label, router);
      const next = box === null ? null : placeOf(new Track(segments), box, place.id);
      const along = next === null ? null : writeLabelPlace(next);
      if (along !== null && along !== fubAttributes(label).get("along")) sets.push({ op: "set", id, attrs: { "fub:along": along } });
      continue;
    }
    const transform = placedLabel(label, place, segments, router);
    if (transform !== undefined) sets.push({ op: "set", id, attrs: { transform } });
  }
  return gesture(sets);
}

// ---------------------------------------------------------------------------
// L'anteprima di un gesto.
// ---------------------------------------------------------------------------

/// Ciò che un gesto in corso cambia ai connettori e alle etichette: il `d`
/// di ogni connettore che segue, e il `transform` di ogni etichetta che si
/// sposta con lui, per id. Sono i valori che l'operazione scriverà.
export interface ConnectorDraft {
  readonly paths: ReadonlyMap<string, string>;
  readonly transforms: ReadonlyMap<string, string | null>;
}

/// L'anteprima dei connettori mentre un gesto sposta, gira o ridimensiona
/// gli oggetti `moving`: si prepara una volta all'inizio del gesto, e a ogni
/// fotogramma [`ConnectorPreview.at`] ricalcola soltanto i connettori che
/// seguono, coi contorni già letti. Chi si sposta da solo si stacca, e il
/// suo `transform` lo mostra già chi trascina.
export class ConnectorPreview {
  private readonly router: Router;
  private readonly lines: ReadonlyArray<{
    readonly line: ElementPart;
    readonly id: string;
    readonly facts: ConnectorFacts;
    readonly targets: readonly [ElementPart | null, ElementPart | null];
    /// Vero se la linea ha un'etichetta che la segue.
    readonly labelled: boolean;
  }>;
  private readonly labels: ReadonlyArray<{ readonly label: ElementPart; readonly line: string; readonly place: LabelPlace }>;
  private readonly changes: Changes;

  constructor(model: DocumentModel, moving: ReadonlySet<ElementPart>, find: (id: string) => ElementPart | null, measure: Measure) {
    this.router = new Router(measure);
    this.changes = new Changes(moving);
    const { lines, labels } = scan(model);
    const following: Array<{ line: ElementPart; id: string; facts: ConnectorFacts; targets: readonly [ElementPart | null, ElementPart | null] }> = [];
    for (const line of lines) {
      const id = line.facts.id;
      const facts = line.details!.connector!;
      if (id === null || lockedAbove(line)) continue;
      const targets = targetsOf(line, facts, find);
      if (targets.some((node) => node !== null && this.changes.changed(node))) following.push({ line, id, facts, targets });
    }
    const ids = new Set(following.map((entry) => entry.id));
    this.labels = labels.flatMap((label) => {
      const place = label.details!.along!;
      return label.facts.id !== null && ids.has(place.id) && !lockedAbove(label) ? [{ label, line: place.id, place }] : [];
    });
    const labelled = new Set(this.labels.map((entry) => entry.line));
    this.lines = following.map((entry) => ({ ...entry, labelled: labelled.has(entry.id) }));
  }

  /// Vero se il gesto non cambia nessun connettore.
  get empty(): boolean {
    return this.lines.length === 0;
  }

  /// Ciò che cambia quando il gesto porta gli oggetti di `m`, una
  /// trasformazione della scena.
  at(m: Matrix): ConnectorDraft {
    this.router.shift = (node) => (this.changes.under(node) ? m : null);
    const paths = new Map<string, string>();
    const transforms = new Map<string, string | null>();
    const segments = new Map<string, readonly Segment[]>();
    for (const { line, id, facts, targets, labelled } of this.lines) {
      const back = invert(this.router.matrixOf(line));
      if (back === null) continue;
      const scene = routeOf(line, facts, targets, this.router);
      // Il `d` si mostra nelle coordinate in cui il connettore si vede: con
      // lo spostamento del gesto, se si sposta anche lui.
      paths.set(id, writtenPath(facts.geom.kind, scene.map((p) => apply(back, p))));
      if (labelled) segments.set(id, connectorSegments({ kind: facts.geom.kind, points: scene }));
    }
    for (const { label, line, place } of this.labels) {
      const along = segments.get(line);
      if (along === undefined) continue;
      const transform = placedLabel(label, place, along, this.router);
      if (transform !== undefined) transforms.set(label.facts.id!, transform);
    }
    return { paths, transforms };
  }
}
