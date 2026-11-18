// Il campionario: i tre caratteri del tema, la scala, i pesi e l'interlinea.
//
// Il catalogo del banco (`bench/catalog.ts`) mette la scala per intero su
// prosa vera; la pagina «Tutti i componenti» (`pagina.ts`) mostra le tre
// famiglie con le loro pile e una frase ciascuna.

/// La prosa del campionario del banco.
export const PROSE =
  "Non si migliora ciò che non si guarda: un gradino che non si vede, un allineamento che salta, un'ombra che non stacca.";

/// La scala tipografica, dal più piccolo al più grande.
export const SCALE = [
  "--text-xs",
  "--text-sm",
  "--text-base",
  "--text-md",
  "--text-lg",
  "--text-xl",
  "--text-2xl",
  "--text-3xl",
] as const;

/// I tre pesi, col nome che il campionario scrive accanto.
export const WEIGHTS: readonly (readonly [string, string])[] = [
  ["normale", "400"],
  ["medium", "var(--weight-medium)"],
  ["bold", "var(--weight-bold)"],
];

/// Le tre famiglie del tema, col titolo della sezione del banco.
export const FAMILIES = [
  ["Carattere dell'interfaccia", "--font-ui"],
  ["Carattere di lettura", "--font-reading"],
  ["Carattere monospaziato", "--font-mono"],
] as const;

/// L'interlinea e la spaziatura, che sono gli altri due token della voce del
/// tema e non si vedono su una riga sola.
export const LEADINGS = [
  ["normale", ""],
  ["leading-tight", "line-height: var(--leading-tight)"],
  ["leading-normal", "line-height: var(--leading-normal)"],
  ["leading-relaxed", "line-height: var(--leading-relaxed)"],
  ["tracking-caps", "letter-spacing: var(--tracking-caps); text-transform: uppercase"],
] as const;

/// Le famiglie di una pila di `font-family` come la scrive il foglio, senza
/// virgolette: `"Hanken Grotesk", system-ui` → `["Hanken Grotesk", "system-ui"]`.
export function fontStack(value: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const character of value) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ",") {
      if (current.trim()) families.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) families.push(current.trim());
  return families;
}
