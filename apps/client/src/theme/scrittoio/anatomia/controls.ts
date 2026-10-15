/** L'anatomia del pezzo `skin/controls.css`. I controlli generici: campi, segmenti, suggerimenti. */
import { REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const CONTROLS: PartAnatomy = {
  part: "controls",
  components: [
    // I due cassetti stanno sulla scrivania: lì il campo cambia superficie.
    { name: "field-on-desk", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["sidebar", "inspector-pane"] },
    {
      name: "segmented-control",
      states: SELECTABLE,
      hooks: ["segmented", "segmented--wide", "segmented-option"],
    },
    { name: "tooltip", states: REST, hooks: ["shell-tooltip"] },
    { name: "key-cap", states: REST, hooks: ["titlebar-shortcut"] },
  ],
};
