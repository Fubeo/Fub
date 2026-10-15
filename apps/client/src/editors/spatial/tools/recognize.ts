// Le forme dal tratto: un tratto a penna che somiglia a una forma ne prende
// il posto, con lo stesso colore e lo stesso spessore. Il riconoscimento è
// deterministico, lo stesso tratto dà sempre la stessa forma, e ogni misura
// è relativa alla misura del tratto: un cerchio piccolo e uno grande si
// riconoscono allo stesso modo.
//
// 1. **Il tratto si ricampiona** a passi uguali lungo la sua lunghezza: la
//    velocità della mano non pesa, e nemmeno i campioni fermi alla fine.
// 2. **Chiuso o aperto.** Il tratto è chiuso se un punto del suo ultimo
//    quarto torna vicino a uno del primo: ciò che sta prima e dopo, la coda
//    che ripassa sull'inizio, si taglia.
// 3. **Aperto:** una linea, se resta vicino alla sua retta e non torna
//    indietro; una freccia, se è un'asta diritta che finisce in una punta
//    con un lato per parte, dietro la punta.
// 4. **Chiuso:** un'ellisse, dai momenti dell'area che il tratto racchiude,
//    e un poligono, dagli spigoli e dalle rette dei lati. Vince la più vicina
//    al tratto, e il poligono deve esserlo di molto, perché con più lati
//    starebbe vicino a tutto. Quattro angoli quasi retti fanno un
//    rettangolo; un poligono che si incrocia è una stella se gira a passi
//    uguali attorno al suo centro, come la stella a cinque punte disegnata
//    senza staccare, e altrimenti non è niente.
//
// Niente sotto soglia: nessuna forma, e il tratto resta inchiostro. La
// scrittura a mano non si riconosce; la protegge chi chiama, che non chiede
// una forma per un tratto piccolo sullo schermo.

import { formatNumber } from "../number";
import { apply, compose, IDENTITY, rotate, translate, type Matrix, type Point } from "../scene/matrix";
import { MAX_COUNT, MIN_COUNT, normalRotation, polygonalAttrs } from "../scene/parametric";
import { formatTransform, type Elem } from "../scene/serialize";
import { constrainEnd, shapeElem, SNAP_DEGREES, type ShapeStyle } from "./shapes";

/// Una forma riconosciuta, nelle coordinate dei punti da cui viene. Gli
/// angoli sono in gradi, in senso orario come in SVG; quello di un
/// poligono regolare è la rotazione di `fub:geom`, 0 per la forma diritta.
export type Recognized =
  | { readonly kind: "line" | "arrow"; readonly from: Point; readonly to: Point }
  | { readonly kind: "rect"; readonly center: Point; readonly width: number; readonly height: number; readonly angle: number }
  | { readonly kind: "ellipse"; readonly center: Point; readonly rx: number; readonly ry: number; readonly angle: number }
  | { readonly kind: "polygon"; readonly points: readonly Point[] }
  | {
      readonly kind: "regular";
      readonly center: Point;
      readonly r: number;
      readonly count: number;
      readonly angle: number;
      /// Il raggio interno di una stella, in parti di `r`; `null` per un
      /// poligono.
      readonly ratio: number | null;
    };

/// I campioni per diagonale del riquadro del tratto, dopo il ricampionamento.
const RESAMPLE = 64;

/// La parte del tratto, a ciascun capo, dove cercare la chiusura.
const CLOSE_SPAN = 0.25;

/// La distanza più grande fra i due capi di un tratto chiuso, in diagonali.
const CLOSE_GAP = 0.15;

/// Quanto pesa, nella scelta della chiusura, il tratto tagliato via, a
/// confronto della distanza fra i due capi.
const CUT = 0.5;

/// Un giro chiuso è lungo almeno quasi due diagonali: un rombo che tocca i
/// quattro lati del riquadro ne fa esattamente due.
const LOOP_LENGTH = 1.7;

/// La parte del tratto, a ciascun capo, che può essere un ricciolo: la penna
/// che arriva o che parte.
const HOOK = 0.06;

/// Quanto un punto di una linea può stare lontano dalla sua retta, in
/// lunghezze della linea.
const LINE_DEVIATION = 0.06;

/// Quanto il tratto di una linea può essere più lungo della linea: oltre,
/// torna indietro, o va su e giù come la scrittura.
const LINE_TRAVEL = 1.15;

/// La punta di una freccia: grande almeno questa parte dell'asta, e al più
/// quest'altra.
const HEAD_MIN = 0.06;
const HEAD_MAX = 0.6;

/// Ciascun lato della punta si allontana dall'asta almeno di questa parte
/// della punta.
const BARB_SIDE = 0.3;

/// L'angolo di un lato della punta con l'asta, in gradi.
const BARB_MIN = 10;
const BARB_MAX = 80;

/// Quanto la punta può andare oltre la sua cima, in parti della punta.
const HEAD_FORWARD = 0.25;

