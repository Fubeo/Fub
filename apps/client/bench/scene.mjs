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
// Perché lo leggono anche programmi di Node: il fotografo (`photos.mjs`) gira
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
/// La stessa larghezza per gli stati della griglia sulla cartella grande, un
/// po' più alta: a 1308×800 il riquadro della griglia finisce a mezzo pixel
/// sugli angoli tondi del foglio, e su questi angoli Chromium dava a ogni
/// scatto un antialiasing diverso di un livello (la scena non stava mai ferma).
const SHEET_FULL_GRID = { width: 1308, height: 820 };
/// La nota nella finestra minima del computer (`minWidth` e un'altezza da
/// prototipo): la misura «700 px» del prototipo di Scrittoio 2, che sul
/// computer non si può avere.
const NOTE_NARROW = { width: 800, height: 800 };
/// La finestra minima del desktop per lo spazio «Esporta in PDF» (il «700 px»
/// del prototipo è sotto la minima: il pannello sotto le pagine lo guarda la
/// scena del telefono).
const EXPORT_NARROW = { width: 800, height: 800 };
/// La testata della trasclusione viva nel riquadro col fuoco.
const TRANSCLUSION_HEAD = ".pane.focus .pane-editor .transclusion .transclusion-head";
/// Il blocco sincronizzato nel riquadro col fuoco.
const SYNCED_BLOCK = ".pane.focus .pane-editor .transclusion-synced";
/// Una finestra documento appena aperta.
const DOCUMENT_WINDOW = { width: 900, height: 700 };

