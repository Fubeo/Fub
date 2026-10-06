// Le guide intelligenti (livello Standard): mentre si sposta, si
// ridimensiona o si disegna, ciò che si muove si ferma in linea con gli altri
// oggetti e con la pagina, e una linea lo mostra. Come la griglia sono un
// aiuto della vista, che non entra nel file.
//
// - **I bersagli** si prendono all'inizio del gesto: i bordi e i centri dei
//   riquadri della geometria, senza contorno, degli oggetti che si vedono
//   nella vista, bloccati compresi, e della pagina; mentre si modificano i
//   nodi o si posa la penna di Bézier, anche i nodi del tracciato. Le guide
//   dei righelli sono bersagli lungo il loro asse soltanto. Per ogni asse i
//   valori stanno in un elenco ordinato, dove il più vicino si trova per
//   bisezione.
// - **La soglia** è in pixel dello schermo, uguale a ogni zoom
//   ([`GUIDE_PX`]). Un bordo o il centro di ciò che si muove, entro la soglia
//   da un bersaglio, ci va sopra; il più vicino vince, anche contro la
//   griglia, e a pari distanza vince il bersaglio ([`nearer`]).
// - **Le distanze uguali.** Uno spostamento si ferma anche dove lo spazio dal
//   vicino è uguale a quello fra due oggetti della stessa fila, o a metà fra
//   due vicini.
// - **Le misure.** Una linea porta scritta la distanza dall'oggetto in linea
//   più vicino, e con `Alt` si misura la distanza fra due riquadri
//   ([`measure`]).

import type { InkPointerType } from "../pen/pen-input";
import type { Bounds } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import type { Axis } from "./frame";

/// La soglia dell'aggancio, in pixel CSS: più larga per la penna e per il
/// dito, che posano meno precisi del mouse.
export const GUIDE_PX: Readonly<Record<InkPointerType, number>> = { mouse: 6, pen: 8, touch: 12 };

/// Lo scarto, in unità della scena, sotto cui due valori stanno sulla stessa
/// linea: la geometria si scrive a due decimali, e dista al più mezzo
/// centesimo dal bersaglio su cui si è fermata.
export const ON_GUIDE = 0.006;

/// Dove sta un valore lungo un asse: il bordo più basso, il centro, il più
/// alto di un riquadro, o un punto.
export type Edge = "min" | "mid" | "max" | "point";

/// Un oggetto, la pagina, un nodo del tracciato che si modifica, o una guida
/// dei righelli.
export type TargetKind = "object" | "page" | "node" | "guide";

/// Ciò su cui ci si allinea.
export interface GuideTarget {
  readonly kind: TargetKind;
  /// Il riquadro della geometria nella scena; per un nodo, il punto; per una
  /// guida, un punto che ha la sua posizione su tutti e due gli assi.
  readonly box: Bounds;
  /// La chiave dell'oggetto; vuota per la pagina e per i nodi; per una guida
  /// il suo posto fra le guide del documento.
  readonly key: string;
  /// L'asse lungo cui una guida è un bersaglio: 0 per una guida verticale,
  /// che sta su un valore di x, 1 per una orizzontale.
  readonly axis?: Axis;
}

/// Un valore di ciò che si muove, lungo un asse, e dove sta.
export interface Anchor {
  readonly value: number;
  readonly edge: Edge;
}

/// Una linea delle guide, sul valore `value` dell'asse `axis`: verticale per
/// l'asse orizzontale, e viceversa. Va da `from` a `to` lungo l'altro asse.
export interface GuideLine {
  readonly axis: Axis;
  readonly value: number;
  readonly from: number;
  readonly to: number;
  /// Dove la linea passa per un bordo o un centro, lungo l'altro asse: i
  /// segni a croce.
  readonly marks: readonly number[];
  /// L'àncora di ciò che si muove, e il bersaglio in linea più vicino, prima
  /// gli oggetti e poi la pagina, col suo bordo.
  readonly source: Edge;
  readonly target: GuideTarget;
  readonly edge: Edge;
  /// Lo spazio lungo la linea fra ciò che si muove e quel bersaglio; `null`
  /// se si toccano o si sovrappongono.
  readonly gap: readonly [number, number] | null;
}

