// Il lazo della lavagna (T86, E2 di `lavagna.md`): un giro a mano libera, in
// coordinate della lavagna, che sceglie schede e tratti.
//
// - **Il giro** si chiude da solo: l'ultimo punto torna al primo. Dentro e
//   fuori seguono la regola pari-dispari, così un giro che si incrocia (un
//   otto) sceglie ciò che sta in ognuno dei suoi anelli.
// - **Una scheda** è dentro se il suo rettangolo è tutto dentro: i quattro
//   angoli dentro e nessun lato del giro che lo attraversa (un giro a U
//   intorno a una scheda ne ha gli angoli dentro ma non il mezzo).
// - **Un tratto** è dentro se lo sono tutti i suoi punti.
// - **Un giro senza area** (meno di tre punti, o un riquadro sotto
//   `LASSO_MIN_AREA`) non sceglie niente: è un clic, non un lazo. Conta il
//   riquadro e non l'area racchiusa, che in un otto si annulla.
//
// Pura: niente DOM. Il lazo del disegno (`editors/spatial/tools/hit/`) non è
// esportato (A-27): qui c'è la stessa geometria, per la lavagna.

/// Un punto del giro, in coordinate della lavagna.
export interface LassoPoint {
  readonly x: number;
  readonly y: number;
}

/// Un rettangolo in coordinate della lavagna, come una scheda.
export interface LassoBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Sotto quest'area del riquadro (in unità della lavagna al quadrato) il giro
/// non sceglie.
export const LASSO_MIN_AREA = 4;

/// Due punti del giro più vicini di così (in unità della lavagna) sono uno:
/// il giro resta corto anche se il puntatore manda un evento per pixel.
export const LASSO_MIN_STEP = 1;

/// Un giro chiuso, con il suo riquadro già calcolato.
export class Lasso {
  readonly #xs: Float64Array;
  readonly #ys: Float64Array;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;

  constructor(points: readonly LassoPoint[]) {
    const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    this.#xs = Float64Array.from(finite, (point) => point.x);
    this.#ys = Float64Array.from(finite, (point) => point.y);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { x, y } of finite) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /// I punti del giro.
  get size(): number {
    return this.#xs.length;
  }

  /// Il giro sceglie qualcosa: ha almeno tre punti e un riquadro.
  get closed(): boolean {
    return this.#xs.length >= 3 && (this.maxX - this.minX) * (this.maxY - this.minY) >= LASSO_MIN_AREA;
  }

  /// Il punto `(x, y)` è dentro il giro (pari-dispari).
  contains(x: number, y: number): boolean {
    if (!this.closed || x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) return false;
    const xs = this.#xs;
    const ys = this.#ys;
    const n = xs.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = ys[i]!;
      const yj = ys[j]!;
      if ((yi > y) !== (yj > y)) {
        const cross = xs[i]! + ((y - yi) * (xs[j]! - xs[i]!)) / (yj - yi);
        if (x < cross) inside = !inside;
      }
    }
    return inside;
  }

  /// Il rettangolo `box` è tutto dentro il giro.
  containsBox(box: LassoBox): boolean {
    const { x, y, width, height } = box;
    if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return false;
    const right = x + width;
    const bottom = y + height;
    if (x < this.minX || right > this.maxX || y < this.minY || bottom > this.maxY) return false;
    if (!this.contains(x, y) || !this.contains(right, y) || !this.contains(right, bottom) || !this.contains(x, bottom)) {
      return false;
    }
    // Gli angoli dentro non bastano: un lato del giro può entrare nel
    // rettangolo e uscirne.
    const xs = this.#xs;
    const ys = this.#ys;
    const n = xs.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if (segmentHitsBox(xs[j]!, ys[j]!, xs[i]!, ys[i]!, x, y, right, bottom)) return false;
    }
    return true;
  }

  /// I punti `points` (`x` e `y` alternati) sono tutti dentro il giro.
  /// Una lista senza punti non è dentro.
  containsPoints(points: readonly number[]): boolean {
    if (points.length < 2) return false;
    for (let i = 0; i + 1 < points.length; i += 2) {
      if (!this.contains(points[i]!, points[i + 1]!)) return false;
    }
    return true;
  }
}

/// Il segmento `(ax, ay)`–`(bx, by)` tocca l'interno del rettangolo
/// `[left, right] × [top, bottom]`: ci passa dentro o lo attraversa.
function segmentHitsBox(
  ax: number, ay: number, bx: number, by: number,
  left: number, top: number, right: number, bottom: number,
): boolean {
  // Liang-Barsky: il pezzo del segmento dentro il rettangolo chiuso.
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, ax - left],
    [dx, right - ax],
    [-dy, ay - top],
    [dy, bottom - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  if (t0 > t1) return false;
  // Il pezzo dentro deve avere un punto che non sta sul bordo.
  const mx = ax + dx * ((t0 + t1) / 2);
  const my = ay + dy * ((t0 + t1) / 2);
  return mx > left && mx < right && my > top && my < bottom;
}

/// Aggiunge il punto `point` al giro `points`, se si è allontanato di almeno
/// `LASSO_MIN_STEP` dall'ultimo: `true` se l'ha aggiunto.
export function extendLasso(points: LassoPoint[], point: LassoPoint, step = LASSO_MIN_STEP): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < step) return false;
  points.push({ x: point.x, y: point.y });
  return true;
}

/// Il giro come percorso SVG chiuso, in coordinate della lavagna; vuoto
/// senza punti.
export function lassoPath(points: readonly LassoPoint[]): string {
  if (points.length === 0) return "";
  const round = (value: number): string => String(Math.round(value * 100) / 100);
  let d = `M${round(points[0]!.x)} ${round(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) d += `L${round(points[i]!.x)} ${round(points[i]!.y)}`;
  return `${d}Z`;
}
