// Lo stile di ogni elemento di un disegno come lo calcola un browser, quanto
// basta per sapere se dopo un comando resta lo stesso: per ogni proprietà il
// valore che vince fra il foglio di stile, l'attributo `style`, gli attributi
// di presentazione e l'eredità, e la trasformazione e l'opacità che si
// accumulano dalla radice. Lo usa `styled.ts`, che confronta lo stile di
// prima con quello di dopo e scrive sugli elementi ciò che servirebbe a
// lasciarli com'erano.
//
// - **La cascata di CSS:** prima le dichiarazioni `!important` dell'attributo
//   `style`, poi quelle importanti dei fogli, coi livelli di `@layer` al
//   contrario; poi `style`, poi le regole normali, per livello, specificità e
//   ordine; per ultimi gli attributi di presentazione, e se nessuno dice
//   niente l'eredità o il valore iniziale.
// - **Il valore come chiave:** due valori uguali hanno la stessa chiave anche
//   se scritti in modo diverso (`#333` e `#333333`, `14px` e `14`). Ciò che
//   dipende da altro si risolve: `currentcolor` col colore, `em` con la
//   dimensione del carattere, `var()` con le variabili, `inherit` col
//   genitore; `font` e `marker` si sciolgono nelle loro proprietà.
// - **Il dubbio resta nella chiave:** una regola che forse vale, perché la sua
//   condizione dipende da dove si guarda il disegno o perché il suo selettore
//   non si legge, entra nella chiave del valore che potrebbe battere. Chi
//   confronta vede il dubbio, e sa dire da dove viene.
// - **Senza ricorsione profonda:** i valori si calcolano dalla radice in giù
//   e si ricordano, così un disegno con centomila gruppi annidati non esaurisce
//   la pila.

import { compose, IDENTITY, type Matrix } from "../scene/matrix";
import { NAMED_COLORS, transform as svgTransform } from "../scene/values";
import { SVG_NS } from "../scene/xml";
import { formatNumber } from "../number";
import { Matcher, readDeclarations, type Declaration, type Maybe, type Rule, type Sheet, type StyleNode } from "./selectors";

/// Un elemento come lo vede la cascata.
export interface CascadeNode extends StyleNode {
  readonly parent: CascadeNode | null;
  readonly children: readonly CascadeNode[];
}

/// Perché un valore non è certo: una regola con una condizione che dipende da
/// dove si guarda il disegno, o con un selettore che non si legge.
export interface Doubt {
  readonly kind: "selector" | "condition";
  /// Il selettore o l'at-rule com'è scritta.
  readonly text: string;
}

/// Il valore di una proprietà su un elemento.
export interface Value {
  /// Uguale per due valori che si vedono uguali.
  readonly key: string;
  /// Come si scrive su un elemento perché valga lo stesso dovunque stia;
  /// `null` se non si sa scrivere.
  readonly text: string | null;
  /// Vero se si può scrivere come attributo di presentazione, non solo in
  /// `style`.
  readonly attr: boolean;
  /// Vero se viene da una dichiarazione sull'elemento, non dal genitore.
  readonly own: boolean;
  /// Il primo dubbio che potrebbe cambiarlo.
  readonly doubt: Doubt | null;
  /// Il numero, per la dimensione del carattere e il peso.
  readonly number: number | null;
}

/// Una trasformazione accumulata dalla radice: la matrice e, se c'è una
/// trasformazione che non si sa calcolare, ciò che la precede.
export interface World {
  readonly m: Matrix;
  readonly sym: string;
}

/// Un'opacità accumulata dalla radice, come `World`.
export interface Alpha {
  readonly a: number;
  readonly sym: string;
}

/// Le proprietà che si ereditano.
export const INHERITED: ReadonlySet<string> = new Set([
  "color", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "paint-order", "marker-start", "marker-mid", "marker-end", "clip-rule",
  "color-interpolation", "color-interpolation-filters", "color-rendering", "shape-rendering", "text-rendering", "image-rendering",
  "visibility", "font-family", "font-size", "font-size-adjust", "font-style", "font-variant", "font-variant-caps",
  "font-variant-ligatures", "font-variant-numeric", "font-variant-east-asian", "font-variant-alternates", "font-variant-position",
  "font-weight", "font-stretch", "font-kerning", "font-feature-settings", "font-variation-settings", "font-optical-sizing",
  "font-synthesis", "font-language-override", "letter-spacing", "word-spacing", "kerning", "text-anchor", "direction", "writing-mode",
  "text-orientation", "glyph-orientation-vertical", "glyph-orientation-horizontal", "dominant-baseline", "line-height", "white-space",
  "white-space-collapse", "text-wrap", "text-align", "text-align-last", "text-indent", "text-transform", "text-shadow",
  "text-decoration-skip-ink", "text-underline-offset", "text-underline-position", "text-emphasis", "text-emphasis-color",
  "text-emphasis-style", "text-emphasis-position", "word-break", "overflow-wrap", "word-wrap", "hyphens", "tab-size", "quotes",
  "list-style", "list-style-type", "list-style-position", "list-style-image", "caption-side", "border-collapse", "border-spacing",
  "empty-cells", "color-scheme", "-webkit-text-fill-color", "-webkit-text-stroke", "-webkit-text-stroke-color",
  "-webkit-text-stroke-width", "orphans", "widows",
]);

