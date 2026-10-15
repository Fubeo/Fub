// Il riconoscitore delle forme dal tratto, su tratti costruiti a mano: la
// geometria che dà, la tenuta ferma, le forme regolari di `Maiusc`, le forme
// viste attraverso una matrice e gli elementi che scrive. I tratti
// registrati sono nel corpus, in `recognize-corpus.test.ts`.

import { describe, expect, it } from "vitest";
import { apply, compose, rotate, translate, type Matrix, type Point } from "../scene/matrix";
import { polygonalAttrs, polygonalVertices, STAR_RATIO } from "../scene/parametric";
import {
  centerOf,
  heldShape,
  mapped,
  recognize,
  regular,
  shapeOfRecognized,
  similar,
  starOf,
  stillFrom,
  type Recognized,
} from "./recognize";
import { constrainEnd, shapeElem } from "./shapes";

const STYLE = { color: "#1f1f1f", width: 3 };

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/// Il tratto lungo `corners`, un punto ogni `step` unità circa, con un
/// tremito regolare di `wobble` unità di traverso.
function trace(corners: readonly Point[], wobble = 0, step = 2): Point[] {
  const out: Point[] = [];
  for (let k = 0; k + 1 < corners.length; k++) {
    const [ax, ay] = corners[k]!;
    const [bx, by] = corners[k + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    const count = Math.max(1, Math.round(length / step));
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const across = wobble * Math.sin(out.length * 0.9);
      out.push([ax + (bx - ax) * t - ((by - ay) / length) * across, ay + (by - ay) * t + ((bx - ax) / length) * across]);
    }
  }
  out.push(corners[corners.length - 1]!);
  return out;
}

/// I punti di un'ellisse girata di `angle` gradi, da `start` gradi per
/// `sweep` gradi.
function oval(center: Point, rx: number, ry: number, angle: number, start = 0, sweep = 360): Point[] {
  const m = compose(translate(center[0], center[1]), rotate(angle));
  return Array.from({ length: 181 }, (_, i): Point => {
    const t = radians(start + (sweep * i) / 180);
    return apply(m, [rx * Math.cos(t), ry * Math.sin(t)]);
  });
}

/// `points` girati di `angle` gradi attorno a `center`.
function turned(points: readonly Point[], center: Point, angle: number): Point[] {
  const m = compose(translate(center[0], center[1]), compose(rotate(angle), translate(-center[0], -center[1])));
  return points.map((p) => apply(m, p));
}

const near = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/// Quanto il punto di `points` più lontano dal suo vicino in `others` ne
/// dista: 0 se i due insiemi coincidono.
function apart(points: readonly Point[], others: readonly Point[]): number {
  let worst = 0;
  for (const p of points) worst = Math.max(worst, Math.min(...others.map((q) => near(p, q))));
  return worst;
}

const RECT: Point[] = [[100, 100], [400, 100], [400, 300], [100, 300], [100, 100]];

