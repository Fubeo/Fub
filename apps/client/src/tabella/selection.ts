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
