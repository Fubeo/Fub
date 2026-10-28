// Il profilo a righe di Scrittura: il testo di un disegno SVG, fatto di righe
// (`tspan`) e di pezzi con i loro attributi, come documento ProseMirror.
//
// - **Una riga è un paragrafo** (`line`), coi suoi attributi intatti.
// - **Gli attributi di un pezzo diventano le marche di Scrittura** dove ce
//   n'è una che li dice: `font-weight` da 600 in su è `b`, `font-style` è
//   `i`, una linea di `text-decoration` è `u` o `s`, `font-family` è `font`,
//   `font-size` è `size`, un `fill` `#rrggbb` è `color`. Ogni marca tiene il
//   valore com'era scritto.
// - **Il resto viaggia intatto** nella marca opaca `rest`, con l'ordine in cui
//   il pezzo scriveva i suoi attributi: andata e ritorno ridanno lo stesso
//   pezzo, attributo per attributo.
//
// Chi monta il profilo dà lo stile CSS di un pezzo (`css`): il profilo non sa
// come il disegno mostra un colore o un carattere.
import { Mark, Schema, type MarkSpec, type Node as PmNode } from "prosemirror-model";

export type LineAttrs = Readonly<Record<string, string>>;

/// Un pezzo: il testo e i suoi attributi; `null` è il testo della riga.
export interface LinePiece {
  readonly text: string;
  readonly attrs: LineAttrs | null;
}

export interface WrittenLine {
  readonly attrs: LineAttrs;
  readonly spans: readonly LinePiece[];
}

/// Un punto: la riga, e quante unità UTF-16 la precedono nella riga.
export interface LineCaret {
  readonly line: number;
  readonly offset: number;
}

/// Lo stile di un pezzo, scritto da chi monta il profilo.
export type LineCss = (attrs: LineAttrs) => string;

export interface LinesProfileOptions {
  /// La classe di una riga.
  readonly lineClass: string;
  /// La classe di un pezzo con un aspetto suo.
  readonly pieceClass: string;
  readonly css: LineCss;
}

/// L'ordine delle linee, come le scrive un pezzo.
const LINE_ORDER = ["underline", "line-through"];
/// Il peso da cui un carattere è in grassetto.
const BOLD_FROM = 600;

function weightOf(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "bold" || trimmed === "bolder") return 700;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : 400;
}

