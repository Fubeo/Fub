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
// # Cosa può fare un `prepara`
//
// Riceve la pagina di Playwright e la porta prima dello scatto. Può cliccare,
// scrivere, premere, e può parlare col banco da `window.banco` — che è come si
// producono le cose che nessun bottone produce: un guasto del kernel, una porta
// che rifiuta. Non deve **aspettare un tempo**: il fotografo aspetta già i
// caratteri e il montaggio, e ogni altra attesa va scritta come condizione.

/// Le due luci. Ogni scena si fotografa in tutte e due — è metà della promessa
/// di questo banco, perché il difetto che si cerca nasce quasi sempre in una
/// sola delle due.
export const LUCI = ["dark", "light"];

/// Il testo che il fotografo cerca per sapere che la ricerca ha risposto.
const CERCA = "nota";

/// Un guasto del kernel come lo manderebbe il kernel.
function guasto(severity, subject, message) {
  return { type: "trouble", severity, subject, error: { kind: "internal", message }, gate: null };
}

/// I due gradini di `Severity`, che nella shell diventano i due toni di un
/// avviso. Sono costanti perché due scene li mandano — il toast e il centro
/// notifiche — e due copie della stessa frase sono due frasi che divergono.
const GUASTI = {
  lieve: guasto(
    "warning",
    "Guida/Nota lunga.md",
    "l'indice di ricerca è indietro di due minuti",
  ),
  grave: guasto(
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
    id: "avvio",
    titolo: "Come si apre",
    query: "",
    // La scena senza gesti. È la più importante e la più facile da non fare:
    // è l'unica che dice cosa vede chi apre Fub, prima di aver deciso niente.
    prepara: async () => {},
  },
  {
    id: "esplora",
    titolo: "L'albero del vault, aperto",
    query: "",
    prepara: async (page) => {
      // Due cartelle aperte e una nidificata: il rientro si vede solo al
      // secondo livello, ed è dove un tema sbaglia la guida verticale.
      for (const path of ["Guida", "Progetti", "Progetti/Archivio"]) {
        await apriCartella(page, path);
      }
    },
  },
  {
    id: "ricerca",
    titolo: "La ricerca, con i risultati",
    query: "",
    prepara: async (page) => {
      await page.fill("#search-input", CERCA);
      await page.waitForSelector("#search-results li");
    },
  },
  {
    id: "palette",
    titolo: "La palette dei comandi",
    query: "",
    prepara: async (page) => {
      await page.click("#open-palette");
      await page.waitForSelector("#command-palette .palette-row");
    },
  },
  {
    id: "menu",
    titolo: "Il menu applicativo, aperto",
    query: "",
    prepara: async (page) => {
      await page.click("#app-menu > button >> nth=0");
      await page.waitForSelector("#context-menu:not([hidden])");
    },
  },
  {
    id: "impostazioni",
    titolo: "Le impostazioni: la configurazione",
    query: "",
    prepara: async (page) => {
      await page.click("#open-settings");
      await page.waitForSelector("#settings-body .setting-row");
    },
  },
  {
    id: "impostazioni-componenti",
    titolo: "Le impostazioni: i componenti",
    query: "",
    prepara: async (page) => {
      await page.click("#open-settings");
      await page.click('#settings-tabs button[data-scheda="componenti"]');
      await page.waitForSelector("#settings-body");
    },
  },
  {
    id: "impostazioni-vault",
    titolo: "Le impostazioni: i vault conosciuti",
    query: "",
    prepara: async (page) => {
      await page.click("#open-settings");
      await page.click('#settings-tabs button[data-scheda="vault"]');
      await page.waitForSelector("#settings-body");
    },
  },
  {
    id: "attivita",
    titolo: "Il centro attività",
    query: "",
    prepara: async (page) => {
      await page.click("#activity-button");
      await page.waitForSelector("#activity-panel:not([hidden])");
    },
  },
  {
    id: "toast",
    titolo: "L'avviso mentre succede",
    query: "",
    prepara: async (page) => {
      // Il toast è l'unica superficie che compare **senza** che l'utente
      // l'abbia chiesta, e l'unica che vive cinque secondi: si fotografa dentro
      // quella finestra, o non si fotografa affatto.
      await page.evaluate((e) => window.banco.emetti(e), GUASTI.grave);
      await page.waitForSelector("#toast");
    },
  },
  {
    id: "avvisi",
    titolo: "Il centro notifiche, con due guasti",
    query: "",
    prepara: async (page) => {
      // I due gradini di `Severity`, che diventano i due toni: un avviso e un
      // guasto. Nessun bottone li produce — arrivano dal kernel — quindi li
      // manda il banco dalla porta che ha per questo.
      await page.evaluate(
        ([a, b]) => {
          window.banco.emetti(a);
          window.banco.emetti(b);
        },
        [GUASTI.lieve, GUASTI.grave],
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
    id: "lettura",
    titolo: "Modalità Lettura: il documento reso",
    query: "",
    prepara: async (page) => {
      await apriNota(page, "Guida/Sintassi di Fub.md");
      await page.click('#mode-switch button[data-mode="reading"]');
      await page.waitForSelector(".pane-preview h1, .markdown-preview h1");
    },
  },
  {
    id: "sorgente",
    titolo: "Modalità Sorgente: la tavolozza della sintassi",
    query: "",
    prepara: async (page) => {
      await apriNota(page, "Guida/Frammenti di codice.md");
      await page.click('#mode-switch button[data-mode="source"]');
      await page.waitForSelector(".cm-content");
    },
  },
  {
    id: "ispettore",
    titolo: "L'ispettore, sulla seconda scheda",
    query: "",
    prepara: async (page) => {
      await page.click("#right-pane .inspector-tab >> nth=1");
      await page.waitForSelector("#right-pane .ui-list-item, #right-pane .ui-empty-state");
    },
  },
  {
    id: "grafo",
    titolo: "Il grafo dei collegamenti",
    query: "",
    prepara: async (page) => {
      await page.click('#views-ribbon button[aria-label="Il grafo dei collegamenti"]');
      await page.waitForSelector("canvas.graph-main");
      await aspettaCheIlGrafoSiFermi(page);
    },
  },
  {
    id: "fuoco",
    titolo: "Il fuoco da tastiera, dal principio",
    query: "",
    prepara: async (page) => {
      // Sei tabulazioni dal salto al contenuto: il link di salto, il primo
      // bottone della menubar, il trigger di ricerca, le tre modalità. È l'unica
      // scena che guarda `:focus-visible`, ed è lo stato che si perde per primo
      // quando si riscrive un componente.
      await page.evaluate(() => document.body.focus());
      for (let i = 0; i < 6; i += 1) await page.keyboard.press("Tab");
    },
  },
  {
    id: "vuoto",
    titolo: "La finestra senza vault",
    query: "vault=vuoto",
    // Nessun gesto: è già tutto ciò che c'è. È la scena che il §11.1 ha reso
    // interessante — senza vault le impostazioni della macchina si leggono
    // lo stesso — e quella che dice se la shell vuota è una finestra o un buco.
    prepara: async () => {},
  },

  // -------------------------------------------------------------------------
  // I tre cataloghi (`banco/catalogo.html`).
  // -------------------------------------------------------------------------
  {
    id: "catalogo-componenti",
    titolo: "Catalogo: ogni componente in ogni stato",
    pagina: "catalogo",
    query: "catalogo=componenti",
    prepara: async () => {},
  },
  {
    id: "catalogo-tavolozza",
    titolo: "Catalogo: ogni token col suo contrasto",
    pagina: "catalogo",
    query: "catalogo=tavolozza",
    prepara: async () => {},
  },
  {
    id: "catalogo-campionario",
    titolo: "Catalogo: la scala tipografica",
    pagina: "catalogo",
    query: "catalogo=campionario",
    prepara: async () => {},
  },
];

/// Apre una nota dall'albero. Sta in una funzione perché due scene la fanno, e
/// perché il modo di aprirla è una cosa che può cambiare: cambierà qui.
///
/// **Si sceglie per `title`, non per testo.** `:has-text()` di Playwright
/// risale agli antenati: in un albero l'antenato di una nota è la sua cartella,
/// e la cartella contiene il testo di tutti i suoi figli. Il primo `li` che
/// «contiene Sintassi di Fub» è quindi la cartella `Guida` — cliccarlo la
/// chiude, e la nota che si apre è un'altra. L'esploratore mette il path in
/// `title` su ogni riga: è una chiave, e una chiave non si somiglia, si eguaglia.
async function apriNota(page, path) {
  const cartella = path.slice(0, path.lastIndexOf("/"));
  const nome = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  await apriCartella(page, cartella);
  await page.click(`#file-list .row.note[title="${path}"]`);
  await page.waitForFunction(
    (n) => document.querySelector(".tab.active .tab-name")?.textContent?.includes(n) ?? false,
    nome,
  );
}

/// Apre una cartella dell'albero, se non è già aperta. Stessa ragione di sopra
/// per il selettore, e l'idempotenza serve perché due scene aprono `Guida` e una
/// terza apre anche ciò che ci sta dentro.
async function apriCartella(page, path) {
  const riga = `#file-list .row.folder[title="${path}"]`;
  await page.waitForSelector(riga);
  const aperta = await page.evaluate(
    (sel) => document.querySelector(sel)?.querySelector(".chevron")?.textContent === "▾",
    riga,
  );
  if (!aperta) await page.click(riga);
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
async function aspettaCheIlGrafoSiFermi(page) {
  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas.graph-main");
      if (!c) return false;
      const ora = c.toDataURL();
      const prima = window.__grafoPrima;
      window.__grafoPrima = ora;
      return prima === ora;
    },
    null,
    { polling: 250, timeout: 30_000 },
  );
}

/// Il nome del file di una foto: scena e luce, che sono le due coordinate.
export function nomeFoto(scena, luce) {
  return `${scena.id}-${luce}.png`;
}

/// L'indirizzo di una scena in una luce.
export function indirizzo(base, scena, luce) {
  const pagina = scena.pagina === "catalogo" ? "/banco/catalogo.html" : "/";
  const query = [`luce=${luce}`, scena.query].filter(Boolean).join("&");
  return `${base}${pagina}?${query}`;
}
