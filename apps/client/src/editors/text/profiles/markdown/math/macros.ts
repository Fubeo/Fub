// Le macro del vault (T65, E27): una nota normale, `Formule/Macro.md`, coi suoi
// `\newcommand`, letta come premessa di ogni formula, in lettura e mentre si
// modifica (come i tipi di nota, D7: il vault dice le sue regole in una nota).
// La nota si legge e basta: Fub non la crea e non la scrive.
//
// Le dichiarazioni le legge KaTeX stesso, una per una, nel gruppo globale
// (`globalGroup`), così valgono le sue regole e i suoi argomenti. Una
// dichiarazione che non si legge si salta; una macro che si chiama da sola (o
// in cerchio con altre) si toglie, perché ogni formula che la usa si
// fermerebbe al limite delle espansioni. In tutti e due i casi le altre macro
// restano e Fub lo dice, una volta. Una nota troppo grande o illeggibile si
// ignora, e lo si dice.
//
// Il modulo arriva col primo KaTeX (`../math.ts`), in un pezzo suo: una nota
// senza formule non lo carica.
import type katex from "katex";
import { asPluginError, errorText, isErrorKind } from "../../../../../host/errors";
import { api } from "../../../../../host/ipc";
import { onEvent } from "../../../../../state/kernel";
import { openVaultRoot, vaultArg } from "../../../../../state/store";
import { notify } from "../../../../../ui/notify";
import { setPreamble, type MathMacros } from "../math";
import { liveStrings } from "../strings";

/// La nota delle macro, dalla radice del vault.
export const MACRO_NOTE = "Formule/Macro.md";
/// Oltre questa misura la nota si ignora: una premessa non è un libro.
export const MAX_MACRO_TEXT = 100_000;
/// Quante dichiarazioni si leggono al più.
export const MAX_MACROS = 300;
/// Il limite delle espansioni, lo stesso della resa (`readOptions`).
const MAX_EXPAND = 1_000;

/// Una dichiarazione trovata nella nota: il suo testo, il nome che dichiara e
/// la riga.
export interface Declaration {
  readonly source: string;
  readonly name: string;
  readonly line: number;
}

/// Che cosa non va nella nota delle macro.
export type MacroProblem =
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "too_large"; readonly limit: number }
  | { readonly kind: "too_many"; readonly limit: number }
  | { readonly kind: "broken"; readonly name: string; readonly line: number }
  | { readonly kind: "loop"; readonly name: string };

export interface CompiledMacros {
  readonly macros: MathMacros;
  readonly problems: readonly MacroProblem[];
}

const DECLARATION = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def|gdef|edef|xdef|let)(?![A-Za-z])/g;

/// La fine del gruppo `{…}` che si apre in `at`, graffe protette comprese, o
/// -1.
function groupEnd(text: string, at: number): number {
  if (text[at] !== "{") return -1;
  let level = 0;
  for (let index = at; index < text.length; index++) {
    const ch = text[index];
    if (ch === "\\") index++;
    else if (ch === "{") level++;
    else if (ch === "}" && --level === 0) return index + 1;
  }
  return -1;
}

/// Un nome di comando in `at` (`\nome` o `\` e un segno), e dove finisce.
function commandName(text: string, at: number): { name: string; end: number } | null {
  if (text[at] !== "\\" || at + 1 >= text.length) return null;
  const letters = /^[A-Za-z]+/.exec(text.slice(at + 1, at + 65));
  const end = letters ? at + 1 + letters[0].length : at + 2;
  return { name: text.slice(at, end), end };
}

function skipSpaces(text: string, at: number): number {
  while (at < text.length && /[ \t\r\n]/.test(text[at]!)) at++;
  return at;
}

