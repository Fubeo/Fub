import { describe, expect, it } from "vitest";
import { MAX_PUNTI_MOSTRATI, segniDeiPunti, type TracciatoScelto } from "./punti-diretti";
import type { Matrix } from "../scene/matrix";

const IDENTITA: Matrix = [1, 0, 0, 1, 0, 0];

const tracciato = (tag: string, attributi: Record<string, string>, matrice: Matrix = IDENTITA): TracciatoScelto => ({
  id: "t",
  tag,
  attributi: new Map(Object.entries(attributi)),
  matrice,
});

const ancore = (segni: ReturnType<typeof segniDeiPunti>) =>
  segni.flatMap((s) => (s.kind === "anchor" ? [{ x: s.x, y: s.y, pieno: s.filled }] : []));

describe("i punti della Selezione diretta", () => {
  it("mostra un quadratino vuoto per ogni punto, senza maniglie se nessuno è scelto", () => {
    const segni = segniDeiPunti([tracciato("path", { d: "M0 0 L10 0 C 15 0 20 5 20 10" })], [], 0.5);
    expect(ancore(segni)).toEqual([
      { x: 0, y: 0, pieno: false },
      { x: 10, y: 0, pieno: false },
      { x: 20, y: 10, pieno: false },
    ]);
    expect(segni.some((s) => s.kind === "control" || s.kind === "guide")).toBe(false);
  });

  it("non ripete il primo punto di un sottotracciato chiuso che ci torna", () => {
    const segni = segniDeiPunti([tracciato("path", { d: "M0 0 L10 0 L10 10 L0 0 Z M20 20 L30 20" })], [], 0.5);
    expect(ancore(segni).map((a) => [a.x, a.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 20],
      [30, 20],
    ]);
  });

  it("riempie il punto scelto e ne mostra le maniglie, nella scena", () => {
    // Spostato di 100 a destra: il motore dice i punti in coordinate di scena.
    const m: Matrix = [1, 0, 0, 1, 100, 0];
    const segni = segniDeiPunti(
      [tracciato("path", { d: "M0 0 C 5 0 10 5 10 10 C 10 15 5 20 0 20" }, m)],
      [{ element: "t", subpath: 0, anchor: 1, at: [110, 10], end: false }],
      0.5,
    );
    expect(ancore(segni)).toEqual([
      { x: 100, y: 0, pieno: false },
      { x: 110, y: 10, pieno: true },
      { x: 100, y: 20, pieno: false },
    ]);
    const controlli = segni.flatMap((s) => (s.kind === "control" ? [[s.x, s.y]] : []));
    expect(controlli).toEqual([
      [110, 5],
      [110, 15],
    ]);
    // Le maniglie stanno sotto i quadratini.
    const primoQuadratino = segni.findIndex((s) => s.kind === "anchor");
    expect(segni.slice(primoQuadratino).every((s) => s.kind === "anchor")).toBe(true);
  });

  it("non riempie i punti di un altro tracciato nello stesso posto", () => {
    const segni = segniDeiPunti([tracciato("path", { d: "M0 0 L10 0" })], [{ element: "altro", subpath: 0, anchor: 0, at: [0, 0], end: false }], 0.5);
    expect(ancore(segni).some((a) => a.pieno)).toBe(false);
  });

  it("legge anche polyline, polygon e line, e ignora gli altri tag", () => {
    expect(ancore(segniDeiPunti([tracciato("polyline", { points: "0,0 5,5 10,0" })], [], 0.5))).toHaveLength(3);
    expect(ancore(segniDeiPunti([tracciato("polygon", { points: "0 0 5 5 10 0" })], [], 0.5))).toHaveLength(3);
    expect(ancore(segniDeiPunti([tracciato("line", { x1: "1", y1: "2", x2: "3", y2: "4" })], [], 0.5)).map((a) => [a.x, a.y])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(segniDeiPunti([tracciato("rect", { width: "10", height: "10" })], [], 0.5)).toEqual([]);
    expect(segniDeiPunti([tracciato("path", { d: "non è un tracciato" })], [], 0.5)).toEqual([]);
  });

  it("si ferma a un tetto di punti", () => {
    const d = "M0 0" + " L1 1".repeat(MAX_PUNTI_MOSTRATI + 50);
    expect(ancore(segniDeiPunti([tracciato("path", { d })], [], 0.5))).toHaveLength(MAX_PUNTI_MOSTRATI);
  });
});
