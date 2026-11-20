// «Grafico da questa tabella» (T54, E23): dai valori di una tabella Markdown
// un recinto Mermaid normale, scritto sotto la tabella.
//
// Il grafico è una fotografia, non un grafico vivo: porta i valori di quando
// è stato scritto e lo dice in un commento `%%` che Mermaid non mostra. La
// stessa voce sulla stessa tabella lo rigenera: il recinto subito sotto la
// tabella che ha il segno `%% fub:table-chart` si riscrive al suo posto,
// invece di aggiungerne un altro. Il resto del testo non si tocca.
//
// La forma la sceglie la tabella:
//
// - una colonna è di numeri se ogni sua cella piena è un numero, letto nella
//   lingua della nota come la somma della banda (`i18n/shown-number.ts`:
//   «1.240,50» in italiano); un testo barrato vale una cella vuota;
// - le etichette sono la prima colonna che non è di numeri; se lo sono
//   tutte, la prima (gli anni), e con una colonna sola il numero della riga;
// - una serie sola, al più `MAX_PIE_SLICES` righe, tutte piene e mai
//   negative con una somma sopra zero: una torta (`pie`), le parti di un
//   tutto; una serie sola altrimenti: le barre (`xychart-beta`, `bar`); più
//   serie: una linea per serie, perché le barre di Mermaid si coprono.
//
// Senza una colonna di numeri, o senza righe, non c'è un grafico: la voce non
// si mostra.
import { readShownNumber } from "../../../../i18n/shown-number";
import { shownCellText } from "./table-grid";
import { tableWidth, type TableData } from "./table-model";

/// Il segno del recinto scritto da «Grafico da questa tabella»: non dipende
/// dalla lingua, così la voce ritrova il grafico anche se la nota cambia
/// lingua.
export const TABLE_CHART_MARK = "%% fub:table-chart";

/// Le fette oltre le quali una torta non si legge più: meglio le barre.
const MAX_PIE_SLICES = 8;
/// Le cifre dopo la virgola che un valore porta, al più: tolgono il rumore
/// della virgola mobile (0,1 × 100).
const MAX_DECIMALS = 10;

/// Che cosa la tabella dà al grafico: le etichette e le serie di numeri.
export interface TableSeries {
  readonly labels: readonly string[];
  readonly series: readonly { readonly name: string; readonly values: readonly (number | null)[] }[];
}

/// Le etichette e le serie di numeri di `data`, coi numeri letti in
/// `locale`; `null` se la tabella non ha una colonna di numeri o non ha righe.
export function tableSeries(data: TableData, locale: string): TableSeries | null {
  const width = tableWidth(data);
  const header = data.rows[0] ?? [];
  const body = data.rows.slice(1).map((row) => Array.from({ length: width }, (_, column) => shownCellText(row[column] ?? "")));
  if (body.length === 0 || width === 0) return null;
  // Il numero di ogni cella, e se le piene di ogni colonna lo sono tutte.
  const read = body.map((row) => row.map((text) => (text === "" ? null : readShownNumber(text, locale))));
  const numeric = Array.from({ length: width }, (_, column) => {
    let filled = 0;
    for (let row = 0; row < body.length; row++) {
      if (body[row]![column] === "") continue;
      if (read[row]![column] === null) return false;
      filled += 1;
    }
    return filled > 0;
  });
  const numbers = numeric.flatMap((is, column) => (is ? [column] : []));
  if (numbers.length === 0) return null;
  let labelColumn: number | null = numeric.findIndex((is) => !is);
  if (labelColumn < 0) labelColumn = numbers.length > 1 ? 0 : null;
  const columns = numbers.filter((column) => column !== labelColumn);
  // Una riga senza niente da disegnare non c'è.
  const rows = body
    .map((row, at) => ({ row, at }))
    .filter(({ row }) => columns.some((column) => row[column] !== "") || (labelColumn !== null && row[labelColumn] !== ""));
  if (rows.length === 0) return null;
  const labels = rows.map(({ row, at }) => (labelColumn !== null && row[labelColumn] !== "" ? row[labelColumn]! : String(at + 1)));
  const series = columns.map((column) => {
    const shown = rows.map(({ at }) => read[at]![column] ?? null);
    // Una colonna tutta di percentuali si disegna come si legge: «12%» è 12.
    const percent = shown.every((number) => number === null || number.percent);
    return {
      name: shownCellText(header[column] ?? ""),
      values: shown.map((number) => (number === null ? null : round(percent ? number.value * 100 : number.value))),
    };
  });
  return { labels, series };
}

