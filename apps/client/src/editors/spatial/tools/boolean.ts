// Le operazioni booleane fra forme, per il livello Esperto: unione,
// differenza, intersezione, esclusione e divisione. Senza DOM e senza
// documento: forme in entrata e tracciati in uscita, nelle stesse
// coordinate.
//
// - **I contorni diventano spezzate** che stanno a due millesimi dalla
//   curva, e ogni punto ricorda la curva da cui viene e il suo parametro.
// - **Le spezzate formano un arrangiamento planare.** Si spezzano dove si
//   incrociano; i punti più vicini della tolleranza si fondono, e un punto
//   così vicino a un lato lo spezza, o si fonde col capo vicino. Si
//   ricomincia finché nessun lato ne attraversa un altro: bordi coincidenti,
//   contatti in un vertice e tangenze diventano lati e vertici comuni.
// - **L'avvolgimento di ogni faccia**, per ogni forma, si propaga dalla
//   faccia esterna attraverso i lati, ciascuno dei quali sa di quanto lo
//   cambia: nessuna prova di punto nel poligono. Dentro una forma stanno le
//   facce ad avvolgimento non nullo, o dispari con `fill-rule="evenodd"`.
// - **Il risultato sono i lati fra una faccia dentro e una fuori**, in
//   anelli. Ogni tratto torna il pezzo della curva originale fra due
//   parametri, non un'approssimazione, con i capi sugli incroci veri, che
//   il metodo di Newton ritrova. Dove due forme coincidono vale la curva di
//   quella più in basso, e ogni anello comincia da un nodo, se può: di
//   quella più in basso prima che delle altre.

import { arcCenter, derivativeAt, pointAt, reversed, splitAt, type Curve } from "../scene/curves";
import { roundHalfUp } from "../number";
import type { Segment } from "../scene/geometry";
import { apply, type Matrix, type Point } from "../scene/matrix";
import { mappedEllipse } from "./apply";

/// Le operazioni. La forma più in basso è la prima: la differenza le toglie
/// le altre, e la divisione la taglia lungo i loro contorni.
export type BooleanKind = "union" | "difference" | "intersection" | "exclusion" | "division";

/// Una forma: i segmenti nelle coordinate comuni, la regola con cui si
/// riempie, e se i segmenti sono quelli scritti, senza trasformazione: una
/// sua curva che passa intera nel risultato si riscrive com'era.
export interface Shape {
  readonly segments: readonly Segment[];
  readonly evenOdd: boolean;
  readonly written: boolean;
}

/// I punti più vicini di così si fondono, e un punto così vicino a un lato
/// lo spezza: i numeri si scrivono al centesimo, e due punti scritti al
/// centesimo da calcoli diversi sbagliano fra loro di un centesimo e mezzo.
const EPSILON = 0.015;
/// Quanto la spezzata può scostarsi dalla curva.
const FLATNESS = 0.002;
/// Quanto un nodo fra due linee può scostarsi dalla retta che le unisce e
/// andarsene: meno di quanto si vede scritto al centesimo.
const COLLINEAR = 0.004;
/// I passi al più della spezzata di una curva.
const MAX_STEPS = 4096;
/// I giri al più per rendere planare l'arrangiamento; di solito ne bastano
/// due o tre.
const MAX_ROUNDS = 16;
const QUARTER = Math.PI / 2;

const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/// Negativo se `p` viene prima di `q` da sinistra, poi dall'alto, come i
/// punti si scrivono, al centesimo: due incroci sulla stessa verticale non si
/// ordinano per un errore di calcolo.
const leftward = (p: Point, q: Point): number => roundHalfUp(p[0], 100) - roundHalfUp(q[0], 100) || roundHalfUp(p[1], 100) - roundHalfUp(q[1], 100);

/// I segmenti `segments` dopo `m`: gli archi coi raggi e la rotazione
/// dell'ellisse trasformata, e col verso invertito da un ribaltamento. Un
/// arco senza raggi ne resta senza.
export function mapped(segments: readonly Segment[], m: Matrix): Segment[] {
  const flips = m[0] * m[3] - m[1] * m[2] < 0;
  const at = (p: Point): Point => apply(m, p);
  return segments.map((segment): Segment => {
    switch (segment.kind) {
      case "move":
      case "line":
        return { kind: segment.kind, to: at(segment.to) };
      case "quad":
        return { kind: "quad", control: at(segment.control), to: at(segment.to) };
      case "cubic":
        return { kind: "cubic", c1: at(segment.c1), c2: at(segment.c2), to: at(segment.to) };
      case "arc": {
        const { radii, rotation } = mappedEllipse(m, Math.abs(segment.radii[0]), Math.abs(segment.radii[1]), segment.rotation);
        return { kind: "arc", radii, rotation, large: segment.large, sweep: segment.sweep !== flips, to: at(segment.to) };
      }
      case "close":
        return segment;
    }
  });
}

// ---------------------------------------------------------------------------
// Le curve delle forme.
// ---------------------------------------------------------------------------

/// Una curva di una forma, col punto da cui parte.
interface Source {
  readonly shape: number;
  readonly from: Point;
  readonly curve: Curve;
  /// Vero per le curve che tagliano, nella divisione: non racchiudono niente.
  readonly cut: boolean;
}

/// `curve` da `from` come SVG la disegna: un arco senza raggi, o coi capi
/// nello stesso punto, è una linea. Una curva che resta in un punto non ha
/// lati: i suoi vertici si fondono.
function drawn(from: Point, curve: Curve): Curve {
  return curve.kind === "arc" && arcCenter(from, curve) === null ? { kind: "line", to: curve.to } : curve;
}

/// Le curve delle forme, in ordine. Un sottotracciato aperto si riempie come
/// se una linea lo chiudesse, e quella linea è una curva anche lei; nella
/// divisione le forme sopra la prima tagliano e basta, e un loro
/// sottotracciato aperto resta aperto.
function sourcesOf(shapes: readonly Shape[], division: boolean): Source[] {
  const out: Source[] = [];
  shapes.forEach((shape, k) => {
    const cut = division && k > 0;
    const add = (from: Point, segment: Curve): void => {
      out.push({ shape: k, from, curve: drawn(from, segment), cut });
    };
    let start: Point = [0, 0];
    let current: Point = [0, 0];
    let open = false;
    const end = (): void => {
      if (open && !cut) add(current, { kind: "line", to: start });
      open = false;
    };
    for (const segment of shape.segments) {
      if (segment.kind === "move") {
        end();
        start = segment.to;
        current = segment.to;
      } else if (segment.kind === "close") {
        add(current, { kind: "line", to: start });
        current = start;
        open = false;
      } else {
        add(current, segment);
        current = segment.to;
        open = true;
      }
    }
    end();
  });
  return out;
}

