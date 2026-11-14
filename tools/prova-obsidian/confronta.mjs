#!/usr/bin/env node
// Confronta due copie di una lavagna `.canvas`, prima e dopo che un altro
// programma (Obsidian) l'ha riscritta, e dice che cosa è successo ai livelli
// d'inchiostro `fub:ink` (docs/reference/canvas-ink.md, sezione «Obsidian»).
//
// Uso: node tools/prova-obsidian/confronta.mjs <prima.canvas> <dopo.canvas>
//
// Codici d'uscita:
//   0  ogni livello c'è ancora ed è uguale per valore;
//   1  almeno un livello manca o è cambiato;
//   2  un file non si legge (non c'è, non è JSON, non è un oggetto) o mancano
//      gli argomenti.
//
// «Uguale per valore» vuol dire dopo JSON.parse, senza badare all'ordine delle
// chiavi: 640 e 640.0 sono lo stesso numero. Il BOM in testa si toglie prima di
// leggere. Si confrontano i livelli delle schede (per id), quello della radice
// e, come prova in più sui campi sconosciuti, i `fub:ink` degli archi.
//
// Solo `node:fs`: lo script si lancia a mano, senza installare niente.

import fs from "node:fs";

const KEY = "fub:ink";
const MAX_DIFFS = 20;

/** Un file che non si legge: esce con 2. */
export class Unreadable extends Error {}

/** Legge il testo di una lavagna: toglie il BOM e controlla la forma minima. */
export function parseCanvas(text, label) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let doc;
  try {
    doc = JSON.parse(clean);
  } catch (error) {
    throw new Unreadable(`${label}: non è JSON valido (${error.message})`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Unreadable(`${label}: la radice non è un oggetto JSON`);
  }
  return doc;
}

function readCanvas(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Unreadable(`${file}: non si legge (${error.code ?? error.message})`);
  }
  return parseCanvas(text, file);
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function show(value) {
  if (value === undefined) return "(niente)";
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function step(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return path ? `${path}.${key}` : key;
  return `${path}[${JSON.stringify(key)}]`;
}

/** Le differenze per valore fra due valori JSON, come righe «percorso: a → b». */
export function differences(before, after, path = "", out = []) {
  if (out.length > MAX_DIFFS) return out;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i += 1) {
      if (i >= after.length) out.push(`${step(path, i)}: tolto (era ${show(before[i])})`);
      else if (i >= before.length) out.push(`${step(path, i)}: aggiunto ${show(after[i])}`);
      else differences(before[i], after[i], step(path, i), out);
    }
    return out;
  }
  if (isObject(before) && isObject(after)) {
    for (const key of Object.keys(before)) {
      if (!has(after, key)) out.push(`${step(path, key)}: tolto (era ${show(before[key])})`);
      else differences(before[key], after[key], step(path, key), out);
    }
    for (const key of Object.keys(after)) {
      if (!has(before, key)) out.push(`${step(path, key)}: aggiunto ${show(after[key])}`);
    }
    return out;
  }
  if (!Object.is(before, after) && !(before === 0 && after === 0)) {
    out.push(`${path || "(il livello)"}: ${show(before)} → ${show(after)}`);
  }
  return out;
}

/** Vero se i due valori JSON sono uguali per valore, ordine delle chiavi a parte. */
export function sameValue(before, after) {
  return differences(before, after).length === 0;
}

