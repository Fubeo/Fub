// La griglia del disegno (livello Standard): un aiuto della vista, che non
// entra nel file. Si vede sopra la carta e sotto il disegno, e gli strumenti
// ci agganciano i punti.
//
// - **Nella scena.** Le righe stanno sui multipli del passo contati
//   dall'origine della scena, l'angolo della pagina di un documento nuovo.
//   Quando la pagina cresce a sinistra o in alto la griglia resta dov'era, e
//   gli oggetti già agganciati ci restano sopra.
// - **Si dirada.** Se due righe vicine distano meno di [`GRID_MIN_PX`] pixel,
//   se ne vede una ogni cinque, poi una ogni venticinque. L'aggancio resta
//   al passo scelto. Una riga ogni [`GRID_MAJOR`] è più marcata.
// - **Righe nitide.** Ogni riga cade a metà di un pixel dello schermo, così
//   una riga di un pixel non si sfuma su due.
// - **Agganciare** porta un punto all'incrocio più vicino. Uno spostamento
//   porta sull'incrocio più vicino l'angolo della geometria scelto
//   all'inizio del gesto. Il contorno resta fuori, perché esce dalla griglia
//   anche in una forma disegnata agganciata.
// - **Nell'unità del documento.** Ogni unità ha i suoi passi, e ricorda
//   quello scelto: un documento in millimetri ha la griglia in millimetri, e
//   quello in pixel accanto resta com'era.

import { DEFAULT_CURVE, type PenCurve } from "../pen/pressure";
import type { Bounds } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { UNIT_SIZE, UNITS, type LengthUnit } from "../scene/rulers";
import { sceneBox, toScreen, type View } from "../view";

/// La griglia, e ciò che sta con lei nel menu «Pagina e griglia» e si
/// ricorda con lei: le guide intelligenti, i righelli e le loro guide, le
/// forme dal tratto; e come si presentano il pannello delle proprietà e la
/// barra della selezione.
export interface Grid {
  /// La griglia si vede.
  readonly shown: boolean;
  /// I punti si agganciano alla griglia.
  readonly snap: boolean;
  /// Il passo dei documenti in pixel, in unità della scena.
  readonly step: number;
  /// Il passo dei documenti nelle altre unità, in unità della scena: ogni
  /// unità ricorda il suo, e una che manca ha quello di serie.
  readonly steps: Readonly<Partial<Record<LengthUnit, number>>>;
  /// Le guide intelligenti agganciano agli altri oggetti e alla pagina
  /// (`guides.ts`).
  readonly guides: boolean;
  /// I righelli si vedono (`rulers.ts`).
  readonly rulers: boolean;
  /// Le guide dei righelli, scritte nel documento, si vedono e agganciano.
  readonly rulerGuides: boolean;
  /// Il pannello delle proprietà è aperto. `null` finché nessuno l'ha aperto
  /// o chiuso: si apre da sé in un editor abbastanza largo da tenerlo.
  readonly panel: boolean | null;
  /// La barra della selezione sta accanto alla selezione, e non in cima al
  /// foglio.
  readonly bar: boolean;
  /// Un tratto a penna tenuto fermo alla fine diventa la forma a cui
  /// somiglia (`recognize.ts`).
  readonly shapes: boolean;
  /// Le sezioni del pannello delle proprietà che sono chiuse.
  readonly closed: readonly string[];
  /// Due dita che ruotano girano anche il foglio.
  readonly twist: boolean;
  /// Un tocco di due dita annulla, uno di tre ripete.
  readonly taps: boolean;
  /// La curva della pressione della penna (`pen/pressure.ts`).
  readonly pen: PenCurve;
}

/// I passi fra cui si sceglie, nell'unità: in pixel dividono tutti la
/// pagina di un documento nuovo, 1600 per 1000; nelle altre unità il
/// centimetro, il pollice e il punto tipografico.
export const GRID_STEPS: Readonly<Record<LengthUnit, readonly number[]>> = {
  px: [5, 10, 20, 50, 100],
  mm: [1, 2, 5, 10, 20],
  cm: [0.2, 0.5, 1, 2, 5],
  in: [0.0625, 0.125, 0.25, 0.5, 1],
  pt: [6, 12, 18, 36, 72],
};

/// Il passo di un'unità che nessuno ha ancora scelto, nell'unità.
export const UNIT_STEP: Readonly<Record<LengthUnit, number>> = { px: 20, mm: 5, cm: 0.5, in: 0.25, pt: 12 };

