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
// - **Il testo si legge intero**, righe e pezzi compresi (`rich.ts`): un
//   testo con una parola blu ha il colore misto, e uno con una riga in
//   corsivo il corsivo misto. Un valore dato dal pannello va al testo
//   intero, e le righe e i pezzi che ne scrivevano un altro lo lasciano.
// - **Il corpo porta l'interlinea con sé.** Ogni riga di un testo scende di
//   un'interlinea scritta nel suo `tspan`: cambiando il corpo cambia nella
//   stessa proporzione, così le righe non si accavallano; e così la
//   spaziatura delle lettere. Interlinea e spaziatura si leggono e si
//   scrivono in volte il corpo, come le misurano i programmi di
//   impaginazione.
// - **L'allineamento resta sul punto d'ancoraggio**, come il testo a punto
//   dei programmi di disegno: le righe si allineano attorno al punto dove il
//   testo è nato, ed è esatto, senza stimare la larghezza delle lettere.
// - **Un testo in area tiene il suo riquadro** (livello Esperto): con
//   l'allineamento o la larghezza il bordo sinistro resta dov'era, e le
//   righe si allineano dentro. Un attributo del carattere che cambia, o la
//   larghezza, rifanno gli a capo, misurati come li misura l'export; un
//   colore o una linea no. Un testo da punto diventa in area con un
//   riquadro largo quanto la riga più larga, ogni riga un paragrafo, e un
//   testo in area torna da punto con le righe che mostrava: nessuno dei due
//   si muove.
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
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import type { Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { spineOf, WIDTH_CAPS, WIDTH_JOINS, type WidthCap, type WidthJoin } from "../scene/varwidth";
import { keyword, length, letterSpacing, nonNegativeLength, opacity as parseOpacity, paintReference, textDecoration, trim } from "../scene/values";
import { elemOf, fubAttributes, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { Unit } from "./hit";
import type { Measure } from "./measure";
import { dashOf, dashValue, outlineOf, writtenDashes, type Inherited, type Outline } from "./outline";
import { customColor } from "./palette";
import { profileWidth, scaledProfile, widthAttrs } from "./profile";
import { paintSample, resourcesOf, type PaintSample } from "./resources";
import { arrowPath } from "./shapes";
import {
  anchorsOf,
  emphasisOf,
  emphasizeWhole,
  INHERITED,
  leadingOf,
  linesOf,
  restyleWhole,
  richElem,
  richOf,
  sameRich,
  seenIn,
  seenValues,
  sizeIn,
  spacingsOf,
  weightOf,
  withLeading,
  withSpacing,
  type Emphasis,
  type Rich,
} from "./rich";
import { replaceElem } from "./topath";
import { areaText, pointText, rewrapped, withWrap, type Side } from "./wrap";

/// Dove un testo si allinea al suo punto d'ancoraggio.
export type Anchor = "start" | "middle" | "end";

export const ANCHORS: readonly Anchor[] = ["start", "middle", "end"];

/// Il tipo di un testo che non segue un tracciato: da punto, con le righe
/// che si scrivono, o in area, che va a capo da solo (formato della scena,
/// testo).
export type TextForm = "point" | "area";

export const TEXT_FORMS: readonly TextForm[] = ["point", "area"];

/// Un valore della selezione: quante parti lo hanno, e il valore se è lo
/// stesso per tutte; `null` se è misto, o se nessuna lo ha.
export interface Shared<T> {
  readonly count: number;
  readonly value: T | null;
}

/// L'aspetto della selezione, come lo mostra il pannello.
export interface Look {
  /// I colori come li scrive il file, `#rrggbb` o `none`; una sfumatura o un
  /// motivo `url(#id)`, senza il ripiego; un valore che non è un colore,
  /// come `currentColor`, com'è scritto.
  readonly fill: Shared<string>;
  readonly stroke: Shared<string>;
  /// Come si mostrano i colori `url(#id)` di `fill` e `stroke`.
  readonly samples: ReadonlyMap<string, PaintSample>;
  /// Lo spessore dei contorni che si vedono, nelle loro coordinate.
  readonly width: Shared<number>;
  /// L'opacità degli oggetti scelti, da 0 a 1.
  readonly opacity: Shared<number>;
  /// Il carattere dei testi come lo scrivono; `""` dove nessuno lo scrive.
  readonly family: Shared<string>;
  /// Il corpo dei testi, nelle loro coordinate.
  readonly size: Shared<number>;
  /// Il peso dei testi, da 1 a 1000: 400 è il normale, 700 il grassetto.
  readonly weight: Shared<number>;
  readonly italic: Shared<boolean>;
  readonly underline: Shared<boolean>;
  readonly strike: Shared<boolean>;
  /// L'interlinea dei testi di più righe, in volte il corpo più grande di
  /// due righe vicine.
  readonly leading: Shared<number>;
  /// La spaziatura delle lettere, in volte il corpo.
  readonly spacing: Shared<number>;
  readonly anchor: Shared<Anchor>;
  /// Il tipo dei testi che non seguono un tracciato.
  readonly form: Shared<TextForm>;
  /// La larghezza del riquadro dei testi in area, nelle loro coordinate.
  readonly wrap: Shared<number>;
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
  ["font-style", "normal"],
  ["letter-spacing", "normal"],
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

/// Ciò che il testo `node` eredita da chi lo contiene, per gli attributi
/// del testo, coi valori iniziali di SVG dove nessuno li scrive.
export function textInherited(node: ElementPart): Record<string, string> {
  const passed = passedBy(node.parent);
  const out: Record<string, string> = {};
  for (const name of [...INHERITED, "text-anchor"]) {
    const value = passed.get(name);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/// Ciò che eredita un testo nuovo in un livello che non scrive niente.
export function initialText(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...INHERITED, "text-anchor"]) out[name] = INITIAL.get(name)!;
  return out;
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

/// Un colore come lo mostra il pannello: `#rrggbb` o `none`, una risorsa
/// `url(#id)`, che è la stessa qualunque sia il ripiego, e com'è scritto ciò
/// che non è un colore.
export function paintText(value: string): string {
  const text = trim(value);
  if (text === "none") return "none";
  const used = paintReference(text);
  if (used !== null) return `url(#${used.id})`;
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

/// Un allineamento come lo scrive il file; quello di SVG se non si legge.
const anchorIn = (value: string): Anchor => {
  const text = trim(value);
  return keyword("text-anchor", text) && (ANCHORS as readonly string[]).includes(text) ? (text as Anchor) : "start";
};

const riches = new WeakMap<ElementPart, { readonly from: Inherited; readonly rich: Rich | null }>();

/// Il testo `part` con le sue righe e i suoi pezzi, letto una volta finché
/// né lui né ciò che eredita cambiano; `null` se un'operazione non saprebbe
/// riscriverlo.
function richOfPart(part: Part): Rich | null {
  const known = riches.get(part.node);
  if (known !== undefined && known.from === part.inherited) return known.rich;
  const elem = elemOf(part.node);
  let rich: Rich | null = null;
  if (elem !== null) {
    const inherited: Record<string, string> = {};
    for (const name of [...INHERITED, "text-anchor"]) inherited[name] = part.inherited.get(name)!;
    rich = richOf(elem, inherited);
  }
  riches.set(part.node, { from: part.inherited, rich });
  return rich;
}

/// Il valore che hanno tutti `values`, o `null` se sono diversi o non ce
/// n'è uno.
function one<T>(values: readonly (T | null)[]): T | null {
  const first = values[0] ?? null;
  return first !== null && values.every((value) => value === first) ? first : null;
}

/// Il valore di `name` che vedono i caratteri del testo `part`, letto da
/// `read`; `null` se è misto.
function textOne<T>(part: Part, name: string, read: (value: string) => T | null): T | null {
  const rich = richOfPart(part);
  return one((rich === null ? [seen(part, name)] : seenValues(rich, name)).map(read));
}

/// Un numero che due letture confrontano: a quattro decimali.
const ratio = (value: number): number => Math.round(value * 1e4) / 1e4;

/// Vero se il testo `part` ha la linea `which` dappertutto, falso se da
/// nessuna parte, `null` se è misto.
function lineOf(part: Part, which: Emphasis): boolean | null {
  const rich = richOfPart(part);
  if (rich !== null) return emphasisOf(rich, which);
  const lines = textDecoration(part.own.get("text-decoration") ?? "none") ?? [];
  return lines.includes(which === "underline" ? "underline" : "line-through");
}

/// L'aspetto di `units`.
export function lookOf(model: DocumentModel, units: readonly Unit[]): Look {
  const parts = partsOf(model, units);
  const lengthIn = (value: string): number | null => {
    const size = nonNegativeLength(value);
    return size === null ? null : Number(place(size));
  };
  const several = parts.texts.filter((part) => (richOfPart(part)?.lines.length ?? 0) > 1);
  const fill = shared(parts.fills.map((part) => (part.role === "text" ? textOne(part, "fill", paintText) : paintText(seen(part, "fill")))));
  const stroke = shared(parts.strokes.map((part) => paintText(seen(part, INKED.has(part.role) ? "fill" : "stroke"))));
  const samples = new Map<string, PaintSample>();
  let resources: Map<string, LeafNode> | null = null;
  for (const value of [fill.value, stroke.value]) {
    if (value === null || !value.startsWith("url(") || samples.has(value)) continue;
    resources ??= resourcesOf(model);
    const sample = paintSample(model, value, resources);
    if (sample !== null) samples.set(value, sample);
  }
  return {
    fill,
    stroke,
    samples,
    width: shared([...parts.outlines.map(({ outline }) => outline.width), ...parts.widths.map(widthOf)]),
    opacity: shared(parts.chosen.map((part) => {
      const written = part.own.get("opacity");
      return written === undefined ? 1 : parseOpacity(written);
    })),
    family: shared(parts.texts.map((part) => textOne(part, "font-family", trim))),
    size: shared(parts.texts.map((part) => textOne(part, "font-size", lengthIn))),
    weight: shared(parts.texts.map((part) => textOne(part, "font-weight", weightOf))),
    italic: shared(parts.texts.map((part) => textOne(part, "font-style", (value) => trim(value) !== "normal"))),
    underline: shared(parts.texts.map((part) => lineOf(part, "underline"))),
    strike: shared(parts.texts.map((part) => lineOf(part, "strike"))),
    leading: shared(several.map((part) => {
      const rich = richOfPart(part)!;
      return one(rich.lines.slice(1).map((_, i) => {
        const value = leadingOf(rich, i + 1);
        return value === null ? null : ratio(value);
      }));
    })),
    spacing: shared(parts.texts.map((part) => {
      const rich = richOfPart(part);
      if (rich !== null) return one(spacingsOf(rich));
      const size = sizeOf(part);
      const gap = letterSpacing(seen(part, "letter-spacing"));
      return size === null || gap === null || size <= 0 ? null : ratio(gap / size);
    })),
    anchor: shared(parts.texts.map((part) => {
      const rich = richOfPart(part);
      return one(rich === null ? [anchorIn(seen(part, "text-anchor"))] : anchorsOf(rich).map(anchorIn));
    })),
    form: shared(parts.texts.filter((part) => part.node.details?.textPath === undefined).map((part): TextForm => (part.node.details?.wrap === undefined ? "point" : "area"))),
    wrap: shared(parts.texts.flatMap((part) => (part.node.details?.wrap === undefined ? [] : [Number(place(part.node.details.wrap))]))),
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
  | { readonly weight: number }
  | { readonly italic: boolean }
  | { readonly underline: boolean }
  | { readonly strike: boolean }
  /// In volte il corpo, come in [`Look`].
  | { readonly leading: number }
  | { readonly spacing: number }
  /// Uno stile del testo: il corpo e il peso insieme.
  | { readonly preset: { readonly size: number; readonly weight: number } }
  | { readonly anchor: Anchor }
  /// La larghezza del riquadro dei testi in area, nelle loro coordinate, e
  /// il bordo che resta fermo: il sinistro, se non lo si dice.
  | { readonly wrap: number; readonly fixed?: Side }
  /// Il tipo dei testi che non seguono un tracciato.
  | { readonly form: TextForm };

/// Un cambio pronto, e quante parti cambia.
export interface Restyled extends Arranged {
  readonly changed: number;
  /// Vero se un testo in area, andato di nuovo a capo, ha una riga più larga
  /// del riquadro.
  readonly overflow: boolean;
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
const sameWeight: Same = (a, b) => weightOf(a) === weightOf(b);
const sameSpacing: Same = (a, b) => {
  const p = letterSpacing(a);
  const q = letterSpacing(b);
  return p !== null && q !== null && place(p) === place(q);
};

/// Un peso come lo scrive il file: le parole per il normale e il grassetto.
export const weightText = (weight: number): string => (weight === 400 ? "normal" : weight === 700 ? "bold" : String(Math.round(weight)));

/// Come `name` confronta due valori scritti.
const SAME: Readonly<Record<string, Same>> = {
  fill: samePaint,
  "font-family": sameText,
  "font-size": sameLength,
  "font-weight": sameWeight,
  "font-style": sameText,
  "letter-spacing": sameSpacing,
  "text-anchor": sameText,
};

/// I cambi di un comando, parte per parte, e le operazioni che li scrivono.
class Changes {
  private readonly attrs = new Map<ElementPart, Record<string, string | null>>();
  /// I testi che cambiano interi, com'erano e come diventano.
  private readonly texts = new Map<ElementPart, { readonly part: Part; readonly before: Rich; now: Rich }>();
  private replaced = 0;
  private overflow = false;

  constructor(
    private readonly plan: Plan,
    private readonly model: DocumentModel,
    private readonly measure: Measure,
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

  /// Cambia il testo `part` intero con `edit`. Falso se il testo non si
  /// legge coi suoi pezzi, e non cambia.
  text(part: Part, edit: (rich: Rich) => Rich): boolean {
    let entry = this.texts.get(part.node);
    if (entry === undefined) {
      const rich = richOfPart(part);
      if (rich === null) return false;
      entry = { part, before: rich, now: rich };
      this.texts.set(part.node, entry);
    }
    entry.now = edit(entry.now);
    return true;
  }

  /// `value` in `name` sul testo `part` intero, che il file scrive corto:
  /// senza, se il testo lo vede comunque da chi lo contiene, e com'era
  /// scritto, se si vede uguale.
  textWrite(part: Part, name: string, value: string): void {
    if (!this.text(part, (rich) => shorter(part, restyleWhole(rich, name, value), name))) this.write(part, name, value, SAME[name] ?? sameText);
  }

  /// L'enfasi `which` accesa o spenta sul testo `part` intero.
  textEmphasis(part: Part, which: Emphasis, on: boolean): void {
    if (which === "bold" || which === "italic") {
      this.textWrite(part, which === "bold" ? "font-weight" : "font-style", which === "bold" ? (on ? "bold" : "normal") : on ? "italic" : "normal");
      return;
    }
    this.text(part, (rich) => emphasizeWhole(rich, which, on));
  }

  /// I testi che cambiano: un'operazione `set` se cambia soltanto il
  /// `text`, e il testo riscritto intero, coi cambi che ha già, se cambiano
  /// le righe o i pezzi.
  private finishTexts(): void {
    for (const { part, before, now: changed } of this.texts.values()) {
      const now = part.node.details?.textPath === undefined ? this.area(before, changed) : changed;
      if (sameRich(before, now)) continue;
      if (sameRich({ ...before, attrs: {} }, { ...now, attrs: {} })) {
        const attrs = this.of(part);
        for (const name of new Set([...Object.keys(before.attrs), ...Object.keys(now.attrs)])) {
          if (before.attrs[name] !== now.attrs[name] && attrs[name] === undefined) attrs[name] = now.attrs[name] ?? null;
        }
        continue;
      }
      const old = elemOf(part.node);
      if (old === null) continue;
      const merged: Record<string, string> = { ...now.attrs };
      for (const [name, value] of Object.entries(this.attrs.get(part.node) ?? {})) {
        if (value === null) delete merged[name];
        else merged[name] = value;
      }
      // Le righe si riscrivono con l'elemento: il resto passa da lui.
      if (replaceElem(this.plan, part.node, richElem(old, { ...now, attrs: merged }))) {
        this.attrs.delete(part.node);
        this.replaced++;
      }
    }
  }

  /// Il testo in area `now`, che era `before`, col riquadro dov'era e di
  /// nuovo a capo se serve.
  private area(before: Rich, now: Rich): Rich {
    const flowed = rewrapped(before, now, this.measure);
    this.overflow ||= flowed.overflow;
    return flowed.rich;
  }

  /// Le operazioni, con le chiavi di `units` dopo.
  finish(units: readonly Unit[]): Restyled {
    this.finishTexts();
    for (const [node, attrs] of this.attrs) {
      if (Object.keys(attrs).length === 0) continue;
      this.plan.ops.push({ op: "set", id: this.plan.idOf(node), attrs } satisfies Op);
    }
    const nodes = nodesOf(this.model, units);
    const keys = units.map((unit, at) => this.plan.keyOf(nodes[at]!, unit.key));
    const changed = [...this.attrs.values()].filter((attrs) => Object.keys(attrs).length > 0).length + this.replaced;
    return { ...this.plan.finish(keys), changed, overflow: this.overflow };
  }
}

/// Il testo `rich` di `part` col valore di `name` scritto corto: senza, se il
/// testo lo vede comunque da chi lo contiene, e com'era scritto prima, se si
/// vede uguale.
function shorter(part: Part, rich: Rich, name: string): Rich {
  const value = rich.attrs[name];
  if (value === undefined) return rich;
  const same = SAME[name] ?? sameText;
  const own = part.own.get(name);
  const attrs: Record<string, string> = { ...rich.attrs };
  if (same(value, part.inherited.get(name)!)) delete attrs[name];
  else if (own !== undefined && same(own, value)) attrs[name] = own;
  return { ...rich, attrs };
}

/// Le operazioni che danno `change` a `units`. La selezione resta la
/// stessa; un elemento che cambia senza id ne riceve uno.
export function lookOps(model: DocumentModel, units: readonly Unit[], change: LookChange, measure: Measure, ids: NewIds): Restyled {
  const changes = new Changes(new Plan(model, ids), model, measure);
  const parts = partsOf(model, units);

  if ("fill" in change) {
    for (const part of parts.fills) {
      if (part.role === "text") changes.textWrite(part, "fill", change.fill);
      else changes.write(part, "fill", change.fill, samePaint);
    }
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
    for (const part of parts.texts) changes.textWrite(part, "font-family", change.family);
  } else if ("anchor" in change) {
    for (const part of parts.texts) changes.textWrite(part, "text-anchor", change.anchor);
  } else if ("size" in change) {
    for (const part of parts.texts) changes.textWrite(part, "font-size", place(change.size));
  } else if ("weight" in change) {
    for (const part of parts.texts) changes.textWrite(part, "font-weight", weightText(change.weight));
  } else if ("preset" in change) {
    for (const part of parts.texts) {
      changes.textWrite(part, "font-size", place(change.preset.size));
      changes.textWrite(part, "font-weight", weightText(change.preset.weight));
    }
  } else if ("wrap" in change) {
    for (const part of parts.texts) {
      if (part.node.details?.wrap !== undefined) changes.text(part, (rich) => withWrap(rich, change.wrap, change.fixed));
    }
  } else if ("form" in change) {
    for (const part of parts.texts) {
      if (part.node.details?.textPath === undefined) changes.text(part, (rich) => (change.form === "area" ? areaText(rich, measure) : pointText(rich)));
    }
  } else if ("leading" in change) {
    for (const part of parts.texts) changes.text(part, (rich) => withLeading(rich, change.leading));
  } else if ("spacing" in change) {
    for (const part of parts.texts) {
      if (!changes.text(part, (rich) => shorter(part, withSpacing(rich, change.spacing), "letter-spacing"))) {
        const size = sizeOf(part);
        if (size !== null) changes.write(part, "letter-spacing", change.spacing === 0 ? "0" : place(change.spacing * size), sameSpacing);
      }
    }
  } else {
    const which: Emphasis = "italic" in change ? "italic" : "underline" in change ? "underline" : "strike";
    const on = "italic" in change ? change.italic : "underline" in change ? change.underline : change.strike;
    for (const part of parts.texts) changes.textEmphasis(part, which, on);
  }
  return changes.finish(units);
}

/// Il testo in area `unit` col riquadro largo `width`, fermo il bordo
/// `fixed`, come lo scriverebbe [`lookOps`]: l'anteprima della cornice che
/// lo allarga o lo stringe, e se una riga supera il riquadro. `null` se
/// `unit` non è un testo in area che si legge coi suoi pezzi.
export function framedText(model: DocumentModel, unit: Unit, width: number, fixed: Side, measure: Measure): { readonly elem: Elem; readonly overflow: boolean } | null {
  const [node] = nodesOf(model, [unit]);
  if (node === undefined || node.details?.role !== "text" || node.details.wrap === undefined) return null;
  const rich = richOfPart({ node, role: "text", own: ownOf(node), inherited: passedBy(node.parent) });
  const old = elemOf(node);
  if (rich === null || old === null) return null;
  const flowed = rewrapped(rich, withWrap(rich, width, fixed), measure);
  return { elem: richElem(old, flowed.rich), overflow: flowed.overflow };
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

/// Il carattere di uno stile, quello del primo carattere del testo:
/// `family` è `""` se nessuno lo scrive.
export interface StyleFont {
  readonly family: string;
  readonly size: number;
  readonly weight: string;
  /// Il corsivo, come lo scrive il file.
  readonly style: string;
  /// La spaziatura delle lettere, in volte il corpo.
  readonly spacing: number;
  readonly underline: boolean;
  readonly strike: boolean;
  /// L'interlinea della seconda riga, in volte il corpo; `null` per un testo
  /// di una riga, e chi la riceve tiene la sua.
  readonly leading: number | null;
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
    font: part.role === "text" && size !== null ? fontOf(part, size) : null,
  };
}

/// Il carattere del testo `part`, come lo vede il suo primo carattere.
function fontOf(part: Part, size: number): StyleFont {
  const rich = richOfPart(part);
  const line = rich?.lines.find((each) => each.spans.some((span) => span.text.trim() !== ""));
  const span = line?.spans.find((each) => each.text.trim() !== "") ?? null;
  const read = (name: string): string => (rich === null || line === undefined ? seen(part, name) : (seenIn(rich, line, span, name) ?? seen(part, name)));
  const own = rich === null || line === undefined ? size : sizeIn(rich, line, span);
  const lines = rich === null || line === undefined ? new Set(textDecoration(part.own.get("text-decoration") ?? "none") ?? []) : linesOf(rich, line, span);
  const leading = rich === null ? null : leadingOf(rich, 1);
  return {
    family: trim(read("font-family")),
    size: Number(place(own)),
    weight: trim(read("font-weight")),
    style: trim(read("font-style")),
    spacing: own > 0 ? ratio((letterSpacing(read("letter-spacing")) ?? 0) / own) : 0,
    underline: lines.has("underline"),
    strike: lines.has("line-through"),
    leading: leading === null ? null : ratio(leading),
  };
}

/// Il primo colore di `values` che si vede: non `none`, non `null`.
const shown = (...values: Array<string | null>): string | null => values.find((value) => value !== null && trim(value) !== "none") ?? null;

/// Le operazioni che danno `style` a `units`, in un passo: l'opacità
/// all'oggetto scelto, il resto alle parti, e a ciascuna ciò che ha. Il
/// colore di un testo e di un tratto a penna è uno solo: prende quello che
/// si vede dello stile, il riempimento per il testo, il contorno per il
/// tratto. La selezione resta la stessa.
export function styleOps(model: DocumentModel, units: readonly Unit[], style: Style, measure: Measure, ids: NewIds): Restyled {
  const changes = new Changes(new Plan(model, ids), model, measure);
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
      changes.textWrite(part, "font-family", font.family);
      changes.textWrite(part, "font-weight", font.weight);
      changes.textWrite(part, "font-style", font.style);
      // Il corpo prima della spaziatura e dell'interlinea, che si misurano
      // su di lui.
      changes.textWrite(part, "font-size", place(font.size));
      if (!changes.text(part, (rich) => shorter(part, withSpacing(rich, font.spacing), "letter-spacing"))) changes.write(part, "letter-spacing", place(font.spacing * font.size), sameSpacing);
      changes.textEmphasis(part, "underline", font.underline);
      changes.textEmphasis(part, "strike", font.strike);
      if (font.leading !== null) changes.text(part, (rich) => (rich.lines.length > 1 ? withLeading(rich, font.leading!) : rich));
    }
  }
  return changes.finish(units);
}
