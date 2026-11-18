// **Il giro, gruppo «avvio»** (compiti 1–5): la prima volta di una persona.
// Fub parte senza un vault, lei apre quello del banco, sceglie una nota
// dall'albero, ci scrive in Live un titolo, una lista e un grassetto, e la
// guarda nelle quattro modalità.
//
// La forma di un compito e ciò che `giro` e `host` portano sono in
// `bench/giro.mjs`. I compiti dipendono l'uno dall'altro: il quarto scrive
// nella nota che il terzo ha aperto, il quinto guarda ciò che il quarto ha
// scritto.
import { chooseMode } from "../scene.mjs";

/// La cartella e la nota che il giro apre, dal vault del banco (`corpus.ts`).
const CARTELLA = "Progetti";
const NOTA = "Progetti/Il banco che vede.md";
const NOME = "Il banco che vede";
/// Il vault che il selettore di cartella del banco risponde (`fake-dialog.ts`)
/// e il nome con cui il registro dei vault lo conosce. Al telefono «Apri
/// vault…» porta invece alla scelta dello spazio, e lo spazio privato del
/// banco è un'altra cartella (`fake-mobile-bridge.ts`).
const VAULT = "/Bench vault";
const NOME_VAULT = "Vault del banco";
const VAULT_TELEFONO = "/vault/banco";

/// Ciò che il quarto compito scrive, e come deve tornare nel Markdown.
const TITOLO = "Titolo del giro";
const VOCI = ["prima voce", "seconda voce"];
const GRASSETTO = "grassetto";

/// Le quattro modalità, con il nome che hanno nel menu. Si torna alla Live per
/// ultima: il gruppo dopo trova la nota com'era.
const MODALITA = [
  ["blocks", "Blocchi"],
  ["source", "Sorgente"],
  ["reading", "Lettura"],
  ["live_preview", "Live"],
];

function verifica(condizione, messaggio) {
  if (!condizione) throw new Error(messaggio);
}

