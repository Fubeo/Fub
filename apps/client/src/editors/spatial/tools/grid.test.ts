// La griglia: l'aggancio dei punti e degli spostamenti, i passi delle
// frecce, e le righe che si vedono a ogni zoom.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID,
  GRID_MIN_PX,
  GRID_STEPS,
  gridLines,
  lineBeyond,
  nearestCorner,
  snapDelta,
  snapPoint,
  snapValue,
  validStep,
  wholeSteps,
} from "./grid";

/// Le coordinate delle righe di un `d`, in ordine.
const coordinates = (d: string, axis: "x" | "y"): number[] =>
  [...d.matchAll(axis === "x" ? /M(-?[\d.]+) 0V/g : /M0 (-?[\d.]+)H/g)].map((match) => Number(match[1]));

describe("la griglia", () => {
  it("parte spenta, con un passo che divide la pagina di un documento nuovo", () => {
    expect(DEFAULT_GRID).toEqual({ shown: false, snap: false, step: 20, guides: true });
    for (const step of GRID_STEPS) {
      expect(1600 % step).toBe(0);
      expect(1000 % step).toBe(0);
    }
    expect(GRID_STEPS).toContain(DEFAULT_GRID.step);
  });

  it("accetta un passo da 1 a 1000 unità", () => {
    expect(validStep(1)).toBe(true);
    expect(validStep(2.5)).toBe(true);
    expect(validStep(1000)).toBe(true);
    expect(validStep(0)).toBe(false);
    expect(validStep(0.5)).toBe(false);
    expect(validStep(1001)).toBe(false);
    expect(validStep(Number.NaN)).toBe(false);
    expect(validStep(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("porta un punto all'incrocio più vicino, anche a sinistra dell'origine", () => {
    expect(snapPoint([29, 31], 20)).toEqual([20, 40]);
    expect(snapPoint([-29, -31], 20)).toEqual([-20, -40]);
    expect(snapPoint([30, 50], 20)).toEqual([40, 60]);
    expect(snapPoint([0.1 + 0.2, 7.49], 2.5)).toEqual([0, 7.5]);
    expect(Object.is(snapValue(-4, 20), 0)).toBe(true);
  });

  it("va alla riga dopo, o a quella dopo cinque passi", () => {
    expect(lineBeyond(40, 20, 1, 1)).toBe(60);
    expect(lineBeyond(41, 20, 1, 1)).toBe(60);
    expect(lineBeyond(41, 20, -1, 1)).toBe(40);
    expect(lineBeyond(40, 20, -1, 1)).toBe(20);
    expect(lineBeyond(41, 20, 1, 5)).toBe(140);
    expect(lineBeyond(-41, 20, 1, 1)).toBe(-40);
    // Un bordo scritto a due decimali che la virgola mobile fa sforare sta
    // già sulla riga.
    expect(lineBeyond(39.9999999, 20, 1, 1)).toBe(60);
    expect(lineBeyond(40.0000001, 20, -1, 1)).toBe(20);
  });

  it("aggancia lo spostamento con l'angolo più vicino al punto preso", () => {
    const bounds = { min: [13, 7], max: [53, 47] } as const;
    expect(nearestCorner(bounds, [20, 10])).toEqual([13, 7]);
    expect(nearestCorner(bounds, [50, 40])).toEqual([53, 47]);
    expect(nearestCorner(bounds, [50, 10])).toEqual([53, 7]);
    // L'angolo in alto a sinistra spostato di (30, 30) va da (43, 37) a
    // (40, 40).
    expect(snapDelta([13, 7], 30, 30, 20)).toEqual([27, 33]);
    expect(snapDelta([40, 40], 0, 0, 20)).toEqual([0, 0]);
    expect(snapDelta([40, 40], 9, -11, 20)).toEqual([0, -20]);
  });

  it("scosta le copie di un numero intero di passi", () => {
    expect(wholeSteps(24, 20)).toBe(40);
    expect(wholeSteps(24, 5)).toBe(25);
    expect(wholeSteps(20, 20)).toBe(20);
    expect(wholeSteps(3, 100)).toBe(100);
  });

  it("disegna le righe che si vedono, nitide, con una ogni cinque marcata", () => {
    const lines = gridLines({ scale: 1, tx: 0, ty: 0 }, 100, 50, 10);
    expect(coordinates(lines.major, "x")).toEqual([0.5, 50.5, 100.5]);
    expect(coordinates(lines.minor, "x")).toEqual([10.5, 20.5, 30.5, 40.5, 60.5, 70.5, 80.5, 90.5]);
    expect(coordinates(lines.major, "y")).toEqual([0.5, 50.5]);
    expect(coordinates(lines.minor, "y")).toEqual([10.5, 20.5, 30.5, 40.5]);
    expect(lines.major).toContain("M0.5 0V50");
    expect(lines.major).toContain("M0 0.5H100");
  });

  it("segue la camera: le righe restano sui multipli del passo nella scena", () => {
    const lines = gridLines({ scale: 2, tx: -35, ty: 13 }, 60, 40, 10);
    // Scena x = (schermo - tx) / scale: le righe a 20, 30, 40 della scena.
    expect(coordinates(lines.minor, "x")).toEqual([5.5, 25.5, 45.5]);
    expect(coordinates(lines.major, "x")).toEqual([]);
    expect(coordinates(lines.minor, "y")).toEqual([33.5]);
    expect(coordinates(lines.major, "y")).toEqual([13.5]);
  });

  it("si dirada quando le righe si avvicinano, ma non sotto il passo", () => {
    // Passo 5 a zoom 1: 5 pixel sono troppo pochi, si vede una riga ogni 25.
    const sparse = gridLines({ scale: 1, tx: 0, ty: 0 }, 300, 10, 5);
    expect(coordinates(sparse.minor, "x")).toEqual([25.5, 50.5, 75.5, 100.5, 150.5, 175.5, 200.5, 225.5, 275.5, 300.5]);
    expect(coordinates(sparse.major, "x")).toEqual([0.5, 125.5, 250.5]);
    // Al decimo, il passo 20 diventa 100 e poi 500 unità: 10 e 50 pixel.
    const far = gridLines({ scale: 0.1, tx: 0, ty: 0 }, 60, 10, 20);
    expect(coordinates(far.minor, "x")).toEqual([10.5, 20.5, 30.5, 40.5, 60.5]);
    expect(coordinates(far.major, "x")).toEqual([0.5, 50.5]);
    for (const x of coordinates(far.minor, "x")) expect(x - 0.5).toBeGreaterThanOrEqual(GRID_MIN_PX);
    // Ingrandita, la griglia resta al suo passo.
    const near = gridLines({ scale: 4, tx: 0, ty: 0 }, 100, 10, 5);
    expect(coordinates(near.minor, "x")).toEqual([20.5, 40.5, 60.5, 80.5]);
  });

  it("non disegna niente senza un foglio, una camera o un passo validi", () => {
    expect(gridLines({ scale: 1, tx: 0, ty: 0 }, 0, 100, 20)).toEqual({ minor: "", major: "" });
    expect(gridLines({ scale: 0, tx: 0, ty: 0 }, 100, 100, 20)).toEqual({ minor: "", major: "" });
    expect(gridLines({ scale: 1, tx: 0, ty: 0 }, 100, 100, 0)).toEqual({ minor: "", major: "" });
  });
});
