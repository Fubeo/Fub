// **Il giro, gruppo «scrivere»** (compiti 6–11): scrivere e muoversi fra le
// note. Una tabella dal «/» e un blocco spostato con la maniglia, il grassetto
// dal tasto destro, un comando dalla palette, due riquadri col fuoco che
// passa, una nota rinominata dall'albero coi link che la seguono, la ricerca e
// il pannello «In entrata».
//
// La forma di un compito e ciò che `giro` e `host` portano sono in
// `bench/giro.mjs`. I compiti dipendono l'uno dall'altro: tutti scrivono e
// guardano nella nota che il primo apre, il nono la affianca a un'altra, il
// decimo rinomina una nota che quella di destra nomina.
//
// I comandi di formato. Il finto host della finestra dichiara i comandi di
// `fub.formatting` (le voci del «/», il grassetto della mini-barra) soltanto
// con `?slash=1` e `?formatbar=1`, perché le foto delle altre scene sono fatte
// senza; l'host vero li ha sempre. Il primo compito ricarica perciò la pagina
// con le due query, se non le ha già, e da lì il vault riparte com'è nel banco:
// ciò che il gruppo «avvio» aveva scritto nel finto in memoria non c'è più, e
// nessun compito di questo gruppo lo cerca.
import { chooseMode } from "../scene.mjs";

/// La query che dà alla finestra i comandi di formato dell'host vero.
const FORMATO = "formatbar=1&slash=1";
/// La nota in cui il gruppo scrive, dal vault del banco (`corpus.ts`).
const CARTELLA = "Progetti";
const NOTA = "Progetti/Il banco che vede.md";
const NOME = "Il banco che vede";
/// La parola che il settimo compito mette in grassetto.
const PAROLA = "trentuno";
/// Il paragrafo e l'etichetta che il sesto compito scambia con la maniglia.
const PARAGRAFO = "La voce [[31.1]] della seduta";
const ETICHETTA = "#seduta-31";
/// La tabella che il «/» mette: 3 × 3, con la riga dei titoli.
const TABELLA = ["| Colonna 1 | Colonna 2 | Colonna 3 |", "| --- | --- | --- |", "|  |  |  |", "|  |  |  |"].join("\n");
/// Il comando che l'ottavo compito cerca nella palette, e ciò che basta
/// scrivere per trovarlo.
const COMANDO = "Comprimi tutte le cartelle";
const CERCA_COMANDO = "comprimi tutte";
/// La nota che il nono compito apre a destra.
const ACCANTO = "Benvenuto.md";
const NOME_ACCANTO = "Benvenuto";
/// La nota che il decimo compito rinomina, e chi la nomina (`corpus.ts`): la
/// nota di destra per nome, «Sintassi di Fub» con un alias.
const RINOMINATA = "Guida/Frammenti di codice.md";
const VECCHIO = "Frammenti di codice";
const NUOVO = "Frammenti";
const SINTASSI = "Guida/Sintassi di Fub.md";
/// La parola che l'undicesimo compito cerca: nel vault la scrive soltanto
/// «Sintassi di Fub», e chi nomina «Sintassi di Fub» sono queste due note.
const CERCATA = "specifica";
const NOME_SINTASSI = "Sintassi di Fub";
const IN_ENTRATA = [
  ["Benvenuto", "Benvenuto.md"],
  ["Il banco che vede", NOTA],
];

function verifica(condizione, messaggio) {
  if (!condizione) throw new Error(messaggio);
}

/// Il salvataggio parte 400 ms dopo l'ultimo gesto: lo si aspetta finito.
async function salvato(pagina) {
  await pagina.waitForFunction(() => document.querySelector("#save-state")?.dataset.state === "salvato", null, {
    timeout: 10_000,
  });
}

/// La linguetta attiva del riquadro a fuoco, se ha questo nome.
function aFuoco(nome) {
  return `.pane.focus .tab[aria-selected="true"] .tab-name:text-is("${nome}")`;
}

