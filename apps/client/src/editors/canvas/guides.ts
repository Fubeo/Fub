// Le guide intelligenti della lavagna (N6 T71): mentre una scheda si sposta o
// si ridimensiona, il lato che tira si aggancia al bordo o al centro di
// un'altra scheda in vista, oppure a uno spazio uguale a quello fra tre
// schede in fila. Dove una guida vince, la griglia non si applica su quell'asse.
//
// È una funzione pura: non tocca il DOM né il motore. Il motore le dà la
// scheda nella posizione libera del gesto, le schede in vista che non si
// muovono e la soglia in unità della lavagna; ne riceve lo spostamento da
// aggiungere su ciascun asse e i segmenti da disegnare.
//
// - **Soglia.** Una guida si prende entro `GUIDE_SCREEN_PX` pixel sullo
//   schermo: il motore la converte in unità con lo zoom.
// - **Precedenza.** Su ogni asse vince la guida più vicina; a parità, il
//   bordo o il centro prima dello spazio uguale.
// - **Quali lati.** Lo spostamento porta tutti e tre i punti della scheda
//   (bordo iniziale, centro, bordo finale). Il ridimensionamento porta solo il
//   lato che tira: `sides` dice quali.
// - **Lo spazio uguale.** Fra due schede in fila (sovrapposte sull'altro
//   asse) c'è uno spazio; la scheda in movimento si mette dopo, prima, o in
//   mezzo con due spazi uguali a quello.

/** La distanza, sullo schermo, entro cui una guida si prende. */
export const GUIDE_SCREEN_PX = 6;

/** Un punto di una scheda su un asse: il bordo iniziale, il centro, il bordo finale. */
export type GuideSide = "start" | "center" | "end";

/** Che guida è: un bordo o un centro allineati, oppure uno spazio uguale. */
export type GuideKind = "edge" | "center" | "gap";

/** Un rettangolo della lavagna, in sue unità. */
export interface GuideRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Un segmento da disegnare sopra la lavagna, nelle sue unità. */
export interface GuideSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly kind: GuideKind;
}

/** Ciò che il motore dà alla funzione. */
export interface GuideInput {
  /** La scheda (o la cornice delle schede) nella posizione libera del gesto. */
  readonly moving: GuideRect;
  /** Le schede in vista che non si muovono. */
  readonly others: readonly GuideRect[];
  /** La soglia, in unità della lavagna: `GUIDE_SCREEN_PX` diviso lo zoom. */
  readonly threshold: number;
  /** I lati che il gesto muove, per asse. */
  readonly sides: { readonly x: readonly GuideSide[]; readonly y: readonly GuideSide[] };
}

/** Lo spostamento da aggiungere su ciascun asse, e le guide da mostrare. */
export interface GuideResult {
  /** Lo spostamento su x e su y che prende la guida; `0` se su quell'asse non ce n'è una. */
  readonly dx: number;
  readonly dy: number;
  /** Su quell'asse una guida ha vinto: la griglia non si applica. */
  readonly guidedX: boolean;
  readonly guidedY: boolean;
  /** I segmenti delle guide che vincono, già nella posizione finale. */
  readonly segments: readonly GuideSegment[];
}

type Axis = "x" | "y";

interface Span {
  readonly start: number;
  readonly size: number;
}

/** Un modo di agganciare su un asse: lo spostamento, e le schede che lo motivano. */
interface Candidate {
  readonly axis: Axis;
  readonly delta: number;
  readonly kind: GuideKind;
  /** La coordinata della guida di bordo o centro (per lo spazio uguale non serve). */
  readonly line: number;
  /** La scheda con cui ci si allinea; per lo spazio uguale, la coppia in fila (prima p, poi q). */
  readonly refs: readonly GuideRect[];
  /** Per lo spazio uguale: dove sta la scheda in movimento rispetto alla coppia. */
  readonly form?: "after" | "before" | "between";
}

function spanOf(rect: GuideRect, axis: Axis): Span {
  return axis === "x" ? { start: rect.x, size: rect.width } : { start: rect.y, size: rect.height };
}

function crossAxis(axis: Axis): Axis {
  return axis === "x" ? "y" : "x";
}

