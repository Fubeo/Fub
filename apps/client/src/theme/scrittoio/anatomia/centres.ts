/** L'anatomia del pezzo `skin/centres.css`. I centri: avvisi, attività, notifiche. */
import { REST, S, type PartAnatomy } from "./types";

export const CENTRES: PartAnatomy = {
  part: "centres",
  components: [
    // Il toast: il solo che interrompe. Le sue azioni sono parole.
    { name: "toast", states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["toast", "toast-stack", "toast-text", "toast-action", "toast-more", "toast-close"] },
    // Lo stato del documento nella testata del foglio, e l'attesa di un tasto.
    { name: "document-state", states: REST, hooks: ["pane-status", "save-state", "key-pending"] },
    // I due centri che scendono dalla barra del titolo. `panel-title`,
    // `link-button` e `muted` sono hook condivisi con altri pezzi: qui si
    // vestono solo dentro un centro.
    { name: "dock-panel", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["dock-panel", "dock-panel--notify", "dock-panel--activity", "panel-title", "link-button", "muted"] },
    { name: "notices", states: REST, hooks: ["notify-list", "notify-testo", "notify-ora"] },
    { name: "activities", states: REST, hooks: ["activity-row", "activity-label"] },
  ],
};
