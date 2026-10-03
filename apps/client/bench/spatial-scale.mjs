// **La scala del disegno**: l'editor della famiglia `canvas` misurato sui tre
// disegni di `spatial-fixture.ts`, sul modello di `graph-scale.mjs`.
//
// # Che cosa misura
//
// - **Apertura.** Dal clic sul file all'ultimo oggetto dipinto, e alla fine
//   del fotogramma che lo mostra, sul disegno denso (5 000 oggetti, 5 MB). Prima si apre
//   una volta lo sparso, così il pezzo dell'editor che si scarica al primo
//   disegno è già arrivato e la misura è quella del disegno, non della rete.
// - **Memoria.** L'heap dopo la garbage collection, col disegno aperto e
//   fermo, meno quello di prima di aprirlo, diviso per il peso del file. Il
//   budget vale per la scena, cioè l'heap di V8 coi suoi buffer; il DOM del
//   painter, dove Chromium lo conta, si riporta a parte.
// - **Pan e zoom.** Rotella, Ctrl+rotella e tasto centrale sul disegno denso,
//   un evento ogni 16 ms come un trackpad: gli intervalli fra i fotogrammi e i
//   task lunghi in quel tempo.
// - **Inchiostro e commit.** Tratti di penna, con la pressione, sul disegno da
//   2 000 tratti: quanto passa da ogni `pointermove` alla fine del
//   fotogramma che mostra l'inchiostro sull'overlay, e dal `pointerup` alla
//   fine del fotogramma che mostra il tratto scritto. Il referto dice anche
//   quanto dura il solo gestore.
// - **Vita.** Ogni rAF, timer, osservatore, ascoltatore e URL blob che il
//   codice di `src/editors/spatial/` apre mentre la sonda è attiva deve essere
//   chiuso quando la linguetta si chiude.
//
// # Che cosa fa fallire
//
// Un fallimento **strutturale** fa sempre fallire: un disegno diverso da
// quello atteso, oggetti non dipinti, un tratto non scritto, un overlay che
// non disegna, una camera che non si muove, una risorsa rimasta aperta.
// I **budget** di tempo e memoria si scrivono nel referto col loro esito, e
// fanno fallire soltanto con `--enforce`: i runner condivisi della CI non
// sono un dispositivo, e un budget di tempo che fallisce a caso insegna a
// ignorarlo. Il referto è in `.output/spatial-scale.json`.
import * as os from "node:os";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openStage, openPage, OUTPUT } from "./stage.mjs";
import { SPATIAL_BUDGETS as BUDGETS, SPATIAL_ORACLES as ORACLES } from "./spatial-oracles.mjs";

const REPORT = join(OUTPUT, "spatial-scale.json");
const DEFAULTS = { cycles: 3, strokes: 10, enforce: false };
const LIMITS = { cycles: [1, 10], strokes: [1, 50] };
const READY_TIMEOUT_MS = 60_000;
const PAINT_TIMEOUT_MS = 60_000;
const GC_ROUNDS = 3;
/// I campioni di un tratto dopo quello d'appoggio, come le fixture.
const STROKE_MOVES = 100;
/// Un campione della penna ogni 8 ms, un evento della rotella ogni 16.
const PEN_INTERVAL_MS = 8;
const WHEEL_INTERVAL_MS = 16;
const NAVIGATION_EVENTS = 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function args() {
  const out = { ...DEFAULTS };
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (token === "--enforce") {
      out.enforce = true;
      continue;
    }
    const m = /^--(cycles|strokes)(?:=(\d+))?$/.exec(token);
    if (!m) throw new RangeError(`argomento sconosciuto: ${token}`);
    const value = m[2] ?? process.argv[++i];
    if (!/^\d+$/.test(value ?? "")) throw new RangeError(`--${m[1]} vuole un intero`);
    out[m[1]] = Number(value);
  }
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (out[key] < min || out[key] > max) throw new RangeError(`--${key} sta fra ${min} e ${max}`);
  }
  return out;
}

/// L'id dell'ultimo oggetto di una fixture, come lo scrive il generatore.
const lastObjectId = (objects) => `o${objects.toString(36).padStart(8, "0")}`;

const stats = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { count: 0, p50: null, p95: null, max: null };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const round = (v) => Math.round(v * 100) / 100;
  return { count: a.length, p50: round(q(0.5)), p95: round(q(0.95)), max: round(a[a.length - 1]) };
};

