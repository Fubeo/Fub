/** L'anatomia del pezzo `skin/motion.css`. Il moto dei componenti. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const MOTION: PartAnatomy = {
  part: "motion",
  layer: "cornice",
  components: [
    { name: "context-menu", states: INTERACTIVE, hooks: ["context-menu"] },
    { name: "modal-palette", states: SELECTABLE, hooks: ["palette-box"] },
    { name: "editor-motion-surface", layers: { "cm-editor": "contenuto", "cm-cursorLayer": "segno" }, states: [S("rest"), S("focused")], hooks: ["cm-editor", "pane-editor", "cm-cursorLayer"] },
    { name: "sheet-ghost", states: REST, hooks: ["sheet-ghost"] },
  ],
};
