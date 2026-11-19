/** L'anatomia del pezzo `skin/export.css`. Lo spazio «Esporta in PDF» (T70): la barra in alto con «Torna alla nota», lo zoom, le viste, il profilo, «Stampa…» ed «Esporta»; le pagine come usciranno, coi fogli e le fasce dei blocchi; il pannello delle dieci sezioni che si aprono e si chiudono; la banda coi numeri dell'impaginazione. Le sezioni Tema e Colori (T71), e le pagine coi colori e i caratteri del tema di stampa. Le sezioni Caratteri e Pagina (T72), con le guide dei margini e la filigrana sulle pagine. */
import { S, type PartAnatomy } from "./types";

export const EXPORT: PartAnatomy = {
  part: "export",
  layer: "cornice",
  components: [
    { name: "export-surface", states: [S("rest"), S("focused")], hooks: ["export-space", "export-main", "export-icon", "export-icon-small", "export-spacer"] },
    { name: "export-toolbar", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["export-top", "export-back", "export-back-label", "export-title", "export-title-name", "export-title-note", "export-zoom", "export-zoom-button", "export-zoom-value", "export-segments", "export-views", "export-segment", "export-profile", "export-profile-name", "export-print", "export-print-label", "export-go"] },
    // Le pagine: il palco, i fogli scalati allo zoom, le fasce coi blocchi
    // copiati dalla resa per la stampa, che restano contenuto.
    { name: "export-pages", layers: { "print-page": "contenuto" }, states: [S("rest"), S("hover"), S("focused")], hooks: ["export-stage", "export-doc", "export-slot", "export-page", "export-page-body", "export-fascia", "export-fascia-content", "export-fit", "print-page"] },
    // Le pagine coi colori e i caratteri del tema di stampa (T71): la resa
    // che si misura e le sue copie, che restano contenuto.
    { name: "export-print-theme", layers: { "print-page": "contenuto", "markdown-rendered": "contenuto", callout: "contenuto", "callout-title": "contenuto" }, states: [S("rest"), S("selected")], hooks: ["export-measure", "export-page", "export-doc", "export-slot", "print-page", "markdown-rendered", "callout", "callout-title"] },
    // Le sezioni Tema e Colori (T71).
    { name: "export-theme", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["export-theme-section", "export-themes", "export-theme", "export-theme-preview", "export-theme-heading", "export-theme-line", "export-theme-line-short", "export-theme-box", "export-link"] },
    { name: "export-colors", states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("focused")], hooks: ["export-color-section", "export-colors", "export-color", "is-open", "export-color-head", "export-color-chip", "export-color-name", "export-color-own", "export-color-code", "export-color-reset", "export-palette", "export-swatch", "export-pick", "export-pick-input", "export-hex", "export-hex-error", "export-contrast", "is-low", "export-toggle", "export-toggle-hint", "export-toggle-knob"] },
    // Le sezioni Caratteri e Pagina (T72), le guide dei margini e la
    // filigrana sulle pagine.
    { name: "export-fonts", states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("disabled"), S("focused")], hooks: ["export-fonts", "export-font", "is-closed", "export-fonts-status", "export-fonts-warning", "export-row", "export-row-stacked", "export-row-label", "export-range", "export-segments", "export-segment", "export-toggle", "export-toggle-hint", "export-toggle-knob", "export-note"] },
    { name: "export-page-setup", states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("focused"), S("disabled")], hooks: ["export-mm", "export-mm-paper", "export-mm-field", "export-mm-input", "export-page-error", "export-input", "export-row", "export-row-label", "export-segments", "export-segment", "export-toggle", "export-toggle-hint", "export-toggle-knob", "export-note"] },
    { name: "export-guides", layers: { "export-watermark": "contenuto" }, states: [S("rest"), S("hover"), S("dragging")], hooks: ["export-guide", "export-guide-tip", "export-watermark", "export-doc", "export-space", "is-dragging", "export-page", "export-slot"] },
    { name: "export-sections", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["export-side", "export-section", "is-open", "export-section-head", "export-section-name", "export-section-summary", "export-section-chevron", "export-section-body", "export-note"] },
    { name: "export-band", states: [S("rest")], hooks: ["export-band", "export-band-info", "export-band-pages", "export-band-ms", "export-band-hint"] },
  ],
};
