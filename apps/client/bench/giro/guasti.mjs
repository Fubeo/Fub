// **Il giro, gruppo «guasti»** (compiti 21–27): quando qualcosa va storto, i
// casi in cui una persona può perdere testo, provati come li vede. Il
// conflitto con un'altra applicazione e ogni azione della sua barra, il file
// in sola lettura, il cestino, i compiti 3–9 rifatti con la sola tastiera,
// la chiusura con testo non salvato (anche col conflitto che arriva mentre
// la finestra chiede), il ripristino di una versione sotto testo non salvato,
// il salvataggio che fallisce e riprova.
//
// La forma di un compito e ciò che `giro` e `host` portano sono in
// `bench/giro.mjs`. I compiti dipendono l'uno dall'altro: tutti scrivono
// nella nota che il primo apre; il primo dei compiti di tastiera ricarica la
// pagina, e da lì il vault riparte com'è nel banco.
//
// **Mai perdere testo.** Dove un guasto può far perdere dati, `controlla`
// legge il Markdown nel finto host, non soltanto la pagina: che il testo
// della persona sia ancora nel riquadro e, quando la porta torna buona, sul
// disco.
//
// I guasti si fanno dal confine, con ciò che il finto host ha già:
//
// - `window.bench.fault(porta, motivo)` fa rispondere «no» a una porta finché
//   non si chiama ciò che torna (lo tiene `window.__giroGuasti`); un
//   `PluginError` al posto della frase è l'errore tipato dell'host vero, come
//   `permission_denied` per il file in sola lettura;
// - `window.bench.writeFromOutside(id, testo)` è la **scrittura da fuori**
//   (l'altra applicazione, il sync): i byte cambiano nel finto e l'evento
//   arriva dal watcher. Non `emit`: un evento emesso da lì ha l'origine di
//   una scrittura della shell, e siccome il finto non manda l'eco dei
//   salvataggi della shell, dopo il primo salvataggio la shell lo
//   prenderebbe per quell'eco e non direbbe niente.
//
// Il ripristino di una versione. Il pannello «Cronologia» del banco è
// scenografia (`bench/fake-ipc.ts`): le sue azioni non arrivano a
// `version.restore`. Ciò che la shell vede di un ripristino vero è il file
// riscritto dall'host sotto al buffer (`versioning/view.rs`, PA T4): il
// compito lo fa con la scrittura da fuori, quindi con l'origine del watcher.
// Il ripristino vero arriva con l'origine di un comando, e il foglio dice
// «è cambiato su disco» invece di «è stato cambiato da un'altra
// applicazione»: la frase cambia, la regola (il testo resta, la scelta al
// salvataggio) è la stessa.
//
// I comandi di formato (`?formatbar=1&slash=1`) servono ai compiti di
// tastiera 6 e 7: il gruppo apre la pagina con le due query, come «scrivere».
import { chooseMode } from "../scene.mjs";

/// La query che dà alla finestra i comandi di formato dell'host vero.
const FORMATO = "formatbar=1&slash=1";
/// La nota in cui il gruppo scrive, dal vault del banco (`corpus.ts`).
const CARTELLA = "Progetti";
const NOTA = "Progetti/Il banco che vede.md";
const NOME = "Il banco che vede";
/// La nota che il terzo compito cestina e rimette.
const CESTINATA = "Diario/2026-08-18.md";
const NOME_CESTINATA = "2026-08-18";
/// La nota che l'ultimo compito di tastiera apre a destra.
const ACCANTO = "Benvenuto.md";
const NOME_ACCANTO = "Benvenuto";

/// Ciò che i compiti di tastiera scrivono, e come deve tornare nel Markdown.
const TITOLO = "Titolo da tastiera";
const VOCI = ["prima voce", "seconda voce"];
const GRASSETTO = "grassetto";
const PAROLA = "trentuno";
const PARAGRAFO = "La voce [[31.1]] della seduta";
const ETICHETTA = "#seduta-31";
const TABELLA = ["| Colonna 1 | Colonna 2 | Colonna 3 |", "| --- | --- | --- |", "|  |  |  |", "|  |  |  |"].join("\n");
const COMANDO = "Comprimi tutte le cartelle";

/// Le frasi del gruppo: parole semplici, che la Live mostra come sono.
const MIA = "Una frase mia scritta qui.";
const FUORI = "Una riga scritta da un'altra applicazione.";
const MIA_ANCORA = "Una seconda frase mia.";
const FUORI_ANCORA = "Un'altra riga arrivata da fuori.";
const SOLA_LETTURA = "Testo su un file in sola lettura.";
const NON_SALVATO = "Testo che non si salva.";
const DURANTE = "Testo della finestra di chiusura.";
const FUORI_DURANTE = "Riga da fuori mentre la finestra chiede.";
const PRIMA_DEL_RIPRISTINO = "Testo scritto prima del ripristino.";
const NEL_GUASTO = "Testo scritto durante il guasto.";

/// Quanto aspetta, al più, che il fuoco appena spostato si veda.
const ATTESA_FUOCO_MS = 2_000;
/// Quanto si aspetta al più che una finestra si chiuda da sé: largo, perché
/// la macchina può essere carica; la condizione arriva di solito in un attimo.
const ATTESA_CHIUSURA_MS = 10_000;

/// Il testo della nota com'era quando il gruppo l'ha aperta per i compiti di
/// tastiera: è la «versione vecchia» che il ripristino rimette.
let versioneVecchia = null;

function verifica(condizione, messaggio) {
  if (!condizione) throw new Error(messaggio);
}

// ---------------------------------------------------------------------------
// I gesti e gli sguardi che i compiti si dividono.
// ---------------------------------------------------------------------------

/// Lo stato del salvataggio che la cornice mostra.
function statoSalvataggio(pagina) {
  return pagina.evaluate(() => document.querySelector("#save-state")?.dataset.state ?? null);
}

/// Aspetta che il salvataggio arrivi a uno stato: `salvato`, `fallito`,
/// `conflitto`. Il salvataggio parte 400 ms dopo l'ultimo gesto.
async function aspettaStato(pagina, stato) {
  await pagina.waitForFunction((voluto) => document.querySelector("#save-state")?.dataset.state === voluto, stato, {
    timeout: 10_000,
  });
}

/// Il testo di un documento com'è adesso nel finto host, o `null` se non c'è.
function leggi(pagina, id) {
  return pagina.evaluate(async (doc) => {
    const { api } = await import("/bench/fake-ipc.ts");
    try {
      return (await api.readDocument(doc)).text;
    } catch {
      return null;
    }
  }, id);
}

