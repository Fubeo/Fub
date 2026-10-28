// Il righello (P13): una riga sul foglio, come in OneNote e in Windows Ink.
// Qui la parte pura: dove sta, quando un tratto lo segue e come si gira.
// L'editor (`editor/ruler-ink.ts`) lo mostra, lo sposta e ci scrive lungo.
//
// - **Dove sta.** Un centro e un angolo nella scena; la larghezza è in pixel
//   dello schermo e non cambia con lo zoom, come un righello vero sopra un
//   foglio che si avvicina.
// - **Il tratto lungo il bordo.** Un tratto che comincia vicino a un bordo lo
//   segue: ogni campione va sulla retta del bordo, scostata di mezza punta
//   verso fuori, così l'inchiostro tocca il righello senza passarci sotto.
//   Pressione, tempo e inclinazione restano. Uno che comincia lontano resta
//   com'è.
// - **Girare.** A gradi interi, o a passi di `RULER_STEP` col tasto che
//   raddrizza.

import type { InkSample } from "../../../ink/sample";
import type { Point } from "../scene/matrix";
import { normalTurn } from "../view";

/// Il righello sulla scena: il centro e l'angolo del bordo, in gradi.
export interface Ruler {
  readonly center: Point;
  readonly angle: number;
}

/// La larghezza del righello, in pixel dello schermo.
export const RULER_WIDTH_PX = 72;
/// Il passo della rotazione col tasto che raddrizza, in gradi.
export const RULER_STEP = 15;

/// Il bordo che un tratto segue: un punto della retta e la sua direzione,
/// lunga uno, nella scena.
export interface RulerEdge {
  readonly origin: Point;
  readonly direction: Point;
}

/// La direzione del righello e la sua normale, lunghe uno.
function axes(ruler: Ruler): { along: Point; across: Point } {
  const radians = (ruler.angle * Math.PI) / 180;
  const along: Point = [Math.cos(radians), Math.sin(radians)];
  return { along, across: [-along[1], along[0]] };
}

/// Quanto `p` sta di traverso al righello: la distanza dalla linea di
/// mezzo, col segno del lato.
function acrossOf(ruler: Ruler, p: Point): number {
  const { across } = axes(ruler);
  return (p[0] - ruler.center[0]) * across[0] + (p[1] - ruler.center[1]) * across[1];
}

/// Vero se `p` sta sul righello largo `half` per lato dalla linea di mezzo, a
/// più di `reach` da tutti e due i bordi: lì il puntatore lo prende e lo
/// sposta. Le misure sono nella scena.
export function onRulerBody(ruler: Ruler, p: Point, half: number, reach: number): boolean {
  return Math.abs(acrossOf(ruler, p)) < half - reach;
}

/// Vero se `p` sta sul righello, bordi compresi.
export function onRuler(ruler: Ruler, p: Point, half: number): boolean {
  return Math.abs(acrossOf(ruler, p)) <= half;
}

/// Il bordo che segue un tratto cominciato in `p`, se `p` sta entro `reach`
/// da un bordo, dentro o fuori: la retta del bordo scostata di `offset` verso
/// fuori, mezza punta. `null` se `p` è lontano.
export function rulerEdge(ruler: Ruler, p: Point, half: number, reach: number, offset: number): RulerEdge | null {
  const d = acrossOf(ruler, p);
  if (Math.abs(Math.abs(d) - half) > reach) return null;
  const side = d < 0 ? -1 : 1;
  const { along, across } = axes(ruler);
  const shift = side * (half + offset);
  return { origin: [ruler.center[0] + across[0] * shift, ruler.center[1] + across[1] * shift], direction: along };
}

/// Il campione `sample` portato sul bordo `edge`: la posizione lungo il bordo
/// resta, tutto il resto anche.
export function alongEdge(sample: InkSample, edge: RulerEdge): InkSample {
  const [ox, oy] = edge.origin;
  const [dx, dy] = edge.direction;
  const k = (sample.x - ox) * dx + (sample.y - oy) * dy;
  return { ...sample, x: ox + dx * k, y: oy + dy * k };
}

/// L'angolo del righello girato di `degrees`, fra -180 e 180, al decimo di
/// grado.
export function turnedRuler(ruler: Ruler, degrees: number): Ruler {
  return { ...ruler, angle: Math.round(normalTurn(ruler.angle + degrees) * 10) / 10 };
}

/// L'angolo del righello al passo `RULER_STEP` dopo quello di adesso, nella
/// direzione `direction` (+1 o -1): da 7° si va a 15° o a 0°.
export function steppedRuler(ruler: Ruler, direction: 1 | -1): Ruler {
  const at = ruler.angle / RULER_STEP;
  const next = direction > 0 ? Math.floor(at + 1e-9) + 1 : Math.ceil(at - 1e-9) - 1;
  return { ...ruler, angle: normalTurn(next * RULER_STEP) };
}

/// L'angolo come si legge: gradi interi fra 0 e 180, perché un righello
/// girato di mezzo giro è lo stesso righello.
export function rulerDegrees(ruler: Ruler): number {
  const folded = ((Math.round(ruler.angle) % 180) + 180) % 180;
  return folded;
}
