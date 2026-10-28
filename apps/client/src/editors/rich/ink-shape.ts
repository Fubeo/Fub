// L'inchiostro di un documento come geometria: i tratti di una sessione della
// scheda «Disegna» diventano un oggetto (`ink` della proiezione, versione 4),
// e un oggetto si ridisegna, si cancella in parte e si sposta.
//
// Qui non c'è ProseMirror né DOM: punti in punti tipografici, colori, spessori.
// Il contorno di un tratto è quello della penna del disegno (`ink/pf1.ts`),
// così un tratto scritto in un documento ha la stessa forma che avrebbe in un
// disegno.

import { PF1_DEFAULTS, type InkBrush } from "../../ink/brush";
import { inkPath } from "../../ink/outline";
import { isPenId, penBrush, PENS, type PenId } from "../../ink/pens";
import { quantizeInk, type InkSample } from "../../ink/sample";
import type { InkLine, InkShape } from "./projection";

/// L'opacità dell'evidenziatore, come nel disegno (`ink/tools/highlighter.ts`).
export const INK_HIGHLIGHT_OPACITY = 0.4;

/// Un punto di un tratto, in punti; `p` è la pressione 0…1 se la penna la dà.
export interface InkPoint {
  readonly x: number;
  readonly y: number;
  readonly p?: number;
}

/// Un tratto in coordinate libere (della pagina, o di un oggetto).
export interface InkTrace {
  readonly color: string;
  readonly width: number;
  readonly hl: boolean;
  readonly points: readonly InkPoint[];
  /// La penna, se non è quella di serie; l'evidenziatore non ne ha.
  readonly pen?: PenId;
}

/// Un oggetto d'inchiostro: i tratti relativi all'angolo e la sua misura.
export interface InkBox {
  readonly shape: InkShape;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/// Due decimali bastano: un centesimo di punto è sotto il pixel a ogni zoom.
const round = (value: number): number => Math.round(value * 100) / 100;

/// I tratti dell'oggetto `shape`, spostati di `x`, `y`.
export function tracesOf(shape: InkShape, x = 0, y = 0): InkTrace[] {
  return shape.strokes.map((line) => {
    const points: InkPoint[] = [];
    for (let i = 0; i + 1 < line.xy.length; i += 2) {
      const p = line.p?.[i / 2];
      points.push({ x: line.xy[i]! + x, y: line.xy[i + 1]! + y, ...(p === undefined ? {} : { p }) });
    }
    const hl = line.hl === true;
    return { color: line.color, width: line.width, hl, points, ...penOfLine(line) };
  });
}

/// L'oggetto che tiene `traces`: il riquadro che li contiene col loro
/// spessore, e i punti relativi al suo angolo. `null` senza punti.
export function boxOf(traces: readonly InkTrace[]): InkBox | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const trace of traces) {
    const pad = trace.width / 2 + 0.5;
    for (const point of trace.points) {
      left = Math.min(left, point.x - pad);
      top = Math.min(top, point.y - pad);
      right = Math.max(right, point.x + pad);
      bottom = Math.max(bottom, point.y + pad);
    }
  }
  if (!Number.isFinite(left)) return null;
  const x = round(left);
  const y = round(top);
  const strokes = traces
    .filter((trace) => trace.points.length > 0)
    .map((trace): InkLine => {
      const pressured = trace.points.every((point) => point.p !== undefined);
      return {
        color: trace.color,
        width: round(trace.width),
        ...(trace.hl ? { hl: true } : {}),
        xy: trace.points.flatMap((point) => [round(point.x - x), round(point.y - y)]),
        ...(pressured ? { p: trace.points.map((point) => round(point.p!)) } : {}),
        ...(trace.pen !== undefined && !trace.hl ? { pen: trace.pen } : {}),
      };
    });
  return { shape: { strokes }, x, y, w: Math.max(1, round(right - x)), h: Math.max(1, round(bottom - y)) };
}

/// La penna di un tratto, se ne ha una che si conosce: un nome sconosciuto
/// resta la penna di serie.
function penOfLine(line: InkLine): { pen?: PenId } {
  return line.hl !== true && isPenId(line.pen) ? { pen: line.pen } : {};
}

/// La ricetta del contorno di un tratto: quella della sua penna, o della
/// penna e dell'evidenziatore di serie del disegno.
function brushOf(line: InkLine): InkBrush {
  const pressured = !!(line.p && line.p.length > 0);
  if (line.hl) return { ...PF1_DEFAULTS, size: line.width, thinning: 0, capStart: false, capEnd: false, sim: false };
  const { pen } = penOfLine(line);
  if (pen !== undefined) return penBrush(pen, line.width, pressured);
  return { ...PF1_DEFAULTS, size: line.width, sim: !pressured };
}

