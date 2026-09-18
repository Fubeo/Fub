#!/usr/bin/env node
// Una famiglia di superficie entra nel contratto pubblico soltanto insieme
// alle prove che la rendono consumabile: shell, fallback, mirror, nativo e WASM.
// Le famiglie pubbliche vengono derivate dai *_FAMILY di fub-abi: aggiungerne
// una senza aggiornare questa matrice fa fallire la CI invece di lasciare una
// checkbox documentale stale.

import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const abiRoot = path.join(root, "crates/fub-abi/src");
const FAMILY = /pub const ([A-Z][A-Z0-9_]*)_FAMILY:\s*&str\s*=\s*"([^"]+)"/g;

const evidence = {
  grid: {
    shell: [
      "apps/client/src/editors/core/bootstrap.ts",
      ['family: "grid"', 'profiles: ["sheet"]', 'fallbackProfile: "sheet"'],
    ],
    fallback: [
      "crates/fub-kernel/tests/registration_and_window.rs",
      ["incompatible_grid_surface_falls_back_without_invoking_provider"],
    ],
    mirror: [
      "apps/client/src/host/contract.ts",
      ['export const GRID_FAMILY = "grid"', "export interface GridSurfaceSpec"],
    ],
    native: [
      "crates/fub-host/src/sheet.rs",
      ["impl fub_abi::grid::GridProvider for SheetGridProvider"],
    ],
    wasm: [
      "crates/fub-wasm-host/tests/grid_crosses.rs",
      ["native_surfaces[0].family, wasm_surfaces[0].family"],
    ],
  },
};

function source(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`manca ${file}`);
  return fs.readFileSync(full, "utf8");
}

const publicFamilies = new Set();
for (const entry of fs.readdirSync(abiRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".rs")) continue;
  const text = fs.readFileSync(path.join(abiRoot, entry.name), "utf8");
  for (const match of text.matchAll(FAMILY)) publicFamilies.add(match[2]);
}

if (publicFamilies.size === 0) {
  throw new Error("nessuna famiglia pubblica *_FAMILY trovata in fub-abi");
}

const failures = [];
for (const family of publicFamilies) {
  const matrix = evidence[family];
  if (!matrix) {
    failures.push(`${family}: manca la matrice shell/fallback/mirror/nativo/WASM`);
    continue;
  }
  for (const role of ["shell", "fallback", "mirror", "native", "wasm"]) {
    const [file, needles] = matrix[role] ?? [];
    if (!file || !Array.isArray(needles) || needles.length === 0) {
      failures.push(`${family}: evidenza ${role} non dichiarata`);
      continue;
    }
    let text;
    try {
      text = source(file);
    } catch (error) {
      failures.push(`${family}/${role}: ${error.message}`);
      continue;
    }
    for (const needle of needles) {
      if (!text.includes(needle)) {
        failures.push(`${family}/${role}: ${file} non contiene ${JSON.stringify(needle)}`);
      }
    }
  }
}

for (const family of Object.keys(evidence)) {
  if (!publicFamilies.has(family)) {
    failures.push(`${family}: matrice stale, nessun *_FAMILY pubblico corrispondente`);
  }
}

if (failures.length) {
  console.error("copertura famiglie di superficie incompleta:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `${publicFamilies.size} famiglia/e pubblica/e: shell, fallback, mirror, nativo e WASM presenti`,
);
