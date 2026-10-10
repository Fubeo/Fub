// Gli stili del documento (livello Standard, con la parte «Stili» del
// Personalizzato): stili di testo e stili grafici, aspetti con un nome che
// gli oggetti seguono; e le operazioni che ne fanno uno, lo danno, lo
// aggiornano, tornano allo stile, scollegano, lo rinominano e lo tolgono,
// ciascuna in un passo che si annulla (formato della scena, stili).
//
// - **Uno stile è un prototipo:** un `text` o una `polyline` nella `defs`
//   della radice, con l'aspetto scritto come lo scriverebbe un oggetto. Si
//   legge e si dà col codice di «Copia lo stile» e «Incolla lo stile»
//   (`look.ts`), e dice soltanto ciò che scrive: chi lo segue tiene il
//   resto. L'editor scrive ogni valore che legge, anche quelli di SVG, così
//   che lo stile dica tutto ciò che l'oggetto mostrava.
// - **Seguire uno stile** è `fub:style` sull'oggetto, che porta comunque i
//   suoi attributi: un altro programma vede lo stesso disegno. Un testo,
//   anche l'etichetta di una forma, segue uno stile di testo; una forma, un
//   tracciato, una linea, un tratto a penna, un'immagine o un gruppo uno
//   grafico. Chi segue uno stile che non c'è, o dell'altro tipo, non segue
//   niente, e l'attributo resta.
// - **Un testo che segue uno stile tiene le sue parole:** lo stile scrive il
//   testo, e una parola in grassetto o in un altro colore resta com'è, se il
//   resto del testo non lo è.
// - **Le differenze** non si scrivono nel file: sono i campi che dare di
//   nuovo lo stile cambierebbe (`styleDifferences`).
// - **Aggiornare uno stile** dalla selezione dà a chi lo segue soltanto i
//   campi cambiati, e soltanto a chi non ne aveva una differenza.
// - **Chi non si riscrive** resta com'è e si conta: un oggetto bloccato, o
//   in un livello o in un gruppo bloccato. Togliere uno stile toglie
//   `fub:style` anche da un oggetto bloccato, che a vederlo resta com'è; da
//   uno in un livello o in un gruppo bloccato il motore non lo toglierebbe,
//   e allora lo stile resta.
// - **I nomi** seguono le regole dei campioni, fra gli stili dello stesso
//   tipo: uno stile di testo e uno grafico possono chiamarsi uguali.

