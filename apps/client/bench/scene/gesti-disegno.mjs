// I gesti delle scene: il disegno, la Lavagna, i PDF.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import { closeSidebarDrawer } from "./gesti-documenti.mjs";

/// Apre il disegno dei connettori e aspetta che sia dipinto, col fuoco sulla
/// tela.
export async function openDrawing(page) {
  const fixture = await page.evaluate(() => globalThis.__fubConnectorsBench?.fixture ?? null);
  if (fixture === null) throw new Error("la pagina non ha il disegno dei connettori");
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await page.click(`#file-list .tree-row[data-path="${fixture.doc}"]`);
  await page.waitForSelector(".draw-editor .draw-surface");
  if (compact) await closeSidebarDrawer(page);
  const objects = fixture.shapes.length + fixture.connectors.length + fixture.labels.length;
  await page.waitForFunction(
    (painted) => (document.querySelector(".draw-editor .draw-surface")?.querySelectorAll("[data-scene-id]").length ?? 0) >= painted,
    objects,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.focus(".draw-editor .draw-surface");
}

/// Apre il disegno dei connettori e preme il chip del disegno, che arriva
/// quando il motore ha risposto; con `ask` apre anche «Che cosa manca?». Il
/// fuoco resta nel riquadro, sull'ultimo pulsante premuto.
/// Il bottone «Spazio di lavoro» della banda (K6 T7), col suo menu aperto.
/// Il primo oggetto scelto da tastiera (`Home`), come lo sceglie chi usa la tastiera.
export async function scegliPrimo(page) {
  // `Home` sceglie il primo oggetto coi tasti di Fub. Col motore pronto i tasti
  // sono quelli di VectorCraft, che non hanno `Home`, e il motore può essere
  // pronto prima o dopo il tasto. Allora si sceglie l'ellisse, il primo
  // oggetto: col clic della Selezione del motore se la colonna ce l'ha, se no
  // (l'indice di prova non ha strumenti) dalla scheda Livelli. La barra di
  // stato dice «1 di N scelti» quando la scelta c'è; una scena senza la barra
  // resta com'era: un tasto e 300 ms.
  await page.focus(".draw-editor .draw-surface");
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  if (!(await page.$('[data-surface-item="objects"]'))) return;
  const scelta = () => page
    .waitForFunction(() => /\bscelt|selected/.test(document.querySelector('[data-surface-item="objects"]')?.textContent ?? ""), null, { timeout: 1500 })
    .then(() => true, () => false);
  if (await scelta()) return;
  const conStrumentiDelMotore = await page.evaluate(() => [...document.querySelectorAll(".draw-rail button")]
    .some((b) => `${b.dataset.tool ?? ""} ${b.dataset.tools ?? ""}`.includes("motore:")));
  if (conStrumentiDelMotore) {
    await sceltaConIlClic(page).catch(() => undefined);
    return;
  }
  // Coi tasti di Fub ancora validi un Home arrivato troppo presto si perde.
  await page.focus(".draw-editor .draw-surface");
  await page.keyboard.press("Home");
  if (await scelta()) return;
  await sceltaDaiLivelli(page);
}

/// L'ellisse scelta dalla sua riga nella scheda Livelli, che vale con
/// qualunque strumento; poi torna la scheda di prima (e il cassetto
/// dell'ispettore chiuso, sotto i 960 px) e il mouse esce dal foglio.
export async function sceltaDaiLivelli(page) {
  const id = await page.evaluate(() => document.querySelector(".draw-editor .draw-surface ellipse[data-scene-id]")?.dataset.sceneId ?? null);
  if (id === null) throw new Error("l'ellisse del disegno non c'è");
  const primaScheda = await page.evaluate(() => document.querySelector('.inspector-tab[aria-selected="true"]')?.dataset.viewId ?? null);
  const cassettoChiuso = await page.evaluate(() => window.innerWidth < 960 && document.querySelector('#toggle-inspector[aria-pressed="true"]') === null);
  await schedaLivelli(page);
  await page.click(`.draw-objects-tree .draw-object[data-key="${id}"] .draw-object-label`);
  await page.waitForFunction(() => /\b1 di \d+ scelt/.test(document.body.innerText), null, { timeout: 4000 }).catch(() => {
    throw new Error("la riga dell'ellisse nei Livelli non la sceglie");
  });
  if (primaScheda !== null && primaScheda !== "draw.layers") await page.click(`.inspector-tab[data-view-id="${primaScheda}"]`);
  if (cassettoChiuso) {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="false"]');
  }
  await mouseFuori(page);
  // Il fuoco torna sul foglio, dove l'avrebbe lasciato `Home`, e l'ultimo
  // gesto è un tasto, come con `Home`: i menu aperti dopo mostrano l'anello
  // del fuoco allo stesso modo. Il tasto non cambia la scelta: coi tasti di
  // Fub sceglie di nuovo l'ellisse, col motore pronto non vale.
  await page.focus(".draw-editor .draw-surface");
  await page.keyboard.press("Home");
}

