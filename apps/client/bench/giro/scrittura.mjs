// **Il giro, gruppo «scrittura»** (piano editor, T26): quarantadue compiti
// presi dai flussi E1–E18 del piano dell'editor, fatti come li fa una persona
// sulla shell vera col finto host e il vault del banco. Scrivere e dare forma
// col «/», con la barra e con la mini-barra; i compiti da spuntare;
// l'incolla; i blocchi con la maniglia, dalla tastiera e spenti; le modalità;
// la testata e le proprietà; i commenti; la Base; la sbirciata e Ctrl O; la
// concentrazione; l'inglese. L'elenco, coi saltati, è in
// `docs/development/giro-della-scrittura.md`.
//
// La forma di un compito e ciò che `giro` e `host` portano sono in
// `bench/giro.mjs`. Il gruppo è fatto di capitoli: il primo compito di ogni
// capitolo ricarica la pagina con la query del finto host che gli serve
// (`giro.apri`), e da lì il vault riparte com'è nel banco, in memoria; i
// compiti di un capitolo dipendono da quelli prima di lui, nello stesso
// capitolo. Niente tocca un vault vero: il finto host scrive in memoria.
//
// **Il tempo del palco è fermo** (`stage.mjs`: 19 agosto 2026, 9:30, un
// mercoledì). CodeMirror accetta un completamento dalla tastiera soltanto
// dopo un attimo dalla sua apertura, misurato con l'orologio: fermo, l'attimo
// non passa mai. I completamenti di «[[» e di «@» si scelgono perciò col
// mouse, come fa anche una persona; il «/» non usa quel completamento, e Invio
// lì vale.
//
// **I compiti saltati.** Il corridore non ha un «rosso atteso»: un compito che
// oggi fallisce per un difetto di Fub resta scritto qui sotto, in `SALTATI`,
// col motivo e i passi per vederlo, e non entra nel giro; il primo compito lo
// dice nella sua riga. Quando il difetto è corretto, il compito torna in
// `COMPITI` al suo posto.
import { chooseMode } from "../scene.mjs";

/// Le query del finto host per capitolo. `formatbar` e `slash` danno i comandi
/// di `fub.formatting` (il «/», la barra, la mini-barra) che l'host vero ha
/// sempre; `live` mette `Guida/Live.md` con un caso di `bench/live-fixture.ts`;
/// `tipi` accende il registro dei tipi di proprietà; `base` dà `Opere.base`
/// con le note di `Opere/` (`bench/base-fixture.ts`).
const FORMATO = "formatbar=1&slash=1";
const PROPRIETA = "live=proprieta";
const OPZIONI = "live=opzioni&tipi=1";
const COMMENTI = "live=commenti";
const BASE = "base=1";

/// La nota nuova del primo capitolo: «Nuova nota» la crea così, e il nome
/// cambia con `titolo-rinomina`; i compiti dopo scrivono in `RINOMINATA`.
const NUOVA = "Senza titolo.md";
const TITOLO = "Viaggio a Lisbona";
/// La nota che il banco apre per prima, e quella che nomina (`corpus.ts`).
const BENVENUTO = "Benvenuto.md";
const SINTASSI = "Guida/Sintassi di Fub.md";
const LIVE = "Guida/Live.md";
/// Venerdì, per il palco fermo a mercoledì 19 agosto 2026.
const VENERDI = "2026-08-21";
const INDIRIZZO = "https://example.org/mostra";
const SCHEDA = "https://example.org/biglietti";

function verifica(condizione, messaggio) {
  if (!condizione) throw new Error(messaggio);
}

/// Il salvataggio parte 400 ms dopo l'ultimo gesto: lo si aspetta finito.
async function salvato(pagina) {
  await pagina.waitForFunction(() => document.querySelector("#save-state")?.dataset.state === "salvato", null, {
    timeout: 10_000,
  });
}

/// Il testo che il finto host ha di un documento, aspettando che contenga
/// (o non contenga più) qualcosa: il salvataggio è asincrono.
async function testoCon(host, id, prova, messaggio) {
  let testo = "";
  for (let i = 0; i < 40; i += 1) {
    testo = await host.testo(id);
    if (prova(testo)) return testo;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${messaggio}: in ${id} c'è ${JSON.stringify(testo.slice(-240))}`);
}

/// Ricarica la pagina con una query e aspetta la cornice pronta.
async function riparti(pagina, giro, query) {
  await giro.apri(query);
  await pagina.waitForFunction(() => !document.querySelector(".avvio"), null, { timeout: 30_000 });
  await pagina.waitForSelector('#file-list li[role="treeitem"]', { state: "attached" });
}

/// Apre una cartella dell'albero, se è chiusa.
async function apriCartella(pagina, cartella) {
  const voce = `#file-list li[role="treeitem"][data-path="${cartella}"]`;
  if ((await pagina.getAttribute(voce, "aria-expanded")) !== "true") {
    await pagina.click(`${voce} > .tree-row.folder`);
    await pagina.waitForSelector(`${voce}[aria-expanded="true"]`);
  }
}

/// Apre una nota dall'albero e aspetta la sua linguetta a fuoco.
async function apriNota(pagina, id) {
  const cartella = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null;
  if (cartella) await apriCartella(pagina, cartella);
  await pagina.click(`#file-list .tree-row.note[data-path="${id}"]`);
  const nome = id.slice(id.lastIndexOf("/") + 1).replace(/\.md$/, "");
  await linguetta(pagina, nome);
}

/// Aspetta che la linguetta attiva del riquadro a fuoco abbia questo nome: il
/// suo nome accessibile, senza l'icona della nota.
async function linguetta(pagina, nome) {
  await pagina.waitForFunction(
    (atteso) => document.querySelector('.pane.focus .tab[aria-selected="true"]')?.getAttribute("aria-label") === atteso,
    nome,
  );
}

/// Il testo dell'editor visibile nel riquadro a fuoco: ciò che la persona ha
/// davanti, prima del salvataggio.
function testoVisibile(pagina) {
  return pagina.evaluate(async () => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const editor = [...document.querySelectorAll(".pane.focus .pane-editor .cm-editor")].find(
      (e) => e.getBoundingClientRect().width > 0,
    );
    return findTextEditorOrThrow(editor.parentElement).state.doc.toString();
  });
}

