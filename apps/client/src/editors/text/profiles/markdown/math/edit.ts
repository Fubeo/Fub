// Le regole della formula che si modifica toccandola (T60, E27), senza DOM: che
// cosa fanno un tasto, Backspace, Tab e lo spazio sul TeX e sul cursore. Ogni
// regola parte da un punto buono (`points.ts`) e arriva in un punto buono, e
// non lascia mai una formula rotta: un simbolo se ne va intero, dopo un pezzo
// Backspace ci entra, un pezzo tutto vuoto se ne va con un tasto solo, le
// graffe restano in pari.
//
// In fondo la scrittura veloce e le regole del campo del LaTeX (T63).
import type { MathHelp } from "../../../live-reveal";
import { commandName, SYMBOLS } from "./symbols";
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
  type Span,
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
/// esce dalla formula. Maiusc Tab torna allo spazio vuoto prima. In una
/// matrice (o in un ambiente con le colonne) Tab passa alla cella dopo, dopo
/// gli spazi vuoti della cella in cui si è (T66).
export function tab(state: MathState, back: boolean): Outcome {
  const map = mapFormula(state.tex);
  const cell = cellTab(map, state.caret, back);
  if (cell !== null) return move(cell);
  const holes = holesIn(map, 0, state.tex.length);
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

// ── Le celle di una matrice (T66) ───────────────────────────────────────────
//
// In un ambiente con le colonne (una matrice, `cases`, `aligned`) le celle
// sono i tratti fra una `&` e l'altra e fra un `\\` e l'altro, contate come le
// conta `points.ts`. Tab passa alla cella dopo; in una matrice Invio passa
// alla riga dopo, e dall'ultima ne aggiunge una vuota. Una cella vuota di una
// matrice è uno spazio vuoto: si disegna col suo quadretto (`caret.ts`).

/// Una cella: il suo tratto nel TeX, riga e colonna da 1.
export interface Cell {
  readonly from: number;
  readonly to: number;
  readonly row: number;
  readonly column: number;
}

/// Gli ambienti fatti a tabella, dove Invio passa alla riga dopo e una cella
/// vuota ha il suo quadretto. Gli allineamenti (`aligned`, `gathered`) no:
/// lì Invio va a capo e allinea gli uguali (T65), e la prima cella di una
/// riga `&= …` è vuota di proposito.
const TABLE_ENVS = /^(?:[pbBvV]?matrix|smallmatrix|array|darray|subarray|d?cases|d?rcases)\*?$/;

/// Il nome di un ambiente: `pmatrix` per `\begin{pmatrix}…`.
function envName(tex: string, atom: Atom): string {
  return /^\\begin\{([a-zA-Z]+\*?)\}/.exec(tex.slice(atom.from, atom.to))?.[1] ?? "";
}

/// Ciò che divide le celle: una `&`, un `\\` o un `\cr`.
function isSeparator(map: FormulaMap, atom: Atom): boolean {
  const text = map.tex.slice(atom.from, atom.to);
  return (atom.kind === "char" && text === "&") || (atom.kind === "command" && /^\\(?:\\|cr(?![a-zA-Z]))/.test(text));
}

const sameSpan = (a: Span | undefined, b: Span) => a !== undefined && a.from === b.from && a.to === b.to;

/// Le celle dell'ambiente `env`, in ordine: contano soltanto le `&` e i `\\`
/// del suo corpo, non quelli di una matrice dentro una cella.
function cellsOf(map: FormulaMap, env: Atom): Cell[] {
  const body = env.inner[0];
  if (!body) return [];
  const separators = map.atoms
    .filter((atom) => atom.from >= body.from && atom.to <= body.to && isSeparator(map, atom))
    .filter((atom) => sameSpan(enclosing(map, atom.from)?.span, body))
    .sort((a, b) => a.from - b.from);
  const cells: Cell[] = [];
  let row = 1;
  let column = 1;
  let start = body.from;
  for (const separator of separators) {
    cells.push({ from: start, to: separator.from, row, column });
    if (map.tex[separator.from] === "&") {
      column++;
    } else {
      row++;
      column = 1;
    }
    start = separator.to;
  }
  cells.push({ from: start, to: body.to, row, column });
  return cells;
}

/// L'ambiente più interno che ha `at` nel suo corpo, col suo nome e le sue
/// celle.
export function tableAt(map: FormulaMap, at: number): { readonly env: Atom; readonly name: string; readonly cells: readonly Cell[] } | null {
  let found: Atom | undefined;
  for (const atom of map.atoms) {
    const body = atom.inner[0];
    if (atom.kind !== "env" || !body || at < body.from || at > body.to) continue;
    if (!found || atom.to - atom.from < found.to - found.from) found = atom;
  }
  if (!found) return null;
  return { env: found, name: envName(map.tex, found), cells: cellsOf(map, found) };
}

/// La cella in cui sta `at`. Il punto davanti a una `&` è della cella prima.
function cellIndex(cells: readonly Cell[], at: number): number {
  return cells.findIndex((cell) => cell.from <= at && at <= cell.to);
}

/// Gli spazi vuoti di un tratto: i `{}` e le celle vuote.
function holesIn(map: FormulaMap, from: number, to: number): number[] {
  return [...new Set([...holesOf(map), ...emptyCells(map)])].filter((at) => at >= from && at <= to).sort((a, b) => a - b);
}

/// Dove va il cursore entrando in una cella: nel primo spazio vuoto (l'ultimo
/// tornando indietro), se no in fondo a ciò che c'è scritto.
function cellStop(map: FormulaMap, cell: Cell, back: boolean): number {
  const holes = holesIn(map, cell.from, cell.to);
  const hole = back ? holes[holes.length - 1] : holes[0];
  if (hole !== undefined) return hole;
  let end = cell.to;
  while (end > cell.from && /\s/.test(map.tex[end - 1]!)) end--;
  return Math.min(snap(map, end), cell.to);
}

/// Tab in una cella: allo spazio vuoto dopo nella stessa cella, se no alla
/// cella dopo (Maiusc Tab: prima). `null` fuori da un ambiente, o dall'ultima
/// cella (dalla prima, all'indietro): lì vale il Tab di sempre, che esce.
function cellTab(map: FormulaMap, caret: number, back: boolean): number | null {
  const table = tableAt(map, caret);
  if (!table) return null;
  const index = cellIndex(table.cells, caret);
  const cell = table.cells[index];
  if (!cell) return null;
  const holes = holesIn(map, cell.from, cell.to).filter((at) => (back ? at < caret : at > caret));
  const hole = back ? holes[holes.length - 1] : holes[0];
  if (hole !== undefined) return hole;
  const next = table.cells[index + (back ? -1 : 1)];
  return next ? cellStop(map, next, back) : null;
}

/// Invio in una matrice: la cella sotto, nella stessa colonna (o l'ultima di
/// una riga più corta); dall'ultima riga, una riga nuova con tante celle
/// vuote quante le colonne, e il cursore nella prima. `null` fuori da una
/// tabella: Invio fa quello di sempre.
export function cellEnter(state: MathState): Outcome | null {
  const map = mapFormula(state.tex);
  const table = tableAt(map, state.caret);
  if (!table || !TABLE_ENVS.test(table.name)) return null;
  const cell = table.cells[cellIndex(table.cells, state.caret)];
  if (!cell) return null;
  const below = table.cells.filter((other) => other.row === cell.row + 1);
  if (below.length > 0) {
    const target = below.find((other) => other.column === cell.column) ?? below[below.length - 1]!;
    return move(cellStop(map, target, false));
  }
  const columns = Math.max(...table.cells.map((other) => other.column));
  const body = table.env.inner[0]!;
  let at = body.to;
  while (at > body.from && /\s/.test(state.tex[at - 1]!)) at--;
  const head = " \\\\ ";
  const row = `${head}${"& ".repeat(columns - 1)}`;
  const tex = state.tex.slice(0, at) + row + state.tex.slice(body.to);
  return edit(tex, at + head.length);
}

/// Le celle vuote delle matrici: il punto di ognuna, che si disegna come un
/// quadretto e dove Tab si ferma.
export function emptyCells(map: FormulaMap): number[] {
  const out: number[] = [];
  for (const atom of map.atoms) {
    if (atom.kind !== "env" || !TABLE_ENVS.test(envName(map.tex, atom))) continue;
    for (const cell of cellsOf(map, atom)) {
      if (map.tex.slice(cell.from, cell.to).trim() !== "") continue;
      const at = snap(map, cell.from);
      if (at <= cell.to) out.push(at);
    }
  }
  return out.sort((a, b) => a - b);
}

// ── Scegliere un pezzo (T66) ────────────────────────────────────────────────
//
// Maiusc con le frecce, o il trascinamento, sceglie pezzi interi di uno stesso
// tratto: una scelta che comincia a metà di una frazione si allarga alla
// frazione, un esponente non si sceglie senza ciò che lo porta, e una scelta
// che passa da una cella all'altra prende la matrice intera. Così ciò che si
// sceglie si copia, si toglie o va sotto una radice, in una frazione, in un
// esponente, e la formula resta sempre buona.

const blankAtom = (map: FormulaMap, atom: Atom) => atom.kind === "char" && /^\s+$/.test(map.tex.slice(atom.from, atom.to));

/// Il tratto più interno che contiene `from` e `to`, o la formula intera.
function commonSpan(map: FormulaMap, from: number, to: number): Span {
  let found: Span = { from: 0, to: map.tex.length };
  for (const atom of map.atoms) {
    for (const span of atom.inner) {
      if (span.from <= from && to <= span.to && span.to - span.from < found.to - found.from) found = span;
    }
  }
  return found;
}

/// Il pezzo più esterno, dentro `span`, che ha `at` strettamente dentro.
function pieceAround(map: FormulaMap, span: Span, at: number): Atom | undefined {
  let found: Atom | undefined;
  for (const atom of map.atoms) {
    if (atom.from < span.from || atom.to > span.to || !(atom.from < at && at < atom.to)) continue;
    if (!found || atom.from < found.from) found = atom;
  }
  return found;
}

/// Il pezzo più lungo che comincia in `at` dentro `span`.
function pieceFrom(map: FormulaMap, span: Span, at: number): Atom | undefined {
  let found: Atom | undefined;
  for (const atom of map.atoms) {
    if (atom.from !== at || atom.to <= at || atom.to > span.to) continue;
    if (!found || atom.to > found.to) found = atom;
  }
  return found;
}

/// Il pezzo più lungo che finisce in `at` dentro `span`, saltando gli spazi.
function pieceBefore(map: FormulaMap, span: Span, at: number): Atom | undefined {
  const atom = atomBefore(map, at);
  return atom && atom.from >= span.from ? atom : undefined;
}

/// Il pezzo scelto fra `anchor` e `head`, allargato a pezzi interi di uno
/// stesso tratto, senza spazi ai capi; `null` se è vuoto.
export function choosePiece(tex: string, anchor: number, head: number): Span | null {
  const map = mapFormula(tex);
  let from = Math.min(anchor, head);
  let to = Math.max(anchor, head);
  if (from === to) return null;
  // Ogni giro può solo allargare la scelta: finisce in pochi passi.
  for (let round = 0; round < 64; round++) {
    const span = commonSpan(map, from, to);
    let nextFrom = pieceAround(map, span, from)?.from ?? from;
    let nextTo = pieceAround(map, span, to)?.to ?? to;
    // Un esponente o un pedice va con ciò che lo porta, e viceversa.
    while (pieceFrom(map, span, nextFrom)?.kind === "script") {
      const base = pieceBefore(map, span, nextFrom);
      if (!base) break;
      nextFrom = base.from;
    }
    for (;;) {
      let after = pieceFrom(map, span, nextTo);
      let at = nextTo;
      while (after && blankAtom(map, after)) {
        at = after.to;
        after = pieceFrom(map, span, at);
      }
      if (after?.kind !== "script") break;
      nextTo = after.to;
    }
    // Una `&`, un `\\` o un `\middle` presi senza il loro ambiente
    // romperebbero la forma: si prende il pezzo che li contiene (la matrice,
    // la coppia di parentesi).
    const owner = map.atoms.find((atom) => (atom.kind === "env" || atom.kind === "delimited") && sameSpan(atom.inner[0], span));
    const broken = owner !== undefined && map.atoms.some((atom) => atom.from >= nextFrom && atom.to <= nextTo
      && sameSpan(enclosing(map, atom.from)?.span, span)
      && (owner.kind === "env" ? isSeparator(map, atom) : /^\\middle(?![a-zA-Z])/.test(tex.slice(atom.from, atom.to))));
    if (owner && broken) {
      nextFrom = owner.from;
      nextTo = owner.to;
    }
    if (nextFrom === from && nextTo === to) break;
    from = nextFrom;
    to = nextTo;
  }
  while (from < to && /\s/.test(tex[from]!)) from++;
  while (to > from && /\s/.test(tex[to - 1]!)) to--;
  return from < to ? { from, to } : null;
}

/// Maiusc ← e →: la punta della scelta salta un pezzo intero del suo tratto;
/// in fondo al tratto prende il pezzo che lo contiene. `null` ai capi della
/// formula.
export function stepPiece(tex: string, head: number, dir: -1 | 1): number | null {
  const map = mapFormula(tex);
  const span = commonSpan(map, head, head);
  /// Il pezzo dopo `at`, saltando gli spazi.
  const next = (at: number) => {
    let atom = pieceFrom(map, span, at);
    while (atom && blankAtom(map, atom)) atom = pieceFrom(map, span, atom.to);
    return atom;
  };
  // Un pezzo con i suoi esponenti e pedici è un passo solo.
  if (dir > 0) {
    let atom = next(head);
    if (atom) {
      let end = atom.to;
      for (atom = next(end); atom?.kind === "script"; atom = next(end)) end = atom.to;
      return end;
    }
  } else {
    let atom = pieceBefore(map, span, head);
    if (atom) {
      while (atom.kind === "script") {
        const base = pieceBefore(map, span, atom.from);
        if (!base) break;
        atom = base;
      }
      return atom.from;
    }
  }
  const around = enclosing(map, head);
  if (!around) return null;
  return dir > 0 ? around.atom.to : around.atom.from;
}

/// Il LaTeX del pezzo scelto, da copiare.
export function pieceText(tex: string, piece: Span): string {
  return tex.slice(piece.from, piece.to).trim();
}

/// Toglie il pezzo scelto (Backspace, Canc, Ctrl X, un tasto che lo
/// sostituisce): il cursore va dov'era il pezzo.
export function removePiece(tex: string, piece: Span): Outcome {
  return cut(tex, piece.from, piece.to);
}

/// Mette il pezzo scelto dentro un modello del catalogo: sotto la radice, nel
/// numeratore, nell'esponente (`^{}` lo appende a ciò che lo precede), in un
/// testo, fra due parentesi, nella prima cella di una matrice. Dove il
/// modello non ha un posto per lui (gli estremi di una sommatoria), o dove il
/// pezzo non ci sta (una potenza dentro un testo), il modello va davanti e il
/// pezzo resta dopo; un simbolo senza spazi vuoti lo sostituisce. Il cursore
/// va nello spazio vuoto dopo il pezzo, se c'è, se no dopo il modello.
export function wrapPiece(
  tex: string,
  piece: Span,
  template: string,
  renders: (tex: string) => boolean,
  options: TypeOptions = {},
): Outcome {
  const inner = tex.slice(piece.from, piece.to);
  const before = tex.slice(0, piece.from);
  const after = tex.slice(piece.to);
  const body = options.inTable ? template.replace(/\|/g, "\\vert ") : template;
  const mark = body.indexOf("§");
  const clean = body.replace("§", "");
  const hole = clean.indexOf("{}");
  const target = mark >= 0 ? mark : hole >= 0 ? hole + 1 : -1;
  if (target < 0) return insertSymbol({ tex: before + after, caret: piece.from }, template, piece.from, renders, options);
  const shape = enclosing(mapFormula(clean), target);
  if (shape && (shape.atom.kind !== "script" || shape.atom.from === 0)) {
    const filled = clean.slice(0, target) + inner + clean.slice(target);
    const candidates = /^[\^_]/.test(clean) ? [filled, `{}${filled}`] : [filled];
    for (const candidate of candidates) {
      const joined = join(before, candidate, after);
      if (!renders(joined.tex)) continue;
      const start = before.length + joined.lead;
      const filledEnd = start + (candidate.length - filled.length) + target + inner.length;
      const next = holesOf(mapFormula(joined.tex)).find((at) => at >= filledEnd && at <= start + candidate.length);
      return edit(joined.tex, next ?? joined.caret);
    }
  }
  // Il modello davanti, il pezzo dopo: il cursore nel primo spazio vuoto.
  const joined = join(before, clean, inner + after);
  if (!renders(joined.tex)) return NONE;
  return edit(joined.tex, before.length + joined.lead + target);
}

/// Una coppia di parentesi attorno al pezzo scelto: `(` scrive `(…)`, e il
/// cursore va dopo la chiusa.
export function wrapPair(tex: string, piece: Span, open: "(" | "["): Outcome {
  const close = open === "(" ? ")" : "]";
  const joined = join(tex.slice(0, piece.from), `${open}${tex.slice(piece.from, piece.to)}${close}`, tex.slice(piece.to));
  return edit(joined.tex, joined.caret);
}

// ── La scrittura veloce (T63) ───────────────────────────────────────────────
//
// Quello che si scrive com'è diventa LaTeX: `a/` una frazione, `->` una
// freccia, `alpha` e uno spazio la lettera greca, `3,14` la virgola
// decimale, `"due parole"` il testo dritto. Ogni trasformazione si annulla con
// Backspace subito dopo, che rimette ciò che si era scritto. Le regole sono
// quelle del prototipo (`quick`, `MUNI`, `MPAIR`, `MWORD`), sul TeX e senza
// DOM: le usa il campo del LaTeX, e la formula che si tocca dopo che il tasto
// ha scritto il suo segno.

/// I caratteri che una tastiera (o un'altra app) scrive già disegnati.
const UNICODE: Readonly<Record<string, string>> = {
  "α": "\\alpha ", "β": "\\beta ", "γ": "\\gamma ", "δ": "\\delta ", "θ": "\\theta ", "λ": "\\lambda ", "μ": "\\mu ",
  "π": "\\pi ", "σ": "\\sigma ", "ω": "\\omega ", "×": "\\times ", "·": "\\cdot ", "÷": "\\div ", "≤": "\\le ",
  "≥": "\\ge ", "≠": "\\ne ", "≈": "\\approx ", "±": "\\pm ", "∞": "\\infty ", "→": "\\to ", "∑": "\\sum ",
  "∫": "\\int ", "√": "\\sqrt{}", "²": "^2", "³": "^3", "°": "^\\circ ", "∈": "\\in ",
};

/// I segni scritti con più tasti: il più lungo prima (`<->` prima di `->`).
const PAIRS: readonly (readonly [string, string])[] = [
  ["<->", "\\leftrightarrow "], ["->", "\\to "], ["=>", "\\Rightarrow "], ["<=", "\\le "], [">=", "\\ge "],
  ["!=", "\\ne "], ["+-", "\\pm "], ["~=", "\\approx "], ["...", "\\dots "],
];

/// Le parole che diventano un comando quando sono finite (uno spazio, un
/// segno): le lettere greche, le funzioni, e la scrittura veloce di ogni
/// simbolo del catalogo che ne ha una fatta di lettere.
const WORDS: ReadonlyMap<string, string> = (() => {
  const words = new Map<string, string>();
  for (const word of ["alpha", "beta", "gamma", "delta", "theta", "lambda", "mu", "pi", "sigma", "omega", "phi", "rho", "tau", "sum", "int", "lim", "sin", "cos", "tan", "log", "ln", "min", "max"]) {
    words.set(word, `\\${word}`);
  }
  for (const symbol of SYMBOLS) {
    if (/^[a-z]{2,7}$/.test(symbol.quick) && commandName(symbol) === `\\${symbol.quick}`) words.set(symbol.quick, `\\${symbol.quick}`);
  }
  words.set("sqrt", "\\sqrt{}");
  words.set("inf", "\\infty");
  return words;
})();

/// Le parole della scrittura veloce, per la prova del catalogo.
export const QUICK_WORDS: ReadonlySet<string> = new Set(WORDS.keys());

/// Una trasformazione appena fatta: Backspace con il cursore in `at` rimette
/// `literal` al posto di `replaced`, che comincia in `from`.
export interface QuickUndo {
  readonly at: number;
  readonly from: number;
  readonly replaced: string;
  readonly literal: string;
}

export interface QuickWrite {
  readonly state: MathState;
  /// `null` quando il gesto non si annulla (un segno che esce da un esponente).
  readonly undo: QuickUndo | null;
}

export interface QuickOptions {
  readonly help: MathHelp;
  /// `3,14` con la virgola decimale all'italiana (`3{,}14`): solo in italiano;
  /// in inglese la virgola separa.
  readonly decimalComma: boolean;
}

/// Il cursore sta dentro un testo (`\text{…` ancora aperto): lì si scrive
/// com'è, `->` compreso.
export function inTextGroup(before: string): boolean {
  return /\\(?:text|textrm|textbf|textit|mathrm|operatorname)\{[^{}]*$/.test(before);
}

const NUMERATOR = /(\([^()]*\)|\\[a-zA-Z]+(?:\{[^{}]*\})+|\\[a-zA-Z]+ ?|(?<![\\A-Za-z0-9.])[A-Za-z0-9.]+(?:[\^_](?:\{[^{}]*\}|[A-Za-z0-9]))*)\/$/;
const WORD_END = /(?<![\\a-zA-Z])([a-zA-Z]{2,7})([^a-zA-Z\\])$/;

/// La scrittura veloce dopo che `typed` è entrato davanti al cursore. `null`
/// se non c'è niente da trasformare: il testo resta com'è. Con `discrete`
/// valgono solo i caratteri già disegnati e le cifre di un esponente (che
/// senza graffe resterebbero fuori); con `spente` niente.
export function quickWrite(state: MathState, typed: string, options: QuickOptions): QuickWrite | null {
  if (options.help === "spente" || !typed) return null;
  const { tex, caret } = state;
  const before = tex.slice(0, caret);
  if (!before.endsWith(typed) || inTextGroup(before)) return null;
  const swap = (length: number, to: string, offset = to.length): QuickWrite => {
    const from = caret - length;
    const at = from + offset;
    return {
      state: { tex: tex.slice(0, from) + to + tex.slice(caret), caret: at },
      undo: { at, from, replaced: to, literal: before.slice(from) },
    };
  };
  // Un esponente di più cifre si è raggruppato da solo: il primo segno che non
  // è una cifra ne esce.
  if (!/[\dA-Za-z{}]/.test(typed) && tex[caret] === "}" && /[\^_]\{\d+.$/.test(before)) {
    const out = tex.slice(0, caret - typed.length) + "}" + typed + tex.slice(caret + 1);
    return { state: { tex: out, caret: caret + 1 }, undo: null };
  }
  const drawn = UNICODE[typed];
  if (drawn) return swap(typed.length, drawn, drawn.endsWith("{}") ? drawn.length - 1 : drawn.length);
  if (/^\d$/.test(typed)) {
    const script = /([\^_])(\d)(\d)$/.exec(before);
    if (script) return swap(3, `${script[1]}{${script[2]}${script[3]}}`, 4);
    const decimal = options.help === "piene" && options.decimalComma ? /(\d),(\d)$/.exec(before) : null;
    if (decimal) return swap(3, `${decimal[1]}{,}${decimal[2]}`);
  }
  if (options.help !== "piene") return null;
  for (const [keys, to] of PAIRS) if (before.endsWith(keys)) return swap(keys.length, to);
  if (typed === "/") {
    const match = NUMERATOR.exec(before);
    if (match) {
      const numerator = match[1]!.replace(/^\((.*)\)$/, "$1").trimEnd();
      const to = `\\frac{${numerator}}{}`;
      return swap(match[0].length, to, to.length - 1);
    }
  }
  if (typed === "\"") {
    const match = /"([^"]+)"$/.exec(before);
    if (match) return swap(match[0].length, `\\text{${match[1]}}`);
  }
  const word = WORD_END.exec(before);
  const command = word ? WORDS.get(word[1]!) : undefined;
  if (word && command) {
    const after = word[2]!;
    if (command.endsWith("{}")) {
      // `sqrt` e uno spazio (o una parentesi) aprono la radice; un altro segno
      // ci va dentro.
      const inner = after === " " || after === "(" ? "" : after;
      const to = `${command.slice(0, -1)}${inner}}`;
      return swap(word[0].length, to, to.length - 1);
    }
    return swap(word[0].length, `${command}${after}`);
  }
  return null;
}

/// Backspace subito dopo una trasformazione: rimette ciò che si era scritto.
/// `null` se il cursore non è più lì o il testo è cambiato.
export function undoQuick(state: MathState, undo: QuickUndo): MathState | null {
  if (state.caret !== undo.at) return null;
  const { tex } = state;
  if (tex.slice(undo.from, undo.from + undo.replaced.length) !== undo.replaced) return null;
  return {
    tex: tex.slice(0, undo.from) + undo.literal + tex.slice(undo.from + undo.replaced.length),
    caret: undo.from + undo.literal.length,
  };
}

const OPENERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/// Una parentesi che si chiude da sola: `(` scrive `()` col cursore in mezzo.
/// Dopo una `\` (`\{`) no: è un segno, non un gruppo.
export function openPair(state: MathState, key: string): MathState | null {
  const close = OPENERS[key];
  if (!close) return null;
  const before = state.tex.slice(0, state.caret);
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(before)) return null;
  return { tex: before + key + close + state.tex.slice(state.caret), caret: state.caret + 1 };
}

