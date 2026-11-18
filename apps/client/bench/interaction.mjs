// **Il budget d'interazione**: quanto ci mette lo Scrittoio a rispondere a un
// gesto, misurato nel browser col moto pieno e con l'ora vera.
//
//     npm run bench:interaction                  # tutte, cinque giri ciascuna
//     node bench/interaction.mjs --only=palette  # solo quelle
//     node bench/interaction.mjs --rounds=9
//     node bench/interaction.mjs --only=battuta  # la battuta nelle note grandi
//     node bench/interaction.mjs --only=apertura --cpu=4  # aprire una nota grande, pagina più lenta
//     node bench/interaction.mjs --only=cambio --cpu=4    # passare da una nota piccola all'altra
//     node bench/interaction.mjs --only=impagina          # impaginare per il PDF: 5, 50, 200 pagine
//
// Per ogni interazione due numeri, dal momento del gesto (`timeStamp`
// dell'evento che lo fa partire):
//
// - **il primo fotogramma**: il primo `requestAnimationFrame` in cui ciò che il
//   gesto apre è nel documento. È il «ha sentito» di chi preme;
// - **la fine del moto**: il primo fotogramma dopo il quale non resta niente in
//   corsa, né una corsa di `moto` né un'animazione o transizione del documento.
//   È il «posso andare avanti».
//
// **La battuta** è un'altra misura: quanto costa un carattere scritto in una
// nota grande, dalla transazione al layout forzato, senza il disegno. Due note
// sintetiche (`live-fixture.ts`, 901 e 7.201 righe) in ogni modalità di
// scrittura; trenta battute e venti spostamenti del cursore di 200 caratteri.
// Il budget vale per la mediana e per il novantesimo percentile della
// battuta: una battuta su dieci lenta si sente quanto una mediana alta.
//
// **L'apertura** di una nota grande (`--only=apertura`, `live-fixture.ts`:
// 4.000 paragrafi, circa 765 KB) misura dal clic nell'albero quando la prima
// riga è nel documento e il compito più lungo della pagina finché resta
// quieta, in una pagina nuova a ogni giro. `--cpu=N` rallenta la pagina N
// volte: quattro danno, prima della resa progressiva della Live, il blocco
// misurato nella WebView dell'app vera.
//
// **Il cambio di nota** (`--only=cambio`) è il gesto più frequente: tre note
// piccole già aperte in schede (`Benvenuto.md`, la `panoramica` della Live e
// `Sintassi di Fub.md`), e a ogni giro un clic nell'albero sulla prossima. Si
// misura dal clic quando la scheda nuova è scelta col suo testo nel documento,
// e il compito più lungo fino a due fotogrammi dopo. Una pagina sola: è il
// costo fisso del cambio, non quello della prima apertura.
//
// **L'impaginazione** (`--only=impagina`) apre l'impaginatore dell'esportazione
// in PDF su note sintetiche di circa 5, 50 e 200 pagine A4 e dice la prima
// pagina pronta, tutte le pagine, il compito più lungo, la pagina sotto gli
// occhi (all'80 % della nota) dopo un cambio di margini, e il costo di un
// cambio di colore, che non deve impaginare di nuovo.
//
// Si tiene la mediana dei giri: il primo giro paga la compilazione dei moduli,
// e un giro solo non dice niente su una macchina che fa anche altro. I budget
// sono in `docs/product/performance-budget.md`; il banco esce diverso da zero
// se una mediana, o il novantesimo della battuta, li supera. Non sta nella CI: i tempi del runner condiviso non
// sono quelli di una macchina di chi scrive.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SCENE, chooseMode, sceneUrl } from "./scene.mjs";
import { openStage, openPage, prepareScene, OUTPUT } from "./stage.mjs";

const REPORT = join(OUTPUT, "interazione");
/// Quanto si aspetta la fine del moto prima di dire che non arriva (ms).
const SETTLE_LIMIT_MS = 5_000;

/// La nota che si apre dall'albero, e quella da cui si parte e a cui si torna.
const NOTE = "Guida/Nota lunga.md";
const tabOf = (doc) => `.pane.focus .tab[aria-selected="true"][data-key*="${doc}"]`;

