// Il ritaglio delle immagini (livello Standard): quanta parte di un'immagine
// si vede, come lo scrivono il formato della scena e le sue risorse, e le
// operazioni che lo danno, lo cambiano, lo tolgono.
//
// - **Un ritaglio è un `clipPath` privato con un `rect` solo**, nelle
//   coordinate dell'immagine (quelle di `x y width height`, dopo il suo
//   `transform`), a cui l'immagine rimanda con `clip-path`. I byte
//   dell'immagine e il suo `href` non cambiano mai.
// - **L'immagine si sposta sotto il ritaglio** cambiando `x` e `y`; il
//   rettangolo resta fermo. Un ritaglio senza margini non c'è: il
//   `clip-path` si toglie, e il motore toglie il `clipPath` privato che
//   nessuno usa più.
// - **Ritaglio di chi?** Uno privato, e di questa immagine soltanto, cambia
//   sul posto, con `set` e `part` sul rettangolo; uno condiviso con altri
//   oggetti, o che non è di FubDraw, resta com'è e l'immagine ne riceve uno
//   nuovo suo, come per le sfumature. Qualunque altro ritaglio, o uno che
//   non si legge, non si cambia: si toglie soltanto.
// - **Ciò che il file scrive.** Il rettangolo e la posizione dell'immagine
//   stanno a due decimali, come la geometria (formato della scena, §7), e
//   dopo l'arrotondamento il rettangolo si riporta dentro il riquadro
//   scritto: il file non mostra mai un margine trasparente fuori
//   dall'immagine. I calcoli del gesto (`dragCrop`, `slideImage`) sono
//   esatti, e li arrotonda solo la scrittura.

import { formatNumber } from "../number";
import type { Bounds } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import type { DocumentModel, ElementPart, LeafNode } from "../scene/model";
import type { Op } from "../scene/ops";
import { length, reference, trim } from "../scene/values";
import { elemOf, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { Unit } from "./hit";
import { homeOf, resourcesOf, usersOf } from "./resources";

/// Il ritaglio di un'immagine, nelle sue coordinate: il riquadro
/// dell'immagine (`x y width height`) e la parte che se ne vede.
export interface Crop {
  readonly box: Bounds;
  readonly rect: Bounds;
}

/// Com'è ritagliata un'immagine: senza ritaglio (`rect` uguale a `box`), con
/// un ritaglio che FubDraw sa cambiare (l'id del `clipPath`), o con un altro
/// ritaglio, che non si cambia ma si toglie.
export type CropState =
  | { readonly kind: "free"; readonly crop: Crop }
  | { readonly kind: "crop"; readonly crop: Crop; readonly clip: string }
  | { readonly kind: "other" };

/// Il lato più piccolo che un ritaglio scrive.
export const MIN_CROP = 0.01;

/// I tag di `clipPath` che non si disegnano e non contano nel ritaglio.
const META: ReadonlySet<string> = new Set(["title", "desc"]);

/// Un numero della geometria come lo scrive il file.
const place = (value: number): string => formatNumber(value, 2);

/// `value` in centesimi, arrotondato come lo scrive il file.
const hundredths = (value: number): number => Math.floor(value * 100 + 0.5);

/// `value` portato fra `lo` e `hi`; se i limiti si incrociano, vince `lo`.
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

/// Un riquadro dai suoi lati.
const bounds = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ min: [x0, y0], max: [x1, y1] });

// ---------------------------------------------------------------------------
// Leggere un ritaglio.
// ---------------------------------------------------------------------------

