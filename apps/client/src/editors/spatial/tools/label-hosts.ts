// Le forme che hanno un'etichetta dentro (Disegni, etichette; formato della
// scena, etichette), e dove sta il suo testo: chi la può avere, chi è
// l'etichetta di chi, e il riquadro del testo di una forma.
//
// - **Una forma chiusa** può avere un'etichetta: un rettangolo, un'ellisse,
//   un cerchio, un poligono, una stella, o un tracciato con almeno un
//   sottotracciato chiuso. L'etichetta è un testo con `fub:inside` nello
//   stesso gruppo della forma, il primo che la nomina.
// - **Il dentro** di una forma chiusa è dove due tocchi ne aprono l'etichetta,
//   anche senza riempimento.
// - **Il riquadro del testo** è il rettangolo più grande che sta dentro la
//   forma: il rettangolo stesso, meno gli angoli arrotondati; quello di
//   un'ellisse, √2 volte i semiassi; per ogni altra forma il più grande che
//   una griglia trova fra le celle dentro la forma che né il contorno né le
//   linee aperte che porta attraversano, a parità il più vicino al centro e
//   poi il più largo, allargato poi lato per lato fin dove il contorno lo
//   lascia.
//
// Dove sta l'etichetta, e come segue la forma, è di `labels.ts`.

import type { Role } from "../scene/analysis";
import { BoundsBuilder, chords, flatten, winding, type Bounds, type Segment } from "../scene/geometry";
import { IDENTITY, type Point } from "../scene/matrix";
import { elementChildren, type ElementPart, type LeafNode } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { length } from "../scene/values";
import { elemOf } from "./arrange";
import { shapeSegments } from "./hit";

/// Le righe e le colonne della griglia sul lato più lungo della forma.
const GRID = 48;

/// I ruoli delle forme sempre chiuse.
const CLOSED: ReadonlySet<Role> = new Set<Role>(["rect", "ellipse", "circle", "ngon", "star", "polygon"]);

// ---------------------------------------------------------------------------
// Chi ha un'etichetta.
// ---------------------------------------------------------------------------

/// I pezzi del contorno di una forma nelle sue coordinate: i sottotracciati
/// chiusi come poligoni, e le corde di quelli aperti.
interface Pieces {
  readonly closed: readonly (readonly Point[])[];
  readonly open: readonly (readonly [Point, Point])[];
}

/// I sottotracciati di `segments`, ciascuno col suo `move` in testa, e se è
/// chiuso da `Z`.
function subpaths(segments: readonly Segment[]): Array<{ readonly segments: Segment[]; readonly closed: boolean }> {
  const out: Array<{ segments: Segment[]; closed: boolean }> = [];
  let current: { segments: Segment[]; closed: boolean } | null = null;
  let start: Point = [0, 0];
  for (const segment of segments) {
    if (segment.kind === "move") {
      start = segment.to;
      current = { segments: [segment], closed: false };
      out.push(current);
    } else if (segment.kind === "close") {
      if (current !== null) current.closed = true;
      current = null;
    } else {
      // Dopo `Z` si riparte dall'inizio del sottotracciato chiuso.
      if (current === null) {
        current = { segments: [{ kind: "move", to: start }], closed: false };
        out.push(current);
      }
      current.segments.push(segment);
    }
  }
  return out.filter((sub) => sub.segments.length > 1);
}

const known = new WeakMap<LeafNode, { readonly raw: string; readonly pieces: Pieces | null; box?: Bounds | null }>();

/// I pezzi di `node`, letti una volta finché il suo testo non cambia;
/// `null` se non ha un sottotracciato chiuso.
function piecesOf(node: ElementPart): { readonly entry: { readonly raw: string; readonly pieces: Pieces | null; box?: Bounds | null } } | null {
  if (node.kind !== "leaf") return null;
  let entry = known.get(node);
  if (entry === undefined || entry.raw !== node.raw) {
    const elem = elemOf(node);
    entry = { raw: node.raw, pieces: elem === null ? null : piecesIn(elem) };
    known.set(node, entry);
  }
  return { entry };
}

/// I pezzi di `elem`; `null` se non ha un sottotracciato chiuso.
function piecesIn(elem: Elem): Pieces | null {
  const closed: Point[][] = [];
  const open: Array<readonly [Point, Point]> = [];
  for (const sub of subpaths(shapeSegments(elem.tag, Object.entries(elem.attrs)))) {
    if (sub.closed) closed.push(...flatten(sub.segments, IDENTITY));
    else open.push(...chords(sub.segments));
  }
  return closed.length === 0 ? null : { closed, open };
}

