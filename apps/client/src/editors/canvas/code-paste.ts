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
//   nuovo, e le operazioni che li nominano lo seguono.
//
// Una scheda contro un gruppo, o una scheda contro un arco, non si traduce:
// `set` non cambia il tipo, e la lista si ferma con un problema.

import { INK_KEY } from "./ink-record";
import type { CanvasDocument } from "./model";

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

/** I campi che nominano una scheda o un arco, in ogni operazione. */
const REFERENCES = new Set(["id", "ids", "from", "to", "near", "fromNode", "toNode", "node", "on", "card"]);

/**
 * Gli id nuovi come quelli del nucleo (`canvas-code.md`, «Gli id nuovi»):
 * SplitMix64 dal seme, sedici cifre esadecimali, saltando gli id presi.
 */
function* freshIds(seed: bigint, taken: ReadonlySet<string>): Generator<string> {
  const mask = (1n << 64n) - 1n;
  let state = BigInt.asUintN(64, seed);
  for (;;) {
    state = (state + 0x9e3779b97f4a7c15n) & mask;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    z = z ^ (z >> 31n);
    const id = z.toString(16).padStart(16, "0");
    if (!taken.has(id)) yield id;
  }
}

/** `value` con gli id di `renamed` sostituiti nei campi che nominano schede e archi. */
function renamedIn(value: unknown, renamed: ReadonlyMap<string, string>, reference = false): unknown {
  if (typeof value === "string") return reference ? renamed.get(value) ?? value : value;
  if (Array.isArray(value)) return value.map((item) => renamedIn(item, renamed, reference));
  if (!isRecord(value)) return value;
  const out: Op = {};
  for (const [key, item] of Object.entries(value)) {
    // I tratti hanno i loro id, del loro livello, e `sides` ha i lati in
    // `from` e `to`: non sono schede.
    out[key] = key === "strokes" || key === "sides" ? item : renamedIn(item, renamed, REFERENCES.has(key));
  }
  return out;
}

/**
 * «Aggiungi come copie»: le schede e gli archi della lista che hanno un id
 * della lavagna prendono un id nuovo (dal seme, come quelli del nucleo), e
 * ogni operazione che li nomina (un arco, un gruppo, uno spostamento, il
 * livello d'inchiostro di una scheda) segue il nome nuovo. Un tratto libero
 * che la radice ha già perde il suo id, e il nucleo gliene dà uno.
 */
export function asCopies(doc: CanvasDocument, ops: readonly unknown[], seed: bigint): unknown[] {
  const nodes = new Set(doc.nodes.map((node) => node.id));
  const edges = new Set(doc.edges.map((edge) => edge.id));
  const taken = new Set<string>([...nodes, ...edges]);
  const clashing: string[] = [];
  for (const op of ops) {
    if (!isRecord(op)) continue;
    const id = op.op === "add_card" ? cardId(op) : op.op === "connect" ? edgeId(op) : null;
    if (id === null) continue;
    if (nodes.has(id) || edges.has(id)) clashing.push(id);
    else taken.add(id);
  }
  const fresh = freshIds(seed ^ 0x5eedc0de5eedc0den, taken);
  const renamed = new Map<string, string>();
  for (const id of clashing) if (!renamed.has(id)) renamed.set(id, fresh.next().value as string);
  const board = layerStrokes(doc, "board");
  return ops.map((op) => {
    const copy = renamedIn(op, renamed);
    if (isRecord(copy) && copy.op === "add_strokes" && copy.layer === "board" && Array.isArray(copy.strokes)) {
      return {
        ...copy,
        strokes: copy.strokes.map((stroke) =>
          isRecord(stroke) && typeof stroke.id === "string" && board.has(stroke.id) ? { ...stroke, id: null } : stroke),
      };
    }
    return copy;
  });
}
