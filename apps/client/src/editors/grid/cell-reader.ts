// Il lettore dei valori di cella nel testo (T53): ciò che
// `editors/text/profiles/markdown/cell-value.ts` mostra di
// `![[Conti.xlsx#Budget!C7]]`.
//
// Legge come la scheda di foglio (`card.ts`) e niente di più: la superficie
// della famiglia `grid`, della versione 2 del protocollo e del formato del
// file; `openGridBytes` sul giornale e sulla base della porta (la linguetta
// aperta, anche non salvata, o i byte del disco); per ogni parte il comando
// che legge soltanto `fub.part` (o, con un provider che non lo serve, il
// foglio per nome e la cella in A1); poi una finestra di una cella sola. Una
// sessione per file e per lettura, chiusa sempre. Non chiama mai
// `applyGridBytes` né un comando che scrive: il valore è quello salvato, col
// formato del foglio (`display`), e un valore non ricalcolato lo dice
// (`stale`).
import type { GridBytesCell, GridBytesSession, GridBytesWindow } from "../../host/contract";
import { GRID_BYTES_PROTOCOL_VERSION, GRID_FAMILY } from "../../host/contract";
import { isErrorKind } from "../../host/errors";
import type { CellReading, CellValueReader } from "../text/profiles/markdown/cell-value";
import { sheetPartAnswer, type SheetCardPort } from "./card";
import type { GridHost } from "./engine";
import { mergeAnchor, parseCellA1 } from "./merges";
import type { GridPosition } from "./model";
import { validateBytesSession, validateBytesWindow } from "./workbook";

/// Il comando del provider che dice dove sta una parte.
const PART_COMMAND = "fub.part";

/// Ciò che il lettore chiede a chi lo monta: le chiamate della superficie del
/// foglio e la sorgente della sessione, le stesse della scheda.
export interface CellReaderPort {
  readonly host: GridHost;
  readonly source: SheetCardPort["source"];
}

/// Dove sta una cella: l'id del foglio della sessione e la posizione.
interface CellPlace {
  readonly sheet: string;
  readonly at: GridPosition;
}

/// `Budget!C7`, `'Conti 2025'!$B$2`, `C7`: il foglio (o `null`) e la cella.
function splitPart(part: string): { readonly sheet: string | null; readonly cell: string } | null {
  const bang = part.lastIndexOf("!");
  const cell = part.slice(bang + 1).trim().replaceAll("$", "").toUpperCase();
  if (bang < 0) return { sheet: null, cell };
  const raw = part.slice(0, bang).trim();
  const quoted = /^'((?:[^']|'')+)'$/.exec(raw);
  const sheet = quoted ? quoted[1]!.replaceAll("''", "'") : raw;
  return sheet === "" ? null : { sheet, cell };
}

/// La lettura di una cella com'è nella finestra: il valore formattato, vuota,
/// o un errore di formula.
export function readingOf(cell: GridBytesCell | undefined): CellReading {
  if (!cell || (cell.value.kind === "blank" && cell.display === "")) return { state: "empty" };
  if (cell.display === "" && cell.value.kind === "text" && cell.value.value === "") return { state: "empty" };
  return { state: "value", text: cell.display, error: cell.value.kind === "error", stale: cell.stale };
}

/// Il lettore dei valori di cella, sulle porte della scheda di foglio.
export function sheetCellReader(port: CellReaderPort): CellValueReader {
  return {
    read: (path, parts) => readCells(port, path, parts),
  };
}

async function readCells(port: CellReaderPort, path: string, parts: readonly string[]): Promise<ReadonlyMap<string, CellReading>> {
  const answers = new Map<string, CellReading>();
  const all = (reading: CellReading) => {
    for (const part of parts) answers.set(part, reading);
    return answers;
  };
  let opened: { surface: string; session: GridBytesSession } | null;
  try {
    opened = await openSession(port, path);
  } catch (error) {
    return all(isErrorKind(error, "not_found") ? { state: "missing" } : { state: "unavailable" });
  }
  if (opened === null) return all({ state: "missing" });
  const { surface, session } = opened;
  try {
    for (const part of parts) {
      try {
        const place = await findCell(port.host, surface, session, part);
        answers.set(part, place === null ? { state: "lost" } : await readCell(port.host, surface, session, place));
      } catch (error) {
        console.warn(`note: la cella «${part}» di ${path} non si legge`, error);
        answers.set(part, { state: "unavailable" });
      }
    }
  } finally {
    void port.host.closeGridBytes(surface, session.instance).catch(() => {});
  }
  return answers;
}

