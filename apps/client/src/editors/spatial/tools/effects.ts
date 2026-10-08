// Gli effetti degli oggetti (livello Esperto): le ombre, i bagliori e la
// sfocatura, come li scrive il formato della scena, come se ne calcola la
// regione, e le operazioni che li danno, li cambiano e li tolgono (formato
// della scena, effetti).
//
// - **L'oggetto dice i suoi effetti** in `fub:effect`, in ordine, anche
//   quelli nascosti: «shadow 0 4 8 #000000 0.25; blur 4 hidden». Il filtro
//   che li disegna ne discende, come il `d` di una forma da `fub:geom`: un
//   `filter` privato, suo soltanto, fatto di primitive di SVG 1.1, a cui
//   l'oggetto rimanda con `filter`. Con gli effetti tutti nascosti il filtro
//   non c'è, e l'oggetto non costa niente a chi lo disegna o lo esporta.
// - **Sono di FubDraw** soltanto gli effetti il cui filtro è, primitiva per
//   primitiva, quello che FubDraw scriverebbe per `fub:effect`, in qualunque
//   regione. Ogni altro filtro è di un altro programma: si vede, si conserva,
//   si toglie, e un effetto nuovo lo sostituisce.
// - **Le misure sono quelle di Figma e di CSS.** La sfocatura di un'ombra o
//   di un bagliore, e quella dell'oggetto, valgono il doppio della
//   deviazione standard: «Sfocatura 8» è il `blur 8px` di un'ombra di CSS.
//   Gli effetti si calcolano in sRGB, come le ombre di CSS e di Figma, nelle
//   coordinate dell'oggetto: si girano e si scalano con il suo `transform`.
// - **L'ordine del disegno è fisso:** sotto le ombre e i bagliori esterni,
//   nell'ordine della lista; poi l'oggetto; sopra le ombre e i bagliori
//   interni, ritagliati dalla sua forma; e la sfocatura, se c'è, su tutto.
// - **La regione segue l'oggetto** ([`followEffects`]): è il riquadro di ciò
//   che l'oggetto disegna, contorno, punte e testo misurato compresi,
//   allargato di quanto arrivano gli effetti, a tre deviazioni standard, e
//   portato ai centesimi per eccesso. Dopo ogni operazione il motore chiede
//   quali regioni non vanno più, e la risposta entra nello stesso passo e
//   nello stesso annulla. Il file resta lo stesso, comunque ci si arrivi.
// - **Chi può averli.** Forme, testi, immagini, gruppi e collegamenti; non i
//   livelli, la carta e le tavole. Un oggetto con un ritaglio o una maschera
//   no: SVG ritaglia dopo il filtro, e l'ombra sparirebbe. Nemmeno un gruppo
//   con parti di un altro programma, di cui non si sa la misura.

