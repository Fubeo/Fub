// Gli scenari di N0, S7 di N13, la memoria (R1), le tessere (T1) e
// l'indicizzazione (I1) di K0, nella WebView vera, guidati da WebDriver.
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
import { settled } from "./memory.mjs";
import { INDEXING_SCRIPT } from "./indexing.mjs";
import { TILES_SCRIPT } from "./tiles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const app = resolve(args.app ?? join(here, "../../../../target/release/fub"));
const only = new Set((args.only ?? "S1,S2,S3,S4,S5,S6,S7,R1,T1,I1").split(","));
const out = resolve(args.out ?? join(here, "../.output/webview"));
const budgetsKind = args.budgets ?? "ci";
const port = Number(args.port ?? 4444);
const base = `http://127.0.0.1:${port}`;

const CTRL = "";
const ENTER = "";
const END = "";
const SHIFT = "";
const ALT = "";
const ESCAPE = "";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/// Il processo del driver: la memoria di R1 si legge sui suoi discendenti.
let driverPid = null;

/// Quanto si aspetta prima di leggere la memoria: che l'app abbia finito di
/// disegnare e di indicizzare ciò che ha appena aperto.
const MEMORY_QUIET_MS = 3_000;
/// R1: quanto si aspetta dopo aver chiuso tutto prima della prima lettura, e
/// quando si rilegge per vedere se la memoria torna col tempo.
const R1_SETTLE_MS = 10_000;
const R1_LATE_MS = 60_000;
/// I giri di apri tutto e chiudi tutto dopo la prima chiusura.
const R1_ROUNDS = 10;

/// Un file per modalità, nell'ordine in cui R1 li apre: il nome che si cerca
/// col selettore rapido e la modalità che il referto nomina.
const MODES = [
  ["Lunga", "nota"],
  ["Lavagna", "lavagna"],
  ["Foglio", "disegno"],
  ["Documento", "documento"],
  ["Tabella", "foglio di calcolo"],
  ["Stampa", "pdf"],
  ["Immagine", "immagine"],
];

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

/// L'indice dell'avvio arrivato in fondo. Ogni avvio sul vault del banco
/// indicizza le diecimila note da capo, e la shell risponde prima che abbia
/// finito: gli scenari misurano un vault pronto, non l'indicizzazione, tranne
/// I1 che misura proprio quella.
async function indexed(session, timeoutMs = 300_000) {
  const since = Date.now();
  for (;;) {
    const running = await session.executeAsync(`
      const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke("query_index", { query: { kind: "vault_status" }, vault: null })
        .then((status) => done(JSON.stringify(status).includes('"indexing":"running"')), (error) => done(String(error)));
    `);
    if (running === false) return;
    if (typeof running === "string") throw new Error(`vault_status: ${running}`);
    if (Date.now() - since > timeoutMs) throw new Error(`l'indice non è pronto dopo ${timeoutMs / 1000} s`);
    await pause(250);
  }
}

// Ctrl+O apre il lanciatore dello Scrittoio; finché lo Scrittoio non l'ha
// montato, nei primi istanti dopo l'avvio, apre ancora il selettore comune.
// Lo scenario va bene con tutti e due.
const PICKER_INPUT = ".palette-input, .launcher-input";
const PICKER_FIRST = ".palette-list [role=option], .launcher-list [role=option]";