import { fubLiveFamily } from "../fonts/faces";
import { formatNumber } from "../number";
import { followedKind, STYLE_GRAPHIC_POINTS } from "../scene/classify";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import type { Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { keyword, nonNegativeLength, paint, paintReference, trim } from "../scene/values";
import { elemOf, nodeOf, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import { boxRegion, filterElem, writeEffects } from "./effects";
import type { Unit } from "./hit";
import { boxFit, followOps, protoOf, STYLE_BOX, styleChanges, styleDifferences, styleSource, textNodesOf, weightText, type Follow, type StyleField, type StyleKind, type StyleLook, type StyleSource } from "./look";
import type { Measure } from "./measure";
import { writtenDashes } from "./outline";
import { homeOf, paintSample, ResourceCopies, resourcesOf } from "./resources";
import { weightOf } from "./rich";
import { freshSwatchName, swatchNameProblem } from "./swatches";

export type { StyleField, StyleKind } from "./look";

/// Uno stile del documento, come lo mostra il pannello.
export interface DocumentStyle {
  readonly id: string;
  /// Il nome com'è scritto.
  readonly name: string;
  readonly kind: StyleKind;
  /// Il prototipo.
  readonly node: LeafNode;
  /// Quanti oggetti lo seguono.
  readonly followers: number;
}

/// Un comando degli stili pronto: le operazioni, e le chiavi della
/// selezione dopo, che resta la stessa.
export interface StyleChange extends Arranged {
  /// Quanti oggetti prendono lo stile, o lo lasciano.
  readonly changed: number;
  /// Quanti restano com'erano perché non si riscrivono: bloccati, o in un
  /// livello o in un gruppo bloccato.
  readonly kept: number;
}

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

/// Le `defs` della radice, dove stanno gli stili.
function rootDefs(model: DocumentModel): ContainerNode[] {
  return elementChildren(model.root).filter((child): child is ContainerNode => child.kind === "container" && child.details?.role === "defs");
}

/// Gli oggetti del disegno che hanno `fub:style`, per id, in ordine di
/// documento: anche quelli che seguono uno stile che non c'è o dell'altro
/// tipo.
function followersById(model: DocumentModel): Map<string, ElementPart[]> {
  const out = new Map<string, ElementPart[]>();
  const visit = (node: ElementPart): void => {
    const id = node.details?.follows;
    if (id !== undefined) {
      const list = out.get(id);
      if (list === undefined) out.set(id, [node]);
      else list.push(node);
    }
    if (node.kind === "container") for (const child of elementChildren(node)) visit(child);
  };
  visit(model.root);
  return out;
}

/// Gli stili del documento, nell'ordine del documento; di due con lo stesso
/// id vale il primo.
export function documentStyles(model: DocumentModel): DocumentStyle[] {
  const followers = followersById(model);
  const out: DocumentStyle[] = [];
  for (const defs of rootDefs(model)) {
    for (const node of elementChildren(defs)) {
      const style = node.details?.style;
      const id = node.facts.id;
      if (node.kind !== "leaf" || style === undefined || id === null || out.some((each) => each.id === id)) continue;
      const count = (followers.get(id) ?? []).filter((each) => followedKind(each.details!.role) === style.kind).length;
      out.push({ id, name: style.name, kind: style.kind, node, followers: count });
    }
  }
  return out;
}

/// Lo stile che segue `node`, fra `styles`; `null` se non ne segue uno, o se
/// segue uno stile che non c'è o dell'altro tipo.
export function followedStyle(node: ElementPart, styles: ReadonlyMap<string, DocumentStyle>): DocumentStyle | null {
  const id = node.details?.follows;
  const style = id === undefined ? undefined : styles.get(id);
  return style !== undefined && style.kind === followedKind(node.details!.role) ? style : null;
}

/// Gli oggetti di `units` che possono seguire uno stile di tipo `kind`, in
/// ordine: per uno grafico gli oggetti scelti che non sono testi, gruppi
/// compresi; per uno di testo i testi che la sezione «Testo» cambia, anche
/// dentro i gruppi scelti, ed etichette comprese.
export function selectionFollowers(model: DocumentModel, units: readonly Unit[], kind: StyleKind): ElementPart[] {
  if (kind === "text") return textNodesOf(model, units);
  return units.map((unit) => nodeOf(model, unit)).filter((node) => node.details !== null && followedKind(node.details.role) === "graphic");
}

/// Vero se un livello, un gruppo o un collegamento bloccato contiene
/// `node`: il motore non vi scrive.
function lockedAbove(node: ElementPart): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at.details?.locked === true) return true;
  return false;
}

/// Vero se `node` non si riscrive: bloccato, o dentro qualcosa di bloccato.
const fixed = (node: ElementPart): boolean => node.details?.locked === true || lockedAbove(node);

/// La riga «Stile» di una sezione del pannello: che cosa seguono gli
/// oggetti della selezione che possono seguire uno stile di un tipo.
export interface StyleRow {
  readonly kind: StyleKind;
  /// Quanti oggetti della selezione possono seguirne uno.
  readonly count: number;
  /// Lo stile che seguono tutti; `null` se nessuno lo segue, o se sono
  /// misti.
  readonly style: DocumentStyle | null;
  /// Vero se qualcuno segue uno stile e qualcuno un altro, o nessuno.
  readonly mixed: boolean;
  /// Quanti oggetti seguono uno stile, uno qualsiasi.
  readonly following: number;
  /// I campi in cui qualcuno è diverso dallo stile che seguono tutti.
  readonly differs: ReadonlySet<StyleField>;
  /// Quanti oggetti, fra quelli che seguono lo stile, ne sono diversi.
  readonly differing: number;
  /// Quanti oggetti non si riscrivono.
  readonly fixed: number;
}

