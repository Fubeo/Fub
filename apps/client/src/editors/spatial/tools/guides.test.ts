import { describe, expect, it } from "vitest";

import type { Bounds } from "../scene/geometry";
import { anchorsOf, GuideIndex, measure, nearer, type GuideTarget } from "./guides";

const box = (x: number, y: number, width: number, height: number): Bounds => ({ min: [x, y], max: [x + width, y + height] });
const object = (key: string, b: Bounds): GuideTarget => ({ kind: "object", box: b, key });
const PAGE: GuideTarget = { kind: "page", box: box(0, 0, 1600, 1000), key: "" };

describe("i bersagli", () => {
  const index = new GuideIndex([object("a", box(100, 100, 50, 20)), object("b", box(300, 400, 10, 10)), PAGE]);

  it("trovano il valore più vicino entro la soglia, lungo ciascun asse", () => {
    expect(index.nearest(0, 103, 5)).toBe(100);
    expect(index.nearest(0, 126, 5)).toBe(125);
    expect(index.nearest(0, 112, 5)).toBeNull();
    expect(index.nearest(1, 404, 5)).toBe(405);
    expect(index.nearest(1, 997, 5)).toBe(1000);
    expect(index.nearest(0, -4, 5)).toBe(0);
  });

  it("senza bersagli non trovano niente", () => {
    expect(new GuideIndex([]).nearest(0, 0, 100)).toBeNull();
  });

  it("un nodo è un punto, e un riquadro senza misura ha il centro soltanto", () => {
    const flat = new GuideIndex([{ kind: "node", box: { min: [7, 9], max: [7, 9] }, key: "" }, object("linea", box(20, 50, 100, 0))]);
    expect(flat.nearest(0, 6, 2)).toBe(7);
    expect(flat.nearest(1, 51, 2)).toBe(50);
    expect(anchorsOf(box(20, 50, 100, 0), 1)).toEqual([{ value: 50, edge: "mid" }]);
    expect(anchorsOf(box(20, 50, 100, 10), 1)).toEqual([
      { value: 50, edge: "min" },
      { value: 55, edge: "mid" },
      { value: 60, edge: "max" },
    ]);
  });

  it("lo scarto più piccolo fra le àncore vince", () => {
    // Il bordo sinistro a 97 è a 3 da 100, il destro a 152 a 2 da 150.
    expect(index.snap(0, [97, 124.5, 152], 5)).toBe(0.5);
    expect(index.snap(0, [97, 130, 160], 5)).toBe(3);
    expect(index.snap(0, [90, 131, 160], 5)).toBeNull();
  });

  it("fra un bersaglio e la riga vince il più vicino, a pari distanza il bersaglio", () => {
    expect(nearer(103, 100, 105)).toBe(105);
    expect(nearer(103, 101, 105)).toBe(101);
    expect(nearer(103, 101, 101)).toBe(101);
    expect(nearer(103, 105, 101)).toBe(105);
    expect(nearer(103, null, 100)).toBe(100);
    expect(nearer(103, 104, null)).toBe(104);
    expect(nearer(103, null, null)).toBe(103);
  });
});

describe("le linee", () => {
  it("passano per i bordi in linea, col segno ai capi, e dicono lo spazio dall'oggetto più vicino", () => {
    const index = new GuideIndex([object("sopra", box(100, 20, 40, 30)), object("lontano", box(100, 500, 10, 10)), PAGE]);
    const moving = box(100, 100, 60, 40);
    const [line, ...rest] = index.lines(0, moving, anchorsOf(moving, 0));
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ axis: 0, value: 100, from: 20, to: 510, source: "min", edge: "min", gap: [50, 100] });
    expect(line!.target.key).toBe("sopra");
    expect([...line!.marks].sort((a, b) => a - b)).toEqual([20, 50, 100, 140, 500, 510]);
  });

  it("un centro ha il segno nel centro, e la pagina viene dopo gli oggetti", () => {
    const index = new GuideIndex([PAGE, object("accanto", box(900, 470, 20, 60))]);
    const moving = box(700, 480, 40, 40);
    const lines = index.lines(1, moving, anchorsOf(moving, 1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ axis: 1, value: 500, source: "mid", edge: "mid", gap: [740, 900] });
    expect(lines[0]!.target.key).toBe("accanto");
    expect([...lines[0]!.marks].sort((a, b) => a - b)).toEqual([720, 800, 910]);
  });

  it("solo con la pagina, la linea non ha spazio scritto", () => {
    const index = new GuideIndex([PAGE]);
    const moving = box(0, 300, 40, 40);
    const [line] = index.lines(0, moving, anchorsOf(moving, 0));
    expect(line).toMatchObject({ value: 0, edge: "min", gap: null, from: 0, to: 1000 });
    expect(line!.target.kind).toBe("page");
  });

  it("valgono entro mezzo centesimo, la geometria scritta a due decimali", () => {
    const index = new GuideIndex([object("terzi", box(10, 0, 100 / 3, 10))]);
    expect(index.lines(0, box(43.33, 50, 10, 10), [{ value: 43.33, edge: "min" }])).toHaveLength(1);
    expect(index.lines(0, box(43.32, 50, 10, 10), [{ value: 43.32, edge: "min" }])).toHaveLength(0);
  });

  it("nessuna linea senza bersagli sul valore", () => {
    const index = new GuideIndex([object("a", box(0, 0, 10, 10))]);
    expect(index.lines(0, box(30, 30, 5, 5), anchorsOf(box(30, 30, 5, 5), 0))).toEqual([]);
  });

  it("tanti oggetti sullo stesso valore ci sono tutti, ciascuno coi suoi segni", () => {
    // Una colonna allineata a sinistra, elencata in disordine, e lo zero
    // anche col segno meno.
    const index = new GuideIndex([
      object("c", box(10, 200, 30, 10)),
      object("a", box(10, 0, 10, 10)),
      object("b", box(10, 100, 20, 10)),
      object("meno", box(-0, 400, 5, 5)),
      object("più", box(0, 500, 5, 5)),
    ]);
    const [line, ...rest] = index.lines(0, box(10, 300, 5, 10), [{ value: 10, edge: "min" }]);
    expect(rest).toEqual([]);
    expect(line!.target.key).toBe("c");
    expect([...line!.marks].sort((a, b) => a - b)).toEqual([0, 10, 100, 110, 200, 210, 300, 310]);
    const [zero] = index.lines(0, box(0, 450, 5, 5), [{ value: 0, edge: "min" }]);
    expect([...zero!.marks].sort((a, b) => a - b)).toEqual([400, 405, 450, 455, 500, 505]);
  });
});