/// Il rettangolo di `clip`, un `clipPath` che è un ritaglio: senza
/// `transform`, in `userSpaceOnUse`, con un solo `rect` (e titolo e
/// descrizione) che ha `x y width height` leggibili, lati positivi, niente
/// angoli arrotondati, niente `transform` e niente `display`. `null` per
/// ogni altro `clipPath`.
function rectOf(clip: LeafNode): Bounds | null {
  if (clip.facts.local !== "clipPath") return null;
  const elem = elemOf(clip);
  if (elem === null || elem.attrs.transform !== undefined) return null;
  const units = elem.attrs.clipPathUnits;
  if (units !== undefined && trim(units) !== "userSpaceOnUse") return null;
  const drawn = (elem.children ?? []).filter((child) => !META.has(child.tag));
  const rect = drawn[0];
  if (drawn.length !== 1 || rect === undefined || rect.tag !== "rect") return null;
  const attrs = rect.attrs;
  if (attrs.rx !== undefined || attrs.ry !== undefined || attrs.transform !== undefined || attrs.display !== undefined) return null;
  const x = attrs.x === undefined ? 0 : length(attrs.x);
  const y = attrs.y === undefined ? 0 : length(attrs.y);
  const width = attrs.width === undefined ? null : length(attrs.width);
  const height = attrs.height === undefined ? null : length(attrs.height);
  if (x === null || y === null || width === null || height === null || !(width > 0) || !(height > 0)) return null;
  return bounds(x, y, x + width, y + height);
}

/// La parte comune di due riquadri; `null` se non si toccano.
function overlap(a: Bounds, b: Bounds): Bounds | null {
  const x0 = Math.max(a.min[0], b.min[0]);
  const y0 = Math.max(a.min[1], b.min[1]);
  const x1 = Math.min(a.max[0], b.max[0]);
  const y1 = Math.min(a.max[1], b.max[1]);
  return x0 < x1 && y0 < y1 ? bounds(x0, y0, x1, y1) : null;
}

/// `null` se `node` non è un'immagine modificabile con `x y width height`
/// che si leggono e lati positivi.
export function cropState(model: DocumentModel, node: ElementPart): CropState | null {
  if (node.kind !== "leaf" || node.details?.role !== "image") return null;
  const own = plainAttributes(node);
  const x = own.has("x") ? length(own.get("x")!) : 0;
  const y = own.has("y") ? length(own.get("y")!) : 0;
  const width = own.has("width") ? length(own.get("width")!) : null;
  const height = own.has("height") ? length(own.get("height")!) : null;
  if (x === null || y === null || width === null || height === null || !(width > 0) || !(height > 0)) return null;
  const box = bounds(x, y, x + width, y + height);
  const written = own.get("clip-path");
  if (written === undefined || trim(written) === "none") return { kind: "free", crop: { box, rect: box } };
  const id = reference(written);
  const clip = id === null ? undefined : resourcesOf(model).get(id);
  const rect = clip === undefined ? null : rectOf(clip);
  const seen = rect === null ? null : overlap(rect, box);
  return id === null || seen === null ? { kind: "other" } : { kind: "crop", crop: { box, rect: seen }, clip: id };
}

// ---------------------------------------------------------------------------
// I margini.
// ---------------------------------------------------------------------------

export interface Margins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/// Quanto il ritaglio dista dai quattro bordi dell'immagine.
export function marginsOf(crop: Crop): Margins {
  const { box, rect } = crop;
  return { top: rect.min[1] - box.min[1], right: box.max[0] - rect.max[0], bottom: box.max[1] - rect.max[1], left: rect.min[0] - box.min[0] };
}

