// L'ordinamento delle righe, uguale in ogni tabella: stabile, coi numeri
// prima del testo e le celle vuote sempre in fondo, il testo confrontato con
// la collazione della lingua e i numeri dentro il testo per valore («file 2»
// prima di «file 10»).

import { decimalMarkOf, readNumber } from "./sum";

/// I numeri che le celle `values` dicono, `null` dove una cella non dice
/// soltanto un numero. Si leggono come li legge la somma: col segno dei
/// decimali che la colonna mostra, altrimenti con quello di `language`, così
/// all'italiana «1.234» è milleduecentotrentaquattro. Un numero che si legge
/// soltanto con l'altro segno («3,5» in una colonna all'inglese) vale lo
/// stesso: la virgola e il punto decimali, e il meno anche tipografico (`−`).
export function columnNumbers(values: readonly string[], language: string): (number | null)[] {
  const decimal = decimalMarkOf(values, language);
  const other = decimal === "," ? "." : ",";
  return values.map((text) => (text.trim() === "" ? null : (readNumber(text, decimal) ?? readNumber(text, other))?.value ?? null));
}

/// L'ordine delle righe per i valori `values` (uno per riga): gli indici, in
/// ordine. `direction` 1 è crescente; le vuote restano in fondo anche al
/// contrario, e due uguali tengono l'ordine che avevano. `locale` confronta
/// il testo e legge i numeri che non dicono il loro segno dei decimali;
/// senza, vale la lingua del sistema.
export function sortOrder(values: readonly string[], direction: 1 | -1, locale?: string): number[] {
  const collator = new Intl.Collator(locale, { numeric: true });
  const numbers = columnNumbers(values, locale ?? collator.resolvedOptions().locale);
  const rank = (text: string, index: number): number => (text.trim() === "" ? 2 : numbers[index] === null ? 1 : 0);
  return values
    .map((text, index) => ({ text, index, rank: rank(text, index) }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank === 2 || b.rank === 2 ? a.rank - b.rank : direction * (a.rank - b.rank);
      const order = a.rank === 0 ? numbers[a.index]! - numbers[b.index]! : collator.compare(a.text, b.text);
      return direction * order || a.index - b.index;
    })
    .map(({ index }) => index);
}
