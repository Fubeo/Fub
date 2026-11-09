// L'inchiostro della lavagna nel client: disegnare i livelli `fub:ink` che il
// nucleo ha letto e fare il record di un tratto appena finito.
//
// Le regole del formato (quale livello è estraneo, quale tratto si disegna e
// perché no) stanno solo nel nucleo Rust (`crates/fub-canvas-core/src/ink.rs`),
// che il client usa per `.wasm` (`CanvasCore.inkLayers()`,
// `docs/reference/canvas-ink.md`). Qui resta ciò che serve a disegnare:
//
// - **I livelli da disegnare** (`inkLayerStates`): i livelli del nucleo
//   accanto ai tratti del modello, con i tratti che il nucleo dice da
//   disegnare decodificati col codec della §5 (`DrawableStroke`). Un tratto
//   che il codec non sa decodificare non si disegna (`decode`).
// - **Il record** (`strokeRecord`): il tratto della penna, in coordinate della
//   lavagna, portato nelle unità della scheda che lo tiene (o lasciato in
//   quelle della lavagna se è libero), quantizzato con `buildStroke` e scritto
//   con `encodeInk`, con i campi nell'ordine di scrittura. Un tratto oltre i
//   limiti di §5 è un rifiuto, non un'eccezione.
// - **L'asciutto** (`toDry`, `dryStroke`): il `DryStroke` che disegna
//   `ink-paint.ts`, col percorso di `inkPath`.
//
// Niente DOM qui: solo dati, così le stesse funzioni servono alla lavagna e
// ai test.

import { brushForInput, checkInkBrush, formatInkBrush, parseInkBrush, type InkBrush } from "../../ink/brush";
import { toLocal, type Affine } from "../../ink/geometry";
import { inkPath } from "../../ink/outline";
import { INK_HIGHLIGHTER_COLOR } from "../../ink/palette";
import { penBrush, penLook, type PenId } from "../../ink/pens";
import { INK_MAX_SAMPLES, type InkSample, type QuantizedInk } from "../../ink/sample";
import { buildStroke } from "../../ink/tools/stroke";
import { closedAtLimit } from "../../ink/tools/tool";
import { decodeInk, encodeInk, inkFromQuantized, inkToQuantized, INK_MAX_BYTES, unknownChannels } from "../spatial/ink/codec";
import type { InkEraserMode } from "./ink-erase";
import type { InkLook } from "./ink-layer";
import type { DryStroke, InkPathCache, InkRef } from "./ink-paint";
import type { CanvasDocument, CanvasNode } from "./model";
import { newNodeId } from "./operation";
import type { CanvasInkLayer, CanvasInkSkipReason } from "./wasm/core";

/// La chiave del livello, su una scheda o sulla radice.
export const INK_KEY = "fub:ink";

/// Lo spessore della penna di serie in pixel dello schermo (A11, D-5).
export const INK_PEN_PX = 4;

/// Il colore della penna di serie (D-5): un valore del file, non del tema.
export const INK_PEN_COLOR = "#0072b2";

/// Gli strumenti che un tratto può dire.
export type InkStrokeTool = "pen" | "highlighter";

/// Dove sta un livello: sulla radice (`"board"`) o su una scheda.
export type InkLayerRef = "board" | { readonly node: string };

/// Perché un tratto non si disegna: le ragioni del nucleo, nell'ordine in cui
/// le guarda, più `decode` per un tratto che il nucleo dice da disegnare e
/// che il client non sa decodificare (il codec della §5 lo rifiuta, o il
/// modello non ha il tratto dove il nucleo l'ha letto).
export type InkSkipReason = CanvasInkSkipReason | "decode";

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
  /// Il colore del file com'è scritto.
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

/// Un livello da disegnare: lo stato che dice il nucleo, con i tratti del
/// modello.
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

const HEX6 = /^#[0-9a-fA-F]{6}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sameLayer(a: InkLayerRef, b: InkLayerRef): boolean {
  return a === "board" || b === "board" ? a === b : a.node === b.node;
}

/// La misura di riferimento di un'ancora: `null` per un'ancora libera,
/// `undefined` se non si decodifica.
function decodeRef(value: unknown): InkRef | null | undefined {
  if (!isObject(value)) return undefined;
  if (value.kind === "card") {
    return positive(value.width) && positive(value.height) ? { width: value.width, height: value.height } : undefined;
  }
  return value.kind === "free" ? null : undefined;
}

