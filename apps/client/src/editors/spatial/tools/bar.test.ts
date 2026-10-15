import { describe, expect, it } from "vitest";
import { BAR_GAP_PX, BAR_MARGIN_PX, barSpot } from "./bar";

const area = { x: 0, y: 0, w: 800, h: 600 };
const bar = { w: 200, h: 40 };

describe("la barra della selezione", () => {
  it("sta sotto la selezione, al centro, oltre le maniglie", () => {
    expect(barSpot({ x: 300, y: 100, w: 100, h: 50 }, bar, area)).toEqual({ x: 250, y: 150 + BAR_GAP_PX });
  });

  it("sta sopra se sotto non c'è posto", () => {
    expect(barSpot({ x: 300, y: 500, w: 100, h: 80 }, bar, area)).toEqual({ x: 250, y: 500 - BAR_GAP_PX - 40 });
  });

  it("sta in fondo alla vista, sopra la selezione, se la selezione la riempie", () => {
    expect(barSpot({ x: -100, y: -100, w: 1000, h: 800 }, bar, area)).toEqual({ x: 300, y: 600 - BAR_MARGIN_PX - 40 });
  });

  it("resta dentro la vista, sul bordo più vicino a una selezione che ne esce", () => {
    // A sinistra e in alto, fuori.
    expect(barSpot({ x: -500, y: -300, w: 100, h: 100 }, bar, area)).toEqual({ x: BAR_MARGIN_PX, y: BAR_MARGIN_PX });
    // A destra e in basso, fuori.
    expect(barSpot({ x: 1200, y: 900, w: 100, h: 100 }, bar, area)).toEqual({ x: 800 - BAR_MARGIN_PX - 200, y: 600 - BAR_MARGIN_PX - 40 });
  });

  it("tiene conto dei righelli, che coprono i bordi", () => {
    const ruled = { x: 24, y: 24, w: 776, h: 576 };
    expect(barSpot({ x: -500, y: -300, w: 100, h: 100 }, bar, ruled)).toEqual({ x: 24 + BAR_MARGIN_PX, y: 24 + BAR_MARGIN_PX });
  });

  it("senza selezione da affiancare sta in cima, al centro", () => {
    expect(barSpot(null, bar, area)).toEqual({ x: 300, y: BAR_MARGIN_PX });
  });

  it("più larga della vista, parte dal margine", () => {
    expect(barSpot({ x: 100, y: 100, w: 50, h: 50 }, { w: 900, h: 40 }, area)).toEqual({ x: BAR_MARGIN_PX, y: 150 + BAR_GAP_PX });
  });

  it("cade sui pixel interi", () => {
    const spot = barSpot({ x: 300.4, y: 100.3, w: 100.5, h: 50.1 }, { w: 201, h: 40 }, area);
    expect(Number.isInteger(spot.x) && Number.isInteger(spot.y)).toBe(true);
  });
});