/// **Una scrittura da fuori**: i byte cambiano nel finto e l'evento del
/// watcher arriva, nell'ordine in cui succede davvero (vedi la testa del file).
async function scriviDaFuori(pagina, id, testo) {
  await pagina.evaluate(([doc, nuovo]) => window.bench.writeFromOutside(doc, nuovo), [id, testo]);
}

/// Il conflitto sulla nota a schermo si dice una volta, nella barra: né la
/// riga «cambiata da fuori» del foglio né un avviso a galla lo ripetono.
async function unSoloMessaggio(pagina, passo) {
  const righe = await pagina.locator('.pane.focus .sheet-notice[data-notice="overwritten"], .pane.focus .sheet-notice[data-notice="changed_on_disk"]').count();
  verifica(righe === 0, `${passo}: la barra del conflitto e la riga del foglio dicono la stessa cosa`);
  const avvisi = await pagina.locator(`.toast .toast-text:has-text("${NOME}")`).allInnerTexts();
  verifica(avvisi.length === 0, `${passo}: con la nota a schermo restano gli avvisi ${avvisi.map((testo) => `«${testo}»`).join(", ")}`);
}

/// Nessun avviso a galla parla ancora della nota: lo stato di cui dicevano
/// è finito.
async function nessunAvvisoDellaNota(pagina, passo) {
  const avvisi = await pagina.locator(`.toast .toast-text:has-text("${NOME}")`).allInnerTexts();
  verifica(avvisi.length === 0, `${passo}: restano gli avvisi ${avvisi.map((testo) => `«${testo}»`).join(", ")}`);
}

/// Guasta una porta del finto; `ripara` la rimette.
async function guasta(pagina, porta, motivo) {
  await pagina.evaluate(
    ([gate, reason]) => {
      window.__giroGuasti ??= {};
      window.__giroGuasti[gate]?.();
      window.__giroGuasti[gate] = window.bench.fault(gate, reason);
    },
    [porta, motivo],
  );
}

async function ripara(pagina, porta) {
  await pagina.evaluate((gate) => {
    window.__giroGuasti?.[gate]?.();
    if (window.__giroGuasti) delete window.__giroGuasti[gate];
  }, porta);
}

/// Il testo che il riquadro a fuoco mostra.
function testoDelRiquadro(pagina) {
  return pagina.evaluate(() => document.querySelector(".pane.focus .cm-content")?.innerText ?? "");
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

/// Apre una cartella dell'albero, se è chiusa.
async function apriCartella(pagina, cartella) {
  const voce = `#file-list li[role="treeitem"][data-path="${cartella}"]`;
  if ((await pagina.getAttribute(voce, "aria-expanded")) !== "true") {
    await pagina.click(`${voce} > .tree-row.folder`);
    await pagina.waitForSelector(`${voce}[aria-expanded="true"]`);
  }
}

/// Apre la nota del gruppo dall'albero, nella Live.
async function apriLaNota(pagina) {
  await apriCartella(pagina, CARTELLA);
  await pagina.click(`#file-list .tree-row.note[data-path="${NOTA}"]`);
  await pagina.waitForSelector(aFuoco(NOME));
  await pagina.waitForSelector('.pane.focus .cm-content:has-text("La voce")');
  await chooseMode(pagina, "live_preview");
}

/// Scrive in fondo alla nota del riquadro a fuoco, su una riga nuova.
async function scriviInFondo(pagina, testo) {
  await pagina.locator(".pane.focus .cm-content").click();
  await pagina.keyboard.press("Control+End");
  await pagina.keyboard.press("Enter");
  await pagina.keyboard.type(testo);
}

/// Un avviso passeggero con questa frase.
async function avviso(pagina, frase) {
  await pagina.waitForSelector(`.toast .toast-text:has-text("${frase}")`);
}

/// L'avviso dentro il foglio, se c'è: la riga col suo pulsante.
function rigaDelFoglio(pagina, tipo) {
  return pagina.locator(`.pane.focus .sheet-notice[data-notice="${tipo}"]`);
}

/// La finestra di conferma aperta, con il suo titolo.
async function conferma(pagina, titolo) {
  await pagina.waitForSelector(`.kit-dialog .kit-dialog-title:text-is("${titolo}")`);
  return pagina.locator(".kit-dialog");
}

/// La barra del conflitto del riquadro a fuoco, aperta, con le sue quattro
/// azioni nell'ordine in cui si leggono.
async function barraDelConflitto(pagina) {
  await aspettaStato(pagina, "conflitto");
  const barra = pagina.locator('.pane.focus .conflict-banner[role="alert"]');
  await barra.waitFor();
  const titolo = (await barra.locator("strong").textContent())?.trim() ?? "";
  verifica(titolo === `Conflitto su ${NOME}`, `la barra del conflitto dice «${titolo}»`);
  const azioni = (await barra.locator(".conflict-actions button").allTextContents()).map((a) => a.trim());
  const attese = ["Confronta", "Mantieni il mio testo", "Usa la versione su disco", "Decidi dopo"];
  verifica(JSON.stringify(azioni) === JSON.stringify(attese), `la barra offre ${JSON.stringify(azioni)}`);
  return barra;
}

// ---------------------------------------------------------------------------
// La tastiera: il fuoco e il suo anello.
// ---------------------------------------------------------------------------

/// Che cosa ha la tastiera, e se lo si vede.
///
/// Un controllo (una voce dell'albero, del menu, della palette, un pulsante)
/// è a fuoco visibile se ha `:focus-visible` e un anello disegnato: un
/// contorno o un'ombra, su di sé o sulla sua riga (le voci dell'albero lo
/// disegnano sulla `.tree-row` che contengono). Il testo di una nota non ha
/// un anello: il suo segno è il cursore che lampeggia, che il palco del
/// banco nasconde perché le foto non ballino (`stage.mjs`); lì conta che il
/// fuoco sia nell'editor del riquadro che si dice a fuoco.
///
/// Un contorno conta solo se ne resta un pezzo a schermo: uno che sborda da
/// un elemento grande quanto il contenitore, che taglia ciò che esce
/// (`overflow` non visibile), ha lo stile giusto ma non si vede.
function fuoco(pagina) {
  return pagina.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { ok: false, dove: "nessuno: il fuoco è sul corpo della pagina" };
    const contornoAschermo = (nodo, stile) => {
      const r = nodo.getBoundingClientRect();
      const dentro = parseFloat(stile.outlineOffset) || 0;
      const fuori = dentro + parseFloat(stile.outlineWidth);
      const allarga = (d) => ({ l: r.left - d, t: r.top - d, r: r.right + d, b: r.bottom + d });
      const interno = allarga(dentro);
      const esterno = allarga(fuori);
      // Ciò che resta a schermo: la finestra, ristretta da ogni antenato che
      // taglia ciò che esce.
      const taglio = { l: 0, t: 0, r: innerWidth, b: innerHeight };
      for (let su = nodo.parentElement; su; su = su.parentElement) {
        const s = getComputedStyle(su);
        if (s.overflowX === "visible" && s.overflowY === "visible") continue;
        const a = su.getBoundingClientRect();
        taglio.l = Math.max(taglio.l, a.left);
        taglio.t = Math.max(taglio.t, a.top);
        taglio.r = Math.min(taglio.r, a.right);
        taglio.b = Math.min(taglio.b, a.bottom);
      }
      const v = {
        l: Math.max(taglio.l, esterno.l),
        t: Math.max(taglio.t, esterno.t),
        r: Math.min(taglio.r, esterno.r),
        b: Math.min(taglio.b, esterno.b),
      };
      if (v.r <= v.l || v.b <= v.t) return false;
      // La banda del contorno sta fra il bordo interno e quello esterno: si
      // vede se ciò che resta a schermo va oltre il bordo interno da un lato.
      return v.l < interno.l - 0.5 || v.t < interno.t - 0.5 || v.r > interno.r + 0.5 || v.b > interno.b + 0.5;
    };
    const anello = (nodo) => {
      if (!nodo) return false;
      const stile = getComputedStyle(nodo);
      if (stile.boxShadow !== "none") return true;
      return stile.outlineStyle !== "none" && parseFloat(stile.outlineWidth) > 0 && contornoAschermo(nodo, stile);
    };
    const nome = `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}` +
      `${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} «${(el.textContent ?? "").trim().slice(0, 40)}»`;
    if (el.closest(".cm-content")) {
      const ok = el.closest(".pane.focus") !== null && el.closest(".cm-editor")?.classList.contains("cm-focused") === true;
      return { ok, testo: true, dove: ok ? "il testo della nota a fuoco" : `il testo di un riquadro non a fuoco (${nome})` };
    }
    const visibile = el.matches(":focus-visible");
    const disegnato = anello(el) || anello(el.querySelector(":scope > .tree-row"));
    return { ok: visibile && disegnato, testo: false, dove: `${nome}${visibile ? "" : ", senza :focus-visible"}${disegnato ? "" : ", senza anello"}` };
  });
}

