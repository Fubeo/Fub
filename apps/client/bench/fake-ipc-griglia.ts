// La porta del banco (`fake-ipc.ts`): il foglio di calcolo (cartelle, Base,
// tabelle, la cartella grande, le misure e le risposte tirate, i risultati).

import XLSX_GRID from "../src/__fixtures__/xlsx-grid.json";
import type { GridBytesWindow, GridCommand, GridCommandOutcome, GridCommandRequest } from "../src/host/contract";
import { gridJournalText } from "../src/state/grid-journal";
import { params } from "./fake-ipc-casi";

/// La cartella di Excel della scena `grid-workbook` (`?workbook=1`). È un
/// file che soltanto quella scena ha: l'albero e i conteggi delle altre
/// restano quelli delle loro baseline. Sessione e finestre sono quelle che
/// `fub-format-xlsx` produce davvero (`tests/ts_grid.rs`).
///
/// `?workbook=large` apre invece una cartella grande, fatta qui in codice
/// con la forma di `xlsx-grid.json`: la scena `grid-large` dei controlli G1.
export const WORKBOOK = params.get("workbook");
export const WORKBOOK_DOC = WORKBOOK === "1" ? "Dati/Conti.xlsx" : WORKBOOK === "large" ? "Dati/Grande.xlsx" : null;

/// Le lavagne delle scene `lavagna-*` del banco dell'accessibilità (T61,
/// `?lavagna=1`): una vuota e una con un gruppo, tre schede di testo, una nota
/// e i fili, etichettati e no. Solo quelle scene le hanno: l'albero e i
/// conteggi delle altre restano quelli delle loro baseline.
export const BOARDS: Readonly<Record<string, string>> = params.get("lavagna") === "1"
  ? {
      "Lavagne/Vuota.canvas": JSON.stringify({ nodes: [], edges: [] }, null, "\t"),
      "Lavagne/Statistica.canvas": JSON.stringify({
        nodes: [
          { id: "gruppo", type: "group", x: 0, y: 0, width: 600, height: 320, label: "Media e varianza" },
          { id: "varianza", type: "text", x: 32, y: 48, width: 240, height: 120, text: "# Varianza\nQuanto i dati si allontanano dalla media." },
          { id: "media", type: "file", x: 320, y: 48, width: 240, height: 160, file: "Benvenuto.md" },
          { id: "istogramma", type: "text", x: 680, y: 48, width: 240, height: 120, text: "Istogramma", color: "4" },
          { id: "dubbio", type: "text", x: 680, y: 240, width: 240, height: 80, text: "Perché il quadrato?" },
        ],
        edges: [
          { id: "f1", fromNode: "varianza", toNode: "media", label: "vedi" },
          { id: "f2", fromNode: "istogramma", toNode: "varianza", label: "si vede qui" },
          { id: "f3", fromNode: "dubbio", toNode: "varianza" },
        ],
      }, null, "\t"),
    }
  : {};

/// Gli stati della barra dei fogli che la cartella generata non ha
/// (`?grid=table|readonly`, insieme a `?workbook=1`): una copia delle sue
/// finestre con una tabella dal nome lunghissimo sulla cella scelta, che
/// accende la sezione della tabella, oppure una copia della sessione coi
/// comandi che cambiano la cartella spenti, con il perché. Il JSON resta
/// quello che `fub-format-xlsx` produce.
export const GRID_CASE = params.get("grid");
const BENCH_TABLE = {
  name: "Riepilogo_trimestrale_delle_spese_di_rappresentanza_2026",
  row: 0,
  column: 0,
  rows: 6,
  columns: 4,
  header_row: true,
  totals_row: false,
  banded_rows: true,
  banded_columns: false,
  first_column: false,
  last_column: false,
  filter_button: true,
  style: "TableStyleMedium2",
};
/// In sola lettura restano accesi soltanto i comandi che guardano.
const LOOKING = /^(file|selection|view)\.|^edit\.(selectAll|goTo|goToSpecial|find)$/;
export function benchWindow<W extends { readonly sheet: string; readonly tables: readonly unknown[] }>(window: W): W {
  return GRID_CASE === "table" && window.sheet === XLSX_GRID.session.active
    ? { ...window, tables: [...window.tables, BENCH_TABLE] }
    : window;
}
export const BENCH_SESSION = GRID_CASE === "readonly"
  ? {
    ...XLSX_GRID.session,
    commands: XLSX_GRID.session.commands.map((command) =>
      LOOKING.test(command.id) ? command : { ...command, enabled: false, reason: "La cartella è aperta in sola lettura." }),
  }
  : XLSX_GRID.session;

