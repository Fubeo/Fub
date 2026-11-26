/** L'anatomia del pezzo `skin/base-bar.css`. La Base: la superficie, la barra delle viste, i popover. */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const BASE_BAR: PartAnatomy = {
  part: "base-bar",
  layer: "cornice",
  components: [
    // L'editor di testo che sta sotto a tutte le superfici: sono classi di
    // CodeMirror, e la pelle le veste tutte — il tema dell'editor
    // (`editors/text/theme.ts`) non porta colori (issue #242).
    { name: "text-editor", layer: "contenuto", states: [S("rest"), S("focused"), S("selected")], hooks: ["cm-content"] },
    { name: "base-surface", states: INTERACTIVE, hooks: ["base-surface", "base-status", "base-body"] },
    // La Base incorporata in una nota (T18): l'embed che la porta, senza il
    // filo delle note riportate, e la larghezza fino al margine.
    { name: "base-embed", states: REST, hooks: ["ui-slot", "ui-custom"] },
    // La barra della Base (T15): le linguette delle viste, gli strumenti,
    // «+» (una vista nuova), «Nuova», la riga di «Cerca», le etichette e «Nel
    // file .base».
    { name: "base-bar", states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("disabled")], hooks: ["base-bar", "base-tabs", "base-tab", "base-tab-label", "base-tab-more", "base-tab-more-count", "base-bar-space", "base-tool", "base-tool-count", "base-tool-new-view", "compact", "stacked", "on", "base-new", "base-search-row", "base-search", "base-strip", "base-chips", "base-chip", "base-note", "base-written", "base-written-lines", "base-written-where", "base-written-added", "base-written-removed"] },
    // I popover della barra: Filtro, Ordina (con «Raggruppa»), Proprietà, e
    // «Rinomina la proprietà» del menu della colonna.
    { name: "base-popover", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["base-popover", "base-pop-title", "base-pop-note", "base-pop-foot", "base-filter-rows", "base-filter-row", "base-filter-value", "base-filter-search", "base-filter-remove", "base-filter-add", "base-sort-rows", "base-sort-row", "base-sort-name", "base-sort-add", "base-sort-remove", "base-grouping", "base-column-list", "base-column", "base-column-grip", "base-column-hidden", "base-column-label", "base-column-fixed", "base-column-fixed-note", "dragging", "base-rename", "base-rename-field"] },
    { name: "base-map", layer: "contenuto", layers: { "base-map-attribution": "cornice" }, states: [S("rest"), S("focused")], hooks: ["base-map-attribution"] },
    { name: "tasks-block", layer: "segno", layers: { "markdown-rendered": "contenuto" }, states: [S("rest"), S("hover"), S("focused"), S("selected")], hooks: ["markdown-rendered"] },
  ],
};
