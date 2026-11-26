// La pagina come limite dei segni sul foglio delle annotazioni.

import { describe, expect, it } from "vitest";
import { clampToPage, onPage, towardPage } from "./page-bounds";

const PAGE = { x: 0, y: 0, width: 600, height: 800 };

describe("la pagina come limite", () => {
  it("il bordo è sulla pagina, un capello oltre no", () => {
    expect(onPage(PAGE, [0, 0])).toBe(true);
    expect(onPage(PAGE, [600, 800])).toBe(true);
    expect(onPage(PAGE, [300, -0.01])).toBe(false);
    expect(onPage(PAGE, [600.01, 400])).toBe(false);
    expect(onPage({ x: 10, y: 20, width: 5, height: 5 }, [9, 22])).toBe(false);
  });

  it("un punto fuori si ferma sul bordo più vicino, uno dentro resta dov'è", () => {
    expect(clampToPage(PAGE, [75, -84])).toEqual([75, 0]);
    expect(clampToPage(PAGE, [700, 900])).toEqual([600, 800]);
    expect(clampToPage(PAGE, [-5, 400])).toEqual([0, 400]);
    expect(clampToPage(PAGE, [120, 200])).toEqual([120, 200]);
  });

  it("verso un punto fuori la direzione resta e la misura si accorcia al bordo", () => {
    // Un quadrato tenuto con Maiusc resta quadrato.
    expect(towardPage(PAGE, [500, 700], [700, 900])).toEqual([600, 800]);
    expect(towardPage(PAGE, [500, 500], [800, 800])).toEqual([600, 600]);
    // Una linea a 45° in alto a sinistra.
    expect(towardPage(PAGE, [100, 50], [0, -50])).toEqual([50, 0]);
    expect(towardPage(PAGE, [100, 50], [200, 60])).toEqual([200, 60]);
    // Da fuori, il punto più vicino.
    expect(towardPage(PAGE, [-10, -10], [700, 50])).toEqual([600, 50]);
  });
});
