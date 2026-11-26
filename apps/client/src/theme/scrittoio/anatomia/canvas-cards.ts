/** L'anatomia del pezzo `skin/canvas-cards.css`. La lavagna: i colori, le schede, i fili, i segni sopra le schede. */
import { DRAGGABLE, INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const CANVAS_CARDS: PartAnatomy = {
  part: "canvas-cards",
  layer: "cornice",
  components: [
    // L'editor di testo che sta sotto a tutte le superfici: sono classi di
    // CodeMirror, e la pelle le veste tutte — il tema dell'editor
    // (`editors/text/theme.ts`) non porta colori (issue #242).
    { name: "text-editor", layer: "contenuto", states: [S("rest"), S("focused"), S("selected")], hooks: ["cm-editor", "cm-focused", "cm-content", "cm-line"] },
    // Le celle sono contenuto con l'aspetto del file: la pelle ne veste i segni
    // dalla riga (`.grid-row .selected`), non dalla cella. Le intestazioni e la
    // vista sono cornice, l'editor della cella è un segno.
    { name: "grid-surface", gate: { scope: ["grid-viewport"] }, layers: { "grid-cell-editor": "segno", "selected": "segno" }, states: SELECTABLE, hooks: ["grid-formula-bar", "grid-formula-editor", "grid-cell-editor", "selected"] },
    // La griglia e le guide (T71) sono segni di Fub sulla vista, non contenuto.
    { name: "canvas-surface", layers: { "canvas-source": "contenuto" }, states: INTERACTIVE, hooks: ["canvas-surface", "canvas-source"] },
    // La riga delle opzioni della lavagna (T50): la testata, i gruppi e i
    // pulsanti della riga del kit, il pozzo del colore delle schede scelte,
    // le «A» della misura del testo (T92).
    { name: "canvas-options", states: [S("rest"), S("hover"), S("pressed"), S("focused"), S("selected"), S("disabled")], hooks: ["canvas-options"] },
    // L'ispettore della lavagna (T58): «Schede», il filtro e l'elenco in
    // ordine di lettura, nel pannello della shell. T59: «Scheda» e «Fili», con
    // i numeri, il pozzo del colore, «Avanzate» e il popover dei colori.
    { name: "canvas-inspector", states: [S("rest"), S("hover"), S("focused"), S("selected")], hooks: ["canvas-inspector", "canvas-inspector-popover"] },
    // La scheda-estratto (T75): nella testata sopra la scheda le parti e ↗,
    // segni di Fub; nel corpo le sezioni della nota, ognuna col suo titolo in
    // piccolo, e l'avviso della sezione che non c'è più. Il corpo di una
    // sezione, la riga dei pulsanti e la frase dell'avviso sono solo impianto.
    { name: "canvas-excerpt", layer: "contenuto", layers: { "canvas-excerpt-parts": "segno", "canvas-excerpt-open": "segno" }, states: [S("rest"), S("hover"), S("focused")], hooks: ["canvas-excerpt-parts", "canvas-excerpt-open", "canvas-excerpt-section", "canvas-excerpt-section-title", "canvas-excerpt-missing"] },
    // Il lettore (T76): copre l'area della lavagna; la testata col nome, le
    // parti e la crocetta, i titoli a lato, la nota grande con le sezioni
    // dell'estratto segnate e «+ Aggiungi all'estratto» su quella dove si legge.
    { name: "canvas-reader", states: [S("rest"), S("hover"), S("focused"), S("selected")], hooks: ["canvas-reader", "canvas-reader-head", "canvas-reader-title", "canvas-reader-hint", "canvas-reader-outline", "canvas-reader-outline-row", "canvas-reader-doc", "canvas-reader-page", "canvas-reader-section", "canvas-reader-unreadable"] },
    { name: "canvas-node", layer: "contenuto", layers: { "canvas-node-handle": "segno", "canvas-connect": "segno", "canvas-node-cites": "segno", "canvas-node-twins": "segno", "canvas-resize": "segno", "canvas-port": "segno", "canvas-selection-frame": "segno", "canvas-convert-note": "cornice", "canvas-open-url": "cornice" }, states: DRAGGABLE, hooks: ["canvas-node", "canvas-node-group", "canvas-node-file", "canvas-node-link", "canvas-node-handle", "canvas-node-far", "canvas-connect", "canvas-resize", "canvas-port", "canvas-selection-frame", "canvas-card-body", "canvas-markdown", "canvas-empty", "canvas-group-label", "canvas-group-bg", "canvas-url-text", "canvas-media-placeholder", "canvas-convert-note", "canvas-open-url", "canvas-file-link", "canvas-text-editor", "canvas-field-editor", "canvas-card-craft", "canvas-card-craft-actions", "canvas-card-craft-file", "canvas-card-craft-name", "canvas-card-craft-info", "canvas-card-craft-state", "canvas-card-craft-consent", "canvas-card-craft-render", "canvas-node-cites", "canvas-node-twins", "canvas-card-pdf", "canvas-card-pdf-page", "canvas-card-pdf-previous", "canvas-card-pdf-next", "canvas-card-pdf-status", "canvas-card-missing", "canvas-card-missing-actions"] },
    { name: "canvas-edge", layer: "contenuto", layers: { "canvas-edge-hit": "segno", "canvas-edge-reconnect": "segno", "canvas-edge-draft": "segno" }, states: [S("rest"), S("hover"), S("selected"), S("dragging")], hooks: ["canvas-edge", "canvas-edge-draft", "canvas-edge-hit", "canvas-edge-line", "canvas-edge-arrow", "canvas-edge-label", "canvas-edge-reconnect"] },
    // Si scrive in una scheda di nota (T41): l'anello della scheda che
    // scrive, «Esc per uscire» pieno, lo stato del salvataggio e «Sola
    // lettura» nella riga del titolo, l'editor della nota e il conflitto nel
    // corpo, la barra di formato nella riga delle opzioni; la scheda di
    // foglio che scrive e la sua formula nella riga delle opzioni (T42).
    { name: "canvas-card-writing", layers: { "cm-fub-heading-line": "contenuto" }, states: [S("rest"), S("focused")], hooks: ["canvas-card-note", "canvas-exit-hint", "canvas-card-lock", "save-state", "format-bar", "conflict-banner", "conflict-actions", "cm-fub-heading-line", "canvas-card-sheet", "canvas-formula-text"] },
    // Mentre si scrive (T69): l'etichetta accanto alla penna, che dice a che
    // cosa si attaccherà il tratto, e il bordo tratteggiato attorno alla
    // scheda, che è un segno di Fub sulla lavagna.
    { name: "canvas-ink-target", layers: { "canvas-ink-frame": "segno" }, states: REST, hooks: ["canvas-ink-label", "canvas-ink-frame"] },
    // L'avviso sotto una scheda di testo allargata o ristretta dopo i tratti:
    // il testo rifluisce, i tratti no; il pulsante rimette la larghezza.
    { name: "canvas-ink-reflow", layers: { "canvas-ink-reflow": "segno" }, states: [S("rest"), S("hover"), S("pressed"), S("focused")], hooks: ["canvas-ink-reflow", "canvas-ink-reflow-back"] },
    // Il Lazo (T86): il giro, la cornice dei tratti scelti e il loro
    // contorno, segni di Fub sulla lavagna.
    { name: "canvas-lasso", layers: { "canvas-lasso-path": "segno", "canvas-lasso-frame": "segno", "canvas-lasso-chosen": "segno" }, states: REST, hooks: ["canvas-lasso-path", "canvas-lasso-frame", "canvas-lasso-chosen"] },
    // Il rettangolo del trascinamento nel vuoto con la Selezione (N6 T20b): il
    // velo e il bordo, segno di Fub sulla lavagna.
    { name: "canvas-marquee", layers: { "canvas-marquee-box": "segno" }, states: REST, hooks: ["canvas-marquee-box"] },
    // Il fantasma del rilascio (T15, T22): dove nasceranno le schede di un
    // trascinamento, o la cornice del gruppo oltre i dodici col numero.
    { name: "canvas-drop", layers: { "canvas-drop-ghost": "segno", "canvas-drop-ghost-group": "segno", "canvas-drop-ghost-name": "segno" }, states: REST, hooks: ["canvas-drop-ghost", "canvas-drop-ghost-group", "canvas-drop-ghost-name"] },
    // Il righello (T87): la riga velata con le tacche e l'angolo, sopra la
    // lavagna; il suo corpo si sposta e prende il fuoco.
    { name: "canvas-ruler", states: [S("rest"), S("focused")], hooks: ["canvas-ruler-bar", "canvas-ruler-grip", "canvas-ruler-angle"] },
  ],
};
