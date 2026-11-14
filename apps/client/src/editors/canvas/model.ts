// Il modello della tela come lo dà il nucleo (`wasm/core.ts`, `model()`):
// JSON Canvas 1.0 con i campi sconosciuti conservati a ogni livello. Qui ci
// sono i tipi e le punte di serie degli archi, che il disegno e l'inversione
// leggono. La lettura del file, le sue regole (R1–R8 di
// `docs/reference/canvas-format.md`) e i suoi limiti stanno nel nucleo.

export type CanvasNodeType = "text" | "file" | "link" | "group";
export type CanvasEdgeSide = "top" | "right" | "bottom" | "left";
export type CanvasEdgeEnd = "none" | "arrow";
/** `from` è l'inizio dell'arco (`fromNode`), `to` la fine (`toNode`). */
export type CanvasEdgeEndpoint = "from" | "to";

/**
 * Le punte di serie, come dice JSON Canvas 1.0: senza `fromEnd` nessuna punta
 * all'inizio, senza `toEnd` la freccia alla fine. Obsidian spesso non le scrive.
 */
export const DEFAULT_EDGE_END: Readonly<Record<CanvasEdgeEndpoint, CanvasEdgeEnd>> = { from: "none", to: "arrow" };

/** La punta che l'arco mostra a un'estremità: quella scritta, o quella di serie. Il file non cambia. */
export function edgeEnd(edge: CanvasEdge, endpoint: CanvasEdgeEndpoint): CanvasEdgeEnd {
  return (endpoint === "from" ? edge.fromEnd : edge.toEnd) ?? DEFAULT_EDGE_END[endpoint];
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: string;
  [extra: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasEdgeSide;
  fromEnd?: CanvasEdgeEnd;
  toSide?: CanvasEdgeSide;
  toEnd?: CanvasEdgeEnd;
  color?: string;
  label?: string;
  [extra: string]: unknown;
}

export interface CanvasDocument {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [extra: string]: unknown;
}
