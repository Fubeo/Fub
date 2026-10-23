// L'aspetto di una cella di una cartella di Excel nella griglia.
//
// Il provider dà lo stile già risolto (tema, stile della tabella e
// formattazione condizionale sono dentro, `GridCellStyle`): qui diventa CSS
// in linea sull'elemento della cella e sul suo testo. Le misure seguono
// quelle del file in proporzione: il carattere di serie di Excel (11 punti) è
// quello dell'interfaccia, e il resto cresce o cala con lui.
import type {
  GridBorder,
  GridBorders,
  GridBorderStyle,
  GridBytesCell,
  GridCellStyle,
  GridIcon,
} from "../../host/contract";
import { GRID_STACKED_ROTATION } from "../../host/contract";

/// La dimensione di serie del carattere di Excel, in punti.
const DEFAULT_POINTS = 11;
/// Un livello di rientro di Excel, in em del carattere della cella.
const INDENT_EM = 0.65;

/// Come il testo si allinea dove il file non lo dice: i numeri a destra, i
/// valori logici e gli errori al centro, il resto a sinistra.
function generalAlign(value: GridBytesCell["value"]): "start" | "center" | "end" {
  switch (value.kind) {
    case "number": return "end";
    case "boolean":
    case "error": return "center";
    default: return "start";
  }
}

/// L'allineamento orizzontale con cui la cella si disegna.
export function horizontalOf(style: GridCellStyle | undefined, value: GridBytesCell["value"]): "start" | "center" | "end" | "justify" {
  switch (style?.horizontal ?? null) {
    case null: return generalAlign(value);
    case "center":
    case "distributed": return "center";
    case "end": return "end";
    case "justify": return "justify";
    default: return "start";
  }
}

/// Se il testo della cella può passare nelle celle vuote accanto: non va a
/// capo, non è ruotato e non si stringe, come in Excel.
export function spills(style: GridCellStyle | undefined, cell: GridBytesCell): boolean {
  if (cell.value.kind !== "text" || !cell.display) return false;
  if (!style) return true;
  return !style.wrap && !style.shrink && style.rotation === 0
    && style.vertical !== "justify" && style.vertical !== "distributed"
    && style.horizontal !== "fill" && style.horizontal !== "justify" && style.horizontal !== "distributed";
}

function cssFont(font: string): string {
  return `"${font.replace(/["\\]/gu, "")}"`;
}

/// Disegna lo stile `style` sulla cella `element` e sul suo testo `text`.
/// `fallbackFont` è la famiglia della griglia, per un carattere che manca.
export function paintCell(
  element: HTMLElement,
  text: HTMLElement,
  style: GridCellStyle | undefined,
  cell: GridBytesCell | undefined,
  fallbackFont: string,
): void {
  const value = cell?.value ?? { kind: "blank" as const };
  const horizontal = horizontalOf(style, value);
  if (horizontal !== "start") element.style.textAlign = horizontal;
  const vertical = style?.vertical ?? "bottom";
  element.style.alignContent = vertical === "top" ? "start" : vertical === "bottom" ? "end" : "center";
  if (!style) return;
  if (style.fill_color) element.style.backgroundColor = style.fill_color;
  if (style.text_color) element.style.color = style.text_color;
  if (style.bold) element.style.fontWeight = "700";
  if (style.italic) element.style.fontStyle = "italic";
  if (style.font) element.style.fontFamily = fallbackFont ? `${cssFont(style.font)}, ${fallbackFont}` : cssFont(style.font);
  if (style.font_size !== null && style.font_size > 0 && style.font_size !== DEFAULT_POINTS) {
    element.style.fontSize = `${(style.font_size / DEFAULT_POINTS).toFixed(4)}em`;
  }
  const lines: string[] = [];
  if (style.underline) lines.push("underline");
  if (style.strike) lines.push("line-through");
  if (lines.length) {
    text.style.textDecorationLine = lines.join(" ");
    if (style.underline === "double" || style.underline === "double_accounting") text.style.textDecorationStyle = "double";
    if (style.underline === "single_accounting" || style.underline === "double_accounting") text.style.textUnderlineOffset = "0.25em";
  }
  if (style.script) {
    text.style.fontSize = "0.7em";
    text.style.position = "relative";
    text.style.top = style.script === "superscript" ? "-0.45em" : "0.2em";
  }
  if (style.wrap || vertical === "justify" || vertical === "distributed" || horizontal === "justify") {
    element.style.whiteSpace = "pre-wrap";
    element.style.overflowWrap = "anywhere";
  }
  if (style.indent > 0 && (horizontal === "start" || horizontal === "end")) {
    const indent = `calc(0.45rem + ${(style.indent * INDENT_EM).toFixed(2)}em)`;
    if (horizontal === "start") element.style.paddingInlineStart = indent;
    else element.style.paddingInlineEnd = indent;
  }
  if (style.rotation === GRID_STACKED_ROTATION) {
    text.style.writingMode = "vertical-lr";
    text.style.textOrientation = "upright";
    text.style.justifySelf = "center";
  } else if (style.rotation !== 0) {
    text.style.display = "inline-block";
    text.style.transform = `rotate(${-style.rotation}deg)`;
    text.style.justifySelf = "center";
  }
}

