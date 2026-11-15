// Gli appunti delle tabelle, come nei fogli di calcolo: in uscita il TSV e
// una tabella HTML, in entrata la tabella HTML di Excel, LibreOffice, Sheets
// o Word quando c'è, altrimenti il TSV. Dove va un blocco incollato lo dice
// `pasteTargets`: dall'angolo in alto a sinistra della selezione, e ripetuto
// quando la selezione ne contiene un numero intero di copie.

import { parseTsv, tsvRows } from "../editors/core/tsv";
import type { Range } from "./navigation";

/// L'attributo che segna una tabella HTML scritta da Fub: incollandola si
/// legge il TSV accanto, che porta gli input (formule comprese) e non il
/// testo mostrato.
export const OWN_TABLE = "data-fub-table";

/// Che cosa scrivere negli appunti: `input` va nel TSV, `shown` nella
/// tabella HTML.
export interface ClipboardCell {
  readonly input: string;
  readonly shown: string;
}

export function clipboardData(rows: readonly (readonly ClipboardCell[])[]): { readonly text: string; readonly html: string } {
  return {
    text: tsvRows(rows.map((row) => row.map((cell) => cell.input))),
    html: tableHtml(rows.map((row) => row.map((cell) => cell.shown))),
  };
}

/// Una tabella HTML semplice, che i fogli e Word leggono.
export function tableHtml(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value).replace(/\r?\n/g, "<br>")}</td>`).join("")}</tr>`)
    .join("");
  return `<table ${OWN_TABLE}=""><tbody>${body}</tbody></table>`;
}

/// Le righe incollate. La tabella HTML vince sul testo, salvo quella scritta
/// da Fub; le celle unite lasciano celle vuote dove coprono.
export function clipboardRows(text: string, html: string): string[][] {
  const table = html ? htmlTableRows(html) : null;
  return table ?? parseTsv(text);
}

/// Le righe della prima tabella di un frammento HTML, o `null` se non ce n'è
/// una (o è di Fub).
export function htmlTableRows(html: string): string[][] | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table || table.hasAttribute(OWN_TABLE)) return null;
  const rows: string[][] = [];
  // Le celle che una cella sopra copre ancora, colonna per colonna.
  const covered: number[] = [];
  Array.from(table.rows).forEach((tr, rowIndex) => {
    const row = (rows[rowIndex] ??= []);
    let column = 0;
    for (const cell of Array.from(tr.cells)) {
      while ((covered[column] ?? 0) > 0) {
        covered[column] -= 1;
        row[column] ??= "";
        column += 1;
      }
      const span = Math.max(1, cell.colSpan || 1);
      const down = Math.max(1, cell.rowSpan || 1);
      row[column] = cellText(cell);
      for (let extra = 0; extra < span; extra += 1) {
        if (extra > 0) row[column + extra] = "";
        if (down > 1) covered[column + extra] = down - 1;
      }
      column += span;
    }
    for (; column < covered.length; column += 1) {
      if ((covered[column] ?? 0) > 0) {
        covered[column] -= 1;
        row[column] = "";
      }
    }
  });
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

/// Il testo di una cella: `<br>` e i paragrafi diventano a capo, gli spazi
/// del codice HTML no.
function cellText(cell: HTMLTableCellElement): string {
  const lines: string[] = [];
  let line = "";
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      line += (node.textContent ?? "").replace(/\s+/g, " ");
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === "BR") {
      lines.push(line);
      line = "";
      return;
    }
    const block = /^(P|DIV|LI|H[1-6])$/.test(node.tagName);
    if (block && line.trim()) {
      lines.push(line);
      line = "";
    }
    node.childNodes.forEach(walk);
    if (block && line.trim()) {
      lines.push(line);
      line = "";
    }
  };
  cell.childNodes.forEach(walk);
  if (line.trim() || !lines.length) lines.push(line);
  return lines.map((text) => text.trim()).join("\n").replace(/ /g, " ");
}

/// Dove va ogni copia del blocco incollato: dall'angolo in alto a sinistra
/// della selezione; quando la selezione è più di una cella e il blocco ci
/// entra un numero intero di volte per lato, lo si ripete fino a riempirla.
export function pasteTargets(selection: Range, block: { readonly rows: number; readonly columns: number }): Range[] {
  const rows = selection.r1 - selection.r0 + 1;
  const columns = selection.c1 - selection.c0 + 1;
  const once: Range = {
    r0: selection.r0,
    c0: selection.c0,
    r1: selection.r0 + block.rows - 1,
    c1: selection.c0 + block.columns - 1,
  };
  if (block.rows <= 0 || block.columns <= 0) return [];
  if ((rows === 1 && columns === 1) || rows % block.rows !== 0 || columns % block.columns !== 0) return [once];
  const targets: Range[] = [];
  for (let r0 = selection.r0; r0 <= selection.r1; r0 += block.rows) {
    for (let c0 = selection.c0; c0 <= selection.c1; c0 += block.columns) {
      targets.push({ r0, c0, r1: r0 + block.rows - 1, c1: c0 + block.columns - 1 });
    }
  }
  return targets;
}

/// Il segno del taglio: le celle tagliate restano dove sono, tratteggiate,
/// finché non si incolla. `text` è il TSV che il taglio ha scritto negli
/// appunti: l'incolla sposta soltanto se gli appunti dicono ancora quello e
/// le celle tagliate non sono cambiate nel frattempo.
export interface CutMark {
  readonly range: Range;
  readonly text: string;
}

/// Se l'incolla di `pasted` sposta le celle del segno: gli appunti sono
/// quelli del taglio e le celle tagliate dicono ancora `now`.
export function cutMoves(mark: CutMark, pasted: string, now: string): boolean {
  // Gli appunti di sistema possono tornare con `\r\n` al posto di `\n`.
  const plain = (text: string) => text.replace(/\r\n?/g, "\n");
  return plain(pasted) === plain(mark.text) && now === mark.text;
}

/// Dove va un taglio incollato: dall'angolo in alto a sinistra della
/// selezione, grande quanto le celle tagliate. Un taglio si incolla una volta.
export function cutDestination(source: Range, selection: Range): Range {
  return {
    r0: selection.r0,
    c0: selection.c0,
    r1: selection.r0 + source.r1 - source.r0,
    c1: selection.c0 + source.c1 - source.c0,
  };
}

let cutTold = false;

/// Se il taglio deve ancora dire che cosa farà l'incolla: soltanto la prima
/// volta della sessione, in qualunque tabella. Il segno resta tratteggiato e
/// sposta soltanto nella sua tabella; altrove l'incolla copia, e chi taglia
/// lo deve sapere prima di incollare.
export function tellCutOnce(): boolean {
  if (cutTold) return false;
  cutTold = true;
  return true;
}

/// Dove va un taglio incollato in una tabella di `size`, se ci sta. Oltre il
/// bordo il taglio non si sposta e non allarga la tabella: `null`, e
/// l'incolla è uno qualunque. La stessa regola per la cornice e il documento.
export function cutTarget(source: Range, selection: Range, size: { readonly rows: number; readonly columns: number }): Range | null {
  const destination = cutDestination(source, selection);
  return destination.r1 < size.rows && destination.c1 < size.columns ? destination : null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
