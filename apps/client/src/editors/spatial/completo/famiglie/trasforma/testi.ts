// I testi della famiglia «trasforma» del Disegno completo (piano K6, T13, giro 2): il
// titolo e i gruppi della sezione «Allinea», le due scelte di «Allinea a» e le
// voci `align.*` (le stesse parole che la ricerca Ctrl+/ trova nell'indice).

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "sezione:allinea": { it: "Allinea", en: "Align" },
  "allinea:a": { it: "Allinea a", en: "Align to" },
  "allinea:selezione": { it: "Selezione", en: "Selection" },
  "allinea:tavola": { it: "Tavola", en: "Artboard" },
  "gruppo:orizzontale": { it: "Orizzontale", en: "Horizontal" },
  "gruppo:verticale": { it: "Verticale", en: "Vertical" },
  "gruppo:centri": { it: "Centri", en: "Centers" },
  "gruppo:distribuisci-orizzontale": { it: "Distribuisci orizzontale", en: "Distribute horizontally" },
  "gruppo:distribuisci-verticale": { it: "Distribuisci verticale", en: "Distribute vertically" },
  "align.horizontalLeft": { it: "A sinistra", en: "Left" },
  "align.horizontalCenter": { it: "Centro orizzontale", en: "Horizontal center" },
  "align.horizontalRight": { it: "A destra", en: "Right" },
  "align.horizontalVerticalCenter": { it: "Centro nei due sensi", en: "Center both ways" },
  "align.verticalTop": { it: "In alto", en: "Top" },
  "align.verticalCenter": { it: "Centro verticale", en: "Vertical center" },
  "align.verticalBottom": { it: "In basso", en: "Bottom" },
  "align.distributeVerticalTop": { it: "Bordi superiori", en: "Top edges" },
  "align.distributeVerticalCenter": { it: "Centri verticali", en: "Vertical centers" },
  "align.distributeVerticalBottom": { it: "Bordi inferiori", en: "Bottom edges" },
  "align.distributeVerticalSpace": { it: "Spazio verticale", en: "Vertical space" },
  "align.distributeHorizontalLeft": { it: "Bordi sinistri", en: "Left edges" },
  "align.distributeHorizontalCenter": { it: "Centri orizzontali", en: "Horizontal centers" },
  "align.distributeHorizontalRight": { it: "Bordi destri", en: "Right edges" },
  "align.distributeHorizontalSpace": { it: "Spazio orizzontale", en: "Horizontal space" },
};
