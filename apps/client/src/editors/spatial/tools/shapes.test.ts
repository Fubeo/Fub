// Le forme dell'Essenziale: gli elementi che l'`add` scrive, con la
// geometria arrotondata come la scrive il file (formato della scena, §4, §6
// e l'esempio di §13).

import { describe, expect, it } from "vitest";
import { arrowPath, constrainEnd, shapeElem } from "./shapes";

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
