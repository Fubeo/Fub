// Le schede negli appunti (T68): la forma che Fub scrive copiando delle
// schede della lavagna, come la rilegge incollando, e il Markdown che va agli
// altri programmi. Niente DOM e niente nucleo: il motore (`engine.ts`) prende
// da qui ciò che scrive negli appunti e le schede da incollare, e le fa
// passare dal commit del nucleo come ogni altro gesto.
//
// La forma, sotto il tipo `application/x-fub-canvas+json`, è
//
//     { "version": 1, "nodes": [ … ], "edges": [ … ], "fub:ink": { … } }
//
// con le schede copiate nell'ordine del file (la profondità), i soli fili
// fra due schede copiate, e ogni scheda e ogni filo com'erano: l'inchiostro
// attaccato nel campo `fub:ink` della sua scheda, i campi sconosciuti
// compresi. I tratti liberi scelti col Lazo (T94) vanno nel `fub:ink` della
// radice, nella forma del livello della radice del `.canvas`, in coordinate
// della lavagna; il campo c'è solo se ci sono tratti, e un Fub che non lo
// conosce lo ignora. La pagina è `docs/reference/canvas-format.md`, «Negli
// appunti».

import { decodeStroke, INK_KEY } from "./ink-record";
import type { CanvasDocument, CanvasEdge, CanvasNode, CanvasNodeType } from "./model";
import { moveStrokesOp, type CanvasPatch, type StoredInkStroke } from "./operation";
import type { CanvasIntentOp } from "./wasm/core";

/** Il tipo degli appunti delle schede di Fub. */
export const CANVAS_CLIPBOARD_TYPE = "application/x-fub-canvas+json";

/** La versione della forma che questo Fub scrive e sa leggere. */
export const CANVAS_CLIPBOARD_VERSION = 1;

/** Di quanto si sfalsa una copia sopra l'altra: un secondo incolla nello stesso punto, Ctrl+D la prima volta. */
export const CANVAS_PASTE_STEP = 32;

/** I tratti liberi negli appunti: un livello della radice del `.canvas`, coi soli tratti copiati. */
export interface CanvasClipboardInk {
  readonly v: 1;
  readonly strokes: readonly StoredInkStroke[];
}

/** Le schede e i tratti liberi negli appunti, nella forma della versione 1. */
export interface CanvasClipboard {
  readonly version: typeof CANVAS_CLIPBOARD_VERSION;
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  /** I tratti liberi (T94), in coordinate della lavagna; assente se non ce ne sono. */
  readonly [INK_KEY]?: CanvasClipboardInk;
}

/**
 * Ciò che dice il testo degli appunti: delle schede (o dei tratti) da
 * incollare; una versione più nuova, che questo Fub non incolla; la forma di
 * Fub con un `fub:ink` della radice rotto o fuori dai limiti, che non si
 * incolla per niente; o qualcosa che non è la forma di Fub (un JSON rotto,
 * una forma sbagliata), che si incolla come testo.
 */
export type CanvasClipboardRead =
  | { readonly kind: "cards"; readonly clipboard: CanvasClipboard }
  | { readonly kind: "future"; readonly version: number }
  | { readonly kind: "refused" }
  | { readonly kind: "broken" };

/** Gli appunti messi sulla lavagna: schede e fili al loro posto, i tratti con l'id nuovo e lo spostamento da dare loro. */
export interface PlacedSelection {
  readonly nodes: CanvasNode[];
  readonly edges: CanvasEdge[];
  /** I tratti liberi con l'id nuovo, ancora nelle coordinate copiate. */
  readonly strokes: StoredInkStroke[];
  /** Di quanto si spostano i tratti, in unità della lavagna: quanto le schede. */
  readonly dx: number;
  readonly dy: number;
}

const NODE_TYPES: ReadonlySet<CanvasNodeType> = new Set(["text", "file", "link", "group"]);

/**
 * Le schede `ids` e i tratti liberi `strokes` (id del livello della radice)
 * di `doc` come vanno negli appunti: le schede nell'ordine del file, copiate
 * per valore, con i soli fili che uniscono due di loro; i tratti nell'ordine
 * del livello, com'erano, campi sconosciuti compresi. `null` se né una scheda
 * né un tratto è nel documento.
 */
