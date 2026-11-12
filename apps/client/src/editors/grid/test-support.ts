// Ciò che i test della griglia hanno in comune: gli host finti della versione 2
// (`bytesHost`, `workbookHost`), il montaggio e i gesti che si ripetono.

import { findTextEditorOrThrow } from "../text/test-support";
import {
  GRID_BYTES_PROTOCOL_VERSION,
  type GridApplyRequest,
  type GridBytesCell,
  type GridBytesSession,
  type GridBytesWindow,
  type GridCellKey,
  type GridCellStyle,
  type GridCommand,
  type GridCommandOutcome,
  type GridCommandRequest,
  type GridCommandState,
  type GridCommit,
  type GridDialog,
  type GridSurfaceSpec,
  type GridWindowRequest,
  type PluginError,
} from "../../host/contract";
import { gridJournalText, parseGridJournal, recordGridJournal, type GridJournal } from "../../state/grid-journal";
import { GridEngine, type GridChange, type GridEngineOptions, type GridHost } from "./engine";
import { cellA1, parseCellA1 } from "./merges";
import { DEFAULT_SHEET_VIEW } from "./workbook";
import xlsx from "../../__fixtures__/xlsx-grid.json";

export const SURFACE: GridSurfaceSpec = {
  id: "fub.grid.test",
  format: "xlsx",
  family: "grid",
  protocol_version: GRID_BYTES_PROTOCOL_VERSION,
};

const PLAIN: GridCellStyle = {
  bold: false,
  italic: false,
  text_color: null,
  fill_color: null,
  horizontal: null,
  number_format: null,
  font: null,
  font_size: null,
  underline: null,
  strike: false,
  script: null,
  vertical: null,
  wrap: false,
  shrink: false,
  indent: 0,
  rotation: 0,
  borders: { top: null, right: null, bottom: null, left: null, diagonal_down: null, diagonal_up: null },
};

interface Plan {
  readonly rows?: number;
  readonly columns?: number;
  readonly hiddenRows?: readonly number[];
  readonly hiddenColumns?: readonly number[];
  /** Gli input sul disco, per `"riga,colonna"`. */
  readonly cells?: Readonly<Record<string, string>>;
  readonly surfaces?: readonly GridSurfaceSpec[];
  /** Celle che il provider dice cambiate oltre a quelle scritte. */
  readonly invalidated?: readonly GridCellKey[];
  readonly onClose?: (instance: string) => void;
}

/**
 * Un provider della versione 2 per un foglio sintetico `main`: legge le
 * finestre che gli chiedono dal disco più il giornale, e controlla ogni
 * scrittura sulla revisione. È il banco delle proprietà della griglia che non
 * dipendono da una cartella vera.
 */
