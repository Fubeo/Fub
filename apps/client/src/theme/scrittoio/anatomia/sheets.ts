/** L'anatomia del pezzo `skin/sheets.css`. I fogli: carta, linguette, testata, barra di formattazione, avvisi. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const SHEETS: PartAnatomy = {
  part: "sheets",
  layer: "cornice",
  components: [
    { name: "sheet", states: [S("rest"), S("focused")], hooks: ["pane", "focus", "pane-editor", "pane-split", "row", "col", "pane-divider"] },
    { name: "tabs", states: SELECTABLE, hooks: ["tab-drop-preview", "pane-tabs", "tab-entry", "tab", "tab-name", "tab-pin", "tab-format", "tab-pinned", "dirty", "tab-close", "tab-new"] },
    { name: "sheet-header", states: REST, hooks: ["pane-toolbar", "muted", "pane-format", "pane-mode-current"] },
    { name: "sheet-title", states: INTERACTIVE, hooks: ["sheet-title", "sheet-title-edit", "sheet-title-error", "sheet-title-proposal", "kit-field-box"] },
    // Il chip dello stato del documento e il suo riquadro.
    { name: "standing", states: INTERACTIVE, hooks: ["pane-standing", "pane-standing-chip", "pane-standing-mark", "pane-standing-text", "pane-standing-rec", "pane-standing-panel", "pane-standing-title", "pane-standing-body", "pane-standing-places", "pane-standing-ask", "pane-standing-source", "pane-standing-actions"] },
    { name: "save-state", states: INTERACTIVE, hooks: ["sheet-save", "sheet-save-panel", "sheet-save-headline", "sheet-save-detail", "sheet-save-facts", "sheet-save-mono", "sheet-save-actions"] },
    { name: "format-bar", states: SELECTABLE, hooks: ["format-bar", "format-bar-group", "format-bar-button", "format-bar-menu", "format-bar-style", "format-bar-menu-label"] },
    { name: "selection-bubble", states: REST, hooks: ["selection-bubble"] },
    { name: "reading", layers: { "markdown-preview": "contenuto" }, states: REST, hooks: ["pane-preview", "markdown-preview"] },
    { name: "empty-pane", states: REST, hooks: ["pane-empty", "pane-empty-title", "pane-empty-actions"] },
    { name: "desk", states: INTERACTIVE, hooks: ["sheet-desk", "sheet-desk-label", "sheet-desk-row", "sheet-desk-note"] },
    { name: "heading-thread", states: INTERACTIVE, hooks: ["sheet-thread", "sheet-thread-item", "sheet-thread-notch"] },
    { name: "conflict", states: REST, hooks: ["conflict-banner", "conflict-actions"] },
    { name: "sheet-notices", states: REST, hooks: ["sheet-notices", "sheet-notice", "sheet-notice-text"] },
  ],
};
