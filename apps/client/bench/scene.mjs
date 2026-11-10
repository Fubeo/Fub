// **Le scene del banco: un elenco chiuso** (§31.1).
//
// # Perché un elenco, e perché chiuso
//
// L'alternativa è uno screenshot che qualcuno si ricorda di fare, e non è
// un'alternativa: non lascia un «prima», quindi non prova nessun miglioramento e
// non vede nessuna regressione. Qui ogni scena dichiara come si prepara —
// quale pagina, quali gesti, quale fuoco — e un presidio (`scene.test.ts`)
// verifica che ognuna abbia la sua baseline in **entrambe** le luci e che non ci
// siano baseline orfane. Le due direzioni servono tutte e due: senza la prima
// una scena nuova non fotografata sembra a posto, senza la seconda una scena
// cancellata lascia in repo la foto di qualcosa che non esiste più.
//
// Che l'elenco si possa svuotare in silenzio è la lezione della
// [0109](../../docs/decisions/0192-impostazioni-locale-e-temi.md):
// un elenco che si svuota è indistinguibile da un elenco verde. Qui il presidio
// pretende anche un minimo, così una `SCENE = []` è rossa e non serena.
//
// # Perché `.mjs` e non `.ts`
//
// Perché lo leggono in due, e uno dei due è Node: il fotografo (`foto.mjs`) gira
// fuori dal browser e fuori da Vite. È la stessa riga di confine del
// `tsconfig.json` di questa cartella — **`.ts` è del browser, `.mjs` è di
// Node** — e tenerla vuol dire che il fotografo non ha bisogno di un
// transpilatore per sapere cosa fotografare.
//
// # Cosa può fare un `prepare`
//
// Riceve la pagina di Playwright e la porta prima dello scatto. Può cliccare,
// scrivere, premere, e può parlare col banco da `window.bench` — che è come si
// producono le cose che nessun bottone produce: un guasto del kernel, una porta
// che rifiuta. Non deve **aspettare un tempo**: il fotografo aspetta già i
// caratteri e il montaggio, e ogni altra attesa va scritto come condizione.

/// Le due luci. Ogni scena si fotografa in tutte e due — è metà della promessa
/// di questo banco, perché il difetto che si cerca nasce quasi sempre in una
/// sola delle due.
export const LIGHTS = ["dark", "light"];

/// Il testo che il fotografo cerca per sapere che la ricerca ha risposto.
const SEARCH = "nota";

/// Un guasto del kernel come lo manderebbe il kernel.
function failure(severity, subject, message) {
  return { type: "trouble", severity, subject, error: { kind: "internal", message }, gate: null };
}

/// I due gradini di `Severity`, che nella shell diventano i due toni di un
/// avviso. Sono costanti perché due scene li mandano — il toast e il centro
/// notifiche — e due copie della stessa frase sono due frasi che divergono.
const FAILURES = {
  minor: failure(
    "warning",
    "Guida/Nota lunga.md",
    "l'indice di ricerca è indietro di due minuti",
  ),
  severe: failure(
    "failure",
    null,
    "il watcher del vault si è fermato: le modifiche esterne non si vedono",
  ),
};

// ---------------------------------------------------------------------------
// **Le scene**: la shell (`index.html`), il telefono (`mobile.html`), la
// finestra documento (`document.html`) e i due cataloghi (`bench/kit.html`,
// `bench/catalog.html`).
// ---------------------------------------------------------------------------
//
// Una scena può dichiarare una `viewport`: la finestra stretta è uno stato della
// cornice (i cassetti diventano sovrapposti), e non si vede a 1280.

/// Un telefono in piedi: la finestra delle scene di `mobile.html`.
const PHONE = { width: 390, height: 844 };
/// La finestra in cui, con l'albero aperto e l'ispettore chiuso, il foglio è
/// largo 700 px: la misura «700 px» del prototipo della barra dei fogli.
const SHEET_700 = { width: 1016, height: 800 };
/// La finestra in cui, senza l'albero e l'ispettore, il foglio è largo
/// 1248 px: la misura «piena» del prototipo.
const SHEET_FULL = { width: 1308, height: 800 };
/// Una finestra documento appena aperta.
const DOCUMENT_WINDOW = { width: 900, height: 700 };

