// Gli errori della formula detti in chiaro (T64, E27). KaTeX dice che cosa
// non legge in inglese tecnico («Expected '}', got 'EOF'»); qui quel
// messaggio diventa una frase per chi scrive, nella sua lingua, con la
// correzione quando ce n'è una sola ovvia: «Manca una } di chiusura» ·
// Chiudi; «Non conosco \alfa. Forse volevi \alpha?» · Usa \alpha. Il
// messaggio grezzo del motore non si vede mai.
//
// Due passi, senza DOM: `diagnose` legge l'errore e il TeX e dice il
// problema (un tipo chiuso) con la correzione già calcolata; `explain` lo
// mette in parole, a pezzi di testo e di codice. La correzione è una
// proposta: il TeX cambia soltanto quando la persona la sceglie
// (`editor.ts`), ed è un passo solo dell'annulla.
//
// Il riferimento è `mathExplain` del prototipo (`PLAN-ui/editor.html`):
// prima le graffe che non tornano, poi il messaggio di KaTeX. I messaggi che
// il prototipo non conosce hanno qui una frase loro; uno che nessuno conosce
// diventa una frase generica.
import { expand, resolvedLanguage } from "../../../../../i18n/strings";
import { liveStrings } from "../strings";
import { commandName, propose } from "./symbols";

/// Che cosa non va nella formula. `count` è un numero, ogni altro campo è un
/// pezzo di TeX da mostrare come codice.
export type MathProblem =
  /// Graffe aperte e mai chiuse.
  | { readonly kind: "unclosed"; readonly count: number }
  /// Graffe chiuse che nessuno ha aperto.
  | { readonly kind: "unopened"; readonly count: number }
  /// La `]` dell'argomento facoltativo (`\sqrt[3`).
  | { readonly kind: "bracket" }
  /// Un comando che KaTeX non conosce, con i simboli del catalogo che gli
  /// somigliano (nessuno, uno o più).
  | { readonly kind: "unknown"; readonly name: string; readonly guesses: readonly string[] }
  | { readonly kind: "doubleSup" }
  | { readonly kind: "doubleSub" }
  /// A un comando (o a `^`, `_`) manca un argomento.
  | { readonly kind: "missing"; readonly command: string }
  /// Dopo `\left`, `\right`, `\middle` non c'è una parentesi.
  | { readonly kind: "delimiter"; readonly command: string }
  /// Un `\left` senza il suo `\right`: `right` è quello che lo chiude.
  | { readonly kind: "noRight"; readonly left: string; readonly right: string }
  | { readonly kind: "noLeft" }
  /// Un `\begin{…}` senza il suo `\end{…}`.
  | { readonly kind: "noEnd"; readonly name: string }
  | { readonly kind: "noBegin" }
  /// `\begin{a}` chiuso da `\end{b}`.
  | { readonly kind: "mismatch"; readonly open: string; readonly close: string }
  | { readonly kind: "unknownEnv"; readonly name: string }
  /// Un `&` fuori da una matrice o da un allineamento.
  | { readonly kind: "ampersand" }
  /// Un segno che in una formula si scrive con la `\` (`$`, `#`, `%`).
  | { readonly kind: "escape"; readonly sign: string }
  /// `\(`, `\)`, `\[`, `\]` dentro la formula.
  | { readonly kind: "mathDelimiter"; readonly token: string }
  /// Una lettera accentata (o un altro carattere da testo) nella formula.
  | { readonly kind: "textChar"; readonly char: string }
  | { readonly kind: "loop" }
  | { readonly kind: "limits" }
  /// Un comando coi suoi argomenti come esponente o pedice senza graffe.
  | { readonly kind: "scriptArgs"; readonly command: string; readonly script: "sup" | "sub" }
  | { readonly kind: "size" }
  | { readonly kind: "columns" }
  | { readonly kind: "alignment" }
  | { readonly kind: "infix" }
  /// Un errore che non si sa spiegare; `near` è il pezzo di TeX dove
  /// capita, se KaTeX lo dice.
  | { readonly kind: "other"; readonly near: string | null };

/// Il nome del pulsante della correzione.
export type FixLabel =
  | { readonly kind: "close" }
  /// Toglie una o più graffe in più.
  | { readonly kind: "removeBraces"; readonly count: number }
  /// Toglie un segno (`\(`).
  | { readonly kind: "remove" }
  | { readonly kind: "use"; readonly command: string }
  | { readonly kind: "hole" }
  | { readonly kind: "text" };