/// La riga «Stile» per gli oggetti di `units` e gli stili di tipo `kind`;
/// `null` se nessuno può seguirne uno.
export function styleRow(model: DocumentModel, units: readonly Unit[], kind: StyleKind, styles: readonly DocumentStyle[], measure: Measure): StyleRow | null {
  const followers = selectionFollowers(model, units, kind);
  if (followers.length === 0) return null;
  const byId = new Map(styles.map((style) => [style.id, style]));
  const followed = followers.map((node) => followedStyle(node, byId));
  const first = followed[0]!;
  const same = followed.every((style) => style === first);
  const differs = new Set<StyleField>();
  let differing = 0;
  const look = same && first !== null ? protoOf(model, first.node) : null;
  if (look !== null) {
    for (const node of followers) {
      const fields = styleDifferences(model, node, look, measure);
      if (fields.size > 0) differing++;
      for (const field of fields) differs.add(field);
    }
  }
  return {
    kind,
    count: followers.length,
    style: same ? first : null,
    mixed: !same,
    following: followed.filter((style) => style !== null).length,
    differs,
    differing,
    fixed: followers.filter(fixed).length,
  };
}

/// Quanti oggetti che seguono `style` ne sono diversi: per l'annuncio di
/// uno stile aggiornato.
export function differingFollowers(model: DocumentModel, style: DocumentStyle, measure: Measure): number {
  const look = protoOf(model, style.node);
  if (look === null) return 0;
  return followersOf(model, style).filter((node) => styleDifferences(model, node, look, measure).size > 0).length;
}

/// Vero se aggiornare `style` dal primo oggetto di `units` che può
/// seguirne uno del suo tipo cambierebbe lo stile.
export function styleUpdatable(model: DocumentModel, units: readonly Unit[], style: DocumentStyle): boolean {
  const old = protoOf(model, style.node);
  const first = selectionFollowers(model, units, style.kind)[0];
  const source = old === null || first === undefined ? null : styleSource(model, first, style.kind);
  return old !== null && source !== null && styleChanges(model, old, source).size > 0;
}

/// L'anteprima di uno stile nel suo menu, come proprietà CSS: per uno di
/// testo «Aa» nei suoi caratteri e nel suo colore, per uno grafico un
/// quadratino col suo riempimento, il suo contorno e la sua opacità. Ciò
/// che lo stile non dice resta quello del menu.
export interface StyleSample {
  /// Il testo dell'anteprima; vuoto, un quadratino.
  readonly text: string;
  readonly css: Readonly<Record<string, string>>;
}

/// Il contorno più spesso di un'anteprima, in pixel: il quadratino è
/// piccolo, e un contorno di dieci punti lo riempirebbe.
const SAMPLE_BORDER = 3;

/// L'anteprima dello stile `style`; `resources` sono le risorse di `model`,
/// e `live` dà la `font-family` con cui il foglio scrive una famiglia.
export function styleSample(model: DocumentModel, style: DocumentStyle, resources: ReadonlyMap<string, LeafNode> = resourcesOf(model), live: (value: string) => string = fubLiveFamily): StyleSample {
  const look = protoOf(model, style.node);
  const css: Record<string, string> = {};
  if (look === null) return { text: style.kind === "text" ? "Aa" : "", css };
  const said = look.fields;
  const fill = said.has("fill") && look.style.fill !== null ? cssPaint(model, look.style.fill, resources) : null;
  if (style.kind === "text") {
    const font = look.style.font!;
    if (fill !== null) css.color = fill.color;
    if (said.has("family") && font.family !== "") css["font-family"] = live(font.family);
    if (said.has("weight")) css["font-weight"] = String(weightOf(font.weight));
    if (said.has("italic") && font.style !== "" && font.style !== "normal") css["font-style"] = font.style;
    const lines = [said.has("underline") && font.underline ? "underline" : null, said.has("strike") && font.strike ? "line-through" : null].filter((line) => line !== null);
    if (lines.length > 0) css["text-decoration-line"] = lines.join(" ");
    return { text: "Aa", css };
  }
  if (fill !== null) css.background = fill.image ?? fill.color;
  const stroke = said.has("stroke") && look.style.stroke !== null ? cssPaint(model, look.style.stroke, resources) : null;
  const width = look.style.outline === null ? null : nonNegativeLength(look.style.outline.width);
  if (stroke !== null && stroke.color !== "transparent" && width !== null && width > 0) {
    const dashed = writtenDashes(look.style.outline!.dashes);
    css["border-width"] = `${Math.min(SAMPLE_BORDER, Math.max(1, Math.round(width / 2)))}px`;
    css["border-style"] = dashed === null || dashed === "none" ? "solid" : "dashed";
    css["border-color"] = stroke.color;
  }
  if (look.style.opacity < 1) css.opacity = formatNumber(look.style.opacity, 3);
  return { text: "", css };
}