function decodeBrush(value: unknown): InkBrush | null {
  if (typeof value !== "string") return null;
  try {
    const brush = parseInkBrush(value);
    checkInkBrush(brush);
    return brush;
  } catch {
    return null;
  }
}

function decodeInkText(value: unknown): QuantizedInk | null {
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

/// Il tratto `record` decodificato per disegnarlo, `null` se il client non
/// lo sa decodificare. Non decide se il tratto si disegna, né se la sua
/// ancora vale dove sta: lo dice il nucleo (`CanvasCore.inkLayers()`). Un
/// record fatto da `strokeRecord` si decodifica sempre.
export function decodeStroke(record: Readonly<Record<string, unknown>>): DrawableStroke | null {
  const { id, tool, color } = record;
  if (typeof id !== "string" || id === "") return null;
  if (tool !== "pen" && tool !== "highlighter") return null;
  if (typeof color !== "string") return null;
  const ref = decodeRef(record.anchor);
  if (ref === undefined) return null;
  const brush = decodeBrush(record.brush);
  if (brush === null) return null;
  const ink = decodeInkText(record.ink);
  if (ink === null) return null;
  return {
    id,
    tool,
    color,
    brush,
    brushText: record.brush as string,
    inkText: record.ink as string,
    ink,
    ref,
    record,
  };
}

/// I livelli da disegnare: quelli che il nucleo ha letto (`layers`, da
/// `CanvasCore.inkLayers()`), nel suo ordine, accanto ai tratti di `doc`, il
/// modello dello stesso testo. Un tratto che il nucleo dice da disegnare si
/// decodifica; se il client non ci riesce, o se in `doc` al suo posto non c'è
/// lo stesso id, non si disegna (`decode`). Un livello di una scheda che non
/// è in `doc` non compare: `doc` e `layers` non vengono dallo stesso testo.
export function inkLayerStates(doc: CanvasDocument, layers: readonly CanvasInkLayer[]): InkLayerState[] {
  const states: InkLayerState[] = [];
  for (const read of layers) {
    const ref = read.layer;
    const node = ref === "board" ? null : doc.nodes.find((candidate) => candidate.id === ref.node);
    if (node === undefined) continue;
    if (read.state !== "ok") {
      states.push({ layer: ref, node, state: "foreign", strokes: [], drawable: [] });
      continue;
    }
    const value = (node ?? doc)[INK_KEY];
    const records: readonly unknown[] = isObject(value) && Array.isArray(value.strokes) ? value.strokes : [];
    const drawable: DrawableStroke[] = [];
    const strokes = read.strokes.map((entry, index): InkStrokeEntry => {
      if (!entry.drawn) return { id: entry.id, drawn: false, reason: entry.reason };
      const record = records[index];
      const stroke = isObject(record) && record.id === entry.id ? decodeStroke(record) : null;
      if (!stroke) return { id: entry.id, drawn: false, reason: "decode" };
      drawable.push(stroke);
      return { id: entry.id, drawn: true, stroke };
    });
    states.push({ layer: ref, node, state: "ok", strokes, drawable });
  }
  return states;
}

/// Se il nucleo dice estraneo il livello `layer` (`layers` da
/// `CanvasCore.inkLayers()`): Fub non ci scrive. Un livello che non c'è
/// ancora non è estraneo.
export function foreignInkLayer(layers: readonly CanvasInkLayer[], layer: InkLayerRef): boolean {
  return layers.some((read) => read.state === "foreign" && sameLayer(read.layer, layer));
}

/// Lo strumento scelto nel menu della penna (T21): con la Gomma la punta e il
/// mouse che scrive cancellano.
export type InkMenuTool = InkStrokeTool | "eraser";

/// Le penne della Penna: quelle di sistema tranne l'evidenziatore.
export type InkPenKind = Exclude<PenId, "highlighter">;

/// Lo spessore dell'evidenziatore di serie, in pixel dello schermo (A19).
export const INK_HIGHLIGHTER_PX = 16;

/// L'intervallo e il passo del cursore dello spessore, in pixel dello
/// schermo, per ogni strumento che scrive.
export const INK_WIDTH_RANGES: Readonly<Record<InkStrokeTool, { readonly min: number; readonly max: number; readonly step: number }>> = {
  pen: { min: 0.5, max: 20, step: 0.5 },
  highlighter: { min: 4, max: 48, step: 1 },
};

/// La scelta del menu della penna (A19): lo strumento, la penna della Penna,
/// per la Penna e per l'evidenziatore ciascuno il suo colore (`#rrggbb`) e il
/// suo spessore (pixel dello schermo), e che cosa cancella la gomma.
export interface InkPenChoice {
  readonly tool: InkMenuTool;
  readonly pen: InkPenKind;
  readonly color: Readonly<Record<InkStrokeTool, string>>;
  readonly width: Readonly<Record<InkStrokeTool, number>>;
  readonly eraser: InkEraserMode;
}

/// La scelta di serie (A11, A19): la Sfera blu da 4 pixel, l'evidenziatore
/// giallo da 16, la gomma che toglie il tratto intero.
export const DEFAULT_INK_CHOICE: InkPenChoice = Object.freeze({
  tool: "pen",
  pen: "ballpoint",
  color: Object.freeze({ pen: INK_PEN_COLOR, highlighter: INK_HIGHLIGHTER_COLOR }),
  width: Object.freeze({ pen: INK_PEN_PX, highlighter: INK_HIGHLIGHTER_PX }),
  eraser: "stroke",
});

/// Lo spessore `value` di `tool` come lo dà il cursore: riportato
/// all'intervallo e al suo passo; `null` se non è un numero.
export function inkWidthOf(tool: InkStrokeTool, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const { min, max, step } = INK_WIDTH_RANGES[tool];
  const steps = Math.round((Math.min(max, Math.max(min, value)) - min) / step);
  // Niente code di virgola mobile: i passi sono mezzi pixel o pixel interi.
  return Math.round(Math.min(max, min + steps * step) * 1000) / 1000;
}

/// Lo strumento che scrive con la scelta `choice`: con la Gomma la Penna, che
/// serve solo se un tratto della punta comincia lo stesso.
export function inkStrokeTool(choice: InkPenChoice): InkStrokeTool {
  return choice.tool === "highlighter" ? "highlighter" : "pen";
}

/// La penna di sistema con cui scrive la scelta `choice`.
export function inkPenOf(choice: InkPenChoice): PenId {
  return inkStrokeTool(choice) === "highlighter" ? "highlighter" : choice.pen;
}

/// L'aspetto del tratto che comincia con la scelta `choice` allo zoom `zoom`:
/// la penna scelta (l'evidenziatore col suo strumento), il suo colore e il suo
/// spessore in pixel dello schermo portato in unità della lavagna. Senza la
/// pressione del dispositivo il pennello la simula, se la penna la segue.
export function inkLook(choice: InkPenChoice, zoom: number, pressure: boolean): InkLook {
  if (!(Number.isFinite(zoom) && zoom > 0)) throw new RangeError(`zoom della lavagna non valido: ${zoom}`);
  const tool = inkStrokeTool(choice);
  return { brush: penBrush(inkPenOf(choice), choice.width[tool] / zoom, pressure), color: choice.color[tool], tool };
}

/// L'aspetto della penna di serie allo zoom `zoom` (A11): la biro, blu, 4
/// pixel dello schermo in unità della lavagna. Senza la pressione del
/// dispositivo il pennello la simula (`sim=1`).
export function defaultInkLook(zoom: number, pressure: boolean): InkLook {
  return inkLook(DEFAULT_INK_CHOICE, zoom, pressure);
}

/// Quanto copre un tratto col pennello `brush` di `tool` sulla lavagna:
/// l'opacità della sua penna (`penLook`; l'evidenziatore 0,5), senza la
/// fusione `multiply`, che sulle schede scure lo spegnerebbe (A22).
export function inkOpacity(brush: InkBrush, tool: string): number {
  return penLook(brush, tool).opacity;
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
  const opacity = inkOpacity(stroke.brush, stroke.tool);
  return { id: stroke.id, path, fill: stroke.color, ref: stroke.ref, ...(opacity < 1 ? { opacity } : {}) };
}

/// Il `DryStroke` di un record: un tratto appena fatto da `strokeRecord`, o
/// uno che il nucleo dice da disegnare. Non giudica il record (lo fa il
/// nucleo): lo decodifica e ne fa il contorno. `null` se non si decodifica o
/// il contorno non si calcola.
export function toDry(record: InkStrokeRecord | Readonly<Record<string, unknown>>, cache?: InkPathCache): DryStroke | null {
  const stroke = decodeStroke(record);
  return stroke ? dryStroke(stroke, cache) : null;
}
