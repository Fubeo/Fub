/** L'anatomia del pezzo `skin/export.css`. Lo spazio «Esporta in PDF» (T70): la barra in alto con «Torna alla nota», lo zoom, le viste, il profilo, «Stampa…» ed «Esporta»; le pagine come usciranno, coi fogli e le fasce dei blocchi; il pannello delle dieci sezioni che si aprono e si chiudono; la banda coi numeri dell'impaginazione. Le sezioni Tema e Colori (T71), e le pagine coi colori e i caratteri del tema di stampa. Testata e piè, frontespizio e indice (T73). Contenuto e Interruzioni (T74). */
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
    // Testata e piè, frontespizio, indice (T73): i sei posti e i controlli
    // del pannello; sulle pagine testata, piè, frontespizio e indice.
    { name: "export-header-footer", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["export-header-section", "export-header-grid", "export-header-row", "export-slot-choice", "is-set", "export-header-lines", "export-header-line", "export-header-line-short", "export-row", "export-row-label", "export-input", "export-front-section", "export-choices", "export-choice"] },
    { name: "export-front-pages", states: [S("rest"), S("selected")], hooks: ["export-header", "export-footer", "has-rule", "export-header-cell", "export-cover", "export-cover-band", "export-cover-icon", "export-cover-title", "export-cover-properties", "export-cover-foot", "export-toc", "export-toc-title", "export-toc-row", "export-toc-name", "export-toc-number", "export-toc-dots", "export-toc-page"] },
    // Le sezioni Contenuto e Interruzioni (T74): le righe con le scelte; sulle
    // pagine le proprietà, i numeri del codice, la provenienza delle note
    // riportate, le schede, le Basi e i commenti, che restano contenuto.
    { name: "export-content-panel", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["export-content-section"] },
    { name: "export-content-pages", layers: { "print-page": "contenuto", "markdown-rendered": "contenuto", embed: "contenuto" }, states: [S("rest")], hooks: ["export-measure", "export-page", "print-page", "markdown-rendered", "embed", "base-surface", "export-properties", "export-code-numbers", "export-code-number", "export-source", "export-card-caption", "export-card-name", "export-card-note", "export-appendix-page", "export-appendix-more", "export-base-caption", "export-comment-mark", "export-comments", "export-comment", "export-comments-title", "export-comment-placed"] },
    { name: "export-sections", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["export-side", "export-section", "is-open", "export-section-head", "export-section-name", "export-section-summary", "export-section-chevron", "export-section-body", "export-note"] },
    // La sezione Diagrammi (T75): gli stili con la miniatura, i quattro
    // colori dati a mano, il fondo; sulle pagine, la riga di ciò che si è
    // rimpicciolito per starci.
    { name: "export-diagrams", states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("focused")], hooks: ["export-dg", "export-dg-styles", "export-dg-style", "export-dg-swatch", "export-dg-swatch-node", "export-dg-swatch-choice", "export-dg-swatch-pill", "export-link", "export-link-inline", "export-dg-colors", "export-dg-color", "export-dg-color-head", "export-dg-chip", "is-none", "export-dg-reset", "export-dg-palette", "export-dg-ink", "export-dg-pick", "export-dg-hex", "export-dg-toggle", "export-fit-note"] },
    { name: "export-band", states: [S("rest")], hooks: ["export-band", "export-band-info", "export-band-pages", "export-band-ms", "export-band-hint"] },
  ],
};
