// La regola del filtro per percorso: la usano l'esplora
// (`panels/explorer-filter.ts`) e il pannello dei segnalibri.
//
// Il percorso deve contenere ogni parola, senza badare alle maiuscole. Una
// parola col meno davanti toglie ciò che ha un pezzo di percorso che la
// contiene, quindi una cartella sparisce con tutto il suo contenuto. Fra
// virgolette una frase vale come una parola sola.

/// Le parole di un filtro: quelle che il percorso deve contenere e quelle che
/// nessun suo pezzo può contenere. Tutto in minuscolo.
export interface PathFilter {
  include: string[];
  exclude: string[];
}

export function parsePathFilter(text: string): PathFilter {
  const filter: PathFilter = { include: [], exclude: [] };
  for (const match of text.matchAll(/(-?)(?:"([^"]*)"?|(\S+))/g)) {
    const word = (match[2] ?? match[3] ?? "").toLocaleLowerCase();
    if (word === "" || (match[1] === "" && word === "-")) continue;
    (match[1] === "-" ? filter.exclude : filter.include).push(word);
  }
  return filter;
}

export const emptyFilter = (filter: PathFilter): boolean =>
  filter.include.length === 0 && filter.exclude.length === 0;

/// Se il percorso passa il filtro.
export function matchesPath(filter: PathFilter, path: string): boolean {
  const lower = path.toLocaleLowerCase();
  if (!filter.include.every((word) => lower.includes(word))) return false;
  if (filter.exclude.length === 0) return true;
  const parts = lower.split("/");
  return !filter.exclude.some((word) => parts.some((part) => part.includes(word)));
}
