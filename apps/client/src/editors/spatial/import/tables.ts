// Le tabelle HTML nelle etichette di draw.io: un'etichetta che è, o che
// contiene, una `<table>` diventa una griglia di celle, ognuna un rettangolo
// col suo fondo e il suo bordo e un testo in area. In draw.io le misura il
// browser; qui si stimano come le fa una tabella HTML semplice:
//
// - **Le colonne** hanno la larghezza che dicono, in pixel o in percento
//   della tabella; le altre si dividono il resto in proporzione al loro testo
//   più lungo.
// - **Le righe** sono alte quanto il loro testo più i margini; se la tabella
//   dice un'altezza più grande, il di più va alle righe in proporzione.
// - **Il testo prima e dopo** la tabella resta testo, sopra e sotto.
//
// Una cella che ne copre più d'una (`colspan`, `rowspan`) prende il posto di
// tutte; una tabella dentro una cella resta testo.

import type { Bounds } from "../scene/geometry";
import { hexColor } from "./diagram";
import { attributesOf, cssSize, declarationsOf } from "./html";

/// Una lunghezza di HTML: in pixel, o in percento del contenitore.
interface Length {
  readonly value: number;
  readonly percent: boolean;
}

export type Align = "start" | "middle" | "end";
export type VAlign = "top" | "middle" | "bottom";

/// Un bordo: lo spessore e il colore.
export interface Border {
  readonly width: number;
  readonly color: string;
}

interface CellSpec {
  readonly html: string;
  readonly header: boolean;
  readonly columns: number;
  readonly rows: number;
  readonly width: Length | null;
  readonly fill: string | null;
  readonly align: Align | null;
  readonly valign: VAlign | null;
  /// Il bordo dello stile; `null` se non lo dice, `undefined` mai.
  readonly border: Border | "none" | null;
  readonly padding: number | null;
}

interface RowSpec {
  readonly cells: CellSpec[];
  readonly height: Length | null;
  readonly fill: string | null;
  readonly align: Align | null;
  readonly valign: VAlign | null;
}

/// Una tabella letta, non ancora misurata.
export interface Table {
  readonly rows: readonly RowSpec[];
  /// Il bordo attorno alla tabella, e quello di ogni cella.
  readonly frame: Border | null;
  readonly grid: Border | null;
  readonly padding: number;
  readonly spacing: number;
  readonly width: Length | null;
  readonly height: Length | null;
  readonly fill: string | null;
  readonly centred: boolean;
}

/// I pezzi di un'etichetta: HTML da scrivere come testo, o una tabella.
export type Block = { readonly kind: "html"; readonly html: string } | { readonly kind: "table"; readonly table: Table };

/// Il grigio dei bordi di una tabella nel browser.
const GRID_COLOR = "#808080";

/// Le celle che una cella copre al più, per lato.
const MAX_SPAN = 64;

/// La lunghezza di `value`, in pixel o in percento; `null` se non si legge.
function lengthOf(value: string | undefined): Length | null {
  if (value === undefined) return null;
  const text = value.trim().toLowerCase();
  const percent = /^([0-9]*\.?[0-9]+)\s*%$/.exec(text);
  if (percent !== null) return { value: Number(percent[1]), percent: true };
  const px = cssSize(text, 16);
  return px === null || !(px >= 0) ? null : { value: px, percent: false };
}

/// Il primo colore che si legge in `value`, come in `background` o `border`.
function colorIn(value: string | undefined): string | null {
  if (value === undefined) return null;
  for (const token of value.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b[a-z]+\b/gi) ?? []) {
    const color = hexColor(token);
    if (color !== null) return color;
  }
  return null;
}

/// Il fondo che dicono `bgcolor` e lo stile.
function fillOf(attributes: ReadonlyMap<string, string>, css: ReadonlyMap<string, string>): string | null {
  return colorIn(css.get("background-color")) ?? colorIn(css.get("background")) ?? hexColor(attributes.get("bgcolor"));
}

