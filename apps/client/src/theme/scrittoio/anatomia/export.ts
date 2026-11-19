/** L'anatomia del pezzo `skin/export.css`. Lo spazio «Esporta in PDF» (T70): la barra in alto con «Torna alla nota», lo zoom, le viste, il profilo, «Stampa…» ed «Esporta»; le pagine come usciranno, coi fogli e le fasce dei blocchi; il pannello delle dieci sezioni che si aprono e si chiudono; la banda coi numeri dell'impaginazione. */
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
    { name: "export-sections", states: [S("rest"), S("hover"), S("selected"), S("focused")], hooks: ["export-side", "export-section", "is-open", "export-section-head", "export-section-name", "export-section-summary", "export-section-chevron", "export-section-body", "export-note"] },
    { name: "export-band", states: [S("rest")], hooks: ["export-band", "export-band-info", "export-band-pages", "export-band-ms", "export-band-hint"] },
  ],
};
