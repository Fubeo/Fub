// **Il giro, gruppo «editor»** (compiti 12–15): i quattro editor dei file
// degli altri. Una frase in un documento Word, salvata; una formula in un
// foglio Excel che dà il risultato e «Ordina» dal menu «Comandi»; un
// rettangolo in un disegno SVG che finisce nel testo del disegno; una parola
// cercata in un PDF, e la pagina 3.
//
// La forma di un compito e ciò che `giro` e `host` portano sono in
// `bench/giro.mjs`. I compiti stanno sulla stessa pagina, uno dopo l'altro,
// ma ognuno apre il suo file: dipendono l'uno dall'altro soltanto per la
// cartella «Documenti» dell'albero, che il primo apre e l'ultimo trova aperta.
//
// I motori sono quelli del banco, non i veri: il Word è la proiezione che
// `fub-format-rich` dà davvero del file (`?rich=docx`), il disegno quello dei
// connettori (`?connectors=6`) col motore spento, cioè gli strumenti semplici
// del client; il PDF lo legge pdf.js come nell'app. La cartella di Excel
// (`?workbook=1`) e il manuale in PDF li accende `?giro=editor`
// (`bench/giro-fixture.ts`): il finto della griglia è un registratore, e qui
// risponde alla formula e all'ordine del compito, e a nient'altro. Il giro
// prova perciò la shell e i suoi gesti, non i calcoli del motore: che la
// formula e l'ordine partano come la persona li ha chiesti lo dice il registro
// delle chiamate, che il risultato si veda lo dice la pagina.
//
// Il primo compito carica la pagina con le query del gruppo, come «guasti»: da
// lì il vault riparte com'è nel banco.

/// Le query del gruppo: il Word, la cartella di Excel, il disegno, il PDF.
const QUERY = "rich=docx&workbook=1&connectors=6&giro=editor";

/// Il Word e la frase che il primo compito ci aggiunge, in fondo al paragrafo.
const WORD = "Documenti/Prova.docx";
const WORD_FOLDER = "Documenti";
const PARAGRAFO = "Una prosa forte con un link.";
const FRASE = "Una frase scritta dal giro.";

/// La cartella di Excel, la formula e l'ordine (`giro-fixture.ts`): B2 è 800,
/// B3 −120, B4 la somma; B7 si scrive (la riga 6 è nascosta).
const EXCEL = "Dati/Conti.xlsx";
const EXCEL_FOLDER = "Dati";
const FORMULA = "=B2*12";
const B7 = { row: 6, column: 1 };
const ORDINE = ["Home", "Modifica", "Ordina e filtra"];
const ORDINA = "Ordina dalla Z alla A";

/// Il disegno dei connettori, alla radice del vault.
const DISEGNO = "Connettori.svg";

/// Il manuale in PDF: la parola che si cerca sta soltanto a pagina 3.
const PDF = "Documenti/Manuale di Fub.pdf";
const CERCATA = "segnalibro";
const PAGINE = 4;

function verifica(condizione, messaggio) {
  if (!condizione) throw new Error(messaggio);
}

/// Il salvataggio parte poco dopo l'ultimo gesto: lo si aspetta finito.
async function salvato(pagina) {
  await pagina.waitForFunction(() => document.querySelector("#save-state")?.dataset.state === "salvato", null, {
    timeout: 10_000,
  });
}

/// Apre una cartella dell'albero, se è chiusa.
async function apriCartella(pagina, cartella) {
  const voce = `#file-list li[role="treeitem"][data-path="${cartella}"]`;
  if ((await pagina.getAttribute(voce, "aria-expanded")) !== "true") {
    await pagina.click(`${voce} > .tree-row.folder`);
    await pagina.waitForSelector(`${voce}[aria-expanded="true"]`);
  }
}

/// Apre un file dall'albero con un clic, e aspetta che la sua linguetta sia
/// quella attiva del riquadro a fuoco.
async function apriDallAlbero(pagina, cartella, file) {
  if (cartella !== null) await apriCartella(pagina, cartella);
  await pagina.click(`#file-list .tree-row[data-path="${file}"]`);
  await pagina.waitForSelector(`.pane.focus .sheet-title[data-path="${file}"]`);
}

/// Il testo della barra di stato in fondo alla finestra.
function bandaDiStato(pagina) {
  return pagina.evaluate(() => document.querySelector("#status-band")?.innerText ?? "");
}