/// Quanto è lungo, al più, il tratto della punta, in volte la punta: oltre è
/// uno scarabocchio.
const HEAD_TRAVEL = 6;

/// La semplificazione che trova gli spigoli, in diagonali del giro.
const SIMPLIFY = 0.035;

/// Uno spigolo che gira meno di così, in gradi, non è uno spigolo.
const MIN_TURN = 25;

/// Un lato più corto di questa parte del più lungo dei due vicini è un
/// angolo arrotondato dalla mano, se i suoi due spigoli insieme girano
/// meno di così, in gradi: i lati vicini si incontrano oltre lui. Un
/// ottagono ha i lati uguali; il lato corto di un rettangolo stretto ha
/// due spigoli retti, e i lati vicini non si incontrano.
const SHORT_SIDE = 0.35;
const CHAMFER_TURNS = 160;

/// La parte di un lato, a ciascun capo, che non conta per la sua retta:
/// la mano arrotonda gli spigoli.
const SIDE_TRIM = 0.15;

/// I lati di un poligono riconosciuto.
const MAX_SIDES = 8;

/// L'errore più grande, scarto quadratico medio in diagonali del giro.
const ELLIPSE_ERROR = 0.03;
const POLYGON_ERROR = 0.025;

/// Il poligono vince sull'ellisse se il suo errore è al più questa parte del
/// suo.
const POLYGON_ADVANTAGE = 0.6;

/// Lo scarto dall'angolo retto, in gradi, dei quattro angoli di un
/// rettangolo: in media, e di ciascuno.
const RIGHT_ANGLE_MEAN = 8;
const RIGHT_ANGLE_MAX = 15;

/// Un rettangolo o un'ellisse girati di meno, in gradi, stanno diritti.
const AXIS_SNAP = 8;

/// Un'ellisse con gli assi più vicini di così è un cerchio.
const CIRCLE_RATIO = 1.1;

/// Il lato corto di una forma chiusa è almeno questa parte del lungo:
/// sotto, il tratto è andato e tornato su una linea.
const THIN = 0.08;

// ---------------------------------------------------------------------------
// Geometria.

const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
const degrees = (radians: number): number => (radians * 180) / Math.PI;
const radians = (value: number): number => (value * Math.PI) / 180;

/// Il baricentro dei punti.
function mean(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0] / points.length;
    y += p[1] / points.length;
  }
  return [x, y];
}

