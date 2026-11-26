// Le pelli divise a pezzi, intere, per le prove che le leggono come un testo
// solo: i pezzi nell'ordine in cui `skin/order.ts` li monta.
import editors from "./skin/editors.css?raw";
import grid from "./skin/grid.css?raw";
import canvas from "./skin/canvas.css?raw";
import canvasCards from "./skin/canvas-cards.css?raw";
import baseBar from "./skin/base-bar.css?raw";
import baseViews from "./skin/base-views.css?raw";
import rich from "./skin/rich.css?raw";
import transclusion from "./skin/transclusion.css?raw";
import document from "./skin/document.css?raw";
import documentPage from "./skin/document-page.css?raw";
import documentBlocks from "./skin/document-blocks.css?raw";
import documentMeta from "./skin/document-meta.css?raw";

/// La pelle degli editor: `editors.css` e i sette pezzi dopo.
export const EDITORS_SKIN = [editors, grid, canvas, canvasCards, baseBar, baseViews, rich, transclusion].join("\n");

/// La pelle del documento: `document.css` e i tre pezzi dopo.
export const DOCUMENT_SKIN = [document, documentPage, documentBlocks, documentMeta].join("\n");