/// Le interazioni. `first` e `settled` sono i budget in millisecondi della
/// mediana: il primo fotogramma e la fine del moto.
const INTERACTIONS = [
  {
    id: "menu",
    title: "Aprire un menu dell'applicazione",
    scene: "startup",
    // La barra dei menu si apre dal marchio, se non è già aperta.
    setup: async (page) => {
      if (!(await page.evaluate(() => document.querySelector("#app-menu.open") !== null))) await click(page, "#brand-menu");
    },
    act: (page) => click(page, "#app-menu > button >> nth=2"),
    shown: "#context-menu:not([hidden])",
    undo: async (page) => page.keyboard.press("Escape"),
    gone: "#context-menu",
    budget: { first: 100, settled: 300 },
  },
  {
    id: "palette",
    title: "Aprire la palette dei comandi (il lanciatore)",
    scene: "startup",
    act: (page) => page.keyboard.press("Control+Shift+P"),
    shown: ".launcher-input",
    undo: async (page) => page.keyboard.press("Escape"),
    gone: "body:not(:has(.launcher-layer))",
    budget: { first: 100, settled: 700 },
  },
  {
    id: "nota",
    title: "Aprire una nota dall'albero",
    scene: "startup",
    // La cartella si apre una volta; poi si apre la nota e si torna indietro.
    prepare: (page) => click(page, '#sidebar li[role="treeitem"][data-path="Guida"] .chevron'),
    act: (page) => click(page, `#sidebar .tree-row[data-path="${NOTE}"]`),
    shown: tabOf(NOTE),
    undo: (page) => click(page, '#sidebar .tree-row[data-path="Benvenuto.md"]'),
    gone: tabOf("Benvenuto.md"),
    budget: { first: 100, settled: 700 },
  },
];

/// La battuta: le note, per numero di sezioni, e le modalità in cui si
/// scrive. `schede-20` è la nota di cinquanta sezioni con venti fogli vivi
/// dentro (T43, A-5): la battuta resta nel budget anche con le schede. Il budget vale per la mediana e il novantesimo della battuta, in
/// millisecondi.
const TYPING = {
  id: "battuta",
  title: "Una battuta in una nota grande",
  notes: [50, 400, "schede-20"],
  modes: [
    ["source", "Sorgente"],
    ["live_preview", "Scrittura"],
  ],
  keystrokes: 30,
  moves: 20,
  budget: { median: 4, p90: 8 },
};

/// L'apertura di una nota grande: il caso della Live `lunga-4000`, 4.000
/// paragrafi e circa 765 KB. Il budget vale per la mediana dei giri, in
/// millisecondi: il testo in cima visibile e il compito più lungo.
const OPENING = {
  id: "apertura",
  title: "Aprire una nota grande (4.000 paragrafi, 765 KB)",
  note: "lunga-4000",
  budget: { visible: 150, longest: 50 },
};

/// Il cambio fra note piccole già aperte. Il budget vale per la mediana dei
/// giri, in millisecondi: la scheda nuova col suo testo, e il compito più lungo.
const SWITCH = {
  id: "cambio",
  title: "Passare da una nota piccola all'altra",
  notes: ["Benvenuto.md", "Guida/Live.md", "Guida/Sintassi di Fub.md"],
  budget: { visible: 100, longest: 50 },
};

/// L'impaginatore dell'esportazione in PDF (`src/export/paginate/slices.ts`)
/// su note sintetiche di 5, 50 e 200 pagine A4. Il budget, in millisecondi,
/// vale per la mediana della pagina sotto gli occhi: cambiati i margini mentre
/// si guarda una pagina verso la fine, quando quella pagina è di nuovo pronta.
const PAGINATION = {
  id: "impagina",
  title: "Impaginare per l'esportazione in PDF",
  pages: [5, 50, 200],
  budget: { underEyes: 100 },
};

const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .filter(Boolean);
const rounds = Number(process.argv.find((arg) => arg.startsWith("--rounds="))?.slice("--rounds=".length) ?? 5);
const cpu = Number(process.argv.find((arg) => arg.startsWith("--cpu="))?.slice("--cpu=".length) ?? 1);

