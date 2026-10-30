// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "./lifetime";
import { mountSystemMenuGuard } from "./system-menu";

function rightClick(target: Element, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 5, ...init });
  target.dispatchEvent(e);
  return e;
}

describe("il menu della WebView", () => {
  let lifetime: Lifetime;

  beforeEach(() => {
    lifetime = openLifetime();
    mountSystemMenuGuard(lifetime);
    document.body.innerHTML = `
      <div id="vuoto"></div>
      <input id="campo">
      <div id="testo" contenteditable="true">testo</div>
      <div id="suo"></div>`;
    document.querySelector("#suo")!.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  afterEach(() => {
    lifetime.close();
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it("non compare dove Fub non ha un menu", () => {
    expect(rightClick(document.querySelector("#vuoto")!).defaultPrevented).toBe(true);
  });

  it("resta nei campi di testo, col Maiuscolo e sul testo scelto", () => {
    expect(rightClick(document.querySelector("#campo")!).defaultPrevented).toBe(false);
    expect(rightClick(document.querySelector("#testo")!).defaultPrevented).toBe(false);
    expect(rightClick(document.querySelector("#vuoto")!, { shiftKey: true }).defaultPrevented).toBe(false);
    const empty = document.querySelector("#vuoto")!;
    empty.textContent = "da copiare";
    const range = document.createRange();
    range.selectNodeContents(empty);
    window.getSelection()!.addRange(range);
    expect(rightClick(empty).defaultPrevented, "Copia del sistema sul testo scelto").toBe(false);
  });

  it("smontato, lascia fare la piattaforma", () => {
    lifetime.close();
    expect(rightClick(document.querySelector("#vuoto")!).defaultPrevented).toBe(false);
  });
});
