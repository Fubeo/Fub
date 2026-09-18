import * as os from "node:os";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openStage, openPage, OUTPUT } from "./stage.mjs";

const countKinds = (resources) => Object.fromEntries([...new Set(resources)].map((kind) => [kind, resources.filter((entry) => entry === kind).length]));

const REPORT = join(OUTPUT, "graph-scale.json");
const DEFAULTS = { nodes: 2000, seed: 6, cycles: 3, soakWindows: 1 };
const ORACLES = Object.freeze({
  "2000:6": "eeeacc27",
  "10000:6": "abcf614b",
});
const LIMITS = { nodes: [0, 0xffff_ffff], seed: [0, 0xffff_ffff], cycles: [1, 20], soakWindows: [1, 20] };
const READY_SAFETY_TIMEOUT_MS = 30_000;
const FRAME_SAMPLE_TARGET = 120;
const FRAME_SAMPLE_SAFETY_TIMEOUT_MS = 30_000;
const HEAP_STABILITY = Object.freeze({
  nodes: 10_000,
  seed: 6,
  minWindows: 16,
  warmupWindows: 8,
  measurementWindows: 8,
  maxSlopeBytesPerWindow: 65_536,
  maxMonotonicIncreases: 6,
});

function args() {
  const out = { ...DEFAULTS };
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    const m = /^--(nodes|seed|cycles|soak-windows)(?:=(\d+))?$/.exec(token);
    if (!m) throw new RangeError(`unknown argument: ${token}`);
    const key = m[1] === "soak-windows" ? "soakWindows" : m[1];
    const value = m[2] ?? process.argv[++i];
    if (!/^\d+$/.test(value ?? "")) throw new RangeError(`invalid ${m[1]}`);
    out[key] = Number(value);
  }
  for (const key of Object.keys(LIMITS)) {
    const [min, max] = LIMITS[key];
    if (!Number.isInteger(out[key]) || out[key] < min || out[key] > max) throw new RangeError(`invalid ${key}`);
  }
  const oracleKey = `${out.nodes}:${out.seed}`;
  if (!(oracleKey in ORACLES)) throw new RangeError(`unsupported graph-scale tuple: nodes=${out.nodes}, seed=${out.seed}`);
  return out;
}


function environmentHost() {
  const cpus = os.cpus();
  return {
    node: { version: process.version, platform: process.platform, arch: process.arch, kernelRelease: os.release() },
    cpu: { model: cpus[0]?.model ?? null, logicalCount: cpus.length },
    memory: { totalBytes: os.totalmem() },
    browser: { chromiumVersion: null },
    page: { userAgent: null, hardwareConcurrency: null, deviceMemory: null },
    viewport: { width: null, height: null, deviceScaleFactor: null },
    media: { reducedMotion: null, colorScheme: null },
  };
}

async function captureEnvironment(environment, browser, page) {
  try {
    environment.browser.chromiumVersion = await browser.version();
  } catch {}
    const details = await page.evaluate(() => ({
      userAgent: navigator.userAgent ?? null,
      hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null,
      deviceMemory: Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : null,
      width: Number.isFinite(window.innerWidth) ? window.innerWidth : null,
      height: Number.isFinite(window.innerHeight) ? window.innerHeight : null,
      deviceScaleFactor: Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : null,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    }));
    Object.assign(environment.page, { userAgent: details.userAgent, hardwareConcurrency: details.hardwareConcurrency, deviceMemory: details.deviceMemory });
    Object.assign(environment.viewport, { width: details.width, height: details.height, deviceScaleFactor: details.deviceScaleFactor });
    Object.assign(environment.media, { reducedMotion: details.reducedMotion, colorScheme: details.colorScheme });
  return environment;
}

