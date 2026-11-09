// Il dito sulla lavagna, la parte pura: la camera del pizzico e la soglia del
// tocco breve. Niente DOM: i punti sono in coordinate del viewport (pixel, con
// l'origine nel suo angolo in alto a sinistra), come la camera della lavagna.
//
// - **Il pizzico** si calcola sempre dalla camera e dalle dita di quando è
//   cominciato, non a passi: lo zoom è il rapporto fra la distanza delle dita
//   adesso e quella d'inizio, e il punto della lavagna che stava sotto il
//   centro delle dita resta sotto il loro centro di adesso. Così il pizzico
//   sposta e ingrandisce insieme, non scivola con gli arrotondamenti e, al
//   limite dello zoom, si ferma senza spostare la lavagna dalle dita.
// - **Il tocco breve** è un dito che si alza vicino a dove si è posato e
//   presto: fa quello che fa un clic. Oltre la soglia era uno spostamento.

/// La camera della lavagna: traslazione in pixel del viewport e zoom.
export interface TouchCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/// Un punto in coordinate del viewport.
export interface TouchPoint {
  readonly x: number;
  readonly y: number;
}

/// I limiti dello zoom della lavagna.
export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

/// Quanto si può muovere il dito, in pixel dello schermo, perché resti un
/// tocco breve.
export const TAP_SLOP_PX = 8;

/// Quanto può durare un tocco breve, in millisecondi: oltre è una pressione.
export const TAP_MAX_MS = 500;

/// La distanza più piccola fra due dita che si usa: due dita sullo stesso
/// punto non danno uno zoom infinito.
const MIN_SPAN_PX = 1;

/// La camera nuova di un pizzico: `start` è la camera quando il secondo
/// dito si è posato, `a0` e `b0` le due dita allora, `a1` e `b1` adesso.
export function pinchCamera(
  start: TouchCamera,
  a0: TouchPoint,
  b0: TouchPoint,
  a1: TouchPoint,
  b1: TouchPoint,
  limits: ZoomLimits,
): TouchCamera {
  const span0 = Math.max(MIN_SPAN_PX, Math.hypot(a0.x - b0.x, a0.y - b0.y));
  const span1 = Math.max(MIN_SPAN_PX, Math.hypot(a1.x - b1.x, a1.y - b1.y));
  const zoom = Math.min(limits.max, Math.max(limits.min, start.zoom * (span1 / span0)));
  // Il punto della lavagna sotto il centro di partenza resta sotto il centro di adesso.
  const worldX = ((a0.x + b0.x) / 2 - start.x) / start.zoom;
  const worldY = ((a0.y + b0.y) / 2 - start.y) / start.zoom;
  return {
    zoom,
    x: (a1.x + b1.x) / 2 - worldX * zoom,
    y: (a1.y + b1.y) / 2 - worldY * zoom,
  };
}

/// Un dito posato in `(x0, y0)` e alzato in `(x1, y1)` dopo `ms`
/// millisecondi è un tocco breve.
export function isTap(x0: number, y0: number, x1: number, y1: number, ms: number): boolean {
  return Math.hypot(x1 - x0, y1 - y0) <= TAP_SLOP_PX && ms <= TAP_MAX_MS;
}