import { formatNumber } from "../number";
import { BoundsBuilder, type Bounds } from "../scene/geometry";
import { apply, IDENTITY, type Matrix } from "../scene/matrix";
import { elementChildren, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import type { Elem, Run } from "../scene/serialize";
import { length, nonNegativeLength, number, opacity as parseOpacity, reference, transform as parseTransform, trim } from "../scene/values";
import { elemOf, fubAttributes, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { transformedBounds } from "./clips";
import { gesture, type NewIds } from "./edit";
import { shapeSegments, type Unit } from "./hit";
import type { Font, Measure } from "./measure";
import { homeOf, resourcesOf, usersOf, type Home } from "./resources";

// ---------------------------------------------------------------------------
// Gli effetti.
// ---------------------------------------------------------------------------

/// I generi di effetto, nell'ordine del menu «Aggiungi effetto».
export type EffectKind = "shadow" | "inner-shadow" | "glow" | "inner-glow" | "blur";

export const EFFECT_KINDS: readonly EffectKind[] = ["shadow", "inner-shadow", "glow", "inner-glow", "blur"];

/// Un'ombra, esterna o interna: lo scostamento, la sfocatura, il colore
/// `#rrggbb` e la sua opacità.
export interface Shadow {
  readonly kind: "shadow" | "inner-shadow";
  readonly dx: number;
  readonly dy: number;
  readonly blur: number;
  readonly color: string;
  readonly opacity: number;
  readonly hidden: boolean;
}

/// Un bagliore, esterno o interno: quanto è largo, il colore e l'opacità.
export interface Glow {
  readonly kind: "glow" | "inner-glow";
  readonly size: number;
  readonly color: string;
  readonly opacity: number;
  readonly hidden: boolean;
}

/// La sfocatura dell'oggetto.
export interface Blur {
  readonly kind: "blur";
  readonly radius: number;
  readonly hidden: boolean;
}

export type Effect = Shadow | Glow | Blur;

/// Vero se `effect` è un'ombra, esterna o interna.
export const isShadow = (effect: Effect): effect is Shadow => effect.kind === "shadow" || effect.kind === "inner-shadow";

/// Vero se `effect` è un bagliore, esterno o interno.
export const isGlow = (effect: Effect): effect is Glow => effect.kind === "glow" || effect.kind === "inner-glow";

/// Quanti effetti un oggetto porta al più: tutti ombre interne, e il filtro
/// resta nelle 64 primitive del formato.
export const MAX_EFFECTS = 8;

/// La sfocatura e la larghezza più grandi, e lo scostamento più lungo, in
/// unità dell'oggetto.
export const MAX_SPREAD = 500;
export const MAX_OFFSET = 2000;

/// Gli effetti nuovi, come li aggiunge il menu.
export function defaultEffect(kind: EffectKind): Effect {
  switch (kind) {
    case "shadow":
      return { kind, dx: 0, dy: 4, blur: 8, color: "#000000", opacity: 0.25, hidden: false };
    case "inner-shadow":
      return { kind, dx: 0, dy: 2, blur: 4, color: "#000000", opacity: 0.25, hidden: false };
    case "glow":
      return { kind, size: 8, color: "#ffd400", opacity: 0.75, hidden: false };
    case "inner-glow":
      return { kind, size: 6, color: "#ffffff", opacity: 0.75, hidden: false };
    case "blur":
      return { kind, radius: 4, hidden: false };
  }
}

/// Un numero della geometria, come lo scrive il file.
const place = (value: number): string => formatNumber(value, 2);

/// Un'opacità come la scrive il file: al più quattro decimali.
const alpha = (value: number): string => formatNumber(value, 4);

/// La deviazione standard di una sfocatura: la metà, a tre decimali, che
/// tengono esatta la metà di un numero a due.
const deviation = (amount: number): string => formatNumber(amount / 2, 3);

const HEX = /^#[0-9a-f]{6}$/;

/// Un numero di `fub:effect`: un numero SVG fra `lo` e `hi`, già a due
/// decimali; `null` altrimenti.
function amount(token: string | undefined, lo: number, hi: number): number | null {
  const value = token === undefined ? null : number(token);
  if (value === null || value < lo || value > hi) return null;
  return Number(place(value)) === value ? value : null;
}

/// Un'opacità di `fub:effect`: fra 0 e 1, a quattro decimali.
function opacityToken(token: string | undefined): number | null {
  const value = token === undefined ? null : parseOpacity(token);
  return value !== null && Number(alpha(value)) === value ? value : null;
}

/// Un effetto di `fub:effect`, già diviso in parole; `null` se non si legge.
function readEffect(words: readonly string[]): Effect | null {
  const hidden = words[words.length - 1] === "hidden";
  const body = hidden ? words.slice(0, -1) : words;
  const [kind, ...rest] = body;
  switch (kind) {
    case "shadow":
    case "inner-shadow": {
      if (rest.length !== 5) return null;
      const dx = amount(rest[0], -MAX_OFFSET, MAX_OFFSET);
      const dy = amount(rest[1], -MAX_OFFSET, MAX_OFFSET);
      const blur = amount(rest[2], 0, MAX_SPREAD);
      const color = rest[3]!;
      const opacity = opacityToken(rest[4]);
      if (dx === null || dy === null || blur === null || !HEX.test(color) || opacity === null) return null;
      return { kind, dx, dy, blur, color, opacity, hidden };
    }
    case "glow":
    case "inner-glow": {
      if (rest.length !== 3) return null;
      const size = amount(rest[0], 0, MAX_SPREAD);
      const color = rest[1]!;
      const opacity = opacityToken(rest[2]);
      if (size === null || !HEX.test(color) || opacity === null) return null;
      return { kind, size, color, opacity, hidden };
    }
    case "blur": {
      if (rest.length !== 1) return null;
      const radius = amount(rest[0], 0, MAX_SPREAD);
      return radius === null ? null : { kind, radius, hidden };
    }
    default:
      return null;
  }
}

/// Gli effetti di `fub:effect`, in ordine; `null` se il valore non si legge,
/// se ne ha più di [`MAX_EFFECTS`] o più di una sfocatura. Un valore vuoto è
/// una lista vuota.
export function parseEffects(text: string): readonly Effect[] | null {
  const items = text.split(";").map(trim);
  if (items.length === 1 && items[0] === "") return [];
  const out: Effect[] = [];
  for (const item of items) {
    const effect = readEffect(item.split(/[ \t\n\r\f]+/));
    if (effect === null) return null;
    out.push(effect);
  }
  if (out.length > MAX_EFFECTS || out.filter((effect) => effect.kind === "blur").length > 1) return null;
  return out;
}

/// `effects` come li scrive `fub:effect`.
export function writeEffects(effects: readonly Effect[]): string {
  return effects
    .map((effect) => {
      const words: string[] = [effect.kind];
      if (isShadow(effect)) words.push(place(effect.dx), place(effect.dy), place(effect.blur), effect.color, alpha(effect.opacity));
      else if (isGlow(effect)) words.push(place(effect.size), effect.color, alpha(effect.opacity));
      else words.push(place(effect.radius));
      if (effect.hidden) words.push("hidden");
      return words.join(" ");
    })
    .join("; ");
}

/// Vero se `effect` si disegna sotto l'oggetto.
const outer = (effect: Effect): effect is Shadow | Glow => effect.kind === "shadow" || effect.kind === "glow";

/// Vero se `effect` si disegna sopra l'oggetto, dentro la sua forma.
const inner = (effect: Effect): effect is Shadow | Glow => effect.kind === "inner-shadow" || effect.kind === "inner-glow";

/// Lo scostamento e la sfocatura di un'ombra o di un bagliore.
function offsetOf(effect: Shadow | Glow): { readonly dx: number; readonly dy: number; readonly blur: number } {
  return isShadow(effect) ? effect : { dx: 0, dy: 0, blur: effect.size };
}

// ---------------------------------------------------------------------------
// Il filtro.
// ---------------------------------------------------------------------------

/// L'alfa capovolto: dentro la forma niente, fuori tutto, fino al bordo
/// della regione.
const INVERTED = "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 1";

/// Le primitive che disegnano `effect`, l'`n`-esimo degli effetti visibili,
/// col risultato `e<n>`. Una sfocatura di zero e uno scostamento di zero non
/// si scrivono: `stdDeviation="0"` non vale allo stesso modo per tutti.
function effectPrimitives(effect: Shadow | Glow, n: number): Elem[] {
  const { dx, dy, blur } = offsetOf(effect);
  const out: Elem[] = [];
  const within = inner(effect);
  // La forma da cui nasce: l'alfa dell'oggetto, o il suo capovolto.
  let from = "SourceAlpha";
  if (within) {
    out.push({ tag: "feColorMatrix", attrs: { in: "SourceAlpha", values: INVERTED, result: `a${n}` } });
    from = `a${n}`;
  }
  if (blur > 0) {
    out.push({ tag: "feGaussianBlur", attrs: { in: from, stdDeviation: deviation(blur), result: `b${n}` } });
    from = `b${n}`;
  }
  if (dx !== 0 || dy !== 0) {
    out.push({ tag: "feOffset", attrs: { in: from, dx: place(dx), dy: place(dy), result: `o${n}` } });
    from = `o${n}`;
  }
  out.push({ tag: "feFlood", attrs: { "flood-color": effect.color, "flood-opacity": alpha(effect.opacity) } });
  if (within) {
    out.push({ tag: "feComposite", attrs: { in2: from, operator: "in" } });
    out.push({ tag: "feComposite", attrs: { in2: "SourceAlpha", operator: "in", result: `e${n}` } });
  } else {
    out.push({ tag: "feComposite", attrs: { in2: from, operator: "in", result: `e${n}` } });
  }
  return out;
}

/// Le primitive degli effetti visibili di `effects`; `[]` se non ce n'è.
export function primitives(effects: readonly Effect[]): Elem[] {
  const shown = effects.filter((effect) => !effect.hidden);
  if (shown.length === 0) return [];
  const out: Elem[] = [];
  const below: string[] = [];
  const above: string[] = [];
  let n = 0;
  for (const effect of shown) {
    if (effect.kind === "blur") continue;
    n++;
    out.push(...effectPrimitives(effect, n));
    (outer(effect) ? below : above).push(`e${n}`);
  }
  const blur = shown.find((effect): effect is Blur => effect.kind === "blur");
  if (below.length > 0 || above.length > 0) {
    const nodes = [...below, "SourceGraphic", ...above].map((input): Elem => ({ tag: "feMergeNode", attrs: { in: input } }));
    out.push({ tag: "feMerge", attrs: {}, children: nodes });
    if (blur !== undefined && blur.radius > 0) out.push({ tag: "feGaussianBlur", attrs: { stdDeviation: deviation(blur.radius) } });
  } else {
    // Soltanto la sfocatura; di zero, l'oggetto com'è.
    out.push(blur!.radius > 0 ? { tag: "feGaussianBlur", attrs: { in: "SourceGraphic", stdDeviation: deviation(blur!.radius) } } : { tag: "feOffset", attrs: { in: "SourceGraphic" } });
  }
  return out;
}

/// La regione di un filtro come la scrive il file.
export interface RegionWrite {
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
}

/// `region` ai centesimi, per eccesso: la regione scritta contiene sempre
/// quella calcolata.
export function writeRegion(region: Bounds): RegionWrite {
  const down = (value: number): number => Math.floor(value * 100 + 1e-6) / 100;
  const up = (value: number): number => Math.ceil(value * 100 - 1e-6) / 100;
  const x = down(region.min[0]);
  const y = down(region.min[1]);
  return { x: place(x), y: place(y), width: place(up(region.max[0]) - x), height: place(up(region.max[1]) - y) };
}

/// Il filtro privato `id` che disegna `effects`, con la regione `region`.
/// Almeno un effetto è visibile.
export function filterElem(id: string, effects: readonly Effect[], region: RegionWrite): Elem {
  return {
    tag: "filter",
    attrs: { id, "fub:role": "private", ...region, filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" },
    children: primitives(effects),
  };
}

/// Vero se `a` e `b` sono lo stesso elemento: stesso tag, stessi attributi
/// in qualunque ordine, stessi figli.
export function sameElem(a: Elem, b: Elem): boolean {
  if (a.tag !== b.tag || (a.text ?? null) !== (b.text ?? null)) return false;
  const names = Object.keys(a.attrs);
  if (names.length !== Object.keys(b.attrs).length || names.some((name) => a.attrs[name] !== b.attrs[name])) return false;
  const inside = a.children ?? [];
  const other = b.children ?? [];
  return inside.length === other.length && inside.every((child, at) => sameElem(child, other[at]!));
}

/// Gli attributi che cambiano da `from` a `to`, due elementi con la stessa
/// forma (stessi tag, stessi figli, alla stessa profondità): per ogni parte
/// che cambia, il suo percorso fra i figli e gli attributi nuovi. `null` se
/// la forma è diversa.
export function elemChanges(from: Elem, to: Elem, at: readonly number[] = []): Array<{ readonly part: readonly number[]; readonly attrs: Record<string, string | null> }> | null {
  if (from.tag !== to.tag) return null;
  const inside = from.children ?? [];
  const other = to.children ?? [];
  if (inside.length !== other.length) return null;
  const attrs: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(to.attrs)) if (from.attrs[name] !== value) attrs[name] = value;
  for (const name of Object.keys(from.attrs)) if (to.attrs[name] === undefined) attrs[name] = null;
  const out = Object.keys(attrs).length > 0 ? [{ part: at, attrs }] : [];
  for (let i = 0; i < inside.length; i++) {
    const below = elemChanges(inside[i]!, other[i]!, [...at, i]);
    if (below === null) return null;
    out.push(...below);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quanto arrivano.
// ---------------------------------------------------------------------------

/// Quanto qualcosa arriva oltre il riquadro dell'oggetto, lato per lato.
export interface Reach {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const NO_REACH: Reach = { left: 0, top: 0, right: 0, bottom: 0 };

/// Quanto arriva una sfocatura: tre deviazioni standard.
const spread = (blur: number): number => 1.5 * blur;

/// Quanto `effects`, quelli visibili, dipingono oltre il riquadro
/// dell'oggetto: le ombre e i bagliori esterni, e la sfocatura su tutto. È
/// ciò che si vede, e che l'export di una selezione deve contenere.
export function visibleReach(effects: readonly Effect[]): Reach {
  let { left, top, right, bottom } = NO_REACH;
  for (const effect of effects) {
    if (effect.hidden || !outer(effect)) continue;
    const { dx, dy, blur } = offsetOf(effect);
    const by = spread(blur);
    left = Math.max(left, by - dx);
    right = Math.max(right, by + dx);
    top = Math.max(top, by - dy);
    bottom = Math.max(bottom, by + dy);
  }
  const blur = effects.find((effect): effect is Blur => effect.kind === "blur" && !effect.hidden);
  const by = blur === undefined ? 0 : spread(blur.radius);
  return { left: left + by, top: top + by, right: right + by, bottom: bottom + by };
}

/// Quanto la regione del filtro di `effects` deve stare oltre il riquadro
/// dell'oggetto. Un effetto interno non dipinge fuori, ma legge fuori: il
/// suo alfa capovolto vale uno fino al bordo della regione, che dunque sta
/// oltre lo scostamento e la sfocatura.
export function regionReach(effects: readonly Effect[]): Reach {
  const seen = visibleReach(effects);
  let reach = 0;
  for (const effect of effects) {
    if (effect.hidden || !inner(effect)) continue;
    const { dx, dy, blur } = offsetOf(effect);
    reach = Math.max(reach, Math.abs(dx) + spread(blur), Math.abs(dy) + spread(blur));
  }
  return { left: Math.max(seen.left, reach), top: Math.max(seen.top, reach), right: Math.max(seen.right, reach), bottom: Math.max(seen.bottom, reach) };
}

/// `box` allargato di `reach`.
export function grown(box: Bounds, reach: Reach): Bounds {
  return { min: [box.min[0] - reach.left, box.min[1] - reach.top], max: [box.max[0] + reach.right, box.max[1] + reach.bottom] };
}

/// Il margine della regione oltre ciò che serve: il bordo sfumato di chi
/// disegna, e un contorno che si stima per difetto, non vi si tagliano.
const REGION_MARGIN = 2;

// ---------------------------------------------------------------------------
// Il riquadro di ciò che un oggetto disegna.
// ---------------------------------------------------------------------------

/// Ciò che un elemento eredita di ciò che conta per il suo riquadro.
interface Inherited {
  readonly stroke: boolean;
  readonly strokeWidth: number;
  readonly miter: boolean;
  readonly font: Font;
  readonly anchor: string;
}

const START: Inherited = {
  stroke: false,
  strokeWidth: 1,
  miter: true,
  font: { family: "sans-serif", size: 16, weight: "normal", style: "normal", spacing: 0 },
  anchor: "start",
};

/// Ciò che `own` passa, sopra `from`.
function inherit(from: Inherited, own: ReadonlyMap<string, string> | Readonly<Record<string, string>>): Inherited {
  const get = (name: string): string | undefined => (own instanceof Map ? own.get(name) : (own as Readonly<Record<string, string>>)[name]);
  const stroke = get("stroke");
  const width = get("stroke-width");
  const join = get("stroke-linejoin");
  const size = get("font-size");
  const spacing = get("letter-spacing");
  const family = get("font-family");
  const weight = get("font-weight");
  const style = get("font-style");
  const anchor = get("text-anchor");
  const fontSize = size === undefined ? from.font.size : (nonNegativeLength(size) ?? from.font.size);
  return {
    stroke: stroke === undefined ? from.stroke : trim(stroke) !== "none",
    strokeWidth: width === undefined ? from.strokeWidth : (nonNegativeLength(width) ?? from.strokeWidth),
    miter: join === undefined ? from.miter : trim(join) === "miter",
    font: {
      family: family ?? from.font.family,
      size: fontSize,
      weight: weight ?? from.font.weight,
      style: style ?? from.font.style,
      spacing: spacing === undefined ? from.font.spacing : trim(spacing) === "normal" ? 0 : (length(spacing) ?? from.font.spacing),
    },
    anchor: anchor === undefined ? from.anchor : trim(anchor),
  };
}

/// Ciò che `node` eredita da chi lo contiene.
function inheritedBy(node: ElementPart): Inherited {
  const chain: ElementPart[] = [];
  for (let at = node.parent; at !== null; at = at.parent) chain.push(at);
  let out = START;
  for (let i = chain.length - 1; i >= 0; i--) out = inherit(out, plainAttributes(chain[i]!));
  return out;
}

/// Quanto un contorno arriva oltre la geometria: mezzo spessore, gli angoli
/// netti fino al limite di 4 di SVG, gli estremi quadrati in diagonale.
function strokeReach(style: Inherited): number {
  if (!style.stroke) return 0;
  return style.strokeWidth * (style.miter ? 2 : Math.SQRT1_2);
}

/// Il riquadro di una riga di testo larga `width` con la linea di base in
/// `y`, scritta da `x` con l'allineamento `anchor` e il corpo `size`: con
/// mezzo corpo ai lati per le lettere che sporgono, gli accenti sopra e le
/// discendenti sotto.
function lineBox(out: BoundsBuilder, x: number, y: number, width: number, anchor: string, size: number): void {
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  out.include([left - size / 2, y - 1.25 * size]);
  out.include([left + width + size / 2, y + 0.5 * size]);
}

/// La larghezza dei pezzi `runs` con lo stile `style`.
function runsWidth(runs: readonly Run[], style: Inherited, measure: Measure): { readonly width: number; readonly size: number } {
  let width = 0;
  let size = style.font.size;
  for (const run of runs) {
    if (typeof run === "string") {
      width += measure(run, style.font);
      continue;
    }
    const own = inherit(style, run.attrs);
    width += measure(run.text, own.font);
    size = Math.max(size, own.font.size);
  }
  return { width, size };
}

/// Il riquadro delle righe di un testo nelle sue coordinate, misurato con
/// `measure`: da dove ogni riga comincia a dove finisce, dall'altezza delle
/// maiuscole alle discendenti. `null` per un testo su tracciato, che non sta in
/// righe, o vuoto.
export function textExtent(node: ElementPart, measure: Measure): Bounds | null {
  const elem = elemOf(node);
  if (elem === null || elem.tag !== "text") return null;
  const style = inherit(inheritedBy(node), elem.attrs);
  const out = new BoundsBuilder();
  const x = length(elem.attrs.x ?? "0") ?? 0;
  let y = length(elem.attrs.y ?? "0") ?? 0;
  for (const line of elem.children ?? []) {
    if (line.tag === "textPath") return null;
    if (line.tag !== "tspan") continue;
    const own = inherit(style, line.attrs);
    const lineX = line.attrs.x === undefined ? x : (length(line.attrs.x) ?? x);
    y += line.attrs.dy === undefined ? 0 : (length(line.attrs.dy) ?? 0);
    const { width, size } = runsWidth(line.runs ?? [line.text ?? ""], own, measure);
    if (!(width > 0)) continue;
    const left = own.anchor === "middle" ? lineX - width / 2 : own.anchor === "end" ? lineX - width : lineX;
    out.include([left, y - 0.8 * size]);
    out.include([left + width, y + 0.25 * size]);
  }
  return out.finish();
}

/// Mezzo spessore del contorno di `node`, con quello che eredita; 0 senza
/// contorno.
export function strokeHalf(node: ElementPart): number {
  const style = inherit(inheritedBy(node), plainAttributes(node));
  return style.stroke ? style.strokeWidth / 2 : 0;
}

/// Il riquadro di un testo nelle sue coordinate, misurato con `measure`;
/// `null` se non si sa.
function textBox(model: DocumentModel, elem: Elem, style: Inherited, measure: Measure): Bounds | null {
  const out = new BoundsBuilder();
  const x = length(elem.attrs.x ?? "0") ?? 0;
  let y = length(elem.attrs.y ?? "0") ?? 0;
  const wrap = elem.attrs["fub:wrap"] === undefined ? null : length(elem.attrs["fub:wrap"]);
  for (const line of elem.children ?? []) {
    if (line.tag === "textPath") {
      // Il testo sta lungo il tracciato: il suo riquadro, largo un corpo e
      // mezzo da ogni lato.
      const href = trim(line.attrs.href ?? line.attrs["xlink:href"] ?? "");
      const path = href.startsWith("#") ? resourcesOf(model).get(href.slice(1)) : undefined;
      const d = path === undefined ? undefined : elemOf(path)?.attrs.d;
      const box = d === undefined ? null : transformedBounds(shapeSegments("path", [["d", d]]), IDENTITY);
      if (box === null) return null;
      const size = runsWidth(line.runs ?? [line.text ?? ""], inherit(style, line.attrs), measure).size;
      out.include([box.min[0] - 1.5 * size, box.min[1] - 1.5 * size]);
      out.include([box.max[0] + 1.5 * size, box.max[1] + 1.5 * size]);
      continue;
    }
    if (line.tag !== "tspan") continue;
    const own = inherit(style, line.attrs);
    const lineX = line.attrs.x === undefined ? x : (length(line.attrs.x) ?? x);
    y += line.attrs.dy === undefined ? 0 : (length(line.attrs.dy) ?? 0);
    const { width, size } = runsWidth(line.runs ?? [line.text ?? ""], own, measure);
    lineBox(out, lineX, y, width, own.anchor, size);
    if (wrap !== null) lineBox(out, lineX, y, wrap, own.anchor, size);
  }
  return out.finish();
}

/// Quanto le punte di una linea arrivano oltre i suoi vertici: la diagonale
/// del riquadro di ogni marcatore che usa, nelle sue unità.
function markersReach(model: DocumentModel, own: Readonly<Record<string, string>>, style: Inherited): number {
  let reach = 0;
  for (const name of ["marker-start", "marker-mid", "marker-end"]) {
    const value = own[name];
    const id = value === undefined ? null : reference(value);
    const marker = id === null ? undefined : resourcesOf(model).get(id);
    const attrs = marker === undefined ? null : (elemOf(marker)?.attrs ?? null);
    if (attrs === null) continue;
    const width = attrs.markerWidth === undefined ? 3 : (nonNegativeLength(attrs.markerWidth) ?? 3);
    const height = attrs.markerHeight === undefined ? 3 : (nonNegativeLength(attrs.markerHeight) ?? 3);
    const scale = (attrs.markerUnits ?? "strokeWidth") === "strokeWidth" ? style.strokeWidth : 1;
    reach = Math.max(reach, Math.hypot(width, height) * scale);
  }
  return reach;
}

/// I tag su cui i browser disegnano i marcatori.
const MARKED: ReadonlySet<string> = new Set(["path", "line", "polyline", "polygon"]);

/// Il riquadro di ciò che disegna `node` senza il suo filtro, nelle sue
/// coordinate (prima del suo `transform`), con lo stile `style` di chi lo
/// contiene: contorno, punte, testo misurato ed effetti dei figli compresi.
/// `null` se non disegna niente; `"unknown"` se non si sa, per una parte
/// estranea, un'immagine o un testo che non si leggono.
function bareBox(model: DocumentModel, node: ElementPart, style: Inherited, measure: Measure): Bounds | null | "unknown" {
  if (node.details === null) return "unknown";
  const role = node.details.role;
  if (role === "title" || role === "desc") return null;
  const own = plainAttributes(node);
  if (own.get("display")?.trim() === "none") return null;
  const mine = inherit(style, own);
  if (node.kind === "container") {
    const out = new BoundsBuilder();
    for (const child of elementChildren(node)) {
      const inner = childBox(model, child, mine, measure);
      if (inner === "unknown") return "unknown";
      if (inner === null) continue;
      out.include(inner.min);
      out.include(inner.max);
    }
    return out.finish();
  }
  const elem = elemOf(node);
  if (elem === null) return "unknown";
  if (elem.tag === "text") return textBox(model, elem, mine, measure) ?? "unknown";
  if (elem.tag === "image") {
    const x = length(elem.attrs.x ?? "0");
    const y = length(elem.attrs.y ?? "0");
    const width = elem.attrs.width === undefined ? null : length(elem.attrs.width);
    const height = elem.attrs.height === undefined ? null : length(elem.attrs.height);
    if (x === null || y === null || width === null || height === null) return "unknown";
    return { min: [x, y], max: [x + width, y + height] };
  }
  const box = transformedBounds(shapeSegments(elem.tag, Object.entries(elem.attrs)), IDENTITY);
  if (box === null) return null;
  const by = Math.max(strokeReach(mine), MARKED.has(elem.tag) ? markersReach(model, elem.attrs, mine) : 0);
  return grown(box, { left: by, top: by, right: by, bottom: by });
}

/// Il riquadro di ciò che disegna `node`, come [`bareBox`], col suo filtro:
/// i suoi effetti, o la regione di un filtro d'altri, oltre la quale nessun
/// filtro dipinge.
function drawnBox(model: DocumentModel, node: ElementPart, style: Inherited, measure: Measure): Bounds | null | "unknown" {
  const box = bareBox(model, node, style, measure);
  if (box === null || box === "unknown") return box;
  const state = readState(model, node);
  if (state.kind === "effects") return grown(box, visibleReach(state.effects));
  if (state.kind === "other") return otherRegion(model, state.filter, box) ?? "unknown";
  return box;
}

/// Il riquadro di `child` nelle coordinate di chi lo contiene, col suo
/// `transform`.
function childBox(model: DocumentModel, child: ElementPart, style: Inherited, measure: Measure): Bounds | null | "unknown" {
  const box = drawnBox(model, child, style, measure);
  if (box === null || box === "unknown") return box;
  const written = plainAttributes(child).get("transform");
  const matrix = written === undefined ? IDENTITY : parseTransform(written);
  if (matrix === null) return "unknown";
  return mapped(box, matrix);
}

/// `box` dopo `m`: il riquadro dei suoi quattro angoli.
function mapped(box: Bounds, m: Matrix): Bounds {
  if (m === IDENTITY) return box;
  const out = new BoundsBuilder();
  for (const corner of [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]] as const) out.include(apply(m, corner));
  return out.finish()!;
}

/// La regione del filtro `id`, d'un altro programma, sull'oggetto di
/// riquadro `box`: in `userSpaceOnUse` com'è scritta, in `objectBoundingBox`
/// sul riquadro, quella di partenza di SVG se manca. `null` se non si legge.
function otherRegion(model: DocumentModel, id: string, box: Bounds): Bounds | null {
  const filter = resourcesOf(model).get(id);
  const attrs = filter === undefined ? null : (elemOf(filter)?.attrs ?? null);
  if (attrs === null) return null;
  const user = (attrs.filterUnits ?? "objectBoundingBox") === "userSpaceOnUse";
  const read = (name: string, fallback: number): number | null => {
    const value = attrs[name];
    if (value === undefined) return user ? null : fallback;
    if (user) return length(value);
    const text = trim(value);
    return text.endsWith("%") ? (number(text.slice(0, -1)) ?? NaN) / 100 : number(text);
  };
  const x = read("x", -0.1);
  const y = read("y", -0.1);
  const width = read("width", 1.2);
  const height = read("height", 1.2);
  if (x === null || y === null || width === null || height === null || [x, y, width, height].some((v) => !Number.isFinite(v))) return null;
  if (user) return { min: [x, y], max: [x + width, y + height] };
  const w = box.max[0] - box.min[0];
  const h = box.max[1] - box.min[1];
  return { min: [box.min[0] + x * w, box.min[1] + y * h], max: [box.min[0] + (x + width) * w, box.min[1] + (y + height) * h] };
}

/// Il riquadro di ciò che `node` disegna nelle sue coordinate, prima del suo
/// `transform`, coi suoi effetti e con quelli di ciò che contiene: quello
/// che l'export della selezione e «Adatta la pagina al disegno» devono
/// contenere. `null` se non disegna niente o non si sa.
export function visibleBox(model: DocumentModel, node: ElementPart, measure: Measure): Bounds | null {
  const box = drawnBox(model, node, inheritedBy(node), measure);
  return box === "unknown" ? null : box;
}

/// Vero se `node`, o qualcosa che contiene, ha degli effetti o un filtro:
/// allora ciò che si vede va oltre la sua geometria.
export function holdsFilters(node: ElementPart): boolean {
  const own = plainAttributes(node).get("filter");
  if (own !== undefined && trim(own) !== "none") return true;
  return node.kind === "container" && elementChildren(node).some(holdsFilters);
}

/// La regione del filtro che disegna `effects` su `node`, scritta; `null`
/// se non si sa il riquadro di ciò che l'oggetto disegna, o se non disegna
/// niente.
export function regionOf(model: DocumentModel, node: ElementPart, effects: readonly Effect[], measure: Measure): RegionWrite | null {
  const box = bareBox(model, node, inheritedBy(node), measure);
  if (box === null || box === "unknown") return null;
  const reach = regionReach(effects);
  const margin = { left: reach.left + REGION_MARGIN, top: reach.top + REGION_MARGIN, right: reach.right + REGION_MARGIN, bottom: reach.bottom + REGION_MARGIN };
  return writeRegion(grown(box, margin));
}

// ---------------------------------------------------------------------------
// Leggere gli effetti di un oggetto.
// ---------------------------------------------------------------------------

/// Gli effetti di un oggetto: nessuno; quelli di FubDraw, col filtro che li
/// disegna (`null` se sono tutti nascosti); o un filtro d'un altro
/// programma, che si toglie soltanto.
export type EffectsState =
  | { readonly kind: "none" }
  | { readonly kind: "effects"; readonly effects: readonly Effect[]; readonly filter: string | null }
  | { readonly kind: "other"; readonly filter: string };

/// Lo stato di `node` letto senza il controllo di chi usa il filtro: quello
/// che serve al riquadro e al seguito.
function readState(model: DocumentModel, node: ElementPart): EffectsState {
  const written = plainAttributes(node).get("filter");
  const id = written === undefined || trim(written) === "none" ? null : reference(written);
  if (written !== undefined && trim(written) !== "none" && id === null) return { kind: "other", filter: "" };
  const text = fubAttributes(node).get("effect");
  const effects = text === undefined ? null : parseEffects(text);
  if (id === null) return effects === null || effects.length === 0 || effects.some((effect) => !effect.hidden) ? { kind: "none" } : { kind: "effects", effects, filter: null };
  if (effects === null || !effects.some((effect) => !effect.hidden)) return { kind: "other", filter: id };
  const filter = resourcesOf(model).get(id);
  if (filter === undefined || filter.details?.lifecycle !== "private") return { kind: "other", filter: id };
  const elem = elemOf(filter);
  if (elem === null || elem.tag !== "filter") return { kind: "other", filter: id };
  const { x, y, width, height } = elem.attrs;
  if (x === undefined || y === undefined || width === undefined || height === undefined) return { kind: "other", filter: id };
  return sameElem(elem, filterElem(id, effects, { x, y, width, height })) ? { kind: "effects", effects, filter: id } : { kind: "other", filter: id };
}

/// Gli effetti di `node`. Un filtro è di FubDraw se è privato, se lo usa
/// soltanto `node`, e se è quello che FubDraw scriverebbe per `fub:effect`.
export function effectsState(model: DocumentModel, node: ElementPart): EffectsState {
  return effectsStates(model, [node])[0]!;
}

/// Gli effetti di ciascuno di `nodes`, come [`effectsState`]: chi usa i
/// filtri si conta una volta sola, e mille oggetti scelti si leggono entro un
/// fotogramma.
export function effectsStates(model: DocumentModel, nodes: readonly ElementPart[]): EffectsState[] {
  let users: Map<string, number> | null = null;
  return nodes.map((node) => {
    const state = readState(model, node);
    if (state.kind !== "effects" || state.filter === null) return state;
    users ??= usersOf(model);
    return users.get(state.filter) === 1 ? state : { kind: "other", filter: state.filter };
  });
}

// ---------------------------------------------------------------------------
// Chi può averli.
// ---------------------------------------------------------------------------

/// Perché gli effetti non si danno a un oggetto: un ritaglio o una maschera
/// li taglierebbero; non se ne sa la misura; non è un oggetto che li prende.
export type EffectsRefusal = "clipped" | "unknown" | "kind";

/// I ruoli che prendono effetti: ogni oggetto che si disegna, anche le forme
/// di FubDraw scritte come tracciati, i tratti a penna, le frecce, i poligoni,
/// le stelle e le linee a spessore variabile.
const TAKES: ReadonlySet<string> = new Set(["path", "stroke", "arrow", "connector", "ngon", "star", "width", "rect", "ellipse", "circle", "line", "polyline", "polygon", "text", "image", "group", "link"]);

/// `null` se `node` può avere gli effetti; altrimenti perché no.
export function effectsRefusal(model: DocumentModel, node: ElementPart, measure: Measure): EffectsRefusal | null {
  const role = node.details?.role;
  if (role === undefined || !TAKES.has(role)) return "kind";
  const own = plainAttributes(node);
  const cut = (name: string): boolean => own.has(name) && trim(own.get(name)!) !== "none";
  if (cut("clip-path") || cut("mask")) return "clipped";
  return regionOf(model, node, [defaultEffect("shadow")], measure) === null ? "unknown" : null;
}

// ---------------------------------------------------------------------------
// Scrivere.
// ---------------------------------------------------------------------------

/// Dà a `node`, i cui effetti sono `state`, gli effetti `effects` (`[]` per
/// toglierli): mette in `plan` il filtro che ne discende, cambiato sul posto
/// se ha la stessa forma, nuovo altrimenti, in `home`, e rende gli attributi
/// di `node` che cambiano, `fub:effect` e `filter`, per chi li scrive con i
/// suoi. Un filtro d'un altro programma se ne va. `null` se la regione non si
/// sa.
export function effectsAttrs(plan: Plan, node: ElementPart, state: EffectsState, effects: readonly Effect[], measure: Measure, home: () => Home): Record<string, string | null> | null {
  const model = plan.model;
  const attrs: Record<string, string | null> = {};
  const text = effects.length === 0 ? null : writeEffects(effects);
  if ((fubAttributes(node).get("effect") ?? null) !== text) attrs["fub:effect"] = text;
  const shown = effects.some((effect) => !effect.hidden);
  const current = state.kind === "none" ? null : state.filter;
  if (!shown) {
    if (current !== null) attrs.filter = null;
  } else {
    const region = regionOf(model, node, effects, measure);
    if (region === null) return null;
    const filter = state.kind === "effects" && state.filter !== null ? resourcesOf(model).get(state.filter)! : null;
    const before = filter === null ? null : elemOf(filter);
    const after = filter === null ? null : filterElem(state.kind === "effects" ? state.filter! : "", effects, region);
    const parts = before === null || after === null ? null : elemChanges(before, after);
    if (parts !== null && filter !== null) {
      // Sul posto: soltanto ciò che cambia.
      for (const { part, attrs: changed } of parts) plan.ops.push(part.length === 0 ? { op: "set", id: filter.facts.id!, attrs: changed } : { op: "set", id: filter.facts.id!, part, attrs: changed });
    } else {
      const { parent, prelude } = home();
      const id = plan.ids.next("resource");
      plan.ops.push(...prelude, { op: "add", parent, pos: { last: true }, elem: filterElem(id, effects, region) });
      attrs.filter = `url(#${id})`;
    }
  }
  return attrs;
}

/// Un cambio degli effetti delle unità scelte.
export type EffectsChange =
  /// Gli effetti, tutti, di ciascuna: quelli del pannello.
  | { readonly kind: "set"; readonly effects: readonly Effect[] }
  /// Un effetto in più, in fondo alla lista di ciascuna.
  | { readonly kind: "add"; readonly effect: Effect }
  /// Nessun effetto, e nessun filtro, nemmeno d'un altro programma.
  | { readonly kind: "clear" };

/// Le operazioni che cambiano gli effetti di `units` con `change`. La
/// selezione resta la stessa. Rifiuta, col perché del primo oggetto che non
/// li prende, se uno non può averli; [`MAX_EFFECTS`] e la sfocatura sola
/// valgono per ciascuno.
export function effectsOps(model: DocumentModel, units: readonly Unit[], change: EffectsChange, measure: Measure, ids: NewIds): Arranged | EffectsRefusal | "full" {
  const plan = new Plan(model, ids);
  // La `defs` che manca nasce una volta sola, col primo filtro.
  let made: Home | null = null;
  const home = (): Home => {
    if (made !== null) return { parent: made.parent, prelude: [] };
    made = homeOf(model);
    return made;
  };
  const nodes = units.map((unit) => nodeOf(model, unit));
  const states = effectsStates(model, nodes);
  for (const [at, node] of nodes.entries()) {
    const state = states[at]!;
    let effects: readonly Effect[] = [];
    if (change.kind === "set") effects = change.effects;
    else if (change.kind === "add") {
      const before = state.kind === "effects" ? state.effects : [];
      if (before.length >= MAX_EFFECTS || (change.effect.kind === "blur" && before.some((effect) => effect.kind === "blur"))) return "full";
      effects = [...before, change.effect];
    }
    if (effects.length > 0) {
      const refused = effectsRefusal(model, node, measure);
      if (refused !== null) return refused;
    }
    const attrs = effectsAttrs(plan, node, state, effects, measure, home);
    if (attrs === null) return "unknown";
    if (Object.keys(attrs).length > 0) plan.ops.push({ op: "set", id: plan.idOf(node), attrs });
  }
  return plan.finish(units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key)));
}

// ---------------------------------------------------------------------------
// Il seguito.
// ---------------------------------------------------------------------------

/// Le operazioni che tengono la regione dei filtri degli effetti sull'oggetto,
/// dopo un'operazione che ha toccato gli id `touched` di `model`: per ogni
/// oggetto con un filtro di FubDraw la cui regione non è più quella che si
/// scriverebbe, la regione nuova. `null` se non c'è niente da cambiare.
///
/// Guarda gli elementi toccati, chi li contiene, il cui riquadro cresce e
/// cala con loro, e ciò che contengono, che eredita il loro contorno e il
/// loro carattere; tutti gli oggetti con effetti, se è cambiata una risorsa,
/// come il tracciato di un testo o una punta. `find` dice quale elemento
/// porta un id (il motore ha un indice, `SceneEngine.holder`); `measure`
/// misura i testi come li disegna il foglio. Ciò che non si legge si salta:
/// non lancia.
export function followEffects(model: DocumentModel, touched: ReadonlySet<string>, find: (id: string) => ElementPart | null, measure: Measure): Op | null {
  if (touched.size === 0) return null;
  const nodes = new Set<ElementPart>();
  const down = (node: ElementPart): void => {
    if (nodes.has(node)) return;
    nodes.add(node);
    if (node.kind === "container") for (const child of elementChildren(node)) down(child);
  };
  let everything = false;
  for (const id of touched) {
    const node = find(id);
    if (node === null) continue;
    if (node.details?.role === "resource") {
      everything = true;
      continue;
    }
    down(node);
    for (let up = node.parent; up !== null && up !== model.root && !nodes.has(up); up = up.parent) nodes.add(up);
  }
  if (everything) for (const child of elementChildren(model.root)) down(child);
  // Chi ha un filtro da seguire lo nomina nei suoi attributi: gli altri non
  // si leggono, e mille oggetti si scorrono entro un fotogramma, anche coi
  // campioni e le sfumature.
  const filters = new Set<string>();
  for (const [id, resource] of resourcesOf(model)) if (resource.facts.local === "filter") filters.add(id);
  const sets: Op[] = [];
  for (const node of nodes) {
    if (!node.facts.refs.some((id) => filters.has(id)) || node.details === null || node.details.role === "resource" || !fubAttributes(node).has("effect")) continue;
    const state = readState(model, node);
    if (state.kind !== "effects" || state.filter === null) continue;
    const attrs = elemOf(resourcesOf(model).get(state.filter)!)?.attrs;
    const region = regionOf(model, node, state.effects, measure);
    if (attrs === undefined || region === null) continue;
    const changed: Record<string, string> = {};
    for (const [name, value] of Object.entries(region)) if (attrs[name] !== value) changed[name] = value;
    if (Object.keys(changed).length > 0) sets.push({ op: "set", id: state.filter, attrs: changed });
  }
  return gesture(sets);
}
