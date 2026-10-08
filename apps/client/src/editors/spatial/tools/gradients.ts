// Le sfumature degli oggetti (livello Standard): lineari e radiali, nel
// riempimento e nel contorno. Ciò che ne leggono il pannello delle proprietà
// e lo strumento Sfumatura, e le operazioni che le danno, le cambiano e le
// tolgono, ciascuna in un passo che si annulla (formato della scena,
// risorse).
//
// - **Ogni oggetto ha la sua.** Una sfumatura è una risorsa privata di chi
//   la usa, nelle sue coordinate (`userSpaceOnUse`): spostare, ruotare o
//   scalare l'oggetto la porta con sé. Chi cambia una sfumatura che non è
//   soltanto sua, perché condivisa, di un altro programma, ereditata da un
//   gruppo o usata anche dall'altro colore, ne riceve una copia e cambia
//   quella; gli altri la tengono com'era. I campioni restano colori.
// - **Dove sta si legge nella scena**: i capi della linea di una lineare, e
//   un punto della riga di uguale colore che passa per il primo; il centro
//   di una radiale, i capi di due suoi raggi e il fuoco. Un oggetto
//   deformato la mostra deformata, e i punti restano dove si vedono. Da loro
//   si riscrive nelle coordinate dell'oggetto, con una `gradientTransform`
//   soltanto dove serve.
// - **Ciò che si vede resta.** Le righe di uguale colore di una lineare non
//   stanno sempre di traverso alla linea: un oggetto inclinato le inclina.
//   Spostare un capo tiene l'angolo fra le righe e la linea; una linea
//   tracciata di nuovo le vuole di traverso, come si vede.
// - **Sul posto quando si può:** una sfumatura che resta dello stesso tipo,
//   coi punti in egual numero, cambia con `set`, i punti con `part`; un
//   punto in più o in meno, o un tipo nuovo, fanno una sfumatura nuova al
//   posto della vecchia, che il motore toglie.
// - **Il ripiego** di chi la usa è la media dei suoi colori, pesata
//   sull'opacità: è ciò che si vede dove la sfumatura non si trova.

import { formatNumber } from "../number";
import type { Bounds } from "../scene/geometry";
import { apply, compose, invert, IDENTITY, translate, type Matrix, type Point } from "../scene/matrix";
import type { DocumentModel, ElementPart, LeafNode } from "../scene/model";
import type { Op } from "../scene/ops";
import { formatTransform, type Elem } from "../scene/serialize";
import { fraction, length, opacity as parseOpacity, paint, paintReference, transform as parseTransform, trim } from "../scene/values";
import type { DrawKey } from "../strings";
import { elemOf, plainAttributes } from "./arrange";
import type { NewIds } from "./edit";
import { geometryBox, type Unit } from "./hit";
import { paintEachOps, paintParts, type PaintPart, type Restyled } from "./look";
import type { Measure } from "./measure";
import { customColor } from "./palette";
import { gradientOf, homeOf, paintCode, resourcesOf, usersOf, type Home } from "./resources";

/// Il colore che si cambia: il riempimento o il contorno.
export type PaintChannel = "fill" | "stroke";

export type GradientKind = "linear" | "radial";

/// Come una sfumatura continua oltre i suoi capi: col colore del capo, a
/// specchio o daccapo.
export type Spread = "pad" | "reflect" | "repeat";

export const SPREADS: readonly Spread[] = ["pad", "reflect", "repeat"];

/// Un punto di una sfumatura, come lo mostra il pannello.
export interface GradientStop {
  /// Dove sta, da 0 a 1.
  readonly offset: number;
  /// `#rrggbb` minuscolo.
  readonly color: string;
  /// Da 0 a 1.
  readonly opacity: number;
}

/// Una sfumatura a parte dove sta: il tipo, i punti in ordine e come
/// continua oltre i capi.
export interface GradientLook {
  readonly kind: GradientKind;
  readonly stops: readonly GradientStop[];
  readonly spread: Spread;
}

/// Dove sta una sfumatura, in coordinate della scena. Una lineare va da
/// `start` a `end`, e la riga di uguale colore che passa per `start` passa
/// anche per `across`. Una radiale ha il centro, i capi `a` e `b` di due
/// raggi, che nelle sue coordinate stanno di traverso, e il fuoco, da cui
/// il colore parte.
export type GradientPlace =
  | { readonly kind: "linear"; readonly start: Point; readonly end: Point; readonly across: Point }
  | { readonly kind: "radial"; readonly center: Point; readonly a: Point; readonly b: Point; readonly focus: Point };

/// Un punto di [`GradientPlace`] che si sposta.
export type PlaceGrip = "start" | "end" | "center" | "a" | "b" | "focus";

/// Una parte della selezione che mostra il colore che si cambia, con la
/// sfumatura che usa.
export interface Painted extends PaintPart {
  /// Dalle sue coordinate a quelle della scena.
  readonly matrix: Matrix;
  /// Il riquadro della sua geometria, senza contorno, nelle sue coordinate;
  /// `null` se non ne ha uno.
  readonly box: Bounds | null;
  /// La sfumatura che mostra; `null` per un colore, un campione, un motivo
  /// o una sfumatura che non si legge.
  readonly gradient: UsedGradient | null;
  /// Il colore pieno che mostra, `#rrggbb` minuscolo: il suo o quello di un
  /// campione; `null` per una sfumatura, un motivo o nessun colore.
  readonly solid: string | null;
}

/// Una sfumatura come la usa una parte.
export interface UsedGradient {
  readonly id: string;
  readonly look: GradientLook;
  /// Dove sta nella scena: per una sfumatura di un punto solo, che non ha
  /// bisogno di stare da nessuna parte, dove nascerebbe. `null` nelle unità
  /// di un riquadro che la parte non ha, o se la parte schiaccia il piano.
  readonly place: GradientPlace | null;
  /// Il posto di ogni punto fra i figli elemento della sfumatura, per un
  /// `set` con `part`, nell'ordine dei punti.
  readonly parts: readonly number[];
  /// Vero se è soltanto sua: privata, scritta da lei per questo colore e
  /// usata da nessun altro.
  readonly own: boolean;
}

/// Quanto un fuoco sta dentro il cerchio, al più, in raggi: fuori, SVG 1.1
/// lo riporta sul bordo e SVG 2 disegna un cono, e i lettori non si
/// troverebbero d'accordo.
export const FOCUS_LIMIT = 0.99;

/// Un numero della geometria come lo scrive il file.
const coord = (value: number): string => formatNumber(value, 2);

/// Una posizione o un'opacità come le scrive il file.
const share = (value: number): string => formatNumber(value, 4);

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

const boxes = new WeakMap<ElementPart, Bounds | null>();

