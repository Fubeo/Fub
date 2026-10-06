// I fogli di stile di un disegno letti per ciò che scelgono: le regole coi
// loro selettori, e se un selettore sceglie un elemento. Le dichiarazioni non
// si leggono. Serve ai comandi che spostano gli elementi senza cambiarli: un
// foglio che sceglie per posizione, come `#m .node rect` di Mermaid,
// sceglierebbe altro dopo lo spostamento, e ciò che si vede cambierebbe.
//
// - **I selettori che si trovano negli SVG**, come li legge un browser: tipo
//   e universale coi namespace di `@namespace`, id, classi, attributi con
//   ogni operatore e coi modificatori `i` e `s`, i quattro combinatori, le
//   pseudo-classi strutturali, `:not()`, `:is()`, `:where()`, `:lang()`,
//   `:root` ed `:empty`.
// - **Tre risposte:** sì, no, o non si sa. Non si sa per `:has()`, per le
//   pseudo-classi che qui non si conoscono e per ciò che non si legge, come
//   le regole annidate o `@scope`; chi chiede tratta il dubbio come un
//   cambiamento.
// - **Senza interazione.** Un disegno si guarda come immagine, dove non si
//   passa col puntatore: `:hover`, `:focus` e le altre pseudo-classi
//   d'interazione non scelgono niente. Un selettore con uno pseudo-elemento
//   non sceglie l'elemento.
// - **Le regole condizionate contano tutte:** quelle dentro `@media`,
//   `@supports`, `@layer`, `@container` e `@starting-style`, perché la
//   condizione non dipende da dove sta un elemento. Un selettore che un
//   browser non accetta toglie la sua regola, e così una regola vuota.

import { commentEnd, escapeEnd, isNameChar, readName, stringEnd } from "./stylesheet";

/// Sì, no, o non si sa.
export type Maybe = boolean | null;

/// Un attributo di un elemento, col namespace: `""` se non ne ha.
export interface StyleAttr {
  readonly uri: string;
  readonly local: string;
  readonly value: string;
}

/// Un elemento come lo vede un selettore.
export interface StyleNode {
  readonly uri: string;
  readonly local: string;
  readonly attrs: readonly StyleAttr[];
  /// `null` per la radice.
  readonly parent: StyleNode | null;
  /// I figli elemento, in ordine.
  readonly children: readonly StyleNode[];
  /// Vero se fra i figli c'è del testo, anche solo spazi.
  readonly text: boolean;
}

type Combinator = " " | ">" | "+" | "~";

/// Un selettore complesso: i composti da sinistra, e fra ciascuno e il
/// successivo il suo combinatore.
interface Complex {
  readonly compounds: readonly Compound[];
  readonly combinators: readonly Combinator[];
}

type Compound = readonly Simple[];

type AttrOp = "=" | "~=" | "|=" | "^=" | "$=" | "*=";

/// Un selettore semplice. Un namespace `null` è uno qualunque, `""` nessuno.
type Simple =
  | { readonly kind: "type"; readonly local: string | null; readonly ns: string | null }
  | { readonly kind: "id"; readonly name: string }
  | { readonly kind: "class"; readonly name: string }
  | { readonly kind: "attr"; readonly ns: string | null; readonly local: string; readonly op: AttrOp | null; readonly value: string; readonly fold: boolean }
  | { readonly kind: "nth"; readonly a: number; readonly b: number; readonly last: boolean; readonly ofType: boolean; readonly of: readonly Selector[] | null }
  | { readonly kind: "root" }
  | { readonly kind: "empty" }
  | { readonly kind: "link" }
  | { readonly kind: "not"; readonly list: readonly Selector[] }
  | { readonly kind: "is"; readonly list: readonly Selector[] }
  | { readonly kind: "lang"; readonly ranges: readonly string[] }
  /// `:has()`, che non si sa e che guarda dentro.
  | { readonly kind: "has" }
  | { readonly kind: "fixed"; readonly value: Maybe };

/// Un selettore di una regola; `null` se non si legge e non si sa che cosa
/// sceglie.
export type Selector = Complex | null;

