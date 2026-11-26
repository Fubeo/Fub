// I gesti delle scene: aprire e scrivere note, documenti, fogli, la Base.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import {
  closeSidebarDrawer,
  gridCellCenter,
  marksAtRest,
  openFolder,
  openRibbon,
} from "./gesti-documenti.mjs";

/// Sceglie una voce del menu Vista dello Scrittoio, aperto dal marchio: la
/// strada ai comandi che non passa dal lanciatore.
export async function chooseFromViewMenu(page, label) {
  await page.click("#brand-menu");
  await page.click("#app-menu > button >> nth=2");
  await page.click(`#context-menu [role=menuitem]:has-text("${label}")`);
  await page.waitForSelector("#context-menu", { state: "detached" });
}

/// Aspetta che l'anteprima del lanciatore mostri la nota della riga attiva. La
/// resa parte dopo una sosta (`PREVIEW_DELAY_MS`) e fino ad allora resta quella
/// di prima, o il vuoto: una foto scattata prima sarebbe di un'altra riga.
export async function previewShowsActiveRow(page) {
  // In una finestra stretta l'anteprima non c'è (`previewFits`): basta la riga
  // attiva. Aspettare una resa che non arriverà fermerebbe la scena.
  await page.waitForFunction(() => {
    const input = document.querySelector(".launcher-input");
    const id = input?.getAttribute("aria-activedescendant");
    const title = id ? document.getElementById(id)?.querySelector(".launcher-row-title")?.textContent?.trim() : "";
    const preview = document.querySelector(".launcher-preview");
    if (!preview || preview.hidden) return Boolean(title);
    const shown = preview.querySelector(".launcher-preview-page")?.textContent ?? "";
    return Boolean(title) && !preview.hasAttribute("data-waiting") && shown.includes(title);
  });
}

/// Esegue un comando dello Scrittoio dal lanciatore, aperto dalla pillola: è
/// la strada che non dipende da una scorciatoia riconfigurabile. Il prefisso
/// `>` sceglie il modo dei comandi, come farebbe chi scrive.
export async function runScrittoioCommand(page, title) {
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
export async function runCommand(page, title) {
  await page.click("#open-palette");
  await page.fill(".palette-input", title);
  await page.waitForSelector(".palette-list li:not(.palette-empty)");
  await page.click(".palette-list li:not(.palette-empty)");
  await page.waitForSelector("#command-palette", { state: "detached" });
}

/// Il nome delle modalità nel menu, in italiano come il banco.
export const MODE_LABELS = { live_preview: "Scrittura", source: "Sorgente", reading: "Lettura" };

/// Sceglie la modalità del riquadro a fuoco come la persona (Scrittoio 2, T3):
/// dalla voce della banda, e dove la banda non c'è (il telefono) dal tondo del
/// foglio; poi la voce del menu col suo nome. I segmenti della testata restano
/// nel DOM ma non si vedono, e Playwright non clicca ciò che non si vede.
export async function chooseMode(page, mode, label = MODE_LABELS[mode]) {
  if (await page.isVisible(`.pane.focus[data-mode="${mode}"]`)) return;
  if (await page.isVisible("#status-mode")) await page.click("#status-mode");
  else await page.click(".pane.focus > .pane-mode-current");
  await page.click(`#context-menu [role="menuitemradio"]:has-text("${label}")`);
  await page.waitForSelector(`.pane.focus[data-mode="${mode}"]`);
}

/// Apre una nota dall'albero. Sta in una funzione perché due scene la fanno, e
/// perché il modo di aprirla è una cosa che può cambiare: cambierà qui.
///
/// **Si sceglie per `data-path`, non per testo.** `:has-text()` di Playwright
/// risale agli antenati: in un albero l'antenato di una nota è la sua cartella,
/// e la cartella contiene il testo di tutti i suoi figli. Il `data-path` è
/// invece l'identità stabile che l'esploratore mette sulle voci dell'albero e
/// che non dipende dall'implementazione del tooltip.
/// Il cursore in fondo alla riga del foglio a fuoco che contiene `text`, con
/// la barra di formato già montata coi suoi pulsanti.
export async function placeCursorOn(page, text) {
  await page.waitForSelector(".pane.focus .format-bar.kit-bar .kit-bar-button");
  await page.click(`.pane.focus .pane-editor .cm-content .cm-line:has-text(${JSON.stringify(text)})`);
  await page.keyboard.press("End");
}

/// Sceglie tre parole nella riga che comincia con `line`, come la tastiera:
/// il cursore a inizio riga, tre parole avanti, tre scelte con Maiusc.
export async function selectWords(page, line) {
  await page.click(`.pane.focus .pane-editor .cm-content .cm-line:has-text(${JSON.stringify(line)})`);
  await page.keyboard.press("Home");
  for (let step = 0; step < 3; step++) await page.keyboard.press("Control+ArrowRight");
  for (let step = 0; step < 3; step++) await page.keyboard.press("Control+Shift+ArrowRight");
}

/// Il riquadro del testo scelto nella nota a fuoco, letto quando lo strato
/// della selezione l'ha raggiunto. CodeMirror cambia la selezione del documento
/// subito, al tasto, ma ridisegna lo strato al suo fotogramma di misura: letto
/// prima, lo strato è ancora quello del tasto di prima (#488). Si aspetta che
/// copra la selezione del documento e resti fermo per due fotogrammi.
export async function selectionBox(page) {
  await page.evaluate(() => delete globalThis.__benchSelection);
  const found = await page.waitForFunction(() => {
    const layer = document.querySelector(".pane.focus .cm-selectionBackground")?.getBoundingClientRect();
    const chosen = getSelection();
    const range = chosen && chosen.rangeCount > 0 ? chosen.getRangeAt(0).getBoundingClientRect() : null;
    const covers = layer && range && range.width > 0 && Math.abs(layer.left - range.left) < 1 && Math.abs(layer.right - range.right) < 1;
    const at = covers ? `${layer.x} ${layer.y} ${layer.width} ${layer.height}` : null;
    const seen = (globalThis.__benchSelection ??= { at: null, frames: 0 });
    seen.frames = at !== null && seen.at === at ? seen.frames + 1 : 0;
    seen.at = at;
    return seen.frames >= 2 && { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  }, null, { polling: "raf" });
  return found.jsonValue();
}

/// Lo scorrimento della nota a fuoco fermo: lo stesso per tre fotogrammi di
/// fila. Con `toEnd` prima lo porta in fondo, e lo riporta finché il fondo non
/// smette di spostarsi.
///
/// Ctrl+Fine non basta da solo: CodeMirror scorre al suo fotogramma di misura,
/// e le altezze delle righe mai disegnate sono stime che cambiano appena le
/// disegna. Il clic che segue cadeva a volte prima di quello scorrimento:
/// Playwright portava la riga in vista da sé, e la foto mostrava un altro
/// tratto della nota a ogni corsa (`barra-blocco-stretta`, un terzo dei pixel
/// diversi fra due corse dello stesso codice).
export async function scrollerAtRest(page, { toEnd = false } = {}) {
  if (toEnd) {
    // Il fondo dipende dalle altezze di tutte le righe: misurate alla misura
    // di adesso, e non stimate da quella di prima (la nota si apre a finestra
    // larga, poi la finestra si stringe). Si percorre la nota a mezze
    // pagine finché un giro intero non cambia più l'altezza.
    await page.evaluate(async () => {
      const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
      if (!scroller) throw new Error("la nota a fuoco non ha lo scorrimento");
      const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (let pass = 0, height = -1; pass < 6 && height !== scroller.scrollHeight; pass += 1) {
        height = scroller.scrollHeight;
        for (let top = 0; top <= scroller.scrollHeight; top += scroller.clientHeight / 2) {
          scroller.scrollTop = top;
          await frames();
        }
      }
    });
  }
  await page.evaluate(() => delete globalThis.__benchScroll);
  await page.waitForFunction((end) => {
    const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
    if (!scroller) return false;
    const bottom = scroller.scrollHeight - scroller.clientHeight;
    if (end && Math.abs(scroller.scrollTop - bottom) > 1) scroller.scrollTop = bottom;
    const at = `${scroller.scrollTop} ${scroller.scrollHeight}`;
    const seen = (globalThis.__benchScroll ??= { at: null, frames: 0 });
    seen.frames = seen.at === at ? seen.frames + 1 : 0;
    seen.at = at;
    return seen.frames >= 3;
  }, toEnd, { polling: "raf" });
}

/// La barra misurata (il «…» deciso al fotogramma) e il puntatore lontano,
/// senza suggerimenti. La bolla della mini-barra, se c'è, ferma: lo stesso
/// posto per tre fotogrammi di fila (si riposa quando la sua misura cambia).
export async function settleBar(page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => delete globalThis.__benchBubble);
  await page.waitForFunction(() => {
    const bubble = document.querySelector(".selection-bubble:not([hidden])");
    const at = bubble ? `${bubble.style.left} ${bubble.style.top} ${bubble.getBoundingClientRect().width}` : "";
    const seen = (globalThis.__benchBubble ??= { at: null, frames: 0 });
    seen.frames = seen.at === at ? seen.frames + 1 : 0;
    seen.at = at;
    return seen.frames >= 3;
  }, null, { polling: "raf" });
}

export async function openNote(page, path) {
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
/// Il velo della selezione di blocchi copre la scheda scelta bordo per bordo,
/// e le righe sotto le schede stanno dove CodeMirror le misura (IMP-155): i
/// margini della scheda gli sfuggivano, e il velo saliva di 18 px.
export async function expectVeilOnCard(page, card) {
  await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-mark");
  const wrong = await page.evaluate(async (selector) => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const chosen = document.querySelector(selector).getBoundingClientRect();
    const mark = document.querySelector(".pane.focus .pane-editor .cm-fub-block-mark").getBoundingClientRect();
    const out = [];
    if (Math.abs(mark.top - chosen.top) > 0.5 || Math.abs(mark.bottom - chosen.bottom) > 0.5) {
      out.push(`velo ${mark.top}–${mark.bottom}, scheda ${chosen.top}–${chosen.bottom}`);
    }
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    for (const line of document.querySelectorAll(".pane.focus .pane-editor .cm-fub-live-card-slot + .cm-line")) {
      const measured = view.lineBlockAt(view.posAtDOM(line)).top + view.documentTop;
      const seen = line.getBoundingClientRect().top;
      if (Math.abs(measured - seen) > 0.5) out.push(`riga sotto una scheda misurata a ${measured}, vista a ${seen}`);
    }
    return out.join("; ");
  }, `${card}[data-card-chosen="true"]`);
  if (wrong) throw new Error(`il velo non sta sulla scheda: ${wrong}`);
}

/// Aspetta un pezzo di una scheda della Live. Se non arriva, l'errore nomina
/// il pezzo e il selettore, e dice com'era ogni scheda del riquadro: la specie,
/// lo stato e il modo della scheda, lo stato della sua vista e il suo testo.
/// Il rapporto del fotografo tiene la prima riga dell'errore, quindi tutto sta
/// su una riga.
export async function waitForCardPart(page, selector, what) {
  try {
    await page.waitForSelector(selector);
  } catch (error) {
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll(".pane.focus .pane-editor .live-card")].map((card) => {
        const view = card.querySelector("[data-card-state]:not(.live-card)");
        const text = (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        return `${card.dataset.cardKind ?? "?"} ${card.dataset.cardState ?? "?"}/${card.dataset.cardMode ?? "-"} vista ${view?.dataset.cardState ?? "-"} «${text}»`;
      })).catch(() => ["la pagina non risponde"]);
    const first = String(error?.message ?? error).split("\n")[0];
    throw new Error(`${what} non è arrivato (${selector}): ${first}; schede: ${cards.length === 0 ? "nessuna" : cards.join(" · ")}`);
  }
}