/// Il riquadro della geometria di `node`, letto una volta: un'unità che
/// cambia è un nodo nuovo.
function boxOf(node: ElementPart): Bounds | null {
  let box = boxes.get(node);
  if (box === undefined) {
    const elem = node.kind === "leaf" ? elemOf(node) : null;
    box = elem === null ? null : geometryBox(elem);
    boxes.set(node, box);
  }
  return box;
}

/// Dalle coordinate di `node` a quelle della scena: le trasformazioni di chi
/// lo contiene e la sua. Quelle che non si leggono non contano, come per il
/// painter.
function sceneMatrix(node: ElementPart, known: Map<ElementPart, Matrix>): Matrix {
  const parent = node.parent;
  if (parent === null) return IDENTITY;
  let matrix = known.get(node);
  if (matrix === undefined) {
    const written = plainAttributes(node).get("transform");
    const own = written === undefined ? IDENTITY : (parseTransform(written) ?? IDENTITY);
    matrix = compose(sceneMatrix(parent, known), own);
    known.set(node, matrix);
  }
  return matrix;
}

/// Il colore `#rrggbb` minuscolo di un canale sRGB.
const hex = (rgb: readonly number[]): string => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

/// La sfumatura `node` come la mostra il pannello, e dove stanno i suoi
/// punti; `null` se non è una sfumatura che si legge, o se è un campione.
function lookOf(node: LeafNode): { readonly look: GradientLook; readonly parts: readonly number[] } | null {
  if (node.details?.swatch !== undefined) return null;
  const gradient = gradientOf(node);
  if (gradient === null) return null;
  return {
    look: {
      kind: gradient.kind,
      stops: gradient.stops.map((stop) => ({ offset: stop.offset, color: hex(stop.color), opacity: stop.alpha })),
      spread: gradient.spread,
    },
    parts: gradient.stops.map((stop) => stop.index),
  };
}

/// Dove sta la sfumatura `node` nella scena, per una parte con la matrice
/// `matrix` e il riquadro `box`.
function placeOf(node: LeafNode, matrix: Matrix, box: Bounds | null): GradientPlace | null {
  const gradient = gradientOf(node);
  if (gradient === null) return null;
  let space = compose(matrix, gradient.transform);
  if (gradient.inBox) {
    if (box === null) return null;
    const w = box.max[0] - box.min[0];
    const h = box.max[1] - box.min[1];
    if (!(w > 0 && h > 0)) return null;
    space = compose(matrix, compose([w, 0, 0, h, box.min[0], box.min[1]], gradient.transform));
  }
  if (invert(space) === null) return null;
  const at = (x: number, y: number): Point => apply(space, [x, y]);
  if (gradient.kind === "linear") {
    const [x1, y1, x2, y2] = gradient.coords as [number, number, number, number];
    return { kind: "linear", start: at(x1, y1), end: at(x2, y2), across: at(x1 - (y2 - y1), y1 + (x2 - x1)) };
  }
  const [cx, cy, r, fx, fy] = gradient.coords as [number, number, number, number, number];
  return { kind: "radial", center: at(cx, cy), a: at(cx + r, cy), b: at(cx, cy + r), focus: at(fx, fy) };
}

/// Le parti di `units` che mostrano `channel`, come le cambia il pannello,
/// con la sfumatura di ciascuna.
export function paintedParts(model: DocumentModel, units: readonly Unit[], channel: PaintChannel): Painted[] {
  const resources = resourcesOf(model);
  const matrices = new Map<ElementPart, Matrix>();
  let users: Map<string, number> | null = null;
  return paintParts(model, units, channel).map((part): Painted => {
    const matrix = sceneMatrix(part.node, matrices);
    const box = boxOf(part.node);
    const used = paintReference(part.value);
    const node = used === null ? undefined : resources.get(used.id);
    const read = node === undefined ? null : lookOf(node);
    if (used === null) return { ...part, matrix, box, gradient: null, solid: customColor(part.value) };
    if (node === undefined || read === null) return { ...part, matrix, box, gradient: null, solid: node?.details?.swatch?.color ?? null };
    const other = part.own.get(part.name === "fill" ? "stroke" : "fill");
    let own = node.details?.lifecycle === "private" && paintReference(part.own.get(part.name) ?? "")?.id === used.id && (other === undefined || paintReference(other)?.id !== used.id);
    if (own) {
      users ??= usersOf(model);
      own = users.get(used.id) === 1;
    }
    const placed = read.look.stops.length < 2 ? defaultPlace(read.look.kind, matrix, box) : placeOf(node, matrix, box);
    return { ...part, matrix, box, gradient: { id: used.id, look: read.look, place: placed, parts: read.parts, own }, solid: null };
  });
}

// ---------------------------------------------------------------------------
// Ciò che il pannello e lo strumento mostrano.
// ---------------------------------------------------------------------------

/// Le sfumature della selezione, come le mostra il pannello.
export interface GradientView {
  /// Quante parti mostrano il colore.
  readonly count: number;
  /// Quante di loro mostrano una sfumatura che si legge.
  readonly gradients: number;
  /// Il tipo comune: `color` per un colore pieno o un campione, `other`
  /// per nessun colore, un motivo o una sfumatura che non si legge; `null`
  /// se misto.
  readonly kind: GradientKind | "color" | "other" | null;
  /// La sfumatura comune a parte dove sta; `null` se misto, o senza.
  readonly look: GradientLook | null;
  /// L'angolo comune della linea, o del primo raggio di una radiale, delle
  /// parti con una sfumatura, in gradi in senso orario fra -180 escluso e
  /// 180, al centesimo; `null` se misto, o senza.
  readonly angle: number | null;
}

/// Vero se due sfumature si vedono uguali, a parte dove stanno.
export function sameLook(a: GradientLook, b: GradientLook): boolean {
  if (a.kind !== b.kind || a.spread !== b.spread || a.stops.length !== b.stops.length) return false;
  return a.stops.every((stop, at) => {
    const other = b.stops[at]!;
    return stop.color === other.color && Math.abs(stop.offset - other.offset) < 1e-4 && Math.abs(stop.opacity - other.opacity) < 1e-4;
  });
}

/// Le sfumature di `painted`.
export function gradientView(painted: readonly Painted[]): GradientView {
  if (painted.length === 0) return { count: 0, gradients: 0, kind: null, look: null, angle: null };
  const first = painted[0]!.gradient;
  const kinds = new Set(painted.map((part) => part.gradient?.look.kind ?? (part.solid === null ? "other" : "color")));
  const kind = kinds.size === 1 ? [...kinds][0]! : null;
  const look = first !== null && painted.every((part) => part.gradient !== null && sameLook(part.gradient.look, first.look)) ? first.look : null;
  const shaded = painted.filter((part) => part.gradient !== null);
  const angles = shaded.map((part) => {
    const placed = part.gradient!.place;
    return placed === null ? null : Math.round(placeAngle(placed) * 100) / 100;
  });
  const angle = angles.length > 0 && angles.every((each) => each !== null && each === angles[0]) ? angles[0]! : null;
  return { count: painted.length, gradients: shaded.length, kind, look, angle };
}

