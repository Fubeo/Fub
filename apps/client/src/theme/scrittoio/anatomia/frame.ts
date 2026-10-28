/** L'anatomia del pezzo `frame`: barra del titolo, binario, banda di stato. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const FRAME: PartAnatomy = {
  part: "frame",
  layer: "cornice",
  components: [
    {
      name: "titlebar",
      states: REST,
      hooks: ["titlebar", "titlebar-side", "titlebar-side--left", "titlebar-center", "titlebar--darwin", "window-controls"],
    },
    { name: "brand-mark", states: INTERACTIVE, hooks: ["brand-mark", "brand-glyph"] },
    {
      name: "vault-chip",
      states: INTERACTIVE,
      hooks: ["vault-chip", "vault-chip-icon", "vault-chip-name", "vault-chip-none", "vault-chip-caret"],
    },
    {
      name: "titlebar-button",
      states: SELECTABLE,
      hooks: ["frame-nav", "titlebar-btn", "titlebar-btn--icon", "titlebar-badge"],
    },
    { name: "notices", states: [S("rest"), S("selected")], hooks: ["ha-novita", "in-corso"] },
    { name: "pill", states: INTERACTIVE, hooks: ["pill", "pill-icon", "pill-path", "pill-title", "titlebar-shortcut"] },
    { name: "window-control", states: INTERACTIVE, hooks: ["win-ctrl", "win-ctrl--close"] },
    { name: "app-menu", states: SELECTABLE, hooks: ["app-menu"] },
    {
      name: "app-menu-search",
      states: [S("rest"), S("focused"), S("selected")],
      hooks: [
        "app-menu-search-panel",
        "app-menu-search-input",
        "app-menu-search-list",
        "app-menu-search-option",
        "app-menu-search-group",
        "app-menu-search-label",
        "app-menu-search-hint",
        "app-menu-search-status",
      ],
    },
    { name: "desk", states: [S("rest"), S("selected")], hooks: ["desk"] },
    {
      name: "rail",
      states: SELECTABLE,
      hooks: ["rail", "rail-main", "rail-foot", "rail-btn", "rail-btn-manage", "rail-notch"],
    },
    { name: "inspector-tabs", states: SELECTABLE, hooks: ["inspector-tabs", "inspector-tab", "inspector-title", "inspector-follows"] },
    {
      name: "status-band",
      states: INTERACTIVE,
      hooks: ["status-band", "status-side", "status-item", "status-item--button"],
    },
  ],
};
