// Quando un elemento si vede com'era: il confronto di «Rendi modificabile»
// fra lo stile di prima, calcolato con tutti i fogli del disegno, e quello di
// dopo, proprietà per proprietà. Due valori scritti in modo diverso possono
// disegnare la stessa cosa, e allora contano uguali:
//
// - **Colore e opacità insieme:** il riempimento e il contorno si confrontano
//   come colore per opacità; trasparenza zero è come `none`.
// - **Ciò che non si vede non conta:** i dettagli del contorno senza contorno,
//   le punte di una figura chiusa senza tratteggio, i giunti di un cerchio, la
//   regola di riempimento di un rettangolo, l'ordine di riempimento e
//   contorno quando se ne vede uno solo.
// - **Il limite dei giunti a spigolo:** due limiti diversi disegnano uguale se
//   ogni giunto della forma resta a spigolo, o smussato, con tutti e due.
// - **La regola di riempimento:** `evenodd` e `nonzero` riempiono uguale una
//   forma i cui sottotracciati non si incrociano e girano a versi alterni,
//   dal più esterno al più interno.
// - **I valori iniziali:** una proprietà scritta col suo valore iniziale è
//   come una non scritta; `normal` e `0` sono la stessa spaziatura.
// - **Il testo SVG senza riquadro:** l'interlinea e l'allineamento valgono
//   solo per un testo che va a capo da sé, e lo spazio bianco solo dove il
//   testo ne ha di ambiguo.

import { parsePath, flatten, type Segment } from "../scene/geometry";
import { tangentAt, type Curve } from "../scene/curves";
import { IDENTITY, type Matrix, type Point } from "../scene/matrix";
import { numberList, points as parsePoints } from "../scene/values";
import { Cascade, normal, readOpacity, renders, same, type CascadeNode, type Doubt, type Value } from "./cascade";
import { parseCssColor, type Rgba } from "./css-color";

/// Un colore come lo disegna un browser: niente, un colore, o una risorsa.
export type Paint =
  | { readonly kind: "none" }
  | { readonly kind: "color"; readonly color: Rgba }
  | { readonly kind: "url"; readonly id: string; readonly fallback: string | null };