export async function openLive(page, keys, scroll, mode = "live_preview") {
  const doc = await page.evaluate(() => globalThis.__fubLiveBench?.doc ?? null);
  if (doc === null) throw new Error("la pagina non ha la nota della Live");
  // In una finestra stretta l'albero sta nel cassetto, come in
  // `openRichDocument`; la modalità la sceglie `chooseMode`.
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await openNote(page, doc);
  if (compact) await closeSidebarDrawer(page);
  await chooseMode(page, mode);
  await page.waitForSelector(`.pane.focus[data-mode="${mode}"] .pane-editor .cm-content`);
  await page.evaluate(async (bottom) => {
    // La vista si prende dal modulo del pacchetto testuale, lo stesso che la
    // shell ha già caricato: il banco non tocca CodeMirror da sé.
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const pane = document.querySelector(".pane.focus .pane-editor .cm-editor")?.parentElement;
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
  await settleLive(page, scroll === "bottom");
}

/// Dove sta la riga del cursore nella nota a fuoco: lo scorrimento, quanto può
/// scorrere al più e il bordo alto della riga nella finestra.
export function caretLinePlace(page) {
  return page.evaluate(async () => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const { node } = view.domAtPos(view.state.selection.main.head);
    const line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
    if (!line) throw new Error("il cursore non sta in una riga");
    const scroller = view.scrollDOM;
    return { scrollTop: scroller.scrollTop, maxScroll: scroller.scrollHeight - scroller.clientHeight, lineTop: line.getBoundingClientRect().top };
  });
}

/// La formula toccata (T60). `inline`: → davanti alla formula in riga, poi
/// due → fino al numeratore. `block`: il clic su ogni pezzo del blocco `$$`
/// deve portare il cursore lì (il posto detto al lettore di schermo), e la
/// foto resta col cursore nel numeratore. `error`: → davanti alla formula rotta.
export async function touchFormula(page, gesture) {
  const ready = ".cm-fub-mx-surface[data-state=\"ready\"]";
  const said = () => page.evaluate(() => document.querySelector(".cm-fub-mx [role=status]")?.textContent ?? "");
  if (gesture === "menu") {
    // Il menu della formula (T65): il tasto destro sulla formula in riga, la
    // nota ferma; le voci si contano, se no la scena è rossa.
    await openLive(page, [], "top");
    await page.click(".cm-content .cm-fub-math", { button: "right" });
    await page.waitForSelector("#context-menu .menu-head");
    // I riquadri di «Copia come» non hanno testo: si leggono dal nome.
    const items = await page.locator("#context-menu [role=menuitem]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") || node.textContent || ""));
    for (const label of ["Modifica", "Copia come LaTeX", "Copia come immagine", "Copia come equazione", "Da riga a blocco"]) {
      if (!items.some((item) => item.includes(label))) throw new Error(`nel menu della formula manca «${label}»: ${items.join(" · ")}`);
    }
    await page.mouse.move(0, 0);
    return;
  }
  if (gesture === "align") {
    // Invio nel blocco (T65): la formula in un aligned, il cursore sulla riga
    // nuova, e ciò che si scrive ci entra.
    await openLive(page, [], "top");
    const box = await page.locator(".cm-content .math-block").first().boundingBox();
    if (!box) throw new Error("manca il blocco $$");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("y");
    const doc = await page.evaluate(async () => {
      const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
      return findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement).state.doc.toString();
    });
    if (!/\\begin\{aligned\}[\s\S]*&=\s*y\s*\\end\{aligned\}/.test(doc)) throw new Error(`Invio nel blocco non allinea: ${doc}`);
    await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    await page.mouse.move(0, 0);
    return;
  }
  if (gesture === "choose" || gesture === "matrix" || gesture === "touch") {
    // Scegliere un pezzo, le matrici, il tocco (T66), nel blocco $$.
    const cdp = gesture === "touch" ? await touchOn(page) : null;
    if (cdp && (await page.evaluate(() => matchMedia("(hover: hover)").matches))) throw new Error("il tocco emulato non ha tolto il passaggio");
    await openLive(page, [], "top");
    const centre = async (selector, fy = 0.5, fx = 0.5) => {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`la formula non ha ${selector}`);
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };
    if (cdp) {
      // Un tocco sulla formula la apre; il dito, poi, porta il cursore dal
      // numeratore fin sotto la radice, senza scegliere niente.
      const tap = async (point) => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
      await tap(await centre(".cm-content .math-block .mfrac", 0.2));
      await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
      const from = await centre(".cm-fub-mx-block .mfrac", 0.2);
      const to = await centre(".cm-fub-mx-block .sqrt", 0.5, 0.7);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      for (let step = 1; step <= 8; step++) {
        const point = { x: from.x + ((to.x - from.x) * step) / 8, y: from.y + ((to.y - from.y) * step) / 8 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      if ((await said()) !== "sotto la radice") throw new Error(`il dito non porta il cursore sotto la radice: ${await said()}`);
      if (await page.locator(".cm-fub-mx-block [data-fubsel]").count()) throw new Error("il dito ha scelto un pezzo");
      // La tavolozza sotto la formula, con l'invito al tocco.
      await page.waitForSelector(".cm-fub-mx-block .cm-fub-mx-palette .cm-fub-mx-quick .cm-fub-mx-tile .katex");
      const tip = await page.locator(".cm-fub-mx-block .cm-fub-mx-tip").textContent();
      if (tip !== "Tocca un simbolo per metterlo nella formula") throw new Error(`l'invito della tavolozza non è quello del tocco: ${tip}`);
      await page.waitForFunction(() => document.getAnimations().length === 0);
      return;
    }
    const box = await page.locator(".cm-content .math-block").first().boundingBox();
    if (!box) throw new Error("manca il blocco $$");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    await page.keyboard.press("End");
    if (gesture === "choose") {
      // Maiusc ← tre volte: la radice, il +, poi x con il suo esponente.
      for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
      const picked = await page.waitForSelector(".cm-fub-mx-block [data-fubsel] .sqrt", { timeout: 5000 }).then(() => true, () => false);
      if (!picked) {
        const seen = await page.evaluate(() => {
          const mx = document.querySelector(".cm-fub-mx-block");
          return `scelta=${mx?.dataset.chosen} segni=${mx?.querySelectorAll("[data-fubsel]").length} detto=${mx?.querySelector("[role=status]")?.textContent} fuoco=${document.activeElement?.className}`;
        });
        throw new Error(`Maiusc ← non sceglie la radice: ${seen}`);
      }
      await page.waitForSelector(".cm-fub-mx-block [data-fubsel] .msupsub");
      if (await page.locator(".cm-fub-mx-block [data-fubsel] .mfrac").count()) throw new Error("la scelta ha preso anche la frazione");
      if ((await said()) !== "pezzo scelto") throw new Error(`la scelta non si dice: ${await said()}`);
    } else {
      // Una matrice dalla tavolozza: Tab passa alla cella dopo, Invio alla
      // riga dopo e, dall'ultima, ne aggiunge una.
      await page.keyboard.type("+");
      await page.click(".cm-fub-mx-block .cm-fub-mx-all");
      await page.click(".cm-fub-mx-block .cm-fub-mx-find-input");
      await page.keyboard.type("matrice");
      await page.click('.cm-fub-mx-block .cm-fub-mx-grid .cm-fub-mx-tile[aria-label="Matrice 2 per 2"]');
      await page.waitForSelector(`.cm-fub-mx-block ${ready} [data-fubhole]`);
      await page.keyboard.type("1");
      await page.keyboard.press("Tab");
      await page.keyboard.type("0");
      await page.keyboard.press("Enter");
      await page.keyboard.type("1");
      await page.keyboard.press("Enter");
      if ((await said()) !== "riga 3, colonna 1, spazio vuoto") throw new Error(`Invio dall'ultima riga non porta alla riga nuova: ${await said()}`);
      const doc = await page.evaluate(async () => {
        const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
        return findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement).state.doc.toString();
      });
      if (!/\\begin\{pmatrix\}\s*1\s*&\s*0\s*\\\\\s*&\s*1\s*\\\\\s*&\s*\\end\{pmatrix\}/.test(doc)) throw new Error(`la matrice non è quella attesa: ${doc}`);
      await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    }
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    return;
  }
  if (gesture.startsWith("source")) {
    // Il campo del LaTeX (T63). La scena prova che il campo c'è, che la
    // scrittura veloce trasforma e che gli aiuti fanno quello che dicono; se
    // no è rossa.
    const field = ".cm-fub-mx[data-mode=\"source\"] .cm-fub-mx-field";
    if (gesture === "source-block") {
      await openLive(page, [], "top");
      const box = await page.locator(".cm-content .math-block").first().boundingBox();
      if (!box) throw new Error("manca il blocco $$");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector(`.cm-fub-mx-block ${field}`);
      await page.click(`.cm-fub-mx-block ${field}`);
    } else {
      await openLive(page, ["@ArrowRight"], "top");
      await page.waitForSelector(`.cm-fub-mx-popover ${field}`);
    }
    await page.waitForSelector(`.cm-fub-mx[data-mode="source"] ${ready}`);
    const value = () => page.locator(field).first().inputValue();
    await page.keyboard.press("End");
    if (gesture === "source" || gesture === "source-block") {
      await page.keyboard.type(gesture === "source" ? "+a/" : " ->y");
      const tex = await value();
      const expected = gesture === "source" ? "+\\frac{a}{}" : "\\to y";
      if (!tex.endsWith(expected)) throw new Error(`la scrittura veloce non trasforma: ${tex}`);
      await page.waitForSelector(".cm-fub-mx-palette .cm-fub-mx-quick .cm-fub-mx-tile .katex");
    } else if (gesture === "source-options") {
      await page.click(".cm-fub-mx-row .cm-fub-mx-more");
      await page.waitForSelector(".cm-fub-mx-options:not([hidden]) [data-help=\"piene\"][aria-pressed=\"true\"]");
      // «Posto» (T65): la formula in riga in un paragrafo può farsi blocco.
      await page.waitForSelector(".cm-fub-mx-options [data-place=\"inline\"][aria-pressed=\"true\"]");
    } else if (gesture === "source-discrete") {
      await page.keyboard.type("+a/b");
      if (!(await value()).endsWith("+a/b")) throw new Error(`coi discreti «a/b» si trasforma: ${await value()}`);
      if (await page.locator(".cm-fub-mx-palette").isVisible()) throw new Error("coi discreti la tavolozza si vede senza chiederla");
      await page.waitForSelector(".cm-fub-mx-palette-toggle:not([hidden])");
      await page.keyboard.type("+\\al");
      await page.waitForSelector(".cm-fub-mx-symbols:not([hidden]) .cm-fub-mx-symbol-code");
    } else if (gesture === "source-unknown" || gesture === "source-brace" || gesture === "source-guesses") {
      // Gli errori in chiaro (T64): il nome che non c'è (Esc chiude le
      // proposte), la graffa aperta, il nome con più simboli vicini.
      const typed = { "source-unknown": "+\\alfa", "source-brace": "+x^{2", "source-guesses": "+\\s 1" }[gesture];
      await page.keyboard.type(typed);
      if (gesture === "source-unknown") {
        await page.waitForSelector(".cm-fub-mx-symbols:not([hidden])");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".cm-fub-mx-symbols", { state: "hidden" });
      }
      const tex = await value();
      await page.waitForSelector(".cm-fub-mx-error:not([hidden])");
      if ((await value()) !== tex) throw new Error(`il TeX è cambiato da solo: ${tex} → ${await value()}`);
      const sentence = await page.locator(".cm-fub-mx-error-text").textContent();
      const fix = await page.locator(".cm-fub-mx-error-fix").allTextContents();
      const expected = {
        "source-unknown": ["Non conosco \\alfa. Forse volevi \\alpha?", ["Usa \\alpha"]],
        "source-brace": ["Manca una } di chiusura.", ["Chiudi"]],
        "source-guesses": [/^Non conosco \\s\. Forse volevi .+ o .+\?$/, []],
      }[gesture];
      const sentenceOk = typeof expected[0] === "string" ? sentence === expected[0] : expected[0].test(sentence ?? "");
      if (!sentenceOk || fix.join("|") !== expected[1].join("|")) throw new Error(`la frase dell'errore non è quella attesa: ${sentence} · ${fix.join("|")}`);
    } else {
      await page.keyboard.type("+a/b->c (");
      if (!(await value()).endsWith("+a/b->c (")) throw new Error(`con gli aiuti spenti qualcosa si trasforma: ${await value()}`);
      if (await page.locator(".cm-fub-mx-palette").isVisible()) throw new Error("con gli aiuti spenti c'è la tavolozza");
    }
  } else if (gesture.startsWith("palette") || gesture.startsWith("search")) {
    // La tavolozza (T62): la formula in riga aperta (o il blocco), «Tutti» e,
    // per la ricerca, una parola nel campo; da tastiera Alt ↓ e una freccia.
    if (gesture === "palette-block") {
      await openLive(page, [], "top");
      const box = await page.locator(".cm-content .math-block").first().boundingBox();
      if (!box) throw new Error("manca il blocco $$");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    } else {
      await openLive(page, ["@ArrowRight"], "top");
      await page.waitForSelector(`.cm-fub-mx-popover ${ready}`);
    }
    await page.waitForSelector(".cm-fub-mx-quick .cm-fub-mx-tile .katex");
    if (gesture === "palette-keys") {
      await page.keyboard.press("Alt+ArrowDown");
      await page.keyboard.press("ArrowRight");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      const tip = await page.locator(".cm-fub-mx-tip .cm-fub-mx-tip-name").textContent();
      if (focused !== "Potenza" || tip !== "Potenza") throw new Error(`Alt ↓ e → non portano a «Potenza»: ${focused}, ${tip}`);
    } else {
      await page.click(".cm-fub-mx-all");
      await page.waitForSelector(".cm-fub-mx-grid .cm-fub-mx-tile .katex");
      if (gesture.startsWith("search")) {
        await page.click(".cm-fub-mx-find-input");
        await page.keyboard.type(gesture === "search" ? "freccia" : "zzz");
        await page.waitForSelector(gesture === "search" ? ".cm-fub-mx-searching .cm-fub-mx-grid .cm-fub-mx-tile" : ".cm-fub-mx-none");
        if (gesture === "search") {
          const first = await page.locator(".cm-fub-mx-grid .cm-fub-mx-tile").first().getAttribute("aria-label");
          if (first !== "Freccia a destra") throw new Error(`«freccia» non dà prima le frecce: ${first}`);
        }
      }
    }
  } else if (gesture === "symbols" || gesture === "symbols-block") {
    // Le proposte dei simboli (T61): in fondo alla formula, `+` e il nome.
    if (gesture === "symbols") {
      await openLive(page, ["@ArrowRight"], "top");
      await page.waitForSelector(`.cm-fub-mx-popover ${ready}`);
    } else {
      await openLive(page, [], "top");
      const box = await page.locator(".cm-content .math-block").first().boundingBox();
      if (!box) throw new Error("manca il blocco $$");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    }
    await page.keyboard.press("End");
    await page.keyboard.type(gesture === "symbols" ? "+\\fr" : "+\\s");
    await page.waitForSelector(".cm-fub-mx-symbols:not([hidden]) [aria-selected=\"true\"] .katex");
    const names = await page.locator(".cm-fub-mx-symbol-name").allTextContents();
    if (names.length < 3) throw new Error(`poche proposte: ${names.join(", ")}`);
  } else if (gesture === "block") {
    await openLive(page, [], "top");
    const centre = async (selector, fy = 0.5, fx = 0.5) => {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`la formula non ha ${selector}`);
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };
    // Il primo clic, sulla formula resa, la apre già nel numeratore.
    const first = await centre(".cm-content .math-block .mfrac", 0.2);
    await page.mouse.click(first.x, first.y);
    await page.waitForSelector(`.cm-fub-mx-block ${ready}`);
    const clicks = [
      [".cm-fub-mx-block .mfrac", 0.85, 0.5, "denominatore"],
      [".cm-fub-mx-block .msupsub", 0.3, 0.6, "esponente di x"],
      [".cm-fub-mx-block .sqrt", 0.5, 0.7, "sotto la radice"],
      [".cm-fub-mx-block .mfrac", 0.15, 0.5, "numeratore"],
    ];
    const wrong = [];
    if ((await said()) !== "numeratore") wrong.push(`apertura: ${await said()}`);
    for (const [selector, fy, fx, expected] of clicks) {
      const point = await centre(selector, fy, fx);
      await page.mouse.click(point.x, point.y);
      const got = await said();
      if (got !== expected) wrong.push(`${expected}: ${got}`);
    }
    if (wrong.length) throw new Error(`il clic non porta il cursore dove cade: ${wrong.join("; ")}`);
  } else {
    await openLive(page, ["@ArrowRight"], "top");
    await page.waitForSelector(gesture === "error" ? ".cm-fub-mx[data-mode=\"latex\"] .cm-fub-mx-latex" : `.cm-fub-mx-popover ${ready}`);
    // Sotto il LaTeX, che cosa non va, con la correzione (T64).
    if (gesture === "error") await page.waitForSelector(".cm-fub-mx[data-mode=\"latex\"] .cm-fub-mx-error:not([hidden]) .cm-fub-mx-error-fix");
    if (gesture === "inline") {
      // Un pezzo alla volta: v, =, poi dentro la frazione.
      for (let i = 0; i < 6 && (await said()) !== "numeratore"; i++) await page.keyboard.press("ArrowRight");
      if ((await said()) !== "numeratore") throw new Error(`le frecce non entrano nel numeratore: ${await said()}`);
    }
  }
  // Il puntatore lontano dai bottoni: nessun suggerimento nella foto.
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
}

