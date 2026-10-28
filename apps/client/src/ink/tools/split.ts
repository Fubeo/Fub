// La gomma precisa: taglia un tratto soltanto dove passa il cerchio.
//
// La gomma percorre un cammino largo `radius` (una salsiccia: i punti a
// meno di `radius` dal cammino). Un tratto che lo attraversa si divide in
// pezzi, le parti fuori; ogni pezzo resta un tratto vero, coi suoi campioni.
// Ai bordi del cammino nasce un campione nuovo, interpolato fra i due vicini
// (posizione, pressione e tempo; inclinazione e azimut dal più vicino), così
// il taglio cade dove passa il cerchio e non al campione dopo. Il tempo di
// ogni pezzo riparte da zero: `offset` dice quanti millisecondi dopo l'inizio
// del tratto cominciava, perché chi scrive sposti `fub:at`.
//
// Il cammino si prova a passi di metà raggio lungo ogni segmento del tratto:
// un segmento che lo attraversa di sbieco fra due campioni lontani si taglia
// comunque. Il bordo si trova per bisezione fra il passo fuori e quello
// dentro.
//
// Tutto è nelle stesse coordinate: chi chiama porta il cammino in quelle del
// tratto.

import { isNib1, type InkBrush } from "../brush";
import type { InkSample } from "../sample";
import type { Spot } from "./sweep";

/// Un pezzo che resta di un tratto tagliato.
export interface InkPiece {
  /// I campioni, col tempo da zero.
  readonly samples: readonly InkSample[];
  /// Di quanti millisecondi comincia dopo il tratto intero.
  readonly offset: number;
  /// Comincia o finisce su un taglio, e non sul capo del tratto.
  readonly cutStart: boolean;
  readonly cutEnd: boolean;
}

/// Quante volte si dimezza l'intervallo per trovare il bordo.
const BISECTIONS = 16;

/// La distanza al quadrato fra `p` e il segmento da `a` a `b`.
function distanceSquared(p: Spot, a: Spot, b: Spot): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const k = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  const x = a[0] + k * dx - p[0];
  const y = a[1] + k * dy - p[1];
  return x * x + y * y;
}

/// Il campione a `k` fra `a` e `b`.
function between(a: InkSample, b: InkSample, k: number): InkSample {
  const lerp = (u: number, v: number): number => u + (v - u) * k;
  const near = k < 0.5 ? a : b;
  const pressure = a.p !== undefined && b.p !== undefined ? { p: lerp(a.p, b.p) } : {};
  const base = { x: lerp(a.x, b.x), y: lerp(a.y, b.y), t: lerp(a.t, b.t), ...pressure };
  return near.a !== undefined && near.z !== undefined ? { ...base, a: near.a, z: near.z } : base;
}

/// I pezzi di `samples` fuori dal cammino `path` largo `radius`; `null` se il
/// cammino non lo tocca, `[]` se lo cancella tutto.
export function splitInk(samples: readonly InkSample[], path: readonly Spot[], radius: number): InkPiece[] | null {
  if (samples.length === 0 || path.length === 0 || !(radius > 0)) return null;
  // Del cammino contano i segmenti vicini al tratto.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x);
    maxY = Math.max(maxY, s.y);
  }
  const segments: Array<readonly [Spot, Spot]> = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i === 0 ? 0 : i - 1]!;
    const b = path[i]!;
    if (Math.max(a[0], b[0]) < minX - radius || Math.min(a[0], b[0]) > maxX + radius) continue;
    if (Math.max(a[1], b[1]) < minY - radius || Math.min(a[1], b[1]) > maxY + radius) continue;
    segments.push([a, b]);
  }
  if (segments.length === 0) return null;
  const limit = radius * radius;
  const inside = (s: InkSample): boolean => segments.some(([a, b]) => distanceSquared([s.x, s.y], a, b) < limit);

  const pieces: Array<{ samples: InkSample[]; cutStart: boolean; cutEnd: boolean }> = [];
  let current: { samples: InkSample[]; cutStart: boolean; cutEnd: boolean } | null = null;
  let touched = false;
  const first = samples[0]!;
  let wasIn = inside(first);
  if (wasIn) touched = true;
  else current = { samples: [first], cutStart: false, cutEnd: false };
  const step = radius / 2;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    let from = 0;
    for (let k = 1; k <= n; k++) {
      const to = k / n;
      const at = k === n ? b : between(a, b, to);
      const isIn = inside(at);
      if (isIn !== wasIn) {
        touched = true;
        // Il bordo fra `from` (dalla parte di `wasIn`) e `to`.
        let lo = from;
        let hi = to;
        for (let j = 0; j < BISECTIONS; j++) {
          const mid = (lo + hi) / 2;
          if (inside(between(a, b, mid)) === wasIn) lo = mid;
          else hi = mid;
        }
        const edge = between(a, b, wasIn ? hi : lo);
        if (isIn) {
          current!.samples.push(edge);
          current!.cutEnd = true;
          pieces.push(current!);
          current = null;
        } else {
          current = { samples: [edge], cutStart: true, cutEnd: false };
        }
        wasIn = isIn;
      }
      if (k === n && !isIn) current!.samples.push(b);
      from = to;
    }
  }
  if (!touched) return null;
  if (current !== null) pieces.push(current);
  // Un pezzo di un punto solo, nato da un taglio, è il bordo: non resta.
  return pieces
    .filter((piece) => piece.samples.length > 1 || (!piece.cutStart && !piece.cutEnd))
    .map((piece) => {
      const offset = piece.samples[0]!.t;
      return { samples: piece.samples.map((s) => ({ ...s, t: s.t - offset })), offset, cutStart: piece.cutStart, cutEnd: piece.cutEnd };
    });
}

/// Il pennello di un pezzo: ai tagli niente rastremazione, perché il tratto
/// continuava. La punta piatta non ne ha.
export function cutBrush(brush: InkBrush, piece: Pick<InkPiece, "cutStart" | "cutEnd">): InkBrush {
  if (isNib1(brush)) return brush;
  return {
    ...brush,
    ...(piece.cutStart ? { taperStart: 0 } : {}),
    ...(piece.cutEnd ? { taperEnd: 0 } : {}),
  };
}