/// Una sfumatura sul foglio: le parti che la mostrano uguale e nello stesso
/// posto, la sfumatura e dove sta.
export interface GradientHandles {
  readonly parts: readonly Painted[];
  readonly look: GradientLook;
  readonly place: GradientPlace;
}

/// I punti di `place`, nell'ordine in cui la tastiera li percorre.
export function placeGrips(place: GradientPlace): Array<readonly [PlaceGrip, Point]> {
  return place.kind === "linear"
    ? [
        ["start", place.start],
        ["end", place.end],
      ]
    : [
        ["center", place.center],
        ["a", place.a],
        ["b", place.b],
        ["focus", place.focus],
      ];
}

/// Vero se `a` e `b` stanno nello stesso posto, a meno di `tolerance`.
function samePlace(a: GradientPlace, b: GradientPlace, tolerance: number): boolean {
  if (a.kind !== b.kind) return false;
  const near = (p: Point, q: Point): boolean => Math.abs(p[0] - q[0]) <= tolerance && Math.abs(p[1] - q[1]) <= tolerance;
  // La riga di uguale colore conta per la direzione, non per la lunghezza.
  if (a.kind === "linear" && b.kind === "linear") {
    const u = sub(a.across, a.start);
    const v = sub(b.across, b.start);
    return near(a.start, b.start) && near(a.end, b.end) && dot(u, v) > 0 && Math.abs(cross(u, v)) <= 1e-3 * Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  }
  return placeGrips(a).every(([, p], at) => near(p, placeGrips(b)[at]![1]));
}

