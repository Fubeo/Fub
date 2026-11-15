// La somma come valore (Alt+=): i numeri scritti nelle celle sopra, letti
// all'italiana («1.240,50») o all'inglese («1,240.50»), e il totale scritto
// come li scrive la colonna. È un numero e basta: non si aggiorna da solo, e
// la Tabella lo dice una volta. Nel foglio Alt+= resta la formula di oggi.

/// Il segno dei decimali di una colonna.
export type DecimalMark = "," | ".";

/// Un numero letto da una cella, con ciò che serve a riscriverlo come lui.
interface Reading {
  readonly value: number;
  readonly places: number;
  readonly grouped: boolean;
}

const SIGN = /^([-+−]?)(.*)$/u;

/// Il segno dei decimali che `text` mostra senza dubbi, o `null`: «1.240» e
/// «1,240» possono essere mille e duecentoquaranta o un numero con tre
/// decimali, e lo decide il resto della colonna (o la lingua).
function markOf(text: string): DecimalMark | null {
  const body = text.trim().replace(SIGN, "$2");
  if (!/^\d[\d.,]*$/.test(body)) return null;
  const dot = body.lastIndexOf(".");
  const comma = body.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) return dot > comma ? "." : ",";
  const mark = dot >= 0 ? "." : comma >= 0 ? "," : null;
  if (!mark) return null;
  const parts = body.split(mark);
  // Lo stesso segno due volte separa le migliaia: i decimali sono l'altro.
  if (parts.length > 2) return mark === "." ? "," : ".";
  // Un segno solo: decimali, se non può separare le migliaia.
  if (parts[0]!.length > 3 || parts[0] === "0" || parts[1]!.length !== 3) return mark;
  return null;
}

/// Il numero che `text` dice col segno dei decimali `decimal` (le migliaia
/// con l'altro segno, a gruppi di tre), o `null` se non è soltanto un numero.
export function readNumber(text: string, decimal: DecimalMark): Reading | null {
  const match = SIGN.exec(text.trim())!;
  const body = match[2]!;
  const group = decimal === "," ? "." : ",";
  const [whole = "", fraction, extra] = body.split(decimal);
  if (extra !== undefined || whole === "") return null;
  if (fraction !== undefined && !/^\d+$/.test(fraction)) return null;
  const grouped = whole.includes(group);
  if (grouped ? !new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`).test(whole) : !/^\d+$/.test(whole)) return null;
  const value = Number(`${whole.split(group).join("")}.${fraction ?? "0"}`);
  if (!Number.isFinite(value)) return null;
  return { value: match[1] === "-" || match[1] === "−" ? -value : value, places: fraction?.length ?? 0, grouped };
}

/// Se `text` è un numero, all'italiana o all'inglese: il completamento non
/// propone i numeri.
export function isNumberText(text: string): boolean {
  return readNumber(text, ",") !== null || readNumber(text, ".") !== null;
}

/// Il segno dei decimali di una colonna: quello che i suoi valori mostrano
/// senza dubbi (il più frequente), altrimenti quello della lingua.
export function decimalMarkOf(texts: readonly string[], language: string): DecimalMark {
  let commas = 0;
  let dots = 0;
  for (const text of texts) {
    const mark = markOf(text);
    if (mark === ",") commas += 1;
    else if (mark === ".") dots += 1;
  }
  if (commas !== dots) return commas > dots ? "," : ".";
  return language.toLowerCase().startsWith("en") ? "." : ",";
}

/// La somma da scrivere sotto `above` (le celle sopra, dalla più vicina in
/// su): i numeri fino al primo valore che non lo è, come la somma automatica
/// dei fogli di calcolo. Il totale ha i decimali e il separatore delle
/// migliaia dei numeri sommati. `null` se subito sopra non ci sono numeri.
export function sumAbove(above: readonly string[], language: string): string | null {
  const decimal = decimalMarkOf(above, language);
  const readings: Reading[] = [];
  for (const text of above) {
    const reading = text.trim() === "" ? null : readNumber(text, decimal);
    if (!reading) break;
    readings.push(reading);
  }
  if (readings.length === 0) return null;
  const places = Math.max(...readings.map((reading) => reading.places));
  const total = readings.reduce((sum, reading) => sum + reading.value, 0);
  return writeNumber(total, places, decimal, readings.some((reading) => reading.grouped));
}

/// Un numero scritto col segno dei decimali `decimal`, `places` decimali e,
/// se `grouped`, le migliaia separate dall'altro segno.
export function writeNumber(value: number, places: number, decimal: DecimalMark, grouped: boolean): string {
  const fixed = Math.abs(value).toFixed(places);
  const [whole = "0", fraction] = fixed.split(".");
  const group = decimal === "," ? "." : ",";
  const digits = grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, group) : whole;
  const negative = value < 0 && Number(fixed) !== 0;
  return `${negative ? "-" : ""}${digits}${fraction !== undefined ? `${decimal}${fraction}` : ""}`;
}
