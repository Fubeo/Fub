// Le regole della formula che si modifica toccandola (T60, E27), senza DOM: che
// cosa fanno un tasto, Backspace, Tab e lo spazio sul TeX e sul cursore. Ogni
// regola parte da un punto buono (`points.ts`) e arriva in un punto buono, e
// non lascia mai una formula rotta: un simbolo se ne va intero, dopo un pezzo
// Backspace ci entra, un pezzo tutto vuoto se ne va con un tasto solo, le
// graffe restano in pari.
import {
  argumentsOf,
  atomEndingAt,
  atomStartingAt,
  enclosing,
  holesOf,
  mapFormula,
  neighbour,
  placeAt,
  snap,
  stopsOf,
  type Atom,
  type FormulaMap,
} from "./points";

/// La formula e il cursore, un offset nel TeX.
export interface MathState {
  readonly tex: string;
  readonly caret: number;
}

/// Che cosa fa un tasto: cambia la formula, sposta il cursore, esce dalla
/// formula da un lato, o niente.
export type Outcome =
  | { readonly kind: "edit"; readonly state: MathState }
  | { readonly kind: "move"; readonly caret: number }
  | { readonly kind: "leave"; readonly side: "before" | "after" }
  | { readonly kind: "none" };

export interface TypeOptions {
  /// La formula sta in una riga di tabella: `|` chiuderebbe la cella.
  readonly inTable?: boolean;
}

const NONE: Outcome = { kind: "none" };
const move = (caret: number): Outcome => ({ kind: "move", caret });
/// Una formula nuova; il cursore va nel primo punto buono da lì in poi (dopo
/// un taglio può restare davanti a uno spazio, che non è un punto).
const edit = (tex: string, caret: number): Outcome => ({ kind: "edit", state: { tex, caret: snap(mapFormula(tex), caret) } });

/// Il pezzo prima di `at`, saltando gli spazi.
function atomBefore(map: FormulaMap, at: number): Atom | undefined {
  for (let atom = atomEndingAt(map, at); atom; atom = atomEndingAt(map, atom.from)) {
    if (atom.kind !== "char" || !/^\s+$/.test(map.tex.slice(atom.from, atom.to))) return atom;
  }
  return undefined;
}

const LETTER_COMMAND_END = /\\[a-zA-Z]+$/;
const isLetter = (ch: string | undefined) => ch !== undefined && /[a-zA-Z]/.test(ch);

/// Mette `text` fra `before` e `after` senza incollare un comando di lettere
/// alla lettera che segue (`\alpha` e `b` non fanno `\alphab`).
function join(before: string, text: string, after: string): { tex: string; caret: number; lead: number } {
  let middle = text;
  const lead = isLetter(middle[0]) && LETTER_COMMAND_END.test(before) ? 1 : 0;
  if (lead) middle = ` ${middle}`;
  // Lo spazio dopo un comando di lettere è del comando: il cursore va dopo.
  if (isLetter(after[0]) && LETTER_COMMAND_END.test(before + middle)) middle += " ";
  return { tex: before + middle + after, caret: before.length + middle.length, lead };
}

/// Toglie `[from, to)` e ricuce i due lati.
function cut(tex: string, from: number, to: number): Outcome {
  const joined = join(tex.slice(0, from), "", tex.slice(to));
  return edit(joined.tex, from);
}

/// Mette `text` nel cursore; il cursore va dopo, o in `offset` dentro `text`.
function put(state: MathState, text: string, offset?: number): Outcome {
  const before = state.tex.slice(0, state.caret);
  const after = state.tex.slice(state.caret);
  const joined = join(before, text, after);
  return edit(joined.tex, offset === undefined ? joined.caret : before.length + joined.lead + offset);
}

const allEmpty = (tex: string, atom: Atom) => atom.inner.every((span) => tex.slice(span.from, span.to).trim() === "");

/// Le frecce a sinistra e a destra: un pezzo alla volta, entrando e uscendo
/// da frazioni ed esponenti. Dal bordo si esce dalla formula.
export function arrow(state: MathState, dir: -1 | 1): Outcome {
  const next = neighbour(mapFormula(state.tex), state.caret, dir);
  return next === null ? { kind: "leave", side: dir < 0 ? "before" : "after" } : move(next);
}

