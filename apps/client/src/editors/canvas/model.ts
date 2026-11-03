// Il modello della tela sul filo: JSON Canvas 1.0 con conservazione verbatim
// dei campi sconosciuti (`extra` a ogni livello). Il parse rifiuta JSON
// malformato, id duplicati, archi orfani, dimensioni non positive e limiti;
// non normalizza mai: la sorgente resta l'autorità e il serializzatore
// riemette gli `extra` tali e quali. Le regole di lettura sono quelle del
// nucleo Rust (R1–R8 del piano N3): vuoto è BOM più spazi JSON, le coordinate
// sono interi sicuri, una chiave nota doppia o un surrogato spaiato sono
// errori, `null` su un campo noto facoltativo vuol dire assente.

import { inspectCanvasJson, isBlankCanvasSource, type CanvasDuplicateKey } from "./source-edit";

export type CanvasNodeType = "text" | "file" | "link" | "group";
export type CanvasEdgeSide = "top" | "right" | "bottom" | "left";
export type CanvasEdgeEnd = "none" | "arrow";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: string;
  [extra: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasEdgeSide;
  fromEnd?: CanvasEdgeEnd;
  toSide?: CanvasEdgeSide;
  toEnd?: CanvasEdgeEnd;
  color?: string;
  label?: string;
  [extra: string]: unknown;
}

export interface CanvasDocument {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [extra: string]: unknown;
}

export const MAX_CANVAS_SOURCE_BYTES = 16 * 1024 * 1024;
export const MAX_CANVAS_NODES = 100_000;
export const MAX_CANVAS_EDGES = 200_000;

const NODE_KEYS: Record<string, true> = {
  id: true, type: true, x: true, y: true, width: true, height: true, color: true,
  text: true, file: true, subpath: true, url: true, label: true, background: true, backgroundStyle: true,
};
const EDGE_KEYS: Record<string, true> = {
  id: true, fromNode: true, toNode: true, fromSide: true, fromEnd: true,
  toSide: true, toEnd: true, color: true, label: true,
};
const ROOT_KEYS: Record<string, true> = { nodes: true, edges: true };
const SIDES: readonly string[] = ["top", "right", "bottom", "left"];
const ENDS: readonly string[] = ["none", "arrow"];
const PRESET_COLORS: Record<string, true> = { "1": true, "2": true, "3": true, "4": true, "5": true, "6": true };
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const UTF8 = new TextEncoder();

/** `null` su un campo noto facoltativo vale come assente (R7). */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} non è un oggetto`);
  }
  return value as Record<string, unknown>;
}

function splitExtra(
  value: Record<string, unknown>,
  known: Record<string, true>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, val] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(known, key)) extra[key] = val;
  }
  return extra;
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`${label} non è valido`);
  if (UTF8.encode(value).length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new TypeError(`${label} non è valido`);
  }
  return value;
}

/**
 * Un intero entro ±(2^53−1) (R2): `1.0` e `1e2` vanno bene, una frazione vera
 * o un valore che un `f64` non tiene esatto no. `-0` diventa `0`, come lo
 * legge un intero Rust.
 */
function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} non è un intero`);
  }
  return value === 0 ? 0 : value;
}

