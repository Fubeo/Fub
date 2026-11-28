// La mappa dell'editor: la tipografia delle pagine di «Esporta in PDF».
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta. Aggiunti dal
// controllo del 2026-11-28, parte 2.
//
// Le pagine non hanno la stessa nota dai due lati: il prototipo stampa la
// mostra di primavera (`.ph1`, `.pp`, `.pcall`, …, righe 1077-1131), l'app la
// nota della scena, «Sintassi di Fub», con la marcatura del documento
// (`.print-page`, `.print-body.markdown-rendered`). Si confrontano gli
// stessi tipi di blocco, il primo di ogni tipo nella prima pagina; i tipi che
// una delle due note non ha stanno in `da-coprire-parte-2.mjs`.

export const PEZZI_ESPORTA_PAGINE = [
  {
    id: "esporta.pagina-titolo",
    vista: "esporta-pdf",
    prototipo: ".px-slot .ph1",
    app: ".export-slot .print-page > h1",
    proprieta: ["font", "color", "margin", "letter-spacing"],
  },
  {
    id: "esporta.pagina-titolo2",
    vista: "esporta-pdf",
    prototipo: ".px-slot h2.ph",
    app: ".export-slot .print-body > h2",
    proprieta: ["font", "color", "letter-spacing"],
  },
  // Lo spazio intorno al titolo: il prototipo lo dà al blocco (`.pt-h2`),
  // l'app al titolo.
  {
    id: "esporta.pagina-titolo2-spazio",
    vista: "esporta-pdf",
    prototipo: ".px-slot .px-it.pt-h2",
    app: ".export-slot .print-body > h2",
    proprieta: ["margin-top", "margin-bottom"],
  },
  {
    id: "esporta.pagina-paragrafo",
    vista: "esporta-pdf",
    prototipo: ".px-slot .pp",
    app: ".export-slot .print-body > p",
    proprieta: ["font", "color", "text-align"],
  },
  {
    id: "esporta.pagina-collegamento",
    vista: "esporta-pdf",
    prototipo: ".px-slot .pp .lnk",
    app: ".export-slot .print-body a.wikilink",
    proprieta: ["color", "font-weight", "text-decoration-line"],
  },
  {
    id: "esporta.pagina-richiamo",
    vista: "esporta-pdf",
    prototipo: ".px-slot .pcall",
    app: ".export-slot .print-body .callout",
    proprieta: ["padding", "border", "border-radius", "background-color"],
  },
  {
    id: "esporta.pagina-richiamo-titolo",
    vista: "esporta-pdf",
    prototipo: ".px-slot .pcall-t",
    app: ".export-slot .print-body .callout-title",
    proprieta: ["font", "color", "margin-bottom", "letter-spacing"],
  },
  {
    id: "esporta.pagina-compito",
    vista: "esporta-pdf",
    prototipo: ".px-slot .ptask:not(.done)",
    app: ".export-slot .print-body li.task",
    proprieta: ["display", "gap", "font", "color"],
  },
  {
    id: "esporta.pagina-casella",
    vista: "esporta-pdf",
    prototipo: ".px-slot .ptask:not(.done) > i",
    app: ".export-slot .print-body li.task > input",
    proprieta: ["width", "height", "border", "border-radius", "background-color"],
  },
  {
    id: "esporta.pagina-tabella",
    vista: "esporta-pdf",
    prototipo: ".px-slot .pt-table .ptab",
    app: ".export-slot .print-body table",
    proprieta: ["font", "border-collapse", "font-variant-numeric"],
  },
  {
    id: "esporta.pagina-intestazione",
    vista: "esporta-pdf",
    prototipo: ".px-slot .pt-table .ptab th",
    app: ".export-slot .print-body table th",
    proprieta: ["padding", "border-bottom", "font-weight", "color", "background-color", "text-align", "white-space"],
  },
  {
    id: "esporta.pagina-cella",
    vista: "esporta-pdf",
    prototipo: ".px-slot .pt-table .ptab td",
    app: ".export-slot .print-body table td",
    proprieta: ["padding", "border-bottom", "color"],
  },
];