/// Un colore come lo disegna CSS: un colore, e per una sfumatura la sua
/// immagine. Un motivo o una campitura si mostrano col loro colore di
/// ripiego; `null` se non ce n'è uno.
function cssPaint(model: DocumentModel, value: string, resources: ReadonlyMap<string, LeafNode>): { readonly color: string; readonly image: string | null } | null {
  const sample = paintSample(model, value, resources);
  if (sample?.kind === "swatch") return { color: sample.color, image: null };
  const reference = paintReference(value);
  const plain = reference === null ? paint(value) : reference.fallback;
  const image = sample?.kind === "gradient" ? sample.image : null;
  if (plain === null) return image === null ? null : { color: "transparent", image };
  return { color: plain === "none" ? "transparent" : `rgb(${plain.join(" ")})`, image };
}

/// Gli oggetti che seguono `style`: quelli del suo tipo.
function followersOf(model: DocumentModel, style: Pick<DocumentStyle, "id" | "kind">, all = followersById(model)): ElementPart[] {
  return (all.get(style.id) ?? []).filter((node) => followedKind(node.details!.role) === style.kind);
}

// ---------------------------------------------------------------------------
// I nomi.
// ---------------------------------------------------------------------------

/// Uno stile per i suoi nomi: il suo id, il nome e il tipo.
export type NamedStyle = Pick<DocumentStyle, "id" | "name" | "kind">;

/// Il problema del nome `name`, già pulito, per uno stile di tipo `kind`:
/// come per un campione, vuoto, un colore o di un altro stile dello stesso
/// tipo. `except` è lo stile che si rinomina.
export function styleNameProblem(styles: readonly NamedStyle[], kind: StyleKind, name: string, except: string | null = null): "empty" | "color" | "taken" | null {
  return swatchNameProblem(
    styles.filter((style) => style.kind === kind),
    name,
    except,
  );
}

/// Il primo nome libero `base 1`, `base 2` e così via per uno stile nuovo
/// di tipo `kind`: «Stile grafico 1». `base` è un nome breve dell'editor.
export function freshStyleName(styles: readonly NamedStyle[], kind: StyleKind, base: string): string {
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (styleNameProblem(styles, kind, name) === null) return name;
  }
}

/// Il nome di uno stile di tipo `kind` che arriva con gli appunti, non
/// vuoto e già pulito: lui se è libero, se no `name 2`, `name 3` e così
/// via, come per un campione.
export function arrivingStyleName(styles: readonly NamedStyle[], kind: StyleKind, name: string): string {
  return freshSwatchName(
    styles.filter((style) => style.kind === kind),
    name,
  );
}

// ---------------------------------------------------------------------------
// Il prototipo.
// ---------------------------------------------------------------------------

