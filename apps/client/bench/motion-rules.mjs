// **Le regole del moto, e l'elenco di ciò che si muove**: la parte pura del
// banco del movimento (`motion.mjs`).
//
// Sta a parte per la ragione per cui `graph-heap.mjs` sta a parte da
// `graph-scale.mjs`: qui non c'è né browser né server, e quindi un test può
// leggerla (`motion.test.ts`). Dentro ci sono due cose.
//
// # L'elenco
//
// Una coreografia è un gesto che fa partire un movimento, e il gesto che lo
// disfa. Sta scritta come le scene di `scene.mjs`: da che scena si parte, che
// cosa si preme, come si riconosce l'arrivo. L'elenco è **chiuso**: ogni file
// di `src/shells/scrittoio` e di `src/kit` che fa partire una corsa di `moto`
// è la sorgente di una coreografia, oppure sta in `UNCOVERED` con la sua
// ragione. Lo verifica `motion.test.ts`, perché un movimento nuovo che il banco
// non guarda è un verde che non dice niente.
//
// # Le regole
//
// Sono quelle del §5 del piano, nella forma in cui si possono misurare:
//
// 1. lo stato finale col movimento è, al pixel, quello senza;
// 2. a corsa finita non resta niente: nessuna animazione viva, nessuna
//    proprietà in linea che il moto ridotto non lascia;
// 3. si muovono soltanto `transform` e `opacity` (e le loro proprietà singole);
// 4. a metà corsa si può tornare indietro: si arriva dove si era, e niente
//    riparte da zero.
//
// Qui stanno i confronti; le misure le prende `motion.mjs` nel browser.

/// Le proprietà che una corsa può toccare. È la regola 3, ed è una costante
/// perché allargarla sia una decisione che si legge in un diff.
export const ALLOWED = Object.freeze(["transform", "opacity", "translate", "scale", "rotate"]);

/// Ciò che un fotogramma chiave porta di suo e non è una proprietà animata.
const SERVICE = new Set(["offset", "easing", "composite", "computed-offset"]);

/// Le proprietà che ridipingono senza rimisurare: i colori e le ombre. Non
/// sono ammesse, ma dirle a parte distingue una transizione di colore della
/// pelle da un'animazione di geometria.
const PAINT = /^(color|background-color|background|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-color|border-color|outline-color|box-shadow|text-shadow|fill|stroke|text-decoration-color|caret-color|column-rule-color|accent-color)$/;

/// Il nome di una proprietà come lo scrive il CSS: i fotogrammi chiave la
/// danno in `camelCase`, gli eventi delle transizioni col trattino.
export function cssName(name) {
  if (name.startsWith("--")) return name;
  return name.replace(/^css(?=[A-Z])/, "").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "");
}

/// A che famiglia appartiene una proprietà: ammessa, di sola pittura, o di
/// geometria (tutto il resto: ciò che non si conosce costa come un layout).
export function family(name) {
  const css = cssName(name);
  if (ALLOWED.includes(css)) return "allowed";
  return PAINT.test(css) ? "paint" : "layout";
}

/// Le proprietà di un elenco di nomi che la regola 3 non ammette, in ordine e
/// senza doppioni. I nomi di servizio dei fotogrammi chiave non contano.
export function foreignProperties(names) {
  const found = new Set();
  for (const name of names) {
    const css = cssName(name);
    if (SERVICE.has(css) || ALLOWED.includes(css)) continue;
    found.add(css);
  }
  return [...found].sort();
}

/// Lo stesso, da fotogrammi chiave: ogni chiave di ogni fotogramma.
export function foreignInKeyframes(keyframes) {
  const names = [];
  for (const frame of keyframes) names.push(...Object.keys(frame ?? {}));
  return foreignProperties(names);
}

/// Ciò che il movimento ha lasciato in linea e il moto ridotto no (regola 2).
/// Le due liste sono `{ path, property, value }` degli stessi elementi nelle due
/// pagine, a riposo. Conta anche un valore diverso: è un altro stato finale.
export function residue(moving, still) {
  const kept = new Map(still.map((entry) => [`${entry.path}\n${entry.property}`, entry.value.trim()]));
  const left = [];
  for (const entry of moving) {
    const key = `${entry.path}\n${entry.property}`;
    const value = entry.value.trim();
    if (kept.get(key) === value) continue;
    left.push({ ...entry, value, still: kept.has(key) ? kept.get(key) : null });
  }
  return left;
}