/// La nota dei commenti (T22) in `mode`, poi il gesto: `open` apre la
/// discussione del primo segno, `compose` il primo messaggio sulla selezione
/// del caso (Ctrl Alt M), `panel` il pannello «Commenti» dell'ispettore.
export async function openComments(page, mode, gesture) {
  const compose = gesture === "compose";
  await openLive(page, [], "top", mode === "reading" ? "live_preview" : mode);
  if (mode === "reading") await chooseMode(page, "reading");
  const where = mode === "reading" ? '.pane.focus[data-mode="reading"] .markdown-rendered' : ".pane.focus .cm-editor";
  if (!compose) {
    await page.waitForSelector(`${where} :is(.cm-fub-comment-bubble, .cm-fub-comment-sign)`);
    await page.waitForFunction(() => document.getAnimations().length === 0);
  }
  if (gesture === "open") {
    await page.click(`${where} :is(.cm-fub-comment-bubble, .cm-fub-comment-sign) >> nth=0`);
    await page.waitForSelector(".cm-fub-comment-popover .cm-fub-comment-message");
  } else if (compose) {
    await page.keyboard.press("Control+Alt+m");
    await page.waitForSelector(".cm-fub-comment-popover .cm-fub-comment-composer");
  } else if (gesture === "panel") {
    const panel = '.surface-panel[data-view-id="markdown.comments"]';
    await page.waitForSelector(panel, { state: "attached" });
    if (!(await page.isVisible(panel))) {
      await page.evaluate(async () => {
        const { selectInspectorTab } = await import("/src/ui/views.ts");
        selectInspectorTab("markdown.comments");
      });
    }
    await page.waitForSelector(`${panel} .cm-fub-comments-card`);
  }
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// La testata (T6) a riposo, in `mode`: la nota dall'alto, nessun fuoco, il
/// puntatore fuori. `more` apre prima «Altre N proprietà».
export async function openHeader(page, mode, gesture) {
  await openLive(page, [], "top");
  // Sul telefono, chiuso il cassetto dei file, l'ispettore sale dal basso
  // finché il fuoco non entra nel foglio: la testata a riposo non ha fuoco,
  // e il cassetto si chiude dal suo velo.
  if (await page.isVisible("#inspector-scrim")) {
    const scrim = await page.locator("#inspector-scrim").boundingBox();
    await page.click("#inspector-scrim", { position: { x: scrim.width - 8, y: 8 } });
    await page.waitForSelector("#inspector-scrim", { state: "hidden" });
  }
  if (mode === "reading") await chooseMode(page, "reading");
  const pane = mode === "reading" ? '.pane.focus[data-mode="reading"] .pane-editor .markdown-rendered' : ".pane.focus .pane-editor .cm-content";
  await page.waitForSelector(`${pane} .cm-fub-page .cm-fub-page-title`);
  if (gesture === "more") {
    await page.click(`${pane} .cm-fub-page-props-more`);
    await page.waitForSelector(`${pane} .cm-fub-page-props-more[aria-expanded="true"]`);
  }
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    for (const scroller of document.querySelectorAll(".pane.focus .pane-editor .cm-scroller, .pane.focus .pane-editor .markdown-rendered")) scroller.scrollTop = 0;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// I tipi di nota (T33): la nota della Live a riposo, poi il gesto. `new`
/// apre «Nuova nota» (dal cassetto, che in una finestra stretta si apre
/// prima); `typed` e `missing` aspettano che la testata sappia il tipo;
/// `choose` apre «Scegli il tipo» da tastiera.
export async function openNoteTypes(page, gesture) {
  await openHeader(page, "live_preview");
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "typed") await page.waitForSelector(".pane.focus .cm-fub-page-icon[data-from-type]");
  if (gesture === "missing" || gesture === "choose") await page.waitForSelector(".pane.focus .cm-fub-page-type-notice");
  if (gesture === "new") {
    const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
    if (compact) {
      await page.click('#views-ribbon .rail-btn[data-panel="files"]');
      await page.waitForSelector("#sidebar-scrim:not([hidden])");
    }
    await page.waitForSelector("#types-list:not([hidden]) .type-row");
    // Il «+» del cassetto apre il menu «Nuovo» (S34); la sua «Nota» è il
    // gesto di «Nuova nota», che coi tipi nel vault chiede il tipo sotto il
    // «+» (E5).
    await page.click("#new-note");
    await page
      .locator('#context-menu[aria-label="Nuovo"] [role=menuitem]')
      .filter({ has: page.locator(".menu-label", { hasText: /^Nota$/ }) })
      .click();
    await page.waitForSelector(".note-type-popover .note-type-menu-item");
  }
  if (gesture === "choose") {
    await page.focus(".pane.focus .cm-fub-page-type-action");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".note-type-popover .note-type-menu-item");
  }
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await frames();
}

