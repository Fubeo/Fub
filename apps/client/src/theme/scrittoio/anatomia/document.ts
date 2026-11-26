/** L'anatomia del pezzo `skin/document.css`. Il documento reso: la colonna, il corpo, i titoli, i collegamenti; il resto in `document-page`, `document-blocks`, `document-meta`. */
import { REST, S, type PartAnatomy } from "./types";

export const DOCUMENT: PartAnatomy = {
  part: "document",
  layer: "contenuto",
  components: [
    // La colonna di lettura e le due facce dello stesso testo: l'albero di
    // CodeMirror in Live e Sorgente, l'HTML reso in Lettura.
    { name: "document-column", layers: { "pane-editor": "cornice", "pane-preview": "cornice", "base-surface": "cornice" }, states: [S("rest"), S("focused")], hooks: ["pane-editor", "pane-preview", "markdown-preview", "markdown-rendered", "cm-editor", "cm-fub-markdown", "cm-content", "cm-line", "cm-markdown-block", "cm-markdown-gap-lead", "markdown-table-scroll", "base-surface"] },
    { name: "document-heading", states: REST, hooks: ["cm-fub-heading-line", "cm-fub-h1", "cm-fub-h2", "cm-fub-h3", "cm-fub-h4", "cm-fub-h5", "cm-fub-h6", "cm-fub-h1-line", "cm-fub-h2-line", "cm-fub-h3-line", "cm-fub-h4-line", "cm-fub-h5-line", "cm-fub-h6-line"] },
    { name: "document-inline", states: REST, hooks: ["cm-fub-near", "cm-fub-pending-mark", "cm-fub-ghost", "cm-fub-wavy", "cm-fub-placeholder", "cm-fub-heading-pill-button", "cm-fub-strong", "cm-fub-em", "cm-fub-strike", "cm-fub-code"] },
    { name: "document-link-card", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["cm-fub-link-card", "cm-fub-link-card-main", "cm-fub-link-card-text", "cm-fub-link-card-title", "cm-fub-link-card-desc", "cm-fub-link-card-site", "cm-fub-link-card-icon", "cm-fub-link-card-url", "cm-fub-link-card-note", "cm-fub-link-card-fetch"] },
    { name: "document-address-choice", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["cm-fub-address-choice", "cm-fub-address-choice-link", "cm-fub-address-choice-card", "cm-fub-address-choice-embed"] },
    { name: "document-link", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["cm-fub-link", "cm-fub-wikilink", "cm-fub-link-pill", "cm-fub-person"] },
    { name: "document-callout", states: [S("rest"), S("focused")], hooks: ["callout"] },
    { name: "document-code", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["cm-fub-code-line"] },
    { name: "document-figure", states: REST, hooks: ["math-block", "cm-fub-image", "mermaid-diagram"] },
    { name: "document-embed", states: REST, hooks: ["embed"] },
    { name: "document-blocks", layers: { "cm-fub-block-menu": "cornice" }, states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["cm-fub-block-handles", "cm-fub-blocks-touch", "cm-fub-block-add", "cm-fub-block-grip", "cm-fub-block-grip-eyes", "cm-fub-block-grip-held", "cm-fub-block-drop", "cm-fub-block-selected", "cm-fub-block-mark", "cm-fub-block-pass", "cm-fub-block-lift", "cm-fub-block-lift-card", "cm-fub-block-lift-full", "cm-fub-block-lift-shade", "cm-fub-block-lift-grip", "cm-fub-block-lift-tags", "cm-fub-block-lift-more", "cm-fub-block-lift-to", "cm-fub-block-slot", "cm-fub-block-id", "cm-fub-block-menu"] },
    // La testata della pagina (E3): la stessa in Scrittura e in Lettura.
    { name: "document-page", states: [S("rest"), S("hover"), S("focused")], hooks: ["fub-note--wide"] },
    { name: "document-properties", states: REST, hooks: ["cm-fub-frontmatter", "cm-fub-properties", "cm-fub-properties-hidden", "cm-fub-properties-empty"] },
    { name: "declarative-slot", layer: "cornice", states: REST, hooks: ["ui-slot"] },
  ],
};
