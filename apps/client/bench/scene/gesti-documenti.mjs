// I gesti delle scene: la finestra documento, lo spazio «Esporta in PDF», le foto, il velo.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import { chooseMode, openFromTree, openNote } from "./gesti-scrittura.mjs";

/// Le finestre principali che le scene della finestra documento tengono
/// aperte, una per contesto: la successiva riusa quella che c'è.
export const MAIN_WINDOWS = new WeakMap();

/// Porta `page` (la finestra documento, ancora senza richiesta) davanti a un
/// documento vero: apre lo Scrittoio in una pagina accanto, chiede dal menu
/// della linguetta «Apri in una nuova finestra», e ricarica la finestra con la
/// richiesta che l'host ha ricevuto — cioè quella che il backend le passerebbe.
export async function openDocumentWindow(page) {
  const here = new URL(page.url());
  const context = page.context();
  let main = MAIN_WINDOWS.get(context);
  if (!main || main.isClosed()) {
    main = await context.newPage();
    MAIN_WINDOWS.set(context, main);
  }
  await main.setViewportSize({ width: 1280, height: 800 });
  await main.goto(`${here.origin}/index.html?light=${here.searchParams.get("light")}`, { waitUntil: "load" });
  await main.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: 30_000 });
  await main.click('.pane.focus .tab[aria-selected="true"]', { button: "right" });
  await main.click('#context-menu [role=menuitem]:has-text("Apri in una nuova finestra")');
  const request = await (
    await main.waitForFunction(
      () => window.bench.calls.find((call) => call.gate === "openDocumentWindow")?.args[0] ?? null,
    )
  ).jsonValue();
  await page.goto(`${here.origin}${here.pathname}${here.search}&${new URLSearchParams(request)}`, { waitUntil: "load" });
  // La pagina rinasce qui, dopo l'attesa di `prepareScene`: si aspetta di
  // nuovo anche che lo strato d'avvio se ne sia andato, o la foto prende il
  // marchio fermo nei suoi ms minimi (il runner l'ha preso una volta).
  await page.waitForFunction(
    () => document.documentElement.dataset.bench === "ready" && !document.querySelector(".avvio"),
    null,
    { timeout: 30_000 },
  );
  // Collegata: la principale ha risposto, il testo c'è e si può scrivere.
  await page.waitForSelector('#document-window-link[data-state="salvato"]');
  await page.waitForSelector('#document-window-panel .cm-content[contenteditable="true"]');
}

/// Mette ogni scena sulla sua pagina: è dell'elenco, non di ciascuna voce.
/// Apre lo spazio «Esporta in PDF» dal menu «…» del riquadro col fuoco e
/// aspetta che l'impaginazione sia finita: la banda dice le pagine e i
/// fogli visibili hanno le loro fasce.
export async function openExportSpace(page) {
  await page.click(".pane.focus [data-pane-menu]");
  await page.click('#context-menu [role=menuitem]:has-text("Esporta in PDF")');
  await page.waitForSelector(".export-space .export-band-pages");
  await page.waitForFunction(() => {
    const pages = document.querySelector(".export-space .export-band-pages")?.textContent ?? "";
    return /^\d/.test(pages) && document.querySelector(".export-space .export-slot .export-fascia") !== null;
  }, null, { timeout: 15_000 });
  // L'entrata dello spazio è finita, e il puntatore non sta su un controllo.
  await page.waitForFunction(() => document.querySelector(".export-space")?.getAnimations().length === 0);
  await page.mouse.move(0, 0);
}

/// Il clic su un blocco delle pagine dello spazio «Esporta in PDF» (T76): la
/// fascia che ha `text`, o quella del diagramma se `text` è `null`; aspetta il
/// menu aperto col blocco contornato.
export async function openExportBlockMenu(page, text) {
  // La nota ha un diagramma: disegnato nella resa misurata e sulla pagina.
  await page.waitForFunction(() => {
    const drawn = [...(document.querySelector(".export-measure")?.querySelectorAll(".mermaid-diagram") ?? [])];
    return drawn.length > 0 && drawn.every((figure) => figure.dataset.state !== "loading")
      && document.querySelector(".export-space .export-fascia .mermaid-diagram img") !== null;
  }, null, { timeout: 15_000 });
  const band = text === null
    ? page.locator(".export-space .export-fascia:has(.mermaid-diagram)").first()
    : page.locator(".export-space .export-fascia", { hasText: text }).first();
  await band.scrollIntoViewIfNeeded();
  const box = await band.boundingBox();
  if (!box) throw new Error("la fascia del blocco non si vede");
  await page.mouse.click(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2);
  await page.waitForSelector("#context-menu [role^=menuitem]");
  await page.waitForSelector(".export-space .export-fascia.is-selected");
}

