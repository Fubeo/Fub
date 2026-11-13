// **Il banco dell'albero**: quanto ci mette l'esplora di un vault da
// cinquemila file a disegnarsi, ad aprire la sua cartella più grande, a
// scorrere fino in fondo e a trovare una nota per nome.
//
//     npm run bench:tree                      # a velocità normale e con la pagina quattro volte più lenta
//     npm run bench:tree -- --cpu 4           # solo la pagina quattro volte più lenta
//     npm run bench:tree -- --port 1454 --strictPort
//
// Il vault è quello di `vault-fixture.ts`: cinquemila note in cinque cartelle,
// una da milleecinquecento, più una catena di dieci cartelle annidate e un nome
// lungo. La pagina del banco lo apre nell'app vera (`?vault=5000`, in
// `fake-ipc.ts`), con le impostazioni di partenza: l'albero non legge nessun
// livello del disegno (ADR 0231), quindi il «livello Standard» del piano non
// è un'impostazione che l'albero veda. Il moto è quello di sistema, cioè
// acceso: il moto dell'albero, che è un FLIP, è parte del costo, e il banco
// non lo spegne come fanno le foto.
//
// # Che cosa misura
//
// 1. **Il primo disegno**: dall'arrivo dell'elenco della radice (la risposta
//    dell'indice, `TREE_ARRIVALS`) al primo fotogramma dipinto con le cinque
//    cartelle. Il banco lo legge dalla pagina, che si accorge del primo nodo
//    dell'albero e lo fa dipingere con un fotogramma e un messaggio, come
//    `large.mjs`.
// 2. **Aprire «Archivio»**: un clic sulla cartella da milleecinquecento note.
//    Dal clic al fotogramma con le sue righe e la riga «altre voci»; e il
//    fotogramma più lungo, fino a mezzo secondo dopo che è dipinta.
// 3. **Scorrere fino in fondo**: la rotella sull'albero, passi di 240 pixel,
//    fino all'ultima riga. Il fotogramma più lungo.
// 4. **Cercare un nome**: Ctrl+O, che in questa shell apre il lanciatore nel
//    modo dei file, poi il nome di una nota a tasti. Dall'ultimo tasto
//    all'elenco dipinto con la nota. Il freno di 120 ms del lanciatore è
//    dentro questo tempo.
// 5. **I casi ai margini**: la cartella «Bozze» e poi le dieci cartelle della
//    catena, una alla volta, fino alla nota in fondo. Si misurano, senza
//    soglia: il piano non ne dà una.
// 6. **La prova del banco**: una pagina occupata per 150 ms dentro una corsa
//    deve comparire come fotogramma lento. Senza, il banco non vede più i
//    fotogrammi, e il suo verde non vale niente.
//
// # Le soglie
//
// Valgono a velocità normale e con la pagina quattro volte più lenta (per
// `Emulation.setCPUThrottlingRate`, dal caricamento, non dopo: il primo
// disegno nasce già rallentato):
//
// - il primo disegno entro 300 ms dall'arrivo dell'elenco;
// - nessun fotogramma oltre 100 ms aprendo la cartella da milleecinquecento;
// - nessun fotogramma oltre 50 ms scorrendo fino in fondo.
//
// La ricerca e i casi ai margini si scrivono nel referto, senza soglia.
//
// Un fotogramma è il tempo fra due `requestAnimationFrame`: il tempo che la
// pagina impiega a fare un giro. Un compito che tiene la pagina occupata per
// più di quel tempo si vede come fotogramma lungo. I compiti lunghi della Long
// Tasks API non si usano: in questa Chromium non compaiono neanche per un ciclo
// occupato di 150 ms (vedi `selfTest`).
//
// Il referto, con ogni misura, sta in `.output/tree.json`
// (`tree-cpu4.json` quando si chiede solo la pagina lenta).

import * as os from "node:os";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openStage, openPage, OUTPUT } from "./stage.mjs";

