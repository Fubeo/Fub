// Il banco della prova del motore del PDF (ADR 0247, strada A).
//
// 1. `pdf-prova.html` rende la nota di prova con la Lettura e la misura
//    (`src/export/probe.ts`): l'elenco delle pagine, i tagli, le lettere.
// 2. Il banco fotografa la vista pagina per pagina (lo spazio fra i margini,
//    da un taglio al successivo), a due pixel per pixel CSS.
// 3. Scrive `elenco.json` e `risorse.json` e chiama l'esempio `pdf_prova` di
//    `fub-features` (in release): il core scrive il PDF, `hayro` lo ridisegna
//    alla stessa scala, `lopdf` ne estrae il testo.
// 4. Confronta: ogni pagina del PDF con la foto della vista (pixelmatch), il
//    testo del PDF con le lettere che la vista ha misurato e con il testo
//    della nota resa.
// 5. Rifà tutto con una differenza messa apposta (`?variant=spostato`: il
//    testo un pixel più a destra), per dimostrare che il confronto la vede.
//
// Uso (è un banco: passa dalla coda dei controlli pesanti):
//   node bench/pdf-prova.mjs [--port=1523] [--out=<cartella>]
// Le immagini e i numeri restano in `bench/.output/pdf-prova/` (o `--out`).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { openStage, OUTPUT } from "./stage.mjs";

/// Quanto la pagina del PDF può differire dalla foto della vista: le lettere
/// sono le stesse e allo stesso posto, ma due rasterizzatori diversi (Skia e
/// `hayro`) non sfumano i bordi allo stesso modo.
const THRESHOLD = 0.1;
const LIMIT = 0.01;
/// Sotto questa soglia la differenza messa apposta non si vedrebbe: il banco
/// sarebbe cieco.
const PLANTED_MIN = 0.01;
/// Due pixel per pixel CSS, come le foto del banco.
const SCALE = 2;
const PAGE = { width: 794, height: 1123, margin: 72 };
const CONTENT_HEIGHT = PAGE.height - 2 * PAGE.margin;

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const client = here("..");
const repo = here("../../..");
const out = resolve(args.out ?? join(OUTPUT, "pdf-prova"));
const port = args.port === undefined ? undefined : Number(args.port);

/// Il file di un carattere come la pagina lo ha chiesto (il percorso
/// dell'URL), sul disco.
function fontPath(urlPath) {
  const path = decodeURIComponent(urlPath);
  if (path.startsWith("/@fs/")) return path.slice("/@fs".length);
  for (const root of [join(client, "public"), client]) {
    const candidate = join(root, path);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function crop(png, x, y, width, height) {
  const outPng = new PNG({ width, height, fill: true });
  outPng.data.fill(255);
  for (let row = 0; row < height; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= png.height) continue;
    for (let col = 0; col < width; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= png.width) continue;
      png.data.copy(outPng.data, (row * width + col) * 4, (sy * png.width + sx) * 4, (sy * png.width + sx) * 4 + 4);
    }
  }
  return outPng;
}

/// Il testo senza spazi e senza i trattini morbidi: il confronto delle
/// lettere, non della loro disposizione.
const letters = (text) => text.replace(/[\s­​]+/gu, "");

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i === a.length && i === b.length ? null : { at: i, a: a.slice(Math.max(0, i - 20), i + 20), b: b.slice(Math.max(0, i - 20), i + 20) };
}