/// Il riquadro la cui linguetta attiva ha questo nome.
function riquadroDi(pagina, nome) {
  return pagina.locator(".pane").filter({
    has: pagina.locator('.tab[aria-selected="true"] .tab-name', { hasText: new RegExp(`^\\s*${nome}\\s*$`) }),
  });
}

/// Dentro il riquadro c'è l'elemento che ha la tastiera.
function haLaTastiera(riquadro) {
  return riquadro.evaluate((pane) => pane.contains(document.activeElement));
}

/// Il centro di una parola della nota nel riquadro a fuoco, dove la persona
/// punta il mouse.
async function centroDi(pagina, parola) {
  const punto = await pagina.evaluate((cercata) => {
    for (const riga of document.querySelectorAll(".pane.focus .cm-content .cm-line")) {
      const testi = document.createTreeWalker(riga, NodeFilter.SHOW_TEXT);
      for (let nodo = testi.nextNode(); nodo; nodo = testi.nextNode()) {
        const at = nodo.textContent.indexOf(cercata);
        if (at < 0) continue;
        const pezzo = document.createRange();
        pezzo.setStart(nodo, at);
        pezzo.setEnd(nodo, at + cercata.length);
        const box = pezzo.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
    }
    return null;
  }, parola);
  verifica(punto !== null, `nella nota non si vede «${parola}»`);
  return punto;
}

/// Apre una cartella dell'albero, se è chiusa.
async function apriCartella(pagina, cartella) {
  const voce = `#file-list li[role="treeitem"][data-path="${cartella}"]`;
  if ((await pagina.getAttribute(voce, "aria-expanded")) !== "true") {
    await pagina.click(`${voce} > .tree-row.folder`);
    await pagina.waitForSelector(`${voce}[aria-expanded="true"]`);
  }
}

const tabellaEManiglia = {
  id: "tabella-e-maniglia",
  nome: "«/» mette una tabella; la maniglia sposta un blocco",
  async fai(pagina, giro) {
    const query = new URL(pagina.url()).searchParams;
    if (query.get("formatbar") !== "1" || query.get("slash") !== "1") {
      await giro.apri(FORMATO);
      await pagina.waitForFunction(() => !document.querySelector(".avvio"), null, { timeout: 30_000 });
    }
    await apriCartella(pagina, CARTELLA);
    await pagina.click(`#file-list .tree-row.note[data-path="${NOTA}"]`);
    await pagina.waitForSelector(aFuoco(NOME));
    await pagina.waitForSelector('.pane.focus .cm-content:has-text("La voce")');
    await chooseMode(pagina, "live_preview");

    // Il «/» si chiude se il fuoco scappa: prima il fuoco nel testo, in fondo.
    await pagina.click(".pane.focus .cm-content");
    await pagina.keyboard.press("Control+End");
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.type("/tabella");
    await pagina.waitForSelector('.slash-panel .slash-row[aria-selected="true"]:has-text("Tabella")');
    await giro.foto("menu");
    // La tabella apre il suo passo (righe × colonne); Invio tiene il 3 × 3.
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel.is-step .slash-step.is-table");
    await giro.foto("passo");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
    await pagina.waitForSelector(".pane.focus .cm-content .tb-grid", { state: "attached" });
    await salvato(pagina);
    await giro.foto("tabella");

    // Nei Blocchi: l'etichetta presa per la maniglia e portata sopra il
    // paragrafo.
    await chooseMode(pagina, "blocks");
    // La testata della pagina arriva dopo e sposta la nota in giù: le
    // misure si prendono quando c'è.
    await pagina.waitForSelector(".pane.focus .cm-fub-page-title");
    await pagina.hover(`.pane.focus .cm-content .cm-line:has-text("${ETICHETTA}")`);
    await pagina.waitForSelector('.pane.focus .cm-fub-block-handles[data-active="true"]');
    const maniglia = await pagina.locator(".pane.focus .cm-fub-block-grip").boundingBox();
    const sopra = await pagina.locator('.pane.focus .cm-content .cm-line:has-text("La voce")').boundingBox();
    const x = maniglia.x + maniglia.width / 2;
    const y = maniglia.y + maniglia.height / 2;
    await pagina.mouse.move(x, y);
    await pagina.mouse.down();
    await pagina.mouse.move(x, y - 10, { steps: 3 });
    await pagina.mouse.move(x, sopra.y + 2, { steps: 8 });
    await pagina.mouse.up();
    await pagina.waitForSelector(".pane.focus .cm-fub-blocks-dragging", { state: "detached" });
    await salvato(pagina);
    // Il gruppo continua in Live.
    await chooseMode(pagina, "live_preview");
  },
  async controlla(pagina, host) {
    const testo = await host.testo(NOTA);
    verifica(testo.startsWith(`# ${NOME}\n`), "il titolo non è più in testa alla nota");
    verifica(testo.includes(TABELLA), "nel Markdown manca la tabella 3 × 3 del «/»");
    const etichetta = testo.indexOf(`\n${ETICHETTA}\n`);
    const paragrafo = testo.indexOf(PARAGRAFO);
    verifica(etichetta >= 0 && paragrafo >= 0, `la maniglia ha perso «${ETICHETTA}» o il paragrafo`);
    verifica(etichetta < paragrafo, `«${ETICHETTA}» non è salito sopra il paragrafo`);
    verifica(testo.indexOf(TABELLA) > paragrafo, "spostando un blocco la tabella non è più in fondo");
    verifica(!testo.includes("/tabella"), "il «/tabella» scritto è rimasto nel testo");
    // La Live la mostra come tabella, non come righe di barre.
    await pagina.waitForSelector('.pane.focus[data-mode="live_preview"] .cm-content .tb-grid', { state: "attached" });
  },
};

const grassettoDalMenu = {
  id: "grassetto-dal-menu",
  nome: "il tasto destro sul testo: il menu, e «Grassetto» cambia il testo",
  async fai(pagina, giro) {
    // La parola scelta col doppio clic, poi il tasto destro sopra: dentro la
    // selezione il menu la lascia.
    const punto = await centroDi(pagina, PAROLA);
    await pagina.mouse.dblclick(punto.x, punto.y);
    await pagina.mouse.click(punto.x, punto.y, { button: "right" });
    await pagina.waitForSelector("#context-menu .menu-head");
    const testata = (await pagina.textContent("#context-menu .menu-head"))?.trim() ?? "";
    verifica(testata.includes("Selezione"), `il menu dice «${testata}», non la selezione`);
    // «Grassetto» sta nella mini-barra sopra il menu (docs/product/editor-menus.md).
    await pagina.waitForSelector('.context-strip button[data-command="markdown.bold"]');
    await giro.foto("menu");
    await pagina.click('.context-strip button[data-command="markdown.bold"]');
    await pagina.waitForSelector("#context-menu", { state: "detached" });
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    const testo = await host.testo(NOTA);
    verifica(testo.includes(`seduta **${PAROLA}**.`), `nel Markdown «${PAROLA}» non è in grassetto`);
    verifica((testo.match(/\*\*/g) ?? []).length === 2, "il grassetto ha toccato altro oltre la parola");
    await pagina.waitForSelector(`.pane.focus .cm-content .cm-fub-strong:has-text("${PAROLA}")`, { state: "attached" });
  },
};

const palette = {
  id: "palette",
  nome: "la palette: cercare un comando ed eseguirlo",
  async fai(pagina, giro) {
    // Che il comando faccia qualcosa: una cartella aperta, prima.
    verifica(
      (await pagina.locator('#file-list li[role="treeitem"][aria-expanded="true"]').count()) > 0,
      "nell'albero non c'è una cartella aperta da chiudere",
    );
    // La palette è `shell.palette`, Ctrl+Maiusc+P: il lanciatore nel modo
    // dei comandi. Ctrl+K nel testo è «Collega a una nota».
    await pagina.keyboard.press("Control+Shift+P");
    await pagina.waitForSelector(".launcher-input:focus");
    const modo = (await pagina.textContent('.launcher-modes [aria-selected="true"]'))?.trim() ?? "";
    verifica(modo.startsWith("Comandi"), `la palette si apre nel modo «${modo}», non in «Comandi»`);
    await pagina.keyboard.type(CERCA_COMANDO);
    await pagina.waitForSelector(`.launcher-row:has-text("${COMANDO}")`);
    const primo = (await pagina.textContent(".launcher-row .launcher-row-title"))?.trim() ?? "";
    verifica(primo === COMANDO, `la palette mette prima «${primo}», non «${COMANDO}»`);
    await giro.foto("cerca");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".launcher-layer", { state: "detached" });
  },
  async controlla(pagina) {
    const aperte = await pagina.locator('#file-list li[role="treeitem"][aria-expanded="true"]').count();
    verifica(aperte === 0, `«${COMANDO}» ha lasciato ${aperte} cartelle aperte`);
    // La nota resta dov'era: il comando non apre e non chiude documenti.
    await pagina.waitForSelector(aFuoco(NOME));
  },
};

