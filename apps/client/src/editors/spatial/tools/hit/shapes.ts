// La geometria che si vede di ogni forma: lo stile dagli attributi, i tracciati
// delle forme e del testo, i marcatori, i ritagli e le maschere.

import { BoundsBuilder, parsePath, rectPath, Track, type Bounds, type Segment } from "../../scene/geometry";
import { markerFit, type MarkerFit, type MarkerPlace } from "../../scene/markers";
import { compose, IDENTITY, type Matrix, type Point } from "../../scene/matrix";
import type { Elem } from "../../scene/serialize";
import {
  fraction,
  length,
  letterSpacing,
  nonNegativeLength,
  points as parsePoints,
  startOffset,
  transform as parseTransform,
} from "../../scene/values";
import type { PaintAttr, PaintDef, PaintResource, PaintShape, TextPiece, TextRun } from "../../painter/paint";
import { scaleOf, transformedBounds, type ClipLook, type ClipShape, type ClipWindow } from "../clips";
import { INITIAL, type Style, type TextLook } from "./base";
import { holds, includeInflated } from "./geometry";

export function attr(attrs: readonly PaintAttr[], name: string): string | undefined {
  for (const [key, value] of attrs) if (key === name) return value;
  return undefined;
}

export function hidden(attrs: readonly PaintAttr[]): boolean {
  return attr(attrs, "display")?.trim() === "none";
}

export function transformOf(attrs: readonly PaintAttr[]): Matrix {
  const value = attr(attrs, "transform");
  return value === undefined ? IDENTITY : parseTransform(value) ?? IDENTITY;
}

export function styleOf(parent: Style, attrs: readonly PaintAttr[]): Style {
  const fill = attr(attrs, "fill");
  const stroke = attr(attrs, "stroke");
  const width = attr(attrs, "stroke-width");
  const size = attr(attrs, "font-size");
  const anchor = attr(attrs, "text-anchor");
  const family = attr(attrs, "font-family");
  const weight = attr(attrs, "font-weight");
  const spacing = attr(attrs, "letter-spacing");
  if (fill === undefined && stroke === undefined && width === undefined && size === undefined && anchor === undefined && family === undefined && weight === undefined && spacing === undefined) {
    return parent;
  }
  return {
    fill: fill === undefined ? parent.fill : fill.trim() !== "none",
    stroke: stroke === undefined ? parent.stroke : stroke.trim() !== "none",
    strokeWidth: width === undefined ? parent.strokeWidth : Math.max(0, length(width) ?? parent.strokeWidth),
    fontSize: size === undefined ? parent.fontSize : nonNegativeLength(size) ?? parent.fontSize,
    spacing: spacing === undefined ? parent.spacing : letterSpacing(spacing) ?? parent.spacing,
    anchor: anchor === undefined ? parent.anchor : anchor.trim(),
    family: family === undefined ? parent.family : family.trim(),
    weight: weight === undefined ? parent.weight : weight.trim(),
    color: fill === undefined ? parent.color : fill.trim(),
  };
}

export function len(attrs: readonly PaintAttr[], name: string): number | null {
  const value = attr(attrs, name);
  return value === undefined ? null : length(value);
}

/// I raggi di un'ellisse o degli angoli di un rettangolo: in SVG 2 un raggio
/// assente vale l'altro.
function radii(attrs: readonly PaintAttr[]): Point {
  const rx = len(attrs, "rx");
  const ry = len(attrs, "ry");
  return [rx ?? ry ?? 0, ry ?? rx ?? 0];
}

/// Un'ellisse come quattro archi, che il riquadro e l'appiattimento sanno
/// trattare esattamente.
function ellipsePath(cx: number, cy: number, rx: number, ry: number): Segment[] {
  if (!(rx > 0) || !(ry > 0)) return [];
  const arc = (to: Point): Segment => ({ kind: "arc", radii: [rx, ry], rotation: 0, large: false, sweep: true, to });
  return [
    { kind: "move", to: [cx + rx, cy] },
    arc([cx, cy + ry]),
    arc([cx - rx, cy]),
    arc([cx, cy - ry]),
    arc([cx + rx, cy]),
    { kind: "close" },
  ];
}

