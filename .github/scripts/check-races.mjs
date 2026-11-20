#!/usr/bin/env node
// Dentro un giro di una `Race` (`race.last(async (expected) => …)`, in
// `apps/client/src/ui/race.ts`) non si aspetta di nascosto: ogni `await` deve
// passare dal cancello ricevuto dal corpo, e un `catch` interno non deve poter
// ingoiare il segnale di scadenza.
//
// Il metodo si chiamava `ultimo`; dal passaggio ai nomi inglesi è `last`, e la
// guardia cercava ancora `.ultimo(`: non leggeva più nessun giro e diceva
// verde su tutti (audit del 20/11, P-24). Per questo ora conta i giri che
// legge, fallisce se non ne trova nessuno, e ha un'autoprova
// (`--self-test`) coi casi che le sfuggivano: il parametro tipato, quello
// senza parentesi, il corpo senza graffe, una graffa dentro una stringa.

import fs from "node:fs";
import path from "node:path";
import { codeOnly, selfTestCode } from "./ts-code.mjs";

const GATE = "apps/client/src/ui/race.ts";

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(candidate, found);
    } else if (/\.(?:ts|tsx|mts)$/.test(entry.name) && !/\.test\.(?:ts|tsx|mts)$/.test(entry.name)) {
      found.push(candidate);
    }
  }
  return found;
}

/// Dove si chiude la parentesi aperta in `opening`.
function closingOf(code, opening, open = "(", close = ")") {
  let depth = 0;
  for (let index = opening; index < code.length; index++) {
    if (code[index] === open) depth++;
    else if (code[index] === close) {
      depth--;
      if (depth === 0) return index;
    }
  }
  return code.length;
}

function awaitedExpression(body, awaitIndex) {
  const rest = body.slice(awaitIndex + "await".length);
  const opening = rest.indexOf("(");
  const newline = rest.indexOf("\n");
  if (opening === -1 || (newline !== -1 && newline < opening)) {
    return rest.slice(0, newline === -1 ? rest.length : newline);
  }
  return rest.slice(0, closingOf(rest, opening) + 1);
}

/// Un giro: `.last(` seguito da una funzione freccia, con o senza `async`, col
/// parametro fra parentesi (anche tipato) o nudo.
const OPENING = /\.last\(\s*(?:async\s+)?(?:\(\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)|([A-Za-z_$][\w$]*))\s*(?::[^=]*)?=>/g;

/// Le violazioni di un file e quanti giri ci ha letto.
export function violations(text, relative) {
  const code = codeOnly(text);
  const found = [];
  let races = 0;
  for (const match of code.matchAll(OPENING)) {
    races++;
    const gate = match[1] ?? match[2];
    const call = match.index + match[0].indexOf("(");
    const start = match.index + match[0].length;
    const body = code.slice(start, closingOf(code, call));
    const lineOf = (offset) => code.slice(0, start + offset).split("\n").length;
    for (const awaited of body.matchAll(/\bawait\b/g)) {
      const expression = awaitedExpression(body, awaited.index);
      if (new RegExp(`\\b${gate}\\b`).test(expression)) continue;
      found.push(`${relative}:${lineOf(awaited.index)}: an \`await\` inside a race does not name \`${gate}\`.`);
    }
    for (const caught of body.matchAll(/\}\s*catch\b/g)) {
      found.push(
        `${relative}:${lineOf(caught.index)}: a \`catch\` inside a race can swallow expiry; ` +
          `use \`await ${gate}(promise.catch(…))\`.`,
      );
    }
  }
  return { found, races };
}

function selfTest() {
  const cases = [
    // [descrizione, sorgente, giri attesi, violazioni attese]
    ["il cancello nominato", "r.last(async (expected) => { const a = await expected(f()); });", 1, 0],
    ["un'attesa nascosta", "r.last(async (expected) => { await f(); });", 1, 1],
    ["parametro tipato", "r.last(async (expected: Expected) => { await f(); });", 1, 1],
    ["parametro senza parentesi", "r.last(async expected => { await f(); });", 1, 1],
    ["corpo senza graffe", "void r.last(async (e) => use(await f()));", 1, 1],
    ["corpo senza graffe, col cancello", "void r.last(async (e) => use(await e(f())));", 1, 0],
    ["una graffa in una stringa", "r.last(async (e) => { log(\"}\"); await f(); });", 1, 1],
    ["un `await` in un commento", "r.last(async (e) => { // await f()\n return 1; });", 1, 0],
    ["un catch dentro il giro", "r.last(async (e) => { try { await e(f()); } catch { } });", 1, 1],
    ["il catch della promessa", "r.last(async (e) => { await e(f().catch(() => null)); });", 1, 0],
    ["un altro `last` non è un giro", "const t = this.last(items, p, true);", 0, 0],
    ["il nome di prima", "r.ultimo(async (e) => { await f(); });", 0, 0],
    // Un template con un segnaposto, o una regex con una virgoletta, scritti
    // prima del giro non devono far sparire il giro (un tokenizzatore che non
    // li segue ne perde tredici su trentanove in `apps/client/src`).
    ["dopo un template annidato", "const s = `a ${b ? `c${d}` : \"}\"} e`;\nr.last(async (e) => { await f(); });", 1, 1],
    ["dopo una regex con una virgoletta", "const q = /[\"'`]/g; x = a / b / c;\nr.last(async (e) => { await f(); });", 1, 1],
    ["una regex dopo return", "function g() { return /\"/.test(s); }\nr.last(async (e) => { await f(); });", 1, 1],
  ];
  const failures = [];
  try {
    selfTestCode();
  } catch (error) {
    failures.push(error.message);
  }
  for (const [label, source, races, count] of cases) {
    const result = violations(source, "caso.ts");
    if (result.races !== races || result.found.length !== count) {
      failures.push(`${label}: attesi ${races} giri e ${count} violazioni, trovati ${result.races} e ${result.found.length}`);
    }
  }
  if (failures.length) {
    console.error("Autoprova di check-races fallita:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Autoprova di check-races riuscita (${cases.length} casi).`);
}

// L'autoprova gira anche prima di ogni controllo vero: costa pochi
// millisecondi, e così la CI e `scripts/check.sh` la eseguono senza un passo
// in più.
selfTest();
if (process.argv.includes("--self-test")) process.exit(0);

const root = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? process.cwd();
const sourceRoot = path.join(root, "apps", "client", "src");
if (!fs.existsSync(sourceRoot)) {
  console.error(`cannot find ${sourceRoot}: pass the repo root as an argument.`);
  process.exit(2);
}

const all = [];
let races = 0;
for (const file of sourceFiles(sourceRoot)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative === GATE) continue;
  const result = violations(fs.readFileSync(file, "utf8"), relative);
  races += result.races;
  all.push(...result.found);
}

for (const violation of all) console.error(violation);
if (races === 0) {
  // Una guardia che non trova niente da guardare non è verde: il metodo ha
  // cambiato nome, o la cartella non è quella giusta.
  console.error("check-races: no race found; has `Race.last` been renamed?");
  process.exit(1);
}
console.log(
  all.length === 0
    ? `check-races: ${races} races, no one bypasses the gateway.`
    : `check-races: ${all.length} violations in ${races} races.`,
);
process.exit(all.length === 0 ? 0 : 1);
