// Le schede negli appunti (T68): la forma che Fub scrive copiando delle
// schede della lavagna, come la rilegge incollando, e il Markdown che va agli
// altri programmi. Niente DOM e niente nucleo: il motore (`engine.ts`) prende
// da qui ciò che scrive negli appunti e le schede da incollare, e le fa
// passare dal commit del nucleo come ogni altro gesto.
//
// La forma, sotto il tipo `application/x-fub-canvas+json`, è
//
//     { "version": 1, "nodes": [ … ], "edges": [ … ] }
//
// con le schede copiate nell'ordine del file (la profondità), i soli fili
// fra due schede copiate, e ogni scheda e ogni filo com'erano: l'inchiostro
// attaccato nel campo `fub:ink`, i campi sconosciuti compresi. La pagina è
// `docs/reference/canvas-format.md`, «Negli appunti».

import type { CanvasDocument, CanvasEdge, CanvasNode, CanvasNodeType } from "./model";

/** Il tipo degli appunti delle schede di Fub. */
export const CANVAS_CLIPBOARD_TYPE = "application/x-fub-canvas+json";

/** La versione della forma che questo Fub scrive e sa leggere. */
export const CANVAS_CLIPBOARD_VERSION = 1;

/** Di quanto si sfalsa una copia sopra l'altra: un secondo incolla nello stesso punto, Ctrl+D la prima volta. */
export const CANVAS_PASTE_STEP = 32;

/** Le schede negli appunti, nella forma della versione 1. */
export interface CanvasClipboard {
  readonly version: typeof CANVAS_CLIPBOARD_VERSION;
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
}

/**
 * Ciò che dice il testo degli appunti: delle schede da incollare; una
 * versione più nuova, che questo Fub non incolla; o qualcosa che non è la
 * forma di Fub (un JSON rotto, una forma sbagliata), che si incolla come testo.
 */
export type CanvasClipboardRead =
  | { readonly kind: "cards"; readonly clipboard: CanvasClipboard }
  | { readonly kind: "future"; readonly version: number }
  | { readonly kind: "broken" };

const NODE_TYPES: ReadonlySet<CanvasNodeType> = new Set(["text", "file", "link", "group"]);

/**
 * Le schede `ids` di `doc` come vanno negli appunti: nell'ordine del file,
 * copiate per valore, con i soli fili che uniscono due di loro. `null` se
 * nessuna delle `ids` è nel documento.
 */
export function copiedCards(doc: CanvasDocument, ids: readonly string[]): CanvasClipboard | null {
  const wanted = new Set(ids);
  const nodes = doc.nodes.filter((node) => wanted.has(node.id));
  if (nodes.length === 0) return null;
  const kept = new Set(nodes.map((node) => node.id));
  const edges = doc.edges.filter((edge) => kept.has(edge.fromNode) && kept.has(edge.toNode));
  return { version: CANVAS_CLIPBOARD_VERSION, nodes: clone(nodes), edges: clone(edges) };
}

/** Il testo che va sotto `CANVAS_CLIPBOARD_TYPE`. */
export function clipboardJson(clipboard: CanvasClipboard): string {
  return JSON.stringify({ version: clipboard.version, nodes: clipboard.nodes, edges: clipboard.edges });
}

/**
 * Il Markdown delle schede, per gli altri programmi (`text/plain`): una
 * scheda dopo l'altra in ordine di lettura (dall'alto in basso, a pari
 * altezza da sinistra), separate da una riga vuota. Una scheda di testo dà il
 * suo testo, una di file il suo link `[[…]]` (una nota senza `.md`, come la
 * scrive il completamento), una di link il suo indirizzo, un gruppo il suo
 * nome. Le schede senza niente da dire non lasciano righe vuote.
 */
export function cardsMarkdown(nodes: readonly CanvasNode[]): string {
  return [...nodes]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(cardMarkdown)
    .filter((text) => text.trim() !== "")
    .join("\n\n");
}

