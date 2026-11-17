// I punti della formula dove il cursore può stare (T60, E27). La formula che
// si modifica toccandola resta LaTeX: il cursore è un offset nel TeX, ma può
// stare soltanto fra un pezzo e l'altro, mai a metà di un comando, nel colore
// di un `\color` o nella misura di un `\kern`. Scrivere in uno di questi punti
// non rompe mai la formula (`edit.ts` e il corpus del test lo provano).
//
// Una lettura sola, lineare, senza DOM: i punti con il posto in cui stanno
// («numeratore», «esponente di x») e i pezzi (atomi) con i loro tratti interni,
// che servono a Backspace, a Tab e allo spazio.

/// Che cosa è il tratto in cui sta un punto.
export type Role =
  | "formula"
  | "numerator"
  | "denominator"
  | "exponent"
  | "subscript"
  | "radicand"
  | "text"
  | "argument"
  | "cell";

/// Dove sta un punto, per annunciarlo.
export interface Place {
  readonly role: Role;
  /// Esponente e pedice: ciò che li porta (`x` in `x^{2}`), se è corto.
  readonly base?: string;
  /// Un argomento: il comando che lo prende (`vec`, `overline`).
  readonly command?: string;
  /// In un ambiente (`aligned`, una matrice): riga e colonna, da 1.
  readonly row?: number;
  readonly column?: number;
}

export interface Span {
  readonly from: number;
  readonly to: number;
}

/// Un pezzo della formula: un simbolo, un comando coi suoi argomenti, un
/// esponente, un gruppo, un ambiente, una coppia `\left…\right`.
export interface Atom {
  readonly from: number;
  readonly to: number;
  readonly kind: "char" | "command" | "script" | "group" | "env" | "delimited" | "raw";
  /// I tratti dove il cursore entra: gli argomenti di matematica o di testo,
  /// il corpo. Vuoto per un simbolo.
  readonly inner: readonly Span[];
  /// Per un esponente o un pedice, quale dei due.
  readonly script?: "^" | "_";
}

export interface Point {
  readonly at: number;
  readonly place: Place;
}

export interface FormulaMap {
  readonly tex: string;
  /// I punti buoni, in ordine.
  readonly points: readonly Point[];
  /// Tutti i pezzi, a ogni profondità, nell'ordine in cui finiscono di leggersi.
  readonly atoms: readonly Atom[];
}

type ArgKind = "m" | "t" | "r";

/// Gli argomenti dei comandi che li prendono: `m` matematica, `t` testo (il
/// cursore ci entra), `r` grezzo (un colore, una misura, un indirizzo: il
/// cursore non ci entra). Un comando che non sta qui non prende argomenti: i
/// gruppi che lo seguono sono pezzi a sé, come li legge il prototipo.
const ARGS: Readonly<Record<string, string>> = (() => {
  const table: Record<string, string> = {};
  const put = (kinds: string, names: string) => {
    for (const name of names.split(" ")) table[name] = kinds;
  };
  put("mm", "frac dfrac tfrac cfrac binom dbinom tbinom overset underset stackrel");
  put("m", "sqrt mathrm mathbf mathit mathsf mathtt mathbb mathcal mathfrak mathscr mathnormal boldsymbol bm bold Bbb"
    + " operatorname operatorname* operatornamewithlimits vec bar hat tilde dot ddot dddot check breve acute grave mathring"
    + " widehat widetilde widecheck overline underline overrightarrow overleftarrow overleftrightarrow underrightarrow"
    + " underleftarrow underleftrightarrow overbrace underbrace overgroup undergroup overlinesegment underlinesegment boxed"
    + " cancel bcancel xcancel sout phantom hphantom vphantom smash mathop mathbin mathrel mathord mathopen mathclose"
    + " mathpunct mathinner pmod pod substack xrightarrow xleftarrow xleftrightarrow xRightarrow xLeftarrow"
    + " xLeftrightarrow xhookleftarrow xhookrightarrow xmapsto xtofrom utilde");
  put("t", "text textrm textbf textit textsf texttt textnormal textup textmd emph mbox hbox");
  put("r", "color url hspace hspace* label ref eqref tag tag* includegraphics");
  put("rm", "textcolor href htmlClass htmlId htmlStyle htmlData");
  put("rt", "colorbox raisebox");
  put("rrt", "fcolorbox");
  put("rr", "rule");
  put("rrrrmm", "genfrac");
  return table;
})();

