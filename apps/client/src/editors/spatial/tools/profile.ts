// Il profilo di un contorno a spessore variabile, senza DOM: i profili
// pronti, i punti che lo strumento Spessore aggiunge, allarga, sposta e
// toglie, la linea centrale misurata, e il contorno pieno che il file scrive
// in `d`. Il formato è in `scene/varwidth.ts`, il contorno in `offset.ts`.
//
// - **Lo spessore di un profilo** è la larghezza più grande fra i suoi
//   punti, da un lato all'altro: quello che il pannello mostra, e che
//   cambiato allarga o stringe tutto il profilo nella stessa proporzione.
// - **I punti si misurano lungo la linea**, dalla sua lunghezza: spostare i
//   nodi della linea lascia ogni punto alla stessa frazione del percorso.
// - **Il `d` viene dalla geometria scritta**, riletta: chi rifà il contorno
//   da `fub:geom` trova lo stesso tracciato.

import { pointAt, type Curve } from "../scene/curves";
import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { AT_DECIMALS, readVarWidth, spineOf, widthsAt, widthSpans, writeVarWidth, type WidthCap, type WidthJoin, type WidthPoint } from "../scene/varwidth";
import { profileArea, type Refusal } from "./offset";

/// Un contorno a spessore variabile da scrivere: gli estremi, gli angoli, il
/// profilo e la linea centrale, nelle coordinate della forma.
export interface WidthShape {
  readonly cap: WidthCap;
  readonly join: WidthJoin;
  readonly profile: readonly WidthPoint[];
  readonly spine: readonly Segment[];
}

/// I profili pronti del menu del contorno.
export type Preset = "uniform" | "taper" | "drop" | "spindle";

export const PRESETS: readonly Preset[] = ["uniform", "taper", "drop", "spindle"];

/// La distanza minima fra due punti del profilo, perché scritti restino
/// distinti.
const GAP = 1 / 10 ** AT_DECIMALS;

/// Il profilo pronto `preset` largo al più `width`: uniforme; affusolato,
/// pieno all'inizio e a punta alla fine; a goccia, che cresce dalla punta
/// fino alla fine; a fuso, a punta ai due capi e pieno in mezzo.
export function presetProfile(preset: Preset, width: number): WidthPoint[] {
  const h = width / 2;
  switch (preset) {
    case "uniform":
      return [
        [0, h, h],
        [1, h, h],
      ];
    case "taper":
      return [
        [0, h, h],
        [1, 0, 0],
      ];
    case "drop":
      return [
        [0, 0, 0],
        [0.5, 0.75 * h, 0.75 * h],
        [1, h, h],
      ];
    case "spindle":
      return [
        [0, 0, 0],
        [0.5, h, h],
        [1, 0, 0],
      ];
  }
}

/// Il profilo pronto che `profile` è, al suo spessore e coi numeri come li
/// scrive il file; `null` se non è nessuno.
export function presetOf(profile: readonly WidthPoint[]): Preset | null {
  const width = profileWidth(profile);
  // Una larghezza scritta sbaglia al più di mezzo centesimo, e una
  // posizione di mezzo decimillesimo.
  const near = (a: WidthPoint, b: WidthPoint): boolean => Math.abs(a[0] - b[0]) <= GAP && Math.abs(a[1] - b[1]) <= 0.006 && Math.abs(a[2] - b[2]) <= 0.006;
  return PRESETS.find((preset) => {
    const expected = presetProfile(preset, width);
    return expected.length === profile.length && expected.every((point, k) => near(point, profile[k]!));
  }) ?? null;
}

/// Lo spessore di `profile`: la larghezza più grande fra i suoi punti, da un
/// lato all'altro.
export const profileWidth = (profile: readonly WidthPoint[]): number => Math.max(0, ...profile.map(([, left, right]) => left + right));

/// Lo spessore di `profile` se è uniforme, uguale ai due lati lungo tutta la
/// linea; altrimenti `null`.
export function uniformWidth(profile: readonly WidthPoint[]): number | null {
  const [, h] = profile[0]!;
  return profile.every(([, left, right]) => left === h && right === h) ? 2 * h : null;
}

