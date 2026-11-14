// Le forme dal tratto sulla lavagna (T87): le sei forme e il tratto che non è
// una forma, la misura della scrittura, i campioni della forma, Maiusc e il
// righello nella guida del tratto.
import { describe, expect, it } from "vitest";
import { INK_MAX_SAMPLES, type InkSample } from "../../ink/sample";
import type { Point } from "../spatial/scene/matrix";
import { RULER_WIDTH_PX } from "../spatial/tools/ruler";
import { HOLD_MIN_PX, inkShapeOf, outlinePoints, shapeKind, shapeOutline, shapeSamples, StrokeGuide, type Recognized, type StrokeGuideOptions } from "./ink-shapes";

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Il tratto lungo `corners`, un punto ogni `step` unità circa, con un tremito di `wobble` unità. */
function trace(corners: readonly Point[], wobble = 0, step = 2): Point[] {
  const out: Point[] = [];
  for (let k = 0; k + 1 < corners.length; k++) {
    const [ax, ay] = corners[k]!;
    const [bx, by] = corners[k + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    const count = Math.max(1, Math.round(length / step));
    for (let i = 0; i < count; i++) {
      const f = i / count;
      const across = wobble * Math.sin(out.length * 0.9);
      out.push([ax + (bx - ax) * f - ((by - ay) / length) * across, ay + (by - ay) * f + ((bx - ax) / length) * across]);
    }
  }
  out.push(corners[corners.length - 1]!);
  return out;
}

/** I punti di un'ellisse girata di `angle` gradi, per `sweep` gradi. */
function oval(center: Point, rx: number, ry: number, angle: number, sweep = 360): Point[] {
  const a = radians(angle);
  return Array.from({ length: 181 }, (_, i): Point => {
    const u = radians((sweep * i) / 180);
    const [x, y] = [rx * Math.cos(u), ry * Math.sin(u)];
    return [center[0] + x * Math.cos(a) - y * Math.sin(a), center[1] + x * Math.sin(a) + y * Math.cos(a)];
  });
}

/** Il tratto tenuto fermo alla fine: l'ultimo punto ripetuto, con un tremito di mezza unità. */
function held(points: readonly Point[]): Point[] {
  const [x, y] = points[points.length - 1]!;
  return [...points, [x + 0.5, y], [x, y + 0.5], [x, y]];
}

const samples = (points: readonly Point[], p = 0.5): InkSample[] => points.map(([x, y], i) => ({ x, y, t: i * 8, p }));

const TIPS = Array.from({ length: 5 }, (_, k): Point => [300 + 150 * Math.cos(radians(270 + 144 * k)), 250 + 150 * Math.sin(radians(270 + 144 * k))]);
const SIX: ReadonlyArray<readonly [string, Point[]]> = [
  ["line", trace([[50, 50], [450, 120]], 1.5)],
  ["arrow", trace([[100, 300], [500, 300], [460, 275], [500, 300], [460, 325]], 0.5)],
  ["rect", trace([[100, 100], [400, 100], [400, 300], [100, 300], [100, 100]], 1)],
  ["ellipse", oval([300, 200], 150, 80, 20)],
  ["polygon", trace([[100, 400], [300, 80], [520, 400], [100, 400]], 1.5)],
  ["star", trace([...TIPS, TIPS[0]!], 1)],
];

describe("le forme dal tratto", () => {
  it.each(SIX)("riconosce %s dal tratto tenuto fermo", (kind, points) => {
    const shape = inkShapeOf(held(points), 1, 4);
    expect(shape).not.toBeNull();
    expect(shapeKind(shape!)).toBe(kind);
  });

  it("un tratto che non è nessuna forma resta com'è", () => {
    // Un arco di un terzo di giro e uno scarabocchio che va su e giù.
    expect(inkShapeOf(held(oval([300, 200], 150, 150, 0, 120)), 1, 4)).toBeNull();
    const scribble = trace([[0, 0], [60, 80], [120, 0], [180, 80], [240, 0], [300, 80]], 0);
    expect(inkShapeOf(held(scribble), 1, 4)).toBeNull();
  });

  it("sotto HOLD_MIN_PX sullo schermo niente forma: conta lo zoom", () => {
    const small = trace([[0, 0], [30, 0], [30, 20], [0, 20], [0, 0]], 0, 1);
    expect(inkShapeOf(held(small), 1, 4)).toBeNull();
    // Lo stesso rettangolo, a zoom 2, è largo 60 pixel: una forma.
    expect(30 * 2).toBeGreaterThan(HOLD_MIN_PX);
    expect(shapeKind(inkShapeOf(held(small), 2, 4)!)).toBe("rect");
  });
});

describe("i campioni della forma", () => {
  it("il contorno chiuso torna al primo vertice e tiene ogni vertice; nessuno oltre il limite", () => {
    const rect: Recognized = { kind: "rect", center: [100, 100], width: 200, height: 100, angle: 0 };
    const outline = shapeOutline(rect, 4);
    expect(outline.closed).toBe(true);
    const points = outlinePoints(outline);
    expect(points[0]).toEqual(points[points.length - 1]);
    for (const vertex of outline.points) expect(points).toContainEqual(vertex);
    expect(points.length).toBeLessThanOrEqual(INK_MAX_SAMPLES);
    // Fitto: al più un passo e mezzo fra due punti.
    for (let i = 1; i < points.length; i++) {
      expect(Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])).toBeLessThanOrEqual(1.5 + 1e-9);
    }
    expect(outlinePoints(outline, 12).length).toBeLessThanOrEqual(12);
  });

  it("la freccia è l'asta e la punta in un tratto solo, con la punta del disegno", () => {
    const outline = shapeOutline({ kind: "arrow", from: [0, 0], to: [200, 0] }, 4);
    expect(outline.closed).toBe(false);
    expect(outline.points).toHaveLength(5);
    expect(outline.points[1]).toEqual([200, 0]);
    expect(outline.points[3]).toEqual([200, 0]);
    // La punta lunga 3 × 4 + 6 = 18, a 30° dall'asta.
    const [x, y] = outline.points[2]!;
    expect(Math.hypot(200 - x, y)).toBeCloseTo(18, 6);
  });

  it("la stella ha punte e vertici interni, il poligono regolare i suoi lati", () => {
    expect(shapeOutline({ kind: "regular", center: [0, 0], r: 100, count: 5, angle: 0, ratio: 0.4 }, 4).points).toHaveLength(10);
    expect(shapeOutline({ kind: "regular", center: [0, 0], r: 100, count: 6, angle: 0, ratio: null }, 4).points).toHaveLength(6);
  });

  it("pressione mediana, inclinazione del primo campione, tempo sempre in avanti da 0", () => {
    const like: InkSample[] = [
      { x: 0, y: 0, t: 0, p: 0.2, a: 60, z: 90 },
      { x: 10, y: 0, t: 8, p: 0.6, a: 50, z: 80 },
      { x: 20, y: 0, t: 16, p: 0.5, a: 40, z: 70 },
    ];
    const out = shapeSamples({ kind: "line", from: [0, 0], to: [100, 0] }, like, 4);
    expect(out[0]).toMatchObject({ x: 0, y: 0, t: 0, p: 0.5, a: 60, z: 90 });
    for (let i = 1; i < out.length; i++) expect(out[i]!.t).toBeGreaterThan(out[i - 1]!.t);
    expect(out.every((sample) => sample.p === 0.5)).toBe(true);
    // Il mouse non ha pressione: la forma nemmeno.
    expect(shapeSamples({ kind: "line", from: [0, 0], to: [100, 0] }, [{ x: 0, y: 0, t: 0 }], 4)[0]!.p).toBeUndefined();
  });
});

