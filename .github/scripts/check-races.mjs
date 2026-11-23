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
// GUARDIA-CANCELLO ha aggiunto le funzioni che ricevono il cancello (un
// parametro `Expected` di `ui/race`): la guardia non ne leggeva il corpo, e
// da lì passavano il falso «ricerca non riuscita» del blocco query e
// l'«immagine mancante» dei media di una resa smontata.
// CANCELLO-DISEGNO ha chiuso i due limiti che restavano scritti come zone
// cieche: un alias del tipo (`type Gate = Expected`) e un oggetto di opzioni
// col tipo scritto altrove (`interface Opzioni { gate: Expected }`). Nel
// codice non c'erano; ora il tipo del cancello si può nominare solo nei
// parametri (e negli import coi nomi), e ogni altro posto è una violazione:
// l'alias non nasce in silenzio.
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

/// Dove si apre la graffa chiusa in `closing`, o -1.
function openingOf(code, closing) {
  let depth = 0;
  for (let index = closing; index >= 0; index--) {
    if (code[index] === "}") depth++;
    else if (code[index] === "{") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
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

/// Le violazioni nel corpo di un giro (`where` è `"a race"`) o di una
/// funzione che riceve il cancello: `gate` è il nome del cancello, `null` se
/// il corpo non ne prende uno; `at` dà il file e la riga di una posizione del
/// corpo. Le regole sono sopra `violations`.
function bodyViolations(body, gate, at, where) {
  const found = [];
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
        ? `${at(awaited.index)}: an \`await\` inside ${where} whose body takes no gate.`
        : `${at(awaited.index)}: an \`await\` inside ${where} does not go through \`${gate}(…)\`.`,
    );
  }
  for (const caught of body.matchAll(/\}\s*catch\b/g)) {
    // Il segnale di scadenza è il rigetto del cancello, e arriva solo a un
    // `await`: un `try` che non ne ha (`try { options.transclude(…) }`) non
    // lo può prendere. Un `await` dentro una funzione annidata nel `try`
    // conta lo stesso: la guardia non distingue, e sbaglia dal lato sicuro.
    const opening = openingOf(body, caught.index);
    if (/\btry\s*$/.test(body.slice(0, opening)) && !/\bawait\b/.test(body.slice(opening, caught.index))) continue;
    found.push(
      `${at(caught.index)}: a \`catch\` inside ${where} can swallow expiry; ` +
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
      `${at(callback.index)}: a \`.${callback[1]}\` inside ${where} runs its callback even after the race has expired; ` +
        `await it through \`${gate ?? "expected"}(…)\`.`,
    );
  }
  return found;
}

