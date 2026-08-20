// L'altra metà della cucitura, per il banco: le superfici che l'app chiede al
// **sistema operativo** (`src/host/dialog.ts`).
//
// Sono due, e nel banco fanno la cosa che un fotogramma può contenere: la
// conferma dice sempre di sì — un `confirm` nativo aprirebbe una finestra del
// window manager, che non sta dentro lo screenshot della pagina e bloccherebbe
// la corsa per sempre — e il selettore di cartella risponde il vault del banco,
// perché l'unica scena che lo apre è quella della finestra senza vault.
//
// Non è la porta del kernel: quella è `ipc-finto.ts`. Sono due file di là e
// restano due di qua.

import type { ConfirmOptions } from "../src/host/dialog";

export function confirm(_message: string, _opts: ConfirmOptions): Promise<boolean> {
  return Promise.resolve(true);
}

export function pickFolder(): Promise<string | null> {
  return Promise.resolve("/Bench vault");
}
