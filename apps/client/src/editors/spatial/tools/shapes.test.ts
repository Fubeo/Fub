// Le forme dell'Essenziale: gli elementi che l'`add` scrive, con la
// geometria arrotondata come la scrive il file (formato della scena, §4, §6
// e l'esempio di §13). E lo strumento Poligono: i `d` attesi li ha calcolati
// a parte un programma indipendente, dalla regola del formato dei poligoni e
// delle stelle.

import { describe, expect, it } from "vitest";
import { polygonalVertices } from "../scene/parametric";
import { arrowPath, constrainEnd, polygonCount, polygonDrag, POLYGON_TOOL, shapeElem, stepRatio, withCount } from "./shapes";

const STYLE = { color: "#0072b2", width: 4 };

describe("le forme", () => {
  it("disegnano la freccia dell'esempio del formato, byte per byte", () => {
    const elem = shapeElem("arrow", "o5e6f7g8h", [420, 200], [700, 420], { color: "#000000", width: 4 }, 4);
    expect(elem).toEqual({
      tag: "path",
      attrs: {
        id: "o5e6f7g8h",
        "fub:shape": "arrow",
        "fub:geom": "420 200 700 420",
        d: "M420 200 L700 420 M682.18 417.45 L700 420 L693.3 403.29",
        fill: "none",
        stroke: "#000000",
        "stroke-width": "4",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    });
  });

  it("calcolano il `d` della freccia dalla geometria già arrotondata", () => {
    const elem = shapeElem("arrow", "a", [10.004, 20.006], [110.333, 20.006], STYLE, 4)!;
    expect(elem.attrs["fub:geom"]).toBe("10 20.01 110.33 20.01");
    expect(elem.attrs.d).toBe(arrowPath(10, 20.01, 110.33, 20.01, 4));
  });

  it("scrivono il rettangolo dal suo angolo in alto a sinistra, in qualunque verso si trascini", () => {
    const elem = shapeElem("rect", "r", [50.126, 80], [10, 20.333], STYLE, 4);
    expect(elem).toEqual({
      tag: "rect",
      attrs: { id: "r", x: "10", y: "20.33", width: "40.13", height: "59.67", fill: "none", stroke: "#0072b2", "stroke-width": "4" },
    });
  });

  it("scrivono l'ellisse dal centro e dai raggi", () => {
    const elem = shapeElem("ellipse", "e", [180, 140], [420, 260], STYLE, 4);
    expect(elem?.attrs).toEqual({ id: "e", cx: "300", cy: "200", rx: "120", ry: "60", fill: "none", stroke: "#0072b2", "stroke-width": "4" });
  });

  it("scrivono la linea con le punte tonde", () => {
    const elem = shapeElem("line", "l", [0, 0], [30, 40], STYLE, 4);
    expect(elem?.attrs).toEqual({ id: "l", x1: "0", y1: "0", x2: "30", y2: "40", stroke: "#0072b2", "stroke-width": "4", "stroke-linecap": "round" });
  });

  it("scartano un tocco, e una forma che arrotondata non si disegnerebbe", () => {
    expect(shapeElem("rect", "r", [10, 10], [12, 13], STYLE, 4)).toBeNull();
    expect(shapeElem("line", "l", [10, 10], [12, 13], STYLE, 4)).toBeNull();
    // Largo, ma alto zero: SVG non lo disegna.
    expect(shapeElem("rect", "r", [10, 10], [50, 10.001], STYLE, 4)).toBeNull();
    expect(shapeElem("ellipse", "e", [10, 10], [50, 10.001], STYLE, 4)).toBeNull();
    // Una linea orizzontale invece sì.
    expect(shapeElem("line", "l", [10, 10], [50, 10], STYLE, 4)).not.toBeNull();
  });

  it("con Maiusc fanno quadrati e cerchi, e linee a passi di 15°", () => {
    expect(constrainEnd("rect", [0, 0], [30, -10])).toEqual([30, -30]);
    expect(constrainEnd("ellipse", [0, 0], [-5, 20])).toEqual([-20, 20]);
    const [x, y] = constrainEnd("line", [0, 0], [100, 30]);
    // 16,7° va a 15°, alla stessa lunghezza.
    expect(Math.atan2(y, x) * (180 / Math.PI)).toBeCloseTo(15, 9);
    expect(Math.hypot(x, y)).toBeCloseTo(Math.hypot(100, 30), 9);
    expect(constrainEnd("arrow", [5, 5], [5, 5])).toEqual([5, 5]);
  });
});

describe("lo strumento Poligono", () => {
  const near = (a: readonly number[], b: readonly number[]): boolean => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-9;

  it("tiene sotto il puntatore il vertice più vicino, con la rotazione più piccola", () => {
    for (const sides of [3, 4, 5, 6, 12]) {
      for (const to of [[30, 40], [-50, 7], [0, -20], [-3, -60], [25, 0]] as const) {
        const shape = polygonDrag([0, 0], to, { ...POLYGON_TOOL, sides }, false)!;
        expect(shape.r).toBeCloseTo(Math.hypot(to[0], to[1]), 12);
        expect(polygonalVertices(shape).some((vertex) => near(vertex, to))).toBe(true);
        expect(Math.abs(shape.rotation)).toBeLessThanOrEqual(180 / sides + 1e-9);
      }
    }
  });

  it("tiene sotto il puntatore una punta della stella", () => {
    const tool = { ...POLYGON_TOOL, shape: "star" as const, points: 7 };
    const shape = polygonDrag([10, 10], [-20, 50], tool, false)!;
    expect(shape).toMatchObject({ shape: "star", count: 7, ratio: tool.ratio, corner: 0 });
    // Le punte sono i vertici pari.
    const tips = polygonalVertices(shape).filter((_, i) => i % 2 === 0);
    expect(tips.some((tip) => near(tip, [-20, 50]))).toBe(true);
  });

  it("con Maiusc resta diritto: il raggio segue il puntatore, la rotazione no", () => {
    const shape = polygonDrag([0, 0], [30, 40], POLYGON_TOOL, true)!;
    expect(shape).toEqual({ shape: "polygon", cx: 0, cy: 0, r: 50, count: 6, ratio: null, rotation: 0, corner: 0 });
    expect(polygonDrag([5, 5], [5, 5], POLYGON_TOOL, false)).toBeNull();
    // Maiusc non sposta la fine, come fa con le altre forme.
    expect(constrainEnd("polygon", [0, 0], [30, 7])).toEqual([30, 7]);
  });

  it("scrive l'esagono, la stella e gli angoli arrotondati come il programma indipendente", () => {
    const straight = { ...POLYGON_TOOL, straight: false };
    // Tirato in alto, un vertice va in alto.
    expect(shapeElem("polygon", "p", [100, 100], [100, 50], STYLE, 4, straight)).toEqual({
      tag: "path",
      attrs: {
        id: "p",
        "fub:shape": "polygon",
        "fub:geom": "100 100 50 6 -30 0",
        d: "M100 150 L56.7 125 L56.7 75 L100 50 L143.3 75 L143.3 125 Z",
        fill: "none",
        stroke: "#0072b2",
        "stroke-width": "4",
      },
    });
    const star = shapeElem("polygon", "s", [0, 0], [0, -40], STYLE, 4, { ...straight, shape: "star" })!;
    expect(star.attrs["fub:geom"]).toBe("0 0 40 5 0.382 0 0");
    expect(star.attrs.d).toBe("M0 -40 L8.98 -12.36 L38.04 -12.36 L14.53 4.72 L23.51 32.36 L0 15.28 L-23.51 32.36 L-14.53 4.72 L-38.04 -12.36 L-8.98 -12.36 Z");
    const rounded = shapeElem("polygon", "r", [0, 0], [30, 40], STYLE, 4, { ...straight, corner: 5, straight: true })!;
    expect(rounded.attrs["fub:geom"]).toBe("0 0 50 6 0 5");
    expect(rounded.attrs.d).toBe(
      "M-22.11 43.3 A5 5 0 0 1 -26.44 40.8 L-48.56 2.5 A5 5 0 0 1 -48.56 -2.5 L-26.44 -40.8 A5 5 0 0 1 -22.11 -43.3 L22.11 -43.3 A5 5 0 0 1 26.44 -40.8 L48.56 -2.5 A5 5 0 0 1 48.56 2.5 L26.44 40.8 A5 5 0 0 1 22.11 43.3 Z",
    );
    const roundedStar = shapeElem("polygon", "t", [0, 0], [0, -40], STYLE, 4, { ...straight, shape: "star", corner: 3 })!;
    expect(roundedStar.attrs.d).toBe(
      "M-2.85 -31.22 A3 3 0 0 1 2.85 -31.22 L8.31 -14.43 A3 3 0 0 0 11.16 -12.36 L28.81 -12.36 A3 3 0 0 1 30.57 -6.93 L16.3 3.44 A3 3 0 0 0 15.21 6.79 L20.66 23.58 A3 3 0 0 1 16.04 26.93 L1.76 16.56 A3 3 0 0 0 -1.76 16.56 L-16.04 26.93 A3 3 0 0 1 -20.66 23.58 L-15.21 6.79 A3 3 0 0 0 -16.3 3.44 L-30.57 -6.93 A3 3 0 0 1 -28.81 -12.36 L-11.16 -12.36 A3 3 0 0 0 -8.31 -14.43 Z",
    );
  });

  it("scarta un tocco: un raggio sotto la misura minima", () => {
    expect(shapeElem("polygon", "p", [0, 0], [2, 2], STYLE, 4)).toBeNull();
    expect(shapeElem("polygon", "p", [0, 0], [3, 3], STYLE, 4)).not.toBeNull();
  });

  it("tiene i lati e le punte a parte, fra 3 e 1000", () => {
    expect(polygonCount(POLYGON_TOOL)).toBe(6);
    expect(polygonCount({ ...POLYGON_TOOL, shape: "star" })).toBe(5);
    expect(withCount(POLYGON_TOOL, 7.6)).toEqual({ ...POLYGON_TOOL, sides: 8 });
    expect(withCount({ ...POLYGON_TOOL, shape: "star" }, 2)).toEqual({ ...POLYGON_TOOL, shape: "star", points: 3 });
    expect(withCount(POLYGON_TOOL, 5000).sides).toBe(1000);
  });

  it("cambia il rapporto della stella ai multipli di 0,05, fra 0,01 e 1", () => {
    expect(stepRatio(0.382, 1)).toBe(0.4);
    expect(stepRatio(0.382, -1)).toBe(0.35);
    expect(stepRatio(0.4, 1)).toBe(0.45);
    expect(stepRatio(0.4, -1)).toBe(0.35);
    expect(stepRatio(1, 1)).toBe(1);
    expect(stepRatio(0.05, -1)).toBe(0.01);
    expect(stepRatio(0.01, 1)).toBe(0.05);
    expect(stepRatio(0.95, 1)).toBe(1);
  });
});