/// La prima volta la griglia e i righelli sono spenti, le guide e le forme dal
/// tratto accese, come nei programmi di disegno che chi disegna conosce già.
/// Il pannello si apre da sé se c'è posto, con «Trasforma» e gli attributi
/// chiusi, e la barra sta accanto alla selezione. Le dita girano il foglio e
/// i loro tocchi annullano e ripetono, come sulle tavolette; la penna preme
/// come la dà il suo driver.
export const DEFAULT_GRID: Grid = {
  shown: false,
  snap: false,
  step: 20,
  steps: {},
  guides: true,
  rulers: false,
  rulerGuides: true,
  panel: null,
  bar: true,
  shapes: true,
  closed: ["transform", "attributes"],
  twist: true,
  taps: true,
  pen: DEFAULT_CURVE,
};

/// Quante sezioni chiuse si ricordano, e quanto è lungo il nome di una: più
/// di quante il pannello ne ha, e di quanto è lungo il nome di ciascuna.
export const MAX_CLOSED = 16;
export const MAX_SECTION_NAME = 32;

/// `value` come elenco delle sezioni chiuse, se lo è.
export function validClosed(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CLOSED) return null;
  if (!value.every((name) => typeof name === "string" && name.length > 0 && name.length <= MAX_SECTION_NAME)) return null;
  return [...new Set(value as string[])];
}

/// I limiti del passo, in unità della scena.
export const MIN_GRID_STEP = 1;
export const MAX_GRID_STEP = 1000;

/// La distanza più piccola, in pixel, fra due righe che si vedono.
export const GRID_MIN_PX = 8;

/// Ogni quante righe una è più marcata.
export const GRID_MAJOR = 5;

/// Lo scarto, in passi, sotto cui un valore sta già su una riga: un bordo
/// scritto a due decimali può sforare di un'inezia in virgola mobile.
const ON_LINE = 1e-6;

/// Un valore come lo scrive il file: due decimali, e niente `-0`.
function clean(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}

/// Vero se `step` è un passo che la griglia accetta.
export function validStep(step: number): boolean {
  return Number.isFinite(step) && step >= MIN_GRID_STEP && step <= MAX_GRID_STEP;
}

/// I passi fra cui si sceglie in `unit`, in unità della scena.
export function unitSteps(unit: LengthUnit): number[] {
  return GRID_STEPS[unit].map((step) => step * UNIT_SIZE[unit]);
}

/// Il passo della griglia di `grid` per un documento in `unit`, in unità
/// della scena.
export function gridStep(grid: Grid, unit: LengthUnit): number {
  return unit === "px" ? grid.step : (grid.steps[unit] ?? UNIT_STEP[unit] * UNIT_SIZE[unit]);
}

/// `grid` col passo `step` per i documenti in `unit`.
export function withStep(grid: Grid, unit: LengthUnit, step: number): Grid {
  return unit === "px" ? { ...grid, step } : { ...grid, steps: { ...grid.steps, [unit]: step } };
}

/// I passi ricordati di `value` che la griglia accetta, per le unità che
/// conosce: il resto non conta.
export function validSteps(value: unknown): Partial<Record<LengthUnit, number>> {
  const steps: Partial<Record<LengthUnit, number>> = {};
  if (typeof value !== "object" || value === null) return steps;
  for (const unit of UNITS) {
    const step = (value as Record<string, unknown>)[unit];
    if (unit !== "px" && typeof step === "number" && validStep(step)) steps[unit] = step;
  }
  return steps;
}

/// Vero se due passi sono lo stesso, a meno della virgola mobile di una
/// conversione d'unità.
export function sameStep(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
}

/// `value` sulla riga più vicina.
export function snapValue(value: number, step: number): number {
  return clean(Math.round(value / step) * step);
}

/// `p` sull'incrocio più vicino.
export function snapPoint(p: Point, step: number): Point {
  return [snapValue(p[0], step), snapValue(p[1], step)];
}

/// La riga `n` passi oltre `value` verso `direction`: con `n` uguale a 1 è
/// la prima riga che `value` non ha ancora raggiunto. Un valore che sta già
/// su una riga va alla riga dopo.
export function lineBeyond(value: number, step: number, direction: 1 | -1, n: number): number {
  const at = value / step;
  const k = direction > 0 ? Math.floor(at + ON_LINE) + n : Math.ceil(at - ON_LINE) - n;
  return clean(k * step);
}