/// Il colore scritto in `text`, già risolto dalla cascata; `null` se non si
/// legge, come `context-fill` o un colore di sistema.
export function paintOf(text: string): Paint | null {
  const value = text.trim();
  if (value.toLowerCase() === "none") return { kind: "none" };
  const url = /^url\(\s*(["']?)#([^"')]+)\1\s*\)\s*(.*)$/is.exec(value);
  if (url !== null) return { kind: "url", id: url[2]!.trim(), fallback: url[3]!.trim() === "" ? null : url[3]!.trim() };
  const color = parseCssColor(value);
  return color === null ? null : { kind: "color", color };
}

/// Ciò che si sa della forma di un elemento, per le equivalenze che
/// dipendono dalla geometria. Si calcola da chi lo chiede, una volta.
export interface ShapeFacts {
  /// Vero se un tratto della forma ha le punte scoperte: un sottotracciato
  /// aperto, o lungo zero.
  readonly open: boolean | null;
  /// Il rapporto fra la lunghezza dello spigolo e lo spessore di ogni
  /// giunto, `1 / sin(θ/2)`; `null` se non si sa.
  readonly miters: readonly number[] | null;
  /// Vero se `evenodd` e `nonzero` la riempiono uguale.
  readonly evenOddSafe: boolean | null;
  /// Vero se il testo che contiene ha spazi che `white-space` tratterebbe
  /// in modi diversi; `null` se non è un testo.
  readonly ambiguousSpace: boolean | null;
  /// Vero se è un testo che va a capo da sé (`inline-size`, `shape-inside`).
  readonly wraps: boolean;
  /// La finestra su cui si misurano le percentuali, larga e alta; `null` se
  /// non si sa.
  readonly viewport: readonly [number, number] | null;
}

/// Una differenza: la proprietà e il valore di prima, com'è scritto.
export interface Difference {
  readonly property: string;
  readonly value: string;
  readonly doubt: Doubt | null;
}

/// Un elemento con la cascata che lo calcola.
export interface Side {
  readonly cascade: Cascade;
  readonly node: CascadeNode;
}

/// Le proprietà dei caratteri, tutte da confrontare dove si scrive testo.
const TEXT_PROPERTIES: readonly string[] = [
  "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-variant-caps", "font-variant-ligatures",
  "font-variant-numeric", "font-variant-east-asian", "font-variant-alternates", "font-variant-position", "font-stretch",
  "font-kerning", "font-feature-settings", "font-variation-settings", "font-optical-sizing", "font-size-adjust", "font-synthesis",
  "letter-spacing", "word-spacing", "text-anchor", "text-decoration", "text-transform", "text-shadow", "text-rendering",
  "writing-mode", "direction", "unicode-bidi", "dominant-baseline", "alignment-baseline", "baseline-shift", "white-space",
  "line-height", "text-align", "text-align-last", "text-indent", "text-orientation", "glyph-orientation-vertical",
  "glyph-orientation-horizontal", "-webkit-text-stroke-width", "-webkit-text-stroke-color", "-webkit-text-fill-color", "kerning",
];

/// Le chiavi che valgono come il valore iniziale, oltre a quella di
/// `initial`.
const INITIAL_KEYS: ReadonlyMap<string, readonly string[]> = new Map([
  ["display", ["inline", "block", "inline-block", "contents", "flex", "grid", "table", "list-item", "run-in", "flow-root"]],
  ["visibility", ["visible"]],
  ["opacity", ["1"]],
  ["fill-rule", ["nonzero"]],
  ["clip-rule", ["nonzero"]],
  ["stroke-dashoffset", ["0"]],
  ["paint-order", ["normal", "fill", "fill stroke", "fill stroke markers"]],
  ["marker-start", ["none"]],
  ["marker-mid", ["none"]],
  ["marker-end", ["none"]],
  ["clip-path", ["none"]],
  ["mask", ["none"]],
  ["filter", ["none"]],
  ["mix-blend-mode", ["normal"]],
  ["isolation", ["auto"]],
  ["vector-effect", ["none"]],
  ["shape-rendering", ["auto", "geometricprecision"]],
  ["image-rendering", ["auto", "optimizequality"]],
  ["font-style", ["normal"]],
  ["font-variant", ["normal"]],
  ["font-variant-caps", ["normal"]],
  ["font-variant-ligatures", ["normal"]],
  ["font-variant-numeric", ["normal"]],
  ["font-variant-east-asian", ["normal"]],
  ["font-variant-alternates", ["normal"]],
  ["font-variant-position", ["normal"]],
  ["font-stretch", ["normal", "100%"]],
  ["font-kerning", ["auto"]],
  ["font-feature-settings", ["normal"]],
  ["font-variation-settings", ["normal"]],
  ["font-optical-sizing", ["auto"]],
  ["font-size-adjust", ["none"]],
  ["font-synthesis", ["weight style", "style weight", "weight style small-caps", "weight small-caps style", "style weight small-caps", "style small-caps weight", "small-caps weight style", "small-caps style weight"]],
  ["letter-spacing", ["normal", "0"]],
  ["word-spacing", ["normal", "0"]],
  ["text-anchor", ["start"]],
  ["text-decoration", ["none"]],
  ["text-transform", ["none"]],
  ["text-shadow", ["none"]],
  ["text-rendering", ["auto"]],
  ["writing-mode", ["horizontal-tb", "lr", "lr-tb", "rl", "rl-tb"]],
  ["direction", ["ltr"]],
  ["unicode-bidi", ["normal"]],
  ["dominant-baseline", ["auto"]],
  ["alignment-baseline", ["auto", "baseline"]],
  ["baseline-shift", ["0", "baseline"]],
  ["white-space", ["normal"]],
  ["text-orientation", ["mixed"]],
  ["glyph-orientation-vertical", ["auto"]],
  ["glyph-orientation-horizontal", ["0deg", "0"]],
  ["-webkit-text-stroke-width", ["0"]],
  ["kerning", ["auto"]],
  ["color-interpolation", ["srgb", "auto"]],
  ["color-rendering", ["auto"]],
]);

/// Vero se `value` vale come il valore iniziale di `p`.
function initial(p: string, value: Value): boolean {
  if (value.doubt !== null) return false;
  const key = value.key;
  if (key === "initial") return true;
  return INITIAL_KEYS.get(p)?.includes(key) ?? false;
}

/// Vero se due valori di `p` si vedono uguali per la chiave, o perché
/// tutti e due valgono come l'iniziale.
function sameKey(p: string, a: Value, b: Value): boolean {
  if (a.doubt !== null || b.doubt !== null) return false;
  return a.key === b.key || (initial(p, a) && initial(p, b));
}

/// Il numero di una lunghezza in pixel scritta dalla cascata; `null` se non
/// lo è.
export function pixelsOf(text: string | null): number | null {
  if (text === null) return null;
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc)?\s*$/i.exec(text);
  if (match === null) return null;
  const scale: Record<string, number> = { "": 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
  return Number(match[1]) * scale[(match[2] ?? "").toLowerCase()]!;
}

/// Le proprietà della geometria, che si confrontano come lunghezze.
const GEOMETRY: readonly string[] = ["x", "y", "width", "height", "cx", "cy", "r", "rx", "ry"];

/// Su che cosa si misura una percentuale di `p` nella finestra `viewport`:
/// la larghezza, l'altezza, o la diagonale normalizzata `√((w² + h²) / 2)`.
export function percentBase(p: string, viewport: readonly [number, number] | null): number | null {
  if (viewport === null) return null;
  const [w, h] = viewport;
  if (p === "x" || p === "cx" || p === "x1" || p === "x2" || p === "width" || p === "rx" || p === "dx") return w;
  if (p === "y" || p === "cy" || p === "y1" || p === "y2" || p === "height" || p === "ry" || p === "dy") return h;
  return Math.sqrt((w * w + h * h) / 2);
}

/// Una lunghezza di `p` in pixel, anche in percentuale della finestra.
export function lengthOf(p: string, text: string | null, viewport: readonly [number, number] | null): number | null {
  if (text === null) return null;
  const percent = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)%\s*$/i.exec(text);
  if (percent === null) return pixelsOf(text);
  const base = percentBase(p, viewport);
  return base === null ? null : (Number(percent[1]) * base) / 100;
}

/// Vero se due misure in pixel si vedono uguali: lo scarto di un numero
/// scritto con quattro decimali non conta.
const closeLength = (a: number, b: number): boolean => Math.abs(a - b) <= 5e-4 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));