/// Gli attributi del prototipo che dicono i campi `fields` di `source`, e le
/// risorse da aggiungere prima: le copie delle risorse private, adattate al
/// riquadro dello stile, in `copies`, e il filtro degli effetti in `adds`.
/// `null` toglie un attributo: l'opacità piena, la fusione normale, nessun
/// effetto, che lo stile dice anche senza. Torna anche i campi che si sono
/// scritti: un colore la cui copia non si sa scrivere non si dice.
function protoAttrs(source: StyleSource, fields: ReadonlySet<StyleField>, copies: ResourceCopies, ids: NewIds): { readonly attrs: Record<string, string | null>; readonly adds: Elem[]; readonly fields: Set<StyleField> } {
  const style = source.style;
  const attrs: Record<string, string | null> = {};
  const adds: Elem[] = [];
  const written = new Set<StyleField>();
  const owner = {};
  const fit = () => (style.box === null ? null : boxFit(style.box, STYLE_BOX));
  const paint = (field: "fill" | "stroke", value: string | null): void => {
    if (!fields.has(field) || value === null) return;
    const copy = copies.paint(value, owner, fit);
    if (copy === null) return;
    attrs[field] = copy;
    written.add(field);
  };
  const put = (field: StyleField, name: string, value: string | null): void => {
    if (!fields.has(field)) return;
    attrs[name] = value;
    written.add(field);
  };
  paint("fill", style.fill);
  if (source.kind === "text") {
    const font = style.font!;
    if (font.family !== "") put("family", "font-family", font.family);
    put("size", "font-size", formatNumber(font.size, 2));
    put("weight", "font-weight", weightText(weightOf(font.weight)));
    put("italic", "font-style", font.style === "" ? "normal" : font.style);
    put("spacing", "letter-spacing", font.spacing === 0 ? "0" : formatNumber(font.spacing * font.size, 2));
    if (fields.has("underline") || fields.has("strike")) {
      const lines = [font.underline ? "underline" : null, font.strike ? "line-through" : null].filter((line) => line !== null);
      attrs["text-decoration"] = lines.length === 0 ? "none" : lines.join(" ");
      for (const field of ["underline", "strike"] as const) if (fields.has(field)) written.add(field);
    }
    if (font.leading !== null) put("leading", "fub:leading", formatNumber(Math.min(10, Math.max(0.5, font.leading)), 3));
    return { attrs, adds, fields: written };
  }
  paint("stroke", style.stroke);
  const outline = style.outline;
  if (outline !== null) {
    const width = nonNegativeLength(outline.width);
    if (width !== null) put("width", "stroke-width", formatNumber(width, 2));
    put("dashes", "stroke-dasharray", writtenDashes(outline.dashes) ?? "none");
    if (keyword("stroke-linecap", outline.cap)) put("cap", "stroke-linecap", trim(outline.cap));
    if (keyword("stroke-linejoin", outline.join)) put("join", "stroke-linejoin", trim(outline.join));
  }
  if (source.markers.start !== null) put("tipStart", "marker-start", source.markers.start);
  if (source.markers.end !== null) put("tipEnd", "marker-end", source.markers.end);
  const opacity = formatNumber(style.opacity, 4);
  put("opacity", "opacity", opacity === "1" ? null : opacity);
  put("blend", "style", style.blend === null || style.blend === "normal" ? null : `mix-blend-mode: ${style.blend}`);
  const effects = style.effects;
  if (fields.has("effects") && effects !== null) {
    written.add("effects");
    attrs["fub:effect"] = effects.length === 0 ? null : writeEffects(effects);
    attrs.filter = null;
    if (effects.some((effect) => !effect.hidden)) {
      const id = ids.next("resource");
      adds.push(filterElem(id, effects, boxRegion(STYLE_BOX, effects)));
      attrs.filter = `url(#${id})`;
    }
  }
  return { attrs, adds, fields: written };
}

/// Gli attributi `attrs` senza quelli che si tolgono, per un elemento nuovo.
function present(attrs: Readonly<Record<string, string | null>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) if (value !== null) out[name] = value;
  return out;
}

/// `look` coi campi `fields` soltanto.
const narrowed = <T extends StyleLook>(look: T, fields: ReadonlySet<StyleField>): T => ({ ...look, fields });

// ---------------------------------------------------------------------------
// Scrivere.
// ---------------------------------------------------------------------------

/// Un corpo e un peso che prendono il posto di quelli dell'oggetto: uno
/// stile del testo di serie, come «Titolo».
export interface Preset {
  readonly size: number;
  readonly weight: number;
}

