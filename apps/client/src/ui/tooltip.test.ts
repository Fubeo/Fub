// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachTooltip,
  closeTooltip,
  dismissTooltip,
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

    button.focus();
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

  it("col fuoco dato dal codice dopo un clic descrive il controllo, ma non si vede", () => {
    const button = document.createElement("button");
    document.body.append(button);
    attachTooltip(button, "Dimentica gli avvisi");
    // Il fuoco che un pannello aperto col mouse porta sul suo primo bottone:
    // l'evento arriva, `:focus-visible` no.
    button.dispatchEvent(new FocusEvent("focus"));
    expect(button.getAttribute("aria-describedby")).toBe("fub-tooltip");
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2);
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')?.hidden).toBe(true);
  });

  it("chiude con il blur, Escape e quando cambia bersaglio", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    document.body.append(first, second);
    attachTooltip(first, "Primo");
    attachTooltip(second, "Secondo");

    first.focus();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Primo");

    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector('[role="tooltip"]')?.hasAttribute("hidden")).toBe(true);
    expect(first.hasAttribute("aria-describedby")).toBe(false);

    second.focus();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Secondo");
    second.blur();
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

  it("un clic lo chiude, e la riga che il clic ridisegna sotto il puntatore fermo non lo riapre", () => {
    const tooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]');
    const folder = document.createElement("div");
    document.body.append(folder);
    attachTooltip(folder, "docs");
    folder.dispatchEvent(new MouseEvent("mouseenter", { clientX: 40, clientY: 100 }));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tooltip()?.hidden).toBe(false);

    // Il clic chiude subito.
    folder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 40, clientY: 100, bubbles: true }));
    expect(tooltip()?.hidden).toBe(true);

    // Il clic rifà la riga: quella nuova riceve un `mouseenter` nel punto del
    // clic, col puntatore fermo. Non è un arrivo.
    const redrawn = document.createElement("div");
    folder.replaceWith(redrawn);
    attachTooltip(redrawn, "docs");
    redrawn.dispatchEvent(new MouseEvent("mouseenter", { clientX: 40, clientY: 100 }));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2);
    expect(tooltip()?.hidden).toBe(true);

    // Il puntatore che arriva davvero, da un altro punto, lo riapre come sempre.
    redrawn.dispatchEvent(new MouseEvent("mouseleave"));
    redrawn.dispatchEvent(new MouseEvent("mouseenter", { clientX: 42, clientY: 104 }));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tooltip()?.hidden).toBe(false);
    expect(tooltip()?.textContent).toBe("docs");
  });

  it("un clic durante il ritardo lo ferma", () => {
    const button = document.createElement("button");
    document.body.append(button);
    attachTooltip(button, "Nuova nota");
    button.dispatchEvent(new MouseEvent("mouseenter", { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 100);
    button.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')?.hidden ?? true).toBe(true);
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

  it("si chiude quando il controllo apre il suo riquadro, e non torna finché è aperto", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const dispose = attachTooltip(button, "Trova");
    const tooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]');

    button.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tooltip()?.hidden).toBe(false);

    // Il clic apre il riquadro: il suggerimento se ne va subito.
    button.setAttribute("aria-expanded", "true");
    dismissTooltip(button);
    expect(tooltip()?.hidden).toBe(true);
    expect(button.hasAttribute("aria-describedby")).toBe(false);

    // Il puntatore esce e rientra, a riquadro aperto: niente.
    button.dispatchEvent(new MouseEvent("mouseleave"));
    button.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2);
    expect(tooltip()?.hidden).toBe(true);

    // Un ritardo partito prima che il riquadro si aprisse non lo riapre.
    button.setAttribute("aria-expanded", "false");
    button.dispatchEvent(new MouseEvent("mouseenter"));
    button.setAttribute("aria-expanded", "true");
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tooltip()?.hidden).toBe(true);

    // Chiuso il riquadro, torna come sempre.
    button.setAttribute("aria-expanded", "false");
    button.dispatchEvent(new MouseEvent("mouseleave"));
    button.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tooltip()?.hidden).toBe(false);
    dispose();
  });
});
