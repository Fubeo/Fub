// Le risorse del disegno viste dall'editor (formato della scena, risorse): le
// sfumature, i motivi, i marcatori, i ritagli, le maschere e i filtri che
// stanno nelle `defs` della radice e che gli oggetti usano per riferimento.
//
// - **Dove stanno.** Le risorse modificabili sono figlie di una `defs` della
//   radice. Le nuove vanno nella `defs` di FubDraw, `fub-defs`, o nella prima
//   `defs` della radice che ha un id; se non ce n'è una, il comando crea
//   `fub-defs`.
// - **Di chi sono.** Una risorsa privata è di chi la usa: la copia di un
//   oggetto ha le sue, con id nuovi. Le condivise, e quelle che non sono di
//   FubDraw, restano le stesse. Toglierle quando nessuno le usa più lo fa il
//   motore.
// - **Ciò che si vede resta.** Una risorsa vive nelle coordinate di chi la
//   usa: un oggetto che passa la sua trasformazione nella geometria riscrive
//   le sue sfumature nelle coordinate nuove, e tiene la trasformazione se
//   usa una risorsa che non si riscrive; un gruppo con un ritaglio, una
//   maschera o un filtro non si separa.

import { formatNumber } from "../number";
import type { Bounds } from "../scene/geometry";
import { DEFS_ID } from "../scene/ids";
import { apply, compose, invert, IDENTITY, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, parseFragment, scopeOf, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import { ROOT, type Op } from "../scene/ops";
import { formatTransform, type Elem } from "../scene/serialize";
import { fraction, length, opacity, paint, paintReference, reference, transform as parseTransform, trim, urlIds, type Paint, type Rgb } from "../scene/values";
import { NS_NONE, NS_SVG, valueOf, type ElementNode, type XmlDocument } from "../scene/xml";
import type { NewIds } from "./edit";
import { renameUrls } from "./stylesheet";

/// Le risorse modificabili di `model`, per id: i figli delle `defs` della
/// radice. Di due con lo stesso id vale la prima.
export function resourcesOf(model: DocumentModel): Map<string, LeafNode> {
  const out = new Map<string, LeafNode>();
  for (const child of elementChildren(model.root)) {
    if (child.kind !== "container" || child.details?.role !== "defs") continue;
    for (const inner of elementChildren(child)) {
      const id = inner.facts.id;
      if (inner.kind === "leaf" && inner.details?.role === "resource" && id !== null && !out.has(id)) out.set(id, inner);
    }
  }
  return out;
}

/// La `defs` dove vanno le risorse nuove: quella di FubDraw, o la prima
/// della radice che ha un id; `null` se il disegno non ne ha una.
export function resourceHome(model: DocumentModel): ContainerNode | null {
  let first: ContainerNode | null = null;
  for (const child of elementChildren(model.root)) {
    if (child.kind !== "container" || child.details?.role !== "defs" || child.facts.id === null) continue;
    if (child.facts.id === DEFS_ID) return child;
    first ??= child;
  }
  return first;
}

/// Dove un comando aggiunge risorse: l'id della `defs`, e ciò che la crea
/// se il disegno non ne ha una.
export interface Home {
  readonly parent: string;
  readonly prelude: readonly Op[];
}

/// La [`Home`] delle risorse nuove di `model`: senza una `defs` con un id,
/// `fub-defs` nasce per prima fra i figli della radice, dopo titolo e
/// descrizione e prima della carta.
export function homeOf(model: DocumentModel): Home {
  const home = resourceHome(model);
  if (home !== null) return { parent: home.facts.id!, prelude: [] };
  return { parent: DEFS_ID, prelude: [{ op: "add", parent: ROOT, pos: { first: true }, elem: { tag: "defs", attrs: { id: DEFS_ID } } }] };
}

/// Gli attributi che usano una risorsa nelle coordinate di chi li porta, e
/// che un figlio non eredita.
const EFFECTS: readonly string[] = ["clip-path", "mask", "filter"];

/// Vero se un elemento con gli attributi `attrs` ha un ritaglio, una
/// maschera o un filtro: separarlo li perderebbe, e dare la sua
/// trasformazione ai figli li sposterebbe.
export function holdsEffect(attrs: ReadonlyMap<string, string>): boolean {
  return EFFECTS.some((name) => {
    const value = attrs.get(name);
    return value !== undefined && reference(value) !== null;
  });
}

/// Quanti elementi di `model` rimandano a ciascun id: un contenitore coi
/// suoi attributi, un'unità con tutto ciò che contiene.
export function usersOf(model: DocumentModel): Map<string, number> {
  const out = new Map<string, number>();
  const count = (ids: readonly string[]): void => {
    for (const id of new Set(ids)) out.set(id, (out.get(id) ?? 0) + 1);
  };
  const visit = (node: ElementPart): void => {
    if (node.kind === "leaf") {
      count(node.refs);
      return;
    }
    count(node.facts.refs);
    for (const child of elementChildren(node)) visit(child);
  };
  visit(model.root);
  return out;
}

// ---------------------------------------------------------------------------
// Il campione del pannello.
// ---------------------------------------------------------------------------

/// Un colore che è una risorsa, come lo mostra il pannello: il tipo, e per
/// una sfumatura l'immagine CSS dei suoi punti, da sinistra a destra o dal
/// centro, `null` se non si legge, per una campitura la sua; un campione
/// del documento col suo nome, com'è scritto, e il suo colore, `#rrggbb`
/// minuscolo; un motivo del documento col suo nome.
export type PaintSample =
  | { readonly kind: "gradient" | "pattern" | "hatch"; readonly image: string | null }
  | { readonly kind: "swatch"; readonly image: null; readonly name: string; readonly color: string }
  | { readonly kind: "motif"; readonly image: null; readonly name: string };

/// Il campione di `value`, un `fill` o uno `stroke` di `model`; `null` se non
/// usa una sfumatura, un motivo o un campione del disegno. Una campitura è
/// un motivo: la riconosce `look.ts`.
export function paintSample(model: DocumentModel, value: string, resources: ReadonlyMap<string, LeafNode> = resourcesOf(model)): PaintSample | null {
  const used = paintReference(value);
  const node = used === null ? undefined : resources.get(used.id);
  if (node === undefined) return null;
  const swatch = node.details?.lifecycle === "swatch" ? node.details.swatch : undefined;
  if (swatch !== undefined) return { kind: "swatch", image: null, name: swatch.name, color: swatch.color };
  const motif = node.details?.lifecycle === "swatch" ? node.details.motif : undefined;
  if (motif !== undefined) return { kind: "motif", image: null, name: motif.name };
  switch (node.facts.local) {
    case "pattern":
      return { kind: "pattern", image: null };
    case "linearGradient":
      return { kind: "gradient", image: gradientImage(node, "linear-gradient(to right") };
    case "radialGradient":
      return { kind: "gradient", image: gradientImage(node, "radial-gradient(circle") };
    default:
      return null;
  }
}

/// I punti della sfumatura `node` come immagine CSS, dopo `head`.
function gradientImage(node: LeafNode, head: string): string | null {
  const read = readGradient(node);
  if (read === null) return null;
  const stops: Array<[string, number]> = read.stops.map((stop) => [`rgb(${stop.color.join(" ")} / ${formatNumber(stop.alpha, 3)})`, stop.offset]);
  // Un punto solo è un colore pieno; CSS ne vuole due.
  if (stops.length === 1) stops.push([stops[0]![0], 1]);
  return `${head}, ${stops.map(([color, at]) => `${color} ${formatNumber(at * 100, 2)}%`).join(", ")})`;
}

/// Un punto di una sfumatura: dove sta, fra 0 e 1, il colore e la sua
/// opacità, e il suo posto fra i figli elemento della sfumatura, per un
/// `set` con `part`.
export interface Stop {
  readonly offset: number;
  readonly color: Rgb;
  readonly alpha: number;
  readonly index: number;
}

/// L'elemento della sfumatura `node`, nel suo frammento, e i suoi punti:
/// ognuno fra 0 e 1, mai prima del precedente, come li porta SVG. `null` se
/// non ne ha, o se un colore non si legge.
function readGradient(node: LeafNode): { readonly doc: XmlDocument; readonly element: ElementNode; readonly stops: readonly Stop[] } | null {
  const fragment = parseFragment(node.raw, scopeOf(node.parent!));
  if (fragment === null) return null;
  const { doc } = fragment;
  const element = doc.element(fragment.id)!;
  const stops: Stop[] = [];
  let last = 0;
  let index = -1;
  for (const child of element.children) {
    const stop = doc.element(child);
    if (stop === null) continue;
    index++;
    if (stop.ns !== NS_SVG || stop.local !== "stop") continue;
    const color = paint(valueOf(stop, NS_NONE, "stop-color") ?? "black");
    if (color === null || color === "none") return null;
    const alpha = opacity(valueOf(stop, NS_NONE, "stop-opacity") ?? "1") ?? 1;
    last = Math.max(last, Math.min(1, Math.max(0, fraction(valueOf(stop, NS_NONE, "offset") ?? "0") ?? 0)));
    stops.push({ offset: last, color, alpha, index });
  }
  return stops.length === 0 ? null : { doc, element, stops };
}

// ---------------------------------------------------------------------------
// Il colore di una sfumatura in un punto.
// ---------------------------------------------------------------------------

/// Una sfumatura lineare o radiale, letta per sapere il suo colore in un
/// punto: le coordinate nelle sue unità, `x1 y1 x2 y2` o `cx cy r fx fy`.
export interface Gradient {
  readonly kind: "linear" | "radial";
  readonly coords: readonly number[];
  /// Vero nelle unità del riquadro di chi la usa (`objectBoundingBox`).
  readonly inBox: boolean;
  readonly transform: Matrix;
  readonly spread: "pad" | "reflect" | "repeat";
  readonly stops: readonly Stop[];
}

/// La sfumatura `node`, una risorsa del disegno; `null` se non è una
/// sfumatura o non si legge.
export function gradientOf(node: LeafNode): Gradient | null {
  const local = node.facts.local;
  if (local !== "linearGradient" && local !== "radialGradient") return null;
  const read = readGradient(node);
  if (read === null) return null;
  return gradientFrom(local, (name) => valueOf(read.element, NS_NONE, name)?.trim() ?? null, read.stops);
}

/// La sfumatura `elem`, come la scrive un'operazione, letta come
/// [`gradientOf`]; `null` se non è una sfumatura o non si legge.
export function gradientOfElem(elem: Elem): Gradient | null {
  if (elem.tag !== "linearGradient" && elem.tag !== "radialGradient") return null;
  const stops: Stop[] = [];
  let last = 0;
  for (const [index, stop] of (elem.children ?? []).entries()) {
    if (stop.tag !== "stop") continue;
    const color = paint(stop.attrs["stop-color"] ?? "black");
    if (color === null || color === "none") return null;
    const alpha = opacity(stop.attrs["stop-opacity"] ?? "1") ?? 1;
    last = Math.max(last, Math.min(1, Math.max(0, fraction(stop.attrs.offset ?? "0") ?? 0)));
    stops.push({ offset: last, color, alpha, index });
  }
  return stops.length === 0 ? null : gradientFrom(elem.tag, (name) => elem.attrs[name]?.trim() ?? null, stops);
}

/// La sfumatura `local` coi punti `stops`, e gli attributi che legge `at`.
function gradientFrom(local: "linearGradient" | "radialGradient", at: (name: string) => string | null, stops: readonly Stop[]): Gradient | null {
  const inBox = at("gradientUnits") !== "userSpaceOnUse";
  // Nel riquadro un numero o una percentuale, nelle coordinate di chi la usa
  // una lunghezza.
  const coord = (name: string, start: number): number | null => {
    const value = at(name);
    if (value === null) return start;
    return inBox ? fraction(value) : length(value);
  };
  const transform = at("gradientTransform");
  const matrix = transform === null ? IDENTITY : parseTransform(transform);
  const written = at("spreadMethod");
  const spread = written === "reflect" || written === "repeat" ? written : "pad";
  const names: ReadonlyArray<readonly [string, number]> =
    local === "linearGradient"
      ? [["x1", 0], ["y1", 0], ["x2", inBox ? 1 : 0], ["y2", 0]]
      : [["cx", 0.5], ["cy", 0.5], ["r", 0.5]];
  const coords = names.map(([name, start]) => coord(name, start));
  if (matrix === null || coords.some((value) => value === null || !Number.isFinite(value))) return null;
  if (local === "radialGradient") {
    // Il fuoco sta nel centro, se non è scritto.
    const fx = coord("fx", coords[0]!);
    const fy = coord("fy", coords[1]!);
    if (fx === null || fy === null) return null;
    coords.push(fx, fy);
  }
  return { kind: local === "linearGradient" ? "linear" : "radial", coords: coords as number[], inBox, transform: matrix, spread, stops };
}

/// Il colore di `gradient` nel punto `p`, nelle coordinate di chi la usa, il
/// cui riquadro è `box`, come lo disegna SVG: i colori fra due punti si
/// mescolano in sRGB, e l'opacità non conta. `null` se in quel punto non si
/// disegna: nelle unità del riquadro, un riquadro senza larghezza o altezza.
export function gradientColor(gradient: Gradient, p: Point, box: Bounds | null): Rgb | null {
  return gradientPaint(gradient, p, box)?.color ?? null;
}

/// Il colore di `gradient` nel punto `p`, come [`gradientColor`], con
/// l'opacità dei punti in quel punto, fra 0 e 1: si mescola come i colori.
export function gradientPaint(gradient: Gradient, p: Point, box: Bounds | null): { readonly color: Rgb; readonly alpha: number } | null {
  const t = gradientAt(gradient, p, box);
  return t === null ? null : stopPaint(gradient.stops, spreadOf(t, gradient.spread));
}

/// Dove sta il punto `p` lungo `gradient`, prima che la sfumatura continui
/// oltre i suoi capi, come in [`gradientColor`]; `null` se lì non si
/// disegna.
function gradientAt(gradient: Gradient, p: Point, box: Bounds | null): number | null {
  let space = gradient.transform;
  if (gradient.inBox) {
    if (box === null) return null;
    const w = box.max[0] - box.min[0];
    const h = box.max[1] - box.min[1];
    if (!(w > 0 && h > 0)) return null;
    space = compose([w, 0, 0, h, box.min[0], box.min[1]], space);
  }
  const back = invert(space);
  if (back === null) return null;
  const [x, y] = apply(back, p);
  return gradient.kind === "linear" ? linearAt(gradient.coords, x, y) : radialAt(gradient.coords, x, y);
}

/// Vero se `a` e `b` si vedono uguali su chi le usa, il cui riquadro è
/// `box`: gli stessi punti e lo stesso modo di continuare oltre i capi, e in
/// ogni punto del riquadro lo stesso posto lungo la sfumatura, a meno di un
/// millesimo. Due scritture diverse della stessa sfumatura, come le
/// coordinate riscritte o una `gradientTransform`, sono uguali.
export function sameGradient(a: Gradient, b: Gradient, box: Bounds): boolean {
  if (a.kind !== b.kind || a.spread !== b.spread || a.stops.length !== b.stops.length) return false;
  const stops = a.stops.every((stop, at) => {
    const other = b.stops[at]!;
    return Math.abs(stop.offset - other.offset) < 1e-4 && stop.color.every((value, k) => value === other.color[k]) && Math.abs(stop.alpha - other.alpha) < 1e-3;
  });
  if (!stops) return false;
  // Una lineare cambia lungo il piano come una funzione affine: bastano gli
  // angoli. Una radiale no: una griglia.
  const steps = a.kind === "linear" ? 1 : 4;
  const [x0, y0] = box.min;
  const [x1, y1] = box.max;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p: Point = [x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * j) / steps];
      const s = gradientAt(a, p, box);
      const t = gradientAt(b, p, box);
      if (s === null || t === null) {
        if (s !== t) return false;
        continue;
      }
      if (Math.abs(spreadOf(s, a.spread) - spreadOf(t, b.spread)) > 1e-3) return false;
    }
  }
  return true;
}

