/** L'anatomia del pezzo `skin/editors.css`. Le superfici dei formati: canvas, base, foglio di calcolo, documenti di videoscrittura. */
import { DRAGGABLE, INTERACTIVE, S, SELECTABLE, type PartAnatomy } from "./types";

export const EDITORS: PartAnatomy = {
  part: "editors",
  components: [
    // L'editor di testo che sta sotto a tutte le superfici: sono classi di
    // CodeMirror, e la pelle le veste dove il tema dell'editor non arriva.
    { name: "text-editor", states: [S("rest"), S("focused"), S("selected")], hooks: ["pane-editor", "cm-editor", "cm-focused", "cm-scroller", "cm-content", "cm-line", "cm-activeLine", "cm-cursor", "cm-dropCursor", "cm-selectionLayer", "cm-selectionBackground", "cm-selectionMatch", "cm-matchingBracket", "cm-nonmatchingBracket", "cm-foldPlaceholder", "cm-placeholder"] },
    { name: "text-editor-gutter", states: [S("rest"), S("selected")], hooks: ["cm-gutters", "cm-lineNumbers", "cm-gutterElement", "cm-activeLineGutter", "cm-foldGutter"] },
    { name: "text-editor-search", states: SELECTABLE, hooks: ["cm-panels", "cm-panels-top", "cm-panels-bottom", "cm-panel", "cm-search", "cm-textfield", "cm-button", "cm-searchMatch", "cm-searchMatch-selected"] },
    { name: "text-editor-tooltip", states: [S("rest"), S("selected")], hooks: ["cm-tooltip", "cm-tooltip-arrow", "cm-tooltip-autocomplete", "cm-completionMatchedText", "cm-completionDetail", "cm-completionInfo"] },
    { name: "surface-fallback", states: [S("rest"), S("focused")], hooks: ["document-surface-error", "document-surface-viewer", "media-surface"] },
    { name: "grid-surface", states: SELECTABLE, hooks: ["grid-surface", "grid-formula-bar", "grid-cell-name", "grid-formula-editor", "grid-viewport", "grid-cell", "grid-header", "grid-corner", "grid-cell-editor", "selected", "active"] },
    { name: "base-surface", states: INTERACTIVE, hooks: ["base-surface", "base-toolbar", "base-status", "base-body", "base-summaries"] },
    { name: "base-table", states: [S("rest"), S("hover"), S("focused")], hooks: ["base-table", "base-cell", "base-cell-error"] },
    { name: "base-cards", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["base-cards", "base-list", "base-card", "base-field"] },
    { name: "base-kanban", states: DRAGGABLE, hooks: ["base-kanban", "base-kanban-column", "base-kanban-card"] },
    { name: "base-map", states: [S("rest"), S("focused")], hooks: ["base-map-atlas", "base-map-attribution", "base-map-marker"] },
    { name: "canvas-surface", states: INTERACTIVE, hooks: ["canvas-surface", "canvas-toolbar", "canvas-intake-error", "canvas-viewport", "canvas-large-fallback", "canvas-source"] },
    { name: "canvas-node", states: DRAGGABLE, hooks: ["canvas-node", "canvas-node-group", "canvas-node-handle", "canvas-connect", "canvas-resize", "canvas-card-body", "canvas-markdown", "canvas-empty", "canvas-group-label", "canvas-group-bg", "canvas-url-text", "canvas-media-placeholder", "canvas-convert-note", "canvas-open-url", "canvas-file-link", "canvas-text-editor", "canvas-field-editor"] },
    { name: "rich-surface", states: [S("rest"), S("focused"), S("selected"), S("disabled")], hooks: ["rich-surface", "rich-notice", "rich-content", "rich-para", "rich-heading", "rich-list", "rich-quote", "rich-link", "rich-section", "rich-break-page", "rich-break-column", "rich-table", "rich-cell"] },
    { name: "rich-atom", states: [S("rest"), S("selected")], hooks: ["rich-atom", "rich-atom-image", "rich-atom-graphic", "rich-atom-shape", "rich-atom-group", "rich-atom-note", "rich-atom-field", "rich-atom-marker", "ProseMirror-selectednode", "rich-proof-spelling", "rich-proof-grammar"] },
    { name: "canvas-edge", states: [S("rest"), S("selected"), S("dragging")], hooks: ["canvas-edge-hit", "canvas-edge-line", "canvas-edge-arrow", "canvas-edge-label", "canvas-edge-reconnect"] },
  ],
};