const dueRiquadri = {
  id: "due-riquadri",
  nome: "due riquadri: una nota a sinistra, un'altra a destra, il fuoco passa",
  async fai(pagina) {
    await pagina.click(`#file-list li[data-path="${ACCANTO}"] > .tree-row`, { button: "right" });
    await pagina.click('#context-menu [role^="menuitem"]:has-text("Apri a lato")');
    await pagina.waitForSelector(aFuoco(NOME_ACCANTO));
    await pagina.waitForSelector('.pane.focus .cm-content:has-text("Benvenuto in Fub")');
    // Il fuoco è nella nota appena aperta, a destra.
    verifica(await haLaTastiera(riquadroDi(pagina, NOME_ACCANTO)), "aperta a lato, la nota non ha la tastiera");
    // Un clic nel testo di sinistra porta lì il fuoco.
    await riquadroDi(pagina, NOME).locator(".cm-content").click();
    await pagina.waitForSelector(aFuoco(NOME));
  },
  async controlla(pagina) {
    const riquadri = await pagina.evaluate(() =>
      [...document.querySelectorAll(".pane")].map((pane) => ({
        nome: pane.querySelector('.tab[aria-selected="true"] .tab-name')?.textContent?.trim() ?? "",
        fuoco: pane.classList.contains("focus"),
        attivo: pane.contains(document.activeElement),
        x: pane.getBoundingClientRect().x,
      })),
    );
    verifica(riquadri.length === 2, `i riquadri sono ${riquadri.length}, non due`);
    const [sinistra, destra] = [...riquadri].sort((a, b) => a.x - b.x);
    verifica(sinistra.nome === NOME && destra.nome === NOME_ACCANTO, `a sinistra «${sinistra.nome}», a destra «${destra.nome}»`);
    verifica(sinistra.fuoco && !destra.fuoco, "il fuoco non è passato al riquadro di sinistra");
    verifica(sinistra.attivo, "il riquadro di sinistra si dice a fuoco, ma la tastiera è altrove");
  },
};

