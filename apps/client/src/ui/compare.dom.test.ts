// @vitest-environment happy-dom
// Il clic fuori del confronto: la stessa regola delle finestre della shell
// (`openFrame`), letta da `pointerdown` e non dagli eventi del mouse.

import { afterEach, describe, expect, it } from "vitest";
import { openCompare } from "./compare";

const overlay = (): HTMLElement | null => document.querySelector<HTMLElement>(".modale .compare-box")?.closest<HTMLElement>(".modale") ?? null;

afterEach(() => {
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
});

describe("il clic fuori del confronto", () => {
  for (const pointerType of ["touch", "pen"] as const) {
    it(`gli eventi del mouse di un tocco (${pointerType}) che l'ha aperto non lo chiudono`, () => {
      openCompare("Confronto", "a\nb", "a\nc");
      const backdrop = overlay()!;
      // Il dito o la penna che si alzano mandano dopo gli eventi del mouse di
      // compatibilità su ciò che sta sotto: lo sfondo appena comparso.
      for (const type of ["mousemove", "mousedown", "mouseup", "click"]) {
        backdrop.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
      }
      expect(overlay()).toBe(backdrop);
      // Un tocco nuovo fuori lo chiude.
      backdrop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }));
      expect(overlay()).toBeNull();
    });
  }

  it("col mouse un clic sullo sfondo chiude, un clic dentro no", () => {
    openCompare("Confronto", "a", "b");
    const backdrop = overlay()!;
    const box = backdrop.querySelector<HTMLElement>(".compare-box")!;
    box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(overlay()).toBe(backdrop);
    // Un clic vero del mouse manda `pointerdown` e poi `mousedown`.
    backdrop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(overlay()).toBeNull();
  });

  it("Esc e il bottone Chiudi chiudono, e il titolo dà il nome alla finestra", () => {
    openCompare("Confronto", "a", "b");
    const backdrop = overlay()!;
    expect(backdrop.getAttribute("role")).toBe("dialog");
    const labelled = backdrop.getAttribute("aria-labelledby");
    const name = labelled ? document.getElementById(labelled)?.textContent : backdrop.getAttribute("aria-label");
    expect(name).toBe("Confronto");
    expect(document.activeElement?.tagName).toBe("BUTTON");
    (document.activeElement as HTMLElement).click();
    expect(overlay()).toBeNull();
    openCompare("Confronto", "a", "b");
    overlay()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(overlay()).toBeNull();
  });
});