/// La selezione dell'editor visibile nel riquadro a fuoco, e quanto è lungo.
function selezione(pagina) {
  return pagina.evaluate(async () => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const editor = [...document.querySelectorAll(".pane.focus .pane-editor .cm-editor")].find(
      (e) => e.getBoundingClientRect().width > 0,
    );
    const view = findTextEditorOrThrow(editor.parentElement);
    const { from, to } = view.state.selection.main;
    return { from, to, lunghezza: view.state.doc.length };
  });
}

/// Il centro di una parola della nota nel riquadro a fuoco, dove la persona
/// punta il mouse; `ultima` sceglie l'ultima volta che compare.
async function centroDi(pagina, parola, ultima = false) {
  const punto = await pagina.evaluate(
    ({ cercata, ultima }) => {
      let trovato = null;
      for (const riga of document.querySelectorAll(".pane.focus .pane-editor .cm-content .cm-line")) {
        if (riga.getBoundingClientRect().width === 0) continue;
        const testi = document.createTreeWalker(riga, NodeFilter.SHOW_TEXT);
        for (let nodo = testi.nextNode(); nodo; nodo = testi.nextNode()) {
          const at = nodo.textContent.indexOf(cercata);
          if (at < 0) continue;
          const pezzo = document.createRange();
          pezzo.setStart(nodo, at);
          pezzo.setEnd(nodo, at + cercata.length);
          const box = pezzo.getBoundingClientRect();
          trovato = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          if (!ultima) return trovato;
        }
      }
      return trovato;
    },
    { cercata: parola, ultima },
  );
  verifica(punto !== null, `nella nota non si vede «${parola}»`);
  return punto;
}

/// Doppio clic su una parola: la sceglie, come la persona.
async function scegliParola(pagina, parola, ultima = false) {
  const { x, y } = await centroDi(pagina, parola, ultima);
  await pagina.mouse.dblclick(x, y);
}

/// Una riga nuova in fondo alla nota, col fuoco nel testo.
async function rigaInFondo(pagina) {
  await pagina.keyboard.press("Control+End");
  await pagina.keyboard.press("Enter");
}

/// Scrive un comando del «/» e aspetta che la voce scelta sia questa.
async function barra(pagina, cerca, voce) {
  await pagina.keyboard.type(`/${cerca}`);
  await pagina.waitForSelector(`.slash-panel .slash-row[aria-selected="true"]:has-text("${voce}")`);
}

/// Incolla del testo dove sta il fuoco, come Ctrl+V con quel testo negli
/// appunti: il palco non dà al banco gli appunti del sistema.
function incolla(pagina, testo) {
  return pagina.evaluate((t) => {
    const dati = new DataTransfer();
    dati.setData("text/plain", t);
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dati, bubbles: true, cancelable: true }));
  }, testo);
}

/// Il suggerimento della banda: dice i tasti del momento.
function suggerimento(pagina) {
  return pagina.locator("#status-band .status-hints").innerText();
}

/// Sceglie col mouse una voce del completamento di CodeMirror (vedi sopra).
async function sceglieCompletamento(pagina, testo) {
  const voce = pagina.locator(`.cm-tooltip-autocomplete li:has-text("${testo}")`).first();
  await voce.waitFor();
  await voce.click();
  await pagina.waitForSelector(".cm-tooltip-autocomplete", { state: "detached" });
}

// ---------------------------------------------------------------------------
// Scrivere e dare forma (E1–E4, E9, E12), in una nota nuova.
// ---------------------------------------------------------------------------

const nuovaNota = {
  id: "nuova-nota",
  nome: "«Nuova nota» apre una nota vuota col fuoco nel testo, e quello che si scrive si salva",
  async fai(pagina, giro) {
    if (SALTATI.length > 0) console.log(`  saltati, coi motivi in scrittura.mjs: ${SALTATI.map((c) => c.id).join(", ")}`);
    await riparti(pagina, giro, FORMATO);
    await pagina.click("#new-note");
    await pagina.click('#context-menu [role^="menuitem"]:has-text("Nota")');
    await linguetta(pagina, "Senza titolo");
    await pagina.waitForFunction(() => document.activeElement?.closest(".pane.focus .cm-content") !== null);
    await pagina.keyboard.type("Il viaggio parte in treno da Milano.");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => t.includes("Il viaggio parte in treno da Milano."), "la frase non si è salvata");
  },
};

const slashTitolo = {
  id: "slash-titolo",
  nome: "«/h2» mette un titolo, e la barra di formato dice «Titolo 2»",
  async fai(pagina) {
    await pagina.keyboard.press("Enter");
    await barra(pagina, "h2", "Titolo 2");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
    await pagina.keyboard.type("Tappe");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => /^## Tappe$/m.test(t), "il titolo non c'è");
    const stile = await pagina.locator(".pane.focus .format-bar-style").innerText();
    verifica(stile.includes("Titolo 2"), `la barra di formato dice «${stile}», non «Titolo 2»`);
  },
};

const slashAttivita = {
  id: "slash-attivita",
  nome: "«/attività» mette un compito, e la banda dice come si spunta",
  async fai(pagina) {
    await pagina.keyboard.press("Enter");
    await barra(pagina, "attività", "Elenco di attività");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
    await pagina.keyboard.type("Comprare i biglietti");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => /^- \[ \] Comprare i biglietti$/m.test(t), "il compito non c'è");
    const contesto = await pagina.getAttribute(".pane.focus .format-bar-context", "data-block");
    verifica(contesto === "task", `la barra di formato è sul blocco «${contesto}», non sul compito`);
    await pagina.waitForFunction(() => document.querySelector("#status-band .status-hints")?.textContent?.includes("Ctrl+Enter spunta"), null, { timeout: 3000 })
      .catch(async () => verifica(false, `la banda dice «${await suggerimento(pagina)}»`));
  },
};

const spunta = {
  id: "spunta",
  nome: "Ctrl+Enter spunta il compito dove sta il cursore",
  async fai(pagina) {
    await pagina.keyboard.press("Control+Enter");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => /^- \[x\] Comprare i biglietti$/m.test(t), "il compito non è spuntato");
  },
};

