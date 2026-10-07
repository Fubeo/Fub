// **Il banco delle tavole**: quanto ci mette il disegno a passare da una
// tavola all'altra con la tastiera, e se ci passa davvero.
//
//     node bench/boards.mjs                # 20 tavole, con le soglie
//     node bench/boards.mjs --boards 1000  # da 2 a 1000 tavole
//     node bench/boards.mjs --cpu 4        # la pagina quattro volte più lenta
//
// Il disegno è quello di `boards-fixture.ts`: le tavole in righe, nei formati
// di tutti i giorni, con le carte bianche, colorate o senza, e da 40 a 80
// oggetti ciascuna. Il banco lo apre nell'app vera, dalla pagina del banco
// (`?boards=N`, in `fake-ipc.ts`), al livello Standard, e lo percorre in due
// corse:
//
// 1. **Alt+Pag↓ e Alt+Pag↑**, con lo strumento Selezione: dalla prima tavola
//    all'ultima e indietro, ogni tavola scelta e inquadrata; oltre le
//    estremità il disegno lo dice e la vista resta dov'è.
// 2. **Tab**, con lo strumento Tavola: Inizio sceglie la prima, poi un Tab
//    per tavola fino all'ultima, che la vista mostra; un Tab ancora esce dal
//    foglio.
//
// # Che cosa misura
//
// Per ogni tasto, il tempo dal suo `timeStamp`, cioè da quando il browser l'ha
// ricevuto, al fotogramma dopo, dipinto: un `requestAnimationFrame` chiesto
// mentre il tasto arriva, e in quel fotogramma un messaggio, che arriva quando
// il fotogramma ha finito stile, layout e pittura. Dentro c'è l'attesa del
// tasto, ciò che l'editor fa, l'attesa del fotogramma e il fotogramma stesso:
// ciò che separa il tasto da ciò che si vede. Durante le corse il banco
// registra anche gli intervalli fra un fotogramma e l'altro, i compiti lunghi
// (Long Tasks API: ogni compito oltre i 50 ms), i fotogrammi lunghi
// (`long-animation-frame`, con gli script che ci pesano di più) e, dove il
// browser la dà, la durata del tasto fino alla presentazione (Event Timing,
// solo oltre i 16 ms). I tasti vanno uno dopo l'altro, ognuno quando il
// precedente è dipinto e controllato.
//
// Ogni passo si controlla: un banco veloce che arriva alla tavola sbagliata è
// rosso. La regione viva deve dire il nome della tavola attesa, col suo
// numero e il totale; la sua carta, sullo schermo, deve stare al centro della
// vista e riempirla con Alt+Pag, starci dentro tutta col Tab, e il suo nome
// dev'essere l'unico scelto.
//
// # Le soglie, misurate
//
// Valgono fino a 20 tavole; oltre, il banco misura, controlla e riferisce
// senza soglie. Sono due: nessun compito lungo durante le corse, e ogni passo
// dipinto entro `STEP_LIMIT_MS`, 50 ms, cioè tre fotogrammi a 60 Hz. Le
// misure sono di questa macchina (Ryzen 7 7730U, 16 thread, Chromium 149
// senza finestra, pagina 1280×800, foglio 410×439), a 20 tavole e 1237
// oggetti:
//
// - **A riposo**, sette corse: ogni passo si dipinge nel fotogramma dopo il
//   tasto, al più in 17,6 ms. L'editor ci mette al più 0,9 ms, il
//   fotogramma al più 3,1. Nessun compito lungo.
// - **A macchina piena**, sedici processi che girano a vuoto, uno per thread,
//   tre corse: al più 32 ms, nessun compito lungo.
// - **A pagina rallentata** (`--cpu N`, che chiede a Chromium di rallentarla
//   N volte, dopo l'apertura): quattro volte, al più 25,8 ms; sei volte,
//   36,6 ms; dieci volte, 66 ms e un compito lungo di 55, ed è rosso.
//
// Due fotogrammi, 33 ms, sarebbero stati sul filo della macchina piena, e un
// banco che sfarfalla si spegne. Tre stanno sopra il peggio della macchina
// piena e della pagina sei volte più lenta, e sotto un passo che costi dieci
// volte tanto; sono anche il confine dei compiti lunghi, e il tempo che il
// modello RAIL dà a un tasto perché ciò che fa si veda entro i 100 ms.
//
// A mille tavole (40 000 oggetti) le soglie non valgono: il banco dice quanto
// ci si allontana. Oggi un passo si dipinge, in mediana, in 105 ms con Alt+Pag
// e in 47 ms col Tab, e quattro Alt+Pag su cinque fanno un compito lungo. Il
// tempo è quasi tutto del browser: Alt+Pag cambia lo zoom, e a ogni cambio di
// zoom il browser rifà il layout di tutto l'SVG (circa 60 ms) e lo ridipinge
// (circa 40); l'editor ci mette circa 10 ms, quasi tutti a rimettere al loro
// posto le mille carte e i mille nomi.
//
// Dopo le corse il banco prova sé stesso: un Tab di troppo deve fargli vedere
// la tavola sbagliata, e un tasto che tiene occupata la pagina 30 ms più
// della soglia deve farlo diventare rosso, per la soglia del passo e per
// quella dei compiti lunghi.
//
// Il referto, con ogni passo, sta in `.output/boards-N.json`
// (`boards-N-cpuK.json` a pagina rallentata).

