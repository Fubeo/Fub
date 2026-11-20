#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = process.cwd();

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function blocks(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const result = [];
  let open = null;
  let content = [];

  lines.forEach((line, index) => {
    if (!open) {
      if (/^\s*```mermaid\s*$/.test(line)) {
        open = index + 1;
        content = [];
      }
    } else if (/^\s*```\s*$/.test(line)) {
      result.push({ file, line: open + 1, source: content.join("\n") });
      open = null;
    } else {
      content.push(line);
    }
  });
  if (open) throw new Error(`${path.relative(root, file)}:${open}: blocco Mermaid non chiuso`);
  return result;
}

function nodeCount(source, kind) {
  const ids = new Set();
  if (kind.startsWith("flowchart")) {
    for (const match of source.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*(?=\[|\(|\{)/g)) ids.add(match[1]);
  } else if (kind === "sequenceDiagram") {
    for (const match of source.matchAll(/^\s*participant\s+([A-Za-z][A-Za-z0-9_]*)/gm)) ids.add(match[1]);
  } else if (kind === "stateDiagram-v2") {
    for (const match of source.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*-->/gm)) ids.add(match[1]);
    for (const match of source.matchAll(/-->\s*([A-Za-z][A-Za-z0-9_]*)/g)) ids.add(match[1]);
  } else if (kind === "classDiagram") {
    for (const match of source.matchAll(/^\s*class\s+([A-Za-z][A-Za-z0-9_]*)/gm)) ids.add(match[1]);
  } else if (kind === "erDiagram") {
    for (const match of source.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\{|\|\||o\{)/gm)) ids.add(match[1]);
  }
  return ids.size;
}

// Le etichette di ogni nodo di un flowchart, per id. Mermaid tiene l'ultima
// etichetta di un id dichiarato più volte e disegna un nodo solo: due nodi
// scritti con la stessa id diventano uno, e il primo sparisce senza errore.
function relabeled(source) {
  const labels = new Map();
  const declaration = /\b([A-Za-z][A-Za-z0-9_]*)\s*(?:\[|\(|\{)+\s*("([^"]*)"|[^\]\)\}\n]*)/g;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(%%|subgraph\b)/.test(line)) continue;
    for (const match of line.matchAll(declaration)) {
      const label = (match[3] ?? match[2]).trim();
      const seen = labels.get(match[1]) ?? new Set();
      seen.add(label);
      labels.set(match[1], seen);
    }
  }
  return [...labels].filter(([, seen]) => seen.size > 1).map(([id, seen]) => ({ id, labels: [...seen] }));
}

function structural(block) {
  const errors = [];
  const first = block.source.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const allowed = [
    /^flowchart\s+(LR|RL|TD|BT)$/,
    /^sequenceDiagram$/,
    /^stateDiagram-v2$/,
    /^classDiagram$/,
    /^erDiagram$/,
  ];
  if (!allowed.some((pattern) => pattern.test(first))) {
    errors.push(`tipo non ammesso o direzione mancante: ${first || "<vuoto>"}`);
    return errors;
  }

  if (/^\s*(style|classDef|linkStyle)\b/m.test(block.source) ||
      /%%\{init:/i.test(block.source) ||
      /#[0-9a-f]{3,8}\b/i.test(block.source) ||
      /\brgba?\s*\(/i.test(block.source) ||
      /:::/m.test(block.source)) {
    errors.push("stili o colori hardcoded non consentiti");
  }

  const count = nodeCount(block.source, first);
  if (count > 20) errors.push(`${count} nodi o partecipanti, massimo 20`);

  if (first.startsWith("flowchart")) {
    for (const { id, labels } of relabeled(block.source)) {
      errors.push(`il nodo ${id} ha due etichette (${labels.map((label) => `«${label}»`).join(", ")}): Mermaid ne disegna uno solo, con l'ultima`);
    }
  }

  return errors;
}

// L'autoprova gira a ogni corsa, prima dei documenti: costa niente, e così la
// regola delle etichette è provata dagli stessi passi che la applicano
// (`scripts/check.sh` e la CI). `--self-test` si ferma dopo di lei.
{
  const check = (source) => structural({ source });
  const doubled = check("flowchart LR\n    A[\"uno\"] --> C[\"tre\"]\n    A[\"due\"] --> C");
  const repeated = check("flowchart LR\n    A[\"uno\"] --> B[\"due\"]\n    A --> C[\"tre\"]\n    B[\"due\"] --> C");
  const shapes = check("flowchart TD\n    A((cerchio)) --> B{scelta}\n    B --> C[(disco)]\n    %% A[commento]");
  if (doubled.length !== 1 || !doubled[0].includes("il nodo A") || repeated.length || shapes.length) {
    console.error("autoprova Mermaid fallita:", JSON.stringify({ doubled, repeated, shapes }));
    process.exit(1);
  }
  if (process.argv.includes("--self-test")) {
    console.log("autoprova Mermaid: ok.");
    process.exit(0);
  }
}

// Le pagine di `docs/` e la pagina d'ingresso del repository: il README apre
// con il diagramma dell'architettura, ed è il primo che si legge.
const files = [
  ...walk(path.join(root, "docs")).filter((file) => file.endsWith(".md")),
  path.join(root, "README.md"),
];
let allBlocks = [];
try {
  allBlocks = files.flatMap(blocks);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const errors = [];
for (const block of allBlocks) {
  for (const error of structural(block)) {
    errors.push(`${path.relative(root, block.file)}:${block.line}: ${error}`);
  }
}

// Il render apre i diagrammi dei documenti, che su una PR vengono da chiunque,
// in un Chromium **con la sandbox** (`chromiumSandbox: true`, audit del
// 2026-10-30, B19). Dove AppArmor chiude gli user namespace (Ubuntu 24.04)
// Chromium parte soltanto se un profilo glieli concede: la CI passa il Chrome
// del runner, coperto dal profilo `chrome` di AppArmor, con
// `FUB_MERMAID_CHROME`; senza, si usa il Chromium installato da Playwright.
// Senza sandbox il render fallisce e lo dice: non si ripiega su un Chromium
// senza.
//
// Mermaid e Playwright sono quelli di `apps/client/package-lock.json`: lo
// stesso Mermaid che disegna i diagrammi nell'app, e nessun pacchetto
// scaricato fuori dal lockfile. Prima dei documenti passano due diagrammi di
// prova: quello buono deve riuscire e quello rotto fallire, così un render che
// non sa più fallire è rosso anche lui.
const PROVA_BUONA = 'flowchart LR\n    A["uno"] --> B["due"]';
const PROVA_ROTTA = 'flowchart LR\n    A["uno"] -->';

async function render(diagrams) {
  let chromium;
  let mermaidJs;
  let version;
  try {
    const require = createRequire(path.join(root, "apps", "client", "package.json"));
    ({ chromium } = require("playwright"));
    mermaidJs = require.resolve("mermaid/dist/mermaid.min.js");
    version = JSON.parse(fs.readFileSync(require.resolve("mermaid/package.json"), "utf8")).version;
  } catch (error) {
    return [`il render usa Mermaid e Playwright di apps/client, che mancano: prima \`npm ci\` in apps/client (${error.message.split("\n")[0]})`];
  }

  let browser;
  try {
    browser = await chromium.launch({
      chromiumSandbox: true,
      ...(process.env.FUB_MERMAID_CHROME ? { executablePath: process.env.FUB_MERMAID_CHROME } : {}),
    });
  } catch (error) {
    return [`Chromium, con la sandbox, non parte: ${error.message.split("\n")[0]}`];
  }
  let timer;
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    await page.addScriptTag({ path: mermaidJs });
    const sources = [PROVA_BUONA, PROVA_ROTTA, ...diagrams.map((diagram) => diagram.source)];
    const results = await Promise.race([
      page.evaluate(async (all) => {
        const engine = globalThis.mermaid;
        engine.initialize({ startOnLoad: false, securityLevel: "strict" });
        const out = [];
        for (const [index, source] of all.entries()) {
          try {
            await engine.render(`diagramma-${index}`, source);
            out.push(null);
          } catch (error) {
            out.push(String(error?.message ?? error).trim() || "errore Mermaid");
          }
          for (const leftover of document.querySelectorAll('[id^="ddiagramma-"], [id^="diagramma-"]')) leftover.remove();
        }
        return out;
      }, sources),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("oltre 240 s")), 240_000);
      }),
    ]);
    const [buona, rotta, ...documenti] = results;
    const failures = [];
    if (buona !== null) failures.push(`autoprova del render: il diagramma buono non si disegna (${buona})`);
    if (rotta === null) failures.push("autoprova del render: il diagramma rotto si disegna senza errore");
    documenti.forEach((error, index) => {
      if (error === null) return;
      const diagram = diagrams[index];
      failures.push(`${path.relative(root, diagram.file)}:${diagram.line}: rendering fallito con Mermaid ${version}: ${error}`);
    });
    if (!failures.length) renderedWith = version;
    return failures;
  } catch (error) {
    return [`render Mermaid interrotto: ${error.message.split("\n")[0]}`];
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}

let renderedWith = null;
if (!errors.length && process.argv.includes("--render")) {
  errors.push(...(await render(allBlocks)));
}

if (errors.length) {
  console.error("Blocchi Mermaid non validi:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`${allBlocks.length} blocchi Mermaid validi${renderedWith ? ` e disegnati con Mermaid ${renderedWith}` : ""}.`);
