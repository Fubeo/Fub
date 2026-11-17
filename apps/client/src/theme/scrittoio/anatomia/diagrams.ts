/** L'anatomia del pezzo `skin/diagrams.css`. I diagrammi: il disegno, e il menu del tasto destro (E26). */
import { INTERACTIVE, S, type PartAnatomy } from "./types";

export const DIAGRAMS: PartAnatomy = {
  part: "diagrams",
  layer: "contenuto",
  components: [
    // Il disegno: un'immagine inerte, sulla pagina o sulla tavola della sua carta.
    { name: "diagram", states: [S("rest"), S("hover")], hooks: ["mermaid-diagram", "mermaid-diagram-view"] },
    // Il menu del tasto destro: le miniature dello stile, le scelte a due, le azioni.
    {
      name: "diagram-menu",
      layer: "cornice",
      states: INTERACTIVE,
      hooks: [
        "context-menu", "diagram-menu", "diagram-menu-label", "diagram-menu-styles", "diagram-menu-style",
        "diagram-menu-style-name", "diagram-menu-swatch", "diagram-menu-swatch-node", "diagram-menu-swatch-choice",
        "diagram-menu-swatch-pill", "diagram-menu-swatch-line", "diagram-menu-notice", "diagram-menu-row",
        "diagram-menu-row-name", "diagram-menu-segments", "diagram-menu-segment", "diagram-menu-actions", "menu-icon",
      ],
    },
  ],
};