import * as os from "node:os";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openStage, openPage, OUTPUT } from "./stage.mjs";

/// Quante tavole, se non lo si dice; e da quante a quante: due almeno, per la
/// prova del banco, e al più quante una scena ne riceve (formato della scena,
/// §11).
const DEFAULT_BOARDS = 20;
const LIMITS = [2, 1000];
/// Di quanto, al più, `--cpu` rallenta la pagina.
const CPU_LIMIT = 20;
/// Fino a quante tavole valgono le soglie.
const GATED_BOARDS = 20;
/// La soglia di un passo, dal tasto al fotogramma dipinto (vedi sopra).
const STEP_LIMIT_MS = 50;
/// Un compito lungo, per il browser: oltre i 50 ms.
const LONG_TASK_MS = 50;
/// Quanto si aspetta dopo l'ultimo passo di una corsa, perché ciò che
/// l'editor rimanda arrivi dentro la corsa: più dei 150 ms con cui il painter
/// rimette a posto gli strati immagine dopo un movimento della vista.
const TAIL_MS = 400;
/// Quanto si aspetta, al più, che il disegno si apra e che un passo si dipinga.
const OPEN_TIMEOUT_MS = 180_000;
const STEP_TIMEOUT_MS = 30_000;
/// Quante cose fuori posto dice la console; il referto le ha tutte.
const SHOWN_FAILURES = 20;
/// I tasti della navigazione, quelli che la sonda misura.
const KEYS = ["PageDown", "PageUp", "Tab", "Home"];

function args() {
  const out = { boards: DEFAULT_BOARDS, cpu: 1 };
  for (let i = 2; i < process.argv.length; i++) {
    const m = /^--(boards|cpu)(?:=(\d+))?$/.exec(process.argv[i]);
    if (!m) throw new RangeError(`argomento sconosciuto: ${process.argv[i]}`);
    const value = m[2] ?? process.argv[++i];
    if (!/^\d+$/.test(value ?? "")) throw new RangeError(`--${m[1]} vuole un numero`);
    out[m[1]] = Number(value);
  }
  if (out.boards < LIMITS[0] || out.boards > LIMITS[1]) throw new RangeError(`--boards va da ${LIMITS[0]} a ${LIMITS[1]}`);
  if (out.cpu < 1 || out.cpu > CPU_LIMIT) throw new RangeError(`--cpu va da 1 a ${CPU_LIMIT}`);
  return { ...out, gated: out.boards <= GATED_BOARDS };
}

// ---------------------------------------------------------------------------
// La sonda, nella pagina.
// ---------------------------------------------------------------------------