/// I comandi con una parte facoltativa fra quadre prima degli argomenti.
const OPTIONAL: ReadonlySet<string> = new Set([
  "sqrt", "xrightarrow", "xleftarrow", "xleftrightarrow", "xRightarrow", "xLeftarrow", "xLeftrightarrow",
  "xhookleftarrow", "xhookrightarrow", "xmapsto", "xtofrom", "rule", "includegraphics",
]);

/// Gli ambienti con un argomento grezzo dopo il nome (le colonne).
const ENV_ARGS: Readonly<Record<string, number>> = { array: 1, darray: 1, subarray: 1, alignat: 1, "alignat*": 1, alignedat: 1 };

/// I comandi seguiti da una misura senza graffe (`\kern2pt`).
const DIMENSION = new Set(["kern", "mkern", "mskip", "hskip", "hspace", "mspace"]);
const DIMENSION_TEXT = /^\s*[-+]?(?:\d*\.?\d+|\d+\.)\s*(?:em|ex|mu|pt|mm|cm|in|bp|pc|dd|cc|nd|nc|sp|px)/;

/// I comandi che prendono un delimitatore subito dopo.
const DELIMITER_SIZE = /^(?:big|Big|bigg|Bigg)[lrm]?$/;

const letter = (ch: string | undefined): boolean => ch !== undefined && /[a-zA-Z]/.test(ch);
const space = (ch: string | undefined): boolean => ch === " " || ch === "\n" || ch === "\t" || ch === "\r";

/// Il testo corto di un pezzo, per dire di chi è un esponente.
function shortBase(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 16) return undefined;
  return trimmed;
}

interface Context {
  readonly place: Place;
  /// In un ambiente, il conto delle righe e delle colonne.
  cell?: { row: number; column: number };
}

