// La mappa dell'editor: i pezzi della cornice e dei pannelli.
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.
import { BASE } from "../confronto.mjs";
import { ALLINEAMENTO, DIMENSIONI, LARGHI } from "./comuni.mjs";

export const PEZZI_CORNICE_PANNELLI = [
  // ── la cornice: barra del titolo (T82) e banda (T14) ────────────────────
  // Aggiunti dal controllo del 2026-11-21. Il binario, il cassetto e le
  // linguette del prototipo vengono dal prototipo dello Scrittoio 2, e qui
  // non si confrontano.
  {
    id: "cornice.barra",
    vista: "cornice",
    prototipo: ".tbar",
    app: "#topbar",
    proprieta: ["height", "padding", "gap", "font", "color"],
  },
  {
    id: "cornice.pillola",
    vista: "cornice",
    prototipo: ".pill",
    app: "#pill",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    // Solo largo: a 700 px l'app nasconde il testo della pillola e lascia
    // l'icona, il prototipo lo tiene (referto 2026-11-21-conformita-editor).
    id: "cornice.pillola-testo",
    vista: "cornice",
    stati: LARGHI,
    prototipo: ".pill-text",
    app: "#pill-title",
    proprieta: ["font", "color", "white-space", "text-overflow"],
  },
  {
    id: "cornice.vault",
    vista: "cornice",
    prototipo: ".vault",
    app: "#vault-chip",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "cornice.pulsante",
    vista: "cornice",
    prototipo: ".tbar-r .ib:not(#insp-btn)",
    app: "#activity-button",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "banda.fascia",
    vista: "cornice",
    prototipo: ".band",
    app: "#status-band",
    proprieta: ["height", "padding", "gap", "font", "color", "white-space"],
  },
  {
    id: "banda.salvato",
    vista: "cornice",
    prototipo: ".band .ok::before",
    app: "#status-saving::before",
    proprieta: [...DIMENSIONI, "border-radius", "background-color", "margin-right"],
  },
  {
    id: "banda.modo",
    vista: "cornice",
    prototipo: ".modeb",
    app: "#status-mode",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "banda.modo-freccia",
    vista: "cornice",
    prototipo: ".modeb .car",
    app: "#status-mode .status-mode-arrow",
    proprieta: ["color", ...DIMENSIONI],
  },

  // ── la barra di formato (T11) ───────────────────────────────────────────
  // Aggiunti dal controllo del 2026-11-21.
  {
    id: "barra.superficie",
    vista: "barra-formato",
    prototipo: ".fbar",
    app: ".pane.focus .format-bar",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "barra.pulsante",
    vista: "barra-formato",
    prototipo: ".fb:not(.lbl):not(.ins)",
    app: ".pane.focus .format-bar-button",
    proprieta: [...BASE, "height", "min-width", ...ALLINEAMENTO],
  },
  {
    id: "barra.stile",
    vista: "barra-formato",
    prototipo: "#fb-style",
    app: ".pane.focus .format-bar-style",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "barra.freccia",
    vista: "barra-formato",
    prototipo: "#fb-style .car",
    app: ".pane.focus .format-bar-style .format-bar-caret",
    proprieta: ["color", ...DIMENSIONI],
  },
  {
    id: "barra.inserisci",
    vista: "barra-formato",
    prototipo: ".fb.ins",
    app: ".pane.focus .format-bar-insert",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "barra.separatore",
    vista: "barra-formato",
    prototipo: ".fg + .fg::before",
    app: ".pane.focus .format-bar-follow.kit-bar > .kit-bar-group + .kit-bar-group::before",
    proprieta: [...DIMENSIONI, "margin", "background-color"],
  },

  // ── l'ispettore (T19) ───────────────────────────────────────────────────
  // Aggiunti dal controllo del 2026-11-21.
  {
    id: "ispettore.superficie",
    vista: "ispettore",
    prototipo: ".insp",
    app: "#right-pane",
    proprieta: ["width", "padding", "background-color"],
  },
  {
    id: "ispettore.schede",
    vista: "ispettore",
    prototipo: ".itabs",
    app: ".inspector-tabs",
    proprieta: [...BASE, "height"],
  },
  {
    id: "ispettore.scheda-scelta",
    vista: "ispettore",
    prototipo: '.itabs button[aria-selected="true"]',
    app: '.inspector-tab[aria-selected="true"]',
    proprieta: [...BASE, "height"],
  },
  {
    id: "ispettore.scheda",
    vista: "ispettore",
    prototipo: '.itabs button[aria-selected="false"]',
    app: '.inspector-tab[aria-selected="false"]',
    proprieta: [...BASE, "height"],
  },

  // ── la Sorgente (T5) ────────────────────────────────────────────────────
  // Aggiunta dal controllo del 2026-11-21: il carattere del file.
  {
    id: "sorgente.testo",
    vista: "sorgente",
    contesto: "documento",
    prototipo: ".src",
    app: ".pane.focus .cm-content",
    proprieta: ["font", "color", "white-space"],
  },
  {
    id: "proprieta.elenco",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".props",
    app: ".cm-fub-page-props",
    proprieta: ["display", "row-gap", "margin", "font"],
  },
  {
    id: "proprieta.chiave",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".pk",
    app: ".cm-fub-page-prop-key",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "proprieta.valore",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".pv",
    app: ".cm-fub-page-prop-value",
    proprieta: [...BASE, "min-height", ...ALLINEAMENTO],
  },
  {
    id: "proprieta.persona",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".person",
    app: ".cm-fub-prop-person",
    proprieta: [...BASE, "height"],
  },
  {
    id: "opzioni.stato",
    vista: "opzioni",
    contesto: "documento",
    prototipo: ".props .opt.st",
    app: '.cm-fub-page-prop[data-key="stato"] .cm-fub-prop-opt',
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "proprieta.altre",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".props .more",
    app: ".cm-fub-page-props-more",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  // ── il calendario della Base (T17) ──────────────────────────────────────
  // Il prototipo mostra novembre 2026 (oggi il 9), l'app agosto 2026 (oggi il
  // 19): i giorni si scelgono per colonna, un martedì dai due lati, perché
  // l'ultima colonna non ha il filo a destra.
  {
    id: "calendario.griglia",
    vista: "calendario",
    prototipo: ".cal",
    app: ".base-cal-grid",
    proprieta: [...BASE, "display", "min-width"],
  },
  {
    id: "calendario.nome-giorno",
    vista: "calendario",
    prototipo: ".cal > .dow",
    app: ".base-cal-dow",
    proprieta: [...BASE, "letter-spacing", "text-transform"],
  },
  {
    id: "calendario.giorno",
    vista: "calendario",
    prototipo: '.cal > div[data-day="2026-11-03"]',
    app: '.base-cal-day[data-day="2026-08-04"]',
    proprieta: [...BASE, "min-height"],
  },
  {
    id: "calendario.fuori",
    vista: "calendario",
    prototipo: ".cal > .out",
    app: '.base-cal-day[data-out="true"]',
    proprieta: [...BASE, "min-height"],
  },
  {
    id: "calendario.numero",
    vista: "calendario",
    prototipo: '.cal > div[data-day="2026-11-03"] .d',
    app: '.base-cal-day[data-day="2026-08-04"] .base-cal-num',
    proprieta: [...BASE, "min-width", "height", "display"],
  },
  {
    id: "calendario.oggi",
    vista: "calendario",
    prototipo: ".cal > .today .d",
    app: '.base-cal-day[data-today="true"] .base-cal-num',
    proprieta: [...BASE, "min-width", "height"],
  },
  {
    id: "calendario.nota",
    vista: "calendario",
    prototipo: ".cal .ev.k-green",
    app: ".base-cal-event",
    proprieta: [...BASE, "display", "white-space", "text-overflow"],
  },

  // ── la linea del tempo della Base (T34) ─────────────────────────────────
  // Il prototipo mostra otto settimane da metà ottobre a dicembre in quattro
  // colonne, l'app otto settimane in otto: il fondo della traccia (le righe
  // delle colonne) non si confronta, i pezzi sì.
  {
    id: "tempo.griglia",
    vista: "tempo",
    prototipo: ".tl",
    app: ".base-tl",
    proprieta: [...BASE, "min-width"],
  },
  {
    id: "tempo.scala",
    vista: "tempo",
    prototipo: ".tl-a",
    app: ".base-tl-axis",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "tempo.oggi",
    vista: "tempo",
    prototipo: ".tl-s .now",
    app: ".base-tl-now",
    proprieta: [...BASE, "white-space"],
  },
  {
    id: "tempo.riga",
    vista: "tempo",
    prototipo: ".tl-r",
    app: ".base-tl-row",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "tempo.nome",
    vista: "tempo",
    prototipo: ".tl-r > span",
    app: ".base-tl-name",
    proprieta: [...BASE, "white-space", "text-overflow"],
  },
  {
    id: "tempo.barra",
    vista: "tempo",
    prototipo: ".tl-b.k-green",
    app: '.base-tl-bar:not([data-inverted="true"]):not([data-clip-start="true"]):not([data-clip-end="true"])',
    proprieta: [...BASE, "height", "top", "white-space"],
  },

  // ── la riga dei suggerimenti (T14): #383 ─────────────────────────────────
  {
    id: "suggerimenti.riga",
    vista: "suggerimenti",
    prototipo: ".hint",
    app: "#status-hints",
    proprieta: [...BASE, ...ALLINEAMENTO, "text-align", "white-space", "overflow-x", "text-overflow", "flex-grow", "flex-shrink", "flex-basis", "min-width"],
  },
  {
    id: "suggerimenti.tasto",
    vista: "suggerimenti",
    prototipo: ".hint kbd",
    app: "#status-hints .status-hints-key",
    proprieta: [...BASE, "white-space"],
  },

];
