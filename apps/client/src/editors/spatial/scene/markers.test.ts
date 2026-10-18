// I marcatori di un tracciato: i vertici dove SVG li mette, il verso in cui
// li gira e la matrice dal contenuto di un `marker` alla forma che lo usa.

import { describe, expect, it } from "vitest";
import { parsePath } from "./geometry";
import { markerFit, markerMatrix, placed, vertices, type Vertex } from "./markers";
import { apply, type Point } from "./matrix";

/// I vertici di `d` come `[x, y, verso]`, col verso arrotondato.
const corners = (d: string): Array<[number, number, number]> =>
  vertices(parsePath(d)!).map(({ at, angle }) => [at[0], at[1], Math.round(angle * 1000) / 1000 + 0]);

function near(a: Point, b: Point): void {
  expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${JSON.stringify(a)} invece di ${JSON.stringify(b)}`).toBeLessThanOrEqual(1e-9);
}

describe("i vertici di un tracciato", () => {
  it("sono il punto di ogni M e la fine di ogni segmento, coi versi del tracciato ai capi", () => {
    expect(corners("M0 0 L10 0")).toEqual([[0, 0, 0], [10, 0, 0]]);
    expect(corners("M0 0 V10")).toEqual([[0, 0, 90], [0, 10, 90]]);
    expect(vertices([])).toEqual([]);
  });

  it("in mezzo prendono la bisettrice, dalla parte dell'angolo minore", () => {
    expect(corners("M0 0 L10 0 L10 10")).toEqual([[0, 0, 0], [10, 0, 45], [10, 10, 90]]);
    // Da 170° a -170°: la bisettrice è 180°, non 0°.
    const turn = vertices([
      { kind: "move", to: [0, 0] },
      { kind: "line", to: [-Math.cos((10 * Math.PI) / 180), Math.sin((10 * Math.PI) / 180)] },
      { kind: "line", to: [-2 * Math.cos((10 * Math.PI) / 180), 0] },
    ]);
    expect(Math.abs(turn[1]!.angle)).toBeCloseTo(180, 9);
  });

  it("su una curva seguono le maniglie, e una maniglia sul nodo lascia il verso a quella dopo", () => {
    expect(corners("M0 0 C0 0 10 10 20 0")).toEqual([[0, 0, 45], [20, 0, -45]]);
    expect(corners("M0 0 Q10 0 10 10")).toEqual([[0, 0, 0], [10, 10, 90]]);
    // Un mezzo cerchio in senso orario sullo schermo parte verso l'alto.
    expect(corners("M0 0 A10 10 0 0 1 20 0")).toEqual([[0, 0, -90], [20, 0, 90]]);
  });

  it("nei capi di un sottotracciato chiuso prendono la bisettrice fra la Z e il primo segmento", () => {
    expect(corners("M0 0 L10 0 L10 10 Z")).toEqual([[0, 0, -67.5], [10, 0, 45], [10, 10, 157.5], [0, 0, -67.5]]);
    // Una Z lunga zero prende il verso del segmento prima.
    expect(corners("M0 0 L10 0 L10 10 L0 0 Z")).toEqual([[0, 0, -67.5], [10, 0, 45], [10, 10, 157.5], [0, 0, -135], [0, 0, -67.5]]);
  });

  it("dove un sottotracciato aperto finisce o comincia, hanno il verso da una parte sola", () => {
    expect(corners("M0 0 L10 0 M20 0 L20 10")).toEqual([[0, 0, 0], [10, 0, 0], [20, 0, 90], [20, 10, 90]]);
    // Dopo una Z un segmento riparte dallo stesso punto, con un vertice suo.
    expect(corners("M0 0 L10 0 L10 10 Z L0 -10")).toEqual([[0, 0, -67.5], [10, 0, 45], [10, 10, 157.5], [0, 0, -67.5], [0, 0, -90], [0, -10, -90]]);
  });

  it("un segmento lungo zero prende il verso del segmento non nullo più vicino, prima o dopo", () => {
    expect(corners("M0 0 L0 0 L0 10")).toEqual([[0, 0, 90], [0, 0, 90], [0, 10, 90]]);
    expect(corners("M0 0 L0 10 L0 10")).toEqual([[0, 0, 90], [0, 10, 90], [0, 10, 90]]);
    expect(corners("M5 5 L5 5")).toEqual([[5, 5, 0], [5, 5, 0]]);
    expect(corners("M5 5")).toEqual([[5, 5, 0]]);
  });

  it("danno a ogni proprietà i suoi: il primo, l'ultimo e quelli in mezzo", () => {
    const list = vertices(parsePath("M0 0 L10 0 L10 10 L20 10")!);
    const at = (place: "start" | "mid" | "end"): Point[] => placed(list, place).map((vertex: Vertex) => vertex.at);
    expect(at("start")).toEqual([[0, 0]]);
    expect(at("mid")).toEqual([[10, 0], [10, 10]]);
    expect(at("end")).toEqual([[20, 10]]);
    // Un vertice solo prende l'inizio e la fine.
    const one = vertices(parsePath("M5 5")!);
    expect([placed(one, "start").length, placed(one, "mid").length, placed(one, "end").length]).toEqual([1, 0, 1]);
    expect(placed([], "start")).toEqual([]);
  });
});

describe("come un marcatore mette il contenuto", () => {
  const fit = (attrs: Record<string, string>) => markerFit((name) => attrs[name]);

  it("senza attributi ha una finestra di 3 per 3, cresce col contorno e non gira", () => {
    expect(fit({})).toEqual({ content: [1, 0, 0, 1, 0, 0], clip: { min: [0, 0], max: [3, 3] }, scaled: true, orient: 0 });
  });

  it("porta il viewBox nella finestra, col riferimento nell'origine", () => {
    const placed = fit({ viewBox: "0 0 10 10", markerWidth: "5", markerHeight: "5", refX: "10", refY: "5", orient: "auto", markerUnits: "userSpaceOnUse" })!;
    near(apply(placed.content, [10, 5]), [0, 0]);
    near(apply(placed.content, [0, 0]), [-5, -2.5]);
    expect(placed.clip).toEqual({ min: [0, 0], max: [10, 10] });
    expect([placed.scaled, placed.orient]).toEqual([false, "auto"]);
  });

  it("con preserveAspectRatio taglia la finestra, più larga del viewBox che sta dentro intero", () => {
    const placed = fit({ viewBox: "0 0 10 20", markerWidth: "10", markerHeight: "10" })!;
    expect(placed.clip).toEqual({ min: [-5, 0], max: [15, 20] });
    const sliced = fit({ viewBox: "0 0 10 20", markerWidth: "10", markerHeight: "10", preserveAspectRatio: "xMinYMin slice" })!;
    expect(sliced.clip).toEqual({ min: [0, 0], max: [10, 10] });
  });

  it("legge l'angolo con le sue unità, e i valori che non si leggono valgono quelli di partenza", () => {
    expect(fit({ orient: "90deg" })!.orient).toBe(90);
    expect(fit({ orient: "100grad" })!.orient).toBe(90);
    expect(fit({ orient: "auto-start-reverse" })!.orient).toBe("auto-start-reverse");
    expect(fit({ orient: "di lato", markerWidth: "largo", refX: "x" })).toEqual(fit({}));
  });

  it("non disegna niente con una finestra o un viewBox larghi o alti zero", () => {
    expect(fit({ markerWidth: "0" })).toBeNull();
    expect(fit({ markerHeight: "0" })).toBeNull();
    expect(fit({ viewBox: "0 0 0 10" })).toBeNull();
  });

  it("si mette sul vertice girato col tracciato, grande quanto il contorno", () => {
    const vertex: Vertex = { at: [100, 50], angle: 90 };
    const auto = fit({ orient: "auto" })!;
    near(apply(markerMatrix(auto, vertex, "end", 2), [1, 0]), [100, 52]);
    // All'inizio `auto-start-reverse` gira di mezzo giro; altrove è `auto`.
    const reverse = fit({ orient: "auto-start-reverse" })!;
    near(apply(markerMatrix(reverse, vertex, "start", 2), [1, 0]), [100, 48]);
    near(apply(markerMatrix(reverse, vertex, "end", 2), [1, 0]), [100, 52]);
    // Un angolo fisso non segue il tracciato; in unità utente non segue il contorno.
    near(apply(markerMatrix(fit({ orient: "0" })!, vertex, "end", 2), [1, 0]), [102, 50]);
    near(apply(markerMatrix(fit({ orient: "auto", markerUnits: "userSpaceOnUse" })!, vertex, "end", 2), [1, 0]), [100, 51]);
  });
});