/// Il bordo che dice lo stile: `"none"` se lo toglie, `null` se tace.
function borderOf(css: ReadonlyMap<string, string>): Border | "none" | null {
  const whole = css.get("border");
  const style = css.get("border-style") ?? whole;
  if (style !== undefined && /\b(none|hidden)\b/i.test(style)) return "none";
  const widthText = css.get("border-width") ?? /(?:^|\s)([0-9]*\.?[0-9]+(?:px|pt|em)?)(?=\s|$)/i.exec(whole ?? "")?.[1] ?? /\b(thin|medium|thick)\b/i.exec(whole ?? "")?.[1];
  const color = colorIn(css.get("border-color")) ?? colorIn(whole);
  if (whole === undefined && css.get("border-width") === undefined && css.get("border-color") === undefined) return null;
  const named: Readonly<Record<string, number>> = { thin: 1, medium: 3, thick: 5 };
  const width = widthText === undefined ? 3 : (named[widthText.toLowerCase()] ?? cssSize(widthText, 16) ?? 1);
  return width > 0 ? { width, color: color ?? "#000000" } : "none";
}

function alignOf(attributes: ReadonlyMap<string, string>, css: ReadonlyMap<string, string>): Align | null {
  const value = (css.get("text-align") ?? attributes.get("align"))?.trim().toLowerCase();
  if (value === "center" || value === "middle") return "middle";
  if (value === "right" || value === "end") return "end";
  if (value === "left" || value === "start" || value === "justify") return "start";
  return null;
}

function valignOf(attributes: ReadonlyMap<string, string>, css: ReadonlyMap<string, string>): VAlign | null {
  const value = (css.get("vertical-align") ?? attributes.get("valign"))?.trim().toLowerCase();
  if (value === "top" || value === "baseline" || value === "text-top") return "top";
  if (value === "bottom" || value === "text-bottom") return "bottom";
  if (value === "middle") return "middle";
  return null;
}

const spanOf = (value: string | undefined): number => Math.min(MAX_SPAN, Math.max(1, Math.floor(Number(value)) || 1));

/// Chi legge una tabella, un tag alla volta.
class TableReader {
  private readonly rows: RowSpec[] = [];
  private cell: { readonly header: boolean; readonly attributes: Map<string, string>; readonly from: number } | null = null;

  constructor(
    private readonly html: string,
    private readonly attributes: Map<string, string>,
  ) {}

  row(attributes: Map<string, string>, at: number): void {
    this.close(at);
    const css = declarationsOf(attributes.get("style") ?? "");
    this.rows.push({ cells: [], height: lengthOf(css.get("height") ?? attributes.get("height")), fill: fillOf(attributes, css), align: alignOf(attributes, css), valign: valignOf(attributes, css) });
  }

  open(header: boolean, attributes: Map<string, string>, at: number, from: number): void {
    this.close(at);
    if (this.rows.length === 0) this.row(new Map(), at);
    this.cell = { header, attributes, from };
  }

  close(at: number): void {
    const cell = this.cell;
    if (cell === null) return;
    this.cell = null;
    const { attributes } = cell;
    const css = declarationsOf(attributes.get("style") ?? "");
    const padding = css.get("padding");
    this.rows[this.rows.length - 1]!.cells.push({
      html: this.html.slice(cell.from, at),
      header: cell.header,
      columns: spanOf(attributes.get("colspan")),
      rows: spanOf(attributes.get("rowspan")),
      width: lengthOf(css.get("width") ?? attributes.get("width")),
      fill: fillOf(attributes, css),
      align: alignOf(attributes, css),
      valign: valignOf(attributes, css),
      border: borderOf(css),
      padding: padding === undefined ? null : cssSize(padding.trim().split(/\s+/)[0]!, 16),
    });
  }