function cardMarkdown(node: CanvasNode): string {
  switch (node.type) {
    case "text": return node.text ?? "";
    case "file": {
      const file = node.file ?? "";
      if (file === "") return "";
      const name = /\.md$/i.test(file) ? file.slice(0, -3) : file;
      return `[[${name}${node.subpath ?? ""}]]`;
    }
    case "link": return node.url ?? "";
    default: return node.label ?? "";
  }
}

/**
 * Legge il testo degli appunti. È la forma di Fub solo se è un oggetto JSON
 * con `version` intero: maggiore di 1 è una versione futura, rifiutata tutta
 * (anche se il resto sembra leggibile: non si incolla mai a metà); 1 vuole
 * `nodes` ed `edges` array, schede con `id` unico non vuoto, uno dei quattro
 * tipi e posizione e misura finite, fili con `id` unico non vuoto fra due
 * schede degli appunti. Ogni altra cosa è `broken`. Le regole del file (i
 * colori, i limiti, l'inchiostro) le controlla il commit del nucleo.
 */
export function readCanvasClipboard(text: string): CanvasClipboardRead {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "broken" };
  }
  if (!isRecord(value)) return { kind: "broken" };
  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return { kind: "broken" };
  if (version > CANVAS_CLIPBOARD_VERSION) return { kind: "future", version };
  const { nodes, edges } = value;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return { kind: "broken" };
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!isNode(node) || nodeIds.has(node.id)) return { kind: "broken" };
    nodeIds.add(node.id);
  }
  if (nodeIds.size === 0) return { kind: "broken" };
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!isEdge(edge) || edgeIds.has(edge.id) || !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) {
      return { kind: "broken" };
    }
    edgeIds.add(edge.id);
  }
  return {
    kind: "cards",
    clipboard: { version: CANVAS_CLIPBOARD_VERSION, nodes: nodes as CanvasNode[], edges: edges as CanvasEdge[] },
  };
}

/**
 * Le schede degli appunti pronte da mettere sulla lavagna: ids nuovi (dati
 * da `newId`, col prefisso `n` per le schede ed `e` per i fili), i fili
 * riattaccati alle schede nuove, e tutte spostate dello stesso tanto, così
 * l'angolo in alto a sinistra del loro riquadro cade in `at` e le distanze
 * fra loro restano quelle copiate. Il resto di ogni scheda e di ogni filo,
 * inchiostro e campi sconosciuti compresi, resta com'era.
 */
export function placedCards(
  clipboard: CanvasClipboard,
  at: { readonly x: number; readonly y: number },
  newId: (prefix: string) => string,
): { readonly nodes: CanvasNode[]; readonly edges: CanvasEdge[] } {
  // Un ciclo e non `Math.min(...)`: gli appunti possono avere tante schede.
  let left = Infinity;
  let top = Infinity;
  for (const node of clipboard.nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
  }
  const dx = at.x - left;
  const dy = at.y - top;
  const ids = new Map<string, string>();
  const nodes = clone(clipboard.nodes).map((node) => {
    const id = newId("n");
    ids.set(node.id, id);
    return { ...node, id, x: node.x + dx, y: node.y + dy };
  });
  const edges = clone(clipboard.edges).map((edge) => ({
    ...edge,
    id: newId("e"),
    fromNode: ids.get(edge.fromNode)!,
    toNode: ids.get(edge.toNode)!,
  }));
  return { nodes, edges };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNode(value: unknown): value is CanvasNode {
  if (!isRecord(value)) return false;
  const { id, type, x, y, width, height } = value;
  return typeof id === "string" && id !== "" && NODE_TYPES.has(type as CanvasNodeType)
    && [x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n));
}

function isEdge(value: unknown): value is CanvasEdge {
  if (!isRecord(value)) return false;
  const { id, fromNode, toNode } = value;
  return typeof id === "string" && id !== "" && typeof fromNode === "string" && typeof toNode === "string";
}

/** Una copia per valore: ciò che va negli appunti o sulla lavagna non condivide niente col documento. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