/// La diagonale del riquadro di `points`.
function diagonal(points: readonly Point[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/// Le lunghezze dall'inizio, punto per punto.
function lengths(points: readonly Point[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + distance(points[i - 1]!, points[i]!));
  return out;
}

/// `points` a passi di `step` lungo il tratto; `closed` lo percorre fino a
/// tornare al primo punto.
function resample(points: readonly Point[], step: number, closed: boolean): Point[] {
  const path = closed ? [...points, points[0]!] : points;
  const out: Point[] = [path[0]!];
  let carried = 0;
  let previous = path[0]!;
  for (let i = 1; i < path.length; i++) {
    const next = path[i]!;
    let gap = distance(previous, next);
    while (gap > 0 && carried + gap >= step) {
      const t = (step - carried) / gap;
      const point: Point = [previous[0] + t * (next[0] - previous[0]), previous[1] + t * (next[1] - previous[1])];
      out.push(point);
      previous = point;
      gap = distance(previous, next);
      carried = 0;
    }
    carried += gap;
    previous = next;
  }
  if (closed) {
    if (out.length > 1 && distance(out[out.length - 1]!, out[0]!) < step / 2) out.pop();
  } else if (carried > 0) {
    out.push(path[path.length - 1]!);
  }
  return out;
}

/// La retta più vicina a `points`: il baricentro e la direzione principale.
function fitLine(points: readonly Point[]): { readonly at: Point; readonly direction: Point } {
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= points.length;
  my /= points.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const [x, y] of points) {
    xx += (x - mx) ** 2;
    yy += (y - my) ** 2;
    xy += (x - mx) * (y - my);
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  return { at: [mx, my], direction: [Math.cos(angle), Math.sin(angle)] };
}

/// L'incrocio di due rette, o `null` se sono quasi parallele.
function intersect(a: { readonly at: Point; readonly direction: Point }, b: { readonly at: Point; readonly direction: Point }): Point | null {
  const cross = a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0];
  if (Math.abs(cross) < Math.sin(radians(10))) return null;
  const dx = b.at[0] - a.at[0];
  const dy = b.at[1] - a.at[1];
  const t = (dx * b.direction[1] - dy * b.direction[0]) / cross;
  return [a.at[0] + t * a.direction[0], a.at[1] + t * a.direction[1]];
}

/// La distanza di `p` dal segmento da `a` a `b`.
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const squared = dx * dx + dy * dy;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/// L'angolo di cui gira la spezzata in `b`, venendo da `a` e andando a `c`,
/// in gradi fra 0 e 180.
function turn(a: Point, b: Point, c: Point): number {
  const u = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const v = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = Math.abs(degrees(v - u)) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/// `value` ricondotto a (−`period`/2, `period`/2].
function wrap(value: number, period: number): number {
  let out = value % period;
  if (out > period / 2) out -= period;
  if (out <= -period / 2) out += period;
  return out === 0 ? 0 : out;
}

// ---------------------------------------------------------------------------
// Aperto: linea e freccia.

/// La linea che `points` disegna, da dove comincia a dove finisce, o `null`
/// se il tratto si allontana dalla sua retta o torna indietro. Un ricciolo
/// ai capi non conta.
function straight(points: readonly Point[], hooks: { readonly start: boolean; readonly end: boolean }): { readonly from: Point; readonly to: Point } | null {
  const along = lengths(points);
  const total = along[along.length - 1]!;
  if (!(total > 0)) return null;
  const inner = points.filter((_, i) => (!hooks.start || along[i]! >= HOOK * total) && (!hooks.end || along[i]! <= (1 - HOOK) * total));
  const fitted = fitLine(inner.length >= 2 ? inner : points);
  let direction = fitted.direction;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if ((last[0] - first[0]) * direction[0] + (last[1] - first[1]) * direction[1] < 0) direction = [-direction[0], -direction[1]];
  const project = (p: Point): number => (p[0] - fitted.at[0]) * direction[0] + (p[1] - fitted.at[1]) * direction[1];
  const offset = (p: Point): number => Math.abs((p[0] - fitted.at[0]) * direction[1] - (p[1] - fitted.at[1]) * direction[0]);
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const at = project(p);
    min = Math.min(min, at);
    max = Math.max(max, at);
  }
  const length = max - min;
  if (!(length > 0) || total > LINE_TRAVEL * length) return null;
  for (const p of inner) if (offset(p) > LINE_DEVIATION * length) return null;
  const point = (at: number): Point => [fitted.at[0] + at * direction[0], fitted.at[1] + at * direction[1]];
  return { from: point(min), to: point(max) };
}

/// La freccia che `points` disegna: un'asta diritta dall'inizio alla cima,
/// il punto più lontano dall'inizio la prima volta che il tratto ci arriva,
/// e dopo la cima la punta, con un lato per parte dell'asta, all'indietro.
/// `null` se il tratto non è così.
function arrow(points: readonly Point[]): Recognized | null {
  const start = points[0]!;
  let far = 0;
  for (const p of points) far = Math.max(far, distance(start, p));
  // La punta torna sulla cima, una o due volte: vale il primo arrivo, e lì
  // il punto più lontano finché il tratto si allontana.
  let tip = points.findIndex((p) => distance(start, p) >= (1 - HOOK) * far);
  while (tip + 1 < points.length && distance(start, points[tip + 1]!) > distance(start, points[tip]!)) tip++;
  if (tip < 2 || tip > points.length - 3) return null;
  const shaft = straight(points.slice(0, tip + 1), { start: true, end: false });
  if (shaft === null) return null;
  const length = distance(shaft.from, shaft.to);
  const head = points.slice(tip);
  const top = points[tip]!;
  const u: Point = [(shaft.to[0] - shaft.from[0]) / length, (shaft.to[1] - shaft.from[1]) / length];
  let extent = 0;
  for (const p of head) extent = Math.max(extent, distance(top, p));
  if (extent < HEAD_MIN * length || extent > HEAD_MAX * length) return null;
  const travel = lengths(head);
  if (travel[travel.length - 1]! > HEAD_TRAVEL * extent) return null;
  let left: [number, number] = [0, 0];
  let right: [number, number] = [0, 0];
  for (const p of head) {
    const along = (p[0] - top[0]) * u[0] + (p[1] - top[1]) * u[1];
    const side = (p[1] - top[1]) * u[0] - (p[0] - top[0]) * u[1];
    if (along > HEAD_FORWARD * extent) return null;
    if (side > left[1]) left = [along, side];
    if (side < right[1]) right = [along, side];
  }
  for (const [along, side] of [left, right]) {
    if (Math.abs(side) < BARB_SIDE * extent || along >= 0) return null;
    const angle = degrees(Math.atan2(Math.abs(side), -along));
    if (angle < BARB_MIN || angle > BARB_MAX) return null;
  }
  return { kind: "arrow", from: shaft.from, to: shaft.to };
}

// ---------------------------------------------------------------------------
// Chiuso: ellisse e poligono.

/// Il giro chiuso di `points`: i punti fra due, uno nel primo quarto del
/// tratto e uno nell'ultimo, abbastanza vicini. Fra le coppie vince quella
/// che è vicina e taglia meno tratto: dove una stella si incrocia i punti
/// si toccano come alla chiusura, ma il giro sarebbe più corto. `null` se
/// il tratto è aperto.
function loop(points: readonly Point[], size: number): Point[] | null {
  const along = lengths(points);
  const total = along[along.length - 1]!;
  let best = Infinity;
  let gap = Infinity;
  let from = 0;
  let to = points.length - 1;
  for (let i = 0; i < points.length && along[i]! <= CLOSE_SPAN * total; i++) {
    for (let j = points.length - 1; j > i && along[j]! >= (1 - CLOSE_SPAN) * total; j--) {
      const d = distance(points[i]!, points[j]!);
      const cost = d + CUT * (along[i]! + total - along[j]!);
      if (d <= CLOSE_GAP * size && cost < best) {
        best = cost;
        gap = d;
        from = i;
        to = j;
      }
    }
  }
  if (gap === Infinity) return null;
  const ring = points.slice(from, to + 1);
  const around = along[to]! - along[from]! + gap;
  return ring.length >= 8 && around >= LOOP_LENGTH * diagonal(ring) ? ring : null;
}

interface EllipseFit {
  readonly center: Point;
  readonly rx: number;
  readonly ry: number;
  /// Dell'asse `rx`, in gradi.
  readonly angle: number;
}

/// L'ellisse con l'area e i momenti dell'area che il giro `ring` racchiude:
/// per un'ellisse vera è lei. `null` se il giro non racchiude niente.
function ellipseOf(ring: readonly Point[]): EllipseFit | null {
  let mx = 0;
  let my = 0;
  for (const [x, y] of ring) {
    mx += x;
    my += y;
  }
  mx /= ring.length;
  my /= ring.length;
  let area = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < ring.length; i++) {
    const x0 = ring[i]![0] - mx;
    const y0 = ring[i]![1] - my;
    const x1 = ring[(i + 1) % ring.length]![0] - mx;
    const y1 = ring[(i + 1) % ring.length]![1] - my;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    sx += (x0 + x1) * cross;
    sy += (y0 + y1) * cross;
    sxx += (x0 * x0 + x0 * x1 + x1 * x1) * cross;
    syy += (y0 * y0 + y0 * y1 + y1 * y1) * cross;
    sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cross;
  }
  area /= 2;
  if (!(Math.abs(area) > 0)) return null;
  const cx = sx / (6 * area);
  const cy = sy / (6 * area);
  const uxx = sxx / (12 * area) - cx * cx;
  const uyy = syy / (12 * area) - cy * cy;
  const uxy = sxy / (24 * area) - cx * cy;
  const half = (uxx + uyy) / 2;
  const root = Math.hypot((uxx - uyy) / 2, uxy);
  const major = half + root;
  const minor = half - root;
  if (!(minor > 0)) return null;
  return {
    center: [cx + mx, cy + my],
    rx: 2 * Math.sqrt(major),
    ry: 2 * Math.sqrt(minor),
    angle: degrees(Math.atan2(2 * uxy, uxx - uyy) / 2),
  };
}

