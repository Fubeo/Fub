// I pezzi dei segni della griglia, per zona: funzioni pure, senza DOM.
//
// La griglia sta in un piano grande quanto il foglio (`.grid-plane`), e le
// fasce ferme (la testa in alto, la colonna a sinistra) ci restano al loro
// posto col solo `sticky`. Il piano ha quattro zone, ognuna col suo livello
// dei segni:
//
// - `body`, il corpo: scorre nei due versi;
// - `top`, la testa (le intestazioni delle colonne e le righe bloccate):
//   scorre solo di lato;
// - `left`, la colonna ferma (le intestazioni delle righe e le colonne
//   bloccate): scorre solo in giù;
// - `corner`, l'angolo dove si incontrano: non scorre.
//
// Un segno è un rettangolo nelle coordinate del piano. Un rettangolo che cade
// in più zone si taglia in un pezzo per zona (`rectPieces`), nelle coordinate
// del livello di quella zona; le fasce opache coprono ciò che passa loro
// sotto. Un segno d'angolo (il quadratino, le maniglie del tocco) invece non
// si taglia: è un pezzo solo, intero, nel livello della zona del suo angolo
// (`cornerZone`), e la fascia ferma ne copre ciò che le passa sotto.

/// Le quattro zone del piano.
export type Zone = "body" | "top" | "left" | "corner";

export const ZONES: readonly Zone[] = ["body", "top", "left", "corner"];

/// Un rettangolo, in pixel.
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/// La misura delle fasce ferme, nelle coordinate del piano: `top` è l'altezza
/// della testa (le intestazioni delle colonne più le righe bloccate), `left`
/// la larghezza della colonna ferma (le intestazioni delle righe più le
/// colonne bloccate). Il filo del blocco sta sull'ultimo pixel di ognuna.
export interface Bands {
  readonly top: number;
  readonly left: number;
}

