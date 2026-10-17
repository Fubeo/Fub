import { describe, expect, it } from "vitest";
import { PF1_DEFAULTS, type Pf1Brush } from "../brush";
import { mappedSamples, type Affine } from "../geometry";
import { pf1Outline } from "../pf1";
import { INK_MAX_SAMPLES, quantizeInk, type InkSample } from "../sample";
import { buildStroke, previewOutline, StrokePreview } from "./stroke";

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

describe("l'anteprima che cresce", () => {
  /// Fa crescere `local` di un campione per volta e controlla che ogni
  /// chiamata dia ciò che dà `previewOutline`.
  function grows(samples: readonly InkSample[], predict: (i: number) => InkSample[], used: Pf1Brush = brush): StrokePreview {
    const preview = new StrokePreview(used);
    const local: InkSample[] = [];
    for (let i = 0; i < samples.length; i++) {
      local.push(samples[i]!);
      const predicted = predict(i);
      expect(preview.outline(local, predicted, false)).toEqual(previewOutline(local, predicted, used, false));
    }
    return preview;
  }

  const ahead = (i: number): InkSample[] => (i % 3 === 0 ? [] : [{ x: i * 2 + 1, y: 0, t: i * 8 + 4, p: 0.5 }, { x: i * 2 + 3, y: 1, t: i * 8 + 8, p: 0.6 }]);

  it("dà lo stesso contorno di `previewOutline` a ogni campione, con e senza previsioni", () => {
    grows(line(300), ahead);
    grows(line(300), ahead, { ...brush, sim: true, taperEnd: 10 });
    const mouse = line(300).map(({ x, y, t }): InkSample => ({ x, y, t }));
    grows(mouse, (i) => (i % 2 === 0 ? [] : [{ x: i * 2 + 1, y: 2, t: i * 8 + 4 }]), { ...brush, sim: true });
  });

  it("più campioni per volta, come nei coalescenti", () => {
    const samples = line(200);
    const preview = new StrokePreview(brush);
    const local: InkSample[] = [];
    for (let i = 0; i < samples.length; i += 5) {
      local.push(...samples.slice(i, i + 5));
      expect(preview.outline(local, [], false)).toEqual(previewOutline(local, [], brush, false));
    }
  });

  it("un campione che l'inchiostro non scrive la spegne fino alla fine del tratto", () => {
    const preview = new StrokePreview(brush);
    const local = line(20);
    expect(preview.outline(local, [], false).length).toBeGreaterThan(0);
    local.push({ x: Number.NaN, y: 0, t: 200, p: 0.5 });
    expect(preview.outline(local, [], false)).toEqual([]);
    local.push(...line(30).slice(21));
    expect(preview.outline(local, [], false)).toEqual(previewOutline(local, [], brush, false));
    expect(preview.outline(local, [], false)).toEqual([]);
  });

  it("una previsione che l'inchiostro non scrive spegne soltanto quella chiamata", () => {
    const preview = new StrokePreview(brush);
    const local = line(40);
    const wrong: InkSample[] = [{ x: 1e300, y: 0, t: 400, p: 0.5 }];
    const mixed: InkSample[] = [{ x: 80, y: 0, t: 400 }];
    expect(preview.outline(local, wrong, false)).toEqual([]);
    expect(preview.outline(local, wrong, false)).toEqual(previewOutline(local, wrong, brush, false));
    expect(preview.outline(local, mixed, false)).toEqual(previewOutline(local, mixed, brush, false));
    expect(preview.outline(local, [], false)).toEqual(previewOutline(local, [], brush, false));
  });

  it("un tratto che non comincia da t = 0 non si disegna, come in `previewOutline`", () => {
    const local = line(10).map((sample) => ({ ...sample, t: sample.t + 1 }));
    expect(new StrokePreview(brush).outline(local, [], false)).toEqual([]);
    expect(previewOutline(local, [], brush, false)).toEqual([]);
  });

  it("se i campioni non crescono soltanto in coda, ricomincia", () => {
    const preview = new StrokePreview(brush);
    const first = line(50);
    expect(preview.outline(first, [], false)).toEqual(previewOutline(first, [], brush, false));
    const other = line(60).map((sample) => ({ ...sample, y: sample.y + 7 }));
    expect(preview.outline(other, [], false)).toEqual(previewOutline(other, [], brush, false));
    const shorter = other.slice(0, 20);
    expect(preview.outline(shorter, [], false)).toEqual(previewOutline(shorter, [], brush, false));
  });

  it("le previsioni che farebbero superare il limite dei campioni restano fuori", () => {
    const preview = new StrokePreview(brush);
    const local = line(INK_MAX_SAMPLES);
    const predicted = [{ x: 1e4, y: 0, t: 1e6, p: 0.5 }];
    expect(preview.outline(local, predicted, false)).toEqual(previewOutline(local, [], brush, false));
  });

  it("dritto, senza campioni o con un pennello non valido è `previewOutline`", () => {
    const preview = new StrokePreview(brush);
    const local = line(30);
    expect(preview.outline(local, ahead(1), true)).toEqual(previewOutline(local, ahead(1), brush, true));
    expect(preview.outline([], ahead(1), false)).toEqual(previewOutline([], ahead(1), brush, false));
    expect(new StrokePreview({ ...brush, size: 0 }).outline(local, [], false)).toEqual([]);
    // Dopo il dritto, il tratto prosegue dal punto in cui era.
    expect(preview.outline(local, [], false)).toEqual(previewOutline(local, [], brush, false));
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