function environmentHost() {
  const cpus = os.cpus();
  return {
    node: { version: process.version, platform: process.platform, arch: process.arch, kernelRelease: os.release() },
    cpu: { model: cpus[0]?.model ?? null, logicalCount: cpus.length },
    memory: { totalBytes: os.totalmem() },
    browser: { chromiumVersion: null },
    page: { userAgent: null, hardwareConcurrency: null, deviceMemory: null },
    viewport: { width: null, height: null, deviceScaleFactor: null },
  };
}

async function captureEnvironment(environment, browser, page) {
  try {
    environment.browser.chromiumVersion = await browser.version();
  } catch {}
  const details = await page.evaluate(() => ({
    userAgent: navigator.userAgent ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    width: window.innerWidth,
    height: window.innerHeight,
    deviceScaleFactor: window.devicePixelRatio,
  }));
  Object.assign(environment.page, { userAgent: details.userAgent, hardwareConcurrency: details.hardwareConcurrency, deviceMemory: details.deviceMemory });
  Object.assign(environment.viewport, { width: details.width, height: details.height, deviceScaleFactor: details.deviceScaleFactor });
}

/// La sonda: si installa prima che la pagina giri, così vede nascere ogni
/// risorsa. Una risorsa è dell'editor se lo stack che la crea passa per
/// `src/editors/spatial/`; gli eventi del puntatore si cronometrano dalla
/// cattura sulla finestra, che è il primo ascoltatore, alla bolla sulla
/// finestra, che è l'ultimo.
async function installProbe(page) {
  await page.addInitScript(() => {
    const state = { active: false, resources: new Set(), input: null, longtasks: [] };
    const listeners = [];
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const now = () => performance.now();
    /// Dopo il prossimo fotogramma: il rAF corre prima di stile, layout e
    /// pittura, un messaggio postato dal rAF corre dopo. Così «mostrato»
    /// comprende il lavoro del fotogramma, non solo quello del gestore.
    const afterFrame = (callback) =>
      raf(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          callback();
        };
        channel.port2.postMessage(null);
      });
    const stackOf = () => (state.active ? String(new Error().stack ?? "").split("\n").slice(2, 14).map((line) => line.replaceAll("\\", "/")) : null);
    const spatial = (stack) => Array.isArray(stack) && stack.some((line) => line.includes("/src/editors/spatial/"));
    const own = (record) => {
      if (state.active && spatial(record.stack)) state.resources.add(record);
    };
    const drop = (record) => {
      state.resources.delete(record);
    };

    window.requestAnimationFrame = (callback) => {
      const record = { kind: "raf", id: null, stack: stackOf() };
      record.id = raf((t) => {
        drop(record);
        callback(t);
      });
      own(record);
      return record.id;
    };
    window.cancelAnimationFrame = (id) => {
      for (const record of state.resources) if (record.kind === "raf" && record.id === id) drop(record);
      return caf(id);
    };
    for (const [create, clear, kind] of [["setTimeout", "clearTimeout", "timeout"], ["setInterval", "clearInterval", "interval"]]) {
      const nativeCreate = window[create].bind(window);
      const nativeClear = window[clear].bind(window);
      window[create] = (callback, delay, ...rest) => {
        const record = { kind, id: null, stack: stackOf() };
        record.id = nativeCreate(function (...a) {
          if (kind === "timeout") drop(record);
          return typeof callback === "function" ? callback.apply(this, a.length ? a : rest) : undefined;
        }, delay, ...rest);
        own(record);
        return record.id;
      };
      window[clear] = (id) => {
        for (const record of state.resources) if (record.kind === kind && record.id === id) drop(record);
        return nativeClear(id);
      };
    }
    const Observed = (Native, kind) =>
      class extends Native {
        constructor(...a) {
          super(...a);
          this.__spatialRecord = { kind, stack: stackOf() };
        }
        observe(...a) {
          own(this.__spatialRecord);
          return super.observe(...a);
        }
        disconnect() {
          drop(this.__spatialRecord);
          return super.disconnect();
        }
      };
    window.ResizeObserver = Observed(window.ResizeObserver, "resizeObserver");
    window.MutationObserver = Observed(window.MutationObserver, "mutationObserver");
    window.IntersectionObserver = Observed(window.IntersectionObserver, "intersectionObserver");
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = createObjectURL(object);
      own({ kind: "blobUrl", url, stack: stackOf() });
      return url;
    };
    URL.revokeObjectURL = (url) => {
      for (const record of state.resources) if (record.kind === "blobUrl" && record.url === url) drop(record);
      return revokeObjectURL(url);
    };

    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const captureOf = (options) => (typeof options === "boolean" ? options : !!options?.capture);
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const stack = stackOf();
      if (!state.active || !spatial(stack) || listener === null) return add.call(this, type, listener, options);
      const capture = captureOf(options);
      if (listeners.some((r) => r.target === this && r.type === type && r.listener === listener && r.capture === capture)) return;
      const record = { kind: "listener", target: this, type, listener, capture, stack, wrapper: null };
      record.wrapper = function (...a) {
        if (typeof options === "object" && options?.once) {
          listeners.splice(listeners.indexOf(record), 1);
          drop(record);
        }
        return typeof listener === "function" ? listener.apply(this, a) : listener.handleEvent(...a);
      };
      const signal = typeof options === "object" ? options?.signal : undefined;
      if (signal?.aborted) return;
      signal?.addEventListener("abort", () => {
        const at = listeners.indexOf(record);
        if (at >= 0) listeners.splice(at, 1);
        drop(record);
      }, { once: true });
      listeners.push(record);
      own(record);
      return add.call(this, type, record.wrapper, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const capture = captureOf(options);
      const at = listeners.findIndex((r) => r.target === this && r.type === type && r.listener === listener && r.capture === capture);
      if (at < 0) return remove.call(this, type, listener, options);
      const [record] = listeners.splice(at, 1);
      drop(record);
      return remove.call(this, type, record.wrapper, options);
    };

    // Il cronometro degli eventi del puntatore: registrato qui, prima di ogni
    // altro, in cattura sulla finestra; la fine in bolla sulla finestra.
    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      add.call(window, type, (event) => {
        if (state.input === null) return;
        const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents().length : 1;
        state.input.pending.set(event, { type, start: now(), end: null, frame: null, coalesced });
      }, { capture: true });
      add.call(window, type, (event) => {
        const entry = state.input?.pending.get(event);
        if (!entry) return;
        state.input.pending.delete(event);
        entry.end = now();
        state.input.entries.push(entry);
        afterFrame(() => {
          entry.frame = now();
        });
      });
    }

    const longtasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longtasks.push(entry.duration);
    });
    longtasks.observe({ type: "longtask", buffered: true });

    const describe = (target) => {
      if (target === window) return "window";
      if (target === document) return "document";
      if (!(target instanceof Node)) return String(target);
      return `${target.nodeName.toLowerCase()}${target instanceof Element && target.className ? `.${String(target.className).trim().replace(/\s+/g, ".")}` : ""}${target.isConnected ? "" : " (staccato)"}`;
    };
    Object.defineProperty(window, "__spatialProbe", {
      value: Object.freeze({
        begin() {
          state.active = true;
        },
        end() {
          state.active = false;
        },
        /// Le risorse dell'editor ancora aperte. Un ascoltatore su un
        /// elemento staccato dal documento non trattiene niente che il GC
        /// non possa prendere: si conta a parte.
        resources() {
          const out = { open: {}, detachedListeners: 0, details: [] };
          for (const record of state.resources) {
            if (record.kind === "listener" && record.target instanceof Node && record.target !== document && !record.target.isConnected) {
              out.detachedListeners += 1;
              continue;
            }
            out.open[record.kind] = (out.open[record.kind] ?? 0) + 1;
            out.details.push({ kind: record.kind, type: record.type ?? null, target: record.kind === "listener" ? describe(record.target) : null, stack: record.stack?.slice(0, 6) ?? null });
          }
          return out;
        },
        startInput() {
          state.input = { pending: new Map(), entries: [] };
        },
        takeInput() {
          const entries = state.input?.entries ?? [];
          state.input = null;
          return entries;
        },
        takeLongTasks() {
          for (const entry of longtasks.takeRecords()) state.longtasks.push(entry.duration);
          return state.longtasks.splice(0);
        },
        /// Gli istanti dei prossimi `count` fotogrammi, col rAF nativo.
        frames(count) {
          return new Promise((resolve) => {
            const times = [];
            const tick = (t) => {
              times.push(t);
              if (times.length >= count) resolve(times);
              else raf(tick);
            };
            raf(tick);
          });
        },
        /// Aspetta che l'editor non abbia più fotogrammi chiesti.
        idle(deadlineMs) {
          return new Promise((resolve, reject) => {
            const until = now() + deadlineMs;
            const check = () => {
              if (![...state.resources].some((r) => r.kind === "raf")) resolve();
              else if (now() > until) reject(new Error(`l'editor chiede ancora fotogrammi dopo ${deadlineMs} ms`));
              else raf(check);
            };
            raf(check);
          });
        },
        raf,
        afterFrame,
      }),
      configurable: false,
      writable: false,
    });
  });
}