/// I selettori di un foglio, nell'ordine delle regole.
export interface Sheet {
  readonly selectors: readonly Selector[];
  /// Vero se un selettore guarda dentro gli elementi, con `:has()`: ciò che
  /// sceglie dipende anche da ciò che sta sotto e dopo.
  readonly deep: boolean;
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/// Le at-rule che contengono regole che contano tutte.
const GROUPING: ReadonlySet<string> = new Set(["media", "supports", "layer", "container", "document", "-moz-document", "starting-style"]);

/// Le pseudo-classi d'interazione, o dei moduli, che in un disegno non
/// scelgono niente.
const NEVER: ReadonlySet<string> = new Set([
  "active", "autofill", "-webkit-autofill", "blank", "buffering", "checked", "closed", "current", "default", "disabled", "enabled",
  "focus", "focus-visible", "focus-within", "fullscreen", "future", "hover", "in-range", "indeterminate", "invalid", "local-link",
  "modal", "muted", "open", "optional", "out-of-range", "past", "paused", "picture-in-picture", "placeholder-shown", "playing",
  "popover-open", "read-write", "required", "seeking", "stalled", "target", "target-within", "user-invalid", "user-valid", "valid",
  "visited", "volume-locked",
]);

/// Le pseudo-classi che scelgono ogni elemento di un disegno.
const ALWAYS: ReadonlySet<string> = new Set(["defined", "read-only"]);

/// Gli pseudo-elementi che si scrivono anche con un solo `:`.
const LEGACY_ELEMENTS: ReadonlySet<string> = new Set(["before", "after", "first-line", "first-letter"]);

/// Le pseudo-classi che prendono una lista di selettori che scelgono.
const ANY_OF: ReadonlySet<string> = new Set(["is", "where", "matches", "-webkit-any", "-moz-any"]);

// ---------------------------------------------------------------------------
// Fogli.
// ---------------------------------------------------------------------------

/// I selettori del foglio `css`.
export function readSheet(css: string): Sheet {
  const reader = new SheetReader(css);
  reader.rules(0, css.length);
  return { selectors: reader.selectors, deep: reader.deep };
}

class SheetReader {
  readonly selectors: Selector[] = [];
  deep = false;
  /// I namespace dichiarati, per prefisso; il predefinito sta a `null`.
  private readonly namespaces = new Map<string | null, string>();

  constructor(private readonly css: string) {}

  /// Le regole fra `from` e `to`.
  rules(from: number, to: number): void {
    const css = this.css;
    let i = from;
    while (i < to) {
      const c = css[i]!;
      if (/\s/.test(c) || c === ";" || c === "}") i++;
      else if (c === "/" && css[i + 1] === "*") i = commentEnd(css, i);
      else if (css.startsWith("<!--", i)) i += 4;
      else if (css.startsWith("-->", i)) i += 3;
      else i = c === "@" ? this.atRule(i, to) : this.rule(i, to);
    }
  }

  /// La fine del preludio che comincia in `at`: il `{` o il `;` fuori da
  /// stringhe, commenti e parentesi, o `to`.
  private preludeEnd(at: number, to: number): number {
    const css = this.css;
    let depth = 0;
    let i = at;
    while (i < to) {
      const c = css[i]!;
      if (c === '"' || c === "'") i = stringEnd(css, i);
      else if (c === "/" && css[i + 1] === "*") i = commentEnd(css, i);
      else if (c === "\\") i = escapeEnd(css, i);
      else if (c === "(" || c === "[") (depth++, i++);
      else if (c === ")" || c === "]") (depth = Math.max(0, depth - 1), i++);
      else if (depth === 0 && (c === "{" || c === ";" || c === "}")) return i;
      else i++;
    }
    return Math.min(i, to);
  }

  /// La fine del blocco che si apre col `{` in `at`, dopo il `}` che lo
  /// chiude, o `to`; e se dentro c'è un altro blocco.
  private blockEnd(at: number, to: number): [end: number, nested: boolean] {
    const css = this.css;
    let depth = 0;
    let nested = false;
    let i = at;
    while (i < to) {
      const c = css[i]!;
      if (c === '"' || c === "'") i = stringEnd(css, i);
      else if (c === "/" && css[i + 1] === "*") i = commentEnd(css, i);
      else if (c === "\\") i = escapeEnd(css, i);
      else if (c === "{") {
        if (depth > 0) nested = true;
        depth++;
        i++;
      } else if (c === "}") {
        depth--;
        i++;
        if (depth === 0) return [i, nested];
      } else i++;
    }
    return [Math.min(i, to), nested];
  }

