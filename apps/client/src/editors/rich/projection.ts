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
// - `f` di un tratto è l'aspetto **risolto** dove differisce da quello del
//   paragrafo: come `m`, cambiarlo chiede formattazione diretta;
// - `align` di un paragrafo è risolto, `p` è la disposizione risolta dove
//   differisce da quella dello stile, `s` lo stile di un paragrafo di corpo:
//   anche questi, cambiati, chiedono formattazione diretta o un altro stile;
// - `f` di un paragrafo e del documento, gli stili proposti, `label`, `w` e
//   `h` sono suggerimenti di resa che il ritorno ignora.
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
export const MARKS = ["b", "i", "u", "s", "h", "sup", "sub", "caps", "small_caps"] as const;
export type Mark = (typeof MARKS)[number];

/// L'aspetto di un carattere che non è un'enfasi: in un tratto ogni campo c'è
/// soltanto dove differisce da quello del paragrafo.
export interface Look {
  readonly font?: string;
  /// Punti.
  readonly size?: number;
  /// `#rrggbb` minuscolo, o `auto`.
  readonly color?: string;
  /// Il colore dell'evidenziatore quando non è il giallo.
  readonly hl?: string;
}

/// L'interlinea: un multiplo della riga singola, o almeno o esattamente tanti
/// punti.
export type Line =
  | { readonly multiple: number }
  | { readonly at_least: number }
  | { readonly exactly: number };

/// Rientri, spaziature e interlinea dove differiscono da quelli dello stile.
/// Punti; `first` è la prima riga rispetto al rientro sinistro, negativa se
/// sporge.
export interface Layout {
  readonly left?: number;
  readonly right?: number;
  readonly first?: number;
  readonly before?: number;
  readonly after?: number;
  readonly line?: Line;
}

export const LAYOUT_LENGTHS = ["left", "right", "first", "before", "after"] as const;
export type LayoutLength = (typeof LAYOUT_LENGTHS)[number];

/// Uno stile di paragrafo da proporre oltre ai ruoli.
export interface ParaStyle {
  readonly id: string;
  readonly name: string;
  readonly f?: Look;
}

/// Il giallo che un tratto evidenziato senza `hl` porta.
export const HIGHLIGHT_DEFAULT = "#ffff00";
export const COLOR_AUTO = "auto";

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

/// Una revisione tracciata: chi l'ha fatta e quando. Due con gli stessi campi
/// sono la stessa revisione. `mv` è il nome dello spostamento di cui è un capo.
export interface Rev {
  readonly by?: string;
  readonly at?: string;
  readonly mv?: string;
}

/// Inserito (`ins`) o eliminato (`del`) con le revisioni tracciate.
export interface Tracked {
  readonly ins?: Rev;
  readonly del?: Rev;
}

export interface TextInline extends Tracked {
  readonly t: "text";
  readonly x: string;
  readonly k?: string;
  readonly m?: readonly Mark[];
  readonly href?: string;
  readonly f?: Look;
}

/// Un oggetto. Senza `k` è nuovo: un'immagine con i suoi byte (`data`, base64)
/// e la sua misura in punti, o una nota con il suo testo (`note`), di chiusura
/// se `end`. Il formato lo scrive alla sua maniera.
export interface AtomInline extends Tracked {
  readonly t: "atom";
  readonly k?: string;
  readonly kind: AtomKind;
  readonly label?: string;
  readonly w?: number;
  readonly h?: number;
  readonly data?: string;
  readonly note?: string;
  readonly end?: boolean;
}

export type Inline = TextInline | AtomInline;

export interface Para {
  readonly t: "para";
  readonly role: Role;
  readonly align?: Align;
  readonly k?: string;
  readonly sect?: string;
  readonly p?: Layout;
  /// Lo stile di un paragrafo di corpo, quando non è il predefinito.
  readonly s?: string;
  /// Suggerimento: il carattere e la dimensione del testo che non ne sceglie
  /// altri.
  readonly f?: Look;
  /// Il segno di fine paragrafo inserito o eliminato: accettarlo o rifiutarlo
  /// può unire il paragrafo al seguente.
  readonly ins?: Rev;
  readonly del?: Rev;
  readonly c?: readonly Inline[];
}

/// Tabella, riga e cella nuove non hanno `k`: il formato le scrive con le
/// sue proprietà predefinite.
export interface Cell {
  readonly k?: string;
  /// Le colonne che la cella copre quando sono più di una.
  readonly span?: number;
  readonly blocks: readonly Block[];
}

export interface Row {
  readonly k?: string;
  readonly cells: readonly Cell[];
}

export interface Table {
  readonly t: "table";
  readonly k?: string;
  readonly rows: readonly Row[];
}

export type Block = Para | Table;