/// Il tratteggio come lista di lunghezze in pixel, ripetuta se dispari;
/// vuota per un contorno pieno; `null` se non si legge. Le percentuali si
/// misurano su `viewport`.
export function dashesOf(text: string | null, viewport: readonly [number, number] | null = null): number[] | null {
  if (text === null) return null;
  const value = text.trim().toLowerCase();
  if (value === "none" || value === "") return [];
  const parts = value.split(/[\s,]+/).filter((part) => part !== "");
  const out: number[] = [];
  for (const part of parts) {
    const n = lengthOf("stroke-dasharray", part, viewport);
    if (n === null || n < 0) return null;
    out.push(n);
  }
  if (out.every((n) => n === 0)) return [];
  return out.length % 2 === 0 ? out : [...out, ...out];
}

/// Il colore effettivo di un riempimento o di un contorno: il colore, la sua
/// trasparenza moltiplicata per l'opacità, e la chiave della risorsa.
interface Effective {
  readonly visible: boolean;
  readonly key: string;
}

function effective(paint: Value, opacity: Value): Effective | null {
  if (paint.doubt !== null || opacity.doubt !== null || paint.text === null || opacity.text === null) return null;
  const parsed = paintOf(paint.text);
  const alpha = readOpacity(opacity.text);
  if (parsed === null || alpha === null) return null;
  if (parsed.kind === "none") return { visible: false, key: "none" };
  if (parsed.kind === "url") return alpha === 0 ? { visible: false, key: "none" } : { visible: true, key: `url(${parsed.id})|${parsed.fallback ?? ""}|${Math.round(alpha * 1000)}` };
  const a = parsed.color.a * alpha;
  if (a <= 0.5 / 255) return { visible: false, key: "none" };
  const channel = (n: number): number => Math.round(Math.max(0, Math.min(255, n)));
  return { visible: true, key: `${channel(parsed.color.r)},${channel(parsed.color.g)},${channel(parsed.color.b)}|${Math.round(a * 255)}` };
}

