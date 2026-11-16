// Fotogrammi, quiete e thread principale per gli scenari F1–F3: gli script
// che girano nella pagina, la statistica dei fotogrammi rispetto al periodo
// dello schermo e il percorso di disegno della WebView.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/// F1: `ms` di rAF su una pagina ferma; torna i delta fra un fotogramma e
/// l'altro, in ms. Si chiama con `executeAsync`.
export const IDLE_RAF_SCRIPT = `
const ms = arguments[0], done = arguments[arguments.length - 1];
const deltas = []; let last = 0, first = 0;
const tick = (t) => {
  if (last) deltas.push(t - last); else first = t;
  last = t;
  if (t - first < ms) requestAnimationFrame(tick); else done(deltas);
};
requestAnimationFrame(tick);`;

/// F2: conta le richieste di fotogramma della pagina da ora in poi. La
/// funzione si avvolge una volta sola; `read()` dice quante e le animazioni
/// che girano (una animazione CSS fa disegnare anche senza rAF).
export const RAF_COUNTER_SCRIPT = `
if (!window.__fubRafCount) {
  const original = window.requestAnimationFrame.bind(window);
  const counter = { requests: 0 };
  window.requestAnimationFrame = (callback) => { counter.requests++; return original(callback); };
  counter.read = () => ({
    requests: counter.requests,
    animations: document.getAnimations().filter((a) => a.playState === "running").slice(0, 20)
      .map((a) => (a.animationName || a.transitionProperty || a.id || "waapi") + " @ " + String(a.effect?.target?.id || a.effect?.target?.className || a.effect?.target?.tagName || "?").slice(0, 60)),
  });
  window.__fubRafCount = counter;
}
window.__fubRafCount.requests = 0;
return true;`;

/// Sotto questa soglia un buco fra due giri di timer è il timer stesso
/// (setTimeout annidato si ferma a 4 ms), non thread principale bloccato.
export const TIMER_GAP_MS = 5;

/// F3: il registratore dei gesti. `start()` accende un anello di rAF (i
/// delta) e uno di setTimeout(0): un buco fra due giri del timer oltre
/// `TIMER_GAP_MS` è tempo in cui il thread principale non ha potuto
/// eseguire niente, la misura dei long task che WebKit non ha. `mark()`
/// segna l'inizio di una ripetizione. Se il motore ha i long task, li tiene
/// accanto.
export const RECORDER_SCRIPT = `
if (!window.__fubRec) {
  const rec = { on: false };
  rec.longtasks = typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes("longtask");
  rec.start = () => {
    rec.on = true; rec.frames = []; rec.gaps = []; rec.marks = []; rec.tasks = [];
    let last = 0;
    const tick = (t) => { if (!rec.on) return; if (last) rec.frames.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    let prev = performance.now();
    const spin = () => {
      if (!rec.on) return;
      const now = performance.now();
      if (now - prev > ${TIMER_GAP_MS}) rec.gaps.push([now, now - prev]);
      prev = now;
      setTimeout(spin, 0);
    };
    setTimeout(spin, 0);
    if (rec.longtasks) {
      rec.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) rec.tasks.push([e.startTime + e.duration, e.duration]); });
      rec.observer.observe({ type: "longtask" });
    }
    rec.started = performance.now();
  };
  rec.mark = () => { rec.marks.push(performance.now()); };
  rec.stop = () => {
    rec.on = false;
    rec.observer?.disconnect();
    return { frames: rec.frames, gaps: rec.gaps, marks: rec.marks, tasks: rec.tasks, longtasks: rec.longtasks, started: rec.started, stopped: performance.now() };
  };
  window.__fubRec = rec;
}
return true;`;

/// Il renderer della WebView visto da WebGL, il più vicino a ciò che disegna
/// la pagina.
export const RENDERER_SCRIPT = `
try {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return { renderer: null, vendor: null };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const read = { renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER), vendor: gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR) };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return read;
} catch (error) { return { renderer: null, vendor: null, error: String(error) }; }`;

const SOFTWARE = /llvmpipe|softpipe|swrast|swiftshader|software/i;
const GL_LIBS = /gallium|llvmpipe|swrast|nvidia-eglcore|nvidia-glcore|libEGL_nvidia|libEGL_mesa|_dri\.so|radeonsi|iris/;

/// WebKitGTK nasconde il renderer vero a WebGL e risponde così.
const MASKED = /^Apple GPU$/;

/// La pagina `webkit://gpu` di una WebView WebKitGTK aperta con l'ambiente
/// dell'app (PyGObject e WebKit2 4.1): il suo testo, su stdout.
export const WEBKIT_GPU_SCRIPT = [
  "import gi",
  "gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')",
  "from gi.repository import Gtk, WebKit2, GLib",
  "w = Gtk.Window(); w.set_default_size(600, 400); v = WebKit2.WebView(); w.add(v); w.show_all()",
  "def done(obj, res):",
  "    print(obj.evaluate_javascript_finish(res).to_string()); Gtk.main_quit()",
  "def loaded(view, ev):",
  "    if ev == WebKit2.LoadEvent.FINISHED:",
  "        GLib.timeout_add(1000, lambda: view.evaluate_javascript('document.body.innerText', -1, None, None, None, done) and False)",
  "v.connect('load-changed', loaded); v.load_uri('webkit://gpu')",
  "GLib.timeout_add(15000, Gtk.main_quit); Gtk.main()",
].join("\n");