async function installProbe(page) {
  await page.addInitScript(() => {
    const state = { active: false, resources: new Set(), frames: [], longtasks: [], sample: null, interaction: [], pointerCaptures: [] };
    const listeners = [];
    const graphOwned = (target) => target === window || target === document || (typeof Element !== "undefined" && target instanceof Element && !!target.closest("canvas.graph-main, canvas.graph-bg, .graph-panel"));
    const describeTarget = (target) => target === window ? "window" : target === document ? "document" : target?.tagName?.toLowerCase() ?? null;
    const captureStack = () => state.active ? String(new Error().stack ?? "").split("\n").slice(1, 7).map((line) => line.replaceAll("\\", "/")) : null;
    const moduleOwned = (stack) => Array.isArray(stack) && stack.some((line) => /(?:^|[\\/])src[\\/]graph[\\/]/.test(line) || /(?:^|[\\/])src[\\/]panels[\\/]graph\.ts(?:[^A-Za-z0-9_.-]|$)/.test(line));
    const own = (record) => { if (state.active && (record.kind === "listener" || moduleOwned(record.stack))) state.resources.add(record); };
    const drop = (record) => {
      state.resources.delete(record);
      if (record) { record.target = null; record.listener = null; record.signal = null; record.wrapper = null; }
    };
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    window.requestAnimationFrame = (cb) => {
      const record = { kind: "raf", id: null, stack: captureStack() };
      const id = raf((t) => {
        drop(record);
        if (state.active) state.frames.push(t);
        if (state.sample && !state.sample.completed && state.active && (state.sample.times.length === 0 || state.sample.times[state.sample.times.length - 1] !== t)) {
          state.sample.times.push(t);
          if (state.sample.times.length === state.sample.target) {
            state.sample.completed = true;
            nativeClearTimeout(state.sample.timer);
            state.sample.resolve(state.sample.times);
          }
        }
        cb(t);
      });
      record.id = id;
      own(record);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      for (const record of state.resources) if (record.kind === "raf" && record.id === id) { drop(record); break; }
      return caf(id);
    };
    for (const name of ["setTimeout", "setInterval"]) {
      const native = window[name].bind(window);
      window[name] = (cb, delay, ...rest) => {
        const record = { kind: name, id: null, delay: Number(delay), stack: captureStack() };
        const id = native(function (...args) {
          if (name === "setTimeout") drop(record);
          return typeof cb === "function" ? cb.apply(this, args.length ? args : rest) : undefined;
        }, delay, ...rest);
        record.id = id;
        own(record);
        return id;
      };
    }
    for (const name of ["clearTimeout", "clearInterval"]) {
      const native = window[name].bind(window);
      window[name] = (id) => {
        for (const record of state.resources) if (record.kind === (name === "clearTimeout" ? "setTimeout" : "setInterval") && record.id === id) { drop(record); break; }
        return native(id);
      };
    }
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const capture = typeof options === "boolean" ? options : !!options?.capture;
      const track = graphOwned(this);
      if (!track) return add.call(this, type, listener, options);
      const existing = listeners.find((x) => x.target === this && x.type === type && x.listener === listener && x.capture === capture);
      if (existing) return;
      const signal = options?.signal ?? null;
      if (signal?.aborted) return add.call(this, type, listener, options);
      const record = { kind: "listener", target: this, type, listener, capture, signal, wrapper: null };
      record.wrapper = function (...args) {
        const callback = listener;
        if (options?.once) {
          const n = listeners.indexOf(record);
          if (n >= 0) listeners.splice(n, 1);
          drop(record);
        }
        let result;
        try {
          result = typeof callback === "function" ? callback.apply(this, args) : callback?.handleEvent?.apply(callback, args);
        } finally {
          const event = args[0];
          if (state.active && event && (type === "wheel" || type.startsWith("pointer")) && graphOwned(event.target)) {
            state.interaction.push({ type, target: describeTarget(event.target), defaultPrevented: event.defaultPrevented });
          }
        }
        return result;
      };
      listeners.push(record);
      own(record);
      if (record.signal) add.call(record.signal, "abort", () => {
        const target = record.target;
        const wrapper = record.wrapper;
        const n = listeners.indexOf(record);
        if (n >= 0) listeners.splice(n, 1);
        drop(record);
        if (target && wrapper) remove.call(target, type, wrapper, { capture });
      }, { once: true });
      return add.call(this, type, record.wrapper, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const capture = typeof options === "boolean" ? options : !!options?.capture;
      for (let i = listeners.length - 1; i >= 0; i--) {
        const record = listeners[i];
        if (record.target === this && record.type === type && record.listener === listener && record.capture === capture) {
          const wrapper = record.wrapper;
          listeners.splice(i, 1);
          drop(record);
          return remove.call(this, type, wrapper, options);
        }
      }
      return remove.call(this, type, listener, options);
    };
    const nativeCapture = Element.prototype.setPointerCapture;
    if (nativeCapture) Element.prototype.setPointerCapture = function (pointerId) {
      if (state.active && this.matches?.("canvas.graph-main, canvas.graph-bg")) state.pointerCaptures.push({ pointerId });
      return nativeCapture.call(this, pointerId);
    };
    const Obs = (Native, kind) => class extends Native {
      constructor(...a) { super(...a); this.__benchRecord = { kind, target: this, stack: captureStack() }; }
      observe(...a) { own(this.__benchRecord); return super.observe(...a); }
      disconnect() { drop(this.__benchRecord); return super.disconnect(); }
    };
    window.ResizeObserver = Obs(window.ResizeObserver, "resizeObserver");
    window.MutationObserver = Obs(window.MutationObserver, "mutationObserver");
    const longTaskObserver = new PerformanceObserver((list) => { for (const e of list.getEntries()) state.longtasks.push(e.duration); });
    longTaskObserver.observe({ type: "longtask", buffered: true });
    const drainLongTasks = () => {
      for (const entry of longTaskObserver.takeRecords()) state.longtasks.push(entry.duration);
    };
    const snapshot = () => {
      drainLongTasks();
      return { resources: [...state.resources].map((record) => record.kind), frameTimes: state.frames.splice(0), longtasks: state.longtasks.splice(0), interaction: state.interaction.splice(0), pointerCaptures: state.pointerCaptures.splice(0) };
    };
    const discard = () => {
      drainLongTasks();
      state.frames.length = 0;
      state.longtasks.length = 0;
      state.interaction.length = 0;
      state.pointerCaptures.length = 0;
    };
    Object.defineProperty(window, "__graphScaleProbe", { value: Object.freeze({
      begin: () => { state.active = true; state.interaction.length = 0; state.pointerCaptures.length = 0; },
      end: () => { state.active = false; },
      startFrames: (target, deadlineMs = 5000) => new Promise((resolve, reject) => {
        if (state.sample) throw new Error("frame sample already active");
        const sample = state.sample = { target, times: [], resolve, reject, completed: false, timer: null };
        sample.timer = nativeSetTimeout(() => {
          if (state.sample !== sample || sample.completed) return;
          state.sample = null;
          reject(new Error(`frame sample deadline exceeded: ${sample.times.length}/${target} after ${deadlineMs}ms`));
        }, deadlineMs);
      }),
      stopFrames: () => {
        const sample = state.sample;
        if (!sample) return [];
        state.sample = null;
        nativeClearTimeout(sample.timer);
        return sample.times;
      },
      snapshot,
      discard,
      details: () => {
        const describe = (target) => {
          if (target === window) return { kind: "window" };
          if (target === document) return { kind: "document" };
          const ancestry = [];
          for (let node = target?.parentElement; node && ancestry.length < 3; node = node.parentElement) ancestry.push(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${node.className && typeof node.className === "string" ? `.${node.className.trim().replace(/\s+/g, ".")}` : ""}${node.dataset?.role ? `[data-role=${node.dataset.role}]` : ""}`);
          return { tagName: target?.tagName, id: target?.id || null, className: target?.className || null, isConnected: target?.isConnected ?? null, ancestry };
        };
        return [...state.resources].map((record) => ({ kind: record.kind, type: record.type, delay: record.delay, stack: record.stack, target: describe(record.target) }));
      },
    }), configurable: false, writable: false });
  });
}

const stats = (values) => { const a = values.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return { count: 0, p50: null, p95: null, max: null }; const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))]; return { count: a.length, p50: q(.5), p95: q(.95), max: a[a.length - 1] }; };
const heap = async (session) => {
  try {
    const { metrics } = await session.send("Performance.getMetrics");
    const metric = metrics.find((entry) => entry.name === "JSHeapUsedSize");
    return metric && Number.isFinite(metric.value) ? metric.value : { status: "unsupported", reason: "JSHeapUsedSize unavailable" };
  } catch (error) { return { status: "unsupported", reason: String(error?.message ?? error) }; }
};
const linearSlope = (values) => {
  const points = values.map((value, index) => [index + 1, value]).filter(([, y]) => Number.isFinite(y));
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const denominator = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  return denominator ? points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / denominator : null;
};
const heapStability = (config, series) => {
  const canonical = config.nodes === HEAP_STABILITY.nodes && config.seed === HEAP_STABILITY.seed;
  if (!canonical || config.soakWindows < HEAP_STABILITY.minWindows) {
    return {
      required: false,
      pass: null,
      reason: canonical
        ? `requires at least ${HEAP_STABILITY.minWindows} soak windows`
        : "only the 10k/seed-6 fixture has a hard heap oracle",
      policy: HEAP_STABILITY,
    };
  }
  if (!series.every(Number.isFinite)) {
    return {
      required: true,
      pass: false,
      reason: "heap series is incomplete after forced GC",
      policy: HEAP_STABILITY,
      measured: null,
    };
  }
  const measured = series.slice(-HEAP_STABILITY.measurementWindows);
  const slope = linearSlope(measured);
  const increases = measured.slice(1).reduce(
    (count, value, index) => count + (value > measured[index] ? 1 : 0),
    0,
  );
  const pass =
    slope !== null
    && slope <= HEAP_STABILITY.maxSlopeBytesPerWindow
    && increases <= HEAP_STABILITY.maxMonotonicIncreases;
  return {
    required: true,
    pass,
    reason: pass ? null : "tail heap did not stabilize within the hard oracle",
    policy: HEAP_STABILITY,
    measured: {
      windows: measured.length,
      series: measured,
      slopeBytesPerWindow: slope,
      monotonicIncreaseCount: increases,
    },
  };
};

const collectHeap = async (session) => {
  try {
    await session.send("HeapProfiler.collectGarbage");
  } catch (error) {
    return { status: "unsupported", reason: String(error?.message ?? error) };
  }
  return heap(session);
};

async function closeGraph(page) {
  const tab = page.locator('.pane .tab.tab-view[aria-selected="true"]');
  if (!(await tab.count())) throw new Error("active Graph tab is absent");
  const tabId = await tab.getAttribute("id");
  if (!tabId) throw new Error("active Graph tab has no stable id");
  // The close button is an a11y-valid sibling of the tab, not a descendant:
  // use their explicit data relation instead of relying on DOM adjacency.
  const close = page.locator(`.pane .tab-close[data-tab-id="${tabId}"]`);
  if (!(await close.count())) throw new Error("active Graph tab close control is absent");
  await close.dispatchEvent("mousedown");
  await page.waitForSelector("canvas.graph-main", { state: "detached" });
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
const CLEANUP_NAMES = ["browser", "server"];
const isCleanupResults = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return CLEANUP_NAMES.every((name) => {
    const entry = value[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (typeof entry.acquired !== "boolean" || typeof entry.success !== "boolean") return false;
    return !("error" in entry) || (entry.error && typeof entry.error === "object" && !Array.isArray(entry.error));
  });
};
const cleanupResultsFrom = (error) => {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return null;
  for (const key of ["results", "cleanup"]) {
    if (isCleanupResults(error[key])) return error[key];
  }
  return null;
};

const successSummary = (report) => ({
  config: report.config,
  fixture: report.fixture,
  frames: report.frames ?? null,
  soak: {
    heapAvailability: report.soak?.heapAvailability ?? null,
    heapSeries: report.soak?.heapSeries ?? null,
    slopeBytesPerWindow: report.soak?.linearRegressionSlopeBytesPerWindow ?? null,
    monotonicIncreaseCount: report.soak?.monotonicIncreaseCount ?? null,
    stability: report.soak?.stability ?? null,
  },
  resourceDelta: report.resources?.cycles?.map(({ delta, deltaByKind }) => ({ delta, deltaByKind })) ?? null,
  totalMs: report.timings?.totalMs ?? null,
  environment: {
    browser: report.environment?.browser?.chromiumVersion ?? null,
    platform: report.environment?.node?.platform ?? null,
  },
});


async function main() {
  const started = Date.now();
  const environment = environmentHost();
  let config = null;
  let report = { config: null, fixture: null, environment, timings: {}, resources: {}, memory: {}, pass: false };
  let stage, page, context, cdp;
  let stageRollback;
  let primary;
  const pageErrors = [];
  const consoleMessages = [];
  try {
    config = args();
    report.config = config;
    stage = await openStage();
    page = await openPage(stage.browser, "dark");
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    page.on("console", (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    context = page.context();
    cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await installProbe(page);
    await page.goto(`${stage.base}/?graphNodes=${config.nodes}&graphSeed=${config.seed}`, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: READY_SAFETY_TIMEOUT_MS });
    const fixture = await page.evaluate(() => globalThis.__fubGraphBench?.fixture ?? null);
    if (!fixture) throw new Error("graph bench metadata is absent");
    if (fixture.nodes.length !== config.nodes || fixture.seed !== config.seed || fixture.edges.length !== config.nodes * 2) throw new Error(`graph bench metadata mismatch: expected ${config.nodes}/${config.seed}/${config.nodes * 2}`);
    report.fixture = { nodes: fixture.nodes.length, edges: fixture.edges.length, seed: fixture.seed, digest: fixture.digest };
    const expectedDigest = ORACLES[`${config.nodes}:${config.seed}`];
    if (typeof fixture.digest !== "string" || !/^[0-9a-f]{8}$/.test(fixture.digest) || fixture.digest !== expectedDigest) {
      const error = new Error(`graph bench digest mismatch: requested ${expectedDigest}, observed ${String(fixture.digest)}`);
      error.requestedDigest = expectedDigest;
      error.observedDigest = fixture.digest ?? null;
      throw error;
    }
    await captureEnvironment(environment, stage.browser, page);
    await page.mouse.move(1, 1);
    const base = await page.evaluate(() => ({ children: document.querySelector("#panes")?.children.length ?? 0, probe: window.__graphScaleProbe.snapshot() }));
    report.memory.before = await heap(cdp); report.resources.scope = "DOM listeners are tracked only on window/document and elements within canvas.graph-main, canvas.graph-bg, or .graph-panel; timers, rAF, and observers are tracked only when their creation stack contains /src/graph/ or /src/panels/graph.ts while the probe is active."; report.resources.baseline = base.probe.resources.length; report.resources.baselineByKind = countKinds(base.probe.resources);
    report.soak = {
      requestedWindows: config.soakWindows,
      windows: [],
      totalActiveFrames: 0,
      heapAvailability: { status: "unsupported", reasons: [] },
      heapDeltasFromFirst: null,
      monotonicIncreaseCount: null,
      linearRegressionSlopeBytesPerWindow: null,
      stability: null,
    };
    for (let i = 0; i < config.cycles; i++) {
      await page.evaluate(() => window.__graphScaleProbe.begin());
      const t0 = performance.now();
      await page.locator("#show-graph").dispatchEvent("click");
      await page.waitForSelector("canvas.graph-main");
      await page.waitForFunction(() => { const c = document.querySelector("canvas.graph-main"); return c && c.width > 0 && c.height > 0; });
      const mounted = await page.evaluate(() => window.__graphScaleProbe.snapshot());
      report.timings[`mount${i + 1}Ms`] = performance.now() - t0;
      if (i === 0) {
        const sample = { target: FRAME_SAMPLE_TARGET, deadlineMs: FRAME_SAMPLE_SAFETY_TIMEOUT_MS, deadlineKind: "safety-timeout" };
        const canvas = page.locator("canvas.graph-main");
        const box = await canvas.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) throw new Error("graph canvas bounding box is unavailable");
        const beforeCanvas = await canvas.evaluate((c) => c.toDataURL());

        await page.evaluate(() => window.__graphScaleProbe.discard());
        const interactionFramesPromise = page.evaluate(({ target, deadlineMs }) => window.__graphScaleProbe.startFrames(target, deadlineMs), sample);
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
        await page.mouse.wheel(0, 180);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
        await page.mouse.up();
        const interactionFrameTimes = await interactionFramesPromise;
        await page.evaluate(() => window.__graphScaleProbe.stopFrames());
        const interactionObserved = await page.evaluate(() => window.__graphScaleProbe.snapshot());
        if (interactionFrameTimes.length !== sample.target) throw new Error(`frame sample incomplete: ${interactionFrameTimes.length}`);
        const interactionEntry = {
          count: interactionFrameTimes.length,
          intervals: stats(interactionFrameTimes.slice(1).map((v, j) => v - interactionFrameTimes[j])),
        };
        report.sample = sample;
        report.frames = interactionEntry;
        report.timings.interactionFrames = interactionEntry.intervals;
        report.timings.longTasks = { ...stats(interactionObserved.longtasks), over50ms: interactionObserved.longtasks.filter((x) => x > 50).length };
        report.resources.interaction = interactionObserved.resources.length;
        const wheelEvents = interactionObserved.interaction.filter((event) => event.type === "wheel");
        const pointerEvents = interactionObserved.interaction.filter((event) => event.type.startsWith("pointer"));
        const signals = { wheelDelivered: wheelEvents.length > 0, wheelPrevented: wheelEvents.some((event) => event.defaultPrevented), pointerDelivered: pointerEvents.length > 0, pointerCapture: interactionObserved.pointerCaptures.length > 0, eventTypes: [...new Set(interactionObserved.interaction.map((event) => event.type))] };
        report.interaction = { signals, events: interactionObserved.interaction, pointerCaptures: interactionObserved.pointerCaptures };
        if (!signals.wheelDelivered || !signals.wheelPrevented || !signals.pointerDelivered || !signals.pointerCapture) throw new Error(`graph interaction handlers not causal: ${JSON.stringify(signals)}`);
        if (beforeCanvas === await canvas.evaluate((c) => c.toDataURL())) throw new Error("graph interaction did not change canvas");

        for (let windowIndex = 1; windowIndex <= config.soakWindows; windowIndex++) {
          await page.evaluate(() => window.__graphScaleProbe.discard());
          const windowStarted = performance.now();
          const warm = page.locator(".graph-panel-azioni button").first();
          if (!(await warm.count())) throw new Error("graph physics warm action is absent");
          await warm.dispatchEvent("click");
          const framePromise = page.evaluate(({ target, deadlineMs }) => window.__graphScaleProbe.startFrames(target, deadlineMs), sample);
          const frameTimes = await framePromise;
          await page.evaluate(() => window.__graphScaleProbe.stopFrames());
          const observed = await page.evaluate(() => window.__graphScaleProbe.snapshot());
          if (frameTimes.length !== sample.target) throw new Error(`frame sample incomplete: ${frameTimes.length}`);
          const heapUsed = await collectHeap(cdp);
          const entry = {
            window: windowIndex,
            wallMs: performance.now() - windowStarted,
            frames: { count: frameTimes.length, intervals: stats(frameTimes.slice(1).map((v, j) => v - frameTimes[j])) },
            longTasks: { ...stats(observed.longtasks), over50ms: observed.longtasks.filter((x) => x > 50).length },
            heapUsed,
          };
          report.soak.windows.push(entry);
          report.soak.totalActiveFrames += frameTimes.length;
        }
        await page.evaluate(() => window.__graphScaleProbe.end());
        const heapSeries = report.soak.windows.map(({ heapUsed }) => typeof heapUsed === "number" ? heapUsed : null);
        const failures = report.soak.windows.flatMap(({ heapUsed }) => typeof heapUsed === "number" ? [] : [heapUsed?.reason ?? "JSHeapUsedSize unavailable"]);
        const complete = heapSeries.every((value) => typeof value === "number");
        const status = complete ? "complete" : heapSeries.some((value) => typeof value === "number") ? "partial" : "unsupported";
        report.soak.heapAvailability = { status, reasons: [...new Set(failures)] };
        report.soak.heapSeries = heapSeries;
        if (complete) {
          const firstHeap = heapSeries[0];
          report.soak.heapDeltasFromFirst = heapSeries.map((value) => value - firstHeap);
          report.soak.monotonicIncreaseCount = heapSeries.slice(1).reduce((count, value, index) => count + (value > heapSeries[index] ? 1 : 0), 0);
          report.soak.linearRegressionSlopeBytesPerWindow = linearSlope(heapSeries);
        }
        report.soak.stability = heapStability(config, heapSeries);
        if (report.soak.stability.required && !report.soak.stability.pass) {
          throw new Error(`graph heap stability failed: ${JSON.stringify(report.soak.stability)}`);
        }
      }
      await page.evaluate(() => window.__graphScaleProbe.end());
      await closeGraph(page);
      const postClose = await page.evaluate(() => window.__graphScaleProbe.snapshot());
      const postCloseCounts = countKinds(postClose.resources);
      const deltaByKind = Object.fromEntries(Array.from(new Set([...Object.keys(postCloseCounts), ...Object.keys(report.resources.baselineByKind)]), (kind) => [kind, (postCloseCounts[kind] ?? 0) - (report.resources.baselineByKind[kind] ?? 0)]));
      if (Object.values(deltaByKind).some((delta) => delta > 0)) {
        const details = await page.evaluate(() => window.__graphScaleProbe.details());
        throw new Error(`graph resources leaked after close: ${JSON.stringify({ deltaByKind, details })}`);
      }
      report.resources.cycles ??= [];
      report.resources.cycles.push({ mounted: mounted.resources.length, mountedByKind: countKinds(mounted.resources), postClose: postClose.resources.length, postCloseByKind: postCloseCounts, delta: postClose.resources.length - base.probe.resources.length, deltaByKind });
    }
    report.memory.afterCleanup = await heap(cdp);
  } catch (error) {
    primary = error;
    stageRollback = cleanupResultsFrom(error);
    report.failure = {
      name: error?.name,
      message: String(error?.message ?? error),
      ...(error?.requestedDigest !== undefined ? { requestedDigest: error.requestedDigest, observedDigest: error.observedDigest } : {}),
      ...(pageErrors.length || consoleMessages.length ? { pageErrors, console: consoleMessages } : {}),
    };
  }
  const cleanup = {};
  const closeOne = async (name, acquired, close) => {
    if (!acquired) { cleanup[name] = { acquired: false, success: true }; return; }
    try { await close(); cleanup[name] = { acquired: true, success: true }; }
    catch (error) {
      cleanup[name] = { acquired: true, success: false, error: { name: error?.name, message: String(error?.message ?? error) } };
      primary ??= error;
    }
  };
  await closeOne("cdp", !!cdp, () => cdp.detach());
  await closeOne("page", !!page, () => page.close());
  await closeOne("context", !!context, () => context.close());
  if (stage) {
    try {
      const result = await stage.close();
      cleanup.browser = result.browser;
      cleanup.server = result.server;
    } catch (error) {
      const results = cleanupResultsFrom(error);
      if (results) Object.assign(cleanup, results);
      primary ??= error;
    }
  } else if (stageRollback) {
    Object.assign(cleanup, stageRollback);
  } else {
    cleanup.browser = { acquired: false, success: true };
    cleanup.server = { acquired: false, success: true };
  }
  report.cleanup = cleanup;
  report.pass = !primary;
  report.timings.totalMs = Date.now() - started;
  if (primary) report.failure ??= { name: primary?.name, message: String(primary?.message ?? primary) };
  try {
    await writeReport(report);
  } catch (error) {
    primary ??= error;
    console.error(`graph-scale: report write failed: ${error.message}`);
  }
  if (!primary) console.log(JSON.stringify(successSummary(report)));
  if (primary) throw primary;
}

main().catch((error) => { console.error(`graph-scale: ${error.message}`); process.exitCode = 1; });