/// Il fuoco è visibile: lo dice il nome del passo se non lo è. Il fuoco che
/// si sposta può metterci un fotogramma a disegnarsi (CodeMirror segna
/// `cm-focused` dopo l'evento): si aspetta al più `ATTESA_FUOCO_MS`.
async function anello(pagina, passo) {
  const fine = Date.now() + ATTESA_FUOCO_MS;
  let stato = await fuoco(pagina);
  while (!stato.ok && Date.now() < fine) {
    await pagina.waitForTimeout(50);
    stato = await fuoco(pagina);
  }
  verifica(stato.ok, `${passo}: il fuoco non si vede (${stato.dove})`);
  return stato;
}

/// Un tasto, e il fuoco dopo il tasto si vede.
async function tasto(pagina, chiave, passo) {
  await pagina.keyboard.press(chiave);
  return anello(pagina, passo ?? chiave);
}

/// L'elemento che ha la tastiera ha questo `data-path` (una voce dell'albero).
function percorsoAFuoco(pagina) {
  return pagina.evaluate(() => document.activeElement?.getAttribute("data-path") ?? null);
}

/// Scende nell'albero con le frecce finché la voce a fuoco è `percorso`.
async function scendiFinoA(pagina, percorso) {
  for (let passi = 0; passi < 40; passi += 1) {
    if ((await percorsoAFuoco(pagina)) === percorso) return;
    await tasto(pagina, "ArrowDown", `nell'albero verso «${percorso}»`);
  }
  throw new Error(`con le frecce l'albero non arriva a «${percorso}» (a fuoco: ${await percorsoAFuoco(pagina)})`);
}

/// Un comando dalla palette, con la tastiera: Ctrl+Maiusc+P, il nome, Invio.
async function dallaPalette(pagina, cerca, comando) {
  await pagina.keyboard.press("Control+Shift+P");
  await pagina.waitForSelector(".launcher-input:focus");
  await anello(pagina, "la palette");
  await pagina.keyboard.type(cerca);
  await pagina.waitForSelector(`.launcher-row:has-text("${comando}")`);
  const primo = (await pagina.textContent(".launcher-row .launcher-row-title"))?.trim() ?? "";
  verifica(primo === comando, `la palette mette prima «${primo}», non «${comando}»`);
  await pagina.keyboard.press("Enter");
  await pagina.waitForSelector(".launcher-layer", { state: "detached" });
}

/// Cerca una parola nella nota (Ctrl+F) e la lascia selezionata.
async function selezionaConLaRicerca(pagina, parola) {
  await pagina.keyboard.press("Control+f");
  await pagina.waitForSelector(".pane.focus .cm-textfield:focus");
  await anello(pagina, "il campo della ricerca nella nota");
  await pagina.keyboard.type(parola);
  await pagina.keyboard.press("Enter");
  await pagina.keyboard.press("Escape");
  await pagina.waitForSelector(".pane.focus .cm-search", { state: "detached" });
  const scelta = await pagina.evaluate(() => getSelection()?.toString() ?? "");
  verifica(scelta === parola, `la ricerca lascia scelto «${scelta}», non «${parola}»`);
  await anello(pagina, "tornando al testo dalla ricerca");
}

// ---------------------------------------------------------------------------
// 21 · il conflitto.
// ---------------------------------------------------------------------------

/// Il testo che il primo conflitto lascia sul disco: quello di prima, con la
/// riga dell'altra applicazione.
let dopoIlPrimoConflitto = null;