/// I lati di un pezzo che il bordo della sua zona ha tagliato.
export interface Cut {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

/// Un pezzo di un segno: la zona, il rettangolo nelle coordinate del suo
/// livello e i lati tagliati.
export interface Piece {
  readonly zone: Zone;
  readonly rect: Rect;
  readonly cut: Cut;
}

export interface ClipOptions {
  /// Una fascia delle intestazioni arriva al bordo della zona; un lato del
  /// rettangolo si ferma un pixel prima, per lasciare scoperto il filo.
  readonly band?: boolean;
  /// Di quanto un lato tagliato passa oltre il taglio: il livello lo taglia
  /// al bordo della sua zona, e un segno col bordo non mostra un lato dove la
  /// zona lo ha tagliato.
  readonly bleed?: number;
}

const NO_CUT: Cut = { top: false, right: false, bottom: false, left: false };

/// Lo scostamento del livello di `zone` dall'origine del piano: il livello
/// della colonna ferma comincia sotto la testa.
export function layerOrigin(zone: Zone, bands: Bands): { readonly x: number; readonly y: number } {
  return { x: 0, y: zone === "left" ? bands.top : 0 };
}

/// Le zone che il rettangolo tocca, nelle coordinate del piano. Il pezzo del
/// corpo c'è solo se il rettangolo arriva oltre le due fasce: ciò che sta
/// tutto in una fascia ferma, nel corpo starebbe sempre sotto di lei.
function zonesOf(rect: Rect, bands: Bands): Zone[] {
  const before = { x: rect.x < bands.left, y: rect.y < bands.top };
  const after = { x: rect.x + rect.w > bands.left, y: rect.y + rect.h > bands.top };
  const out: Zone[] = [];
  if (after.x && after.y) out.push("body");
  if (before.y && after.x) out.push("top");
  if (before.x && after.y) out.push("left");
  if (before.x && before.y) out.push("corner");
  return out;
}

/// Il rettangolo `rect` (coordinate del piano) tagliato alla zona `zone`,
/// nelle coordinate del suo livello; `null` se nella zona non c'è. Il corpo
/// non taglia: le fasce ferme, opache e sopra di lui, coprono ciò che passa
/// loro sotto. La testa e la colonna ferma tagliano dove finiscono, un pixel
/// prima del filo del blocco; la colonna ferma comincia sotto la testa.
export function clipRect(zone: Zone, rect: Rect, bands: Bands, options: ClipOptions = {}): Piece | null {
  const band = options.band ?? false;
  const bleed = Math.max(0, options.bleed ?? 0);
  const capY = zone === "top" || zone === "corner" ? (band ? bands.top : bands.top - 1) : Infinity;
  const capX = zone === "left" || zone === "corner" ? (band ? bands.left : bands.left - 1) : Infinity;
  const floorY = zone === "left" ? bands.top : -Infinity;
  const x1 = rect.x;
  const y1 = Math.max(rect.y, floorY);
  const x2 = Math.min(rect.x + Math.max(0, rect.w), capX);
  const y2 = Math.min(rect.y + Math.max(0, rect.h), capY);
  if (x2 <= x1 || y2 <= y1) return null;
  const cut: Cut = {
    top: y1 > rect.y,
    right: x2 < rect.x + rect.w,
    bottom: y2 < rect.y + rect.h,
    left: false,
  };
  const top = cut.top ? y1 - bleed : y1;
  const right = cut.right ? x2 + bleed : x2;
  const bottom = cut.bottom ? y2 + bleed : y2;
  const origin = layerOrigin(zone, bands);
  return { zone, rect: { x: x1 - origin.x, y: top - origin.y, w: right - x1, h: bottom - top }, cut };
}

/// I pezzi del rettangolo `rect` (coordinate del piano), uno per zona che
/// tocca, già tagliati. Senza righe né colonne bloccate e senza intestazioni
/// il rettangolo è un pezzo solo, nel corpo.
export function rectPieces(rect: Rect, bands: Bands, options: ClipOptions = {}): Piece[] {
  if (!(rect.w > 0 && rect.h > 0)) return [];
  const out: Piece[] = [];
  for (const zone of zonesOf(rect, bands)) {
    const piece = clipRect(zone, rect, bands, options);
    if (piece) out.push(piece);
  }
  return out;
}

/// La zona di un angolo (x, y) del piano. Un angolo che apre un rettangolo
/// (`start`: in alto o a sinistra) sta nella zona della cella dopo di lui, uno
/// che lo chiude in quella della cella prima: sul filo del blocco l'angolo
/// d'inizio di B2 è del corpo, quello di fine di A1 della fascia ferma.
export function cornerZone(x: number, y: number, start: boolean, bands: Bands): Zone {
  const fx = start ? x < bands.left : x <= bands.left;
  const fy = start ? y < bands.top : y <= bands.top;
  return fx && fy ? "corner" : fy ? "top" : fx ? "left" : "body";
}

/// Dove si vede nel riquadro l'angolo (x, y) del piano, scorso di `scroll`:
/// nelle coordinate del riquadro, con la sua zona; `null` se è passato sotto
/// una fascia ferma.
export function cornerSeen(
  x: number,
  y: number,
  start: boolean,
  bands: Bands,
  scroll: { readonly left: number; readonly top: number },
): { readonly x: number; readonly y: number; readonly zone: Zone } | null {
  const zone = cornerZone(x, y, start, bands);
  const sx = zone === "left" || zone === "corner" ? x : x - scroll.left;
  const sy = zone === "top" || zone === "corner" ? y : y - scroll.top;
  if ((zone === "body" || zone === "top") && sx < bands.left - 0.5) return null;
  if ((zone === "body" || zone === "left") && sy < bands.top - 0.5) return null;
  return { x: sx, y: sy, zone };
}

/// Il pezzo intero `rect` (coordinate del piano) nelle coordinate del
/// livello di `zone`, senza tagli: così si mette un segno d'angolo.
export function wholeRect(zone: Zone, rect: Rect, bands: Bands): Rect {
  const origin = layerOrigin(zone, bands);
  return { x: rect.x - origin.x, y: rect.y - origin.y, w: rect.w, h: rect.h };
}

/// Un segno d'angolo: un pezzo solo, intero, nel livello della zona del suo
/// angolo (x, y). `rect` è il segno nelle coordinate del piano.
export function cornerPiece(rect: Rect, corner: { readonly x: number; readonly y: number; readonly start: boolean }, bands: Bands): Piece {
  const zone = cornerZone(corner.x, corner.y, corner.start, bands);
  return { zone, rect: wholeRect(zone, rect, bands), cut: NO_CUT };
}