/// L'ordine in cui si dipingono gli strati che si vedono.
function paintOrder(value: Value, fill: boolean, stroke: boolean, markers: boolean): string | null {
  if (value.doubt !== null || value.text === null) return null;
  const words = value.text.trim().toLowerCase().split(/\s+/);
  const order: string[] = words[0] === "normal" ? [] : words.filter((word) => word === "fill" || word === "stroke" || word === "markers");
  for (const layer of ["fill", "stroke", "markers"]) if (!order.includes(layer)) order.push(layer);
  return order.filter((layer) => (layer === "fill" ? fill : layer === "stroke" ? stroke : markers)).join(" ");
}

/// Vero se il limite `limit` lascia a spigolo il giunto di rapporto `ratio`.
const mitered = (ratio: number, limit: number): boolean => ratio <= limit;

/// La prima proprietà di `props` che si vede diversa fra `was` e `now`, con i
/// fatti `shape` della forma; `null` se si vedono uguali. Si guardano solo le
/// proprietà che si vedono sull'elemento di prima. Due valori con la stessa
/// chiave sono uguali anche se dipendono da una condizione: la stessa regola
/// li dà a tutti e due. Le proprietà in `skip` non si guardano: chi chiama le
/// ha già confrontate a modo suo, come la finestra di un `svg` che diventa la
/// trasformazione e il ritaglio di un gruppo.
export function difference(was: Side, now: Side, props: ReadonlySet<string>, shape: () => ShapeFacts, skip: ReadonlySet<string> = NOTHING): Difference | null {
  const b = (p: string): Value => was.cascade.value(was.node, p);
  const a = (p: string): Value => now.cascade.value(now.node, p);
  const eq = (...ps: string[]): boolean => ps.every((p) => b(p).key === a(p).key);
  const node = was.node;
  const shows = (p: string): boolean => !skip.has(p) && renders(node, p);
  const differ = (p: string): Difference => {
    const value = b(p);
    return { property: p, value: value.text ?? value.key, doubt: value.doubt ?? a(p).doubt };
  };
  let facts: ShapeFacts | null = null;
  const facts$ = (): ShapeFacts => (facts ??= shape());
  /// Vero se `p` si vede uguale per la chiave o perché vale l'iniziale.
  const alike = (p: string): boolean => eq(p) || sameKey(p, b(p), a(p));

  // Ciò che non si disegna non ha altro da confrontare.
  if (shows("display") && !eq("display")) {
    const vb = b("display");
    const va = a("display");
    if (vb.doubt !== null || va.doubt !== null || (vb.key === "none") !== (va.key === "none")) return differ("display");
  }
  if (b("display").key === "none" && b("display").doubt === null) return null;
  // L'opacità e la trasformazione dell'elemento da solo.
  if (!eq("opacity")) {
    const ob = was.cascade.opacity(was.node);
    const oa = now.cascade.opacity(now.node);
    if (ob === null || oa === null || Math.abs(ob - oa) > 5e-5) return differ("opacity");
  }
  // Le stesse dichiarazioni danno la stessa trasformazione, salvo la
  // finestra di un `svg` dentro il disegno, che vi si aggiunge.
  const ownBefore = was.cascade.own(was.node);
  const ownAfter = now.cascade.own(now.node);
  const declared = ownBefore.css === ownAfter.css && eq("transform", "transform-origin", "transform-box", "translate", "rotate", "scale");
  const moved = ownBefore.m !== null && ownAfter.m !== null ? !same(ownBefore.m, ownAfter.m) : !declared;
  if (moved) return { property: "transform", value: ownBefore.text, doubt: b("transform").doubt };
  for (const p of ["clip-path", "mask", "filter", "mix-blend-mode", "isolation"]) {
    if (shows(p) && !alike(p)) return differ(p);
  }
  if (shows("visibility")) {
    const vb = b("visibility");
    const va = a("visibility");
    const invisible = (value: Value): boolean => value.key === "hidden" || value.key === "collapse";
    if (!eq("visibility") && (vb.doubt !== null || va.doubt !== null || invisible(vb) !== invisible(va))) return differ("visibility");
    if (invisible(vb) && vb.doubt === null && node.children.length === 0) return null;
  }

  // Riempimento e contorno. Uno strato che non si sa se si vede conta come
  // visibile.
  let fillShown = false;
  let strokeShown = false;
  if (shows("fill")) {
    const before = effective(b("fill"), b("fill-opacity"));
    if (!eq("fill", "fill-opacity")) {
      const after = effective(a("fill"), a("fill-opacity"));
      if (before === null || after === null || before.key !== after.key) return differ(before !== null && after !== null && before.key === "none" ? "fill-opacity" : "fill");
    }
    fillShown = before?.visible ?? true;
  }
  if (shows("stroke")) {
    const before = effective(b("stroke"), b("stroke-opacity"));
    if (!eq("stroke", "stroke-opacity")) {
      const after = effective(a("stroke"), a("stroke-opacity"));
      if (before === null || after === null || before.key !== after.key) return differ("stroke");
    }
    strokeShown = before?.visible ?? true;
  }
  for (const [color, alpha] of [["stop-color", "stop-opacity"], ["flood-color", "flood-opacity"]] as const) {
    if (!shows(color) || eq(color, alpha)) continue;
    const before = effective(b(color), b(alpha));
    const after = effective(a(color), a(alpha));
    if (before === null || after === null || before.key !== after.key) return differ(color);
  }
  if (fillShown && shows("fill-rule") && !alike("fill-rule") && facts$().evenOddSafe !== true) return differ("fill-rule");
  const viewport = (): readonly [number, number] | null => facts$().viewport;
  const length = (side: (p: string) => Value, p: string): number | null => (side(p).doubt === null ? lengthOf(p, side(p).text, viewport()) : null);
  if (strokeShown) {
    const width = length(b, "stroke-width");
    if (!eq("stroke-width")) {
      const after = length(a, "stroke-width");
      if (width === null || after === null || !closeLength(width, after)) return differ("stroke-width");
    }
    if (width === null || width > 0) {
      const dashes = dashesOf(b("stroke-dasharray").doubt === null ? b("stroke-dasharray").text : null, viewport());
      if (!eq("stroke-dasharray")) {
        const after = dashesOf(a("stroke-dasharray").doubt === null ? a("stroke-dasharray").text : null, viewport());
        if (dashes === null || after === null || dashes.length !== after.length || dashes.some((n, i) => !closeLength(n, after[i]!))) return differ("stroke-dasharray");
      }
      const dashed = dashes === null || dashes.length > 0;
      if (dashed && !eq("stroke-dashoffset")) {
        const ob = length(b, "stroke-dashoffset");
        const oa = length(a, "stroke-dashoffset");
        if (ob === null || oa === null || !closeLength(ob, oa)) return differ("stroke-dashoffset");
      }
      if (!alike("stroke-linecap") && (dashed || facts$().open !== false)) return differ("stroke-linecap");
      const miters = facts$().miters;
      if (miters === null || miters.length > 0) {
        if (!alike("stroke-linejoin")) return differ("stroke-linejoin");
        const join = b("stroke-linejoin");
        if ((join.doubt !== null || /^miter/.test(join.key)) && !eq("stroke-miterlimit")) {
          const lb = b("stroke-miterlimit").doubt === null ? Number(b("stroke-miterlimit").key) : NaN;
          const la = a("stroke-miterlimit").doubt === null ? Number(a("stroke-miterlimit").key) : NaN;
          if (!Number.isFinite(lb) || !Number.isFinite(la)) return differ("stroke-miterlimit");
          if (lb !== la && (miters === null || miters.some((ratio) => Math.abs(ratio - lb) < 1e-6 || Math.abs(ratio - la) < 1e-6 || mitered(ratio, lb) !== mitered(ratio, la)))) {
            return differ("stroke-miterlimit");
          }
        }
      }
      if (shows("vector-effect") && !alike("vector-effect")) return differ("vector-effect");
    }
  }
  const markers = ["marker-start", "marker-mid", "marker-end"].filter(shows);
  for (const p of markers) if (!alike(p)) return differ(p);
  const marked = markers.some((p) => !initial(p, b(p)));
  if (shows("paint-order") && !eq("paint-order") && [fillShown, strokeShown, marked].filter(Boolean).length > 1) {
    const ob = paintOrder(b("paint-order"), fillShown, strokeShown, marked);
    const oa = paintOrder(a("paint-order"), fillShown, strokeShown, marked);
    if (ob === null || oa === null || ob !== oa) return differ("paint-order");
  }
  if (shows("shape-rendering") && !alike("shape-rendering")) return differ("shape-rendering");
  for (const p of GEOMETRY) {
    if (!shows(p) || eq(p)) continue;
    const lb = length(b, p);
    const la = length(a, p);
    if (lb === null || la === null || !closeLength(lb, la)) return differ(p);
  }

  // Il testo.
  if (shows("font-family")) {
    for (const p of TEXT_PROPERTIES) {
      if (!shows(p) || alike(p)) continue;
      const vb = b(p);
      const va = a(p);
      if (vb.doubt === null && va.doubt === null) {
        if (p === "font-size" || p === "letter-spacing" || p === "word-spacing" || p === "baseline-shift") {
          const nb = initial(p, vb) ? 0 : pixelsOf(vb.text);
          const na = initial(p, va) ? 0 : pixelsOf(va.text);
          if (nb !== null && na !== null && closeLength(nb, na)) continue;
        }
        if (p === "font-weight" && vb.number !== null && vb.number === va.number) continue;
      }
      if ((p === "line-height" || p === "text-align" || p === "text-align-last" || p === "text-indent") && !facts$().wraps) continue;
      if (p === "white-space" && facts$().ambiguousSpace === false) continue;
      return differ(p);
    }
  }

  // Ogni altra proprietà che si vede, per chiave.
  for (const p of props) {
    if (CHECKED.has(p) || !shows(p) || p.startsWith("--")) continue;
    if (!alike(p)) return differ(p);
  }
  return null;
}

