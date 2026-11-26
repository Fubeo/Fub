// La shell: la cornice (finestra, binario, cassetti, fogli, banda, avvisi).
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import {
  openContentSections,
  openCraft,
  openDesk,
  openExportBlockMenu,
  openExportDiagrams,
  openExportSpace,
  openFolder,
  openFontSections,
  openFrontSections,
  openLentDocx,
  openPdfNote,
  openPdfQuestion,
  openPhoto,
  openRaw,
  openThemeSections,
  openThumbTree,
  pressUntil,
  selectWordAndOpen,
  waitForGraphToSettle,
} from "./gesti-documenti.mjs";
import {
  chooseFromViewMenu,
  chooseMode,
  openLive,
  openNote,
  settleLive,
} from "./gesti-scrittura.mjs";
import { EXPORT_NARROW, FAILURES, NOTE_NARROW, SEARCH } from "./misure.mjs";

export const S_CORNICE = [
  {
    id: "startup",
    title: "Come si apre",
    prepare: async () => {},
  },
  {
    id: "explore",
    title: "L'albero del vault, aperto",
    prepare: async (page) => {
      for (const path of ["Guida", "Progetti", "Progetti/Archivio"]) {
        await openFolder(page, path);
      }
    },
  },
  {
    id: "search",
    title: "La ricerca, con i risultati",
    prepare: async (page) => {
      // Il campo di File filtra l'albero: la ricerca sta nel pannello Cerca.
      await page.click('#views-ribbon .rail-btn[data-panel="search"]');
      await page.fill("#search-input", SEARCH);
      await page.waitForSelector("#search-results li");
    },
  },
  {
    id: "menu",
    title: "Il menu dell'applicazione, aperto dal marchio",
    prepare: async (page) => {
      await page.click("#brand-menu");
      await page.click("#app-menu > button >> nth=2");
      await page.waitForSelector("#context-menu:not([hidden])");
    },
  },
  {
    id: "vault-chip",
    title: "Il chip del vault, con i vault conosciuti",
    prepare: async (page) => {
      await page.click("#vault-chip");
      await page.waitForSelector("#context-menu:not([hidden])");
    },
  },
  // S34: il «+» del titolo dell'albero chiede il tipo. Aperto dalla tastiera,
  // col fuoco sulla prima voce, e con tutti i comandi che creano un file
  // (`?nuovo=tutto`), come la toppa `menu-nuovo` del prototipo.
  {
    id: "file-nuovo-tipo",
    title: "«Nuovo» chiede il tipo: il menu del «+» dell'albero",
    query: "nuovo=tutto",
    prepare: async (page) => {
      await page.focus("#new-note");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.activeElement?.closest('#context-menu[aria-label="Nuovo"]') != null);
    },
  },
  // Il tasto destro: un menu per posto, aperto col mouse, con la testata, i
  // gruppi e il piede che invita a scrivere.
  ...[
    ["menu-testo", "Il tasto destro su un paragrafo della nota, in Live", (page) =>
      page.click('.pane.focus .pane-editor .cm-content .cm-line:has-text("Questa è la nota")', { button: "right", position: { x: 60, y: 8 } })],
    ["menu-link", "Il tasto destro su un link a una nota, in Live", (page) =>
      page.click(".pane.focus .pane-editor .cm-content >> text=Sintassi di Fub", { button: "right" })],
    ["menu-titolo", "Il tasto destro su un titolo della nota, in Live", (page) =>
      page.click(".pane.focus .pane-editor .cm-content >> text=Benvenuto in Fub", { button: "right" })],
    ["menu-albero-nota", "Il tasto destro su una nota dell'albero", async (page) => {
      await openFolder(page, "Guida");
      await page.click('#file-list li[data-path="Guida/Frammenti di codice.md"] > .tree-row', { button: "right" });
    }],
    ["menu-albero-cartella", "Il tasto destro su una cartella dell'albero", (page) =>
      page.click('#file-list li[data-path="Progetti"] > .tree-row', { button: "right" })],
    ["menu-albero-titolo", "Il tasto destro sul titolo dell'albero: creare, ordinare, importare", (page) =>
      page.click("#files-title", { button: "right" })],
    ["menu-scheda", "Il tasto destro sulla scheda attiva", (page) =>
      page.click('.pane.focus .tab[aria-selected="true"]', { button: "right" })],
    ["menu-riquadro", "Il menu ⋯ del riquadro", (page) => page.click(".pane.focus [data-pane-menu]")],
  ].map(([id, title, open]) => ({
    id,
    title,
    prepare: async (page) => {
      await open(page);
      await page.waitForSelector("#context-menu .menu-head");
    },
  })),
  // La lingua del menu (T81): la barra degli appunti, «Copia come» nella riga,
  // la scelta che resta accesa e il sottomenu. La ricerca scritta non è una
  // scena: dopo una lettera lo spazio entra nella ricerca invece di scegliere
  // la voce, e il banco dell'accessibilità vuole un click da ogni Spazio.
  ...[
    ["menu-selezione", "Il tasto destro su una parola scelta: la barra degli appunti e «Copia come» nella riga", async (page) => {
      await selectWordAndOpen(page);
    }],
    ["menu-copia-come", "«Copia come» acceso dalla tastiera, sul segno dell'HTML: il nome del formato nella riga", async (page) => {
      await selectWordAndOpen(page, { keyboard: true });
      await page.waitForSelector("#context-menu .menu-choices");
      await pressUntil(page, "ArrowDown", () => document.querySelector("#context-menu .menu-choices")?.classList.contains("menu-lit") ?? false);
      await page.keyboard.press("ArrowRight");
    }],
    ["menu-appunti-accesi", "La parte «Copia» della barra accesa: la linguetta chiara, e l'elenco spento", async (page) => {
      await selectWordAndOpen(page, { keyboard: true });
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowRight");
    }],
    ["menu-sottomenu", "Il menu del testo col primo sottomenu aperto dalla tastiera", async (page) => {
      await page.click('.pane.focus .pane-editor .cm-content .cm-line:has-text("Questa è la nota")', { button: "right", position: { x: 60, y: 8 } });
      await page.waitForSelector("#context-menu .menu-foot");
      await page.keyboard.press("ArrowDown");
      await pressUntil(page, "ArrowDown", () => document.activeElement?.getAttribute("aria-haspopup") === "menu");
      await page.keyboard.press("ArrowRight");
      await page.waitForSelector(".context-submenu [role^=menuitem]");
    }],
  ].map(([id, title, open]) => ({
    id,
    title,
    prepare: async (page) => {
      await open(page);
      await page.waitForSelector("#context-menu .menu-head");
    },
  })),
  {
    id: "settings",
    title: "Le preferenze: la configurazione",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.waitForSelector("#settings-body .setting-row");
    },
  },
  {
    id: "settings-external-apps",
    title: "Le preferenze: il gruppo «App esterne», con le anteprime fatte dalle app, il peso massimo e l'albero",
    query: "craft=1",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.waitForSelector('#settings-body .setting-row[data-setting-key="craft.tree-show-xmp"]');
      await page.$eval('.setting-row[data-setting-key="craft.editor-paths"]', (row) => row.scrollIntoView({ block: "start" }));
    },
  },
  // **I dati sulla foto**: una foto aperta col suo XMP di LightCraft accanto
  // (`?photo=xmp`, vedi `photo-fixture.ts`), con la riga di stelle,
  // etichetta, scelta e parole chiave sotto; e la stessa foto senza XMP, che
  // non ha la riga né il suo posto.
  {
    id: "photo-xmp",
    title: "Una foto col suo XMP: i dati di LightCraft sotto la foto",
    query: "photo=xmp",
    prepare: (page) => openPhoto(page, true),
  },
  {
    id: "photo-senza-xmp",
    title: "Una foto senza XMP: niente riga sotto la foto",
    query: "photo=senza",
    prepare: (page) => openPhoto(page, false),
  },
  // **La scheda di un file Craft senza anteprima** (`?craft-scheda=<caso>`,
  // vedi `craft-fixture.ts`), aperta con un clic nell'albero come le
  // schermate T23 del prototipo: la domanda sulle anteprime fatte dalle app,
  // la riga «spente», l'app che prepara l'anteprima e le frasi di `missing`.
  ...[
    ["craft-domanda", "domanda", "La scheda di un file Craft: la domanda sulle anteprime fatte dalle app", ".craft-ask"],
    ["craft-spente", "spente", "La scheda di un file Craft: le anteprime fatte dalle app spente, col link alle impostazioni", ".craft-off"],
    ["craft-prepara", "prepara", "La scheda di un file Craft aperta con un clic, anteprime accese: l'app prepara l'anteprima", ".craft-empty-state"],
    ["craft-peso", "peso", "La scheda di un file Craft oltre il peso massimo, col link alle impostazioni", ".craft-empty > .link-button"],
    ["craft-rotto", "rotto", "La scheda di un file Craft che non si legge", ".craft-empty-state"],
    ["craft-fallita", "fallita", "La scheda di un file Craft di cui l'app non è riuscita a fare l'anteprima", ".craft-empty-state"],
  ].map(([id, kind, title, ready]) => ({
    id,
    title,
    query: `craft-scheda=${kind}`,
    prepare: (page) => openCraft(page, ready, kind === "prepara" ? "Preparo l'anteprima…" : null),
  })),
  // **La scheda di un RAW** (`?raw-scheda=<caso>`, vedi `raw-fixture.ts`),
  // aperta con un clic nell'albero come le schermate T28 del prototipo: il
  // JPEG che il RAW ha dentro, dritto o scattato in verticale (orientamento
  // 6), coi dati dell'XMP sotto; e un RAW senza JPEG, con la domanda.
  ...[
    ["raw", "dritto", "La scheda di un RAW: il JPEG che ha dentro, coi dati dell'XMP sotto", "IMG_0398.CR3"],
    ["raw-girato", "girato", "La scheda di un RAW scattato in verticale: il JPEG raddrizzato dall'orientamento", "IMG_0412.CR3"],
    ["raw-senza", "senza", "La scheda di un RAW senza JPEG dentro: la domanda di LightCraft, coi dati dell'XMP", "IMG_0413.CR3"],
  ].map(([id, kind, title, name]) => ({
    id,
    title,
    query: `raw-scheda=${kind}`,
    prepare: (page) => openRaw(page, `Foto/${name}`, kind !== "senza"),
  })),
  // **PDF e documenti** (`?pdf-scena=<caso>`, vedi `craft-fixture.ts`),
  // come le schermate T31 del prototipo: la nota col contratto in PDF, con la
  // prima pagina o col link; il PDF aperto con la domanda sulle anteprime
  // nella riga d'avviso; un Word prestato a WordCraft, con la riga del
  // prestito e la domanda.
  {
    id: "nota-pdf",
    title: "Una nota con un PDF che ha l'anteprima, in Lettura: la prima pagina, il nome sotto",
    query: "pdf-scena=nota",
    prepare: (page) => openPdfNote(page, true),
  },
  {
    id: "nota-pdf-senza",
    title: "La stessa nota in Lettura, il PDF senza anteprima: il link",
    query: "pdf-scena=nota-senza",
    prepare: (page) => openPdfNote(page, false),
  },
  {
    id: "pdf-domanda",
    title: "Il PDF aperto: la domanda sulle anteprime nella riga d'avviso",
    query: "pdf-scena=domanda",
    prepare: openPdfQuestion,
  },
  {
    id: "docx-due-righe",
    title: "Un Word prestato a WordCraft: la riga del prestito e la domanda, ognuna con le sue azioni",
    query: "pdf-scena=due-righe",
    prepare: openLentDocx,
  },
  // **L'albero con le miniature** (`?albero=<caso>`, vedi `craft-fixture.ts`),
  // come i modi `albero-miniature` e `albero-xmp` del prototipo: le cartelle
  // «Foto 2026» e «Progetti» aperte, le miniature accese, gli XMP mostrati o
  // nascosti. In una finestra stretta l'albero resta nel cassetto aperto.
  ...[
    ["albero-miniature", "miniature", "L'albero con le miniature: l'anteprima che il file ha già, al posto dell'icona"],
    ["albero-xmp", "xmp", "L'albero con le miniature e gli XMP nascosti"],
  ].map(([id, kind, title]) => ({
    id,
    title,
    query: `albero=${kind}`,
    prepare: openThumbTree,
  })),
  {
    id: "prefs-appearance",
    title: "Le preferenze: carattere, accento e spazio dell'interfaccia, coi controlli dello Scrittoio",
    prepare: async (page) => {
      // La cima dell'aspetto, con l'anteprima, è già la scena «settings»: qui
      // le righe che lo Scrittoio veste coi suoi controlli, più in basso.
      await page.click("#open-settings");
      await page.waitForSelector("#settings-body .prefs-accent");
      await page.waitForSelector("#settings-body .prefs-space");
      await page.$eval('.setting-row[data-setting-key="appearance.font"]', (row) => row.scrollIntoView({ block: "start" }));
    },
  },
  {
    id: "prefs-theme-settings",
    title: "Le preferenze: le voci che il tema dichiara, una già cambiata",
    prepare: async (page) => {
      // Il tema di serie non dichiara voci: le dichiara la scena, da fuori,
      // una per specie di controllo (`window.bench.themeSettings`).
      await page.evaluate(() => window.bench.themeSettings?.());
      await page.click("#open-settings");
      await page.waitForSelector("#prefs-theme-title");
      await page.waitForSelector(".prefs-theme-entries > *");
      await page.$eval(".prefs-theme", (block) => block.scrollIntoView({ block: "start" }));
    },
  },
  {
    id: "settings-components",
    title: "Le preferenze: i componenti",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.click('#settings-tabs button[data-tab="components"]');
      // La pagina «Componenti» è a schermo quando ha i profili e le righe
      // della mappa letta.
      await page.waitForSelector('#settings-body .components-profile[aria-pressed="true"]');
      await page.waitForSelector("#settings-body .components-row");
      // E il riquadro «Fub con questi componenti», che si disegna dalla stessa mappa.
      await page.waitForSelector("#settings-body .components-preview:not([hidden]) .components-weight");
    },
  },
  {
    id: "settings-vault",
    title: "Le preferenze: i vault conosciuti",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.click('#settings-tabs button[data-tab="vault"]');
      await page.waitForSelector("#settings-body");
    },
  },
  {
    id: "activity",
    title: "Il centro attività",
    prepare: async (page) => {
      await page.click("#activity-button");
      await page.waitForSelector("#activity-panel:not([hidden])");
    },
  },
  {
    id: "toast",
    title: "L'avviso mentre succede",
    prepare: async (page) => {
      await page.evaluate((e) => window.bench.emit(e), FAILURES.severe);
      await page.waitForSelector("#toasts .toast");
    },
  },
  {
    id: "notices",
    title: "Il centro notifiche, con due guasti",
    prepare: async (page) => {
      await page.evaluate(
        ([a, b]) => {
          window.bench.emit(a);
          window.bench.emit(b);
        },
        [FAILURES.minor, FAILURES.severe],
      );
      await page.evaluate(() => document.querySelectorAll(".toast-close").forEach((close) => close.click()));
      await page.waitForSelector("#toasts", { state: "detached", timeout: 15_000 });
      await page.click("#notify-button");
      await page.waitForSelector("#notify-list li");
    },
  },
  {
    id: "tabs",
    title: "Tre linguette, la seconda attiva: il raccordo col foglio",
    prepare: async (page) => {
      // La prima linguetta è a filo del foglio, dalla seconda in poi il
      // raccordo ha due gole: è il punto in cui la sagoma si sbaglia.
      await openNote(page, "Guida/Sintassi di Fub.md");
      await openNote(page, "Guida/Frammenti di codice.md");
      await page.click(".pane.focus .tab >> nth=1");
      await page.waitForSelector('.pane.focus .tab[data-index="1"][aria-selected="true"]');
    },
  },
  {
    id: "reading",
    title: "Modalità Lettura: il documento reso",
    prepare: async (page) => {
      await openNote(page, "Guida/Sintassi di Fub.md");
      await chooseMode(page, "reading");
      // Il primo `# titolo` uguale al nome è nascosto sotto la testata: si
      // aspetta il reso, non che quel titolo si veda.
      await page.waitForSelector(".pane-preview h1, .markdown-preview h1", { state: "attached" });
    },
  },
  {
    id: "conflitto-lettura",
    title: "Il conflitto in Lettura: la fascia resta, e dice quale testo si legge",
    prepare: async (page) => {
      // Una battuta non salvata, poi il file cambia da fuori: la nota va in
      // conflitto. In Lettura il reso è il buffer, e la fascia lo dice (R03).
      // È la nota che il banco apre per prima, come nello stato S33.
      await page.click('.pane.focus .pane-editor .cm-content .cm-line:has-text("Questa è la nota")', { position: { x: 4, y: 8 } });
      await page.keyboard.press("Home");
      await page.keyboard.type("Scritto qui e non ancora salvato. ");
      await page.evaluate(async () => {
        const { api } = await import("/bench/fake-ipc.ts");
        await api.writeDocument("Benvenuto.md", "# Benvenuto in Fub\n\nCambiata da un'altra app.\n", { kind: "dictated" });
      });
      await page.waitForSelector(".pane.focus [data-banner='document.conflict.body']:not([hidden]) .conflict-actions");
      await chooseMode(page, "reading");
      await page.waitForSelector(".pane.focus [data-banner='document.conflict.body'] [data-conflict-reading]");
      await page.focus(".pane.focus .conflict-actions button >> nth=0");
    },
  },
  {
    id: "source",
    title: "Modalità Sorgente: la tavolozza della sintassi",
    prepare: async (page) => {
      await openNote(page, "Guida/Frammenti di codice.md");
      await chooseMode(page, "source");
      await page.waitForSelector(".pane.focus .pane-editor .cm-content");
    },
  },
  // **La pagina del giorno** (T39): in fondo alla giornaliera, in Live, i tre
  // gruppi della vista `day_page` (`?giorno=1` la dichiara, con la cartella
  // `Diario` del componente dei template).
  ...[
    ["pagina-del-giorno", "La pagina del giorno in fondo alla giornaliera: compiti, stesso giorno, create e cambiate", undefined],
    ["pagina-del-giorno-stretta", "La pagina del giorno nella finestra stretta: le righe lunghe vanno a capo", NOTE_NARROW],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "giorno=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      // Nella finestra stretta l'albero è nel cassetto chiuso: la nota si apre
      // larga, poi la finestra si stringe.
      if (viewport) await page.setViewportSize({ width: 1280, height: 800 });
      await openNote(page, "Diario/2026-08-19.md");
      if (viewport) {
        await page.setViewportSize(viewport);
        await page.waitForSelector("#layout.layout-compact");
      }
      await page.waitForSelector(".pane.focus .cm-day-page:not([hidden]) .ui-section .ui-list-item");
      await page.$eval(".pane.focus .cm-day-page", (section) => section.scrollIntoView({ block: "end" }));
      await page.mouse.move(0, 0);
    },
  })),
  {
    id: "inspector",
    title: "L'ispettore, sulla seconda scheda",
    prepare: async (page) => {
      await page.click("#right-pane .inspector-tab >> nth=1");
      // Nella scheda aperta: anche la Struttura, nascosta, ha le sue voci («In entrata»).
      await page.waitForSelector(
        "#right-pane .declared-view-panel:not([hidden]) :is(.ui-list-item, .ui-empty-state)",
      );
    },
  },
  {
    id: "graph",
    title: "Il grafo dei collegamenti",
    prepare: async (page) => {
      await page.click('#views-ribbon .rail-btn-main[data-panel="graph"]');
      await page.waitForSelector("canvas.graph-main");
      await waitForGraphToSettle(page);
      await page.click("summary.graph-list-summary");
      await page.waitForFunction(() => document.querySelector("details.graph-list")?.open === true);
      await page.click("summary.graph-list-summary");
      await page.waitForFunction(() => document.querySelector("details.graph-list")?.open === false);
      await waitForGraphToSettle(page);
    },
  },
  // **La Scrivania** (T40), da `bench/desk-scene.ts`: i cinque riquadri, i
  // riquadri senza niente da dire con la Base che non c'è più, e tutti tolti.
  {
    id: "scrivania",
    title: "Scrivania: appuntate, recenti, compiti di oggi, una Base e il mese",
    query: "scrivania=1&base=1",
    prepare: openDesk,
  },
  {
    id: "scrivania-vuota",
    title: "Scrivania: nessuna appuntata, niente da fare, la Base che non c'è più",
    query: "scrivania=vuota",
    prepare: openDesk,
  },
  {
    id: "scrivania-nessuno",
    title: "Scrivania: tutti i riquadri tolti, e «Rimetti:»",
    query: "scrivania=nessuno",
    prepare: openDesk,
  },
  {
    id: "focus",
    title: "Il foglio a fuoco e la cornice Darwin",
    query: "platform=darwin",
    prepare: async (page) => {
      await page.click(".pane .pane-editor .cm-content");
      await page.waitForSelector(".pane.focus");
      await page.waitForSelector(".titlebar--darwin #titlebar-left .window-controls");
    },
  },
  {
    id: "concentration",
    title: "La concentrazione: i cassetti ritirati, la scrivania spenta, il foglio al centro",
    prepare: async (page) => {
      // Dal menu Vista, la strada che non dipende da un accordo. Il primo
      // ingresso dice come si esce, con un avviso: lo si chiude, perché la
      // foto è della stanza e non dell'istruzione.
      await openNote(page, "Guida/Sintassi di Fub.md");
      await chooseFromViewMenu(page, "Modalità concentrazione");
      await page.waitForSelector("#app[data-focus-mode]");
      await page.evaluate(() => document.querySelectorAll(".toast-close").forEach((close) => close.click()));
      await page.waitForSelector("#toasts", { state: "detached", timeout: 15_000 });
    },
    // Il puntatore lontano dalla barra del titolo, che al passaggio torna
    // piena: la foto è della cornice attenuata.
    hover: (page) => page.mouse.move(8, 400),
  },
  // **La concentrazione mentre si scrive** (T24): entrata dal menu «…» del
  // riquadro, il cursore in un paragrafo. Il blocco del cursore resta acceso,
  // gli altri si attenuano; linguette e barra di formato non ci sono, la
  // barra del titolo è attenuata, e nella banda c'è «Esci dalla
  // concentrazione».
  {
    id: "concentration-writing",
    title: "La concentrazione mentre si scrive: acceso il blocco del cursore, «Esci» nella banda",
    prepare: async (page) => {
      await openNote(page, "Guida/Sintassi di Fub.md");
      await page.click(".pane.focus [data-pane-menu]");
      await page.click('#context-menu [role=menuitem]:has-text("Concentrazione")');
      await page.waitForSelector("#app[data-focus-mode] #status-focus-exit:not([hidden])");
      await page.evaluate(() => document.querySelectorAll(".toast-close").forEach((close) => close.click()));
      await page.waitForSelector("#toasts", { state: "detached", timeout: 15_000 });
      await page.click(".pane.focus .pane-editor .cm-content > .cm-line:has-text('Prosa normale')");
      await page.waitForSelector(".pane.focus .pane-editor .cm-editor.cm-focused .cm-activeLine");
    },
    hover: (page) => page.mouse.move(8, 400),
  },
  // **Lo spazio «Esporta in PDF»** (T70): dal menu «…» del riquadro, le
  // pagine come usciranno su un fondo neutro, a destra le dieci sezioni
  // chiuse che dicono ciò che vale, in fondo la banda. A 700 px il pannello
  // va sotto le pagine; il telefono sta fra le scene di `mobile.html`.
  // Con Tema e Colori aperte (T71): gli otto temi, gli undici colori con la
  // riga dell'accento aperta (i tondi, il selettore, il codice), il
  // contrasto e i due interruttori, come al passo 28 del prototipo.
  // Con Contenuto e Interruzioni aperte (T74): le righe con le scelte, i
  // commenti nel margine accanto al loro paragrafo, la tabella a griglia e
  // il codice coi numeri delle righe, come al passo 29.
  // Con Caratteri e Pagina aperte (T72): i caratteri di Fub e del vault
  // (uno chiuso dalla licenza), i cursori, i margini, le guide sulle pagine.
  ...[
    ["esporta-pdf", "Lo spazio «Esporta in PDF»: le pagine, le sezioni chiuse, la banda", undefined],
    ["esporta-pdf-stretta", "Lo spazio «Esporta in PDF» alla finestra minima (800 px): il pannello stretto, senza suggerimento", EXPORT_NARROW],
    ["esporta-pdf-temi", "Lo spazio «Esporta in PDF» con Tema e Colori aperte, la riga dell'accento aperta", undefined, "temi"],
    ["esporta-pdf-testata", "Lo spazio «Esporta in PDF» come al profilo «Relazione»: frontespizio, indice coi numeri, sezione e data in testata, due pagine", undefined, "testata"],
    ["esporta-pdf-caratteri", "Lo spazio «Esporta in PDF» con Caratteri e Pagina aperte: i caratteri del vault, i margini, le guide", undefined, "caratteri"],
    ["esporta-pdf-contenuto", "Lo spazio «Esporta in PDF» con Contenuto e Interruzioni aperte: commenti nel margine, tabelle a griglia, codice numerato", undefined, "contenuto"],
  ].map(([id, title, viewport, sections]) => ({
    id,
    title,
    ...(viewport ? { viewport } : {}),
    ...(sections === "caratteri" ? { query: "esporta-caratteri=1" } : {}),
    prepare: async (page) => {
      // In una finestra stretta l'albero è nel cassetto chiuso: la nota si
      // apre larga, poi la finestra torna com'era (la scena, o lo stato
      // della conformità).
      const size = viewport ?? page.viewportSize();
      await page.setViewportSize({ width: 1280, height: 800 });
      await openNote(page, "Guida/Sintassi di Fub.md");
      if (size) await page.setViewportSize(size);
      await openExportSpace(page);
      if (sections === "temi") await openThemeSections(page);
      if (sections === "caratteri") await openFontSections(page);
      if (sections === "contenuto") await openContentSections(page);
      if (sections === "testata") await openFrontSections(page);
    },
  })),
  // **Il menu dei profili** (T79): lo spazio parte da «Relazione», il
  // predefinito del vault, che ha il segno; i profili con la loro riga, salva
  // come nuovo, salva, copia, rinomina, i predefiniti
  // e «Torna al profilo com'era». Anche nella finestra minima.
  ...[
    ["esporta-pdf-profili", "Il menu dei profili d'esportazione: i profili del vault, salva, copia, rinomina, predefinito", undefined],
    ["esporta-pdf-profili-stretta", "Il menu dei profili d'esportazione alla finestra minima (800 px)", EXPORT_NARROW],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "profili-pdf=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      const size = viewport ?? page.viewportSize();
      await page.setViewportSize({ width: 1280, height: 800 });
      await openNote(page, "Guida/Sintassi di Fub.md");
      if (size) await page.setViewportSize(size);
      await openExportSpace(page);
      await page.click(".export-space .export-profile");
      await page.waitForSelector('#context-menu [role=menuitemradio]:has-text("Relazione")');
      await page.mouse.move(0, 0);
    },
  })),
  // **La sezione Diagrammi** (T75): la nota con un flusso, una formula più
  // larga della colonna, un diagramma con un errore e uno in Aurora; aperta
  // la sezione, ai nodi il blu della tavolozza. Sulle pagine il flusso coi
  // nodi blu, la formula rimpicciolita che lo dice, il riquadro «non
  // disegnato» col problema. Anche nella finestra minima.
  ...[
    ["esporta-pdf-diagrammi", "La sezione Diagrammi dell'esportazione: gli stili, il colore dei nodi dato a mano, il fondo; sulle pagine la formula rimpicciolita e il diagramma non disegnato", undefined],
    ["esporta-pdf-diagrammi-stretta", "La sezione Diagrammi alla finestra minima (800 px)", EXPORT_NARROW],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "live=esporta-diagrammi",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      const size = viewport ?? page.viewportSize();
      await page.setViewportSize({ width: 1280, height: 800 });
      // La disposizione larga prima di aprire la nota: `openLive` legge se
      // l'albero sta nel cassetto.
      await page.waitForFunction(() => !document.querySelector("#layout")?.classList.contains("layout-compact"));
      await openLive(page, [], "top");
      if (size) await page.setViewportSize(size);
      await openExportSpace(page);
      await openExportDiagrams(page);
    },
  })),
  // **Il clic sulla pagina** (T76): un clic su un paragrafo apre le sue
  // regolazioni, col blocco contornato; sul diagramma anche il suo stile. La
  // nota ha `<!-- pagina -->` prima del ritorno, che comincia una pagina sua.
  ...[
    ["esporta-pdf-blocco", "Il menu di un paragrafo sulla pagina dell'esportazione: pagina nuova, lascia fuori, Regola, Vai al blocco", undefined, "Prima tappa"],
    ["esporta-pdf-blocco-diagramma", "Il menu di un diagramma sulla pagina dell'esportazione: con lo stile di quel diagramma", undefined, null],
    ["esporta-pdf-blocco-stretta", "Il menu di un paragrafo sulla pagina dell'esportazione alla finestra minima (800 px)", EXPORT_NARROW, "Prima tappa"],
  ].map(([id, title, viewport, text]) => ({
    id,
    title,
    query: "live=esporta-blocchi",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      const size = viewport ?? page.viewportSize();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForFunction(() => !document.querySelector("#layout")?.classList.contains("layout-compact"));
      await openLive(page, [], "top");
      if (size) await page.setViewportSize(size);
      await openExportSpace(page);
      await openExportBlockMenu(page, text);
    },
  })),
  // **Le due voci di oggi** (T80): nel menu «…» di una nota Markdown,
  // «Esporta ▸» offre l'HTML e «PDF…», che apre lo spazio «Esporta in PDF»
  // (il vecchio PDF di solo testo non c'è più); «Esporta in PDF…» sta al
  // posto di «Stampa», che è nella barra dello spazio. Anche nella finestra
  // minima.
  ...[
    ["menu-riquadro-esporta", "Il menu «…» di una nota con «Esporta» aperto: HTML e PDF, che apre lo spazio «Esporta in PDF»", undefined],
    ["menu-riquadro-esporta-stretta", "Il menu «…» di una nota con «Esporta» aperto, alla finestra minima (800 px)", EXPORT_NARROW],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "esporta-menu=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await page.click(".pane.focus [data-pane-menu]");
      await page.locator("#context-menu [role=menuitem]", { has: page.locator(".menu-label", { hasText: /^Esporta$/ }) }).click();
      await page.waitForSelector(".context-submenu [role=menuitem]");
      await page.mouse.move(0, 0);
    },
  })),
  // **La macchina da scrivere** (T24): accesa nelle Impostazioni › Editor, il
  // cursore sceso con le frecce resta a metà altezza del foglio.
  {
    id: "typewriter",
    title: "La macchina da scrivere: la riga del cursore a metà del foglio",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.click('#settings-body .setting-row[data-setting-key="editor.typewriter"] input[role=switch]');
      await page.waitForSelector('#settings-body .setting-row[data-setting-key="editor.typewriter"] input[role=switch]:checked');
      await page.click("#settings-close");
      await openNote(page, "Guida/Sintassi di Fub.md");
      await page.waitForSelector(".pane.focus .pane-editor .cm-editor.cm-fub-typewriter");
      await page.click(".pane.focus .pane-editor .cm-content > .cm-line:has-text('Prosa normale')");
      for (let step = 0; step < 12; step += 1) await page.keyboard.press("ArrowDown");
      await settleLive(page, true);
      await page.waitForFunction(() => {
        const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
        const line = document.querySelector(".pane.focus .pane-editor .cm-activeLine");
        if (!scroller || !line) return false;
        const box = scroller.getBoundingClientRect();
        const row = line.getBoundingClientRect();
        return Math.abs((row.top + row.bottom) / 2 - (box.top + box.bottom) / 2) < row.height;
      });
    },
  },
  {
    id: "empty",
    title: "La finestra senza vault: il benvenuto",
    query: "vault=vuoto",
    prepare: async () => {},
  },
  {
    id: "new-vault-profile",
    title: "Il vault nuovo: come lo userai, con «Studio» già scelto",
    query: "vault=nuovo",
    prepare: async (page) => {
      await page.click("#onboarding-create");
      await page.waitForSelector('#onboarding-profile .components-profile[aria-pressed="true"]');
    },
  },
];