/// L'heap dopo la garbage collection: quello di V8 e, dove c'è, quello del
/// DOM, che dal 2023 Chromium conta a parte.
async function settledHeap(cdp) {
  for (let i = 0; i < GC_ROUNDS; i++) await cdp.send("HeapProfiler.collectGarbage");
  try {
    const usage = await cdp.send("Runtime.getHeapUsage");
    const embedder = Number.isFinite(usage.embedderHeapUsedSize) ? usage.embedderHeapUsedSize : 0;
    const backing = Number.isFinite(usage.backingStorageSize) ? usage.backingStorageSize : 0;
    return { js: usage.usedSize, embedder, backing, total: usage.usedSize + embedder + backing };
  } catch {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const used = metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? null;
    return { js: used, embedder: null, backing: null, total: used };
  }
}

/// Quanto pesa un disegno aperto. La **scena** è ciò che l'editor tiene in
/// JavaScript: testo, albero, indice, ciò che il painter costruisce, e i
/// buffer binari che ne fanno parte; il budget la confronta col file. Il
/// **DOM** del painter si riporta a parte: lo governa la soglia oltre cui il
/// painter SVG lascia il posto a quello Canvas, non il modello.
function memoryOf(before, after, sourceBytes) {
  const own = (heap) => heap.js + (heap.backing ?? 0);
  const sceneBytes = own(after) - own(before);
  const domBytes = after.embedder === null || before.embedder === null ? null : after.embedder - before.embedder;
  return {
    before,
    after,
    sourceBytes,
    sceneBytes,
    domBytes,
    ratio: sceneBytes / sourceBytes,
    pageRatio: domBytes === null ? null : (sceneBytes + domBytes) / sourceBytes,
  };
}

