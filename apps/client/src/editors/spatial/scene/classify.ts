// La regola di classificazione di §4: che cosa della scena è modificabile e
// che cosa è estraneo. È `classify.rs` di `fub-scene`.
//
// Si parte dalla radice, che non si classifica, e si scende solo dentro i
// contenitori modificabili (`g` e `a`), dove ogni figlio si giudica da sé. Un
// elemento di qualunque altro tag è un'unità con i suoi figli: o è tutto
// modificabile o è tutto estraneo. I nodi estranei contigui, con gli spazi fra
// loro, diventano un solo blocco, che la superficie disegna come uno strato
// inerte; gli spazi fra un elemento modificabile e un blocco non sono di
// nessuno.
//
// La visita usa una pila esplicita, non la ricorsione: un SVG con centomila
// gruppi annidati è un file valido, e non deve esaurire lo stack.
//
// Le risorse stanno nelle `defs` della radice (formato della scena, risorse), e
// un oggetto le usa per riferimento: un oggetto è modificabile solo se ciò a
// cui rimanda lo è. Per questo la lettura passa due volte: prima giudica le
// risorse, le sfumature e poi le altre, che possono usare le sfumature nel loro
// contenuto; poi classifica il documento chiedendo a quell'indice che cosa è
// ogni id. Il tracciato di un testo su tracciato è anch'esso una risorsa, un
// `path` nelle `defs` della radice (formato della scena, testo).

import { BrushError, parseBrush } from "../ink/brush";
import { decodeInk, inkDuration, inkLength, unknownChannels, type Ink } from "../ink/codec";
import { InkError } from "../ink/sample";
import { Context, isContainer, Tally, type Role, type Stroke, type Swatches, type Tool } from "./analysis";
import { diagnostic, type Code, type Diagnostic } from "./diagnostics";
import { readConnectorEnd, readConnectorGeom, readLabelPlace, type ConnectorEnd, type ConnectorGeom, type LabelPlace } from "./connectors";
import { parsePath } from "./geometry";
import { readPolygonal, type Polygonal } from "./parametric";
import { readVarWidth, type VarWidth } from "./varwidth";
import type { Span } from "./text";
import {
  angle,
  blendStyle,
  dasharray,
  fraction,
  href,
  hrefId,
  isWsp,
  keyword,
  length,
  letterSpacing,
  nonNegativeLength,
  number,
  numberList,
  oneOrTwo,
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
  urlIds,
  viewBox,
  wrapWidth,
  type Rgb,
} from "./values";
import { isSvg, NS_FUB, NS_NONE, NS_SVG, NS_XLINK, valueOf, type ElementNode, type NodeId, type XmlDocument } from "./xml";

/// Quanti contenitori modificabili si annidano al massimo sotto la radice: un
/// `g` o un `a` più profondo è estraneo, con tutto ciò che contiene.
export const MAX_DEPTH = 128;

/// I tag d'apertura e di chiusura di un contenitore. `close` è `null` quando
/// il contenitore è autochiuso (`<g/>`): allora `open` è l'elemento intero.
export interface Tags {
  readonly open: Span;
  readonly close: Span | null;
}

/// Il nome e lo stato di un livello (§3).
export interface Layer {
  readonly name: string;
  /// `fub:locked="true"`.
  readonly locked: boolean;
  /// `display="none"`.
  readonly hidden: boolean;
}

/// La radice `svg`: è il documento, e non si classifica.
export interface RootItem extends Span {
  readonly kind: "root";
  readonly tags: Tags;
}

/// Un connettore letto: il percorso di `fub:geom` e i due capi, `null` per
/// un capo libero o scritto fuori dalla grammatica.
export interface ConnectorFacts {
  readonly geom: ConnectorGeom;
  readonly from: ConnectorEnd | null;
  readonly to: ConnectorEnd | null;
}

/// Un elemento modificabile.
export interface ElementItem extends Span {
  readonly kind: "element";
  /// Gli indici dei figli elemento dalla radice: è il modo in cui le
  /// operazioni della superficie indicano il loro bersaglio. La radice è
  /// `[]`.
  readonly path: readonly number[];
  readonly tag: string;
  readonly role: Role;
  readonly id: string | null;
  /// Il rientro della riga su cui l'elemento comincia.
  readonly indent: string;
  /// I tag di livelli, gruppi e collegamenti.
  readonly tags?: Tags;
  readonly layer?: Layer;
  /// `fub:locked="true"` su un livello, un gruppo, un collegamento o una
  /// forma (§3): non si sceglie sul foglio, e ciò che contiene non cambia.
  /// Su un livello ripete `layer`.
  readonly locked?: true;
  /// `display="none"` su un livello, un gruppo, un collegamento o una forma:
  /// non si vede. Su un livello ripete `layer`.
  readonly hidden?: true;
  readonly stroke?: Stroke;
  /// `x1 y1 x2 y2` di una freccia.
  readonly arrow?: readonly [number, number, number, number];
  /// Il percorso e gli agganci di un connettore (formato della scena,
  /// connettori).
  readonly connector?: ConnectorFacts;
  /// La geometria di un poligono regolare o di una stella: `fub:geom` letto.
  readonly polygonal?: Polygonal;
  /// La geometria di un contorno a spessore variabile: `fub:geom` letto.
  readonly varwidth?: VarWidth;
  /// Il testo del primo `title` figlio di un livello o di un oggetto, coi
  /// riferimenti risolti e gli spazi com'erano: il nome che qualcuno gli ha
  /// dato.
  readonly title?: string;
  /// Il testo di un `title` o di un `desc`, coi riferimenti risolti e gli
  /// spazi com'erano: è ciò che l'operazione `meta` sostituisce.
  readonly text?: string;
  /// Le righe di un `text`, una per `tspan`, coi pezzi, o il testo del suo
  /// tracciato: è il testo che l'operazione `text` sostituisce.
  readonly lines?: readonly string[];
  /// La larghezza di un testo in area, `fub:wrap` letto (formato della
  /// scena, testo).
  readonly wrap?: number;
  /// L'id del tracciato che un testo segue (formato della scena, testo).
  readonly textPath?: string;
  /// Il connettore di cui un testo è l'etichetta, e dove sta: `fub:along`
  /// letto (formato della scena, connettori).
  readonly along?: LabelPlace;
  /// Come vive una risorsa, da `fub:role` (formato della scena, risorse).
  readonly lifecycle?: Lifecycle;
  /// Il nome e il colore di un campione del documento.
  readonly swatch?: SwatchFacts;
  /// Il nome di un motivo del documento.
  readonly motif?: MotifFacts;
  /// Il rettangolo di una tavola, `x y w h` del suo `viewBox` (formato della
  /// scena, tavole).
  readonly box?: readonly [number, number, number, number];
  /// La tavola di una carta: `fub:board`, com'è scritto.
  readonly board?: string;
}