/// Vero se `a` e `b` sono la stessa risorsa a meno degli id, suoi e delle
/// sue parti: stesso tag, stessi attributi in qualunque ordine, stessi
/// figli.
export function sameResource(a: Elem, b: Elem): boolean {
  if (a.tag !== b.tag || (a.text ?? null) !== (b.text ?? null)) return false;
  const names = Object.keys(a.attrs).filter((name) => name !== "id");
  if (names.length !== Object.keys(b.attrs).filter((name) => name !== "id").length || names.some((name) => a.attrs[name] !== b.attrs[name])) return false;
  const inside = a.children ?? [];
  const other = b.children ?? [];
  return inside.length === other.length && inside.every((child, at) => sameResource(child, other[at]!));
}

/// Dove sta `(x, y)` lungo la sfumatura lineare `x1 y1 x2 y2`: 0 sulla
/// perpendicolare dal primo punto, 1 da quella del secondo. Due punti uguali
/// danno il colore dell'ultimo punto, come in SVG.
function linearAt([x1, y1, x2, y2]: readonly number[], x: number, y: number): number {
  const dx = x2! - x1!;
  const dy = y2! - y1!;
  const squared = dx * dx + dy * dy;
  return squared === 0 ? 1 : ((x - x1!) * dx + (y - y1!) * dy) / squared;
}

