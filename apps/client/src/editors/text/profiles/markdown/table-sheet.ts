// Tabella in foglio, foglio in tabella (T52, E23): le regole pure dei tre
// gesti fra una tabella Markdown e un foglio di calcolo.
//
// - «Trasforma in foglio»: i valori della tabella letti nella lingua della
//   nota, come li scrive il comando del nucleo `note.table.sheet` (un testo,
//   o un numero con l'aspetto che aveva: decimali, migliaia, percentuale,
//   valuta, parentesi dei conti). La lettura dei numeri è quella della somma
//   nella banda e del grafico da una tabella (`i18n/shown-number.ts`).
// - «Stacca come tabella»: i valori che la scheda di foglio mostra tornano
//   una tabella. Il foglio li dà col formato di GridCraft, coi separatori
//   all'inglese («1,240.50 €»): un numero si riscrive con quelli della lingua
//   della nota («1.240,50 €»), così andata e ritorno danno gli stessi valori.
// - Le celle incollate da un foglio (testo a tabulazioni) diventano una
//   tabella, e se vengono da un file del vault c'è anche la sua scheda.
import { knownLocale, readShownNumber } from "../../../../i18n/shown-number";
import type { CellReading, CellValuePort } from "./cell-value";
import type { CellsOrigin } from "./cells-clipboard";
import { liveStrings } from "./strings";
import { shownCellText } from "./table-grid";
import { parseTsv, serializeTable, type TableAlign } from "./table-model";

/// Oltre queste righe (senza l'intestazione) o colonne la tabella si legge
/// meglio in un foglio, e la nota lo propone.
export const SHEET_PROPOSAL_ROWS = 200;
export const SHEET_PROPOSAL_COLUMNS = 30;

/// Le celle più numerose che «Stacca come tabella» scrive: oltre, la tabella
/// non si legge più in una nota.
export const DETACH_MAX_ROWS = 1000;
export const DETACH_MAX_COLUMNS = 60;

/// Un numero come lo riceve il comando: il valore e com'era scritto.
export interface SheetNumber {
  readonly number: number;
  readonly decimals: number;
  readonly grouped: boolean;
  readonly percent: boolean;
  readonly parens: boolean;
  readonly currency?: string;
  readonly currency_after?: boolean;
  readonly currency_spaced?: boolean;
}

/// Una cella per il comando: un testo (`""` è vuota) o un numero.
export type SheetCell = string | SheetNumber;

/// Ciò che «Trasforma in foglio» manda al comando: la nota, i byte UTF-8 della
/// tabella com'è sul disco, il suo testo e i valori letti.
export interface TableSheetRequest {
  readonly doc: string;
  readonly at: readonly [number, number];
  readonly text: string;
  readonly cells: readonly (readonly SheetCell[])[];
}

/// Chi scrive il foglio: la shell, col comando del nucleo. `null` se è
/// andata, altrimenti la frase che dice perché no.
export interface TableSheetPort {
  turn(request: TableSheetRequest): Promise<string | null>;
}

const CURRENCY = /[€$£¥]/u;

/// I separatori di `locale`: migliaia e decimali.
function separatorsOf(locale: string): { readonly group: string; readonly decimal: string } {
  const parts = new Intl.NumberFormat(knownLocale(locale), { useGrouping: true }).formatToParts(1234567.5);
  return {
    group: parts.find((part) => part.type === "group")?.value ?? ",",
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
  };
}

/// Il numero che `text` scrive nella lingua `locale`, con il suo aspetto;
/// `null` se è testo.
export function readNumberLook(text: string, locale: string): SheetNumber | null {
  const read = readShownNumber(text, locale);
  if (read === null) return null;
  const body = text.trim();
  const digits = body.replace(/[€$£¥%()+\-−\s]/gu, "");
  const { group, decimal } = separatorsOf(locale);
  // Le migliaia ci sono se il separatore sta fra le cifre intere: con lo
  // spazio (anche quello stretto) vale ogni spazio, come nella lettura.
  const grouped = /^\s$/u.test(group)
    ? /\d\s\d{3}/u.test(body)
    : digits.split(decimal)[0]!.includes(group);
  const look: { -readonly [K in keyof SheetNumber]: SheetNumber[K] } = {
    number: read.value,
    decimals: read.percent ? read.decimals - 2 : read.decimals,
    grouped,
    percent: read.percent,
    parens: body.startsWith("(") && body.endsWith(")"),
  };
  const symbol = CURRENCY.exec(body);
  if (symbol) {
    const at = symbol.index;
    const firstDigit = body.search(/\d/u);
    const after = firstDigit >= 0 && at > firstDigit;
    look.currency = symbol[0];
    look.currency_after = after;
    look.currency_spaced = after ? /\s$/u.test(body.slice(0, at)) : /^\s/u.test(body.slice(at + 1));
  }
  return look;
}

