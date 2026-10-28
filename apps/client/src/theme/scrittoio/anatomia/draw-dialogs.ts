/** L'anatomia del pezzo `skin/draw-dialogs.css`. Le finestre dell'editor dei disegni e i moduli che le comandano. */
import { INTERACTIVE, SELECTABLE, type PartAnatomy } from "./types";

export const DRAW_DIALOGS: PartAnatomy = {
  part: "draw-dialogs",
  layer: "cornice",
  components: [
    {
      name: "draw-dialog-base",
      states: SELECTABLE,
      hooks: [
        "modale", "palette-actions", "palette-box", "palette-form", "palette-row", "draw-new-overlay", "draw-import-overlay",
      ],
    },
    {
      name: "dialog-extras",
      states: SELECTABLE,
      hooks: [
        "palette-color-row", "palette-color", "palette-thumb", "keys-list", "keys-table", "keys-more", "keys-note",
        "keys-show-all", "keys-search", "keys-empty", "keys-changed",
      ],
    },
    {
      name: "draw-commands-dialog",
      states: SELECTABLE,
      hooks: [
        "draw-commands-dialog", "draw-commands", "draw-commands-field", "draw-commands-list", "draw-commands-row",
        "draw-commands-label", "draw-commands-path", "draw-commands-key", "draw-commands-why", "draw-commands-empty",
      ],
    },
    {
      name: "draw-toolbar-dialog",
      states: SELECTABLE,
      hooks: ["draw-toolbar-dialog", "draw-toolbar-custom", "draw-toolbar-list", "draw-toolbar-row", "draw-toolbar-move", "draw-toolbar-reset"],
    },
    {
      name: "draw-guides-dialog",
      states: INTERACTIVE,
      hooks: [
        "draw-guides-message", "draw-guides-scroll", "draw-guides-table", "draw-guides-check", "draw-guides-remove",
        "draw-guides-tools", "draw-guides-clear",
      ],
    },
    {
      name: "draw-symbol-update-dialog",
      states: INTERACTIVE,
      hooks: [
        "draw-symbol-update-message", "draw-symbol-update-pair", "draw-symbol-update-side",
        "draw-symbol-update-frame", "draw-symbol-update-caption",
      ],
    },
    {
      name: "draw-editable-dialog",
      states: INTERACTIVE,
      hooks: [
        "draw-editable-message", "draw-editable-pair", "draw-editable-side", "draw-editable-frame",
        "draw-editable-caption", "draw-editable-details", "draw-editable-heading", "draw-editable-list",
        "draw-editable-more",
      ],
    },
    {
      name: "draw-touch-dialog",
      states: INTERACTIVE,
      hooks: [
        "draw-touch-group", "draw-touch-check", "draw-touch-hint", "draw-touch-pressure", "draw-touch-curve",
        "draw-touch-knobs", "draw-touch-knob", "draw-touch-diagonal", "draw-touch-line", "draw-touch-dot",
        "draw-touch-pad", "draw-touch-sample", "draw-touch-strokes", "draw-touch-tools", "draw-hand-panel",
      ],
    },
    {
      name: "draw-export-dialog",
      states: INTERACTIVE,
      hooks: [
        "draw-export", "draw-export-layout", "draw-export-choices", "draw-export-group", "draw-export-option",
        "draw-export-boards", "draw-export-row", "draw-export-width", "draw-export-hint", "draw-export-preview",
        "draw-export-stage", "draw-export-sheet", "draw-export-image", "draw-export-marks", "draw-export-field",
        "draw-export-select", "draw-export-unit", "draw-export-subgroup", "draw-export-pager", "draw-export-page",
        "draw-export-turn", "draw-export-measure",
      ],
    },
    {
      name: "new-drawing-gallery",
      states: SELECTABLE,
      hooks: [
        "draw-new", "draw-new-form", "draw-new-body", "draw-new-fields", "draw-new-field",
        "draw-new-group", "draw-new-group-title", "draw-new-group-hint", "draw-new-cards", "draw-new-card",
        "draw-new-preview", "draw-new-image", "draw-new-blank", "draw-new-card-head", "draw-new-card-name",
        "draw-new-card-note", "draw-new-vault", "draw-new-vault-item", "draw-new-vault-name",
      ],
    },
    {
      name: "import-drawing",
      states: INTERACTIVE,
      hooks: [
        "draw-import", "draw-import-form", "draw-import-body", "draw-import-from",
        "draw-import-preview", "draw-import-image", "draw-import-status", "draw-import-count", "draw-import-report",
        "draw-import-report-title", "draw-import-report-none", "draw-import-notes", "draw-import-note",
        "draw-import-fields", "draw-import-field",
      ],
    },
  ],
};