/// Mette nella pagina la sonda, `window.__boardsProbe`: registra ogni tasto
/// della navigazione dal suo `timeStamp` al fotogramma dipinto dopo, e, fra
/// `begin` ed `end`, i fotogrammi, i compiti lunghi, i fotogrammi lunghi e le
/// durate di Event Timing. Con `plant(ms)` ogni tasto misurato tiene occupata
/// la pagina per `ms`: è la lentezza della prova del banco.
async function installProbe(page) {
  await page.evaluate((keys) => {
    const KEYS = new Set(keys);
    const state = { active: false, run: 0, since: 0, steps: [], frames: [], waiter: null, planted: 0 };
    // Che cosa si osserva, con che cosa se ne tiene: i compiti lunghi, i
    // fotogrammi lunghi, le durate di Event Timing.
    const KINDS = {
      longtask: [{}, (e) => ({ start: e.startTime, duration: e.duration })],
      "long-animation-frame": [{}, (e) => ({
        start: e.startTime,
        duration: e.duration,
        blocking: e.blockingDuration,
        scripts: e.scripts.map((script) => ({
          invoker: script.invoker,
          source: `${script.sourceFunctionName || "?"} in ${script.sourceURL.replace(/^.*\//, "").replace(/\?.*$/, "") || "?"}`,
          duration: script.duration,
          forced: script.forcedStyleAndLayoutDuration,
        })),
      })],
      event: [{ durationThreshold: 16 }, (e) => ({ name: e.name, start: e.startTime, duration: e.duration })],
    };
    const observed = Object.fromEntries(Object.keys(KINDS).map((type) => [type, []]));
    const keep = (entry) => observed[entry.entryType]?.push(KINDS[entry.entryType][1](entry));
    const observers = [];
    const supported = Object.fromEntries(Object.entries(KINDS).map(([type, [options]]) => {
      try {
        const observer = new PerformanceObserver((list) => list.getEntries().forEach(keep));
        observer.observe({ type, ...options });
        observers.push(observer);
        return [type, true];
      } catch {
        return [type, false];
      }
    }));
    const drain = () => {
      for (const observer of observers) observer.takeRecords().forEach(keep);
    };
    /// I fotogrammi di una corsa, finché la corsa dura.
    const loop = (run) => (time) => {
      if (!state.active || state.run !== run) return;
      state.frames.push(time);
      requestAnimationFrame(loop(run));
    };
    const surface = () => document.querySelector(".draw-editor .draw-surface");
    /// Ciò che si vede dopo un passo: la regione viva, la vista, la carta e
    /// il nome della tavola `at`, quanti nomi sono scelti, dove sta il fuoco.
    const read = (at) => {
      const host = surface();
      const box = host.getBoundingClientRect();
      const sheet = host.querySelectorAll(".draw-sheets > .draw-page")[at];
      const name = host.querySelectorAll(".draw-sheets > .draw-sheet-name")[at];
      const rect = sheet?.getBoundingClientRect();
      const rulers = host.querySelector(".draw-rulers");
      return {
        live: document.querySelector('.draw-editor > [role="status"][aria-live="polite"]')?.textContent ?? null,
        area: { width: host.clientWidth, height: host.clientHeight },
        rulers: rulers !== null && getComputedStyle(rulers).display !== "none",
        sheet: rect ? [rect.x - box.x - host.clientLeft, rect.y - box.y - host.clientTop, rect.width, rect.height] : null,
        named: name ? !name.hidden && name.hasAttribute("data-chosen") : false,
        chosen: host.querySelectorAll(".draw-sheets > .draw-sheet-name[data-chosen]:not([hidden])").length,
        focused: document.activeElement === host,
        tool: host.dataset.tool ?? null,
      };
    };
    addEventListener("keydown", (event) => {
      if (!state.active || !KEYS.has(event.key)) return;
      const step = { key: event.key, at: event.timeStamp, dispatched: performance.now(), handled: null, frame: null, painted: null };
      state.steps.push(step);
      requestAnimationFrame(() => {
        step.frame = performance.now();
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          step.painted = performance.now();
          channel.port1.close();
          state.waiter?.();
        };
        channel.port2.postMessage(null);
      });
      if (state.planted > 0) {
        const until = performance.now() + state.planted;
        while (performance.now() < until) {
          // La lentezza della prova: la pagina resta occupata.
        }
      }
    }, true);
    // In bolla sulla finestra: dopo l'editor, che ascolta sulla sua radice.
    addEventListener("keydown", (event) => {
      const step = state.steps[state.steps.length - 1];
      if (state.active && step !== undefined && step.handled === null && step.at === event.timeStamp) step.handled = performance.now();
    });
    window.__boardsProbe = Object.freeze({
      supported,
      read,
      plant: (ms) => { state.planted = ms; },
      begin: () => {
        drain();
        for (const list of Object.values(observed)) list.length = 0;
        state.steps = [];
        state.frames = [];
        state.since = performance.now();
        state.active = true;
        state.run += 1;
        requestAnimationFrame(loop(state.run));
      },
      /// Aspetta che il passo `count` sia dipinto, e dice ciò che si vede.
      painted: (count, at, timeoutMs) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          state.waiter = null;
          reject(new Error(`il passo ${count} non si è dipinto in ${timeoutMs} ms (${state.steps.length} tasti arrivati)`));
        }, timeoutMs);
        const check = () => {
          const step = state.steps[count - 1];
          if (step === undefined || step.painted === null) return;
          clearTimeout(timer);
          state.waiter = null;
          resolve({ steps: state.steps.length, ...read(at) });
        };
        state.waiter = check;
        check();
      }),
      end: () => {
        state.active = false;
        drain();
        const since = state.since;
        const inside = (list) => list.filter((entry) => entry.start >= since);
        return {
          since,
          until: performance.now(),
          steps: state.steps,
          frames: state.frames,
          longtasks: inside(observed.longtask),
          longFrames: inside(observed["long-animation-frame"]),
          events: inside(observed.event).filter((entry) => entry.name === "keydown"),
        };
      },
    });
  }, KEYS);
}