const slashData = {
  id: "slash-data",
  nome: "«/venerdì» mette il link alla pagina di venerdì",
  async fai(pagina) {
    // Invio sulla voce vuota esce dall'elenco: la data è un paragrafo suo.
    await rigaInFondo(pagina);
    await pagina.keyboard.press("Enter");
    await barra(pagina, "venerdì", "venerdì");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(
      host,
      NUOVA,
      (t) => t.includes(`- [x] Comprare i biglietti\n\n[[Daily/${VENERDI}|21 agosto 2026]]`),
      "il link a venerdì non è un paragrafo suo, staccato dall'elenco",
    );
  },
};

const slashNessuno = {
  id: "slash-nessuno",
  nome: "Un «/» che non trova niente lo dice e indica la ricerca; Esc lascia il testo",
  async fai(pagina, giro) {
    await rigaInFondo(pagina);
    await pagina.keyboard.type("/qwzx");
    await pagina.waitForSelector('.slash-panel:has-text("Nessun blocco per «qwzx»")');
    await giro.foto("nessun-blocco");
    await pagina.keyboard.press("Escape");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
  },
  async controlla(pagina) {
    const testo = await testoVisibile(pagina);
    verifica(testo.endsWith("/qwzx"), `dopo Esc il testo finisce con ${JSON.stringify(testo.slice(-20))}`);
    for (let i = 0; i < 5; i += 1) await pagina.keyboard.press("Backspace");
  },
};

const grassettoEAnnulla = {
  id: "grassetto-e-annulla",
  nome: "Una parola scelta: la banda dice Ctrl+B, Ctrl+B la fa grassetta, Ctrl+Z la rimette",
  async fai(pagina) {
    await pagina.keyboard.type("Si parte in treno");
    await salvato(pagina);
    await scegliParola(pagina, "treno", true);
    await pagina.waitForFunction(() => document.querySelector("#status-band .status-hints")?.textContent?.includes("Ctrl+B"));
    await pagina.keyboard.press("Control+b");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => t.includes("Si parte in **treno**"), "la parola non è grassetta");
    await pagina.keyboard.press("Control+z");
    await salvato(pagina);
    await testoCon(host, NUOVA, (t) => t.includes("Si parte in treno") && !t.includes("**treno**"), "Ctrl+Z non ha tolto il grassetto");
  },
};

const miniBarra = {
  id: "mini-barra-corsivo",
  nome: "La mini-barra sopra la scelta mette il corsivo",
  async fai(pagina) {
    await scegliParola(pagina, "parte", true);
    const corsivo = '.selection-bubble:not([hidden]) [data-command="markdown.italic"]';
    await pagina.waitForSelector(corsivo);
    await pagina.click(corsivo);
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => /Si ([*_])parte\1 in treno/.test(t), "la parola non è in corsivo");
  },
};

const inserisciRiquadro = {
  id: "inserisci-riquadro",
  nome: "«+ Inserisci» della barra cerca un blocco e mette un riquadro",
  async fai(pagina) {
    await rigaInFondo(pagina);
    await pagina.click(".pane.focus .format-bar-insert");
    await pagina.waitForSelector("#context-menu .menu-field-input");
    await pagina.keyboard.type("Riquadro");
    await pagina.click('#context-menu [role^="menuitem"]:has-text("Riquadro")');
    await pagina.waitForSelector("#context-menu", { state: "hidden" });
    await pagina.keyboard.type("Portare il passaporto");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => /^> \[![a-z]+\].*\n> .*Portare il passaporto/m.test(t) || /^> \[![a-z]+\] ?Portare il passaporto/m.test(t), "il riquadro non c'è");
  },
};

const linkANota = {
  id: "link-a-nota",
  nome: "«[[» propone le note, e quella scelta diventa un link",
  async fai(pagina) {
    // Invio sulla riga vuota del riquadro ne esce con un paragrafo vero.
    await rigaInFondo(pagina);
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.type("Prima leggere [[Benv");
    await sceglieCompletamento(pagina, "Benvenuto");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(
      host,
      NUOVA,
      (t) => t.includes("Portare il passaporto\n\nPrima leggere [[Benvenuto]]"),
      "il link non è un paragrafo suo, fuori dal riquadro",
    );
  },
};

const dataConChiocciola = {
  id: "data-con-chiocciola",
  nome: "«@» propone le date a parole, e venerdì diventa un link alla sua pagina",
  async fai(pagina) {
    const prima = (await testoVisibile(pagina)).split(VENERDI).length;
    await pagina.keyboard.press("End");
    await pagina.keyboard.type(" entro @ven");
    await sceglieCompletamento(pagina, "venerdì 21 agosto 2026");
    await salvato(pagina);
    this.prima = prima;
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => t.split(VENERDI).length > this.prima && !t.includes("@ven"), "la data di venerdì non c'è");
  },
};

const incollaSuScelta = {
  id: "incolla-su-scelta",
  nome: "Un indirizzo incollato su una parola scelta la fa diventare un link",
  async fai(pagina) {
    await rigaInFondo(pagina);
    await pagina.keyboard.type("Il programma della mostra");
    await salvato(pagina);
    await scegliParola(pagina, "mostra", true);
    await incolla(pagina, INDIRIZZO);
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => t.includes(`Il programma della [mostra](${INDIRIZZO})`), "il link non c'è");
  },
};

const incollaScheda = {
  id: "incolla-scheda",
  nome: "Un indirizzo incollato da solo chiede Link o Scheda; Scheda lo lascia nudo sulla riga",
  async fai(pagina, giro) {
    await rigaInFondo(pagina);
    await pagina.keyboard.press("Enter");
    await incolla(pagina, SCHEDA);
    await pagina.waitForSelector(".pane.focus .cm-fub-address-choice");
    await giro.foto("scelta");
    await pagina.click('.pane.focus .cm-fub-address-choice [data-choice="card"]');
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => t.split("\n").includes(SCHEDA), "l'indirizzo non è da solo sulla riga");
  },
};