/// I segmenti di una forma nelle sue coordinate: il tracciato con cui SVG 2
/// la definisce, dallo stesso punto e nello stesso verso.
export function shapeSegments(tag: string, attrs: readonly PaintAttr[]): readonly Segment[] {
  const at = (name: string): number => len(attrs, name) ?? 0;
  switch (tag) {
    case "path": {
      const d = attr(attrs, "d");
      return d === undefined ? [] : parsePath(d) ?? [];
    }
    case "rect": {
      const [w, h] = [at("width"), at("height")];
      // SVG non disegna un rettangolo con un lato nullo.
      if (!(w > 0) || !(h > 0)) return [];
      const [rx, ry] = radii(attrs);
      return rectPath(at("x"), at("y"), w, h, rx, ry);
    }
    case "image": {
      const [w, h] = [at("width"), at("height")];
      if (!(w > 0) || !(h > 0)) return [];
      return rectPath(at("x"), at("y"), w, h, 0, 0);
    }
    case "ellipse": {
      const [rx, ry] = radii(attrs);
      return ellipsePath(at("cx"), at("cy"), rx, ry);
    }
    case "circle":
      return ellipsePath(at("cx"), at("cy"), at("r"), at("r"));
    case "line":
      return [{ kind: "move", to: [at("x1"), at("y1")] }, { kind: "line", to: [at("x2"), at("y2")] }];
    case "polyline":
    case "polygon": {
      const value = attr(attrs, "points");
      const list = value === undefined ? null : parsePoints(value);
      if (list === null || list.length === 0) return [];
      const segments: Segment[] = list.map((p, i) => ({ kind: i === 0 ? "move" : "line", to: p }) as Segment);
      if (tag === "polygon") segments.push({ kind: "close" });
      return segments;
    }
    default:
      return [];
  }
}

/// Quanto è largo un carattere, e dove stanno sopra e sotto la linea di base
/// i bordi di una riga, in volte il corpo: una stima, la misura vera dipende
/// dai caratteri.
export const CHAR_EM = 0.6;
export const ASCENT_EM = 0.8;
export const DESCENT_EM = 0.25;

/// Dove comincia una riga larga `width` col punto d'ancoraggio in `x`.
export function lineStart(x: number, width: number, anchor: string): number {
  return anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
}

/// Quanti caratteri si leggono in `text`: gli spazi in fila contano uno, ai
/// bordi niente, come li mostra SVG.
export function readable(text: string): number {
  return [...text.replace(/\s+/g, " ").trim()].length;
}

/// La spaziatura delle lettere che scrive `attrs`, o quella che eredita.
function spacingOf(attrs: readonly PaintAttr[], inherited: number): number {
  const value = attr(attrs, "letter-spacing");
  return value === undefined ? inherited : letterSpacing(value) ?? inherited;
}

/// Quanto è larga e alta una riga di `chars` caratteri da leggere, a stima:
/// 0,6 em per carattere più la spaziatura delle lettere, col corpo e la
/// spaziatura di ogni pezzo per la sua parte di riga; l'altezza è quella del
/// corpo più grande.
function lineMeasure(parts: readonly (string | TextPiece)[], chars: number, size: number, spacing: number): { width: number; size: number } {
  let width = 0;
  let count = 0;
  let tallest = 0;
  for (const part of parts) {
    const text = typeof part === "string" ? part : part.text;
    const n = [...text.replace(/\s+/g, " ")].length;
    if (n === 0) continue;
    const own = typeof part === "string" ? null : part.attrs;
    const partSize = own === null ? size : len(own, "font-size") ?? size;
    width += n * (CHAR_EM * partSize + (own === null ? spacing : spacingOf(own, spacing)));
    count += n;
    tallest = Math.max(tallest, partSize);
  }
  // Gli spazi che SVG toglie si tolgono in proporzione.
  return count === 0 ? { width: 0, size } : { width: (width * chars) / count, size: tallest };
}