/// Quanto può differire un riquadro dalla sua continuazione senza essere un
/// salto: l'arrotondamento di un rettangolo misurato, non un fotogramma.
export const CONTINUITY = Object.freeze({ px: 1.5, opacity: 0.03 });

/// Quanto dista un riquadro da un altro: il lato che si è spostato di più e la
/// differenza di opacità.
function distance(a, b) {
  const px = Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.left + a.width - (b.left + b.width)),
    Math.abs(a.top + a.height - (b.top + b.height)),
  );
  return { px, opacity: Math.abs(a.opacity - b.opacity) };
}

/// I salti all'inversione (regola 4). `before` sono i riquadri di ciò che si
/// stava muovendo un attimo prima del gesto, `after` quelli di ciò che si vede
/// subito dopo, allo stesso istante. Ogni riquadro di prima deve proseguire in
/// uno di dopo: lo stesso elemento, o l'immagine che ne ha preso il posto. Uno
/// che non prosegue è una corsa ripartita da zero, o sparita.
export function jumps(before, after, tolerance = CONTINUITY) {
  const found = [];
  for (const box of before) {
    let nearest = null;
    for (const candidate of after) {
      const gap = distance(box, candidate);
      const within = gap.px <= tolerance.px && gap.opacity <= tolerance.opacity;
      const better =
        !nearest || (within && !nearest.within) || (within === nearest.within && gap.px + gap.opacity * 100 < nearest.px + nearest.opacity * 100);
      if (better) nearest = { ...gap, within, key: candidate.key };
    }
    if (nearest?.within) continue;
    found.push({
      key: box.key,
      px: nearest ? Math.round(nearest.px * 100) / 100 : null,
      opacity: nearest ? Math.round(nearest.opacity * 1000) / 1000 : null,
      nearest: nearest?.key ?? null,
    });
  }
  return found;
}

/// L'istante di «metà corsa» (ms): la metà della corsa più breve fra quelle
/// vive, così a quell'istante sono ancora tutte in viaggio, portata a un
/// numero intero di fotogrammi. Senza corse (un valore a molla non ne ha) vale
/// `fallback`.
export function midpoint(lengths, fallback = 50) {
  const frame = 1000 / 60;
  const alive = lengths.filter((length) => length > 0);
  const half = alive.length > 0 ? Math.min(...alive) / 2 : fallback;
  return Math.max(1, Math.round(half / frame)) * frame;
}

// ── I gesti ──────────────────────────────────────────────────────────────────
//
// Il puntatore va dove sta l'elemento e preme, senza le attese di `page.click`:
// a metà corsa quelle attese (che l'elemento sia fermo, che riceva gli eventi)
// sono esattamente ciò che si sta misurando, e chi usa la shell non le fa.

