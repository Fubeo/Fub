// «Incolla codice» su una lavagna che ha già gli id della lista (LIC T25).
//
// «Copia come codice» scrive ogni scheda come `add_card` col suo id: incollata
// sulla stessa lavagna, la lista nominerebbe schede che ci sono già, e il
// nucleo la rifiuterebbe (`duplicate_id`). Qui la lista si traduce, prima di
// controllarla e di scriverla, con le operazioni che il nucleo ha già:
//
// - «Aggiorna le schede»: ogni `add_card` con un id della lavagna diventa la
//   `set` di quella scheda al suo posto nell'ordine, coi campi che la lista
//   porta (posto, misura, testo, colore, campi sconosciuti); ogni `connect` con
//   l'id di un arco la `set` dell'arco; un tratto che il livello ha già lo
//   sostituisce, se è cambiato. Ciò che la lista non nomina resta com'è.
// - «Aggiungi come copie»: le schede e gli archi coi nomi presi prendono un id
//   nuovo, le operazioni che li nominano lo seguono (nei campi che `OPS` del
//   nucleo dichiara id di schede), e il blocco si sposta come un Ctrl+V.
//
// Una scheda contro un gruppo, o una scheda contro un arco, non si traduce:
// `set` non cambia il tipo, e la lista si ferma con un problema.

import { CANVAS_CLIPBOARD_VERSION, placedSelection, type CanvasClipboard } from "./clipboard";
import { INK_KEY } from "./ink-record";
import type { CanvasDocument, CanvasNode } from "./model";
import { moveStrokesOp, type StoredInkStroke } from "./operation";

type Op = Record<string, unknown>;

/** Gli id della lista che la lavagna ha già. */
export interface CodeClashes {
  readonly cards: readonly string[];
  readonly edges: readonly string[];
  /** I tratti che il loro livello ha già. */
  readonly strokes: number;
}

/** Un id della lavagna che la lista usa per una cosa di un altro tipo. */
export interface CodeKindClash {
  /** L'operazione, da zero. */
  readonly index: number;
  readonly id: string;
  /** Che cos'è sulla lavagna: il tipo della scheda, o `edge`. */
  readonly kind: string;
}

export type CodeClashReading =
  | { readonly ok: true; readonly clashes: CodeClashes | null }
  | { readonly ok: false; readonly kind: CodeKindClash };

const isRecord = (value: unknown): value is Op => typeof value === "object" && value !== null && !Array.isArray(value);

/** L'id che una `add_card` dà alla scheda: dentro `node` nella forma intera, se no `id`. */
function cardId(op: Op): string | null {
  const id = isRecord(op.node) ? op.node.id : op.id;
  return typeof id === "string" ? id : null;
}

/** L'id che una `connect` dà all'arco. */
function edgeId(op: Op): string | null {
  const id = isRecord(op.edge) ? op.edge.id : op.id;
  return typeof id === "string" ? id : null;
}

/** Il tipo della scheda di una `add_card`, come lo legge il nucleo. */
function cardKind(op: Op): string {
  if (isRecord(op.node)) return typeof op.node.type === "string" ? op.node.type : "";
  if (typeof op.type === "string") return op.type;
  if (op.label !== undefined) return "group";
  if (op.file !== undefined) return "file";
  if (op.url !== undefined) return "link";
  return "text";
}

/** Il livello d'inchiostro di `layer` (`"board"` o `{node}`) sulla lavagna: i tratti per id. */
function layerStrokes(doc: CanvasDocument, layer: unknown): Map<string, unknown> {
  const holder = layer === "board" ? doc
    : isRecord(layer) && typeof layer.node === "string" ? doc.nodes.find((node) => node.id === layer.node) : undefined;
  const ink = holder ? (holder as Record<string, unknown>)[INK_KEY] : undefined;
  const strokes = isRecord(ink) && Array.isArray(ink.strokes) ? ink.strokes : [];
  return new Map(strokes.filter(isRecord).filter((stroke) => typeof stroke.id === "string").map((stroke) => [stroke.id as string, stroke]));
}

/**
 * Gli id della lista che la lavagna ha già: le schede di `add_card`, gli
 * archi di `connect` e i tratti di `add_strokes`. Un id preso da una cosa di
 * un altro tipo (una scheda di testo contro un gruppo, una scheda contro un
 * arco) ferma la lettura.
 */
