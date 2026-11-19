/** L'anatomia del pezzo `skin/live-cards.css`. La scheda viva nella nota (T41): un file incorporato da solo nel paragrafo, con l'ospite delle schede della lavagna; la testata (icona, nome, parte, «Esc per uscire», «Fine», «Apri», «A tutta pagina»), la barra della specie mentre si scrive, il corpo inerte a riposo e suo da attiva; il file mancante e il formato senza vista. T42: la misura scritta nell'embed (larghezza e altezza), il bordo in basso che cambia l'altezza, la riga (icona e nome) e le schede affiancate nelle colonne. T43: la scheda di foglio, con la parte persa e «Scegli di nuovo», e la cella attiva nel gruppo «Foglio» della barra di formato. T44: la scheda di documento. T45: la scheda PDF, la pagina sulla carta con «‹ 2 / 6 ›» sotto e lo strato del testo di pdf.js che da attiva si sceglie. T46: la scheda di disegno. T49: «Estrai» in testata e il passo di PDF come citazione. */
import { S, type PartAnatomy } from "./types";

export const LIVE_CARDS: PartAnatomy = {
  part: "live-cards",
  layer: "cornice",
  components: [
    { name: "live-card", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["live-card", "live-card-body", "live-card-tools"] },
    { name: "live-card-head", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["live-card-head", "live-card-title", "live-card-name", "live-card-spacer", "live-card-escape", "live-card-done", "live-card-open", "live-card-full", "live-card-label", "live-card-extract"] },
    { name: "live-card-resize", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["live-card-resize"] },
    { name: "live-card-columns", layer: "contenuto", states: [S("rest")], hooks: ["markdown-rendered", "fub-columns", "fub-column"] },
    { name: "live-card-notice", states: [S("rest"), S("hover"), S("focused")], hooks: ["live-card-missing", "live-card-unsupported", "live-card-message", "live-card-hint", "live-card-actions", "kit-button"] },
    { name: "live-card-pdf", layer: "contenuto", states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("disabled"), S("selected")], hooks: ["canvas-card-pdf", "canvas-card-pdf-page", "canvas-card-pdf-text", "markedContent", "canvas-card-pdf-message", "canvas-card-pdf-previous", "canvas-card-pdf-next", "canvas-card-pdf-status", "cm-editor", "cm-content"] },
    { name: "live-card-sheet", layers: { selected: "segno", stale: "segno" }, states: [S("rest"), S("hover"), S("focused")], hooks: ["canvas-card-sheet", "grid-header", "grid-corner", "selected", "stale", "canvas-card-lost", "canvas-card-message", "format-bar-context", "format-bar-context-cell", "grid-cell-name", "grid-formula-editor", "canvas-formula-text"] },
    // La scheda di documento (T44): il testo reso a riposo, la riga «Apri» di
    // un documento lungo, l'editor dei documenti in Scrittura da attiva.
    { name: "live-card-document", layers: { "rich-content": "contenuto", "rich-para": "contenuto", "rich-heading": "contenuto", "rich-list": "contenuto", "look-tema": "contenuto" }, states: [S("rest"), S("selected"), S("focused")], hooks: ["canvas-card-document", "canvas-card-document-content", "canvas-card-document-more", "rich-surface", "rich-page", "rich-content", "rich-para", "rich-heading", "rich-list", "look-tema"] },
    // La scheda di disegno (T46): il disegno fermo a riposo, l'editor dei
    // disegni da attiva con gli strumenti in una fila sopra il foglio.
    { name: "live-card-drawing", states: [S("rest"), S("selected"), S("focused")], hooks: ["canvas-card-drawing", "canvas-card-drawing-editor", "canvas-card-image", "draw-card-bar", "draw-editor", "draw-header", "draw-rail", "draw-body", "draw-dock"] },
    // Il valore di una cella nel testo (T53): il tratteggio d'accento in
    // Scrittura, testo come il resto in Lettura.
    { name: "cell-value", layer: "contenuto", states: [S("rest"), S("hover")], hooks: ["cm-fub-cell-value", "fub-cell-value", "embed"] },
    // La zona lavagna (T47): la lavagna vera in forma di scheda, senza la sua
    // testata, la barra, la colonna degli strumenti e il navigatore.
    { name: "live-card-canvas", layers: { "canvas-viewport": "contenuto", "canvas-grid": "segno" }, states: [S("rest"), S("selected"), S("focused")], hooks: ["canvas-card-board", "canvas-card-board-rest", "canvas-card-board-editor", "canvas-card-board-message", "canvas-viewport", "canvas-grid", "canvas-body", "canvas-header", "canvas-toolbar", "canvas-rail", "canvas-navigator", "kit-button"] },
    // Gli estratti (T49): «Estrai» in testata, e il passo di PDF come
    // citazione con la sua fonte e «Vai alla pagina».
    { name: "live-card-excerpt", layer: "contenuto", states: [S("rest"), S("hover"), S("focused")], hooks: ["live-card-excerpt", "live-card-excerpt-wait", "live-card-excerpt-source", "live-card-excerpt-name", "live-card-excerpt-go"] },
  ],
};
