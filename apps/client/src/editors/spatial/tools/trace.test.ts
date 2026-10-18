// Il ricalco: sul corpus, quanto il ricalco ridisegnato somiglia alle forme
// da cui viene l'immagine e quanti nodi gli bastano; i casi esatti di un
// quadrato, dei buchi, del bianco, del trasparente, dei bordi e di un
// tratto sottile; e le garanzie della pila: nessuna fessura fra le forme,
// mai più forme del limite, sempre lo stesso ricalco.

import { describe, expect, it } from "vitest";
import { flatten, type Segment } from "../scene/geometry";
import { IDENTITY } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { presetSettings, trace, noiseOf, toleranceOf, MAX_SHAPES, type TraceSettings } from "./trace";
import { circle, corpus, curvePoints, fidelity, flat, logo, photo, polygon, rasterize, stroke, type Figure } from "./trace-corpus";
import { inkThreshold, working, WORK_PIXELS, type Raster, type Rgb } from "./trace-pixels";

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/// Il ricalco ridisegnato come l'immagine, sul bianco.
function redrawn(raster: Raster, settings: TraceSettings): { readonly traced: ReturnType<typeof trace>; readonly back: Raster } {
  const traced = trace(raster, settings);
  const figures: Figure[] = traced.shapes.map((s) => ({ paint: s.color, segments: s.segments }));
  return { traced, back: rasterize(figures, traced.width, traced.height, WHITE) };
}

/// L'area con segno di ogni sottotracciato, positiva in senso orario
/// sullo schermo, dove l'asse y scende.
function signedAreas(segments: readonly Segment[]): number[] {
  return flatten(segments, IDENTITY).map((points) => {
    let area = 0;
    for (let k = 0; k < points.length; k++) {
      const [a, b] = [points[k]!, points[(k + 1) % points.length]!];
      area += a[0] * b[1] - b[0] * a[1];
    }
    return area / 2;
  });
}

/// Quanto i punti di `segments` si scostano dal cerchio, in media e al più.
function offCircle(segments: readonly Segment[], cx: number, cy: number, r: number): { readonly mean: number; readonly most: number } {
  const offs = flatten(segments, IDENTITY).flat().map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r));
  return { mean: offs.reduce((a, b) => a + b, 0) / offs.length, most: Math.max(...offs) };
}

