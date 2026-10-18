// Il contorno degli oggetti scelti (livello Esperto): il tratteggio, gli
// estremi e gli angoli, da un menu della barra della selezione. Ogni scelta
// diventa un `batch` solo, come i comandi di «Disponi».
//
// - **Un contorno è di una forma.** Rettangoli, ellissi, cerchi, linee,
//   spezzate, poligoni, percorsi e frecce, con un `stroke` che si vede e uno
//   spessore. Un gruppo o un collegamento passano la scelta alle forme che
//   contengono; un tratto a penna è tutto riempimento, un testo e
//   un'immagine non hanno contorno, e le parti estranee non cambiano.
// - **Una linea a spessore variabile ha estremi e angoli**, scritti in
//   `fub:geom`, e niente tratteggio: cambiarli ne ricalcola il contorno.
// - **Il tratteggio si misura in spessori**, così resta uguale su un
//   contorno sottile e su uno grosso. Ciò che si vede non cambia con gli
//   estremi: un estremo arrotondato o quadrato allunga ogni trattino di mezzo
//   spessore per parte, e il tratteggio lo toglie dal trattino e lo dà allo
//   spazio. Così un tratteggio a punti ha punti tondi con gli estremi
//   arrotondati e quadrati con gli altri, e cambiare gli estremi riscrive il
//   tratteggio che si riconosce.
// - **Il file resta corto.** Un valore uguale a quello che l'oggetto
//   prenderebbe comunque, dal gruppo che lo contiene o da SVG, si toglie
//   invece di scriversi.

