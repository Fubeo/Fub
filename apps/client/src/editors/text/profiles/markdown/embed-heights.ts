// Le altezze degli incorporati già visti (UX-019): una nota riportata arriva
// dopo la sua domanda all'indice, e finché non c'è il suo posto è alto una
// riga. Chi l'ha già vista a questa larghezza ne tiene l'altezza: il posto
// la riserva subito, e il testo sotto resta dove sta quando il contenuto
// arriva. Solo memoria di questa finestra, mai del file né del disco.

/// Quante altezze si tengono: le più vecchie escono per prime.
const LIMIT = 500;

/// La larghezza conta a gradini: un pixel in più non cambia gli a capo, e
/// un riquadro che cambia misura di poco non perde la memoria.
const WIDTH_STEP = 16;

const heights = new Map<string, number>();

/// La chiave di un incorporato: dove si mostra (`place`: Scrittura o
/// Lettura, che lo vestono diversamente), la nota che lo ospita, ciò che
/// riporta e la larghezza del suo posto. `null` se il posto non ha ancora una larghezza
/// (fuori dalla pagina): lì non si ricorda niente.
export function embedHeightKey(
  place: string,
  host: string | undefined,
  page: string,
  heading: string | null,
  block: string | null,
  width: number,
): string | null {
  if (!Number.isFinite(width) || width <= 0) return null;
  return JSON.stringify([place, host ?? null, page, heading, block, Math.round(width / WIDTH_STEP)]);
}

export function rememberedEmbedHeight(key: string | null): number | null {
  if (key === null) return null;
  return heights.get(key) ?? null;
}

export function rememberEmbedHeight(key: string | null, height: number): void {
  if (key === null || !Number.isFinite(height) || height <= 0) return;
  heights.delete(key);
  heights.set(key, Math.round(height));
  if (heights.size > LIMIT) heights.delete(heights.keys().next().value as string);
}

/// Per i test: la memoria vuota.
export function forgetEmbedHeights(): void {
  heights.clear();
}
