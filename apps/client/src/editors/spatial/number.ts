// I numeri che FubDraw scrive nei disegni (formato della scena, §5 e §7).
//
// Una regola sola per arrotondare, `floor(v × 10ⁿ + 0,5)`, la stessa in Rust e
// in TypeScript: la quantizzazione dell'inchiostro, le coordinate di `d` e le
// matrici passano tutte da qui. Moltiplicazione, somma e `floor` sono
// operazioni esatte o arrotondate correttamente in IEEE 754, quindi lo stesso
// numero dà lo stesso intero in ogni motore JavaScript e in Rust; non vale per
// `toFixed` o per `Math.round`, che non sono la regola della specifica.
//
// La scrittura parte dall'intero già arrotondato e ne compone le cifre: niente
// esponente, niente zeri finali, mai `-0`.

/// Le potenze di dieci come letterali: `10 ** n` passa da `Math.pow`, che la
/// specifica di ECMAScript lascia approssimare al motore.
const POWERS_OF_TEN = [1, 10, 100, 1_000, 10_000] as const;

/// Quanti decimali al più si possono chiedere: 4 è quello delle `matrix`.
export const MAX_DECIMALS = POWERS_OF_TEN.length - 1;

/// `floor(value × factor + 0,5)`: l'intero più vicino, con i mezzi verso
/// l'alto. Non restituisce mai `-0`.
export function roundHalfUp(value: number, factor: number): number {
  const rounded = Math.floor(value * factor + 0.5);
  return rounded === 0 ? 0 : rounded;
}

/// Il fattore di `decimals` decimali.
export function decimalFactor(decimals: number): number {
  const factor = POWERS_OF_TEN[decimals];
  if (factor === undefined) throw new RangeError(`decimali fuori dall'intervallo 0…${MAX_DECIMALS}: ${decimals}`);
  return factor;
}

/// Scrive un intero di unità da 10⁻ⁿ (`decimals` = n) come numero decimale:
/// `formatScaled(12050, 2)` è `120.5`, `formatScaled(-3, 2)` è `-0.03`.
export function formatScaled(units: number, decimals: number): string {
  decimalFactor(decimals);
  if (!Number.isInteger(units)) throw new RangeError(`non è un intero finito: ${units}`);
  if (units === 0) return "0";
  const negative = units < 0;
  const magnitude = negative ? -units : units;
  // `String` scrive ogni intero sotto 10²¹ con tutte le cifre; oltre passa
  // all'esponente, e lì le cifre esatte del double le dà `BigInt`.
  let digits = magnitude < 1e21 ? String(magnitude) : BigInt(magnitude).toString();
  if (decimals > 0) {
    digits = digits.padStart(decimals + 1, "0");
    const cut = digits.length - decimals;
    let end = digits.length;
    while (end > cut && digits.charCodeAt(end - 1) === 48) end--;
    digits = end > cut ? `${digits.slice(0, cut)}.${digits.slice(cut, end)}` : digits.slice(0, cut);
  }
  return negative ? `-${digits}` : digits;
}

/// Un numero canonico con al più `decimals` decimali (§7, punto 3).
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`numero non finito: ${value}`);
  return formatScaled(roundHalfUp(value, decimalFactor(decimals)), decimals);
}

/// Il numero più corto che si rilegge identico, senza esponente: per i valori
/// che non sono geometria e non si arrotondano, come le chiavi di `fub:brush`.
/// È la scrittura di `String`, che ECMAScript fissa cifra per cifra, con
/// l'esponente sciolto in zeri.
export function formatShortest(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`numero non finito: ${value}`);
  if (value === 0) return "0";
  const text = String(value);
  const e = text.indexOf("e");
  if (e < 0) return text;
  const negative = text.startsWith("-");
  const mantissa = text.slice(negative ? 1 : 0, e);
  const exponent = Number(text.slice(e + 1));
  const point = mantissa.indexOf(".");
  const digits = point < 0 ? mantissa : mantissa.slice(0, point) + mantissa.slice(point + 1);
  // Dove cade la virgola nelle cifre, contando da sinistra.
  const integerDigits = (point < 0 ? mantissa.length : point) + exponent;
  let plain: string;
  if (integerDigits <= 0) plain = `0.${"0".repeat(-integerDigits)}${digits}`;
  else if (integerDigits >= digits.length) plain = digits + "0".repeat(integerDigits - digits.length);
  else plain = `${digits.slice(0, integerDigits)}.${digits.slice(integerDigits)}`;
  return negative ? `-${plain}` : plain;
}