/// Quanti file ha il vault del banco: come `TREE_TOTAL` di `vault-fixture.ts`.
const VAULT_FILES = 5_000;
/// Le soglie, in millisecondi (vedi sopra).
const FIRST_DRAW_LIMIT_MS = 300;
const OPEN_FRAME_LIMIT_MS = 100;
const SCROLL_FRAME_LIMIT_MS = 50;
/// Le velocità che il banco misura se non gliene si dice altre: normale e
/// quattro volte più lenta. Il piano le vuole tutte e due.
const DEFAULT_CPUS = [1, 4];
/// Di quanto, al più, `--cpu` rallenta la pagina.
const CPU_LIMIT = 20;
/// Quanto dev'essere fermo l'albero, senza risposte nuove dall'indice, prima
/// di una misura; e quanto si aspetta, al più, quella quiete.
const QUIET_MS = 500;
const QUIET_TIMEOUT_MS = 60_000;
/// Quanto si guarda la pagina dopo che un'apertura è dipinta, prima di
/// smettere di contare i fotogrammi.
const TAIL_MS = 500;
/// La scorrimento: quanti pixel per passo della rotella, e quanti passi al
/// più prima di dire che la cartella non arriva in fondo.
const WHEEL_PX = 240;
const SCROLL_STEPS_LIMIT = 400;
/// La pagina occupata della prova del banco, in millisecondi.
const PLANTED_MS = 150;
/// Quanto si aspetta, al più, che la pagina arrivi al primo disegno e che un
/// elemento si dipinga.
const OPEN_TIMEOUT_MS = 120_000;
const PAINT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Gli argomenti.
// ---------------------------------------------------------------------------

/// Il valore di `--nome 4` o `--nome=4`, se c'è.
function optionValue(argv, name) {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return argv[i].includes("=") ? argv[i].slice(name.length + 1) : argv[i + 1];
}

function args(argv) {
  const cpuText = optionValue(argv, "--cpu");
  const cpus = cpuText === undefined ? DEFAULT_CPUS : cpuText.split(",").map(Number);
  if (cpus.some((cpu) => !Number.isInteger(cpu) || cpu < 1 || cpu > CPU_LIMIT)) {
    throw new RangeError(`--cpu vuole uno o più numeri da 1 a ${CPU_LIMIT}, separati da virgole`);
  }
  if (new Set(cpus).size !== cpus.length) throw new RangeError("--cpu ripete una velocità");
  const portText = optionValue(argv, "--port");
  const port = portText === undefined ? undefined : Number(portText);
  if (portText !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
    throw new RangeError(`--port ${portText}: non è una porta`);
  }
  return { cpus, port, strictPort: argv.includes("--strictPort") };
}

// ---------------------------------------------------------------------------
// La sonda, nella pagina.
// ---------------------------------------------------------------------------

/// Mette nella pagina la sonda, `window.__treeProbe`, **prima** che l'app parta
/// (`addInitScript`): così il primo disegno dell'albero si vede. Registra il
/// primo nodo dell'albero e il fotogramma in cui è dipinto; i clic, e le lettere
/// della ricerca; e, fra `start` e `stop`, ogni fotogramma.
///
/// È una funzione che Playwright copia come testo: non può usare niente di
/// questo file.
function probeScript() {
  const probe = {
    firstDraw: null,
    clickAt: null,
    lastInputAt: null,
    scroller: null,
    startedAt: 0,
    token: null,
    frames: [],
  };
  window.__treeProbe = probe;

  // Dopo il fotogramma dipinto: il messaggio arriva quando il fotogramma ha
  // finito stile, layout e pittura, come in `large.mjs`.
  const afterPaint = (callback) =>
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        callback(performance.now());
      };
      channel.port2.postMessage(null);
    });

  // Il primo nodo dell'albero entra nel DOM: da lì, un fotogramma dopo, è
  // dipinto. Dopo di che la sonda smette di guardare.
  const observer = new MutationObserver(() => {
    if (probe.firstDraw !== null) {
      observer.disconnect();
      return;
    }
    if (!document.querySelector('#file-list li[role="treeitem"]')) return;
    const firstDraw = { seenAt: performance.now(), paintedAt: null };
    probe.firstDraw = firstDraw;
    observer.disconnect();
    afterPaint((time) => {
      firstDraw.paintedAt = time;
    });
  });
  observer.observe(document, { childList: true, subtree: true });

  document.addEventListener("click", () => {
    probe.clickAt = performance.now();
  }, true);
  document.addEventListener("input", (event) => {
    if (event.target instanceof Element && event.target.classList.contains("launcher-input")) {
      probe.lastInputAt = performance.now();
    }
  }, true);

  // Una finestra di misura: i fotogrammi da `start` a `stop`.
  probe.start = () => {
    const token = {};
    probe.token = token;
    probe.frames = [];
    probe.startedAt = performance.now();
    const loop = () => {
      if (probe.token !== token) return;
      probe.frames.push(performance.now());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  probe.stop = () => {
    probe.token = null;
    return {
      frames: probe.frames,
      startedAt: probe.startedAt,
      endedAt: performance.now(),
      clickAt: probe.clickAt,
    };
  };
  // Il primo fotogramma dipinto in cui c'è un elemento (e, se dato, il testo).
  probe.untilPainted = (selector, text = null, timeoutMs = 30_000) =>
    new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const found = [...document.querySelectorAll(selector)].some((el) => text === null || el.textContent.includes(text));
        if (found) afterPaint((time) => resolve(time));
        else if (performance.now() - started > timeoutMs) resolve(null);
        else requestAnimationFrame(check);
      };
      check();
    });
}