export const SCENE = onPage("shell", [
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
  // Il tasto destro: un menu per posto, aperto col mouse, con la testata, i
  // gruppi e il piede che invita a scrivere.
  ...[
    ["menu-testo", "Il tasto destro su un paragrafo della nota, in Live", (page) =>
      page.click('.pane.focus .cm-content .cm-line:has-text("Questa è la nota")', { button: "right", position: { x: 60, y: 8 } })],
    ["menu-link", "Il tasto destro su un link a una nota, in Live", (page) =>
      page.click(".pane.focus .cm-content >> text=Sintassi di Fub", { button: "right" })],
    ["menu-titolo", "Il tasto destro su un titolo della nota, in Live", (page) =>
      page.click(".pane.focus .cm-content >> text=Benvenuto in Fub", { button: "right" })],
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
    title: "Una nota con un PDF che ha l'anteprima: la prima pagina, il nome sotto",
    query: "pdf-scena=nota",
    prepare: (page) => openPdfNote(page, true),
  },
  {
    id: "nota-pdf-senza",
    title: "La stessa nota, il PDF senza anteprima: il link",
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
      await page.click('.pane.focus .pane-toolbar button[data-mode="reading"]');
      await page.waitForSelector(".pane-preview h1, .markdown-preview h1");
    },
  },
  {
    id: "conflitto-lettura",
    title: "Il conflitto in Lettura: la fascia resta, e dice quale testo si legge",
    prepare: async (page) => {
      // Una battuta non salvata, poi il file cambia da fuori: la nota va in
      // conflitto. In Lettura il reso è il buffer, e la fascia lo dice (R03).
      // È la nota che il banco apre per prima, come nello stato S33.
      await page.click('.pane.focus .cm-content .cm-line:has-text("Questa è la nota")', { position: { x: 4, y: 8 } });
      await page.keyboard.press("Home");
      await page.keyboard.type("Scritto qui e non ancora salvato. ");
      await page.evaluate(async () => {
        const { api } = await import("/bench/fake-ipc.ts");
        await api.writeDocument("Benvenuto.md", "# Benvenuto in Fub\n\nCambiata da un'altra app.\n", { kind: "dictated" });
      });
      await page.waitForSelector(".pane.focus [data-banner='document.conflict.body']:not([hidden]) .conflict-actions");
      await page.click('.pane.focus .pane-toolbar button[data-mode="reading"]');
      await page.waitForSelector(".pane.focus [data-banner='document.conflict.body'] [data-conflict-reading]");
      await page.focus(".pane.focus .conflict-actions button >> nth=0");
    },
  },
  {
    id: "source",
    title: "Modalità Sorgente: la tavolozza della sintassi",
    prepare: async (page) => {
      await openNote(page, "Guida/Frammenti di codice.md");
      await page.click('.pane.focus .pane-toolbar button[data-mode="source"]');
      await page.waitForSelector(".cm-content");
    },
  },
  {
    id: "inspector",
    title: "L'ispettore, sulla seconda scheda",
    prepare: async (page) => {
      await page.click("#right-pane .inspector-tab >> nth=1");
      await page.waitForSelector("#right-pane .ui-list-item, #right-pane .ui-empty-state");
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
  {
    id: "focus",
    title: "Il foglio a fuoco e la cornice Darwin",
    query: "platform=darwin",
    prepare: async (page) => {
      await page.click(".pane .cm-content");
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
  // **Il disegno**: il disegno dei connettori (`?connectors=6`, vedi
  // `fake-ipc.ts`), aperto e guardato com'è prima che l'impianto nuovo lo
  // rifaccia, largo e stretto. Le scene della colonna, dell'ispettore, del
  // menu e di «Semplice» arrivano con i loro cantieri.
  {
    id: "draw-open",
    title: "Il disegno appena aperto",
    query: "connectors=6",
    prepare: openDrawing,
  },
  {
    id: "draw-selection",
    title: "Il disegno con un oggetto scelto da tastiera",
    query: "connectors=6",
    prepare: async (page) => {
      await openDrawing(page);
      await page.keyboard.press("v");
      // L'ellisse del disegno: la prima forma.
      const shape = await page.locator(".draw-editor .draw-surface ellipse[data-scene-id]").first().boundingBox();
      if (!shape) throw new Error("l'ellisse del disegno non c'è");
      await page.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
    },
  },
  // Stretto: 900 px, e 800, la finestra minima del desktop (sotto, la shell
  // è quella del telefono).
  ...[
    ["draw-narrow", 900, "Il disegno in una finestra di 900 px"],
    ["draw-narrow-800", 800, "Il disegno nella finestra minima, 800 px"],
  ].map(([id, width, title]) => ({
    id,
    title,
    query: "connectors=6",
    viewport: { width, height: 800 },
    prepare: openDrawing,
  })),
  // **I documenti di videoscrittura**: un `.docx` e un `.odt` aperti dalla
  // proiezione vera del codec (`?rich=…`, vedi `fake-ipc.ts`), largo e nella
  // finestra di un documento appena aperto.
  ...[
    ["document-docx", "docx", "Prova.docx", "Un .docx con un po' di tutto: titoli, elenco, tabella, revisioni, un commento"],
    ["document-docx-narrow", "docx", "Prova.docx", "Lo stesso .docx in una finestra di 900 px"],
    ["document-odt", "odt", "Verbale.odt", "Un .odt: il verbale di una riunione"],
    ["document-objects", "objects", "Oggetti.docx", "Gli oggetti che la superficie tiene com'erano: immagine, forma, casella, formula, note, salti"],
    ["document-readonly", "readonly", "Riservato.docx", "Un .docx protetto, aperto in sola lettura"],
    ["document-closed", "closed", "Chiuso.docx", "Un .docx con un paragrafo e una tabella chiusi, che restano come sono nel file"],
  ].map(([id, rich, name, title]) => ({
    id,
    title,
    query: `rich=${rich}`,
    ...(id.endsWith("-narrow") ? { viewport: DOCUMENT_WINDOW } : {}),
    prepare: (page) => openRichDocument(page, `Documenti/${name}`),
  })),
  {
    id: "nota-tre-modi",
    title: "La stessa nota in Sorgente, Live e Lettura: tre fogli affiancati",
    prepare: async (page) => {
      // In un foglio stretto le modalità sono un bottone solo che apre la
      // scelta; in uno largo, i segmenti.
      const chooseMode = async (mode, label) => {
        const segment = page.locator(`.pane.focus .pane-toolbar button[data-mode="${mode}"]`);
        if (await segment.isVisible()) return segment.click();
        await page.click(".pane.focus .pane-toolbar .pane-mode-current");
        await page.click(`#context-menu [role="menuitemradio"]:has-text("${label}")`);
      };
      await openNote(page, "Guida/Sintassi di Fub.md");
      await chooseMode("source", "Sorgente");
      await runScrittoioCommand(page, "Dividi il riquadro a destra");
      await chooseMode("live_preview", "Live");
      await runScrittoioCommand(page, "Dividi il riquadro a destra");
      await chooseMode("reading", "Lettura");
      await page.waitForSelector('.pane[data-mode="source"] .cm-content');
      await page.waitForSelector('.pane[data-mode="live_preview"] .cm-content');
      await page.waitForSelector('.pane[data-mode="reading"] .pane-preview');
    },
  },
  // **La Live** (`?live=<caso>`, vedi `live-fixture.ts`): le scene del piano
  // «Live e Blocchi», ognuna con il suo testo, il cursore nel punto che il caso
  // dice e, dove serve, i tasti che scrive. È il «prima» con cui ogni fase si
  // confronta. Il numero è quello delle foto del piano; la 18 non c'è.
  ...[
    ["live-01-panoramica", "panoramica", "La Live dall'alto, senza cursore: ogni costrutto della nota"],
    ["live-02-riga-attiva", "riga-attiva", "La Live col cursore nel paragrafo degli stili"],
    ["live-03-titolo-attivo", "titolo-attivo", "La Live col cursore su un titolo di livello 2"],
    ["live-04-codice-attivo", "codice-attivo", "La Live col cursore in un blocco di codice"],
    ["live-05-callout-attivo", "callout-attivo", "La Live col cursore nel corpo di un callout"],
    ["live-06-elenco-attivo", "elenco-attivo", "La Live col cursore su una voce numerata"],
    ["live-07-html-attivo", "html-attivo", "La Live col cursore sulla riga della formula e dell'HTML"],
    ["live-08-apice-digitando", "apice-digitando", "La Live mentre si scrive un apice non ancora chiuso", ["^2"]],
    ["live-09-pedice-digitando", "pedice-digitando", "La Live mentre si scrive un pedice non ancora chiuso", ["~2"]],
    ["live-10-apice-chiuso", "apice-chiuso", "La Live con un apice appena chiuso e il cursore dopo", ["^2^", " e poi"]],
    ["live-11-grassetto-digitando", "grassetto-digitando", "La Live mentre si scrive un grassetto non ancora chiuso", ["**importante"]],
    ["live-12-stretta", "panoramica", "La Live dall'alto nella finestra minima, 800 px", [], { width: 800, height: 800 }],
    ["live-13-panoramica-fondo", "panoramica-fondo", "La Live in fondo alla nota: formula, HTML e definizione della nota"],
    ["live-14-tabella-attiva", "tabella-attiva", "La Live col cursore in una cella della tabella"],
    ["live-15-callout-titolo", "callout-titolo", "La Live col cursore sul titolo di un callout"],
    ["live-16-elenco-a-capo", "elenco-a-capo", "La Live con voci lunghe che vanno a capo, a 900 px", [], { width: 900, height: 800 }],
    ["live-17-recinto-digitando", "recinto-digitando", "La Live mentre si apre un recinto di codice", ["```js", "@Enter", "const a = 1;"]],
    ["live-19-link-in-modifica", "link-in-modifica", "La Live col cursore sulla riga di un link lungo"],
    ["live-20-wikilink-alias", "wikilink-alias", "La Live col cursore sulla riga di un wikilink con alias"],
    ["live-21-riga-vuota", "riga-vuota", "La Live su una nota nuova, col cursore sulla riga vuota"],
    ["live-22-immagine-selezionata", "immagine-selezionata", "La Live con un'immagine da sola nel paragrafo, selezionata: contorno, maniglia e didascalia"],
    ["live-23-colori", "colori", "La Live coi nove colori del testo e del fondo"],
    ["live-24-ripiegabile", "ripiegabile", "La Live con un ripiegabile chiuso e uno aperto con un altro dentro"],
    ["live-25-colonne", "colonne", "La Live con due e tre colonne, a 900 px", [], { width: 900, height: 800 }],
    ["live-27-indice", "indice", "La Live con l'indice dei titoli in cima alla nota"],
    ["live-26-colonne-stretta", "colonne", "La Live con le colonne nella finestra minima, 800 px", [], { width: 800, height: 800 }],
  ].map(([id, live, title, keys = [], viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openLive(page, keys, live === "panoramica-fondo" ? "bottom" : "top"),
  })),
  // I Blocchi: la stessa nota, con la maniglia del blocco sotto il puntatore e
  // quella del blocco del cursore; poi la selezione di blocchi e il menu.
  ...[
    ["blocchi-01-passaggio", "riga-attiva", "I Blocchi col puntatore su un titolo: «+» e maniglia accanto", "hover"],
    ["blocchi-02-selezione", "riga-attiva", "I Blocchi con due blocchi selezionati (Esc, Shift+↓)", "select"],
    ["blocchi-03-menu", "titolo-attivo", "I Blocchi col menu della maniglia aperto", "menu"],
    ["blocchi-04-stretta", "riga-attiva", "I Blocchi nella finestra minima, 800 px, col puntatore su un titolo", "hover", { width: 800, height: 800 }],
    ["blocchi-05-pagina", "pagina", "I Blocchi con la testata della pagina: icona, copertina, titolo e proprietà", "page"],
    ["blocchi-06-pagina-larga", "pagina-larga", "I Blocchi con la pagina a tutta larghezza, a 900 px", "page", { width: 900, height: 800 }],
    ["blocchi-07-pagina-larga-stretta", "pagina-larga", "I Blocchi con la pagina a tutta larghezza, a 800 px", "page", { width: 800, height: 800 }],
  ].map(([id, live, title, gesture, viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top", "blocks");
      await page.waitForSelector(".pane.focus .cm-fub-block-handles");
      // La testata della pagina arriva dopo che il cursore è stato portato in
      // vista: secondo chi vince, la nota resta in cima o scende di 78 px. Il
      // banco aspetta la testata e riparte dalla cima, ogni volta.
      await page.waitForSelector(".pane.focus .cm-fub-page-title");
      await page.evaluate(() => { document.querySelector(".pane.focus .cm-scroller").scrollTop = 0; });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (gesture === "hover") return;
      if (gesture === "page") {
        if (live === "pagina-larga") await page.waitForSelector(".pane.focus.fub-note--wide");
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return;
      }
      if (gesture === "select") {
        await page.keyboard.press("Escape");
        await page.keyboard.press("Shift+ArrowDown");
        await page.waitForSelector(".pane.focus .cm-fub-block-selected");
      } else {
        await page.click(".pane.focus .cm-fub-block-grip");
        await page.waitForSelector("#context-menu");
      }
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
    // Il puntatore è l'ultimo gesto: `prepareScene` lo porta via prima.
    ...(gesture === "hover" ? {
      hover: async (page) => {
        await page.hover(".pane.focus .cm-content .cm-line:has-text('Cose da fare')");
        await page.waitForSelector(".pane.focus .cm-fub-block-handles[data-active=\"true\"]");
      },
    } : {}),
  })),
  // Il menu «/» (N12) su una riga vuota della Live, coi comandi veri di
  // `fub.formatting`: aperto, filtrato, un comando rapido, niente trovato, i
  // passi di tabella, colore e data, poi la finestra stretta e il foglio.
  ...[
    ["slash-01-aperto", "Il menu «/» appena aperto: le sezioni, la prima voce e la sua anteprima", ["/"]],
    ["slash-02-filtro", "Il menu «/» filtrato da «tit»: i Risultati, la parte trovata in evidenza", ["/tit"]],
    ["slash-03-rapido", "Il menu «/» con un comando rapido: «/tab 3x4»", ["/tab 3x4"]],
    ["slash-04-nessuno", "Il menu «/» senza risultati: Invio cerca fra tutti i comandi", ["/qwerty"]],
    ["slash-05-tabella", "Il passo della tabella, allargato a 3 × 4", ["/tabella", "@Enter", "@ArrowRight"]],
    ["slash-06-colore", "Il passo del colore: il testo e il fondo, coi nomi", ["/colore", "@Enter"]],
    ["slash-07-data", "Il passo della data: i giorni a portata e il calendario", ["/data", "@Enter"]],
    ["slash-08-stretta", "Il menu «/» nella finestra minima, con meno di 760 px a destra del riquadro: resta l'elenco", ["/"], { width: 800, height: 800 }],
    ["slash-09-dito", "Il menu «/» toccato col dito: un foglio in fondo, righe da 44 px", ["/"], { width: 800, height: 800 }, true],
  ].map(([id, title, keys, viewport, touch]) => ({
    id,
    title,
    query: "live=riga-vuota&slash=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      // Col dito vuol dire `(pointer: coarse)`: Chromium lo dà quando
      // emula il tocco, e il pannello lo legge all'apertura.
      if (touch) await (await page.context().newCDPSession(page)).send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await openLive(page, [], "top");
      // Il «/» si scrive a scena ferma: se un antenato del riquadro si sta
      // ancora muovendo quando il pannello nasce, CodeMirror lo crede in un
      // contenitore trasformato e lo posiziona in assoluto per sempre, e la
      // sua ombra cade un poco diversa da quella del moto ridotto.
      await page.waitForFunction(() => document.getAnimations().length === 0);
      for (const key of keys) {
        if (key.startsWith("@")) await page.keyboard.press(key.slice(1));
        else await page.keyboard.type(key);
      }
      await page.waitForSelector(".slash-panel");
      // L'anteprima arriva 40 ms dopo l'ultima freccia; poi due fotogrammi.
      await page.waitForTimeout(80);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
  })),
  {
    id: "compact",
    title: "Lo spazio dell'interfaccia al passo più stretto: le barre si ritirano, il foglio no",
    prepare: async (page) => {
      // Dalla strada vera: il menu Vista, un passo alla volta fino in fondo.
      for (let step = 0; step < 4; step++) await chooseFromViewMenu(page, "Più spazio al foglio");
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--titlebar-h").trim() === "28px");
      await page.evaluate(() => document.querySelectorAll(".toast-close").forEach((close) => close.click()));
      await page.waitForSelector(".toast", { state: "detached" });
    },
  },
  {
    id: "narrow",
    title: "La finestra minima: 800×500, cassetti ritirati",
    viewport: { width: 800, height: 500 },
    prepare: async (page) => {
      // Sotto i 960 i cassetti non stanno affiancati: la cornice li ritira, e
      // ciò che resta deve stare nella finestra senza sovrapporsi.
      await page.waitForSelector("#layout.layout-compact");
    },
  },
  {
    id: "narrow-drawer",
    title: "La finestra minima col cassetto in sovrapposizione",
    viewport: { width: 800, height: 500 },
    prepare: async (page) => {
      await page.waitForSelector("#layout.layout-compact");
      await page.click('#views-ribbon .rail-btn[data-panel="files"]');
      await page.waitForSelector("#sidebar-scrim:not([hidden])");
    },
  },
  {
    id: "confirm",
    title: "La conferma in-app: una domanda normale, il fuoco sul sì",
    prepare: async (page) => {
      // Nessun gesto del banco arriva a una domanda senza pericolo: il fixture
      // non ha il cestino di sistema, né un catalogo, né un conflitto. La
      // domanda parte allora dalla porta vera (`platform/confirm`) con le
      // parole di chi cestina una nota, e la disegna il presentatore che la
      // shell ha dichiarato: la stessa strada di un pannello, dal secondo passo.
      await page.evaluate(async () => {
        const { confirm } = await import("/src/platform/confirm.ts");
        void confirm("Spostare «Benvenuto» nel cestino?", { title: "Elimina nota", okLabel: "Elimina" });
      });
      await page.waitForSelector(".kit-dialog");
    },
  },
  {
    id: "confirm-danger",
    title: "La conferma in-app: una domanda di pericolo, il fuoco sul no",
    prepare: async (page) => {
      // La strada vera più corta: «Ripristina gruppo» nelle preferenze. Da
      // tastiera, perché l'anello dica dove cadrebbe un Invio di slancio.
      await page.click("#open-settings");
      await page.waitForSelector("#settings-body .setting-row");
      await page.focus(".settings-section-reset");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".kit-dialog");
    },
  },
  // Il lanciatore: una superficie sola, e una foto per ciò che cambia da un
  // modo all'altro. Si apre sempre dalla pillola, che è la strada che non
  // dipende da un accordo riconfigurabile; il modo lo sceglie il prefisso
  // scritto in testa, come farebbe chi scrive. Ogni scena aspetta una riga
  // che solo la risposta a quella domanda può portare: prima ci sono le
  // recenti, e fotografarle sarebbe fotografare la domanda di prima.
  {
    id: "launcher-files",
    title: "Il lanciatore: le note trovate per nome",
    prepare: async (page) => {
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", "gui");
      await page.waitForSelector('.launcher-row:has-text("Sintassi di Fub")');
      await previewShowsActiveRow(page);
    },
  },
  {
    id: "launcher-preview",
    title: "Il lanciatore: l'anteprima segue la riga attiva, resa come in Lettura",
    prepare: async (page) => {
      // Una nota che il banco sa rendere per intero, raggiunta con le frecce:
      // l'anteprima è della riga attiva, non della prima.
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", "fub");
      const row = '.launcher-row:has-text("Sintassi di Fub")';
      await page.waitForSelector(row);
      while (!(await page.$eval(row, (each) => each.getAttribute("aria-selected") === "true"))) {
        await page.keyboard.press("ArrowDown");
      }
      await previewShowsActiveRow(page);
    },
  },
  {
    id: "launcher-commands",
    title: "Il lanciatore: i comandi, con descrizione, raggio e accordo",
    prepare: async (page) => {
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", ">");
      await page.waitForSelector(".launcher-row .launcher-key");
    },
  },
  {
    id: "launcher-search",
    title: "Il lanciatore: la ricerca nel testo",
    prepare: async (page) => {
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", `?${SEARCH}`);
      await page.waitForSelector('.launcher-row:has-text("Il banco che vede")');
    },
  },
  {
    id: "launcher-empty",
    title: "Il lanciatore: niente da scegliere, e la frase che lo dice",
    prepare: async (page) => {
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", ">zzzqqq");
      await page.waitForSelector(".launcher-note:not([hidden])");
    },
  },
  // I fogli: ciò che lo Scrittoio aggiunge alla testata e al corpo di un
  // foglio (`src/shells/scrittoio/sheets/`). Dove si può ci si arriva dalla
  // tastiera, così la foto dice anche dove sta il fuoco.
  {
    id: "save-state",
    title: "Lo stato di salvataggio, aperto: che cosa è successo e che cosa si può fare",
    prepare: async (page) => {
      await page.focus(".pane.focus .sheet-save");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".kit-popover .sheet-save-panel");
    },
  },
  {
    id: "title-rename",
    title: "Il titolo in modifica, con un nome che non si può dare",
    prepare: async (page) => {
      await page.focus(".pane.focus .pane-toolbar > .sheet-title");
      await page.keyboard.press("F2");
      await page.waitForSelector(".sheet-title-edit input:focus");
      await page.keyboard.type("Che: cosa?");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".kit-popover .sheet-title-error");
    },
  },
  {
    id: "desk",
    title: "La scrivania: il foglio vuoto, coi gesti per cominciare e le note da riprendere",
    prepare: async (page) => {
      await openNote(page, "Guida/Sintassi di Fub.md");
      // Chiuse tutte le linguette del foglio, ciò che resta è il vuoto.
      const close = page.locator(".pane.focus .tab-close");
      while ((await close.count()) > 0) await close.first().click();
      await page.waitForSelector(".pane.focus .sheet-desk .sheet-desk-row");
    },
  },
  {
    id: "heading-thread",
    title: "Il filo dei titoli, aperto dalla tastiera sul suo indice",
    prepare: async (page) => {
      // Il fixture del banco non risponde alla domanda `outline`: senza una
      // risposta il filo non c'è, com'è giusto. La scena dà all'host finto i
      // titoli della nota, letti dal suo testo, prima di aprirla — e solo per
      // questa pagina. Il giorno che il fixture risponde, questo passo va via.
      await page.evaluate(async () => {
        const { api } = await import("/bench/fake-ipc.ts");
        const ask = api.queryIndex;
        const bytes = new TextEncoder();
        api.queryIndex = async (query) => {
          if (query.kind !== "outline") return ask(query);
          const { text } = await api.readDocument(query.doc);
          const value = [];
          let start = 0;
          for (const line of text.split("\n")) {
            const end = start + bytes.encode(line).length;
            const found = /^(#{1,6})\s+(.+)$/.exec(line);
            if (found) {
              value.push({ level: found[1].length, text: found[2], slug: "", span: { start, end }, explicit_anchor: null });
            }
            start = end + 1;
          }
          return { kind: "outline", value };
        };
      });
      await openNote(page, "Guida/Sintassi di Fub.md");
      await page.waitForSelector(".pane.focus .sheet-thread:not([hidden]) .sheet-thread-item");
      // Dal menu della testata il Tab arriva al filo, che si apre in indice.
      await page.focus(".pane.focus [data-pane-menu]");
      await page.keyboard.press("Tab");
      await page.waitForSelector(".pane.focus .sheet-thread-item:focus-visible");
    },
  },
  // **Lo strato d'avvio** (`.avvio`, nelle tre pagine): ciò che si vede prima
  // dell'app. Il fake lo ferma a uno stato dalla query (`avvio=…` in
  // `fake-ipc.ts`), e la scena dichiara la sua condizione d'arrivo perché
  // l'avvio non finisce mai (attesa) o finisce nel guasto: `data-bench` non
  // dice niente su di loro. La scia la ferma il palco (`QUIET`).
  {
    id: "avvio-attesa",
    title: "L'avvio: il marchio, la riga del vault che si apre, la scia",
    query: "avvio=attesa",
    ready: () => document.querySelector('.avvio[data-stato="attesa"][data-fase="vault"]') !== null,
    prepare: async () => {},
  },
  {
    id: "avvio-lento",
    title: "L'avvio che si allunga: «Ci vuole più del solito.»",
    query: "avvio=attesa",
    // Lo dice `stati.js` a 10 s: una condizione, non un tempo.
    ready: () => document.querySelector('.avvio[data-stato="lento"]') !== null,
    readyTimeout: 15_000,
    prepare: async () => {},
  },
  {
    id: "avvio-guasto",
    title: "L'avvio caduto: il motivo, Riprova col fuoco, Copia i dettagli",
    query: "avvio=guasto",
    ready: () =>
      document.querySelector('.avvio[data-stato="guasto"]') !== null &&
      document.activeElement?.id === "avvio-riprova",
    prepare: async () => {},
  },
]).concat(
  // **Il kit** (`bench/kit.html`): le primitive di `src/kit/` vestite dalla
  // stessa serie. Stanno in questo elenco perché sono la stessa pelle e le
  // stesse baseline, e su una pagina loro perché un catalogo non ha uno stato
  // da preparare: ha un elenco da esaurire. Ciò che si apre — il menu, il
  // riquadro, il dialogo, la scheda — non sta in una foto sola: una superficie
  // chiude l'altra.
  onPage("kit", [
    {
      id: "kit",
      title: "Il kit: ogni primitiva nei suoi stati",
      prepare: async () => {},
    },
    {
      id: "kit-popover",
      title: "Il kit: il popover che porta un menu, col fuoco sulla prima voce",
      prepare: async (page) => {
        await page.click("#sample-menu");
        await page.waitForSelector('.kit-popover [role="menuitem"]:focus');
      },
    },
    {
      id: "kit-panel",
      title: "Il kit: il popover che porta un riquadro, col suo campo",
      prepare: async (page) => {
        await page.click("#sample-panel");
        await page.waitForSelector(".kit-popover .kit-field-input:focus");
      },
    },
    {
      id: "kit-dialog",
      title: "Il kit: il dialogo sopra il suo velo",
      prepare: async (page) => {
        await page.click("#sample-dialog");
        await page.waitForSelector(".kit-dialog");
      },
    },
    {
      id: "kit-focus",
      title: "Il kit: il fuoco vero da tastiera, e la scheda che ne esce",
      prepare: async (page) => {
        // Da tastiera, perché l'anello sia quello di `:focus-visible` e non il
        // gemello che la pagina tiene fermo: quattro Tab portano al rimando.
        for (let step = 0; step < 4; step++) await page.keyboard.press("Tab");
        await page.waitForSelector("#sample-card:focus-visible");
        await page.waitForSelector(".kit-hover-card");
      },
    },
  ]),
  // **Il telefono** (`mobile.html`): la stessa
  // cornice, in colonna. Il binario è la barra inferiore, i cassetti salgono
  // dal basso, la barra di formattazione sta sopra la tastiera. La finestra è
  // quella di un telefono in piedi; l'ultima scena lo sdraia.
  onPage("mobile", [
    {
      id: "mobile-startup",
      title: "Il telefono: il foglio, la barra del titolo ridotta, la barra inferiore",
      viewport: PHONE,
      prepare: async (page) => {
        await page.waitForSelector("#rail .rail-btn-inspector");
      },
    },
    {
      id: "mobile-sheet",
      title: "Il telefono: il cassetto che sale dal basso, col velo e la maniglia",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click('#views-ribbon .rail-btn[data-panel="files"]');
        await page.waitForSelector("#sidebar-scrim:not([hidden])");
        // Il fuoco va alla maniglia, non al campo di ricerca: niente tastiera.
        await page.waitForSelector("#sidebar > .sheet-grip:focus");
        // La maniglia resta alta 28 px: la regola dei 44 px del tocco non la
        // prende, perché le sue esclusioni non pesano (`shells/mobile/mobile.css`).
        await page.waitForFunction(() => {
          const grip = document.querySelector("#sidebar > .sheet-grip");
          return grip instanceof HTMLElement && Math.abs(grip.getBoundingClientRect().height - 28) < 0.5;
        }, null, { timeout: 5_000 });
      },
    },
    {
      id: "mobile-inspector",
      title: "Il telefono: l'ispettore, dalla barra inferiore",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click("#rail .rail-btn-inspector");
        await page.waitForSelector('#rail .rail-btn-inspector[aria-expanded="true"]');
        await page.waitForSelector("#inspector-scrim:not([hidden])");
      },
    },
    // Le impostazioni in piedi, scheda «Componenti»: gli interruttori sono il
    // binario della pelle con un tocco di 44 px attorno, e le schede scorrono
    // di lato coi nomi interi (`shells/mobile/mobile.css`, PA T47).
    {
      id: "mobile-settings",
      title: "Il telefono: le impostazioni sui componenti, gli interruttori e le schede intere",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click("#open-settings");
        await page.click('#settings-tabs button[data-tab="components"]');
        await page.waitForSelector('#settings-body input[role="switch"]');
        await page.$eval('#settings-body input[role="switch"]', (first) => first.scrollIntoView({ block: "center" }));
        await page.waitForFunction(() => {
          const scroll = document.querySelector("#settings-scroll") ?? document.querySelector("#settings-body");
          if (!scroll) return false;
          const box = scroll.getBoundingClientRect();
          // Visibile: per intero dentro la parte che scorre.
          const switches = [...document.querySelectorAll('#settings-body input[role="switch"]')].filter((input) => {
            const r = input.getBoundingClientRect();
            return r.width > 0 && r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right;
          });
          if (switches.length === 0) return false;
          const touchable = switches.every((input) => {
            const r = input.getBoundingClientRect();
            if (Math.round(r.width) !== 32 || Math.round(r.height) !== 18) return false;
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            return document.elementFromPoint(x, y - 10) === input
              && document.elementFromPoint(x, y + 10) === input
              && document.elementFromPoint(r.left - 5, y) === input;
          });
          const whole = [...document.querySelectorAll(".settings-tab")].every((tab) => tab.scrollWidth <= tab.clientWidth);
          return touchable && whole;
        }, null, { timeout: 5_000 });
      },
    },
    // Il cestino con tre file, in piedi: i bottoni «Ripristina» di due righe
    // vicine non si toccano (`shells/mobile/mobile.css`, PA T47).
    {
      id: "mobile-trash",
      title: "Il telefono: il cestino con tre file, i bottoni staccati",
      query: "cestino=3",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click('#views-ribbon .rail-btn[data-panel="trash"]');
        await page.waitForFunction(() => {
          const buttons = [...document.querySelectorAll(".ui-list > .ui-stack > .ui-button")]
            .filter((button) => button.getClientRects().length > 0);
          if (buttons.length !== 3) return false;
          const boxes = buttons.map((button) => button.getBoundingClientRect());
          return boxes.slice(1).every((box, index) => box.top - boxes[index].bottom >= 8);
        }, null, { timeout: 5_000 });
      },
    },
    // Il documento in piedi: la carta sta nella vista, e il pannello del
    // documento sale dal basso, aperto dal pulsante col numero dei commenti.
    {
      id: "mobile-document",
      title: "Il telefono: un .docx con la carta larga quanto la vista e il pulsante dei commenti",
      query: "rich=docx",
      viewport: PHONE,
      prepare: async (page) => {
        await openRichDocument(page, "Documenti/Prova.docx");
        // Il pallino dello stato nella testata resta il chip di 24 px del
        // computer, non un cerchio di 44, e si tocca lo stesso 10 px sopra e
        // sotto il suo centro (`shells/mobile/mobile.css`, PA T47).
        await page.waitForFunction(() => {
          const chip = document.querySelector(".pane.focus .pane-toolbar .pane-standing-chip");
          if (!(chip instanceof HTMLElement) || chip.getClientRects().length === 0) return false;
          const r = chip.getBoundingClientRect();
          if (r.height > 24.5 || r.width >= 44) return false;
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          // Il suo tocco non copre il bottone della modalità accanto.
          const mode = document.querySelector(".pane.focus .pane-toolbar > .pane-mode-current");
          const m = mode?.getBoundingClientRect();
          const modeFree = !m || m.width === 0
            || document.elementFromPoint(m.left + 1, m.top + m.height / 2)?.closest(".pane-mode-current") === mode;
          return modeFree
            && document.elementFromPoint(x, y - 10)?.closest(".pane-standing-chip") === chip
            && document.elementFromPoint(x, y + 10)?.closest(".pane-standing-chip") === chip;
        }, null, { timeout: 5_000 });
        // Il fuoco della tastiera sul bottone della modalità: dal menu «…»
        // un passo indietro, così l'anello è quello di `:focus-visible`. Il
        // bottone sta sulla carta o accanto: l'anello sta dentro il suo
        // rettangolo, cioè lo scarto è negativo e largo almeno quanto la linea
        // (`shells/mobile/mobile.css`, PA T47).
        await page.focus(".pane.focus [data-pane-menu]");
        await page.keyboard.press("Shift+Tab");
        await page.waitForFunction(() => {
          const mode = document.activeElement;
          if (!(mode instanceof HTMLElement) || !mode.matches(".pane.focus .pane-mode-current:focus-visible")) return false;
          const style = getComputedStyle(mode);
          const width = parseFloat(style.outlineWidth);
          const offset = parseFloat(style.outlineOffset);
          return style.outlineStyle !== "none" && width > 0 && offset < 0 && -offset >= width;
        }, null, { timeout: 5_000 });
      },
    },
    {
      id: "mobile-document-panel",
      title: "Il telefono: i commenti del .docx nel foglio che sale dal basso",
      query: "rich=docx",
      viewport: PHONE,
      prepare: async (page) => {
        await openRichDocument(page, "Documenti/Prova.docx");
        await page.click(".pane.focus .rich-side-open");
        await page.waitForSelector("#inspector-scrim:not([hidden])");
        await page.waitForSelector(".rich-side-comments .rich-side-comment");
      },
    },
    // La barra dei fogli in piedi: la Home in tre colonne di due foglietti
    // chiusi, e uno di loro aperto sul posto.
    {
      id: "mobile-grid-ribbon",
      title: "Il telefono: la barra dei fogli a riposo",
      query: "workbook=1",
      viewport: PHONE,
      prepare: (page) => openRibbon(page, "phone"),
    },
    {
      id: "mobile-grid-ribbon-open",
      title: "Il telefono: la barra dei fogli col foglietto «Allineamento» aperto sul posto",
      query: "workbook=1",
      viewport: PHONE,
      prepare: async (page) => {
        await openRibbon(page, "phone");
        await page.click('.pane.focus .grid-ribbon [data-group="alignment"] .grid-ribbon-group-toggle');
        await page.waitForSelector('.pane.focus .grid-ribbon [data-group="alignment"][data-open="true"]');
      },
    },
    {
      id: "mobile-launcher",
      title: "Il telefono: il lanciatore, dalla pillola",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click("#pill");
        await page.waitForSelector(".launcher-input:focus");
      },
    },
    {
      id: "mobile-keyboard",
      title: "Il telefono: la tastiera su, la barra di formattazione sopra i tasti",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click(".pane.focus .cm-content");
        // La tastiera a schermo non esiste in un browser senza schermo: ciò
        // che la shell ne sa è che il viewport visivo si accorcia.
        await page.evaluate(() => {
          const view = window.visualViewport;
          Object.defineProperty(view, "height", { configurable: true, get: () => window.innerHeight - 320 });
          view.dispatchEvent(new Event("resize"));
        });
        await page.waitForSelector(':root[data-mobile-keyboard="visible"]');
        await page.waitForSelector(".pane.focus > .format-bar", { state: "visible" });
        await page.waitForSelector("#rail", { state: "hidden" });
      },
    },
    {
      id: "mobile-welcome",
      title: "Il telefono: il benvenuto, senza un vault",
      query: "vault=vuoto",
      viewport: PHONE,
      prepare: async (page) => {
        await page.waitForSelector("#app[data-welcome]");
      },
    },
    {
      id: "mobile-landscape",
      title: "Il telefono sdraiato: binario a sinistra, cassetto di lato",
      viewport: { width: PHONE.height, height: PHONE.width },
      prepare: async (page) => {
        await page.click('#views-ribbon .rail-btn[data-panel="files"]');
        await page.waitForSelector("#sidebar-scrim:not([hidden])");
      },
    },
    {
      id: "avvio-telefono",
      title: "L'avvio sul telefono: il marchio e la riga del vault",
      query: "avvio=attesa",
      viewport: PHONE,
      ready: () => document.querySelector('.avvio[data-stato="attesa"][data-fase="vault"]') !== null,
      prepare: async () => {},
    },
  ]),
  // **La finestra documento** (`document.html`): un foglio solo, in
  // una finestra sua, che parla con la principale da un canale. Senza una
  // principale che le risponda non ha niente da mostrare, quindi la scena ne
  // apre una accanto, nello stesso contesto.
  onPage("document", [
    {
      id: "window-document",
      title: "La finestra documento: il foglio, la linguetta, lo stato nella testata",
      viewport: DOCUMENT_WINDOW,
      prepare: async (page) => {
        await openDocumentWindow(page);
      },
    },
    {
      id: "window-invalid",
      title: "La finestra documento senza un documento valido",
      viewport: DOCUMENT_WINDOW,
      prepare: async (page) => {
        await page.waitForSelector("#document-window.document-window-invalid");
      },
    },
  ]),
  // **I tre cataloghi** (`bench/catalog.html`): tutto ciò che un tema deve
  // distinguere, su una pagina senza la shell.
  onPage("catalog", [
    {
      id: "catalog-components",
      title: "Catalogo: ogni componente in ogni stato",
      query: "catalog=components",
      prepare: async () => {},
    },
    {
      id: "catalog-palette",
      title: "Catalogo: ogni token col suo contrasto",
      query: "catalog=palette",
      prepare: async () => {},
    },
    {
      id: "catalog-samples",
      title: "Catalogo: la scala tipografica",
      query: "catalog=samples",
      prepare: async () => {},
    },
  ]),
);

