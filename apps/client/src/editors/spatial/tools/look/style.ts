// L'aspetto degli oggetti scelti, lo stile: copiarlo e incollarlo, e gli
// stili del disegno, con i loro campi, il modello, chi li segue e che cosa
// ne è cambiato (`../look.ts`).

import { formatNumber } from "../../number";
import type { SwatchFacts } from "../../scene/classify";
import type { Bounds } from "../../scene/geometry";
import type { Matrix } from "../../scene/matrix";
import { elementChildren, type DocumentModel, type ElementPart, type LeafNode } from "../../scene/model";
import type { Op } from "../../scene/ops";
import type { Elem } from "../../scene/serialize";
import { WIDTH_CAPS, WIDTH_JOINS } from "../../scene/varwidth";
import { blendStyle, letterSpacing, nonNegativeLength, paintReference, textDecoration, trim } from "../../scene/values";
import { elemOf, fubAttributes, Plan } from "../arrange";
import { NewIds } from "../edit";
import { effectsState, writeEffects, type Effect } from "../effects";
import { geometryBox, type Unit } from "../hit";
import type { Measure } from "../measure";
import { dashOf, dashValue, type Cap, type Inherited } from "../outline";
import { profileWidth } from "../profile";
import { privateResources, ResourceCopies, resourcesOf } from "../resources";
import { emphasisOf, leadingOf, linesOf, ownLines, seenIn, seenValues, sizeIn, spacingsOf, weightOf, withLeading, withSpacing, type Rich } from "../rich";
import { protoTips, tipsStyleOf, type TipsStyle } from "../tips";
import {
  CONTAINERS,
  FILLED,
  INITIAL,
  INKED,
  isContainer,
  nodesOf,
  OPACITY_PLACES,
  opacityIn,
  OUTLINED,
  ownOf,
  type Part,
  type Parts,
  partsFrom,
  partsOf,
  passedBy,
  place,
  ratio,
  richOfPart,
  seen,
  sizeOf,
} from "./read";
import { boxFit, Changes, type Restyled, type Same, SAME, sameDashes, sameLength, samePaint, sameSpacing, sameText, shorter } from "./write";

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
  /// Il modo di fusione dell'oggetto scelto; `null` per `normal`, che
  /// incollando toglie quello di chi riceve.
  readonly blend: string | null;
  /// Gli effetti dell'oggetto scelto, anche nascosti; `[]` se non ne ha, e
  /// incollando toglie quelli di chi riceve. `null` se ha un filtro d'un altro
  /// programma: chi riceve tiene i suoi.
  readonly effects: readonly Effect[] | null;
  readonly font: StyleFont | null;
  /// Il riquadro della geometria della parte copiata, nelle sue coordinate:
  /// una sfumatura nelle coordinate di chi la usa passa da lui a quello di
  /// chi la riceve. `null` senza colori, o se non si misura.
  readonly box: Bounds | null;
  /// Le risorse private che usano i colori, com'erano, per id.
  readonly resources: ReadonlyMap<string, Elem>;
  /// I campioni che usano i colori, col nome e il colore, per id: in un
  /// altro disegno vale il campione con lo stesso nome e lo stesso colore.
  readonly swatches: ReadonlyMap<string, SwatchFacts>;
  /// Le punte della parte copiata, per capo, o `null` se non può averne:
  /// chi riceve lo stile tiene le sue.
  readonly tips: TipsStyle | null;
}

/// La prima parte di `from` che ha un aspetto suo, nell'ordine del
/// documento: una forma, un tratto a penna, un testo o un'immagine; `from`
/// stesso, se lo è. Una parte bloccata dentro di lui non conta; `from`
/// bloccato sì, perché leggerlo non lo cambia.
export function firstPart(from: ElementPart, graphic = false): Part | null {
  let found: Part | null = null;
  const visit = (node: ElementPart, inherited: Inherited): void => {
    const role = node.details?.role;
    if (found !== null || role === undefined || (node !== from && node.details?.locked === true)) return;
    if (CONTAINERS.has(role)) {
      if (node.kind !== "container") return;
      const inner = passedBy(node);
      for (const child of elementChildren(node)) visit(child, inner);
      return;
    }
    if (graphic && role === "text") return;
    if (FILLED.has(role) || OUTLINED.has(role) || INKED.has(role) || role === "image") found = { node, role, own: ownOf(node), inherited };
  };
  visit(from, passedBy(from.parent));
  return found;
}

