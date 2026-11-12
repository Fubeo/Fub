// La classificazione della scena, le risorse del disegno e i simboli
// (formato della scena, risorse e simboli; `../classify.ts`).

import { parsePath } from "../geometry";
import {
  angle,
  fraction,
  hrefId,
  isWsp,
  keyword,
  length,
  nonNegativeLength,
  number,
  numberList,
  oneOrTwo,
  opacity,
  paint,
  preserveAspectRatio,
  transform,
  trim,
  urlIds,
  viewBox,
} from "../values";
import { isSvg, NS_NONE, NS_SVG, NS_XLINK, valueOf, type ElementNode, type NodeId, type XmlDocument } from "../xml";
import type { Resolve, ResourceKind, ResourceTag, Tag } from "./types";
import { attributesAllowed, hasUrl, REFERENCES, svgAttribute, tagOf, unitChildrenAllowed } from "./attributes";
import { blankOrMeta, styleOf } from "./facts";

// ---------------------------------------------------------------------------
// Le risorse del disegno (formato della scena, risorse).
// ---------------------------------------------------------------------------

/// Quanti punti ha al più una sfumatura (formato della scena, risorse).
export const MAX_STOPS = 256;

/// Quante primitive ha al più un filtro, coi `feMergeNode` (formato della
/// scena, risorse).
export const MAX_PRIMITIVES = 64;

/// Quanti `g` si annidano al più nel contenuto di una risorsa.
export const MAX_CONTENT_DEPTH = 32;

/// Le forme di §4, che possono stare nel contenuto di ogni risorsa.
export const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// Le primitive dei filtri (formato della scena, risorse): un elenco chiuso,
/// quelle di SVG 1.1 che ogni lettore disegna allo stesso modo e l'ombra di
/// Filter Effects.
export const PRIMITIVES: ReadonlySet<string> = new Set([
  "feGaussianBlur",
  "feOffset",
  "feFlood",
  "feDropShadow",
  "feColorMatrix",
  "feComposite",
  "feBlend",
  "feMorphology",
  "feMerge",
]);

/// Il resolver del contenuto di una risorsa: solo le sfumature, così le
/// risorse non si rimandano in cerchio.
export function gradientsOnly(resolve: Resolve): Resolve {
  return (id) => (resolve(id) === "gradient" ? "gradient" : null);
}

/// Vero se `element` è una `defs` della radice modificabile: solo `id` fra
/// gli attributi SVG.
export function defsAllowed(element: ElementNode): boolean {
  return element.attrs.every((attr) => {
    if (attr.ns === NS_NONE) return attr.local === "id" && attr.value !== "";
    return attr.ns !== NS_XLINK && attr.ns !== NS_SVG;
  });
}

/// Vero se `value`, una coordinata di una risorsa, rientra nelle sue unità:
/// nel riquadro (`box`) un numero o una percentuale, altrimenti una
/// lunghezza.
export function coordinate(value: string, box: boolean, nonNegative: boolean): boolean {
  const n = box ? fraction(value) : length(value);
  return n !== null && (!nonNegative || n >= 0);
}

/// Le coordinate di ogni risorsa, nelle sue unità.
export const COORDINATES: Readonly<Partial<Record<ResourceTag, readonly string[]>>> = {
  linearGradient: ["x1", "y1", "x2", "y2"],
  radialGradient: ["cx", "cy", "r", "fx", "fy"],
  pattern: ["x", "y", "width", "height"],
  mask: ["x", "y", "width", "height"],
  filter: ["x", "y", "width", "height"],
};

/// Le coordinate che in `userSpaceOnUse` vanno scritte: mancando, SVG le
/// prenderebbe in percentuale del viewport.
export const REQUIRED: Readonly<Partial<Record<ResourceTag, readonly string[]>>> = {
  linearGradient: ["x2"],
  radialGradient: ["cx", "cy", "r"],
  mask: ["x", "y", "width", "height"],
  filter: ["x", "y", "width", "height"],
};

/// L'attributo delle unità delle coordinate di ogni risorsa.
export const UNITS: Readonly<Partial<Record<ResourceTag, string>>> = {
  linearGradient: "gradientUnits",
  radialGradient: "gradientUnits",
  pattern: "patternUnits",
  mask: "maskUnits",
  filter: "filterUnits",
};