/// Lo scarto quadratico medio dei punti dall'ellisse, misurato lungo il
/// raggio.
function ellipseError(ring: readonly Point[], e: EllipseFit): number {
  const cos = Math.cos(radians(e.angle));
  const sin = Math.sin(radians(e.angle));
  let sum = 0;
  for (const [x, y] of ring) {
    const dx = x - e.center[0];
    const dy = y - e.center[1];
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    const r = Math.hypot(u / e.rx, v / e.ry);
    const d = r === 0 ? e.ry : Math.abs(1 - 1 / r) * Math.hypot(u, v);
    sum += d * d;
  }
  return Math.sqrt(sum / ring.length);
}

/// Douglas–Peucker su `ring[from..to]`: gli indici dei punti che restano,
/// tranne `from`.
function simplify(ring: readonly Point[], from: number, to: number, tolerance: number, out: number[]): void {
  const n = ring.length;
  const span = (to - from + n) % n;
  let worst = -1;
  let far = tolerance;
  for (let k = 1; k < span; k++) {
    const i = (from + k) % n;
    const d = segmentDistance(ring[i]!, ring[from]!, ring[to]!);
    if (d > far) {
      far = d;
      worst = i;
    }
  }
  if (worst >= 0) {
    simplify(ring, from, worst, tolerance, out);
    simplify(ring, worst, to, tolerance, out);
  } else {
    out.push(to);
  }
}

