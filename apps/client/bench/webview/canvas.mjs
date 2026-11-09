// Il nucleo della lavagna in WebAssembly (L1, piano N3): istanza, `open` e
// `commit` di uno spostamento su una lavagna di 50 e una di 2000 schede.
//
// La stessa misura gira in due posti:
//
// - nella WebView vera, come scenario L1 di `run.mjs`: `CANVAS_SCRIPT` prende
//   il `.wasm` che la build ha messo fra gli asset (`assets/fub-canvas-
//   <hash>.wasm`), lo compila con la CSP dell'app e misura. Un errore di CSP
//   (`'wasm-unsafe-eval'` che manca o che la WebView non conosce) fa fallire
//   la compilazione, e lo scenario fallisce dicendolo;
// - in Node, da `apps/client/`:
//
//     node bench/webview/canvas.mjs [--wasm=dist/assets/fub-canvas-<hash>.wasm]
//          [--giri=2] [--out=bench/.output/canvas]
//
//   senza `--wasm` prende il modulo di `dist/assets/` (dopo `npm run build`).
//
// Le chiamate seguono il patto di `docs/reference/canvas-operations.md`
// § «WebAssembly», come fa `src/editors/canvas/wasm/core.ts`: l'ingresso in
// memoria chiesta a `fub_alloc` e liberata con `fub_free`, il risultato
// copiato subito e letto come JSON.
//
// - **istanza**: compilare il modulo e farne un'istanza, dai byte in memoria;
// - **open**: dal testo della lavagna al modello letto (codifica UTF-8,
//   copia, `canvas_open`, `JSON.parse` del risultato); la prima apertura si
//   conta a parte, le altre (`opens`) danno mediana, p95 e massimo;
// - **commit**: dalle toppe di uno spostamento al tratto cambiato e alle
//   toppe dell'annulla, letti (`JSON.stringify` delle toppe, copia,
//   `canvas_commit`, `JSON.parse`), su una lavagna già aperta. Ogni commit
//   rimette la scheda dov'era con le toppe d'annulla del precedente: la
//   lavagna non cresce, e alla fine il testo, rifatto coi tratti, deve
//   tornare uguale a quello di partenza (la misura lo controlla).
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { cpus, hostname, release, totalmem, type as osType } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

/// Le due lavagne del piano: piccola e grande.
export const SIZES = [50, 2000];
/// Quante aperture e quanti commit per lavagna.
export const OPENS = 20;
export const COMMITS = 200;

/// Una lavagna di `count` schede di testo su una griglia di venti colonne,
/// unite in fila da archi, scritta con le tabulazioni come la scrive
/// Obsidian. Deterministica: stesso `count`, stessi byte.
export function canvasText(count) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `scheda-${i}`,
      type: "text",
      text: `## Scheda ${i}\n\nUn appunto della lavagna, con un elenco:\n\n- primo\n- secondo`,
      x: (i % 20) * 280,
      y: Math.floor(i / 20) * 220,
      width: 240,
      height: 180,
    });
  }
  const edges = nodes.slice(1).map((node, i) => ({ id: `arco-${i}`, fromNode: nodes[i].id, fromSide: "right", toNode: node.id, toSide: "left" }));
  return JSON.stringify({ nodes, edges }, null, "\t");
}

/// La misura. Autonoma (niente import né variabili di fuori): `CANVAS_SCRIPT`
/// la porta nella WebView col suo testo.
export async function measureCanvasCore(bytes, sizes, opens, commits, makeText) {
  const now = () => performance.now();
  const round = (ms) => Math.round(ms * 1000) / 1000;
  const stats = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (q) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
    return { count: s.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1]) };
  };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  let t = now();
  const module = await WebAssembly.compile(bytes);
  const compileMs = now() - t;
  t = now();
  const instance = await WebAssembly.instantiate(module, {});
  const instantiateMs = now() - t;
  const x = instance.exports;

  // Una chiamata del patto: l'ingresso in memoria del modulo, liberato
  // sempre; il risultato copiato e letto.
  function call(input, run) {
    const len = input.length;
    let ptr = 0;
    try {
      if (len > 0) {
        ptr = x.fub_alloc(len) >>> 0;
        if (ptr === 0) throw new Error(`fub_alloc(${len}) ha dato 0`);
        new Uint8Array(x.memory.buffer, ptr, len).set(input);
      }
      const status = run(ptr, len);
      const result = new Uint8Array(x.memory.buffer, x.result_ptr() >>> 0, x.result_len() >>> 0).slice();
      return { status, value: JSON.parse(decoder.decode(result)) };
    } finally {
      if (ptr !== 0) x.fub_free(ptr, len);
    }
  }
  const open = (text) => {
    const answer = call(encoder.encode(text), (p, l) => x.canvas_open(p, l));
    if ((answer.status >>> 0) === 0) throw new Error(`canvas_open: ${JSON.stringify(answer.value.error)}`);
    return answer.value;
  };
  const close = (handle) => {
    if (x.canvas_close(handle) !== 0) throw new Error(`canvas_close(${handle}) non riesce`);
  };
  const commit = (handle, patches) => {
    const answer = call(encoder.encode(JSON.stringify(patches)), (p, l) => x.canvas_commit(handle, p, l));
    if (answer.status !== 0) throw new Error(`canvas_commit: ${JSON.stringify(answer.value.error)}`);
    return answer.value;
  };

  const boards = [];
  for (const size of sizes) {
    const text = makeText(size);
    const textBytes = encoder.encode(text).length;
    // Le aperture: la prima a parte, poi `opens` volte, chiudendo ognuna.
    t = now();
    const first = open(text);
    const firstOpenMs = now() - t;
    close(first.handle);
    if (first.canvas.nodes.length !== size) throw new Error(`la lavagna di ${size} schede ne ha ${first.canvas.nodes.length}`);
    const openTimes = [];
    for (let i = 0; i < opens; i++) {
      t = now();
      const opened = open(text);
      openTimes.push(now() - t);
      close(opened.handle);
    }
    // I commit: una scheda in mezzo, spostata e rimessa a posto.
    const board = open(text);
    const node = board.canvas.nodes[Math.floor(size / 2)];
    const moved = { ...node, x: node.x + 40, y: node.y + 30 };
    let patches = [{ kind: "upsert-node", before: node, after: moved }];
    let source = text;
    let firstCommitMs = null;
    const commitTimes = [];
    for (let i = 0; i < commits + 1; i++) {
      t = now();
      const done = commit(board.handle, patches);
      const ms = now() - t;
      if (i === 0) firstCommitMs = ms;
      else commitTimes.push(ms);
      const { start, end, text: piece } = done.edit;
      source = source.slice(0, start) + piece + source.slice(end);
      patches = done.inverse;
    }
    // Un numero dispari di commit lascia la scheda spostata: uno in più la
    // rimette, e il testo torna quello di partenza.
    const last = commit(board.handle, patches);
    source = source.slice(0, last.edit.start) + last.edit.text + source.slice(last.edit.end);
    close(board.handle);
    if (source !== text) throw new Error(`la lavagna di ${size} schede non torna uguale dopo i commit`);
    boards.push({
      size,
      textBytes,
      firstOpenMs: round(firstOpenMs),
      open: stats(openTimes),
      firstCommitMs: round(firstCommitMs),
      commit: stats(commitTimes),
    });
  }
  return {
    moduleBytes: bytes.byteLength,
    compileMs: round(compileMs),
    instantiateMs: round(instantiateMs),
    instanceMs: round(compileMs + instantiateMs),
    memoryBytes: x.memory.buffer.byteLength,
    boards,
  };
}

