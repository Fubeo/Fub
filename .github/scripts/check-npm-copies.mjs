#!/usr/bin/env node
// Il lock del client deve contenere una sola copia di ogni pacchetto. Due copie
// di moduli che custodiscono identità o stato creano mondi incompatibili senza
// produrre necessariamente un errore di tipo o un'eccezione.

import fs from "node:fs";

// Le dipendenze private di Mermaid hanno major incompatibili ma non si
// scambiano istanze. Le versioni sono chiuse: un'altra copia o un aggiornamento
// richiedono una nuova verifica, non ereditano automaticamente l'eccezione.
const ALLOWED_DUPLICATES = new Map([
  ["fsevents", {
    reason: "dipendenza opzionale esclusiva di macOS; le copie non condividono identità applicativa",
  }],
  ["commander", {
    versions: ["7.2.0", "8.3.0"],
    reason: "CLI Node distinte di d3-dsv e KaTeX; nessuna copia entra nella shell",
  }],
  ["cose-base", {
    versions: ["1.0.3", "2.2.0"],
    reason: "modelli privati dei layout CoSE e fCoSE; ogni algoritmo usa solo la propria major",
  }],
  ["layout-base", {
    versions: ["1.0.2", "2.0.1"],
    reason: "strutture private delle due major di cose-base, senza istanze condivise fra layout",
  }],
  ["d3-array", {
    versions: ["2.12.1", "3.2.4"],
    reason: "Sankey usa d3-array 2, Mermaid d3-array 3; il confine scambia array e numeri JavaScript",
  }],
  ["d3-path", {
    versions: ["1.0.9", "3.1.0"],
    reason: "generatori privati delle due major di d3-shape; il risultato condiviso è testo SVG",
  }],
  ["d3-shape", {
    versions: ["1.3.7", "3.2.0"],
    reason: "generatori separati di Sankey e D3 7; nessuna identità del generatore attraversa il confine",
  }],
  ["internmap", {
    versions: ["1.0.1", "2.0.3"],
    reason: "mappe interne delle due major di d3-array, non esportate come stato applicativo",
  }],
  ["tinyexec", {
    versions: ["1.3.0", "1.3.1"],
    reason: "helper Node privati di Vitest e install-pkg; non condividono stato e non entrano nella shell",
  }],
]);

const lock = process.argv[2] ?? "apps/client/package-lock.json";
if (!fs.existsSync(lock)) {
  console.error(`cannot find ${lock}: pass it as an argument.`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(lock, "utf8"));
if (typeof data.packages !== "object" || data.packages === null) {
  console.error(`${lock} has no "packages" section: a v2 or v3 lockfile is required.`);
  process.exit(2);
}

function packageName(packagePath) {
  const marker = packagePath.lastIndexOf("node_modules/");
  return marker < 0 ? null : packagePath.slice(marker + "node_modules/".length);
}

const copies = new Map();
for (const [packagePath, entry] of Object.entries(data.packages)) {
  const name = packageName(packagePath);
  if (name === null || entry.link === true) continue;
  const locations = copies.get(name);
  const copy = { path: packagePath, version: entry.version };
  if (locations) locations.push(copy);
  else copies.set(name, [copy]);
}

let problems = 0;
for (const [name, locations] of [...copies].sort()) {
  if (locations.length < 2) continue;
  const exception = ALLOWED_DUPLICATES.get(name);
  const versions = locations.map((entry) => entry.version).sort();
  const expected = exception?.versions;
  if (exception && (!expected || (expected.length === versions.length
      && expected.every((version, index) => version === versions[index])))) {
    console.log(`${name}: ${locations.length} copies, declared — ${exception.reason}`);
    continue;
  }
  problems++;
  console.error(`${name}: ${locations.length} copies in the tree`);
  for (const location of locations) {
    console.error(`  ${location.version ?? "?"} in ${location.path}`);
  }
}

if (problems > 0) {
  console.error("");
  console.error(`${problems} packages exist in more than one copy.`);
  console.error("Align dependency ranges or document a genuinely harmless exception.");
  process.exit(1);
}

console.log(`${copies.size} packages in ${lock}: no undeclared duplicates.`);