/// La correzione: il TeX intero dopo, e dove va il cursore.
export interface MathFix {
  readonly label: FixLabel;
  readonly tex: string;
  readonly caret: number;
}

export interface MathDiagnosis {
  readonly problem: MathProblem;
  /// La correzione, quando ce n'è una sola ovvia.
  readonly fix: MathFix | null;
}

/// Un pezzo della frase: testo, o TeX da mostrare come codice.
export type ProblemPart = { readonly text: string } | { readonly code: string };

/// La frase che si vede, e il nome del pulsante se c'è una correzione.
export interface ProblemText {
  readonly parts: readonly ProblemPart[];
  readonly fix: string | null;
}

// ── Leggere il TeX ───────────────────────────────────────────────────────────

/// Un passo del TeX: una graffa, un comando (`\alpha`, `\{`), un segno.
interface Token {
  readonly at: number;
  readonly text: string;
}

/// I passi del TeX, senza i commenti. `\` e il segno dopo sono un passo solo,
/// così `\{` non è una graffa.
function tokens(tex: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tex.length) {
    const ch = tex[i]!;
    if (ch === "%") {
      const end = tex.indexOf("\n", i);
      i = end < 0 ? tex.length : end + 1;
      continue;
    }
    if (ch === "\\") {
      let end = i + 1;
      if (/[a-zA-Z]/.test(tex[end] ?? "")) while (/[a-zA-Z]/.test(tex[end] ?? "")) end++;
      else end = Math.min(tex.length, end + 1);
      out.push({ at: i, text: tex.slice(i, end) });
      i = end;
      continue;
    }
    out.push({ at: i, text: ch });
    i++;
  }
  return out;
}

/// Le graffe che non tornano: dove stanno le aperte mai chiuse e le chiuse
/// mai aperte.
function braces(tex: string): { readonly unclosed: number[]; readonly unopened: number[] } {
  const unclosed: number[] = [];
  const unopened: number[] = [];
  for (const token of tokens(tex)) {
    if (token.text === "{") unclosed.push(token.at);
    else if (token.text === "}") {
      if (unclosed.length > 0) unclosed.pop();
      else unopened.push(token.at);
    }
  }
  return { unclosed, unopened };
}

/// Le parentesi che chiudono quelle di `\left`.
const CLOSING: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "\\{": "\\}",
  "\\lbrace": "\\rbrace",
  "\\langle": "\\rangle",
  "\\lvert": "\\rvert",
  "\\lVert": "\\rVert",
  "\\lfloor": "\\rfloor",
  "\\lceil": "\\rceil",
  "|": "|",
  "\\|": "\\|",
  "\\vert": "\\vert",
  "\\Vert": "\\Vert",
  ".": ".",
  "<": ">",
};

/// Il `\left` rimasto aperto, con la sua parentesi.
function openLeft(tex: string): string | null {
  const list = tokens(tex).filter((token) => !/^\s$/.test(token.text));
  const open: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const text = list[i]!.text;
    if (text === "\\left") open.push(list[i + 1]?.text ?? "");
    else if (text === "\\right" && open.length > 0) open.pop();
  }
  return open.length > 0 ? open[open.length - 1]! : null;
}

