/** L'anatomia del pezzo `skin/graph.css`. Il grafo. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const GRAPH: PartAnatomy = {
  part: "graph",
  components: [
    { name: "pane-tabs", states: SELECTABLE, hooks: ["tab-name", "tab-view"] },
    // La tela (carta del foglio) e le annotazioni che non si toccano.
    { name: "graph-canvas", states: REST, hooks: ["graph-viewport", "graph-count", "graph-empty", "graph-status"] },
    // Le pastiglie che galleggiano in testa, la legenda e la linea del tempo.
    { name: "graph-controls", states: INTERACTIVE, hooks: ["graph-toolbar", "graph-toolbar-field", "graph-refresh", "graph-legend", "graph-legend-group", "graph-zoom", "graph-zoom-button", "graph-swatch", "graph-timeline"] },
    // L'ingranaggio (acceso quando il pannello è aperto) e il pannello della fisica.
    { name: "graph-panel", states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("focused")], hooks: ["graph-panel", "graph-panel-toggle", "graph-panel-popover", "graph-panel-titolo", "graph-panel-sezione", "graph-panel-sezione-titolo", "graph-panel-preset", "graph-panel-select", "graph-panel-campo", "graph-panel-nome", "graph-panel-valore", "graph-panel-check", "graph-panel-azioni"] },
    // L'elenco accessibile: la nota corrente è una riga selezionata.
    { name: "graph-list", states: SELECTABLE, hooks: ["graph-list", "graph-list-summary", "graph-list-items", "graph-list-open", "graph-list-empty", "graph-list-page", "graph-list-info", "graph-list-more"] },
  ],
};