/// I passi della spezzata di `source`: abbastanza da starle a `FLATNESS`, e
/// da non superare `span` l'uno; non così tanti che due punti vicini si
/// fondano.
function stepsOf(source: Source, span: number): number {
  const { from, curve } = source;
  let steps: number;
  let length: number;
  switch (curve.kind) {
    case "line":
      steps = 1;
      length = distance(from, curve.to);
      break;
    case "quad": {
      // La spezzata a passi uguali sta entro |P″| / 8n² dalla curva.
      const { control, to } = curve;
      const bend = Math.hypot(from[0] - 2 * control[0] + to[0], from[1] - 2 * control[1] + to[1]);
      steps = Math.ceil(Math.sqrt(bend / (4 * FLATNESS)));
      length = distance(from, control) + distance(control, to);
      break;
    }
    case "cubic": {
      const { c1, c2, to } = curve;
      const bend = Math.max(
        Math.hypot(from[0] - 2 * c1[0] + c2[0], from[1] - 2 * c1[1] + c2[1]),
        Math.hypot(c1[0] - 2 * c2[0] + to[0], c1[1] - 2 * c2[1] + to[1]),
      );
      steps = Math.ceil(Math.sqrt((3 * bend) / (4 * FLATNESS)));
      length = distance(from, c1) + distance(c1, c2) + distance(c2, to);
      break;
    }
    case "arc": {
      const arc = arcCenter(from, curve)!;
      const radius = Math.max(arc.radii[0], arc.radii[1]);
      const step = radius <= FLATNESS ? QUARTER : 2 * Math.acos(1 - FLATNESS / radius);
      steps = Math.ceil(Math.abs(arc.delta) / step);
      length = radius * Math.abs(arc.delta);
      break;
    }
  }
  steps = Math.max(Math.min(steps, Math.floor(length / (2 * EPSILON))), Math.ceil(length / span), 1);
  return Number.isFinite(steps) ? Math.min(steps, MAX_STEPS) : 1;
}

/// I punti che contengono `source`: i capi, i punti di controllo, e per un
/// arco il riquadro della sua ellisse.
function extentOf(source: Source): Point[] {
  const { from, curve } = source;
  switch (curve.kind) {
    case "line":
      return [from, curve.to];
    case "quad":
      return [from, curve.control, curve.to];
    case "cubic":
      return [from, curve.c1, curve.c2, curve.to];
    case "arc": {
      const arc = arcCenter(from, curve)!;
      const r = Math.max(arc.radii[0], arc.radii[1]);
      return [from, curve.to, [arc.center[0] - r, arc.center[1] - r], [arc.center[0] + r, arc.center[1] + r]];
    }
  }
}

// ---------------------------------------------------------------------------
// L'arrangiamento.
// ---------------------------------------------------------------------------

/// Dove un vertice spezza un pezzo: la frazione del pezzo, e il vertice.
interface Cut {
  readonly u: number;
  readonly v: number;
}

/// Le spezzate di tutte le curve, che si spezzano e si fondono finché
/// formano un grafo planare: vertici, e pezzi di curva fra due vertici, col
/// parametro della curva a ciascun capo.
class Net {
  readonly x: number[] = [];
  readonly y: number[] = [];
  /// Quanto conta il posto di un vertice: 0 per un nodo di una forma, 1 per
  /// un incrocio, 2 per un punto della spezzata. Dove i vertici si fondono
  /// vale il posto di quello che conta di più.
  readonly rank: number[] = [];
  /// La prima delle curve che cominciano nel vertice, o `Infinity`.
  readonly first: number[] = [];
  a: number[] = [];
  b: number[] = [];
  src: number[] = [];
  ta: number[] = [];
  tb: number[] = [];
  private readonly min: Point;
  private readonly cell: number;
  private readonly rows: number;
  /// Le coppie di vertici da fondere al prossimo giro, anche se più lontani
  /// di `EPSILON`.
  private joins: [number, number][] = [];