async function openFolder(page, path) {
  const item = `#file-list li[role="treeitem"][data-path="${path}"]`;
  await page.waitForSelector(`${item} > .tree-row.folder`);
  const open = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute("aria-expanded") === "true", item);
  if (!open) await page.click(`${item} > .tree-row.folder`);
  await page.waitForSelector(`#file-list .tree-row[data-path^="${path}/"]`);
}

/// Apre il disegno dall'albero e misura, nella pagina, dal clic all'ultimo
/// oggetto dipinto e alla fine del fotogramma che lo mostra.
async function openDrawing(page, fixture) {
  const result = await page.evaluate(
    ({ path, last, timeout }) => {
      const probe = window.__spatialProbe;
      const row = document.querySelector(`#file-list .tree-row[data-path="${CSS.escape(path)}"]`);
      if (!row) throw new Error(`il file ${path} non è nell'albero`);
      const start = performance.now();
      row.click();
      return new Promise((resolve, reject) => {
        const poll = () => {
          const painter = document.querySelector(".pane.focus .spatial-painter");
          if (painter?.querySelector(`[data-scene-id="${last}"]`)) {
            const painted = performance.now() - start;
            probe.afterFrame(() => resolve({ paintedMs: painted, frameMs: performance.now() - start }));
          } else if (performance.now() - start > timeout) {
            reject(new Error(`${path}: l'ultimo oggetto non è dipinto dopo ${timeout} ms`));
          } else {
            probe.raf(poll);
          }
        };
        probe.raf(poll);
      });
    },
    { path: fixture.path, last: lastObjectId(fixture.objects), timeout: PAINT_TIMEOUT_MS },
  );
  const painted = await page.evaluate(() => document.querySelectorAll('.pane.focus .spatial-painter [data-scene-id^="o"]').length);
  if (painted !== fixture.objects) throw new Error(`${fixture.path}: dipinti ${painted} oggetti su ${fixture.objects}`);
  return { ...result, painted };
}

