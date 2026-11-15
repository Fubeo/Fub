// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../../ui/lifetime";
import { coverElement, coverYOf, type CoverHost } from "./cover";

// La copertina della testata (T6): gli strumenti al passaggio e il
// riposizionamento che scrive `cover-y:`.

afterEach(() => document.body.replaceChildren());

function cover(y: number | null, editable = true) {
  const life = openLifetime();
  const host = {
    editable,
    mountImage: (root: HTMLElement, html: string) => {
      root.insertAdjacentHTML("beforeend", html);
      return () => {};
    },
    change: vi.fn(),
    reposition: vi.fn(),
    measure: vi.fn(),
  } satisfies CoverHost;
  const element = coverElement("img/mare.png", y, host, life);
  document.body.append(element);
  return { element, host, life };
}

const press = (target: HTMLElement, key: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
const tool = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>(".cm-fub-page-cover-tool")].find((button) => button.textContent === text)!;

describe("la posizione della copertina", () => {
  it("legge `cover-y:` da 0 a 100, e niente se non è un numero", () => {
    expect(coverYOf("30")).toBe(30);
    expect(coverYOf(" 12.6 ")).toBe(13);
    expect(coverYOf("140")).toBe(100);
    expect(coverYOf("-5")).toBe(0);
    expect(coverYOf("alto")).toBeNull();
    expect(coverYOf(null)).toBeNull();
  });
});

describe("la copertina", () => {
  it("mostra l'immagine alla posizione scritta, al centro se non c'è", () => {
    expect(cover(20).element.querySelector("img")!.style.objectPosition).toBe("50% 20%");
    expect(cover(null).element.querySelector("img")!.style.objectPosition).toBe("50% 50%");
  });

  it("al passaggio offre «Cambia copertina» e «Riposiziona», mai a riposo", () => {
    const { element, host } = cover(null);
    const tools = element.querySelector<HTMLElement>(".cm-fub-page-cover-tools")!;
    expect(tools.dataset.presence).toBe("hover");
    tool(element, "Cambia copertina").click();
    expect(host.change).toHaveBeenCalledTimes(1);
  });

  it("in Lettura e in sola lettura si guarda e basta", () => {
    expect(cover(null, false).element.querySelector(".cm-fub-page-cover-tools")).toBeNull();
  });

  it("↑ ↓ la spostano e Invio scrive la posizione", () => {
    const { element, host } = cover(50);
    tool(element, "Riposiziona").click();
    expect(element.dataset.reposition).toBe("true");
    expect(element.getAttribute("role")).toBe("slider");
    expect(document.activeElement).toBe(element);
    press(element, "ArrowUp");
    press(element, "ArrowUp");
    press(element, "ArrowDown", true);
    expect(element.getAttribute("aria-valuenow")).toBe("59");
    press(element, "Enter");
    expect(host.reposition).toHaveBeenCalledWith(59);
    expect(element.dataset.reposition).toBeUndefined();
    expect(element.getAttribute("role")).toBeNull();
  });

  it("Esc (o «Annulla») torna dov'era e non scrive", () => {
    const { element, host } = cover(40);
    tool(element, "Riposiziona").click();
    press(element, "End");
    expect(element.querySelector("img")!.style.objectPosition).toBe("50% 100%");
    press(element, "Escape");
    expect(element.querySelector("img")!.style.objectPosition).toBe("50% 40%");
    tool(element, "Riposiziona").click();
    press(element, "Home");
    tool(element, "Annulla").click();
    expect(host.reposition).not.toHaveBeenCalled();
    expect(element.querySelector(".cm-fub-page-cover-moving")).toBeNull();
  });

  it("«Salva la posizione» senza averla cambiata non scrive niente", () => {
    const { element, host } = cover(40);
    tool(element, "Riposiziona").click();
    tool(element, "Salva la posizione").click();
    expect(host.reposition).not.toHaveBeenCalled();
  });

  it("chiusa la sua vita, il riposizionamento in corso finisce", () => {
    const { element, life } = cover(40);
    tool(element, "Riposiziona").click();
    life.close();
    expect(element.dataset.reposition).toBeUndefined();
  });
});
