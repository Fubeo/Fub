// Il modello di una tabella GFM per la griglia della Live: leggerla dalla
// sorgente, cambiarla come un foglio di calcolo, riscriverla.
//
// Qui non c'è DOM né CodeMirror: soltanto testo in entrata e modifiche in
// uscita, con offset relativi all'inizio della tabella (code unit UTF-16 del
// documento normalizzato LF, come ogni offset dell'editor).
//
// # Chi riscrive cosa
//
// Cambiare il contenuto di una cella tocca soltanto quella cella: gli spazi
// intorno, il resto della riga e le altre righe restano come l'autore li ha
// scritti. Cambiare la forma — una riga o una colonna in più o in meno, un
// ordinamento, un allineamento — riscrive la tabella intera in forma
// canonica (`| a | b |`), perché lì ogni riga cambia comunque.
//
// Le pipe dentro una cella sono dati: nel testo sono `\|`, nel modello `|`.

import { parseTsv as parseSheetTsv, tsvRows } from "../../../core/tsv";

export type TableAlign = "left" | "center" | "right" | null;

/// Una tabella come la vede la griglia: righe di testo, la prima è
/// l'intestazione, tutte lunghe quanto `aligns`.
export interface TableData {
  readonly rows: readonly (readonly string[])[];
  readonly aligns: readonly TableAlign[];
}

/// Una cella nella sorgente: l'intervallo fra le sue pipe, spazi compresi.
export interface CellSpan {
  readonly from: number;
  readonly to: number;
}

/// Una riga della sorgente.
export interface SourceLine {
  readonly from: number;
  readonly to: number;
  /// Il rientro prima della prima pipe.
  readonly prefix: string;
  readonly cells: readonly CellSpan[];
}

/// La tabella letta, con le coordinate da cui è stata letta.
export interface ParsedTable extends TableData {
  readonly source: string;
  /// Le righe della sorgente: intestazione, delimitatore, corpo.
  readonly lines: readonly SourceLine[];
}

/// Una posizione della griglia: `row` 0 è l'intestazione.
export interface GridPosition {
  readonly row: number;
  readonly col: number;
}

