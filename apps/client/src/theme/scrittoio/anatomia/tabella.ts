/** L'anatomia del pezzo `skin/tabella.css`. La cornice della Tabella: lettere, numeri, selezione, riempimento; e le celle scelte del documento. */
import { SELECTABLE, type PartAnatomy } from "./types";

export const TABELLA: PartAnatomy = {
  part: "tabella",
  layer: "contenuto",
  components: [
    { name: "tabella-frame", layers: { "tb-corner": "cornice", "tb-letter": "cornice", "tb-rowhead": "cornice", "tb-adders": "cornice", "tb-add": "cornice", "tb-fill": "cornice", "is-selected": "segno", "is-active": "segno", "is-fill": "segno" }, states: SELECTABLE, hooks: ["cm-editor", "cm-content", "tb-frame", "tb-grid", "tb-corner", "tb-letter", "tb-rowhead", "tb-cell", "tb-head", "tb-adders", "tb-add", "tb-fill", "is-selected", "is-active", "is-fill"] },
    { name: "tabella-document-cells", layers: { "is-cell-selected": "segno" }, states: SELECTABLE, hooks: ["has-cell-selection", "is-cell-selected"] },
  ],
};