/// Chiude la linguetta del disegno col suo pulsante, che le sta accanto e non
/// dentro: lo lega a lei `data-tab-id`.
async function closeDrawing(page) {
  const tab = page.locator('.pane.focus .tab[role="tab"][aria-selected="true"]');
  if ((await tab.count()) !== 1) throw new Error("la linguetta del disegno non c'è");
  const tabId = await tab.getAttribute("id");
  if (!tabId) throw new Error("la linguetta del disegno non ha un id");
  await page.locator(`.pane.focus .tab-close[data-tab-id="${tabId}"]`).click();
  await page.waitForSelector(".draw-editor", { state: "detached" });
}

/// Le risorse aperte dopo la chiusura: devono essere zero.
async function lifecycle(page, label) {
  const leftover = await page.evaluate(() => {
    window.__spatialProbe.end();
    return window.__spatialProbe.resources();
  });
  const open = Object.values(leftover.open).reduce((a, b) => a + b, 0);
  if (open > 0) {
    const error = new Error(`${label}: l'editor lascia aperte ${open} risorse dopo la chiusura: ${JSON.stringify(leftover.open)}`);
    error.details = leftover.details;
    throw error;
  }
  return leftover;
}

const cameraOf = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".pane.focus .spatial-painter g[transform]")].slice(0, 2).map((g) => g.getAttribute("transform")).join(" | "));

/// Pan e zoom come li fa una persona: rotella, Ctrl+rotella in dentro e in
/// fuori, poi il trascinamento col tasto centrale.
async function navigate(page, cdp) {
  const box = await page.locator(".pane.focus .draw-surface").boundingBox();
  if (!box) throw new Error("il foglio non ha un riquadro");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const before = await cameraOf(page);
  await page.evaluate(() => window.__spatialProbe.takeLongTasks());
  const frames = page.evaluate((count) => window.__spatialProbe.frames(count), 4 * NAVIGATION_EVENTS + 20);
  const started = Date.now();
  const wheel = async (deltaX, deltaY, modifiers) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY, modifiers });
    await sleep(WHEEL_INTERVAL_MS);
  };
  for (let i = 0; i < NAVIGATION_EVENTS; i++) await wheel(i % 2 ? 6 : -4, 8, 0);
  for (let i = 0; i < NAVIGATION_EVENTS; i++) await wheel(0, i < NAVIGATION_EVENTS / 2 ? -20 : 20, 2);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "middle", buttons: 4, clickCount: 1 });
  for (let i = 1; i <= NAVIGATION_EVENTS; i++) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + i * 3, y: y + i * 2, button: "middle", buttons: 4 });
    await sleep(WHEEL_INTERVAL_MS);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + NAVIGATION_EVENTS * 3, y: y + NAVIGATION_EVENTS * 2, button: "middle", buttons: 0, clickCount: 1 });
  const times = await frames;
  const wallMs = Date.now() - started;
  const longtasks = await page.evaluate(() => window.__spatialProbe.takeLongTasks());
  const after = await cameraOf(page);
  if (before === after) throw new Error("pan e zoom non hanno mosso la camera del painter");
  const intervals = times.slice(1).map((t, i) => t - times[i]);
  return { events: 3 * NAVIGATION_EVENTS, wallMs, frames: { count: times.length, intervals: stats(intervals) }, longTasks: { ...stats(longtasks), over50ms: longtasks.filter((d) => d > 50).length } };
}

/// Un tratto di penna con la pressione, campione per campione.
async function stroke(page, cdp, box, index, checkOverlay) {
  const cx = box.x + box.width * (0.3 + 0.4 * ((index * 37) % 10) / 10);
  const cy = box.y + box.height * (0.3 + 0.4 * ((index * 53) % 10) / 10);
  const at = (k) => ({ x: cx + 120 * Math.cos(k / 16 + index), y: cy + 60 * Math.sin(k / 9 + index) });
  const force = (k) => 0.3 + 0.5 * Math.sin((Math.PI * k) / STROKE_MOVES);
  const before = await page.evaluate(() => document.querySelectorAll('.pane.focus .spatial-painter [data-scene-id]').length);
  await page.evaluate(() => window.__spatialProbe.startInput());
  let p = at(0);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1, pointerType: "pen", force: force(0) });
  let overlay = null;
  for (let k = 1; k <= STROKE_MOVES; k++) {
    p = at(k);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p, button: "left", buttons: 1, pointerType: "pen", force: force(k) });
    await sleep(PEN_INTERVAL_MS);
    if (checkOverlay && k === STROKE_MOVES / 2) {
      overlay = await page.evaluate(() => {
        const canvas = document.querySelector(".pane.focus canvas.spatial-overlay");
        if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0) return false;
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
        return false;
      });
    }
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", buttons: 0, clickCount: 1, pointerType: "pen", force: 0 });
  await page.waitForFunction(
    (n) => document.querySelectorAll('.pane.focus .spatial-painter [data-scene-id]').length === n,
    before + 1,
    { timeout: 10_000 },
  ).catch(() => {
    throw new Error(`il tratto ${index + 1} non è stato scritto nel disegno`);
  });
  // Il fotogramma dopo il `pointerup` è già passato quando il tratto è
  // dipinto; altri due lo garantiscono anche per l'ultimo `pointermove` e per
  // il messaggio che chiude il fotogramma.
  await page.evaluate(() => window.__spatialProbe.frames(3));
  const entries = await page.evaluate(() => window.__spatialProbe.takeInput());
  if (checkOverlay && overlay !== true) throw new Error("l'inchiostro in corso non compare sull'overlay");
  return entries;
}