async function click(page, selector) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: SETTLE_LIMIT_MS });
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`non si vede: ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/// Arma la misura nella pagina prima del gesto: il primo evento d'ingresso
/// fissa l'origine, un giro di fotogrammi guarda quando compare `shown` e
/// quando tutto si ferma.
function arm(shown) {
  const moto = import("/src/moto/index.ts");
  const caret = (animation) =>
    animation.effect?.target instanceof Element && animation.effect.target.closest(".cm-cursorLayer") !== null;
  const running = () =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === "running" && !caret(animation)).length;
  const result = { start: null, first: null, settled: null };
  const mark = (event) => {
    if (result.start === null) result.start = event.timeStamp;
  };
  for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, mark, { capture: true, once: true });
  window.__interazione = new Promise((resolve) => {
    const limit = performance.now() + 30_000;
    const tick = async (now) => {
      const { activeMotions } = await moto;
      if (result.start !== null) {
        if (result.first === null && document.querySelector(shown)) result.first = now;
        if (result.first !== null && activeMotions() === 0 && running() === 0) {
          result.settled = now;
          resolve(result);
          return;
        }
      }
      if (now > limit) {
        resolve(result);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function quiet(page, selector) {
  await page.waitForFunction((s) => document.querySelector(s) !== null, selector, { timeout: SETTLE_LIMIT_MS });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const check = () =>
          document.getAnimations().every((a) => a.playState !== "running" || a.effect?.target?.closest?.(".cm-cursorLayer"))
            ? resolve()
            : requestAnimationFrame(check);
        requestAnimationFrame(check);
      }),
  );
}

async function measure(stage, interaction, scene) {
  const page = await openPage(stage.browser, "dark", { clock: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const samples = [];
  try {
    await prepareScene(page, scene, "dark", stage.base, sceneUrl);
    if (interaction.prepare) {
      await interaction.prepare(page);
      await page.mouse.move(0, 0);
    }
    for (let round = 0; round < rounds; round += 1) {
      if (interaction.setup) await interaction.setup(page);
      await page.evaluate(arm, interaction.shown);
      await interaction.act(page);
      const result = await page.evaluate(() => window.__interazione);
      if (result.start === null || result.first === null || result.settled === null) {
        throw new Error(`giro ${round + 1}: ${result.first === null ? "non è comparso niente" : "il moto non si ferma"}`);
      }
      samples.push({ first: result.first - result.start, settled: result.settled - result.start });
      await interaction.undo(page);
      await quiet(page, interaction.gone);
      await page.mouse.move(0, 0);
    }
  } finally {
    await page.context().close();
  }
  const median = (key) => {
    const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const first = Math.round(median("first"));
  const settled = Math.round(median("settled"));
  return {
    id: interaction.id,
    title: interaction.title,
    budget: interaction.budget,
    first,
    settled,
    samples: samples.map((s) => ({ first: Math.round(s.first), settled: Math.round(s.settled) })),
    pass: first <= interaction.budget.first && settled <= interaction.budget.settled,
  };
}

/// Apre la nota sintetica nella modalità data e misura battute e cursore.
async function measureTyping(stage, sections, mode) {
  // Le schede di foglio leggono la cartella del banco (`workbook=1`).
  const cards = typeof sections === "string";
  const scene = { id: `battuta-${sections}`, query: `live=battuta-${sections}${cards ? "&workbook=1" : ""}`, prepare: async () => {} };
  const page = await openPage(stage.browser, "dark", { clock: false });
  try {
    await prepareScene(page, scene, "dark", stage.base, sceneUrl);
    await click(page, '#sidebar li[role="treeitem"][data-path="Guida"] .chevron');
    await click(page, '#sidebar .tree-row[data-path="Guida/Live.md"]');
    await page.waitForSelector(tabOf("Guida/Live.md"));
    await chooseMode(page, mode);
    await page.waitForSelector(`.pane.focus[data-mode="${mode}"] .pane-editor .cm-content`);
    // Scrittura ha i Blocchi dentro: si misura con le maniglie montate.
    if (mode === "live_preview") await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles", { state: "attached" });
    // Le schede vive sono montate prima di scrivere: si misura con loro.
    if (cards && mode === "live_preview") await page.waitForSelector('.pane.focus .pane-editor .live-card[data-card-kind="sheet"][data-card-state="view"]');
    return await page.evaluate(async ({ keystrokes, moves }) => {
      const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
      const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      // La nota si assesta prima: il primo parse e la prima resa non sono
      // battute.
      for (let i = 0; i < 30; i += 1) await frame();
      view.dispatch({ selection: { anchor: globalThis.__fubLiveBench.cursor }, scrollIntoView: true });
      view.focus();
      for (let i = 0; i < 30; i += 1) await frame();
      const typed = [];
      for (let k = 0; k < keystrokes; k += 1) {
        const head = view.state.selection.main.head;
        const start = performance.now();
        view.dispatch({ changes: { from: head, insert: "a" }, selection: { anchor: head + 1 }, userEvent: "input.type" });
        view.dom.getBoundingClientRect();
        typed.push(performance.now() - start);
        await frame();
      }
      const moved = [];
      for (let k = 0; k < moves; k += 1) {
        const head = view.state.selection.main.head;
        const start = performance.now();
        view.dispatch({ selection: { anchor: k % 2 ? head + 200 : Math.max(0, head - 200) } });
        view.dom.getBoundingClientRect();
        moved.push(performance.now() - start);
        await frame();
      }
      const stats = (samples) => {
        const sorted = [...samples].sort((a, b) => a - b);
        const round = (n) => Math.round(n * 10) / 10;
        return {
          median: round(sorted[Math.floor(sorted.length / 2)]),
          p90: round(sorted[Math.floor(sorted.length * 0.9)]),
          max: round(sorted[sorted.length - 1]),
        };
      };
      return { lines: view.state.doc.lines, chars: view.state.doc.length, type: stats(typed), move: stats(moved) };
    }, { keystrokes: TYPING.keystrokes, moves: TYPING.moves });
  } finally {
    await page.context().close();
  }
}

/// Apre la nota grande dall'albero, in una pagina nuova a ogni giro, e misura
/// dal clic: quando la prima riga della nota è nel documento, e il compito più
/// lungo (Long Tasks API: ogni compito oltre i 50 ms) finché la pagina non
/// resta quieta. `--cpu=N` rallenta la pagina N volte, come una WebView più
/// lenta di Chromium.
async function measureOpening(stage) {
  const scene = { id: OPENING.note, query: `live=${OPENING.note}`, prepare: async () => {} };
  const samples = [];
  for (let round = 0; round < rounds; round += 1) {
    const page = await openPage(stage.browser, "dark", { clock: false });
    try {
      await prepareScene(page, scene, "dark", stage.base, sceneUrl);
      await click(page, '#sidebar li[role="treeitem"][data-path="Guida"] .chevron');
      await page.locator('#sidebar .tree-row[data-path="Guida/Live.md"]').first().waitFor({ state: "visible" });
      if (cpu > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.evaluate(() => {
        const result = { start: null, visible: null, tasks: [] };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) result.tasks.push({ start: entry.startTime, duration: entry.duration });
        }).observe({ type: "longtask" });
        window.__apertura = new Promise((resolve) => {
          document.addEventListener("pointerdown", (event) => {
            result.start = event.timeStamp;
            let quietSince = performance.now();
            let last = performance.now();
            const tick = (now) => {
              if (result.visible === null && [...document.querySelectorAll(".pane.focus .pane-editor .cm-line")]
                .some((line) => line.textContent.startsWith("Paragrafo 1:"))) result.visible = now;
              // Quieta: mezzo secondo di fotogrammi brevi, dopo il testo.
              if (now - last > 50) quietSince = now;
              last = now;
              if ((result.visible !== null && now - quietSince > 500) || now - result.start > 10_000) resolve(result);
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }, { capture: true, once: true });
        });
      });
      await click(page, '#sidebar .tree-row[data-path="Guida/Live.md"]');
      const result = await page.evaluate(() => window.__apertura);
      if (result.visible === null) throw new Error(`giro ${round + 1}: la nota non si vede in 10 s`);
      const tasks = result.tasks.filter((task) => task.start + task.duration >= result.start);
      samples.push({
        visible: result.visible - result.start,
        longest: Math.max(0, ...tasks.map((task) => task.duration)),
        tasks: tasks.length,
      });
    } finally {
      await page.context().close();
    }
  }
  const median = (key) => {
    const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
  };
  const visible = median("visible");
  const longest = median("longest");
  return {
    id: OPENING.id,
    title: OPENING.title,
    budget: OPENING.budget,
    cpu,
    visible,
    longest,
    samples: samples.map((s) => ({ visible: Math.round(s.visible), longest: Math.round(s.longest), tasks: s.tasks })),
    pass: visible <= OPENING.budget.visible && longest <= OPENING.budget.longest,
  };
}

/// Passa fra le note piccole di `SWITCH`, già aperte, con un clic nell'albero
/// a giro, e misura dal clic: quando la scheda nuova è quella scelta e il suo
/// editor ha il testo nel documento, e il compito più lungo (Long Tasks API)
/// fino a due fotogrammi dopo, che comprendono la misura dell'editor.
/// `--cpu=N` come per l'apertura.
async function measureSwitch(stage) {
  const scene = { id: "cambio", query: "live=panoramica", prepare: async () => {} };
  const page = await openPage(stage.browser, "dark", { clock: false });
  const samples = [];
  try {
    await prepareScene(page, scene, "dark", stage.base, sceneUrl);
    await click(page, '#sidebar li[role="treeitem"][data-path="Guida"] .chevron');
    // La prima apertura di ciascuna paga i moduli e la sessione: non si misura.
    for (const note of SWITCH.notes) {
      await click(page, `#sidebar .tree-row[data-path="${note}"]`);
      await page.waitForSelector(tabOf(note));
      await page.waitForSelector(".pane.focus .pane-editor .cm-content");
      await page.waitForTimeout(300);
    }
    if (cpu > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await page.evaluate(() => {
      window.__compiti = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__compiti.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask" });
    });
    for (let round = 0; round < rounds * 2; round += 1) {
      const note = SWITCH.notes[round % SWITCH.notes.length];
      await page.evaluate((note) => {
        window.__compiti = [];
        window.__cambio = new Promise((resolve) => {
          const result = { start: null, visible: null };
          document.addEventListener("pointerdown", (event) => {
            result.start = event.timeStamp;
            const tick = (now) => {
              const tab = document.querySelector('.pane.focus .tab[aria-selected="true"]');
              const content = document.querySelector(".pane.focus .pane-editor .cm-content");
              if (result.visible === null && tab?.dataset.key?.includes(JSON.stringify(note)) && (content?.textContent ?? "") !== "") {
                result.visible = now;
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)));
                return;
              }
              if (now - result.start > 10_000) resolve(result);
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }, { capture: true, once: true });
        });
      }, note);
      await click(page, `#sidebar .tree-row[data-path="${note}"]`);
      const result = await page.evaluate(() => window.__cambio);
      if (result.visible === null) throw new Error(`giro ${round + 1}: «${note}» non si vede in 10 s`);
      const tasks = await page.evaluate((start) => window.__compiti.filter((task) => task.start + task.duration >= start), result.start);
      samples.push({ visible: result.visible - result.start, longest: Math.max(0, ...tasks.map((task) => task.duration)) });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
    }
  } finally {
    await page.context().close();
  }
  const median = (key) => {
    const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
  };
  const visible = median("visible");
  const longest = median("longest");
  return {
    id: SWITCH.id,
    title: SWITCH.title,
    budget: SWITCH.budget,
    cpu,
    visible,
    longest,
    samples: samples.map((s) => ({ visible: Math.round(s.visible), longest: Math.round(s.longest) })),
    pass: visible <= SWITCH.budget.visible && longest <= SWITCH.budget.longest,
  };
}

