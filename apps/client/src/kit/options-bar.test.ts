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
