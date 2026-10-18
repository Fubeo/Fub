/** L'anatomia del pezzo `skin/kit.css`. Le primitive di `src/kit/`. */
import { S, SELECTABLE, type PartAnatomy } from "./types";

export const KIT: PartAnatomy = {
  part: "kit",
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
