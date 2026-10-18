/** L'anatomia del pezzo `skin/motion.css`. Il moto dei componenti. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const MOTION: PartAnatomy = {
  part: "motion",
  components: [
    { name: "icon-picker", states: [S("rest"), S("focused")], hooks: ["icon-picker"] },
    { name: "context-menu", states: INTERACTIVE, hooks: ["context-menu"] },
    { name: "modal-palette", states: SELECTABLE, hooks: ["modale", "palette-box"] },
    { name: "settings", states: [S("rest"), S("selected"), S("focused")], hooks: ["settings-panel"] },
    { name: "editor-motion-surface", states: [S("rest"), S("focused")], hooks: ["cm-editor", "pane-editor"] },
    { name: "sheet-ghost", states: REST, hooks: ["sheet-ghost"] },
    { name: "draw-radial", states: INTERACTIVE, hooks: ["draw-radial", "draw-radial-ring"] },
  ],
};