/// Il menu ≡ del Completo con Oggetto aperto (K6 T9a): le voci dell'indice di
/// prova. Si apre col pulsante, poi si va su Oggetto col mouse, come chi usa il
/// mouse: il sottomenu si apre di lato.
export async function openMenuOggetto(page) {
  await openDrawing(page);
  // Un oggetto scelto, come nello stato «un punto scelto» del prototipo. Con
  // la tastiera: il menu che si apre dopo mostra l'anello del fuoco di chi usa
  // la tastiera (WCAG 2.4.7). Col mouse, senza tastiera, non c'è (misurato).
  await scegliPrimo(page);
  // Il menu si costruisce quando si apre. Prima che il motore sia pronto «Cerca un
  // comando…» porta ancora «Ctrl /», che col motore è un altro comando
  // (`toolbar.ts`): la voce più larga cambia e il menu con lei (conformità,
  // «menu.voce.aperta»). Il menu aperto troppo presto si chiude e si riapre.
  for (let prova = 0; ; prova += 1) {
    await page.click(".draw-header button[aria-label=\"Disegno\"]");
    await page.waitForSelector("#context-menu [role='menuitem']:has-text('Oggetto')");
    const conTasto = await page.locator("#context-menu [role='menuitem']:has-text('Cerca un comando') .kit-row-keys").count();
    if (conTasto === 0) break;
    if (prova === 10) throw new Error("il motore del Completo non è pronto: «Cerca un comando…» porta ancora il tasto");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#context-menu", { state: "hidden", timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await page.hover("#context-menu [role='menuitem']:has-text('Oggetto')");
  // Il terzo livello (K6 T9c): Oggetto › Tracciato, aperto come nel prototipo.
  await page.waitForSelector(".context-submenu [role='menuitem']:has-text('Tracciato')");
  await page.hover(".context-submenu [role='menuitem']:has-text('Tracciato')");
  await page.waitForSelector(".context-submenu [role='menuitem']:has-text('Sposta tracciato')");
  await page.evaluate(() => document.fonts.ready);
}

/// La ricerca dei comandi dal menu ≡: col motore Ctrl+/ è «Aggiungi nuovo riempimento»,
/// come in VectorCraft, e la ricerca si apre solo dal menu.
export async function apriRicercaComandi(page) {
  await page.click('.draw-header button[aria-label="Disegno"]');
  await page.locator("#context-menu [role='menuitem']", { hasText: "Cerca un comando" }).first().click();
  await page.waitForSelector(".draw-commands-dialog .draw-commands-row");
}

/// La tavolozza del menu ≡ con la ricerca «sposta» (K6 T9a): le voci che
/// cominciano così, col loro posto, il tasto e il perché di quella spenta.
export async function openTavolozza(page) {
  await openDrawing(page);
  // Un oggetto scelto, come nello stato «un punto scelto» del prototipo.
  await scegliPrimo(page);
  await apriRicercaComandi(page);
  await page.fill(".draw-commands-dialog .draw-commands-field input", "sposta");
  await page.waitForFunction(() => document.querySelectorAll(".draw-commands-dialog .draw-commands-row").length >= 5);
  await page.evaluate(() => document.fonts.ready);
}

/// Impostazioni › Scorciatoie con la sezione «Disegno completo» aperta e
/// portata in cima.
export async function openDrawingKeys(page) {
  await page.click("#open-settings");
  await page.click('#settings-tabs button[data-tab="shortcuts"]');
  await page.waitForSelector("#settings-body details.drawing-keys > summary");
  await page.click("#settings-body details.drawing-keys > summary");
  await page.waitForSelector('#settings-body .setting-row[data-setting-key="draw.keys:draw.path.reverse"]');
  await page.$eval("#settings-body details.drawing-keys", (details) => details.closest("section")?.scrollIntoView({ block: "start" }));
  await page.evaluate(() => document.fonts.ready);
}

/// Impostazioni con il riquadro «Motore del disegno» aperto, la categoria
/// «Guide e griglia» aperta e il riquadro portato in cima.
export async function openEnginePrefs(page) {
  await page.click("#open-settings");
  const riquadro = '#settings-body details[data-details-key="drawing-engine"]';
  await page.waitForSelector(`${riquadro} > summary`);
  await page.click(`${riquadro} > summary`);
  const griglia = `${riquadro} details[data-details-key="drawing-engine:Guides & Grid"]`;
  await page.waitForSelector(`${griglia} > summary`);
  await page.click(`${griglia} > summary`);
  await page.waitForSelector(`${griglia}[open] .kit-form`);
  await page.$eval(riquadro, (details) => details.scrollIntoView({ block: "start" }));
  await page.evaluate(() => document.fonts.ready);
}

/// La stessa sezione dopo «Importa un insieme…» con un file che non è JSON.
export async function importBrokenKeySet(page) {
  await openDrawingKeys(page);
  const chooser = page.waitForEvent("filechooser");
  await page.click("#settings-body .drawing-keys-set button:first-of-type");
  await (await chooser).setFiles({ name: "tasti.json", mimeType: "application/json", buffer: Buffer.from("{non è json") });
  await page.waitForSelector('#settings-body .drawing-keys [role="alert"]');
  await page.$eval("#settings-body details.drawing-keys", (details) => details.closest("section")?.scrollIntoView({ block: "start" }));
}

export async function openWorkspaceMenu(page) {
  await openDrawing(page);
  await page.waitForSelector("#status-workspace:not([hidden])");
  await page.click("#status-workspace");
  await page.waitForSelector("#context-menu [role='menuitemradio']");
}

/// Il Completo che non si carica (K6 T7): il modulo del suo ingresso non
/// arriva, e il menu dello spazio dice che non si è caricato, con «Riprova».
export async function openWorkspaceErrorMenu(page) {
  await page.route("**/completo/index.ts*", (route) => route.abort());
  await openWorkspaceMenu(page);
  await page.waitForSelector("#context-menu [role='menuitem']:has-text('Riprova')");
}

/// La tendina della casella a più strumenti (K6 T8): la matita, con la freccia
/// di lato da tastiera, come la apre chi usa la tastiera.
export async function openColumnGroup(page) {
  await openDrawing(page);
  // La prima casella con il triangolino: quella che ha più strumenti.
  await apriTendina(page, ".draw-rail .kit-rail-slot:has(.kit-rail-corner)");
}

/// La tendina della casella `casella` (un selettore) con la freccia di lato:
/// destra in colonna, su in fila (il foglio stretto). La colonna si rifà
/// quando il motore diventa pronto (o spento): un tasto arrivato sulla
/// casella di prima si perde, o la tendina si chiude, e allora si ripreme, al
/// più tre volte.
export async function apriTendina(page, casella) {
  for (let prova = 0; prova < 3; prova += 1) {
    await page.waitForSelector(casella);
    await page.focus(casella);
    await page.evaluate((selettore) => {
      const el = document.querySelector(selettore);
      const lato = el.closest(".kit-rail").dataset.orientation === "horizontal" ? "ArrowUp" : "ArrowRight";
      el.dispatchEvent(new KeyboardEvent("keydown", { key: lato, bubbles: true, cancelable: true }));
    }, casella);
    const voce = ".kit-rail-flyout [role='menuitemradio']";
    const aperta = await page.waitForSelector(voce, { timeout: 5000 }).then(() => true, () => false);
    if (!aperta) continue;
    // Una colonna che si rifà dopo chiude anche la tendina appena aperta.
    await page.waitForTimeout(500);
    if (await page.locator(voce).first().isVisible()) return;
  }
  throw new Error(`la tendina di ${casella} non si apre`);
}

/// La Selezione diretta del motore (K6 T11) scelta dalla sua casella: la
/// casella si accende quando la famiglia è pronta.
export async function scegliSelezioneDiretta(page) {
  await openDrawing(page);
  const casella = '.draw-rail .kit-rail-slot[data-slot="motore:directSelection"]';
  await page.waitForSelector(casella);
  await page.click(casella);
  await page.waitForSelector(`${casella}[aria-pressed="true"], ${casella} [aria-pressed="true"], ${casella}.is-active, ${casella}[data-active]`, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

/// Il menu dello zoom della banda (K6 T11): la sua voce, aperta come la apre chi
/// preme; il fuoco va alla prima voce.
export async function openZoomMenu(page) {
  await openDrawing(page);
  // Il menu c'è solo col Completo presente: si aspettano le sue caselle del motore.
  await page.waitForSelector('.draw-rail .kit-rail-slot[data-slot="motore:directSelection"]');
  await page.waitForSelector('[data-surface-item="zoom"]');
  await page.click('[data-surface-item="zoom"]');
  await page.waitForSelector(".draw-zoom-popover .draw-zoom-item");
  await page.evaluate(() => document.fonts.ready);
}

/// La tendina della casella `slot` della colonna (K6 T12), aperta con la
/// freccia di lato come fa chi usa la tastiera.
export async function openRailFlyout(page, slot) {
  await openDrawing(page);
  await apriTendina(page, `.draw-rail .kit-rail-slot[data-slot="${slot}"]`);
}

/// La casella delle forme della colonna (K6 T13): quella di Rettangolo. La sua
/// prima voce è di Fub (`rect`) o del motore (`motore:rectangle`): si legge dal DOM.
export async function openFormeTendina(page) {
  await openDrawing(page);
  // Prima le caselle del motore: finché non arrivano la casella è quella di Fub, `rect`, che poi
  // lascia il posto a `motore:rectangle`.
  await page.waitForSelector('.draw-rail .kit-rail-slot[data-slot="motore:directSelection"]');
  const selettore = '.draw-rail .kit-rail-slot[data-slot="motore:rectangle"], .draw-rail .kit-rail-slot[data-slot="rect"]';
  await page.waitForSelector(selettore);
  const slot = await page.evaluate((sel) => document.querySelector(sel).dataset.slot, selettore);
  await openRailFlyout(page, slot);
  await page.evaluate(() => document.fonts.ready);
}

/// La finestra delle misure del Rettangolo (K6 T13, giro 2): la voce «Rettangolo (Completo)»
/// della tendina della casella `rect`, poi un clic sul foglio. È il clic sul foglio ad
/// aprirla, come nel Completo: la sola scelta dalla tendina non apre niente.
export async function openFormeFinestra(page) {
  await openFormeTendina(page);
  await page.locator(".kit-rail-flyout [role='menuitemradio']", { hasText: "Rettangolo (Completo)" }).first().click();
  const foglio = await page.locator(".draw-editor .draw-surface").first().boundingBox();
  if (!foglio) throw new Error("il foglio del disegno non c'è");
  await page.mouse.click(foglio.x + foglio.width / 2, foglio.y + foglio.height / 2);
  await page.waitForSelector(".kit-dialog.draw-effect-dialog .kit-number-input");
  await page.waitForSelector('.kit-dialog.draw-effect-dialog [data-action="ok"]:not([disabled])');
  await page.evaluate(() => document.fonts.ready);
}

/// La sezione Allinea nel Design (K6 T13, giro 2) con il disegno scelto per intero:
/// la scheda Design, poi Ctrl+A, come chi allinea una selezione. Sotto i 960 px
/// l'ispettore è un cassetto che si apre dal suo pulsante: lì il disegno si sceglie
/// a cassetto chiuso, poi si apre il cassetto e la scheda Design.
export async function openSezioneDesign(page, selettore) {
  if (await page.evaluate(() => window.innerWidth >= 960)) {
    await openDesignoScelto(page);
  } else {
    await openDrawing(page);
    await page.click(SELEZIONE_DELLA_ROTAIA);
    const foglio = await page.locator(".draw-editor .draw-surface").first().boundingBox();
    if (!foglio) throw new Error("il foglio del disegno non c'è");
    await page.mouse.click(foglio.x + 30, foglio.y + 30);
    await page.keyboard.press("Control+a");
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="true"]');
    await page.click('.inspector-tab[data-view-id="draw.design"]');
    await page.waitForSelector('#surface-panel-draw-design:not([hidden]) section.draw-properties');
    await page.waitForFunction(() => {
      const soggetto = document.querySelector("#surface-panel-draw-design .draw-properties-subject");
      return soggetto !== null && soggetto.textContent.trim() !== "" && !soggetto.textContent.includes("Il disegno");
    });
  }
  await page.waitForSelector(selettore);
  await page.evaluate(() => document.fonts.ready);
  await scorriInCima(page, selettore);
}

/// La sezione `selettore` in cima al pannello che la contiene.
export async function scorriInCima(page, selettore) {
  // Scorre solo il primo contenitore scrollabile sopra la sezione (il pannello), non la pagina.
  // Il pannello si rifà quando arriva il motore (sezioni nuove sopra): si riscorre finché la
  // sezione resta in cima per due controlli di fila, al più dieci volte.
  const scorri = () =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) {
          const scarto = el.getBoundingClientRect().top - p.getBoundingClientRect().top - 8;
          p.scrollTop += scarto;
          return `${Math.round(scarto)}:${p.scrollHeight}`;
        }
      }
      return "0:0";
    }, selettore);
  let prima = await scorri();
  for (let prova = 0; prova < 10; prova += 1) {
    await page.waitForTimeout(250);
    const ora = await scorri();
    if (ora !== null && ora === prima) return;
    prima = ora;
  }
}

