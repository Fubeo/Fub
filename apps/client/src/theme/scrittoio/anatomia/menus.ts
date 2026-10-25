/** L'anatomia del pezzo `skin/menus.css`. I menu. */
import { S, type PartAnatomy } from "./types";

export const MENUS: PartAnatomy = {
  part: "menus",
  components: [
    { name: "context-menu", states: [S("rest")], hooks: ["context-menu", "menu-separator", "menu-group"] },
    { name: "context-submenu", states: [S("rest")], hooks: ["context-submenu", "menu-more"] },
    { name: "context-strip", states: [S("rest")], hooks: ["context-strip", "format-bar"] },
    {
      name: "menu-item",
      states: [S("rest"), S("hover"), S("focused"), S("selected"), S("disabled")],
      hooks: ["menu-label", "menu-hint", "menu-body", "menu-description", "menu-swatches", "menu-swatch", "menu-check", "menu-icon", "menu-sample", "menu-sample-box"],
    },
    { name: "menu-item-danger", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["danger"] },
  ],
};