/// Il testo di una cella com'è nella tabella, per il foglio: senza i segni che
/// la avvolgono (`**Totale**` è «Totale»), con gli a capo veri al posto di
/// `<br>`. Un testo tutto barrato resta com'è scritto.
function cellText(raw: string): string {
  const shown = shownCellText(raw);
  const text = shown === "" && raw.trim() !== "" ? raw.trim() : shown;
  return text.replace(/<br\s*\/?>/giu, "\n");
}

/// Le celle della tabella per «Trasforma in foglio»: l'intestazione resta
/// testo, il corpo si legge nella lingua della nota. Ogni riga ha tante celle
/// quante colonne.
export function sheetCells(rows: readonly (readonly string[])[], columns: number, locale: string): SheetCell[][] {
  return rows.map((row, index) => {
    const cells: SheetCell[] = [];
    for (let column = 0; column < columns; column++) {
      const text = cellText(row[column] ?? "");
      if (index === 0) {
        cells.push(text);
        continue;
      }
      cells.push(readNumberLook(text, locale) ?? text);
    }
    return cells;
  });
}

/// La tabella è grande abbastanza da proporre il foglio.
export function proposesSheet(rows: number, columns: number): boolean {
  return rows > SHEET_PROPOSAL_ROWS || columns > SHEET_PROPOSAL_COLUMNS;
}

/// Il valore che un foglio mostra («1,240.50 €», col formato di GridCraft)
/// con i separatori della lingua `locale`; un testo che non è un numero resta
/// com'è.
export function localizedShown(text: string, locale: string): string {
  if (readShownNumber(text, "en") === null) return text;
  const { group, decimal } = separatorsOf(locale);
  if (group === "," && decimal === ".") return text;
  return text.replace(/[,.]/gu, (mark) => (mark === "," ? group : decimal));
}

/// La tabella Markdown dei valori mostrati da una parte di foglio: la prima
/// riga è l'intestazione, i numeri nella lingua della nota e allineati a
/// destra se lo sono tutti in una colonna.
export function tableOfShown(rows: readonly (readonly string[])[], locale: string): string | null {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  if (rows.length === 0 || columns === 0) return null;
  const shown = rows.map((row) => Array.from({ length: columns }, (_, column) => localizedShown(row[column] ?? "", locale)));
  const aligns: TableAlign[] = Array.from({ length: columns }, (_, column) => {
    const body = shown.slice(1).map((row) => row[column]!).filter((cell) => cell.trim() !== "");
    return body.length > 0 && body.every((cell) => readShownNumber(cell, locale) !== null) ? "right" : null;
  });
  // Una tabella ha almeno l'intestazione e una riga.
  const data = shown.length === 1 ? [...shown, shown[0]!.map(() => "")] : shown;
  return serializeTable({ rows: data, aligns });
}

/// Le celle di un intervallo (`A1:C5`, `B2`), riga per riga, come nomi di
/// cella; `null` se non è un intervallo o se è più grande di quanto una nota
/// tenga.
export function rangeCells(range: string): string[][] | null {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?$/u.exec(range.trim().toUpperCase());
  if (!match) return null;
  const column = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const letters = (index: number): string => {
    let out = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    return out;
  };
  const c1 = column(match[1]!);
  const r1 = Number(match[2]) - 1;
  const c2 = match[3] ? column(match[3]) : c1;
  const r2 = match[4] ? Number(match[4]) - 1 : r1;
  const [top, bottom] = [Math.min(r1, r2), Math.max(r1, r2)];
  const [left, right] = [Math.min(c1, c2), Math.max(c1, c2)];
  if (top < 0 || bottom - top + 1 > DETACH_MAX_ROWS || right - left + 1 > DETACH_MAX_COLUMNS) return null;
  const rows: string[][] = [];
  for (let row = top; row <= bottom; row++) {
    const cells: string[] = [];
    for (let col = left; col <= right; col++) cells.push(`${letters(col)}${row + 1}`);
    rows.push(cells);
  }
  return rows;
}

