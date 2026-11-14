// I Blocchi (H1–H8, C4): l'interfaccia dei blocchi dentro Scrittura —
// modello, maniglie, menu, trascinamento, selezione, tasti, testata e moto. La
// superficie li monta con l'editor della nota.
import { type Extension } from "@codemirror/state";
import { blockHandles, type BlocksOptions, blocksOptions } from "./handles";
import { blockKeysExtension } from "./keys";
import { blockModel } from "./model";
import { blockMotionExtension } from "./motion";
import { blockSelectionExtension } from "./selection";
import { pageHeaderExtension } from "./page";

export type { BlocksOptions } from "./handles";
export { pageArrives } from "./motion";

export function blocksMode(options: BlocksOptions = {}): Extension {
  return [
    // Il modello prima di chi lo legge nei propri campi.
    blockModel,
    blocksOptions.of(options),
    blockSelectionExtension,
    blockKeysExtension,
    blockHandles,
    pageHeaderExtension,
    // Il blocco vivo (N13): i gesti si vedono accadere.
    blockMotionExtension,
  ];
}