describe("il riconoscimento", () => {
  it("riconosce il rettangolo diritto coi suoi lati", () => {
    const shape = recognize(trace(RECT, 1));
    expect(shape?.kind).toBe("rect");
    if (shape?.kind !== "rect") return;
    expect(near(shape.center, [250, 200])).toBeLessThan(2);
    expect(shape.width).toBeCloseTo(300, -1);
    expect(shape.height).toBeCloseTo(200, -1);
    expect(shape.angle).toBe(0);
  });

  it("riconosce il rettangolo girato, e lo raddrizza se è storto di poco", () => {
    const shape = recognize(trace(turned(RECT, [250, 200], 30), 1));
    expect(shape?.kind).toBe("rect");
    if (shape?.kind !== "rect") return;
    expect(shape.angle).toBeCloseTo(30, 0);
    expect(shape.width).toBeCloseTo(300, -1);
    expect(shape.height).toBeCloseTo(200, -1);
    const crooked = recognize(trace(turned(RECT, [250, 200], 5), 1));
    expect(crooked?.kind === "rect" && crooked.angle).toBe(0);
  });

  it("riconosce l'ellisse girata, e il cerchio quando gli assi sono quasi uguali", () => {
    const shape = recognize(oval([300, 200], 150, 80, 20));
    expect(shape?.kind).toBe("ellipse");
    if (shape?.kind !== "ellipse") return;
    expect(near(shape.center, [300, 200])).toBeLessThan(1);
    expect(shape.rx).toBeCloseTo(150, -1);
    expect(shape.ry).toBeCloseTo(80, -1);
    expect(shape.angle).toBeCloseTo(20, 0);
    // Storta di 95°: l'asse lungo è quasi verticale, e diventa `ry`.
    const upright = recognize(oval([300, 200], 150, 80, 95));
    expect(upright?.kind === "ellipse" && [upright.angle, upright.rx < upright.ry]).toEqual([0, true]);
    const circle = recognize(oval([300, 200], 100, 95, 30));
    expect(circle?.kind).toBe("ellipse");
    if (circle?.kind !== "ellipse") return;
    expect(circle.rx).toBe(circle.ry);
    expect(circle.rx).toBeCloseTo(97.5, 0);
    expect(circle.angle).toBe(0);
  });

  it("riconosce il triangolo dagli incroci delle rette dei lati", () => {
    const corners: Point[] = [[100, 400], [300, 80], [520, 400]];
    const shape = recognize(trace([...corners, corners[0]!], 1.5));
    expect(shape?.kind).toBe("polygon");
    if (shape?.kind !== "polygon") return;
    expect(shape.points).toHaveLength(3);
    expect(apart(corners, shape.points)).toBeLessThan(4);
  });

  it("riconosce la stella disegnata senza staccare", () => {
    const tips = Array.from({ length: 5 }, (_, k): Point => [300 + 150 * Math.cos(radians(270 + 144 * k)), 250 + 150 * Math.sin(radians(270 + 144 * k))]);
    const shape = recognize(trace([...tips, tips[0]!], 1));
    expect(shape?.kind).toBe("polygon");
    if (shape?.kind !== "polygon") return;
    expect(starOf(shape.points)).toEqual({ count: 5, step: 2 });
    expect(apart(tips, shape.points)).toBeLessThan(5);
  });

  it("riconosce la linea, anche tremante, dai suoi capi", () => {
    const shape = recognize(trace([[50, 50], [450, 120]], 1.5));
    expect(shape?.kind).toBe("line");
    if (shape?.kind !== "line") return;
    expect(near(shape.from, [50, 50])).toBeLessThan(3);
    expect(near(shape.to, [450, 120])).toBeLessThan(3);
  });

  it("riconosce la freccia dall'asta, con la punta disegnata dopo", () => {
    const shape = recognize(trace([[100, 300], [500, 300], [460, 275], [500, 300], [460, 325]], 0.5));
    expect(shape?.kind).toBe("arrow");
    if (shape?.kind !== "arrow") return;
    expect(near(shape.from, [100, 300])).toBeLessThan(3);
    expect(near(shape.to, [500, 300])).toBeLessThan(3);
  });

  it("lascia inchiostro ciò che non somiglia a una forma", () => {
    expect(recognize(oval([300, 200], 150, 150, 0, 0, 120))).toBeNull();
    expect(recognize(trace([[0, 0], [60, 100], [120, 0], [180, 100], [240, 0]]))).toBeNull();
    expect(recognize(trace([[100, 100], [300, 300], [300, 100], [100, 300], [100, 100]]))).toBeNull();
    expect(recognize(trace([[100, 100], [400, 100], [400, 300]]))).toBeNull();
    expect(recognize([[10, 10], [10, 10]])).toBeNull();
    expect(recognize([])).toBeNull();
  });

  it("dà la stessa forma allo stesso tratto", () => {
    const stroke = trace(turned(RECT, [250, 200], 23), 1.2);
    expect(recognize(stroke)).toEqual(recognize([...stroke]));
  });
});

describe("la tenuta ferma", () => {
  it("lascia inchiostro i tratti piccoli sullo schermo, quanto la scrittura", () => {
    const small = trace([[10, 10], [40, 10], [40, 30], [10, 30], [10, 10]], 0, 1);
    expect(heldShape(small, 1, 4)).toBeNull();
    expect(heldShape(small, 2, 4)?.kind).toBe("rect");
  });

  it("non conta il tremito della mano ferma alla fine", () => {
    const line = trace([[50, 50], [450, 120]], 1);
    const still = Array.from({ length: 60 }, (_, k): Point => [450 + 1.5 * Math.sin(k * 1.7), 120 + 1.5 * Math.cos(k * 2.3)]);
    const shape = heldShape([...line, ...still], 1, 4);
    expect(shape?.kind).toBe("line");
    expect(shape?.kind === "line" && near(shape.to, [450, 120])).toBeLessThan(3);
  });

  it("trova dove la mano si è fermata", () => {
    expect(stillFrom([[0, 0], [10, 0], [11, 0], [10, 1]], 2)).toBe(1);
    expect(stillFrom([[0, 0], [1, 0]], 2)).toBe(0);
    expect(stillFrom([[0, 0]], 2)).toBe(0);
  });
});