export function copiedSelection(
  doc: CanvasDocument,
  ids: readonly string[],
  strokes: readonly string[] = [],
): CanvasClipboard | null {
  const wanted = new Set(ids);
  const nodes = doc.nodes.filter((node) => wanted.has(node.id));
  const kept = new Set(nodes.map((node) => node.id));
  const edges = doc.edges.filter((edge) => kept.has(edge.fromNode) && kept.has(edge.toNode));
  const chosen = new Set(strokes);
  const layer = doc[INK_KEY];
  const free = chosen.size > 0 && isRecord(layer) && Array.isArray(layer.strokes)
    ? (layer.strokes as unknown[]).filter(
      (stroke): stroke is StoredInkStroke => isRecord(stroke) && typeof stroke.id === "string" && chosen.has(stroke.id),
    )
    : [];
  if (nodes.length === 0 && free.length === 0) return null;
  const clipboard: CanvasClipboard = { version: CANVAS_CLIPBOARD_VERSION, nodes: clone(nodes), edges: clone(edges) };
  return free.length > 0 ? { ...clipboard, [INK_KEY]: { v: 1, strokes: clone(free) } } : clipboard;
}

/** Il testo che va sotto `CANVAS_CLIPBOARD_TYPE`; il `fub:ink` della radice solo se ci sono tratti. */
export function clipboardJson(clipboard: CanvasClipboard): string {
  const ink = clipboard[INK_KEY];
  return JSON.stringify({
    version: clipboard.version,
    nodes: clipboard.nodes,
    edges: clipboard.edges,
    ...(ink && ink.strokes.length > 0 ? { [INK_KEY]: { v: ink.v, strokes: ink.strokes } } : {}),
  });
}

/**
 * Il Markdown delle schede, per gli altri programmi (`text/plain`): una
 * scheda dopo l'altra in ordine di lettura (dall'alto in basso, a pari
 * altezza da sinistra), separate da una riga vuota. Una scheda di testo dà il
 * suo testo, una di file il suo link `[[…]]` (una nota senza `.md`, come la
 * scrive il completamento), una di link il suo indirizzo, un gruppo il suo
 * nome. Le schede senza niente da dire non lasciano righe vuote. I tratti
 * liberi non hanno Markdown.
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
 * schede degli appunti, e almeno una scheda o un tratto libero. Ogni altra
 * cosa è `broken`.
 *
 * Il `fub:ink` della radice, se c'è, è un livello con `v` uguale a 1 e i
 * tratti con `id` unico non vuoto, ognuno con l'ancora `free` e che il client
 * sa decodificare (`decodeStroke`: strumento, pennello, `ink` coi limiti di
 * §5). Se no è `refused`: la forma è di Fub, e non si incolla niente. Le
 * regole del file (i colori, i limiti, l'inchiostro) le controlla poi il
 * commit del nucleo.
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
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!isEdge(edge) || edgeIds.has(edge.id) || !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) {
      return { kind: "broken" };
    }
    edgeIds.add(edge.id);
  }
  let strokes: readonly StoredInkStroke[] = [];
  if (Object.prototype.hasOwnProperty.call(value, INK_KEY)) {
    const read = freeStrokes(value[INK_KEY]);
    if (read === null) return { kind: "refused" };
    strokes = read;
  }
  if (nodeIds.size === 0 && strokes.length === 0) return { kind: "broken" };
  const clipboard: CanvasClipboard = {
    version: CANVAS_CLIPBOARD_VERSION,
    nodes: nodes as CanvasNode[],
    edges: edges as CanvasEdge[],
  };
  return { kind: "cards", clipboard: strokes.length > 0 ? { ...clipboard, [INK_KEY]: { v: 1, strokes } } : clipboard };
}

/** I tratti del `fub:ink` della radice degli appunti; `null` se il livello è rotto o un tratto non si incolla. */
function freeStrokes(layer: unknown): StoredInkStroke[] | null {
  if (!isRecord(layer) || layer.v !== 1 || !Array.isArray(layer.strokes)) return null;
  const ids = new Set<string>();
  for (const stroke of layer.strokes as unknown[]) {
    if (!isRecord(stroke) || typeof stroke.id !== "string" || stroke.id === "" || ids.has(stroke.id)) return null;
    ids.add(stroke.id);
    // Un tratto che il client non decodifica (oltre i limiti, una grammatica
    // rotta) o con un'ancora che alla radice non vale non entra.
    const decoded = decodeStroke(stroke);
    if (decoded === null || decoded.ref !== null) return null;
  }
  return layer.strokes as StoredInkStroke[];
}

