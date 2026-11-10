import { describe, expect, it } from "vitest";

import type { CanvasNode } from "./model";
import { readingOrder } from "./reading-order";

const card = (id: string, x: number, y: number, width = 100, height = 60, type: CanvasNode["type"] = "text"): CanvasNode => ({ id, type, x, y, width, height });
const group = (id: string, x: number, y: number, width: number, height: number): CanvasNode => card(id, x, y, width, height, "group");
const ids = (nodes: readonly CanvasNode[]): string[] => readingOrder(nodes).map((entry) => entry.node.id);

describe("readingOrder", () => {
  it("legge le righe dall'alto in basso e ogni riga da sinistra a destra", () => {
    const nodes = [card("c", 400, 10), card("d", 0, 200), card("a", 0, 0), card("b", 200, 20)];
    expect(ids(nodes)).toEqual(["a", "b", "c", "d"]);
  });

  it("mette sulla stessa riga solo ciò che si sovrappone per più di metà della più bassa", () => {
    // `b` si sovrappone ad `a` per 31 su 60: stessa riga, viene dopo perché è
    // più a destra anche se più in alto. `c` per 30 su 60 (metà esatta): riga dopo.
    expect(ids([card("b", 200, 29), card("a", 0, 0)])).toEqual(["a", "b"]);
    expect(ids([card("a", 0, 0), card("b", 200, 29)])).toEqual(["a", "b"]);
    expect(ids([card("c", 0, 30), card("a", 200, 0)])).toEqual(["a", "c"]);
    // La scheda bassa conta per sé: 10 su 20 non bastano, 11 sì.
    expect(ids([card("alta", 300, 0, 100, 200), card("bassa", 0, 190, 100, 20)])).toEqual(["alta", "bassa"]);
    expect(ids([card("alta", 300, 0, 100, 200), card("bassa", 0, 189, 100, 20)])).toEqual(["bassa", "alta"]);
  });

  it("confronta ogni scheda con quella che apre la riga, non con l'ultima", () => {
    // `b` è sulla riga di `a`; `c` toccherebbe `b` ma non `a`: riga nuova.
    const nodes = [card("a", 0, 0, 100, 60), card("b", 150, 25, 100, 60), card("c", 300, 50, 100, 60)];
    expect(ids(nodes)).toEqual(["a", "b", "c"]);
    expect(ids([card("a", 0, 0, 100, 60), card("b", 150, 25, 100, 60), card("c", 50, 70, 100, 60)])).toEqual(["a", "b", "c"]);
    expect(ids([card("a", 200, 0, 100, 60), card("c", 0, 70, 100, 60), card("b", 400, 25, 100, 60)])).toEqual(["a", "b", "c"]);
  });

  it("dà prima i gruppi, ognuno seguito dal suo contenuto nello stesso ordine", () => {
    const nodes = [
      card("fuori", 0, 0),
      group("g", 0, 200, 500, 300),
      card("g2", 250, 220),
      card("g1", 20, 230),
      card("g3", 20, 400),
      card("dopo", 0, 600),
    ];
    const order = readingOrder(nodes);
    expect(order.map((entry) => entry.node.id)).toEqual(["g", "g1", "g2", "g3", "fuori", "dopo"]);
    expect(order.map((entry) => entry.depth)).toEqual([0, 1, 1, 1, 0, 0]);
    expect(order.map((entry) => entry.parent)).toEqual([null, "g", "g", "g", null, null]);
    expect(order.map((entry) => entry.index)).toEqual([1, 3, 2, 4, 0, 5]);
  });

  it("annida un gruppo dentro un gruppo, e lascia vuoto un gruppo vuoto", () => {
    const nodes = [
      group("esterno", 0, 0, 1000, 1000),
      group("interno", 100, 100, 400, 400),
      card("dentro", 150, 150),
      card("solo-esterno", 600, 600),
      group("vuoto", 2000, 0, 200, 200),
    ];
    const order = readingOrder(nodes);
    expect(order.map((entry) => [entry.node.id, entry.depth, entry.parent])).toEqual([
      ["esterno", 0, null],
      ["interno", 1, "esterno"],
      ["dentro", 2, "interno"],
      ["solo-esterno", 1, "esterno"],
      ["vuoto", 0, null],
    ]);
  });

  it("non mette dentro un gruppo ciò che ne esce anche di poco", () => {
    const nodes = [group("g", 0, 0, 300, 300), card("sborda", 250, 10, 100, 60)];
    expect(readingOrder(nodes).map((entry) => entry.depth)).toEqual([0, 0]);
  });

  it("con due schede esattamente sovrapposte dà prima quella sotto", () => {
    expect(ids([card("sotto", 10, 10), card("sopra", 10, 10)])).toEqual(["sotto", "sopra"]);
    expect(ids([card("sopra", 10, 10), card("sotto", 10, 10)])).toEqual(["sopra", "sotto"]);
  });

  it("annida due gruppi identici invece di farli contenere a vicenda", () => {
    const nodes = [group("a", 0, 0, 300, 300), group("b", 0, 0, 300, 300), card("x", 10, 10)];
    expect(readingOrder(nodes).map((entry) => [entry.node.id, entry.depth])).toEqual([["a", 0], ["b", 1], ["x", 2]]);
  });

  it("dà ogni scheda una volta, anche con tante schede e tanti gruppi", () => {
    const nodes: CanvasNode[] = [];
    for (let i = 0; i < 40; i++) nodes.push(group(`g${i}`, i * 5, i * 5, 4000 - i * 10, 4000 - i * 10));
    for (let i = 0; i < 2000; i++) nodes.push(card(`c${i}`, 200 + (i % 40) * 90, 200 + Math.floor(i / 40) * 70, 80, 60));
    const order = readingOrder(nodes);
    expect(order).toHaveLength(nodes.length);
    expect(new Set(order.map((entry) => entry.node.id)).size).toBe(nodes.length);
    expect(order[0]!.node.id).toBe("g0");
    expect(order[39]!.depth).toBe(39);
    expect(order[40]!.node.id).toBe("c0");
    expect(order[41]!.node.id).toBe("c1");
  });

  it("non inventa niente senza schede", () => {
    expect(readingOrder([])).toEqual([]);
  });
});
