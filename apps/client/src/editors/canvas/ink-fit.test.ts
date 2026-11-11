// I vettori della misura dell'inchiostro (`src/__fixtures__/canvas-ink-fit/`)
// contro `inkFitMode` e `inkFit`: la regola della resa che ogni lettore del
// formato rifà uguale. Un vettore che non passa si corregge nella regola, non
// nel vettore.
import { describe, expect, it } from "vitest";
import { contentBox, fitPoint, inkFit, inkFitMode, type InkFitMode } from "./ink-fit";
import type { CanvasNode } from "./model";

interface Vector {
  readonly name: string;
  readonly description: string;
  readonly card: Pick<CanvasNode, "type" | "file">;
  readonly ref: { readonly width: number; readonly height: number };
  readonly size: { readonly width: number; readonly height: number };
  readonly expect: {
    readonly mode: InkFitMode;
    readonly s: number;
    readonly x: number;
    readonly y: number;
    readonly points: readonly { readonly from: readonly [number, number]; readonly to: readonly [number, number] }[];
  };
}

const FILES = import.meta.glob("../../__fixtures__/canvas-ink-fit/*.json", { import: "default", eager: true }) as Record<
  string,
  Vector
>;
const VECTORS = Object.entries(FILES)
  .map(([path, vector]) => [path.replace(/^.*\/([^/]+)\.json$/, "$1"), vector] as const)
  .sort(([a], [b]) => a.localeCompare(b));

/// I vettori con la proporzione del contenuto (T39), in una cartella loro:
/// `canvas-ink-fit/` la legge anche il nucleo (`fub-canvas-core`, `ops.rs`),
/// che rifà la regola senza `aspect` (il contenuto lo sa solo la resa).
interface AspectVector extends Vector {
  readonly aspect: number;
}

const ASPECT_FILES = import.meta.glob("../../__fixtures__/canvas-ink-fit-aspect/*.json", { import: "default", eager: true }) as Record<
  string,
  AspectVector
>;
const ASPECT_VECTORS = Object.entries(ASPECT_FILES)
  .map(([path, vector]) => [path.replace(/^.*\/([^/]+)\.json$/, "$1"), vector] as const)
  .sort(([a], [b]) => a.localeCompare(b));

const PRECISION = 9;

describe("vettori della misura dell'inchiostro", () => {
  it("ci sono tutti i vettori", () => {
    // 23 vettori scritti a mano da T18: uno che sparisce si vede qui.
    expect(VECTORS.length).toBe(23);
  });

  it.each(VECTORS)("%s", (file, vector) => {
    expect(vector.name).toBe(file);
    expect(vector.description.length).toBeGreaterThan(0);
    const mode = inkFitMode(vector.card);
    expect(mode).toBe(vector.expect.mode);
    const fit = inkFit(mode, vector.ref, vector.size);
    expect(fit.s).toBeCloseTo(vector.expect.s, PRECISION);
    expect(fit.x).toBeCloseTo(vector.expect.x, PRECISION);
    expect(fit.y).toBeCloseTo(vector.expect.y, PRECISION);
    expect(vector.expect.points.length).toBeGreaterThan(0);
    for (const point of vector.expect.points) {
      const [x, y] = fitPoint(fit, point.from[0], point.from[1]);
      expect(x).toBeCloseTo(point.to[0], PRECISION);
      expect(y).toBeCloseTo(point.to[1], PRECISION);
    }
  });
});

describe("vettori dell'inchiostro sul contenuto (T39)", () => {
  it("ci sono tutti i vettori", () => {
    // 7 vettori scritti a mano da T39: uno che sparisce si vede qui.
    expect(ASPECT_VECTORS.length).toBe(7);
  });

  it.each(ASPECT_VECTORS)("%s", (file, vector) => {
    expect(vector.name).toBe(file);
    expect(vector.description.length).toBeGreaterThan(0);
    expect(typeof vector.aspect).toBe("number");
    const mode = inkFitMode(vector.card);
    expect(mode).toBe(vector.expect.mode);
    const fit = inkFit(mode, vector.ref, vector.size, vector.aspect);
    expect(fit.s).toBeCloseTo(vector.expect.s, PRECISION);
    expect(fit.x).toBeCloseTo(vector.expect.x, PRECISION);
    expect(fit.y).toBeCloseTo(vector.expect.y, PRECISION);
    for (const point of vector.expect.points) {
      const [x, y] = fitPoint(fit, point.from[0], point.from[1]);
      expect(x).toBeCloseTo(point.to[0], PRECISION);
      expect(y).toBeCloseTo(point.to[1], PRECISION);
    }
  });
});

