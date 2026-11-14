// La misura e l'allineamento del testo di una scheda (T92): il campo
// `fub:text` di una scheda `text`, letto e scritto con le regole della
// sezione «La misura e l'allineamento del testo» di
// `docs/reference/canvas-format.md`.
//
// Il testo della scheda resta Markdown puro, nel campo `text` di JSON Canvas:
// la misura e l'allineamento stanno a parte, come `fub:ink` e `fub:parts`.
// Le stesse regole stanno nel nucleo (`crates/fub-canvas-core/src/text.rs`):
// i vettori di `src/__fixtures__/canvas-text/` passano uguali qui
// (`text-style.test.ts`) e là (`tests/text_vectors.rs`).
//
// Leggere non tocca il file: il campo resta nei campi sconosciuti della
// scheda. Uno che non si capisce (una versione futura, una misura
// sconosciuta) si conserva così com'è (`kept`, con la ragione) e la scheda si
// mostra di serie. Scrivere dà il valore del campo, `null` quando la misura e
// l'allineamento sono di serie e non resta altro: allora la chiave sparisce.
import type { CanvasNode } from "./model";

/// La chiave della misura e dell'allineamento, su una scheda `text`.
export const TEXT_KEY = "fub:text";
/// La versione del campo che Fub legge e scrive.
export const TEXT_VERSION = 1;

/// Le misure, dalla più piccola; `m` è quella di serie.
export const TEXT_SIZES = ["s", "m", "l", "xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
/// Gli allineamenti, nel verso della lingua; `start` è quello di serie.
export const TEXT_ALIGNS = ["start", "center", "end"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/// Come si mostra il testo di una scheda.
export interface TextStyle {
  readonly size: TextSize;
  readonly align: TextAlign;
}

/// Il testo di serie: medio, all'inizio della riga.
export const DEFAULT_TEXT_STYLE: TextStyle = { size: "m", align: "start" };

/// I campi che Fub non conosce, nel loro ordine.
export type TextExtra = Readonly<Record<string, unknown>>;

/// Un campo `fub:text` valido: i campi noti (`null`: assente, vale di serie)
/// e quelli sconosciuti.
export interface CanvasText {
  readonly size: TextSize | null;
  readonly align: TextAlign | null;
  readonly extra: TextExtra;
}

/// Perché un campo si conserva senza mostrarlo, nell'ordine dei controlli.
export type TextKeptReason = "node" | "object" | "version" | "field";

export type TextState =
  | { readonly state: "ok"; readonly text: CanvasText }
  | { readonly state: "kept"; readonly reason: TextKeptReason };

/// Perché Fub non scrive la misura e l'allineamento.
export type TextRefusedReason = "node";

export type TextWrite =
  | { readonly outcome: "written"; readonly text: Record<string, unknown> | null }
  | { readonly outcome: "refused"; readonly reason: TextRefusedReason };

const FIELDS: readonly string[] = ["v", "size", "align"];

/// Legge il valore di `fub:text`; il motivo dice perché si conserva senza
/// mostrarlo. Non guarda il tipo della scheda: lo fa `nodeText`.
export function textFromValue(value: unknown): CanvasText | TextKeptReason {
  if (!isObject(value)) return "object";
  if (value.v !== TEXT_VERSION) return "version";
  let size: TextSize | null = null;
  if (has(value, "size")) {
    if (!isTextSize(value.size)) return "field";
    size = value.size;
  }
  let align: TextAlign | null = null;
  if (has(value, "align")) {
    if (!isTextAlign(value.align)) return "field";
    align = value.align;
  }
  const extra: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (!FIELDS.includes(key)) put(extra, key, field);
  }
  return { size, align, extra };
}

/// Il campo come valore JSON: `v`, `size` e `align` se ci sono, poi i campi
/// sconosciuti nel loro ordine.
export function textValue(text: CanvasText): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, "v", TEXT_VERSION);
  if (text.size !== null) put(out, "size", text.size);
  if (text.align !== null) put(out, "align", text.align);
  for (const [key, value] of Object.entries(text.extra)) {
    if (!FIELDS.includes(key)) put(out, key, value);
  }
  return out;
}

/// Il campo `fub:text` della scheda, letto; `null` se la scheda non l'ha.
export function nodeText(node: CanvasNode): TextState | null {
  if (!has(node, TEXT_KEY)) return null;
  if (node.type !== "text") return { state: "kept", reason: "node" };
  const text = textFromValue(node[TEXT_KEY]);
  return typeof text === "string" ? { state: "kept", reason: text } : { state: "ok", text };
}

/// Come si mostra il testo della scheda: quello del campo valido, di serie
/// senza campo o con un campo che si conserva.
export function textStyle(node: CanvasNode): TextStyle {
  const read = nodeText(node);
  if (read?.state !== "ok") return DEFAULT_TEXT_STYLE;
  return { size: read.text.size ?? DEFAULT_TEXT_STYLE.size, align: read.text.align ?? DEFAULT_TEXT_STYLE.align };
}

/// I campi delle schede che li hanno, nell'ordine di `nodes`.
export function readText(nodes: readonly CanvasNode[]): { readonly node: string; readonly read: TextState }[] {
  const out: { node: string; read: TextState }[] = [];
  for (const node of nodes) {
    const read = nodeText(node);
    if (read !== null) out.push({ node: node.id, read });
  }
  return out;
}

/// Il campo che Fub scrive sulla scheda `node` per mostrarla con `style`;
/// `text: null`, la chiave non c'è. Solo ciò che non è di serie si scrive.
/// Un campo valido tiene i suoi campi sconosciuti (e con quelli resta anche
/// di serie); uno che si conserva senza mostrarlo si riscrive alla versione
/// 1, senza il suo contenuto.
export function writeText(node: CanvasNode, style: TextStyle): TextWrite {
  if (node.type !== "text") return { outcome: "refused", reason: "node" };
  const read = nodeText(node);
  const text: CanvasText = {
    size: style.size === DEFAULT_TEXT_STYLE.size ? null : style.size,
    align: style.align === DEFAULT_TEXT_STYLE.align ? null : style.align,
    extra: read?.state === "ok" ? read.text.extra : {},
  };
  const bare = text.size === null && text.align === null && Object.keys(text.extra).length === 0;
  return { outcome: "written", text: bare ? null : textValue(text) };
}

/// La scheda con `style`: il campo scritto, o tolto quando torna di serie.
/// `null` se la scheda non ha testo o si mostra già così: allora non cambia
/// niente, nemmeno un campo che si conserva senza mostrarlo.
export function withTextStyle(node: CanvasNode, style: TextStyle): CanvasNode | null {
  const shown = textStyle(node);
  if (shown.size === style.size && shown.align === style.align) return null;
  const written = writeText(node, style);
  if (written.outcome !== "written") return null;
  const next: CanvasNode = { ...node };
  delete next[TEXT_KEY];
  if (written.text !== null) next[TEXT_KEY] = written.text;
  return next;
}

/// `value` è il nome di una misura.
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && (TEXT_SIZES as readonly string[]).includes(value);
}

/// `value` è il nome di un allineamento.
export function isTextAlign(value: unknown): value is TextAlign {
  return typeof value === "string" && (TEXT_ALIGNS as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/// Assegna una chiave propria anche quando è `__proto__`, come `JSON.parse`.
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