describe("la forma regolare, con Maiusc", () => {
  it("fa del rettangolo un quadrato, girato a passi di 15°", () => {
    const rect: Recognized = { kind: "rect", center: [0, 0], width: 200, height: 180, angle: 7 };
    expect(regular(rect)).toEqual({ ...rect, width: 190, height: 190, angle: 0 });
    expect(regular({ ...rect, angle: 10 })).toEqual({ ...rect, width: 190, height: 190, angle: 15 });
    expect(regular({ ...rect, angle: 85 })).toEqual({ ...rect, width: 190, height: 190, angle: 0 });
  });

  it("fa dell'ellisse un cerchio", () => {
    expect(regular({ kind: "ellipse", center: [5, 6], rx: 120, ry: 80, angle: 33 })).toEqual({ kind: "ellipse", center: [5, 6], rx: 100, ry: 100, angle: 0 });
  });

  it("porta la linea e la freccia a passi di 15°, come i loro strumenti", () => {
    const line: Recognized = { kind: "line", from: [0, 0], to: [100, 8] };
    expect(regular(line)).toEqual({ ...line, to: constrainEnd("line", [0, 0], [100, 8]) });
    expect(regular({ kind: "arrow", from: [0, 0], to: [70, 64] })).toEqual({ kind: "arrow", from: [0, 0], to: constrainEnd("line", [0, 0], [70, 64]) });
  });

  it("fa di un pentagono storto il pentagono regolare più vicino", () => {
    const drawn = polygonalVertices({ shape: "polygon", cx: 300, cy: 200, r: 100, count: 5, ratio: null, rotation: 4, corner: 0 })
      .map(([x, y], k): Point => [x + [2, -1, 1, -2, 0][k]!, y + [1, 2, -2, 0, -1][k]!]);
    const shape = regular({ kind: "polygon", points: drawn });
    expect(shape.kind).toBe("regular");
    if (shape.kind !== "regular") return;
    expect([shape.count, shape.ratio, shape.angle]).toEqual([5, null, 0]);
    expect(near(shape.center, [300, 200])).toBeLessThan(1);
    expect(shape.r).toBeCloseTo(100, 0);
    const tilted = regular({ kind: "polygon", points: turned(drawn, [300, 200], 9) });
    expect(tilted.kind === "regular" && tilted.angle).toBe(15);
  });

  it("fa della stella disegnata la stella coi lati in linea a due a due", () => {
    const tips = Array.from({ length: 5 }, (_, k): Point => [300 + 150 * Math.cos(radians(272 + 144 * k)), 250 + 150 * Math.sin(radians(272 + 144 * k))]);
    const shape = regular({ kind: "polygon", points: tips });
    expect(shape.kind).toBe("regular");
    if (shape.kind !== "regular") return;
    expect([shape.count, shape.angle]).toEqual([5, 0]);
    expect(shape.ratio).toBeCloseTo(STAR_RATIO, 3);
    expect(shape.r).toBeCloseTo(150, 6);
  });

  it("fa di un quadrilatero quasi quadrato un quadrato", () => {
    const shape = regular({ kind: "polygon", points: [[0, 0], [102, 1], [100, 99], [-1, 100]] });
    expect(shape.kind).toBe("rect");
    if (shape.kind !== "rect") return;
    expect(shape.width).toBe(shape.height);
    expect(shape.width).toBeCloseTo(100, -1);
    expect(shape.angle).toBe(0);
  });
});

describe("la forma vista attraverso una matrice", () => {
  const spin: Matrix = compose(translate(10, 20), compose(rotate(30), [2, 0, 0, 2, 0, 0]));
  const flip: Matrix = [-1, 0, 0, 1, 600, 0];

  it("sposta, gira e scala il rettangolo e l'ellisse", () => {
    const rect = mapped({ kind: "rect", center: [100, 50], width: 40, height: 20, angle: 160 }, spin);
    expect(rect?.kind).toBe("rect");
    if (rect?.kind !== "rect") return;
    expect(near(rect.center, apply(spin, [100, 50]))).toBeLessThan(1e-9);
    expect([rect.width, rect.height]).toEqual([80, 40]);
    expect(rect.angle).toBeCloseTo(10, 9);
    const ellipse = mapped({ kind: "ellipse", center: [0, 0], rx: 50, ry: 20, angle: 25 }, flip);
    // Gli angoli si scrivono fra −90 escluso e 90: 155° è −25°.
    expect(ellipse?.kind === "ellipse" && ellipse.angle).toBeCloseTo(-25, 9);
  });

  it("ribalta il poligono regolare e la stella con i vertici al loro posto", () => {
    for (const shape of [
      { kind: "regular", center: [200, 100], r: 80, count: 5, angle: 10, ratio: null },
      { kind: "regular", center: [200, 100], r: 80, count: 7, angle: 4, ratio: 0.5 },
    ] as const) {
      const vertices = (s: Recognized): Point[] =>
        s.kind === "regular"
          ? polygonalVertices({ shape: s.ratio === null ? "polygon" : "star", cx: s.center[0], cy: s.center[1], r: s.r, count: s.count, ratio: s.ratio, rotation: s.angle, corner: 0 })
          : [];
      for (const m of [flip, spin, compose(spin, flip)]) {
        const seen = mapped(shape, m)!;
        expect(apart(vertices(shape).map((p) => apply(m, p)), vertices(seen))).toBeLessThan(1e-6);
      }
    }
  });

  it("non vede una forma attraverso una matrice che la deforma", () => {
    expect(mapped({ kind: "ellipse", center: [0, 0], rx: 50, ry: 20, angle: 0 }, [2, 0, 0, 1, 0, 0])).toBeNull();
    expect(mapped({ kind: "line", from: [0, 0], to: [1, 1] }, [1, 0, 0.5, 1, 0, 0])).toBeNull();
  });

  it("gira e scala attorno al centro dato", () => {
    const shape = similar({ kind: "ellipse", center: [100, 100], rx: 50, ry: 20, angle: 0 }, [100, 100], 2, 90);
    expect(shape).toEqual({ kind: "ellipse", center: [100, 100], rx: 100, ry: 40, angle: 90 });
    expect(centerOf({ kind: "line", from: [0, 0], to: [10, 4] })).toEqual([5, 2]);
    expect(centerOf({ kind: "polygon", points: [[0, 0], [6, 0], [0, 6]] })).toEqual([2, 2]);
  });
});

