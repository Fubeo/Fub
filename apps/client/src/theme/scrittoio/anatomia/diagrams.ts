/** L'anatomia del pezzo `skin/diagrams.css`. I diagrammi: il disegno, e il menu del tasto destro (E26). */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const DIAGRAMS: PartAnatomy = {
  part: "diagrams",
  layer: "contenuto",
  components: [
    // Il disegno: un'immagine inerte, sulla pagina o sulla tavola della sua carta.
    { name: "diagram", states: [S("rest"), S("hover")], hooks: ["mermaid-diagram", "mermaid-diagram-view", "is-stale"] },
    // La didascalia: il titolo del frontmatter, che si scrive lì.
    { name: "diagram-caption", states: [S("rest"), S("focused")], hooks: ["mermaid-diagram-caption", "mermaid-diagram-caption-text"] },
    // Il sorgente aperto: le righe a metà, il disegno accanto, la riga
    // dell'errore, «Fatto» nella testata.
    {
      name: "diagram-source",
      states: [S("rest"), S("hover"), S("focused")],
      hooks: ["cm-fub-diagram-live", "cm-fub-diagram-src", "cm-fub-diagram-notice", "cm-fub-diagram-rest", "cm-fub-code-done", "cm-fub-code-header", "cm-editor", "cm-content", "cm-line"],
    },
    // A tutta finestra: la lightbox sul fondo dello stile.
    { name: "diagram-full", layer: "cornice", layers: { "zoom-content": "contenuto" }, states: REST, hooks: ["lightbox", "lightbox-diagram", "lightbox-diagram-hint", "zoom-content", "modale"] },
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