/// Il nome di ogni `\begin{…}` rimasto aperto, l'ultimo in fondo.
function openEnvironments(tex: string): string[] {
  const open: string[] = [];
  for (const match of tex.matchAll(/\\(begin|end)\s*\{([^{}]*)\}/g)) {
    if (match[1] === "begin") open.push(match[2]!);
    else if (open[open.length - 1] === match[2]) open.pop();
  }
  return open;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/// Il messaggio di KaTeX senza la posizione che aggiunge in fondo, e la
/// posizione: un `ParseError` le ha a parte (`rawMessage`, `position`,
/// `length`). Si legge per forma, senza caricare KaTeX.
function readError(error: unknown): { message: string; position: number | null; length: number } {
  if (error === null || typeof error !== "object") return { message: String(error ?? ""), position: null, length: 0 };
  const record = error as { rawMessage?: unknown; message?: unknown; position?: unknown; length?: unknown };
  const message = typeof record.rawMessage === "string" ? record.rawMessage : typeof record.message === "string" ? record.message : "";
  const position = typeof record.position === "number" && Number.isSafeInteger(record.position) && record.position >= 0 ? record.position : null;
  const length = typeof record.length === "number" && Number.isSafeInteger(record.length) && record.length >= 0 ? record.length : 0;
  return { message, position, length };
}

/// I simboli del catalogo che somigliano a un comando che non c'è: quello
/// uguale a parte le maiuscole, se c'è; poi quelli che cominciano così, coi
/// nomi in italiano e in inglese; poi il più vicino (`\alfa` è `\alpha`).
function guessesFor(name: string): string[] {
  const query = name.slice(1);
  const found: string[] = [];
  for (const symbol of propose(query, 3)) {
    const command = commandName(symbol);
    if (command && command !== name && !found.includes(command)) found.push(command);
  }
  const same = found.find((command) => command.slice(1).toLowerCase() === query.toLowerCase());
  return same ? [same] : found;
}

/// Il TeX con `[from, to)` al posto di `insert`, e il cursore dopo.
function replace(tex: string, from: number, to: number, insert: string, label: FixLabel): MathFix {
  return { label, tex: tex.slice(0, from) + insert + tex.slice(to), caret: from + insert.length };
}

/// Che cosa non va, dati l'errore di KaTeX e il TeX che l'ha dato.
export function diagnose(error: unknown, tex: string): MathDiagnosis {
  const none = (problem: MathProblem): MathDiagnosis => ({ problem, fix: null });

  // Prima le graffe, come nel prototipo: KaTeX lo dice in tre modi diversi.
  const { unclosed, unopened } = braces(tex);
  if (unclosed.length > 0 && unopened.length === 0) {
    const closed = tex + "}".repeat(unclosed.length);
    return { problem: { kind: "unclosed", count: unclosed.length }, fix: { label: { kind: "close" }, tex: closed, caret: closed.length } };
  }
  if (unopened.length > 0 && unclosed.length === 0) {
    let next = tex;
    for (const at of [...unopened].reverse()) next = next.slice(0, at) + next.slice(at + 1);
    return {
      problem: { kind: "unopened", count: unopened.length },
      fix: { label: { kind: "removeBraces", count: unopened.length }, tex: next, caret: Math.min(unopened[0]!, next.length) },
    };
  }

  const { message, position, length } = readError(error);
  const at = position ?? -1;
  let match: RegExpExecArray | null;

  if ((match = /^Undefined control sequence: (\\.+)$/.exec(message))) {
    const name = match[1]!;
    // `\[` in testa: per KaTeX è un comando che non c'è.
    if (/^\\[()[\]]$/.test(name)) return mathDelimiter(tex, name, at);
    const guesses = guessesFor(name);
    if (guesses.length !== 1) return none({ kind: "unknown", name, guesses });
    const guess = guesses[0]!;
    const pattern = new RegExp(`${escapeRegExp(name)}${/[a-zA-Z]$/.test(name) ? "(?![a-zA-Z])" : ""}`, "g");
    const next = tex.replace(pattern, () => guess);
    const first = at >= 0 && tex.startsWith(name, at) ? at : tex.search(pattern);
    // Il cursore dopo il comando corretto dove KaTeX ha visto l'errore.
    const caret = first < 0 ? next.length : first + guess.length;
    return { problem: { kind: "unknown", name, guesses }, fix: { label: { kind: "use", command: guess }, tex: next, caret } };
  }
  if (message.startsWith("Double superscript")) return none({ kind: "doubleSup" });
  if (message.startsWith("Double subscript")) return none({ kind: "doubleSub" });

  if ((match = /^Expected group (?:after|as argument to) '(.+?)'/.exec(message))) {
    const command = match[1]!;
    if (/^\\(left|right|middle|[bB]igg?[lmr]?)$/.test(command)) return none({ kind: "delimiter", command });
    const where = at >= 0 ? Math.min(tex.length, at + length) : tex.length;
    return {
      problem: { kind: "missing", command },
      fix: { label: { kind: "hole" }, tex: tex.slice(0, where) + "{}" + tex.slice(where), caret: where + 1 },
    };
  }
  if ((match = /^Unexpected end of input in a macro argument, expected '(.)'/.exec(message))) {
    if (match[1] === "]") {
      return { problem: { kind: "bracket" }, fix: { label: { kind: "close" }, tex: `${tex}]`, caret: tex.length + 1 } };
    }
    // Le graffe tornano: manca un argomento intero, in fondo.
    const last = [...tex.matchAll(/\\[a-zA-Z]+/g)].pop()?.[0];
    if (!last) return none({ kind: "other", near: null });
    return { problem: { kind: "missing", command: last }, fix: { label: { kind: "hole" }, tex: `${tex}{}`, caret: tex.length + 1 } };
  }
  if (message.startsWith("Expected '\\right', got 'EOF'")) {
    const left = openLeft(tex);
    const right = left === null ? null : CLOSING[left] ?? null;
    if (left === null || right === null) return none({ kind: "noRight", left: "\\left", right: "\\right" });
    const insert = `\\right${right}`;
    const next = tex + insert;
    return {
      problem: { kind: "noRight", left: `\\left${left}`, right: insert },
      fix: { label: { kind: "close" }, tex: next, caret: next.length },
    };
  }
  if (message.startsWith("Expected & or \\\\ or \\cr or \\end")) {
    const name = openEnvironments(tex).pop();
    if (!name) return none({ kind: "other", near: null });
    const next = `${tex}${/\s$/.test(tex) ? "" : " "}\\end{${name}}`;
    return { problem: { kind: "noEnd", name }, fix: { label: { kind: "close" }, tex: next, caret: next.length } };
  }
  if ((match = /^Mismatch: \\begin\{(.*)\} matched by \\end\{(.*)\}$/.exec(message))) {
    const open = match[1]!;
    const close = match[2]!;
    const end = at >= 0 ? /^\\end\s*\{[^{}]*\}/.exec(tex.slice(at)) : null;
    if (!end) return none({ kind: "mismatch", open, close });
    const insert = `\\end{${open}}`;
    return { problem: { kind: "mismatch", open, close }, fix: replace(tex, at, at + end[0].length, insert, { kind: "use", command: insert }) };
  }
  if ((match = /^No such environment: (.*)$/.exec(message))) return none({ kind: "unknownEnv", name: match[1]! });
  if ((match = /^Expected 'EOF', got '(.+)'$/.exec(message))) {
    const got = match[1]!;
    if (got === "\\right") return none({ kind: "noLeft" });
    if (got === "\\end") return none({ kind: "noBegin" });
    if (got === "&") return none({ kind: "ampersand" });
    if (got === "#" && at >= 0 && tex[at] === "#") {
      return { problem: { kind: "escape", sign: "#" }, fix: replace(tex, at, at + 1, "\\#", { kind: "use", command: "\\#" }) };
    }
  }
  if ((match = /^Can't use function '(.+)' in math mode$/.exec(message))) {
    const token = match[1]!;
    if (token === "$" && at >= 0 && tex[at] === "$") {
      return { problem: { kind: "escape", sign: "$" }, fix: replace(tex, at, at + 1, "\\$", { kind: "use", command: "\\$" }) };
    }
    if (/^\\[()[\]]$/.test(token)) return mathDelimiter(tex, token, at);
  }
  if ((match = /Unicode text character "(.+?)" used in math mode/.exec(message))) {
    const char = match[1]!;
    const where = at >= 0 && tex.startsWith(char, at) ? at : tex.indexOf(char);
    const problem: MathProblem = { kind: "textChar", char };
    if (where < 0) return none(problem);
    return { problem, fix: replace(tex, where, where + char.length, `\\text{${char}}`, { kind: "text" }) };
  }
  if (message.includes("[commentAtEnd]")) {
    const percent = firstComment(tex);
    if (percent < 0) return none({ kind: "other", near: null });
    return { problem: { kind: "escape", sign: "%" }, fix: replace(tex, percent, percent + 1, "\\%", { kind: "use", command: "\\%" }) };
  }
  if (message.startsWith("Too many expansions")) return none({ kind: "loop" });
  if (message.startsWith("Limit controls must follow a math operator")) return none({ kind: "limits" });
  if ((match = /^Got function '(.+)' with no arguments as (superscript|subscript)$/.exec(message))) {
    return none({ kind: "scriptArgs", command: match[1]!, script: match[2] === "superscript" ? "sup" : "sub" });
  }
  if ((match = /^Invalid delimiter (?:'.*' )?after '(.+)'$/.exec(message))) return none({ kind: "delimiter", command: match[1]! });
  if (message.startsWith("Invalid size")) return none({ kind: "size" });
  if (message.includes("Too few columns specified")) return none({ kind: "columns" });
  if (message.startsWith("Unknown column alignment")) return none({ kind: "alignment" });
  if (message.startsWith("only one infix operator per group")) return none({ kind: "infix" });

  const near = at >= 0 ? tex.slice(Math.max(0, at - 6), at + Math.max(length, 1) + 7).trim() : "";
  return none({ kind: "other", near: near || null });
}

/// `\(`, `\)`, `\[` o `\]` nella formula: una formula incollata coi suoi
/// delimitatori. Se ne vanno tutti, che i delimitatori sono della nota (i
/// dollari), non del TeX.
function mathDelimiter(tex: string, token: string, at: number): MathDiagnosis {
  const next = withoutMathDelimiters(tex);
  const caret = Math.max(0, Math.min(at, next.length));
  return { problem: { kind: "mathDelimiter", token }, fix: next === tex ? null : { label: { kind: "remove" }, tex: next, caret } };
}

/// Il TeX senza `\(`, `\)`, `\[`, `\]`; `\\[2pt]` (un a capo con lo spazio)
/// resta.
function withoutMathDelimiters(tex: string): string {
  let out = "";
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = tex[i + 1] ?? "";
    i++;
    if (!"()[]".includes(next) || next === "") out += ch + next;
  }
  return out;
}

/// Il primo `%` che comincia un commento (non `\%`).
function firstComment(tex: string): number {
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === "\\") i++;
    else if (tex[i] === "%") return i;
  }
  return -1;
}

