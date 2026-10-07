// L'aspetto degli oggetti scelti, per il pannello delle proprietà (livello
// Standard): il riempimento, il contorno, lo spessore, l'opacità e il testo
// che hanno in comune, o che sono misti; e le operazioni che danno un valore
// a tutti, in un `batch` solo, come i comandi di «Disponi». Il tratteggio,
// gli estremi e gli angoli sono di `outline.ts`.
//
// - **Chi ha che cosa.** Un riempimento l'hanno rettangoli, ellissi,
//   cerchi, poligoni, spezzate, tracciati e testi, dove è il colore delle
//   lettere. Un contorno l'hanno le forme di `outline.ts`, anche quelle che
//   oggi non lo mostrano; e un tratto a penna e una linea a spessore
//   variabile, che sono tutti riempimento ma si vedono come una linea: il
//   loro colore si legge e si scrive come contorno. Lo spessore è dei
//   contorni che si vedono, tranne quello di un tratto a penna, che viene
//   dall'inchiostro; di una linea a spessore variabile è il suo punto più
//   largo, e cambiarlo allarga o stringe tutto il profilo. Un gruppo o un
//   collegamento passano tutto alle parti; un'immagine ha soltanto
//   l'opacità. Una parte bloccata dentro un gruppo scelto resta com'è.
// - **L'opacità è dell'oggetto scelto**, gruppo compreso: non si eredita, si
//   moltiplica, e scritta sulle parti si vedrebbe diversa dove si
//   sovrappongono.
// - **Il file resta corto**, come in `outline.ts`: un valore uguale a quello
//   che la parte prenderebbe comunque, dal gruppo che la contiene o da SVG,
//   si toglie invece di scriversi.
// - **Il tratteggio si misura in spessori** (`outline.ts`): con lo spessore
//   cambia anche lui, e una freccia ridisegna la punta.
// - **Il corpo porta l'interlinea con sé.** Ogni riga di un testo scende di
//   un'interlinea scritta nel suo `tspan`: cambiando il corpo cambia nella
//   stessa proporzione, così le righe non si accavallano.
// - **L'allineamento resta sul punto d'ancoraggio**, come il testo a punto
//   dei programmi di disegno: le righe si allineano attorno al punto dove il
//   testo è nato, ed è esatto, senza stimare la larghezza delle lettere.
// - **Lo stile si copia e si incolla** (livello Standard): il riempimento,
//   il contorno col suo spessore, tratteggio, estremi e angoli, l'opacità e
//   il carattere di un oggetto vanno sugli oggetti scelti in un passo, a
//   ciascuna parte ciò che ha. Si copia ciò che si vede, anche se viene dal
//   gruppo che lo contiene.
// - **Mille oggetti scelti** si leggono entro un fotogramma: gli attributi di
//   un nodo e ciò che un contenitore passa ai figli si leggono una volta
//   sola, finché un'operazione non li cambia.

