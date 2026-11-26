/** L'anatomia del pezzo `skin/editors.css`. L'editor di testo sotto tutte le superfici, e le superfici che non si aprono; le superfici dei formati hanno i loro pezzi (`grid`, `canvas`, `canvas-cards`, `base-bar`, `base-views`, `rich`, `transclusion`). */
import { REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const EDITORS: PartAnatomy = {
  part: "editors",
  layer: "cornice",
  components: [
    // L'editor di testo che sta sotto a tutte le superfici: sono classi di
    // CodeMirror, e la pelle le veste tutte — il tema dell'editor
    // (`editors/text/theme.ts`) non porta colori (issue #242).
    { name: "text-editor", layer: "contenuto", layers: { "pane-editor": "cornice", "cm-activeLine": "segno", "cm-fub-no-active-line": "segno", "cm-cursor": "segno", "cm-dropCursor": "segno", "cm-selectionLayer": "segno", "cm-selectionBackground": "segno", "cm-selectionMatch": "segno", "cm-matchingBracket": "segno", "cm-nonmatchingBracket": "segno" }, states: [S("rest"), S("focused"), S("selected")], hooks: ["pane-editor", "cm-editor", "cm-focused", "cm-scroller", "cm-content", "cm-line", "cm-activeLine", "cm-fub-no-active-line", "cm-cursor", "cm-dropCursor", "cm-selectionLayer", "cm-selectionBackground", "cm-selectionMatch", "cm-matchingBracket", "cm-nonmatchingBracket", "cm-foldPlaceholder", "cm-placeholder"] },
    // La sintassi: una classe per gruppo di tag, nell'ordine del tema
    // dell'editor. È il contenuto, con i ruoli `--syn-*`.
    { name: "text-editor-syntax", layer: "contenuto", states: REST, hooks: ["fub-syn-keyword", "fub-syn-name", "fub-syn-function", "fub-syn-constant", "fub-syn-definition", "fub-syn-type", "fub-syn-operator", "fub-syn-comment", "fub-syn-strong", "fub-syn-monospace", "fub-syn-emphasis", "fub-syn-strikethrough", "fub-syn-link", "fub-syn-heading", "fub-syn-atom", "fub-syn-string", "fub-syn-invalid"] },
    // I segni del Markdown dal vivo che il documento non veste: il pallino di
    // una voce (contenuto) e l'ondina del correttore (un segno di Fub).
    { name: "text-editor-live", layer: "contenuto", layers: { "cm-lintRange": "segno", "cm-fub-proof-spelling": "segno", "cm-fub-proof-grammar": "segno" }, states: REST, hooks: ["cm-fub-bullet", "cm-lintRange", "cm-fub-proof-spelling", "cm-fub-proof-grammar"] },
    { name: "text-editor-gutter", states: [S("rest"), S("selected")], hooks: ["cm-gutters", "cm-lineNumbers", "cm-gutterElement", "cm-activeLineGutter", "cm-foldGutter"] },
    { name: "text-editor-search", layers: { "cm-searchMatch": "segno", "cm-searchMatch-selected": "segno" }, states: SELECTABLE, hooks: ["cm-panels", "cm-panels-top", "cm-panels-bottom", "cm-panel", "cm-search", "cm-textfield", "cm-button", "cm-searchMatch", "cm-searchMatch-selected"] },
    { name: "text-editor-tooltip", states: [S("rest"), S("selected")], hooks: ["cm-tooltip", "cm-tooltip-arrow", "cm-tooltip-autocomplete", "cm-completionMatchedText", "cm-completionDetail", "cm-completionInfo"] },
    { name: "surface-fallback", states: [S("rest"), S("focused")], hooks: ["document-surface-error", "document-surface-viewer", "media-surface"] },
    // Il file di un componente spento (K2): nome, dimensione, «Accendi …».
    { name: "surface-file-only", states: [S("rest"), S("focused")], hooks: ["document-surface-file-only", "file-only-title", "file-only-name", "file-only-size", "file-only-note", "file-only-actions", "file-only-problem"] },
  ],
};
