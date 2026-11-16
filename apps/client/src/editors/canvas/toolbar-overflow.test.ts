// @vitest-environment happy-dom
// La barra dei comandi della lavagna che non ci sta (#411): è la fila del kit
// (`kit/options-bar.ts`), e ciò che non entra va in «…», un popover con gli
// stessi pulsanti. Le frecce passano fra i controlli che si vedono, «…»
// compreso; Esc chiude e riporta il fuoco su «…»; la riga si rifà quando la
// barra cambia misura. happy-dom non misura: le larghezze sono finte.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { mountCanvas } from "./test-mount";
import { canvasCoreReady } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "b" }],
});

/// Ogni controllo della barra largo 100, «…» 30; la barra larga `width.value`.
/// Gli osservatori della misura si chiamano a mano con `resize()`.
function fakeLayout(width: { value: number }) {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  const rect = (w: number) => ({ width: w, height: 28, x: 0, y: 0, left: 0, top: 0, right: w, bottom: 28, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("kit-options-more")) return rect(30);
    if (this.classList.contains("canvas-toolbar-item")) return rect(100);
    return rect(0);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("canvas-toolbar") ? width.value : 0;
  });
  return {
    resize: async () => {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const key = (target: Element, name: string): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

function mounted(width: { value: number }) {
  const layout = fakeLayout(width);
  const { engine, host } = mountCanvas(BOARD);
  const bar = host.querySelector<HTMLElement>(".canvas-toolbar")!;
  const row = bar.querySelector<HTMLElement>(".kit-options-row")!;
  const more = bar.querySelector<HTMLButtonElement>(".kit-options-more")!;
  const shown = () => [...row.children].filter((child) => !(child as HTMLElement).hidden).map((child) => (child as HTMLElement).dataset.canvasAction ?? (child as HTMLElement).dataset.canvasField);
  return { engine, host, bar, row, more, shown, ...layout };
}

describe("la barra dei comandi della lavagna che non ci sta", () => {
  it("è una toolbar sola; ciò che non entra va in «…», col nome «Altri comandi»", () => {
    const { bar, more, shown } = mounted({ value: 450 });
    expect(bar.getAttribute("role")).toBe("toolbar");
    expect(bar.getAttribute("aria-label")).toBe(t("canvas.surface"));
    // 450 px: quattro controlli da 100 e «…» da 30 (lo spazio fra i controlli è zero qui).
    expect(shown()).toEqual(["ink-mouse", "add-text", "add-link", "add-group"]);
    expect(more.hidden).toBe(false);
    expect(more.getAttribute("aria-label")).toBe(t("canvas.toolbar.more"));
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("«…» apre i comandi nascosti, gli stessi pulsanti, fuori dalla lavagna", () => {
    const { host, more } = mounted({ value: 450 });
    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const popover = document.querySelector<HTMLElement>(".kit-options-popover")!;
    const actions = [...popover.querySelectorAll<HTMLElement>("[data-canvas-action], [data-canvas-field]")].map((el) => el.dataset.canvasAction ?? el.dataset.canvasField);
    expect(actions).toEqual(["duplicate", "delete", "fit-selection", "select-edge"]);
    expect(host.contains(popover)).toBe(false);
    // I comandi nel popover hanno l'aspetto della barra.
    expect(popover.querySelector('[data-canvas-action="delete"]')!.classList.contains("canvas-toolbar-item")).toBe(true);
  });

  it("le frecce arrivano a «…»; Invio e Spazio sono del pulsante; Esc chiude e il fuoco torna su «…»", () => {
    const { bar, row, more } = mounted({ value: 450 });
    const first = row.querySelector<HTMLElement>('[data-canvas-action="ink-mouse"]')!;
    // Un solo punto di tabulazione nella riga.
    const tabbable = [...bar.querySelectorAll<HTMLElement>("button, select, input")].filter((el) => el.tabIndex === 0 && !el.closest("[hidden]"));
    expect(tabbable).toEqual([first]);
    first.focus();
    key(first, "End");
    expect(document.activeElement).toBe(more);
    key(more, "ArrowRight");
    expect(document.activeElement).toBe(first);
    key(first, "ArrowLeft");
    expect(document.activeElement).toBe(more);
    // `button` nativo: Invio e Spazio diventano un clic.
    more.click();
    const popover = document.querySelector<HTMLElement>(".kit-options-popover")!;
    const inside = [...popover.querySelectorAll<HTMLElement>("button:not(:disabled), select")];
    expect(inside.every((el) => el.tabIndex === 0)).toBe(true);
    expect(document.activeElement).toBe(inside[0]);
    key(document.activeElement!, "Escape");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
    // Tornati nella riga, i comandi nascosti non sono punti di tabulazione.
    expect([...row.querySelectorAll<HTMLElement>("[hidden]")].every((el) => el.tabIndex === -1)).toBe(true);
  });

  it("si rifà quando la barra cambia misura: larga, «…» sparisce; stretta, torna", async () => {
    const width = { value: 450 };
    const { more, shown, resize } = mounted(width);
    expect(more.hidden).toBe(false);
    width.value = 2000;
    await resize();
    expect(more.hidden).toBe(true);
    expect(shown()).toEqual(["ink-mouse", "add-text", "add-link", "add-group", "duplicate", "delete", "fit-selection", "select-edge"]);
    width.value = 250;
    await resize();
    expect(more.hidden).toBe(false);
    expect(shown()).toEqual(["ink-mouse", "add-text"]);
  });
});