/// Gli editor dei tipi (T8): apre la testata a riposo, poi l'editor della
/// voce che il gesto dice, come lo apre chi usa Fub. Il puntatore resta
/// sull'editor aperto solo quando è il puntatore ad aprirlo.
export async function openPropertyEditor(page, gesture) {
  await openHeader(page, "live_preview", gesture === "list" ? "more" : undefined);
  if (!gesture) return;
  const row = (key) => `.pane.focus .cm-fub-page-prop[data-key="${key}"]`;
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "text" || gesture === "date") {
    const key = gesture === "text" ? "tipo" : "scadenza";
    await page.focus(`${row(key)} .cm-fub-page-prop-value`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(gesture === "text" ? `${row(key)} .cm-fub-prop-input` : ".cm-fub-prop-date");
  } else if (gesture === "people" || gesture === "list") {
    await page.click(`${row(gesture === "people" ? "persone" : "luoghi")} .cm-fub-page-prop-value`);
    await page.waitForSelector(gesture === "people" ? ".cm-fub-prop-people [role=option]" : ".cm-fub-prop-list");
  } else {
    await page.click(`${row("stato")} .cm-fub-page-prop-key`);
    await page.waitForSelector(".cm-fub-prop-menu");
    if (gesture === "type") {
      await page.locator(".cm-fub-prop-menu [role^=menuitem]", { hasText: "Tipo" }).first().click();
      await page.waitForSelector(".cm-fub-prop-menu [role=menuitemradio]");
    }
  }
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await frames();
}

