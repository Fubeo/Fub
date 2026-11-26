/** L'anatomia del pezzo `skin/rich.css`. I documenti di videoscrittura e i segni di Fub sulla carta delle note. */
import { REST, S, type PartAnatomy } from "./types";

export const RICH: PartAnatomy = {
  part: "rich",
  layer: "cornice",
  components: [
    // La barra multifunzione del documento. La sua forma e la sua pelle sono
    // quelle del kit (`kit-ribbon`, in `kit.ts`), come per la barra del
    // foglio: qui restano le parti solo sue, l'accesso rapido, i segni del
    // formato, i campi e la galleria degli stili.
    { name: "rich-ribbon", states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("disabled")], hooks: ["rich-ribbon-color-bar", "rich-ribbon-input", "rich-ribbon-marker", "rich-ribbon-quick", "rich-ribbon-select", "rich-ribbon-style", "rich-ribbon-styles"] },
    { name: "rich-surface", gate: { scope: ["rich-page"] }, layers: { "rich-content": "contenuto", "rich-para": "contenuto", "rich-heading": "contenuto", "rich-list": "contenuto", "rich-quote": "contenuto", "rich-link": "contenuto", "rich-section": "contenuto", "rich-break-page": "contenuto", "rich-break-column": "contenuto", "rich-table": "contenuto", "rich-cell": "contenuto" }, states: [S("rest"), S("focused"), S("selected"), S("disabled")], hooks: ["rich-surface", "rich-notice", "rich-page", "rich-sheet-paper", "rich-sheet-ghost", "rich-content", "rich-para", "rich-heading", "rich-list", "rich-quote", "rich-link", "rich-section", "rich-break-page", "rich-break-column", "rich-table", "rich-cell", "rich-strip-swatches", "rich-strip-swatch", "rich-strip-swatch-none", "rich-strip-swatch-custom", "rich-findbar", "rich-findbar-row", "rich-findbar-close", "rich-strip-panel", "rich-strip-panel-title", "rich-strip-panel-body", "rich-strip-panel-pairs", "rich-strip-panel-actions", "rich-strip-panel-check", "rich-strip-panel-note", "rich-strip-panel-fields", "rich-strip-panel-area", "rich-side", "rich-side-compose", "rich-side-list", "rich-side-item", "rich-side-quote", "rich-side-head", "rich-side-text", "rich-side-reply", "rich-side-actions", "rich-side-answer", "rich-side-switch", "rich-side-change", "rich-side-section", "rich-side-section-title", "rich-side-preview", "rich-side-preview-sheet", "rich-side-preview-text", "rich-side-preview-column", "rich-side-facts", "rich-side-dot", "rich-side-open", "rich-strip-table-grid", "rich-strip-table-cell", "rich-strip-count", "rich-drawing-editor", "rich-drawing-bar", "rich-drawing-title"] },
    { name: "content-look", layer: "contenuto", states: REST, hooks: ["look-tema", "look-file", "look-adattato"] },
    // Il segnaposto di un oggetto che Fub non disegna è un segno di Fub sulla
    // carta, come la selezione: in ogni aspetto lo veste la pelle.
    { name: "rich-atom", layer: "segno", states: [S("rest"), S("selected")], hooks: ["rich-atom", "rich-atom-image", "rich-atom-graphic", "rich-atom-shape", "rich-atom-text_box", "rich-atom-group", "rich-atom-drawn", "rich-atom-equation", "rich-atom-glyph", "rich-atom-name", "rich-atom-note", "rich-atom-field", "rich-atom-marker", "ProseMirror-selectednode", "rich-proof-spelling", "rich-proof-grammar"] },
    // I segni di Fub sul documento: revisioni, ricerca, commenti, i blocchi
    // chiusi.
    { name: "rich-marks", layer: "segno", states: REST, hooks: ["rich-ins", "rich-del", "rich-ins-mark", "rich-del-mark", "rich-find", "rich-find-current", "rich-comment", "rich-autore-1", "rich-autore-2", "rich-autore-3", "rich-autore-4", "rich-autore-5", "rich-autore-6", "rich-autore-ins", "rich-autore-del", "rich-changed", "rich-goto-ring", "rich-locked"] },
    // I fogli: l'anteprima dell'intestazione e del piè, il nome di
    // un'interruzione fra due fogli, e l'intestazione che si scrive sul posto.
    // Sono segni di Fub sulla carta, non il testo del file.
    { name: "rich-sheet-marks", layer: "segno", states: [S("rest"), S("focused")], hooks: ["rich-sheet-head", "rich-sheet-foot", "rich-sheet-name", "rich-running-bar", "rich-running-label", "rich-running-area", "rich-token"] },
    // I compiti nella nota: la pastiglia della scadenza (Live e Lettura) è un
    // segno di Fub sulla carta; il recinto ```tasks``` è la vista del
    // componente dei compiti, vestita da blocco della carta.
    { name: "task-due", layer: "segno", layers: { "cm-fub-code": "contenuto" }, states: REST, hooks: ["cm-fub-due", "cm-fub-due-near", "cm-fub-due-overdue", "cm-fub-due-bad", "task-due", "task-due-near", "task-due-overdue", "task-due-bad", "cm-fub-code"] },
    // Il promemoria (T36): la pastiglia blu della sveglia nella Live, e la
    // sua scelta del giorno e dell'ora, il riquadro della data delle
    // proprietà con la riga delle notifiche spente.
    { name: "task-reminder", layer: "segno", layers: { "cm-fub-reminder-picker": "cornice", "cm-fub-prop-date-field": "cornice", "cm-fub-reminder-silent": "cornice" }, states: [S("rest"), S("hover")], hooks: ["cm-fub-reminder", "cm-fub-reminder-figure", "cm-fub-reminder-done", "cm-fub-reminder-text", "cm-fub-reminder-bad", "cm-fub-reminder-picker", "cm-fub-prop-date-field", "cm-fub-reminder-silent"] },
    // I promemoria passati all'avvio: un dialogo del kit con l'elenco.
    { name: "reminders-startup", layer: "cornice", states: REST, hooks: ["kit-dialog", "reminders-dialog", "reminders-list", "reminders-row", "reminders-text", "reminders-task", "reminders-where", "reminders-error", "reminders-actions", "reminders-more"] },
    { name: "tasks-block", layer: "segno", layers: { "markdown-rendered": "contenuto", "ui-stack": "cornice", "ui-checkbox": "cornice", "ui-field-label": "cornice", "ui-badge": "cornice", "ui-button": "cornice", "ui-text": "cornice", "ui-empty-state": "cornice", "ui-empty-title": "cornice", "intent-danger": "cornice", "intent-primary": "cornice" }, states: [S("rest"), S("hover"), S("focused"), S("selected")], hooks: ["markdown-rendered", "block-tasks", "block-query-note", "ui-stack", "ui-checkbox", "ui-field-label", "ui-badge", "ui-button", "ui-text", "ui-empty-state", "ui-empty-title", "intent-danger", "intent-primary"] },
    // La pagina del giorno (T39): in fondo alla giornaliera, dopo l'ultima
    // riga, la vista `day_page` del componente dei template. È un segno di
    // Fub sulla carta, non testo del file.
    { name: "day-page", layer: "segno", layers: { "cm-editor": "contenuto", "cm-content": "contenuto", "ui-section": "cornice", "ui-children": "cornice", "ui-list-item": "cornice", "ui-list-item-title": "cornice", "ui-list-item-subtitle": "cornice", "ui-text": "cornice", "ui-empty-state": "cornice", "ui-empty-title": "cornice" }, states: [S("rest"), S("hover"), S("focused")], hooks: ["cm-editor", "cm-content", "cm-day-page", "cm-day-page-note", "ui-section", "ui-children", "ui-list-item", "ui-list-item-title", "ui-list-item-subtitle", "ui-text", "ui-empty-state", "ui-empty-title"] },
    // I commenti nel testo (EC T21): il fondo del passo commentato in
    // Scrittura e in Lettura, più pieno col cursore dentro, e il commento
    // intero colorato in Sorgente. Segni di Fub sulla carta, non il testo.
    { name: "note-comments", layer: "segno", layers: { "markdown-rendered": "contenuto" }, states: [S("rest"), S("focused")], hooks: ["cm-fub-comment-range", "cm-fub-comment-range-on", "comment-range", "cm-fub-comment-source", "markdown-rendered"] },
  ],
};
