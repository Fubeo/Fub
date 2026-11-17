// **La forma di `typing.mjs`, dal lato dei tipi.**
//
// Come `canvas.d.mts`: `typing.mjs` gira in Node dentro il banco della
// WebView, il suo presidio (`typing.test.ts`) è un `.ts`, e da questo lato del
// confine si dichiara ciò che il presidio usa.

/// I tasti di un giro nel referto della sonda: quanti, mediana, p95 e massimo in ms.
export interface KeyStats {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/// Il referto della sonda di un giro, nella parte che `s1Values` legge.
export interface TypingReport {
  readonly input: { readonly key: KeyStats };
}

/// I caratteri di un giro.
export const S1_TYPED: string;

/// Quanti giri fa S1 nella stessa nota.
export const S1_ROUNDS: number;

/// La pausa fra un giro e il successivo, fuori dalla misura, in ms.
export const S1_ROUND_GAP_MS: number;

/// I valori di S1 dai giri: il p95 come mediana dei giri, `null` se un giro
/// non ha tasti misurati.
export function s1Values(reports: readonly TypingReport[]): Record<string, number | null>;

/// Una riga del referto coi p95 e i campioni dei giri.
export function s1Note(reports: readonly TypingReport[]): string;
