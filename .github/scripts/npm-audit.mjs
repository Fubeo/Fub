#!/usr/bin/env node
// L'audit npm della supply chain (ADR 0179): ogni avviso alto o critico è
// rosso, salvo un'eccezione scritta in `.github/npm-audit-eccezioni.json`.
// Un'eccezione è come `ignore` in `deny.toml`, ma più stretta, perché npm non
// ha un modo suo per dirlo:
//
// - nomina l'avviso (GHSA) e il pacchetto, dice perché e quando scade;
// - vale solo per un pacchetto che non entra nell'app: se compare
//   nell'albero di produzione (`npm ls --omit=dev`), l'eccezione non basta;
// - scaduta, è rossa: si rinnova solo riguardando l'avviso;
// - un'eccezione che non serve più (avviso sparito o corretto) è rossa, così
//   l'elenco resta corto e vero.
//
// Uso: `node .github/scripts/npm-audit.mjs` da `apps/client` (la cartella del
// lockfile); `--self-test` prova la regola su dati finti.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEVERE = new Set(["high", "critical"]);
const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "npm-audit-eccezioni.json");

/// L'id GHSA di una voce `via` di `npm audit --json`, o null.
function advisoryId(via) {
  const match = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(via.url ?? "");
  return match ? match[0] : null;
}

/// Gli avvisi alti o critici del rapporto, ciascuno col pacchetto che lo ha.
export function severeAdvisories(report) {
  const found = new Map();
  for (const entry of Object.values(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || !SEVERE.has(via.severity)) continue;
      const id = advisoryId(via) ?? `${via.name}:${via.source}`;
      found.set(id, { id, pacchetto: via.name, titolo: via.title ?? "", gravità: via.severity });
    }
  }
  return [...found.values()];
}

/// Gli errori: avvisi senza eccezione, eccezioni scadute, malformate, inutili
/// o per un pacchetto che entra nell'app. `inProduction(pkg)` dice se il
/// pacchetto compare nell'albero senza le dipendenze di sviluppo.
export function check(advisories, exceptions, today, inProduction) {
  const errors = [];
  const byId = new Map();
  for (const exception of exceptions) {
    const { avviso, pacchetto, scade, perché } = exception;
    if (!/^GHSA-/.test(avviso ?? "") || !pacchetto || !perché || !/^\d{4}-\d{2}-\d{2}$/.test(scade ?? "")) {
      errors.push(`eccezione malformata (servono avviso GHSA, pacchetto, scade AAAA-MM-GG, perché): ${JSON.stringify(exception)}`);
      continue;
    }
    byId.set(avviso, exception);
  }
  const seen = new Set(advisories.map((advisory) => advisory.id));
  for (const advisory of advisories) {
    const exception = byId.get(advisory.id);
    if (!exception) {
      errors.push(`${advisory.gravità}: ${advisory.id} su ${advisory.pacchetto} (${advisory.titolo}) senza eccezione`);
      continue;
    }
    if (exception.pacchetto !== advisory.pacchetto) {
      errors.push(`l'eccezione per ${advisory.id} nomina ${exception.pacchetto}, ma l'avviso è su ${advisory.pacchetto}`);
    }
    if (exception.scade < today) {
      errors.push(`l'eccezione per ${advisory.id} è scaduta il ${exception.scade}: riguarda l'avviso e rinnovala o correggi la dipendenza`);
    }
    if (inProduction(advisory.pacchetto)) {
      errors.push(`${advisory.pacchetto} entra nell'app (npm ls --omit=dev): per ${advisory.id} un'eccezione non basta`);
    }
  }
  for (const id of byId.keys()) {
    if (!seen.has(id)) errors.push(`l'eccezione per ${id} non serve più: toglila da .github/npm-audit-eccezioni.json`);
  }
  return errors;
}

function selfTest() {
  const report = {
    vulnerabilities: {
      picomatch: { via: [{ name: "picomatch", source: 1, severity: "high", title: "ReDoS", url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf" }] },
      vite: { via: ["fdir", "picomatch"] },
      lieve: { via: [{ name: "lieve", source: 2, severity: "moderate", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }] },
    },
  };
  const advisories = severeAdvisories(report);
  const ok = { avviso: "GHSA-fc5q-39xc-vjpf", pacchetto: "picomatch", scade: "2026-12-31", perché: "solo sviluppo" };
  const dev = () => false;
  const cases = [
    ["un avviso moderato e una catena non contano", advisories.length === 1],
    ["senza eccezione è rosso", check(advisories, [], "2026-11-17", dev).length === 1],
    ["con l'eccezione è verde", check(advisories, [ok], "2026-11-17", dev).length === 0],
    ["scaduta è rossa", check(advisories, [ok], "2027-01-01", dev).some((e) => e.includes("scaduta"))],
    ["in produzione è rossa", check(advisories, [ok], "2026-11-17", () => true).some((e) => e.includes("entra nell'app"))],
    ["un'eccezione inutile è rossa", check([], [ok], "2026-11-17", dev).some((e) => e.includes("non serve più"))],
    ["malformata è rossa", check(advisories, [{ avviso: "GHSA-fc5q-39xc-vjpf" }], "2026-11-17", dev).some((e) => e.includes("malformata"))],
    ["il pacchetto sbagliato è rosso", check(advisories, [{ ...ok, pacchetto: "altro" }], "2026-11-17", dev).some((e) => e.includes("nomina"))],
  ];
  const failed = cases.filter(([, passed]) => !passed);
  for (const [name] of failed) console.error(`✗ ${name}`);
  if (failed.length) process.exit(1);
  console.log(`npm-audit: ${cases.length} casi verdi`);
}

function npmJson(args) {
  try {
    return JSON.parse(execFileSync("npm", args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    // `npm audit` e `npm ls` escono con 1 quando trovano qualcosa: conta il JSON.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

function main() {
  const { eccezioni = [] } = JSON.parse(readFileSync(FILE, "utf8"));
  const report = npmJson(["audit", "--json"]);
  if (report.error) throw new Error(`npm audit non ha risposto: ${JSON.stringify(report.error)}`);
  const inProduction = (pkg) => Object.keys(npmJson(["ls", "--omit=dev", "--all", "--json", pkg]).dependencies ?? {}).length > 0;
  const today = new Date().toISOString().slice(0, 10);
  const advisories = severeAdvisories(report);
  const errors = check(advisories, eccezioni, today, inProduction);
  for (const advisory of advisories) {
    if (!errors.some((error) => error.includes(advisory.id))) console.log(`eccezione: ${advisory.id} su ${advisory.pacchetto}, fino al ${eccezioni.find((e) => e.avviso === advisory.id)?.scade}`);
  }
  if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  console.log(`npm-audit: nessun avviso alto o critico senza eccezione (${advisories.length} con eccezione)`);
}

if (process.argv.includes("--self-test")) selfTest();
else main();