/// Aspetta che l'albero sia fermo: nessuna risposta dell'indice per `ms` dopo
/// l'ultima, e il primo disegno dipinto. Le risposte le registra il banco
/// (`TREE_ARRIVALS`), perché i compiti lunghi della pagina non si vedono (vedi
/// `selfTest`).
async function quiet(page, ms = QUIET_MS) {
  await page.waitForFunction(
    (ms) => {
      const arrivals = globalThis.__fubTreeBench.arrivals;
      const lastArrival = arrivals.length > 0 ? arrivals[arrivals.length - 1].answeredAt : 0;
      const last = Math.max(lastArrival, window.__treeProbe.firstDraw?.paintedAt ?? 0);
      return performance.now() - last >= ms;
    },
    ms,
    { timeout: QUIET_TIMEOUT_MS, polling: 100 },
  );
}

/// Un fotogramma dopo l'ultimo passo di un gesto: il DOM e il layout sono
/// pronti, e ciò che è stato scritto deve ancora essere dipinto.
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// ---------------------------------------------------------------------------
// I numeri.
// ---------------------------------------------------------------------------

const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const ms = (value) => (value === null ? "—" : `${value} ms`);
const count = (n) => n.toLocaleString("it-IT");

const stats = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { count: 0, p50: null, p95: null, max: null };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { count: a.length, p50: round(q(0.5)), p95: round(q(0.95)), max: round(a[a.length - 1]) };
};

/// Una finestra della sonda, in numeri: quanto è durata, il tempo dal clic al
/// fotogramma dipinto, e i fotogrammi, con il più lungo.
function windowStats(win, paintedAt) {
  const gaps = win.frames.slice(1).map((time, i) => time - win.frames[i]);
  return {
    windowMs: round(win.endedAt - win.startedAt),
    clickToPaintMs: win.clickAt !== null && paintedAt !== null ? round(paintedAt - win.clickAt) : null,
    frames: stats(gaps),
    frameMaxMs: round(Math.max(0, ...gaps)),
  };
}

// ---------------------------------------------------------------------------
// Le misure.
// ---------------------------------------------------------------------------

/// Apre la cartella con un clic e aspetta che `selector` sia dipinto. La finestra
/// resta aperta ancora `TAIL_MS`, per ciò che l'albero fa dopo il disegno.
async function openFolder(page, path, selector, tailMs = TAIL_MS) {
  await page.evaluate(() => {
    window.__treeProbe.clickAt = null;
    window.__treeProbe.start();
  });
  await page.click(`#file-list li[data-path="${path}"] > .tree-row`);
  const paintedAt = await page.evaluate(
    ([selector, timeout]) => window.__treeProbe.untilPainted(selector, null, timeout),
    [selector, PAINT_TIMEOUT_MS],
  );
  await page.waitForTimeout(tailMs);
  const win = await page.evaluate(() => window.__treeProbe.stop());
  return { paintedAt, ...windowStats(win, paintedAt) };
}

/// Scorre l'albero fino all'ultima riga, con la rotella, e conta i fotogrammi.
async function scrollToEnd(page) {
  const box = await page.evaluate(() => {
    let el = document.querySelector("#file-list");
    while (el && el !== document.documentElement && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) {
      el = el.parentElement;
    }
    if (!el || el === document.documentElement) el = document.scrollingElement;
    window.__treeProbe.scroller = el;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      top: el.scrollTop,
      client: el.clientHeight,
      height: el.scrollHeight,
    };
  });
  const read = () =>
    page.evaluate(() => {
      const el = window.__treeProbe.scroller;
      return { top: el.scrollTop, client: el.clientHeight, height: el.scrollHeight };
    });
  await page.mouse.move(box.x, box.y);
  await page.evaluate(() => window.__treeProbe.start());
  let state = { top: box.top, client: box.client, height: box.height };
  let steps = 0;
  while (steps < SCROLL_STEPS_LIMIT && state.top + state.client < state.height - 1) {
    await page.mouse.wheel(0, WHEEL_PX);
    steps += 1;
    await frame(page);
    state = await read();
  }
  await frame(page);
  const win = await page.evaluate(() => window.__treeProbe.stop());
  return { from: box.top, to: state.top, height: state.height, client: state.client, steps, ...windowStats(win, null) };
}