  constructor(readonly sources: readonly Source[]) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const source of sources) {
      for (const [px, py] of extentOf(source)) {
        x0 = Math.min(x0, px);
        y0 = Math.min(y0, py);
        x1 = Math.max(x1, px);
        y1 = Math.max(y1, py);
      }
    }
    // Un margine, perché le celle non escano mai dal riquadro.
    this.min = [x0 - 1, y0 - 1];
    this.cell = Math.max(Math.max(x1 - x0, y1 - y0) / 64, 16 * EPSILON);
    this.rows = Math.ceil((y1 - y0 + 2) / this.cell) + 2;
    sources.forEach((source, i) => {
      const steps = stepsOf(source, this.cell);
      let previous = this.vertex(source.from, 0, i);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const next = k === steps ? this.vertex(source.curve.to, 0) : this.vertex(pointAt(source.from, source.curve, t), 2);
        this.push(previous, next, i, (k - 1) / steps, t);
        previous = next;
      }
    });
  }

  vertex(p: Point, rank: number, first = Infinity): number {
    this.x.push(p[0]);
    this.y.push(p[1]);
    this.rank.push(rank);
    this.first.push(first);
    return this.x.length - 1;
  }

  at(v: number): Point {
    return [this.x[v]!, this.y[v]!];
  }

  private push(a: number, b: number, src: number, ta: number, tb: number): void {
    this.a.push(a);
    this.b.push(b);
    this.src.push(src);
    this.ta.push(ta);
    this.tb.push(tb);
  }

  /// Vero quando nessun pezzo ne attraversa un altro e nessun vertice sta
  /// troppo vicino a un pezzo che non tocca; falso se non ci arriva.
  planar(): boolean {
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      this.merge();
      const cuts = this.cuts();
      if (cuts.size === 0 && this.joins.length === 0) return true;
      this.split(cuts);
    }
    return false;
  }

  /// Fonde i vertici più vicini di `EPSILON` e le coppie di `joins`, e i
  /// pezzi rimasti in un punto se ne vanno.
  private merge(): void {
    const n = this.x.length;
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (v: number): number => {
      while (parent[v] !== v) {
        parent[v] = parent[parent[v]!]!;
        v = parent[v]!;
      }
      return v;
    };
    const better = (u: number, v: number): boolean => this.rank[u]! < this.rank[v]! || (this.rank[u] === this.rank[v] && u < v);
    const grid = new Map<number, number[]>();
    const live: number[] = [];
    const seen = new Uint8Array(n);
    for (const v of [...this.a, ...this.b]) {
      if (seen[v] === 1) continue;
      seen[v] = 1;
      live.push(v);
      const cx = Math.floor((this.x[v]! - this.min[0]) / EPSILON);
      const cy = Math.floor((this.y[v]! - this.min[1]) / EPSILON);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const w of grid.get((cx + dx) * 1e8 + cy + dy) ?? []) {
            if (Math.hypot(this.x[v]! - this.x[w]!, this.y[v]! - this.y[w]!) > EPSILON) continue;
            const [rv, rw] = [find(v), find(w)];
            if (rv === rw) continue;
            if (better(rv, rw)) parent[rw] = rv;
            else parent[rv] = rw;
          }
        }
      }
      const key = cx * 1e8 + cy;
      const bucket = grid.get(key);
      if (bucket === undefined) grid.set(key, [v]);
      else bucket.push(v);
    }
    for (const [v, w] of this.joins) {
      const [rv, rw] = [find(v), find(w)];
      if (rv === rw) continue;
      if (better(rv, rw)) parent[rw] = rv;
      else parent[rv] = rw;
    }
    this.joins = [];
    for (const v of live) {
      const root = find(v);
      if (root !== v) this.first[root] = Math.min(this.first[root]!, this.first[v]!);
    }
    const keep = (i: number): boolean => find(this.a[i]!) !== find(this.b[i]!);
    const kept = this.a.map((_, i) => i).filter(keep);
    this.a = kept.map((i) => find(this.a[i]!));
    this.b = kept.map((i) => find(this.b[i]!));
    this.src = kept.map((i) => this.src[i]!);
    this.ta = kept.map((i) => this.ta[i]!);
    this.tb = kept.map((i) => this.tb[i]!);
  }

  /// Dove spezzare i pezzi in questo giro: dove uno ne attraversa un altro,
  /// e dove un vertice sta più vicino di `EPSILON` a un pezzo che non tocca.
  /// Un vertice che sul pezzo cadrebbe a meno di `EPSILON` da un capo va
  /// invece in `joins` con quel capo: spezzarlo lascerebbe un pezzo più
  /// corto della tolleranza, e due pezzi così corti si spezzerebbero a
  /// vicenda senza fine.
  private cuts(): Map<number, Cut[]> {
    const { x, y, a, b } = this;
    const count = a.length;
    const box = new Int32Array(count * 4);
    const grid = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const [p, q] = [a[i]!, b[i]!];
      const ix0 = Math.floor((Math.min(x[p]!, x[q]!) - EPSILON - this.min[0]) / this.cell);
      const iy0 = Math.floor((Math.min(y[p]!, y[q]!) - EPSILON - this.min[1]) / this.cell);
      const ix1 = Math.floor((Math.max(x[p]!, x[q]!) + EPSILON - this.min[0]) / this.cell);
      const iy1 = Math.floor((Math.max(y[p]!, y[q]!) + EPSILON - this.min[1]) / this.cell);
      box.set([ix0, iy0, ix1, iy1], i * 4);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
          const key = ix * this.rows + iy;
          const bucket = grid.get(key);
          if (bucket === undefined) grid.set(key, [i]);
          else bucket.push(i);
        }
      }
    }
    const out = new Map<number, Cut[]>();
    const cut = (piece: number, u: number, v: number): void => {
      const list = out.get(piece);
      if (list === undefined) out.set(piece, [{ u, v }]);
      else list.push({ u, v });
    };
    /// Vero, e spezza `piece` o fonde `v` con un suo capo, se il vertice
    /// `v` gli sta più vicino di `EPSILON` in mezzo.
    const near = (v: number, piece: number): boolean => {
      const [p, q] = [a[piece]!, b[piece]!];
      const dx = x[q]! - x[p]!;
      const dy = y[q]! - y[p]!;
      const u = ((x[v]! - x[p]!) * dx + (y[v]! - y[p]!) * dy) / (dx * dx + dy * dy);
      if (!(u > 0 && u < 1)) return false;
      if (Math.hypot(x[p]! + u * dx - x[v]!, y[p]! + u * dy - y[v]!) > EPSILON) return false;
      const length = Math.hypot(dx, dy);
      if (Math.min(u, 1 - u) * length > EPSILON) cut(piece, u, v);
      else this.joins.push([v, u < 0.5 ? p : q]);
      return true;
    };
    const orient = (p: number, q: number, r: number): number => (x[q]! - x[p]!) * (y[r]! - y[p]!) - (y[q]! - y[p]!) * (x[r]! - x[p]!);
    for (const [key, list] of grid) {
      const cx = Math.floor(key / this.rows);
      const cy = key - cx * this.rows;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const [p, q] = [list[i]!, list[j]!];
          // Ogni coppia una volta sola: nella prima cella che hanno in comune.
          if (Math.max(box[p * 4]!, box[q * 4]!) !== cx || Math.max(box[p * 4 + 1]!, box[q * 4 + 1]!) !== cy) continue;
          const [a1, b1, a2, b2] = [a[p]!, b[p]!, a[q]!, b[q]!];
          if ((a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2)) continue;
          let touched = false;
          for (const v of [a2, b2]) if (v !== a1 && v !== b1 && near(v, p)) touched = true;
          for (const v of [a1, b1]) if (v !== a2 && v !== b2 && near(v, q)) touched = true;
          if (touched || a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue;
          const d1 = orient(a1, b1, a2);
          const d2 = orient(a1, b1, b2);
          const d3 = orient(a2, b2, a1);
          const d4 = orient(a2, b2, b1);
          if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) || !((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) continue;
          const s = d3 / (d3 - d4);
          const v = this.vertex([x[a1]! + s * (x[b1]! - x[a1]!), y[a1]! + s * (y[b1]! - y[a1]!)], 1);
          cut(p, s, v);
          cut(q, d1 / (d1 - d2), v);
        }
      }
    }
    return out;
  }

  /// Spezza i pezzi nei vertici `cuts`; il parametro della curva in un
  /// vertice nuovo sta fra quelli dei capi, come la frazione del pezzo. Un
  /// vertice che spezza un pezzo due volte lascia un pezzo in un punto, che
  /// la fusione dopo toglie.
  private split(cuts: ReadonlyMap<number, readonly Cut[]>): void {
    const a: number[] = [];
    const b: number[] = [];
    const src: number[] = [];
    const ta: number[] = [];
    const tb: number[] = [];
    for (let i = 0; i < this.a.length; i++) {
      const list = cuts.get(i);
      let from = this.a[i]!;
      let t = this.ta[i]!;
      if (list !== undefined) {
        for (const { u, v } of [...list].sort((m, n) => m.u - n.u)) {
          const at = this.ta[i]! + (this.tb[i]! - this.ta[i]!) * u;
          a.push(from);
          b.push(v);
          src.push(this.src[i]!);
          ta.push(t);
          tb.push(at);
          from = v;
          t = at;
        }
      }
      a.push(from);
      b.push(this.b[i]!);
      src.push(this.src[i]!);
      ta.push(t);
      tb.push(this.tb[i]!);
    }
    Object.assign(this, { a, b, src, ta, tb });
  }
}

