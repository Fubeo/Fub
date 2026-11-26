// La pelle degli editor intera, per le prove che la leggono come un testo
// solo: gli otto pezzi nell'ordine in cui `skin/order.ts` li monta.
import editors from "./skin/editors.css?raw";
import grid from "./skin/grid.css?raw";
import canvas from "./skin/canvas.css?raw";
import canvasCards from "./skin/canvas-cards.css?raw";
import baseBar from "./skin/base-bar.css?raw";
import baseViews from "./skin/base-views.css?raw";
import rich from "./skin/rich.css?raw";
import transclusion from "./skin/transclusion.css?raw";

export const EDITORS_SKIN = [editors, grid, canvas, canvasCards, baseBar, baseViews, rich, transclusion].join("\n");
