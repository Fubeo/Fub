// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessibleName } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { createOptionsBar, overflowing, type OptionItem } from "./options-bar";
import { listenerLedger } from "./testing";

let life: Lifetime;

beforeEach(() => {
  life = openLifetime();
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
});

/// Un controllo largo `width`, per happy-dom che non misura.
const control = (id: string, width: number, priority?: number): OptionItem => {
  const element = document.createElement("button");
  element.textContent = id;
  element.getBoundingClientRect = () => ({ width, height: 24, x: 0, y: 0, left: 0, top: 0, right: width, bottom: 24, toJSON: () => ({}) });
  return { id, element, ...(priority === undefined ? {} : { priority }) };
};

const sized = (element: HTMLElement, width: number): void => {
  Object.defineProperty(element, "clientWidth", { value: width, configurable: true });
};

describe("overflowing", () => {
  it("non toglie niente se c'è posto", () => {
    expect([...overflowing([50, 50], [0, 0], 100, 30)]).toEqual([]);
  });

  it("toglie da destra, contando «…»", () => {
    expect([...overflowing([40, 40, 40], [0, 0, 0], 99, 20)].sort()).toEqual([1, 2]);
    expect([...overflowing([40, 40, 40], [0, 0, 0], 110, 20)]).toEqual([2]);
  });

  it("la priorità bassa esce prima", () => {
    expect([...overflowing([40, 40, 40], [1, 0, 1], 110, 20)]).toEqual([1]);
  });
});