const slashTabella = {
  id: "slash-tabella",
  nome: "«/tab 3x4» mette una tabella di quattro colonne",
  async fai(pagina) {
    await rigaInFondo(pagina);
    await pagina.keyboard.press("Enter");
    await barra(pagina, "tab 3x4", "Tabella");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, NUOVA, (t) => /^\|( Colonna \d \|){4}$/m.test(t), "la tabella di quattro colonne non c'è");
  },
};

const tabellaRiga = {
  id: "tabella-riga",
  nome: "Col cursore nella tabella la barra mostra «Tabella», e «+ Riga» ne aggiunge una",
  async fai(pagina) {
    const riga = '.pane.focus .format-bar button:has-text("Riga")';
    await pagina.waitForSelector(riga);
    this.prima = (await testoVisibile(pagina)).split("\n").filter((l) => l.startsWith("|")).length;
    await pagina.click(riga);
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(
      host,
      NUOVA,
      (t) => t.split("\n").filter((l) => l.startsWith("|") && l.split("|").length === 6).length === this.prima + 1,
      "la tabella non ha una riga in più",
    );
  },
};

const titoloRinomina = {
  id: "titolo-rinomina",
  nome: "Il titolo in cima rinomina la nota, e Invio rimanda al testo",
  async fai(pagina) {
    await pagina.click(".pane.focus .pane-editor .cm-content .cm-fub-page-title");
    await pagina.keyboard.press("Control+a");
    await pagina.keyboard.type(TITOLO);
    await pagina.keyboard.press("Enter");
    await linguetta(pagina, TITOLO);
  },
  async controlla(pagina, host) {
    const chiamate = await host.chiamate("invokeCommand");
    const rinomina = chiamate.find((c) => JSON.stringify(c).includes("note.rename"));
    verifica(rinomina && JSON.stringify(rinomina).includes(`${TITOLO}.md`), `nessuna rinomina in ${TITOLO}.md: ${JSON.stringify(chiamate).slice(0, 300)}`);
    await pagina.waitForFunction(() => document.activeElement?.closest(".pane.focus .cm-content") !== null
      && !document.activeElement.matches(".cm-fub-page-title"));
  },
};

// ---------------------------------------------------------------------------
// Dopo la rinomina, nella stessa nota: il «/» la segue col nome nuovo.
// ---------------------------------------------------------------------------

/// La nota del capitolo col nome che il titolo le ha dato.
const RINOMINATA = `${TITOLO}.md`;

const slashDopoRinomina = {
  id: "slash-dopo-rinomina",
  nome: "Nella nota appena rinominata «/h2» apre ancora il menu e mette il titolo",
  async fai(pagina) {
    // Il fuoco è nel testo, dove l'ha portato Invio del titolo: una riga sua.
    await pagina.keyboard.press("End");
    await pagina.keyboard.press("Enter");
    await barra(pagina, "h2", "Titolo 2");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
    await pagina.keyboard.type("Dopo il nome");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, RINOMINATA, (t) => /^## Dopo il nome$/m.test(t), "il titolo non è nella nota rinominata");
  },
};

const slashCompito = {
  id: "slash-compito",
  nome: "«/compito» trova l'elenco di attività, come la barra chiama quel blocco",
  async fai(pagina) {
    await pagina.keyboard.press("Enter");
    await barra(pagina, "compito", "Elenco di attività");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
    await pagina.keyboard.type("Prenotare l'albergo");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, RINOMINATA, (t) => /^- \[ \] Prenotare l'albergo$/m.test(t), "il compito non c'è");
  },
};

const esciDallElenco = {
  id: "esci-dall-elenco",
  nome: "Invio su una voce vuota esce dall'elenco con un paragrafo vero, staccato da una riga vuota",
  async fai(pagina) {
    // Dal compito: Invio, Invio sulla voce vuota; poi un elenco puntato.
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.type("- tre");
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.type("quattro");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(
      host,
      RINOMINATA,
      (t) => /^- \[ \] Prenotare l'albergo\n\n- tre\n\nquattro$/m.test(t),
      "«quattro» non è un paragrafo suo dopo gli elenchi",
    );
  },
};

// ---------------------------------------------------------------------------
// I compiti saltati (vedi in cima): `{ id, motivo }`, col motivo e i passi del
// difetto. Oggi nessuno.
// ---------------------------------------------------------------------------

const SALTATI = [];

// ---------------------------------------------------------------------------
// I blocchi (E5), su «Benvenuto».
// ---------------------------------------------------------------------------

const RIGA = "Un elenco corto";
const SECONDA = "con tre voci";

const manigliaMenu = {
  id: "maniglia-menu",
  nome: "La maniglia di un blocco si vede al passaggio, e il suo menu dice cosa si può fare",
  async fai(pagina, giro) {
    await riparti(pagina, giro, FORMATO);
    await chooseMode(pagina, "live_preview");
    const { x, y } = await centroDi(pagina, RIGA);
    await pagina.mouse.move(x, y);
    await pagina.waitForSelector(".pane.focus .cm-fub-block-handles[data-active=true] .cm-fub-block-grip");
    await pagina.click(".pane.focus .cm-fub-block-handles[data-active=true] .cm-fub-block-grip");
    await pagina.waitForSelector('#context-menu [role^="menuitem"]:has-text("Duplica")');
  },
  async controlla(pagina) {
    const voci = await pagina.locator('#context-menu [role^="menuitem"]').allInnerTexts();
    const testo = voci.join(" · ");
    for (const voce of ["Trasforma in", "Duplica", "Sposta in", "Elimina"]) {
      verifica(testo.includes(voce), `nel menu della maniglia manca «${voce}»: ${testo}`);
    }
    await pagina.keyboard.press("Escape");
    await pagina.waitForSelector("#context-menu", { state: "hidden" });
  },
};

