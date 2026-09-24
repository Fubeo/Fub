// La sintassi della barra di ricerca: la gemella di
// `fub_abi::rules::search_syntax`, legata dalla fixture di `rules_mirror`.
// La prosa del linguaggio sta di là; qui c'è la stessa regola, riga per riga,
// perché la shell la applica a ogni battuta senza un giro sull'IPC.
import type {
  QueryClause,
  QueryExpr,
  QueryLiteral,
  QueryPredicate,
  TextField,
  TextMode,
} from "../host/contract";

export const MAX_CLAUSES = 32;
export const MAX_LITERALS = 32;

export type SearchFaultKind =
  | "unclosed-quote"
  | "unclosed-regex"
  | "unclosed-property"
  | "unclosed-group"
  | "unexpected-close"
  | "dangling-or"
  | "empty-value"
  | "bad-value"
  | "negated-group"
  | "too-complex";

/// `at` è un indice UTF-16 nella riga (il Rust lo porta in byte).
export interface SearchFault {
  kind: SearchFaultKind;
  at: number;
}

export type SearchParse = { ok: QueryExpr } | { fault: SearchFault };

class Fault extends Error {
  constructor(readonly fault: SearchFault) {
    super(fault.kind);
  }
}

const fail = (kind: SearchFaultKind, at: number): never => {
  throw new Fault({ kind, at });
};

/// `char::is_whitespace` di Rust: `\s` senza U+FEFF, più U+0085.
function isWs(c: string | undefined): boolean {
  return c !== undefined && c !== "﻿" && (c === "\u0085" || /\s/u.test(c));
}

type Item =
  | { kind: "word"; word: string }
  | { kind: "literal"; literal: QueryLiteral }
  | { kind: "group"; alternatives: Item[][] };

function textPredicate(text: string, mode: TextMode, fields: TextField[], caseSensitive: boolean): QueryPredicate {
  return {
    kind: "text",
    text,
    mode,
    fields,
    tolerance: "exact",
    partial_last_term: false,
    case_sensitive: caseSensitive,
  };
}

const literal = (negated: boolean, predicate: QueryPredicate): QueryLiteral => ({ negated, predicate });

export function parseSearch(input: string, typing = false): SearchParse {
  try {
    return { ok: parse(input, typing) };
  } catch (error) {
    if (error instanceof Fault) return { fault: error.fault };
    throw error;
  }
}

function parse(input: string, typing: boolean): QueryExpr {
  const parser = new Parser(input);
  const alternatives = parser.alternatives(0);
  if (parser.pos < input.length) fail("unexpected-close", parser.pos);
  const partial = typing && !isWs(lastChar(input));
  let clauses: QueryClause[] = [];
  for (const alternative of alternatives) clauses.push(...distribute(alternative, input.length));
  if (clauses.length > MAX_CLAUSES) fail("too-complex", input.length);
  if (partial) markPartial(clauses);
  clauses = clauses.filter((clause) => clause.all.length > 0);
  return { any: clauses };
}

function lastChar(input: string): string | undefined {
  const chars = Array.from(input);
  return chars[chars.length - 1];
}

function markPartial(clauses: QueryClause[]): void {
  for (const clause of clauses) {
    const last = clause.all[clause.all.length - 1];
    if (!last || last.negated || last.predicate.kind !== "text") continue;
    const text = last.predicate;
    if (text.mode === "terms" && text.fields.length === 0 && !text.case_sensitive) text.partial_last_term = true;
  }
}

function cloneLiteral(lit: QueryLiteral): QueryLiteral {
  return JSON.parse(JSON.stringify(lit)) as QueryLiteral;
}

function distribute(items: Item[], end: number): QueryClause[] {
  let clauses: QueryClause[] = [{ all: [] }];
  const words: string[] = [];
  const flush = () => {
    if (words.length === 0) return;
    const text = words.join(" ");
    words.length = 0;
    for (const clause of clauses) clause.all.push(literal(false, textPredicate(text, "terms", [], false)));
  };
  for (const item of items) {
    if (item.kind === "word") {
      words.push(item.word);
    } else if (item.kind === "literal") {
      flush();
      for (const clause of clauses) clause.all.push(cloneLiteral(item.literal));
    } else {
      flush();
      const inner: QueryClause[] = [];
      for (const alternative of item.alternatives) inner.push(...distribute(alternative, end));
      const next: QueryClause[] = [];
      for (const clause of clauses) {
        for (const extra of inner) next.push({ all: [...clause.all.map(cloneLiteral), ...extra.all.map(cloneLiteral)] });
        if (inner.length === 0) next.push({ all: clause.all.map(cloneLiteral) });
      }
      if (next.length > MAX_CLAUSES) fail("too-complex", end);
      clauses = next;
    }
  }
  flush();
  if (clauses.some((clause) => clause.all.length > MAX_LITERALS)) fail("too-complex", end);
  return clauses;
}