/// Il valore iniziale delle proprietà che si sanno scrivere; per le altre è
/// `initial`, che si scrive solo in `style`.
const INITIAL: Readonly<Record<string, string>> = {
  fill: "#000000",
  "fill-opacity": "1",
  "fill-rule": "nonzero",
  stroke: "none",
  "stroke-width": "1",
  "stroke-opacity": "1",
  "stroke-linecap": "butt",
  "stroke-linejoin": "miter",
  "stroke-miterlimit": "4",
  "stroke-dasharray": "none",
  "stroke-dashoffset": "0",
  "paint-order": "normal",
  "marker-start": "none",
  "marker-mid": "none",
  "marker-end": "none",
  "clip-rule": "nonzero",
  "color-interpolation": "sRGB",
  "color-interpolation-filters": "linearRGB",
  "shape-rendering": "auto",
  "text-rendering": "auto",
  "image-rendering": "auto",
  visibility: "visible",
  "font-style": "normal",
  "font-variant": "normal",
  "font-weight": "normal",
  "font-stretch": "normal",
  "font-size": "16px",
  "letter-spacing": "normal",
  "word-spacing": "normal",
  "text-anchor": "start",
  direction: "ltr",
  "writing-mode": "horizontal-tb",
  "dominant-baseline": "auto",
  "alignment-baseline": "auto",
  "baseline-shift": "0",
  "text-decoration": "none",
  "line-height": "normal",
  "white-space": "normal",
  "unicode-bidi": "normal",
  opacity: "1",
  display: "inline",
  filter: "none",
  "clip-path": "none",
  mask: "none",
  "mix-blend-mode": "normal",
  isolation: "auto",
  transform: "none",
  "stop-color": "#000000",
  "stop-opacity": "1",
  "flood-color": "#000000",
  "flood-opacity": "1",
  "lighting-color": "#ffffff",
  "vector-effect": "none",
  overflow: "visible",
};

/// Le proprietà che si scrivono come attributi di presentazione, su ogni
/// elemento SVG.
const PRESENTATION: ReadonlySet<string> = new Set([
  "alignment-baseline", "baseline-shift", "clip-path", "clip-rule", "color", "color-interpolation", "color-interpolation-filters",
  "color-rendering", "cursor", "direction", "display", "dominant-baseline", "fill", "fill-opacity", "fill-rule", "filter", "flood-color",
  "flood-opacity", "font-family", "font-size", "font-size-adjust", "font-stretch", "font-style", "font-variant", "font-weight",
  "glyph-orientation-horizontal", "glyph-orientation-vertical", "image-rendering", "isolation", "kerning", "letter-spacing",
  "lighting-color", "marker-end", "marker-mid", "marker-start", "mask", "mask-type", "mix-blend-mode", "opacity", "overflow",
  "paint-order", "pointer-events", "shape-rendering", "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width", "text-anchor", "text-decoration",
  "text-overflow", "text-rendering", "transform", "transform-origin", "unicode-bidi", "vector-effect", "visibility", "white-space",
  "word-spacing", "writing-mode",
]);

/// Le proprietà della geometria, attributi di presentazione solo sui loro
/// elementi.
const GEOMETRY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["x", new Set(["rect", "image", "foreignObject", "svg", "use", "symbol"])],
  ["y", new Set(["rect", "image", "foreignObject", "svg", "use", "symbol"])],
  ["width", new Set(["rect", "image", "foreignObject", "svg", "use", "symbol"])],
  ["height", new Set(["rect", "image", "foreignObject", "svg", "use", "symbol"])],
  ["cx", new Set(["circle", "ellipse"])],
  ["cy", new Set(["circle", "ellipse"])],
  ["r", new Set(["circle"])],
  ["rx", new Set(["rect", "ellipse"])],
  ["ry", new Set(["rect", "ellipse"])],
  ["d", new Set(["path"])],
]);

/// Le proprietà che contano solo per chi interagisce col disegno, o mentre
/// cambia: in un disegno fermo non si vedono.
export const IGNORED: ReadonlySet<string> = new Set([
  "cursor", "pointer-events", "user-select", "-webkit-user-select", "-moz-user-select", "-ms-user-select", "touch-action",
  "will-change", "caret-color", "resize", "-webkit-tap-highlight-color", "transition", "transition-property", "transition-duration",
  "transition-timing-function", "transition-delay", "transition-behavior",
]);

/// Ciò che un contenitore fa a tutto ciò che contiene insieme, e che nessun
/// figlio può fare da sé.
export const EFFECTS: readonly string[] = ["filter", "clip-path", "mask", "mix-blend-mode", "isolation", "display"];

/// I contenitori che non disegnano niente da sé.
const PURE: ReadonlySet<string> = new Set(["g", "a", "svg", "switch"]);

/// Gli elementi i cui figli non si disegnano dove stanno, ma dove li si usa.
export const RESOURCES: ReadonlySet<string> = new Set([
  "defs", "symbol", "marker", "pattern", "clipPath", "mask", "linearGradient", "radialGradient", "filter", "font", "font-face",
  "cursor", "view",
]);

/// Gli elementi che non si vedono, e nemmeno ciò che contengono.
export const SILENT: ReadonlySet<string> = new Set(["title", "desc", "metadata", "style", "script"]);

/// Le forme, che hanno riempimento e contorno.
const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

/// Le forme coi marcatori.
const MARKED: ReadonlySet<string> = new Set(["path", "line", "polyline", "polygon"]);

/// Gli elementi del testo.
const TEXTS: ReadonlySet<string> = new Set(["text", "tspan", "textPath", "tref", "altGlyph"]);

/// Le proprietà del riempimento e del contorno.
const PAINT: ReadonlySet<string> = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "paint-order", "vector-effect", "shape-rendering",
  "color-interpolation", "color-rendering",
]);

/// Le proprietà del testo che non cominciano con `font` o `text-`.
const TEXT_EXTRA: ReadonlySet<string> = new Set([
  "letter-spacing", "word-spacing", "kerning", "direction", "writing-mode", "dominant-baseline", "alignment-baseline",
  "baseline-shift", "unicode-bidi", "white-space", "white-space-collapse", "line-height", "glyph-orientation-vertical",
  "glyph-orientation-horizontal", "word-break", "overflow-wrap", "word-wrap", "hyphens", "tab-size",
]);

/// Le proprietà di un effetto, che valgono su ogni elemento che si vede.
const EVERYWHERE: ReadonlySet<string> = new Set([
  "opacity", "transform", "transform-origin", "transform-box", "translate", "rotate", "scale", "filter", "clip-path", "clip", "mask",
  "mix-blend-mode", "isolation", "display", "animation", "animation-name", "animation-duration", "animation-timing-function",
  "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state",
  "offset-path", "offset-distance", "offset-rotate", "zoom", "content-visibility",
]);