const spostaDaTastiera = {
  id: "sposta-da-tastiera",
  nome: "Esc sceglie il blocco, Ctrl+Shift+↓ lo sposta sotto il successivo",
  async fai(pagina) {
    const { x, y } = await centroDi(pagina, RIGA);
    await pagina.mouse.click(x, y);
    await pagina.keyboard.press("Escape");
    await pagina.waitForFunction(() => document.querySelector("#status-band .status-hints")?.textContent?.includes("Ctrl+D"));
    await pagina.keyboard.press("Control+Shift+ArrowDown");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, BENVENUTO, (t) => t.indexOf(SECONDA) >= 0 && t.indexOf(SECONDA) < t.indexOf(RIGA), "il blocco non è sceso");
  },
};

const duplica = {
  id: "duplica",
  nome: "Ctrl+D sul blocco scelto lo duplica",
  async fai(pagina) {
    await pagina.keyboard.press("Control+d");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, BENVENUTO, (t) => t.split(RIGA).length === 3, "il blocco non è doppio");
  },
};

const blocchiSpenti = {
  id: "blocchi-spenti",
  nome: "«Blocchi» spento dal menu del foglio: niente maniglie, e Ctrl+A sceglie tutto il testo",
  async fai(pagina) {
    await pagina.click('.pane.focus button[aria-label="Azioni del riquadro"]');
    await pagina.click('#context-menu [role="menuitemcheckbox"]:has-text("Blocchi")');
    await pagina.waitForSelector(".pane.focus .cm-fub-block-handles", { state: "detached" });
    const { x, y } = await centroDi(pagina, SECONDA);
    await pagina.mouse.click(x, y);
    await pagina.keyboard.press("Control+a");
  },
  async controlla(pagina, host) {
    const impostazioni = await host.chiamate("setSetting");
    verifica(impostazioni.some((a) => a[0] === "editor.blocks" && a[1] === false), `nessun editor.blocks spento: ${JSON.stringify(impostazioni)}`);
    const { from, to, lunghezza } = await selezione(pagina);
    verifica(from === 0 && to === lunghezza, `Ctrl+A sceglie ${from}..${to} di ${lunghezza}`);
    await pagina.keyboard.press("ArrowDown");
  },
};

// ---------------------------------------------------------------------------
// Le modalità (E2), su «Benvenuto».
// ---------------------------------------------------------------------------

const modalitaLettura = {
  id: "modalita-lettura",
  nome: "In Lettura la nota non si scrive",
  async fai(pagina, giro) {
    await riparti(pagina, giro, FORMATO);
    await chooseMode(pagina, "reading");
  },
  async controlla(pagina) {
    const modo = await pagina.locator("#status-mode").innerText();
    verifica(modo.includes("Lettura"), `la banda dice «${modo}»`);
    const scrivibile = await pagina.evaluate(() =>
      [...document.querySelectorAll(".pane.focus .pane-editor .cm-content")].some(
        (c) => c.getBoundingClientRect().width > 0 && c.getAttribute("contenteditable") === "true",
      ),
    );
    verifica(!scrivibile, "in Lettura il testo resta scrivibile");
  },
};

const modalitaSorgente = {
  id: "modalita-sorgente",
  nome: "In Sorgente si vede il Markdown com'è, coi suoi segni",
  async fai(pagina) {
    await chooseMode(pagina, "source");
  },
  async controlla(pagina) {
    await pagina.waitForSelector('.pane.focus .pane-editor .cm-line:has-text("# Benvenuto in Fub")');
    const modo = await pagina.locator("#status-mode").innerText();
    verifica(modo.includes("Sorgente"), `la banda dice «${modo}»`);
    await chooseMode(pagina, "live_preview");
  },
};

// ---------------------------------------------------------------------------
// La testata e le proprietà (E6, E7), su `Guida/Live.md`.
// ---------------------------------------------------------------------------

/// La riga di una proprietà nella testata del riquadro a fuoco.
function proprieta(chiave) {
  return `.pane.focus .pane-editor .cm-fub-page-prop[data-key="${chiave}"]`;
}

/// Apre il valore di una proprietà dalla tastiera, come la persona: il fuoco
/// sul valore e Invio.
async function apriValore(pagina, chiave, editor) {
  await pagina.focus(`${proprieta(chiave)} .cm-fub-page-prop-value`);
  await pagina.keyboard.press("Enter");
  await pagina.waitForSelector(editor);
}

const proprietaTesto = {
  id: "proprieta-testo",
  nome: "Il valore di una proprietà si cambia nella testata, e va nel frontmatter",
  async fai(pagina, giro) {
    await riparti(pagina, giro, PROPRIETA);
    await apriNota(pagina, LIVE);
    await pagina.waitForSelector(proprieta("stato"));
    await apriValore(pagina, "stato", ".cm-fub-prop-input");
    await pagina.keyboard.press("Control+a");
    await pagina.keyboard.type("Rimandata");
    await pagina.keyboard.press("Enter");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, LIVE, (t) => /^stato: "?Rimandata"?$/m.test(t), "lo stato non è cambiato");
  },
};

const proprietaData = {
  id: "proprieta-data-a-parole",
  nome: "Una data scritta a parole («venerdì») diventa la data giusta",
  async fai(pagina) {
    await apriValore(pagina, "scadenza", ".cm-fub-prop-date");
    await pagina.keyboard.press("Control+a");
    await pagina.keyboard.type("venerdì");
    await pagina.keyboard.press("Enter");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, LIVE, (t) => new RegExp(`^scadenza: "?${VENERDI}"?$`, "m").test(t), "la scadenza non è venerdì");
  },
};

const statoScelta = {
  id: "stato-scelta",
  nome: "Lo Stato si sceglie fra le opzioni dei suoi gruppi",
  async fai(pagina, giro) {
    await riparti(pagina, giro, OPZIONI);
    await apriNota(pagina, LIVE);
    await pagina.waitForSelector(proprieta("stato"));
    await apriValore(pagina, "stato", ".cm-fub-prop-choices");
    await giro.foto("opzioni");
    await pagina.click('.cm-fub-prop-choices [role="option"]:has-text("Arrivata")');
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, LIVE, (t) => /^stato: "?Arrivata"?$/m.test(t), "lo stato non è «Arrivata»");
  },
};

