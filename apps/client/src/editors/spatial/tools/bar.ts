// Dove sta la barra della selezione (livello Standard): accanto a ciò che si
// è scelto, come la barra contestuale dei programmi di disegno, e non in
// cima al foglio, dove l'occhio e il puntatore devono andarla a cercare.
//
// - **Sotto la selezione**, al centro, oltre le maniglie e il loro margine:
//   la barra non copre mai una maniglia che si vede.
// - **Sopra, se sotto non c'è posto**; e se non c'è nemmeno sopra, perché la
//   selezione riempie la vista, in fondo a ciò che si vede, sopra di lei.
// - **Dentro ciò che si vede del foglio**, accanto ai righelli: una
//   selezione che esce dalla vista lascia la barra sul bordo più vicino.
// - **Senza una selezione da affiancare**, in cima al foglio, al centro.
//
// Tutto in pixel del foglio, dall'angolo in alto a sinistra.

/// Un riquadro sullo schermo.
export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/// La distanza della barra dal bordo di ciò che si vede, in pixel.
export const BAR_MARGIN_PX = 8;

/// La distanza della barra dalla selezione e dalle sue maniglie, in pixel.
export const BAR_GAP_PX = 12;

/// Dove va l'angolo in alto a sinistra della barra di misure `bar`, accanto
/// a `target`, il riquadro della selezione con le maniglie, dentro `area`.
/// `null` come `target` la mette in cima al centro.
export function barSpot(target: ScreenBox | null, bar: { readonly w: number; readonly h: number }, area: ScreenBox): { readonly x: number; readonly y: number } {
  const minX = area.x + BAR_MARGIN_PX;
  const maxX = Math.max(minX, area.x + area.w - BAR_MARGIN_PX - bar.w);
  const minY = area.y + BAR_MARGIN_PX;
  const maxY = Math.max(minY, area.y + area.h - BAR_MARGIN_PX - bar.h);
  const clamp = (value: number, min: number, max: number): number => Math.round(Math.min(max, Math.max(min, value)));
  if (target === null) return { x: clamp(area.x + (area.w - bar.w) / 2, minX, maxX), y: minY };
  const x = clamp(target.x + (target.w - bar.w) / 2, minX, maxX);
  const below = target.y + target.h + BAR_GAP_PX;
  if (below <= maxY) return { x, y: clamp(below, minY, maxY) };
  const above = target.y - BAR_GAP_PX - bar.h;
  if (above >= minY) return { x, y: clamp(above, minY, maxY) };
  return { x, y: maxY };
}