/// Le operazioni che fanno lo stile `name`, già pulito e libero, di tipo
/// `kind`, dall'aspetto del primo oggetto di `units` che ne può seguire
/// uno, col corpo e il peso di `preset` se c'è; e che lo fanno seguire a
/// ogni oggetto di `units` che può, che ne prende l'aspetto. Le risorse
/// private dell'oggetto passano allo stile in copia, e una sfumatura dal
/// suo riquadro a quello dello stile. `null` se nessun oggetto ne ha uno.
export function newStyleOps(
  model: DocumentModel,
  units: readonly Unit[],
  kind: StyleKind,
  name: string,
  measure: Measure,
  ids: NewIds,
  preset: Preset | null = null,
): (StyleChange & { readonly id: string }) | null {
  const followers = selectionFollowers(model, units, kind);
  const read = followers.length === 0 ? null : styleSource(model, followers[0]!, kind);
  if (read === null) return null;
  const source: StyleSource = preset === null || read.style.font === null ? read : { ...read, style: { ...read.style, font: { ...read.style.font, size: preset.size, weight: weightText(preset.weight) } } };
  const id = ids.next("resource");
  const home = homeOf(model);
  const copies = new ResourceCopies(model, ids, elemOf, source.style.resources);
  const proto = protoAttrs(source, source.fields, copies, ids);
  const elem: Elem = {
    tag: kind === "text" ? "text" : "polyline",
    attrs: { id, "fub:role": "style", "fub:name": name, ...(kind === "graphic" ? { points: STYLE_GRAPHIC_POINTS } : {}), ...present(proto.attrs) },
  };
  const before: Op[] = [
    ...home.prelude,
    ...copies.ops(false),
    ...proto.adds.map((add): Op => ({ op: "add", parent: home.parent, pos: { last: true }, elem: add })),
    { op: "add", parent: home.parent, pos: { last: true }, elem },
  ];
  const free = followers.filter((node) => !fixed(node));
  const follows = free.map((node): Follow => ({ node, fields: null, attrs: { "fub:style": id } }));
  const done = followOps(model, units, narrowed(source, proto.fields), follows, before, measure, ids);
  return { ops: done.ops, keys: done.keys, changed: free.length, kept: followers.length - free.length, id };
}

/// Le operazioni che danno lo stile `style` agli oggetti di `units` che
/// possono seguirne uno del suo tipo: tutto lo stile, e `fub:style`. Un
/// testo tiene le parole che hanno un altro valore del resto.
export function applyStyleOps(model: DocumentModel, units: readonly Unit[], style: DocumentStyle, measure: Measure, ids: NewIds): StyleChange {
  const followers = selectionFollowers(model, units, style.kind);
  const look = protoOf(model, style.node);
  const free = look === null ? [] : followers.filter((node) => !fixed(node));
  const follows = free.map((node): Follow => ({ node, fields: null, attrs: { "fub:style": style.id } }));
  const done = look === null ? { ops: [], keys: units.map((unit) => unit.key) } : followOps(model, units, look, follows, [], measure, ids);
  return { ops: done.ops, keys: done.keys, changed: free.length, kept: followers.length - free.length };
}

/// Le operazioni che ridanno lo stile `style`, intero, agli oggetti di
/// `units` che lo seguono: le differenze se ne vanno.
export function revertStyleOps(model: DocumentModel, units: readonly Unit[], style: DocumentStyle, measure: Measure, ids: NewIds): StyleChange {
  const byId = new Map([[style.id, style]]);
  const followers = selectionFollowers(model, units, style.kind).filter((node) => followedStyle(node, byId) === style);
  const look = protoOf(model, style.node);
  const free = look === null ? [] : followers.filter((node) => !fixed(node));
  const done = look === null ? { ops: [], keys: units.map((unit) => unit.key) } : followOps(model, units, look, free.map((node): Follow => ({ node, fields: null })), [], measure, ids);
  return { ops: done.ops, keys: done.keys, changed: free.length, kept: followers.length - free.length };
}

