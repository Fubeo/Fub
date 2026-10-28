// La tavolozza dell'inchiostro: gli otto colori di Okabe–Ito, leggibili con
// le forme comuni di daltonismo, e i tre spessori. È di ogni superficie che
// raccoglie inchiostro — il disegno, la scheda «Disegna» dei documenti —, e
// per questo sta qui e non in un prodotto.
//
// Un campione si distingue per il suo nome, che il pozzo del colore scrive e
// lo screen reader dice, non per una forma: i campioni sono tutti tondi (il
// nome soddisfa WCAG 1.4.1). Giallo, Arancione e Azzurro sulla carta bianca
// stanno sotto il contrasto 3:1: la tavolozza li segna come chiari, perché un
// tratto in quei colori si legge poco.
//
// I nomi sono id: chi mostra un campione li traduce coi suoi testi.

/// Un colore della tavolozza.
export interface InkSwatch {
  readonly id: "black" | "blue" | "vermilion" | "green" | "purple" | "orange" | "sky" | "yellow";
  /// `#rrggbb` minuscolo, come lo scrive un file.
  readonly color: string;
  /// Sotto il contrasto 3:1 sulla carta bianca.
  readonly light: boolean;
}

/// Uno spessore della tavolozza.
export interface InkWidth {
  readonly id: "thin" | "medium" | "thick";
  readonly value: number;
}

export const INK_PALETTE: readonly InkSwatch[] = [
  { id: "black", color: "#000000", light: false },
  { id: "blue", color: "#0072b2", light: false },
  { id: "vermilion", color: "#d55e00", light: false },
  { id: "green", color: "#009e73", light: false },
  { id: "purple", color: "#cc79a7", light: false },
  { id: "orange", color: "#e69f00", light: true },
  { id: "sky", color: "#56b4e9", light: true },
  { id: "yellow", color: "#f0e442", light: true },
];

/// Gli spessori della penna: 2, 4 e 8.
export const INK_WIDTHS: readonly InkWidth[] = [
  { id: "thin", value: 2 },
  { id: "medium", value: 4 },
  { id: "thick", value: 8 },
];

/// Gli spessori dell'evidenziatore, con gli stessi nomi: un segno che copre
/// una riga di testo, da una sottile a una da titolo.
export const INK_HIGHLIGHTER_WIDTHS: readonly InkWidth[] = [
  { id: "thin", value: 8 },
  { id: "medium", value: 16 },
  { id: "thick", value: 24 },
];

/// La penna parte nera e media; l'evidenziatore giallo e medio.
export const INK_DEFAULT_COLOR = "#000000";
export const INK_DEFAULT_WIDTH = 4;
export const INK_HIGHLIGHTER_COLOR = "#f0e442";
export const INK_HIGHLIGHTER_WIDTH = 16;

/// Il campione di un colore, se è della tavolozza.
export function inkSwatchOf(color: string): InkSwatch | null {
  const lower = color.toLowerCase();
  return INK_PALETTE.find((swatch) => swatch.color === lower) ?? null;
}