/**
 * Gli appunti pronti da mettere sulla lavagna: ids nuovi (dati da `newId`,
 * col prefisso `n` per le schede, `e` per i fili ed `s` per i tratti), i fili
 * riattaccati alle schede nuove, e tutto spostato dello stesso tanto, così
 * l'angolo in alto a sinistra del riquadro di schede e tratti cade in `at` e
 * le distanze restano quelle copiate. Le schede si spostano qui; i tratti
 * restano dove sono e lo spostamento (`dx`, `dy`) lo dà loro il nucleo
 * (`pastedInkOps`). Il resto di ogni scheda, filo e tratto, inchiostro e
 * campi sconosciuti compresi, resta com'era.
 */
export function placedSelection(
  clipboard: CanvasClipboard,
  at: { readonly x: number; readonly y: number },
  newId: (prefix: string) => string,
): PlacedSelection {
  const free = clipboard[INK_KEY]?.strokes ?? [];
  // Un ciclo e non `Math.min(...)`: gli appunti possono avere tante schede.
  let left = Infinity;
  let top = Infinity;
  for (const node of clipboard.nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
  }
  for (const stroke of free) {
    const decoded = decodeStroke(stroke);
    if (!decoded) continue;
    const scale = decoded.ink.scale;
    for (const sample of decoded.ink.samples) {
      // All'intero sotto: le schede si spostano di un numero intero.
      left = Math.min(left, Math.floor(sample.x / scale));
      top = Math.min(top, Math.floor(sample.y / scale));
    }
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    left = at.x;
    top = at.y;
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
  const strokes = clone(free).map((stroke) => ({ ...stroke, id: newId("s") }));
  return { nodes, edges, strokes, dx, dy };
}

/**
 * Le operazioni d'intento che mettono i tratti incollati nel livello della
 * radice: `add_strokes` coi loro id, poi `move_strokes` dello spostamento
 * delle schede. Le compila il nucleo, che controlla i tratti e rifiuta per
 * intero uno spostamento che esce dai numeri dell'inchiostro. Vuoto senza
 * tratti.
 */
export function pastedInkOps(placed: PlacedSelection): CanvasIntentOp[] {
  if (placed.strokes.length === 0) return [];
  const ops: CanvasIntentOp[] = [{ op: "add_strokes", layer: "board", strokes: clone(placed.strokes) }];
  if (placed.dx !== 0 || placed.dy !== 0) {
    ops.push(moveStrokesOp("board", placed.strokes.map((stroke) => stroke.id), placed.dx, placed.dy));
  }
  return ops;
}

/**
 * Le toppe compilate da `pastedInkOps`, con l'aggiunta e lo spostamento di
 * ogni tratto fusi in una toppa sola: il tratto entra già al suo posto. Ogni
 * altra toppa resta com'è, nel suo ordine.
 */
export function joinedInkPatches(patches: readonly CanvasPatch[]): CanvasPatch[] {
  const joined: CanvasPatch[] = [];
  const added = new Map<string, number>();
  for (const patch of patches) {
    if (patch.kind === "ink" && patch.layer === "board") {
      if (!patch.before && patch.after) {
        added.set(patch.after.id, joined.length);
        joined.push(patch);
        continue;
      }
      const index = patch.before && patch.after && patch.before.id === patch.after.id ? added.get(patch.before.id) : undefined;
      if (index !== undefined) {
        joined[index] = { ...(joined[index] as Extract<CanvasPatch, { kind: "ink" }>), after: patch.after };
        continue;
      }
    }
    joined.push(patch);
  }
  return joined;
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