/// Inizio e Fine: il primo e l'ultimo punto della formula.
export function edge(state: MathState, dir: -1 | 1): Outcome {
  const stops = stopsOf(mapFormula(state.tex));
  return move(dir < 0 ? stops[0] ?? 0 : stops[stops.length - 1] ?? state.tex.length);
}

/// ↓ dal numeratore va al denominatore, ↑ dal denominatore al numeratore, a
/// pari distanza dall'inizio (o alla fine, se l'altro è più corto). Fuori da
/// una frazione `none`: decide la geometria del disegno.
export function stack(state: MathState, dir: -1 | 1): Outcome {
  const map = mapFormula(state.tex);
  const inside = enclosing(map, state.caret);
  if (!inside) return NONE;
  const role = placeAt(map, state.caret).role;
  if (role !== (dir > 0 ? "numerator" : "denominator")) return NONE;
  const spans = inside.atom.inner;
  const index = spans.indexOf(inside.span);
  const want = dir > 0 ? "denominator" : "numerator";
  for (let k = index + dir; k >= 0 && k < spans.length; k += dir) {
    const span = spans[k]!;
    if (placeAt(map, span.from).role !== want) continue;
    const at = Math.min(span.to, span.from + (state.caret - inside.span.from));
    return move(snap(map, at));
  }
  return NONE;
}

/// Il punto subito dopo il tratto in cui sta il cursore: dal numeratore al
/// denominatore, dall'esponente a ciò che lo segue.
function outOf(map: FormulaMap, caret: number): number | null {
  const around = enclosing(map, caret);
  if (!around) return null;
  return neighbour(map, around.span.to, 1);
}

/// Tab va allo spazio vuoto dopo; senza, esce dal pezzo; al primo livello
/// esce dalla formula. Maiusc Tab torna allo spazio vuoto prima.
export function tab(state: MathState, back: boolean): Outcome {
  const map = mapFormula(state.tex);
  const holes = holesOf(map);
  if (back) {
    const before = holes.filter((at) => at < state.caret);
    const previous = before[before.length - 1];
    return previous === undefined ? NONE : move(previous);
  }
  const next = holes.find((at) => at > state.caret);
  if (next !== undefined) return move(next);
  const out = outOf(map, state.caret);
  return out === null ? { kind: "leave", side: "after" } : move(out);
}

/// Lo spazio: nel testo è uno spazio; altrove esce dal pezzo in cui si è, se
/// il cursore ne è in fondo, come nelle equazioni di Word.
export function space(state: MathState): Outcome {
  const map = mapFormula(state.tex);
  if (placeAt(map, state.caret).role === "text") return put(state, " ");
  return exit(map, state.caret);
}

function exit(map: FormulaMap, caret: number): Outcome {
  const around = enclosing(map, caret);
  if (!around || around.span.to !== caret) return NONE;
  const next = neighbour(map, caret, 1);
  return next === null ? NONE : move(next);
}