  /// Vero se fra `from` e `to` c'è qualcosa oltre a spazi e commenti.
  private filled(from: number, to: number): boolean {
    const css = this.css;
    for (let i = from; i < to; ) {
      if (/\s/.test(css[i]!)) i++;
      else if (css[i] === "/" && css[i + 1] === "*") i = commentEnd(css, i);
      else return true;
    }
    return false;
  }

  /// Una regola coi selettori, che finisce dove torna il suo indice.
  private rule(at: number, to: number): number {
    const css = this.css;
    const end = this.preludeEnd(at, to);
    // Senza blocco la regola non vale, e si salta fino al `;` o al `}`.
    if (end >= to || css[end] !== "{") return end + 1;
    const [close, nested] = this.blockEnd(end, to);
    // Le regole annidate scelgono a partire da questa: non si leggono.
    if (nested) {
      this.selectors.push(null);
      return close;
    }
    if (!this.filled(end + 1, close - 1)) return close;
    const list = parseList(css.slice(at, end), this.namespaces, false);
    if (list === "invalid") return close;
    for (const selector of list) {
      this.selectors.push(selector);
      if (selector !== null && deepIn(selector)) this.deep = true;
    }
    return close;
  }

  /// Un'at-rule, che finisce dove torna il suo indice.
  private atRule(at: number, to: number): number {
    const css = this.css;
    const [nameEnd, raw] = readName(css, at + 1);
    const name = raw.toLowerCase();
    const end = this.preludeEnd(nameEnd, to);
    if (end >= to || css[end] !== "{") {
      if (name === "namespace") this.namespace(css.slice(nameEnd, end));
      return end + 1;
    }
    const [close] = this.blockEnd(end, to);
    const inner = css[close - 1] === "}" ? close - 1 : close;
    if (GROUPING.has(name)) this.rules(end + 1, inner);
    // `@scope` sceglie a partire da elementi che dice lui.
    else if (name === "scope" && this.filled(end + 1, inner)) this.selectors.push(null);
    return close;
  }

