// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { openLifetime } from "../ui/lifetime";
import { keepFocusOnPress } from "./keep-focus";
import { realClick } from "./testing";

function scene(): { field: HTMLInputElement; button: HTMLButtonElement } {
  document.body.innerHTML = '<input id="campo"><button type="button" aria-label="Passa alla luce giorno"></button>';
  const field = document.querySelector("input")!;
  field.focus();
  return { field, button: document.querySelector("button")! };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("keepFocusOnPress", () => {
  it("il clic arriva, e il fuoco resta a chi lo aveva", () => {
    const { field, button } = scene();
    let clicks = 0;
    button.addEventListener("click", () => clicks++);
    keepFocusOnPress(button);
    realClick(button);
    expect(clicks).toBe(1);
    expect(document.activeElement).toBe(field);
  });

  it("senza, il clic dà il fuoco al bottone, come fa il browser", () => {
    const { button } = scene();
    realClick(button);
    expect(document.activeElement).toBe(button);
  });

  it("il bottone resta nel giro del Tab, col suo nome", () => {
    const { button } = scene();
    keepFocusOnPress(button);
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-label")).toBe("Passa alla luce giorno");
  });

  it("con `when` decide a ogni pressione", () => {
    const { field, button } = scene();
    let inPlace = true;
    keepFocusOnPress(button, { when: () => inPlace });
    realClick(button);
    expect(document.activeElement).toBe(field);
    inPlace = false;
    realClick(button);
    expect(document.activeElement).toBe(button);
  });

  it("con una vita, smontato torna il clic del browser", () => {
    const { field, button } = scene();
    const lifetime = openLifetime();
    keepFocusOnPress(button, { lifetime });
    realClick(button);
    expect(document.activeElement).toBe(field);
    lifetime.close();
    realClick(button);
    expect(document.activeElement).toBe(button);
  });
});