/// Un esponente o un pedice: un secondo dello stesso tipo sullo stesso pezzo
/// romperebbe la formula, e allora si entra in quello che c'è.
function script(state: MathState, map: FormulaMap, mark: "^" | "_"): Outcome {
  // Gli apici (`f'`) sono esponenti anche loro.
  if (state.tex[state.caret] === "'") return NONE;
  if (state.tex[state.caret] === "'" && atomBefore(map, state.caret)?.kind === "script") return NONE;
  let at = state.caret;
  for (let atom = atomBefore(map, at); atom?.kind === "script"; atom = atomBefore(map, at)) {
    if (atom.script === mark) {
      const span = atom.inner[0];
      if (span) return move(span.to);
      // `x^2`: l'argomento senza graffe le prende, e il cursore ci va dentro.
      const argument = state.tex.slice(atom.from + 1, atom.to).trim();
      const tex = `${state.tex.slice(0, atom.from)}${mark}{${argument}}${state.tex.slice(atom.to)}`;
      return edit(tex, atom.from + 2 + argument.length);
    }
    at = atom.from;
  }
  if (mark === "^" && /'\s*$/.test(state.tex.slice(0, state.caret))) return NONE;
  return put(state, `${mark}{}`, 2);
}

/// Un tasto che scrive un segno. Le graffe non si scrivono a mano (restano in
/// pari): `}` esce dal pezzo. I segni speciali del TeX entrano col loro
/// comando; `*` è il punto della moltiplicazione; `\` comincia un comando, che
/// chi chiama tiene in sospeso finché non è finito (`finishCommand`).
export function typeChar(state: MathState, ch: string, options: TypeOptions = {}): Outcome {
  const map = mapFormula(state.tex);
  const role = placeAt(map, state.caret).role;
  if (ch === "`") return NONE;
  if (ch === "}") return exit(map, state.caret);
  if (role === "text") {
    if ("{\\^_~".includes(ch)) return NONE;
    if ("%#$&".includes(ch)) return put(state, `\\${ch}`);
    if (ch === "|" && options.inTable) return put(state, "\\textbar{}");
    return put(state, ch);
  }
  switch (ch) {
    case "{":
      return NONE;
    case "^":
    case "_":
      return script(state, map, ch);
    case "*":
      return put(state, "\\cdot ");
    case "%":
    case "#":
    case "$":
      return put(state, `\\${ch}`);
    case "&":
      // Le colonne di un ambiente si fanno coi loro gesti (T65, T66): qui la
      // `&` è un segno, e una colonna in più romperebbe un `array`.
      return put(state, "\\&");
    case "|":
      return put(state, options.inTable ? "\\vert " : "|");
    case "'": {
      const before = atomBefore(map, state.caret);
      return before?.kind === "script" ? NONE : put(state, ch);
    }
    default:
      return put(state, ch);
  }
}

/// Backspace. Un simbolo se ne va intero; dopo un pezzo (una frazione, un
/// esponente coi suoi argomenti) ci entra invece di distruggerlo; all'inizio
/// di un pezzo tutto vuoto lo toglie intero, se no torna al punto prima.
export function backspace(state: MathState): Outcome {
  const map = mapFormula(state.tex);
  const atom = atomEndingAt(map, state.caret);
  if (!atom) {
    const around = enclosing(map, state.caret);
    if (!around) return NONE;
    if (allEmpty(state.tex, around.atom)) return cut(state.tex, around.atom.from, around.atom.to);
    const previous = neighbour(map, state.caret, -1);
    return previous === null ? NONE : move(previous);
  }
  const last = atom.inner[atom.inner.length - 1];
  if (last) return move(snap(map, last.to));
  if (structural(map, atom)) {
    const previous = neighbour(map, state.caret, -1);
    return previous === null ? NONE : move(previous);
  }
  return cut(state.tex, atom.from, atom.to);
}

/// Canc, lo specchio di Backspace: un simbolo se ne va intero; davanti a un
/// pezzo ci entra; alla fine di un pezzo tutto vuoto lo toglie.
export function deleteForward(state: MathState): Outcome {
  const map = mapFormula(state.tex);
  const atom = atomStartingAt(map, state.caret);
  if (!atom) {
    const around = enclosing(map, state.caret);
    if (around && allEmpty(state.tex, around.atom)) return cut(state.tex, around.atom.from, around.atom.to);
    return NONE;
  }
  const first = atom.inner[0];
  if (first) return move(snap(map, first.from));
  if (structural(map, atom)) {
    const next = neighbour(map, state.caret, 1);
    return next === null ? NONE : move(next);
  }
  // Un pezzo che porta un esponente o un pedice lascia il suo spazio vuoto:
  // senza base l'esponente si attaccherebbe al pezzo prima.
  if (atomStartingAt(map, atom.to)?.kind === "script") {
    return edit(`${state.tex.slice(0, atom.from)}{}${state.tex.slice(atom.to)}`, atom.from + 1);
  }
  return cut(state.tex, atom.from, atom.to);
}

/// Le colonne e le righe di un ambiente (`&`, `\\`): toglierle cambierebbe la
/// forma della tabella, e un `array` con una colonna in più non si legge. Si
/// toccano coi gesti delle celle (T66).
function structural(map: FormulaMap, atom: Atom): boolean {
  if (placeAt(map, atom.from).role !== "cell") return false;
  const text = map.tex.slice(atom.from, atom.to).trim();
  return text === "&" || text.startsWith("\\\\") || text.startsWith("\\cr");
}

/// Un testo incollato: senza i delimitatori di una formula (`$…$`, `\(…\)`,
/// `\[…\]`); se ha le graffe dispari, un dollaro o un accento grave lo rifiuta,
/// perché romperebbe la formula o la nota.
export function insertText(state: MathState, text: string): Outcome {
  const body = text.trim().replace(/^(?:\$\$?|\\\(|\\\[)\s*([\s\S]*?)\s*(?:\$\$?|\\\)|\\\])$/, "$1");
  if (!body || body.includes("`") || /(?<!\\)\$/.test(body) || /(?<!\\)%/.test(body)) return NONE;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") {
      i++;
      continue;
    }
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth < 0) return NONE;
  }
  if (depth !== 0 || /\\$/.test(body)) return NONE;
  return put(state, body.replace(/\s*\n\s*/g, " "));
}