/// Lo stile di `unit`: quello di `leaf`, una sua forma, o della sua prima
/// parte, con l'opacità dell'oggetto stesso. `null` se non ha parti che si
/// possano copiare.
export function styleOf(model: DocumentModel, unit: Unit, leaf: LeafNode | null = null): Style | null {
  const [node] = nodesOf(model, [unit]);
  return styleFrom(model, node!, leaf ?? node!);
}

/// Lo stile della prima parte di `from`, con l'opacità, la fusione e gli
/// effetti di `node`, l'oggetto che la contiene.
export function styleFrom(model: DocumentModel, node: ElementPart, from: ElementPart): Style | null {
  const part = firstPart(from);
  return part === null ? null : partStyle(model, node, part);
}

/// Lo stile di `part`, con l'opacità, la fusione e gli effetti di `node`,
/// l'oggetto che la contiene.
export function partStyle(model: DocumentModel, node: ElementPart, part: Part): Style {
  const opacity = opacityIn(ownOf(node)) ?? 1;
  const written = ownOf(node).get("style");
  const blend = (written === undefined ? null : blendStyle(written, isContainer(node)))?.blend ?? null;
  const state = effectsState(model, node);
  const size = part.role === "text" ? sizeOf(part) : null;
  const fill = FILLED.has(part.role) ? seen(part, "fill") : null;
  const stroke = OUTLINED.has(part.role) ? seen(part, "stroke") : INKED.has(part.role) ? seen(part, "fill") : null;
  const paints = [fill, stroke].filter((value): value is string => value !== null);
  const elem = paints.some((value) => paintReference(value) !== null) ? elemOf(part.node) : null;
  return {
    fill,
    stroke,
    outline: OUTLINED.has(part.role)
      ? { width: seen(part, "stroke-width"), dashes: seen(part, "stroke-dasharray"), cap: seen(part, "stroke-linecap"), join: seen(part, "stroke-linejoin") }
      : part.role === "width" && part.node.details?.varwidth !== undefined
        ? { width: place(profileWidth(part.node.details.varwidth.profile)), dashes: "none", cap: part.node.details.varwidth.cap, join: part.node.details.varwidth.join }
        : null,
    opacity,
    blend: blend === "normal" ? null : blend,
    effects: state.kind === "none" ? [] : state.kind === "effects" ? state.effects : null,
    font: part.role === "text" && size !== null ? fontOf(part, size) : null,
    box: elem === null ? null : geometryBox(elem),
    resources: privateResources(model, paints, elemOf),
    swatches: swatchesOf(model, paints),
    tips: tipsStyleOf(model, part.node),
  };
}

/// I campioni del disegno che usano i colori `values`, per id.
export function swatchesOf(model: DocumentModel, values: readonly string[]): Map<string, SwatchFacts> {
  const out = new Map<string, SwatchFacts>();
  const ids = values.flatMap((value) => paintReference(value)?.id ?? []);
  if (ids.length === 0) return out;
  const resources = resourcesOf(model);
  for (const id of ids) {
    const swatch = resources.get(id)?.details?.swatch;
    if (swatch !== undefined) out.set(id, swatch);
  }
  return out;
}