/// Le proprietà che `font` scrive tutte, anche quelle che non nomina.
const FONT_LONGHANDS: ReadonlySet<string> = new Set([
  "font-style", "font-variant", "font-variant-caps", "font-variant-ligatures", "font-variant-numeric", "font-variant-east-asian",
  "font-variant-alternates", "font-variant-position", "font-weight", "font-stretch", "font-size", "line-height", "font-family",
  "font-size-adjust", "font-kerning", "font-feature-settings", "font-variation-settings", "font-optical-sizing",
  "font-language-override",
]);

/// Le parole chiave che valgono per ogni proprietà.
const CSS_WIDE: ReadonlySet<string> = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/// Le dimensioni del carattere per nome, in pixel.
const FONT_SIZES: ReadonlyMap<string, number> = new Map([
  ["xx-small", 9], ["x-small", 10], ["small", 13], ["medium", 16], ["large", 18], ["x-large", 24], ["xx-large", 32],
  ["xxx-large", 48],
]);

/// Le unità assolute, in pixel.
const ABSOLUTE: ReadonlyMap<string, number> = new Map([
  ["", 1], ["px", 1], ["in", 96], ["cm", 96 / 2.54], ["mm", 96 / 25.4], ["q", 96 / 101.6], ["pt", 96 / 72], ["pc", 16],
]);

/// Le cifre con cui si scrive un numero calcolato.
const PLACES = 4;

/// Un contatore per i dubbi che non si confrontano: ognuno è diverso da ogni
/// altro, anche fra due alberi.
let doubts = 0;

/// Vero se `p` si eredita.
export const inherits = (p: string): boolean => p.startsWith("--") || INHERITED.has(p);

/// Vero se `node` è nel namespace SVG.
const isSvg = (node: StyleNode): boolean => node.uri === SVG_NS;

/// Vero se la proprietà `p` si vede su `node`: un riempimento su una forma o
/// su un testo, un carattere su un testo, un effetto dovunque. Un elemento
/// che non si conosce, o che non è SVG, vede tutto.
export function renders(node: StyleNode, p: string): boolean {
  if (!isSvg(node)) return true;
  const local = node.local;
  if (SILENT.has(local)) return false;
  if (EVERYWHERE.has(p)) return true;
  if (local === "use" || local === "foreignObject") return true;
  const geometry = GEOMETRY.get(p);
  if (geometry !== undefined) return geometry.has(local);
  if (PURE.has(local) || RESOURCES.has(local)) return false;
  if (local === "stop") return p === "stop-color" || p === "stop-opacity";
  if (local.startsWith("fe")) return p === "flood-color" || p === "flood-opacity" || p === "lighting-color" || p === "color-interpolation-filters";
  if (local === "image") return p === "image-rendering" || p === "visibility";
  const text = p.startsWith("font") || p.startsWith("text-") || p.startsWith("-webkit-text") || TEXT_EXTRA.has(p);
  if (TEXTS.has(local)) return text || PAINT.has(p) || p === "visibility";
  if (SHAPES.has(local)) return PAINT.has(p) || p === "visibility" || (MARKED.has(local) && p.startsWith("marker"));
  // Un elemento SVG che qui non si conosce.
  return true;
}

/// Vero se `p` è un attributo di presentazione di `node`.
function presentational(node: StyleNode, p: string): boolean {
  if (!isSvg(node)) return false;
  if (PRESENTATION.has(p)) return true;
  return GEOMETRY.get(p)?.has(node.local) ?? false;
}

/// Le proprietà che dichiara una dichiarazione di `property`, sciolta.
export function longhands(property: string): readonly string[] {
  if (property === "font") return [...FONT_LONGHANDS];
  if (property === "marker") return ["marker-start", "marker-mid", "marker-end"];
  return [property];
}

/// Le dichiarazioni che possono dare un valore a `p`: la sua e quelle che la
/// contengono.
function sourcesOf(p: string): readonly string[] {
  const out = [p];
  if (FONT_LONGHANDS.has(p)) out.push("font");
  if (p === "marker-start" || p === "marker-mid" || p === "marker-end") out.push("marker");
  if (!p.startsWith("--") && p !== "direction" && p !== "unicode-bidi") out.push("all");
  return out;
}

/// Il valore che scrive su `p` una dichiarazione, sciolta se serve; `null`
/// se non vale, come un `font` che non si legge.
function valueFor(declaration: Declaration, p: string): string | null {
  if (declaration.property === p || declaration.property === "marker") return declaration.value;
  if (declaration.property === "all") return CSS_WIDE.has(declaration.value.trim().toLowerCase()) ? declaration.value : null;
  if (hasVar(declaration.value)) return declaration.value;
  return expandFont(declaration.value)?.get(p) ?? null;
}

const hasVar = (text: string): boolean => /var\(/i.test(text);

/// Vero se `text` è un valore che vale solo in `style`: una parola chiave per
/// ogni proprietà, una funzione di CSS, un `!`.
const styleOnly = (text: string): boolean => CSS_WIDE.has(text.trim().toLowerCase()) || /\b(?:var|calc|env|attr|min|max|clamp)\(|!/i.test(text);

// ---------------------------------------------------------------------------
// `font`.
// ---------------------------------------------------------------------------

const FONT_STYLES: ReadonlySet<string> = new Set(["italic", "oblique"]);
const FONT_STRETCHES: ReadonlySet<string> = new Set([
  "ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded",
]);
const FONT_WEIGHTS: ReadonlySet<string> = new Set(["bold", "bolder", "lighter"]);
const SYSTEM_FONTS: ReadonlySet<string> = new Set(["caption", "icon", "menu", "message-box", "small-caption", "status-bar"]);

/// Le parti di `text` divise dagli spazi fuori da stringhe e parentesi.
function words(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== null) {
      current += c;
      if (c === "\\") current += text[++i] ?? "";
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === "(") {
      depth++;
      current += c;
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
      current += c;
    } else if (depth === 0 && /\s/.test(c)) {
      if (current !== "") out.push(current);
      current = "";
    } else current += c;
  }
  if (current !== "") out.push(current);
  return out;
}