// ---------------------------------------------------------------------------
// Lati, facce e avvolgimenti.
// ---------------------------------------------------------------------------

/// Un pezzo di curva su un lato: la curva, e il suo parametro nei due capi
/// del lato.
interface Along {
  readonly src: number;
  readonly ta: number;
  readonly tb: number;
}

/// Un lato del grafo, da `a` a `b` con `a < b`: le curve che ci passano, di
/// quanto cambia l'avvolgimento di ogni forma attraversandolo da destra a
/// sinistra, e se taglia.
interface Edge {
  readonly a: number;
  readonly b: number;
  readonly along: Along[];
  readonly delta: Int32Array;
  cut: boolean;
}

/// I lati del grafo: i pezzi fra gli stessi due vertici diventano uno.
/// Restano quelli che cambiano un avvolgimento o tagliano: una linea che
/// torna su se stessa non separa niente.
function edgesOf(net: Net, shapes: number): Edge[] {
  const n = net.x.length;
  const byKey = new Map<number, Edge>();
  for (let i = 0; i < net.a.length; i++) {
    const [p, q] = [net.a[i]!, net.b[i]!];
    const forward = p < q;
    const key = forward ? p * n + q : q * n + p;
    let edge = byKey.get(key);
    if (edge === undefined) {
      edge = { a: Math.min(p, q), b: Math.max(p, q), along: [], delta: new Int32Array(shapes), cut: false };
      byKey.set(key, edge);
    }
    const src = net.src[i]!;
    edge.along.push(forward ? { src, ta: net.ta[i]!, tb: net.tb[i]! } : { src, ta: net.tb[i]!, tb: net.ta[i]! });
    const source = net.sources[src]!;
    if (source.cut) edge.cut = true;
    else edge.delta[source.shape]! += forward ? 1 : -1;
  }
  return [...byKey.values()].filter((edge) => edge.cut || edge.delta.some((d) => d !== 0));
}

/// Un anello del risultato: il pezzo a cui appartiene, e i suoi mezzi lati.
interface Loop {
  readonly piece: number;
  readonly half: readonly number[];
}

/// Il grafo coi lati `edges`. Ogni lato ha due mezzi lati, `2e` da `a` a `b`
/// e `2e + 1` all'inverso; ogni mezzo lato ha a sinistra la sua faccia.
class Graph {
  readonly around = new Map<number, number[]>();
  readonly slot: Int32Array;
  readonly face: Int32Array;
  faces = 0;
  unbounded = 0;

  constructor(
    readonly net: Net,
    readonly edges: readonly Edge[],
  ) {
    const count = edges.length * 2;
    const angle = new Float64Array(count);
    for (let h = 0; h < count; h++) {
      const [from, to] = [this.origin(h), this.target(h)];
      angle[h] = Math.atan2(net.y[to]! - net.y[from]!, net.x[to]! - net.x[from]!);
      const list = this.around.get(from);
      if (list === undefined) this.around.set(from, [h]);
      else list.push(h);
    }
    this.slot = new Int32Array(count);
    for (const list of this.around.values()) {
      list.sort((g, h) => angle[g]! - angle[h]!);
      list.forEach((h, i) => (this.slot[h] = i));
    }
    this.face = new Int32Array(count).fill(-1);
  }

  origin(h: number): number {
    const edge = this.edges[h >> 1]!;
    return h & 1 ? edge.b : edge.a;
  }

  target(h: number): number {
    const edge = this.edges[h >> 1]!;
    return h & 1 ? edge.a : edge.b;
  }

  /// Il mezzo lato che viene dopo `h` attorno alla sua faccia: dal vertice
  /// dove arriva, il primo in senso orario dal ritorno.
  next(h: number): number {
    const list = this.around.get(this.target(h))!;
    return list[(this.slot[h ^ 1]! - 1 + list.length) % list.length]!;
  }