class Parser {
  pos = 0;
  constructor(readonly src: string) {}

  peek(): string | undefined {
    const code = this.src.codePointAt(this.pos);
    return code === undefined ? undefined : String.fromCodePoint(code);
  }

  skipWs(): void {
    for (let c = this.peek(); c !== undefined && isWs(c); c = this.peek()) this.pos += c.length;
  }

  alternatives(depth: number): Item[][] {
    const alternatives: Item[][] = [];
    let current: Item[] = [];
    let pendingOr: number | null = null;
    for (;;) {
      this.skipWs();
      const c = this.peek();
      if (c === undefined) {
        if (depth > 0) fail("unclosed-group", this.src.length);
        break;
      }
      if (c === ")") {
        if (depth === 0) fail("unexpected-close", this.pos);
        this.pos += 1;
        break;
      }
      if (this.atOr()) {
        if (current.length === 0) fail("dangling-or", this.pos);
        pendingOr = this.pos;
        this.pos += 2;
        alternatives.push(current);
        current = [];
        continue;
      }
      pendingOr = null;
      current.push(this.item());
    }
    if (pendingOr !== null) fail("dangling-or", pendingOr);
    alternatives.push(current);
    return alternatives;
  }

  atOr(): boolean {
    if (!this.src.startsWith("OR", this.pos)) return false;
    const code = this.src.codePointAt(this.pos + 2);
    if (code === undefined) return true;
    const next = String.fromCodePoint(code);
    return isWs(next) || next === "(" || next === ")";
  }

  item(): Item {
    const start = this.pos;
    const afterDash = this.src.codePointAt(this.pos + 1);
    const nextChar = afterDash === undefined ? undefined : String.fromCodePoint(afterDash);
    const negated = this.peek() === "-" && nextChar !== undefined && !isWs(nextChar) && nextChar !== ")";
    if (negated) this.pos += 1;
    switch (this.peek()) {
      case "(":
        if (negated) fail("negated-group", start);
        this.pos += 1;
        return { kind: "group", alternatives: this.alternatives(1) };
      case '"':
        return { kind: "literal", literal: literal(negated, textPredicate(this.quoted(), "phrase", [], false)) };
      case "/":
        return { kind: "literal", literal: literal(negated, { kind: "regex", pattern: this.regex(), fields: [] }) };
      case "[":
        return { kind: "literal", literal: literal(negated, this.property()) };
      default:
        return this.wordOrOperator(negated);
    }
  }

  quoted(): string {
    const open = this.pos;
    let i = this.pos + 1;
    let out = "";
    while (i < this.src.length) {
      const c = this.src[i]!;
      if (c === "\\") {
        const code = this.src.codePointAt(i + 1);
        if (code !== undefined) {
          const next = String.fromCodePoint(code);
          out += next;
          i += 1 + next.length;
        } else {
          i += 1;
        }
        continue;
      }
      if (c === '"') {
        this.pos = i + 1;
        return out;
      }
      out += c;
      i += 1;
    }
    return fail("unclosed-quote", open);
  }

