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
// Il giro di #509 ha chiuso le forme che passavano ancora: un `await` senza
// parentesi col cancello più avanti sulla stessa riga, il cancello passato
// come valore, un `.catch` attaccato al cancello, un `.then` fuori dal
// cancello, il giro con un tipo generico, il metodo staccato dalla corsa.
// Ciò che resta fuori, e perché, sta sopra `violations`.

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

const NAME = /^#?[A-Za-z_$][\w$]*/;

/// Gli argomenti di tipo di una chiamata (`<T>`, `<Map<K, V[]>>`), seguiti
/// dalla sua parentesi. Il codice è già senza letterali, e le parentesi tonde
/// non ci stanno: un confronto (`a < b && c(d)`) non lo è.
const TYPE_ARGUMENTS = String.raw`<[\w$\s,.<>[\]|&?]*>(?=\s*\()`;
const TYPE_CALL = new RegExp(`^${TYPE_ARGUMENTS}`);

/// Dove finisce l'espressione attesa che comincia in `from`: un primario (un
/// nome, un gruppo fra parentesi o quadre, un letterale già svuotato) e la
/// sua catena (`.a`, `?.a`, `(…)`, `[…]`, `!`), anche spezzata a capo da
/// Prettier, con gli argomenti di tipo di una chiamata (`e<T>(p)`). Non legge
/// gli operatori binari: `await a + b` attende `a`, come in JavaScript.
///
/// Prima leggeva fino alla prima parentesi chiusa o, senza parentesi, fino a
/// fine riga: `const a = await p; await e(q);` passava, perché `e` stava
/// sulla stessa riga del primo `await` (#509).
function awaitedEnd(code, from) {
  let index = skipSpace(code, from);
  for (let word; (word = /^(?:await|new|void|typeof)\b/.exec(code.slice(index))); ) {
    index = skipSpace(code, index + word[0].length);
  }
  const char = code[index];
  if (char === "(") index = closingOf(code, index) + 1;
  else if (char === "[") index = closingOf(code, index, "[", "]") + 1;
  else if (char === '"' || char === "'" || char === "`") {
    const end = code.indexOf(char, index + 1);
    index = end === -1 ? code.length : end + 1;
  } else {
    const name = NAME.exec(code.slice(index));
    if (name === null) return index;
    index += name[0].length;
  }
  for (;;) {
    const next = skipSpace(code, index);
    const typed = TYPE_CALL.exec(code.slice(next));
    if (typed) index = next + typed[0].length;
    else if (code[next] === "(") index = closingOf(code, next) + 1;
    else if (code[next] === "[") index = closingOf(code, next, "[", "]") + 1;
    else if (code[next] === "!" && code[next + 1] !== "=") index = next + 1;
    else if (code.startsWith("?.", next) || (code[next] === "." && code[next + 1] !== ".")) {
      const after = skipSpace(code, next + (code[next] === "?" ? 2 : 1));
      if (code[after] === "(" || code[after] === "[") index = after;
      else {
        const name = NAME.exec(code.slice(after));
        if (name === null) return index;
        index = after + name[0].length;
      }
    } else return index;
  }
}

/// `gate` chiamato come cancello (`gate(…)`, `gate?.(…)`, `gate<T>(…)`), non
/// nominato come valore (`f(gate)`) né come proprietà di qualcos'altro
/// (`this.gate(…)`).
function gateCallPattern(gate, flags = "g") {
  return new RegExp(
    `(?<![\\w$.#])${gate.replace(/\$/g, "\\$")}\\s*(?:\\?\\.\\s*)?(?:${TYPE_ARGUMENTS}\\s*)?\\(`,
    flags,
  );
}

/// Vero se l'espressione attesa è una chiamata del cancello, con al più la
/// sua catena dopo (`gate(p).then(…)`): il cancello è la chiamata più
/// esterna. Prima bastava che comparisse in un punto qualsiasi, e
/// `await save(e(p))` passava con `save` fuori dal cancello (revisione di
/// GUARDIE-1).
function awaitsGate(expression, gate) {
  const head = expression.replace(/^\s*(?:(?:await|void)\b\s*)*/, "");
  return gateCallPattern(gate, "").exec(head)?.index === 0;
}

