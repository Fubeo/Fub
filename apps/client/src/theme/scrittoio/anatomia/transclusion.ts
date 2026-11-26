/** L'anatomia del pezzo `skin/transclusion.css`. La trasclusione viva e il blocco sincronizzato. */
import { S, type PartAnatomy } from "./types";

export const TRANSCLUSION: PartAnatomy = {
  part: "transclusion",
  layer: "cornice",
  components: [
    // La trasclusione viva (T29): il vassoio della nota riportata, la testata
    // con «Modifica qui» e «Apri», la fascia di chi scrive, gli avvisi e
    // l'editor del tratto.
    { name: "live-transclusion", layer: "contenuto", layers: { "pane-editor": "cornice", "base-surface": "cornice" }, states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["embed", "transclusion", "transclusion-head", "transclusion-source", "transclusion-spacer", "transclusion-self", "transclusion-body", "transclusion-band", "transclusion-notice", "transclusion-conflict", "transclusion-editing", "transclusion-editor", "transclusion-synced", "cm-editor", "cm-focused", "cm-content", "pane-editor", "markdown-rendered", "base-surface"] },
  ],
};
