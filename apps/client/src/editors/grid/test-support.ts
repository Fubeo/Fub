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
  /** I comandi del catalogo che la sessione dice serviti, tutti attivi. */
  readonly commands?: readonly string[];
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
        commands: (plan.commands ?? []).map((id) => ({ id, enabled: true, reason: null })),
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

/** Lascia passare `count` fotogrammi: il margine che uno scorrimento lascia indietro lo finiscono loro. */
export async function frames(count = 12): Promise<void> {
  for (let index = 0; index < count; index += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
}

/// Ciò che la griglia scrive nel documento mentre scorre (`scrollWrites`).
export interface ScrollWrites {
  /// Le scritture sui nodi che c'erano prima e restano, una per scrittura:
  /// `attributo .classe` (o `testo`, o `figli` per i figli rifatti).
  readonly kept: string[];
  /// Le righe aggiunte e tolte, per indice.
  readonly added: number[];
  readonly removed: number[];
}

/// Scorre il riquadro in giù di `steps` passi da `px`, un passo per
/// fotogramma come una rotella, e conta ciò che la griglia scrive in `host`.
/// Un nodo che resta non riceve niente: la carta scorre con il foglio, le
/// righe che restano non cambiano, e un attributo riscritto uguale è
/// comunque un mutamento. Le righe si aggiungono e si tolgono ai bordi.
export async function scrollWrites(host: HTMLElement, viewport: HTMLElement, steps: number, px: number): Promise<ScrollWrites> {
  const before = new Set<Node>(host.querySelectorAll("*"));
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(host, { subtree: true, attributes: true, attributeOldValue: true, characterData: true, childList: true });
  for (let step = 0; step < steps; step += 1) {
    viewport.scrollTop += px;
    viewport.dispatchEvent(new Event("scroll"));
    await frames(1);
  }
  await settle();
  await frames();
  records.push(...observer.takeRecords());
  observer.disconnect();
  const owner = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement);
  const rowsOf = (nodes: NodeList) => [...nodes]
    .filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains("grid-row"))
    .map((row) => Number(row.dataset.row));
  const name = (element: Element) => `.${String(element.className).split(" ")[0]}`;
  // Il valore che ogni scrittura ha lasciato: il vecchio della scrittura
  // dopo sullo stesso attributo, o quello di adesso.
  const after = new Map<MutationRecord, string | null>();
  const next = new Map<Node, Map<string, string | null>>();
  for (const record of [...records].reverse()) {
    if (record.type !== "attributes" || !record.attributeName) continue;
    const values = next.get(record.target) ?? new Map<string, string | null>();
    next.set(record.target, values);
    const attribute = record.attributeName;
    after.set(record, values.has(attribute) ? values.get(attribute)! : (record.target as Element).getAttribute(attribute));
    values.set(attribute, record.oldValue);
  }
  const kept: string[] = [];
  const added: number[] = [];
  const removed: number[] = [];
  for (const record of records) {
    const target = owner(record.target);
    if (record.type === "childList") {
      added.push(...rowsOf(record.addedNodes));
      removed.push(...rowsOf(record.removedNodes));
      // I gruppi di righe cambiano figli ai bordi; un altro nodo che resta no.
      const group = target?.classList.contains("grid-rows") || target?.classList.contains("grid-head");
      if (target && !group && before.has(target) && target.isConnected) kept.push(`figli ${name(target)}`);
      continue;
    }
    if (!target || !before.has(target) || !target.isConnected) continue;
    // Uno stile o una classe riscritti uguali (CSSOM, `classList.toggle`):
    // happy-dom li registra, Chromium e WebKit no. Un altro attributo
    // riscritto uguale lo registrano tutti.
    const attribute = record.attributeName;
    if ((attribute === "style" || attribute === "class") && record.oldValue === after.get(record)) continue;
    kept.push(`${attribute ?? "testo"} ${name(target)}`);
  }
  return { kept, added, removed };
}

/// I pezzi dei segni (`grid-motion.ts`) di un tipo che si vedono: quelli che
/// non servono restano nascosti nel loro serbatoio.
export const shownMarks = (host: HTMLElement, kind: string) =>
  [...host.querySelectorAll<HTMLElement>(`.grid-mark-${kind}`)].filter((mark) => !mark.hidden);

