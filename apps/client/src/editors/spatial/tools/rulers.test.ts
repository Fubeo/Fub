// @vitest-environment happy-dom
// I righelli e le guide del documento da soli: le tacche a ogni zoom e in
// ogni unità, la guida sotto il puntatore, i numeri dei campi, e ciò che le
// due viste disegnano.

import { afterEach, describe, expect, it } from "vitest";
import { UNIT_SIZE, UNITS } from "../scene/rulers";
import {
  createGuideLines,
  createRulers,
  fieldMin,
  fieldText,
  fromUnit,
  guideAt,
  RULER_LABEL_PX,
  RULER_PX,
  RULER_TICK_PX,
  rulerTicks,
  toUnit,
} from "./rulers";

const camera = (scale: number, tx = 0, ty = 0) => ({ scale, tx, ty });

afterEach(() => {
  document.body.replaceChildren();
});

describe("le tacche dei righelli", () => {
  it("a misura naturale, in pixel, vanno di dieci in dieci col numero ogni cento", () => {
    const { ticks, places } = rulerTicks(0, 1, 400, "px");
    expect(places).toBe(0);
    expect(ticks.map((tick) => tick.at)).toEqual(Array.from({ length: 41 }, (_, i) => i * 10));
    expect(ticks.filter((tick) => tick.level === 0).map((tick) => tick.value)).toEqual([0, 100, 200, 300, 400]);
    expect(ticks.filter((tick) => tick.level === 1).map((tick) => tick.value)).toEqual([50, 150, 250, 350]);
  });

  it("in ogni unità e a ogni zoom tengono i numeri e le tacche abbastanza larghi", () => {
    for (const unit of UNITS) {
      for (const scale of [0.02, 0.1, 0.25, 0.5, 1, 1.5, 2, 3, 8, 32, 64]) {
        const { ticks } = rulerTicks(13.7, scale, 1200, unit);
        expect(ticks.length).toBeGreaterThan(0);
        const labelled = ticks.filter((tick) => tick.level === 0);
        for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.at - ticks[i - 1]!.at).toBeGreaterThanOrEqual(RULER_TICK_PX - 1e-9);
        for (let i = 1; i < labelled.length; i++) {
          const apart = labelled[i]!.at - labelled[i - 1]!.at;
          expect(apart).toBeGreaterThanOrEqual(RULER_LABEL_PX - 1e-9);
          // Il passo è il più piccolo che ci sta: non oltre una volta e
          // mezza la distanza col salto più largo, da 2 a 5 o da 1/2 a 1.
          expect(apart).toBeLessThan(RULER_LABEL_PX * 2.5 + 1e-9);
        }
        // Una tacca col numero dice dove sta.
        for (const tick of labelled) expect(13.7 + tick.value * UNIT_SIZE[unit] * scale).toBeCloseTo(tick.at, 4);
      }
    }
  });

  it("vanno di 1, 2 o 5 per una potenza di dieci, e i pollici anche a frazioni", () => {
    const step = (scale: number, unit: (typeof UNITS)[number]): number => {
      const labelled = rulerTicks(0, scale, 2000, unit).ticks.filter((tick) => tick.level === 0);
      return labelled[1]!.value - labelled[0]!.value;
    };
    expect(step(1, "mm")).toBe(20);
    expect(step(4, "mm")).toBe(5);
    expect(step(0.05, "cm")).toBe(50);
    expect(step(1, "pt")).toBe(50);
    expect(step(1, "in")).toBe(1);
    expect(step(4, "in")).toBe(0.25);
    // Più vicino di un sedicesimo, i pollici vanno a decimali.
    expect(step(20, "in")).toBe(0.05);
    expect(step(0.5, "in")).toBe(2);
    // Un pollice si divide in sedicesimi, con la tacca di mezzo a metà.
    const inch = rulerTicks(0, 1, 100, "in").ticks;
    expect(inch.slice(0, 17).map((tick) => tick.level)).toEqual([0, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 0]);
  });

  it("scrivono i decimali che servono al passo, e mai uno zero negativo", () => {
    expect(rulerTicks(0, 4, 400, "in").places).toBe(2);
    expect(rulerTicks(0, 64, 400, "mm").places).toBe(1);
    const { ticks } = rulerTicks(300, 0.3, 600, "cm");
    expect(ticks.some((tick) => tick.value < 0)).toBe(true);
    expect(ticks.every((tick) => !Object.is(tick.value, -0))).toBe(true);
    // 3 × 0,1 non ha la coda della virgola mobile.
    const tenths = rulerTicks(0, 20, 1000, "cm").ticks.filter((tick) => tick.level === 0);
    expect(tenths.map((tick) => tick.value).slice(0, 4)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("partono e finiscono dentro il righello, anche lontano dall'origine", () => {
    const { ticks } = rulerTicks(-1e6, 1, 800, "px");
    expect(ticks[0]!.at).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]!.at).toBeLessThanOrEqual(800);
    expect(ticks[0]!.value).toBe(1e6);
  });

  it("una vista senza misura non ne ha", () => {
    expect(rulerTicks(0, 0, 800, "px").ticks).toEqual([]);
    expect(rulerTicks(0, 1, 0, "px").ticks).toEqual([]);
    expect(rulerTicks(Number.NaN, 1, 800, "px").ticks).toEqual([]);
    expect(rulerTicks(0, Number.POSITIVE_INFINITY, 800, "px").ticks).toEqual([]);
  });
});

