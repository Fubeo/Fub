// La pila CSS di un carattere del documento. Il file nomina il carattere con
// cui è stato scritto, che il sistema spesso non ha: prima del generico si
// provano i sostituti metrici, che hanno le stesse larghezze e quindi gli
// stessi a-capo, poi la famiglia generica ricavata dal nome. Nessun carattere
// è spedito con Fub: si usa ciò che il sistema ha.

/// I sostituti metrici liberi dei caratteri di Office, per nome minuscolo.
const SUBSTITUTES: Readonly<Record<string, readonly string[]>> = {
  calibri: ["Carlito"],
  cambria: ["Caladea"],
  arial: ["Liberation Sans", "Arimo"],
  "times new roman": ["Liberation Serif", "Tinos"],
  "courier new": ["Liberation Mono", "Cousine"],
};

/// La famiglia generica dalla prima parola del nome.
const GENERIC: readonly (readonly [string, "sans-serif" | "serif" | "monospace"])[] = [
  ["aptos", "sans-serif"],
  ["calibri", "sans-serif"],
  ["arial", "sans-serif"],
  ["verdana", "sans-serif"],
  ["segoe", "sans-serif"],
  ["cambria", "serif"],
  ["times", "serif"],
  ["georgia", "serif"],
  ["garamond", "serif"],
  ["courier", "monospace"],
  ["consolas", "monospace"],
];

/// La famiglia generica di un carattere: un nome che non si riconosce resta
/// serif, come la carta di un documento.
export function genericFamily(name: string): "sans-serif" | "serif" | "monospace" {
  const first = name.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return GENERIC.find(([word]) => first === word)?.[1] ?? "serif";
}

/// Il valore di `font-family` per il carattere `name`: il nome, i suoi
/// sostituti metrici e la famiglia generica.
export function fontStack(name: string): string {
  const family = name.trim();
  const substitutes = SUBSTITUTES[family.toLowerCase()] ?? [];
  return [family, ...substitutes].map((each) => JSON.stringify(each)).concat(genericFamily(family)).join(", ");
}
