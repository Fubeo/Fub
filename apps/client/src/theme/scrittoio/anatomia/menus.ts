/** L'anatomia del pezzo `skin/menus.css`. I menu. */
import { S, type PartAnatomy } from "./types";

export const MENUS: PartAnatomy = {
  part: "menus",
  layer: "cornice",
  components: [
    { name: "context-menu", states: [S("rest")], hooks: ["context-menu", "menu-separator", "menu-group", "menu-empty"] },
    { name: "menu-head", states: [S("rest")], hooks: ["menu-head", "menu-head-name"] },
    { name: "menu-clipboard", states: [S("rest"), S("hover"), S("focused")], hooks: ["menu-clipboard", "menu-quick"] },
    { name: "menu-foot", states: [S("rest")], hooks: ["menu-foot", "menu-foot-query", "menu-path"] },
    { name: "context-submenu", states: [S("rest")], hooks: ["context-submenu", "menu-more"] },
    { name: "context-strip", states: [S("rest")], hooks: ["context-strip", "format-bar"] },
    {
      name: "menu-item",
      states: [S("rest"), S("hover"), S("focused"), S("selected"), S("disabled")],
      hooks: ["menu-label", "menu-hint", "menu-body", "menu-description", "menu-swatches", "menu-swatch", "menu-check", "menu-icon", "menu-sample", "menu-sample-box"],
    },
    {
      name: "slash-panel",
      layers: { "is-selected": "segno" },
      states: [S("rest"), S("hover"), S("focused"), S("selected"), S("disabled")],
      hooks: ["cm-tooltip", "is-selected", "slash-panel", "slash-head", "slash-query", "slash-context", "slash-count", "slash-crumb", "slash-tabs", "slash-body", "slash-list", "slash-group", "slash-section", "slash-row", "slash-icon", "slash-text", "slash-description", "slash-hint", "slash-pill", "slash-more", "slash-empty", "slash-foot", "is-step", "is-sheet", "is-narrow", "is-quick", "is-head", "is-empty"],
    },
    {
      name: "slash-preview",
      states: [S("rest")],
      hooks: ["slash-preview", "slash-preview-head", "slash-preview-title", "slash-preview-tools", "slash-stage", "slash-tip", "slash-chip", "slash-sample", "slash-sample-columns", "slash-sample-command", "slash-sample-faint", "slash-sample-label", "slash-sample-palette", "slash-sample-properties", "slash-sample-rule", "slash-sample-table", "slash-sample-text", "slash-sample-toc", "slash-sample-transform"],
    },
    {
      name: "slash-step",
      states: [S("rest"), S("hover"), S("selected")],
      hooks: ["slash-step", "slash-step-calendar", "slash-step-cell", "slash-step-chips", "slash-step-empty", "slash-step-field", "slash-step-grid", "slash-step-label", "slash-step-lead", "slash-step-list", "slash-step-row", "is-table", "is-color", "is-gallery", "is-diagram", "is-on", "is-out", "is-today", "is-current"],
    },
    { name: "menu-item-danger", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["danger"] },
  ],
};
