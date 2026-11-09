// Il modello della tela come lo dà il nucleo (`wasm/core.ts`, `model()`):
// JSON Canvas 1.0 con i campi sconosciuti conservati a ogni livello. Qui ci
// sono solo i tipi; la lettura del file, le sue regole (R1–R8 di
// `docs/reference/canvas-format.md`) e i suoi limiti stanno nel nucleo.

export type CanvasNodeType = "text" | "file" | "link" | "group";
export type CanvasEdgeSide = "top" | "right" | "bottom" | "left";
export type CanvasEdgeEnd = "none" | "arrow";

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
