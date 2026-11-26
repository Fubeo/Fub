/** L'anatomia del pezzo `skin/canvas.css`. La lavagna: la superficie, gli strumenti, le barre, i pannelli. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const CANVAS: PartAnatomy = {
  part: "canvas",
  layer: "cornice",
  components: [
    // La griglia e le guide (T71) sono segni di Fub sulla vista, non contenuto.
    { name: "canvas-surface", layers: { "canvas-viewport": "contenuto", "canvas-grid": "segno", "canvas-guide": "segno" }, states: INTERACTIVE, hooks: ["canvas-surface", "canvas-toolbar", "canvas-toolbar-item", "kit-options-row", "canvas-intake-error", "canvas-viewport", "canvas-large-fallback", "canvas-grid", "canvas-guide"] },
    // La colonna degli strumenti della lavagna (T49): quella del kit, con le
    // caselle `canvas-tool`; uno strumento spento in sola lettura si vede.
    { name: "canvas-rail", states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("disabled")], hooks: ["canvas-rail", "canvas-tool"] },
    // La lavagna vuota (T62): le tre righe e i pulsanti al centro. I pulsanti
    // sono del kit; qui solo il testo.
    { name: "canvas-empty", states: REST, hooks: ["canvas-blank", "canvas-blank-lines", "canvas-blank-actions"] },
    // Il navigatore della lavagna (T55): la mappa è una sola <canvas> dipinta
    // coi colori della pelle (le variabili di `.canvas-navigator`).
    { name: "canvas-navigator", states: [S("rest"), S("focused")], hooks: ["canvas-navigator"] },
    // Cerca nella lavagna (T60): la barra in alto a destra della vista, col
    // campo, il contatore e la riga che dice «senza indice»; i pulsanti sono
    // quelli della riga (`canvas-button`).
    { name: "canvas-find", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["canvas-find", "canvas-find-input", "canvas-find-count", "canvas-find-scope"] },
    // La riga delle opzioni della lavagna (T50): la testata, i gruppi e i
    // pulsanti della riga del kit, il pozzo del colore delle schede scelte,
    // le «A» della misura del testo (T92).
    { name: "canvas-options", states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("selected"), S("disabled")], hooks: ["canvas-header", "canvas-options", "canvas-options-hint", "canvas-group", "canvas-button", "canvas-color-well", "canvas-text-size"] },
    // La barra della selezione della lavagna (T51): una pillola sopra le
    // schede scelte, coi pulsanti della riga e il pallino del colore.
    { name: "canvas-selection-bar", states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("disabled")], hooks: ["canvas-selection-bar", "canvas-selection-chip"] },
    // Il menu della penna della lavagna (N4 T21): il pulsante nella riga
    // delle opzioni e il suo rialzo. Le anteprime sono inchiostro su carta.
    { name: "canvas-pen-menu", states: SELECTABLE, hooks: ["canvas-ink-pen", "canvas-ink-pen-name", "canvas-pen-popover", "canvas-pen-menu", "canvas-pen-section", "canvas-pen-heading", "canvas-pen-list", "canvas-pen-item", "canvas-pen-preview", "canvas-pen-swatches", "canvas-pen-swatch", "canvas-pen-more", "canvas-pen-note", "canvas-pen-width", "canvas-pen-width-value", "canvas-pen-width-preview"] },
    // L'ispettore della lavagna (T58): «Schede», il filtro e l'elenco in
    // ordine di lettura, nel pannello della shell. T59: «Scheda» e «Fili», con
    // i numeri, il pozzo del colore, «Avanzate» e il popover dei colori.
    { name: "canvas-inspector", states: [S("rest"), S("hover"), S("focused"), S("selected")], hooks: ["canvas-inspector", "canvas-inspector-filter", "canvas-inspector-heading", "canvas-inspector-list", "canvas-inspector-row", "canvas-inspector-kind", "canvas-inspector-note", "canvas-inspector-numbers", "canvas-inspector-fields", "canvas-inspector-field", "canvas-inspector-path", "canvas-inspector-disclosure", "canvas-inspector-raw", "canvas-inspector-actions", "canvas-inspector-tips", "canvas-inspector-swatches", "canvas-inspector-swatch", "canvas-inspector-popover"] },
    // Le fonti della lavagna (T77), la linguetta «Fonti» dell'ispettore: una
    // riga per file col nome, il numero delle schede e la barra delle pagine o
    // delle sezioni, i pezzi sulla lavagna in colore d'accento.
    { name: "canvas-sources", states: [S("rest"), S("hover"), S("focused"), S("selected"), S("disabled")], hooks: ["canvas-sources-list", "canvas-sources-file", "canvas-sources-name", "canvas-sources-count", "canvas-sources-bar", "canvas-sources-piece", "canvas-sources-loose", "canvas-sources-state", "canvas-sources-empty"] },
    // Il selettore delle sezioni di una nota (T74): un popover del kit
    // attaccato alla scheda, con il campo, la lista a caselle, l'anteprima
    // (la resa della scheda di nota) e il piede.
    { name: "canvas-parts-picker", states: [S("rest"), S("hover"), S("focused"), S("selected")], hooks: ["canvas-parts-title", "canvas-parts-close", "canvas-parts-field-hint", "canvas-parts-row", "canvas-parts-check", "canvas-parts-preview", "canvas-parts-preview-title", "canvas-card-note-content", "canvas-parts-keys", "canvas-parts-count"] },
    // Il ritaglio di un'immagine (T78):la zona col velo e le maniglie sopra
    // la scheda, la barra sotto e la riga dell'inchiostro; segni di Fub sulla
    // lavagna. L'immagine intera sotto la zona (`canvas-crop-picture`) e la
    // zona di un SVG nella scheda (`canvas-card-zone`) sono solo impianto.
    { name: "canvas-crop", layers: { "canvas-crop-box": "segno", "canvas-crop-handle": "segno" }, states: [S("rest"), S("hover"), S("focused")], hooks: ["canvas-crop", "canvas-crop-box", "canvas-crop-handle", "canvas-crop-bar", "canvas-crop-note"] },
  ],
};