/// La sezione Allinea nel Design (K6 T13, giro 2) con il disegno scelto per intero.
export async function openAllinea(page) {
  await openSezioneDesign(page, ".draw-align-to");
}

/// La sezione Trasforma nel Design (K6 T13, giro 3) con il disegno scelto per intero.
export async function openTrasformaSezione(page) {
  await openSezioneDesign(page, ".draw-transform-grid");
}

/// La scheda Livelli in vista, sotto i 960 px nel cassetto dell'ispettore come per le sezioni.
export async function schedaLivelli(page) {
  if (await page.evaluate(() => window.innerWidth < 960)) {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="true"]');
  }
  await page.click('.inspector-tab[data-view-id="draw.layers"]');
  await page.waitForSelector('.draw-objects-tree .draw-object[aria-level="1"]');
}

/// La riga del livello che si chiama `nome` nella scheda Livelli: la riga mostra il solo nome, e il nome
/// accessibile dice «Livello «nome»» (`aria-label`, da `tree.ts`).
export const rigaDelLivello = (nome) => `.draw-objects-tree .draw-object[aria-level="1"][aria-label^="Livello «${nome}»"]`;

/// La scheda Livelli del Completo (K6 T15, giro 4): il disegno aperto, la scheda Livelli in vista, e un livello
/// nuovo dal menu dei livelli, che passa dal motore del banco e va in cima. Livello 1 resta aperto coi suoi oggetti.
export async function openLivelli(page) {
  await openDrawing(page);
  await schedaLivelli(page);
  // Nel Completo «Nuovo livello» sta nel menu della scheda Livelli, come in VectorCraft.
  await page.click(".draw-objects-menu:visible");
  await page.click(`#context-menu [role^="menuitem"]:has-text("Nuovo livello")`);
  await page.waitForSelector(rigaDelLivello("Livello 2"));
  await page.evaluate(() => document.fonts.ready);
}

