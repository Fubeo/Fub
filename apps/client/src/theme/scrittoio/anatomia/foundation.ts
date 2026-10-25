/** L'anatomia del pezzo `skin/foundation.css`. Le fondamenta: la pagina, il bottone nudo, gli intenti, il rilievo. */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const FOUNDATION: PartAnatomy = {
  part: "foundation",
  components: [
    { name: "app-surface", states: REST, hooks: ["app"] },
    { name: "elevation-paper", states: REST, hooks: ["elevation-paper"] },
    { name: "elevation-base", states: REST, hooks: ["elevation-base"] },
    { name: "elevation-chrome", states: REST, hooks: ["elevation-chrome"] },
    { name: "elevation-floating", states: REST, hooks: ["elevation-floating"] },
    { name: "elevation-dialog", states: REST, hooks: ["elevation-dialog"] },
    { name: "skip-link", states: [S("rest"), S("focused")], hooks: ["skip-link"] },
    { name: "muted-copy", states: REST, hooks: ["muted"] },
    { name: "skeleton", states: REST, hooks: ["skeleton", "skeleton-line", "skeleton-rows"] },
    { name: "button-intent", states: INTERACTIVE, hooks: ["primary", "ui-button", "intent-primary", "intent-danger"] },
  ],
};