// ---------------------------------------------------------------------------
// I passi, e ciò che ogni passo deve mostrare.
// ---------------------------------------------------------------------------

/// Un passo che va alla tavola sbagliata, o che non la mostra come deve.
class WrongStep extends Error {}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/// Controlla ciò che si vede dopo un passo contro ciò che il passo doveva
/// fare. `expect.kind` è `framed` (scelta e inquadrata, Alt+Pag), `shown`
/// (scelta e in vista, Tab e Inizio), `edge` (oltre un'estremità: lo si dice
/// e la vista resta) o `exit` (il Tab esce dal foglio).
function check(seen, expect, boards, before) {
  const fail = (message) => {
    throw new WrongStep(`${expect.label}: ${message}; la regione viva dice «${(seen.live ?? "").trim()}»`);
  };
  const live = (seen.live ?? "").trim();
  if (seen.rulers) fail("i righelli sono accesi, e il banco misura la vista senza");
  const { width, height } = seen.area;
  if (expect.kind === "exit") {
    if (seen.focused) fail("il Tab dopo l'ultima tavola non esce dal foglio");
    if (live !== (before?.live ?? "").trim()) fail("il Tab che esce dal foglio cambia ciò che il disegno dice");
    return;
  }
  const board = boards[expect.board];
  const total = boards.length;
  if (expect.kind === "edge") {
    if (!live.startsWith(`${board.name} `)) fail(`oltre l'estremità il disegno doveva dire di «${board.name}»`);
    const same = before?.sheet && seen.sheet && seen.sheet.every((value, i) => Math.abs(value - before.sheet[i]) <= 0.5);
    if (!same) fail("oltre l'estremità la vista si è mossa");
    return;
  }
  // Il nome, poi il posto della tavola e quante sono: i primi due numeri
  // dopo il nome, comunque la frase li dica.
  const said = new RegExp(`^${escapeRegExp(board.name)}, \\D*?(\\d+)\\D+?(\\d+)\\b`).exec(live);
  if (said === null || Number(said[1]) !== expect.board + 1 || Number(said[2]) !== total) {
    fail(`doveva dire «${board.name}», tavola ${expect.board + 1} di ${total}`);
  }
  if (!seen.focused) fail("il fuoco non è più sul foglio");
  if (seen.sheet === null) fail(`la carta di «${board.name}» non c'è`);
  const [x, y, w, h] = seen.sheet;
  const inside = x >= -0.5 && y >= -0.5 && x + w <= width + 0.5 && y + h <= height + 0.5;
  if (!inside) fail(`«${board.name}» non sta tutta nella vista`);
  if (expect.kind === "framed") {
    const centered = Math.abs(x + w / 2 - width / 2) <= 1 && Math.abs(y + h / 2 - height / 2) <= 1;
    if (!centered) fail(`«${board.name}» non sta al centro della vista`);
    if (Math.max(w / width, h / height) < 0.5) fail(`«${board.name}» non riempie la vista`);
  } else {
    if (!seen.named) fail(`il nome di «${board.name}» non è quello scelto`);
    if (seen.chosen !== 1) fail(`${seen.chosen} nomi di tavola scelti invece di uno`);
  }
}

