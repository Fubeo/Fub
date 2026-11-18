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

/// Il rettangolo `rect` (coordinate del piano) schiacciato nella zona `zone`,
/// nelle coordinate del suo livello: per i fotogrammi di una corsa. Dove
/// `clipRect` dice che nella zona non c'è, qui il pezzo diventa una riga
/// vuota sul bordo della zona, da cui entra o in cui esce; così un pezzo che
/// passa il filo del blocco ne esce invece di comparire già grande.
export function looseRect(zone: Zone, rect: Rect, bands: Bands, band = false): Rect {
  const capY = zone === "top" || zone === "corner" ? (band ? bands.top : bands.top - 1) : Infinity;
  const capX = zone === "left" || zone === "corner" ? (band ? bands.left : bands.left - 1) : Infinity;
  const floorY = zone === "left" ? bands.top : -Infinity;
  const fitY = (y: number) => Math.min(capY, Math.max(floorY, y));
  const x1 = Math.min(capX, rect.x);
  const x2 = Math.min(capX, rect.x + Math.max(0, rect.w));
  const y1 = fitY(rect.y);
  const y2 = fitY(rect.y + Math.max(0, rect.h));
  const origin = layerOrigin(zone, bands);
  return { x: x1 - origin.x, y: y1 - origin.y, w: x2 - x1, h: y2 - y1 };
}

// ── I pezzi della selezione ──────────────────────────────────────────────
//
// I segni che scivolano si disegnano da dieci numeri, in coordinate del
// piano (`MarkGeometry`): il rettangolo della selezione, la cella attiva e
// l'angolo del quadratino. Sono i numeri a correre, non i pezzi: ogni pezzo
// si ricava da loro, così i lati, l'anello, il velo, le fasce e il
// quadratino restano attaccati in ogni fotogramma.

/// `[bL, bT, bR, bB, aL, aT, aR, aB, hR, hB]`: i bordi del rettangolo, quelli
/// della cella attiva e l'angolo in basso a destra del quadratino. Un bordo è
/// la prima coordinata dopo il filo: il filo di una cella sta sul suo ultimo
/// pixel, quindi il filo a sinistra di `bL` è `bL - 1`.
export type MarkGeometry = readonly number[];

/// Quanti numeri ha una `MarkGeometry`.
export const MARK_NUMBERS = 10;

/// Che cosa è un pezzo: dà il nome alla sua classe (`grid-mark-<kind>`).
/// `copy` e `cut` sono i lati del tratteggio di ciò che si è copiato o
/// tagliato, `ants` quelli delle formiche (il riempimento tirato o in attesa
/// del foglio, un taglio incollato), `flash` il velo del battito di una copia.
export type MarkKind = "edge" | "ring" | "veil" | "band-col" | "band-row" | "handle" | "freeze" | "copy" | "cut" | "ants" | "flash";

/// Un pezzo di un segno, nelle coordinate del piano.
export interface MarkPart {
  /// Il nome, unico fra i pezzi di un disegno: un pezzo con lo stesso nome è
  /// lo stesso elemento da un disegno all'altro.
  readonly name: string;
  readonly kind: MarkKind;
  /// Il verso di un lato: orizzontale o verticale.
  readonly dir?: "h" | "v";
  readonly rect: Rect;
  /// Le zone dove può cadere; di serie tutte.
  readonly zones?: readonly Zone[];
  /// Una fascia delle intestazioni arriva al bordo della zona, un lato si
  /// ferma un pixel prima del filo del blocco.
  readonly band?: boolean;
  /// Falso: il pezzo non ha un posto d'arrivo (l'anello e il velo di una
  /// cella sola), e si vede solo mentre esce o rientra.
  readonly rest?: boolean;
  /// Falso: non scivola, sta sempre al suo posto (i fili del blocco, i
  /// rettangoli degli altri intervalli, il tratteggio della copia).
  readonly glide?: boolean;
  /// Vero: quando non serve più esce con una dissolvenza in
  /// `DURATION.swap` invece di sparire (il contorno di un riempimento).
  readonly fade?: boolean;
  /// Un segno d'angolo non si taglia: è intero nel livello «lift» della zona
  /// di questo angolo.
  readonly corner?: { readonly x: number; readonly y: number; readonly start: boolean };
}

