// I Blocchi (H1–H8, C4): l'interfaccia dei blocchi dentro Scrittura —
// modello, maniglie, menu, trascinamento, selezione, tasti, testata e moto. La
// superficie li monta con l'editor della nota.
import { type Extension } from "@codemirror/state";
import { blockHandles, type BlocksOptions, blocksOptions } from "./handles";
import { blockKeysExtension, plainKeysExtension } from "./keys";
import { blockModel } from "./model";
import { blockMotionExtension } from "./motion";
import { blockSelectionExtension, escapeLeaves } from "./selection";
import { pageHeaderExtension } from "./page";
import { headingPillOff } from "../hints";

export type { BlocksOptions } from "./handles";
export { pageArrives } from "./motion";

/// `page` dice se il testo è una pagina: senza (`false`, la scheda di testo
/// della lavagna) niente testata — titolo, proprietà, icona, copertina,
/// sottopagine —, solo il corpo.
export function blocksMode(options: BlocksOptions = {}, page = true): Extension {
  return [
    // Il modello prima di chi lo legge nei propri campi.
    blockModel,
    blocksOptions.of(options),
    escapeLeaves.of(options.escapeLeaves === true),
    blockSelectionExtension,
    blockKeysExtension,
    blockHandles,
    // La maniglia prende il margine del titolo: niente pastiglia «H1» lì.
    headingPillOff.of(true),
    page ? pageHeaderExtension : [],
    // Il blocco vivo (N13): i gesti si vedono accadere.
    blockMotionExtension,
  ];
}

/// Scrittura coi blocchi spenti (`editor.blocks`, E2): un editor di testo.
/// Niente maniglie, «+», selezione di blocchi né moto dei blocchi; i tasti
/// sono quelli del testo (`plainKeys`). La testata della pagina resta: non è
/// un blocco.
export function plainMode(options: BlocksOptions = {}, page = true): Extension {
  return [blocksOptions.of(options), plainKeysExtension, page ? pageHeaderExtension : []];
}
