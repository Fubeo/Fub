// Ciò che la griglia chiede all'host e le sue opzioni, con la sessione dei byte:
// le finestre lette che tiene, l'esito dei comandi e le modifiche al giornale.
// Le usa `engine.ts`, che ne riesporta i nomi pubblici.

import type {
  GridApplyRequest,
  GridBytesSession,
  GridBytesWindow,
  GridCommandOutcome,
  GridCommandRequest,
  GridCommandState,
  GridCommit,
  GridDialog,
  GridObject,
  GridSelection as GridCommandSelection,
  GridSurfaceSpec,
  GridWindowRequest,
} from "../../host/contract";
import type { EditorChangeOrigin, TextOperation } from "../core/text-operation";
import type { Theme } from "../../theme/theme";
import type { PdfEngineLoader } from "../media/pdf-view";
import type { GridPosition } from "./model";

/// Le finestre lette che la griglia tiene, per non rileggerle a ogni
/// scorrimento: poco più di quelle di uno schermo.
const MAX_KEPT_WINDOWS = 16;

/// La chiave dell'oggetto che un comando di inserimento dice di aver fatto
/// (`{"chart": 3}`), o `null`.
export function insertedObject(result: string | null): string | null {
  if (result === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(result);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const kind of ["chart", "image", "shape"] as const) {
    const id = (value as Record<string, unknown>)[kind];
    if (typeof id === "number" && Number.isInteger(id) && id >= 0) return `${kind}:${id}`;
  }
  return null;
}

/// L'oggetto sta dove stava: la stessa cella, lo stesso scarto e la stessa
/// misura.
export function sameObjectPlace(left: GridObject, right: GridObject): boolean {
  return left.row === right.row && left.column === right.column && left.dx === right.dx
    && left.dy === right.dy && left.width === right.width && left.height === right.height;
}

/// La sessione della versione 2 aperta su una cartella.
export interface BytesState {
  readonly surface: string;
  readonly instance: string;
  session: GridBytesSession;
}

/// Una cella da scrivere: dove, e l'input che il file deve avere.
export interface CellWrite {
  readonly position: GridPosition;
  readonly after: string;
}

function sameWindow(left: GridBytesWindow, right: GridBytesWindow): boolean {
  return left.sheet === right.sheet && left.row_start === right.row_start && left.column_start === right.column_start;
}

/// Le finestre da tenere dopo una lettura: quelle nuove, e le vecchie ancora
/// della revisione `revision` che le nuove non sostituiscono.
export function keptWindows(kept: readonly GridBytesWindow[], fresh: readonly GridBytesWindow[], revision: string): GridBytesWindow[] {
  const old = kept.filter((window) => window.revision === revision && !fresh.some((candidate) => sameWindow(candidate, window)));
  return [...old, ...fresh].slice(-MAX_KEPT_WINDOWS);
}

export interface GridHost {
  readonly listGridSurfaces: () => Promise<readonly GridSurfaceSpec[]>;
  readonly openGridBytes: (surface: string, doc: string, journal: string, base: string) => Promise<GridBytesSession>;
  readonly gridBytesWindow: (surface: string, instance: string, request: GridWindowRequest) => Promise<GridBytesWindow>;
  readonly applyGridBytes: (surface: string, instance: string, request: GridApplyRequest) => Promise<GridCommit>;
  readonly gridBytesCommands: (surface: string, instance: string, selection: GridCommandSelection) => Promise<readonly GridCommandState[]>;
  readonly gridBytesCommand: (surface: string, instance: string, request: GridCommandRequest) => Promise<GridCommandOutcome>;
  readonly closeGridBytes: (surface: string, instance: string) => Promise<void>;
}

export interface GridChange {
  readonly text: string;
  /**
   * Una conferma del provider che riscrive i byte di un commit già pubblicato
   * non ha patch di celle da dare: porta un'operazione di solo testo, e chi la
   * riceve rilegge il sorgente.
   */
  readonly operation: TextOperation;
  readonly origin: EditorChangeOrigin;
}

