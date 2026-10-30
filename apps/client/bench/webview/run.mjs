// I sei scenari di N0 nella WebView vera, guidati da WebDriver.
//
//   node bench/webview/run.mjs --app=../../target/release/fub [--only=S1,S2,S3]
//        [--driver=tauri-driver] [--native-driver=/usr/bin/WebKitWebDriver]
//        [--budgets=ci|targets] [--out=bench/.output/webview]
//
// Avvia `tauri-driver` con un vault e una configurazione scritti in una
// cartella temporanea (`fixtures.mjs`): la sonda è accesa dalle impostazioni
// di macchina di quella configurazione, e il vault vero di chi misura non si
// tocca. Ogni scenario è un'app avviata da capo. Il referto va in `--out`:
// un JSON per scenario e `referto.json` con macchina, sistema, WebView e
// commit, il formato di `docs/misure/`.
//
// Linux: `tauri-driver` + WebKitWebDriver (pacchetto `webkit2gtk-driver`).
// Windows: `tauri-driver` + msedgedriver della stessa versione di WebView2.
// macOS: nessun driver per WKWebView; la procedura a mano è in
// `docs/development/webview-measurements.md`.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, hostname, release, tmpdir, totalmem, type as osType } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSession, waitForDriver } from "./driver.mjs";
import { noteName, writeFixtures } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const app = resolve(args.app ?? join(here, "../../../../target/release/fub"));
const only = new Set((args.only ?? "S1,S2,S3,S4,S5,S6").split(","));
const out = resolve(args.out ?? join(here, "../.output/webview"));
const budgetsKind = args.budgets ?? "ci";
const port = Number(args.port ?? 4444);
const base = `http://127.0.0.1:${port}`;

const CTRL = "";
const ENTER = "";
const END = "";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/// Un accordo: il modificatore giù, il tasto, su tutti e due.
async function chord(session, modifier, key) {
  await session.actions([{ type: "key", id: "tastiera", actions: [
    { type: "keyDown", value: modifier }, { type: "keyDown", value: key },
    { type: "keyUp", value: key }, { type: "keyUp", value: modifier },
  ] }]);
}

/// La sonda accesa e la shell con un vault aperto.
async function ready(session) {
  await session.waitFor("return !!window.__fubProbe && !!document.querySelector('#file-list .tree-row')", [], 120_000);
}

// Ctrl+O apre il lanciatore dello Scrittoio; finché lo Scrittoio non l'ha
// montato, nei primi istanti dopo l'avvio, apre ancora il selettore comune.
// Lo scenario va bene con tutti e due.
const PICKER_INPUT = ".palette-input, .launcher-input";
const PICKER_FIRST = ".palette-list [role=option], .launcher-list [role=option]";

