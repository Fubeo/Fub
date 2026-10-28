// Dove va la cella attiva dopo un tasto: le regole pure della Tabella, uguali
// per il foglio, il Markdown e il docx dove la capacità c'è. Non conoscono il
// DOM né il formato: chi le chiama dà la forma della tabella con un `Shape`,
// che salta righe e colonne nascoste e dice dove finisce.

export interface Cell {
  readonly row: number;
  readonly column: number;
}

/// Un intervallo rettangolare, dai due angoli compresi.
export interface Range {
  readonly r0: number;
  readonly c0: number;
  readonly r1: number;
  readonly c1: number;
}

/// Invio e Maiusc+Invio, Tab e Maiusc+Tab, le frecce.
export type Move = "down" | "up" | "right" | "left";

/// La forma della tabella per chi si sposta.
export interface Shape {
  /// La riga o la colonna visibile accanto a `from`, di un passo verso
  /// `step`; `from` stesso quando oltre non c'è niente.
  step(axis: "row" | "column", from: number, step: -1 | 1): number;
  /// Se la riga o la colonna `index` si vede.
  visible(axis: "row" | "column", index: number): boolean;
}

const AXIS: Record<Move, { readonly axis: "row" | "column"; readonly step: -1 | 1 }> = {
  down: { axis: "row", step: 1 },
  up: { axis: "row", step: -1 },
  right: { axis: "column", step: 1 },
  left: { axis: "column", step: -1 },
};

/// Se l'intervallo è più di una cella.
export function isMultiCell(range: Range): boolean {
  return range.r0 !== range.r1 || range.c0 !== range.c1;
}

/// Dove si va dopo aver confermato una cella, o su una cella scelta sola:
/// Invio scende (e torna alla colonna dove una serie di Tab era cominciata,
/// come nei fogli di calcolo), Tab va di lato e ricorda da dove è partito.
/// `null` quando oltre non c'è niente: la cella resta dov'è e chi chiama
/// decide (Tab sull'ultima colonna lascia uscire il fuoco).
export function nextCell(
  active: Cell,
  move: Move,
  tabStart: number | null,
  shape: Shape,
): { readonly cell: Cell; readonly tabStart: number | null } | null {
  const { axis, step: direction } = AXIS[move];
  if (axis === "column") {
    const column = shape.step("column", active.column, direction);
    if (column === active.column) return null;
    return { cell: { row: active.row, column }, tabStart: tabStart ?? active.column };
  }
  const row = shape.step("row", active.row, direction);
  if (row === active.row) return null;
  return { cell: { row, column: tabStart ?? active.column }, tabStart: null };
}

/// Dove va la cella attiva dentro un intervallo scelto di più celle: Invio
/// scende fino in fondo alla colonna e passa alla colonna dopo, Tab va a
/// destra fino in fondo alla riga e passa alla riga dopo; dall'ultima cella si
/// torna alla prima. Con Maiusc, all'indietro. La selezione non cambia.
export function nextInRange(range: Range, active: Cell, move: Move, shape: Shape): Cell {
  const forward = move === "down" || move === "right";
  const byRow = move === "right" || move === "left";
  const inside = (axis: "row" | "column", from: number, direction: -1 | 1): number | null => {
    const next = shape.step(axis, from, direction);
    if (next === from) return null;
    const [low, high] = axis === "row" ? [range.r0, range.r1] : [range.c0, range.c1];
    return next >= low && next <= high ? next : null;
  };
  const direction: -1 | 1 = forward ? 1 : -1;
  const [inner, outer] = byRow ? (["column", "row"] as const) : (["row", "column"] as const);
  const at = (innerIndex: number, outerIndex: number): Cell => byRow
    ? { row: outerIndex, column: innerIndex }
    : { row: innerIndex, column: outerIndex };
  const innerOf = (cell: Cell) => (inner === "row" ? cell.row : cell.column);
  const outerOf = (cell: Cell) => (outer === "row" ? cell.row : cell.column);
  const innerStart = edge(range, inner, forward, shape);
  const outerStart = edge(range, outer, forward, shape);
  const nextInner = inside(inner, innerOf(active), direction);
  if (nextInner !== null) return at(nextInner, outerOf(active));
  const nextOuter = inside(outer, outerOf(active), direction);
  if (nextOuter !== null) return at(innerStart, nextOuter);
  return at(innerStart, outerStart);
}

/// La prima riga (o colonna) visibile dell'intervallo, o l'ultima.
function edge(range: Range, axis: "row" | "column", first: boolean, shape: Shape): number {
  const [low, high] = axis === "row" ? [range.r0, range.r1] : [range.c0, range.c1];
  if (first) {
    for (let index = low; index <= high; index += 1) if (shape.visible(axis, index)) return index;
    return low;
  }
  for (let index = high; index >= low; index -= 1) if (shape.visible(axis, index)) return index;
  return high;
}