/// Il ritaglio coi margini `margins` dai bordi dell'immagine; `null` se uno
/// è negativo o se lasciano meno di `MIN_CROP` per lato.
export function withMargins(crop: Crop, margins: Margins): Crop | null {
  const { box } = crop;
  const { top, right, bottom, left } = margins;
  if (![top, right, bottom, left].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const rect = bounds(box.min[0] + left, box.min[1] + top, box.max[0] - right, box.max[1] - bottom);
  if (rect.max[0] - rect.min[0] < MIN_CROP || rect.max[1] - rect.min[1] < MIN_CROP) return null;
  return { box, rect };
}

// ---------------------------------------------------------------------------
// I gesti.
// ---------------------------------------------------------------------------

export type CropHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/// Un lato di un asse che la maniglia afferra: 0 il primo (sinistra o alto),
/// 1 il secondo, -1 nessuno.
type Grab = -1 | 0 | 1;

/// I lati `lo` e `hi` di un asse con la maniglia in `to`, dentro
/// `boxLo`…`boxHi` e ciascuno lungo almeno `min`. Con `centered` il lato
/// opposto va dalla parte opposta del centro.
function stretch(lo: number, hi: number, boxLo: number, boxHi: number, grab: Grab, to: number, centered: boolean, min: number): [number, number] {
  if (grab < 0) return [lo, hi];
  if (centered) {
    const center = (lo + hi) / 2;
    const half = clamp(grab === 0 ? center - to : to - center, min / 2, Math.min(center - boxLo, boxHi - center));
    return [Math.max(boxLo, center - half), Math.min(boxHi, center + half)];
  }
  return grab === 0 ? [clamp(to, boxLo, Math.max(boxLo, hi - min)), hi] : [lo, clamp(to, Math.min(boxHi, lo + min), boxHi)];
}

/// Il ritaglio `crop` portato in scala, con le proporzioni che ha, dal
/// punto fermo: l'angolo opposto alla maniglia, o il centro (con `centered`,
/// e per una maniglia di un lato nell'altro asse). La scala è quella che
/// porta la maniglia al puntatore, la più grande dei due assi per un
/// angolo, e resta dentro l'immagine.
function scaled(crop: Crop, gx: Grab, gy: Grab, to: Point, centered: boolean, min: number): Crop {
  const { box, rect } = crop;
  const w = rect.max[0] - rect.min[0];
  const h = rect.max[1] - rect.min[1];
  const cx = (rect.min[0] + rect.max[0]) / 2;
  const cy = (rect.min[1] + rect.max[1]) / 2;
  const ax = centered || gx < 0 ? cx : gx === 0 ? rect.max[0] : rect.min[0];
  const ay = centered || gy < 0 ? cy : gy === 0 ? rect.max[1] : rect.min[1];
  let asked = 0;
  if (gx >= 0) asked = Math.max(asked, (to[0] - ax) / ((gx === 0 ? rect.min[0] : rect.max[0]) - ax));
  if (gy >= 0) asked = Math.max(asked, (to[1] - ay) / ((gy === 0 ? rect.min[1] : rect.max[1]) - ay));
  // Quanto si può scalare prima che un lato esca dall'immagine.
  let most = Infinity;
  for (const [a, lo, hi, boxLo, boxHi] of [
    [ax, rect.min[0], rect.max[0], box.min[0], box.max[0]],
    [ay, rect.min[1], rect.max[1], box.min[1], box.max[1]],
  ] as const) {
    if (lo < a) most = Math.min(most, (a - boxLo) / (a - lo));
    if (hi > a) most = Math.min(most, (boxHi - a) / (hi - a));
  }
  const s = Math.min(most, Math.max(Math.max(min / w, min / h), asked));
  const at = (a: number, edge: number, boxLo: number, boxHi: number): number => clamp(a + s * (edge - a), boxLo, boxHi);
  return {
    box,
    rect: bounds(
      at(ax, rect.min[0], box.min[0], box.max[0]),
      at(ay, rect.min[1], box.min[1], box.max[1]),
      at(ax, rect.max[0], box.min[0], box.max[0]),
      at(ay, rect.max[1], box.min[1], box.max[1]),
    ),
  };
}

/// Il ritaglio con la maniglia `handle` portata al punto `to`, nelle
/// coordinate dell'immagine: dentro l'immagine, ogni lato di almeno `min`;
/// con `ratio` tiene le proporzioni che aveva, con `centered` si allarga dal
/// centro.
export function dragCrop(
  crop: Crop,
  handle: CropHandle,
  to: Point,
  options: { readonly ratio: boolean; readonly centered: boolean; readonly min: number },
): Crop {
  const { box, rect } = crop;
  const { ratio, centered, min } = options;
  const gx: Grab = handle.includes("w") ? 0 : handle.includes("e") ? 1 : -1;
  const gy: Grab = handle.includes("n") ? 0 : handle.includes("s") ? 1 : -1;
  if (ratio && rect.max[0] > rect.min[0] && rect.max[1] > rect.min[1]) return scaled(crop, gx, gy, to, centered, min);
  const [x0, x1] = stretch(rect.min[0], rect.max[0], box.min[0], box.max[0], gx, to[0], centered, min);
  const [y0, y1] = stretch(rect.min[1], rect.max[1], box.min[1], box.max[1], gy, to[1], centered, min);
  return { box, rect: bounds(x0, y0, x1, y1) };
}

/// L'immagine spostata di `delta`, nelle sue coordinate, sotto il ritaglio
/// che resta fermo, e fermata dove il ritaglio toccherebbe il suo bordo.
export function slideImage(crop: Crop, delta: Point): Crop {
  const { box, rect } = crop;
  const dx = clamp(delta[0], rect.max[0] - box.max[0], rect.min[0] - box.min[0]);
  const dy = clamp(delta[1], rect.max[1] - box.max[1], rect.min[1] - box.min[1]);
  return { box: bounds(box.min[0] + dx, box.min[1] + dy, box.max[0] + dx, box.max[1] + dy), rect };
}

// ---------------------------------------------------------------------------
// Scrivere un ritaglio.
// ---------------------------------------------------------------------------

/// Il rettangolo di un ritaglio come lo scrive il file: quattro numeri a due
/// decimali.
export interface RectWrite {
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
}

/// Un asse: la posizione scritta `at`, la lunghezza `size` dell'immagine, e
/// i lati `lo` e `hi` che si vogliono. Torna origine e lato del rettangolo
/// in centesimi, dentro l'immagine, e se la copre a meno di mezzo
/// centesimo; `null` se non ci sta un centesimo.
function axisWritten(at: number, size: number, lo: number, hi: number): { start: number; side: number; full: boolean } | null {
  const first = at * 100;
  const last = (at + size) * 100;
  const least = Math.ceil(first - 1e-6);
  const most = Math.floor(last + 1e-6);
  if (most - least < 1) return null;
  let a = clamp(hundredths(lo), least, most);
  let b = clamp(hundredths(hi), least, most);
  if (b <= a) {
    if (a < most) b = a + 1;
    else a = b - 1;
  }
  return { start: a, side: b - a, full: a - first <= 0.5 + 1e-6 && last - b <= 0.5 + 1e-6 };
}

/// Il rettangolo `rect` come lo scrive il file per l'immagine scritta in
/// `box`: arrotondato e riportato dentro l'immagine, così che il file non
/// mostri mai un margine trasparente. Dice anche se copre tutta l'immagine.
/// `null` se l'immagine è troppo piccola per un rettangolo.
export function writeRect(box: Bounds, rect: Bounds): { readonly rect: RectWrite; readonly full: boolean } | null {
  const across = axisWritten(box.min[0], box.max[0] - box.min[0], rect.min[0], rect.max[0]);
  const down = axisWritten(box.min[1], box.max[1] - box.min[1], rect.min[1], rect.max[1]);
  if (across === null || down === null) return null;
  return {
    rect: { x: place(across.start / 100), y: place(down.start / 100), width: place(across.side / 100), height: place(down.side / 100) },
    full: across.full && down.full,
  };
}

/// Il valore di un attributo numerico `name` di `attrs`, 0 se manca; `null`
/// se non si legge.
const numberAt = (attrs: Readonly<Record<string, string>>, name: string): number | null => (attrs[name] === undefined ? 0 : length(attrs[name]!));

/// Ciò che cambia nel rettangolo di `clip`, un ritaglio letto da
/// [`cropState`], per scrivere `rect`: il suo posto fra i figli, per un
/// `set` con `part`, e gli attributi diversi da quelli di adesso, anche
/// nessuno. `null` se `clip` non si legge.
export function rectChanges(clip: LeafNode, rect: RectWrite): { readonly part: number; readonly attrs: Record<string, string> } | null {
  const children = elemOf(clip)?.children;
  const part = children === undefined ? -1 : children.findIndex((child) => child.tag === "rect");
  if (children === undefined || part < 0) return null;
  const current = children[part]!.attrs;
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(rect)) if (numberAt(current, name) !== Number(value)) attrs[name] = value;
  return { part, attrs };
}