const conflittoUsaDisco = {
  id: "conflitto-usa-disco",
  nome: "il conflitto: la barra c'è; Confronta, Decidi dopo e Usa la versione su disco fanno ciò che dicono",
  async fai(pagina, giro) {
    await giro.apri(FORMATO);
    await pagina.waitForFunction(() => !document.querySelector(".avvio"), null, { timeout: 30_000 });
    await apriLaNota(pagina);
    const prima = await leggi(pagina, NOTA);
    dopoIlPrimoConflitto = `${prima.replace(/\n*$/, "\n")}\n${FUORI}\n`;
    // Testo non salvato, poi l'altra applicazione cambia la stessa nota prima
    // che il salvataggio (400 ms dopo l'ultimo tasto) parta.
    await scriviInFondo(pagina, MIA);
    await scriviDaFuori(pagina, NOTA, dopoIlPrimoConflitto);
    const barra = await barraDelConflitto(pagina);
    verifica((await leggi(pagina, NOTA)) === dopoIlPrimoConflitto, "il salvataggio in conflitto ha scritto sul disco");
    await unSoloMessaggio(pagina, "il primo conflitto");
    await giro.foto("barra");

    // «Confronta»: il testo su disco e il mio, riga per riga.
    await barra.locator('button:text-is("Confronta")').click();
    const confronto = pagina.locator(".modale.shell-dialog");
    await confronto.waitFor();
    const righe = await confronto.innerText();
    verifica(righe.includes(`${NOME}: il tuo testo e quello su disco`), "il confronto non dice che cosa confronta");
    verifica(righe.includes(`− ${FUORI}`), "il confronto non segna con − la riga che c'è solo su disco");
    verifica(righe.split("\n").some((riga) => riga.startsWith("+ ") && riga.includes(MIA)), "il confronto non segna con + la frase che c'è solo nel mio testo");
    await giro.foto("confronta");
    await confronto.locator('button:text-is("Chiudi")').click();
    await confronto.waitFor({ state: "detached" });

    // «Decidi dopo»: la barra si riduce a una riga, e niente si scrive.
    await barra.locator('button:text-is("Decidi dopo")').click();
    const ridotta = pagina.locator(".pane.focus .conflict-banner[data-collapsed]");
    await ridotta.waitFor();
    const riga = (await ridotta.innerText()).trim();
    verifica(riga.includes(`Conflitto su ${NOME}: la scelta aspetta, niente è stato scritto.`), `ridotta, la barra dice «${riga}»`);
    verifica((await leggi(pagina, NOTA)) === dopoIlPrimoConflitto, "«Decidi dopo» ha scritto sul disco");
    verifica((await testoDelRiquadro(pagina)).includes(MIA), "«Decidi dopo» ha tolto il mio testo dal riquadro");
    await giro.foto("decidi-dopo");
    await ridotta.locator('button:text-is("Scegli ora")').click();
    await barraDelConflitto(pagina);

    // «Usa la versione su disco» chiede prima: «Annulla» non tocca niente.
    await barra.locator('button:text-is("Usa la versione su disco")').click();
    let finestra = await conferma(pagina, `Conflitto su ${NOTA}`);
    await finestra.locator('button[data-action="cancel"]:text-is("Annulla")').click();
    await finestra.waitFor({ state: "detached" });
    verifica((await statoSalvataggio(pagina)) === "conflitto", "«Annulla» ha chiuso il conflitto");
    verifica((await testoDelRiquadro(pagina)).includes(MIA), "«Annulla» ha tolto il mio testo dal riquadro");
    verifica((await leggi(pagina, NOTA)) === dopoIlPrimoConflitto, "«Annulla» ha scritto sul disco");
    await barra.locator('button:text-is("Usa la versione su disco")').click();
    finestra = await conferma(pagina, `Conflitto su ${NOTA}`);
    await giro.foto("usa-disco-chiede");
    await finestra.locator('button[data-action="confirm"]').click();
    await finestra.waitFor({ state: "detached" });
    await pagina.waitForSelector(".pane.focus .conflict-banner", { state: "hidden" });
  },
  async controlla(pagina, host) {
    verifica((await host.testo(NOTA)) === dopoIlPrimoConflitto, "«Usa la versione su disco» ha cambiato il disco");
    const riquadro = await testoDelRiquadro(pagina);
    verifica(riquadro.includes(FUORI), "dopo «Usa la versione su disco» il riquadro non mostra la riga del disco");
    verifica(!riquadro.includes(MIA), "dopo «Usa la versione su disco» il riquadro tiene ancora il mio testo");
    verifica((await statoSalvataggio(pagina)) === "salvato", `dopo «Usa la versione su disco» il salvataggio è «${await statoSalvataggio(pagina)}»`);
    verifica(!(await pagina.isVisible(".pane.focus .tab.dirty")), "la linguetta si dice ancora non salvata");
  },
};

const conflittoTieniMio = {
  id: "conflitto-tieni-mio",
  nome: "il conflitto: Mantieni il mio testo scrive il mio testo sul disco",
  async fai(pagina, giro) {
    await scriviInFondo(pagina, MIA_ANCORA);
    const disco = await leggi(pagina, NOTA);
    await scriviDaFuori(pagina, NOTA, `${disco}\n${FUORI_ANCORA}\n`);
    const barra = await barraDelConflitto(pagina);
    await barra.locator('button:text-is("Mantieni il mio testo")').click();
    const finestra = await conferma(pagina, `Conflitto su ${NOTA}`);
    await giro.foto("chiede");
    await finestra.locator('button[data-action="confirm"]').click();
    await finestra.waitFor({ state: "detached" });
    await aspettaStato(pagina, "salvato");
  },
  async controlla(pagina, host) {
    const testo = await host.testo(NOTA);
    verifica(testo.includes(MIA_ANCORA), "«Mantieni il mio testo» non ha scritto la mia frase sul disco");
    verifica(testo.includes(FUORI), "«Mantieni il mio testo» ha perso la riga che il mio testo aveva già");
    verifica(!testo.includes(FUORI_ANCORA), "«Mantieni il mio testo» ha tenuto la riga dell'altra applicazione");
    verifica(testo.startsWith(`# ${NOME}\n`), "il titolo non è più in testa alla nota");
    verifica(await pagina.isHidden(".pane.focus .conflict-banner"), "la barra del conflitto è rimasta");
    verifica((await testoDelRiquadro(pagina)).includes(MIA_ANCORA), "il riquadro ha perso la mia frase");
  },
};

// ---------------------------------------------------------------------------
// 22 · la sola lettura.
// ---------------------------------------------------------------------------

const solaLettura = {
  id: "sola-lettura",
  nome: "un file in sola lettura non si scrive, e la shell lo dice; il testo resta",
  async fai(pagina, giro) {
    await guasta(pagina, "writeDocument", { kind: "permission_denied", message: `il file è in sola lettura: ${NOTA}` });
    await scriviInFondo(pagina, SOLA_LETTURA);
    await aspettaStato(pagina, "fallito");
    await avviso(pagina, `«${NOME}» è in sola lettura: Fub non lo sovrascrive`);
    await rigaDelFoglio(pagina, "save_failed").waitFor();
    verifica(!(await leggi(pagina, NOTA)).includes(SOLA_LETTURA), "il file in sola lettura è stato scritto");
    verifica((await testoDelRiquadro(pagina)).includes(SOLA_LETTURA), "il riquadro ha perso il testo non salvato");
    await giro.foto("sola-lettura");
    // Il file torna scrivibile: «Riprova» nel foglio salva ciò che era
    // rimasto. Il salvataggio automatico ci riprova anche da solo a ogni
    // pausa (PA T59): su una macchina lenta può arrivare prima del clic, e la
    // riga se ne va da sé. Conta che il testo arrivi sul disco (`controlla`).
    await ripara(pagina, "writeDocument");
    const riprova = rigaDelFoglio(pagina, "save_failed").locator('button:text-is("Riprova")');
    await riprova.click({ timeout: ATTESA_CHIUSURA_MS }).catch(async (errore) => {
      if ((await riprova.count()) > 0) throw errore;
    });
    await aspettaStato(pagina, "salvato");
  },
  async controlla(pagina, host) {
    verifica((await host.testo(NOTA)).includes(SOLA_LETTURA), "riparato il file, «Riprova» non ha salvato il testo rimasto");
    verifica((await rigaDelFoglio(pagina, "save_failed").count()) === 0, "l'avviso del foglio è rimasto dopo il salvataggio");
    // L'avviso dice sola lettura, non un guasto del disco.
    const guasto = await pagina.locator('.toast .toast-text:has-text("non è stato salvato")').count();
    verifica(guasto === 0, "la shell ha detto un guasto del disco invece della sola lettura");
    // Salvata, l'avviso della sola lettura se ne va: parlava di uno stato finito.
    await nessunAvvisoDellaNota(pagina, "salvata dopo la sola lettura");
  },
};

