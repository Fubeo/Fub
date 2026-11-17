// **La forma di `memory.mjs`, dal lato dei tipi.**
//
// Come `../motion-rules.d.mts`: `memory.mjs` gira in Node dentro il banco
// della WebView, il suo presidio (`memory.test.ts`) è un `.ts`, e da questo
// lato del confine va dichiarata la sola funzione che il presidio usa.

/// La pendenza di una serie di residui in MiB per giro (Theil e Sen); `null`
/// con meno di due letture.
export function pendenza(ys: readonly (number | null)[]): number | null;
