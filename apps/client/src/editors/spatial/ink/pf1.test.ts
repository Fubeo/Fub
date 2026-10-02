import { getStroke } from "perfect-freehand";
import { describe, expect, it } from "vitest";
import { parseBrush, PF1_DEFAULTS } from "./brush";
import { outlinePath, pf1, pf1Outline, strokeOptions } from "./pf1";
import { dequantizeSample, INK_MAX_SAMPLES, type InkSample, quantizeInk, type QuantizedInk } from "./sample";

// Il contorno di riferimento: se cambia, è cambiato `pf1`, cioè ogni `d` già
// scritto nei file non è più quello che FubDraw ricalcola. Non si aggiorna
// per far passare la prova: si capisce prima che cosa è cambiato (la
// libreria, l'arrotondamento, la forma del percorso).
const GOLDEN_PEN = [
  "M120.21 28.2", "Q120.77 28.12 121.1 28.13", "Q121.43 28.13 121.74 28.25", "Q122.04 28.36 122.3 28.56",
  "Q122.55 28.76 122.73 29.04", "Q122.91 29.31 122.99 29.63", "Q123.07 29.94 123.05 30.27",
  "Q123.02 30.59 122.9 30.9", "Q122.77 31.2 122.56 31.45", "Q122.34 31.69 122.06 31.85",
  "Q121.77 32.01 121.45 32.08", "Q121.13 32.14 120.81 32.1", "Q120.48 32.05 120.19 31.91",
  "Q119.89 31.77 119.66 31.54", "Q119.43 31.31 119.28 31.02", "Q119.13 30.73 119.09 30.41",
  "Q119.04 30.08 119.1 29.76", "Q119.16 29.44 119.32 29.15", "Q119.48 28.86 119.72 28.65",
  "Q119.96 28.43 120.26 28.3", "Q120.56 28.16 120.89 28.14", "Q121.21 28.11 121.53 28.19",
  "Q121.85 28.26 122.13 28.44", "Q122.4 28.61 122.61 28.87", "Q122.81 29.12 122.93 29.43",
  "Q123.04 29.73 123.05 30.06", "Q123.06 30.38 122.97 30.7", "Q122.87 31.01 122.69 31.28",
  "Q122.5 31.54 122.24 31.73", "Q121.97 31.92 121.66 32.02", "Q121.35 32.12 121.11 32.2",
  "Q120.86 32.27 120.61 32.28", "Q120.36 32.29 120.11 32.25", "Q119.86 32.2 119.63 32.1",
  "Q119.4 31.99 119.21 31.83", "Q119.01 31.67 118.86 31.47", "Q118.7 31.27 118.6 31.04",
  "Q118.49 30.81 118.45 30.56", "Q118.41 30.31 118.43 30.06", "Q118.44 29.81 118.52 29.57",
  "Q118.59 29.32 118.73 29.11", "Q118.86 28.89 119.04 28.72", "Q119.22 28.54 119.44 28.41",
  "Q119.65 28.28 120.21 28.2", "Z"
].join(" ");

const GOLDEN_TAPER = [
  "M0 0", "Q0 -0.01 3.21 0.95", "Q6.42 1.9 9.55 3.8", "Q12.68 5.69 15.81 8.31", "Q18.94 10.93 21.59 14.27",
  "Q24.23 17.61 26.26 21.32", "Q28.29 25.03 29.75 31.27", "Q31.21 37.5 31.21 37.5", "Q31.2 37.5 31.2 37.5",
  "Q31.19 37.5 29.18 31.57", "Q27.17 25.63 25.19 22.03", "Q23.21 18.42 20.65 15.19", "Q18.08 11.96 15.02 9.42",
  "Q11.96 6.88 8.91 5.07", "Q5.85 3.25 2.93 1.63", "Q0 0.01 0 0", "Z"
].join(" ");