/// Il giudizio su un attributo SVG senza namespace di una risorsa, con le
/// coordinate nel riquadro se `box`.
export function resourceAttribute(tag: ResourceTag, name: string, value: string, box: boolean): boolean {
  if (name === "id") return value !== "";
  if (COORDINATES[tag]?.includes(name)) return coordinate(value, box, name === "r" || name === "width" || name === "height");
  switch (name) {
    case "gradientUnits":
    case "spreadMethod":
      return (tag === "linearGradient" || tag === "radialGradient") && keyword(name, value);
    case "gradientTransform":
      return (tag === "linearGradient" || tag === "radialGradient") && transform(value) !== null;
    case "patternUnits":
    case "patternContentUnits":
      return tag === "pattern" && keyword(name, value);
    case "patternTransform":
      return tag === "pattern" && transform(value) !== null;
    case "viewBox":
      return (tag === "pattern" || tag === "marker") && viewBox(value) !== null;
    case "preserveAspectRatio":
      return (tag === "pattern" || tag === "marker") && preserveAspectRatio(value);
    case "markerUnits":
      return tag === "marker" && keyword(name, value);
    case "refX":
    case "refY":
      return tag === "marker" && length(value) !== null;
    case "markerWidth":
    case "markerHeight":
      return tag === "marker" && nonNegativeLength(value) !== null;
    case "orient": {
      const text = trim(value);
      return tag === "marker" && (text === "auto" || text === "auto-start-reverse" || angle(value) !== null);
    }
    case "clipPathUnits":
    case "clip-rule":
      return tag === "clipPath" && keyword(name, value);
    case "transform":
      return tag === "clipPath" && transform(value) !== null;
    case "maskUnits":
    case "maskContentUnits":
      return tag === "mask" && keyword(name, value);
    case "filterUnits":
    case "primitiveUnits":
    case "color-interpolation-filters":
      return tag === "filter" && keyword(name, value);
    default:
      return false;
  }
}

/// Vero se `element`, una risorsa di tag `tag` in una `defs` della radice, è
/// modificabile: attributi, figli e riferimenti del suo contenuto.
export function resourceAllowed(doc: XmlDocument, element: ElementNode, tag: ResourceTag, resolve: Resolve): boolean {
  return resourceFault(doc, element, tag, resolve) === null;
}

/// Ciò per cui una risorsa non è modificabile: un attributo che il formato
/// non ammette, uno che vi manca, o un figlio che non va.
export type ResourceFault =
  | { readonly kind: "attribute"; readonly name: string }
  | { readonly kind: "missing"; readonly name: string }
  | { readonly kind: "child"; readonly tag: string };

/// Il primo [`ResourceFault`] di `element`, una risorsa di tag `tag` in una
/// `defs` della radice, nell'ordine in cui il formato la giudica; `null` se è
/// modificabile.
export function resourceFault(doc: XmlDocument, element: ElementNode, tag: ResourceTag, resolve: Resolve): ResourceFault | null {
  const id = valueOf(element, NS_NONE, "id");
  if (id === undefined || id === "") return { kind: "missing", name: "id" };
  const unitsName = UNITS[tag];
  const units = unitsName === undefined ? undefined : valueOf(element, NS_NONE, unitsName);
  const box = units === undefined || trim(units) !== "userSpaceOnUse";
  const wrong = element.attrs.find((attr) => {
    if (attr.ns === NS_NONE) return hasUrl(attr.value) || !resourceAttribute(tag, attr.local, attr.value, box);
    return attr.ns === NS_XLINK || attr.ns === NS_SVG;
  });
  if (wrong !== undefined) return { kind: "attribute", name: wrong.name };
  // Una sfumatura con uno `stop` o nessuno è un colore pieno, o niente: le
  // sue coordinate non contano, nemmeno quelle del viewport.
  const stops = element.children.filter((child) => {
    const stop = doc.element(child);
    return stop !== null && isSvg(stop, "stop");
  }).length;
  const plain = (tag === "linearGradient" || tag === "radialGradient") && stops <= 1;
  const missing = box || plain ? undefined : REQUIRED[tag]?.find((name) => valueOf(element, NS_NONE, name) === undefined);
  if (missing !== undefined) return { kind: "missing", name: missing };
  let child: NodeId | null;
  switch (tag) {
    case "linearGradient":
    case "radialGradient":
      child = stopsFault(doc, element);
      break;
    case "filter":
      child = primitivesFault(doc, element);
      break;
    default: {
      const inner = gradientsOnly(resolve);
      const clip = tag === "clipPath";
      child = element.children.find((each) => !contentAllowed(doc, each, clip, inner, 1)) ?? null;
    }
  }
  return child === null ? null : { kind: "child", tag: nodeName(doc, child) };
}

