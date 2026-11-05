// I pezzi che il simulatore sa indicare: un selettore nello schermo, il file
// che lo costruisce nel codice, il task, e se è nuovo, cambiato o uguale a main.
// «uguale» vuol dire che il DOM è quello di main: si copia solo la pelle.
export const PEZZI = [
  // La cornice
  { sel: "#topbar", nome: "La barra del titolo", dest: "apps/client/index.html, shells/scrittoio/frame/*.ts", task: "S2 T7", come: "cambiato" },
  { sel: "#pill", nome: "La pillola (cerca o esegui)", dest: "shells/scrittoio/frame/pill.ts", task: "S2 T7", come: "cambiato" },
  { sel: "#rail", nome: "Il binario", dest: "shells/scrittoio/frame/rail.ts, index.html", task: "S2 T7 (pelle)", come: "uguale" },
  { sel: "#space-strip", nome: "La striscia degli spazi", dest: "panels/explorer.ts", task: "S2 T8", come: "cambiato" },
  { sel: "#file-list", nome: "L'albero del vault", dest: "panels/explorer.ts, ui/page-mark.ts", task: "S2 T8, T14", come: "cambiato" },
  { sel: "#search-input", nome: "Il pozzetto della ricerca", dest: "index.html, panels/explorer.ts", task: "S2 T8", come: "cambiato" },
  { sel: ".pane.focus .pane-tabs", nome: "Le linguette", dest: "panels/document.ts (pelle in skin/sheets.css)", task: "S2 T6", come: "uguale" },
  { sel: ".pane.focus .pane-toolbar", nome: "La testata del foglio", dest: "panels/document.ts, shells/scrittoio/sheets/title-rename.ts", task: "S2 T5", come: "cambiato" },
  { sel: ".pane.focus .sheet-save", nome: "«Salvato» nella testata", dest: "shells/scrittoio/sheets/save-state.ts", task: "S2 T5", come: "cambiato" },
  { sel: ".pane.focus .format-bar", nome: "La barra di formato", dest: "panels/format-bar.ts, kit/toolbar-keys.ts", task: "S2 T16, T17", come: "cambiato" },
  { sel: ".pane > .pane-mode-current", nome: "La modalità nel foglio (telefono)", dest: "panels/document.ts, mobile.css", task: "S2 T3", come: "cambiato" },
  { sel: ".note-facts", nome: "La riga dei dati sotto il titolo", dest: "editors/text/profiles/markdown/note-facts.ts (nuovo)", task: "S2 T12", come: "nuovo" },
  { sel: "#status-band", nome: "La banda", dest: "shells/scrittoio/frame/status-band.ts, index.html", task: "S2 T3, T4", come: "cambiato" },
  { sel: ".status-standing", nome: "«Si scrive» nella banda", dest: "shells/scrittoio/frame/status-band.ts, panels/standing.ts", task: "S2 T4", come: "nuovo" },
  { sel: "#status-mode", nome: "La modalità nella banda", dest: "shells/scrittoio/frame/status-band.ts, state/mode-menu.ts", task: "S2 T2, T3", come: "nuovo" },
  { sel: "#right-pane", nome: "L'ispettore", dest: "ui/views.ts, ui/node.ts", task: "S2 T9", come: "cambiato" },
  { sel: "#view-panel-backlinks", nome: "«In entrata»", dest: "ui/node.ts, crates/fub-features/src/backlinks.rs", task: "S2 T13", come: "cambiato" },
  { sel: ".conflict-banner", nome: "Il conflitto", dest: "panels/document.ts (drawConflict)", task: "main; PA giro", come: "uguale" },
  { sel: ".sheet-notices:not(:empty)", nome: "Gli avvisi del foglio", dest: "panels/document.ts", task: "main", come: "uguale" },
  // Ciò che si apre
  { sel: '#context-menu[aria-label="Modalità del riquadro"]', nome: "Il menu delle modalità", dest: "state/mode-menu.ts (nuovo), ui/menu.ts", task: "S2 T2, T10", come: "nuovo" },
  { sel: '#context-menu:not([aria-label="Modalità del riquadro"])', nome: "Il menu del tasto destro", dest: "ui/menu.ts, panels/editor-menu.ts", task: "main (#238)", come: "uguale" },
  { sel: ".slash-panel", nome: "Il menu «/»", dest: "panels/slash/panel.ts", task: "main N12", come: "uguale" },
  { sel: ".launcher-layer", nome: "L'avvio rapido", dest: "shells/scrittoio/launcher/launcher.ts", task: "main (pelle S2 T10)", come: "uguale" },
  { sel: ".kit-popover", nome: "Il foglietto del salvataggio", dest: "kit/popover.ts, shells/scrittoio/sheets/save-state.ts", task: "S2 T5", come: "cambiato" },
  { sel: "#notify-panel:not([hidden])", nome: "Gli avvisi", dest: "ui/notify.ts", task: "main", come: "uguale" },
  { sel: ".toast-stack:not(:empty)", nome: "Un avviso che passa", dest: "ui/notify.ts", task: "main", come: "uguale" },
  { sel: ".kit-dialog-scrim", nome: "Il dialogo del kit", dest: "kit/dialog.ts", task: "main", come: "uguale" },
  // Le pagine
  { sel: ".settings-panel", nome: "Le impostazioni", dest: "panels/settings.ts, shells/scrittoio/preferences/*.ts", task: "main (pelle S2 T10)", come: "uguale" },
  { sel: ".components-page", nome: "La pagina «Componenti»", dest: "panels/components-page.ts (nuovo)", task: "K2 T1–T7", come: "nuovo" },
  { sel: ".onboarding:not([hidden])", nome: "Il benvenuto", dest: "shells/scrittoio/frame/welcome.ts", task: "main (pelle S2 T10)", come: "uguale" },
  { sel: ".avvio", nome: "Lo strato d'avvio", dest: "avvio/consegna.ts, index.html", task: "main #308", come: "uguale" },
  // Gli editor
  { sel: ".kit-ribbon", nome: "La barra a schede", dest: "kit/ribbon/ribbon.ts, editors/rich/ribbon.ts", task: "S2 T20, T21; K3 T18", come: "nuovo" },
  { sel: ".media-pdf-toolbar", nome: "La barra del PDF", dest: "editors/media/pdf-view.ts", task: "S2 T18", come: "cambiato" },
  { sel: ".draw-header", nome: "La testa del disegno", dest: "editors/spatial/tools/editor/toolbar.ts", task: "S2 T22; K5", come: "cambiato" },
  { sel: ".canvas-toolbar", nome: "La barra della lavagna di oggi", dest: "editors/canvas/engine.ts", task: "N6 T26, T49 (la sostituiscono)", come: "cambiato" },
  { sel: ".craft-ask", nome: "La domanda dei file Craft", dest: "editors/craft/consent.ts", task: "main N7 (pelle S2 T19)", come: "uguale" },
];