/// Le righe di un testo come rettangoli: l'altezza va da 0,8 em sopra la
/// linea di base a 0,25 em sotto, la larghezza è 0,6 em per carattere più
/// la spaziatura delle lettere. Un testo in area, largo `wrap`, ha anche il
/// suo riquadro, dalla cima della prima riga al fondo dell'ultima; uno su
/// tracciato ha le lettere lungo `track`.
export function textSegments(attrs: readonly PaintAttr[], runs: readonly TextRun[], style: Style, wrap: number | null = null, track: Track | null = null): Segment[] {
  const x = len(attrs, "x") ?? 0;
  let y = len(attrs, "y") ?? 0;
  const segments: Segment[] = [];
  let top: number | null = null;
  let bottom = 0;
  for (const run of runs) {
    if (run.kind === "path") {
      if (track !== null) segments.push(...pathSegments(run, track, style));
      continue;
    }
    if (run.kind !== "span") continue;
    const size = len(run.attrs, "font-size") ?? style.fontSize;
    y += len(run.attrs, "dy") ?? 0;
    top ??= y - ASCENT_EM * size;
    bottom = y + DESCENT_EM * size;
    const lineX = len(run.attrs, "x") ?? x;
    const chars = readable(run.text);
    if (chars === 0) continue;
    const line = lineMeasure(run.parts ?? [run.text], chars, size, spacingOf(run.attrs, style.spacing));
    const anchor = attr(run.attrs, "text-anchor")?.trim() ?? style.anchor;
    segments.push(...rectPath(lineStart(lineX, line.width, anchor), y - ASCENT_EM * line.size, line.width, (ASCENT_EM + DESCENT_EM) * line.size, 0, 0));
  }
  if (wrap !== null && top !== null) segments.push(...rectPath(lineStart(x, wrap, style.anchor), top, wrap, bottom - top, 0, 0));
  return segments;
}

/// Dove comincia sul tracciato `track` il testo `run`: la distanza di
/// `startOffset` dall'inizio del tracciato.
function startOf(run: Extract<TextRun, { kind: "path" }>, track: Track): number {
  const offset = startOffset(run.startOffset ?? "0") ?? { value: 0, share: false };
  return offset.share ? offset.value * track.length : offset.value;
}

/// Le lettere di un testo su tracciato come quadrilateri lungo `track`, a
/// stima come le righe: ognuna larga 0,6 em più la spaziatura, centrata sul
/// suo punto del tracciato e girata come il tracciato lì. Una lettera il cui
/// centro cade fuori dal tracciato non si vede, e non si tocca.
function pathSegments(run: Extract<TextRun, { kind: "path" }>, track: Track, style: Style): Segment[] {
  // I caratteri da leggere, con gli spazi in fila che ne valgono uno e
  // nessuno ai bordi, ciascuno col corpo e la spaziatura del suo pezzo.
  const glyphs: Array<{ readonly space: boolean; readonly size: number; readonly width: number }> = [];
  for (const part of run.parts ?? [run.text]) {
    const own = typeof part === "string" ? null : part.attrs;
    const size = own === null ? style.fontSize : len(own, "font-size") ?? style.fontSize;
    const width = CHAR_EM * size + (own === null ? style.spacing : spacingOf(own, style.spacing));
    for (const char of typeof part === "string" ? part : part.text) {
      const space = /\s/.test(char);
      if (space && (glyphs.length === 0 || glyphs[glyphs.length - 1]!.space)) continue;
      glyphs.push({ space, size, width });
    }
  }
  while (glyphs.length > 0 && glyphs[glyphs.length - 1]!.space) glyphs.pop();
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
  let at = lineStart(startOf(run, track), total, style.anchor);
  const segments: Segment[] = [];
  for (const glyph of glyphs) {
    const middle = at + glyph.width / 2;
    at += glyph.width;
    if (glyph.space || middle < 0 || middle > track.length) continue;
    const here = track.at(middle);
    if (here === null) continue;
    const [dx, dy] = here.direction;
    // Sopra la linea di base è a sinistra della direzione.
    const [ux, uy] = [dy, -dx];
    const half = glyph.width / 2;
    const rise = ASCENT_EM * glyph.size;
    const drop = DESCENT_EM * glyph.size;
    const [px, py] = here.at;
    const corner = (along: number, up: number): Point => [px + dx * along + ux * up, py + dy * along + uy * up];
    segments.push(
      { kind: "move", to: corner(-half, rise) },
      { kind: "line", to: corner(half, rise) },
      { kind: "line", to: corner(half, -drop) },
      { kind: "line", to: corner(-half, -drop) },
      { kind: "close" },
    );
  }
  return segments;
}