/** Le due schede si sovrappongono sull'asse `axis` (in fila, o in colonna). */
function overlaps(a: GuideRect, b: GuideRect, axis: Axis): boolean {
  const sa = spanOf(a, axis);
  const sb = spanOf(b, axis);
  return Math.min(sa.start + sa.size, sb.start + sb.size) > Math.max(sa.start, sb.start);
}

/** Il centro della parte in comune di `rects` sull'asse `axis`, o di tutte se non ne hanno. */
function crossMid(rects: readonly GuideRect[], axis: Axis): number {
  let lo = -Infinity;
  let hi = Infinity;
  let uLo = Infinity;
  let uHi = -Infinity;
  for (const rect of rects) {
    const span = spanOf(rect, axis);
    lo = Math.max(lo, span.start);
    hi = Math.min(hi, span.start + span.size);
    uLo = Math.min(uLo, span.start);
    uHi = Math.max(uHi, span.start + span.size);
  }
  return lo < hi ? (lo + hi) / 2 : (uLo + uHi) / 2;
}

/** Dove stanno insieme `rects` sull'asse `axis`: dal primo bordo all'ultimo. */
function rangeOf(rects: readonly GuideRect[], axis: Axis): Span {
  let lo = Infinity;
  let hi = -Infinity;
  for (const rect of rects) {
    const span = spanOf(rect, axis);
    lo = Math.min(lo, span.start);
    hi = Math.max(hi, span.start + span.size);
  }
  return { start: lo, size: hi - lo };
}

/** Gli spostamenti che `input` offre su `axis`, ognuno con la guida che lo motiva. */
function candidatesOn(input: GuideInput, axis: Axis): Candidate[] {
  const out: Candidate[] = [];
  const sides = input.sides[axis];
  if (sides.length === 0) return out;
  const moving = spanOf(input.moving, axis);
  const at: Record<GuideSide, number> = {
    start: moving.start,
    center: moving.start + moving.size / 2,
    end: moving.start + moving.size,
  };
  const within = (delta: number): boolean => Number.isFinite(delta) && Math.abs(delta) <= input.threshold;

  // Bordi e centri: ogni lato che si muove contro ogni bordo e centro in vista.
  for (const other of input.others) {
    const span = spanOf(other, axis);
    const lines: ReadonlyArray<readonly [number, GuideKind]> = [
      [span.start, "edge"],
      [span.start + span.size / 2, "center"],
      [span.start + span.size, "edge"],
    ];
    for (const side of sides) {
      for (const [line, otherKind] of lines) {
        const delta = line - at[side];
        if (!within(delta)) continue;
        const kind: GuideKind = otherKind === "center" || side === "center" ? "center" : "edge";
        out.push({ axis, delta, kind, line, refs: [other] });
      }
    }
  }

  // Spazi uguali: due schede in fila, p prima di q, con uno spazio `gap`. La
  // scheda in movimento va dopo q (lo spazio nuovo sta dopo il lato finale di
  // q), prima di p, o in mezzo, con due spazi uguali a quello.
  const row = input.others.filter((other) => overlaps(other, input.moving, crossAxis(axis)));
  for (const p of row) {
    const ps = spanOf(p, axis);
    for (const q of row) {
      if (p === q) continue;
      const qs = spanOf(q, axis);
      const gap = qs.start - (ps.start + ps.size);
      if (!(gap >= 0)) continue;
      if (sides.includes("start")) {
        const delta = qs.start + qs.size + gap - at.start;
        if (within(delta)) out.push({ axis, delta, kind: "gap", line: NaN, refs: [p, q], form: "after" });
      }
      if (sides.includes("end")) {
        const delta = ps.start - gap - at.end;
        if (within(delta)) out.push({ axis, delta, kind: "gap", line: NaN, refs: [p, q], form: "before" });
      }
      if (sides.includes("start") && sides.includes("end") && gap >= moving.size) {
        const delta = ps.start + ps.size + (gap - moving.size) / 2 - at.start;
        if (within(delta)) out.push({ axis, delta, kind: "gap", line: NaN, refs: [p, q], form: "between" });
      }
    }
  }
  return out;
}

/** Il punteggio che fa vincere una guida: prima la più vicina, a parità bordo o centro prima dello spazio. */
function beats(candidate: Candidate, best: Candidate): boolean {
  const near = Math.abs(candidate.delta) - Math.abs(best.delta);
  if (near < -1e-9) return true;
  return Math.abs(near) <= 1e-9 && rank(candidate) < rank(best);
}