/// I quattro lati, spessi `thickness`, del rettangolo `box` (bordi come in
/// `MarkGeometry`). Ogni lato ha un pixel sul filo e gli altri dentro, lo
/// stesso sui quattro lati: il rettangolo è simmetrico sui fili.
export function edgeParts(
  prefix: string,
  kind: MarkKind,
  box: { readonly L: number; readonly T: number; readonly R: number; readonly B: number },
  thickness: number,
  extra: Partial<Pick<MarkPart, "rest" | "glide" | "fade">> = {},
): MarkPart[] {
  const width = box.R - box.L + 1;
  const height = box.B - box.T + 1;
  return [
    { name: `${prefix}-top`, kind, dir: "h", rect: { x: box.L - 1, y: box.T - 1, w: width, h: thickness }, ...extra },
    { name: `${prefix}-bottom`, kind, dir: "h", rect: { x: box.L - 1, y: box.B - thickness, w: width, h: thickness }, ...extra },
    { name: `${prefix}-left`, kind, dir: "v", rect: { x: box.L - 1, y: box.T - 1, w: thickness, h: height }, ...extra },
    { name: `${prefix}-right`, kind, dir: "v", rect: { x: box.R - thickness, y: box.T - 1, w: thickness, h: height }, ...extra },
  ];
}

/// Ciò che la selezione mostra oltre ai suoi numeri.
export interface SelectionLook {
  /// La selezione è la sola cella attiva: l'anello e il velo non hanno un
  /// posto d'arrivo.
  readonly lone: boolean;
  /// Il bordo pieno del rettangolo (non c'è sulle formiche di un taglio).
  readonly edges: boolean;
  /// Il quadratino di riempimento.
  readonly handle: boolean;
  /// L'altezza della riga delle intestazioni di colonna e la larghezza della
  /// colonna dei numeri di riga, per le fasce della selezione; zero se sono
  /// nascoste.
  readonly header: { readonly width: number; readonly height: number };
}

/// Il quadratino: 8 × 8 px, centrato sull'angolo dei fili.
export const HANDLE_SIZE = 8;

/// I pezzi della selezione dai suoi dieci numeri. L'anello e il velo ci
/// sono anche su una cella sola, dove l'anello sta sotto il bordo e il velo è
/// vuoto: allargando la selezione escono dal bordo, stringendola ci
/// rientrano, invece di comparire e sparire di colpo.
export function selectionParts(geometry: MarkGeometry, look: SelectionLook): MarkPart[] {
  const [bL, bT, bR, bB, aL, aT, aR, aB, hR, hB] = geometry;
  const b = { L: bL, T: bT, R: bR, B: bB };
  const a = { L: aL, T: aT, R: aR, B: aB };
  const parts: MarkPart[] = [];
  if (look.edges) parts.push(...edgeParts("rect", "edge", b, 2));
  const rest = !look.lone;
  parts.push(
    ...edgeParts("ring", "ring", a, 1, { rest }),
    { name: "veil-top", kind: "veil", rect: { x: b.L, y: b.T, w: b.R - b.L, h: a.T - b.T }, rest },
    { name: "veil-bottom", kind: "veil", rect: { x: b.L, y: a.B, w: b.R - b.L, h: b.B - a.B }, rest },
    { name: "veil-left", kind: "veil", rect: { x: b.L, y: a.T, w: a.L - b.L, h: a.B - a.T }, rest },
    { name: "veil-right", kind: "veil", rect: { x: a.R, y: a.T, w: b.R - a.R, h: a.B - a.T }, rest },
  );
  if (look.handle) {
    const half = HANDLE_SIZE / 2;
    parts.push({
      name: "handle",
      kind: "handle",
      rect: { x: hR - 1 - half, y: hB - 1 - half, w: HANDLE_SIZE, h: HANDLE_SIZE },
      corner: { x: hR, y: hB, start: false },
    });
  }
  if (look.header.height > 0) {
    parts.push({ name: "band-col", kind: "band-col", rect: { x: b.L, y: 0, w: b.R - b.L, h: look.header.height }, zones: ["top", "corner"], band: true });
  }
  if (look.header.width > 0) {
    parts.push({ name: "band-row", kind: "band-row", rect: { x: 0, y: b.T, w: look.header.width, h: b.B - b.T }, zones: ["left", "corner"], band: true });
  }
  return parts;
}