  finish(at: number): Table {
    this.close(at);
    const attributes = this.attributes;
    const css = declarationsOf(attributes.get("style") ?? "");
    const collapse = css.get("border-collapse")?.trim().toLowerCase() === "collapse";
    const attr = Math.max(0, Math.floor(Number(attributes.get("border") ?? (attributes.has("border") ? 1 : 0))) || 0);
    const color = hexColor(attributes.get("bordercolor")) ?? GRID_COLOR;
    const styled = borderOf(css);
    const frame = styled === "none" ? null : (styled ?? (attr > 0 ? { width: collapse ? 1 : attr, color } : null));
    const padding = attributes.get("cellpadding");
    const spacing = attributes.get("cellspacing");
    return {
      rows: this.rows.filter((row) => row.cells.length > 0),
      frame,
      grid: attr > 0 ? { width: 1, color } : null,
      padding: padding === undefined ? 1 : Math.max(0, Number(padding) || 0),
      spacing: collapse ? 0 : spacing === undefined ? 2 : Math.max(0, Number(spacing) || 0),
      width: lengthOf(css.get("width") ?? attributes.get("width")),
      height: lengthOf(css.get("height") ?? attributes.get("height")),
      fill: fillOf(attributes, css),
      centred: attributes.get("align")?.toLowerCase() === "center" || /\bauto\b/.test(css.get("margin") ?? ""),
    };
  }
}

/// I pezzi dell'etichetta HTML `html`; `null` se non ha una tabella.
export function labelBlocks(html: string): Block[] | null {
  if (!/<table[\s>/]/i.test(html)) return null;
  const blocks: Block[] = [];
  const text = (from: number, to: number): void => {
    const piece = html.slice(from, to);
    if (piece.replace(/<[^>]*>/g, "").trim() !== "") blocks.push({ kind: "html", html: piece });
  };
  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let pending = 0;
  let depth = 0;
  let table: TableReader | null = null;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    if (match[2] === undefined) continue;
    const tag = match[2].toLowerCase();
    const closing = match[1] === "/";
    const [start, end] = [match.index, match.index + match[0].length];
    if (tag === "table") {
      if (!closing) {
        depth++;
        if (depth === 1) {
          text(pending, start);
          table = new TableReader(html, attributesOf(match[3] ?? ""));
        }
      } else if (depth > 0 && --depth === 0) {
        blocks.push({ kind: "table", table: table!.finish(start) });
        table = null;
        pending = end;
      }
      continue;
    }
    if (depth !== 1 || table === null) continue;
    if (tag === "tr") {
      if (closing) table.close(start);
      else table.row(attributesOf(match[3] ?? ""), start);
    } else if (tag === "td" || tag === "th") {
      if (closing) table.close(start);
      else table.open(tag === "th", attributesOf(match[3] ?? ""), start, end);
    } else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
      table.close(start);
    }
  }
  if (table !== null) {
    blocks.push({ kind: "table", table: table.finish(html.length) });
    pending = html.length;
  }
  text(pending, html.length);
  return blocks.some((block) => block.kind === "table" && block.table.rows.length > 0) ? blocks : null;
}

/// Quanto occupa un pezzo di testo, a stima: l'altezza delle sue righe e la
/// larghezza della più lunga.
export interface Extent {
  readonly width: number;
  readonly height: number;
}

/// Una cella misurata, nelle coordinate dell'etichetta.
export interface PlacedCell {
  readonly box: Bounds;
  /// Il riquadro del testo: la cella meno i margini.
  readonly inner: Bounds;
  readonly html: string;
  readonly header: boolean;
  readonly align: Align;
  readonly valign: VAlign;
  readonly fill: string | null;
  readonly border: Border | null;
}

/// Un pezzo misurato: un testo nel suo riquadro, o una tabella con le celle.
export type Placed =
  | { readonly kind: "html"; readonly html: string; readonly box: Bounds }
  | { readonly kind: "table"; readonly box: Bounds; readonly fill: string | null; readonly border: Border | null; readonly cells: readonly PlacedCell[] };

/// Dove va l'etichetta: il riquadro, le misure che un percento prende (della
/// larghezza se il testo va a capo, dell'altezza se riempie la forma) e gli
/// allineamenti.
export interface Room {
  readonly box: Bounds;
  readonly width: number | null;
  readonly height: number | null;
  readonly align: Align;
  readonly valign: VAlign;
}

