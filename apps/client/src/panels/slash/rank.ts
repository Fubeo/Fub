// La classifica del menu «/»: quanto bene una voce risponde a ciò che si è
// scritto dopo il «/». Pura sui dati: la provano la tabella delle sessanta
// query (`queries.test.ts`) e i suoi test.
//
// Due lettere vogliono un inizio di parola, del nome o degli altri nomi, o le
// iniziali; mai lettere sparse, mai la descrizione. Da tre lettere conta anche
// ciò che sta dentro le parole, da quattro si perdona un errore di battitura.

/// Le abitudini e il posto: due numeri fra 0 e 1 per voce.
export interface RankContext {
  /// Quanto la voce è stata scelta di recente o spesso.
  recency(id: string): number;
  /// Quanto la voce sta bene dove si scrive (in un elenco, un'attività).
  fits(id: string): number;
}

/// Come risponde una voce: più basso è meglio. `span` è la parte del nome
/// da colorare; `why` dice perché è stata trovata quando non lo si vede.
export interface Match {
  score: number;
  span: readonly [number, number] | null;
  why?: "iniziali" | "forse";
}

/// Le parole piccole che le iniziali saltano: «Elenco di attività» è «ea».
const SMALL = new Set(["di", "a", "da", "in", "con", "su", "per", "tra", "fra", "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "del", "della", "al", "alla", "e", "of", "the", "an", "to", "and"]);

/// Minuscolo e senza accenti.
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/// Le iniziali delle parole che contano.
export function initials(label: string): string {
  return fold(label).split(/\s+/).filter((word) => word !== "" && !SMALL.has(word)).map((word) => word[0]).join("");
}

/// Al più un errore fra `a` e `b`: una lettera in più, in meno, cambiata, o
/// due vicine scambiate.
export function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/// Dove comincia, nel nome piegato, la prima parola che comincia con `q`.
function wordStart(label: string, q: string): number {
  const re = /\S+/g;
  for (let m = re.exec(label); m; m = re.exec(label)) if (!SMALL.has(m[0]) && m[0].startsWith(q)) return m.index;
  return -1;
}

export function rank(entry: { readonly id: string; readonly label: string; readonly aliases: readonly string[] }, raw: string, ctx: RankContext): Match | null {
  const q = fold(raw.trim());
  if (q === "") return { score: 0, span: null };
  // Il nome piegato ha la stessa lunghezza dell'originale per le lettere
  // accentate composte: lo span vale su tutti e due.
  const label = fold(entry.label);
  const aliases = entry.aliases.map(fold);
  const words = [...label.split(/\s+/), ...aliases];
  let match: Match | null = null;
  if (label.startsWith(q)) match = { score: 0, span: [0, q.length] };
  else if (wordStart(label, q) > 0) {
    const at = wordStart(label, q);
    match = { score: 1, span: [at, at + q.length] };
  } else if (aliases.some((word) => word.startsWith(q))) match = { score: 1, span: null };
  else if (q.length >= 2 && initials(entry.label).startsWith(q)) match = { score: 1.5, span: null, why: "iniziali" };
  else if (q.length >= 3 && label.includes(q)) {
    const at = label.indexOf(q);
    match = { score: 2, span: [at, at + q.length] };
  } else if (q.length >= 3 && words.some((word) => word.includes(q))) match = { score: 2.5, span: null };
  else if (q.length >= 4 && words.some((word) => editDistanceAtMost1(word, q) || editDistanceAtMost1(word.slice(0, q.length), q))) {
    match = { score: 3, span: null, why: "forse" };
  }
  if (!match) return null;
  // Al più mezzo punto: le abitudini riordinano fra pari, non scavalcano.
  match.score -= 0.3 * ctx.recency(entry.id) + 0.2 * ctx.fits(entry.id);
  return match;
}