/// I nomi locali del tipo `Expected` importato dal modulo del cancello
/// (`import type { Expected } from "../ui/race"`, anche `Expected as Gate`
/// o dentro un import di valori: `{ Race, type Expected }`). Si legge dal
/// testo vero, perché il codice senza letterali non ha più il percorso. Un
/// `Expected` che viene da un altro modulo è un altro tipo, e le sue
/// funzioni non ricevono il cancello.
function gateTypeNames(text, relative) {
  const names = new Set();
  const directory = path.posix.dirname(relative);
  for (const match of text.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const spec = match[2];
    const target = spec.startsWith(".") ? path.posix.join(directory, spec) : spec;
    if (!/(?:^|\/)ui\/race(?:\.ts)?$/.test(target)) continue;
    for (const item of match[1].split(",")) {
      const name = /^\s*(?:type\s+)?Expected(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
      if (name) names.add(name[1] ?? "Expected");
    }
  }
  return names;
}

/// Le strade per cui il tipo del cancello prende un nome che
/// `gateTypeNames` non vede: un re-export (`export type { Expected as Gate }
/// from "../ui/race"`, `export * from "../ui/race"`), un import del modulo
/// intero (`import * as race from "../ui/race"`, poi `e: race.Expected`) o
/// un tipo importato sul posto (`e: import("../ui/race").Expected`). Ogni
/// funzione che ricevesse il cancello con quel nome uscirebbe dalla guardia
/// senza dirlo. Si legge dal testo vero, come gli import.
function gateAliasImports(text, relative) {
  const directory = path.posix.dirname(relative);
  const isGate = (spec) => {
    const target = spec.startsWith(".") ? path.posix.join(directory, spec) : spec;
    return /(?:^|\/)ui\/race(?:\.ts)?$/.test(target);
  };
  const found = [];
  const patterns = [
    [/\bexport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g, (match) => /(?:^|[\s,{])(?:type\s+)?Expected\b/.test(match[1]), "re-exports the gate type"],
    [/\bexport\s+(?:type\s+)?\*(?:\s+as\s+[\w$]+)?\s+from\s*["']([^"']+)["']/g, () => true, "re-exports the whole gate module"],
    [/\bimport\s+(?:type\s+)?\*\s+as\s+[\w$]+\s+from\s*["']([^"']+)["']/g, () => true, "imports the whole gate module"],
    [/\bimport\s*\(\s*["']([^"']+)["']\s*\)\s*\.\s*Expected\b/g, () => true, "names the gate type through `import(…)`"],
  ];
  for (const [pattern, names, what] of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (!isGate(match[match.length - 1]) || !names(match)) continue;
      found.push([match.index, what]);
    }
  }
  return found;
}

/// Se la graffa aperta in `open` è quella di un import o di un export coi
/// nomi (`import { type Expected } from …`, `export type { … }`).
function importBraces(code, open) {
  return /\b(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?$/.test(code.slice(0, open));
}

/// La graffa aperta più vicina che racchiude `offset`, o -1 se la prima che
/// lo racchiude è una tonda o una quadra.
function enclosingBrace(code, offset) {
  let depth = 0;
  for (let index = offset - 1; index >= 0; index--) {
    const char = code[index];
    if (char === ")" || char === "]" || char === "}") depth++;
    else if (char === "(" || char === "[" || char === "{") {
      if (depth > 0) depth--;
      else return char === "{" ? index : -1;
    }
  }
  return -1;
}

/// Le parole dopo cui una parentesi tonda non apre i parametri di un metodo.
const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "with", "return", "typeof", "await", "new", "void",
  "delete", "in", "of", "instanceof", "yield", "case", "throw", "do", "else",
]);

/// La parentesi tonda aperta più vicina che racchiude `offset`, o -1 se la
/// prima che lo racchiude è una quadra o una graffa che non sia un tipo
/// scritto dopo `:` (`{ gate }: { gate: Expected }` sta nei parametri).
function enclosingParen(code, offset) {
  let depth = 0;
  for (let index = offset - 1; index >= 0; index--) {
    const char = code[index];
    if (char === ")" || char === "]" || char === "}") depth++;
    else if (char === "(" || char === "[" || char === "{") {
      if (depth > 0) depth--;
      else if (char === "(") return index;
      else if (char !== "{" || !/:\s*$/.test(code.slice(0, index))) return -1;
    }
  }
  return -1;
}

/// Dove finisce il corpo senza graffe di una freccia che comincia in `from`:
/// alla prima `,` o `;` fuori da parentesi, o alla parentesi che chiude
/// quella in cui la freccia sta.
function expressionEnd(code, from) {
  let depth = 0;
  for (let index = from; index < code.length; index++) {
    const char = code[index];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return index;
      depth--;
    } else if ((char === "," || char === ";") && depth === 0) return index;
  }
  return code.length;
}