/// Apre la sessione di sola lettura del file; `null` se il file non c'è. Una
/// base vecchia (`conflict`) si riprova una volta con quella di adesso.
async function openSession(port: CellReaderPort, path: string): Promise<{ surface: string; session: GridBytesSession } | null> {
  for (let attempt = 0; ; attempt++) {
    const source = await port.source(path);
    if (source === null) return null;
    const surface = (await port.host.listGridSurfaces()).find((candidate) =>
      candidate.family === GRID_FAMILY
      && candidate.protocol_version === GRID_BYTES_PROTOCOL_VERSION
      && candidate.format === source.format);
    if (!surface) throw new Error("no grid surface for the cell value");
    let session: GridBytesSession;
    try {
      session = await port.host.openGridBytes(surface.id, path, source.journal, source.base);
    } catch (error) {
      if (attempt === 0 && isErrorKind(error, "conflict")) continue;
      throw error;
    }
    try {
      validateBytesSession(session);
    } catch (error) {
      void port.host.closeGridBytes(surface.id, session.instance).catch(() => {});
      throw error;
    }
    return { surface: surface.id, session };
  }
}

/// Dove sta la cella della parte: la risposta di `fub.part` (la prima cella
/// del rettangolo), o, senza il comando, il foglio per nome e la cella.
/// `null`: la cartella non ha quel foglio o quella cella.
async function findCell(host: GridHost, surface: string, session: GridBytesSession, part: string): Promise<CellPlace | null> {
  if (session.commands.some((command) => command.id === PART_COMMAND && command.enabled)) {
    const outcome = await host.gridBytesCommand(surface, session.instance, {
      revision: session.revision,
      command: { id: PART_COMMAND, params: JSON.stringify({ part }), sheet: session.active, selection: "A1", active: "A1" },
    });
    const answer = sheetPartAnswer(outcome.result);
    if (answer !== null) {
      if ("parts" in answer) return null;
      return { sheet: answer.sheet, at: { row: answer.range.rowStart, column: answer.range.columnStart } };
    }
  }
  const split = splitPart(part);
  const at = split === null ? null : parseCellA1(split.cell);
  if (split === null || at === null) return null;
  const wanted = split.sheet?.toLowerCase() ?? null;
  const sheet = wanted === null
    ? session.sheets.find((candidate) => candidate.id === session.active)
    : session.sheets.find((candidate) => candidate.name.toLowerCase() === wanted);
  return sheet ? { sheet: sheet.id, at } : null;
}

/// Legge la cella `place`: una finestra di una cella. Una cella dentro
/// un'unione vale per l'unione: si legge la sua cella in alto a sinistra.
async function readCell(host: GridHost, surface: string, session: GridBytesSession, place: CellPlace): Promise<CellReading> {
  const sheet = session.sheets.find((candidate) => candidate.id === place.sheet);
  if (!sheet || place.at.row >= sheet.row_count || place.at.column >= sheet.column_count) return { state: "lost" };
  let at = place.at;
  for (let pass = 0; pass < 2; pass++) {
    const window = await host.gridBytesWindow(surface, session.instance, {
      revision: session.revision,
      sheet: sheet.id,
      row_start: at.row,
      row_count: 1,
      column_start: at.column,
      column_count: 1,
      known_media: [],
    });
    validateBytesWindow(window, session);
    const anchor = mergeAnchor(window.merges, at);
    if (anchor.row !== at.row || anchor.column !== at.column) {
      at = anchor;
      continue;
    }
    return readingOf(cellIn(window, at));
  }
  return { state: "empty" };
}

/// La cella di `window` alla posizione `at`, se la finestra la porta.
function cellIn(window: GridBytesWindow, at: GridPosition): GridBytesCell | undefined {
  const row = window.rows.find((candidate) => candidate.index === at.row)?.id;
  const column = window.columns.find((candidate) => candidate.index === at.column)?.id;
  if (row === undefined || column === undefined) return undefined;
  return window.cells.find((cell) => cell.key.row === row && cell.key.column === column);
}
