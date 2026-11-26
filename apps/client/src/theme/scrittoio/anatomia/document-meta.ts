/** L'anatomia del pezzo `skin/document-meta.css`. Il documento: proprietà, note a piè, UI dichiarativa, anteprima al passaggio, riga dei dati. */
import { REST, S, type PartAnatomy } from "./types";

export const DOCUMENT_META: PartAnatomy = {
  part: "document-meta",
  layer: "contenuto",
  components: [
    // La colonna di lettura e le due facce dello stesso testo: l'albero di
    // CodeMirror in Live e Sorgente, l'HTML reso in Lettura.
    { name: "document-column", layers: { "pane-editor": "cornice", "pane-preview": "cornice" }, states: [S("rest"), S("focused")], hooks: ["pane-editor", "pane-preview", "markdown-preview", "markdown-rendered", "cm-editor", "cm-content", "cm-line"] },
    { name: "document-tag", states: [S("rest"), S("hover"), S("focused")], hooks: ["tag", "cm-fub-tag"] },
    // La testata della pagina (E3): la stessa in Scrittura e in Lettura.
    { name: "document-page", states: [S("rest"), S("hover"), S("focused")], hooks: ["cm-fub-page"] },
    // La riga dei dati sotto il titolo: modificata, collegamenti, etichette.
    { name: "document-facts", states: [S("rest"), S("hover"), S("focused")], hooks: ["note-facts", "note-fact", "note-fact-tags", "note-tag"] },
    // I commenti (T22): il segno nel margine o nel testo, la discussione nel
    // popover, il pannello «Commenti» dell'ispettore.
    { name: "document-comment-margin", layer: "segno", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["cm-fub-comment-margin", "cm-fub-comment-bubble", "cm-fub-comment-sign", "cm-fub-comment-avatar"] },
    { name: "document-comment-discussion", layer: "cornice", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["kit-popover", "cm-fub-comment-popover", "cm-fub-comment-discussion", "cm-fub-comment-quote", "cm-fub-comment-note", "cm-fub-comment-name", "cm-fub-comment-name-hint", "cm-fub-comment-message", "cm-fub-comment-write", "cm-fub-comment-input", "cm-fub-comment-send", "cm-fub-comment-actions", "cm-fub-comment-actions-end", "cm-fub-comment-action", "cm-fub-comment-foot"] },
    { name: "document-comments-panel", layer: "cornice", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["cm-fub-comments-panel", "cm-fub-comments-head", "cm-fub-comments-card", "cm-fub-comments-quote", "cm-fub-comments-who", "cm-fub-comments-replies", "cm-fub-comments-archived", "cm-fub-comments-note", "cm-fub-comments-empty", "cm-fub-comments-clear"] },
    { name: "document-properties", states: REST, hooks: ["cm-fub-frontmatter", "block-frontmatter-unparsed", "block-footnote-definition"] },
    { name: "declarative-slot", layer: "cornice", states: REST, hooks: ["ui-slot"] },
    { name: "declarative-node-content", layer: "cornice", states: REST, hooks: ["ui-heading", "empty-note"] },
    { name: "declarative-node-feedback", layer: "cornice", states: [S("rest"), S("hover"), S("pressed")], hooks: ["ui-list-item", "ui-list-item-title", "ui-list-item-subtitle", "clickable"] },
    { name: "link-preview", layer: "cornice", states: [S("rest"), S("focused")], hooks: ["link-preview", "doc-preview"] },
  ],
};