/// Il nome di un nodo per dirlo: il tag di un elemento, `#text` per il
/// testo, `#comment` per un commento.
export function nodeName(doc: XmlDocument, id: NodeId): string {
  const node = doc.nodes[id]!;
  if (node.kind === "element") return node.name;
  return node.kind === "cdata" || node.kind === "entity-ref" ? "#text" : `#${node.kind}`;
}

/// Vero se `element`, un `path` in una `defs` della radice, è il tracciato di
/// un testo (formato della scena, testo): `id`, `d` e nessun altro attributo
/// SVG, e per figli soltanto `title` e `desc`.
export function pathResourceAllowed(doc: XmlDocument, element: ElementNode): boolean {
  const id = valueOf(element, NS_NONE, "id");
  if (id === undefined || id === "" || valueOf(element, NS_NONE, "d") === undefined) return false;
  const attributes = element.attrs.every((attr) => {
    if (attr.ns === NS_NONE) return attr.local === "id" || (attr.local === "d" && parsePath(attr.value) !== null);
    return attr.ns !== NS_XLINK && attr.ns !== NS_SVG;
  });
  return attributes && element.children.every((child) => blankOrMeta(doc, child) === true);
}

/// Vero se `element`, un `text` o una `polyline` con `fub:role="style"` in
/// una `defs` della radice, è uno stile modificabile (formato della scena,
/// stili): un id, la forma di [`styleOf`] e gli attributi di §4 per il suo
/// tag, coi riferimenti risolti da `resolve`.
export function styleAllowed(doc: XmlDocument, element: ElementNode, tag: Tag, resolve: Resolve): boolean {
  const id = valueOf(element, NS_NONE, "id");
  return id !== undefined && id !== "" && styleOf(doc, element) !== null && attributesAllowed(element, tag, resolve);
}

/// Il primo figlio di una sfumatura che non è ammesso, `null` se lo sono
/// tutti: `stop`, al più [`MAX_STOPS`], ognuno con `offset`, `stop-color` e
/// `stop-opacity`.
export function stopsFault(doc: XmlDocument, element: ElementNode): NodeId | null {
  let stops = 0;
  for (const child of element.children) {
    const plain = blankOrMeta(doc, child);
    if (plain !== null) {
      if (!plain) return child;
      continue;
    }
    const stop = doc.element(child)!;
    if (!isSvg(stop, "stop") || ++stops > MAX_STOPS) return child;
    const attributes = stop.attrs.every((attr) => {
      if (attr.ns !== NS_NONE) return attr.ns !== NS_XLINK && attr.ns !== NS_SVG;
      switch (attr.local) {
        case "id":
          return attr.value !== "";
        case "offset":
          return fraction(attr.value) !== null;
        case "stop-color": {
          const color = paint(attr.value);
          return color !== null && color !== "none";
        }
        case "stop-opacity":
          return opacity(attr.value) !== null;
        default:
          return false;
      }
    });
    const empty = stop.children.every((inner) => {
      const node = doc.nodes[inner]!;
      return node.kind === "text" && node.blank;
    });
    if (!attributes || !empty) return child;
  }
  return null;
}

/// Vero se `id`, nel contenuto di una risorsa, è ammesso: spazi, `title`,
/// `desc`, una forma, un testo e, fuori da un ritaglio, un `g` che ne
/// contiene, fino a [`MAX_CONTENT_DEPTH`] livelli.
export function contentAllowed(doc: XmlDocument, id: NodeId, clip: boolean, resolve: Resolve, depth: number): boolean {
  const plain = blankOrMeta(doc, id);
  if (plain !== null) return plain;
  const element = doc.element(id)!;
  const tag = tagOf(element);
  if (tag === null) return false;
  if (SHAPES.has(tag) || tag === "text") {
    return attributesAllowed(element, tag, resolve, clip) && unitChildrenAllowed(doc, element, tag, resolve);
  }
  if (tag !== "g" || clip || depth > MAX_CONTENT_DEPTH) return false;
  return attributesAllowed(element, tag, resolve) && element.children.every((child) => contentAllowed(doc, child, clip, resolve, depth + 1));
}

