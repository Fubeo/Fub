// Il lettore dei file di draw.io (diagrams.net): `.drawio`, `.dio`, l'XML di
// un modello, e i file che lo portano dentro un'immagine (`.drawio.svg`,
// `.drawio.png`). Dalle celle al diagramma da importare (`diagram.ts`), con
// le note di ciò che non entra.
//
// - **Le pagine** diventano tavole, l'una accanto all'altra nell'ordine del
//   file; una pagina sola non ne ha bisogno. Una pagina compressa si apre
//   qui (`inflate.ts`). I livelli di draw.io restano livelli.
// - **Le forme** comuni restano forme: il rettangolo col suo angolo,
//   l'ellisse, il rombo e le forme dei diagrammi di flusso, che FubDraw ha
//   nella raccolta; il triangolo, l'esagono, il parallelogramma e le altre
//   forme fatte di lati diventano un contorno uguale. Una forma che FubDraw
//   non ha, come le icone dei servizi cloud, diventa un rettangolo dei suoi
//   colori, e la nota ne dice il nome.
// - **Il testo** di una cella, scritto in HTML o no, è l'etichetta della
//   forma quando sta in mezzo; in alto, in basso o fuori dalla forma è un
//   testo a sé dove lo mette draw.io, in un gruppo con la forma.
// - **I contenitori**, le corsie (`swimlane`) e le tabelle, sono gruppi con
//   dentro i loro oggetti.
// - **Gli archi** agganciati sono connettori, dritti, a gomito o curvi, coi
//   capi sugli stessi oggetti e il percorso del file quando ne ha uno; uno
//   libero con più punti resta una linea con le punte. Le etichette restano
//   sulla linea.
//
// Le coordinate di una cella sono relative a quelle del genitore, e quelle
// di un arco al genitore dell'arco: qui diventano tutte della tela.