/// Un rettangolo di celle, estremi compresi.
export interface GridRange {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

export interface TableChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

// ── Lettura ──────────────────────────────────────────────────────────────────

/// Le celle di una riga, divise alle pipe che non sono precedute da un numero
/// dispari di backslash. La pipe iniziale e quella finale sono bordi, non
/// separatori di una cella vuota.
function splitLine(text: string, from: number): SourceLine {
  const prefix = /^[ \t]*/.exec(text)![0];
  const pipes: number[] = [];
  for (let i = prefix.length; i < text.length; i++) {
    if (text[i] !== "|") continue;
    let slashes = 0;
    for (let j = i - 1; j >= prefix.length && text[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 0) pipes.push(i);
  }
  const bounds = [prefix.length - 1, ...pipes, text.length];
  const segments: CellSpan[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    segments.push({ from: bounds[i]! + 1, to: bounds[i + 1]! });
  }
  const blank = (span: CellSpan) => text.slice(span.from, span.to).trim() === "";
  if (pipes.length > 0 && segments.length > 0 && blank(segments[0]!) && pipes[0] === segments[0]!.to) segments.shift();
  if (pipes.length > 0 && segments.length > 0 && blank(segments[segments.length - 1]!)
    && pipes[pipes.length - 1] === segments[segments.length - 1]!.from - 1) segments.pop();
  return {
    from,
    to: from + text.length,
    prefix,
    cells: segments.map((span) => ({ from: from + span.from, to: from + span.to })),
  };
}

function cellText(source: string, span: CellSpan): string {
  return source.slice(span.from, span.to).trim().replace(/\\\|/g, "|");
}

const DELIMITER = /^(:?)-+(:?)$/;

/// Legge una tabella dal suo testo, o `null` se non lo è: servono
/// un'intestazione e una riga di delimitatori.
export function parseTable(source: string): ParsedTable | null {
  const texts = source.split("\n");
  if (texts.length < 2) return null;
  const lines: SourceLine[] = [];
  let offset = 0;
  for (const text of texts) {
    lines.push(splitLine(text, offset));
    offset += text.length + 1;
  }
  const delimiter = lines[1]!;
  const aligns: TableAlign[] = [];
  for (const span of delimiter.cells) {
    const match = DELIMITER.exec(source.slice(span.from, span.to).trim());
    if (!match) return null;
    aligns.push(match[1] && match[2] ? "center" : match[1] ? "left" : match[2] ? "right" : null);
  }
  if (aligns.length === 0) return null;
  const content = [lines[0]!, ...lines.slice(2)];
  const width = Math.max(aligns.length, ...content.map((line) => line.cells.length));
  while (aligns.length < width) aligns.push(null);
  const rows = content.map((line) => {
    const row = line.cells.map((span) => cellText(source, span));
    while (row.length < width) row.push("");
    return row;
  });
  return { rows, aligns, source, lines };
}

/// La riga della sorgente che porta la riga `row` della griglia.
export function sourceLineOf(parsed: ParsedTable, row: number): SourceLine | undefined {
  return parsed.lines[row === 0 ? 0 : row + 1];
}

/// Dove comincia il testo di una cella nella sorgente, spazi esclusi; `null`
/// per una cella vuota o che la riga non scrive.
export function cellContentStart(parsed: ParsedTable, row: number, col: number): number | null {
  const span = sourceLineOf(parsed, row)?.cells[col];
  if (!span) return null;
  const segment = parsed.source.slice(span.from, span.to);
  if (segment.trim() === "") return null;
  return span.from + /^\s*/.exec(segment)![0].length;
}

/// La cella che contiene un offset della sorgente, se c'è.
export function cellAtOffset(parsed: ParsedTable, offset: number): GridPosition | null {
  for (let index = 0; index < parsed.lines.length; index++) {
    if (index === 1) continue;
    const line = parsed.lines[index]!;
    if (offset < line.from || offset > line.to) continue;
    const row = index === 0 ? 0 : index - 1;
    const col = line.cells.findIndex((span) => offset >= span.from && offset <= span.to);
    return { row, col: Math.max(0, col) };
  }
  return null;
}

// ── Scrittura ────────────────────────────────────────────────────────────────

/// Il testo di una cella com'è nella sorgente: pipe protette, niente a capo.
export function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function delimiterCell(align: TableAlign): string {
  return align === "center" ? ":---:" : align === "left" ? ":---" : align === "right" ? "---:" : "---";
}

function rowLine(cells: readonly string[], prefix: string): string {
  return `${prefix}| ${cells.map(escapeCell).join(" | ")} |`;
}

/// La tabella in forma canonica.
export function serializeTable(data: TableData, prefix = ""): string {
  const [header = [], ...body] = data.rows;
  const lines = [
    rowLine(header, prefix),
    `${prefix}| ${data.aligns.map(delimiterCell).join(" | ")} |`,
    ...body.map((row) => rowLine(row, prefix)),
  ];
  return lines.join("\n");
}

function sameShape(parsed: TableData, next: TableData): boolean {
  if (parsed.rows.length !== next.rows.length || parsed.aligns.length !== next.aligns.length) return false;
  return parsed.aligns.every((align, index) => align === next.aligns[index]);
}

/// Le modifiche che portano la sorgente da `parsed` a `next`, relative
/// all'inizio della tabella, in ordine e senza sovrapposizioni.
export function tableChanges(parsed: ParsedTable, next: TableData): TableChange[] {
  if (!sameShape(parsed, next)) {
    const prefix = parsed.lines[0]?.prefix ?? "";
    const insert = serializeTable(next, prefix);
    return insert === parsed.source ? [] : [{ from: 0, to: parsed.source.length, insert }];
  }
  const changes: TableChange[] = [];
  next.rows.forEach((row, r) => {
    const line = sourceLineOf(parsed, r)!;
    const changed = row.map((text, c) => text !== parsed.rows[r]![c]);
    if (!changed.some(Boolean)) return;
    // Una riga più corta dell'intestazione non ha dove scrivere la cella che
    // le manca: si riscrive la riga, e soltanto lei.
    if (changed.some((dirty, c) => dirty && c >= line.cells.length)) {
      changes.push({ from: line.from, to: line.to, insert: rowLine(row, line.prefix) });
      return;
    }
    changed.forEach((dirty, c) => {
      if (!dirty) return;
      const span = line.cells[c]!;
      const segment = parsed.source.slice(span.from, span.to);
      const content = escapeCell(row[c]!);
      const lead = segment.trim() === "" ? " " : /^\s*/.exec(segment)![0] || " ";
      const trail = segment.trim() === "" ? " " : /\s*$/.exec(segment)![0] || " ";
      changes.push({ from: span.from, to: span.to, insert: content === "" ? " " : `${lead}${content}${trail}` });
    });
  });
  return changes;
}

// ── Operazioni ───────────────────────────────────────────────────────────────

export function tableWidth(data: TableData): number {
  return data.aligns.length;
}

export function normalizeRange(anchor: GridPosition, focus: GridPosition): GridRange {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

export function inRange(range: GridRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

function emptyRow(width: number): string[] {
  return Array.from({ length: width }, () => "");
}

function mutable(data: TableData): string[][] {
  return data.rows.map((row) => [...row]);
}

/// Righe vuote nel corpo, a partire da `at` (mai sopra l'intestazione).
export function insertRows(data: TableData, at: number, count = 1): TableData {
  const rows = mutable(data);
  const index = Math.max(1, Math.min(rows.length, at));
  rows.splice(index, 0, ...Array.from({ length: count }, () => emptyRow(tableWidth(data))));
  return { rows, aligns: data.aligns };
}

/// Toglie le righe del corpo fra `from` e `to`; l'intestazione resta.
export function deleteRows(data: TableData, from: number, to: number): TableData {
  const start = Math.max(1, from);
  if (to < start) return data;
  const rows = mutable(data);
  rows.splice(start, to - start + 1);
  return { rows, aligns: data.aligns };
}

export function insertColumns(data: TableData, at: number, count = 1): TableData {
  const index = Math.max(0, Math.min(tableWidth(data), at));
  const rows = mutable(data).map((row) => {
    row.splice(index, 0, ...Array.from({ length: count }, () => ""));
    return row;
  });
  const aligns = [...data.aligns];
  aligns.splice(index, 0, ...Array.from({ length: count }, () => null));
  return { rows, aligns };
}

/// Toglie le colonne fra `from` e `to`, ma non l'ultima: una tabella senza
/// colonne non è una tabella.
export function deleteColumns(data: TableData, from: number, to: number): TableData {
  const count = to - from + 1;
  if (count <= 0 || count >= tableWidth(data)) return data;
  const rows = mutable(data).map((row) => {
    row.splice(from, count);
    return row;
  });
  const aligns = [...data.aligns];
  aligns.splice(from, count);
  return { rows, aligns };
}

/// Sposta di un passo le righe del corpo fra `from` e `to`; fuori dal corpo
/// non si va.
export function moveRows(data: TableData, from: number, to: number, delta: -1 | 1): TableData {
  const start = Math.max(1, from);
  if (to < start) return data;
  const target = delta < 0 ? start - 1 : to + 1;
  if (target < 1 || target >= data.rows.length) return data;
  const rows = mutable(data);
  const block = rows.splice(start, to - start + 1);
  rows.splice(start + delta, 0, ...block);
  return { rows, aligns: data.aligns };
}

export function moveColumns(data: TableData, from: number, to: number, delta: -1 | 1): TableData {
  const target = delta < 0 ? from - 1 : to + 1;
  if (target < 0 || target >= tableWidth(data)) return data;
  const shift = <T>(items: T[]): T[] => {
    const block = items.splice(from, to - from + 1);
    items.splice(from + delta, 0, ...block);
    return items;
  };
  return { rows: mutable(data).map(shift), aligns: shift([...data.aligns]) };
}

/// Ordina il corpo secondo una colonna: numeri come numeri, a parità
/// l'ordine di prima.
export function sortRows(data: TableData, col: number, direction: 1 | -1): TableData {
  const [header, ...body] = mutable(data);
  const ordered = body
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      direction * (a.row[col] ?? "").localeCompare(b.row[col] ?? "", undefined, { numeric: true }) || a.index - b.index
    )
    .map(({ row }) => row);
  return { rows: header ? [header, ...ordered] : ordered, aligns: data.aligns };
}

export function setAlign(data: TableData, from: number, to: number, align: TableAlign): TableData {
  return { rows: data.rows, aligns: data.aligns.map((current, index) => (index >= from && index <= to ? align : current)) };
}

export function setCell(data: TableData, row: number, col: number, text: string): TableData {
  if (data.rows[row]?.[col] === undefined || data.rows[row]![col] === text) return data;
  const rows = mutable(data);
  rows[row]![col] = text;
  return { rows, aligns: data.aligns };
}

export function mapRange(data: TableData, range: GridRange, map: (text: string) => string): TableData {
  const rows = mutable(data);
  let touched = false;
  for (let row = range.top; row <= range.bottom && row < rows.length; row++) {
    for (let col = range.left; col <= range.right && col < rows[row]!.length; col++) {
      const next = map(rows[row]![col]!);
      if (next !== rows[row]![col]) {
        rows[row]![col] = next;
        touched = true;
      }
    }
  }
  return touched ? { rows, aligns: data.aligns } : data;
}

export function clearRange(data: TableData, range: GridRange): TableData {
  return mapRange(data, range, () => "");
}

/// Incolla una matrice a partire da una cella, allargando la tabella quando
/// la matrice esce dai suoi bordi.
export function pasteMatrix(data: TableData, at: GridPosition, matrix: readonly (readonly string[])[]): TableData {
  if (matrix.length === 0) return data;
  const needRows = at.row + matrix.length;
  const needCols = at.col + Math.max(...matrix.map((row) => row.length));
  let next = data;
  if (needCols > tableWidth(next)) next = insertColumns(next, tableWidth(next), needCols - tableWidth(next));
  if (needRows > next.rows.length) next = insertRows(next, next.rows.length, needRows - next.rows.length);
  const rows = mutable(next);
  matrix.forEach((values, r) => values.forEach((value, c) => {
    rows[at.row + r]![at.col + c] = value;
  }));
  return { rows, aligns: next.aligns };
}

// ── Appunti ──────────────────────────────────────────────────────────────────

/// Le celle nel TSV dei fogli di calcolo ([`tsvRows`]): una cella con un tab
/// viaggia fra virgolette e torna com'era.
export function rangeTsv(data: TableData, range: GridRange): string {
  const rows: string[][] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    const cells: string[] = [];
    for (let col = range.left; col <= range.right; col++) cells.push(data.rows[row]?.[col] ?? "");
    rows.push(cells);
  }
  return tsvRows(rows);
}

/// Il testo incollato come matrice, letto come il TSV dei fogli di calcolo: una
/// cella multilinea di un foglio resta una cella, e i suoi a capo diventano
/// spazi quando la tabella si scrive ([`escapeCell`]). Gli spazi ai bordi di
/// una cella non contano nella sorgente, e si tolgono.
export function parseTsv(text: string): string[][] {
  return parseSheetTsv(text).map((row) => row.map((cell) => cell.trim()));
}

// ── Formattazione in riga ────────────────────────────────────────────────────

function run(text: string, char: string, fromEnd: boolean): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[fromEnd ? text.length - 1 - i : i] !== char) break;
    count++;
  }
  return count;
}

