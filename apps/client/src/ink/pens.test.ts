import { describe, expect, it } from "vitest";
import { BrushError, formatBrush, formatInkBrush, isNib1, parseBrush, parseInkBrush, penOf } from "./brush";
import { DEFAULT_PEN, isPenId, MAX_PEN_SIZE, MAX_SAVED_PENS, MIN_PEN_SIZE, PEN_IDS, PENS, penBrush, penLook, SIZE_SLIDER_STEPS, savedPensOf, sizeToSlider, sliderToSize } from "./pens";
import { inkPath } from "./outline";
import { pf1 } from "./pf1";

// Le penne di sistema: sei ricette di `pf1` e la punta piatta. Un tratto
// scritto con una penna si rilegge com'è, anche da chi non conosce le penne.

const ink = { scale: 100 as const, samples: [{ x: 0, y: 0, p: 128, t: 0 }, { x: 600, y: 200, p: 200, t: 16 }, { x: 1400, y: 300, p: 90, t: 32 }] };

describe("le penne di sistema", () => {
  it("sono sette, nell'ordine della galleria, e la Sfera è quella di serie", () => {
    expect(PEN_IDS).toEqual(["ballpoint", "fountain", "brush", "marker", "pencil", "calligraphy", "highlighter"]);
    expect(DEFAULT_PEN).toBe("ballpoint");
    expect(isPenId("fountain")).toBe(true);
    expect(isPenId("quill")).toBe(false);
    expect(isPenId(null)).toBe(false);
  });

  it("ogni penna pf1 scrive un fub:brush che la lettura di oggi rilegge uguale, con pen=<id> conservata", () => {
    for (const id of PEN_IDS) {
      const brush = penBrush(id, PENS[id].size, true);
      if (isNib1(brush)) continue;
      const text = formatBrush(brush);
      expect(text, id).toMatch(new RegExp(`^pf1 .* pen=${id}$`));
      const read = parseBrush(text);
      expect(read, id).toEqual(brush);
      expect(penOf(read), id).toBe(id);
      // La chiave della penna non cambia il disegno: lo stesso d senza.
      expect(pf1(ink, read), id).toBe(pf1(ink, { ...read, unknown: [] }));
    }
  });

  it("le rastremazioni sono multipli della misura: una penna più grossa resta la stessa penna", () => {
    const small = penBrush("fountain", 3, true);
    const large = penBrush("fountain", 30, true);
    if (isNib1(small) || isNib1(large)) throw new Error("pf1");
    expect(small.taperStart / small.size).toBe(large.taperStart / large.size);
    expect(small.taperEnd).toBe(24);
  });

  it("la pressione finta dice sim=1 solo per le penne che la seguono", () => {
    expect(formatInkBrush(penBrush("ballpoint", 2, false))).toContain("sim=1");
    expect(formatInkBrush(penBrush("marker", 6, false))).toContain("sim=0");
    expect(formatInkBrush(penBrush("highlighter", 16, false))).toContain("sim=0");
  });

  it("la Calligrafia è la punta piatta, e si rilegge", () => {
    const brush = penBrush("calligraphy", 12, true);
    expect(isNib1(brush)).toBe(true);
    const text = formatInkBrush(brush);
    expect(text).toBe("nib1 size=12 tip=1 angle=35 fixation=0.9 thinning=0.3 tilt=1 smoothing=0.6 streamline=0.5 sim=0 pen=calligraphy");
    expect(parseInkBrush(text)).toEqual(brush);
    expect(inkPath(ink, brush)).toMatch(/^M.* Z$/);
    // Chi conosce soltanto pf1 lo rifiuta: S004, e il d del file resta.
    expect(() => parseBrush(text)).toThrow(BrushError);
  });

  it("quanto copre e come si fonde lo dice la penna; senza penna, lo strumento", () => {
    expect(penLook(penBrush("marker", 6, true), "pen")).toEqual({ opacity: 0.92, blend: "normal" });
    expect(penLook(penBrush("pencil", 1.5, true), "pen")).toEqual({ opacity: 0.8, blend: "normal" });
    expect(penLook(penBrush("highlighter", 16, true), "highlighter")).toEqual({ opacity: 0.5, blend: "multiply" });
    expect(penLook(parseBrush("pf1 size=4"), "pen")).toEqual({ opacity: 1, blend: "normal" });
    expect(penLook(parseBrush("pf1 size=16"), "highlighter")).toEqual({ opacity: 0.5, blend: "multiply" });
    expect(penLook(null, "pen")).toEqual({ opacity: 1, blend: "normal" });
  });
});

describe("la misura e le penne salvate", () => {
  it("il cursore della misura va da 0,25 a 200 in scala logaritmica, andata e ritorno", () => {
    expect(sliderToSize(0)).toBe(MIN_PEN_SIZE);
    expect(sliderToSize(SIZE_SLIDER_STEPS)).toBe(MAX_PEN_SIZE);
    expect(sizeToSlider(MIN_PEN_SIZE)).toBe(0);
    expect(sizeToSlider(MAX_PEN_SIZE)).toBe(SIZE_SLIDER_STEPS);
    // A metà corsa la media geometrica, non quella aritmetica.
    expect(sliderToSize(SIZE_SLIDER_STEPS / 2)).toBeCloseTo(Math.sqrt(MIN_PEN_SIZE * MAX_PEN_SIZE), 1);
    for (const size of [0.25, 1, 2, 4, 8, 16, 100, 200]) expect(sliderToSize(sizeToSlider(size))).toBeCloseTo(size, 0);
    expect(sizeToSlider(1000)).toBe(SIZE_SLIDER_STEPS);
  });

  it("le penne salvate si leggono una per nome, e quelle illeggibili non tolgono le altre", () => {
    const good = { name: " Firma ", pen: "fountain", size: 2.5, color: "#0072B2", opacity: 0.8 };
    const read = savedPensOf({ pens: [good, { ...good, name: "Firma" }, { ...good, name: "x", pen: "quill" }, { ...good, name: "y", size: 0 }, { ...good, name: "z", color: "blu" }, { ...good, name: "w", opacity: 0 }, 7, null] });
    expect(read).toEqual([{ name: "Firma", pen: "fountain", size: 2.5, color: "#0072b2", opacity: 0.8 }]);
    expect(savedPensOf(null)).toEqual([]);
    expect(savedPensOf({ pens: "no" })).toEqual([]);
    const many = Array.from({ length: MAX_SAVED_PENS + 5 }, (_, i) => ({ ...good, name: `p${i}` }));
    expect(savedPensOf({ pens: many })).toHaveLength(MAX_SAVED_PENS);
  });
});

