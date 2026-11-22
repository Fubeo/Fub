// **La mappa del prototipo del Disegno completo** (K6, T10): la scheda Risorse
// dell'ispettore e la sua sezione dei campioni, confrontate con
// `PLAN-ui/disegno-completo.html`. Scritta a mano; la leggono `estrai.mjs` (il
// lato del prototipo) e `verifica.mjs` (il lato dell'app), come la mappa
// dell'editor (`mappa-editor.mjs`, la cui intestazione spiega ogni campo).
//
// Il prototipo non ha il banco dell'editor: lo schermo di Fub sta in
// `#proto-schermo` (un `<iframe>` con il suo documento), e i controlli sono
// `#proto-stato`, `#luce-giorno`/`#luce-notte` e `#larghezza-piena`/`#larghezza-700`.
// Per questo la mappa dichiara `radice` e `comandi`.
//
// La traduzione dei token è vuota: il prototipo K6 usa la cornice di oggi, con
// gli stessi nomi di token dell'app, quindi i colori si confrontano con i
// valori calcolati (la cornice è la stessa: vedi la sezione «Modifiche» del
// prototipo). Un token che differisce sarà un'eccezione col suo motivo.
import { BASE } from "./confronto.mjs";

/// Il prototipo: dove sta, come si chiamano i file che ne nascono, e come si
/// pilota lo schermo.
export const PROTOTIPO = {
  nome: "disegno-completo",
  ramo: "piano/k6-disegno-completo",
  file: "PLAN-ui/disegno-completo.html",
  /// Lo schermo di Fub nel prototipo: un `<iframe>` con il suo documento.
  radice: "#proto-schermo",
  /// Luce e larghezza come nel prototipo; il moto non ha un controllo.
  comandi: async (page, stato) => {
    await page.click(`label[for="${stato.luce === "giorno" ? "luce-giorno" : "luce-notte"}"]`);
    await page.click(`label[for="${stato.larghezza === "piena" ? "larghezza-piena" : "larghezza-700"}"]`);
  },
};

/// Le traduzioni per contesto: vuote, perché il prototipo usa i token di Fub.
export const TRADUZIONE = {};
export const TRADUZIONE_DOCUMENTO = {};
export const TRADUZIONI = {
  interfaccia: TRADUZIONE,
  documento: TRADUZIONE_DOCUMENTO,
};

/// Gli stati. Il prototipo è a 1280 px per la scheda Risorse e il Design; le
/// scene dell'app a 700 px non mostrano l'ispettore, quindi lo stato stretto
/// non entra in nessuna vista.
export const STATI = {
  "chiaro-1280": { luce: "light", prototipo: { luce: "giorno", larghezza: "piena" }, finestra: { width: 1280, height: 800 } },
  "scuro-1280": { luce: "dark", prototipo: { luce: "notte", larghezza: "piena" }, finestra: { width: 1280, height: 800 } },
};

const TUTTI = Object.keys(STATI);
const DIMENSIONI = ["width", "height"];
const ALLINEAMENTO = ["display", "align-items", "justify-content"];

export const VISTE = {
  /// La scheda Risorse con i campioni del documento. Nel prototipo lo stato
  /// `risorse` ha 500 campioni; nell'app la scena ne ha 24, e si confrontano
  /// solo la forma e lo stile di ciò che si ripete.
  risorse: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await page.selectOption("#proto-stato", "risorse");
        await page.waitForSelector('#proto-box[data-pronto^="risorse-"]');
      },
    },
    app: { scena: "disegno-risorse-molti" },
  },
  /// Il menu ≡ con Oggetto aperto (K6 T9a). L'app lo mostra con l'indice di
  /// prova (`?indice=prova`), che ha le stesse voci del prototipo.
  menu: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await page.selectOption("#proto-stato", "menu");
        await page.waitForSelector('#proto-box[data-pronto^="menu-"]');
      },
    },
    app: { scena: "disegno-menu" },
  },
  /// La tavolozza di Ctrl+/ con la ricerca «sposta» (K6 T9a).
  tavolozza: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await page.selectOption("#proto-stato", "tavolozza");
        await page.waitForSelector('#proto-box[data-pronto^="tavolozza-"]');
      },
    },
    app: { scena: "disegno-tavolozza" },
  },
};

