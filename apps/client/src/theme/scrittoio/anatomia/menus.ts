/** L'anatomia del pezzo `skin/menus.css`. I menu. */
import { S, type PartAnatomy } from "./types";

export const MENUS: PartAnatomy = {
  part: "menus",
  layer: "cornice",
  components: [
    { name: "context-menu", states: [S("rest")], hooks: ["context-menu", "menu-at-point", "menu-items", "menu-glide", "menu-lit", "menu-separator", "menu-group", "menu-group-label", "menu-empty", "menu-title"] },
    { name: "menu-head", states: [S("rest")], hooks: ["menu-head", "menu-head-kind", "menu-head-name"] },
    { name: "menu-field", states: [S("rest"), S("focused")], hooks: ["menu-field", "menu-field-input", "menu-field-pointer"] },
    { name: "menu-clipboard", states: [S("rest"), S("hover"), S("focused"), S("pressed")], hooks: ["menu-clipboard", "menu-clipboard-glide", "menu-quick", "menu-pressed"] },
    { name: "menu-choices", states: [S("rest"), S("hover"), S("focused"), S("pressed")], hooks: ["menu-choices", "menu-choice", "menu-choice-set", "menu-choice-name"] },
    { name: "menu-foot", states: [S("rest")], hooks: ["menu-foot", "menu-foot-text", "menu-foot-query", "menu-foot-caret", "menu-finding", "menu-path", "menu-foot-keys", "menu-foot-key"] },
    { name: "context-submenu", states: [S("rest")], hooks: ["context-submenu", "menu-more"] },
    { name: "context-strip", states: [S("rest")], hooks: ["context-strip", "format-bar"] },
    // La barra che segue il blocco (E8): lo stile, il gruppo del blocco,
    // «+ Inserisci».
    {
      name: "format-bar-follow",
      states: [S("rest"), S("hover"), S("focused"), S("pressed"), S("disabled")],
      hooks: ["format-bar-follow", "kit-bar", "kit-bar-group", "kit-bar-button", "format-bar-labelled", "format-bar-text", "format-bar-caret", "format-bar-style", "format-bar-context", "format-bar-context-name", "format-bar-overflow", "format-bar-insert-group", "format-bar-insert"],
    },
    {
      name: "menu-item",
      states: [S("rest"), S("hover"), S("focused"), S("selected"), S("disabled")],
      hooks: ["menu-label", "menu-hint", "menu-description", "menu-quiet", "menu-swatches", "menu-swatch", "menu-check", "menu-icon", "menu-sample", "menu-sample-box"],
    },
    {
      name: "slash-panel",
      layers: { "is-selected": "segno", "cm-editor": "contenuto" },
      states: [S("rest"), S("hover"), S("focused"), S("selected"), S("disabled")],
      hooks: ["cm-tooltip", "pane-editor", "cm-editor", "is-selected", "slash-panel", "slash-head", "slash-crumb", "slash-context", "slash-count", "slash-body", "slash-choices", "slash-top", "slash-tile", "slash-list", "slash-group-label", "slash-row", "slash-syntax-note", "slash-found", "slash-swatch", "slash-none", "slash-all", "kit-row-icon", "kit-tile-icon", "is-sheet"],
    },
    {
      name: "slash-detail",
      states: [S("rest")],
      hooks: ["slash-detail", "slash-thumb", "slash-thumb-icon", "slash-thumb-line", "slash-thumb-ink", "slash-thumb-accent", "slash-thumb-wash", "slash-thumb-tray", "slash-thumb-stroke", "slash-thumb-stroke-accent", "slash-thumb-check", "slash-thumb-text", "slash-thumb-formula", "slash-detail-text", "slash-description", "slash-syntax", "slash-tools", "has-tools"],
    },
    {
      name: "slash-step",
      states: [S("rest"), S("hover"), S("selected")],
      hooks: ["slash-step", "slash-step-calendar", "slash-step-cell", "slash-step-chips", "slash-step-empty", "slash-step-field", "slash-step-grid", "slash-step-label", "slash-step-lead", "slash-step-list", "slash-step-row", "is-table", "is-color", "is-gallery", "is-diagram", "is-on", "is-out", "is-today", "is-empty"],
    },
    { name: "menu-item-danger", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["danger"] },
  ],
};
