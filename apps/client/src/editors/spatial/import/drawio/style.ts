// Lo stile di una cella di draw.io: le sue chiavi coi valori di serie, i
// colori sulla carta, il tratteggio e la famiglia dei caratteri.

import type { Dash } from "../../tools/outline";
import { TEXT_FAMILY } from "../../tools/text";
import { hexColor, Notes } from "../diagram";

/// Le famiglie di FubDraw oltre a Inter.
const SERIF = "Literata, serif";
const MONO = "JetBrains Mono, monospace";

export type Style = ReadonlyMap<string, string>;

/// Lo stile di partenza di una forma e di un arco (`defaultVertex`,
/// `defaultEdge` del foglio di stile di draw.io).
const VERTEX_STYLE: readonly (readonly [string, string])[] = [
  ["fontSize", "12"],
  ["fontFamily", "Helvetica"],
  ["align", "center"],
  ["verticalAlign", "middle"],
  ["fillColor", "default"],
  ["strokeColor", "default"],
  ["fontColor", "default"],
];
const EDGE_STYLE: readonly (readonly [string, string])[] = [
  ["fontSize", "11"],
  ["fontFamily", "Helvetica"],
  ["align", "center"],
  ["verticalAlign", "middle"],
  ["strokeColor", "default"],
  ["fontColor", "default"],
  ["endArrow", "classic"],
];

/// Gli stili con un nome del foglio di stile di draw.io, che una cella
/// nomina in testa al suo.
const NAMED: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  text: [
    ["fillColor", "none"],
    ["strokeColor", "none"],
    ["align", "left"],
    ["verticalAlign", "top"],
  ],
  edgeLabel: [
    ["fillColor", "none"],
    ["strokeColor", "none"],
    ["align", "left"],
    ["verticalAlign", "top"],
    ["fontSize", "11"],
  ],
  label: [
    ["fontStyle", "1"],
    ["align", "left"],
    ["verticalAlign", "middle"],
    ["spacing", "2"],
    ["spacingLeft", "52"],
    ["imageWidth", "42"],
    ["imageHeight", "42"],
    ["rounded", "1"],
  ],
  icon: [
    ["rounded", "1"],
    ["align", "center"],
    ["imageAlign", "center"],
    ["verticalLabelPosition", "bottom"],
    ["verticalAlign", "top"],
    ["spacing", "0"],
    ["spacingLeft", "0"],
    ["spacingTop", "6"],
    ["imageWidth", "48"],
    ["imageHeight", "48"],
  ],
  swimlane: [
    ["shape", "swimlane"],
    ["fontStyle", "1"],
    ["startSize", "23"],
  ],
  group: [
    ["verticalAlign", "top"],
    ["fillColor", "none"],
    ["strokeColor", "none"],
  ],
  ellipse: [["shape", "ellipse"]],
  rhombus: [["shape", "rhombus"]],
  triangle: [["shape", "triangle"]],
  line: [
    ["shape", "line"],
    ["strokeWidth", "4"],
    ["verticalAlign", "top"],
    ["spacingTop", "8"],
  ],
  image: [
    ["shape", "image"],
    ["verticalAlign", "top"],
    ["verticalLabelPosition", "bottom"],
  ],
  roundImage: [
    ["shape", "image"],
    ["verticalAlign", "top"],
    ["verticalLabelPosition", "bottom"],
  ],
  rhombusImage: [
    ["shape", "image"],
    ["verticalAlign", "top"],
    ["verticalLabelPosition", "bottom"],
  ],
  arrow: [
    ["shape", "arrow"],
    ["fillColor", "default"],
  ],
};

/// Le forme che una cella può nominare in testa allo stile senza `shape=`.
const BARE_SHAPES: ReadonlySet<string> = new Set(["cloud", "hexagon", "cylinder", "cylinder3", "doubleEllipse", "process", "document", "actor", "umlActor", "umlLifeline", "partialRectangle", "table", "tableRow", "callout", "parallelogram", "trapezoid", "step", "card", "note"]);

/// Lo stile di una cella: quello di partenza, gli stili coi nomi e le
/// coppie scritte, nell'ordine.
export function styleOf(text: string, edge: boolean): Map<string, string> {
  const out = new Map<string, string>(edge ? EDGE_STYLE : VERTEX_STYLE);
  for (const part of text.split(";")) {
    const piece = part.trim();
    if (piece === "") continue;
    const eq = piece.indexOf("=");
    if (eq < 0) {
      const named = NAMED[piece];
      if (named !== undefined) for (const [key, value] of named) out.set(key, value);
      else if (BARE_SHAPES.has(piece) || piece.startsWith("mxgraph.")) out.set("shape", piece);
      continue;
    }
    out.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  return out;
}

/// Il colore della chiave `key`: `fallback` per «default», `null` per
/// «none»; di un `light-dark()` vale il chiaro.
export function colorOf(style: Style, key: string, fallback: string): string | null {
  const value = style.get(key)?.trim();
  if (value === undefined || value === "" || value === "default" || value === "inherit") return fallback;
  if (value === "none" || value === "transparent") return null;
  const pair = /^light-dark\(\s*([^,]+),/i.exec(value);
  return hexColor(pair === null ? value : pair[1]) ?? fallback;
}

/// `color` a `alpha` sulla carta bianca: la trasparenza del solo
/// riempimento o del solo contorno, che FubDraw non ha.
export function onPaper(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const a = Math.max(0, alpha);
  const mix = (at: number): string => Math.round(parseInt(color.slice(at, at + 2), 16) * a + 255 * (1 - a)).toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/// Vero se la chiave booleana `key` è accesa.
export const on = (style: Style, key: string): boolean => style.get(key) === "1" || style.get(key) === "true";

/// Il tratteggio del menu che somiglia a `dashPattern`.
export function dashOf(style: Style): Dash {
  if (!on(style, "dashed")) return "solid";
  const pattern = (style.get("dashPattern") ?? "").split(/[\s,]+/).filter((each) => each !== "").map(Number);
  if (pattern.length === 0 || pattern.some((each) => !Number.isFinite(each))) return "dashed";
  const dashes = pattern.filter((_, i) => i % 2 === 0);
  if (dashes.every((each) => each <= 1.5)) return "dotted";
  if (dashes.length >= 2 && Math.max(...dashes) > 2 * Math.min(...dashes)) return "dashdot";
  return "dashed";
}

/// I caratteri a mano che draw.io offre, che diventano Inter.
const HAND = /comic|marker|architects daughter|kalam|caveat|indie flower|xkcd|humor|patrick hand|gloria|shadows into light|virgil|excalifont|chalk|handlee|nanum pen/;

/// La famiglia di FubDraw per un carattere di draw.io, e la nota se è a
/// mano.
export function familyOf(name: string, notes: Notes): string {
  const lower = name.toLowerCase();
  if (HAND.test(lower)) {
    notes.add("hand-font", name.split(",")[0]!.trim().replace(/^["']|["']$/g, ""));
    return TEXT_FAMILY;
  }
  if (/mono|courier|consolas|menlo|monaco|lucida console|source code|fira code/.test(lower)) return MONO;
  if (/times|georgia|garamond|palatino|book antiqua|cambria|baskerville|didot|bodoni|merriweather|playfair|lora|literata/.test(lower)) return SERIF;
  if (/(^|[\s,"'])serif/.test(lower)) return SERIF;
  return TEXT_FAMILY;
}

// ---------------------------------------------------------------------------
// Le celle.
// ---------------------------------------------------------------------------
