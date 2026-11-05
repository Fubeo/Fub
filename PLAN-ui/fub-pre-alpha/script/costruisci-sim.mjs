// Costruisce il simulatore di Fub pre-alpha in <out>/:
//   simulatore.html     la pagina (CSS nuovo per file di destinazione, la vista)
//   sim-dati.js         le catture compresse (DOM e CSS del client vero del banco)
//   solo-simulatore.js  le interazioni finte (non vanno nel codice)
//   piani/*.html        le pagine approvate dei piani, tali e quali
// node costruisci-sim.mjs <out>
import { readFile, writeFile, readdir, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pulisciCss, pulisciBody, texts, metti, testoDi } from "./impacco.mjs";
import { STATI, PIANI } from "./stati-sim.mjs";
import { PEZZI } from "./pezzi-sim.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const [out] = process.argv.slice(2);
if (!out) throw new Error("uso: node costruisci-sim.mjs <out>");
await mkdir(join(out, "piani"), { recursive: true });
const proto = process.env.PROTO ?? "/tmp/claude-1000/-home-fubeo-Progetti-Fub/7517738d-8104-4cd8-859b-b8bd3771c70f/scratchpad/proto";
const fontsDir = join(process.env.HOME, ".cache/fub-prealpha/cattura-s2/apps/client/public/fonts");

// ── Le catture: la prima cartella che ha l'id vince ─────────────────────────
const CARTELLE = ["nuove6", "nuove5", "nuove2", "nuove4", "nuove3", "nuove", "s2", "avvio"];
const dove = new Map();
for (const c of CARTELLE) {
  for (const f of await readdir(join(root, "catture", c))) {
    const m = f.match(/^(.*)-(light|dark)\.json$/);
    if (m && !dove.has(`${m[1]}-${m[2]}`)) dove.set(`${m[1]}-${m[2]}`, join(root, "catture", c, f));
  }
}
// I pezzi che si aprono sopra uno stato vengono da catture loro.
const PEZZI_CATTURE = ["pz-menu-testo", "pz-menu-link", "pz-menu-albero", "pz-menu-cartella", "pz-menu-scheda"];
const ids = new Set([...STATI.flatMap((s) => [s.id, s.w700, s.tel].filter(Boolean)), ...PEZZI_CATTURE]);

// ── Il CSS nuovo (i blocchi di Scrittoio 2), per file di destinazione ────────
const VAR = /\/\*\s*variante ([\w-]+)\s*\*\/([\s\S]*?)\/\*\s*fine variante \1\s*\*\//g;
const blocchi = {};
for (const f of (await readdir(join(root, "blocchi"))).filter((f) => f.endsWith(".css")).sort()) {
  blocchi[f.replace(/\.css$/, "")] = await readFile(join(root, "blocchi", f), "utf8");
}
const corpo = (text) => text.replace(/^\/\* → [^*\n]*\*\/\n/, "");
const senzaVarianti = (text) => text.replace(VAR, "");
const DEST = [
  ["theme/scrittoio/structure.css", "struttura", ["00-structure", "70-kit-struttura", "70f-kit-fila-struttura"], "S2 T3, T4, T9, T16, T20, T21, T27"],
  ["theme/scrittoio/skin/kit.css", "pelle", ["71-kit", "72-kit-vassoio", "71f-kit-fila"], "S2 T16, T20"],
  ["theme/scrittoio/skin/frame.css", "pelle", ["10-frame"], "S2 T3, T4, T7, T9"],
  ["theme/scrittoio/skin/drawers.css", "pelle", ["20-drawers", "21-icone"], "S2 T8, T14"],
  ["theme/scrittoio/skin/tree.css", "pelle", ["30-tree"], "S2 T8"],
  ["theme/scrittoio/skin/sheets.css", "pelle", ["40-sheets"], "S2 T5, T6, T27"],
  ["theme/scrittoio/skin/document.css", "pelle", ["50-document"], "S2 T11, T12"],
  ["theme/scrittoio/skin/media.css", "pelle", ["85-media", "86-craft"], "S2 T18, T19"],
  ["theme/scrittoio/skin/nodes.css", "pelle", ["60-nodes", "61-nodes"], "S2 T9, T13"],
  ["theme/scrittoio/skin/graph.css", "pelle", ["81-graph"], "S2 T10"],
  ["theme/scrittoio/skin/menus.css", "pelle", ["65-menus"], "S2 T10"],
  ["theme/scrittoio/skin/launcher.css", "pelle", ["82-launcher"], "S2 T10"],
  ["theme/scrittoio/skin/centres.css", "pelle", ["45-centres"], "S2 T5"],
  ["theme/scrittoio/skin/settings.css", "pelle", ["80-settings"], "S2 T10"],
  ["theme/scrittoio/skin/welcome.css", "pelle", ["83-welcome"], "S2 T10"],
  ["shells/scrittoio/mobile/mobile.css", "telefono", ["90-mobile"], "S2 T3, T4, T5, T7, T11, T27"],
  ["theme/scrittoio/series.ts", "serie", ["01-series"], "S2 T11"],
  ["theme/scrittoio/recipe.ts", "serie", ["02-ruoli"], "S2 T16, T27"],
];
const usati = new Set(DEST.flatMap((d) => d[2]));
for (const k of Object.keys(blocchi)) if (!usati.has(k)) throw new Error(`blocco senza destinazione: ${k}`);
const destinazioni = DEST.map(([dest, posto, files, task]) => ({
  dest,
  posto,
  task,
  css: (blocchi[files[0]].startsWith(`/* → ${dest}:`) ? "" : `/* → ${dest} (${task}) */\n`) + files.map((f) => corpo(senzaVarianti(blocchi[f])).trim()).join("\n\n") + "\n",
}));

