// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "./lifetime";
import { LONG_PRESS_MS, mountLongPressMenus } from "./long-press";

function press(target: Element, init: PointerEventInit): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 1, ...init }));
}

describe("pressione lunga", () => {
  let lifetime: Lifetime;
  let row: HTMLElement;
  let menus: MouseEvent[];
  let clicks: number;

  beforeEach(() => {
    vi.useFakeTimers();
    lifetime = openLifetime();
    mountLongPressMenus(lifetime);
    row = document.createElement("div");
    document.body.append(row);
    menus = [];
    clicks = 0;
    row.addEventListener("contextmenu", (e) => menus.push(e));
    row.addEventListener("click", () => clicks++);
  });

  afterEach(() => {
    lifetime.close();
    row.remove();
    vi.useRealTimers();
  });

  it("di un dito apre il menu nel punto premuto, e il dito che si alza non è un click", () => {
    press(row, { pointerType: "touch", clientX: 30, clientY: 40 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toHaveLength(1);
    expect([menus[0]!.clientX, menus[0]!.clientY]).toEqual([30, 40]);

    row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toBe(0);

    // La pressione successiva è un tocco normale.
    press(row, { pointerType: "touch" });
    row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toBe(1);
  });

  it("non scatta per un tocco breve, per uno scorrimento o per il mouse", () => {
    press(row, { pointerType: "touch" });
    row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    vi.advanceTimersByTime(LONG_PRESS_MS);

    press(row, { pointerType: "touch", clientX: 0, clientY: 0 });
    row.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 0, clientY: 40 }));
    vi.advanceTimersByTime(LONG_PRESS_MS);

    press(row, { pointerType: "mouse" });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toHaveLength(0);
  });

  it("lascia la pressione lunga ai campi di testo", () => {
    const input = document.createElement("input");
    row.append(input);
    press(input, { pointerType: "touch" });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toHaveLength(0);
  });

  it("smontato non ascolta più", () => {
    press(row, { pointerType: "touch" });
    lifetime.close();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    press(row, { pointerType: "touch" });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toHaveLength(0);
  });
});