/// Il testo di un documento com'è adesso nel finto host: ciò che c'era prima
/// di un gesto, per confrontarlo dopo.
function leggi(pagina, id) {
  return pagina.evaluate(async (doc) => {
    const { api } = await import("/bench/fake-ipc.ts");
    return (await api.readDocument(doc)).text;
  }, id);
}

/// Le chiamate del finto a `porta` che riguardano `doc` (il primo argomento).
async function chiamateSu(host, porta, doc) {
  return (await host.chiamate(porta)).filter((args) => args[0] === doc);
}

// ---------------------------------------------------------------------------
// Il Word.
// ---------------------------------------------------------------------------

/// I paragrafi della proiezione del Word come testo: i pezzi `x` di ogni
/// `para`, di fila.
function paragrafiDelWord(proiezione) {
  const paragrafi = [];
  const testo = (nodo) => {
    if (Array.isArray(nodo)) return nodo.map(testo).join("");
    if (nodo === null || typeof nodo !== "object") return "";
    return (typeof nodo.x === "string" ? nodo.x : "") + Object.entries(nodo).filter(([k]) => k !== "x").map(([, v]) => testo(v)).join("");
  };
  const visita = (nodo) => {
    if (Array.isArray(nodo)) return nodo.forEach(visita);
    if (nodo === null || typeof nodo !== "object") return;
    if (nodo.t === "para") paragrafi.push(testo(nodo));
    else Object.values(nodo).forEach(visita);
  };
  visita(JSON.parse(proiezione));
  return paragrafi;
}

const word = {
  id: "word",
  nome: "un documento Word: si scrive una frase, si salva, il finto ha il salvataggio",
  async fai(pagina, giro) {
    await giro.apri(QUERY);
    await pagina.waitForFunction(() => !document.querySelector(".avvio"), null, { timeout: 30_000 });
    await apriDallAlbero(pagina, WORD_FOLDER, WORD);
    const paragrafo = pagina.locator(`.pane.focus .rich-surface .ProseMirror p:has-text("${PARAGRAFO}")`);
    await paragrafo.waitFor();
    // Il clic nel paragrafo, poi in fondo alla riga, come chi continua a
    // scrivere dopo il punto.
    await paragrafo.click();
    await pagina.keyboard.press("End");
    await pagina.keyboard.type(` ${FRASE}`);
    await pagina.keyboard.press("Control+S");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    const scritture = await chiamateSu(host, "writeDocument", WORD);
    verifica(scritture.length > 0, "il Word non si è salvato: nessuna scrittura nel finto");
    const ultima = paragrafiDelWord(scritture.at(-1)[1]);
    verifica(ultima.includes(`${PARAGRAFO} ${FRASE}`), "l'ultimo salvataggio non ha la frase in fondo al paragrafo");
    // Il finto tiene ciò che si è salvato, e nient'altro è cambiato: gli
    // altri paragrafi sono quelli di prima.
    const ora = paragrafiDelWord(await host.testo(WORD));
    verifica(JSON.stringify(ora) === JSON.stringify(ultima), "il Word nel finto non è quello dell'ultimo salvataggio");
    verifica(ora.filter((p) => p.includes(FRASE)).length === 1, "la frase è finita in più di un paragrafo");
    await pagina.waitForSelector(`.pane.focus .rich-surface .ProseMirror p:has-text("${FRASE}")`);
    verifica(!(await pagina.isVisible(".pane.focus .tab.dirty")), "la linguetta del Word si dice ancora non salvata");
  },
};

// ---------------------------------------------------------------------------
// Il foglio Excel.
// ---------------------------------------------------------------------------

/// Il testo di una cella del foglio a fuoco, per riga e colonna da zero.
function cella(pagina, riga, colonna) {
  return pagina.evaluate(
    ([r, c]) => document.querySelector(`.pane.focus .grid-cell[data-row="${r}"][data-column="${c}"]`)?.textContent?.trim() ?? null,
    [riga, colonna],
  );
}

/// Aspetta che una cella mostri `testo`.
async function aspettaCella(pagina, riga, colonna, testo) {
  await pagina.waitForFunction(
    ([r, c, t]) => document.querySelector(`.pane.focus .grid-cell[data-row="${r}"][data-column="${c}"]`)?.textContent?.trim() === t,
    [riga, colonna, testo],
  );
}

