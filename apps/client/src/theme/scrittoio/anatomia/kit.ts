/** L'anatomia del pezzo `skin/kit.css`. Le primitive di `src/kit/`. */
import { S, SELECTABLE, type PartAnatomy } from "./types";

export const KIT: PartAnatomy = {
  part: "kit",
  layer: "cornice",
  components: [
    { name: "kit-popover", states: [S("rest"), S("focused")], hooks: ["kit-popover", "kit-hover-card"] },
    // Dentro la scheda al passaggio sui collegamenti: titolo, ritaglio della nota
    // e i tre gesti (apri, di fianco, nuova linguetta) o «Crea».
    {
      name: "link-card",
      states: [S("rest")],
      hooks: ["link-card", "link-card-head", "link-card-title", "link-card-where", "link-card-body", "link-card-note", "link-card-actions"],
    },
    {
      name: "link-card-action",
      states: [S("rest"), S("hover"), S("pressed"), S("focused")],
      hooks: ["link-card-action", "link-card-primary"],
    },
    {
      name: "kit-dialog",
      states: [S("rest"), S("focused")],
      hooks: [
        "kit-dialog-scrim",
        "kit-dialog",
        "kit-dialog-title",
        "kit-dialog-description",
        "kit-dialog-body",
        "kit-dialog-actions",
      ],
    },
    // `selected` è l'interruttore: un pulsante a icona con `aria-pressed`.
    { name: "kit-button", states: SELECTABLE, hooks: ["kit-button", "kit-button--icon"] },
    {
      name: "kit-field",
      states: [S("rest"), S("hover"), S("focused"), S("disabled")],
      hooks: ["kit-field", "kit-field-label", "kit-field-box", "kit-field-icon", "kit-field-input"],
    },
    {
      name: "kit-number",
      states: [S("rest"), S("hover"), S("focused"), S("disabled")],
      hooks: ["kit-number", "kit-number-label", "kit-number-box", "kit-number-input", "kit-number-unit", "kit-number-error", "scrubbing"],
    },
    {
      name: "kit-color",
      states: [S("rest"), S("hover"), S("focused"), S("selected")],
      layers: { selected: "segno" },
      hooks: ["kit-color", "kit-color-group", "kit-color-group-title", "kit-color-swatches", "kit-color-swatch", "kit-color-chip", "kit-color-check", "kit-color-area", "kit-color-hue", "kit-color-alpha", "kit-color-thumb", "kit-color-code", "kit-color-format", "kit-color-input", "kit-color-dropper", "none", "mixed", "selected"],
    },
    {
      name: "kit-color-well",
      states: [S("rest"), S("hover"), S("focused")],
      hooks: ["kit-color-well", "kit-color-well-button", "large"],
    },
    {
      name: "kit-font",
      states: [S("rest"), S("hover"), S("focused")],
      hooks: ["kit-font", "kit-font-list", "kit-font-group", "kit-font-item", "kit-font-name", "kit-font-note", "kit-font-empty", "kit-font-button"],
    },
    {
      name: "kit-rail",
      states: SELECTABLE,
      hooks: ["kit-rail", "kit-rail-group", "kit-rail-rule", "kit-rail-slot", "kit-rail-icon", "kit-rail-corner", "kit-rail-flyout", "kit-rail-flyout-item", "kit-rail-flyout-label", "kit-rail-flyout-keys"],
    },
    {
      name: "kit-options",
      states: [S("rest"), S("hover"), S("focused")],
      hooks: ["kit-options", "kit-options-row", "kit-options-more", "kit-options-overflow"],
    },
    { name: "kit-field-clear", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["kit-field-clear"] },
    // La riga attiva è `hover`: la porta il puntatore o la portano le frecce.
    // `selected` è la scelta dichiarata, che resta mentre l'attiva si muove.
    {
      name: "kit-list",
      states: [S("rest"), S("hover"), S("focused"), S("selected"), S("disabled")],
      hooks: ["kit-list", "kit-list-item", "kit-list-highlight"],
    },
    {
      name: "kit-tabs",
      states: SELECTABLE,
      hooks: ["kit-tabs", "kit-tab", "kit-tab-label", "kit-tab-indicator"],
    },
    {
      name: "kit-splitter",
      states: [S("rest"), S("hover"), S("focused"), S("dragging")],
      hooks: ["kit-splitter"],
    },
  ],
};