/// Il recinto Mermaid coi valori di adesso, o `null` se la tabella non ha un
/// grafico. `note` è il commento che dice che non è un grafico vivo, nella
/// lingua dell'interfaccia.
export function tableChart(data: TableData, locale: string, note: string): string | null {
  const found = tableSeries(data, locale);
  if (found === null) return null;
  const { labels, series } = found;
  const lines: string[] = [];
  const only = series.length === 1 ? series[0]! : null;
  if (only && labels.length <= MAX_PIE_SLICES && only.values.every((value) => value !== null && value >= 0) && only.values.some((value) => value! > 0)) {
    lines.push(only.name === "" ? "pie" : `pie title ${line(only.name)}`);
    pushNote(lines, note);
    labels.forEach((label, at) => lines.push(`  ${quoted(label)} : ${number(only.values[at] ?? 0)}`));
  } else {
    lines.push("xychart-beta");
    pushNote(lines, note);
    if (only && only.name !== "") lines.push(`  title ${quoted(only.name)}`);
    lines.push(`  x-axis [${labels.map(quoted).join(", ")}]`);
    if (only && only.name !== "") lines.push(`  y-axis ${quoted(only.name)}`);
    for (const each of series) {
      // Mermaid non lascia buchi: una cella vuota vale zero.
      if (!only && each.name !== "") lines.push(`  %% ${line(each.name)}`);
      lines.push(`  ${only ? "bar" : "line"} [${each.values.map((value) => number(value ?? 0)).join(", ")}]`);
    }
  }
  return ["```mermaid", ...lines, "```"].join("\n");
}

function pushNote(lines: string[], note: string): void {
  lines.push(`  ${TABLE_CHART_MARK}`);
  lines.push(`  %% ${line(note)}`);
}

/// Il recinto scritto da «Grafico da questa tabella» subito sotto una tabella:
/// `after` è il testo dopo la fine della tabella; il risultato dice dove
/// comincia e dove finisce il recinto in `after` (dall'apertura alla fine
/// della chiusura). Fra la tabella e il recinto al più una riga vuota; un
/// recinto senza il segno, o senza chiusura, non è il grafico.
export function generatedChartAfter(after: string): { readonly from: number; readonly to: number } | null {
  // La tabella finisce col suo a capo o subito prima.
  const match = /^(\n?(?:[ \t]*\n)?)[ \t]{0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*\n/u.exec(after);
  if (!match) return null;
  const from = match[1]!.length;
  const fence = match[2]!;
  const closing = new RegExp(`^[ \\t]{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`, "u");
  let at = match[0].length;
  let marked = false;
  while (at <= after.length) {
    const end = after.indexOf("\n", at);
    const text = after.slice(at, end < 0 ? after.length : end);
    if (closing.test(text)) return marked ? { from, to: at + text.length } : null;
    if (text.trim() === TABLE_CHART_MARK) marked = true;
    if (end < 0) break;
    at = end + 1;
  }
  return null;
}

/// Un testo su una riga sola, per un titolo o un commento.
function line(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/// Un testo fra virgolette per Mermaid, che non sa saltarle: quelle dentro
/// diventano apostrofi.
function quoted(text: string): string {
  return `"${line(text).replaceAll('"', "'")}"`;
}

/// Un numero come lo legge Mermaid: il punto per la virgola, senza migliaia.
function number(value: number): string {
  return String(value);
}

function round(value: number): number {
  return Number(value.toFixed(MAX_DECIMALS));
}
