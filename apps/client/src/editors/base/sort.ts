// L'ordine di una vista della Base: l'ordinamento delle righe (`sort`) e
// l'ordine delle colonne (`order`). Funzioni pure: ricevono la lista che il
// piano ha letto dal file e tornano quella da scrivere con `base.view.set`.
// Nessuna cambia ciò che il gesto non tocca: un ordinamento secondario
// scritto a mano resta dov'era, e così le colonne che non si nascondono.

/// Una chiave dell'ordinamento, come la scrive il modello (`SortDef`).
export interface SortEntry {
  readonly key: string;
  readonly descending: boolean;
}

/// Quante chiavi di ordinamento e quante colonne la Base accetta dal piano:
/// le colonne hanno il tetto del modello (128), l'ordinamento lo stesso.
const MAX_ENTRIES = 128;

/// L'ordinamento del piano, controllato.
export function parseSort(raw: unknown): SortEntry[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ENTRIES) throw new Error("base: ordinamento malformato");
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("base: ordinamento malformato");
    const { key, descending } = entry as { key?: unknown; descending?: unknown };
    if (typeof key !== "string" || key === "" || (descending !== undefined && typeof descending !== "boolean")) throw new Error("base: ordinamento malformato");
    return { key, descending: descending === true };
  });
}

/// Le colonne scritte nel piano (`order`), controllate. Vuota quando il file
/// non le scrive e le colonne le deduce il modello.
export function parseOrder(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ENTRIES || raw.some((key) => typeof key !== "string" || key === "")) throw new Error("base: colonne malformate");
  return raw as string[];
}

/// Il nome della proprietà della nota che una chiave nomina: `prop.stato` e
/// `stato` sono `stato`, il nome del frontmatter. È quello che il comando di
/// scrittura riceve, non la chiave di colonna della vista.
export function propertyName(key: string): string {
  return key.replace(/^prop\./, "");
}

/// Due chiavi nominano la stessa proprietà? `prop.stato` e `stato` sì.
export function sameKey(left: string, right: string): boolean {
  return propertyName(left) === propertyName(right);
}

/// Ordina per `key` nel verso detto: la chiave passa in testa, le altre
/// restano dopo, nel loro ordine. Chi l'aveva già scritta come `prop.x` la
/// ritrova scritta così.
export function sortBy(sort: readonly SortEntry[], key: string, descending: boolean): SortEntry[] {
  const written = sort.find((entry) => sameKey(entry.key, key))?.key ?? key;
  return [{ key: written, descending }, ...sort.filter((entry) => !sameKey(entry.key, key))];
}

/// L'ordinamento senza la chiave `key`.
export function withoutSort(sort: readonly SortEntry[], key: string): SortEntry[] {
  return sort.filter((entry) => !sameKey(entry.key, key));
}

/// Il valore da scrivere per `sort`: `null` toglie la chiave, invece di
/// lasciare un `sort: []` che nessuno ha scritto.
export function sortValue(sort: readonly SortEntry[]): SortEntry[] | null {
  return sort.length === 0 ? null : sort.map((entry) => ({ key: entry.key, descending: entry.descending }));
}

/// Il verso dell'ordinamento per `key`, se la vista ordina per lei.
export function sortedBy(sort: readonly SortEntry[], key: string): SortEntry | null {
  return sort.find((entry) => sameKey(entry.key, key)) ?? null;
}

/// Le colonne con `key` mostrata o nascosta. Una colonna nuova va in fondo.
export function toggleColumn(columns: readonly string[], key: string, shown: boolean): string[] {
  const present = columns.some((column) => sameKey(column, key));
  if (shown) return present ? [...columns] : [...columns, key];
  return columns.filter((column) => !sameKey(column, key));
}

/// Le colonne con quella in `from` spostata in `to` (indici della lista di
/// prima). Fuori dai limiti, la lista resta com'è.
export function moveColumn(columns: readonly string[], from: number, to: number): string[] {
  const out = [...columns];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved!);
  return out;
}

/// Le stesse colonne nello stesso ordine?
export function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}
