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
        "draw-export", "draw-export-text", "draw-rail", "draw-group", "draw-button", "kit-bar-button", "draw-zoom-level", "draw-layer-button",
        "draw-layer-state", "draw-swatch-frame", "draw-swatch", "draw-width-bar", "draw-size-glyph", "draw-pen-choice", "draw-pen-name", "draw-pen-gallery", "draw-pen-gallery-heading", "draw-pen-gallery-list", "draw-pen-gallery-item", "draw-pen-gallery-empty", "draw-pen-gallery-save", "draw-pen-preview", "draw-pen-saved-remove", "draw-pen-size", "draw-eraser-mode", "draw-eraser-mode-name", "draw-title",
        "draw-title-input", "draw-surface", "draw-zoom-box", "draw-navigator", "draw-navigator-sheets",
        "draw-navigator-shapes", "draw-navigator-view", "draw-engine-line", "draw-engine-point", "draw-engine-point-pieno", "draw-engine-handle", "draw-arrange", "draw-arrange-input", "draw-arrange-suffix", "draw-page",
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
        "draw-resources-swatches", "draw-resources-corpo", "draw-point-place", "draw-point-coord", "kit-number", "kit-number-box",
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
      // Il cassetto «Tutti gli strumenti» (K6 T8): un popover del kit con la
      // ricerca, i gruppi e le caselle degli strumenti.
      name: "draw-drawer",
      states: SELECTABLE,
      hooks: [
        "kit-popover", "draw-drawer-popover", "draw-drawer", "draw-drawer-head", "draw-drawer-title", "draw-drawer-note",
        "draw-drawer-field", "draw-drawer-groups", "draw-drawer-group", "draw-drawer-heading", "draw-drawer-grid",
        "draw-drawer-tool", "draw-drawer-icon", "draw-drawer-name", "draw-drawer-keys", "draw-drawer-empty",
        "draw-drawer-edit",
      ],
    },
    {
      // I righelli di bordo del foglio (K6 T11, giro E): due righe SVG dentro il foglio,
      // con le tacche e i numeri. Stanno sopra il disegno, e il puntatore le attraversa.
      name: "draw-rulers",
      states: SELECTABLE,
      hooks: ["draw-ruler-x", "draw-ruler-y", "draw-ruler-tick", "draw-ruler-label"],
    },
    {
      // Il menu dello zoom della banda (K6 T11): un popover del kit con le sue voci
      // e il campo della percentuale. Il popover è `kit-popover`, già nel cassetto.
      name: "draw-zoom-menu",
      states: SELECTABLE,
      hooks: [
        "draw-zoom-popover", "draw-zoom-body", "draw-zoom-menu", "draw-zoom-item", "draw-zoom-separator", "draw-zoom-field",
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
    {
      name: "align-section",
      states: [S("rest"), S("focused")],
      hooks: ["draw-align-to", "draw-align-group", "kit-button"],
    },
    {
      name: "transform-section",
      states: [S("rest"), S("focused")],
      hooks: ["draw-transform-grid"],
    },
    {
      name: "color-section",
      states: [S("rest"), S("focused"), S("disabled")],
      hooks: ["draw-color", "draw-color-wells", "draw-color-label", "draw-color-active", "draw-color-actions", "kit-color-well", "kit-color-well-button", "kit-color-well-name", "kit-button"],
    },
    {
      // Design › Sfumatura (K6 T15, giro 5): il lato e il tipo, l'angolo, la striscia dei colori, i punti
      // (il punto scelto) con il pozzo del kit, e le azioni.
      name: "gradient-section",
      states: [S("rest"), S("focused"), S("selected"), S("disabled")],
      hooks: [
        "draw-gradient", "draw-gradient-field", "draw-gradient-row", "draw-gradient-bar", "draw-gradient-stops",
        "draw-gradient-stop", "draw-gradient-stop-chosen", "draw-gradient-actions", "draw-gradient-create",
        "kit-color-well", "kit-color-well-button", "kit-color-well-name", "kit-number", "kit-button",
      ],
    },
    {
      name: "text-section",
      states: [S("rest"), S("focused")],
      hooks: ["draw-type", "draw-type-family", "draw-type-style", "draw-type-sizes", "draw-type-align", "kit-font-button"],
    },
    {
      // Risorse › Campioni (K6 T14, giro 2): la griglia del kit, il campione scelto, le azioni e la
      // finestra «Nuovo campione» col selettore del kit.
      name: "swatches-section",
      states: [S("rest"), S("focused"), S("selected"), S("disabled")],
      hooks: [
        "draw-resources-swatches", "draw-resources-swatches-actions", "draw-resources-swatches-label",
        "draw-resources-swatches-picker", "kit-color", "kit-button",
      ],
    },
  ],
};