/// Il carattere del testo `part`, come lo vede il suo primo carattere.
export function fontOf(part: Part, size: number): StyleFont {
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
export const shown = (...values: Array<string | null>): string | null => values.find((value) => value !== null && trim(value) !== "none") ?? null;

/// Le operazioni che danno `style` a `units`, in un passo: l'opacità, la
/// fusione e gli effetti all'oggetto scelto, il resto alle parti, e a
/// ciascuna ciò che ha. Gli effetti vanno a chi li può avere; gli altri
/// tengono i loro. Il
/// colore di un testo e di un tratto a penna è uno solo: prende quello che
/// si vede dello stile, il riempimento per il testo, il contorno per il
/// tratto. La selezione resta la stessa.
export function styleOps(model: DocumentModel, units: readonly Unit[], style: Style, measure: Measure, ids: NewIds): Restyled {
  const changes = new Changes(new Plan(model, ids), model, measure, style.resources, style.swatches);
  give(changes, partsOf(model, units), style, "all", null);
  return changes.finish(units);
}

/// Quali parti un aspetto raggiunge: tutte, come «Incolla lo stile»; o
/// quelle di uno stile del disegno del suo tipo: uno grafico non tocca il
/// colore e il carattere dei testi, uno di testo tocca soltanto quelli.
export type Scope = "all" | StyleKind;

/// Dà `style` alle parti `parts`, in `changes`: soltanto i campi di `only`,
/// o tutti se è `null`, e a ciascuna parte ciò che ha.
export function give(changes: Changes, parts: Parts, style: Style, scope: Scope, only: ReadonlySet<StyleField> | null): void {
  const has = (field: StyleField): boolean => only === null || only.has(field);
  if (scope !== "text") {
    for (const part of parts.chosen) {
      if (has("opacity")) changes.opacity(part, style.opacity);
      if (has("blend")) changes.blend(part, style.blend ?? "normal");
    }
    if (style.effects !== null && has("effects")) changes.giveEffects(parts.chosen, style.effects);
  }
  if (has("fill")) {
    for (const part of parts.fills) {
      if (scope !== "all" && (part.role === "text") !== (scope === "text")) continue;
      const value = part.role === "text" && scope === "all" ? shown(style.fill, style.stroke) : style.fill;
      if (value !== null) changes.paint(part, "fill", value, style.box);
    }
  }
  for (const part of scope === "text" ? [] : parts.strokes) {
    const outline = style.outline;
    if (INKED.has(part.role)) {
      if (has("stroke")) {
        const value = shown(style.stroke, style.fill);
        if (value !== null) changes.paint(part, "fill", value, style.box);
      }
      // Una linea a spessore variabile prende lo spessore, gli estremi e gli
      // angoli, e il suo profilo resta.
      if (part.role !== "width" || outline === null || !parts.widths.includes(part) || !(has("width") || has("cap") || has("join"))) continue;
      const width = has("width") ? nonNegativeLength(outline.width) : profileWidth(part.node.details!.varwidth!.profile);
      if (width !== null && width > 0) changes.widthTo(part, width, { cap: has("cap") ? outline.cap : "", join: has("join") ? outline.join : "" });
      continue;
    }
    if (style.stroke !== null && has("stroke")) changes.paint(part, "stroke", style.stroke, style.box);
    if (style.tips !== null && (has("tipStart") || has("tipEnd"))) changes.tips(part, { start: has("tipStart") ? style.tips.start : null, end: has("tipEnd") ? style.tips.end : null });
    if (outline === null) continue;
    if (has("width")) changes.write(part, "stroke-width", outline.width, sameLength);
    if (has("dashes")) changes.write(part, "stroke-dasharray", dashesFor(outline, has("width") ? outline.width : seen(part, "stroke-width"), has("cap") ? outline.cap : seen(part, "stroke-linecap")), sameDashes);
    if (has("cap")) changes.write(part, "stroke-linecap", outline.cap, sameText);
    if (has("join")) changes.write(part, "stroke-linejoin", outline.join, sameText);
    changes.arrow(part);
  }
  const font = style.font;
  if (font === null || scope === "graphic") return;
  for (const part of parts.texts) {
    if (has("family")) changes.textWrite(part, "font-family", font.family);
    if (has("weight")) changes.textWrite(part, "font-weight", font.weight);
    if (has("italic")) changes.textWrite(part, "font-style", font.style);
    // Il corpo prima della spaziatura e dell'interlinea, che si misurano su
    // di lui.
    if (has("size")) changes.textWrite(part, "font-size", place(font.size));
    if (has("spacing") && !changes.text(part, (rich) => shorter(part, withSpacing(rich, font.spacing), "letter-spacing"))) {
      const size = has("size") ? font.size : sizeOf(part);
      if (size !== null) changes.write(part, "letter-spacing", place(font.spacing * size), sameSpacing);
    }
    if (has("underline")) changes.textEmphasis(part, "underline", font.underline);
    if (has("strike")) changes.textEmphasis(part, "strike", font.strike);
    if (has("leading") && font.leading !== null) changes.text(part, (rich) => (rich.lines.length > 1 ? withLeading(rich, font.leading!) : rich));
  }
}

/// Gli estremi di un contorno come li scrive il file; quelli di SVG se non
/// si leggono.
export const capIn = (value: string): Cap => {
  const text = trim(value);
  return text === "round" || text === "square" ? text : "butt";
};

/// Il tratteggio di `outline`, uno stile, su un contorno spesso `width` con
/// gli estremi `cap`: com'è scritto sul contorno dello stile, e uno del menu
/// sugli altri, con le stesse proporzioni in spessori.
export function dashesFor(outline: StyleOutline, width: string, cap: string): string {
  if (width === outline.width && cap === outline.cap) return outline.dashes;
  const from = nonNegativeLength(outline.width);
  const to = nonNegativeLength(width);
  const dash = from === null || !(from > 0) ? null : dashOf(outline.dashes, from, capIn(outline.cap));
  return dash === null || to === null || !(to > 0) ? outline.dashes : dashValue(dash, to, capIn(cap));
}

// ---------------------------------------------------------------------------
// Gli stili del disegno.
// ---------------------------------------------------------------------------

/// Un campo di uno stile del disegno: ciò che può dire, e in che cosa chi lo
/// segue può esserne diverso.
export type StyleField =
  | "fill"
  | "stroke"
  | "width"
  | "dashes"
  | "cap"
  | "join"
  | "tipStart"
  | "tipEnd"
  | "opacity"
  | "blend"
  | "effects"
  | "family"
  | "size"
  | "weight"
  | "italic"
  | "underline"
  | "strike"
  | "spacing"
  | "leading";

/// Il tipo di uno stile del disegno: di testo o grafico.
export type StyleKind = "text" | "graphic";

/// I campi di uno stile di ciascun tipo, nell'ordine in cui il pannello li
/// nomina.
export const STYLE_FIELDS: Readonly<Record<StyleKind, readonly StyleField[]>> = {
  graphic: ["fill", "stroke", "width", "dashes", "cap", "join", "tipStart", "tipEnd", "opacity", "blend", "effects"],
  text: ["family", "size", "weight", "italic", "underline", "strike", "spacing", "leading", "fill"],
};

/// Il riquadro di uno stile del disegno, dove stanno le sue sfumature: quello
/// della sua spezzata (formato della scena, stili).
export const STYLE_BOX: Bounds = { min: [0, 0], max: [100, 100] };

/// Uno stile del disegno come si dà: il tipo, l'aspetto, e i campi che dice.
/// Chi lo segue tiene i suoi valori degli altri.
export interface StyleLook {
  readonly kind: StyleKind;
  readonly style: Style;
  readonly fields: ReadonlySet<StyleField>;
}

/// I colori che usa `style`.
export const paintsOf = (style: Pick<Style, "fill" | "stroke">): string[] => [style.fill, style.stroke].filter((value): value is string => value !== null);

/// Lo stile del disegno `node`, il suo prototipo, come si dà; `null` se
/// `node` non è uno stile. Dice soltanto ciò che scrive: un attributo che
/// manca lascia a chi lo segue il suo valore. L'opacità, la fusione e gli
/// effetti di uno stile grafico li dice sempre, come un oggetto: senza
/// attributo sono piena, normale e nessuno; un filtro d'un altro programma
/// non li dice.
export function protoOf(model: DocumentModel, node: ElementPart): StyleLook | null {
  const kind = node.details?.style?.kind;
  if (kind === undefined) return null;
  const own = ownOf(node);
  const value = (name: string): string => own.get(name) ?? INITIAL.get(name)!;
  const fields = new Set<StyleField>();
  const say = (field: StyleField, name: string): void => {
    if (own.has(name)) fields.add(field);
  };
  say("fill", "fill");
  const fill = own.get("fill") ?? null;
  if (kind === "text") {
    for (const [field, name] of [["family", "font-family"], ["size", "font-size"], ["weight", "font-weight"], ["italic", "font-style"], ["spacing", "letter-spacing"], ["underline", "text-decoration"], ["strike", "text-decoration"]] as const) say(field, name);
    const leading = fubAttributes(node).get("leading");
    if (leading !== undefined) fields.add("leading");
    const size = nonNegativeLength(value("font-size")) ?? 16;
    const lines = textDecoration(own.get("text-decoration") ?? "none") ?? [];
    const paints = paintsOf({ fill, stroke: null });
    return {
      kind,
      fields,
      style: {
        fill,
        stroke: null,
        outline: null,
        opacity: 1,
        blend: null,
        effects: null,
        font: {
          family: trim(value("font-family")),
          size: Number(place(size)),
          weight: trim(value("font-weight")),
          style: trim(value("font-style")),
          spacing: size > 0 ? ratio((letterSpacing(value("letter-spacing")) ?? 0) / size) : 0,
          underline: lines.includes("underline"),
          strike: lines.includes("line-through"),
          leading: leading === undefined ? null : Number(leading),
        },
        box: STYLE_BOX,
        resources: privateResources(model, paints, elemOf),
        swatches: swatchesOf(model, paints),
        tips: null,
      },
    };
  }
  for (const [field, name] of [["stroke", "stroke"], ["width", "stroke-width"], ["dashes", "stroke-dasharray"], ["cap", "stroke-linecap"], ["join", "stroke-linejoin"]] as const) say(field, name);
  const tips = protoTips(model, node);
  if (tips.start !== null) fields.add("tipStart");
  if (tips.end !== null) fields.add("tipEnd");
  fields.add("opacity");
  fields.add("blend");
  const state = effectsState(model, node);
  if (state.kind !== "other") fields.add("effects");
  const written = own.get("style");
  const blend = (written === undefined ? null : blendStyle(written, false))?.blend ?? null;
  const stroke = own.get("stroke") ?? null;
  const paints = paintsOf({ fill, stroke });
  return {
    kind,
    fields,
    style: {
      fill,
      stroke,
      outline: { width: value("stroke-width"), dashes: value("stroke-dasharray"), cap: value("stroke-linecap"), join: value("stroke-linejoin") },
      opacity: opacityIn(own) ?? 1,
      blend: blend === "normal" ? null : blend,
      effects: state.kind === "none" ? [] : state.kind === "effects" ? state.effects : null,
      font: null,
      box: STYLE_BOX,
      resources: privateResources(model, paints, elemOf),
      swatches: swatchesOf(model, paints),
      tips,
    },
  };
}

/// Lo stile di un tipo che un oggetto mostra, per farne uno stile del disegno
/// o per aggiornarlo: come [`StyleLook`], coi campi che l'oggetto ha, e il
/// marcatore che ogni capo che lo stile dice ha sull'oggetto, `none` o una
/// punta della raccolta, che lo stile scrive com'è.
export interface StyleSource extends StyleLook {
  readonly markers: { readonly start: string | null; readonly end: string | null };
}

/// Lo stile di tipo `kind` che mostra `node`, un oggetto scelto: di un
/// testo, il testo intero; grafico, quello della sua prima parte che non è
/// un testo, con l'opacità, la fusione e gli effetti di `node`. Di un testo
/// con una parola in grassetto o in un altro colore vale ciò che ha il resto
/// del testo. `null` se `node` non ha niente di quel tipo.
export function styleSource(model: DocumentModel, node: ElementPart, kind: StyleKind): StyleSource | null {
  if (kind === "text") return textSource(model, node);
  const part = firstPart(node, true);
  if (part === null) return null;
  const whole = partStyle(model, node, part);
  const style: Style = { ...whole, font: null };
  const fields = new Set<StyleField>(["opacity", "blend"]);
  if (style.effects !== null) fields.add("effects");
  if (FILLED.has(part.role)) fields.add("fill");
  if (OUTLINED.has(part.role) || INKED.has(part.role)) fields.add("stroke");
  if (OUTLINED.has(part.role)) for (const field of ["width", "dashes", "cap", "join"] as const) fields.add(field);
  else if (style.outline !== null) for (const field of ["width", "cap", "join"] as const) fields.add(field);
  const own = ownOf(part.node);
  const marker = (end: "start" | "end"): string | null => {
    const tip = style.tips?.[end] ?? null;
    if (tip === null) return null;
    fields.add(end === "start" ? "tipStart" : "tipEnd");
    return tip === "none" ? "none" : own.get(end === "start" ? "marker-start" : "marker-end")!;
  };
  const markers = { start: marker("start"), end: marker("end") };
  return { kind, fields, style, markers };
}

/// Lo stile di testo del testo `node`. Per ogni attributo vale il valore
/// che vedono tutti i caratteri, se è uno solo, e quello del testo se no.
export function textSource(model: DocumentModel, node: ElementPart): StyleSource | null {
  if (node.details?.role !== "text") return null;
  const part: Part = { node, role: "text", own: ownOf(node), inherited: passedBy(node.parent) };
  const rich = richOfPart(part);
  const read = (name: string): string => {
    if (rich === null) return seen(part, name);
    const values = seenValues(rich, name);
    const same = SAME[name] ?? sameText;
    if (values.length > 0 && values.every((value) => same(value, values[0]!))) return values[0]!;
    return rich.attrs[name] ?? rich.inherited[name] ?? INITIAL.get(name)!;
  };
  const size = nonNegativeLength(read("font-size")) ?? 16;
  const spacing = ((): number => {
    const all = rich === null ? [] : spacingsOf(rich);
    if (all.length === 1) return all[0]!;
    const gap = letterSpacing(rich === null ? seen(part, "letter-spacing") : (rich.attrs["letter-spacing"] ?? rich.inherited["letter-spacing"] ?? "normal")) ?? 0;
    return size > 0 ? ratio(gap / size) : 0;
  })();
  const line = (which: "underline" | "strike"): boolean => {
    const on = rich === null ? null : emphasisOf(rich, which);
    if (on !== null) return on;
    const lines = rich === null ? new Set(textDecoration(part.own.get("text-decoration") ?? "none") ?? []) : ownLines(rich.attrs);
    return lines.has(which === "underline" ? "underline" : "line-through");
  };
  const leading = ((): number | null => {
    if (rich === null || rich.lines.length < 2) return null;
    const all = rich.lines.slice(1).map((_, i) => leadingOf(rich, i + 1));
    const first = all.find((value) => value !== null) ?? null;
    return first === null ? null : ratio(first);
  })();
  const fill = read("fill");
  const family = trim(read("font-family"));
  const fields = new Set<StyleField>(["fill", "size", "weight", "italic", "spacing", "underline", "strike"]);
  if (family !== "") fields.add("family");
  if (leading !== null) fields.add("leading");
  const elem = paintReference(fill) === null ? null : elemOf(node);
  return {
    kind: "text",
    fields,
    style: {
      fill,
      stroke: null,
      outline: null,
      opacity: 1,
      blend: null,
      effects: null,
      font: { family, size: Number(place(size)), weight: trim(read("font-weight")), style: trim(read("font-style")), spacing, underline: line("underline"), strike: line("strike"), leading },
      box: elem === null ? null : geometryBox(elem),
      resources: privateResources(model, [fill], elemOf),
      swatches: swatchesOf(model, [fill]),
      tips: null,
    },
    markers: { start: null, end: null },
  };
}

/// Un oggetto che segue uno stile del disegno, e ciò che riceve: i campi
/// dello stile da dargli, e altri attributi da scrivere coi suoi, come
/// `fub:style`.
export interface Follow {
  readonly node: ElementPart;
  /// I campi da dargli, fra quelli che lo stile dice; tutti se `null`.
  readonly fields: ReadonlySet<StyleField> | null;
  readonly attrs?: Readonly<Record<string, string | null>>;
}

/// Le operazioni che danno `look`, uno stile del disegno, a ogni oggetto di
/// `follows`, in un passo, dopo `before`: le operazioni che fanno o
/// cambiano lo stile. A un testo vanno il suo colore e il suo carattere, a
/// ciascuna parte di un oggetto grafico ciò che ha; un testo che non ha lo
/// stesso valore dappertutto tiene le parole che ne scrivono un altro. La
/// selezione `units` resta la stessa.
export function followOps(model: DocumentModel, units: readonly Unit[], look: StyleLook, follows: readonly Follow[], before: readonly Op[], measure: Measure, ids: NewIds): Restyled {
  const plan = new Plan(model, ids);
  plan.ops.push(...before);
  const changes = new Changes(plan, model, measure, look.style.resources, look.style.swatches);
  changes.keepRuns = true;
  for (const follow of follows) {
    const parts = partsFrom([follow.node]);
    const only = follow.fields === null ? look.fields : new Set([...follow.fields].filter((field) => look.fields.has(field)));
    give(changes, parts, look.style, look.kind, only);
    const chosen = parts.chosen[0];
    if (follow.attrs !== undefined && chosen !== undefined) Object.assign(changes.of(chosen), follow.attrs);
  }
  return changes.finish(units);
}

/// I campi in cui `node`, un oggetto che segue `look`, si vede diverso dallo
/// stile: quelli che dargli di nuovo lo stile cambierebbe. Un tratteggio del
/// menu che resta lo stesso in spessori su un altro spessore non è una
/// differenza; lo spessore sì.
export function styleDifferences(model: DocumentModel, node: ElementPart, look: StyleLook, measure: Measure): Set<StyleField> {
  const changes = new Changes(new Plan(model, new NewIds(() => false)), model, measure, look.style.resources, look.style.swatches);
  changes.keepRuns = true;
  const parts = partsFrom([node]);
  give(changes, parts, look.style, look.kind, look.fields);
  const { attrs, texts } = changes.dry();
  const byNode = new Map<ElementPart, Part>();
  for (const part of [...parts.chosen, ...parts.fills, ...parts.strokes, ...parts.texts]) byNode.set(part.node, part);
  const out = new Set<StyleField>();
  for (const [at, written] of attrs) {
    const part = byNode.get(at);
    if (part !== undefined) for (const field of fieldsChanged(part, written, look.style)) out.add(field);
  }
  for (const { before, now } of texts) for (const field of textFieldsChanged(before, now)) out.add(field);
  return out;
}

/// I campi che cambiano gli attributi `written` sulla parte `part`, dando
/// `style`.
export function fieldsChanged(part: Part, written: Readonly<Record<string, string | null>>, style: Style): StyleField[] {
  const out: StyleField[] = [];
  const after = (name: string): string => {
    const value = written[name];
    return value === undefined ? seen(part, name) : (value ?? part.inherited.get(name)!);
  };
  for (const name of Object.keys(written)) {
    switch (name) {
      case "fill":
        out.push(INKED.has(part.role) ? "stroke" : "fill");
        break;
      case "stroke":
        out.push("stroke");
        break;
      case "stroke-width":
        out.push("width");
        break;
      case "stroke-dasharray": {
        const before = dashOf(seen(part, name), nonNegativeLength(seen(part, "stroke-width")) ?? 1, capIn(seen(part, "stroke-linecap")));
        const now = dashOf(after(name), nonNegativeLength(after("stroke-width")) ?? 1, capIn(after("stroke-linecap")));
        if (before === null || before !== now) out.push("dashes");
        break;
      }
      case "stroke-linecap":
        out.push("cap");
        break;
      case "stroke-linejoin":
        out.push("join");
        break;
      case "marker-start":
        out.push("tipStart");
        break;
      case "marker-end":
        out.push("tipEnd");
        break;
      case "opacity":
        out.push("opacity");
        break;
      case "style":
        out.push("blend");
        break;
      case "fub:effect":
      case "filter":
        out.push("effects");
        break;
      case "font-family":
        out.push("family");
        break;
      case "font-size":
        out.push("size");
        break;
      case "font-weight":
        out.push("weight");
        break;
      case "font-style":
        out.push("italic");
        break;
      case "letter-spacing":
        out.push("spacing");
        break;
      case "fub:geom": {
        // Una linea a spessore variabile: lo spessore, gli estremi e gli
        // angoli stanno nel suo profilo.
        const v = part.node.details?.varwidth;
        const outline = style.outline;
        if (v === undefined || outline === null) break;
        const width = nonNegativeLength(outline.width);
        if (width !== null && place(width) !== place(profileWidth(v.profile))) out.push("width");
        if ((WIDTH_CAPS as readonly string[]).includes(trim(outline.cap)) && trim(outline.cap) !== v.cap) out.push("cap");
        if ((WIDTH_JOINS as readonly string[]).includes(trim(outline.join)) && trim(outline.join) !== v.join) out.push("join");
        break;
      }
    }
  }
  return out;
}

/// I campi di uno stile di testo in cui `now` si vede diverso da `before`.
export function textFieldsChanged(before: Rich, now: Rich): StyleField[] {
  const out: StyleField[] = [];
  const differ = (name: string, same: Same): boolean => {
    const a = seenValues(before, name);
    const b = seenValues(now, name);
    return !(a.every((x) => b.some((y) => same(x, y))) && b.every((y) => a.some((x) => same(x, y))));
  };
  for (const [field, name] of [["fill", "fill"], ["family", "font-family"], ["size", "font-size"], ["weight", "font-weight"], ["italic", "font-style"]] as const) {
    if (differ(name, SAME[name] ?? sameText)) out.push(field);
  }
  const spacings = (rich: Rich): string => [...new Set(spacingsOf(rich))].sort().join(" ");
  if (spacings(before) !== spacings(now)) out.push("spacing");
  if (emphasisOf(before, "underline") !== emphasisOf(now, "underline")) out.push("underline");
  if (emphasisOf(before, "strike") !== emphasisOf(now, "strike")) out.push("strike");
  const leadings = (rich: Rich): string =>
    rich.lines
      .slice(1)
      .map((_, i) => {
        const value = leadingOf(rich, i + 1);
        return value === null ? "" : String(ratio(value));
      })
      .join(" ");
  if (leadings(before) !== leadings(now)) out.push("leading");
  return out;
}

/// Gli effetti come li scrive `fub:effect`, per confrontarli; `""` senza.
export const effectsText = (effects: readonly Effect[] | null): string | null => (effects === null ? null : effects.length === 0 ? "" : writeEffects(effects));

/// Due punte di uno stile uguali.
export const sameEnd = (a: TipsStyle["start"], b: TipsStyle["start"]): boolean => (a === null || b === null || a === "none" || b === "none" ? a === b : a.shape === b.shape && a.size === b.size);

/// I campi che `to` dice e che `from`, uno stile del disegno di `model`, non
/// dice o dice con un altro valore: ciò che aggiornare lo stile cambia. Una
/// sfumatura privata è la stessa se si vede uguale nel riquadro dello
/// stile. Il colore di un tratto a penna, che è il contorno o il
/// riempimento che si vede, conta come contorno.
export function styleChanges(model: DocumentModel, from: StyleLook, to: StyleLook): Set<StyleField> {
  const copies = new ResourceCopies(model, new NewIds(() => false), elemOf, to.style.resources);
  const fit = (): Matrix | null => (to.style.box === null ? null : boxFit(to.style.box, STYLE_BOX));
  const samePaints = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : samePaint(b, a) || copies.same(b, a, fit, () => STYLE_BOX));
  const a = from.style;
  const b = to.style;
  const same = (field: StyleField): boolean => {
    switch (field) {
      case "fill":
        return samePaints(a.fill, b.fill);
      case "stroke":
        return samePaints(a.stroke, b.stroke);
      case "width":
        return a.outline !== null && b.outline !== null && sameLength(a.outline.width, b.outline.width);
      case "dashes":
        return a.outline !== null && b.outline !== null && sameDashes(a.outline.dashes, b.outline.dashes);
      case "cap":
        return a.outline !== null && b.outline !== null && sameText(a.outline.cap, b.outline.cap);
      case "join":
        return a.outline !== null && b.outline !== null && sameText(a.outline.join, b.outline.join);
      case "tipStart":
        return sameEnd(a.tips?.start ?? null, b.tips?.start ?? null);
      case "tipEnd":
        return sameEnd(a.tips?.end ?? null, b.tips?.end ?? null);
      case "opacity":
        return formatNumber(a.opacity, OPACITY_PLACES) === formatNumber(b.opacity, OPACITY_PLACES);
      case "blend":
        return (a.blend ?? "normal") === (b.blend ?? "normal");
      case "effects":
        return effectsText(a.effects) === effectsText(b.effects);
    }
    const p = a.font;
    const q = b.font;
    if (p === null || q === null) return p === q;
    switch (field) {
      case "family":
        return p.family === q.family;
      case "size":
        return place(p.size) === place(q.size);
      case "weight":
        return weightOf(p.weight) === weightOf(q.weight);
      case "italic":
        return p.style === q.style;
      case "underline":
        return p.underline === q.underline;
      case "strike":
        return p.strike === q.strike;
      case "spacing":
        return ratio(p.spacing) === ratio(q.spacing);
      case "leading":
        return (p.leading === null ? null : ratio(p.leading)) === (q.leading === null ? null : ratio(q.leading));
    }
  };
  const out = new Set<StyleField>();
  for (const field of to.fields) if (!from.fields.has(field) || !same(field)) out.add(field);
  if (to.kind === "graphic" && !samePaints(shown(a.stroke, a.fill), shown(b.stroke, b.fill))) out.add("stroke");
  return out;
}
