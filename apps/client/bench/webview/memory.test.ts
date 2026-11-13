// La pendenza dei giri di R1 (`pendenza` in `memory.mjs`): la mediana delle
// pendenze fra coppie di giri, perché il dente di sega del GC della WebView
// non la sposti come spostava la retta dei minimi quadrati (#284).
import { describe, expect, it } from "vitest";

import { pendenza } from "./memory.mjs";

/// La retta dei minimi quadrati, quella che R1 usava prima: per confronto.
function minimiQuadrati(ys: number[]): number {
  const xs = ys.map((_, i) => i + 1);
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length;
  const my = ys.reduce((a, y) => a + y, 0) / ys.length;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return num / den;
}

describe("pendenza dei giri di R1", () => {
  it("su una retta è la sua pendenza", () => {
    expect(pendenza([10, 12, 14, 16, 18])).toBe(2);
    expect(pendenza([50, 50, 50])).toBe(0);
    expect(pendenza([30, 27, 24])).toBe(-3);
  });

  it("una lettura alta in cima e una bassa in fondo non la spostano", () => {
    // Trenta giri che crescono di 1 MiB, col GC che passa al primo e
    // all'ultimo: la retta dei minimi quadrati dice che la memoria cala.
    const ys = Array.from({ length: 30 }, (_, i) => 100 + i);
    ys[0] += 150;
    ys[29] -= 150;
    expect(minimiQuadrati(ys)).toBeLessThan(0);
    expect(pendenza(ys)).toBe(1);
  });

  it("un dente di sega piatto resta vicino a zero", () => {
    // ±150 MiB ogni tre giri, nessuna crescita: la mediana sta entro 1 MiB.
    const ys = Array.from({ length: 30 }, (_, i) => 200 + [150, 0, -150][i % 3]);
    expect(Math.abs(pendenza(ys) ?? Infinity)).toBeLessThanOrEqual(1);
  });

  it("un giro senza lettura resta fuori senza spostare gli altri", () => {
    expect(pendenza([10, null, 14, 16])).toBe(2);
    expect(pendenza([null, 5, null, 9])).toBe(2);
  });

  it("con meno di due letture non c'è pendenza", () => {
    expect(pendenza([])).toBeNull();
    expect(pendenza([42])).toBeNull();
    expect(pendenza([null, 42, null])).toBeNull();
  });

  it("con un numero pari di coppie è la media delle due di mezzo", () => {
    // Coppie: (1,2) 1, (1,3) 2, (1,4) 2, (2,3) 3, (2,4) 2.5, (3,4) 2 → 2, 2.
    expect(pendenza([0, 1, 4, 6])).toBe(2);
  });
});
