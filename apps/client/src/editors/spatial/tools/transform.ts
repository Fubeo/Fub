// Le trasformazioni numeriche del livello Esperto: «Trasforma» ruota, scala
// e inclina gli oggetti scelti di quanto si scrive, attorno al centro del
// loro riquadro, in un passo solo.
//
// - **Cambia solo `transform`**, come spostare e ridimensionare: la
//   geometria resta com'è scritta, e il contorno si trasforma con l'oggetto.
//   La selezione si trasforma come un insieme, e ogni oggetto riceve la
//   stessa trasformazione della scena, composta con quella che aveva.
// - **L'ordine è fisso:** prima la scala, poi l'inclinazione orizzontale, poi
//   quella verticale, infine la rotazione.
// - **I gradi vanno in senso orario**, come `rotate()` di SVG e come si vede
//   sullo schermo, dove l'asse y scende. Una scala negativa rispecchia.
// - **Niente che il file non sappia scrivere.** `matrix()` ha quattro
//   decimali (formato della scena, §7): una trasformazione che, scritta,
//   deformerebbe un oggetto di più dell'uno per cento non parte.

import { formatNumber } from "../number";
import { BoundsBuilder, type Bounds } from "../scene/geometry";
import { compose, rotate, toRadians, translate, type Matrix, type Point } from "../scene/matrix";
import type { Op } from "../scene/ops";
import { transformedMatrix, transformValue, type Moved, type NewIds } from "./edit";
import type { Unit } from "./hit";

/// Le scelte di «Trasforma».
export interface NumericTransform {
  /// Gradi, in senso orario.
  readonly rotate: number;
  /// Fattori: 1 lascia com'è, -1 rispecchia, 0 non si può.
  readonly scaleX: number;
  readonly scaleY: number;
  /// Gradi, fra -90 e 90 esclusi.
  readonly skewX: number;
  readonly skewY: number;
}

/// La trasformazione che non cambia niente: i valori con cui si apre la
/// finestra.
export const UNCHANGED: NumericTransform = { rotate: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };

/// I limiti dei campi di «Trasforma»: una scala fino a mille volte, in
/// percentuale, e un'inclinazione che non arriva all'angolo retto, dove non
/// ha misura.
export const MAX_SCALE_PERCENT = 100_000;
export const MAX_SKEW = 89;

/// La matrice della scena di `transform` attorno a `center`.
export function numericMatrix(transform: NumericTransform, center: Point): Matrix {
  const scale: Matrix = [transform.scaleX, 0, 0, transform.scaleY, 0, 0];
  const skewX: Matrix = [1, 0, Math.tan(toRadians(transform.skewX)), 1, 0, 0];
  const skewY: Matrix = [1, Math.tan(toRadians(transform.skewY)), 0, 1, 0, 0];
  const linear = compose(rotate(transform.rotate), compose(skewY, compose(skewX, scale)));
  return compose(translate(center[0], center[1]), compose(linear, translate(-center[0], -center[1])));
}

/// Vero se `m`, scritta con quattro decimali, deforma ciò che trasforma di
/// al più l'uno per cento in ogni direzione. L'errore dell'arrotondamento,
/// rispetto al valore singolare più piccolo di `m`, stimato per eccesso: un
/// oggetto che `m` rimpicciolisce troppo non ha cifre per restare sé stesso.
export function writable(m: Matrix): boolean {
  if (!m.every((value) => Number.isFinite(value))) return false;
  const [a, b, c, d] = m;
  const det = Math.abs(a * d - b * c);
  const error = Math.hypot(...[a, b, c, d].map((value) => Number(formatNumber(value, 4)) - value));
  return det > 0 && error * Math.hypot(a, b, c, d) <= 0.01 * det;
}

/// Un cambio pronto, e quanti oggetti cambia.
export interface Transformed extends Moved {
  readonly changed: number;
}

/// Le operazioni che applicano `m`, una trasformazione della scena, a
/// `units`. Un oggetto che resterebbe scritto com'è non cambia, e uno senza
/// id ne riceve uno. `null` se il file non saprebbe scrivere un oggetto
/// trasformato.
export function numericOps(units: readonly Unit[], m: Matrix, ids: NewIds): Transformed | null {
  const ops: Op[] = [];
  const keys: string[] = [];
  for (const unit of units) {
    // Un genitore che schiaccia il piano non lascia trasformare: l'oggetto
    // resta com'è, e scelto.
    const next = transformedMatrix(unit, m);
    if (next === null) {
      keys.push(unit.key);
      continue;
    }
    if (!writable(next)) return null;
    const value = transformValue(next);
    if (value === transformValue(unit.transform)) {
      keys.push(unit.key);
      continue;
    }
    let id = unit.id;
    if (id === null) {
      id = ids.next("object");
      ops.push({ op: "ident", path: unit.path, tag: unit.tag, id });
    }
    ops.push({ op: "set", id, attrs: { transform: value } });
    keys.push(id);
  }
  return { ops, keys, changed: ops.filter((op) => op.op === "set").length };
}

/// Dove finiscono `units` dopo `m`, contorno compreso: la pagina cresce se
/// ne escono.
export function boundsAfter(units: readonly Unit[], m: Matrix): Bounds | null {
  const out = new BoundsBuilder();
  for (const unit of units) {
    const bounds = unit.boundsAfter(m);
    if (bounds === null) continue;
    out.include(bounds.min);
    out.include(bounds.max);
  }
  return out.finish();
}