const rinomina = {
  id: "rinomina",
  nome: "rinominare una nota nell'albero: i link che la nominano cambiano",
  async fai(pagina) {
    await apriCartella(pagina, "Guida");
    await pagina.click(`#file-list li[data-path="${RINOMINATA}"] > .tree-row`, { button: "right" });
    await pagina.click('#context-menu [role^="menuitem"]:has-text("Rinomina")');
    const campo = `#file-list li[data-path="${RINOMINATA}"] input`;
    await pagina.waitForSelector(`${campo}:focus`);
    const prima = await pagina.inputValue(campo);
    verifica(prima === VECCHIO, `il campo propone «${prima}», non «${VECCHIO}»`);
    await pagina.keyboard.press("Control+A");
    await pagina.keyboard.type(NUOVO);
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(`#file-list li[data-path="Guida/${NUOVO}.md"]`, { state: "attached" });
  },
  async controlla(pagina, host) {
    const chieste = (await host.chiamate("invokeCommand")).filter((args) => args[0] === "note.rename");
    verifica(
      chieste.length === 1 && chieste[0][1]?.doc === RINOMINATA && chieste[0][1]?.to === `Guida/${NUOVO}.md`,
      `note.rename: ${JSON.stringify(chieste.map((args) => args[1]))}`,
    );
    verifica((await pagina.locator(`#file-list li[data-path="${RINOMINATA}"]`).count()) === 0, "l'albero mostra ancora il nome di prima");
    const benvenuto = await host.testo(ACCANTO);
    verifica(benvenuto.includes(`[[${NUOVO}]]`) && !benvenuto.includes(`[[${VECCHIO}`), `in «${NOME_ACCANTO}» il link non è diventato [[${NUOVO}]]`);
    const sintassi = await host.testo(SINTASSI);
    verifica(sintassi.includes(`[[${NUOVO}|i frammenti]]`), `in «${NOME_SINTASSI}» il link con l'alias non è diventato [[${NUOVO}|i frammenti]]`);
    // La nota di destra la nomina, e lo mostra senza riaprirla. Il riquadro
    // dice anche che il file è cambiato su disco: è vero, l'ha riscritto la
    // rinomina (il dubbio sulla frase è nel resoconto di PA T26).
    const destra = await riquadroDi(pagina, NOME_ACCANTO).locator(".cm-content").elementHandle();
    await pagina.waitForFunction(
      ([testo, nuovo, vecchio]) => testo.innerText.includes(`in ${nuovo}.`) && !testo.innerText.includes(vecchio),
      [destra, NUOVO, VECCHIO],
    );
  },
};