/// Vero se `node` può avere un'etichetta dentro: un rettangolo, un'ellisse,
/// un cerchio, un poligono, una stella, o un tracciato con almeno un
/// sottotracciato chiuso.
export function labelable(node: ElementPart): boolean {
  const role = node.details?.role;
  if (role === undefined || node.kind !== "leaf") return false;
  if (CLOSED.has(role)) return true;
  return role === "path" && piecesOf(node)?.entry.pieces != null;
}

/// Vero se `p`, nelle coordinate di `shape`, sta dentro la forma chiusa
/// `shape`, con la regola `nonzero`, che sia riempita o no: dove due tocchi
/// ne aprono l'etichetta.
export function insideShape(shape: ElementPart, p: Point): boolean {
  if (!labelable(shape)) return false;
  const pieces = piecesOf(shape)?.entry.pieces;
  return pieces != null && winding(pieces.closed, p) !== 0;
}

/// Vero se `node` è un testo che nomina la forma `id` con `fub:inside`: non
/// uno su tracciato, né l'etichetta di un connettore, che segue la sua
/// linea.
function names(node: ElementPart, id: string): boolean {
  const details = node.details;
  return details !== null && details.inside === id && details.role === "text" && details.textPath === undefined && details.along === undefined;
}

/// La forma di cui `label` è l'etichetta, se lo è: un testo con
/// `fub:inside` in un gruppo, il primo che nomina una sorella che può
/// averne una. `null` altrimenti: è un testo qualunque.
export function labelTarget(label: ElementPart): ElementPart | null {
  const id = label.details?.inside;
  const parent = label.parent;
  if (id === undefined || !names(label, id) || parent === null || parent.details?.role !== "group") return null;
  let shape: ElementPart | null = null;
  let first: ElementPart | null = null;
  for (const child of elementChildren(parent)) {
    if (shape === null && child.facts.id === id) shape = child;
    if (first === null && names(child, id)) first = child;
  }
  return first === label && shape !== null && shape !== label && labelable(shape) ? shape : null;
}

/// L'etichetta di `shape`, se ne ha una.
export function labelOf(shape: ElementPart): ElementPart | null {
  const id = shape.facts.id;
  const parent = shape.parent;
  if (id === null || parent === null || parent.details?.role !== "group") return null;
  for (const child of elementChildren(parent)) {
    if (names(child, id)) return labelTarget(child) === shape ? child : null;
  }
  return null;
}

