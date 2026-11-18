// **Il giro, gruppo «lavagna»** (compiti 16–17): la lavagna e la penna. Una
// lavagna vuota dall'albero; una scheda scritta dal pulsante della lavagna
// vuota, una seconda messa col Testo, un filo tirato fra le due con Collega;
// poi un tratto della penna su una scheda, e la Gomma che lo toglie. Ogni
// compito guarda il file `.canvas` nel finto host, non soltanto la pagina.
//
// La forma di un compito e ciò che `giro` e `host` portano sono in
// `bench/giro.mjs`. Il compito 17 del piano sono due compiti del giro, la penna
// e la gomma, perché ognuno guardi il file com'è dopo il suo gesto. Tutti e
// tre lavorano sulla lavagna che il primo riempie.
//
// La lavagna vuota. Il vault del banco ha le lavagne soltanto con `?lavagna=1`
// (`bench/fake-ipc.ts`, quelle delle scene `lavagna-*`), perché le foto delle
// altre scene sono fatte senza: il primo compito ricarica la pagina con la
// query, come «scrivere» fa con le sue, e da lì il vault riparte com'è nel
// banco. Si comincia da `Lavagne/Vuota.canvas` e non da «Nuova lavagna»: il
// finto host dichiara `canvas.create` (con `?nuovo=tutto`) ma non lo fa.
//
// La penna. Playwright non ha una penna: il tratto passa dal protocollo del
// browser (`Input.dispatchMouseEvent` con `pointerType: "pen"`), che dà alla
// pagina i `pointerdown`, `pointermove` e `pointerup` di una penna vera, con la
// pressione (`force`) che cambia lungo il tratto. Il compito controlla che il
// file la tenga (il canale `p` dei campioni, `sim=0` nel pennello); se un
// giorno il banco non la desse più, il compito lo direbbe invece di passare
// con la pressione simulata.

/// La query che mette nel vault del banco le lavagne.
const LAVAGNE = "lavagna=1";
/// La lavagna vuota del banco, dov'è nell'albero e il nome della linguetta.
const CARTELLA = "Lavagne";
const LAVAGNA = "Lavagne/Vuota.canvas";
const NOME = "Vuota";
/// Ciò che il primo compito scrive nelle due schede.
const PRIMA = "Domande per la seduta";
const SECONDA = "Chiedere la varianza";
/// La pressione della penna lungo il tratto: da leggera a forte, come una
/// persona che calca sempre di più. È la `force` del protocollo, fra 0 e 1.
const PRESSIONE = { da: 0.25, a: 0.85 };

function verifica(condizione, messaggio) {
  if (!condizione) throw new Error(messaggio);
}

/// Il salvataggio parte dopo l'ultimo gesto: lo si aspetta finito.
async function salvato(pagina) {
  await pagina.waitForFunction(() => document.querySelector("#save-state")?.dataset.state === "salvato", null, {
    timeout: 10_000,
  });
}

/// Il file della lavagna com'è adesso nel finto host, letto come JSON.
async function laLavagna(host) {
  const testo = await host.testo(LAVAGNA);
  try {
    return JSON.parse(testo);
  } catch {
    throw new Error(`«${LAVAGNA}» non è più JSON: ${testo.slice(0, 120)}`);
  }
}

/// La scheda della lavagna a fuoco che mostra questo testo.
function scheda(pagina, testo) {
  return pagina.locator(".pane.focus .canvas-node").filter({ hasText: testo });
}

/// Il riquadro di una scheda sullo schermo; lancia se non si vede.
async function riquadro(pagina, testo) {
  const box = await scheda(pagina, testo).boundingBox();
  verifica(box !== null, `sulla lavagna non si vede la scheda «${testo}»`);
  return box;
}

/// Lo strumento della colonna, scelto con un clic, e acceso.
async function strumento(pagina, id) {
  const casella = `.pane.focus .canvas-tool[data-tool="${id}"]`;
  await pagina.click(casella);
  await pagina.waitForSelector(`${casella}[aria-pressed="true"]`);
}

/// Si esce dalla scheda in cui si scrive: il primo Esc registra e chiude, il
/// secondo toglie la scelta. Si aspetta la lavagna di nuovo a fuoco.
async function esciDallaScheda(pagina) {
  await pagina.keyboard.press("Escape");
  await pagina.waitForSelector(".pane.focus .canvas-node .cm-content", { state: "detached" });
  await pagina.keyboard.press("Escape");
  await pagina.waitForSelector(".pane.focus .canvas-node.selected", { state: "detached" });
}

