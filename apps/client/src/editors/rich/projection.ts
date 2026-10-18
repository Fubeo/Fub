// La proiezione modificabile dei documenti di videoscrittura, versione 1: il
// testo che il buffer della sessione porta per uno di quei documenti.
//
// La forma la possiede `fub-format-rich` (`crates/fub-format-rich/src/projection.rs`):
// qui c'è il suo specchio, senza ProseMirror, perché leggerla e riscriverla
// sono regole pure, provate da sole. Tre cose valgono per chi la modifica:
//
// - `k` (e `sect`) sono **opachi**: si portano com'erano, mai si fabbricano.
//   Il ritorno al documento li decodifica; uno che il documento non conosce
//   rompe il salvataggio, quindi la superficie non ne inventa;
// - `m` è l'enfasi **risolta**: cambiarla chiede al documento formattazione
//   diretta, non toccarla lascia il tratto com'era;
// - `align`, `label`, `w` e `h` sono suggerimenti di resa che il ritorno
//   ignora.
//
// La scrittura segue l'ordine e le omissioni di serde (campi assenti quando
// vuoti), così un blocco non toccato si riscrive com'era arrivato.

export const PROJECTION_FORMAT = "fub-rich";
export const PROJECTION_VERSION = 1;

export type ReadOnlyReason = "revisions" | "track_changes" | "protected" | "projection" | "codec" | "import";
export const READ_ONLY_REASONS: readonly ReadOnlyReason[] = [
  "revisions",
  "track_changes",
  "protected",
  "projection",
  "codec",
  "import",
];

export type Role =
  | { readonly kind: "body" }
  | { readonly kind: "heading"; readonly level: number }
  | { readonly kind: "list"; readonly ordered: boolean; readonly level: number }
  | { readonly kind: "quote" };

export type Align = "left" | "center" | "right" | "justify";

/// L'enfasi, nell'ordine canonico della proiezione.
export const MARKS = ["b", "i", "u", "s", "h", "sup", "sub"] as const;
export type Mark = (typeof MARKS)[number];

export const ATOM_KINDS = [
  "image",
  "graphic",
  "shape",
  "group",
  "field",
  "note",
  "equation",
  "ruby",
  "opaque",
  "marker",
] as const;
export type AtomKind = (typeof ATOM_KINDS)[number];

export interface TextInline {
  readonly t: "text";
  readonly x: string;
  readonly k?: string;
  readonly m?: readonly Mark[];
  readonly href?: string;
}

export interface AtomInline {
  readonly t: "atom";
  readonly k: string;
  readonly kind: AtomKind;
  readonly label?: string;
  readonly w?: number;
  readonly h?: number;
}

export type Inline = TextInline | AtomInline;

export interface Para {
  readonly t: "para";
  readonly role: Role;
  readonly align?: Align;
  readonly k?: string;
  readonly sect?: string;
  readonly c?: readonly Inline[];
}

export interface Cell {
  readonly k: string;
  readonly blocks: readonly Block[];
}

export interface Row {
  readonly k: string;
  readonly cells: readonly Cell[];
}

export interface Table {
  readonly t: "table";
  readonly k: string;
  readonly rows: readonly Row[];
}

export type Block = Para | Table;

export interface Projection {
  readonly format: typeof PROJECTION_FORMAT;
  readonly version: typeof PROJECTION_VERSION;
  readonly readonly?: ReadOnlyReason;
  readonly lang?: string;
  readonly blocks: readonly Block[];
}

export const BODY: Role = { kind: "body" };

/// Perché un testo non è una proiezione che questa superficie sa leggere.
export class ProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionError";
  }
}

type Json = Record<string, unknown>;

function record(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectionError(`${where}: atteso un oggetto`);
  }
  return value as Json;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new ProjectionError(`${where}: atteso un elenco`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string") throw new ProjectionError(`${where}: atteso un testo`);
  return value;
}

function optionalText(value: unknown, where: string): string | undefined {
  return value === undefined ? undefined : text(value, where);
}

function optionalNumber(value: unknown, where: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ProjectionError(`${where}: atteso un numero`);
  return value;
}

/// Nessun campo oltre a quelli noti: la forma è chiusa (`deny_unknown_fields`),
/// e uno sconosciuto vuol dire una versione che qui non si legge.
function closed(object: Json, fields: readonly string[], where: string): void {
  for (const key of Object.keys(object)) {
    if (!fields.includes(key)) throw new ProjectionError(`${where}: campo sconosciuto ${key}`);
  }
}

function level(value: unknown, max: number, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new ProjectionError(`${where}: livello non valido`);
  }
  return Math.min(value, max);
}

