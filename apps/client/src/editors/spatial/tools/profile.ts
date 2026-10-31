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

import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { readVarWidth, spineOf, widthSpans, writeVarWidth, type WidthCap, type WidthJoin, type WidthPoint } from "../scene/varwidth";
import { profileArea, type Refusal } from "./offset";

/// Un contorno a spessore variabile da scrivere: gli estremi, gli angoli, il
/// profilo e la linea centrale, nelle coordinate della forma.
export interface WidthShape {
  readonly cap: WidthCap;
  readonly join: WidthJoin;
  readonly profile: readonly WidthPoint[];
  readonly spine: readonly Segment[];
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

// ---------------------------------------------------------------------------
// La linea centrale.
// ---------------------------------------------------------------------------

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