/// Due livelli, poi «Livello 2» rinominato «Sfondo» col doppio clic e bloccato col lucchetto della riga, e
/// «Livello 1» nascosto con l'occhio: ogni comando passa dal motore del banco.
export async function livelliCambiati(page) {
  await openLivelli(page);
  await page.dblclick(`${rigaDelLivello("Livello 2")} .draw-object-label`);
  await page.waitForSelector(".draw-object-rename");
  await page.fill(".draw-object-rename", "Sfondo");
  await page.keyboard.press("Enter");
  await page.waitForSelector(rigaDelLivello("Sfondo"));
  // I segni si vedono col puntatore sulla riga, come nel pannello degli oggetti.
  await page.hover(rigaDelLivello("Sfondo"));
  await page.click(`${rigaDelLivello("Sfondo")} [data-sign="lock"]`);
  await page.waitForSelector(`${rigaDelLivello("Sfondo")} [data-sign="lock"][data-on]`);
  await page.hover(rigaDelLivello("Livello 1"));
  await page.click(`${rigaDelLivello("Livello 1")} [data-sign="hide"]`);
  await page.waitForSelector(`${rigaDelLivello("Livello 1")} [data-sign="hide"][data-on]`);
  await page.evaluate(() => document.fonts.ready);
}

/// Due livelli e il filtro «Ellisse»: restano l'ellisse e i connettori che ne partono, dentro il loro livello.
export async function livelliFiltrati(page) {
  await openLivelli(page);
  await page.fill(".draw-objects-search", "Ellisse");
  await page.waitForFunction(() => document.querySelectorAll(".draw-objects-tree .draw-object").length < 8);
  await page.evaluate(() => document.fonts.ready);
}

/// Il Design del Completo con un oggetto scelto (K6 T13, giro 4): la scheda Design, poi la sezione
/// `selettore` portata in vista. Sotto i 960 px l'ispettore è un cassetto, come per le altre sezioni.
export async function openSezioneConUno(page, selettore, sceglie = scegliPrimo) {
  await openDrawing(page);
  await sceglie(page);
  if (await page.evaluate(() => window.innerWidth >= 960)) {
    await page.click('.inspector-tab[data-view-id="draw.design"]');
  } else {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="true"]');
    await page.click('.inspector-tab[data-view-id="draw.design"]');
  }
  await page.waitForSelector('#surface-panel-draw-design:not([hidden]) section.draw-properties');
  await page.waitForFunction(() => {
    const soggetto = document.querySelector("#surface-panel-draw-design .draw-properties-subject");
    return soggetto !== null && soggetto.textContent.trim() !== "" && !soggetto.textContent.includes("Il disegno");
  });
  await page.waitForSelector(selettore);
  await page.evaluate(() => document.fonts.ready);
  await scorriInCima(page, selettore);
}

/// Le due forme sovrapposte di `?elabora=1` scelte col clic (il rettangolo, poi il cerchio con
/// Maiusc), e la sezione «Elaborazione tracciati» del Design in vista (K6 T12, giro 5). Con
/// `voce`, il pulsante della voce premuto: la scena aspetta che le due forme lascino il posto
/// al tracciato del banco. Sotto i 960 px il cassetto copre il foglio: dopo il clic, o con
/// `foglio`, si chiude, perché la foto mostri il disegno.
export async function openElaborazione(page, voce = null, { foglio = false } = {}) {
  await sceltaElaborazione(page, voce);
  const stretta = await page.evaluate(() => window.innerWidth < 960);
  if (stretta && (foglio || voce !== null)) {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="false"]');
  }
  await page.evaluate(() => document.fonts.ready);
}