function color(value: unknown, label: string): string {
  if (typeof value !== "string" || !(Object.prototype.hasOwnProperty.call(PRESET_COLORS, value) || HEX_COLOR.test(value))) {
    throw new TypeError(`${label} non è un colore canvas valido`);
  }
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (!present(value)) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} non è una stringa`);
  if (max !== Infinity && UTF8.encode(value).length > max) {
    throw new RangeError(`${label} oltre il limite`);
  }
  return value;
}

function parseNode(entry: unknown, index: number): CanvasNode {
  const node = record(entry, `nodo ${index + 1}`);
  const type = node.type;
  if (type !== "text" && type !== "file" && type !== "link" && type !== "group") {
    throw new TypeError(`tipo nodo ${index + 1} non valido`);
  }
  const parsed: CanvasNode = {
    id: id(node.id, `id nodo ${index + 1}`),
    type,
    x: integer(node.x, `x nodo ${index + 1}`),
    y: integer(node.y, `y nodo ${index + 1}`),
    width: integer(node.width, `larghezza nodo ${index + 1}`),
    height: integer(node.height, `altezza nodo ${index + 1}`),
    ...splitExtra(node, NODE_KEYS),
  };
  if (parsed.width < 1 || parsed.height < 1) {
    throw new TypeError(`dimensioni nodo ${index + 1} non valide`);
  }
  if (present(node.color)) parsed.color = color(node.color, `colore nodo ${index + 1}`);
  // Ogni campo di testo è una stringa; i limiti e le regole valgono solo per
  // il campo del suo tipo, come in `CanvasNode::validate` in Rust: un `url`
  // su una scheda di testo, o uno sfondo lungo, si conservano.
  if (present(node.text)) parsed.text = optionalText(node.text, `testo nodo ${index + 1}`, Infinity);
  if (present(node.file)) parsed.file = optionalText(node.file, `file nodo ${index + 1}`, Infinity);
  if (present(node.subpath)) parsed.subpath = optionalText(node.subpath, `subpath nodo ${index + 1}`, Infinity);
  if (present(node.url)) parsed.url = optionalText(node.url, `url nodo ${index + 1}`, Infinity);
  if (present(node.label)) parsed.label = optionalText(node.label, `etichetta nodo ${index + 1}`, Infinity);
  if (present(node.background)) parsed.background = optionalText(node.background, `sfondo nodo ${index + 1}`, Infinity);
  if (type === "text") {
    if (parsed.text === undefined) throw new TypeError(`testo nodo ${index + 1} mancante`);
    optionalText(parsed.text, `testo nodo ${index + 1}`, 1_048_576);
  } else if (type === "file") {
    if (!parsed.file) throw new TypeError(`file nodo ${index + 1} mancante`);
    optionalText(parsed.file, `file nodo ${index + 1}`, 8192);
    if (parsed.subpath !== undefined && (!parsed.subpath.startsWith("#") || UTF8.encode(parsed.subpath).length > 1024)) {
      throw new TypeError(`subpath nodo ${index + 1} non valido`);
    }
  } else if (type === "link") {
    if (!parsed.url) throw new TypeError(`url nodo ${index + 1} mancante`);
    optionalText(parsed.url, `url nodo ${index + 1}`, 8192);
  } else if (parsed.label !== undefined) {
    optionalText(parsed.label, `etichetta nodo ${index + 1}`, 65_536);
  }
  // Qualunque stringa si conserva (R8): un valore che la tela non conosce si
  // disegna come assente, e lo schema dice solo ciò che Fub scrive.
  if (present(node.backgroundStyle)) {
    if (typeof node.backgroundStyle !== "string") throw new TypeError(`stile sfondo nodo ${index + 1} non valido`);
    parsed.backgroundStyle = node.backgroundStyle;
  }
  return parsed;
}

function parseEdge(entry: unknown, index: number, nodes: ReadonlySet<string>): CanvasEdge {
  const edge = record(entry, `arco ${index + 1}`);
  const parsed: CanvasEdge = {
    id: id(edge.id, `id arco ${index + 1}`),
    fromNode: id(edge.fromNode, `origine arco ${index + 1}`),
    toNode: id(edge.toNode, `destinazione arco ${index + 1}`),
    ...splitExtra(edge, EDGE_KEYS),
  };
  if (!nodes.has(parsed.fromNode)) throw new TypeError(`arco ${index + 1} parte da un nodo sconosciuto`);
  if (!nodes.has(parsed.toNode)) throw new TypeError(`arco ${index + 1} arriva a un nodo sconosciuto`);
  if (present(edge.fromSide)) {
    if (!SIDES.includes(edge.fromSide as string)) throw new TypeError(`lato origine arco ${index + 1} non valido`);
    parsed.fromSide = edge.fromSide as CanvasEdgeSide;
  }
  if (present(edge.fromEnd)) {
    if (!ENDS.includes(edge.fromEnd as string)) throw new TypeError(`estremità origine arco ${index + 1} non valida`);
    parsed.fromEnd = edge.fromEnd as CanvasEdgeEnd;
  }
  if (present(edge.toSide)) {
    if (!SIDES.includes(edge.toSide as string)) throw new TypeError(`lato destinazione arco ${index + 1} non valido`);
    parsed.toSide = edge.toSide as CanvasEdgeSide;
  }
  if (present(edge.toEnd)) {
    if (!ENDS.includes(edge.toEnd as string)) throw new TypeError(`estremità destinazione arco ${index + 1} non valida`);
    parsed.toEnd = edge.toEnd as CanvasEdgeEnd;
  }
  if (present(edge.color)) parsed.color = color(edge.color, `colore arco ${index + 1}`);
  if (present(edge.label)) parsed.label = optionalText(edge.label, `etichetta arco ${index + 1}`, 65_536);
  return parsed;
}

/**
 * Una chiave nota doppia sulla radice, in una scheda o in un arco è un errore
 * (R3); le altre tengono l'ultimo valore nella posizione della prima, come
 * `JSON.parse`.
 */
function rejectKnownDuplicates(duplicates: readonly CanvasDuplicateKey[]): void {
  for (const { path, key } of duplicates) {
    if (path.length === 0 && Object.prototype.hasOwnProperty.call(ROOT_KEYS, key)) {
      throw new TypeError(`chiave ${key} doppia nella canvas`);
    }
    if (path.length !== 2 || typeof path[1] !== "number") continue;
    if (path[0] === "nodes" && Object.prototype.hasOwnProperty.call(NODE_KEYS, key)) {
      throw new TypeError(`chiave ${key} doppia nel nodo ${path[1] + 1}`);
    }
    if (path[0] === "edges" && Object.prototype.hasOwnProperty.call(EDGE_KEYS, key)) {
      throw new TypeError(`chiave ${key} doppia nell'arco ${path[1] + 1}`);
    }
  }
}