  regex(): string {
    const open = this.pos;
    let escaped = false;
    for (let i = this.pos + 1; i < this.src.length; i++) {
      const c = this.src[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") escaped = true;
      else if (c === "/") {
        const pattern = this.src.slice(open + 1, i).split("\\/").join("/");
        if (pattern === "") fail("empty-value", open);
        this.pos = i + 1;
        return pattern;
      }
    }
    return fail("unclosed-regex", open);
  }

  property(): QueryPredicate {
    const open = this.pos;
    const close = this.src.indexOf("]", this.pos + 1);
    if (close < 0) fail("unclosed-property", open);
    const inside = this.src.slice(this.pos + 1, close);
    this.pos = close + 1;
    const colon = inside.indexOf(":");
    const key = (colon < 0 ? inside : inside.slice(0, colon)).trim();
    const value = colon < 0 ? null : inside.slice(colon + 1).trim();
    if (key === "") fail("empty-value", open);
    let test: unknown;
    if (value === null) {
      test = { op: "exists" };
    } else if (value === "") {
      return fail("empty-value", open);
    } else if (value.startsWith(">")) {
      test = { op: "greater_than", ...comparable(value.slice(1).trim(), open) };
    } else if (value.startsWith("<")) {
      test = { op: "less_than", ...comparable(value.slice(1).trim(), open) };
    } else {
      test = { op: "contains", ...scalar(unquote(value)) };
    }
    return { kind: "property", filter: { key, test } };
  }

  wordOrOperator(negated: boolean): Item {
    const start = this.pos;
    let end = this.pos;
    while (end < this.src.length) {
      const code = this.src.codePointAt(end)!;
      const c = String.fromCodePoint(code);
      if (isWs(c) || c === "(" || c === ")") break;
      end += c.length;
    }
    const word = this.src.slice(this.pos, end);
    const colon = word.indexOf(":");
    if (colon >= 0) {
      const name = word.slice(0, colon);
      const op = OPERATORS[name];
      if (op) {
        this.pos += name.length + 1;
        let value: string;
        let quoted = false;
        if (this.peek() === '"') {
          value = this.quoted();
          quoted = true;
        } else {
          value = word.slice(colon + 1);
          this.pos += value.length;
        }
        if (value === "") fail("empty-value", start);
        const predicate = op(value, quoted);
        if (!predicate) return fail("bad-value", start);
        return { kind: "literal", literal: literal(negated, predicate) };
      }
    }
    this.pos = end;
    if (negated) return { kind: "literal", literal: literal(true, textPredicate(word, "terms", [], false)) };
    return { kind: "word", word };
  }
}

const hasWs = (value: string) => Array.from(value).some((c) => isWs(c));

const OPERATORS: Record<string, (value: string, quoted: boolean) => QueryPredicate | null> = {
  tag: (value) => {
    const name = value.replace(/^#+/, "");
    return name === "" || hasWs(name) ? null : { kind: "tag", name, descendants: true };
  },
  path: (value) => ({ kind: "path", glob: /[*?]/.test(value) ? value : `**${value}**` }),
  folder: (value) => {
    // `fub_abi::rules::folders::normalized`: senza slash su entrambi i lati.
    const path = value.replace(/^\/+|\/+$/g, "");
    return path === "" ? null : { kind: "folder", path, descendants: true };
  },
  file: (value, quoted) => textPredicate(value, quoted ? "phrase" : "terms", ["name"], false),
  content: (value, quoted) => textPredicate(value, quoted ? "phrase" : "terms", ["body"], false),
  heading: (value, quoted) => textPredicate(value, quoted ? "phrase" : "terms", ["heading"], false),
  "match-case": (value, quoted) => textPredicate(value, quoted ? "phrase" : "terms", [], true),
  ext: (value) => {
    const extension = value.replace(/^\.+/, "");
    return extension === "" || /[/\\.]/.test(extension) ? null : { kind: "file", extension };
  },
  task: (value) =>
    value === "todo" || value === "open"
      ? { kind: "task", status: "open" }
      : value === "done"
        ? { kind: "task", status: "done" }
        : null,
};

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function comparable(value: string, at: number): { kind: string; value: unknown } {
  if (value === "") fail("empty-value", at);
  return scalar(unquote(value));
}

/// Numero, booleano, data ISO o testo — nella forma serde di `PropertyScalar`.
function scalar(value: string): { kind: string; value: unknown } {
  const date = isoDate(value);
  if (date) return { kind: "date", value: date };
  if (value === "true") return { kind: "bool", value: true };
  if (value === "false") return { kind: "bool", value: false };
  if (value !== "" && /^[0-9.+-]+$/.test(value) && /[0-9]/.test(value)) {
    const number = rustFloat(value);
    if (number !== null) return { kind: "number", value: number };
  }
  return { kind: "text", value };
}

/// `str::parse::<f64>` sui soli caratteri ammessi: segno opzionale, cifre,
/// un punto al massimo.
function rustFloat(value: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoDate(value: string): { year: number; month: number; day: number; time: null } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, time: null };
}