/// Il corpo della funzione la cui lista di parametri si apre in `open`
/// (`{ start, end }`), o `null` se la lista non è di una funzione con un
/// corpo: una chiamata, un tipo funzione (`run: (e: Expected) => void`), la
/// firma di un metodo in un'interfaccia o di un overload.
function functionAt(code, open) {
  const close = closingOf(code, open);
  if (close >= code.length) return null;
  const before = code.slice(0, open).replace(/\s+$/, "");
  // Un tipo: la lista sta dopo `:`, `=>`, `|`, `&`, `<`, `,` di un
  // generico o `type X =`.
  if (/(?::|=>|[|&<]|\btype\s+[\w$]+\s*(?:<[^>]*>)?\s*=)$/.test(before)) return null;
  const generics = String.raw`(?:<[\w$\s,.<>[\]|&?=]*>)?`;
  const isFunction = new RegExp(String.raw`\bfunction\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*${generics}$`).test(before);
  const name = isFunction ? null : new RegExp(String.raw`(#?[A-Za-z_$][\w$]*)\s*${generics}$`).exec(before)?.[1];
  if (name !== null && name !== undefined && KEYWORDS.has(name)) return null;
  // Una freccia: niente prima della lista, o solo `async`. Un nome davanti
  // fa un metodo (`load(…) {`) o una chiamata, che non ha un corpo.
  const arrow = !isFunction && (name === undefined || name === "async");
  let index = skipSpace(code, close + 1);
  if (code[index] === ":") {
    // Il tipo di ritorno: fino alla `=>` di una freccia o alla `{` del
    // corpo. Una graffa dopo `:`, `|`, `&`, `<`, `,` o `(` è un tipo.
    let depth = 0;
    const typeStart = index + 1;
    for (index = typeStart; index < code.length; index++) {
      const char = code[index];
      if (depth === 0 && arrow && code.startsWith("=>", index)) break;
      if (depth === 0 && !arrow && char === "{" &&
        !/(?:^|[:|&<,(]|=>)\s*$/.test(code.slice(typeStart, index))) break;
      if (depth === 0 && (char === ";" || char === "," || char === ")" || char === "}")) return null;
      if (char === "(" || char === "[" || char === "<" || char === "{") depth++;
      else if (char === ")" || char === "]" || char === "}") depth--;
      else if (char === ">" && code[index - 1] !== "=") depth--;
    }
  }
  if (arrow) {
    if (!code.startsWith("=>", index)) return null;
    const start = skipSpace(code, index + 2);
    if (code[start] === "{") return { start: start + 1, end: closingOf(code, start, "{", "}") };
    return { start, end: expressionEnd(code, start) };
  }
  if (code[index] !== "{") return null;
  return { start: index + 1, end: closingOf(code, index, "{", "}") };
}

/// Il nome del cancello in un parametro che ne nomina il tipo: `e: Expected`
/// (anche `e?:` o con un default), o un parametro destrutturato col tipo
/// scritto lì, che dà `Expected` a una chiave (`{ gate }: { gate: Expected }`,
/// `{ gate: g }: { gate: Expected }`). `null` se non si sa leggere.
function gateOfParameter(parameter, typeName) {
  const type = typeName.replace(/\$/g, "\\$");
  const plain = new RegExp(String.raw`^\s*([A-Za-z_$][\w$]*)\s*\??\s*:\s*${type}\s*(?:=[^]*)?$`).exec(parameter);
  if (plain) return plain[1];
  const destructured = /^\s*\{([^]*?)\}\s*:\s*\{([^]*)\}\s*(?:=[^]*)?$/.exec(parameter);
  if (destructured === null) return null;
  const key = new RegExp(String.raw`(?:^|[;,{\s])([A-Za-z_$][\w$]*)\s*\??\s*:\s*${type}\s*(?:[;,]|$)`).exec(destructured[2]);
  if (key === null) return null;
  for (const item of topLevelArguments(destructured[1], 0, destructured[1].length)) {
    const binding = /^\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?:=[^]*)?$/.exec(item);
    if (binding && binding[1] === key[1]) return binding[2] ?? binding[1];
  }
  return null;
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
/// È un giro anche il corpo di ogni funzione (dichiarazione, freccia,
/// `function` o metodo) con un parametro del tipo `Expected` importato da
/// `ui/race`: il cancello è quel parametro (`expected: Expected`, anche
/// opzionale, con un default, col tipo importato sotto un altro nome, o
/// destrutturato col tipo scritto lì: `{ gate }: { gate: Expected }`). Chi
/// riceve il cancello ne aspetta le promesse per conto del giro: senza
/// leggerlo, un suo `await` nascosto scriveva a giro scaduto (il falso
/// «ricerca non riuscita» del blocco query, l'«immagine mancante» dei media
/// di una resa smontata). Un parametro col tipo che la guardia non sa
/// leggere (`e: Expected | null`) è una violazione; un tipo funzione
/// (`body: (e: Expected) => …`), la firma di un'interfaccia o di un overload
/// non hanno un corpo e non sono giri.
///
/// Nel corpo:
/// - ogni `await` attende una chiamata del cancello (`await expected(p)`,
///   anche con la sua catena dopo); nominarlo come valore
///   (`await f(expected)`) o chiamarlo dentro un'altra chiamata
///   (`await save(expected(p))`, `await Promise.all([expected(a()), b()])`)
///   non basta, perché la chiamata di fuori può aspettare quello che vuole;
/// - nessun `try … catch` con un `await` nel `try`, e nessun `.catch`,
///   `.finally` o `.then(ok, ko)` attaccato a una chiamata del cancello:
///   ingoierebbero la scadenza. Un `try` senza `await` non la vede mai
///   passare, e si può;
/// - nessun `.then`, `.catch` o `.finally` fuori dal cancello: il loro
///   callback corre anche a giro scaduto. Dentro l'argomento del cancello
///   (`expected(p.then(trasforma))`) si può, e il callback deve solo dare
///   forma al valore: anche lui corre a giro scaduto, e la guardia non lo
///   distingue da uno che scrive.
///
/// Il tipo del cancello si nomina solo dentro una lista di parametri (di una
/// funzione, di un tipo funzione, di una firma, di una chiamata) o negli
/// import coi nomi. Altrove è una violazione, perché porterebbe il cancello
/// dove la guardia non lo segue: un alias (`type Gate = Expected`), un campo
/// di un oggetto di opzioni col tipo scritto altrove (`interface Opzioni {
/// gate: Expected }`, `type Opzioni = { gate: Expected }`), un campo di una
/// classe, una variabile, un generico, un tipo di ritorno. Così anche un
/// re-export, un import del modulo intero e `import("…/ui/race").Expected`,
/// che darebbero al tipo un nome che la guardia non conosce. Un tipo
/// funzione che riceve il cancello (`type Corpo = (e: Expected) => …`) resta
/// lecito.
///
/// Limiti noti, che senza un parser vero non si chiudono: un cancello
/// passato a una funzione il cui parametro non nomina `Expected` (`p: <T>(x:
/// Promise<T>) => Promise<T>`, il tipo scritto per intero) porta le attese di
/// quella funzione fuori dalla guardia; così un corpo tipato da un tipo
/// funzione (`const corpo: Corpo = async (e) => …`); un cancello rinominato in un nome locale
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
  // Le teste dei giri già letti: la loro freccia ha anche lei il parametro
  // `Expected`, e non si legge due volte.
  const heads = [];
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
    const start = call + 1 + head.start;
    heads.push([call, start]);
    found.push(...bodyViolations(code.slice(start, close), head.gate, (offset) => `${relative}:${lineOf(start + offset)}`, "a race"));
  }
  // Le funzioni che ricevono il cancello: un parametro col tipo `Expected`
  // del modulo del cancello.
  const read = new Set();
  for (const typeName of gateTypeNames(text, relative)) {
    const pattern = new RegExp(String.raw`(?<![\w$.#])${typeName.replace(/\$/g, "\\$")}(?![\w$])`, "g");
    for (const mention of code.matchAll(pattern)) {
      const open = enclosingParen(code, mention.index);
      if (open === -1) {
        // Fuori da una lista di parametri: lecito solo l'import coi nomi.
        const brace = enclosingBrace(code, mention.index);
        if (brace !== -1 && importBraces(code, brace)) continue;
        found.push(
          `${relative}:${lineOf(mention.index)}: the gate type \`${typeName}\` outside a parameter list ` +
            "(an alias, a field of an options type, a variable): the guard reads only functions that name it in a parameter; " +
            `write \`expected: ${typeName}\` (or \`{ gate }: { gate: ${typeName} }\`) there.`,
        );
        continue;
      }
      if (read.has(open) || heads.some(([from, to]) => open > from && open < to)) continue;
      const fn = functionAt(code, open);
      if (fn === null) continue;
      read.add(open);
      races++;
      const close = closingOf(code, open);
      let cursor = open + 1;
      let parameter = "";
      for (const piece of topLevelArguments(code, open + 1, close)) {
        const from = code.indexOf(piece, cursor);
        cursor = from + piece.length;
        if (mention.index >= from && mention.index < cursor) parameter = piece;
      }
      const gate = gateOfParameter(parameter, typeName);
      if (gate === null) {
        found.push(
          `${relative}:${lineOf(mention.index)}: cannot read the gate in this parameter (\`${parameter.trim()}\`); ` +
            `write it as \`expected: ${typeName}\`.`,
        );
        continue;
      }
      found.push(...bodyViolations(code.slice(fn.start, fn.end), gate, (offset) => `${relative}:${lineOf(fn.start + offset)}`, "a function that takes the gate"));
    }
  }
  for (const [offset, what] of gateAliasImports(text, relative)) {
    found.push(
      `${relative}:${lineOf(offset)}: this ${what}, giving the gate a name the guard does not know; ` +
        "import `Expected` by name from `ui/race` where it is used.",
    );
  }
  return { found, races };
}