import { MAX_ELBOW_POINTS, type Anchor, type ConnectorKind } from "../scene/connectors";
import { BoundsBuilder, type Bounds, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { SourceText } from "../scene/text";
import { parseXml, XmlError, type ElementNode, type XmlDocument } from "../scene/xml";
import { CHAR_EM } from "../tools/measure";
import type { Dash } from "../tools/outline";
import { TEXT_FAMILY } from "../tools/text";
import type { TipShape, TipSize } from "../tools/tips";
import { fitCubic, orthogonal, runningLengths, sampled } from "./curves";
import { boxOf, hexColor, Notes, type Board, type Content, type Diagram, type End, type Fill, type Form, type Hook, type ImageNode, type Layer, type LineNode, type Look, type Node, type Rule, type Run, type ShapeNode, type Spin, type TextNode, type Type } from "./diagram";
import { htmlParagraphs } from "./html";
import { InflateError, inflateRaw, inflateZlib } from "./inflate";
import { labelBlocks, layoutBlocks, type Align, type Border, type Extent, type VAlign } from "./tables";

/// Le famiglie di FubDraw oltre a Inter.
const SERIF = "Literata, serif";
const MONO = "JetBrains Mono, monospace";

/// Il testo più lungo che una pagina compressa può diventare.
const PAGE_LIMIT = 64 * 1024 * 1024;

/// Lo spazio fra due pagine messe l'una accanto all'altra, e il margine di
/// una tavola attorno al suo contenuto quando la pagina non ha un formato.
const PAGE_GAP = 80;
const PAGE_MARGIN = 40;

/// Quanto un percorso curvo può scostarsi da quello del file prima che il
/// rapporto lo dica, come per Excalidraw.
const ROUTE_TOLERANCE = 4;
const ROUTE_SHARE = 0.03;

/// L'interlinea dei testi di draw.io (`mxConstants.LINE_HEIGHT`).
const LEADING = 1.2;

/// Perché un file non è un diagramma di draw.io.
export class NotDrawio extends Error {}

// ---------------------------------------------------------------------------
// Il file: le pagine, aperte.
// ---------------------------------------------------------------------------

/// Una pagina: il nome e il modello, nel documento che lo contiene.
interface Page {
  readonly name: string;
  readonly doc: XmlDocument;
  readonly model: ElementNode;
}

/// `text` letto come XML; [`NotDrawio`] se non lo è.
function xmlOf(text: string): XmlDocument {
  try {
    return parseXml(new SourceText(text), false);
  } catch (error) {
    if (error instanceof XmlError) throw new NotDrawio(`l'XML non si legge: ${error.message}`);
    throw error;
  }
}

/// Gli elementi figli di `id`, nell'ordine.
function elementsIn(doc: XmlDocument, element: ElementNode): ElementNode[] {
  return element.children.map((id) => doc.element(id)).filter((child): child is ElementNode => child !== null);
}

/// Il testo dentro `element`, senza i tag.
function textIn(doc: XmlDocument, element: ElementNode): string {
  let out = "";
  for (const id of element.children) {
    const node = doc.nodes[id]!;
    if (node.kind === "text" || node.kind === "cdata") out += node.value;
  }
  return out;
}

/// Il valore dell'attributo `name`, senza namespace.
function attr(element: ElementNode, name: string): string | undefined {
  return element.attrs.find((each) => each.ns === 0 && each.local === name)?.value;
}

/// Un numero di un attributo o di uno stile; `fallback` se non si legge.
function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/// Il testo di una pagina compressa: base64, deflate grezzo, e il testo
/// passato da `encodeURIComponent`.
function inflatePage(data: string): string {
  let binary: string;
  try {
    binary = atob(data.replace(/\s+/g, ""));
  } catch {
    throw new NotDrawio("una pagina compressa non è base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  let raw: Uint8Array;
  try {
    raw = inflateRaw(bytes, PAGE_LIMIT);
  } catch (error) {
    if (error instanceof InflateError) throw new NotDrawio(`una pagina compressa non si apre: ${error.message}`);
    throw error;
  }
  const text = new TextDecoder("utf-8").decode(raw);
  if (text.trimStart().startsWith("<")) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/// I caratteri di controllo che XML non ammette, e che draw.io toglie prima
/// di leggere (`Graph.zapGremlins`).
const GREMLINS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/// Le pagine di `text`: un `mxfile` con le sue pagine, un `mxGraphModel`
/// solo, o un SVG di draw.io col file nell'attributo `content`.
function pagesOf(text: string): Page[] {
  const doc = xmlOf(text.replace(GREMLINS, ""));
  const root = doc.element(doc.root)!;
  if (root.local === "svg") {
    const content = attr(root, "content");
    if (content === undefined || !/<(mxfile|mxGraphModel)[\s>]/.test(content.slice(0, 4096))) throw new NotDrawio("l'SVG non porta un diagramma di draw.io");
    return pagesOf(content);
  }
  if (root.local === "mxGraphModel") return [{ name: "", doc, model: root }];
  if (root.local !== "mxfile") throw new NotDrawio("non è un file di draw.io");
  const pages: Page[] = [];
  for (const diagram of elementsIn(doc, root)) {
    if (diagram.local !== "diagram") continue;
    const name = attr(diagram, "name") ?? "";
    const inline = elementsIn(doc, diagram).find((child) => child.local === "mxGraphModel");
    if (inline !== undefined) {
      pages.push({ name, doc, model: inline });
      continue;
    }
    const data = textIn(doc, diagram).trim();
    if (data === "") continue;
    const inner = xmlOf(inflatePage(data).replace(GREMLINS, ""));
    const model = inner.element(inner.root)!;
    if (model.local !== "mxGraphModel") throw new NotDrawio("una pagina non ha un modello");
    pages.push({ name, doc: inner, model });
  }
  return pages;
}

/// L'XML di draw.io dentro un PNG (`.drawio.png`): il pezzo `tEXt` o `zTXt`
/// che lo porta; `null` se il PNG non ne ha uno.
export function drawioInPng(bytes: Uint8Array): string | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  const latin = (from: number, to: number): string => {
    let out = "";
    for (let i = from; i < to; i++) out += String.fromCharCode(bytes[i]!);
    return out;
  };
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    const type = latin(at + 4, at + 8);
    const start = at + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return null;
    if (type === "tEXt" || type === "zTXt") {
      const zero = bytes.indexOf(0, start);
      const keyword = zero < 0 || zero >= end ? "" : latin(start, zero);
      if (keyword === "mxfile" || keyword === "mxGraphModel") {
        let value: string;
        if (type === "tEXt") {
          value = latin(zero + 1, end);
        } else {
          try {
            const inflated = inflateZlib(bytes.subarray(zero + 2, end), PAGE_LIMIT);
            value = "";
            for (const byte of inflated) value += String.fromCharCode(byte);
          } catch {
            return null;
          }
        }
        if (/^\s*%3C/i.test(value)) {
          try {
            value = decodeURIComponent(value);
          } catch {
            return null;
          }
        }
        return value;
      }
    }
    if (type === "IEND") return null;
    at = end + 4;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gli stili.
// ---------------------------------------------------------------------------

type Style = ReadonlyMap<string, string>;

/// Lo stile di partenza di una forma e di un arco (`defaultVertex`,
/// `defaultEdge` del foglio di stile di draw.io).
const VERTEX_STYLE: readonly (readonly [string, string])[] = [
  ["fontSize", "12"],
  ["fontFamily", "Helvetica"],
  ["align", "center"],
  ["verticalAlign", "middle"],
  ["fillColor", "default"],
  ["strokeColor", "default"],
  ["fontColor", "default"],
];
const EDGE_STYLE: readonly (readonly [string, string])[] = [
  ["fontSize", "11"],
  ["fontFamily", "Helvetica"],
  ["align", "center"],
  ["verticalAlign", "middle"],
  ["strokeColor", "default"],
  ["fontColor", "default"],
  ["endArrow", "classic"],
];

/// Gli stili con un nome del foglio di stile di draw.io, che una cella
/// nomina in testa al suo.
const NAMED: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  text: [
    ["fillColor", "none"],
    ["strokeColor", "none"],
    ["align", "left"],
    ["verticalAlign", "top"],
  ],
  edgeLabel: [
    ["fillColor", "none"],
    ["strokeColor", "none"],
    ["align", "left"],
    ["verticalAlign", "top"],
    ["fontSize", "11"],
  ],
  label: [
    ["fontStyle", "1"],
    ["align", "left"],
    ["verticalAlign", "middle"],
    ["spacing", "2"],
    ["spacingLeft", "52"],
    ["imageWidth", "42"],
    ["imageHeight", "42"],
    ["rounded", "1"],
  ],
  icon: [
    ["rounded", "1"],
    ["align", "center"],
    ["imageAlign", "center"],
    ["verticalLabelPosition", "bottom"],
    ["verticalAlign", "top"],
    ["spacing", "0"],
    ["spacingLeft", "0"],
    ["spacingTop", "6"],
    ["imageWidth", "48"],
    ["imageHeight", "48"],
  ],
  swimlane: [
    ["shape", "swimlane"],
    ["fontStyle", "1"],
    ["startSize", "23"],
  ],
  group: [
    ["verticalAlign", "top"],
    ["fillColor", "none"],
    ["strokeColor", "none"],
  ],
  ellipse: [["shape", "ellipse"]],
  rhombus: [["shape", "rhombus"]],
  triangle: [["shape", "triangle"]],
  line: [
    ["shape", "line"],
    ["strokeWidth", "4"],
    ["verticalAlign", "top"],
    ["spacingTop", "8"],
  ],
  image: [
    ["shape", "image"],
    ["verticalAlign", "top"],
    ["verticalLabelPosition", "bottom"],
  ],
  roundImage: [
    ["shape", "image"],
    ["verticalAlign", "top"],
    ["verticalLabelPosition", "bottom"],
  ],
  rhombusImage: [
    ["shape", "image"],
    ["verticalAlign", "top"],
    ["verticalLabelPosition", "bottom"],
  ],
  arrow: [
    ["shape", "arrow"],
    ["fillColor", "default"],
  ],
};

/// Le forme che una cella può nominare in testa allo stile senza `shape=`.
const BARE_SHAPES: ReadonlySet<string> = new Set(["cloud", "hexagon", "cylinder", "cylinder3", "doubleEllipse", "process", "document", "actor", "umlActor", "umlLifeline", "partialRectangle", "table", "tableRow", "callout", "parallelogram", "trapezoid", "step", "card", "note"]);

/// Lo stile di una cella: quello di partenza, gli stili coi nomi e le
/// coppie scritte, nell'ordine.
function styleOf(text: string, edge: boolean): Map<string, string> {
  const out = new Map<string, string>(edge ? EDGE_STYLE : VERTEX_STYLE);
  for (const part of text.split(";")) {
    const piece = part.trim();
    if (piece === "") continue;
    const eq = piece.indexOf("=");
    if (eq < 0) {
      const named = NAMED[piece];
      if (named !== undefined) for (const [key, value] of named) out.set(key, value);
      else if (BARE_SHAPES.has(piece) || piece.startsWith("mxgraph.")) out.set("shape", piece);
      continue;
    }
    out.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  return out;
}

/// Il colore della chiave `key`: `fallback` per «default», `null` per
/// «none»; di un `light-dark()` vale il chiaro.
function colorOf(style: Style, key: string, fallback: string): string | null {
  const value = style.get(key)?.trim();
  if (value === undefined || value === "" || value === "default" || value === "inherit") return fallback;
  if (value === "none" || value === "transparent") return null;
  const pair = /^light-dark\(\s*([^,]+),/i.exec(value);
  return hexColor(pair === null ? value : pair[1]) ?? fallback;
}

/// `color` a `alpha` sulla carta bianca: la trasparenza del solo
/// riempimento o del solo contorno, che FubDraw non ha.
function onPaper(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const a = Math.max(0, alpha);
  const mix = (at: number): string => Math.round(parseInt(color.slice(at, at + 2), 16) * a + 255 * (1 - a)).toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/// Vero se la chiave booleana `key` è accesa.
const on = (style: Style, key: string): boolean => style.get(key) === "1" || style.get(key) === "true";

/// Il tratteggio del menu che somiglia a `dashPattern`.
function dashOf(style: Style): Dash {
  if (!on(style, "dashed")) return "solid";
  const pattern = (style.get("dashPattern") ?? "").split(/[\s,]+/).filter((each) => each !== "").map(Number);
  if (pattern.length === 0 || pattern.some((each) => !Number.isFinite(each))) return "dashed";
  const dashes = pattern.filter((_, i) => i % 2 === 0);
  if (dashes.every((each) => each <= 1.5)) return "dotted";
  if (dashes.length >= 2 && Math.max(...dashes) > 2 * Math.min(...dashes)) return "dashdot";
  return "dashed";
}

/// I caratteri a mano che draw.io offre, che diventano Inter.
const HAND = /comic|marker|architects daughter|kalam|caveat|indie flower|xkcd|humor|patrick hand|gloria|shadows into light|virgil|excalifont|chalk|handlee|nanum pen/;

/// La famiglia di FubDraw per un carattere di draw.io, e la nota se è a
/// mano.
function familyOf(name: string, notes: Notes): string {
  const lower = name.toLowerCase();
  if (HAND.test(lower)) {
    notes.add("hand-font", name.split(",")[0]!.trim().replace(/^["']|["']$/g, ""));
    return TEXT_FAMILY;
  }
  if (/mono|courier|consolas|menlo|monaco|lucida console|source code|fira code/.test(lower)) return MONO;
  if (/times|georgia|garamond|palatino|book antiqua|cambria|baskerville|didot|bodoni|merriweather|playfair|lora|literata/.test(lower)) return SERIF;
  if (/(^|[\s,"'])serif/.test(lower)) return SERIF;
  return TEXT_FAMILY;
}

// ---------------------------------------------------------------------------
// Le celle.
// ---------------------------------------------------------------------------

interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly relative: boolean;
  readonly points: readonly Point[];
  readonly source: Point | null;
  readonly target: Point | null;
  /// Lo spostamento dell'etichetta di un arco dal suo punto sulla linea.
  readonly offset: Point | null;
}

/// Una cella del modello, coi campi che si leggono.
interface Cell {
  readonly id: string;
  readonly parent: string | null;
  readonly value: string;
  readonly style: Style;
  readonly vertex: boolean;
  readonly edge: boolean;
  readonly source: string | null;
  readonly target: string | null;
  readonly geometry: Geometry | null;
  readonly visible: boolean;
  readonly collapsed: boolean;
  /// Gli attributi dell'oggetto che avvolge la cella, per i segnaposto.
  readonly fields: ReadonlyMap<string, string>;
  readonly link: string | null;
}

/// La geometria di una cella.
function geometryOf(doc: XmlDocument, cell: ElementNode): Geometry | null {
  const element = elementsIn(doc, cell).find((child) => child.local === "mxGeometry");
  if (element === undefined) return null;
  const point = (each: ElementNode): Point => [num(attr(each, "x"), 0), num(attr(each, "y"), 0)];
  let points: Point[] = [];
  let source: Point | null = null;
  let target: Point | null = null;
  let offset: Point | null = null;
  for (const child of elementsIn(doc, element)) {
    const as = attr(child, "as");
    if (child.local === "Array" && as === "points") points = elementsIn(doc, child).filter((each) => each.local === "mxPoint").map(point);
    else if (child.local === "mxPoint" && as === "sourcePoint") source = point(child);
    else if (child.local === "mxPoint" && as === "targetPoint") target = point(child);
    else if (child.local === "mxPoint" && as === "offset") offset = point(child);
  }
  return {
    x: num(attr(element, "x"), 0),
    y: num(attr(element, "y"), 0),
    width: Math.max(0, num(attr(element, "width"), 0)),
    height: Math.max(0, num(attr(element, "height"), 0)),
    relative: attr(element, "relative") === "1",
    points,
    source,
    target,
    offset,
  };
}

/// I capi di un arco, come li dà il file.
interface Ends {
  readonly source: { readonly cell: Cell; readonly box: Bounds } | null;
  readonly target: { readonly cell: Cell; readonly box: Bounds } | null;
  readonly via: readonly Point[];
  readonly startFixed: Point | null;
  readonly endFixed: Point | null;
  readonly startAt: Point;
  readonly endAt: Point;
}

/// La geometria di un'etichetta a metà della sua linea.
const ON_LINE: Geometry = { x: 0, y: 0, width: 0, height: 0, relative: true, points: [], source: null, target: null, offset: null };

/// Le celle di un modello, nell'ordine del file.
function cellsOf(page: Page): Cell[] {
  const root = elementsIn(page.doc, page.model).find((child) => child.local === "root");
  if (root === undefined) return [];
  const out: Cell[] = [];
  for (const element of elementsIn(page.doc, root)) {
    let cell: ElementNode | undefined = element;
    let wrapper: ElementNode | null = null;
    if (element.local !== "mxCell") {
      wrapper = element;
      cell = elementsIn(page.doc, element).find((child) => child.local === "mxCell");
    }
    if (cell === undefined) continue;
    const id = attr(wrapper ?? cell, "id") ?? attr(cell, "id");
    if (id === undefined) continue;
    const fields = new Map<string, string>();
    if (wrapper !== null) for (const each of wrapper.attrs) if (each.ns === 0 && each.local !== "id" && each.local !== "label") fields.set(each.local, each.value);
    const edge = attr(cell, "edge") === "1";
    const link = wrapper === null ? null : (attr(wrapper, "link") ?? null);
    out.push({
      id,
      parent: attr(cell, "parent") ?? null,
      value: (wrapper === null ? attr(cell, "value") : attr(wrapper, "label")) ?? "",
      style: styleOf(attr(cell, "style") ?? "", edge),
      vertex: attr(cell, "vertex") === "1",
      edge,
      source: attr(cell, "source") ?? null,
      target: attr(cell, "target") ?? null,
      geometry: geometryOf(page.doc, cell),
      visible: attr(cell, "visible") !== "0",
      collapsed: attr(cell, "collapsed") === "1",
      fields,
      link: link === "" ? null : link,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Le forme.
// ---------------------------------------------------------------------------

/// Le forme di draw.io che FubDraw ha nella raccolta.
const LIBRARY: Readonly<Record<string, string>> = {
  rhombus: "basic-diamond",
  process: "flow-predefined",
  cylinder: "flow-database",
  cylinder3: "flow-database",
  datastore: "flow-database",
  document: "flow-document",
  cloud: "callout-cloud",
  internalStorage: "flow-internal-storage",
  manualInput: "flow-manual-input",
  delay: "flow-delay",
  offPageConnector: "flow-offpage",
  callout: "callout-rectangle",
  "mxgraph.flowchart.decision": "flow-decision",
  "mxgraph.flowchart.data": "flow-data",
  "mxgraph.flowchart.document": "flow-document",
  "mxgraph.flowchart.multi-document": "flow-multidocument",
  "mxgraph.flowchart.terminator": "flow-terminator",
  "mxgraph.flowchart.predefined_process": "flow-predefined",
  "mxgraph.flowchart.internal_storage": "flow-internal-storage",
  "mxgraph.flowchart.manual_input": "flow-manual-input",
  "mxgraph.flowchart.manual_operation": "flow-manual-operation",
  "mxgraph.flowchart.preparation": "flow-preparation",
  "mxgraph.flowchart.delay": "flow-delay",
  "mxgraph.flowchart.off-page_reference": "flow-offpage",
  "mxgraph.flowchart.database": "flow-database",
  "mxgraph.flowchart.stored_data": "flow-data",
  "mxgraph.basic.cloud_callout": "callout-cloud",
};

/// Le forme di draw.io che sono un rettangolo o un'ellisse.
const RECTS: ReadonlySet<string> = new Set(["", "rect", "rectangle", "label", "mxgraph.flowchart.process", "mxgraph.basic.rect"]);
const ELLIPSES: ReadonlySet<string> = new Set(["ellipse", "doubleEllipse", "mxgraph.flowchart.on-page_reference", "mxgraph.flowchart.start_1", "mxgraph.flowchart.start_2", "mxgraph.flowchart.or", "mxgraph.flowchart.summing_function"]);

/// Gli archi di draw.io a gomito.
const ORTHOGONAL: ReadonlySet<string> = new Set(["orthogonalEdgeStyle", "elbowEdgeStyle", "entityRelationEdgeStyle", "segmentEdgeStyle", "sideToSideEdgeStyle", "topToBottomEdgeStyle"]);

/// Gli stili a gomito semplici di draw.io, che fanno una curva sola.
const SIMPLE_ELBOWS: ReadonlySet<string> = new Set(["elbowEdgeStyle", "sideToSideEdgeStyle", "topToBottomEdgeStyle"]);

/// Il contorno su cui draw.io mette i capi di un arco: il riquadro della
/// forma, o l'ellisse o il rombo che vi stanno dentro.
type Perimeter = "rect" | "ellipse" | "rhombus";

/// Dove il raggio dal centro di `box` verso `toward` esce dal contorno
/// `kind`.
function rimOf(box: Bounds, kind: Perimeter, toward: Point): Point {
  if (kind === "rect") return rim(box, toward);
  const c = centreOf(box);
  const [hw, hh] = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2];
  const [dx, dy] = [toward[0] - c[0], toward[1] - c[1]];
  if (hw < 1e-9 || hh < 1e-9 || (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)) return c;
  const s = kind === "ellipse" ? 1 / Math.hypot(dx / hw, dy / hh) : 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  return [c[0] + dx * s, c[1] + dy * s];
}

/// Il punto del contorno `kind` di `box` sul raggio dal centro verso `at`,
/// dentro o fuori che sia: dove draw.io porta un punto fisso sul contorno.
function perimeterPoint(box: Bounds, kind: Perimeter, at: Point): Point {
  const c = centreOf(box);
  const [hw, hh] = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2];
  const [dx, dy] = [at[0] - c[0], at[1] - c[1]];
  if (hw < 1e-9 || hh < 1e-9 || (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)) return at;
  if (kind !== "rect") return rimOf(box, kind, at);
  const s = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return [c[0] + dx * s, c[1] + dy * s];
}

/// Il capo di un arco a gomito sul contorno `kind` di `box`, verso `next`,
/// come lo mette draw.io: dritto in su o in giù se `next` sta sopra o sotto
/// la forma, dritto di lato se le sta a fianco, se no verso il centro.
function orthogonalRim(box: Bounds, kind: Perimeter, next: Point): Point {
  const c = centreOf(box);
  const half = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2] as const;
  const within = (axis: 0 | 1): boolean => next[axis] >= box.min[axis] && next[axis] <= box.max[axis];
  for (const axis of [0, 1] as const) {
    if (!within(axis) || within(axis === 0 ? 1 : 0)) continue;
    // Lungo l'altro asse, fin dove arriva il contorno a quell'altezza.
    const other = axis === 0 ? 1 : 0;
    const f = half[axis] < 1e-9 ? 0 : Math.min(1, Math.abs(next[axis] - c[axis]) / half[axis]);
    const reach = kind === "rect" ? half[other] : kind === "ellipse" ? half[other] * Math.sqrt(1 - f * f) : half[other] * (1 - f);
    const out: [number, number] = [next[0], next[1]];
    out[other] = next[other] < c[other] ? c[other] - reach : c[other] + reach;
    return out;
  }
  return rimOf(box, kind, next);
}

/// Vero se `box` contiene il punto (`x`, `y`), bordi compresi.
const holds = (box: Bounds, x: number, y: number): boolean => x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1];

/// I vertici di mezzo di `sideToSideEdgeStyle` fra `s` e `t`, forme o punti,
/// come li fa draw.io: la curva in verticale, a metà fra le due o dove dice
/// il punto di passaggio `pt`, e le due uscite di lato all'altezza dei
/// centri, o di `pt` se ci sta.
function sideToSide(s: Bounds, t: Bounds, pt: Point | null): Point[] {
  const l = Math.max(s.min[0], t.min[0]);
  const r = Math.min(s.max[0], t.max[0]);
  const x = pt !== null ? pt[0] : Math.round(r + (l - r) / 2);
  let y1 = (s.min[1] + s.max[1]) / 2;
  let y2 = (t.min[1] + t.max[1]) / 2;
  if (pt !== null && pt[1] >= s.min[1] && pt[1] <= s.max[1]) y1 = pt[1];
  if (pt !== null && pt[1] >= t.min[1] && pt[1] <= t.max[1]) y2 = pt[1];
  const free = (y: number): boolean => !holds(s, x, y) && !holds(t, x, y);
  const out: Point[] = [];
  if (free(y1)) out.push([x, y1]);
  if (free(y2)) out.push([x, y2]);
  if (out.length === 1) {
    if (pt === null) out.push([x, (Math.max(s.min[1], t.min[1]) + Math.min(s.max[1], t.max[1])) / 2]);
    else if (free(pt[1])) out.push([x, pt[1]]);
  }
  return out;
}

/// `box` con gli assi scambiati.
const transposed = (box: Bounds): Bounds => ({ min: [box.min[1], box.min[0]], max: [box.max[1], box.max[0]] });

/// Il percorso di un arco `entityRelationEdgeStyle` dalla forma `source`
/// alla forma `target`, come lo fa draw.io: esce di lato dall'una ed entra di
/// lato nell'altra, coi due tratti lunghi `segment`; il tratto obliquo che
/// draw.io mette fra i due qui va a gomito, come ogni gomito di FubDraw.
function entityRoute(source: Bounds, target: Bounds, segment: number): { readonly points: Point[]; readonly sourceLeft: boolean; readonly targetLeft: boolean } {
  const sourceLeft = target.max[0] < source.min[0];
  const targetLeft = source.max[0] < target.min[0];
  const [x0, y0] = [sourceLeft ? source.min[0] : source.max[0], (source.min[1] + source.max[1]) / 2];
  const [xe, ye] = [targetLeft ? target.min[0] : target.max[0], (target.min[1] + target.max[1]) / 2];
  const departure = x0 + (sourceLeft ? -segment : segment);
  const arrival = xe + (targetLeft ? -segment : segment);
  let via: Point[];
  if (sourceLeft === targetLeft) {
    const x = sourceLeft ? Math.min(x0, xe) - segment : Math.max(x0, xe) + segment;
    via = [[x, y0], [x, ye]];
  } else if (departure < arrival === sourceLeft) {
    const middle = (y0 + ye) / 2;
    via = [[departure, y0], [departure, middle], [arrival, middle], [arrival, ye]];
  } else {
    const middle = (departure + arrival) / 2;
    via = [[middle, y0], [middle, ye]];
  }
  return { points: elbowThrough([x0, y0], via, [xe, ye], false, false), sourceLeft, targetLeft };
}

/// Il percorso di un messaggio `sequenceEdgeStyle` da `source` a `target`,
/// o dai capi liberi `startAt` ed `endAt`: orizzontale, all'altezza del punto
/// di passaggio `via`, o del capo libero, o della prima forma, dal lato di
/// una forma che guarda l'altra.
function sequenceRoute(source: Bounds | null, target: Bounds | null, startAt: Point, endAt: Point, via: Point | null): Point[] {
  const y = via?.[1] ?? (source === null ? startAt[1] : target === null ? endAt[1] : startAt[1]);
  const [from, to] = [source === null ? startAt[0] : centreOf(source)[0], target === null ? endAt[0] : centreOf(target)[0]];
  const x0 = source === null ? startAt[0] : to >= from ? source.max[0] : source.min[0];
  const xe = target === null ? endAt[0] : from <= to ? target.min[0] : target.max[0];
  return [
    [x0, y],
    [xe, y],
  ];
}

/// Il contorno chiuso di punti nel riquadro `w` × `h`, in frazioni.
function polygon(points: readonly Point[], w: number, h: number): Segment[] {
  const at = ([x, y]: Point): Point => [w > 0 ? x / w : 0, h > 0 ? y / h : 0];
  return [{ kind: "move", to: at(points[0]!) }, ...points.slice(1).map((p): Segment => ({ kind: "line", to: at(p) })), { kind: "close" }];
}

/// Il contorno della forma `shape` di draw.io in un riquadro `w` × `h`, in
/// frazioni, prima della direzione; `null` se non è una forma di lati.
function outlineOf(shape: string, style: Style, w: number, h: number): Segment[] | null {
  const fixed = on(style, "fixedSize");
  /// La misura `size` della forma: una frazione di `side`, o assoluta.
  const size = (fraction: number, absolute: number, side: number): number => {
    const value = num(style.get("size"), fixed ? absolute : fraction);
    return fixed ? Math.min(side, Math.max(0, value)) : side * Math.min(1, Math.max(0, value));
  };
  switch (shape) {
    case "triangle":
      return polygon([[0, 0], [w, h / 2], [0, h]], w, h);
    case "hexagon": {
      const s = size(0.25, 20, w);
      return polygon([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]], w, h);
    }
    case "parallelogram": {
      const s = size(0.2, 20, w);
      return polygon([[0, h], [s, 0], [w, 0], [w - s, h]], w, h);
    }
    case "trapezoid": {
      const s = size(0.2, 20, w);
      return polygon([[0, h], [s, 0], [w - s, 0], [w, h]], w, h);
    }
    case "step": {
      const s = size(0.2, 20, w);
      return polygon([[0, 0], [w - s, 0], [w, h / 2], [w - s, h], [0, h], [s, h / 2]], w, h);
    }
    case "card": {
      const s = Math.min(w, h, num(style.get("size"), 30));
      return polygon([[s, 0], [w, 0], [w, h], [0, h], [0, s]], w, h);
    }
    case "note": {
      const s = Math.min(w, h, num(style.get("size"), 30));
      return polygon([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]], w, h);
    }
    case "mxgraph.flowchart.loop_limit": {
      const s = Math.min(w / 2, h / 2, 20);
      return polygon([[s, 0], [w - s, 0], [w, s], [w, h], [0, h], [0, s]], w, h);
    }
    case "mxgraph.flowchart.extract_or_measurement":
      return polygon([[w / 2, 0], [w, h], [0, h]], w, h);
    case "mxgraph.flowchart.merge_or_storage":
      return polygon([[0, 0], [w, 0], [w / 2, h]], w, h);
    case "actor": {
      // `mxActor`: la testa e le spalle in quattro cubiche.
      const third = 1 / 3;
      return [
        { kind: "move", to: [0, 1] },
        { kind: "cubic", c1: [0, 0.6], c2: [0, 0.4], to: [0.5, 0.4] },
        { kind: "cubic", c1: [0.5 - third, 0.4], c2: [0.5 - third, 0], to: [0.5, 0] },
        { kind: "cubic", c1: [0.5 + third, 0], c2: [0.5 + third, 0.4], to: [0.5, 0.4] },
        { kind: "cubic", c1: [1, 0.4], c2: [1, 0.6], to: [1, 1] },
        { kind: "close" },
      ];
    }
    default:
      return null;
  }
}

/// `segments` girati per la direzione di draw.io (`east` è quella di
/// partenza) e ribaltati, sempre nel loro riquadro.
function directed(segments: readonly Segment[], direction: string, flipX: boolean, flipY: boolean): Segment[] {
  const turn = ([u, v]: Point): Point => {
    let p: Point = direction === "south" ? [1 - v, u] : direction === "north" ? [v, 1 - u] : direction === "west" ? [1 - u, 1 - v] : [u, v];
    if (flipX) p = [1 - p[0], p[1]];
    if (flipY) p = [p[0], 1 - p[1]];
    return p;
  };
  return segments.map((segment): Segment => {
    switch (segment.kind) {
      case "move":
      case "line":
        return { kind: segment.kind, to: turn(segment.to) };
      case "cubic":
        return { kind: "cubic", c1: turn(segment.c1), c2: turn(segment.c2), to: turn(segment.to) };
      default:
        return segment;
    }
  });
}

/// La punta di un capo e la nota se FubDraw la disegna diversa.
function tipOf(name: string | undefined, filled: boolean, size: number, notes: Notes): End | null {
  if (name === undefined || name === "" || name === "none") return null;
  const tipSize: TipSize = size < 5 ? "small" : size <= 8 ? "medium" : "large";
  const tip = (shape: TipShape, hollow = !filled): End => {
    if (hollow) notes.add("tip", name);
    return { shape, size: tipSize };
  };
  switch (name) {
    case "classic":
    case "classicThin":
    case "block":
    case "blockThin":
      return tip("triangle");
    case "open":
    case "openThin":
      return tip("vee", false);
    case "async":
    case "openAsync":
      return tip(name === "async" ? "triangle" : "vee", true);
    case "oval":
    case "circle":
    case "dot":
      return tip("circle", name === "circle" || !filled);
    case "diamond":
    case "diamondThin":
      return tip("diamond");
    case "box":
      return tip("square");
    case "dash":
    case "ERone":
      return tip("bar", false);
    case "ERmandOne":
    case "ERzeroToOne":
      return tip(name === "ERmandOne" ? "bar" : "circle", true);
    default:
      notes.add("tip", name);
      return null;
  }
}

/// Il lato di un aggancio fisso, in frazioni del riquadro: quello su cui
/// sta il punto; `auto` se il punto non è sul bordo.
function anchorOf(x: string | undefined, y: string | undefined): Anchor {
  if (x === undefined || y === undefined) return "auto";
  const [u, v] = [num(x, 0.5), num(y, 0.5)];
  if (Math.abs(u - 0.5) < 1e-6 && Math.abs(v - 0.5) < 1e-6) return "center";
  if (v <= 0) return "top";
  if (v >= 1) return "bottom";
  if (u <= 0) return "left";
  if (u >= 1) return "right";
  return "auto";
}

/// L'immagine di uno stile come `href`: nello stile il `;` separa le chiavi,
/// e draw.io scrive il base64 di un data URI senza `;base64`.
function imageHref(value: string): string {
  const data = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+),([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  return data === null ? value.trim() : `data:${data[1]};base64,${data[2]!.replace(/\s+/g, "")}`;
}

/// Il centro di un riquadro.
const centreOf = (box: Bounds): Point => [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];

/// `p` girato di `angle` gradi, in senso orario, attorno a `centre`.
function turned(p: Point, angle: number, centre: Point): Point {
  const a = (angle * Math.PI) / 180;
  const [x, y] = [p[0] - centre[0], p[1] - centre[1]];
  return [centre[0] + x * Math.cos(a) - y * Math.sin(a), centre[1] + x * Math.sin(a) + y * Math.cos(a)];
}

/// Il punto a `t` della lunghezza della spezzata `points`, e la direzione
/// del tratto su cui cade, di lunghezza uno.
function along(points: readonly Point[], t: number): { readonly at: Point; readonly direction: Point } {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]));
  let left = lengths.reduce((sum, length) => sum + length, 0) * t;
  for (const [i, length] of lengths.entries()) {
    if (length < 1e-9 || (left > length && i < lengths.length - 1)) {
      left -= length;
      continue;
    }
    const [a, b] = [points[i]!, points[i + 1]!];
    const f = Math.min(1, left / length);
    return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] };
  }
  return { at: points[0]!, direction: [1, 0] };
}

/// Quanto un testo può stare fuori dal mezzo della sua forma e restarne
/// l'etichetta, che FubDraw mette nel mezzo.
const OFF_CENTRE = 4;

/// `box` stretto di `before` e `after` lungo l'asse `axis`, fino al suo
/// mezzo.
function shrunk(box: Bounds, axis: 0 | 1, before: number, after: number): Bounds {
  const min: [number, number] = [box.min[0], box.min[1]];
  const max: [number, number] = [box.max[0], box.max[1]];
  min[axis] += before;
  max[axis] -= after;
  if (max[axis] < min[axis]) min[axis] = max[axis] = (min[axis] + max[axis]) / 2;
  return { min, max };
}

/// L'HTML di un'etichetta di draw.io: come lì, gli a capo in fondo sono
/// righe vuote, gli altri `br`.
function htmlText(raw: string): string {
  const tail = /(?:\r?\n)*$/.exec(raw)![0];
  return raw.slice(0, raw.length - tail.length).replace(/\r?\n/g, "<br>") + "<div><br></div>".repeat(tail.split("\n").length - 1);
}

/// Quante righe vuote ha `content` in cima e in fondo.
function blankEnds(content: Content): readonly [number, number] {
  const blank = content.paragraphs.map((runs) => runs.every((run) => run.text.trim() === ""));
  const lead = blank.indexOf(false);
  if (lead < 0) return [0, 0];
  return [lead, blank.length - 1 - blank.lastIndexOf(false)];
}

/// Vero se il testo `content`, nel mezzo della sua forma di stile `style`
/// per draw.io, ci sta anche per FubDraw: gli spazi attorno quasi pari, e
/// non più righe vuote in cima che in fondo, che FubDraw non tiene.
function balanced(style: Style, content: Content): boolean {
  const [lead, trail] = blankEnds(content);
  const dx = (num(style.get("spacingLeft"), 0) - num(style.get("spacingRight"), 0)) / 2;
  const dy = (num(style.get("spacingTop"), 0) - num(style.get("spacingBottom"), 0) + (lead - trail) * content.leading * content.type.size) / 2;
  return Math.abs(dx) <= OFF_CENTRE && Math.abs(dy) <= OFF_CENTRE;
}

/// Un testo di `content` col centro in `at`, senza riquadro.
function pointText(content: Content, at: Point, opacity: number): TextNode {
  const height = content.paragraphs.length * content.leading * content.type.size;
  const top = at[1] - height / 2;
  return {
    type: "text",
    key: "",
    locked: false,
    spin: null,
    at: [at[0], top + content.type.size],
    width: null,
    frame: { top, bottom: top + height, align: "middle" },
    content: { ...content, align: "middle" },
    opacity,
  };
}

/// Dove il raggio dal centro di `box` verso `toward` ne esce.
function rim(box: Bounds, toward: Point): Point {
  const c = centreOf(box);
  const [dx, dy] = [toward[0] - c[0], toward[1] - c[1]];
  const [hw, hh] = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2];
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return c;
  const scale = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return [c[0] + dx * Math.min(1, scale), c[1] + dy * Math.min(1, scale)];
}

/// Il punto da cui un arco a gomito esce da `box` verso `toward`: dritto in
/// verticale se `toward` sta sopra o sotto, in orizzontale se sta di lato;
/// se no dal lato che lo guarda. Dice anche se il primo tratto è verticale.
function exitTowards(box: Bounds, toward: Point): { readonly at: Point; readonly vertical: boolean } {
  const c = centreOf(box);
  if (toward[0] >= box.min[0] && toward[0] <= box.max[0] && (toward[1] < box.min[1] || toward[1] > box.max[1])) {
    return { at: [toward[0], toward[1] < box.min[1] ? box.min[1] : box.max[1]], vertical: true };
  }
  if (toward[1] >= box.min[1] && toward[1] <= box.max[1]) {
    return { at: [toward[0] < c[0] ? box.min[0] : box.max[0], toward[1]], vertical: false };
  }
  return { at: [toward[0] < c[0] ? box.min[0] : box.max[0], c[1]], vertical: false };
}

/// I punti di una linea a gomito da `start` a `end` attraverso `via`: fra
/// due punti che non sono in fila si gira una volta, alternando la
/// direzione. `first` e `last` dicono se il primo e l'ultimo tratto sono
/// verticali.
function elbowThrough(start: Point, via: readonly Point[], end: Point, first: boolean | null, last: boolean | null): Point[] {
  const all = [start, ...via, end];
  const out: Point[] = [start];
  let vertical = first;
  for (let i = 1; i < all.length; i++) {
    const a = out[out.length - 1]!;
    const b = all[i]!;
    const aligned = Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5;
    if (!aligned) {
      // L'ultimo tratto entra nel suo lato; gli altri alternano.
      let goVertical = vertical === null ? Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) : !vertical;
      if (i === 1 && first !== null) goVertical = first;
      if (i === all.length - 1 && last !== null) goVertical = !last;
      out.push(goVertical ? [a[0], b[1]] : [b[0], a[1]]);
      vertical = !goVertical;
    } else {
      vertical = Math.abs(a[0] - b[0]) < 0.5;
    }
    out.push(b);
  }
  // Via i punti doppi e quelli in mezzo a un tratto dritto.
  const clean: Point[] = [];
  for (const p of out) {
    const last2 = clean[clean.length - 1];
    if (last2 !== undefined && Math.abs(last2[0] - p[0]) < 0.01 && Math.abs(last2[1] - p[1]) < 0.01) continue;
    clean.push(p);
    while (clean.length >= 3) {
      const [a, b, c] = [clean[clean.length - 3]!, clean[clean.length - 2]!, clean[clean.length - 1]!];
      const straight = (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01);
      if (!straight) break;
      clean.splice(clean.length - 2, 1);
    }
  }
  return clean;
}

/// La curva di un arco curvo di draw.io: quadratiche da un punto di mezzo
/// all'altro, coi punti di passaggio per controllo (`mxConnector`).
function curvedThrough(points: readonly Point[]): Segment[] {
  const out: Segment[] = [{ kind: "move", to: points[0]! }];
  if (points.length < 3) {
    for (const p of points.slice(1)) out.push({ kind: "line", to: p });
    return out;
  }
  let at = points[0]!;
  const quad = (control: Point, to: Point): void => {
    // Una quadratica è una cubica coi controlli a due terzi.
    out.push({ kind: "cubic", c1: [at[0] + ((control[0] - at[0]) * 2) / 3, at[1] + ((control[1] - at[1]) * 2) / 3], c2: [to[0] + ((control[0] - to[0]) * 2) / 3, to[1] + ((control[1] - to[1]) * 2) / 3], to });
    at = to;
  };
  for (let i = 1; i < points.length - 2; i++) {
    const [p, q] = [points[i]!, points[i + 1]!];
    quad(p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
  }
  quad(points[points.length - 2]!, points[points.length - 1]!);
  return out;
}

// ---------------------------------------------------------------------------
// Il lettore.
// ---------------------------------------------------------------------------

/// Legge `text`, un file di draw.io. Lancia [`NotDrawio`] se non lo è.
export function readDrawio(text: string): Diagram {
  const pages = pagesOf(text);
  const notes = new Notes();
  const layers: { name: string; hidden: boolean; locked: boolean; nodes: Node[] }[] = [];
  const boards: Board[] = [];
  let background: string | null = null;
  let right: number | null = null;
  let top: number | null = null;
  pages.forEach((page, i) => {
    const prefix = pages.length > 1 ? `${i}:` : "";
    const read = new PageReader(page, prefix, notes).read();
    const extent = extentOf(read.layers.flatMap((layer) => layer.nodes));
    if (extent === null) return;
    if (i === 0 || background === null) {
      const paper = attr(page.model, "background");
      if (paper !== undefined && paper !== "none") background = hexColor(paper);
    }
    let frame = extent;
    if (pages.length > 1) {
      // La tavola è il foglio di draw.io, o i fogli che il disegno occupa;
      // senza fogli, il disegno con un margine.
      const [pw, ph] = [num(attr(page.model, "pageWidth"), 0) * num(attr(page.model, "pageScale"), 1), num(attr(page.model, "pageHeight"), 0) * num(attr(page.model, "pageScale"), 1)];
      frame =
        attr(page.model, "page") !== "0" && pw > 0 && ph > 0
          ? { min: [Math.floor(extent.min[0] / pw) * pw, Math.floor(extent.min[1] / ph) * ph], max: [Math.ceil(extent.max[0] / pw) * pw, Math.ceil(extent.max[1] / ph) * ph] }
          : { min: [extent.min[0] - PAGE_MARGIN, extent.min[1] - PAGE_MARGIN], max: [extent.max[0] + PAGE_MARGIN, extent.max[1] + PAGE_MARGIN] };
    }
    const [dx, dy] = right === null || top === null ? [0, 0] : [right + PAGE_GAP - frame.min[0], top - frame.min[1]];
    if (right === null || top === null) top = frame.min[1];
    right = frame.max[0] + dx;
    if (pages.length > 1) boards.push({ name: page.name, box: { min: [frame.min[0] + dx, frame.min[1] + dy], max: [frame.max[0] + dx, frame.max[1] + dy] } });
    read.layers.forEach((layer, j) => {
      const nodes = layer.nodes.map((node) => shifted(node, dx, dy));
      const into = layers[j];
      if (into === undefined) layers.push({ ...layer, nodes });
      else into.nodes.push(...nodes);
    });
  });
  return { source: "drawio", background: background === "#ffffff" ? null : background, layers, boards, notes: notes.list() };
}

/// Il riquadro, a stima, di `nodes`.
function extentOf(nodes: readonly Node[]): Bounds | null {
  const out = new BoundsBuilder();
  const box = (bounds: Bounds): void => {
    out.include(bounds.min);
    out.include(bounds.max);
  };
  const visit = (node: Node): void => {
    switch (node.type) {
      case "shape":
      case "image":
        box(node.box);
        return;
      case "text": {
        const width = node.width ?? 0;
        const left = node.content.align === "start" ? node.at[0] : node.content.align === "end" ? node.at[0] - width : node.at[0] - width / 2;
        box({ min: [left, node.frame?.top ?? node.at[1]], max: [left + width, node.frame?.bottom ?? node.at[1]] });
        return;
      }
      case "path":
        node.points.forEach((p) => out.include(p));
        return;
      case "line":
        out.include(node.from.at);
        out.include(node.to.at);
        node.route?.forEach((p) => out.include(p));
        return;
      case "ink":
        node.samples.forEach((s) => out.include([s.x, s.y]));
        return;
      case "group":
        node.children.forEach(visit);
        return;
    }
  };
  nodes.forEach(visit);
  return out.finish();
}

/// Un rettangolo che non si vede sul riquadro `box`: il contorno a cui si
/// agganciano gli archi di una cella che non ne ha uno, o lo ha a pezzi.
/// Porta il nome della cella, `name`, perché un connettore dica a che cosa
/// è agganciato.
function hookBox(box: Bounds, name: string): Node {
  return { type: "shape", key: "", locked: false, spin: null, box, form: { kind: "rect", corner: 0 }, look: { stroke: null, fill: null, opacity: 1 }, label: null, name };
}

/// Le parole di `content` su una riga.
const wordsOf = (content: Content): string =>
  content.paragraphs
    .map((runs) => runs.map((run) => run.text).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/// Le parole del primo testo di `nodes`, o della prima etichetta; vuoto se
/// non ne hanno.
function nameIn(nodes: readonly Node[]): string {
  for (const node of nodes) {
    const content = node.type === "text" ? node.content : node.type === "shape" ? node.label : null;
    const words = content === null ? "" : wordsOf(content);
    if (words !== "") return words;
    if (node.type === "group") {
      const inner = nameIn(node.children);
      if (inner !== "") return inner;
    }
  }
  return "";
}

/// Le parole di tutti i testi di `nodes`, come quelle di una riga di una
/// tabella fatta di celle; vuoto se fra loro c'è altro che testi e righe.
function rowName(nodes: readonly Node[]): string {
  const words: string[] = [];
  const walk = (each: readonly Node[]): boolean =>
    each.every((node) => {
      if (node.type === "group") return walk(node.children);
      if (node.type === "text") words.push(wordsOf(node.content));
      return node.type === "text" || node.type === "path" || node.type === "line";
    });
  return walk(nodes) ? words.filter((word) => word !== "").join(" ") : "";
}

/// `node` spostato di (`dx`, `dy`).
function shifted(node: Node, dx: number, dy: number): Node {
  if (dx === 0 && dy === 0) return node;
  const p = (q: Point): Point => [q[0] + dx, q[1] + dy];
  const b = (box: Bounds): Bounds => ({ min: p(box.min), max: p(box.max) });
  const spin = node.spin === null ? null : { ...node.spin, centre: p(node.spin.centre) };
  switch (node.type) {
    case "shape":
      return { ...node, spin, box: b(node.box) };
    case "image":
      return { ...node, spin, box: b(node.box), flip: node.flip === null ? null : { ...node.flip, centre: p(node.flip.centre) } };
    case "text":
      return { ...node, spin, at: p(node.at), frame: node.frame === null ? null : { ...node.frame, top: node.frame.top + dy, bottom: node.frame.bottom + dy } };
    case "path":
      return { ...node, spin, points: node.points.map(p) };
    case "line": {
      const hook = (h: Hook): Hook => ({ ...h, at: p(h.at) });
      return { ...node, spin, from: hook(node.from), to: hook(node.to), route: node.route === null ? null : node.route.map(p) };
    }
    case "ink":
      return { ...node, spin, samples: node.samples.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) };
    case "group":
      return { ...node, spin, children: node.children.map((child) => shifted(child, dx, dy)) };
  }
}

/// I campi comuni a ogni nodo.
type BaseOf = { readonly key: string; readonly locked: boolean; readonly spin: Spin | null };

/// Dove sta il testo di una cella, nella tela.
interface Placed {
  /// Il riquadro in cui il testo si allinea.
  readonly box: Bounds;
  /// La rotazione del testo, oltre a quella della cella.
  readonly vertical: boolean;
}

/// Le chiavi dello stile che possono valere «inherit», il valore del
/// genitore, e quelle che possono valere «swimlane», il riempimento della
/// corsia attorno.
const INHERITED = ["strokeColor", "fillColor", "fontColor", "strokeWidth", "gradientColor", "labelBackgroundColor", "labelBorderColor"];
const FROM_LANE = ["strokeColor", "fillColor", "fontColor", "gradientColor", "labelBackgroundColor", "labelBorderColor"];

/// Il lettore di una pagina.
class PageReader {
  private readonly cells: Cell[];
  private readonly byId = new Map<string, Cell>();
  private readonly children = new Map<string, Cell[]>();
  private readonly boxes = new Map<string, Bounds | null>();
  /// Gli archi di cui si sta stimando la linea, contro i giri.
  private readonly walking = new Set<string>();
  /// Le celle a cui si aggancia un arco.
  private readonly hooked = new Set<string>();
  /// Vero se la pagina getta l'ombra di tutto ciò che disegna, testi
  /// compresi: l'ombra del pannello «Diagramma» di draw.io.
  private readonly shadows: boolean;

  constructor(
    page: Page,
    private readonly prefix: string,
    private readonly notes: Notes,
  ) {
    this.cells = cellsOf(page);
    this.shadows = attr(page.model, "shadow") === "1";
    for (const cell of this.cells) if (!this.byId.has(cell.id)) this.byId.set(cell.id, cell);
    // I colori «inherit» prendono quelli del genitore, e i colori «swimlane»
    // il riempimento della corsia che contiene la cella, o la cella stessa:
    // per un arco, quella dell'oggetto a cui arriva.
    const resolved = new Set<string>();
    const resolve = (cell: Cell, depth: number): void => {
      if (resolved.has(cell.id) || depth > 64) return;
      resolved.add(cell.id);
      const style = cell.style as Map<string, string>;
      const parent = cell.parent === null ? undefined : this.byId.get(cell.parent);
      for (const key of INHERITED) {
        if (style.get(key) !== "inherit") continue;
        if (parent !== undefined && parent.vertex) resolve(parent, depth + 1);
        const value = parent !== undefined && parent.vertex ? parent.style.get(key) : undefined;
        if (value === undefined || value === "inherit") style.delete(key);
        else style.set(key, value);
      }
      if (!FROM_LANE.some((key) => style.get(key) === "swimlane")) return;
      let lane = cell.edge && cell.target !== null ? this.byId.get(cell.target) : cell;
      for (let steps = 0; lane !== undefined && lane.style.get("shape") !== "swimlane" && steps < 64; steps++) lane = lane.parent === null ? undefined : this.byId.get(lane.parent);
      if (lane !== undefined && lane !== cell) resolve(lane, depth + 1);
      const fill = lane?.style.get("fillColor");
      for (const key of FROM_LANE) {
        if (style.get(key) !== "swimlane") continue;
        if (fill === undefined || fill === "swimlane" || fill === "inherit") style.set(key, key === "strokeColor" || key === "fontColor" ? "#000000" : "#ffffff");
        else style.set(key, fill);
      }
    };
    for (const cell of this.cells) resolve(cell, 0);
    for (const cell of this.cells) {
      if (cell.edge && cell.source !== null) this.hooked.add(cell.source);
      if (cell.edge && cell.target !== null) this.hooked.add(cell.target);
    }
    for (const cell of this.cells) {
      if (cell.parent === null || cell.parent === cell.id) continue;
      const list = this.children.get(cell.parent);
      if (list === undefined) this.children.set(cell.parent, [cell]);
      else list.push(cell);
    }
  }

  read(): { readonly layers: Layer[] } {
    const roots = this.cells.filter((cell) => cell.parent === null || !this.byId.has(cell.parent));
    const layers: Layer[] = [];
    for (const root of roots) {
      // Una radice coi livelli, come la scrive draw.io; o celle senza
      // livello, che vanno nel primo.
      const below = this.children.get(root.id) ?? [];
      if (!root.vertex && !root.edge && below.length > 0 && below.every((cell) => !cell.vertex && !cell.edge)) {
        for (const layer of below) {
          layers.push({
            name: layer.value.trim(),
            hidden: !layer.visible,
            locked: on(layer.style, "locked"),
            nodes: this.nodesIn(layer.id, null),
          });
        }
      } else if (root.vertex || root.edge) {
        const nodes = this.cell(root, null);
        if (layers.length === 0) layers.push({ name: "", hidden: false, locked: false, nodes: [] });
        (layers[0]!.nodes as Node[]).push(...nodes);
      }
    }
    return { layers };
  }

  /// La chiave di una cella nel diagramma: l'id, col numero della pagina se
  /// le pagine sono più d'una.
  private key(id: string): string {
    return this.prefix + id;
  }

  /// I nodi delle celle figlie di `parent`, nell'ordine.
  private nodesIn(parent: string, box: Bounds | null): Node[] {
    return (this.children.get(parent) ?? []).flatMap((cell) => this.cell(cell, box));
  }

  /// Il riquadro di una forma nella tela; `null` se non ne ha uno.
  private boxOfCell(cell: Cell): Bounds | null {
    if (this.boxes.has(cell.id)) return this.boxes.get(cell.id)!;
    this.boxes.set(cell.id, null);
    const g = cell.geometry;
    let out: Bounds | null = null;
    if (g !== null && cell.vertex) {
      const parent = cell.parent === null ? undefined : this.byId.get(cell.parent);
      const parentBox = parent !== undefined && parent.vertex ? this.boxOfCell(parent) : null;
      if (parent !== undefined && parent.edge && g.relative) {
        // L'etichetta di un arco, che un altro arco può agganciare: attorno
        // al suo punto sulla linea.
        const at = this.labelPoint(parent, g);
        out = at === null ? null : boxOf(at[0] - g.width / 2, at[1] - g.height / 2, g.width, g.height);
      } else if (parentBox !== null && g.relative) {
        const [pw, ph] = [parentBox.max[0] - parentBox.min[0], parentBox.max[1] - parentBox.min[1]];
        out = boxOf(parentBox.min[0] + g.x * pw, parentBox.min[1] + g.y * ph, g.width, g.height);
      } else {
        const [ox, oy] = parentBox === null ? this.origin(cell) : parentBox.min;
        out = boxOf(ox + g.x, oy + g.y, g.width, g.height);
      }
    }
    this.boxes.set(cell.id, out);
    return out;
  }

  /// L'origine delle coordinate dei figli del genitore di `cell`: l'angolo
  /// della forma genitore, o l'origine della tela.
  private origin(cell: Cell): Point {
    const parent = cell.parent === null ? undefined : this.byId.get(cell.parent);
    if (parent === undefined || !parent.vertex) return [0, 0];
    return this.boxOfCell(parent)?.min ?? [0, 0];
  }

  /// I nodi di una cella e di ciò che contiene.
  private cell(cell: Cell, parentBox: Bounds | null): Node[] {
    if (!cell.visible) return [];
    if (cell.edge) {
      this.cellNotes(cell);
      return this.edge(cell);
    }
    if (!cell.vertex) return this.nodesIn(cell.id, parentBox);
    this.cellNotes(cell);
    const box = this.boxOfCell(cell);
    if (box === null) return [];
    let own = this.own(cell, box);
    // Una cella che non si vede, come la riga di una tabella, tiene il suo
    // riquadro per gli archi che vi si agganciano.
    if (this.hooked.has(cell.id) && !own.some((node) => node.type === "shape")) own = [hookBox(box, nameIn(own)), ...own];
    const inner = cell.collapsed ? [] : this.nodesIn(cell.id, box).concat(this.tableLines(cell, box));
    const nodes = [...own, ...inner];
    if (nodes.length === 0) return [];
    if (nodes.length === 1 && inner.length === 0) return [{ ...nodes[0]!, key: this.key(cell.id) } as Node];
    // Una cella che non disegna niente e ne tiene una sola, come la riga di
    // una tabella con una cella, non fa un gruppo di un oggetto.
    if (nodes.length === 1 && own.length === 0) return nodes;
    // Gli archi toccano il contorno della forma, non il testo accanto né ciò
    // che contiene: se ne ha una, ci si aggancia a lei.
    const outline = nodes.findIndex((node) => node.type === "shape");
    if (outline >= 0 && outline < own.length) {
      // Un contorno senza etichetta dentro prende il nome dal testo della
      // cella, perché un connettore dica a che cosa è agganciato.
      const shape = nodes[outline] as ShapeNode;
      const name = this.hooked.has(cell.id) && shape.label === null && (shape.name ?? "") === "" ? nameIn(own) || rowName(inner) : "";
      const hooked: Node = name === "" ? { ...shape, key: this.key(cell.id) } : { ...shape, key: this.key(cell.id), name };
      const children = nodes.map((node, i) => (i === outline ? hooked : node));
      return [{ type: "group", key: "", locked: on(cell.style, "locked"), spin: null, name: "", children }];
    }
    return [{ type: "group", key: this.key(cell.id), locked: on(cell.style, "locked"), spin: null, name: "", children: nodes }];
  }

  /// Vero se una cella con lo stile `style` getta un'ombra: dal suo disegno
  /// (`shadow`) o dal suo testo (`textShadow`).
  private shadowed(style: Style, key: "shadow" | "textShadow"): boolean {
    return this.shadows || on(style, key);
  }

  /// L'aspetto di una cella: il contorno, il riempimento, l'opacità e
  /// l'ombra, se disegna qualcosa che la getti.
  private look(style: Style, filled: boolean): Look {
    const strokeColor = colorOf(style, "strokeColor", "#000000");
    const width = num(style.get("strokeWidth"), 1);
    const stroke = strokeColor === null || width <= 0 ? null : { color: onPaper(strokeColor, num(style.get("strokeOpacity"), 100) / 100), width, dash: dashOf(style) };
    let fill: Fill | null = null;
    if (filled) {
      const color = colorOf(style, "fillColor", "#ffffff");
      if (color !== null) fill = { kind: "color", color: onPaper(color, num(style.get("fillOpacity"), 100) / 100) };
    }
    const opacity = Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100));
    return (stroke !== null || fill !== null) && this.shadowed(style, "shadow") ? { stroke, fill, opacity, shadow: true } : { stroke, fill, opacity };
  }

  /// Le note di una cella, una volta per cella: il tratto a mano, la
  /// sfumatura e il collegamento.
  private cellNotes(cell: Cell): void {
    const style = cell.style;
    if (on(style, "sketch") || on(style, "comic")) this.notes.add("rough");
    const gradient = style.get("gradientColor");
    if (cell.vertex && gradient !== undefined && gradient !== "none" && gradient !== "" && colorOf(style, "fillColor", "#ffffff") !== null) this.notes.add("fill", "gradient");
    if (cell.link !== null) this.notes.add("link", cell.link);
  }

  /// Il carattere del testo di una cella; le note vanno in `notes`.
  private typeOf(style: Style, edge: boolean, notes = this.notes): Type | null {
    const color = colorOf(style, "fontColor", "#000000");
    if (color === null) return null;
    const bits = num(style.get("fontStyle"), 0);
    return {
      family: familyOf(style.get("fontFamily") ?? "Helvetica", notes),
      size: Math.max(1, num(style.get("fontSize"), edge ? 11 : 12)),
      color: onPaper(color, num(style.get("textOpacity"), 100) / 100),
      bold: (bits & 1) !== 0,
      italic: (bits & 2) !== 0,
      underline: (bits & 4) !== 0,
      strike: (bits & 8) !== 0,
    };
  }

  /// Il testo di una cella: `null` se non ne ha uno che si legge.
  private contentOf(cell: Cell, edge: boolean): Content | null {
    const type = this.typeOf(cell.style, edge);
    if (type === null) return null;
    const raw = this.filled(cell, cell.value);
    if (raw.trim() === "") return null;
    const align = cell.style.get("align") === "left" ? "start" : cell.style.get("align") === "right" ? "end" : "middle";
    let paragraphs: Run[][];
    let rules: Rule[] = [];
    if (on(cell.style, "html")) {
      ({ paragraphs, rules } = htmlParagraphs(htmlText(raw), type, (name) => familyOf(name, this.notes), this.notes));
    } else {
      paragraphs = raw.split(/\r\n|\r|\n/).map((line) => (line === "" ? [] : [{ text: line, type: null }]));
    }
    if (paragraphs.every((runs) => runs.every((run) => run.text.trim() === ""))) return null;
    const content: Content = rules.length === 0 ? { type, align, leading: LEADING, paragraphs } : { type, align, leading: LEADING, paragraphs, rules };
    return this.shadowed(cell.style, "textShadow") ? { ...content, shadow: true } : content;
  }

  /// `raw` coi segnaposto `%nome%` presi dagli attributi della cella e dei
  /// suoi genitori; quelli che non si trovano restano, e la nota in `notes`
  /// lo dice.
  private filled(cell: Cell, raw: string, notes = this.notes): string {
    if (!on(cell.style, "placeholders") && cell.fields.get("placeholders") !== "1") return raw;
    return raw.replace(/%([A-Za-z_][\w.-]*)%/g, (whole, name: string) => {
      for (let at: Cell | undefined = cell; at !== undefined; at = at.parent === null ? undefined : this.byId.get(at.parent)) {
        const value = at.fields.get(name);
        if (value !== undefined) return value;
      }
      notes.add("placeholder", whole);
      return whole;
    });
  }

  /// Il riquadro del testo di una cella in `box`, coi margini e la
  /// posizione del testo dentro o fuori dalla forma.
  private placed(style: Style, box: Bounds): Placed {
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    let [x, y] = box.min;
    const position = style.get("labelPosition");
    const vertical = style.get("verticalLabelPosition");
    if (position === "left") x -= w;
    else if (position === "right") x += w;
    if (vertical === "top") y -= h;
    else if (vertical === "bottom") y += h;
    const spacing = num(style.get("spacing"), 2);
    const left = spacing + num(style.get("spacingLeft"), 0);
    const right = spacing + num(style.get("spacingRight"), 0);
    const top = spacing + num(style.get("spacingTop"), 0);
    const bottom = spacing + num(style.get("spacingBottom"), 0);
    const labelWidth = num(style.get("labelWidth"), NaN);
    const width = Number.isFinite(labelWidth) ? labelWidth : w;
    const dx = Number.isFinite(labelWidth) ? (w - labelWidth) / 2 : 0;
    return {
      box: { min: [x + dx + left, y + top], max: [x + dx + Math.max(left, width - right), y + Math.max(top, h - bottom)] },
      vertical: style.get("horizontal") === "0",
    };
  }

  /// Vero se il testo di una cella sta in mezzo alla forma, dove FubDraw
  /// mette l'etichetta.
  private centred(style: Style): boolean {
    const position = style.get("labelPosition") ?? "center";
    const vertical = style.get("verticalLabelPosition") ?? "middle";
    return position === "center" && vertical === "middle" && (style.get("verticalAlign") ?? "middle") === "middle" && !Number.isFinite(num(style.get("labelWidth"), NaN));
  }

  /// Il testo `content` di una cella in `box`, girato di `rotation` gradi
  /// attorno al centro della cella `centre`.
  private textNode(whole: Content, style: Style, box: Bounds, rotation: number, centre: Point, locked: boolean): TextNode {
    const placed = this.placed(style, box);
    // Le righe vuote in cima e in fondo, che FubDraw non tiene, restano nel
    // posto del testo.
    const [lead, trail] = blankEnds(whole);
    const line = whole.leading * whole.type.size;
    const content: Content =
      lead + trail === 0 || lead + trail >= whole.paragraphs.length
        ? whole
        : { ...whole, paragraphs: whole.paragraphs.slice(lead, whole.paragraphs.length - trail), ...(whole.rules === undefined ? {} : { rules: whole.rules.map((rule) => ({ ...rule, paragraph: rule.paragraph - lead })) }) };
    const inner = content === whole ? placed.box : shrunk(placed.box, placed.vertical ? 0 : 1, lead * line, trail * line);
    const middle = turned(centreOf(inner), rotation, centre);
    const [w, h] = placed.vertical ? [inner.max[1] - inner.min[1], inner.max[0] - inner.min[0]] : [inner.max[0] - inner.min[0], inner.max[1] - inner.min[1]];
    // Il testo si scrive diritto attorno al centro del suo riquadro, che la
    // rotazione della cella sposta, e poi gira.
    const [left, top] = [middle[0] - w / 2, middle[1] - h / 2];
    // Le righe orizzontali vanno da un lato all'altro del riquadro: il testo
    // ci va a capo.
    const wrap = style.get("whiteSpace") === "wrap" || content.rules !== undefined;
    const x = content.align === "start" ? left : content.align === "end" ? left + w : left + w / 2;
    const align = style.get("verticalAlign") === "top" ? "top" : style.get("verticalAlign") === "bottom" ? "bottom" : "middle";
    const angle = rotation + (placed.vertical ? -90 : 0);
    return {
      type: "text",
      key: "",
      locked,
      spin: Math.abs(angle % 360) < 1e-9 ? null : { angle, centre: middle },
      at: [x, top + content.type.size],
      width: wrap ? Math.max(1, w) : null,
      frame: { top, bottom: top + h, align },
      content,
      opacity: Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100)),
    };
  }

  /// Una forma col suo testo: l'etichetta se sta in mezzo, se no un testo a
  /// sé accanto alla forma.
  private shaped(cell: Cell, box: Bounds, form: Form, filled = true, labelled = true): Node[] {
    const style = cell.style;
    const rotation = num(style.get("rotation"), 0);
    const centre = centreOf(box);
    const locked = on(style, "locked");
    if (labelled) {
      const table = this.tabled(cell, box);
      if (table !== null) return [...this.shaped(cell, box, form, filled, false), ...table];
    }
    const content = labelled ? this.contentOf(cell, false) : null;
    const look = this.look(style, filled);
    let shapeBox = box;
    let angle = rotation;
    let inside = content !== null && content.rules === undefined && this.centred(style) && balanced(style, content);
    // Un testo in verticale dentro un rettangolo o un'ellisse: la forma gira
    // col testo, ed è la stessa.
    if (inside && style.get("horizontal") === "0") {
      if (form.kind === "rect" || form.kind === "ellipse") {
        const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
        shapeBox = { min: [centre[0] - h / 2, centre[1] - w / 2], max: [centre[0] + h / 2, centre[1] + w / 2] };
        angle = rotation - 90;
      } else {
        inside = false;
      }
    }
    const spin: Spin | null = Math.abs(angle % 360) < 1e-9 ? null : { angle, centre };
    const shape: ShapeNode = { type: "shape", key: "", locked, spin, form, box: shapeBox, look, label: inside ? content : null };
    if (content === null || inside) return [shape];
    return [shape, this.textNode(content, style, box, rotation, centre, locked)];
  }

  /// L'etichetta di una cella che ha una tabella HTML: la griglia delle
  /// celle e il testo attorno, come li mette il browser in draw.io; `null`
  /// se non ne ha una, o se la cella è girata.
  private tabled(cell: Cell, box: Bounds): Node[] | null {
    const style = cell.style;
    if (!on(style, "html") || style.get("horizontal") === "0" || Math.abs(num(style.get("rotation"), 0) % 360) > 1e-9) return null;
    // Si guarda prima senza contare le note: se non c'è una tabella, il
    // testo lo legge `contentOf`, e le note si contano una volta sola.
    const quiet = new Notes();
    const probe = this.typeOf(style, false, quiet) === null ? null : this.filled(cell, cell.value, quiet);
    const blocks = probe === null || !/<table/i.test(probe) ? null : labelBlocks(htmlText(probe));
    if (blocks === null) return null;
    const type = this.typeOf(style, false)!;
    this.filled(cell, cell.value);
    const fill = style.get("overflow") === "fill";
    const placed = this.placed(style, box).box;
    const [w, h] = [placed.max[0] - placed.min[0], placed.max[1] - placed.min[1]];
    const align: Align = style.get("align") === "left" ? "start" : style.get("align") === "right" ? "end" : "middle";
    const valign: VAlign = style.get("verticalAlign") === "top" ? "top" : style.get("verticalAlign") === "bottom" ? "bottom" : "middle";
    const typeFor = (header: boolean): Type => (header ? { ...type, bold: true } : type);
    const scratch = new Notes();
    const extent = (html: string, header: boolean): Extent => {
      const base = typeFor(header);
      const { paragraphs } = htmlParagraphs(html, base, (name) => familyOf(name, scratch), scratch);
      const written = paragraphs.some((runs) => runs.some((run) => run.text.trim() !== ""));
      if (!written) return { width: 0, height: 0 };
      const width = Math.max(0, ...paragraphs.map((runs) => runs.reduce((sum, run) => sum + [...run.text].length * CHAR_EM * (run.type?.size ?? base.size), 0)));
      return { width, height: paragraphs.length * LEADING * base.size };
    };
    const room = { box: placed, width: fill || style.get("whiteSpace") === "wrap" ? w : null, height: fill ? h : null, align, valign };
    const locked = on(style, "locked");
    const opacity = Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100));
    // La tabella è dell'etichetta, e getta l'ombra del testo.
    const shadow = this.shadowed(style, "textShadow");
    const rect = (bounds: Bounds, fillColor: string | null, border: Border | null): ShapeNode | null =>
      fillColor === null && border === null
        ? null
        : {
            type: "shape",
            key: "",
            locked,
            spin: null,
            form: { kind: "rect", corner: 0 },
            box: bounds,
            look: { stroke: border === null ? null : { color: border.color, width: border.width, dash: "solid" }, fill: fillColor === null ? null : { kind: "color", color: fillColor }, opacity, ...(shadow ? { shadow } : {}) },
            label: null,
          };
    // Un pezzo di HTML scritto in area nel riquadro `bounds`.
    const text = (html: string, bounds: Bounds, header: boolean, textAlign: Align, frameAlign: VAlign): TextNode | null => {
      const base = typeFor(header);
      const { paragraphs, rules } = htmlParagraphs(html, base, (name) => familyOf(name, this.notes), this.notes);
      if (paragraphs.every((runs) => runs.every((run) => run.text.trim() === ""))) return null;
      const content: Content = { type: base, align: textAlign, leading: LEADING, paragraphs, ...(rules.length === 0 ? {} : { rules }), ...(shadow ? { shadow } : {}) };
      const width = Math.max(1, bounds.max[0] - bounds.min[0]);
      const x = textAlign === "start" ? bounds.min[0] : textAlign === "end" ? bounds.max[0] : (bounds.min[0] + bounds.max[0]) / 2;
      return { type: "text", key: "", locked, spin: null, at: [x, bounds.min[1] + base.size], width, frame: { top: bounds.min[1], bottom: bounds.max[1], align: frameAlign }, content, opacity };
    };
    const out: Node[] = [];
    for (const block of layoutBlocks(blocks, room, extent)) {
      if (block.kind === "html") {
        const node = text(block.html, block.box, false, align, "top");
        if (node !== null) out.push(node);
        continue;
      }
      const frame = rect(block.box, block.fill, block.border);
      if (frame !== null) out.push(frame);
      for (const each of block.cells) {
        const back = rect(each.box, each.fill, each.border);
        if (back !== null) out.push(back);
        const node = text(each.html, each.inner, each.header, each.align, each.valign);
        if (node !== null) out.push(node);
      }
    }
    return out;
  }

  /// Il testo di una cella senza forma.
  private bare(cell: Cell, box: Bounds): Node[] {
    const table = this.tabled(cell, box);
    if (table !== null) return table;
    const content = this.contentOf(cell, false);
    if (content === null) return [];
    return [this.textNode(content, cell.style, box, num(cell.style.get("rotation"), 0), centreOf(box), on(cell.style, "locked"))];
  }

  /// Ciò che una forma disegna da sé, senza ciò che contiene.
  private own(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const shape = style.get("shape") ?? "";
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    const direction = style.get("direction") ?? "east";
    const flipX = on(style, "flipH");
    const flipY = on(style, "flipV");
    const invisible = colorOf(style, "fillColor", "#ffffff") === null && colorOf(style, "strokeColor", "#000000") === null;
    switch (shape) {
      case "swimlane":
      case "table":
        return this.swimlane(cell, box);
      case "tableRow":
        // Una riga di tabella non disegna niente: le righe sono della tabella.
        return this.bare(cell, box);
      case "partialRectangle":
        return this.partial(cell, box);
      case "mxgraph.ios7ui.horLines":
        // Il fondo coi soli lati in alto e in basso, come un archivio dei
        // diagrammi di flusso dei dati.
        return this.partial({ ...cell, style: new Map([...style, ["top", "1"], ["bottom", "1"], ["left", "0"], ["right", "0"]]) }, box);
      case "line":
        return this.line(cell, box);
      case "image":
        return this.image(cell, box);
      case "umlLifeline":
        return this.lifeline(cell, box);
      case "umlActor":
        return this.stickman(cell, box);
      case "singleArrow":
      case "doubleArrow": {
        const double = shape === "doubleArrow";
        const id = direction === "north" ? (double ? "arrow-up-down" : "arrow-up") : direction === "south" ? (double ? "arrow-up-down" : "arrow-down") : direction === "west" ? (double ? "arrow-left-right" : "arrow-left") : double ? "arrow-left-right" : "arrow-right";
        return this.shaped(cell, box, { kind: "library", id });
      }
    }
    const outline = outlineOf(shape, style, direction === "north" || direction === "south" ? h : w, direction === "north" || direction === "south" ? w : h);
    const library = LIBRARY[shape];
    if (invisible && (RECTS.has(shape) || ELLIPSES.has(shape) || outline !== null || library !== undefined)) {
      const icon = RECTS.has(shape) && style.get("image") !== undefined ? this.icon(style, box) : null;
      return icon === null ? this.bare(cell, box) : [icon, ...this.bare(cell, box)];
    }
    if (RECTS.has(shape)) {
      const shaped = this.shaped(cell, box, { kind: "rect", corner: this.corner(style, w, h) });
      const icon = style.get("image") === undefined ? null : this.icon(style, box);
      if (icon === null) return shaped;
      return [shaped[0]!, icon, ...shaped.slice(1)];
    }
    if (ELLIPSES.has(shape)) {
      if (shape === "doubleEllipse") this.notes.add("stencil", shape);
      return this.shaped(cell, box, { kind: "ellipse" });
    }
    if (outline !== null) return this.shaped(cell, box, { kind: "outline", segments: directed(outline, direction, flipX, flipY) });
    if (library !== undefined) {
      if (direction === "east" || library === "basic-diamond") return this.shaped(cell, box, { kind: "library", id: library });
      // Una forma della raccolta girata: la forma gira, il testo no.
      const angle = direction === "south" ? 90 : direction === "north" ? -90 : 180;
      const centre = centreOf(box);
      const turnedBox: Bounds = angle === 180 ? box : { min: [centre[0] - h / 2, centre[1] - w / 2], max: [centre[0] + h / 2, centre[1] + w / 2] };
      const [form] = this.shaped({ ...cell, style: new Map([...style, ["rotation", String(num(style.get("rotation"), 0) + angle)]]) }, turnedBox, { kind: "library", id: library }, true, false);
      const content = this.contentOf(cell, false);
      return content === null ? [form!] : [form!, this.textNode(content, style, box, num(style.get("rotation"), 0), centre, on(style, "locked"))];
    }
    // Una forma che FubDraw non ha: un rettangolo dei suoi colori, o
    // tratteggiato in grigio se non ne ha.
    this.notes.add("stencil", shape);
    if (invisible) {
      const placeholder = new Map(style);
      placeholder.set("strokeColor", "#999999");
      placeholder.set("dashed", "1");
      placeholder.delete("dashPattern");
      return this.shaped({ ...cell, style: placeholder }, box, { kind: "rect", corner: 0 });
    }
    return this.shaped(cell, box, { kind: "rect", corner: 0 });
  }

  /// L'immagine `image` di un rettangolo (`mxLabel`): `imageWidth` ×
  /// `imageHeight`, nel lato e all'altezza che dicono `imageAlign` e
  /// `imageVerticalAlign`; `null` se sta fuori dal file.
  private icon(style: Style, box: Bounds): Node | null {
    const href = imageHref(style.get("image") ?? "");
    if (!href.startsWith("data:image/")) {
      this.notes.add("image", href.length > 80 ? `${href.slice(0, 79)}…` : href);
      return null;
    }
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    const [iw, ih] = [num(style.get("imageWidth"), 24), num(style.get("imageHeight"), 24)];
    const spacing = num(style.get("spacing"), 2) + 5;
    const align = style.get("imageAlign") ?? "left";
    const valign = style.get("imageVerticalAlign") ?? "middle";
    const x = align === "center" ? box.min[0] + (w - iw) / 2 : align === "right" ? box.max[0] - iw - spacing : box.min[0] + spacing;
    const y = valign === "top" ? box.min[1] + spacing : valign === "bottom" ? box.max[1] - ih - spacing : box.min[1] + (h - ih) / 2;
    const image: ImageNode = { type: "image", key: "", locked: on(style, "locked"), spin: null, href, box: boxOf(x, y, iw, ih), opacity: Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100)), crop: null, flip: null };
    return this.shadowed(style, "shadow") ? { ...image, shadow: true } : image;
  }

  /// L'angolo tondo di un rettangolo di draw.io (`arcSize`): una parte del
  /// lato più corto, o assoluto.
  private corner(style: Style, w: number, h: number): number {
    if (!on(style, "rounded")) return 0;
    if (on(style, "absoluteArcSize")) return Math.min(w / 2, h / 2, num(style.get("arcSize"), 20) / 2);
    return (Math.min(w, h) * num(style.get("arcSize"), 15)) / 100;
  }

  /// Una corsia o una tabella: il riquadro intero, la testata col titolo e,
  /// in una tabella, le righe fra righe e colonne.
  private swimlane(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const size = Math.max(0, num(style.get("startSize"), 40));
    const horizontal = style.get("horizontal") !== "0";
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    const corner = this.corner(style, w, h);
    const body = new Map(style);
    body.set("fillColor", style.get("swimlaneFillColor") ?? "none");
    const whole = this.shaped({ ...cell, style: body }, box, { kind: "rect", corner }, true, false);
    if (size <= 0) {
      const content = this.contentOf(cell, false);
      const top = new Map(style);
      top.set("verticalAlign", "top");
      return content === null ? whole : [...whole, this.textNode(content, top, box, num(style.get("rotation"), 0), centreOf(box), on(style, "locked"))];
    }
    const header: Bounds = horizontal ? { min: box.min, max: [box.max[0], Math.min(box.max[1], box.min[1] + size)] } : { min: box.min, max: [Math.min(box.max[0], box.min[0] + size), box.max[1]] };
    const head = new Map(style);
    if (style.get("swimlaneLine") === "0") head.set("strokeColor", "none");
    head.delete("labelPosition");
    head.delete("verticalLabelPosition");
    return [...whole, ...this.shaped({ ...cell, style: head }, header, { kind: "rect", corner: Math.min(corner, size / 2) })];
  }

  /// Le righe fra le righe e le colonne di una tabella (`rowLines`,
  /// `columnLines`), sotto la testata.
  private tableLines(cell: Cell, box: Bounds): Node[] {
    if (cell.style.get("shape") !== "table") return [];
    const rows = (this.children.get(cell.id) ?? []).filter((row) => row.vertex && row.visible);
    const look = this.look(cell.style, false);
    if (look.stroke === null || rows.length === 0) return [];
    const out: Node[] = [];
    const line = (a: Point, b: Point): Node => ({ type: "path", key: "", locked: false, spin: null, points: [a, b], smooth: false, closed: false, look, start: null, end: null });
    if (cell.style.get("rowLines") !== "0") {
      for (const row of rows.slice(1)) {
        const rowBox = this.boxOfCell(row);
        if (rowBox !== null) out.push(line([box.min[0], rowBox.min[1]], [box.max[0], rowBox.min[1]]));
      }
    }
    if (cell.style.get("columnLines") !== "0") {
      const first = rows[0]!;
      const top = this.boxOfCell(first)?.min[1] ?? box.min[1];
      for (const column of (this.children.get(first.id) ?? []).filter((each) => each.vertex && each.visible).slice(1)) {
        const columnBox = this.boxOfCell(column);
        if (columnBox !== null) out.push(line([columnBox.min[0], top], [columnBox.min[0], box.max[1]]));
      }
    }
    return out;
  }

  /// Un rettangolo coi soli lati scritti (`partialRectangle`): il fondo
  /// senza contorno, e i lati come linee.
  private partial(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const sides = (["top", "right", "bottom", "left"] as const).map((side) => style.get(side) !== "0");
    const noStroke = new Map(style);
    noStroke.set("strokeColor", "none");
    const filled = colorOf(style, "fillColor", "#ffffff") !== null;
    const nodes: Node[] = filled ? this.shaped({ ...cell, style: noStroke }, box, { kind: "rect", corner: 0 }) : this.bare(cell, box);
    const look = this.look(style, false);
    if (look.stroke === null || !sides.some(Boolean)) return nodes;
    const corners: Point[] = [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]];
    // I lati scritti, uniti dove si toccano, in giro dall'alto.
    const start = sides.every(Boolean) ? 0 : sides.findIndex((side, i) => side && !sides[(i + 3) % 4]);
    let run: Point[] = [];
    const runs: Point[][] = [];
    for (let k = 0; k < 4; k++) {
      const i = (start + k) % 4;
      if (sides[i]) {
        if (run.length === 0) run.push(corners[i]!);
        run.push(corners[(i + 1) % 4]!);
      } else if (run.length > 0) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length > 0) runs.push(run);
    for (const points of runs) {
      const closed = points.length === 5;
      nodes.push({ type: "path", key: "", locked: false, spin: null, points, smooth: false, closed, look: { ...look, fill: null }, start: null, end: null });
    }
    return nodes;
  }

  /// Una linea (`shape=line`): orizzontale a metà del riquadro, verticale se
  /// va a nord o a sud.
  private line(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const [cx, cy] = centreOf(box);
    const direction = style.get("direction") ?? "east";
    const points: Point[] = direction === "north" || direction === "south" ? [[cx, box.min[1]], [cx, box.max[1]]] : [[box.min[0], cy], [box.max[0], cy]];
    const rotation = num(style.get("rotation"), 0);
    const spin = Math.abs(rotation % 360) < 1e-9 ? null : { angle: rotation, centre: [cx, cy] as Point };
    const path: Node = { type: "path", key: "", locked: on(style, "locked"), spin, points, smooth: false, closed: false, look: this.look(style, false), start: null, end: null };
    return [path, ...this.bare(cell, box)];
  }

  /// Un'immagine, con la sua didascalia.
  private image(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const href = imageHref(style.get("image") ?? "");
    const nodes: Node[] = [];
    if (href.startsWith("data:image/")) {
      const centre = centreOf(box);
      const rotation = num(style.get("rotation"), 0);
      const flipX = on(style, "flipH") || on(style, "imageFlipH");
      const flipY = on(style, "flipV") || on(style, "imageFlipV");
      nodes.push({
        type: "image",
        key: "",
        locked: on(style, "locked"),
        spin: Math.abs(rotation % 360) < 1e-9 ? null : { angle: rotation, centre },
        href,
        box,
        opacity: Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100)),
        crop: null,
        flip: flipX || flipY ? { x: flipX, y: flipY, centre } : null,
        ...(this.shadowed(style, "shadow") ? { shadow: true } : {}),
      });
    } else {
      this.notes.add("image", href.length > 80 ? `${href.slice(0, 79)}…` : href);
    }
    return [...nodes, ...this.bare(cell, box)];
  }

  /// Una linea della vita di UML: la testata col nome e la linea
  /// tratteggiata che scende.
  private lifeline(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const size = Math.min(box.max[1] - box.min[1], Math.max(0, num(style.get("size"), 40)));
    if (style.get("participant") !== undefined) this.notes.add("stencil", style.get("participant")!);
    const header: Bounds = { min: box.min, max: [box.max[0], box.min[1] + size] };
    const head = new Map(style);
    head.set("verticalAlign", "middle");
    const nodes = this.shaped({ ...cell, style: head }, header, { kind: "rect", corner: 0 });
    const look = this.look(style, false);
    const cx = (box.min[0] + box.max[0]) / 2;
    nodes.push({
      type: "path",
      key: "",
      locked: false,
      spin: null,
      points: [[cx, box.min[1] + size], [cx, box.max[1]]],
      smooth: false,
      closed: false,
      look: { ...look, stroke: look.stroke === null ? null : { ...look.stroke, dash: style.get("lifelineDashed") === "0" ? "solid" : "dashed" } },
      start: null,
      end: null,
    });
    // Gli archi prendono la linea di vita intera, non la sola testata.
    return this.hooked.has(cell.id) ? [hookBox(box, nameIn(nodes)), ...nodes] : nodes;
  }

  /// L'omino di UML: la testa, il corpo, le braccia e le gambe.
  private stickman(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const [x, y] = box.min;
    const [w, h] = [box.max[0] - x, box.max[1] - y];
    const look = this.look(style, false);
    const head = this.shaped({ ...cell, style }, boxOf(x + w / 4, y, w / 2, h / 4), { kind: "ellipse" }, true, false);
    const path = (points: Point[]): Node => ({ type: "path", key: "", locked: false, spin: null, points, smooth: false, closed: false, look, start: null, end: null });
    const label = this.bare(cell, box);
    // Gli archi prendono il riquadro dell'omino, come in draw.io, non la
    // sua testa.
    return [
      ...(this.hooked.has(cell.id) ? [hookBox(box, nameIn(label))] : []),
      ...head,
      path([[x + w / 2, y + h / 4], [x + w / 2, y + (2 * h) / 3]]),
      path([[x, y + h / 3], [x + w, y + h / 3]]),
      path([[x, y + h], [x + w / 2, y + (2 * h) / 3], [x + w, y + h]]),
      ...label,
    ];
  }

  // -- Gli archi ---------------------------------------------------------------

  /// Il capo di un arco sulla cella `id`: la forma, il suo riquadro e il
  /// punto del file; `null` se non c'è o non è una forma.
  private terminal(id: string | null): { readonly cell: Cell; readonly box: Bounds } | null {
    if (id === null) return null;
    const cell = this.byId.get(id);
    if (cell === undefined || !cell.vertex) return null;
    const box = this.boxOfCell(cell);
    return box === null ? null : { cell, box };
  }

  /// I capi di un arco: le forme agganciate, i punti fissi sul loro bordo,
  /// i punti di passaggio e dove il file mette i capi, sul punto fisso, al
  /// centro della forma o dove dice la geometria; `null` se non ha due capi.
  private endsOf(cell: Cell): Ends | null {
    const style = cell.style;
    const g = cell.geometry;
    const origin = this.origin(cell);
    const local = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
    const via = (g?.points ?? []).map(local);
    const source = this.terminal(cell.source);
    const target = this.terminal(cell.target);
    const loose = (end: "source" | "target"): Point | null => {
      const p = end === "source" ? g?.source : g?.target;
      return p !== undefined && p !== null ? local(p) : this.middleOf(end === "source" ? cell.source : cell.target);
    };
    // Un punto fisso, spostato di `Dx` e `Dy`, e portato sul contorno se
    // `Perimeter` non lo vieta.
    const fixed = (end: { readonly cell: Cell; readonly box: Bounds } | null, side: "exit" | "entry"): Point | null => {
      const [x, y] = [style.get(`${side}X`), style.get(`${side}Y`)];
      if (end === null || x === undefined || y === undefined) return null;
      const [w, h] = [end.box.max[0] - end.box.min[0], end.box.max[1] - end.box.min[1]];
      const at: Point = [end.box.min[0] + num(x, 0.5) * w + num(style.get(`${side}Dx`), 0), end.box.min[1] + num(y, 0.5) * h + num(style.get(`${side}Dy`), 0)];
      return style.get(`${side}Perimeter`) === "0" ? at : perimeterPoint(end.box, this.perimeterOf(end.cell), at);
    };
    const startFixed = fixed(source, "exit");
    const endFixed = fixed(target, "entry");
    const startAt = startFixed ?? (source !== null ? centreOf(source.box) : loose("source"));
    const endAt = endFixed ?? (target !== null ? centreOf(target.box) : loose("target"));
    if (startAt === null || endAt === null) return null;
    return { source, target, via, startFixed, endFixed, startAt, endAt };
  }

  /// La linea di un arco, a stima: dal bordo della prima forma, per i punti
  /// di passaggio, al bordo dell'ultima; `null` se non ha due capi, o se
  /// l'arco si aggancia, per altri archi, a sé stesso.
  private pathOf(cell: Cell): Point[] | null {
    if (this.walking.has(cell.id)) return null;
    this.walking.add(cell.id);
    try {
      const ends = this.endsOf(cell);
      if (ends === null) return null;
      const points = [ends.startAt, ...ends.via, ends.endAt];
      if (ends.startFixed === null && ends.source !== null) points[0] = rimOf(ends.source.box, this.perimeterOf(ends.source.cell), points[1]!);
      if (ends.endFixed === null && ends.target !== null) points[points.length - 1] = rimOf(ends.target.box, this.perimeterOf(ends.target.cell), points[points.length - 2]!);
      return points;
    } finally {
      this.walking.delete(cell.id);
    }
  }

  /// Il punto di mezzo di un arco, a stima: per un capo agganciato a un
  /// altro arco.
  private middleOf(id: string | null): Point | null {
    const cell = id === null ? undefined : this.byId.get(id);
    if (cell === undefined || !cell.edge) return null;
    const path = this.pathOf(cell);
    return path === null ? null : along(path, 0.5).at;
  }

  /// Il punto di un'etichetta di geometria `g` sull'arco `edge`, come lo
  /// mette draw.io: a `(x + 1) / 2` della lunghezza, a `y` dalla linea, di
  /// lato, e spostato di `offset`.
  private labelPoint(edge: Cell, g: Geometry): Point | null {
    const path = this.pathOf(edge);
    if (path === null) return null;
    const { at, direction } = along(path, Math.min(1, Math.max(0, (g.x + 1) / 2)));
    const offset = g.offset ?? [0, 0];
    return [at[0] - direction[1] * g.y + offset[0], at[1] + direction[0] * g.y + offset[1]];
  }

  /// Un arco: un connettore, o una linea con le punte se è libero e ha più
  /// punti; `null` se non ha due capi.
  private edge(cell: Cell): Node[] {
    const style = cell.style;
    const geometry = this.endsOf(cell);
    if (geometry === null) return [];
    const { source, target, via, startFixed, endFixed, startAt, endAt } = geometry;
    const look = this.look(style, false);
    // Un arco senza tratto non si vede, con le sue punte: restano le
    // etichette, testi a sé.
    if (look.stroke === null) return this.looseLabels(cell);
    const shape = style.get("shape");
    if (shape !== undefined && shape !== "connector") this.notes.add("stencil", shape);
    const start = tipOf(style.get("startArrow") ?? "none", style.get("startFill") !== "0", num(style.get("startSize"), 6), this.notes);
    const end = tipOf(style.get("endArrow") ?? "none", style.get("endFill") !== "0", num(style.get("endSize"), 6), this.notes);
    const labels = this.edgeLabels(cell);
    const base: BaseOf = { key: this.key(cell.id), locked: on(style, "locked"), spin: null };
    const edgeStyle = style.get("edgeStyle") ?? "none";
    const curved = on(style, "curved");
    const elbow = ORTHOGONAL.has(edgeStyle);
    // Un arco libero con più punti, né a gomito né curvo, resta una linea.
    if (source === null && target === null && via.length > 0 && !elbow && !curved && labels.length === 0) {
      return [{ ...base, type: "path", points: [startAt, ...via, endAt], smooth: false, closed: false, look, start, end }];
    }
    // Il percorso delle relazioni fra entità esce di lato e rientra di lato.
    const entity = edgeStyle === "entityRelationEdgeStyle" && !curved && via.length === 0 && source !== null && target !== null && startFixed === null && endFixed === null ? entityRoute(source.box, target.box, num(style.get("segment"), 30)) : null;
    const side = (left: boolean): Anchor => (left ? "left" : "right");
    const from: Hook = source === null ? { at: startAt } : { node: this.key(source.cell.id), anchor: entity !== null ? side(entity.sourceLeft) : anchorOf(style.get("exitX"), style.get("exitY")), at: startAt };
    const to: Hook = target === null ? { at: endAt } : { node: this.key(target.cell.id), anchor: entity !== null ? side(entity.targetLeft) : anchorOf(style.get("entryX"), style.get("entryY")), at: endAt };
    let kind: ConnectorKind = elbow ? (curved ? "curved" : "elbow") : curved && via.length > 0 ? "curved" : "straight";
    let route: readonly Point[] | null = entity?.points ?? null;
    if (SIMPLE_ELBOWS.has(edgeStyle) && !curved) {
      const points = this.simpleElbow(edgeStyle, style, geometry);
      if (points.length <= MAX_ELBOW_POINTS) route = points;
    } else if (edgeStyle === "sequenceEdgeStyle" && via.length <= 1) {
      // Un messaggio di un diagramma di sequenza: dritto e orizzontale,
      // all'altezza del suo punto di passaggio o del capo libero.
      kind = "straight";
      route = sequenceRoute(source?.box ?? null, target?.box ?? null, startAt, endAt, via[0] ?? null);
    } else if (via.length > 0) {
      const ends = this.ends(source, target, startFixed ?? (source === null ? startAt : null), endFixed ?? (target === null ? endAt : null), via, elbow && !curved);
      if (elbow && !curved) {
        const points = elbowThrough(ends.start, via, ends.end, ends.firstVertical, ends.lastVertical);
        if (points.length <= MAX_ELBOW_POINTS) route = points;
        else this.notes.add("route");
      } else {
        const drawn = [ends.start, ...via, ends.end];
        if (!curved && drawn.length <= MAX_ELBOW_POINTS && orthogonal(drawn, 1)) {
          kind = "elbow";
          route = drawn;
        } else {
          const { points: samples } = sampled(curved ? curvedThrough(drawn) : drawn.map((to, i): Segment => ({ kind: i === 0 ? "move" : "line", to })));
          const fitted = fitCubic(samples);
          const lengths = runningLengths(samples);
          if (!curved || fitted.error > Math.max(ROUTE_TOLERANCE, lengths[lengths.length - 1]! * ROUTE_SHARE)) this.notes.add("route");
          kind = "curved";
          route = fitted.points;
        }
      }
    }
    const node: LineNode = { ...base, type: "line", kind, from, to, look, start, end, labels, route };
    return [node];
  }

  /// Le etichette di un arco come testi a sé, ciascuna dove la mette
  /// draw.io.
  private looseLabels(cell: Cell): Node[] {
    const out: Node[] = [];
    const opacity = Math.min(1, Math.max(0, num(cell.style.get("opacity"), 100) / 100));
    const add = (content: Content | null, g: Geometry | null): void => {
      const at = content === null ? null : this.labelPoint(cell, g !== null && g.relative ? g : ON_LINE);
      if (content !== null && at !== null) out.push(pointText(content, at, opacity));
    };
    add(this.contentOf(cell, true), cell.geometry);
    for (const child of this.children.get(cell.id) ?? []) {
      if (child.visible && child.vertex) add(this.contentOf(child, true), child.geometry);
    }
    return out;
  }

  /// Il percorso di un arco dei gomiti semplici di draw.io, come lo fa
  /// draw.io: col primo punto di passaggio soltanto, e i capi sul contorno
  /// delle forme, dritti verso la curva quando possono.
  private simpleElbow(edgeStyle: string, style: Style, ends: Ends): Point[] {
    const { source, target, via, startFixed, endFixed, startAt, endAt } = ends;
    const pt = via[0] ?? null;
    // `elbowEdgeStyle` sceglie il verso guardando le due forme.
    let vertical = false;
    let horizontal = false;
    if (edgeStyle === "elbowEdgeStyle" && source !== null && target !== null) {
      const [a, b] = [source.box, target.box];
      if (pt !== null) {
        vertical = pt[1] < Math.min(a.min[1], b.min[1]) || pt[1] > Math.max(a.max[1], b.max[1]);
        horizontal = pt[0] < Math.min(a.min[0], b.min[0]) || pt[0] > Math.max(a.max[0], b.max[0]);
      } else {
        vertical = Math.max(a.min[0], b.min[0]) === Math.min(a.max[0], b.max[0]);
        if (!vertical) horizontal = Math.max(a.min[1], b.min[1]) === Math.min(a.max[1], b.max[1]);
      }
    }
    const down = edgeStyle === "topToBottomEdgeStyle" || (edgeStyle === "elbowEdgeStyle" && !horizontal && (vertical || style.get("elbow") === "vertical"));
    const startFree = startFixed ?? (source === null ? startAt : null);
    const endFree = endFixed ?? (target === null ? endAt : null);
    const s: Bounds = startFree !== null ? { min: startFree, max: startFree } : source!.box;
    const t: Bounds = endFree !== null ? { min: endFree, max: endFree } : target!.box;
    const swap = (p: Point): Point => [p[1], p[0]];
    const middle = down ? sideToSide(transposed(s), transposed(t), pt === null ? null : swap(pt)).map(swap) : sideToSide(s, t, pt);
    const end = endFree ?? orthogonalRim(t, this.perimeterOf(target!.cell), middle[middle.length - 1] ?? startFree ?? centreOf(s));
    const start = startFree ?? orthogonalRim(s, this.perimeterOf(source!.cell), middle[0] ?? end);
    return elbowThrough(start, middle, end, null, null);
  }

  /// Il contorno di `cell` per i capi degli archi.
  private perimeterOf(cell: Cell): Perimeter {
    const perimeter = cell.style.get("perimeter") ?? "";
    const shape = cell.style.get("shape") ?? "";
    if (perimeter.startsWith("ellipse") || (perimeter === "" && ELLIPSES.has(shape))) return "ellipse";
    if (perimeter.startsWith("rhombus") || (perimeter === "" && shape === "rhombus")) return "rhombus";
    return "rect";
  }

  /// I punti in cui un arco con dei punti di passaggio esce dalla prima
  /// forma ed entra nell'ultima: il punto fisso, o il bordo verso il punto
  /// di passaggio vicino; per un gomito, dritto verso di lui.
  private ends(
    sourceEnd: { readonly cell: Cell; readonly box: Bounds } | null,
    targetEnd: { readonly cell: Cell; readonly box: Bounds } | null,
    startFixed: Point | null,
    endFixed: Point | null,
    via: readonly Point[],
    elbow: boolean,
  ): { readonly start: Point; readonly end: Point; readonly firstVertical: boolean | null; readonly lastVertical: boolean | null } {
    const first = via[0]!;
    const last = via[via.length - 1]!;
    const [source, target] = [sourceEnd?.box ?? null, targetEnd?.box ?? null];
    const side = (box: Bounds | null, p: Point): boolean | null => {
      if (box === null) return null;
      return Math.abs(p[1] - box.min[1]) < 0.5 || Math.abs(p[1] - box.max[1]) < 0.5;
    };
    let start: Point;
    let firstVertical: boolean | null = null;
    if (startFixed !== null) {
      start = startFixed;
      firstVertical = side(source, start);
    } else if (source !== null && elbow) {
      const exit = exitTowards(source, first);
      start = exit.at;
      firstVertical = exit.vertical;
    } else {
      start = sourceEnd === null ? first : rimOf(sourceEnd.box, this.perimeterOf(sourceEnd.cell), first);
    }
    let end: Point;
    let lastVertical: boolean | null = null;
    if (endFixed !== null) {
      end = endFixed;
      lastVertical = side(target, end);
    } else if (target !== null && elbow) {
      const entry = exitTowards(target, last);
      end = entry.at;
      lastVertical = entry.vertical;
    } else {
      end = targetEnd === null ? last : rimOf(targetEnd.box, this.perimeterOf(targetEnd.cell), last);
    }
    return { start, end, firstVertical, lastVertical };
  }

  /// Le etichette di un arco: il suo testo, e quello delle celle figlie,
  /// ciascuna dove sta lungo la linea.
  private edgeLabels(cell: Cell): { readonly content: Content; readonly t: number }[] {
    const out: { content: Content; t: number }[] = [];
    const t = (g: Geometry | null): number => Math.min(1, Math.max(0, ((g?.x ?? 0) + 1) / 2));
    const own = this.contentOf(cell, true);
    if (own !== null) out.push({ content: own, t: t(cell.geometry?.relative === false ? null : cell.geometry) });
    for (const child of this.children.get(cell.id) ?? []) {
      if (!child.visible || !child.vertex) continue;
      const content = this.contentOf(child, true);
      if (content !== null) out.push({ content, t: child.geometry?.relative ? t(child.geometry) : 0.5 });
    }
    return out;
  }
}