describe("gli elementi delle forme", () => {
  it("scrivono il rettangolo e l'ellisse come i loro strumenti, girati dal `transform`", () => {
    expect(shapeOfRecognized({ kind: "rect", center: [100, 50], width: 120, height: 60, angle: 0 }, "o1", STYLE)).toEqual({
      tag: "rect",
      attrs: { id: "o1", x: "40", y: "20", width: "120", height: "60", fill: "none", stroke: "#1f1f1f", "stroke-width": "3" },
    });
    const rect = shapeOfRecognized({ kind: "rect", center: [100, 50], width: 120, height: 60, angle: 30 }, "o1", STYLE);
    expect(rect?.attrs.transform).toBe("matrix(0.866 0.5 -0.5 0.866 38.3975 -43.3013)");
    const framed = shapeOfRecognized({ kind: "rect", center: [100, 50], width: 120, height: 60, angle: 30 }, "o1", STYLE, translate(5, 5));
    expect(framed?.attrs.transform).toBe("matrix(0.866 0.5 -0.5 0.866 43.3975 -38.3013)");
    expect(shapeOfRecognized({ kind: "ellipse", center: [100, 50], rx: 30, ry: 30, angle: 0 }, "o2", STYLE, translate(5, 5))).toEqual({
      tag: "ellipse",
      attrs: { id: "o2", cx: "100", cy: "50", rx: "30", ry: "30", fill: "none", stroke: "#1f1f1f", "stroke-width": "3", transform: "matrix(1 0 0 1 5 5)" },
    });
  });

  it("scrivono la linea e la freccia come i loro strumenti", () => {
    expect(shapeOfRecognized({ kind: "arrow", from: [10, 20], to: [200.004, 20] }, "o3", STYLE)).toEqual(shapeElem("arrow", "o3", [10, 20], [200.004, 20], STYLE, 0));
    expect(shapeOfRecognized({ kind: "line", from: [10, 20], to: [200, 90] }, "o4", STYLE)?.tag).toBe("line");
  });

  it("scrivono il poligono regolare e la stella come lo strumento Poligono", () => {
    const shape: Recognized = { kind: "regular", center: [300, 200], r: 100, count: 7, angle: 375, ratio: 0.5 };
    expect(shapeOfRecognized(shape, "o5", STYLE)).toEqual({
      tag: "path",
      attrs: {
        id: "o5",
        ...polygonalAttrs({ shape: "star", cx: 300, cy: 200, r: 100, count: 7, ratio: 0.5, rotation: 15, corner: 0 })!,
        fill: "none",
        stroke: "#1f1f1f",
        "stroke-width": "3",
      },
    });
  });

  it("scrivono un poligono qualunque coi suoi vertici, e niente se non ha area", () => {
    expect(shapeOfRecognized({ kind: "polygon", points: [[100, 400], [300.126, 80], [520, 400]] }, "o6", STYLE)).toEqual({
      tag: "polygon",
      attrs: { id: "o6", points: "100,400 300.13,80 520,400", fill: "none", stroke: "#1f1f1f", "stroke-width": "3" },
    });
    expect(shapeOfRecognized({ kind: "polygon", points: [[0, 0], [10, 10.001], [20, 20]] }, "o7", STYLE)).toBeNull();
  });
});