export const SCENE = touchLast(onPage("shell", [
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
  // **La scheda Risorse** (K6 T10): il Disegno completo, con la scheda Risorse
  // aperta. `campioni` dice quanti campioni del documento ha il disegno
  // (`?campioni=N`, vedi `fake-ipc.ts`): 24 come il prototipo, 500 per lo stato
  // con molte voci, 0 per il vuoto.
  ...[
    ["disegno-risorse", 24, "La scheda Risorse con 24 campioni del documento"],
    ["disegno-risorse-molti", 500, "La scheda Risorse con 500 campioni: scorre dentro la scheda, senza spostare il resto"],
    ["disegno-risorse-vuoto", 0, "La scheda Risorse senza campioni: lo stato vuoto"],
  ].map(([id, campioni, title]) => ({
    id,
    title,
    query: `connectors=6&drawing=acceso&campioni=${campioni}`,
    prepare: openRisorse,
  })),
  // **Design** (K6 T10): con un punto scelto (Posizione e misure), e senza
  // nulla scelto (il documento, con le sezioni del registro), a 1280 px. Sotto
  // gli 800 px del desktop la shell è quella del telefono, senza ispettore: il
  // Design a 700 px non ha una scena desktop.
  {
    id: "disegno-design",
    title: "Design con un punto scelto: Posizione e misure, a 1280 px",
    query: "connectors=6&drawing=acceso",
    prepare: openDesignoScelto,
  },
  {
    id: "disegno-design-vuoto",
    title: "Design senza nulla scelto: il documento, a 1280 px",
    query: "connectors=6&drawing=acceso",
    prepare: openDesignoVuoto,
  },
  // **La finestra del comando** (K6 T6, «Sposta tracciato» del prototipo
  // `PLAN-ui/disegno-completo.html`): la famiglia pronta, con l'anteprima accesa
  // a destra del foglio; la famiglia che si carica, e quella che non si carica
  // (la memoria dei motori piena, con «Riprova»). Ognuna a 1280 e a 700 px, in
  // giorno e notte. Le risposte sono quelle finte del motore del banco
  // (`fake-ipc.ts`, `window.bench.finestra`).
  ...[
    ["disegno-finestra", "finestra", "La finestra «Sposta tracciato» sul disegno, con l'anteprima accesa: lascia vedere il foglio"],
    ["disegno-finestra-caricamento", "caricamento", "La finestra mentre la famiglia si carica: il caricamento, e OK spento"],
    ["disegno-finestra-errore", "errore", "La finestra quando la famiglia non si carica: la memoria dei motori è piena, e «Riprova»"],
  ].flatMap(([id, stato, title]) => [
    {
      id,
      title,
      query: "connectors=6&drawing=acceso",
      prepare: (page) => openDrawingWindow(page, stato),
    },
    {
      id: `${id}-800`,
      title: `${title}, nella finestra minima del desktop (800 px)`,
      query: "connectors=6&drawing=acceso",
      viewport: { width: 800, height: 800 },
      prepare: (page) => openDrawingWindow(page, stato),
    },
  ]),
  // **Lo spazio di lavoro nella banda** (K6 T7): il bottone accanto alla
  // modalità, il suo menu aperto (Semplice, Completo, gli otto spazi del
  // Completo, le azioni), il Completo spento, il Completo che non si carica, e
  // il fuoco da tastiera. A 1280 e a 700 px, in giorno e in notte.
  ...[
    ["disegno-banda", 1280, "Lo spazio di lavoro nella banda, accanto alla modalità", null, openDrawing],
    ["disegno-banda-800", 800, "Lo spazio di lavoro nella banda in un foglio stretto, 800 px, la finestra minima del desktop", null, openDrawing],
    ["disegno-banda-aperta", 1280, "Lo spazio di lavoro aperto: Semplice, Completo, gli spazi del Completo, Ripristina, Salva e Gestisci", null, openWorkspaceMenu],
    ["disegno-banda-aperta-800", 800, "Lo spazio di lavoro aperto in un foglio stretto, 800 px, la finestra minima del desktop", null, openWorkspaceMenu],
    ["disegno-spento", 1280, "Il disegno completo spento: gli spazi del Completo grigi, con il perché, e «Apri Componenti…»", "componenti=motore-spento", openWorkspaceMenu],
    ["disegno-banda-errore", 1280, "Il disegno completo non si carica: il menu lo dice, e «Riprova»", null, openWorkspaceErrorMenu],
    ["disegno-banda-fuoco", 1280, "Il bottone dello spazio di lavoro col fuoco da tastiera", null, focusWorkspaceButton],
  ].map(([id, width, title, extra, prepare]) => ({
    id,
    title,
    query: extra === null ? "connectors=6" : `connectors=6&${extra}`,
    viewport: { width, height: 800 },
    prepare,
  })),
  // **La colonna del Completo** (K6 T8): la colonna a sei gruppi, la tendina di
  // una casella, il cassetto «Tutti gli strumenti» (con la ricerca), e la colonna
  // del Completo spento. A 1280 e a 700 px, in giorno e in notte.
  ...[
    ["disegno-completo", 1280, "La colonna del Completo: sei gruppi, le caselle che stanno, «Tutti gli strumenti» in fondo", null, openDrawing],
    ["disegno-completo-800", 800, "La colonna del Completo nella finestra minima del desktop, 800 px", null, openDrawing],
    ["disegno-gruppo", 1280, "La tendina della casella a più strumenti, aperta da tastiera con la freccia di lato", null, openColumnGroup],
    ["disegno-gruppo-800", 800, "La tendina della casella nella finestra minima del desktop, 800 px", null, openColumnGroup],
    ["disegno-cassetto", 1280, "Tutti gli strumenti: il cassetto con i gruppi per famiglia", null, openDrawerScene],
    ["disegno-cassetto-800", 800, "Il cassetto nella finestra minima del desktop, 800 px", null, openDrawerScene],
    ["disegno-cassetto-cerca", 1280, "Il cassetto con la ricerca scritta: restano i nomi che la contengono", null, (page) => openDrawerScene(page, "pe")],
    ["disegno-spento-colonna", 1280, "La colonna del Completo spento: la colonna nativa, 44 px di larghezza", "componenti=motore-spento", openDrawing],
  ].map(([id, width, title, extra, prepare]) => ({
    id,
    title,
    query: extra === null ? "connectors=6" : `connectors=6&${extra}`,
    viewport: { width, height: 800 },
    prepare,
  })),
  // **La famiglia «nucleo»** (K6 T11): gli strumenti del motore per scegliere
  // e per la vista nella colonna del Completo, col motore del banco acceso; la
  // tendina della casella «Scegli» aperta, e la Selezione diretta scelta (la
  // sua famiglia pronta, la fila delle opzioni in testata senza un gesto).
  ...[
    ["disegno-fam-nucleo", 1280, "Il nucleo nella colonna: Selezione, Selezione diretta, Lazo e la vista del motore, coi nomi e le icone", openDrawing],
    ["disegno-fam-nucleo-800", 800, "Il nucleo nella colonna nella finestra minima del desktop, 800 px", openDrawing],
    ["disegno-fam-nucleo-tendina", 1280, "La tendina della casella «Scegli»: Selezione di Fub e Selezione del motore", openColumnGroup],
    ["disegno-fam-nucleo-diretta", 1280, "La Selezione diretta del motore scelta: la casella accesa, e la famiglia pronta senza un gesto", scegliSelezioneDiretta],
    ["disegno-fam-nucleo-diretta-800", 800, "La Selezione diretta del motore scelta nella finestra minima del desktop, 800 px", scegliSelezioneDiretta],
  ].map(([id, width, title, prepare]) => ({
    id,
    title,
    query: "connectors=6&drawing=acceso",
    viewport: { width, height: 800 },
    prepare,
  })),
  // **Il menu ≡ e Ctrl+/ del Completo** (K6 T9a): le voci dell'indice di prova
  // (`?indice=prova`, vedi `fake-ipc.ts`). Il menu ≡ con Oggetto aperto, e la
  // tavolozza con la ricerca «sposta», a 1280 e a 800 px (la finestra minima).
  ...[
    ["disegno-menu", 1280, "Il menu ≡ del Completo con Oggetto aperto: le voci dell'indice, e quelle spente col perché", openMenuOggetto],
    ["disegno-menu-800", 800, "Il menu ≡ del Completo nella finestra minima del desktop, 800 px", openMenuOggetto],
    ["disegno-tavolozza", 1280, "Ctrl+/ con la ricerca «sposta»: le voci col posto e il tasto, e il perché di quella spenta", openTavolozza],
    ["disegno-tavolozza-800", 800, "Ctrl+/ con la ricerca «sposta» nella finestra minima del desktop, 800 px", openTavolozza],
  ].map(([id, width, title, prepare]) => ({
    id,
    title,
    query: "connectors=6&drawing=acceso&indice=prova",
    viewport: { width, height: 800 },
    prepare,
  })),
  // **I tasti del Disegno completo in Impostazioni › Scorciatoie** (K6 T9c):
  // la sezione col riquadro aperto, sui comandi dell'indice di prova, con un
  // tasto di Fub che copre (Ctrl+G), un conflitto vinto dall'ultimo assegnato
  // e un comando lasciato senza tasto (`?tasti=conflitto`, vedi `fake-ipc.ts`);
  // poi l'errore di un file d'insieme rotto, che non cambia niente.
  ...[
    ["scorciatoie-disegno", 1280, "Scorciatoie › Disegno completo: i comandi coi tasti, un tasto di Fub che copre e un conflitto", openDrawingKeys],
    ["scorciatoie-disegno-800", 800, "Scorciatoie › Disegno completo nella finestra minima del desktop, 800 px", openDrawingKeys],
    ["scorciatoie-disegno-errore", 1280, "Scorciatoie › Disegno completo: un file d'insieme rotto lo dice e non cambia niente", importBrokenKeySet],
  ].map(([id, width, title, prepare]) => ({
    id,
    title,
    query: "indice=prova&tasti=conflitto",
    viewport: { width, height: 800 },
    prepare,
  })),
  // **Le preferenze del motore in Impostazioni › Disegni** (K6 T11): il
  // riquadro «Motore del disegno» aperto con la categoria «Guide e griglia»
  // (colori, scelte, numeri con l'unità), largo e nella finestra minima; poi
  // un `draw.motore` scritto da un Fub più nuovo, in sola lettura col perché
  // (`?motore=`, vedi `fake-ipc.ts`).
  ...[
    ["impostazioni-motore", 1280, "prova", "Impostazioni › Disegni › Motore del disegno: le categorie del motore, «Guide e griglia» aperta"],
    ["impostazioni-motore-800", 800, "prova", "Impostazioni › Disegni › Motore del disegno nella finestra minima del desktop, 800 px"],
    ["impostazioni-motore-nuovo", 1280, "nuovo", "Impostazioni › Disegni › Motore del disegno: preferenze di un Fub più nuovo, in sola lettura col perché"],
    ["impostazioni-motore-nuovo-800", 800, "nuovo", "Impostazioni › Disegni › Motore del disegno in sola lettura, 800 px"],
  ].map(([id, width, motore, title]) => ({
    id,
    title,
    query: `drawing=acceso&motore=${motore}`,
    viewport: { width, height: 800 },
    prepare: openEnginePrefs,
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
  // **La barra che segue il blocco** (T11, E8 del prototipo dell'editor): la
  // barra compatta col gruppo del blocco del cursore, sulla nota della
  // sintassi; a 700 px ciò che non entra scende in «…»; poi i due menu della
  // barra, «Trasforma in» e «+ Inserisci». Il telefono è `mobile-keyboard`.
  ...[
    ["barra-blocco-compito", "La barra che segue il blocco: il cursore in un compito, «Compito · Scadenza»", "Da fare", "task"],
    ["barra-blocco-codice", "La barra che segue il blocco: il cursore nel codice, il linguaggio e «Copia»", "let (x, y)", "code"],
    ["barra-blocco-stretta", "La barra che segue il blocco nella finestra minima (800 px), nel codice: la fila compatta entra intera", "let (x, y)", "code", { width: 800, height: 800 }],
  ].map(([id, title, line, block, viewport]) => ({
    id,
    title,
    query: "formatbar=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      // La nota si apre dall'albero, che a 700 px sta nel cassetto chiuso: si
      // apre a finestra larga, poi la finestra torna quella della scena.
      await page.setViewportSize({ width: 1280, height: 800 });
      await openNote(page, "Guida/Sintassi di Fub.md");
      if (viewport) await page.setViewportSize(viewport);
      // Il codice sta in fondo alla nota, fuori dalle righe che CodeMirror
      // disegna: prima il cursore in fondo, poi la riga.
      if (block === "code") {
        await page.click(".pane.focus .pane-editor .cm-content");
        await page.keyboard.press("Control+End");
        // In fondo e fermo prima del clic: la riga del codice è già in vista,
        // e il clic non scorre.
        await scrollerAtRest(page, { toEnd: true });
      }
      await placeCursorOn(page, line);
      await scrollerAtRest(page);
      // Il gruppo arriva dopo la pausa della barra (un tempo vero: l'orologio
      // fermo del banco ferma la data, non i timer).
      await page.waitForSelector(`.pane.focus .format-bar-context[data-block="${block}"]`, { state: "attached" });
      await settleBar(page);
    },
  })),
  {
    id: "barra-blocco-trasforma",
    title: "La barra che segue il blocco: lo stile del blocco apre «Trasforma in»",
    // `slash=1`: i comandi di «Testo» e «Titolo 3» li dà il «/» dell'host finto.
    query: "formatbar=1&slash=1",
    prepare: async (page) => {
      await placeCursorOn(page, "Un elenco corto");
      await page.waitForSelector(".pane.focus .format-bar-style:not(:disabled)");
      await page.click(".pane.focus .format-bar-style");
      await page.waitForSelector('#context-menu [role="menuitemradio"][aria-checked="true"]');
      await page.mouse.move(0, 0);
    },
  },
  {
    id: "barra-blocco-inserisci",
    title: "La barra che segue il blocco: «+ Inserisci», gli stessi blocchi del «/» coi nomi",
    // `slash=1` dà all'host finto i comandi del «/»: «+ Inserisci» offre quelli.
    query: "formatbar=1&slash=1",
    prepare: async (page) => {
      await placeCursorOn(page, "Un elenco corto");
      await page.waitForSelector(".pane.focus .format-bar-insert:not(:disabled)");
      await page.click(".pane.focus .format-bar-insert");
      await page.waitForSelector("#context-menu .menu-field-input");
      await page.mouse.move(0, 0);
    },
  },
  // **La mini-barra** (T12, E8 del prototipo dell'editor): sul testo scelto
  // a barra del foglio nascosta, nella finestra larga e nella minima; poi il
  // pannello «Colore»; infine in testa al menu del tasto destro (E29), con la
  // barra compatta.
  ...[
    ["mini-barra-selezione", "La mini-barra sul testo scelto, a barra del foglio nascosta", null, false],
    ["mini-barra-stretta", "La mini-barra sul testo scelto nella finestra minima (800 px)", { width: 800, height: 800 }, false],
    ["mini-barra-colore", "La mini-barra: «Colore» apre le due righe dei nove colori, testo e sfondo", null, true],
  ].map(([id, title, viewport, colors]) => ({
    id,
    title,
    // `toolbar=nascosta`: la barra del foglio spenta, la mini-barra sul testo.
    query: "formatbar=1&slash=1&toolbar=nascosta",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await selectWords(page, "Questa è la nota");
      await page.waitForSelector(".selection-bubble:not([hidden]) .mini-bar [data-command='markdown.bold']");
      if (colors) {
        // La bolla ferma prima del clic (#511): con un suo menu aperto la bolla
        // non si riposa più (`selection-bubble.ts`, `holding`), e un clic che
        // arrivava mentre un riposizionamento era ancora in coda la lasciava,
        // col pannello dei colori, 2 px più in là in una corsa su tante.
        await settleBar(page);
        await page.click(".selection-bubble .mini-bar [data-command='mini-bar.color']");
        await page.waitForSelector(".mini-bar-colors .mini-bar-swatch");
      }
      await settleBar(page);
    },
  })),
  {
    id: "mini-barra-menu",
    title: "La mini-barra in testa al menu del tasto destro, sul testo scelto",
    query: "formatbar=1&slash=1",
    prepare: async (page) => {
      await page.waitForSelector(".pane.focus .format-bar.kit-bar .kit-bar-button");
      await selectWords(page, "Questa è la nota");
      // Il clic al centro del testo scelto: dello strato già ridisegnato, non
      // di quello del tasto di prima (il menu cadeva 2 px più in qua o più in
      // là secondo chi arrivava primo, #488).
      const box = await selectionBox(page);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      await page.waitForSelector(".context-strip.context-strip-mini .mini-bar [data-command='markdown.bold']");
      await page.mouse.move(0, 0);
    },
  },
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
    ["live-28-promemoria", "promemoria", "La Live coi promemoria: le pastiglie blu con l'ora, il giorno se non è oggi, grigia col compito fatto"],
    ["live-29-promemoria-stretta", "promemoria", "I promemoria nella finestra minima, 800 px", [], { width: 800, height: 800 }],
    ["live-26-colonne-stretta", "colonne", "La Live con le colonne nella finestra minima, 800 px", [], { width: 800, height: 800 }],
  ].map(([id, live, title, keys = [], viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openLive(page, keys, live === "panoramica-fondo" ? "bottom" : "top"),
  })),
  // **Il doppio clic con la barra di formato** (#411 A-05, #399): una parola
  // scelta col doppio clic si dipinge come la parola, non fino a fine riga.
  // A 1100 px, con la barra, la prima riga della panoramica va a capo dopo
  // apici, pedici e marche nascoste: con CodeMirror fino alla 6.43.7 la
  // selezione di «il», «bus» e «treno» si dipingeva come il resto della riga
  // più la riga sotto (col caso seminato del banco, ogni volta). La scena
  // sceglie due volte ogni parola della riga (non i link, che il clic segue)
  // e lancia se un disegno non è la parola: col caso seminato quale parola
  // cadeva cambiava con la luce, e con tutte almeno una cadeva sempre. La
  // foto resta su «treno», la parola del collaudo.
  {
    id: "live-30-doppio-clic-barra",
    title: "La Live con la barra di formato: «treno» scelto col doppio clic si dipinge come la parola",
    query: "live=panoramica&formatbar=1",
    viewport: { width: 1100, height: 800 },
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector(".pane.focus .format-bar.kit-bar .kit-bar-button");
      for (let round = 0; round < 2; round++) {
        for (const word of LINE_WORDS) await expectWordPainted(page, word);
      }
      await settleBar(page);
    },
  },
  // La scelta del promemoria (T36): il clic sulla pastiglia la apre sotto di
  // lei, coi giorni vicini, il mese col giorno scelto e l'ora; il piede
  // toglie il promemoria. Ciò che non è un giorno resta scritto e lo dice.
  ...[
    ["promemoria-01-scelta", "La scelta del promemoria aperta dalla pastiglia: le parole, i giorni vicini, il mese e l'ora", null],
    ["promemoria-02-parole", "Le parole nella scelta del promemoria: «Non capisco» per ciò che non è un giorno", "quando capita"],
  ].map(([id, title, words]) => ({
    id,
    title,
    query: "live=promemoria",
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.locator(".cm-content .cm-fub-reminder").nth(1).click();
      await page.waitForSelector(".cm-fub-reminder-picker");
      if (words !== null) {
        const field = page.locator(".cm-fub-reminder-picker input").first();
        await field.fill(words);
        await field.press("Enter");
        await page.waitForSelector(".cm-fub-reminder-picker .cm-fub-prop-note:not([hidden])");
      }
      await page.mouse.move(0, 0);
    },
  })),
  // La formula che si modifica toccandola (T60, E27): → davanti alla formula
  // in riga apre sotto di lei il riquadro con la formula grande, il cursore
  // nel numeratore; il blocco `$$` si apre col clic, sul posto, e la scena
  // prova i clic su numeratore, denominatore, esponente e radice (il posto
  // detto al lettore di schermo), se no è rossa; la formula con un errore si
  // apre col suo LaTeX (il telefono sta fra le scene di `mobile.html`).
  ...[
    ["formula-01-riga", "formula-toccata", "La formula in riga toccata: il riquadro sotto, la formula grande col cursore nel numeratore", "inline"],
    ["formula-02-blocco", "formula-toccata", "Il blocco $$ toccato: la formula sul posto col bordo d'accento, il cursore dove cade il clic", "block"],
    ["formula-03-errore", "formula-errore", "Una formula con un errore si apre col suo LaTeX e sotto che cosa non va, con la correzione", "error"],
    // Le proposte dei simboli (T61): `\fr` in fondo alla formula in riga
    // propone le frazioni e le frecce, disegnate e col nome; `\s` nel
    // blocco le radici, la somma e il sigma.
    ["formula-04-simboli", "formula-toccata", "La barra rovesciata e le prime lettere: le proposte dei simboli, disegnati e col nome, sotto la formula", "symbols"],
    ["formula-05-simboli-blocco", "formula-toccata", "Le proposte dei simboli sotto il blocco $$ toccato", "symbols-block"],
    // La tavolozza (T62): «Tutti» aperto sui sette gruppi; la ricerca a
    // parole, con e senza risultati; il blocco; la fila dei pezzi da
    // tastiera, col nome in fondo.
    ["formula-06-tavolozza", "formula-toccata", "La tavolozza sotto la formula: gli otto pezzi, «Tutti» aperto sui sette gruppi e la griglia della struttura", "palette"],
    ["formula-07-ricerca", "formula-toccata", "La ricerca a parole nella tavolozza: «freccia» dà le frecce, poi il vettore", "search"],
    ["formula-08-ricerca-vuota", "formula-toccata", "Una ricerca senza risultati: la frase che dice come cercare", "search-empty"],
    ["formula-09-tavolozza-blocco", "formula-toccata", "La tavolozza sotto il blocco $$ toccato, in una scheda, con «Tutti» aperto", "palette-block"],
    ["formula-10-tavolozza-tastiera", "formula-toccata", "Alt ↓ porta alla fila dei pezzi: il pezzo col fuoco e il suo nome in fondo", "palette-keys"],
    // «Mostra il LaTeX» e gli aiuti (T63): il campo sotto la formula, con la
    // scrittura veloce (`a/` è già una frazione, il cursore nel
    // denominatore); i tre puntini aperti; i discreti col pulsante della
    // tavolozza; gli spenti, soltanto il LaTeX e l'anteprima; il blocco.
    ["formula-11-latex", "formula-toccata&mathsource=1", "Mostra il LaTeX: sotto la formula il campo, e «a/» è già una frazione col cursore nel denominatore", "source"],
    ["formula-12-latex-opzioni", "formula-toccata&mathsource=1", "I tre puntini aperti: Mostra il LaTeX e gli aiuti, Pieni scelti", "source-options"],
    ["formula-13-latex-discreti", "formula-toccata&mathsource=1&mathhelp=discrete", "Gli aiuti discreti: il completamento resta, la tavolozza a richiesta col pulsante «Simboli»", "source-discrete"],
    ["formula-14-latex-spenti", "formula-toccata&mathsource=1&mathhelp=spente", "Gli aiuti spenti: soltanto il LaTeX e la sua anteprima", "source-off"],
    ["formula-15-latex-blocco", "formula-toccata&mathsource=1", "Il blocco $$ con Mostra il LaTeX: la formula sopra, il campo e la tavolozza sotto", "source-block"],
    // Gli errori in chiaro (T64): dopo la pausa, sotto il campo, la frase
    // con la correzione quando è una sola; con più correzioni nessun
    // pulsante. Il TeX non cambia da solo.
    ["formula-16-latex-errore", "formula-toccata&mathsource=1", "Un nome che non c'è: «Non conosco \\alfa. Forse volevi \\alpha?» e «Usa \\alpha»", "source-unknown"],
    ["formula-17-latex-graffa", "formula-toccata&mathsource=1&mathhelp=spente", "Una graffa aperta con gli aiuti spenti: «Manca una } di chiusura» e «Chiudi»", "source-brace"],
    ["formula-18-latex-piu-correzioni", "formula-toccata&mathsource=1&mathhelp=spente", "Un nome con più simboli vicini: la frase li elenca, senza pulsante", "source-guesses"],
    // Il tasto destro e Invio a blocco (T65): il menu della formula, con le
    // copie e il posto; Invio nel blocco va a capo e allinea gli uguali.
    ["formula-19-menu", "formula-toccata", "Il tasto destro su una formula: Modifica, «Copia come» in riga e «Da riga a blocco»", "menu"],
    ["formula-20-allinea", "formula-toccata", "Invio in un blocco $$: un aligned con gli uguali allineati e la riga nuova", "align"],
    // Scegliere un pezzo e le matrici (T66): Maiusc ← sceglie pezzi interi,
    // colorati; in una matrice Tab va alla cella dopo, Invio alla riga dopo.
    ["formula-21-scelta", "formula-toccata", "Maiusc ← nel blocco $$: la radice, il + e x² scelti come pezzi interi", "choose"],
    ["formula-22-matrice", "formula-toccata", "Una matrice dalla tavolozza: Tab e Invio fra le celle, e dall'ultima riga una riga nuova", "matrix"],
  ].map(([id, live, title, gesture]) => ({
    id,
    title,
    query: `live=${live}`,
    prepare: (page) => touchFormula(page, gesture),
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
  // La trasclusione viva (T29, il prototipo `.tx`): al passaggio la testata
  // con «Modifica qui» e «Apri»; «Modifica qui» apre l'editor del tratto col
  // bordo d'accento e la fascia di chi scrive; lo stesso nella finestra stretta.
  ...[
    ["trasclusione-viva-01-passaggio", "La trasclusione viva al passaggio: la provenienza, «Modifica qui» e «Apri»", false],
    ["trasclusione-viva-02-scrive", "«Modifica qui»: l'editor del tratto, il bordo d'accento e «Scrivi in …: si salva là»", true],
    ["trasclusione-viva-03-stretta", "La trasclusione che si scrive nella finestra stretta, 800 px", true, NOTE_NARROW],
  ].map(([id, title, writing, viewport]) => ({
    id,
    title,
    query: "live=trasclusione",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector(`${TRANSCLUSION_HEAD} .transclusion-edit`);
      if (!writing) return;
      await page.click(`${TRANSCLUSION_HEAD} .transclusion-edit`);
      // Il cursore va in fondo al tratto, sull'ultima voce: il titolo resta reso.
      await page.waitForSelector(".pane.focus .pane-editor .transclusion-editing .transclusion-editor .cm-content:focus");
    },
    // Il passaggio è l'ultimo gesto, dopo che il palco ha portato via il
    // puntatore.
    ...(writing ? {} : { hover: (page) => page.hover(TRANSCLUSION_HEAD) }),
  })),
  // Il blocco sincronizzato (T30): un blocco della nota col filo discreto a
  // sinistra; al passaggio la targhetta «Sincronizzato con …»; un clic lo
  // scrive dove sta. Sotto, un blocco d'origine cancellato: «Blocco non
  // trovato».
  ...[
    ["blocco-sincronizzato-01-passaggio", "Il blocco sincronizzato al passaggio: «Sincronizzato con …» e «Apri»; sotto, «Blocco non trovato»", false],
    ["blocco-sincronizzato-02-scrive", "Un clic sul blocco sincronizzato: si scrive dove sta, senza fascia", true],
    ["blocco-sincronizzato-03-stretta", "Il blocco sincronizzato al passaggio nella finestra stretta, 800 px", false, NOTE_NARROW],
  ].map(([id, title, writing, viewport]) => ({
    id,
    title,
    query: "live=sincronizzato",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector(`${SYNCED_BLOCK} .transclusion-body p`);
      await page.waitForSelector(".pane.focus .pane-editor .embed-missing");
      if (!writing) return;
      await page.click(`${SYNCED_BLOCK} .transclusion-body p`);
      await page.waitForSelector(`${SYNCED_BLOCK}.transclusion-editing .transclusion-editor .cm-content:focus`);
    },
    ...(writing ? {} : {
      hover: async (page) => {
        await page.hover(`${SYNCED_BLOCK} .transclusion-body`);
        await page.waitForFunction((selector) => getComputedStyle(document.querySelector(selector)).opacity === "1", `${SYNCED_BLOCK} > .transclusion-head`);
      },
    }),
  })),
  // Le schede vive nella nota (T41, il prototipo `.scard`, passi 16–18): il
  // PDF e il foglio a riposo, col nome del file in testata; il foglio attivo,
  // col bordo d'accento e «Esc per uscire»; in fondo un file mancante e un
  // formato che la nota non sa mostrare; la stessa nota nella finestra minima.
  ...[
    ["schede-vive-01-riposo", "Le schede vive a riposo: il contratto in PDF e il foglio dei conti, col nome del file in testata", "top", null],
    ["schede-vive-02-attiva", "Il foglio attivo: bordo d'accento, «Esc per uscire», «Apri» e «A tutta pagina»; le lettere e i numeri, e la cella attiva nel gruppo «Foglio» della barra", "top", "sheet", null, "&formatbar=1"],
    ["schede-vive-03-mancante", "Un file mancante («Ritrova…», «Togli dalla nota») e un formato che la nota non mostra («Apri»)", "bottom", null],
    ["schede-vive-04-stretta", "Le schede vive nella finestra minima, 800 px", "top", null, NOTE_NARROW],
    ["schede-vive-05-parte-persa", "Il foglio di cui l'intervallo non c'è più: «Intervallo non trovato: Budget!A1:E7» e «Scegli di nuovo» (T43)", "lost", null],
    ["schede-vive-06-scelta", "Il foglio scelto coi Blocchi (un clic sulla testata): il filo della selezione lo circonda (T56)", "top", null, null, null, "sheet"],
  ].map(([id, title, scroll, activate, viewport, extra, choose]) => ({
    id,
    title,
    query: `live=schede-vive&pdf-scena=domanda&workbook=1${extra ?? ""}`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], scroll === "bottom" ? "bottom" : "top");
      await page.waitForFunction(() => {
        const cards = [...document.querySelectorAll(".pane.focus .pane-editor .live-card")];
        return cards.length > 0 && cards.every((card) => card.dataset.cardState !== "loading");
      });
      // I fogli hanno letto la loro parte e preso l'altezza delle righe vere.
      await page.waitForFunction(() => [...document.querySelectorAll('.pane.focus .pane-editor .live-card[data-card-kind="sheet"] .canvas-card-sheet')]
        .every((sheet) => sheet.dataset.cardState === "content" || sheet.dataset.cardState === "lost"));
      if (scroll === "bottom") {
        // In fondo con ogni blocco disegnato e misurato (#510): le ultime
        // schede ci sono di sicuro, anche se lo scorrimento di `openLive` era
        // arrivato prima che quelle in alto prendessero la loro altezza.
        await scrollLiveToEnd(page);
        await page.waitForSelector('.pane.focus .pane-editor .live-card[data-card-state="missing"]');
        const last = '.pane.focus .pane-editor .live-card[data-card-state="unsupported"]';
        await page.waitForSelector(last);
        await page.waitForFunction((selector) => {
          const card = document.querySelector(selector)?.getBoundingClientRect();
          return card !== undefined && card.bottom <= window.innerHeight;
        }, last);
      }
      if (scroll === "lost") {
        // La parte persa sta sotto il foglio: la si porta in alto nella vista.
        const lost = '.pane.focus .pane-editor .live-card .canvas-card-lost';
        await page.waitForSelector(lost);
        await page.evaluate((selector) => document.querySelector(selector)?.closest(".live-card")?.scrollIntoView({ block: "center" }), lost);
      }
      if (choose) {
        const card = `.pane.focus .pane-editor .live-card[data-card-kind="${choose}"]`;
        await page.click(`${card} .live-card-name`);
        await page.waitForSelector(`${card}[data-card-chosen="true"]`);
        await expectVeilOnCard(page, card);
      }
      if (activate) {
        const body = `.pane.focus .pane-editor .live-card[data-card-kind="${activate}"] .live-card-body`;
        await page.click(body);
        await page.waitForSelector(`.pane.focus .pane-editor .live-card[data-card-kind="${activate}"][data-card-active="true"]`);
        // La griglia scrive dalla prima cella della parte, e la barra lo dice
        // (sotto i 760 px la cella non si vede: c'è, senza `hidden`).
        if (extra) await page.waitForSelector(".format-bar-context .format-bar-context-cell:not([hidden])", { state: "attached" });
      }
    },
  })),
  // Gli estratti (T49, il prototipo `.scard .act` e `.exc`, passi 17–18): il
  // foglio dei conti attivo con due righe scelte e «Estrai» d'accento in
  // testata; dopo «Estrai», l'estratto sotto la scheda; il passo del
  // contratto scritto come lo scrive Obsidian, una citazione con la fonte e
  // «Vai alla pagina»; il passo nella finestra minima.
  ...[
    ["estratti-01-estrai", "Il foglio attivo con A1:B2 scelte: «Estrai» d'accento in testata", "choose"],
    ["estratti-02-estratto", "Dopo «Estrai»: l'estratto delle celle scelte sotto la scheda, legato al foglio", "extract"],
    ["estratti-03-passo", "Un passo del contratto (`#page=1&selection=…`): la citazione con la fonte e «Vai alla pagina»", "passage"],
    ["estratti-04-stretta", "Il passo nella finestra minima, 800 px", "passage", NOTE_NARROW],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=estratti&pdf-scena=domanda&workbook=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      const sheet = '.pane.focus .pane-editor .live-card[data-card-kind="sheet"]';
      const passage = '.pane.focus .pane-editor .live-card[data-card-state="passage"]';
      await openLive(page, [], "top");
      await page.waitForSelector(`${sheet} .canvas-card-sheet[data-card-state="content"]`);
      await page.waitForSelector(`${passage} .live-card-excerpt-go`);
      if (gesture === "passage") {
        await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), passage);
        return;
      }
      await page.click(`${sheet} .live-card-body`);
      await page.waitForSelector(`${sheet}[data-card-active="true"]`);
      // Due righe e due colonne scelte trascinando, da A1 a B2 (il finto dà
      // solo le finestre che partono da A1, e l'estratto ci parte).
      const cell = async (row, column) => {
        // Le celle dell'editor attivo (`aria-selected`), non quelle ferme sotto.
        const box = await page.locator(`${sheet} .grid-cell[aria-selected][data-row="${row}"][data-column="${column}"]`).boundingBox();
        if (!box) throw new Error(`la cella ${row},${column} del foglio non si vede`);
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const from = await cell(0, 0);
      const to = await cell(1, 1);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
      await page.waitForSelector(`${sheet}[data-card-extract="ready"] .live-card-extract`);
      if (gesture === "extract") {
        await page.click(`${sheet} .live-card-extract`);
        await page.waitForFunction(() => document.querySelectorAll('.pane.focus .pane-editor .live-card[data-card-kind="sheet"] .canvas-card-sheet[data-card-state="content"]').length === 2);
        await page.evaluate(() => {
          const cards = document.querySelectorAll('.pane.focus .pane-editor .live-card[data-card-kind="sheet"]');
          cards[1]?.scrollIntoView({ block: "center" });
        });
      }
    },
  })),
  // I valori di cella nel testo (T53, il prototipo `.cellv` del paragrafo
  // `p-conti`): in Scrittura il valore col tratteggio d'accento, i casi limite
  // (vuota, #DIV/0!, foglio che non c'è, file mancante) e la cella da sola con
  // `|value`; al passaggio il velo d'accento; in Lettura testo come il resto;
  // nella finestra minima (i 700 px del prototipo li guarda la conformità).
  ...[
    ["valori-cella-01-scrittura", "I valori di cella in Scrittura: 680 su 800, la cella vuota «—», #DIV/0!, il foglio e il file che non ci sono, -120 da solo", "live_preview", null, false],
    ["valori-cella-02-passaggio", "Il puntatore sul primo valore: il velo d'accento", "live_preview", null, true],
    ["valori-cella-03-lettura", "I valori di cella in Lettura: testo come il resto, col formato del foglio", "reading", null, false],
    ["valori-cella-04-stretta", "I valori di cella nella finestra minima, 800 px", "live_preview", NOTE_NARROW, false],
  ].map(([id, title, mode, viewport, hover]) => ({
    id,
    title,
    query: "live=valori-cella&workbook=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const value = mode === "reading"
        ? '.pane.focus[data-mode="reading"] .markdown-rendered .fub-cell-value'
        : ".pane.focus .pane-editor .cm-fub-cell-value";
      if (mode === "reading") await chooseMode(page, "reading");
      // Ogni valore ha avuto la sua risposta: nessuno è ancora «…».
      await page.waitForFunction((selector) => {
        const all = [...document.querySelectorAll(selector)];
        return all.length >= 6 && all.every((each) => each.dataset.cellState !== undefined && each.dataset.cellState !== "loading");
      }, value);
    },
    ...(hover ? { hover: (page) => page.hover(".pane.focus .pane-editor .cm-fub-cell-value >> nth=0") } : {}),
  })),
  // I grafici (T54): il grafico «Vendite» del foglio come scheda, disegnato
  // da GridCraft e alto quanto la sua proporzione; un grafico che il file non
  // ha («Intervallo non trovato»); la tabella col recinto Mermaid che
  // «Grafico da questa tabella» le ha scritto sotto; il menu della tabella
  // con la voce; la finestra minima.
  ...[
    ["grafici-01-scrittura", "Il grafico del foglio come scheda, alto quanto la sua proporzione", "top", false, null],
    ["grafici-05-perso", "Il fondo del grafico del foglio e, sotto, un grafico che il file non ha", "lost", false, null],
    ["grafici-02-tabella", "La tabella dei preventivi e la torta scritta dalla tabella", "table", false, null],
    ["grafici-03-menu", "Il menu della tabella con «Rigenera il grafico dalla tabella»", "table", true, null],
    ["grafici-04-stretta", "I grafici nella finestra minima, 800 px", "top", false, NOTE_NARROW],
  ].map(([id, title, scroll, menu, viewport]) => ({
    id,
    title,
    query: "live=grafici&workbook=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      // Il grafico ha il suo disegno e la scheda persa il suo avviso. Se uno
      // dei due non arriva, l'errore dice quale e com'erano le schede (#505).
      await waitForCardPart(page, '.pane.focus .pane-editor .live-card[data-card-kind="sheet"] .canvas-card-sheet-chart img', "il disegno del grafico «Vendite»");
      await waitForCardPart(page, '.pane.focus .pane-editor .live-card[data-card-kind="sheet"] .canvas-card-lost', "l'avviso della scheda persa");
      if (scroll === "table") {
        // La torta si disegna quando entra in vista.
        await page.evaluate(() => document.querySelector(".pane.focus .pane-editor .tb-frame")?.scrollIntoView({ block: "start" }));
        await page.waitForFunction(() => {
          const all = [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram")];
          return all.length > 0 && all.every((figure) => figure.dataset.state !== "loading");
        });
        await page.evaluate(() => document.querySelector(".pane.focus .pane-editor .tb-frame")?.scrollIntoView({ block: "start" }));
      }
      if (scroll === "lost") {
        await page.evaluate(() => document.querySelector(".pane.focus .pane-editor .canvas-card-lost")?.closest(".live-card")?.scrollIntoView({ block: "end" }));
      }
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (menu) {
        await page.click('.pane.focus .pane-editor .tb-grid [data-row="1"][data-col="0"]', { button: "right" });
        await page.waitForSelector("#context-menu [role=menuitem]");
      }
    },
  })),
  // La scheda di documento (T44, il prototipo `.docw`, passo 17): il verbale
  // in ODT a riposo, in continuo e senza pagine; scelto coi Blocchi (attivo,
  // poi Esc); attivo, con l'editor dei documenti in Scrittura e la sua barra.
  // In fondo la relazione di cento pagine, tronca con «Apri».
  ...[
    ["scheda-documento-01-riposo", "Il verbale in ODT a riposo: il testo reso in continuo, senza pagine", "top", "rest"],
    ["scheda-documento-02-scelta", "Il verbale scelto coi Blocchi, dopo Esc", "top", "chosen"],
    ["scheda-documento-03-attiva", "Il verbale attivo: si scrive nel documento, con la barra dei documenti", "top", "active"],
    ["scheda-documento-04-lunga", "Un documento di cento pagine: la scheda si ferma e offre «Apri»", "bottom", "rest"],
    ["scheda-documento-05-stretta", "Il verbale a riposo nella finestra minima, 800 px (T56)", "top", "rest", NOTE_NARROW],
  ].map(([id, title, scroll, state, viewport]) => ({
    id,
    title,
    query: "live=scheda-documento",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const cards = '.pane.focus .pane-editor .live-card[data-card-kind="document"]';
      await page.waitForFunction((selector) => {
        const all = [...document.querySelectorAll(selector)];
        return all.length === 2 && all.every((card) => card.dataset.cardState === "view");
      }, cards);
      if (scroll === "bottom") {
        await page.waitForSelector(`${cards} .canvas-card-document-more`);
        await page.evaluate((selector) => document.querySelectorAll(selector)[1]?.scrollIntoView({ block: "end" }), cards);
      }
      if (state === "rest") return;
      await page.click(`.pane.focus .pane-editor .live-card[data-card-kind="document"] .live-card-body`);
      // Il fuoco nel testo del documento: si scrive lì.
      await page.waitForSelector(`.pane.focus .pane-editor .live-card[data-card-kind="document"][data-card-active="true"] .rich-content.ProseMirror-focused`);
      if (state === "active") return;
      await page.keyboard.press("Escape");
      await page.waitForSelector(`.pane.focus .pane-editor .live-card[data-card-kind="document"][data-card-chosen="true"]`);
    },
  })),
  // La misura e il posto delle schede (T42, il prototipo `.pair` e la lavagna
  // a tutta pagina, passo 17): due schede affiancate in un `[!columns]`, una
  // a tutta pagina e bassa, una come riga; il bordo che si trascina sotto il
  // puntatore; la stessa nota a 700 px, dove la scheda larga torna nella
  // colonna.
  ...[
    ["schede-misura-01-affiancate", "Il contratto e i conti affiancati in due colonne, sopra i conti a tutta pagina", "top", false],
    ["schede-misura-02-riga", "I conti bassi col bordo da trascinare sotto il puntatore, e il contratto come riga", "bottom", true],
    ["schede-misura-03-stretta", "Nella finestra minima le schede affiancate stanno una sotto l'altra, e quella larga torna nella colonna", "wide", false, NOTE_NARROW],
  ].map(([id, title, scroll, hover, viewport]) => ({
    id,
    title,
    query: "live=schede-misura&pdf-scena=domanda&workbook=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForFunction(() => {
        const cards = [...document.querySelectorAll(".pane.focus .pane-editor .live-card")];
        return cards.length >= 4 && cards.every((card) => card.dataset.cardState !== "loading");
      });
      if (scroll === "bottom") {
        await page.evaluate(() => {
          const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
          if (scroller) scroller.scrollTop = scroller.scrollHeight;
        });
        await page.waitForSelector('.pane.focus .pane-editor .live-card[data-card-display="row"]');
      }
      if (scroll === "wide") {
        // La seconda scheda delle colonne in alto, sopra quella larga.
        await page.evaluate(() => {
          const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
          const second = document.querySelectorAll(".pane.focus .pane-editor .fub-column > .live-card")[1];
          if (scroller && second) scroller.scrollTop += second.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
        });
      }
    },
    ...(hover ? {
      hover: async (page) => {
        const sized = '.pane.focus .pane-editor .live-card[data-card-height="set"]';
        await page.hover(`${sized} .live-card-resize`);
        await page.waitForSelector(`${sized}[data-card-resizable="true"]`);
      },
    } : {}),
  })),
  // La scheda PDF (T45, il prototipo `.pdfw` e `.pdfn`, passo 17): il manuale
  // di quattro pagine del giro, dalla pagina 2 con «2 / 4». A riposo; scelta
  // (un clic sulla testata, i Blocchi accesi); attiva, col puntatore sopra
  // (le frecce accanto al numero) e una riga del testo della pagina scelta;
  // la stessa nota a riposo nella finestra minima (i 700 px del prototipo li
  // guarda la conformità).
  ...[
    ["schede-pdf-01-riposo", "La scheda PDF a riposo: la pagina 2 sulla carta, «2 / 4» sotto", null],
    ["schede-pdf-02-scelta", "La scheda PDF scelta coi Blocchi: il filo della selezione la circonda", "choose"],
    ["schede-pdf-03-attiva", "La scheda PDF attiva: bordo d'accento, le frecce accanto al numero, una riga del testo scelta", "activate"],
    ["schede-pdf-04-stretta", "La scheda PDF nella finestra minima, 800 px: la pagina si stringe con la carta", null, NOTE_NARROW],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=schede-pdf&giro=editor",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      const card = '.pane.focus .pane-editor .live-card[data-card-kind="pdf"]';
      await openLive(page, [], "top");
      await page.waitForSelector(`${card}[data-card-state="view"] .canvas-card-pdf[data-card-state="content"]`);
      await page.waitForFunction((selector) => document.querySelector(`${selector} .canvas-card-pdf-status`)?.textContent === "2 / 4", card);
      // La scheda intera in vista, col numero sotto la pagina.
      await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), card);
      if (gesture === "choose") {
        await page.click(`${card} .live-card-name`);
        await page.waitForSelector(`${card}[data-card-chosen="true"]`);
        await expectVeilOnCard(page, card);
      }
      if (gesture === "activate") {
        await page.click(`${card} .live-card-body`);
        await page.waitForSelector(`${card}[data-card-active="true"]`);
        // Il clic ha portato il puntatore sulla scheda, che ha steso il testo;
        // se ne sceglie la seconda riga, come farebbe un trascinamento.
        await page.waitForSelector(`${card} .canvas-card-pdf-text span`);
        await page.evaluate((selector) => {
          const pieces = [...document.querySelectorAll(`${selector} .canvas-card-pdf-text span`)];
          const line = pieces.find((piece) => piece.textContent.startsWith("Una nota"));
          if (!line) throw new Error("la pagina 2 del manuale non ha la sua riga");
          const range = document.createRange();
          range.selectNodeContents(line);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
        }, card);
      }
    },
    ...(gesture === "activate" ? {
      hover: async (page) => {
        // Sulla scheda attiva il testo sta sopra la pagina e prende il puntatore.
        await page.hover('.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf-text');
      },
    } : {}),
  })),
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
  // Gli editor dei tipi della testata (T8, E5, riga «Le proprietà» del
  // prototipo): le righe con la figura del tipo, poi ogni editor aperto, da
  // tastiera (il fuoco sul valore e Invio) o col puntatore; poi a 800 px.
  ...[
    ["proprieta-01-righe", "Le proprietà coi loro tipi: testo, stato, data, persone"],
    ["proprieta-02-testo", "Il testo si scrive al posto del valore (da tastiera)", "text"],
    ["proprieta-03-data", "Il riquadro della data, aperto da tastiera", "date"],
    ["proprieta-04-persone", "Il riquadro delle persone, aperto col puntatore", "people"],
    ["proprieta-05-elenco", "Il riquadro di un elenco, aperto col puntatore, con «Altre» aperto", "list"],
    ["proprieta-06-menu", "Il menu della proprietà, aperto dal nome", "menu"],
    ["proprieta-07-tipo", "Il menu «Tipo» della proprietà", "type"],
    ["proprieta-08-data-stretta", "Il riquadro della data nella finestra minima, 800 px", "date", { width: 800, height: 800 }],
    ["proprieta-09-persone-stretta", "Il riquadro delle persone nella finestra minima, 800 px", "people", { width: 800, height: 800 }],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=proprieta",
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openPropertyEditor(page, gesture),
  })),
  // Selezione, Stato e Url nella testata (T9, passo 4 del prototipo): le
  // pastiglie, l'indirizzo con la matita e uno Stato fuori dalle opzioni;
  // poi l'elenco delle opzioni dello Stato, da tastiera, e «Crea» su una
  // Selezione; poi a 800 px.
  ...[
    ["opzioni-01-righe", "Selezione, Stato, Url e (con «Altre» aperto) un valore fuori dalle opzioni nella testata", "more"],
    ["opzioni-02-stato", "L'elenco delle opzioni dello Stato nei tre gruppi, aperto da tastiera", "status"],
    ["opzioni-03-crea", "Una Selezione con «Crea» per un nome che non c'è", "create"],
    ["opzioni-04-stato-stretta", "L'elenco delle opzioni dello Stato nella finestra minima, 800 px", "status", { width: 800, height: 800 }],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=opzioni&tipi=1",
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openOptionsEditor(page, gesture),
  })),
  // La Relazione (T35, passo 4 del prototipo): il tipo e i libri legati come
  // nomi di note; poi il riquadro col puntatore, le note della cartella del
  // bersaglio sotto quelle legate; «Crea» per un nome che non c'è; a 800 px.
  ...[
    ["relazioni-01-righe", "Il tipo e una Relazione nella testata: i nomi delle note, sottolineati"],
    ["relazioni-02-editor", "Il riquadro della Relazione, aperto col puntatore: le legate spuntate, poi la cartella", "open"],
    ["relazioni-03-crea", "La Relazione con «Crea» per un nome che non c'è, da tastiera", "create"],
    ["relazioni-04-stretta", "Il riquadro della Relazione nella finestra minima, 800 px", "open", { width: 800, height: 800 }],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=relazioni&tipi=1",
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openRelationEditor(page, gesture),
  })),
  // I tipi di nota (T33, E5; il prototipo `newNote()` e la sezione «Tipi» del
  // cassetto): «Nuova nota» che chiede il tipo, la testata di una nota con un
  // tipo, quella di una nota il cui tipo non c'è, e «Scegli il tipo»; poi a
  // 800 px.
  ...[
    ["tipi-01-nuova", "tipo", "«Nuova nota» chiede il tipo: la nota semplice in cima, poi i tipi; nel cassetto la sezione «Tipi»", "new"],
    ["tipi-02-testata", "tipo", "La testata di una nota con un tipo: l'icona del tipo, «tipo» e le proprietà in evidenza del tipo", "typed"],
    ["tipi-03-mancante", "tipo-mancante", "La testata di una nota il cui tipo non c'è: lo dice, con «Scegli il tipo»", "missing"],
    ["tipi-04-scegli", "tipo-mancante", "«Scegli il tipo» aperto dalla testata, da tastiera", "choose"],
    ["tipi-05-nuova-stretta", "tipo", "«Nuova nota» chiede il tipo nella finestra minima, 800 px", "new", { width: 800, height: 800 }],
    ["tipi-06-mancante-stretta", "tipo-mancante", "Il tipo che non c'è nella finestra minima, 800 px", "missing", { width: 800, height: 800 }],
  ].map(([id, live, title, gesture, viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openNoteTypes(page, gesture),
  })),
  // La pagina del tipo (T33): in fondo alla nota del tipo, le note di quel
  // tipo con le sue proprietà in evidenza (la vista `note_type_page`).
  ...[
    ["tipi-07-pagina", "La pagina del tipo in fondo a «Libro»: le sue note, con le proprietà in evidenza", undefined],
    ["tipi-08-pagina-stretta", "La pagina del tipo nella finestra minima, 800 px", { width: 800, height: 800 }],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "live=tipo-pagina",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      // Nella finestra stretta l'albero è nel cassetto chiuso: la nota si apre
      // larga, poi la finestra si stringe.
      if (viewport) await page.setViewportSize({ width: 1280, height: 800 });
      await openNote(page, "Tipi/Libro.md");
      await chooseMode(page, "live_preview");
      if (viewport) {
        await page.setViewportSize(viewport);
        await page.waitForSelector("#layout.layout-compact");
      }
      await page.waitForSelector(".pane.focus .cm-day-page[data-type-page]:not([hidden]) .ui-section .ui-list-item");
      await page.$eval(".pane.focus .cm-day-page[data-type-page]", (section) => section.scrollIntoView({ block: "end" }));
      await page.mouse.move(0, 0);
    },
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
    // «Sposta in…» (E13): la nota, poi dove e che cosa resta; e il blocco
    // in mano sopra una nota del cassetto.
    ["blocchi-08-sposta-nota", "titolo-attivo", "«Sposta in…» dal menu del blocco: la scelta della nota", "move-note"],
    ["blocchi-09-sposta-dove", "titolo-attivo", "«Sposta in…»: dove va il blocco e che cosa resta al suo posto", "move-where"],
    ["blocchi-10-sposta-dove-stretta", "titolo-attivo", "«Sposta in…»: dove e che cosa resta, nella finestra minima", "move-where", { width: 800, height: 800 }],
    ["blocchi-11-sposta-cassetto", "riga-attiva", "Un blocco in mano sopra una nota del cassetto: «Sposta in «…»»", "move-drawer", { width: 1280, height: 800 }],
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
      if (gesture === "hover" || gesture === "move-drawer") return;
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
      if (gesture === "move-note" || gesture === "move-where") {
        await page.click("#context-menu [role^=menuitem]:has(.menu-label:text-is('Sposta in…'))");
        await page.waitForSelector(".modale [role=option]");
        if (gesture === "move-where") {
          // Una nota coi suoi titoli, perché «Dove» li mostri rientrati.
          await page.keyboard.type("Sintassi");
          await page.keyboard.press("Enter");
          await page.waitForSelector(".modale .palette-form select[name=where]");
        }
        await page.waitForFunction(() => document.getAnimations().length === 0);
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
    // Il blocco preso per la maniglia e tenuto sulla prima nota del cassetto
    // che non è quella aperta: il puntatore è il gesto, e resta giù.
    ...(gesture === "move-drawer" ? {
      hover: async (page) => {
        await page.hover(".pane.focus .pane-editor .cm-content .cm-line:has-text('Cose da fare')");
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles[data-active=\"true\"]");
        const grip = await page.locator(".pane.focus .pane-editor .cm-fub-block-handles[data-active=\"true\"] .cm-fub-block-grip").boundingBox();
        const row = await page.locator("#file-list .tree-row.note[data-path$='.md']:not([aria-current]):visible").first().boundingBox();
        if (!grip || !row) throw new Error("manca la maniglia o una nota nel cassetto");
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 12, { steps: 4 });
        await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, { steps: 16 });
        await page.waitForSelector(".cm-fub-block-lift[data-free=\"true\"]");
        await page.waitForSelector("#file-list .tree-row[data-drop-hot]");
        await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
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
    // Gli stili scritti nel diagramma (#528): Mermaid li scrive come
    // attributo sui nodi dell'SVG dove misura, e la CSP li rifiuterebbe. Un
    // `font-size` perso nelle misure fa uscire l'etichetta dal riquadro.
    ["diagramma-09-nodi-con-stile", "diagramma-nodi", "Nodi e collegamenti con uno stile scritto nel diagramma: riempimento, bordo, linea rossa, classe, un'etichetta grande che sta nel suo riquadro"],
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
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // Il sorgente di un diagramma disegnato è nascosto, col suo «Copia»:
      // conta ciò che si vede. Con un errore il sorgente c'è, ed è suo.
      // La didascalia (il `title`, T58) è testo della figura, non un controllo.
      const controls = await page.evaluate(() => [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram:not([data-state='error']) :is(button, figcaption:not(.mermaid-diagram-caption))")]
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
  // Il tracciato dei collegamenti (E26, T59): il flusso del prototipo, con un
  // ritorno e le etichette, giù e poi a destra, in ognuno dei cinque stili;
  // poi i casi limite (etichette lunghe, tratteggio, senza punta, sequenza).
  // La finestra è alta perché i due orientamenti stiano in uno scatto.
  ...[
    ...["armonia", "acquerello", "aurora", "blueprint", "inchiostro"].map((style) => [
      `diagramma-07-tracciato-${style}`,
      `diagramma-tracciato-${style}`,
      `Il tracciato in ${style[0].toUpperCase()}${style.slice(1)}: frecce che arrivano dritte, punte sottili, gomiti arrotondati, il ritorno di lato; giù e a destra`,
    ]),
    ["diagramma-08-tracciato-casi", "diagramma-tracciato-casi", "Il tracciato nei casi limite: un'etichetta lunga, un tratteggio, un collegamento senza punta, un diagramma di sequenza"],  ].map(([id, live, title]) => ({
    id,
    title,
    query: `live=${live}`,
    viewport: { width: 1280, height: 1500 },
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForFunction(() => {
        const all = [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram")];
        return all.length > 0 && all.every((figure) => figure.dataset.state === "ready");
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
  })),
  // Il sorgente del diagramma (T58): accanto al disegno, metà e metà, con
  // «Fatto» nella testata; con un errore il disegno di prima attenuato e la
  // riga che dice dove; uno sopra l'altro nel foglio stretto; a tutta
  // finestra sul fondo dello stile.
  ...[
    // Accanto serve un foglio di almeno 941 px: la finestra larga.
    ["diagramma-sorgente-01-accanto", "Il sorgente aperto: le righe a sinistra, il disegno accanto, la didascalia sotto", null, { width: 1600, height: 900 }],
    ["diagramma-sorgente-02-errore", "Un errore nel sorgente: il disegno di prima attenuato, «Riga N» in parole semplici", "errore", { width: 1600, height: 900 }],
    ["diagramma-sorgente-03-stretta", "Nel foglio stretto il sorgente e il disegno stanno uno sopra l'altro", "errore", { width: 800, height: 800 }],
    ["diagramma-sorgente-04-ingrandito", "Ingrandisci: il diagramma a tutta finestra, sul fondo dello stile", "ingrandisci"],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: `live=${gesture === "ingrandisci" ? "diagramma" : "diagramma-sorgente"}`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const ready = () => page.waitForFunction(() => {
        const all = [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram")];
        return all.length > 0 && all.every((figure) => figure.dataset.state !== "loading");
      });
      await ready();
      if (gesture === "ingrandisci") {
        // Dal menu del tasto destro: in Scrittura il clic porta il cursore nel recinto.
        const box = await page.locator(".pane.focus .pane-editor .mermaid-diagram img").first().boundingBox();
        if (!box) throw new Error("il diagramma non ha un disegno");
        await page.mouse.click(box.x + box.width / 2, box.y + 24, { button: "right" });
        await page.waitForSelector(".diagram-menu");
        await page.click(".diagram-menu [data-action='enlarge']");
        await page.waitForSelector(".lightbox.lightbox-diagram");
        await page.waitForFunction(() => document.getAnimations().length === 0);
        return;
      }
      await page.waitForSelector(".pane.focus .pane-editor .cm-fub-diagram-live .mermaid-diagram[data-state='ready']");
      if (gesture === "errore") {
        await page.evaluate(async () => {
          const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
          const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
          const at = view.state.doc.toString().indexOf("D[Cambia giorno]") + "D[Cambia giorno]".length;
          view.dispatch({ changes: { from: at, insert: "\n  D --> --> A" }, selection: { anchor: at + 14 }, userEvent: "input.type" });
        });
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-diagram-live .cm-fub-diagram-notice:not([hidden])", { timeout: 15000 });
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-diagram-live .mermaid-diagram.is-stale");
      }
      // Il recinto in cima al foglio: sotto si vedono il disegno e la didascalia.
      await page.evaluate(() => {
        const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
        const header = document.querySelector(".pane.focus .pane-editor .cm-fub-code-header");
        scroller.scrollTop += header.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
      });
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
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
    ...(touch ? { touch: true } : {}),
    prepare: async (page) => {
      // Col dito vuol dire `(pointer: coarse)`: Chromium lo dà quando
      // emula il tocco, e il pannello lo legge all'apertura.
      if (touch) await touchOn(page);
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
  // Il «/» sull'ultima riga di una nota scorsa fino in fondo: il menu si apre
  // sopra la riga e la vista non si muove. Nella WebView di Linux la vista
  // scendeva di una riga: mentre CodeMirror ridisegna la riga, il testo è per
  // un attimo più corto, e a fondo nota lo scorrimento si accorciava con lui.
  // La scena fa accorciare il testo per un attimo anche qui, poi scrive il «/».
  ...[
    ["slash-10-fondo", "Il menu «/» sull'ultima riga di una nota scorsa fino in fondo: sopra la riga, la vista ferma", null],
    ["slash-11-fondo-stretta", "Il menu «/» a fondo nota nella finestra minima: sopra la riga, la vista ferma", NOTE_NARROW],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "live=fondo-nota&slash=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "bottom");
      await page.waitForFunction(() => document.getAnimations().length === 0);
      // Di nuovo in fondo: la prima misura di CodeMirror allunga la nota di
      // qualche pixel dopo lo scorrimento di `openLive`.
      await page.evaluate(async () => {
        const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
        const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
        view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const before = await caretLinePlace(page);
      if (before.scrollTop < before.maxScroll - 1) throw new Error(`la nota non è scorsa fino in fondo: ${before.scrollTop} di ${before.maxScroll}`);
      const shrunk = await page.evaluate(async () => {
        const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
        const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
        // Come CodeMirror quando ridisegna una riga: per un attimo l'ultima
        // riga non c'è, e la disposizione si calcola così.
        const last = view.contentDOM.lastElementChild;
        last.style.display = "none";
        void view.scrollDOM.scrollHeight;
        last.style.display = "";
        return view.scrollDOM.scrollTop;
      });
      if (shrunk !== before.scrollTop) throw new Error(`il testo accorciato per un attimo sposta la vista: da ${before.scrollTop} a ${shrunk} px`);
      await page.keyboard.type("/");
      await page.waitForSelector(".slash-panel");
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await caretLinePlace(page);
      if (after.scrollTop !== before.scrollTop || Math.abs(after.lineTop - before.lineTop) > 0.5) {
        throw new Error(`il «/» a fondo nota sposta la vista: scorrimento da ${before.scrollTop} a ${after.scrollTop} px, riga da ${before.lineTop} a ${after.lineTop}`);
      }
      const above = await page.$eval(".slash-panel", (panel) => panel.classList.contains("cm-tooltip-above"));
      if (!above) throw new Error("a fondo nota il menu «/» non si apre sopra la riga");
    },
  })),
  // La Base nella nota (T18, E12, E19): incorporata, si allarga oltre la
  // colonna del testo fino al margine; nella finestra stretta resta nella
  // colonna. Poi «/base»: il nome chiesto, e la Base nata al posto della riga.
  ...[
    ["base-nota", "La Base incorporata in una nota: oltre la colonna del testo fino al margine", "base-incorporata"],
    ["base-nota-stretta", "La Base incorporata nella finestra minima: resta nella colonna", "base-incorporata", { width: 800, height: 800 }],
  ].map(([id, title, live, viewport]) => ({
    id,
    title,
    query: `live=${live}&base=nota`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await waitForEmbeddedBase(page);
    },
  })),
  {
    id: "base-slash-nome",
    title: "«/base»: il nome della Base, di serie il titolo della nota",
    query: "live=base-slash&base=nota&slash=1",
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await page.keyboard.type("/base");
      await page.waitForSelector(".slash-panel");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".palette-form input");
      await page.mouse.move(0, 0);
    },
  },
  {
    id: "base-slash-creata",
    title: "«/base» confermato: il file accanto alla nota e la Base al posto della riga",
    query: "live=base-slash&base=nota&slash=1",
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await page.keyboard.type("/base");
      await page.waitForSelector(".slash-panel");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".palette-form input");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".palette-form", { state: "detached" });
      await waitForEmbeddedBase(page);
      await page.mouse.move(0, 0);
    },
  },
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
  {
    id: "dialog-long",
    title: "Un dialogo lungo si apre in cima: il fuoco sull'azione in fondo non lo fa scorrere",
    prepare: async (page) => {
      // Il dialogo del kit con un corpo più alto della finestra e le azioni in
      // fondo: è il caso in cui il fuoco iniziale trascinava la vista a metà.
      await page.evaluate(async () => {
        const { openDialog } = await import("/src/kit/dialog.ts");
        const { openLifetime } = await import("/src/ui/lifetime.ts");
        const list = document.createElement("ol");
        for (let step = 1; step <= 60; step++) {
          const item = document.createElement("li");
          item.textContent = `Passo ${step}: imposta la proprietà «stato» della nota a «letta».`;
          list.append(item);
        }
        openDialog({
          title: "Accendere la ricetta «Segna come letta»?",
          description: "Ecco i passi che farà, dall'inizio alla fine.",
          body: list,
          actions: [
            { id: "later", label: "Non ora", value: false },
            { id: "adopt", label: "Accendi", kind: "primary", value: true },
          ],
          dismissValue: false,
          lifetime: openLifetime(),
        });
      });
      await page.waitForSelector('.kit-dialog [data-action="adopt"]:focus');
      const top = await page.$eval(".kit-dialog", (dialog) => dialog.scrollTop);
      if (top !== 0) throw new Error(`il dialogo lungo si apre scorso di ${top} px`);
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
  // La scheda di disegno (T46, ADR 0248; la riga «Disegno .svg» del passo 17
  // del prototipo): la pianta del soggiorno a riposo, il disegno fermo;
  // scelta coi Blocchi (attiva, poi Esc); attiva, con la penna, le forme e il
  // testo in una fila sopra il foglio; attiva nella finestra minima. Sotto,
  // il logo fatto altrove resta un'immagine ferma.
  ...[
    ["scheda-disegno-01-riposo", "La pianta a riposo: il disegno fermo, e sotto un SVG fatto altrove", "rest"],
    ["scheda-disegno-02-scelta", "La pianta scelta coi Blocchi, dopo Esc", "chosen"],
    ["scheda-disegno-03-attiva", "La pianta attiva: la penna, le forme e il testo in una fila sopra il foglio", "active"],
    ["scheda-disegno-04-attiva-stretta", "La pianta attiva nella finestra minima: gli strumenti scorrono di lato", "active", NOTE_NARROW],
  ].map(([id, title, state, viewport]) => ({
    id,
    title,
    query: "live=scheda-disegno",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const cards = '.pane.focus .pane-editor .live-card[data-card-kind="drawing"]';
      // Le due schede mostrano il loro disegno: la pianta di Fub, il logo estraneo.
      await page.waitForFunction((selector) => {
        const all = [...document.querySelectorAll(selector)];
        return all.length === 2 && all.every((card) => card.dataset.cardState === "view" && card.querySelector(".canvas-card-drawing[data-card-drawing] img.canvas-card-picture")?.complete === true);
      }, cards);
      // La pianta intera nella vista, col testo prima e dopo.
      await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), cards);
      if (state === "rest") return;
      await page.click(`${cards} .live-card-body`);
      await page.waitForSelector(`${cards}[data-card-active="true"] .canvas-card-drawing-editor:not([hidden]) .draw-surface`);
      if (state === "active") return;
      await page.keyboard.press("Escape");
      await page.waitForSelector(`${cards}[data-card-chosen="true"]`);
    },
  })),
  // La zona lavagna (T47, il passo 18 del prototipo): il percorso della
  // visita a riposo, tutto nella scheda; scelto coi Blocchi (attivo, poi
  // Esc); attivo, la lavagna vera con la barra della selezione e senza la
  // colonna degli strumenti; attivo nella finestra minima.
  ...[
    ["scheda-lavagna-01-riposo", "Il percorso della visita a riposo: tutta la lavagna nella scheda", "rest"],
    ["scheda-lavagna-02-scelta", "Il percorso scelto coi Blocchi, dopo Esc", "chosen"],
    ["scheda-lavagna-03-attiva", "Il percorso attivo: le schede si spostano, senza la colonna degli strumenti", "active"],
    ["scheda-lavagna-04-attiva-stretta", "Il percorso attivo nella finestra minima", "active", NOTE_NARROW],
  ].map(([id, title, state, viewport]) => ({
    id,
    title,
    query: "live=scheda-lavagna",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const card = '.pane.focus .pane-editor .live-card[data-card-kind="canvas"]';
      // La lavagna a riposo mostra le sue quattro schede.
      await page.waitForFunction((selector) => {
        const root = document.querySelector(selector);
        return root?.dataset.cardState === "view"
          && root.querySelector('.canvas-card-board[data-card-board="board"]') !== null
          && root.querySelectorAll(".canvas-card-board-rest .canvas-node").length === 4;
      }, card);
      await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), card);
      if (state === "rest") return;
      await page.click(`${card} .live-card-body`);
      await page.waitForFunction((selector) => {
        const writer = document.querySelector(`${selector}[data-card-active="true"] .canvas-card-board-editor:not([hidden])`);
        return writer !== null && writer.querySelectorAll(".canvas-node").length === 4;
      }, card);
      if (state === "active") return;
      await page.keyboard.press("Escape");
      await page.waitForSelector(`${card}[data-card-chosen="true"]`);
    },
  })),
  // La scheda di un file Craft nella nota (T56): il logo dello studio di
  // VectorCraft, con le anteprime fatte dalle app spente (`craft-scheda`),
  // a riposo, scelta, attiva e nella finestra minima.
  ...[
    ["scheda-craft-01-riposo", "Il logo di VectorCraft a riposo: il nome, la riga dei dati, perché l'anteprima manca, «Apri» e «Apri con…»", "rest"],
    ["scheda-craft-02-scelta", "Il logo di VectorCraft scelto coi Blocchi (un clic sulla testata)", "chosen"],
    ["scheda-craft-03-attiva", "Il logo di VectorCraft attivo: bordo d'accento e «Esc per uscire»", "active"],
    ["scheda-craft-04-stretta", "Il logo di VectorCraft a riposo nella finestra minima, 800 px", "rest", NOTE_NARROW],
  ].map(([id, title, state, viewport]) => ({
    id,
    title,
    query: "live=scheda-craft&craft-scheda=spente",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const card = '.pane.focus .pane-editor .live-card[data-card-kind="craft"]';
      await page.waitForSelector(`${card}[data-card-state="view"]`);
      await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), card);
      if (state === "chosen") {
        await page.click(`${card} .live-card-name`);
        await page.waitForSelector(`${card}[data-card-chosen="true"]`);
        await expectVeilOnCard(page, card);
      }
      if (state === "active") {
        await page.click(`${card} .live-card-body`);
        await page.waitForSelector(`${card}[data-card-active="true"]`);
      }
    },
  })),
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
    // Le schede vive nella nota sul telefono (T56), una scena per specie a
    // riposo: il foglio e il PDF (con il file mancante e il formato senza
    // vista sotto), il contratto di quattro pagine, il verbale, la pianta,
    // la zona lavagna e il file Craft.
    ...[
      ["mobile-schede-vive", "Il telefono: il contratto e i conti come schede vive", "live=schede-vive&pdf-scena=domanda&workbook=1"],
      ["mobile-schede-mancante", "Il telefono: un file mancante e un formato che la nota non mostra", "live=schede-vive&pdf-scena=domanda&workbook=1", "unsupported"],
      ["mobile-scheda-pdf", "Il telefono: la scheda PDF, dalla pagina 2", "live=schede-pdf&giro=editor", "pdf"],
      ["mobile-scheda-documento", "Il telefono: il verbale in ODT a riposo", "live=scheda-documento", "document"],
      ["mobile-scheda-disegno", "Il telefono: la pianta a riposo", "live=scheda-disegno", "drawing"],
      ["mobile-scheda-lavagna", "Il telefono: il percorso della visita a riposo", "live=scheda-lavagna", "canvas"],
      ["mobile-scheda-craft", "Il telefono: il logo di VectorCraft senza anteprima", "live=scheda-craft&craft-scheda=spente", "craft"],
    ].map(([id, title, query, focus]) => ({
      id,
      title,
      query,
      viewport: PHONE,
      prepare: async (page) => {
        await openLive(page, [], "top");
        await page.waitForFunction(() => {
          const cards = [...document.querySelectorAll(".pane.focus .pane-editor .live-card")];
          return cards.length > 0 && cards.every((card) => card.dataset.cardState !== "loading")
            && [...document.querySelectorAll(".pane.focus .pane-editor .canvas-card-sheet")]
              .every((sheet) => sheet.dataset.cardState === "content" || sheet.dataset.cardState === "lost");
        });
        if (!focus) return;
        if (focus === "unsupported") {
          // Le schede sopra hanno preso la loro altezza: si va in fondo, dove
          // CodeMirror monta le ultime, con ogni blocco misurato (#510).
          await scrollLiveToEnd(page);
        }
        const card = focus === "unsupported"
          ? '.pane.focus .pane-editor .live-card[data-card-state="unsupported"]'
          : `.pane.focus .pane-editor .live-card[data-card-kind="${focus}"]`;
        await page.waitForSelector(card);
        // Il PDF ha la sua pagina sulla carta prima della foto.
        if (focus === "pdf") await page.waitForSelector(`${card} .canvas-card-pdf[data-card-state="content"]`);
        if (focus !== "unsupported") {
          await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), card);
          return;
        }
        // Le schede sopra crescono anche dopo il salto: si riporta la scheda
        // in fondo a ogni fotogramma finché altezza e posto restano gli
        // stessi per dieci fotogrammi di fila (prima la foto cambiava di
        // corsa in corsa).
        await page.waitForFunction((selector) => {
          const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
          const target = document.querySelector(selector);
          if (!scroller || !target) return false;
          target.scrollIntoView({ block: "end" });
          const firma = `${scroller.scrollHeight}:${scroller.scrollTop}:${Math.round(target.getBoundingClientRect().bottom)}`;
          const fermo = window.__finoFirma === firma ? (window.__finoFermo ?? 0) + 1 : 0;
          window.__finoFirma = firma;
          window.__finoFermo = fermo;
          return fermo >= 10;
        }, card, { polling: "raf" });
      },
    })),
    // Lo spazio «Esporta in PDF» (T70) sul telefono: la prima forma, col
    // pannello sotto le pagine.
    {
      id: "mobile-esporta-pdf",
      title: "Il telefono: lo spazio «Esporta in PDF», col pannello sotto le pagine",
      viewport: PHONE,
      prepare: (page) => openExportSpace(page),
    },
    // La formula in riga toccata (T60) sul telefono: il riquadro non esce
    // dallo schermo.
    {
      id: "mobile-formula",
      title: "Il telefono: la formula in riga toccata, il riquadro dentro lo schermo",
      query: "live=formula-toccata",
      viewport: PHONE,
      prepare: (page) => touchFormula(page, "inline"),
    },
    // La tavolozza (T62) sul telefono: sotto la formula, a tutta larghezza,
    // la griglia a otto colonne.
    {
      id: "mobile-formula-tavolozza",
      title: "Il telefono: la tavolozza della formula a tutta larghezza, con «Tutti» aperto",
      query: "live=formula-toccata",
      viewport: PHONE,
      prepare: (page) => touchFormula(page, "palette"),
    },
    // Al tocco (T66): il dito porta il cursore nella formula, la tavolozza
    // sta sotto e dice «Tocca», nessun velo di passaggio.
    {
      id: "mobile-formula-tocco",
      title: "Al tocco: il dito porta il cursore sotto la radice, la tavolozza sotto la formula",
      query: "live=formula-toccata",
      viewport: PHONE,
      touch: true,
      prepare: (page) => touchFormula(page, "touch"),
    },
    // La testata della pagina (T6) sul telefono: la copertina bassa, le
    // colonne delle proprietà strette.
    {
      id: "mobile-testata",
      title: "Il telefono: la testata in Scrittura, con la copertina bassa e le colonne strette",
      query: "live=testata",
      viewport: PHONE,
      prepare: (page) => openHeader(page, "live_preview"),
    },
    // I tipi di nota (T33) sul telefono: «Nuova nota» dal cassetto chiede il
    // tipo dentro lo schermo; l'avviso del tipo che non c'è va a capo.
    {
      id: "mobile-tipi-nuova",
      title: "Il telefono: «Nuova nota» chiede il tipo, il menu dentro lo schermo",
      query: "live=tipo",
      viewport: PHONE,
      prepare: (page) => openNoteTypes(page, "new"),
    },
    {
      id: "mobile-tipi-mancante",
      title: "Il telefono: la testata di una nota il cui tipo non c'è, con «Scegli il tipo»",
      query: "live=tipo-mancante",
      viewport: PHONE,
      prepare: (page) => openNoteTypes(page, "missing"),
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
    // La linea del tempo della Base in piedi (T34): il nome sopra la barra.
    {
      id: "mobile-base-tempo",
      title: "Il telefono: la linea del tempo della Base, il nome sopra la barra",
      query: "base=tempo",
      viewport: PHONE,
      prepare: openTimeline,
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
    // La griglia al dito (griglia T7 e T8), sulla cartella grande: un tocco
    // lungo su B3 mette le due maniglie, e quella di fine tirata fino a B6
    // allarga la selezione, come lo stato «Al telefono» del prototipo.
    {
      id: "mobile-grid-tocco-lungo",
      title: "Il telefono: la griglia con le maniglie del tocco lungo su B3:B6",
      query: "workbook=large",
      viewport: PHONE,
      touch: true,
      prepare: touchGridHandles,
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
    // **La regola al tocco** (T26a, E18 «Al tocco»): dove non c'è il
    // puntatore il «+» e la maniglia stanno sul blocco del cursore, e la
    // barra sopra la tastiera porta il gruppo di quel blocco. Il tocco è
    // quello emulato da Chromium (`(hover: none)`, `(pointer: coarse)`).
    // A riposo, senza cursore: niente maniglie. Col cursore in un compito,
    // la tastiera su: maniglia sul compito, «Compito · Scadenza» nella barra.
    // La presa: il dito tenuto 300 ms sulla maniglia prende il blocco.
    ...[
      ["mobile-tocco-01-riposo", "Al tocco, a riposo: la nota senza cursore, nessuna maniglia", "panoramica", "rest"],
      ["mobile-tocco-02-cursore", "Al tocco, il cursore in un compito: «+» e maniglia sul compito, «Compito» nella barra sopra la tastiera", "compito-attivo", "cursor"],
      ["mobile-tocco-03-presa", "Al tocco, la presa: il dito tenuto 300 ms sulla maniglia prende il compito", "compito-attivo", "hold"],
    ].map(([id, title, live, gesture]) => ({
      id,
      title,
      query: `live=${live}`,
      viewport: PHONE,
      touch: true,
      prepare: (page) => touchBlocks(page, gesture),
    })),
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
));

/// Le scene col tocco acceso (`touch: true`) vanno in fondo, nel loro
/// ordine: il fotografo e il controllo d'accessibilità usano una pagina sola
/// per luce, e dopo il tocco emulato Chromium non rimette più
/// `(hover: hover)` (`touchOn`). Chi viene prima vede il puntatore.
function touchLast(scenes) {
  return [...scenes.filter((scene) => !scene.touch), ...scenes.filter((scene) => scene.touch)];
}

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
/// Apre lo spazio «Esporta in PDF» dal menu «…» del riquadro col fuoco e
/// aspetta che l'impaginazione sia finita: la banda dice le pagine e i
/// fogli visibili hanno le loro fasce.
async function openExportSpace(page) {
  await page.click(".pane.focus [data-pane-menu]");
  await page.click('#context-menu [role=menuitem]:has-text("Esporta in PDF")');
  await page.waitForSelector(".export-space .export-band-pages");
  await page.waitForFunction(() => {
    const pages = document.querySelector(".export-space .export-band-pages")?.textContent ?? "";
    return /^\d/.test(pages) && document.querySelector(".export-space .export-slot .export-fascia") !== null;
  }, null, { timeout: 15_000 });
  // L'entrata dello spazio è finita, e il puntatore non sta su un controllo.
  await page.waitForFunction(() => document.querySelector(".export-space")?.getAnimations().length === 0);
  await page.mouse.move(0, 0);
}

/// Il clic su un blocco delle pagine dello spazio «Esporta in PDF» (T76): la
/// fascia che ha `text`, o quella del diagramma se `text` è `null`; aspetta il
/// menu aperto col blocco contornato.
async function openExportBlockMenu(page, text) {
  // La nota ha un diagramma: disegnato nella resa misurata e sulla pagina.
  await page.waitForFunction(() => {
    const drawn = [...(document.querySelector(".export-measure")?.querySelectorAll(".mermaid-diagram") ?? [])];
    return drawn.length > 0 && drawn.every((figure) => figure.dataset.state !== "loading")
      && document.querySelector(".export-space .export-fascia .mermaid-diagram img") !== null;
  }, null, { timeout: 15_000 });
  const band = text === null
    ? page.locator(".export-space .export-fascia:has(.mermaid-diagram)").first()
    : page.locator(".export-space .export-fascia", { hasText: text }).first();
  await band.scrollIntoViewIfNeeded();
  const box = await band.boundingBox();
  if (!box) throw new Error("la fascia del blocco non si vede");
  await page.mouse.click(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2);
  await page.waitForSelector("#context-menu [role^=menuitem]");
  await page.waitForSelector(".export-space .export-fascia.is-selected");
}

/// Apre la sezione Diagrammi dello spazio «Esporta in PDF», apre la riga dei
/// nodi e sceglie il blu della tavolozza (`#1f4f8f`); aspetta che la resa
/// rimontata sia di nuovo impaginata, coi diagrammi disegnati.
async function openExportDiagrams(page) {
  await page.click('.export-section[data-section="diagrammi"] .export-section-head');
  await page.waitForSelector(".export-dg-styles");
  await page.click("#export-dg-color-diagramma-nodi");
  await page.click("#export-dg-ink-diagramma-nodi-1f4f8f");
  await page.waitForSelector("#export-dg-reset-diagramma-nodi");
  await page.waitForFunction(() => {
    const pages = document.querySelector(".export-space .export-band-pages")?.textContent ?? "";
    const host = document.querySelector(".export-measure");
    const drawn = [...(host?.querySelectorAll(".mermaid-diagram") ?? [])];
    return /^\d/.test(pages) && drawn.length > 0 && drawn.every((figure) => figure.dataset.state !== "loading")
      && document.querySelector(".export-space .export-slot .export-fascia") !== null;
  }, null, { timeout: 15_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// Apre le sezioni Tema e Colori dello spazio «Esporta in PDF» e la riga
/// dell'accento, poi porta il pannello in cima.
async function openThemeSections(page) {
  await page.click('.export-section[data-section="tema"] .export-section-head');
  await page.click('.export-section[data-section="colori"] .export-section-head');
  await page.click("#export-color-accento");
  await page.waitForSelector("#export-color-palette-accento");
  await page.evaluate(() => {
    const side = document.querySelector(".export-side");
    if (side) side.scrollTop = 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

/// Apre Caratteri e Pagina (T72) e aspetta i caratteri del vault caricati,
/// coi pulsanti scritti nel loro carattere.
async function openFontSections(page) {
  await page.click('.export-section[data-section="caratteri"] .export-section-head');
  await page.waitForSelector('.export-font[data-vault="Caratteri/Macchina.woff2"]');
  await page.click('.export-section[data-section="pagina"] .export-section-head');
  await page.waitForSelector(".export-doc[data-guides=true] .export-guide");
  await page.evaluate(async () => {
    await document.fonts.ready;
    const side = document.querySelector(".export-side");
    if (side) side.scrollTop = 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

/// Apre le sezioni Contenuto e Interruzioni, sceglie i commenti nel margine,
/// le tabelle a griglia e il codice numerato, aspetta le pagine rifatte e
/// porta in vista la pagina coi commenti e la sezione Contenuto.
async function openContentSections(page) {
  await page.click('.export-section[data-section="contenuto"] .export-section-head');
  await page.click('.export-section[data-section="interruzioni"] .export-section-head');
  await page.click("#export-content-comments-margine");
  await page.click("#export-content-tables-griglia");
  await page.click("#export-content-code");
  await page.waitForFunction(() => {
    const pages = document.querySelector(".export-space .export-band-pages")?.textContent ?? "";
    return /^\d/.test(pages) && document.querySelector(".export-space .export-page .export-comment-placed") !== null;
  }, null, { timeout: 15_000 });
  await page.evaluate(() => {
    const side = document.querySelector(".export-side");
    const section = document.querySelector('.export-section[data-section="contenuto"]');
    if (side && section instanceof HTMLElement) side.scrollTop = section.offsetTop - side.offsetTop;
    const note = document.querySelector(".export-space .export-page .export-comment-placed");
    const stage = document.querySelector(".export-stage");
    if (note && stage) {
      const top = note.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop;
      stage.scrollTop = Math.max(0, top - 160);
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

/// Porta lo spazio «Esporta in PDF» dove sta il passo 29 del prototipo (il
/// profilo «Relazione per il Comune»): tema Relazione, frontespizio e indice,
/// in testata la sezione a sinistra e il titolo a destra, nel piè la data a
/// sinistra e «pagina di pagine» a destra; le sezioni Frontespizio e Testata
/// aperte, due pagine affiancate (T73).
async function openFrontSections(page) {
  await page.click('.export-section[data-section="tema"] .export-section-head');
  await page.click('.export-theme[data-theme="relazione"]');
  await page.click('.export-section[data-section="tema"] .export-section-head');
  await page.click('.export-section[data-section="fronte"] .export-section-head');
  await page.click("#export-front-cover");
  await page.click("#export-front-toc");
  await page.click('.export-section[data-section="testata"] .export-section-head');
  for (const [slot, label] of [["sopra-sinistra", "Sezione"], ["sotto-sinistra", "Data"], ["sotto-centro", "Niente"], ["sotto-destra", "Pagina di pagine"]]) {
    await page.click(`#export-header-${slot}`);
    await page.click(`#context-menu [role=menuitemradio]:has-text("${label}")`);
    await page.waitForSelector("#context-menu", { state: "detached" });
  }
  // Sotto i 760 px le viste non ci sono (la finestra della conformità a 700).
  if (await page.isVisible('.export-segment[data-view="due"]')) await page.click('.export-segment[data-view="due"]');
  await page.waitForSelector(".export-space .export-cover-title");
  await page.waitForSelector(".export-space .export-toc-row");
  // L'indice ha i numeri veri quando l'impaginazione è finita.
  await page.waitForFunction(() => [...document.querySelectorAll(".export-space .export-toc-page")].every((node) => /^\d+$/.test(node.textContent ?? "")), null, { timeout: 15_000 });
  await page.evaluate(() => {
    const side = document.querySelector(".export-side");
    if (side) side.scrollTop = 0;
    const stage = document.querySelector(".export-stage");
    if (stage) stage.scrollTop = 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}
/// Le scene che soltanto il banco dei gesti apre (`bench/grid-gestures.mjs`):
/// non hanno una foto di riferimento né un passaggio del banco
/// dell'accessibilità, e le baseline restano tutte quelle di `SCENE`.
///
/// **La cartella grande** (griglia T1): 3000 righe per 20 colonne con la riga
/// 1 e la colonna A bloccate, fatta in codice dal finto (`?workbook=large`).
/// I controlli G1 ci scorrono sopra.
export const GESTURE_SCENE = onPage("shell", [
  {
    id: "grid-large",
    title: "Grid v2: una cartella grande, con la riga e la colonna bloccate",
    query: "workbook=large",
    prepare: (page) => openWorkbook(page, "Dati/Grande.xlsx"),
  },
  // **Le misure tirate** (griglia T5): la stessa cartella, col finto che dice
  // sì a `home.columnWidth` e `home.rowHeight` come l'host vero
  // (`?misure=si`). I controlli G5 ci tirano i bordi.
  {
    id: "grid-large-misure",
    title: "Grid v2: la cartella grande, che accetta le misure tirate",
    query: "workbook=large&misure=si",
    prepare: (page) => openWorkbook(page, "Dati/Grande.xlsx"),
  },
  // **Riempire, copiare, incollare** (griglia T6): la stessa cartella, col
  // finto che dice sì ai riempimenti e a `fub.pasteFrom` (`?risposte=si`);
  // C4 vale 10 e C5 20, come nel prototipo. I controlli G6 ci riempiono e ci
  // copiano, e la coreografia del riempimento ci aspetta la risposta.
  {
    id: "grid-large-appunti",
    title: "Grid v2: la cartella grande, che accetta riempimenti e incolla",
    query: "workbook=large&risposte=si",
    prepare: (page) => openWorkbook(page, "Dati/Grande.xlsx"),
  },
  // **Le velocità della selezione** (griglia T9): la stessa cartella con
  // `editor.grid.selection-speed` scelta dal finto (`?velocita=…`). Il mouse
  // fitto di G3 ci gira con ogni scelta.
  ...[["quick", "svelta"], ["soft", "morbida"], ["none", "a scatti"]].map(([speed, name]) => ({
    id: `grid-large-${speed}`,
    title: `Grid v2: la cartella grande, con la selezione ${name}`,
    query: `workbook=large&velocita=${speed}`,
    prepare: (page) => openWorkbook(page, "Dati/Grande.xlsx"),
  })),
]);

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
/// Il cursore in fondo alla riga del foglio a fuoco che contiene `text`, con
/// la barra di formato già montata coi suoi pulsanti.
async function placeCursorOn(page, text) {
  await page.waitForSelector(".pane.focus .format-bar.kit-bar .kit-bar-button");
  await page.click(`.pane.focus .pane-editor .cm-content .cm-line:has-text(${JSON.stringify(text)})`);
  await page.keyboard.press("End");
}

/// Sceglie tre parole nella riga che comincia con `line`, come la tastiera:
/// il cursore a inizio riga, tre parole avanti, tre scelte con Maiusc.
async function selectWords(page, line) {
  await page.click(`.pane.focus .pane-editor .cm-content .cm-line:has-text(${JSON.stringify(line)})`);
  await page.keyboard.press("Home");
  for (let step = 0; step < 3; step++) await page.keyboard.press("Control+ArrowRight");
  for (let step = 0; step < 3; step++) await page.keyboard.press("Control+Shift+ArrowRight");
}

/// Il riquadro del testo scelto nella nota a fuoco, letto quando lo strato
/// della selezione l'ha raggiunto. CodeMirror cambia la selezione del documento
/// subito, al tasto, ma ridisegna lo strato al suo fotogramma di misura: letto
/// prima, lo strato è ancora quello del tasto di prima (#488). Si aspetta che
/// copra la selezione del documento e resti fermo per due fotogrammi.
async function selectionBox(page) {
  await page.evaluate(() => delete globalThis.__benchSelection);
  const found = await page.waitForFunction(() => {
    const layer = document.querySelector(".pane.focus .cm-selectionBackground")?.getBoundingClientRect();
    const chosen = getSelection();
    const range = chosen && chosen.rangeCount > 0 ? chosen.getRangeAt(0).getBoundingClientRect() : null;
    const covers = layer && range && range.width > 0 && Math.abs(layer.left - range.left) < 1 && Math.abs(layer.right - range.right) < 1;
    const at = covers ? `${layer.x} ${layer.y} ${layer.width} ${layer.height}` : null;
    const seen = (globalThis.__benchSelection ??= { at: null, frames: 0 });
    seen.frames = at !== null && seen.at === at ? seen.frames + 1 : 0;
    seen.at = at;
    return seen.frames >= 2 && { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  }, null, { polling: "raf" });
  return found.jsonValue();
}

/// Lo scorrimento della nota a fuoco fermo: lo stesso per tre fotogrammi di
/// fila. Con `toEnd` prima lo porta in fondo, e lo riporta finché il fondo non
/// smette di spostarsi.
///
/// Ctrl+Fine non basta da solo: CodeMirror scorre al suo fotogramma di misura,
/// e le altezze delle righe mai disegnate sono stime che cambiano appena le
/// disegna. Il clic che segue cadeva a volte prima di quello scorrimento:
/// Playwright portava la riga in vista da sé, e la foto mostrava un altro
/// tratto della nota a ogni corsa (`barra-blocco-stretta`, un terzo dei pixel
/// diversi fra due corse dello stesso codice).
async function scrollerAtRest(page, { toEnd = false } = {}) {
  if (toEnd) {
    // Il fondo dipende dalle altezze di tutte le righe: misurate alla misura
    // di adesso, e non stimate da quella di prima (la nota si apre a finestra
    // larga, poi la finestra si stringe). Si percorre la nota a mezze
    // pagine finché un giro intero non cambia più l'altezza.
    await page.evaluate(async () => {
      const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
      if (!scroller) throw new Error("la nota a fuoco non ha lo scorrimento");
      const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (let pass = 0, height = -1; pass < 6 && height !== scroller.scrollHeight; pass += 1) {
        height = scroller.scrollHeight;
        for (let top = 0; top <= scroller.scrollHeight; top += scroller.clientHeight / 2) {
          scroller.scrollTop = top;
          await frames();
        }
      }
    });
  }
  await page.evaluate(() => delete globalThis.__benchScroll);
  await page.waitForFunction((end) => {
    const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
    if (!scroller) return false;
    const bottom = scroller.scrollHeight - scroller.clientHeight;
    if (end && Math.abs(scroller.scrollTop - bottom) > 1) scroller.scrollTop = bottom;
    const at = `${scroller.scrollTop} ${scroller.scrollHeight}`;
    const seen = (globalThis.__benchScroll ??= { at: null, frames: 0 });
    seen.frames = seen.at === at ? seen.frames + 1 : 0;
    seen.at = at;
    return seen.frames >= 3;
  }, toEnd, { polling: "raf" });
}

/// La barra misurata (il «…» deciso al fotogramma) e il puntatore lontano,
/// senza suggerimenti. La bolla della mini-barra, se c'è, ferma: lo stesso
/// posto per tre fotogrammi di fila (si riposa quando la sua misura cambia).
async function settleBar(page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => delete globalThis.__benchBubble);
  await page.waitForFunction(() => {
    const bubble = document.querySelector(".selection-bubble:not([hidden])");
    const at = bubble ? `${bubble.style.left} ${bubble.style.top} ${bubble.getBoundingClientRect().width}` : "";
    const seen = (globalThis.__benchBubble ??= { at: null, frames: 0 });
    seen.frames = seen.at === at ? seen.frames + 1 : 0;
    seen.at = at;
    return seen.frames >= 3;
  }, null, { polling: "raf" });
}

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
/// Il velo della selezione di blocchi copre la scheda scelta bordo per bordo,
/// e le righe sotto le schede stanno dove CodeMirror le misura (IMP-155): i
/// margini della scheda gli sfuggivano, e il velo saliva di 18 px.
async function expectVeilOnCard(page, card) {
  await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-mark");
  const wrong = await page.evaluate(async (selector) => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const chosen = document.querySelector(selector).getBoundingClientRect();
    const mark = document.querySelector(".pane.focus .pane-editor .cm-fub-block-mark").getBoundingClientRect();
    const out = [];
    if (Math.abs(mark.top - chosen.top) > 0.5 || Math.abs(mark.bottom - chosen.bottom) > 0.5) {
      out.push(`velo ${mark.top}–${mark.bottom}, scheda ${chosen.top}–${chosen.bottom}`);
    }
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    for (const line of document.querySelectorAll(".pane.focus .pane-editor .cm-fub-live-card-slot + .cm-line")) {
      const measured = view.lineBlockAt(view.posAtDOM(line)).top + view.documentTop;
      const seen = line.getBoundingClientRect().top;
      if (Math.abs(measured - seen) > 0.5) out.push(`riga sotto una scheda misurata a ${measured}, vista a ${seen}`);
    }
    return out.join("; ");
  }, `${card}[data-card-chosen="true"]`);
  if (wrong) throw new Error(`il velo non sta sulla scheda: ${wrong}`);
}

/// Aspetta un pezzo di una scheda della Live. Se non arriva, l'errore nomina
/// il pezzo e il selettore, e dice com'era ogni scheda del riquadro: la specie,
/// lo stato e il modo della scheda, lo stato della sua vista e il suo testo.
/// Il rapporto del fotografo tiene la prima riga dell'errore, quindi tutto sta
/// su una riga.
async function waitForCardPart(page, selector, what) {
  try {
    await page.waitForSelector(selector);
  } catch (error) {
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll(".pane.focus .pane-editor .live-card")].map((card) => {
        const view = card.querySelector("[data-card-state]:not(.live-card)");
        const text = (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        return `${card.dataset.cardKind ?? "?"} ${card.dataset.cardState ?? "?"}/${card.dataset.cardMode ?? "-"} vista ${view?.dataset.cardState ?? "-"} «${text}»`;
      })).catch(() => ["la pagina non risponde"]);
    const first = String(error?.message ?? error).split("\n")[0];
    throw new Error(`${what} non è arrivato (${selector}): ${first}; schede: ${cards.length === 0 ? "nessuna" : cards.join(" · ")}`);
  }
}

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

/// Dove sta la riga del cursore nella nota a fuoco: lo scorrimento, quanto può
/// scorrere al più e il bordo alto della riga nella finestra.
function caretLinePlace(page) {
  return page.evaluate(async () => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const { node } = view.domAtPos(view.state.selection.main.head);
    const line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
    if (!line) throw new Error("il cursore non sta in una riga");
    const scroller = view.scrollDOM;
    return { scrollTop: scroller.scrollTop, maxScroll: scroller.scrollHeight - scroller.clientHeight, lineTop: line.getBoundingClientRect().top };
  });
}

/// La formula toccata (T60). `inline`: → davanti alla formula in riga, poi
/// due → fino al numeratore. `block`: il clic su ogni pezzo del blocco `$$`
/// deve portare il cursore lì (il posto detto al lettore di schermo), e la
/// foto resta col cursore nel numeratore. `error`: → davanti alla formula rotta.
async function touchFormula(page, gesture) {
  const ready = ".cm-fub-mx-surface[data-state=\"ready\"]";
  const said = () => page.evaluate(() => document.querySelector(".cm-fub-mx [role=status]")?.textContent ?? "");
  if (gesture === "menu") {
    // Il menu della formula (T65): il tasto destro sulla formula in riga, la
    // nota ferma; le voci si contano, se no la scena è rossa.
    await openLive(page, [], "top");
    await page.click(".cm-content .cm-fub-math", { button: "right" });
    await page.waitForSelector("#context-menu .menu-head");
    // I riquadri di «Copia come» non hanno testo: si leggono dal nome.
    const items = await page.locator("#context-menu [role=menuitem]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") || node.textContent || ""));
    for (const label of ["Modifica", "Copia come LaTeX", "Copia come immagine", "Copia come equazione", "Da riga a blocco"]) {
      if (!items.some((item) => item.includes(label))) throw new Error(`nel menu della formula manca «${label}»: ${items.join(" · ")}`);
    }
    await page.mouse.move(0, 0);
    return;
  }
  if (gesture === "align") {
    // Invio nel blocco (T65): la formula in un aligned, il cursore sulla riga
    // nuova, e ciò che si scrive ci entra.
    await openLive(page, [], "top");
    const box = await page.locator(".cm-content .math-block").first().boundingBox();
    if (!box) throw new Error("manca il blocco $$");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("y");
    const doc = await page.evaluate(async () => {
      const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
      return findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement).state.doc.toString();
    });
    if (!/\\begin\{aligned\}[\s\S]*&=\s*y\s*\\end\{aligned\}/.test(doc)) throw new Error(`Invio nel blocco non allinea: ${doc}`);
    await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    await page.mouse.move(0, 0);
    return;
  }
  if (gesture === "choose" || gesture === "matrix" || gesture === "touch") {
    // Scegliere un pezzo, le matrici, il tocco (T66), nel blocco $$.
    const cdp = gesture === "touch" ? await touchOn(page) : null;
    if (cdp && (await page.evaluate(() => matchMedia("(hover: hover)").matches))) throw new Error("il tocco emulato non ha tolto il passaggio");
    await openLive(page, [], "top");
    const centre = async (selector, fy = 0.5, fx = 0.5) => {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`la formula non ha ${selector}`);
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };
    if (cdp) {
      // Un tocco sulla formula la apre; il dito, poi, porta il cursore dal
      // numeratore fin sotto la radice, senza scegliere niente.
      const tap = async (point) => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
      await tap(await centre(".cm-content .math-block .mfrac", 0.2));
      await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
      const from = await centre(".cm-fub-mx-block .mfrac", 0.2);
      const to = await centre(".cm-fub-mx-block .sqrt", 0.5, 0.7);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      for (let step = 1; step <= 8; step++) {
        const point = { x: from.x + ((to.x - from.x) * step) / 8, y: from.y + ((to.y - from.y) * step) / 8 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      if ((await said()) !== "sotto la radice") throw new Error(`il dito non porta il cursore sotto la radice: ${await said()}`);
      if (await page.locator(".cm-fub-mx-block [data-fubsel]").count()) throw new Error("il dito ha scelto un pezzo");
      // La tavolozza sotto la formula, con l'invito al tocco.
      await page.waitForSelector(".cm-fub-mx-block .cm-fub-mx-palette .cm-fub-mx-quick .cm-fub-mx-tile .katex");
      const tip = await page.locator(".cm-fub-mx-block .cm-fub-mx-tip").textContent();
      if (tip !== "Tocca un simbolo per metterlo nella formula") throw new Error(`l'invito della tavolozza non è quello del tocco: ${tip}`);
      await page.waitForFunction(() => document.getAnimations().length === 0);
      return;
    }
    const box = await page.locator(".cm-content .math-block").first().boundingBox();
    if (!box) throw new Error("manca il blocco $$");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    await page.keyboard.press("End");
    if (gesture === "choose") {
      // Maiusc ← tre volte: la radice, il +, poi x con il suo esponente.
      for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
      const picked = await page.waitForSelector(".cm-fub-mx-block [data-fubsel] .sqrt", { timeout: 5000 }).then(() => true, () => false);
      if (!picked) {
        const seen = await page.evaluate(() => {
          const mx = document.querySelector(".cm-fub-mx-block");
          return `scelta=${mx?.dataset.chosen} segni=${mx?.querySelectorAll("[data-fubsel]").length} detto=${mx?.querySelector("[role=status]")?.textContent} fuoco=${document.activeElement?.className}`;
        });
        throw new Error(`Maiusc ← non sceglie la radice: ${seen}`);
      }
      await page.waitForSelector(".cm-fub-mx-block [data-fubsel] .msupsub");
      if (await page.locator(".cm-fub-mx-block [data-fubsel] .mfrac").count()) throw new Error("la scelta ha preso anche la frazione");
      if ((await said()) !== "pezzo scelto") throw new Error(`la scelta non si dice: ${await said()}`);
    } else {
      // Una matrice dalla tavolozza: Tab passa alla cella dopo, Invio alla
      // riga dopo e, dall'ultima, ne aggiunge una.
      await page.keyboard.type("+");
      await page.click(".cm-fub-mx-block .cm-fub-mx-all");
      await page.click(".cm-fub-mx-block .cm-fub-mx-find-input");
      await page.keyboard.type("matrice");
      await page.click('.cm-fub-mx-block .cm-fub-mx-grid .cm-fub-mx-tile[aria-label="Matrice 2 per 2"]');
      await page.waitForSelector(`.cm-fub-mx-block ${ready} [data-fubhole]`);
      await page.keyboard.type("1");
      await page.keyboard.press("Tab");
      await page.keyboard.type("0");
      await page.keyboard.press("Enter");
      await page.keyboard.type("1");
      await page.keyboard.press("Enter");
      if ((await said()) !== "riga 3, colonna 1, spazio vuoto") throw new Error(`Invio dall'ultima riga non porta alla riga nuova: ${await said()}`);
      const doc = await page.evaluate(async () => {
        const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
        return findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement).state.doc.toString();
      });
      if (!/\\begin\{pmatrix\}\s*1\s*&\s*0\s*\\\\\s*&\s*1\s*\\\\\s*&\s*\\end\{pmatrix\}/.test(doc)) throw new Error(`la matrice non è quella attesa: ${doc}`);
      await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    }
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    return;
  }
  if (gesture.startsWith("source")) {
    // Il campo del LaTeX (T63). La scena prova che il campo c'è, che la
    // scrittura veloce trasforma e che gli aiuti fanno quello che dicono; se
    // no è rossa.
    const field = ".cm-fub-mx[data-mode=\"source\"] .cm-fub-mx-field";
    if (gesture === "source-block") {
      await openLive(page, [], "top");
      const box = await page.locator(".cm-content .math-block").first().boundingBox();
      if (!box) throw new Error("manca il blocco $$");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector(`.cm-fub-mx-block ${field}`);
      await page.click(`.cm-fub-mx-block ${field}`);
    } else {
      await openLive(page, ["@ArrowRight"], "top");
      await page.waitForSelector(`.cm-fub-mx-popover ${field}`);
    }
    await page.waitForSelector(`.cm-fub-mx[data-mode="source"] ${ready}`);
    const value = () => page.locator(field).first().inputValue();
    await page.keyboard.press("End");
    if (gesture === "source" || gesture === "source-block") {
      await page.keyboard.type(gesture === "source" ? "+a/" : " ->y");
      const tex = await value();
      const expected = gesture === "source" ? "+\\frac{a}{}" : "\\to y";
      if (!tex.endsWith(expected)) throw new Error(`la scrittura veloce non trasforma: ${tex}`);
      await page.waitForSelector(".cm-fub-mx-palette .cm-fub-mx-quick .cm-fub-mx-tile .katex");
    } else if (gesture === "source-options") {
      await page.click(".cm-fub-mx-row .cm-fub-mx-more");
      await page.waitForSelector(".cm-fub-mx-options:not([hidden]) [data-help=\"piene\"][aria-pressed=\"true\"]");
      // «Posto» (T65): la formula in riga in un paragrafo può farsi blocco.
      await page.waitForSelector(".cm-fub-mx-options [data-place=\"inline\"][aria-pressed=\"true\"]");
    } else if (gesture === "source-discrete") {
      await page.keyboard.type("+a/b");
      if (!(await value()).endsWith("+a/b")) throw new Error(`coi discreti «a/b» si trasforma: ${await value()}`);
      if (await page.locator(".cm-fub-mx-palette").isVisible()) throw new Error("coi discreti la tavolozza si vede senza chiederla");
      await page.waitForSelector(".cm-fub-mx-palette-toggle:not([hidden])");
      await page.keyboard.type("+\\al");
      await page.waitForSelector(".cm-fub-mx-symbols:not([hidden]) .cm-fub-mx-symbol-code");
    } else if (gesture === "source-unknown" || gesture === "source-brace" || gesture === "source-guesses") {
      // Gli errori in chiaro (T64): il nome che non c'è (Esc chiude le
      // proposte), la graffa aperta, il nome con più simboli vicini.
      const typed = { "source-unknown": "+\\alfa", "source-brace": "+x^{2", "source-guesses": "+\\s 1" }[gesture];
      await page.keyboard.type(typed);
      if (gesture === "source-unknown") {
        await page.waitForSelector(".cm-fub-mx-symbols:not([hidden])");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".cm-fub-mx-symbols", { state: "hidden" });
      }
      const tex = await value();
      await page.waitForSelector(".cm-fub-mx-error:not([hidden])");
      if ((await value()) !== tex) throw new Error(`il TeX è cambiato da solo: ${tex} → ${await value()}`);
      const sentence = await page.locator(".cm-fub-mx-error-text").textContent();
      const fix = await page.locator(".cm-fub-mx-error-fix").allTextContents();
      const expected = {
        "source-unknown": ["Non conosco \\alfa. Forse volevi \\alpha?", ["Usa \\alpha"]],
        "source-brace": ["Manca una } di chiusura.", ["Chiudi"]],
        "source-guesses": [/^Non conosco \\s\. Forse volevi .+ o .+\?$/, []],
      }[gesture];
      const sentenceOk = typeof expected[0] === "string" ? sentence === expected[0] : expected[0].test(sentence ?? "");
      if (!sentenceOk || fix.join("|") !== expected[1].join("|")) throw new Error(`la frase dell'errore non è quella attesa: ${sentence} · ${fix.join("|")}`);
    } else {
      await page.keyboard.type("+a/b->c (");
      if (!(await value()).endsWith("+a/b->c (")) throw new Error(`con gli aiuti spenti qualcosa si trasforma: ${await value()}`);
      if (await page.locator(".cm-fub-mx-palette").isVisible()) throw new Error("con gli aiuti spenti c'è la tavolozza");
    }
  } else if (gesture.startsWith("palette") || gesture.startsWith("search")) {
    // La tavolozza (T62): la formula in riga aperta (o il blocco), «Tutti» e,
    // per la ricerca, una parola nel campo; da tastiera Alt ↓ e una freccia.
    if (gesture === "palette-block") {
      await openLive(page, [], "top");
      const box = await page.locator(".cm-content .math-block").first().boundingBox();
      if (!box) throw new Error("manca il blocco $$");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    } else {
      await openLive(page, ["@ArrowRight"], "top");
      await page.waitForSelector(`.cm-fub-mx-popover ${ready}`);
    }
    await page.waitForSelector(".cm-fub-mx-quick .cm-fub-mx-tile .katex");
    if (gesture === "palette-keys") {
      await page.keyboard.press("Alt+ArrowDown");
      await page.keyboard.press("ArrowRight");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      const tip = await page.locator(".cm-fub-mx-tip .cm-fub-mx-tip-name").textContent();
      if (focused !== "Potenza" || tip !== "Potenza") throw new Error(`Alt ↓ e → non portano a «Potenza»: ${focused}, ${tip}`);
    } else {
      await page.click(".cm-fub-mx-all");
      await page.waitForSelector(".cm-fub-mx-grid .cm-fub-mx-tile .katex");
      if (gesture.startsWith("search")) {
        await page.click(".cm-fub-mx-find-input");
        await page.keyboard.type(gesture === "search" ? "freccia" : "zzz");
        await page.waitForSelector(gesture === "search" ? ".cm-fub-mx-searching .cm-fub-mx-grid .cm-fub-mx-tile" : ".cm-fub-mx-none");
        if (gesture === "search") {
          const first = await page.locator(".cm-fub-mx-grid .cm-fub-mx-tile").first().getAttribute("aria-label");
          if (first !== "Freccia a destra") throw new Error(`«freccia» non dà prima le frecce: ${first}`);
        }
      }
    }
  } else if (gesture === "symbols" || gesture === "symbols-block") {
    // Le proposte dei simboli (T61): in fondo alla formula, `+` e il nome.
    if (gesture === "symbols") {
      await openLive(page, ["@ArrowRight"], "top");
      await page.waitForSelector(`.cm-fub-mx-popover ${ready}`);
    } else {
      await openLive(page, [], "top");
      const box = await page.locator(".cm-content .math-block").first().boundingBox();
      if (!box) throw new Error("manca il blocco $$");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    }
    await page.keyboard.press("End");
    await page.keyboard.type(gesture === "symbols" ? "+\\fr" : "+\\s");
    await page.waitForSelector(".cm-fub-mx-symbols:not([hidden]) [aria-selected=\"true\"] .katex");
    const names = await page.locator(".cm-fub-mx-symbol-name").allTextContents();
    if (names.length < 3) throw new Error(`poche proposte: ${names.join(", ")}`);
  } else if (gesture === "block") {
    await openLive(page, [], "top");
    const centre = async (selector, fy = 0.5, fx = 0.5) => {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`la formula non ha ${selector}`);
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };
    // Il primo clic, sulla formula resa, la apre già nel numeratore.
    const first = await centre(".cm-content .math-block .mfrac", 0.2);
    await page.mouse.click(first.x, first.y);
    await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    const clicks = [
      [".cm-fub-mx-block .mfrac", 0.85, 0.5, "denominatore"],
      [".cm-fub-mx-block .msupsub", 0.3, 0.6, "esponente di x"],
      [".cm-fub-mx-block .sqrt", 0.5, 0.7, "sotto la radice"],
      [".cm-fub-mx-block .mfrac", 0.15, 0.5, "numeratore"],
    ];
    const wrong = [];
    if ((await said()) !== "numeratore") wrong.push(`apertura: ${await said()}`);
    for (const [selector, fy, fx, expected] of clicks) {
      const point = await centre(selector, fy, fx);
      await page.mouse.click(point.x, point.y);
      const got = await said();
      if (got !== expected) wrong.push(`${expected}: ${got}`);
    }
    if (wrong.length) throw new Error(`il clic non porta il cursore dove cade: ${wrong.join("; ")}`);
  } else {
    await openLive(page, ["@ArrowRight"], "top");
    await page.waitForSelector(gesture === "error" ? ".cm-fub-mx[data-mode=\"latex\"] .cm-fub-mx-latex" : `.cm-fub-mx-popover ${ready}`);
    // Sotto il LaTeX, che cosa non va, con la correzione (T64).
    if (gesture === "error") await page.waitForSelector(".cm-fub-mx[data-mode=\"latex\"] .cm-fub-mx-error:not([hidden]) .cm-fub-mx-error-fix");
    if (gesture === "inline") {
      // Un pezzo alla volta: v, =, poi dentro la frazione.
      for (let i = 0; i < 6 && (await said()) !== "numeratore"; i++) await page.keyboard.press("ArrowRight");
      if ((await said()) !== "numeratore") throw new Error(`le frecce non entrano nel numeratore: ${await said()}`);
    }
  }
  // Il puntatore lontano dai bottoni: nessun suggerimento nella foto.
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
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

/// I tipi di nota (T33): la nota della Live a riposo, poi il gesto. `new`
/// apre «Nuova nota» (dal cassetto, che in una finestra stretta si apre
/// prima); `typed` e `missing` aspettano che la testata sappia il tipo;
/// `choose` apre «Scegli il tipo» da tastiera.
async function openNoteTypes(page, gesture) {
  await openHeader(page, "live_preview");
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "typed") await page.waitForSelector(".pane.focus .cm-fub-page-icon[data-from-type]");
  if (gesture === "missing" || gesture === "choose") await page.waitForSelector(".pane.focus .cm-fub-page-type-notice");
  if (gesture === "new") {
    const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
    if (compact) {
      await page.click('#views-ribbon .rail-btn[data-panel="files"]');
      await page.waitForSelector("#sidebar-scrim:not([hidden])");
    }
    await page.waitForSelector("#types-list:not([hidden]) .type-row");
    // Il «+» del cassetto apre il menu «Nuovo» (S34); la sua «Nota» è il
    // gesto di «Nuova nota», che coi tipi nel vault chiede il tipo sotto il
    // «+» (E5).
    await page.click("#new-note");
    await page
      .locator('#context-menu[aria-label="Nuovo"] [role=menuitem]')
      .filter({ has: page.locator(".menu-label", { hasText: /^Nota$/ }) })
      .click();
    await page.waitForSelector(".note-type-popover .note-type-menu-item");
  }
  if (gesture === "choose") {
    await page.focus(".pane.focus .cm-fub-page-type-action");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".note-type-popover .note-type-menu-item");
  }
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await frames();
}

/// Gli editor dei tipi (T8): apre la testata a riposo, poi l'editor della
/// voce che il gesto dice, come lo apre chi usa Fub. Il puntatore resta
/// sull'editor aperto solo quando è il puntatore ad aprirlo.
async function openPropertyEditor(page, gesture) {
  await openHeader(page, "live_preview", gesture === "list" ? "more" : undefined);
  if (!gesture) return;
  const row = (key) => `.pane.focus .cm-fub-page-prop[data-key="${key}"]`;
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "text" || gesture === "date") {
    const key = gesture === "text" ? "tipo" : "scadenza";
    await page.focus(`${row(key)} .cm-fub-page-prop-value`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(gesture === "text" ? `${row(key)} .cm-fub-prop-input` : ".cm-fub-prop-date");
  } else if (gesture === "people" || gesture === "list") {
    await page.click(`${row(gesture === "people" ? "persone" : "luoghi")} .cm-fub-page-prop-value`);
    await page.waitForSelector(gesture === "people" ? ".cm-fub-prop-people [role=option]" : ".cm-fub-prop-list");
  } else {
    await page.click(`${row("stato")} .cm-fub-page-prop-key`);
    await page.waitForSelector(".cm-fub-prop-menu");
    if (gesture === "type") {
      await page.locator(".cm-fub-prop-menu [role^=menuitem]", { hasText: "Tipo" }).first().click();
      await page.waitForSelector(".cm-fub-prop-menu [role=menuitemradio]");
    }
  }
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await frames();
}

/// La Relazione (T35): `open` apre il riquadro col puntatore sul valore
/// (non sul nome, che apre la nota); `create` lo apre da tastiera e scrive
/// un nome che non c'è.
async function openRelationEditor(page, gesture) {
  await openHeader(page, "live_preview");
  const row = '.pane.focus .cm-fub-page-prop[data-key="libri"]';
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "open") {
    const box = await page.locator(`${row} .cm-fub-page-prop-value`).boundingBox();
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
    await page.waitForSelector(".cm-fub-prop-relation [role=option]:not(.cm-fub-prop-group)");
  } else if (gesture === "create") {
    await page.focus(`${row} .cm-fub-page-prop-value`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".cm-fub-prop-relation [role=option]");
    await page.keyboard.type("Neuromante");
    await page.waitForSelector(".cm-fub-prop-relation .cm-fub-prop-create");
  }
  if (gesture !== "open") await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await frames();
}

/// Le scene di Selezione e Stato (T9): `more` apre «Altre», `status` apre l'elenco dello Stato da
/// tastiera (il fuoco sul valore e Invio); `create` apre la Selezione col
/// puntatore e scrive un nome che non c'è.
async function openOptionsEditor(page, gesture) {
  await openHeader(page, "live_preview", gesture === "more" ? "more" : undefined);
  const row = (key) => `.pane.focus .cm-fub-page-prop[data-key="${key}"]`;
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "status") {
    await page.focus(`${row("stato")} .cm-fub-page-prop-value`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".cm-fub-prop-choices .cm-fub-prop-group");
  } else if (gesture === "create") {
    await page.click(`${row("sala")} .cm-fub-page-prop-value`);
    await page.waitForSelector(".cm-fub-prop-choices [role=option]");
    await page.keyboard.type("Media");
    await page.waitForSelector(".cm-fub-prop-choices .cm-fub-prop-create");
  }
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await frames();
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
/// Il tocco emulato da Chromium: `(hover: none)`, `(any-hover: none)` e
/// `(pointer: coarse)`. Non si spegne più: spento, Chromium rimette il
/// puntatore fine ma lascia `(hover: none)` a ogni documento dello stesso
/// processo, anche dopo una navigazione. Per questo le scene che lo
/// accendono hanno `touch: true` e stanno in fondo (`touchLast`).
async function touchOn(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return cdp;
}

/// La griglia al dito: apre la cartella grande, tiene il dito su B3 oltre
/// `LONG_PRESS_MS` (450 ms in `editors/grid/engine.ts`) finché compaiono le due
/// maniglie, e tira quella di fine fino a B6. Il dito passa dal browser vero
/// (`Input.dispatchTouchEvent`), come in `bench/grid-gestures.mjs`.
async function touchGridHandles(page) {
  const cdp = await touchOn(page);
  await openRibbon(page, "phone", "Dati/Grande.xlsx");
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(({ x, y }) => ({ x, y, id: 1 })) });
  const b3 = await gridCellCenter(page, 2, 1);
  const b6 = await gridCellCenter(page, 5, 1);
  await send("touchStart", [b3]);
  await page.waitForFunction(() => [...document.querySelectorAll(".pane.focus .grid-mark-touch")].filter((mark) => !mark.hidden).length === 2);
  await send("touchEnd", []);
  const grip = await page.evaluate(() => {
    const mark = [...document.querySelectorAll('.pane.focus .grid-mark-touch[data-handle="b"]')].find((el) => !el.hidden);
    const box = mark?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  });
  if (!grip) throw new Error("la maniglia di fine del tocco lungo non si vede");
  await send("touchStart", [grip]);
  for (let step = 1; step <= 10; step += 1) {
    const t = step / 10;
    await send("touchMove", [{ x: grip.x + (b6.x - grip.x) * t, y: grip.y + (b6.y - grip.y) * t }]);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  await send("touchEnd", []);
  await page.waitForFunction(() => document.querySelectorAll(".pane.focus .grid-cell.selected").length === 4);
  await marksAtRest(page);
}

/// La tastiera a schermo, finta: un browser senza schermo non l'ha, e ciò
/// che la shell ne sa è che il viewport visivo si accorcia.
async function keyboardUp(page) {
  await page.evaluate(() => {
    const view = window.visualViewport;
    Object.defineProperty(view, "height", { configurable: true, get: () => window.innerHeight - 320 });
    view.dispatchEvent(new Event("resize"));
  });
  await page.waitForSelector(':root[data-mobile-keyboard="visible"]');
}

/// Le scene al tocco (T26a). `rest`: la nota senza cursore. `cursor`: il
/// cursore nel compito e la tastiera su, la barra col gruppo «Compito».
/// `hold`: in più, il dito tenuto sulla maniglia finché il blocco è in mano.
async function touchBlocks(page, gesture) {
  const cdp = await touchOn(page);
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) throw new Error("il tocco emulato non ha tolto il passaggio");
  await openLive(page, [], "top");
  await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles", { state: "attached" });
  await page.waitForFunction(() => document.getAnimations().length === 0);
  if (gesture === "rest") {
    await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles", { state: "hidden" });
    return;
  }
  await keyboardUp(page);
  await settleLive(page, false);
  // Il compito a metà della parte che la tastiera lascia: la colonna del «+»
  // e della maniglia sborda sopra e sotto la riga, e si vede intera.
  await page.evaluate(async () => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const caret = view.coordsAtPos(view.state.selection.main.head);
    const box = view.scrollDOM.getBoundingClientRect();
    if (caret) view.scrollDOM.scrollTop += (caret.top + caret.bottom) / 2 - (box.top + box.height / 2);
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForSelector('.pane.focus > .format-bar .format-bar-context[data-block="task"]:not([hidden])');
  await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-grip", { state: "visible" });
  if (gesture === "hold") {
    const box = await page.locator(".pane.focus .pane-editor .cm-fub-block-grip").boundingBox();
    if (!box) throw new Error("la maniglia non si vede");
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Il dito resta giù: la foto è del blocco in mano.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-lift");
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// Le parole della riga di «treno» che il doppio clic sceglie (i link no: il
/// clic li segue), nell'ordine della riga; l'ultima è quella della foto.
const LINE_WORDS = ["Il", "parte", "alle", "otto", "il", "bus", "no", "Energia", "acqua", "da", "ricordare", "codice", "treno"];

/// Doppio clic su `word` nella riga di «treno» della panoramica: la selezione
/// dev'essere la parola e il suo disegno un rettangolo solo, largo quanto la
/// parola (#411 A-05). Se no lancia, con le larghezze viste.
async function expectWordPainted(page, word) {
  // La bolla della parola di prima può coprire questa: la selezione si
  // chiude e la bolla se ne va prima di misurare.
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector(".selection-bubble:not([hidden])", { state: "detached" });
  // Il posto della parola si chiede alla vista per offset, non ai nodi di
  // testo: le parole uguali a quella scelta si evidenziano e spezzano i nodi.
  const target = await page.evaluate(async (wanted) => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const doc = view.state.doc;
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (!line.text.includes("treno")) continue;
      const match = new RegExp(`(?<!\\p{L})${wanted}(?!\\p{L})`, "u").exec(line.text);
      if (!match) return null;
      const start = view.coordsAtPos(line.from + match.index, 1);
      const end = view.coordsAtPos(line.from + match.index + wanted.length, -1);
      if (!start || !end) return null;
      return { x: (start.left + end.right) / 2, y: (start.top + start.bottom) / 2, width: end.right - start.left };
    }
    return null;
  }, word);
  if (!target) throw new Error(`la parola «${word}» non è nella riga di «treno»`);
  await page.mouse.dblclick(target.x, target.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const seen = await page.evaluate(async () => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const { from, to } = view.state.selection.main;
    const painted = [...document.querySelectorAll(".pane.focus .cm-selectionBackground")].map((b) => b.getBoundingClientRect().width);
    return { chosen: view.state.sliceDoc(from, to), painted };
  });
  if (seen.chosen !== word) throw new Error(`il doppio clic su «${word}» ha scelto «${seen.chosen}»`);
  // Un rettangolo solo, largo quanto la parola: il margine copre le marche
  // nascoste attorno alla parola (`==…==`), che la vista conta nei bordi.
  if (seen.painted.length !== 1 || Math.abs(seen.painted[0] - target.width) > 12) {
    throw new Error(`«${word}» (${Math.round(target.width)} px) si dipinge come ${seen.painted.map(Math.round).join(" + ") || "niente"} px`);
  }
}

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

/// Porta in fondo la nota della Live a fuoco con un'impaginazione che non
/// dipende da come ci si è arrivati (#510).
///
/// CodeMirror disegna solo le righe vicine alla vista (il suo «viewport»); le
/// altre le conta con l'ultima altezza misurata o con una stima, e la Live
/// toglie le decorazioni di riga (i titoli) a ciò che esce dal viewport.
/// Scorrere subito in fondo dava così due impaginazioni, a seconda che il
/// viewport coprisse ancora la nota intera o no: quale delle due dipendeva da
/// quando le schede vive finivano di montarsi rispetto allo scorrimento, e le
/// righe in vista si spostavano di una frazione di pixel (la foto cambiava di
/// un pixel da un giro all'altro).
///
/// Qui la finestra si allunga finché la nota ci sta tutta: CodeMirror disegna
/// e misura ogni blocco, schede comprese, nel loro stato finale. Poi la
/// finestra torna com'era e si scorre in fondo: un viewport che copre la nota
/// intera resta valido (CodeMirror lo rifà solo se lascia scoperta la vista o
/// va troppo oltre), e la foto non dipende più dalla storia. Pronto è una
/// condizione, non un ritardo: la nota disegnata tutta, senza vuoti stimati
/// (`.cm-gap`), nessuna scheda in caricamento, l'altezza ferma e lo
/// scorrimento in fondo. Se non ci si arriva, si alza.
async function scrollLiveToEnd(page) {
  const settled = () => page.evaluate(async () => {
    const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
    if (!scroller) throw new Error("la nota a fuoco non ha lo scorrimento di CodeMirror");
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const loading = () => scroller.querySelector('.live-card[data-card-state="loading"], [data-state="loading"]') !== null;
    // Misurata: l'altezza e lo scorrimento fermi per due fotogrammi, e
    // nessuna scheda che legge ancora il suo file.
    for (let tries = 0; tries < 100; tries += 1) {
      const before = [scroller.scrollHeight, scroller.scrollTop];
      await frame();
      await frame();
      if (!loading() && scroller.scrollHeight === before[0] && scroller.scrollTop === before[1]) {
        return {
          overflow: scroller.scrollHeight - scroller.clientHeight,
          gaps: scroller.querySelectorAll(".cm-content > .cm-gap").length,
          bottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
        };
      }
    }
    throw new Error("la nota non si ferma: CodeMirror rimisura a ogni fotogramma");
  });
  const window = page.viewportSize();
  if (!window) throw new Error("la pagina non ha una finestra fissa");
  let state = await settled();
  for (let tries = 0; state.overflow > 0 || state.gaps > 0; tries += 1) {
    if (tries >= 10) throw new Error(`la nota non sta in una finestra lunga: avanza di ${state.overflow} px con ${state.gaps} vuoti`);
    const { height } = page.viewportSize();
    await page.setViewportSize({ width: window.width, height: height + Math.max(state.overflow, 0) + 200 });
    state = await settled();
  }
  await page.setViewportSize(window);
  await settled();
  for (let tries = 0; ; tries += 1) {
    if (tries >= 10) throw new Error("la nota non resta in fondo: la sua altezza cambia a ogni giro");
    await page.evaluate(() => {
      const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
      scroller.scrollTop = scroller.scrollHeight;
    });
    state = await settled();
    if (state.bottom) break;
  }
  // In fondo la nota dev'essere ancora disegnata tutta: se CodeMirror avesse
  // rifatto il viewport, la foto tornerebbe a dipendere da quando.
  if (state.gaps > 0) throw new Error("in fondo la nota ha di nuovo dei vuoti stimati: è troppo lunga per questa preparazione");
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
/// Il bottone «Spazio di lavoro» della banda (K6 T7), col suo menu aperto.
/// Il primo oggetto scelto da tastiera (`Home`), come lo sceglie chi usa la tastiera.
async function scegliPrimo(page) {
  await page.focus(".draw-editor .draw-surface");
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
}

/// Il menu ≡ del Completo con Oggetto aperto (K6 T9a): le voci dell'indice di
/// prova. Si apre col pulsante, poi si va su Oggetto col mouse, come chi usa il
/// mouse: il sottomenu si apre di lato.
async function openMenuOggetto(page) {
  await openDrawing(page);
  // Un oggetto scelto, come nello stato «un punto scelto» del prototipo. Con
  // la tastiera: il menu che si apre dopo mostra l'anello del fuoco di chi usa
  // la tastiera (WCAG 2.4.7). Col mouse, senza tastiera, non c'è (misurato).
  await scegliPrimo(page);
  await page.click(".draw-header button[aria-label=\"Disegno\"]");
  await page.waitForSelector("#context-menu [role='menuitem']:has-text('Oggetto')");
  await page.hover("#context-menu [role='menuitem']:has-text('Oggetto')");
  // Il terzo livello (K6 T9c): Oggetto › Tracciato, aperto come nel prototipo.
  await page.waitForSelector(".context-submenu [role='menuitem']:has-text('Tracciato')");
  await page.hover(".context-submenu [role='menuitem']:has-text('Tracciato')");
  await page.waitForSelector(".context-submenu [role='menuitem']:has-text('Sposta tracciato')");
  await page.evaluate(() => document.fonts.ready);
}

/// La tavolozza di Ctrl+/ con la ricerca «sposta» (K6 T9a): le voci che
/// cominciano così, col loro posto, il tasto e il perché di quella spenta.
async function openTavolozza(page) {
  await openDrawing(page);
  // Un oggetto scelto, come nello stato «un punto scelto» del prototipo.
  await scegliPrimo(page);
  await page.keyboard.press("Control+/");
  await page.waitForSelector(".draw-commands-dialog .draw-commands-row");
  await page.fill(".draw-commands-dialog .draw-commands-field input", "sposta");
  await page.waitForFunction(() => document.querySelectorAll(".draw-commands-dialog .draw-commands-row").length >= 5);
  await page.evaluate(() => document.fonts.ready);
}

/// Impostazioni › Scorciatoie con la sezione «Disegno completo» aperta e
/// portata in cima.
async function openDrawingKeys(page) {
  await page.click("#open-settings");
  await page.click('#settings-tabs button[data-tab="shortcuts"]');
  await page.waitForSelector("#settings-body details.drawing-keys > summary");
  await page.click("#settings-body details.drawing-keys > summary");
  await page.waitForSelector('#settings-body .setting-row[data-setting-key="draw.keys:draw.path.reverse"]');
  await page.$eval("#settings-body details.drawing-keys", (details) => details.closest("section")?.scrollIntoView({ block: "start" }));
  await page.evaluate(() => document.fonts.ready);
}

/// Impostazioni con il riquadro «Motore del disegno» aperto, la categoria
/// «Guide e griglia» aperta e il riquadro portato in cima.
async function openEnginePrefs(page) {
  await page.click("#open-settings");
  const riquadro = '#settings-body details[data-details-key="drawing-engine"]';
  await page.waitForSelector(`${riquadro} > summary`);
  await page.click(`${riquadro} > summary`);
  const griglia = `${riquadro} details[data-details-key="drawing-engine:Guides & Grid"]`;
  await page.waitForSelector(`${griglia} > summary`);
  await page.click(`${griglia} > summary`);
  await page.waitForSelector(`${griglia}[open] .kit-form`);
  await page.$eval(riquadro, (details) => details.scrollIntoView({ block: "start" }));
  await page.evaluate(() => document.fonts.ready);
}

/// La stessa sezione dopo «Importa un insieme…» con un file che non è JSON.
async function importBrokenKeySet(page) {
  await openDrawingKeys(page);
  const chooser = page.waitForEvent("filechooser");
  await page.click("#settings-body .drawing-keys-set button:first-of-type");
  await (await chooser).setFiles({ name: "tasti.json", mimeType: "application/json", buffer: Buffer.from("{non è json") });
  await page.waitForSelector('#settings-body .drawing-keys [role="alert"]');
  await page.$eval("#settings-body details.drawing-keys", (details) => details.closest("section")?.scrollIntoView({ block: "start" }));
}

async function openWorkspaceMenu(page) {
  await openDrawing(page);
  await page.waitForSelector("#status-workspace:not([hidden])");
  await page.click("#status-workspace");
  await page.waitForSelector("#context-menu [role='menuitemradio']");
}

/// Il Completo che non si carica (K6 T7): il modulo del suo ingresso non
/// arriva, e il menu dello spazio dice che non si è caricato, con «Riprova».
async function openWorkspaceErrorMenu(page) {
  await page.route("**/completo/index.ts*", (route) => route.abort());
  await openWorkspaceMenu(page);
  await page.waitForSelector("#context-menu [role='menuitem']:has-text('Riprova')");
}

/// La tendina della casella a più strumenti (K6 T8): la matita, con la freccia
/// di lato da tastiera, come la apre chi usa la tastiera.
async function openColumnGroup(page) {
  await openDrawing(page);
  // La prima casella con il triangolino: quella che ha più strumenti.
  await page.waitForSelector('.draw-rail .kit-rail-slot:has(.kit-rail-corner)');
  await page.focus('.draw-rail .kit-rail-slot:has(.kit-rail-corner)');
  await page.evaluate(() => {
    const casella = document.querySelector('.draw-rail .kit-rail-slot:has(.kit-rail-corner)');
    // La freccia di lato: destra in colonna, su in fila (il foglio stretto).
    const lato = casella.closest(".kit-rail").dataset.orientation === "horizontal" ? "ArrowUp" : "ArrowRight";
    casella.dispatchEvent(new KeyboardEvent("keydown", { key: lato, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector(".kit-rail-flyout [role='menuitemradio']");
}

/// La Selezione diretta del motore (K6 T11) scelta dalla sua casella: la
/// casella si accende quando la famiglia è pronta.
async function scegliSelezioneDiretta(page) {
  await openDrawing(page);
  const casella = '.draw-rail .kit-rail-slot[data-slot="motore:directSelection"]';
  await page.waitForSelector(casella);
  await page.click(casella);
  await page.waitForSelector(`${casella}[aria-pressed="true"], ${casella} [aria-pressed="true"], ${casella}.is-active, ${casella}[data-active]`, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

/// «Tutti gli strumenti» (K6 T8): il cassetto aperto dalla sua casella; con
/// `cerca`, il campo della ricerca scritto.
async function openDrawerScene(page, cerca = "") {
  await openDrawing(page);
  await page.click('.draw-rail .kit-rail-slot[data-slot="all"]');
  await page.waitForSelector(".draw-drawer-popover .draw-drawer-tool");
  if (cerca !== "") await page.fill(".draw-drawer-field input", cerca);
}

/// Il fuoco da tastiera sul bottone dello spazio (K6 T7): l'anello si vede.
async function focusWorkspaceButton(page) {
  await openDrawing(page);
  await page.waitForSelector("#status-workspace:not([hidden])");
  await page.evaluate(() => document.querySelector("#status-workspace")?.focus({ focusVisible: true }));
}

/// Apre il disegno e la scheda Risorse dell'ispettore (K6 T10): il pannello
/// della scheda è quello che si vede, con i campioni del documento.
async function openRisorse(page) {
  await openDrawing(page);
  await page.click('.inspector-tab[data-view-id="draw.resources"]');
  await page.waitForSelector('#surface-panel-draw-resources:not([hidden]) .draw-resources');
}

/// Apre il disegno, sceglie lo strumento Selezione dalla colonna, clicca un
/// punto vuoto del foglio e seleziona tutto: l'ispettore mostra il Design con la
/// selezione (K6 T10). Il clic su una forma non la sceglie nel Completo di
/// oggi, e il punto singolo del prototipo è di T12.
async function openDesignoScelto(page) {
  await openDesignoVuoto(page);
  await page.click('.draw-rail [aria-label="Selezione"]');
  const foglio = await page.locator(".draw-editor .draw-surface").first().boundingBox();
  if (!foglio) throw new Error("il foglio del disegno non c'è");
  await page.mouse.click(foglio.x + 30, foglio.y + 30);
  await page.keyboard.press("Control+a");
  // Il titolo del pannello dice la selezione, non «Il disegno».
  await page.waitForFunction(() => {
    const soggetto = document.querySelector("#surface-panel-draw-design .draw-properties-subject");
    return soggetto !== null && soggetto.textContent.trim() !== "" && !soggetto.textContent.includes("Il disegno");
  });
}

/// Apre il disegno e la scheda Design dell'ispettore, senza nulla scelto (K6 T10).
async function openDesignoVuoto(page) {
  await openDrawing(page);
  await page.click('.inspector-tab[data-view-id="draw.design"]');
  await page.waitForSelector('#surface-panel-draw-design:not([hidden]) section.draw-properties');
}

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

/// Apre il disegno dei connettori e la finestra del comando nello stato `stato`
/// (`finestra`, `caricamento` o `errore`), e aspetta che lo stato sia dipinto:
/// col fuoco dove la finestra lo mette.
async function openDrawingWindow(page, stato) {
  await openDrawing(page);
  await page.evaluate((each) => window.bench.finestra(each), stato);
  const dialog = ".kit-dialog.draw-effect-dialog";
  if (stato === "finestra") {
    await page.waitForSelector(`${dialog} .kit-number-input`);
    await page.waitForSelector(`${dialog} [data-action="ok"]:not([disabled])`);
  } else if (stato === "caricamento") {
    await page.waitForSelector(`${dialog} .kit-form-note[role="status"]`);
  } else {
    await page.waitForSelector(`${dialog} .kit-form-error`);
  }
  await page.evaluate(() => document.fonts.ready);
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
  // In Scrittura il PDF incorporato è una scheda viva (T41, le scene
  // `schede-vive-*`); l'anteprima di Craft e il link di T31 sono della Lettura.
  await chooseMode(page, "reading");
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

/// Aspetta la Base incorporata nella nota della Live, con le sue righe.
async function waitForEmbeddedBase(page) {
  await page.waitForFunction(() => {
    const base = document.querySelector('.pane.focus .base-surface[data-embedded="true"]');
    return (base?.querySelectorAll(".base-table tbody tr").length ?? 0) > 0
      && base?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
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

/// Apre la linea del tempo di `?base=tempo` e aspetta le sue barre.
/// Apre la Mappa di `?base=mappa`: i segnaposto disegnati e la riga sotto la
/// mappa scritta (dopo la lettura degli host ammessi).
async function openMap(page) {
  await page.evaluate(async () => {
    const { openDocument } = await import("/src/state/document-controller.ts");
    await openDocument("Opere.base");
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".pane.focus");
    return (pane?.querySelectorAll(".base-map-marker").length ?? 0) > 0
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true"
      && (pane?.querySelector(".base-map-enable") !== null || pane?.querySelector(".base-map-settings") !== null);
  });
}

/// La Mappa con le tessere: «Attiva», poi le quattro tessere del livello 1.
async function openMapTiles(page) {
  await openMap(page);
  await page.click(".pane.focus .base-map-enable");
  await page.waitForFunction(() => document.querySelectorAll(".pane.focus .base-map-tiles image").length === 4);
  await page.mouse.move(0, 0);
}

async function openTimeline(page) {
  await page.evaluate(async () => {
    const { openDocument } = await import("/src/state/document-controller.ts");
    await openDocument("Opere.base");
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".pane.focus");
    return (pane?.querySelectorAll(".base-tl-bar").length ?? 0) > 0
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
async function openWorkbook(page, path = "Dati/Conti.xlsx") {
  await openFolder(page, "Dati");
  await page.click(`#file-list .tree-row[data-path="${path}"]`);
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
/// `path` è la cartella: di solito quella delle scene della barra.
async function openRibbon(page, width, path = "Dati/Conti.xlsx") {
  await openFromTree(page, path, '.pane.focus .grid-surface[data-grid-protocol="v2"] [role="gridcell"]');
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

/// Il testo lungo della cella aperta, lo stesso del prototipo delle celle.
const LONG_CELL_TEXT = "Luce 4 — bolletta di gennaio e febbraio, con il conguaglio";

/// Apre la cartella grande delle scene degli stati della griglia
/// (`?workbook=large`), col foglio largo come nelle scene della barra.
function openLargeSheet(page, width) {
  return openRibbon(page, width, "Dati/Grande.xlsx");
}

/// Sceglie l'intervallo da `from` a `to` (riga e colonna da zero) come una
/// persona: un clic sulla prima cella, poi Maiusc e le frecce. Aspetta che i
/// lati del rettangolo stiano sui bordi delle due celle: col movimento ridotto
/// ci arrivano subito.
async function pickGridRange(page, [r0, c0], [r1, c1]) {
  const { x, y } = await gridCellCenter(page, r0, c0);
  await page.mouse.click(x, y);
  await page.waitForFunction(
    ([r, c]) => {
      const active = document.querySelector(".pane.focus .grid-cell.active");
      return active?.dataset.row === String(r) && active?.dataset.column === String(c);
    },
    [r0, c0],
  );
  for (let c = c0; c < c1; c += 1) await page.keyboard.press("Shift+ArrowRight");
  for (let r = r0; r < r1; r += 1) await page.keyboard.press("Shift+ArrowDown");
  await page.waitForFunction(
    ([r, c, n]) => document.querySelectorAll(".pane.focus .grid-cell.selected").length === n
      && document.querySelector(".pane.focus .grid-cell.active")?.dataset.row === String(r)
      && document.querySelector(".pane.focus .grid-cell.active")?.dataset.column === String(c),
    [r0, c0, (r1 - r0 + 1) * (c1 - c0 + 1)],
  );
  await marksAtRest(page);
}

/// Aspetta che i segni della griglia stiano fermi per due fotogrammi di fila.
async function marksAtRest(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const root = document.querySelector(".pane.focus .grid-viewport");
    const look = () => [...root.querySelectorAll(".grid-mark")].map((mark) => `${mark.hidden}${mark.style.transform}${mark.style.width}${mark.style.height}`).join("|");
    let before = look();
    let still = 0;
    const tick = () => {
      const now = look();
      still = now === before ? still + 1 : 0;
      before = now;
      if (still >= 2) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

/// Scorre la griglia a `top`, `left` e aspetta che le righe e i segni siano
/// ridisegnati.
async function scrollGrid(page, top, left) {
  await page.evaluate(([t, l]) => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    viewport.scrollTop = t;
    viewport.scrollLeft = l;
  }, [top, left]);
  await page.waitForFunction(
    ([t, l]) => {
      const viewport = document.querySelector(".pane.focus .grid-viewport");
      return Math.abs(viewport.scrollTop - t) < 1 && Math.abs(viewport.scrollLeft - l) < 1;
    },
    [top, left],
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await marksAtRest(page);
}

/// Prende il bordo destro dell'ultima colonna che, tirata di 60 px, resta
/// dentro il riquadro (come lo sceglie il prototipo), lo tira di 60 px e lo
/// tiene: la misura dal vivo si vede.
async function dragColumnNearEdge(page) {
  const edge = await page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport").getBoundingClientRect();
    const near = [...document.querySelectorAll(".pane.focus .grid-column-header")]
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.right + 60 <= viewport.right - 4)
      .sort((a, b) => b.right - a.right)[0];
    return near ? { x: near.right - 1, y: near.top + near.height / 2 } : null;
  });
  if (!edge) throw new Error("nessun bordo di colonna vicino al lato destro");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  for (const dx of [10, 30, 50, 60]) await page.mouse.move(edge.x + dx, edge.y);
  await page.waitForSelector(".pane.focus .grid-resize-label:not([hidden])");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
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