/// Il centro di una cella quando sta ferma: la griglia arriva prima della
/// barra multifunzione e dell'avviso sopra di lei, che la spingono in giù.
async function centroDellaCella(pagina, riga, colonna) {
  const centro = await pagina.waitForFunction(
    ([r, c]) => {
      const box = document.querySelector(`.pane.focus .grid-cell[data-row="${r}"][data-column="${c}"]`)?.getBoundingClientRect();
      if (!box) return null;
      const ora = `${box.x},${box.y},${box.width},${box.height}`;
      const prima = window.__giroCella;
      window.__giroCella = ora;
      return prima === ora ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    },
    [riga, colonna],
    { polling: 100 },
  );
  return centro.jsonValue();
}

/// I giornali che la shell ha salvato sulla cartella, letti.
async function giornaliSalvati(host) {
  return (await chiamateSu(host, "writeDocument", EXCEL)).map((args) => JSON.parse(args[1]));
}

const excel = {
  id: "excel",
  nome: "un foglio Excel: una formula dà il risultato; «Ordina» dal menu «Comandi» cambia l'ordine",
  async fai(pagina, giro) {
    await apriDallAlbero(pagina, EXCEL_FOLDER, EXCEL);
    await pagina.waitForSelector('.pane.focus .grid-surface[data-grid-protocol="v2"] [role="gridcell"]');
    await pagina.waitForSelector(".pane.focus .grid-ribbon .grid-ribbon-panel:not([hidden])");
    await pagina.waitForFunction(() => (document.querySelector("#status-band")?.innerText ?? "").includes("Pronto"));

    // La formula in B7: il clic sulla cella, la formula, Invio.
    const b7 = await centroDellaCella(pagina, B7.row, B7.column);
    await pagina.mouse.click(b7.x, b7.y);
    await pagina.keyboard.type(FORMULA);
    await pagina.keyboard.press("Enter");
    await aspettaCella(pagina, B7.row, B7.column, "9600");
    await salvato(pagina);
    await giro.foto("formula");

    // A2:B3 scelto trascinando, poi «Comandi» › Home › Modifica › Ordina e
    // filtra › «Ordina dalla Z alla A».
    const da = await centroDellaCella(pagina, 1, 0);
    const a = await centroDellaCella(pagina, 2, 1);
    await pagina.mouse.move(da.x, da.y);
    await pagina.mouse.down();
    await pagina.mouse.move(a.x, a.y, { steps: 6 });
    await pagina.mouse.up();
    await pagina.waitForFunction(() => document.querySelectorAll(".pane.focus .grid-cell.selected").length >= 4);
    await pagina.click(".pane.focus .grid-ribbon-quick .grid-ribbon-button");
    await pagina.waitForSelector("#context-menu .menu-items [role^=menuitem]");
    for (const voce of ORDINE) {
      const riga = pagina.locator(".context-menu .menu-items [role^=menuitem]", {
        has: pagina.locator(".menu-label", { hasText: new RegExp(`^${voce}$`) }),
      }).last();
      await riga.click();
      await pagina.waitForSelector(`.context-submenu[aria-label="${voce}"]`);
    }
    await giro.foto("comandi");
    await pagina.locator(`.context-submenu[aria-label="${ORDINE.at(-1)}"] [role^=menuitem]`, { hasText: ORDINA }).click();
    await pagina.waitForSelector("#context-menu", { state: "detached" });
    await aspettaCella(pagina, 1, 0, "Spesa");
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    // La shell ha chiesto la formula com'è stata scritta, nella cella giusta.
    const modifiche = await host.chiamate("applyGridBytes");
    verifica(modifiche.length === 1, `le modifiche chieste al provider sono ${modifiche.length}, non una`);
    const [patch] = modifiche[0][1].patches;
    verifica(
      modifiche[0][1].patches.length === 1 && patch.cell.row === "r6" && patch.cell.column === "c1" && patch.after === FORMULA,
      `la modifica chiesta è ${JSON.stringify(modifiche[0][1].patches)}`,
    );
    // E «Ordina» sull'intervallo scelto: i comandi che la griglia chiede da
    // sé (le funzioni proposte nel menu) non contano.
    const ordini = (await host.chiamate("gridBytesCommand")).filter((args) => args[1].command.id.startsWith("data.sort"));
    verifica(ordini.length === 1, `gli ordini chiesti sono ${ordini.length}, non uno`);
    const { command } = ordini[0][1];
    verifica(
      command.id === "data.sortDescending" && command.selection === "A2:B3",
      `l'ordine chiesto è «${command.id}» su ${command.selection}, non dalla Z alla A su A2:B3`,
    );
    // La pagina: «Spesa» sopra «Affitto» coi loro importi, e le formule che
    // li leggono ricalcolate.
    const viste = [];
    for (const [r, c] of [[1, 0], [1, 1], [2, 0], [2, 1], [3, 1], [B7.row, B7.column]]) viste.push(await cella(pagina, r, c));
    verifica(
      JSON.stringify(viste) === JSON.stringify(["Spesa", "-120", "Affitto", "800", "680", "-1440"]),
      `dopo l'ordine A2, B2, A3, B3, B4 e B7 mostrano ${JSON.stringify(viste)}`,
    );
    // Il salvataggio: il giornale con la formula, poi con l'ordine.
    const giornali = await giornaliSalvati(host);
    const comandi = giornali.flatMap((g) => g.commands ?? []).map((c) => c.id);
    verifica(comandi.includes("range.setValues") && comandi.includes("data.sortDescending"), `i salvataggi della cartella hanno ${JSON.stringify(comandi)}`);
    verifica(!(await pagina.isVisible(".pane.focus .tab.dirty")), "la linguetta della cartella si dice ancora non salvata");
  },
};