/// La Relazione (T35): `open` apre il riquadro col puntatore sul valore
/// (non sul nome, che apre la nota); `create` lo apre da tastiera e scrive
/// un nome che non c'è.
export async function openRelationEditor(page, gesture) {
  await openHeader(page, "live_preview");
  const row = '.pane.focus .cm-fub-page-prop[data-key="libri"]';
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "open") {
    const box = await page.locator(`${row} .cm-fub-page-prop-value`).boundingBox();
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
    await page.waitForSelector(".cm-fub-prop-relation [role=option]:not(.cm-fub-prop-group)");
  } else if (gesture === "create") {
    await page.focus(`${row} .cm-fub-page-prop-value`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".cm-fub-prop-relation [role=option]");
    await page.keyboard.type("Neuromante");
    await page.waitForSelector(".cm-fub-prop-relation .cm-fub-prop-create");
  }
  if (gesture !== "open") await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await frames();
}

/// Le scene di Selezione e Stato (T9): `more` apre «Altre», `status` apre l'elenco dello Stato da
/// tastiera (il fuoco sul valore e Invio); `create` apre la Selezione col
/// puntatore e scrive un nome che non c'è.
export async function openOptionsEditor(page, gesture) {
  await openHeader(page, "live_preview", gesture === "more" ? "more" : undefined);
  const row = (key) => `.pane.focus .cm-fub-page-prop[data-key="${key}"]`;
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "status") {
    await page.focus(`${row("stato")} .cm-fub-page-prop-value`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".cm-fub-prop-choices .cm-fub-prop-group");
  } else if (gesture === "create") {
    await page.click(`${row("sala")} .cm-fub-page-prop-value`);
    await page.waitForSelector(".cm-fub-prop-choices [role=option]");
    await page.keyboard.type("Media");
    await page.waitForSelector(".cm-fub-prop-choices .cm-fub-prop-create");
  }
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await frames();
}

