// La finestra di righe di una tabella a righe tutte alte uguali, con lo stesso
// margine della griglia (`GRID_OVERSCAN`). Sta qui, fuori dal motore della
// griglia, perché le tabelle delle Basi sono del nucleo e la griglia è di un
// componente (K2): chi disegna una Base non deve portarsi dietro le cartelle.

/// Le righe disegnate oltre quelle visibili, sopra e sotto.
export const GRID_OVERSCAN = 2;

/** Shared, read-only fixed-row window for query-backed tables. It reuses the
 * Grid overscan geometry but never opens a mutative workbook session. */
export function uniformRowRange(total: number, scrollTop: number, viewportHeight: number, rowHeight: number): { start: number; end: number } | null {
  if (total <= 0) return null;
  const offset = Math.max(0, scrollTop);
  const extent = Math.max(1, viewportHeight);
  const first = Math.floor(offset / rowHeight);
  const last = Math.floor((offset + extent) / rowHeight);
  return {
    start: Math.max(0, Math.min(total - 1, first - GRID_OVERSCAN)),
    end: Math.max(0, Math.min(total - 1, last + GRID_OVERSCAN)),
  };
}
