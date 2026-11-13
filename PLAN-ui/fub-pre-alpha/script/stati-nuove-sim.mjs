// Gli stati che il secondo giro aggiunge sopra le catture: un pezzo di DOM
// nuovo (una toppa, `toppe/*.html`, col commento di destinazione e il task), o
// una cattura dentro un'altra (uno strato), o le due cose. prov «nuova» vuol
// dire «da approvare»: il codice non c'è ancora. prov «composta» vuol dire
// che il simulatore mette insieme o toglie pezzi già catturati, senza DOM
// nuovo. prov «cattura»: il client vero (qui solo il quarto giro, `giro4`).
//
// Forma delle toppe (applicate da vista-sim.js, in quest'ordine):
//   { dove, come: dentro|inizio|prima|dopo|sostituisci|vuota, html: <toppa> }
//   { dove, come, da: <cattura>, sel }       un pezzo di un'altra cattura
//   { dove, attr: { nome: valore | null } }  { dove, classe: "+a -b" }
//   { dove, testo } (tiene le icone)  { dove, testi: [..] }  { dove, rimuovi: true }
//   tutte: true (ogni elemento, non il primo), in: "strato" (nel documento dello strato),
//   ancora: sel ("strato:" = dentro lo strato), lato: sopra|sotto|destra|dentro,
//   scorri: true (porta in vista).
// I selettori sono provati con sonda-sel.mjs sulle catture vere.

const nuova = (g, id, nome, o) => ({ g, id, nome, prov: "nuova", fuoco: "body", ...o });
const composta = (g, id, nome, o) => ({ g, id, nome, prov: "composta", fuoco: "body", ...o });
const cattura = (g, id, nome, o) => ({ g, id, nome, prov: "cattura", fuoco: "body", ...o });

// ── La lavagna nuova (N6 T26–T28, D3 A) ─────────────────────────────────────
// La cornice è quella del disegno K5 (g2-disegno-penna): stessa colonna, stessa
// riga delle opzioni, stessa banda. Il foglio della lavagna è uno strato con le
// schede del prototipo approvato (p-lav-*), dentro `.draw-stage`.
const LAV_BASE = "g2-disegno-penna";
const LAV_STAGE = ".draw-stage";
function lavCornice({ strumento = "select", opzioni = "lav-opzioni", schede = "10 schede", zoom = "80%" } = {}) {
  const t = [
    { dove: ".tab[aria-selected=true] .tab-name", testo: "Mappa del banco" },
    { dove: ".tab[aria-selected=true]", attr: { "aria-label": "Mappa del banco · Lavagna" } },
    { dove: ".crumb-name", testo: "Mappa del banco.canvas" },
    { dove: ".draw-rail .kit-rail", come: "sostituisci", html: "lav-colonna" },
    { dove: ".draw-rail .draw-group", rimuovi: true },
    { dove: ".draw-rail-full", rimuovi: true },
    { dove: ".pane.focus .segmented-option[data-mode=draw]", testo: "Lavagna" },
    { dove: ".pane-mode-name", testo: "Lavagna" },
    { dove: ".pane-mode-current", attr: { "aria-label": "Modalità: Lavagna" } },
    { dove: "#status-mode .status-mode-name", testo: "Lavagna" },
    { dove: "[data-surface-item=zoom]", testo: zoom },
    { dove: "[data-surface-item=objects]", testo: schede },
    { dove: ".draw-rail [data-tool]", attr: { "aria-pressed": "false", tabindex: "-1" }, tutte: true },
    { dove: `.draw-rail [data-tool=${strumento}]`, attr: { "aria-pressed": "true", tabindex: "0" } },
  ];
  if (opzioni) t.push({ dove: ".draw-toolbar .kit-options-row", come: "sostituisci", html: opzioni });
  return t;
}
const LAV_TASK = ["N6 T26", "N6 T27", "N6 T28", "PA T28"];
function lav(id, nome, { strato, dice, task = LAV_TASK, toppe = [], cornice = {}, fuoco = ".draw-rail [aria-pressed=true]", ...o }) {
  return nuova("Lavagna", id, nome, {
    base: LAV_BASE,
    strati: strato ? [{ cattura: strato, dove: LAV_STAGE }] : [],
    toppe: [...lavCornice(cornice), ...toppe],
    dice, task, fuoco, piano: "N6", ...o,
  });
}

// ── Il disegno con la banda di D5 A ─────────────────────────────────────────
const DIS_A_TASK = ["K5 T21", "K5 T22", "K5 T23", "S2 T4", "PA T27"];
const RAIL_TESTO = { dove: ".draw-rail .kit-rail", come: "sostituisci", da: "p-dis-1", sel: ".kit-rail" };
// D5 = A (2026-11-07): si costruisce questa forma; B resta a parte, senza
// gemelli. «base» sceglie la cattura del client (la riga delle opzioni dello
// strumento), «rail» la colonna di K5 da cui si parte.
const premuto = (tool) => [
  { dove: ".draw-rail [data-tool]", attr: { "aria-pressed": "false", tabindex: "-1" }, tutte: true },
  { dove: `.draw-rail [data-tool=${tool}]`, attr: { "aria-pressed": "true", tabindex: "0" } },
];
function disA(id, nome, banda, dice, extra = [], { base = "g2-disegno-penna", rail = RAIL_TESTO, fuoco = "#status-standing", task = DIS_A_TASK } = {}) {
  return nuova("Disegno", id, nome, {
    base,
    toppe: [rail, { dove: "#status-mode", come: "prima", html: banda }, ...extra],
    dice, task, fuoco,
  });
}