/// Spessore e tratto CSS di un bordo di Excel.
const BORDER_CSS: Readonly<Record<GridBorderStyle, readonly [number, string]>> = {
  hair: [1, "dotted"],
  thin: [1, "solid"],
  dotted: [1, "dotted"],
  dashed: [1, "dashed"],
  dash_dot: [1, "dashed"],
  dash_dot_dot: [1, "dashed"],
  medium: [2, "solid"],
  medium_dashed: [2, "dashed"],
  medium_dash_dot: [2, "dashed"],
  medium_dash_dot_dot: [2, "dashed"],
  slant_dash_dot: [2, "dashed"],
  thick: [3, "solid"],
  double: [3, "double"],
};

function borderCss(border: GridBorder): string {
  const [width, line] = BORDER_CSS[border.style] ?? BORDER_CSS.thin;
  return `${width}px ${line} ${border.color ?? "currentColor"}`;
}

/// Se la cella ha un bordo da disegnare.
export function hasBorders(borders: GridBorders | undefined): borders is GridBorders {
  return Boolean(borders && (borders.top || borders.right || borders.bottom || borders.left || borders.diagonal_down || borders.diagonal_up));
}

/// Disegna i bordi su `element`, un riquadro che copre la cella e il filo
/// di sopra e di sinistra: i bordi stanno sui fili della griglia, come in
/// Excel.
export function paintBorders(element: HTMLElement, borders: GridBorders): void {
  if (borders.top) element.style.borderTop = borderCss(borders.top);
  if (borders.right) element.style.borderRight = borderCss(borders.right);
  if (borders.bottom) element.style.borderBottom = borderCss(borders.bottom);
  if (borders.left) element.style.borderLeft = borderCss(borders.left);
  const diagonals: string[] = [];
  const diagonal = (direction: string, border: GridBorder) => {
    const color = border.color ?? "currentColor";
    diagonals.push(`linear-gradient(${direction}, transparent calc(50% - 0.6px), ${color} calc(50% - 0.6px), ${color} calc(50% + 0.6px), transparent calc(50% + 0.6px))`);
  };
  if (borders.diagonal_down) diagonal("to top right", borders.diagonal_down);
  if (borders.diagonal_up) diagonal("to bottom right", borders.diagonal_up);
  if (diagonals.length) element.style.backgroundImage = diagonals.join(", ");
}

const RED = "#D9412E";
const ORANGE = "#E8833A";
const YELLOW = "#E6B422";
const LIME = "#8DB843";
const GREEN = "#3C9A4E";
const GRAY = "#7F7F7F";
const BLACK = "#3A3A3A";
const PINK = "#E5989B";
const BLUE = "#4A7EBB";

type Glyphs = readonly (readonly [string, string])[];

/// Le icone di ogni insieme, dalla più bassa alla più alta.
function iconGlyphs(set: string): Glyphs | null {
  const count = Number(set[0]);
  const family = set.slice(1);
  const arrows = (color: (index: number) => string): Glyphs => {
    const glyphs = count === 3 ? ["⬇", "➡", "⬆"] : count === 4 ? ["⬇", "⬊", "⬈", "⬆"] : ["⬇", "⬊", "➡", "⬈", "⬆"];
    return glyphs.map((glyph, index) => [glyph, color(index)] as const);
  };
  const ramp = count === 3 ? [RED, YELLOW, GREEN] : count === 4 ? [RED, YELLOW, LIME, GREEN] : [RED, ORANGE, YELLOW, LIME, GREEN];
  switch (family) {
    case "Arrows": return arrows((index) => ramp[index]!);
    case "ArrowsGray": return arrows(() => GRAY);
    case "Flags": return ramp.map((color) => ["⚑", color] as const);
    case "TrafficLights1":
    case "TrafficLights2":
    case "TrafficLights": return ramp.map((color) => ["●", color] as const);
    case "Signs": return [["◆", RED], ["▲", YELLOW], ["●", GREEN]];
    case "Symbols": return [["✖", RED], ["!", YELLOW], ["✔", GREEN]];
    case "Symbols2": return [["✕", RED], ["!", YELLOW], ["✓", GREEN]];
    case "RedToBlack": return [["●", BLACK], ["●", GRAY], ["●", PINK], ["●", RED]];
    case "Rating": return (count === 4 ? ["▂", "▄", "▆", "█"] : ["▁", "▂", "▄", "▆", "█"]).map((glyph) => [glyph, BLUE] as const);
    case "Quarters": return ["○", "◔", "◑", "◕", "●"].map((glyph) => [glyph, GRAY] as const);
    case "Stars": return [["☆", YELLOW], ["⯪", YELLOW], ["★", YELLOW]];
    case "Triangles": return [["▼", RED], ["▬", YELLOW], ["▲", GREEN]];
    case "Boxes": return ["▢", "▖", "▌", "▙", "█"].map((glyph) => [glyph, BLUE] as const);
    default: return null;
  }
}

/// L'icona di un insieme della formattazione condizionale, o `null` per un
/// insieme che la griglia non conosce.
export function iconOf(icon: GridIcon): { readonly glyph: string; readonly color: string } | null {
  const glyphs = iconGlyphs(icon.set);
  const chosen = glyphs?.[Math.min(icon.index, glyphs.length - 1)];
  return chosen ? { glyph: chosen[0], color: chosen[1] } : null;
}