// ── I caratteri: tutti quelli che Aspetto può scegliere ─────────────────────
const fonts = [];
for (const f of (await readdir(fontsDir)).filter((f) => f.endsWith(".woff2")).sort()) {
  fonts.push([f.replace(/\.woff2$/, ""), (await readFile(join(fontsDir, f))).toString("base64")]);
}
const tutti = new Set(fonts.map(([n]) => n));
const pulisci = (css) =>
  css.replace(/@font-face\s*{[^}]*}/g, (rule) => {
    const m = /\/fonts\/([\w-]+)\.woff2/.exec(rule);
    return m && !tutti.has(m[1]) ? "" : rule;
  });
void pulisciCss;

// ── Le catture ──────────────────────────────────────────────────────────────
const caps = {};
const manca = [];
for (const id of ids) {
  for (const light of ["light", "dark"]) {
    const p = dove.get(`${id}-${light}`);
    if (!p) {
      manca.push(`${id}-${light}`);
      continue;
    }
    const j = JSON.parse(await readFile(p, "utf8"));
    caps[`${id}-${light}`] = {
      a: j.attrs,
      ba: j.bodyAttrs,
      b: metti(pulisciBody(j.body), "h", "body"),
      c: j.css.filter((s) => s.text.trim()).map((s) => [s.label, s.media, metti(pulisci(s.text), "c", s.label)]),
      v: j.viewport,
      t: j.title,
    };
  }
}
if (manca.length) throw new Error(`catture mancanti: ${manca.join(" ")}`);
for (let i = 0; i < texts.length; i += 1) testoDi(i);

// ── L'albero: che stato apre ogni file, dove si vede aperta ogni cartella ────
const fileStato = {};
const cartelle = {};
const PREFERITI = {
  "Benvenuto.md": "nota-riposo",
  "Guida/Live.md": "live-tabella",
  "Guida/Sintassi di Fub.md": "schede",
  "Disegni/logo-studio.vectorcraft": "craft",
  "Connettori.svg": "disegno",
  "Documenti/Oggetti.docx": "documento-oggetti",
  "Documenti/Prova.docx": "documento",
  "Documenti/Riservato.docx": "sola-lettura",
  "Dati/Conti.xlsx": "foglio",
  "Foto/IMG_0398.CR3": "foto",
  "Casa/Affitto di via Roma.md": "nota-pdf",
  "Casa/contratto-affitto.pdf": "pdf",
  "Progetti/Mappa del banco.canvas": "lavagna",
};
for (const [path, stato] of Object.entries(PREFERITI)) {
  if (!STATI.some((s) => s.id === stato)) throw new Error(`stato sconosciuto per ${path}: ${stato}`);
  fileStato[path] = stato;
}
for (const id of ids) {
  const body = testoDi(caps[`${id}-light`].b);
  for (const m of body.matchAll(/<li[^>]*data-path="([^"]+)"[^>]*aria-expanded="true"[^>]*>/g)) {
    if (!cartelle[m[1]]) cartelle[m[1]] = id;
  }
}

const dati = { fonts, texts, caps, fileStato, cartelle };
const blob = gzipSync(Buffer.from(JSON.stringify(dati)), { level: 9 }).toString("base64");
await writeFile(join(out, "sim-dati.js"), `// solo simulatore: le catture del client vero del banco, compresse (gzip, base64).\nwindow.SIM_DATI = "${blob}";\n`);
await copyFile(join(here, "solo-simulatore.js"), join(out, "solo-simulatore.js"));

// ── Le pagine dei piani ─────────────────────────────────────────────────────
for (const p of PIANI) {
  let html = await readFile(join(proto, p.file), "utf8");
  if (!/^\s*<!doctype/i.test(html)) {
    html = `<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${html}\n</head>\n<body></body>\n</html>\n`;
  }
  await writeFile(join(out, "piani", p.file), html);
}

// ── La pagina ───────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const noScriptEnd = (s) => s.replace(/<\/(script|style)/gi, "<\\/$1");
const gruppi = [...new Set(STATI.map((s) => s.g))];
const NOMI_GRUPPI = { Nota: "La nota", Editor: "Gli altri editor", Cornice: "Cassetti, finestre, impostazioni", Casi: "Casi", Telefono: "Telefono (Android di prova)" };
const opzioni = gruppi
  .map((g) => `      <optgroup label="${esc(NOMI_GRUPPI[g] ?? g)}">\n${STATI.filter((s) => s.g === g).map((s) => `        <option value="${s.id}">${esc(s.nome)}</option>`).join("\n")}\n      </optgroup>`)
  .join("\n");