// ---------------------------------------------------------------------------
// 23 · il cestino.
// ---------------------------------------------------------------------------

let primaDelCestino = null;

const cestino = {
  id: "cestino",
  nome: "il cestino: una nota cancellata si ritrova nel cestino e si rimette",
  async fai(pagina, giro) {
    primaDelCestino = await leggi(pagina, CESTINATA);
    verifica(primaDelCestino !== null, `nel vault del banco manca «${CESTINATA}»`);
    await apriCartella(pagina, "Diario");
    await pagina.click(`#file-list li[data-path="${CESTINATA}"] > .tree-row`, { button: "right" });
    await pagina.click('#context-menu [role^="menuitem"]:has-text("Sposta nel cestino")');
    await avviso(pagina, `«${NOME_CESTINATA}» è nel cestino.`);
    await pagina.waitForSelector(`#file-list li[data-path="${CESTINATA}"]`, { state: "detached" });
    verifica((await leggi(pagina, CESTINATA)) === null, "cestinata, la nota è ancora nel vault");

    await pagina.click('#views-ribbon .rail-btn[data-panel="trash"]');
    const voce = pagina.locator("#view-panel-trash [role=listitem]").filter({ hasText: NOME_CESTINATA });
    await voce.waitFor();
    await giro.foto("nel-cestino");
    await voce.locator('button:text-is("Ripristina")').click();
    await pagina.waitForSelector("#view-panel-trash .ui-empty-state");
  },
  async controlla(pagina, host) {
    verifica((await host.testo(CESTINATA)) === primaDelCestino, "la nota rimessa non ha il testo di prima");
    verifica((await pagina.locator("#view-panel-trash [role=listitem]").count()) === 0, "la nota rimessa è ancora nel cestino");
    // Rimessa, la nota si apre dove è tornata davvero (come il provider:
    // `Navigate` verso il nome che il ripristino ha usato).
    await pagina.waitForSelector(aFuoco(NOME_CESTINATA));
    const chiave = await pagina.getAttribute('.pane.focus .tab[aria-selected="true"]', "data-key");
    verifica((chiave ?? "").includes(JSON.stringify(CESTINATA)), `rimessa, si è aperta ${chiave} e non la nota tornata in ${CESTINATA}`);
    // E l'albero la mostra di nuovo, dove stava.
    await pagina.click('#views-ribbon .rail-btn[data-panel="files"]');
    await pagina.waitForSelector(`#file-list li[data-path="${CESTINATA}"]`, { state: "attached" });
  },
};

// ---------------------------------------------------------------------------
// 24 · la tastiera: i compiti 3–9 senza puntatore.
// ---------------------------------------------------------------------------

const tastieraAlbero = {
  id: "tastiera-albero",
  nome: "tastiera (3): l'albero, una cartella e una nota, col fuoco visibile",
  async fai(pagina, giro) {
    // Da qui la tastiera sola: la pagina riparte col vault del banco, e il
    // fuoco nella nota che il banco apre per prima.
    await giro.apri(FORMATO);
    await pagina.waitForFunction(() => !document.querySelector(".avvio"), null, { timeout: 30_000 });
    await pagina.waitForSelector('.pane.focus .tab[aria-selected="true"]');
    versioneVecchia = await leggi(pagina, NOTA);
    // Ctrl+Maiusc+E porta il fuoco nell'albero.
    await tasto(pagina, "Control+Shift+E", "Ctrl+Maiusc+E");
    verifica((await pagina.evaluate(() => document.activeElement?.getAttribute("role"))) === "treeitem", "Ctrl+Maiusc+E non porta il fuoco nell'albero");
    await scendiFinoA(pagina, CARTELLA);
    await tasto(pagina, "ArrowRight", "aprendo la cartella con →");
    await pagina.waitForSelector(`#file-list li[data-path="${CARTELLA}"][aria-expanded="true"]`);
    await scendiFinoA(pagina, NOTA);
    await giro.foto("albero");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(aFuoco(NOME));
    await pagina.waitForSelector('.pane.focus .cm-content:has-text("La voce")');
  },
  async controlla(pagina, host) {
    const aperte = (await host.chiamate("openDocument")).map((args) => args[0]);
    verifica(aperte.includes(NOTA), `il finto host non ha aperto «${NOTA}»`);
    // Invio apre la nota e porta lì la tastiera, per scriverci.
    const stato = await anello(pagina, "aperta la nota con Invio");
    verifica(stato.testo, `aperta la nota con Invio, la tastiera è su ${stato.dove}`);
  },
};

const tastieraScrivere = {
  id: "tastiera-scrivere",
  nome: "tastiera (4): scrivere in Live un titolo, una lista e un grassetto",
  async fai(pagina) {
    if (!(await pagina.isVisible('.pane.focus[data-mode="live_preview"]'))) await dallaPalette(pagina, "passa a live", "Passa a Live");
    const tasti = pagina.keyboard;
    await tasti.press("Control+End");
    await tasti.press("Enter");
    await tasti.press("Enter");
    await tasti.type(`## ${TITOLO}`);
    await tasti.press("Enter");
    await tasti.press("Enter");
    await tasti.type(`- ${VOCI[0]}`);
    await tasti.press("Enter");
    await tasti.type(VOCI[1]);
    await tasti.press("Enter");
    await tasti.press("Enter");
    await tasti.press("Enter");
    await tasti.type("Una parola in ");
    await tasti.press("Control+b");
    await tasti.type(GRASSETTO);
    await tasti.press("Control+b");
    await tasti.type(".");
    await aspettaStato(pagina, "salvato");
  },
  async controlla(pagina, host) {
    const testo = await host.testo(NOTA);
    verifica(new RegExp(`^## ${TITOLO}$`, "m").test(testo), `nel Markdown manca il titolo «## ${TITOLO}»`);
    verifica(testo.includes(`\n- ${VOCI[0]}\n- ${VOCI[1]}\n`), "nel Markdown manca la lista");
    verifica(testo.includes(`- ${VOCI[1]}\n\nUna parola in **${GRASSETTO}**.`), "nel Markdown manca il paragrafo col grassetto");
    await anello(pagina, "dopo aver scritto");
  },
};

