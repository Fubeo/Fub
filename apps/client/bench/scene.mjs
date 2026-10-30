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
  {
    id: "settings",
    title: "Le preferenze: la configurazione",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.waitForSelector("#settings-body .setting-row");
    },
  },
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
      await page.waitForSelector("#settings-body");
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
  {
    id: "draw-text",
    title: "Il disegno con un testo in scrittura",
    query: "connectors=6",
    prepare: async (page) => {
      await openDrawing(page);
      await page.keyboard.press("t");
      const box = await page.locator(".draw-editor .draw-page").first().boundingBox();
      if (!box) throw new Error("la pagina del disegno non c'è");
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.85);
      await page.keyboard.type("Una scritta");
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
    // Il documento in piedi: la carta sta nella vista, e il pannello del
    // documento sale dal basso, aperto dal pulsante col numero dei commenti.
    {
      id: "mobile-document",
      title: "Il telefono: un .docx con la carta larga quanto la vista e il pulsante dei commenti",
      query: "rich=docx",
      viewport: PHONE,
      prepare: (page) => openRichDocument(page, "Documenti/Prova.docx"),
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
  await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: 30_000 });
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
  // Due fotogrammi: la misura di CodeMirror dopo l'ultima transazione.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// Apre un documento di videoscrittura dall'albero e aspetta che la
/// superficie abbia montato la sua proiezione.
/// In una finestra stretta l'albero sta nel cassetto: lo si apre, e dopo la
/// scelta lo si richiude, perché la foto è del documento.
async function openRichDocument(page, path) {
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await openFolder(page, path.slice(0, path.lastIndexOf("/")));
  await page.click(`#file-list .tree-row[data-path="${path}"]`);
  await page.waitForSelector(".pane.focus .rich-surface .ProseMirror");
  if (compact && await page.isVisible("#sidebar-scrim")) {
    // In alto a destra: in una finestra stretta il cassetto copre il centro,
    // e su un telefono sale dal basso.
    const scrim = await page.locator("#sidebar-scrim").boundingBox();
    await page.click("#sidebar-scrim", { position: { x: scrim.width - 8, y: 8 } });
    await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
  }
}

/// Apre il disegno dei connettori e aspetta che sia dipinto, col fuoco sulla
/// tela, come `connectors.mjs`.
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