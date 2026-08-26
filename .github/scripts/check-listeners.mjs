#!/usr/bin/env node
// Ogni listener su un target globale deve passare da una Lifetime. La guardia
// legge i sorgenti del client unificato e lascia liberi i test, che costruiscono
// deliberatamente casi negativi.

import fs from "node:fs";
import path from "node:path";

const GATE = "apps/client/src/ui/lifetime.ts";
const SOURCES = "apps/client/src";
const GLOBAL_TARGETS = [
  "document",
  "window",
  "globalThis",
  "self",
  "document.body",
  "document.documentElement",
];

function violations(text) {
  const names = GLOBAL_TARGETS.map((target) => target.replace(".", "\\s*\\.\\s*")).join("|");
  const globalListener = new RegExp(
    String.raw`(?<![.\w])(${names})\s*\.\s*addEventListener\b`,
  );
  const mediaListener = /matchMedia[\s\S]*?\.\s*addEventListener\b/;
  const found = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (globalListener.test(line) || mediaListener.test(line)) {
      found.push({ line: index + 1, text: line.trim() });
    }
  }
  return found;
}

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(candidate, found);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push(candidate);
    }
  }
  return found;
}

const root = process.argv[2] ?? ".";
const sourceRoot = path.join(root, SOURCES);
if (!fs.existsSync(sourceRoot)) {
  console.error(`cannot find ${sourceRoot}: pass the repo root as an argument.`);
  process.exit(2);
}

let problems = 0;
let inspected = 0;
for (const file of sourceFiles(sourceRoot).sort()) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative === GATE) continue;
  inspected++;
  for (const violation of violations(fs.readFileSync(file, "utf8"))) {
    problems++;
    console.error(`${relative}:${violation.line}: global listener without a Lifetime`);
    console.error(`  ${violation.text}`);
  }
}

if (problems > 0) {
  console.error("");
  console.error(`${problems} global listeners registered outside ${GATE}.`);
  console.error("Use `lifetime.listen(target, …)` and close the owning Lifetime.");
  process.exit(1);
}

console.log(`${inspected} sources: every global listener goes through a Lifetime.`);