/// La cella è avvolta per intero dai marcatori? Il corsivo `*` si distingue
/// dal grassetto `**` per la parità della corsa, come nei comandi del profilo.
export function isWrapped(text: string, open: string, close: string): boolean {
  if (text.length < open.length + close.length || !text.startsWith(open) || !text.endsWith(close)) return false;
  if (open === "*" && close === "*") return run(text, "*", false) % 2 === 1 && run(text, "*", true) % 2 === 1;
  return true;
}

/// Le celle non vuote del rettangolo sono tutte avvolte?
export function rangeWrapped(data: TableData, range: GridRange, open: string, close: string): boolean {
  let any = false;
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) {
      const text = data.rows[row]?.[col] ?? "";
      if (text === "") continue;
      any = true;
      if (!isWrapped(text, open, close)) return false;
    }
  }
  return any;
}

/// Mette o toglie un marcatore alle celle non vuote del rettangolo: se sono
/// già tutte avvolte si tolgono, altrimenti si avvolgono quelle che non lo sono.
export function toggleWrap(data: TableData, range: GridRange, open: string, close = open): TableData {
  const unwrap = rangeWrapped(data, range, open, close);
  return mapRange(data, range, (text) => {
    if (text === "") return text;
    if (unwrap) return text.slice(open.length, text.length - close.length);
    return isWrapped(text, open, close) ? text : `${open}${text}${close}`;
  });
}

const WRAPPERS: readonly (readonly [string, string])[] = [
  ["**", "**"], ["__", "__"], ["~~", "~~"], ["==", "=="], ["`", "`"], ["*", "*"], ["_", "_"],
];

/// Toglie dalle celle i marcatori che le avvolgono per intero.
export function clearFormatting(data: TableData, range: GridRange): TableData {
  return mapRange(data, range, (text) => {
    let current = text;
    for (let changed = true; changed;) {
      changed = false;
      for (const [open, close] of WRAPPERS) {
        if (isWrapped(current, open, close)) {
          current = current.slice(open.length, current.length - close.length);
          changed = true;
        }
      }
    }
    return current;
  });
}

// ── Nomi ─────────────────────────────────────────────────────────────────────

/// Il nome di una colonna come in un foglio di calcolo: A … Z, AA, AB …
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}