/// Un passo: preme `key`, aspetta il fotogramma dipinto, e controlla ciò che
/// si vede. Con `extra` preme il tasto altre volte, come un dito che scivola:
/// è il passo sbagliato della prova del banco, e il controllo deve vederlo.
async function step(page, run, key, expect, boards, extra = 0) {
  for (let i = 0; i <= extra; i++) await page.keyboard.press(key);
  run.count += 1 + extra;
  const at = expect.board ?? 0;
  const seen = await page.evaluate(
    ([count, at, timeoutMs]) => window.__boardsProbe.painted(count, at, timeoutMs),
    [run.count, at, STEP_TIMEOUT_MS],
  );
  if (seen.steps !== run.count) throw new WrongStep(`${expect.label}: arrivati ${seen.steps} tasti invece di ${run.count}`);
  check(seen, expect, boards, run.last);
  run.labels.push(...Array.from({ length: 1 + extra }, () => expect.label));
  run.last = seen;
  return seen;
}

/// Un tasto fuori misura, per preparare una corsa: lo strumento, la tavola
/// da cui si parte.
async function prepare(page, key) {
  await page.keyboard.press(key);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const newRun = () => ({ count: 0, labels: [], last: null });

/// La prima corsa: Alt+Pag↓ fino all'ultima tavola, uno di troppo, Alt+Pag↑
/// fino alla prima, uno di troppo. Parte dalla prima tavola, scelta con lo
/// strumento Tavola, e corre con lo strumento Selezione.
async function pageRun(page, boards) {
  await prepare(page, "f");
  await prepare(page, "Home");
  await prepare(page, "v");
  const first = await page.evaluate(() => window.__boardsProbe.read(0));
  if (first.tool !== "select") throw new WrongStep(`lo strumento Selezione non si sceglie con V: è ${first.tool}`);
  const run = newRun();
  run.last = first;
  await page.evaluate(() => window.__boardsProbe.begin());
  const n = boards.length;
  for (let at = 1; at < n; at++) {
    await step(page, run, "Alt+PageDown", { kind: "framed", board: at, label: `Alt+Pag↓ verso «${boards[at].name}»` }, boards);
  }
  await step(page, run, "Alt+PageDown", { kind: "edge", board: n - 1, label: `Alt+Pag↓ oltre «${boards[n - 1].name}»` }, boards);
  for (let at = n - 2; at >= 0; at--) {
    await step(page, run, "Alt+PageUp", { kind: "framed", board: at, label: `Alt+Pag↑ verso «${boards[at].name}»` }, boards);
  }
  await step(page, run, "Alt+PageUp", { kind: "edge", board: 0, label: `Alt+Pag↑ oltre «${boards[0].name}»` }, boards);
  return finish(page, run);
}

/// La seconda corsa: lo strumento Tavola, Inizio, un Tab per tavola fino
/// all'ultima, e uno che esce dal foglio.
async function tabRun(page, boards) {
  await prepare(page, "f");
  const run = newRun();
  run.last = await page.evaluate(() => window.__boardsProbe.read(0));
  if (run.last.tool !== "board") throw new WrongStep(`lo strumento Tavola non si sceglie con F: è ${run.last.tool}`);
  await page.evaluate(() => window.__boardsProbe.begin());
  await step(page, run, "Home", { kind: "shown", board: 0, label: `Inizio verso «${boards[0].name}»` }, boards);
  for (let at = 1; at < boards.length; at++) {
    await step(page, run, "Tab", { kind: "shown", board: at, label: `Tab verso «${boards[at].name}»` }, boards);
  }
  await step(page, run, "Tab", { kind: "exit", label: `Tab oltre «${boards[boards.length - 1].name}»` }, boards);
  return finish(page, run);
}

/// La coda di una corsa, e ciò che la sonda ha visto.
async function finish(page, run) {
  await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), TAIL_MS);
  const probe = await page.evaluate(() => window.__boardsProbe.end());
  return summarize(probe, run.labels);
}