const MODALITA = [
  ["blocks", "Blocchi"],
  ["source", "Sorgente"],
  ["reading", "Lettura"],
  ["live_preview", "Live"],
];

const tastieraModalita = {
  id: "tastiera-modalita",
  nome: "tastiera (5): le quattro modalità, con le scorciatoie e la palette",
  async fai(pagina, giro) {
    for (const [modo, etichetta] of MODALITA) {
      if (modo === "blocks") await pagina.keyboard.press("Control+Shift+B");
      else if (modo === "reading") await pagina.keyboard.press("Control+e");
      else await dallaPalette(pagina, `passa a ${etichetta.toLowerCase()}`, `Passa a ${etichetta}`);
      await pagina.waitForSelector(`.pane.focus[data-mode="${modo}"]`);
      await pagina.waitForFunction(
        (titolo) => document.querySelector(".pane.focus")?.innerText.includes(titolo) ?? false,
        TITOLO,
      );
      const testo = await pagina.evaluate(() => document.querySelector(".pane.focus")?.innerText ?? "");
      const segni = testo.includes(`**${GRASSETTO}**`);
      verifica(segni === (modo === "source"), `in ${etichetta} i segni del grassetto ${segni ? "si vedono" : "non si vedono"}`);
      await anello(pagina, `passati a ${etichetta}`);
      if (modo !== "live_preview") await giro.foto(etichetta);
    }
  },
  async controlla(pagina, host) {
    verifica(await pagina.isVisible('.pane.focus[data-mode="live_preview"]'), "il giro non è tornato alla Live");
    verifica((await host.testo(NOTA)).includes(`Una parola in **${GRASSETTO}**.`), "cambiare modalità ha cambiato il Markdown");
  },
};

const tastieraTabella = {
  id: "tastiera-tabella",
  nome: "tastiera (6): «/» mette una tabella; Ctrl+Maiusc+↑ sposta un blocco",
  async fai(pagina, giro) {
    await pagina.keyboard.press("Control+End");
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.press("Enter");
    await pagina.keyboard.type("/tabella");
    await pagina.waitForSelector('.slash-panel .slash-row[aria-selected="true"]:has-text("Tabella")');
    await giro.foto("menu");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel.is-step .slash-step.is-table");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(".slash-panel", { state: "detached" });
    await pagina.waitForSelector(".pane.focus .cm-content .tb-grid", { state: "attached" });
    await aspettaStato(pagina, "salvato");
    await anello(pagina, "messa la tabella");

    // Nei Blocchi: il cursore sull'etichetta, e il blocco sale sopra il
    // paragrafo con la scorciatoia della maniglia.
    await pagina.keyboard.press("Control+Shift+B");
    await pagina.waitForSelector('.pane.focus[data-mode="blocks"]');
    await selezionaConLaRicerca(pagina, ETICHETTA);
    await pagina.keyboard.press("Control+Shift+ArrowUp");
    await aspettaStato(pagina, "salvato");
    await giro.foto("blocco-spostato");
    await dallaPalette(pagina, "passa a live", "Passa a Live");
    await pagina.waitForSelector('.pane.focus[data-mode="live_preview"]');
  },
  async controlla(pagina, host) {
    const testo = await host.testo(NOTA);
    verifica(testo.includes(TABELLA), "nel Markdown manca la tabella 3 × 3 del «/»");
    verifica(!testo.includes("/tabella"), "il «/tabella» scritto è rimasto nel testo");
    const etichetta = testo.indexOf(`\n${ETICHETTA}\n`);
    const paragrafo = testo.indexOf(PARAGRAFO);
    verifica(etichetta >= 0 && paragrafo >= 0, `spostando il blocco si è perso «${ETICHETTA}» o il paragrafo`);
    verifica(etichetta < paragrafo, `«${ETICHETTA}» non è salito sopra il paragrafo`);
    verifica(testo.indexOf(TABELLA) > paragrafo, "spostando un blocco la tabella non è più in fondo");
    await anello(pagina, "tornati alla Live");
  },
};

const tastieraGrassetto = {
  id: "tastiera-grassetto",
  nome: "tastiera (7): Maiusc+F10 apre il menu sul testo, e «Grassetto» si raggiunge col Tab",
  async fai(pagina, giro) {
    await selezionaConLaRicerca(pagina, PAROLA);
    await pagina.keyboard.press("Shift+F10");
    await pagina.waitForSelector("#context-menu .menu-head");
    const testata = (await pagina.textContent("#context-menu .menu-head"))?.trim() ?? "";
    verifica(testata.includes("Selezione"), `il menu dice «${testata}», non la selezione`);
    await anello(pagina, "aperto il menu con Maiusc+F10");
    // Dal menu il Tab entra nella mini-barra, dove sta «Grassetto»; dentro
    // la barra (una `toolbar`) ci si muove con le frecce.
    await tasto(pagina, "Tab", "col Tab nella mini-barra");
    verifica(
      await pagina.evaluate(() => document.querySelector(".context-strip")?.contains(document.activeElement) ?? false),
      "il Tab dal menu non entra nella mini-barra",
    );
    for (let passi = 0; passi < 20; passi += 1) {
      const comando = await pagina.evaluate(() => document.activeElement?.getAttribute("data-command"));
      if (comando === "markdown.bold") break;
      await tasto(pagina, "ArrowRight", "con → verso «Grassetto»");
    }
    verifica(
      (await pagina.evaluate(() => document.activeElement?.getAttribute("data-command"))) === "markdown.bold",
      "con le frecce la mini-barra non arriva a «Grassetto»",
    );
    await giro.foto("grassetto");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector("#context-menu", { state: "detached" });
    await aspettaStato(pagina, "salvato");
  },
  async controlla(pagina, host) {
    const testo = await host.testo(NOTA);
    verifica(testo.includes(`seduta **${PAROLA}**.`), `nel Markdown «${PAROLA}» non è in grassetto`);
    const stato = await anello(pagina, "chiuso il menu");
    verifica(stato.testo, `chiuso il menu, la tastiera è su ${stato.dove}, non nel testo`);
  },
};

