// **Il budget d'interazione**: quanto ci mette lo Scrittoio a rispondere a un
// gesto, misurato nel browser col moto pieno e con l'ora vera.
//
//     npm run bench:interaction                  # tutte, cinque giri ciascuna
//     node bench/interaction.mjs --only=palette  # solo quelle
//     node bench/interaction.mjs --rounds=9
//     node bench/interaction.mjs --only=battuta  # la battuta nelle note grandi
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
// Il budget è la mediana della battuta.
//
// Si tiene la mediana dei giri: il primo giro paga la compilazione dei moduli,
// e un giro solo non dice niente su una macchina che fa anche altro. I budget
// sono in `docs/product/performance-budget.md`; il banco esce diverso da zero
// se una mediana li supera. Non sta nella CI: i tempi del runner condiviso non
// sono quelli di una macchina di chi scrive.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SCENE, sceneUrl } from "./scene.mjs";
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
/// scrive. Il budget vale per la mediana della battuta, in millisecondi.
const TYPING = {
  id: "battuta",
  title: "Una battuta in una nota grande",
  notes: [50, 400],
  modes: [
    ["source", "Sorgente"],
    ["live_preview", "Live"],
    ["blocks", "Blocchi"],
  ],
  keystrokes: 30,
  moves: 20,
  budget: 4,
};

const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .filter(Boolean);
const rounds = Number(process.argv.find((arg) => arg.startsWith("--rounds="))?.slice("--rounds=".length) ?? 5);

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
  const scene = { id: `battuta-${sections}`, query: `live=battuta-${sections}`, prepare: async () => {} };
  const page = await openPage(stage.browser, "dark", { clock: false });
  try {
    await prepareScene(page, scene, "dark", stage.base, sceneUrl);
    await click(page, '#sidebar li[role="treeitem"][data-path="Guida"] .chevron');
    await click(page, '#sidebar .tree-row[data-path="Guida/Live.md"]');
    await page.waitForSelector(tabOf("Guida/Live.md"));
    await click(page, `.pane.focus .pane-toolbar button[data-mode="${mode}"]`);
    await page.waitForSelector(`.pane.focus[data-mode="${mode}"] .cm-content`);
    // I Blocchi arrivano in un pezzo a parte: si misura quando ci sono.
    if (mode === "blocks") await page.waitForSelector(".pane.focus .cm-fub-block-handles", { state: "attached" });
    return await page.evaluate(async ({ keystrokes, moves }) => {
      const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
      const view = findTextEditorOrThrow(document.querySelector(".pane.focus .cm-editor").parentElement);
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

const chosen = only ? INTERACTIONS.filter((i) => only.includes(i.id)) : INTERACTIONS;
const typing = !only || only.includes(TYPING.id);
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
            id: `${TYPING.id}-${result.lines}-${mode}`,
            title: `${TYPING.title}: ${result.lines} righe, ${label}`,
            budget: { type: TYPING.budget },
            ...result,
            pass: result.type.median <= TYPING.budget,
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
            `    battuta ${ms(row.type)} (mediana ≤ ${TYPING.budget}) · cursore ${ms(row.move)}`,
        );
      }
    }
  }
} finally {
  await stage.close();
}
await writeFile(join(REPORT, "interazione.json"), `${JSON.stringify({ rounds, report }, null, 2)}\n`);
const failed = report.filter((row) => !row.pass);
console.log(`${report.length - failed.length}/${report.length} interazioni nel budget`);
process.exit(failed.length > 0 ? 1 : 0);
