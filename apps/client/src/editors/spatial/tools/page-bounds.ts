// La pagina come limite dei segni, sul foglio delle annotazioni di un PDF
// (`docs/product/pdf-annotations.md`): un segno nasce solo sulla pagina, e i
// punti di un gesto che ne esce si fermano al bordo. Il disegno libero non ha
// questo limite: lì la pagina si allarga.
//
// Tutto nelle coordinate della scena, quelle di `DrawSheet.page()`.

import type { Page } from "../painter/paint";
import type { Point } from "../scene/matrix";

/// Vero se `p` sta sulla pagina, bordo compreso.
export function onPage(page: Page, [x, y]: Point): boolean {
  return x >= page.x && x <= page.x + page.width && y >= page.y && y <= page.y + page.height;
}

/// Il punto della pagina più vicino a `p`: `p` stesso, se ci sta.
export function clampToPage(page: Page, [x, y]: Point): Point {
  return [Math.min(Math.max(x, page.x), page.x + page.width), Math.min(Math.max(y, page.y), page.y + page.height)];
}

/// Il punto da `from`, sulla pagina, verso `to` che si ferma al bordo: la
/// direzione resta, e la misura si accorcia quanto basta. Per una forma
/// tenuta diritta con Maiusc, che deve restare quadrata o a passi di 15°.
/// Con `from` fuori dalla pagina, il punto della pagina più vicino a `to`.
export function towardPage(page: Page, from: Point, to: Point): Point {
  if (onPage(page, to)) return to;
  if (!onPage(page, from)) return clampToPage(page, to);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  let reach = 1;
  // Di ogni lato superato, la frazione del cammino che lo raggiunge.
  if (dx > 0) reach = Math.min(reach, (page.x + page.width - from[0]) / dx);
  if (dx < 0) reach = Math.min(reach, (page.x - from[0]) / dx);
  if (dy > 0) reach = Math.min(reach, (page.y + page.height - from[1]) / dy);
  if (dy < 0) reach = Math.min(reach, (page.y - from[1]) / dy);
  // Gli arrotondamenti non portano fuori di un capello.
  return clampToPage(page, [from[0] + dx * reach, from[1] + dy * reach]);
}