/// Apre un documento col selettore rapido (Ctrl+O), come chi lo cerca per
/// nome, e aspetta che il riquadro a fuoco dica `text`.
async function openByName(session, name, text, mark = null, timeoutMs = 60_000) {
  // L'app che ha appena riaperto la sessione può perdere il primo accordo:
  // si riprova, ma al più tre volte.
  for (let attempt = 1; ; attempt++) {
    await chord(session, CTRL, "o");
    try {
      await session.waitFor(`return document.activeElement?.matches(${JSON.stringify(PICKER_INPUT)}) === true`, [], timeoutMs / 3);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  await session.keys(name);
  // L'elenco deve avere il risultato prima di Invio: si aspetta la prima voce.
  await session.waitFor(`return (document.querySelector(${JSON.stringify(PICKER_FIRST)})?.textContent ?? '').includes(arguments[0])`, [name], timeoutMs);
  if (mark) {
    await session.execute("window.__fubWait = window.__fubProbe.waitFor(arguments[0], arguments[1], 15000, arguments[2]); return true;", [mark, ".pane.focus .cm-content", text]);
  }
  await session.keys(ENTER);
  if (mark) {
    const shown = await session.executeAsync("const done = arguments[arguments.length - 1]; window.__fubWait.then(done);");
    if (!shown) throw new Error(`«${name}» non si è vista entro 15 s`);
  } else {
    await session.waitFor("return (document.querySelector('.pane.focus')?.textContent ?? '').includes(arguments[0])", [text], 30_000);
  }
}

/// Un trascinamento lungo `ms`, a passi di un fotogramma, col pulsante e la
/// specie di puntatore dati.
function drag({ x, y, dx, dy, ms, button = 0, pointerType = "mouse", origin = "viewport" }) {
  const steps = Math.max(1, Math.round(ms / 16));
  const actions = [{ type: "pointerMove", x, y, duration: 0, origin }, { type: "pointerDown", button }];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Avanti e indietro: la scena torna dov'era e il gesto si può ripetere.
    const wave = Math.sin(t * Math.PI * 2);
    actions.push({ type: "pointerMove", x: Math.round(x + dx * wave), y: Math.round(y + dy * t), duration: 16, origin });
  }
  actions.push({ type: "pointerUp", button });
  return [{ type: "pointer", id: pointerType === "pen" ? "penna" : "mouse", parameters: { pointerType }, actions }];
}

async function centerOf(session, css) {
  return session.execute("const r = document.querySelector(arguments[0])?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;", [css]);
}

const stop = (session) => session.execute("return window.__fubProbe.stop();");
const start = (session) => session.execute("window.__fubProbe.start(); return true;");

const SCENARIOS = {
  /// Scrivere 200 caratteri in una nota di 5.000 righe.
  async S1(session) {
    await openByName(session, "Lunga", "Una nota lunga");
    await session.click(".pane.focus .cm-content");
    await chord(session, CTRL, END);
    await start(session);
    await session.keys("Il corso di analisi del lunedì, in aula. ".repeat(5).slice(0, 200));
    await pause(500);
    const report = await stop(session);
    return { report, values: { "S1.keyToPaint.p95": report.input.key.p95 }, samples: report.input.key.count };
  },
  /// Un vault di 10.000 note, venti passaggi da una nota all'altra.
  async S2(session) {
    await start(session);
    for (let i = 0; i < 20; i++) {
      // Lontane fra loro: il testo della nota prima non nomina quella dopo.
      const n = 1 + ((i * 487) % 10_000);
      await openByName(session, noteName(n), noteName(n), "noteSwitch");
    }
    const report = await stop(session);
    return { report, values: { "S2.noteSwitch.p95": report.marks.noteSwitch?.p95 ?? null }, samples: report.marks.noteSwitch?.count ?? 0 };
  },
  /// Spostare e ingrandire una lavagna di 300 schede, 20 note vive.
  async S3(session) {
    await openByName(session, "Lavagna", "Scheda 20");
    await session.waitFor("return document.querySelectorAll('.canvas-node').length > 0");
    const at = await centerOf(session, ".pane.focus .canvas-viewport");
    await start(session);
    // Il pulsante di mezzo sposta la lavagna, come il trackpad e la rotella.
    await session.actions(drag({ ...at, dx: 400, dy: 0, ms: 3_000, button: 1 }));
    await session.releaseActions();
    let zoomed = true;
    try {
      await session.actions([
        { type: "key", id: "tastiera", actions: [{ type: "keyDown", value: CTRL }, { type: "pause", duration: 0 }, ...Array(10).fill({ type: "pause", duration: 0 }), { type: "keyUp", value: CTRL }] },
        { type: "wheel", id: "rotella", actions: [{ type: "pause", duration: 0 }, ...Array.from({ length: 10 }, (_, i) => ({ type: "scroll", x: at.x, y: at.y, deltaX: 0, deltaY: i < 5 ? -120 : 120, duration: 100, origin: "viewport" })), { type: "pause", duration: 0 }] },
      ]);
    } catch {
      // Il driver senza rotella: resta lo spostamento, e il referto lo dice.
      zoomed = false;
    }
    await session.releaseActions();
    const report = await stop(session);
    return { report, zoomed, values: { "S3.frameGap.p95": report.frames.p95, "S3.frameGap.max": report.frames.max }, samples: report.frames.count };
  },
  /// Il grafo di 10.000 nodi, trascinato per tre secondi.
  async S4(session) {
    await session.click('#views-ribbon .rail-btn-main[data-panel="graph"]');
    await session.waitFor("return !!document.querySelector('canvas.graph-main')", [], 60_000);
    await pause(3_000);
    const at = await centerOf(session, "canvas.graph-main");
    await start(session);
    await session.actions(drag({ ...at, dx: 300, dy: 0, ms: 3_000 }));
    await session.releaseActions();
    const report = await stop(session);
    return { report, values: { "S4.frameGap.p95": report.frames.p95, "S4.frameGap.max": report.frames.max }, samples: report.frames.count };
  },
  /// Un tratto di penna di tre secondi sopra un disegno pesante.
  async S5(session) {
    await openByName(session, "Foglio", "");
    const drawing = await session.execute("return !!document.querySelector('.pane.focus .draw-editor .draw-surface');");
    if (!drawing) {
      // Senza la feature `draw` un `.svg` si apre come immagine: non c'è dove
      // scrivere. Il referto lo dice invece di inventare un numero.
      return { skipped: "nessuna superficie d'inchiostro: il disegno si apre come immagine (feature draw spenta)" };
    }
    await session.keys("p");
    const at = await centerOf(session, ".pane.focus .draw-editor .draw-surface");
    await start(session);
    await session.actions(drag({ x: at.x - 300, y: at.y - 100, dx: 200, dy: 200, ms: 3_000, pointerType: "pen" }));
    await session.releaseActions();
    const report = await stop(session);
    return { report, values: { "S5.penFrameGap.max": report.frames.max }, samples: report.input.pen.count };
  },
  /// Avvio a freddo fino alla prima nota visibile: l'app riapre la nota che
  /// S1 ha lasciato aperta.
  async S6(session) {
    await session.waitFor("return !!window.__fubProbe && window.__fubProbe.stop().coldStart !== null", [], 120_000);
    const report = await stop(session);
    return { report, values: { "S6.coldStart": report.coldStart }, sessionOpenedIn: Math.round(session.openedIn), samples: 1 };
  },
};

/// Ciò che si vedeva quando uno scenario è fallito: la finestra e il fuoco,
/// accanto al referto.
async function keep(session, id) {
  try {
    writeFileSync(join(out, `${id}-fallito.png`), await session.screenshot());
    const state = await session.execute("return { focus: document.activeElement?.className ?? null, title: document.title, palette: document.querySelector('.palette-list, .launcher-list')?.textContent?.slice(0, 400) ?? null, pane: document.querySelector('.pane.focus')?.textContent?.slice(0, 200) ?? null };");
    writeFileSync(join(out, `${id}-fallito.json`), JSON.stringify(state, null, 2) + "\n");
  } catch {
    // Una sessione già persa non ha niente da mostrare.
  }
}

function git(...command) {
  try {
    return execFileSync("git", command, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const budgets = JSON.parse(readFileSync(join(here, "budgets.json"), "utf8"));
  const limits = budgets[budgetsKind];
  if (!limits) throw new Error(`budgets.json non ha la sezione «${budgetsKind}»`);
  mkdirSync(out, { recursive: true });
  const root = mkdtempSync(join(tmpdir(), "fub-webview-"));
  const { vault, config } = writeFixtures(root);
  const driver = spawn(args.driver ?? "tauri-driver", [
    "--port", String(port),
    ...(args["native-driver"] ? ["--native-driver", args["native-driver"]] : []),
  ], { env: { ...process.env, FUB_VAULT: vault, FUB_CONFIG_DIR: config }, stdio: ["ignore", "inherit", "inherit"] });
  const results = {};
  let failed = 0;
  try {
    await waitForDriver(base);
    // Il primo avvio sul vault nuovo costruisce gli indici di diecimila note:
    // una sessione che non misura aspetta che la ricerca per nome risponda,
    // così gli scenari partono da un vault già indicizzato.
    const warm = await openSession(base, app);
    try {
      await ready(warm);
      await openByName(warm, "Lunga", "Una nota lunga", null, 300_000);
      console.log("· vault indicizzato");
    } catch (error) {
      await keep(warm, "riscaldamento");
      console.log(`✗ riscaldamento: ${String(error?.message ?? error)}`);
    } finally {
      await warm.close();
    }
    // S6 dopo S1: l'avvio da misurare riapre la nota che S1 ha lasciato.
    const order = ["S1", "S6", "S2", "S3", "S4", "S5"].filter((id) => only.has(id));
    for (const id of order) {
      const session = await openSession(base, app);
      try {
        if (id !== "S6") await ready(session);
        const result = await SCENARIOS[id](session);
        results[id] = result;
        writeFileSync(join(out, `${id}.json`), JSON.stringify(result, null, 2) + "\n");
        if (result.skipped) {
          console.log(`– ${id}: saltato, ${result.skipped}`);
          continue;
        }
        for (const [key, value] of Object.entries(result.values)) {
          const limit = limits[key];
          const over = limit !== undefined && (value === null || value > limit);
          if (over) failed++;
          console.log(`${over ? "✗" : "✓"} ${key} = ${value ?? "—"} ms${limit !== undefined ? ` (soglia ${limit})` : ""} · ${result.samples} campioni`);
        }
      } catch (error) {
        failed++;
        await keep(session, id);
        results[id] = { error: String(error?.message ?? error) };
        console.log(`✗ ${id}: ${results[id].error}`);
      } finally {
        await session.close();
      }
    }
  } finally {
    driver.kill();
    // WebKitWebDriver e i suoi processi possono scrivere nel vault ancora un
    // attimo dopo `kill`: la rimozione riprova invece di fermare il banco.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  const report = {
    commit: git("rev-parse", "HEAD"),
    machine: { host: hostname(), cpu: cpus()[0]?.model ?? null, cores: cpus().length, memoryGiB: Math.round(totalmem() / 2 ** 30) },
    system: { os: osType(), release: release(), session: process.env.XDG_SESSION_TYPE ?? (process.env.WAYLAND_DISPLAY ? "wayland" : process.env.DISPLAY ? "x11" : null) },
    webview: Object.values(results).find((r) => r.report?.userAgent)?.report.userAgent ?? null,
    budgets: budgetsKind,
    results,
  };
  writeFileSync(join(out, "referto.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Il referto: ${join(out, "referto.json")}`);
  if (failed > 0) {
    console.log(`${failed} misure oltre la soglia o scenari falliti`);
    process.exitCode = 1;
  }
}

await main();
