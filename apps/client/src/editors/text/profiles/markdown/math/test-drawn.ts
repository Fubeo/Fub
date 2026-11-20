// Le attese delle prove del riquadro della formula con KaTeX vero. Lo
// importano solo i `*.test.ts`: nell'app non entra.
//
// Prima (#504) ogni prova aspettava 40 ms e poi al più cento giri da 40 ms
// che il riquadro smettesse di caricare, e passato il tetto andava avanti
// zitta: con la macchina carica il primo `import()` di KaTeX (e del suo foglio
// di stile, che Vite trasforma) durava più di quei quattro secondi, e la prova
// cadeva più in là su un'asserzione che non c'entrava, ogni volta un'altra.
// Adesso il caricamento si fa una volta prima delle prove (`mathReady`, nel
// `beforeAll` col limite dei primi `import()`), e `drawn` aspetta la
// condizione vera: il riquadro cercato c'è e nessuno sta più caricando.

import { loadKatex } from "../math";
import { loadLazyParts } from "../../../../../ui/lazy-part";
import { FIRST_IMPORT_MS, waiter } from "../../../../../test-wait";

/// Il limite del `beforeAll` che chiama [`mathReady`].
export const MATH_READY_MS = FIRST_IMPORT_MS;

/// KaTeX, le sue macro e i pezzi pigri già creati (il riquadro che
/// `math-live.ts` carica al primo tocco), caricati una volta: le prove poi
/// guardano il gesto col codice già lì.
export async function mathReady(): Promise<void> {
  await Promise.all([loadKatex(), loadLazyParts()]);
}

const LOADING = ".cm-fub-mx-surface[data-state=loading]";
const wait = waiter(2_000);

/// Finché in `root` c'è `selector` e nessun riquadro sta caricando: col
/// codice già caricato basta un fotogramma, e una condizione che non arriva
/// fallisce col suo nome invece di lasciar andare avanti la prova.
export async function drawn(selector = ".cm-fub-mx-surface", root: ParentNode = document): Promise<void> {
  await drawnWhen(`il riquadro «${selector}» disegnato`, () => root.querySelector(selector) !== null, root);
}

/// Finché `cond` è vera e in `root` nessun riquadro sta caricando: per le
/// prove che dopo un gesto aspettano il disegno del fotogramma dopo (una
/// scelta colorata, un cursore che torna), detto col suo nome in `thing`.
export async function drawnWhen(thing: string, cond: () => boolean, root: ParentNode = document): Promise<void> {
  await wait(thing, () => cond() && root.querySelector(LOADING) === null);
}
