// Le prove di confronta.mjs. Si lanciano a mano, non stanno nella CI:
//   node --test tools/prova-obsidian/confronta.test.mjs
// I file temporanei stanno sotto os.tmpdir() e si tolgono alla fine.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const script = path.join(here, "confronta.mjs");
const board = path.join(here, "lavagna-di-prova.canvas");
const boardText = fs.readFileSync(board, "utf8");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prova-obsidian-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

let counter = 0;
function write(text) {
  counter += 1;
  const file = path.join(dir, `lavagna-${counter}.canvas`);
  fs.writeFileSync(file, text);
  return file;
}

function run(before, afterFile) {
  const out = spawnSync(process.execPath, [script, before, afterFile], { encoding: "utf8" });
  return { code: out.status, stdout: out.stdout, stderr: out.stderr };
}

/** La lavagna di prova, cambiata da `edit` sul valore letto. */
function edited(edit) {
  const doc = JSON.parse(boardText);
  edit(doc);
  return write(JSON.stringify(doc, null, "\t"));
}

const node = (doc, id) => doc.nodes.find((item) => item.id === id);

test("la lavagna di prova ha i livelli che il kit promette", () => {
  const doc = JSON.parse(boardText);
  const types = new Set(doc.nodes.filter((item) => item["fub:ink"]?.v === 1).map((item) => item.type));
  for (const type of ["text", "file", "group"]) assert.ok(types.has(type), `manca un livello valido su ${type}`);
  assert.equal(doc["fub:ink"].v, 1, "manca il livello della radice");
  assert.ok(doc.nodes.some((item) => item["fub:ink"]?.v === 2), "manca il livello estraneo con v 2");
  assert.ok(doc.edges.some((edge) => edge["fub:ink"]), "manca il fub:ink su un arco");
  const known = new Set(["id", "tool", "at", "brush", "color", "anchor", "ink"]);
  const strokes = doc.nodes.flatMap((item) => (item["fub:ink"]?.v === 1 ? item["fub:ink"].strokes : []));
  assert.ok(strokes.some((stroke) => Object.keys(stroke).some((key) => !known.has(key))), "manca un campo sconosciuto in un tratto");
  for (const item of doc.nodes.filter((entry) => entry["fub:ink"]?.v === 1)) {
    const ids = item["fub:ink"].strokes.map((stroke) => stroke.id);
    assert.equal(new Set(ids).size, ids.length, `id ripetuti nel livello di ${item.id}`);
    for (const stroke of item["fub:ink"].strokes) assert.equal(stroke.anchor.kind, "card", `${item.id}/${stroke.id}`);
  }
  for (const stroke of doc["fub:ink"].strokes) assert.equal(stroke.anchor.kind, "free");
});

test("la lavagna di prova contro se stessa esce con 0", () => {
  const result = run(board, board);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tutti i livelli \(8\) ci sono e sono uguali per valore/);
});

test("file uguali: 0", () => {
  const result = run(write(boardText), write(boardText));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /scheda f1 \(file\): c'è, uguale per valore\n/);
  assert.match(result.stdout, /radice: c'è, uguale per valore\n/);
});

test("chiavi riordinate, 640 scritto 640.0, tab e BOM: uguale per valore, 0", () => {
  const doc = JSON.parse(boardText);
  const reversed = (value) => {
    if (Array.isArray(value)) return value.map(reversed);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)]));
    }
    return value;
  };
  const text = JSON.stringify(reversed(doc), null, "\t").replace(/"width": 640\b/g, '"width": 640.0');
  assert.match(text, /640\.0/);
  const result = run(board, write(`﻿${text}`));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /uguale per valore \(chiavi in un altro ordine\)/);
});

test("il BOM nel primo file non conta", () => {
  const result = run(write(`﻿${boardText}`), board);
  assert.equal(result.code, 0, result.stdout + result.stderr);
});

test("livello perso: 1", () => {
  const result = run(board, edited((doc) => delete node(doc, "f1")["fub:ink"]));
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /scheda f1 \(file\): PERSO, il campo fub:ink non c'è più/);
  assert.match(result.stdout, /Esito: livelli persi o cambiati: 1 su 8/);
});

test("livello perso solo dalla scheda spostata: 1, e dice dove", () => {
  const result = run(board, edited((doc) => {
    const moved = node(doc, "n4");
    moved.x += 120;
    delete moved["fub:ink"];
  }));
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /scheda n4 \(text\): PERSO, il campo fub:ink non c'è più · spostata da 1400,500 a 1520,500/);
  assert.match(result.stdout, /scheda g1 \(group\): c'è, uguale per valore\n/);
});

test("livello della radice perso: 1", () => {
  const result = run(board, edited((doc) => delete doc["fub:ink"]));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /radice: PERSO/);
});

test("fub:ink dell'arco perso: 1", () => {
  const result = run(board, edited((doc) => delete doc.edges[0]["fub:ink"]));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /arco e1: PERSO/);
});

test("livello cambiato: 1, con il percorso della differenza", () => {
  const result = run(board, edited((doc) => {
    const layer = node(doc, "f1")["fub:ink"];
    layer.strokes[0].anchor.width = 641;
    delete layer.strokes[0].at;
  }));
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /scheda f1 \(file\): CAMBIATO/);
  assert.match(result.stdout, /strokes\[0\]\.anchor\.width: 640 → 641/);
  assert.match(result.stdout, /strokes\[0\]\.at: tolto/);
});

test("campo sconosciuto tolto da un tratto: 1", () => {
  const result = run(board, edited((doc) => delete node(doc, "n4")["fub:ink"].strokes[0].pressureCurve));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /strokes\[0\]\.pressureCurve: tolto/);
});

test("livello estraneo cambiato: 1", () => {
  const result = run(board, edited((doc) => { node(doc, "n5")["fub:ink"].v = 1; }));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /scheda n5 \(text\): CAMBIATO\n {4}v: 2 → 1/);
});

test("scheda spostata e un'altra ridimensionata col livello intatto: 0, e lo dice", () => {
  const result = run(board, edited((doc) => {
    node(doc, "n4").x = 1500;
    node(doc, "n4").y = 650;
    node(doc, "n3").width = 520;
    node(doc, "n3").height = 360;
  }));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /scheda n4 \(text\): c'è, uguale per valore · spostata da 1400,500 a 1500,650/);
  assert.match(result.stdout, /scheda n3 \(text\): c'è, uguale per valore · ridimensionata da 400 × 300 a 520 × 360/);
});

test("scheda tolta: 1, e la nomina", () => {
  const result = run(board, edited((doc) => {
    doc.nodes = doc.nodes.filter((item) => item.id !== "t1");
  }));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /scheda t1 \(text\): PERSO, la scheda non c'è più/);
  assert.match(result.stdout, /Schede tolte: t1/);
});

test("file che non c'è: 2", () => {
  const result = run(board, path.join(dir, "non-esiste.canvas"));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /non si legge \(ENOENT\)/);
});

test("file che non è JSON: 2", () => {
  const result = run(write("{ \"nodes\": [ "), board);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /non è JSON valido/);
});

test("file con la radice che non è un oggetto: 2", () => {
  const result = run(board, write("[]"));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /la radice non è un oggetto JSON/);
});

test("argomenti sbagliati: 2", () => {
  const out = spawnSync(process.execPath, [script, board], { encoding: "utf8" });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /^Uso:/);
});