/// Uno spazio fra due riquadri di una fila: da `from` a `to` lungo l'asse, a
/// `across` sull'altro.
export interface Gap {
  readonly from: number;
  readonly to: number;
  readonly across: number;
}

/// Le distanze uguali lungo un asse: quanto, e gli spazi che le mostrano.
export interface Spacing {
  readonly axis: Axis;
  readonly gap: number;
  readonly gaps: readonly Gap[];
}

/// Una misura fra due punti della scena, su una linea dritta.
export interface Measure {
  readonly from: Point;
  readonly to: Point;
  readonly value: number;
}

/// Le misure fra due riquadri, e i prolungamenti dei bordi che le
/// raggiungono, tratteggiati.
export interface Measures {
  readonly measures: readonly Measure[];
  readonly extensions: readonly (readonly [Point, Point])[];
}

const EDGES: readonly Edge[] = ["min", "mid", "max", "point"];

/// Il valore di `box` lungo `axis` al bordo `edge`.
export function edgeValue(box: Bounds, axis: Axis, edge: Edge): number {
  return edge === "min" ? box.min[axis] : edge === "max" ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2;
}

/// Le àncore di `box` lungo `axis`: i due bordi e il centro, o il centro
/// solo se il riquadro lì non ha misura.
export function anchorsOf(box: Bounds, axis: Axis): Anchor[] {
  if (!(box.max[axis] > box.min[axis])) return [{ value: box.min[axis], edge: "mid" }];
  return (["min", "mid", "max"] as const).map((edge) => ({ value: edgeValue(box, axis, edge), edge }));
}

/// Fra il bersaglio `guide` e la riga della griglia `grid`, il più vicino a
/// `value`; a pari distanza il bersaglio. Senza né l'uno né l'altra, `value`.
export function nearer(value: number, guide: number | null, grid: number | null): number {
  if (guide !== null && (grid === null || Math.abs(guide - value) <= Math.abs(grid - value))) return guide;
  return grid ?? value;
}

