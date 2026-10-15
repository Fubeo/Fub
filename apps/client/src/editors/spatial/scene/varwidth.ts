// Lo spessore variabile: un contorno che si allarga e si stringe lungo la sua
// linea, la forma sintetica `fub:shape="width"` (formato della scena, §6).
// `fub:geom` porta gli estremi, gli angoli, il profilo delle larghezze e la
// linea centrale; `d` è il contorno pieno, che ogni lettore disegna, e lo
// calcola `tools/offset.ts`.
//
// - **La lettura vuole la grammatica intera:** estremi e angoli seguiti da
//   spazi, il profilo fino alla prima `M` o `m`, e da lì la linea centrale,
//   un sottotracciato solo che disegna qualcosa. Altrimenti resta un
//   tracciato qualunque, che si legge da `d`.
// - **Il profilo** è una fila di terne `t sinistra destra`: dove sta il
//   punto lungo la linea, in frazione della lunghezza, e quanto il contorno
//   si allarga a sinistra e a destra di chi la percorre sullo schermo. Il
//   primo punto sta a 0, l'ultimo a 1; due punti con lo stesso `t` sono uno
//   scalino, mai ai capi.
// - **Fra due punti** ogni lato segue l'interpolazione monotona a tratti di
//   Fritsch e Carlson, quella di `pchip`: la larghezza cambia senza spigoli
//   e non esce mai dai valori dei due punti, così un profilo che va a zero
//   non diventa negativo e uno piatto resta piatto.

import { formatNumber } from "../number";
import { parsePath, type Segment } from "./geometry";
import { pathData } from "./serialize";
import { isWsp, numberList } from "./values";

/// Come finisce il contorno ai capi di una linea centrale aperta.
export type WidthCap = "butt" | "round" | "square";
/// Come gira il contorno, dalla parte di fuori, negli spigoli della linea.
export type WidthJoin = "miter" | "round" | "bevel";

export const WIDTH_CAPS: readonly WidthCap[] = ["butt", "round", "square"];
export const WIDTH_JOINS: readonly WidthJoin[] = ["miter", "round", "bevel"];

/// Un punto del profilo: dove sta lungo la linea, da 0 a 1, e la larghezza
/// a sinistra e a destra di chi la percorre sullo schermo.
export type WidthPoint = readonly [at: number, left: number, right: number];

/// Un contorno a spessore variabile, come lo porta `fub:geom`.
export interface VarWidth {
  readonly cap: WidthCap;
  readonly join: WidthJoin;
  readonly profile: readonly WidthPoint[];
  /// La linea centrale, com'è scritta.
  readonly spine: string;
}

/// I punti del profilo, al meno e al più.
export const MIN_POINTS = 2;
export const MAX_POINTS = 1000;

/// I decimali della posizione di un punto del profilo; le larghezze ne hanno
/// due, come la geometria.
export const AT_DECIMALS = 4;

/// Il profilo, se rispetta la grammatica.
function readProfile(text: string): WidthPoint[] | null {
  const numbers = numberList(text);
  if (numbers === null || numbers.length % 3 !== 0) return null;
  const points: WidthPoint[] = [];
  for (let i = 0; i < numbers.length; i += 3) points.push([numbers[i]!, numbers[i + 1]!, numbers[i + 2]!]);
  const count = points.length;
  if (count < MIN_POINTS || count > MAX_POINTS) return null;
  if (points[0]![0] !== 0 || points[count - 1]![0] !== 1) return null;
  if (points[1]![0] === 0 || points[count - 2]![0] === 1) return null;
  let positive = false;
  for (let k = 0; k < count; k++) {
    const [at, left, right] = points[k]!;
    if (!(at >= 0 && at <= 1 && left >= 0 && right >= 0)) return null;
    positive ||= left > 0 || right > 0;
    if (k > 0 && at < points[k - 1]![0]) return null;
    if (k > 1 && at === points[k - 1]![0] && at === points[k - 2]![0]) return null;
  }
  return positive ? points : null;
}

/// Vero se `segments` sono un sottotracciato solo che disegna qualcosa: una
/// `M` in testa e nessun'altra, una `Z` al più in fondo, e un segmento che va
/// da qualche parte. Un arco coi capi uguali non disegna niente.
function oneDrawnSubpath(segments: readonly Segment[]): boolean {
  const first = segments[0];
  if (first?.kind !== "move") return false;
  const start = first.to;
  let current = start;
  let drawn = false;
  const away = (p: readonly [number, number]): boolean => p[0] !== current[0] || p[1] !== current[1];
  for (let k = 1; k < segments.length; k++) {
    const segment = segments[k]!;
    switch (segment.kind) {
      case "move":
        return false;
      case "close":
        if (k !== segments.length - 1) return false;
        drawn ||= away(start);
        current = start;
        break;
      case "line":
      case "arc":
        drawn ||= away(segment.to);
        current = segment.to;
        break;
      case "quad":
        drawn ||= away(segment.control) || away(segment.to);
        current = segment.to;
        break;
      case "cubic":
        drawn ||= away(segment.c1) || away(segment.c2) || away(segment.to);
        current = segment.to;
        break;
    }
  }
  return drawn;
}