/// Le finestre principali che le scene della finestra documento tengono
/// aperte, una per contesto: la successiva riusa quella che c'è.
const MAIN_WINDOWS = new WeakMap();

/// Porta `page` (la finestra documento, ancora senza richiesta) davanti a un
/// documento vero: apre lo Scrittoio in una pagina accanto, chiede dal menu
/// della linguetta «Apri in una nuova finestra», e ricarica la finestra con la
/// richiesta che l'host ha ricevuto — cioè quella che il backend le passerebbe.
async function openDocumentWindow(page) {
  const here = new URL(page.url());
  const context = page.context();
  let main = MAIN_WINDOWS.get(context);
  if (!main || main.isClosed()) {
    main = await context.newPage();
    MAIN_WINDOWS.set(context, main);
  }
  await main.setViewportSize({ width: 1280, height: 800 });
  await main.goto(`${here.origin}/index.html?light=${here.searchParams.get("light")}`, { waitUntil: "load" });
  await main.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: 30_000 });
  await main.click('.pane.focus .tab[aria-selected="true"]', { button: "right" });
  await main.click('#context-menu [role=menuitem]:has-text("Apri in una nuova finestra")');
  const request = await (
    await main.waitForFunction(
      () => window.bench.calls.find((call) => call.gate === "openDocumentWindow")?.args[0] ?? null,
    )
  ).jsonValue();
  await page.goto(`${here.origin}${here.pathname}${here.search}&${new URLSearchParams(request)}`, { waitUntil: "load" });
  // La pagina rinasce qui, dopo l'attesa di `prepareScene`: si aspetta di
  // nuovo anche che lo strato d'avvio se ne sia andato, o la foto prende il
  // marchio fermo nei suoi ms minimi (il runner l'ha preso una volta).
  await page.waitForFunction(
    () => document.documentElement.dataset.bench === "ready" && !document.querySelector(".avvio"),
    null,
    { timeout: 30_000 },
  );
  // Collegata: la principale ha risposto, il testo c'è e si può scrivere.
  await page.waitForSelector('#document-window-link[data-state="salvato"]');
  await page.waitForSelector('#document-window-panel .cm-content[contenteditable="true"]');
}

