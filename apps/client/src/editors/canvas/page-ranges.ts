// Le pagine che si chiedono in «Spargi le pagine» (T72): «3-7, 9», «20–»
// (fino alla fine), una pagina sola. Funzione pura, senza DOM: il dialogo la
// chiama a ogni tasto per dire che cosa nascerà, e il comando alla conferma.
//
// Un intervallo che va oltre l'ultima pagina si taglia e si dice (`cut`); un
// pezzo che non si legge è un errore con il pezzo scritto. Il campo vuoto vuol
// dire tutte le pagine. Le pagine tornano in ordine, senza doppi.

/// Il risultato di `parsePageRanges`: le pagine (da 1), o perché non si
/// legge (`bad`, il pezzo sbagliato) o perché nessuna pagina c'è (`bad`
/// `null`).
export type PageRanges =
  | { readonly ok: true; readonly pages: readonly number[]; readonly cut: boolean }
  | { readonly ok: false; readonly bad: string | null };

/// Un pezzo del testo: `N`, `N-M` o `N-` (fino all'ultima pagina). Il trattino
/// può essere anche un «–».
const PIECE = /^(\d+)(?:\s*[-–]\s*(\d*))?$/;

/// Le pagine di un PDF di `count` pagine (almeno una) che il testo chiede.
export function parsePageRanges(text: string, count: number): PageRanges {
  if (!(count >= 1)) return { ok: false, bad: null };
  const source = text.trim();
  if (source === "") return { ok: true, pages: range(1, Math.floor(count)), cut: false };
  const wanted = new Set<number>();
  let cut = false;
  for (const raw of source.split(",")) {
    const piece = raw.trim();
    if (piece === "") continue;
    const match = PIECE.exec(piece);
    if (!match) return { ok: false, bad: piece };
    const first = Number(match[1]);
    if (first < 1) return { ok: false, bad: piece };
    const dashed = piece.includes("-") || piece.includes("–");
    const last = !dashed ? first : match[2] === "" ? count : Number(match[2]);
    if (last < first) return { ok: false, bad: piece };
    if (first > count) {
      cut = true;
      continue;
    }
    if (last > count) cut = true;
    for (const page of range(first, Math.min(last, count))) wanted.add(page);
  }
  if (wanted.size === 0) return { ok: false, bad: null };
  return { ok: true, pages: [...wanted].sort((a, b) => a - b), cut };
}

/// Da `first` a `last` compresi, come numeri.
function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