export interface Projection {
  readonly format: typeof PROJECTION_FORMAT;
  readonly version: typeof PROJECTION_VERSION;
  readonly readonly?: ReadOnlyReason;
  readonly lang?: string;
  /// Suggerimento: il carattere e la dimensione di un paragrafo senza stile.
  readonly f?: Look;
  readonly styles?: readonly ParaStyle[];
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

const COLOR = /^#[0-9a-f]{6}$/;

function readLook(value: unknown, where: string): Look | undefined {
  if (value === undefined) return undefined;
  const look = record(value, where);
  closed(look, ["font", "size", "color", "hl"], where);
  const font = optionalText(look.font, `${where}.font`);
  const size = optionalNumber(look.size, `${where}.size`);
  const color = optionalText(look.color, `${where}.color`);
  const hl = optionalText(look.hl, `${where}.hl`);
  if (color !== undefined && color !== COLOR_AUTO && !COLOR.test(color)) {
    throw new ProjectionError(`${where}: colore non valido`);
  }
  if (hl !== undefined && !COLOR.test(hl)) throw new ProjectionError(`${where}: evidenziatore non valido`);
  return plainLook({ font, size, color, hl });
}

/// L'aspetto senza i campi assenti; `undefined` se non ne resta nessuno.
export function plainLook(look: Look): Look | undefined {
  const out: { font?: string; size?: number; color?: string; hl?: string } = {};
  if (look.font !== undefined) out.font = look.font;
  if (look.size !== undefined) out.size = look.size;
  if (look.color !== undefined) out.color = look.color;
  if (look.hl !== undefined) out.hl = look.hl;
  return Object.keys(out).length > 0 ? out : undefined;
}

function readLine(value: unknown, where: string): Line {
  const line = record(value, where);
  const keys = Object.keys(line);
  const kind = keys[0];
  if (keys.length !== 1 || (kind !== "multiple" && kind !== "at_least" && kind !== "exactly")) {
    throw new ProjectionError(`${where}: interlinea sconosciuta`);
  }
  const n = optionalNumber(line[kind], `${where}.${kind}`) ?? 0;
  return { [kind]: n } as Line;
}

function readLayout(value: unknown, where: string): Layout | undefined {
  if (value === undefined) return undefined;
  const layout = record(value, where);
  closed(layout, [...LAYOUT_LENGTHS, "line"], where);
  const out: { -readonly [K in keyof Layout]: Layout[K] } = {};
  for (const key of LAYOUT_LENGTHS) {
    const n = optionalNumber(layout[key], `${where}.${key}`);
    if (n !== undefined) out[key] = n;
  }
  if (layout.line !== undefined) out.line = readLine(layout.line, `${where}.line`);
  return plainLayout(out);
}

/// La disposizione senza i campi assenti; `undefined` se non ne resta nessuno.
export function plainLayout(layout: Layout): Layout | undefined {
  const out: { -readonly [K in keyof Layout]: Layout[K] } = {};
  for (const key of LAYOUT_LENGTHS) if (layout[key] !== undefined) out[key] = layout[key];
  if (layout.line !== undefined) out.line = layout.line;
  return Object.keys(out).length > 0 ? out : undefined;
}

function readRev(value: unknown, where: string): Rev | undefined {
  if (value === undefined) return undefined;
  const rev = record(value, where);
  closed(rev, ["by", "at", "mv"], where);
  const by = optionalText(rev.by, `${where}.by`);
  const at = optionalText(rev.at, `${where}.at`);
  const mv = optionalText(rev.mv, `${where}.mv`);
  // Un campo vuoto è un campo assente, come lo scrive serde.
  return { ...(by ? { by } : {}), ...(at ? { at } : {}), ...(mv !== undefined ? { mv } : {}) };
}

function readTracked(value: Json, where: string): Tracked {
  const ins = readRev(value.ins, `${where}.ins`);
  const del = readRev(value.del, `${where}.del`);
  return { ...(ins ? { ins } : {}), ...(del ? { del } : {}) };
}

function readStyle(value: unknown, where: string): ParaStyle {
  const style = record(value, where);
  closed(style, ["id", "name", "f"], where);
  return {
    id: text(style.id, `${where}.id`),
    name: text(style.name, `${where}.name`),
    ...withLook(readLook(style.f, `${where}.f`)),
  };
}

function readInline(value: unknown, where: string): Inline {
  const inline = record(value, where);
  if (inline.t === "text") {
    closed(inline, ["t", "x", "k", "m", "href", "f", "ins", "del"], where);
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
      ...withLook(readLook(inline.f, `${where}.f`)),
      ...readTracked(inline, where),
    };
  }
  if (inline.t === "atom") {
    closed(inline, ["t", "k", "kind", "label", "w", "h", "data", "note", "end", "ins", "del"], where);
    if (!(ATOM_KINDS as readonly unknown[]).includes(inline.kind)) {
      throw new ProjectionError(`${where}: oggetto sconosciuto`);
    }
    const label = optionalText(inline.label, `${where}.label`);
    const w = optionalNumber(inline.w, `${where}.w`);
    const h = optionalNumber(inline.h, `${where}.h`);
    const k = optionalText(inline.k, `${where}.k`);
    const data = optionalText(inline.data, `${where}.data`);
    const note = optionalText(inline.note, `${where}.note`);
    if (inline.end !== undefined && typeof inline.end !== "boolean") {
      throw new ProjectionError(`${where}.end: atteso un sì o un no`);
    }
    // Un oggetto o si tiene (`k`) o è nuovo: un'immagine o una nota.
    const fresh = (inline.kind === "image" && data !== undefined && note === undefined && inline.end !== true)
      || (inline.kind === "note" && note !== undefined && data === undefined);
    if (k !== undefined ? data !== undefined || note !== undefined || inline.end === true : !fresh) {
      throw new ProjectionError(`${where}: oggetto né tenuto né nuovo`);
    }
    return {
      t: "atom",
      ...(k !== undefined ? { k } : {}),
      kind: inline.kind as AtomKind,
      ...(label ? { label } : {}),
      ...(w !== undefined ? { w } : {}),
      ...(h !== undefined ? { h } : {}),
      ...(data !== undefined ? { data } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(inline.end === true ? { end: true } : {}),
      ...readTracked(inline, where),
    };
  }
  throw new ProjectionError(`${where}: elemento sconosciuto`);
}

function readBlock(value: unknown, where: string): Block {
  const block = record(value, where);
  if (block.t === "para") {
    closed(block, ["t", "role", "align", "k", "sect", "p", "s", "f", "ins", "del", "c"], where);
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
      ...withLayout(readLayout(block.p, `${where}.p`)),
      ...(block.s !== undefined ? { s: text(block.s, `${where}.s`) } : {}),
      ...withLook(readLook(block.f, `${where}.f`)),
      ...readTracked(block, where),
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
        closed(cell, ["k", "span", "blocks"], at);
        const span = optionalNumber(cell.span, `${at}.span`);
        if (span !== undefined && (!Number.isInteger(span) || span < 1)) throw new ProjectionError(`${at}.span: atteso un intero positivo`);
        return {
          ...(cell.k !== undefined ? { k: text(cell.k, `${at}.k`) } : {}),
          ...(span !== undefined && span > 1 ? { span } : {}),
          blocks: list(cell.blocks, `${at}.blocks`).map((b, i) => readBlock(b, `${at}.blocks[${i}]`)),
        };
      });
      return { ...(row.k !== undefined ? { k: text(row.k, `${where}.rows[${r}].k`) } : {}), cells };
    });
    return { t: "table", ...(block.k !== undefined ? { k: text(block.k, `${where}.k`) } : {}), rows };
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
  closed(root, ["format", "version", "readonly", "lang", "f", "styles", "blocks"], "proiezione");
  const readonly = root.readonly;
  if (readonly !== undefined && !(READ_ONLY_REASONS as readonly unknown[]).includes(readonly)) {
    throw new ProjectionError("motivo di sola lettura sconosciuto");
  }
  return {
    format: PROJECTION_FORMAT,
    version: PROJECTION_VERSION,
    ...(readonly !== undefined ? { readonly: readonly as ReadOnlyReason } : {}),
    ...(root.lang !== undefined ? { lang: text(root.lang, "lang") } : {}),
    ...withLook(readLook(root.f, "f")),
    ...(root.styles !== undefined ? { styles: list(root.styles, "styles").map((s, i) => readStyle(s, `styles[${i}]`)) } : {}),
    blocks: list(root.blocks, "blocks").map((b, i) => readBlock(b, `blocks[${i}]`)),
  };
}

