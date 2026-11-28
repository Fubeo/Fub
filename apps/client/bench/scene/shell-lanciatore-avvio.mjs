// La shell: la Base nella nota, il lanciatore e l'avvio.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import { waitForEmbeddedBase } from "./gesti-documenti.mjs";
import {
  chooseFromViewMenu,
  drawWholeLive,
  expectVeilOnCard,
  openLive,
  openNote,
  previewShowsActiveRow,
} from "./gesti-scrittura.mjs";
import { NOTE_NARROW, SEARCH } from "./misure.mjs";

export const S_LANCIATORE = [
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
      await drawWholeLive(page);
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
];