describe("i numeri nell'unità del documento", () => {
  it("vanno e tornano dalla scena", () => {
    expect(toUnit(96, "in")).toBe(1);
    expect(fromUnit(10, "mm")).toBeCloseTo(37.795275591, 8);
    expect(toUnit(fromUnit(12.5, "pt"), "pt")).toBeCloseTo(12.5, 12);
  });

  it("un campo scrive i centesimi dell'unità, e il suo minimo non scende sotto quello della scena", () => {
    expect(fieldText(fromUnit(210, "mm"), "mm")).toBe("210");
    expect(fieldText(100, "mm")).toBe("26.458");
    expect(fieldText(100, "px")).toBe("100");
    expect(fieldMin(1, "px")).toBe(1);
    expect(fieldMin(1, "mm")).toBe(0.265);
    expect(fromUnit(fieldMin(1, "mm"), "mm")).toBeGreaterThanOrEqual(1);
    expect(fromUnit(fieldMin(1, "in"), "in")).toBeGreaterThanOrEqual(1);
    expect(fieldMin(fromUnit(3, "cm"), "cm")).toBe(3);
  });
});

describe("la guida sotto il puntatore", () => {
  const guides = [
    { axis: "x" as const, at: 100, locked: false },
    { axis: "y" as const, at: 50, locked: true },
    { axis: "x" as const, at: 103, locked: false },
  ];

  it("è la più vicina lungo il suo asse, e a pari distanza l'ultima", () => {
    expect(guideAt(guides, camera(1), [101, 400], 4, false)).toBe(0);
    expect(guideAt(guides, camera(1), [102, 400], 4, false)).toBe(2);
    expect(guideAt(guides, camera(1), [101.5, 400], 4, false)).toBe(2);
    expect(guideAt(guides, camera(1), [400, 52], 4, false)).toBe(1);
    expect(guideAt(guides, camera(1), [400, 400], 4, false)).toBeNull();
  });

  it("segue la vista, e può lasciare fuori le bloccate", () => {
    expect(guideAt(guides, camera(2, 10, 20), [210, 999], 4, false)).toBe(0);
    expect(guideAt(guides, camera(2, 10, 20), [999, 121], 4, false)).toBe(1);
    expect(guideAt(guides, camera(2, 10, 20), [999, 121], 4, true)).toBeNull();
  });
});