/// I pezzi. `prototipo` sta dentro lo schermo del prototipo, `app` nella pagina
/// del banco. Le proprietà sono i gruppi di `confronto.mjs` e le dimensioni.
export const PEZZI = [
  // ── la scheda Risorse (T10, K6) ───────────────────────────────────────────
  {
    id: "risorse.scheda",
    vista: "risorse",
    prototipo: '.inspector-tab[data-view-id="draw.resources"]',
    app: '.inspector-tab[data-view-id="draw.resources"]',
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "risorse.pannello",
    vista: "risorse",
    prototipo: "section.draw-resources",
    app: "section.draw-resources",
    proprieta: [...BASE],
  },
  {
    id: "risorse.campioni.intestazione",
    vista: "risorse",
    prototipo: '[data-section="swatches"] .draw-properties-toggle',
    app: '[data-section="documento"] .draw-properties-toggle',
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "risorse.campioni.nota",
    vista: "risorse",
    prototipo: '[data-section="swatches"] .draw-properties-note',
    app: '[data-section="documento"] .draw-properties-note',
    proprieta: [...BASE],
  },
  {
    id: "risorse.campioni.gruppo",
    vista: "risorse",
    prototipo: ".draw-resources-swatches .kit-color-group-title",
    app: ".draw-resources-swatches .kit-color-group-title",
    proprieta: [...BASE],
  },
  {
    id: "risorse.campioni.campione",
    vista: "risorse",
    prototipo: ".draw-resources-swatches .kit-color-chip",
    app: ".draw-resources-swatches .kit-color-chip",
    proprieta: [...DIMENSIONI, "border-radius"],
  },
  // La fila dei campioni: la sua larghezza decide quante colonne ci stanno (la
  // fila va a capi). Con 500 campioni il prototipo ne mette sette per riga; una
  // fila più stretta ne mette meno, e la mappa lo deve vedere.
  {
    id: "risorse.campioni.corpo",
    vista: "risorse",
    prototipo: '[data-section="swatches"] .draw-properties-body',
    app: '[data-section="documento"] .draw-properties-body',
    proprieta: [...DIMENSIONI, "display"],
  },
  {
    id: "risorse.campioni.contenitore",
    vista: "risorse",
    prototipo: ".draw-resources-swatches",
    app: ".draw-resources-swatches",
    proprieta: [...DIMENSIONI, ...ALLINEAMENTO],
  },
  {
    id: "risorse.campioni.fila",
    vista: "risorse",
    prototipo: ".draw-resources-swatches .kit-color-swatches",
    app: ".draw-resources-swatches .kit-color-swatches",
    proprieta: [...DIMENSIONI, "display", "flex-wrap", "gap"],
  },
  // ── il menu ≡ del Completo (K6 T9a) ───────────────────────────────────────
  // Le misure del menu e dei sottomenu dipendono da quante voci e quanto lunghe
  // sono: l'app ha le voci di prova, il prototipo tutte le sue. Qui si
  // confrontano gli stili; la larghezza dei sottomenu è diversa di proposito
  // (il perché delle voci spente sta a destra, in «menu.sottomenu»).
  {
    id: "menu.contenitore",
    vista: "menu",
    prototipo: "#context-menu",
    app: ".context-menu",
    proprieta: [...BASE],
  },
  {
    id: "menu.voce.aperta",
    vista: "menu",
    prototipo: '.context-menu .kit-row[aria-expanded="true"]',
    app: '.context-menu .kit-row[aria-expanded="true"]',
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "menu.sottomenu",
    vista: "menu",
    prototipo: ".context-submenu",
    app: ".context-submenu",
    proprieta: [...BASE],
  },
  // ── la tavolozza di Ctrl+/ (K6 T9a) ───────────────────────────────────────
  // L'altezza non si confronta: la lista del kit tiene la riga accesa come
  // figlia del flusso, e lo spazio fra le righe (8 px) in più; il prototipo la
  // tiene nascosta (`hidden`). La larghezza sì.
  {
    id: "tavolozza.dialogo",
    vista: "tavolozza",
    prototipo: ".kit-dialog.draw-commands-dialog",
    app: ".kit-dialog.draw-commands-dialog",
    proprieta: [...BASE, "width"],
  },
  // L'altezza della riga: con il gap del kit in mezzo, il passo fra le righe
  // sarebbe questa più 2 px; la tavolozza lo toglie, come il prototipo (28 px).
  {
    id: "tavolozza.riga",
    vista: "tavolozza",
    prototipo: ".draw-commands-row",
    app: ".draw-commands-row",
    proprieta: ["height"],
  },
  {
    id: "tavolozza.campo",
    vista: "tavolozza",
    prototipo: ".draw-commands-field input",
    app: ".draw-commands-field input",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "tavolozza.etichetta",
    vista: "tavolozza",
    prototipo: ".draw-commands-label",
    app: ".draw-commands-label",
    proprieta: [...BASE],
  },
  {
    id: "tavolozza.percorso",
    vista: "tavolozza",
    prototipo: ".draw-commands-path",
    app: ".draw-commands-path",
    proprieta: [...BASE],
  },
  {
    id: "tavolozza.tasto",
    vista: "tavolozza",
    prototipo: ".draw-commands-key",
    app: ".draw-commands-key",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "tavolozza.perche",
    vista: "tavolozza",
    prototipo: ".draw-commands-why",
    app: ".draw-commands-why",
    proprieta: [...BASE],
  },
];

/// Ciò che ha ancora differenze e che correggono altri lavori. Le altezze dei
/// tre contenitori dei campioni differiscono per i dati: il prototipo mostra
/// cinque gruppi (500 campioni: Documento, Grigi, Brillanti, Web, Pastello) e il
/// banco ne ha uno solo, quello del documento. I gruppi della tavolozza del
/// motore arrivano con la famiglia del colore (T14). La larghezza della fila,
/// che è il difetto delle due colonne, resta confrontata alla lettera.
export const DA_COPRIRE = [
  { id: "risorse.campioni.corpo", proprieta: ["height"], perche: "cinque gruppi nel prototipo, uno nel banco: i gruppi della tavolozza arrivano con la famiglia del colore (T14)" },
  { id: "risorse.campioni.contenitore", proprieta: ["height"], perche: "stessa causa: i gruppi della tavolozza (T14)" },
  { id: "risorse.campioni.fila", proprieta: ["height"], perche: "il primo gruppo del prototipo ha 24 campioni, quello del banco tutti i 500: i gruppi della tavolozza (T14)" },
];
