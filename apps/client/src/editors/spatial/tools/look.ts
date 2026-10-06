// L'aspetto degli oggetti scelti, per il pannello delle proprietà (livello
// Standard): il riempimento, il contorno, lo spessore, l'opacità e il testo
// che hanno in comune, o che sono misti; e le operazioni che danno un valore
// a tutti, in un `batch` solo, come i comandi di «Disponi». Il tratteggio,
// gli estremi e gli angoli sono di `outline.ts`.
//
// - **Chi ha che cosa.** Un riempimento l'hanno rettangoli, ellissi,
//   cerchi, poligoni, spezzate, tracciati e testi, dove è il colore delle
//   lettere. Un contorno l'hanno le forme di `outline.ts`, anche quelle che
//   oggi non lo mostrano; e un tratto a penna, che è tutto riempimento ma si
//   vede come una linea: il suo colore si legge e si scrive come contorno.
//   Lo spessore è dei contorni che si vedono, tranne quello di un tratto a
//   penna, che viene dall'inchiostro. Un gruppo o un collegamento passano
//   tutto alle parti; un'immagine ha soltanto l'opacità.
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
// - **Mille oggetti scelti** si leggono entro un fotogramma: gli attributi di
//   un nodo e ciò che un contenitore passa ai figli si leggono una volta
//   sola, finché un'operazione non li cambia.

import { formatNumber } from "../number";
import type { Role } from "../scene/analysis";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { keyword, length, nonNegativeLength, opacity as parseOpacity, trim } from "../scene/values";
import { elemOf, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { Unit } from "./hit";
import { dashOf, dashValue, outlineOf, writtenDashes, type Inherited, type Outline } from "./outline";
import { customColor } from "./palette";
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
  ["text-anchor", "start"],
]);

/// I ruoli che hanno un riempimento.
const FILLED: ReadonlySet<Role> = new Set(["path", "rect", "ellipse", "circle", "polyline", "polygon", "text"]);

/// I ruoli che hanno un contorno, come in `outline.ts`.
const OUTLINED: ReadonlySet<Role> = new Set(["arrow", "path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

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
  /// Chi ha un contorno: le forme, e i tratti a penna col loro riempimento.
  readonly strokes: Part[];
  /// I contorni che si vedono, per lo spessore.
  readonly outlines: Array<{ readonly part: Part; readonly outline: Outline }>;
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
  const out: Parts = { chosen: [], fills: [], strokes: [], outlines: [], texts: [] };
  const visit = (node: ElementPart, inherited: Inherited, chosen: boolean): void => {
    const role = node.details?.role;
    if (role === undefined) return;
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
    if (role === "stroke") out.strokes.push(part);
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
    stroke: shared(parts.strokes.map((part) => paintText(seen(part, part.role === "stroke" ? "fill" : "stroke")))),
    width: shared(parts.outlines.map(({ outline }) => outline.width)),
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

/// Le operazioni che danno `change` a `units`. La selezione resta la
/// stessa; un elemento che cambia senza id ne riceve uno.
export function lookOps(model: DocumentModel, units: readonly Unit[], change: LookChange, ids: NewIds): Restyled {
  const plan = new Plan(model, ids);
  const parts = partsOf(model, units);
  const changes = new Map<ElementPart, Record<string, string | null>>();
  const attrsOf = (part: Part): Record<string, string | null> => {
    let attrs = changes.get(part.node);
    if (attrs === undefined) {
      attrs = {};
      changes.set(part.node, attrs);
    }
    return attrs;
  };
  /// Scrive `value` in `name`, o lo toglie se la parte lo vede comunque.
  /// `same` dice quando due valori scritti si vedono uguali.
  const write = (part: Part, name: string, value: string, same = (a: string, b: string): boolean => a === b): void => {
    const own = part.own.get(name);
    if (same(value, part.inherited.get(name)!)) {
      if (own !== undefined) attrsOf(part)[name] = null;
    } else if (own === undefined || !same(own, value)) {
      attrsOf(part)[name] = value;
    }
  };
  const samePaint = (a: string, b: string): boolean => paintText(a) === paintText(b);
  const sameLength = (a: string, b: string): boolean => {
    const p = length(a);
    const q = length(b);
    return p !== null && q !== null && place(p) === place(q);
  };
  let replaced = 0;

  if ("fill" in change) {
    for (const part of parts.fills) write(part, "fill", change.fill, samePaint);
  } else if ("stroke" in change) {
    for (const part of parts.strokes) write(part, part.role === "stroke" ? "fill" : "stroke", change.stroke, samePaint);
  } else if ("width" in change) {
    const width = place(change.width);
    for (const { part, outline } of parts.outlines) {
      write(part, "stroke-width", width, sameLength);
      // Il tratteggio del menu resta quello che si vedeva, sullo spessore
      // nuovo.
      const dash = dashOf(outline.dashes, outline.width, outline.cap);
      if (dash !== null && dash !== "solid") {
        write(part, "stroke-dasharray", dashValue(dash, change.width, outline.cap), (a, b) => (writtenDashes(a) ?? a) === (writtenDashes(b) ?? b));
      }
      const arrow = part.node.details?.arrow;
      if (part.role === "arrow" && arrow !== undefined && changes.get(part.node)?.["stroke-width"] !== undefined) {
        const [x1, y1, x2, y2] = arrow;
        attrsOf(part).d = arrowPath(x1, y1, x2, y2, Number(width));
      }
    }
  } else if ("opacity" in change) {
    const value = formatNumber(change.opacity, OPACITY_PLACES);
    for (const part of parts.chosen) {
      const own = part.own.get("opacity");
      if (value === "1") {
        if (own !== undefined) attrsOf(part).opacity = null;
      } else if (own === undefined || parseOpacity(own) === null || formatNumber(parseOpacity(own)!, OPACITY_PLACES) !== value) {
        attrsOf(part).opacity = value;
      }
    }
  } else if ("family" in change) {
    for (const part of parts.texts) write(part, "font-family", change.family, (a, b) => trim(a) === trim(b));
  } else if ("anchor" in change) {
    for (const part of parts.texts) write(part, "text-anchor", change.anchor, (a, b) => trim(a) === trim(b));
  } else {
    const size = place(change.size);
    for (const part of parts.texts) {
      const before = sizeOf(part);
      write(part, "font-size", size, sameLength);
      const attrs = changes.get(part.node);
      if (attrs === undefined || before === null || before <= 0) continue;
      const elem = respaced(part.node, attrs, change.size / before);
      if (elem === null) continue;
      // Le righe si riscrivono con l'elemento: il resto passa da lui.
      if (replaceElem(plan, part.node, elem)) {
        changes.delete(part.node);
        replaced++;
      }
    }
  }

  for (const [node, attrs] of changes) {
    if (Object.keys(attrs).length === 0) continue;
    plan.ops.push({ op: "set", id: plan.idOf(node), attrs } satisfies Op);
  }
  const nodes = nodesOf(model, units);
  const keys = units.map((unit, at) => plan.keyOf(nodes[at]!, unit.key));
  return { ...plan.finish(keys), changed: [...changes.values()].filter((attrs) => Object.keys(attrs).length > 0).length + replaced };
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
