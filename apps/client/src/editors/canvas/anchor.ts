import type { CanvasNode } from "./model";

/**
 * A quale scheda appartiene un tratto, su una scheda PDF a quale pagina
 * (T19) e su una scheda di foglio a quale cella (T37). Solo geometria sulle coordinate della lavagna: niente DOM, niente
 * formato dell'inchiostro. Lo strato d'inchiostro (N4 T12) lo chiede quando
 * la penna si alza, e l'etichetta della penna (N6 T69) mentre è giù, con la
 * stessa regola.
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

/**
 * La pagina a cui si attacca un tratto che `anchorAt` ha dato alla scheda
 * `holder` (T19, D-4 a): `box` se il tratto comincia (`start`, in coordinate
 * della lavagna) dentro la pagina che la scheda mostra, i bordi compresi;
 * `null` se comincia sulla scheda ma fuori dalla pagina, o se la scheda non
 * mostra una pagina, e allora il tratto prende l'ancora `card`.
 *
 * Conta il punto d'inizio, non il riquadro: un tratto che parte sulla pagina
 * e ne esce resta della pagina, e la resa lo taglia alla scheda. Una pagina
 * con un numero che non è un intero da 1, una misura non positiva o un
 * rettangolo non finito non prende niente.
 */
export function pageAnchorAt<B extends PageBounds>(
  holder: CanvasNode,
  box: B | null | undefined,
  start: { readonly x: number; readonly y: number } | undefined,
): B | null {
  if (!box || !start || !validCard(holder) || !validPage(box)) return null;
  const x = start.x - holder.x;
  const y = start.y - holder.y;
  return within(x, box.rect.x, box.rect.width) && within(y, box.rect.y, box.rect.height) ? box : null;
}

/**
 * La pagina che una scheda mostra, come la vede questo modulo: la forma di
 * `CardPageBox` di `cards.ts` (il numero da 1, la misura in punti PDF, il
 * rettangolo in unità della lavagna dall'angolo della scheda), scritta per
 * struttura così il confine resta il solo modello.
 */
export interface PageBounds {
  readonly page: number;
  readonly size: { readonly width: number; readonly height: number };
  readonly rect: Bounds;
}

function validPage(box: PageBounds): boolean {
  const { page, size, rect } = box;
  return (
    Number.isSafeInteger(page) && page >= 1 &&
    Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0 &&
    validBox(rect) && rect.width > 0 && rect.height > 0
  );
}

/**
 * La cella a cui si attacca un tratto di riquadro `b` (in coordinate della
 * lavagna) che `anchorAt` ha dato alla scheda di foglio `holder` (T37, D-6
 * b): quella che `cellAt` dice sotto il centro di `b`, dato in unità della
 * lavagna dall'angolo della scheda. `null` se sotto il centro non c'è una
 * cella (le intestazioni, fuori dalla griglia: `cellAt` dà `null`), se la
 * scheda non è un foglio (`cellAt` assente) o se la cella non vale; allora il
 * tratto prende l'ancora `card`.
 *
 * Conta il centro del riquadro, non il punto d'inizio come per la pagina: un
 * segno sopra una cella si fa spesso cominciando nella cella accanto. Sopra
 * celle unite `cellAt` dà la cella in alto a sinistra dell'unione. Una cella
 * con un foglio vuoto, un indirizzo che non è A1 (`isCellAddress`), un
 * rettangolo non finito o vuoto o uno zoom non positivo non prende niente.
 */
export function cellAnchorAt<B extends CellBounds>(
  holder: CanvasNode,
  b: Bounds,
  cellAt: ((point: { readonly x: number; readonly y: number }) => B | null) | null | undefined,
): B | null {
  if (!cellAt || !validCard(holder) || !validBox(b)) return null;
  const x = b.x + b.width / 2 - holder.x;
  const y = b.y + b.height / 2 - holder.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cell = cellAt({ x, y });
  return cell && validCell(cell) ? cell : null;
}

/**
 * Una cella che una scheda di foglio mostra, come la vede questo modulo: il
 * nome del foglio com'è nel file, l'indirizzo in notazione A1, il
 * rettangolo della cella in unità della lavagna dall'angolo della scheda e
 * quante unità della lavagna fa un pixel del foglio al 100% (`zoom`). È la
 * forma di `InkCellBox` di `ink-record.ts`, scritta per struttura così il
 * confine resta il solo modello.
 */
export interface CellBounds {
  readonly sheet: string;
  readonly cell: string;
  readonly rect: Bounds;
  readonly zoom: number;
}

/** L'ultima colonna (`XFD`) e l'ultima riga di un indirizzo A1. */
const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;
const A1 = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;

/**
 * Se `text` è un indirizzo di cella in notazione A1 come lo scrive l'ancora
 * `cell` (`docs/reference/canvas-ink.md`): la colonna da `A` a `XFD`, la riga
 * da 1 a 1048576, solo maiuscole, senza `$` e senza zeri davanti. La stessa
 * regola di `CellAddress::parse` del nucleo.
 */
export function isCellAddress(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const match = A1.exec(text);
  if (!match) return false;
  let column = 0;
  for (const letter of match[1]!) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column <= MAX_COLUMN && Number(match[2]) <= MAX_ROW;
}

function validCell(box: CellBounds): boolean {
  const { sheet, cell, rect, zoom } = box;
  return (
    typeof sheet === "string" && sheet !== "" && isCellAddress(cell) &&
    validBox(rect) && rect.width > 0 && rect.height > 0 &&
    Number.isFinite(zoom) && zoom > 0
  );
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