/// Dove sta `(x, y)` nella sfumatura radiale `cx cy r fx fy`: il cerchio
/// che passa per il punto, fra il fuoco (0) e il cerchio esterno (1). Un
/// fuoco fuori dal cerchio si porta appena dentro, come in SVG 1.1.
function radialAt([cx, cy, r, fx, fy]: readonly number[], x: number, y: number): number {
  if (!(r! > 0)) return 1;
  let ox = fx! - cx!;
  let oy = fy! - cy!;
  const away = Math.hypot(ox, oy);
  const most = r! * 0.999;
  if (away > most) {
    ox = (ox / away) * most;
    oy = (oy / away) * most;
  }
  // Il punto e il centro visti dal fuoco: |p − t·d| = t·r.
  const px = x - (cx! + ox);
  const py = y - (cy! + oy);
  const dx = -ox;
  const dy = -oy;
  const a = dx * dx + dy * dy - r! * r!;
  const b = px * dx + py * dy;
  const c = px * px + py * py;
  // Il fuoco è dentro il cerchio: `a` è negativo, e la radice positiva è
  // una sola.
  const disc = Math.max(0, b * b - a * c);
  return (b - Math.sqrt(disc)) / a;
}

/// `t` portato fra 0 e 1 dal modo in cui la sfumatura continua oltre i
/// suoi capi.
function spreadOf(t: number, spread: Gradient["spread"]): number {
  if (!Number.isFinite(t)) return 1;
  if (spread === "pad") return Math.min(1, Math.max(0, t));
  if (spread === "repeat") return t - Math.floor(t);
  const folded = t - 2 * Math.floor(t / 2);
  return folded <= 1 ? folded : 2 - folded;
}