const tastieraPalette = {
  id: "tastiera-palette",
  nome: "tastiera (8): la palette cerca un comando e lo esegue",
  async fai(pagina) {
    verifica(
      (await pagina.locator('#file-list li[role="treeitem"][aria-expanded="true"]').count()) > 0,
      "nell'albero non c'è una cartella aperta da chiudere",
    );
    await dallaPalette(pagina, "comprimi tutte", COMANDO);
  },
  async controlla(pagina) {
    const aperte = await pagina.locator('#file-list li[role="treeitem"][aria-expanded="true"]').count();
    verifica(aperte === 0, `«${COMANDO}» ha lasciato ${aperte} cartelle aperte`);
    await pagina.waitForSelector(aFuoco(NOME));
    const stato = await anello(pagina, "chiusa la palette");
    verifica(stato.testo, `chiusa la palette, la tastiera è su ${stato.dove}, non nel testo`);
  },
};

const tastieraRiquadri = {
  id: "tastiera-riquadri",
  nome: "tastiera (9): una nota a lato dal menu dell'albero, e il fuoco passa da un riquadro all'altro",
  async fai(pagina, giro) {
    await tasto(pagina, "Control+Shift+E", "Ctrl+Maiusc+E");
    await scendiFinoA(pagina, ACCANTO);
    await pagina.keyboard.press("Shift+F10");
    await pagina.waitForSelector("#context-menu");
    for (let passi = 0; passi < 20; passi += 1) {
      const voce = await pagina.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      if (voce.startsWith("Apri a lato")) break;
      await tasto(pagina, "ArrowDown", "nel menu dell'albero");
    }
    await anello(pagina, "«Apri a lato»");
    await giro.foto("apri-a-lato");
    await pagina.keyboard.press("Enter");
    await pagina.waitForSelector(aFuoco(NOME_ACCANTO));
    await pagina.waitForSelector('.pane.focus .cm-content:has-text("Benvenuto in Fub")');
    verifica(
      await riquadroDi(pagina, NOME_ACCANTO).evaluate((pane) => pane.contains(document.activeElement)),
      "aperta a lato, la nota non ha la tastiera",
    );
    await anello(pagina, "aperta la nota a lato");
    await dallaPalette(pagina, "fuoco al foglio a sinistra", "Fuoco al foglio a sinistra");
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
    await anello(pagina, "passato il fuoco a sinistra");
  },
};

// ---------------------------------------------------------------------------
// 25 · chiudere con testo non salvato, e il conflitto che arriva intanto.
// ---------------------------------------------------------------------------

/// Testo non salvato che non si può né salvare né mettere in bozza, poi
/// Ctrl+W: la finestra di R01 chiede.
async function chiudiSenzaSalvare(pagina, frase) {
  await guasta(pagina, "writeDocument", "il disco è pieno");
  await guasta(pagina, "saveDraft", "il disco è pieno");
  await scriviInFondo(pagina, frase);
  await aspettaStato(pagina, "fallito");
  await pagina.keyboard.press("Control+w");
  const finestra = await conferma(pagina, "Modifiche non salvate");
  const domanda = (await finestra.locator(".kit-dialog-description").textContent())?.trim() ?? "";
  verifica(domanda === `«${NOME}» non si è potuta salvare. Scartare le modifiche, o tenerla aperta per riprovare?`, `la finestra chiede «${domanda}»`);
  // Il «no» è dove parte il fuoco: un Invio di slancio non scarta niente.
  const aFuocoNellaFinestra = await pagina.evaluate(() => document.activeElement?.getAttribute("data-action"));
  verifica(aFuocoNellaFinestra === "cancel", `nella finestra il fuoco parte da «${aFuocoNellaFinestra}», non da «Tienila aperta»`);
  return finestra;
}

/// Il percorso in testata del riquadro a fuoco si legge: ogni cartella
/// mostra almeno la sua iniziale con l'ellissi, anche quando accanto lo stato
/// è lungo («Salvataggio fallito», «Cambiato su disco»). Un segmento largo
/// zero lascia solo le barre: «📁 / / Il banco…».
async function percorsoLeggibile(pagina, passo) {
  const vuote = await pagina.evaluate(() =>
    [...document.querySelectorAll(".pane.focus .sheet-title [data-folder]")]
      .filter((cartella) => (cartella.textContent ?? "").trim() !== "" && cartella.getBoundingClientRect().width < 10)
      .map((cartella) => cartella.textContent.trim()));
  verifica(vuote.length === 0, `${passo}: nel percorso in testata non si legge ${vuote.map((nome) => `«${nome}»`).join(", ")}`);
}

const chiudereNonSalvato = {
  id: "chiudere-non-salvato",
  nome: "chiudere con testo non salvato: la finestra chiede, «Tienila aperta» lascia il testo",
  async fai(pagina, giro) {
    const finestra = await chiudiSenzaSalvare(pagina, NON_SALVATO);
    await giro.foto("chiede");
    await finestra.locator('button[data-action="cancel"]:text-is("Tienila aperta")').click();
    await finestra.waitFor({ state: "detached" });
    await pagina.waitForSelector(aFuoco(NOME));
    verifica((await testoDelRiquadro(pagina)).includes(NON_SALVATO), "«Tienila aperta» ha riaperto la nota senza il testo");
    verifica(!(await leggi(pagina, NOTA)).includes(NON_SALVATO), "con la porta guasta il testo è finito sul disco");
    // Si scriveva quando si è chiuso: il fuoco torna nel testo.
    const fuocoDopo = await anello(pagina, "riaperta con «Tienila aperta»");
    verifica(fuocoDopo.testo, `riaperta con «Tienila aperta», la tastiera è su ${fuocoDopo.dove}`);
    await percorsoLeggibile(pagina, "riaperta col salvataggio fallito");
    await giro.foto("tenuta");
    // Le porte tornano buone: Ctrl+S, dalla tastiera rimasta nel testo,
    // salva ciò che era rimasto.
    await ripara(pagina, "writeDocument");
    await ripara(pagina, "saveDraft");
    await pagina.keyboard.press("Control+s");
    await aspettaStato(pagina, "salvato");
  },
  async controlla(pagina, host) {
    verifica((await host.testo(NOTA)).includes(NON_SALVATO), "riparate le porte, il testo tenuto non è arrivato sul disco");
    verifica((await pagina.locator(".kit-dialog").count()) === 0, "la finestra è rimasta aperta");
  },
};