/// La penna, dal protocollo del browser: appoggia, scorre lungo `punti` con la
/// pressione che cresce da `PRESSIONE.da` a `PRESSIONE.a`, alza. `aMeta`, se
/// c'è, si chiama a metà tratto, con la penna ancora giù.
async function tratto(pagina, punti, aMeta) {
  const cdp = await pagina.context().newCDPSession(pagina);
  try {
    const evento = (type, [x, y], i, giu) =>
      cdp.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: type === "mouseMoved" && !giu ? "none" : "left",
        buttons: giu ? 1 : 0,
        clickCount: type === "mouseMoved" ? 0 : 1,
        pointerType: "pen",
        force: giu ? PRESSIONE.da + ((PRESSIONE.a - PRESSIONE.da) * i) / (punti.length - 1) : 0,
      });
    await evento("mouseMoved", punti[0], 0, false);
    await evento("mousePressed", punti[0], 0, true);
    for (let i = 1; i < punti.length; i += 1) {
      await evento("mouseMoved", punti[i], i, true);
      if (aMeta && i === Math.floor(punti.length / 2)) await aMeta();
    }
    await evento("mouseReleased", punti.at(-1), punti.length - 1, false);
  } finally {
    await cdp.detach();
  }
}

/// I campioni di un `fub:ink` (`docs/reference/scene-format-ink.md`): i
/// canali dalla testata, il primo campione assoluto, gli altri differenze.
function campioni(ink) {
  const [versione, , canali, ...resto] = ink.split(" ");
  verifica(versione === "1" && canali?.startsWith("c"), `«${ink.slice(0, 40)}…» non è un fub:ink`);
  const nomi = [...canali.slice(1)];
  const somma = nomi.map(() => 0);
  return resto.map((pezzo) => {
    const valori = pezzo.split(",").map(Number);
    return Object.fromEntries(nomi.map((nome, i) => [nome, (somma[i] += valori[i])]));
  });
}

// ---------------------------------------------------------------------------
// 16 · la lavagna: due schede e un filo.
// ---------------------------------------------------------------------------