/// Il nome che il lanciatore cerca: il nome della nota, senza cartella e `.md`.
function searchedName(path) {
  return path.split("/").pop().replace(/\.md$/, "");
}

/// Ctrl+O, poi il nome a tasti: quando l'elenco dipinto ha la nota. In questa
/// shell Ctrl+O apre il lanciatore (`launcher/`) nel modo dei file, che è la
/// ricerca rapida per nome; il suo freno sono 120 ms (`ASK_DELAY_MS`).
async function searchName(page, name) {
  await page.keyboard.press("Control+o");
  await page.waitForSelector(".launcher-input", { timeout: PAINT_TIMEOUT_MS });
  await page.evaluate(() => {
    window.__treeProbe.lastInputAt = null;
  });
  await page.keyboard.type(name, { delay: 0 });
  const paintedAt = await page.evaluate(
    ([name, timeout]) => window.__treeProbe.untilPainted(".launcher-row-title", name, timeout),
    [name, PAINT_TIMEOUT_MS],
  );
  const inputAt = await page.evaluate(() => window.__treeProbe.lastInputAt);
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll(".launcher-row-title")].map((el) => el.textContent.trim()),
  );
  await page.keyboard.press("Escape");
  return {
    keys: name.length,
    lookupMs: paintedAt !== null && inputAt !== null ? round(paintedAt - inputAt) : null,
    options: hits.length,
    found: hits.some((hit) => hit.includes(name)),
  };
}

/// La cartella «Bozze» e le dieci della catena, una alla volta, fino alla nota
/// in fondo. Ogni apertura è una finestra sua.
async function openChain(page, fixture) {
  const steps = [];
  const names = ["Bozze", ...fixture.chain];
  for (let i = 0; i < names.length; i += 1) {
    const next = names[i + 1] ?? fixture.deepest;
    const selector = `#file-list li[data-path="${next}"]`;
    steps.push({ path: names[i], ...(await openFolder(page, names[i], selector, 200)) });
    await quiet(page);
  }
  return steps;
}

/// La prova del banco: una pagina occupata per `PLANTED_MS` dentro una corsa
/// deve vedersi come fotogramma lento. Se non si vede, il banco non guarda più
/// la pagina e il suo verde non vale niente.
///
/// Non si prova con la Long Tasks API: in questa Chromium, senza finestra, un
/// ciclo occupato di 150 ms non produce nessun compito lungo (provato a mano),
/// quindi la prova è sul fotogramma, che è ciò che le soglie misurano.
async function selfTest(page) {
  await page.evaluate(() => window.__treeProbe.start());
  await page.waitForTimeout(150);
  await page.evaluate((planted) => {
    const until = performance.now() + planted;
    while (performance.now() < until) {
      // La lentezza della prova: la pagina resta occupata.
    }
  }, PLANTED_MS);
  await page.waitForTimeout(150);
  const win = await page.evaluate(() => window.__treeProbe.stop());
  const gaps = win.frames.slice(1).map((time, i) => time - win.frames[i]);
  const frameMaxMs = round(Math.max(0, ...gaps));
  return { plantedMs: PLANTED_MS, frameMaxMs, seen: frameMaxMs >= PLANTED_MS };
}

