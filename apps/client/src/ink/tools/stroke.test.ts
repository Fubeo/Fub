import { describe, expect, it } from "vitest";
import { PF1_DEFAULTS, type Pf1Brush } from "../brush";
import { mappedSamples, type Affine } from "../geometry";
import { pf1Outline } from "../pf1";
import { INK_MAX_SAMPLES, quantizeInk, type InkSample } from "../sample";
import { buildStroke, previewOutline } from "./stroke";

const brush: Pf1Brush = { ...PF1_DEFAULTS, size: 4, sim: false };

const line = (n: number): InkSample[] =>
  Array.from({ length: n }, (_, i): InkSample => ({ x: i * 2, y: Math.sin(i / 3) * 5, t: i * 8, p: 0.3 + ((i * 7) % 10) / 20 }));

describe("l'anteprima del tratto in corso", () => {
  it("senza campioni non c'è niente da disegnare", () => {
    expect(previewOutline([], [], brush, false)).toEqual([]);
    expect(previewOutline([], [], brush, true)).toEqual([]);
  });

  it("è il contorno dei campioni più quelli previsti, senza la punta finale", () => {
    const local = line(12);
    const predicted = [{ x: 24, y: 1, t: 96, p: 0.5 }, { x: 26, y: 2, t: 104, p: 0.5 }];
    expect(previewOutline(local, predicted, brush, false)).toEqual(
      pf1Outline(quantizeInk([...local, ...predicted]), brush, { last: false }),
    );
    // Senza le previsioni è un altro contorno: il browser le dà in anticipo.
    expect(previewOutline(local, [], brush, false)).not.toEqual(previewOutline(local, predicted, brush, false));
  });

  it("le previsioni che farebbero superare il limite dei campioni restano fuori", () => {
    const local = line(INK_MAX_SAMPLES);
    const predicted = [{ x: 1e4, y: 0, t: 1e6 }];
    expect(previewOutline(local, predicted, brush, false)).toEqual(previewOutline(local, [], brush, false));
  });

  it("dritto va dal primo all'ultimo campione e ignora le previsioni", () => {
    const local = line(10);
    const straightOutline = previewOutline(local, [{ x: 500, y: 500, t: 1e3 }], brush, true);
    expect(straightOutline.length).toBeGreaterThan(0);
    expect(straightOutline).toEqual(previewOutline(local, [], brush, true));
    expect(straightOutline).not.toEqual(previewOutline(local, [], brush, false));
  });

  it("un campione che l'inchiostro non scrive dà un'anteprima vuota, non un'eccezione", () => {
    expect(previewOutline([{ x: Number.NaN, y: 0, t: 0 }], [], brush, false)).toEqual([]);
    expect(previewOutline([{ x: 0, y: 0, t: 0 }, { x: 1e300, y: 0, t: 1 }], [], brush, false)).toEqual([]);
  });

  it("è deterministica", () => {
    const local = line(200);
    expect(previewOutline(local, [], brush, false)).toEqual(previewOutline(local, [], brush, false));
  });
});

describe("il tratto finito", () => {
  const mirror: Affine = [-1, 0, 0, 1, 100, 0];
  const turned: Affine = [0, 1, -1, 0, 0, 0];

  it("dà inchiostro e contorno, quelli che il formato e il disegno scrivono", () => {
    const samples = line(30);
    const built = buildStroke(samples, brush, []);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.ink).toEqual(quantizeInk(samples));
    expect(built.outline).toEqual(pf1Outline(quantizeInk(samples), brush));
    expect(built.copies).toEqual([]);
  });

  it("le copie sono il tratto portato dalla trasformazione, un tratto vero col suo inchiostro", () => {
    const samples = line(30);
    const built = buildStroke(samples, brush, [mirror, turned]);
    if (!built.ok) throw new Error("doveva scriversi");
    expect(built.copies.map((copy) => copy.matrix)).toEqual([mirror, turned]);
    for (const copy of built.copies) {
      expect(copy.ink).toEqual(quantizeInk(mappedSamples(samples, copy.matrix)));
      expect(copy.outline).toEqual(pf1Outline(copy.ink, brush));
    }
  });

  it("una copia che esce dai numeri dell'inchiostro non c'è, le altre sì", () => {
    const huge: Affine = [1e300, 0, 0, 1e300, 0, 0];
    const built = buildStroke(line(30), brush, [mirror, huge, turned]);
    if (!built.ok) throw new Error("doveva scriversi");
    expect(built.copies.map((copy) => copy.matrix)).toEqual([mirror, turned]);
  });

  it("campioni che l'inchiostro non scrive sono un fallimento, non un'eccezione", () => {
    expect(buildStroke([{ x: Number.NaN, y: 0, t: 0 }], brush, [])).toEqual({ ok: false, reason: "failed" });
    expect(buildStroke([], brush, [])).toEqual({ ok: false, reason: "failed" });
  });

  it("un tratto brevissimo, di due campioni, è un punto tondo e si scrive", () => {
    const built = buildStroke([{ x: 5, y: 5, t: 0 }, { x: 5, y: 5, t: 1 }], brush, []);
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.outline.length).toBeGreaterThan(2);
  });

  it("un tratto di tanti campioni quanti il formato ne ammette si scrive, uguale a sé stesso", () => {
    const samples = line(INK_MAX_SAMPLES);
    const first = buildStroke(samples, brush, [mirror]);
    expect(first.ok).toBe(true);
    expect(buildStroke(samples, brush, [mirror])).toEqual(first);
  });

  it("un campione di troppo è un fallimento", () => {
    expect(buildStroke(line(INK_MAX_SAMPLES + 1), brush, [])).toEqual({ ok: false, reason: "failed" });
  });
});