/// Una sequenza contigua di nodi estranei (§8).
export interface ForeignItem extends Span {
  readonly kind: "foreign";
  /// Il percorso del contenitore; `null` per il prologo e l'epilogo del
  /// documento, fuori dalla radice.
  readonly parentPath: readonly number[] | null;
  /// Gli indici `[da, a)` dei figli elemento del contenitore che il blocco
  /// comprende. Un blocco senza elementi ha `da = a`, l'indice del primo
  /// elemento che lo segue; nel documento la radice è l'elemento 0.
  readonly elements: readonly [number, number];
  readonly indent: string;
}

/// Una voce della scena, in ordine di documento.
export type Item = RootItem | ElementItem | ForeignItem;

/// I tag di §4.
export type Tag =
  | "title"
  | "desc"
  | "g"
  | "a"
  | "path"
  | "rect"
  | "ellipse"
  | "circle"
  | "line"
  | "polyline"
  | "polygon"
  | "text"
  | "tspan"
  | "textPath"
  | "image"
  | "defs"
  | "view"
  | ResourceTag;

/// I tag delle risorse (formato della scena, risorse).
export type ResourceTag = "linearGradient" | "radialGradient" | "pattern" | "marker" | "clipPath" | "mask" | "filter";

const RESOURCE_TAGS: ReadonlySet<string> = new Set<ResourceTag>([
  "linearGradient",
  "radialGradient",
  "pattern",
  "marker",
  "clipPath",
  "mask",
  "filter",
]);

/// Vero se `tag` è il tag di una risorsa dovunque stia: un `path` lo è
/// soltanto in una `defs` della radice.
export function isResourceTag(tag: string): boolean {
  return RESOURCE_TAGS.has(tag);
}

/// Che cosa è una risorsa per chi la usa (formato della scena, risorse): `fill`
/// e `stroke` usano sfumature e motivi, `marker-*` i marcatori, `clip-path`,
/// `mask` e `filter` ritagli, maschere e filtri, un `textPath` un tracciato
/// (formato della scena, testo).
export type ResourceKind = "gradient" | "pattern" | "marker" | "clip" | "mask" | "filter" | "path";

/// Il tipo di una risorsa dal suo tag.
export function resourceKind(tag: string): ResourceKind | null {
  switch (tag) {
    case "path":
      return "path";
    case "linearGradient":
    case "radialGradient":
      return "gradient";
    case "pattern":
      return "pattern";
    case "marker":
      return "marker";
    case "clipPath":
      return "clip";
    case "mask":
      return "mask";
    case "filter":
      return "filter";
    default:
      return null;
  }
}

/// Come vive una risorsa, da `fub:role` (formato della scena, risorse):
/// `private` è di un oggetto e duplicarlo la copia, `shared` è di chi usa la
/// stessa cosa; tutte e due se ne vanno col loro ultimo riferimento. `swatch`
/// è un campione del documento, un colore o un motivo con un nome: resta
/// anche senza riferimenti, e duplicare chi lo usa lo condivide. Senza, la
/// risorsa resta.
export type Lifecycle = "private" | "shared" | "swatch";

/// Un campione del documento (formato della scena, risorse): il suo nome,
/// com'è scritto, e il colore, `#rrggbb` minuscolo.
export interface SwatchFacts {
  readonly name: string;
  readonly color: string;
}

/// Un motivo del documento (formato della scena, risorse): il suo nome,
/// com'è scritto.
export interface MotifFacts {
  readonly name: string;
}

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

/// Il tipo della risorsa modificabile che porta `id`, o `null` se nessuna
/// risorsa modificabile lo porta.
export type Resolve = (id: string) => ResourceKind | null;

/// Un documento senza risorse.
export const NO_RESOURCES: Resolve = () => null;

/// Dove sta un elemento: figlio della radice, di una `defs` della radice, o
/// di un altro contenitore modificabile.
export type Place = "root" | "defs" | "inside";

const TAGS: ReadonlySet<string> = new Set<Tag>([
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
  ...(RESOURCE_TAGS as ReadonlySet<ResourceTag>),
]);

function tagOf(element: ElementNode): Tag | null {
  return element.ns === NS_SVG && TAGS.has(element.local) ? (element.local as Tag) : null;
}