export function parseCanvas(source: string): CanvasDocument {
  if (UTF8.encode(source).length > MAX_CANVAS_SOURCE_BYTES) {
    throw new RangeError("canvas oltre il limite di 16 MiB");
  }
  if (isBlankCanvasSource(source)) return { nodes: [], edges: [] };
  // Un BOM iniziale si salta, non si toglie (RFC 8259 §8.1, come
  // `text_policy::strip_bom` in Rust): la sorgente lo conserva, il patcher
  // lo copia e gli offset lo contano (#97).
  const json = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  let root: unknown;
  let duplicates: CanvasDuplicateKey[];
  try {
    root = JSON.parse(json);
    // Surrogati spaiati (R4), numeri oltre un `f64` (R5) e chiavi doppie (R3)
    // in una passata sola sul testo: un reviver di `JSON.parse` costerebbe
    // più della lettura stessa.
    duplicates = inspectCanvasJson(json);
  } catch {
    throw new SyntaxError("canvas JSON non valido");
  }
  rejectKnownDuplicates(duplicates);
  return canvasFromValue(root);
}

/** The model of an already decoded JSON root, with every rule of the reader past the text. */
function canvasFromValue(root: unknown): CanvasDocument {
  const obj = record(root, "canvas");
  const rawNodes = obj.nodes ?? [];
  const rawEdges = obj.edges ?? [];
  if (!Array.isArray(rawNodes)) throw new TypeError("nodi canvas non validi");
  if (!Array.isArray(rawEdges)) throw new TypeError("archi canvas non validi");
  if (rawNodes.length > MAX_CANVAS_NODES) throw new RangeError("troppi nodi canvas");
  if (rawEdges.length > MAX_CANVAS_EDGES) throw new RangeError("troppi archi canvas");
  const nodes = rawNodes.map((entry, index) => parseNode(entry, index));
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) throw new TypeError("id nodi canvas duplicati");
  const edges = rawEdges.map((entry, index) => parseEdge(entry, index, ids));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  if (edgeIds.size !== edges.length) throw new TypeError("id archi canvas duplicati");
  return { nodes, edges, ...splitExtra(obj, ROOT_KEYS) };
}

/**
 * Whether a model is a valid canvas: the reader's rules on the values (ids,
 * links, sizes, the limits of each node type), as `Canvas::validate` in Rust,
 * without the limits of the text.
 */
export function isValidCanvas(doc: CanvasDocument): boolean {
  try {
    canvasFromValue(doc);
    return true;
  } catch {
    return false;
  }
}

export function serializeCanvas(doc: CanvasDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function emptyCanvas(): CanvasDocument {
  return { nodes: [], edges: [] };
}
