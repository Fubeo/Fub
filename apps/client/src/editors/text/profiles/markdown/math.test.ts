// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountMathBlocks } from "./math";

const releases: Array<() => void> = [];
beforeEach(() => {
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "compatMode");
});

function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  releases.push(mountMathBlocks(container));
  return container;
}

describe("KaTeX Markdown hydration", () => {
  it("compone formule inline e a blocco con MathML accessibile", async () => {
    const root = mount('<span class="math-inline" data-tex="x^2">x^2</span><div class="math-block" data-tex="\\frac{a}{b}">\\frac{a}{b}</div>');
    await vi.waitFor(() => expect(root.querySelectorAll('[data-state="ready"]')).toHaveLength(2));
    expect(root.querySelectorAll(".katex")).toHaveLength(2);
    expect(root.querySelectorAll("math")).toHaveLength(2);
    expect(root.querySelector("script, iframe, object")).toBeNull();
    expect(root.querySelector<HTMLElement>(".math-block")?.getAttribute("aria-busy")).toBe("false");
  });

  it("conserva la sorgente quando KaTeX rifiuta la formula", async () => {
    const root = mount('<span class="math-inline" data-tex="\\notARealCommand{x}">\\notARealCommand{x}</span>');
    const formula = root.querySelector<HTMLElement>(".math-inline")!;
    await vi.waitFor(() => expect(formula.dataset.state).toBe("error"));
    expect(formula.textContent).toBe("\\notARealCommand{x}");
  });
});