/// Lo script dello scenario L1 per `executeAsync`: argomenti l'URL del
/// modulo, le dimensioni, le aperture e i commit. Torna il referto, o
/// `{ error, violations }` se il modulo non si carica: le violazioni della
/// CSP che la pagina ha visto mentre compilava.
export const CANVAS_SCRIPT = `
const done = arguments[arguments.length - 1];
const [url, sizes, opens, commits] = arguments;
const canvasText = ${canvasText.toString()};
const measureCanvasCore = ${measureCanvasCore.toString()};
const violations = [];
const seen = (event) => violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI, sample: event.sample });
document.addEventListener("securitypolicyviolation", seen);
(async () => {
  let stage = "fetch";
  try {
    let t = performance.now();
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status + " per " + url);
    const bytes = await response.arrayBuffer();
    const fetchMs = Math.round((performance.now() - t) * 1000) / 1000;
    stage = "misura";
    const report = await measureCanvasCore(bytes, sizes, opens, commits, canvasText);
    done({ ...report, url, fetchMs, userAgent: navigator.userAgent, violations });
  } catch (error) {
    // L'evento della violazione arriva dopo l'eccezione: un attimo per
    // raccoglierlo.
    await new Promise((resolve) => setTimeout(resolve, 100));
    done({ error: stage + ": " + String(error && error.message || error), violations });
  } finally {
    document.removeEventListener("securitypolicyviolation", seen);
  }
})();
`;

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "../..");

/// Il modulo che la build ha messo fra gli asset: il nome con l'hash.
export function builtModule(dist = join(clientRoot, "dist")) {
  const assets = join(dist, "assets");
  const found = readdirSync(assets).filter((name) => /^fub-canvas-.*\.wasm$/.test(name));
  if (found.length !== 1) throw new Error(`${assets} ha ${found.length} moduli fub-canvas-*.wasm invece di uno: rifai npm run build`);
  return { file: join(assets, found[0]), url: `assets/${found[0]}` };
}

/// La dimensione del modulo: grezza, gzip -9 e brotli al massimo.
export function moduleSizes(bytes) {
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes).length };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }));
  const file = resolve(args.wasm ?? builtModule().file);
  const rounds = Number(args.giri ?? 2);
  const out = resolve(args.out ?? join(clientRoot, "bench/.output/canvas"));
  const bytes = readFileSync(file);
  const results = [];
  for (let i = 1; i <= rounds; i++) {
    // Ogni giro compila da capo: anche l'istanza si misura ogni volta.
    const report = await measureCanvasCore(new Uint8Array(bytes), SIZES, OPENS, COMMITS, canvasText);
    results.push(report);
    console.log(`giro ${i}: istanza ${report.instanceMs} ms (compilare ${report.compileMs}, istanziare ${report.instantiateMs})`);
    for (const b of report.boards) {
      console.log(`  ${b.size} schede, ${b.textBytes} byte: open prima ${b.firstOpenMs} ms, p50 ${b.open.p50} p95 ${b.open.p95} max ${b.open.max}; commit primo ${b.firstCommitMs} ms, p50 ${b.commit.p50} p95 ${b.commit.p95} max ${b.commit.max}`);
    }
  }
  const sizes = moduleSizes(bytes);
  console.log(`modulo ${file}: ${sizes.raw} byte, ${sizes.gzip} con gzip -9, ${sizes.brotli} con brotli`);
  mkdirSync(out, { recursive: true });
  const report = {
    module: { file, ...sizes },
    node: process.version,
    v8: process.versions.v8,
    machine: { host: hostname(), cpu: cpus()[0]?.model ?? null, cores: cpus().length, memoryGiB: Math.round(totalmem() / 2 ** 30) },
    system: { os: osType(), release: release() },
    opens: OPENS,
    commits: COMMITS,
    results,
  };
  writeFileSync(join(out, "referto.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Il referto: ${join(out, "referto.json")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
