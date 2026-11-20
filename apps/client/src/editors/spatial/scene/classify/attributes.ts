// La classificazione della scena, gli attributi: i tag modificabili, gli
// attributi che ciascuno ammette e i pezzi di un testo (`../classify.ts`).

import { parsePath } from "../geometry";
import {
  blendStyle,
  dasharray,
  href,
  hrefId,
  keyword,
  length,
  letterSpacing,
  nonNegativeLength,
  opacity,
  paint,
  paintReference,
  points,
  preserveAspectRatio,
  reference,
  startOffset,
  textDecoration,
  transform,
  trim,
} from "../values";
import { isSvg, NS_NONE, NS_SVG, NS_XLINK, valueOf, type ElementNode, type NodeId, type XmlDocument } from "../xml";
import { NO_RESOURCES, type Resolve, RESOURCE_TAGS, type ResourceKind, type ResourceTag, type Tag } from "./types";

export const TAGS: ReadonlySet<string> = new Set<Tag>([
  "title",
  "desc",
  "g",
  "a",
  "path",
  "rect",
  "ellipse",
  "circle",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "image",
  "defs",
  "view",
  "symbol",
  "use",
  ...(RESOURCE_TAGS as ReadonlySet<ResourceTag>),
]);

/// Il tag del formato di `element`; `null` per un elemento che il formato
/// non conosce.
export function tagOf(element: ElementNode): Tag | null {
  return element.ns === NS_SVG && TAGS.has(element.local) ? (element.local as Tag) : null;
}

