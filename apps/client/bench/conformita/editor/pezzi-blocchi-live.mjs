// La mappa dell'editor: i blocchi della Scrittura (Live) che la mappa non
// copriva. Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.
// Aggiunti dal controllo del 2026-11-28, parte 2.
//
// Il prototipo li ha tutti nella nota della mostra, a riposo (righe 314-386 e
// 735 del suo CSS); l'app li apre dalle scene della Live che li mostrano. Ciò
// che il prototipo non ha in nessuna nota (citazione, elenco puntato, codice)
// non si può leggere dal suo lato: il suo CSS c'è, l'elemento no.
import { BASE } from "../confronto.mjs";
import { DIMENSIONI } from "./comuni.mjs";

/// Il blocco su cui il passo «Al passaggio» del prototipo e la scena
/// `blocchi-01-passaggio` accendono le maniglie.
const BLOCCO_PROTOTIPO = ".blk[data-id='punto'] .bc";
const BLOCCO_APP = ".pane.focus .pane-editor .cm-content .cm-line:has-text('Cose da fare')";

const CASELLA = [...DIMENSIONI, "border", "border-radius", "box-shadow", "background-color"];

export const PEZZI_BLOCCHI_LIVE = [
  // ── il testo: paragrafo, titolo, compiti ────────────────────────────────
  {
    id: "live.paragrafo",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".blk[data-t='p'] .bc",
    app: ".pane.focus .pane-editor .cm-line[class='cm-line']",
    proprieta: ["font", "color"],
  },
  {
    id: "live.titolo2",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".blk[data-t='h2'] .bc",
    app: ".pane.focus .cm-fub-h2-line",
    proprieta: ["font", "color"],
  },
  {
    id: "live.compito",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".blk[data-t='task']:not(.done) .bc",
    app: ".pane.focus .cm-line.cm-fub-hanging:has(.cm-fub-checkbox):not(:has(.cm-fub-done))",
    proprieta: ["font", "color"],
  },
  {
    id: "live.casella",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".blk[data-t='task']:not(.done) .chk",
    app: ".pane.focus .cm-fub-checkbox:not(:checked)",
    proprieta: CASELLA,
  },
  {
    id: "live.casella-fatta",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".blk.done .chk",
    app: ".pane.focus .cm-fub-checkbox:checked",
    proprieta: CASELLA,
  },
  {
    id: "live.fatto",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".blk.done .bc",
    app: ".pane.focus .cm-fub-done",
    proprieta: ["color", "text-decoration-line", "text-decoration-color"],
  },
  // ── il richiamo e il collegamento ───────────────────────────────────────
  {
    id: "live.richiamo",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".blk[data-t='callout'] .callout",
    app: ".pane.focus .cm-markdown-block .callout",
    proprieta: [...BASE, "display"],
  },
  {
    id: "live.richiamo-titolo",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".callout-t",
    app: ".pane.focus .callout-title",
    proprieta: ["font", "color", "margin"],
  },
  {
    id: "live.collegamento",
    vista: "blocchi-live",
    contesto: "documento",
    prototipo: ".blk[data-t='p'] .lnk",
    app: ".pane.focus .cm-fub-wikilink",
    proprieta: ["color", "font-weight", "text-decoration-line", "text-decoration-color", "text-underline-offset"],
  },
  // ── la scadenza vicina (T36): la pastiglia arancione di un compito ───────
  {
    id: "live.scadenza-vicina",
    vista: "promemoria",
    contesto: "documento",
    prototipo: ".due.soon",
    app: ".pane.focus .cm-fub-due-near",
    proprieta: [...BASE, "height"],
  },
  // ── il ripiegabile chiuso ───────────────────────────────────────────────
  {
    id: "live.ripiegabile-titolo",
    vista: "blocchi-ripiegabile",
    contesto: "documento",
    prototipo: ".toggle-h",
    app: ".pane.focus .cm-fub-details-summary",
    proprieta: ["font", "color"],
  },
  {
    id: "live.ripiegabile-freccia",
    vista: "blocchi-ripiegabile",
    contesto: "documento",
    prototipo: ".toggle-h .tw",
    app: ".pane.focus .cm-fub-details-arrow",
    proprieta: [...DIMENSIONI, "padding", "border-radius", "color"],
  },
  // ── l'immagine ──────────────────────────────────────────────────────────
  {
    id: "live.immagine",
    vista: "blocchi-immagine",
    contesto: "documento",
    prototipo: ".imgf svg",
    app: ".pane.focus .cm-fub-image img",
    proprieta: ["border-radius", "background-color"],
  },
  {
    id: "live.didascalia",
    vista: "blocchi-immagine",
    contesto: "documento",
    prototipo: ".imgf figcaption",
    app: ".pane.focus .cm-fub-image figcaption",
    proprieta: ["font", "color", "padding", "text-align"],
  },
  // ── la trasclusione a riposo, col puntatore sopra ───────────────────────
  {
    id: "live.trasclusione",
    vista: "blocchi-trasclusione",
    contesto: "documento",
    prototipo: ".tx:not(.editing)",
    app: ".pane.focus .embed.transclusion:not(.transclusion-editing)",
    proprieta: BASE,
    gesto: { tipo: "hover", prototipo: ".tx:not(.editing)", app: ".pane.focus .embed.transclusion" },
  },
  // ── le maniglie col puntatore sopra: «+» e la presa ─────────────────────
  // Una vista a sé (`maniglie-sopra`): dopo un passaggio il puntatore torna a
  // riposo, e dai due lati le maniglie si spengono finché non ripassa dal
  // blocco. Il gesto ripassa prima dal blocco (lo stesso della scena), poi
  // va sul pulsante; nel prototipo, senza, la pagina copre la presa.
  {
    id: "maniglie.aggiungi-sopra",
    vista: "maniglie-sopra",
    contesto: "documento",
    prototipo: "#g-add",
    app: ".cm-fub-block-handles[data-active='true'] .cm-fub-block-add",
    proprieta: ["background-color", "color", "opacity"],
    gesto: { tipo: "hover", prototipo: [BLOCCO_PROTOTIPO, "#g-add"], app: [BLOCCO_APP, ".pane.focus .cm-fub-block-handles[data-active='true'] .cm-fub-block-add"] },
  },
  {
    id: "maniglie.presa-sopra",
    vista: "maniglie-sopra",
    contesto: "documento",
    prototipo: "#g-grip",
    app: ".cm-fub-block-handles[data-active='true'] .cm-fub-block-grip",
    proprieta: ["background-color", "color", "opacity"],
    gesto: { tipo: "hover", prototipo: [BLOCCO_PROTOTIPO, "#g-grip"], app: [BLOCCO_APP, ".pane.focus .cm-fub-block-handles[data-active='true'] .cm-fub-block-grip"] },
  },
];
