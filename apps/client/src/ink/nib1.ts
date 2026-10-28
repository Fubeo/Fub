// `nib1`: la punta piatta della Calligrafia, dal tratto quantizzato al
// contorno (formato della scena, §5).
//
// Il tratto è il nastro che una punta larga `size` e spessa `tip` lascia
// passando sui campioni. A ogni campione la punta è un segmento centrato sul
// punto, lungo la larghezza del momento e girato dell'angolo del momento; il
// contorno è il lato sinistro in avanti e il destro all'indietro, e si chiude
// con le stesse curve di `pf1` (`outlinePath`). Dove il tratto corre lungo la
// punta il nastro resta largo almeno `tip`.
//
// Passi, con i campioni in unità (gli interi di `fub:ink` divisi per la scala):
//
// 1. inseguimento: q₀ = p₀, qᵢ = qᵢ₋₁ + (pᵢ − qᵢ₋₁)·(1 − 0,9·streamline); un
//    tratto concluso finisce sull'ultimo campione;
// 2. direzione: l'angolo di qᵢ₊₁ − qᵢ₋₁ (agli estremi il vicino che c'è),
//    levigato con sᵢ = sᵢ₋₁ + (dᵢ − sᵢ₋₁)·(1 − 0,9·smoothing) sull'angolo
//    srotolato;
// 3. angolo della punta: `angle`, o l'azimut del campione più 90° se `tilt=1`
//    e il tratto ha l'inclinazione, più (1 − fixation)·sᵢ;
// 4. larghezza: size·(1 − thinning·(1 − pressione)), con la pressione 1 se
//    `sim=1` o se il tratto non la porta; mai meno di `tip`.
//
// Un tratto di un campione è la punta ferma: un rettangolo largo la punta e
// spesso `tip`.

import { checkNib1, type Nib1Brush } from "./brush";
import { outlinePath, type OutlinePoint, type Pf1Options } from "./pf1";
import { INK_MAX_SAMPLES, PRESSURE_STEPS, type QuantizedInk } from "./sample";

const DEGREES = Math.PI / 180;

function checkInk(ink: QuantizedInk): void {
  if (ink.scale !== 10 && ink.scale !== 100) throw new RangeError(`scala di fub:ink non valida: ${ink.scale}`);
  if (ink.samples.length > INK_MAX_SAMPLES) {
    throw new RangeError(`un tratto ha al massimo ${INK_MAX_SAMPLES} campioni: ${ink.samples.length}`);
  }
  for (const sample of ink.samples) {
    if (!Number.isSafeInteger(sample.x) || !Number.isSafeInteger(sample.y)) {
      throw new RangeError(`campione non quantizzato: ${sample.x}, ${sample.y}`);
    }
  }
}

/// Il poligono del contorno di `nib1`, non arrotondato.
export function nib1Outline(ink: QuantizedInk, brush: Nib1Brush, options: Pf1Options = {}): OutlinePoint[] {
  checkNib1(brush);
  checkInk(ink);
  const { scale, samples } = ink;
  if (samples.length === 0) return [];
  const follow = 1 - 0.9 * brush.streamline;
  const level = 1 - 0.9 * brush.smoothing;
  const last = options.last ?? true;
  // 1. I punti inseguiti, coi campioni da cui vengono; i doppioni sono uno.
  const xs: number[] = [];
  const ys: number[] = [];
  const from: number[] = [];
  let qx = samples[0]!.x / scale;
  let qy = samples[0]!.y / scale;
  const push = (x: number, y: number, i: number): void => {
    const n = xs.length;
    if (n > 0 && xs[n - 1] === x && ys[n - 1] === y) return;
    xs.push(x);
    ys.push(y);
    from.push(i);
  };
  push(qx, qy, 0);
  for (let i = 1; i < samples.length; i++) {
    qx += (samples[i]!.x / scale - qx) * follow;
    qy += (samples[i]!.y / scale - qy) * follow;
    push(qx, qy, i);
  }
  if (last && samples.length > 1) {
    const end = samples[samples.length - 1]!;
    push(end.x / scale, end.y / scale, samples.length - 1);
  }
  const n = xs.length;
  const width = (i: number): number => {
    const sample = samples[from[i]!]!;
    const pressure = brush.sim || sample.p === undefined ? 1 : sample.p / PRESSURE_STEPS;
    return Math.max(brush.tip, brush.size * (1 - brush.thinning * (1 - pressure)));
  };
  const nibAngle = (i: number, direction: number): number => {
    const sample = samples[from[i]!]!;
    const base = brush.tilt && sample.z !== undefined ? sample.z + 90 : brush.angle;
    return base * DEGREES + (1 - brush.fixation) * direction;
  };
  if (n === 1) {
    const theta = nibAngle(0, 0);
    const half = width(0) / 2;
    const [vx, vy] = [Math.cos(theta) * half, Math.sin(theta) * half];
    const [mx, my] = [-Math.sin(theta) * (brush.tip / 2), Math.cos(theta) * (brush.tip / 2)];
    return [
      [xs[0]! + vx + mx, ys[0]! + vy + my],
      [xs[0]! + vx - mx, ys[0]! + vy - my],
      [xs[0]! - vx - mx, ys[0]! - vy - my],
      [xs[0]! - vx + mx, ys[0]! - vy + my],
    ];
  }
  // 2. La direzione levigata, srotolata perché non salti a ±π.
  const left: OutlinePoint[] = [];
  const right: OutlinePoint[] = [];
  let smooth = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let direction = Math.atan2(ys[b]! - ys[a]!, xs[b]! - xs[a]!);
    if (i === 0) {
      smooth = direction;
    } else {
      while (direction - smooth > Math.PI) direction -= 2 * Math.PI;
      while (direction - smooth < -Math.PI) direction += 2 * Math.PI;
      smooth += (direction - smooth) * level;
    }
    // 3. e 4. La punta del momento, e lo spessore minimo di taglio.
    const theta = nibAngle(i, smooth);
    const half = width(i) / 2;
    const vx = Math.cos(theta) * half;
    const vy = Math.sin(theta) * half;
    let nx = -Math.sin(smooth) * (brush.tip / 2);
    let ny = Math.cos(smooth) * (brush.tip / 2);
    if (nx * vx + ny * vy < 0) {
      nx = -nx;
      ny = -ny;
    }
    left.push([xs[i]! + vx + nx, ys[i]! + vy + ny]);
    right.push([xs[i]! - vx - nx, ys[i]! - vy - ny]);
  }
  return [...left, ...right.reverse()];
}

/// `d` di un tratto con la punta piatta.
export function nib1(ink: QuantizedInk, brush: Nib1Brush, options: Pf1Options = {}): string {
  return outlinePath(nib1Outline(ink, brush, options));
}