import { formatNumber } from "../number";
import type { Role } from "../scene/analysis";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { spineOf, WIDTH_CAPS, WIDTH_JOINS, type WidthCap, type WidthJoin } from "../scene/varwidth";
import { keyword, length, nonNegativeLength, opacity as parseOpacity, trim } from "../scene/values";
import { elemOf, fubAttributes, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { Unit } from "./hit";
import { dashOf, dashValue, outlineOf, writtenDashes, type Inherited, type Outline } from "./outline";
import { customColor } from "./palette";
import { profileWidth, scaledProfile, widthAttrs } from "./profile";
import { arrowPath } from "./shapes";
import { replaceElem } from "./topath";

/// Dove un testo si allinea al suo punto d'ancoraggio.
export type Anchor = "start" | "middle" | "end";

export const ANCHORS: readonly Anchor[] = ["start", "middle", "end"];

/// Un valore della selezione: quante parti lo hanno, e il valore se è lo
/// stesso per tutte; `null` se è misto, o se nessuna lo ha.
export interface Shared<T> {
  readonly count: number;
  readonly value: T | null;
}

/// L'aspetto della selezione, come lo mostra il pannello.
export interface Look {
  /// I colori come li scrive il file, `#rrggbb` o `none`; un valore che non
  /// è un colore, come `currentColor`, com'è scritto.
  readonly fill: Shared<string>;
  readonly stroke: Shared<string>;
  /// Lo spessore dei contorni che si vedono, nelle loro coordinate.
  readonly width: Shared<number>;
  /// L'opacità degli oggetti scelti, da 0 a 1.
  readonly opacity: Shared<number>;
  /// Il carattere dei testi come lo scrivono; `""` dove nessuno lo scrive.
  readonly family: Shared<string>;
  /// Il corpo dei testi, nelle loro coordinate.
  readonly size: Shared<number>;
  readonly anchor: Shared<Anchor>;
}

/// Ciò che una parte eredita, coi valori iniziali di SVG: i colori, il
/// contorno di `outline.ts`, il testo.
const INITIAL: Inherited = new Map([
  ["fill", "#000000"],
  ["stroke", "none"],
  ["stroke-width", "1"],
  ["stroke-linecap", "butt"],
  ["stroke-linejoin", "miter"],
  ["stroke-dasharray", "none"],
  ["font-family", ""],
  ["font-size", "16"],
  ["font-weight", "normal"],
  ["text-anchor", "start"],
]);

/// I ruoli che hanno un riempimento.
const FILLED: ReadonlySet<Role> = new Set(["ngon", "star", "path", "rect", "ellipse", "circle", "polyline", "polygon", "text"]);

/// I ruoli che hanno un contorno, come in `outline.ts`.
const OUTLINED: ReadonlySet<Role> = new Set(["arrow", "ngon", "star", "path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// I ruoli tutti riempimento che si vedono come una linea: il loro colore è
/// quello del contorno.
const INKED: ReadonlySet<Role> = new Set(["stroke", "width"]);

/// I ruoli che passano tutto ai figli.
const CONTAINERS: ReadonlySet<Role> = new Set(["group", "link"]);

/// I decimali di un'opacità, come quelli che il pannello degli attributi
/// scrive.
const OPACITY_PLACES = 4;

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

const owns = new WeakMap<ElementPart, ReadonlyMap<string, string>>();

/// Gli attributi senza namespace di `node`, letti una volta: un nodo che
/// un'operazione cambia è un nodo nuovo.
function ownOf(node: ElementPart): ReadonlyMap<string, string> {
  let own = owns.get(node);
  if (own === undefined) {
    own = plainAttributes(node);
    owns.set(node, own);
  }
  return own;
}

const passes = new WeakMap<ElementPart, { readonly from: Inherited; readonly out: Inherited }>();

/// Ciò che i figli di `node` ereditano. Un contenitore che resta lo stesso
/// nodo sotto un genitore cambiato si rilegge, perché eredita altro.
function passedBy(node: ElementPart | null): Inherited {
  if (node === null) return INITIAL;
  const from = passedBy(node.parent);
  const known = passes.get(node);
  if (known !== undefined && known.from === from) return known.out;
  const own = ownOf(node);
  let out: Map<string, string> | null = null;
  for (const name of INITIAL.keys()) {
    const value = own.get(name);
    if (value === undefined || value === from.get(name)) continue;
    out ??= new Map(from);
    out.set(name, value);
  }
  const passed = out ?? from;
  passes.set(node, { from, out: passed });
  return passed;
}

/// Una parte della selezione: l'elemento, i suoi attributi e ciò che
/// eredita.
interface Part {
  readonly node: ElementPart;
  readonly role: Role;
  readonly own: ReadonlyMap<string, string>;
  readonly inherited: Inherited;
}

/// Il valore di `name` che `part` vede: il suo, o quello ereditato.
const seen = (part: Part, name: string): string => part.own.get(name) ?? part.inherited.get(name)!;

/// Un colore come lo mostra il pannello: `#rrggbb` o `none`, e com'è scritto
/// ciò che non è un colore.
export function paintText(value: string): string {
  const text = trim(value);
  if (text === "none") return "none";
  return customColor(text) ?? text;
}

/// Le parti della selezione, divise per ciò che hanno.
interface Parts {
  /// Gli oggetti scelti, per l'opacità.
  readonly chosen: Part[];
  readonly fills: Part[];
  /// Chi ha un contorno: le forme, e i tratti a penna e le linee a spessore
  /// variabile col loro riempimento.
  readonly strokes: Part[];
  /// I contorni che si vedono, per lo spessore.
  readonly outlines: Array<{ readonly part: Part; readonly outline: Outline }>;
  /// Le linee a spessore variabile, anche loro per lo spessore.
  readonly widths: Part[];
  readonly texts: Part[];
}

/// I nodi di `units`. I figli di un contenitore si elencano una volta sola:
/// mille oggetti di un livello non lo scorrono mille volte.
function nodesOf(model: DocumentModel, units: readonly Unit[]): ElementPart[] {
  const children = new Map<ElementPart, ElementPart[]>();
  return units.map((unit) => {
    let node: ElementPart = model.root;
    for (const at of unit.path) {
      let list = children.get(node);
      if (list === undefined) {
        list = elementChildren(node as ContainerNode);
        children.set(node, list);
      }
      node = list[at]!;
    }
    return node;
  });
}

function partsOf(model: DocumentModel, units: readonly Unit[]): Parts {
  const out: Parts = { chosen: [], fills: [], strokes: [], outlines: [], widths: [], texts: [] };
  const visit = (node: ElementPart, inherited: Inherited, chosen: boolean): void => {
    const role = node.details?.role;
    // Ciò che è bloccato dentro un gruppo scelto resta com'è.
    if (role === undefined || (!chosen && node.details?.locked === true)) return;
    const part: Part = { node, role, own: ownOf(node), inherited };
    if (chosen) out.chosen.push(part);
    if (CONTAINERS.has(role)) {
      if (node.kind !== "container") return;
      const inner = passedBy(node);
      for (const child of elementChildren(node)) visit(child, inner, false);
      return;
    }
    if (FILLED.has(role)) out.fills.push(part);
    if (role === "text") out.texts.push(part);
    if (INKED.has(role)) out.strokes.push(part);
    if (role === "width" && node.details?.varwidth !== undefined) out.widths.push(part);
    if (OUTLINED.has(role)) {
      out.strokes.push(part);
      const outline = outlineOf(node, inherited, part.own);
      if (outline !== null) out.outlines.push({ part, outline });
    }
  };
  for (const node of nodesOf(model, units)) visit(node, passedBy(node.parent), true);
  return out;
}

/// Il valore comune di `values`, se c'è.
function shared<T>(values: readonly (T | null)[]): Shared<T> {
  const first = values[0] ?? null;
  const same = first !== null && values.every((value) => value === first);
  return { count: values.length, value: same ? first : null };
}

/// Lo spessore della linea a spessore variabile `part`, coi numeri come li
/// mostra il pannello.
const widthOf = (part: Part): number => Number(place(profileWidth(part.node.details!.varwidth!.profile)));

/// Il corpo che `part` vede, o `null` se non si legge come una lunghezza.
const sizeOf = (part: Part): number | null => nonNegativeLength(seen(part, "font-size"));

const anchorOf = (part: Part): Anchor => {
  const value = trim(seen(part, "text-anchor"));
  return keyword("text-anchor", value) && (ANCHORS as readonly string[]).includes(value) ? (value as Anchor) : "start";
};

/// L'aspetto di `units`.
export function lookOf(model: DocumentModel, units: readonly Unit[]): Look {
  const parts = partsOf(model, units);
  return {
    fill: shared(parts.fills.map((part) => paintText(seen(part, "fill")))),
    stroke: shared(parts.strokes.map((part) => paintText(seen(part, INKED.has(part.role) ? "fill" : "stroke")))),
    width: shared([...parts.outlines.map(({ outline }) => outline.width), ...parts.widths.map(widthOf)]),
    opacity: shared(parts.chosen.map((part) => {
      const written = part.own.get("opacity");
      return written === undefined ? 1 : parseOpacity(written);
    })),
    family: shared(parts.texts.map((part) => trim(seen(part, "font-family")))),
    size: shared(parts.texts.map(sizeOf)),
    anchor: shared(parts.texts.map(anchorOf)),
  };
}

// ---------------------------------------------------------------------------
// Scrivere.
// ---------------------------------------------------------------------------

/// Un valore da dare a tutta la selezione.
export type LookChange =
  | { readonly fill: string }
  | { readonly stroke: string }
  | { readonly width: number }
  | { readonly opacity: number }
  | { readonly family: string }
  | { readonly size: number }
  | { readonly anchor: Anchor };

/// Un cambio pronto, e quante parti cambia.
export interface Restyled extends Arranged {
  readonly changed: number;
}

/// Un numero come lo scrive il file.
const place = (value: number): string => formatNumber(value, 2);

/// Due valori scritti che si vedono uguali.
type Same = (a: string, b: string) => boolean;

const sameText: Same = (a, b) => trim(a) === trim(b);
const samePaint: Same = (a, b) => paintText(a) === paintText(b);
const sameLength: Same = (a, b) => {
  const p = length(a);
  const q = length(b);
  return p !== null && q !== null && place(p) === place(q);
};
const sameDashes: Same = (a, b) => (writtenDashes(a) ?? a) === (writtenDashes(b) ?? b);

/// I cambi di un comando, parte per parte, e le operazioni che li scrivono.
class Changes {
  private readonly attrs = new Map<ElementPart, Record<string, string | null>>();
  private replaced = 0;

  constructor(
    private readonly plan: Plan,
    private readonly model: DocumentModel,
  ) {}

  of(part: Part): Record<string, string | null> {
    let attrs = this.attrs.get(part.node);
    if (attrs === undefined) {
      attrs = {};
      this.attrs.set(part.node, attrs);
    }
    return attrs;
  }

  /// Vero se il comando cambia `name` in `part`.
  touches(part: Part, name: string): boolean {
    return this.attrs.get(part.node)?.[name] !== undefined;
  }

  /// Scrive `value` in `name`, o lo toglie se la parte lo vede comunque.
  /// `same` dice quando due valori scritti si vedono uguali.
  write(part: Part, name: string, value: string, same: Same = (a, b) => a === b): void {
    const own = part.own.get(name);
    if (same(value, part.inherited.get(name)!)) {
      if (own !== undefined) this.of(part)[name] = null;
    } else if (own === undefined || !same(own, value)) {
      this.of(part)[name] = value;
    }
  }

  /// L'opacità `value` sull'oggetto scelto `part`: senza attributo se è
  /// piena.
  opacity(part: Part, value: number): void {
    const written = formatNumber(value, OPACITY_PLACES);
    const own = part.own.get("opacity");
    if (written === "1") {
      if (own !== undefined) this.of(part).opacity = null;
    } else if (own === undefined || parseOpacity(own) === null || formatNumber(parseOpacity(own)!, OPACITY_PLACES) !== written) {
      this.of(part).opacity = written;
    }
  }

  /// La linea a spessore variabile `part` spessa `width` nel punto più largo:
  /// tutto il profilo si allarga o si stringe nella stessa proporzione, e
  /// con lui gli estremi e gli angoli che chiede `outline`, se li dice.
  widthTo(part: Part, width: number, outline?: { readonly cap: string; readonly join: string }): void {
    const v = part.node.details!.varwidth!;
    const k = width / profileWidth(v.profile);
    const cap = trim(outline?.cap ?? "");
    const join = trim(outline?.join ?? "");
    if (!(k > 0 && Number.isFinite(k))) return;
    const written = widthAttrs({
      cap: (WIDTH_CAPS as readonly string[]).includes(cap) ? (cap as WidthCap) : v.cap,
      join: (WIDTH_JOINS as readonly string[]).includes(join) ? (join as WidthJoin) : v.join,
      profile: scaledProfile(v.profile, k),
      spine: spineOf(v),
    });
    if (written === null) return;
    if (written.geom !== fubAttributes(part.node).get("geom")) {
      this.of(part)["fub:geom"] = written.geom;
      this.of(part).d = written.d;
    }
  }

  /// Una freccia il cui spessore cambia ridisegna la punta.
  arrow(part: Part): void {
    const arrow = part.node.details?.arrow;
    const width = this.attrs.get(part.node)?.["stroke-width"];
    if (part.role !== "arrow" || arrow === undefined || width === undefined) return;
    const [x1, y1, x2, y2] = arrow;
    this.of(part).d = arrowPath(x1, y1, x2, y2, width === null ? nonNegativeLength(part.inherited.get("stroke-width")!) ?? 1 : Number(width));
  }

  /// Il corpo `size` del testo `part`, con le righe che scendono nella
  /// stessa proporzione. Va per ultimo: il testo si riscrive coi cambi
  /// che ha già.
  size(part: Part, size: number): void {
    const before = sizeOf(part);
    this.write(part, "font-size", place(size), sameLength);
    const attrs = this.attrs.get(part.node);
    if (attrs === undefined || before === null || before <= 0) return;
    const elem = respaced(part.node, attrs, size / before);
    if (elem === null) return;
    // Le righe si riscrivono con l'elemento: il resto passa da lui.
    if (replaceElem(this.plan, part.node, elem)) {
      this.attrs.delete(part.node);
      this.replaced++;
    }
  }

  /// Le operazioni, con le chiavi di `units` dopo.
  finish(units: readonly Unit[]): Restyled {
    for (const [node, attrs] of this.attrs) {
      if (Object.keys(attrs).length === 0) continue;
      this.plan.ops.push({ op: "set", id: this.plan.idOf(node), attrs } satisfies Op);
    }
    const nodes = nodesOf(this.model, units);
    const keys = units.map((unit, at) => this.plan.keyOf(nodes[at]!, unit.key));
    const changed = [...this.attrs.values()].filter((attrs) => Object.keys(attrs).length > 0).length + this.replaced;
    return { ...this.plan.finish(keys), changed };
  }
}

/// Le operazioni che danno `change` a `units`. La selezione resta la
/// stessa; un elemento che cambia senza id ne riceve uno.
export function lookOps(model: DocumentModel, units: readonly Unit[], change: LookChange, ids: NewIds): Restyled {
  const changes = new Changes(new Plan(model, ids), model);
  const parts = partsOf(model, units);

  if ("fill" in change) {
    for (const part of parts.fills) changes.write(part, "fill", change.fill, samePaint);
  } else if ("stroke" in change) {
    for (const part of parts.strokes) changes.write(part, INKED.has(part.role) ? "fill" : "stroke", change.stroke, samePaint);
  } else if ("width" in change) {
    const width = place(change.width);
    for (const part of parts.widths) changes.widthTo(part, change.width);
    for (const { part, outline } of parts.outlines) {
      changes.write(part, "stroke-width", width, sameLength);
      // Il tratteggio del menu resta quello che si vedeva, sullo spessore
      // nuovo.
      const dash = dashOf(outline.dashes, outline.width, outline.cap);
      if (dash !== null && dash !== "solid") changes.write(part, "stroke-dasharray", dashValue(dash, change.width, outline.cap), sameDashes);
      changes.arrow(part);
    }
  } else if ("opacity" in change) {
    for (const part of parts.chosen) changes.opacity(part, change.opacity);
  } else if ("family" in change) {
    for (const part of parts.texts) changes.write(part, "font-family", change.family, sameText);
  } else if ("anchor" in change) {
    for (const part of parts.texts) changes.write(part, "text-anchor", change.anchor, sameText);
  } else {
    for (const part of parts.texts) changes.size(part, change.size);
  }
  return changes.finish(units);
}

// ---------------------------------------------------------------------------
// Copiare e incollare lo stile.
// ---------------------------------------------------------------------------

/// Il contorno di uno stile, come lo vede l'oggetto copiato.
export interface StyleOutline {
  readonly width: string;
  readonly dashes: string;
  readonly cap: string;
  readonly join: string;
}

/// Il carattere di uno stile: `family` è `""` se nessuno lo scrive.
export interface StyleFont {
  readonly family: string;
  readonly size: number;
  readonly weight: string;
}

/// Lo stile di un oggetto, per «Copia stile» e «Incolla stile»: ciò che
/// si vede, come lo scrive il file. Ciò che l'oggetto copiato non ha è
/// `null`, e incollando non cambia.
export interface Style {
  /// Il riempimento: di una forma che ne ha uno, o il colore di un testo.
  readonly fill: string | null;
  /// Il contorno di una forma, o il colore di un tratto a penna.
  readonly stroke: string | null;
  readonly outline: StyleOutline | null;
  /// L'opacità dell'oggetto scelto, da 0 a 1.
  readonly opacity: number;
  readonly font: StyleFont | null;
}

/// La prima parte di `units` che ha un aspetto suo, nell'ordine del
/// documento: una forma, un tratto a penna, un testo o un'immagine.
function firstPart(model: DocumentModel, unit: Unit): Part | null {
  let found: Part | null = null;
  const visit = (node: ElementPart, inherited: Inherited): void => {
    const role = node.details?.role;
    if (found !== null || role === undefined || node.details?.locked === true) return;
    if (CONTAINERS.has(role)) {
      if (node.kind !== "container") return;
      const inner = passedBy(node);
      for (const child of elementChildren(node)) visit(child, inner);
      return;
    }
    if (FILLED.has(role) || OUTLINED.has(role) || INKED.has(role) || role === "image") found = { node, role, own: ownOf(node), inherited };
  };
  const [node] = nodesOf(model, [unit]);
  visit(node!, passedBy(node!.parent));
  return found;
}

/// Lo stile di `unit`: quello della sua prima parte, con l'opacità
/// dell'oggetto stesso. `null` se non ha parti che si possano copiare.
export function styleOf(model: DocumentModel, unit: Unit): Style | null {
  const part = firstPart(model, unit);
  if (part === null) return null;
  const [node] = nodesOf(model, [unit]);
  const written = ownOf(node!).get("opacity");
  const opacity = written === undefined ? 1 : (parseOpacity(written) ?? 1);
  const size = part.role === "text" ? sizeOf(part) : null;
  return {
    fill: FILLED.has(part.role) ? seen(part, "fill") : null,
    stroke: OUTLINED.has(part.role) ? seen(part, "stroke") : INKED.has(part.role) ? seen(part, "fill") : null,
    outline: OUTLINED.has(part.role)
      ? { width: seen(part, "stroke-width"), dashes: seen(part, "stroke-dasharray"), cap: seen(part, "stroke-linecap"), join: seen(part, "stroke-linejoin") }
      : part.role === "width" && part.node.details?.varwidth !== undefined
        ? { width: place(profileWidth(part.node.details.varwidth.profile)), dashes: "none", cap: part.node.details.varwidth.cap, join: part.node.details.varwidth.join }
        : null,
    opacity,
    font: part.role === "text" && size !== null ? { family: trim(seen(part, "font-family")), size, weight: trim(seen(part, "font-weight")) } : null,
  };
}

/// Il primo colore di `values` che si vede: non `none`, non `null`.
const shown = (...values: Array<string | null>): string | null => values.find((value) => value !== null && trim(value) !== "none") ?? null;

/// Le operazioni che danno `style` a `units`, in un passo: l'opacità
/// all'oggetto scelto, il resto alle parti, e a ciascuna ciò che ha. Il
/// colore di un testo e di un tratto a penna è uno solo: prende quello che
/// si vede dello stile, il riempimento per il testo, il contorno per il
/// tratto. La selezione resta la stessa.
export function styleOps(model: DocumentModel, units: readonly Unit[], style: Style, ids: NewIds): Restyled {
  const changes = new Changes(new Plan(model, ids), model);
  const parts = partsOf(model, units);
  for (const part of parts.chosen) changes.opacity(part, style.opacity);
  for (const part of parts.fills) {
    const value = part.role === "text" ? shown(style.fill, style.stroke) : style.fill;
    if (value !== null) changes.write(part, "fill", value, samePaint);
  }
  for (const part of parts.strokes) {
    if (INKED.has(part.role)) {
      const value = shown(style.stroke, style.fill);
      if (value !== null) changes.write(part, "fill", value, samePaint);
      // Una linea a spessore variabile prende lo spessore, gli estremi e gli
      // angoli, e il suo profilo resta.
      const width = style.outline === null ? null : nonNegativeLength(style.outline.width);
      if (part.role === "width" && parts.widths.includes(part) && width !== null && width > 0) changes.widthTo(part, width, style.outline!);
      continue;
    }
    if (style.stroke !== null) changes.write(part, "stroke", style.stroke, samePaint);
    const outline = style.outline;
    if (outline === null) continue;
    changes.write(part, "stroke-width", outline.width, sameLength);
    changes.write(part, "stroke-dasharray", outline.dashes, sameDashes);
    changes.write(part, "stroke-linecap", outline.cap, sameText);
    changes.write(part, "stroke-linejoin", outline.join, sameText);
    changes.arrow(part);
  }
  const font = style.font;
  if (font !== null) {
    for (const part of parts.texts) {
      changes.write(part, "font-family", font.family, sameText);
      changes.write(part, "font-weight", font.weight, sameText);
      changes.size(part, font.size);
    }
  }
  return changes.finish(units);
}

/// Il testo `node` con gli attributi `attrs` cambiati e le righe che
/// scendono `ratio` volte quanto scendevano; `null` se non ha una riga che
/// scende, e basta cambiare il `text`, o se ha parti che un'operazione non
/// sa scrivere.
function respaced(node: ElementPart, attrs: Readonly<Record<string, string | null>>, ratio: number): Elem | null {
  const elem = elemOf(node);
  if (elem === null || elem.children === undefined) return null;
  let moved = false;
  const children = elem.children.map((child) => {
    const dy = child.tag === "tspan" ? child.attrs.dy : undefined;
    const step = dy === undefined ? null : length(dy);
    if (step === null || step === 0) return child;
    moved = true;
    return { ...child, attrs: { ...child.attrs, dy: place(step * ratio) } };
  });
  if (!moved) return null;
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries(elem.attrs)) if (name !== "id" && !(name in attrs)) next[name] = value;
  for (const [name, value] of Object.entries(attrs)) if (value !== null) next[name] = value;
  return { tag: elem.tag, attrs: next, children };
}
