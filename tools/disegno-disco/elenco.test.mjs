// Prove della guardia del disco del motore del disegno (`elenco.mjs`):
//   node --test tools/disegno-disco/elenco.test.mjs
//
// La prova grande copia i crate del motore che Fub compila in una cartella
// temporanea, aggiunge un sito che tocca il disco e controlla che `--check`
// cada nominandolo. Le altre provano le regole su righe scritte qui.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VECTORCRAFT, DISCO, MAPPA, COLONNE, crateCompilati, siti, controlla, leggiElenco, scriviElenco, comandiDi } from "./elenco.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "elenco.mjs");

function check(...opzioni) {
  return spawnSync(process.execPath, [SCRIPT, "--check", ...opzioni], { encoding: "utf8" });
}

/// Una copia dei crate compilati (manifest e `src/`) e di `upstream.lock`.
function copiaDelMotore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disegno-disco-"));
  fs.copyFileSync(path.join(VECTORCRAFT, "upstream.lock"), path.join(dir, "upstream.lock"));
  for (const c of crateCompilati()) {
    const da = path.join(VECTORCRAFT, "crates", c);
    const a = path.join(dir, "crates", c);
    fs.mkdirSync(a, { recursive: true });
    fs.copyFileSync(path.join(da, "Cargo.toml"), path.join(a, "Cargo.toml"));
    fs.cpSync(path.join(da, "src"), path.join(a, "src"), { recursive: true });
  }
  return dir;
}

test("l'elenco del repository copre ogni sito del motore", () => {
  const r = check();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /siti del motore, ognuno con la sua riga/);
});

test("un sito aggiunto in una copia del motore fa cadere --check, nominandolo", (t) => {
  const dir = copiaDelMotore();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // La copia senza cambi passa con l'elenco vero.
  assert.equal(check("--vectorcraft", dir).status, 0);
  const lib = path.join(dir, "crates", "engine", "src", "lib.rs");
  fs.appendFileSync(lib, '\npub fn sbircia_il_disco() -> Vec<u8> {\n    std::fs::read("/etc/hostname").unwrap_or_default()\n}\n');
  const r = check("--vectorcraft", dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sito nuovo, senza riga: crates\/engine\/src\/lib\.rs · sbircia_il_disco · std::fs/);
});

test("un sito dietro #[cfg(test)] non conta", () => {
  const r = siti("#[cfg(test)]\nmod prove {\n  fn a() { std::fs::read(\"x\"); }\n}\nfn b() {}\n");
  assert.deepEqual(r.siti, []);
});

// --- le regole su righe scritte qui ----------------------------------------------

const REV = "0".repeat(40);
const IDS = new Set(["document.save", "color.loadProfile", "text.addFontFiles"]);

function sito(funzione, extra = {}) {
  return { file: "crates/engine/src/x.rs", funzione, primitiva: "std::fs", righe: [1], spento: false, libero: false, ...extra };
}

function riga(funzione, campi) {
  return { file: "crates/engine/src/x.rs", funzione, primitiva: "std::fs", comandi: "—", come: "nessuno", task: "", nota: "perché", ...campi };
}

function problemi(siti, righe) {
  const elenco = leggiElenco(scriviElenco(REV, righe));
  return controlla({ siti, sconosciute: [] }, elenco, IDS);
}

test("le righe giuste passano", () => {
  assert.deepEqual(
    problemi(
      [sito("a"), sito("b"), sito("c", { spento: true }), sito("d")],
      [
        riga("a", { comandi: "document.save", come: "fub" }),
        riga("b", { comandi: "color.loadProfile", come: "kernel", task: "T14" }),
        riga("c", { come: "spento", nota: "" }),
        riga("d", { comandi: "text.addFontFiles", come: "escluso", nota: "D12" }),
      ],
    ),
    [],
  );
});

test("un id che non è nella mappa cade", () => {
  const p = problemi([sito("a")], [riga("a", { comandi: "file.inventato", come: "rifiutato" })]);
  assert.equal(p.length, 1);
  assert.match(p[0], /«file\.inventato» non è una riga della mappa/);
});

test("un valore di come non ammesso cade", () => {
  const p = problemi([sito("a")], [riga("a", { come: "forse" })]);
  assert.match(p.join("\n"), /come «forse» non è fra/);
});

test("kernel e byte vogliono il task, escluso vuole D6, D9 o D12", () => {
  const p = problemi(
    [sito("a"), sito("b"), sito("c")],
    [
      riga("a", { comandi: "color.loadProfile", come: "kernel" }),
      riga("b", { comandi: "color.loadProfile", come: "byte" }),
      riga("c", { comandi: "text.addFontFiles", come: "escluso", nota: "non serve" }),
    ],
  ).join("\n");
  assert.match(p, /una riga kernel vuole il suo task/);
  assert.match(p, /una riga byte vuole il suo task/);
  assert.match(p, /una riga esclusa dice il perché con D6, D9 o D12/);
});

test("un sito dentro unconfined non è «rifiutato»", () => {
  const p = problemi([sito("a", { libero: true })], [riga("a", { comandi: "document.save", come: "rifiutato" })]);
  assert.match(p.join("\n"), /sta dentro unconfined/);
});

test("ambiente e nessuno non nominano comandi e dicono perché", () => {
  const p = problemi(
    [sito("a"), sito("b")],
    [riga("a", { come: "ambiente", comandi: "document.save" }), riga("b", { come: "nessuno", nota: "" })],
  ).join("\n");
  assert.match(p, /una riga ambiente non nomina comandi/);
  assert.match(p, /una riga nessuno dice perché nella nota/);
});

test("spento solo dietro una feature spenta, e viceversa", () => {
  const p = problemi(
    [sito("a"), sito("b", { spento: true })],
    [riga("a", { come: "spento" }), riga("b", { come: "nessuno" })],
  ).join("\n");
  assert.match(p, /«spento», ma non sta dietro una feature spenta/);
  assert.match(p, /sta dietro una feature spenta, è «spento»/);
});

test("righe doppie, sparite e siti senza riga cadono", () => {
  const p = problemi([sito("a"), sito("nuovo")], [riga("a"), riga("a"), riga("vecchio")]).join("\n");
  assert.match(p, /doppia/);
  assert.match(p, /x\.rs · vecchio · std::fs\): il sito non c'è più nel motore/);
  assert.match(p, /sito nuovo, senza riga: crates\/engine\/src\/x\.rs · nuovo · std::fs/);
});

test("comandiDi legge «—», le virgole e la forma", () => {
  assert.deepEqual(comandiDi("—"), []);
  assert.deepEqual(comandiDi("a.b, c.d:path"), [
    { id: "a.b", argomento: null },
    { id: "c.d", argomento: "path" },
  ]);
});

test("i file dell'elenco e della mappa esistono con le colonne giuste", () => {
  const testo = fs.readFileSync(DISCO, "utf8");
  assert.equal(testo.split("\n")[1], COLONNE.join("\t"));
  assert.ok(fs.existsSync(MAPPA));
});