const NOTHING: ReadonlySet<string> = new Set();

/// Le proprietà che `difference` confronta da sé, coi loro casi.
const CHECKED: ReadonlySet<string> = new Set([
  "display", "opacity", "transform", "transform-origin", "transform-box", "translate", "rotate", "scale", "clip-path", "mask", "filter",
  "mix-blend-mode", "isolation", "visibility", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity", "stroke-width",
  "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "vector-effect", "marker-start",
  "marker-mid", "marker-end", "marker", "paint-order", "shape-rendering", "color", "font", "all", ...TEXT_PROPERTIES, ...GEOMETRY,
  // Le proprietà che non cambiano il disegno di una forma o di un testo.
  "stop-color", "stop-opacity", "flood-color", "flood-opacity",
  "color-interpolation", "color-rendering", "inline-size", "shape-inside", "shape-padding", "shape-subtract", "shape-margin",
]);

// ---------------------------------------------------------------------------
// La geometria.
// ---------------------------------------------------------------------------

/// I segmenti di una forma dai suoi attributi; `null` se non si leggono o
/// se non è una forma.
export function segmentsOf(local: string, attr: (name: string) => string | null): Segment[] | null {
  switch (local) {
    case "path":
      return parsePath(attr("d") ?? "");
    case "polyline":
    case "polygon": {
      const pts = parsePoints(attr("points") ?? "");
      if (pts === null || pts.length === 0) return null;
      const out: Segment[] = [{ kind: "move", to: pts[0]! }];
      for (const p of pts.slice(1)) out.push({ kind: "line", to: p });
      if (local === "polygon") out.push({ kind: "close" });
      return out;
    }
    default:
      return null;
  }
}