/// Una velocità: apre la pagina del vault, misura, e dice che cosa sbaglia
/// contro le soglie.
async function measure(stage, cpu) {
  const page = await openPage(stage.browser, "dark", { clock: false });
  // `openPage` spegne il moto per le foto: qui il moto è quello di sistema.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
  try {
    await page.addInitScript(probeScript);
    if (cpu > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    }
    const loadStart = os.loadavg().map((n) => round(n));
    await page.goto(`${stage.base}/?vault=5000`, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: OPEN_TIMEOUT_MS });
    const fixture = await page.evaluate(() => globalThis.__fubTreeBench?.fixture ?? null);
    if (fixture === null) throw new Error("la pagina del banco non ha il vault dell'albero: risponde un altro server?");
    if (fixture.total !== VAULT_FILES) throw new Error(`il vault ha ${fixture.total} file invece di ${VAULT_FILES}`);
    const motion = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (motion) throw new Error("il moto ridotto è acceso: l'albero non si misura così");
    const browser = await stage.browser.version();

    // 1. Il primo disegno, dall'arrivo dell'elenco della radice.
    await page.waitForFunction(() => window.__treeProbe.firstDraw?.paintedAt != null, null, { timeout: OPEN_TIMEOUT_MS });
    const boot = await page.evaluate(() => {
      const arrivals = globalThis.__fubTreeBench.arrivals;
      const root = (kind) => arrivals.find((a) => a.kind === kind && a.scope === "" && a.descendants === false) ?? null;
      return {
        folders: root("folders"),
        entries: root("entries"),
        firstDraw: window.__treeProbe.firstDraw,
        roots: document.querySelectorAll('#file-list > li[role="treeitem"]').length,
      };
    });
    if (boot.folders === null || boot.entries === null) throw new Error("l'albero non ha chiesto la radice all'indice");
    const arrival = Math.max(boot.folders.answeredAt, boot.entries.answeredAt);
    const firstDraw = {
      arrivalMs: round(arrival),
      seenMs: round(boot.firstDraw.seenAt - arrival),
      paintedMs: round(boot.firstDraw.paintedAt - arrival),
      roots: boot.roots,
    };
    await quiet(page);

    // 2. Aprire la cartella da milleecinquecento note.
    const open = await openFolder(page, fixture.big, "#file-list .troncata");
    const openedRows = await page.evaluate(() => ({
      rows: document.querySelectorAll(`#file-list li[role="treeitem"]`).length,
      truncated: document.querySelector("#file-list .troncata")?.textContent?.trim() ?? null,
    }));
    await quiet(page);

    // 3. Scorrere fino in fondo.
    const scroll = await scrollToEnd(page);
    await quiet(page);

    // 4. Cercare un nome con la scorciatoia.
    const search = await searchName(page, searchedName(fixture.target));
    await quiet(page);

    // 5. I casi ai margini: la catena di dieci cartelle.
    const chain = await openChain(page, fixture);
    await quiet(page);

    // 6. La prova del banco.
    const proof = await selfTest(page);

    const result = {
      cpu,
      browser,
      motion: "no-preference",
      load: { start: loadStart, end: os.loadavg().map((n) => round(n)) },
      fixture: {
        total: fixture.total,
        digest: fixture.digest,
        folders: fixture.folders,
        big: fixture.big,
        longName: fixture.longName,
        deepest: fixture.deepest,
        target: fixture.target,
      },
      firstDraw,
      open: { ...open, rows: openedRows.rows, truncated: openedRows.truncated },
      scroll,
      search,
      chain: { steps: chain, maxClickToPaintMs: round(Math.max(0, ...chain.map((step) => step.clickToPaintMs ?? 0))), maxFrameMs: round(Math.max(0, ...chain.map((step) => step.frameMaxMs))) },
      selfTest: proof,
      pageErrors,
    };
    result.gate = { failures: gate(result) };
    return result;
  } finally {
    await page.context().close();
  }
}

/// Ciò che una misura sbaglia contro le soglie, e la prova del banco.
function gate(result) {
  const failures = [];
  if (result.firstDraw.paintedMs === null || result.firstDraw.paintedMs > FIRST_DRAW_LIMIT_MS) {
    failures.push(`primo disegno dopo ${ms(result.firstDraw.paintedMs)} dall'arrivo dell'elenco, oltre i ${FIRST_DRAW_LIMIT_MS} ms`);
  }
  if (!(result.open.frameMaxMs <= OPEN_FRAME_LIMIT_MS)) {
    failures.push(`aprire «Archivio» ha un fotogramma di ${ms(result.open.frameMaxMs)}, oltre i ${OPEN_FRAME_LIMIT_MS} ms`);
  }
  if (!(result.scroll.frameMaxMs <= SCROLL_FRAME_LIMIT_MS)) {
    failures.push(`scorrere fino in fondo ha un fotogramma di ${ms(result.scroll.frameMaxMs)}, oltre i ${SCROLL_FRAME_LIMIT_MS} ms`);
  }
  if (result.scroll.to <= result.scroll.from) failures.push("lo scorrimento non si è mosso: la rotella non arriva all'albero");
  if (result.open.rows < 2) failures.push("aprendo «Archivio» non è comparsa nessuna riga");
  if (!result.search.found) failures.push(`la ricerca non ha trovato «${result.fixture.target}»`);
  if (!result.selfTest.seen) failures.push(`la prova del banco non vede la pagina occupata di ${PLANTED_MS} ms (fotogramma più lungo ${ms(result.selfTest.frameMaxMs)})`);
  if (result.pageErrors.length > 0) failures.push(`la pagina ha lanciato ${result.pageErrors.length} errori: ${result.pageErrors.slice(0, 3).join("; ")}`);
  return failures;
}