/// Legge la formula: punti e pezzi.
export function mapFormula(tex: string): FormulaMap {
  const v = tex;
  const points = new Map<number, Point>();
  const atoms: Atom[] = [];
  let i = 0;

  const placeOf = (context: Context): Place => context.cell
    ? { ...context.place, row: context.cell.row, column: context.cell.column }
    : context.place;

  /// Il nome di un comando, `\` compreso: le lettere, o un segno solo.
  const name = (): string => {
    const start = i;
    i++;
    if (letter(v[i])) while (letter(v[i])) i++;
    else if (i < v.length) i++;
    return v.slice(start + 1, i);
  };
  const skipSpaces = () => {
    while (v[i] === " " || v[i] === "\n" || v[i] === "\t") i++;
  };
  /// Un gruppo grezzo `{…}`, con le graffe annidate: niente punti dentro.
  const rawGroup = () => {
    let depth = 0;
    for (; i < v.length; i++) {
      if (v[i] === "\\") {
        i++;
        continue;
      }
      if (v[i] === "{") depth++;
      else if (v[i] === "}" && --depth === 0) {
        i++;
        return;
      }
    }
  };
  /// Una parte facoltativa `[…]`, grezza.
  const rawOptional = () => {
    skipSpaces();
    if (v[i] !== "[") return;
    let depth = 0;
    for (; i < v.length; i++) {
      if (v[i] === "{") depth++;
      else if (v[i] === "}") depth--;
      else if (v[i] === "]" && depth <= 0) {
        i++;
        return;
      }
    }
  };
  /// Le righe orizzontali all'inizio di una riga di un ambiente.
  const rules = () => {
    for (;;) {
      const start = i;
      skipSpaces();
      const rule = /^\\(?:hline|hdashline)(?![a-zA-Z])/.exec(v.slice(i));
      if (!rule) {
        i = start;
        return;
      }
      i += rule[0].length;
    }
  };
  /// Un delimitatore dopo `\left`, `\big`: un comando o un segno.
  const delimiter = () => {
    skipSpaces();
    if (v[i] === "\\") name();
    else if (i < v.length) i++;
  };
  /// Un gruppo `{…}` dove il cursore entra.
  const group = (context: Context, inner: Span[]) => {
    i++;
    const from = i;
    seq(context, (at) => v[at] === "}");
    inner.push({ from, to: i });
    if (v[i] === "}") i++;
  };
  /// Un argomento: un gruppo, un comando o un segno solo.
  const argument = (kind: ArgKind, context: Context, inner: Span[]) => {
    skipSpaces();
    if (kind === "r") {
      if (v[i] === "{") rawGroup();
      else if (v[i] === "\\") name();
      else if (i < v.length) i++;
      return;
    }
    if (v[i] === "{") group(context, inner);
    else if (v[i] === "\\") name();
    else if (i < v.length) i++;
  };

  const roleOf = (command: string, index: number, kinds: string): Place => {
    if (kinds[index] === "t") return { role: "text" };
    if (command === "sqrt") return { role: "radicand" };
    if (/^(?:[dtc]?frac|genfrac)$/.test(command)) {
      const first = kinds.indexOf("m");
      return { role: index === first ? "numerator" : "denominator" };
    }
    return { role: "argument", command };
  };

  function atom(context: Context, last: { text: string } | null): void {
    const from = i;
    const ch = v[i];
    if (ch === "{") {
      const inner: Span[] = [];
      group(context, inner);
      atoms.push({ from, to: i, kind: "group", inner });
      return;
    }
    if (ch === "^" || ch === "_") {
      i++;
      skipSpaces();
      const inner: Span[] = [];
      const base = last ? shortBase(last.text) : undefined;
      const place: Place = { role: ch === "^" ? "exponent" : "subscript", ...(base ? { base } : {}) };
      if (v[i] === "{") group({ place }, inner);
      else if (v[i] === "\\") name();
      else if (i < v.length) i++;
      atoms.push({ from, to: i, kind: "script", inner, script: ch });
      return;
    }
    if (ch === "%") {
      while (i < v.length && v[i] !== "\n") i++;
      atoms.push({ from, to: i, kind: "raw", inner: [] });
      return;
    }
    if (ch !== "\\") {
      i++;
      if (ch === "&" && context.cell) context.cell.column++;
      atoms.push({ from, to: i, kind: "char", inner: [] });
      return;
    }
    let command = name();
    if (v[i] === "*" && ARGS[`${command}*`] !== undefined) {
      i++;
      command += "*";
    }
    if (command === "begin") {
      const match = /^\{([a-zA-Z]+\*?)\}/.exec(v.slice(i));
      if (!match) {
        atoms.push({ from, to: i, kind: "command", inner: [] });
        return;
      }
      i += match[0].length;
      for (let n = 0; n < (ENV_ARGS[match[1]!] ?? 0); n++) {
        skipSpaces();
        if (v[i] === "{") rawGroup();
      }
      rules();
      const end = `\\end{${match[1]}}`;
      const inner: Span[] = [];
      const body = i;
      seq({ place: { role: "cell" }, cell: { row: 1, column: 1 } }, (at) => v.startsWith(end, at));
      inner.push({ from: body, to: i });
      if (v.startsWith(end, i)) i += end.length;
      atoms.push({ from, to: i, kind: "env", inner });
      return;
    }
    if (command === "left") {
      delimiter();
      const inner: Span[] = [];
      const body = i;
      seq(context, (at) => v.startsWith("\\right", at) && !letter(v[at + 6]));
      inner.push({ from: body, to: i });
      if (v.startsWith("\\right", i)) {
        i += 6;
        delimiter();
      }
      atoms.push({ from, to: i, kind: "delimited", inner });
      return;
    }
    if (command === "middle" || DELIMITER_SIZE.test(command)) {
      delimiter();
      atoms.push({ from, to: i, kind: "command", inner: [] });
      return;
    }
    if (command === "\\" || command === "cr") {
      // A capo in un ambiente: la misura facoltativa è grezza, e le righe
      // orizzontali (`\hline`) stanno soltanto all'inizio di una riga.
      if (v[i] === "[") rawOptional();
      rules();
      if (context.cell) {
        context.cell.row++;
        context.cell.column = 1;
      }
      atoms.push({ from, to: i, kind: "command", inner: [] });
      return;
    }
    if (DIMENSION.has(command) && v[i] !== "{") {
      const match = DIMENSION_TEXT.exec(v.slice(i));
      if (match) i += match[0].length;
      atoms.push({ from, to: i, kind: "raw", inner: [] });
      return;
    }
    if (command === "char") {
      const match = /^["']?[0-9a-fA-F]+/.exec(v.slice(i));
      if (match) i += match[0].length;
      atoms.push({ from, to: i, kind: "raw", inner: [] });
      return;
    }
    if (command === "verb" || command === "verb*") {
      const close = i < v.length ? v.indexOf(v[i]!, i + 1) : -1;
      i = close < 0 ? v.length : close + 1;
      atoms.push({ from, to: i, kind: "raw", inner: [] });
      return;
    }
    const kinds = ARGS[command] ?? "";
    if (OPTIONAL.has(command)) rawOptional();
    const inner: Span[] = [];
    for (let index = 0; index < kinds.length; index++) {
      const kind = kinds[index] as ArgKind;
      const place = roleOf(command, index, kinds);
      argument(kind, { place }, inner);
    }
    // Lo spazio dopo un comando di lettere è del comando, e così `\limits`
    // dopo un operatore (`\sum\limits`): fra i due non si scrive.
    if (kinds.length === 0 && letter(v[i - 1])) {
      for (;;) {
        while (space(v[i])) i++;
        const limits = /^\\(?:no)?limits(?![a-zA-Z])/.exec(v.slice(i));
        if (!limits) break;
        i += limits[0].length;
      }
    }
    atoms.push({ from, to: i, kind: "command", inner });
  }

  function seq(context: Context, end: ((at: number) => boolean) | null): void {
    let last: { text: string } | null = null;
    for (;;) {
      if (v[i] !== "^" && v[i] !== "_" && !space(v[i]) && !points.has(i)) points.set(i, { at: i, place: placeOf(context) });
      if (i >= v.length || (end ? end(i) : v[i] === "}")) return;
      const start = i;
      atom(context, last);
      if (i <= start) i = start + 1;
      const kind = atoms[atoms.length - 1]?.kind;
      if (kind !== "script" && !space(v[start])) last = { text: v.slice(start, i) };
    }
  }

  seq({ place: { role: "formula" } }, null);
  if (!points.has(v.length)) points.set(v.length, { at: v.length, place: { role: "formula" } });
  return { tex, points: [...points.values()].sort((a, b) => a.at - b.at), atoms };
}

/// Gli offset dei punti buoni, in ordine.
export function stopsOf(map: FormulaMap): number[] {
  return map.points.map((point) => point.at);
}

/// Gli argomenti di un comando (`m` matematica, `t` testo, `r` grezzo); vuoto
/// se non ne prende o se non lo conosco.
export function argumentsOf(command: string): string {
  return ARGS[command] ?? "";
}

/// Il punto buono in `at`, se c'è.
export function pointAt(map: FormulaMap, at: number): Point | undefined {
  return map.points.find((point) => point.at === at);
}

/// Il punto buono più vicino a `at`: quello stesso, o il primo dopo, o l'ultimo.
export function snap(map: FormulaMap, at: number): number {
  for (const point of map.points) if (point.at >= at) return point.at;
  return map.points[map.points.length - 1]?.at ?? 0;
}

/// Il punto buono prima (`-1`) o dopo (`1`) di `at`.
export function neighbour(map: FormulaMap, at: number, dir: -1 | 1): number | null {
  if (dir === 1) {
    for (const point of map.points) if (point.at > at) return point.at;
    return null;
  }
  let found: number | null = null;
  for (const point of map.points) {
    if (point.at >= at) break;
    found = point.at;
  }
  return found;
}

/// Gli spazi vuoti: un punto fra le graffe di un `{}`.
export function holesOf(map: FormulaMap): number[] {
  return map.points.filter((point) => map.tex[point.at - 1] === "{" && map.tex[point.at] === "}").map((point) => point.at);
}

/// Il pezzo che finisce in `at`, nello stesso tratto di `at`.
export function atomEndingAt(map: FormulaMap, at: number): Atom | undefined {
  let found: Atom | undefined;
  for (const atom of map.atoms) {
    if (atom.to !== at || atom.from >= at) continue;
    if (!found || atom.from < found.from) found = atom;
  }
  return found;
}

/// Il pezzo che comincia in `at`, nello stesso tratto di `at`.
export function atomStartingAt(map: FormulaMap, at: number): Atom | undefined {
  let found: Atom | undefined;
  for (const atom of map.atoms) {
    if (atom.from !== at || atom.to <= at) continue;
    if (!found || atom.to > found.to) found = atom;
  }
  return found;
}

/// Il pezzo più interno che ha `at` dentro uno dei suoi tratti, e quel tratto.
export function enclosing(map: FormulaMap, at: number): { atom: Atom; span: Span } | undefined {
  let found: { atom: Atom; span: Span } | undefined;
  for (const atom of map.atoms) {
    for (const span of atom.inner) {
      if (at < span.from || at > span.to) continue;
      if (!found || span.to - span.from < found.span.to - found.span.from) found = { atom, span };
    }
  }
  return found;
}

/// Il posto di un punto; fuori dai punti buoni, quello del punto buono vicino.
export function placeAt(map: FormulaMap, at: number): Place {
  return (pointAt(map, at) ?? pointAt(map, snap(map, at)))?.place ?? { role: "formula" };
}