/// La cartella grande della scena `grid-large` (`?workbook=large`): 3000
/// righe per 20 colonne, la riga 1 e la colonna A bloccate, numeri, date e
/// testi lunghi che debordano nelle celle vuote dopo di loro. Le finestre
/// sono blocchi di 256 righe con tutte le colonne, come le chiede il motore.
const LARGE_ROWS = 3000;
const LARGE_COLUMNS = 20;
const LARGE_BLOCK = 256;
const LARGE_STYLE = { ...XLSX_GRID.windows[0]!.styles[0]!, bold: false, italic: false, text_color: null, horizontal: null };
export const LARGE_SESSION = {
  ...XLSX_GRID.session,
  instance: "xlsx-large",
  revision: "sha256:grande",
  sheets: [{ id: "s1", name: "Grande", row_count: LARGE_ROWS, column_count: LARGE_COLUMNS }],
  active: "s1",
  hidden: [],
  notices: [],
  conflicts: [],
};
const LARGE_MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
type LargeValue = { value: { kind: "text"; value: string } | { kind: "number"; value: number }; display: string };
/// Il valore della cella (riga, colonna) da zero, o `null` se è vuota. La
/// colonna D porta un testo lungo, e la E e la F restano vuote per lasciarlo
/// debordare.
function largeValue(row: number, column: number): LargeValue | null {
  const text = (value: string): LargeValue => ({ value: { kind: "text", value }, display: value });
  const number = (value: number, display = String(value)): LargeValue => ({ value: { kind: "number", value }, display });
  if (row === 0) {
    const heads = ["Voce", "Importo", "Data", "Descrizione", "", "", "Quantità"];
    if (column >= heads.length) return text(`Colonna ${column + 1}`);
    return heads[column] ? text(heads[column]!) : null;
  }
  switch (column) {
    case 0: return text(`Voce ${row}`);
    case 1: {
      const amount = Math.round(((row * 37) % 1000) * 150) / 100;
      return number(amount, amount.toFixed(2));
    }
    case 2: return number(45658 + row, `${1 + (row % 28)} ${LARGE_MONTHS[row % 12]} 2026`);
    case 3: return text(`Una descrizione lunga della voce ${row}, che deborda nelle celle vuote a destra`);
    case 4: case 5: return null;
    default: return number((row * (column + 3)) % 997);
  }
}
/// La cella della finestra in (riga, colonna) da zero con il valore `cell`.
function largeCell(row: number, column: number, cell: LargeValue) {
  return {
    key: { sheet: "s1", row: `r${row}`, column: `c${column}` },
    input: cell.display,
    style: 0,
    ...cell,
    lock: null,
    stale: false,
    conflict: false,
    data_bar: null,
    icon: null,
    comment: null,
    link: null,
  };
}
function largeWindow(start: number) {
  const count = Math.min(LARGE_BLOCK, LARGE_ROWS - start);
  const rows = Array.from({ length: count }, (_, at) => ({ id: `r${start + at}`, index: start + at, height: 20.0, hidden: false }));
  const columns = Array.from({ length: LARGE_COLUMNS }, (_, index) =>
    ({ id: `c${index}`, index, width: index === 0 ? 140.0 : index === 2 || index === 3 ? 96.0 : 64.0, hidden: false }));
  const cells = [];
  for (const row of rows) {
    for (const column of columns) {
      const cell = largeValue(row.index, column.index);
      if (cell) cells.push(largeCell(row.index, column.index, cell));
    }
  }
  return {
    revision: LARGE_SESSION.revision,
    sheet: "s1",
    row_start: start,
    column_start: 0,
    total_rows: LARGE_ROWS,
    total_columns: LARGE_COLUMNS,
    rows,
    columns,
    cells,
    styles: [LARGE_STYLE],
    merges: [],
    view: { ...XLSX_GRID.windows[0]!.view, frozen_rows: 1, frozen_columns: 1 },
    tables: [],
    objects: [],
  };
}
/// `?misure=si`, con `?workbook=large`: il finto dice sì alle misure tirate
/// (`home.columnWidth`, `home.rowHeight`) invece di rifiutarle perché non le
/// serve, come l'host vero: la revisione cambia, il giornale prende il
/// comando e le finestre rilette hanno la misura nuova. La scena
/// `grid-large-misure` dei controlli G5 (griglia T5). Il giornale qui è
/// soltanto quello delle misure: la scena non scrive celle. Una porta resa
/// guasta o frenata dal banco (`fault`, `throttle`) vale anche qui, perché la
/// risposta passa prima dal finto.
export const SIZES_ANSWER = WORKBOOK === "large" && params.get("misure") === "si";
export const SIZE_COMMANDS: ReadonlySet<string> = new Set(["home.columnWidth", "home.rowHeight"]);
/// `?risposte=si`, con `?workbook=large`: il finto dice sì anche ai
/// riempimenti e a `fub.pasteFrom`, e le finestre rilette hanno i valori
/// nuovi. Nella cartella di partenza C4 vale 10, C5 20 e sotto, fino a C16,
/// è vuota, come nel prototipo: tirato fino a C12, il riempimento dà 30…90.
/// La scena `grid-large-appunti` dei controlli G6 (griglia T6). Una porta
/// frenata o guasta dal banco vale anche qui.
export const CELLS_ANSWER = WORKBOOK === "large" && params.get("risposte") === "si";
export const CELL_COMMANDS: ReadonlySet<string> = new Set([
  "edit.autoFill",
  "edit.fillDown",
  "edit.fillRight",
  "edit.fillUp",
  "edit.fillLeft",
  "edit.fillSeries",
  "fub.pasteFrom",
]);
/// Una revisione data dal finto: le misure, colonna (o riga) → misura nei
/// pixel della cartella, e le celle cambiate, `riga:colonna` → valore (o
/// `null`, vuota).
interface Answered {
  readonly columns: ReadonlyMap<number, number>;
  readonly rows: ReadonlyMap<number, number>;
  readonly cells: ReadonlyMap<string, LargeValue | null>;
}
const sizedRevisions = new Map<string, Answered>();
/// Le celle della cartella di partenza, con `?risposte=si`.
const ANSWER_BASE: ReadonlyMap<string, LargeValue | null> = CELLS_ANSWER
  ? new Map(Array.from({ length: 13 }, (_, at): [string, LargeValue | null] => {
    const row = 3 + at;
    const value = row === 3 ? 10 : row === 4 ? 20 : null;
    return [`${row}:2`, value === null ? null : { value: { kind: "number", value }, display: String(value) }];
  }))
  : new Map();
