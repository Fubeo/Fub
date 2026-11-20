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

/// Gli argomenti di primo livello fra `from` e `to`: le virgole dentro
/// parentesi, quadre, graffe o le angolari di un tipo generico
/// (`Gate<A, B>`) non contano. La `>` di `=>` non chiude niente, e le
/// angolari non scendono sotto zero (`a > b, c` sono due argomenti). Un `<`
/// di confronto (`a < b, c`) unisce due argomenti in uno: per la guardia è
/// un giro che non sa leggere, cioè un errore che si vede, mai un giro
/// saltato in silenzio. Il codice è già senza letterali.
function topLevelArguments(code, from, to) {
  const parts = [];
  let depth = 0;
  let angles = 0;
  let start = from;
  for (let index = from; index < to; index++) {
    const char = code[index];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === "<") angles++;
    else if (char === ">" && code[index - 1] !== "=") angles = Math.max(0, angles - 1);
    else if (char === "," && depth === 0 && angles === 0) {
      parts.push(code.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(code.slice(start, to));
  return parts.filter((part) => part.trim() !== "");
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*/;

/// Dove finisce lo spazio bianco da `index`.
function skipSpace(code, index) {
  while (index < code.length && /\s/.test(code[index])) index++;
  return index;
}

/// La prima `=>` (o `{`, per una `function`) fuori da parentesi, quadre e
/// angolari, a partire da `index`: salta il tipo di ritorno, che può
/// contenere frecce e graffe (`: Promise<() => void>`, `: { a: T }`).
function afterReturnType(code, index, stop) {
  let depth = 0;
  for (; index < code.length; index++) {
    const char = code[index];
    if (depth === 0 && stop === "=>" && code.startsWith("=>", index)) return index + 2;
    if (depth === 0 && stop === "{" && char === "{" && !/:\s*$/.test(code.slice(0, index))) return index + 1;
    if (char === "(" || char === "[" || char === "<" || (char === "{" && stop === "=>")) depth++;
    else if (char === ")" || char === "]" || (char === "}" && stop === "=>")) depth--;
    else if (char === ">" && code[index - 1] !== "=") depth--;
  }
  return -1;
}

/// La testa del corpo di un giro: dove comincia il corpo e il nome del
/// cancello, o `null` se il corpo non si sa leggere. Una freccia (con o senza
/// `async`, il parametro fra parentesi, nudo o assente) o un'espressione
/// `function`. Il cancello è il primo parametro quando è un nome, anche
/// tipato o con un valore di default (`(e: Gate<A, B>)`, `(e = id)`); un
/// parametro destrutturato (`({ signal })`) non ne dà uno, e allora ogni
/// `await` è un'attesa nascosta.
function readHead(argument) {
  let index = skipSpace(argument, 0);
  const asyncWord = /^async\b/.exec(argument.slice(index));
  if (asyncWord) index = skipSpace(argument, index + asyncWord[0].length);
  let stop = "=>";
  if (/^function\b/.test(argument.slice(index))) {
    stop = "{";
    index = skipSpace(argument, index + "function".length);
    if (argument[index] === "*") index = skipSpace(argument, index + 1);
    const name = IDENTIFIER.exec(argument.slice(index));
    if (name) index = skipSpace(argument, index + name[0].length);
    if (argument[index] !== "(") return null;
  }
  let parameters;
  if (argument[index] === "(") {
    const close = closingOf(argument, index);
    if (close >= argument.length) return null;
    parameters = argument.slice(index + 1, close);
    index = close + 1;
  } else {
    const name = IDENTIFIER.exec(argument.slice(index));
    if (name === null || stop !== "=>") return null;
    parameters = name[0];
    index += name[0].length;
  }
  const start = afterReturnType(argument, index, stop);
  // Fra i parametri e la freccia ci può stare solo un tipo di ritorno.
  if (start === -1 || !/^\s*(?::|=>|\{)/.test(argument.slice(index))) return null;
  const first = topLevelArguments(parameters, 0, parameters.length)[0] ?? "";
  const gate = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*(?:[:=]|$)/.exec(first);
  return { start, gate: gate ? gate[1] : null };
}

/// Le violazioni di un file e quanti giri ci ha letto.
///
/// Ogni chiamata `.last(` con un argomento solo è un giro (`Race.last` ne
/// prende uno, il corpo; un altro `last` con più argomenti non è un giro). Il
/// corpo deve essere scritto lì, come freccia o `function`: un nome o
/// un'espressione che la guardia non sa leggere (`race.last(run)`, con `run`
/// definita altrove) è una violazione, non un giro che sfugge in silenzio.
export function violations(text, relative) {
  const code = codeOnly(text);
  const found = [];
  let races = 0;
  for (const match of code.matchAll(/\.last\s*\(/g)) {
    const call = match.index + match[0].length - 1;
    const close = closingOf(code, call);
    const args = topLevelArguments(code, call + 1, close);
    if (args.length !== 1) continue;
    races++;
    const argument = code.slice(call + 1, close);
    const head = readHead(argument);
    const lineOf = (offset) => code.slice(0, offset).split("\n").length;
    if (head === null) {
      found.push(
        `${relative}:${lineOf(call)}: cannot read the body of this race (\`.last(${argument.trim()})\`); ` +
          "write it inline as an arrow or a `function` expression.",
      );
      continue;
    }
    const gate = head.gate;
    const start = call + 1 + head.start;
    const body = code.slice(start, close);
    for (const awaited of body.matchAll(/\bawait\b/g)) {
      const expression = awaitedExpression(body, awaited.index);
      if (gate !== null && new RegExp(`\\b${gate}\\b`).test(expression)) continue;
      found.push(
        gate === null
          ? `${relative}:${lineOf(start + awaited.index)}: an \`await\` inside a race whose body takes no gate.`
          : `${relative}:${lineOf(start + awaited.index)}: an \`await\` inside a race does not name \`${gate}\`.`,
      );
    }
    for (const caught of body.matchAll(/\}\s*catch\b/g)) {
      found.push(
        `${relative}:${lineOf(start + caught.index)}: a \`catch\` inside a race can swallow expiry; ` +
          `use \`await ${gate ?? "expected"}(promise.catch(…))\`.`,
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
    // La revisione #528: un corpo che la guardia non legge non deve sfuggire.
    ["il corpo definito altrove", "const run = async (e) => { await f(); };\nr.last(run);", 1, 1],
    ["il corpo preso da un oggetto", "r.last(this.#load.bind(this));", 1, 1],
    ["una async function", "r.last(async function (e) { await f(); });", 1, 1],
    ["una async function col cancello", "r.last(async function load(e: Expected) { await e(f()); });", 1, 0],
    ["una freccia senza cancello", "r.last(async () => { await f(); });", 1, 1],
    ["una freccia senza cancello né attese", "r.last(async () => 1);", 1, 0],
    ["una freccia non async col cancello", "r.last((expected) => expected(f()));", 1, 0],
    ["a capo dopo la parentesi", "r.last(\n  async (e) => {\n    await f();\n  },\n);", 1, 1],
    ["una regex dopo un if, prima del giro", "if (x) /\"/.test(s);\nr.last(async (e) => { await f(); });", 1, 1],
    // La seconda revisione #528: virgole nei tipi generici, teste con
    // destrutturazione, default, tipi con parentesi e graffe.
    ["una virgola in un generico del parametro", "r.last(async (e: Gate<A, B>) => { await f(); });", 1, 1],
    ["una virgola in un generico, col cancello", "r.last(async (e: Gate<A, B>) => { await e(f()); });", 1, 0],
    ["una virgola nel tipo di ritorno", "r.last(async (e): Promise<Map<K, V>> => { await f(); });", 1, 1],
    ["un parametro destrutturato", "r.last(async ({ signal }) => { await f(signal); });", 1, 1],
    ["un parametro destrutturato senza attese", "r.last(async ({ signal }) => signal);", 1, 0],
    ["un parametro con un default", "r.last(async (expected = id) => { await expected(f()); });", 1, 0],
    ["un default, attesa nascosta", "r.last(async (expected = id) => { await f(); });", 1, 1],
    ["un tipo con parentesi", "r.last(async (e: (p: Promise<T>) => Promise<T>) => { await e(f()); });", 1, 0],
    ["un tipo con graffe", "r.last(async (e: { (p: P): P }) => { await f(); });", 1, 1],
    ["una freccia nel tipo di ritorno", "r.last(async (e): Promise<() => void> => { await e(f()); });", 1, 0],
    ["una function col tipo di ritorno a graffe", "r.last(async function (e): Promise<{ a: T }> { await f(); });", 1, 1],
    ["un confronto, letto come un giro solo", "x.last(a < b, c);", 1, 1],
    ["un confronto all'altro verso, due argomenti", "x.last(a > b, c);", 0, 0],
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