/// `profile` con le larghezze moltiplicate per `k`.
export const scaledProfile = (profile: readonly WidthPoint[], k: number): WidthPoint[] => profile.map(([at, left, right]) => [at, left * k, right * k]);

/// `profile` rovesciato lungo la linea: l'inizio va alla fine, e ogni lato
/// resta dalla sua parte.
export const flippedProfile = (profile: readonly WidthPoint[]): WidthPoint[] => [...profile].reverse().map(([at, left, right]) => [1 - at, left, right]);

/// `profile` coi lati scambiati.
export const swappedProfile = (profile: readonly WidthPoint[]): WidthPoint[] => profile.map(([at, left, right]) => [at, right, left]);

/// `profile` con un punto in `at`, con le larghezze che aveva lì, e il suo
/// indice. Un punto che c'è già, a meno della distanza minima, resta lui.
export function withPoint(profile: readonly WidthPoint[], at: number): { readonly profile: WidthPoint[]; readonly index: number } {
  const near = profile.findIndex(([place]) => Math.abs(place - at) < GAP);
  if (near >= 0) return { profile: [...profile], index: near };
  const index = profile.findIndex(([place]) => place > at);
  const [left, right] = widthsAt(profile, at);
  const out = [...profile];
  out.splice(index, 0, [at, left, right]);
  return { profile: out, index };
}

/// `profile` col punto `index` largo `left` a sinistra e `right` a destra,
/// mai meno di zero.
export function withWidths(profile: readonly WidthPoint[], index: number, left: number, right: number): WidthPoint[] {
  const out = [...profile];
  out[index] = [profile[index]![0], Math.max(0, left), Math.max(0, right)];
  return out;
}

/// `profile` col punto `index` spostato in `at`, fra i suoi vicini; i capi
/// non si spostano.
export function movedPoint(profile: readonly WidthPoint[], index: number, at: number): WidthPoint[] {
  if (index <= 0 || index >= profile.length - 1) return [...profile];
  const [low, high] = [profile[index - 1]![0] + GAP, profile[index + 1]![0] - GAP];
  if (!(low <= high)) return [...profile];
  const out = [...profile];
  const [, left, right] = profile[index]!;
  out[index] = [Math.min(high, Math.max(low, at)), left, right];
  return out;
}

/// `profile` senza il punto `index`; `null` per un capo, o se senza di lui
/// non resta una larghezza.
export function withoutPoint(profile: readonly WidthPoint[], index: number): WidthPoint[] | null {
  if (index <= 0 || index >= profile.length - 1) return null;
  const out = profile.filter((_, k) => k !== index);
  return out.some(([, left, right]) => left > 0 || right > 0) ? out : null;
}

// ---------------------------------------------------------------------------
// La linea centrale.
// ---------------------------------------------------------------------------

/// Le parti in cui si misura una curva.
const PARTS = 64;

/// Dove un punto è più vicino alla linea centrale: la frazione della
/// lunghezza, il punto, il verso della linea lì, la distanza, e da che
/// parte sta: 1 a destra di chi percorre la linea sullo schermo, -1 a
/// sinistra.
export interface SpineSpot {
  readonly u: number;
  readonly at: Point;
  readonly along: Point;
  readonly distance: number;
  readonly side: 1 | -1;
}

/// La linea centrale come spezzata fitta, con la lunghezza fino a ogni
/// punto: dove sta un punto del profilo, e dove la linea passa più vicina
/// a un punto.
export class SpineMeasure {
  private readonly points: Point[] = [];
  private readonly lengths: number[] = [];