/// I comandi del giornale che la shell tiene dall'ultima apertura: il diff
/// della risposta parte da quelli.
export let sizedCommands: GridCommand[] = [];
/// L'ultima revisione data dal finto, e quella che il salvataggio ha messo
/// nel file: riaperto senza giornale, il file ha quelle misure.
export let lastSized: string | null = null;
export let savedSized: string | null = null;
/// Il salvataggio ha scritto nel file le misure dell'ultima risposta
/// (`writeDocument` del finto, in `fake-ipc.ts`).
export function rememberSavedSized(): void {
  if (lastSized !== null) savedSized = lastSized;
}
/// La cartella riaperta senza giornale riparte senza comandi
/// (`openGridBytes` del finto, in `fake-ipc.ts`).
export function reopenSized(): void {
  sizedCommands = [];
}

/// L'indice da zero di una colonna in A1 («C» → 2).
function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/// Un intervallo A1 («C4:C12», «B2») in righe e colonne da zero.
function rangeOf(a1: string): { r0: number; c0: number; r1: number; c1: number } {
  const corner = (cell: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(cell)!;
    return { row: Number(match[2]) - 1, column: columnIndex(match[1]!) };
  };
  const [first, last = first] = a1.split(":");
  const a = corner(first!);
  const b = corner(last!);
  return { r0: Math.min(a.row, b.row), c0: Math.min(a.column, b.column), r1: Math.max(a.row, b.row), c1: Math.max(a.column, b.column) };
}
/// L'A1 di (riga, colonna) da zero.
function cellName(row: number, column: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${row + 1}`;
}
/// Il valore di (riga, colonna) nelle celle `cells` della revisione.
function answeredValue(cells: ReadonlyMap<string, LargeValue | null>, row: number, column: number): LargeValue | null {
  const key = `${row}:${column}`;
  return cells.has(key) ? cells.get(key)! : ANSWER_BASE.has(key) ? ANSWER_BASE.get(key)! : largeValue(row, column);
}

/// Un riempimento o un incolla sulle celle `cells`: scrive le celle nuove e
/// rende la selezione che lascia, come GridCraft (il riempimento selezionato,
/// la cella attiva al primo angolo della sorgente; l'incolla selezionato).
function answerCells(cells: Map<string, LargeValue | null>, command: GridCommand): { selection: string; active: string } {
  const read = (row: number, column: number) => answeredValue(cells, row, column);
  const selected = rangeOf(command.selection.split(",")[0]!);
  if (command.id === "fub.pasteFrom") {
    const asked = JSON.parse(command.params) as { source: string; move?: boolean };
    const from = rangeOf(asked.source);
    const block = Array.from({ length: from.r1 - from.r0 + 1 }, (_, r) =>
      Array.from({ length: from.c1 - from.c0 + 1 }, (_, c) => read(from.r0 + r, from.c0 + c)));
    if (asked.move) {
      for (let row = from.r0; row <= from.r1; row += 1) for (let column = from.c0; column <= from.c1; column += 1) cells.set(`${row}:${column}`, null);
    }
    block.forEach((line, r) => line.forEach((value, c) => cells.set(`${selected.r0 + r}:${selected.c0 + c}`, value)));
    const end = cellName(selected.r0 + block.length - 1, selected.c0 + block[0]!.length - 1);
    const start = cellName(selected.r0, selected.c0);
    return { selection: start === end ? start : `${start}:${end}`, active: start };
  }
  let source = selected;
  let target = selected;
  if (command.id === "edit.autoFill") {
    const asked = JSON.parse(command.params) as { source: string; target: string };
    source = rangeOf(asked.source);
    target = rangeOf(asked.target);
  } else if (command.id === "edit.fillDown" || command.id === "edit.fillSeries") {
    source = { ...selected, r1: selected.r0 };
  } else if (command.id === "edit.fillUp") {
    source = { ...selected, r0: selected.r1 };
  } else if (command.id === "edit.fillRight") {
    source = { ...selected, c1: selected.c0 };
  } else {
    source = { ...selected, c0: selected.c1 };
  }
  const down = target.c0 === source.c0 && target.c1 === source.c1;
  // Una serie lungo ogni colonna (o riga) della sorgente: con due numeri o
  // più, il passo fra gli ultimi due; altrimenti la sorgente si ripete.
  const lines = down ? source.c1 - source.c0 + 1 : source.r1 - source.r0 + 1;
  for (let line = 0; line < lines; line += 1) {
    const at = (index: number) => (down ? read(source.r0 + index, source.c0 + line) : read(source.r0 + line, source.c0 + index));
    const length = down ? source.r1 - source.r0 + 1 : source.c1 - source.c0 + 1;
    const seed = Array.from({ length }, (_, index) => at(index));
    const numbers = seed.every((value) => value?.value.kind === "number") ? seed.map((value) => value!.value.value as number) : null;
    const step = numbers && numbers.length > 1 ? numbers[numbers.length - 1]! - numbers[numbers.length - 2]! : numbers ? 0 : null;
    const first = down ? target.r0 : target.c0;
    const last = down ? target.r1 : target.c1;
    const origin = down ? source.r0 : source.c0;
    for (let index = first; index <= last; index += 1) {
      const offset = index - origin;
      if (offset >= 0 && offset < length) continue;
      let value: LargeValue | null;
      if (numbers && step !== null) {
        const number = numbers[numbers.length - 1]! + step * (offset - length + 1);
        value = { value: { kind: "number", value: number }, display: String(number) };
      } else {
        value = seed[((offset % length) + length) % length] ?? null;
      }
      cells.set(down ? `${index}:${source.c0 + line}` : `${source.r0 + line}:${index}`, value);
    }
  }
  const whole = { r0: Math.min(source.r0, target.r0), c0: Math.min(source.c0, target.c0), r1: Math.max(source.r1, target.r1), c1: Math.max(source.c1, target.c1) };
  return { selection: `${cellName(whole.r0, whole.c0)}:${cellName(whole.r1, whole.c1)}`, active: cellName(source.r0, source.c0) };
}

/// La risposta del provider a una misura tirata, o (con `?risposte=si`) a
/// un riempimento o a un incolla, su `revision`.
export function sizedOutcome(revision: string, request: GridCommandRequest): GridCommandOutcome {
  const { id, params: text } = request.command;
  const known = sizedRevisions.get(revision);
  const columns = new Map(known?.columns);
  const rows = new Map(known?.rows);
  const cells = new Map(known?.cells);
  let selection = { sheet: request.command.sheet, selection: request.command.selection, active: request.command.active };
  if (CELL_COMMANDS.has(id)) {
    selection = { sheet: request.command.sheet, ...answerCells(cells, request.command) };
  } else if (id === "home.columnWidth") {
    const params = JSON.parse(text) as { cols: string; width: number };
    const [a, b] = params.cols.split(":").map(columnIndex);
    for (let index = a!; index <= b!; index += 1) columns.set(index, params.width);
  } else {
    const params = JSON.parse(text) as { rows: string; height: number };
    const [a, b] = params.rows.split(":").map((row) => Number(row) - 1);
    for (let index = a!; index <= b!; index += 1) rows.set(index, params.height);
  }
  const deleted = sizedCommands.length ? gridJournalText({ entries: [], commands: sizedCommands }) : "";
  sizedCommands = [...sizedCommands, request.command];
  const inserted = gridJournalText({ entries: [], commands: sizedCommands });
  const next = `sha256:grande-misure-${sizedRevisions.size + 1}`;
  sizedRevisions.set(next, { columns, rows, cells });
  lastSized = next;
  return {
    commit: { revision: next, edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted }, invalidation: { kind: "all" } },
    sheets: LARGE_SESSION.sheets,
    hidden: [],
    selection,
    result: null,
    dialog: null,
    commands: LARGE_SESSION.commands,
    book: LARGE_SESSION.book,
  } as GridCommandOutcome;
}

/// La finestra della revisione `revision` con le misure e le celle che il
/// finto ha dato.
export function sizedWindow(window: GridBytesWindow, revision: string): GridBytesWindow {
  const sized = sizedRevisions.get(revision);
  const changed = new Map([...ANSWER_BASE, ...(sized?.cells ?? [])]);
  if (changed.size) {
    const first = window.row_start;
    const last = first + window.rows.length - 1;
    const inside = (key: string) => {
      const row = Number(key.split(":")[0]);
      return row >= first && row <= last;
    };
    const keyOf = (cell: GridBytesWindow["cells"][number]) => `${cell.key.row.slice(1)}:${cell.key.column.slice(1)}`;
    const added = [...changed].filter(([key, value]) => value !== null && inside(key)).map(([key, value]) => {
      const [row, column] = key.split(":").map(Number);
      return largeCell(row!, column!, value!) as GridBytesWindow["cells"][number];
    });
    window = { ...window, cells: [...window.cells.filter((cell) => !changed.has(keyOf(cell))), ...added] };
  }
  if (!sized) return window;
  return {
    ...window,
    columns: window.columns.map((column) => (sized.columns.has(column.index) ? { ...column, width: sized.columns.get(column.index)! } : column)),
    rows: window.rows.map((row) => (sized.rows.has(row.index) ? { ...row, height: sized.rows.get(row.index)! } : row)),
  };
}

/// Le finestre si fanno solo se la scena le chiede.
export const LARGE_WINDOWS = WORKBOOK === "large"
  ? Array.from({ length: Math.ceil(LARGE_ROWS / LARGE_BLOCK) }, (_, block) => largeWindow(block * LARGE_BLOCK))
  : [];

/// Il risultato dei comandi che leggono (`?result=stats|errors|empty`,
/// insieme a `?workbook=1`): la risposta del provider alla prima esecuzione,
/// senza modifiche alla cartella. Le statistiche di una selezione, cinquecento
/// errori su un foglio dal nome lungo, nessun errore. Senza `result` il
/// comando non è servito, e la finestra del risultato dice il perché.
export const RESULT_CASE = params.get("result");
const RESULT_SHEET = "Movimenti del conto corrente cointestato 2026";
const BENCH_RESULTS: Readonly<Record<string, unknown>> = {
  stats: { count: 24, numeric: 24, sum: 16437.9, average: 684.9125, min: 88.6, max: 1403.15 },
  errors: {
    errors: Array.from({ length: 500 }, (_, i) => ({
      sheet: RESULT_SHEET,
      cell: `F${i + 2}`,
      error: i % 7 === 3 ? "#VALUE!" : "#DIV/0!",
      formula: `=D${i + 2}/E${i + 2}`,
    })),
    circular: [],
  },
  empty: { errors: [], circular: [] },
};
export const BENCH_OUTCOMES = RESULT_CASE !== null && RESULT_CASE in BENCH_RESULTS
  ? [{
    commit: {
      revision: BENCH_SESSION.revision,
      edit: { from: 0, to: 0, deleted: "", inserted: "" },
      invalidation: { kind: "cells", cells: [] },
    },
    sheets: BENCH_SESSION.sheets,
    hidden: BENCH_SESSION.hidden,
    selection: { sheet: BENCH_SESSION.active, selection: "B2:E7", active: "B2" },
    result: JSON.stringify(BENCH_RESULTS[RESULT_CASE]),
    dialog: null,
    commands: BENCH_SESSION.commands,
    book: BENCH_SESSION.book,
  }]
  : undefined;