const schedeEFilo = {
  id: "schede-e-filo",
  nome: "una lavagna: una scheda scritta, un'altra col Testo, un filo fra le due; il file le ha",
  async fai(pagina, giro) {
    await giro.apri(LAVAGNE);
    await pagina.waitForFunction(() => !document.querySelector(".avvio"), null, { timeout: 30_000 });
    const cartella = `#file-list li[role="treeitem"][data-path="${CARTELLA}"]`;
    if ((await pagina.getAttribute(cartella, "aria-expanded")) !== "true") {
      await pagina.click(`${cartella} > .tree-row.folder`);
      await pagina.waitForSelector(`${cartella}[aria-expanded="true"]`);
    }
    await pagina.click(`#file-list .tree-row[data-path="${LAVAGNA}"]`);
    await pagina.waitForSelector(`.pane.focus .tab[aria-selected="true"] .tab-name:text-is("${NOME}")`);
    const vuota = ".pane.focus .canvas-blank:not([hidden])";
    await pagina.waitForSelector(vuota);
    await giro.foto("vuota");

    // «Scrivi una scheda»: una scheda di testo al centro, già in scrittura.
    await pagina.click(`${vuota} button:text-is("Scrivi una scheda")`);
    await pagina.waitForSelector(".pane.focus .canvas-node .cm-content:focus");
    await pagina.keyboard.type(PRIMA);
    await giro.foto("scrive");
    await esciDallaScheda(pagina);
    await pagina.waitForSelector(".pane.focus .canvas-blank", { state: "hidden" });

    // Un po' di posto: lo zoom al 50% dal menu della banda di stato.
    await pagina.click('#status-band [data-surface-item="zoom"]:text-is("100%")');
    await pagina.click('#context-menu [role="menuitemradio"]:has-text("50%")');
    await pagina.waitForSelector('#status-band [data-surface-item="zoom"]:text-is("50%")');

    // Il Testo mette la seconda scheda dove si fa clic, in basso a sinistra.
    await strumento(pagina, "text");
    const vista = await pagina.locator(".pane.focus .canvas-viewport").boundingBox();
    await pagina.mouse.click(vista.x + vista.width * 0.1, vista.y + vista.height * 0.68);
    await pagina.waitForSelector(".pane.focus .canvas-node .cm-content:focus");
    await pagina.keyboard.type(SECONDA);
    await esciDallaScheda(pagina);
    // E torna alla Selezione da sé.
    await pagina.waitForSelector('.pane.focus .canvas-tool[data-tool="select"][aria-pressed="true"]');
    // Maiusc+1 mostra tutta la lavagna: le due schede, più grandi del 50%.
    await pagina.keyboard.press("Shift+Digit1");
    await pagina.waitForSelector('#status-band [data-surface-item="zoom"]:not(:text-is("50%"))');

    // Collega: dal centro della prima scheda al centro della seconda.
    await strumento(pagina, "connect");
    const da = await riquadro(pagina, PRIMA);
    const a = await riquadro(pagina, SECONDA);
    const x = da.x + da.width / 2;
    const y = da.y + da.height / 2;
    await pagina.mouse.move(x, y);
    await pagina.mouse.down();
    await pagina.mouse.move(x, y + 12, { steps: 3 });
    await pagina.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 12 });
    // Mentre si tira: il filo in bozza e la scheda d'arrivo segnata. Niente
    // foto a metà gesto: `giro.foto` porta il puntatore in un angolo, e il
    // filo andrebbe lì.
    await pagina.waitForSelector(".pane.focus .canvas-edge-draft");
    await pagina.waitForSelector(".pane.focus .canvas-node[data-connect-target]");
    await pagina.mouse.up();
    await pagina.waitForSelector(".pane.focus .canvas-edge-draft", { state: "detached" });
    await salvato(pagina);
    // Si torna alla Selezione col suo tasto, e la lavagna resta a fuoco.
    await pagina.keyboard.press("v");
    await pagina.waitForSelector('.pane.focus .canvas-tool[data-tool="select"][aria-pressed="true"]');
  },
  async controlla(pagina, host) {
    const lavagna = await laLavagna(host);
    const testi = lavagna.nodes.filter((n) => n.type === "text");
    verifica(lavagna.nodes.length === 2 && testi.length === 2, `la lavagna ha ${JSON.stringify(lavagna.nodes.map((n) => n.type))}, non due schede di testo`);
    const prima = testi.find((n) => n.text === PRIMA);
    const seconda = testi.find((n) => n.text === SECONDA);
    verifica(prima && seconda, `nel file le schede dicono ${JSON.stringify(testi.map((n) => n.text))}`);
    verifica(prima.id !== seconda.id, "le due schede hanno lo stesso id");
    verifica(lavagna.edges.length === 1, `nel file i fili sono ${lavagna.edges.length}, non uno`);
    const [filo] = lavagna.edges;
    verifica(filo.fromNode === prima.id && filo.toNode === seconda.id, `il filo va da «${filo.fromNode}» a «${filo.toNode}», non dalla prima scheda alla seconda`);
    // La seconda scheda sta dove si è fatto clic: a sinistra e sotto la prima.
    verifica(seconda.x < prima.x && seconda.y > prima.y + prima.height, "la seconda scheda non è in basso a sinistra, dove si è fatto clic");
    // Sulla lavagna: le due schede e il filo disegnato.
    verifica((await pagina.locator(".pane.focus .canvas-node").count()) === 2, "sulla lavagna non ci sono due schede");
    await pagina.waitForSelector(".pane.focus .canvas-edge-line", { state: "attached" });
    await pagina.waitForSelector(".pane.focus .canvas-blank", { state: "hidden" });
  },
};

// ---------------------------------------------------------------------------
// 17 · la penna, poi la gomma.
// ---------------------------------------------------------------------------

/// Il riquadro della seconda scheda quando la penna ci scrive: la gomma passa
/// sullo stesso punto.
let doveScrive = null;

/// I tratti disegnati dentro una scheda (`ink-paint.ts`, `canvas-ink-card`).
function trattiDisegnati(pagina, testo) {
  return scheda(pagina, testo).locator("svg.canvas-ink-card path").count();
}

