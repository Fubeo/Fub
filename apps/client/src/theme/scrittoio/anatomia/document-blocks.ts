/** L'anatomia del pezzo `skin/document-blocks.css`. Il documento: i blocchi. */
import { REST, S, type PartAnatomy } from "./types";

export const DOCUMENT_BLOCKS: PartAnatomy = {
  part: "document-blocks",
  layer: "contenuto",
  components: [
    // La colonna di lettura e le due facce dello stesso testo: l'albero di
    // CodeMirror in Live e Sorgente, l'HTML reso in Lettura.
    { name: "document-column", layers: { "base-surface": "cornice" }, states: [S("rest"), S("focused")], hooks: ["markdown-rendered", "cm-editor", "cm-content", "cm-line", "markdown-table-scroll", "base-surface"] },
    { name: "document-inline", states: REST, hooks: ["cm-fub-near", "cm-fub-em", "cm-fub-code", "math-inline"] },
    { name: "document-details", states: [S("rest"), S("focused")], hooks: ["fub-details", "cm-fub-details-arrow", "cm-fub-details-empty"] },
    { name: "document-columns", states: [S("rest")], hooks: ["fub-columns", "fub-column", "cm-fub-column-label"] },
    { name: "document-toc", states: [S("rest"), S("hover")], hooks: ["fub-toc", "fub-toc-item", "fub-toc-empty"] },
    { name: "document-link", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["unresolved"] },
    { name: "document-quote", states: REST, hooks: ["cm-fub-quote", "cm-fub-quote-mark"] },
    { name: "document-callout", states: [S("rest"), S("focused")], hooks: ["callout", "callout-title", "cm-fub-callout-line", "cm-fub-callout-type", "cm-fub-callout-title", "cm-fub-callout-fold"] },
    { name: "document-list", states: REST, hooks: ["cm-fub-bullet", "cm-fub-bullet-task"] },
    { name: "document-task", states: [S("rest"), S("hover"), S("selected"), S("focused"), S("disabled")], hooks: ["task", "cm-fub-checkbox", "cm-fub-done"] },
    { name: "document-code", layers: { "markdown-code-copy": "cornice" }, states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["cm-fub-code-line", "cm-fub-codeblock", "markdown-code-copy", "cm-fub-code-header", "cm-fub-code-lang", "cm-fub-code-wrap", "cm-fub-math-field", "cm-fub-math-popover-preview"] },
    { name: "document-figure", states: REST, hooks: ["cm-fub-hr", "math-block", "katex-display", "image-missing", "image-remote", "image-remote-load", "cm-fub-image", "cm-fub-image-selected", "cm-fub-image-handle", "cm-fub-image-size", "cm-fub-image-dialog", "cm-fub-image-shares", "craft-figure", "craft-figure-page", "mermaid-diagram"] },
    { name: "document-embed", states: REST, hooks: ["embed", "embed-cycle", "embed-too-deep", "embed-missing", "embed-media"] },
  ],
};