const SINGLE = [
  "M11.42 8.58", "Q12.42 9.58 12.61 9.85", "Q12.8 10.11 12.9 10.42", "Q12.99 10.73 12.98 11.06",
  "Q12.97 11.38 12.86 11.69", "Q12.74 11.99 12.54 12.24", "Q12.34 12.49 12.07 12.67", "Q11.79 12.84 11.48 12.92",
  "Q11.16 13 10.84 12.97", "Q10.52 12.94 10.22 12.82", "Q9.92 12.69 9.68 12.48", "Q9.44 12.26 9.28 11.98",
  "Q9.12 11.69 9.06 11.37", "Q9 11.05 9.04 10.73", "Q9.08 10.41 9.23 10.12", "Q9.37 9.83 9.6 9.6",
  "Q9.83 9.37 10.12 9.23", "Q10.41 9.08 10.73 9.04", "Q11.05 9 11.37 9.06", "Q11.69 9.12 11.98 9.28",
  "Q12.26 9.44 12.48 9.68", "Q12.69 9.92 12.82 10.22", "Q12.94 10.52 12.97 10.84", "Q13 11.16 12.92 11.48",
  "Q12.84 11.79 12.67 12.07", "Q12.49 12.34 12.24 12.54", "Q11.99 12.74 11.69 12.86", "Q11.38 12.97 11.06 12.98",
  "Q10.73 12.99 10.42 12.89", "Q10.11 12.79 9.85 12.61", "Q9.58 12.42 9.3 12.34", "Q9.02 12.25 8.77 12.1",
  "Q8.51 11.95 8.3 11.74", "Q8.09 11.53 7.93 11.28", "Q7.77 11.03 7.68 10.75", "Q7.59 10.47 7.57 10.18",
  "Q7.55 9.88 7.6 9.59", "Q7.65 9.29 7.77 9.02", "Q7.89 8.75 8.07 8.52", "Q8.25 8.28 8.48 8.1",
  "Q8.71 7.91 8.98 7.79", "Q9.25 7.67 9.54 7.61", "Q9.83 7.55 10.13 7.57", "Q10.42 7.58 11.42 8.58", "Z"
].join(" ");

const TWIN = [
  "M11.67 8.99", "Q11.91 9.4 11.94 9.88", "Q11.97 10.36 11.78 10.8", "Q11.58 11.24 11.2 11.54",
  "Q10.82 11.83 10.35 11.92", "Q9.88 12 9.42 11.86", "Q8.96 11.71 8.62 11.38", "Q8.28 11.04 8.14 10.58",
  "Q8 10.12 8.09 9.65", "Q8.17 9.18 8.47 8.8", "Q8.76 8.42 9.2 8.23", "Q9.64 8.03 10.12 8.06",
  "Q10.6 8.09 11.01 8.34", "Q11.42 8.58 11.67 8.99", "Z"
].join(" ");

const PEN = parseBrush("pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0");
const TAPER = parseBrush(
  "pf1 size=3 thinning=0.6 smoothing=0.5 streamline=0.4 taperStart=10 taperEnd=12 capStart=0 capEnd=0 sim=1",
);

const PEN_SAMPLES: InkSample[] = [
  { x: 120.5, y: 30.2, p: 0.5, t: 0 },
  { x: 120.75, y: 30.17, p: 0.51, t: 8 },
  { x: 121.06, y: 30.12, p: 0.51, t: 16 },
];

/// Un arco senza pressione, a s10.
const TAPER_SAMPLES: InkSample[] = [
  [0, 0], [4.1, 1.3], [9.25, 3.9], [15.5, 8.2], [21.7, 14.1], [26.4, 21.35], [29.8, 29.05], [31.2, 37.5],
].map(([x, y], i) => ({ x: x!, y: y!, t: i * 8 }));

/// Ogni numero di `d` come lo vuole §7: al più due decimali, niente zeri
/// finali, niente esponente, niente `-0`, lo zero prima del punto.
const CANONICAL = /^-?(?:0|[1-9]\d*)(?:\.\d?[1-9])?$/;

function expectWellFormed(d: string): void {
  const tokens = d.split(" ");
  expect(tokens[0]!.startsWith("M")).toBe(true);
  expect(tokens[tokens.length - 1]).toBe("Z");
  const numbers = tokens.slice(0, -1).map((token) => token.replace(/^[MQ]/, ""));
  for (const number of numbers) {
    expect(number).toMatch(CANONICAL);
    expect(number).not.toBe("-0");
  }
  // M x y, poi Q con quattro numeri per vertice.
  expect((numbers.length - 2) % 4).toBe(0);
  // Il percorso torna esattamente al punto di partenza.
  expect(`M${numbers[numbers.length - 2]} ${numbers[numbers.length - 1]}`).toBe(tokens.slice(0, 2).join(" "));
}

/// Un tratto lungo e vario: coordinate negative, pressione che cambia.
function longStroke(count: number): InkSample[] {
  const samples: InkSample[] = [];
  for (let i = 0; i < count; i++) {
    samples.push({
      x: i * 0.37 + Math.sin(i / 40) * 25 - 1000,
      y: Math.cos(i / 55) * 60 + i * 0.05,
      p: 0.3 + 0.4 * Math.abs(Math.sin(i / 300)),
      t: i * 4,
    });
  }
  return samples;
}