/// L'import del tipo del cancello, per i casi dell'autoprova (il file del
/// caso è `caso.ts`, alla radice).
const GATE_IMPORT = 'import type { Expected } from "./ui/race";\n';

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
    // GUARDIA-CANCELLO: la funzione che riceve il cancello (un parametro di
    // tipo `Expected` di `ui/race`) è un giro anche lei. La guardia di prima
    // non ne leggeva il corpo, e i casi rossi passavano.
    ["una funzione col cancello, attesa nascosta (sfuggiva)", `${GATE_IMPORT}async function f(p: P, expected: Expected) { await g(p); }`, 1, 1],
    ["una funzione col cancello, .catch attaccato (sfuggiva)", `${GATE_IMPORT}async function f(expected: Expected) { const v = await expected(g()).catch(() => null); }`, 1, 1],
    ["una funzione col cancello, un try che ingoia (sfuggiva)", `${GATE_IMPORT}async function f(expected: Expected) { try { await expected(g()); } catch {} }`, 1, 1],
    ["una freccia col cancello, attesa nascosta (sfuggiva)", `${GATE_IMPORT}const f = async (e: Expected) => { await g(); };`, 1, 1],
    ["una freccia senza graffe col cancello, un .then fuori (sfuggiva)", `${GATE_IMPORT}const f = (e: Expected) => g().then(h);`, 1, 1],
    ["un metodo col cancello, attesa nascosta (sfuggiva)", `${GATE_IMPORT}class A { async load(expected: Expected): Promise<void> { await g(); } }`, 1, 1],
    ["un metodo col tipo di ritorno a graffe (sfuggiva)", `${GATE_IMPORT}class A { async m(e: Expected): Promise<{ a: T }> { await g(); } }`, 1, 1],
    ["il tipo importato con un altro nome (sfuggiva)", `import { Race, type Expected as Gate } from "../ui/race";\nasync function f(g: Gate) { await h(); }`, 1, 1],
    ["il cancello destrutturato (sfuggiva)", `${GATE_IMPORT}async function f({ gate }: { gate: Expected; n: number }) { await h(); }`, 1, 1],
    ["il cancello destrutturato e rinominato (sfuggiva)", `${GATE_IMPORT}async function f({ gate: g }: { gate: Expected }) { await g(h()); await k(); }`, 1, 1],
    ["un parametro opzionale col cancello (sfuggiva)", `${GATE_IMPORT}async function f(e?: Expected) { await g(); }`, 1, 1],
    ["un parametro col cancello che non si legge", `${GATE_IMPORT}async function f(e: Expected | null) { }`, 1, 1],
    ["una funzione col cancello, giusta", `${GATE_IMPORT}async function f(p: P, expected: Expected) { const v = await expected(g(p).catch(() => null)); return v; }`, 1, 0],
    ["come drawingNameOf, giusta", `${GATE_IMPORT}async function f(port: P, id: string, expected: Expected): Promise<string | null> {\n  if (!ok(id)) return null;\n  return expected(port.name(id).catch(() => null));\n}`, 1, 0],
    ["una freccia col cancello, giusta", `${GATE_IMPORT}const f = (e: Expected) => e(g().then(h));`, 1, 0],
    ["il cancello destrutturato, giusto", `${GATE_IMPORT}async function f({ gate }: { gate: Expected }) { await gate(h()); }`, 1, 0],
    ["un overload e la sua funzione", `${GATE_IMPORT}function f(e: Expected): Promise<void>;\nasync function f(e: Expected) { await e(g()); }`, 1, 0],
    ["un giro col parametro tipato, letto una volta", `${GATE_IMPORT}r.last(async (e: Expected) => { await e(f()); });`, 1, 0],
    ["un Expected di un altro modulo non è il cancello", `import type { Expected } from "./tools/recognize-corpus";\nasync function f(e: Expected) { await g(); }`, 0, 0],
    ["un Expected senza import non è il cancello", "async function f(e: Expected) { await g(); }", 0, 0],
    ["un parametro che riceve un giro, non il cancello", `${GATE_IMPORT}async function run(body: (e: Expected) => Promise<void>) { await g(); }`, 0, 0],
    ["un tipo funzione", `${GATE_IMPORT}type Body = (e: Expected) => Promise<void>;`, 0, 0],
    ["la firma di un'interfaccia", `${GATE_IMPORT}interface P { fill(e: Expected): Promise<void>; }`, 0, 0],
    ["un Expected in una chiamata", `${GATE_IMPORT}go(x as Expected);`, 0, 0],
    // Un `try` senza `await` non prende la scadenza: arriva solo a un `await`.
    ["un try senza await nel giro", "r.last(async (e) => { try { f(); } catch { } await e(g()); });", 1, 0],
    ["un try con un await dopo una chiamata", "r.last(async (e) => { try { f(); await e(g()); } catch { } });", 1, 1],
    ["un try senza await in una funzione col cancello", `${GATE_IMPORT}async function f(e: Expected) { try { t(); } catch (x) { log(x); } await e(g()); }`, 1, 0],
    // Il tipo del cancello fuori da una lista di parametri (CANCELLO-DISEGNO):
    // un alias o un oggetto di opzioni col tipo scritto altrove portavano le
    // attese fuori dalla guardia in silenzio.
    ["un alias del tipo del cancello (sfuggiva)", `${GATE_IMPORT}type Gate = Expected;\nasync function f(g: Gate) { await h(); }`, 0, 1],
    ["un alias esportato con un'unione (sfuggiva)", `${GATE_IMPORT}export type Gate = Expected | null;`, 0, 1],
    ["un'interfaccia di opzioni col cancello (sfuggiva)", `${GATE_IMPORT}interface Opzioni { gate: Expected; n: number }\nasync function f(o: Opzioni) { await h(); }`, 0, 1],
    ["un tipo di opzioni col cancello (sfuggiva)", `${GATE_IMPORT}type Opzioni = { readonly gate?: Expected };\nasync function f({ gate }: Opzioni) { await h(); }`, 0, 1],
    ["un campo di una classe col cancello (sfuggiva)", `${GATE_IMPORT}class A { #gate: Expected | null = null; }`, 0, 1],
    ["una variabile col cancello (sfuggiva)", `${GATE_IMPORT}let gate: Expected | undefined;`, 0, 1],
    ["un generico col cancello (sfuggiva)", `${GATE_IMPORT}const gates = new Map<string, Expected>();`, 0, 1],
    ["un tipo di ritorno col cancello (sfuggiva)", `${GATE_IMPORT}function gateOf(r: R): Expected { return r.g; }`, 0, 1],
    ["l'alias del tipo importato con un altro nome (sfuggiva)", `import type { Expected as Gate } from "./ui/race";\ntype Porta = Gate;`, 0, 1],
    ["un re-export del tipo del cancello (sfuggiva)", 'export type { Expected as Gate } from "./ui/race";', 0, 1],
    ["un re-export di tutto il modulo (sfuggiva)", 'export * from "./ui/race";', 0, 1],
    ["un import del modulo intero (sfuggiva)", 'import * as race from "./ui/race";\nasync function f(e: race.Expected) { await h(); }', 0, 1],
    ["un tipo importato sul posto (sfuggiva)", 'async function f(e: import("./ui/race").Expected) { await h(); }', 0, 1],
    ["l'import coi nomi non è un alias", 'import { Race, type Expected } from "./ui/race";\nexport type { Race };', 0, 0],
    ["un re-export di un altro tipo dal modulo", 'export { Race } from "./ui/race";', 0, 0],
    ["un alias di un Expected di un altro modulo", 'import type { Expected } from "./tools/recognize-corpus";\ntype E = Expected;', 0, 0],
    ["un tipo di opzioni con un tipo funzione", `${GATE_IMPORT}interface Opzioni { run: (e: Expected) => Promise<void> }`, 0, 0],
    ["un alias di un tipo funzione", `${GATE_IMPORT}export type Corpo = (expected: Expected) => Promise<void>;`, 0, 0],
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
