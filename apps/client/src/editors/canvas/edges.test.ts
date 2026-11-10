import { describe, expect, it } from "vitest";
import {
  closestOnEdge,
  distanceToEdge,
  edgeAt,
  edgePathData,
  linkedCardPlacement,
  nearestSide,
  nearestSides,
  sidePoint,
  type PlacedEdge,
} from "./edges";

const box = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });
const everywhere = { x: -10_000, y: -10_000, width: 20_000, height: 20_000 };

describe("i lati di un filo (T67)", () => {
  it("il punto a metà di ogni lato", () => {
    const card = box(10, 20);
    expect(sidePoint(card, "top")).toEqual({ x: 60, y: 20 });
    expect(sidePoint(card, "right")).toEqual({ x: 110, y: 50 });
    expect(sidePoint(card, "bottom")).toEqual({ x: 60, y: 80 });
    expect(sidePoint(card, "left")).toEqual({ x: 10, y: 50 });
  });

  it("il lato più vicino fra due schede: accanto destra e sinistra, sotto basso e alto, in diagonale il più corto", () => {
    expect(nearestSides(box(0, 0), box(300, 10))).toEqual({ fromSide: "right", toSide: "left" });
    expect(nearestSides(box(300, 10), box(0, 0))).toEqual({ fromSide: "left", toSide: "right" });
    expect(nearestSides(box(0, 0), box(20, 300))).toEqual({ fromSide: "bottom", toSide: "top" });
    expect(nearestSides(box(0, 300), box(20, 0))).toEqual({ fromSide: "top", toSide: "bottom" });
    // Più lontana in orizzontale che in verticale: destra e sinistra.
    expect(nearestSides(box(0, 0), box(400, 120))).toEqual({ fromSide: "right", toSide: "left" });
  });

  it("partito da un punto, il lato d'arrivo è quello più vicino a quel punto", () => {
    expect(nearestSides(box(0, 0), box(300, 10), "bottom")).toEqual({ fromSide: "bottom", toSide: "left" });
    expect(nearestSides(box(0, 0), box(0, 300), "right")).toEqual({ fromSide: "right", toSide: "top" });
    expect(nearestSide(box(0, 0), { x: 50, y: -40 })).toBe("top");
  });

  it("un filo da una scheda a sé stessa esce da un lato e torna da un altro", () => {
    const sides = nearestSides(box(0, 0), box(0, 0), undefined, true);
    expect(sides.fromSide).not.toBe(sides.toSide);
    expect(nearestSides(box(0, 0), box(0, 0), "top", true)).toEqual({ fromSide: "top", toSide: "right" });
  });
});

describe("la distanza da un filo (T67)", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };

  it("la curva di oggi: esce e arriva in orizzontale", () => {
    expect(edgePathData({ x: 0, y: 0 }, { x: 100, y: 40 })).toBe("M 0 0 C 50 0, 50 40, 100 40");
  });

  it("su un filo dritto la distanza è quella dal segmento; agli estremi quella dal capo", () => {
    expect(distanceToEdge({ x: 100, y: 0 }, a, b)).toBeCloseTo(0, 6);
    expect(distanceToEdge({ x: 100, y: 7 }, a, b)).toBeCloseTo(7, 6);
    expect(distanceToEdge({ x: -6, y: 8 }, a, b)).toBeCloseTo(10, 6);
    expect(closestOnEdge({ x: 50, y: -5 }, a, b).point).toEqual({ x: 50, y: 0 });
  });

  it("su un filo curvo la distanza segue la curva, non la corda", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 100 };
    // Il mezzo della curva è il mezzo della corda (simmetria), ma un punto
    // della corda a un quarto non sta sulla curva.
    expect(distanceToEdge({ x: 50, y: 50 }, from, to)).toBeLessThan(0.5);
    expect(distanceToEdge({ x: 25, y: 25 }, from, to)).toBeGreaterThan(5);
  });
});

describe("il filo sotto il puntatore (T67)", () => {
  const edges: PlacedEdge[] = [
    { id: "alto", a: { x: 0, y: 0 }, b: { x: 200, y: 0 } },
    { id: "basso", a: { x: 0, y: 30 }, b: { x: 200, y: 30 } },
  ];

  it("entro 8 px sullo schermo, e il più vicino vince", () => {
    expect(edgeAt({ x: 100, y: 7 }, edges, 1, everywhere)?.id).toBe("alto");
    expect(edgeAt({ x: 100, y: 9 }, edges, 1, everywhere)).toBeNull();
    expect(edgeAt({ x: 100, y: 24 }, edges, 1, everywhere)?.id).toBe("basso");
  });

  it("la tolleranza è sullo schermo: a zoom 2 sono 4 unità della lavagna, a zoom 0,5 sedici", () => {
    expect(edgeAt({ x: 100, y: 5 }, edges, 2, everywhere)).toBeNull();
    expect(edgeAt({ x: 100, y: 3.5 }, edges, 2, everywhere)?.id).toBe("alto");
    expect(edgeAt({ x: 100, y: -15 }, edges, 0.5, everywhere)?.id).toBe("alto");
  });

  it("guarda solo i fili in vista", () => {
    const view = { x: 0, y: 20, width: 300, height: 100 };
    expect(edgeAt({ x: 100, y: 7 }, edges, 1, view)?.id).toBeUndefined();
    expect(edgeAt({ x: 100, y: 24 }, edges, 1, view)?.id).toBe("basso");
  });

  it("duecento fili: trova quello giusto", () => {
    const many: PlacedEdge[] = Array.from({ length: 200 }, (_, index) => ({
      id: `e${index}`, a: { x: 0, y: index * 40 }, b: { x: 300, y: index * 40 },
    }));
    expect(edgeAt({ x: 150, y: 4003 }, many, 1, everywhere)?.id).toBe("e100");
  });
});

describe("la scheda di un filo lasciato nel vuoto (T67)", () => {
  it("il lato verso l'altro capo cade sotto il puntatore", () => {
    expect(linkedCardPlacement({ x: 0, y: 0 }, { x: 400, y: 50 }, 320, 160)).toEqual({ x: 400, y: -30, side: "left" });
    expect(linkedCardPlacement({ x: 0, y: 0 }, { x: -400, y: 50 }, 320, 160)).toEqual({ x: -720, y: -30, side: "right" });
    expect(linkedCardPlacement({ x: 0, y: 0 }, { x: 20, y: 300 }, 320, 160)).toEqual({ x: -140, y: 300, side: "top" });
    expect(linkedCardPlacement({ x: 0, y: 0 }, { x: 20, y: -300 }, 320, 160)).toEqual({ x: -140, y: -460, side: "bottom" });
  });
});