  /// `@namespace prefisso? url(…)` o con una stringa.
  private namespace(prelude: string): void {
    const match = /^\s*(?:([A-Za-z_][\w-]*)\s+)?(?:url\(\s*(["']?)([^"')]*)\2\s*\)|(["'])([^"']*)\4)\s*$/i.exec(prelude);
    if (match === null) return;
    this.namespaces.set(match[1] ?? null, match[3] ?? match[5] ?? "");
  }
}

/// Vero se `selector` ha un `:has()`, che si legge come non si sa.
function deepIn(selector: Complex): boolean {
  return selector.compounds.some((compound) =>
    compound.some((simple) => {
      if (simple.kind === "has") return true;
      if (simple.kind === "not" || simple.kind === "is") return simple.list.some((inner) => inner !== null && deepIn(inner));
      if (simple.kind === "nth" && simple.of !== null) return simple.of.some((inner) => inner !== null && deepIn(inner));
      return false;
    }),
  );
}

// ---------------------------------------------------------------------------
// Selettori.
// ---------------------------------------------------------------------------

/// Un selettore che un browser non accetta: la sua regola non vale.
class Invalid extends Error {}

/// Un selettore che qui non si legge, ma che un browser potrebbe accettare.
class Unknown extends Error {}

/// La lista di selettori `text`. Una lista che perdona, come quella di
/// `:is()`, lascia fuori i selettori che non valgono; le altre, se uno non
/// vale, non valgono.
function parseList(text: string, namespaces: ReadonlyMap<string | null, string>, forgiving: boolean): Selector[] | "invalid" {
  const out: Selector[] = [];
  for (const part of splitTop(text, ",")) {
    try {
      out.push(new SelectorParser(part, namespaces).complexWhole());
    } catch (error) {
      if (error instanceof Unknown) out.push(null);
      else if (error instanceof Invalid) {
        if (!forgiving) return "invalid";
      } else throw error;
    }
  }
  return out;
}

/// `text` diviso dove c'è `separator` fuori da stringhe, commenti, parentesi
/// ed escape.
function splitTop(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"' || c === "'") i = stringEnd(text, i);
    else if (c === "/" && text[i + 1] === "*") i = commentEnd(text, i);
    else if (c === "\\") i = escapeEnd(text, i);
    else if (c === "(" || c === "[") (depth++, i++);
    else if (c === ")" || c === "]") (depth = Math.max(0, depth - 1), i++);
    else if (depth === 0 && c === separator) {
      out.push(text.slice(start, i));
      start = ++i;
    } else i++;
  }
  out.push(text.slice(start));
  return out;
}

/// Vero se `c` comincia un nome CSS.
const nameStart = (c: string | undefined): boolean => c !== undefined && (/[A-Za-z_\\-]/.test(c) || c.charCodeAt(0) >= 0x80);

class SelectorParser {
  private i = 0;

  constructor(
    private readonly text: string,
    private readonly namespaces: ReadonlyMap<string | null, string>,
  ) {}

  /// Un selettore complesso che occupa tutto il testo.
  complexWhole(): Complex {
    this.space();
    if (this.i >= this.text.length) throw new Invalid();
    const complex = this.complex();
    this.space();
    if (this.i < this.text.length) throw new Invalid();
    return complex;
  }

  private peek(offset = 0): string | undefined {
    return this.text[this.i + offset];
  }

  /// Salta spazi e commenti; vero se ce n'erano.
  private space(): boolean {
    const start = this.i;
    for (;;) {
      const c = this.peek();
      if (c !== undefined && /\s/.test(c)) this.i++;
      else if (c === "/" && this.peek(1) === "*") this.i = commentEnd(this.text, this.i);
      else return this.i > start;
    }
  }

  private name(): string {
    if (!nameStart(this.peek())) throw new Invalid();
    const [end, name] = readName(this.text, this.i);
    this.i = end;
    return name;
  }

  private complex(): Complex {
    const compounds = [this.compound()];
    const combinators: Combinator[] = [];
    for (;;) {
      const spaced = this.space();
      const c = this.peek();
      if (c === undefined) break;
      let combinator: Combinator;
      if (c === ">" || c === "+" || c === "~") {
        if (c === ">" && this.peek(1) === ">") throw new Unknown();
        combinator = c;
        this.i++;
        this.space();
      } else if (c === "|" && this.peek(1) === "|") {
        throw new Unknown();
      } else if (spaced) {
        combinator = " ";
      } else {
        throw new Invalid();
      }
      combinators.push(combinator);
      compounds.push(this.compound());
    }
    return { compounds, combinators };
  }

  /// Un namespace scritto come prefisso: `*` è uno qualunque, `""` nessuno.
  private prefixed(prefix: string): string | null {
    if (prefix === "*") return null;
    if (prefix === "") return "";
    const uri = this.namespaces.get(prefix);
    if (uri === undefined) throw new Invalid();
    return uri;
  }

  /// Vero se in `at` c'è un `|` che separa un prefisso, non un `|=` né un
  /// `||`.
  private bar(at = this.i): boolean {
    return this.text[at] === "|" && this.text[at + 1] !== "=" && this.text[at + 1] !== "|";
  }

  /// Il nome di un tipo o di un attributo, col prefisso del namespace se
  /// c'è: il prefisso, `undefined` se non c'è, e il nome, `null` per `*`.
  private qualified(star: boolean): [prefix: string | undefined, local: string | null] {
    const local = (): string | null => {
      if (star && this.peek() === "*") {
        this.i++;
        return null;
      }
      return this.name();
    };
    if (this.bar()) {
      this.i++;
      return ["", local()];
    }
    let first: string;
    if (this.peek() === "*") {
      this.i++;
      first = "*";
    } else first = this.name();
    if (this.bar()) {
      this.i++;
      return [first, local()];
    }
    if (first === "*" && !star) throw new Invalid();
    return [undefined, first === "*" ? null : first];
  }

  private compound(): Compound {
    const simples: Simple[] = [];
    let typed = false;
    const c = this.peek();
    if (c === "*" || c === "|" || nameStart(c)) {
      const [prefix, local] = this.qualified(true);
      const ns = prefix === undefined ? (this.namespaces.get(null) ?? null) : this.prefixed(prefix);
      simples.push({ kind: "type", local, ns });
      typed = true;
    }
    let element = false;
    for (;;) {
      const c = this.peek();
      if (c === "#") {
        this.i++;
        const [end, name] = readName(this.text, this.i);
        if (name === "") throw new Invalid();
        this.i = end;
        simples.push({ kind: "id", name });
      } else if (c === ".") {
        this.i++;
        simples.push({ kind: "class", name: this.name() });
      } else if (c === "[") {
        simples.push(this.attribute());
      } else if (c === ":") {
        if (this.peek(1) === ":") {
          this.i += 2;
          this.name();
          if (this.peek() === "(") this.skipArguments();
          element = true;
          continue;
        }
        this.i++;
        const name = this.name().toLowerCase();
        if (LEGACY_ELEMENTS.has(name)) element = true;
        else simples.push(...this.pseudoClass(name));
      } else if (c === "&") {
        throw new Unknown();
      } else break;
    }
    if (simples.length === 0 && !element) throw new Invalid();
    // Con un namespace predefinito, un composto senza tipo vale per i suoi
    // elementi soltanto.
    const fallback = this.namespaces.get(null);
    if (!typed && fallback !== undefined) simples.unshift({ kind: "type", local: null, ns: fallback });
    // Uno pseudo-elemento non è l'elemento.
    if (element) simples.push({ kind: "fixed", value: false });
    return simples;
  }

  private attribute(): Simple {
    this.i++;
    this.space();
    const [prefix, local] = this.qualified(false);
    const ns = prefix === undefined ? "" : this.prefixed(prefix);
    this.space();
    let op: AttrOp | null = null;
    let value = "";
    let fold = false;
    if (this.peek() !== "]") {
      const two = this.text.slice(this.i, this.i + 2);
      if (two === "~=" || two === "|=" || two === "^=" || two === "$=" || two === "*=") {
        op = two;
        this.i += 2;
      } else if (this.peek() === "=") {
        op = "=";
        this.i++;
      } else throw new Invalid();
      this.space();
      value = this.peek() === '"' || this.peek() === "'" ? this.string() : this.name();
      this.space();
      const flag = this.peek();
      if (flag !== undefined && /[iIsS]/.test(flag) && !isNameChar(this.peek(1) ?? " ")) {
        fold = flag === "i" || flag === "I";
        this.i++;
        this.space();
      }
    }
    if (this.peek() !== "]") throw new Invalid();
    this.i++;
    return { kind: "attr", ns, local: local!, op, value, fold };
  }

  /// Una stringa CSS, coi suoi escape.
  private string(): string {
    const quote = this.text[this.i]!;
    const end = stringEnd(this.text, this.i);
    const closed = end - 1 > this.i && this.text[end - 1] === quote;
    const body = this.text.slice(this.i + 1, closed ? end - 1 : end);
    this.i = end;
    return body.replace(/\\(?:([0-9A-Fa-f]{1,6})[ \t\n]?|\n|(.))/g, (_, hex: string | undefined, other: string | undefined) =>
      hex !== undefined ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : (other ?? ""),
    );
  }

  /// Gli argomenti fra parentesi che cominciano in `(`, saltati: il testo
  /// fra le parentesi.
  private skipArguments(): string {
    const start = this.i + 1;
    let depth = 0;
    while (this.i < this.text.length) {
      const c = this.text[this.i]!;
      if (c === '"' || c === "'") this.i = stringEnd(this.text, this.i);
      else if (c === "/" && this.text[this.i + 1] === "*") this.i = commentEnd(this.text, this.i);
      else if (c === "\\") this.i = escapeEnd(this.text, this.i);
      else if (c === "(") (depth++, this.i++);
      else if (c === ")") {
        depth--;
        this.i++;
        if (depth === 0) return this.text.slice(start, this.i - 1);
      } else this.i++;
    }
    throw new Invalid();
  }

  private pseudoClass(name: string): Simple[] {
    if (this.peek() === "(") {
      const args = this.skipArguments();
      if (name === "not") {
        const list = parseList(args, this.namespaces, false);
        if (list === "invalid") throw new Invalid();
        return [{ kind: "not", list }];
      }
      if (ANY_OF.has(name)) {
        const list = parseList(args, this.namespaces, true);
        return [{ kind: "is", list: list === "invalid" ? [] : list }];
      }
      if (name === "nth-child" || name === "nth-last-child") {
        const [formula, of] = splitOf(args);
        const [a, b] = anPlusB(formula);
        let list: Selector[] | null = null;
        if (of !== null) {
          const parsed = parseList(of, this.namespaces, false);
          if (parsed === "invalid") throw new Invalid();
          list = parsed;
        }
        return [{ kind: "nth", a, b, last: name === "nth-last-child", ofType: false, of: list }];
      }
      if (name === "nth-of-type" || name === "nth-last-of-type") {
        const [a, b] = anPlusB(args);
        return [{ kind: "nth", a, b, last: name === "nth-last-of-type", ofType: true, of: null }];
      }
      if (name === "lang") {
        const ranges = splitTop(args, ",").map((range) => range.trim().replace(/^(["'])(.*)\1$/, "$2").toLowerCase());
        if (ranges.some((range) => range === "")) throw new Invalid();
        return [{ kind: "lang", ranges }];
      }
      if (name === "has") return [{ kind: "has" }];
      return [{ kind: "fixed", value: null }];
    }
    switch (name) {
      case "root":
      case "scope":
        return [{ kind: "root" }];
      case "empty":
        return [{ kind: "empty" }];
      case "first-child":
        return [nth(false, false)];
      case "last-child":
        return [nth(true, false)];
      case "only-child":
        return [nth(false, false), nth(true, false)];
      case "first-of-type":
        return [nth(false, true)];
      case "last-of-type":
        return [nth(true, true)];
      case "only-of-type":
        return [nth(false, true), nth(true, true)];
      case "link":
      case "any-link":
      case "-webkit-any-link":
        return [{ kind: "link" }];
    }
    if (NEVER.has(name)) return [{ kind: "fixed", value: false }];
    if (ALWAYS.has(name)) return [{ kind: "fixed", value: true }];
    return [{ kind: "fixed", value: null }];
  }
}

/// Il primo, o l'ultimo, fra i fratelli o fra quelli del suo tipo.
const nth = (last: boolean, ofType: boolean): Simple => ({ kind: "nth", a: 0, b: 1, last, ofType, of: null });

/// `An+B of S` diviso nella formula e nella lista, `null` se non c'è.
function splitOf(args: string): [formula: string, of: string | null] {
  const match = /^([\s\S]*?)\s+of\s+([\s\S]*)$/i.exec(args);
  return match === null ? [args, null] : [match[1]!, match[2]!];
}

/// I due numeri di `An+B`.
function anPlusB(text: string): [a: number, b: number] {
  const t = text.replace(/\s+/g, "").toLowerCase();
  if (t === "odd") return [2, 1];
  if (t === "even") return [2, 0];
  const linear = /^([+-]?)(\d*)n([+-]\d+)?$/.exec(t);
  if (linear !== null) {
    const a = (linear[1] === "-" ? -1 : 1) * (linear[2] === "" ? 1 : Number(linear[2]));
    return [a, linear[3] === undefined ? 0 : Number(linear[3])];
  }
  if (/^[+-]?\d+$/.test(t)) return [0, Number(t)];
  throw new Invalid();
}

// ---------------------------------------------------------------------------
// Scegliere.
// ---------------------------------------------------------------------------

const and = (a: Maybe, b: Maybe): Maybe => (a === false || b === false ? false : a === true && b === true ? true : null);
const or = (a: Maybe, b: Maybe): Maybe => (a === true || b === true ? true : a === false && b === false ? false : null);
const not = (a: Maybe): Maybe => (a === null ? null : !a);

/// I valori degli attributi `local` nel namespace `ns` (`null` per uno
/// qualunque).
function attributes(node: StyleNode, ns: string | null, local: string): string[] {
  const out: string[] = [];
  for (const attr of node.attrs) if (attr.local === local && (ns === null || attr.uri === ns)) out.push(attr.value);
  return out;
}

const attribute = (node: StyleNode, local: string, ns = ""): string | null => node.attrs.find((attr) => attr.local === local && attr.uri === ns)?.value ?? null;

/// Chi dice se un selettore sceglie un elemento, su un albero che intanto
/// non cambia: ricorda il posto di ogni elemento fra i fratelli.
export class Matcher {
  private readonly places = new Map<StyleNode, number>();

  /// Se `selector` sceglie `node`.
  selects(selector: Selector, node: StyleNode): Maybe {
    if (selector === null) return null;
    return this.from(selector, selector.compounds.length - 1, node);
  }

  /// Se una qualunque di `list` sceglie `node`.
  private any(list: readonly Selector[], node: StyleNode): Maybe {
    let out: Maybe = false;
    for (const selector of list) {
      out = or(out, this.selects(selector, node));
      if (out === true) break;
    }
    return out;
  }

  private from(selector: Complex, at: number, node: StyleNode): Maybe {
    const own = this.compound(selector.compounds[at]!, node);
    if (own === false || at === 0) return own;
    const combinator = selector.combinators[at - 1]!;
    let rest: Maybe = false;
    if (combinator === ">") {
      rest = node.parent === null ? false : this.from(selector, at - 1, node.parent);
    } else if (combinator === " ") {
      for (let up = node.parent; up !== null && rest !== true; up = up.parent) rest = or(rest, this.from(selector, at - 1, up));
    } else {
      const siblings = node.parent?.children ?? [];
      const place = this.place(node);
      for (let k = place - 1; k >= 0 && rest !== true; k--) {
        rest = or(rest, this.from(selector, at - 1, siblings[k]!));
        if (combinator === "+") break;
      }
    }
    return and(own, rest);
  }

  private compound(compound: Compound, node: StyleNode): Maybe {
    let out: Maybe = true;
    for (const simple of compound) {
      out = and(out, this.simple(simple, node));
      if (out === false) return false;
    }
    return out;
  }

  /// Il posto di `node` fra i fratelli, da zero.
  private place(node: StyleNode): number {
    let place = this.places.get(node);
    if (place === undefined) {
      const siblings = node.parent?.children ?? [node];
      siblings.forEach((sibling, at) => this.places.set(sibling, at));
      place = this.places.get(node) ?? 0;
    }
    return place;
  }

  private simple(simple: Simple, node: StyleNode): Maybe {
    switch (simple.kind) {
      case "type":
        return (simple.local === null || node.local === simple.local) && (simple.ns === null || node.uri === simple.ns);
      case "id":
        return attribute(node, "id") === simple.name;
      case "class":
        return (attribute(node, "class") ?? "").split(/[ \t\n\r\f]+/).includes(simple.name);
      case "attr":
        return attributes(node, simple.ns, simple.local).some((value) => attrMatches(simple.op, simple.fold ? value.toLowerCase() : value, simple.fold ? simple.value.toLowerCase() : simple.value));
      case "nth":
        return this.nth(simple, node);
      case "root":
        return node.parent === null;
      case "empty":
        return node.children.length === 0 && !node.text;
      case "link":
        return node.local === "a" && (attribute(node, "href") !== null || attribute(node, "href", XLINK_NS) !== null);
      case "not":
        return not(this.any(simple.list, node));
      case "is":
        return this.any(simple.list, node);
      case "lang":
        return lang(node, simple.ranges);
      case "has":
        return null;
      case "fixed":
        return simple.value;
    }
  }

  private nth(simple: Extract<Simple, { kind: "nth" }>, node: StyleNode): Maybe {
    let own: Maybe = true;
    if (simple.of !== null) {
      own = this.any(simple.of, node);
      if (own === false) return false;
    }
    const siblings = node.parent?.children ?? [node];
    const place = this.place(node);
    let count = 1;
    let doubt = false;
    const step = simple.last ? 1 : -1;
    for (let k = place + step; k >= 0 && k < siblings.length; k += step) {
      const sibling = siblings[k]!;
      if (simple.ofType) {
        if (sibling.local === node.local && sibling.uri === node.uri) count++;
      } else if (simple.of !== null) {
        const counts = this.any(simple.of, sibling);
        if (counts === null) doubt = true;
        else if (counts) count++;
      } else count++;
    }
    const fits = simple.a === 0 ? count === simple.b : (count - simple.b) / simple.a >= 0 && (count - simple.b) % simple.a === 0;
    return doubt ? and(own, null) : and(own, fits);
  }
}

function attrMatches(op: AttrOp | null, value: string, wanted: string): boolean {
  switch (op) {
    case null:
      return true;
    case "=":
      return value === wanted;
    case "~=":
      return wanted !== "" && !/\s/.test(wanted) && value.split(/[ \t\n\r\f]+/).includes(wanted);
    case "|=":
      return value === wanted || value.startsWith(`${wanted}-`);
    case "^=":
      return wanted !== "" && value.startsWith(wanted);
    case "$=":
      return wanted !== "" && value.endsWith(wanted);
    case "*=":
      return wanted !== "" && value.includes(wanted);
  }
}

/// `:lang()`: la lingua di `xml:lang`, o di `lang`, sull'elemento o sul
/// primo antenato che la dice.
function lang(node: StyleNode, ranges: readonly string[]): boolean {
  for (let at: StyleNode | null = node; at !== null; at = at.parent) {
    const value = attribute(at, "lang", XML_NS) ?? attribute(at, "lang");
    if (value === null) continue;
    const tag = value.toLowerCase();
    return ranges.some((range) => range === "*" || tag === range || tag.startsWith(`${range}-`));
  }
  return false;
}