describe("le distanze uguali", () => {
  // Tre oggetti in fila, a 20 l'uno dall'altro, e uno sotto lo sfondo.
  const ROW = [object("a", box(0, 0, 40, 40)), object("b", box(60, 0, 40, 40)), object("c", box(120, 0, 40, 40))];

  it("dopo l'ultimo della fila, lo stesso spazio che c'è fra gli altri", () => {
    const index = new GuideIndex(ROW);
    expect(index.spaceSnap(0, box(183, 10, 30, 20), 5)).toBe(-3);
    expect(index.spaceSnap(0, box(190, 10, 30, 20), 5)).toBeNull();
    const spacing = index.spacing(0, box(180, 10, 30, 20))!;
    expect(spacing.gap).toBe(20);
    expect(spacing.gaps.map(({ from, to }) => [from, to])).toEqual([
      [160, 180],
      [40, 60],
      [100, 120],
    ]);
    expect(spacing.gaps[0]!.across).toBe(20);
  });

  it("prima del primo, e a metà fra due vicini", () => {
    const index = new GuideIndex(ROW);
    expect(index.spaceSnap(0, box(-48, 0, 30, 30), 5)).toBe(-2);
    const apart = new GuideIndex([object("a", box(0, 0, 40, 40)), object("c", box(140, 0, 40, 40))]);
    // Fra 40 e 140 sta un oggetto largo 30: a metà resta 35 per parte.
    expect(apart.spaceSnap(0, box(73, 0, 30, 30), 5)).toBe(2);
    const spacing = apart.spacing(0, box(75, 0, 30, 30))!;
    expect(spacing.gap).toBe(35);
    expect(spacing.gaps.map(({ from, to }) => [from, to])).toEqual([
      [40, 75],
      [105, 140],
    ]);
  });

  it("valgono anche in verticale", () => {
    const index = new GuideIndex([object("a", box(0, 0, 40, 40)), object("b", box(0, 50, 40, 40))]);
    expect(index.spaceSnap(1, box(10, 98, 20, 20), 5)).toBe(2);
    expect(index.spacing(1, box(10, 100, 20, 20))?.gap).toBe(10);
  });

  it("un oggetto sotto la selezione, come uno sfondo, non è un vicino", () => {
    const index = new GuideIndex([object("sfondo", box(-20, -20, 300, 100)), ...ROW]);
    expect(index.spaceSnap(0, box(183, 10, 30, 20), 5)).toBe(-3);
  });

  it("solo gli oggetti della stessa fila contano", () => {
    const index = new GuideIndex([...ROW, object("sotto", box(220, 200, 40, 40))]);
    expect(index.spaceSnap(0, box(183, 10, 30, 20), 5)).toBe(-3);
    // Fuori dalla fila, sotto, non ci sono spazi.
    expect(index.spaceSnap(0, box(183, 300, 30, 20), 5)).toBeNull();
  });

  it("spazi diversi non sono distanze uguali", () => {
    const index = new GuideIndex(ROW);
    expect(index.spacing(0, box(185, 10, 30, 20))).toBeNull();
  });
});

describe("le misure con Alt", () => {
  it("fra due riquadri staccati, lo spazio fra i bordi che si guardano, a metà della parte in comune", () => {
    expect(measure(box(0, 0, 40, 40), box(100, 20, 40, 40))).toEqual({
      measures: [{ from: [40, 30], to: [100, 30], value: 60 }],
      extensions: [],
    });
  });

  it("in diagonale, una misura per asse, all'altezza del centro della selezione, e i bordi prolungati", () => {
    expect(measure(box(0, 0, 40, 40), box(100, 100, 20, 20))).toEqual({
      measures: [
        { from: [40, 20], to: [100, 20], value: 60 },
        { from: [20, 40], to: [20, 100], value: 60 },
      ],
      extensions: [
        [
          [100, 100],
          [100, 20],
        ],
        [
          [100, 100],
          [20, 100],
        ],
      ],
    });
  });

  it("dentro un altro, le quattro distanze dai suoi lati", () => {
    expect(measure(box(10, 20, 40, 40), PAGE.box).measures).toEqual([
      { from: [10, 40], to: [0, 40], value: 10 },
      { from: [50, 40], to: [1600, 40], value: 1550 },
      { from: [30, 20], to: [30, 0], value: 20 },
      { from: [30, 60], to: [30, 1000], value: 940 },
    ]);
  });

  it("i bordi che coincidono non si misurano", () => {
    expect(measure(box(0, 0, 40, 40), box(40, 0, 40, 40)).measures).toEqual([]);
  });
});