/// `font` sciolto nelle sue proprietà; `null` se non si legge.
export function expandFont(text: string): Map<string, string> | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const out = new Map<string, string>();
  if (CSS_WIDE.has(lower) || SYSTEM_FONTS.has(lower)) {
    // Un carattere di sistema non si sa scrivere: vale come sé stesso.
    const each = CSS_WIDE.has(lower) ? lower : `-fub-system(${lower})`;
    for (const name of FONT_LONGHANDS) out.set(name, each);
    return out;
  }
  for (const name of FONT_LONGHANDS) out.set(name, INITIAL[name] ?? "normal");
  out.set("font-kerning", "auto");
  out.set("font-optical-sizing", "auto");
  out.set("font-size-adjust", "none");
  const parts = words(trimmed);
  let i = 0;
  let before = 0;
  for (; i < parts.length && before < 4; i++, before++) {
    const word = parts[i]!.toLowerCase();
    if (word === "normal") continue;
    if (FONT_STYLES.has(word)) {
      out.set("font-style", word);
      // `oblique` con il suo angolo.
      if (word === "oblique" && /^-?[\d.]+(?:deg|rad|grad|turn)$/.test(parts[i + 1]?.toLowerCase() ?? "")) {
        out.set("font-style", `oblique ${parts[++i]!.toLowerCase()}`);
      }
    } else if (word === "small-caps") {
      out.set("font-variant", word);
      out.set("font-variant-caps", word);
    } else if (FONT_WEIGHTS.has(word) || /^\d+(?:\.\d+)?$/.test(word)) {
      out.set("font-weight", word);
    } else if (FONT_STRETCHES.has(word)) {
      out.set("font-stretch", word);
    } else break;
  }
  if (i >= parts.length) return null;
  let size = parts[i++]!;
  let height: string | null = null;
  const slash = size.indexOf("/");
  if (slash >= 0) {
    height = size.slice(slash + 1);
    size = size.slice(0, slash);
    if (height === "") height = parts[i++] ?? null;
  } else if (parts[i]?.startsWith("/")) {
    height = parts[i]!.slice(1);
    i++;
    if (height === "") height = parts[i++] ?? null;
  }
  if (!FONT_SIZES.has(size.toLowerCase()) && !/^(?:larger|smaller)$/i.test(size) && !/^[+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z%]*$/i.test(size) && !/^[a-z-]+\(/i.test(size)) {
    return null;
  }
  if (height === null && slash >= 0) return null;
  const family = parts.slice(i).join(" ");
  if (family === "") return null;
  out.set("font-size", size);
  if (height !== null) out.set("line-height", height);
  out.set("font-family", family);
  return out;
}

// ---------------------------------------------------------------------------
// Chiavi.
// ---------------------------------------------------------------------------

/// Un numero come si scrive in una chiave: lo stesso per `1`, `1.0` e `1px`.
const canonical = (value: number): string => String(Math.round(value * 1e6) / 1e6);

/// Un colore come `#rrggbb`, o `#rrggbbaa`.
function hex(r: number, g: number, b: number, a = 1): string {
  const two = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${two(r)}${two(g)}${two(b)}${a >= 1 ? "" : two(a * 255)}`;
}

/// Una parola di un valore nella forma delle chiavi.
function normalWord(word: string): string {
  if (word.startsWith("#")) {
    const digits = word.slice(1);
    if (/^[0-9a-f]{3,4}$/.test(digits)) return `#${[...digits].map((c) => c + c).join("")}`.replace(/^(#[0-9a-f]{6})ff$/, "$1");
    if (/^[0-9a-f]{8}$/.test(digits)) return word.replace(/ff$/, "");
    return word;
  }
  const named = NAMED_COLORS.get(word);
  if (named !== undefined) return hex((named >> 16) & 0xff, (named >> 8) & 0xff, named & 0xff);
  if (word === "transparent") return "#00000000";
  const number = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px)?$/.exec(word);
  if (number !== null) return canonical(Number(number[1]));
  const unit = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]+)$/.exec(word);
  if (unit !== null) return `${canonical(Number(unit[1]))}${unit[2]}`;
  return word;
}