/// La parentesi chiusa che c'è già: il tasto la scavalca invece di scriverne
/// un'altra.
export function stepOver(state: MathState, key: string): number | null {
  return (key === ")" || key === "]" || key === "}") && state.tex[state.caret] === key ? state.caret + 1 : null;
}

/// Backspace fra due parentesi vuote le toglie tutte e due.
export function dropPair(state: MathState): MathState | null {
  const { tex, caret } = state;
  if (caret === 0 || !["{}", "()", "[]"].includes(tex.slice(caret - 1, caret + 1))) return null;
  if (tex[caret - 2] === "\\") return null;
  return { tex: tex.slice(0, caret - 1) + tex.slice(caret + 1), caret: caret - 1 };
}

// ── Il campo del LaTeX (T63) ────────────────────────────────────────────────

/// Gli spazi vuoti scritti nel LaTeX: il punto dentro ogni `{}`.
export function sourceHoles(tex: string): number[] {
  const out: number[] = [];
  for (let i = tex.indexOf("{}"); i >= 0; i = tex.indexOf("{}", i + 1)) {
    if (tex[i - 1] !== "\\") out.push(i + 1);
  }
  return out;
}

/// Tab nel campo del LaTeX: allo spazio vuoto dopo; senza, fuori dalla graffa
/// in cui si è; in fondo esce dalla formula. Maiusc Tab allo spazio vuoto
/// prima.
export function sourceTab(state: MathState, back: boolean): Outcome {
  const holes = sourceHoles(state.tex);
  if (back) {
    const previous = holes.filter((at) => at < state.caret).pop();
    return previous === undefined ? NONE : move(previous);
  }
  const next = holes.find((at) => at > state.caret);
  if (next !== undefined) return move(next);
  const close = state.tex.indexOf("}", state.caret);
  if (close >= 0 && state.caret < state.tex.length) return move(close + 1);
  return { kind: "leave", side: "after" };
}

/// Un modello del catalogo nel campo del LaTeX, al posto di `[from, to)`: il
/// cursore va su `§`, o nel primo spazio vuoto, o dopo. Un comando di lettere
/// non si incolla alla lettera che segue.
export function insertTemplate(state: MathState, template: string, from: number, to = state.caret): MathState {
  const mark = template.indexOf("§");
  const clean = template.replace("§", "");
  const hole = clean.indexOf("{}");
  const target = mark >= 0 ? mark : hole >= 0 ? hole + 1 : -1;
  const joined = join(state.tex.slice(0, from), clean, state.tex.slice(to));
  return { tex: joined.tex, caret: target < 0 ? joined.caret : from + joined.lead + target };
}