const ricercaEInEntrata = {
  id: "ricerca-e-in-entrata",
  nome: "la ricerca trova una parola; «In entrata» mostra chi nomina la nota",
  async fai(pagina, giro) {
    await pagina.click('#views-ribbon .rail-btn[data-panel="search"]');
    await pagina.fill("#search-input", CERCATA);
    const risultato = `#search-results .search-result:has(.hit-title:text-is("${NOME_SINTASSI}"))`;
    await pagina.waitForSelector(`${risultato} mark:text-is("${CERCATA}")`);
    await giro.foto("ricerca");
    // Sul nome: sul percorso, al passaggio, stanno «Escludi» e «Escludi
    // cartella».
    await pagina.click(`${risultato} .hit-title`);
    await pagina.waitForSelector(aFuoco(NOME_SINTASSI));
    await pagina.click('.inspector-tab[data-view-id="backlinks"]');
    await pagina.waitForSelector('#view-panel-backlinks [data-key="incoming"] .ui-list-item');
  },
  async controlla(pagina, host) {
    const trovati = await pagina.locator("#search-results .search-result .hit-title").allTextContents();
    verifica(trovati.length === 1 && trovati[0].trim() === NOME_SINTASSI, `la ricerca di «${CERCATA}» trova ${JSON.stringify(trovati)}`);
    const titolo = (await pagina.textContent('#view-panel-backlinks [data-key="incoming"] > summary'))?.trim() ?? "";
    verifica(titolo === `In entrata · ${IN_ENTRATA.length}`, `il pannello dice «${titolo}»`);
    const voci = (await pagina.locator('#view-panel-backlinks [data-key="incoming"] .ui-list-item-title').allTextContents()).map((v) => v.trim());
    verifica(
      JSON.stringify([...voci].sort()) === JSON.stringify(IN_ENTRATA.map(([nome]) => nome).sort()),
      `«In entrata» mostra ${JSON.stringify(voci)}`,
    );
    // Ogni voce nomina davvero la nota: il finto risponde un pannello fisso,
    // ed è giusto soltanto per questa nota.
    for (const [nome, doc] of IN_ENTRATA) {
      verifica((await host.testo(doc)).includes(`[[${NOME_SINTASSI}]]`), `«${nome}» è in entrata ma non nomina «${NOME_SINTASSI}»`);
    }
  },
};

export const scrivere = {
  id: "scrivere",
  nome: "scrivere e muoversi",
  compiti: [tabellaEManiglia, grassettoDalMenu, palette, dueRiquadri, rinomina, ricercaEInEntrata],
};
