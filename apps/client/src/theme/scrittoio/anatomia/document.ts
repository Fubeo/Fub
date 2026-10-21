/** L'anatomia del pezzo `skin/document.css`. Il documento reso: anteprima, lettura, incorporamenti. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const DOCUMENT: PartAnatomy = {
  part: "document",
  components: [
    // La colonna di lettura e le due facce dello stesso testo: l'albero di
    // CodeMirror in Live e Sorgente, l'HTML reso in Lettura.
    { name: "document-column", states: [S("rest"), S("focused")], hooks: ["pane-editor", "pane-preview", "markdown-preview", "markdown-rendered", "cm-editor", "cm-content", "cm-line", "cm-markdown-block"] },
    { name: "document-heading", states: REST, hooks: ["cm-fub-heading-line", "cm-fub-h1", "cm-fub-h2", "cm-fub-h3", "cm-fub-h4", "cm-fub-h5", "cm-fub-h6", "cm-fub-h1-line", "cm-fub-h2-line", "cm-fub-h3-line", "cm-fub-h4-line", "cm-fub-h5-line", "cm-fub-h6-line"] },
    { name: "document-inline", states: REST, hooks: ["cm-fub-strong", "cm-fub-em", "cm-fub-strike", "cm-fub-highlight", "inline-highlight", "cm-fub-comment", "cm-fub-code", "math-inline"] },
    { name: "document-link", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["cm-fub-link", "cm-fub-wikilink", "unresolved", "footnote-ref", "footnote-backref", "footnote-inline"] },
    { name: "document-tag", states: [S("rest"), S("hover"), S("focused")], hooks: ["tag", "cm-fub-tag"] },
    { name: "document-quote", states: REST, hooks: ["cm-fub-quote", "cm-fub-quote-mark"] },
    { name: "document-callout", states: [S("rest"), S("focused")], hooks: ["callout", "callout-title"] },
    { name: "document-task", states: [S("rest"), S("hover"), S("selected"), S("focused"), S("disabled")], hooks: ["task", "cm-fub-checkbox", "cm-fub-done"] },
    { name: "document-code", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["cm-fub-code-line", "cm-fub-codeblock", "markdown-code-copy"] },
    { name: "document-table", states: SELECTABLE, hooks: ["cm-md-grid-block", "cm-md-grid", "cm-md-grid-corner", "cm-md-grid-letter", "cm-md-grid-rowhead", "cm-md-grid-cell", "cm-md-grid-head", "cm-md-grid-adders", "cm-md-grid-add", "is-selected", "is-active"] },
    { name: "document-figure", states: REST, hooks: ["cm-fub-hr", "math-block", "katex-display", "image-missing", "image-remote", "image-remote-load"] },
    { name: "document-embed", states: REST, hooks: ["embed", "embed-cycle", "embed-too-deep", "embed-media"] },
    { name: "document-diagram", states: INTERACTIVE, hooks: ["mermaid-diagram", "mermaid-bar", "mermaid-action", "mermaid-swatches"] },
    { name: "document-properties", states: REST, hooks: ["cm-fub-frontmatter", "block-frontmatter-unparsed", "block-footnote-definition"] },
    { name: "declarative-slot", states: REST, hooks: ["ui-slot"] },
    { name: "declarative-node-content", states: REST, hooks: ["ui-heading", "empty-note"] },
    { name: "declarative-node-feedback", states: [S("rest"), S("hover"), S("pressed")], hooks: ["ui-list-item", "ui-list-item-title", "ui-list-item-subtitle", "clickable"] },
    { name: "link-preview", states: [S("rest"), S("focused")], hooks: ["link-preview", "doc-preview"] },
  ],
};
