// La geometria del rettangolo del trascinamento nel vuoto (N6 T20b): il tocco
// con una scheda, gli archi fra due schede scelte, il confronto delle scelte e la
// soglia del trascinamento. Le prove del gesto stanno in `engine-marquee.test.ts`.
import { describe, expect, it } from "vitest";
import {
  MARQUEE_START_PX,
  cardsTouched,
  edgesBetween,
  marqueeBox,
  marqueeMoved,
  sameIds,
  touchesMarquee,
  unionIds,
  type MarqueeNode,
} from "./marquee";

const card = (id: string, x: number, y: number, width = 100, height = 50): MarqueeNode => ({ id, x, y, width, height });

describe("il rettangolo del trascinamento (N6 T20b)", () => {
  it("va da un angolo all'altro in qualunque verso", () => {
    const box = { minX: 10, minY: 20, maxX: 90, maxY: 60 };
    expect(marqueeBox({ x: 10, y: 20 }, { x: 90, y: 60 })).toEqual(box);
    expect(marqueeBox({ x: 90, y: 60 }, { x: 10, y: 20 })).toEqual(box);
    expect(marqueeBox({ x: 90, y: 20 }, { x: 10, y: 60 })).toEqual(box);
  });

  it("sceglie la scheda che tocca, anche solo con un bordo o un angolo, e non quella lontana", () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(touchesMarquee(box, card("dentro", 20, 20))).toBe(true);
    expect(touchesMarquee(box, card("copre", -50, -50, 300, 300))).toBe(true);
    expect(touchesMarquee(box, card("bordo", 100, 40))).toBe(true);
    expect(touchesMarquee(box, card("angolo", 100, 100))).toBe(true);
    expect(touchesMarquee(box, card("fuori", 101, 40))).toBe(false);
    expect(touchesMarquee(box, card("sopra", 0, -60))).toBe(false);
  });

  it("le schede toccate tornano nell'ordine della lavagna", () => {
    const nodes = [card("c", 0, 0), card("lontana", 500, 500), card("a", 40, 10), card("b", 60, 30)];
    expect(cardsTouched({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, nodes)).toEqual(["c", "a", "b"]);
  });

  it("un arco va con le sue due schede scelte, e non con una sola", () => {
    const edges = [
      { id: "tra-due", fromNode: "a", toNode: "b" },
      { id: "verso-fuori", fromNode: "a", toNode: "z" },
      { id: "tra-altri", fromNode: "x", toNode: "y" },
    ];
    expect(edgesBetween(new Set(["a", "b"]), edges)).toEqual(["tra-due"]);
    expect(edgesBetween(new Set(["a"]), edges)).toEqual([]);
  });

  it("la scelta si confronta senza ordine, e l'unione non ha doppioni", () => {
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIds(["a", "b"], ["a", "c"])).toBe(false);
    expect(sameIds(["a"], ["a", "b"])).toBe(false);
    expect(unionIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("un clic non è un rettangolo: serve uno spostamento oltre la soglia", () => {
    expect(MARQUEE_START_PX).toBe(3);
    expect(marqueeMoved(100, 100, 102, 101)).toBe(false);
    expect(marqueeMoved(100, 100, 102, 102)).toBe(true);
    expect(marqueeMoved(100, 100, 104, 100)).toBe(true);
  });
});
