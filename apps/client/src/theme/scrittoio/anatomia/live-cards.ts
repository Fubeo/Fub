/** L'anatomia del pezzo `skin/live-cards.css`. La scheda viva nella nota (T41): un file incorporato da solo nel paragrafo, con l'ospite delle schede della lavagna; la testata (icona, nome, parte, «Esc per uscire», «Fine», «Apri», «A tutta pagina»), la barra della specie mentre si scrive, il corpo inerte a riposo e suo da attiva; il file mancante e il formato senza vista. La scheda di foglio (T43): la parte persa con «Scegli di nuovo» e la cella attiva nel gruppo «Foglio» della barra di formato. */
import { S, type PartAnatomy } from "./types";

export const LIVE_CARDS: PartAnatomy = {
  part: "live-cards",
  layer: "cornice",
  components: [
    { name: "live-card", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["live-card", "live-card-body", "live-card-tools"] },
    { name: "live-card-head", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["live-card-head", "live-card-title", "live-card-name", "live-card-spacer", "live-card-escape", "live-card-done", "live-card-open", "live-card-full", "live-card-label"] },
    { name: "live-card-notice", states: [S("rest"), S("hover"), S("focused")], hooks: ["live-card-missing", "live-card-unsupported", "live-card-message", "live-card-hint", "live-card-actions", "kit-button"] },
    { name: "live-card-sheet", layers: { selected: "segno", stale: "segno" }, states: [S("rest"), S("hover"), S("focused")], hooks: ["canvas-card-sheet", "grid-header", "grid-corner", "selected", "stale", "canvas-card-lost", "canvas-card-message", "format-bar-context", "format-bar-context-cell", "grid-cell-name", "grid-formula-editor", "canvas-formula-text"] },
  ],
};
