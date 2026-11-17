// I tipi di nota (E5) nel vault finto: `note.type.list`, `note.type.get`,
// `note.from_type`, `note.property.set` e l'annulla di quest'ultimo, con la
// stessa forma dell'esito del core (`fub-features`, `properties/types.rs` e
// `template/create.rs`). La regola vera è del core e dei suoi test: qui c'è
// quanto serve ai test della shell e al banco per vedere i tipi, su un YAML
// semplice (scalari, elenchi `[a, b]` o `- a`, e una mappa sola di
// `properties`).
//
// I tipi stanno in `Tipi/`, la cartella di serie. Un vault senza file lì non
// ha tipi, e «Nuova nota» non chiede niente: i test che non ne parlano non se
// ne accorgono.
import type { CommandOutcome, PluginError } from "./contract";

export const FAKE_TYPES_FOLDER = "Tipi";
const NS = "fub.note_types";
const UNTITLED = "Senza titolo";

/// Ciò che il modulo vuole dal vault finto.
export interface FakeTypesVault {
  docs(): Iterable<[string, { text: string; revision: string }]>;
  read(id: string): { text: string; revision: string } | undefined;
  write(id: string, text: string): string;
  changed(id: string): void;
}

interface Frontmatter {
  readonly ok: boolean;
  readonly fields: Map<string, unknown>;
  readonly body: string;
}

interface FakeType {
  doc: string;
  link: string;
  name: string;
  readable: boolean;
  icon: string | null;
  featured: string[];
  properties: { key: string; kind: string | null }[];
  folder: string | null;
  template: string;
  revision: string;
}

/// Le parole dei tipi di proprietà, come le scrive un tipo, e il loro id.
const KIND_IDS: Record<string, string> = {
  testo: "text",
  text: "text",
  numero: "number",
  number: "number",
  casella: "checkbox",
  checkbox: "checkbox",
  data: "date",
  date: "date",
  elenco: "list",
  list: "list",
  tag: "tags",
  tags: "tags",
};

function scalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((item) => scalar(item));
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/// Il frontmatter di un testo, letto alla buona. Un `---` che non si chiude è
/// un tipo che non si legge.
export function fakeFrontmatter(text: string): Frontmatter {
  const fields = new Map<string, unknown>();
  if (!text.startsWith("---\n")) return { ok: true, fields, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { ok: false, fields, body: text };
  const after = text.indexOf("\n", end + 4);
  const body = after < 0 ? "" : text.slice(after + 1);
  const lines = text.slice(4, end + 1).split("\n");
  let open: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    const nested = /^\s+([^:]+):\s*(.*)$/.exec(line);
    if (open !== null && item) {
      const list = fields.get(open);
      fields.set(open, [...(Array.isArray(list) ? list : []), scalar(item[1] ?? "")]);
      continue;
    }
    if (open !== null && nested) {
      const map = fields.get(open);
      const next = map instanceof Map ? map : new Map<string, unknown>();
      next.set((nested[1] ?? "").trim(), scalar(nested[2] ?? ""));
      fields.set(open, next);
      continue;
    }
    const top = /^([^\s:][^:]*):\s*(.*)$/.exec(line);
    if (!top) return { ok: false, fields, body };
    const key = (top[1] ?? "").trim();
    const value = scalar(top[2] ?? "");
    fields.set(key, value);
    open = value === null ? key : null;
  }
  return { ok: true, fields, body };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stem(doc: string): string {
  return doc.replace(/\.md$/, "");
}

function typesOf(vault: FakeTypesVault): FakeType[] {
  const found: FakeType[] = [];
  for (const [doc, file] of vault.docs()) {
    if (!doc.startsWith(`${FAKE_TYPES_FOLDER}/`) || !doc.endsWith(".md")) continue;
    const link = stem(doc);
    const name = link.slice(link.lastIndexOf("/") + 1);
    const head = fakeFrontmatter(file.text);
    const declared = head.fields.get("properties");
    const properties = declared instanceof Map
      ? [...declared].map(([key, kind]) => ({ key, kind: typeof kind === "string" ? (KIND_IDS[kind] ?? null) : null }))
      : strings(declared).map((key) => ({ key, kind: null }));
    const icon = head.fields.get("icon");
    const folder = head.fields.get("folder");
    found.push({
      doc,
      link,
      name,
      readable: head.ok,
      icon: typeof icon === "string" ? icon : null,
      featured: strings(head.fields.get("featured")),
      properties,
      folder: typeof folder === "string" && folder !== "" ? folder : null,
      template: head.body,
      revision: file.revision,
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name, "it") || a.doc.localeCompare(b.doc));
}

/// Il nome che un valore di `tipo` scrive: `[[Tipi/Libro|alias]]` → `Tipi/Libro`.
function wantedOf(raw: string): string | null {
  const value = raw.trim();
  const link = /^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(value);
  const name = link ? (link[1] ?? "").trim() : value;
  if (name === "" || name.includes("[") || name.includes("]")) return null;
  return name;
}

type Found =
  | { state: "typed"; type: FakeType }
  | { state: "missing"; wanted: string }
  | { state: "ambiguous"; wanted: string; candidates: string[] }
  | { state: "unreadable"; doc: string; name: string }
  | { state: "not_a_name" };

function resolve(vault: FakeTypesVault, raw: string): Found {
  const wanted = wantedOf(raw);
  if (wanted === null) return { state: "not_a_name" };
  const all = typesOf(vault);
  const exact = all.filter((type) => type.link === wanted);
  const matches = exact.length > 0 ? exact : all.filter((type) => type.name === wanted);
  if (matches.length === 0) return { state: "missing", wanted };
  if (matches.length > 1) return { state: "ambiguous", wanted, candidates: matches.map((type) => type.doc) };
  const type = matches[0]!;
  if (!type.readable) return { state: "unreadable", doc: type.doc, name: type.name };
  return { state: "typed", type };
}

function typeJson(type: FakeType, notes: number | null): Record<string, unknown> {
  return {
    doc: type.doc,
    link: type.link,
    name: type.name,
    icon: type.icon,
    featured: type.featured,
    properties: type.properties,
    folder: type.folder,
    readable: type.readable,
    ...(notes === null ? { revision: type.revision } : { notes }),
  };
}

function custom(payload: unknown): CommandOutcome {
  return { notify: null, effect: { kind: "custom" as const, ns: NS, payload }, undo: null, partial: null };
}

function missing(raw: string): PluginError {
  return { kind: "not_found", message: `host fake: il tipo «${raw}» non c'è` } satisfies PluginError;
}

/// Il default di una proprietà nuova, come `frontmatter_line` del core.
function blank(kind: string | null): string {
  if (kind === "checkbox") return " false";
  if (kind === "list" || kind === "tags") return " []";
  return "";
}

/// Il testo con `key: value` al posto della riga di `key` (e delle righe
/// rientrate che la seguono), o in fondo al frontmatter.
function withProperty(text: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  if (!text.startsWith("---\n")) return `---\n${line}\n---\n${text}`;
  const end = text.indexOf("\n---", 3);
  const lines = text.slice(4, end + 1).split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const at = lines.findIndex((row) => row.startsWith(`${key}:`));
  if (at < 0) lines.push(line);
  else {
    let stop = at + 1;
    while (stop < lines.length && /^\s/.test(lines[stop] ?? "")) stop += 1;
    lines.splice(at, stop - at, line);
  }
  return `---\n${lines.join("\n")}${text.slice(end)}`;
}

export interface FakeNoteTypes {
  /// L'esito del comando, o `undefined` se il comando non è di qui.
  command(id: string, args: Record<string, unknown> | null): CommandOutcome | undefined;
}

export function fakeNoteTypes(vault: FakeTypesVault): FakeNoteTypes {
  /// Ciò che `vault.undo` rimette: il testo di prima di una proprietà scritta.
  const undo: { doc: string; text: string }[] = [];
  const text = (value: unknown): string => (typeof value === "string" ? value : "");

  function list(): CommandOutcome {
    const all = typesOf(vault);
    const counts = new Map<string, number>();
    for (const [doc, file] of vault.docs()) {
      if (doc.startsWith(`${FAKE_TYPES_FOLDER}/`)) continue;
      const raw = fakeFrontmatter(file.text).fields.get("tipo");
      if (typeof raw !== "string") continue;
      const found = resolve(vault, raw);
      if (found.state === "typed") counts.set(found.type.doc, (counts.get(found.type.doc) ?? 0) + 1);
    }
    return custom({ folder: FAKE_TYPES_FOLDER, types: all.map((type) => typeJson(type, counts.get(type.doc) ?? 0)) });
  }

  function get(raw: string): CommandOutcome {
    if (raw.trim() === "") return custom({ state: "untyped" });
    const found = resolve(vault, raw);
    return custom(found.state === "typed" ? { state: "typed", type: typeJson(found.type, null) } : found);
  }

  function fromType(args: Record<string, unknown> | null): CommandOutcome {
    const raw = text(args?.type);
    const found = resolve(vault, raw);
    if (found.state !== "typed") throw missing(raw);
    const type = found.type;
    if (args?.expected_revision !== undefined && args.expected_revision !== type.revision) {
      throw { kind: "conflict", message: `host fake: il tipo «${type.name}» è cambiato` } satisfies PluginError;
    }
    const title = text(args?.name).trim() || UNTITLED;
    const folder = text(args?.folder) || type.folder;
    const base = folder ? `${folder}/${title}` : title;
    let doc = `${base}.md`;
    for (let n = 1; vault.read(doc) !== undefined; n += 1) doc = `${base} ${n}.md`;
    const name = stem(doc).slice(stem(doc).lastIndexOf("/") + 1);
    let head = `---\ntipo: "[[${type.link}]]"\n`;
    for (const property of type.properties) {
      if (property.key !== "tipo") head += `${property.key}:${blank(property.kind)}\n`;
    }
    head += "---\n";
    vault.write(doc, head + type.template.replaceAll("{{title}}", name));
    vault.changed(doc);
    return { notify: null, effect: { kind: "navigate" as const, doc }, undo: null, partial: null };
  }

  function setProperty(args: Record<string, unknown> | null): CommandOutcome {
    const doc = text(args?.doc);
    const before = vault.read(doc);
    if (!before) throw { kind: "not_found", message: `host fake: «${doc}» non c'è` } satisfies PluginError;
    if (args?.expected_revision !== undefined && args.expected_revision !== before.revision) {
      throw { kind: "conflict", message: `host fake: «${doc}» è cambiato` } satisfies PluginError;
    }
    const key = text(args?.key);
    vault.write(doc, withProperty(before.text, key, text(args?.value)));
    vault.changed(doc);
    undo.push({ doc, text: before.text });
    return {
      notify: null,
      effect: { kind: "done" as const },
      undo: { label: `la proprietà «${key}»`, steps: [] },
      partial: null,
    };
  }

  return {
    command(id, args) {
      switch (id) {
        case "note.type.list":
          return list();
        case "note.type.get":
          return get(text(args?.type));
        case "note.from_type":
          return fromType(args);
        case "note.property.set":
          return setProperty(args);
        case "vault.undo": {
          const last = undo.pop();
          if (!last) return undefined;
          vault.write(last.doc, last.text);
          vault.changed(last.doc);
          return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
        }
        default:
          return undefined;
      }
    },
  };
}
