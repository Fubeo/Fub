// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../ui/lifetime";
import { referencePoint, referencePointStep } from "./reference-point";

const NOMI = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

describe("referencePointStep", () => {
  it("le frecce si muovono nella griglia e si fermano ai bordi", () => {
    expect(referencePointStep(4, "ArrowLeft")).toBe(3);
    expect(referencePointStep(3, "ArrowLeft")).toBe(3);
    expect(referencePointStep(4, "ArrowUp")).toBe(1);
    expect(referencePointStep(1, "ArrowUp")).toBe(1);
    expect(referencePointStep(4, "ArrowDown")).toBe(7);
    expect(referencePointStep(8, "ArrowRight")).toBe(8);
    expect(referencePointStep(5, "Home")).toBe(0);
    expect(referencePointStep(0, "End")).toBe(8);
    expect(referencePointStep(4, "a")).toBeNull();
  });
  it("misto parte dal centro", () => {
    expect(referencePointStep(null, "ArrowRight")).toBe(5);
  });
});

describe("referencePoint", () => {
  it("un clic sceglie e avvisa; lo stesso quadratino non riavvisa", () => {
    const vita = openLifetime();
    const cambia = vi.fn();
    const c = referencePoint({ label: "Perno", pointLabels: NOMI, value: 4, onChange: cambia, lifetime: vita });
    const celle = [...c.element.querySelectorAll<HTMLButtonElement>("[role=radio]")];
    expect(celle).toHaveLength(9);
    expect(celle[4]!.getAttribute("aria-checked")).toBe("true");
    expect(celle[4]!.tabIndex).toBe(0);
    expect(celle[0]!.tabIndex).toBe(-1);
    celle[2]!.click();
    expect(cambia).toHaveBeenCalledWith(2);
    expect(c.value()).toBe(2);
    celle[2]!.click();
    expect(cambia).toHaveBeenCalledTimes(1);
    vita.close();
  });
  it("misto: nessuno scelto, Tab si ferma sul primo; le frecce scelgono", () => {
    const vita = openLifetime();
    const cambia = vi.fn();
    const c = referencePoint({ label: "Perno", pointLabels: NOMI, value: null, onChange: cambia, lifetime: vita });
    document.body.append(c.element);
    const celle = [...c.element.querySelectorAll<HTMLButtonElement>("[role=radio]")];
    expect(celle.every((x) => x.getAttribute("aria-checked") === "false")).toBe(true);
    expect(celle[0]!.tabIndex).toBe(0);
    celle[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(cambia).toHaveBeenCalledWith(7);
    expect(document.activeElement).toBe(celle[7]);
    c.element.remove();
    vita.close();
  });
  it("setValue non avvisa; spento non sceglie", () => {
    const cambia = vi.fn();
    const c = referencePoint({ label: "Perno", pointLabels: NOMI, value: 0, onChange: cambia });
    c.setValue(8);
    expect(c.value()).toBe(8);
    c.setValue(12);
    expect(c.value()).toBeNull();
    c.setDisabled(true);
    c.element.querySelector<HTMLButtonElement>("[data-point='3']")!.click();
    expect(cambia).not.toHaveBeenCalled();
  });
});