function environment() {
  const cpus = os.cpus();
  return {
    node: { version: process.version, platform: process.platform, arch: process.arch, kernelRelease: os.release() },
    cpu: { model: cpus[0]?.model ?? null, logicalCount: cpus.length },
    memory: { totalBytes: os.totalmem() },
  };
}

async function writeReport(report) {
  await mkdir(OUTPUT, { recursive: true });
  const standard = report.config.cpus.join(",") === DEFAULT_CPUS.join(",");
  const path = join(OUTPUT, standard ? "tree.json" : `tree-cpu${report.config.cpus.join("-")}.json`);
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, JSON.stringify(report, null, 2) + "\n");
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
  return path;
}

/// Il riassunto di una velocità, in righe: ciò che è misurato, con la soglia.
function say(result) {
  const label = result.cpu > 1 ? `pagina ${result.cpu} volte più lenta` : "velocità normale";
  console.log(`vault da ${count(result.fixture.total)} file, ${label} (carico ${result.load.start.join(" ")} → ${result.load.end.join(" ")}, ${result.browser})`);
  console.log(`  primo disegno  ${ms(result.firstDraw.paintedMs)} dall'arrivo dell'elenco (vista ${ms(result.firstDraw.seenMs)}, soglia ${FIRST_DRAW_LIMIT_MS} ms)`);
  console.log(`  apertura «${result.fixture.big}»  dipinta in ${ms(result.open.clickToPaintMs)}, ${result.open.rows} righe con «${result.open.truncated ?? "nessuna voce in più"}»; fotogramma più lungo ${ms(result.open.frameMaxMs)} (soglia ${OPEN_FRAME_LIMIT_MS} ms)`);
  console.log(`  scorrimento    ${result.scroll.steps} passi fino in fondo; fotogramma più lungo ${ms(result.scroll.frameMaxMs)} (soglia ${SCROLL_FRAME_LIMIT_MS} ms)`);
  console.log(`  ricerca        «${searchedName(result.fixture.target)}» con ${result.search.keys} tasti: elenco dipinto in ${ms(result.search.lookupMs)} dall'ultimo tasto, ${result.search.options} voci`);
  console.log(`  catena         ${result.chain.steps.length} aperture, la più lenta dipinta in ${ms(result.chain.maxClickToPaintMs)}, fotogramma più lungo ${ms(result.chain.maxFrameMs)} (senza soglia)`);
  console.log(`  prova          pagina occupata ${result.selfTest.plantedMs} ms: fotogramma più lungo ${ms(result.selfTest.frameMaxMs)} ${result.selfTest.seen ? "visto" : "NON visto"}`);
}

async function main() {
  const started = Date.now();
  const config = args(process.argv.slice(2));
  const report = { config: { ...config, firstDrawLimitMs: FIRST_DRAW_LIMIT_MS, openFrameLimitMs: OPEN_FRAME_LIMIT_MS, scrollFrameLimitMs: SCROLL_FRAME_LIMIT_MS, quietMs: QUIET_MS, plantedMs: PLANTED_MS }, environment: environment(), runs: {}, pass: false };
  let stage;
  let primary;
  try {
    stage = await openStage({ port: config.port, strictPort: config.strictPort });
    const failures = [];
    for (const cpu of config.cpus) {
      const result = await measure(stage, cpu);
      report.runs[cpu] = result;
      say(result);
      failures.push(...result.gate.failures.map((failure) => `${cpu}×: ${failure}`));
    }
    if (failures.length > 0) {
      const error = new Error(`${failures.length} cose fuori posto:\n  ${failures.join("\n  ")}`);
      error.failures = failures;
      throw error;
    }
  } catch (error) {
    primary = error;
    report.failure = { name: error?.name, message: String(error?.message ?? error) };
  }
  try {
    if (stage) await stage.close();
  } catch (error) {
    primary ??= error;
  }
  report.pass = !primary;
  report.totalMs = Date.now() - started;
  try {
    const path = await writeReport(report);
    console.log(`referto in ${path}`);
  } catch (error) {
    primary ??= error;
  }
  if (primary) throw primary;
}

main().catch((error) => {
  console.error(`tree: ${error.message}`);
  process.exitCode = 1;
});
