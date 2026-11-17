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
/// Il catalogo del kit intero, fino alla barra in una fila e alla colonna.
const KIT_WINDOW = { width: 1280, height: 960 };
/// La finestra in cui, con l'albero aperto e l'ispettore chiuso, il foglio è
/// largo 700 px: la misura «700 px» del prototipo della barra dei fogli.
const SHEET_700 = { width: 1016, height: 800 };
/// La finestra in cui, senza l'albero e l'ispettore, il foglio è largo
/// 1248 px: la misura «piena» del prototipo.
const SHEET_FULL = { width: 1308, height: 800 };
/// La nota nella finestra minima del computer (`minWidth` e un'altezza da
/// prototipo): la misura «700 px» del prototipo di Scrittoio 2, che sul
/// computer non si può avere.
const NOTE_NARROW = { width: 800, height: 800 };
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
      await chooseMode(page, "reading");
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
  // **La barra della Base** (T15), su `Opere.base` di `bench/base-fixture.ts`:
  // le linguette delle viste, gli attrezzi, le etichette del filtro, i tre
  // pannelli e le righe che un gesto ha scritto nel file.
  {
    id: "base-barra",
    title: "Base: le viste come linguette, gli attrezzi e l'etichetta del filtro",
    query: "base=1",
    prepare: openBase,
  },
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
  // Il chip del motore del disegno (K5 T23, `?drawing=`, vedi `fake-ipc.ts`):
  // acceso con due parti che restano come sono, spento con «Accendi…», fermo
  // con «Riprova»; il chip premuto, col suo riquadro aperto (scene «2a», «3»
  // e «4» del prototipo `PLAN-ui/disegno-motore.html`, che resta nella storia
  // del ramo `piano/k5-disegno`, fino a 3d13d26e6).
  ...[
    ["draw-engine-on", "acceso", "Il disegno col motore acceso: due parti restano come sono, e «Che cosa manca?» aperto"],
    ["draw-engine-off", "spento", "Il disegno col motore spento: gli strumenti semplici, e «Accendi…»"],
    ["draw-engine-error", "errore", "Il disegno col motore fermo: gli strumenti semplici, e «Riprova»"],
  ].map(([id, drawing, title]) => ({
    id,
    title,
    query: `connectors=6&drawing=${drawing}`,
    prepare: (page) => openDrawingStanding(page, drawing === "acceso"),
  })),
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
  // **La lavagna** (T61): vuota, con le schede e con una scheda attiva, le
  // lavagne di `?lavagna=1` (vedi `fake-ipc.ts`). Le schede si raggiungono
  // col Tab, come le raggiunge chi usa la tastiera, e ognuna ha il suo nome.
  {
    id: "lavagna-vuota",
    title: "Una lavagna vuota: il Tab va al primo pulsante per cominciare",
    query: "lavagna=1",
    prepare: async (page) => {
      await openBoard(page, "Lavagne/Vuota.canvas");
      await page.keyboard.press("Tab");
      await page.waitForSelector(".pane.focus .canvas-blank button:focus");
    },
  },
  {
    id: "lavagna",
    title: "Una lavagna con un gruppo, quattro schede e tre fili, col fuoco su una scheda raggiunta col Tab",
    query: "lavagna=1",
    prepare: async (page) => {
      await openBoard(page, "Lavagne/Statistica.canvas");
      // Il gruppo, poi la prima scheda dentro.
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.waitForSelector('.pane.focus .canvas-node[data-node="varianza"][aria-label]:focus');
    },
  },
  {
    id: "lavagna-attiva",
    title: "La stessa lavagna con la scheda della nota attiva, entrata con Invio",
    query: "lavagna=1",
    prepare: async (page) => {
      await openBoard(page, "Lavagne/Statistica.canvas");
      for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
      await page.waitForSelector('.pane.focus .canvas-node[data-node="media"]:focus');
      await page.keyboard.press("Enter");
      await page.waitForSelector('.pane.focus .canvas-node[data-node="media"][data-card-active]');
    },
  },
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
      // La modalità del riquadro a fuoco si sceglie dalla banda.
      await openNote(page, "Guida/Sintassi di Fub.md");
      await chooseMode(page, "source");
      await runScrittoioCommand(page, "Dividi il riquadro a destra");
      await chooseMode(page, "live_preview");
      await runScrittoioCommand(page, "Dividi il riquadro a destra");
      await chooseMode(page, "reading");
      await page.waitForSelector('.pane[data-mode="source"] .pane-editor .cm-content');
      await page.waitForSelector('.pane[data-mode="live_preview"] .pane-editor .cm-content');
      await page.waitForSelector('.pane[data-mode="reading"] .pane-preview');
    },
  },
  // **Scrittoio 2** (il prototipo `PLAN-ui/scrittoio-2.html` resta nella storia
  // del ramo `piano/scrittoio-2`, fino a 480a538d9): gli stati del prototipo che
  // prima non avevano una foto. La nota è quella che il banco apre per prima;
  // la finestra «stretta» è la minima della finestra vera (800 px, come
  // `minWidth` di Tauri), lo stato a 700 px più vicino che il computer mostri.
  {
    id: "banda-modalita",
    title: "La nota col menu delle modalità aperto dalla banda",
    prepare: async (page) => {
      await page.waitForSelector(".pane.focus .pane-editor .cm-content");
      await page.click("#status-mode");
      await page.waitForSelector('#context-menu [role="menuitemradio"][aria-checked="true"]');
      await page.waitForSelector('#status-mode[aria-expanded="true"]');
    },
  },
  {
    id: "nota-stretta",
    title: "La nota nella finestra minima, 800 px: i cassetti ritirati, la banda intera",
    viewport: NOTE_NARROW,
    prepare: async (page) => {
      await page.waitForSelector("#layout.layout-compact");
      await page.waitForSelector(".pane.focus .pane-editor .cm-content");
    },
  },
  ...[
    ["barra-formato", "La nota con la barra di formato, sul computer"],
    ["barra-formato-stretta", "La barra di formato nella finestra minima, 800 px: ciò che non ci sta va in «…»", NOTE_NARROW],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    // `?formatbar=1` dà alla finestra principale i comandi di formato che
    // l'host finto dà solo al telefono: senza, le scene di oggi restano com'erano.
    query: "formatbar=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      // Il cursore nella prima voce dell'elenco, come il prototipo: la barra
      // dice premuto «Elenco puntato». La barra si monta coi comandi, che
      // arrivano dopo la nota: la scena aspetta i suoi pulsanti e lo stato.
      await page.click('.pane.focus .pane-editor .cm-content .cm-line:has-text("Un elenco corto")');
      await page.keyboard.press("End");
      await page.waitForSelector(".pane.focus .format-bar.kit-bar .kit-bar-button");
      await page.waitForSelector('.pane.focus .format-bar .kit-bar-button[aria-pressed="true"]');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
  })),
  ...[
    ["icone-figure", "Il selettore dell'icona su una cartella: le figure del vault", ""],
    ["icone-emoji", "Il selettore dell'icona su una cartella, col vault delle emoji", "icone=emoji"],
  ].map(([id, title, query]) => ({
    id,
    title,
    query,
    prepare: async (page) => {
      // Dalla strada vera: il tasto destro sulla cartella, poi «Organizza» e
      // «Icona…», con un clic ciascuno (il passaggio del puntatore apre il
      // sottomenu dopo una pausa, e l'orologio del banco è fermo). Il
      // selettore nasce dove si è cliccato col tasto destro, come nel prototipo.
      await page.click('#file-list li[data-path="Guida"] > .tree-row', { button: "right", position: { x: 40, y: 18 } });
      await page.click('#context-menu [role="menuitem"]:has-text("Organizza")');
      await page.click('.context-submenu [role="menuitem"]:has-text("Icona…")');
      await page.waitForSelector('#icon-picker .icon-grid--figures [data-icon^="fub:"]');
      await page.waitForSelector("#context-menu", { state: "detached" });
      await page.waitForSelector("#icon-picker input:focus");
    },
  })),
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
  // Scrittura a riposo (T3, E1, passo 1 del prototipo): la pagina mostra solo
  // ciò che si legge. Prima della foto la scena prova i livelli di presenza:
  // al passaggio maniglie e strumenti della testata compaiono senza spostare
  // il testo; a foglio fermo nessun elemento `data-presence` e nessun pulsante
  // che non sia contenuto si vede. Se no, la scena è rossa.
  {
    id: "scrittura-a-riposo",
    title: "Scrittura a riposo: testata, proprietà e testo, senza maniglie né pulsanti sul foglio",
    query: "live=pagina",
    prepare: (page) => writingAtRest(page),
  },
  // La riga dei suggerimenti (T14): al centro della banda, i tasti per ciò che
  // si sta facendo. Una parola scelta a 1280 px; un blocco scelto nella
  // finestra minima, dove la riga toglie dalla fine le voci che non ci stanno.
  // La riga cambia dopo una pausa: il banco aspetta il contesto, non un tempo.
  ...[
    ["riga-dei-suggerimenti", "La riga dei suggerimenti con una parola scelta: grassetto, corsivo, collega", "selection"],
    ["riga-dei-suggerimenti-stretta", "La riga dei suggerimenti coi blocchi scelti, nella finestra minima: le voci che non ci stanno se ne vanno intere", "blocks", NOTE_NARROW],
  ].map(([id, title, context, viewport]) => ({
    id,
    title,
    query: "live=riga-attiva",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector('#status-hints[data-context="text"]');
      if (context === "selection") {
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
      } else {
        await page.keyboard.press("Escape");
        await page.waitForSelector(".pane.focus .cm-fub-block-selected");
      }
      await page.waitForSelector(`#status-hints[data-context="${context}"] .status-hints-item`);
    },
  })),
  // La testata in Scrittura e in Lettura (T6, E3, riga «La testata» del
  // prototipo): copertina, icona, titolo, quattro proprietà in evidenza,
  // «Altre 2», «Aggiungi una proprietà» e la riga dei dati; la stessa in
  // Lettura, a 700 px e sul telefono; poi i casi che non vanno lisci.
  ...[
    ["testata-01-scrittura", "testata", "La testata in Scrittura: copertina, icona, titolo, proprietà in evidenza", "live_preview"],
    ["testata-02-lettura", "testata", "La stessa testata in Lettura: senza strumenti né «Aggiungi»", "reading"],
    ["testata-03-lettura-stretta", "testata", "La testata in Lettura nella finestra minima, 800 px", "reading", { width: 800, height: 800 }],
    ["testata-04-altre", "testata", "La testata con «Altre 2 proprietà» aperto", "live_preview", null, "more"],
    ["testata-05-vuota", "testata-vuota", "La testata di una nota senza frontmatter: il titolo e «Aggiungi una proprietà»", "live_preview"],
    ["testata-06-illeggibile", "testata-illeggibile", "La testata col frontmatter illeggibile: lo dice, e lo YAML resta sotto", "live_preview"],
    ["testata-07-senza-immagine", "testata-senza-immagine", "La testata con la copertina che non si trova", "reading"],
  ].map(([id, live, title, mode, viewport, gesture]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openHeader(page, mode, gesture),
  })),
  // Scrittura coi Blocchi: la stessa nota, con la maniglia del blocco sotto il
  // puntatore e quella del blocco del cursore; poi la selezione di blocchi e il
  // menu.
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
      await openLive(page, [], "top");
      await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles");
      // La testata della pagina arriva dopo che il cursore è stato portato in
      // vista: secondo chi vince, la nota resta in cima o scende di 78 px. Il
      // banco aspetta la testata e riparte dalla cima, ogni volta.
      await page.waitForSelector(".pane.focus .pane-editor .cm-fub-page-title");
      // Scrittura si apre già coi Blocchi, senza passare dal menu della banda:
      // il moto d'apertura della nota può essere ancora in corsa, e un gesto
      // di Playwright su un riquadro che si muove lo fa scorrere per portarlo
      // in vista. Si parte a scena ferma, come per il «/».
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await page.evaluate(() => { document.querySelector(".pane.focus .pane-editor .cm-scroller").scrollTop = 0; });
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
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-selected");
      } else {
        await page.click(".pane.focus .pane-editor .cm-fub-block-grip");
        await page.waitForSelector("#context-menu");
      }
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
    // Il puntatore è l'ultimo gesto: `prepareScene` lo porta via prima.
    ...(gesture === "hover" ? {
      hover: async (page) => {
        await page.hover(".pane.focus .pane-editor .cm-content .cm-line:has-text('Cose da fare')");
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles[data-active=\"true\"]");
      },
    } : {}),
  })),
  // I diagrammi (E26): a riposo e al passaggio soltanto il disegno, nessun
  // controllo dentro la cornice; il menu del tasto destro; i cinque stili;
  // uno stile che non esiste e un errore. Se dentro un diagramma c'è un
  // pulsante, la scena è rossa.
  ...[
    ["diagramma-01-riposo", "diagramma", "Un diagramma in Scrittura, a riposo: soltanto il disegno, sulla pagina"],
    ["diagramma-02-passaggio", "diagramma", "Col puntatore sul diagramma: nessun controllo dentro la cornice", "hover"],
    ["diagramma-03-menu", "diagramma", "Il menu del tasto destro: stile, «Vale per», orientamento, azioni", "menu"],
    ["diagramma-04-menu-stretta", "diagramma", "Il menu del tasto destro nella finestra minima", "menu", { width: 800, height: 800 }],
    ["diagramma-05-stili", "diagramma-stili", "I cinque stili, uno per diagramma: Armonia sulla pagina, gli altri sulla loro carta"],
    ["diagramma-06-casi", "diagramma-casi", "Uno stile che non esiste (vale quello generale) e un diagramma con un errore"],
  ].map(([id, live, title, gesture, viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForFunction(() => {
        const all = [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram")];
        return all.length > 0 && all.every((figure) => figure.dataset.state !== "loading");
      });
      // Mermaid scrive `style="font-family: …"` sul `<div>` dove misura
      // (`appendDivSvgG`), e la CSP lo rifiuta: succede a ogni disegno, da
      // prima di queste scene, dentro il contenitore fuori vista che
      // `ui/mermaid.ts` toglie subito. Quelle violazioni si tolgono dal conto;
      // ogni altra resta.
      await page.evaluate(() => {
        const found = globalThis.__fubCsp;
        for (let i = found.length - 1; i >= 0; i--) {
          if (found[i].directive === "style-src-attr" && found[i].blocked === "inline") found.splice(i, 1);
        }
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // Il sorgente di un diagramma disegnato è nascosto, col suo «Copia»:
      // conta ciò che si vede. Con un errore il sorgente c'è, ed è suo.
      const controls = await page.evaluate(() => [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram:not([data-state='error']) :is(button, figcaption)")]
        .filter((node) => node.getClientRects().length > 0).length);
      if (controls > 0) throw new Error(`un diagramma ha ${controls} controlli dentro la cornice`);
      if (gesture !== "menu") return;
      const box = await page.locator(".pane.focus .pane-editor .mermaid-diagram img").first().boundingBox();
      if (!box) throw new Error("il diagramma non ha un disegno");
      await page.mouse.click(box.x + box.width / 2, box.y + 24, { button: "right" });
      await page.waitForSelector(".diagram-menu");
      await page.waitForFunction(() => document.getAnimations().length === 0);
    },
    ...(gesture === "hover" ? {
      hover: async (page) => {
        await page.hover(".pane.focus .pane-editor .mermaid-diagram img");
        const controls = await page.evaluate(() => [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram *")]
          .filter((node) => node.matches("button, [role='button'], [role='toolbar']") && node.getClientRects().length > 0).length);
        if (controls > 0) throw new Error(`al passaggio il diagramma mostra ${controls} controlli`);
      },
    } : {}),
  })),
  // I commenti (T22): il segno nel margine con le iniziali e il numero dei
  // messaggi, la discussione aperta, il primo messaggio che chiede il nome, il
  // segno nel testo nella finestra minima, la Lettura e il pannello «Commenti».
  ...[
    ["commenti-01-margine", "commenti", "I commenti in Scrittura: il segno nel margine, l'archivio in fondo non si vede", "live_preview"],
    ["commenti-02-discussione", "commenti", "La discussione aperta dal segno: citazione, messaggi, risposta, Risolvi, Elimina", "live_preview", null, "open"],
    ["commenti-03-primo", "commenti-scelta", "Il primo messaggio: la citazione, il nome che si chiede e l'avviso che finisce nel file", "live_preview", null, "compose"],
    ["commenti-04-stretta", "commenti", "Nella finestra minima, 800 px (il foglio di 700 del prototipo): il segno sta nel testo", "live_preview", NOTE_NARROW],
    ["commenti-05-stretta-discussione", "commenti", "Nella finestra minima la discussione aperta dal segno nel testo", "live_preview", NOTE_NARROW, "open"],
    ["commenti-06-lettura", "commenti", "I commenti in Lettura: il segno nel margine, l'archivio non occupa posto", "reading"],
    ["commenti-07-pannello", "commenti", "Il pannello «Commenti»: gli aperti, poi i risolti con «Svuota i risolti»", "live_preview", null, "panel"],
  ].map(([id, live, title, mode, viewport, gesture]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openComments(page, mode, gesture),
  })),
  // Il menu «/» (N12, T84) su una riga vuota della Live, coi comandi veri di
  // `fub.formatting`: aperto, filtrato, un comando rapido, niente trovato, i
  // passi di tabella, colore e data, poi la finestra minima e il foglio.
  ...[
    ["slash-01-aperto", "Il menu «/» appena aperto: una colonna, le sei tessere dei più usati con la prima accesa, i gruppi e il disegno in fondo", ["/"]],
    ["slash-02-filtro", "Il menu «/» filtrato da «tit»: un elenco solo, la parte trovata in evidenza, «Cerca fra tutti i comandi» in fondo", ["/tit"]],
    ["slash-03-rapido", "Il menu «/» con un comando rapido: «/tab 3x4»", ["/tab 3x4"]],
    ["slash-04-nessuno", "Il menu «/» senza risultati: lo dice, e Invio cerca fra tutti i comandi", ["/qwerty"]],
    ["slash-05-tabella", "Il passo della tabella, allargato a 3 × 4", ["/tabella", "@Enter", "@ArrowRight"]],
    ["slash-06-colore", "Il passo del colore: il testo e il fondo, coi nomi", ["/colore", "@Enter"]],
    ["slash-07-data", "Il passo della data: i giorni a portata e il calendario", ["/data", "@Enter"]],
    ["slash-08-stretta", "Il menu «/» nella finestra minima, scesi nelle righe: il titolo del gruppo resta in cima", ["/", "@ArrowDown", "@Tab", "@Tab"], { width: 800, height: 800 }],
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
      // Poi due fotogrammi, perché il pannello si posi.
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
    title: "Il lanciatore: i comandi a una riga, con la scorciatoia, e l'anteprima di quello attivo",
    prepare: async (page) => {
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", ">");
      await page.waitForSelector(".launcher-row-meta[data-mono]");
      await page.waitForSelector(".launcher-preview-card:not([hidden])");
      await page.waitForSelector('.status-hints[data-context="launcher"]');
    },
  },
  {
    id: "launcher-recent",
    title: "Il lanciatore a campo vuoto: le recenti e i comandi della nota, i tasti nella banda",
    prepare: async (page) => {
      // Aperto dalla pillola, che si allarga sul posto: niente da scrivere.
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.waitForSelector('.launcher-group:has-text("Recenti")');
      await previewShowsActiveRow(page);
      await page.waitForSelector('.status-hints[data-context="launcher"]');
    },
  },
  {
    id: "launcher-blocks",
    title: "Il lanciatore sui blocchi: la sintassi a destra, e l'anteprima del blocco attivo",
    // I blocchi sono quelli che il «/» della nota aperta sa inserire: serve una
    // nota di testo in Scrittura, col cursore dentro, e le voci del «/» (`slash=1`).
    query: "live=riga-attiva&slash=1",
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", "/tab");
      await page.waitForSelector('.launcher-row:has-text("Tabella")');
      await page.waitForSelector('.launcher-preview-card:not([hidden]) + .launcher-preview-meta .launcher-preview-key');
      await page.waitForSelector('.status-hints[data-context="launcher"]');
    },
  },
  {
    id: "launcher-narrow",
    title: "Il lanciatore nella finestra minima, 800 px (i 700 del prototipo), con un prefisso: l'anteprima non c'è, l'elenco prende il posto",
    viewport: NOTE_NARROW,
    prepare: async (page) => {
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", ">pass");
      await page.waitForSelector('.launcher-row:has-text("Passa a")');
      await page.waitForSelector('.status-hints[data-context="launcher"]');
    },
  },
  {
    id: "launcher-search",
    title: "Il lanciatore: la ricerca nel testo, come gruppo di Tutto",
    prepare: async (page) => {
      // Tutto non ha prefisso: scrivere e basta cerca anche nel testo, e i
      // riscontri stanno nell'elenco di Tutto. Prima il gruppo dei nomi («Nota
      // lunga»), poi quello «Nel testo», dove sta la nota che si aspetta.
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", SEARCH);
      await page.waitForSelector(".launcher-group");
      await page.waitForSelector('.launcher-row:has-text("Il banco che vede")');
    },
  },
  {
    id: "launcher-actions",
    title: "Il lanciatore: le azioni della nota (Tab), con l'anteprima che resta",
    prepare: async (page) => {
      // La riga da agire è quella della nota che il banco sa rendere per
      // intero: le frecce la portano lì, poi Tab mostra le azioni.
      await page.click("#pill");
      await page.waitForSelector(".launcher-input:focus");
      await page.fill(".launcher-input", "fub");
      const row = '.launcher-row:has-text("Sintassi di Fub")';
      await page.waitForSelector(row);
      while (!(await page.$eval(row, (each) => each.getAttribute("aria-selected") === "true"))) {
        await page.keyboard.press("ArrowDown");
      }
      await previewShowsActiveRow(page);
      await page.keyboard.press("Tab");
      await page.waitForSelector('.launcher-group:has-text("Azioni su")');
      await page.waitForSelector('.launcher-row:has-text("Apri a lato")');
      // Con le azioni aperte la riga attiva è un'azione: l'anteprima resta
      // sulla nota che si agisce, e aspetta la sua resa.
      await page.waitForFunction(() => {
        const preview = document.querySelector(".launcher-preview");
        if (!preview || preview.hidden) return true;
        const shown = preview.querySelector(".launcher-preview-page")?.textContent ?? "";
        return !preview.hasAttribute("data-waiting") && shown.includes("Sintassi di Fub");
      });
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
      viewport: KIT_WINDOW,
      prepare: async () => {},
    },
    {
      id: "kit-lingua",
      title: "Il kit: la lingua dei menu, righe, tessere ed etichette nei loro stati",
      query: "lingua",
      viewport: KIT_WINDOW,
      prepare: async (page) => {
        // La sezione sta in fondo alla colonna di destra: la si porta in cima.
        await page.evaluate(() => {
          const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent === "La lingua dei menu");
          if (!heading) throw new Error("manca la sezione «La lingua dei menu»");
          heading.closest("section").scrollIntoView({ block: "start" });
        });
      },
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
      viewport: KIT_WINDOW,
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
    // La testata della pagina (T6) sul telefono: la copertina bassa, le
    // colonne delle proprietà strette.
    {
      id: "mobile-testata",
      title: "Il telefono: la testata in Scrittura, con la copertina bassa e le colonne strette",
      query: "live=testata",
      viewport: PHONE,
      prepare: (page) => openHeader(page, "live_preview"),
    },
    // I commenti (T22) sul telefono: il segno sta nel testo, e la discussione
    // si apre larga quanto la vista.
    {
      id: "mobile-commenti",
      title: "Il telefono: i commenti con il segno nel testo",
      query: "live=commenti",
      viewport: PHONE,
      prepare: (page) => openComments(page, "live_preview"),
    },
    {
      id: "mobile-commenti-discussione",
      title: "Il telefono: la discussione di un commento",
      query: "live=commenti",
      viewport: PHONE,
      prepare: (page) => openComments(page, "live_preview", "open"),
    },
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
        // Il documento si scrive tutto: «Si scrive» sta in «…», e la testata
        // non lo mostra (`shells/scrittoio/mobile/mobile.css`). Gli altri
        // stati sì: il pallino resta il chip di 24 px del computer, non un
        // cerchio di 44, e si tocca lo stesso 10 px sopra e sotto il suo
        // centro (`shells/mobile/mobile.css`, PA T47). Lo si misura come
        // «parti chiuse», per lo spazio di una misura sola: nello stesso giro
        // il tipo torna quello vero, e la foto non lo vede.
        await page.waitForFunction(() => {
          const chip = document.querySelector(".pane.focus .pane-toolbar .pane-standing-chip");
          const standing = chip?.parentElement;
          if (!(chip instanceof HTMLElement) || !(standing instanceof HTMLElement) || standing.hidden) return false;
          if (standing.dataset.standing !== "writes" || chip.getClientRects().length !== 0) return false;
          const measure = () => {
            if (chip.getClientRects().length === 0) return false;
            const r = chip.getBoundingClientRect();
            if (r.height > 24.5 || r.width >= 44) return false;
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            // Il suo tocco non copre il bottone della modalità.
            const mode = document.querySelector(".pane.focus > .pane-mode-current");
            const m = mode?.getBoundingClientRect();
            const modeFree = !m || m.width === 0
              || document.elementFromPoint(m.left + 1, m.top + m.height / 2)?.closest(".pane-mode-current") === mode;
            return modeFree
              && document.elementFromPoint(x, y - 10)?.closest(".pane-standing-chip") === chip
              && document.elementFromPoint(x, y + 10)?.closest(".pane-standing-chip") === chip;
          };
          standing.dataset.standing = "closed";
          try {
            return measure();
          } finally {
            standing.dataset.standing = "writes";
          }
        }, null, { timeout: 5_000 });
        // Il fuoco della tastiera sul bottone della modalità: dal menu «…»
        // un passo avanti (il documento non ha la barra di formato), così
        // l'anello è quello di `:focus-visible`. Il bottone è il tondo sulla
        // carta: l'anello sta dentro il suo rettangolo, cioè lo scarto è
        // negativo e largo almeno quanto la linea (`shells/mobile/mobile.css`,
        // PA T47).
        await page.focus(".pane.focus [data-pane-menu]");
        await page.keyboard.press("Tab");
        await page.waitForFunction(() => {
          const mode = document.activeElement;
          if (!(mode instanceof HTMLElement) || !mode.matches(".pane.focus .pane-mode-current:focus-visible")) return false;
          const style = getComputedStyle(mode);
          const width = parseFloat(style.outlineWidth);
          const offset = parseFloat(style.outlineOffset);
          return style.outlineStyle !== "none" && width > 0 && offset < 0 && -offset >= width;
        }, null, { timeout: 5_000 });
        // Col fuoco della tastiera la didascalia del bottone arriva dopo 500 ms
        // di timer vero (`ui/tooltip.ts`): la si aspetta, perché è lo stato
        // vero del fuoco e una foto scattata prima la prenderebbe o no (#461).
        await page.waitForSelector(".shell-tooltip:not([hidden])");
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
    // Il calendario della Base in piedi (T17): una colonna di giorni, col nome
    // del giorno accanto al numero.
    {
      id: "mobile-base-calendario",
      title: "Il telefono: il calendario della Base in una colonna di giorni",
      query: "base=calendario",
      viewport: PHONE,
      prepare: openCalendar,
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
        // Il puntatore lascia l'interruttore: il suo tooltip arriva dopo 500 ms
        // di timer vero, e la foto lo prenderebbe o no (#459).
        await page.mouse.move(0, 0);
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
      id: "mobile-launcher-commands",
      title: "Il telefono: il lanciatore col prefisso dei comandi, la scorciatoia a destra e nessuna anteprima",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click("#pill");
        await page.waitForSelector(".launcher-input:focus");
        await page.fill(".launcher-input", ">");
        await page.waitForSelector(".launcher-row-meta[data-mono]");
      },
    },
    {
      id: "mobile-keyboard",
      title: "Il telefono: la tastiera su, la barra di formattazione sopra i tasti",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click(".pane.focus .pane-editor .cm-content");
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
  // In una finestra stretta l'anteprima non c'è (`previewFits`): basta la riga
  // attiva. Aspettare una resa che non arriverà fermerebbe la scena.
  await page.waitForFunction(() => {
    const input = document.querySelector(".launcher-input");
    const id = input?.getAttribute("aria-activedescendant");
    const title = id ? document.getElementById(id)?.querySelector(".launcher-row-title")?.textContent?.trim() : "";
    const preview = document.querySelector(".launcher-preview");
    if (!preview || preview.hidden) return Boolean(title);
    const shown = preview.querySelector(".launcher-preview-page")?.textContent ?? "";
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

/// Il nome delle modalità nel menu, in italiano come il banco.
const MODE_LABELS = { live_preview: "Scrittura", source: "Sorgente", reading: "Lettura" };

/// Sceglie la modalità del riquadro a fuoco come la persona (Scrittoio 2, T3):
/// dalla voce della banda, e dove la banda non c'è (il telefono) dal tondo del
/// foglio; poi la voce del menu col suo nome. I segmenti della testata restano
/// nel DOM ma non si vedono, e Playwright non clicca ciò che non si vede.
export async function chooseMode(page, mode, label = MODE_LABELS[mode]) {
  if (await page.isVisible(`.pane.focus[data-mode="${mode}"]`)) return;
  if (await page.isVisible("#status-mode")) await page.click("#status-mode");
  else await page.click(".pane.focus > .pane-mode-current");
  await page.click(`#context-menu [role="menuitemradio"]:has-text("${label}")`);
  await page.waitForSelector(`.pane.focus[data-mode="${mode}"]`);
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
  // In una finestra stretta l'albero sta nel cassetto, come in
  // `openRichDocument`; la modalità la sceglie `chooseMode`.
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await openNote(page, doc);
  if (compact) await closeSidebarDrawer(page);
  await chooseMode(page, mode);
  await page.waitForSelector(`.pane.focus[data-mode="${mode}"] .pane-editor .cm-content`);
  await page.evaluate(async (bottom) => {
    // La vista si prende dal modulo del pacchetto testuale, lo stesso che la
    // shell ha già caricato: il banco non tocca CodeMirror da sé.
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const pane = document.querySelector(".pane.focus .pane-editor .cm-editor")?.parentElement;
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

/// La nota dei commenti (T22) in `mode`, poi il gesto: `open` apre la
/// discussione del primo segno, `compose` il primo messaggio sulla selezione
/// del caso (Ctrl Alt M), `panel` il pannello «Commenti» dell'ispettore.
async function openComments(page, mode, gesture) {
  const compose = gesture === "compose";
  await openLive(page, [], "top", mode === "reading" ? "live_preview" : mode);
  if (mode === "reading") await chooseMode(page, "reading");
  const where = mode === "reading" ? '.pane.focus[data-mode="reading"] .markdown-rendered' : ".pane.focus .cm-editor";
  if (!compose) {
    await page.waitForSelector(`${where} :is(.cm-fub-comment-bubble, .cm-fub-comment-sign)`);
    await page.waitForFunction(() => document.getAnimations().length === 0);
  }
  if (gesture === "open") {
    await page.click(`${where} :is(.cm-fub-comment-bubble, .cm-fub-comment-sign) >> nth=0`);
    await page.waitForSelector(".cm-fub-comment-popover .cm-fub-comment-message");
  } else if (compose) {
    await page.keyboard.press("Control+Alt+m");
    await page.waitForSelector(".cm-fub-comment-popover .cm-fub-comment-composer");
  } else if (gesture === "panel") {
    const panel = '.surface-panel[data-view-id="markdown.comments"]';
    await page.waitForSelector(panel, { state: "attached" });
    if (!(await page.isVisible(panel))) {
      await page.evaluate(async () => {
        const { selectInspectorTab } = await import("/src/ui/views.ts");
        selectInspectorTab("markdown.comments");
      });
    }
    await page.waitForSelector(`${panel} .cm-fub-comments-card`);
  }
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// La testata (T6) a riposo, in `mode`: la nota dall'alto, nessun fuoco, il
/// puntatore fuori. `more` apre prima «Altre N proprietà».
async function openHeader(page, mode, gesture) {
  await openLive(page, [], "top");
  // Sul telefono, chiuso il cassetto dei file, l'ispettore sale dal basso
  // finché il fuoco non entra nel foglio: la testata a riposo non ha fuoco,
  // e il cassetto si chiude dal suo velo.
  if (await page.isVisible("#inspector-scrim")) {
    const scrim = await page.locator("#inspector-scrim").boundingBox();
    await page.click("#inspector-scrim", { position: { x: scrim.width - 8, y: 8 } });
    await page.waitForSelector("#inspector-scrim", { state: "hidden" });
  }
  if (mode === "reading") await chooseMode(page, "reading");
  const pane = mode === "reading" ? '.pane.focus[data-mode="reading"] .pane-editor .markdown-rendered' : ".pane.focus .pane-editor .cm-content";
  await page.waitForSelector(`${pane} .cm-fub-page .cm-fub-page-title`);
  if (gesture === "more") {
    await page.click(`${pane} .cm-fub-page-props-more`);
    await page.waitForSelector(`${pane} .cm-fub-page-props-more[aria-expanded="true"]`);
  }
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    for (const scroller of document.querySelectorAll(".pane.focus .pane-editor .cm-scroller, .pane.focus .pane-editor .markdown-rendered")) scroller.scrollTop = 0;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// Scrittura a riposo (T3): apre la nota con la testata, prova che ciò che
/// compare al passaggio non sposta il testo, poi ferma il foglio (puntatore
/// fuori, nessun fuoco) e pretende che non si veda niente di ciò che compare
/// al passaggio o a richiesta (`data-presence`), né un pulsante che non sia
/// contenuto. Lancia, con l'elenco di ciò che si vede, se una delle due
/// regole cade.
async function writingAtRest(page) {
  await openLive(page, [], "top");
  await page.waitForSelector(".pane.focus .pane-editor .cm-fub-page-title");
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Le posizioni del testo rispetto al contenuto, non alla finestra: il
  // passaggio può far scorrere la nota, e lo scorrimento non è uno spostamento.
  const textBoxes = () => page.evaluate(() => {
    const content = document.querySelector(".pane.focus .pane-editor .cm-scroller > .cm-content");
    const origin = content.getBoundingClientRect();
    return [...content.querySelectorAll(":scope > .cm-line, .cm-fub-page-title, .note-facts")].slice(0, 24).map((el) => {
      const box = el.getBoundingClientRect();
      return `${Math.round(box.left - origin.left)},${Math.round(box.top - origin.top)}`;
    });
  });
  await frames();
  const before = await textBoxes();
  await page.hover(".pane.focus .pane-editor .cm-content .cm-line:has-text('Cose da fare')");
  await page.waitForSelector('.pane.focus .pane-editor .cm-fub-block-handles[data-active="true"]');
  await page.hover(".pane.focus .pane-editor .cm-fub-page-title");
  await page.waitForFunction(() => {
    const tools = document.querySelector(".pane.focus .pane-editor .cm-fub-page-tools");
    return tools !== null && Number(getComputedStyle(tools).opacity) > 0.95;
  });
  await frames();
  const during = await textBoxes();
  if (during.join(" ") !== before.join(" ")) {
    throw new Error(`al passaggio il testo si è spostato: ${before.join(" ")} → ${during.join(" ")}`);
  }
  // Il foglio fermo: il puntatore fuori, nessun fuoco, la nota dall'alto.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.querySelector(".pane.focus .pane-editor .cm-scroller").scrollTop = 0;
  });
  // Una funzione sola, che il browser esegue per aspettare (`empty`) e poi per
  // dire che cosa resta. Si passa come funzione, non come testo: un predicato
  // scritto come stringa Playwright lo valuta con `eval`, e la CSP del banco
  // (quella dell'app, senza `'unsafe-eval'`) lo rifiuta.
  const seen = function visibleAtRest(empty) {
    const shown = (el) => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (node.hidden) return false;
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
      }
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const sheet = document.querySelector(".pane.focus .pane-editor .cm-editor");
    const name = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
    // I pulsanti che sono contenuto, a riposo anche nel prototipo: l'icona
    // della pagina, la riga dei dati e la testata di un blocco di codice
    // (lingua, «A capo», «Copia»).
    const content = ".cm-fub-page-icon, .cm-fub-page-props button, .cm-fub-page-props button *, .note-facts *, .cm-fub-code-header button";
    const left = [
      ...[...sheet.querySelectorAll("[data-presence]")].filter(shown).map((el) => `${name(el)}[${el.dataset.presence}]`),
      ...[...sheet.querySelectorAll("button, [role=button]")].filter((el) => !el.closest("[data-presence]") && !el.matches(content) && shown(el)).map(name),
    ];
    return empty ? left.length === 0 : left;
  };
  try {
    await page.waitForFunction(seen, true, { timeout: 5_000 });
  } catch {
    const left = await page.evaluate(seen, false);
    throw new Error(`a riposo si vede ancora: ${left.join(", ")}`);
  }
  await frames();
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
  await page.waitForFunction(() => !document.querySelector('.pane.focus .pane-editor .cm-content [data-state="loading"]'));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (!bottom) {
    await page.evaluate(async () => {
      if (globalThis.__fubLiveBench.cursor === null) return;
      const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
      const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
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
  if (compact) await closeSidebarDrawer(page);
}

/// Apre la lavagna `path` dall'albero e dà il fuoco alla lavagna, come un clic
/// nel vuoto: da lì parte il Tab delle scene `lavagna-*`.
async function openBoard(page, path) {
  await openFromTree(page, path, ".pane.focus .canvas-viewport");
  await page.waitForFunction(
    () => document.querySelector(".pane.focus .canvas-viewport")?.dataset.canvasProtocol !== undefined
      || document.querySelector(".pane.focus .canvas-blank:not([hidden])") !== null,
  );
  await page.focus(".pane.focus .canvas-viewport");
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
  if (compact) await closeSidebarDrawer(page);
  const objects = fixture.shapes.length + fixture.connectors.length + fixture.labels.length;
  await page.waitForFunction(
    (painted) => (document.querySelector(".draw-editor .draw-surface")?.querySelectorAll("[data-scene-id]").length ?? 0) >= painted,
    objects,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.focus(".draw-editor .draw-surface");
}

/// Apre il disegno dei connettori e preme il chip del disegno, che arriva
/// quando il motore ha risposto; con `ask` apre anche «Che cosa manca?». Il
/// fuoco resta nel riquadro, sull'ultimo pulsante premuto.
async function openDrawingStanding(page, ask) {
  await openDrawing(page);
  const chip = ".pane.focus .pane-toolbar .pane-standing:not([hidden]) .pane-standing-chip";
  await page.waitForSelector(chip);
  await page.click(chip);
  await page.waitForSelector(".pane-standing-panel .pane-standing-title");
  if (ask) {
    await page.click(".pane-standing-panel .pane-standing-ask");
    await page.waitForSelector(".pane-standing-panel .pane-standing-places");
  }
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
  if (!compact) return;
  // Un documento scelto nell'albero chiude il cassetto da sé: il velo che sta
  // uscendo non si clicca (`closeSidebarDrawer`).
  if (await sidebarDrawerOpen(page)) {
    // Non sul bordo destro: lì il puntatore fa affacciare l'ispettore.
    const scrim = await page.locator("#sidebar-scrim").boundingBox();
    await page.click("#sidebar-scrim", { position: { x: scrim.width - 80, y: 8 } });
  }
  await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
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

/// Apre la Scrivania dal binario e aspetta i suoi riquadri (o il vuoto).
async function openDesk(page) {
  await page.click('#views-ribbon .rail-btn-main[data-panel="desk"]');
  await page.waitForSelector('.pane-view[data-view-id="desk"] :is(.desk-commands, .ui-empty-state)');
  await page.mouse.move(0, 0);
}

/// Apre `Opere.base` delle scene `base-*` e aspetta la tabella con le sue
/// righe e la barra ferma. Dalla porta della shell e non dall'albero: il
/// finto elenca un `.base` come file, e l'albero non lo apre.
async function openBase(page) {
  await page.evaluate(async () => {
    const { openDocument } = await import("/src/state/document-controller.ts");
    await openDocument("Opere.base");
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".pane.focus");
    return (pane?.querySelectorAll(".base-table tbody tr").length ?? 0) > 0
      && pane?.querySelector(".base-tab[aria-pressed='true']") !== null
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
  });
}

/// Apre il calendario di `?base=calendario` e aspetta il mese con le sue note.
async function openCalendar(page) {
  await page.evaluate(async () => {
    const { openDocument } = await import("/src/state/document-controller.ts");
    await openDocument("Opere.base");
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".pane.focus");
    return (pane?.querySelectorAll(".base-cal-event").length ?? 0) > 0
      && pane?.querySelector(".base-tab[aria-pressed='true']") !== null
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
  });
}

/// Sceglie dal menu della colonna `column` il riepilogo `label` e aspetta che
/// il piede lo mostri.
async function chooseBaseSummary(page, column, label) {
  await page.click(`.pane.focus th[data-column="${column}"] .base-head`);
  await page.waitForSelector("#context-menu .menu-head");
  await page.hover('#context-menu button:has(.menu-label:text-is("Riepilogo"))');
  await page.click(`.context-submenu button:has(.menu-label:text-is("${label}"))`);
  await page.waitForFunction((column) => {
    const pane = document.querySelector(".pane.focus");
    return pane?.querySelector(`tfoot td[data-column="${column}"] .base-foot-value`) !== null
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
  }, column);
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

/// Sceglie la parola «nota» della prima riga e apre il suo menu: col tasto
/// destro sopra la parola, o dalla tastiera (Maiusc+F10), che parte dalla
/// prima voce.
async function selectWordAndOpen(page, { keyboard = false } = {}) {
  const word = page.locator(".pane.focus .pane-editor .cm-content .cm-line >> text=/Questa è la nota/").first();
  await word.waitFor();
  const box = await word.boundingBox();
  // «Questa è la »: la parola «nota» sta dopo i primi dodici caratteri.
  const x = box.x + (await word.evaluate((line) => {
    const range = document.createRange();
    const text = line.firstChild?.nodeType === Node.TEXT_NODE ? line.firstChild : line.querySelector("*")?.firstChild ?? line.firstChild;
    const at = text.textContent.indexOf("nota");
    range.setStart(text, at);
    range.setEnd(text, at + 2);
    const rect = range.getBoundingClientRect();
    return rect.right - line.getBoundingClientRect().left;
  }));
  const y = box.y + Math.min(box.height / 2, 10);
  await page.mouse.dblclick(x, y);
  if (keyboard) await page.keyboard.press("Shift+F10");
  else await page.mouse.click(x, y, { button: "right" });
  await page.waitForSelector("#context-menu .menu-clipboard");
}

/// Preme `key` finché `done` non dice di sì, al più dodici volte.
async function pressUntil(page, key, done) {
  for (let tries = 0; tries < 12 && !(await page.evaluate(done)); tries++) await page.keyboard.press(key);
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

/// Richiude il cassetto dell'albero con un clic sul velo, come la persona.
///
/// Il clic va in alto, perché su un telefono il cassetto sale dal basso, e
/// fuori dal cassetto, che in una finestra stretta copre il lato sinistro. Ma
/// non sul bordo destro: lì c'è la striscia da cui l'ispettore chiuso si
/// affaccia (`frame/peek.ts`), e il puntatore che resta fermo su di lei dopo
/// il clic lo fa comparire sopra la nota, come per chi ci sosta davvero. Il
/// punto lo sceglie `scrimClickPoint`, lontano da tutti e due.
///
/// Un documento scelto nell'albero chiude il cassetto da sé
/// (`dismissSidePanel`): allora il velo sta già uscendo, non prende più i clic
/// e non va cliccato. Si aspetta solo che finisca.
async function closeSidebarDrawer(page) {
  if (await sidebarDrawerOpen(page)) await clickSidebarScrim(page);
  await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
}

/// Il cassetto dell'albero è aperto: lo dice la classe del layout, non il velo,
/// che resta visibile per tutta la sua uscita.
function sidebarDrawerOpen(page) {
  return page.evaluate(() => document.getElementById("layout")?.classList.contains("drawer-sidebar-open") ?? false);
}

async function clickSidebarScrim(page) {
  const scrim = await page.locator("#sidebar-scrim").boundingBox();
  const avoid = await page.evaluate(() =>
    [document.getElementById("sidebar"), ...document.querySelectorAll(".drawer-edge")]
      .map((el) => el?.getBoundingClientRect())
      .filter((box) => box && box.width > 0 && box.height > 0)
      .map(({ x, y, width, height }) => ({ x, y, width, height })),
  );
  await page.click("#sidebar-scrim", { position: scrimClickPoint(scrim, avoid) });
}

/// Dove cliccare il velo, in coordinate del velo: sulla riga a `top` px
/// dall'alto, al centro del tratto libero più largo fra le scatole da evitare
/// che la attraversano. Lancia se la riga è tutta coperta: un clic a caso
/// fotograferebbe un altro stato senza dirlo.
export function scrimClickPoint(scrim, avoid, top = 8) {
  const row = scrim.y + top;
  const end = scrim.x + scrim.width;
  const covered = avoid
    .filter((box) => box.y <= row && row < box.y + box.height)
    .map((box) => [Math.max(box.x, scrim.x), Math.min(box.x + box.width, end)])
    .filter(([from, to]) => from < to)
    .sort((a, b) => a[0] - b[0]);
  let best = null;
  let cursor = scrim.x;
  for (const [from, to] of [...covered, [end, end]]) {
    if (from > cursor && (best === null || from - cursor > best[1] - best[0])) best = [cursor, from];
    cursor = Math.max(cursor, to);
  }
  if (best === null) throw new Error("il velo del cassetto è tutto coperto: non c'è dove cliccarlo");
  return { x: Math.round((best[0] + best[1]) / 2 - scrim.x), y: top };
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