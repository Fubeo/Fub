import type { CanvasDocument, CanvasEdge, CanvasNode } from "./model";

interface JsonSpan {
  start: number;
  end: number;
  kind: "value" | "array" | "object";
  items?: JsonSpan[];
  fields?: { key: string; start: number; value: JsonSpan }[];
}

/**
 * Where a repeated object key sits: `path` leads from the root to the object
 * that holds it (keys for objects, indices for arrays), `offset` is the UTF-16
 * index of the repeated key's opening quote in the scanned source.
 */
export interface CanvasDuplicateKey {
  readonly path: readonly (string | number)[];
  readonly key: string;
  readonly offset: number;
}

const BOM = 0xfeff;

/** JSON whitespace only (RFC 8259 §2): space, tab, line feed, carriage return. */
function jsonSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * An empty canvas: an optional BOM, then JSON whitespace only. Not `trim()`,
 * which also drops U+00A0, U+2028 and a BOM anywhere in the run; the Rust
 * reader follows the same rule (R1 of plan N3).
 */
export function isBlankCanvasSource(source: string): boolean {
  for (let index = source.charCodeAt(0) === BOM ? 1 : 0; index < source.length; index++) {
    if (!jsonSpace(source.charCodeAt(index))) return false;
  }
  return true;
}

// Senza il flag `u` l'espressione guarda le unità UTF-16: trova un surrogato
// alto senza il basso dopo, o un basso senza l'alto prima (R4). Il `tsconfig`
// ha `lib` ES2021, quindi niente `String.prototype.isWellFormed`.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

interface ScanOptions {
  /** Receives each repeated key; the caller decides whether it is an error. */
  readonly onDuplicate: (duplicate: CanvasDuplicateKey) => void;
  /**
   * Also reject a string (key or value) with a lone surrogate and a number
   * that a `f64` can't hold (R4, R5). The reader's checks: the rewriter only
   * sees sources the reader already accepted.
   */
  readonly strict: boolean;
}

/**
 * A positional JSON reader. It never decodes or re-emits an untouched value.
 * A leading BOM is skipped and stays outside the root span.
 */
function scan(source: string, options: ScanOptions): JsonSpan {
  let cursor = source.charCodeAt(0) === BOM ? 1 : 0;
  const path: (string | number)[] = [];
  const space = (): void => {
    while (cursor < source.length && jsonSpace(source.charCodeAt(cursor))) cursor++;
  };
  const string = (decode: boolean): string => {
    const start = cursor++;
    let escaped = false;
    // Solo una stringa con un surrogato crudo o un escape `\u` può avere un
    // surrogato spaiato: le altre non si decodificano.
    let suspect = false;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor++);
      if (code === 0x5c) {
        escaped = true;
        if (source.charCodeAt(cursor) === 0x75) suspect = true;
        cursor++;
      } else if (code === 0x22) {
        const checked = options.strict && suspect;
        if (!decode && !checked) return "";
        // Senza escape la stringa è il testo fra le virgolette così com'è.
        const text = escaped ? JSON.parse(source.slice(start, cursor)) as string : source.slice(start + 1, cursor - 1);
        if (checked && LONE_SURROGATE.test(text)) throw new SyntaxError("lone surrogate in canvas JSON");
        return text;
      } else if (code >= 0xd800 && code <= 0xdfff) {
        suspect = true;
      }
    }
    throw new SyntaxError("unterminated canvas JSON string");
  };
  const value = (): JsonSpan => {
    space();
    const start = cursor;
    if (source[cursor] === "{") {
      cursor++;
      const fields: NonNullable<JsonSpan["fields"]> = [];
      const keys = new Set<string>();
      space();
      while (source[cursor] !== "}") {
        if (source[cursor] !== '"') throw new SyntaxError("invalid canvas JSON key");
        const keyStart = cursor;
        const key = string(true);
        if (keys.has(key)) options.onDuplicate({ path: [...path], key, offset: keyStart });
        keys.add(key);
        space();
        if (source[cursor++] !== ":") throw new SyntaxError("invalid canvas JSON field");
        path.push(key);
        const child = value();
        path.pop();
        fields.push({ key, start: keyStart, value: child });
        space();
        if (source[cursor] !== ",") break;
        cursor++;
        space();
      }
      if (source[cursor++] !== "}") throw new SyntaxError("invalid canvas JSON object");
      return { start, end: cursor, kind: "object", fields };
    }
    if (source[cursor] === "[") {
      cursor++;
      const items: JsonSpan[] = [];
      space();
      while (source[cursor] !== "]") {
        path.push(items.length);
        items.push(value());
        path.pop();
        space();
        if (source[cursor] !== ",") break;
        cursor++;
        space();
      }
      if (source[cursor++] !== "]") throw new SyntaxError("invalid canvas JSON array");
      return { start, end: cursor, kind: "array", items };
    }
    if (source[cursor] === '"') {
      string(false);
    } else {
      while (cursor < source.length) {
        const code = source.charCodeAt(cursor);
        if (code === 0x2c || code === 0x7d || code === 0x5d || jsonSpace(code)) break;
        cursor++;
      }
      // `true`, `false` e `null` non sono numeri; ogni altro scalare lo è, e
      // `Number` lo legge come `JSON.parse`.
      const first = source.charCodeAt(start);
      if (options.strict && (first === 0x2d || (first >= 0x30 && first <= 0x39))
        && !Number.isFinite(Number(source.slice(start, cursor)))) {
        throw new RangeError("canvas JSON number out of range");
      }
    }
    return { start, end: cursor, kind: "value" };
  };
  const root = value();
  space();
  if (cursor !== source.length) throw new SyntaxError("trailing canvas JSON content");
  return root;
}

