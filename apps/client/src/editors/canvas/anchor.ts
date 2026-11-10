import type { CanvasNode } from "./model";

/**
 * A quale scheda appartiene un tratto. Solo geometria sulle coordinate della
 * lavagna: niente DOM, niente formato dell'inchiostro. Lo strato d'inchiostro
 * (N4 T12) lo chiede quando la penna si alza, e l'etichetta della penna (N6
 * T69) mentre è giù, con la stessa regola.
 */

/** Un riquadro allineato agli assi, in unità della lavagna; `width` e `height` non sono mai negativi. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Il riquadro di `points` allargato di metà `size` da ogni lato, così anche un
 * tocco solo ha un'area.
 *
 * Non dà mai `NaN`: i punti con una coordinata non finita si saltano, un
 * `size` non finito o negativo vale 0, e senza punti validi il riquadro è
 * quello vuoto nell'origine. Vicino ai limiti di `number` la larghezza può
 * ancora traboccare in `Infinity`; `anchorAt` tratta quel riquadro come
 * libero.
 */
export function strokeBounds(points: Iterable<{ x: number; y: number }>, size: number): Bounds {
  const box = new StrokeBox();
  for (const point of points) box.add(point.x, point.y);
  return box.bounds(size);
}

/**
 * Il riquadro di un tratto che cresce un punto alla volta, mentre la penna è
 * giù (N6 T69): `bounds(size)` dà lo stesso riquadro di `strokeBounds` sugli
 * stessi punti, con le stesse regole, così l'ancora che si mostra prima
 * dell'alzata è quella che `anchorAt` darà alla fine.
 */
export class StrokeBox {
  #minX = Infinity;
  #minY = Infinity;
  #maxX = -Infinity;
  #maxY = -Infinity;

  /** Aggiunge un punto; vero se il riquadro è cresciuto. Un punto non finito non conta. */
  add(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    let grew = false;
    if (x < this.#minX) {
      this.#minX = x;
      grew = true;
    }
    if (x > this.#maxX) {
      this.#maxX = x;
      grew = true;
    }
    if (y < this.#minY) {
      this.#minY = y;
      grew = true;
    }
    if (y > this.#maxY) {
      this.#maxY = y;
      grew = true;
    }
    return grew;
  }

  /** Il riquadro dei punti aggiunti, allargato di metà `size`: come `strokeBounds`. */
  bounds(size: number): Bounds {
    if (this.#minX > this.#maxX) return { x: 0, y: 0, width: 0, height: 0 };
    const half = Number.isFinite(size) && size > 0 ? size / 2 : 0;
    const x = this.#minX - half;
    const y = this.#minY - half;
    return { x, y, width: this.#maxX + half - x, height: this.#maxY + half - y };
  }
}

/**
 * La scheda a cui appartiene il tratto di riquadro `b`, o `null` se il tratto
 * è libero.
 *
 * Conta solo la scheda più in alto che il riquadro tocca (l'ultima in
 * `nodes`): l'inchiostro si disegna dentro la sua scheda, quindi un tratto
 * ancorato sotto un'altra scheda resterebbe nascosto in parte. Il tratto è di
 * quella scheda se lei contiene il centro di `b` (i bordi contano dentro), se
 * dentro di lei sta almeno metà dell'area di `b` e se `canHold` la accetta;
 * altrimenti il tratto è libero, anche se una scheda sotto lo avrebbe preso.
 *
 * La parte di `b` dentro una scheda si misura asse per asse (la lunghezza
 * coperta diviso la lunghezza del riquadro, poi moltiplicate), così una scheda
 * enorme non fa mai traboccare un'area in `Infinity / Infinity`. Su un asse
 * dove `b` non ha lunghezza (un `size` di 0, un tratto dritto) il riquadro è
 * un punto: è coperto tutto se il punto sta dentro la scheda, bordi compresi,
 * e per niente altrimenti. Un riquadro con una misura non finita o negativa
 * non è di nessuno. Le schede con una posizione non finita, o una misura non
 * finita o non positiva, non toccano niente.
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

/** La parte, fra 0 e 1, del segmento `start..start+length` che sta dentro `cardStart..cardStart+cardLength`. */
function coverage(start: number, length: number, cardStart: number, cardLength: number): number {
  if (length === 0) return within(start, cardStart, cardLength) ? 1 : 0;
  const overlap = Math.min(start + length, cardStart + cardLength) - Math.max(start, cardStart);
  if (!(overlap > 0)) return 0;
  return Math.min(1, overlap / length);
}

function within(value: number, start: number, length: number): boolean {
  return value >= start && value <= start + length;
}
