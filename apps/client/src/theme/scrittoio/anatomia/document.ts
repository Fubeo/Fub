/** L'anatomia del pezzo `skin/document.css`. Il documento reso: anteprima, lettura, incorporamenti. */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const DOCUMENT: PartAnatomy = {
  part: "document",
  layer: "contenuto",
  components: [
    // La colonna di lettura e le due facce dello stesso testo: l'albero di
    // CodeMirror in Live e Sorgente, l'HTML reso in Lettura.
    { name: "document-column", layers: { "pane-editor": "cornice", "pane-preview": "cornice" }, states: [S("rest"), S("focused")], hooks: ["pane-editor", "pane-preview", "markdown-preview", "markdown-rendered", "cm-editor", "cm-content", "cm-line", "cm-markdown-block"] },
    { name: "document-heading", states: REST, hooks: ["cm-fub-heading-line", "cm-fub-h1", "cm-fub-h2", "cm-fub-h3", "cm-fub-h4", "cm-fub-h5", "cm-fub-h6", "cm-fub-h1-line", "cm-fub-h2-line", "cm-fub-h3-line", "cm-fub-h4-line", "cm-fub-h5-line", "cm-fub-h6-line"] },
    { name: "document-inline", states: REST, hooks: ["cm-fub-near", "cm-fub-pending-mark", "cm-fub-ghost", "cm-fub-wavy", "cm-fub-placeholder", "cm-fub-heading-pill-button", "cm-fub-strong", "cm-fub-em", "cm-fub-strike", "cm-fub-highlight", "inline-highlight", "cm-fub-comment", "cm-fub-code", "math-inline"] },
    { name: "document-details", states: [S("rest"), S("focused")], hooks: ["fub-details", "cm-fub-details-arrow", "cm-fub-details-empty"] },
    { name: "document-columns", states: [S("rest")], hooks: ["fub-columns", "fub-column", "cm-fub-column-label"] },
    { name: "document-toc", states: [S("rest"), S("hover")], hooks: ["fub-toc", "fub-toc-item", "fub-toc-empty"] },
    { name: "document-link-card", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["cm-fub-link-card", "cm-fub-link-card-main", "cm-fub-link-card-text", "cm-fub-link-card-title", "cm-fub-link-card-desc", "cm-fub-link-card-site", "cm-fub-link-card-icon", "cm-fub-link-card-url", "cm-fub-link-card-note", "cm-fub-link-card-fetch"] },
    { name: "document-color", states: REST, hooks: ["fub-color-gray", "fub-color-brown", "fub-color-orange", "fub-color-yellow", "fub-color-green", "fub-color-blue", "fub-color-purple", "fub-color-pink", "fub-color-red", "fub-bg-gray", "fub-bg-brown", "fub-bg-orange", "fub-bg-yellow", "fub-bg-green", "fub-bg-blue", "fub-bg-purple", "fub-bg-pink", "fub-bg-red"] },
    { name: "document-link", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["cm-fub-link", "cm-fub-wikilink", "cm-fub-link-pill", "cm-fub-person", "unresolved", "footnote-ref", "footnote-backref", "footnote-inline", "cm-fub-footnote-label", "cm-fub-footnote-back"] },
    { name: "document-tag", states: [S("rest"), S("hover"), S("focused")], hooks: ["tag", "cm-fub-tag"] },
    { name: "document-quote", states: REST, hooks: ["cm-fub-quote", "cm-fub-quote-mark"] },
    { name: "document-callout", states: [S("rest"), S("focused")], hooks: ["callout", "callout-title", "cm-fub-callout-line", "cm-fub-callout-type", "cm-fub-callout-title", "cm-fub-callout-fold"] },
    { name: "document-task", states: [S("rest"), S("hover"), S("selected"), S("focused"), S("disabled")], hooks: ["task", "cm-fub-checkbox", "cm-fub-done"] },
    { name: "document-code", layers: { "markdown-code-copy": "cornice" }, states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["cm-fub-code-line", "cm-fub-codeblock", "markdown-code-copy", "cm-fub-code-header", "cm-fub-code-lang", "cm-fub-code-wrap", "cm-fub-diagram-notice", "cm-fub-math-field", "cm-fub-math-popover-preview"] },
    { name: "document-figure", states: REST, hooks: ["cm-fub-hr", "math-block", "katex-display", "image-missing", "image-remote", "image-remote-load", "cm-fub-image", "cm-fub-image-selected", "cm-fub-image-handle", "cm-fub-image-size", "cm-fub-image-dialog", "cm-fub-image-shares"] },
    { name: "document-embed", states: REST, hooks: ["embed", "embed-cycle", "embed-too-deep", "embed-media"] },
    { name: "document-diagram", layers: { "mermaid-bar": "cornice", "mermaid-action": "cornice", "mermaid-swatches": "cornice" }, states: INTERACTIVE, hooks: ["mermaid-diagram", "mermaid-bar", "mermaid-action", "mermaid-swatches"] },
    { name: "document-blocks", layers: { "cm-fub-block-menu": "cornice" }, states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["cm-fub-block-handles", "cm-fub-block-add", "cm-fub-block-grip", "cm-fub-block-drop", "cm-fub-block-selected", "cm-fub-block-mark", "cm-fub-block-halo", "cm-fub-block-pass", "cm-fub-block-lift", "cm-fub-block-id", "cm-fub-block-menu", "cm-fub-color-swatch"] },
    { name: "document-page", states: [S("rest"), S("hover"), S("focused")], hooks: ["cm-fub-page-cover", "cm-fub-page-icon", "cm-fub-page-tool", "cm-fub-page-title", "cm-fub-page-check", "fub-note--wide", "fub-note--small", "fub-note--serif", "fub-note--sans", "fub-note--mono"] },
    { name: "document-properties", states: REST, hooks: ["cm-fub-frontmatter", "block-frontmatter-unparsed", "block-footnote-definition"] },
    { name: "declarative-slot", layer: "cornice", states: REST, hooks: ["ui-slot"] },
    { name: "declarative-node-content", layer: "cornice", states: REST, hooks: ["ui-heading", "empty-note"] },
    { name: "declarative-node-feedback", layer: "cornice", states: [S("rest"), S("hover"), S("pressed")], hooks: ["ui-list-item", "ui-list-item-title", "ui-list-item-subtitle", "clickable"] },
    { name: "link-dialog", layer: "cornice", states: [S("rest"), S("hover"), S("focused")], hooks: ["md-link-dialog", "md-link-dialog-notes", "md-link-dialog-note", "md-link-dialog-preview"] },
    { name: "link-preview", layer: "cornice", states: [S("rest"), S("focused")], hooks: ["link-preview", "doc-preview"] },
  ],
};