/// Vero se un valore contiene `url(`, in qualunque combinazione di maiuscole
/// ASCII.
export function hasUrl(value: string): boolean {
  return /[uU][rR][lL]\(/.test(value);
}

/// Gli attributi che possono rimandare a una risorsa con `url(` (formato della
/// scena, risorse).
export const REFERENCES: ReadonlySet<string> = new Set([
  "fill",
  "stroke",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-path",
  "mask",
  "filter",
]);

/// Vero se ogni attributo di `element` rientra in §4 per il suo tag, coi
/// riferimenti risolti da `resolve`. Con `clip` l'elemento sta in un
/// ritaglio, dove vale anche `clip-rule`.
export function attributesAllowed(element: ElementNode, tag: Tag, resolve: Resolve, clip = false): boolean {
  return element.attrs.every((attr) => {
    switch (attr.ns) {
      case NS_NONE:
        if (clip && attr.local === "clip-rule") return keyword("clip-rule", attr.value);
        return (REFERENCES.has(attr.local) || !hasUrl(attr.value)) && svgAttribute(tag, attr.local, attr.value, resolve);
      case NS_XLINK:
        return attr.local === "href"
          && (tag === "a" || tag === "image")
          && !hasUrl(attr.value)
          && svgAttribute(tag, "href", attr.value);
      // Un attributo nel namespace SVG non è un attributo SVG: quelli non
      // hanno namespace.
      case NS_SVG:
        return false;
      // `fub:*`, `xml:*`, le dichiarazioni e ogni altro namespace si
      // conservano e non decidono niente.
      default:
        return true;
    }
  });
}

/// I tag su cui valgono i riferimenti di `fill` e `stroke`, `clip-path`,
/// `mask` e `filter`: non le righe e i pezzi di un testo, il cui riquadro i
/// lettori non misurano tutti allo stesso modo.
export const DRAWN: ReadonlySet<string> = new Set([
  "path",
  "rect",
  "ellipse",
  "circle",
  "line",
  "polyline",
  "polygon",
  "text",
  "image",
  "g",
  "a",
  "use",
]);

/// I tag su cui i browser disegnano i marcatori.
export const MARKED: ReadonlySet<string> = new Set(["path", "line", "polyline", "polygon"]);

/// Vero se `value` è `none` o un `url(#id)` di una risorsa di tipo `kind`.
export function resourceOrNone(value: string, kind: ResourceKind, resolve: Resolve): boolean {
  if (trim(value) === "none") return true;
  const id = reference(value);
  return id !== null && resolve(id) === kind;
}

/// Il giudizio su un attributo SVG senza namespace, coi riferimenti alle
/// risorse risolti da `resolve` (formato della scena, risorse). Il painter lo
/// usa per gli attributi della radice, che non si classifica: ne porta sugli
/// strati vivi solo quelli che varrebbero su un `g`.
export function svgAttribute(tag: Tag, name: string, value: string, resolve: Resolve = NO_RESOURCES): boolean {
  switch (name) {
    case "id":
      return value !== "";
    case "fill":
    case "stroke": {
      if (paint(value) !== null) return true;
      const used = DRAWN.has(tag) ? paintReference(value) : null;
      const kind = used === null ? null : resolve(used.id);
      return kind === "gradient" || kind === "pattern";
    }
    case "marker-start":
    case "marker-mid":
    case "marker-end":
      return MARKED.has(tag) && resourceOrNone(value, "marker", resolve);
    case "clip-path":
      return DRAWN.has(tag) && resourceOrNone(value, "clip", resolve);
    case "mask":
      return DRAWN.has(tag) && resourceOrNone(value, "mask", resolve);
    case "filter":
      return DRAWN.has(tag) && resourceOrNone(value, "filter", resolve);
    // La fusione, e l'isolamento di un contenitore.
    case "style":
      return DRAWN.has(tag) && blendStyle(value, tag === "g" || tag === "a") !== null;
    case "fill-opacity":
    case "stroke-opacity":
    case "opacity":
      return opacity(value) !== null;
    case "stroke-width":
    case "font-size":
      return nonNegativeLength(value) !== null;
    case "stroke-linecap":
    case "stroke-linejoin":
    case "display":
    case "font-weight":
    case "font-style":
    case "text-anchor":
      return keyword(name, value);
    case "letter-spacing":
      return letterSpacing(value) !== null;
    case "text-decoration":
      // Non si eredita: vale soltanto dove si scrive il testo.
      return (tag === "text" || tag === "tspan") && textDecoration(value) !== null;
    case "stroke-dasharray":
      return dasharray(value);
    case "transform":
      return transform(value) !== null;
    case "font-family":
      return true;
    default:
      return geometryAttribute(tag, name, value);
  }
}

/// Il giudizio sugli attributi di geometria, che dipendono dal tag.
export function geometryAttribute(tag: Tag, name: string, value: string): boolean {
  const is = (...tags: Tag[]): boolean => tags.includes(tag);
  switch (name) {
    case "x":
      if (is("rect", "image", "text", "tspan")) return length(value) !== null;
      return false;
    case "y":
      if (is("rect", "image", "text")) return length(value) !== null;
      return false;
    case "dy":
      return is("tspan") && length(value) !== null;
    case "cx":
    case "cy":
      return is("ellipse", "circle") && length(value) !== null;
    case "x1":
    case "y1":
    case "x2":
    case "y2":
      return is("line") && length(value) !== null;
    case "width":
    case "height":
      return is("rect", "image") && nonNegativeLength(value) !== null;
    case "r":
      return is("circle") && nonNegativeLength(value) !== null;
    case "rx":
    case "ry":
      return is("rect", "ellipse") && nonNegativeLength(value) !== null;
    case "points":
      return is("polyline", "polygon") && points(value) !== null;
    case "d":
      return is("path") && parsePath(value) !== null;
    case "preserveAspectRatio":
      return is("image") && preserveAspectRatio(value);
    case "aria-hidden":
      // Un'immagine decorativa: S012 non la chiede descritta.
      return is("image") && (trim(value) === "true" || trim(value) === "false");
    case "href": {
      if (tag === "a") return href(value).kind === "vault";
      if (tag !== "image") return false;
      const target = href(value);
      return target.kind === "vault" || target.kind === "remote" || (target.kind === "data" && target.raster);
    }
    default:
      return false;
  }
}

/// Vero se `element` contiene solo dati di carattere: testo e riferimenti a
/// carattere, niente elementi, commenti, CDATA o entità.
export function characterDataOnly(doc: XmlDocument, element: ElementNode): boolean {
  return element.children.every((child) => doc.nodes[child]!.kind === "text");
}

/// Il testo di un elemento che contiene solo dati di carattere.
export function characterData(doc: XmlDocument, id: NodeId): string {
  let text = "";
  for (const child of doc.children(id)) {
    const node = doc.nodes[child]!;
    if (node.kind === "text") text += node.value;
  }
  return text;
}

/// Il testo del primo `title` figlio di `element`; `null` se non ne ha.
export function firstTitle(doc: XmlDocument, element: ElementNode): string | null {
  for (const child of element.children) {
    const node = doc.element(child);
    if (node !== null && isSvg(node, "title")) return characterData(doc, child);
  }
  return null;
}

/// Gli attributi che un pezzo di riga non ha: un pezzo continua la riga,
/// non la sposta, non la nasconde e non ha un nome suo. SVG non dà a un
/// `tspan` né opacità né trasformazione.
export const NOT_IN_PIECE: ReadonlySet<string> = new Set(["id", "x", "dy", "text-anchor", "display", "opacity", "transform"]);

/// Vero se `id` è un pezzo di riga modificabile: un `tspan` con attributi da
/// pezzo e solo testo dentro.
export function allowedPiece(doc: XmlDocument, id: NodeId, resolve: Resolve): boolean {
  const element = doc.element(id);
  if (element === null || tagOf(element) !== "tspan") return false;
  if (element.attrs.some((attr) => attr.ns === NS_NONE && NOT_IN_PIECE.has(attr.local))) return false;
  return attributesAllowed(element, "tspan", resolve) && characterDataOnly(doc, element);
}

/// Vero se `id` è un `title`, `desc` o, dentro un `text`, una riga
/// modificabile: attributi ammessi e dentro solo testo, e per una riga anche
/// pezzi.
export function allowedPart(doc: XmlDocument, id: NodeId, insideText: boolean, resolve: Resolve): boolean {
  const element = doc.element(id);
  if (element === null) return false;
  const tag = tagOf(element);
  if (tag !== "title" && tag !== "desc" && !(tag === "tspan" && insideText)) return false;
  if (!attributesAllowed(element, tag, resolve)) return false;
  if (tag !== "tspan") return characterDataOnly(doc, element);
  return element.children.every((child) => doc.nodes[child]!.kind === "text" || allowedPiece(doc, child, resolve));
}

/// Il testo di una riga modificabile, coi suoi pezzi.
export function lineText(doc: XmlDocument, id: NodeId): string {
  let text = "";
  for (const child of doc.children(id)) {
    const node = doc.nodes[child]!;
    if (node.kind === "text") text += node.value;
    else if (node.kind === "element") text += characterData(doc, child);
  }
  return text;
}

/// Vero se `id` è il tracciato di un testo modificabile (formato della
/// scena, testo): un `textPath` con `href` o `xlink:href`, uno solo, verso un
/// tracciato delle risorse, `startOffset` facoltativo, e dentro dati di
/// carattere e pezzi.
export function allowedTextPath(doc: XmlDocument, id: NodeId, resolve: Resolve): boolean {
  const element = doc.element(id)!;
  let hrefs = 0;
  const attributes = element.attrs.every((attr) => {
    switch (attr.ns) {
      case NS_NONE:
      case NS_XLINK: {
        if (attr.local === "href") {
          hrefs++;
          const target = hrefId(attr.value);
          return target !== null && resolve(target) === "path";
        }
        return attr.ns === NS_NONE && attr.local === "startOffset" && startOffset(attr.value) !== null;
      }
      case NS_SVG:
        return false;
      default:
        return true;
    }
  });
  return attributes && hrefs === 1 && element.children.every((child) => doc.nodes[child]!.kind === "text" || allowedPiece(doc, child, resolve));
}

/// Il `textPath` figlio di un `text`, se ne ha uno.
export function textPathOf(doc: XmlDocument, element: ElementNode): NodeId | null {
  for (const child of element.children) {
    const node = doc.element(child);
    if (node !== null && isSvg(node, "textPath")) return child;
  }
  return null;
}

/// L'id del tracciato a cui rimanda un `textPath`: in SVG 2 `href` vince su
/// `xlink:href`.
export function textPathTarget(element: ElementNode): string | null {
  const value = valueOf(element, NS_NONE, "href") ?? valueOf(element, NS_XLINK, "href");
  return value === undefined ? null : hrefId(value);
}

/// Vero se ogni figlio di un'unità è ammesso: spazi, `title`, `desc` e, per
/// `text`, i `tspan` o un `textPath`. Un testo ha le righe o il tracciato,
/// non tutti e due, e col tracciato non ha `x` e `y`, che i lettori
/// applicano lungo il tracciato in modi diversi.
export function unitChildrenAllowed(doc: XmlDocument, element: ElementNode, tag: Tag, resolve: Resolve): boolean {
  let lines = 0;
  let paths = 0;
  const children = element.children.every((child) => {
    const node = doc.nodes[child]!;
    if (node.kind === "text") return node.blank;
    if (node.kind !== "element") return false;
    const inner = tagOf(node);
    if (tag === "text" && inner === "textPath") {
      paths++;
      return allowedTextPath(doc, child, resolve);
    }
    if (inner === "tspan") lines++;
    return allowedPart(doc, child, tag === "text", resolve);
  });
  if (!children || paths === 0) return children;
  return paths === 1 && lines === 0 && valueOf(element, NS_NONE, "x") === undefined && valueOf(element, NS_NONE, "y") === undefined;
}