describe("createOptionsBar", () => {
  it("mette in «…» ciò che non ci sta, e lo riporta quando si chiude", () => {
    const bar = createOptionsBar({ label: "Opzioni della penna", moreLabel: "Altre opzioni", lifetime: life });
    document.body.append(bar.element);
    sized(bar.element, 110);
    bar.element.querySelector<HTMLElement>(".kit-options-more")!.getBoundingClientRect = () =>
      ({ width: 20, height: 24, x: 0, y: 0, left: 0, top: 0, right: 20, bottom: 24, toJSON: () => ({}) });
    const items = [control("colore", 40, 2), control("spessore", 40, 1), control("levigatura", 40)];
    bar.setItems(items);
    expect(bar.element.getAttribute("role")).toBe("toolbar");
    expect(accessibleName(bar.element)).toBe("Opzioni della penna");
    expect(bar.overflow()).toEqual(["levigatura"]);
    const more = bar.element.querySelector<HTMLButtonElement>(".kit-options-more")!;
    expect(more.hidden).toBe(false);
    expect(items[2]!.element.hidden).toBe(true);

    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const popover = document.querySelector<HTMLElement>(".kit-options-popover")!;
    expect(popover.contains(items[2]!.element)).toBe(true);
    expect(items[2]!.element.hidden).toBe(false);

    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(bar.element.contains(items[2]!.element)).toBe(true);
    expect(items[2]!.element.hidden).toBe(true);

    sized(bar.element, 400);
    bar.fit();
    expect(bar.overflow()).toEqual([]);
    expect(more.hidden).toBe(true);
    expect(items.every((item) => !item.element.hidden)).toBe(true);
  });

  it("setItems chiude «…» e rifà la riga", () => {
    const bar = createOptionsBar({ label: "Opzioni", moreLabel: "Altre opzioni", lifetime: life });
    document.body.append(bar.element);
    sized(bar.element, 50);
    bar.setItems([control("a", 40), control("b", 40)]);
    bar.element.querySelector<HTMLButtonElement>(".kit-options-more")!.click();
    const next = [control("c", 10)];
    bar.setItems(next);
    expect(document.querySelector(".kit-options-popover")).toBeNull();
    expect([...bar.element.querySelector(".kit-options-row")!.children]).toEqual([next[0]!.element]);
    expect(bar.overflow()).toEqual([]);
  });

  it("rifà il conto quando l'owner cambia un controllo che sta già in «…»", async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const bar = createOptionsBar({ label: "Opzioni", moreLabel: "Altre opzioni", lifetime: life });
    document.body.append(bar.element);
    sized(bar.element, 110);
    bar.element.querySelector<HTMLElement>(".kit-options-more")!.getBoundingClientRect = () =>
      ({ width: 20, height: 24, x: 0, y: 0, left: 0, top: 0, right: 20, bottom: 24, toJSON: () => ({}) });
    // Un involucro col suo gruppo: largo finché l'owner lo mostra, zero quando
    // lo nasconde; nascosto dalla barra, zero comunque.
    const holder = document.createElement("div");
    const group = document.createElement("div");
    group.textContent = "selezione";
    holder.append(group);
    const box = (width: number) => ({ width, height: 24, x: 0, y: 0, left: 0, top: 0, right: width, bottom: 24, toJSON: () => ({}) });
    holder.getBoundingClientRect = () => box(holder.hidden || group.hidden ? 0 : 300);
    const after = control("dopo", 40);
    bar.setItems([control("prima", 40, 1), { id: "selezione", element: holder }, after]);
    // Al primo conto il gruppo è ancora visibile e non ci sta: escono lui e
    // quello dopo.
    expect(bar.overflow()).toEqual(["selezione", "dopo"]);

    // I conti della barra non ne chiamano altri: solo i due fotogrammi
    // chiesti qui.
    let asked = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      asked += 1;
      return original(callback);
    };
    try {
      bar.fit();
      await frame();
      await frame();
      expect(asked).toBe(2);
    } finally {
      window.requestAnimationFrame = original;
    }

    group.hidden = true;
    await frame();
    await frame();
    expect(bar.overflow()).toEqual([]);
    expect(after.element.hidden).toBe(false);
  });

  it("il testo che cambia dentro un controllo non rifà il conto", async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const bar = createOptionsBar({ label: "Opzioni", moreLabel: "Altre opzioni", lifetime: life });
    document.body.append(bar.element);
    sized(bar.element, 110);
    bar.element.querySelector<HTMLElement>(".kit-options-more")!.getBoundingClientRect = () =>
      ({ width: 20, height: 24, x: 0, y: 0, left: 0, top: 0, right: 20, bottom: 24, toJSON: () => ({}) });
    // La percentuale dello zoom, in un controllo finito in «…» e in uno che
    // si vede: cambia a ogni passo della rotella.
    const items = [control("colore", 40, 2), control("zoom", 40, 1), control("vista", 40)];
    bar.setItems(items);
    expect(bar.overflow()).toEqual(["vista"]);
    let asked = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      asked += 1;
      return original(callback);
    };
    try {
      items[1]!.element.textContent = "58%";
      items[2]!.element.textContent = "61%";
      await Promise.resolve();
      await frame();
      expect(asked).toBe(1);
    } finally {
      window.requestAnimationFrame = original;
    }
  });

  it("rifare il conto non toglie il fuoco al controllo appena premuto", () => {
    const bar = createOptionsBar({ label: "Opzioni", moreLabel: "Altre opzioni", lifetime: life });
    document.body.append(bar.element);
    sized(bar.element, 110);
    bar.element.querySelector<HTMLElement>(".kit-options-more")!.getBoundingClientRect = () =>
      ({ width: 20, height: 24, x: 0, y: 0, left: 0, top: 0, right: 20, bottom: 24, toJSON: () => ({}) });
    const items = [control("colore", 40, 2), control("spessore", 40, 1), control("levigatura", 40)];
    bar.setItems(items);
    expect(bar.overflow()).toEqual(["levigatura"]);
    items[0]!.element.focus();
    expect(document.activeElement).toBe(items[0]!.element);
    bar.fit();
    expect(document.activeElement).toBe(items[0]!.element);
    sized(bar.element, 400);
    bar.fit();
    expect(bar.overflow()).toEqual([]);
    expect(document.activeElement).toBe(items[0]!.element);
  });

  /// Una barra larga `width` con «…» largo 20 e tre controlli da 40.
  const crowded = (width: number, padding = 0) => {
    const bar = createOptionsBar({ label: "Opzioni", moreLabel: "Altre opzioni", lifetime: life });
    document.body.append(bar.element);
    if (padding) bar.element.style.padding = `0 ${padding}px`;
    sized(bar.element, width);
    const more = bar.element.querySelector<HTMLButtonElement>(".kit-options-more")!;
    more.getBoundingClientRect = () => ({ width: 20, height: 24, x: 0, y: 0, left: 0, top: 0, right: 20, bottom: 24, toJSON: () => ({}) });
    const items = [control("a", 40), control("b", 40), control("c", 40)];
    bar.setItems(items);
    return { bar, more, items };
  };
  const key = (target: Element, name: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it("il riempimento della barra non è spazio per i controlli", () => {
    expect(crowded(130).bar.overflow()).toEqual([]);
    document.body.replaceChildren();
    expect(crowded(130, 10).bar.overflow()).toEqual(["c"]);
  });

  it("setItems lascia al suo posto, e col fuoco, il controllo che resta", () => {
    const { bar, items } = crowded(400);
    const kept = items[0]!.element;
    kept.focus();
    const next = [{ id: "a", element: kept }, control("d", 40), control("e", 40)];
    bar.setItems(next);
    const row = bar.element.querySelector(".kit-options-row")!;
    expect([...row.children]).toEqual(next.map((item) => item.element));
    expect(document.activeElement).toBe(kept);
    expect(items[1]!.element.isConnected).toBe(false);
  });

  it("nel popover Su e Giù girano fra i controlli, Esc chiude e riporta il fuoco su «…»", () => {
    const { bar, more, items } = crowded(70);
    expect(bar.overflow()).toEqual(["b", "c"]);
    more.focus();
    more.click();
    expect(document.querySelector(".kit-options-popover")).not.toBeNull();
    const [b, c] = [items[1]!.element, items[2]!.element];
    expect(document.activeElement).toBe(b);
    expect(key(b, "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c);
    key(c, "ArrowDown");
    expect(document.activeElement).toBe(b);
    key(b, "ArrowUp");
    expect(document.activeElement).toBe(c);
    key(c, "Escape");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
    expect(bar.element.contains(c)).toBe(true);
  });

  it("nel popover si raggiungono anche i controlli senza punto di tabulazione, e chiudendo tornano come erano", () => {
    const { more, items } = crowded(70);
    for (const item of items) item.element.tabIndex = -1;
    more.click();
    expect(items[1]!.element.tabIndex).toBe(0);
    expect(items[2]!.element.tabIndex).toBe(0);
    expect(document.activeElement).toBe(items[1]!.element);
    more.click();
    expect(items.map((item) => item.element.tabIndex)).toEqual([-1, -1, -1]);
  });

  it("quando tutto torna nella riga, il fuoco che stava su «…» va all'ultimo controllo, e `onFit` lo sa", () => {
    let fits = 0;
    const bar = createOptionsBar({ label: "Opzioni", moreLabel: "Altre opzioni", lifetime: life, onFit: () => fits++ });
    document.body.append(bar.element);
    sized(bar.element, 70);
    const more = bar.element.querySelector<HTMLButtonElement>(".kit-options-more")!;
    more.getBoundingClientRect = () => ({ width: 20, height: 24, x: 0, y: 0, left: 0, top: 0, right: 20, bottom: 24, toJSON: () => ({}) });
    const items = [control("a", 40), control("b", 40)];
    bar.setItems(items);
    expect(more.hidden).toBe(false);
    more.focus();
    const before = fits;
    sized(bar.element, 400);
    bar.fit();
    expect(fits).toBe(before + 1);
    expect(more.hidden).toBe(true);
    expect(document.activeElement).toBe(items[1]!.element);
  });

  it("chiudere la vita non lascia ascolti", () => {
    const ledger = listenerLedger(document, window);
    const bar = createOptionsBar({ label: "Opzioni", moreLabel: "Altre opzioni", lifetime: life });
    document.body.append(bar.element);
    sized(bar.element, 50);
    bar.setItems([control("a", 40), control("b", 40)]);
    bar.element.querySelector<HTMLButtonElement>(".kit-options-more")!.click();
    life.close();
    expect(ledger()).toBe(0);
  });
});
