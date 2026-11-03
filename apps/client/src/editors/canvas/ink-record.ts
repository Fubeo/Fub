// L'inchiostro della lavagna nel client: leggere i livelli `fub:ink` di un
// `.canvas` e fare il record di un tratto appena finito.
//
// Le regole sono quelle di `docs/reference/canvas-ink.md` e dei vettori di
// `src/__fixtures__/canvas-ink/`, gli stessi che legge il nucleo Rust:
//
// - **I livelli** (`readInkLayers`): uno per scheda con la chiave `fub:ink`,
//   nell'ordine di `nodes`, poi quello della radice. Un livello è `ok` o
//   `foreign`; un livello estraneo non elenca tratti. In un livello `ok` ogni
//   tratto si disegna o no, e se no la ragione è la prima che vale
//   nell'ordine `tool`, `anchor`, `color`, `brush`, `ink`. I tratti che si
//   disegnano arrivano già decodificati (`DrawableStroke`).
// - **Il record** (`strokeRecord`): il tratto della penna, in coordinate della
//   lavagna, portato nelle unità della scheda che lo tiene (o lasciato in
//   quelle della lavagna se è libero), quantizzato con `buildStroke` e scritto
//   con `encodeInk`, con i campi nell'ordine di scrittura. Un tratto oltre i
//   limiti di §5 è un rifiuto, non un'eccezione.
// - **L'asciutto** (`toDry`, `dryStroke`): il `DryStroke` che disegna
//   `ink-paint.ts`, col percorso di `inkPath`.
//
// Niente DOM qui: solo dati, così le stesse funzioni servono alla lavagna,
// ai test e a chi legge un file senza aprirlo.

import { brushForInput, checkInkBrush, formatInkBrush, parseInkBrush, type InkBrush } from "../../ink/brush";
import { toLocal, type Affine } from "../../ink/geometry";
import { inkPath } from "../../ink/outline";
import { DEFAULT_PEN, penBrush } from "../../ink/pens";
import { INK_MAX_SAMPLES, type InkSample, type QuantizedInk } from "../../ink/sample";
import { buildStroke } from "../../ink/tools/stroke";
import { closedAtLimit } from "../../ink/tools/tool";
import { decodeInk, encodeInk, inkFromQuantized, inkToQuantized, INK_MAX_BYTES, unknownChannels } from "../spatial/ink/codec";
import type { InkLook } from "./ink-layer";
import type { DryStroke, InkPathCache, InkRef } from "./ink-paint";
import type { CanvasDocument, CanvasNode } from "./model";
import { newNodeId } from "./operation";

/// La chiave del livello, su una scheda o sulla radice.
export const INK_KEY = "fub:ink";

/// La versione del livello che Fub legge e scrive.
export const INK_LAYER_VERSION = 1;

/// Lo spessore della penna di serie in pixel dello schermo (A11, D-5).
export const INK_PEN_PX = 4;

/// Il colore della penna di serie (D-5): un valore del file, non del tema.
export const INK_PEN_COLOR = "#0072b2";

/// Gli strumenti che un tratto può dire.
export type InkStrokeTool = "pen" | "highlighter";

/// Dove sta un livello: sulla radice (`"board"`) o su una scheda.
export type InkLayerRef = "board" | { readonly node: string };

/// Perché un tratto di un livello valido non si disegna. Sono le parole dei
/// vettori, nell'ordine in cui si guardano.
export type InkSkipReason = "tool" | "anchor" | "color" | "brush" | "ink";

/// L'ancora di un tratto come si scrive.
export type InkAnchorRecord =
  | { readonly kind: "card"; readonly width: number; readonly height: number }
  | { readonly kind: "free" };

/// Un tratto come sta nel file. I campi sconosciuti si conservano.
export interface InkStrokeRecord {
  readonly id: string;
  readonly tool: InkStrokeTool;
  readonly at?: string;
  readonly brush: string;
  readonly color: string;
  readonly anchor: InkAnchorRecord;
  readonly ink: string;
  readonly [extra: string]: unknown;
}