/// Le sfumature di `painted` sul foglio, una per gruppo di parti che la
/// mostrano uguale e nello stesso posto, a meno di `tolerance` unità della
/// scena; nell'ordine della prima parte di ciascuna.
export function gradientHandles(painted: readonly Painted[], tolerance: number): GradientHandles[] {
  const out: Array<{ parts: Painted[]; look: GradientLook; place: GradientPlace }> = [];
  for (const part of painted) {
    const used = part.gradient;
    if (used === null || used.place === null) continue;
    const same = out.find((each) => sameLook(each.look, used.look) && samePlace(each.place, used.place!, tolerance));
    if (same !== undefined) same.parts.push(part);
    else out.push({ parts: [part], look: used.look, place: used.place });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dove sta.
// ---------------------------------------------------------------------------

const sub = (p: Point, q: Point): Point => [p[0] - q[0], p[1] - q[1]];
const add = (p: Point, v: Point): Point => [p[0] + v[0], p[1] + v[1]];
const scale = (v: Point, k: number): Point => [v[0] * k, v[1] * k];
const dot = (u: Point, v: Point): number => u[0] * v[0] + u[1] * v[1];
const cross = (u: Point, v: Point): number => u[0] * v[1] - u[1] * v[0];
const span = (p: Point, q: Point): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
/// `v` girato di un quarto, nel verso di SVG.
const quarter = (v: Point): Point => [-v[1], v[0]];

/// `degrees` fra -180 escluso e 180, senza `-0`, come gli angoli della
/// cornice.
function normalized(degrees: number): number {
  const turned = degrees - 360 * Math.floor((degrees + 180) / 360);
  return (turned === -180 ? 180 : turned) || 0;
}

/// L'angolo della linea di `place`, o del primo raggio di una radiale, in
/// gradi in senso orario fra -180 escluso e 180.
export function placeAngle(place: GradientPlace): number {
  const v = place.kind === "linear" ? sub(place.end, place.start) : sub(place.a, place.center);
  return normalized((Math.atan2(v[1], v[0]) * 180) / Math.PI);
}

/// `m` attorno a `pivot`, che resta fermo.
const about = (pivot: Point, m: Matrix): Matrix => compose(translate(pivot[0], pivot[1]), compose(m, translate(-pivot[0], -pivot[1])));

/// La trasformazione che tiene fermo `pivot` e porta `from` in `to`,
/// girando e scalando: `null` se `from` sta su `pivot`.
function similarity(pivot: Point, from: Point, to: Point): Matrix | null {
  const u = sub(from, pivot);
  const v = sub(to, pivot);
  const squared = dot(u, u);
  if (!(squared > 0)) return null;
  // v / u come numeri complessi.
  const re = dot(u, v) / squared;
  const im = cross(u, v) / squared;
  return about(pivot, [re, im, -im, re, 0, 0]);
}

/// `place` portata da `m`, una trasformazione della scena.
export function placeMapped(place: GradientPlace, m: Matrix): GradientPlace {
  if (place.kind === "linear") return { kind: "linear", start: apply(m, place.start), end: apply(m, place.end), across: apply(m, place.across) };
  return { kind: "radial", center: apply(m, place.center), a: apply(m, place.a), b: apply(m, place.b), focus: apply(m, place.focus) };
}

/// `place` girata attorno al suo mezzo, o al centro di una radiale, finché
/// la linea, o il primo raggio, non ha l'angolo `degrees`.
export function placeTurned(place: GradientPlace, degrees: number): GradientPlace {
  const pivot = place.kind === "linear" ? mid(place.start, place.end) : place.center;
  const turn = ((degrees - placeAngle(place)) * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return placeMapped(place, about(pivot, [cos, sin, -sin, cos, 0, 0]));
}

/// Dove sta il fuoco di una radiale nelle sue coordinate: quanti raggi `a`
/// e quanti raggi `b` dal centro.
function focusShare(center: Point, a: Point, b: Point, focus: Point): Point | null {
  const u = sub(a, center);
  const v = sub(b, center);
  const det = cross(u, v);
  if (det === 0 || !Number.isFinite(det)) return null;
  const f = sub(focus, center);
  return [cross(f, v) / det, cross(u, f) / det];
}

/// Il fuoco che sta a `share` raggi dal centro, dentro il bordo.
function focusAt(center: Point, a: Point, b: Point, [s, t]: Point): Point {
  const away = Math.hypot(s, t);
  const k = away > FOCUS_LIMIT ? FOCUS_LIMIT / away : 1;
  return add(center, add(scale(sub(a, center), s * k), scale(sub(b, center), t * k)));
}

/// `place` col punto `grip` portato in `to`, nella scena:
///
/// - un capo di una lineare gira e allunga la linea attorno all'altro, e
///   le righe di uguale colore girano con lei;
/// - il centro di una radiale la sposta tutta;
/// - il capo `a` la gira e la scala attorno al centro, `b` compreso;
/// - il capo `b` allunga o accorcia soltanto il suo raggio, nella sua
///   direzione, fino a un millesimo dell'altro;
/// - il fuoco si sposta, dentro il bordo.
///
/// Il fuoco resta dov'era nelle coordinate della sfumatura. `place` resta
/// com'è se il gesto non si può fare, come un capo portato sull'altro.
export function placeWith(place: GradientPlace, grip: PlaceGrip, to: Point): GradientPlace {
  if (place.kind === "linear") {
    if (grip !== "start" && grip !== "end") return place;
    const fixed = grip === "start" ? place.end : place.start;
    const moved = grip === "start" ? place.start : place.end;
    if (span(to, fixed) === 0) return place;
    const m = similarity(fixed, moved, to);
    if (m === null) {
      const start = grip === "start" ? to : place.start;
      const end = grip === "end" ? to : place.end;
      return { kind: "linear", start, end, across: add(start, quarter(sub(end, start))) };
    }
    return placeMapped(place, m);
  }
  const { center, a, b, focus } = place;
  switch (grip) {
    case "center":
      return placeMapped(place, translate(to[0] - center[0], to[1] - center[1]));
    case "a": {
      if (span(to, center) === 0) return place;
      const m = similarity(center, a, to);
      return m === null ? place : placeMapped(place, m);
    }
    case "b": {
      const shares = focusShare(center, a, b, focus);
      const along = sub(b, center);
      const length = Math.hypot(along[0], along[1]);
      if (shares === null || !(length > 0)) return place;
      const reach = Math.max(dot(sub(to, center), along) / length, span(a, center) / 1000);
      const next = add(center, scale(along, reach / length));
      return { kind: "radial", center, a, b: next, focus: focusAt(center, a, next, shares) };
    }
    case "focus": {
      const shares = focusShare(center, a, b, to);
      return shares === null ? place : { kind: "radial", center, a, b, focus: focusAt(center, a, b, shares) };
    }
    default:
      return place;
  }
}

/// `to` vincolato da `from` a un multiplo di 45°, alla stessa distanza
/// lungo quella direzione: il gesto con `Maiusc`.
export function constrained(from: Point, to: Point): Point {
  const v = sub(to, from);
  const length = Math.hypot(v[0], v[1]);
  if (!(length > 0)) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(v[1], v[0]) / step) * step;
  const dir: Point = [Math.cos(angle), Math.sin(angle)];
  return add(from, scale(dir, dot(v, dir)));
}

/// La sfumatura tracciata da `from` a `to` nella scena: una lineare con le
/// righe di uguale colore di traverso, o una radiale circolare col centro
/// in `from`. `null` se i due punti coincidono.
export function drawnPlace(kind: GradientKind, from: Point, to: Point): GradientPlace | null {
  if (span(from, to) === 0) return null;
  const turned = add(from, quarter(sub(to, from)));
  return kind === "linear" ? { kind, start: from, end: to, across: turned } : { kind, center: from, a: to, b: turned, focus: from };
}

/// Dove nasce una sfumatura su una parte con la matrice `matrix` e il
/// riquadro `box`: una lineare da sinistra a destra a metà altezza, o
/// dall'alto in basso se il riquadro non ha larghezza; una radiale
/// nell'ellisse dentro il riquadro, o nel cerchio se un lato non c'è.
/// `null` se il riquadro non ha misura.
export function defaultPlace(kind: GradientKind, matrix: Matrix, box: Bounds | null): GradientPlace | null {
  if (box === null) return null;
  const [x0, y0] = box.min;
  const [x1, y1] = box.max;
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const at = (x: number, y: number): Point => apply(matrix, [x, y]);
  if (!(w > 0) && !(h > 0)) return null;
  if (kind === "linear") {
    if (w > 0) return { kind, start: at(x0, cy), end: at(x1, cy), across: at(x0, cy + w) };
    return { kind, start: at(cx, y0), end: at(cx, y1), across: at(cx - h, y0) };
  }
  const rx = w > 0 ? w / 2 : h / 2;
  const ry = h > 0 ? h / 2 : w / 2;
  return { kind, center: at(cx, cy), a: at(cx + rx, cy), b: at(cx, cy + ry), focus: at(cx, cy) };
}

/// `place` come sfumatura dell'altro tipo, dov'era: il mezzo della linea
/// diventa il centro, e il suo secondo capo il capo del raggio, in un
/// cerchio; il diametro del primo raggio diventa la linea. `null` se
/// `place` non ha misura.
export function placeAs(place: GradientPlace, kind: GradientKind): GradientPlace | null {
  if (place.kind === kind) return place;
  if (place.kind === "linear") {
    if (span(place.start, place.end) === 0) return null;
    const center = mid(place.start, place.end);
    return { kind: "radial", center, a: place.end, b: add(center, quarter(sub(place.end, center))), focus: center };
  }
  if (span(place.a, place.center) === 0) return null;
  const start = sub(scale(place.center, 2), place.a);
  return { kind: "linear", start, end: place.a, across: add(start, quarter(sub(place.a, start))) };
}

/// Il punto della scena dove sta `t`, da 0 a 1, lungo la linea di `place`:
/// per una radiale, lungo il primo raggio.
export function pointAt(place: GradientPlace, t: number): Point {
  const [from, to] = place.kind === "linear" ? [place.start, place.end] : [place.center, place.a];
  return add(from, scale(sub(to, from), t));
}

/// Dove sta il punto `p` della scena lungo la linea di `place`: sulla riga
/// di uguale colore che passa per lui, per una lineare; per una radiale
/// lungo il primo raggio. 0 al primo capo, 1 al secondo, oltre fuori.
export function placeAt(place: GradientPlace, p: Point): number {
  if (place.kind === "linear") {
    const d = sub(place.end, place.start);
    const w = sub(place.across, place.start);
    const den = cross(d, w);
    if (Math.abs(den) > 1e-12 * dot(d, d)) return cross(sub(p, place.start), w) / den;
    const squared = dot(d, d);
    return squared > 0 ? dot(sub(p, place.start), d) / squared : 0;
  }
  const r = sub(place.a, place.center);
  const squared = dot(r, r);
  return squared > 0 ? dot(sub(p, place.center), r) / squared : 0;
}

// ---------------------------------------------------------------------------
// I punti.
// ---------------------------------------------------------------------------

/// `stops` in ordine, ognuno fra 0 e 1, coi colori minuscoli: a parità di
/// posizione resta l'ordine di prima.
export function sortedStops(stops: readonly GradientStop[]): GradientStop[] {
  const clamp = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
  return stops
    .map((stop) => ({ offset: clamp(stop.offset), color: stop.color.toLowerCase(), opacity: clamp(stop.opacity) }))
    .map((stop, at) => ({ stop, at }))
    .sort((p, q) => p.stop.offset - q.stop.offset || p.at - q.at)
    .map(({ stop }) => stop);
}

/// Il colore e l'opacità che `stops` hanno in `t`, mescolati in sRGB come
/// li disegna SVG.
export function stopAt(stops: readonly GradientStop[], t: number): { readonly color: string; readonly opacity: number } {
  const first = stops[0]!;
  if (t <= first.offset) return first;
  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i]!;
    if (t > stop.offset) continue;
    const before = stops[i - 1]!;
    const k = stop.offset > before.offset ? (t - before.offset) / (stop.offset - before.offset) : 1;
    const p = rgbOf(before.color);
    const q = rgbOf(stop.color);
    return { color: hex(p.map((value, at) => value + (q[at]! - value) * k)), opacity: before.opacity + (stop.opacity - before.opacity) * k };
  }
  return stops[stops.length - 1]!;
}