// ── Le Impostazioni ─────────────────────────────────────────────────────────
const BARRE = (html) => ({ dove: '[data-setting-key="appearance.density"]', come: "dopo", html, scorri: true });
const MARCATE = { dove: "html", attr: { "data-bars": "marked" } };
const COMP_BODY = "#settings-section-2-installati-su-questa-macchina .settings-section-body";
const TEMA_TASK = ["PA T36", "PA T37"];
const catalogo = { dove: '[data-setting-key="appearance.theme"]', come: "dopo", html: "tema-catalogo" };
const sviluppo = { dove: "#settings-section-4-profili", come: "dopo", html: "tema-sviluppo", scorri: true };

export const NUOVE = [
  // ── I file ──────────────────────────────────────────────────────────────
  nuova("File", "file-nuovo-tipo", "«Nuovo» chiede il tipo", {
    base: "nota-riposo",
    toppe: [{ dove: "body", come: "dentro", html: "menu-nuovo", ancora: "#new-note", lato: "sotto" }],
    fuoco: "#context-menu [role=menuitem]",
    dice: "Il «+» dell'albero apre un menu: nota, documento, foglio, disegno, lavagna, da un modello, cartella. Ctrl+N fa ancora una nota senza chiedere.",
    task: ["PA T43", "PA T44"],
  }),
  nuova("File", "file-troppo-grande", "Un file troppo grande", {
    base: "craft-rotto",
    toppe: [
      { dove: ".craft-empty p", testi: ["Riprese del cantiere.mov", "Video · 3,8 GiB", "È troppo grande per aprirlo qui: Fub non lo carica in memoria"] },
      { dove: ".craft-empty-state", come: "dopo", html: "altra-app-grande" },
    ],
    fuoco: ".craft-empty-actions .kit-button",
    dice: "Oltre la misura che Fub regge, il file non si apre: lo dice, e offre l'altra app o la sola lettura. Il file non si tocca.",
    task: ["PA T30"],
  }),
  nuova("File", "file-sconosciuto", "Un formato che Fub non conosce", {
    base: "craft-rotto",
    toppe: [
      { dove: ".craft-empty p", testi: ["modello-tetto.skp", "File SketchUp · 18 MiB", "Fub non conosce questo formato"] },
      { dove: ".craft-empty-state", come: "dopo", html: "altra-app" },
    ],
    fuoco: ".craft-empty-actions .kit-button",
    dice: "Un formato senza editor: il nome, il tipo e la misura, e due gesti, l'altra app o la cartella.",
    task: ["PA T30"],
  }),
  nuova("File", "vault-irraggiungibile", "Il vault non si raggiunge", {
    base: "avvio-guasto",
    toppe: [
      { dove: "#avvio-titolo", testo: "Il vault non si raggiunge" },
      { dove: "#avvio-motivo", testo: "La cartella «Note» sul disco esterno non c'è: forse il disco è staccato. Niente è stato cambiato." },
      { dove: ".avvio-azioni", come: "dentro", html: "vault-scegli" },
    ],
    fuoco: ".avvio-azioni button",
    dice: "All'avvio la cartella del vault manca (un disco staccato, una rete giù): Riprova, oppure un altro vault. Il vault vecchio resta nella lista.",
    task: ["PA T30", "N7"],
  }),
  cattura("File", "g4-conflitto-confronta", "Conflitto: «Confronta»", {
    fuoco: ".modale button",
    dice: "«Confronta» apre le due versioni riga per riga: − solo su disco, + solo nel mio testo. Si guarda e si chiude; la scelta resta al banner. È il codice di oggi (ui/compare.ts).",
    task: ["main", "PA T5"],
  }),
  cattura("File", "g4-conflitto-mio", "Conflitto: «Mantieni il mio testo»", {
    fuoco: ".kit-dialog .kit-button",
    dice: "Prima di scrivere, Fub chiede: tenere il mio testo copre la modifica arrivata da fuori. Sì salva e chiude il banner; Annulla torna al conflitto.",
    task: ["main", "PA T5"],
  }),
  cattura("File", "g4-conflitto-disco", "Conflitto: «Usa la versione su disco»", {
    fuoco: ".kit-dialog .kit-button",
    dice: "La domanda di pericolo: le modifiche non salvate si buttano. Il fuoco parte da Annulla, perché un Invio di slancio non distrugga niente.",
    task: ["main", "PA T5"],
  }),
  cattura("File", "g4-conflitto-dopo", "Conflitto: «Decidi dopo»", {
    fuoco: ".conflict-banner button",
    dice: "Il banner si riduce a una riga: la scelta aspetta e niente è stato scritto. «Scegli ora» lo riapre.",
    task: ["main", "PA T5"],
  }),

  // ── Il foglio ───────────────────────────────────────────────────────────
  nuova("Foglio", "foglio-vuoto", "Un foglio vuoto", {
    base: "foglio",
    toppe: [
      { dove: ".grid-notice", come: "sostituisci", html: "foglio-vuoto" },
      { dove: ".grid-cell .grid-cell-text", testo: "", tutte: true },
      { dove: ".grid-sheets button:nth-of-type(2)", rimuovi: true },
    ],
    fuoco: ".grid-cell",
    dice: "Un .xlsx nuovo: le celle vuote, un foglio solo, una riga che dice da dove partire.",
    task: ["griglia T1", "PA T27"],
  }),
  nuova("Foglio", "foglio-enorme", "Un foglio enorme", {
    base: "foglio",
    toppe: [
      { dove: ".grid-notice", come: "sostituisci", html: "foglio-enorme" },
      { dove: ".grid-row-header", testi: Array.from({ length: 21 }, (_, i) => (48201 + i).toLocaleString("it-IT")) },
    ],
    fuoco: ".grid-cell",
    dice: "Un milione di righe: Fub legge a pezzi mentre si scorre, e lo dice una volta sopra la griglia.",
    task: ["griglia T8", "PA T27"],
  }),

  // ── Il disegno (D5: A qui, B nelle composte dis-b-*) ─────────────────────
  disA("disegno-a-pronto", "D5 A: il motore pronto, nella banda", "banda-motore-pronto",
    "D5 A: lo stato del motore sta nella banda in basso, non sul foglio. Pronto: un punto verde e una parola."),
  disA("disegno-a-perse", "D5 A: 3 parti restano come sono", "banda-motore-perse",
    "D5 A: tre parti del file il motore non le sa scrivere; restano come sono. Il segno ambra nella banda, il dettaglio a un clic."),
  disA("disegno-a-spento", "D5 A: motore spento", "banda-motore-spento",
    "D5 A: il motore è spento nelle Impostazioni; il disegno si guarda ma non si modifica."),
  disA("disegno-a-fermo", "D5 A: motore fermo, aperto", "banda-motore-fermo",
    "D5 A: il motore si è fermato; la banda apre il pannello con «Riprova».",
    [{ dove: "body", come: "dentro", da: "p-dis-4", sel: "#kit-popover-1", ancora: "#status-standing", lato: "sopra" }]),
  disA("disegno-a-apre", "D5 A: il disegno si sta aprendo", "banda-motore-apre",
    "D5 A: mentre il motore carica, la banda lo dice; il foglio resta fermo."),
  disA("disegno-a-cinquecento", "D5 A: 500 parti restano come sono", "banda-motore-cinquecento",
    "D5 A: un disegno con 500 parti che il motore non sa scrivere: la banda lo dice, e il riquadro di K5 (2b) le elenca, con «Vai» per trovarle sul foglio.",
    [{ dove: "body", come: "dentro", da: "p-dis-2b", sel: "#kit-popover-1", ancora: "#status-standing", lato: "sopra" }]),
  disA("disegno-a-senza", "D5 A: senza motore", "banda-motore-senza",
    "D5 A: questa versione di Fub non ha il motore del disegno: gli strumenti semplici funzionano, e il riquadro di K5 (5) dice che cosa manca e dove si accende.",
    [{ dove: "body", come: "dentro", da: "p-dis-5", sel: "#kit-popover-1", ancora: "#status-standing", lato: "sopra" }]),
  disA("disegno-a-rifiutato", "D5 A: una modifica non applicata", "banda-motore-perse",
    "D5 A: si prova a cambiare una delle parti che restano come sono: la figura resta com'è e scelta, la banda tiene il segno ambra, e il lettore di schermo sente «Modifica non applicata» (K5 6a). Niente finestre.",
    [...premuto("select"), { dove: "body", come: "dentro", html: "disegno-rifiutato-annuncio" }],
    { base: "disegno-selezione" }),
  disA("disegno-a-testo-spento", "D5 A: Testo col motore spento", "banda-motore-spento",
    "D5 A: col motore spento il Testo funziona anche con gli strumenti semplici (K5 7b): la colonna lo tiene acceso, la riga delle opzioni è la sua, la banda dice «Motore spento».",
    [{ dove: ".draw-toolbar .kit-options-row", come: "sostituisci", da: "p-dis-7b", sel: ".kit-options-row" }],
    { rail: { dove: ".draw-rail .kit-rail", come: "sostituisci", da: "p-dis-7b", sel: ".kit-rail" }, fuoco: ".draw-rail [data-tool=text]" }),
  disA("disegno-a-mano", "D5 A: la mano", "banda-motore-pronto",
    "D5 A: la mano (H) sposta il foglio; la colonna di K5 con Testo, la riga delle opzioni del client, il motore nella banda.",
    premuto("hand"), { base: "g2-disegno-mano", fuoco: ".draw-rail [data-tool=hand]" }),
  disA("disegno-a-gomma", "D5 A: la gomma", "banda-motore-pronto",
    "D5 A: la gomma (E) con la sua riga d'opzioni; la colonna di K5 con Testo, il motore nella banda.",
    premuto("eraser"), { base: "g2-disegno-gomma", fuoco: ".draw-rail [data-tool=eraser]" }),
  disA("disegno-a-rettangolo", "D5 A: il rettangolo", "banda-motore-pronto",
    "D5 A: le forme (R): il rettangolo con riempimento e bordo; la colonna di K5 con Testo, il motore nella banda.",
    premuto("rect"), { base: "g2-disegno-rettangolo", fuoco: ".draw-rail [data-tool=rect]" }),
  nuova("Disegno", "disegno-a-testo", "Lo strumento Testo con la sua riga", {
    base: "g2-disegno-penna",
    toppe: [
      RAIL_TESTO,
      { dove: ".draw-rail [data-tool]", attr: { "aria-pressed": "false" }, tutte: true },
      { dove: ".draw-rail [data-tool=text]", attr: { "aria-pressed": "true" } },
      { dove: ".draw-toolbar .kit-options-row", come: "sostituisci", da: "p-dis-7a", sel: ".kit-options-row" },
    ],
    fuoco: ".draw-rail [data-tool=text]",
    dice: "Testo (T): la colonna ha sei strumenti, e la riga delle opzioni diventa quella del testo: carattere, misura, allineamento.",
    task: ["K5 T21", "K5 T22", "PA T27"],
  }),
  nuova("Disegno", "disegno-vuoto", "Un disegno vuoto", {
    base: "g2-disegno-penna",
    toppe: [
      RAIL_TESTO,
      { dove: ".draw-stage", come: "dentro", html: "disegno-vuoto" },
      { dove: "[data-surface-item=objects]", testo: "0 oggetti" },
    ],
    fuoco: ".draw-rail [aria-pressed=true]",
    dice: "Un .svg nuovo: una riga sul foglio dice da dove partire, e sparisce al primo tratto.",
    task: ["K5 T21", "PA T27"],
  }),

  // ── La lavagna (D3 A: da approvare) ─────────────────────────────────────
  lav("lav-impianto", "La lavagna nuova: schede di ogni tipo", {
    strato: "p-lav-schede-snapshot",
    dice: "D3 A: la lavagna con la cornice del disegno (colonna, riga delle opzioni, banda) e le schede del prototipo approvato: nota, documento, foglio, immagine, PDF, disegno, web, CSV, testo, audio.",
  }),
  lav("lav-vuota", "Una lavagna vuota", {
    toppe: [{ dove: ".draw-stage", come: "vuota", html: "lav-vuota" }],
    cornice: { schede: "0 schede", zoom: "100%" },
    dice: "Una lavagna nuova: il foglio spiega da sé come si aggiunge una scheda (trascinare un file, scrivere, incollare).",
  }),
  lav("lav-sel-una", "Una scheda scelta: la barra sopra", {
    strato: "p-lav-schede-snapshot",
    toppe: [
      { dove: "article.proto-at-nota", classe: "+selected", in: "strato" },
      { dove: "body", come: "dentro", html: "lav-bolla-una", ancora: "strato:article.proto-at-nota", lato: "sopra" },
    ],
    fuoco: ".lav-selection button",
    dice: "Una scheda scelta: sopra compare la barra della selezione (apri, colore, collega, altro). Si chiude con Esc o un clic fuori.",
  }),
  lav("lav-sel-molte", "Molte schede scelte", {
    strato: "p-lav-schede-selected",
    toppe: [
      { dove: "body", come: "dentro", html: "lav-bolla-molte", ancora: "strato:article.proto-at-nota", lato: "sopra" },
    ],
    fuoco: ".lav-selection button",
    dice: "Dieci schede scelte: la barra dice quante e offre ciò che vale per tutte (allinea, colore, raggruppa).",
  }),
  lav("lav-scrive", "Si scrive in una scheda", {
    strato: "p-lav-schede-active",
    cornice: { strumento: "text", opzioni: "lav-opzioni-scrive" },
    dice: "Doppio clic su una scheda di testo: si scrive sul posto, e la riga delle opzioni diventa la barra di formato. Esc esce, Ctrl+Invio fa una scheda sotto.",
    task: [...LAV_TASK, "N6 T27"],
  }),
  lav("lav-scrive-slash", "Si scrive in una scheda: «/»", {
    strato: "p-lav-schede-active",
    cornice: { strumento: "text", opzioni: "lav-opzioni-scrive" },
    toppe: [{ dove: "body", come: "dentro", da: "slash", sel: ".slash-panel", ancora: "strato:article.proto-at-testo", lato: "dentro" }],
    fuoco: ".slash-panel [role=option]",
    dice: "«/» dentro una scheda apre lo stesso menu dei blocchi della nota: titoli, elenchi, tabella, citazione.",
  }),
  lav("lav-filo-nuovo", "Collegare due schede", {
    strato: "p-lav-maniglie",
    cornice: { strumento: "connect" },
    dice: "Collega (C): le maniglie sui lati delle schede; si trascina da una all'altra e nasce il filo.",
  }),
  lav("lav-penna", "La penna sulla lavagna", {
    strato: "p-lav-inchiostro",
    cornice: { strumento: "pen", opzioni: null },
    dice: "La penna: l'inchiostro sopra le schede. La riga delle opzioni è quella della penna del disegno; il menu della penna (N4) è negli stati pen-*.",
  }),
  lav("lav-evidenziatore", "L'evidenziatore sulla lavagna", {
    strato: "p-lav-inchiostro",
    cornice: { strumento: "highlighter", opzioni: null },
    dice: "L'evidenziatore: un tratto largo e trasparente, sotto il testo delle schede.",
  }),
  lav("lav-gomma", "La gomma sulla lavagna", {
    strato: "p-lav-inchiostro",
    cornice: { strumento: "eraser", opzioni: null },
    dice: "La gomma (E): toglie i tratti d'inchiostro, mai le schede.",
  }),
  lav("lav-lazo", "Il lazo", {
    strato: "p-lav-schede-snapshot",
    cornice: { strumento: "lasso" },
    toppe: [
      { dove: "#proto-viewport", come: "dentro", html: "lav-lazo", in: "strato" },
      { dove: "article.proto-at-nota, article.proto-at-documento, article.proto-at-foglio", classe: "+selected", in: "strato", tutte: true },
    ],
    dice: "Il lazo (Q): si gira attorno e prende schede e tratti insieme.",
  }),
  lav("lav-estratti", "Le parti di un PDF rilasciato", {
    strato: "p-lav-schede-snapshot",
    toppe: [{ dove: "body", come: "dentro", html: "lav-estratti", ancora: "strato:article.proto-at-pdf", lato: "destra" }],
    fuoco: ".lav-parts button, .lav-parts input",
    dice: "Un PDF rilasciato sulla lavagna: si sceglie quali pagine diventano schede (tutte, una, un intervallo).",
    task: [...LAV_TASK, "N6 T28"],
  }),
  lav("lav-codice-menu", "La lavagna in codice: il menu", {
    strato: "p-lav-schede-snapshot",
    toppe: [
      { dove: "article.proto-at-nota", classe: "+selected", in: "strato" },
      { dove: "body", come: "dentro", html: "lav-codice-menu", ancora: "strato:article.proto-at-nota", lato: "destra" },
      { dove: "body", come: "dentro", html: "lav-codice-disponi", ancora: "#context-menu [aria-haspopup=menu]", lato: "destra" },
    ],
    fuoco: "#context-menu [role=menuitem]",
    dice: "Tasto destro su una scheda: «Copia come codice», «Incolla codice» e «Disponi» (in griglia, in colonna, ad albero).",
    task: ["lavagna in codice", "PA T28"],
  }),
  lav("lav-codice-riepilogo", "«Incolla codice»: il riassunto", {
    strato: "p-lav-schede-snapshot",
    toppe: [{ dove: "body", come: "dentro", html: "lav-codice-riepilogo" }],
    fuoco: ".kit-dialog .kit-button",
    dice: "Prima di scrivere sulla lavagna, il riassunto: quante schede e fili arrivano, e dove.",
    task: ["lavagna in codice", "PA T28"],
  }),
  lav("lav-codice-problema", "«Incolla codice» con un problema", {
    strato: "p-lav-schede-snapshot",
    toppe: [{ dove: "body", come: "dentro", html: "lav-codice-problema" }],
    fuoco: ".kit-dialog .kit-button",
    dice: "Il codice incollato ha un errore: il primo, con la riga e un suggerimento. Niente si scrive.",
    task: ["lavagna in codice", "PA T28"],
  }),

  // ── Il PDF ──────────────────────────────────────────────────────────────
  nuova("Pdf", "pdf-pagina3", "Un link a `#page=3`", {
    base: "pdf",
    toppe: [{ dove: "[data-surface-item=page]", testo: "Pagina 3 di 12" }],
    dice: "Un collegamento `contratto.pdf#page=3` apre il PDF alla terza pagina, e la banda lo dice. (Il file del banco ha una pagina sola: qui cambia solo la banda.)",
    task: ["PA T32"],
  }),

  // ── I componenti (K2) ───────────────────────────────────────────────────
  nuova("Componenti", "comp-installato", "Un componente della comunità", {
    base: "componenti",
    toppe: [{ dove: COMP_BODY, come: "vuota", html: "comp-installato", scorri: true }],
    fuoco: ".settings-component [role=switch]",
    dice: "Un componente installato da un file: nome, versione, fiducia, se è attivo; l'interruttore «Acceso», il consenso, i permessi che chiede e «Togli», spento finché il componente è acceso (D18 A: le parole del lessico).",
    task: ["K1", "K2 T3", "PA T29", "PA T46"],
  }),
  nuova("Componenti", "comp-permesso", "Il consenso: i permessi", {
    base: "componenti",
    toppe: [
      { dove: COMP_BODY, come: "vuota", html: "comp-installato", scorri: true },
      { dove: "body", come: "dentro", html: "comp-permesso" },
    ],
    fuoco: ".kit-dialog .kit-button[data-action=confirm]",
    dice: "Quando il consenso passa a «Concesso», Fub elenca che cosa il componente potrà fare e chiede. I permessi si tolgono uno per uno anche dopo.",
    task: ["K1", "K2 T3", "PA T29", "PA T46"],
  }),
  nuova("Componenti", "comp-rotto-tempo", "Un componente fermato: il tempo", {
    base: "componenti",
    toppe: [{ dove: COMP_BODY, come: "vuota", html: "comp-fermo-tempo", scorri: true }],
    fuoco: ".settings-component .settings-btn:not([disabled])",
    dice: "Il componente ha superato il tempo concesso: Fub lo ferma, lo dice e offre «Riavvia». Il resto continua.",
    task: ["K1", "K2 T3", "PA T29", "PA T46"],
  }),
  nuova("Componenti", "comp-rotto-errore", "Un componente fermato: un errore", {
    base: "componenti",
    toppe: [{ dove: COMP_BODY, come: "vuota", html: "comp-fermo-errore", scorri: true }],
    fuoco: ".settings-component .settings-btn:not([disabled])",
    dice: "Un errore dentro il componente (una trappola): fermato, col motivo in chiaro e i dettagli da copiare.",
    task: ["K1", "K2 T3", "PA T29", "PA T46"],
  }),
  nuova("Componenti", "comp-aggiorna", "Una versione nuova (fuori)", {
    base: "componenti",
    toppe: [{ dove: COMP_BODY, come: "vuota", html: "comp-aggiorna", scorri: true }],
    fuoco: ".settings-component .settings-btn:not([disabled])",
    perche: "Fuori dalla pre-alpha: nessun piano aggiorna un componente. Si vede per completezza; il posto è un piano dopo la pre-alpha.",
    dice: "Come apparirebbe una versione nuova di un componente. Non è nella pre-alpha.",
    task: ["dopo la pre-alpha"],
  }),

  // ── Impostazioni ────────────────────────────────────────────────────────
  composta("Impostazioni", "imp-info-prealpha", "Informazioni: 0.2.0-prealpha.1", {
    base: "g2-imp-info",
    toppe: [{ dove: ".settings-main .setting-label", testo: "Versione 0.2.0-prealpha.1" }],
    fuoco: ".settings-main a, .settings-main button",
    dice: "Informazioni con la versione della pre-alpha: la stessa che va nei riscontri. Il verde di serie (D25) e il logo intero a 48 px, con la cartella nella tinta (D26).",
    task: ["PA T22", "PA T48", "PA T49"],
  }),

  // «Le barre» (D6 C): la riga in Aspetto dopo «Densità», e le due varianti.
  nuova("Impostazioni", "aspetto-barre", "Aspetto: «Le barre» (chiare)", {
    base: "aspetto",
    toppe: [BARRE("aspetto-barre")],
    fuoco: '[data-setting-key="appearance.bars"] [role=radio]',
    dice: "D6 C: la riga «Le barre» dopo «Densità». Di serie «Chiare»: il vassoio vicino alla carta sotto le schede, le barre dei comandi e la colonna. Nel simulatore la scelta cambia davvero tutti gli stati.",
    task: ["PA T11"],
  }),
  nuova("Impostazioni", "aspetto-barre-marcate", "Aspetto: «Le barre» marcate", {
    base: "aspetto",
    toppe: [BARRE("aspetto-barre-marcate"), MARCATE],
    fuoco: '[data-setting-key="appearance.bars"] [role=radio]',
    dice: "D6 C: «Marcate» rimette `--sheet-2` sotto tutte le barre, come prima di Scrittoio 2: il vassoio si stacca di più dalla carta. La riga dice che la scelta è cambiata, con «Azzera».",
    task: ["PA T11"],
  }),
  nuova("Impostazioni", "barra-marcate", "La barra di formato con le barre marcate", {
    base: "barra",
    toppe: [MARCATE],
    fuoco: ".kit-bar button",
    dice: "D6 C: una nota con la barra di formato e «Le barre: marcate». Il vassoio della barra e quello delle schede prendono `--sheet-2`; i foglietti restano come sono.",
    task: ["PA T11"],
  }),

  // ── Riscontri (D9) ──────────────────────────────────────────────────────
  composta("Riscontri", "riscontri-a", "D9 A e C: nessuna faccia in Fub", {
    base: "g2-menu",
    fuoco: "#context-menu [role=menuitem]",
    dice: "D9 A: non si costruisce (l'utente ha scelto B il 2026-11-07). Con A e C i riscontri passavano solo dalle issue di GitHub e dalla pagina «Prova la pre-alpha»; il menu di Fub restava com'era.",
    task: ["PA T18"],
  }),
  nuova("Riscontri", "riscontri-b-menu", "D9 B: «Segnala un problema…»", {
    base: "g2-menu",
    toppe: [{ dove: "#context-menu .menu-items > button:last-of-type", come: "prima", html: "riscontri-voce" }],
    fuoco: "#context-menu [role=menuitem]",
    dice: "D9 B (scelta il 2026-11-07): una voce nel menu dell'applicazione apre la pagina dell'issue con versione e sistema già scritti.",
    task: ["PA T52", "PA T18"],
  }),
  nuova("Riscontri", "riscontri-b-apre", "D9 B: che cosa si manda", {
    base: "g2-menu",
    toppe: [{ dove: "#context-menu", rimuovi: true }, { dove: "body", come: "dentro", html: "riscontri-apre" }],
    fuoco: ".kit-dialog .kit-button",
    dice: "D9 B: prima di aprire il browser, Fub mostra esattamente che cosa scrive nella pagina (versione, sistema) e che non manda altro.",
    task: ["PA T52"],
  }),

  // ── I casi ai bordi dei dati ────────────────────────────────────────────
  composta("Casi", "dati-uno", "Un vault con una nota sola", {
    base: "nota-riposo",
    toppe: [
      { dove: "#file-list > li:not(:last-child)", rimuovi: true, tutte: true },
      { dove: ".pane.focus .tab:not([aria-selected=true])", rimuovi: true, tutte: true },
    ],
    fuoco: ".pane.focus .cm-content",
    dice: "Una nota sola: l'albero ha una riga, la testata una linguetta; niente si allarga per riempire.",
    task: ["main"],
  }),
  composta("Casi", "dati-nome-lungo", "Un nome lunghissimo", {
    base: "nota-riposo",
    toppe: [
      { dove: ".tab[aria-selected=true] .tab-name", testo: "Verbale della riunione di condominio di via Roma 12 con le decisioni sul tetto e sulla caldaia" },
      { dove: ".crumb-name", testo: "Verbale della riunione di condominio di via Roma 12 con le decisioni sul tetto e sulla caldaia" },
      { dove: "#file-list > li:last-child .row-name", testo: "Verbale della riunione di condominio di via Roma 12 con le decisioni sul tetto e sulla caldaia" },
    ],
    fuoco: ".pane.focus .cm-content",
    dice: "Un nome di cento caratteri: la linguetta, il percorso e l'albero lo tagliano coi puntini; il nome intero sta nel suggerimento.",
    task: ["main"],
  }),
  composta("Casi", "dati-cinquemila", "Un vault di 5.000 file", {
    base: "nota-riposo",
    toppe: [{ dove: "#file-list .row-count", testi: ["1.204", "860", "1.312", "1.509", "115"] }],
    fuoco: ".pane.focus .cm-content",
    dice: "Cinquemila file: le cartelle li contano, chiuse. L'albero oggi non è virtualizzato (una cartella da 1.500 note aperta disegna 1.500 righe): lo misura PA T45.",
    task: ["PA T45"],
  }),

  // ── N2 / MCP ────────────────────────────────────────────────────────────
  nuova("Cornice", "mcp-riflesso", "N2: ciò che ha fatto un agente", {
    base: "g2-attivita",
    toppe: [{ dove: "#activity-panel .activity-row", come: "prima", html: "mcp-riga" }],
    fuoco: "#activity-panel button",
    dice: "N2 non ha una schermata sua: ciò che un agente (MCP) scrive passa dalle stesse porte, e si vede nel centro attività, annullabile dalle versioni.",
    task: ["N2", "PA T26"],
  }),

  // ── La skin facile (PA T34–T42) ─────────────────────────────────────────
  nuova("Temi", "tema-sviluppo", "Aspetto: la modalità sviluppatore", {
    base: "aspetto",
    toppe: [catalogo, sviluppo],
    fuoco: "#settings-section-sviluppo [role=switch], #settings-section-sviluppo button",
    dice: "Con la modalità sviluppatore accesa, Aspetto ha il gruppo «Sviluppo» e l'elenco dei temi installati, con «Installa da una cartella…».",
    task: TEMA_TASK,
  }),
  nuova("Temi", "tema-installa", "Installare un tema da una cartella", {
    base: "aspetto",
    toppe: [catalogo, sviluppo, { dove: "body", come: "dentro", da: "palette-file", sel: ".launcher-layer" }],
    fuoco: ".launcher-input",
    dice: "«Installa da una cartella…» apre la scelta della cartella; Fub legge `theme.json` e prova il tema prima di installarlo.",
    task: TEMA_TASK,
  }),
  nuova("Temi", "tema-sostituisci", "Un tema con lo stesso id", {
    base: "aspetto",
    toppe: [catalogo, { dove: "body", come: "dentro", html: "tema-sostituisci" }],
    fuoco: ".kit-dialog .kit-button",
    dice: "Il tema ha l'id di uno già installato: «Sostituisci» lo mette al posto del vecchio, che resta da parte finché la copia non riesce.",
    task: ["PA T36"],
  }),
  nuova("Temi", "tema-sostituisci-fallito", "La sostituzione non riesce", {
    base: "aspetto",
    toppe: [catalogo, { dove: "body", come: "dentro", html: "tema-sostituisci-fallito" }],
    fuoco: ".kit-dialog .kit-button",
    dice: "La copia si interrompe: il tema vecchio torna com'era, e Fub dice che cosa è successo.",
    task: ["PA T36"],
  }),
  nuova("Temi", "tema-rifiutato", "Un tema rifiutato: perché", {
    base: "aspetto",
    toppe: [catalogo, { dove: "[data-theme-catalog]", come: "dopo", html: "tema-diagnosi" }],
    fuoco: ".tema-diagnosi button, .tema-diagnosi a",
    dice: "Il tema non passa il controllo: la diagnosi dice la regola, il file e la riga, e che cosa fare. Il tema in uso non cambia.",
    task: ["PA T36"],
  }),
  nuova("Temi", "tema-collegato", "Un tema collegato, in sviluppo", {
    base: "aspetto",
    toppe: [{ dove: '[data-setting-key="appearance.theme"]', come: "dopo", html: "tema-collegato" }, sviluppo],
    fuoco: "[data-theme-linked] button",
    dice: "Un tema collegato a una cartella: ogni salvataggio del file si vede subito, e l'etichetta «In sviluppo» lo ricorda.",
    task: ["PA T37"],
  }),
  nuova("Temi", "tema-anteprima", "L'anteprima di un tema che eredita", {
    base: "aspetto", tema: "carta",
    toppe: [catalogo],
    fuoco: "[data-theme-catalog] button",
    dice: "Carta eredita dalla serie e cambia poco: l'anteprima si vede su tutta la finestra prima di sceglierlo.",
    task: ["PA T37", "PA T38"],
  }),
  nuova("Temi", "tema-tutti-componenti", "«Tutti i componenti»", {
    base: "nota-riposo",
    toppe: [
      { dove: ".tab[aria-selected=true] .tab-name", testo: "Tutti i componenti" },
      { dove: ".crumb-name", testo: "Tutti i componenti" },
      { dove: ".pane.focus .pane-editor", come: "vuota", html: "tutti-componenti" },
    ],
    gemelli: true,
    fuoco: ".dev-catalog [role=tab]",
    dice: "Una linguetta con tutti i componenti negli stati del contratto (riposo, sopra, premuto, fuoco, spento): chi fa un tema li guarda insieme.",
    task: ["PA T38", "PA T39"],
  }),
  nuova("Temi", "tema-tutti-tavolozza", "«Tutti i componenti»: la tavolozza", {
    base: "tema-tutti-componenti",
    toppe: [{ dove: ".dev-catalog-list", come: "sostituisci", html: "tutti-tavolozza" }],
    fuoco: ".dev-catalog [role=tab]",
    dice: "La tavolozza: ogni token di colore col suo nome e il contrasto sulle superfici.",
    task: ["PA T38", "PA T39"],
  }),
  nuova("Temi", "tema-tutti-caratteri", "«Tutti i componenti»: i caratteri", {
    base: "tema-tutti-componenti",
    toppe: [{ dove: ".dev-catalog-list", come: "sostituisci", html: "tutti-caratteri" }],
    fuoco: ".dev-catalog [role=tab]",
    dice: "I caratteri: le famiglie del tema, con le misure della scala.",
    task: ["PA T38", "PA T39"],
  }),
  nuova("Temi", "tema-carta", "Il tema «Carta»: la nota", {
    base: "nota-riposo", tema: "carta",
    fuoco: ".pane.focus .cm-content",
    dice: "Carta, il primo tema d'esempio: carta calda, angoli dritti, maiuscoletto, titoli con le grazie. Veste anche l'editor di testo (D22 A): il filetto sotto il primo titolo, la citazione col filo dell'accento, i tag in maiuscoletto. Solo hook di oggi. Solo chiaro: di notte resta la serie.",
    task: ["PA T42", "PA T54"],
  }),
  nuova("Temi", "tema-carta-impostazioni", "Il tema «Carta»: le Impostazioni", {
    base: "aspetto", tema: "carta",
    fuoco: ".settings-tab",
    dice: "Carta nelle Impostazioni: le schede diventano filetti, i bottoni contorni.",
    task: ["PA T42"],
  }),
  nuova("Temi", "tema-mare", "Il tema «Mare»: la nota", {
    base: "nota-riposo", tema: "mare",
    fuoco: ".pane.focus .cm-content",
    dice: "Mare, il tema d'esempio di soli colori (D27 A, prima «Salvia»): un blu profondo e superfici grigio-azzurre, chiaro e scuro, nessuna regola di pelle. L'editor di testo lo segue coi ruoli.",
    task: ["PA T42", "PA T54"],
  }),
  nuova("Temi", "tema-mare-impostazioni", "Il tema «Mare»: le Impostazioni", {
    base: "aspetto", tema: "mare",
    fuoco: ".settings-tab",
    dice: "Mare nelle Impostazioni, nelle due luci.",
    task: ["PA T42"],
  }),
  nuova("Temi", "tema-officina", "Il tema «Officina»: la nota", {
    base: "nota-riposo", tema: "officina",
    fuoco: ".pane.focus .cm-content",
    dice: "Officina, il tema d'esempio più lontano dalla serie (D17 C): grigi d'acciaio, arancio da cantiere, angoli vivi, bordi di 2 px, etichette in monospazio, più contrasto della serie. Veste anche l'editor di testo: il filo pieno sotto il primo titolo, la citazione con la barra d'arancio. Solo hook di oggi.",
    task: ["PA T42", "PA T54"],
  }),
  nuova("Temi", "tema-officina-impostazioni", "Il tema «Officina»: le Impostazioni", {
    base: "aspetto", tema: "officina",
    fuoco: ".settings-tab",
    dice: "Officina nelle Impostazioni, nelle due luci: le schede in una cornice piena, i bottoni col contorno di 2 px, i titoli in monospazio.",
    task: ["PA T42"],
  }),
];

/** Le cartelle delle catture che gli stati nuovi usano oltre alle solite. */
export const CARTELLE_NUOVE = ["giro4"];