/// La forma e l'etichetta di `group`, se è un gruppo fatto soltanto di una
/// forma e della sua etichetta, col suo titolo e la sua descrizione.
export function labelledPair(group: ElementPart): { readonly shape: ElementPart; readonly label: ElementPart } | null {
  if (group.kind !== "container" || group.details?.role !== "group") return null;
  const children = elementChildren(group).filter((child) => child.details?.role !== "title" && child.details?.role !== "desc");
  if (children.length !== 2) return null;
  for (const label of children) {
    const shape = labelTarget(label);
    if (shape !== null) return { shape, label };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Il riquadro del testo.
// ---------------------------------------------------------------------------

/// Un numero di `attrs`, 0 se manca o non si legge.
const numberOf = (attrs: Readonly<Record<string, string>>, name: string): number => {
  const value = attrs[name];
  return value === undefined ? 0 : (length(value) ?? 0);
};

/// Il rettangolo più grande dentro `pieces`, sulla griglia: le celle libere
/// hanno il centro dentro la forma, con la regola `nonzero`, e nessun pezzo
/// del contorno le attraversa.
function gridBox({ closed, open }: Pieces): Bounds | null {
  const frame = new BoundsBuilder();
  for (const polygon of closed) for (const p of polygon) frame.include(p);
  const box = frame.finish();
  if (box === null) return null;
  const [x0, y0] = box.min;
  const w = box.max[0] - x0;
  const h = box.max[1] - y0;
  if (!(w > 0) || !(h > 0)) return null;
  const side = Math.max(w, h) / GRID;
  const cols = Math.max(1, Math.round(w / side));
  const rows = Math.max(1, Math.round(h / side));
  const cw = w / cols;
  const ch = h / rows;
  const blocked = new Uint8Array(cols * rows);
  const mark = (c: number, r: number): void => {
    if (c >= 0 && c < cols && r >= 0 && r < rows) blocked[r * cols + c] = 1;
  };
  // Le celle che una corda attraversa: il passo da una cella all'altra lungo
  // la corda. Un lato su una riga della griglia chiude le celle dalle due
  // parti, così il riquadro resta in mezzo.
  const cross = (a: Point, b: Point): void => {
    const ax = (a[0] - x0) / cw;
    const ay = (a[1] - y0) / ch;
    const bx = (b[0] - x0) / cw;
    const by = (b[1] - y0) / ch;
    const onX = Math.abs(ax - bx) < 1e-9 && Math.abs(ax - Math.round(ax)) < 1e-9;
    const onY = Math.abs(ay - by) < 1e-9 && Math.abs(ay - Math.round(ay)) < 1e-9;
    if (onX || onY) {
      const [from, to] = onX ? [Math.min(ay, by), Math.max(ay, by)] : [Math.min(ax, bx), Math.max(ax, bx)];
      const line = Math.round(onX ? ax : ay);
      for (let k = Math.floor(from); k <= Math.min(Math.ceil(to) - 1, (onX ? rows : cols) - 1); k++) {
        if (onX) {
          mark(line - 1, k);
          mark(line, k);
        } else {
          mark(k, line - 1);
          mark(k, line);
        }
      }
      return;
    }
    let c = Math.floor(ax);
    let r = Math.floor(ay);
    const c1 = Math.floor(bx);
    const r1 = Math.floor(by);
    const dx = bx - ax;
    const dy = by - ay;
    const sc = dx > 0 ? 1 : -1;
    const sr = dy > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tdy = dy === 0 ? Infinity : Math.abs(1 / dy);
    let tx = dx > 0 ? (c + 1 - ax) * tdx : dx < 0 ? (ax - c) * tdx : Infinity;
    let ty = dy > 0 ? (r + 1 - ay) * tdy : dy < 0 ? (ay - r) * tdy : Infinity;
    mark(c, r);
    for (let guard = cols + rows + 2; (c !== c1 || r !== r1) && guard > 0; guard--) {
      if (tx < ty) {
        tx += tdx;
        c += sc;
      } else {
        ty += tdy;
        r += sr;
      }
      mark(c, r);
    }
  };
  for (const polygon of closed) polygon.forEach((p, i) => cross(p, polygon[(i + 1) % polygon.length]!));
  for (const [a, b] of open) cross(a, b);
  // L'altezza delle colonne libere fino alla riga, e il rettangolo più grande
  // che vi poggia: la pila dell'istogramma, riga per riga.
  const heights = new Int32Array(cols);
  const centre: Point = [cols / 2, rows / 2];
  let best: { area: number; far: number; wide: number; c0: number; c1: number; r0: number; r1: number } | null = null;
  const offer = (c0: number, c1: number, r0: number, r1: number): void => {
    const wide = c1 - c0;
    const area = wide * (r1 - r0);
    if (area <= 0) return;
    const far = Math.hypot((c0 + c1) / 2 - centre[0], (r0 + r1) / 2 - centre[1]);
    if (best === null || area > best.area || (area === best.area && (far < best.far - 1e-9 || (Math.abs(far - best.far) <= 1e-9 && wide > best.wide)))) {
      best = { area, far, wide, c0, c1, r0, r1 };
    }
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const free = blocked[r * cols + c] === 0 && winding(closed, [x0 + (c + 0.5) * cw, y0 + (r + 0.5) * ch]) !== 0;
      heights[c] = free ? heights[c]! + 1 : 0;
    }
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const height = c === cols ? 0 : heights[c]!;
      while (stack.length > 0 && heights[stack[stack.length - 1]!]! >= height) {
        const top = stack.pop()!;
        const tall = heights[top]!;
        const left = stack.length === 0 ? 0 : stack[stack.length - 1]! + 1;
        if (tall > 0) offer(left, c, r + 1 - tall, r + 1);
      }
      stack.push(c);
    }
  }
  const found = best as { c0: number; c1: number; r0: number; r1: number } | null;
  if (found === null) return null;
  const edges: Array<readonly [Point, Point]> = [...open];
  for (const polygon of closed) polygon.forEach((p, i) => edges.push([p, polygon[(i + 1) % polygon.length]!]));
  return grown([x0 + found.c0 * cw, y0 + found.r0 * ch, x0 + found.c1 * cw, y0 + found.r1 * ch], box, edges);
}

/// Vero se nessuna di `edges` passa dentro il rettangolo `[x0, y0, x1, y1]`:
/// toccarne il bordo si può. Ogni lato si taglia sul rettangolo, come fa
/// Liang–Barsky.
function clear(edges: readonly (readonly [Point, Point])[], [x0, y0, x1, y1]: readonly number[], margin: number): boolean {
  const left = x0! + margin;
  const top = y0! + margin;
  const right = x1! - margin;
  const bottom = y1! - margin;
  for (const [a, b] of edges) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let enter = 0;
    let leave = 1;
    const cut = (p: number, q: number): boolean => {
      if (p === 0) return q > 0;
      const t = q / p;
      if (p < 0) enter = Math.max(enter, t);
      else leave = Math.min(leave, t);
      return enter < leave;
    };
    if (cut(-dx, a[0] - left) && cut(dx, right - a[0]) && cut(-dy, a[1] - top) && cut(dy, bottom - a[1])) return false;
  }
  return true;
}