export async function sceltaElaborazione(page, voce) {
  const scegliDue = async (p) => {
    await selezioneDelMotore(p);
    for (const [id, maiusc] of [["o0000001a", false], ["o0000001b", true]]) {
      const forma = await p.locator(`.draw-editor .draw-surface [data-scene-id="${id}"]`).first().boundingBox();
      if (!forma) throw new Error(`la forma ${id} del disegno non c'è`);
      // Il rettangolo si prende nell'angolo che il cerchio non copre.
      const [x, y] = maiusc ? [forma.x + forma.width * 0.75, forma.y + forma.height * 0.75] : [forma.x + 12, forma.y + 12];
      if (maiusc) await p.keyboard.down("Shift");
      await p.mouse.click(x, y);
      if (maiusc) await p.keyboard.up("Shift");
      // Col motore la scelta torna dopo il gesto: il clic con Maiusc parte da quella del primo.
      if (!maiusc) await p.waitForFunction(() => /\b1 di \d+ scelt/.test(document.body.innerText), null, { timeout: 4000 }).catch(() => {});
    }
    await mouseFuori(p);
    await p.waitForFunction(() => /\b2 di \d+ scelt/.test(document.body.innerText), null, { timeout: 4000 }).catch(() => {
      throw new Error("il clic con Maiusc non sceglie le due forme");
    });
  };
  await openSezioneConUno(page, '#surface-panel-draw-design [data-section="pathfinder"]', scegliDue);
  if (voce === null) return;
  await page.click(`#surface-panel-draw-design button[data-id="${voce}"]`);
  await page.waitForFunction(
    () => document.querySelector('.draw-editor .draw-surface [data-scene-id="o0000001c"]') !== null
      && document.querySelector('.draw-editor .draw-surface [data-scene-id="o0000001a"]') === null,
    null,
    { timeout: 6000 },
  ).catch(() => {
    throw new Error("il tracciato dell'elaborazione non arriva sul foglio");
  });
  await page.evaluate(() => document.fonts.ready);
}

/// Risorse › Campioni (K6 T14, giro 2): la scheda Risorse, nel cassetto sotto i 960 px, e il terzo
/// campione scelto col clic (senza selezione non parte niente).
export async function openCampioni(page) {
  await openDrawing(page);
  if (await page.evaluate(() => window.innerWidth < 960)) {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="true"]');
  }
  await page.click('.inspector-tab[data-view-id="draw.resources"]');
  await page.waitForSelector("#surface-panel-draw-resources:not([hidden]) .draw-resources-swatches .kit-color-swatch");
  await page.locator("#surface-panel-draw-resources .draw-resources-swatches .kit-color-swatch").nth(2).click();
  await page.waitForSelector('#surface-panel-draw-resources .kit-color-swatch[aria-pressed="true"]');
  await page.evaluate(() => document.fonts.ready);
}

/// La finestra «Nuovo campione» (K6 T14, giro 2): «Nuovo…» di Risorse › Campioni, col nome scritto.
export async function openNuovoCampione(page) {
  await openCampioni(page);
  await page.click('#surface-panel-draw-resources .draw-resources-swatches-actions [data-action="nuovo"]');
  await page.waitForSelector(".kit-dialog.draw-resources-swatches-dialog input");
  await page.fill(".kit-dialog.draw-resources-swatches-dialog input", "Verde salvia");
  await page.evaluate(() => document.fonts.ready);
}

/// La sezione Colore con un testo scelto (K6 T14, giro 2): il titolo del Testo del Completo, poi Colore
/// in vista. Il testo non ha contorno: il pozzo dice «Nessuno», spento, non «Misto».
export async function openColoreTesto(page) {
  await openSezioniTesto(page);
  await page.waitForSelector("#surface-panel-draw-design .draw-color");
  await page.locator("#surface-panel-draw-design .draw-color").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
}

/// Carattere e Paragrafo del Design (K6 T16, giro 1): un titolo scritto col Testo del Completo, che
/// Esc conferma e lascia scelto, poi la scheda Design; sotto i 960 px l'ispettore è un cassetto.
/// Carattere in vista.
export async function openSezioniTesto(page) {
  await scriviColTesto(page);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("textarea.draw-scrittura") === null);
  if (await page.evaluate(() => window.innerWidth < 960)) {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="true"]');
  }
  await page.click('.inspector-tab[data-view-id="draw.design"]');
  await page.waitForSelector("#surface-panel-draw-design:not([hidden]) .draw-type .kit-font-button");
  await page.locator("#surface-panel-draw-design .draw-type").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
}

/// Il Testo del Completo (K6 T16, giro 1): la voce «Testo (Completo)» della casella del testo, un
/// clic sul foglio vuoto e due righe scritte con la tastiera; la casella resta aperta.
export async function scriviColTesto(page) {
  await openDrawing(page);
  // La casella del testo ha la tendina solo quando le caselle del motore sono arrivate: prima è
  // quella del Testo di Fub, da sola.
  await page.waitForSelector('.draw-rail .kit-rail-slot[data-slot="motore:directSelection"]');
  // La casella del testo mostra il Testo del Completo, `motore:type`.
  await openRailFlyout(page, "motore:type");
  await page.click(".kit-rail-flyout [role='menuitemradio'][data-item='motore:type'], .kit-rail-flyout [role='menuitemradio']:has-text('Testo (Completo)')");
  const foglio = await page.locator(".draw-editor .draw-surface").boundingBox();
  await page.mouse.click(foglio.x + foglio.width * 0.3, foglio.y + foglio.height * 0.7);
  await page.waitForSelector("textarea.draw-scrittura");
  await page.keyboard.type("Città già scritta");
  await page.keyboard.press("Enter");
  await page.keyboard.type("seconda riga");
  await page.waitForFunction(() => (document.querySelector(".draw-editor .draw-surface")?.textContent ?? "").includes("seconda riga"));
  await page.evaluate(() => document.fonts.ready);
}