describe("le viste", () => {
  const host = (): HTMLElement => document.body.appendChild(document.createElement("div"));
  const view = {
    camera: camera(1, 20, 30),
    width: 640,
    height: 480,
    unit: "px" as const,
    page: { min: [0, 0] as const, max: [400, 300] as const },
    selection: { min: [100, 100] as const, max: [200, 150] as const },
    pointer: [120, 80] as const,
  };

  it("i righelli sono nascosti alla lettura dello schermo, e si mostrano e si nascondono", () => {
    const rulers = createRulers(host(), (value) => String(value), (unit) => unit);
    const svg = rulers.element;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.style.display).toBe("none");
    rulers.show(view);
    expect(svg.style.display).toBe("");
    rulers.show(null);
    expect(svg.style.display).toBe("none");
  });

  it("i righelli segnano la pagina, la selezione, il puntatore e l'unità", () => {
    const rulers = createRulers(host(), (value) => String(value), (unit) => `[${unit}]`);
    rulers.show(view);
    const top = rulers.element.querySelector('[data-ruler="x"]')!;
    const left = rulers.element.querySelector('[data-ruler="y"]')!;
    const page = top.querySelector('[data-part="page"]')!;
    // La pagina comincia sotto l'angolo, e il righello la segna da dopo.
    expect(page.getAttribute("x")).toBe(String(RULER_PX));
    expect(page.getAttribute("width")).toBe(String(420 - RULER_PX));
    const selection = left.querySelector('[data-part="selection"]')!;
    expect(selection.getAttribute("y")).toBe("130");
    expect(selection.getAttribute("height")).toBe("50");
    expect(top.querySelector('[data-part="pointer"]')!.getAttribute("d")).toBe("M140.5 0V24");
    const labels = [...top.querySelectorAll('[data-part="labels"] text')].map((text) => text.textContent);
    // Lo zero sta sotto l'angolo, e non si scrive.
    expect(labels).toEqual(["100", "200", "300", "400", "500", "600"]);
    expect(rulers.element.querySelector('[data-part="unit"]')!.textContent).toBe("[px]");
    rulers.show({ ...view, unit: "mm", selection: null, pointer: null });
    expect(rulers.element.querySelector('[data-part="unit"]')!.textContent).toBe("[mm]");
    expect(left.querySelector('[data-part="selection"]')!.getAttribute("display")).toBe("none");
    expect(top.querySelector('[data-part="pointer"]')!.getAttribute("d")).toBe("");
  });

  it("le guide disegnano le libere, le bloccate e quella calda ognuna per sé", () => {
    const lines = createGuideLines(host());
    const guides = [
      { axis: "x" as const, at: 100, locked: false },
      { axis: "y" as const, at: 50, locked: true },
      { axis: "x" as const, at: 2000, locked: false },
    ];
    lines.show({ camera: camera(1), width: 640, height: 480, guides, hot: null, hidden: null, moving: null });
    const [free, locked, hot] = [...lines.element.querySelectorAll("path")];
    expect(free!.getAttribute("d")).toBe("M100.5 0V480");
    expect(locked!.getAttribute("d")).toBe("M0 50.5H640");
    expect(hot!.getAttribute("d")).toBe("");
    lines.show({ camera: camera(1), width: 640, height: 480, guides, hot: 1, hidden: null, moving: null });
    expect(hot!.getAttribute("d")).toBe("M0 50.5H640");
    expect(hot!.hasAttribute("data-locked")).toBe(true);
    lines.show({ camera: camera(1), width: 640, height: 480, guides, hot: null, hidden: 0, moving: { axis: "x", at: 300, away: true } });
    expect(free!.getAttribute("d")).toBe("");
    expect(hot!.getAttribute("d")).toBe("M300.5 0V480");
    expect(hot!.hasAttribute("data-away")).toBe(true);
    lines.show(null);
    expect(lines.element.style.display).toBe("none");
  });
});