/// Un'immagine di `width` per `height`, coi pixel di `paint`.
function filled(width: number, height: number, paint: (x: number, y: number) => readonly [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

describe("il corpus", () => {
  // La differenza media dalle forme vere, da 0 a 255, e i nodi, al più; le
  // forme, esatte dove l'immagine le conta.
  const limits: Record<string, { readonly error: number; readonly nodes: number; readonly shapes?: number }> = {
    logo: { error: 0.5, nodes: 50, shapes: 8 },
    linee: { error: 0.8, nodes: 90, shapes: 3 },
    piatto: { error: 0.65, nodes: 60, shapes: 7 },
    schizzo: { error: 2.3, nodes: 78, shapes: 3 },
    foto: { error: 1.6, nodes: 3300 },
    scalini: { error: 0.65, nodes: 38, shapes: 3 },
  };
  for (const sample of corpus()) {
    it(`ricalca «${sample.name}» fedele e con pochi nodi`, () => {
      const { traced, back } = redrawn(sample.raster, presetSettings(sample.preset, sample.raster));
      const truth = rasterize(sample.figures, sample.raster.width, sample.raster.height, WHITE);
      const limit = limits[sample.name]!;
      expect(fidelity(truth, back).meanError).toBeLessThan(limit.error);
      expect(traced.nodes).toBeLessThanOrEqual(limit.nodes);
      if (limit.shapes !== undefined) expect(traced.shapes.length).toBe(limit.shapes);
    });
  }
});

describe("i casi esatti", () => {
  it("un quadrato senza antialiasing è quattro linee sui suoi lati", () => {
    const raster = filled(50, 40, (x, y) => (x >= 10 && x < 40 && y >= 10 && y < 30 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const traced = trace(raster, presetSettings("bw", raster));
    expect(traced.shapes.length).toBe(1);
    expect(pathData(traced.shapes[0]!.segments)).toBe("M10 10 L40 10 L40 30 L10 30 Z");
    expect(traced.nodes).toBe(4);
  });

  it("lungo il bordo dell'immagine il contorno resta sul bordo, senza nodi in più", () => {
    const raster = filled(50, 40, (x, y) => (x < 20 && y < 15 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const traced = trace(raster, presetSettings("bw", raster));
    expect(traced.shapes.length).toBe(1);
    const points = flatten(traced.shapes[0]!.segments, IDENTITY)[0]!;
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
    }
    expect(Math.min(...points.map((p) => p[0]))).toBe(0);
    expect(Math.min(...points.map((p) => p[1]))).toBe(0);
    // Dove la forma tocca il bordo non resta un nodo a metà di un lato.
    for (const preset of ["bw", "colors"] as const) {
      const half = filled(40, 20, (x) => (x < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
      const again = trace(half, presetSettings(preset, half));
      expect(pathData(again.shapes[0]!.segments)).toBe("M0 0 L20 0 L20 20 L0 20 Z");
      expect(again.nodes).toBe(4);
    }
  });

  it("un bordo con l'antialiasing dà la curva al decimo di pixel", () => {
    const [cx, cy, r] = [32.3, 31.7, 20];
    const raster = rasterize([{ paint: BLACK, segments: circle([cx, cy], r) }], 64, 64, WHITE);
    const settings = { ...presetSettings("bw", raster), detail: 100 };
    const traced = trace(raster, settings);
    expect(traced.shapes.length).toBe(1);
    const off = offCircle(traced.shapes[0]!.segments, cx, cy, r);
    expect(off.mean).toBeLessThan(0.1);
    expect(off.most).toBeLessThan(toleranceOf(settings.detail));
  });

  it("un tratto sottile resta spesso com'era, entro un quinto di pixel", () => {
    const ink = (raster: Raster): number => {
      let sum = 0;
      for (let i = 0; i < raster.data.length; i += 4) sum += (255 - raster.data[i]!) / 255;
      return sum;
    };
    for (const width of [1.5, 2, 3, 4]) {
      const figures: Figure[] = [{ paint: BLACK, segments: stroke(curvePoints([20, 60], [120, 20], [260, 100], [380, 40]), width) }];
      const raster = rasterize(figures, 400, 120, WHITE);
      const { back } = redrawn(raster, presetSettings("bw", raster));
      const length = ink(raster) / width;
      expect(Math.abs(ink(back) - ink(raster)) / length).toBeLessThan(0.2);
    }
  });

  it("i buchi girano al contrario, e si dipinge uguale con nonzero ed evenodd", () => {
    const ring = trace(logo().raster, presetSettings("bw", logo().raster)).shapes.find((s) => signedAreas(s.segments).length === 2);
    expect(ring).toBeDefined();
    const [outer, hole] = signedAreas(ring!.segments);
    expect(outer).toBeGreaterThan(0);
    expect(hole).toBeLessThan(0);
  });

  it("il bianco ignorato non diventa una forma, e senza lo è", () => {
    const sample = flat();
    const settings = presetSettings("colors", sample.raster);
    const white = (shapes: readonly { readonly color: Rgb }[]): number => shapes.filter((s) => s.color.every((c) => c > 240)).length;
    expect(white(trace(sample.raster, settings).shapes)).toBe(0);
    expect(white(trace(sample.raster, { ...settings, ignoreWhite: false }).shapes)).toBeGreaterThan(0);
  });

  it("il trasparente non è una forma, e il bordo verso di lui segue l'alfa", () => {
    const raster = rasterize([{ paint: [200, 30, 40], segments: circle([30.4, 29.6], 18) }], 60, 60, null);
    for (const ignoreWhite of [true, false]) {
      const settings = { ...presetSettings("colors", raster), detail: 100, ignoreWhite };
      const traced = trace(raster, settings);
      expect(traced.shapes.length).toBe(1);
      expect(traced.shapes[0]!.color[0]).toBeGreaterThan(180);
      const off = offCircle(traced.shapes[0]!.segments, 30.4, 29.6, 18);
      expect(off.mean).toBeLessThan(0.1);
      expect(off.most).toBeLessThan(toleranceOf(settings.detail));
    }
  });

  it("un bordo morbido fra due colori non diventa una striscia di un terzo", () => {
    // Rosso a sinistra, blu a destra, e quattro pixel che sfumano.
    const raster = filled(80, 40, (x) => {
      const t = Math.min(1, Math.max(0, (x - 38) / 4));
      return [Math.round(220 * (1 - t) + 30 * t), 40, Math.round(40 * (1 - t) + 200 * t), 255];
    });
    for (const preset of ["colors", "photo"] as const) {
      const traced = trace(raster, { ...presetSettings(preset, raster), colors: 3, ignoreWhite: false });
      expect(traced.shapes.length).toBe(2);
    }
  });
});

describe("la pila", () => {
  it("fra le forme di una foto non resta nessuna fessura", () => {
    for (const sample of [photo(), flat()]) {
      const settings = { ...presetSettings(sample.preset, sample.raster), ignoreWhite: false };
      const traced = trace(sample.raster, settings);
      const ink = rasterize(traced.shapes.map((s): Figure => ({ paint: BLACK, segments: s.segments })), traced.width, traced.height, WHITE);
      let open = 0;
      for (let i = 0; i < ink.data.length; i += 4) if (ink.data[i]! > 127) open++;
      expect(open).toBe(0);
    }
  });

  it("non fa mai più forme del limite", () => {
    const sample = photo();
    const settings = { ...presetSettings("photo", sample.raster), detail: 100 };
    expect(trace(sample.raster, settings, 10).shapes.length).toBeLessThanOrEqual(10);
    expect(trace(sample.raster, settings).shapes.length).toBeLessThanOrEqual(MAX_SHAPES);
  });

  it("ricalca sempre uguale", () => {
    const sample = photo();
    const settings = presetSettings("photo", sample.raster);
    expect(JSON.stringify(trace(sample.raster, settings))).toBe(JSON.stringify(trace(sample.raster, settings)));
  });

  it("le forme vanno dalla più grande alla più piccola", () => {
    const traced = trace(flat().raster, presetSettings("colors", flat().raster));
    const boxes = traced.shapes.map((s) => {
      const points = flatten(s.segments, IDENTITY).flat();
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    });
    for (let k = 1; k < boxes.length; k++) expect(boxes[k]!).toBeLessThanOrEqual(boxes[k - 1]! + 8);
  });
});

describe("le impostazioni", () => {
  it("la soglia del bianco e nero divide il nero dal bianco a metà", () => {
    const raster = filled(10, 10, (x) => (x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect(presetSettings("bw", raster).threshold).toBe(128);
    expect(inkThreshold(new Float32Array([0, 0, 255, 255]))).toBe(128);
    // Un inchiostro grigio su una carta grigia, con pochi pixel di bordo.
    expect(inkThreshold(new Float32Array([40, 40, 40, 60, 220, 220, 220, 220, 220, 220]))).toBe(130);
    expect(inkThreshold(new Float32Array([90, 90, 90]))).toBe(128);
  });

  it("più dettaglio, tolleranza e rumore più piccoli", () => {
    const at = (detail: number): TraceSettings => ({ ...presetSettings("bw", null), detail });
    expect(toleranceOf(0)).toBeCloseTo(2.5);
    expect(toleranceOf(100)).toBeCloseTo(0.25);
    expect(noiseOf(at(0), 1000)).toBeGreaterThan(noiseOf(at(50), 1000));
    expect(noiseOf(at(50), 1000)).toBeGreaterThan(noiseOf(at(100), 1000));
  });

  it("il rumore di una foto cresce con l'area, quello di una scansione no", () => {
    const photoAt = presetSettings("photo", null);
    const bw = presetSettings("bw", null);
    expect(Math.abs(noiseOf(photoAt, 400_000) - 4 * noiseOf(photoAt, 100_000))).toBeLessThanOrEqual(2);
    expect(noiseOf(bw, 400_000)).toBe(noiseOf(bw, 100_000));
  });
});

describe("la risoluzione di lavoro", () => {
  it("un'immagine grande si rimpicciolisce con le sue proporzioni", () => {
    const raster = filled(3000, 1000, () => [10, 200, 30, 255]);
    const work = working(raster);
    expect(work.width * work.height).toBeLessThanOrEqual(WORK_PIXELS);
    expect(work.width / work.height).toBeCloseTo(3, 2);
    expect([...work.data.subarray(0, 4)]).toEqual([10, 200, 30, 255]);
    expect(working(work)).toBe(work);
  });

  it("la media non prende il colore dei pixel trasparenti", () => {
    // Una scacchiera di rosso e di trasparente nero, rimpicciolita a metà.
    const raster = filled(2000, 2000, (x, y) => ((x + y) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const work = working(raster, 1_000_000);
    const [r, g, b, a] = work.data.subarray(0, 4);
    expect([r, g, b]).toEqual([255, 0, 0]);
    expect(a).toBeGreaterThan(120);
    expect(a).toBeLessThan(136);
  });

  it("il ricalco di un'immagine grande sta nei pixel di lavoro", () => {
    const big = rasterize([{ paint: BLACK, segments: polygon([[200, 200], [1800, 300], [1000, 1700]]) }], 2000, 2000, WHITE);
    const traced = trace(big, presetSettings("bw", big));
    expect(traced.width * traced.height).toBeLessThanOrEqual(WORK_PIXELS);
    expect(traced.shapes.length).toBe(1);
    expect(traced.nodes).toBe(3);
  });
});
