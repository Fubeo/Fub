import { describe, expect, it } from "vitest";
import { contornoDi, MAX_PUNTI_MOSTRATI, segniDeiPunti, type TracciatoScelto } from "./punti-diretti";
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
  it("un tracciato scelto intero ha tutti i punti pieni, e le maniglie solo con uno strumento che cambia i punti", () => {
    const d = "M0 0 L10 0 C 15 0 20 5 20 10";
    const diretti = segniDeiPunti([tracciato("path", { d })], [], 0.5, { diretto: true, contorni: false });
    expect(ancore(diretti)).toEqual([
      { x: 0, y: 0, pieno: true },
      { x: 10, y: 0, pieno: true },
      { x: 20, y: 10, pieno: true },
    ]);
    expect(diretti.filter((s) => s.kind === "control").map((s) => (s.kind === "control" ? [s.x, s.y] : []))).toEqual([
      [15, 0],
      [20, 5],
    ]);
    // Con la Selezione (o un altro strumento che non cambia i punti): pieni,
    // ma senza maniglie.
    const altri = segniDeiPunti([tracciato("path", { d })], [], 0.5, { diretto: false, contorni: false });
    expect(ancore(altri).every((a) => a.pieno)).toBe(true);
    expect(altri.some((s) => s.kind === "control" || s.kind === "guide")).toBe(false);
  });

  it("scelto in parte, sono pieni solo i punti scelti", () => {
    const segni = segniDeiPunti([tracciato("path", { d: "M0 0 L10 0 L20 0" })], [{ element: "t", subpath: 0, anchor: 1, at: [10, 0], end: false }], 0.5);
    expect(ancore(segni).map((a) => a.pieno)).toEqual([false, true, false]);
  });

  it("il contorno di un pixel sta sotto tutto, coi pezzi nella scena", () => {
    const m: Matrix = [2, 0, 0, 2, 100, 0];
    const segni = segniDeiPunti([tracciato("path", { d: "M0 0 L10 0 Q 15 0 15 5 C 15 10 10 10 5 10 Z" }, m)], [], 0.5, { diretto: true, contorni: true });
    expect(segni[0]).toEqual({
      kind: "outline",
      parts: [
        { kind: "move", to: [100, 0] },
        { kind: "line", to: [120, 0] },
        { kind: "quad", control: [130, 0], to: [130, 10] },
        { kind: "cubic", c1: [130, 20], c2: [120, 20], to: [110, 20] },
        { kind: "close" },
      ],
    });
    expect(segni.slice(1).some((s) => s.kind === "outline")).toBe(false);
    // Nascondi bordi: niente contorno.
    expect(segniDeiPunti([tracciato("path", { d: "M0 0 L10 0" })], [], 0.5, { diretto: true, contorni: false }).some((s) => s.kind === "outline")).toBe(false);
  });

  it("il contorno di polyline, polygon, line e di un arco", () => {
    const parti = (t: TracciatoScelto) => {
      const c = contornoDi(t);
      return c !== null && c.kind === "outline" ? c.parts : [];
    };
    expect(parti(tracciato("polyline", { points: "0,0 5,5 10,0" })).map((p) => p.kind)).toEqual(["move", "line", "line"]);
    expect(parti(tracciato("polygon", { points: "0,0 5,5 10,0" })).map((p) => p.kind)).toEqual(["move", "line", "line", "close"]);
    expect(parti(tracciato("line", { x1: "1", y1: "2", x2: "3", y2: "4" }))).toEqual([
      { kind: "move", to: [1, 2] },
      { kind: "line", to: [3, 4] },
    ]);
    // Un arco diventa corde, e finisce nel suo punto.
    const arco = parti(tracciato("path", { d: "M0 0 A 10 10 0 0 1 20 0" }));
    expect(arco.length).toBeGreaterThan(3);
    expect(arco[arco.length - 1]).toEqual({ kind: "line", to: [20, 0] });
    expect(contornoDi(tracciato("g", {}))).toBeNull();
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
    const segni = segniDeiPunti(
      [tracciato("path", { d: "M0 0 L10 0" }), { ...tracciato("path", { d: "M0 0 L10 0" }), id: "u" }],
      [
        { element: "altro", subpath: 0, anchor: 0, at: [0, 0], end: false },
        { element: "u", subpath: 0, anchor: 1, at: [10, 0], end: false },
      ],
      0.5,
    );
    // `t` è scelto intero (pieni); di `u` è scelto solo il secondo punto, e
    // il punto di `altro` in (0,0) non riempie il primo.
    expect(ancore(segni).map((a) => a.pieno)).toEqual([true, true, false, true]);
  });

  it("un rettangolo, un cerchio e un'ellisse hanno i punti del tracciato che VectorCraft ne fa all'import", () => {
    // Il rettangolo: i quattro angoli dall'alto a sinistra, senza maniglie.
    expect(ancore(segniDeiPunti([tracciato("rect", { x: "10", y: "20", width: "30", height: "40" })], [], 0.5, { diretto: false, contorni: false }))).toEqual([
      { x: 10, y: 20, pieno: true },
      { x: 40, y: 20, pieno: true },
      { x: 40, y: 60, pieno: true },
      { x: 10, y: 60, pieno: true },
    ]);
    // Con gli angoli tondi: due punti per angolo, dal lato in alto; `ry` mancante vale `rx`.
    const tondo = ancore(segniDeiPunti([tracciato("rect", { width: "100", height: "50", rx: "10" })], [], 0.5)).map((a) => [a.x, a.y]);
    expect(tondo).toEqual([
      [10, 0],
      [90, 0],
      [100, 10],
      [100, 40],
      [90, 50],
      [10, 50],
      [0, 40],
      [0, 10],
    ]);
    // L'ellisse: quattro punti da destra passando per il basso, con le maniglie dei quarti
    // solo con uno strumento che cambia i punti.
    const ellisse = tracciato("ellipse", { cx: "50", cy: "50", rx: "20", ry: "10" });
    expect(ancore(segniDeiPunti([ellisse], [], 0.5)).map((a) => [a.x, a.y])).toEqual([
      [70, 50],
      [50, 60],
      [30, 50],
      [50, 40],
    ]);
    expect(segniDeiPunti([ellisse], [], 0.5, { diretto: true, contorni: false }).filter((s) => s.kind === "control")).toHaveLength(8);
    expect(segniDeiPunti([ellisse], [], 0.5, { diretto: false, contorni: false }).filter((s) => s.kind === "control")).toHaveLength(0);
    expect(ancore(segniDeiPunti([tracciato("circle", { cx: "5", cy: "5", r: "5" })], [], 0.5))).toHaveLength(4);
    // Una forma senza misure non ha punti.
    expect(segniDeiPunti([tracciato("rect", { width: "0", height: "10" })], [], 0.5)).toEqual([]);
    expect(segniDeiPunti([tracciato("circle", { r: "0" })], [], 0.5)).toEqual([]);
  });

  it("il contorno di un rettangolo è chiuso coi lati dritti, quello di un'ellisse con quattro cubiche", () => {
    expect(contornoDi(tracciato("rect", { width: "10", height: "5" }))).toEqual({
      kind: "outline",
      parts: [
        { kind: "move", to: [0, 0] },
        { kind: "line", to: [10, 0] },
        { kind: "line", to: [10, 5] },
        { kind: "line", to: [0, 5] },
        { kind: "close" },
      ],
    });
    const ellisse = contornoDi(tracciato("circle", { r: "10" }));
    expect(ellisse?.kind === "outline" ? ellisse.parts.map((p) => p.kind) : null).toEqual(["move", "cubic", "cubic", "cubic", "cubic", "close"]);
  });

  it("legge anche polyline, polygon e line, e ignora gli altri tag", () => {
    expect(ancore(segniDeiPunti([tracciato("polyline", { points: "0,0 5,5 10,0" })], [], 0.5))).toHaveLength(3);
    expect(ancore(segniDeiPunti([tracciato("polygon", { points: "0 0 5 5 10 0" })], [], 0.5))).toHaveLength(3);
    expect(ancore(segniDeiPunti([tracciato("line", { x1: "1", y1: "2", x2: "3", y2: "4" })], [], 0.5)).map((a) => [a.x, a.y])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(segniDeiPunti([tracciato("g", {})], [], 0.5)).toEqual([]);
    expect(segniDeiPunti([tracciato("path", { d: "non è un tracciato" })], [], 0.5)).toEqual([]);
  });

  it("si ferma a un tetto di punti", () => {
    const d = "M0 0" + " L1 1".repeat(MAX_PUNTI_MOSTRATI + 50);
    expect(ancore(segniDeiPunti([tracciato("path", { d })], [], 0.5))).toHaveLength(MAX_PUNTI_MOSTRATI);
  });
});