/// Il rettangolo `rect` della griglia, allargato lato per lato fin dove il
/// contorno lo lascia, dentro `frame`: prima a sinistra e a destra, poi in
/// alto e in basso. La griglia trova il rettangolo a mezza cella; così una
/// forma simmetrica ha il riquadro in mezzo, e le righe tutto lo spazio.
function grown(rect: readonly number[], frame: Bounds, edges: readonly (readonly [Point, Point])[]): Bounds {
  const out = [...rect];
  const margin = 1e-9 * Math.max(frame.max[0] - frame.min[0], frame.max[1] - frame.min[1]);
  const limits = [frame.min[0], frame.min[1], frame.max[0], frame.max[1]];
  for (const side of [0, 2, 1, 3]) {
    const fits = (value: number): boolean => {
      const trial = [...out];
      trial[side] = value;
      return clear(edges, trial, margin);
    };
    if (fits(limits[side]!)) {
      out[side] = limits[side]!;
      continue;
    }
    // Il valore buono e quello che non va si avvicinano finché si scrivono
    // uguali.
    let good = out[side]!;
    let bad = limits[side]!;
    for (let step = 0; step < 48 && Math.abs(bad - good) > margin; step++) {
      const mid = (good + bad) / 2;
      if (fits(mid)) good = mid;
      else bad = mid;
    }
    out[side] = good;
  }
  return { min: [out[0]!, out[1]!], max: [out[2]!, out[3]!] };
}

/// Il riquadro del testo dentro `shape`, nelle sue coordinate, prima del
/// suo `transform`; `null` se la forma non ne ha uno.
export function textBox(shape: ElementPart): Bounds | null {
  const elem = elemOf(shape);
  if (elem === null || !labelable(shape)) return null;
  const plain = plainBox(elem);
  if (plain !== undefined) return plain;
  const read = piecesOf(shape);
  if (read === null || read.entry.pieces === null) return null;
  if (read.entry.box === undefined) read.entry.box = gridBox(read.entry.pieces);
  return read.entry.box;
}

/// Il riquadro del testo dentro `elem`, una forma chiusa che non è ancora
/// nella scena, come [`textBox`]: per chi la scrive insieme all'etichetta.
export function elemTextBox(elem: Elem): Bounds | null {
  const plain = plainBox(elem);
  if (plain !== undefined) return plain;
  const pieces = piecesIn(elem);
  return pieces === null ? null : gridBox(pieces);
}

/// Il riquadro del testo di un rettangolo, di un'ellisse o di un cerchio;
/// `undefined` se `elem` non è nessuno dei tre.
function plainBox(elem: Elem): Bounds | null | undefined {
  const a = elem.attrs;
  if (elem.tag === "rect") {
    const [x, y, w, h] = [numberOf(a, "x"), numberOf(a, "y"), numberOf(a, "width"), numberOf(a, "height")];
    if (!(w > 0) || !(h > 0)) return null;
    // In SVG 2 un raggio che manca vale l'altro, e nessuno supera metà lato.
    const rx = Math.min(Math.max(0, a.rx !== undefined ? numberOf(a, "rx") : numberOf(a, "ry")), w / 2);
    const ry = Math.min(Math.max(0, a.ry !== undefined ? numberOf(a, "ry") : numberOf(a, "rx")), h / 2);
    // Il rettangolo che tocca gli angoli arrotondati a metà del loro arco.
    const k = 1 - Math.SQRT1_2;
    return { min: [x + rx * k, y + ry * k], max: [x + w - rx * k, y + h - ry * k] };
  }
  if (elem.tag === "ellipse" || elem.tag === "circle") {
    const [cx, cy] = [numberOf(a, "cx"), numberOf(a, "cy")];
    const rx = elem.tag === "circle" ? numberOf(a, "r") : a.rx !== undefined ? numberOf(a, "rx") : numberOf(a, "ry");
    const ry = elem.tag === "circle" ? numberOf(a, "r") : a.ry !== undefined ? numberOf(a, "ry") : numberOf(a, "rx");
    if (!(rx > 0) || !(ry > 0)) return null;
    return { min: [cx - rx * Math.SQRT1_2, cy - ry * Math.SQRT1_2], max: [cx + rx * Math.SQRT1_2, cy + ry * Math.SQRT1_2] };
  }
  return undefined;
}