// ---------------------------------------------------------------------------
// I numeri.
// ---------------------------------------------------------------------------

const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const stats = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { count: 0, p50: null, p95: null, max: null };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { count: a.length, p50: round(q(0.5)), p95: round(q(0.95)), max: round(a[a.length - 1]) };
};

/// I fotogrammi lunghi di una corsa: quanto durano, quanto bloccano, e gli
/// script che ci pesano di più, sommati per chi li chiama. Il resto della
/// loro durata è del browser: stile, layout, pittura.
function longFrames(frames) {
  const scripts = new Map();
  for (const frame of frames) {
    for (const script of frame.scripts) {
      const key = `${script.invoker} · ${script.source}`;
      const seen = scripts.get(key) ?? { script: key, count: 0, totalMs: 0, maxMs: 0, forcedLayoutMs: 0 };
      seen.count += 1;
      seen.totalMs += script.duration;
      seen.maxMs = Math.max(seen.maxMs, script.duration);
      seen.forcedLayoutMs += script.forced;
      scripts.set(key, seen);
    }
  }
  const heaviest = [...scripts.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 5)
    .map((seen) => ({ ...seen, totalMs: round(seen.totalMs), maxMs: round(seen.maxMs), forcedLayoutMs: round(seen.forcedLayoutMs) }));
  return {
    ...stats(frames.map((frame) => frame.duration)),
    blockingMs: stats(frames.map((frame) => frame.blocking)),
    scripts: heaviest,
  };
}

/// I passi e i fotogrammi di una corsa, in numeri.
function summarize(probe, labels) {
  const steps = probe.steps.map((step, i) => {
    const timing = probe.events.find((entry) => Math.abs(entry.start - step.at) < 0.5);
    return {
      label: labels[i] ?? null,
      key: step.key,
      latencyMs: round(step.painted - step.at),
      inputDelayMs: round(step.dispatched - step.at),
      handlerMs: step.handled === null ? null : round(step.handled - step.dispatched),
      renderMs: round(step.painted - step.frame),
      presentedMs: timing ? round(timing.duration) : null,
    };
  });
  const intervals = probe.frames.slice(1).map((time, i) => time - probe.frames[i]);
  const frame = stats(intervals);
  return {
    steps,
    latencyMs: stats(steps.map((step) => step.latencyMs)),
    inputDelayMs: stats(steps.map((step) => step.inputDelayMs)),
    handlerMs: stats(steps.map((step) => step.handlerMs)),
    renderMs: stats(steps.map((step) => step.renderMs)),
    frames: { ...frame, long: intervals.filter((value) => value > 1.5 * (frame.p50 ?? Infinity)).length },
    longTasks: probe.longtasks.map((entry) => ({ startMs: round(entry.start - probe.since), durationMs: round(entry.duration) })),
    longFrames: longFrames(probe.longFrames),
    eventTiming: { ...stats(steps.map((step) => step.presentedMs)), note: "solo i tasti oltre i 16 ms, arrotondati a 8 ms" },
    wallMs: round(probe.until - probe.since),
  };
}

