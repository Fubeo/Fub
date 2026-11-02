#!/usr/bin/env node
// Due tetti sull'albero delle dipendenze di `fub-app`, cioè di ciò che si
// installa:
//
// - nessuna interfaccia di un'app Craft: i motori entrano dai loro crate di
//   dominio, mai con la loro finestra (`egui`, `eframe`, `winit` e compagni);
// - le librerie in due versioni possono solo calare: il tetto è
//   `librerie_doppie` in `docs/reference/budgets.json`.
//
//     node .github/scripts/check-motori.mjs                      # dalla radice
//     node .github/scripts/check-motori.mjs --self-test          # l'autoprova
//     node .github/scripts/check-motori.mjs --albero F --budgets B
//
// `--albero` legge l'uscita di `cargo tree --prefix depth` da un file invece di
// chiamare Cargo; `--budgets` legge un altro file di tetti. Servono alla prova.
//
// L'albero è uno solo, letto con `--prefix depth`: dà il pacchetto e chi lo
// tira dentro (la riga sopra di un livello), e le stesse librerie in due
// versioni di `cargo tree -d -e normal`. `--all-features --target all`: tutte
// le feature di `fub-app` compilano insieme, e il prodotto si installa su ogni
// sistema, quindi conta ogni piattaforma. Solo gli archi `normal`: una
// dipendenza di build o di sviluppo non arriva all'utente.
//
// Uscite: 0 dentro i tetti, 1 un tetto superato, 2 l'albero non si legge (un
// Cargo che fallisce non è «zero doppie»).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CARGO_TREE = ["tree", "-p", "fub-app", "-e", "normal", "--prefix", "depth", "--all-features", "--target", "all"];
const BUDGETS = "docs/reference/budgets.json";

// L'interfaccia delle app Craft. Si confrontano i nomi con `-` e `_` resi
// uguali: per crates.io sono lo stesso pacchetto.
const VIETATI = ["egui", "eframe", "egui-wgpu", "egui-winit", "winit", "rfd", "accesskit_winit"];

// Chi può portare un pacchetto vietato, e perché. `rfd` è anche la finestra di
// scelta dei file di sistema che il plugin dei dialoghi di Tauri usa per Fub:
// lì è la shell di Fub, non l'interfaccia di un motore.
const AMMESSI = {
  rfd: { da: ["tauri-plugin-dialog"], perché: "i dialoghi di sistema di Tauri" },
};

class Illeggibile extends Error {}

const normale = (name) => name.toLowerCase().replaceAll("_", "-");

/// Legge l'uscita di `cargo tree --prefix depth`: una riga per pacchetto,
/// `<profondità><nome> v<versione>[ (percorso)][ (proc-macro)][ (*)]`. `(*)`
/// vuol dire «già mostrato sopra»: la riga vale come arco, i figli sono altrove.
export function leggiAlbero(text) {
  const nodes = [];
  const stack = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const match = line.match(/^(\d+)(\S+) v(\S+)(?: .*)?$/);
    if (!match) throw new Illeggibile(`riga ${index + 1} di cargo tree non riconosciuta: «${line}»`);
    const depth = Number(match[1]);
    if (depth > stack.length) throw new Illeggibile(`riga ${index + 1} di cargo tree salta un livello: «${line}»`);
    const node = { name: match[2], key: normale(match[2]), version: match[3], parent: depth ? stack[depth - 1] : null };
    stack.length = depth;
    stack.push(node);
    nodes.push(node);
  });
  if (!nodes.length || nodes[0].parent !== null) throw new Illeggibile("cargo tree non ha dato nessun albero");
  return nodes;
}

const catena = (node) => {
  const names = [];
  for (let at = node; at; at = at.parent) names.unshift(at.name);
  return names.join(" → ");
};

export function interfaccia(nodes) {
  const vietati = new Set(VIETATI.map(normale));
  const male = [];
  const ammessi = new Set();
  const visti = new Set();
  for (const node of nodes) {
    if (!vietati.has(node.key)) continue;
    const eccezione = AMMESSI[node.key];
    if (eccezione && node.parent && eccezione.da.map(normale).includes(node.parent.key)) {
      ammessi.add(`${node.name} (${eccezione.perché})`);
      continue;
    }
    const riga = `${node.name} v${node.version}: ${catena(node)}`;
    if (!visti.has(riga)) male.push(riga);
    visti.add(riga);
  }
  return { male, ammessi: [...ammessi] };
}

export function doppie(nodes) {
  const versions = new Map();
  const names = new Map();
  for (const node of nodes) {
    if (!versions.has(node.key)) versions.set(node.key, new Set());
    versions.get(node.key).add(node.version);
    names.set(node.key, node.name);
  }
  return [...versions]
    .filter(([, set]) => set.size > 1)
    .map(([key, set]) => `${names.get(key)} ${[...set].sort((a, b) => a.localeCompare(b, "en", { numeric: true })).join(", ")}`)
    .sort();
}

export function tetto(text, file) {
  let value;
  try {
    value = JSON.parse(text).librerie_doppie;
  } catch (error) {
    throw new Illeggibile(`${file} non è JSON: ${error.message}`);
  }
  if (!Number.isInteger(value) || value < 0) throw new Illeggibile(`${file}: librerie_doppie deve essere un intero da 0 in su`);
  return value;
}