/// Una parola di `text` da `i`, fino al primo spazio, e dove comincia ciò che
/// la segue dopo gli spazi; `null` se non la seguono spazi.
function word(text: string, i: number): [string, number] | null {
  let end = i;
  while (end < text.length && !isWsp(text.charCodeAt(end))) end++;
  if (end === text.length) return null;
  let next = end;
  while (next < text.length && isWsp(text.charCodeAt(next))) next++;
  return [text.slice(i, end), next];
}

/// La geometria di un `path` con `fub:shape="width"` e `fub:geom` `geom`;
/// `null` se `geom` è fuori dalla grammatica.
export function readVarWidth(geom: string): VarWidth | null {
  let i = 0;
  while (i < geom.length && isWsp(geom.charCodeAt(i))) i++;
  const first = word(geom, i);
  if (first === null) return null;
  const second = word(geom, first[1]);
  if (second === null) return null;
  const cap = WIDTH_CAPS.find((value) => value === first[0]);
  const join = WIDTH_JOINS.find((value) => value === second[0]);
  if (cap === undefined || join === undefined) return null;
  const rest = geom.slice(second[1]);
  const at = rest.search(/[Mm]/);
  if (at < 0) return null;
  const profile = readProfile(rest.slice(0, at));
  const spine = rest.slice(at);
  const segments = parsePath(spine);
  if (profile === null || segments === null || !oneDrawnSubpath(segments)) return null;
  return { cap, join, profile, spine };
}

/// I segmenti della linea centrale di `v`, che la lettura ha già controllato.
export const spineOf = (v: VarWidth): Segment[] => parsePath(v.spine) ?? [];

/// Il profilo come lo scrive FubDraw: le posizioni con quattro decimali fra
/// 0 e 1, senza tornare indietro, la prima 0 e l'ultima 1; le larghezze con
/// due, non negative. Un punto che arrotondato cade su un capo, o in mezzo a
/// due con la sua stessa posizione, se ne va. `null` se resta meno di due
/// punti o nessuna larghezza positiva.
export function writtenProfile(profile: readonly WidthPoint[]): WidthPoint[] | null {
  if (profile.length < MIN_POINTS) return null;
  const round = (value: number, decimals: number): number => Number(formatNumber(value, decimals));
  const last = profile.length - 1;
  let previous = 0;
  const rounded: WidthPoint[] = profile.map(([at, left, right], k) => {
    const place = k === 0 ? 0 : k === last ? 1 : Math.max(previous, Math.min(1, round(at, AT_DECIMALS)));
    previous = place;
    return [place, Math.max(0, round(left, 2)), Math.max(0, round(right, 2))];
  });
  const inner = rounded.filter((point, k) => k === 0 || k === last || (point[0] > 0 && point[0] < 1));
  const out = inner.filter((point, k) => !(k > 0 && k < inner.length - 1 && inner[k - 1]![0] === point[0] && inner[k + 1]![0] === point[0]));
  if (out.length > MAX_POINTS || !out.some(([, left, right]) => left > 0 || right > 0)) return null;
  return out;
}

/// `fub:geom` di un contorno con gli estremi `cap`, gli angoli `join`, il
/// profilo `profile` e la linea `spine`, coi numeri del formato; `null` se
/// scritto non si rilegge, come una linea che al centesimo resta ferma.
export function writeVarWidth(cap: WidthCap, join: WidthJoin, profile: readonly WidthPoint[], spine: readonly Segment[]): string | null {
  const points = writtenProfile(profile);
  if (points === null) return null;
  const numbers = points.map(([at, left, right]) => `${formatNumber(at, AT_DECIMALS)} ${formatNumber(left, 2)} ${formatNumber(right, 2)}`);
  const geom = `${cap} ${join} ${numbers.join(" ")} ${pathData(spine)}`;
  return readVarWidth(geom) === null ? null : geom;
}

// ---------------------------------------------------------------------------
// Le larghezze lungo la linea.
// ---------------------------------------------------------------------------

/// Le cubiche di Hermite di un lato fra due punti: le larghezze ai capi e
/// le pendenze, per unità di `t`.
type Hermite = readonly [w0: number, w1: number, m0: number, m1: number];