/// Gli spigoli del giro: gli indici in `ring` dei vertici del poligono più
/// semplice che gli sta vicino, senza gli spigoli che girano poco e senza
/// gli angoli smussati.
function corners(ring: readonly Point[], size: number): number[] {
  const n = ring.length;
  // Si parte dal punto più lontano dal centro, che è uno spigolo, e dal più
  // lontano da lui.
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x / n;
    cy += y / n;
  }
  let a = 0;
  for (let i = 1; i < n; i++) if (distance(ring[i]!, [cx, cy]) > distance(ring[a]!, [cx, cy])) a = i;
  let b = a;
  for (let i = 0; i < n; i++) if (distance(ring[i]!, ring[a]!) > distance(ring[b]!, ring[a]!)) b = i;
  if (b === a) return [];
  const found: number[] = [];
  simplify(ring, a, b, SIMPLIFY * size, found);
  simplify(ring, b, a, SIMPLIFY * size, found);
  let vertices = found.sort((x, y) => x - y);
  for (;;) {
    const k = vertices.length;
    if (k < 3) return vertices;
    // Prima lo spigolo che gira meno, poi il lato più corto.
    let flattest = -1;
    let least = MIN_TURN;
    for (let i = 0; i < k; i++) {
      const angle = turn(ring[vertices[(i + k - 1) % k]!]!, ring[vertices[i]!]!, ring[vertices[(i + 1) % k]!]!);
      if (angle < least) {
        least = angle;
        flattest = i;
      }
    }
    if (flattest >= 0) {
      vertices = vertices.filter((_, i) => i !== flattest);
      continue;
    }
    const point = (i: number): Point => ring[vertices[((i % k) + k) % k]!]!;
    let shortest = -1;
    let short = Infinity;
    for (let i = 0; i < k; i++) {
      const side = distance(point(i), point(i + 1));
      const neighbors = Math.max(distance(point(i - 1), point(i)), distance(point(i + 1), point(i + 2)));
      const gentle = turn(point(i - 1), point(i), point(i + 1)) + turn(point(i), point(i + 1), point(i + 2)) < CHAMFER_TURNS;
      if (gentle && side < SHORT_SIDE * neighbors && side < short) {
        short = side;
        shortest = i;
      }
    }
    if (shortest < 0) return vertices;
    // I due capi del lato corto diventano uno, a metà strada sul tratto.
    const p = vertices[shortest]!;
    const q = vertices[(shortest + 1) % k]!;
    const middle = (p + Math.floor(((q - p + n) % n) / 2)) % n;
    vertices = vertices.filter((v) => v !== p && v !== q);
    vertices.push(middle);
    vertices.sort((x, y) => x - y);
  }
}

/// Il poligono del giro: i vertici sono gli incroci delle rette dei lati,
/// ciascuna adattata ai punti del suo lato tranne quelli vicino agli
/// spigoli, che la mano arrotonda.
function polygonOf(ring: readonly Point[], at: readonly number[]): Point[] {
  const n = ring.length;
  const k = at.length;
  const lines = at.map((from, i) => {
    const to = at[(i + 1) % k]!;
    const span = (to - from + n) % n;
    const trim = Math.floor(span * SIDE_TRIM);
    const side: Point[] = [];
    for (let s = trim; s <= span - trim; s++) side.push(ring[(from + s) % n]!);
    return fitLine(side.length >= 2 ? side : [ring[from]!, ring[to]!]);
  });
  return at.map((index, i) => {
    const meet = intersect(lines[(i + k - 1) % k]!, lines[i]!);
    return meet !== null && distance(meet, ring[index]!) <= 0.25 * diagonal(ring) ? meet : ring[index]!;
  });
}

/// Lo scarto quadratico medio dei punti dal contorno del poligono.
function polygonError(ring: readonly Point[], polygon: readonly Point[]): number {
  let sum = 0;
  for (const p of ring) {
    let d = Infinity;
    for (let i = 0; i < polygon.length; i++) d = Math.min(d, segmentDistance(p, polygon[i]!, polygon[(i + 1) % polygon.length]!));
    sum += d * d;
  }
  return Math.sqrt(sum / ring.length);
}

/// L'area di un poligono, col segno del verso.
function signedArea(polygon: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i]!;
    const [x1, y1] = polygon[(i + 1) % polygon.length]!;
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

/// Il rettangolo di quattro vertici con gli angoli quasi retti, o `null`.
function rectangle(quad: readonly Point[]): Recognized | null {
  let off = 0;
  for (let i = 0; i < 4; i++) {
    const angle = 180 - turn(quad[(i + 3) % 4]!, quad[i]!, quad[(i + 1) % 4]!);
    if (Math.abs(angle - 90) > RIGHT_ANGLE_MAX) return null;
    off += Math.abs(angle - 90) / 4;
  }
  if (off > RIGHT_ANGLE_MEAN) return null;
  // La direzione dei lati, a meno di un angolo retto: la media dei quattro,
  // pesata con la lunghezza, sull'angolo quadruplicato.
  let c = 0;
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const length = distance(a, b);
    c += length * Math.cos(4 * angle);
    s += length * Math.sin(4 * angle);
  }
  let angle = wrap(degrees(Math.atan2(s, c) / 4), 90);
  if (Math.abs(angle) <= AXIS_SNAP) angle = 0;
  const cos = Math.cos(radians(angle));
  const sin = Math.sin(radians(angle));
  const us = quad.map(([x, y]) => x * cos + y * sin).sort((a, b) => a - b);
  const vs = quad.map(([x, y]) => -x * sin + y * cos).sort((a, b) => a - b);
  const left = (us[0]! + us[1]!) / 2;
  const right = (us[2]! + us[3]!) / 2;
  const top = (vs[0]! + vs[1]!) / 2;
  const bottom = (vs[2]! + vs[3]!) / 2;
  const u = (left + right) / 2;
  const v = (top + bottom) / 2;
  const width = right - left;
  const height = bottom - top;
  if (Math.min(width, height) < THIN * Math.max(width, height)) return null;
  return { kind: "rect", center: [u * cos - v * sin, u * sin + v * cos], width, height, angle };
}

