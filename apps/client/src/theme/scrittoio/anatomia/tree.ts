/** L'anatomia del pezzo `skin/tree.css`. L'albero dei file. */
import { S, SELECTABLE, type PartAnatomy } from "./types";

export const TREE: PartAnatomy = {
  part: "tree",
  components: [
    // `files-panel` è del pezzo dei cassetti: qui dice soltanto che due liste
    // stanno una sotto l'altra (appuntate e albero).
    {
      name: "tree",
      states: SELECTABLE,
      hooks: [
        "plain-list",
        "tree-children",
        "files-panel",
        "tree-row",
        "row-name",
        "row-icon",
        "no-icon",
        "leaf",
        "chevron",
        "troncata",
      ],
    },
    // Il nome che si scrive dentro l'albero: rinomina e cartella nuova.
    { name: "tree-rename", states: [S("rest"), S("focused"), S("disabled")], hooks: ["tree-row", "new-folder", "tree-rename-problem"] },
    { name: "tree-drop-target", states: [S("dragging")], hooks: ["drop-before", "drop-after", "drop-into"] },
    // La scelta di più note: la barra e i suoi gesti.
    {
      name: "tree-selection",
      states: [S("rest"), S("focused"), S("disabled")],
      hooks: ["tree-selection", "tree-selection-count", "tree-selection-action", "tree-selection-trash"],
    },
    { name: "tree-empty", states: [S("rest")], hooks: ["tree-empty", "link-button"] },
    // Il campo che filtra l'albero per percorso; i risultati sono righe della ricerca.
    { name: "tree-filter", states: [S("rest"), S("focused")], hooks: ["explorer-filter"] },
  ],
};