function withLook(f: Look | undefined): { f?: Look } {
  return f ? { f } : {};
}

function withLayout(p: Layout | undefined): { p?: Layout } {
  return p ? { p } : {};
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

function writeLook(look: Look | undefined): string {
  if (!look) return "";
  const fields: string[] = [];
  if (look.font !== undefined) fields.push(`"font":${JSON.stringify(look.font)}`);
  if (look.size !== undefined) fields.push(`"size":${float(look.size)}`);
  if (look.color !== undefined) fields.push(`"color":${JSON.stringify(look.color)}`);
  if (look.hl !== undefined) fields.push(`"hl":${JSON.stringify(look.hl)}`);
  return fields.length > 0 ? `,"f":{${fields.join(",")}}` : "";
}

function writeLayout(layout: Layout | undefined): string {
  if (!layout) return "";
  const fields: string[] = [];
  for (const key of LAYOUT_LENGTHS) {
    const n = layout[key];
    if (n !== undefined) fields.push(`"${key}":${float(n)}`);
  }
  if (layout.line) {
    const [kind, n] = Object.entries(layout.line)[0] as [string, number];
    fields.push(`"line":{"${kind}":${float(n)}}`);
  }
  return fields.length > 0 ? `,"p":{${fields.join(",")}}` : "";
}

function writeRev(name: "ins" | "del", rev: Rev | undefined): string {
  if (!rev) return "";
  const fields: string[] = [];
  if (rev.by) fields.push(`"by":${JSON.stringify(rev.by)}`);
  if (rev.at) fields.push(`"at":${JSON.stringify(rev.at)}`);
  if (rev.mv !== undefined) fields.push(`"mv":${JSON.stringify(rev.mv)}`);
  return `,"${name}":{${fields.join(",")}}`;
}

function writeTracked(tracked: Tracked): string {
  return writeRev("ins", tracked.ins) + writeRev("del", tracked.del);
}

function writeInline(inline: Inline): string {
  if (inline.t === "text") {
    let out = `{"t":"text","x":${JSON.stringify(inline.x)}`;
    if (inline.k !== undefined) out += `,"k":${JSON.stringify(inline.k)}`;
    if (inline.m && inline.m.length > 0) out += `,"m":${JSON.stringify(inline.m)}`;
    if (inline.href !== undefined) out += `,"href":${JSON.stringify(inline.href)}`;
    out += writeLook(inline.f);
    return out + writeTracked(inline) + "}";
  }
  let out = `{"t":"atom"`;
  if (inline.k !== undefined) out += `,"k":${JSON.stringify(inline.k)}`;
  out += `,"kind":"${inline.kind}"`;
  if (inline.label) out += `,"label":${JSON.stringify(inline.label)}`;
  if (inline.w !== undefined) out += `,"w":${float(inline.w)}`;
  if (inline.h !== undefined) out += `,"h":${float(inline.h)}`;
  if (inline.data !== undefined) out += `,"data":${JSON.stringify(inline.data)}`;
  if (inline.note !== undefined) out += `,"note":${JSON.stringify(inline.note)}`;
  if (inline.end) out += `,"end":true`;
  return out + writeTracked(inline) + "}";
}

/// Un blocco in JSON, con i campi nell'ordine di serde.
export function writeBlock(block: Block): string {
  if (block.t === "para") {
    let out = `{"t":"para","role":${writeRole(block.role)}`;
    if (block.align !== undefined) out += `,"align":"${block.align}"`;
    if (block.k !== undefined) out += `,"k":${JSON.stringify(block.k)}`;
    if (block.sect !== undefined) out += `,"sect":${JSON.stringify(block.sect)}`;
    out += writeLayout(block.p);
    if (block.s !== undefined) out += `,"s":${JSON.stringify(block.s)}`;
    out += writeLook(block.f);
    out += writeTracked(block);
    if (block.c && block.c.length > 0) out += `,"c":[${block.c.map(writeInline).join(",")}]`;
    return out + "}";
  }
  // Una tabella, una riga o una cella nuova non ha `k`.
  const key = (k: string | undefined, comma: string) => (k === undefined ? "" : `"k":${JSON.stringify(k)}${comma}`);
  const rows = block.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const span = cell.span !== undefined && cell.span > 1 ? `"span":${cell.span},` : "";
      return `{${key(cell.k, ",")}${span}"blocks":[${cell.blocks.map(writeBlock).join(",")}]}`;
    });
    return `{${key(row.k, ",")}"cells":[${cells.join(",")}]}`;
  });
  return `{"t":"table",${key(block.k, ",")}"rows":[${rows.join(",")}]}`;
}

/// L'intestazione della proiezione fino all'elenco dei blocchi escluso.
export function writeHead(projection: Pick<Projection, "readonly" | "lang" | "f" | "styles">): string {
  let out = `{"format":"${PROJECTION_FORMAT}","version":${PROJECTION_VERSION}`;
  if (projection.readonly !== undefined) out += `,"readonly":"${projection.readonly}"`;
  if (projection.lang !== undefined) out += `,"lang":${JSON.stringify(projection.lang)}`;
  out += writeLook(projection.f);
  if (projection.styles && projection.styles.length > 0) {
    const styles = projection.styles.map(
      (s) => `{"id":${JSON.stringify(s.id)},"name":${JSON.stringify(s.name)}${writeLook(s.f)}}`,
    );
    out += `,"styles":[${styles.join(",")}]`;
  }
  return out + `,"blocks":[`;
}

/// La proiezione in JSON. `blocks` già scritti si passano come testo: chi ne
/// tiene una cache per blocco non li riscrive.
export function writeProjection(projection: Projection, blocks?: readonly string[]): string {
  return writeHead(projection) + (blocks ?? projection.blocks.map(writeBlock)).join(",") + "]}";
}