function readRole(value: unknown, where: string): Role {
  const role = record(value, where);
  switch (role.kind) {
    case "body":
      closed(role, ["kind"], where);
      return BODY;
    case "quote":
      closed(role, ["kind"], where);
      return { kind: "quote" };
    case "heading":
      closed(role, ["kind", "level"], where);
      return { kind: "heading", level: Math.max(1, level(role.level, 9, where)) };
    case "list":
      closed(role, ["kind", "ordered", "level"], where);
      if (typeof role.ordered !== "boolean") throw new ProjectionError(`${where}: ordered non valido`);
      return { kind: "list", ordered: role.ordered, level: level(role.level, 8, where) };
    default:
      throw new ProjectionError(`${where}: ruolo sconosciuto`);
  }
}

function readInline(value: unknown, where: string): Inline {
  const inline = record(value, where);
  if (inline.t === "text") {
    closed(inline, ["t", "x", "k", "m", "href"], where);
    const marks = inline.m === undefined ? undefined : list(inline.m, `${where}.m`).map((mark) => {
      if (!(MARKS as readonly unknown[]).includes(mark)) throw new ProjectionError(`${where}: enfasi sconosciuta`);
      return mark as Mark;
    });
    return {
      t: "text",
      x: text(inline.x, `${where}.x`),
      ...(inline.k !== undefined ? { k: text(inline.k, `${where}.k`) } : {}),
      ...(marks && marks.length > 0 ? { m: canonicalMarks(marks) } : {}),
      ...(inline.href !== undefined ? { href: text(inline.href, `${where}.href`) } : {}),
    };
  }
  if (inline.t === "atom") {
    closed(inline, ["t", "k", "kind", "label", "w", "h"], where);
    if (!(ATOM_KINDS as readonly unknown[]).includes(inline.kind)) {
      throw new ProjectionError(`${where}: oggetto sconosciuto`);
    }
    const label = optionalText(inline.label, `${where}.label`);
    const w = optionalNumber(inline.w, `${where}.w`);
    const h = optionalNumber(inline.h, `${where}.h`);
    return {
      t: "atom",
      k: text(inline.k, `${where}.k`),
      kind: inline.kind as AtomKind,
      ...(label ? { label } : {}),
      ...(w !== undefined ? { w } : {}),
      ...(h !== undefined ? { h } : {}),
    };
  }
  throw new ProjectionError(`${where}: elemento sconosciuto`);
}

function readBlock(value: unknown, where: string): Block {
  const block = record(value, where);
  if (block.t === "para") {
    closed(block, ["t", "role", "align", "k", "sect", "c"], where);
    const align = block.align;
    if (align !== undefined && !["left", "center", "right", "justify"].includes(align as string)) {
      throw new ProjectionError(`${where}: allineamento sconosciuto`);
    }
    const c = block.c === undefined ? [] : list(block.c, `${where}.c`).map((x, i) => readInline(x, `${where}.c[${i}]`));
    return {
      t: "para",
      role: readRole(block.role, `${where}.role`),
      ...(align !== undefined ? { align: align as Align } : {}),
      ...(block.k !== undefined ? { k: text(block.k, `${where}.k`) } : {}),
      ...(block.sect !== undefined ? { sect: text(block.sect, `${where}.sect`) } : {}),
      ...(c.length > 0 ? { c } : {}),
    };
  }
  if (block.t === "table") {
    closed(block, ["t", "k", "rows"], where);
    const rows = list(block.rows, `${where}.rows`).map((value, r) => {
      const row = record(value, `${where}.rows[${r}]`);
      closed(row, ["k", "cells"], `${where}.rows[${r}]`);
      const cells = list(row.cells, `${where}.rows[${r}].cells`).map((value, c) => {
        const at = `${where}.rows[${r}].cells[${c}]`;
        const cell = record(value, at);
        closed(cell, ["k", "blocks"], at);
        return {
          k: text(cell.k, `${at}.k`),
          blocks: list(cell.blocks, `${at}.blocks`).map((b, i) => readBlock(b, `${at}.blocks[${i}]`)),
        };
      });
      return { k: text(row.k, `${where}.rows[${r}].k`), cells };
    });
    return { t: "table", k: text(block.k, `${where}.k`), rows };
  }
  throw new ProjectionError(`${where}: blocco sconosciuto`);
}