/// Un tratto che si disegna, già decodificato.
export interface DrawableStroke {
  readonly id: string;
  readonly tool: InkStrokeTool;
  /// Il colore del file, `#rrggbb` com'è scritto.
  readonly color: string;
  readonly brush: InkBrush;
  /// Il testo di `brush` e di `ink` com'è nel file: la chiave della cache dei
  /// percorsi.
  readonly brushText: string;
  readonly inkText: string;
  /// I campioni noti, nelle unità dell'ancora moltiplicate per la scala.
  readonly ink: QuantizedInk;
  /// La misura della scheda quando il tratto si è scritto; `null` se libero.
  readonly ref: InkRef | null;
  /// Il tratto com'è nel file, campi sconosciuti compresi.
  readonly record: Readonly<Record<string, unknown>>;
}

/// Un tratto di un livello valido.
export type InkStrokeEntry =
  | { readonly id: string; readonly drawn: true; readonly stroke: DrawableStroke }
  | { readonly id: string; readonly drawn: false; readonly reason: InkSkipReason };

/// Un livello letto.
export interface InkLayerState {
  readonly layer: InkLayerRef;
  /// La scheda che tiene il livello; `null` per la radice.
  readonly node: CanvasNode | null;
  readonly state: "ok" | "foreign";
  /// I tratti nell'ordine dell'array; vuoto se il livello è estraneo.
  readonly strokes: readonly InkStrokeEntry[];
  /// I soli tratti che si disegnano, nello stesso ordine.
  readonly drawable: readonly DrawableStroke[];
}

/// Dove sta il livello di un tratto: decide quale ancora vale.
type Place = "card" | "board";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/// Un livello ha la chiave `fub:ink` sulla scheda o sulla radice.
function layerValue(holder: object): { present: boolean; value: unknown } {
  if (!has(holder, INK_KEY)) return { present: false, value: undefined };
  return { present: true, value: (holder as Record<string, unknown>)[INK_KEY] };
}