/// Mette ogni scena sulla sua pagina: è dell'elenco, non di ciascuna voce.
function onPage(page, scenes) {
  return scenes.map((scene) => ({ query: "", ...scene, page }));
}

/// Sceglie una voce del menu Vista dello Scrittoio, aperto dal marchio: la
/// strada ai comandi che non passa dal lanciatore.
async function chooseFromViewMenu(page, label) {
  await page.click("#brand-menu");
  await page.click("#app-menu > button >> nth=2");
  await page.click(`#context-menu [role=menuitem]:has-text("${label}")`);
  await page.waitForSelector("#context-menu", { state: "detached" });
}

/// Aspetta che l'anteprima del lanciatore mostri la nota della riga attiva. La
/// resa parte dopo una sosta (`PREVIEW_DELAY_MS`) e fino ad allora resta quella
/// di prima, o il vuoto: una foto scattata prima sarebbe di un'altra riga.
async function previewShowsActiveRow(page) {
  await page.waitForFunction(() => {
    const input = document.querySelector(".launcher-input");
    const id = input?.getAttribute("aria-activedescendant");
    const title = id ? document.getElementById(id)?.querySelector(".launcher-row-title")?.textContent?.trim() : "";
    const preview = document.querySelector(".launcher-preview");
    const shown = preview?.querySelector(".launcher-preview-page")?.textContent ?? "";
    return Boolean(title) && !preview.hasAttribute("data-waiting") && shown.includes(title);
  });
}