const conflittoDuranteLaChiusura = {
  id: "conflitto-durante-la-chiusura",
  nome: "il conflitto che arriva mentre la finestra della chiusura chiede: il testo resta",
  async fai(pagina, giro) {
    const finestra = await chiudiSenzaSalvare(pagina, DURANTE);
    // Mentre la finestra chiede, il disco torna buono e un'altra
    // applicazione cambia la nota.
    await ripara(pagina, "writeDocument");
    await ripara(pagina, "saveDraft");
    const disco = await leggi(pagina, NOTA);
    await scriviDaFuori(pagina, NOTA, `${disco}\n${FUORI_DURANTE}\n`);
    // Il conflitto vince: la finestra si chiude come «Tienila aperta» e la
    // nota torna con la barra del conflitto (PA T63).
    const chiusa = await finestra.waitFor({ state: "detached", timeout: ATTESA_CHIUSURA_MS }).then(() => true, () => false);
    verifica(chiusa, "arrivato il conflitto, la finestra «Modifiche non salvate» resta aperta e chiede ancora");
    await barraDelConflitto(pagina);
    await percorsoLeggibile(pagina, "tornata col conflitto");
    const fuocoDopo = await anello(pagina, "tornata col conflitto");
    verifica(fuocoDopo.testo, `tornata col conflitto, la tastiera è su ${fuocoDopo.dove}`);
    await giro.foto("arriva-il-conflitto");
  },
  async controlla(pagina, host) {
    await pagina.waitForSelector(aFuoco(NOME));
    await barraDelConflitto(pagina);
    verifica((await testoDelRiquadro(pagina)).includes(DURANTE), "arrivato il conflitto, il riquadro ha perso il testo");
    verifica((await host.testo(NOTA)).includes(FUORI_DURANTE), "il disco non ha più la riga dell'altra applicazione");
  },
};

// ---------------------------------------------------------------------------
// 26 · ripristinare una versione con testo non salvato.
// ---------------------------------------------------------------------------

const ripristinoConTestoNonSalvato = {
  id: "ripristino-con-testo-non-salvato",
  nome: "ripristinare una versione con testo non salvato: il testo resta, e la shell lo dice",
  async fai(pagina, giro) {
    verifica(versioneVecchia !== null, "il gruppo non ha preso la versione vecchia della nota");
    // Il compito prima lascia la nota col conflitto aperto: la persona lo
    // decide tenendo il suo testo, e si riparte da una nota salvata.
    await barraDelConflitto(pagina);
    await pagina.locator('.pane.focus .conflict-banner button:text-is("Mantieni il mio testo")').click();
    const prima = await conferma(pagina, `Conflitto su ${NOTA}`);
    await prima.locator('button[data-action="confirm"]').click();
    await prima.waitFor({ state: "detached" });
    await aspettaStato(pagina, "salvato");
    await scriviInFondo(pagina, PRIMA_DEL_RIPRISTINO);
    // Il ripristino: l'host riscrive il file con la versione vecchia. Il
    // foglio lo dice finché il salvataggio, poco dopo, non trova il disco
    // cambiato: allora la barra del conflitto dice tutto, e la riga se ne va.
    await scriviDaFuori(pagina, NOTA, versioneVecchia);
    await barraDelConflitto(pagina);
    await unSoloMessaggio(pagina, "il conflitto dopo il ripristino");
    verifica((await testoDelRiquadro(pagina)).includes(PRIMA_DEL_RIPRISTINO), "il ripristino ha tolto il testo non salvato dal riquadro");
    verifica((await leggi(pagina, NOTA)) === versioneVecchia, "il testo non salvato ha coperto la versione ripristinata senza chiedere");
    await giro.foto("ripristinata");
    await pagina.locator('.pane.focus .conflict-banner button:text-is("Mantieni il mio testo")').click();
    const finestra = await conferma(pagina, `Conflitto su ${NOTA}`);
    await finestra.locator('button[data-action="confirm"]').click();
    await finestra.waitFor({ state: "detached" });
    await aspettaStato(pagina, "salvato");
  },
  async controlla(pagina, host) {
    const scritture = (await host.chiamate("saveDraft")).filter((args) => args[0] === NOTA && String(args[1]).includes(PRIMA_DEL_RIPRISTINO));
    verifica(scritture.length > 0, "il testo non salvato non è mai finito in bozza");
    verifica((await host.testo(NOTA)).includes(PRIMA_DEL_RIPRISTINO), "scelto il mio testo, il disco non ce l'ha");
  },
};

// ---------------------------------------------------------------------------
// 27 · il salvataggio che fallisce.
// ---------------------------------------------------------------------------

const salvataggioCheFallisce = {
  id: "salvataggio-che-fallisce",
  nome: "il salvataggio che fallisce: la shell lo dice, il testo resta, e a porta buona riprova",
  async fai(pagina, giro) {
    await guasta(pagina, "writeDocument", "il disco è pieno");
    await scriviInFondo(pagina, NEL_GUASTO);
    await aspettaStato(pagina, "fallito");
    await avviso(pagina, `«${NOME}» non è stato salvato: il disco è pieno`);
    const riga = rigaDelFoglio(pagina, "save_failed");
    await riga.waitFor();
    verifica((await riga.getAttribute("role")) === "alert", "l'avviso del foglio non è un allarme");
    verifica((await riga.locator('button:text-is("Riprova")').count()) === 1, "l'avviso del foglio non offre «Riprova»");
    verifica(!(await leggi(pagina, NOTA)).includes(NEL_GUASTO), "con la porta guasta il testo è finito sul disco");
    verifica((await testoDelRiquadro(pagina)).includes(NEL_GUASTO), "il riquadro ha perso il testo non salvato");
    verifica(await pagina.isVisible(".pane.focus .tab.dirty"), "la linguetta non si dice non salvata");
    await giro.foto("fallito");
    // La porta torna buona: il salvataggio automatico riprova alla battuta
    // dopo (`state/saving.ts`), senza «Riprova».
    await ripara(pagina, "writeDocument");
    await pagina.keyboard.type(" Fine.");
    await aspettaStato(pagina, "salvato");
  },
  async controlla(pagina, host) {
    const testo = await host.testo(NOTA);
    verifica(testo.includes(`${NEL_GUASTO} Fine.`), "a porta buona il salvataggio non ha scritto il testo del guasto");
    verifica((await rigaDelFoglio(pagina, "save_failed").count()) === 0, "l'avviso del foglio è rimasto dopo il salvataggio");
    verifica(!(await pagina.isVisible(".pane.focus .tab.dirty")), "la linguetta si dice ancora non salvata");
    await nessunAvvisoDellaNota(pagina, "salvata dopo il guasto");
  },
};

export const guasti = {
  id: "guasti",
  nome: "quando qualcosa va storto",
  // Il primo compito carica la pagina da sé, con le query del gruppo.
  prepara: async () => {},
  compiti: [
    conflittoUsaDisco,
    conflittoTieniMio,
    solaLettura,
    cestino,
    tastieraAlbero,
    tastieraScrivere,
    tastieraModalita,
    tastieraTabella,
    tastieraGrassetto,
    tastieraPalette,
    tastieraRiquadri,
    chiudereNonSalvato,
    conflittoDuranteLaChiusura,
    ripristinoConTestoNonSalvato,
    salvataggioCheFallisce,
  ],
};
