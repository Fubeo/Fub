/** L'anatomia del pezzo `skin/draw.css`. L'editor dei disegni (FubDraw): la barra, il foglio e i pannelli. */
import { S, SELECTABLE, type PartAnatomy } from "./types";

export const DRAW: PartAnatomy = {
  part: "draw",
  layer: "cornice",
  components: [
    {
      name: "draw-editor",
      states: SELECTABLE,
      // Il foglio è il disegno, con la sua carta; la griglia, le guide, i
      // righelli, il cursore e i segni dei collegamenti sono di Fub.
      layers: {
        "draw-surface": "contenuto", "draw-page": "contenuto", "draw-grid": "segno",
        "draw-cursor": "segno", "draw-link-layer": "segno", "draw-link-mark": "segno", "draw-zoom-box": "segno",
        "draw-navigator": "segno",
      },
      hooks: [
        "draw-header", "draw-toolbar", "draw-export", "draw-export-text", "draw-rail", "draw-group", "draw-button", "draw-zoom-level", "draw-layer-button",
        "draw-layer-state", "draw-swatch-frame", "draw-swatch", "draw-width-bar", "draw-size-glyph", "draw-pen-choice", "draw-pen-name", "draw-pen-gallery", "draw-pen-gallery-heading", "draw-pen-gallery-list", "draw-pen-gallery-item", "draw-pen-gallery-empty", "draw-pen-gallery-save", "draw-pen-preview", "draw-pen-saved-remove", "draw-pen-size", "draw-eraser-mode", "draw-eraser-mode-name", "draw-title",
        "draw-title-input", "draw-surface", "draw-zoom-box", "draw-navigator", "draw-navigator-sheets",
        "draw-navigator-shapes", "draw-navigator-view", "draw-arrange", "draw-arrange-input", "draw-arrange-suffix", "draw-page",
        "draw-sheet-name", "draw-grid", "draw-cursor", "draw-objects",
        "draw-objects-header", "draw-objects-title", "draw-objects-count", "draw-objects-empty",
        "draw-objects-filter", "draw-objects-search", "draw-objects-kind", "draw-objects-status", "draw-objects-tree",
        "draw-object", "draw-object-mark", "draw-object-twisty", "draw-object-sign", "draw-object-rename",
        "draw-object-thumb", "draw-objects-ghost", "draw-history", "draw-history-header", "draw-history-title",
        "draw-history-count", "draw-history-action", "draw-history-note", "draw-history-empty", "draw-history-list",
        "draw-history-row", "draw-history-glyph", "draw-history-now", "draw-history-remove", "draw-history-rename",
        "draw-access", "draw-access-header", "draw-access-title",
        "draw-access-count", "draw-access-summary", "draw-access-note", "draw-access-empty", "draw-access-problem",
        "draw-access-glyph", "draw-access-what", "draw-access-severity", "draw-access-detail", "draw-access-actions",
        "draw-access-action", "draw-access-object", "draw-access-swatch", "draw-access-describe", "draw-access-more",
        "draw-access-tree", "draw-access-row", "draw-access-warning", "draw-access-moves", "draw-isolation",
        "draw-isolation-crumb", "draw-isolation-sep", "draw-progress", "draw-progress-label", "draw-progress-stop",
        "draw-describe", "draw-describe-label", "draw-describe-input", "draw-describe-action", "draw-suggestion",
        "draw-suggestion-icon", "draw-suggestion-off", "draw-link-layer", "draw-link-mark", "draw-radial-ring",
        "draw-radial-item", "draw-radial-center", "draw-radial-caption", "draw-dock",
        "draw-properties", "draw-properties-header", "draw-properties-lead", "draw-properties-title", "draw-properties-subject",
        "draw-properties-section", "draw-properties-toggle", "draw-properties-body", "draw-properties-field",
        "draw-properties-label", "draw-properties-number", "draw-properties-paint", "draw-properties-input",
        "draw-properties-unit", "draw-properties-switch", "draw-properties-note",
        "draw-properties-error", "draw-properties-actions", "draw-properties-bar", "draw-properties-export",
        "draw-properties-menu", "draw-properties-contrast",
      ],
    },
    {
      name: "vector-surface",
      states: [S("rest")],
      hooks: [
        "vector-notice", "vector-about", "vector-about-desc", "vector-about-objects", "vector-about-links",
        "vector-about-links-title", "vector-about-link", "live-bar", "live-state", "live-follow",
      ],
    },
    {
      name: "pdf-surface",
      states: [S("rest"), S("focused"), S("selected")],
      hooks: [
        "pdf-notice-messages", "pdf-pages", "pdf-page-input", "pdf-list", "pdf-list-page", "pdf-list-body",
        "pdf-list-marks",
      ],
    },
  ],
};
