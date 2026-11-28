// Le viste della mappa dell'editor aggiunte dal controllo del 2026-11-28:
// tabella e foglio coi gesti, diagramma, commenti, sbirciata, data e avviso.
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta accanto a
// `viste.mjs` (che ha già la tabella a riposo e il foglio nella nota).
import { TUTTI, passo } from "./comuni.mjs";

/// Il prototipo al passo della tabella, col fuoco sulla griglia: i tasti del
/// foglio li ascolta `#tb-grid` (riga 2330 del prototipo).
async function tabellaConFuoco(page) {
  await passo(page, "La tabella, coi gesti del foglio");
  await page.waitForSelector("#win #tb-grid .tg-sel .tg-fill");
  await page.focus("#win #tb-grid");
}

/// Il menu del diagramma del prototipo, aperto dal passo «Il diagramma, solo
/// il disegno» (`dgMenu` 90 ms dopo aver portato il blocco in vista). A 700 px
/// lo scorrimento della pagina dura di più e chiude il menu appena aperto
/// (ogni `.pop` si chiude allo scorrere): si aspetta che il disegno stia fermo
/// e si ripete il passo, che allora non scorre più.
async function menuDiagramma(page) {
  await passo(page, "Il diagramma, solo il disegno");
  await page.waitForFunction(
    () =>
      new Promise((fatto) => {
        const y = () => document.querySelector("#win #dg-view")?.getBoundingClientRect().top;
        const prima = y();
        setTimeout(() => fatto(prima !== undefined && y() === prima), 300);
      }),
  );
  await passo(page, "Il diagramma, solo il disegno");
  await page.waitForSelector("#win .pop.dgmenu .dg-sw");
}

/// Il diagramma del prototipo a riposo: il menu che il passo apre lo chiude
/// Esc; il puntatore va via dal disegno.
async function diagrammaARiposo(page) {
  await menuDiagramma(page);
  await page.keyboard.press("Escape");
  // Il menu chiuso resta nel DOM, a misura zero.
  await page.waitForSelector("#win .pop.dgmenu", { state: "hidden" });
  await page.mouse.move(0, 0);
}

export const VISTE_AREE = {
  /// Più celle scelte: il prototipo, che al passo ne sceglie già tre in
  /// colonna, allarga di una colonna (A2:B4); l'app, che parte da una cella,
  /// allarga di una riga in giù. La cella attiva resta la prima.
  "tabella-multipla": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await tabellaConFuoco(page);
        await page.keyboard.press("Shift+ArrowRight");
        await page.waitForSelector("#win #tb-grid .tg-sel.multi");
      },
    },
    app: {
      scena: "live-14-tabella-attiva",
      prepara: async (page) => {
        await page.keyboard.press("Shift+ArrowDown");
        await page.waitForSelector(".tb-grid .tb-sel.is-multi");
      },
    },
  },
  /// Una cella in modifica: F2 dai due lati apre il campo nella cella attiva.
  "tabella-modifica": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await tabellaConFuoco(page);
        await page.keyboard.press("F2");
        await page.waitForSelector("#win #tb-grid .gr-edit");
      },
    },
    app: {
      scena: "live-14-tabella-attiva",
      prepara: async (page) => {
        await page.keyboard.press("F2");
        await page.waitForSelector(".tb-grid .tb-input");
      },
    },
  },
  /// Il menu del diagramma: il prototipo lo apre da sé al passo «Il
  /// diagramma, solo il disegno», l'app dalla scena del menu.
  "diagramma-menu": {
    stati: TUTTI,
    prototipo: {
      prepara: menuDiagramma,
    },
    app: { scena: "diagramma-03-menu" },
  },
  /// Il diagramma a riposo, col menu chiuso: figura, disegno e didascalia.
  diagramma: {
    stati: TUTTI,
    prototipo: { prepara: diagrammaARiposo },
    app: { scena: "diagramma-01-riposo" },
  },
  /// Il sorgente aperto con un errore: il prototipo apre il pannello col
  /// doppio clic e vi scrive una riga sbagliata in testa (l'errore arriva
  /// dopo 300 ms); l'app dalla scena dell'errore alla riga 8.
  "diagramma-sorgente": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await diagrammaARiposo(page);
        await page.dblclick("#win #dg-view");
        await page.waitForSelector("#win .dg.editing #dg-src");
        await page.focus("#win #dg-src");
        await page.keyboard.type("--> (((");
        await page.waitForSelector("#win #dg-err:not([hidden]) b");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "diagramma-sorgente-02-errore" },
  },
  /// Il diagramma ingrandito: il prototipo dalla voce «Ingrandisci» del menu,
  /// l'app dalla scena del diagramma ingrandito.
  "diagramma-ingrandito": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await menuDiagramma(page);
        await page.click('#win .pop.dgmenu .m-i[data-do="full"]');
        await page.waitForSelector("#win .dg-full .dg-full-x");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "diagramma-sorgente-04-ingrandito" },
  },
  /// Un commento aperto: il prototipo al passo «Un commento, nel testo»
  /// (la discussione sul primo segno), l'app dalla scena della discussione.
  commenti: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Un commento, nel testo");
        await page.waitForSelector("#win .pop .th .th-m");
      },
    },
    app: { scena: "commenti-02-discussione" },
  },
  /// La sbirciata: il prototipo la apre da sé al passo «La sbirciata»;
  /// l'app dal lanciatore, con Alt Invio sulla nota scelta.
  sbirciata: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La sbirciata");
        await page.waitForSelector("#win #peek:not([hidden]) .peek-b h3");
        await page.mouse.move(0, 0);
      },
    },
    app: {
      scena: "launcher-files",
      prepara: async (page) => {
        await page.keyboard.press("Alt+Enter");
        await page.waitForSelector(".note-peek .note-peek-body .cm-fub-page-title");
        await page.mouse.move(0, 0);
      },
    },
  },
  /// La data di una proprietà: il prototipo al passo «Una data scritta a
  /// parole» (il passo apre il calendario), l'app dalla scena della data.
  data: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Una data scritta a parole");
        await page.waitForSelector("#win .pop .dp .dp-g button.s");
      },
    },
    app: { scena: "proprieta-03-data" },
  },
  /// L'avviso in basso: il prototipo lo mostra dopo «Apri qui» della
  /// sbirciata (4,2 s prima di sparire), l'app dalla scena dell'avviso.
  avviso: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La sbirciata");
        await page.waitForSelector("#win #peek:not([hidden])");
        await page.click('#win [data-peek="here"]');
        await page.waitForSelector("#win #toast:not([hidden])");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "toast" },
  },
};
