// Le matrici affini di SVG (formato della scena, §4 e §9).
//
// `[a b c d e f]` porta `(x, y)` in `(a·x + c·y + e, b·x + d·y + f)`, come
// `matrix(…)`. Le operazioni sono quelle di `fub-scene` (`geometry.rs`) nello
// stesso ordine: la stessa sequenza di moltiplicazioni e somme dà lo stesso
// double in Rust e in JavaScript, e il riepilogo arriva uguale al centesimo.

import { formatNumber } from "../number";

/// Una matrice affine `[a, b, c, d, e, f]`.
export type Matrix = readonly [number, number, number, number, number, number];

export type Point = readonly [number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/// `PI / 180` come lo calcola Rust in `f64::to_radians`: una costante sola,
/// non una divisione dopo il prodotto.
const DEGREE = Math.PI / 180;

/// I gradi in radianti, con la stessa moltiplicazione di `f64::to_radians`.
export function toRadians(degrees: number): number {
  return degrees * DEGREE;
}

export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

/// Una rotazione di `degrees` gradi, nel verso di SVG (orario sullo schermo).
export function rotate(degrees: number): Matrix {
  const radians = toRadians(degrees);
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

/// `outer` dopo `inner`: la matrice che applica prima `inner` e poi `outer`.
/// È l'ordine di una lista `transform`, dove la funzione più a destra agisce
/// per prima. In Rust si chiama `then`; qui no, perché un modulo che esporta
/// `then` è un thenable, e `await import()` lo chiamerebbe.
export function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

export function apply(m: Matrix, [x, y]: Point): Point {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

/// L'inversa di `m`, o `null` se `m` schiaccia il piano su una retta o su un
/// punto. Non ha un corrispondente in `fub-scene`: serve agli strumenti, che
/// portano i punti dello schermo dentro un livello o un gruppo.
export function invert(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0 || !Number.isFinite(det)) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/// L'ellisse di raggi `rx` e `ry`, ruotata di `degrees`, dopo la parte
/// lineare di `m`: i suoi raggi e la sua rotazione, dalla decomposizione ai
/// valori singolari di L · R(φ) · diag(rx, ry). Non ha un corrispondente in
/// `fub-scene`: serve agli strumenti che riscrivono le forme e ai calcoli
/// delle aree.
export function mappedEllipse(m: Matrix, rx: number, ry: number, degrees: number): { readonly radii: Point; readonly rotation: number } {
  const angle = toRadians(degrees);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [a, b, c, d] = m;
  // La matrice per righe: [[p, q], [r, s]].
  const p = (a * cos + c * sin) * rx;
  const q = (c * cos - a * sin) * ry;
  const r = (b * cos + d * sin) * rx;
  const s = (d * cos - b * sin) * ry;
  const e = (p + s) / 2;
  const f = (p - s) / 2;
  const g = (r + q) / 2;
  const h = (r - q) / 2;
  const outer = Math.hypot(e, h);
  const inner = Math.hypot(f, g);
  const radii: Point = [outer + inner, Math.abs(outer - inner)];
  // Un cerchio non ha rotazione; un'ellisse la ha fra 0 e 180 gradi.
  if (formatNumber(radii[0], 2) === formatNumber(radii[1], 2)) return { radii, rotation: 0 };
  const turned = (((Math.atan2(g, f) + Math.atan2(h, e)) / 2) * 180) / Math.PI;
  const rotation = ((turned % 180) + 180) % 180;
  return { radii, rotation: formatNumber(rotation, 2) === "180" ? 0 : rotation };
}