/// I fatti della geometria di una forma `local` con gli attributi `attr`.
export function shapeFacts(local: string, attr: (name: string) => string | null): Pick<ShapeFacts, "open" | "miters" | "evenOddSafe"> {
  switch (local) {
    case "circle":
    case "ellipse":
      return { open: false, miters: [], evenOddSafe: true };
    case "line":
      return { open: true, miters: [], evenOddSafe: true };
    case "rect": {
      const rounded = (numberList(attr("rx") ?? "0")?.[0] ?? 0) > 0 || (numberList(attr("ry") ?? "0")?.[0] ?? 0) > 0;
      return { open: false, miters: rounded ? [] : [Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2], evenOddSafe: true };
    }
  }
  const segments = segmentsOf(local, attr);
  if (segments === null) return { open: null, miters: null, evenOddSafe: null };
  const joins = joinsOf(segments);
  return { open: joins.open, miters: joins.miters, evenOddSafe: evenOddSafe(segments) };
}

/// I giunti dei sottotracciati di `segments`, e se uno è aperto.
function joinsOf(segments: readonly Segment[]): { open: boolean; miters: number[] } {
  const miters: number[] = [];
  let open = false;
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  // Le tangenti del sottotracciato in corso: la prima in uscita, l'ultima in
  // entrata, e quante curve ha.
  let first: Point | null = null;
  let last: Point | null = null;
  let curves = 0;
  let length = 0;
  const join = (into: Point, out: Point): void => {
    // L'angolo fra le due direzioni, e quello interno del giunto.
    const cos = Math.max(-1, Math.min(1, into[0] * out[0] + into[1] * out[1]));
    const interior = Math.PI - Math.acos(cos);
    const half = Math.sin(interior / 2);
    miters.push(half <= 0 ? Infinity : 1 / half);
  };
  const finish = (closed: boolean): void => {
    if (curves === 0) return;
    if (!closed) open = true;
    else if (first !== null && last !== null) join(last, first);
    if (length === 0) open = true;
  };
  for (const segment of segments) {
    if (segment.kind === "move") {
      finish(false);
      current = start = segment.to;
      first = last = null;
      curves = 0;
      length = 0;
      continue;
    }
    if (segment.kind === "close") {
      // Il lato che torna all'inizio.
      if (current[0] !== start[0] || current[1] !== start[1]) {
        const back: Curve = { kind: "line", to: start };
        const out = tangentAt(current, back, false);
        if (out !== null) {
          if (last !== null) join(last, out);
          first ??= out;
          last = out;
          length += Math.hypot(start[0] - current[0], start[1] - current[1]);
          curves++;
        }
      }
      finish(true);
      current = start;
      first = last = null;
      curves = 0;
      length = 0;
      continue;
    }
    const curve = segment as Curve;
    const out = tangentAt(current, curve, false);
    const into = tangentAt(current, curve, true);
    curves++;
    if (out !== null && into !== null) {
      if (last !== null) join(last, out);
      first ??= out;
      last = into;
      length += Math.hypot(curve.to[0] - current[0], curve.to[1] - current[1]) || 1;
    }
    // Una curva chiusa su sé stessa ha uno spigolo in mezzo che non si sa.
    if (curve.kind !== "line" && curve.kind !== "arc") {
      const bend = curve.kind === "quad" ? [curve.control] : [curve.c1, curve.c2];
      if (bend.some((p) => p[0] !== current[0] || p[1] !== current[1]) && out !== null && into !== null && out[0] * into[0] + out[1] * into[1] < -0.999) {
        miters.push(Infinity);
      }
    }
    current = curve.to;
  }
  finish(false);
  return { open, miters };
}

