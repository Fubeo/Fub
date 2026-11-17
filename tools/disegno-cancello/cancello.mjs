#!/usr/bin/env node
// Il cancello del disegno (piano K5, T20): ogni disegno del corpus si apre nel
// motore, si modifica con tre gesti e si salva senza perdite visibili.
//
//   node tools/disegno-cancello/cancello.mjs [--dir DIR] [--release] [--latenze]
//
// Alterna i due lati finché il giro è chiuso: il motore scrive le operazioni
// (`crates/fub-disegno/tests/cancello.rs`, `scrivi`), il client le applica col
// motore della scena (`apps/client/src/editors/spatial/motore/cancello.test.ts`),
// e così tre volte, perché il ritorno dello spostamento si scrive sul testo
// che il client ha dato all'andata. Poi il motore dice da dove vengono i
// caratteri delle famiglie che Fub non ha (`caratteri`) e confronta le
// immagini (`confronta`). Stampa una tabella per file ed esce con 1 se un file
// non passa o un passo si ferma.
//
// La cartella di lavoro è `target/disegno-cancello` (svuotata a ogni giro), o
// DIR, che deve essere vuota o non esserci. `--release` compila le prove
// ottimizzate; `--latenze` misura in più anteprima, commit e reimport (A8),
// sempre ottimizzate, e scrive `latenze.json`. Il perché di ogni passo e le
// differenze ammesse: `tools/disegno-cancello/README.md`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const client = join(repo, "apps/client");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const predefinita = join(repo, "target/disegno-cancello");
const dir = resolve(value("--dir") ?? predefinita);
if (dir === predefinita) {
  rmSync(dir, { recursive: true, force: true });
} else if (existsSync(dir) && readdirSync(dir).length > 0) {
  console.error(`la cartella ${dir} non è vuota: il cancello ne vuole una sua`);
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

const env = { ...process.env, FUB_DISEGNO_CANCELLO: dir };
const release = flag("--release") ? ["--release"] : [];

/// Un passo: il comando, e che cosa dice se si ferma.
function passo(nome, comando, argomenti, cwd, { fallisce = true } = {}) {
  const inizio = Date.now();
  const r = spawnSync(comando, argomenti, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
  const ok = r.status === 0;
  console.log(`${ok ? "ok " : "NO "} ${nome} (${secondi} s)`);
  if (!ok && fallisce) {
    const coda = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-40).join("\n");
    console.error(coda || String(r.error ?? ""));
  }
  return ok;
}

const motore = (prova, extra = release) =>
  passo(`motore: ${prova}`, "cargo", ["test", ...extra, "-p", "fub-disegno", "--test", "cancello", "--", "--ignored", "--exact", prova, "--nocapture"], repo);
const lato = () => passo("client: applica", "npx", ["--no-install", "vitest", "run", "src/editors/spatial/motore/cancello.test.ts"], client);

let fermo = false;
for (let giro = 0; giro < 3 && !fermo; giro += 1) {
  fermo = !motore("scrivi") || !lato();
}
if (!fermo) fermo = !motore("caratteri");
const confrontato = !fermo && passo("motore: confronta", "cargo", ["test", ...release, "-p", "fub-disegno", "--test", "cancello", "--", "--ignored", "--exact", "confronta"], repo, { fallisce: false });
if (!fermo && flag("--latenze")) fermo = !motore("latenze", ["--release"]);

/// La tabella: una riga per gesto, il nome del file solo alla prima.
const tabella = join(dir, "tabella.tsv");
if (existsSync(tabella)) {
  const righe = readFileSync(tabella, "utf8").trim().split("\n").slice(1).map((r) => r.split("\t"));
  const larghi = [0, 1, 2].map((i) => Math.max(...righe.map((r) => r[i].length), ["file", "gesto", "esito"][i].length));
  const riga = (c) => `${c[0].padEnd(larghi[0])}  ${c[1].padEnd(larghi[1])}  ${c[2].padEnd(larghi[2])}  ${c[3]}`;
  console.log(`\n${riga(["file", "gesto", "esito", "nota"])}`);
  let ultimo = "";
  for (const r of righe) {
    console.log(riga([r[0] === ultimo ? "" : r[0], r[1], r[2], r[3] ?? ""]));
    ultimo = r[0];
  }
  const falliti = new Set(righe.filter((r) => r[2] === "NO").map((r) => r[0]));
  const file = new Set(righe.map((r) => r[0]));
  console.log(`\n${file.size - falliti.size} file su ${file.size} passano${falliti.size ? `; non passano: ${[...falliti].join(", ")}` : ""}`);
}
const caratteri = join(dir, "caratteri.tsv");
if (existsSync(caratteri)) console.log(`\nI caratteri delle famiglie che Fub non ha:\n${readFileSync(caratteri, "utf8").trim()}`);
if (existsSync(join(dir, "latenze.json"))) console.log(`\nLe latenze: ${join(dir, "latenze.json")}`);
console.log(`\nI file del giro: ${dir}`);

process.exit(!fermo && confrontato ? 0 : 1);
