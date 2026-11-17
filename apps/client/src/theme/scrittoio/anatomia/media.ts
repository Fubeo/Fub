/** L'anatomia del pezzo `skin/media.css`. Immagini, zoom, lightbox, SVG. */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const MEDIA: PartAnatomy = {
  part: "media",
  layer: "contenuto",
  components: [
    // Le immagini della nota e i diagrammi: qui solo il cursore che dice «si
    // apre nella lightbox».
    { name: "markdown-preview", states: REST, hooks: ["markdown-preview", "markdown-rendered", "mermaid-diagram"] },
    { name: "media-viewer", layers: { "media-surface": "cornice", "zoom-bar": "cornice", "zoom-button": "cornice", "zoom-level": "cornice", "zoom-info": "cornice" }, states: [...INTERACTIVE, S("dragging")], hooks: ["media-surface", "media-image", "zoom-view", "zoom-stage", "zoom-content", "zoom-bar", "zoom-button", "zoom-level", "zoom-info"] },
    { name: "lightbox", layer: "cornice", layers: { "lightbox-body": "contenuto" }, states: INTERACTIVE, hooks: ["modale", "lightbox", "lightbox-header", "lightbox-caption", "lightbox-close", "lightbox-body", "lightbox-error"] },
    { name: "svg-preview", layers: { "pane-editor": "cornice", "svg-error": "cornice" }, states: REST, hooks: ["pane-editor", "svg-preview", "svg-error"] },
    { name: "media-pdf", layers: { "media-pdf-toolbar": "cornice", "media-pdf-search": "cornice", "kit-bar-field": "cornice", "kit-options-more": "cornice", "media-pdf-thumbs": "cornice" }, states: INTERACTIVE, hooks: ["media-pdf", "media-pdf-toolbar", "media-pdf-search", "kit-bar-field", "kit-options-more", "media-pdf-page", "media-pdf-spread", "media-pdf-body", "media-pdf-thumbs", "media-pdf-annotations"] },
    { name: "media-player", layers: { "media-error": "cornice" }, states: INTERACTIVE, hooks: ["media-audio", "media-video", "media-error"] },
    { name: "craft-card", layer: "cornice", states: INTERACTIVE, hooks: ["craft-card", "craft-info", "craft-empty", "craft-empty-name", "craft-empty-state", "craft-render"] },
    // La domanda sulle anteprime fatte dalle app e la riga «spente» (T23).
    { name: "craft-ask", layer: "cornice", states: INTERACTIVE, hooks: ["craft-ask", "craft-ask-text", "craft-ask-actions", "craft-ask-answer", "craft-ask-hint", "craft-off"] },
    { name: "craft-xmp", layer: "cornice", states: INTERACTIVE, hooks: ["craft-xmp", "craft-xmp-body", "craft-xmp-head", "craft-xmp-title", "craft-xmp-fields", "craft-xmp-field", "craft-xmp-absent", "craft-xmp-stars", "craft-xmp-star", "craft-xmp-label", "craft-xmp-swatch", "craft-xmp-tags", "craft-xmp-tag", "craft-xmp-edits", "craft-xmp-link", "craft-xmp-note"] },
    { name: "photo-data", layer: "cornice", states: INTERACTIVE, hooks: ["photo-data", "photo-data-line", "photo-data-tags", "photo-data-open"] },
    { name: "media-recorder", layer: "cornice", states: INTERACTIVE, hooks: ["media-recorder"] },
    { name: "web-viewer-bar", layer: "cornice", states: INTERACTIVE, hooks: ["web-viewer-bar", "web-viewer-address"] },
    { name: "slide-deck", layers: { "slide-status": "cornice", "slide-controls": "cornice", "block-frontmatter-unparsed": "contenuto" }, states: INTERACTIVE, hooks: ["slide-deck", "slide-status", "slide-stage", "slide", "slide-controls", "block-frontmatter-unparsed"] },
  ],
};