/// Quante coppie di lati si controllano al più per dire che una forma non
/// si incrocia.
const MAX_PAIRS = 2_000_000;

/// Vero se `evenodd` e `nonzero` riempiono uguale `segments`: i sottotracciati
/// non si toccano né si incrociano, e ognuno gira nel verso che rende pari o
/// dispari il numero di avvolgimenti come la profondità a cui sta.
export function evenOddSafe(segments: readonly Segment[]): boolean {
  const polygons = flatten(segments, IDENTITY as Matrix).map(clean).filter((polygon) => polygon.length >= 3);
  if (polygons.length === 0) return true;
  const edges = polygons.reduce((sum, polygon) => sum + polygon.length, 0);
  if (edges * edges > MAX_PAIRS * 2) return false;
  const boxes = polygons.map(boxOf);
  for (let i = 0; i < polygons.length; i++) {
    if (selfCrossing(polygons[i]!)) return false;
    for (let j = i + 1; j < polygons.length; j++) {
      if (overlap(boxes[i]!, boxes[j]!) && crossing(polygons[i]!, polygons[j]!)) return false;
    }
  }
  const signs = polygons.map((polygon) => Math.sign(area(polygon)));
  if (signs.some((sign) => sign === 0)) return false;
  for (let i = 0; i < polygons.length; i++) {
    const probe = polygons[i]![0]!;
    let depth = 0;
    let winding = signs[i]!;
    for (let j = 0; j < polygons.length; j++) {
      if (j === i || !inBox(boxes[j]!, probe)) continue;
      const inside = contains(polygons[j]!, probe);
      if (inside === null) return false;
      if (inside) {
        depth++;
        winding += signs[j]!;
      }
    }
    if (((depth + 1) % 2 === 1) !== (winding !== 0)) return false;
  }
  return true;
}