/// Scrittura a riposo (T3): apre la nota con la testata, prova che ciò che
/// compare al passaggio non sposta il testo, poi ferma il foglio (puntatore
/// fuori, nessun fuoco) e pretende che non si veda niente di ciò che compare
/// al passaggio o a richiesta (`data-presence`), né un pulsante che non sia
/// contenuto. Lancia, con l'elenco di ciò che si vede, se una delle due
/// regole cade.
export async function writingAtRest(page) {
  await openLive(page, [], "top");
  await page.waitForSelector(".pane.focus .pane-editor .cm-fub-page-title");
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Le posizioni del testo rispetto al contenuto, non alla finestra: il
  // passaggio può far scorrere la nota, e lo scorrimento non è uno spostamento.
  const textBoxes = () => page.evaluate(() => {
    const content = document.querySelector(".pane.focus .pane-editor .cm-scroller > .cm-content");
    const origin = content.getBoundingClientRect();
    return [...content.querySelectorAll(":scope > .cm-line, .cm-fub-page-title, .note-facts")].slice(0, 24).map((el) => {
      const box = el.getBoundingClientRect();
      return `${Math.round(box.left - origin.left)},${Math.round(box.top - origin.top)}`;
    });
  });
  await frames();
  const before = await textBoxes();
  await page.hover(".pane.focus .pane-editor .cm-content .cm-line:has-text('Cose da fare')");
  await page.waitForSelector('.pane.focus .pane-editor .cm-fub-block-handles[data-active="true"]');
  await page.hover(".pane.focus .pane-editor .cm-fub-page-title");
  await page.waitForFunction(() => {
    const tools = document.querySelector(".pane.focus .pane-editor .cm-fub-page-tools");
    return tools !== null && Number(getComputedStyle(tools).opacity) > 0.95;
  });
  await frames();
  const during = await textBoxes();
  if (during.join(" ") !== before.join(" ")) {
    throw new Error(`al passaggio il testo si è spostato: ${before.join(" ")} → ${during.join(" ")}`);
  }
  // Il foglio fermo: il puntatore fuori, nessun fuoco, la nota dall'alto.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.querySelector(".pane.focus .pane-editor .cm-scroller").scrollTop = 0;
  });
  // Una funzione sola, che il browser esegue per aspettare (`empty`) e poi per
  // dire che cosa resta. Si passa come funzione, non come testo: un predicato
  // scritto come stringa Playwright lo valuta con `eval`, e la CSP del banco
  // (quella dell'app, senza `'unsafe-eval'`) lo rifiuta.
  const seen = function visibleAtRest(empty) {
    const shown = (el) => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (node.hidden) return false;
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
      }
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const sheet = document.querySelector(".pane.focus .pane-editor .cm-editor");
    const name = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
    // I pulsanti che sono contenuto, a riposo anche nel prototipo: l'icona
    // della pagina, la riga dei dati e la testata di un blocco di codice
    // (lingua, «A capo», «Copia»).
    const content = ".cm-fub-page-icon, .cm-fub-page-props button, .cm-fub-page-props button *, .note-facts *, .cm-fub-code-header button";
    const left = [
      ...[...sheet.querySelectorAll("[data-presence]")].filter(shown).map((el) => `${name(el)}[${el.dataset.presence}]`),
      ...[...sheet.querySelectorAll("button, [role=button]")].filter((el) => !el.closest("[data-presence]") && !el.matches(content) && shown(el)).map(name),
    ];
    return empty ? left.length === 0 : left;
  };
  try {
    await page.waitForFunction(seen, true, { timeout: 5_000 });
  } catch {
    const left = await page.evaluate(seen, false);
    throw new Error(`a riposo si vede ancora: ${left.join(", ")}`);
  }
  await frames();
}