export function bytesHost(plan: Plan = {}) {
  const rowCount = plan.rows ?? 100;
  const columnCount = plan.columns ?? 50;
  const disk = new Map(Object.entries(plan.cells ?? { "0,0": "1" }));
  const calls: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const active = new Set<string>();
  const requests: { row_start: number; column_start: number }[] = [];
  const applied: GridApplyRequest[] = [];
  let journal = "";
  let revision = 0;
  const rev = () => `rev-${revision}`;
  const at = (row: string, column: string) => disk.get(`${row.slice(1)},${column.slice(1)}`) ?? "";
  const inputs = () => {
    const current = new Map(disk);
    for (const entry of parseGridJournal(journal).entries) current.set(`${entry.row.slice(1)},${entry.column.slice(1)}`, entry.after);
    return current;
  };
  const host: GridHost = {
    listGridSurfaces: async () => {
      calls.push("list");
      return plan.surfaces ?? [SURFACE];
    },
    openGridBytes: async (surface, _doc, text) => {
      calls.push(`open ${surface}`);
      journal = text;
      const instance = `bytes-${opened.length + 1}`;
      opened.push(instance);
      active.add(instance);
      return {
        instance,
        revision: rev(),
        sheets: [{ id: "main", name: "Main", row_count: rowCount, column_count: columnCount }],
        active: "main",
        hidden: [],
        notices: [],
        conflicts: [],
        commands: [],
        book: structuredClone(xlsx.session.book) as GridBytesSession["book"],
      };
    },
    gridBytesWindow: async (_surface, instance, request) => {
      calls.push("window");
      requests.push({ row_start: request.row_start, column_start: request.column_start });
      if (!active.has(instance)) throw new Error("closed");
      const current = inputs();
      const cells: GridBytesCell[] = [];
      for (let row = request.row_start; row < request.row_start + request.row_count; row += 1) {
        for (let column = request.column_start; column < request.column_start + request.column_count; column += 1) {
          const input = current.get(`${row},${column}`);
          if (input === undefined || input === "") continue;
          const number = Number(input);
          cells.push({
            key: { sheet: "main", row: `r${row}`, column: `c${column}` },
            input,
            style: 0,
            value: Number.isFinite(number) ? { kind: "number", value: number } : { kind: "text", value: input },
            display: input,
            lock: null,
            stale: false,
            conflict: false,
            data_bar: null,
            icon: null,
            comment: null,
            link: null,
          });
        }
      }
      return {
        revision: request.revision,
        sheet: request.sheet,
        row_start: request.row_start,
        column_start: request.column_start,
        total_rows: rowCount,
        total_columns: columnCount,
        rows: Array.from({ length: request.row_count }, (_, offset) => {
          const index = request.row_start + offset;
          return { id: `r${index}`, index, height: null, hidden: plan.hiddenRows?.includes(index) ?? false };
        }),
        columns: Array.from({ length: request.column_count }, (_, offset) => {
          const index = request.column_start + offset;
          return { id: `c${index}`, index, width: null, hidden: plan.hiddenColumns?.includes(index) ?? false };
        }),
        cells,
        styles: [PLAIN],
        merges: [],
        view: { ...DEFAULT_SHEET_VIEW },
        tables: [],
        objects: [],
      };
    },
    applyGridBytes: async (_surface, _instance, request) => {
      calls.push("apply");
      applied.push(structuredClone(request));
      if (request.revision !== rev()) throw { kind: "conflict", message: "stale grid revision" } satisfies PluginError;
      let next = parseGridJournal(journal);
      for (const patch of request.patches) next = recordGridJournal(next, patch.cell, at(patch.cell.row, patch.cell.column), patch.after);
      const deleted = journal;
      journal = gridJournalText(next);
      revision += 1;
      return {
        revision: rev(),
        edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted: journal },
        invalidation: { kind: "cells", cells: [...request.patches.map((patch) => patch.cell), ...(plan.invalidated ?? [])] },
      };
    },
    gridBytesCommands: async () => [],
    gridBytesCommand: async (_surface, _instance, request) => {
      throw { kind: "bad_args", message: `grid command \`${request.command.id}\` is not served` } satisfies PluginError;
    },
    closeGridBytes: async (_surface, instance) => {
      calls.push("close");
      closed.push(instance);
      active.delete(instance);
      plan.onClose?.(instance);
    },
  };
  return { host, calls, opened, closed, active, requests, applied, journal: () => journal };
}

type BytesHost = ReturnType<typeof bytesHost>;

export async function mounted(grid: BytesHost | GridHost = bytesHost(), journal = "") {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: GridChange[] = [];
  const engine = new GridEngine(host, {
    surfaceId: "test",
    formatId: "xlsx",
    revision: "sha256:file",
    documentId: "test.xlsx",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    grid: "host" in grid ? grid.host : grid,
  });
  const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 300 },
  });
  engine.setDoc(journal);
  await settle();
  return { engine, host, viewport, changes };
}

/** Gli `after` del giornale, per `"riga,colonna"`. */
export function written(journal: string): Record<string, string> {
  return Object.fromEntries(parseGridJournal(journal).entries
    .map((entry) => [`${entry.row.slice(1)},${entry.column.slice(1)}`, entry.after]));
}

/** Lascia finire ogni promessa in volo: un giro di macrotask viene dopo tutte. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Conferma la cella attiva come se l'utente ci avesse scritto `text` e Invio. */
export function typeInActiveCell(host: HTMLElement, viewport: HTMLElement, text: string): void {
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: text[0], bubbles: true }));
  if (text.length > 1) {
    const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: text.slice(1) }, userEvent: "input" });
  }
  host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
}

export const cellAt = (host: HTMLElement, row: number, column: number) =>
  host.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);

/// Il valore che un comando d'input scrive, come input della cella.
function inputOfValue(value: unknown): string {
  return value === null ? "" : typeof value === "string" ? value : String(value);
}

/// Le celle che i comandi `range.setValues` del giornale scrivono, per foglio.
function commandInputs(journal: GridJournal): Map<string, string> {
  const out = new Map<string, string>();
  for (const command of journal.commands) {
    if (command.id !== "range.setValues") continue;
    const { range, values } = JSON.parse(command.params) as { range: string; values: unknown[][] };
    const at = parseCellA1(range)!;
    out.set(`${command.sheet}\u0000r${at.row}\u0000c${at.column}`, inputOfValue(values[0]![0]));
  }
  return out;
}

