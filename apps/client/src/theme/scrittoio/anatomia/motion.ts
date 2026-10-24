/** L'anatomia del pezzo `skin/motion.css`. Il moto dei componenti. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const MOTION: PartAnatomy = {
  part: "motion",
  components: [
    { name: "context-menu", states: INTERACTIVE, hooks: ["context-menu"] },
    { name: "modal-palette", states: SELECTABLE, hooks: ["palette-box"] },
    { name: "editor-motion-surface", states: [S("rest"), S("focused")], hooks: ["cm-editor", "pane-editor", "cm-cursorLayer"] },
    { name: "sheet-ghost", states: REST, hooks: ["sheet-ghost"] },
  ],
};