/// I tratti di un livello, o `null` se il livello è estraneo: non è un
/// oggetto, `v` non vale 1, `strokes` non è un array, un tratto non è un
/// oggetto o non ha un `id` stringa non vuota, due tratti hanno lo stesso id.
function layerStrokes(value: unknown): readonly Record<string, unknown>[] | null {
  if (!isObject(value)) return null;
  if (value.v !== INK_LAYER_VERSION) return null;
  const strokes = value.strokes;
  if (!Array.isArray(strokes)) return null;
  const ids = new Set<string>();
  for (const stroke of strokes) {
    if (!isObject(stroke)) return null;
    const id = stroke.id;
    if (typeof id !== "string" || id === "" || ids.has(id)) return null;
    ids.add(id);
  }
  return strokes as Record<string, unknown>[];
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/// L'ancora di un tratto nel livello `place`: la misura di riferimento, `null`
/// per un'ancora libera, `undefined` se non vale.
function anchorRef(value: unknown, place: Place): InkRef | null | undefined {
  if (!isObject(value)) return undefined;
  if (value.kind === "card") {
    if (place !== "card" || !positive(value.width) || !positive(value.height)) return undefined;
    return { width: value.width, height: value.height };
  }
  if (value.kind === "free") return place === "board" ? null : undefined;
  return undefined;
}

function readBrush(value: unknown): InkBrush | null {
  if (typeof value !== "string") return null;
  try {
    const brush = parseInkBrush(value);
    checkInkBrush(brush);
    return brush;
  } catch {
    return null;
  }
}

function readInk(value: unknown): QuantizedInk | null {
  if (typeof value !== "string") return null;
  try {
    const ink = decodeInk(value);
    // Un canale sconosciuto non si ridisegna: la lavagna non ha un `d` già
    // calcolato da usare al suo posto.
    if (unknownChannels(ink) !== "") return null;
    return inkToQuantized(ink);
  } catch {
    return null;
  }
}

/// Un tratto con un `id` già controllato, nel livello `place`.
function readStroke(record: Record<string, unknown>, place: Place): InkStrokeEntry {
  const id = record.id as string;
  const tool = record.tool;
  if (tool !== "pen" && tool !== "highlighter") return { id, drawn: false, reason: "tool" };
  const ref = anchorRef(record.anchor, place);
  if (ref === undefined) return { id, drawn: false, reason: "anchor" };
  const color = record.color;
  if (typeof color !== "string" || !HEX6.test(color)) return { id, drawn: false, reason: "color" };
  const brush = readBrush(record.brush);
  if (brush === null) return { id, drawn: false, reason: "brush" };
  const ink = readInk(record.ink);
  if (ink === null) return { id, drawn: false, reason: "ink" };
  return {
    id,
    drawn: true,
    stroke: {
      id,
      tool,
      color,
      brush,
      brushText: record.brush as string,
      inkText: record.ink as string,
      ink,
      ref,
      record,
    },
  };
}

function readLayer(layer: InkLayerRef, node: CanvasNode | null, value: unknown): InkLayerState {
  const records = layerStrokes(value);
  if (records === null) return { layer, node, state: "foreign", strokes: [], drawable: [] };
  const place: Place = node === null ? "board" : "card";
  const strokes = records.map((record) => readStroke(record, place));
  const drawable: DrawableStroke[] = [];
  for (const entry of strokes) if (entry.drawn) drawable.push(entry.stroke);
  return { layer, node, state: "ok", strokes, drawable };
}

/// I livelli d'inchiostro di `doc`: quelli delle schede nell'ordine di
/// `nodes`, poi quello della radice. Una scheda o una radice senza la chiave
/// non compare.
export function readInkLayers(doc: CanvasDocument): InkLayerState[] {
  const layers: InkLayerState[] = [];
  for (const node of doc.nodes) {
    const { present, value } = layerValue(node);
    if (present) layers.push(readLayer({ node: node.id }, node, value));
  }
  const root = layerValue(doc);
  if (root.present) layers.push(readLayer("board", null, root.value));
  return layers;
}

/// Il livello della scheda `node`, o della radice con `null`; `null` se non
/// c'è la chiave.
export function readInkLayer(doc: CanvasDocument, node: CanvasNode | null): InkLayerState | null {
  const holder: object = node ?? doc;
  const { present, value } = layerValue(holder);
  if (!present) return null;
  return readLayer(node === null ? "board" : { node: node.id }, node, value);
}

/// Il livello della scheda `node` (o della radice) accetta tratti nuovi:
/// manca, o è valido. Un livello estraneo Fub non lo scrive.
export function inkLayerWritable(holder: object): boolean {
  const { present, value } = layerValue(holder);
  return !present || layerStrokes(value) !== null;
}

/// L'aspetto della penna di serie allo zoom `zoom` (A11): la biro, blu, 4
/// pixel dello schermo in unità della lavagna. Senza la pressione del
/// dispositivo il pennello la simula (`sim=1`).
export function defaultInkLook(zoom: number, pressure: boolean): InkLook {
  if (!(Number.isFinite(zoom) && zoom > 0)) throw new RangeError(`zoom della lavagna non valido: ${zoom}`);
  return { brush: penBrush(DEFAULT_PEN, INK_PEN_PX / zoom, pressure), color: INK_PEN_COLOR, tool: "pen" };
}

/// Il tratto finito che diventa record: i campioni in coordinate della
/// lavagna (il primo con `t = 0`), se il dispositivo dà la pressione e se il
/// tratto continua in un altro pezzo. `FinishedStroke` e `InkLayerStroke` lo
/// sono.
export interface InkStrokeInput {
  readonly samples: readonly InkSample[];
  readonly pressure: boolean;
  /// Il tratto si è chiuso al limite dei campioni e continua nel pezzo dopo.
  readonly split: boolean;
}

/// Perché un tratto nuovo non diventa record: `full` se supera i limiti di
/// §5 (campioni o byte di `ink`), `failed` se un campione esce dai numeri
/// dell'inchiostro, `empty` se non fa nessun contorno.
export type StrokeRecordRefusal = "full" | "failed" | "empty";

export type StrokeRecordResult =
  | { readonly ok: true; readonly record: InkStrokeRecord }
  | { readonly ok: false; readonly reason: StrokeRecordRefusal };

/// La matrice dalla lavagna alla scheda `holder`: le unità sono le stesse,
/// l'origine va nel suo angolo in alto a sinistra.
function boardToCard(holder: CanvasNode): Affine {
  return [1, 0, 0, 1, -holder.x, -holder.y];
}

/// Il record del tratto `stroke`, scritto con l'aspetto `look`, per la scheda
/// `holder` (o libero con `null`). `now` è l'ora del muro, in millisecondi
/// dal 1970, in cui il tratto è finito: `at` è il suo inizio, `now` meno la
/// durata. Lo spessore di `look.brush` è già in unità della lavagna, che alla
/// misura di adesso sono quelle della scheda.
///
/// Un aspetto con uno strumento, un colore o un pennello che il formato non
/// scrive è un errore di chi chiama, e lancia `RangeError`; un tratto oltre i
/// limiti, o che non si scrive, è un rifiuto.
export function strokeRecord(
  stroke: InkStrokeInput,
  holder: CanvasNode | null,
  look: InkLook,
  now: number,
): StrokeRecordResult {
  const tool = look.tool;
  if (tool !== "pen" && tool !== "highlighter") throw new RangeError(`strumento d'inchiostro sconosciuto: ${tool}`);
  if (!HEX6.test(look.color)) throw new RangeError(`colore d'inchiostro non #rrggbb: ${look.color}`);
  if (holder !== null && !(positive(holder.width) && positive(holder.height))) {
    throw new RangeError(`la scheda ${holder.id} non ha una misura valida`);
  }
  // Il pezzo che continua in un altro non si assottiglia alla fine.
  const brush = closedAtLimit(brushForInput(look.brush, stroke.pressure), stroke.split);
  const brushText = formatInkBrush(brush);
  if (stroke.samples.length > INK_MAX_SAMPLES) return { ok: false, reason: "full" };
  const local = holder === null ? stroke.samples : stroke.samples.map((sample) => toLocal(sample, boardToCard(holder)));
  const built = buildStroke(local, brush, []);
  if (!built.ok) return { ok: false, reason: built.reason };
  const ink = encodeInk(inkFromQuantized(built.ink));
  // `encodeInk` scrive solo ASCII: un carattere è un byte.
  if (ink.length > INK_MAX_BYTES) return { ok: false, reason: "full" };
  const anchor: InkAnchorRecord = holder === null
    ? { kind: "free" }
    : { kind: "card", width: holder.width, height: holder.height };
  const at = startOf(now, stroke.samples);
  const record: InkStrokeRecord = {
    id: newNodeId("s"),
    tool,
    ...(at === null ? {} : { at }),
    brush: brushText,
    color: look.color,
    anchor,
    ink,
  };
  return { ok: true, record };
}

/// L'inizio del tratto, in ISO coi millisecondi; `null` se `now` non è un'ora.
function startOf(now: number, samples: readonly InkSample[]): string | null {
  const duration = samples[samples.length - 1]?.t ?? 0;
  const start = Math.round(now - (Number.isFinite(duration) ? duration : 0));
  const date = new Date(start);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/// Il `DryStroke` di un tratto che si disegna; `null` se il contorno non si
/// calcola. Con `cache` il percorso già calcolato per lo stesso id, inchiostro
/// e pennello si riusa.
export function dryStroke(stroke: DrawableStroke, cache?: InkPathCache): DryStroke | null {
  const compute = (): string => inkPath(stroke.ink, stroke.brush);
  let path: string;
  try {
    path = cache ? cache.path(stroke.id, stroke.inkText, stroke.brushText, compute) : compute();
  } catch {
    return null;
  }
  return { id: stroke.id, path, fill: stroke.color, ref: stroke.ref };
}

/// Il `DryStroke` di un record, letto con le regole del file: l'ancora dice
/// dove sta (`card` su una scheda, `free` sulla radice). `null` se il record
/// non si disegna.
export function toDry(record: InkStrokeRecord | Readonly<Record<string, unknown>>, cache?: InkPathCache): DryStroke | null {
  if (typeof record.id !== "string" || record.id === "") return null;
  const anchor = record.anchor;
  const place: Place = isObject(anchor) && anchor.kind === "card" ? "card" : "board";
  const entry = readStroke(record as Record<string, unknown>, place);
  return entry.drawn ? dryStroke(entry.stroke, cache) : null;
}