/// I tre canali di `#rrggbb`.
function rgbOf(color: string): [number, number, number] {
  const value = paint(color);
  return value === null || value === "none" ? [0, 0, 0] : [value[0], value[1], value[2]];
}

/// `stops` con un punto in più in `t`, del colore e dell'opacità che si
/// vedono lì, così che niente cambi a vederlo; e dove sta il nuovo.
export function withStop(stops: readonly GradientStop[], t: number): { readonly stops: GradientStop[]; readonly index: number } {
  const at = Math.min(1, Math.max(0, t));
  const seen = stopAt(stops, at);
  // Dopo i punti nella stessa posizione, come in Illustrator.
  let index = stops.findIndex((stop) => stop.offset > at);
  if (index < 0) index = stops.length;
  const out = [...stops];
  out.splice(index, 0, { offset: at, color: seen.color, opacity: seen.opacity });
  return { stops: out, index };
}

/// `stops` col punto `index` in `t`, rimesso in ordine; e dove sta adesso.
export function movedStop(stops: readonly GradientStop[], index: number, t: number): { readonly stops: GradientStop[]; readonly index: number } {
  const moved = { ...stops[index]!, offset: Math.min(1, Math.max(0, t)) };
  const rest = stops.filter((_, at) => at !== index);
  // Fra i punti della stessa posizione resta dalla parte da cui arriva.
  const from = stops[index]!.offset;
  let to = moved.offset === from ? index : rest.findIndex((stop) => (moved.offset < from ? stop.offset > moved.offset : stop.offset >= moved.offset));
  if (to < 0) to = rest.length;
  rest.splice(to, 0, moved);
  return { stops: rest, index: to };
}

/// `stops` rovesciati: il primo colore all'altro capo.
export function reversedStops(stops: readonly GradientStop[]): GradientStop[] {
  return stops.map((stop) => ({ ...stop, offset: 1 - stop.offset })).reverse();
}

/// La sfumatura che nasce da `color`: lui pieno al primo capo, trasparente
/// all'altro, come in Inkscape e in Figma. Senza un colore, dal bianco al
/// nero, come in Illustrator.
export function fadeOf(color: string | null): GradientStop[] {
  if (color === null) {
    return [
      { offset: 0, color: "#ffffff", opacity: 1 },
      { offset: 1, color: "#000000", opacity: 1 },
    ];
  }
  return [
    { offset: 0, color, opacity: 1 },
    { offset: 1, color, opacity: 0 },
  ];
}

/// La media dei colori di `stops` lungo la sfumatura, pesata sull'opacità:
/// il ripiego di chi la usa, `#rrggbb` minuscolo.
export function averageColor(stops: readonly GradientStop[]): string {
  if (stops.length === 0) return "#000000";
  // Il colore e l'opacità in ogni tratto, coi capi pieni del primo e
  // dell'ultimo punto.
  const pieces: Array<{ readonly from: GradientStop; readonly to: GradientStop; readonly width: number }> = [];
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (first.offset > 0) pieces.push({ from: first, to: first, width: first.offset });
  for (let i = 1; i < stops.length; i++) pieces.push({ from: stops[i - 1]!, to: stops[i]!, width: stops[i]!.offset - stops[i - 1]!.offset });
  if (last.offset < 1) pieces.push({ from: last, to: last, width: 1 - last.offset });
  const sum = [0, 0, 0];
  const plain = [0, 0, 0];
  let weight = 0;
  let total = 0;
  for (const { from, to, width } of pieces) {
    if (!(width > 0)) continue;
    const p = rgbOf(from.color);
    const q = rgbOf(to.color);
    const [a0, a1] = [from.opacity, to.opacity];
    for (let c = 0; c < 3; c++) {
      const [from, to] = [p[c]!, q[c]!];
      // ∫ (p(1−s) + qs)(a0(1−s) + a1 s) ds, e ∫ p(1−s) + qs ds.
      sum[c] = sum[c]! + width * ((from * a0) / 3 + (from * a1 + to * a0) / 6 + (to * a1) / 3);
      plain[c] = plain[c]! + (width * (from + to)) / 2;
    }
    weight += (width * (a0 + a1)) / 2;
    total += width;
  }
  if (total === 0) return first.color;
  return hex(weight > 1e-9 ? sum.map((value) => value / weight) : plain.map((value) => value / total));
}

/// Una sfumatura pronta del menu: il nome, e i punti; quella senza punti è
/// la dissolvenza del colore che la sfumatura ha già.
export interface GradientPreset {
  readonly id: string;
  readonly label: DrawKey;
  readonly stops: readonly GradientStop[] | null;
}

/// I punti di `colors`, pieni e a distanze uguali.
const evenly = (...colors: string[]): GradientStop[] => colors.map((color, at) => ({ offset: colors.length === 1 ? 0 : at / (colors.length - 1), color, opacity: 1 }));

/// Le sfumature pronte, coi colori della tavolozza: si leggono anche con le
/// forme comuni di daltonismo.
export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  { id: "fade", label: "draw.gradient.preset.fade", stops: null },
  { id: "mono", label: "draw.gradient.preset.mono", stops: evenly("#ffffff", "#000000") },
  { id: "sky", label: "draw.gradient.preset.sky", stops: evenly("#56b4e9", "#0072b2") },
  { id: "sunset", label: "draw.gradient.preset.sunset", stops: evenly("#f0e442", "#e69f00", "#d55e00") },
  { id: "meadow", label: "draw.gradient.preset.meadow", stops: evenly("#f0e442", "#009e73") },
  { id: "dusk", label: "draw.gradient.preset.dusk", stops: evenly("#cc79a7", "#0072b2") },
];

// ---------------------------------------------------------------------------
// Scrivere.
// ---------------------------------------------------------------------------