export function codeClashes(doc: CanvasDocument, ops: readonly unknown[]): CodeClashReading {
  const nodes = new Map(doc.nodes.map((node) => [node.id, node.type as string]));
  const edges = new Set(doc.edges.map((edge) => edge.id));
  const cards: string[] = [];
  const links: string[] = [];
  let strokes = 0;
  for (const [index, op] of ops.entries()) {
    if (!isRecord(op)) continue;
    if (op.op === "add_card") {
      const id = cardId(op);
      if (id === null) continue;
      if (edges.has(id)) return { ok: false, kind: { index, id, kind: "edge" } };
      const kind = nodes.get(id);
      if (kind === undefined) continue;
      if (kind !== cardKind(op)) return { ok: false, kind: { index, id, kind } };
      cards.push(id);
    } else if (op.op === "connect") {
      const id = edgeId(op);
      if (id === null) continue;
      const kind = nodes.get(id);
      if (kind !== undefined) return { ok: false, kind: { index, id, kind } };
      if (edges.has(id)) links.push(id);
    } else if (op.op === "add_strokes" && Array.isArray(op.strokes)) {
      const taken = layerStrokes(doc, op.layer);
      strokes += op.strokes.filter((stroke) => isRecord(stroke) && typeof stroke.id === "string" && taken.has(stroke.id)).length;
    }
  }
  const clashes = cards.length + links.length + strokes > 0 ? { cards, edges: links, strokes } : null;
  return { ok: true, clashes };
}

/** I campi della forma breve di `add_card` che una `set` può scrivere com'è. */
const CARD_FIELDS = ["text", "file", "url", "label", "x", "y", "width", "height", "color", "subpath"] as const;

/** Le punte di `ends` come campi dell'arco. */
const ENDS: Readonly<Record<string, Op>> = {
  arrow: { fromEnd: null, toEnd: "arrow" },
  none: { fromEnd: null, toEnd: "none" },
  both: { fromEnd: "arrow", toEnd: "arrow" },
};

function cardFields(op: Op): Op {
  if (isRecord(op.node)) {
    const { id: _id, type: _type, ...fields } = op.node;
    return fields;
  }
  const fields: Op = {};
  for (const key of CARD_FIELDS) if (op[key] !== undefined) fields[key] = op[key];
  return fields;
}