async function centre(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`non si vede: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function press(page, selector) {
  const at = await centre(page, selector);
  await page.mouse.click(at.x, at.y);
}

async function hover(page, selector) {
  const at = await centre(page, selector);
  await page.mouse.move(at.x, at.y, { steps: 2 });
}

const has = (selector) => (page) => page.evaluate((s) => document.querySelector(s) !== null, selector);
const lacks = (selector) => (page) => page.evaluate((s) => document.querySelector(s) === null, selector);

/// Le righe e le linguette del kit hanno id a contatore: si scelgono per posto.
const TAB = (index) => `#sample-tabs .kit-tab >> nth=${index}`;
const tabChosen = (index) => (page) =>
  page.evaluate(
    (i) => document.querySelectorAll("#sample-tabs .kit-tab")[i]?.getAttribute("aria-selected") === "true",
    index,
  );
const rowActive = (index) => (page) =>
  page.evaluate((i) => {
    const list = document.querySelector("#sample-listbox");
    const row = list?.querySelectorAll('[role="option"]')[i];
    return !!row && list.getAttribute("aria-activedescendant") === row.id;
  }, index);
const sheetTab = (index) => `.pane.focus .tab[data-index="${index}"]`;
const railPressed = (panel) => has(`#views-ribbon .rail-btn[data-panel="${panel}"][aria-pressed="true"]`);
const sheets = (count) => (page) =>
  page.evaluate((n) => document.querySelectorAll("#panes .pane[data-pane]").length === n, count);
/// Un comando della shell dal registro che servono menu, lanciatore e tastiera.
/// Senza passare da un bottone della cornice: il suo hover e la sua pressione
/// hanno transizioni loro, che non sono il moto di questo gesto.
/// Un punto sull'ultima riga della nota, dove un menu deve aprirsi sopra il
/// puntatore.
const menuEdgePoint = (page) =>
  page.evaluate(() => {
    const lines = document.querySelectorAll(".pane.focus .cm-line");
    const line = lines[lines.length - 1]?.getBoundingClientRect();
    return line
      ? { x: Math.round(line.left + 40), y: Math.round(line.top + line.height / 2) }
      : { x: 400, y: window.innerHeight - 40 };
  });
const shellCommand = (id) => (page) =>
  page.evaluate(async (command) => {
    const { allCommands } = await import("/src/ui/commands.ts");
    const entry = allCommands().find((each) => each.id === command);
    if (!entry?.run) throw new Error(`nessun comando ${command}`);
    await entry.run();
  }, id);
const light = (theme) => (page) =>
  page.evaluate(
    (t) => document.documentElement.dataset.theme === t && document.querySelector(".light-scene") === null,
    theme,
  );

/// Le coreografie. Ognuna dice:
///
/// - `scene`: l'id della scena di `SCENE` da cui parte, e `setup` i
///   gesti in più che servono prima di misurare;
/// - `act` e `arrived`: il gesto, e come si riconosce lo stato d'arrivo;
/// - `undo` e `returned`: il gesto che lo disfa (`null` se non ce n'è uno, e
///   allora la regola 4 non si applica: `irreversible` dice perché);
/// - `started` e `reversing`: dove un'attesa separa il gesto dal movimento (un
///   puntatore che deve sostare), come si riconosce che è partito;
/// - `holds`: lo stato d'arrivo dura finché il puntatore resta dov'è;
/// - `track`: ciò che un valore a molla sposta scrivendo in linea, senza una
///   corsa che il motore possa elencare (di ogni selettore, il primo elemento);
/// - `still`: oggi non passa da `moto`, e le regole devono valere lo stesso;
/// - `mount`: parte al montaggio, senza un gesto;
/// - `sources`: i file che fanno partire queste corse.
export const CHOREOGRAPHIES = [
  {
    id: "tab-switch",
    title: "Linguette: il raccordo scorre, il contenuto sfuma nel verso dello spostamento",
    sources: ["src/shells/scrittoio/sheets/tab-strip.ts"],
    scene: "tabs",
    act: (page) => press(page, sheetTab(0)),
    arrived: has(`${sheetTab(0)}[aria-selected="true"]`),
    undo: (page) => press(page, sheetTab(1)),
    returned: has(`${sheetTab(1)}[aria-selected="true"]`),
  },
  {
    id: "rail-notch",
    title: "Binario: la tacca scivola sul pannello scelto",
    sources: ["src/shells/scrittoio/frame/rail.ts"],
    scene: "startup",
    act: (page) => press(page, '#views-ribbon .rail-btn[data-panel="search"]'),
    arrived: railPressed("search"),
    undo: (page) => press(page, '#views-ribbon .rail-btn[data-panel="files"]'),
    returned: railPressed("files"),
    track: ["#rail-notch"],
  },
  {
    id: "light",
    title: "Luce: il cerchio si allarga dal bottone, il tema cambia sotto, il cerchio svanisce",
    sources: ["src/shells/scrittoio/frame/light.ts"],
    scene: "startup",
    act: (page) => press(page, "#toggle-light"),
    started: has(".light-scene"),
    arrived: light("light"),
    undo: (page) => press(page, "#toggle-light"),
    returned: light("dark"),
  },
  {
    id: "stage-split",
    title: "Fogli: il nuovo esce dal bordo del vecchio; chiuso, ne resta una sagoma che si dissolve",
    sources: ["src/shells/scrittoio/stage-motion.ts"],
    scene: "tabs",
    act: (page) => page.keyboard.press("Control+Backslash"),
    arrived: sheets(2),
    undo: (page) => page.keyboard.press("Control+Shift+KeyW"),
    returned: sheets(1),
  },
  {
    id: "concentration",
    title: "Concentrazione: i cassetti si ritirano, la scrivania si spegne, il foglio si centra",
    // La stessa sorgente di `stage-split`: qui il cambio è della cornice, e la
    // carta del foglio lo segue.
    sources: ["src/shells/scrittoio/stage-motion.ts"],
    scene: "tabs",
    // Il primo ingresso dice come si esce, con un toast che resta cinque
    // secondi: lo si consuma prima, perché non entri in nessuno scatto.
    setup: async (page) => {
      await shellCommand("shell.focus.toggle")(page);
      await page.evaluate(() => document.querySelectorAll(".toast-close").forEach((close) => close.click()));
      await page.waitForSelector("#toasts", { state: "detached", timeout: 15_000 });
      await shellCommand("shell.focus.toggle")(page);
    },
    act: shellCommand("shell.focus.toggle"),
    arrived: has("#app[data-focus-mode]"),
    undo: shellCommand("shell.focus.toggle"),
    returned: lacks("#app[data-focus-mode]"),
  },
  {
    id: "menu",
    title: "Menu dell'applicazione: una voce del marchio apre il suo menu",
    sources: [],
    scene: "startup",
    setup: (page) => press(page, "#brand-menu"),
    act: (page) => press(page, "#app-menu > button >> nth=2"),
    arrived: has("#context-menu:not([hidden])"),
    undo: (page) => page.keyboard.press("Escape"),
    returned: lacks("#context-menu"),
    // Il menu della shell è quello comune e non passa da `moto`: sta qui perché
    // «aprire un menu» resti misurato anche il giorno in cui si muoverà.
    still: true,
  },
  {
    id: "menu-edge",
    title: "Menu al bordo basso: spinto in su dal bordo, cresce ancora dal puntatore",
    sources: [],
    scene: "startup",
    // Una finestra bassa: il testo della nota arriva vicino al bordo.
    setup: (page) => page.setViewportSize({ width: 1280, height: 640 }),
    act: async (page) => {
      const at = await menuEdgePoint(page);
      await page.mouse.click(at.x, at.y, { button: "right" });
    },
    // L'origine del menu, nella finestra, sta a meno di 8 px dal clic.
    arrived: async (page) => {
      const at = await menuEdgePoint(page);
      return page.evaluate(({ x, y }) => {
        const menu = document.querySelector("#context-menu:not([hidden])");
        if (!menu) return false;
        const box = menu.getBoundingClientRect();
        const [ox, oy] = getComputedStyle(menu).transformOrigin.split(" ").map(Number.parseFloat);
        return Math.hypot(box.left + ox - x, box.top + oy - y) <= 8;
      }, at);
    },
    undo: (page) => page.keyboard.press("Escape"),
    returned: lacks("#context-menu"),
    still: true,
  },
  {
    id: "launcher",
    title: "Lanciatore: la pillola si allarga, la scrivania si attenua",
    sources: ["src/shells/scrittoio/launcher/launcher.ts"],
    scene: "startup",
    act: (page) => press(page, "#pill"),
    started: has(".launcher-layer"),
    arrived: has(".launcher-input:focus"),
    undo: (page) => page.keyboard.press("Escape"),
    returned: lacks(".launcher-layer"),
  },
  {
    id: "peek",
    title: "Cassetto: si affaccia sfiorando il bordo, e si ritira da solo",
    sources: ["src/shells/scrittoio/frame/peek.ts"],
    scene: "narrow",
    act: (page) => hover(page, '.drawer-edge[data-edge="sidebar"]'),
    started: has("#layout.peek-sidebar"),
    arrived: has("#layout.peek-sidebar"),
    holds: true,
    undo: (page) => page.mouse.move(400, 300, { steps: 2 }),
    reversing: has("#sidebar[inert]"),
    returned: lacks("#layout.peek-sidebar"),
  },
  {
    id: "welcome-fan",
    title: "Benvenuto: i fogli dei vault recenti si aprono a ventaglio, una volta sola",
    sources: ["src/shells/scrittoio/frame/welcome.ts"],
    scene: "empty",
    // Parte al montaggio, prima che il banco possa prendere il tempo in mano:
    // si misurano l'arrivo e il residuo, e le corse dal registro di WAAPI.
    mount: true,
    act: null,
    arrived: has("#onboarding:not([hidden])"),
    undo: null,
    irreversible: "parte una volta sola, al montaggio: non c'è un gesto da invertire",
  },
  {
    id: "kit-popover",
    title: "Kit: il popover entra dal suo àncora ed esce come immagine",
    sources: ["src/kit/popover.ts"],
    scene: "kit",
    act: (page) => press(page, "#sample-menu"),
    started: has(".kit-popover"),
    arrived: has('.kit-popover [role="menuitem"]:focus'),
    undo: (page) => page.keyboard.press("Escape"),
    returned: lacks(".kit-popover"),
  },
  {
    id: "kit-hover-card",
    title: "Kit: la scheda che esce da un rimando, dopo la sosta",
    sources: ["src/kit/hover-card.ts"],
    scene: "kit",
    act: (page) => hover(page, "#sample-card"),
    started: has(".kit-hover-card"),
    arrived: has(".kit-hover-card:not([aria-hidden])"),
    holds: true,
    undo: (page) => page.mouse.move(0, 0, { steps: 2 }),
    reversing: lacks(".kit-hover-card:not([aria-hidden])"),
    returned: lacks(".kit-hover-card"),
  },
  {
    id: "kit-dialog",
    title: "Kit: il dialogo sale sopra il velo, e il velo esce come immagine",
    sources: ["src/kit/dialog.ts"],
    scene: "kit",
    act: (page) => press(page, "#sample-dialog"),
    started: has(".kit-dialog"),
    arrived: has(".kit-dialog"),
    undo: (page) => page.keyboard.press("Escape"),
    returned: (page) =>
      page.evaluate(() => document.querySelector(".kit-dialog, .kit-dialog-scrim") === null),
  },
  {
    id: "kit-tabs",
    title: "Kit: il segno delle schede scivola sotto quella scelta",
    sources: ["src/kit/tabs.ts"],
    scene: "kit",
    act: (page) => press(page, TAB(3)),
    arrived: tabChosen(3),
    undo: (page) => press(page, TAB(1)),
    returned: tabChosen(1),
  },
  {
    id: "kit-list",
    title: "Kit: l'evidenziazione scivola da una riga all'altra",
    sources: ["src/kit/list.ts"],
    scene: "kit",
    setup: (page) => page.focus("#sample-listbox"),
    act: (page) => page.keyboard.press("ArrowDown"),
    arrived: rowActive(2),
    undo: (page) => page.keyboard.press("ArrowUp"),
    returned: rowActive(1),
    track: ["#sample-listbox .kit-list-highlight"],
  },
  {
    id: "kit-press",
    title: "Kit: ciò che si preme cede, e al rilascio torna",
    sources: ["src/kit/press.ts", "src/kit/button.ts"],
    scene: "kit",
    act: (page) => press(page, ".stati .kit-button >> nth=0"),
    arrived: async () => true,
    undo: null,
    irreversible: "il gesto è già andata e ritorno: premere di nuovo è un'altra pressione, non un'inversione",
    track: [".stati .kit-button"],
  },
  {
    id: "kit-splitter",
    title: "Kit: il divisore rilasciato oltre il limite torna sul limite",
    sources: ["src/kit/splitter.ts"],
    scene: "kit",
    act: async (page) => {
      const at = await centre(page, "#sample-splitter");
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 120, at.y, { steps: 6 });
      await page.mouse.move(at.x + 260, at.y, { steps: 6 });
      await page.mouse.up();
    },
    arrived: (page) =>
      page.evaluate(() => {
        const handle = document.querySelector("#sample-splitter");
        return handle?.getAttribute("aria-valuenow") === handle?.getAttribute("aria-valuemax");
      }),
    undo: null,
    irreversible: "il ritorno segue un rilascio: riprendere la maniglia è un altro trascinamento",
    track: ["#sample-splitter"],
  },
];

/// I file che fanno partire corse di `moto` e che il banco non guarda, con la
/// ragione. Un file nuovo entra qui o in una coreografia: non c'è una terza via.
export const UNCOVERED = [
  {
    source: "src/shells/scrittoio/mobile/bottom-sheets.ts",
    reason: "è della shell mobile: il banco del moto apre la finestra da scrivania",
  },
  {
    source: "src/shells/scrittoio/views-motion.ts",
    reason: "anima le patch delle viste dichiarative, che arrivano dall'host: manca una scena che ne produca una a comando",
  },
];