const aggiungiProprieta = {
  id: "aggiungi-proprieta",
  nome: "«Aggiungi una proprietà» apre il frontmatter su una riga vuota, e la proprietà scritta lì resta",
  async fai(pagina, giro) {
    await pagina.click('.pane.focus .pane-editor :text-is("Aggiungi una proprietà")');
    // La testata si apre come sorgente, col cursore sulla riga nuova prima
    // della chiusura `---`.
    await pagina.waitForSelector('.pane.focus .pane-editor .cm-line:has-text("stato: Arrivata")');
    await giro.foto("frontmatter");
    await pagina.keyboard.type("curatrice: Sara Neri");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, LIVE, (t) => /^curatrice: "?Sara Neri"?$/m.test(t), "la proprietà nuova non c'è");
  },
};

// ---------------------------------------------------------------------------
// I commenti (E8), su `Guida/Live.md` coi suoi commenti.
// ---------------------------------------------------------------------------

const SEGNO = ".pane.focus .pane-editor .cm-editor :is(.cm-fub-comment-bubble, .cm-fub-comment-sign)";
const DOMANDA = "Alle 18 o alle 19?";
const RISPOSTA = "Confermato per lettera.";

const commenta = {
  id: "commenta",
  nome: "Ctrl+Alt+M commenta la parola scelta: la prima volta chiede il nome, Ctrl+Enter invia",
  async fai(pagina, giro) {
    await riparti(pagina, giro, COMMENTI);
    await apriNota(pagina, LIVE);
    await pagina.waitForSelector(SEGNO);
    await scegliParola(pagina, "inaugurazione");
    await pagina.keyboard.press("Control+Alt+m");
    await pagina.waitForSelector(".cm-fub-comment-popover .cm-fub-comment-composer");
    await giro.foto("nome");
    await pagina.keyboard.type("Sara Neri");
    await pagina.keyboard.press("Tab");
    await pagina.keyboard.type(DOMANDA);
    await pagina.keyboard.press("Control+Enter");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, LIVE, (t) => t.includes(`{==inaugurazione==}{>>@Sara Neri 2026-08-19 09:30: ${DOMANDA}<<}`), "il commento non c'è");
    await pagina.keyboard.press("Escape");
  },
};

const rispondi = {
  id: "rispondi",
  nome: "Il segno di una discussione la apre, e una risposta le si aggiunge",
  async fai(pagina) {
    await pagina.click(`${SEGNO} >> nth=0`);
    await pagina.waitForSelector(".cm-fub-comment-popover .cm-fub-comment-message");
    await pagina.waitForFunction(() => document.activeElement?.matches(".cm-fub-comment-input"));
    await pagina.keyboard.type(RISPOSTA);
    await pagina.keyboard.press("Control+Enter");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    // La risposta porta la firma del nome scelto al primo commento, che
    // `profile.name` ha tenuto.
    await testoCon(host, LIVE, (t) => t.includes(`@Sara Neri 2026-08-19 09:30: ${RISPOSTA}<<}`), "la risposta non c'è, o non è firmata");
    const nomi = await host.chiamate("setSetting");
    verifica(nomi.some((a) => a[0] === "profile.name" && a[1] === "Sara Neri"), `il nome non si è salvato: ${JSON.stringify(nomi)}`);
  },
};

const risolvi = {
  id: "risolvi",
  nome: "«Risolvi» chiude la discussione: il suo segno sparisce dalla nota",
  async fai(pagina) {
    this.prima = await pagina.locator(SEGNO).count();
    await pagina.click('.cm-fub-comment-popover button:has-text("Risolvi")');
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    await pagina.waitForFunction(
      ({ segno, prima }) => document.querySelectorAll(segno).length < prima,
      { segno: SEGNO, prima: this.prima },
    );
    const testo = await host.testo(LIVE);
    verifica(testo.includes(RISPOSTA), "risolvere ha tolto la discussione dal file invece di chiuderla");
  },
};

// ---------------------------------------------------------------------------
// La Base (E10, E11), su `Opere.base`.
// ---------------------------------------------------------------------------

const BASE_DOC = "Opere.base";

/// La Base non è più occupata a ricalcolare.
async function baseFerma(pagina) {
  await pagina.waitForFunction(() => document.querySelector(".pane.focus .base-bar")?.getAttribute("aria-busy") !== "true");
}

const baseApri = {
  id: "base-apri",
  nome: "Ctrl O trova la Base e la apre con le sue righe",
  async fai(pagina, giro) {
    await riparti(pagina, giro, BASE);
    await pagina.keyboard.press("Control+o");
    await pagina.waitForSelector(".launcher-input:focus");
    await pagina.keyboard.type(BASE_DOC);
    await pagina.waitForSelector(`.launcher-row:has-text("Opere")`);
    await pagina.keyboard.press("Enter");
    await pagina.waitForFunction(() => (document.querySelector(".pane.focus")?.querySelectorAll(".base-table tbody tr").length ?? 0) > 0);
    await baseFerma(pagina);
  },
  async controlla(pagina) {
    const righe = await pagina.locator(".pane.focus .base-table tbody tr").count();
    verifica(righe === 8, `la Base mostra ${righe} righe, non le 8 opere`);
  },
};

const baseFiltro = {
  id: "base-filtro",
  nome: "Il filtro si cambia nel suo riquadro e «Applica» lo scrive nel file .base",
  async fai(pagina) {
    await pagina.click(".pane.focus .base-tool-filter");
    await pagina.waitForSelector(".base-popover .base-filter-row");
    await pagina.fill(".base-popover .base-filter-value", "16000");
    await pagina.click('.base-popover button:has-text("Applica")');
    await baseFerma(pagina);
  },
  async controlla(pagina, host) {
    await testoCon(host, BASE_DOC, (t) => /value: 16000/.test(t), "il filtro non è nel file");
    await pagina.waitForFunction(() => document.querySelectorAll(".pane.focus .base-table tbody tr").length < 8);
  },
};

const baseOrdina = {
  id: "base-ordina",
  nome: "L'ordinamento cambia verso, e il file lo dice",
  async fai(pagina) {
    await pagina.click(".pane.focus .base-tool-sort");
    await pagina.waitForSelector(".base-popover .base-sort-row");
    await pagina.selectOption(".base-popover .base-sort-direction", "desc");
    await baseFerma(pagina);
    await pagina.keyboard.press("Escape");
  },
  async controlla(pagina, host) {
    await testoCon(host, BASE_DOC, (t) => /descending: true/.test(t), "l'ordinamento non è decrescente nel file");
  },
};