/** The scanner the rewriter uses: a repeated key at any depth is an error. */
function scanJson(source: string): JsonSpan {
  return scan(source, {
    strict: false,
    onDuplicate: () => {
      throw new SyntaxError("duplicate canvas JSON key");
    },
  });
}

/**
 * The reader's checks that `JSON.parse` doesn't make. `source` must be JSON
 * that `JSON.parse` already accepted (a leading BOM is allowed). It throws on
 * a string, key included, with a lone surrogate (R4) and on a number out of
 * the range of a `f64` (R5); it returns every repeated object key, at any
 * depth and in source order, for the caller to judge (R3).
 */
export function inspectCanvasJson(source: string): CanvasDuplicateKey[] {
  const duplicates: CanvasDuplicateKey[] = [];
  scan(source, { strict: true, onDuplicate: (duplicate) => duplicates.push(duplicate) });
  return duplicates;
}

/**
 * The index of the node whose JSON object holds `offset` (a UTF-16 index into
 * `source`), or `null` when the offset falls outside every node. Nodes keep
 * their array order in the model, so the index is the model's too.
 */
export function canvasNodeAt(source: string, offset: number): number | null {
  let root: JsonSpan;
  try {
    root = scanJson(source);
  } catch {
    return null;
  }
  const nodes = root.fields?.find((field) => field.key === "nodes")?.value;
  const index = nodes?.items?.findIndex((item) => item.start <= offset && offset < item.end) ?? -1;
  return index < 0 ? null : index;
}

/**
 * Two JSON values equal by value (R9, like `patch::same_value` in Rust): object
 * keys in any order, array items in order, numbers as JavaScript sees them.
 */
export function sameCanvasValue(left: unknown, right: unknown): boolean {
  return same(left, right);
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => same(item, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object"
    && !Array.isArray(left) && !Array.isArray(right)) {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
      && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && same(a[key], b[key]));
  }
  return false;
}

/** Semantic equality ignores only JSON object key order, not array order or unknown values. */
export function sameCanvasModel(left: CanvasDocument, right: CanvasDocument): boolean {
  return same(left, right);
}

// L'ordine in cui si scrivono le chiavi note (R10), come `node_value` ed
// `edge_value` in Rust; le sconosciute vengono dopo, nel loro ordine.
const NODE_ORDER = [
  "id", "type", "x", "y", "width", "height", "color", "text", "file", "subpath", "url", "label",
  "background", "backgroundStyle",
] as const;
const EDGE_ORDER = ["id", "fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd", "color", "label"] as const;

/**
 * `value` with the known keys first, in `order`, then the others in their
 * order. `Object.fromEntries` defines every key as an own property, even
 * `__proto__`. JavaScript still enumerates index-like keys first, as the Rust
 * writer does.
 */
function ordered<T extends object>(value: T, order: readonly string[]): T {
  const record = value as Record<string, unknown>;
  const entries: [string, unknown][] = [];
  for (const key of order) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) entries.push([key, record[key]]);
  }
  for (const [key, val] of Object.entries(record)) {
    if (!order.includes(key)) entries.push([key, val]);
  }
  return Object.fromEntries(entries) as T;
}

/** A node with its keys in the order they are written (R10). */
export function orderedCanvasNode(node: CanvasNode): CanvasNode {
  return ordered(node, NODE_ORDER);
}

/** An edge with its keys in the order they are written (R10). */
export function orderedCanvasEdge(edge: CanvasEdge): CanvasEdge {
  return ordered(edge, EDGE_ORDER);
}

