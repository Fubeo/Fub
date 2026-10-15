// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { radioGroup, type RadioGroup } from "./radios";

let lifetime: Lifetime;
let group: HTMLElement;
let wired: RadioGroup;
const chosen = vi.fn();

function radios(): HTMLButtonElement[] {
  return [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const checked = (): string[] => radios().filter((radio) => radio.getAttribute("aria-checked") === "true").map((radio) => radio.id);
const stops = (): string[] => radios().filter((radio) => radio.tabIndex === 0).map((radio) => radio.id);

beforeEach(() => {
  lifetime = openLifetime();
  group = document.createElement("div");
  group.setAttribute("role", "radiogroup");
  for (const name of ["a", "b", "c", "d"]) {
    const radio = document.createElement("button");
    radio.type = "button";
    radio.id = name;
    radio.setAttribute("role", "radio");
    radio.setAttribute("aria-checked", String(name === "b"));
    group.append(radio);
  }
  document.body.replaceChildren(group);
  chosen.mockClear();
  wired = radioGroup(lifetime, group, (radio) => chosen(radio.id));
  wired.settle();
});

afterEach(() => lifetime.close());

describe("un gruppo di scelta", () => {
  it("ha una sola fermata nel Tab, ed è la scelta", () => {
    expect(stops()).toEqual(["b"]);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it("senza una scelta la fermata è la prima che si può scegliere", () => {
    radios()[1]!.setAttribute("aria-checked", "false");
    radios()[0]!.disabled = true;
    wired.settle();
    expect(stops()).toEqual(["b"]);
  });

  it("le frecce spostano insieme il fuoco, la scelta e la fermata", () => {
    radios()[1]!.focus();
    const event = press(radios()[1]!, "ArrowRight");
    expect(event.defaultPrevented).toBe(true);
    expect(checked()).toEqual(["c"]);
    expect(stops()).toEqual(["c"]);
    expect(document.activeElement?.id).toBe("c");
    expect(chosen).toHaveBeenLastCalledWith("c");

    press(radios()[2]!, "ArrowUp");
    expect(checked()).toEqual(["b"]);
    expect(chosen).toHaveBeenLastCalledWith("b");
  });

  it("le frecce girano agli estremi, Inizio e Fine ci vanno", () => {
    press(radios()[1]!, "End");
    expect(checked()).toEqual(["d"]);
    press(radios()[3]!, "ArrowDown");
    expect(checked()).toEqual(["a"]);
    press(radios()[0]!, "ArrowLeft");
    expect(checked()).toEqual(["d"]);
    press(radios()[3]!, "Home");
    expect(checked()).toEqual(["a"]);
  });

  it("le frecce saltano le opzioni spente", () => {
    radios()[2]!.disabled = true;
    press(radios()[1]!, "ArrowRight");
    expect(checked()).toEqual(["d"]);
  });

  it("una freccia con un modificatore non è del gruppo", () => {
    const event = press(radios()[1]!, "ArrowRight", { altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(checked()).toEqual(["b"]);
    expect(chosen).not.toHaveBeenCalled();
  });

  it("un clic sceglie; sulla scelta già fatta non chiama nessuno", () => {
    radios()[3]!.click();
    expect(checked()).toEqual(["d"]);
    expect(chosen).toHaveBeenCalledTimes(1);
    radios()[3]!.click();
    expect(chosen).toHaveBeenCalledTimes(1);
  });

  it("un'opzione spenta non si sceglie", () => {
    radios()[3]!.disabled = true;
    radios()[3]!.click();
    expect(checked()).toEqual(["b"]);
    expect(chosen).not.toHaveBeenCalled();
  });

  it("chiusa la vita non ascolta più", () => {
    lifetime.close();
    press(radios()[1]!, "ArrowRight");
    radios()[3]!.click();
    expect(checked()).toEqual(["b"]);
    expect(chosen).not.toHaveBeenCalled();
  });
});