const resolved = (length: Length | null, whole: number | null): number | null => (length === null ? null : length.percent ? (whole === null ? null : (length.value / 100) * whole) : length.value);

/// I pezzi `blocks` messi in `room`, uno sotto l'altro; `extent` stima un
/// pezzo di HTML, intestazione o no, a capo a `width` se la dice.
export function layoutBlocks(blocks: readonly Block[], room: Room, extent: (html: string, header: boolean) => Extent): Placed[] {
  const boxWidth = room.box.max[0] - room.box.min[0];
  const measured = blocks.map((block) => (block.kind === "html" ? { block, ...extent(block.html, false), grid: null } : measureTable(block.table, room, boxWidth, extent)));
  const total = measured.reduce((sum, each) => sum + each.height, 0);
  let y = room.valign === "top" ? room.box.min[1] : room.valign === "bottom" ? room.box.max[1] - total : (room.box.min[1] + room.box.max[1] - total) / 2;
  const out: Placed[] = [];
  for (const each of measured) {
    const width = each.block.kind === "html" ? (room.width ?? each.width) : each.width;
    const centred = each.block.kind === "table" && each.block.table.centred;
    const left =
      room.width !== null && !centred
        ? room.box.min[0]
        : (centred ? "middle" : room.align) === "middle"
          ? (room.box.min[0] + room.box.max[0] - width) / 2
          : room.align === "end"
            ? room.box.max[0] - width
            : room.box.min[0];
    if (each.block.kind === "html") out.push({ kind: "html", html: each.block.html, box: { min: [left, y], max: [left + width, y + each.height] } });
    else out.push(placeTable(each.block.table, each.grid!, left, y));
    y += each.height;
  }
  return out;
}

/// Le misure di una tabella: le larghezze delle colonne e le altezze delle
/// righe, e le celle al loro posto nella griglia.
interface Grid {
  readonly columns: readonly number[];
  readonly rows: readonly number[];
  readonly slots: readonly { readonly cell: CellSpec; readonly row: number; readonly column: number; readonly rowSpec: RowSpec }[];
}