// ---------------------------------------------------------------------------
// Il disegno SVG.
// ---------------------------------------------------------------------------

/// Gli id dei rettangoli nel testo del disegno.
function rettangoli(svg) {
  return [...svg.matchAll(/<rect\b[^>]*\bid="([^"]+)"[^>]*>/g)].map((m) => ({ id: m[1], tag: m[0] }));
}

function attributo(tag, nome) {
  const valore = new RegExp(`\\s${nome}="([^"]*)"`).exec(tag)?.[1];
  return valore === undefined ? Number.NaN : Number(valore);
}

/// Il trascinamento del rettangolo, in pixel della pagina, e la scala della
/// pagina del disegno sullo schermo: li guarda `controlla`.
let tratto = null;
/// Il testo del disegno prima del rettangolo.
let primaDelRettangolo = "";

const svg = {
  id: "svg",
  nome: "un disegno SVG: il rettangolo fa una forma, e la forma è nel testo del disegno",
  async fai(pagina, giro) {
    primaDelRettangolo = await leggi(pagina, DISEGNO);
    await apriDallAlbero(pagina, null, DISEGNO);
    await pagina.waitForSelector(".draw-editor .draw-surface");
    // Il disegno è pronto quando la barra di stato conta i suoi oggetti.
    await pagina.waitForFunction(() => /\d+ oggetti/.test(document.querySelector("#status-band")?.innerText ?? ""));
    const oggetti = Number(/(\d+) oggetti/.exec(await bandaDiStato(pagina))[1]);
    await pagina.click('.draw-editor .draw-tool[data-tool="rect"]');
    await pagina.waitForSelector('.draw-editor .draw-tool[data-tool="rect"][aria-pressed="true"]');
    // Un rettangolo nel bianco della pagina, a destra dei fili.
    const carta = await pagina.locator(".draw-editor .draw-surface .draw-page").boundingBox();
    verifica(carta !== null, "la pagina del disegno non si vede");
    const da = { x: carta.x + carta.width * 0.52, y: carta.y + carta.height * 0.52 };
    const a = { x: carta.x + carta.width * 0.74, y: carta.y + carta.height * 0.8 };
    await pagina.mouse.move(da.x, da.y);
    await pagina.mouse.down();
    await pagina.mouse.move((da.x + a.x) / 2, (da.y + a.y) / 2, { steps: 5 });
    await pagina.mouse.move(a.x, a.y, { steps: 5 });
    await pagina.mouse.up();
    await pagina.waitForFunction((n) => (document.querySelector("#status-band")?.innerText ?? "").includes(`${n} oggetti`), oggetti + 1);
    await salvato(pagina);
    // La pagina sullo schermo è larga quanto il `viewBox` del disegno, alla
    // scala dello zoom.
    const viewBox = /\bviewBox="[-\d.]+ [-\d.]+ ([\d.]+) /.exec(primaDelRettangolo);
    verifica(viewBox !== null, "il disegno non ha un viewBox");
    tratto = { larghezza: a.x - da.x, altezza: a.y - da.y, scala: carta.width / Number(viewBox[1]), oggetti };
  },
  async controlla(pagina, host) {
    const ora = await host.testo(DISEGNO);
    const scritture = await chiamateSu(host, "writeDocument", DISEGNO);
    verifica(scritture.length > 0, "il disegno non si è salvato: nessuna scrittura nel finto");
    verifica(scritture.at(-1)[1] === ora, "il disegno nel finto non è quello dell'ultimo salvataggio");
    const prima = new Set(rettangoli(primaDelRettangolo).map((r) => r.id));
    const nuovi = rettangoli(ora).filter((r) => !prima.has(r.id));
    verifica(nuovi.length === 1, `nel testo del disegno ci sono ${nuovi.length} rettangoli nuovi, non uno`);
    const [nuovo] = nuovi;
    const larghezza = attributo(nuovo.tag, "width");
    const altezza = attributo(nuovo.tag, "height");
    const attesa = { larghezza: tratto.larghezza / tratto.scala, altezza: tratto.altezza / tratto.scala };
    verifica(
      Math.abs(larghezza - attesa.larghezza) < attesa.larghezza * 0.05 && Math.abs(altezza - attesa.altezza) < attesa.altezza * 0.05,
      `il rettangolo è ${larghezza} × ${altezza}, il trascinamento ${attesa.larghezza.toFixed(0)} × ${attesa.altezza.toFixed(0)}`,
    );
    // Ciò che c'era resta: le forme di prima e la pagina.
    const perse = [...prima].filter((id) => !rettangoli(ora).some((r) => r.id === id));
    verifica(perse.length === 0, `il salvataggio ha perso i rettangoli ${perse.join(", ")}`);
    const banda = await bandaDiStato(pagina);
    verifica(banda.includes(`${tratto.oggetti + 1} oggetti`), `la barra di stato dice «${banda.replace(/\s+/g, " ")}»`);
  },
};

