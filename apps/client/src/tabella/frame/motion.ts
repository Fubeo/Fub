// Il moto della cornice quando la tabella cambia (E22): ogni cella scivola
// dal posto di prima a quello nuovo, quelle nuove entrano, quelle tolte
// svaniscono, i valori cambiati compaiono a cascata. Annulla e ripeti fanno lo
// stesso moto al contrario, perché il moto si legge dalla tabella di prima e
// da quella di dopo, non dal gesto.
//
// Soltanto `transform` e `opacity`, con `moto`: le posizioni si leggono una
// volta prima del cambio e una dopo, dall'impaginazione (`offsetLeft`,
// `offsetTop`), che le corse in volo non spostano. Oltre `STILL_CELLS` celle,
// e col moto ridotto, niente moto.

import { animate, motionLevel, prepareExit, type Ghost } from "../../moto";

/// La selezione e la cella attiva che scivolano al posto nuovo (ms).
export const SELECT_MS = 120;
export const SELECT_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/// Oltre queste celle la tabella non si muove: il costo crescerebbe con lei.
export const STILL_CELLS = 600;
/// Righe e colonne che si fanno spazio, e quelle nuove che entrano (ms).
export const ROWS_MS = 260;
/// Le celle tolte che svaniscono (ms).
export const REMOVE_MS = 170;
/// Un valore nuovo che compare (ms), e il passo della cascata (ms).
export const VALUE_MS = 220;
export const CASCADE_MS = 16;
/// Quante celle della cascata si sfalsano, e quante celle tolte si mostrano.
const CASCADE_MAX = 14;
const GHOSTS_MAX = 48;
/// La curva di ogni corsa: parte decisa e si posa, senza rimbalzi.
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/// Da quale riga e colonna di prima viene ogni riga e colonna di adesso;
/// `-1` per quelle nuove.
export interface ChangeMap {
  readonly rows: readonly number[];
  readonly columns: readonly number[];
}

/// Accoppia la tabella di prima e quella di dopo. Se cambiano soltanto le
/// righe (aggiunte, tolte, spostate, ordinate) le righe si riconoscono dal
/// loro testo e le colonne restano; lo stesso, scambiato, per le colonne.
/// Altrimenti ogni cella resta al suo indice e ciò che è in più è nuovo.
export function changeMap(before: readonly (readonly string[])[], after: readonly (readonly string[])[]): ChangeMap {
  const oldRows = before.length;
  const newRows = after.length;
  const oldColumns = before[0]?.length ?? 0;
  const newColumns = after[0]?.length ?? 0;
  const identity = (count: number, old: number) => Array.from({ length: count }, (_, index) => (index < old ? index : -1));
  const rowKeys = (rows: readonly (readonly string[])[]) => rows.map((row) => row.join("\u0001"));
  const columnKeys = (rows: readonly (readonly string[])[], width: number) =>
    Array.from({ length: width }, (_, column) => rows.map((row) => row[column] ?? "").join("\u0001"));
  if (oldColumns === newColumns) {
    const from = rowKeys(before);
    const to = rowKeys(after);
    if (oldRows !== newRows || reordered(from, to)) return { rows: matchKeys(from, to), columns: identity(newColumns, oldColumns) };
  }
  if (oldRows === newRows) {
    const from = columnKeys(before, oldColumns);
    const to = columnKeys(after, newColumns);
    if (oldColumns !== newColumns || reordered(from, to)) return { rows: identity(newRows, oldRows), columns: matchKeys(from, to) };
  }
  return { rows: identity(newRows, oldRows), columns: identity(newColumns, oldColumns) };
}

/// Se `to` ha le stesse voci di `from` in un altro ordine.
function reordered(from: readonly string[], to: readonly string[]): boolean {
  if (from.length !== to.length || from.every((key, index) => key === to[index])) return false;
  return [...from].sort().join("\u0002") === [...to].sort().join("\u0002");
}

/// Per ogni voce di `to`, la prima voce uguale di `from` non ancora presa.
/// Le voci rimaste al loro posto si prendono prima, così una riga vuota
/// aggiunta non ruba il posto a una vuota che c'era già.
function matchKeys(from: readonly string[], to: readonly string[]): number[] {
  const taken = new Set<number>();
  const result = to.map((key, index) => {
    if (from[index] === key && !taken.has(index)) {
      taken.add(index);
      return index;
    }
    return -2;
  });
  const free = new Map<string, number[]>();
  from.forEach((key, index) => {
    if (taken.has(index)) return;
    const list = free.get(key);
    if (list) list.push(index);
    else free.set(key, [index]);
  });
  return result.map((found, index) => (found !== -2 ? found : (free.get(to[index]!)?.shift() ?? -1)));
}

