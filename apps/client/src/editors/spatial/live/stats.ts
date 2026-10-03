// Le latenze dell'inchiostro live, per il pannello di diagnostica e per
// l'indicatore: dall'evento sul tablet al fotogramma del PC che lo mostra.
//
// Si tengono le ultime misure e non tutte: la mediana deve dire com'è la
// sessione adesso, non com'era all'inizio della lezione.

/// Quante misure si ricordano: qualche secondo di scrittura continua.
const WINDOW = 512;

export class LatencyWindow {
  #samples: number[] = [];
  #next = 0;

  /// Una misura in millisecondi. Uno scarto fra gli orologi stimato appena
  /// troppo grande la può dare negativa: vale zero.
  add(ms: number): void {
    if (!Number.isFinite(ms)) return;
    const value = Math.max(0, ms);
    if (this.#samples.length < WINDOW) this.#samples.push(value);
    else this.#samples[this.#next] = value;
    this.#next = (this.#next + 1) % WINDOW;
  }

  get count(): number {
    return this.#samples.length;
  }

  /// Il quantile `q` (0…1) delle misure, `null` senza misure.
  quantile(q: number): number | null {
    if (this.#samples.length === 0) return null;
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[at]!;
  }
}

/// Un tempo che resta, come lo dice un orologio: `4:05`, `0:42`.
export function formatLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/// Una latenza in millisecondi interi, con l'unità della lingua.
export function formatMs(ms: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: "millisecond",
    unitDisplay: "narrow",
    maximumFractionDigits: 0,
  }).format(ms);
}
