// L'uguaglianza di due valori **come JSON**, senza scriverli.
//
// Il riconciliatore delle view (`ui/node.ts`) e l'editor ricco
// (`editors/rich/commands.ts`) chiedevano «è lo stesso dato?» con
// `JSON.stringify(a) === JSON.stringify(b)`: due stringhe grandi quanto il
// payload a ogni render, per ogni widget e per ogni paragrafo scelto. Questa
// funzione risponde la stessa cosa camminando i due valori insieme: si ferma
// alla prima differenza, e due riferimenti uguali non si guardano dentro.
//
// **La semantica è quella di `JSON.stringify`, caso per caso** (i test in
// `json-equal.test.ts` la tengono ferma con una tabella):
//
// - `NaN`, `Infinity` e `-Infinity` valgono `null`; `-0` vale `0`.
// - In un oggetto una chiave con `undefined`, una funzione o un simbolo non
//   c'è: `{ a: undefined }` è uguale a `{}`. In un array quei valori, e i
//   buchi, valgono `null`.
// - In cima `undefined` (o una funzione, o un simbolo) non è `null`: lì
//   `JSON.stringify` non scrive niente, e niente è diverso da `"null"`.
// - **L'ordine delle chiavi conta**: `{ a, b }` e `{ b, a }` si scrivono
//   diversi, e un widget che legge le chiavi in ordine li disegna diversi.
// - Un array non è mai un oggetto, neanche vuoto; delle sue proprietà
//   contano solo gli indici.
// - `Map` e `Set` valgono `{}`; `Number`, `String` e `Boolean` incartati
//   valgono il loro primitivo; chi ha `toJSON` (una `Date`) vale ciò che
//   `toJSON` restituisce, chiamato con la sua chiave come fa `JSON.stringify`.
//
// Ciò su cui `JSON.stringify` lancia (un ciclo, un `BigInt`) resta fuori dal
// contratto: i dati che arrivano dal kernel sono JSON per costruzione.

/// `true` se `JSON.stringify(a) === JSON.stringify(b)`, senza costruire le
/// due stringhe.
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const left = resolve(a, "");
  const right = resolve(b, "");
  const missingA = isMissing(left);
  const missingB = isMissing(right);
  if (missingA || missingB) return missingA && missingB;
  return sameValue(left, right);
}

/// Il valore dopo `toJSON`, chiamato come lo chiama `JSON.stringify`: con la
/// chiave (o l'indice, in stringa) sotto cui sta. Il risultato non si
/// risolve di nuovo.
function resolve(value: unknown, key: string | number): unknown {
  if (typeof value !== "object" || value === null) return value;
  const toJson = (value as { toJSON?: unknown }).toJSON;
  return typeof toJson === "function" ? (toJson as (key: string) => unknown).call(value, String(key)) : value;
}

/// I valori che `JSON.stringify` salta in un oggetto e scrive `null` in un
/// array.
function isMissing(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

/// Due valori presenti (non mancanti, già passati da `toJSON`) che si
/// scrivono uguali.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const left = primitive(a);
  const right = primitive(b);
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  const arrayLeft = Array.isArray(left);
  if (arrayLeft !== Array.isArray(right)) return false;
  return arrayLeft ? sameArray(left as unknown[], right as unknown[]) : sameObject(left, right);
}

/// Il valore come lo vede `JSON.stringify` prima di guardarci dentro: i
/// numeri non finiti sono `null`, gli incarti sono il loro primitivo.
function primitive(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  if (value instanceof Number) return primitive(Number(value));
  if (value instanceof String) return String(value);
  if (value instanceof Boolean) return value.valueOf();
  return value;
}

function sameArray(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const x = resolve(a[i], i);
    const y = resolve(b[i], i);
    if (!sameValue(isMissing(x) ? null : x, isMissing(y) ? null : y)) return false;
  }
  return true;
}

/// Le chiavi proprie enumerabili, nell'ordine di `Object.keys` (quello di
/// `JSON.stringify`), saltando quelle con un valore mancante. Le due liste di
/// chiavi sono le sole cose che il confronto alloca.
function sameObject(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keysA = Object.keys(left);
  const keysB = Object.keys(right);
  let i = 0;
  let j = 0;
  for (;;) {
    let x: unknown;
    let y: unknown;
    while (i < keysA.length && isMissing((x = resolve(left[keysA[i]!], keysA[i]!)))) i++;
    while (j < keysB.length && isMissing((y = resolve(right[keysB[j]!], keysB[j]!)))) j++;
    if (i === keysA.length || j === keysB.length) return i === keysA.length && j === keysB.length;
    if (keysA[i] !== keysB[j]) return false;
    if (!sameValue(x, y)) return false;
    i++;
    j++;
  }
}