/// Vero se `value`, un `result`, è un nome senza spazi.
export function resultName(value: string): boolean {
  if (value === "") return false;
  for (let i = 0; i < value.length; i++) if (isWsp(value.charCodeAt(i))) return false;
  return true;
}

/// I tipi di `feColorMatrix` e quanti numeri vuole `values` per ognuno.
export const MATRIX_VALUES: ReadonlyMap<string, number> = new Map([
  ["matrix", 20],
  ["saturate", 1],
  ["hueRotate", 1],
  ["luminanceToAlpha", 0],
]);

/// Il giudizio su un attributo SVG senza namespace di una primitiva;
/// `input` dice se un ingresso è ammesso.
export function primitiveAttribute(local: string, name: string, value: string, input: (value: string) => boolean): boolean {
  switch (name) {
    case "id":
      return value !== "";
    case "result":
      return local !== "feMergeNode" && resultName(value);
    case "color-interpolation-filters":
      return local !== "feMergeNode" && keyword(name, value);
    case "x":
    case "y":
      return local !== "feMergeNode" && length(value) !== null;
    case "width":
    case "height":
      return local !== "feMergeNode" && nonNegativeLength(value) !== null;
    case "in":
      return local !== "feFlood" && local !== "feMerge" && input(value);
    case "in2":
      return (local === "feComposite" || local === "feBlend") && input(value);
    case "stdDeviation":
      return (local === "feGaussianBlur" || local === "feDropShadow") && oneOrTwo(value) !== null;
    case "dx":
    case "dy":
      return (local === "feOffset" || local === "feDropShadow") && number(value) !== null;
    case "flood-color": {
      const color = paint(value);
      return (local === "feFlood" || local === "feDropShadow") && color !== null && color !== "none";
    }
    case "flood-opacity":
      return (local === "feFlood" || local === "feDropShadow") && opacity(value) !== null;
    case "type":
      return local === "feColorMatrix" && MATRIX_VALUES.has(value);
    case "values":
      // Il numero lo controlla chi conosce il tipo.
      return local === "feColorMatrix" && numberList(value) !== null;
    case "operator":
      if (local === "feComposite") return ["over", "in", "out", "atop", "xor", "arithmetic"].includes(value);
      return local === "feMorphology" && (value === "erode" || value === "dilate");
    case "k1":
    case "k2":
    case "k3":
    case "k4":
      return local === "feComposite" && number(value) !== null;
    case "mode":
      return local === "feBlend" && ["normal", "multiply", "screen", "darken", "lighten"].includes(value);
    case "radius":
      return local === "feMorphology" && oneOrTwo(value) !== null;
    default:
      return false;
  }
}

/// Vero se la primitiva `element` è ammessa, con gli ingressi che rimandano
/// a `results`, i nomi delle primitive che la precedono.
export function primitiveAllowed(doc: XmlDocument, element: ElementNode, results: ReadonlySet<string>): boolean {
  const input = (value: string): boolean => value === "SourceGraphic" || value === "SourceAlpha" || results.has(value);
  const local = element.local;
  const attributes = element.attrs.every((attr) => {
    if (attr.ns === NS_NONE) return !hasUrl(attr.value) && primitiveAttribute(local, attr.local, attr.value, input);
    return attr.ns !== NS_XLINK && attr.ns !== NS_SVG;
  });
  if (!attributes) return false;
  if ((local === "feComposite" || local === "feBlend") && valueOf(element, NS_NONE, "in2") === undefined) return false;
  if (local === "feColorMatrix") {
    const type = valueOf(element, NS_NONE, "type") ?? "matrix";
    const values = valueOf(element, NS_NONE, "values");
    const wanted = MATRIX_VALUES.get(type)!;
    if (values === undefined ? false : numberList(values)!.length !== wanted) return false;
    if (type === "saturate" && values !== undefined && numberList(values)![0]! < 0) return false;
  }
  return element.children.every((child) => {
    const node = doc.nodes[child]!;
    if (node.kind === "text") return node.blank;
    if (local !== "feMerge" || node.kind !== "element" || !isSvg(node, "feMergeNode")) return false;
    return primitiveAllowed(doc, node, results);
  });
}