describe("la guida del tratto", () => {
  const options = (over: Partial<StrokeGuideOptions> = {}): StrokeGuideOptions => ({
    pointer: "pen",
    tool: "pen",
    size: 4,
    zoom: 1,
    ruler: null,
    continued: false,
    shift: () => false,
    ...over,
  });

  it("il mezzo secondo riparte solo quando la punta esce dal punto fermo", () => {
    const guide = new StrokeGuide(options());
    expect(guide.add(samples([[0, 0]]))).toBe(true);
    expect(guide.add(samples([[2, 0], [0, 2]]))).toBe(false);
    expect(guide.add(samples([[10, 0]]))).toBe(true);
  });

  it("la penna ferma fa la forma: la scia la mostra, l'alzata scrive il tratto e poi lei", () => {
    const guide = new StrokeGuide(options());
    const stroke = samples(held(SIX[2]![1]));
    guide.add(stroke);
    expect(guide.trail(stroke, [])).toBeNull();
    expect(guide.hold()).toBe(true);
    expect(guide.shaped).toBe(true);
    const trail = guide.trail(stroke, []);
    expect(trail?.whole).toBe(true);
    const done = guide.finish(stroke, false);
    expect(done.samples).toBe(stroke);
    expect(done.shape).toEqual(trail!.samples);
    // Spezzato al limite, il tratto resta inchiostro.
    expect(guide.finish(stroke, true).shape).toBeNull();
  });

  it("l'evidenziatore, un pezzo che continua e un tratto che non somiglia a niente non fanno forme", () => {
    const stroke = samples(held(SIX[2]![1]));
    for (const over of [{ tool: "highlighter" }, { continued: true }]) {
      const guide = new StrokeGuide(options(over));
      guide.add(stroke);
      expect(guide.hold()).toBe(false);
      expect(guide.finish(stroke, false).shape).toBeNull();
    }
    const arc = samples(held(oval([300, 200], 150, 150, 0, 120)));
    const guide = new StrokeGuide(options());
    guide.add(arc);
    expect(guide.hold()).toBe(false);
    expect(guide.finish(arc, false)).toEqual({ samples: arc, shape: null });
  });

  it("dopo la presa la punta regola la forma; Maiusc la fa regolare", () => {
    let shift = false;
    const guide = new StrokeGuide(options({ shift: () => shift }));
    const stroke = samples(held(SIX[0]![1]));
    guide.add(stroke);
    expect(guide.hold()).toBe(true);
    const before = guide.shapeNow();
    expect(before?.kind).toBe("line");
    guide.add(samples([[480, 160]]));
    const after = guide.shapeNow();
    expect(after?.kind === "line" && after.to[1]).toBeGreaterThan(before?.kind === "line" ? before.to[1] : 0);
    shift = true;
    const straight = guide.shapeNow();
    // A passi di 15°: la linea va a 15° esatti, o a 0°.
    if (straight?.kind !== "line") throw new Error("non è una linea");
    const angle = (Math.atan2(straight.to[1] - straight.from[1], straight.to[0] - straight.from[0]) * 180) / Math.PI;
    expect(Math.abs(angle / 15 - Math.round(angle / 15))).toBeLessThan(1e-9);
  });

  it("Maiusc tiene dritto il tratto a passi di 15°, anche premuto a metà; senza, niente cambia", () => {
    let shift = false;
    const guide = new StrokeGuide(options({ shift: () => shift }));
    const stroke = samples([[0, 0], [30, 5], [60, 20], [100, 30]]);
    guide.add(stroke);
    expect(guide.trail(stroke, [])).toBeNull();
    shift = true;
    const trail = guide.trail(stroke, []);
    expect(trail?.whole).toBe(true);
    const done = guide.finish(stroke, false).samples;
    const last = done[done.length - 1]!;
    const angle = (Math.atan2(last.y, last.x) * 180) / Math.PI;
    expect(angle).toBeCloseTo(15, 9);
    for (const sample of done) expect(Math.abs(sample.y - sample.x * Math.tan(radians(15)))).toBeLessThan(1e-9);
    // Maiusc tenuto non fa forme: la linea è già dritta.
    expect(guide.hold()).toBe(false);
  });

  it("un tratto che comincia vicino a un bordo del righello lo segue; lontano resta com'è; la misura è sullo schermo", () => {
    const ruler = { center: [0, 0] as Point, angle: 0 };
    // A zoom 2 il righello è largo 72 pixel, cioè 36 unità: il bordo in basso sta a y = 18.
    const guide = new StrokeGuide(options({ ruler, zoom: 2 }));
    const stroke = samples([[0, 20], [40, 26], [80, 15]]);
    guide.add(stroke);
    expect(guide.ruled).toBe(true);
    const done = guide.finish(stroke, false);
    // Sul bordo, scostato di mezza punta: 18 + 2.
    expect(done.samples.map((sample) => sample.y)).toEqual([20, 20, 20]);
    expect(done.samples.map((sample) => sample.x)).toEqual([0, 40, 80]);
    expect(guide.trail(stroke, [])?.samples.map((sample) => sample.y)).toEqual([20, 20, 20]);
    expect(guide.hold()).toBe(false);
    expect(RULER_WIDTH_PX / 2 / 2).toBe(18);
    // Lontano dal righello.
    const far = new StrokeGuide(options({ ruler, zoom: 2 }));
    far.add(samples([[0, 200], [40, 210]]));
    expect(far.ruled).toBe(false);
    // Lo stesso punto a zoom 0.5 sta dentro il righello, lontano dai bordi (72 unità per lato).
    const inside = new StrokeGuide(options({ ruler, zoom: 0.5 }));
    inside.add(samples([[0, 20], [40, 26]]));
    expect(inside.ruled).toBe(false);
  });
});