/// Un cambio delle sfumature della selezione.
export type GradientChange =
  /// Il tipo: un colore, il primo della sfumatura, o una sfumatura; un
  /// colore diventa la sua dissolvenza.
  | { readonly kind: GradientKind | "color" }
  /// I punti: un colore diventa una lineare.
  | { readonly stops: readonly GradientStop[] }
  | { readonly spread: Spread }
  /// L'angolo della linea, o del primo raggio, come [`placeAngle`].
  | { readonly angle: number }
  /// Dove sta, nella scena, uguale per tutte; un colore diventa la
  /// sfumatura `look`, se c'è, o la sua dissolvenza.
  | { readonly place: GradientPlace; readonly look?: GradientLook }
  /// Ciascuna la dissolvenza del suo primo colore, o del suo colore, dove
  /// sta.
  | { readonly fade: true }
  /// Ciascuna coi punti rovesciati.
  | { readonly reverse: true };

/// Ciò che una parte diventa: un colore, o una sfumatura dove sta; con
/// `place` `null` le coordinate restano quelle che sono.
type Next = { readonly color: string } | { readonly look: GradientLook; readonly place: GradientPlace | null };

/// Il colore di `part` da cui nasce una sfumatura: il suo, quello di un
/// campione, il ripiego di un motivo; `null` per nessuno.
function baseColor(part: Painted, resources: ReadonlyMap<string, LeafNode>): string | null {
  const used = paintReference(part.value);
  if (used === null) return customColor(part.value);
  const swatch = resources.get(used.id)?.details?.swatch;
  if (swatch !== undefined) return swatch.color;
  return used.fallback === null || used.fallback === "none" ? null : paintCode(used.fallback);
}

/// Ciò che `part` diventa con `change`; `null` se resta com'è.
function nextOf(part: Painted, change: GradientChange, resources: ReadonlyMap<string, LeafNode>): Next | null {
  const used = part.gradient;
  const fresh = (kind: GradientKind, stops: readonly GradientStop[]): Next | null => {
    const placed = defaultPlace(kind, part.matrix, part.box);
    return placed === null ? null : { look: { kind, stops, spread: "pad" }, place: placed };
  };
  if ("kind" in change) {
    if (change.kind === "color") return used === null ? null : { color: used.look.stops[0]!.color };
    if (used === null) return fresh(change.kind, fadeOf(baseColor(part, resources)));
    if (used.look.kind === change.kind) return null;
    const placed = (used.place === null ? null : placeAs(used.place, change.kind)) ?? defaultPlace(change.kind, part.matrix, part.box);
    return placed === null ? null : { look: { ...used.look, kind: change.kind }, place: placed };
  }
  if ("stops" in change) {
    const stops = sortedStops(change.stops);
    if (stops.length === 0) return null;
    return used === null ? fresh("linear", stops) : { look: { ...used.look, stops }, place: used.place };
  }
  if ("spread" in change) return used === null ? null : { look: { ...used.look, spread: change.spread }, place: used.place };
  if ("angle" in change) return used === null || used.place === null ? null : { look: used.look, place: placeTurned(used.place, change.angle) };
  if ("fade" in change) {
    const stops = fadeOf(used === null ? baseColor(part, resources) : used.look.stops[0]!.color);
    return used === null ? fresh("linear", stops) : { look: { ...used.look, stops }, place: used.place };
  }
  if ("reverse" in change) return used === null ? null : { look: { ...used.look, stops: reversedStops(used.look.stops) }, place: used.place };
  const kind = change.place.kind;
  const look = change.look ?? used?.look ?? { kind, stops: fadeOf(baseColor(part, resources)), spread: "pad" as const };
  return { look: { kind, stops: sortedStops(look.stops), spread: look.spread }, place: change.place };
}

/// I punti che dicono dove sta `place`.
const pointsOf = (place: GradientPlace): readonly Point[] => (place.kind === "linear" ? [place.start, place.end, place.across] : [place.center, place.a, place.b, place.focus]);

