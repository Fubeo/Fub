// I motivi degli oggetti: le campiture (livello Standard), che il pannello
// delle proprietà dà, cambia e toglie, e i motivi del documento (livello
// Esperto), fatti con una selezione; ciascun cambio in un passo che si
// annulla (formato della scena, risorse).
//
// - **Ogni oggetto ha la sua campitura**, una risorsa privata nelle sue
//   coordinate (`hatches.ts`). Chi cambia una campitura che non è soltanto
//   sua, perché condivisa, ereditata da un gruppo o usata anche dal
//   contorno, ne riceve una copia e cambia quella; gli altri la tengono
//   com'era. Una campitura che resta dello stesso genere, col fondo o senza
//   come prima, cambia sul posto con `set`; le altre nascono accanto a
//   quella che sostituiscono, che il motore toglie.
// - **Una campitura nuova parte dal colore dell'oggetto:** è il fondo, e le
//   righe sono nere o bianche, quelle che su quel fondo si leggono meglio.
//   Un oggetto senza riempimento ha righe nere su niente. Togliere la
//   campitura lascia il fondo, o niente.
// - **Distinguere le aree** che si riconoscono soltanto dalla tinta (la
//   verifica S017) dà a tutte una campitura che nel disegno non c'è ancora,
//   col passo misurato sulla scena: un terzo del lato più corto, fra 3 e 8.
// - **Un motivo del documento** è un `pattern` col suo nome e
//   `fub:role="swatch"`, come un campione: resta anche senza chi lo usa, e
//   duplicare chi lo usa lo condivide. «Motivo dalla selezione» lo fa con
//   una copia degli oggetti scelti, nel riquadro di ciò che disegnano e lì
//   dove sono; gli oggetti restano. Chi lo usa scrive `url(#id) #rrggbb`,
//   col colore medio del motivo come ripiego; eliminarlo riporta chi lo usa
//   al suo ripiego.