const baseBacheca = {
  id: "base-bacheca-trascina",
  nome: "Nella Bacheca una scheda trascinata in un'altra colonna cambia lo stato della nota",
  async fai(pagina) {
    await pagina.click('.pane.focus .base-tab:has-text("Bacheca")');
    await pagina.waitForSelector('.pane.focus .base-kanban-column[data-group="Prenotata"] .base-kanban-card');
    await baseFerma(pagina);
    const scheda = pagina.locator('.pane.focus .base-kanban-column[data-group="Prenotata"] .base-kanban-card').first();
    this.nota = await scheda.getAttribute("data-doc");
    await scheda.dragTo(pagina.locator('.pane.focus .base-kanban-column[data-group="Arrivata"]'));
    await baseFerma(pagina);
  },
  async controlla(pagina, host) {
    // Si guarda la nota, non la colonna: le righe della Base le dà la
    // scenografia del banco (`base-fixture.ts`), che tiene lo stato fermo e
    // non rilegge la nota come farebbe il core.
    await testoCon(host, this.nota, (t) => /^stato: "?Arrivata"?$/m.test(t), "lo stato della nota non è cambiato");
  },
};

const baseSchede = {
  id: "base-schede",
  nome: "La vista Schede mostra le opere come schede",
  async fai(pagina) {
    await pagina.click('.pane.focus .base-tab:has-text("Schede")');
    await baseFerma(pagina);
  },
  async controlla(pagina) {
    await pagina.waitForSelector('.pane.focus .base-tab[aria-pressed="true"]:has-text("Schede")');
    await pagina.waitForFunction(() => document.querySelectorAll(".pane.focus [class*='base-card']").length > 0);
  },
};

// ---------------------------------------------------------------------------
// La sbirciata e Ctrl O (E13, E14), da «Benvenuto».
// ---------------------------------------------------------------------------

const AGGIUNTA = "Riletta dalla sbirciata. ";

const sbirciata = {
  id: "sbirciata",
  nome: "Alt+clic su un link apre la nota accanto, scrivibile, e quello che vi si scrive si salva",
  async fai(pagina, giro) {
    await riparti(pagina, giro, "");
    const link = pagina.locator('.pane.focus .pane-editor .cm-content :text-is("Sintassi di Fub")').first();
    await link.click({ modifiers: ["Alt"] });
    await pagina.waitForSelector(".note-peek");
    await pagina.waitForFunction(() => document.activeElement?.closest(".note-peek .cm-content") !== null);
    // Il cursore entra in cima al testo: la frase va in fondo, riga sua.
    await pagina.keyboard.press("Control+End");
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.type(AGGIUNTA);
    await giro.foto("aperta");
  },
  async controlla(pagina, host) {
    await testoCon(host, SINTASSI, (t) => t.includes(AGGIUNTA), "quello scritto nella sbirciata non si è salvato");
    verifica(await pagina.isVisible(".note-peek"), "la sbirciata si è chiusa da sola");
  },
};

const sbirciataUnEsc = {
  id: "sbirciata-un-esc",
  nome: "Nella sbirciata Esc chiude prima il menu «[[» aperto; col cursore nel testo un Esc solo la chiude",
  async fai(pagina) {
    // Un menu aperto nella sbirciata: il completamento di «[[». Il «/» qui
    // non si apre: segue la nota della linguetta attiva (`slashContextDoc`).
    await pagina.keyboard.type("[[Benv");
    await pagina.waitForSelector('.cm-tooltip-autocomplete li:has-text("Benvenuto")');
    await pagina.keyboard.press("Escape");
    await pagina.waitForSelector(".cm-tooltip-autocomplete", { state: "detached" });
    verifica(await pagina.isVisible(".note-peek"), "l'Esc del menu «[[» ha chiuso anche la sbirciata");
    // Esc lascia «[[Benv» nel testo (e «]]», se chiuse da sole): sei
    // Backspace lo tolgono, le parentesi a coppie.
    for (let volta = 0; volta < 6; volta++) await pagina.keyboard.press("Backspace");
    // Appena scritta la frase il completamento ha appena interrogato le sue
    // fonti e non mostra niente: il primo Esc è della sbirciata.
    await pagina.keyboard.type("Fine.");
    await pagina.keyboard.press("Escape");
    await pagina.waitForSelector(".note-peek", { state: "hidden" });
  },
  async controlla(pagina, host) {
    await testoCon(host, SINTASSI, (t) => t.includes(`${AGGIUNTA}Fine.`), "quello scritto nella sbirciata non si è salvato");
    await linguetta(pagina, "Benvenuto");
  },
};

const ctrlONota = {
  id: "ctrl-o-nota",
  nome: "Ctrl O trova una nota per nome e Invio la apre",
  async fai(pagina) {
    await pagina.keyboard.press("Control+o");
    await pagina.waitForSelector(".launcher-input:focus");
    await pagina.keyboard.type("Frammenti");
    await pagina.waitForSelector('.launcher-row:has-text("Frammenti di codice")');
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".launcher-layer", { state: "detached" });
  },
  async controlla(pagina) {
    await linguetta(pagina, "Frammenti di codice");
  },
};

const ctrlOSbircia = {
  id: "ctrl-o-sbircia",
  nome: "Alt+Invio su un risultato di Ctrl O apre la nota nella sbirciata",
  async fai(pagina) {
    await pagina.keyboard.press("Control+o");
    await pagina.waitForSelector(".launcher-input:focus");
    await pagina.keyboard.type("Sintassi");
    await pagina.waitForSelector('.launcher-row:has-text("Sintassi di Fub")');
    await pagina.keyboard.press("Alt+Enter");
    await pagina.waitForSelector('.note-peek[aria-label="Sbirciata: Sintassi di Fub"]');
  },
  async controlla(pagina) {
    await linguetta(pagina, "Frammenti di codice");
    await pagina.click(".note-peek .note-peek-close");
    await pagina.waitForSelector(".note-peek", { state: "hidden" });
  },
};

