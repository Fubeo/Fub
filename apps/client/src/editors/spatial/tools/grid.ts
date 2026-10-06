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

import type { Camera } from "../../../spatial/camera";
import type { Bounds } from "../scene/geometry";
import type { Point } from "../scene/matrix";

/// La griglia, e le guide intelligenti che stanno con lei nel menu «Pagina
/// e griglia» e si ricordano con lei.
export interface Grid {
  /// La griglia si vede.
  readonly shown: boolean;
  /// I punti si agganciano alla griglia.
  readonly snap: boolean;
  /// Il passo, in unità della scena.
  readonly step: number;
  /// Le guide intelligenti agganciano agli altri oggetti e alla pagina
  /// (`guides.ts`).
  readonly guides: boolean;
}

/// I passi fra cui si sceglie: dividono tutti la pagina di un documento
/// nuovo, 1600 per 1000.
export const GRID_STEPS: readonly number[] = [5, 10, 20, 50, 100];

/// La prima volta la griglia è spenta e le guide sono accese, come nei
/// programmi di disegno che chi disegna conosce già.
export const DEFAULT_GRID: Grid = { shown: false, snap: false, step: 20, guides: true };

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
/// `height` pixel, inquadrato dalla camera `view`.
export function gridLines(view: Camera, width: number, height: number, step: number): GridLines {
  if (!(view.scale > 0) || !validStep(step) || width <= 0 || height <= 0) return { minor: "", major: "" };
  let pitch = step;
  while (pitch * view.scale < GRID_MIN_PX) pitch *= GRID_MAJOR;
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
