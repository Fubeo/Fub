// @vitest-environment happy-dom
// La finestra «Penna e dita»: i gesti delle dita e la curva della penna, con
// la curva, il tratto d'esempio e la prova che la seguono.

import { afterEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { DEFAULT_CURVE } from "../pen/pressure";
import { samplePath, touchDialog, type TouchChoice } from "./touch-dialog";

const CHOICE: TouchChoice = { twist: true, taps: false, pen: DEFAULT_CURVE };

const dialog = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".modale");
  return open[open.length - 1]!;
};
const knobs = (): HTMLInputElement[] => [...dialog().querySelectorAll<HTMLInputElement>('input[type="range"]')];
const button = (label: string): HTMLButtonElement => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label)!;
const slide = (input: HTMLInputElement, value: number): void => {
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = (): void => dialog().querySelector("form")!.requestSubmit();
const pad = (): SVGSVGElement => dialog().querySelector<SVGSVGElement>(".draw-touch-pad")!;
const sample = (): SVGPathElement => dialog().querySelector<SVGPathElement>(".draw-touch-sample")!;
const pen = (type: string, x: number, y: number, pressure: number): void => {
  pad().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: "pen", pressure, clientX: x, clientY: y }));
};

afterEach(() => {
  // Le finestre chiuse escono con un'animazione, che happy-dom non finisce.
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
});

describe("touchDialog", () => {
  it("mostra i gesti e le tre manopole coi loro valori, col fuoco sul primo gesto", () => {
    void touchDialog(CHOICE);
    expect(dialog().querySelector("h2")!.textContent).toBe("Penna e dita");
    expect([...dialog().querySelectorAll("legend")].map((legend) => legend.textContent)).toEqual(["Dita", "Pressione della penna"]);
    const checks = [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks.map((check) => check.checked)).toEqual([true, false]);
    expect(document.activeElement).toBe(checks[0]);
    expect(knobs().map((knob) => [knob.closest("label")!.querySelector("span")!.textContent, knob.min, knob.max, knob.value, knob.getAttribute("aria-valuetext")])).toEqual([
      ["Morbidezza", "-100", "100", "0", "0%"],
      ["Pressione minima", "0", "50", "0", "0%"],
      ["Pieno da", "50", "100", "100", "100%"],
    ]);
    // Il valore scritto accanto al cursore è suo.
    const output = knobs()[1]!.closest("label")!.querySelector("output")!;
    expect(output.getAttribute("for")).toBe(knobs()[1]!.id);
    expect(button("Ripristina la curva").disabled).toBe(true);
    expect(button("Pulisci la prova").disabled).toBe(true);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
  });

  it("la curva e il tratto d'esempio seguono le manopole; «Ripristina la curva» torna alla diagonale", async () => {
    const answer = touchDialog(CHOICE);
    const line = dialog().querySelector(".draw-touch-line")!;
    const straight = line.getAttribute("d");
    expect(straight).toMatch(/^M0 120L/);
    expect(sample().getAttribute("d")).toBe(samplePath(DEFAULT_CURVE));
    slide(knobs()[0]!, -50);
    slide(knobs()[1]!, 20);
    expect(knobs()[0]!.getAttribute("aria-valuetext")).toBe("-50%");
    expect(knobs()[1]!.closest("label")!.querySelector("output")!.textContent).toBe("20%");
    expect(line.getAttribute("d")).not.toBe(straight);
    // Il minimo alza la curva al suo inizio.
    expect(line.getAttribute("d")).toMatch(/^M0 96L/);
    expect(sample().getAttribute("d")).toBe(samplePath({ soft: -0.5, min: 0.2, full: 1 }));
    expect(button("Ripristina la curva").disabled).toBe(false);
    button("Ripristina la curva").click();
    expect(line.getAttribute("d")).toBe(straight);
    expect(document.activeElement).toBe(knobs()[0]);
    slide(knobs()[2]!, 75);
    submit();
    expect(await answer).toEqual({ twist: true, taps: false, pen: { soft: 0, min: 0, full: 0.75 } });
  });

  it("la penna nella prova disegna con la curva, e il punto sulla curva dice la pressione", () => {
    void touchDialog({ ...CHOICE, pen: { soft: 1, min: 0, full: 1 } });
    pen("pointerdown", 10, 10, 0.125);
    const dot = dialog().querySelector(".draw-touch-dot")!;
    expect(dot.getAttribute("display")).toBe("inline");
    // Un ottavo della corsa, sulla curva più morbida, è metà pressione.
    expect([dot.getAttribute("cx"), dot.getAttribute("cy")]).toEqual(["15", "60"]);
    pen("pointermove", 30, 10, 0.125);
    pen("pointermove", 50, 10, 1);
    const pieces = [...dialog().querySelectorAll(".draw-touch-strokes line")];
    expect(pieces.map((piece) => piece.getAttribute("stroke-width"))).toEqual(["7.25", "14"]);
    expect(sample().getAttribute("display")).toBe("none");
    pen("pointerup", 50, 10, 0);
    expect(dot.getAttribute("display")).toBe("none");
    button("Pulisci la prova").click();
    expect(dialog().querySelectorAll(".draw-touch-strokes line")).toHaveLength(0);
    expect(sample().getAttribute("display")).toBe("inline");
  });

  it("Annulla non sceglie niente", async () => {
    const answer = touchDialog(CHOICE);
    dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button("Annulla").click();
    expect(await answer).toBeNull();
  });
});

describe("samplePath", () => {
  it("è un contorno chiuso, più spesso a metà, dove la pressione è piena", () => {
    const d = samplePath(DEFAULT_CURVE, 4);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
    expect(points).toHaveLength(10);
    // Il lato di sopra e quello di sotto, allo stesso passo: la distanza è lo
    // spessore, e il più spesso è a metà.
    const widths = [0, 1, 2, 3, 4].map((i) => Math.hypot(points[i]![0]! - points[9 - i]![0]!, points[i]![1]! - points[9 - i]![1]!));
    expect(widths[2]).toBeCloseTo(14, 1);
    expect(widths[0]).toBeCloseTo(0.5, 1);
    expect(widths[2]).toBeGreaterThan(widths[1]!);
  });
});