const statiJs = JSON.stringify(STATI.map(({ g, id, nome, w700, tel, fuoco, dice, task }) => ({ g, id, nome, w700: w700 ?? null, tel: tel ?? null, fuoco, dice, task })));
const destCss = destinazioni.map((d) => `<style media="not all" data-destinazione="${d.dest}" data-posto="${d.posto}" data-task="${esc(d.task)}">\n${noScriptEnd(d.css)}</style>`).join("\n");
const destList = destinazioni.map((d) => `        <tr><td><code>${esc(d.dest)}</code></td><td>${esc(d.task)}</td><td>${Math.round(d.css.length / 102.4) / 10} KB</td></tr>`).join("\n");
const pianiList = PIANI.map((p) => `        <li><a href="piani/${p.file}">${esc(p.nome)}</a> <span class="sim-task">${esc(p.piano)} ${esc(p.task)}</span> <span class="sim-muto">${esc(p.ok)}</span></li>`).join("\n");

const html = `<!doctype html>
<html lang="it" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulatore pre-alpha</title>
<!--
  Il simulatore di Fub pre-alpha (piano/fub-pre-alpha, PLAN-ui/fub-pre-alpha/).
  Lo schermo è il client vero del banco (anteprima/tutto del 2026-11-04 con la
  IPC finta) fotografato stato per stato: DOM e CSS copiati, compressi in
  sim-dati.js e rimontati in un iframe senza script. Sopra il CSS copiato si
  monta il CSS nuovo di Scrittoio 2, un <style> per file di destinazione, nello
  stesso posto dove andrà nel codice. Le interazioni (clic, «/», tasto destro,
  avvio rapido, impostazioni) sono in solo-simulatore.js: fingono il prodotto e
  non vanno nel codice. Le pagine dei piani (lavagna, penne, celle, «Comandi»,
  disegno, ricette) sono in piani/, tali e quali come sono state approvate.
-->
<style>
/* solo simulatore: la pagina attorno allo schermo. */
:root {
  --bg: #e8edf5;
  --sheet: #fcfdff;
  --sheet-2: #f3f6f9;
  --bg-elev: #ffffff;
  --text: #1a1f29;
  --muted: #5a5f6a;
  --border: #d3d8e0;
  --accent: #2b56cc;
  --accent-wash: #d8e5ff;
  --focus-ring: #2b56cc;
  --ok: #1d7a46;
  --ok-wash: #dcf3e5;
  --warn: #8a5a00;
  --warn-wash: #fbefd6;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;
  --space-6: 16px;
  --space-8: 24px;
  --radius-chip: 6px;
  --radius-control: 8px;
  --radius-sheet: 12px;
  --font-ui: "Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0a0e16; --sheet: #151a21; --sheet-2: #1d222a; --bg-elev: #212730; --text: #e5e8ed; --muted: #a0a5ae; --border: #2c323c;
    --accent: #82a8fd; --accent-wash: #213156; --focus-ring: #82a8fd; --ok: #7fd3a0; --ok-wash: #173326; --warn: #f0c46a; --warn-wash: #3a2e12;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0a0e16; --sheet: #151a21; --sheet-2: #1d222a; --bg-elev: #212730; --text: #e5e8ed; --muted: #a0a5ae; --border: #2c323c;
  --accent: #82a8fd; --accent-wash: #213156; --focus-ring: #82a8fd; --ok: #7fd3a0; --ok-wash: #173326; --warn: #f0c46a; --warn-wash: #3a2e12;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.45 var(--font-ui); overflow-x: hidden; }
a { color: var(--accent); }
.sim-bar {
  position: sticky; top: 0; z-index: 3;
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4) var(--space-6);
  padding: var(--space-4) max(var(--space-6), env(safe-area-inset-right)) var(--space-4) max(var(--space-6), env(safe-area-inset-left));
  background: var(--sheet-2); border-bottom: 1px solid var(--border);
}
.sim-bar h1 { margin: 0 var(--space-4) 0 0; font-size: 15px; font-weight: 600; }
.sim-field { display: inline-flex; align-items: center; gap: var(--space-3); }
.sim-bar select, .sim-bar button {
  min-height: 32px; border: 1px solid var(--border); border-radius: var(--radius-control);
  background: var(--bg-elev); color: var(--text); font: inherit; padding: 0 var(--space-5);
}
.sim-bar select { max-width: min(100%, 22rem); }
.sim-seg { display: inline-flex; margin: 0; padding: 2px; border: 0; border-radius: var(--radius-control); background: var(--bg-elev); box-shadow: 0 0 0 1px var(--border); }
.sim-seg legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.sim-seg input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.sim-seg label { padding: var(--space-2) var(--space-5); border-radius: var(--radius-chip); color: var(--muted); cursor: pointer; }
.sim-seg input:checked + label { background: var(--accent-wash); color: var(--accent); }
.sim-seg input:disabled + label { opacity: 0.4; cursor: default; }
.sim-seg input:focus-visible + label, .sim-bar select:focus-visible, .sim-bar button:focus-visible, .sim-pezzi button:focus-visible {
  outline: 2px solid var(--focus-ring); outline-offset: 2px;
}
.sim-bar button[aria-pressed="true"] { background: var(--accent-wash); color: var(--accent); border-color: transparent; }
.sim-msg {
  min-height: 22px; margin: 0; padding: var(--space-2) max(var(--space-6), env(safe-area-inset-left));
  color: var(--warn); background: var(--warn-wash); font-size: 13px;
}
.sim-msg:empty { background: transparent; }
main { padding: var(--space-6) max(var(--space-6), env(safe-area-inset-right)) var(--space-8) max(var(--space-6), env(safe-area-inset-left)); max-width: 1340px; margin: 0 auto; }
.sim-box {
  position: relative; overflow: hidden; border-radius: var(--radius-sheet);
  box-shadow: 0 0 0 1px var(--border), 0 8px 24px rgb(0 0 0 / 0.12); background: var(--sheet); margin: 0 auto;
}
.sim-box iframe { display: block; border: 0; transform-origin: 0 0; background: var(--bg); }
.sim-segno { position: absolute; pointer-events: none; border: 2px solid var(--accent); border-radius: 4px; box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.18); }
.sim-segno[hidden] { display: none; }
.sim-didascalia { margin: var(--space-6) 0 var(--space-4); }
.sim-didascalia h2 { margin: 0 0 var(--space-3); font-size: 16px; }
.sim-didascalia p { margin: 0 0 var(--space-3); max-width: 75ch; }
.sim-task { display: inline-block; padding: 0 var(--space-3); border-radius: var(--radius-chip); background: var(--accent-wash); color: var(--accent); font-size: 12px; font-weight: 600; }
.sim-muto { color: var(--muted); font-size: 13px; }
.sim-come { display: inline-block; padding: 0 var(--space-3); border-radius: var(--radius-chip); font-size: 12px; font-weight: 600; }
.sim-come[data-come="nuovo"] { background: var(--accent-wash); color: var(--accent); }
.sim-come[data-come="cambiato"] { background: var(--warn-wash); color: var(--warn); }
.sim-come[data-come="uguale"] { background: var(--ok-wash); color: var(--ok); }
.sim-pezzi { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
.sim-pezzi li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2) var(--space-5); padding: var(--space-4) var(--space-5); border-radius: var(--radius-control); background: var(--sheet); box-shadow: 0 0 0 1px var(--border); }
.sim-pezzi .sim-dest { grid-column: 1 / -1; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.sim-pezzi button { border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-elev); color: var(--text); font: inherit; font-size: 13px; padding: 2px var(--space-4); }
.sim-pezzi pre { grid-column: 1 / -1; max-height: 260px; overflow: auto; margin: 0; padding: var(--space-4); border-radius: var(--radius-chip); background: var(--sheet-2); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
details { margin: var(--space-4) 0; padding: var(--space-4) var(--space-6); border-radius: var(--radius-control); background: var(--sheet-2); }
summary { cursor: pointer; font-weight: 600; }
details li { margin: var(--space-2) 0; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border); vertical-align: top; }
code { font-size: 12.5px; overflow-wrap: anywhere; }
.sim-tabella { overflow-x: auto; }
@media (max-width: 600px) {
  .sim-bar { gap: var(--space-3) var(--space-4); }
  .sim-bar h1 { width: 100%; }
}
</style>
<!-- Il CSS nuovo, un blocco per file di destinazione: spento qui (media="not all"), lo monta lo schermo. -->
${destCss}
<style id="sim-scala"></style>
<script src="sim-dati.js"></script>
<script src="solo-simulatore.js"></script>
</head>
<body>
<header class="sim-bar" aria-label="Comandi del simulatore">
  <h1>Fub pre-alpha · simulatore</h1>
  <span class="sim-field">
    <label for="sim-stato">Stato</label>
    <select id="sim-stato">
${opzioni}
    </select>
  </span>
  <fieldset class="sim-seg" id="sim-luce">
    <legend>Luce</legend>
    <input type="radio" name="luce" id="luce-giorno" value="light" checked><label for="luce-giorno">Giorno</label>
    <input type="radio" name="luce" id="luce-notte" value="dark"><label for="luce-notte">Notte</label>
  </fieldset>
  <fieldset class="sim-seg" id="sim-larghezza">
    <legend>Larghezza</legend>
    <input type="radio" name="larghezza" id="larghezza-piena" value="piena" checked><label for="larghezza-piena">Piena</label>
    <input type="radio" name="larghezza" id="larghezza-700" value="700"><label for="larghezza-700">700 px</label>
    <input type="radio" name="larghezza" id="larghezza-tel" value="tel"><label for="larghezza-tel">Telefono</label>
  </fieldset>
  <fieldset class="sim-seg" id="sim-moto">
    <legend>Movimento</legend>
    <input type="radio" name="moto" id="moto-pieno" value="pieno" checked><label for="moto-pieno">Pieno</label>
    <input type="radio" name="moto" id="moto-calmo" value="calmo"><label for="moto-calmo">Calmo</label>
    <input type="radio" name="moto" id="moto-ridotto" value="ridotto"><label for="moto-ridotto">Ridotto</label>
  </fieldset>
  <button type="button" id="sim-fuoco" aria-pressed="false">Fuoco sul controllo principale</button>
</header>
<p class="sim-msg" id="sim-msg" role="status" aria-live="polite"></p>
<main>
  <div class="sim-box" id="sim-box">
    <iframe id="sim-schermo" title="Lo schermo di Fub nello stato scelto" sandbox="allow-same-origin"></iframe>
    <div class="sim-segno" id="sim-segno" hidden></div>
  </div>
  <section class="sim-didascalia" aria-live="polite">
    <h2 id="sim-nome"></h2>
    <p id="sim-dice"></p>
    <p id="sim-vicino" hidden></p>
    <p>Task: <span id="sim-task"></span></p>
  </section>
  <details open>
    <summary>I pezzi di questo stato</summary>
    <p class="sim-muto">Ogni pezzo dice il file che lo costruisce, il task, e se il suo DOM è nuovo, cambiato o uguale a main. «Indica» lo segna nello schermo; «DOM» mostra quello da copiare.</p>
    <ul class="sim-pezzi" id="sim-pezzi"></ul>
  </details>
  <details>
    <summary>Che cosa si può fare nello schermo</summary>
    <ul>
      <li>Nell'albero: un file apre il suo editor, una cartella si apre e si chiude. Le linguette portano alla loro scheda.</li>
      <li>Nella nota si scrive davvero (non si salva). «/» apre il menu dei blocchi: frecce, Invio, Esc, e le lettere filtrano.</li>
      <li>Il tasto destro apre il menu del testo, dell'albero, di una cartella o di una linguetta.</li>
      <li>Ctrl+O, Ctrl+K o la pillola aprono l'avvio rapido; si scrive per filtrare, Esc chiude.</li>
      <li>La modalità nella banda apre il menu: Live, Blocchi, Sorgente, Lettura cambiano davvero la nota.</li>
      <li>«Salvato» nella testata apre il foglietto; la campanella apre gli avvisi; il binario porta a ricerca e grafo; la luna cambia luce.</li>
      <li>Impostazioni › Aspetto: Tema, Animazioni, corpo, interlinea, misura e carattere cambiano lo schermo, anche nelle altre schermate. Gli interruttori di «Componenti» si muovono.</li>
      <li>Tab e Maiuscolo+Tab girano per i controlli; Esc chiude ciò che è aperto.</li>
    </ul>
  </details>
  <details>
    <summary>Il CSS nuovo, per file di destinazione</summary>
    <div class="sim-tabella"><table>
      <thead><tr><th>File</th><th>Task</th><th>Peso</th></tr></thead>
      <tbody>
${destList}
      </tbody>
    </table></div>
    <p class="sim-muto">Il testo sta nei blocchi <code>&lt;style data-destinazione&gt;</code> in testa a questa pagina, già senza le varianti «com'era».</p>
  </details>
  <details>
    <summary>Le pagine dei piani</summary>
    <ul>
${pianiList}
    </ul>
  </details>
</main>
<script>
// solo simulatore: la vista. Monta una cattura nell'iframe col CSS nuovo dove
// andrà nel codice, poi passa il documento a solo-simulatore.js.
(() => {
  "use strict";
  const STATI = ${statiJs};
  const PEZZI = ${JSON.stringify(PEZZI)};
  const $ = (id) => document.getElementById(id);
  const frame = $("sim-schermo");
  const box = $("sim-box");
  let dati = null;
  const testi = [];
  const fontUrl = new Map();
  const scelto = { stato: "nota-riposo", luce: "light", larghezza: "piena", moto: "pieno", fuoco: false };
  const prefs = { body: 18, lineHeight: 1.65, measure: 58, font: "newsreader", theme: "light", motion: "" };
  const storia = [];
  const tok = (s, kind) => s.split(kind === "h" ? /(?<=>)/ : /(?<=})/);
  function testo(i) {
    if (testi[i] !== undefined) return testi[i];
    const t = dati.texts[i];
    if (typeof t === "string") return (testi[i] = t);
    const a = tok(testo(t.b), t.k);
    let out = "";
    let pos = 0;
    for (const [s, n, ins] of t.p) {
      out += a.slice(pos, s).join("") + ins;
      pos = s + n;
    }
    return (testi[i] = out + a.slice(pos).join(""));
  }
  const bytes = (b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
    return u;
  };
  async function carica() {
    const stream = new Blob([bytes(window.SIM_DATI)]).stream().pipeThrough(new DecompressionStream("gzip"));
    dati = JSON.parse(await new Response(stream).text());
    for (const [name, b] of dati.fonts) {
      const u = bytes(b);
      fontUrl.set(name, URL.createObjectURL(new Blob([u], { type: "font/woff2" })));
      if (name.startsWith("hanken")) {
        const face = new FontFace("Hanken Grotesk Variable", u.buffer, { weight: "100 900", style: name.endsWith("italic") ? "italic" : "normal" });
        document.fonts.add(face);
        face.load().catch(() => {});
      }
    }
  }
  const conFont = (css) => css.replace(/\\/fonts\\/([\\w-]+)\\.woff2/g, (m, n) => fontUrl.get(n) ?? m);
  const attr = (pairs) => pairs.map(([k, v]) => \` \${k}="\${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"\`).join("");
  const stile = (css, label) => \`<style data-proto="\${label}">\${css.replace(/<\\/style/gi, "<\\\\/style")}</style>\`;
  const blocco = (sel) => [...document.querySelectorAll(sel)].map((s) => s.textContent).join("\\n");
  const statoDi = (id) => STATI.find((x) => x.id === id);

  function capBase(s = statoDi(scelto.stato)) {
    if (s.g === "Telefono") return s.id;
    if (scelto.larghezza === "700" && s.w700) return s.w700;
    if (scelto.larghezza === "tel" && s.tel) return s.tel;
    return s.id;
  }
  const capId = () => \`\${capBase()}-\${scelto.luce}\`;
  // Le scelte di Aspetto, sopra tutto: le stesse variabili che scrive
  // theme/theme.ts (preferenceTokens), solo quando cambiano dal valore di serie.
  const PILE = {
    newsreader: '"Newsreader Variable", Georgia, "Times New Roman", serif',
    hanken: '"Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    literata: '"Literata Variable", Georgia, "Times New Roman", serif',
    inter: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  };
  function cssPrefs() {
    const r = [];
    if (prefs.body !== 18) r.push(\`--text-reading: \${prefs.body}px;\`);
    if (prefs.lineHeight !== 1.65) r.push(\`--leading-relaxed: \${prefs.lineHeight};\`);
    if (prefs.measure !== 58) r.push(\`--content-width: \${prefs.measure}ch;\`);
    if (prefs.font !== "newsreader") r.push(\`--font-reading: \${PILE[prefs.font] ?? PILE.newsreader};\`);
    return r.length ? \`:root { \${r.join(" ")} }\` : "";
  }
  function documento(cap) {
    const nuovo = { struttura: blocco('style[data-posto="struttura"]'), pelle: blocco('style[data-posto="pelle"]'), telefono: blocco('style[data-posto="telefono"]'), serie: blocco('style[data-posto="serie"]') };
    let head = '<meta charset="utf-8">';
    const messi = { struttura: false, pelle: false, telefono: false };
    for (const [label, media, i] of cap.c) {
      head += stile(conFont(testo(i)), label).replace("<style", media ? \`<style media="\${media}"\` : "<style");
      if (label === "src/theme/scrittoio/structure.css") (head += stile(nuovo.struttura, "nuovo:struttura")), (messi.struttura = true);
      if (label === "fub:pelle") (head += stile(nuovo.pelle, "nuovo:pelle")), (messi.pelle = true);
      if (label === "src/shells/scrittoio/mobile/mobile.css") (head += stile(nuovo.telefono, "nuovo:telefono")), (messi.telefono = true);
    }
    if (!messi.struttura) head += stile(nuovo.struttura, "nuovo:struttura");
    if (!messi.pelle) head += stile(nuovo.pelle, "nuovo:pelle");
    if (!messi.telefono) head += stile(nuovo.telefono, "nuovo:telefono");
    head += stile(nuovo.serie, "nuovo:serie");
    head += stile(cssPrefs(), "solo-simulatore:aspetto");
    head += stile(window.SIM_INTERAZIONI?.css ?? "", "solo-simulatore");
    const attrs = cap.a.filter(([k]) => k !== "data-motion");
    if (scelto.moto === "calmo") attrs.push(["data-motion", "calm"]);
    if (scelto.moto === "ridotto") attrs.push(["data-motion", "reduced"]);
    return \`<!doctype html><html\${attr(attrs)}><head>\${head}<title>\${cap.t.replace(/</g, "&lt;")}</title></head><body\${attr(cap.ba)}>\${testo(cap.b)}</body></html>\`;
  }
  const MISURE = ["display", "position", "top", "right", "bottom", "left", "width", "height", "min-height", "margin", "border-radius", "box-shadow", "background-color", "z-index", "pointer-events"];
  function ripristina(doc, dentro = doc) {
    for (const el of dentro.querySelectorAll("[data-proto-style]")) el.setAttribute("style", el.getAttribute("data-proto-style"));
    if (dentro.nodeType === 1 && dentro.hasAttribute("data-proto-style")) dentro.setAttribute("style", dentro.getAttribute("data-proto-style"));
    if (dentro === doc) {
      const r = doc.documentElement;
      if (r.hasAttribute("data-proto-style")) r.setAttribute("style", r.getAttribute("data-proto-style"));
    }
    const tele = [...dentro.querySelectorAll("canvas[data-proto-src]")].map((c) => {
      const cs = doc.defaultView.getComputedStyle(c);
      const img = doc.createElement("img");
      for (const a of c.attributes) if (!["data-proto-src", "width", "height", "style"].includes(a.name)) img.setAttribute(a.name, a.value);
      if (!img.hasAttribute("aria-label")) img.alt = "";
      img.setAttribute("style", MISURE.map((k) => \`\${k}: \${cs.getPropertyValue(k)}\`).join("; "));
      img.src = c.getAttribute("data-proto-src");
      c.replaceWith(img);
      return img.decode().catch(() => {});
    });
    scorri(dentro);
    return Promise.all(tele);
  }
  function segni(doc) {
    for (const ind of doc.querySelectorAll(".kit-tab-indicator:not([hidden])")) {
      const fila = ind.parentElement;
      const scelta = fila.querySelector(':scope > .kit-tab[aria-selected="true"]');
      if (!scelta) continue;
      if (fila.getAttribute("aria-orientation") === "vertical") {
        ind.style.top = \`\${scelta.offsetTop}px\`;
        ind.style.height = \`\${scelta.offsetHeight}px\`;
      } else {
        ind.style.left = \`\${scelta.offsetLeft}px\`;
        ind.style.width = \`\${scelta.offsetWidth}px\`;
      }
    }
  }
  function scorri(dentro) {
    for (const el of dentro.querySelectorAll("[data-proto-scroll]")) {
      const [x, y] = el.getAttribute("data-proto-scroll").split(",").map(Number);
      el.scrollLeft = x;
      el.scrollTop = y;
    }
  }
  const visibile = (el) => !el.disabled && (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0);
  function metti_fuoco(doc) {
    if (!scelto.fuoco) return;
    const s = statoDi(scelto.stato);
    const el = [...doc.querySelectorAll(s.fuoco)].find(visibile) ?? doc.querySelector("[data-proto-focus]");
    el?.focus({ preventScroll: true, focusVisible: true });
  }
  let scalaOra = 1;
  function scala() {
    const cap = dati.caps[capId()];
    const main = box.parentElement;
    const cs = getComputedStyle(main);
    const avail = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    scalaOra = Math.min(1, avail / cap.v.w);
    frame.width = String(cap.v.w);
    frame.height = String(cap.v.h);
    $("sim-scala").textContent = \`#sim-schermo { transform: scale(\${scalaOra}); } #sim-box { width: \${Math.round(cap.v.w * scalaOra)}px; height: \${Math.round(cap.v.h * scalaOra)}px; }\`;
  }
  // I documenti delle catture, per prenderne i pezzi.
  const parsati = new Map();
  function catturaDoc(base, luce = scelto.luce) {
    const key = \`\${base}-\${luce}\`;
    if (!parsati.has(key)) {
      const cap = dati.caps[key];
      if (!cap) return null;
      parsati.set(key, new DOMParser().parseFromString(\`<!doctype html><html><body>\${testo(cap.b)}</body></html>\`, "text/html"));
    }
    return parsati.get(key);
  }
  function pezzo(doc, base, sel) {
    const src = catturaDoc(base);
    const el = src?.querySelector(sel);
    if (!el) return null;
    const cap = dati.caps[\`\${base}-\${scelto.luce}\`];
    const hanno = new Set([...doc.querySelectorAll("style[data-proto]")].map((s) => s.getAttribute("data-proto")));
    const prima = doc.querySelector('style[data-proto="nuovo:serie"]');
    for (const [label, media, i] of cap.c) {
      if (!label || hanno.has(label)) continue;
      const s = doc.createElement("style");
      s.setAttribute("data-proto", label);
      if (media) s.media = media;
      s.textContent = conFont(testo(i));
      prima.before(s);
    }
    const clone = doc.importNode(el, true);
    ripristina(doc, clone);
    return clone;
  }
  let msgTimer = 0;
  function avviso(t) {
    $("sim-msg").textContent = t;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => ($("sim-msg").textContent = ""), 6000);
  }
  function aggiornaPezzi(doc) {
    const ul = $("sim-pezzi");
    ul.replaceChildren();
    for (const p of PEZZI) {
      const el = [...doc.querySelectorAll(p.sel)].find(visibile);
      if (!el) continue;
      const li = document.createElement("li");
      const nome = document.createElement("span");
      nome.innerHTML = \`<b></b> <span class="sim-come" data-come="\${p.come}">\${p.come}</span> <span class="sim-task"></span>\`;
      nome.querySelector("b").textContent = p.nome;
      nome.querySelector(".sim-task").textContent = p.task;
      const azioni = document.createElement("span");
      const indica = document.createElement("button");
      indica.type = "button";
      indica.textContent = "Indica";
      indica.addEventListener("click", () => segna(el));
      const mostraDom = document.createElement("button");
      mostraDom.type = "button";
      mostraDom.textContent = "DOM";
      mostraDom.setAttribute("aria-expanded", "false");
      azioni.append(indica, " ", mostraDom);
      const dest = document.createElement("span");
      dest.className = "sim-dest";
      dest.textContent = \`\${p.dest} · \${p.sel}\`;
      const pre = document.createElement("pre");
      pre.hidden = true;
      mostraDom.addEventListener("click", () => {
        pre.hidden = !pre.hidden;
        mostraDom.setAttribute("aria-expanded", String(!pre.hidden));
        if (!pre.hidden) pre.textContent = pulito(el);
      });
      li.append(nome, azioni, dest, pre);
      ul.append(li);
    }
  }
  // Il DOM da copiare: senza gli attributi del banco e senza le figure in linea.
  function pulito(el) {
    const c = el.cloneNode(true);
    for (const n of [c, ...c.querySelectorAll("*")]) {
      for (const a of [...n.attributes]) if (a.name.startsWith("data-proto")) n.removeAttribute(a.name);
    }
    return c.outerHTML.replace(/<svg[\\s\\S]*?<\\/svg>/g, "<svg>…</svg>").replace(/></g, ">\\n<");
  }
  function segna(el) {
    const r = el.getBoundingClientRect();
    const s = $("sim-segno");
    s.style.left = \`\${r.left * scalaOra - 3}px\`;
    s.style.top = \`\${r.top * scalaOra - 3}px\`;
    s.style.width = \`\${r.width * scalaOra + 6}px\`;
    s.style.height = \`\${r.height * scalaOra + 6}px\`;
    s.hidden = false;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => (s.hidden = true), 2200);
  }
  const api = {
    get scelto() { return scelto; },
    prefs,
    dati: () => dati,
    statoDi,
    capBase,
    vai(id, { storia: tieni = true } = {}) {
      if (!statoDi(id)) return;
      if (tieni && id !== scelto.stato) storia.push(scelto.stato);
      scelto.stato = id;
      $("sim-stato").value = id;
      mostra();
    },
    indietro() { api.vai(storia.pop() ?? "nota-riposo", { storia: false }); },
    luce(l) { scelto.luce = l; prefs.theme = l; $(l === "dark" ? "luce-notte" : "luce-giorno").checked = true; mostra(); },
    moto(m) { scelto.moto = m; $(\`moto-\${m}\`).checked = true; mostra(); },
    ridisegna: () => mostra(),
    pezzo,
    catturaDoc,
    avviso,
  };
  // Gli stati il cui telefono è proprio quello (non solo il più vicino).
  const TEL_PROPRI = new Set(["nota-riposo", "documento", "foglio", "palette-file", "vuoto", "avvio-attesa"]);
  function mostra() {
    if (!dati) return;
    const s = statoDi(scelto.stato);
    const tel = s.g === "Telefono";
    $("larghezza-piena").disabled = tel;
    $("larghezza-700").disabled = tel || !s.w700;
    $("larghezza-tel").disabled = !tel && !s.tel;
    if (tel) $("larghezza-tel").checked = true;
    else if ((scelto.larghezza === "700" && !s.w700) || (scelto.larghezza === "tel" && !s.tel)) $("larghezza-piena").checked = true;
    if (!tel) scelto.larghezza = document.querySelector('input[name="larghezza"]:checked').value;
    document.documentElement.setAttribute("data-theme", scelto.luce);
    const cap = dati.caps[capId()];
    delete box.dataset.pronto;
    $("sim-segno").hidden = true;
    scala();
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      Promise.all([ripristina(doc), doc.fonts.ready]).then(() => {
        segni(doc);
        scorri(doc);
        window.SIM_INTERAZIONI?.aggancia(doc, api);
        requestAnimationFrame(() => {
          metti_fuoco(doc);
          aggiornaPezzi(doc);
          box.dataset.pronto = capId();
        });
      });
    };
    frame.srcdoc = documento(cap);
    $("sim-nome").textContent = s.nome;
    $("sim-dice").textContent = s.dice;
    // Al telefono molti stati non hanno una foto loro: si vede il più vicino.
    const vicino = !tel && scelto.larghezza === "tel" && !TEL_PROPRI.has(s.id) ? statoDi(s.tel) : null;
    $("sim-vicino").hidden = !vicino;
    if (vicino) $("sim-vicino").textContent = \`Al telefono questo stato non ha una foto sua: si vede «\${vicino.nome}», il più vicino. Il telefono di Scrittoio 2 è provvisorio (le scelte A) e si rifà in un piano futuro: vedi le domande.\`;
    $("sim-task").textContent = s.task.join(", ");
    const q = new URLSearchParams({ stato: scelto.stato, luce: scelto.luce, larghezza: scelto.larghezza, moto: scelto.moto });
    try { history.replaceState(null, "", \`#\${q}\`); } catch {}
  }
  $("sim-stato").addEventListener("change", (e) => api.vai(e.target.value));
  for (const r of document.querySelectorAll('input[name="luce"]')) r.addEventListener("change", (e) => api.luce(e.target.value));
  for (const r of document.querySelectorAll('input[name="larghezza"]')) r.addEventListener("change", (e) => ((scelto.larghezza = e.target.value), mostra()));
  for (const r of document.querySelectorAll('input[name="moto"]')) r.addEventListener("change", (e) => api.moto(e.target.value));
  $("sim-fuoco").addEventListener("click", (e) => {
    scelto.fuoco = !scelto.fuoco;
    e.currentTarget.setAttribute("aria-pressed", String(scelto.fuoco));
    const doc = frame.contentDocument;
    if (doc && scelto.fuoco) metti_fuoco(doc);
    else if (doc) doc.activeElement?.blur?.();
  });
  addEventListener("resize", () => dati && scala());
  // Lo stato si legge dall'indirizzo (#stato=…&luce=…&larghezza=…&moto=…),
  // anche quando cambia: la pagina principale ci porta con un link.
  function leggi() {
    const q = new URLSearchParams(location.hash.slice(1) || location.search);
    if (q.get("stato") && statoDi(q.get("stato"))) scelto.stato = q.get("stato");
    scelto.luce = q.get("luce") === "dark" ? "dark" : q.has("luce") ? "light" : scelto.luce;
    if (["piena", "700", "tel"].includes(q.get("larghezza"))) scelto.larghezza = q.get("larghezza");
    if (["pieno", "calmo", "ridotto"].includes(q.get("moto"))) scelto.moto = q.get("moto");
    $("sim-stato").value = scelto.stato;
    $(scelto.luce === "dark" ? "luce-notte" : "luce-giorno").checked = true;
    $(\`larghezza-\${scelto.larghezza}\`).checked = true;
    $(\`moto-\${scelto.moto}\`).checked = true;
  }
  leggi();
  addEventListener("hashchange", () => (leggi(), mostra()));
  carica().then(mostra);
})();
</script>
</body>
</html>
`;
await writeFile(join(out, "simulatore.html"), html);
console.log(
  "scritto", out,
  "pagina", Math.round(html.length / 1024), "KB; dati", Math.round(blob.length / 1024), "KB; catture", Object.keys(caps).length,
  "; testi", texts.length, "di cui toppe", texts.filter((t) => typeof t !== "string").length,
  "; cartelle", JSON.stringify(cartelle),
);
void existsSync;