// ── Dirlo in chiaro ──────────────────────────────────────────────────────────

type Key = Parameters<typeof liveStrings.t>[0];

/// I segni che chiudono e aprono un pezzo di codice dentro la frase: stanno
/// nell'area d'uso privato, e si tolgono dal TeX prima di usarli.
const OPEN = "\uE000";
const CLOSE = "\uE001";
const clean = (text: string) => text.replace(/[\uE000\uE001]/g, "");
const code = (text: string) => `${OPEN}${clean(text)}${CLOSE}`;

/// Una lista di comandi, con la «o» della lingua: «\sigma, \sum o \sqrt».
function alternatives(items: readonly string[], language: string): string {
  try {
    const format = new Intl.ListFormat(language, { type: "disjunction" });
    return format.formatToParts(items.map(clean)).map((part) => (part.type === "element" ? code(part.value) : part.value)).join("");
  } catch {
    return items.map(code).join(", ");
  }
}

/// Un valore già fatto a pezzi di codice (una lista di comandi).
interface Marked {
  readonly marked: string;
}

function phrase(language: string, key: Key, args: Record<string, string | number | Marked> = {}): ProblemPart[] {
  const table = liveStrings.catalogFor(language);
  const wrapped: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(args)) wrapped[name] = typeof value === "number" ? value : typeof value === "string" ? code(value) : value.marked;
  const text = expand(table[key] ?? key, wrapped);
  const parts: ProblemPart[] = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf(OPEN);
    const close = open < 0 ? -1 : rest.indexOf(CLOSE, open);
    if (open < 0 || close < 0) break;
    if (open > 0) parts.push({ text: rest.slice(0, open) });
    parts.push({ code: rest.slice(open + 1, close) });
    rest = rest.slice(close + 1);
  }
  if (rest) parts.push({ text: rest });
  return parts;
}

