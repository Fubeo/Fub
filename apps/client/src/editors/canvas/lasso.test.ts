import { describe, expect, it } from "vitest";
import { Lasso, LASSO_MIN_AREA, extendLasso, lassoPath, type LassoPoint } from "./lasso";

const p = (x: number, y: number): LassoPoint => ({ x, y });

/** Un quadrato di lato `side` con l'angolo in `(x, y)`. */
const square = (x: number, y: number, side: number): Lasso =>
  new Lasso([p(x, y), p(x + side, y), p(x + side, y + side), p(x, y + side)]);

/** Una U aperta in alto: il vano va da x 40 a 60, fino a y 80. */
const cup = new Lasso([p(0, 0), p(40, 0), p(40, 80), p(60, 80), p(60, 0), p(100, 0), p(100, 100), p(0, 100)]);

describe("il lazo della lavagna (T86)", () => {
  it("un punto dentro il giro è dentro, uno fuori è fuori", () => {
    const lasso = square(0, 0, 100);
    expect(lasso.contains(50, 50)).toBe(true);
    expect(lasso.contains(150, 50)).toBe(false);
    expect(lasso.contains(-1, 50)).toBe(false);
    // Il vano della U è fuori.
    expect(cup.contains(50, 40)).toBe(false);
    expect(cup.contains(20, 40)).toBe(true);
  });

  it("il giro si chiude da solo: l'ultimo punto torna al primo", () => {
    const triangle = new Lasso([p(0, 0), p(100, 0), p(0, 100)]);
    expect(triangle.contains(10, 10)).toBe(true);
    expect(triangle.contains(80, 80)).toBe(false);
  });

  it("un otto sceglie ciò che sta in ognuno dei due anelli", () => {
    const eight = new Lasso([p(0, 0), p(100, 100), p(100, 0), p(0, 100)]);
    expect(eight.contains(10, 50)).toBe(true);
    expect(eight.contains(90, 50)).toBe(true);
    expect(eight.contains(50, 10)).toBe(false);
  });

  it("una scheda è dentro solo se il suo rettangolo è tutto dentro", () => {
    const lasso = square(0, 0, 100);
    expect(lasso.containsBox({ x: 10, y: 10, width: 50, height: 30 })).toBe(true);
    // Mezza fuori.
    expect(lasso.containsBox({ x: 80, y: 10, width: 50, height: 30 })).toBe(false);
    // Tutta fuori.
    expect(lasso.containsBox({ x: 200, y: 200, width: 10, height: 10 })).toBe(false);
  });

  it("gli angoli dentro non bastano: un lato del giro che entra nella scheda la lascia fuori", () => {
    // I quattro angoli della scheda sono dentro la U, ma il vano la taglia.
    const across = { x: 10, y: 50, width: 80, height: 40 };
    expect(cup.contains(10, 50) && cup.contains(90, 50) && cup.contains(90, 90) && cup.contains(10, 90)).toBe(true);
    expect(cup.containsBox(across)).toBe(false);
    // Sotto il vano la stessa larghezza è dentro.
    expect(cup.containsBox({ x: 10, y: 85, width: 80, height: 10 })).toBe(true);
  });

  it("un tratto è dentro se lo sono tutti i suoi punti", () => {
    const lasso = square(0, 0, 100);
    expect(lasso.containsPoints([10, 10, 50, 50, 90, 90])).toBe(true);
    expect(lasso.containsPoints([10, 10, 50, 50, 120, 90])).toBe(false);
    // Un tratto senza punti non è dentro.
    expect(lasso.containsPoints([])).toBe(false);
  });

  it("un giro senza area è un clic: non sceglie niente", () => {
    const line = new Lasso([p(0, 0), p(50, 0), p(100, 0)]);
    expect(line.closed).toBe(false);
    expect(line.contains(50, 0)).toBe(false);
    const tiny = square(0, 0, Math.sqrt(LASSO_MIN_AREA) / 2);
    expect(tiny.closed).toBe(false);
    expect(new Lasso([p(0, 0), p(10, 10)]).closed).toBe(false);
    expect(square(0, 0, 10).closed).toBe(true);
  });

  it("i punti non finiti non entrano nel giro", () => {
    const lasso = new Lasso([p(0, 0), p(Number.NaN, 5), p(100, 0), p(100, 100), p(0, 100)]);
    expect(lasso.size).toBe(4);
    expect(lasso.contains(50, 50)).toBe(true);
    expect(lasso.containsBox({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it("il giro cresce solo coi punti che si allontanano, e si scrive come percorso chiuso", () => {
    const points: LassoPoint[] = [];
    expect(extendLasso(points, p(0, 0))).toBe(true);
    expect(extendLasso(points, p(0.4, 0.3))).toBe(false);
    expect(extendLasso(points, p(10, 0))).toBe(true);
    expect(extendLasso(points, p(Number.POSITIVE_INFINITY, 0))).toBe(false);
    expect(extendLasso(points, p(10.333, 7.777))).toBe(true);
    expect(lassoPath(points)).toBe("M0 0L10 0L10.33 7.78Z");
    expect(lassoPath([])).toBe("");
  });

  it("duemila tratti si giudicano in fretta, coi riquadri prima dei punti", () => {
    const lasso = square(0, 0, 1000);
    const strokes: number[][] = [];
    for (let i = 0; i < 2000; i++) {
      const points: number[] = [];
      for (let k = 0; k < 50; k++) points.push((i % 40) * 20 + k * 0.2, Math.floor(i / 40) * 15 + k * 0.1);
      strokes.push(points);
    }
    const started = performance.now();
    const inside = strokes.filter((points) => lasso.containsPoints(points)).length;
    expect(inside).toBe(2000);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