/// Quanti rettangoli scelti si vedono: uno per prefisso dei lati (`rect`,
/// `other-0`, …), in qualunque livello cadano.
export const shownRanges = (host: HTMLElement) =>
  new Set(shownMarks(host, "edge").map((mark) => mark.dataset.mark!.replace(/-(top|bottom|left|right)$/, ""))).size;

export const cellAt = (host: HTMLElement, row: number, column: number) =>
  host.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);

/// Il valore che un comando d'input scrive, come input della cella.
function inputOfValue(value: unknown): string {
  return value === null ? "" : typeof value === "string" ? value : String(value);
}

/// Le celle che i comandi `range.setValues` del giornale scrivono, per foglio.
/// Il comando con cui il provider porta la cartella a uno stato tenuto in
/// memoria, in testa al giornale (`fub.restore`).
const RESTORE = "fub.restore";

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
  /// L'intervallo che `selection.currentRegion` rende.
  readonly region?: string;
} = {}) {
  const calls: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const applied: GridApplyRequest[] = [];
  const answers: Array<() => void> = [];
  let hold = false;
  let failApply: PluginError | null = null;
  /// L'errore con cui il finto rifiuta il prossimo comando che cambia la
  /// cartella, se c'è.
  let failCommand: PluginError | null = null;
  let journal = "";
  let instances = 0;
  /// Le celle che `save` ha messo nei byte, sopra quelle della fixture.
  const saved = new Map<string, string>();
  /// I comandi della barra che i byte salvati portano, `id@selezione`: il
  /// formato, l'ordine, le righe che il finto non disegna.
  let savedStyles: string[] = [];
  let savedRevision = xlsx.document_revision;
  const base = options.base ?? (() => savedRevision);
  const given: GridCommandRequest[] = [];
  /// La cronologia del documento, come la tiene il provider: i punti con il
  /// giornale che li dà sui byte `base`, e le celle che mostrano. Un punto
  /// salvato da un'altra base si raggiunge con `fub.restore`.
  type State = { cells: Map<string, string>; styles: string[] };
  type Point = { journal: string; base: string } & State;
  let points: Point[] = [];
  let cursor = 0;
  /// Come il provider, la cronologia di ogni giornale si copia quando cambia:
  /// il salvataggio ritrova quella del giornale che scrive, anche se una
  /// sessione vecchia, nel frattempo, è andata avanti per conto suo.
  const lines = new Map<string, { points: Point[]; cursor: number }>();
  let savedLine: { points: Point[]; cursor: number } | null = null;
  const publish = (text: string) => lines.set(text, { points: points.map((point) => ({ ...point })), cursor });
  const states = new Map<string, State>();
  const restoredOf = (parsed: GridJournal): State | undefined => parsed.commands[0]?.id === RESTORE
    ? states.get((JSON.parse(parsed.commands[0].params) as { state: string }).state)
    : undefined;
  /// I comandi della barra che il giornale `text` porta sopra i byte.
  const styled = (text: string): string[] => {
    const parsed = parseGridJournal(text);
    return [
      ...(restoredOf(parsed)?.styles ?? savedStyles),
      ...parsed.commands.filter((command) => command.id !== RESTORE && command.id !== "range.setValues")
        .map((command) => `${command.id}@${command.selection}`),
    ];
  };
  const stateOf = (text: string): State => ({ cells: visible(text), styles: styled(text) });
  const catalog = (): GridCommandState[] => (structuredClone(xlsx.session.commands) as GridCommandState[])
    .filter((command) => options.serves !== false || command.id !== "range.setValues")
    .filter((command) => !options.drop?.includes(command.id))
    .map((command) => {
      const enabled = command.id === "edit.undo" ? cursor > 0 : command.id === "edit.redo" ? cursor + 1 < points.length : null;
      return enabled === null ? command : { ...command, enabled, reason: enabled ? null : command.reason };
    });
  /// Le celle che il giornale `text` mostra: quelle salvate (o dello stato
  /// che `fub.restore` chiama) con quelle che il giornale scrive.
  const visible = (text: string): Map<string, string> => {
    const parsed = parseGridJournal(text);
    const out = new Map(restoredOf(parsed)?.cells ?? saved);
    for (const entry of parsed.entries) out.set(`${entry.sheet}\u0000${entry.row}\u0000${entry.column}`, entry.after);
    for (const [key, input] of commandInputs(parsed)) out.set(key, input);
    return out;
  };
  /// Un passo nuovo: il futuro da ripetere esce.
  const record = (text: string) => {
    points.splice(cursor + 1);
    points.push({ journal: text, base: savedRevision, ...stateOf(text) });
    cursor = points.length - 1;
    publish(text);
  };
  const sessionFor = (text: string): GridBytesSession => {
    if (text === xlsx.conflict.journal) return structuredClone(xlsx.conflict.session) as GridBytesSession;
    const session = structuredClone(xlsx.session) as GridBytesSession;
    return { ...session, revision: plainRevision(text), commands: catalog() };
  };
  const diskOf = (sheet: string, row: string, column: string) => saved.get(`${sheet}\u0000${row}\u0000${column}`)
    ?? (xlsx.windows as GridBytesWindow[])
      .find((window) => window.sheet === sheet)?.cells
      .find((cell) => cell.key.row === row && cell.key.column === column)?.input ?? "";
  // Dopo un `save` la revisione dice anche i byte salvati.
  function plainRevision(text: string): string {
    if (!saved.size) return text === "" ? xlsx.session.revision : `rev:${text}`;
    return text === "" ? `${xlsx.session.revision}:${savedRevision}` : `rev:${savedRevision}:${text}`;
  }
  const revisionOf = (text: string) => text === xlsx.edit.commit.edit.inserted && saved.size === 0
    ? xlsx.edit.commit.revision
    : plainRevision(text);
  const host: GridHost = {
    listGridSurfaces: async () => {
      calls.push("list");
      return [xlsx.surface];
    },
    openGridBytes: async (surface, doc, text, revision) => {
      calls.push(`open ${surface} ${doc} ${text === "" ? "∅" : "journal"} ${revision === xlsx.document_revision ? "base" : revision}`);
      if (revision !== base()) throw { kind: "conflict", message: "grid source changed" } satisfies PluginError;
      journal = text;
      if (savedLine && text === "") {
        points = savedLine.points;
        cursor = savedLine.cursor;
      }
      savedLine = null;
      // L'istanza nuova ritrova la cronologia: il punto di adesso è il
      // giornale aperto sui byte di adesso.
      const here = { journal: text, base: savedRevision, ...stateOf(text) };
      if (points.length) points[cursor] = here;
      else points.push(here);
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
      const written = [...visible(journal)].map(([key, input]) => [...key.split("\u0000"), input] as [string, string, string, string]);
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
      } else {
        for (const patch of request.patches) {
          next = recordGridJournal(next, patch.cell, diskOf(patch.cell.sheet, patch.cell.row, patch.cell.column), patch.after);
        }
      }
      const deleted = journal;
      journal = gridJournalText(next);
      if (journal !== deleted) record(journal);
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
    gridBytesCommand: async (_surface, instance, request) => {
      calls.push(`command ${request.command.id}`);
      given.push(structuredClone(request));
      if (hold) await new Promise<void>((resolve) => answers.push(resolve));
      if (failCommand) throw failCommand;
      // Come l'host: un'istanza chiusa nel frattempo non c'è più.
      if (closed.includes(instance)) throw { kind: "not_found", message: "grid instance closed" } satisfies PluginError;
      if (request.revision !== revisionOf(journal)) throw { kind: "conflict", message: "stale grid revision" } satisfies PluginError;
      if (!catalog().some((command) => command.id === request.command.id)) {
        throw { kind: "bad_args", message: `grid command \`${request.command.id}\` is not served` } satisfies PluginError;
      }
      // Leggere la zona della cella non cambia la cartella.
      if (request.command.id === "selection.currentRegion") {
        return {
          commit: { revision: revisionOf(journal), edit: { from: 0, to: 0, deleted: "", inserted: "" }, invalidation: { kind: "cells", cells: [] } },
          sheets: structuredClone(xlsx.session.sheets),
          hidden: structuredClone(xlsx.session.hidden),
          selection: { sheet: request.command.sheet, selection: options.region ?? request.command.selection, active: request.command.active },
          result: JSON.stringify({ selection: options.region ?? request.command.selection }),
          dialog: null,
          commands: catalog(),
          book: structuredClone(xlsx.session.book) as GridBytesSession["book"],
        };
      }
      const current = parseGridJournal(journal);
      const deleted = journal;
      const history = request.command.id === "edit.undo" || request.command.id === "edit.redo";
      if (history) {
        const to = request.command.id === "edit.undo" ? cursor - 1 : cursor + 1;
        const target = points[to];
        if (!target) throw { kind: "bad_args", message: request.command.id === "edit.undo" ? "nothing to undo" : "nothing to redo" } satisfies PluginError;
        if (target.base !== savedRevision) {
          // Oltre un salvataggio: lo stato del punto, tenuto in memoria.
          const id = `stato-${states.size + 1}`;
          states.set(id, { cells: target.cells, styles: target.styles });
          target.journal = gridJournalText({ entries: [], commands: [{ id: RESTORE, params: JSON.stringify({ state: id }), sheet: "s1", selection: "A1", active: "A1" }] });
          target.base = savedRevision;
        }
        cursor = to;
        journal = target.journal;
        publish(journal);
      } else {
        const commands = [
          ...current.entries.map((entry) => {
            const at = cellA1({ row: Number(entry.row.slice(1)), column: Number(entry.column.slice(1)) });
            return { id: "range.setValues", params: JSON.stringify({ range: at, values: [[entry.after]] }), sheet: entry.sheet, selection: at, active: at };
          }),
          ...current.commands,
          request.command,
        ];
        journal = gridJournalText({ entries: [], commands });
        record(journal);
      }
      const outcome: GridCommandOutcome = {
        commit: {
          revision: revisionOf(journal),
          edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted: journal },
          invalidation: { kind: "all" },
        },
        sheets: structuredClone(xlsx.session.sheets),
        hidden: structuredClone(xlsx.session.hidden),
        selection: answeredSelection(request.command),
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
    /// Il disco, cella per cella: l'input che i byte salvati danno a `sheet`,
    /// `row`, `column`.
    disk: diskOf,
    /// I comandi della barra che i byte salvati portano, `id@selezione`.
    diskStyles: () => [...savedStyles],
    /// La revisione dei byte su disco.
    base: () => savedRevision,
    /// Salva il giornale `text` nei byte, come la scrittura del documento: le
    /// celle che scrive (voci o `range.setValues`) vanno sul disco, e la
    /// revisione cambia.
    save: (text: string) => {
      const line = lines.get(text);
      savedLine = line ? { points: line.points.map((point) => ({ ...point })), cursor: line.cursor } : null;
      const written = visible(text);
      savedStyles = styled(text);
      saved.clear();
      for (const [key, input] of written) saved.set(key, input);
      savedRevision = `sha256:salvato-${saved.size}-${text.length}-${Math.random().toString(36).slice(2)}`;
      return savedRevision;
    },
    hold: (value: boolean) => { hold = value; },
    release: () => { for (const answer of answers.splice(0)) answer(); },
    failApply: (error: PluginError | null) => { failApply = error; },
    failCommand: (error: PluginError | null) => { failCommand = error; },
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

/// La selezione che il finto provider lascia dopo un comando: quella che
/// aveva, tranne `edit.autoFill`, che come GridCraft seleziona il
/// riempimento con la cella attiva al primo angolo della sorgente.
function answeredSelection(command: GridCommand): GridCommandOutcome["selection"] {
  if (command.id === "edit.autoFill") {
    try {
      const { source, target } = JSON.parse(command.params) as { source?: string; target?: string };
      if (source && target) return { sheet: command.sheet, selection: target, active: source.split(":")[0]! };
    } catch {
      // Parametri che non si leggono: la selezione resta.
    }
  }
  return { sheet: command.sheet, selection: command.selection, active: command.active };
}
