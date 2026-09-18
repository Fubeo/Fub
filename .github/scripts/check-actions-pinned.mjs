#!/usr/bin/env node
// Le GitHub Action esterne sono codice eseguito con i privilegi del workflow:
// un tag mobile non è una dipendenza riproducibile. Ogni `uses:` esterna deve
// quindi puntare a un commit SHA completo; le action locali (`./...`) restano
// libere perché il loro contenuto è già quello del commit del repository.

import fs from "node:fs";
import path from "node:path";

const WORKFLOWS = ".github/workflows";
const COMMIT = /^[0-9a-f]{40}$/i;

function workflowFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

const root = process.argv[2] ?? ".";
const workflowRoot = path.join(root, WORKFLOWS);
if (!fs.existsSync(workflowRoot)) {
  console.error(`cannot find ${workflowRoot}: pass the repo root as an argument.`);
  process.exit(2);
}

let inspected = 0;
let problems = 0;
for (const file of workflowFiles(workflowRoot)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  for (const [index, line] of fs.readFileSync(file, "utf8").split("\n").entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?/);
    if (!match) continue;

    const target = match[1];
    if (target.startsWith("./")) continue;
    inspected++;

    const at = target.lastIndexOf("@");
    const ref = at >= 0 ? target.slice(at + 1) : "";
    if (!COMMIT.test(ref)) {
      problems++;
      console.error(`${relative}:${index + 1}: action is not pinned to a full commit SHA`);
      console.error(`  ${target}`);
    }
  }
}

if (problems > 0) {
  console.error("");
  console.error(`${problems} external action reference(s) use a moving or incomplete ref.`);
  console.error("Resolve the intended tag to its commit and pin the 40-character SHA.");
  process.exit(1);
}

if (inspected === 0) {
  console.error("no external GitHub Actions found; the guard is probably looking in the wrong place.");
  process.exit(2);
}

console.log(`${inspected} external action reference(s): every one is pinned to a commit SHA.`);