const penna = {
  id: "penna",
  nome: "la penna scrive su una scheda, con la pressione; il file ha il tratto",
  async fai(pagina) {
    // Un'onda sulla seconda scheda, sotto il testo.
    await strumento(pagina, "pen");
    const box = await riquadro(pagina, SECONDA);
    doveScrive = box;
    const punti = Array.from({ length: 24 }, (_, i) => [
      box.x + box.width * (0.15 + (0.7 * i) / 23),
      box.y + box.height * 0.7 + Math.sin((i / 23) * Math.PI * 2) * box.height * 0.1,
    ]);
    let etichetta = "";
    await tratto(pagina, punti, async () => {
      // A metà tratto la lavagna dice a che cosa si attaccherà.
      await pagina.waitForSelector(".pane.focus .canvas-ink-label:visible");
      etichetta = (await pagina.textContent(".pane.focus .canvas-ink-label"))?.trim() ?? "";
    });
    verifica(etichetta.includes(SECONDA), `mentre scrive la lavagna dice «${etichetta}», non che il tratto si attacca a «${SECONDA}»`);
    await pagina.waitForSelector(".pane.focus .canvas-ink-label", { state: "hidden" });
    await salvato(pagina);
  },
  async controlla(pagina, host) {
    const lavagna = await laLavagna(host);
    const seconda = lavagna.nodes.find((n) => n.text === SECONDA);
    verifica(seconda, `nel file non c'è più la scheda «${SECONDA}»`);
    const tratti = seconda["fub:ink"]?.strokes ?? [];
    verifica(tratti.length === 1, `la scheda «${SECONDA}» ha ${tratti.length} tratti nel file, non uno`);
    verifica((lavagna["fub:ink"]?.strokes ?? []).length === 0, "il tratto è finito libero sulla lavagna, non sulla scheda");
    const [unico] = tratti;
    verifica(unico.tool === "pen", `il tratto è «${unico.tool}», non della penna`);
    verifica(unico.anchor?.kind === "card", `l'ancora del tratto è ${JSON.stringify(unico.anchor)}, non la scheda`);
    // La pressione della penna, non quella simulata: il canale `p` c'è, il
    // pennello dice `sim=0`, e il tratto calca di più alla fine che all'inizio.
    verifica(/\bsim=0\b/.test(unico.brush), `il pennello dice «${unico.brush}»: la pressione è simulata`);
    const lista = campioni(unico.ink);
    verifica(lista.length >= 2 && "p" in lista[0], `i campioni del tratto non hanno la pressione (${unico.ink.slice(0, 40)}…)`);
    const pressioni = lista.map((c) => c.p);
    const leggera = Math.round(PRESSIONE.da * 255);
    const forte = Math.round(PRESSIONE.a * 255);
    verifica(Math.min(...pressioni) <= leggera + 8 && Math.max(...pressioni) >= forte - 8, `la pressione nel file va da ${Math.min(...pressioni)} a ${Math.max(...pressioni)}, non da ${leggera} a ${forte}`);
    // Sulla lavagna il tratto è asciutto, dentro la scheda.
    verifica((await trattiDisegnati(pagina, SECONDA)) === 1, `nella scheda «${SECONDA}» non si vede un tratto`);
  },
};

const gomma = {
  id: "gomma",
  nome: "la gomma toglie il tratto: il file non ce l'ha più, schede e filo restano",
  async fai(pagina) {
    verifica(doveScrive !== null, "la gomma non sa dove la penna ha scritto: il compito «penna» non è girato");
    await strumento(pagina, "eraser");
    // Una passata in verticale attraverso l'onda, con la stessa penna.
    const box = doveScrive;
    const x = box.x + box.width * 0.5;
    const passata = Array.from({ length: 16 }, (_, i) => [x, box.y + box.height * (0.45 + (0.5 * i) / 15)]);
    await tratto(pagina, passata);
    await salvato(pagina);
    // Si torna alla Selezione: la foto è la lavagna com'è.
    await pagina.keyboard.press("v");
    await pagina.waitForSelector('.pane.focus .canvas-tool[data-tool="select"][aria-pressed="true"]');
  },
  async controlla(pagina, host) {
    const lavagna = await laLavagna(host);
    const seconda = lavagna.nodes.find((n) => n.text === SECONDA);
    verifica(seconda, `nel file non c'è più la scheda «${SECONDA}»`);
    const tratti = seconda["fub:ink"]?.strokes ?? [];
    verifica(tratti.length === 0, `dopo la gomma la scheda tiene ancora ${tratti.length} tratti nel file`);
    verifica((lavagna["fub:ink"]?.strokes ?? []).length === 0, "dopo la gomma la lavagna ha tratti liberi");
    // La gomma toglie l'inchiostro, non altro.
    verifica(lavagna.nodes.length === 2 && lavagna.edges.length === 1, "la gomma ha tolto una scheda o il filo");
    verifica(lavagna.nodes.some((n) => n.text === PRIMA), `la gomma ha cambiato la scheda «${PRIMA}»`);
    verifica((await trattiDisegnati(pagina, SECONDA)) === 0, `nella scheda «${SECONDA}» si vede ancora il tratto`);
  },
};

export const lavagna = {
  id: "lavagna",
  nome: "la lavagna e la penna",
  // Il primo compito carica la pagina da sé, con la query delle lavagne.
  prepara: async () => {},
  compiti: [schedeEFilo, penna, gomma],
};
