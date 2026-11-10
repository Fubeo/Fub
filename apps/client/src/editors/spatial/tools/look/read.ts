// L'aspetto degli oggetti scelti, leggere: ciò che il pannello delle
// proprietà mostra, con gli attributi di un nodo e ciò che un contenitore
// passa ai figli letti una volta sola (`../look.ts`).

import { formatNumber } from "../../number";
import type { Role } from "../../scene/analysis";
import { elementChildren, writtenOf, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../../scene/model";
import { blendStyle, keyword, letterSpacing, nonNegativeLength, opacity as parseOpacity, paintReference, textDecoration, trim, type BlendStyle } from "../../scene/values";
import { elemOf, plainAttributes } from "../arrange";
import { hatchImage, hatchOf } from "../hatches";
import type { Unit } from "../hit";
import { labelTarget } from "../label-hosts";
import { outlineOf, type Inherited, type Outline } from "../outline";
import { customColor } from "../palette";
import { profileWidth } from "../profile";
import { paintSample, resourcesOf, type PaintSample } from "../resources";
import { anchorsOf, emphasisOf, INHERITED, leadingOf, richOf, seenValues, spacingsOf, weightOf, type Emphasis, type Rich } from "../rich";

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
  /// Il modo di fusione degli oggetti scelti, come lo scrive il file:
  /// `normal` dove nessuno lo dice.
  readonly blend: Shared<string>;
  /// Se i gruppi e i collegamenti scelti isolano la fusione di ciò che
  /// contengono; gli altri oggetti non contano.
  readonly isolate: Shared<boolean>;
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
}

