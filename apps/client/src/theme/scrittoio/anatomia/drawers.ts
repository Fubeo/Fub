/** L'anatomia del pezzo `skin/drawers.css`. I cassetti: navigazione a sinistra, ispettore a destra. */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const DRAWERS: PartAnatomy = {
  part: "drawers",
  layer: "cornice",
  components: [
    // I due contenitori. `drawer-*-open` è lo stato «in sovrapposizione» che
    // la shell scrive su `#layout`, `peek-*` quello del cassetto chiuso che si
    // affaccia dal bordo; `files-panel` è il pannello dei file, che
    // qui serve a riconoscere le etichette di sezione, e `plain-list` (del
    // pezzo dell'albero) la lista che ne segue una.
    {
      name: "panel",
      states: REST,
      hooks: [
        "sidebar",
        "inspector-pane",
        "files-panel",
        "plain-list",
        "drawer-sidebar-open",
        "drawer-inspector-open",
        "peek-sidebar",
        "peek-inspector",
        "drawer-scrim",
        "views-bottom",
      ],
    },
    { name: "divider", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["layout-divider"] },
    // `search-results`, `search-exclusions` e `drop-into` sono di altri pezzi:
    // qui dicono soltanto quale titolo è l'esito della ricerca e quale è
    // bersaglio di un rilascio.
    {
      name: "panel-title",
      states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("dragging")],
      hooks: ["panel-title", "link-button", "danger", "clickable", "search-results", "search-exclusions", "drop-into"],
    },
    // Le azioni a icona del titolo del cassetto («ordina», «nuova nota») e il
    // conto di un'etichetta di sezione («Tutte le note 18»).
    {
      name: "panel-actions",
      states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("disabled")],
      hooks: ["panel-title-actions", "icon-button", "panel-count"],
    },
    // Il pozzetto degli spazi: l'acceso mostra figura e nome, gli altri la figura.
    {
      name: "space-strip",
      states: [S("rest"), S("hover"), S("selected"), S("focused")],
      hooks: ["space-strip", "space-well", "space-chip", "space-chip-icon", "space-chip-name", "add", "space-title", "clickable"],
    },
    // Segnalibri e workspace: pannelli del cassetto con le righe della palette.
    {
      name: "drawer-list",
      states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("focused")],
      hooks: ["bookmarks-panel", "workspaces-panel", "search-result", "palette-row", "palette-title", "palette-desc"],
    },
    { name: "icon-picker", states: INTERACTIVE, hooks: ["icon-picker", "icon-grid", "icon-none"] },
    {
      name: "declared-view",
      states: [S("rest"), S("selected"), S("focused")],
      hooks: ["views-status", "declared-view-panel", "declared-view", "ui-stack", "ui-text", "views-modal"],
    },
  ],
};