/// La Live a riposo, prima della foto: due cose arrivavano dopo i due
/// fotogrammi che bastavano prima, e secondo il carico finivano nella foto o no.
///
/// - Ciò che si è scritto si salva 400 ms dopo l'ultimo tasto: la foto
///   prendeva «Non salvato» o «Salvato», nella barra del riquadro, sulla
///   linguetta e in fondo (#273). Si fotografa a salvataggio finito, lo stato
///   in cui la scena resta.
/// - Le formule arrivano dopo (KaTeX si carica alla prima, e i suoi caratteri
///   dopo ancora) e cambiano di un pixel o due l'altezza delle righe. Lo
///   scorrimento verso il cursore chiesto prima resta dov'era, e la foto
///   veniva spostata di 1-2 px (#279). Si aspetta che ogni formula sia
///   disegnata e ogni carattere caricato, poi si chiede di nuovo lo stesso
///   scorrimento, da capo, sull'impaginazione finale. La nota portata in
///   fondo (`bottom`) resta dove l'ha messa l'apertura: lì non c'è un cursore
///   da tenere in vista.
/// Il tocco emulato da Chromium: `(hover: none)`, `(any-hover: none)` e
/// `(pointer: coarse)`. Non si spegne più: spento, Chromium rimette il
/// puntatore fine ma lascia `(hover: none)` a ogni documento dello stesso
/// processo, anche dopo una navigazione. Per questo le scene che lo
/// accendono hanno `touch: true` e stanno in fondo (`touchLast`).
export async function touchOn(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return cdp;
}

/// La griglia al dito: apre la cartella grande, tiene il dito su B3 oltre
/// `LONG_PRESS_MS` (450 ms in `editors/grid/engine-parts.ts`) finché compaiono le due
/// maniglie, e tira quella di fine fino a B6. Il dito passa dal browser vero
/// (`Input.dispatchTouchEvent`), come in `bench/grid-gestures.mjs`.
export async function touchGridHandles(page) {
  const cdp = await touchOn(page);
  await openRibbon(page, "phone", "Dati/Grande.xlsx");
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(({ x, y }) => ({ x, y, id: 1 })) });
  const b3 = await gridCellCenter(page, 2, 1);
  const b6 = await gridCellCenter(page, 5, 1);
  await send("touchStart", [b3]);
  await page.waitForFunction(() => [...document.querySelectorAll(".pane.focus .grid-mark-touch")].filter((mark) => !mark.hidden).length === 2);
  await send("touchEnd", []);
  const grip = await page.evaluate(() => {
    const mark = [...document.querySelectorAll('.pane.focus .grid-mark-touch[data-handle="b"]')].find((el) => !el.hidden);
    const box = mark?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  });
  if (!grip) throw new Error("la maniglia di fine del tocco lungo non si vede");
  await send("touchStart", [grip]);
  for (let step = 1; step <= 10; step += 1) {
    const t = step / 10;
    await send("touchMove", [{ x: grip.x + (b6.x - grip.x) * t, y: grip.y + (b6.y - grip.y) * t }]);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  await send("touchEnd", []);
  await page.waitForFunction(() => document.querySelectorAll(".pane.focus .grid-cell.selected").length === 4);
  await marksAtRest(page);
}

/// La tastiera a schermo, finta: un browser senza schermo non l'ha, e ciò
/// che la shell ne sa è che il viewport visivo si accorcia.
export async function keyboardUp(page) {
  await page.evaluate(() => {
    const view = window.visualViewport;
    Object.defineProperty(view, "height", { configurable: true, get: () => window.innerHeight - 320 });
    view.dispatchEvent(new Event("resize"));
  });
  await page.waitForSelector(':root[data-mobile-keyboard="visible"]');
}

/// Le scene al tocco (T26a). `rest`: la nota senza cursore. `cursor`: il
/// cursore nel compito e la tastiera su, la barra col gruppo «Compito».
/// `hold`: in più, il dito tenuto sulla maniglia finché il blocco è in mano.
export async function touchBlocks(page, gesture) {
  const cdp = await touchOn(page);
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) throw new Error("il tocco emulato non ha tolto il passaggio");
  await openLive(page, [], "top");
  await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles", { state: "attached" });
  await page.waitForFunction(() => document.getAnimations().length === 0);
  if (gesture === "rest") {
    await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles", { state: "hidden" });
    return;
  }
  await keyboardUp(page);
  await settleLive(page, false);
  // Il compito a metà della parte che la tastiera lascia: la colonna del «+»
  // e della maniglia sborda sopra e sotto la riga, e si vede intera.
  await page.evaluate(async () => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const caret = view.coordsAtPos(view.state.selection.main.head);
    const box = view.scrollDOM.getBoundingClientRect();
    if (caret) view.scrollDOM.scrollTop += (caret.top + caret.bottom) / 2 - (box.top + box.height / 2);
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForSelector('.pane.focus > .format-bar .format-bar-context[data-block="task"]:not([hidden])');
  await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-grip", { state: "visible" });
  if (gesture === "hold") {
    const box = await page.locator(".pane.focus .pane-editor .cm-fub-block-grip").boundingBox();
    if (!box) throw new Error("la maniglia non si vede");
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Il dito resta giù: la foto è del blocco in mano.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-lift");
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// Le parole della riga di «treno» che il doppio clic sceglie (i link no: il
/// clic li segue), nell'ordine della riga; l'ultima è quella della foto.
export const LINE_WORDS = ["Il", "parte", "alle", "otto", "il", "bus", "no", "Energia", "acqua", "da", "ricordare", "codice", "treno"];

/// Doppio clic su `word` nella riga di «treno» della panoramica: la selezione
/// dev'essere la parola e il suo disegno un rettangolo solo, largo quanto la
/// parola (#411 A-05). Se no lancia, con le larghezze viste.
export async function expectWordPainted(page, word) {
  // La bolla della parola di prima può coprire questa: la selezione si
  // chiude e la bolla se ne va prima di misurare.
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector(".selection-bubble:not([hidden])", { state: "detached" });
  // Il posto della parola si chiede alla vista per offset, non ai nodi di
  // testo: le parole uguali a quella scelta si evidenziano e spezzano i nodi.
  const target = await page.evaluate(async (wanted) => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const doc = view.state.doc;
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (!line.text.includes("treno")) continue;
      const match = new RegExp(`(?<!\\p{L})${wanted}(?!\\p{L})`, "u").exec(line.text);
      if (!match) return null;
      const start = view.coordsAtPos(line.from + match.index, 1);
      const end = view.coordsAtPos(line.from + match.index + wanted.length, -1);
      if (!start || !end) return null;
      return { x: (start.left + end.right) / 2, y: (start.top + start.bottom) / 2, width: end.right - start.left };
    }
    return null;
  }, word);
  if (!target) throw new Error(`la parola «${word}» non è nella riga di «treno»`);
  await page.mouse.dblclick(target.x, target.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const seen = await page.evaluate(async () => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const { from, to } = view.state.selection.main;
    const painted = [...document.querySelectorAll(".pane.focus .cm-selectionBackground")].map((b) => b.getBoundingClientRect().width);
    return { chosen: view.state.sliceDoc(from, to), painted };
  });
  if (seen.chosen !== word) throw new Error(`il doppio clic su «${word}» ha scelto «${seen.chosen}»`);
  // Un rettangolo solo, largo quanto la parola: il margine copre le marche
  // nascoste attorno alla parola (`==…==`), che la vista conta nei bordi.
  if (seen.painted.length !== 1 || Math.abs(seen.painted[0] - target.width) > 12) {
    throw new Error(`«${word}» (${Math.round(target.width)} px) si dipinge come ${seen.painted.map(Math.round).join(" + ") || "niente"} px`);
  }
}

