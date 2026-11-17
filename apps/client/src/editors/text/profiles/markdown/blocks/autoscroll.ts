// Lo scorrimento al bordo (E2, «Lo scorrimento»): con un blocco in mano, la
// pagina scorre soltanto quando la si chiede, portando il puntatore entro
// 72 px dal bordo alto o basso del foglio. La velocità cresce col quadrato
// della profondità fino a circa 800 px/s, e la si raggiunge in mezzo secondo:
// sfiorare il bordo non fa partire la pagina. Senza DOM: chi la usa dà il
// puntatore, i bordi e il tempo, e riceve i px interi da scorrere.

/// La fascia del bordo (px).
export const EDGE_PX = 72;
/// La velocità più alta (px/s), in fondo alla fascia o oltre.
export const TOP_SPEED = 800;
/// Il tempo (ms) per arrivare alla velocità piena dopo essere entrati nella fascia.
export const RAMP_MS = 500;

/// Quanto (px, col segno) il puntatore sta dentro la fascia: negativo in
/// alto, positivo in basso, 0 fuori; oltre il bordo vale la fascia intera.
/// Su un foglio basso la fascia si stringe a un terzo dell'altezza, così il
/// mezzo del foglio non scorre mai.
export function edgeDepth(y: number, top: number, bottom: number, edge = EDGE_PX): number {
  const height = bottom - top;
  if (!(height > 0)) return 0;
  const band = Math.min(edge, height / 3);
  if (y < top + band) return -Math.min(band, top + band - y) * (edge / band);
  if (y > bottom - band) return Math.min(band, y - (bottom - band)) * (edge / band);
  return 0;
}

/// La velocità (px/s, col segno) a una profondità: il quadrato della
/// frazione di fascia, fino al tetto.
export function edgeSpeed(depth: number, edge = EDGE_PX): number {
  const f = Math.min(1, Math.abs(depth) / edge);
  return Math.sign(depth) * TOP_SPEED * f * f;
}

export interface EdgeScroll {
  /// Un fotogramma di `elapsed` ms con il puntatore a `depth`: i px interi da
  /// scorrere adesso (il resto si tiene per il prossimo).
  step(depth: number, elapsed: number): number;
  /// Fuori dalla fascia: la rampa e il resto ripartono da zero.
  reset(): void;
}

/// Lo stato dello scorrimento di un gesto: da quanto si è nella fascia e i
/// decimali non ancora scorsi.
export function edgeScroll(): EdgeScroll {
  let held = 0;
  let carry = 0;
  let side = 0;
  const reset = (): void => {
    held = 0;
    carry = 0;
    side = 0;
  };
  return {
    reset,
    step(depth, elapsed) {
      const now = Math.sign(depth);
      if (now === 0 || now !== side) reset();
      if (now === 0) return 0;
      side = now;
      const dt = Math.max(0, elapsed);
      // La rampa a metà del passo: la velocità media del fotogramma.
      const ramp = Math.min(1, (held + dt / 2) / RAMP_MS);
      held += dt;
      carry += (edgeSpeed(depth) * ramp * dt) / 1000;
      const whole = Math.trunc(carry);
      carry -= whole;
      return whole;
    },
  };
}