/// `polygon` senza i punti ripetuti di fila, né l'ultimo uguale al primo.
function clean(polygon: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of polygon) {
    const prev = out[out.length - 1];
    if (prev === undefined || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  while (out.length > 1 && out[0]![0] === out[out.length - 1]![0] && out[0]![1] === out[out.length - 1]![1]) out.pop();
  return out;
}

type Box = readonly [number, number, number, number];

function boxOf(polygon: readonly Point[]): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of polygon) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

const overlap = (a: Box, b: Box): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const inBox = (box: Box, [x, y]: Point): boolean => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];

/// L'area con segno di `polygon`: positiva se gira come gli assi di SVG.
function area(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i]!;
    const [x1, y1] = polygon[(i + 1) % polygon.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

const cross = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/// Vero se i segmenti `p1p2` e `q1q2` si toccano.
function touch(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (a: Point, b: Point, c: Point, d: number): boolean =>
    d === 0 && Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  return on(q1, q2, p1, d1) || on(q1, q2, p2, d2) || on(p1, p2, q1, d3) || on(p1, p2, q2, d4);
}

/// Vero se `polygon` incrocia o tocca sé stesso fuori dai lati vicini.
function selfCrossing(polygon: readonly Point[]): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i]!;
    const a2 = polygon[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (touch(a1, a2, polygon[j]!, polygon[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/// Vero se due poligoni si incrociano o si toccano.
function crossing(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) if (touch(a1, a2, b[j]!, b[(j + 1) % b.length]!)) return true;
  }
  return false;
}

/// Vero se `p` sta dentro `polygon`, falso se fuori; `null` se sta sul bordo.
function contains(polygon: readonly Point[], p: Point): boolean | null {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (cross(polygon[j]!, polygon[i]!, p) === 0 && Math.min(xi, xj) <= p[0] && p[0] <= Math.max(xi, xj) && Math.min(yi, yj) <= p[1] && p[1] <= Math.max(yi, yj)) return null;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/// Vero se un testo ha spazi che `white-space` tratterebbe in modi
/// diversi: uno spazio all'inizio o alla fine, due di fila, un a capo o una
/// tabulazione, o un nodo di soli spazi fra due elementi.
export function ambiguousSpace(texts: readonly string[]): boolean {
  if (texts.length === 0) return false;
  const joined = texts.join("\u0000");
  if (/[\t\n\r]|  |\u0000 | \u0000/.test(joined)) return true;
  return /^\s|\s$/.test(joined) || texts.some((text) => text !== "" && text.trim() === "");
}

/// La chiave di un valore scritto, come la calcola la cascata.
export const keyOf = normal;