  constructor(spine: readonly Segment[]) {
    let start: Point = [0, 0];
    let current: Point = [0, 0];
    const push = (p: Point): void => {
      const last = this.points[this.points.length - 1];
      this.lengths.push(last === undefined ? 0 : this.lengths[this.lengths.length - 1]! + Math.hypot(p[0] - last[0], p[1] - last[1]));
      this.points.push(p);
    };
    const curve = (c: Curve): void => {
      const parts = c.kind === "line" ? 1 : PARTS;
      for (let k = 1; k <= parts; k++) push(k === parts ? c.to : pointAt(current, c, k / parts));
      current = c.to;
    };
    for (const segment of spine) {
      if (segment.kind === "move") {
        if (this.points.length > 0) break;
        start = current = segment.to;
        push(current);
      } else if (segment.kind === "close") {
        if (current[0] !== start[0] || current[1] !== start[1]) curve({ kind: "line", to: start });
      } else {
        curve(segment);
      }
    }
    // Una linea che non va da nessuna parte ha comunque un pezzo, e un verso.
    if (this.points.length === 1) push(this.points[0]!);
  }

  /// La lunghezza della linea.
  get total(): number {
    return this.lengths[this.lengths.length - 1] ?? 0;
  }

  /// Il punto della linea alla frazione `u` della lunghezza, e il verso lì.
  placeAt(u: number): { readonly at: Point; readonly along: Point } {
    const s = Math.min(1, Math.max(0, u)) * this.total;
    let k = 1;
    while (k < this.lengths.length - 1 && this.lengths[k]! < s) k++;
    return this.on(k, s);
  }

  /// Dove la linea passa più vicina a `p`.
  spotAt(p: Point): SpineSpot {
    let best = { k: 1, s: 0, distance: Infinity };
    for (let k = 1; k < this.points.length; k++) {
      const [a, b] = [this.points[k - 1]!, this.points[k]!];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const squared = dx * dx + dy * dy;
      const t = squared === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared));
      const distance = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
      if (distance < best.distance) best = { k, s: this.lengths[k - 1]! + t * Math.sqrt(squared), distance };
    }
    const { at, along } = this.on(best.k, best.s);
    const cross = along[0] * (p[1] - at[1]) - along[1] * (p[0] - at[0]);
    return { u: this.total > 0 ? best.s / this.total : 0, at, along, distance: best.distance, side: cross >= 0 ? 1 : -1 };
  }

  /// Il punto alla lunghezza `s` sul pezzo `k`, e il suo verso.
  private on(k: number, s: number): { readonly at: Point; readonly along: Point } {
    const [a, b] = [this.points[k - 1]!, this.points[k]!];
    const part = this.lengths[k]! - this.lengths[k - 1]!;
    const t = part > 0 ? Math.min(1, Math.max(0, (s - this.lengths[k - 1]!) / part)) : 0;
    const at: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { at, along: part > 0 ? [(b[0] - a[0]) / part, (b[1] - a[1]) / part] : [1, 0] };
  }
}

/// Il verso verso destra di chi percorre la linea col verso `along`, sullo
/// schermo, dove l'asse y scende.
export const rightOf = (along: Point): Point => [-along[1], along[0]];

// ---------------------------------------------------------------------------
// Il contorno.
// ---------------------------------------------------------------------------

/// Il contorno pieno di `shape`, come tracciato.
export const widthOutline = (shape: WidthShape): Segment[] | Refusal => profileArea(shape.spine, widthSpans(shape.profile), { cap: shape.cap, join: shape.join });

/// `fub:geom` e `d` di `shape`, coi numeri del formato: il contorno viene
/// dalla geometria scritta e riletta. `null` se non si scrive, o se il
/// contorno non riesce o non dipinge niente.
export function widthAttrs(shape: WidthShape): { readonly geom: string; readonly d: string } | null {
  const geom = writeVarWidth(shape.cap, shape.join, shape.profile, shape.spine);
  const written = geom === null ? null : readVarWidth(geom);
  if (geom === null || written === null) return null;
  const outline = widthOutline({ cap: written.cap, join: written.join, profile: written.profile, spine: spineOf(written) });
  if (typeof outline === "string" || outline.length === 0) return null;
  return { geom, d: pathData(outline) };
}
