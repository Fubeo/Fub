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
// [0109](../../docs/decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md):
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

export const SCENE = [
  // -------------------------------------------------------------------------
  // La shell: `index.html` vera, `main.ts` vero, l'host finto di là.
  // -------------------------------------------------------------------------
  {
    id: "startup",
    title: "Come si apre",
    query: "",
    // La scena senza gesti. È la più importante e la più facile da non fare:
    // è l'unica che dice cosa vede chi apre Fub, prima di aver deciso niente.
    prepare: async () => {},
  },
  {
    id: "explore",
    title: "L'albero del vault, aperto",
    query: "",
    prepare: async (page) => {
      // Due cartelle aperte e una nidificata: il rientro si vede solo al
      // secondo livello, ed è dove un tema sbaglia la guida verticale.
      for (const path of ["Guida", "Progetti", "Progetti/Archivio"]) {
        await openFolder(page, path);
      }
    },
  },
  {
    id: "search",
    title: "La ricerca, con i risultati",
    query: "",
    prepare: async (page) => {
      await page.fill("#search-input", SEARCH);
      await page.waitForSelector("#search-results li");
    },
  },
  {
    id: "palette",
    title: "La palette dei comandi",
    query: "",
    prepare: async (page) => {
      await page.click("#open-palette");
      await page.waitForSelector("#command-palette .palette-row");
    },
  },
  {
    id: "menu",
    title: "Il menu applicativo, aperto",
    query: "",
    prepare: async (page) => {
      await page.click("#app-menu > button >> nth=0");
      await page.waitForSelector("#context-menu:not([hidden])");
    },
  },
  {
    id: "settings",
    title: "Le impostazioni: la configurazione",
    query: "",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.waitForSelector("#settings-body .setting-row");
    },
  },
  {
    id: "settings-components",
    title: "Le impostazioni: i componenti",
    query: "",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.click('#settings-tabs button[data-tab="components"]');
      await page.waitForSelector("#settings-body");
    },
  },
  {
    id: "settings-vault",
    title: "Le impostazioni: i vault conosciuti",
    query: "",
    prepare: async (page) => {
      await page.click("#open-settings");
      await page.click('#settings-tabs button[data-tab="vault"]');
      await page.waitForSelector("#settings-body");
    },
  },
  {
    id: "activity",
    title: "Il centro attività",
    query: "",
    prepare: async (page) => {
      await page.click("#activity-button");
      await page.waitForSelector("#activity-panel:not([hidden])");
    },
  },
  {
    id: "toast",
    title: "L'avviso mentre succede",
    query: "",
    prepare: async (page) => {
      // Il toast è l'unica superficie che compare **senza** che l'utente
      // l'abbia chiesta, e l'unica che vive cinque secondi: si fotografa dentro
      // quella finestra, o non si fotografa affatto.
      await page.evaluate((e) => window.bench.emit(e), FAILURES.severe);
      await page.waitForSelector("#toast");
    },
  },
  {
    id: "notices",
    title: "Il centro notifiche, con due guasti",
    query: "",
    prepare: async (page) => {
      // I due gradini di `Severity`, che diventano i due toni: un avviso e un
      // guasto. Nessun bottone li produce — arrivano dal kernel — quindi li
      // manda il banco dalla porta che ha per questo.
      await page.evaluate(
        ([a, b]) => {
          window.bench.emit(a);
          window.bench.emit(b);
        },
        [FAILURES.minor, FAILURES.severe],
      );
      // **Il toast se ne deve andare prima dello scatto.** Sta sopra il
      // pannello e vive cinque secondi: fotografarlo qui vorrebbe dire una
      // scena che contiene due superfici e non sapere quale si stava
      // guardando — e il toast ha già la sua, qui sopra.
      await page.waitForSelector("#toast", { state: "detached", timeout: 15_000 });
      await page.click("#notify-button");
      await page.waitForSelector("#notify-list li");
    },
  },
  {
    id: "reading",
    title: "Modalità Lettura: il documento reso",
    query: "",
    prepare: async (page) => {
      await openNote(page, "Guida/Sintassi di Fub.md");
      await page.click('#mode-switch button[data-mode="reading"]');
      await page.waitForSelector(".pane-preview h1, .markdown-preview h1");
    },
  },
  {
    id: "source",
    title: "Modalità Sorgente: la tavolozza della sintassi",
    query: "",
    prepare: async (page) => {
      await openNote(page, "Guida/Frammenti di codice.md");
      await page.click('#mode-switch button[data-mode="source"]');
      await page.waitForSelector(".cm-content");
    },
  },
  {
    id: "inspector",
    title: "L'ispettore, sulla seconda scheda",
    query: "",
    prepare: async (page) => {
      await page.click("#right-pane .inspector-tab >> nth=1");
      await page.waitForSelector("#right-pane .ui-list-item, #right-pane .ui-empty-state");
    },
  },
  {
    id: "graph",
    title: "Il grafo dei collegamenti",
    query: "",
    prepare: async (page) => {
      await page.click('#views-ribbon button[aria-label="Il grafo dei collegamenti"]');
      await page.waitForSelector("canvas.graph-main");
      await waitForGraphToSettle(page);
    },
  },
  {
    id: "focus",
    title: "Il fuoco da tastiera, dal principio",
    query: "",
    prepare: async (page) => {
      // Sei tabulazioni dal salto al contenuto: il legame di salto, il primo
      // bottone della menubar, il trigger di ricerca, le tre modalità. È l'unica
      // scena che guarda `:focus-visible`, ed è lo stato che si perde per primo
      // quando si riscrive un componente.
      await page.evaluate(() => document.body.focus());
      for (let i = 0; i < 6; i += 1) await page.keyboard.press("Tab");
    },
  },
  {
    id: "empty",
    title: "La finestra senza vault",
    query: "vault=vuoto",
    // Nessun gesto: è già tutto ciò che c'è. È la scena che il §11.1 ha reso
    // interessante — senza vault le impostazioni della macchina si leggono
    // lo stesso — e quella che dice se la shell vuota è una finestra o un buco.
    prepare: async () => {},
  },
  {
    id: "nota-tre-modi",
    title: "La stessa nota in Sorgente, Live e Lettura",
    query: "",
    prepare: async (page) => {
      await openNote(page, "Guida/Sintassi di Fub.md");
      await page.click('#mode-switch button[data-mode="source"]');
      await runCommand(page, "Dividi il riquadro a destra");
      await page.click('#mode-switch button[data-mode="live_preview"]');
      await runCommand(page, "Dividi il riquadro a destra");
      await page.click('#mode-switch button[data-mode="reading"]');
      await page.waitForSelector('.pane[data-mode="source"] .cm-content');
      await page.waitForSelector('.pane[data-mode="live_preview"] .cm-content');
      await page.waitForSelector('.pane[data-mode="reading"] .pane-preview');
    },
  },

  // -------------------------------------------------------------------------
  // I tre cataloghi (`bench/catalog.html`).
  // -------------------------------------------------------------------------
  {
    id: "catalog-components",
    title: "Catalogo: ogni componente in ogni stato",
    page: "catalog",
    query: "catalog=components",
    prepare: async () => {},
  },
  {
    id: "catalog-palette",
    title: "Catalogo: ogni token col suo contrasto",
    page: "catalog",
    query: "catalog=palette",
    prepare: async () => {},
  },
  {
    id: "catalog-samples",
    title: "Catalogo: la scala tipografica",
    page: "catalog",
    query: "catalog=samples",
    prepare: async () => {},
  },
];

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
/// invece l'identità stabile che l'esploratore mette su ogni riga e che non
/// dipende dall'implementazione del tooltip.
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

/// Apre una cartella dell'albero, se non è già aperta. Stessa ragione di sopra
/// per il selettore, e l'idempotenza serve perché due scene aprono `Guida` e una
/// terza apre anche ciò che ci sta dentro.
async function openFolder(page, path) {
  const row = `#file-list .tree-row.folder[data-path="${path}"]`;
  await page.waitForSelector(row);
  const open = await page.evaluate(
    (sel) => document.querySelector(sel)?.querySelector(".chevron")?.textContent === "▾",
    row,
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

/// L'indirizzo di una scena in una luce.
export function sceneUrl(base, scene, light) {
  const page = scene.page === "catalog" ? "/bench/catalog.html" : "/";
  const query = [`light=${light}`, scene.query].filter(Boolean).join("&");
  return `${base}${page}?${query}`;
}