/// La finestra «Ruota…» di Oggetto › Trasforma (K6 T13, giro 3): il disegno scelto per intero, poi
/// il comando dal menu ≡, come chi lo usa col mouse. La finestra ha l'angolo, l'anteprima e OK.
export async function openRuotaFinestra(page) {
  // Il disegno aperto e un oggetto scelto, come il menu ≡ di Oggetto (openMenuOggetto).
  await openDrawing(page);
  await scegliPrimo(page);
  await page.click('.draw-header button[aria-label="Disegno"]');
  await page.waitForSelector("#context-menu [role='menuitem']:has-text('Oggetto')");
  await page.hover("#context-menu [role='menuitem']:has-text('Oggetto')");
  await page.waitForSelector(".context-submenu [role='menuitem']:has-text('Trasforma')");
  await page.hover(".context-submenu [role='menuitem']:has-text('Trasforma')");
  await page.waitForSelector(".context-submenu [role='menuitem']:has-text('Ruota')");
  // Il clic sulla voce del sottomenu è quello dell'elemento: il menu si chiude a ogni movimento del puntatore.
  await page.evaluate(() => [...document.querySelectorAll(".context-submenu [role='menuitem']")].find((el) => el.textContent.includes("Ruota")).click());
  await page.waitForSelector(".kit-dialog.draw-effect-dialog .kit-number-input");
  await page.waitForSelector('.kit-dialog.draw-effect-dialog [data-action="ok"]:not([disabled])');
  await page.evaluate(() => document.fonts.ready);
}

/// Il menu ≡ del Completo con ≡ › Selezione › Uguale aperto, con l'ellisse scelta (K6 T15, giro 1).
/// Uguale vuole un oggetto scelto: «Colore tratto» e le altre voci valgono, e «Istanza di simbolo»
/// è spenta col perché del motore. Se l'ellisse non è scelta la scena si ferma: una foto con tutto
/// spento direbbe una cosa falsa.
export async function openMenuUguale(page) {
  await openDrawing(page);
  // Il primo oggetto, l'ellisse, scelto da tastiera come in openMenuOggetto (K6 T15 giro 1: prima del
  // giro 2 il clic del mouse sul banco non sceglieva, e il clic ora lo fa: `clicSullEllisse`).
  // Lo strumento di selezione col tasto «v», come nella scena «draw-selection»: la penna resterebbe attiva.
  await selezioneDelMotore(page);
  await scegliPrimo(page);
  await page.click('.draw-header button[aria-label="Disegno"]');
  await page.waitForSelector("#context-menu [role='menuitem']:has-text('Selezione')");
  await page.hover("#context-menu [role='menuitem']:has-text('Selezione')");
  // La voce che si chiama «Uguale», non una che la nomina: il perché di «Riseleziona» spenta la cita,
  // sta prima, e `:has-text` sceglieva lei.
  const uguale = page.locator(".context-submenu [role='menuitem']").filter({ hasText: /^Uguale/ });
  await uguale.waitFor();
  await uguale.hover();
  await page.waitForSelector(".context-submenu [role='menuitem']:has-text('Colore tratto')");
  const scelta = await page.evaluate(() => {
    const voce = [...document.querySelectorAll(".context-submenu [role='menuitem']")].find((el) => el.textContent.includes("Colore tratto"));
    return voce !== undefined && !voce.textContent.includes("Scegli un oggetto.");
  });
  if (!scelta) throw new Error("l'ellisse non è scelta: le voci di Uguale restano spente");
  await page.evaluate(() => document.fonts.ready);
}

/// «Uguale › Colore tratto» sul foglio: l'ellisse e le due linee con lo stesso tratto scelte insieme
/// (K6 T15, giro 1). Il clic sulla voce è quello dell'elemento: il menu si chiude a ogni movimento del
/// puntatore, come in Oggetto › Trasforma.
export async function openUgualeTratto(page) {
  await openMenuUguale(page);
  await page.evaluate(() => [...document.querySelectorAll(".context-submenu [role='menuitem']")].find((el) => el.textContent.includes("Colore tratto")).click());
  await page.waitForTimeout(600);
  await page.evaluate(() => document.fonts.ready);
}

/// La finestra «Satura…» di Modifica › Modifica colori (K6 T14, giro 1) da Ctrl+/ con la prima forma
/// scelta: l'intensità in %, e l'anteprima che il banco risponde (`disegno-famiglie/colore.json`).
export async function openSaturaFinestra(page) {
  await openDrawing(page);
  await scegliPrimo(page);
  await apriRicercaComandi(page);
  await page.fill(".draw-commands-dialog .draw-commands-field input", "satura");
  await page.locator(".draw-commands-dialog .draw-commands-row", { hasText: "Satura…" }).first().click();
  await page.waitForSelector(".kit-dialog.draw-effect-dialog .kit-number-input");
  await page.fill(".kit-dialog.draw-effect-dialog .kit-number-input", "40");
  await page.keyboard.press("Tab");
  await page.waitForSelector('.kit-dialog.draw-effect-dialog [data-action="ok"]:not([disabled])');
  await page.waitForTimeout(400);
  await page.evaluate(() => document.fonts.ready);
}

/// Un clic del mouse sul centro dell'ellisse del disegno, la prima forma (K6 T15, giro 2).
export async function sceltaEllisse(page) {
  const forma = await page.locator(".draw-editor .draw-surface ellipse[data-scene-id]").first().boundingBox();
  if (!forma) throw new Error("l'ellisse del disegno non c'è");
  await page.mouse.click(forma.x + forma.width / 2, forma.y + forma.height / 2);
  await mouseFuori(page);
}