/// Il comando che si sta scrivendo, dalla `\` al cursore: `\alp`.
export function pendingName(state: MathState, from: number): string | null {
  const text = state.tex.slice(from, state.caret);
  return /^\\[a-zA-Z]*$/.test(text) ? text.slice(1) : null;
}

/// Mette un simbolo del catalogo (`symbols.ts`) al posto di `[from, caret)`,
/// il nome scritto dopo `\` (o niente, `from` uguale al cursore), coi suoi
/// spazi vuoti: il cursore va su `§`, o nel primo spazio vuoto, o dopo. Un
/// esponente o un pedice (`^{}`, `^\circ`) su un pezzo che ne ha già uno
/// entra su una base vuota, perché due di fila non si leggono; in una riga
/// di tabella `|` diventa `\vert`, che non chiude la cella. Se la formula non
/// si leggerebbe più, niente.
export function insertSymbol(
  state: MathState,
  template: string,
  from: number,
  renders: (tex: string) => boolean,
  options: TypeOptions = {},
): Outcome {
  if (from > state.caret) return NONE;
  if (placeAt(mapFormula(state.tex), from).role === "text") return NONE;
  const before = state.tex.slice(0, from);
  const after = state.tex.slice(state.caret);
  if (template === "^{}" || template === "_{}") {
    // Come il tasto: su un pezzo che ne ha già uno ci si entra.
    const outcome = typeChar({ tex: before + after, caret: from }, template[0]!, options);
    if (outcome.kind === "edit") return renders(outcome.state.tex) ? outcome : NONE;
    if (from === state.caret) return outcome;
    // Il nome scritto se ne va comunque; il cursore va dove l'avrebbe messo il tasto.
    return edit(before + after, outcome.kind === "move" ? outcome.caret : from);
  }
  const body = options.inTable ? template.replace(/\|/g, "\\vert ") : template;
  const mark = body.indexOf("§");
  const clean = body.replace("§", "");
  const hole = clean.indexOf("{}");
  const target = mark >= 0 ? mark : hole >= 0 ? hole + 1 : clean.length;
  const candidates = /^[\^_]/.test(clean) ? [clean, `{}${clean}`] : [clean];
  for (const candidate of candidates) {
    const joined = join(before, candidate, after);
    if (!renders(joined.tex)) continue;
    const shift = candidate.length - clean.length;
    const at = mark < 0 && hole < 0 ? joined.caret : before.length + joined.lead + shift + target;
    return edit(joined.tex, at);
  }
  return NONE;
}

/// Finisce il comando che comincia in `from` (la sua `\`) e arriva al cursore:
/// con gli spazi vuoti dei suoi argomenti (`\frac` diventa `\frac{}{}`, il
/// cursore nel primo). `renders` dice se una formula si legge. Un comando che
/// non conosco, o che vuole argomenti che non si toccano (un colore), resta in
/// sospeso: torna `null`. Una `\` da sola se ne va.
export function finishCommand(state: MathState, from: number, renders: (tex: string) => boolean): Outcome | null {
  const name = pendingName(state, from);
  if (name === null) return null;
  const before = state.tex.slice(0, from);
  const after = state.tex.slice(state.caret);
  if (name === "") return cut(state.tex, from, state.caret);
  const kinds = argumentsOf(name);
  const command = `\\${name}`;
  const candidates = kinds.includes("r") ? [] : kinds ? [command + "{}".repeat(kinds.length)] : [command, `${command}{}`, `${command}{}{}`];
  for (const candidate of candidates) {
    const joined = join(before, candidate, after);
    if (!renders(joined.tex)) continue;
    const start = before.length + joined.lead;
    const hole = candidate.indexOf("{}");
    return edit(joined.tex, hole < 0 ? joined.caret : start + hole + 1);
  }
  return null;
}
