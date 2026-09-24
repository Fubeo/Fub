// Il modello della tela sul filo: JSON Canvas 1.0 con conservazione verbatim
// dei campi sconosciuti (`extra` a ogni livello). Il parse rifiuta JSON
// malformato, id duplicati, archi orfani, dimensioni non positive e limiti;
// non normalizza mai: la sorgente resta l'autorità e il serializzatore
// riemette gli `extra` tali e quali.

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

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${label} non è un intero`);
  }
  return value;
}

function color(value: unknown, label: string): string {
  if (typeof value !== "string" || !(Object.prototype.hasOwnProperty.call(PRESET_COLORS, value) || HEX_COLOR.test(value))) {
    throw new TypeError(`${label} non è un colore canvas valido`);
  }
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} non è una stringa`);
  if (UTF8.encode(value).length > max) {
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
  if (node.color !== undefined) parsed.color = color(node.color, `colore nodo ${index + 1}`);
  if (type === "text") {
    if (typeof node.text !== "string") throw new TypeError(`testo nodo ${index + 1} mancante`);
    parsed.text = optionalText(node.text, `testo nodo ${index + 1}`, 1_048_576);
  } else if (node.text !== undefined) {
    parsed.text = optionalText(node.text, `testo nodo ${index + 1}`, 1_048_576);
  }
  if (type === "file") {
    if (typeof node.file !== "string" || !node.file) throw new TypeError(`file nodo ${index + 1} mancante`);
    parsed.file = optionalText(node.file, `file nodo ${index + 1}`, 8192);
    if (node.subpath !== undefined) {
      if (typeof node.subpath !== "string" || !node.subpath.startsWith("#")) {
        throw new TypeError(`subpath nodo ${index + 1} non valido`);
      }
      parsed.subpath = optionalText(node.subpath, `subpath nodo ${index + 1}`, 1024);
    }
  } else {
    if (node.file !== undefined) parsed.file = optionalText(node.file, `file nodo ${index + 1}`, 8192);
    if (node.subpath !== undefined) parsed.subpath = optionalText(node.subpath, `subpath nodo ${index + 1}`, 1024);
  }
  if (type === "link") {
    if (typeof node.url !== "string" || !node.url) throw new TypeError(`url nodo ${index + 1} mancante`);
    parsed.url = optionalText(node.url, `url nodo ${index + 1}`, 8192);
  } else if (node.url !== undefined) {
    parsed.url = optionalText(node.url, `url nodo ${index + 1}`, 8192);
  }
  if (node.label !== undefined) parsed.label = optionalText(node.label, `etichetta nodo ${index + 1}`, 65_536);
  if (node.background !== undefined) parsed.background = optionalText(node.background, `sfondo nodo ${index + 1}`, 8192);
  if (node.backgroundStyle !== undefined) {
    if (node.backgroundStyle !== "cover" && node.backgroundStyle !== "ratio" && node.backgroundStyle !== "repeat") {
      throw new TypeError(`stile sfondo nodo ${index + 1} non valido`);
    }
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
  if (edge.fromSide !== undefined) {
    if (!SIDES.includes(edge.fromSide as string)) throw new TypeError(`lato origine arco ${index + 1} non valido`);
    parsed.fromSide = edge.fromSide as CanvasEdgeSide;
  }
  if (edge.fromEnd !== undefined) {
    if (!ENDS.includes(edge.fromEnd as string)) throw new TypeError(`estremità origine arco ${index + 1} non valida`);
    parsed.fromEnd = edge.fromEnd as CanvasEdgeEnd;
  }
  if (edge.toSide !== undefined) {
    if (!SIDES.includes(edge.toSide as string)) throw new TypeError(`lato destinazione arco ${index + 1} non valido`);
    parsed.toSide = edge.toSide as CanvasEdgeSide;
  }
  if (edge.toEnd !== undefined) {
    if (!ENDS.includes(edge.toEnd as string)) throw new TypeError(`estremità destinazione arco ${index + 1} non valida`);
    parsed.toEnd = edge.toEnd as CanvasEdgeEnd;
  }
  if (edge.color !== undefined) parsed.color = color(edge.color, `colore arco ${index + 1}`);
  if (edge.label !== undefined) parsed.label = optionalText(edge.label, `etichetta arco ${index + 1}`, 65_536);
  return parsed;
}

export function parseCanvas(source: string): CanvasDocument {
  if (UTF8.encode(source).length > MAX_CANVAS_SOURCE_BYTES) {
    throw new RangeError("canvas oltre il limite di 16 MiB");
  }
  if (!source.trim()) return { nodes: [], edges: [] };
  let root: unknown;
  try {
    root = JSON.parse(source, (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("canvas JSON number out of range");
      return value;
    });
  } catch {
    throw new SyntaxError("canvas JSON non valido");
  }
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

export function serializeCanvas(doc: CanvasDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function emptyCanvas(): CanvasDocument {
  return { nodes: [], edges: [] };
}