describe("pf1: d dai campioni quantizzati (§5)", () => {
  it("dà il contorno di riferimento per un tratto di penna", () => {
    const ink = quantizeInk(PEN_SAMPLES);
    expect(ink.samples).toEqual([
      { x: 12050, y: 3020, p: 128, t: 0 },
      { x: 12075, y: 3017, p: 130, t: 8 },
      { x: 12106, y: 3012, p: 130, t: 16 },
    ]);
    expect(pf1(ink, PEN)).toBe(GOLDEN_PEN);
    expectWellFormed(GOLDEN_PEN);
  });

  it("dà il contorno di riferimento con assottigliamento e pressione simulata, senza p, a s10", () => {
    const ink = quantizeInk(TAPER_SAMPLES, 10);
    expect(ink.samples.every((sample) => sample.p === undefined)).toBe(true);
    expect(pf1(ink, TAPER)).toBe(GOLDEN_TAPER);
    expectWellFormed(GOLDEN_TAPER);
  });

  it("è deterministico, e i campioni riletti dal file danno lo stesso d", () => {
    const ink = quantizeInk(PEN_SAMPLES);
    expect(pf1(ink, PEN)).toBe(pf1(ink, PEN));
    const copy: QuantizedInk = { scale: ink.scale, samples: ink.samples.map((sample) => ({ ...sample })) };
    expect(pf1(copy, PEN)).toBe(GOLDEN_PEN);
    // Quantizzato, riportato alle unità del dispositivo e quantizzato di
    // nuovo: gli stessi interi, quindi lo stesso d.
    const again = quantizeInk(ink.samples.map((sample) => dequantizeSample(sample, ink.scale)));
    expect(again).toEqual(ink);
    expect(pf1(again, PEN)).toBe(GOLDEN_PEN);
    const long = quantizeInk(longStroke(2000));
    const longAgain = quantizeInk(long.samples.map((sample) => dequantizeSample(sample, long.scale)));
    expect(pf1(longAgain, PEN)).toBe(pf1(long, PEN));
  });

  it("calcola d dagli interi del file, non dai numeri del dispositivo", () => {
    expect(() => pf1({ scale: 100, samples: PEN_SAMPLES }, PEN)).toThrow(RangeError);
    expect(() => pf1({ scale: 100, samples: [{ x: 1, y: 2, p: 0.5, t: 0 }] }, PEN)).toThrow(RangeError);
    expect(() => pf1({ scale: 100, samples: [{ x: 1, y: 2, p: 256, t: 0 }] }, PEN)).toThrow(RangeError);
    expect(() => pf1({ scale: 1 as 10, samples: [{ x: 1, y: 2, t: 0 }] }, PEN)).toThrow(RangeError);
    expect(() => pf1(quantizeInk(PEN_SAMPLES), { ...PEN, size: 0 })).toThrow(RangeError);
    const tooMany = Array.from({ length: INK_MAX_SAMPLES + 1 }, (_, i) => ({ x: i, y: 0, t: i }));
    expect(() => pf1({ scale: 100, samples: tooMany }, PEN)).toThrow(RangeError);
  });

  it("disegna un campione solo come lo disegna getStroke", () => {
    const d = pf1(quantizeInk([{ x: 10, y: 10, p: 0.5, t: 0 }]), PEN);
    expect(d).toBe(SINGLE);
    expectWellFormed(d);
  });

  it("disegna due campioni uguali come un punto tondo", () => {
    const d = pf1(quantizeInk([{ x: 10, y: 10, p: 0.5, t: 0 }, { x: 10, y: 10, p: 0.5, t: 8 }]), PEN);
    expect(d).toBe(TWIN);
    expectWellFormed(d);
    const xs = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
    // Centrato sul campione, con il diametro del pennello.
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(20, 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(PEN.size, 0);
  });

  it("regge 10 000 campioni, e il contorno resta ben formato", () => {
    const ink = quantizeInk(longStroke(INK_MAX_SAMPLES));
    expect(ink.samples).toHaveLength(INK_MAX_SAMPLES);
    const d = pf1(ink, PEN);
    expectWellFormed(d);
    // Il contorno di un tratto lungo sta sotto i 512 KiB di un attributo
    // (§11); un tratto patologico, tutto curve strette, può superarli.
    expect(d.length).toBeLessThan(512 * 1024);
    expect(pf1(ink, PEN)).toBe(d);
  });

  it("tratta le coordinate negative con la stessa regola, senza -0", () => {
    const ink = quantizeInk([
      { x: -50.25, y: -10.5, t: 0 },
      { x: -48, y: -12.75, t: 8 },
      { x: -45.5, y: -13, t: 16 },
    ]);
    const d = pf1(ink, parseBrush("pf1 size=6 sim=1"));
    expectWellFormed(d);
    expect(d.startsWith("M-51.49 -12.29 Q-51.27 -12.44 -48.87 -13.65 ")).toBe(true);
    // Lo stesso tratto spostato di un numero intero di centesimi ha lo stesso
    // contorno spostato: niente che dipenda dal segno.
    const shifted = quantizeInk([
      { x: 949.75, y: 989.5, t: 0 },
      { x: 952, y: 987.25, t: 8 },
      { x: 954.5, y: 987, t: 16 },
    ]);
    const outline = pf1Outline(ink, parseBrush("pf1 size=6 sim=1"));
    const moved = pf1Outline(shifted, parseBrush("pf1 size=6 sim=1"));
    expect(moved).toHaveLength(outline.length);
    for (let i = 0; i < outline.length; i++) {
      expect(moved[i]![0] - outline[i]![0]).toBeCloseTo(1000, 6);
      expect(moved[i]![1] - outline[i]![1]).toBeCloseTo(1000, 6);
    }
  });

  it("con sim=1 e senza p simula la pressione; con sim=0 la pressione conta", () => {
    const withoutP = quantizeInk(PEN_SAMPLES.map(({ x, y, t }) => ({ x, y, t })));
    const simulated = pf1(withoutP, { ...PEN, sim: true });
    expectWellFormed(simulated);
    expect(simulated).not.toBe(GOLDEN_PEN);
    const light = quantizeInk(PEN_SAMPLES.map((sample) => ({ ...sample, p: 0.1 })));
    const heavy = quantizeInk(PEN_SAMPLES.map((sample) => ({ ...sample, p: 0.9 })));
    expect(pf1(light, PEN)).not.toBe(pf1(heavy, PEN));
  });

  it("passa le opzioni a getStroke una per una, con la pressione p/255", () => {
    expect(strokeOptions(TAPER, true)).toEqual({
      size: 3,
      thinning: 0.6,
      smoothing: 0.5,
      streamline: 0.4,
      simulatePressure: true,
      start: { cap: false, taper: 10 },
      end: { cap: false, taper: 12 },
      last: true,
    });
    const ink = quantizeInk(PEN_SAMPLES);
    const points = ink.samples.map((sample) => [sample.x / 100, sample.y / 100, sample.p! / 255]);
    expect(pf1Outline(ink, PEN)).toEqual(getStroke(points, strokeOptions(PEN, true)));
    // Le chiavi mancanti valgono le opzioni omesse di getStroke.
    expect(pf1Outline(ink, PF1_DEFAULTS)).toEqual(getStroke(points, { last: true }));
  });

  it("last: false è il contorno dell'anteprima, che non arriva fino all'ultimo campione", () => {
    const ink = quantizeInk(TAPER_SAMPLES, 10);
    expect(pf1(ink, TAPER, { last: true })).toBe(GOLDEN_TAPER);
    expect(pf1(ink, TAPER, { last: false })).not.toBe(GOLDEN_TAPER);
  });
});

describe("outlinePath", () => {
  it("chiude il poligono con quadratiche per i punti medi", () => {
    expect(outlinePath([[0, 0], [10, 0], [10, 10]])).toBe("M5 5 Q0 0 5 0 Q10 0 10 5 Q10 10 5 5 Z");
  });

  it("arrotonda i vertici ai centesimi prima dei punti medi, con i mezzi verso l'alto anche sotto zero", () => {
    // I vertici in centesimi: (0, 0), (2, 0), (0, 1), (−1, 0). Il punto medio
    // fra −1 e 0 è −0,5 centesimi, che va verso l'alto: 0.
    expect(outlinePath([[0.004, 0], [0.015, 0], [0, 0.01], [-0.015, -0.005]]))
      .toBe("M0 0 Q0 0 0.01 0 Q0.02 0 0.01 0.01 Q0 0.01 0 0.01 Q-0.01 0 0 0 Z");
  });

  it("toglie i vertici ripetuti e la chiusura ripetuta; sotto tre vertici d è vuoto", () => {
    expect(outlinePath([[0, 0], [0.001, 0], [10, 0], [10, 0], [10, 10], [0, 0.002]]))
      .toBe(outlinePath([[0, 0], [10, 0], [10, 10]]));
    expect(outlinePath([])).toBe("");
    expect(outlinePath([[1, 1]])).toBe("");
    expect(outlinePath([[1, 1], [2, 2], [1.001, 1.004]])).toBe("");
  });

  it("rifiuta un vertice non finito", () => {
    expect(() => outlinePath([[0, 0], [Number.NaN, 1], [2, 2]])).toThrow(RangeError);
  });
});
