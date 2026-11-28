// La mappa dell'editor: i pezzi del diagramma (menu, figura, sorgente,
// ingrandito), aggiunti dal controllo del 2026-11-28.
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.
import { BASE } from "../confronto.mjs";
import { ALLINEAMENTO, DIMENSIONI } from "./comuni.mjs";

/// Il menu del diagramma vive sopra la pagina: token dell'interfaccia.
/// La figura, il sorgente e l'errore stanno nella pagina: token del documento.
export const PEZZI_DIAGRAMMA = [
  // ── il menu del diagramma (`dgMenu`, riga 2540 del prototipo) ───────────
  {
    id: "diagramma.menu",
    vista: "diagramma-menu",
    prototipo: ".pop.dgmenu",
    app: ".kit-popover.diagram-menu",
    proprieta: ["width", "padding", "border", "border-radius", "box-shadow", "background"],
  },
  {
    id: "diagramma.menu-titolo",
    vista: "diagramma-menu",
    prototipo: ".dgm-h",
    app: ".diagram-menu-label",
    proprieta: ["padding", "margin", "font", "color"],
  },
  {
    id: "diagramma.stili",
    vista: "diagramma-menu",
    prototipo: ".dgm-sw",
    app: ".diagram-menu-styles",
    proprieta: ["padding", "margin", "gap", "display", "grid-template-columns"],
  },
  {
    id: "diagramma.stile",
    vista: "diagramma-menu",
    prototipo: '.dg-sw[aria-checked="false"]',
    app: '.diagram-menu-style[aria-checked="false"]',
    proprieta: ["padding", "gap", "border-radius", "font", "color", "background"],
  },
  {
    id: "diagramma.stile-scelto",
    vista: "diagramma-menu",
    prototipo: '.dg-sw[aria-checked="true"]',
    app: '.diagram-menu-style[aria-checked="true"]',
    proprieta: ["font-weight", "color", "background"],
  },
  {
    id: "diagramma.campione",
    vista: "diagramma-menu",
    prototipo: '.dg-sw[aria-checked="false"] .dg-swp',
    app: '.diagram-menu-style[aria-checked="false"] .diagram-menu-swatch',
    proprieta: [...DIMENSIONI, "border-radius", "box-shadow"],
  },
  {
    id: "diagramma.campione-scelto",
    vista: "diagramma-menu",
    prototipo: '.dg-sw[aria-checked="true"] .dg-swp',
    app: '.diagram-menu-style[aria-checked="true"] .diagram-menu-swatch',
    proprieta: ["box-shadow", "transform"],
  },
  {
    id: "diagramma.riga",
    vista: "diagramma-menu",
    prototipo: ".dgm-row",
    app: ".diagram-menu-row",
    proprieta: ["padding", "gap", "font", "color", ...ALLINEAMENTO],
  },
  {
    id: "diagramma.riga-nome",
    vista: "diagramma-menu",
    prototipo: ".dgm-row > span:first-child",
    app: ".diagram-menu-row-name",
    proprieta: ["font", "color", "flex-grow"],
  },
  {
    id: "diagramma.segmenti",
    vista: "diagramma-menu",
    prototipo: ".dgm-row .seg2",
    app: ".diagram-menu-segments",
    proprieta: ["padding", "border-radius", "background"],
  },
  {
    id: "diagramma.segmento",
    vista: "diagramma-menu",
    prototipo: '.dgm-row .seg2 button[aria-pressed="false"]',
    app: '.diagram-menu-segment[aria-pressed="false"]',
    proprieta: ["height", "padding", "gap", "border-radius", "font", "color", "background", "box-shadow"],
  },
  {
    id: "diagramma.segmento-scelto",
    vista: "diagramma-menu",
    prototipo: '.dgm-row .seg2 button[aria-pressed="true"]',
    app: '.diagram-menu-segment[aria-pressed="true"]',
    proprieta: ["color", "background", "box-shadow"],
  },
  {
    id: "diagramma.voce",
    vista: "diagramma-menu",
    prototipo: ".dgm .m-list .m-i",
    app: ".diagram-menu-actions .kit-row",
    proprieta: [...BASE, "height"],
  },
  // ── la figura a riposo ──────────────────────────────────────────────────
  {
    id: "diagramma.figura",
    vista: "diagramma",
    contesto: "documento",
    prototipo: "figure.dg",
    app: "figure.mermaid-diagram",
    proprieta: ["margin", "padding", "gap", "border-radius", "background", "box-shadow"],
  },
  {
    id: "diagramma.disegno",
    vista: "diagramma",
    contesto: "documento",
    prototipo: "figure.dg .dg-view",
    app: "figure.mermaid-diagram .mermaid-diagram-view",
    proprieta: ["padding", "border", "border-radius", "background", "box-shadow", "opacity"],
  },
  {
    id: "diagramma.didascalia",
    vista: "diagramma",
    contesto: "documento",
    prototipo: "figure.dg .dg-cap",
    app: ".mermaid-diagram-caption",
    proprieta: ["padding", "margin", "font", "color", "text-align"],
  },
  // ── il sorgente aperto, con un errore ───────────────────────────────────
  // Il prototipo apre un pannello accanto al disegno (`.dg-ed`); l'app scrive
  // il sorgente nelle righe del blocco di codice, sopra il disegno: si
  // confrontano la testata, le righe e l'errore, non il pannello.
  {
    id: "diagramma.sorgente-testata",
    vista: "diagramma-sorgente",
    contesto: "documento",
    prototipo: ".dg-ed-h",
    app: ".cm-fub-diagram-src .cm-fub-code-header",
    proprieta: ["height", "padding", "gap", "font", "color", "background"],
  },
  {
    id: "diagramma.sorgente-fatto",
    vista: "diagramma-sorgente",
    contesto: "documento",
    prototipo: "#dg-done",
    app: ".cm-fub-diagram-src .cm-fub-code-done",
    proprieta: [...BASE, "height"],
  },
  {
    id: "diagramma.sorgente",
    vista: "diagramma-sorgente",
    contesto: "documento",
    prototipo: ".dg-src",
    app: ".cm-line.cm-fub-diagram-src:not(.cm-fub-code-header-line):not(.cm-fub-fence-close-line)",
    proprieta: ["font", "color", "background", "white-space"],
  },
  {
    id: "diagramma.errore",
    vista: "diagramma-sorgente",
    contesto: "documento",
    prototipo: ".dg-err",
    app: ".cm-fub-diagram-notice",
    proprieta: ["padding", "margin", "border-top-width", "border-top-style", "border-top-color", "font", "color", "background"],
  },
  {
    id: "diagramma.errore-riga",
    vista: "diagramma-sorgente",
    contesto: "documento",
    prototipo: ".dg-err b",
    app: ".cm-fub-diagram-notice b",
    proprieta: ["font-weight", "color"],
  },
  {
    id: "diagramma.disegno-vecchio",
    vista: "diagramma-sorgente",
    contesto: "documento",
    prototipo: ".dg-view.stale",
    app: ".mermaid-diagram.is-stale .mermaid-diagram-view",
    proprieta: ["opacity"],
  },
  // ── il diagramma ingrandito ─────────────────────────────────────────────
  {
    id: "diagramma.ingrandito",
    vista: "diagramma-ingrandito",
    prototipo: ".dg-full",
    app: ".lightbox-diagram",
    proprieta: ["background", "padding"],
  },
  {
    id: "diagramma.ingrandito-chiudi",
    vista: "diagramma-ingrandito",
    prototipo: ".dg-full-x",
    app: ".lightbox-diagram .lightbox-close",
    proprieta: [...DIMENSIONI, "top", "right", "border-radius", "color", "background"],
  },
  {
    id: "diagramma.ingrandito-aiuto",
    vista: "diagramma-ingrandito",
    prototipo: ".dg-full-hint",
    app: ".lightbox-diagram .lightbox-diagram-hint",
    proprieta: ["bottom", "font", "color", "text-align"],
  },
];