export async function settleLive(page, bottom) {
  await page.waitForFunction(() => !["non_salvato", "in_corso"].includes(document.querySelector("#save-state")?.dataset.state ?? ""));
  await page.waitForFunction(() => !document.querySelector('.pane.focus .pane-editor .cm-content [data-state="loading"]'));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (!bottom) {
    await page.evaluate(async () => {
      if (globalThis.__fubLiveBench.cursor === null) return;
      const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
      const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
      // Da capo: col cursore già in vista CodeMirror non scorrerebbe, e
      // resterebbe lo scorrimento calcolato sull'impaginazione di prima.
      view.scrollDOM.scrollTop = 0;
      view.dispatch({ scrollIntoView: true });
    });
  }
  // Due fotogrammi: la misura di CodeMirror dopo l'ultima transazione.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// Porta in fondo la nota della Live a fuoco con un'impaginazione che non
/// dipende da come ci si è arrivati (#510).
///
/// CodeMirror disegna solo le righe vicine alla vista (il suo «viewport»); le
/// altre le conta con l'ultima altezza misurata o con una stima, e la Live
/// toglie le decorazioni di riga (i titoli) a ciò che esce dal viewport.
/// Scorrere subito in fondo dava così due impaginazioni, a seconda che il
/// viewport coprisse ancora la nota intera o no: quale delle due dipendeva da
/// quando le schede vive finivano di montarsi rispetto allo scorrimento, e le
/// righe in vista si spostavano di una frazione di pixel (la foto cambiava di
/// un pixel da un giro all'altro).
///
/// Qui la finestra si allunga finché la nota ci sta tutta: CodeMirror disegna
/// e misura ogni blocco, schede comprese, nel loro stato finale. Poi la
/// finestra torna com'era e si scorre in fondo: un viewport che copre la nota
/// intera resta valido (CodeMirror lo rifà solo se lascia scoperta la vista o
/// va troppo oltre), e la foto non dipende più dalla storia. Pronto è una
/// condizione, non un ritardo: la nota disegnata tutta, senza vuoti stimati
/// (`.cm-gap`), nessuna scheda in caricamento, l'altezza ferma e lo
/// scorrimento in fondo. Se non ci si arriva, si alza.
export async function scrollLiveToEnd(page) {
  const settled = () => page.evaluate(async () => {
    const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
    if (!scroller) throw new Error("la nota a fuoco non ha lo scorrimento di CodeMirror");
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const loading = () => scroller.querySelector('.live-card[data-card-state="loading"], [data-state="loading"]') !== null;
    // Misurata: l'altezza e lo scorrimento fermi per due fotogrammi, e
    // nessuna scheda che legge ancora il suo file.
    for (let tries = 0; tries < 100; tries += 1) {
      const before = [scroller.scrollHeight, scroller.scrollTop];
      await frame();
      await frame();
      if (!loading() && scroller.scrollHeight === before[0] && scroller.scrollTop === before[1]) {
        return {
          overflow: scroller.scrollHeight - scroller.clientHeight,
          gaps: scroller.querySelectorAll(".cm-content > .cm-gap").length,
          bottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
        };
      }
    }
    throw new Error("la nota non si ferma: CodeMirror rimisura a ogni fotogramma");
  });
  const window = page.viewportSize();
  if (!window) throw new Error("la pagina non ha una finestra fissa");
  let state = await settled();
  for (let tries = 0; state.overflow > 0 || state.gaps > 0; tries += 1) {
    if (tries >= 10) throw new Error(`la nota non sta in una finestra lunga: avanza di ${state.overflow} px con ${state.gaps} vuoti`);
    const { height } = page.viewportSize();
    await page.setViewportSize({ width: window.width, height: height + Math.max(state.overflow, 0) + 200 });
    state = await settled();
  }
  await page.setViewportSize(window);
  await settled();
  for (let tries = 0; ; tries += 1) {
    if (tries >= 10) throw new Error("la nota non resta in fondo: la sua altezza cambia a ogni giro");
    await page.evaluate(() => {
      const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
      scroller.scrollTop = scroller.scrollHeight;
    });
    state = await settled();
    if (state.bottom) break;
  }
  // In fondo la nota dev'essere ancora disegnata tutta: se CodeMirror avesse
  // rifatto il viewport, la foto tornerebbe a dipendere da quando.
  if (state.gaps > 0) throw new Error("in fondo la nota ha di nuovo dei vuoti stimati: è troppo lunga per questa preparazione");
}

/// Apre un documento di videoscrittura dall'albero e aspetta che la
/// superficie abbia montato la sua proiezione.
/// In una finestra stretta l'albero sta nel cassetto: lo si apre, e dopo la
/// scelta lo si richiude, perché la foto è del documento.
export async function openRichDocument(page, path) {
  await openFromTree(page, path, ".pane.focus .rich-surface .ProseMirror");
}

/// Apre `path` dall'albero e aspetta `ready`. In una finestra stretta l'albero
/// è un cassetto: lo apre prima e lo richiude dopo.
export async function openFromTree(page, path, ready) {
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await openFolder(page, path.slice(0, path.lastIndexOf("/")));
  await page.click(`#file-list .tree-row[data-path="${path}"]`);
  await page.waitForSelector(ready);
  if (compact) await closeSidebarDrawer(page);
}

/// Apre la lavagna `path` dall'albero e dà il fuoco alla lavagna, come un clic
/// nel vuoto: da lì parte il Tab delle scene `lavagna-*`.
export async function openBoard(page, path) {
  await openFromTree(page, path, ".pane.focus .canvas-viewport");
  await page.waitForFunction(
    () => document.querySelector(".pane.focus .canvas-viewport")?.dataset.canvasProtocol !== undefined
      || document.querySelector(".pane.focus .canvas-blank:not([hidden])") !== null,
  );
  await page.focus(".pane.focus .canvas-viewport");
}