/// Come è andato un comando dato con `GridEngine.run`: il risultato come
/// testo JSON, o la ragione del rifiuto (`null`: non è arrivato).
export type GridRun =
  | { readonly ok: true; readonly result: string | null }
  | { readonly ok: false; readonly error: string | null };

/// Che cosa fa un comando del catalogo (`effetto` di `catalogo.generated.json`):
/// cambia la cartella, la legge, o cambia soltanto ciò che si vede.
export type GridCommandEffect = "cambia" | "legge" | "mostra";

/**
 * La griglia di una cartella di Excel: il testo della sessione è il giornale
 * delle sue celle cambiate, e la griglia si apre sui byte con la versione 2
 * del protocollo (`editors/grid/workbook.ts`).
 */
export interface GridEngineOptions {
  readonly surfaceId: string;
  readonly formatId?: string | null;
  readonly revision?: string;
  /// Il documento, per aprire la versione 2 sui suoi byte.
  readonly documentId?: string;
  /// La revisione dei byte da cui il giornale discende adesso: cambia a ogni
  /// salvataggio. Senza, si usa `revision`.
  readonly base?: () => string | null;
  readonly onChange: (change: GridChange) => void;
  readonly onSelectionChange: () => void;
  /// Il catalogo dei comandi è cambiato (`GridEngine.commands`).
  readonly onCommands?: () => void;
  /// Un comando chiede una finestra di dialogo alla shell.
  readonly onDialog?: (dialog: GridDialog) => void;
  /// La cartella mostrata è cambiata: vista del foglio, tabelle o libro.
  readonly onView?: () => void;
  /// Il modo della cella è cambiato (`GridEngine.editMode`).
  readonly onEditMode?: () => void;
  readonly grid?: GridHost;
  readonly theme?: Theme;
  /// Il lettore dei PDF della shell: l'anteprima di stampa ci disegna le
  /// pagine.
  readonly pdf?: PdfEngineLoader;
  /// L'esportazione in PDF della cartella, con l'export dell'host: se si può
  /// adesso, e come si chiede.
  readonly exportPdf?: { readonly available: () => boolean; readonly run: () => void };
}

function byteOffset(value: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("grid source diff offset is not a safe integer");
  }
  return value;
}

function safeSourceBoundary(bytes: Uint8Array, at: number): boolean {
  return at >= 0
    && at <= bytes.length
    && !(at > 0 && at < bytes.length && bytes[at - 1] === 0x0d && bytes[at] === 0x0a);
}

/// Se l'esito di un comando non porta modifiche al giornale.
export function emptyEdit(edit: GridCommit["edit"]): boolean {
  return edit.from === edit.to && !edit.inserted;
}

export function applySourceEdit(source: string, edit: GridCommit["edit"]): string {
  if (typeof edit.deleted !== "string" || typeof edit.inserted !== "string") {
    throw new Error("grid source diff has invalid text");
  }
  const bytes = new TextEncoder().encode(source);
  const from = byteOffset(edit.from);
  const to = byteOffset(edit.to);
  if (from > to || to > bytes.length || !safeSourceBoundary(bytes, from) || !safeSourceBoundary(bytes, to)) {
    throw new Error("grid source diff splits UTF-8 or CRLF");
  }
  let deleted: string;
  try {
    deleted = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(from, to));
  } catch {
    throw new Error("grid source diff splits UTF-8 or CRLF");
  }
  if (deleted !== edit.deleted) throw new Error("grid source diff preimage mismatch");
  const inserted = new TextEncoder().encode(edit.inserted);
  const resultLength = from + inserted.length + bytes.length - to;
  if (!Number.isSafeInteger(resultLength)) throw new Error("grid source diff result is too large");
  const result = new Uint8Array(resultLength);
  result.set(bytes.slice(0, from), 0);
  result.set(inserted, from);
  result.set(bytes.slice(to), from + inserted.length);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(result);
  } catch {
    throw new Error("grid source diff has invalid UTF-8");
  }
}
