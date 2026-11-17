// Invio in una formula a blocco (T65): va a capo e allinea gli uguali, e la
// formula si legge sempre.
import katex from "katex";
import { describe, expect, it } from "vitest";
import { readOptions } from "../math";
import { alignEnter } from "./align";
import { mapFormula, snap } from "./points";

const reads = (tex: string) => {
  katex.renderToString(tex, readOptions(true));
  return true;
};

describe("Invio che allinea", () => {
  it("la prima volta entra un aligned, col primo uguale allineato e una riga nuova", () => {
    const next = alignEnter({ tex: "x^2 + 2x = 3", caret: 12 });
    expect(next.tex).toBe("\\begin{aligned}\nx^2 + 2x &= 3 \\\\\n&= \n\\end{aligned}");
    expect(next.tex.slice(0, next.caret).endsWith("&= ")).toBe(true);
    expect(reads(next.tex)).toBe(true);
  });

  it("senza uguale la formula è la prima riga", () => {
    const next = alignEnter({ tex: "a+b", caret: 3 });
    expect(next.tex).toBe("\\begin{aligned}\na+b \\\\\n&= \n\\end{aligned}");
    expect(reads(next.tex)).toBe(true);
  });

  it("l'uguale dentro un pezzo non si allinea: vale il primo fuori dalle graffe", () => {
    const next = alignEnter({ tex: "\\text{a=b} = 1", caret: 0 });
    expect(next.tex).toContain("\\text{a=b} &= 1");
    expect(reads(next.tex)).toBe(true);
  });

  it("dopo, ogni Invio aggiunge una riga dove sta il cursore", () => {
    const first = alignEnter({ tex: "x = 1 + 1", caret: 9 });
    const typed = { tex: first.tex.slice(0, first.caret) + "2" + first.tex.slice(first.caret), caret: first.caret + 1 };
    const second = alignEnter(typed);
    expect(second.tex).toBe("\\begin{aligned}\nx &= 1 + 1 \\\\\n&= 2 \\\\\n&= \n\\end{aligned}");
    expect(second.tex.slice(0, second.caret).endsWith("&= 2 \\\\\n&= ")).toBe(true);
    expect(reads(second.tex)).toBe(true);
  });

  it("dentro un pezzo la riga resta intera: la nuova va dopo", () => {
    const tex = "\\begin{aligned}\nx &= \\frac{1}{2} \\\\\n&= 3\n\\end{aligned}";
    const next = alignEnter({ tex, caret: tex.indexOf("1}") });
    expect(next.tex).toBe("\\begin{aligned}\nx &= \\frac{1}{2} \\\\\n&= \\\\\n&= 3\n\\end{aligned}");
    expect(reads(next.tex)).toBe(true);
  });

  it("nella formula che si tocca il cursore resta sulla riga nuova, e ciò che si scrive ci entra", () => {
    const next = alignEnter({ tex: "y = mx + q", caret: 10 });
    // Sulla riga nuova vuota l'unico punto buono è davanti a `\end`: ciò che
    // si scrive entra lì, ancora nella riga nuova.
    const at = snap(mapFormula(next.tex), next.caret);
    expect(next.tex.slice(next.caret - 3, next.caret)).toBe("&= ");
    expect(next.tex.slice(next.caret, at).trim()).toBe("");
    const typed = next.tex.slice(0, at) + "2" + next.tex.slice(at);
    expect(reads(typed)).toBe(true);
    expect(typed.endsWith("&= \n2\\end{aligned}")).toBe(true);
  });
});
