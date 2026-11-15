/** L'anatomia del pezzo `skin/sheets.css`. I fogli: carta, linguette, testata, barra di formattazione, avvisi. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const SHEETS: PartAnatomy = {
  part: "sheets",
  layer: "cornice",
  components: [
    { name: "sheet", states: [S("rest"), S("focused")], hooks: ["pane", "focus", "pane-editor", "pane-split", "row", "col", "pane-divider"] },
    { name: "tabs", states: SELECTABLE, hooks: ["tab-drop-preview", "pane-tabs", "tab-entry", "tab", "tab-name", "tab-pin", "tab-format", "tab-page-icon", "tab-pinned", "dirty", "tab-close", "tab-new"] },
    { name: "sheet-header", states: REST, hooks: ["pane-toolbar", "muted", "pane-mode-current"] },
    { name: "sheet-title", states: INTERACTIVE, hooks: ["sheet-title", "crumb-sep", "crumb-name", "sheet-title-edit", "sheet-title-error", "sheet-title-proposal", "kit-field-box"] },
    // Il chip dello stato del documento e il suo riquadro.
    { name: "standing", states: INTERACTIVE, hooks: ["pane-standing", "pane-standing-chip", "pane-standing-mark", "pane-standing-text", "pane-standing-rec", "pane-standing-panel", "pane-standing-title", "pane-standing-body", "pane-standing-places", "pane-standing-place-name", "pane-standing-ask", "pane-standing-source", "pane-standing-actions"] },
    { name: "save-state", states: INTERACTIVE, hooks: ["sheet-save", "sheet-save-panel", "sheet-save-headline", "sheet-save-detail", "sheet-save-facts", "sheet-save-mono", "sheet-save-actions"] },
    { name: "format-bar", states: SELECTABLE, hooks: ["format-bar", "kit-bar", "format-bar-group", "format-bar-style", "format-bar-menu-label"] },
    { name: "selection-bubble", states: REST, hooks: ["selection-bubble"] },
    { name: "reading", layers: { "markdown-preview": "contenuto" }, states: REST, hooks: ["pane-preview", "markdown-preview"] },
    { name: "empty-pane", states: REST, hooks: ["pane-empty", "pane-empty-title", "pane-empty-actions"] },
    { name: "desk", states: INTERACTIVE, hooks: ["sheet-desk", "sheet-desk-label", "sheet-desk-row", "sheet-desk-note"] },
    { name: "heading-thread", states: INTERACTIVE, hooks: ["sheet-thread", "sheet-thread-item", "sheet-thread-notch"] },
    { name: "conflict", states: REST, hooks: ["conflict-banner", "conflict-actions"] },
    { name: "sheet-notices", states: REST, hooks: ["sheet-notices", "sheet-notice", "sheet-notice-text"] },
    // La sbirciata (E11): la nota aperta sopra la destra del foglio.
    { name: "note-peek", states: INTERACTIVE, hooks: ["note-peek", "note-peek-head", "note-peek-place", "note-peek-place-text", "note-peek-gap", "note-peek-here", "note-peek-side", "note-peek-close", "note-peek-body", "note-peek-message", "note-peek-message-title", "note-peek-message-text", "note-peek-create"] },
    // La scheda della nota (E11): un wikilink da solo in un paragrafo. È un
    // pezzo dell'interfaccia dentro il testo, come la scheda del collegamento.
    { name: "note-card", states: [S("rest"), S("hover"), S("focused")], hooks: ["cm-fub-note-card", "cm-fub-note-card-main", "cm-fub-note-card-body", "cm-fub-note-card-title", "cm-fub-note-card-icon", "cm-fub-note-card-desc", "cm-fub-note-card-meta", "cm-fub-note-card-cover"] },
  ],
};
