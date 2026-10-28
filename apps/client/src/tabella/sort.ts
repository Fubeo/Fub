// L'ordinamento delle righe, uguale in ogni tabella: stabile, coi numeri
// prima del testo e le celle vuote sempre in fondo, il testo confrontato con
// la collazione della lingua e i numeri dentro il testo per valore («file 2»
// prima di «file 10»).

/// Il numero che una cella dice, se dice soltanto un numero: con la virgola
/// o col punto decimale, e il meno anche tipografico (`−`).
export function cellNumber(text: string): number | null {
  const match = /^([-+−]?)(\d+)(?:[.,](\d+))?$/u.exec(text.trim());
  if (!match) return null;
  const value = Number(`${match[2]}.${match[3] ?? "0"}`);
  return match[1] === "-" || match[1] === "−" ? -value : value;
}

/// L'ordine delle righe per i valori `values` (uno per riga): gli indici, in
/// ordine. `direction` 1 è crescente; le vuote restano in fondo anche al
/// contrario, e due uguali tengono l'ordine che avevano.
export function sortOrder(values: readonly string[], direction: 1 | -1, locale?: string): number[] {
  const collator = new Intl.Collator(locale, { numeric: true });
  const rank = (text: string): number => (text.trim() === "" ? 2 : cellNumber(text) === null ? 1 : 0);
  return values
    .map((text, index) => ({ text, index, rank: rank(text) }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank === 2 || b.rank === 2 ? a.rank - b.rank : direction * (a.rank - b.rank);
      const order = a.rank === 0 ? cellNumber(a.text)! - cellNumber(b.text)! : collator.compare(a.text, b.text);
      return direction * order || a.index - b.index;
    })
    .map(({ index }) => index);
}
