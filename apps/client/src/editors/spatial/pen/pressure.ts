// La curva della pressione: come la forza della mano diventa la pressione
// dei campioni, e così lo spessore del tratto.
//
// Ogni penna e ogni mano premono a modo loro: c'è chi preme leggero e vuole
// lo stesso il tratto pieno, e chi preme forte e vuole le sfumature. La curva
// ha tre manopole, come i pannelli delle tavolette:
//
// - **la morbidezza** (`soft`, da −1 a 1): sopra lo zero una pressione
//   leggera dà già molto, sotto ne serve di più. È l'esponente della curva,
//   da 3 (dura) a ⅓ (morbida);
// - **il minimo** (`min`, da 0 a 0,5): la pressione che anche il tocco più
//   leggero dà, perché un tratto leggero non sparisca;
// - **il pieno** (`full`, da 0,5 a 1): da dove la penna dà già tutto, per
//   chi non vuole premere fino in fondo.
//
// La curva vale solo per la penna, l'unica che misura la pressione; il file
// tiene la pressione già curvata, quella che si vede. È della macchina e non
// del documento: ogni tavoletta ha la sua.

/// La curva della pressione della penna.
export interface PenCurve {
  /// La morbidezza, da −1 (dura) a 1 (morbida).
  readonly soft: number;
  /// La pressione più leggera, da 0 a [`MAX_MIN`].
  readonly min: number;
  /// La pressione da cui il tratto è pieno, da [`MIN_FULL`] a 1.
  readonly full: number;
}

/// Il minimo più alto: oltre, la penna non avrebbe più sfumature.
export const MAX_MIN = 0.5;

/// Il pieno più basso: sotto, mezza corsa darebbe già tutto.
export const MIN_FULL = 0.5;

/// La curva di serie, la diagonale: la pressione come la penna la dà.
export const DEFAULT_CURVE: PenCurve = { soft: 0, min: 0, full: 1 };

/// `value` come curva, se lo è: tre numeri nei loro intervalli.
export function validCurve(value: unknown): PenCurve | null {
  if (typeof value !== "object" || value === null) return null;
  const { soft, min, full } = value as Record<string, unknown>;
  const within = (n: unknown, lo: number, hi: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
  if (!within(soft, -1, 1) || !within(min, 0, MAX_MIN) || !within(full, MIN_FULL, 1)) return null;
  return { soft, min, full };
}

/// Vero se le curve `a` e `b` sono la stessa.
export function sameCurve(a: PenCurve, b: PenCurve): boolean {
  return a.soft === b.soft && a.min === b.min && a.full === b.full;
}

/// Vero se `curve` lascia la pressione com'è.
export function isDefaultCurve(curve: PenCurve): boolean {
  return sameCurve(curve, DEFAULT_CURVE);
}

/// La funzione della curva, da una pressione da 0 a 1 a una da 0 a 1. Cresce
/// sempre: premere di più non dà mai meno.
export function pressureCurve(curve: PenCurve): (pressure: number) => number {
  const power = 3 ** -curve.soft;
  const { min, full } = curve;
  return (pressure) => {
    const p = Math.min(Math.max(pressure / full, 0), 1);
    return min + (1 - min) * p ** power;
  };
}

/// Il disegno della curva in un riquadro di `width` per `height`, la
/// pressione della penna da sinistra a destra e quella del tratto dal basso
/// in alto: il `d` di un tracciato.
export function curvePath(curve: PenCurve, width: number, height: number, samples = 48): string {
  const apply = pressureCurve(curve);
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = i / samples;
    const x = Math.round(p * width * 100) / 100;
    const y = Math.round((1 - apply(p)) * height * 100) / 100;
    points.push(`${i === 0 ? "M" : "L"}${x} ${y}`);
  }
  return points.join("");
}