  /// Le facce: i cicli di mezzi lati, e i cicli di fuori di ogni pezzo di
  /// grafo uniti alla faccia che li contiene. `false` se un ciclo non si
  /// chiude.
  trace(): boolean {
    const { net, edges } = this;
    const count = edges.length * 2;
    const cycle = new Int32Array(count).fill(-1);
    let cycles = 0;
    for (let h = 0; h < count; h++) {
      if (cycle[h] !== -1) continue;
      let g = h;
      let steps = 0;
      do {
        cycle[g] = cycles;
        g = this.next(g);
        if (++steps > count) return false;
      } while (g !== h);
      cycles++;
    }
    // I pezzi del grafo, e per ciascuno il vertice più a sinistra, poi più
    // in basso: la faccia che lo contiene sta alla sua sinistra.
    const parts = new Map<number, number>();
    const partOf = (v: number): number => {
      let root = v;
      while (parts.get(root) !== root) root = parts.get(root)!;
      parts.set(v, root);
      return root;
    };
    for (const v of this.around.keys()) parts.set(v, v);
    for (const edge of edges) {
      const [ra, rb] = [partOf(edge.a), partOf(edge.b)];
      if (ra !== rb) parts.set(Math.max(ra, rb), Math.min(ra, rb));
    }
    const leftmost = new Map<number, number>();
    for (const v of this.around.keys()) {
      const root = partOf(v);
      const best = leftmost.get(root);
      if (best === undefined || net.x[v]! < net.x[best]! || (net.x[v] === net.x[best] && net.y[v]! < net.y[best]!)) leftmost.set(root, v);
    }
    const faces = Int32Array.from({ length: cycles + 1 }, (_, i) => i);
    const find = (f: number): number => {
      while (faces[f] !== f) {
        faces[f] = faces[faces[f]!]!;
        f = faces[f]!;
      }
      return f;
    };
    const unite = (f: number, g: number): void => {
      const [rf, rg] = [find(f), find(g)];
      if (rf !== rg) faces[Math.max(rf, rg)] = Math.min(rf, rg);
    };
    const partOfEdge = edges.map((edge) => partOf(edge.a));
    for (const [root, v] of leftmost) {
      // Il ciclo di fuori del pezzo passa per il mezzo lato che parte più in
      // alto dal vertice: alla sua sinistra c'è tutto il resto.
      const list = this.around.get(v)!;
      const outer = cycle[list[list.length - 1]!]!;
      // Un raggio verso sinistra, appena sopra il vertice, trova il lato più
      // vicino di un altro pezzo: la faccia alla destra del raggio, a
      // sinistra del suo mezzo lato che scende, contiene il pezzo.
      const [vx, vy] = [net.x[v]!, net.y[v]!];
      let hit = -1;
      let hitX = -Infinity;
      let hitSlope = -Infinity;
      edges.forEach((edge, e) => {
        if (partOfEdge[e] === root) return;
        let [lo, hi] = [edge.a, edge.b];
        if (net.y[lo]! > net.y[hi]!) [lo, hi] = [hi, lo];
        if (!(net.y[lo]! <= vy && vy < net.y[hi]!)) return;
        const slope = (net.x[hi]! - net.x[lo]!) / (net.y[hi]! - net.y[lo]!);
        const cx = net.x[lo]! + (vy - net.y[lo]!) * slope;
        if (!(cx < vx)) return;
        if (cx > hitX || (cx === hitX && slope > hitSlope)) {
          hit = e;
          hitX = cx;
          hitSlope = slope;
        }
      });
      if (hit === -1) unite(outer, cycles);
      else unite(outer, cycle[net.y[edges[hit]!.a]! > net.y[edges[hit]!.b]! ? 2 * hit : 2 * hit + 1]!);
    }
    const ids = new Map<number, number>();
    const idOf = (f: number): number => {
      const root = find(f);
      let id = ids.get(root);
      if (id === undefined) {
        id = ids.size;
        ids.set(root, id);
      }
      return id;
    };
    this.unbounded = idOf(cycles);
    for (let h = 0; h < count; h++) this.face[h] = idOf(cycle[h]!);
    this.faces = ids.size;
    return true;
  }

  /// L'avvolgimento di ogni faccia per ogni forma, dalla faccia esterna, che
  /// ha zero: attraversando `h` da destra a sinistra si aggiunge il suo
  /// lato. `null` se due strade danno avvolgimenti diversi, o una faccia
  /// resta irraggiungibile: l'arrangiamento non è coerente.
  windings(shapes: number): Int32Array[] | null {
    const halves: number[][] = Array.from({ length: this.faces }, () => []);
    for (let h = 0; h < this.face.length; h++) halves[this.face[h]!]!.push(h);
    const out: Array<Int32Array | null> = new Array(this.faces).fill(null);
    out[this.unbounded] = new Int32Array(shapes);
    const queue = [this.unbounded];
    while (queue.length > 0) {
      const f = queue.pop()!;
      const known = out[f]!;
      for (const h of halves[f]!) {
        const g = this.face[h ^ 1]!;
        const delta = this.edges[h >> 1]!.delta;
        const sign = h & 1 ? -1 : 1;
        const there = known.map((w, k) => w - sign * delta[k]!);
        const seen = out[g];
        if (seen === null) {
          out[g] = there;
          queue.push(g);
        } else if (seen.some((w, k) => w !== there[k])) {
          return null;
        }
      }
    }
    return out.every((w) => w !== null) ? (out as Int32Array[]) : null;
  }