/// Apre un documento col selettore rapido (Ctrl+O), come chi lo cerca per
/// nome, e aspetta che il riquadro a fuoco dica `text`.
async function openByName(session, name, text, mark = null, timeoutMs = 60_000) {
  // L'app che ha appena riaperto la sessione può perdere il primo accordo, o
  // riprendersi il fuoco a metà del nome quando la scheda riaperta finisce di
  // caricare: si riprova, ma al più tre volte.
  for (let attempt = 1; ; attempt++) {
    await chord(session, CTRL, "o");
    try {
      await session.waitFor(`return document.activeElement?.matches(${JSON.stringify(PICKER_INPUT)}) === true`, [], timeoutMs / 3);
      await session.keys(name);
      const typed = await session.execute(`const el = document.activeElement; return el?.matches(${JSON.stringify(PICKER_INPUT)}) ? el.value : null;`);
      if (typed !== name) throw new Error(`il selettore ha «${typed ?? "perso il fuoco"}» invece di «${name}»`);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await session.keys(ESCAPE);
      await pause(1000);
    }
  }
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

/// Un accordo di due modificatori e un tasto.
async function chord2(session, first, second, key) {
  await session.actions([{ type: "key", id: "tastiera", actions: [
    { type: "keyDown", value: first }, { type: "keyDown", value: second }, { type: "keyDown", value: key },
    { type: "keyUp", value: key }, { type: "keyUp", value: second }, { type: "keyUp", value: first },
  ] }]);
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

/// Chiude le schede una alla volta, come chi clicca le crocette, finché non
/// ne resta nessuna (al più cento giri). Torna quante ne restano.
async function closeAll(session) {
  let left = await session.execute("return document.querySelectorAll('.tab').length;");
  for (let i = 0; i < 100 && left > 0; i++) {
    left = await session.execute("const close = document.querySelector('.tab-close'); close?.click(); return document.querySelectorAll('.tab').length;");
    await pause(200);
  }
  return left;
}

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
  /// I Blocchi su una nota di 2.000 righe: un blocco trascinato su e giù per
  /// tre secondi e posato, poi dieci trasformazioni da paragrafo a titolo e
  /// ritorno (N13).
  async S7(session) {
    await openByName(session, "Blocchi", "Una nota a blocchi");
    await session.click(".pane.focus .cm-content");
    await chord2(session, CTRL, SHIFT, "b");
    await session.waitFor("return !!document.querySelector('.pane.focus .cm-fub-block-handles')", [], 30_000);
    // La maniglia compare sul blocco sotto il puntatore: la riga più vicina
    // al centro della finestra fra quelle che si vedono intere. CodeMirror
    // disegna anche righe fuori vista, e un puntatore mandato lì è «move
    // target out of bounds».
    const line = await session.execute("const mid = innerHeight / 2; const seen = [...document.querySelectorAll('.pane.focus .cm-content > .cm-line')].filter((l) => l.textContent.startsWith('Blocco')).map((l) => l.getBoundingClientRect()).filter((r) => r.top >= 0 && r.bottom <= innerHeight && r.left + 40 < innerWidth); seen.sort((a, b) => Math.abs(a.top - mid) - Math.abs(b.top - mid)); const r = seen[0]; return r ? { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) } : null;");
    if (!line) throw new Error("nessuna riga di blocco in vista");
    await session.actions([{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x: line.x, y: line.y, duration: 0, origin: "viewport" }] }]);
    // La maniglia sta sul blocco sotto il puntatore, o su quello del cursore
    // quando la WebView non manda il sorvolo di un puntatore che WebDriver
    // muove (la WebKitGTK del runner sotto Xvfb): va bene tutte e due, perché
    // il trascinamento parte dalla maniglia dove si vede.
    try {
      await session.waitFor("const h = document.querySelector('.pane.focus .cm-fub-block-handles'); return !!h && !h.hidden;", [], 10_000);
    } catch (error) {
      // Che cosa vedeva la pagina: senza, il referto dice soltanto che
      // l'attesa è scaduta.
      const seen = await session.execute("const h = document.querySelector('.pane.focus .cm-fub-block-handles'); const a = document.activeElement; return JSON.stringify({ handles: !!h, hidden: h?.hidden ?? null, active: h?.dataset.active ?? null, hover: matchMedia('(hover: hover)').matches, focus: a ? a.className || a.tagName : null });");
      throw new Error(`${error.message} — ${seen}`);
    }
    const grip = await centerOf(session, ".pane.focus .cm-fub-block-grip");
    const height = await session.execute("return innerHeight;");
    if (!grip || grip.y < 0 || grip.y > height) throw new Error(`la maniglia è fuori dalla finestra: ${JSON.stringify(grip)}`);
    // Su e giù di 160 px, o meno se la maniglia è vicina a un bordo.
    const swing = Math.max(0, Math.min(160, grip.y - 4, height - 4 - grip.y));
    await start(session);
    const steps = Math.round(3_000 / 16);
    const actions = [{ type: "pointerMove", x: grip.x, y: grip.y, duration: 0, origin: "viewport" }, { type: "pointerDown", button: 0 }];
    for (let i = 1; i <= steps; i++) {
      actions.push({ type: "pointerMove", x: grip.x, y: Math.round(grip.y + swing * Math.sin((i / steps) * Math.PI * 2)), duration: 16, origin: "viewport" });
    }
    actions.push({ type: "pointerUp", button: 0 });
    await session.actions([{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions }]);
    await session.releaseActions();
    await pause(500);
    // Il cursore su un paragrafo in vista, non su una riga vuota.
    const text = await session.execute("const l = [...document.querySelectorAll('.pane.focus .cm-content > .cm-line')].find((l) => { const r = l.getBoundingClientRect(); return / un paragrafo /.test(l.textContent) && r.top > 100 && r.bottom < innerHeight; }); const r = l?.getBoundingClientRect(); return r ? { x: Math.round(Math.min(r.right - 8, innerWidth - 8)), y: Math.round(r.top + r.height / 2) } : null;");
    if (!text) throw new Error("nessun paragrafo in vista");
    await session.actions([{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", x: text.x, y: text.y, duration: 0, origin: "viewport" }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
    ] }]);
    await session.releaseActions();
    for (let i = 0; i < 10; i++) {
      await chord2(session, CTRL, ALT, i % 2 === 0 ? "2" : "0");
      await pause(300);
    }
    const report = await stop(session);
    return { report, values: { "S7.frameGap.p95": report.frames.p95, "S7.frameGap.max": report.frames.max }, samples: report.frames.count };
  },
  /// La memoria (K0), con una procedura fissa:
  ///
  /// 1. **vuota**: l'app avviata, chiuse le schede che riapre, dopo
  ///    `R1_SETTLE_MS` di quiete;
  /// 2. **aperte**: un file per modalità, uno dopo l'altro, senza chiudere i
  ///    precedenti; una lettura dopo ognuno;
  /// 3. **chiuse**: chiuse tutte le schede, una lettura dopo `R1_SETTLE_MS` e
  ///    una dopo `R1_LATE_MS`, per vedere se la memoria torna col tempo;
  /// 4. **giri**: `R1_ROUNDS` volte tutti i file aperti e poi chiusi, una
  ///    lettura `R1_SETTLE_MS` dopo ogni chiusura, e alla fine una dopo
  ///    `R1_LATE_MS`.
  ///
  /// Ogni lettura è PSS in MiB, per processo: l'app (l'host Rust e la
  /// finestra), i processi della WebView, la rete, la GPU se c'è.
  /// Il **residuo** è quanto le schede chiuse tengono ancora: «chiuse», dopo
  /// l'attesa lunga, meno «vuota», per processo e in tutto.
  /// La **pendenza** dei giri è la retta dei minimi quadrati sui residui dei
  /// giri, in MiB per giro: vicina a zero se la memoria torna, positiva se
  /// ogni giro ne lascia un po'.
  async R1(session) {
    if (process.platform !== "linux") return { skipped: "la memoria si legge da /proc: soltanto Linux" };
    await pause(MEMORY_QUIET_MS);
    // L'app riapre la sessione di prima: si chiude prima di misurare, così
    // «vuota» non dipende da che cosa ha lasciato lo scenario precedente.
    const restored = await session.execute("return document.querySelectorAll('.tab').length;");
    await closeAll(session);
    await pause(R1_SETTLE_MS);
    const empty = await settled(driverPid, pause);
    const steps = [];
    for (const [name, mode] of MODES) {
      await openByName(session, name, "");
      await session.waitFor("return [...document.querySelectorAll('.pane.focus .tab[aria-selected=true] .tab-name')].some((el) => el.textContent.includes(arguments[0]))", [name], 60_000);
      await pause(MEMORY_QUIET_MS);
      // Che cosa si è aperto davvero: l'etichetta della scheda dice il formato.
      const surface = await session.execute("return document.querySelector('.pane.focus .tab[aria-selected=true]')?.getAttribute('aria-label') ?? null;");
      steps.push({ name, mode, surface, memory: await settled(driverPid, pause) });
    }
    const tabs = await session.execute("return document.querySelectorAll('.tab').length;");
    const left = await closeAll(session);
    const closedAt = Date.now();
    await pause(R1_SETTLE_MS);
    const closed = await settled(driverPid, pause);
    await pause(Math.max(0, R1_LATE_MS - (Date.now() - closedAt)));
    const late = await settled(driverPid, pause);
    const rounds = [];
    for (let round = 1; round <= R1_ROUNDS; round++) {
      for (const [name] of MODES) {
        await openByName(session, name, "");
        await session.waitFor("return [...document.querySelectorAll('.pane.focus .tab[aria-selected=true] .tab-name')].some((el) => el.textContent.includes(arguments[0]))", [name], 60_000);
      }
      await pause(MEMORY_QUIET_MS);
      const open = await settled(driverPid, pause);
      const remained = await closeAll(session);
      await pause(R1_SETTLE_MS);
      rounds.push({ round, open, left: remained, closed: await settled(driverPid, pause) });
    }
    await pause(R1_LATE_MS);
    const roundsLate = rounds.length > 0 ? await settled(driverPid, pause) : null;
    const opened = steps.at(-1)?.memory ?? null;
    const values = {};
    // Tutti i gruppi che la partenza o una lettura dopo hanno visto: la
    // partenza divisa per processo quanto il residuo.
    const groups = [...new Set([empty, opened, closed, late, ...rounds.map((r) => r.closed)].flatMap((mem) => Object.keys(mem?.groups ?? {})))].sort();
    const put = (key, mem) => {
      values[`R1.${key}.MiB`] = mem?.pss ?? null;
      for (const group of groups) values[`R1.${key}.${group}.MiB`] = mem?.groups[group]?.pss ?? null;
    };
    put("vuota", empty);
    put("aperte", opened);
    put("chiuse", closed);
    put("chiuse.tardi", late);
    const minus = (a, b) => (a === null || b === null ? null : Math.round((a - b) * 10) / 10);
    const residue = (mem, group) => minus(group ? mem?.groups[group]?.pss ?? null : mem?.pss ?? null, group ? empty?.groups[group]?.pss ?? null : empty?.pss ?? null);
    values["R1.residuo.MiB"] = residue(late);
    for (const group of groups) values[`R1.residuo.${group}.MiB`] = residue(late, group);
    // I residui dei giri, e la loro pendenza in MiB per giro.
    const slope = (ys) => {
      const points = ys.map((y, x) => [x + 1, y]).filter(([, y]) => y !== null);
      if (points.length < 2) return null;
      const mx = points.reduce((a, [x]) => a + x, 0) / points.length;
      const my = points.reduce((a, [, y]) => a + y, 0) / points.length;
      const num = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
      const den = points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
      return Math.round((num / den) * 100) / 100;
    };
    const trend = {};
    for (const group of [null, ...groups]) {
      const ys = rounds.map((r) => residue(r.closed, group));
      const key = group ? `R1.giri.${group}` : "R1.giri";
      trend[key] = ys;
      values[`${key}.primo.MiB`] = ys[0] ?? null;
      values[`${key}.ultimo.MiB`] = ys.at(-1) ?? null;
      values[`${key}.pendenza.MiB`] = slope(ys);
      values[`${key}.tardi.MiB`] = residue(roundsLate, group);
    }
    return {
      procedure: { settleMs: R1_SETTLE_MS, lateMs: R1_LATE_MS, quietMs: MEMORY_QUIET_MS, rounds: R1_ROUNDS },
      restored,
      empty,
      steps,
      tabs,
      left,
      closed,
      late,
      rounds,
      roundsLate,
      trend,
      values,
      samples: 3,
    };
  },
  /// Le tessere (K0, la prima via per la tela dei motori): i byte di un
  /// fotogramma letti a tessere dalla IPC e da `fub-asset:`, e disegnati su
  /// una tela di 2880 × 1800 (`tiles.mjs`).
  async T1(session) {
    const report = await session.executeAsync(TILES_SCRIPT, ["T1/Tessere.png", 60]);
    // Una strada che non va è un risultato, scritto nel referto: lo scenario
    // fallisce soltanto se non si misura niente.
    if (!report.ipcTile && !report.drawTile) throw new Error(Object.values(report.errors).join("; "));
    return {
      report,
      values: {
        "T1.ipc.tessera.p95": report.ipcTile?.p95 ?? null,
        "T1.ipc.ping.p95": report.ipcPing?.p95 ?? null,
        "T1.ipc.tessera.riposo.p95": report.ipcTileSettled?.p95 ?? null,
        "T1.ipc.ping.riposo.p95": report.ipcPingSettled?.p95 ?? null,
        "T1.asset.tessera.p95": report.assetTile?.p95 ?? null,
        "T1.asset.fotogramma.p50": report.assetFrame?.p50 ?? null,
        "T1.disegno.tessera.p95": report.drawTile?.put.p95 ?? null,
        "T1.disegno.fotogramma.p50": report.drawFrame?.put.p50 ?? null,
        "T1.frameGap.tessera.p95": report.drawTile?.frameGap.p95 ?? null,
        "T1.frameGap.fotogramma.p95": report.drawFrame?.frameGap.p95 ?? null,
      },
      samples: report.ipcTile?.count ?? report.drawTile?.put.count ?? 0,
    };
  },
  /// Il vault durante l'indicizzazione dell'avvio: una nota aperta e una
  /// tessera letta dopo l'altra, finché l'indice non è pronto
  /// (`indexing.mjs`).
  async I1(session) {
    const report = await session.executeAsync(INDEXING_SCRIPT, ["T1/Tessere.png", 90_000]);
    if (report.errors.run) throw new Error(report.errors.run);
    // Un avvio che trova l'indice già pronto non misura niente: lo dice, e
    // la soglia non passa con zero campioni.
    if (!report.indexingAtStart) throw new Error("l'indice era già pronto all'avvio");
    return {
      report,
      values: {
        "I1.nota.p95": report.open?.p95 ?? null,
        "I1.tessera.p95": report.tile?.p95 ?? null,
      },
      samples: report.open?.count ?? 0,
    };
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

/// Ferma `tauri-driver` e ciò che ha avviato, e aspetta che esca (al più 10 s).
async function stopDriver(driver) {
  const exited = new Promise((done) => {
    if (driver.exitCode !== null || driver.signalCode !== null) done();
    else driver.once("exit", done);
  });
  try {
    if (process.platform === "win32") driver.kill();
    else process.kill(-driver.pid, "SIGTERM");
  } catch {
    // Già uscito.
  }
  await Promise.race([exited, new Promise((done) => setTimeout(done, 10_000).unref())]);
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
  ], {
    env: { ...process.env, FUB_VAULT: vault, FUB_CONFIG_DIR: config },
    stdio: ["ignore", "inherit", "inherit"],
    // Un gruppo di processi suo: alla fine si ferma il driver con l'app e
    // WebKitWebDriver che ha avviato, non soltanto `tauri-driver`.
    detached: process.platform !== "win32",
  });
  driverPid = driver.pid;
  const results = {};
  let failed = 0;
  try {
    await waitForDriver(base);
    // Il primo avvio sul vault nuovo legge dal disco diecimila note: lo fa una
    // sessione che non misura, e aspetta che la ricerca per nome risponda. Gli
    // avvii dopo indicizzano di nuovo da capo, e ogni scenario aspetta che
    // l'indice sia pronto (`indexed`).
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
    // R1 subito dopo il riscaldamento: l'avvio riapre soltanto la nota del
    // riscaldamento, non le schede degli altri scenari. I1 subito dopo, con
    // poche schede da riaprire. S6 dopo S1: l'avvio da misurare riapre la
    // nota che S1 ha lasciato.
    const order = ["R1", "I1", "S1", "S6", "S2", "S3", "S4", "S5", "S7", "T1"].filter((id) => only.has(id));
    for (const id of order) {
      // Un'app che non parte è un risultato dello scenario, non la fine del
      // banco: gli altri scenari e il referto vanno avanti.
      let session;
      try {
        session = await openSession(base, app);
      } catch (error) {
        failed++;
        results[id] = { error: `l'app non è partita: ${String(error?.message ?? error)}` };
        console.log(`✗ ${id}: ${results[id].error}`);
        continue;
      }
      try {
        if (id !== "S6") await ready(session);
        // I1 misura proprio l'indicizzazione dell'avvio: non la aspetta.
        if (id !== "S6" && id !== "I1") await indexed(session);
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
          console.log(`${over ? "✗" : "✓"} ${key} = ${value ?? "—"} ${key.endsWith("MiB") ? "MiB" : "ms"}${limit !== undefined ? ` (soglia ${limit})` : ""} · ${result.samples} campioni`);
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
    await stopDriver(driver);
    // L'app che si chiude può scrivere nel vault ancora un attimo: la
    // rimozione riprova, e una cartella temporanea che resta non cancella le
    // misure già prese.
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      console.log(`· la cartella temporanea resta: ${root} (${error?.code ?? error})`);
    }
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