/// Il primo figlio di un filtro che non è ammesso, `null` se lo sono tutti:
/// primitive dell'elenco, al più [`MAX_PRIMITIVES`] coi `feMergeNode`,
/// ognuna con ingressi che vengono prima.
export function primitivesFault(doc: XmlDocument, element: ElementNode): NodeId | null {
  const results = new Set<string>();
  let count = 0;
  for (const child of element.children) {
    const plain = blankOrMeta(doc, child);
    if (plain !== null) {
      if (!plain) return child;
      continue;
    }
    const primitive = doc.element(child)!;
    if (primitive.ns !== NS_SVG || !PRIMITIVES.has(primitive.local)) return child;
    count += 1 + primitive.children.filter((inner) => doc.element(inner) !== null).length;
    if (count > MAX_PRIMITIVES || !primitiveAllowed(doc, primitive, results)) return child;
    const result = valueOf(primitive, NS_NONE, "result");
    if (result !== undefined) results.add(result);
  }
  return null;
}

/// Gli id a cui gli attributi di `element` rimandano, come li legge S014:
/// ogni `url(#id)` degli attributi senza prefisso e `xlink`, anche fuori dal
/// formato, e l'`href` locale (`#id`) di un elemento SVG che non è un
/// collegamento, dove `#id` è un'ancora.
export function referencesOf(element: ElementNode): string[] {
  const out: string[] = [];
  for (const attr of element.attrs) {
    if (attr.ns !== NS_NONE && attr.ns !== NS_XLINK) continue;
    if (attr.local !== "href") {
      for (const id of urlIds(attr.value)) out.push(id);
      continue;
    }
    const id = element.ns === NS_SVG && element.local !== "a" ? hrefId(attr.value) : null;
    if (id !== null) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// I simboli (formato della scena, simboli).
// ---------------------------------------------------------------------------

/// Vero se `element`, un `symbol` di una `defs` della radice, ha gli
/// attributi di un simbolo: un id e `overflow="visible"`, e nessun altro
/// attributo SVG. I figli si giudicano uno per uno, come quelli di un gruppo.
export function symbolAllowed(element: ElementNode): boolean {
  let id = false;
  let overflow = false;
  const attributes = element.attrs.every((attr) => {
    switch (attr.ns) {
      case NS_NONE:
        if (attr.local === "overflow") return (overflow = trim(attr.value) === "visible");
        return attr.local === "id" && (id = attr.value !== "");
      case NS_XLINK:
      case NS_SVG:
        return false;
      default:
        return true;
    }
  });
  return attributes && id && overflow;
}

/// Gli attributi SVG di un'istanza oltre a `href`: niente geometria e niente
/// di ciò che il contenuto del simbolo erediterebbe, così il simbolo si vede
/// uguale in ogni istanza.
export const INSTANCE_ATTRIBUTES: ReadonlySet<string> = new Set(["id", "transform", "opacity", "display", "style", "clip-path", "mask", "filter"]);

/// Gli attributi SVG di una copia oltre a `href`: dove sta e nient'altro,
/// perché l'editor riscrive le copie quando la ripetizione cambia (formato
/// della scena, ripetizioni).
export const COPY_ATTRIBUTES: ReadonlySet<string> = new Set(["id", "transform"]);

/// Vero se `element`, un `use` fuori dalle `defs`, rimanda a ciò che vuole
/// `target`: un `href` o un `xlink:href`, uno solo, verso un id che
/// `resolve` dice di quel tipo, gli attributi di `attributes`, e per figli
/// soltanto titoli e descrizioni. Un'istanza vuole un simbolo e gli
/// attributi di [`INSTANCE_ATTRIBUTES`], una copia un originale e quelli di
/// [`COPY_ATTRIBUTES`].
export function useAllowed(doc: XmlDocument, element: ElementNode, resolve: Resolve, target: ResourceKind, attributes: ReadonlySet<string>): boolean {
  let hrefs = 0;
  const allowed = element.attrs.every((attr) => {
    switch (attr.ns) {
      case NS_NONE:
      case NS_XLINK: {
        if (attr.local === "href") {
          hrefs++;
          const id = hrefId(attr.value);
          return id !== null && resolve(id) === target;
        }
        if (attr.ns === NS_XLINK || !attributes.has(attr.local)) return false;
        return (REFERENCES.has(attr.local) || !hasUrl(attr.value)) && svgAttribute("use", attr.local, attr.value, resolve);
      }
      case NS_SVG:
        return false;
      default:
        return true;
    }
  });
  return allowed && hrefs === 1 && element.children.every((child) => blankOrMeta(doc, child) === true);
}
