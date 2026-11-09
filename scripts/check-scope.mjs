#!/usr/bin/env node
// Ciò che un diff tocca, per `scripts/check.sh --rapido`.
//
// Legge i file cambiati (uno per riga, da stdin) e stampa righe `chiave=valore`:
//   crates=  i crate del workspace toccati più quelli che li usano, anche solo
//            nei test (un cambio a `fub-abi` riguarda chiunque lo importi);
//   all=1    quando cambia qualcosa che vale per tutto il workspace;
//   client=1 / docs=1 / github=1 / vendor=1  le altre aree toccate;
//   canvaswasm=1  cambia il nucleo della lavagna (`crates/fub-canvas-core/` o
//            `crates/fub-canvas-wasm/`): il client lo compila in `.wasm`, quindi
//            vale anche client=1 e si rifanno i test della lavagna;
//   tauri=   i crate che dipendono da Tauri, per saltarli dove mancano le
//            librerie di sistema.

import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();
const files = fs.readFileSync(0, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const meta = JSON.parse(execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
}));

const pkgs = meta.packages.map((p) => ({
  name: p.name,
  dir: path.relative(root, path.dirname(p.manifest_path)).split(path.sep).join("/"),
  deps: p.dependencies,
}));
const names = new Set(pkgs.map((p) => p.name));

// chi usa chi, fra i membri del workspace
const users = new Map(pkgs.map((p) => [p.name, new Set()]));
for (const p of pkgs) {
  for (const d of p.deps) {
    if (names.has(d.name) && d.name !== p.name) users.get(d.name).add(p.name);
  }
}

function owner(file) {
  let best = null;
  for (const p of pkgs) {
    if (p.dir === "") continue;
    if ((file === p.dir || file.startsWith(p.dir + "/")) && (!best || p.dir.length > best.dir.length)) best = p;
  }
  return best;
}

const flags = { all: 0, client: 0, canvaswasm: 0, docs: 0, github: 0, vendor: 0 };
const touched = new Set();
for (const f of files) {
  if (f === "Cargo.toml" || f === "Cargo.lock" || f.startsWith(".cargo/") || f === "rust-toolchain.toml" || f === ".config/nextest.toml") flags.all = 1;
  if (f.startsWith("apps/client/")) flags.client = 1;
  if (/^crates\/fub-canvas-(core|wasm)\//.test(f)) flags.client = flags.canvaswasm = 1;
  if (f.startsWith("docs/") || /^[^/]+\.md$/.test(f)) flags.docs = 1;
  if (f.startsWith(".github/") || f.startsWith("scripts/")) flags.github = 1;
  if (f.startsWith("vendor/") || f.startsWith("tools/vendor-craft/")) flags.vendor = 1;
  const p = owner(f);
  if (p) touched.add(p.name);
}

const affected = new Set(touched);
const queue = [...touched];
while (queue.length) {
  const n = queue.pop();
  for (const u of users.get(n) ?? []) {
    if (!affected.has(u)) {
      affected.add(u);
      queue.push(u);
    }
  }
}

// I test che leggono un file del client (le porte di `host/ipc.ts` in
// `fub-app/tests/ipc_permissions.rs`, gli specchi TS dei tipi): il crate li
// nomina con il percorso sotto `apps/client/src/`. Un diff che tocca quel file
// fa girare i test di quel crate, non quelli di chi lo usa, perché il crate non
// cambia. Chi legge una cartella intera del client senza nominare il file non
// si vede: lo copre il ciclo completo.
const clientFiles = files
  .filter((f) => f.startsWith("apps/client/src/"))
  .map((f) => f.slice("apps/client/src/".length));
if (clientFiles.length) {
  const rsFiles = (dir) => {
    const out = [];
    const walk = (d) => {
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".rs")) out.push(full);
      }
    };
    for (const sub of ["src", "tests"]) walk(path.join(root, dir, sub));
    return out;
  };
  for (const p of pkgs) {
    if (p.dir === "" || affected.has(p.name)) continue;
    const reads = rsFiles(p.dir).some((file) => {
      const text = fs.readFileSync(file, "utf8");
      return clientFiles.some((c) => text.includes(`"${c}"`) || text.includes(`/${c}"`));
    });
    if (reads) affected.add(p.name);
  }
}

const tauri = pkgs.filter((p) => p.deps.some((d) => d.name === "tauri")).map((p) => p.name);

console.log(`crates=${[...affected].sort().join(" ")}`);
for (const [k, v] of Object.entries(flags)) console.log(`${k}=${v}`);
console.log(`tauri=${tauri.sort().join(" ")}`);