/// Ciò che una parte eredita, coi valori iniziali di SVG: i colori, il
/// contorno di `outline.ts`, il testo.
export const INITIAL: Inherited = new Map([
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
export const FILLED: ReadonlySet<Role> = new Set(["ngon", "star", "path", "rect", "ellipse", "circle", "polyline", "polygon", "text"]);

/// I ruoli che hanno un contorno, come in `outline.ts`.
export const OUTLINED: ReadonlySet<Role> = new Set(["arrow", "connector", "ngon", "star", "path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// I ruoli tutti riempimento che si vedono come una linea: il loro colore è
/// quello del contorno.
export const INKED: ReadonlySet<Role> = new Set(["stroke", "width"]);

/// I ruoli che passano tutto ai figli.
export const CONTAINERS: ReadonlySet<Role> = new Set(["group", "link"]);

/// I decimali di un'opacità, come quelli che il pannello degli attributi
/// scrive.
export const OPACITY_PLACES = 4;

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

export const owns = new WeakMap<ElementPart, { readonly written: string; readonly own: ReadonlyMap<string, string> }>();

/// Gli attributi senza namespace di `node`, letti una volta finché non
/// cambiano.
export function ownOf(node: ElementPart): ReadonlyMap<string, string> {
  const known = owns.get(node);
  const written = writtenOf(node);
  if (known !== undefined && known.written === written) return known.own;
  const own = plainAttributes(node);
  owns.set(node, { written, own });
  return own;
}

export const passes = new WeakMap<ElementPart, { readonly from: Inherited; readonly own: ReadonlyMap<string, string>; readonly out: Inherited }>();

/// Ciò che i figli di `node` ereditano. Un contenitore che resta lo stesso
/// nodo si rilegge se cambia il suo tag, o se il genitore gli passa altro.
export function passedBy(node: ElementPart | null): Inherited {
  if (node === null) return INITIAL;
  const from = passedBy(node.parent);
  const own = ownOf(node);
  const known = passes.get(node);
  if (known !== undefined && known.from === from && known.own === own) return known.out;
  let out: Map<string, string> | null = null;
  for (const name of INITIAL.keys()) {
    const value = own.get(name);
    if (value === undefined || value === from.get(name)) continue;
    out ??= new Map(from);
    out.set(name, value);
  }
  const passed = out ?? from;
  passes.set(node, { from, own, out: passed });
  return passed;
}

/// Ciò che eredita un testo nuovo in un livello che non scrive niente.
export function initialText(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...INHERITED, "text-anchor"]) out[name] = INITIAL.get(name)!;
  return out;
}

/// Una parte della selezione: l'elemento, i suoi attributi e ciò che
/// eredita.
export interface Part {
  readonly node: ElementPart;
  readonly role: Role;
  readonly own: ReadonlyMap<string, string>;
  readonly inherited: Inherited;
}

/// Il valore di `name` che `part` vede: il suo, o quello ereditato.
export const seen = (part: Part, name: string): string => part.own.get(name) ?? part.inherited.get(name)!;

/// I valori già letti da [`paintText`]: un disegno scrive pochi colori,
/// ripetuti su migliaia di oggetti.
export const PAINT_TEXTS = new Map<string, string>();
export const PAINT_TEXTS_MAX = 4096;

/// Un colore come lo mostra il pannello: `#rrggbb` o `none`, una risorsa
/// `url(#id)`, che è la stessa qualunque sia il ripiego, e com'è scritto ciò
/// che non è un colore.
export function paintText(value: string): string {
  let read = PAINT_TEXTS.get(value);
  if (read === undefined) {
    const text = trim(value);
    const used = text === "none" ? null : paintReference(text);
    read = text === "none" ? "none" : used !== null ? `url(#${used.id})` : customColor(text) ?? text;
    if (PAINT_TEXTS.size >= PAINT_TEXTS_MAX) PAINT_TEXTS.clear();
    PAINT_TEXTS.set(value, read);
  }
  return read;
}

/// Le parti della selezione, divise per ciò che hanno.
export interface Parts {
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
export function nodesOf(model: DocumentModel, units: readonly Unit[]): ElementPart[] {
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

export function partsOf(model: DocumentModel, units: readonly Unit[]): Parts {
  return partsFrom(nodesOf(model, units));
}

/// Le parti di `nodes`, gli oggetti scelti, come [`partsOf`].
export function partsFrom(nodes: readonly ElementPart[]): Parts {
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
    if (role === "text") out.texts.push(part);
    // L'etichetta di una forma in un gruppo scelto ha il suo colore: il
    // riempimento e il contorno del gruppo sono quelli della forma, come in
    // Visio e PowerPoint. Il carattere e il corpo sono i suoi.
    if (!chosen && role === "text" && node.details?.inside !== undefined && labelTarget(node) !== null) return;
    if (FILLED.has(role)) out.fills.push(part);
    if (INKED.has(role)) out.strokes.push(part);
    if (role === "width" && node.details?.varwidth !== undefined) out.widths.push(part);
    if (OUTLINED.has(role)) {
      out.strokes.push(part);
      const outline = outlineOf(node, inherited, part.own);
      if (outline !== null) out.outlines.push({ part, outline });
    }
  };
  for (const node of nodes) visit(node, passedBy(node.parent), true);
  return out;
}

/// I testi di `units` che la sezione «Testo» cambia: quelli scelti, e
/// quelli dentro i gruppi scelti, etichette comprese, tranne i bloccati.
export function textNodesOf(model: DocumentModel, units: readonly Unit[]): ElementPart[] {
  return partsOf(model, units).texts.map((part) => part.node);
}

/// Il valore comune di `values`, se c'è.
export function shared<T>(values: readonly (T | null)[]): Shared<T> {
  const first = values[0] ?? null;
  const same = first !== null && values.every((value) => value === first);
  return { count: values.length, value: same ? first : null };
}

/// Lo spessore della linea a spessore variabile `part`, coi numeri come li
/// mostra il pannello.
export const widthOf = (part: Part): number => Number(place(profileWidth(part.node.details!.varwidth!.profile)));

/// Il corpo che `part` vede, o `null` se non si legge come una lunghezza.
export const sizeOf = (part: Part): number | null => nonNegativeLength(seen(part, "font-size"));

/// Un allineamento come lo scrive il file; quello di SVG se non si legge.
export const anchorIn = (value: string): Anchor => {
  const text = trim(value);
  return keyword("text-anchor", text) && (ANCHORS as readonly string[]).includes(text) ? (text as Anchor) : "start";
};

export const riches = new WeakMap<ElementPart, { readonly from: Inherited; readonly rich: Rich | null }>();

/// Il testo `part` con le sue righe e i suoi pezzi, letto una volta finché
/// né lui né ciò che eredita cambiano; `null` se un'operazione non saprebbe
/// riscriverlo.
export function richOfPart(part: Part): Rich | null {
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
export function one<T>(values: readonly (T | null)[]): T | null {
  const first = values[0] ?? null;
  return first !== null && values.every((value) => value === first) ? first : null;
}

/// Il valore di `name` che vedono i caratteri del testo `part`, letto da
/// `read`; `null` se è misto.
export function textOne<T>(part: Part, name: string, read: (value: string) => T | null): T | null {
  const rich = richOfPart(part);
  return one((rich === null ? [seen(part, name)] : seenValues(rich, name)).map(read));
}

/// Un numero che due letture confrontano: a quattro decimali.
export const ratio = (value: number): number => Math.round(value * 1e4) / 1e4;

/// Vero se il testo `part` ha la linea `which` dappertutto, falso se da
/// nessuna parte, `null` se è misto.
export function lineOf(part: Part, which: Emphasis): boolean | null {
  const rich = richOfPart(part);
  if (rich !== null) return emphasisOf(rich, which);
  const lines = textDecoration(part.own.get("text-decoration") ?? "none") ?? [];
  return lines.includes(which === "underline" ? "underline" : "line-through");
}

/// L'opacità di un oggetto dai suoi attributi: piena se non la scrive,
/// `null` se non si legge.
export const opacityIn = (own: ReadonlyMap<string, string>): number | null => {
  const written = own.get("opacity");
  return written === undefined ? 1 : parseOpacity(written);
};

/// Lo `style` di `part` come lo dice il formato; `null` se ha altro, e
/// allora l'elemento non si tocca. Senza `style`, niente fusione e niente
/// isolamento.
export function blendOf(part: Part): BlendStyle | null {
  const written = part.own.get("style");
  return written === undefined ? { blend: null, isolate: null } : blendStyle(written, isContainer(part.node));
}

/// Vero se `node` è un gruppo o un collegamento: l'isolamento è suo.
export const isContainer = (node: ElementPart): boolean => node.facts.local === "g" || node.facts.local === "a";

/// L'opacità degli oggetti di `units`, da sola: la legge ogni volta che la
/// selezione cambia chi la mostra senza il pannello, e mille oggetti si
/// leggono entro un fotogramma. Come `lookOf(...).opacity`.
export function opacityOf(model: DocumentModel, units: readonly Unit[]): Shared<number> {
  return shared(nodesOf(model, units).flatMap((node) => (node.details?.role === undefined ? [] : [opacityIn(ownOf(node))])));
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
    const hatch = sample?.kind === "pattern" ? hatchOf(resources.get(paintReference(value)!.id)!) : null;
    if (sample !== null) samples.set(value, hatch === null ? sample : { kind: "hatch", image: hatchImage(hatch) });
  }
  return {
    fill,
    stroke,
    samples,
    width: shared([...parts.outlines.map(({ outline }) => outline.width), ...parts.widths.map(widthOf)]),
    opacity: shared(parts.chosen.map((part) => opacityIn(part.own))),
    blend: shared(parts.chosen.flatMap((part) => {
      const style = blendOf(part);
      return style === null ? [] : [style.blend ?? "normal"];
    })),
    isolate: shared(parts.chosen.flatMap((part) => {
      const style = isContainer(part.node) ? blendOf(part) : null;
      return style === null ? [] : [style.isolate === true];
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
  };
}

/// Un numero come lo scrive il file.
export const place = (value: number): string => formatNumber(value, 2);