/// Vero se un valore contiene `url(`, in qualunque combinazione di maiuscole
/// ASCII.
function hasUrl(value: string): boolean {
  return /[uU][rR][lL]\(/.test(value);
}

/// Gli attributi che possono rimandare a una risorsa con `url(` (formato della
/// scena, risorse).
const REFERENCES: ReadonlySet<string> = new Set([
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
function attributesAllowed(element: ElementNode, tag: Tag, resolve: Resolve, clip = false): boolean {
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
const DRAWN: ReadonlySet<string> = new Set([
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
]);

/// I tag su cui i browser disegnano i marcatori.
const MARKED: ReadonlySet<string> = new Set(["path", "line", "polyline", "polygon"]);

/// Vero se `value` è `none` o un `url(#id)` di una risorsa di tipo `kind`.
function resourceOrNone(value: string, kind: ResourceKind, resolve: Resolve): boolean {
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
function geometryAttribute(tag: Tag, name: string, value: string): boolean {
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
function characterDataOnly(doc: XmlDocument, element: ElementNode): boolean {
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
const NOT_IN_PIECE: ReadonlySet<string> = new Set(["id", "x", "dy", "text-anchor", "display", "opacity", "transform"]);

/// Vero se `id` è un pezzo di riga modificabile: un `tspan` con attributi da
/// pezzo e solo testo dentro.
function allowedPiece(doc: XmlDocument, id: NodeId, resolve: Resolve): boolean {
  const element = doc.element(id);
  if (element === null || tagOf(element) !== "tspan") return false;
  if (element.attrs.some((attr) => attr.ns === NS_NONE && NOT_IN_PIECE.has(attr.local))) return false;
  return attributesAllowed(element, "tspan", resolve) && characterDataOnly(doc, element);
}

/// Vero se `id` è un `title`, `desc` o, dentro un `text`, una riga
/// modificabile: attributi ammessi e dentro solo testo, e per una riga anche
/// pezzi.
function allowedPart(doc: XmlDocument, id: NodeId, insideText: boolean, resolve: Resolve): boolean {
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
function allowedTextPath(doc: XmlDocument, id: NodeId, resolve: Resolve): boolean {
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
function unitChildrenAllowed(doc: XmlDocument, element: ElementNode, tag: Tag, resolve: Resolve): boolean {
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
const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// Le primitive dei filtri (formato della scena, risorse): un elenco chiuso,
/// quelle di SVG 1.1 che ogni lettore disegna allo stesso modo e l'ombra di
/// Filter Effects.
const PRIMITIVES: ReadonlySet<string> = new Set([
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
function gradientsOnly(resolve: Resolve): Resolve {
  return (id) => (resolve(id) === "gradient" ? "gradient" : null);
}

/// Vero se `element` è una `defs` della radice modificabile: solo `id` fra
/// gli attributi SVG.
function defsAllowed(element: ElementNode): boolean {
  return element.attrs.every((attr) => {
    if (attr.ns === NS_NONE) return attr.local === "id" && attr.value !== "";
    return attr.ns !== NS_XLINK && attr.ns !== NS_SVG;
  });
}

/// Vero se `value`, una coordinata di una risorsa, rientra nelle sue unità:
/// nel riquadro (`box`) un numero o una percentuale, altrimenti una
/// lunghezza.
function coordinate(value: string, box: boolean, nonNegative: boolean): boolean {
  const n = box ? fraction(value) : length(value);
  return n !== null && (!nonNegative || n >= 0);
}

/// Le coordinate di ogni risorsa, nelle sue unità.
const COORDINATES: Readonly<Partial<Record<ResourceTag, readonly string[]>>> = {
  linearGradient: ["x1", "y1", "x2", "y2"],
  radialGradient: ["cx", "cy", "r", "fx", "fy"],
  pattern: ["x", "y", "width", "height"],
  mask: ["x", "y", "width", "height"],
  filter: ["x", "y", "width", "height"],
};

/// Le coordinate che in `userSpaceOnUse` vanno scritte: mancando, SVG le
/// prenderebbe in percentuale del viewport.
const REQUIRED: Readonly<Partial<Record<ResourceTag, readonly string[]>>> = {
  linearGradient: ["x2"],
  radialGradient: ["cx", "cy", "r"],
  mask: ["x", "y", "width", "height"],
  filter: ["x", "y", "width", "height"],
};

/// L'attributo delle unità delle coordinate di ogni risorsa.
const UNITS: Readonly<Partial<Record<ResourceTag, string>>> = {
  linearGradient: "gradientUnits",
  radialGradient: "gradientUnits",
  pattern: "patternUnits",
  mask: "maskUnits",
  filter: "filterUnits",
};

/// Il giudizio su un attributo SVG senza namespace di una risorsa, con le
/// coordinate nel riquadro se `box`.
function resourceAttribute(tag: ResourceTag, name: string, value: string, box: boolean): boolean {
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
function resourceAllowed(doc: XmlDocument, element: ElementNode, tag: ResourceTag, resolve: Resolve): boolean {
  const id = valueOf(element, NS_NONE, "id");
  if (id === undefined || id === "") return false;
  const unitsName = UNITS[tag];
  const units = unitsName === undefined ? undefined : valueOf(element, NS_NONE, unitsName);
  const box = units === undefined || trim(units) !== "userSpaceOnUse";
  const attributes = element.attrs.every((attr) => {
    if (attr.ns === NS_NONE) return !hasUrl(attr.value) && resourceAttribute(tag, attr.local, attr.value, box);
    return attr.ns !== NS_XLINK && attr.ns !== NS_SVG;
  });
  if (!attributes) return false;
  // Una sfumatura con uno `stop` o nessuno è un colore pieno, o niente: le
  // sue coordinate non contano, nemmeno quelle del viewport.
  const stops = element.children.filter((child) => {
    const stop = doc.element(child);
    return stop !== null && isSvg(stop, "stop");
  }).length;
  const plain = (tag === "linearGradient" || tag === "radialGradient") && stops <= 1;
  if (!box && !plain && REQUIRED[tag]?.some((name) => valueOf(element, NS_NONE, name) === undefined)) return false;
  switch (tag) {
    case "linearGradient":
    case "radialGradient":
      return stopsAllowed(doc, element);
    case "filter":
      return primitivesAllowed(doc, element);
    default: {
      const inner = gradientsOnly(resolve);
      const clip = tag === "clipPath";
      return element.children.every((child) => contentAllowed(doc, child, clip, inner, 1));
    }
  }
}

/// Vero se `element`, un `path` in una `defs` della radice, è il tracciato di
/// un testo (formato della scena, testo): `id`, `d` e nessun altro attributo
/// SVG, e per figli soltanto `title` e `desc`.
function pathResourceAllowed(doc: XmlDocument, element: ElementNode): boolean {
  const id = valueOf(element, NS_NONE, "id");
  if (id === undefined || id === "" || valueOf(element, NS_NONE, "d") === undefined) return false;
  const attributes = element.attrs.every((attr) => {
    if (attr.ns === NS_NONE) return attr.local === "id" || (attr.local === "d" && parsePath(attr.value) !== null);
    return attr.ns !== NS_XLINK && attr.ns !== NS_SVG;
  });
  return attributes && element.children.every((child) => blankOrMeta(doc, child) === true);
}

/// Vero se un nodo è spazio, `title` o `desc` ammessi: i figli che ogni
/// risorsa può avere.
function blankOrMeta(doc: XmlDocument, child: NodeId): boolean | null {
  const node = doc.nodes[child]!;
  if (node.kind === "text") return node.blank;
  if (node.kind !== "element") return false;
  const tag = tagOf(node);
  return tag === "title" || tag === "desc" ? allowedPart(doc, child, false, NO_RESOURCES) : null;
}

/// Vero se i figli di una sfumatura sono ammessi: `stop`, al più
/// [`MAX_STOPS`], ognuno con `offset`, `stop-color` e `stop-opacity`.
function stopsAllowed(doc: XmlDocument, element: ElementNode): boolean {
  let stops = 0;
  for (const child of element.children) {
    const plain = blankOrMeta(doc, child);
    if (plain !== null) {
      if (!plain) return false;
      continue;
    }
    const stop = doc.element(child)!;
    if (!isSvg(stop, "stop") || ++stops > MAX_STOPS) return false;
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
    if (!attributes || !empty) return false;
  }
  return true;
}

/// Vero se `id`, nel contenuto di una risorsa, è ammesso: spazi, `title`,
/// `desc`, una forma, un testo e, fuori da un ritaglio, un `g` che ne
/// contiene, fino a [`MAX_CONTENT_DEPTH`] livelli.
function contentAllowed(doc: XmlDocument, id: NodeId, clip: boolean, resolve: Resolve, depth: number): boolean {
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
function resultName(value: string): boolean {
  if (value === "") return false;
  for (let i = 0; i < value.length; i++) if (isWsp(value.charCodeAt(i))) return false;
  return true;
}

/// I tipi di `feColorMatrix` e quanti numeri vuole `values` per ognuno.
const MATRIX_VALUES: ReadonlyMap<string, number> = new Map([
  ["matrix", 20],
  ["saturate", 1],
  ["hueRotate", 1],
  ["luminanceToAlpha", 0],
]);

/// Il giudizio su un attributo SVG senza namespace di una primitiva;
/// `input` dice se un ingresso è ammesso.
function primitiveAttribute(local: string, name: string, value: string, input: (value: string) => boolean): boolean {
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
function primitiveAllowed(doc: XmlDocument, element: ElementNode, results: ReadonlySet<string>): boolean {
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

/// Vero se i figli di un filtro sono ammessi: primitive dell'elenco, al più
/// [`MAX_PRIMITIVES`] coi `feMergeNode`, ognuna con ingressi che vengono
/// prima.
function primitivesAllowed(doc: XmlDocument, element: ElementNode): boolean {
  const results = new Set<string>();
  let count = 0;
  for (const child of element.children) {
    const plain = blankOrMeta(doc, child);
    if (plain !== null) {
      if (!plain) return false;
      continue;
    }
    const primitive = doc.element(child)!;
    if (primitive.ns !== NS_SVG || !PRIMITIVES.has(primitive.local)) return false;
    count += 1 + primitive.children.filter((inner) => doc.element(inner) !== null).length;
    if (count > MAX_PRIMITIVES || !primitiveAllowed(doc, primitive, results)) return false;
    const result = valueOf(primitive, NS_NONE, "result");
    if (result !== undefined) results.add(result);
  }
  return true;
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

/// L'indice delle risorse modificabili del documento: per ogni id, il tipo
/// della risorsa (formato della scena, risorse). Prima le sfumature e i
/// tracciati, che non rimandano a niente, poi le altre, che nel contenuto
/// possono usare le sfumature. Di due risorse con lo stesso id vale la prima,
/// in quest'ordine: il documento è comunque in sola lettura (S003).
export function resourceIndex(doc: XmlDocument): Map<string, ResourceKind> {
  return indexResources(doc).kinds;
}

/// Le risorse modificabili di un documento: il tipo di ognuna, il `d` dei
/// tracciati e il colore dei campioni.
interface Resources {
  readonly kinds: Map<string, ResourceKind>;
  readonly paths: Map<string, string>;
  readonly swatches: Map<string, Rgb>;
}

function indexResources(doc: XmlDocument): Resources {
  const kinds = new Map<string, ResourceKind>();
  const paths = new Map<string, string>();
  const swatches = new Map<string, Rgb>();
  const others: Array<[ElementNode, ResourceTag]> = [];
  const judge = (element: ElementNode, tag: ResourceTag | "path", resolve: Resolve): void => {
    const id = valueOf(element, NS_NONE, "id");
    if (id === undefined || kinds.has(id)) return;
    if (tag === "path" ? !pathResourceAllowed(doc, element) : !resourceAllowed(doc, element, tag, resolve)) return;
    kinds.set(id, resourceKind(tag)!);
    if (tag === "path") paths.set(id, valueOf(element, NS_NONE, "d")!);
    const swatch = valueOf(element, NS_FUB, "role") === "swatch" ? swatchOf(doc, element) : null;
    const color = swatch === null ? null : paint(swatch.color);
    if (color !== null && color !== "none") swatches.set(id, color);
  };
  for (const child of doc.children(doc.root)) {
    const defs = doc.element(child);
    if (defs === null || tagOf(defs) !== "defs" || !defsAllowed(defs)) continue;
    for (const inner of defs.children) {
      const element = doc.element(inner);
      const tag = element === null ? null : tagOf(element);
      if (element === null || tag === null || (tag !== "path" && !RESOURCE_TAGS.has(tag))) continue;
      if (tag === "linearGradient" || tag === "radialGradient" || tag === "path") judge(element, tag, NO_RESOURCES);
      else others.push([element, tag as ResourceTag]);
    }
  }
  const first: Resolve = (id) => kinds.get(id) ?? null;
  for (const [element, tag] of others) judge(element, tag, first);
  return { kinds, paths, swatches };
}

/// Le sfumature modificabili fra i figli di `parent`, per un `add` di più
/// risorse in una `defs`: il contenuto di un motivo che le segue le usa.
export function localGradients(doc: XmlDocument, parent: NodeId): Map<string, ResourceKind> {
  const found = new Map<string, ResourceKind>();
  for (const child of doc.children(parent)) {
    const element = doc.element(child);
    const tag = element === null ? null : tagOf(element);
    if (element === null || (tag !== "linearGradient" && tag !== "radialGradient")) continue;
    const id = valueOf(element, NS_NONE, "id");
    if (id !== undefined && !found.has(id) && resourceAllowed(doc, element, tag, NO_RESOURCES)) found.set(id, "gradient");
  }
  return found;
}

const UNIT_ROLES: Readonly<Partial<Record<Tag, Role>>> = {
  rect: "rect",
  ellipse: "ellipse",
  circle: "circle",
  line: "line",
  polyline: "polyline",
  polygon: "polygon",
  text: "text",
  image: "image",
};

/// Il ruolo di un figlio di un contenitore, o `null` se è estraneo. `place`
/// dice dov'è il contenitore: la radice decide livelli, carta e `defs`, una
/// `defs` della radice le risorse. `depth` è la lunghezza del percorso del
/// figlio, che per un contenitore oltre [`MAX_DEPTH`] lo rende estraneo.
/// `resolve` dice che cosa è la risorsa di ogni id a cui l'elemento rimanda.
export function classifyChild(doc: XmlDocument, id: NodeId, place: Place, depth: number, resolve: Resolve = NO_RESOURCES): [Tag, Role] | null {
  const found = classify(doc, id, place, resolve);
  // Un contenitore oltre la profondità massima è un'unità.
  return found !== null && isContainer(found[1]) && depth > MAX_DEPTH ? null : found;
}

function classify(doc: XmlDocument, id: NodeId, place: Place, resolve: Resolve): [Tag, Role] | null {
  const element = doc.element(id);
  if (element === null) return null;
  const tag = tagOf(element);
  if (tag === null) return null;
  if (tag === "defs") return place === "root" && defsAllowed(element) ? [tag, "defs"] : null;
  if (RESOURCE_TAGS.has(tag)) {
    return place === "defs" && resourceAllowed(doc, element, tag as ResourceTag, resolve) ? [tag, "resource"] : null;
  }
  // Un `path` in una `defs` è il tracciato di un testo (formato della scena,
  // testo).
  if (tag === "path" && place === "defs") return pathResourceAllowed(doc, element) ? [tag, "resource"] : null;
  // In una `defs` stanno solo risorse, titolo e descrizione.
  if (place === "defs" && tag !== "title" && tag !== "desc") return null;
  // Una tavola è un `view` della radice (formato della scena, tavole).
  if (tag === "view") return place === "root" && boardAllowed(doc, element, resolve) ? [tag, "board"] : null;
  if (!attributesAllowed(element, tag, resolve)) return null;
  const underRoot = place === "root";
  switch (tag) {
    case "g":
      return [tag, underRoot && valueOf(element, NS_FUB, "layer") !== undefined ? "layer" : "group"];
    case "a":
      return [tag, "link"];
    case "title":
    case "desc":
      return characterDataOnly(doc, element) ? [tag, tag] : null;
    case "tspan":
    case "textPath":
      return null;
    default: {
      if (!unitChildrenAllowed(doc, element, tag, resolve)) return null;
      if (tag === "path") return [tag, pathRole(element)];
      if (tag === "rect" && underRoot && valueOf(element, NS_FUB, "role") === "paper") return [tag, "paper"];
      return [tag, UNIT_ROLES[tag]!];
    }
  }
}

/// Vero se `element`, un `view` della radice, è una tavola (formato della
/// scena, tavole): `fub:role="board"`, un id, un `viewBox` largo e alto più di
/// zero, nessun altro attributo SVG e per figli soltanto titoli e
/// descrizioni.
function boardAllowed(doc: XmlDocument, element: ElementNode, resolve: Resolve): boolean {
  if (valueOf(element, NS_FUB, "role") !== "board" || !valueOf(element, NS_NONE, "id")) return false;
  if (boardBox(element) === null) return false;
  const attributes = element.attrs.every((attr) => {
    switch (attr.ns) {
      case NS_NONE:
        return attr.local === "id" || attr.local === "viewBox";
      case NS_SVG:
      case NS_XLINK:
        return false;
      default:
        return true;
    }
  });
  return attributes && element.children.every((child) => {
    const node = doc.nodes[child]!;
    if (node.kind === "text") return node.blank;
    return node.kind === "element" && allowedPart(doc, child, false, resolve);
  });
}

/// Il rettangolo di una tavola, dal suo `viewBox`, se è largo e alto più di
/// zero.
export function boardBox(element: ElementNode): [number, number, number, number] | null {
  const value = valueOf(element, NS_NONE, "viewBox");
  const box = value === undefined ? null : viewBox(value);
  return box !== null && box[2] > 0 && box[3] > 0 ? box : null;
}

/// Il ruolo di un `path`: tratto, freccia o tracciato.
function pathRole(element: ElementNode): Role {
  const tool = valueOf(element, NS_FUB, "tool");
  if (tool === "pen" || tool === "highlighter") return "stroke";
  // Uno strumento sconosciuto, o una forma sconosciuta, lasciano un
  // tracciato: la geometria si legge da `d` (§6).
  const shape = valueOf(element, NS_FUB, "shape");
  if (shape === "arrow" && arrowGeometry(element) !== null) return "arrow";
  if (shape === "connector" && connectorGeometry(element) !== null) return "connector";
  if (polygonalGeometry(element) !== null) return shape === "star" ? "star" : "ngon";
  if (widthGeometry(element) !== null) return "width";
  return "path";
}

/// `fub:geom` di un poligono regolare o di una stella, se si legge.
function polygonalGeometry(element: ElementNode): Polygonal | null {
  const shape = valueOf(element, NS_FUB, "shape");
  const geom = valueOf(element, NS_FUB, "geom");
  if (geom === undefined || (shape !== "polygon" && shape !== "star")) return null;
  return readPolygonal(shape, geom);
}

/// `fub:geom` di un contorno a spessore variabile, se si legge.
function widthGeometry(element: ElementNode): VarWidth | null {
  const geom = valueOf(element, NS_FUB, "geom");
  return geom === undefined || valueOf(element, NS_FUB, "shape") !== "width" ? null : readVarWidth(geom);
}

/// `fub:geom` di un connettore, se si legge.
function connectorGeometry(element: ElementNode): ConnectorGeom | null {
  const geom = valueOf(element, NS_FUB, "geom");
  return geom === undefined ? null : readConnectorGeom(geom);
}

/// Un capo di un connettore, `fub:from` o `fub:to`, se si legge.
function connectorEnd(element: ElementNode, name: "from" | "to"): ConnectorEnd | null {
  const value = valueOf(element, NS_FUB, name);
  return value === undefined ? null : readConnectorEnd(value);
}

/// `fub:geom` di una freccia: quattro numeri SVG.
function arrowGeometry(element: ElementNode): [number, number, number, number] | null {
  const geom = valueOf(element, NS_FUB, "geom");
  const numbers = geom === undefined ? null : numberList(geom);
  return numbers !== null && numbers.length === 4 ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!] : null;
}

/// Ciò che una voce dice di un elemento modificabile oltre a percorso,
/// span, rientro e tag: quello che dipende solo dall'elemento. Il motore
/// delle operazioni lo conserva per ogni elemento, e ne ricava le voci senza
/// rileggere il documento.
export interface Details {
  readonly tag: Tag;
  readonly role: Role;
  readonly id: string | null;
  readonly layer?: Layer;
  /// `fub:locked="true"` e `display="none"`, anche fuori dai livelli (§3).
  readonly locked?: true;
  readonly hidden?: true;
  readonly stroke?: Stroke;
  readonly arrow?: readonly [number, number, number, number];
  readonly connector?: ConnectorFacts;
  readonly polygonal?: Polygonal;
  readonly varwidth?: VarWidth;
  /// Il nome di un'unità, come [`ElementItem.title`]. Quello di un
  /// contenitore viene dai figli, e lo aggiunge chi li ha: la lettura intera
  /// e il modello, che riscrive il tag d'apertura senza rileggere i figli.
  readonly title?: string;
  readonly text?: string;
  readonly lines?: readonly string[];
  readonly wrap?: number;
  readonly textPath?: string;
  readonly along?: LabelPlace;
  readonly lifecycle?: Lifecycle;
  readonly swatch?: SwatchFacts;
  readonly motif?: MotifFacts;
  readonly box?: readonly [number, number, number, number];
  readonly board?: string;
}

/// Un problema di un tratto: S004 o S010, col dettaglio.
export type StrokeProblem = readonly [code: Code, detail: string];

/// Legge inchiostro e pennello di un tratto: S004 per ognuno che non si
/// legge, S010 per i canali sconosciuti.
export function readStroke(element: ElementNode): { stroke: Stroke; problems: StrokeProblem[] } {
  const tool: Tool = valueOf(element, NS_FUB, "tool") === "highlighter" ? "highlighter" : "pen";
  const problems: StrokeProblem[] = [];
  let ink: Ink | null = null;
  const inkText = valueOf(element, NS_FUB, "ink");
  if (inkText === undefined) {
    problems.push(["S004", new InkError("missing").detail]);
  } else {
    try {
      ink = decodeInk(inkText);
    } catch (error) {
      if (!(error instanceof InkError)) throw error;
      problems.push(["S004", error.detail]);
    }
  }
  const brushText = valueOf(element, NS_FUB, "brush");
  if (brushText === undefined) {
    problems.push(["S004", new BrushError("missing").detail]);
  } else {
    try {
      parseBrush(brushText);
    } catch (error) {
      if (!(error instanceof BrushError)) throw error;
      problems.push(["S004", error.detail]);
    }
  }
  if (ink !== null) {
    const unknown = unknownChannels(ink);
    if (unknown !== "") problems.push(["S010", unknown]);
  }
  const stroke: { tool: Tool; redrawable: boolean; samples?: number; duration?: number } = {
    tool,
    redrawable: problems.length === 0,
  };
  if (ink !== null) {
    stroke.samples = inkLength(ink);
    const duration = inkDuration(ink);
    if (duration !== null) stroke.duration = duration;
  }
  return { stroke, problems };
}

/// I dettagli di un elemento modificabile di ruolo `role`, coi problemi del
/// suo tratto se è un tratto.
export function describe(doc: XmlDocument, id: NodeId, tag: Tag, role: Role): { details: Details; problems: StrokeProblem[] } {
  const element = doc.element(id)!;
  const details: { -readonly [K in keyof Details]: Details[K] } = {
    tag,
    role,
    id: valueOf(element, NS_NONE, "id") ?? null,
  };
  let problems: StrokeProblem[] = [];
  if (role === "layer") {
    const display = valueOf(element, NS_NONE, "display");
    details.layer = {
      name: valueOf(element, NS_FUB, "layer") ?? "",
      locked: valueOf(element, NS_FUB, "locked") === "true",
      hidden: display !== undefined && trim(display) === "none",
    };
  }
  // Si bloccano e si nascondono i livelli e ciò che si disegna, non il
  // titolo, la descrizione, la carta o le risorse.
  if (role === "resource") {
    const lifecycle = valueOf(element, NS_FUB, "role");
    if (lifecycle === "private" || lifecycle === "shared") details.lifecycle = lifecycle;
    if (lifecycle === "swatch") {
      const swatch = swatchOf(doc, element);
      const motif = motifOf(element);
      if (swatch !== null) {
        details.lifecycle = "swatch";
        details.swatch = swatch;
      } else if (motif !== null) {
        details.lifecycle = "swatch";
        details.motif = motif;
      }
    }
    const title = firstTitle(doc, element);
    if (title !== null) details.title = title;
  } else if (role === "board") {
    // Una tavola non si blocca e non si nasconde (formato della scena,
    // tavole).
    details.box = boardBox(element)!;
    const title = firstTitle(doc, element);
    if (title !== null) details.title = title;
  } else if (role === "paper") {
    const board = valueOf(element, NS_FUB, "board");
    if (board !== undefined) details.board = board;
  } else if (role !== "title" && role !== "desc" && role !== "defs") {
    if (valueOf(element, NS_FUB, "locked") === "true") details.locked = true;
    const display = valueOf(element, NS_NONE, "display");
    if (display !== undefined && trim(display) === "none") details.hidden = true;
    const title = isContainer(role) ? null : firstTitle(doc, element);
    if (title !== null) details.title = title;
  }
  if (role === "stroke") {
    const read = readStroke(element);
    details.stroke = read.stroke;
    problems = read.problems;
  }
  if (role === "arrow") {
    const arrow = arrowGeometry(element);
    if (arrow !== null) details.arrow = arrow;
  }
  if (role === "connector") {
    const geom = connectorGeometry(element);
    if (geom !== null) details.connector = { geom, from: connectorEnd(element, "from"), to: connectorEnd(element, "to") };
  }
  if (role === "ngon" || role === "star") {
    const polygonal = polygonalGeometry(element);
    if (polygonal !== null) details.polygonal = polygonal;
  }
  if (role === "width") {
    const varwidth = widthGeometry(element);
    if (varwidth !== null) details.varwidth = varwidth;
  }
  if (role === "title" || role === "desc") details.text = characterData(doc, id);
  if (role === "text") {
    const path = textPathOf(doc, element);
    if (path !== null) {
      details.lines = [lineText(doc, path)];
      details.textPath = textPathTarget(doc.element(path)!)!;
    } else {
      details.lines = element.children
        .filter((child) => {
          const tspan = doc.element(child);
          return tspan !== null && isSvg(tspan, "tspan");
        })
        .map((child) => lineText(doc, child));
      const wrap = valueOf(element, NS_FUB, "wrap");
      const width = wrap === undefined ? null : wrapWidth(wrap);
      if (width !== null) details.wrap = width;
    }
    const along = valueOf(element, NS_FUB, "along");
    const place = along === undefined ? null : readLabelPlace(along);
    if (place !== null) details.along = place;
  }
  return { details, problems };
}

/// La voce di un elemento modificabile dai suoi dettagli e da dove sta.
export function elementItem(details: Details, path: readonly number[], span: Span, indent: string, tags: Tags | null): ElementItem {
  const item: { -readonly [K in keyof ElementItem]: ElementItem[K] } = {
    kind: "element",
    path,
    tag: details.tag,
    role: details.role,
    id: details.id,
    ...span,
    indent,
  };
  if (tags !== null) item.tags = tags;
  if (details.layer !== undefined) item.layer = details.layer;
  if (details.locked !== undefined) item.locked = details.locked;
  if (details.hidden !== undefined) item.hidden = details.hidden;
  if (details.stroke !== undefined) item.stroke = details.stroke;
  if (details.arrow !== undefined) item.arrow = details.arrow;
  if (details.connector !== undefined) item.connector = details.connector;
  if (details.polygonal !== undefined) item.polygonal = details.polygonal;
  if (details.varwidth !== undefined) item.varwidth = details.varwidth;
  if (details.title !== undefined) item.title = details.title;
  if (details.text !== undefined) item.text = details.text;
  if (details.lines !== undefined) item.lines = details.lines;
  if (details.wrap !== undefined) item.wrap = details.wrap;
  if (details.textPath !== undefined) item.textPath = details.textPath;
  if (details.along !== undefined) item.along = details.along;
  if (details.lifecycle !== undefined) item.lifecycle = details.lifecycle;
  if (details.swatch !== undefined) item.swatch = details.swatch;
  if (details.motif !== undefined) item.motif = details.motif;
  if (details.box !== undefined) item.box = details.box;
  if (details.board !== undefined) item.board = details.board;
  return item;
}

/// Un blocco estraneo in costruzione.
interface Pending {
  start: number;
  end: number;
  elements: [number, number];
}

/// Un contenitore in visita.
interface Frame {
  readonly node: NodeId;
  /// Dove stanno i suoi figli.
  readonly place: Place;
  readonly path: readonly number[];
  next: number;
  elements: number;
  pending: Pending | null;
  readonly context: Context;
}

/// Ciò che la classificazione trova.
export interface Classified {
  readonly items: Item[];
  /// S002, S004 e S010.
  readonly diagnostics: Diagnostic[];
  readonly tally: Tally;
}

function isXmlSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

class Builder {
  readonly items: Item[] = [];
  readonly diagnostics: Diagnostic[] = [];
  readonly tally: Tally;

  constructor(
    private readonly doc: XmlDocument,
    /// Falso per un documento oltre il limite di elementi: le voci si
    /// contano e si scartano, e restano solo riepilogo e diagnostica.
    private readonly keep: boolean,
    /// Le risorse modificabili del documento.
    private readonly resolve: Resolve,
    /// Il `d` dei tracciati delle risorse, per id.
    paths: ReadonlyMap<string, string>,
    /// I campioni del documento, col loro colore.
    private readonly swatches: Swatches,
  ) {
    this.tally = new Tally(paths);
  }

  /// Allunga il blocco in attesa fino a `id`; `element` è l'indice del nodo
  /// fra i figli elemento, se è un elemento. Un blocco comincia e finisce su
  /// un carattere che non è spazio: gli spazi ai bordi di un testo estraneo
  /// stanno fra due voci, come gli altri.
  extend(pending: Pending | null, id: NodeId, element: number | null, next: number): Pending {
    const node = this.doc.nodes[id]!;
    let start = node.start;
    let end = node.end;
    if (node.kind === "text") {
      const text = this.doc.source.text;
      while (start < end && isXmlSpace(text.charCodeAt(start))) start++;
      while (end > start && isXmlSpace(text.charCodeAt(end - 1))) end--;
    }
    const block = pending ?? { start, end, elements: [element ?? next, element ?? next] };
    block.end = end;
    if (element !== null) block.elements[1] = element + 1;
    return block;
  }

  flush(pending: Pending | null, parentPath: readonly number[] | null): void {
    if (pending === null) return;
    const span = this.doc.source.span(pending.start, pending.end);
    if (this.keep) {
      this.items.push({
        kind: "foreign",
        parentPath: parentPath === null ? null : [...parentPath],
        ...span,
        elements: pending.elements,
        indent: this.doc.source.indent(pending.start),
      });
    }
    this.tally.foreign();
    this.diagnostics.push(diagnostic("S002", span));
  }

  tags(id: NodeId): Tags {
    const element = this.doc.element(id)!;
    const source = this.doc.source;
    return {
      open: source.span(element.start, element.openEnd),
      close: element.closeStart === null ? null : source.span(element.closeStart, element.end),
    };
  }

  elementItem(id: NodeId, tag: Tag, role: Role, path: number[], context: Context): void {
    const doc = this.doc;
    const element = doc.element(id)!;
    const span = doc.source.span(element.start, element.end);
    const described = describe(doc, id, tag, role);
    const title = isContainer(role) ? firstTitle(doc, element) : null;
    const details = title === null ? described.details : { ...described.details, title };
    for (const [code, detail] of described.problems) this.diagnostics.push(diagnostic(code, span, detail));
    this.tally.element(doc, element, role, context, span, details.stroke ?? null);
    if (!this.keep) return;
    this.items.push(elementItem(details, path, span, doc.source.indent(element.start), isContainer(role) ? this.tags(id) : null));
  }

  /// Visita la radice e i contenitori modificabili, in ordine di documento.
  walk(root: NodeId): void {
    const doc = this.doc;
    const stack: Frame[] = [
      { node: root, place: "root", path: [], next: 0, elements: 0, pending: null, context: Context.root(doc.element(root)!, this.swatches) },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = doc.children(frame.node);
      const child = children[frame.next];
      if (child === undefined) {
        stack.pop();
        this.flush(frame.pending, frame.path);
        continue;
      }
      frame.next++;
      const node = doc.nodes[child]!;
      if (node.kind === "text" && node.blank) continue;
      if (node.kind !== "element") {
        frame.pending = this.extend(frame.pending, child, null, frame.elements);
        continue;
      }
      const index = frame.elements++;
      const found = classifyChild(doc, child, frame.place, frame.path.length + 1, this.resolve);
      if (found === null) {
        frame.pending = this.extend(frame.pending, child, index, frame.elements);
        continue;
      }
      const [tag, role] = found;
      const pending = frame.pending;
      frame.pending = null;
      const context = frame.context.child(node);
      this.flush(pending, frame.path);
      const path = [...frame.path, index];
      this.elementItem(child, tag, role, path, context);
      if (isContainer(role)) {
        const place: Place = role === "defs" ? "defs" : "inside";
        stack.push({ node: child, place, path, next: 0, elements: 0, pending: null, context });
      }
    }
  }
}

/// Classifica un documento letto per intero. Con `keep` falso le voci non si
/// conservano: un documento oltre il limite di elementi ne avrebbe troppe, e
/// serve solo il suo riepilogo.
export function classifyDocument(doc: XmlDocument, keep: boolean): Classified {
  const resources = indexResources(doc);
  const builder = new Builder(doc, keep, (id) => resources.kinds.get(id) ?? null, resources.paths, resources.swatches);
  let pending: Pending | null = null;
  // Per il documento la radice è l'elemento 0: l'epilogo comincia da 1.
  let next = 0;
  for (const id of doc.top) {
    const node = doc.nodes[id]!;
    if (node.kind === "text") continue;
    if (node.kind === "element") {
      builder.flush(pending, null);
      pending = null;
      if (keep) builder.items.push({ kind: "root", ...doc.source.span(node.start, node.end), tags: builder.tags(id) });
      builder.walk(id);
      next = 1;
    } else {
      pending = builder.extend(pending, id, null, next);
    }
  }
  builder.flush(pending, null);
  return { items: builder.items, diagnostics: builder.diagnostics, tally: builder.tally };
}
