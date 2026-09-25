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

  it("si apre sul fuoco dopo il ritardo, ma descrive il controllo subito", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const dispose = attachTooltip(button, "Apri la palette");

    button.dispatchEvent(new FocusEvent("focus"));
    // Il lettore di schermo annuncia al fuoco: la descrizione c'è già, anche
    // se il suggerimento non si vede ancora.
    const early = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(early?.hidden).toBe(true);
    expect(early?.textContent).toBe("Apri la palette");
    expect(button.getAttribute("aria-describedby")).toBe(early?.id);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1);
    expect(early?.hidden).toBe(true);

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

  it("non apre il suggerimento di una riga rimossa durante il ritardo", () => {
    const row = document.createElement("div");
    document.body.append(row);
    attachTooltip(row, "Progetti/Archivio");

    row.dispatchEvent(new MouseEvent("mouseenter"));
    row.remove();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);

    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(row.hasAttribute("aria-describedby")).toBe(false);
  });

  it("smonta un bersaglio staccato anche durante il teardown dell'ambiente", () => {
    const row = document.createElement("div");
    document.body.append(row);
    attachTooltip(row, "Progetti/Archivio");
    row.dispatchEvent(new MouseEvent("mouseenter"));
    row.remove();

    vi.stubGlobal("window", undefined);
    try {
      expect(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
