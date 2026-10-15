// `pf1`: dal tratto quantizzato e dal pennello al contorno `d` (formato della
// scena, §5).
//
// Il contorno è il poligono di `getStroke` di perfect-freehand 1.2.3, chiuso
// con curve quadratiche per i punti medi. `d` si calcola sempre dagli interi
// di `fub:ink` divisi per la scala, mai dai numeri del dispositivo: è ciò che
// sta nel file, quindi chiunque ricalcoli `d` dal file (la shell lo fa per i
// tratti della sessione live, che arrivano senza contorno) ottiene la stessa
// stringa di chi l'ha scritto.
//
// Il percorso, con P₀…Pₙ₋₁ i punti del poligono arrotondati ai centesimi e
// Mᵢ il punto medio fra Pᵢ e Pᵢ₊₁ (Mₙ₋₁ fra l'ultimo e il primo):
//
//     M Mₙ₋₁ Q P₀ M₀ Q P₁ M₁ … Q Pₙ₋₁ Mₙ₋₁ Z
//
// Ogni curva va da un punto medio al successivo con il vertice come controllo,
// e l'ultima torna esattamente al punto di partenza: il contorno è chiuso e
// liscio anche dove comincia, senza lo spigolo della forma `M P₀ Q P₀ M₀ …`.
// I vertici si arrotondano prima, con la regola di §7, e i punti medi si
// calcolano sugli interi: `floor((a + b + 1) / 2)` è `floor((a + b) / 2 + 0,5)`
// senza passare da un numero non intero. Due vertici consecutivi uguali dopo
// l'arrotondamento sono uno solo; sotto i tre vertici distinti il poligono non
// ha area e `d` è vuoto, che è valido e non disegna nulla.
//
// Fra motori diversi. `getStroke` usa `Math.hypot`, `Math.sin`, `Math.cos` e
// `Math.pow`, che ECMAScript lascia approssimare al motore: V8 e SpiderMonkey
// partono dalle stesse fdlibm, JavaScriptCore no, e possono differire
// nell'ultima cifra binaria. I due decimali assorbono quella differenza salvo
// che un valore cada a meno di un miliardesimo da un mezzo centesimo, cioè
// quasi mai; quando capita, un vertice si sposta di un centesimo e la forma
// non cambia. Per questo `d` lo ricalcola sempre chi possiede il documento,
// e nessuno confronta `d` calcolati da motori diversi.

import { getStroke, type StrokeOptions } from "perfect-freehand";
import { formatScaled, roundHalfUp } from "../number";
import { checkBrush, type Pf1Brush } from "./brush";
import { INK_MAX_SAMPLES, PRESSURE_STEPS, type QuantizedInk } from "./sample";

/// Un vertice del contorno, in unità locali dell'elemento.
export type OutlinePoint = readonly [x: number, y: number];

export interface Pf1Options {
  /// Il tratto è concluso: la fine sta sull'ultimo campione e non un poco
  /// indietro. Vero per default, come vuole il formato; l'anteprima di un
  /// tratto in corso usa `false`.
  readonly last?: boolean;
}

/// I centesimi in cui si scrivono le coordinate di `d`.
const CENTS = 100;
const DECIMALS = 2;

/// Le opzioni di `getStroke` per un pennello: una chiave del pennello, una
/// opzione, e le curve di assottigliamento lasciate ai valori della libreria.
export function strokeOptions(brush: Pf1Brush, last: boolean): StrokeOptions {
  return {
    size: brush.size,
    thinning: brush.thinning,
    smoothing: brush.smoothing,
    streamline: brush.streamline,
    simulatePressure: brush.sim,
    start: { cap: brush.capStart, taper: brush.taperStart },
    end: { cap: brush.capEnd, taper: brush.taperEnd },
    last,
  };
}

function checkInk(ink: QuantizedInk): void {
  if (ink.scale !== 10 && ink.scale !== 100) throw new RangeError(`scala di fub:ink non valida: ${ink.scale}`);
  if (ink.samples.length > INK_MAX_SAMPLES) {
    throw new RangeError(`un tratto ha al massimo ${INK_MAX_SAMPLES} campioni: ${ink.samples.length}`);
  }
  for (const sample of ink.samples) {
    // Un numero non intero vuol dire campioni del dispositivo passati al posto
    // di quelli quantizzati: `d` non sarebbe più quello che il file rifà.
    if (!Number.isSafeInteger(sample.x) || !Number.isSafeInteger(sample.y)) {
      throw new RangeError(`campione non quantizzato: ${sample.x}, ${sample.y}`);
    }
    if (sample.p !== undefined && !(Number.isInteger(sample.p) && sample.p >= 0 && sample.p <= PRESSURE_STEPS)) {
      throw new RangeError(`pressione quantizzata fuori da 0…${PRESSURE_STEPS}: ${sample.p}`);
    }
  }
}

/// Il poligono del contorno, non arrotondato: serve all'anteprima, che lo
/// riempie senza passare da una stringa.
export function pf1Outline(ink: QuantizedInk, brush: Pf1Brush, options: Pf1Options = {}): OutlinePoint[] {
  checkBrush(brush);
  checkInk(ink);
  if (ink.samples.length === 0) return [];
  const { scale } = ink;
  const points = ink.samples.map((sample) => sample.p === undefined
    ? [sample.x / scale, sample.y / scale]
    : [sample.x / scale, sample.y / scale, sample.p / PRESSURE_STEPS]);
  return getStroke(points, strokeOptions(brush, options.last ?? true));
}

/// `d` di un poligono: curve quadratiche per i punti medi, coordinate a due
/// decimali con la regola di §7, comandi assoluti separati da uno spazio.
export function outlinePath(outline: readonly OutlinePoint[]): string {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of outline) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new RangeError(`vertice non finito: ${px}, ${py}`);
    const x = roundHalfUp(px, CENTS);
    const y = roundHalfUp(py, CENTS);
    const last = xs.length - 1;
    if (last >= 0 && xs[last] === x && ys[last] === y) continue;
    xs.push(x);
    ys.push(y);
  }
  // Il poligono è chiuso: l'ultimo vertice uguale al primo è un doppione.
  while (xs.length > 1 && xs[xs.length - 1] === xs[0] && ys[ys.length - 1] === ys[0]) {
    xs.pop();
    ys.pop();
  }
  const n = xs.length;
  if (n < 3) return "";
  const at = (units: number): string => formatScaled(units, DECIMALS);
  const middle = (a: number, b: number): number => Math.floor((a + b + 1) / 2);
  const parts: string[] = new Array(n + 2);
  parts[0] = `M${at(middle(xs[n - 1]!, xs[0]!))} ${at(middle(ys[n - 1]!, ys[0]!))}`;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const x = xs[i]!;
    const y = ys[i]!;
    parts[i + 1] = `Q${at(x)} ${at(y)} ${at(middle(x, xs[j]!))} ${at(middle(y, ys[j]!))}`;
  }
  parts[n + 1] = "Z";
  return parts.join(" ");
}

/// `d` di un tratto: `getStroke` sui campioni quantizzati, con `last: true`
/// per default. Lancia `RangeError` su un pennello non valido o su campioni
/// che non sono interi di `fub:ink`.
export function pf1(ink: QuantizedInk, brush: Pf1Brush, options: Pf1Options = {}): string {
  return outlinePath(pf1Outline(ink, brush, options));
}