/// Le dichiarazioni della nota, in ordine: `\newcommand`, `\renewcommand`,
/// `\providecommand`, `\DeclareMathOperator` (che diventa un `\newcommand`
/// con `\operatorname`), `\def` e i suoi fratelli, `\let`. Una dichiarazione
/// scritta a metà dà `name` vuoto e la sua riga: la si dice rotta.
export function declarations(text: string): Declaration[] {
  const found: Declaration[] = [];
  const lineOf = (at: number) => text.slice(0, at).split("\n").length;
  DECLARATION.lastIndex = 0;
  for (let match = DECLARATION.exec(text); match; match = DECLARATION.exec(text)) {
    const start = match.index;
    let slashes = 0;
    for (let at = start - 1; at >= 0 && text[at] === "\\"; at--) slashes++;
    if (slashes % 2 === 1) continue;
    const kind = match[1]!;
    let at = start + match[0].length;
    const broken = () => found.push({ source: "", name: "", line: lineOf(start) });
    let star = false;
    if (text[at] === "*" && kind !== "def" && kind !== "let" && !kind.endsWith("def")) {
      star = true;
      at++;
    }
    at = skipSpaces(text, at);
    // Il nome: `{\nome}` o `\nome`.
    let name: { name: string; end: number } | null;
    if (text[at] === "{") {
      name = commandName(text, skipSpaces(text, at + 1));
      if (name) {
        const close = skipSpaces(text, name.end);
        name = text[close] === "}" ? { name: name.name, end: close + 1 } : null;
      }
    } else {
      name = commandName(text, at);
    }
    if (!name) {
      broken();
      continue;
    }
    at = name.end;
    if (kind === "let") {
      at = skipSpaces(text, at);
      if (text[at] === "=") at = skipSpaces(text, at + 1);
      const target = commandName(text, at);
      const end = target ? target.end : at < text.length ? at + 1 : -1;
      if (end < 0) {
        broken();
        continue;
      }
      found.push({ source: text.slice(start, end), name: name.name, line: lineOf(start) });
      DECLARATION.lastIndex = end;
      continue;
    }
    if (kind.endsWith("def")) {
      // I parametri (`#1#2`) fino alla graffa del corpo.
      const open = text.indexOf("{", at);
      const params = open < 0 ? "" : text.slice(at, open);
      const end = open < 0 || !/^[#\d\s]*$/.test(params) ? -1 : groupEnd(text, open);
      if (end < 0) {
        broken();
        continue;
      }
      found.push({ source: text.slice(start, end), name: name.name, line: lineOf(start) });
      DECLARATION.lastIndex = end;
      continue;
    }
    if (kind === "DeclareMathOperator") {
      const open = skipSpaces(text, at);
      const end = groupEnd(text, open);
      if (end < 0) {
        broken();
        continue;
      }
      const operator = star ? "\\operatorname*" : "\\operatorname";
      found.push({ source: `\\newcommand{${name.name}}{${operator}${text.slice(open, end)}}`, name: name.name, line: lineOf(start) });
      DECLARATION.lastIndex = end;
      continue;
    }
    // `[n]` e `[predefinito]`, poi il corpo.
    for (let options = 0; options < 2; options++) {
      const open = skipSpaces(text, at);
      if (text[open] !== "[") break;
      const close = text.indexOf("]", open);
      if (close < 0) break;
      at = close + 1;
    }
    const open = skipSpaces(text, at);
    const end = groupEnd(text, open);
    if (end < 0) {
      broken();
      continue;
    }
    found.push({ source: text.slice(start, end), name: name.name, line: lineOf(start) });
    DECLARATION.lastIndex = end;
  }
  return found;
}

/// Quanti argomenti prende una macro di KaTeX.
function argumentsOf(definition: unknown): number {
  if (typeof definition === "string") {
    let most = 0;
    for (const match of definition.matchAll(/#(\d)/g)) most = Math.max(most, Number(match[1]));
    return most;
  }
  const count = (definition as { numArgs?: unknown } | null)?.numArgs;
  return typeof count === "number" && count >= 0 && count <= 9 ? count : 0;
}

/// Le macro della nota `text`, lette da KaTeX, e che cosa non va.
export function compileMacros(library: typeof katex, text: string): CompiledMacros {
  if (text.length > MAX_MACRO_TEXT) return { macros: {}, problems: [{ kind: "too_large", limit: MAX_MACRO_TEXT }] };
  const problems: MacroProblem[] = [];
  let found = declarations(text);
  if (found.length > MAX_MACROS) {
    found = found.slice(0, MAX_MACROS);
    problems.push({ kind: "too_many", limit: MAX_MACROS });
  }
  const macros: Record<string, MathMacros[string]> = {};
  const run = (source: string) => library.renderToString(source, {
    macros,
    globalGroup: true,
    throwOnError: true,
    strict: "ignore",
    trust: false,
    maxExpand: MAX_EXPAND,
    output: "html",
  });
  for (const declaration of found) {
    if (!declaration.name) {
      problems.push({ kind: "broken", name: "", line: declaration.line });
      continue;
    }
    const before = { ...macros };
    const restore = () => {
      for (const key of Object.keys(macros)) if (!(key in before)) delete macros[key];
      Object.assign(macros, before);
    };
    try {
      run(declaration.source);
    } catch (error) {
      restore();
      // Un `\newcommand` di un nome che KaTeX ha già (`\R`): nella nota delle
      // macro vale come `\renewcommand`, come in un documento LaTeX dove quel
      // nome non c'è.
      const again = /attempting to redefine/.test(errorText(error)) && /^\\newcommand/.test(declaration.source)
        ? declaration.source.replace(/^\\newcommand/, "\\renewcommand") : null;
      try {
        if (again === null) throw error;
        run(again);
      } catch {
        restore();
        problems.push({ kind: "broken", name: declaration.name, line: declaration.line });
        continue;
      }
    }
    // Una macro che si chiama da sola non finisce mai: la si prova una volta,
    // coi suoi argomenti, e se arriva al limite delle espansioni si toglie.
    const definition = macros[declaration.name];
    if (definition === undefined) continue;
    try {
      library.renderToString(declaration.name + "{x}".repeat(argumentsOf(definition)), {
        macros: { ...macros }, throwOnError: true, strict: "ignore", trust: false, maxExpand: MAX_EXPAND, output: "html",
      });
    } catch (error) {
      if (errorText(error).includes("Too many expansions")) {
        restore();
        problems.push({ kind: "loop", name: declaration.name });
      }
    }
  }
  return { macros, problems };
}

/// La frase per chi scrive.
export function problemText(problem: MacroProblem): string {
  const t = liveStrings.t.bind(liveStrings);
  switch (problem.kind) {
    case "unreadable": return t("live.math.macros.unreadable", { note: MACRO_NOTE, reason: problem.reason });
    case "too_large": return t("live.math.macros.too_large", { note: MACRO_NOTE, limit: problem.limit.toLocaleString() });
    case "too_many": return t("live.math.macros.too_many", { note: MACRO_NOTE, limit: problem.limit });
    case "broken": return problem.name
      ? t("live.math.macros.broken", { note: MACRO_NOTE, name: problem.name, line: problem.line })
      : t("live.math.macros.broken_line", { note: MACRO_NOTE, line: problem.line });
    case "loop": return t("live.math.macros.loop", { note: MACRO_NOTE, name: problem.name });
  }
}

/// Le frasi di una lettura: la prima, e quante altre ce ne sono.
export function problemsText(problems: readonly MacroProblem[]): string | null {
  const first = problems[0];
  if (!first) return null;
  const text = problemText(first);
  return problems.length === 1 ? text : `${text} ${liveStrings.t("live.math.macros.more", { count: problems.length - 1 })}`;
}

// ── La nota del vault ────────────────────────────────────────────────────────

let generation = 0;
let told = "";
let stops: (() => void)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/// Legge la nota delle macro e le mette come premessa. Una lettura vecchia
/// non scrive sopra una nuova.
async function reload(library: typeof katex): Promise<void> {
  const asked = ++generation;
  let compiled: CompiledMacros;
  try {
    const source = await api.readDocument(MACRO_NOTE, ...vaultArg(openVaultRoot()));
    compiled = compileMacros(library, source.text);
  } catch (error) {
    // Una nota che non c'è è il caso di serie: niente macro, niente da dire.
    // Senza host (i test, il banco) non c'è niente da leggere.
    const missing = isErrorKind(error, "not_found") || asPluginError(error) === null;
    compiled = { macros: {}, problems: missing ? [] : [{ kind: "unreadable", reason: errorText(error) }] };
  }
  if (asked !== generation) return;
  setPreamble(compiled.macros);
  const text = problemsText(compiled.problems);
  if (text !== null && text !== told) notify(text, "guasto");
  told = text ?? "";
}

/// Comincia a seguire la nota delle macro: la legge adesso e di nuovo quando
/// cambia, sparisce, si rinomina o il vault si riapre. Una volta per finestra;
/// il primo giro finisce con la prima lettura.
export function watchVaultMacros(library: typeof katex): Promise<void> {
  stopVaultMacros();
  const soon = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void reload(library);
    }, 150);
  };
  const ours = (id: string) => id === MACRO_NOTE;
  stops = [
    onEvent("document_changed", (event) => { if (ours(event.id)) soon(); }),
    onEvent("document_removed", (event) => { if (ours(event.id)) soon(); }),
    onEvent("document_renamed", (event) => { if (ours(event.from) || ours(event.to)) soon(); }),
    onEvent("batch_ended", (event) => { if (event.changed.some(ours)) soon(); }),
    onEvent("vault_opened", soon),
    onEvent("overflow", soon),
  ];
  return reload(library);
}

/// Smette di seguire la nota (i test; nell'app vale per tutta la finestra).
export function stopVaultMacros(): void {
  for (const stop of stops) stop();
  stops = [];
  if (timer !== null) clearTimeout(timer);
  timer = null;
  generation++;
}