/** The canvas as it is written: `nodes`, `edges`, then the unknown root keys. */
function orderedCanvas(doc: CanvasDocument): CanvasDocument {
  return ordered(
    { ...doc, nodes: doc.nodes.map(orderedCanvasNode), edges: doc.edges.map(orderedCanvasEdge) },
    ["nodes", "edges"],
  );
}

function encode(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("canvas JSON value cannot be serialized");
  return encoded;
}

function splice(source: string, span: JsonSpan, edits: readonly { span: JsonSpan; text: string }[]): string {
  let result = "";
  let from = span.start;
  for (const edit of edits) {
    result += source.slice(from, edit.span.start) + edit.text;
    from = edit.span.end;
  }
  return result + source.slice(from, span.end);
}

/** Preserve source bytes for every unchanged JSON member, including unknown members. */
export function patchCanvasSource(source: string, before: CanvasDocument, after: CanvasDocument): string {
  // Le chiavi nuove si scrivono nell'ordine di R10, qualunque sia quello del
  // modello: lo stesso testo che scrive il nucleo Rust.
  after = orderedCanvas(after);
  if (isBlankCanvasSource(source)) {
    // Una tela vuota tiene il BOM e il terminatore che il file aveva già.
    const fresh = JSON.stringify(after, null, 2) + "\n";
    const bom = source.charCodeAt(0) === 0xfeff ? "\ufeff" : "";
    return bom + (source.includes("\r\n") ? fresh.replace(/\n/g, "\r\n") : fresh);
  }
  const root = scanJson(source);
  const render = (span: JsonSpan, old: unknown, next: unknown): string => {
    if (same(old, next)) return source.slice(span.start, span.end);
    if (span.kind === "object" && old && next && typeof old === "object" && typeof next === "object"
      && !Array.isArray(old) && !Array.isArray(next)) {
      const fields = span.fields!;
      const oldObject = old as Record<string, unknown>;
      const nextObject = next as Record<string, unknown>;
      const retained = fields.filter((field) => Object.prototype.hasOwnProperty.call(nextObject, field.key));
      const added = Object.keys(nextObject).filter((key) => !fields.some((field) => field.key === key));
      if (retained.length === fields.length && !added.length) {
        const edits = fields.filter((field) => !same(oldObject[field.key], nextObject[field.key]))
          .map((field) => ({ span: field.value, text: render(field.value, oldObject[field.key], nextObject[field.key]) }));
        return splice(source, span, edits);
      }
      const prefix = fields.length ? source.slice(span.start + 1, fields[0].start) : "";
      const suffix = fields.length ? source.slice(fields[fields.length - 1].value.end, span.end - 1) : "";
      const separator = fields.length > 1
        ? source.slice(fields[0].value.end, fields[1].start) : ",";
      const members = retained.map((field) => source.slice(field.start, field.value.start)
        + render(field.value, oldObject[field.key], nextObject[field.key]));
      members.push(...added.map((key) => `${encode(key)}:${encode(nextObject[key])}`));
      return `{${prefix}${members.join(separator)}${suffix}}`;
    }
    if (span.kind === "array" && Array.isArray(old) && Array.isArray(next)) {
      const items = span.items!;
      const ids = (values: unknown[]): string[] | null => {
        const result: string[] = [];
        for (const entry of values) {
          if (!entry || typeof entry !== "object" || !("id" in entry) || typeof entry.id !== "string") return null;
          result.push(entry.id);
        }
        return result;
      };
      const oldIds = ids(old);
      const nextIds = ids(next);
      if (old.length === next.length && (!oldIds || (nextIds && oldIds.every((id, i) => id === nextIds[i])))) {
        const edits = items.flatMap((item, index) => same(old[index], next[index]) ? []
          : [{ span: item, text: render(item, old[index], next[index]) }]);
        return splice(source, span, edits);
      }
      const positions = new Map(oldIds?.map((id, index) => [id, index]) ?? []);
      const prefix = items.length ? source.slice(span.start + 1, items[0].start) : "";
      const suffix = items.length ? source.slice(items[items.length - 1].end, span.end - 1) : "";
      const separator = items.length > 1 ? source.slice(items[0].end, items[1].start) : ",";
      const members = next.map((entry, index) => {
        const original = nextIds ? positions.get(nextIds[index]) : index < old.length ? index : undefined;
        return original === undefined ? encode(entry) : render(items[original], old[original], entry);
      });
      return members.length ? `[${prefix}${members.join(separator)}${suffix}]` : "[]";
    }
    return encode(next);
  };
  return source.slice(0, root.start) + render(root, before, after) + source.slice(root.end);
}