async function writeReport(report) {
  await mkdir(OUTPUT, { recursive: true });
  const tmp = `${REPORT}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, JSON.stringify(report, null, 2) + "\n");
    await rename(tmp, REPORT);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

const verdict = (value, budget) => (value === null ? "non misurato" : value <= budget ? "dentro" : "fuori");

async function main() {
  const started = Date.now();
  const environment = environmentHost();
  const report = { config: null, environment, fixtures: null, open: { warmup: null, cycles: [] }, memory: {}, navigation: null, ink: null, lifecycle: [], budgets: null, pass: false };
  let stage;
  let page;
  let cdp;
  let primary;
  const pageErrors = [];
  try {
    const config = args();
    report.config = config;
    stage = await openStage();
    page = await openPage(stage.browser, "dark", { clock: false });
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await installProbe(page);
    await page.goto(`${stage.base}/?drawFixtures=sparse,dense,ink`, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: READY_TIMEOUT_MS });
    await captureEnvironment(environment, stage.browser, page);

    const fixtures = Object.fromEntries((await page.evaluate(() => globalThis.__fubDrawBench?.fixtures ?? [])).map((f) => [f.kind, f]));
    for (const [kind, oracle] of Object.entries(ORACLES)) {
      const fixture = fixtures[kind];
      if (!fixture) throw new Error(`la fixture ${kind} non è nel vault`);
      for (const key of Object.keys(oracle)) {
        if (fixture[key] !== oracle[key]) throw new Error(`la fixture ${kind} non è quella attesa: ${key} ${fixture[key]} invece di ${oracle[key]}`);
      }
    }
    report.fixtures = fixtures;
    await page.mouse.move(1, 1);
    await openFolder(page, "Banco");

    // Il primo disegno scarica l'editor: si apre e si chiude prima di misurare.
    report.open.warmup = await openDrawing(page, fixtures.sparse);
    await closeDrawing(page);

    for (let cycle = 0; cycle < config.cycles; cycle++) {
      const heapBefore = cycle === 0 ? await settledHeap(cdp) : null;
      await page.evaluate(() => window.__spatialProbe.begin());
      const opened = await openDrawing(page, fixtures.dense);
      report.open.cycles.push(opened);
      if (cycle === 0) {
        await page.evaluate((ms) => window.__spatialProbe.idle(ms), 30_000);
        const heapAfter = await settledHeap(cdp);
        report.memory.dense = memoryOf(heapBefore, heapAfter, fixtures.dense.bytes);
        report.navigation = await navigate(page, cdp);
      }
      await closeDrawing(page);
      report.lifecycle.push({ drawing: "dense", cycle: cycle + 1, ...(await lifecycle(page, `denso, giro ${cycle + 1}`)) });
    }

    const heapBefore = await settledHeap(cdp);
    await page.evaluate(() => window.__spatialProbe.begin());
    const inkOpen = await openDrawing(page, fixtures.ink);
    await page.evaluate((ms) => window.__spatialProbe.idle(ms), 30_000);
    const heapAfter = await settledHeap(cdp);
    report.memory.ink = memoryOf(heapBefore, heapAfter, fixtures.ink.bytes);
    await page.focus(".pane.focus .draw-surface");
    await page.keyboard.press("p");
    const box = await page.locator(".pane.focus .draw-surface").boundingBox();
    if (!box) throw new Error("il foglio non ha un riquadro");
    const moves = [];
    const commits = [];
    let coalesced = 0;
    for (let i = 0; i < config.strokes; i++) {
      const entries = await stroke(page, cdp, box, i, i === 0);
      for (const entry of entries) {
        if (entry.type === "pointermove") {
          moves.push(entry);
          coalesced += entry.coalesced;
        }
        if (entry.type === "pointerup") commits.push(entry);
      }
    }
    if (commits.length !== config.strokes) throw new Error(`${commits.length} pointerup misurati su ${config.strokes} tratti`);
    report.ink = {
      open: inkOpen,
      strokes: config.strokes,
      pointermoves: moves.length,
      samples: coalesced,
      moveHandlerMs: stats(moves.map((e) => e.end - e.start)),
      moveToFrameMs: stats(moves.map((e) => e.frame - e.start)),
      commitHandlerMs: stats(commits.map((e) => e.end - e.start)),
      commitToFrameMs: stats(commits.map((e) => e.frame - e.start)),
    };
    await closeDrawing(page);
    report.lifecycle.push({ drawing: "ink", cycle: 1, ...(await lifecycle(page, "inchiostro")) });

    const openMedian = stats(report.open.cycles.map((c) => c.frameMs)).p50;
    report.budgets = {
      ink: { budget: BUDGETS.inkMs, measured: report.ink.moveToFrameMs.p95, metric: "p95 dal pointermove alla fine del fotogramma che mostra l'inchiostro, ms", verdict: verdict(report.ink.moveToFrameMs.p95, BUDGETS.inkMs) },
      commit: { budget: BUDGETS.commitMs, measured: report.ink.commitToFrameMs.p95, metric: "p95 dal pointerup alla fine del fotogramma che mostra il tratto, ms", verdict: verdict(report.ink.commitToFrameMs.p95, BUDGETS.commitMs) },
      open: { budget: BUDGETS.openMs, measured: openMedian, metric: "mediana dal clic alla fine del fotogramma che mostra l'ultimo oggetto, ms", verdict: verdict(openMedian, BUDGETS.openMs) },
      navigation: {
        budget: BUDGETS.navigationFrameMs,
        measured: report.navigation.frames.intervals.p95,
        longTasks: report.navigation.longTasks.over50ms,
        metric: "p95 dell'intervallo fra fotogrammi, ms, e task oltre 50 ms",
        verdict: report.navigation.longTasks.over50ms > BUDGETS.navigationLongTasks ? "fuori" : verdict(report.navigation.frames.intervals.p95, BUDGETS.navigationFrameMs),
      },
      memory: { budget: BUDGETS.memoryRatio, measured: Math.round(report.memory.dense.ratio * 100) / 100, pageRatio: report.memory.dense.pageRatio === null ? null : Math.round(report.memory.dense.pageRatio * 100) / 100, metric: "memoria della scena del disegno denso aperto / peso del file; pageRatio conta anche il DOM", verdict: verdict(report.memory.dense.ratio, BUDGETS.memoryRatio) },
      crossDevice: { verdict: "non misurato", reason: "il tratto dal tablet si misura col tablet vero e la sua rete, non in questo banco" },
    };
    const outside = Object.entries(report.budgets).filter(([, b]) => b.verdict === "fuori").map(([name]) => name);
    report.outside = outside;
    if (config.enforce && outside.length > 0) throw new Error(`budget superati: ${outside.join(", ")}`);
  } catch (error) {
    primary = error;
    report.failure = { name: error?.name, message: String(error?.message ?? error), ...(error?.details ? { details: error.details } : {}), ...(pageErrors.length ? { pageErrors } : {}) };
  }
  for (const close of [() => cdp?.detach(), () => page?.context().close(), () => stage?.close()]) {
    try {
      await close();
    } catch (error) {
      primary ??= error;
    }
  }
  report.pass = !primary;
  report.totalMs = Date.now() - started;
  try {
    await writeReport(report);
  } catch (error) {
    primary ??= error;
  }
  if (report.budgets) {
    for (const [name, b] of Object.entries(report.budgets)) {
      console.log(`${b.verdict === "fuori" ? "✗" : b.verdict === "dentro" ? "✓" : "·"} ${name}: ${b.measured ?? "-"}${b.budget !== undefined ? ` (budget ${b.budget})` : ""} — ${b.metric ?? b.reason}`);
    }
  }
  if (primary) throw primary;
}

main().catch((error) => {
  console.error(`spatial-scale: ${error.message}`);
  process.exitCode = 1;
});