function edgeFields(op: Op): Op {
  if (isRecord(op.edge)) {
    const { id: _id, ...fields } = op.edge;
    return fields;
  }
  const fields: Op = {};
  if (op.from !== undefined) fields.fromNode = op.from;
  if (op.to !== undefined) fields.toNode = op.to;
  if (op.label !== undefined) fields.label = op.label;
  if (op.color !== undefined) fields.color = op.color;
  // `sides: "auto"` sceglie i lati al momento: aggiornando, restano quelli di adesso.
  if (isRecord(op.sides)) {
    if (op.sides.from !== undefined) fields.fromSide = op.sides.from;
    if (op.sides.to !== undefined) fields.toSide = op.sides.to;
  }
  if (typeof op.ends === "string" && ENDS[op.ends]) Object.assign(fields, ENDS[op.ends]);
  return fields;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * «Aggiorna le schede»: la lista con ogni `add_card` e `connect` che nomina
 * una scheda o un arco della lavagna scritti come `set` al loro posto, e i
 * tratti che il livello ha già sostituiti se sono cambiati (`erase_strokes`
 * e `add_strokes` con lo stesso id), lasciati se sono uguali. Le altre
 * operazioni restano com'erano. `updated` sono le schede riscritte.
 */
export function asUpdates(doc: CanvasDocument, ops: readonly unknown[]): { ops: unknown[]; updated: Set<string> } {
  const nodes = new Set(doc.nodes.map((node) => node.id));
  const edges = new Set(doc.edges.map((edge) => edge.id));
  const updated = new Set<string>();
  const out: unknown[] = [];
  for (const op of ops) {
    if (!isRecord(op)) {
      out.push(op);
      continue;
    }
    const card = op.op === "add_card" ? cardId(op) : null;
    const edge = op.op === "connect" ? edgeId(op) : null;
    if (card !== null && nodes.has(card)) {
      updated.add(card);
      out.push({ op: "set", id: card, fields: cardFields(op) });
    } else if (edge !== null && edges.has(edge)) {
      out.push({ op: "set", id: edge, fields: edgeFields(op) });
    } else if (op.op === "add_strokes" && Array.isArray(op.strokes)) {
      const taken = layerStrokes(doc, op.layer);
      const kept = op.strokes.filter((stroke) =>
        !(isRecord(stroke) && typeof stroke.id === "string" && taken.has(stroke.id) && sameJson(taken.get(stroke.id), stroke)));
      const replaced = kept.filter((stroke) => isRecord(stroke) && typeof stroke.id === "string" && taken.has(stroke.id))
        .map((stroke) => (stroke as Op).id as string);
      if (replaced.length > 0) out.push({ op: "erase_strokes", layer: op.layer, ids: replaced });
      if (kept.length > 0) out.push({ ...op, strokes: kept });
    } else {
      out.push(op);
    }
  }
  return { ops: out, updated };
}
/**
 * Per ogni operazione, i campi che nominano una scheda o un arco della
 * lavagna, come li dichiara `OPS` di `crates/fub-canvas-core/src/spec.rs`:
 * i suoi campi `id`/`ids`, i `layer` (`{"node": id}`), e dentro i campi
 * `node`, `edge` e `patch` le chiavi che sono id (`a.b` è la chiave `b`
 * dell'oggetto `a`). Solo questi si rinominano: un campo che non è un id
 * (`align.to`, un testo) non si tocca mai. `code-paste.test.ts` confronta la
 * tabella con `OPS`, campo per campo.
 */
export const CARD_REFERENCES: Readonly<Record<string, readonly string[]>> = {
  add_card: ["id", "near", "node.id"],
  move: ["ids"],
  resize: ["id"],
  connect: ["id", "from", "to", "edge.id", "edge.fromNode", "edge.toNode"],
  remove: ["ids"],
  set: ["id", "fields.fromNode", "fields.toNode"],
  reorder: ["ids"],
  color: ["ids"],
  align: ["ids"],
  distribute: ["ids"],
  duplicate: ["ids"],
  reverse: ["ids"],
  group: ["ids"],
  layout: ["ids"],
  insert: ["near"],
  convert: ["id"],
  spread_pages: ["id"],
  excerpt: ["id", "near"],
  from_mermaid: ["near"],
  from_outline: ["near"],
  add_strokes: ["layer.node"],
  erase_strokes: ["layer.node"],
  move_strokes: ["layer.node", "to.node"],
  restyle_strokes: ["layer.node"],
};

/**
 * I campi `id`/`ids` di `OPS` che non nominano schede o archi che ci sono:
 * gli id nuovi di un gruppo, di `duplicate` o di un tratto, e gli id dei
 * tratti di un livello. Non si rinominano.
 */
export const NOT_CARD_REFERENCES: Readonly<Record<string, readonly string[]>> = {
  group: ["id"],
  duplicate: ["as"],
  draw: ["id"],
  erase_strokes: ["ids"],
  move_strokes: ["ids"],
  restyle_strokes: ["ids"],
};

/**
 * Gli id nuovi come quelli del nucleo (`canvas-code.md`, «Gli id nuovi»):
 * SplitMix64 dal seme, sedici cifre esadecimali, saltando gli id presi.
 */
function* freshIds(seed: bigint, taken: Set<string>): Generator<string> {
  const mask = (1n << 64n) - 1n;
  let state = BigInt.asUintN(64, seed);
  for (;;) {
    state = (state + 0x9e3779b97f4a7c15n) & mask;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    z = z ^ (z >> 31n);
    const id = z.toString(16).padStart(16, "0");
    if (!taken.has(id)) {
      taken.add(id);
      yield id;
    }
  }
}

/** `op` con gli id di `renamed` sostituiti nei soli campi di `CARD_REFERENCES`. */
function renamedOp(op: Op, renamed: ReadonlyMap<string, string>): Op {
  const paths = typeof op.op === "string" ? CARD_REFERENCES[op.op] ?? [] : [];
  const rename = (value: unknown): unknown => {
    if (typeof value === "string") return renamed.get(value) ?? value;
    if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? renamed.get(item) ?? item : item));
    return value;
  };
  const out: Op = { ...op };
  for (const path of paths) {
    const [head, key] = path.split(".") as [string, string | undefined];
    if (key === undefined) {
      if (head in out) out[head] = rename(out[head]);
    } else if (isRecord(out[head]) && key in (out[head] as Op)) {
      out[head] = { ...(out[head] as Op), [key]: rename((out[head] as Op)[key]) };
    }
  }
  return out;
}

/** Dove va il blocco delle copie: l'angolo in alto a sinistra, come Ctrl+V. */
export type CopiesPlace = (block: CanvasClipboard) => { readonly dx: number; readonly dy: number };

/** Lo scarto di Ctrl+V per un blocco: quello di `placedSelection`, con l'angolo in `at`. */
export function placedAt(at: { readonly x: number; readonly y: number }): CopiesPlace {
  return (block) => {
    const { dx, dy } = placedSelection(block, at, (prefix) => prefix);
    return { dx, dy };
  };
}

