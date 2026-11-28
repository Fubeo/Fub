// Le viste della mappa dell'editor per i blocchi Live e i fogli stretti
// (controllo del 2026-11-28, parte 2). Un pezzo di `editor/viste.mjs`, che le
// monta in `VISTE`.
import { FOGLI, TUTTI, passo } from "./comuni.mjs";

/// Il prototipo al passo «A riposo», con la nota della mostra: tutti i suoi
/// tipi di blocco stanno lì, gli stessi in ogni passo.
async function aRiposo(page) {
  await passo(page, "A riposo");
  await page.waitForSelector("#win .blk[data-t='callout'] .callout");
}

export const VISTE_BLOCCHI_FOGLI = {
  /// I blocchi di testo della Live: paragrafo, titolo, compiti, richiamo e
  /// collegamento. Il prototipo a riposo; l'app dalla panoramica della Live,
  /// che ha gli stessi tipi in una nota sola.
  "blocchi-live": {
    stati: TUTTI,
    prototipo: { prepara: aRiposo },
    app: { scena: "live-01-panoramica" },
  },
  /// Il ripiegabile chiuso: la riga del titolo e la sua freccia.
  "blocchi-ripiegabile": {
    stati: TUTTI,
    prototipo: { prepara: aRiposo },
    app: { scena: "live-24-ripiegabile" },
  },
  /// L'immagine con la didascalia. Il prototipo la ha a riposo, l'app solo
  /// scelta: si confrontano gli stili che la scelta non tocca (gli angoli
  /// dell'immagine, la didascalia).
  "blocchi-immagine": {
    stati: TUTTI,
    prototipo: { prepara: aRiposo },
    app: { scena: "live-22-immagine-selezionata" },
  },
  /// La trasclusione a riposo (non in scrittura), col puntatore sopra dai due
  /// lati: l'app ha la scena del passaggio, il prototipo il suo `.tx`.
  "blocchi-trasclusione": {
    stati: TUTTI,
    prototipo: { prepara: aRiposo },
    app: { scena: "trasclusione-viva-01-passaggio" },
  },
  /// Le maniglie col puntatore sopra il «+» e la presa: come la vista
  /// `maniglie`, ma a sé, perché ogni passaggio finisce col puntatore a
  /// riposo e spegne le maniglie che gli altri pezzi leggono.
  "maniglie-sopra": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Al passaggio");
        await page.waitForSelector("#win #gutter.on");
      },
    },
    app: { scena: "blocchi-01-passaggio" },
  },
  /// L'editor dentro un foglio stretto della cornice (620, 540, 400 e 340
  /// px): il prototipo montato come nel simulatore della cornice, con le sue
  /// regole (`comuni.mjs`, `nelFoglio`); l'app con il foglio a fuoco largo
  /// quanto il foglio del prototipo, nella scena della barra di formato.
  foglio: {
    stati: FOGLI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "A riposo");
        await page.waitForSelector("#win #fbar .fb.ins");
      },
    },
    app: { scena: "barra-formato" },
  },
};
