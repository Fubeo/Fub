// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessibleName } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { numberField, SCRUB_PX, type NumberFieldOptions } from "./number-field";
import { listenerLedger, pointer, press } from "./testing";

let life: Lifetime;
let commits: number[];
let previews: number[];

function field(extra: Partial<NumberFieldOptions> = {}) {
  const made = numberField({
    label: "Larghezza",
    value: 120,
    unit: "mm",
    units: { mm: 1, cm: 10 },
    places: 1,
    language: "it",
    mixedText: "Misto",
    problem: (problem) => `non va: ${problem}`,
    onCommit: (value) => {
      commits.push(value);
    },
    onPreview: (value) => previews.push(value),
    lifetime: life,
    ...extra,
  });
  document.body.append(made.element);
  return made;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  life = openLifetime();
  commits = [];
  previews = [];
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
});

describe("il campo numerico del kit", () => {
  it("è uno spinbutton col nome, il valore e l'unità detti", () => {
    const { input, element } = field();
    expect(input.getAttribute("role")).toBe("spinbutton");
    expect(accessibleName(input)).toBe("Larghezza");
    expect(input.value).toBe("120");
    expect(input.getAttribute("aria-valuenow")).toBe("120");
    expect(input.getAttribute("aria-valuetext")).toBe("120 mm");
    expect(element.querySelector(".kit-number-unit")?.textContent).toBe("mm");
  });

  it("Invio conferma i calcoli e le unità, Esc torna a prima", () => {
    const { input } = field();
    type(input, "2cm + 5");
    press(input, "Enter");
    expect(commits).toEqual([25]);
    expect(input.value).toBe("25");
    type(input, "40");
    press(input, "Escape");
    expect(input.value).toBe("25");
    expect(commits).toEqual([25]);
    // Il fuoco che se ne va conferma.
    input.focus();
    type(input, "50%");
    input.blur();
    expect(commits).toEqual([25]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("ciò che non si legge resta scritto e dice perché", () => {
    const { input, element } = field({ relative: true });
    type(input, "3 in");
    press(input, "Enter");
    expect(commits).toEqual([]);
    expect(input.value).toBe("3 in");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = element.querySelector<HTMLElement>(".kit-number-error")!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("non va: unit");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    type(input, "50%");
    press(input, "Enter");
    expect(commits).toEqual([60]);
    expect(error.hidden).toBe(true);
  });

  it("le frecce cambiano di un passo, dieci con Maiuscolo e un decimo con Alt, dentro i limiti", () => {
    const { input } = field({ max: 131 });
    press(input, "ArrowUp");
    press(input, "ArrowUp", { shiftKey: true });
    press(input, "ArrowDown", { altKey: true });
    press(input, "ArrowUp", { shiftKey: true });
    expect(commits).toEqual([121, 131, 130.9, 131]);
    expect(input.value).toBe("131");
  });

  it("un rifiuto di chi chiama lascia il valore di prima", () => {
    const { input, value } = field({ onCommit: () => "la tavola è bloccata" });
    type(input, "90");
    press(input, "Enter");
    expect(value()).toBe(120);
    expect(input.value).toBe("90");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("misto: vuoto, dice «Misto», e le frecce non hanno da dove partire", () => {
    const { input, element } = field({ value: null });
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Misto");
    expect(input.getAttribute("aria-valuetext")).toBe("Misto");
    expect(input.hasAttribute("aria-valuenow")).toBe(false);
    press(input, "ArrowUp");
    expect(commits).toEqual([]);
    expect(element.querySelector(".kit-number-error")?.textContent).toBe("non va: mixed");
    type(input, "10");
    press(input, "Enter");
    expect(commits).toEqual([10]);
  });

  it("l'etichetta si tira: anteprime durante il gesto, una conferma al rilascio", () => {
    const { element, input } = field({ places: 0 });
    const label = element.querySelector<HTMLElement>(".kit-number-label")!;
    label.dispatchEvent(pointer("pointerdown", { clientX: 100 }));
    expect(element.classList.contains("scrubbing")).toBe(true);
    label.dispatchEvent(pointer("pointermove", { clientX: 100 + SCRUB_PX * 3 }));
    label.dispatchEvent(pointer("pointermove", { clientX: 100 + SCRUB_PX * 5, shiftKey: true }));
    expect(previews).toEqual([123, 170]);
    expect(input.value).toBe("170");
    expect(commits).toEqual([]);
    label.dispatchEvent(pointer("pointerup", { clientX: 100 + SCRUB_PX * 5 }));
    expect(commits).toEqual([170]);
    expect(element.classList.contains("scrubbing")).toBe(false);
    // Un gesto interrotto torna al valore confermato.
    label.dispatchEvent(pointer("pointerdown", { clientX: 0 }));
    label.dispatchEvent(pointer("pointermove", { clientX: SCRUB_PX * 2 }));
    label.dispatchEvent(pointer("pointercancel", { clientX: SCRUB_PX * 2 }));
    expect(input.value).toBe("170");
    expect(previews[previews.length - 1]).toBe(170);
    expect(commits).toEqual([170]);
  });

  it("setValue non tocca ciò che si sta scrivendo", () => {
    const made = field();
    made.focus();
    type(made.input, "9");
    made.setValue(80);
    expect(made.input.value).toBe("9");
    made.input.blur();
    expect(commits).toEqual([9]);
    made.setValue(80);
    expect(made.input.value).toBe("80");
  });

  it("chiudere la vita toglie gli ascolti", () => {
    const ledger = listenerLedger(document, window);
    const made = field();
    life.close();
    type(made.input, "1");
    press(made.input, "Enter");
    expect(commits).toEqual([]);
    expect(ledger()).toBe(0);
  });
});