/// Il tasto «v» sceglie la Selezione. Col motore pronto è quella del motore, e
/// la colonna la accende (`motore:…`); se il motore non è ancora pronto il
/// tasto sceglie quella di Fub, che disegna un'altra cornice: allora si
/// riprova, al più tre volte. Una scena dove il motore non c'è resta con la
/// Selezione di Fub, com'era. Vero se la Selezione del motore è accesa.
export async function selezioneDelMotore(page) {
  for (let prova = 0; prova < 3; prova += 1) {
    await page.focus(".draw-editor .draw-surface");
    await page.keyboard.press("v");
    const accesa = await page
      .waitForFunction(
        () => [...document.querySelectorAll('.draw-rail button[aria-pressed="true"]')]
          .some((b) => `${b.dataset.tool ?? ""} ${b.dataset.tools ?? ""}`.includes("motore:")),
        null,
        { timeout: 2000 },
      )
      .then(() => true, () => false);
    if (accesa) return true;
  }
  return false;
}

/// Il mouse esce dal foglio, appena sopra il suo bordo: fermo sull'oggetto, il
/// motore ci disegna i segni del passaggio (la misura) solo se la risposta
/// arriva prima dello scatto, e la foto cambierebbe da una corsa all'altra.
export async function mouseFuori(page) {
  const foglio = await page.locator(".draw-editor .draw-surface").first().boundingBox();
  if (!foglio) return;
  await page.mouse.move(foglio.x + foglio.width / 2, Math.max(0, foglio.y - 4));
  await page.waitForTimeout(150);
}

/// Il clic del mouse sull'ellisse la sceglie: la barra di stato dice «1 di 11 scelti». Se il clic non
/// sceglie, la scena si ferma: così il banco prova che il clic funziona (K6 T15, giro 2).
export async function clicSullEllisse(page) {
  await openDrawing(page);
  await sceltaConIlClic(page);
  await page.evaluate(() => document.fonts.ready);
}

/// Lo stesso clic nello spazio Semplice: la scelta passa dallo stesso motore, e la barra dice «1 di 11
/// scelti» come nel Completo (K6 T15, giro 2).
export async function clicSullEllisseSemplice(page) {
  await openDrawing(page);
  await page.click("#status-workspace");
  await page.waitForSelector("#context-menu [role='menuitemradio']:has-text('Semplice')");
  await page.click("#context-menu [role='menuitemradio']:has-text('Semplice')");
  await page.waitForTimeout(1500);
  await page.waitForSelector(".draw-editor .draw-surface ellipse[data-scene-id]", { timeout: 15000 });
  await sceltaConIlClic(page);
  await page.evaluate(() => document.fonts.ready);
}

/// Lo strumento di selezione e il clic sull'ellisse, che la barra di stato deve dire scelta (K6 T15, giro 2).
export async function sceltaConIlClic(page) {
  await selezioneDelMotore(page);
  await sceltaEllisse(page);
  await page.waitForFunction(() => /\b1 di \d+ scelt/.test(document.body.innerText), null, { timeout: 4000 }).catch(() => {
    throw new Error("il clic sull'ellisse non la sceglie");
  });
}

/// La Selezione diretta del motore con un punto scelto (K6 T12, `?punti=1`):
/// la fila dei punti in testata, coi pulsanti accesi e la posizione.
export async function scegliSelezioneDirettaCoiPunti(page) {
  await scegliSelezioneDiretta(page);
  // La posizione può stare nel «…» della riga: basta che ci sia.
  await page.waitForSelector(".draw-point-place .draw-point-coord input", { state: "attached" });
  await page.waitForFunction(() => document.querySelector(".draw-point-coord input")?.value !== "");
}

/// La sezione «Punto di ancoraggio» del Design (K6 T12, giro 4): la Selezione
/// diretta con un punto scelto, poi la scheda Design; sotto i 960 px l'ispettore
/// è un cassetto, che si apre dal suo pulsante.
export async function openSezionePunto(page) {
  await scegliSelezioneDirettaCoiPunti(page);
  if (await page.evaluate(() => window.innerWidth < 960)) {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="true"]');
  }
  await page.click('.inspector-tab[data-view-id="draw.design"]');
  const sezione = '#surface-panel-draw-design:not([hidden]) .draw-properties-section[data-section="anchor"]';
  await page.waitForSelector(`${sezione} .draw-properties-segment:not([aria-disabled])`);
  // La sezione sta sotto Proprietà e Documento: la si porta in vista, come chi scorre.
  await page.locator(sezione).scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
}

/// Sposta tracciato (K6 T12, giro 4) da Ctrl+/ con la prima forma scelta: la
/// finestra con l'anteprima che il banco risponde (`disegno-famiglie/tracciati.json`).
export async function openSpostaTracciato(page) {
  await openDrawing(page);
  await page.waitForSelector('.draw-rail .kit-rail-slot[data-slot="motore:directSelection"]');
  await scegliPrimo(page);
  await apriRicercaComandi(page);
  await page.fill(".draw-commands-dialog .draw-commands-field input", "sposta tracciato");
  await page.locator(".draw-commands-dialog .draw-commands-row", { hasText: "Sposta tracciato" }).first().click();
  await page.waitForSelector('.kit-dialog.draw-effect-dialog [data-action="ok"]:not([disabled])');
  await page.waitForTimeout(400);
  await page.evaluate(() => document.fonts.ready);
}