/// Ciò che `measurePagination` fa nella pagina: impagina la nota sintetica
/// e torna le mediane dei giri.
const paginationProbe = async ({ target, rounds }) => {
  const { PrintPaginator } = await import("/src/export/paginate/slices.ts");
  const { A4 } = await import("/src/export/probe.ts");
  const { renderMarkdown } = await import("/src/editors/text/profiles/markdown/render.ts");
  const { MARKDOWN_SYNTAX } = await import("/src/rules/syntax.generated.ts");
  const words = ("la nota si scrive in markdown e resta un file che ogni programma legge mentre fub la impagina " +
    "per la stampa con titoli tabelle codice e formule senza perdere niente di quello che chi scrive ha messo").split(" ");
  let seed = 7;
  const word = () => words[(seed = (seed * 1103515245 + 12345) % 2147483648) % words.length];
  const sentence = (n) => Array.from({ length: n }, word).join(" ");
  // Una sezione: un titolo, paragrafi lunghi e corti, un elenco, e ogni
  // tanto una tabella o un blocco di codice.
  const note = (sections) => {
    seed = 7;
    const out = ["# Nota lunga", ""];
    for (let s = 0; s < sections; s++) {
      out.push(`## Sezione ${s + 1}`, "", sentence(90), "", sentence(40), "", `- ${sentence(12)}`, `- ${sentence(20)}`, `- ${sentence(8)}`, "", sentence(140), "");
      if (s % 3 === 1) out.push("```js", ...Array.from({ length: 8 }, (_, k) => `const riga${k} = ${k} * ${s};`), "```", "");
      if (s % 5 === 2) out.push("| Voce | Valore | Nota |", "|---|---|---|", ...Array.from({ length: 6 }, (_, k) => `| ${word()} | ${k * s} | ${sentence(4)} |`), "");
    }
    return out.join("\n");
  };
  const settings = (margin, link = "#145785") => ({
    layout: { page: { ...A4, margin: { top: margin, right: margin, bottom: margin, left: margin } }, columns: 1, columnGap: 24, breaks: { everyHeading2: false, separator: false }, type: {}, excluded: [] },
    look: { colors: { "--doc-link": link } },
  });
  const longest = { value: 0, on: false };
  new PerformanceObserver((list) => {
    if (longest.on) for (const entry of list.getEntries()) longest.value = Math.max(longest.value, entry.duration);
  }).observe({ type: "longtask" });
  /// Un'apertura: torna i tempi e il paginatore, a lavoro finito.
  const open = (md) => new Promise((resolve, reject) => {
    const times = { first: null, final: null, pages: 0, render: 0 };
    let waiter = null;
    const start = performance.now();
    const p = new PrintPaginator({
      doc: "nota.md",
      title: "Nota lunga",
      render: async () => {
        // La resa la fa il core nell'app vera: qui è il Markdown del client, e si conta a parte.
        const t = performance.now();
        const html = renderMarkdown(md, MARKDOWN_SYNTAX).html;
        times.render = performance.now() - t;
        return { html, parts: [] };
      },
      settings: settings(72),
      onUpdate: (result) => {
        const now = performance.now();
        if (times.first === null && result.ready > 0) times.first = now - start;
        if (result.final && times.final === null) {
          times.final = now - start;
          times.pages = result.total;
          resolve({ p, times, start });
        }
        waiter?.(result, now);
      },
      onError: reject,
    });
    p.waitOn = (fn) => { waiter = fn; };
    p.open().catch(reject);
  });
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  // La taratura: quante sezioni fanno `target` pagine.
  let sections = Math.max(1, Math.round(target * 1.2));
  for (let k = 0; k < 2; k++) {
    const { p, times } = await open(note(sections));
    p.dispose();
    sections = Math.max(1, Math.round((sections * target) / times.pages));
  }
  const md = note(sections);
  const samples = [];
  for (let round = 0; round < rounds; round++) {
    longest.value = 0;
    longest.on = true;
    const { p, times } = await open(md);
    longest.on = false;
    const far = Math.max(0, Math.floor(times.pages * 0.8) - 1);
    p.setVisible({ first: far, last: far });
    // Il cambio di margini mentre si guarda la pagina lontana.
    const underEyes = await new Promise((resolve) => {
      const t0 = performance.now();
      p.waitOn((result, now) => {
        if (result.ready > far) resolve(now - t0);
      });
      p.update(settings(90));
    });
    // Il resto finisce prima del colore, perché il colore si misuri da solo
    // (su una nota corta la pubblicazione che arriva sotto gli occhi è già
    // quella finale, e non ne verrà un'altra).
    if (!p.result?.final) await new Promise((resolve) => p.waitOn((result) => { if (result.final) resolve(); }));
    const layouts = p.layouts;
    const t1 = performance.now();
    p.update(settings(90, "#aa0000"));
    const color = performance.now() - t1;
    const relayout = p.layouts !== layouts;
    p.dispose();
    samples.push({ ...times, underEyes, color, relayout, longest: longest.value });
  }
  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    pages: samples[0].pages,
    blocks: md.split("\n\n").length,
    first: round1(median(samples.map((s) => s.first))),
    render: round1(median(samples.map((s) => s.render))),
    final: round1(median(samples.map((s) => s.final))),
    underEyes: round1(median(samples.map((s) => s.underEyes))),
    color: round1(median(samples.map((s) => s.color))),
    relayoutOnColor: samples.some((s) => s.relayout),
    longest: round1(median(samples.map((s) => s.longest))),
  };
};