/// Le operazioni che danno a `node` il ritaglio `next`; `[]` se non cambia
/// niente, una volta scritto, o se l'immagine ha un altro ritaglio, che non
/// si cambia (`uncropOps` lo toglie).
export function cropOps(model: DocumentModel, node: ElementPart, next: Crop, ids: NewIds): Op[] {
  const state = cropState(model, node);
  if (state === null || state.kind === "other") return [];
  const { box } = state.crop;
  // L'immagine dove sta dopo: la posizione cambia solo se `next` la sposta.
  const at = (axis: 0 | 1): number => (next.box.min[axis] === box.min[axis] ? box.min[axis] : Number(place(next.box.min[axis])));
  const [x, y] = [at(0), at(1)];
  const out = writeRect(bounds(x, y, x + (box.max[0] - box.min[0]), y + (box.max[1] - box.min[1])), next.rect);
  if (out === null) return [];
  const plan = new Plan(model, ids);
  const attrs: Record<string, string | null> = {};
  if (x !== box.min[0]) attrs.x = place(x);
  if (y !== box.min[1]) attrs.y = place(y);
  const image = (): Op => ({ op: "set", id: plan.idOf(node), attrs });
  // Un ritaglio nuovo, suo, al posto di quello che c'era o di nessuno.
  const fresh = (beside: LeafNode | null): void => {
    const home = homeOf(model);
    const id = plan.ids.next("resource");
    const elem = { tag: "clipPath", attrs: { id, "fub:role": "private" }, children: [{ tag: "rect", attrs: { ...out.rect } }] };
    const near = beside !== null && beside.parent?.facts.id === home.parent;
    plan.ops.push(...home.prelude, { op: "add", parent: home.parent, pos: near ? { after: beside.facts.id! } : { last: true }, elem });
    attrs["clip-path"] = `url(#${id})`;
    plan.ops.push(image());
  };
  if (state.kind === "free") {
    if (!out.full) fresh(null);
    else if (Object.keys(attrs).length > 0) plan.ops.push(image());
    return [...plan.finish([]).ops];
  }
  const clip = resourcesOf(model).get(state.clip)!;
  if (out.full) {
    attrs["clip-path"] = null;
    plan.ops.push(image());
  } else if (clip.details?.lifecycle === "private" && usersOf(model).get(state.clip) === 1) {
    // Sul posto: cambia soltanto ciò che cambia del rettangolo.
    const changes = rectChanges(clip, out.rect);
    if (changes === null) return [];
    if (Object.keys(changes.attrs).length > 0) plan.ops.push({ op: "set", id: state.clip, part: [changes.part], attrs: changes.attrs });
    if (Object.keys(attrs).length > 0) plan.ops.push(image());
  } else {
    fresh(clip);
  }
  return [...plan.finish([]).ops];
}

// ---------------------------------------------------------------------------
// Togliere un ritaglio.
// ---------------------------------------------------------------------------

/// Le immagini fra `units` che hanno un `clip-path`, ritaglio o no.
export function croppedImages(model: DocumentModel, units: readonly Unit[]): Unit[] {
  return units.filter((unit) => {
    if (unit.role !== "image") return false;
    const node = nodeOf(model, unit);
    if (node.kind !== "leaf" || node.refs.length === 0) return false;
    const written = plainAttributes(node).get("clip-path");
    return written !== undefined && trim(written) !== "none";
  });
}

/// Toglie il `clip-path` dalle immagini di `units` che lo hanno. La
/// selezione resta la stessa.
export function uncropOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  for (const unit of croppedImages(model, units)) plan.ops.push({ op: "set", id: plan.idOf(nodeOf(model, unit)), attrs: { "clip-path": null } });
  return plan.finish(units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key)));
}
