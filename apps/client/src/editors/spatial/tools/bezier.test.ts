// La penna di Bézier: i nodi che mette, il tracciato che ne scrive, e il tipo
// di ogni nodo come lo leggerà lo strumento Nodi.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import type { Matrix } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { collapsed, penKind, penNode, penPath, type PenNode } from "./bezier";
import { kindOf, readNodes, writeNodes } from "./nodes";

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const write = (nodes: readonly PenNode[], closed: boolean, m: Matrix = IDENTITY): string => pathData(writeNodes([penPath(nodes, closed, m)]));

describe("i nodi della penna", () => {
  it("un tocco mette uno spigolo, un trascinamento un nodo simmetrico", () => {
    expect(penNode([10, 20], null)).toEqual({ at: [10, 20], in: null, out: null });
    expect(penNode([10, 20], [30, 25])).toEqual({ at: [10, 20], in: [-10, 15], out: [30, 25] });
    expect(penKind(penNode([10, 20], null))).toBe("corner");
    expect(penKind(penNode([10, 20], [30, 25]))).toBe("symmetric");
  });

  it("legge il tipo dalle maniglie, come lo strumento Nodi", () => {
    // Allineate ma lunghe diverse: liscio.
    expect(penKind({ at: [0, 0], in: [-10, 0], out: [20, 0] })).toBe("smooth");
    // Girate: spigolo; con una maniglia sola, anche.
    expect(penKind({ at: [0, 0], in: [-10, 0], out: [0, 20] })).toBe("corner");
    expect(penKind({ at: [0, 0], in: [-10, 0], out: null })).toBe("corner");
    expect(penKind({ at: [0, 0], in: null, out: [10, 0] })).toBe("corner");
    // Ritornate indietro sulla stessa retta: spigolo.
    expect(penKind({ at: [0, 0], in: [10, 0], out: [20, 0] })).toBe("corner");
  });
});

describe("il tracciato della penna", () => {
  it("fra due spigoli traccia una linea, altrimenti una cubica", () => {
    const corner = penNode([10, 10], null);
    const smooth = penNode([50, 10], [60, 30]);
    expect(write([corner, penNode([50, 10], null), penNode([50, 50], null)], false)).toBe("M10 10 L50 10 L50 50");
    // La maniglia che manca coincide col suo nodo.
    expect(write([corner, smooth, penNode([90, 10], null)], false)).toBe("M10 10 C10 10 40 -10 50 10 C60 30 90 10 90 10");
    // Un nodo che c'è da solo non fa un tracciato che si veda.
    expect(write([corner], false)).toBe("M10 10");
  });

  it("chiuso torna al primo nodo, con Z se l'ultimo segmento è una linea", () => {
    const square = [penNode([0, 0], null), penNode([10, 0], null), penNode([10, 10], null)];
    expect(write(square, true)).toBe("M0 0 L10 0 L10 10 Z");
    // Il primo nodo trascinato curva l'ultimo segmento con la sua maniglia
    // d'entrata.
    const drop = [penNode([0, 0], [5, -5]), penNode([10, 0], null), penNode([10, 10], null)];
    expect(write(drop, true)).toBe("M0 0 C5 -5 10 0 10 0 L10 10 C10 10 -5 5 0 0 Z");
    // Due nodi trascinati chiudono una foglia.
    expect(write([penNode([0, 0], [0, -10]), penNode([20, 0], [20, 10])], true)).toBe("M0 0 C0 -10 20 -10 20 0 C20 10 0 10 0 0 Z");
  });

  it("si scrive nelle coordinate del livello, maniglie comprese", () => {
    // Un livello spostato di (100, 0) e grande il doppio: la scena ci entra
    // con l'inversa.
    const inverse: Matrix = [0.5, 0, 0, 0.5, -50, 0];
    expect(write([penNode([100, 0], [120, 20]), penNode([140, 0], null)], false, inverse)).toBe("M0 0 C10 10 20 0 20 0");
  });

  it("lo strumento Nodi ritrova i tipi che la penna ha messo", () => {
    const nodes = [penNode([0, 0], null), penNode([20, 0], [30, 10]), penNode([40, 0], null), penNode([60, 0], null)];
    const read = readNodes(parsePath(write(nodes, false))!)[0]!;
    expect([1, 2].map((at) => kindOf(read, at))).toEqual([penKind(nodes[1]!), penKind(nodes[2]!)]);
    expect(kindOf(read, 1)).toBe("symmetric");
  });

  it("riconosce un tracciato che si scrive tutto in un punto", () => {
    expect(collapsed(penPath([penNode([1, 1], null), penNode([1.001, 1], null)], false, IDENTITY))).toBe(true);
    expect(collapsed(penPath([penNode([1, 1], null), penNode([1, 1], [9, 9])], false, IDENTITY))).toBe(false);
    expect(collapsed(penPath([penNode([1, 1], null), penNode([2, 1], null)], false, IDENTITY))).toBe(false);
    expect(collapsed({ nodes: [], links: [], closed: false })).toBe(true);
  });
});
