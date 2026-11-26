// La shell: la Base e il foglio di calcolo.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import {
  LONG_CELL_TEXT,
  chooseBaseSummary,
  dragColumnNearEdge,
  gridCellCenter,
  openBase,
  openCalendar,
  openCommands,
  openLargeSheet,
  openMap,
  openMapTiles,
  openRibbon,
  openTimeline,
  openWorkbook,
  pickGridRange,
  scrollGrid,
  writeInCell,
} from "./gesti-documenti.mjs";
import { runScrittoioCommand } from "./gesti-scrittura.mjs";
import { NOTE_NARROW, SHEET_700, SHEET_FULL, SHEET_FULL_GRID } from "./misure.mjs";

export const S_BASE_GRIGLIA = [
  // **La barra della Base** (T15), su `Opere.base` di `bench/base-fixture.ts`:
  // le linguette delle viste, gli attrezzi, le etichette del filtro, i tre
  // pannelli e le righe che un gesto ha scritto nel file.
  {
    id: "base-barra",
    title: "Base: le viste come linguette, gli attrezzi e l'etichetta del filtro",
    query: "base=1",
    prepare: openBase,
  },
  // La Bacheca per Stato (T9, passo 13 del prototipo): col registro dei tipi
  // le corsie sono le opzioni di `stato` nei tre gruppi, anche vuote.
  ...[
    ["base-stato-bacheca", "Base: la Bacheca per Stato, le corsie nei tre gruppi e nell'ordine delle opzioni"],
    ["base-stato-bacheca-stretta", "Base: la Bacheca per Stato nella finestra minima, 800 px", { width: 800, height: 800 }],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "base=1&tipi=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openBase(page);
      await page.locator(".pane.focus .base-tab[data-view]", { hasText: "Bacheca" }).first().click();
      await page.waitForSelector(".pane.focus .base-kanban-column[data-option]");
      await page.mouse.move(0, 0);
    },
  })),
  {
    id: "base-filtro",
    title: "Base: il filtro composto a vista, con la stessa riga come ricerca",
    query: "base=1",
    prepare: async (page) => {
      await openBase(page);
      await page.click(".pane.focus .base-tool-filter");
      await page.waitForSelector(".base-popover .base-filter-row");
    },
  },
  {
    id: "base-ordina",
    title: "Base: Ordina aperto, per consegna dalla più vicina",
    query: "base=1",
    prepare: async (page) => {
      await openBase(page);
      await page.click(".pane.focus .base-tool-sort");
      await page.waitForSelector(".base-popover .base-sort-row");
    },
  },
  {
    id: "base-proprieta",
    title: "Base: Proprietà aperto, le colonne da mostrare e il loro ordine",
    query: "base=1",
    prepare: async (page) => {
      await openBase(page);
      await page.click(".pane.focus .base-tool-columns");
      await page.waitForSelector(".base-popover .base-column");
    },
  },
  {
    id: "base-scritto",
    title: "Base: «Nel file .base» dopo aver tolto l'etichetta del filtro",
    query: "base=1",
    prepare: async (page) => {
      await openBase(page);
      await page.click(".pane.focus .base-chip button");
      await page.waitForSelector(".pane.focus .base-written:not([hidden])");
      // Resta l'etichetta dell'ordinamento.
      await page.waitForFunction(() => document.querySelectorAll(".pane.focus .base-chip").length === 1
        && document.querySelector(".pane.focus .base-bar")?.getAttribute("aria-busy") !== "true");
      await page.click(".pane.focus .base-written summary");
      await page.waitForSelector(".pane.focus .base-written[open] .base-written-removed");
    },
  },
  {
    id: "base-sola-lettura",
    title: "Base: in sola lettura, gli attrezzi che scrivono spenti e il perché",
    query: "base=1",
    prepare: async (page) => {
      await openBase(page);
      await page.evaluate(async () => {
        const { freezeDocumentSurfaces } = await import("/src/state/document-controller.ts");
        freezeDocumentSurfaces(true);
      });
      await page.waitForSelector(".pane.focus .base-note:not([hidden])");
    },
  },
  // **Viste, colonne e riepiloghi** (T16), sulla stessa Base: «+», il menu
  // della colonna, il piede coi riepiloghi del core e venti viste.
  {
    id: "base-nuova-vista",
    title: "Base: «+» aperto, i tipi di vista da aggiungere al file",
    query: "base=1",
    prepare: async (page) => {
      await openBase(page);
      await page.click(".pane.focus .base-tool-new-view");
      await page.waitForSelector("#context-menu .menu-head");
    },
  },
  {
    id: "base-colonna",
    title: "Base: il menu della colonna «valore», con Ordina, Raggruppa, Riepilogo, Rinomina, Tipo e Nascondi",
    query: "base=1",
    prepare: async (page) => {
      await openBase(page);
      await page.click('.pane.focus th[data-column="valore"] .base-head');
      await page.waitForSelector("#context-menu .menu-head");
    },
  },
  {
    id: "base-piede",
    title: "Base: il piede con la somma dei valori e l'ultima consegna, scelte dal menu della colonna",
    query: "base=1",
    prepare: async (page) => {
      await openBase(page);
      await chooseBaseSummary(page, "valore", "Somma");
      await chooseBaseSummary(page, "consegna", "L'ultima");
    },
  },
  {
    id: "base-venti",
    title: "Base: venti viste, le linguette che non stanno restano figure",
    query: "base=venti",
    prepare: async (page) => {
      await openBase(page);
      await page.waitForSelector(".pane.focus .base-tabs.compact");
    },
  },
  // **Il calendario** (T17), su `?base=calendario`: agosto 2026, il mese
  // dell'orologio del banco, con cinque consegne il 12 («+2»), una con l'ora
  // il 20 e una il 3 settembre fra i giorni fuori dal mese.
  {
    id: "base-calendario",
    title: "Base: il calendario di agosto, le consegne nei loro giorni e «+2»",
    query: "base=calendario",
    prepare: openCalendar,
  },
  {
    id: "base-calendario-stretto",
    title: "Base: il calendario nella finestra minima, 800 px",
    query: "base=calendario",
    viewport: NOTE_NARROW,
    prepare: openCalendar,
  },
  {
    id: "base-calendario-trascina",
    title: "Base: una consegna trascinata sopra un altro giorno, che si accende",
    query: "base=calendario",
    prepare: async (page) => {
      await openCalendar(page);
      // Il trascinamento del browser a metà: la nota presa, il giorno sotto
      // acceso. Playwright non tiene un drag HTML5 fermo a metà.
      await page.evaluate(() => {
        const pane = document.querySelector(".pane.focus");
        const note = pane.querySelector('.base-cal-event[data-doc="Opere/Ritratto di signora.md"]');
        const target = pane.querySelector('.base-cal-day[data-day="2026-08-06"]');
        const transfer = new DataTransfer();
        note.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      });
      await page.waitForSelector('.pane.focus .base-cal-day[data-day="2026-08-06"][data-over="true"]');
    },
  },
  {
    id: "base-calendario-fuoco",
    title: "Base: il fuoco sui giorni dalla tastiera, e «+2» aperto",
    query: "base=calendario",
    prepare: async (page) => {
      await openCalendar(page);
      await page.click('.pane.focus .base-cal-day[data-day="2026-08-12"] .base-cal-more');
      await page.waitForFunction(() => document.querySelectorAll('.pane.focus .base-cal-day[data-day="2026-08-12"] .base-cal-event').length === 5);
      await page.focus('.pane.focus .base-cal-day[data-day="2026-08-12"]');
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => document.activeElement?.matches('.base-cal-day[data-day="2026-08-13"]'));
    },
  },
  // **La vista Mappa**, su `?base=mappa`: otto musei del mondo e un
  // fornitore di tessere di prova. Con `tessere=0` la riga di macchina è
  // vuota e la mappa dice «tessere non ammesse» col rimando alle
  // Impostazioni; con `tessere=1` il sito è ammesso, «Attiva» è il consenso e
  // le tessere arrivano dall'host finto.
  {
    id: "base-mappa-non-ammesse",
    title: "Base: la Mappa offline, con le tessere non ammesse e il rimando alle Impostazioni",
    query: "base=mappa&tessere=0",
    prepare: openMap,
  },
  {
    id: "base-mappa-consenso",
    title: "Base: la Mappa offline con il sito ammesso, prima del consenso",
    query: "base=mappa&tessere=1",
    prepare: openMap,
  },
  {
    id: "base-mappa-tessere",
    title: "Base: la Mappa con le tessere arrivate dopo «Attiva»",
    query: "base=mappa&tessere=1",
    prepare: openMapTiles,
  },
  {
    id: "base-mappa-tessere-stretta",
    title: "Base: la Mappa con le tessere nella finestra minima, 800 px",
    query: "base=mappa&tessere=1",
    viewport: NOTE_NARROW,
    prepare: openMapTiles,
  },
  {
    id: "settings-tessere",
    title: "Le preferenze: Privacy, i siti delle tessere delle mappe vuoti e OpenStreetMap con un clic",
    query: "tessere=0",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.waitForSelector('#settings-body .setting-row[data-setting-key="map.tile-hosts"] .setting-list-add');
      await page.$eval('.setting-row[data-setting-key="map.tile-hosts"]', (row) => row.scrollIntoView({ block: "start" }));
    },
  },
  // **La linea del tempo** (T34), su `?base=tempo`: otto settimane dal 10
  // agosto 2026 (oggi il 19), le opere dalla richiesta alla consegna: una
  // tagliata a sinistra, una rovesciata, un punto, una con l'ora, una oltre i
  // giorni mostrati e una senza date.
  {
    id: "base-tempo",
    title: "Base: la linea del tempo, le opere dalla richiesta alla consegna",
    query: "base=tempo",
    prepare: openTimeline,
  },
  {
    id: "base-tempo-stretto",
    title: "Base: la linea del tempo nella finestra minima, 800 px",
    query: "base=tempo",
    viewport: NOTE_NARROW,
    prepare: openTimeline,
  },
  {
    id: "base-tempo-trascina",
    title: "Base: una barra presa e trascinata di tre giorni, prima del rilascio",
    query: "base=tempo",
    prepare: openTimeline,
    // Il puntatore vero, fermo a metà: la barra segue a giorni interi e la
    // scritta dice le date nuove; niente è ancora scritto. È l'ultimo gesto
    // (`hover`), dopo che il banco ha portato il puntatore nell'angolo.
    hover: async (page) => {
      const bar = page.locator('.pane.focus .base-tl-row[data-doc="Opere/Ritratto di signora.md"] .base-tl-bar');
      const box = await bar.boundingBox();
      const track = await page.locator('.pane.focus .base-tl-row[data-doc="Opere/Ritratto di signora.md"] .base-tl-track').boundingBox();
      const day = track.width / 56;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + day, y);
      await page.mouse.move(x + day * 3, y);
      await page.waitForSelector('.pane.focus .base-tl-bar[data-dragging="true"]');
    },
  },
  {
    id: "base-tempo-mesi",
    title: "Base: la linea del tempo per mesi, col fuoco su una riga dalla tastiera",
    query: "base=tempo",
    prepare: async (page) => {
      await openTimeline(page);
      await page.focus('.pane.focus .base-tl-row[data-doc="Opere/Annunciazione.md"] .base-tl-track');
      await page.keyboard.press("-");
      await page.waitForSelector('.pane.focus .base-tl-zoom-option[aria-pressed="true"]:text-is("Mesi")');
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(() => document.activeElement?.closest(".base-tl-row")?.getAttribute("data-doc") === "Opere/Il concerto.md");
    },
  },
  {
    id: "grid-workbook",
    title: "Grid v2: una cartella di Excel sui suoi byte",
    query: "workbook=1",
    prepare: openWorkbook,
  },
  // **I gesti della griglia**, sulla stessa cartella: gli stati che i
  // cantieri dei gesti (Q1–Q8) cambiano, e che `bench/grid-gestures.mjs`
  // controlla con input veri.
  {
    id: "grid-selection",
    title: "Grid v2: un intervallo B2:C4 scelto trascinando",
    query: "workbook=1",
    prepare: async (page) => {
      await openWorkbook(page);
      const from = await gridCellCenter(page, 1, 1);
      const to = await gridCellCenter(page, 3, 2);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelectorAll(".pane.focus .grid-cell.selected").length >= 6);
    },
  },
  {
    id: "grid-editing",
    title: "Grid v2: la cella A7 aperta, con una bozza scritta",
    query: "workbook=1",
    prepare: async (page) => {
      await openWorkbook(page);
      await writeInCell(page, 6, 0, "Bozza in corso");
    },
  },
  {
    id: "grid-formula",
    title: "Grid v2: la formula «=1+» a metà, nella cella B7",
    query: "workbook=1",
    prepare: async (page) => {
      await openWorkbook(page);
      await writeInCell(page, 6, 1, "=1+");
    },
  },
  {
    id: "grid-resize",
    title: "Grid v2: il puntatore sul bordo fra le intestazioni B e C",
    query: "workbook=1",
    prepare: openWorkbook,
    // Il bordo destro dell'intestazione B, a metà altezza: dove si prende la
    // colonna per allargarla.
    hover: async (page) => {
      const header = await page.evaluate(() => {
        const b = [...document.querySelectorAll(".pane.focus .grid-column-header")].find((h) => h.textContent === "B");
        const box = b?.getBoundingClientRect();
        return box ? { x: box.right, y: box.top + box.height / 2 } : null;
      });
      if (!header) throw new Error("l'intestazione B non c'è");
      await page.mouse.move(header.x, header.y);
    },
  },
  // **Gli stati della griglia** (griglia T8), sulla cartella grande
  // (`?workbook=large`, 3000 righe per 20 colonne con la riga 1 e la colonna
  // A bloccate): gli stati della barra del prototipo
  // (`PLAN-ui/celle-griglia.html` del piano delle celle), nel foglio pieno e
  // a 700 px. Il telefono ha la sua scena, fra quelle di `mobile.html`. Il
  // movimento è ridotto (`openPage`): i segni sono già al loro posto e le
  // formiche non camminano.
  ...[["", SHEET_FULL_GRID, "full", "nel foglio pieno"], ["-700", SHEET_700, 700, "a 700 px"]].flatMap(([suffix, viewport, width, where]) => [
    {
      id: `grid-large-intervallo${suffix}`,
      title: `Griglia: l'intervallo C4:E9, ${where}`,
      query: "workbook=large",
      viewport,
      prepare: async (page) => {
        await openLargeSheet(page, width);
        await pickGridRange(page, [3, 2], [8, 4]);
      },
    },
    {
      id: `grid-large-oltre${suffix}`,
      title: `Griglia: l'intervallo C1:E9 oltre la riga bloccata, scorso in giù e a destra, ${where}`,
      query: "workbook=large",
      viewport,
      prepare: async (page) => {
        await openLargeSheet(page, width);
        await pickGridRange(page, [0, 2], [8, 4]);
        await scrollGrid(page, 140, 112);
      },
    },
    {
      id: `grid-large-cella-aperta${suffix}`,
      title: `Griglia: la cella A5 aperta con un testo lungo, ${where}`,
      query: "workbook=large",
      viewport,
      prepare: async (page) => {
        await openLargeSheet(page, width);
        await writeInCell(page, 4, 0, LONG_CELL_TEXT);
      },
    },
    {
      id: `grid-large-colonna-tirata${suffix}`,
      title: `Griglia: il bordo di una colonna vicino al lato destro, tirato di 60 px, ${where}`,
      query: "workbook=large",
      viewport,
      prepare: async (page) => {
        await openLargeSheet(page, width);
        await pickGridRange(page, [3, 2], [3, 2]);
      },
      // Il bordo si tiene col tasto giù: il gesto è l'ultimo, dopo che il
      // fotografo ha portato via il puntatore.
      hover: dragColumnNearEdge,
    },
  ]),
  {
    id: "grid-large-riempimento",
    title: "Griglia: C4:C5 (10 e 20) tirata col quadratino fino a C12, il foglio non ha ancora risposto",
    query: "workbook=large&risposte=si",
    viewport: SHEET_FULL_GRID,
    prepare: async (page) => {
      await openLargeSheet(page, "full");
      await pickGridRange(page, [3, 2], [4, 2]);
      const grip = await page.evaluate(() => {
        const handle = [...document.querySelectorAll(".pane.focus .grid-mark-handle")].find((mark) => !mark.hidden && mark.getClientRects().length > 0);
        const box = handle?.getBoundingClientRect();
        return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
      });
      if (!grip) throw new Error("il quadratino di C4:C5 non si vede");
      const end = await gridCellCenter(page, 11, 2);
      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      await page.mouse.move(grip.x, (grip.y + end.y) / 2, { steps: 4 });
      await page.mouse.move(end.x, end.y, { steps: 4 });
      // Il foglio non risponde finché la scena non è fotografata: la pagina
      // dopo rinasce, e la risposta non arriva mai.
      await page.evaluate(() => {
        window.bench.throttle("gridBytesCommand");
      });
      await page.mouse.up();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".pane.focus .grid-mark-ants")].filter((mark) => !mark.hidden && mark.getClientRects().length > 0).length === 4);
    },
  },
  // La copia nelle tre scelte di «Segno della copia» (griglia T9,
  // `editor.grid.copy-mark`, `?copia=…` del finto), e il taglio, che resta
  // sempre il tratteggio fitto.
  ...[
    ["grid-large-copiata", "", "l'intervallo C4:E9 copiato, col tratteggio e il battito", "Control+c", ".grid-mark-copy"],
    ["grid-large-copiata-tratteggio", "&copia=dash", "l'intervallo C4:E9 copiato, col solo tratteggio", "Control+c", ".grid-mark-copy"],
    ["grid-large-copiata-battito", "&copia=pulse", "l'intervallo C4:E9 copiato, col solo battito", "Control+c", null],
    ["grid-large-tagliata", "", "l'intervallo C4:E9 tagliato", "Control+x", ".grid-mark-cut"],
  ].map(([id, query, what, keys, mark]) => ({
    id,
    title: `Griglia: ${what}`,
    query: `workbook=large${query}`,
    viewport: SHEET_FULL_GRID,
    prepare: async (page) => {
      await openLargeSheet(page, "full");
      await pickGridRange(page, [3, 2], [8, 4]);
      await page.keyboard.press(keys);
      if (mark) {
        await page.waitForFunction((selector) =>
          [...document.querySelectorAll(`.pane.focus ${selector}`)].filter((el) => !el.hidden && el.getClientRects().length > 0).length === 4, mark);
      } else {
        // Il solo battito si accende e svanisce: resta la selezione.
        await page.waitForFunction(() => [...document.querySelectorAll(".pane.focus .grid-mark-flash")].every((el) => el.hidden || el.getClientRects().length === 0));
      }
    },
  })),
  // **I comandi dei fogli nella tavolozza**: un comando senza una finestra
  // scritta a mano e con dei parametri obbligatori apre quella costruita dal
  // catalogo (`editors/grid/palette/form.ts`), con l'intervallo che parte
  // dalla selezione, una scelta e una casella.
  {
    id: "grid-command-form",
    title: "Grid v2: la finestra costruita per «Grafici sparkline», aperta dalla tavolozza",
    query: "workbook=1",
    prepare: async (page) => {
      await openWorkbook(page);
      await runScrittoioCommand(page, "Grafici sparkline");
      await page.waitForSelector(".grid-command-dialog .grid-command-form");
    },
  },
  // **La barra dei fogli**, sulla stessa cartella: a riposo nel foglio pieno
  // (l'albero e l'ispettore chiusi), stretta a 700 px con la sezione di una
  // tabella dal nome lunghissimo (`?grid=table`, vedi `fake-ipc.ts`), le
  // lettere di Alt, un foglietto raccolto aperto sul posto, la tavolozza dei
  // colori, la barra ritirata e la sola lettura (`?grid=readonly`). Il
  // telefono ha le sue due scene, fra quelle di `mobile.html`.
  {
    id: "grid-ribbon",
    title: "La barra dei fogli a riposo, nel foglio pieno",
    query: "workbook=1",
    viewport: SHEET_FULL,
    prepare: (page) => openRibbon(page, "full"),
  },
  {
    id: "grid-ribbon-table",
    title: "La barra dei fogli a 700 px, nella sezione di una tabella dal nome lunghissimo",
    query: "workbook=1&grid=table",
    viewport: SHEET_700,
    prepare: async (page) => {
      await openRibbon(page, 700);
      await page.click('.pane.focus .grid-ribbon .kit-tab[data-tab="table"]');
      await page.waitForSelector('.pane.focus .grid-ribbon-panel[data-tab="table"]:not([hidden])');
    },
  },
  {
    id: "grid-ribbon-keytips",
    title: "La barra dei fogli con le lettere di Alt",
    query: "workbook=1",
    viewport: SHEET_FULL,
    prepare: async (page) => {
      await openRibbon(page, "full");
      await page.keyboard.press("Alt");
      await page.waitForSelector(".pane.focus .grid-ribbon-keytip");
    },
  },
  {
    id: "grid-ribbon-open",
    title: "La barra dei fogli a 700 px, col foglietto «Numeri» aperto sul posto",
    query: "workbook=1",
    viewport: SHEET_700,
    prepare: async (page) => {
      await openRibbon(page, 700);
      await page.click('.pane.focus .grid-ribbon [data-group="number"] .grid-ribbon-group-toggle');
      await page.waitForSelector('.pane.focus .grid-ribbon [data-group="number"][data-open="true"]');
      // Il puntatore lascia l'interruttore: il suo tooltip arriva dopo 500 ms
      // di timer vero, e la foto lo prenderebbe o no (#459).
      await page.mouse.move(0, 0);
      // Il fuoco passa al menu «Generale», con l'anello di focus-visible, e
      // la sua didascalia «Formato numero» arriva dopo 500 ms di timer vero:
      // la si aspetta, perché è lo stato vero del fuoco (#467).
      await page.waitForSelector(".shell-tooltip:not([hidden])");
    },
  },
  {
    id: "grid-ribbon-palette",
    title: "La barra dei fogli con la tavolozza del colore di riempimento",
    query: "workbook=1",
    viewport: SHEET_FULL,
    prepare: async (page) => {
      await openRibbon(page, "full");
      await page.click('.pane.focus .grid-ribbon [aria-label="Altri colori: Colore riempimento"]');
      await page.waitForSelector(".grid-ribbon-palette");
    },
  },
  {
    id: "grid-ribbon-collapsed",
    title: "La barra dei fogli ritirata, con le sole sezioni",
    query: "workbook=1",
    viewport: SHEET_FULL,
    prepare: async (page) => {
      await openRibbon(page, "full");
      await page.click('.pane.focus .grid-ribbon [aria-label="Comprimi la barra multifunzione"]');
      await page.waitForSelector('.pane.focus .grid-ribbon[data-collapsed="true"]');
    },
  },
  {
    id: "grid-ribbon-readonly",
    title: "La barra dei fogli in sola lettura: i comandi che cambiano la cartella spenti",
    query: "workbook=1&grid=readonly",
    viewport: SHEET_FULL,
    prepare: (page) => openRibbon(page, "full"),
  },
  // **Il menu «Comandi» dei fogli**, sulle cartelle delle scene della barra:
  // aperto, con una ricerca che non trova niente, la scheda della tabella
  // spenta senza tabella e accesa dentro quella dal nome lunghissimo, la sola
  // lettura, e il gettone senza il nome in un foglio sotto i 560 px.
  {
    id: "grid-commands",
    title: "Il menu «Comandi» dei fogli aperto",
    query: "workbook=1",
    viewport: SHEET_FULL,
    prepare: async (page) => {
      await openRibbon(page, "full");
      await openCommands(page, ["Home", "Carattere"]);
    },
  },
  // La ricerca senza risultati: con delle voci trovate lo Spazio scrive nella
  // ricerca (la regola dei menu che cercano), e il banco dell'accessibilità
  // vuole che lo Spazio sulla voce col fuoco la scelga.
  {
    id: "grid-commands-search",
    title: "Il menu «Comandi» dei fogli con una ricerca che non trova niente",
    query: "workbook=1",
    viewport: SHEET_FULL,
    prepare: async (page) => {
      await openRibbon(page, "full");
      await openCommands(page);
      await page.keyboard.type("zzqx");
      await page.waitForSelector("#context-menu .menu-empty");
    },
  },
  {
    id: "grid-commands-context-off",
    title: "Il menu «Comandi» dei fogli: la scheda della tabella spenta, senza una tabella",
    query: "workbook=1",
    viewport: SHEET_FULL,
    prepare: async (page) => {
      await openRibbon(page, "full");
      await openCommands(page, ["Struttura tabella"]);
    },
  },
  {
    id: "grid-commands-table",
    title: "Il menu «Comandi» dei fogli a 700 px, dentro una tabella dal nome lunghissimo",
    query: "workbook=1&grid=table",
    viewport: SHEET_700,
    prepare: async (page) => {
      await openRibbon(page, 700);
      await openCommands(page, ["Struttura tabella", "Stili tabella"]);
    },
  },
  {
    id: "grid-commands-readonly",
    title: "Il menu «Comandi» dei fogli in sola lettura",
    query: "workbook=1&grid=readonly",
    viewport: SHEET_FULL,
    prepare: async (page) => {
      await openRibbon(page, "full");
      await openCommands(page, ["Home"]);
    },
  },
  // **Il risultato dei comandi che leggono** (`editors/grid/risultato.ts`),
  // aperto dalla tavolozza: mentre legge (il provider frenato), le
  // statistiche della selezione, il rifiuto del provider (il finto non serve
  // il comando) con «Riprova», nessun errore, e cinquecento errori su un
  // foglio dal nome lungo a 700 px (`?result=…`, vedi `fake-ipc.ts`).
  {
    id: "grid-result-loading",
    title: "Il risultato dei fogli mentre legge",
    query: "workbook=1&result=stats",
    prepare: async (page) => {
      await openWorkbook(page);
      await page.evaluate(() => {
        window.bench.throttle("gridBytesCommand");
      });
      await runScrittoioCommand(page, "Statistiche della selezione");
      await page.waitForSelector('.grid-result-dialog .grid-result[aria-busy="true"] .skeleton-rows');
    },
  },
  {
    id: "grid-result-table",
    title: "Il risultato dei fogli: le statistiche della selezione",
    query: "workbook=1&result=stats",
    prepare: async (page) => {
      await openWorkbook(page);
      await runScrittoioCommand(page, "Statistiche della selezione");
      await page.waitForSelector(".grid-result-dialog .grid-result-table");
    },
  },
  {
    id: "grid-result-error",
    title: "Il risultato dei fogli: il provider rifiuta, con «Riprova»",
    query: "workbook=1",
    prepare: async (page) => {
      await openWorkbook(page);
      await runScrittoioCommand(page, "Statistiche della selezione");
      await page.waitForSelector(".grid-result-dialog .grid-dialog-error");
    },
  },
  {
    id: "grid-result-empty",
    title: "Il risultato dei fogli: nessun errore",
    query: "workbook=1&result=empty",
    prepare: async (page) => {
      await openWorkbook(page);
      await runScrittoioCommand(page, "Controllo errori");
      await page.waitForSelector('.grid-result-dialog .grid-result:not([aria-busy]) .grid-dialog-note:not([hidden])');
    },
  },
  {
    id: "grid-result-many",
    title: "Il risultato dei fogli a 700 px: cinquecento errori su un foglio dal nome lungo",
    query: "workbook=1&result=errors",
    viewport: SHEET_700,
    prepare: async (page) => {
      await openWorkbook(page);
      await runScrittoioCommand(page, "Controllo errori");
      await page.waitForSelector(".grid-result-dialog .grid-result-table tbody tr:nth-child(500)");
    },
  },
];
