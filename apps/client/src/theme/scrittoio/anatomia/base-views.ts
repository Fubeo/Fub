/** L'anatomia del pezzo `skin/base-views.css`. La Base: le viste. */
import { DRAGGABLE, INTERACTIVE, S, type PartAnatomy } from "./types";

export const BASE_VIEWS: PartAnatomy = {
  part: "base-views",
  layer: "cornice",
  components: [
    { name: "base-surface", states: INTERACTIVE, hooks: ["base-body", "base-summaries"] },
    { name: "base-table", layer: "contenuto", states: [S("rest"), S("hover"), S("focused")], hooks: ["base-table", "base-table-viewport", "base-cell", "base-cell-error", "base-head", "base-head-icon", "base-head-label", "base-head-sort", "base-title", "base-add-row", "base-add-row-button", "base-foot-count", "base-foot-summary", "base-foot-value", "base-foot-error", "base-foot-dimmed"] },
    { name: "base-cards", layer: "contenuto", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["base-cards", "base-list", "base-card", "base-field"] },
    { name: "base-kanban", layer: "contenuto", states: DRAGGABLE, hooks: ["base-kanban", "base-kanban-column", "base-kanban-card", "base-kanban-head", "base-kanban-empty", "base-view-key", "base-view-key-select"] },
    // Il calendario (T17): la testa col mese e i passi, la griglia dei
    // giorni, le note che si trascinano e «+N»; il vuoto senza la data.
    { name: "base-calendar", layer: "contenuto", states: DRAGGABLE, hooks: ["base-calendar", "base-cal-head", "base-cal-title", "base-cal-nav", "base-cal-prev", "base-cal-today", "base-cal-undated", "base-cal-scroll", "base-cal-grid", "base-cal-week", "base-cal-dow", "base-cal-day", "base-cal-num", "base-cal-weekday", "base-cal-event", "base-cal-more", "base-cal-empty"] },
    // La linea del tempo (T34): la testa con i passi e la scala, la riga dei
    // nomi delle colonne, le righe con le barre, i punti, i bordi che si
    // prendono e le date fuori dai giorni mostrati; il vuoto senza l'inizio.
    { name: "base-timeline", layer: "contenuto", states: DRAGGABLE, hooks: ["base-timeline", "base-tl-head", "base-tl-title", "base-tl-nav", "base-tl-prev", "base-tl-today", "base-tl-zoom", "base-tl-zoom-option", "base-tl-undated", "base-tl-scroll", "base-tl", "base-tl-axis", "base-tl-axis-label", "base-tl-scale", "base-tl-tick", "base-tl-now", "base-tl-row", "base-tl-name", "base-tl-track", "base-tl-bar", "base-tl-edge", "base-tl-point", "base-tl-off", "base-tl-none", "base-tl-empty"] },
    { name: "base-map", layer: "contenuto", states: [S("rest"), S("focused")], hooks: ["base-map-atlas", "base-map-marker"] },
  ],
};