  /// Gli anelli dei mezzi lati che hanno a sinistra il pezzo `piece[f]` e a
  /// destra no: da ognuno si passa, girando in senso orario dal ritorno, al
  /// primo che fa da bordo. `null` se un anello non si chiude.
  loops(piece: Int32Array): Loop[] | null {
    const count = this.face.length;
    const border = (h: number): boolean => {
      const own = piece[this.face[h]!]!;
      return own >= 0 && own !== piece[this.face[h ^ 1]!];
    };
    const used = new Uint8Array(count);
    const out: Loop[] = [];
    for (let start = 0; start < count; start++) {
      if (used[start] === 1 || !border(start)) continue;
      const half: number[] = [];
      let h = start;
      do {
        used[h] = 1;
        half.push(h);
        const list = this.around.get(this.target(h))!;
        const back = this.slot[h ^ 1]!;
        let next = -1;
        for (let step = 1; step <= list.length; step++) {
          const g = list[(back - step + list.length * 2) % list.length]!;
          if (border(g)) {
            next = g;
            break;
          }
        }
        if (next === -1 || (used[next] === 1 && next !== start) || half.length > count) return null;
        h = next;
      } while (h !== start);
      out.push({ piece: piece[this.face[start]!]!, half });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Le curve ritrovate.
// ---------------------------------------------------------------------------

/// Il parametro di `source` più vicino a `p`, partendo da `t`: il metodo di
/// Newton sulla distanza, finché si avvicina.
function project(source: Source, p: Point, t: number): number {
  const { from, curve } = source;
  let best = distance(pointAt(from, curve, t), p);
  for (let i = 0; i < 16 && best > 0; i++) {
    const q = pointAt(from, curve, t);
    const d = derivativeAt(from, curve, t);
    const dd = d[0] * d[0] + d[1] * d[1];
    if (!(dd > 0)) break;
    const next = clamp01(t - ((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]) / dd);
    const gap = distance(pointAt(from, curve, next), p);
    if (!(gap < best)) break;
    best = gap;
    t = next;
  }
  return t;
}

/// Dove `one` e `other` si incrociano, partendo dai parametri `s` e `t`:
/// il metodo di Newton in due variabili, il punto e il parametro di `one`.
/// Dove due curve si toccano senza attraversarsi converge più piano, ma ci
/// arriva. `null` se le curve vi corrono parallele, o il metodo non
/// converge.
function crossing(one: Source, s: number, other: Source, t: number): { readonly point: Point; readonly s: number } | null {
  for (let i = 0; i < 32; i++) {
    const p = pointAt(one.from, one.curve, s);
    const q = pointAt(other.from, other.curve, t);
    const [fx, fy] = [p[0] - q[0], p[1] - q[1]];
    if (Math.hypot(fx, fy) < 1e-9) return { point: p, s };
    const d1 = derivativeAt(one.from, one.curve, s);
    const d2 = derivativeAt(other.from, other.curve, t);
    const det = d2[0] * d1[1] - d1[0] * d2[1];
    if (!(Math.abs(det) > 1e-9 * Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]))) return null;
    s = clamp01(s - (d2[0] * fy - fx * d2[1]) / det);
    t = clamp01(t - (d1[0] * fy - d1[1] * fx) / det);
  }
  return null;
}

/// Vero se `one` fra i parametri `s0` e `s1` corre lungo `other`, a non più
/// del doppio della tolleranza, partendo vicino al suo parametro `t`: è il
/// tratto dove l'arrangiamento le ha fuse, come accanto a una tangenza.
function alongside(one: Source, s0: number, s1: number, other: Source, t: number): boolean {
  for (let k = 0; k <= 8; k++) {
    const p = pointAt(one.from, one.curve, s0 + ((s1 - s0) * k) / 8);
    t = project(other, p, t);
    if (distance(pointAt(other.from, other.curve, t), p) > 2 * EPSILON) return false;
  }
  return true;
}

/// `curve` da `from` coi capi portati in `start` e `end`: le maniglie di una
/// cubica seguono il loro nodo.
function moved(from: Point, curve: Curve, start: Point, end: Point): Curve {
  const shift = (p: Point, was: Point, now: Point): Point => [p[0] + now[0] - was[0], p[1] + now[1] - was[1]];
  switch (curve.kind) {
    case "line":
      return { kind: "line", to: end };
    case "quad":
      return { kind: "quad", control: curve.control, to: end };
    case "cubic":
      return { kind: "cubic", c1: shift(curve.c1, from, start), c2: shift(curve.c2, curve.to, end), to: end };
    case "arc":
      return { ...curve, to: end };
  }
}

/// Il pezzo di `source` fra i parametri `t0` e `t1`, percorso da `t0` a `t1`.
function pieceOf(source: Source, t0: number, t1: number): { readonly from: Point; readonly curve: Curve } {
  let { from, curve } = source;
  const [lo, hi] = [Math.min(t0, t1), Math.max(t0, t1)];
  if (hi < 1) curve = splitAt(from, curve, hi)[0];
  if (lo > 0) {
    const [left, right] = splitAt(from, curve, lo / hi);
    from = left.to;
    curve = right;
  }
  if (t0 > t1) {
    const to = curve.to;
    curve = reversed(from, curve);
    from = to;
  }
  return { from, curve };
}

/// Un arco da `from` in archi di un quarto di giro al più. Un arco che passa
/// per la metà della sua ellisse ha il centro sulla corda, e scritto al
/// centesimo il centro scapperebbe di lato; un quarto di giro no.
function quarters(from: Point, curve: Curve): Curve[] {
  if (curve.kind !== "arc") return [curve];
  const arc = arcCenter(from, curve);
  if (arc === null) return [{ kind: "line", to: curve.to }];
  const count = Math.ceil(Math.abs(arc.delta) / QUARTER - 1e-9);
  const out: Curve[] = [];
  let at = from;
  let rest: Curve = curve;
  for (let left = count; left > 1; left--) {
    const [head, tail] = splitAt(at, rest, 1 / left);
    out.push(head);
    at = head.to;
    rest = tail;
  }
  out.push(rest);
  return out;
}

/// Il doppio dell'area con segno racchiusa da curve che formano anelli
/// chiusi, ciascuna col punto da cui parte: positiva se girano in senso
/// antiorario con l'asse y verso l'alto, orario sullo schermo. Una curva
/// conta per sedici corde, abbastanza per il verso e per le aree piccole.
function turning(curves: ReadonlyArray<{ readonly from: Point; readonly curve: Curve }>): number {
  let sum = 0;
  for (const { from, curve } of curves) {
    const steps = curve.kind === "line" ? 1 : 16;
    let p = from;
    for (let k = 1; k <= steps; k++) {
      const q = k === steps ? curve.to : pointAt(from, curve, k / steps);
      sum += p[0] * q[1] - q[0] * p[1];
      p = q;
    }
  }
  return sum;
}

/// Un passo di un anello: il mezzo lato, la curva che vi passa, e il suo
/// parametro dove il passo comincia e dove finisce.
interface Step {
  readonly h: number;
  readonly src: number;
  readonly from: number;
  readonly to: number;
}

/// Un tratto di anello: la curva da `start`, la forma da cui viene, e il
/// vertice dove comincia, `null` per i nodi aggiunti dividendo un arco.
interface Stretch {
  readonly start: Point;
  readonly curve: Curve;
  readonly shape: number;
  readonly vertex: number | null;
}

// ---------------------------------------------------------------------------
// L'operazione.
// ---------------------------------------------------------------------------

/// `kind` sulle forme `shapes`, dalla più in basso: i tracciati del
/// risultato, uno per l'unione, la differenza, l'intersezione e
/// l'esclusione, uno per pezzo nella divisione; nessuno se il risultato è
/// vuoto. `null` se il calcolo non riesce.
export function combine(kind: BooleanKind, shapes: readonly Shape[]): Segment[][] | null {
  const sources = sourcesOf(shapes, kind === "division");
  if (sources.length === 0) return [];
  const net = new Net(sources);
  if (!net.planar()) return null;
  const edges = edgesOf(net, shapes.length);
  if (edges.length === 0) return [];
  const graph = new Graph(net, edges);
  if (!graph.trace()) return null;
  const windings = graph.windings(shapes.length);
  if (windings === null) return null;

  // Le facce dentro il risultato: per la divisione, il pezzo a cui
  // appartengono; altrimenti 0, e -1 quelle fuori.
  const inside = (w: Int32Array, k: number): boolean => (shapes[k]!.evenOdd ? (w[k]! & 1) !== 0 : w[k] !== 0);
  const kept = windings.map((w): boolean => {
    const within = shapes.map((_, k) => inside(w, k));
    switch (kind) {
      case "union":
        return within.some(Boolean);
      case "intersection":
        return within.every(Boolean);
      case "difference":
        return within[0]! && !within.slice(1).some(Boolean);
      case "exclusion":
        return within.filter(Boolean).length % 2 === 1;
      case "division":
        return within[0]!;
    }
  });
  const piece = new Int32Array(graph.faces).map((_, f) => (kept[f] ? 0 : -1));
  if (kind === "division") {
    // I pezzi: le facce dentro la forma in basso unite dai lati che non
    // tagliano.
    const parent = Int32Array.from({ length: graph.faces }, (_, i) => i);
    const find = (f: number): number => {
      while (parent[f] !== f) f = parent[f] = parent[parent[f]!]!;
      return f;
    };
    edges.forEach((edge, e) => {
      const [f, g] = [graph.face[2 * e]!, graph.face[2 * e + 1]!];
      if (edge.cut || !kept[f] || !kept[g]) return;
      const [rf, rg] = [find(f), find(g)];
      if (rf !== rg) parent[Math.max(rf, rg)] = Math.min(rf, rg);
    });
    piece.forEach((p, f) => {
      if (p >= 0) piece[f] = find(f);
    });
  }
  const loops = graph.loops(piece);
  if (loops === null) return null;

  // --- Le curve dei lati -----------------------------------------------------

  const curvePoint = (src: number, t: number): Point => pointAt(sources[src]!.from, sources[src]!.curve, t);
  /// Vero se il passo `q` continua la curva del passo `p` senza salti: dallo
  /// stesso parametro, o da uno vicino quando il pezzo in mezzo è rimasto
  /// tutto nel vertice.
  const continues = (p: Step, q: Step): boolean => {
    if (p.src !== q.src) return false;
    const up = p.to > p.from;
    if (up !== (q.to > q.from)) return false;
    // Dallo stesso parametro la curva continua anche dove il vertice, fuso
    // con altri vicini, è finito più in là della tolleranza.
    if (p.to === q.from) return true;
    if (up ? q.from < p.to : q.from > p.to) return false;
    const v = net.at(graph.target(p.h));
    return [p.to, (p.to + q.from) / 2, q.from].every((t) => distance(curvePoint(p.src, t), v) <= 2 * EPSILON);
  };
  /// I passi di un anello: per ogni mezzo lato, la curva che vi passa.
  /// Dove ne passano più d'una vale quella che il passo prima continua, o
  /// quella che continua nel passo dopo, come un cerchio che sfiora un lato;
  /// altrimenti quella della forma più in basso.
  const stepsOfLoop = (half: readonly number[]): Step[] => {
    const n = half.length;
    const step = (h: number, along: Along): Step => (h & 1 ? { h, src: along.src, from: along.tb, to: along.ta } : { h, src: along.src, from: along.ta, to: along.tb });
    const out = half.map((h) => step(h, edges[h >> 1]!.along.reduce((best, along) => (along.src < best.src ? along : best))));
    // Deciso: un passo con una curva sola, o che ne continua uno deciso.
    const settled = Uint8Array.from(half, (h) => (edges[h >> 1]!.along.length === 1 ? 1 : 0));
    for (const forward of [true, false]) {
      for (let k = 1; k < 2 * n; k++) {
        const i = forward ? k % n : (2 * n - 1 - k) % n;
        const j = forward ? (i - 1 + n) % n : (i + 1) % n;
        if (settled[i] === 1 || settled[j] === 0) continue;
        const same = edges[half[i]! >> 1]!.along.find((along) => along.src === out[j]!.src);
        if (same === undefined) continue;
        out[i] = step(half[i]!, same);
        settled[i] = 1;
      }
    }
    return out;
  };

  // Dove sta davvero un vertice dove il risultato cambia curva: un nodo
  // resta dov'è; un incrocio va dove due curve che vi passano si incrociano
  // davvero: le prime, dalla forma in basso, che si incrociano lì, o, se
  // nessuna coppia si incrocia lì, quelle che vi arrivano correndo fuse,
  // come in una tangenza. Un altro punto va sulla curva.
  const places = new Map<number, Point>();
  const placeOf = (v: number): Point => {
    const known = places.get(v);
    if (known !== undefined) return known;
    let p = net.at(v);
    if (net.rank[v] !== 0) {
      const through = new Map<number, number>();
      for (const h of graph.around.get(v) ?? []) {
        for (const along of edges[h >> 1]!.along) if (!through.has(along.src)) through.set(along.src, h & 1 ? along.tb : along.ta);
      }
      const list = [...through].sort((m, n) => m[0] - n[0]);
      let q: Point | null = null;
      let far = Infinity;
      for (const [one, other] of list.flatMap((one, i) => list.slice(i + 1).map((other) => [one, other] as const))) {
        const [first, second] = [sources[one[0]]!, sources[other[0]]!];
        const found = crossing(first, one[1], second, other[1]);
        if (found === null) continue;
        const d = distance(found.point, p);
        if (d <= 2 * EPSILON) {
          q = found.point;
          break;
        }
        if (d < far && alongside(first, one[1], found.s, second, other[1])) [far, q] = [d, found.point];
      }
      const one = list[0];
      if (q === null && one !== undefined) {
        const on = curvePoint(one[0], project(sources[one[0]]!, p, one[1]));
        if (distance(on, p) <= 2 * EPSILON) q = on;
      }
      if (q !== null) p = q;
    }
    places.set(v, p);
    return p;
  };
  /// Il parametro di `src` nel vertice `v`, sul punto dove il vertice sta
  /// davvero.
  const paramAt = (v: number, src: number, t: number): number => project(sources[src]!, placeOf(v), t);

  const rebuild = (loop: Loop): Stretch[] => {
    const steps = stepsOfLoop(loop.half);
    // Comincia dove la curva cambia: c'è sempre, perché una curva intera
    // finisce dove comincia solo passando da 1 a 0.
    let begin = steps.findIndex((step, i) => !continues(steps[(i - 1 + steps.length) % steps.length]!, step));
    if (begin === -1) begin = 0;
    const order = [...steps.slice(begin), ...steps.slice(0, begin)];
    const stretches: Stretch[] = [];
    for (let i = 0; i < order.length; ) {
      let j = i + 1;
      while (j < order.length && continues(order[j - 1]!, order[j]!)) j++;
      const { src, from } = order[i]!;
      const { to } = order[j - 1]!;
      const [v0, v1] = [graph.origin(order[i]!.h), graph.target(order[j - 1]!.h)];
      const [start, end] = [placeOf(v0), placeOf(v1)];
      const source = sources[src]!;
      const t0 = paramAt(v0, src, from);
      const t1 = paramAt(v1, src, to);
      // Una curva scritta che passa intera, coi capi dov'erano, resta com'è.
      const forward = t0 === 0 && t1 === 1;
      const backward = t0 === 1 && t1 === 0;
      const [first, last] = forward ? [source.from, source.curve.to] : [source.curve.to, source.from];
      if ((forward || backward) && shapes[source.shape]!.written && same(start, first) && same(end, last)) {
        stretches.push({ start, curve: forward ? source.curve : reversed(source.from, source.curve), shape: source.shape, vertex: v0 });
      } else if (t0 === t1) {
        stretches.push({ start, curve: { kind: "line", to: end }, shape: source.shape, vertex: v0 });
      } else {
        const part = pieceOf(source, t0, t1);
        quarters(start, moved(part.from, part.curve, start, end)).forEach((curve, k, all) => {
          const at = k === 0 ? start : all[k - 1]!.to;
          stretches.push({ start: at, curve, shape: source.shape, vertex: k === 0 ? v0 : null });
        });
      }
      i = j;
    }
    // Un tratto che comincia e finisce nello stesso punto non disegna niente:
    // succede dove due vertici vanno insieme sul punto di una tangenza.
    for (let i = stretches.length - 1; i >= 0 && stretches.length > 1; i--) {
      const stretch = stretches[i]!;
      if (stretch.curve.kind === "line" && same(stretch.start, stretch.curve.to)) stretches.splice(i, 1);
    }
    // Due linee dritte una dopo l'altra diventano una, se il nodo in mezzo
    // non è un nodo che una forma aveva fra due suoi lati.
    const straight = (previous: Stretch, current: Stretch): boolean => {
      if (previous.curve.kind !== "line" || current.curve.kind !== "line") return false;
      if (previous.shape === current.shape && current.vertex !== null && net.rank[current.vertex] === 0) return false;
      const [p, q, node] = [previous.start, current.curve.to, current.start];
      const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
      const u = ((node[0] - p[0]) * dx + (node[1] - p[1]) * dy) / (dx * dx + dy * dy);
      return u > 0 && u < 1 && Math.hypot(p[0] + u * dx - node[0], p[1] + u * dy - node[1]) <= COLLINEAR;
    };
    for (let i = 0; stretches.length > 2 && i < stretches.length; i++) {
      const at = (i - 1 + stretches.length) % stretches.length;
      const [previous, current] = [stretches[at]!, stretches[i]!];
      if (!straight(previous, current)) continue;
      stretches[at] = { ...previous, curve: current.curve, shape: current.shape };
      stretches.splice(i, 1);
      i = -1;
    }
    // Comincia dal nodo che le forme hanno prima, dalla più in basso; se
    // l'anello non ne ha, dall'incrocio più a sinistra.
    const keyOf = (stretch: Stretch): number => (stretch.vertex === null ? Infinity : net.first[stretch.vertex]!);
    let head = 0;
    stretches.forEach((stretch, i) => {
      const [best, key] = [stretches[head]!, keyOf(stretch)];
      if (key < keyOf(best) || (key === keyOf(best) && leftward(stretch.start, best.start) < 0)) head = i;
    });
    return [...stretches.slice(head), ...stretches.slice(0, head)];
  };

  // Il risultato gira come la forma in basso: i suoi anelli di fuori nel
  // suo verso, i buchi al contrario.
  const turn = turning(sources.filter((source) => source.shape === 0));
  const pieces = new Map<number, Built[]>();
  for (const loop of loops) {
    const stretches = rebuild(loop);
    const area = turning(stretches.map((stretch) => ({ from: stretch.start, curve: stretch.curve }))) / 2;
    // Un anello che non racchiude niente che si veda resta fuori.
    if (Math.abs(area) <= (EPSILON * EPSILON) / 4) continue;
    const start = stretches[0]!.start;
    const curves = turn >= 0 ? stretches.map((stretch) => stretch.curve) : stretches.map((stretch) => reversed(stretch.start, stretch.curve)).reverse();
    const segments: Segment[] = [{ kind: "move", to: start }, ...curves];
    if (segments[segments.length - 1]!.kind === "line") segments.pop();
    segments.push({ kind: "close" });
    const vertex = stretches[0]!.vertex;
    const built = { key: vertex === null ? Infinity : net.first[vertex]!, start, segments };
    const list = pieces.get(loop.piece);
    if (list === undefined) pieces.set(loop.piece, [built]);
    else list.push(built);
  }
  return [...pieces.values()]
    .map((list) => list.sort(builtOrder))
    .sort((m, n) => builtOrder(m[0]!, n[0]!))
    .map((list) => list.flatMap((loop) => loop.segments));
}

/// Un anello pronto: dove comincia, la prima delle curve delle forme che
/// cominciano lì, `Infinity` per un incrocio, e i segmenti.
interface Built {
  readonly key: number;
  readonly start: Point;
  readonly segments: Segment[];
}

/// Gli anelli nell'ordine dei nodi da cui cominciano: prima quelli della
/// forma più in basso, poi quelli delle forme sopra, ciascuna nell'ordine
/// dei suoi nodi; per ultimi quelli che cominciano da un incrocio, da
/// sinistra.
function builtOrder(m: Built, n: Built): number {
  if (m.key !== n.key) return m.key < n.key ? -1 : 1;
  return leftward(m.start, n.start);
}