function selfTest() {
  const albero = [
    "0fub-app v0.1.0 (/repo/crates/fub-app)",
    "1tauri v2.11.5",
    "2bitflags v2.13.1",
    "2serde_derive v1.0.229 (proc-macro)",
    "1tauri-plugin-dialog v2.7.2",
    "2rfd v0.16.0",
    "3bitflags v1.3.2",
    "1fub-host v0.1.0 (/repo/crates/fub-host)",
    "2bitflags v2.13.1 (*)",
    "2fub-format-rich v0.1.0 (/repo/crates/fub-format-rich)",
    "3egui_winit v0.31.0",
    "4winit v0.30.0",
    "4accesskit-winit v0.23.0",
    "4rfd v0.15.0",
    "1tauri v2.11.5 (*)",
  ].join("\n");
  const nodes = leggiAlbero(albero);
  const { male, ammessi } = interfaccia(nodes);
  const attesi = [
    "egui_winit v0.31.0: fub-app → fub-host → fub-format-rich → egui_winit",
    "winit v0.30.0: fub-app → fub-host → fub-format-rich → egui_winit → winit",
    "accesskit-winit v0.23.0: fub-app → fub-host → fub-format-rich → egui_winit → accesskit-winit",
    "rfd v0.15.0: fub-app → fub-host → fub-format-rich → egui_winit → rfd",
  ];
  const fallite = [];
  if (male.join("\n") !== attesi.join("\n")) fallite.push(`vietati: ${JSON.stringify(male)}`);
  if (ammessi.length !== 1 || !ammessi[0].startsWith("rfd ")) fallite.push(`ammessi: ${JSON.stringify(ammessi)}`);
  // `bitflags` in due versioni conta una volta; la stessa versione ripetuta
  // (anche come `(*)`) non è un doppione.
  const due = doppie(nodes);
  if (due.join("|") !== "bitflags 1.3.2, 2.13.1|rfd 0.15.0, 0.16.0") fallite.push(`doppie: ${JSON.stringify(due)}`);
  if (interfaccia(leggiAlbero("0fub-app v0.1.0\n1tauri-plugin-dialog v2.7.2\n2rfd v0.16.0")).male.length) fallite.push("rfd dal plugin dei dialoghi");
  for (const [rotto, motivo] of [["", "albero vuoto"], ["fub-app v0.1.0", "senza profondità"], ["0fub-app v0.1.0\n2rfd v1.0.0", "livello saltato"]]) {
    try {
      leggiAlbero(rotto);
      fallite.push(`${motivo}: accettato`);
    } catch (error) {
      if (!(error instanceof Illeggibile)) throw error;
    }
  }
  for (const rotto of ['{"librerie_doppie": -1}', '{"librerie_doppie": "3"}', "{}", "non json"]) {
    try {
      tetto(rotto, "prova");
      fallite.push(`tetto ${rotto}: accettato`);
    } catch (error) {
      if (!(error instanceof Illeggibile)) throw error;
    }
  }
  if (fallite.length) {
    console.error(`Autoprova di check-motori fallita:\n- ${fallite.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Autoprova di check-motori riuscita.");
}

function argomento(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Illeggibile(`${name} vuole un file`);
  return value;
}

function cargoTree() {
  const result = spawnSync("cargo", CARGO_TREE, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Illeggibile(`cargo non parte: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Illeggibile(`cargo ${CARGO_TREE.join(" ")} è uscito con ${result.status}:\n${result.stderr.trim()}`);
  }
  return result.stdout;
}

function main() {
  const fileAlbero = argomento("--albero");
  const fileBudgets = argomento("--budgets") ?? BUDGETS;
  const nodes = leggiAlbero(fileAlbero ? fs.readFileSync(fileAlbero, "utf8") : cargoTree());
  const limite = tetto(fs.readFileSync(fileBudgets, "utf8"), fileBudgets);
  const { male, ammessi } = interfaccia(nodes);
  const due = doppie(nodes);

  let failed = false;
  if (male.length) {
    failed = true;
    console.error(
      `L'interfaccia di un'app Craft è entrata in fub-app (${male.length}):\n- ${male.join("\n- ")}\n` +
        "Un motore entra dai suoi crate di dominio, senza la sua finestra: togli la dipendenza o la feature che la porta.",
    );
  }
  if (due.length > limite) {
    failed = true;
    console.error(
      `${due.length} librerie in due versioni in fub-app, il tetto è ${limite} (${fileBudgets}):\n- ${due.join("\n- ")}\n` +
        "Il tetto può solo scendere: allinea la versione nuova a una che c'è già invece di alzarlo.",
    );
  }
  if (failed) process.exit(1);

  const nota = ammessi.length ? ` (ammessi: ${ammessi.join(", ")})` : "";
  console.log(`interfaccia delle app Craft in fub-app: ${male.length} pacchetti${nota}`);
  console.log(`librerie in due versioni in fub-app: ${due.length}, il tetto è ${limite}`);
  if (due.length < limite) {
    console.warn(`il tetto può scendere: abbassa librerie_doppie a ${due.length} in ${fileBudgets}.`);
  }
}

try {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
} catch (error) {
  if (!(error instanceof Illeggibile) && !(error?.code === "ENOENT")) throw error;
  console.error(`check-motori non riesce a misurare: ${error.message}`);
  process.exit(2);
}