const ctrlOEtichette = {
  id: "ctrl-o-etichette",
  nome: "«#» in Ctrl O passa alle etichette, con quante note ha ciascuna",
  async fai(pagina) {
    await pagina.keyboard.press("Control+o");
    await pagina.waitForSelector(".launcher-input:focus");
    await pagina.keyboard.type("#");
    await pagina.waitForSelector('.launcher-row:has-text("#tema")');
  },
  async controlla(pagina) {
    const scelto = await pagina.locator('.launcher-modes [aria-selected="true"]').innerText();
    verifica(scelto.includes("Etichette"), `la tessera scelta è «${scelto}»`);
    const riga = await pagina.locator('.launcher-row:has-text("#tema")').first().innerText();
    verifica(/\d+ note/.test(riga), `la riga dell'etichetta dice «${riga}»`);
    await pagina.keyboard.press("Escape");
    await pagina.waitForSelector(".launcher-layer", { state: "detached" });
  },
};

// ---------------------------------------------------------------------------
// La concentrazione (E15), da «Benvenuto».
// ---------------------------------------------------------------------------

const concentrazione = {
  id: "concentrazione",
  nome: "«>» in Ctrl O trova «Modalità concentrazione»: il resto si ritira e la banda dice come uscire",
  async fai(pagina) {
    await pagina.keyboard.press("Control+o");
    await pagina.waitForSelector(".launcher-input:focus");
    await pagina.keyboard.type(">concentrazione");
    await pagina.waitForSelector('.launcher-row:has-text("Modalità concentrazione")');
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector("#app[data-focus-mode]");
  },
  async controlla(pagina) {
    await pagina.waitForSelector("#status-focus-exit:not([hidden])");
    const esci = await pagina.locator("#status-focus-exit").innerText();
    verifica(esci.includes("Esci dalla concentrazione"), `il bottone della banda dice «${esci}»`);
  },
};

const concentrazioneEsc = {
  id: "concentrazione-esc",
  nome: "Esc esce dalla concentrazione e il testo tiene il fuoco",
  async fai(pagina) {
    await pagina.click(".pane.focus .pane-editor .cm-content .cm-line >> nth=2");
    await pagina.keyboard.press("Escape");
    // Il primo Esc dei Blocchi non sceglie il blocco, in concentrazione.
    await pagina.waitForSelector("#app:not([data-focus-mode])");
  },
  async controlla(pagina) {
    await pagina.waitForSelector("#status-focus-exit", { state: "hidden" });
    const nelTesto = await pagina.evaluate(() => document.activeElement?.closest(".pane.focus .cm-content") !== null);
    verifica(nelTesto, "uscendo dalla concentrazione il fuoco non è nel testo");
  },
};

// ---------------------------------------------------------------------------
// In inglese (caso limite del piano): la lingua dell'interfaccia cambia
// tutto, il «/» compreso. Si sceglie come la sceglie Impostazioni, nella
// memoria della finestra; l'ultimo compito la rimette.
// ---------------------------------------------------------------------------

const LINGUA = "fub.locale.language";

const inglese = {
  id: "inglese",
  nome: "In inglese la banda e il «/» parlano inglese",
  async fai(pagina, giro) {
    await pagina.evaluate((chiave) => localStorage.setItem(chiave, "en"), LINGUA);
    await riparti(pagina, giro, FORMATO);
    await chooseMode(pagina, "live_preview", "Writing");
    await pagina.click(".pane.focus .pane-editor .cm-content .cm-line >> nth=2");
    // A riposo la banda dice i tasti della scrittura.
    await pagina.waitForFunction(() => document.querySelector("#status-band .status-hints")?.textContent?.includes("inserts a block"));
    this.tasti = await suggerimento(pagina);
    await rigaInFondo(pagina);
    await pagina.keyboard.press("Enter");
    await barra(pagina, "h2", "Heading 2");
  },
  async controlla(pagina) {
    verifica(!/inserisce|persone|seleziona/.test(this.tasti), `la banda parla ancora italiano: «${this.tasti}»`);
    const modo = await pagina.locator("#status-mode").innerText();
    verifica(modo.includes("Writing"), `la modalità si chiama «${modo}»`);
    const vuota = await pagina.locator(".slash-panel").innerText();
    verifica(vuota.includes("Search all commands"), `il «/» non offre la ricerca in inglese: «${vuota}»`);
    // La foto del compito tiene il «/» aperto; il compito dopo ricarica.
  },
};

const ingleseTorna = {
  id: "inglese-torna",
  nome: "Tornati all'italiano, la banda dice di nuovo «Scrittura»",
  async fai(pagina, giro) {
    await pagina.evaluate((chiave) => localStorage.removeItem(chiave), LINGUA);
    await riparti(pagina, giro, "");
  },
  async controlla(pagina) {
    const modo = await pagina.locator("#status-mode").innerText();
    verifica(modo.includes("Scrittura"), `la modalità si chiama «${modo}»`);
  },
};

const COMPITI = [
  nuovaNota,
  slashTitolo,
  slashAttivita,
  spunta,
  slashData,
  slashNessuno,
  grassettoEAnnulla,
  miniBarra,
  inserisciRiquadro,
  linkANota,
  dataConChiocciola,
  incollaSuScelta,
  incollaScheda,
  slashTabella,
  tabellaRiga,
  titoloRinomina,
  slashDopoRinomina,
  slashCompito,
  esciDallElenco,
  manigliaMenu,
  spostaDaTastiera,
  duplica,
  blocchiSpenti,
  modalitaLettura,
  modalitaSorgente,
  proprietaTesto,
  proprietaData,
  statoScelta,
  aggiungiProprieta,
  commenta,
  rispondi,
  risolvi,
  baseApri,
  baseFiltro,
  baseOrdina,
  baseBacheca,
  baseSchede,
  sbirciata,
  sbirciataUnEsc,
  ctrlONota,
  ctrlOSbircia,
  ctrlOEtichette,
  concentrazione,
  concentrazioneEsc,
  inglese,
  ingleseTorna,
];

export const scrittura = {
  id: "scrittura",
  nome: "la scrittura",
  compiti: COMPITI,
};