function words(language: string, key: Key, args: Record<string, string | number> = {}): string {
  return expand(liveStrings.catalogFor(language)[key] ?? key, args);
}

/// Il problema in parole, nella lingua di chi guarda (o in quella data).
export function explain(diagnosis: MathDiagnosis, language: string = resolvedLanguage()): ProblemText {
  const say = (key: Key, args?: Record<string, string | number | Marked>) => phrase(language, key, args);
  const problem = diagnosis.problem;
  let parts: ProblemPart[];
  switch (problem.kind) {
    case "unclosed":
      parts = problem.count === 1
        ? say("live.math.error.unclosed_one", { brace: "}" })
        : say("live.math.error.unclosed_many", { count: problem.count, brace: "}" });
      break;
    case "unopened":
      parts = problem.count === 1
        ? say("live.math.error.unopened_one", { brace: "}" })
        : say("live.math.error.unopened_many", { count: problem.count, brace: "}" });
      break;
    case "bracket":
      parts = say("live.math.error.bracket", { bracket: "]" });
      break;
    case "unknown":
      parts = problem.guesses.length === 0
        ? say("live.math.error.unknown", { name: problem.name, backslash: "\\" })
        : say("live.math.error.unknown_guess", { name: problem.name, guess: { marked: alternatives(problem.guesses, language) } });
      break;
    case "doubleSup":
      parts = say("live.math.error.double_sup", { example: "{x^2}^3" });
      break;
    case "doubleSub":
      parts = say("live.math.error.double_sub", { example: "{x_1}_2" });
      break;
    case "missing":
      parts = problem.command === "^"
        ? say("live.math.error.missing_sup", { command: "^" })
        : problem.command === "_"
          ? say("live.math.error.missing_sub", { command: "_" })
          : say("live.math.error.missing", { command: problem.command });
      break;
    case "delimiter":
      parts = say("live.math.error.delimiter", { command: problem.command, example: "(" });
      break;
    case "noRight":
      parts = say("live.math.error.no_right", { left: problem.left, right: problem.right });
      break;
    case "noLeft":
      parts = say("live.math.error.no_left", { left: "\\left", right: "\\right" });
      break;
    case "noEnd":
      parts = say("live.math.error.no_end", { begin: `\\begin{${problem.name}}`, end: `\\end{${problem.name}}` });
      break;
    case "noBegin":
      parts = say("live.math.error.no_begin", { begin: "\\begin", end: "\\end" });
      break;
    case "mismatch":
      parts = say("live.math.error.mismatch", { begin: `\\begin{${problem.open}}`, end: `\\end{${problem.close}}` });
      break;
    case "unknownEnv":
      parts = say("live.math.error.unknown_env", { name: problem.name, example: "matrix" });
      break;
    case "ampersand":
      parts = say("live.math.error.ampersand", { amp: "&" });
      break;
    case "escape":
      parts = say("live.math.error.escape", { sign: problem.sign, escaped: `\\${problem.sign}` });
      break;
    case "mathDelimiter":
      parts = say("live.math.error.math_delimiter", { token: problem.token });
      break;
    case "textChar":
      parts = say("live.math.error.text_char", { char: problem.char, text: `\\text{${problem.char}}` });
      break;
    case "loop":
      parts = say("live.math.error.loop");
      break;
    case "limits":
      parts = say("live.math.error.limits", { limits: "\\limits", sum: "\\sum", int: "\\int" });
      break;
    case "scriptArgs":
      parts = say(problem.script === "sup" ? "live.math.error.script_sup" : "live.math.error.script_sub", {
        command: problem.command,
        example: `${problem.script === "sup" ? "^" : "_"}{${problem.command}{}}`,
      });
      break;
    case "size":
      parts = say("live.math.error.size", { example: "1em" });
      break;
    case "columns":
      parts = say("live.math.error.columns", { array: "{array}" });
      break;
    case "alignment":
      parts = say("live.math.error.alignment", { l: "l", c: "c", r: "r" });
      break;
    case "infix":
      parts = say("live.math.error.infix", { over: "\\over", frac: "\\frac{}{}" });
      break;
    case "other":
      parts = problem.near ? say("live.math.error.other_near", { near: problem.near }) : say("live.math.error.other");
      break;
  }
  return { parts, fix: diagnosis.fix ? fixLabel(diagnosis.fix.label, language) : null };
}

function fixLabel(label: FixLabel, language: string): string {
  switch (label.kind) {
    case "close":
      return words(language, "live.math.fix.close");
    case "removeBraces":
      return words(language, label.count === 1 ? "live.math.fix.remove_brace" : "live.math.fix.remove_braces");
    case "remove":
      return words(language, "live.math.fix.remove");
    case "use":
      return words(language, "live.math.fix.use", { command: clean(label.command) });
    case "hole":
      return words(language, "live.math.fix.hole");
    case "text":
      return words(language, "live.math.fix.text");
  }
}

/// La frase come testo semplice, per il lettore di schermo e i test.
export function problemSentence(text: ProblemText): string {
  return text.parts.map((part) => ("code" in part ? part.code : part.text)).join("");
}
