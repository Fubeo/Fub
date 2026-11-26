/** L'anatomia del pezzo `skin/document-page.css`. Il documento: la testata della pagina, le proprietà, le definizioni, i commenti. */
import { REST, S, type PartAnatomy } from "./types";

export const DOCUMENT_PAGE: PartAnatomy = {
  part: "document-page",
  layer: "contenuto",
  components: [
    // La colonna di lettura e le due facce dello stesso testo: l'albero di
    // CodeMirror in Live e Sorgente, l'HTML reso in Lettura.
    { name: "document-column", layers: { "pane-editor": "cornice" }, states: [S("rest"), S("focused")], hooks: ["pane-editor", "markdown-rendered", "cm-editor", "cm-content"] },
    { name: "document-inline", states: REST, hooks: ["cm-fub-highlight", "inline-highlight", "cm-fub-comment"] },
    { name: "document-color", states: REST, hooks: ["fub-color-gray", "fub-color-brown", "fub-color-orange", "fub-color-yellow", "fub-color-green", "fub-color-blue", "fub-color-purple", "fub-color-pink", "fub-color-red", "fub-bg-gray", "fub-bg-brown", "fub-bg-orange", "fub-bg-yellow", "fub-bg-green", "fub-bg-blue", "fub-bg-purple", "fub-bg-pink", "fub-bg-red"] },
    { name: "document-link", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["unresolved", "footnote-ref", "footnote-backref", "footnote-inline", "cm-fub-footnote-label", "cm-fub-footnote-back"] },
    { name: "document-tag", states: [S("rest"), S("hover"), S("focused")], hooks: ["tag", "cm-fub-tag"] },
    { name: "document-figure", states: REST, hooks: ["image-missing"] },
    { name: "document-blocks", layers: { "cm-fub-block-menu": "cornice" }, states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["cm-fub-blocks-touch", "cm-fub-block-menu", "cm-fub-color-swatch"] },
    // La testata della pagina (E3): la stessa in Scrittura e in Lettura.
    { name: "document-page", states: [S("rest"), S("hover"), S("focused")], hooks: ["cm-fub-page", "cm-fub-page-cover", "cm-fub-page-cover-tools", "cm-fub-page-cover-tool", "cm-fub-page-cover-moving", "cm-fub-page-cover-hint", "cm-fub-page-icon", "cm-fub-page-tools", "cm-fub-page-tool", "cm-fub-page-title", "cm-fub-page-check", "fub-note--wide", "fub-note--small", "fub-note--serif", "fub-note--sans", "fub-note--mono"] },
    // Il tipo della nota (E5): l'avviso di un tipo guasto e i suoi gesti.
    { name: "document-page-type", states: [S("rest"), S("hover"), S("focused")], hooks: ["cm-fub-page-type-notice", "cm-fub-page-type-text", "cm-fub-page-type-action", "cm-fub-page-icon"] },
    // Le proprietà (E5) e gli editor dei tipi (T8): i riquadri stanno sopra il foglio.
    { name: "document-page-properties", layers: { "cm-fub-prop-date": "cornice", "cm-fub-prop-date-field": "cornice", "cm-fub-prop-date-quick": "cornice", "cm-fub-prop-date-choice": "cornice", "cm-fub-prop-date-head": "cornice", "cm-fub-prop-date-nav": "cornice", "cm-fub-prop-date-grid": "cornice", "cm-fub-prop-date-day": "cornice", "cm-fub-prop-date-time": "cornice", "cm-fub-prop-date-foot": "cornice", "cm-fub-prop-date-action": "cornice", "cm-fub-prop-list": "cornice", "cm-fub-prop-chips": "cornice", "cm-fub-prop-chip-remove": "cornice", "cm-fub-prop-list-input": "cornice", "cm-fub-prop-people": "cornice", "cm-fub-prop-search": "cornice", "cm-fub-prop-options": "cornice", "cm-fub-prop-note": "cornice", "cm-fub-prop-note-action": "cornice", "cm-fub-prop-choices": "cornice", "cm-fub-prop-relation": "cornice", "cm-fub-prop-group": "cornice", "cm-fub-prop-create": "cornice", "cm-fub-prop-empty": "cornice", "cm-fub-prop-foot": "cornice", "cm-fub-prop-menu": "cornice", "cm-fub-prop-menu-head": "cornice", "cm-fub-prop-menu-label": "cornice", "cm-fub-prop-menu-hint": "cornice" }, states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["cm-fub-page-props", "cm-fub-page-prop", "cm-fub-page-prop-key", "cm-fub-page-prop-value", "cm-fub-page-props-more", "cm-fub-page-props-add", "cm-fub-page-unreadable", "cm-fub-page-prop-name", "cm-fub-prop-chip", "cm-fub-prop-tag", "cm-fub-prop-opt", "cm-fub-prop-person", "cm-fub-prop-avatar", "cm-fub-prop-check", "cm-fub-prop-mismatch", "cm-fub-prop-input", "cm-fub-prop-date", "cm-fub-prop-date-field", "cm-fub-prop-date-quick", "cm-fub-prop-date-choice", "cm-fub-prop-date-head", "cm-fub-prop-date-nav", "cm-fub-prop-date-grid", "cm-fub-prop-date-day", "cm-fub-prop-date-time", "cm-fub-prop-date-foot", "cm-fub-prop-date-action", "cm-fub-prop-list", "cm-fub-prop-chips", "cm-fub-prop-chip-remove", "cm-fub-prop-list-input", "cm-fub-prop-people", "cm-fub-prop-search", "cm-fub-prop-options", "cm-fub-prop-note", "cm-fub-prop-note-action", "cm-fub-prop-choices", "cm-fub-prop-group", "cm-fub-prop-create", "cm-fub-prop-empty", "cm-fub-prop-foot", "cm-fub-prop-relation", "cm-fub-prop-rels", "cm-fub-prop-rel", "cm-fub-prop-rel-text", "cm-fub-prop-url", "cm-fub-prop-url-cell", "cm-fub-prop-url-edit", "cm-fub-prop-menu", "cm-fub-prop-menu-head", "cm-fub-prop-menu-label", "cm-fub-prop-menu-hint"] },
    // La riga dei dati sotto il titolo: modificata, collegamenti, etichette.
    { name: "document-facts", states: [S("rest"), S("hover"), S("focused")], hooks: ["note-facts", "note-fact", "note-fact-tags", "note-tag"] },
    { name: "link-dialog", layer: "cornice", states: [S("rest"), S("hover"), S("focused")], hooks: ["md-link-dialog", "md-link-dialog-notes", "md-link-dialog-note", "md-link-dialog-preview"] },
  ],
};
