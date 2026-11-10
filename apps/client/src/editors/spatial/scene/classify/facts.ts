// La classificazione della scena, i fatti: il motivo, il campione e lo stile
// che una risorsa è, e i figli che ogni risorsa può avere (`../classify.ts`).

import { leading, opacity, paint, trim } from "../values";
import { isSvg, NS_FUB, NS_NONE, NS_SVG, valueOf, type ElementNode, type NodeId, type XmlDocument } from "../xml";
import { type MotifFacts, NO_RESOURCES, STYLE_GRAPHIC_POINTS, type StyleFacts, type SwatchFacts } from "./types";
import { allowedPart, tagOf } from "./attributes";

/// Il motivo del documento che è `element`, una risorsa modificabile con
/// `fub:role="swatch"`: un `pattern` con un nome `fub:name` che non è vuoto.
/// `null` se non lo è, e allora è una risorsa senza ciclo di vita.
export function motifOf(element: ElementNode): MotifFacts | null {
  if (!isSvg(element, "pattern")) return null;
  const name = valueOf(element, NS_FUB, "name");
  return name === undefined || trim(name) === "" ? null : { name };
}

/// Il campione che è `element`, una risorsa modificabile con
/// `fub:role="swatch"`; `null` se non ha la sua forma, e allora è una risorsa
/// senza ciclo di vita. Un campione è una `linearGradient` con un nome
/// `fub:name` che non è vuoto, che di SVG ha soltanto `id` e `gradientUnits`,
/// e un solo `stop`, con un `stop-color` che è un colore e senza
/// trasparenza.
export function swatchOf(doc: XmlDocument, element: ElementNode): SwatchFacts | null {
  if (!isSvg(element, "linearGradient")) return null;
  const name = valueOf(element, NS_FUB, "name");
  if (name === undefined || trim(name) === "") return null;
  if (element.attrs.some((attr) => attr.ns === NS_NONE && attr.local !== "id" && attr.local !== "gradientUnits")) return null;
  let color: string | null = null;
  for (const child of element.children) {
    const stop = doc.element(child);
    if (stop === null || !isSvg(stop, "stop")) continue;
    if (color !== null) return null;
    const value = paint(valueOf(stop, NS_NONE, "stop-color") ?? "");
    if (value === null || value === "none") return null;
    const alpha = valueOf(stop, NS_NONE, "stop-opacity");
    if (alpha !== undefined && opacity(alpha) !== 1) return null;
    color = `#${value.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  return color === null ? null : { name, color };
}

/// Il tipo di uno stile dal tag del suo prototipo: un `text` per lo stile di
/// testo, una `polyline` per quello grafico.
export function styleKindOf(tag: string): StyleFacts["kind"] | null {
  return tag === "text" ? "text" : tag === "polyline" ? "graphic" : null;
}

/// Gli attributi SVG del prototipo di uno stile di testo: il carattere e il
/// colore.
export const TEXT_STYLE: ReadonlySet<string> = new Set([
  "id",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-decoration",
  "fill",
]);

/// Gli attributi SVG del prototipo di uno stile grafico: i suoi punti e
/// l'aspetto di una spezzata, senza geometria, visibilità o ritagli.
export const GRAPHIC_STYLE: ReadonlySet<string> = new Set([
  "id",
  "points",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "marker-start",
  "marker-end",
  "opacity",
  "style",
  "filter",
]);

/// Lo stile del documento che è `element`, una risorsa modificabile con
/// `fub:role="style"` (formato della scena, stili); `null` se non ha la sua
/// forma, e allora è estraneo. Lo stile è un prototipo: un `text` o una
/// `polyline` coi punti di [`STYLE_GRAPHIC_POINTS`], con un nome `fub:name`
/// che non è vuoto, soltanto gli attributi SVG del suo tipo, un
/// `fub:leading` valido se è di testo, e per figli soltanto `title` e
/// `desc`. I valori li giudica la classificazione, come per ogni elemento.
export function styleOf(doc: XmlDocument, element: ElementNode): StyleFacts | null {
  const kind = element.ns === NS_SVG ? styleKindOf(element.local) : null;
  if (kind === null) return null;
  const name = valueOf(element, NS_FUB, "name");
  if (name === undefined || trim(name) === "") return null;
  const allowed = kind === "text" ? TEXT_STYLE : GRAPHIC_STYLE;
  if (element.attrs.some((attr) => attr.ns === NS_NONE && !allowed.has(attr.local))) return null;
  if (kind === "graphic" && valueOf(element, NS_NONE, "points") !== STYLE_GRAPHIC_POINTS) return null;
  const height = kind === "text" ? valueOf(element, NS_FUB, "leading") : undefined;
  if (height !== undefined && leading(height) === null) return null;
  return element.children.every((child) => blankOrMeta(doc, child) === true) ? { name, kind } : null;
}

/// Vero se un nodo è spazio, `title` o `desc` ammessi: i figli che ogni
/// risorsa può avere.
export function blankOrMeta(doc: XmlDocument, child: NodeId): boolean | null {
  const node = doc.nodes[child]!;
  if (node.kind === "text") return node.blank;
  if (node.kind !== "element") return false;
  const tag = tagOf(node);
  return tag === "title" || tag === "desc" ? allowedPart(doc, child, false, NO_RESOURCES) : null;
}
