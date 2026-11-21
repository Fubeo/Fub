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
    app: { scena: "disegno-risorse" },
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
];

/// Ciò che ha ancora differenze e che correggono altri lavori: vuoto all'inizio.
export const DA_COPRIRE = [];