/** Il posto di una `add_card` (`x`, `y`, `width`, `height`), nella forma breve o in `node`; `null` se non lo dice. */
function cardPlace(op: Op): CanvasNode | null {
  const node = isRecord(op.node) ? op.node : op;
  const { x, y } = node;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return { id: "", type: "text", x, y, width: 0, height: 0 } as CanvasNode;
}

function movedCard(op: Op, dx: number, dy: number): Op {
  if (isRecord(op.node)) return { ...op, node: { ...op.node, x: (op.node.x as number) + dx, y: (op.node.y as number) + dy } };
  return { ...op, x: (op.x as number) + dx, y: (op.y as number) + dy };
}

/**
 * «Aggiungi come copie»: le schede e gli archi della lista che hanno un id
 * della lavagna prendono un id nuovo (dal seme, come quelli del nucleo), e
 * ogni operazione che li nomina lo segue, nei soli campi di
 * `CARD_REFERENCES`. Un tratto libero che la radice ha già prende un id
 * nuovo anche lui. Con `place` il blocco (le schede nate col loro posto e i
 * tratti liberi) si sposta come un Ctrl+V: le schede di quanto dice `place`,
 * i tratti della radice con un `move_strokes` dopo la loro `add_strokes`; i
 * tratti di una scheda vanno con lei. Senza, le copie nascono dove sono gli
 * originali.
 */
export function asCopies(doc: CanvasDocument, ops: readonly unknown[], seed: bigint, place?: CopiesPlace): unknown[] {
  const nodes = new Set(doc.nodes.map((node) => node.id));
  const edges = new Set(doc.edges.map((edge) => edge.id));
  const board = layerStrokes(doc, "board");
  const taken = new Set<string>([...nodes, ...edges, ...board.keys()]);
  const clashing: string[] = [];
  for (const op of ops) {
    if (!isRecord(op)) continue;
    const id = op.op === "add_card" ? cardId(op) : op.op === "connect" ? edgeId(op) : null;
    if (id !== null && (nodes.has(id) || edges.has(id))) clashing.push(id);
    else if (id !== null) taken.add(id);
    if (op.op === "add_strokes" && Array.isArray(op.strokes)) {
      for (const stroke of op.strokes) if (isRecord(stroke) && typeof stroke.id === "string") taken.add(stroke.id);
    }
  }
  const fresh = freshIds(seed ^ 0x5eedc0de5eedc0den, taken);
  const renamed = new Map<string, string>();
  for (const id of clashing) if (!renamed.has(id)) renamed.set(id, fresh.next().value as string);
  const copies = ops.map((op) => {
    if (!isRecord(op)) return op;
    const copy = renamedOp(op, renamed);
    if (copy.op === "add_strokes" && copy.layer === "board" && Array.isArray(copy.strokes)) {
      return {
        ...copy,
        strokes: copy.strokes.map((stroke) =>
          isRecord(stroke) && typeof stroke.id === "string" && board.has(stroke.id)
            ? { ...stroke, id: fresh.next().value as string }
            : stroke),
      };
    }
    return copy;
  });
  if (!place) return copies;
  const cards = copies.flatMap((op) => (isRecord(op) && op.op === "add_card" ? [cardPlace(op)].filter((card) => card !== null) : []));
  const strokes = copies.flatMap((op) =>
    (isRecord(op) && op.op === "add_strokes" && op.layer === "board" && Array.isArray(op.strokes) ? op.strokes : []));
  if (cards.length === 0 && strokes.length === 0) return copies;
  const block = {
    version: CANVAS_CLIPBOARD_VERSION, nodes: cards, edges: [],
    ...(strokes.length > 0 ? { [INK_KEY]: { v: 1 as const, strokes: strokes as StoredInkStroke[] } } : {}),
  } as CanvasClipboard;
  const { dx, dy } = place(block);
  if (dx === 0 && dy === 0) return copies;
  return copies.flatMap((op) => {
    if (!isRecord(op)) return [op];
    if (op.op === "add_card" && cardPlace(op)) return [movedCard(op, dx, dy)];
    if (op.op === "add_strokes" && op.layer === "board" && Array.isArray(op.strokes)) {
      const ids = op.strokes.filter(isRecord).map((stroke) => stroke.id).filter((id): id is string => typeof id === "string");
      return ids.length > 0 ? [op, moveStrokesOp("board", ids, dx, dy)] : [op];
    }
    return [op];
  });
}
