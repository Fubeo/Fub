#!/usr/bin/env node
// Il lock del client deve contenere una sola copia di ogni pacchetto. Due copie
// di moduli che custodiscono identità o stato creano mondi incompatibili senza
// produrre necessariamente un errore di tipo o un'eccezione.

import fs from "node:fs";

const ALLOWED_DUPLICATES = new Map([
  [
    "fsevents",
    "dipendenza opzionale esclusiva di macOS; le copie non condividono identità applicativa",
  ],
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
  const reason = ALLOWED_DUPLICATES.get(name);
  if (reason) {
    console.log(`${name}: ${locations.length} copies, declared — ${reason}`);
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

console.log(`${copies.size} packages in ${lock}: none in two copies.`);
