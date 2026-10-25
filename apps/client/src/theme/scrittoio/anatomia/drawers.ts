/** L'anatomia del pezzo `skin/drawers.css`. I cassetti: navigazione a sinistra, ispettore a destra. */
import { INTERACTIVE, REST, S, type PartAnatomy } from "./types";

export const DRAWERS: PartAnatomy = {
  part: "drawers",
  components: [
    // I due contenitori. `drawer-*-open` è lo stato «in sovrapposizione» che
    // la shell scrive su `#layout`, `peek-*` quello del cassetto chiuso che si
    // affaccia dal bordo; `files-panel` è il pannello dei file, che
    // qui serve a riconoscere l'etichetta delle appuntate.
    {
      name: "panel",
      states: REST,
      hooks: [
        "sidebar",
        "inspector-pane",
        "files-panel",
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
    {
      name: "space-strip",
      states: [S("rest"), S("hover"), S("selected"), S("focused")],
      hooks: ["space-strip", "space-chip", "add", "space-title", "clickable"],
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