/// Come si vede il testo `shape` con lo stile `style`, che comprende i suoi
/// attributi: la prima riga dà ancoraggio e corpo. Il passo è quello che
/// l'operazione `text` dà a una riga nuova: il `dy` dell'ultima riga dopo la
/// prima che lo scrive, oppure 1,25 volte il corpo dell'ultima riga.
export function textLook(shape: PaintShape | null, style: Style, wrap: number | null = null, track: Track | null = null): TextLook {
  const attrs = shape?.attrs ?? [];
  const path = shape?.runs?.find((run) => run.kind === "path");
  if (path !== undefined && path.kind === "path") {
    // Il campo sta dove il testo comincia sul tracciato, girato come lui.
    const start = track?.at(startOf(path, track)) ?? null;
    const anchor = style.anchor.trim();
    return {
      x: start?.at[0] ?? 0,
      y: start?.at[1] ?? 0,
      size: style.fontSize,
      leading: style.fontSize * 1.25,
      anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
      family: style.family,
      weight: style.weight,
      color: style.color,
      wrap: null,
      along: start?.direction ?? [1, 0],
    };
  }
  const spans = (shape?.runs ?? []).filter((run) => run.kind === "span");
  const first = spans[0]?.attrs ?? [];
  const size = len(first, "font-size") ?? style.fontSize;
  let step: number | null = null;
  for (let k = spans.length - 1; k >= 1 && step === null; k--) step = len(spans[k]!.attrs, "dy");
  const last = spans.length === 0 ? style.fontSize : len(spans[spans.length - 1]!.attrs, "font-size") ?? style.fontSize;
  const anchor = attr(first, "text-anchor")?.trim() ?? style.anchor;
  return {
    x: len(first, "x") ?? len(attrs, "x") ?? 0,
    y: (len(attrs, "y") ?? 0) + (len(first, "dy") ?? 0),
    size,
    leading: step !== null && step > 0 ? step : last * 1.25,
    anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
    family: attr(first, "font-family")?.trim() ?? style.family,
    weight: attr(first, "font-weight")?.trim() ?? style.weight,
    color: attr(first, "fill")?.trim() ?? style.color,
    wrap,
    along: null,
  };
}

/// Una riga di un testo che uno strumento sta per scrivere, come la legge il
/// painter.
function elemLine(child: Elem): TextRun {
  const attrs: PaintAttr[] = Object.entries(child.attrs);
  if (child.runs === undefined) return { kind: "span", attrs, space: null, text: child.text ?? "" };
  const parts = child.runs.map((run): string | TextPiece => (typeof run === "string" ? run : { attrs: Object.entries(run.attrs), space: null, text: run.text }));
  return { kind: "span", attrs, space: null, text: parts.map((part) => (typeof part === "string" ? part : part.text)).join(""), parts };
}

/// Il riquadro nella scena di una forma che uno strumento sta per scrivere,
/// contorno compreso: la stessa geometria con cui poi la si tocca. `matrix`
/// porta le coordinate del livello nella scena.
export function elemBounds(elem: Elem, matrix: Matrix): Bounds | null {
  const attrs: PaintAttr[] = Object.entries(elem.attrs);
  const style = styleOf(INITIAL, attrs);
  const bounds = transformedBounds(elemSegments(elem, attrs, style), matrix);
  if (bounds === null) return null;
  const out = new BoundsBuilder();
  includeInflated(out, bounds, style.stroke ? (style.strokeWidth / 2) * scaleOf(matrix) : 0);
  return out.finish();
}

/// Il riquadro della geometria di `elem` nelle sue coordinate, senza il
/// contorno: quello su cui si misura una sfumatura.
export function geometryBox(elem: Elem): Bounds | null {
  const attrs: PaintAttr[] = Object.entries(elem.attrs);
  return transformedBounds(elemSegments(elem, attrs, styleOf(INITIAL, attrs)), IDENTITY);
}

export function elemSegments(elem: Elem, attrs: readonly PaintAttr[], style: Style): readonly Segment[] {
  const wrap = elem.attrs["fub:wrap"];
  return elem.tag === "text"
    ? textSegments(attrs, (elem.children ?? []).map(elemLine), style, wrap === undefined ? null : length(wrap))
    : shapeSegments(elem.tag, attrs);
}

// ---------------------------------------------------------------------------
// Marcatori.
// ---------------------------------------------------------------------------

/// Le forme su cui i browser disegnano i marcatori.
export const MARKED: ReadonlySet<string> = new Set(["path", "line", "polyline", "polygon"]);

/// Le proprietà dei marcatori, coi vertici dove ciascuna li mette.
export const MARKER_PROPERTIES: ReadonlyArray<readonly [MarkerPlace, string]> = [["start", "marker-start"], ["mid", "marker-mid"], ["end", "marker-end"]];

