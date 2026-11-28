// La mappa dell'editor: ciò che cambia quando l'editor sta in un foglio
// stretto della cornice (`src/embed.css` del simulatore, copiato in
// `cornice-embed.css`). Un pezzo di `bench/conformita/mappa-editor.mjs`, che
// lo monta. Aggiunti dal controllo del 2026-11-28, parte 2.
//
// Le regole stringono il margine della pagina sotto i 620 px (60 a sinistra
// per la maniglia, 24 a destra) e la barra di formato sotto i 540, 400 e 340.
// Un gruppo della barra nascosto non si legge (non c'è un elemento visibile):
// i gruppi stanno in `da-coprire-parte-2.mjs`, la loro larghezza si vede
// nella barra intera.

export const PEZZI_FOGLI_STRETTI = [
  {
    id: "foglio.pagina",
    vista: "foglio",
    contesto: "documento",
    prototipo: ".page",
    app: ".pane.focus .pane-editor .cm-content",
    proprieta: ["padding-left", "padding-right"],
  },
  // La barra: larga quanto il foglio dai due lati, se il foglio è montato
  // bene. Lo dice prima di ogni altro pezzo di questa vista.
  {
    id: "foglio.barra",
    vista: "foglio",
    prototipo: ".fbar",
    app: ".pane.focus .format-bar",
    proprieta: ["width"],
  },
  {
    id: "foglio.inserisci",
    vista: "foglio",
    prototipo: ".fb.ins",
    app: ".pane.focus .format-bar-insert",
    proprieta: ["padding-left", "padding-right", "width"],
  },
  {
    id: "foglio.copertina",
    vista: "foglio-testata",
    attende: "#421",
    contesto: "documento",
    prototipo: ".cover",
    app: ".pane.focus .cm-fub-page-cover",
    proprieta: ["margin-left", "margin-right"],
  },
];
