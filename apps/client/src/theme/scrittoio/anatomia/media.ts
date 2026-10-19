/** L'anatomia del pezzo `skin/media.css`. Immagini, zoom, lightbox, SVG. */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const MEDIA: PartAnatomy = {
  part: "media",
  components: [
    // Le immagini della nota e i diagrammi: qui solo il cursore che dice «si
    // apre nella lightbox».
    { name: "markdown-preview", states: REST, hooks: ["markdown-preview", "markdown-rendered", "mermaid-diagram"] },
    { name: "media-viewer", states: [...INTERACTIVE, S("dragging")], hooks: ["media-surface", "media-image", "zoom-view", "zoom-stage", "zoom-content", "zoom-bar", "zoom-button", "zoom-level", "zoom-info"] },
    { name: "lightbox", states: INTERACTIVE, hooks: ["modale", "lightbox", "lightbox-header", "lightbox-caption", "lightbox-close", "lightbox-body", "lightbox-error"] },
    { name: "svg-preview", states: REST, hooks: ["pane-editor", "svg-preview", "svg-error"] },
    { name: "media-pdf", states: INTERACTIVE, hooks: ["media-pdf", "media-pdf-toolbar", "media-pdf-page"] },
    { name: "media-player", states: INTERACTIVE, hooks: ["media-audio", "media-video", "media-error"] },
    { name: "media-recorder", states: INTERACTIVE, hooks: ["media-recorder"] },
    { name: "web-viewer-bar", states: INTERACTIVE, hooks: ["web-viewer-bar", "web-viewer-address"] },
    { name: "slide-deck", states: INTERACTIVE, hooks: ["slide-deck", "slide-status", "slide-stage", "slide", "slide-controls", "block-frontmatter-unparsed"] },
  ],
};