/// La posizione di `element` dentro `container`, dall'impaginazione.
export function offsetWithin(element: HTMLElement, container: HTMLElement): { readonly left: number; readonly top: number } {
  let left = 0;
  let top = 0;
  let current: HTMLElement | null = element;
  while (current && current !== container) {
    left += current.offsetLeft;
    top += current.offsetTop;
    const parent: Element | null = current.offsetParent;
    if (!(parent instanceof HTMLElement) || !container.contains(parent)) {
      // Fuori dalla catena: si sottrae il contenitore misurato allo stesso modo.
      if (parent !== container) {
        let outer: HTMLElement | null = container;
        while (outer) {
          left -= outer.offsetLeft;
          top -= outer.offsetTop;
          outer = outer.offsetParent instanceof HTMLElement ? outer.offsetParent : null;
        }
      }
      break;
    }
    current = parent;
  }
  return { left, top };
}

/// Se la tabella di `cells` celle può muoversi adesso.
export function motionAllowed(cells: number): boolean {
  return cells <= STILL_CELLS && motionLevel() !== "reduced";
}

/// Ciò che si legge prima del cambio, per animarlo dopo.
export interface ChangeSnapshot {
  readonly map: ChangeMap;
  readonly texts: readonly (readonly string[])[];
  readonly rowTops: readonly number[];
  readonly columnLefts: readonly number[];
  readonly ghosts: readonly Ghost[];
}

/// Legge la tabella di adesso (`cells`, coi testi `texts`) prima che diventi
/// `next`, e prepara le immagini delle celle che spariranno.
export function snapshotChange(
  grid: HTMLElement,
  cells: readonly (readonly HTMLElement[])[],
  texts: readonly (readonly string[])[],
  next: readonly (readonly string[])[],
): ChangeSnapshot {
  const map = changeMap(texts, next);
  const rowTops = cells.map((row) => (row[0] ? offsetWithin(row[0], grid).top : 0));
  const columnLefts = (cells[0] ?? []).map((cell) => offsetWithin(cell, grid).left);
  const keptRows = new Set(map.rows);
  const keptColumns = new Set(map.columns);
  const ghosts: Ghost[] = [];
  cells.forEach((row, r) => row.forEach((cell, c) => {
    if (ghosts.length >= GHOSTS_MAX || (keptRows.has(r) && keptColumns.has(c))) return;
    ghosts.push(prepareExit(cell));
  }));
  return { map, texts, rowTops, columnLefts, ghosts };
}

/// Dopo il cambio: chi c'era scivola dal suo posto di prima, chi è nuovo
/// entra (una riga da sopra, una colonna da sinistra), chi è tolto svanisce,
/// i valori cambiati compaiono a cascata. `layer` accoglie le celle tolte.
export function playChange(
  snapshot: ChangeSnapshot,
  grid: HTMLElement,
  cells: readonly (readonly HTMLElement[])[],
  texts: readonly (readonly string[])[],
  layer: HTMLElement,
): void {
  const { map } = snapshot;
  const rowTops = cells.map((row) => (row[0] ? offsetWithin(row[0], grid).top : 0));
  const columnLefts = (cells[0] ?? []).map((cell) => offsetWithin(cell, grid).left);
  let cascade = 0;
  cells.forEach((row, r) => row.forEach((cell, c) => {
    const oldRow = map.rows[r] ?? -1;
    const oldColumn = map.columns[c] ?? -1;
    if (oldRow < 0 || oldColumn < 0) {
      animate(cell, {
        from: { opacity: 0, ...(oldRow < 0 ? { y: -12 } : { x: -14 }) },
        duration: ROWS_MS,
        easing: EASE,
      });
      return;
    }
    const x = (snapshot.columnLefts[oldColumn] ?? 0) - (columnLefts[c] ?? 0);
    const y = (snapshot.rowTops[oldRow] ?? 0) - (rowTops[r] ?? 0);
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
      animate(cell, { from: { x, y }, duration: ROWS_MS, easing: EASE });
      return;
    }
    if (snapshot.texts[oldRow]?.[oldColumn] === texts[r]?.[c]) return;
    const content = cell.firstElementChild;
    if (!(content instanceof HTMLElement)) return;
    animate(content, {
      from: { opacity: 0, y: 5 },
      duration: VALUE_MS,
      delay: Math.min(cascade++, CASCADE_MAX) * CASCADE_MS,
      easing: EASE,
    });
  }));
  for (const ghost of snapshot.ghosts) ghost.play({ to: { opacity: 0, scale: 0.96 }, duration: REMOVE_MS, easing: "ease-out", layer });
}
