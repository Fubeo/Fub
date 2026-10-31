// I Blocchi (H1–H8, C4): la Live con la politica `mai` più l'interfaccia dei
// blocchi — modello, maniglie, menu, trascinamento, selezione e tasti. È un
// pezzo a parte, che la superficie carica la prima volta che serve.
import { type Extension } from "@codemirror/state";
import { blockHandles, type BlocksOptions, blocksOptions } from "./handles";
import { blockKeysExtension } from "./keys";
import { blockModel } from "./model";
import { blockSelectionExtension } from "./selection";
import { pageHeaderExtension } from "./page";

export type { BlocksOptions } from "./handles";

export function blocksMode(options: BlocksOptions = {}): Extension {
  return [
    // Il modello prima di chi lo legge nei propri campi.
    blockModel,
    blocksOptions.of(options),
    blockSelectionExtension,
    blockKeysExtension,
    blockHandles,
    pageHeaderExtension,
  ];
}
