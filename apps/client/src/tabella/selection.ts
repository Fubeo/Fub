// La selezione a più intervalli dei fogli di calcolo: Ctrl+clic, Ctrl+trascina
// e Maiusc+F8 aggiungono un intervallo agli altri, e quello in cui si lavora è
// l'ultimo. Qui stanno le regole pure; chi disegna e chi dà i comandi è
// l'adattatore.

import type { Cell, Range } from "./navigation";

/// Se `range` tocca il rettangolo da `r0`, `c0` a `r1`, `c1` (una cella o
/// un'unione).
export function touches(range: Range, r0: number, c0: number, r1 = r0, c1 = c0): boolean {
  return r0 <= range.r1 && r1 >= range.r0 && c0 <= range.c1 && c1 >= range.c0;
}

/// Gli intervalli dopo che `range` si aggiunge a `ranges`: uno uguale non si
/// ripete, e l'ultimo è quello aggiunto.
export function withRange(ranges: readonly Range[], range: Range): Range[] {
  const same = (other: Range) => other.r0 === range.r0 && other.c0 === range.c0 && other.r1 === range.r1 && other.c1 === range.c1;
  return [...ranges.filter((other) => !same(other)), range];
}

/// L'intervallo fra l'àncora e la cella attiva, coi due angoli in ordine.
export function rangeBetween(anchor: { readonly row: number; readonly column: number }, focus: { readonly row: number; readonly column: number }): Range {
  return {
    r0: Math.min(anchor.row, focus.row),
    c0: Math.min(anchor.column, focus.column),
    r1: Math.max(anchor.row, focus.row),
    c1: Math.max(anchor.column, focus.column),
  };
}

/// Il riempimento che la maniglia porta da `source` verso la cella `over`:
/// come in Excel, lungo l'asse su cui il puntatore è uscito di più, fino alla
/// sua riga o colonna. Dentro la sorgente non c'è riempimento (`null`).
export function fillRange(source: Range, over: Cell): Range | null {
  const vertical = Math.max(over.row - source.r1, source.r0 - over.row, 0);
  const horizontal = Math.max(over.column - source.c1, source.c0 - over.column, 0);
  if (vertical === 0 && horizontal === 0) return null;
  if (vertical >= horizontal) {
    return over.row > source.r1 ? { ...source, r1: over.row } : { ...source, r0: over.row };
  }
  return over.column > source.c1 ? { ...source, c1: over.column } : { ...source, c0: over.column };
}

/// Il doppio clic sulla maniglia, come in Excel: la serie di `source` scende
/// quanto la colonna accanto (quella a sinistra, se sotto la sorgente ha un
/// valore, altrimenti quella a destra), e si ferma prima di una cella già
/// piena nelle colonne della sorgente, così non scrive sopra niente.
/// `filled` dice se una cella ha un valore, `rows` quante righe ha la
/// tabella, `first` la prima riga del corpo: dall'intestazione non si
/// scende. `null` se non c'è niente da riempire.
export function fillToEndRange(source: Range, rows: number, columns: number, filled: (row: number, column: number) => boolean, first = 0): Range | null {
  if (source.r0 < first) return null;
  const below = source.r1 + 1;
  if (below >= rows) return null;
  const left = source.c0 - 1;
  const right = source.c1 + 1;
  const guide = left >= 0 && filled(below, left) ? left : right < columns && filled(below, right) ? right : null;
  if (guide === null) return null;
  let last = source.r1;
  while (last + 1 < rows && filled(last + 1, guide)) {
    let free = true;
    for (let c = source.c0; c <= source.c1 && free; c++) free = !filled(last + 1, c);
    if (!free) break;
    last += 1;
  }
  return last > source.r1 ? { ...source, r1: last } : null;
}

/// Se `range` prende le righe intere (tutte le colonne di `bounds`) o le
/// colonne intere (tutte le righe). `bounds` è la tabella: la prima e
/// l'ultima riga e colonna che si vedono.
export function covers(range: Range, bounds: Range): { readonly wholeRows: boolean; readonly wholeColumns: boolean } {
  return {
    wholeRows: range.c0 <= bounds.c0 && range.c1 >= bounds.c1,
    wholeColumns: range.r0 <= bounds.r0 && range.r1 >= bounds.r1,
  };
}

/// La riga, la colonna o la tabella intera attorno a `range`: Maiusc+Spazio,
/// Ctrl+Spazio e tutti e due.
export function wholeRange(range: Range, which: "row" | "column" | "table", bounds: Range): Range {
  if (which === "table") return { ...bounds };
  if (which === "row") return { r0: range.r0, c0: bounds.c0, r1: range.r1, c1: bounds.c1 };
  return { r0: bounds.r0, c0: range.c0, r1: bounds.r1, c1: range.c1 };
}

/// Ctrl+D e Ctrl+R, come nei fogli di calcolo: con più righe (o colonne)
/// scelte la prima si copia nelle altre; con una sola, si copia quella sopra
/// (o a sinistra), che non può stare prima di `first` (l'intestazione non si
/// copia nel corpo). Le righe d'intestazione scelte non contano: con una
/// colonna intera scende la prima riga del corpo. `null` se non c'è niente
/// da copiare.
export function fillCopy(range: Range, direction: "down" | "right", first = 0): { readonly source: Range; readonly target: Range } | null {
  if (direction === "down") {
    const r0 = Math.max(range.r0, first);
    if (range.r1 > r0) return { source: { ...range, r0, r1: r0 }, target: { ...range, r0: r0 + 1 } };
    if (range.r1 < first || r0 - 1 < first || r0 !== range.r0) return null;
    return { source: { ...range, r0: r0 - 1, r1: r0 - 1 }, target: range };
  }
  if (range.c1 > range.c0) return { source: { ...range, c1: range.c0 }, target: { ...range, c0: range.c0 + 1 } };
  if (range.c0 - 1 < 0) return null;
  return { source: { ...range, c0: range.c0 - 1, c1: range.c0 - 1 }, target: range };
}