/// Le voci di `webkit://gpu` che servono: un'etichetta su una riga, il
/// valore sulla riga dopo.
export function parseWebkitGpu(text) {
  const lines = text.split("\n").map((line) => line.trim());
  const value = (label) => {
    const at = lines.indexOf(label);
    return at >= 0 && lines[at + 1] ? lines[at + 1] : null;
  };
  const read = {
    renderer: value("GL_RENDERER"),
    vblank: value("VBlank type"),
    vblankRate: value("VBlank refresh rate"),
    buffers: value("Renderer"),
    threaded: value("Threaded rendering"),
  };
  return Object.values(read).some((v) => v !== null) ? read : null;
}

/// `webkit://gpu` letta da una WebView a parte con l'ambiente `env`, o
/// `null` se non si può (niente PyGObject, niente display, non Linux).
export function webkitGpu(env, run = (command, argv) => execFileSync(command, argv, { env, encoding: "utf8", timeout: 25_000, stdio: ["ignore", "pipe", "ignore"] })) {
  if (process.platform !== "linux") return null;
  try {
    return parseWebkitGpu(run("python3", ["-c", WEBKIT_GPU_SCRIPT]));
  } catch {
    return null;
  }
}

/// Il percorso di disegno: «cpu» (llvmpipe e simili), «gpu» o «sconosciuto».
/// Il renderer viene da `webkit://gpu` (`gpu`, la fonte migliore) o da
/// WebGL, se WebKit non lo nasconde; le librerie GL mappate dai processi
/// della WebView sono la prova accanto.
export function renderPath({ gpu = null, webgl = null, libraries = [] } = {}) {
  const fromWebgl = webgl && !MASKED.test(webgl) ? webgl : null;
  const renderer = gpu?.renderer ?? fromWebgl;
  const path = !renderer ? "sconosciuto" : SOFTWARE.test(renderer) ? "cpu" : "gpu";
  return { path, renderer, source: gpu?.renderer ? "webkit://gpu" : fromWebgl ? "webgl" : null, webgl, vblank: gpu ? `${gpu.vblank ?? "?"}, ${gpu.vblankRate ?? "?"}` : null, gpu, libraries };
}

/// Le librerie GL mappate da ogni processo in `pids` (Linux; altrove vuoto).
export function glLibraries(processes) {
  const seen = new Set();
  for (const { pid } of processes) {
    try {
      for (const line of readFileSync(`/proc/${pid}/maps`, "utf8").split("\n")) {
        const name = line.split("/").pop();
        if (name && GL_LIBS.test(name)) seen.add(name);
      }
    } catch {
      // uscito, o non Linux
    }
  }
  return [...seen].sort();
}

const round1 = (x) => Math.round(x * 10) / 10;

/// Il percentile `p` (0–1) a rango più vicino, come la sonda.
function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/// Statistica dei delta fra fotogrammi rispetto al periodo `periodMs`:
/// mediana, p90, p95, massimo e fotogrammi persi (ogni delta conta
/// round(delta / P) − 1 fotogrammi mancati). `null` senza delta.
export function frameStats(deltas, periodMs) {
  if (!deltas?.length) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  const lost = deltas.reduce((sum, d) => sum + Math.max(0, Math.round(d / periodMs) - 1), 0);
  const total = deltas.reduce((sum, d) => sum + d, 0);
  return {
    count: deltas.length,
    median: round1(percentile(sorted, 0.5)),
    p90: round1(percentile(sorted, 0.9)),
    p95: round1(percentile(sorted, 0.95)),
    max: round1(sorted.at(-1)),
    lost,
    lostPerSecond: round1((lost * 1000) / total),
    hz: round1(1000 / percentile(sorted, 0.5)),
  };
}

/// Il thread principale bloccato in ogni ripetizione di un gesto: per la
/// ripetizione i, fra `marks[i]` e l'inizio della successiva (o `stopped`),
/// il buco più lungo fra due giri del timer che finisce lì dentro, 0 se non
/// ce n'è. Torna anche la mediana, il massimo e la somma dei buchi oltre
/// 50 ms (i long task).
export function blockedPerRepetition({ gaps, marks, stopped }) {
  const ends = [...marks.slice(1), stopped];
  const perRep = marks.map((from, i) => {
    let longest = 0;
    for (const [end, gap] of gaps) if (end >= from && end < ends[i] && gap > longest) longest = gap;
    return round1(longest);
  });
  const sorted = [...perRep].sort((a, b) => a - b);
  return {
    perRep,
    median: sorted.length ? round1(percentile(sorted, 0.5)) : null,
    max: sorted.length ? sorted.at(-1) : null,
    over50ms: round1(gaps.filter(([, gap]) => gap > 50).reduce((sum, [, gap]) => sum + gap, 0)),
  };
}