/// L'ellisse riconosciuta: diritta se è girata di poco, un cerchio se gli
/// assi sono quasi uguali.
function ellipse(e: EllipseFit): Recognized | null {
  if (e.ry < THIN * e.rx) return null;
  if (e.rx <= CIRCLE_RATIO * e.ry) {
    const r = (e.rx + e.ry) / 2;
    return { kind: "ellipse", center: e.center, rx: r, ry: r, angle: 0 };
  }
  let angle = wrap(e.angle, 180);
  let { rx, ry } = e;
  if (Math.abs(angle) <= AXIS_SNAP) angle = 0;
  else if (90 - Math.abs(angle) <= AXIS_SNAP) [rx, ry, angle] = [ry, rx, 0];
  return { kind: "ellipse", center: e.center, rx, ry, angle };
}

/// Vero se due lati non vicini del poligono si incrociano.
function crossed(polygon: readonly Point[]): boolean {
  const k = polygon.length;
  const side = (p: Point, a: Point, b: Point): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < k; i++) {
    for (let j = i + 2; j < k; j++) {
      if (i === 0 && j === k - 1) continue;
      const [a, b] = [polygon[i]!, polygon[(i + 1) % k]!];
      const [c, d] = [polygon[j]!, polygon[(j + 1) % k]!];
      if (side(c, a, b) * side(d, a, b) < 0 && side(a, c, d) * side(b, c, d) < 0) return true;
    }
  }
  return false;
}

/// La stella che il poligono disegna: i vertici, in ordine, girano attorno
/// al baricentro a passi uguali di `step` posti, almeno 2, come la stella a
/// cinque punte disegnata senza staccare, che va di due in due. `null` per
/// un poligono che non si incrocia, o che si incrocia in un altro modo.
export function starOf(points: readonly Point[]): { readonly count: number; readonly step: number } | null {
  const n = points.length;
  if (n < 5 || !crossed(points)) return null;
  const [cx, cy] = mean(points);
  const rank = new Array<number>(n);
  points
    .map((p, i) => ({ i, angle: Math.atan2(p[1] - cy, p[0] - cx) }))
    .sort((a, b) => a.angle - b.angle)
    .forEach((entry, place) => (rank[entry.i] = place));
  const step = (rank[1]! - rank[0]! + n) % n;
  for (let i = 0; i < n; i++) if ((rank[(i + 1) % n]! - rank[i]! + n) % n !== step) return null;
  const least = Math.min(step, n - step);
  return least >= 2 ? { count: n, step: least } : null;
}

function closedShape(ring: readonly Point[]): Recognized | null {
  const size = diagonal(ring);
  const fit = ellipseOf(ring);
  const ellipseErr = fit === null ? Infinity : ellipseError(ring, fit) / size;
  const at = corners(ring, size);
  let polygon: Point[] | null = null;
  let polygonErr = Infinity;
  if (at.length >= 3 && at.length <= MAX_SIDES) {
    polygon = polygonOf(ring, at);
    polygonErr = polygonError(ring, polygon) / size;
    // Un poligono che si incrocia è una stella o niente.
    if (Math.abs(signedArea(polygon)) < (THIN / 2) * size * size || (crossed(polygon) && starOf(polygon) === null)) polygon = null;
  }
  const polygonWins = polygon !== null && polygonErr <= POLYGON_ERROR && (polygonErr <= POLYGON_ADVANTAGE * ellipseErr || ellipseErr > ELLIPSE_ERROR);
  if (polygonWins) return polygon!.length === 4 && !crossed(polygon!) ? (rectangle(polygon!) ?? { kind: "polygon", points: polygon! }) : { kind: "polygon", points: polygon! };
  if (fit !== null && ellipseErr <= ELLIPSE_ERROR) return ellipse(fit);
  return null;
}

// ---------------------------------------------------------------------------
// Le forme.

/// Il lato più lungo del riquadro di un tratto, sullo schermo, sotto cui il
/// tratto tenuto fermo alla fine resta inchiostro: la misura della
/// scrittura, lettere e cifre comprese.
export const HOLD_MIN_PX = 40;