/// Apre la sezione Diagrammi dello spazio «Esporta in PDF», apre la riga dei
/// nodi e sceglie il blu della tavolozza (`#1f4f8f`); aspetta che la resa
/// rimontata sia di nuovo impaginata, coi diagrammi disegnati.
export async function openExportDiagrams(page) {
  await page.click('.export-section[data-section="diagrammi"] .export-section-head');
  await page.waitForSelector(".export-dg-styles");
  await page.click("#export-dg-color-diagramma-nodi");
  await page.click("#export-dg-ink-diagramma-nodi-1f4f8f");
  await page.waitForSelector("#export-dg-reset-diagramma-nodi");
  await page.waitForFunction(() => {
    const pages = document.querySelector(".export-space .export-band-pages")?.textContent ?? "";
    const host = document.querySelector(".export-measure");
    const drawn = [...(host?.querySelectorAll(".mermaid-diagram") ?? [])];
    return /^\d/.test(pages) && drawn.length > 0 && drawn.every((figure) => figure.dataset.state !== "loading")
      && document.querySelector(".export-space .export-slot .export-fascia") !== null;
  }, null, { timeout: 15_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/// Apre le sezioni Tema e Colori dello spazio «Esporta in PDF» e la riga
/// dell'accento, poi porta il pannello in cima.
export async function openThemeSections(page) {
  await page.click('.export-section[data-section="tema"] .export-section-head');
  await page.click('.export-section[data-section="colori"] .export-section-head');
  await page.click("#export-color-accento");
  await page.waitForSelector("#export-color-palette-accento");
  await page.evaluate(() => {
    const side = document.querySelector(".export-side");
    if (side) side.scrollTop = 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

/// Apre Caratteri e Pagina (T72) e aspetta i caratteri del vault caricati,
/// coi pulsanti scritti nel loro carattere.
export async function openFontSections(page) {
  await page.click('.export-section[data-section="caratteri"] .export-section-head');
  await page.waitForSelector('.export-font[data-vault="Caratteri/Macchina.woff2"]');
  await page.click('.export-section[data-section="pagina"] .export-section-head');
  await page.waitForSelector(".export-doc[data-guides=true] .export-guide");
  await page.evaluate(async () => {
    await document.fonts.ready;
    const side = document.querySelector(".export-side");
    if (side) side.scrollTop = 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

/// Apre le sezioni Contenuto e Interruzioni, sceglie i commenti nel margine,
/// le tabelle a griglia e il codice numerato, aspetta le pagine rifatte e
/// porta in vista la pagina coi commenti e la sezione Contenuto.
export async function openContentSections(page) {
  await page.click('.export-section[data-section="contenuto"] .export-section-head');
  await page.click('.export-section[data-section="interruzioni"] .export-section-head');
  await page.click("#export-content-comments-margine");
  await page.click("#export-content-tables-griglia");
  await page.click("#export-content-code");
  await page.waitForFunction(() => {
    const pages = document.querySelector(".export-space .export-band-pages")?.textContent ?? "";
    return /^\d/.test(pages) && document.querySelector(".export-space .export-page .export-comment-placed") !== null;
  }, null, { timeout: 15_000 });
  await page.evaluate(() => {
    const side = document.querySelector(".export-side");
    const section = document.querySelector('.export-section[data-section="contenuto"]');
    if (side && section instanceof HTMLElement) side.scrollTop = section.offsetTop - side.offsetTop;
    const note = document.querySelector(".export-space .export-page .export-comment-placed");
    const stage = document.querySelector(".export-stage");
    if (note && stage) {
      const top = note.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop;
      stage.scrollTop = Math.max(0, top - 160);
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

/// Porta lo spazio «Esporta in PDF» dove sta il passo 29 del prototipo (il
/// profilo «Relazione per il Comune»): tema Relazione, frontespizio e indice,
/// in testata la sezione a sinistra e il titolo a destra, nel piè la data a
/// sinistra e «pagina di pagine» a destra; le sezioni Frontespizio e Testata
/// aperte, due pagine affiancate (T73).
export async function openFrontSections(page) {
  await page.click('.export-section[data-section="tema"] .export-section-head');
  await page.click('.export-theme[data-theme="relazione"]');
  await page.click('.export-section[data-section="tema"] .export-section-head');
  await page.click('.export-section[data-section="fronte"] .export-section-head');
  await page.click("#export-front-cover");
  await page.click("#export-front-toc");
  await page.click('.export-section[data-section="testata"] .export-section-head');
  for (const [slot, label] of [["sopra-sinistra", "Sezione"], ["sotto-sinistra", "Data"], ["sotto-centro", "Niente"], ["sotto-destra", "Pagina di pagine"]]) {
    await page.click(`#export-header-${slot}`);
    await page.click(`#context-menu [role=menuitemradio]:has-text("${label}")`);
    await page.waitForSelector("#context-menu", { state: "detached" });
  }
  // Sotto i 760 px le viste non ci sono (la finestra della conformità a 700).
  if (await page.isVisible('.export-segment[data-view="due"]')) await page.click('.export-segment[data-view="due"]');
  await page.waitForSelector(".export-space .export-cover-title");
  await page.waitForSelector(".export-space .export-toc-row");
  // L'indice ha i numeri veri quando l'impaginazione è finita.
  await page.waitForFunction(() => [...document.querySelectorAll(".export-space .export-toc-page")].every((node) => /^\d+$/.test(node.textContent ?? "")), null, { timeout: 15_000 });
  await page.evaluate(() => {
    const side = document.querySelector(".export-side");
    if (side) side.scrollTop = 0;
    const stage = document.querySelector(".export-stage");
    if (stage) stage.scrollTop = 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

/// Apre la foto delle scene `photo-*` e aspetta che sia disegnata, e con
/// `withData` anche la riga dei dati di LightCraft.
export async function openPhoto(page, withData) {
  await openFolder(page, "Foto");
  await page.click('#file-list .tree-row[data-path="Foto/spiaggia.jpg"]');
  await page.waitForFunction(() => {
    const image = document.querySelector(".pane.focus .media-surface img");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  if (withData) await page.waitForSelector(".pane.focus .photo-data .photo-data-open");
}

/// Apre il disegno delle scene `craft-*` con un clic nell'albero (un gesto) e
/// aspetta `ready` nella scheda, e con `said` la frase dello stato.
export async function openCraft(page, ready, said) {
  await openFolder(page, "Disegni");
  await page.click('#file-list .tree-row[data-path="Disegni/logo-studio.vectorcraft"]');
  await page.waitForSelector(`.pane.focus ${ready}`);
  if (said !== null) {
    await page.waitForFunction((text) => document.querySelector(".pane.focus .craft-empty-state")?.textContent === text, said);
  }
}

/// Apre il RAW delle scene `raw-*` con un clic nell'albero e aspetta il JPEG
/// disegnato (`withImage`) o la domanda, e la riga dei dati dell'XMP.
export async function openRaw(page, doc, withImage) {
  await openFolder(page, "Foto");
  await page.click(`#file-list .tree-row[data-path="${doc}"]`);
  if (withImage) {
    await page.waitForFunction(() => {
      const image = document.querySelector(".pane.focus .craft-card img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
  } else {
    await page.waitForSelector(".pane.focus .craft-ask");
  }
  await page.waitForSelector(".pane.focus .photo-data .photo-data-open");
}

/// Apre la nota col PDF delle scene `nota-pdf*` e aspetta la prima pagina
/// disegnata (`withPreview`) o il link.
export async function openPdfNote(page, withPreview) {
  await fromTreeDrawer(page, () => openNote(page, "Casa/Affitto di via Roma.md"));
  // In Scrittura il PDF incorporato è una scheda viva (T41, le scene
  // `schede-vive-*`); l'anteprima di Craft e il link di T31 sono della Lettura.
  await chooseMode(page, "reading");
  if (withPreview) {
    // Lo slot dell'incorporamento ha già la sua didascalia: l'immagine ci
    // entra da sola, senza un `figure` suo.
    await page.waitForFunction(() => {
      const image = document.querySelector(".pane.focus img.craft-figure-page");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
  } else {
    await page.waitForSelector('.pane.focus [data-vault-media="loaded"] a.wikilink');
  }
  await page.mouse.move(0, 0);
}

/// Apre il PDF della scena `pdf-domanda` con un clic nell'albero e aspetta
/// la pagina disegnata e la riga della domanda.
export async function openPdfQuestion(page) {
  await fromTreeDrawer(page, async () => {
    await openFolder(page, "Casa");
    await page.click('#file-list .tree-row[data-path="Casa/contratto-affitto.pdf"]');
    await page.waitForSelector('.pane.focus .sheet-notice[data-notice="craft_consent"]');
  });
  // La pagina è disegnata quando la riga di stato conta le pagine.
  await page.waitForFunction(() => {
    const pdf = document.querySelector(".pane.focus .media-pdf");
    return /\d/.test(pdf?.querySelector('[role="status"]')?.textContent ?? "")
      && (pdf?.querySelector(".media-pdf-page canvas")?.width ?? 0) > 0;
  });
  await page.mouse.move(0, 0);
}

/// Fa `open` con l'albero a portata: in una finestra stretta l'albero sta nel
/// cassetto, che si apre prima e si chiude dopo, come in `openRichDocument`.
export async function fromTreeDrawer(page, open) {
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await open();
  if (!compact) return;
  // Un documento scelto nell'albero chiude il cassetto da sé: il velo che sta
  // uscendo non si clicca (`closeSidebarDrawer`).
  if (await sidebarDrawerOpen(page)) {
    // Non sul bordo destro: lì il puntatore fa affacciare l'ispettore.
    const scrim = await page.locator("#sidebar-scrim").boundingBox();
    await page.click("#sidebar-scrim", { position: { x: scrim.width - 80, y: 8 } });
  }
  await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
}

/// Le miniature che l'albero delle scene `albero-*` mostra: il RAW girato, i
/// tre file Craft, il Word e il PDF.
export const TREE_THUMBS = 6;

/// Apre le cartelle dell'albero delle scene `albero-*` e aspetta che tutte le
/// miniature siano dipinte. In una finestra stretta apre il cassetto e lo
/// lascia aperto: la scena è l'albero.
export async function openThumbTree(page) {
  const compact = await page.evaluate(() => document.querySelector("#layout")?.classList.contains("layout-compact") ?? false);
  if (compact) {
    await page.click('#views-ribbon .rail-btn[data-panel="files"]');
    await page.waitForSelector("#sidebar-scrim:not([hidden])");
  }
  await openFolder(page, "Foto 2026");
  await openFolder(page, "Progetti");
  await page.waitForFunction((count) => {
    const thumbs = [...document.querySelectorAll("#file-list img.tree-thumb")];
    return thumbs.length === count && thumbs.every((img) => img.complete && img.naturalWidth > 0);
  }, TREE_THUMBS);
  await page.mouse.move(0, 0);
}

/// Apre il Word della scena `docx-due-righe`, lo presta a WordCraft dal menu
/// dell'albero e aspetta le due righe.
export async function openLentDocx(page) {
  const path = "Documenti/relazione.docx";
  await fromTreeDrawer(page, async () => {
    await openFolder(page, "Documenti");
    await page.click(`#file-list .tree-row[data-path="${path}"]`);
    await page.waitForSelector(".pane.focus .rich-surface .ProseMirror");
    await page.click(`#file-list li[data-path="${path}"] > .tree-row`, { button: "right" });
    await page.click('#context-menu button:has-text("Organizza")');
    await page.click('.context-submenu button:has-text("Apri con un\'altra app")');
    await page.click('.context-submenu >> nth=1 >> button:has-text("WordCraft")');
    await page.waitForSelector('.pane.focus .sheet-notice[data-notice="lent"]');
  });
  await page.waitForSelector('.pane.focus .sheet-notice[data-notice="craft_consent"]');
  await page.mouse.move(0, 0);
}

/// Apre la Scrivania dal binario e aspetta i suoi riquadri (o il vuoto).
export async function openDesk(page) {
  await page.click('#views-ribbon .rail-btn-main[data-panel="desk"]');
  await page.waitForSelector('.pane-view[data-view-id="desk"] :is(.desk-commands, .ui-empty-state)');
  await page.mouse.move(0, 0);
}

/// Apre `Opere.base` delle scene `base-*` e aspetta la tabella con le sue
/// righe e la barra ferma. Dalla porta della shell e non dall'albero: il
/// finto elenca un `.base` come file, e l'albero non lo apre.
export async function openBase(page) {
  await page.evaluate(async () => {
    const { openDocument } = await import("/src/state/document-controller.ts");
    await openDocument("Opere.base");
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".pane.focus");
    return (pane?.querySelectorAll(".base-table tbody tr").length ?? 0) > 0
      && pane?.querySelector(".base-tab[aria-pressed='true']") !== null
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
  });
}

/// Aspetta la Base incorporata nella nota della Live, con le sue righe.
export async function waitForEmbeddedBase(page) {
  await page.waitForFunction(() => {
    const base = document.querySelector('.pane.focus .base-surface[data-embedded="true"]');
    return (base?.querySelectorAll(".base-table tbody tr").length ?? 0) > 0
      && base?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
  });
}

/// Apre il calendario di `?base=calendario` e aspetta il mese con le sue note.
export async function openCalendar(page) {
  await page.evaluate(async () => {
    const { openDocument } = await import("/src/state/document-controller.ts");
    await openDocument("Opere.base");
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".pane.focus");
    return (pane?.querySelectorAll(".base-cal-event").length ?? 0) > 0
      && pane?.querySelector(".base-tab[aria-pressed='true']") !== null
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
  });
}

/// Apre la linea del tempo di `?base=tempo` e aspetta le sue barre.
/// Apre la Mappa di `?base=mappa`: i segnaposto disegnati e la riga sotto la
/// mappa scritta (dopo la lettura degli host ammessi).
export async function openMap(page) {
  await page.evaluate(async () => {
    const { openDocument } = await import("/src/state/document-controller.ts");
    await openDocument("Opere.base");
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".pane.focus");
    return (pane?.querySelectorAll(".base-map-marker").length ?? 0) > 0
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true"
      && (pane?.querySelector(".base-map-enable") !== null || pane?.querySelector(".base-map-settings") !== null);
  });
}

/// La Mappa con le tessere: «Attiva», poi le quattro tessere del livello 1.
export async function openMapTiles(page) {
  await openMap(page);
  await page.click(".pane.focus .base-map-enable");
  await page.waitForFunction(() => document.querySelectorAll(".pane.focus .base-map-tiles image").length === 4);
  await page.mouse.move(0, 0);
}

export async function openTimeline(page) {
  await page.evaluate(async () => {
    const { openDocument } = await import("/src/state/document-controller.ts");
    await openDocument("Opere.base");
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".pane.focus");
    return (pane?.querySelectorAll(".base-tl-bar").length ?? 0) > 0
      && pane?.querySelector(".base-tab[aria-pressed='true']") !== null
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
  });
}

/// Sceglie dal menu della colonna `column` il riepilogo `label` e aspetta che
/// il piede lo mostri.
export async function chooseBaseSummary(page, column, label) {
  await page.click(`.pane.focus th[data-column="${column}"] .base-head`);
  await page.waitForSelector("#context-menu .menu-head");
  await page.hover('#context-menu button:has(.menu-label:text-is("Riepilogo"))');
  await page.click(`.context-submenu button:has(.menu-label:text-is("${label}"))`);
  await page.waitForFunction((column) => {
    const pane = document.querySelector(".pane.focus");
    return pane?.querySelector(`tfoot td[data-column="${column}"] .base-foot-value`) !== null
      && pane?.querySelector(".base-bar")?.getAttribute("aria-busy") !== "true";
  }, column);
}

/// Apre la cartella di Excel della scena `grid-workbook` e aspetta che la
/// griglia v2 abbia disegnato le sue celle.
export async function openWorkbook(page, path = "Dati/Conti.xlsx") {
  await openFolder(page, "Dati");
  await page.click(`#file-list .tree-row[data-path="${path}"]`);
  await page.waitForFunction(() => {
    const grid = document.querySelector(".grid-surface");
    return grid?.getAttribute("data-grid-protocol") === "v2"
      && (grid?.querySelectorAll('[role="gridcell"]').length ?? 0) > 0;
  });
  await gridAtRest(page);
}

/// Aspetta che la griglia stia ferma al suo posto. Le celle compaiono prima
/// della barra multifunzione, che la superficie carica con un `import()` e
/// che, quando arriva, spinge la griglia in giù di più di cento pixel: un
/// punto misurato prima (il bordo di un'intestazione, una cella) cade poi
/// sulla barra. Il puntatore resta così sopra un suo pulsante, e la scena
/// fotografa il suo tooltip invece del gesto che dichiara, o un gesto non
/// trova la griglia dove l'aveva vista.
export async function gridAtRest(page) {
  await page.waitForSelector(".pane.focus .grid-ribbon");
  await page.evaluate(() => {
    delete window.__gridViewportBox;
  });
  await page.waitForFunction(
    () => {
      const box = document.querySelector(".pane.focus .grid-viewport")?.getBoundingClientRect();
      if (!box) return false;
      const now = `${box.x},${box.y},${box.width},${box.height}`;
      const before = window.__gridViewportBox;
      window.__gridViewportBox = now;
      return before === now;
    },
    null,
    { polling: 100 },
  );
}

/// Apre la cartella per le scene della barra dei fogli, col foglio largo
/// `width` px, oppure senza l'albero e l'ispettore (`"full"`, 1248 px nella
/// finestra `SHEET_FULL`) o quanto lascia il telefono (`"phone"`), e aspetta che la barra abbia raccolto i suoi foglietti.
/// `path` è la cartella: di solito quella delle scene della barra.
export async function openRibbon(page, width, path = "Dati/Conti.xlsx") {
  await openFromTree(page, path, '.pane.focus .grid-surface[data-grid-protocol="v2"] [role="gridcell"]');
  if (await page.isVisible('#toggle-inspector[aria-pressed="true"]')) {
    await page.click("#toggle-inspector");
    await page.waitForSelector('#toggle-inspector[aria-pressed="false"]');
  }
  const tree = '#rail .rail-btn[aria-label="L\'albero del vault"]';
  if (width === "full" && await page.isVisible(`${tree}[aria-pressed="true"]`)) {
    const before = await page.evaluate(() => document.querySelector(".pane.focus .pane-editor").getBoundingClientRect().width);
    await page.click(tree);
    await page.waitForFunction(
      (narrow) => document.querySelector(".pane.focus .pane-editor").getBoundingClientRect().width > narrow,
      before,
    );
  }
  await page.waitForSelector(".pane.focus .grid-ribbon .grid-ribbon-panel:not([hidden])");
  const sheet = await page.evaluate(() => document.querySelector(".pane.focus .pane-editor")?.getBoundingClientRect().width ?? 0);
  const expected = width === "full" ? 1248 : width;
  if (typeof expected === "number" && Math.round(sheet) !== expected) throw new Error(`il foglio è largo ${sheet} px, non ${expected}`);
  // La barra si raccoglie al fotogramma dopo la misura del foglio.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.focus('.pane.focus .grid-surface [role="gridcell"][aria-selected="true"], .pane.focus .grid-surface [role="grid"]');
}

/// Il testo lungo della cella aperta, lo stesso del prototipo delle celle.
export const LONG_CELL_TEXT = "Luce 4 — bolletta di gennaio e febbraio, con il conguaglio";

/// Apre la cartella grande delle scene degli stati della griglia
/// (`?workbook=large`), col foglio largo come nelle scene della barra.
export function openLargeSheet(page, width) {
  return openRibbon(page, width, "Dati/Grande.xlsx");
}

/// Sceglie l'intervallo da `from` a `to` (riga e colonna da zero) come una
/// persona: un clic sulla prima cella, poi Maiusc e le frecce. Aspetta che i
/// lati del rettangolo stiano sui bordi delle due celle: col movimento ridotto
/// ci arrivano subito.
export async function pickGridRange(page, [r0, c0], [r1, c1]) {
  const { x, y } = await gridCellCenter(page, r0, c0);
  await page.mouse.click(x, y);
  await page.waitForFunction(
    ([r, c]) => {
      const active = document.querySelector(".pane.focus .grid-cell.active");
      return active?.dataset.row === String(r) && active?.dataset.column === String(c);
    },
    [r0, c0],
  );
  for (let c = c0; c < c1; c += 1) await page.keyboard.press("Shift+ArrowRight");
  for (let r = r0; r < r1; r += 1) await page.keyboard.press("Shift+ArrowDown");
  await page.waitForFunction(
    ([r, c, n]) => document.querySelectorAll(".pane.focus .grid-cell.selected").length === n
      && document.querySelector(".pane.focus .grid-cell.active")?.dataset.row === String(r)
      && document.querySelector(".pane.focus .grid-cell.active")?.dataset.column === String(c),
    [r0, c0, (r1 - r0 + 1) * (c1 - c0 + 1)],
  );
  await marksAtRest(page);
}

/// Aspetta che i segni della griglia stiano fermi per due fotogrammi di fila.
export async function marksAtRest(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const root = document.querySelector(".pane.focus .grid-viewport");
    const look = () => [...root.querySelectorAll(".grid-mark")].map((mark) => `${mark.hidden}${mark.style.transform}${mark.style.width}${mark.style.height}`).join("|");
    let before = look();
    let still = 0;
    const tick = () => {
      const now = look();
      still = now === before ? still + 1 : 0;
      before = now;
      if (still >= 2) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

/// Scorre la griglia a `top`, `left` e aspetta che le righe e i segni siano
/// ridisegnati.
export async function scrollGrid(page, top, left) {
  await page.evaluate(([t, l]) => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    viewport.scrollTop = t;
    viewport.scrollLeft = l;
  }, [top, left]);
  await page.waitForFunction(
    ([t, l]) => {
      const viewport = document.querySelector(".pane.focus .grid-viewport");
      return Math.abs(viewport.scrollTop - t) < 1 && Math.abs(viewport.scrollLeft - l) < 1;
    },
    [top, left],
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await marksAtRest(page);
}

/// Prende il bordo destro dell'ultima colonna che, tirata di 60 px, resta
/// dentro il riquadro (come lo sceglie il prototipo), lo tira di 60 px e lo
/// tiene: la misura dal vivo si vede.
export async function dragColumnNearEdge(page) {
  const edge = await page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport").getBoundingClientRect();
    const near = [...document.querySelectorAll(".pane.focus .grid-column-header")]
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.right + 60 <= viewport.right - 4)
      .sort((a, b) => b.right - a.right)[0];
    return near ? { x: near.right - 1, y: near.top + near.height / 2 } : null;
  });
  if (!edge) throw new Error("nessun bordo di colonna vicino al lato destro");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  for (const dx of [10, 30, 50, 60]) await page.mouse.move(edge.x + dx, edge.y);
  await page.waitForSelector(".pane.focus .grid-resize-label:not([hidden])");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/// Apre il menu «Comandi» della barra dei fogli e, se c'è, la strada di
/// sottomenu `path`, una voce dopo l'altra.
export async function openCommands(page, path = []) {
  await page.click(".pane.focus .grid-ribbon-quick .grid-ribbon-button");
  await page.waitForSelector("#context-menu .menu-items [role^=menuitem]");
  for (const label of path) {
    const row = page.locator(".context-menu .menu-items [role^=menuitem]", { has: page.locator(".menu-label", { hasText: new RegExp(`^${label}$`) }) }).last();
    await row.click();
    await page.waitForSelector(`.context-submenu[aria-label="${label}"]`);
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/// Il centro di una cella della griglia, per riga e colonna da zero, quando
/// la cella sta ferma: la griglia si monta prima della barra multifunzione e
/// dell'avviso sopra di lei, che arrivano dopo e la spingono in giù. Un
/// punto preso prima cade sull'avviso, e il trascinamento diventa una
/// selezione del testo della pagina.
export async function gridCellCenter(page, row, column) {
  const center = await page.waitForFunction(
    ([r, c]) => {
      const cell = document.querySelector(`.pane.focus .grid-cell[data-row="${r}"][data-column="${c}"]`);
      if (!cell) return null;
      const box = cell.getBoundingClientRect();
      const now = `${box.x},${box.y},${box.width},${box.height}`;
      const before = window.__gridCellBox;
      window.__gridCellBox = now;
      return before === now ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    },
    [row, column],
    { polling: 100 },
  );
  return center.jsonValue();
}

/// Sceglie una cella con un clic e ci scrive: la prima battuta la apre, e la
/// scena aspetta che il campo della cella abbia tutto il testo.
export async function writeInCell(page, row, column, text) {
  const { x, y } = await gridCellCenter(page, row, column);
  await page.mouse.click(x, y);
  await page.waitForFunction(
    ([r, c]) => {
      const active = document.querySelector(".pane.focus .grid-cell.active");
      return active?.dataset.row === String(r) && active?.dataset.column === String(c);
    },
    [row, column],
  );
  await page.keyboard.type(text);
  await page.waitForFunction(
    (t) => {
      const host = document.querySelector(".pane.focus .grid-cell-editor");
      return host !== null && !host.hidden && host.querySelector(".cm-content")?.textContent === t;
    },
    text,
  );
}

/// Apre una cartella dell'albero, se non è già aperta. Il `data-path` della
/// cartella sta sul `treeitem` che contiene anche il sottoalbero; la riga è il
/// suo figlio diretto cliccabile.
export async function openFolder(page, path) {
  const item = `#file-list li[role="treeitem"][data-path="${path}"]`;
  const row = `${item} > .tree-row.folder`;
  await page.waitForSelector(row);
  const open = await page.evaluate(
    (sel) => document.querySelector(sel)?.getAttribute("aria-expanded") === "true",
    item,
  );
  if (!open) await page.click(row);
}

/// Sceglie la parola «nota» della prima riga e apre il suo menu: col tasto
/// destro sopra la parola, o dalla tastiera (Maiusc+F10), che parte dalla
/// prima voce.
export async function selectWordAndOpen(page, { keyboard = false } = {}) {
  const word = page.locator(".pane.focus .pane-editor .cm-content .cm-line >> text=/Questa è la nota/").first();
  await word.waitFor();
  const box = await word.boundingBox();
  // «Questa è la »: la parola «nota» sta dopo i primi dodici caratteri.
  const x = box.x + (await word.evaluate((line) => {
    const range = document.createRange();
    const text = line.firstChild?.nodeType === Node.TEXT_NODE ? line.firstChild : line.querySelector("*")?.firstChild ?? line.firstChild;
    const at = text.textContent.indexOf("nota");
    range.setStart(text, at);
    range.setEnd(text, at + 2);
    const rect = range.getBoundingClientRect();
    return rect.right - line.getBoundingClientRect().left;
  }));
  const y = box.y + Math.min(box.height / 2, 10);
  await page.mouse.dblclick(x, y);
  if (keyboard) await page.keyboard.press("Shift+F10");
  else await page.mouse.click(x, y, { button: "right" });
  await page.waitForSelector("#context-menu .menu-clipboard");
}

/// Preme `key` finché `done` non dice di sì, al più dodici volte.
export async function pressUntil(page, key, done) {
  for (let tries = 0; tries < 12 && !(await page.evaluate(done)); tries++) await page.keyboard.press(key);
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
export async function waitForGraphToSettle(page) {
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

/// Richiude il cassetto dell'albero con un clic sul velo, come la persona.
///
/// Il clic va in alto, perché su un telefono il cassetto sale dal basso, e
/// fuori dal cassetto, che in una finestra stretta copre il lato sinistro. Ma
/// non sul bordo destro: lì c'è la striscia da cui l'ispettore chiuso si
/// affaccia (`frame/peek.ts`), e il puntatore che resta fermo su di lei dopo
/// il clic lo fa comparire sopra la nota, come per chi ci sosta davvero. Il
/// punto lo sceglie `scrimClickPoint`, lontano da tutti e due.
///
/// Un documento scelto nell'albero chiude il cassetto da sé
/// (`dismissSidePanel`): allora il velo sta già uscendo, non prende più i clic
/// e non va cliccato. Si aspetta solo che finisca.
export async function closeSidebarDrawer(page) {
  if (await sidebarDrawerOpen(page)) await clickSidebarScrim(page);
  await page.waitForSelector("#sidebar-scrim", { state: "hidden" });
}

/// Il cassetto dell'albero è aperto: lo dice la classe del layout, non il velo,
/// che resta visibile per tutta la sua uscita.
export function sidebarDrawerOpen(page) {
  return page.evaluate(() => document.getElementById("layout")?.classList.contains("drawer-sidebar-open") ?? false);
}

export async function clickSidebarScrim(page) {
  const scrim = await page.locator("#sidebar-scrim").boundingBox();
  const avoid = await page.evaluate(() =>
    [document.getElementById("sidebar"), ...document.querySelectorAll(".drawer-edge")]
      .map((el) => el?.getBoundingClientRect())
      .filter((box) => box && box.width > 0 && box.height > 0)
      .map(({ x, y, width, height }) => ({ x, y, width, height })),
  );
  await page.click("#sidebar-scrim", { position: scrimClickPoint(scrim, avoid) });
}

/// Dove cliccare il velo, in coordinate del velo: sulla riga a `top` px
/// dall'alto, al centro del tratto libero più largo fra le scatole da evitare
/// che la attraversano. Lancia se la riga è tutta coperta: un clic a caso
/// fotograferebbe un altro stato senza dirlo.
export function scrimClickPoint(scrim, avoid, top = 8) {
  const row = scrim.y + top;
  const end = scrim.x + scrim.width;
  const covered = avoid
    .filter((box) => box.y <= row && row < box.y + box.height)
    .map((box) => [Math.max(box.x, scrim.x), Math.min(box.x + box.width, end)])
    .filter(([from, to]) => from < to)
    .sort((a, b) => a[0] - b[0]);
  let best = null;
  let cursor = scrim.x;
  for (const [from, to] of [...covered, [end, end]]) {
    if (from > cursor && (best === null || from - cursor > best[1] - best[0])) best = [cursor, from];
    cursor = Math.max(cursor, to);
  }
  if (best === null) throw new Error("il velo del cassetto è tutto coperto: non c'è dove cliccarlo");
  return { x: Math.round((best[0] + best[1]) / 2 - scrim.x), y: top };
}