describe("l'inchiostro sul contenuto", () => {
  it("con aspect = W / H è la regola di N4, per ogni vettore di N4", () => {
    for (const [, vector] of VECTORS) {
      const { width: W, height: H } = vector.ref;
      if (!(W > 0 && H > 0)) continue;
      const mode = inkFitMode(vector.card);
      const without = inkFit(mode, vector.ref, vector.size);
      const withAspect = inkFit(mode, vector.ref, vector.size, W / H);
      expect(withAspect.s).toBeCloseTo(without.s, PRECISION);
      expect(withAspect.x).toBeCloseTo(without.x, PRECISION);
      expect(withAspect.y).toBeCloseTo(without.y, PRECISION);
    }
  });

  it("aspect assente, null, non finito o non positivo dà la regola senza aspect", () => {
    const ref = { width: 200, height: 100 };
    const size = { width: 300, height: 400 };
    const plain = inkFit("scale", ref, size);
    for (const aspect of [undefined, null, NaN, Infinity, -Infinity, 0, -2]) {
      expect(inkFit("scale", ref, size, aspect)).toEqual(plain);
    }
  });

  it("misure senza senso non danno mai NaN, anche con aspect", () => {
    for (const value of [NaN, Infinity, -1]) {
      expect(inkFit("scale", { width: 200, height: 100 }, { width: value, height: 100 }, 0.75)).toEqual({ s: 0, x: 0, y: 0 });
      expect(inkFit("scale", { width: value, height: 100 }, { width: 200, height: 100 }, 0.75)).toEqual({ s: 0, x: 0, y: 0 });
    }
  });

  it("il riquadro del contenuto è il più grande che entra, al centro", () => {
    expect(contentBox({ width: 600, height: 400 }, 0.75)).toEqual({ x: 150, y: 0, width: 300, height: 400 });
    expect(contentBox({ width: 300, height: 300 }, 2)).toEqual({ x: 0, y: 75, width: 300, height: 150 });
    expect(contentBox({ width: 300, height: 300 }, 0)).toBeNull();
    expect(contentBox({ width: NaN, height: 300 }, 1)).toBeNull();
  });

  it("ridimensionare la scheda a un'altra proporzione e tornare dà lo stesso inchiostro", () => {
    const ref = { width: 600, height: 400 };
    const before = inkFit("scale", ref, { width: 300, height: 200 }, 0.75);
    inkFit("scale", ref, { width: 900, height: 120 }, 0.75);
    expect(inkFit("scale", ref, { width: 300, height: 200 }, 0.75)).toEqual(before);
  });
});

describe("la misura dell'inchiostro", () => {
  const ref = { width: 200, height: 100 };

  it("misure non finite o negative non danno mai NaN", () => {
    const bad = [NaN, Infinity, -Infinity, -1];
    for (const value of bad) {
      for (const size of [
        { width: value, height: 100 },
        { width: 100, height: value },
      ]) {
        expect(inkFit("scale", ref, size)).toEqual({ s: 0, x: 0, y: 0 });
      }
      for (const badRef of [
        { width: value, height: 100 },
        { width: 100, height: value },
      ]) {
        expect(inkFit("scale", badRef, { width: 400, height: 300 })).toEqual({ s: 0, x: 0, y: 0 });
      }
    }
    expect(inkFit("scale", { width: 0, height: 100 }, { width: 400, height: 300 })).toEqual({ s: 0, x: 0, y: 0 });
    const zero = inkFit("scale", ref, { width: 0, height: 0 });
    expect(zero).toEqual({ s: 0, x: 0, y: 0 });
  });

  it("fixed non guarda la misura", () => {
    for (const size of [
      { width: 0, height: 0 },
      { width: NaN, height: 10 },
      { width: 1e6, height: 3 },
    ]) {
      expect(inkFit("fixed", ref, size)).toEqual({ s: 1, x: 0, y: 0 });
    }
  });

  it("ridimensionare a un'altra proporzione e tornare dà lo stesso inchiostro", () => {
    const before = inkFit("scale", ref, { width: 300, height: 150 });
    inkFit("scale", ref, { width: 900, height: 120 });
    const after = inkFit("scale", ref, { width: 300, height: 150 });
    expect(after).toEqual(before);
    expect(fitPoint(after, 40, 20)).toEqual(fitPoint(before, 40, 20));
  });

  it("un gruppo che contiene un'immagine è fermo; l'immagine scala", () => {
    expect(inkFitMode({ type: "group" })).toBe("fixed");
    expect(inkFitMode({ type: "file", file: "Gruppo/foto.png" })).toBe("scale");
  });

  it("un file rinominato da .png a .md cambia modo", () => {
    expect(inkFitMode({ type: "file", file: "Appunti/schizzo.png" })).toBe("scale");
    expect(inkFitMode({ type: "file", file: "Appunti/schizzo.md" })).toBe("fixed");
  });

  it("un campo file che non è una stringa vale come assente", () => {
    expect(inkFitMode({ type: "file", file: 42 as unknown as string })).toBe("fixed");
  });
});