/// I metodi di una promessa che le appendono un callback.
const CALLBACK = /(?:\?\.|\.)\s*(then|catch|finally)\s*\(/g;

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
/// Ogni chiamata `.last(` (anche `.last<T>(`) con un argomento solo è un giro
/// (`Race.last` ne prende uno, il corpo; un altro `last` con più argomenti
/// non è un giro). Il corpo deve essere scritto lì, come freccia o
/// `function`: un nome o un'espressione che la guardia non sa leggere
/// (`race.last(run)`, con `run` definita altrove) è una violazione, non un
/// giro che sfugge in silenzio; così il metodo staccato dal suo oggetto
/// (`race.last.bind(race)`).
///
/// Nel corpo:
/// - ogni `await` attende una chiamata del cancello (`await expected(p)`,
///   anche con la sua catena dopo); nominarlo come valore
///   (`await f(expected)`) o chiamarlo dentro un'altra chiamata
///   (`await save(expected(p))`, `await Promise.all([expected(a()), b()])`)
///   non basta, perché la chiamata di fuori può aspettare quello che vuole;
/// - nessun `try … catch`, e nessun `.catch`, `.finally` o `.then(ok, ko)`
///   attaccato a una chiamata del cancello: ingoierebbero la scadenza;
/// - nessun `.then`, `.catch` o `.finally` fuori dal cancello: il loro
///   callback corre anche a giro scaduto. Dentro l'argomento del cancello
///   (`expected(p.then(trasforma))`) si può, e il callback deve solo dare
///   forma al valore: anche lui corre a giro scaduto, e la guardia non lo
///   distingue da uno che scrive.
///
/// Limiti noti, che senza un parser vero non si chiudono: un cancello
/// passato a una funzione (`hydrate(…, expected)`) porta le attese di quella
/// funzione fuori dalla guardia; un cancello rinominato in un nome locale
/// (`const g = expected`) dà una violazione anche quando è giusto; un nome
/// interno che copre il cancello (`const expected = (p) => p`) passa;
/// `race["last"](…)` e `const { last } = race` non si vedono; un cancello
/// che arriva da una funzione (`const g = makeGate(expected)`) non è
/// riconosciuto come cancello, e il corpo che lo usa dà una violazione anche
/// quando è giusto.
export function violations(text, relative) {
  const code = codeOnly(text);
  const found = [];
  let races = 0;
  const lineOf = (offset) => code.slice(0, offset).split("\n").length;
  for (const match of code.matchAll(/\.last\s*\.\s*(?:bind|call|apply)\s*\(/g)) {
    races++;
    found.push(
      `${relative}:${lineOf(match.index)}: \`.last\` taken off its race (\`${match[0].replace(/\s+/g, "")}…\`); ` +
        "call `race.last(…)` with the body inline.",
    );
  }
  for (const match of code.matchAll(/\.last\s*(?:<[\w$\s,.<>[\]]*>)?\s*\(/g)) {
    const call = match.index + match[0].length - 1;
    const close = closingOf(code, call);
    const args = topLevelArguments(code, call + 1, close);
    if (args.length !== 1) continue;
    races++;
    const argument = code.slice(call + 1, close);
    const head = readHead(argument);
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
    const at = (offset) => `${relative}:${lineOf(start + offset)}`;
    // Le chiamate del cancello: dentro i loro argomenti un callback si può.
    const calls = gate === null
      ? []
      : [...body.matchAll(gateCallPattern(gate))].map((call) => {
          const open = call.index + call[0].length - 1;
          return { open, close: closingOf(body, open) };
        });
    const insideGate = (offset) => calls.some((call) => offset > call.open && offset < call.close);
    for (const awaited of body.matchAll(/\bawait\b/g)) {
      const from = awaited.index + "await".length;
      const expression = body.slice(from, awaitedEnd(body, from));
      if (gate !== null && awaitsGate(expression, gate)) continue;
      found.push(
        gate === null
          ? `${at(awaited.index)}: an \`await\` inside a race whose body takes no gate.`
          : `${at(awaited.index)}: an \`await\` inside a race does not go through \`${gate}(…)\`.`,
      );
    }
    for (const caught of body.matchAll(/\}\s*catch\b/g)) {
      found.push(
        `${at(caught.index)}: a \`catch\` inside a race can swallow expiry; ` +
          `use \`await ${gate ?? "expected"}(promise.catch(…))\`.`,
      );
    }
    // La catena che segue una chiamata del cancello.
    const chained = new Set();
    for (const call of calls) {
      let index = call.close + 1;
      for (;;) {
        const link = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*(\()?/.exec(body.slice(index));
        if (link === null) break;
        const linkAt = index + link[0].search(/\S/);
        chained.add(linkAt);
        const open = index + link[0].length - 1;
        const end = link[2] ? closingOf(body, open) : open;
        const method = link[1];
        const swallows = method === "catch" || method === "finally" ||
          (method === "then" && topLevelArguments(body, open + 1, end).length > 1);
        if (link[2] && swallows && !insideGate(linkAt)) {
          found.push(
            `${at(linkAt)}: a \`.${method}\` after \`${gate}(…)\` runs even when the race has expired; ` +
              `put it inside: \`${gate}(promise.${method}(…))\`.`,
          );
        }
        index = link[2] ? end + 1 : index + link[0].length;
      }
    }
    for (const callback of body.matchAll(CALLBACK)) {
      if (chained.has(callback.index) || insideGate(callback.index)) continue;
      found.push(
        `${at(callback.index)}: a \`.${callback[1]}\` inside a race runs its callback even after the race has expired; ` +
          `await it through \`${gate ?? "expected"}(…)\`.`,
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
    // Il giro di #509: forme che la guardia di prima lasciava passare.
    ["un'attesa senza parentesi col cancello sulla riga (sfuggiva)", "r.last(async (e) => { const a = await p; await e(f(a)); });", 1, 1],
    ["un'attesa senza parentesi e il cancello dopo (sfuggiva)", "r.last(async (e) => { const a = await p, g = e; });", 1, 1],
    ["il cancello passato come valore (sfuggiva)", "r.last(async (e) => { await load(e); });", 1, 1],
    ["il cancello di un altro oggetto (sfuggiva)", "r.last(async (e) => { await this.e(f()); });", 1, 1],
    ["un .catch dopo il cancello (sfuggiva)", "r.last(async (e) => { const v = await e(f()).catch(() => null); });", 1, 1],
    ["un .catch dopo il cancello, a capo (sfuggiva)", "r.last(async (e) => {\n  const v = await e(f())\n    .catch(() => null);\n});", 1, 1],
    ["un .then a due rami dopo il cancello (sfuggiva)", "r.last((e) => e(f()).then(ok, ko));", 1, 1],
    ["un .finally dopo il cancello (sfuggiva)", "r.last((e) => e(f()).finally(done));", 1, 1],
    ["un .then a un ramo dopo il cancello", "r.last((e) => e(f()).then(show));", 1, 0],
    ["un .then fuori dal cancello (sfuggiva)", "r.last(async (e) => { f().then((v) => { state = v; }); });", 1, 1],
    ["un .then nel cancello", "r.last(async (e) => { const v = await e(f().then((x) => x.items)); });", 1, 0],
    ["un'attesa nel callback del cancello", "r.last(async (e) => { await e(Promise.all(xs.map(async (x) => { await e(g(x)); }))); });", 1, 0],
    // La revisione di GUARDIE-1: il cancello deve essere la chiamata più
    // esterna dell'attesa, non un pezzo qualsiasi dell'espressione.
    ["il cancello dentro un'altra chiamata (sfuggiva)", "r.last(async (e) => { await save(e(p)); });", 1, 1],
    ["Promise.all attorno ai cancelli (sfuggiva)", "r.last(async (e) => { await Promise.all([e(a()), b()]); });", 1, 1],
    ["il cancello con la catena dopo", "r.last(async (e) => { const v = await e(f()).then(show); });", 1, 0],
    ["il cancello opzionale", "r.last(async (e) => { const v = await e?.(f()); });", 1, 0],
    ["il cancello con un argomento di tipo (falso rosso)", "r.last(async (e) => { const v = await e<T>(p); });", 1, 0],
    ["il cancello con un tipo annidato (falso rosso)", "r.last(async (e) => { const v = await e<Map<K, V[]>>(p); });", 1, 0],
    ["un'altra chiamata con un argomento di tipo", "r.last(async (e) => { const v = await f<T>(p); });", 1, 1],
    ["il giro con un tipo generico (sfuggiva)", "r.last<Item[]>(async (e) => { await f(); });", 1, 1],
    ["il giro con un generico annidato (sfuggiva)", "r.last<Map<K, V>>(async (e) => { await f(); });", 1, 1],
    ["un confronto con last non è un giro", "if (x.last < y && z(w)) go();", 0, 0],
    ["il metodo staccato dalla corsa (sfuggiva)", "const go = race.last.bind(race);\ngo(async (e) => { await f(); });", 1, 1],
    ["un'attesa a capo del cancello", "r.last(async (e) => {\n  const v = await e(\n    f(),\n  );\n});", 1, 0],
    ["un'attesa di un await", "r.last(async (e) => { const v = await await e(f()); });", 1, 0],
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