// ---------------------------------------------------------------------------
// Il PDF.
// ---------------------------------------------------------------------------

/// La riga di stato del visore: il caricamento, la ricerca, gli errori.
function rigaDelPdf(pagina) {
  return pagina.evaluate(() => document.querySelector(".pane.focus .media-pdf > [role=status]")?.textContent?.trim() ?? "");
}

/// La pagina che il visore dice di mostrare, disegnata.
async function aspettaPagina(pagina, numero) {
  await pagina.waitForFunction(
    ([n, tot]) => {
      const piano = document.querySelector(".pane.focus .media-pdf-page");
      return piano?.getAttribute("aria-label") === `Pagina ${n} di ${tot}` && (piano.querySelector("canvas")?.width ?? 0) > 0;
    },
    [numero, PAGINE],
  );
}

const pdf = {
  id: "pdf",
  nome: "un PDF: la ricerca trova una parola, si va a pagina 3",
  async fai(pagina, giro) {
    await apriDallAlbero(pagina, WORD_FOLDER, PDF);
    // Il PDF è pronto quando la riga di stato conta le pagine e la prima è
    // disegnata.
    await aspettaPagina(pagina, 1);
    await pagina.click(".pane.focus .media-pdf-search input");
    await pagina.keyboard.type(CERCATA);
    await pagina.keyboard.press("Enter");
    await pagina.waitForFunction(() => /^Risultati|^Nessun risultato/.test(document.querySelector(".pane.focus .media-pdf > [role=status]")?.textContent ?? ""));
    const trovata = await rigaDelPdf(pagina);
    verifica(trovata === "Risultati: 1, il primo a pagina 3", `cercando «${CERCATA}» il visore dice «${trovata}»`);
    await giro.foto("ricerca");
    // La ricerca dice la pagina, non ci porta: la persona va avanti di due.
    const avanti = '.pane.focus .media-pdf-toolbar button[aria-label="Pagina successiva"]';
    await pagina.click(avanti);
    await aspettaPagina(pagina, 2);
    await pagina.click(avanti);
    await aspettaPagina(pagina, 3);
  },
  async controlla(pagina) {
    const banda = await bandaDiStato(pagina);
    verifica(banda.includes(`Pagina 3 di ${PAGINE}`), `la barra di stato dice «${banda.replace(/\s+/g, " ")}»`);
    // A metà del PDF si va avanti e indietro.
    verifica(await pagina.isEnabled('.pane.focus .media-pdf-toolbar button[aria-label="Pagina precedente"]'), "a pagina 3 «Pagina precedente» è spento");
    verifica(await pagina.isEnabled('.pane.focus .media-pdf-toolbar button[aria-label="Pagina successiva"]'), "a pagina 3 «Pagina successiva» è spento");
    // La parola cercata resta nel campo.
    const campo = await pagina.inputValue(".pane.focus .media-pdf-search input");
    verifica(campo === CERCATA, `il campo della ricerca dice «${campo}»`);
  },
};

export const editor = {
  id: "editor",
  nome: "i quattro editor dei file degli altri",
  // Il primo compito carica la pagina da sé, con le query del gruppo.
  prepara: async () => {},
  compiti: [word, excel, svg, pdf],
};