async function round(page, base, variant) {
  const dir = join(out, variant ?? "nota");
  await mkdir(dir, { recursive: true });
  await page.goto(`${base}/bench/pdf-prova.html?photo=senza${variant ? `&variant=${variant}` : ""}`);
  await page.waitForFunction(() => document.documentElement.dataset.prova !== undefined, null, { timeout: 90_000 });
  const [state, error] = await page.evaluate(() => [document.documentElement.dataset.prova, document.documentElement.dataset.error]);
  if (state !== "ready") throw new Error(`la pagina della prova non è pronta: ${error}`);
  const prova = await page.evaluate(() => window.__prova);

  // Le foto della vista: da un taglio al successivo, larghe quanto la nota.
  const height = await page.evaluate(() => document.getElementById("nota").getBoundingClientRect().height);
  const shots = [];
  for (let k = 0; k < prova.tagli.length; k++) {
    const top = prova.tagli[k];
    const bottom = Math.min(prova.tagli[k + 1] ?? height, top + CONTENT_HEIGHT, height);
    const clip = { x: prova.inizio.x, y: prova.inizio.y + top, width: PAGE.width - 2 * PAGE.margin, height: Math.max(1, bottom - top) };
    shots.push(PNG.sync.read(await page.screenshot({ clip, fullPage: true })));
  }

  // Le risorse: i caratteri dai loro file, le immagini dai byte della pagina.
  const caratteri = {};
  for (const face of prova.elenco.facce) {
    if (!face.file) continue;
    const path = fontPath(face.file);
    if (path) caratteri[face.file] = path;
  }
  const immagini = {};
  let n = 0;
  for (const [file, data] of Object.entries(prova.immagini)) {
    const path = join(dir, `immagine-${++n}`);
    await writeFile(path, Buffer.from(data, "base64"));
    immagini[file] = path;
  }
  await writeFile(join(dir, "elenco.json"), JSON.stringify(prova.elenco));
  await writeFile(join(dir, "risorse.json"), JSON.stringify({ caratteri, immagini }, null, 2));

  const core = spawnSync(
    "cargo",
    ["run", "--quiet", "--locked", "-p", "fub-features", "--features", "draw", "--release", "--example", "pdf_prova", "--", dir, String(SCALE)],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (core.status !== 0) throw new Error(`l'esempio pdf_prova è uscito con ${core.status}`);
  const misure = JSON.parse(await readFile(join(dir, "misure.json"), "utf8"));
  const testi = JSON.parse(await readFile(join(dir, "testo-pdf.json"), "utf8"));

  const pagine = [];
  for (let k = 0; k < shots.length; k++) {
    const view = shots[k];
    const pdf = PNG.sync.read(await readFile(join(dir, `pdf-${k + 1}.png`)));
    const part = crop(pdf, PAGE.margin * SCALE, PAGE.margin * SCALE, view.width, view.height);
    const diff = new PNG({ width: view.width, height: view.height });
    const count = pixelmatch(view.data, part.data, diff.data, view.width, view.height, { threshold: THRESHOLD });
    await writeFile(join(dir, `vista-${k + 1}.png`), PNG.sync.write(view));
    await writeFile(join(dir, `diff-${k + 1}.png`), PNG.sync.write(diff));
    pagine.push(count / (view.width * view.height));
  }
  const pdfText = letters(testi.join(""));
  return {
    prova,
    misure,
    pagine,
    pdfPages: misure.pagine,
    textProbe: firstDifference(pdfText, letters(prova.lettere)),
    textView: firstDifference(pdfText, letters(prova.testoVista)),
  };
}

const share = (value) => `${(value * 100).toFixed(3)}%`;
// Un giro solo, senza ricaricare: il server non guarda i file. Così il banco
// non consuma gli osservatori di inotify della macchina, che altri server di
// Vite possono avere esaurito (ENOSPC): `watch: false` di `openStage`.
const { base, browser, close } = await openStage({
  watch: false,
  ...(port === undefined ? {} : { port }),
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: SCALE });
  const nota = await round(page, base, null);
  const m = nota.prova.misure;
  const maxPage = Math.max(...m.jsonBytePagina);
  console.log(`vista: ${m.pezzi} pezzi, ${m.lettere} lettere, ${nota.prova.elenco.facce.length} facce, ${nota.prova.elenco.pagine.length} pagine`);
  console.log(`vista: misura ${m.misuraMs.toFixed(1)} ms, impagina e JSON ${m.impaginaMs.toFixed(1)} ms`);
  console.log(`JSON: ${m.jsonByte} byte in tutto, al più ${maxPage} byte per pagina (limite dei comandi della griglia: 65536)`);
  console.log(`core: lettura del JSON ${nota.misure.lettura_json_ms.toFixed(1)} ms, scrittura del PDF ${nota.misure.scrittura_pdf_ms.toFixed(1)} ms, PDF di ${nota.misure.pdf_byte} byte; avvisi: ${JSON.stringify(nota.misure.avvisi)}`);
  if (nota.pdfPages !== nota.pagine.length) {
    failed = true;
    console.log(`NO   il PDF ha ${nota.pdfPages} pagine, la vista ${nota.pagine.length}`);
  }
  nota.pagine.forEach((value, k) => {
    const ok = value <= LIMIT;
    if (!ok) failed = true;
    console.log(`${ok ? "ok  " : "NO  "} pagina ${k + 1}: ${share(value)} diversi dalla vista`);
  });
  for (const [label, diff] of [["le lettere misurate", nota.textProbe], ["il testo della nota resa", nota.textView]]) {
    if (diff === null) console.log(`ok   il testo del PDF è uguale a ${label}`);
    else {
      failed = true;
      console.log(`NO   il testo del PDF diverge da ${label} alla lettera ${diff.at}: «${diff.a}» contro «${diff.b}»`);
    }
  }

  const planted = await round(page, base, "spostato");
  const worst = Math.max(...planted.pagine);
  const seen = worst > PLANTED_MIN;
  if (!seen) failed = true;
  console.log(`${seen ? "ok  " : "NO  "} il testo spostato di un pixel si vede: ${share(worst)} diversi`);
} finally {
  await close();
}
console.log(`Le foto, il PDF e i numeri sono in ${out}.`);
if (failed) {
  console.error("La prova del motore del PDF è rossa.");
  process.exitCode = 1;
}
