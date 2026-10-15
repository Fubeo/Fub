// Le curve a tempo, per ciò che non è una molla.
//
// Al motore arriva sempre una `cubic-bezier()`: le parole chiave si traducono
// e tutto il resto (`steps()`, `linear()`) ricade sulla curva di serie. La
// stessa cubica si valuta anche qui, perché una corsa interrotta deve sapere
// dov'era senza chiederlo al browser.

const NAMED: Record<string, readonly number[]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};
/// Decelerazione netta: parte subito, si posa piano.
const STANDARD: readonly number[] = [0.22, 1, 0.36, 1];
const BEZIER = /^cubic-bezier\(\s*([-+.\deE]+)\s*,\s*([-+.\deE]+)\s*,\s*([-+.\deE]+)\s*,\s*([-+.\deE]+)\s*\)$/;

export interface Curve {
  /// La forma da dare al motore.
  readonly css: string;
  /// L'avanzamento della posa per un avanzamento del tempo, entrambi in 0…1.
  at(progress: number): number;
}

/// Una coordinata della cubica con estremi 0 e 1 e punti di controllo `a`, `b`.
function axis(t: number, a: number, b: number): number {
  return (((1 + 3 * a - 3 * b) * t + (3 * b - 6 * a)) * t + 3 * a) * t;
}

export function curveOf(easing?: string): Curve {
  const text = easing?.trim() ?? "";
  const match = BEZIER.exec(text);
  let points = match ? match.slice(1).map(Number) : (NAMED[text] ?? STANDARD);
  const inside = (x: number) => x >= 0 && x <= 1;
  if (!points.every(Number.isFinite) || !inside(points[0]) || !inside(points[2])) points = STANDARD;
  const [x1, y1, x2, y2] = points;
  return {
    css: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
    at(progress) {
      if (progress <= 0) return 0;
      if (progress >= 1) return 1;
      // Con le ascisse dei controlli in 0…1 la x è monotona: basta bisecare.
      let low = 0;
      let high = 1;
      for (let step = 0; step < 24; step++) {
        const middle = (low + high) / 2;
        if (axis(middle, x1, x2) < progress) low = middle;
        else high = middle;
      }
      return axis((low + high) / 2, y1, y2);
    },
  };
}