/// La chiave di un valore scritto: in minuscolo fuori dalle stringhe e da
/// `url()`, con gli spazi ridotti, i numeri e i colori in una forma sola.
export function normal(text: string): string {
  let out = "";
  let word = "";
  const flush = (): void => {
    if (word !== "") out += normalWord(word.toLowerCase());
    word = "";
  };
  let i = 0;
  const value = text.trim();
  while (i < value.length) {
    const c = value[i]!;
    if (c === '"' || c === "'") {
      flush();
      let j = i + 1;
      while (j < value.length && value[j] !== c) j += value[j] === "\\" ? 2 : 1;
      out += `"${value.slice(i + 1, j)}"`;
      i = j + 1;
    } else if (word === "" && value.slice(i, i + 4).toLowerCase() === "url(") {
      const end = value.indexOf(")", i);
      const inner = value.slice(i + 4, end < 0 ? value.length : end).trim().replace(/^(["'])(.*)\1$/, "$2");
      out += `url(${inner})`;
      i = end < 0 ? value.length : end + 1;
    } else if (/\s/.test(c)) {
      flush();
      while (i < value.length && /\s/.test(value[i]!)) i++;
      const next = value[i];
      if (out !== "" && next !== undefined && !",/)".includes(next) && !out.endsWith(",") && !out.endsWith("(") && !out.endsWith("/")) out += " ";
    } else if (c === "," || c === "(" || c === ")" || c === "/") {
      flush();
      if (out.endsWith(" ")) out = out.slice(0, -1);
      out += c;
      i++;
    } else {
      word += c;
      i++;
    }
  }
  flush();
  return colorFunctions(out);
}

/// `rgb()` e `rgba()` con numeri interi come `#rrggbb`.
function colorFunctions(text: string): string {
  return text.replace(/rgba?\(([\d.]+)(?:,| )([\d.]+)(?:,| )([\d.]+)(?:(?:,|\/)([\d.]+%?))?\)/g, (whole, r: string, g: string, b: string, a?: string) => {
    let alpha = 1;
    if (a !== undefined) alpha = a.endsWith("%") ? Number(a.slice(0, -1)) / 100 : Number(a);
    if (![r, g, b].every((n) => Number.isFinite(Number(n)))) return whole;
    return hex(Number(r), Number(g), Number(b), alpha);
  });
}

/// Un'opacità scritta: un numero o una percentuale, fra 0 e 1; `null` se non
/// si legge.
export function readOpacity(text: string): number | null {
  const t = text.trim();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(t);
  if (match === null) return null;
  const n = Number(match[1]) / (match[2] === "%" ? 100 : 1);
  return Math.max(0, Math.min(1, n));
}

// ---------------------------------------------------------------------------
// Trasformazioni di CSS.
// ---------------------------------------------------------------------------

/// Un angolo di CSS in gradi; `null` se non lo è.
function angle(text: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i.exec(text.trim());
  if (match === null) return null;
  const n = Number(match[1]);
  switch ((match[2] ?? "").toLowerCase()) {
    case "deg":
      return n;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    case "turn":
      return n * 360;
    default:
      return n === 0 ? 0 : null;
  }
}

/// Una lunghezza di CSS in pixel, senza unità relative; `null` se non lo è.
function pixels(text: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i.exec(text.trim());
  if (match === null) return null;
  const scale = ABSOLUTE.get(match[2]!.toLowerCase());
  if (scale === undefined) return null;
  if (match[2] === "" && Number(match[1]) !== 0) return null;
  return Number(match[1]) * scale;
}

/// Una trasformazione scritta in CSS come matrice; `null` se dipende da altro,
/// come le percentuali, o se è in tre dimensioni.
export function cssTransform(text: string): Matrix | null {
  const value = text.trim();
  if (value.toLowerCase() === "none") return IDENTITY;
  let m = IDENTITY;
  const pattern = /\s*([a-zA-Z]+)\(([^()]*)\)\s*/y;
  let at = 0;
  while (at < value.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(value);
    if (match === null) return null;
    at = pattern.lastIndex;
    const args = match[2]!.split(/\s*,\s*|\s+/).filter((arg) => arg !== "");
    const step = cssStep(match[1]!.toLowerCase(), args);
    if (step === null) return null;
    m = compose(m, step);
  }
  return m;
}

function cssStep(name: string, args: readonly string[]): Matrix | null {
  const numbers = (): number[] | null => {
    const out = args.map((arg) => (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(arg) ? Number(arg) : NaN));
    return out.some(Number.isNaN) ? null : out;
  };
  const tan = (degrees: number): number => Math.tan((degrees * Math.PI) / 180);
  switch (name) {
    case "matrix": {
      const n = numbers();
      return n !== null && n.length === 6 ? [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!] : null;
    }
    case "translate":
    case "translatex":
    case "translatey": {
      const lengths = args.map(pixels);
      if (lengths.some((n) => n === null) || lengths.length === 0 || lengths.length > (name === "translate" ? 2 : 1)) return null;
      const [x, y] = name === "translatey" ? [0, lengths[0]!] : [lengths[0]!, lengths[1] ?? 0];
      return [1, 0, 0, 1, x, y];
    }
    case "scale":
    case "scalex":
    case "scaley": {
      const n = args.map((arg) => (arg.endsWith("%") ? Number(arg.slice(0, -1)) / 100 : Number(arg)));
      if (n.some(Number.isNaN) || n.length === 0 || n.length > (name === "scale" ? 2 : 1)) return null;
      if (name === "scalex") return [n[0]!, 0, 0, 1, 0, 0];
      if (name === "scaley") return [1, 0, 0, n[0]!, 0, 0];
      return [n[0]!, 0, 0, n[1] ?? n[0]!, 0, 0];
    }
    case "rotate":
    case "skew":
    case "skewx":
    case "skewy": {
      const degrees = args.map(angle);
      if (degrees.some((n) => n === null) || degrees.length === 0 || degrees.length > (name === "skew" ? 2 : 1)) return null;
      const [a, b] = [degrees[0]!, degrees[1] ?? 0];
      if (name === "rotate") {
        const r = (a * Math.PI) / 180;
        return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      }
      if (name === "skewx") return [1, 0, tan(a), 1, 0, 0];
      if (name === "skewy") return [1, tan(a), 0, 1, 0, 0];
      return [1, tan(b), tan(a), 1, 0, 0];
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// La cascata.
// ---------------------------------------------------------------------------

/// Ciò che vince fra le dichiarazioni di una proprietà su un elemento: il
/// valore scritto, `null` se nessuno lo scrive, `"unset"` per una variabile
/// che non c'è; da dove viene; e i dubbi che lo precedono.
interface Won {
  readonly text: string | null;
  readonly from: "inline" | "rule" | "attr" | null;
  readonly marks: readonly string[];
  readonly doubt: Doubt | null;
}

/// Il valore di una variabile che non c'è, o che si cita da sé.
const MISSING: Value = { key: "\u0000missing", text: null, attr: false, own: false, doubt: null, number: null };

/// Lo stile degli elementi di un albero che intanto cambia solo dove lo si
/// dice: chi scrive su un elemento chiama `forget` su di lui.
export class Cascade {
  private readonly matcher = new Matcher();
  /// Le regole dalla più forte, per le dichiarazioni normali e importanti.
  private readonly normal: readonly Rule[];
  private readonly important: readonly Rule[];
  private readonly matches = new Map<CascadeNode, Map<Rule, Maybe>>();
  private readonly inlines = new Map<CascadeNode, readonly Declaration[]>();
  private readonly values = new Map<CascadeNode, Map<string, Value>>();
  private readonly worlds = new Map<CascadeNode, World>();
  private readonly alphas = new Map<CascadeNode, Alpha>();
  private readonly resolving = new Set<string>();
  /// Le proprietà dichiarate da qualche parte, sciolte.
  readonly declared: ReadonlySet<string>;

  constructor(
    sheet: Sheet,
    private readonly root: CascadeNode,
    /// Chi è un elemento in tutti e due gli alberi, per i dubbi e le
    /// trasformazioni che non si calcolano.
    private readonly identity: (node: CascadeNode) => string,
    inline: ReadonlySet<string>,
  ) {
    const rules = sheet.rules;
    this.normal = [...rules].sort((a, b) => b.layer - a.layer || b.specificity - a.specificity || b.order - a.order);
    this.important = [...rules].sort((a, b) => a.layer - b.layer || b.specificity - a.specificity || b.order - a.order);
    const declared = new Set<string>(inline);
    for (const rule of rules) for (const declaration of rule.declarations) for (const name of longhands(declaration.property)) declared.add(name);
    this.declared = declared;
  }

  /// Dimentica ciò che si sa di `node` e di ciò che contiene, dopo che vi si
  /// è scritto.
  forget(node: CascadeNode): void {
    const stack = [node];
    while (stack.length > 0) {
      const at = stack.pop()!;
      this.matches.delete(at);
      this.inlines.delete(at);
      this.values.delete(at);
      this.worlds.delete(at);
      this.alphas.delete(at);
      for (const child of at.children) stack.push(child);
    }
  }

  /// Le dichiarazioni dell'attributo `style` di `node`.
  private inline(node: CascadeNode): readonly Declaration[] {
    let out = this.inlines.get(node);
    if (out === undefined) {
      const style = node.attrs.find((attr) => attr.uri === "" && attr.local === "style")?.value ?? "";
      out = style === "" ? [] : readDeclarations(style);
      this.inlines.set(node, out);
    }
    return out;
  }

  /// Le regole che forse scelgono `node`, con la risposta.
  private matched(node: CascadeNode): Map<Rule, Maybe> {
    let out = this.matches.get(node);
    if (out === undefined) {
      out = new Map();
      for (const rule of this.normal) {
        const selected = this.matcher.selects(rule.selector, node);
        if (selected === false) continue;
        const both: Maybe = selected === true && rule.condition === true ? true : null;
        out.set(rule, both);
      }
      this.matches.set(node, out);
    }
    return out;
  }

  /// La dichiarazione che vale per `p` in `block`, fra quelle di importanza
  /// `important`: l'ultima che si legge.
  private last(block: readonly Declaration[], p: string, important: boolean): string | null {
    const sources = sourcesOf(p);
    for (let k = block.length - 1; k >= 0; k--) {
      const declaration = block[k]!;
      if (declaration.important !== important || !sources.includes(declaration.property)) continue;
      const value = valueFor(declaration, p);
      if (value === null) continue;
      // Un `font` con variabili si scioglie dopo averle sostituite.
      return declaration.property === "font" && hasVar(declaration.value) ? `\u0000font\u0000${value}` : value;
    }
    return null;
  }

  /// Il dubbio di una regola che forse sceglie `node`: confrontabile se dipende
  /// solo dalla condizione, altrimenti unico.
  private mark(rule: Rule, node: CascadeNode, value: string): [string, Doubt] {
    const selected = this.matcher.selects(rule.selector, node);
    if (selected === true && !rule.placed) return [`c${rule.id}=${normal(value)}`, { kind: "condition", text: rule.at ?? rule.text }];
    return [`s${doubts++}`, rule.placed || selected === true ? { kind: "condition", text: rule.at ?? rule.text } : { kind: "selector", text: rule.text }];
  }

  /// Ciò che vince per `p` su `node`.
  private won(node: CascadeNode, p: string): Won {
    const marks: string[] = [];
    let doubt: Doubt | null = null;
    const note = (rule: Rule, value: string): void => {
      const [mark, why] = this.mark(rule, node, value);
      marks.push(mark);
      doubt ??= why;
    };
    const inline = this.inline(node);
    const matched = this.matched(node);
    let text = this.last(inline, p, true);
    if (text !== null) return { text, from: "inline", marks, doubt };
    for (const rule of this.important) {
      const match = matched.get(rule);
      if (match === undefined) continue;
      text = this.last(rule.declarations, p, true);
      if (text === null) continue;
      if (match === true) return { text, from: "rule", marks, doubt };
      note(rule, text);
    }
    text = this.last(inline, p, false);
    if (text !== null) return { text, from: "inline", marks, doubt };
    for (const rule of this.normal) {
      const match = matched.get(rule);
      if (match === undefined) continue;
      text = this.last(rule.declarations, p, false);
      if (text === null) continue;
      if (match === true) return { text, from: "rule", marks, doubt };
      note(rule, text);
    }
    if (presentational(node, p)) {
      const attr = node.attrs.find((each) => each.uri === "" && each.local === p);
      if (attr !== undefined) return { text: attr.value, from: "attr", marks, doubt };
    }
    return { text: null, from: null, marks, doubt };
  }

  /// Vero se una dichiarazione dei fogli o di `style` dà `p` a `node`, anche
  /// solo forse: allora un attributo di presentazione non basta.
  styled(node: CascadeNode, p: string): boolean {
    const won = this.won(node, p);
    return won.from === "rule" || won.from === "inline" || won.marks.length > 0;
  }

  /// Il valore di `p` su `node`.
  value(node: CascadeNode, p: string): Value {
    const known = this.values.get(node)?.get(p);
    if (known !== undefined) return known;
    // Prima gli antenati, dall'alto: niente ricorsione lungo l'albero.
    const chain: CascadeNode[] = [];
    for (let at = node.parent; at !== null && this.values.get(at)?.get(p) === undefined; at = at.parent) chain.push(at);
    for (let k = chain.length - 1; k >= 0; k--) this.compute(chain[k]!, p);
    return this.compute(node, p);
  }

  private compute(node: CascadeNode, p: string): Value {
    const known = this.values.get(node)?.get(p);
    if (known !== undefined) return known;
    const key = `${this.identity(node)}\u0000${p}`;
    if (this.resolving.has(key)) return MISSING;
    this.resolving.add(key);
    let value: Value;
    try {
      const won = this.won(node, p);
      value = this.resolve(node, p, won.text);
      if (won.marks.length > 0) value = { ...value, key: `${won.marks.join(",")};${value.key}`, doubt: won.doubt };
    } finally {
      this.resolving.delete(key);
    }
    let map = this.values.get(node);
    if (map === undefined) this.values.set(node, (map = new Map()));
    map.set(p, value);
    return value;
  }

  /// Il valore di `p` che `node` riceve dal genitore.
  private parentValue(node: CascadeNode, p: string): Value {
    if (node.parent === null) return this.initial(p);
    return { ...this.value(node.parent, p), own: false };
  }

  /// Il valore iniziale di `p`.
  private initial(p: string): Value {
    if (p.startsWith("--")) return MISSING;
    if (p === "font-size") return { key: "16", text: "16px", attr: true, own: true, doubt: null, number: 16 };
    if (p === "font-weight") return { key: "400", text: "normal", attr: true, own: true, doubt: null, number: 400 };
    const text = INITIAL[p];
    if (text === undefined) return { key: "initial", text: "initial", attr: false, own: true, doubt: null, number: null };
    return { key: normal(text), text, attr: true, own: true, doubt: null, number: null };
  }

  /// Il valore di `p` su `node` per il testo `text` che ha vinto.
  private resolve(node: CascadeNode, p: string, written: string | null): Value {
    if (written === null) return inherits(p) ? this.parentValue(node, p) : this.initial(p);
    let text = written;
    // Una proprietà da un `font` con variabili: si sostituiscono, poi si
    // scioglie.
    let shorthand: string | null = null;
    if (text.startsWith("\u0000")) {
      const end = text.indexOf("\u0000", 1);
      shorthand = text.slice(1, end);
      text = text.slice(end + 1);
    }
    if (hasVar(text) && !p.startsWith("--")) {
      const substituted = this.substitute(node, text);
      if (substituted === null) return inherits(p) ? this.parentValue(node, p) : this.initial(p);
      text = substituted;
    }
    if (shorthand === "font") {
      const expanded = expandFont(text)?.get(p);
      if (expanded === undefined) return inherits(p) ? this.parentValue(node, p) : this.initial(p);
      text = expanded;
    }
    if (p.startsWith("--")) return this.custom(node, text);
    const keyword = text.trim().toLowerCase();
    switch (keyword) {
      case "inherit":
        return this.parentValue(node, p);
      case "initial":
        return this.initial(p);
      case "unset":
      case "revert":
        return inherits(p) ? this.parentValue(node, p) : this.initial(p);
      case "revert-layer":
        return { key: `revert-layer#${doubts++}`, text: null, attr: false, own: true, doubt: null, number: null };
    }
    if (keyword.startsWith("-fub-system(")) return { key: keyword, text: null, attr: false, own: true, doubt: null, number: null };
    if (p === "font-size") return this.fontSize(node, text);
    if (p === "font-weight") return this.fontWeight(node, text);
    if (p === "color" && keyword === "currentcolor") return this.parentValue(node, "color");
    return this.relative(node, p, text.trim());
  }

  /// Un valore che può dipendere dal colore o dalla dimensione del
  /// carattere, risolto.
  private relative(node: CascadeNode, p: string, text: string): Value {
    let written: string | null = text;
    let suffix = "";
    if (/currentcolor/i.test(text)) {
      const color = p === "color" ? this.parentValue(node, "color") : this.value(node, "color");
      if (color.text !== null && color.attr) written = text.replace(/currentcolor/gi, color.text);
      else {
        written = null;
        suffix += `|c=${color.key}`;
      }
    }
    if (written !== null && /\d(?:r?em|ex|ch|cap|ic|r?lh)\b/i.test(written)) {
      const size = this.value(node, "font-size");
      const root = this.value(this.root, "font-size");
      let unknown = false;
      written = written.replace(/([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(r?em|ex|ch|cap|ic|r?lh)\b/gi, (whole, n: string, unit: string) => {
        const base = unit.toLowerCase() === "em" ? size.number : unit.toLowerCase() === "rem" ? root.number : null;
        if (base === null) {
          unknown = true;
          return whole;
        }
        return `${formatNumber(Number(n) * base, PLACES)}px`;
      });
      if (unknown) {
        suffix += `|fs=${size.key}`;
        written = null;
      }
    }
    const key = normal(written ?? text) + suffix;
    return { key, text: written, attr: written !== null && !styleOnly(written), own: true, doubt: null, number: null };
  }

  /// Una variabile, coi `var()` che contiene già sostituiti.
  private custom(node: CascadeNode, text: string): Value {
    const substituted = hasVar(text) ? this.substitute(node, text) : text;
    if (substituted === null) return MISSING;
    return { key: substituted.trim().replace(/\s+/g, " "), text: substituted, attr: false, own: true, doubt: null, number: null };
  }

  /// `text` coi `var()` sostituiti dalle variabili di `node`; `null` se una
  /// manca e non ha un'alternativa.
  private substitute(node: CascadeNode, text: string): string | null {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const at = text.toLowerCase().indexOf("var(", i);
      if (at < 0) break;
      out += text.slice(i, at);
      let depth = 0;
      let end = at + 3;
      for (; end < text.length; end++) {
        if (text[end] === "(") depth++;
        else if (text[end] === ")" && --depth === 0) break;
      }
      const inner = text.slice(at + 4, end);
      const comma = topComma(inner);
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      const variable = name.startsWith("--") ? this.value(node, name) : MISSING;
      if (variable.text !== null) out += variable.text;
      else if (comma >= 0) {
        const fallback = inner.slice(comma + 1);
        const resolved = hasVar(fallback) ? this.substitute(node, fallback) : fallback;
        if (resolved === null) return null;
        out += resolved;
      } else return null;
      i = end + 1;
    }
    return out + text.slice(i);
  }

  /// La dimensione del carattere in pixel, quando si sa.
  private fontSize(node: CascadeNode, text: string): Value {
    const t = text.trim().toLowerCase();
    const parent = this.parentValue(node, "font-size");
    const sized = (px: number): Value => ({ key: canonical(px), text: `${formatNumber(px, PLACES)}px`, attr: true, own: true, doubt: null, number: px });
    const keyword = FONT_SIZES.get(t);
    if (keyword !== undefined) return sized(keyword);
    if ((t === "larger" || t === "smaller") && parent.number !== null) return sized(t === "larger" ? parent.number * 1.2 : parent.number / 1.2);
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/.exec(t);
    if (match !== null) {
      const n = Number(match[1]);
      const unit = match[2]!;
      const scale = ABSOLUTE.get(unit);
      if (scale !== undefined) return sized(n * scale);
      if ((unit === "em" || unit === "%") && parent.number !== null) return sized((parent.number * n) / (unit === "%" ? 100 : 1));
      if (unit === "rem") {
        const root = node === this.root ? 16 : this.value(this.root, "font-size").number;
        if (root !== null) return sized(root * n);
      }
    }
    return { key: `${normal(text)}|p=${parent.key}`, text: null, attr: false, own: true, doubt: null, number: null };
  }

  /// Il peso del carattere come numero.
  private fontWeight(node: CascadeNode, text: string): Value {
    const t = text.trim().toLowerCase();
    let n: number | null = null;
    if (t === "normal") n = 400;
    else if (t === "bold") n = 700;
    else if (/^\d+(?:\.\d+)?$/.test(t)) n = Number(t);
    else if (t === "bolder" || t === "lighter") {
      const parent = this.parentValue(node, "font-weight").number;
      if (parent !== null) {
        if (t === "bolder") n = parent < 350 ? 400 : parent < 550 ? 700 : Math.max(parent, 900);
        else n = parent < 100 ? parent : parent < 550 ? 100 : parent < 750 ? 400 : 700;
      }
    }
    if (n === null) return { key: `${normal(text)}|p=${this.parentValue(node, "font-weight").key}`, text: null, attr: false, own: true, doubt: null, number: null };
    return { key: canonical(n), text: n === 400 ? "normal" : n === 700 ? "bold" : String(n), attr: true, own: true, doubt: null, number: n };
  }

  // -------------------------------------------------------------------------
  // Trasformazioni e opacità.
  // -------------------------------------------------------------------------

  /// La trasformazione di `node`, da sola: la matrice, o `null` se non si sa
  /// calcolare, e come è scritta.
  own(node: CascadeNode): { readonly m: Matrix | null; readonly text: string; readonly css: boolean } {
    if (!isSvg(node)) return { m: IDENTITY, text: "", css: false };
    const won = this.won(node, "transform");
    let m: Matrix | null = IDENTITY;
    let text = won.text ?? "";
    const css = won.from === "rule" || won.from === "inline";
    if (won.marks.length > 0) m = null;
    else if (won.from === "attr") m = svgTransform(text) ?? IDENTITY;
    else if (css) {
      if (hasVar(text)) text = this.substitute(node, text) ?? "none";
      const keyword = text.trim().toLowerCase();
      m = keyword === "initial" || keyword === "unset" || keyword === "revert" ? IDENTITY : keyword === "inherit" || keyword === "revert-layer" ? null : cssTransform(text);
    }
    // Un'origine o un riquadro che non sono quelli di SVG spostano il punto
    // fermo della trasformazione, e non si sanno calcolare.
    if (m !== null && !same(m, IDENTITY)) {
      const origin = this.declared.has("transform-origin") ? this.won(node, "transform-origin").text : null;
      const box = this.declared.has("transform-box") ? this.won(node, "transform-box").text : null;
      if (origin !== null && !/^\s*(?:0(?:px)?\s+0(?:px)?|left\s+top|top\s+left)\s*$/i.test(origin)) m = null;
      if (box !== null && !/^\s*view-box\s*$/i.test(box)) m = null;
    }
    for (const name of ["translate", "rotate", "scale"]) {
      if (!this.declared.has(name)) continue;
      const other = this.won(node, name).text;
      if (other !== null && !/^\s*(?:none|initial|unset|revert)\s*$/i.test(other)) m = null;
    }
    return { m, text, css };
  }

  /// La trasformazione accumulata dalla radice fino a `node` compreso.
  world(node: CascadeNode): World {
    const known = this.worlds.get(node);
    if (known !== undefined) return known;
    const chain: CascadeNode[] = [];
    for (let at: CascadeNode | null = node; at !== null && !this.worlds.has(at); at = at.parent) chain.push(at);
    let out: World = { m: IDENTITY, sym: "" };
    for (let k = chain.length - 1; k >= 0; k--) {
      const at = chain[k]!;
      const parent = at.parent === null ? { m: IDENTITY, sym: "" } : this.worlds.get(at.parent)!;
      const own = this.own(at);
      out = own.m !== null ? { m: compose(parent.m, own.m), sym: parent.sym } : { m: IDENTITY, sym: `${parent.sym}|${parent.m.map(canonical).join(" ")}*${this.identity(at)}:${normal(own.text)}` };
      this.worlds.set(at, out);
    }
    return out;
  }

  /// L'opacità di `node` da solo: il numero, o `null` se non si sa.
  opacity(node: CascadeNode): number | null {
    const value = this.value(node, "opacity");
    if (value.text === null || value.doubt !== null) return null;
    return readOpacity(value.text);
  }

  /// L'opacità accumulata dalla radice fino a `node` compreso.
  alpha(node: CascadeNode): Alpha {
    const known = this.alphas.get(node);
    if (known !== undefined) return known;
    const chain: CascadeNode[] = [];
    for (let at: CascadeNode | null = node; at !== null && !this.alphas.has(at); at = at.parent) chain.push(at);
    let out: Alpha = { a: 1, sym: "" };
    for (let k = chain.length - 1; k >= 0; k--) {
      const at = chain[k]!;
      const parent = at.parent === null ? { a: 1, sym: "" } : this.alphas.get(at.parent)!;
      const own = this.opacity(at);
      out = own !== null ? { a: parent.a * own, sym: parent.sym } : { a: 1, sym: `${parent.sym}|${canonical(parent.a)}*${this.identity(at)}:${this.value(at, "opacity").key}` };
      this.alphas.set(at, out);
    }
    return out;
  }
}

/// La prima virgola di `text` fuori dalle parentesi; -1 se non c'è.
function topComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}

/// Vero se due matrici si vedono uguali: lo scarto di chi scrive i numeri con
/// quattro decimali non conta.
export function same(a: Matrix, b: Matrix): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= 1e-3 + 1e-6 * Math.max(Math.abs(v), Math.abs(b[i]!)));
}

/// Vero se due trasformazioni accumulate si vedono uguali.
export function sameWorld(a: World, b: World): boolean {
  return a.sym === b.sym && same(a.m, b.m);
}

/// Vero se due opacità accumulate si vedono uguali.
export function sameAlpha(a: Alpha, b: Alpha): boolean {
  return a.sym === b.sym && Math.abs(a.a - b.a) <= 1e-3;
}
