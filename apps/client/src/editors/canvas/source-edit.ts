import type { CanvasDocument } from "./model";

interface JsonSpan {
  start: number;
  end: number;
  kind: "value" | "array" | "object";
  items?: JsonSpan[];
  fields?: { key: string; start: number; value: JsonSpan }[];
}

/** A positional JSON reader. It never decodes or re-emits an untouched value. */
function scanJson(source: string): JsonSpan {
  let cursor = 0;
  const space = (): void => {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
  };
  const string = (decode: boolean): string => {
    const start = cursor++;
    while (cursor < source.length) {
      const ch = source[cursor++];
      if (ch === "\\") cursor++;
      else if (ch === '"') return decode ? JSON.parse(source.slice(start, cursor)) as string : "";
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
        const keyStart = cursor;
        const key = string(true);
        if (keys.has(key)) throw new SyntaxError("duplicate canvas JSON key");
        keys.add(key);
        space();
        if (source[cursor++] !== ":") throw new SyntaxError("invalid canvas JSON field");
        const child = value();
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
        items.push(value());
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
      while (cursor < source.length && !/[\s,}\]]/.test(source[cursor])) cursor++;
    }
    return { start, end: cursor, kind: "value" };
  };
  const root = value();
  space();
  if (cursor !== source.length) throw new SyntaxError("trailing canvas JSON content");
  return root;
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
  if (!source.trim()) return JSON.stringify(after, null, 2) + "\n";
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