export function workbookHost(options: {
  readonly base?: () => string;
  /// Se la sessione serve `range.setValues`: con `false` il catalogo non
  /// riceve formule.
  readonly serves?: boolean;
  /// Cambia la finestra prima che arrivi alla griglia.
  readonly window?: (window: GridBytesWindow) => void;
  /// La finestra di dialogo che un comando chiede.
  readonly dialog?: (command: GridCommand) => GridDialog | null;
  /// I comandi che il catalogo non serve.
  readonly drop?: readonly string[];
} = {}) {
  const calls: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const applied: GridApplyRequest[] = [];
  const answers: Array<() => void> = [];
  let hold = false;
  let failApply: PluginError | null = null;
  let journal = "";
  let instances = 0;
  const base = options.base ?? (() => xlsx.document_revision);
  const given: GridCommandRequest[] = [];
  const undone: GridCommand[] = [];
  const catalog = (): GridCommandState[] => (structuredClone(xlsx.session.commands) as GridCommandState[])
    .filter((command) => options.serves !== false || command.id !== "range.setValues")
    .filter((command) => !options.drop?.includes(command.id));
  const sessionFor = (text: string): GridBytesSession => {
    if (text === xlsx.conflict.journal) return structuredClone(xlsx.conflict.session) as GridBytesSession;
    const session = structuredClone(xlsx.session) as GridBytesSession;
    return { ...session, revision: text === "" ? session.revision : `rev:${text}`, commands: catalog() };
  };
  const diskOf = (sheet: string, row: string, column: string) => (xlsx.windows as GridBytesWindow[])
    .find((window) => window.sheet === sheet)?.cells
    .find((cell) => cell.key.row === row && cell.key.column === column)?.input ?? "";
  const revisionOf = (text: string) => text === xlsx.edit.commit.edit.inserted
    ? xlsx.edit.commit.revision
    : text === "" ? xlsx.session.revision : `rev:${text}`;
  const host: GridHost = {
    listGridSurfaces: async () => {
      calls.push("list");
      return [xlsx.surface];
    },
    openGridBytes: async (surface, doc, text, revision) => {
      calls.push(`open ${surface} ${doc} ${text === "" ? "∅" : "journal"} ${revision === xlsx.document_revision ? "base" : revision}`);
      if (revision !== base()) throw { kind: "conflict", message: "grid source changed" } satisfies PluginError;
      journal = text;
      const session = sessionFor(text);
      session.instance = `xlsx-${++instances}`;
      opened.push(session.instance);
      return session;
    },
    gridBytesWindow: async (_surface, instance, request: GridWindowRequest) => {
      calls.push(`window ${request.sheet} ${request.row_start} ${request.column_start}`);
      if (closed.includes(instance)) throw new Error("closed");
      if (request.revision === xlsx.edit.commit.revision && request.sheet === "s1") {
        return structuredClone(xlsx.edit.window) as GridBytesWindow;
      }
      if (journal === xlsx.conflict.journal && request.sheet === "s1") {
        return structuredClone(xlsx.conflict.window) as GridBytesWindow;
      }
      const window = structuredClone((xlsx.windows as GridBytesWindow[]).find((candidate) => candidate.sheet === request.sheet)!);
      window.revision = request.revision;
      const parsed = parseGridJournal(journal);
      const written = [
        ...parsed.entries.map((entry) => [entry.sheet, entry.row, entry.column, entry.after] as const),
        ...[...commandInputs(parsed)].map(([key, input]) => [...key.split("\u0000"), input] as [string, string, string, string]),
      ];
      for (const [sheet, row, column, input] of written.filter((candidate) => candidate[0] === request.sheet)) {
        const cell = window.cells.find((candidate) => candidate.key.row === row && candidate.key.column === column);
        const value = input === "" ? { kind: "blank" as const } : { kind: "text" as const, value: input };
        if (cell) Object.assign(cell, { input, display: input, value });
        else window.cells.push({ ...structuredClone(window.cells[0]!), key: { sheet, row, column }, input, display: input, value, style: 0 });
      }
      options.window?.(window);
      return window;
    },
    applyGridBytes: async (_surface, _instance, request) => {
      calls.push("apply");
      applied.push(structuredClone(request));
      if (hold) await new Promise<void>((resolve) => answers.push(resolve));
      if (failApply) throw failApply;
      if (request.revision !== revisionOf(journal)) throw { kind: "conflict", message: "stale grid revision" } satisfies PluginError;
      let next = parseGridJournal(journal);
      // Come il provider: una formula nuova, o un giornale già a comandi,
      // porta ogni cella dentro come `range.setValues`.
      const commanding = next.commands.length > 0 || request.patches.some((patch) =>
        patch.after.startsWith("=") && patch.after !== diskOf(patch.cell.sheet, patch.cell.row, patch.cell.column));
      if (commanding) {
        const input = (sheet: string, row: string, column: string, value: string): GridCommand => {
          const at = cellA1({ row: Number(row.slice(1)), column: Number(column.slice(1)) });
          return { id: "range.setValues", params: JSON.stringify({ range: at, values: [[value === "" ? null : value]] }), sheet, selection: at, active: at };
        };
        let commands = next.commands.length ? [...next.commands] : next.entries.map((entry) => input(entry.sheet, entry.row, entry.column, entry.after));
        for (const patch of request.patches) commands = [...commands, input(patch.cell.sheet, patch.cell.row, patch.cell.column, patch.after)];
        next = { entries: [], commands };
        undone.length = 0;
      } else {
        for (const patch of request.patches) {
          next = recordGridJournal(next, patch.cell, diskOf(patch.cell.sheet, patch.cell.row, patch.cell.column), patch.after);
        }
      }
      const deleted = journal;
      journal = gridJournalText(next);
      const commit: GridCommit = {
        revision: revisionOf(journal),
        edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted: journal },
        invalidation: commanding ? { kind: "all" } : { kind: "cells", cells: request.patches.map((patch) => patch.cell) },
      };
      return commit;
    },
    gridBytesCommands: async () => {
      calls.push("commands");
      return catalog();
    },
    gridBytesCommand: async (_surface, _instance, request) => {
      calls.push(`command ${request.command.id}`);
      given.push(structuredClone(request));
      if (hold) await new Promise<void>((resolve) => answers.push(resolve));
      if (request.revision !== revisionOf(journal)) throw { kind: "conflict", message: "stale grid revision" } satisfies PluginError;
      if (!catalog().some((command) => command.id === request.command.id)) {
        throw { kind: "bad_args", message: `grid command \`${request.command.id}\` is not served` } satisfies PluginError;
      }
      const current = parseGridJournal(journal);
      let commands = [...current.commands];
      if (request.command.id === "edit.undo") {
        const last = commands.pop();
        if (!last) throw { kind: "bad_args", message: "nothing to undo" } satisfies PluginError;
        undone.push(last);
      } else if (request.command.id === "edit.redo") {
        const again = undone.pop();
        if (!again) throw { kind: "bad_args", message: "nothing to redo" } satisfies PluginError;
        commands.push(again);
      } else {
        commands = [
          ...current.entries.map((entry) => {
            const at = cellA1({ row: Number(entry.row.slice(1)), column: Number(entry.column.slice(1)) });
            return { id: "range.setValues", params: JSON.stringify({ range: at, values: [[entry.after]] }), sheet: entry.sheet, selection: at, active: at };
          }),
          ...commands,
          request.command,
        ];
        undone.length = 0;
      }
      const deleted = journal;
      journal = gridJournalText({ entries: [], commands });
      const outcome: GridCommandOutcome = {
        commit: {
          revision: revisionOf(journal),
          edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted: journal },
          invalidation: { kind: "all" },
        },
        sheets: structuredClone(xlsx.session.sheets),
        hidden: structuredClone(xlsx.session.hidden),
        selection: { sheet: request.command.sheet, selection: request.command.selection, active: request.command.active },
        result: null,
        dialog: options.dialog?.(request.command) ?? null,
        commands: catalog(),
        book: structuredClone(xlsx.session.book) as GridBytesSession["book"],
      };
      return outcome;
    },
    closeGridBytes: async (_surface, instance) => {
      calls.push("close");
      closed.push(instance);
    },
  };
  return {
    host,
    calls,
    opened,
    closed,
    applied,
    given,
    journal: () => journal,
    hold: (value: boolean) => { hold = value; },
    release: () => { for (const answer of answers.splice(0)) answer(); },
    failApply: (error: PluginError | null) => { failApply = error; },
  };
}

export async function workbookMounted(
  grid: ReturnType<typeof workbookHost> | null = workbookHost(),
  journal = "",
  base?: () => string,
  extra: Pick<GridEngineOptions, "onCommands" | "onDialog"> = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: GridChange[] = [];
  let selections = 0;
  const engine = new GridEngine(host, {
    ...extra,
    surfaceId: "xlsx",
    formatId: "xlsx",
    revision: xlsx.document_revision,
    documentId: "conti.xlsx",
    base,
    onChange: (change) => changes.push(change),
    onSelectionChange: () => { selections += 1; },
    grid: grid?.host,
  });
  const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 400 },
  });
  engine.setDoc(journal);
  await settle();
  const cell = (row: number, column: number) =>
    host.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);
  const notice = () => host.querySelector<HTMLElement>(".grid-notice")!;
  const formula = () => findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-formula-editor")!).state.doc.toString();
  const go = (row: number, column: number) => {
    cell(row, column)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  };
  return { engine, host, viewport, changes, cell, notice, formula, go, selections: () => selections };
}