/// L'angolo di `bounds` più vicino a `p`: quello che uno spostamento
/// aggancia.
export function nearestCorner(bounds: Bounds, p: Point): Point {
  const x = Math.abs(p[0] - bounds.min[0]) <= Math.abs(p[0] - bounds.max[0]) ? bounds.min[0] : bounds.max[0];
  const y = Math.abs(p[1] - bounds.min[1]) <= Math.abs(p[1] - bounds.max[1]) ? bounds.min[1] : bounds.max[1];
  return [x, y];
}

/// Lo spostamento che porta `source`, un punto della scena spostato di
/// (`dx`, `dy`), sull'incrocio più vicino.
export function snapDelta(source: Point, dx: number, dy: number, step: number): [number, number] {
  const [x, y] = snapPoint([source[0] + dx, source[1] + dy], step);
  return [clean(x - source[0]), clean(y - source[1])];
}

/// Il più piccolo multiplo del passo che non scende sotto `distance`: lo
/// scarto delle copie, che con l'aggancio restano sulla griglia.
export function wholeSteps(distance: number, step: number): number {
  return clean(Math.max(1, Math.ceil(distance / step - ON_LINE)) * step);
}

/// Le righe della griglia che si vedono.
export interface GridLines {
  /// Il `d` delle righe sottili e di quelle marcate, in pixel del foglio.
  readonly minor: string;
  readonly major: string;
}

/// Le righe della griglia di passo `step` in un foglio di `width` per
/// `height` pixel, inquadrato dalla camera `view`. La griglia è della scena:
/// su un foglio girato gira con lui.
export function gridLines(view: View, width: number, height: number, step: number): GridLines {
  if (!(view.scale > 0) || !validStep(step) || width <= 0 || height <= 0) return { minor: "", major: "" };
  let pitch = step;
  while (pitch * view.scale < GRID_MIN_PX) pitch *= GRID_MAJOR;
  if (view.angle !== 0) return turnedLines(view, width, height, pitch);
  const minor: string[] = [];
  const major: string[] = [];
  const lines = (offset: number, size: number, draw: (at: number) => string): void => {
    const first = Math.ceil(-offset / view.scale / pitch);
    const last = Math.floor((size - offset) / view.scale / pitch);
    for (let k = first; k <= last; k++) {
      const at = Math.round(offset + view.scale * k * pitch) + 0.5;
      (k % GRID_MAJOR === 0 ? major : minor).push(draw(at));
    }
  };
  lines(view.tx, width, (x) => `M${x} 0V${height}`);
  lines(view.ty, height, (y) => `M0 ${y}H${width}`);
  return { minor: minor.join(""), major: major.join("") };
}

/// `gridLines` su un foglio girato: le righe della scena che attraversano
/// ciò che si vede, da un bordo all'altro del riquadro della scena che lo
/// copre. Girate di un angolo retto restano diritte sullo schermo, sul mezzo
/// pixel; di sbieco sono oblique, a due decimali.
function turnedLines(view: View, width: number, height: number, pitch: number): GridLines {
  const box = sceneBox(view, { x: 0, y: 0, w: width, h: height });
  const square = view.angle % 90 === 0;
  const pin = (value: number): number => (square ? Math.round(value - 0.5) + 0.5 : Math.round(value * 100) / 100);
  const minor: string[] = [];
  const major: string[] = [];
  for (const axis of [0, 1] as const) {
    const first = Math.ceil(box.min[axis] / pitch);
    const last = Math.floor(box.max[axis] / pitch);
    for (let k = first; k <= last; k++) {
      const at = k * pitch;
      let [ax, ay] = toScreen(view, axis === 0 ? [at, box.min[1]] : [box.min[0], at]);
      let [bx, by] = toScreen(view, axis === 0 ? [at, box.max[1]] : [box.max[0], at]);
      if (square && Math.abs(ax - bx) < 1e-6) ax = bx = pin(ax);
      else if (square) ay = by = pin(ay);
      else [ax, ay, bx, by] = [pin(ax), pin(ay), pin(bx), pin(by)];
      (k % GRID_MAJOR === 0 ? major : minor).push(`M${ax} ${ay}L${bx} ${by}`);
    }
  }
  return { minor: minor.join(""), major: major.join("") };
}
