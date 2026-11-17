// **La forma di `canvas.mjs`, dal lato dei tipi.**
//
// Come `memory.d.mts`: `canvas.mjs` gira in Node dentro il banco della
// WebView, il suo presidio (`canvas.test.ts`) è un `.ts`, e da questo lato del
// confine si dichiara ciò che il presidio usa.

/// Le misure di una lavagna in un giro: quante, mediana, p95 e massimo in ms.
export interface CanvasStats {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/// Una lavagna di un giro di `measureCanvasCore`.
export interface CanvasBoard {
  readonly size: number;
  readonly textBytes: number;
  readonly firstOpenMs: number;
  readonly open: CanvasStats;
  readonly firstCommitMs: number;
  readonly commit: CanvasStats;
}

/// Il referto di un giro di `measureCanvasCore`, nella parte che `l1Values` legge.
export interface CanvasReport {
  readonly instanceMs: number;
  readonly boards: readonly CanvasBoard[];
}

/// Quanti giri fa lo scenario L1 nella stessa WebView.
export const L1_ROUNDS: number;

/// I valori di L1 dai referti dei giri: prima istanza, prima apertura e primo
/// commit del primo giro; l'istanza e i p95 come mediana dei giri.
export function l1Values(reports: readonly CanvasReport[]): Record<string, number | null>;
