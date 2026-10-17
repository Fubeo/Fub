// Il contorno incrementale è `getStroke`, numero per numero, a ogni prefisso.
//
// Ogni caso aggiunge i campioni uno alla volta e, dopo ognuno, confronta il
// contorno con quello che `getStroke` dà per gli stessi campioni, con e senza
// una coda di campioni predetti. I tratti sono costruiti per passare da ogni
// ramo della libreria: gli spigoli, la lunghezza minima dell'inizio, i
// doppioni, lo scarto del rumore alla fine, gli assottigliamenti, le estremità
// piatte, la pressione simulata e quella che manca.

import { describe, expect, it } from "vitest";
import { getStroke } from "perfect-freehand";
import { PF1_DEFAULTS, type Pf1Brush } from "./brush";
import { Pf1Live, type Pf1Input } from "./pf1-live";
import { strokeOptions } from "./pf1";

/// Un generatore ripetibile (mulberry32).
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Stroke = Pf1Input[];

/// I tratti: ognuno con la pressione e senza.
function strokes(): Array<readonly [string, Stroke]> {
  const next = random(7);
  const curve: Stroke = Array.from({ length: 180 }, (_, i) => [200 + 80 * Math.cos(i * 0.05), 150 + 60 * Math.sin(i * 0.07), 0.2 + 0.6 * next()]);
  // Avanti e indietro: ogni giro è uno spigolo.
  const zigzag: Stroke = Array.from({ length: 160 }, (_, i) => [(i % 20 < 10 ? i % 10 : 10 - (i % 10)) * 6, i * 0.8, 0.5]);
  // Fermo all'inizio, sotto la lunghezza minima, poi via.
  const slow: Stroke = [
    ...Array.from({ length: 30 }, (_, i) => [10 + i * 0.05, 10 + i * 0.03, 0.4]),
    ...Array.from({ length: 120 }, (_, i) => [12 + i * 1.7, 11 + Math.sin(i / 5) * 9, 0.3 + (i % 7) / 10]),
  ];
  // Campioni ripetuti, anche di fila.
  const repeated: Stroke = Array.from({ length: 150 }, (_, i) => {
    const k = Math.floor(i / 3);
    return [k * 2.5, Math.cos(k / 4) * 12, 0.6];
  });
  // Un cammino a caso, con passi grandi e piccoli e qualche inversione.
  let x = 0;
  let y = 0;
  const walk: Stroke = Array.from({ length: 200 }, () => {
    const big = next() < 0.1;
    x += (next() - 0.5) * (big ? 40 : 4);
    y += (next() - 0.5) * (big ? 40 : 4);
    return [x, y, next()];
  });
  // Un giro secco su se stesso.
  const reversal: Stroke = [
    ...Array.from({ length: 60 }, (_, i) => [i * 2, 0, 0.7]),
    ...Array.from({ length: 60 }, (_, i) => [118 - i * 2, 0.5, 0.7]),
  ];
  const all: Array<readonly [string, Stroke]> = [
    ["una curva", curve],
    ["uno zigzag", zigzag],
    ["un inizio lento", slow],
    ["dei doppioni", repeated],
    ["un cammino a caso", walk],
    ["un giro secco", reversal],
  ];
  return all.flatMap(([name, stroke]) => [
    [name, stroke] as const,
    [`${name}, senza pressione`, stroke.map(([px, py]) => [px!, py!])] as const,
  ]);
}

const BRUSHES: Array<readonly [string, Pf1Brush]> = [
  ["la penna", { ...PF1_DEFAULTS, size: 4, sim: false }],
  ["la pressione simulata", { ...PF1_DEFAULTS, size: 4, sim: true }],
  ["senza assottigliamento", { ...PF1_DEFAULTS, size: 6, thinning: 0, sim: false }],
  ["l'assottigliamento al contrario", { ...PF1_DEFAULTS, size: 5, thinning: -0.6, sim: true }],
  ["le punte assottigliate", { ...PF1_DEFAULTS, size: 8, taperStart: 12, taperEnd: 20, sim: false }],
  ["le estremità piatte", { ...PF1_DEFAULTS, size: 12, capStart: false, capEnd: false, thinning: 0, sim: false }],
  ["niente morbidezza né inseguimento", { ...PF1_DEFAULTS, size: 3, smoothing: 0, streamline: 0, sim: false }],
  ["inseguimento pieno", { ...PF1_DEFAULTS, size: 16, smoothing: 1, streamline: 1, sim: true }],
  ["sottile", { ...PF1_DEFAULTS, size: 0.5, sim: false }],
];

describe("il contorno incrementale", () => {
  for (const [brushName, brush] of BRUSHES) {
    for (const [strokeName, stroke] of strokes()) {
      it(`${brushName}, ${strokeName}`, () => {
        const options = strokeOptions(brush, false);
        const live = new Pf1Live(brush);
        const tails = random(stroke.length * 31 + brush.size * 7);
        for (let k = 0; k < stroke.length; k++) {
          live.push(stroke[k]!);
          const prefix = stroke.slice(0, k + 1) as number[][];
          expect(live.outline([])).toEqual(getStroke(prefix, options));
          // Qualche campione predetto, vicino all'ultimo.
          const [lx, ly] = stroke[k]!;
          const tail: Pf1Input[] = Array.from({ length: Math.floor(tails() * 4) }, (_, j) => {
            const point = [lx! + (j + 1) * (tails() * 6 - 3), ly! + (j + 1) * (tails() * 6 - 3)];
            return stroke[k]!.length === 3 ? [...point, tails()] : point;
          });
          expect(live.outline(tail)).toEqual(getStroke([...prefix, ...tail] as number[][], options));
        }
        // Il prefisso c'è stato davvero: il confronto non è la libreria con se stessa.
        expect(live.frozen).toBeGreaterThan(0);
      });
    }
  }

  it("senza campioni non c'è contorno, e i primi seguono la libreria", () => {
    const brush = { ...PF1_DEFAULTS, size: 4, sim: false };
    const live = new Pf1Live(brush);
    expect(live.outline([])).toEqual([]);
    expect(live.outline([[1, 2, 0.5]])).toEqual(getStroke([[1, 2, 0.5]], strokeOptions(brush, false)));
    live.push([1, 2, 0.5]);
    expect(live.outline([])).toEqual(getStroke([[1, 2, 0.5]], strokeOptions(brush, false)));
    live.push([1, 2, 0.5]);
    expect(live.outline([[4, 5, 0.5]])).toEqual(getStroke([[1, 2, 0.5], [1, 2, 0.5], [4, 5, 0.5]], strokeOptions(brush, false)));
    expect(live.length).toBe(2);
  });

  it("un pennello non valido non costruisce niente", () => {
    expect(() => new Pf1Live({ ...PF1_DEFAULTS, size: 0 })).toThrow(RangeError);
  });

  it("un tratto lungo rifà soltanto la coda", () => {
    const brush = { ...PF1_DEFAULTS, size: 4, sim: false };
    const live = new Pf1Live(brush);
    for (let i = 0; i < 2_000; i++) live.push([i * 2, Math.sin(i / 9) * 20, 0.5]);
    // Tutti i punti tranne quelli entro `max(3, taperEnd)` dalla fine.
    expect(live.frozen).toBeGreaterThan(1_990);
    expect(live.outline([])).toEqual(getStroke(Array.from({ length: 2_000 }, (_, i) => [i * 2, Math.sin(i / 9) * 20, 0.5]), strokeOptions(brush, false)));
  });
});
