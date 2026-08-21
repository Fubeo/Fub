// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachTooltip,
  closeTooltip,
  resetTooltips,
  TOOLTIP_DELAY_MS,
} from "./tooltip";

describe("il suggerimento della shell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    closeTooltip();
    resetTooltips();
    vi.useRealTimers();
  });

  it("si apre sul fuoco dopo il ritardo e dichiara il ruolo ARIA", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const dispose = attachTooltip(button, "Apri la palette");

    button.dispatchEvent(new FocusEvent("focus"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    vi.advanceTimersByTime(1);
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tooltip?.textContent).toBe("Apri la palette");
    expect(tooltip?.hidden).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBe(tooltip?.id);
    dispose();
  });

  it("chiude con il blur, Escape e quando cambia bersaglio", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    document.body.append(first, second);
    attachTooltip(first, "Primo");
    attachTooltip(second, "Secondo");

    first.dispatchEvent(new FocusEvent("focus"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Primo");

    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector('[role="tooltip"]')?.hasAttribute("hidden")).toBe(true);
    expect(first.hasAttribute("aria-describedby")).toBe(false);

    second.dispatchEvent(new FocusEvent("focus"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Secondo");
    second.dispatchEvent(new FocusEvent("blur"));
    expect(document.querySelector('[role="tooltip"]')?.hasAttribute("hidden")).toBe(true);
  });
});
