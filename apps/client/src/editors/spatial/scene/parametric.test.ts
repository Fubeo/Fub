import { describe, expect, it } from "vitest";
import {
  MAX_COUNT,
  normalRotation,
  polygonalAttrs,
  polygonalPath,
  polygonalVertices,
  readPolygonal,
  writePolygonal,
  type Polygonal,
  type PolygonalShape,
} from "./parametric";
import { readScene } from "./read";
import cases from "../../../__fixtures__/scene-shapes/cases.json";
import sparse from "../../../__fixtures__/scene/sparse.svg?raw";

const shapeOf = (value: string): PolygonalShape => {
  if (value !== "polygon" && value !== "star") throw new Error(`forma sconosciuta: ${value}`);
  return value;
};

/// L'area con segno di un poligono: positiva se, con l'asse y che scende, i
/// vertici girano in senso orario.
const signedArea = (points: ReadonlyArray<readonly [number, number]>): number =>
  points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length]!;
    return sum + (x * ny - nx * y) / 2;
  }, 0);

describe("poligoni e stelle", () => {
  for (const { shape, geom, polygonal } of cases.read) {
    it(`${shape} fub:geom=${JSON.stringify(geom)} ${polygonal === null ? "è fuori grammatica" : "si legge"}`, () => {
      expect(readPolygonal(shapeOf(shape), geom)).toEqual(polygonal === null ? null : { shape, ...polygonal });
    });
  }

  for (const { polygonal, geom } of cases.write) {
    it(`si scrive ${JSON.stringify(geom)}`, () => {
      const p = { ...polygonal, shape: shapeOf(polygonal.shape) };
      expect(writePolygonal(p)).toBe(geom);
      expect(readPolygonal(p.shape, geom)).not.toBeNull();
    });
  }

  for (const { shape, geom, d } of cases.path) {
    it(`${shape} ${geom} ha d=${JSON.stringify(d)}`, () => {
      const p = readPolygonal(shapeOf(shape), geom)!;
      expect(polygonalPath(p)).toBe(d);
      // Un raggio degli angoli di 0,001 si scrive 0, e il d non cambia.
      expect(polygonalAttrs(p)).toEqual({ "fub:shape": shape, "fub:geom": writePolygonal(p), d });
    });
  }

  it("i vertici stanno sul loro cerchio, e sono n per un poligono e 2n per una stella", () => {
    for (const count of [3, 4, 5, 7, 12]) {
      const polygon: Polygonal = { shape: "polygon", cx: 3, cy: -2, r: 10, count, ratio: null, rotation: 17, corner: 0 };
      const vertices = polygonalVertices(polygon);
      expect(vertices).toHaveLength(count);
      for (const [x, y] of vertices) expect(Math.hypot(x - 3, y + 2)).toBeCloseTo(10, 9);
      const star: Polygonal = { ...polygon, shape: "star", ratio: 0.4 };
      const points = polygonalVertices(star);
      expect(points).toHaveLength(2 * count);
      points.forEach(([x, y], i) => expect(Math.hypot(x - 3, y + 2)).toBeCloseTo(i % 2 === 0 ? 10 : 4, 9));
    }
  });

  it("a rotazione 0 un poligono poggia su un lato e una stella ha una punta in alto", () => {
    for (const count of [3, 4, 5, 6, 8, 9]) {
      const vertices = polygonalVertices({ shape: "polygon", cx: 0, cy: 0, r: 10, count, ratio: null, rotation: 0, corner: 0 });
      const bottom = Math.max(...vertices.map(([, y]) => y));
      expect(vertices.filter(([, y]) => Math.abs(y - bottom) < 1e-9)).toHaveLength(2);
      const [tip] = polygonalVertices({ shape: "star", cx: 0, cy: 0, r: 10, count, ratio: 0.5, rotation: 0, corner: 0 });
      expect(tip![0]).toBeCloseTo(0, 9);
      expect(tip![1]).toBeCloseTo(-10, 9);
    }
  });

  it("i vertici girano in senso orario sullo schermo", () => {
    for (const count of [3, 5, 8]) {
      for (const ratio of [0.1, 0.5, 1]) {
        const star: Polygonal = { shape: "star", cx: 0, cy: 0, r: 10, count, ratio, rotation: 40, corner: 0 };
        expect(signedArea(polygonalVertices(star))).toBeGreaterThan(0);
      }
      expect(signedArea(polygonalVertices({ shape: "polygon", cx: 0, cy: 0, r: 10, count, ratio: null, rotation: -70, corner: 0 }))).toBeGreaterThan(0);
    }
  });

  it("la rotazione si riporta fra -180 escluso e 180", () => {
    expect(normalRotation(0)).toBe(0);
    expect(Object.is(normalRotation(-0), 0)).toBe(true);
    expect(Object.is(normalRotation(-360), 0)).toBe(true);
    expect(normalRotation(180)).toBe(180);
    expect(normalRotation(-180)).toBe(180);
    expect(normalRotation(181)).toBe(-179);
    expect(normalRotation(-540)).toBe(180);
    expect(normalRotation(725)).toBe(5);
  });

  it("una geometria che scritta non si rilegge non ha attributi", () => {
    const tiny: Polygonal = { shape: "polygon", cx: 0, cy: 0, r: 0.004, count: 4, ratio: null, rotation: 0, corner: 0 };
    expect(polygonalAttrs(tiny)).toBeNull();
    expect(polygonalAttrs({ ...tiny, r: 10, count: MAX_COUNT + 1 })).toBeNull();
    expect(polygonalAttrs({ ...tiny, r: 10, shape: "star", ratio: 0.00004 })).toBeNull();
  });

  it("i poligoni e le stelle del mirror di Rust hanno il d che la superficie calcola", () => {
    const shapes = readScene(sparse).items.filter((item) => item.kind === "element" && item.polygonal !== undefined);
    expect(shapes.map((item) => item.kind === "element" && item.role)).toEqual(["ngon", "star"]);
    for (const item of shapes) {
      if (item.kind !== "element") continue;
      const d = /\sd="([^"]*)"/.exec(sparse.slice(item.utf16[0], item.utf16[1]))![1];
      expect(polygonalPath(item.polygonal!)).toBe(d);
    }
  });

  it("scrivere ciò che si è letto non cambia niente", () => {
    // Un generatore lineare congruenziale: gli stessi casi a ogni giro.
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let i = 0; i < 200; i++) {
      const shape: PolygonalShape = next() < 0.5 ? "polygon" : "star";
      const p: Polygonal = {
        shape,
        cx: (next() - 0.5) * 2000,
        cy: (next() - 0.5) * 2000,
        r: 1 + next() * 500,
        count: 3 + Math.floor(next() * 30),
        ratio: shape === "star" ? 0.01 + next() * 0.99 : null,
        rotation: (next() - 0.5) * 1000,
        corner: next() < 0.3 ? 0 : next() * 80,
      };
      const attrs = polygonalAttrs(p)!;
      const again = polygonalAttrs(readPolygonal(shape, attrs["fub:geom"])!);
      expect(again).toEqual(attrs);
    }
  });
});