import { formatNumber } from "../number";
import { BoundsBuilder, type Bounds } from "../scene/geometry";
import { apply, compose, IDENTITY, translate, type Matrix } from "../scene/matrix";
import type { DocumentModel, ElementPart, LeafNode } from "../scene/model";
import type { AddOp, Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { opacity as svgOpacity, paint, paintReference, transform as parseTransform, trim, urlIds } from "../scene/values";
import { elemOf, INHERITED, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { transformValue, type NewIds } from "./edit";
import { elemChanges } from "./effects";
import { averageColor, paintedParts, type Painted } from "./gradients";
import {
  clampSpacing,
  clampWidth,
  defaultWidth,
  hatchElem,
  hatchFallback,
  hatchOf,
  inkFor,
  normalAngle,
  presetHatch,
  presetOf,
  type Hatch,
  type HatchKind,
  type HatchPreset,
} from "./hatches";
import { geometryBox, type Unit } from "./hit";
import { paintEachOps, type Restyled } from "./look";
import { contentOf, inheritedStyle, maskProblem, onPath } from "./masks";
import type { Measure } from "./measure";
import { customColor } from "./palette";
import { homeOf, paintCode, ResourceCopies, resourcesOf, usersOf, type Home } from "./resources";
import { keepCarried, refused } from "./styled";
import { documentSwatches, freshSwatchName, removeMotifOps, type SwatchChange } from "./swatches";

export type { HatchPreset } from "./hatches";

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

/// Ciò che riempie una parte: un colore, il suo o di un campione, o una
/// sfumatura, col colore da cui nasce una campitura (`null` per nessuno);
/// una campitura di FubDraw, con `own` vero se è soltanto sua; un motivo,
/// del documento col suo nome o di un altro programma, col suo ripiego.
export type Filling =
  | { readonly kind: "plain"; readonly color: string | null }
  | { readonly kind: "hatch"; readonly id: string; readonly hatch: Hatch; readonly own: boolean }
  | { readonly kind: "pattern"; readonly id: string; readonly name: string | null; readonly color: string | null };

/// Una parte della selezione che mostra un riempimento, con ciò che lo
/// riempie.
export interface Filled extends Painted {
  readonly filling: Filling;
}

/// Il ripiego di `value`, `#rrggbb`; `null` se non ne ha uno o è `none`.
function fallbackOf(value: string): string | null {
  const used = paintReference(value);
  return used === null || used.fallback === null || used.fallback === "none" ? null : paintCode(used.fallback);
}

/// Le parti di `units` che mostrano un riempimento, come le cambia il
/// pannello, con ciò che le riempie.
export function filledParts(model: DocumentModel, units: readonly Unit[]): Filled[] {
  const resources = resourcesOf(model);
  let users: Map<string, number> | null = null;
  return paintedParts(model, units, "fill").map((part): Filled => {
    if (part.gradient !== null) return { ...part, filling: { kind: "plain", color: averageColor(part.gradient.look.stops) } };
    const used = paintReference(part.value);
    const node = used === null ? undefined : resources.get(used.id);
    if (used === null || node === undefined || node.facts.local !== "pattern") {
      return { ...part, filling: { kind: "plain", color: part.solid ?? (used === null ? null : fallbackOf(part.value)) } };
    }
    const hatch = hatchOf(node);
    if (hatch === null) {
      const name = node.details?.motif?.name ?? null;
      return { ...part, filling: { kind: "pattern", id: used.id, name, color: fallbackOf(part.value) ?? (name === null ? null : motifColor(node)) } };
    }
    const other = part.own.get("stroke");
    let own = node.details?.lifecycle === "private" && paintReference(part.own.get("fill") ?? "")?.id === used.id && (other === undefined || paintReference(other)?.id !== used.id);
    if (own) {
      users ??= usersOf(model);
      own = users.get(used.id) === 1;
    }
    return { ...part, filling: { kind: "hatch", id: used.id, hatch, own } };
  });
}

/// Ciò che il menu della campitura mostra per una parte: la campitura
/// pronta, `custom` per un'altra campitura di FubDraw, `none` per un colore
/// o una sfumatura, `pattern:<id>` per un motivo del documento, `other` per
/// un motivo di un altro programma.
export type HatchChoice = HatchPreset | "none" | "custom" | "other" | `pattern:${string}`;

/// Le campiture della selezione, come le mostra il pannello. Ogni valore è
/// quello comune alle parti con una campitura di FubDraw; `null` se misto,
/// o se non ce n'è.
export interface HatchView {
  /// Quante parti mostrano un riempimento.
  readonly count: number;
  /// Quante di loro hanno una campitura di FubDraw.
  readonly hatched: number;
  /// Ciò che il menu mostra, comune a tutte le parti; `null` se misto.
  readonly choice: HatchChoice | null;
  readonly kind: HatchKind | null;
  readonly angle: number | null;
  readonly spacing: number | null;
  readonly width: number | null;
  readonly color: string | null;
  /// `none` per le campiture senza fondo.
  readonly background: string | null;
}

/// Ciò che il menu mostra per `filling`.
function choiceOf(filling: Filling): HatchChoice {
  switch (filling.kind) {
    case "plain":
      return "none";
    case "hatch":
      return presetOf(filling.hatch) ?? "custom";
    case "pattern":
      return filling.name === null ? "other" : `pattern:${filling.id}`;
  }
}

/// Il valore comune di `values`; `null` se non ce n'è uno solo.
function common<T>(values: readonly T[]): T | null {
  return values.length > 0 && values.every((value) => value === values[0]) ? values[0]! : null;
}

/// Le campiture di `parts`, da [`filledParts`].
export function hatchView(parts: readonly Filled[]): HatchView {
  const hatches = parts.flatMap((part) => (part.filling.kind === "hatch" ? [part.filling.hatch] : []));
  return {
    count: parts.length,
    hatched: hatches.length,
    choice: common(parts.map((part) => choiceOf(part.filling))),
    kind: common(hatches.map((hatch) => hatch.kind)),
    angle: common(hatches.map((hatch) => hatch.angle)),
    spacing: common(hatches.map((hatch) => hatch.spacing)),
    width: common(hatches.map((hatch) => hatch.width)),
    color: common(hatches.map((hatch) => hatch.color)),
    background: common(hatches.map((hatch) => hatch.background ?? "none")),
  };
}

// ---------------------------------------------------------------------------
// Scrivere.
// ---------------------------------------------------------------------------

/// Un cambio delle campiture della selezione.
export type HatchChange =
  /// Una campitura pronta per tutte le parti: chi ne ha già una tiene il
  /// passo e i colori, gli altri partono dal loro colore.
  | { readonly preset: HatchPreset }
  /// Nessuna campitura né motivo: resta il fondo, o il ripiego.
  | { readonly none: true }
  /// Il motivo del documento `pattern` per tutte le parti.
  | { readonly pattern: string }
  /// Un valore delle parti con una campitura di FubDraw; le altre restano.
  | { readonly angle: number }
  | { readonly spacing: number }
  | { readonly width: number }
  | { readonly color: string }
  /// Il fondo, o `null` per nessuno.
  | { readonly background: string | null };

/// Il cambio pronto, quante parti cambiano e la campitura pronta data.
export interface HatchChanged extends Restyled {
  readonly reached: number;
  readonly preset: HatchPreset | null;
}

/// Vero se due campiture si scrivono uguali.
const sameHatch = (a: Hatch, b: Hatch): boolean =>
  a.kind === b.kind && a.angle === b.angle && a.spacing === b.spacing && a.width === b.width && a.color === b.color && a.background === b.background;

/// Ciò che `part` diventa con `change`: una campitura, un colore scritto, o
/// `null` se resta com'è.
function nextOf(part: Filled, change: HatchChange, motifs: ReadonlyMap<string, string>): Hatch | { readonly value: string } | null {
  const filling = part.filling;
  const hatch = filling.kind === "hatch" ? filling.hatch : null;
  const changed = (next: Hatch): Hatch | null => (hatch !== null && sameHatch(hatch, next) ? null : next);
  if ("preset" in change) {
    if (filling.kind === "hatch") return changed(presetHatch(change.preset, filling.hatch));
    const background = filling.color;
    return { ...presetHatch(change.preset), color: inkFor(background), background };
  }
  if ("none" in change) {
    if (filling.kind === "plain") return null;
    if (filling.kind === "hatch") return { value: filling.hatch.background ?? "none" };
    return { value: filling.color ?? "none" };
  }
  if ("pattern" in change) {
    const color = motifs.get(change.pattern);
    if (color === undefined || (filling.kind === "pattern" && filling.id === change.pattern)) return null;
    return { value: `url(#${change.pattern}) ${color}` };
  }
  if (hatch === null) return null;
  if ("angle" in change) return changed({ ...hatch, angle: normalAngle(change.angle) });
  if ("spacing" in change) {
    const spacing = clampSpacing(change.spacing);
    return changed({ ...hatch, spacing, width: Math.min(hatch.width, spacing) });
  }
  if ("width" in change) return changed({ ...hatch, width: clampWidth(change.width, hatch.spacing) });
  if ("color" in change) return changed({ ...hatch, color: change.color });
  return changed({ ...hatch, background: change.background });
}

/// Scrive le campiture e i colori di un cambio: `before` le risorse, `values`
/// i riempimenti.
class Writer {
  readonly before: Op[] = [];
  readonly values = new Map<ElementPart, string>();
  private home: Home | null = null;
  private readonly resources: ReadonlyMap<string, LeafNode>;

  constructor(
    private readonly model: DocumentModel,
    private readonly ids: NewIds,
  ) {
    this.resources = resourcesOf(model);
  }

  /// `part` mostra `hatch`: la sua cambiata sul posto, se è soltanto sua e
  /// ha la stessa forma, o una nuova accanto.
  hatch(part: Filled, hatch: Hatch): void {
    const fallback = hatchFallback(hatch);
    const filling = part.filling;
    if (filling.kind === "hatch" && filling.own) {
      const node = this.resources.get(filling.id)!;
      const before = elemOf(node);
      const parts = before === null ? null : elemChanges(before, hatchElem(filling.id, hatch));
      if (parts !== null) {
        for (const { part: at, attrs } of parts) this.before.push(at.length === 0 ? { op: "set", id: filling.id, attrs } : { op: "set", id: filling.id, part: at, attrs });
        this.values.set(part.node, `url(#${filling.id}) ${fallback}`);
        return;
      }
    }
    if (this.home === null) {
      this.home = homeOf(this.model);
      this.before.push(...this.home.prelude);
    }
    const id = this.ids.next("resource");
    // Accanto a quella che prende il posto, se stanno nella stessa `defs`.
    const old = filling.kind === "hatch" && filling.own ? filling.id : null;
    const beside = old !== null && this.resources.get(old)?.parent?.facts.id === this.home.parent;
    this.before.push({ op: "add", parent: this.home.parent, pos: beside ? { after: old } : { last: true }, elem: hatchElem(id, hatch) });
    this.values.set(part.node, `url(#${id}) ${fallback}`);
  }

  /// I riempimenti scritti, dopo le risorse.
  finish(units: readonly Unit[], measure: Measure, reached: number, preset: HatchPreset | null): HatchChanged {
    return { ...paintEachOps(this.model, units, "fill", this.values, this.before, measure, this.ids), reached, preset };
  }
}

/// Le operazioni che danno `change` alle parti di `units` che mostrano un
/// riempimento, in un passo; la selezione resta la stessa.
export function hatchOps(model: DocumentModel, units: readonly Unit[], change: HatchChange, measure: Measure, ids: NewIds): HatchChanged {
  const writer = new Writer(model, ids);
  const motifs = new Map<string, string>();
  if ("pattern" in change) {
    const motif = documentPatterns(model).find((each) => each.id === change.pattern);
    if (motif !== undefined) motifs.set(motif.id, motif.color);
  }
  let reached = 0;
  for (const part of filledParts(model, units)) {
    const next = nextOf(part, change, motifs);
    if (next === null) continue;
    reached++;
    if ("value" in next) writer.values.set(part.node, next.value);
    else writer.hatch(part, next);
  }
  return writer.finish(units, measure, reached, "preset" in change ? change.preset : null);
}

// ---------------------------------------------------------------------------
// Distinguere le aree.
// ---------------------------------------------------------------------------

/// L'ordine in cui le campiture pronte distinguono: prima le più diverse.
const DISTINCT: readonly HatchPreset[] = ["diagonal", "dots", "cross", "horizontal", "grid"];

/// Il passo nella scena di una campitura che distingue: un terzo del lato
/// più corto, fra questi due.
const MIN_SCENE_SPACING = 3;
const MAX_SCENE_SPACING = 8;

/// La campitura pronta meno usata dalle campiture del disegno, a parità
/// nell'ordine di [`DISTINCT`].
function freshPreset(model: DocumentModel): HatchPreset {
  const used = new Map<HatchPreset, number>();
  for (const node of resourcesOf(model).values()) {
    const hatch = hatchOf(node);
    const preset = hatch === null ? null : presetOf(hatch);
    if (preset !== null) used.set(preset, (used.get(preset) ?? 0) + 1);
  }
  let best = DISTINCT[0]!;
  for (const preset of DISTINCT) if ((used.get(preset) ?? 0) < (used.get(best) ?? 0)) best = preset;
  return best;
}

/// Il riquadro `box` portato da `m`.
function mapped(box: Bounds, m: Matrix): Bounds {
  const out = new BoundsBuilder();
  for (const corner of [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]] as const) out.include(apply(m, corner));
  return out.finish()!;
}

/// Il passo, nelle coordinate di `part`, di una campitura che la distingue.
function distinctSpacing(part: Filled): number {
  const scale = Math.sqrt(Math.abs(part.matrix[0] * part.matrix[3] - part.matrix[1] * part.matrix[2]));
  if (part.box === null || !(scale > 0)) return clampSpacing(MAX_SCENE_SPACING);
  const box = mapped(part.box, part.matrix);
  const side = Math.min(box.max[0] - box.min[0], box.max[1] - box.min[1]);
  return clampSpacing(Math.min(Math.max(side / 3, MIN_SCENE_SPACING), MAX_SCENE_SPACING) / scale);
}

/// Le operazioni che danno alle parti di `units` riempite di un colore, il
/// loro o di un campione, una campitura che le distingue, in un passo: la
/// campitura pronta che il disegno usa meno, sul loro colore, con righe nere
/// o bianche. Le parti che hanno già una campitura, una sfumatura o un
/// motivo restano.
export function distinguishOps(model: DocumentModel, units: readonly Unit[], measure: Measure, ids: NewIds): HatchChanged {
  const writer = new Writer(model, ids);
  const preset = freshPreset(model);
  let reached = 0;
  for (const part of filledParts(model, units)) {
    const background = part.gradient === null && part.filling.kind === "plain" ? part.solid : null;
    if (background === null) continue;
    const base = presetHatch(preset);
    const spacing = distinctSpacing(part);
    writer.hatch(part, { ...base, spacing, width: defaultWidth(base.kind, spacing), color: inkFor(background), background });
    reached++;
  }
  return writer.finish(units, measure, reached, reached === 0 ? null : preset);
}

// ---------------------------------------------------------------------------
// I motivi del documento.
// ---------------------------------------------------------------------------

/// Un motivo del documento, come lo mostra il pannello: il nome com'è
/// scritto, e il suo colore medio, `#rrggbb`.
export interface DocumentPattern {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

const colors = new WeakMap<LeafNode, string>();

/// Il colore medio del motivo `node`, letto una volta.
function motifColor(node: LeafNode): string {
  let color = colors.get(node);
  if (color === undefined) {
    const elem = elemOf(node);
    color = elem === null ? "#000000" : contentColor(elem.children ?? []);
    colors.set(node, color);
  }
  return color;
}

/// I motivi del documento, nell'ordine del documento.
export function documentPatterns(model: DocumentModel): DocumentPattern[] {
  const out: DocumentPattern[] = [];
  for (const [id, node] of resourcesOf(model)) {
    const motif = node.details?.motif;
    if (motif !== undefined) out.push({ id, name: motif.name, color: motifColor(node) });
  }
  return out;
}

/// I nomi dei campioni e dei motivi del documento, che non si ripetono.
export function swatchNames(model: DocumentModel): Array<{ readonly id: string; readonly name: string }> {
  return [...documentSwatches(model), ...documentPatterns(model)];
}

/// Il colore di `value`, un `fill` o uno `stroke` del contenuto di un
/// motivo; `null` per nessuno, o per uno che non si sa.
function contentPaint(value: string): string | null {
  return customColor(value) ?? fallbackOf(value);
}

/// Il colore medio del contenuto `children` di un motivo: i riempimenti
/// delle sue forme pesati sull'area del loro riquadro e sulla loro opacità;
/// senza, i contorni, pesati sulla diagonale. Il nero se non ce n'è.
export function contentColor(children: readonly Elem[]): string {
  const fills = [0, 0, 0, 0];
  const strokes = [0, 0, 0, 0];
  const visit = (elem: Elem, m: Matrix, fill: string, stroke: string, alpha: number): void => {
    if (elem.tag === "title" || elem.tag === "desc") return;
    const written = elem.attrs.transform;
    const here = written === undefined ? m : compose(m, parseTransform(written) ?? IDENTITY);
    const own = (name: string, inherited: string): string => {
      const value = elem.attrs[name];
      return value === undefined || trim(value) === "inherit" ? inherited : value;
    };
    const f = own("fill", fill);
    const s = own("stroke", stroke);
    const a = alpha * (svgOpacity(elem.attrs.opacity ?? "1") ?? 1);
    if (elem.tag === "g") {
      for (const child of elem.children ?? []) visit(child, here, f, s, a);
      return;
    }
    const box = geometryBox(elem);
    if (box === null) return;
    const seen = mapped(box, here);
    const w = seen.max[0] - seen.min[0];
    const h = seen.max[1] - seen.min[1];
    const add = (into: number[], color: string | null, weight: number): void => {
      const rgb = color === null ? null : paint(color);
      if (rgb === null || rgb === "none" || !(weight > 0)) return;
      for (let c = 0; c < 3; c++) into[c]! += rgb[c]! * weight;
      into[3]! += weight;
    };
    add(fills, contentPaint(f), w * h * a * (svgOpacity(own("fill-opacity", "1")) ?? 1));
    add(strokes, contentPaint(s), Math.hypot(w, h) * a * (svgOpacity(own("stroke-opacity", "1")) ?? 1));
  };
  for (const child of children) visit(child, IDENTITY, "#000000", "none", 1);
  const sum = fills[3]! > 0 ? fills : strokes;
  if (!(sum[3]! > 0)) return "#000000";
  return `#${sum.slice(0, 3).map((value) => Math.round(value / sum[3]!).toString(16).padStart(2, "0")).join("")}`;
}

/// Perché «Motivo dalla selezione» non si fa: niente di scelto che disegni;
/// un oggetto scelto non sta in un motivo (un'immagine, un collegamento, un
/// testo su tracciato); porta ciò che un motivo non contiene (un ritaglio,
/// una maschera, un filtro, le punte, un altro motivo, un tratto che non si
/// ridisegna); un contenitore da cui esce ha un ritaglio, una maschera, un
/// filtro o è nascosto; lo stile del disegno lo farebbe vedere diverso.
export type MotifRefusal = "empty" | "kind" | "content" | "container" | "style";

/// Gli attributi che usano una risorsa e un contenuto non porta.
const EFFECTS: readonly string[] = ["clip-path", "mask", "filter"];

/// I decimali dell'opacità che il contenuto porta dai contenitori.
const OPACITY_PLACES = 4;

/// `elem` senza titoli e descrizioni, a ogni livello: un motivo non li ha.
function untitled(elem: Elem): Elem {
  if (elem.children === undefined) return elem;
  return { ...elem, children: elem.children.filter((child) => child.tag !== "title" && child.tag !== "desc").map(untitled) };
}

/// Ciò che `unit` diventa nel contenuto di un motivo il cui riquadro parte
/// da `origin`: senza id, con lo stile che ereditava e la trasformazione che
/// lo tiene dov'era; o il perché no.
function motifPiece(model: DocumentModel, unit: Unit, origin: readonly [number, number], resources: ReadonlyMap<string, LeafNode>): { readonly elem: Elem; readonly node: ElementPart; readonly fades: readonly ElementPart[] } | MotifRefusal {
  const node = nodeOf(model, unit);
  const elem = elemOf(node);
  if (elem === null || onPath(elem)) return "kind";
  const problem = maskProblem(elem, resources);
  if (problem !== null) return problem === "top" ? "kind" : "content";
  if (node.details?.stroke?.redrawable === false) return "content";
  const inherited = inheritedStyle(node);
  // Un motivo che l'oggetto eredita cambierebbe il contenuto come uno suo.
  for (const name of ["fill", "stroke"]) {
    const value = inherited.get(name);
    if (value === undefined || urlIds(value).length === 0) continue;
    const used = paintReference(value);
    const kind = used === null ? undefined : resources.get(used.id)?.facts.local;
    if (kind !== "linearGradient" && kind !== "radialGradient") return "content";
  }
  const fades: ElementPart[] = [];
  let fade = 1;
  for (let at = node.parent; at !== null && at !== model.root; at = at.parent) {
    const held = plainAttributes(at);
    if (EFFECTS.some((name) => held.has(name) && trim(held.get(name)!) !== "none") || trim(held.get("display") ?? "") === "none") return "container";
    fades.push(at);
    fade *= svgOpacity(held.get("opacity") ?? "1") ?? 1;
  }
  const content = untitled(contentOf(elem, false, resources));
  const attrs = content.attrs as Record<string, string>;
  delete attrs.transform;
  for (const [name, value] of inherited) {
    const own = attrs[name];
    if (own === undefined || trim(own) === "inherit") attrs[name] = value;
  }
  for (const name of INHERITED) if (attrs[name] !== undefined && trim(attrs[name]!) === "inherit") delete attrs[name];
  if (fade !== 1) attrs.opacity = formatNumber((svgOpacity(attrs.opacity ?? "1") ?? 1) * fade, OPACITY_PLACES);
  const value = transformValue(compose(translate(-origin[0], -origin[1]), unit.matrix));
  if (value !== null) attrs.transform = value;
  return { elem: content, node, fades };
}

/// Il comando pronto di «Motivo dalla selezione»: le operazioni, la
/// selezione che resta, l'id e il nome del motivo.
export interface MotifMade extends Arranged {
  readonly id: string;
  readonly name: string;
}

/// I centesimi per difetto e per eccesso.
const down = (value: number): number => Math.floor(Math.round(value * 1e6) / 1e4) / 100;
const up = (value: number): number => Math.ceil(Math.round(value * 1e6) / 1e4) / 100;
const place = (value: number): string => formatNumber(value, 2);

/// «Motivo dalla selezione»: un motivo del documento col primo nome libero
/// da `base`, fatto con una copia di `units` in ordine di documento, nel
/// riquadro di ciò che disegnano, ai centesimi per eccesso. Gli oggetti e la
/// selezione restano.
export function motifOps(model: DocumentModel, units: readonly Unit[], base: string, ids: NewIds): MotifMade | MotifRefusal {
  const ordered = [...units].sort((a, b) => {
    for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) if (a.path[i] !== b.path[i]) return a.path[i]! - b.path[i]!;
    return a.path.length - b.path.length;
  });
  const box = new BoundsBuilder();
  for (const unit of ordered) {
    if (unit.bounds === null) continue;
    box.include(unit.bounds.min);
    box.include(unit.bounds.max);
  }
  const seen = box.finish();
  if (seen === null) return "empty";
  const x = down(seen.min[0]);
  const y = down(seen.min[1]);
  const width = up(seen.max[0]) - x;
  const height = up(seen.max[1]) - y;
  if (!(width > 0 && height > 0)) return "empty";
  const resources = resourcesOf(model);
  const pieces: Array<{ readonly elem: Elem; readonly node: ElementPart; readonly fades: readonly ElementPart[] }> = [];
  for (const unit of ordered) {
    if (unit.bounds === null) continue;
    const piece = motifPiece(model, unit, [x, y], resources);
    if (typeof piece === "string") return piece;
    pieces.push(piece);
  }
  // Le sfumature private degli oggetti diventano copie del motivo.
  const copies = new ResourceCopies(model, ids, elemOf);
  const children: Elem[] = [];
  for (const piece of pieces) {
    const adopted = copies.adopt(piece.elem);
    if (adopted === null) return "content";
    children.push(adopted);
  }
  const plan = new Plan(model, ids);
  const id = ids.next("resource");
  const name = freshSwatchName(swatchNames(model), base);
  const copied = copies.ops();
  if (copied.length === 0) plan.ops.push(...homeOf(model).prelude);
  else plan.ops.push(...copied);
  const parent = homeOf(model).parent;
  const made: AddOp = {
    op: "add",
    parent,
    pos: { last: true },
    elem: { tag: "pattern", attrs: { id, "fub:role": "swatch", "fub:name": name, patternUnits: "userSpaceOnUse", x: place(x), y: place(y), width: place(width), height: place(height) }, children },
  };
  plan.ops.push(made);
  const arranged = plan.finish(units.map((unit) => plan.keyOf(unit.node, unit.key)));
  // Con un foglio di stile il contenuto potrebbe vedersi diverso dagli
  // oggetti: si confronta, e si scrive ciò che manca.
  const kept = keepCarried(
    model,
    arranged.ops,
    pieces.map((piece, at) => ({ from: piece.node, down: [], into: made, inside: [at], mode: "mask" as const, fades: piece.fades })),
  );
  if (refused(kept)) return "style";
  return { ...arranged, ops: kept.ops, id, name };
}

/// Le operazioni che danno al motivo `id` il nome `name`, già pulito e
/// libero; nessuna se è lo stesso.
export function renameMotifOps(model: DocumentModel, id: string, name: string, units: readonly Unit[], ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  const motif = resourcesOf(model).get(id)?.details?.motif;
  if (motif !== undefined && motif.name !== name) plan.ops.push({ op: "set", id, attrs: { "fub:name": name } });
  return plan.finish(units.map((unit) => plan.keyOf(unit.node, unit.key)));
}

/// Le operazioni che eliminano il motivo `id`: chi lo usa torna al suo
/// ripiego, o al colore medio del motivo se non ne scrive uno, e il motivo se
/// ne va. Se lo usa ancora qualcuno che non si riscrive, resta come risorsa
/// condivisa e senza nome.
export function deleteMotifOps(model: DocumentModel, id: string, units: readonly Unit[], ids: NewIds): SwatchChange {
  const node = resourcesOf(model).get(id);
  return removeMotifOps(model, id, node?.details?.motif === undefined ? "#000000" : motifColor(node), units, ids);
}