/// Dove comincia la tenuta ferma alla fine di `points`: l'indice del punto
/// da cui tutti i seguenti restano entro `radius`. Ogni punto più lontano
/// dal punto fermo diventa il punto fermo nuovo, come fa l'editor mentre la
/// mano si muove.
export function stillFrom(points: readonly Point[], radius: number): number {
  let anchor = 0;
  for (let i = 1; i < points.length; i++) if (distance(points[i]!, points[anchor]!) > radius) anchor = i;
  return anchor;
}

/// La forma per un tratto tenuto fermo alla fine, con `pixels` pixel dello
/// schermo per unità dei punti e la mano che trema entro `still` pixel
/// mentre sta ferma. Il tremito non conta. `null` per un tratto piccolo
/// quanto la scrittura, o che non somiglia a una forma.
export function heldShape(points: readonly Point[], pixels: number, still: number): Recognized | null {
  const moving = points.slice(0, stillFrom(points, still / pixels) + 1);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of moving) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Math.max(maxX - minX, maxY - minY) * pixels < HOLD_MIN_PX ? null : recognize(moving);
}

/// La forma che i punti di un tratto disegnano, o `null` se non somigliano
/// a nessuna.
export function recognize(points: readonly Point[]): Recognized | null {
  const unique = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
  if (unique.length < 2) return null;
  const size = diagonal(unique);
  if (!(size > 0)) return null;
  const even = resample(unique, size / RESAMPLE, false);
  if (even.length < 4) return null;
  const ring = loop(even, size);
  if (ring !== null) {
    const closed = closedShape(resample(ring, diagonal(ring) / RESAMPLE, true));
    if (closed !== null) return closed;
  }
  const line = straight(even, { start: true, end: true });
  if (line !== null) return { kind: "line", ...line };
  return arrow(even);
}

/// Il centro attorno a cui la forma si regola: il centro della forma, il
/// baricentro dei vertici di un poligono, il mezzo di una linea.
export function centerOf(shape: Recognized): Point {
  switch (shape.kind) {
    case "line":
    case "arrow":
      return [(shape.from[0] + shape.to[0]) / 2, (shape.from[1] + shape.to[1]) / 2];
    case "polygon":
      return mean(shape.points);
    default:
      return shape.center;
  }
}

/// La forma regolare più vicina: un quadrato, un cerchio, un poligono
/// regolare, una stella coi lati in linea a due a due. Una linea e una
/// freccia vanno a passi di 15°, come con `Maiusc` nei loro strumenti; un
/// quadrato, un poligono e una stella girano a passi di 15°.
export function regular(shape: Recognized): Recognized {
  const step = (angle: number): number => Math.round(angle / SNAP_DEGREES) * SNAP_DEGREES;
  switch (shape.kind) {
    case "line":
    case "arrow":
      return { ...shape, to: constrainEnd("line", shape.from, shape.to) };
    case "rect": {
      const side = (shape.width + shape.height) / 2;
      return { ...shape, width: side, height: side, angle: wrap(step(shape.angle), 90) };
    }
    case "ellipse": {
      const r = (shape.rx + shape.ry) / 2;
      return { ...shape, rx: r, ry: r, angle: 0 };
    }
    case "regular":
      return { ...shape, angle: wrap(step(shape.angle), 360 / shape.count) };
    case "polygon": {
      const count = shape.points.length;
      const center = centerOf(shape);
      let r = 0;
      for (const p of shape.points) r += distance(center, p) / count;
      // La rotazione che mette i vertici della forma diritta più vicino a
      // quelli disegnati, in un periodo di un lato; il poligono diritto ha
      // il vertice 0 a sinistra del lato in basso, la stella diritta ha una
      // punta in alto.
      const star = starOf(shape.points);
      const period = 360 / count;
      const first = star === null ? 90 + 180 / count : 270;
      let c = 0;
      let s = 0;
      for (const p of shape.points) {
        const turned = degrees(Math.atan2(p[1] - center[1], p[0] - center[0])) - first;
        c += Math.cos(radians((turned * 360) / period));
        s += Math.sin(radians((turned * 360) / period));
      }
      const angle = wrap(step((degrees(Math.atan2(s, c)) * period) / 360), period);
      if (star !== null) {
        // I lati in linea a due a due: la stella {n/m} disegnata senza
        // staccare ha il raggio interno dove due lati si incrociano.
        const ratio = Math.cos((Math.PI * star.step) / count) / Math.cos((Math.PI * (star.step - 1)) / count);
        return { kind: "regular", center, r, count, angle, ratio };
      }
      // Quattro lati uguali e quattro angoli retti sono un quadrato: un
      // rettangolo, come quello dello strumento.
      if (count === 4) return { kind: "rect", center, width: r * Math.SQRT2, height: r * Math.SQRT2, angle: wrap(angle, 90) };
      return { kind: "regular", center, r, count, angle, ratio: null };
    }
  }
}

