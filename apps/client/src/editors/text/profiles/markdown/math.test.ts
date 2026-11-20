// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTooltip } from "../../../../ui/tooltip";
import { mountMathBlocks } from "./math";

const releases: Array<() => void> = [];
beforeEach(() => {
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
  closeTooltip();
  vi.unstubAllGlobals();
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

  it("dà alla formula un ruolo che ammette il suo nome, anche mentre carica e dopo un errore", async () => {
    const root = mount('<span class="math-inline" data-tex="x^2">x^2</span><span class="math-inline" data-tex="\\notARealCommand{x}">y</span>');
    const [good, bad] = [...root.querySelectorAll<HTMLElement>(".math-inline")];
    for (const formula of [good!, bad!]) {
      expect(formula.getAttribute("role")).toBe("math");
      expect(formula.getAttribute("aria-label")).toBeTruthy();
    }
    await vi.waitFor(() => expect(bad!.dataset.state).toBe("error"));
    await vi.waitFor(() => expect(good!.dataset.state).toBe("ready"));
    expect([good!, bad!].map((formula) => formula.getAttribute("role"))).toEqual(["math", "math"]);
  });

  it("conserva la sorgente quando KaTeX rifiuta la formula", async () => {
    const root = mount('<span class="math-inline" data-tex="\\notARealCommand{x}">\\notARealCommand{x}</span>');
    const formula = root.querySelector<HTMLElement>(".math-inline")!;
    await vi.waitFor(() => expect(formula.dataset.state).toBe("error"));
    expect(formula.textContent).toBe("\\notARealCommand{x}");
  });
});

/// Il suggerimento come lo vede chi passa sulla formula: dopo il ritardo, nel
/// riquadro del suggerimento (`[role="tooltip"]`).
async function tooltipOf(formula: HTMLElement): Promise<string | null> {
  formula.dispatchEvent(new MouseEvent("mouseenter", { clientX: 4, clientY: 4 }));
  const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]');
  await vi.waitFor(() => expect(tip()?.hidden).toBe(false));
  return tip()?.textContent ?? null;
}

describe("la formula rotta dice l'errore in parole, non il messaggio di KaTeX", () => {
  it("il nome e il suggerimento hanno la frase di `explain`", async () => {
    const root = mount('<span class="math-inline" data-tex="\\frac{a}">\\frac{a}</span>');
    const formula = root.querySelector<HTMLElement>(".math-inline")!;
    await vi.waitFor(() => expect(formula.dataset.state).toBe("error"));
    expect(formula.getAttribute("aria-label")).toBe("Formula non disponibile: A \\frac manca un pezzo.");
    expect(await tooltipOf(formula)).toBe("Formula non disponibile: A \\frac manca un pezzo.");
  });

  it("in inglese la stessa frase, nella lingua di chi guarda", async () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    const root = mount('<span class="math-inline" data-tex="\\frac{a}">\\frac{a}</span>');
    const formula = root.querySelector<HTMLElement>(".math-inline")!;
    await vi.waitFor(() => expect(formula.dataset.state).toBe("error"));
    expect(formula.getAttribute("aria-label")).toBe("Formula unavailable: \\frac is missing a piece.");
    expect(await tooltipOf(formula)).toBe("Formula unavailable: \\frac is missing a piece.");
  });

  it("un errore che non è di KaTeX (la formula troppo lunga) dice il suo limite, come prima", async () => {
    const root = mount(`<span class="math-inline" data-tex="${"a".repeat(20_001)}">x</span>`);
    const formula = root.querySelector<HTMLElement>(".math-inline")!;
    expect(formula.dataset.state).toBe("error");
    expect(formula.getAttribute("aria-label")).toBe("Formula non disponibile: La formula supera il limite di 20000 caratteri.");
  });
});