/// Impagina una nota sintetica di circa `target` pagine, a ogni giro da capo,
/// e misura dall'apertura: la prima pagina pronta, tutte le pagine col loro
/// totale, il compito più lungo; poi, guardando una pagina all'80 %, quanto ci
/// mette a tornare pronta dopo un cambio di margini, e quanto costa un cambio
/// di colore (che non deve impaginare di nuovo).
async function measurePagination(stage, target) {
  const scene = SCENE.find((candidate) => candidate.id === "startup");
  const page = await openPage(stage.browser, "light", { clock: false });
  try {
    await prepareScene(page, scene, "light", stage.base, sceneUrl);
    if (cpu > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
    return await page.evaluate(paginationProbe, { target, rounds });
  } finally {
    await page.context().close();
  }
}

const chosen = only ? INTERACTIONS.filter((i) => only.includes(i.id)) : INTERACTIONS;
const paginating = !only || only.includes(PAGINATION.id);
const typing = !only || only.includes(TYPING.id);
const opening = !only || only.includes(OPENING.id);
const switching = !only || only.includes(SWITCH.id);
await mkdir(REPORT, { recursive: true });
const stage = await openStage();
const report = [];
try {
  for (const interaction of chosen) {
    const scene = SCENE.find((candidate) => candidate.id === interaction.scene);
    let row;
    try {
      if (!scene) throw new Error(`la scena «${interaction.scene}» non c'è`);
      row = await measure(stage, interaction, scene);
    } catch (error) {
      row = { id: interaction.id, title: interaction.title, pass: false, error: String(error?.message ?? error).split("\n")[0] };
    }
    report.push(row);
    if (row.error) {
      console.log(`✗ ${row.id} — ${row.title}\n    non misurata: ${row.error}`);
      continue;
    }
    console.log(
      `${row.pass ? "·" : "✗"} ${row.id} — ${row.title}\n` +
        `    primo fotogramma ${row.first} ms (≤ ${row.budget.first}) · fine del moto ${row.settled} ms (≤ ${row.budget.settled})`,
    );
  }
  if (typing) {
    for (const sections of TYPING.notes) {
      for (const [mode, label] of TYPING.modes) {
        let row;
        try {
          const result = await measureTyping(stage, sections, mode);
          row = {
            id: `${TYPING.id}-${typeof sections === "string" ? sections : result.lines}-${mode}`,
            title: `${TYPING.title}: ${result.lines} righe${typeof sections === "string" ? ", venti schede di foglio" : ""}, ${label}`,
            budget: { type: TYPING.budget },
            ...result,
            pass: result.type.median <= TYPING.budget.median && result.type.p90 <= TYPING.budget.p90,
          };
        } catch (error) {
          row = { id: `${TYPING.id}-${sections}-${mode}`, title: `${TYPING.title}: ${label}`, pass: false, error: String(error?.message ?? error).split("\n")[0] };
        }
        report.push(row);
        if (row.error) {
          console.log(`✗ ${row.id} — ${row.title}\n    non misurata: ${row.error}`);
          continue;
        }
        const ms = (s) => `${s.median} · ${s.p90} · ${s.max} ms`;
        console.log(
          `${row.pass ? "·" : "✗"} ${row.id} — ${row.title}\n` +
            `    battuta ${ms(row.type)} (mediana ≤ ${TYPING.budget.median}, novantesimo ≤ ${TYPING.budget.p90}) · cursore ${ms(row.move)}`,
        );
      }
    }
  }
  if (opening) {
    let row;
    try {
      row = await measureOpening(stage);
    } catch (error) {
      row = { id: OPENING.id, title: OPENING.title, pass: false, error: String(error?.message ?? error).split("\n")[0] };
    }
    report.push(row);
    if (row.error) console.log(`✗ ${row.id} — ${row.title}\n    non misurata: ${row.error}`);
    else {
      console.log(
        `${row.pass ? "·" : "✗"} ${row.id} — ${row.title}${row.cpu > 1 ? ` (pagina ${row.cpu} volte più lenta)` : ""}\n` +
          `    testo visibile ${row.visible} ms (≤ ${row.budget.visible}) · compito più lungo ${row.longest} ms (≤ ${row.budget.longest})`,
      );
    }
  }
  if (switching) {
    let row;
    try {
      row = await measureSwitch(stage);
    } catch (error) {
      row = { id: SWITCH.id, title: SWITCH.title, pass: false, error: String(error?.message ?? error).split("\n")[0] };
    }
    report.push(row);
    if (row.error) console.log(`✗ ${row.id} — ${row.title}\n    non misurata: ${row.error}`);
    else {
      console.log(
        `${row.pass ? "·" : "✗"} ${row.id} — ${row.title}${row.cpu > 1 ? ` (pagina ${row.cpu} volte più lenta)` : ""}\n` +
          `    scheda col testo ${row.visible} ms (≤ ${row.budget.visible}) · compito più lungo ${row.longest} ms (≤ ${row.budget.longest})`,
      );
    }
  }
  if (paginating) {
    for (const target of PAGINATION.pages) {
      let row;
      try {
        const result = await measurePagination(stage, target);
        row = {
          id: `${PAGINATION.id}-${target}`,
          title: `${PAGINATION.title}: ${result.pages} pagine`,
          budget: PAGINATION.budget,
          cpu,
          ...result,
          pass: result.underEyes <= PAGINATION.budget.underEyes && !result.relayoutOnColor,
        };
      } catch (error) {
        row = { id: `${PAGINATION.id}-${target}`, title: PAGINATION.title, pass: false, error: String(error?.message ?? error).split("\n")[0] };
      }
      report.push(row);
      if (row.error) {
        console.log(`✗ ${row.id} — ${row.title}\n    non misurata: ${row.error}`);
        continue;
      }
      console.log(
        `${row.pass ? "·" : "✗"} ${row.id} — ${row.title}${row.cpu > 1 ? ` (pagina ${row.cpu} volte più lenta)` : ""}\n` +
          `    prima pagina ${row.first} ms (di cui la resa del Markdown ${row.render} ms, nell'app la fa il core) · tutte ${row.final} ms · sotto gli occhi dopo i margini ${row.underEyes} ms (≤ ${row.budget.underEyes})` +
          ` · colore ${row.color} ms${row.relayoutOnColor ? " (ha impaginato di nuovo!)" : ""} · compito più lungo ${row.longest} ms`,
      );
    }
  }
} finally {
  await stage.close();
}
await writeFile(join(REPORT, "interazione.json"), `${JSON.stringify({ rounds, report }, null, 2)}\n`);
const failed = report.filter((row) => !row.pass);
console.log(`${report.length - failed.length}/${report.length} interazioni nel budget`);
process.exit(failed.length > 0 ? 1 : 0);
