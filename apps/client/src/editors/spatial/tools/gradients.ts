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
import { fraction, length, opacity as parseOpacity, paint, paintReference, transform as parseTransform, trim, type Paint } from "../scene/values";
import { elemOf, plainAttributes } from "./arrange";
import type { NewIds } from "./edit";
import { geometryBox, type Unit } from "./hit";
import { paintEachOps, paintParts, type PaintPart, type Restyled } from "./look";
import type { Measure } from "./measure";
import { hatchOf } from "./hatches";
import { customColor } from "./palette";
import { gradientOf, homeOf, paintCode, resourcesOf, usersOf, type Home } from "./resources";

/// Il colore che si cambia: il riempimento o il contorno.
export type PaintChannel = "fill" | "stroke";

export type GradientKind = "linear" | "radial";

/// Come una sfumatura continua oltre i suoi capi: col colore del capo, a
/// specchio o daccapo.
export type Spread = "pad" | "reflect" | "repeat";

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
  /// Il colore da cui ne nasce una, `#rrggbb` minuscolo: quello pieno, il
  /// fondo di una campitura o, senza fondo, il colore delle sue righe, il
  /// ripiego di un motivo; `null` per una sfumatura o nessun colore.
  readonly base: string | null;
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
    if (used === null) {
      const solid = customColor(part.value);
      return { ...part, matrix, box, gradient: null, solid, base: solid };
    }
    if (node === undefined || read === null) {
      const solid = node?.details?.swatch?.color ?? null;
      return { ...part, matrix, box, gradient: null, solid, base: solid ?? patternBase(node, used.fallback) };
    }
    const other = part.own.get(part.name === "fill" ? "stroke" : "fill");
    let own = node.details?.lifecycle === "private" && paintReference(part.own.get(part.name) ?? "")?.id === used.id && (other === undefined || paintReference(other)?.id !== used.id);
    if (own) {
      users ??= usersOf(model);
      own = users.get(used.id) === 1;
    }
    const placed = read.look.stops.length < 2 ? defaultPlace(read.look.kind, matrix, box) : placeOf(node, matrix, box);
    return { ...part, matrix, box, gradient: { id: used.id, look: read.look, place: placed, parts: read.parts, own }, solid: null, base: null };
  });
}

/// Il colore da cui nasce una sfumatura per chi mostra la risorsa `node`,
/// che non è un colore, col ripiego `fallback`: il fondo di una campitura,
/// il colore che l'oggetto aveva, o il colore delle righe se non ne ha uno;
/// il ripiego, il colore medio di un motivo; `null` per nessuno.
function patternBase(node: LeafNode | undefined, fallback: Paint | null): string | null {
  const hatch = node === undefined ? null : hatchOf(node);
  if (hatch !== null) return hatch.background ?? hatch.color;
  return fallback === null || fallback === "none" ? null : paintCode(fallback);
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
  /// Vero se una parte senza sfumatura ha un colore da cui ne nasce una:
  /// Lineare e Radiale ne fanno la dissolvenza, e non una sfumatura dal
  /// bianco al nero.
  readonly based: boolean;
  /// La sfumatura comune a parte dove sta; `null` se misto, o senza.
  readonly look: GradientLook | null;
  /// L'angolo comune della linea, o del primo raggio di una radiale, delle
  /// parti con una sfumatura, in gradi in senso orario fra -180 escluso e
  /// 180, al centesimo; `null` se misto, o senza.
  readonly angle: number | null;
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

/// I tre canali di `#rrggbb`.
function rgbOf(color: string): [number, number, number] {
  const value = paint(color);
  return value === null || value === "none" ? [0, 0, 0] : [value[0], value[1], value[2]];
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

/// Ciò che `part` diventa con `change`; `null` se resta com'è.
function nextOf(part: Painted, change: GradientChange): Next | null {
  const used = part.gradient;
  const fresh = (kind: GradientKind, stops: readonly GradientStop[]): Next | null => {
    const placed = defaultPlace(kind, part.matrix, part.box);
    return placed === null ? null : { look: { kind, stops, spread: "pad" }, place: placed };
  };
  if ("kind" in change) {
    if (change.kind === "color") return used === null ? null : { color: used.look.stops[0]!.color };
    if (used === null) return fresh(change.kind, fadeOf(part.base));
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
    const stops = fadeOf(used === null ? part.base : used.look.stops[0]!.color);
    return used === null ? fresh("linear", stops) : { look: { ...used.look, stops }, place: used.place };
  }
  if ("reverse" in change) return used === null ? null : { look: { ...used.look, stops: reversedStops(used.look.stops) }, place: used.place };
  const kind = change.place.kind;
  const look = change.look ?? used?.look ?? { kind, stops: fadeOf(part.base), spread: "pad" as const };
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
  const next = nextOf(part, change);
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