/// Esegue un comando dello Scrittoio dal lanciatore, aperto dalla pillola: è
/// la strada che non dipende da una scorciatoia riconfigurabile. Il prefisso
/// `>` sceglie il modo dei comandi, come farebbe chi scrive.
async function runScrittoioCommand(page, title) {
  await page.click("#pill");
  await page.waitForSelector(".launcher-input:focus");
  await page.fill(".launcher-input", `>${title}`);
  const row = `.launcher-row:has-text("${title}")`;
  await page.waitForSelector(row);
  await page.click(row);
  await page.waitForSelector(".launcher-layer", { state: "detached" });
}

/// Esegue un comando della shell dalla palette, senza dipendere da una scorciatoia
/// che il vault o l'utente potrebbero aver riconfigurato.
async function runCommand(page, title) {
  await page.click("#open-palette");
  await page.fill(".palette-input", title);
  await page.waitForSelector(".palette-list li:not(.palette-empty)");
  await page.click(".palette-list li:not(.palette-empty)");
  await page.waitForSelector("#command-palette", { state: "detached" });
}

/// Apre una nota dall'albero. Sta in una funzione perché due scene la fanno, e
/// perché il modo di aprirla è una cosa che può cambiare: cambierà qui.
///
/// **Si sceglie per `data-path`, non per testo.** `:has-text()` di Playwright
/// risale agli antenati: in un albero l'antenato di una nota è la sua cartella,
/// e la cartella contiene il testo di tutti i suoi figli. Il `data-path` è
/// invece l'identità stabile che l'esploratore mette sulle voci dell'albero e
/// che non dipende dall'implementazione del tooltip.
async function openNote(page, path) {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  await openFolder(page, folder);
  await page.click(`#file-list .tree-row.note[data-path="${path}"]`);
  await page.waitForFunction(
    (n) =>
      document.querySelector('.tab[aria-selected="true"] .tab-name')?.textContent?.includes(n) ??
      false,
    name,
  );
}

