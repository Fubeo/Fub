/** L'anatomia del pezzo `skin/nodes.css`. I nodi delle viste dichiarative. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const NODES: PartAnatomy = {
  part: "nodes",
  components: [
    { name: "declared-view", states: REST, hooks: ["ui-stack", "ui-text", "ui-heading", "ui-children"] },
    // Dove una view è montata: nei due cassetti le sue righe prendono il gradino pieno.
    { name: "declared-view-on-desk", states: [S("rest"), S("hover"), S("pressed")], hooks: ["sidebar", "inspector-pane", "views-modal", "declared-view"] },
    {
      name: "button-intent",
      states: INTERACTIVE,
      hooks: ["primary", "ui-button", "ui-submit", "intent-primary", "intent-danger"],
    },
    { name: "declarative-node-section", states: INTERACTIVE, hooks: ["ui-section"] },
    {
      name: "declarative-node-row",
      states: SELECTABLE,
      hooks: ["clickable", "ui-list", "ui-list-item", "ui-list-item-subtitle", "ui-tree", "ui-tree-item", "ui-tree-label", "ui-row"],
    },
    { name: "declarative-node-table", states: REST, hooks: ["ui-table", "ui-empty-cell"] },
    { name: "declarative-node-tabs", states: SELECTABLE, hooks: ["ui-tab-bar", "ui-tab-button"] },
    {
      name: "declarative-node-feedback",
      states: REST,
      hooks: [
        "ui-badge",
        "ui-icon",
        "ui-progress",
        "ui-progress-label",
        "ui-empty-state",
        "ui-empty-title",
        "ui-empty-detail",
        "ui-key-value",
        "ui-pending",
        "ui-failed",
        "ui-failed-message",
      ],
    },
    {
      name: "fields",
      states: [S("rest"), S("hover"), S("focused"), S("disabled")],
      hooks: [
        "ui-field-label",
        "ui-text-input",
        "ui-date-picker",
        "ui-number",
        "ui-text-area",
        "ui-select",
        "ui-slider",
        "ui-checkbox",
        "ui-radio",
        "ui-radio-option",
      ],
    },
    { name: "declarative-node-form", states: REST, hooks: ["ui-form"] },
    { name: "declarative-node-guest", states: REST, hooks: ["ui-html", "ui-custom", "ui-webview"] },
  ],
};