/// Il primo indice di `values`, ordinati, che non sta sotto `value`.
function lowerBound(values: Float64Array, value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/// La distanza fra due intervalli; zero se si toccano o si sovrappongono.
function apart(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.max(0, bMin - aMax, aMin - bMax);
}

/// I bersagli di un gesto, ordinati per asse.
export class GuideIndex {
  /// Per asse, i valori in ordine e, allo stesso posto, chi li dà:
  /// `bersaglio * 4 + bordo`.
  private readonly values: [Float64Array, Float64Array];
  private readonly owners: [Uint32Array, Uint32Array];

  constructor(readonly targets: readonly GuideTarget[]) {
    const build = (axis: Axis): [Float64Array, Uint32Array] => {
      // Al più tre valori per bersaglio.
      const raw = new Float64Array(targets.length * 3);
      const from = new Uint32Array(targets.length * 3);
      let n = 0;
      targets.forEach((target, i) => {
        if (target.kind === "guide" && target.axis !== axis) return;
        const anchors: readonly Anchor[] = target.kind === "node" || target.kind === "guide" ? [{ value: target.box.min[axis], edge: "point" }] : anchorsOf(target.box, axis);
        for (const { value, edge } of anchors) {
          if (!Number.isFinite(value)) continue;
          raw[n] = value;
          from[n] = i * 4 + EDGES.indexOf(edge);
          n++;
        }
      });
      // L'ordine numerico del motore, senza un confronto in JavaScript per
      // coppia: con migliaia di oggetti in vista l'inizio del gesto non
      // s'inceppa. Poi ciascun valore va al suo posto, a pari valore
      // nell'ordine dei bersagli; `placed` conta chi è già entrato in ogni
      // serie di valori uguali, che comincia dove la bisezione arriva.
      const values = raw.slice(0, n).sort();
      const owners = new Uint32Array(n);
      const placed = new Uint32Array(n);
      for (let k = 0; k < n; k++) {
        const first = lowerBound(values, raw[k]!);
        owners[first + placed[first]!++] = from[k]!;
      }
      return [values, owners];
    };
    const [x, xOwners] = build(0);
    const [y, yOwners] = build(1);
    this.values = [x, y];
    this.owners = [xOwners, yOwners];
  }

  /// Il valore di un bersaglio lungo `axis` più vicino a `value`, entro
  /// `reach`; `null` se non ce n'è.
  nearest(axis: Axis, value: number, reach: number): number | null {
    const values = this.values[axis];
    const i = lowerBound(values, value);
    const above = i < values.length ? values[i]! : Infinity;
    const below = i > 0 ? values[i - 1]! : -Infinity;
    const best = above - value <= value - below ? above : below;
    return Math.abs(best - value) <= reach ? best : null;
  }

  /// Lo scarto più piccolo che porta uno dei valori `anchors` su un
  /// bersaglio lungo `axis`, entro `reach`; `null` se nessuno ci arriva.
  snap(axis: Axis, anchors: readonly number[], reach: number): number | null {
    let best: number | null = null;
    for (const value of anchors) {
      const target = this.nearest(axis, value, best === null ? reach : Math.abs(best));
      if (target !== null && (best === null || Math.abs(target - value) < Math.abs(best))) best = target - value;
    }
    return best;
  }

  /// Le linee di `box`, che si muove, lungo `axis`: una per ogni valore di
  /// `anchors` che sta su un bersaglio.
  lines(axis: Axis, box: Bounds, anchors: readonly Anchor[]): GuideLine[] {
    const other: Axis = axis === 0 ? 1 : 0;
    const values = this.values[axis];
    const owners = this.owners[axis];
    const out: GuideLine[] = [];
    const seen = new Set<number>();
    for (const anchor of anchors) {
      const marks = [...this.marksOf(box, other, anchor.edge)];
      let best: { target: GuideTarget; edge: Edge; distance: number } | null = null;
      for (let i = lowerBound(values, anchor.value - ON_GUIDE); i < values.length && values[i]! <= anchor.value + ON_GUIDE; i++) {
        const owner = owners[i]!;
        if (seen.has(owner)) continue;
        seen.add(owner);
        const target = this.targets[owner >>> 2]!;
        const edge = EDGES[owner & 3]!;
        // Una guida attraversa tutta la vista: la linea è la sua.
        if (target.kind !== "guide") marks.push(...this.marksOf(target.box, other, edge));
        // Prima gli oggetti, poi le guide, poi la pagina, che li contiene
        // tutti.
        const rank = target.kind === "page" ? 2e12 : target.kind === "guide" ? 1e12 : 0;
        const distance = rank + (target.kind === "guide" ? 0 : apart(box.min[other], box.max[other], target.box.min[other], target.box.max[other]));
        if (best === null || distance < best.distance) best = { target, edge, distance };
      }
      if (best === null) continue;
      const { target } = best;
      let gap: readonly [number, number] | null = null;
      if (target.kind !== "page" && target.kind !== "guide") {
        if (target.box.max[other] < box.min[other]) gap = [target.box.max[other], box.min[other]];
        else if (target.box.min[other] > box.max[other]) gap = [box.max[other], target.box.min[other]];
      }
      out.push({
        axis,
        value: anchor.value,
        from: Math.min(...marks),
        to: Math.max(...marks),
        marks,
        source: anchor.edge,
        target,
        edge: best.edge,
        gap,
      });
    }
    return out;
  }

  /// Dove una linea lungo l'altro asse passa per il bordo `edge` di `box`:
  /// ai due capi di un bordo, al centro di un centro.
  private marksOf(box: Bounds, other: Axis, edge: Edge): readonly number[] {
    return edge === "min" || edge === "max" ? [box.min[other], box.max[other]] : [(box.min[other] + box.max[other]) / 2];
  }

  /// Gli oggetti nella fila di `box` lungo `axis`: quelli che lo
  /// sovrappongono sull'altro asse, e non lungo `axis` di più di `slack`.
  /// Un oggetto sotto `box`, come lo sfondo di una scheda, non è un vicino, e
  /// non copre gli spazi fra gli altri.
  private row(axis: Axis, box: Bounds, slack: number): GuideTarget[] {
    const other: Axis = axis === 0 ? 1 : 0;
    const row: GuideTarget[] = [];
    for (const target of this.targets) {
      const b = target.box;
      if (target.kind !== "object" || !(b.min[other] < box.max[other] && b.max[other] > box.min[other])) continue;
      if (b.min[axis] < box.max[axis] - slack && b.max[axis] > box.min[axis] + slack) continue;
      row.push(target);
    }
    return row;
  }

  /// Ciò che serve per le distanze uguali di `box` lungo `axis`: il vicino
  /// prima e quello dopo, entro `slack`, e gli spazi fra due oggetti della
  /// fila che non scavalcano `box`.
  private neighbours(axis: Axis, box: Bounds, slack: number): { before: GuideTarget | null; after: GuideTarget | null; pairs: Array<{ a: GuideTarget; b: GuideTarget; gap: number }> } {
    const row = this.row(axis, box, slack).sort((a, b) => a.box.min[axis] - b.box.min[axis]);
    let before: GuideTarget | null = null;
    let after: GuideTarget | null = null;
    for (const target of row) {
      if (target.box.max[axis] <= box.min[axis] + slack && target.box.min[axis] < box.min[axis] && (before === null || target.box.max[axis] > before.box.max[axis])) before = target;
      if (target.box.min[axis] >= box.max[axis] - slack && target.box.max[axis] > box.max[axis] && (after === null || target.box.min[axis] < after.box.min[axis])) after = target;
    }
    const pairs: Array<{ a: GuideTarget; b: GuideTarget; gap: number }> = [];
    let reach: GuideTarget | null = null;
    for (const target of row) {
      if (reach !== null && target.box.min[axis] > reach.box.max[axis]) {
        const from = reach.box.max[axis];
        const to = target.box.min[axis];
        // Lo spazio dove sta `box` non è uno spazio della fila.
        if (!(from < box.max[axis] && to > box.min[axis])) pairs.push({ a: reach, b: target, gap: to - from });
      }
      if (reach === null || target.box.max[axis] > reach.box.max[axis]) reach = target;
    }
    return { before, after, pairs };
  }

  /// Lo scarto che porta `box` a distanze uguali lungo `axis`, entro
  /// `reach`: a metà fra i due vicini, o dal vicino quanto due oggetti della
  /// fila stanno fra loro. `null` se nessuno ci arriva.
  spaceSnap(axis: Axis, box: Bounds, reach: number): number | null {
    const { before, after, pairs } = this.neighbours(axis, box, reach);
    const size = box.max[axis] - box.min[axis];
    const at = box.min[axis];
    const candidates: number[] = [];
    if (before !== null && after !== null) {
      const gap = (after.box.min[axis] - before.box.max[axis] - size) / 2;
      if (gap > 0) candidates.push(before.box.max[axis] + gap);
    }
    for (const { gap } of pairs) {
      if (before !== null) {
        const p = before.box.max[axis] + gap;
        if (after === null || p + size <= after.box.min[axis]) candidates.push(p);
      }
      if (after !== null) {
        const p = after.box.min[axis] - gap - size;
        if (before === null || p >= before.box.max[axis]) candidates.push(p);
      }
    }
    let best: number | null = null;
    for (const p of candidates) {
      if (Math.abs(p - at) <= reach && (best === null || Math.abs(p - at) < Math.abs(best))) best = p - at;
    }
    return best;
  }

  /// Le distanze uguali di `box` lungo `axis`, dov'è: lo spazio dal vicino
  /// uguale a quello dall'altro vicino, o a uno fra due oggetti della fila.
  /// Gli spazi sono quelli di `box` e quelli della fila che misurano uguale.
  spacing(axis: Axis, box: Bounds): Spacing | null {
    const { before, after, pairs } = this.neighbours(axis, box, ON_GUIDE);
    const other: Axis = axis === 0 ? 1 : 0;
    const same = (a: number, b: number): boolean => Math.abs(a - b) <= 2 * ON_GUIDE;
    const left = before === null ? null : box.min[axis] - before.box.max[axis];
    const right = after === null ? null : after.box.min[axis] - box.max[axis];
    let gap: number | null = null;
    if (left !== null && right !== null && left > ON_GUIDE && same(left, right)) gap = left;
    else if (left !== null && left > ON_GUIDE && pairs.some((pair) => same(pair.gap, left))) gap = left;
    else if (right !== null && right > ON_GUIDE && pairs.some((pair) => same(pair.gap, right))) gap = right;
    if (gap === null) return null;
    const across = (a: Bounds, b: Bounds): number => (Math.max(a.min[other], b.min[other]) + Math.min(a.max[other], b.max[other])) / 2;
    const gaps: Gap[] = [];
    if (left !== null && same(left, gap)) gaps.push({ from: before!.box.max[axis], to: box.min[axis], across: across(before!.box, box) });
    if (right !== null && same(right, gap)) gaps.push({ from: box.max[axis], to: after!.box.min[axis], across: across(box, after!.box) });
    for (const pair of pairs) {
      if (same(pair.gap, gap)) gaps.push({ from: pair.a.box.max[axis], to: pair.b.box.min[axis], across: across(pair.a.box, pair.b.box) });
    }
    return { axis, gap, gaps };
  }
}

/// Le misure fra `a`, la selezione, e `b`, un altro oggetto o la pagina,
/// lungo ciascun asse: lo spazio fra i bordi che si guardano, se sono
/// staccati; se i riquadri si sovrappongono, la distanza fra i bordi dello
/// stesso lato. Una misura sta a metà della parte che i due riquadri hanno in
/// comune sull'altro asse; se non ne hanno, all'altezza del centro di `a`, e
/// il bordo di `b` la raggiunge tratteggiato.
export function measure(a: Bounds, b: Bounds): Measures {
  const measures: Measure[] = [];
  const extensions: Array<readonly [Point, Point]> = [];
  const point = (axis: Axis, along: number, across: number): Point => (axis === 0 ? [along, across] : [across, along]);
  const overlaps = (axis: Axis): boolean => a.min[axis] < b.max[axis] && b.min[axis] < a.max[axis];
  for (const axis of [0, 1] as const) {
    const other: Axis = axis === 0 ? 1 : 0;
    const lo = Math.max(a.min[other], b.min[other]);
    const hi = Math.min(a.max[other], b.max[other]);
    const shared = lo <= hi;
    const across = shared ? (lo + hi) / 2 : (a.min[other] + a.max[other]) / 2;
    const add = (from: number, to: number): void => {
      if (Math.abs(to - from) <= ON_GUIDE) return;
      measures.push({ from: point(axis, from, across), to: point(axis, to, across), value: Math.abs(to - from) });
    };
    if (a.max[axis] <= b.min[axis] || b.max[axis] <= a.min[axis]) {
      const ahead = a.max[axis] <= b.min[axis];
      const edge = ahead ? b.min[axis] : b.max[axis];
      add(ahead ? a.max[axis] : a.min[axis], edge);
      if (!shared && Math.abs(edge - (ahead ? a.max[axis] : a.min[axis])) > ON_GUIDE) {
        const near = across < b.min[other] ? b.min[other] : b.max[other];
        extensions.push([point(axis, edge, near), point(axis, edge, across)]);
      }
    } else if (overlaps(other)) {
      add(a.min[axis], b.min[axis]);
      add(a.max[axis], b.max[axis]);
    }
  }
  return { measures, extensions };
}