/// ≡ › Visualizza del Completo (K6 T11, giro E): il menu ≡ aperto dal suo bottone, e il
/// sottomenu Visualizza aperto come lo apre chi usa il mouse.
export async function openVisualizza(page) {
  await openDrawing(page);
  await page.waitForSelector('.draw-rail .kit-rail-slot[data-slot="motore:directSelection"]');
  await page.click('.draw-header button[aria-label="Disegno"]');
  await page.waitForSelector("#context-menu [role='menuitem']:has-text('Visualizza')");
  await page.hover("#context-menu [role='menuitem']:has-text('Visualizza')");
  // Le voci con la spunta hanno il ruolo `menuitemcheckbox`: l'attesa li prende tutti.
  await page.waitForSelector(".context-submenu [role^='menuitem']:has-text('Mostra griglia')");
  await page.evaluate(() => document.fonts.ready);
}

/// I righelli del bordo (K6 T11, giro E): «Mostra righelli» da ≡ › Visualizza, scelta come
/// la sceglie chi usa il mouse.
export async function openRighelli(page) {
  await openVisualizza(page);
  await page.click(".context-submenu [role^='menuitem']:has-text('Mostra righelli')");
  await page.waitForSelector(".draw-ruler-x:not([hidden])");
  await page.evaluate(() => document.fonts.ready);
}

/// Il navigatore della banda (K6 T11, giro E): la sua voce premuta come la preme chi
/// usa il mouse; la panoramica compare in basso a destra del foglio.
export async function openNavigatore(page) {
  await openDrawing(page);
  await page.waitForSelector('.draw-rail .kit-rail-slot[data-slot="motore:directSelection"]');
  await page.waitForSelector('[data-surface-item="navigator"]');
  await page.click('[data-surface-item="navigator"]');
  await page.waitForSelector(".draw-navigator:not([hidden])");
  await page.evaluate(() => document.fonts.ready);
}

/// «Tutti gli strumenti» (K6 T8): il cassetto aperto dalla sua casella; con
/// `cerca`, il campo della ricerca scritto.
export async function openDrawerScene(page, cerca = "") {
  await openDrawing(page);
  await page.click('.draw-rail .kit-rail-slot[data-slot="all"]');
  await page.waitForSelector(".draw-drawer-popover .draw-drawer-tool");
  if (cerca !== "") await page.fill(".draw-drawer-field input", cerca);
}

/// Il fuoco da tastiera sul bottone dello spazio (K6 T7): l'anello si vede.
export async function focusWorkspaceButton(page) {
  await openDrawing(page);
  await page.waitForSelector("#status-workspace:not([hidden])");
  await page.evaluate(() => document.querySelector("#status-workspace")?.focus({ focusVisible: true }));
}

/// Apre il disegno e la scheda Risorse dell'ispettore (K6 T10): il pannello
/// della scheda è quello che si vede, con i campioni del documento.
export async function openRisorse(page) {
  await openDrawing(page);
  await page.click('.inspector-tab[data-view-id="draw.resources"]');
  await page.waitForSelector('#surface-panel-draw-resources:not([hidden]) .draw-resources');
}

/// Apre il disegno, sceglie lo strumento Selezione dalla colonna, clicca un
/// punto vuoto del foglio e seleziona tutto: l'ispettore mostra il Design con la
/// selezione (K6 T10). Il clic su una forma non la sceglie nel Completo di
/// oggi, e il punto singolo del prototipo è di T12.
/// La Selezione della colonna: quella di Fub, o quella del Completo col motore
/// acceso (`strumento:selection` dei testi del nucleo, «(Completo)» la distingue).
export const SELEZIONE_DELLA_ROTAIA = '.draw-rail [aria-label="Selezione"], .draw-rail [aria-label="Selezione (Completo)"]';

export async function openDesignoScelto(page) {
  await openDesignoVuoto(page);
  await page.click(SELEZIONE_DELLA_ROTAIA);
  const foglio = await page.locator(".draw-editor .draw-surface").first().boundingBox();
  if (!foglio) throw new Error("il foglio del disegno non c'è");
  await page.mouse.click(foglio.x + 30, foglio.y + 30);
  await page.keyboard.press("Control+a");
  // Il titolo del pannello dice la selezione, non «Il disegno».
  await page.waitForFunction(() => {
    const soggetto = document.querySelector("#surface-panel-draw-design .draw-properties-subject");
    return soggetto !== null && soggetto.textContent.trim() !== "" && !soggetto.textContent.includes("Il disegno");
  });
}

/// Apre il disegno e la scheda Design dell'ispettore, senza nulla scelto (K6 T10).
export async function openDesignoVuoto(page) {
  await openDrawing(page);
  await page.click('.inspector-tab[data-view-id="draw.design"]');
  await page.waitForSelector('#surface-panel-draw-design:not([hidden]) section.draw-properties');
}

export async function openDrawingStanding(page, ask) {
  await openDrawing(page);
  const chip = ".pane.focus .pane-toolbar .pane-standing:not([hidden]) .pane-standing-chip";
  await page.waitForSelector(chip);
  await page.click(chip);
  await page.waitForSelector(".pane-standing-panel .pane-standing-title");
  if (ask) {
    await page.click(".pane-standing-panel .pane-standing-ask");
    await page.waitForSelector(".pane-standing-panel .pane-standing-places");
  }
}

/// Apre il disegno dei connettori e la finestra del comando nello stato `stato`
/// (`finestra`, `caricamento` o `errore`), e aspetta che lo stato sia dipinto:
/// col fuoco dove la finestra lo mette.
export async function openDrawingWindow(page, stato) {
  await openDrawing(page);
  await page.evaluate((each) => window.bench.finestra(each), stato);
  const dialog = ".kit-dialog.draw-effect-dialog";
  if (stato === "finestra") {
    await page.waitForSelector(`${dialog} .kit-number-input`);
    await page.waitForSelector(`${dialog} [data-action="ok"]:not([disabled])`);
  } else if (stato === "caricamento") {
    await page.waitForSelector(`${dialog} .kit-form-note[role="status"]`);
  } else {
    await page.waitForSelector(`${dialog} .kit-form-error`);
  }
  await page.evaluate(() => document.fonts.ready);
}