/// La parte di un embed di foglio divisa: il foglio (o `null`) e
/// l'intervallo. `Budget!A1:E7`, `'Conti 2025'!B2:C3`, `A1:C3`.
export function splitSheetPart(part: string): { readonly sheet: string | null; readonly range: string } | null {
  const bang = part.lastIndexOf("!");
  const range = part.slice(bang + 1).trim();
  if (bang < 0) return rangeCells(range) ? { sheet: null, range } : null;
  const raw = part.slice(0, bang).trim();
  const quoted = /^'((?:[^']|'')+)'$/u.exec(raw);
  const sheet = quoted ? quoted[1]!.replaceAll("''", "'") : raw;
  return sheet === "" || !rangeCells(range) ? null : { sheet, range };
}

/// Il nome di un foglio come lo scrive una parte: fra apici se serve.
export function quotedSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/u.test(name) && !/^[A-Za-z]{1,3}\d+$/u.test(name)
    ? name
    : `'${name.replaceAll("'", "''")}'`;
}

/// Il testo a tabulazioni incollato come tabella Markdown, o `null` se non è
/// una griglia: almeno due celle, e ogni riga con le stesse colonne.
///
/// Con `locale` le celle vengono da un foglio di Fub, che le copia col formato
/// di GridCraft: i numeri prendono i separatori della nota e le colonne di
/// numeri vanno a destra, come in «Stacca come tabella».
export function tsvTable(text: string, locale?: string): string | null {
  if (!text.includes("\t")) return null;
  const rows = parseTsv(text.replace(/\r?\n$/u, ""));
  const columns = rows[0]?.length ?? 0;
  if (rows.length === 0 || columns < 2 || rows.some((row) => row.length !== columns)) return null;
  // Un testo rientrato a tabulazioni (codice, un elenco) non è una griglia.
  if (rows.every((row) => row[0]!.trim() === "")) return null;
  if (locale !== undefined) return tableOfShown(rows, locale);
  const data = rows.length === 1 ? [...rows, rows[0]!.map(() => "")] : rows;
  return serializeTable({ rows: data, aligns: Array.from({ length: columns }, () => null) });
}

/// L'embed della parte di foglio da cui vengono le celle: `null` se il nome
/// del file o del foglio non si scrive in un wikilink.
export function cellsEmbed(origin: CellsOrigin): string | null {
  const part = `${quotedSheet(origin.sheet)}!${origin.range}`;
  if (/[[\]|#^\n\r]/u.test(origin.doc) || /[[\]|\n\r]/u.test(part)) return null;
  return `![[${origin.doc}#${part}]]`;
}

/// Ciò che «Stacca come tabella» ha letto: la tabella dei valori mostrati,
/// o la frase che dice perché no.
export type DetachedTable = { readonly table: string } | { readonly failed: string };

/// La tabella Markdown dei valori che il foglio `page` (scritto nella nota
/// `from`) mostra nella parte `part` (`Foglio1!A1:C3`), nella lingua
/// `locale`. Le formule restano nel foglio: si prendono i valori di adesso,
/// e il foglio non cambia.
export async function detachedTable(
  port: CellValuePort,
  page: string,
  from: string,
  part: string,
  locale: string,
): Promise<DetachedTable> {
  const split = splitSheetPart(part);
  const cells = split ? rangeCells(split.range) : null;
  if (!split || !cells) return { failed: liveStrings.t("table_sheet.detach.range") };
  const [path, reader] = await Promise.all([
    port.resolve(page, from).catch(() => null),
    port.load().catch(() => null),
  ]);
  if (path === null) return { failed: liveStrings.t("table_sheet.detach.missing", { page }) };
  if (reader === null) return { failed: liveStrings.t("table_sheet.detach.unavailable") };
  const prefix = split.sheet === null ? "" : `${quotedSheet(split.sheet)}!`;
  let readings: ReadonlyMap<string, CellReading>;
  try {
    readings = await reader.read(path, cells.flat().map((cell) => `${prefix}${cell}`));
  } catch {
    return { failed: liveStrings.t("table_sheet.detach.unavailable") };
  }
  const rows: string[][] = [];
  for (const row of cells) {
    const shown: string[] = [];
    for (const cell of row) {
      const reading = readings.get(`${prefix}${cell}`);
      if (reading?.state === "value") shown.push(reading.text);
      else if (reading?.state === "empty") shown.push("");
      else if (reading?.state === "missing") return { failed: liveStrings.t("table_sheet.detach.missing", { page }) };
      else if (reading?.state === "lost") return { failed: liveStrings.t("table_sheet.detach.sheet", { page }) };
      else return { failed: liveStrings.t("table_sheet.detach.unavailable") };
    }
    rows.push(shown);
  }
  const table = tableOfShown(rows, locale);
  return table === null ? { failed: liveStrings.t("table_sheet.detach.range") } : { table };
}