/// Legge il testo del buffer. Lancia `ProjectionError` per tutto ciò che il
/// ritorno al documento rifiuterebbe per forma o versione.
export function parseProjection(source: string): Projection {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ProjectionError("non è JSON");
  }
  const root = record(value, "proiezione");
  if (root.format !== PROJECTION_FORMAT) throw new ProjectionError("formato sconosciuto");
  if (root.version !== PROJECTION_VERSION) throw new ProjectionError(`versione ${String(root.version)}`);
  closed(root, ["format", "version", "readonly", "lang", "blocks"], "proiezione");
  const readonly = root.readonly;
  if (readonly !== undefined && !(READ_ONLY_REASONS as readonly unknown[]).includes(readonly)) {
    throw new ProjectionError("motivo di sola lettura sconosciuto");
  }
  return {
    format: PROJECTION_FORMAT,
    version: PROJECTION_VERSION,
    ...(readonly !== undefined ? { readonly: readonly as ReadOnlyReason } : {}),
    ...(root.lang !== undefined ? { lang: text(root.lang, "lang") } : {}),
    blocks: list(root.blocks, "blocks").map((b, i) => readBlock(b, `blocks[${i}]`)),
  };
}

/// L'enfasi senza doppioni, nell'ordine canonico.
export function canonicalMarks(marks: Iterable<Mark>): Mark[] {
  const set = new Set(marks);
  return MARKS.filter((mark) => set.has(mark));
}

function writeRole(role: Role): string {
  switch (role.kind) {
    case "body":
    case "quote":
      return `{"kind":"${role.kind}"}`;
    case "heading":
      return `{"kind":"heading","level":${role.level}}`;
    case "list":
      return `{"kind":"list","ordered":${role.ordered},"level":${role.level}}`;
  }
}

/// Un `f32` come lo scrive serde: un intero porta `.0`, il resto la forma
/// più corta, che JavaScript ritrova uguale perché la legge da quella.
function float(n: number): string {
  return Number.isInteger(n) && Math.abs(n) < 1e16 ? `${n}.0` : String(n);
}

function writeInline(inline: Inline): string {
  if (inline.t === "text") {
    let out = `{"t":"text","x":${JSON.stringify(inline.x)}`;
    if (inline.k !== undefined) out += `,"k":${JSON.stringify(inline.k)}`;
    if (inline.m && inline.m.length > 0) out += `,"m":${JSON.stringify(inline.m)}`;
    if (inline.href !== undefined) out += `,"href":${JSON.stringify(inline.href)}`;
    return out + "}";
  }
  let out = `{"t":"atom","k":${JSON.stringify(inline.k)},"kind":"${inline.kind}"`;
  if (inline.label) out += `,"label":${JSON.stringify(inline.label)}`;
  if (inline.w !== undefined) out += `,"w":${float(inline.w)}`;
  if (inline.h !== undefined) out += `,"h":${float(inline.h)}`;
  return out + "}";
}

/// Un blocco in JSON, con i campi nell'ordine di serde.
export function writeBlock(block: Block): string {
  if (block.t === "para") {
    let out = `{"t":"para","role":${writeRole(block.role)}`;
    if (block.align !== undefined) out += `,"align":"${block.align}"`;
    if (block.k !== undefined) out += `,"k":${JSON.stringify(block.k)}`;
    if (block.sect !== undefined) out += `,"sect":${JSON.stringify(block.sect)}`;
    if (block.c && block.c.length > 0) out += `,"c":[${block.c.map(writeInline).join(",")}]`;
    return out + "}";
  }
  const rows = block.rows.map((row) => {
    const cells = row.cells.map((cell) => `{"k":${JSON.stringify(cell.k)},"blocks":[${cell.blocks.map(writeBlock).join(",")}]}`);
    return `{"k":${JSON.stringify(row.k)},"cells":[${cells.join(",")}]}`;
  });
  return `{"t":"table","k":${JSON.stringify(block.k)},"rows":[${rows.join(",")}]}`;
}

/// L'intestazione della proiezione fino all'elenco dei blocchi escluso.
export function writeHead(projection: Pick<Projection, "readonly" | "lang">): string {
  let out = `{"format":"${PROJECTION_FORMAT}","version":${PROJECTION_VERSION}`;
  if (projection.readonly !== undefined) out += `,"readonly":"${projection.readonly}"`;
  if (projection.lang !== undefined) out += `,"lang":${JSON.stringify(projection.lang)}`;
  return out + `,"blocks":[`;
}

/// La proiezione in JSON. `blocks` già scritti si passano come testo: chi ne
/// tiene una cache per blocco non li riscrive.
export function writeProjection(projection: Projection, blocks?: readonly string[]): string {
  return writeHead(projection) + (blocks ?? projection.blocks.map(writeBlock)).join(",") + "]}";
}