/// Quanto copre un tratto, se non copre del tutto: l'evidenziatore, o una
/// penna come la Matita.
export function lineOpacity(line: InkLine): number | null {
  if (line.hl) return INK_HIGHLIGHT_OPACITY;
  const { pen } = penOfLine(line);
  return pen !== undefined && PENS[pen].opacity < 1 ? PENS[pen].opacity : null;
}

/// Il tracciato SVG (`d`) del contorno di un tratto, nelle coordinate
/// dell'oggetto; vuoto se il tratto non si disegna.
export function lineOutline(line: InkLine): string {
  const samples: InkSample[] = [];
  for (let i = 0; i + 1 < line.xy.length; i += 2) {
    const p = line.p?.[i / 2];
    samples.push({ x: line.xy[i]!, y: line.xy[i + 1]!, t: (i / 2) * 8, ...(p === undefined ? {} : { p }) });
  }
  if (samples.length === 0) return "";
  // Un punto solo è un tocco: un puntino tondo, come nel disegno.
  if (samples.length === 1) samples.push({ ...samples[0]!, x: samples[0]!.x + 0.01, t: 8 });
  try {
    return inkPath(quantizeInk(samples), brushOf(line));
  } catch {
    return "";
  }
}

/// Un SVG intero dell'oggetto, `w` × `h` punti: quello che va in un file come
/// disegno (OpenDocument) e da cui si fa il PNG di ripiego.
export function shapeSvg(shape: InkShape, w: number, h: number): string {
  const paths = shape.strokes
    .map((line) => {
      const d = lineOutline(line);
      if (!d) return "";
      const opacity = lineOpacity(line);
      const look = line.hl ? ` fill-opacity="${INK_HIGHLIGHT_OPACITY}" style="mix-blend-mode:multiply"` : opacity !== null ? ` fill-opacity="${opacity}"` : "";
      return `<path d="${d}" fill="${escapeAttribute(line.color)}"${look}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(w)}pt" height="${round(h)}pt" viewBox="0 0 ${round(w)} ${round(h)}">${paths}</svg>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/// La distanza di `p` dal segmento `a`–`b`.
function distance(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/// Il tratto passa a meno di `radius` da `spot` (col suo spessore).
export function touches(trace: InkTrace, spot: InkPoint, radius: number): boolean {
  const reach = radius + trace.width / 2;
  const { points } = trace;
  if (points.length === 1) return Math.hypot(points[0]!.x - spot.x, points[0]!.y - spot.y) <= reach;
  for (let i = 1; i < points.length; i++) if (distance(spot, points[i - 1]!, points[i]!) <= reach) return true;
  return false;
}

/// La gomma in `spot`: con `whole` toglie i tratti interi che tocca, se no
/// toglie i punti dentro il raggio e spezza il tratto dove li ha tolti. I
/// pezzi tengono i loro campioni (pressione compresa). `null` se non tocca
/// niente.
export function erase(traces: readonly InkTrace[], spot: InkPoint, radius: number, whole: boolean): InkTrace[] | null {
  let changed = false;
  const out: InkTrace[] = [];
  for (const trace of traces) {
    if (!touches(trace, spot, radius)) {
      out.push(trace);
      continue;
    }
    changed = true;
    if (whole) continue;
    const reach = radius + trace.width / 2;
    let piece: InkPoint[] = [];
    for (const point of trace.points) {
      if (Math.hypot(point.x - spot.x, point.y - spot.y) <= reach) {
        if (piece.length > 1) out.push({ ...trace, points: piece });
        piece = [];
      } else {
        piece.push(point);
      }
    }
    if (piece.length > 1) out.push({ ...trace, points: piece });
  }
  return changed ? out : null;
}

/// Il punto `p` sta dentro il poligono `ring` (pari e dispari).
export function inside(p: InkPoint, ring: readonly InkPoint[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}

/// Il lazo prende un tratto quando più di metà dei suoi punti sta dentro.
export function lassoed(trace: InkTrace, ring: readonly InkPoint[]): boolean {
  if (ring.length < 3 || trace.points.length === 0) return false;
  const count = trace.points.filter((point) => inside(point, ring)).length;
  return count * 2 > trace.points.length;
}

/// I tratti spostati di `dx`, `dy`.
export function moved(traces: readonly InkTrace[], dx: number, dy: number): InkTrace[] {
  return traces.map((trace) => ({ ...trace, points: trace.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })) }));
}
