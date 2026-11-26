// La mappa dell'editor: i pezzi del «/» e delle schede.
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.
import { BASE } from "../confronto.mjs";
import { ALLINEAMENTO, DIMENSIONI, LARGHI } from "./comuni.mjs";

export const PEZZI_SLASH_SCHEDE = [
  // ── il «/» in una colonna (T84) ───────────────────────────────────────────
  {
    id: "slash.superficie",
    vista: "slash",
    prototipo: ".pop.slash",
    app: ".cm-tooltip.slash-panel",
    proprieta: [...BASE, "width"],
  },
  {
    id: "slash.tessere",
    vista: "slash",
    prototipo: ".sl-quick",
    app: ".slash-top",
    proprieta: [...BASE, "display", "grid-template-columns"],
  },
  {
    id: "slash.tessera-accesa",
    vista: "slash",
    prototipo: ".sl-q.act .ti",
    app: ".slash-tile[data-lit] .kit-tile-icon",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "slash.tessera",
    vista: "slash",
    prototipo: ".sl-q:not(.act) .ti",
    app: ".slash-tile:not([data-lit]) .kit-tile-icon",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "slash.elenco",
    vista: "slash",
    prototipo: ".sl-list",
    app: ".slash-list",
    proprieta: ["padding", "max-height"],
  },
  {
    id: "slash.gruppo",
    vista: "slash",
    prototipo: ".sl-g",
    app: ".slash-group-label",
    proprieta: [...BASE, "position", "top"],
  },
  {
    id: "slash.riga",
    vista: "slash",
    prototipo: ".sl-i:not(.act)",
    app: ".slash-row:not([data-lit])",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "slash.sintassi",
    vista: "slash",
    prototipo: ".sl-i .sy",
    app: ".slash-row .slash-syntax-note",
    proprieta: ["font-family", "font-size", "color", "white-space"],
  },
  {
    id: "slash.disegno",
    vista: "slash",
    prototipo: ".sl-det",
    app: ".slash-detail",
    proprieta: [...BASE, "display", "grid-template-columns", "min-height"],
  },
  {
    id: "slash.miniatura",
    vista: "slash",
    prototipo: ".sl-th",
    app: ".slash-thumb",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "slash.descrizione",
    vista: "slash",
    prototipo: ".sl-tx .d",
    app: ".slash-description",
    proprieta: ["font", "color"],
  },
  {
    id: "slash.come-si-scrive",
    vista: "slash",
    prototipo: ".sl-tx .y",
    app: ".slash-syntax",
    proprieta: ["font", "color", "margin", "white-space", "text-overflow"],
  },
  // Aggiunti dal controllo del 2026-11-21: il nome sotto le tessere, icona
  // e nome di una riga, il testo del disegno.
  {
    id: "slash.nome-tessera-accesa",
    vista: "slash",
    prototipo: ".sl-q.act",
    app: ".slash-tile[data-lit] .kit-tile-label",
    proprieta: ["font", "color", "white-space"],
  },
  {
    id: "slash.nome-tessera",
    vista: "slash",
    prototipo: ".sl-q:not(.act)",
    app: ".slash-tile:not([data-lit]) .kit-tile-label",
    proprieta: ["font", "color", "white-space"],
  },
  {
    id: "slash.icona-riga",
    vista: "slash",
    prototipo: ".sl-i:not(.act) .ic",
    app: ".slash-row:not([data-lit]) .kit-row-icon",
    proprieta: ["color", ...DIMENSIONI],
  },
  {
    id: "slash.nome-riga",
    vista: "slash",
    prototipo: ".sl-i:not(.act) .nm",
    app: ".slash-row:not([data-lit]) .kit-row-label",
    proprieta: ["font", "color", "white-space", "text-overflow"],
  },
  {
    id: "slash.testo-disegno",
    vista: "slash",
    prototipo: ".sl-tx",
    app: ".slash-detail-text",
    proprieta: ["font-size", "line-height"],
  },
  // ── la Base nella nota (T18) ────────────────────────────────────────────
  // Oltre la colonna fino al margine a tutta larghezza, nella colonna a 700.
  // Il blocco del prototipo è il vassoio della trasclusione: si allarga lui,
  // e la Base resta dentro il suo filo.
  {
    id: "base.incorporata",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"]',
    app: '.pane.focus .embed.transclusion:has(.base-surface[data-embedded="true"])',
    proprieta: ["margin-right"],
  },
  // Aggiunti dal controllo del 2026-11-21: la barra della Base nella nota
  // (T15) e la sua tabella.
  {
    id: "base.barra",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"] .bbar',
    app: '.pane.focus .base-surface[data-embedded="true"] .base-bar',
    proprieta: ["padding", "gap", "border-bottom-width", "border-bottom-style", "border-bottom-color", ...ALLINEAMENTO],
  },
  {
    id: "base.vista-scelta",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"] .bview[aria-pressed="true"]',
    app: '.pane.focus .base-surface[data-embedded="true"] .base-tab[aria-pressed="true"]',
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "base.vista",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"] .bview:not([aria-pressed="true"])',
    app: '.pane.focus .base-surface[data-embedded="true"] .base-tab[aria-pressed="false"]',
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "base.attrezzo",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"] .bb',
    app: '.pane.focus .base-surface[data-embedded="true"] .base-tool',
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "base.tabella",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"] .btab',
    app: '.pane.focus .base-surface[data-embedded="true"] .base-table',
    proprieta: ["font-size", "border-collapse"],
  },
  {
    id: "base.titolo",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"] .btab td.t',
    app: '.pane.focus .base-surface[data-embedded="true"] .base-title',
    proprieta: ["font", "color"],
  },
  {
    id: "base.nuova-riga",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"] .btab .addrow td',
    app: '.pane.focus .base-surface[data-embedded="true"] .base-add-row-button',
    proprieta: ["font", "color"],
  },
  // ── le schede affiancate (T42) ──────────────────────────────────────────
  // Alla pari, 14 px fra l'una e l'altra, 64 px oltre il testo dai due lati
  // a tutta larghezza e nella colonna a 700.
  {
    id: "schede.affiancate",
    vista: "schede-affiancate",
    prototipo: ".pair",
    app: '.pane.focus .pane-editor .fub-columns[data-live-cards="true"]',
    proprieta: ["column-gap", "margin-left", "margin-right", "align-items"],
  },
  // ── la scheda PDF (T45) ───────────────────────────────────────────────────
  // Il vassoio con 16 px intorno alla pagina (sotto, la fascia di 40 px del
  // numero è una riga della griglia, non un padding), la pagina con le sue
  // ombre, il numero e le frecce di 24 px, velate a riposo.
  {
    id: "schede.pdf.vassoio",
    vista: "scheda-pdf",
    contesto: "documento",
    prototipo: '.pair .scard[data-kind="pdf"] .pdfw',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf',
    proprieta: ["background-color", "padding-top", "padding-left", "padding-right"],
  },
  {
    id: "schede.pdf.pagina",
    vista: "scheda-pdf",
    contesto: "documento",
    prototipo: '.pair .scard[data-kind="pdf"] .pdfp',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf-page',
    proprieta: ["border-radius", "box-shadow", "filter"],
  },
  {
    id: "schede.pdf.numero",
    vista: "scheda-pdf",
    contesto: "documento",
    prototipo: '.pair .scard[data-kind="pdf"] .pdfn > span',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf-status',
    proprieta: ["font", "color", "font-variant-numeric"],
  },
  {
    id: "schede.pdf.freccia",
    vista: "scheda-pdf",
    contesto: "documento",
    prototipo: '.pair .scard[data-kind="pdf"] #pdf-prev',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf-previous',
    proprieta: [...DIMENSIONI, "border-radius", "color", "opacity"],
  },
  // ── il valore di una cella nel testo (T53) ──────────────────────────────
  // Il tratteggio d'accento sotto, le cifre tabellari, mai a capo, il
  // puntatore della mano; al passaggio il velo d'accento con gli angoli di 3 px.
  {
    id: "valori-cella.valore",
    vista: "valori-cella",
    contesto: "documento",
    prototipo: '[data-id="p-conti"] .cellv',
    app: '.pane.focus .pane-editor .cm-fub-cell-value[data-cell-state="value"]',
    // Il carattere è quello del paragrafo; l'interlinea è del corpo del testo
    // (non di questo pezzo), e qui non si confronta.
    proprieta: ["border-bottom-width", "border-bottom-style", "border-bottom-color", "cursor", "font-variant-numeric", "white-space", "color", "font-family", "font-size", "font-weight", "background-color"],
  },
  {
    id: "valori-cella.passaggio",
    vista: "valori-cella",
    contesto: "documento",
    prototipo: '[data-id="p-conti"] .cellv',
    app: '.pane.focus .pane-editor .cm-fub-cell-value[data-cell-state="value"]',
    gesto: { tipo: "hover", prototipo: '[data-id="p-conti"] .cellv', app: '.pane.focus .pane-editor .cm-fub-cell-value[data-cell-state="value"]' },
    proprieta: ["background-color", "border-radius"],
  },
  // La zona lavagna: il fondo del vassoio al 60% sul foglio, alta 300 px
  // (`|640x300`), col puntatore della scheda che si attiva con un clic. Le
  // schede e i fili sono quelli della lavagna (eccezioni-editor.json).
  {
    id: "schede.lavagna.zona",
    vista: "scheda-lavagna",
    contesto: "documento",
    prototipo: '.scard[data-kind="canvas"] .cvz',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="canvas"] .canvas-card-board-rest .canvas-viewport',
    proprieta: ["background-color", "height"],
  },
  {
    id: "schede.lavagna.riposo",
    vista: "scheda-lavagna",
    contesto: "documento",
    prototipo: '.scard[data-kind="canvas"] .cvz',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="canvas"] .canvas-card-board-rest',
    proprieta: ["cursor", "overflow"],
  },
  // ── gli estratti (T49) ────────────────────────────────────────────────────
  // «Estrai» in testata: l'azione d'accento in grassetto, come gli altri
  // pulsanti della testata per il resto.
  {
    id: "estratti.estrai",
    vista: "estratti-estrai",
    contesto: "documento",
    prototipo: '.scard[data-kind="pdf"].active #pdf-ex',
    app: '.pane.focus .pane-editor .live-card[data-card-active="true"][data-card-extract="ready"] .live-card-extract',
    proprieta: ["color", "font-weight", "display", "opacity"],
  },
  // L'estratto: la barra gialla a sinistra, i margini, il carattere del
  // paragrafo (il `font` del prototipo nomina `--f-text`, che non c'è, e il
  // testo eredita quello del paragrafo); sotto la fonte nel carattere
  // dell'interfaccia, e il pulsante d'accento. L'interlinea è del corpo del
  // testo (non di questo pezzo), e qui non si confronta, come per i valori
  // di cella.
  {
    id: "estratti.citazione",
    vista: "estratti-passo",
    contesto: "documento",
    prototipo: ".exc",
    app: ".pane.focus .pane-editor .live-card-excerpt",
    proprieta: ["border-left-width", "border-left-style", "border-left-color", "padding", "margin-top", "margin-bottom", "font-style", "font-size", "font-family", "color"],
  },
  {
    id: "estratti.fonte",
    vista: "estratti-passo",
    contesto: "documento",
    prototipo: ".exc footer",
    app: ".pane.focus .pane-editor .live-card-excerpt-source",
    proprieta: ["font-size", "font-style", "font-family", "color", "gap", "margin-top", ...ALLINEAMENTO],
  },
  {
    id: "estratti.vai",
    vista: "estratti-passo",
    contesto: "documento",
    prototipo: ".exc footer button",
    app: ".pane.focus .pane-editor .live-card-excerpt-go",
    proprieta: ["color", "padding", "border-radius"],
  },
  {
    id: "estratti.vai-passaggio",
    vista: "estratti-passo",
    contesto: "documento",
    prototipo: ".exc footer button",
    app: ".pane.focus .pane-editor .live-card-excerpt-go",
    gesto: { tipo: "hover", prototipo: ".exc footer button", app: ".pane.focus .pane-editor .live-card-excerpt-go" },
    proprieta: ["background-color"],
  },
  // ── la mini-barra (T12) ───────────────────────────────────────────────────
  {
    id: "mini-barra.superficie",
    vista: "mini-barra",
    prototipo: "#minibar",
    app: ".selection-bubble .mini-bar",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "mini-barra.grassetto",
    vista: "mini-barra",
    prototipo: '#minibar [data-mx="bold"]',
    app: '.selection-bubble .mini-bar [data-command="markdown.bold"]',
    proprieta: ["padding", "border-radius", "color", "background", ...DIMENSIONI, ...ALLINEAMENTO],
  },
  {
    id: "mini-barra.trasforma",
    vista: "mini-barra",
    prototipo: '#minibar [data-mx="turn"]',
    app: '.selection-bubble .mini-bar [data-command="mini-bar.transform"]',
    proprieta: ["padding", "gap", "border-radius", "font", "color", "background", "height", ...ALLINEAMENTO],
  },
  {
    id: "mini-barra.commenta",
    vista: "mini-barra",
    prototipo: '#minibar [data-mx="comment"]',
    app: '.selection-bubble .mini-bar [data-command="markdown.comment.add"]',
    proprieta: ["padding", "gap", "border-radius", "font", "color", "background", "height", ...ALLINEAMENTO],
  },
  {
    id: "mini-barra.filo",
    vista: "mini-barra",
    prototipo: "#minibar .sepv",
    app: ".selection-bubble .mini-bar .mini-bar-rule",
    proprieta: ["margin", "background", ...DIMENSIONI],
  },
  // ── la trasclusione viva (T29) ──────────────────────────────────────────
  {
    id: "trasclusione.vassoio",
    vista: "trasclusione-scrive",
    contesto: "documento",
    prototipo: ".tx.editing",
    app: ".embed.transclusion-editing",
    proprieta: ["padding", "border-radius", "box-shadow", "background-color"],
  },
  {
    id: "trasclusione.testata",
    vista: "trasclusione-scrive",
    contesto: "documento",
    prototipo: ".tx-h",
    app: ".transclusion-head",
    proprieta: ["height", "gap", "font", "color", ...ALLINEAMENTO],
  },
  {
    id: "trasclusione.modifica",
    vista: "trasclusione-scrive",
    contesto: "documento",
    prototipo: "#tx-edit",
    app: ".transclusion-edit",
    proprieta: ["height", "padding", "gap", "border-radius", "font", "color", "opacity", ...ALLINEAMENTO],
  },
  {
    id: "trasclusione.fascia",
    vista: "trasclusione-scrive",
    contesto: "documento",
    prototipo: ".tx-band",
    app: ".transclusion-band",
    proprieta: ["padding", "margin", "gap", "border-radius", "background-color", "font", "color", ...ALLINEAMENTO],
  },
  // ── il foglio nella nota (T43) ──────────────────────────────────────────
  // La cella attiva e la sua formula nel gruppo «Foglio» della barra (`.fxr`).
  {
    id: "foglio-nella-nota.cella",
    vista: "foglio-nella-nota",
    stati: LARGHI,
    prototipo: "#fx-sheet",
    app: ".format-bar-context .format-bar-context-cell",
    proprieta: ["font", "color", "padding", "max-width", "white-space"],
  },
  // Le lettere delle colonne, che a scheda attiva compaiono piccole e senza fondo.
  {
    id: "foglio-nella-nota.lettere",
    vista: "foglio-nella-nota",
    contesto: "documento",
    prototipo: ".scard .gr-let",
    app: '.live-card[data-card-active="true"] .canvas-card-sheet .grid-column-header',
    proprieta: ["font-size", "font-weight", "color"],
  },
  // ── il promemoria (T36) ───────────────────────────────────────────────────
  // Il colore, il fondo, la forma e il peso della `.rem`. La misura (12 px,
  // alta 21) no: nella pagina la pastiglia segue il testo in `em`, come la
  // scadenza accanto (`.px-pg :is(.due, .pill-in)` del prototipo, riga 1090).
  {
    id: "promemoria.pastiglia",
    vista: "promemoria",
    contesto: "documento",
    prototipo: ".rem",
    app: ".cm-content .cm-fub-reminder:not(.cm-fub-reminder-done)",
    proprieta: ["color", "background", "box-shadow", "border-radius", "font-weight", "font-family", "white-space", ...ALLINEAMENTO],
  },
  {
    id: "promemoria.sveglia",
    vista: "promemoria",
    contesto: "documento",
    prototipo: ".rem svg",
    app: ".cm-content .cm-fub-reminder:not(.cm-fub-reminder-done) svg",
    proprieta: ["color"],
  },
  // ── la scheda di documento (T44) ──────────────────────────────────────────
  // Il margine del testo (`.docw`) e l'inchiostro e lo spazio dei paragrafi
  // (`.docp`). Il carattere no: il prototipo lo scrive con `var(--f-text)`,
  // un token che non dichiara, e la regola `font` intera cade (il testo
  // eredita quello della nota); l'app tiene la misura scritta, 14/1,6.
  {
    id: "scheda-documento.testo",
    vista: "scheda-documento",
    contesto: "documento",
    prototipo: '.scard[data-kind="doc"] .docw',
    app: '.live-card[data-card-kind="document"] .canvas-card-document-content',
    proprieta: ["padding"],
  },
  {
    id: "scheda-documento.paragrafo",
    vista: "scheda-documento",
    contesto: "documento",
    prototipo: '.scard[data-kind="doc"] .docp p:not(.r)',
    app: '.live-card[data-card-kind="document"] .canvas-card-document-content > p',
    proprieta: ["margin", "color"],
  },

];