/// Le marche che dicono un attributo, con il loro nome e come lo leggono e lo
/// scrivono. L'ordine è quello delle marche nello schema.
const MAPPED: ReadonlyArray<{
  readonly mark: string;
  readonly attr: string;
  /// Vero se la marca può tenere `value`.
  readonly takes: (value: string) => boolean;
}> = [
  { mark: "b", attr: "font-weight", takes: (value) => weightOf(value) >= BOLD_FROM },
  { mark: "i", attr: "font-style", takes: (value) => value.trim() === "italic" || value.trim() === "oblique" },
  { mark: "font", attr: "font-family", takes: () => true },
  { mark: "size", attr: "font-size", takes: () => true },
  { mark: "color", attr: "fill", takes: (value) => /^#[0-9a-f]{6}$/.test(value) },
];

/// Le linee di `value`, se sono soltanto sottolineato e barrato, scritte
/// nell'ordine di sempre; `null` se `value` dice altro.
function plainLines(value: string): string[] | null {
  const words = value.trim().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return null;
  const ordered = LINE_ORDER.filter((line) => words.includes(line));
  return ordered.length === words.length && ordered.join(" ") === value ? ordered : null;
}

/// Lo schema del profilo. Le marche non disegnano niente di loro: l'aspetto
/// di un pezzo lo dà, tutto insieme, la decorazione del campo
/// (`pieceDecorations`), così un pezzo è un elemento solo.
export function linesSchema(options: Pick<LinesProfileOptions, "lineClass">): Schema {
  const plain = (name: string): MarkSpec["toDOM"] => () => ["span", { "data-line-mark": name }, 0];
  const valued = (name: string): MarkSpec => ({ attrs: { value: {} }, toDOM: plain(name) });
  return new Schema({
    nodes: {
      doc: { content: "line+" },
      line: {
        content: "text*",
        attrs: { attrs: { default: {} } },
        toDOM: () => ["div", { class: options.lineClass }, 0],
        // Una riga che il browser fa da sé arriva senza attributi.
        parseDOM: [{ tag: "div" }],
      },
      text: {},
    },
    marks: {
      rest: { attrs: { attrs: { default: {} }, order: { default: [] } }, toDOM: plain("rest") },
      b: valued("b"),
      i: valued("i"),
      u: { toDOM: plain("u") },
      s: { toDOM: plain("s") },
      font: valued("font"),
      size: valued("size"),
      color: valued("color"),
    },
  });
}

/// Le marche di un pezzo.
export function marksOf(schema: Schema, attrs: LineAttrs | null): Mark[] {
  if (attrs === null) return [];
  const rest: Record<string, string> = {};
  const marks: Mark[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    const mapped = MAPPED.find((each) => each.attr === name && each.takes(value));
    if (mapped !== undefined) {
      marks.push(schema.marks[mapped.mark]!.create({ value }));
      continue;
    }
    const lines = name === "text-decoration" ? plainLines(value) : null;
    if (lines !== null) {
      for (const line of lines) marks.push(schema.marks[line === "underline" ? "u" : "s"]!.create());
      continue;
    }
    rest[name] = value;
  }
  marks.push(schema.marks.rest!.create({ attrs: rest, order: Object.keys(attrs) }));
  return sortMarks(marks);
}

/// Le marche nell'ordine dello schema, come le vuole ProseMirror.
function sortMarks(marks: Mark[]): Mark[] {
  return [...Mark.setFrom(marks)];
}

/// Gli attributi di un pezzo con `marks`; `null` senza marche.
export function attrsOf(marks: readonly Mark[]): LineAttrs | null {
  if (marks.length === 0) return null;
  const values: Record<string, string> = {};
  let order: readonly string[] = [];
  const lines: string[] = [];
  for (const mark of marks) {
    const name = mark.type.name;
    if (name === "rest") {
      Object.assign(values, mark.attrs.attrs as LineAttrs);
      order = mark.attrs.order as readonly string[];
    } else if (name === "u") lines.push("underline");
    else if (name === "s") lines.push("line-through");
    else {
      const mapped = MAPPED.find((each) => each.mark === name);
      if (mapped !== undefined) values[mapped.attr] = mark.attrs.value as string;
    }
  }
  if (lines.length > 0) values["text-decoration"] = LINE_ORDER.filter((line) => lines.includes(line)).join(" ");
  // L'ordine del pezzo, e dopo ciò che una marca nuova ha aggiunto.
  const out: Record<string, string> = {};
  for (const name of order) if (name in values) out[name] = values[name]!;
  for (const [name, value] of Object.entries(values)) if (!(name in out)) out[name] = value;
  return Object.keys(out).length === 0 ? null : out;
}

/// Il documento delle righe `lines`.
export function linesDoc(schema: Schema, lines: readonly WrittenLine[]): PmNode {
  const rows = (lines.length === 0 ? [{ attrs: {}, spans: [] }] : lines).map((line) =>
    schema.nodes.line!.create(
      { attrs: line.attrs },
      line.spans.filter((span) => span.text !== "").map((span) => schema.text(span.text, marksOf(schema, span.attrs))),
    ),
  );
  return schema.nodes.doc!.create(null, rows);
}

/// Le righe del documento `doc`.
export function docLines(doc: PmNode): WrittenLine[] {
  const out: WrittenLine[] = [];
  doc.forEach((line) => {
    const spans: LinePiece[] = [];
    line.forEach((text) => {
      const attrs = attrsOf(text.marks);
      const last = spans[spans.length - 1];
      if (last !== undefined && sameAttrs(last.attrs, attrs)) spans[spans.length - 1] = { text: last.text + (text.text ?? ""), attrs: last.attrs };
      else spans.push({ text: text.text ?? "", attrs });
    });
    out.push({ attrs: line.attrs.attrs as LineAttrs, spans });
  });
  return out;
}

function sameAttrs(a: LineAttrs | null, b: LineAttrs | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/// La posizione del documento del punto `caret`.
export function posOf(doc: PmNode, caret: LineCaret): number {
  let pos = 0;
  const last = doc.childCount - 1;
  const line = Math.max(0, Math.min(last, caret.line));
  for (let i = 0; i < line; i++) pos += doc.child(i).nodeSize;
  const row = doc.child(line);
  return pos + 1 + Math.max(0, Math.min(row.content.size, caret.offset));
}

/// Il punto della posizione `pos` del documento.
export function caretOf(doc: PmNode, pos: number): LineCaret {
  const $pos = doc.resolve(Math.max(0, Math.min(doc.content.size, pos)));
  if ($pos.depth === 0) {
    const line = Math.min(doc.childCount - 1, $pos.index());
    return { line, offset: $pos.index() >= doc.childCount ? doc.child(line).content.size : 0 };
  }
  return { line: $pos.index(0), offset: $pos.parentOffset };
}