/// Una forma del contenuto di un marcatore: i segmenti, la matrice dalle sue
/// coordinate a quelle del contenuto, e come si tocca.
interface MarkerShape {
  readonly segments: readonly Segment[];
  readonly matrix: Matrix;
  readonly fill: boolean;
  readonly radius: number;
}

/// Un marcatore vivo: come si mette su un vertice, e le forme del suo
/// contenuto già tagliate dalla sua finestra.
export interface MarkerLook {
  readonly fit: MarkerFit;
  readonly shapes: readonly MarkerShape[];
}

/// Il marcatore vivo `resource`; `null` se non disegna niente. Il contenuto
/// non eredita niente da chi lo usa: parte dallo stile iniziale.
export function markerLook(resource: PaintResource): MarkerLook | null {
  const fit = markerFit((name) => attr(resource.attrs, name));
  if (fit === null) return null;
  const shapes: MarkerShape[] = [];
  contentShapes(resource.children, IDENTITY, INITIAL, fit.clip, shapes);
  return { fit, shapes };
}

/// Le forme di `children`, il contenuto di un marcatore o di un suo gruppo,
/// con `matrix` dalle loro coordinate a quelle del contenuto. Un testo non
/// conta: dentro un marcatore non se ne stima il riquadro.
function contentShapes(children: readonly (PaintDef | string)[], matrix: Matrix, style: Style, clip: Bounds, out: MarkerShape[]): void {
  for (const child of children) {
    if (typeof child === "string" || hidden(child.attrs)) continue;
    const m = compose(matrix, transformOf(child.attrs));
    const inner = styleOf(style, child.attrs);
    if (child.tag === "g") {
      contentShapes(child.children, m, inner, clip, out);
      continue;
    }
    const segments = shapeSegments(child.tag, child.attrs);
    const fill = child.tag !== "line" && inner.fill;
    const radius = inner.stroke ? inner.strokeWidth / 2 : 0;
    if (segments.length > 0 && (fill || radius > 0)) clipShape(out, { segments, matrix: m, fill, radius }, clip);
  }
}

/// Aggiunge a `out` la forma `shape`, tagliata dalla finestra `clip`: intera
/// se ci sta, il rettangolo che resta dentro se ne esce in parte, niente se
/// ne sta fuori. Un'uscita di un miliardesimo della finestra è un errore
/// d'arrotondamento: la forma ci sta.
function clipShape(out: MarkerShape[], shape: MarkerShape, clip: Bounds): void {
  const bounds = transformedBounds(shape.segments, shape.matrix);
  if (bounds === null) return;
  const by = shape.radius * scaleOf(shape.matrix);
  const box: Bounds = { min: [bounds.min[0] - by, bounds.min[1] - by], max: [bounds.max[0] + by, bounds.max[1] + by] };
  const slack = 1e-9 * Math.max(clip.max[0] - clip.min[0], clip.max[1] - clip.min[1]);
  const room: Bounds = { min: [clip.min[0] - slack, clip.min[1] - slack], max: [clip.max[0] + slack, clip.max[1] + slack] };
  if (holds(room, box)) {
    out.push(shape);
    return;
  }
  const [x0, y0] = [Math.max(box.min[0], clip.min[0]), Math.max(box.min[1], clip.min[1])];
  const [x1, y1] = [Math.min(box.max[0], clip.max[0]), Math.min(box.max[1], clip.max[1])];
  if (x1 > x0 && y1 > y0) out.push({ segments: rectPath(x0, y0, x1 - x0, y1 - y0, 0, 0), matrix: IDENTITY, fill: true, radius: 0 });
}

// ---------------------------------------------------------------------------
// Ritagli e maschere.
// ---------------------------------------------------------------------------

/// Il ritaglio o la maschera `resource`; `null` se non è né l'uno né l'altra.
/// Il contenuto non eredita niente da chi lo usa: parte dallo stile iniziale.
export function clipLook(resource: PaintResource): ClipLook | null {
  const units = (name: string): string | undefined => attr(resource.attrs, name)?.trim();
  const shapes: ClipShape[] = [];
  if (resource.tag === "mask") {
    maskShapes(resource.children, IDENTITY, INITIAL, shapes);
    return { mask: true, boxContent: units("maskContentUnits") === "objectBoundingBox", transform: IDENTITY, window: windowOf(resource.attrs, units("maskUnits") !== "userSpaceOnUse"), shapes };
  }
  if (resource.tag !== "clipPath") return null;
  clipShapes(resource.children, IDENTITY, units("clip-rule") === "evenodd", shapes);
  return { mask: false, boxContent: units("clipPathUnits") === "objectBoundingBox", transform: transformOf(resource.attrs), window: null, shapes };
}