/// Ciò che una corsa sbaglia contro le soglie.
function verdict(run) {
  const failures = [];
  for (const task of run.longTasks) {
    if (task.durationMs > LONG_TASK_MS) failures.push(`un compito lungo di ${task.durationMs} ms, a ${task.startMs} ms dall'inizio della corsa`);
  }
  for (const step of run.steps) {
    if (!(step.latencyMs <= STEP_LIMIT_MS)) failures.push(`${step.label}: dipinto dopo ${step.latencyMs} ms, oltre i ${STEP_LIMIT_MS}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// La prova del banco.
// ---------------------------------------------------------------------------

/// Il banco prova sé stesso, dopo le corse: un Tab di troppo deve fargli
/// vedere la tavola sbagliata, e un tasto lento la soglia passata.
async function selfTest(page, boards) {
  const result = {};
  await page.focus(".draw-editor .draw-surface");
  await prepare(page, "Home");

  // Il Tab di troppo: si aspetta la seconda tavola, si arriva alla terza (o
  // fuori dal foglio, con due tavole).
  const wrong = newRun();
  wrong.last = await page.evaluate(() => window.__boardsProbe.read(0));
  await page.evaluate(() => window.__boardsProbe.begin());
  try {
    await step(page, wrong, "Tab", { kind: "shown", board: 1, label: `Tab verso «${boards[1].name}»` }, boards, 1);
    result.skip = { seen: false, message: "un Tab di troppo è passato per giusto" };
  } catch (error) {
    if (!(error instanceof WrongStep)) throw error;
    result.skip = { seen: true, message: error.message };
  }
  await page.evaluate(() => window.__boardsProbe.end());

  // Il tasto lento: la pagina resta occupata oltre la soglia e oltre un
  // compito lungo.
  await page.focus(".draw-editor .draw-surface");
  await prepare(page, "Home");
  const slow = newRun();
  slow.last = await page.evaluate(() => window.__boardsProbe.read(0));
  const planted = Math.max(STEP_LIMIT_MS, LONG_TASK_MS) + 30;
  await page.evaluate((ms) => window.__boardsProbe.plant(ms), planted);
  await page.evaluate(() => window.__boardsProbe.begin());
  try {
    await step(page, slow, "Tab", { kind: "shown", board: 1, label: `Tab lento verso «${boards[1].name}»` }, boards);
  } finally {
    await page.evaluate(() => window.__boardsProbe.plant(0));
  }
  const failures = verdict(await finish(page, slow));
  const latency = failures.some((failure) => failure.includes("dipinto dopo"));
  const long = failures.some((failure) => failure.startsWith("un compito lungo"));
  result.slow = { plantedMs: planted, seen: latency && long, failures };
  return result;
}

// ---------------------------------------------------------------------------
// Il disegno, la macchina, il referto.
// ---------------------------------------------------------------------------

/// Apre il disegno dall'albero e aspetta l'editor al livello Standard, con
/// tutte le tavole e tutti gli oggetti dipinti.
async function openDrawing(page, fixture) {
  const started = performance.now();
  await page.click(`#file-list .tree-row[data-path="${fixture.doc}"]`);
  await page.waitForSelector('.draw-editor .draw-tool[data-tool="board"]:not([hidden])', { timeout: OPEN_TIMEOUT_MS });
  await page.waitForFunction(
    ([boards, painted]) => {
      const host = document.querySelector(".draw-editor .draw-surface");
      return host !== null
        && host.querySelectorAll(".draw-sheets > .draw-page").length === boards
        && host.querySelectorAll("[data-scene-id]").length >= painted;
    },
    [fixture.boards.length, fixture.objects],
    { timeout: OPEN_TIMEOUT_MS, polling: 250 },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.focus(".draw-editor .draw-surface");
  return round(performance.now() - started);
}

function environment() {
  const cpus = os.cpus();
  return {
    node: { version: process.version, platform: process.platform, arch: process.arch, kernelRelease: os.release() },
    cpu: { model: cpus[0]?.model ?? null, logicalCount: cpus.length },
    memory: { totalBytes: os.totalmem() },
    browser: null,
    viewport: null,
  };
}

async function writeReport(report) {
  await mkdir(OUTPUT, { recursive: true });
  const { boards, cpu } = report.config;
  const path = join(OUTPUT, `boards-${boards}${cpu > 1 ? `-cpu${cpu}` : ""}.json`);
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

const ms = (value) => (value === null ? "—" : `${value} ms`);

async function main() {
  const started = Date.now();
  const config = args();
  const report = { config: { ...config, stepLimitMs: STEP_LIMIT_MS, longTaskMs: LONG_TASK_MS, tailMs: TAIL_MS }, environment: environment(), pass: false };
  const pageErrors = [];
  let stage;
  let primary;
  try {
    stage = await openStage();
    const page = await openPage(stage.browser, "dark", { clock: false });
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    await page.goto(`${stage.base}/?boards=${config.boards}`, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: 60_000 });
    const fixture = await page.evaluate(() => globalThis.__fubBoardsBench?.fixture ?? null);
    if (fixture === null) throw new Error("la pagina del banco non ha il disegno delle tavole: risponde un altro server?");
    if (fixture.boards.length !== config.boards) throw new Error(`il disegno ha ${fixture.boards.length} tavole invece di ${config.boards}`);
    report.fixture = { doc: fixture.doc, boards: fixture.boards.length, objects: fixture.objects, elements: fixture.elements, bytes: fixture.bytes, digest: fixture.digest };
    report.environment.browser = await stage.browser.version();
    report.environment.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }));

    report.openMs = await openDrawing(page, fixture);
    await installProbe(page);
    report.supported = await page.evaluate(() => window.__boardsProbe.supported);
    if (!report.supported.longtask) throw new Error("il browser non dà i compiti lunghi, e la soglia non si misura");
    report.view = await page.evaluate(() => window.__boardsProbe.read(0).area);
    // Il rallentamento vale per le corse e per la prova, non per l'apertura.
    if (config.cpu > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: config.cpu });
    }

    report.runs = {
      pages: await pageRun(page, fixture.boards),
      tabs: await tabRun(page, fixture.boards),
    };
    report.selfTest = await selfTest(page, fixture.boards);

    const failures = [];
    if (!report.selfTest.skip.seen) failures.push(`la prova del banco non vede la tavola sbagliata: ${report.selfTest.skip.message}`);
    if (!report.selfTest.slow.seen) failures.push(`la prova del banco non vede un tasto lento di ${report.selfTest.slow.plantedMs} ms`);
    report.gate = { applied: config.gated, failures: [] };
    if (config.gated) {
      for (const [name, run] of Object.entries(report.runs)) {
        for (const failure of verdict(run)) report.gate.failures.push(`${name === "pages" ? "Alt+Pag" : "Tab"}: ${failure}`);
      }
      failures.push(...report.gate.failures);
    }
    const slowed = config.cpu > 1 ? `, CPU rallentata ${config.cpu} volte` : "";
    console.log(`${config.boards} tavole, ${fixture.objects} oggetti${slowed}: aperto in ${ms(report.openMs)}`);
    for (const [name, run] of Object.entries(report.runs)) {
      console.log(`${name === "pages" ? "Alt+Pag" : "Tab    "}  ${run.steps.length} passi, dipinti in p50 ${ms(run.latencyMs.p50)}, p95 ${ms(run.latencyMs.p95)}, max ${ms(run.latencyMs.max)} (editor al più ${ms(run.handlerMs.max)}, fotogramma al più ${ms(run.renderMs.max)}); fotogrammi p50 ${ms(run.frames.p50)}, max ${ms(run.frames.max)}; compiti lunghi ${run.longTasks.length}`);
    }
    const { skip, slow } = report.selfTest;
    console.log(`prova: un Tab di troppo ${skip.seen ? "visto" : "NON visto"}, un tasto lento di ${slow.plantedMs} ms ${slow.seen ? "visto" : "NON visto"}${config.gated ? "" : `; soglie solo fino a ${GATED_BOARDS} tavole`}`);
    if (failures.length > 0) {
      const shown = failures.slice(0, SHOWN_FAILURES);
      const more = failures.length > shown.length ? `\n  e altre ${failures.length - shown.length}, nel referto` : "";
      const error = new Error(`${failures.length} cose fuori posto:\n  ${shown.join("\n  ")}${more}`);
      error.failures = failures;
      throw error;
    }
  } catch (error) {
    primary = error;
    report.failure = { name: error?.name, message: String(error?.message ?? error), ...(pageErrors.length ? { pageErrors } : {}) };
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
  console.error(`boards: ${error.message}`);
  process.exitCode = 1;
});