/// Il colore e l'opacità dei punti `stops` in `t`, fra 0 e 1.
function stopPaint(stops: readonly Stop[], t: number): { readonly color: Rgb; readonly alpha: number } {
  const first = stops[0]!;
  if (t <= first.offset) return { color: first.color, alpha: first.alpha };
  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i]!;
    if (t > stop.offset) continue;
    const before = stops[i - 1]!;
    const span = stop.offset - before.offset;
    const k = span > 0 ? (t - before.offset) / span : 1;
    const color = [0, 1, 2].map((at) => Math.round(before.color[at]! + (stop.color[at]! - before.color[at]!) * k)) as unknown as Rgb;
    return { color, alpha: before.alpha + (stop.alpha - before.alpha) * k };
  }
  const last = stops[stops.length - 1]!;
  return { color: last.color, alpha: last.alpha };
}

/// `color` come lo scrive il file: `#rrggbb` minuscolo, o `none`.
export function paintCode(color: Paint): string {
  return color === "none" ? "none" : `#${color.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/// Il valore che usa il campione `swatch`, col suo colore come ripiego.
export function swatchPaint(swatch: { readonly id: string; readonly color: string }): string {
  return `url(#${swatch.id}) ${swatch.color}`;
}

// ---------------------------------------------------------------------------
// Le copie.
// ---------------------------------------------------------------------------

/// Le copie delle risorse private che usano gli elementi nuovi di un
/// comando, come un duplicato: ognuna con un id nuovo, e una volta sola anche
/// se più elementi la usano. Una risorsa privata che ne usa un'altra privata
/// la porta con sé; le condivise e quelle che non sono di FubDraw restano le
/// stesse.
export class ResourceCopies {
  private readonly resources: Map<string, LeafNode>;
  /// Le risorse copiate: il loro id, e quello della copia.
  private renamed = new Map<string, string>();
  /// Le copie di [`paint`], per chi le riceve.
  private readonly owned = new Map<object, Map<string, string>>();
  private readonly adds: Op[] = [];
  private home: Home | null = null;

  constructor(
    private readonly model: DocumentModel,
    private readonly ids: NewIds,
    /// Una risorsa come la scrive un'operazione: `elemOf` di `arrange.ts`.
    private readonly elemOf: (node: ElementPart) => Elem | null,
    /// Le risorse private com'erano quando uno stile si è copiato: valgono
    /// più di quelle del disegno, che nel frattempo possono essere cambiate
    /// o sparite.
    private readonly kept: ReadonlyMap<string, Elem> = new Map(),
  ) {
    this.resources = resourcesOf(model);
  }

  /// `value`, un `fill` o uno `stroke` di un altro oggetto, per `owner`: una
  /// risorsa privata dell'altro diventa una copia sua, la stessa per tutti i
  /// suoi colori, e una sfumatura nelle coordinate di chi la usa passa dal
  /// riquadro dell'altro al suo con la trasformazione che dà `fit`, se ne dà
  /// una. Le altre risorse restano le stesse. `null` se la copia non si sa
  /// scrivere.
  paint(value: string, owner: object, fit: () => Matrix | null): string | null {
    const used = paintReference(value);
    if (used === null || !(this.kept.has(used.id) || this.resources.get(used.id)?.details?.lifecycle === "private")) return value;
    let renamed = this.owned.get(owner);
    if (renamed === undefined) {
      renamed = new Map();
      this.owned.set(owner, renamed);
    }
    const before = this.renamed;
    this.renamed = renamed;
    try {
      if (!this.copy(used.id, fit)) return null;
      return renameUrls(value, (id) => renamed.get(id) ?? null);
    } finally {
      this.renamed = before;
    }
  }

  /// Vero se `current`, il colore che un oggetto mostra, usa una risorsa
  /// privata che è già la copia che [`paint`] gli darebbe di `value`, con la
  /// trasformazione che dà `fit`: una sfumatura che si vede uguale sul
  /// riquadro dell'oggetto, che dà `box`, o un'altra risorsa uguale a meno
  /// degli id. Ridare lo stesso aspetto non fa un'altra copia.
  same(value: string, current: string, fit: () => Matrix | null, box: () => Bounds | null): boolean {
    const used = paintReference(value);
    const now = paintReference(current);
    if (used === null || now === null || used.id === now.id) return false;
    // Il colore di ripiego è parte del colore.
    if (renameUrls(trim(value), (id) => (id === used.id ? now.id : null)) !== trim(current)) return false;
    const source = this.kept.get(used.id) ?? this.privateElem(used.id);
    const target = this.privateElem(now.id);
    if (source === null || target === null) return false;
    const copy = fitted(source, fit);
    const a = gradientOfElem(copy);
    const b = gradientOfElem(target);
    if (a === null && b === null) return sameResource(copy, target);
    const area = a === null || b === null ? null : box();
    return area !== null && sameGradient(a!, b!, area);
  }

  /// La risorsa privata `id` del disegno, come la scrive un'operazione;
  /// `null` se non c'è o non è privata.
  private privateElem(id: string): Elem | null {
    const node = this.resources.get(id);
    return node === undefined || node.details?.lifecycle !== "private" ? null : this.elemOf(node);
  }

  /// `elem`, con le sue parti, rivolto alle copie delle risorse private che
  /// usa: per riferimento `url(#…)`, o col tracciato di un `textPath`. `null`
  /// se una di loro non si sa scrivere.
  adopt(elem: Elem): Elem | null {
    const attrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(elem.attrs)) {
      const along = elem.tag === "textPath" && (name === "href" || name.endsWith(":href")) ? /^#(.+)$/.exec(value) : null;
      if (along !== null) {
        if (!this.copy(along[1]!)) return null;
        attrs[name] = `#${this.renamed.get(along[1]!) ?? along[1]!}`;
        continue;
      }
      if (!/url\(/i.test(value)) {
        attrs[name] = value;
        continue;
      }
      for (const id of urlIds(value)) if (!this.copy(id)) return null;
      attrs[name] = renameUrls(value, (id) => this.renamed.get(id) ?? null);
    }
    const out: { tag: string; attrs: Record<string, string>; children?: Elem[]; text?: string | null; runs?: Elem["runs"] } = { tag: elem.tag, attrs };
    if (elem.children !== undefined) {
      const children: Elem[] = [];
      for (const child of elem.children) {
        const adopted = this.adopt(child);
        if (adopted === null) return null;
        children.push(adopted);
      }
      out.children = children;
    }
    if (elem.text !== undefined) out.text = elem.text;
    if (elem.runs !== undefined) out.runs = elem.runs;
    return out;
  }

  /// Copia la risorsa `id` se è privata, dopo ciò che usa lei; falso se non
  /// si sa scrivere. Una sfumatura nelle coordinate di chi la usa si porta
  /// con la trasformazione che dà `fit`.
  private copy(id: string, fit: (() => Matrix | null) | null = null): boolean {
    if (this.renamed.has(id)) return true;
    let elem = this.kept.get(id) ?? null;
    if (elem === null) {
      const node = this.resources.get(id);
      if (node === undefined || node.details!.lifecycle !== "private") return true;
      elem = this.elemOf(node);
      if (elem === null) return false;
    }
    const fresh = this.ids.next("resource");
    this.renamed.set(id, fresh);
    const copy = this.adopt(fitted(this.withIds(elem, fresh), fit));
    if (copy === null) return false;
    this.home ??= homeOf(this.model);
    this.adds.push({ op: "add", parent: this.home.parent, pos: { last: true }, elem: copy });
    return true;
  }

  /// `elem` con l'id `id`, e un id nuovo a ogni sua parte che ne ha uno.
  private withIds(elem: Elem, id: string | null): Elem {
    const attrs = { ...elem.attrs };
    if (id !== null) attrs.id = id;
    else if (attrs.id !== undefined) attrs.id = this.ids.next("resource");
    if (elem.children === undefined) return { ...elem, attrs };
    return { ...elem, attrs, children: elem.children.map((child) => this.withIds(child, null)) };
  }

  /// Le operazioni che aggiungono le copie, da fare prima di chi le usa;
  /// nessuna se non ce n'è. Con `prelude` falso senza quella che crea la
  /// `defs` del disegno, se un'altra aggiunta dello stesso passo l'ha già
  /// fatta.
  ops(prelude = true): Op[] {
    return this.adds.length === 0 ? [] : [...(prelude ? this.home!.prelude : []), ...this.adds];
  }
}

/// La sfumatura `elem`, se è nelle coordinate di chi la usa, portata dalla
/// trasformazione che dà `fit`; le altre risorse restano com'erano.
function fitted(elem: Elem, fit: (() => Matrix | null) | null): Elem {
  if (fit === null || (elem.tag !== "linearGradient" && elem.tag !== "radialGradient") || trim(elem.attrs.gradientUnits ?? "") !== "userSpaceOnUse") return elem;
  const m = fit();
  const written = elem.attrs.gradientTransform;
  const old = written === undefined ? IDENTITY : parseTransform(written);
  if (m === null || old === null || m.every((value, at) => value === IDENTITY[at])) return elem;
  return { ...elem, attrs: { ...elem.attrs, gradientTransform: formatTransform(compose(m, old)) } };
}

/// Le risorse private che usano i colori `values`, e quelle che usano loro,
/// come le scrive un'operazione: ciò che uno stile copiato porta con sé.
/// `elemOf` come per [`ResourceCopies`].
export function privateResources(model: DocumentModel, values: readonly string[], elemOf: (node: ElementPart) => Elem | null): Map<string, Elem> {
  const out = new Map<string, Elem>();
  if (!values.some((value) => /url\(/i.test(value))) return out;
  const resources = resourcesOf(model);
  const visit = (id: string): void => {
    const node = resources.get(id);
    if (out.has(id) || node === undefined || node.details!.lifecycle !== "private") return;
    const elem = elemOf(node);
    if (elem === null) return;
    out.set(id, elem);
    const inner = (each: Elem): void => {
      for (const value of Object.values(each.attrs)) for (const used of urlIds(value)) visit(used);
      for (const child of each.children ?? []) inner(child);
    };
    inner(elem);
  };
  for (const value of values) for (const id of urlIds(value)) visit(id);
  return out;
}