/// Un tratto del profilo fra due punti con posizioni diverse.
export interface WidthSpan {
  readonly t0: number;
  readonly t1: number;
  readonly left: Hermite;
  readonly right: Hermite;
}

/// Le pendenze di `pchip` nei punti `ts` di larghezze `ws`, con `ts`
/// crescenti: nei punti di mezzo la media armonica pesata delle secanti,
/// zero dove la larghezza cambia verso o si ferma; ai capi la formula a tre
/// punti, che non va contro la secante e non supera tre volte la secante
/// dove il verso cambia. Con due punti, la secante.
function pchipSlopes(ts: readonly number[], ws: readonly number[]): number[] {
  const n = ts.length;
  const h = ts.slice(1).map((t, k) => t - ts[k]!);
  const d = h.map((step, k) => (ws[k + 1]! - ws[k]!) / step);
  if (n === 2) return [d[0]!, d[0]!];
  const m = new Array<number>(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    const [before, after] = [d[k - 1]!, d[k]!];
    if (Math.sign(before) * Math.sign(after) <= 0) continue;
    const w1 = 2 * h[k]! + h[k - 1]!;
    const w2 = h[k]! + 2 * h[k - 1]!;
    m[k] = (w1 + w2) / (w1 / before + w2 / after);
  }
  const end = (h0: number, h1: number, d0: number, d1: number): number => {
    const slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(slope) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(slope) > Math.abs(3 * d0)) return 3 * d0;
    return slope;
  };
  m[0] = end(h[0]!, h[1]!, d[0]!, d[1]!);
  m[n - 1] = end(h[n - 2]!, h[n - 3]!, d[n - 2]!, d[n - 3]!);
  return m;
}

/// I tratti di `profile`: i punti si dividono negli scalini, e ogni fila fra
/// due scalini ha le sue pendenze.
export function widthSpans(profile: readonly WidthPoint[]): WidthSpan[] {
  const runs: WidthPoint[][] = [[profile[0]!]];
  for (const point of profile.slice(1)) {
    const run = runs[runs.length - 1]!;
    if (point[0] === run[run.length - 1]![0]) runs.push([point]);
    else run.push(point);
  }
  const spans: WidthSpan[] = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    const ts = run.map((point) => point[0]);
    const left = pchipSlopes(ts, run.map((point) => point[1]));
    const right = pchipSlopes(ts, run.map((point) => point[2]));
    for (let k = 0; k + 1 < run.length; k++) {
      const [a, b] = [run[k]!, run[k + 1]!];
      spans.push({ t0: a[0], t1: b[0], left: [a[1], b[1], left[k]!, left[k + 1]!], right: [a[2], b[2], right[k]!, right[k + 1]!] });
    }
  }
  return spans;
}

/// Il tratto di `spans` dove sta `t`: quello che comincia lì dopo uno
/// scalino, l'ultimo per `t` = 1.
export function spanAt(spans: readonly WidthSpan[], t: number): number {
  let [lo, hi] = [0, spans.length - 1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (spans[mid]!.t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function hermite([w0, w1, m0, m1]: Hermite, h: number, s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * w0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * w1 + (s3 - s2) * h * m1;
}

function hermiteSlope([w0, w1, m0, m1]: Hermite, h: number, s: number): number {
  const s2 = s * s;
  return ((6 * s2 - 6 * s) * w0 + (3 * s2 - 4 * s + 1) * h * m0 + (-6 * s2 + 6 * s) * w1 + (3 * s2 - 2 * s) * h * m1) / h;
}

/// Le larghezze a sinistra e a destra nel tratto `span` in `t`.
export function spanWidths(span: WidthSpan, t: number): [number, number] {
  const h = span.t1 - span.t0;
  const s = Math.min(1, Math.max(0, (t - span.t0) / h));
  return [Math.max(0, hermite(span.left, h, s)), Math.max(0, hermite(span.right, h, s))];
}

/// Quanto cambiano le larghezze nel tratto `span` in `t`, per unità di `t`.
export function spanSlopes(span: WidthSpan, t: number): [number, number] {
  const h = span.t1 - span.t0;
  const s = Math.min(1, Math.max(0, (t - span.t0) / h));
  return [hermiteSlope(span.left, h, s), hermiteSlope(span.right, h, s)];
}

/// Le larghezze a sinistra e a destra di `profile` in `t`, dopo lo scalino
/// se `t` ne ha uno.
export function widthsAt(profile: readonly WidthPoint[], t: number): [number, number] {
  const spans = widthSpans(profile);
  return spanWidths(spans[spanAt(spans, t)]!, t);
}
