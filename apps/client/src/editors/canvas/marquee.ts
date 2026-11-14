// Il rettangolo del trascinamento nel vuoto (N6 T20b), la geometria pura: senza
// la lavagna, senza il DOM. Col mouse e con la Selezione, un trascinamento
// sinistro sul vuoto disegna un rettangolo e sceglie le schede che tocca; gli
// archi fra due schede scelte vanno con loro. Il motore (`engine.ts`) disegna il
// rettangolo, aggiorna la scelta una volta per fotogramma e sceglie a fine gesto;
// qui stanno le regole di quel calcolo, provate senza la lavagna.

/// Un punto della lavagna, in coordinate della lavagna.
export interface MarqueePoint {
  readonly x: number;
  readonly y: number;
}

/// Il rettangolo in coordinate della lavagna, con i lati in ordine (`min` ≤ `max`).
export interface MarqueeBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/// La parte di una scheda che conta per la scelta: il riquadro, con il suo id.
export interface MarqueeNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Il filo che conta per la scelta: le sue due schede.
export interface MarqueeEdge {
  readonly id: string;
  readonly fromNode: string;
  readonly toNode: string;
}

/// Quanto il puntatore deve andare, in pixel dello schermo (somma dei due assi),
/// prima che il trascinamento sia un rettangolo e non un clic: la stessa soglia
/// degli spostamenti delle schede.
export const MARQUEE_START_PX = 3;

/// Il trascinamento è partito: il puntatore si è spostato oltre la soglia.
export function marqueeMoved(startX: number, startY: number, x: number, y: number): boolean {
  return Math.abs(x - startX) + Math.abs(y - startY) > MARQUEE_START_PX;
}

/// Il rettangolo che va da `from` a `to`, in qualunque verso.
export function marqueeBox(from: MarqueePoint, to: MarqueePoint): MarqueeBox {
  return {
    minX: Math.min(from.x, to.x),
    minY: Math.min(from.y, to.y),
    maxX: Math.max(from.x, to.x),
    maxY: Math.max(from.y, to.y),
  };
}

/// Una scheda è scelta se il rettangolo la tocca: basta un suo punto di bordo o
/// d'angolo dentro il rettangolo, o il rettangolo che la copre tutta.
export function touchesMarquee(box: MarqueeBox, node: MarqueeNode): boolean {
  return node.x <= box.maxX
    && node.x + node.width >= box.minX
    && node.y <= box.maxY
    && node.y + node.height >= box.minY;
}

/// Gli id delle schede che il rettangolo tocca, nell'ordine in cui arrivano.
export function cardsTouched(box: MarqueeBox, nodes: readonly MarqueeNode[]): string[] {
  const touched: string[] = [];
  for (const node of nodes) if (touchesMarquee(box, node)) touched.push(node.id);
  return touched;
}

/// Gli id degli archi con tutte e due le schede in `held`: un filo fra due schede
/// scelte è scelto con loro.
export function edgesBetween(held: ReadonlySet<string>, edges: readonly MarqueeEdge[]): string[] {
  const between: string[] = [];
  for (const edge of edges) {
    if (held.has(edge.fromNode) && held.has(edge.toNode)) between.push(edge.id);
  }
  return between;
}

/// Gli elementi di `lists` senza doppioni, nell'ordine in cui arrivano.
export function unionIds(...lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())];
}

/// Due insiemi di id hanno gli stessi elementi, in qualunque ordine.
export function sameIds(a: ReadonlySet<string> | readonly string[], b: ReadonlySet<string> | readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}
