// La cache delle immagini ferme delle schede (N6 T2): tornando su una scheda
// PDF o d'immagine la sua immagine ferma c'è subito, senza rileggere né
// ridisegnare il file, e la memoria ha un tetto in byte.
//
// La forma è quella di `CardSnapshots` di `cards.ts`, scritta per struttura
// (questo modulo non importa il contratto). Dentro: una mappa per percorso,
// e in ogni percorso una mappa per parte («w640», «page-3@640»); l'ordine
// d'uso è uno solo per tutte le voci, così il più vecchio usato esce per
// primo qualunque sia il suo file. Percorso e parte sono chiavi opache: non
// si uniscono in una stringa e la cache non li interpreta mai.
//
// Chi esce viene chiuso: un `ImageBitmap` con `close()`, un canvas
// rimpicciolito a 0×0 perché il motore liberi la sua memoria. Si riconosce
// la forma, non la classe: in happy-dom `ImageBitmap` può non esserci.

/// Un'immagine ferma: un bitmap o un canvas, e i byte che pesa.
export interface CardCacheSnapshot {
  readonly bitmap: ImageBitmap | HTMLCanvasElement;
  readonly bytes: number;
}

/// Il tetto di partenza (A-6 del piano N6): un valore di partenza, non una misura.
export const CARD_CACHE_DEFAULT_LIMIT = 64 * 1024 * 1024;

interface Entry {
  readonly path: string;
  readonly part: string;
  readonly snapshot: CardCacheSnapshot;
  readonly bytes: number;
}

export class CardCache {
  readonly #limit: number;
  readonly #byPath = new Map<string, Map<string, Entry>>();
  /// L'ordine d'uso: il primo è il più vecchio. Un `Set` tiene l'ordine
  /// d'inserimento, e togliere e rimettere una voce la rende la più nuova.
  readonly #order = new Set<Entry>();
  #bytes = 0;

  constructor(limitBytes = CARD_CACHE_DEFAULT_LIMIT) {
    this.#limit = Number.isNaN(limitBytes) ? 0 : Math.max(0, limitBytes);
  }

  /// L'immagine ferma di una parte del file, se c'è; la rende la più nuova.
  get(path: string, part: string): CardCacheSnapshot | undefined {
    const entry = this.#byPath.get(path)?.get(part);
    if (!entry) return undefined;
    this.#order.delete(entry);
    this.#order.add(entry);
    return entry.snapshot;
  }

  /// Tiene un'immagine ferma. Una chiave che c'è già viene sostituita e la
  /// vecchia chiusa; una voce più grande del tetto intero non entra e si
  /// chiude subito. Poi escono le più vecchie finché i byte stanno nel tetto.
  put(path: string, part: string, snapshot: CardCacheSnapshot): void {
    const previous = this.#byPath.get(path)?.get(part);
    if (previous) {
      this.#remove(previous);
      // La stessa immagine rimessa: non va chiusa, è quella che entra.
      if (previous.snapshot.bitmap !== snapshot.bitmap) closeSnapshot(previous.snapshot);
    }
    const bytes = entryBytes(snapshot.bytes);
    if (bytes > this.#limit) {
      closeSnapshot(snapshot);
      return;
    }
    const entry: Entry = { path, part, snapshot, bytes };
    let parts = this.#byPath.get(path);
    if (!parts) {
      parts = new Map();
      this.#byPath.set(path, parts);
    }
    parts.set(part, entry);
    this.#order.add(entry);
    this.#bytes += bytes;
    this.#evict();
  }

  /// Toglie e chiude tutte le parti di un file, e solo di quello.
  forget(path: string): void {
    const parts = this.#byPath.get(path);
    if (!parts) return;
    for (const entry of [...parts.values()]) {
      this.#remove(entry);
      closeSnapshot(entry.snapshot);
    }
  }

  /// Toglie e chiude tutto.
  clear(): void {
    const entries = [...this.#order];
    this.#order.clear();
    this.#byPath.clear();
    this.#bytes = 0;
    for (const entry of entries) closeSnapshot(entry.snapshot);
  }

  /// I byte tenuti.
  size(): number {
    return this.#bytes;
  }

  #evict(): void {
    while (this.#bytes > this.#limit) {
      const oldest = this.#order.values().next();
      if (oldest.done) return;
      this.#remove(oldest.value);
      closeSnapshot(oldest.value.snapshot);
    }
  }

  #remove(entry: Entry): void {
    if (!this.#order.delete(entry)) return;
    this.#bytes -= entry.bytes;
    const parts = this.#byPath.get(entry.path);
    if (!parts) return;
    parts.delete(entry.part);
    if (parts.size === 0) this.#byPath.delete(entry.path);
  }
}

/// I byte di una voce: zero, negativi o non numeri contano come 1, così ogni
/// voce pesa e il conto non scende mai sotto zero.
function entryBytes(bytes: number): number {
  if (Number.isNaN(bytes) || bytes < 1) return 1;
  return Math.ceil(bytes);
}

/// Chiude un'immagine ferma. Un errore nel chiudere si ignora: la voce è già
/// uscita e la cache resta coerente.
function closeSnapshot(snapshot: CardCacheSnapshot): void {
  const bitmap = snapshot.bitmap as { close?: unknown; width?: unknown; height?: unknown };
  try {
    if (typeof bitmap.close === "function") {
      (bitmap.close as () => void).call(bitmap);
    } else if (typeof bitmap.width === "number" && typeof bitmap.height === "number") {
      bitmap.width = 0;
      bitmap.height = 0;
    }
  } catch {
    // Chiudere è un aiuto alla memoria, non un obbligo: si va avanti.
  }
}