/// Le coordinate di una sfumatura che sta in `place`, per una parte con la
/// matrice `matrix`, nelle sue coordinate, e la `gradientTransform` se
/// serve; `null` se la parte schiaccia il piano o la sfumatura non ha
/// misura.
export function writtenPlace(place: GradientPlace, matrix: Matrix): Record<string, string> | null {
  const back = invert(matrix);
  if (back === null || !pointsOf(place).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return null;
  const local = (p: Point): Point => apply(back, p);
  const rounded = (p: Point): Point => [Number(coord(p[0])), Number(coord(p[1]))];
  if (place.kind === "linear") {
    const q1 = rounded(local(place.start));
    const q2 = rounded(local(place.end));
    const d = sub(q2, q1);
    const squared = dot(d, d);
    if (!(squared > 0)) return null;
    const out: Record<string, string> = { x1: coord(q1[0]), y1: coord(q1[1]), x2: coord(q2[0]), y2: coord(q2[1]) };
    const w = sub(local(place.across), local(place.start));
    const den = cross(d, w);
    if (!(Math.abs(den) > 1e-9 * Math.sqrt(squared) * Math.hypot(w[0], w[1]))) return out;
    // Le righe di uguale colore, di traverso alla linea nelle coordinate
    // della sfumatura, vanno lungo `w` in quelle della parte: uno
    // scorrimento lungo la linea, che tiene fermi i due capi.
    const n = quarter(d);
    const sigma = -cross(n, w) / den;
    if (Math.abs(sigma) < 1e-6) return out;
    const k = sigma / squared;
    out.gradientTransform = formatTransform(about(q1, [1 + k * n[0] * d[0], k * n[0] * d[1], k * n[1] * d[0], 1 + k * n[1] * d[1], 0, 0]));
    return out;
  }
  const c = rounded(local(place.center));
  const u = sub(local(place.a), local(place.center));
  const v = sub(local(place.b), local(place.center));
  const r = Number(coord(Math.hypot(u[0], u[1])));
  if (!(r > 0) || !(Math.abs(cross(u, v)) > 1e-9 * r * r)) return null;
  // Il cerchio portato sull'ellisse, il raggio orizzontale su `u` e quello
  // verticale su `v`: nessuna trasformazione se ci stanno già.
  const tolerance = 1e-4 * r;
  const plain = Math.abs(u[0] - r) <= tolerance && Math.abs(u[1]) <= tolerance && Math.abs(v[0]) <= tolerance && Math.abs(v[1] - r) <= tolerance;
  const shape = plain ? IDENTITY : about(c, [u[0] / r, u[1] / r, v[0] / r, v[1] / r, 0, 0]);
  const inside = invert(shape);
  if (inside === null) return null;
  const out: Record<string, string> = { cx: coord(c[0]), cy: coord(c[1]), r: coord(r) };
  // Il fuoco dentro il bordo anche dopo l'arrotondamento: al più, nel
  // centro.
  const f = sub(apply(inside, local(place.focus)), c);
  const away = Math.hypot(f[0], f[1]);
  for (let step = 0; step <= 99; step++) {
    const limit = FOCUS_LIMIT - step / 100;
    const k = away > limit * r ? (limit * r) / away : 1;
    const fx = Number(coord(c[0] + f[0] * k));
    const fy = Number(coord(c[1] + f[1] * k));
    if (Math.hypot(fx - c[0], fy - c[1]) >= r && step < 99) continue;
    if (step < 99 && (fx !== c[0] || fy !== c[1])) {
      out.fx = coord(fx);
      out.fy = coord(fy);
    }
    break;
  }
  if (!plain) out.gradientTransform = formatTransform(shape);
  return out;
}

/// Gli attributi di un punto, come li scrive il file.
function stopAttrs(stop: GradientStop): Record<string, string> {
  const attrs: Record<string, string> = { offset: share(stop.offset), "stop-color": stop.color };
  if (stop.opacity < 1) attrs["stop-opacity"] = share(stop.opacity);
  return attrs;
}

/// Gli attributi di SVG di una sfumatura che [`gradientOps`] scrive o
/// toglie: le coordinate, le unità, la trasformazione e come continua.
const GRADIENT_ATTRS = ["gradientUnits", "x1", "y1", "x2", "y2", "cx", "cy", "r", "fx", "fy", "gradientTransform", "spreadMethod"] as const;

/// Gli attributi di una sfumatura con le coordinate `coords`.
function gradientAttrs(look: GradientLook, coords: Readonly<Record<string, string>>): Record<string, string> {
  const attrs: Record<string, string> = { gradientUnits: "userSpaceOnUse", ...coords };
  if (look.spread !== "pad") attrs.spreadMethod = look.spread;
  return attrs;
}

/// Le coordinate che la sfumatura `node` ha già, com'è scritta: per una
/// sfumatura che cambia i punti e resta dove sta, senza che la si possa
/// riscrivere nelle coordinate di chi la usa.
function keptCoords(node: LeafNode): Record<string, string> {
  const written = plainAttributes(node);
  const out: Record<string, string> = {};
  for (const name of GRADIENT_ATTRS) {
    const value = written.get(name);
    if (value !== undefined && name !== "spreadMethod") out[name] = trim(value);
  }
  return out;
}

/// Ciò che vale un attributo che manca.
const UNWRITTEN: Readonly<Record<string, string>> = {
  gradientUnits: "objectBoundingBox",
  spreadMethod: "pad",
  gradientTransform: formatTransform(IDENTITY),
  offset: "0",
  "stop-color": "#000000",
  "stop-opacity": "1",
};

/// Vero se il file scrive `before` dove si scriverebbe `after`, `null` per
/// un attributo che manca: lo stesso numero, lo stesso colore, la stessa
/// trasformazione.
function sameAttr(name: string, before: string | null, after: string | null): boolean {
  const was = before ?? UNWRITTEN[name] ?? null;
  const will = after ?? UNWRITTEN[name] ?? null;
  if (was === null || will === null) return was === will;
  if (trim(was) === will) return true;
  switch (name) {
    case "gradientUnits":
    case "spreadMethod":
      return false;
    case "gradientTransform": {
      const m = parseTransform(was);
      return m !== null && formatTransform(m) === will;
    }
    case "offset": {
      const n = fraction(was);
      return n !== null && share(n) === will;
    }
    case "stop-opacity": {
      const n = parseOpacity(was);
      return n !== null && share(n) === will;
    }
    case "stop-color":
      return customColor(was) === will;
    default: {
      const n = length(was);
      return n !== null && coord(n) === will;
    }
  }
}

/// I `set` che portano la sfumatura `node`, usata come `used`, a `look`,
/// con gli attributi `wanted`; nessuno se è già così.
function setOps(node: LeafNode, used: UsedGradient, look: GradientLook, wanted: Readonly<Record<string, string>>): Op[] {
  const ops: Op[] = [];
  const id = node.facts.id!;
  const written = plainAttributes(node);
  const attrs: Record<string, string | null> = {};
  for (const name of GRADIENT_ATTRS) {
    const before = written.get(name) ?? null;
    const after = name === "spreadMethod" ? (look.spread === "pad" ? null : look.spread) : (wanted[name] ?? null);
    if (!sameAttr(name, before, after)) attrs[name] = after;
  }
  if (Object.keys(attrs).length > 0) ops.push({ op: "set", id, attrs });
  const elem = elemOf(node);
  look.stops.forEach((stop, at) => {
    const index = used.parts[at]!;
    const before = elem?.children?.[index]?.attrs ?? {};
    const after = stopAttrs(stop);
    const changes: Record<string, string | null> = {};
    for (const name of ["offset", "stop-color", "stop-opacity"]) {
      if (!sameAttr(name, before[name] ?? null, after[name] ?? null)) changes[name] = after[name] ?? null;
    }
    if (Object.keys(changes).length > 0) ops.push({ op: "set", id, part: [index], attrs: changes });
  });
  return ops;
}

/// Una sfumatura nuova, privata.
function gradientElem(id: string, look: GradientLook, attrs: Readonly<Record<string, string>>): Elem {
  return {
    tag: look.kind === "linear" ? "linearGradient" : "radialGradient",
    attrs: { id, "fub:role": "private", ...attrs },
    children: look.stops.map((stop) => ({ tag: "stop", attrs: stopAttrs(stop) })),
  };
}

/// Ciò che una parte mostra dopo un cambio, pronto da scrivere: un colore,
/// o una sfumatura con gli attributi della sua geometria, che con
/// `inPlace` è la sua, cambiata dove sta.
type Plan =
  | { readonly color: string }
  | { readonly look: GradientLook; readonly attrs: Readonly<Record<string, string>>; readonly inPlace: boolean };

/// Ciò che `part` mostra con `change`; `null` se resta com'è, o se la
/// sfumatura non ci sta.
function planOf(part: Painted, change: GradientChange, resources: ReadonlyMap<string, LeafNode>): Plan | null {
  const next = nextOf(part, change, resources);
  if (next === null || "color" in next) return next;
  const used = part.gradient;
  const node = used === null ? undefined : resources.get(used.id);
  const spread: Record<string, string> = next.look.spread === "pad" ? {} : { spreadMethod: next.look.spread };
  if (next.place !== null) {
    const coords = writtenPlace(next.place, part.matrix);
    if (coords === null) return null;
    const attrs = gradientAttrs(next.look, coords);
    const inPlace = used !== null && node !== undefined && used.own && used.look.kind === next.look.kind && used.parts.length === next.look.stops.length;
    return { look: next.look, attrs, inPlace };
  }
  // Una sfumatura che non si riscrive nelle coordinate di chi la usa
  // cambia i punti dove sta, se è dello stesso tipo.
  if (node === undefined || used === null || used.look.kind !== next.look.kind) return null;
  const attrs = { ...keptCoords(node), ...spread };
  return { look: next.look, attrs, inPlace: used.own && used.parts.length === next.look.stops.length };
}

/// Ciò che una parte mostrerebbe, per l'anteprima: l'attributo che scrive
/// il colore, e un colore o la sfumatura intera, con un id qualunque.
export interface PreviewPaint {
  readonly name: "fill" | "stroke";
  readonly value: string | Elem;
}

/// Ciò che le parti di `units` che mostrano `channel`, o soltanto quelle di
/// `only`, mostrerebbero con `change`, per l'anteprima. Le parti che
/// restano come sono non ci sono.
export function gradientPreview(
  model: DocumentModel,
  units: readonly Unit[],
  channel: PaintChannel,
  change: GradientChange,
  only: ReadonlySet<ElementPart> | null = null,
): Map<ElementPart, PreviewPaint> {
  const resources = resourcesOf(model);
  const out = new Map<ElementPart, PreviewPaint>();
  for (const part of paintedParts(model, units, channel)) {
    if (only !== null && !only.has(part.node)) continue;
    const plan = planOf(part, change, resources);
    if (plan === null) continue;
    out.set(part.node, { name: part.name, value: "color" in plan ? plan.color : gradientElem("preview", plan.look, plan.attrs) });
  }
  return out;
}

/// Il cambio pronto, e quante parti cambiano.
export interface GradientChanged extends Restyled {
  /// Le parti a cui il cambio arriva.
  readonly reached: number;
}

/// Le operazioni che danno `change` alle parti di `units` che mostrano
/// `channel`, o soltanto a quelle di `only`, in un passo; la selezione
/// resta la stessa.
export function gradientOps(
  model: DocumentModel,
  units: readonly Unit[],
  channel: PaintChannel,
  change: GradientChange,
  measure: Measure,
  ids: NewIds,
  only: ReadonlySet<ElementPart> | null = null,
): GradientChanged {
  const resources = resourcesOf(model);
  const before: Op[] = [];
  const values = new Map<ElementPart, string>();
  let home: Home | null = null;
  let reached = 0;
  for (const part of paintedParts(model, units, channel)) {
    if (only !== null && !only.has(part.node)) continue;
    const plan = planOf(part, change, resources);
    if (plan === null) continue;
    reached++;
    if ("color" in plan) {
      values.set(part.node, plan.color);
      continue;
    }
    const used = part.gradient;
    const node = used === null ? undefined : resources.get(used.id);
    const fallback = averageColor(plan.look.stops);
    if (plan.inPlace) {
      before.push(...setOps(node!, used!, plan.look, plan.attrs));
      values.set(part.node, `url(#${used!.id}) ${fallback}`);
      continue;
    }
    if (home === null) {
      home = homeOf(model);
      before.push(...home.prelude);
    }
    const id = ids.next("resource");
    // Accanto a quella che prende il posto, se stanno nella stessa `defs`.
    const beside = used !== null && used.own && node?.parent?.facts.id === home.parent;
    before.push({ op: "add", parent: home.parent, pos: beside ? { after: used.id } : { last: true }, elem: gradientElem(id, plan.look, plan.attrs) });
    values.set(part.node, `url(#${id}) ${fallback}`);
  }
  return { ...paintEachOps(model, units, channel, values, before, measure, ids), reached };
}

// ---------------------------------------------------------------------------
// Coordinate nuove.
// ---------------------------------------------------------------------------

/// Gli attributi che dicono dove sta una sfumatura: le coordinate, le unità e
/// la trasformazione.
const PLACE_ATTRS: readonly string[] = GRADIENT_ATTRS.filter((name) => name !== "spreadMethod");

/// Come segue un oggetto le cui coordinate cambiano, come in «Applica
/// trasformazione», la risorsa `node` che usa come colore: `same` se si vede
/// uguale dovunque, come un campione o una sfumatura di un colore solo;
/// `gradient` per una sfumatura che si legge, e che si riscrive dove si
/// vedeva; `null` per ogni altra, come un motivo o una sfumatura che rimanda
/// a un'altra, che resta nelle coordinate di prima.
export function paintFollows(node: LeafNode): "same" | "gradient" | null {
  if (node.details?.swatch !== undefined) return "same";
  if (node.refs.length > 0) return null;
  const gradient = gradientOf(node);
  if (gradient === null) return null;
  return gradient.stops.length < 2 ? "same" : "gradient";
}

/// Le coordinate della sfumatura `node`, usata da `user`, quando quelle di
/// `user` diventano quelle che dà `m`: si vede dov'era, nelle coordinate di
/// chi la usa (`userSpaceOnUse`), con una `gradientTransform` soltanto dove
/// serve. `null` se non si scrive.
export function movedPlace(node: LeafNode, user: ElementPart, m: Matrix): Record<string, string> | null {
  const placed = placeOf(node, IDENTITY, boxOf(user));
  const coords = placed === null ? null : writtenPlace(placeMapped(placed, m), IDENTITY);
  return coords === null ? null : { gradientUnits: "userSpaceOnUse", ...coords };
}

/// Gli attributi che portano la sfumatura `node` nelle coordinate `coords`
/// di [`movedPlace`]: quelli che cambiano, `null` per quelli da togliere.
export function placeChanges(node: LeafNode, coords: Readonly<Record<string, string>>): Record<string, string | null> {
  const written = plainAttributes(node);
  const out: Record<string, string | null> = {};
  for (const name of PLACE_ATTRS) {
    const before = written.get(name) ?? null;
    const after = coords[name] ?? null;
    if (!sameAttr(name, before, after)) out[name] = after;
  }
  return out;
}

/// La sfumatura `node` come copia privata con l'id `id` e le coordinate
/// `coords` di [`movedPlace`]: il resto com'è, con un id nuovo per ogni sua
/// parte che ne ha uno. `null` se non si scrive.
export function movedCopy(node: LeafNode, id: string, coords: Readonly<Record<string, string>>, ids: NewIds): Elem | null {
  const elem = elemOf(node);
  if (elem === null) return null;
  const attrs: Record<string, string> = { id, "fub:role": "private" };
  for (const [name, value] of Object.entries(elem.attrs)) {
    if (!(name in attrs) && !PLACE_ATTRS.includes(name)) attrs[name] = value;
  }
  Object.assign(attrs, coords);
  const renamed = (each: Elem): Elem => ({
    ...each,
    attrs: each.attrs.id === undefined ? each.attrs : { ...each.attrs, id: ids.next("resource") },
    ...(each.children === undefined ? {} : { children: each.children.map(renamed) }),
  });
  return { ...elem, attrs, ...(elem.children === undefined ? {} : { children: elem.children.map(renamed) }) };
}