/// Apre la nota della Live (`?live=…`), passa alla Live, mette il cursore dove
/// il caso dice e scrive i tasti della scena (`@Invio` è un tasto, il resto
/// testo). Senza cursore la nota si guarda dall'alto e senza fuoco; `scroll`
/// dice se dall'alto o dal fondo.
async function openLive(page, keys, scroll, mode = "live_preview") {
  const doc = await page.evaluate(() => globalThis.__fubLiveBench?.doc ?? null);
  if (doc === null) throw new Error("la pagina non ha la nota della Live");
  // In una finestra stretta l'albero sta nel cassetto, e le modalità sono un
  // bottone solo: come in `openRichDocument` e in `nota-tre-modi`.
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await openNote(page, doc);
  if (compact && await page.isVisible("#sidebar-scrim")) {
    const scrim = await page.locator("#sidebar-scrim").boundingBox();
    await page.click("#sidebar-scrim", { position: { x: scrim.width - 8, y: 8 } });
    await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
  }
  const live = page.locator(`.pane.focus .pane-toolbar button[data-mode="${mode}"]`);
  if (await live.isVisible()) await live.click();
  else if (!(await page.isVisible(`.pane.focus[data-mode="${mode}"]`))) {
    await page.click(".pane.focus .pane-toolbar .pane-mode-current");
    await page.click(`#context-menu [role="menuitemradio"]:has-text("${mode === "blocks" ? "Blocchi" : "Live"}")`);
  }
  await page.waitForSelector(`.pane.focus[data-mode="${mode}"] .cm-content`);
  await page.evaluate(async (bottom) => {
    // La vista si prende dal modulo del pacchetto testuale, lo stesso che la
    // shell ha già caricato: il banco non tocca CodeMirror da sé.
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const pane = document.querySelector(".pane.focus .cm-editor")?.parentElement;
    if (!pane) throw new Error("il riquadro non ha l'editor");
    const view = findTextEditorOrThrow(pane);
    const cursor = globalThis.__fubLiveBench.cursor;
    if (cursor === null) {
      view.dispatch({ selection: { anchor: 0 } });
      view.contentDOM.blur();
    } else {
      const head = globalThis.__fubLiveBench.head ?? cursor;
      view.dispatch({ selection: { anchor: cursor, head }, scrollIntoView: true });
      view.focus();
    }
    if (bottom) view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
  }, scroll === "bottom");
  for (const key of keys) {
    if (key.startsWith("@")) await page.keyboard.press(key.slice(1));
    else await page.keyboard.type(key);
  }
  await settleLive(page, scroll === "bottom");
}