/** Vero se il testo JSON tiene le chiavi nello stesso ordine (informativo). */
function sameKeyOrder(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

/**
 * Le voci di un array di schede o di archi, per id. Un id ripetuto (non valido
 * in JSON Canvas, ma possibile) si distingue con l'ordine in cui compare.
 */
function byId(list) {
  const entries = new Map();
  const seen = new Map();
  if (!Array.isArray(list)) return entries;
  for (const item of list) {
    if (!isObject(item) || typeof item.id !== "string") continue;
    const count = seen.get(item.id) ?? 0;
    seen.set(item.id, count + 1);
    entries.set(count === 0 ? item.id : `${item.id}#${count + 1}`, item);
  }
  return entries;
}

function geometry(before, after) {
  const notes = [];
  const num = (value) => (typeof value === "number" ? value : show(value));
  if (!sameValue(before.x, after.x) || !sameValue(before.y, after.y)) {
    notes.push(`spostata da ${num(before.x)},${num(before.y)} a ${num(after.x)},${num(after.y)}`);
  }
  if (!sameValue(before.width, after.width) || !sameValue(before.height, after.height)) {
    notes.push(
      `ridimensionata da ${num(before.width)} × ${num(before.height)} a ${num(after.width)} × ${num(after.height)}`,
    );
  }
  return notes;
}

/**
 * Confronta un livello. `owner` è la scheda, l'arco o la radice di prima,
 * `afterOwner` quella di dopo (undefined se è sparita).
 */
function compareLayer(name, owner, afterOwner, kind) {
  const result = { name, ok: false, lines: [] };
  const extra = kind === "node" && afterOwner ? geometry(owner, afterOwner) : [];
  const tail = extra.length ? ` · ${extra.join(" · ")}` : "";
  if (!afterOwner) {
    result.lines.push(`${name}: PERSO, ${kind === "edge" ? "l'arco" : "la scheda"} non c'è più`);
    return result;
  }
  if (!has(afterOwner, KEY)) {
    result.lines.push(`${name}: PERSO, il campo fub:ink non c'è più${tail}`);
    return result;
  }
  const diffs = differences(owner[KEY], afterOwner[KEY]);
  if (diffs.length === 0) {
    result.ok = true;
    const order = sameKeyOrder(owner[KEY], afterOwner[KEY]) ? "" : " (chiavi in un altro ordine)";
    result.lines.push(`${name}: c'è, uguale per valore${order}${tail}`);
    return result;
  }
  result.lines.push(`${name}: CAMBIATO${tail}`);
  for (const diff of diffs.slice(0, MAX_DIFFS)) result.lines.push(`    ${diff}`);
  if (diffs.length > MAX_DIFFS) result.lines.push("    ... e altre differenze");
  return result;
}

const label = (prefix, id, item) =>
  `${prefix} ${id}${typeof item?.type === "string" ? ` (${item.type})` : ""}`;

/**
 * Il confronto di due lavagne già lette. Restituisce le righe da stampare e il
 * codice d'uscita (0 o 1).
 */
export function compare(before, after) {
  const results = [];
  const beforeNodes = byId(before.nodes);
  const afterNodes = byId(after.nodes);
  for (const [id, node] of beforeNodes) {
    if (has(node, KEY)) results.push(compareLayer(label("scheda", id, node), node, afterNodes.get(id), "node"));
  }
  if (has(before, KEY)) results.push(compareLayer("radice", before, after, "board"));
  const beforeEdges = byId(before.edges);
  const afterEdges = byId(after.edges);
  for (const [id, edge] of beforeEdges) {
    if (has(edge, KEY)) results.push(compareLayer(`arco ${id}`, edge, afterEdges.get(id), "edge"));
  }

  const lines = [];
  for (const result of results) lines.push(...result.lines);

  const moved = [];
  for (const [id, node] of beforeNodes) {
    const next = afterNodes.get(id);
    if (next && !has(node, KEY)) {
      const notes = geometry(node, next);
      if (notes.length) moved.push(`${label("scheda", id, node)} senza livello: ${notes.join(" · ")}`);
    }
  }
  lines.push(...moved);

  const removed = [...beforeNodes.keys()].filter((id) => !afterNodes.has(id));
  if (removed.length) lines.push(`Schede tolte: ${removed.join(", ")}`);
  const added = [...afterNodes.entries()].filter(([id]) => !beforeNodes.has(id));
  if (added.length) lines.push(`Schede nuove: ${added.map(([id]) => id).join(", ")}`);
  const newLayers = added.filter(([, node]) => has(node, KEY)).map(([id]) => id);
  if (!has(before, KEY) && has(after, KEY)) newLayers.push("radice");
  if (newLayers.length) lines.push(`Livelli nuovi (non c'erano prima): ${newLayers.join(", ")}`);

  const lost = results.filter((result) => !result.ok).length;
  const code = lost === 0 ? 0 : 1;
  if (results.length === 0) {
    lines.push("Esito: il primo file non ha livelli fub:ink, non c'è niente da confrontare");
  } else if (code === 0) {
    lines.push(`Esito: tutti i livelli (${results.length}) ci sono e sono uguali per valore`);
  } else {
    lines.push(`Esito: livelli persi o cambiati: ${lost} su ${results.length}`);
  }
  return { lines, code };
}

function main(argv) {
  if (argv.length !== 2) {
    console.error("Uso: node tools/prova-obsidian/confronta.mjs <prima.canvas> <dopo.canvas>");
    return 2;
  }
  let before;
  let after;
  try {
    before = readCanvas(argv[0]);
    after = readCanvas(argv[1]);
  } catch (error) {
    if (error instanceof Unreadable) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  const { lines, code } = compare(before, after);
  console.log(`Prima: ${argv[0]}`);
  console.log(`Dopo:  ${argv[1]}`);
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && import.meta.filename === fs.realpathSync(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