function rank(candidate: Candidate): number {
  return candidate.kind === "gap" ? 1 : 0;
}

/** La guida che vince su un asse, o `null` se nessuna è entro la soglia. */
function winnerOn(candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (best === null || beats(candidate, best)) best = candidate;
  }
  return best;
}

/** Un segmento fra `from` e `to` sull'asse `axis`, alla coordinata `cross` dell'altro. */
function gapSegment(axis: Axis, from: number, to: number, cross: number): GuideSegment {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return axis === "x"
    ? { x1: lo, y1: cross, x2: hi, y2: cross, kind: "gap" }
    : { x1: cross, y1: lo, x2: cross, y2: hi, kind: "gap" };
}

/** Il segmento di una guida di bordo o centro, sulla coordinata `at` dell'asse `axis`. */
function lineSegment(axis: Axis, at: number, range: Span, kind: GuideKind): GuideSegment {
  const from = range.start;
  const to = range.start + range.size;
  return axis === "x"
    ? { x1: at, y1: from, x2: at, y2: to, kind }
    : { x1: from, y1: at, x2: to, y2: at, kind };
}

/** I segmenti di `candidate`, con la scheda in movimento già nella posizione finale `box`. */
function segmentsOf(candidate: Candidate, box: GuideRect): GuideSegment[] {
  const axis = candidate.axis;
  const cross = crossAxis(axis);
  if (candidate.kind !== "gap") {
    // Il segmento corre dal bordo più in alto a quello più in basso delle
    // schede allineate, e sta sulla coordinata della guida.
    return [lineSegment(axis, candidate.line, rangeOf([box, ...candidate.refs], cross), candidate.kind)];
  }
  const [p, q] = candidate.refs as [GuideRect, GuideRect];
  const ps = spanOf(p, axis);
  const qs = spanOf(q, axis);
  const bs = spanOf(box, axis);
  const refGap = gapSegment(axis, ps.start + ps.size, qs.start, crossMid([p, q], cross));
  if (candidate.form === "after") {
    return [refGap, gapSegment(axis, qs.start + qs.size, bs.start, crossMid([q, box], cross))];
  }
  if (candidate.form === "before") {
    return [refGap, gapSegment(axis, bs.start + bs.size, ps.start, crossMid([box, p], cross))];
  }
  return [
    gapSegment(axis, ps.start + ps.size, bs.start, crossMid([p, box], cross)),
    gapSegment(axis, bs.start + bs.size, qs.start, crossMid([box, q], cross)),
  ];
}

/**
 * Le guide della scheda `input.moving`: lo spostamento su ciascun asse che
 * prende la guida più vicina entro la soglia, e i segmenti da disegnare sulla
 * scheda già spostata. Senza guide, `0` e nessun segmento: il motore applica
 * la griglia.
 */
export function snapGuides(input: GuideInput): GuideResult {
  const candidatesX = candidatesOn(input, "x");
  const candidatesY = candidatesOn(input, "y");
  const winX = winnerOn(candidatesX);
  const winY = winnerOn(candidatesY);
  const dx = winX?.delta ?? 0;
  const dy = winY?.delta ?? 0;
  const box: GuideRect = {
    x: input.moving.x + dx,
    y: input.moving.y + dy,
    width: input.moving.width,
    height: input.moving.height,
  };
  // Tutte le guide che danno lo stesso spostamento su ciascun asse: una scheda
  // può allinearsi a più bordi insieme, e si mostrano tutte.
  const shown = [
    ...candidatesX.filter((candidate) => winX !== null && Math.abs(candidate.delta - dx) <= 1e-9),
    ...candidatesY.filter((candidate) => winY !== null && Math.abs(candidate.delta - dy) <= 1e-9),
  ];
  const segments: GuideSegment[] = [];
  const seen = new Set<string>();
  for (const candidate of shown) {
    for (const segment of segmentsOf(candidate, box)) {
      if (segment.x1 === segment.x2 && segment.y1 === segment.y2) continue;
      const key = `${segment.x1},${segment.y1},${segment.x2},${segment.y2},${segment.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push(segment);
    }
  }
  return { dx, dy, guidedX: winX !== null, guidedY: winY !== null, segments };
}