function measureTable(table: Table, room: Room, boxWidth: number, extent: (html: string, header: boolean) => Extent): { block: Block; width: number; height: number; grid: Grid } {
  // Il posto di ogni cella nella griglia, con quelle che la coprono dall'alto.
  const taken = new Set<string>();
  const slots: { cell: CellSpec; row: number; column: number; rowSpec: RowSpec }[] = [];
  let count = 0;
  table.rows.forEach((rowSpec, row) => {
    let column = 0;
    for (const cell of rowSpec.cells) {
      while (taken.has(`${row} ${column}`)) column++;
      for (let r = 0; r < cell.rows; r++) for (let c = 0; c < cell.columns; c++) taken.add(`${row + r} ${column + c}`);
      slots.push({ cell, row, column, rowSpec });
      column += cell.columns;
      count = Math.max(count, column);
    }
  });
  const rowCount = table.rows.length;
  const frame = table.frame?.width ?? 0;
  const gaps = (n: number): number => table.spacing * (n + 1) + 2 * frame;
  const pad = (cell: CellSpec): number => 2 * (cell.padding ?? table.padding) + (cell.border !== null && cell.border !== "none" ? 2 * cell.border.width : table.grid !== null ? 2 * table.grid.width : 0);
  const extents = slots.map((slot) => extent(slot.cell.html, slot.cell.header));
  // Le larghezze: quelle dette, e il testo più lungo per le altre.
  const natural = new Array<number>(count).fill(0);
  const fixed = new Array<Length | null>(count).fill(null);
  slots.forEach((slot, i) => {
    if (slot.cell.columns !== 1) return;
    natural[slot.column] = Math.max(natural[slot.column]!, extents[i]!.width + pad(slot.cell));
    if (slot.cell.width !== null && fixed[slot.column] === null) fixed[slot.column] = slot.cell.width;
  });
  const asked = resolved(table.width, room.width);
  const wanted = natural.reduce((sum, w, i) => sum + (fixed[i] !== null && !fixed[i]!.percent ? fixed[i]!.value : w), 0) + gaps(count);
  const width = asked ?? Math.min(wanted, room.width ?? Math.max(boxWidth, wanted));
  const inner = Math.max(0, width - gaps(count));
  const columns = fixed.map((length) => (length === null ? null : length.percent ? (length.value / 100) * inner : length.value));
  let given = columns.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  if (given > inner && given > 0) {
    const scale = inner / given;
    columns.forEach((w, i) => (columns[i] = w === null ? null : w * scale));
    given = inner;
  }
  const free = columns.map((w, i) => (w === null ? i : -1)).filter((i) => i >= 0);
  const rest = inner - given;
  if (free.length > 0) {
    const weight = free.reduce((sum, i) => sum + natural[i]!, 0);
    for (const i of free) columns[i] = weight > 0 ? (rest * natural[i]!) / weight : rest / free.length;
  } else if (rest > 0 && given > 0) {
    columns.forEach((w, i) => (columns[i] = w! + (rest * w!) / given));
  }
  // Le altezze: il testo e i margini, poi il di più che chiede la tabella.
  const rows = table.rows.map((rowSpec) => resolved(rowSpec.height, null) ?? 0);
  slots.forEach((slot, i) => {
    if (slot.cell.rows === 1) rows[slot.row] = Math.max(rows[slot.row]!, extents[i]!.height + pad(slot.cell));
  });
  const height = resolved(table.height, room.height);
  const sum = rows.reduce((a, b) => a + b, 0) + gaps(rowCount);
  if (height !== null && height > sum) {
    const extra = height - sum;
    const weight = rows.reduce((a, b) => a + b, 0);
    rows.forEach((h, i) => (rows[i] = h + (weight > 0 ? (extra * h) / weight : extra / rowCount)));
  }
  return {
    block: { kind: "table", table },
    width,
    height: Math.max(sum, height ?? 0),
    grid: { columns: columns.map((w) => w ?? 0), rows, slots },
  };
}

function placeTable(table: Table, grid: Grid, left: number, top: number): Placed {
  const frame = table.frame?.width ?? 0;
  const spacing = table.spacing;
  const xs: number[] = [left + frame + spacing];
  grid.columns.forEach((w, i) => xs.push(xs[i]! + w + spacing));
  const ys: number[] = [top + frame + spacing];
  grid.rows.forEach((h, i) => ys.push(ys[i]! + h + spacing));
  const right = xs[xs.length - 1]! + frame;
  const bottom = ys[ys.length - 1]! + frame;
  const cells = grid.slots.map(({ cell, row, column, rowSpec }): PlacedCell => {
    const lastColumn = Math.min(grid.columns.length, column + cell.columns);
    const lastRow = Math.min(grid.rows.length, row + cell.rows);
    const box: Bounds = { min: [xs[column]!, ys[row]!], max: [xs[lastColumn]! - spacing, ys[lastRow]! - spacing] };
    const border = cell.border === "none" ? null : (cell.border ?? table.grid);
    const inset = (cell.padding ?? table.padding) + (border?.width ?? 0);
    const inner: Bounds = { min: [box.min[0] + inset, box.min[1] + inset], max: [Math.max(box.min[0] + inset, box.max[0] - inset), Math.max(box.min[1] + inset, box.max[1] - inset)] };
    return {
      box,
      inner,
      html: cell.html,
      header: cell.header,
      align: cell.align ?? rowSpec.align ?? (cell.header ? "middle" : "start"),
      valign: cell.valign ?? rowSpec.valign ?? "middle",
      fill: cell.fill ?? rowSpec.fill,
      border,
    };
  });
  return { kind: "table", box: { min: [left, top], max: [right, bottom] }, fill: table.fill, border: table.frame, cells };
}