import { formatNumber } from "../number";
import type { Role } from "../scene/analysis";
import { elementChildren, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import { keyword, nonNegativeLength } from "../scene/values";
import { spineOf } from "../scene/varwidth";
import { nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { Unit } from "./hit";
import { widthAttrs } from "./profile";

export type Dash = "solid" | "dashed" | "dotted" | "dashdot";
export type Cap = "butt" | "round" | "square";
export type Join = "miter" | "round" | "bevel";

export const DASHES: readonly Dash[] = ["solid", "dashed", "dotted", "dashdot"];
export const CAPS: readonly Cap[] = ["butt", "round", "square"];
export const JOINS: readonly Join[] = ["miter", "round", "bevel"];

/// Trattini e spazi di ogni tratteggio, in spessori, come si vedono.
const PATTERNS: Readonly<Record<Exclude<Dash, "solid">, readonly number[]>> = {
  dashed: [4, 3],
  dotted: [1, 2],
  dashdot: [4, 2, 1, 2],
};

/// I ruoli che hanno un contorno.
const OUTLINED: ReadonlySet<Role> = new Set(["arrow", "connector", "ngon", "star", "path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// I ruoli che passano la scelta ai figli.
const CONTAINERS: ReadonlySet<Role> = new Set(["group", "link"]);

/// Il valore di `stroke-dasharray` del tratteggio `dash` su un contorno
/// spesso `width` con gli estremi `cap`: `none` per il continuo.
export function dashValue(dash: Dash, width: number, cap: Cap): string {
  if (dash === "solid") return "none";
  // Mezzo spessore per parte, un trattino intero.
  const ends = cap === "butt" ? 0 : width;
  return PATTERNS[dash]
    .map((part, at) => formatNumber(at % 2 === 0 ? Math.max(0, part * width - ends) : part * width + ends, 2))
    .join(" ");
}

/// `stroke-dasharray` come lo scrive FubDraw: le lunghezze con due decimali,
/// separate da uno spazio. `null` se non si legge.
export function writtenDashes(value: string): string | null {
  const text = value.trim();
  if (text === "none") return "none";
  const parts = text.split(/[\t\n\f\r ,]+/).filter((part) => part !== "");
  const lengths = parts.map((part) => nonNegativeLength(part));
  if (lengths.length === 0 || lengths.some((length) => length === null)) return null;
  return lengths.map((length) => formatNumber(length!, 2)).join(" ");
}

/// Il tratteggio che `value` disegna su un contorno spesso `width` con gli
/// estremi `cap`; `null` se non è uno di quelli del menu.
export function dashOf(value: string, width: number, cap: Cap): Dash | null {
  const written = writtenDashes(value);
  if (written === null) return null;
  return DASHES.find((dash) => dashValue(dash, width, cap) === written) ?? null;
}

/// Un contorno da cambiare: la forma, i suoi attributi, e i valori che vede.
export interface Outline {
  readonly node: ElementPart;
  /// Gli attributi della forma.
  readonly own: ReadonlyMap<string, string>;
  readonly width: number;
  readonly cap: Cap;
  readonly join: Join;
  /// `stroke-dasharray` com'è scritto, o com'è ereditato.
  readonly dashes: string;
  /// Ciò che la forma vedrebbe senza i suoi attributi: dal gruppo che la
  /// contiene, o da SVG.
  readonly inherited: { readonly cap: Cap; readonly join: Join; readonly dashes: string };
}

/// Ciò che i figli di `node` ereditano, coi valori di `node` sopra quelli
/// che `node` eredita.
export type Inherited = ReadonlyMap<string, string>;

const INITIAL: Inherited = new Map([
  ["stroke", "none"],
  ["stroke-width", "1"],
  ["stroke-linecap", "butt"],
  ["stroke-linejoin", "miter"],
  ["stroke-dasharray", "none"],
]);

/// Gli attributi del contorno che `node` passa ai figli.
export function passed(node: ElementPart, from: Inherited): Inherited {
  const own = plainAttributes(node);
  const out = new Map(from);
  for (const name of INITIAL.keys()) {
    const value = own.get(name);
    if (value !== undefined) out.set(name, value);
  }
  return out;
}

/// Ciò che eredita `node`, dalla radice in giù.
export function inheritedBy(node: ElementPart): Inherited {
  const chain: ElementPart[] = [];
  for (let at = node.parent; at !== null; at = at.parent) chain.push(at);
  let out = INITIAL;
  for (let i = chain.length - 1; i >= 0; i--) out = passed(chain[i]!, out);
  return out;
}

const capOf = (value: string | undefined): Cap => (value !== undefined && keyword("stroke-linecap", value) ? (value as Cap) : "butt");
const joinOf = (value: string | undefined): Join => (value !== undefined && keyword("stroke-linejoin", value) ? (value as Join) : "miter");

/// Il contorno di `node` che eredita `from`, coi suoi attributi `own`;
/// `null` se non si vede.
export function outlineOf(node: ElementPart, from: Inherited, own: ReadonlyMap<string, string> = plainAttributes(node)): Outline | null {
  const value = (name: string): string => own.get(name) ?? from.get(name)!;
  if (value("stroke").trim() === "none") return null;
  const width = nonNegativeLength(value("stroke-width")) ?? 1;
  if (width <= 0) return null;
  return {
    node,
    own,
    width,
    cap: capOf(value("stroke-linecap")),
    join: joinOf(value("stroke-linejoin")),
    dashes: value("stroke-dasharray"),
    inherited: { cap: capOf(from.get("stroke-linecap")), join: joinOf(from.get("stroke-linejoin")), dashes: from.get("stroke-dasharray")! },
  };
}

function collect(node: ElementPart, from: Inherited, out: Outline[]): void {
  const role = node.details?.role;
  if (role === undefined) return;
  if (OUTLINED.has(role)) {
    const outline = outlineOf(node, from);
    if (outline !== null) out.push(outline);
  } else if (CONTAINERS.has(role) && node.kind === "container") {
    const inner = passed(node, from);
    for (const child of elementChildren(node)) collect(child, inner, out);
  }
}

/// I contorni di `units`, in ordine di documento.
export function outlinesOf(model: DocumentModel, units: readonly Unit[]): Outline[] {
  const out: Outline[] = [];
  for (const unit of units) {
    const node = nodeOf(model, unit);
    collect(node, inheritedBy(node), out);
  }
  return out;
}

/// Le linee a spessore variabile di `units`, in ordine di documento.
export function widthLinesOf(model: DocumentModel, units: readonly Unit[]): ElementPart[] {
  const out: ElementPart[] = [];
  const visit = (node: ElementPart): void => {
    const role = node.details?.role;
    if (role === "width" && node.details?.varwidth !== undefined) out.push(node);
    else if (role !== undefined && CONTAINERS.has(role) && node.kind === "container") for (const child of elementChildren(node)) visit(child);
  };
  for (const unit of units) visit(nodeOf(model, unit));
  return out;
}

/// Il contorno dei contorni scelti, come lo mostra il menu: `null` dove non
/// sono tutti uguali. Un tratteggio che non è del menu è `"custom"`, col
/// suo valore se è lo stesso per tutti. Le linee a spessore variabile
/// contano negli estremi e negli angoli, non nel tratteggio.
export interface OutlineLook {
  /// Vero se c'è un contorno che si tratteggia.
  readonly dashable: boolean;
  readonly dash: Dash | "custom" | null;
  readonly custom: string | null;
  readonly cap: Cap | null;
  readonly join: Join | null;
}

function shared<T>(values: readonly T[]): T | null {
  return values.length > 0 && values.every((value) => value === values[0]) ? values[0]! : null;
}

export function lookOf(outlines: readonly Outline[], widths: readonly ElementPart[] = []): OutlineLook {
  const dashes = outlines.map((outline) => dashOf(outline.dashes, outline.width, outline.cap));
  const dash = shared(dashes);
  const custom = dashes.every((one) => one === null) ? shared(outlines.map((outline) => writtenDashes(outline.dashes) ?? outline.dashes)) : null;
  const lines = widths.map((node) => node.details!.varwidth!);
  return {
    dashable: outlines.length > 0,
    dash: dash ?? (custom !== null ? "custom" : null),
    custom,
    cap: shared([...outlines.map((outline) => outline.cap), ...lines.map((line) => line.cap)]),
    join: shared([...outlines.map((outline) => outline.join), ...lines.map((line) => line.join)]),
  };
}

/// Una scelta del menu.
export type OutlineChange = { readonly dash: Dash } | { readonly cap: Cap } | { readonly join: Join };

/// Un cambio pronto, e quanti contorni cambia.
export interface Outlined extends Arranged {
  readonly changed: number;
}

/// Le operazioni che danno `change` ai contorni di `units`. La selezione
/// resta la stessa; un oggetto scelto senza id ne riceve uno.
export function outlineOps(model: DocumentModel, units: readonly Unit[], change: OutlineChange, ids: NewIds): Outlined {
  const plan = new Plan(model, ids);
  const named = new Set<ElementPart>();
  let changed = 0;
  for (const outline of outlinesOf(model, units)) {
    const attrs: Record<string, string | null> = {};
    // Scrive `value`, o toglie l'attributo se la forma lo vede comunque.
    // `written` dà la forma in cui si confrontano i valori.
    const write = (name: string, value: string, inherited: string, written = (text: string): string => text): void => {
      const own = outline.own.get(name);
      if (value === written(inherited)) {
        if (own !== undefined) attrs[name] = null;
      } else if (own === undefined || written(own) !== value) {
        attrs[name] = value;
      }
    };
    const dashes = (dash: Dash, cap: Cap): void =>
      write("stroke-dasharray", dashValue(dash, outline.width, cap), outline.inherited.dashes, (text) => writtenDashes(text) ?? text);
    if ("dash" in change) {
      dashes(change.dash, outline.cap);
    } else if ("cap" in change) {
      write("stroke-linecap", change.cap, outline.inherited.cap);
      // Il tratteggio del menu resta quello che si vedeva.
      const dash = dashOf(outline.dashes, outline.width, outline.cap);
      if (dash !== null && dash !== "solid") dashes(dash, change.cap);
    } else {
      write("stroke-linejoin", change.join, outline.inherited.join);
    }
    if (Object.keys(attrs).length === 0) continue;
    named.add(outline.node);
    plan.ops.push({ op: "set", id: plan.idOf(outline.node), attrs } satisfies Op);
    changed++;
  }
  // Una linea a spessore variabile non ha tratteggio.
  for (const node of "dash" in change ? [] : widthLinesOf(model, units)) {
    const line = node.details!.varwidth!;
    const cap = "cap" in change ? change.cap : line.cap;
    const join = "join" in change ? change.join : line.join;
    if (cap === line.cap && join === line.join) continue;
    const written = widthAttrs({ cap, join, profile: line.profile, spine: spineOf(line) });
    if (written === null) continue;
    named.add(node);
    plan.ops.push({ op: "set", id: plan.idOf(node), attrs: { "fub:geom": written.geom, d: written.d } } satisfies Op);
    changed++;
  }
  const keys = units.map((unit) => {
    const node = nodeOf(model, unit);
    return named.has(node) ? plan.idOf(node) : unit.key;
  });
  return { ...plan.finish(keys), changed };
}