/// Le operazioni che ridefiniscono lo stile `style` dall'aspetto del primo
/// oggetto di `units` che può seguirne uno del suo tipo: il prototipo
/// prende i campi cambiati, e ogni oggetto che lo segue li prende, ciascuno
/// soltanto se ne aveva il valore di prima. `null` se nessun oggetto ne ha
/// uno; nessuna operazione se lo stile è già così.
export function updateStyleOps(model: DocumentModel, units: readonly Unit[], style: DocumentStyle, measure: Measure, ids: NewIds): StyleChange | null {
  const old = protoOf(model, style.node);
  const first = selectionFollowers(model, units, style.kind)[0];
  const source = old === null || first === undefined ? null : styleSource(model, first, style.kind);
  if (old === null || source === null) return null;
  const changed = styleChanges(model, old, source);
  const keys = units.map((unit) => nodeOf(model, unit).facts.id ?? unit.key);
  if (changed.size === 0) return { ops: [], keys, changed: 0, kept: 0 };
  const copies = new ResourceCopies(model, ids, elemOf, source.style.resources);
  const proto = protoAttrs(source, changed, copies, ids);
  const home = homeOf(model);
  const copied = copies.ops(false);
  const before: Op[] = [
    ...(copied.length > 0 || proto.adds.length > 0 ? home.prelude : []),
    ...copied,
    ...proto.adds.map((add): Op => ({ op: "add", parent: home.parent, pos: { last: true }, elem: add })),
    { op: "set", id: style.id, attrs: proto.attrs },
  ];
  const followers = followersOf(model, style);
  const free = followers.filter((node) => !fixed(node));
  const follows: Follow[] = [];
  for (const node of free) {
    const differs = styleDifferences(model, node, old, measure);
    const fields = new Set([...proto.fields].filter((field) => !differs.has(field)));
    if (fields.size > 0) follows.push({ node, fields });
  }
  const done = followOps(model, units, narrowed(source, proto.fields), follows, before, measure, ids);
  return { ops: done.ops, keys: done.keys, changed: follows.length, kept: followers.length - free.length };
}

/// Le operazioni che tolgono `fub:style` agli oggetti di `units` che
/// seguono uno stile di tipo `kind`: tengono il loro aspetto.
export function unlinkStyleOps(model: DocumentModel, units: readonly Unit[], kind: StyleKind, styles: readonly DocumentStyle[], ids: NewIds): StyleChange {
  const byId = new Map(styles.map((style) => [style.id, style]));
  const followers = selectionFollowers(model, units, kind).filter((node) => followedStyle(node, byId) !== null);
  const plan = new Plan(model, ids);
  const free = followers.filter((node) => !fixed(node));
  for (const node of free) plan.ops.push({ op: "set", id: plan.idOf(node), attrs: { "fub:style": null } });
  return { ...plan.finish(units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key))), changed: free.length, kept: followers.length - free.length };
}

/// Le operazioni che danno allo stile `id` il nome `name`, già pulito e
/// libero; nessuna se è lo stesso.
export function renameStyleOps(model: DocumentModel, style: DocumentStyle, name: string, units: readonly Unit[], ids: NewIds): StyleChange {
  const plan = new Plan(model, ids);
  if (style.name !== name) plan.ops.push({ op: "set", id: style.id, attrs: { "fub:name": name } });
  return { ...plan.finish(units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key))), changed: 0, kept: 0 };
}

/// Perché lo stile `style` non si può togliere: un oggetto che lo segue sta
/// in un livello o in un gruppo bloccato, e `fub:style` lì non si toglie.
/// `null` se si può.
export function deleteStyleProblem(model: DocumentModel, style: DocumentStyle): "locked" | null {
  return (followersById(model).get(style.id) ?? []).some(lockedAbove) ? "locked" : null;
}

/// Le operazioni che tolgono lo stile `style`, in un passo: prima
/// `fub:style` da chi lo segue, che tiene il suo aspetto, anche bloccato, e
/// da chi lo nomina senza poterlo seguire; poi lo stile, e con lui le sue
/// risorse private. `changed` dice quanti lo seguivano. `null` se un oggetto
/// che lo segue sta in un livello o in un gruppo bloccato.
export function deleteStyleOps(model: DocumentModel, style: DocumentStyle, units: readonly Unit[], ids: NewIds): StyleChange | null {
  const all = followersById(model);
  const naming = all.get(style.id) ?? [];
  if (naming.some(lockedAbove)) return null;
  const plan = new Plan(model, ids);
  for (const node of naming) plan.ops.push({ op: "set", id: plan.idOf(node), attrs: { "fub:style": null } });
  plan.ops.push({ op: "remove", target: style.id });
  return { ...plan.finish(units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key))), changed: followersOf(model, style, all).length, kept: 0 };
}