/// La Live a riposo, prima della foto: due cose arrivavano dopo i due
/// fotogrammi che bastavano prima, e secondo il carico finivano nella foto o no.
///
/// - Ciò che si è scritto si salva 400 ms dopo l'ultimo tasto: la foto
///   prendeva «Non salvato» o «Salvato», nella barra del riquadro, sulla
///   linguetta e in fondo (#273). Si fotografa a salvataggio finito, lo stato
///   in cui la scena resta.
/// - Le formule arrivano dopo (KaTeX si carica alla prima, e i suoi caratteri
///   dopo ancora) e cambiano di un pixel o due l'altezza delle righe. Lo
///   scorrimento verso il cursore chiesto prima resta dov'era, e la foto
///   veniva spostata di 1-2 px (#279). Si aspetta che ogni formula sia
///   disegnata e ogni carattere caricato, poi si chiede di nuovo lo stesso
///   scorrimento, da capo, sull'impaginazione finale. La nota portata in
///   fondo (`bottom`) resta dove l'ha messa l'apertura: lì non c'è un cursore
///   da tenere in vista.
async function settleLive(page, bottom) {
  await page.waitForFunction(() => !["non_salvato", "in_corso"].includes(document.querySelector("#save-state")?.dataset.state ?? ""));
  await page.waitForFunction(() => !document.querySelector('.pane.focus .cm-content [data-state="loading"]'));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (!bottom) {
    await page.evaluate(async () => {
      if (globalThis.__fubLiveBench.cursor === null) return;
      const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
      const view = findTextEditorOrThrow(document.querySelector(".pane.focus .cm-editor").parentElement);
      // Da capo: col cursore già in vista CodeMirror non scorrerebbe, e
      // resterebbe lo scorrimento calcolato sull'impaginazione di prima.
      view.scrollDOM.scrollTop = 0;
      view.dispatch({ scrollIntoView: true });
    });
  }
  // Due fotogrammi: la misura di CodeMirror dopo l'ultima transazione.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// Apre un documento di videoscrittura dall'albero e aspetta che la
/// superficie abbia montato la sua proiezione.
/// In una finestra stretta l'albero sta nel cassetto: lo si apre, e dopo la
/// scelta lo si richiude, perché la foto è del documento.
async function openRichDocument(page, path) {
  await openFromTree(page, path, ".pane.focus .rich-surface .ProseMirror");
}

/// Apre `path` dall'albero e aspetta `ready`. In una finestra stretta l'albero
/// è un cassetto: lo apre prima e lo richiude dopo.
async function openFromTree(page, path, ready) {
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await openFolder(page, path.slice(0, path.lastIndexOf("/")));
  await page.click(`#file-list .tree-row[data-path="${path}"]`);
  await page.waitForSelector(ready);
  if (compact && await page.isVisible("#sidebar-scrim")) {
    // In alto a destra: in una finestra stretta il cassetto copre il centro,
    // e su un telefono sale dal basso.
    const scrim = await page.locator("#sidebar-scrim").boundingBox();
    await page.click("#sidebar-scrim", { position: { x: scrim.width - 8, y: 8 } });
    await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
  }
}

/// Apre il disegno dei connettori e aspetta che sia dipinto, col fuoco sulla
/// tela.
async function openDrawing(page) {
  const fixture = await page.evaluate(() => globalThis.__fubConnectorsBench?.fixture ?? null);
  if (fixture === null) throw new Error("la pagina non ha il disegno dei connettori");
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await page.click(`#file-list .tree-row[data-path="${fixture.doc}"]`);
  await page.waitForSelector(".draw-editor .draw-surface");
  if (compact && await page.isVisible("#sidebar-scrim")) {
    const scrim = await page.locator("#sidebar-scrim").boundingBox();
    await page.click("#sidebar-scrim", { position: { x: scrim.width - 8, y: 8 } });
    await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
  }
  const objects = fixture.shapes.length + fixture.connectors.length + fixture.labels.length;
  await page.waitForFunction(
    (painted) => (document.querySelector(".draw-editor .draw-surface")?.querySelectorAll("[data-scene-id]").length ?? 0) >= painted,
    objects,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.focus(".draw-editor .draw-surface");
}

/// Apre la foto delle scene `photo-*` e aspetta che sia disegnata, e con
/// `withData` anche la riga dei dati di LightCraft.
async function openPhoto(page, withData) {
  await openFolder(page, "Foto");
  await page.click('#file-list .tree-row[data-path="Foto/spiaggia.jpg"]');
  await page.waitForFunction(() => {
    const image = document.querySelector(".pane.focus .media-surface img");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  if (withData) await page.waitForSelector(".pane.focus .photo-data .photo-data-open");
}

/// Apre il disegno delle scene `craft-*` con un clic nell'albero (un gesto) e
/// aspetta `ready` nella scheda, e con `said` la frase dello stato.
async function openCraft(page, ready, said) {
  await openFolder(page, "Disegni");
  await page.click('#file-list .tree-row[data-path="Disegni/logo-studio.vectorcraft"]');
  await page.waitForSelector(`.pane.focus ${ready}`);
  if (said !== null) {
    await page.waitForFunction((text) => document.querySelector(".pane.focus .craft-empty-state")?.textContent === text, said);
  }
}

/// Apre il RAW delle scene `raw-*` con un clic nell'albero e aspetta il JPEG
/// disegnato (`withImage`) o la domanda, e la riga dei dati dell'XMP.
async function openRaw(page, doc, withImage) {
  await openFolder(page, "Foto");
  await page.click(`#file-list .tree-row[data-path="${doc}"]`);
  if (withImage) {
    await page.waitForFunction(() => {
      const image = document.querySelector(".pane.focus .craft-card img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
  } else {
    await page.waitForSelector(".pane.focus .craft-ask");
  }
  await page.waitForSelector(".pane.focus .photo-data .photo-data-open");
}

/// Apre la nota col PDF delle scene `nota-pdf*` e aspetta la prima pagina
/// disegnata (`withPreview`) o il link.
async function openPdfNote(page, withPreview) {
  await fromTreeDrawer(page, () => openNote(page, "Casa/Affitto di via Roma.md"));
  if (withPreview) {
    // Lo slot dell'incorporamento ha già la sua didascalia: l'immagine ci
    // entra da sola, senza un `figure` suo.
    await page.waitForFunction(() => {
      const image = document.querySelector(".pane.focus img.craft-figure-page");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
  } else {
    await page.waitForSelector('.pane.focus [data-vault-media="loaded"] a.wikilink');
  }
  await page.mouse.move(0, 0);
}

/// Apre il PDF della scena `pdf-domanda` con un clic nell'albero e aspetta
/// la pagina disegnata e la riga della domanda.
async function openPdfQuestion(page) {
  await fromTreeDrawer(page, async () => {
    await openFolder(page, "Casa");
    await page.click('#file-list .tree-row[data-path="Casa/contratto-affitto.pdf"]');
    await page.waitForSelector('.pane.focus .sheet-notice[data-notice="craft_consent"]');
  });
  // La pagina è disegnata quando la riga di stato conta le pagine.
  await page.waitForFunction(() => {
    const pdf = document.querySelector(".pane.focus .media-pdf");
    return /\d/.test(pdf?.querySelector('[role="status"]')?.textContent ?? "")
      && (pdf?.querySelector(".media-pdf-page canvas")?.width ?? 0) > 0;
  });
  await page.mouse.move(0, 0);
}

/// Fa `open` con l'albero a portata: in una finestra stretta l'albero sta nel
/// cassetto, che si apre prima e si chiude dopo, come in `openRichDocument`.
async function fromTreeDrawer(page, open) {
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await open();
  if (compact && await page.isVisible("#sidebar-scrim")) {
    // Non sul bordo destro: lì il puntatore fa affacciare l'ispettore.
    const scrim = await page.locator("#sidebar-scrim").boundingBox();
    await page.click("#sidebar-scrim", { position: { x: scrim.width - 80, y: 8 } });
    await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
  }
}

/// Le miniature che l'albero delle scene `albero-*` mostra: il RAW girato, i
/// tre file Craft, il Word e il PDF.
const TREE_THUMBS = 6;

/// Apre le cartelle dell'albero delle scene `albero-*` e aspetta che tutte le
/// miniature siano dipinte. In una finestra stretta apre il cassetto e lo
/// lascia aperto: la scena è l'albero.
async function openThumbTree(page) {
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await openFolder(page, "Foto 2026");
  await openFolder(page, "Progetti");
  await page.waitForFunction((count) => {
    const thumbs = [...document.querySelectorAll("#file-list img.tree-thumb")];
    return thumbs.length === count && thumbs.every((img) => img.complete && img.naturalWidth > 0);
  }, TREE_THUMBS);
  await page.mouse.move(0, 0);
}

/// Apre il Word della scena `docx-due-righe`, lo presta a WordCraft dal menu
/// dell'albero e aspetta le due righe.
async function openLentDocx(page) {
  const path = "Documenti/relazione.docx";
  await fromTreeDrawer(page, async () => {
    await openFolder(page, "Documenti");
    await page.click(`#file-list .tree-row[data-path="${path}"]`);
    await page.waitForSelector(".pane.focus .rich-surface .ProseMirror");
    await page.click(`#file-list li[data-path="${path}"] > .tree-row`, { button: "right" });
    await page.click('#context-menu button:has-text("Organizza")');
    await page.click('.context-submenu button:has-text("Apri con un\'altra app")');
    await page.click('.context-submenu >> nth=1 >> button:has-text("WordCraft")');
    await page.waitForSelector('.pane.focus .sheet-notice[data-notice="lent"]');
  });
  await page.waitForSelector('.pane.focus .sheet-notice[data-notice="craft_consent"]');
  await page.mouse.move(0, 0);
}

/// Apre la cartella di Excel della scena `grid-workbook` e aspetta che la
/// griglia v2 abbia disegnato le sue celle.
async function openWorkbook(page) {
  await openFolder(page, "Dati");
  await page.click('#file-list .tree-row[data-path="Dati/Conti.xlsx"]');
  await page.waitForFunction(() => {
    const grid = document.querySelector(".grid-surface");
    return grid?.getAttribute("data-grid-protocol") === "v2"
      && (grid?.querySelectorAll('[role="gridcell"]').length ?? 0) > 0;
  });
  await gridAtRest(page);
}

/// Aspetta che la griglia stia ferma al suo posto. Le celle compaiono prima
/// della barra multifunzione, che la superficie carica con un `import()` e
/// che, quando arriva, spinge la griglia in giù di più di cento pixel: un
/// punto misurato prima (il bordo di un'intestazione, una cella) cade poi
/// sulla barra. Il puntatore resta così sopra un suo pulsante, e la scena
/// fotografa il suo tooltip invece del gesto che dichiara, o un gesto non
/// trova la griglia dove l'aveva vista.
async function gridAtRest(page) {
  await page.waitForSelector(".pane.focus .grid-ribbon");
  await page.evaluate(() => {
    delete window.__gridViewportBox;
  });
  await page.waitForFunction(
    () => {
      const box = document.querySelector(".pane.focus .grid-viewport")?.getBoundingClientRect();
      if (!box) return false;
      const now = `${box.x},${box.y},${box.width},${box.height}`;
      const before = window.__gridViewportBox;
      window.__gridViewportBox = now;
      return before === now;
    },
    null,
    { polling: 100 },
  );
}

/// Apre la cartella per le scene della barra dei fogli, col foglio largo
/// `width` px, oppure senza l'albero e l'ispettore (`"full"`, 1248 px nella
/// finestra `SHEET_FULL`) o quanto lascia il telefono (`"phone"`), e aspetta che la barra abbia raccolto i suoi foglietti.
async function openRibbon(page, width) {
  await openFromTree(page, "Dati/Conti.xlsx", '.pane.focus .grid-surface[data-grid-protocol="v2"] [role="gridcell"]');
  if (await page.isVisible('#toggle-inspector[aria-pressed="true"]')) {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="false"]');
  }
  const tree = '#rail .rail-btn[aria-label="L\'albero del vault"]';
  if (width === "full" && await page.isVisible(`${tree}[aria-pressed="true"]`)) {
    const before = await page.evaluate(() => document.querySelector(".pane.focus .pane-editor").getBoundingClientRect().width);
    await page.click(tree);
    await page.waitForFunction(
      (narrow) => document.querySelector(".pane.focus .pane-editor").getBoundingClientRect().width > narrow,
      before,
    );
  }
  await page.waitForSelector(".pane.focus .grid-ribbon .grid-ribbon-panel:not([hidden])");
  const sheet = await page.evaluate(() => document.querySelector(".pane.focus .pane-editor")?.getBoundingClientRect().width ?? 0);
  const expected = width === "full" ? 1248 : width;
  if (typeof expected === "number" && Math.round(sheet) !== expected) throw new Error(`il foglio è largo ${sheet} px, non ${expected}`);
  // La barra si raccoglie al fotogramma dopo la misura del foglio.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.focus('.pane.focus .grid-surface [role="gridcell"][aria-selected="true"], .pane.focus .grid-surface [role="grid"]');
}

/// Apre il menu «Comandi» della barra dei fogli e, se c'è, la strada di
/// sottomenu `path`, una voce dopo l'altra.
async function openCommands(page, path = []) {
  await page.click(".pane.focus .grid-ribbon-quick .grid-ribbon-button");
  await page.waitForSelector("#context-menu .menu-items [role^=menuitem]");
  for (const label of path) {
    const row = page.locator(".context-menu .menu-items [role^=menuitem]", { has: page.locator(".menu-label", { hasText: new RegExp(`^${label}$`) }) }).last();
    await row.click();
    await page.waitForSelector(`.context-submenu[aria-label="${label}"]`);
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/// Il centro di una cella della griglia, per riga e colonna da zero, quando
/// la cella sta ferma: la griglia si monta prima della barra multifunzione e
/// dell'avviso sopra di lei, che arrivano dopo e la spingono in giù. Un
/// punto preso prima cade sull'avviso, e il trascinamento diventa una
/// selezione del testo della pagina.
async function gridCellCenter(page, row, column) {
  const center = await page.waitForFunction(
    ([r, c]) => {
      const cell = document.querySelector(`.pane.focus .grid-cell[data-row="${r}"][data-column="${c}"]`);
      if (!cell) return null;
      const box = cell.getBoundingClientRect();
      const now = `${box.x},${box.y},${box.width},${box.height}`;
      const before = window.__gridCellBox;
      window.__gridCellBox = now;
      return before === now ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    },
    [row, column],
    { polling: 100 },
  );
  return center.jsonValue();
}

/// Sceglie una cella con un clic e ci scrive: la prima battuta la apre, e la
/// scena aspetta che il campo della cella abbia tutto il testo.
async function writeInCell(page, row, column, text) {
  const { x, y } = await gridCellCenter(page, row, column);
  await page.mouse.click(x, y);
  await page.waitForFunction(
    ([r, c]) => {
      const active = document.querySelector(".pane.focus .grid-cell.active");
      return active?.dataset.row === String(r) && active?.dataset.column === String(c);
    },
    [row, column],
  );
  await page.keyboard.type(text);
  await page.waitForFunction(
    (t) => {
      const host = document.querySelector(".pane.focus .grid-cell-editor");
      return host !== null && !host.hidden && host.querySelector(".cm-content")?.textContent === t;
    },
    text,
  );
}

/// Apre una cartella dell'albero, se non è già aperta. Il `data-path` della
/// cartella sta sul `treeitem` che contiene anche il sottoalbero; la riga è il
/// suo figlio diretto cliccabile.
async function openFolder(page, path) {
  const item = `#file-list li[role="treeitem"][data-path="${path}"]`;
  const row = `${item} > .tree-row.folder`;
  await page.waitForSelector(row);
  const open = await page.evaluate(
    (sel) => document.querySelector(sel)?.getAttribute("aria-expanded") === "true",
    item,
  );
  if (!open) await page.click(row);
}

/// Aspetta che il grafo abbia smesso di muoversi.
///
/// La simulazione si spegne da sola — l'alpha decade, la camera converge — ma
/// ci mette più della finestra in cui il fotografo verifica che la scena stia
/// ferma, e in mezzo c'è un **secondo inquadra** che riparte proprio quando la
/// prima quiete sembrava arrivata. Non si allunga l'attesa dello scatto: quella
/// è la misura che distingue «il tema è cambiato» da «questa scena si muove», e
/// allungarla vuol dire spegnerla. Si aspetta la condizione — due fotogrammi del
/// canvas identici — che è esattamente ciò che il fotografo pretenderà dopo.
async function waitForGraphToSettle(page) {
  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas.graph-main");
      if (!c) return false;
      const now = c.toDataURL();
      const first = window.__previousGraph;
      window.__previousGraph = now;
      return first === now;
    },
    null,
    { polling: 250, timeout: 30_000 },
  );
}

/// Il nome del file di una foto: scena e luce, che sono le due coordinate.
export function photoFilename(scene, light) {
  return `${scene.id}-${light}.png`;
}

/// Le pagine del banco, per il nome che una scena dichiara.
const PAGES = {
  catalog: "/bench/catalog.html",
  shell: "/index.html",
  kit: "/bench/kit.html",
  mobile: "/mobile.html",
  document: "/document.html",
};

/// L'indirizzo di una scena in una luce.
export function sceneUrl(base, scene, light) {
  const page = PAGES[scene.page ?? ""] ?? "/";
  const query = [`light=${light}`, scene.query].filter(Boolean).join("&");
  return `${base}${page}?${query}`;
}