/// La forma girata di `turnBy` gradi e scalata di `scale` attorno a
/// `center`.
export function similar(shape: Recognized, center: Point, scale: number, turnBy: number): Recognized {
  const m = compose(translate(center[0], center[1]), compose(rotate(turnBy), compose([scale, 0, 0, scale, 0, 0], translate(-center[0], -center[1]))));
  return mapped(shape, m)!;
}

/// La forma vista attraverso `m`, che deve essere una similitudine:
/// spostamento, rotazione, scala uguale sui due assi e ribaltamento. `null`
/// per le altre matrici, che non tengono un cerchio un cerchio.
export function mapped(shape: Recognized, m: Matrix): Recognized | null {
  const [a, b, c, d] = m;
  const scale = Math.hypot(a, b);
  if (!(scale > 0) || Math.abs(Math.hypot(c, d) - scale) > 1e-9 * scale || Math.abs(a * c + b * d) > 1e-9 * scale * scale) return null;
  const flipped = a * d - b * c < 0;
  const spin = degrees(Math.atan2(b, a));
  const angleOf = (angle: number): number => (flipped ? spin - angle : spin + angle);
  switch (shape.kind) {
    case "line":
    case "arrow":
      return { ...shape, from: apply(m, shape.from), to: apply(m, shape.to) };
    case "polygon":
      return { kind: "polygon", points: shape.points.map((p) => apply(m, p)) };
    case "rect":
      return { ...shape, center: apply(m, shape.center), width: shape.width * scale, height: shape.height * scale, angle: wrap(angleOf(shape.angle), 180) };
    case "ellipse":
      return { ...shape, center: apply(m, shape.center), rx: shape.rx * scale, ry: shape.ry * scale, angle: wrap(angleOf(shape.angle), 180) };
    case "regular": {
      // Ribaltata, la forma diritta resta diritta, perché è simmetrica:
      // il vertice 0, all'angolo `first` più la rotazione, va all'angolo
      // opposto, che è quello di un altro vertice con un'altra rotazione.
      const first = shape.ratio === null ? 90 + 180 / shape.count : 270;
      return {
        ...shape,
        center: apply(m, shape.center),
        r: shape.r * scale,
        angle: wrap(flipped ? spin - 2 * first - shape.angle : spin + shape.angle, 360 / shape.count),
      };
    }
  }
}

/// La rotazione `angle` attorno a `center`, come matrice.
function turned(center: Point, angle: number): Matrix {
  return compose(translate(center[0], center[1]), compose(rotate(angle), translate(-center[0], -center[1])));
}

function text(value: number): string {
  return formatNumber(value, 2);
}

/// L'elemento della forma, con l'id `id` e il contorno di `style`, senza
/// riempimento, come quello dello strumento della stessa forma. `frame` è
/// il `transform` che l'elemento tiene: quello del tratto da cui viene.
/// `null` se, arrotondata, la forma non si disegna.
export function shapeOfRecognized(shape: Recognized, id: string, style: ShapeStyle, frame: Matrix = IDENTITY): Elem | null {
  let elem: Elem | null;
  let spin = 0;
  let center: Point = [0, 0];
  switch (shape.kind) {
    case "line":
    case "arrow":
      elem = shapeElem(shape.kind, id, shape.from, shape.to, style, 0);
      break;
    case "rect":
    case "ellipse": {
      const [w, h] = shape.kind === "rect" ? [shape.width / 2, shape.height / 2] : [shape.rx, shape.ry];
      const [x, y] = shape.center;
      elem = shapeElem(shape.kind, id, [x - w, y - h], [x + w, y + h], style, 0);
      spin = shape.angle;
      center = shape.center;
      break;
    }
    case "regular": {
      const written = polygonalAttrs({
        shape: shape.ratio === null ? "polygon" : "star",
        cx: shape.center[0],
        cy: shape.center[1],
        r: shape.r,
        count: Math.min(MAX_COUNT, Math.max(MIN_COUNT, shape.count)),
        ratio: shape.ratio,
        rotation: normalRotation(shape.angle),
        corner: 0,
      });
      elem = written === null ? null : { tag: "path", attrs: { id, ...written, fill: "none", stroke: style.color, "stroke-width": text(style.width) } };
      break;
    }
    case "polygon": {
      const points = shape.points.map(([x, y]) => `${text(x)},${text(y)}`);
      const rounded = shape.points.map(([x, y]): Point => [Number(text(x)), Number(text(y))]);
      elem = Math.abs(signedArea(rounded)) > 0
        ? { tag: "polygon", attrs: { id, points: points.join(" "), fill: "none", stroke: style.color, "stroke-width": text(style.width) } }
        : null;
      break;
    }
  }
  if (elem === null) return null;
  const transform = spin === 0 ? frame : compose(frame, turned(center, spin));
  return transform.every((v, i) => v === IDENTITY[i]) ? elem : { ...elem, attrs: { ...elem.attrs, transform: formatTransform(transform) } };
}
