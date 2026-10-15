// Il testo del disegno (livello Standard): le righe come le scrive chi
// disegna, l'elemento che le porta nel file, e il carattere con cui l'editor
// le mostra.
//
// - **Una riga, un `tspan`** (formato della scena, §4). Il `text` porta il
//   punto d'ancoraggio, il colore, il carattere e il corpo; ogni riga è un
//   `tspan` con `x` e `dy`, la prima a `dy="0"` e le altre un'interlinea più
//   giù, [`LINE_SPACING`] volte il corpo, quella che l'operazione `text` dà a
//   una riga nuova.
// - **Le righe vuote.** Un `tspan` vuoto non sposterebbe la riga dopo: una
//   riga vuota fra due scritte si scrive come uno spazio indivisibile, e si
//   rilegge vuota. Le righe vuote in testa e in coda non si scrivono, e un
//   testo senza niente da leggere non c'è.
// - **Gli spazi come li mostra SVG.** Spazi e tabulazioni in fila valgono uno
//   spazio, e ai bordi di una riga niente: il file scrive ciò che si vede, e
//   chi lo riapre trova ciò che ha visto.
// - **Solo ciò che XML ammette.** I caratteri di controllo e i surrogati
//   spaiati di un testo incollato restano fuori: il file resta ben formato.
// - **Il carattere** è Inter, quello dell'interfaccia, col ripiego generico;
//   dalle proprietà (livello Standard) e dagli attributi anche Literata o
//   JetBrains Mono, gli altri due che il file scrive. L'editor li registra coi nomi che il file scrive, dai file
//   che l'app porta già, così il foglio mostra il testo come lo esporta
//   l'export. Dentro un `<img>`, come in Lettura, vale il ripiego.

import { formatNumber } from "../number";
import type { Point } from "../scene/matrix";
import type { TextLine } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import type { Width } from "./palette";

/// Il carattere di un testo nuovo, come lo scrive il file.
export const TEXT_FAMILY = "Inter, sans-serif";

/// I caratteri che il file scrive (formato della scena, §4): quelli che Fub
/// distribuisce, ciascuno col suo ripiego generico.
export const TEXT_FAMILIES: readonly string[] = [TEXT_FAMILY, "Literata, serif", "JetBrains Mono, monospace"];

/// Le dimensioni di un testo nuovo, come gli spessori: tre, coi loro nomi,
/// in unità della scena.
export const TEXT_SIZES: readonly Width[] = [
  { id: "small", value: 24, label: "draw.size.small" },
  { id: "medium", value: 32, label: "draw.size.medium" },
  { id: "large", value: 48, label: "draw.size.large" },
];

/// La dimensione di partenza: Medio, quella dell'esempio del formato.
export const TEXT_SIZE = 32;

/// L'interlinea, in volte il corpo.
export const LINE_SPACING = 1.25;

/// Come si scrive una riga vuota fra due scritte.
export const BLANK_LINE = "\u00a0";

/// Ciò che XML 1.0 non ammette in un testo: i caratteri di controllo tranne
/// tabulazione e a capo, U+FFFE e U+FFFF, i surrogati spaiati.
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/// `text` senza ciò che XML non ammette.
export const xmlText = (text: string): string => text.replace(NOT_XML, "");

/// Vero se `line` non ha niente da leggere.
const blank = (line: string): boolean => line.trim() === "";

/// Le righe di `input`, il testo scritto da chi disegna, come le scrive il
/// file. Vuote se non c'è niente da leggere.
export function textLines(input: string): string[] {
  const lines = input
    .replace(NOT_XML, "")
    .split(/\r\n|[\r\n\u2028\u2029]/)
    .map((line) => line.replace(/[ \t]+/g, " ").replace(/^ | $/g, ""));
  let first = 0;
  let last = lines.length;
  while (first < last && blank(lines[first]!)) first++;
  while (last > first && blank(lines[last - 1]!)) last--;
  return lines.slice(first, last).map((line) => (blank(line) ? BLANK_LINE : line));
}

/// Il testo da modificare per le righe `lines` di un `text`: una riga che
/// non ha niente da leggere si rilegge vuota.
export function editableText(lines: readonly string[]): string {
  return lines.map((line) => (blank(line) ? "" : line)).join("\n");
}

/// Il colore e il corpo di un testo nuovo.
export interface TextStyle {
  /// `#rrggbb`.
  readonly color: string;
  /// `font-size`, in unità della scena.
  readonly size: number;
}

/// L'elemento di un testo nuovo con le righe `lines`, ancorato in `at` nelle
/// coordinate del livello che lo riceve: la linea di base della prima riga
/// comincia lì.
export function textElem(id: string, at: Point, lines: readonly TextLine[], style: TextStyle): Elem {
  const x = formatNumber(at[0], 2);
  const spacing = formatNumber(style.size * LINE_SPACING, 2);
  return {
    tag: "text",
    attrs: { id, x, y: formatNumber(at[1], 2), fill: style.color, "font-family": TEXT_FAMILY, "font-size": formatNumber(style.size, 2) },
    children: lines.map((line, i) => {
      const attrs = { x, dy: i === 0 ? "0" : spacing };
      return typeof line === "string" ? { tag: "tspan", attrs, text: line } : { tag: "tspan", attrs, runs: line };
    }),
  };
}

/// I file dei caratteri che l'app porta, coi nomi che il file del disegno
/// scrive, i pesi e lo stile che coprono: quelli di `theme/serie/fonts.css`,
/// e il corsivo vero di ciascuno, che un testo del disegno può chiedere.
export const FONT_FILES: ReadonlyArray<readonly [family: string, url: string, weight: string, style: "normal" | "italic"]> = [
  ["Inter", "/fonts/inter-latin-wght-normal.woff2", "100 900", "normal"],
  ["Inter", "/fonts/inter-latin-wght-italic.woff2", "100 900", "italic"],
  ["Literata", "/fonts/literata-latin-wght-normal.woff2", "200 900", "normal"],
  ["Literata", "/fonts/literata-latin-wght-italic.woff2", "200 900", "italic"],
  ["JetBrains Mono", "/fonts/jetbrains-mono-latin-wght-normal.woff2", "100 800", "normal"],
  ["JetBrains Mono", "/fonts/jetbrains-mono-latin-wght-italic.woff2", "100 800", "italic"],
];
export const FONT_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

let registered = false;

/// Registra i caratteri coi nomi che il file del disegno scrive, una volta
/// sola: ciascuno si scarica quando un testo lo usa. Ogni lettera che il file
/// ha vale, come nell'export: nessun `unicode-range`. Dove il browser non sa
/// registrare un carattere, il testo usa il ripiego.
export function ensureTextFont(): void {
  if (registered || typeof FontFace === "undefined" || typeof document === "undefined" || document.fonts === undefined) return;
  registered = true;
  for (const [family, url, weight, style] of FONT_FILES) {
    try {
      document.fonts.add(new FontFace(family, `url("${url}") format("woff2")`, { style, weight, display: "swap" }));
    } catch {
      // Un carattere che non si registra lascia il ripiego.
    }
  }
}