/// In una finestra stretta (il telefono) l'albero è un cassetto: lo apre e,
/// fatto il gesto, lo richiude, come la persona.
async function dalCassetto(pagina, gesto) {
  const stretta = await pagina.evaluate(
    () => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false,
  );
  if (stretta) {
    await pagina.click('#views-ribbon .rail-btn[data-panel="files"]');
    await pagina.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await gesto();
  if (stretta && (await pagina.isVisible("#sidebar-scrim"))) {
    // In alto, lontano dal bordo destro (che fa affacciare l'ispettore): il
    // cassetto sale dal basso e copre il centro.
    const velo = await pagina.locator("#sidebar-scrim").boundingBox();
    await pagina.click("#sidebar-scrim", { position: { x: Math.max(8, velo.width - 80), y: 8 } });
    await pagina.waitForSelector("#sidebar-scrim", { state: "hidden" });
  }
}

/// Il testo che si vede nel riquadro a fuoco.
function testoDelRiquadro(pagina) {
  return pagina.evaluate(() => document.querySelector(".pane.focus")?.innerText ?? "");
}

const primoAvvio = {
  id: "primo-avvio",
  nome: "l'avvio arriva alla scrivania, senza lo strato d'avvio",
  telefono: true,
  async fai(pagina, giro) {
    // La prima volta: nessun vault da riaprire.
    await giro.apri("vault=vuoto");
    await pagina.waitForFunction(() => !document.querySelector(".avvio"), null, { timeout: 30_000 });
  },
  async controlla(pagina, host) {
    verifica((await pagina.locator(".avvio").count()) === 0, "lo strato d'avvio è ancora nella pagina");
    verifica(await pagina.isVisible("#onboarding"), "la scrivania non mostra il benvenuto");
    verifica(await pagina.isVisible("#onboarding-open"), "il benvenuto non offre «Apri vault…»");
    verifica((await host.chiamate("initialVault")).length === 1, "l'avvio non ha chiesto il vault di partenza");
    verifica((await host.chiamate("openVault")).length === 0, "l'avvio ha aperto un vault che non c'era");
  },
};

const apriVault = {
  id: "apri-vault",
  nome: "aprire il vault",
  telefono: true,
  async fai(pagina, giro) {
    await pagina.click("#onboarding-open");
    // Al telefono la scelta dello spazio è esplicita: non decide per la persona.
    if (giro.telefono) await pagina.click('.mobile-storage[open] button:has-text("Usa spazio privato")');
    await pagina.waitForSelector("#onboarding", { state: "hidden" });
    // Il pannello dello spazio resta aperto sopra la barra inferiore, dopo la
    // scelta: la persona lo richiude dal suo titolo.
    if (giro.telefono && (await pagina.isVisible(".mobile-storage[open]"))) {
      await pagina.click(".mobile-storage > summary");
      await pagina.waitForSelector(".mobile-storage:not([open])", { state: "attached" });
    }
  },
  async controlla(pagina, host, giro) {
    const atteso = giro.telefono ? VAULT_TELEFONO : VAULT;
    const aperti = await host.chiamate("openVault");
    verifica(aperti.length === 1 && aperti[0][0] === atteso, `openVault: ${JSON.stringify(aperti)}, atteso «${atteso}»`);
    if (!giro.telefono) {
      // Il chip del vault c'è solo nella cornice della finestra.
      const chip = (await pagina.textContent("#vault-path"))?.trim() ?? "";
      verifica(chip === NOME_VAULT, `la cornice dice «${chip}», non «${NOME_VAULT}»`);
    }
    await pagina.waitForSelector(`#file-list li[role="treeitem"][data-path="${CARTELLA}"]`, { state: "attached" });
  },
};

const albero = {
  id: "albero",
  nome: "l'albero: aprire una cartella e una nota",
  telefono: true,
  async fai(pagina) {
    await dalCassetto(pagina, async () => {
      const voce = `#file-list li[role="treeitem"][data-path="${CARTELLA}"]`;
      await pagina.click(`${voce} > .tree-row.folder`);
      await pagina.waitForSelector(`${voce}[aria-expanded="true"]`);
      await pagina.click(`#file-list .tree-row.note[data-path="${NOTA}"]`);
      await pagina.waitForSelector('.tab[aria-selected="true"]');
    });
  },
  async controlla(pagina, host) {
    const voce = `#file-list li[role="treeitem"][data-path="${CARTELLA}"]`;
    verifica(
      (await pagina.getAttribute(voce, "aria-expanded")) === "true",
      `la cartella «${CARTELLA}» non è aperta`,
    );
    const linguetta = (await pagina.textContent('.tab[aria-selected="true"] .tab-name'))?.trim() ?? "";
    verifica(linguetta.includes(NOME), `la linguetta attiva è «${linguetta}», non «${NOME}»`);
    await pagina.waitForSelector('.pane.focus .cm-content:has-text("La voce")');
    const aperte = (await host.chiamate("openDocument")).map((args) => args[0]);
    verifica(aperte.includes(NOTA), `il finto host non ha aperto «${NOTA}» (${aperte.join(", ")})`);
  },
};

const scriviInLive = {
  id: "scrivi-in-live",
  nome: "scrivere in Live: un titolo, una lista, un grassetto",
  telefono: true,
  async fai(pagina) {
    await chooseMode(pagina, "live_preview");
    await pagina.click(".pane.focus .cm-content");
    await pagina.keyboard.press("Control+End");
    const tasti = pagina.keyboard;
    await tasti.press("Enter");
    await tasti.press("Enter");
    await tasti.type(`## ${TITOLO}`);
    await tasti.press("Enter");
    await tasti.press("Enter");
    // La lista continua da sé a ogni Invio, e Invio su una voce vuota la
    // chiude lasciando una riga senza segno; il terzo Invio stacca il
    // paragrafo dalla lista (senza la riga vuota, nel Markdown sarebbe il
    // seguito dell'ultima voce).
    await tasti.type(`- ${VOCI[0]}`);
    await tasti.press("Enter");
    await tasti.type(VOCI[1]);
    await tasti.press("Enter");
    await tasti.press("Enter");
    await tasti.press("Enter");
    // Il grassetto come in Word: Ctrl+B, la parola, Ctrl+B.
    await tasti.type("Una parola in ");
    await tasti.press("Control+b");
    await tasti.type(GRASSETTO);
    await tasti.press("Control+b");
    await tasti.type(".");
    // Il salvataggio parte 400 ms dopo l'ultimo tasto.
    await pagina.waitForFunction(
      () => document.querySelector("#save-state")?.dataset.state === "salvato",
      null,
      { timeout: 10_000 },
    );
  },
  async controlla(pagina, host) {
    const testo = await host.testo(NOTA);
    verifica(testo.startsWith(`# ${NOME}\n`), "il testo di prima non è più in testa alla nota");
    verifica(new RegExp(`^## ${TITOLO}$`, "m").test(testo), `nel Markdown manca il titolo «## ${TITOLO}»`);
    verifica(
      testo.includes(`\n- ${VOCI[0]}\n- ${VOCI[1]}\n`),
      `nel Markdown manca la lista «- ${VOCI[0]} / - ${VOCI[1]}»`,
    );
    verifica(testo.includes(`- ${VOCI[1]}\n\nUna parola in **${GRASSETTO}**.`), `nel Markdown manca il paragrafo con «**${GRASSETTO}**», staccato dalla lista`);
    const scritture = await host.chiamate("writeDocument");
    verifica(scritture.some((args) => args[0] === NOTA), "la nota non è arrivata al finto host");
    // La Live lo mostra composto: il titolo ha la sua pillola, la lista i
    // suoi pallini, il grassetto il suo stile.
    const live = '.pane.focus[data-mode="live_preview"] .cm-content';
    await pagina.waitForSelector(`${live} .cm-fub-strong:has-text("${GRASSETTO}")`, { state: "attached" });
    verifica(
      (await pagina.locator(`${live} .cm-fub-bullet`).count()) >= VOCI.length,
      "la Live non mostra i pallini della lista",
    );
    verifica(
      (await pagina.locator(`${live} .cm-fub-h2:has-text("${TITOLO}")`).count()) === 1,
      "la Live non mostra il titolo di livello 2",
    );
  },
};

const quattroModalita = {
  id: "quattro-modalita",
  nome: "le quattro modalità sulla stessa nota",
  async fai(pagina, giro) {
    for (const [modo, etichetta] of MODALITA) {
      await chooseMode(pagina, modo, etichetta);
      await pagina.waitForSelector(`.pane.focus[data-mode="${modo}"]`);
      await pagina.waitForFunction(
        (titolo) => document.querySelector(".pane.focus")?.innerText.includes(titolo) ?? false,
        TITOLO,
      );
      const testo = await testoDelRiquadro(pagina);
      verifica(testo.includes(GRASSETTO), `in ${etichetta} non si vede «${GRASSETTO}»`);
      // Solo la Sorgente mostra i segni del Markdown.
      const segni = testo.includes(`**${GRASSETTO}**`);
      verifica(segni === (modo === "source"), `in ${etichetta} i segni del grassetto ${segni ? "si vedono" : "non si vedono"}`);
      if (modo !== "live_preview") await giro.foto(etichetta);
    }
  },
  async controlla(pagina, host) {
    verifica(await pagina.isVisible('.pane.focus[data-mode="live_preview"]'), "il giro non è tornato alla Live");
    const linguetta = (await pagina.textContent('.tab[aria-selected="true"] .tab-name'))?.trim() ?? "";
    verifica(linguetta.includes(NOME), `cambiando modalità la nota è diventata «${linguetta}»`);
    // Guardare non scrive: il testo resta quello del compito di prima.
    const testo = await host.testo(NOTA);
    verifica(testo.includes(`Una parola in **${GRASSETTO}**.`), "cambiare modalità ha cambiato il Markdown");
  },
};

export const avvio = {
  id: "avvio",
  nome: "il primo avvio",
  // Il primo compito carica la pagina da sé: da solo, il gruppo non ha
  // niente da preparare.
  prepara: async () => {},
  compiti: [primoAvvio, apriVault, albero, scriviInLive, quattroModalita],
};
