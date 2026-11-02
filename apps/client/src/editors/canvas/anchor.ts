import type { CanvasNode } from "./model";

/**
 * Which card a stroke belongs to. Pure geometry on the canvas coordinates: no
 * DOM, no ink format. The ink layer (N4 T12) asks it once, when the pen lifts.
 */

/** An axis-aligned box in canvas units; `width` and `height` are never negative. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The box of `points` widened by half of `size` on every side, so a single
 * touch still has an area.
 *
 * Never yields `NaN`: points with a non-finite coordinate are skipped, a
 * `size` that is not finite or is negative counts as 0, and with no usable
 * point the box is the empty one at the origin. Coordinates near the limits
 * of `number` may still overflow to an infinite width; `anchorAt` treats such
 * a box as free.
 */
export function strokeBounds(points: Iterable<{ x: number; y: number }>, size: number): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (minX > maxX) return { x: 0, y: 0, width: 0, height: 0 };
  const half = Number.isFinite(size) && size > 0 ? size / 2 : 0;
  const x = minX - half;
  const y = minY - half;
  return { x, y, width: maxX + half - x, height: maxY + half - y };
}

/**
 * The card that owns a stroke whose box is `b`, or `null` for a free stroke.
 *
 * Only the topmost card the box touches counts (the last one in `nodes`): ink
 * is drawn inside its card, so a stroke anchored under another card would be
 * partly hidden. That card owns the stroke when it contains the centre of `b`
 * (edges count as inside), holds at least half of the area of `b` and
 * `canHold` accepts it; otherwise the stroke is free, even if a card below
 * would have taken it.
 *
 * The share of `b` inside a card is measured axis by axis (covered length over
 * the box length, multiplied), so huge cards never overflow an area into
 * `Infinity / Infinity`. An axis on which `b` has no length (a `size` of 0, a
 * straight stroke) is a point on that axis: it is covered entirely when the
 * point lies inside the card, edges included, and not at all otherwise. A box
 * with a non-finite or negative measure belongs to nobody. Cards with a
 * non-finite position or a size that is not finite and positive touch nothing.
 */
export function anchorAt(
  nodes: readonly CanvasNode[],
  b: Bounds,
  canHold: (node: CanvasNode) => boolean,
): CanvasNode | null {
  if (!validBox(b)) return null;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (!validCard(node)) continue;
    const share = coverage(b.x, b.width, node.x, node.width) * coverage(b.y, b.height, node.y, node.height);
    if (share <= 0) continue;
    const owns =
      share >= 0.5 &&
      within(b.x + b.width / 2, node.x, node.width) &&
      within(b.y + b.height / 2, node.y, node.height) &&
      canHold(node);
    return owns ? node : null;
  }
  return null;
}

function validBox(b: Bounds): boolean {
  return (
    Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height) &&
    b.width >= 0 && b.height >= 0
  );
}

function validCard(node: CanvasNode): boolean {
  return (
    Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.width) && Number.isFinite(node.height) &&
    node.width > 0 && node.height > 0
  );
}

/** The share, in [0, 1], of the segment `start..start+length` inside `cardStart..cardStart+cardLength`. */
function coverage(start: number, length: number, cardStart: number, cardLength: number): number {
  if (length === 0) return within(start, cardStart, cardLength) ? 1 : 0;
  const overlap = Math.min(start + length, cardStart + cardLength) - Math.max(start, cardStart);
  if (!(overlap > 0)) return 0;
  return Math.min(1, overlap / length);
}

function within(value: number, start: number, length: number): boolean {
  return value >= start && value <= start + length;
}