/// La finestra di una maschera: di `attrs`, in frazioni del riquadro con
/// `box`, dove -10% -10% 120% 120% sono i valori che mancano. In unità
/// utente, se manca un lato la finestra non limita.
function windowOf(attrs: readonly PaintAttr[], box: boolean): ClipWindow | null {
  const read = (name: string, fallback: number | null): number | null => {
    const value = attr(attrs, name);
    if (value === undefined) return fallback;
    return box ? fraction(value) : length(value);
  };
  const x = read("x", box ? -0.1 : null);
  const y = read("y", box ? -0.1 : null);
  const width = read("width", box ? 1.2 : null);
  const height = read("height", box ? 1.2 : null);
  return x === null || y === null || width === null || height === null ? null : { box, x, y, width, height };
}

/// Le forme di `children`, il contenuto di una maschera o di un suo gruppo,
/// con `matrix` dalle loro coordinate a quelle del contenuto: quelle che
/// dipingono, col riempimento o col contorno. Un testo conta nel riquadro
/// stimato delle sue righe.
function maskShapes(children: readonly (PaintDef | string)[], matrix: Matrix, style: Style, out: ClipShape[]): void {
  for (const child of children) {
    if (typeof child === "string" || hidden(child.attrs)) continue;
    const m = compose(matrix, transformOf(child.attrs));
    const inner = styleOf(style, child.attrs);
    if (child.tag === "g") {
      maskShapes(child.children, m, inner, out);
      continue;
    }
    const text = child.tag === "text";
    const segments = text ? textSegments(child.attrs, defRuns(child), inner) : shapeSegments(child.tag, child.attrs);
    const fill = text || (child.tag !== "line" && inner.fill);
    const radius = !text && inner.stroke ? inner.strokeWidth / 2 : 0;
    if (segments.length > 0 && (fill || radius > 0)) out.push({ segments, matrix: m, fill, radius, evenodd: false });
  }
}

/// Le forme di `children`, il contenuto di un ritaglio, che non ha gruppi:
/// quelle che riempiono, qualunque sia il loro riempimento e il loro
/// contorno, ciascuna con la `clip-rule` che scrive o quella `evenodd` del
/// ritaglio. Una linea non ha area e non conta.
function clipShapes(children: readonly (PaintDef | string)[], matrix: Matrix, evenodd: boolean, out: ClipShape[]): void {
  for (const child of children) {
    if (typeof child === "string" || hidden(child.attrs) || child.tag === "line" || child.tag === "g") continue;
    const rule = attr(child.attrs, "clip-rule")?.trim();
    const segments = child.tag === "text" ? textSegments(child.attrs, defRuns(child), styleOf(INITIAL, child.attrs)) : shapeSegments(child.tag, child.attrs);
    if (segments.length > 0) out.push({ segments, matrix: compose(matrix, transformOf(child.attrs)), fill: true, radius: 0, evenodd: rule === undefined ? evenodd : rule === "evenodd" });
  }
}

/// Le righe di un `text` del contenuto di una risorsa, come le legge
/// `textSegments`.
function defRuns(text: PaintDef): TextRun[] {
  const runs: TextRun[] = [];
  for (const line of text.children) {
    if (typeof line === "string" || line.tag !== "tspan") continue;
    const parts: Array<string | TextPiece> = [];
    let pieces = false;
    for (const part of line.children) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      pieces = true;
      parts.push({ attrs: part.attrs, space: part.space, text: defText(part) });
    }
    const content = parts.map((part) => (typeof part === "string" ? part : part.text)).join("");
    runs.push(pieces ? { kind: "span", attrs: line.attrs, space: line.space, text: content, parts } : { kind: "span", attrs: line.attrs, space: line.space, text: content });
  }
  return runs;
}

/// Il testo di `def` e di tutto ciò che contiene.
function defText(def: PaintDef): string {
  return def.children.map((child) => (typeof child === "string" ? child : defText(child))).join("");
}

// ---------------------------------------------------------------------------
// Blocchi estranei.
// ---------------------------------------------------------------------------
