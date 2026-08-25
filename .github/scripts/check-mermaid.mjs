#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

  return errors;
}

const files = walk(path.join(root, "docs")).filter((file) => file.endsWith(".md"));
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

function render(diagrams) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fub-mermaid-"));
  const input = path.join(temp, "all.md");
  const output = path.join(temp, "rendered.md");
  const config = path.join(temp, "puppeteer.json");
  fs.writeFileSync(config, JSON.stringify({ args: ["--no-sandbox", "--disable-setuid-sandbox"] }));
  fs.writeFileSync(
    input,
    diagrams.map((diagram, index) =>
      `## Diagramma ${index + 1}\n\n\`\`\`mermaid\n${diagram.source}\n\`\`\`\n`,
    ).join("\n"),
  );

  const args = [
    "--yes",
    "@mermaid-js/mermaid-cli@11.4.2",
    "-i", input,
    "-o", output,
    "-p", config,
    "-b", "transparent",
  ];
  const first = spawnSync("npx", args, { encoding: "utf8", timeout: 240_000 });
  if (first.status === 0) {
    fs.rmSync(temp, { recursive: true, force: true });
    return [];
  }

  const failures = [];
  for (const diagram of diagrams) {
    const single = path.join(temp, "single.mmd");
    const svg = path.join(temp, "single.svg");
    fs.writeFileSync(single, diagram.source);
    const result = spawnSync(
      "npx",
      ["--yes", "@mermaid-js/mermaid-cli@11.4.2", "-i", single, "-o", svg, "-p", config, "-b", "transparent"],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (result.status !== 0) {
      failures.push(
        `${path.relative(root, diagram.file)}:${diagram.line}: rendering fallito: ` +
        `${(result.stderr || result.stdout || "errore Mermaid").trim()}`,
      );
    }
  }
  fs.rmSync(temp, { recursive: true, force: true });
  return failures;
}

if (!errors.length && process.argv.includes("--render")) {
  errors.push(...render(allBlocks));
}

if (errors.length) {
  console.error("Blocchi Mermaid non validi:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`${allBlocks.length} blocchi Mermaid validi${process.argv.includes("--render") ? " e renderizzati" : ""}.`);
