// **Il budget d'interazione**: quanto ci mette lo Scrittoio a rispondere a un
// gesto, misurato nel browser col moto pieno e con l'ora vera.
//
//     npm run bench:interaction                  # tutte, cinque giri ciascuna
//     node bench/interaction.mjs --only=palette  # solo quelle
//     node bench/interaction.mjs --rounds=9
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

const chosen = only ? INTERACTIONS.filter((i) => only.includes(i.id)) : INTERACTIONS;
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
} finally {
  await stage.close();
}
await writeFile(join(REPORT, "interazione.json"), `${JSON.stringify({ rounds, report }, null, 2)}\n`);
const failed = report.filter((row) => !row.pass);
console.log(`${report.length - failed.length}/${report.length} interazioni nel budget`);
process.exit(failed.length > 0 ? 1 : 0);
