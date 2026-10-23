// I riferimenti A1 che le finestre leggono e scrivono: le lettere delle
// colonne, un intervallo semplice, il nome di un foglio fra apici.
//
// Bastano per proporre un valore di partenza. Il riferimento vero lo legge
// il provider, che rifiuta con la sua ragione quello che non capisce.

/// Le lettere della colonna `index`, da 0: 0 è A, 26 è AA.
export function columnLetters(index: number): string {
  let n = Math.max(0, Math.floor(index)) + 1;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/// La colonna di quelle lettere, da 0; `null` se non sono lettere.
export function columnIndex(letters: string): number | null {
  const text = letters.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(text)) return null;
  let n = 0;
  for (const char of text) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

/// Un intervallo rettangolare, da 0, con gli estremi compresi.
export interface Area {
  readonly row: number;
  readonly column: number;
  readonly lastRow: number;
  readonly lastColumn: number;
}

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

function cell(text: string): { row: number; column: number } | null {
  const match = CELL.exec(text.trim());
  if (!match) return null;
  const column = columnIndex(match[1]!);
  const row = Number(match[2]) - 1;
  return column === null || row < 0 ? null : { row, column };
}

/// `B2` o `B2:D10`, senza foglio; `null` per ogni altra forma (più aree,
/// righe o colonne intere).
export function parseArea(text: string): Area | null {
  const [first, second, ...rest] = text.split(":");
  if (first === undefined || rest.length) return null;
  const start = cell(first);
  const end = second === undefined ? start : cell(second);
  if (!start || !end) return null;
  return {
    row: Math.min(start.row, end.row),
    column: Math.min(start.column, end.column),
    lastRow: Math.max(start.row, end.row),
    lastColumn: Math.max(start.column, end.column),
  };
}

/// La cella in alto a sinistra di un'area, in A1.
export function cellName(row: number, column: number): string {
  return `${columnLetters(column)}${row + 1}`;
}

/// Un'area in A1, con i `$`: `$B$2:$D$10`, o `$B$2` per una cella.
export function absolute(area: Area): string {
  const one = (row: number, column: number) => `$${columnLetters(column)}$${row + 1}`;
  const start = one(area.row, area.column);
  return area.row === area.lastRow && area.column === area.lastColumn ? start : `${start}:${one(area.lastRow, area.lastColumn)}`;
}

/// Il nome di un foglio come lo scrive una formula: fra apici quando non è
/// un nome semplice, con l'apice raddoppiato.
export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}
