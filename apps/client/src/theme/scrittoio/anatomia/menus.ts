/** L'anatomia del pezzo `skin/menus.css`. I menu. */
import { S, type PartAnatomy } from "./types";

export const MENUS: PartAnatomy = {
  part: "menus",
  components: [
    { name: "context-menu", states: [S("rest")], hooks: ["context-menu", "menu-separator"] },
    {
      name: "menu-item",
      states: [S("rest"), S("hover"), S("focused"), S("selected"), S("disabled")],
      hooks: ["menu-label", "menu-hint", "menu-body", "menu-description", "menu-swatches", "menu-swatch", "menu-check"],
    },
    { name: "menu-item-danger", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["danger"] },
  ],
};
