// Vitest: il nucleo della lavagna si compila una volta, prima che partano i
// file di prova. Senza, la prima prova che importa `virtual:fub-canvas-wasm`
// aspetta cargo dentro il suo tempo massimo: con `target/canvas-wasm` vuoto
// (una CI nuova, un clone nuovo) la build release con LTO dura minuti, le
// prove di quel file scadono una dopo l'altra, e quello che lasciano a metà
// fa crescere la memoria del processo fino a farlo morire.
//
// Dopo, il plugin rilancia lo stesso comando, e cargo, con i sorgenti
// invariati, non ha niente da rifare. Se cargo qui fallisce la suite parte
// lo stesso: le prove che non toccano la lavagna non dipendono da lui, e
// quelle che la toccano falliscono col messaggio del plugin, che dice che
// cosa installare.

import { buildCanvasWasm, describeSize } from "./canvas-wasm.mjs";

export async function setup() {
  const started = performance.now();
  try {
    const { bytes } = await buildCanvasWasm();
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`fub-canvas-wasm: ${describeSize(bytes)} in ${seconds} s, prima delle prove`);
  } catch (error) {
    console.warn(`${error instanceof Error ? error.message : String(error)}\nLe prove della lavagna falliranno.`);
  }
}
