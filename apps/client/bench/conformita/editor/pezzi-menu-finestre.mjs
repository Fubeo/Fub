// La mappa dell'editor: le finestre piccole, il calendario della data e
// l'avviso in basso, aggiunti dal controllo del 2026-11-28.
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.
import { ALLINEAMENTO, DIMENSIONI } from "./comuni.mjs";

export const PEZZI_MENU_FINESTRE = [
  // ── la data di una proprietà (`datePicker`, riga 1485 del prototipo) ─────
  {
    id: "data.finestra",
    vista: "data",
    prototipo: ".pop:has(> .dp)",
    app: ".kit-popover.cm-fub-prop-popover",
    proprieta: ["padding", "border", "border-radius", "box-shadow", "background"],
  },
  {
    id: "data.corpo",
    vista: "data",
    prototipo: ".pop .dp",
    app: ".cm-fub-prop-date",
    proprieta: ["width", "padding", "font", "color"],
  },
  {
    id: "data.campo",
    vista: "data",
    prototipo: ".dp-in",
    app: ".cm-fub-prop-date-field",
    proprieta: ["height", "padding", "margin", "gap", "border", "border-radius", "box-shadow", "background", ...ALLINEAMENTO],
  },
  {
    id: "data.campo-testo",
    vista: "data",
    prototipo: ".dp-in input",
    app: ".cm-fub-prop-date-field input",
    proprieta: ["padding", "border", "font", "color", "background"],
  },
  {
    id: "data.rapide",
    vista: "data",
    prototipo: ".dp-q",
    app: ".cm-fub-prop-date-quick",
    proprieta: ["margin", "gap", "display", "flex-wrap"],
  },
  {
    id: "data.rapida",
    vista: "data",
    prototipo: ".dp-q button",
    app: ".cm-fub-prop-date-choice",
    proprieta: ["height", "padding", "border-radius", "font", "color", "background"],
  },
  {
    id: "data.rapida-passaggio",
    vista: "data",
    prototipo: ".dp-q button",
    app: ".cm-fub-prop-date-choice",
    gesto: { tipo: "hover", prototipo: ".dp-q button", app: ".cm-fub-prop-date-choice" },
    proprieta: ["color", "background"],
  },
  {
    id: "data.mese",
    vista: "data",
    prototipo: ".dp-h",
    app: ".cm-fub-prop-date-head",
    proprieta: ["margin", "font", "color", ...ALLINEAMENTO],
  },
  {
    id: "data.mese-freccia",
    vista: "data",
    prototipo: ".dp-h .ib",
    app: ".cm-fub-prop-date-nav",
    proprieta: [...DIMENSIONI, "border-radius", "color", "background"],
  },
  {
    id: "data.griglia",
    vista: "data",
    prototipo: ".dp-g",
    app: ".cm-fub-prop-date-grid",
    proprieta: ["gap", "display", "text-align", "font-variant-numeric"],
  },
  {
    id: "data.giorno-settimana",
    vista: "data",
    prototipo: ".dp-g span",
    app: ".cm-fub-prop-date-grid > span",
    proprieta: ["padding", "font", "color"],
  },
  {
    id: "data.giorno",
    vista: "data",
    prototipo: ".dp-g button:not(.s):not(.t):not(.o)",
    app: ".cm-fub-prop-date-day:not([data-selected]):not([data-today]):not([data-outside])",
    proprieta: ["height", "border-radius", "font", "color", "background", "box-shadow"],
  },
  {
    id: "data.giorno-passaggio",
    vista: "data",
    prototipo: ".dp-g button:not(.s):not(.t):not(.o)",
    app: ".cm-fub-prop-date-day:not([data-selected]):not([data-today]):not([data-outside])",
    gesto: {
      tipo: "hover",
      prototipo: ".dp-g button:not(.s):not(.t):not(.o)",
      app: ".cm-fub-prop-date-day:not([data-selected]):not([data-today]):not([data-outside])",
    },
    proprieta: ["color", "background"],
  },
  {
    id: "data.giorno-scelto",
    vista: "data",
    prototipo: ".dp-g button.s",
    app: ".cm-fub-prop-date-day[data-selected]",
    proprieta: ["font-weight", "color", "background", "box-shadow"],
  },
  {
    id: "data.piede",
    vista: "data",
    prototipo: ".dp-f",
    app: ".cm-fub-prop-date-foot",
    proprieta: ["margin", "padding", "border-top-width", "border-top-style", "border-top-color", ...ALLINEAMENTO],
  },
  {
    id: "data.azione",
    vista: "data",
    prototipo: ".dp-f button",
    app: ".cm-fub-prop-date-action",
    proprieta: ["height", "padding", "border-radius", "font", "color", "background"],
  },
  // ── l'avviso in basso (`toast`, riga 1172 del prototipo) ─────────────────
  {
    id: "avviso.superficie",
    vista: "avviso",
    prototipo: "#toast",
    app: "#toasts .toast",
    proprieta: ["padding", "gap", "border-radius", "box-shadow", "font", "color", "background"],
  },
  {
    id: "avviso.testo",
    vista: "avviso",
    prototipo: "#toast > span",
    app: "#toasts .toast .toast-text",
    proprieta: ["font", "color"],
  },
];
