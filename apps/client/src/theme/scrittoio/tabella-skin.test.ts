// La griglia della Live quando la tabella è più larga della colonna: scorre
// di lato, e i numeri delle righe restano fermi nel margine coprendo le celle
// che ci passano sotto. La prova a schermo è del banco; qui si tiene ferma la
// regola che la rende possibile, perché nessun DOM finto calcola lo scorrimento.
import { describe, expect, it } from "vitest";

import tabella from "./skin/tabella.css?raw";

const RULES = [...tabella.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]!.split(",").map((s) => s.trim()),
  body: m[2]!,
}));

function declarations(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const rule of RULES) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [, name, value] of rule.body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) found[name!] = value!.trim();
  }
  return found;
}

describe("la griglia larga scorre sotto i numeri delle righe", () => {
  it("numeri e angolo stanno fermi a sinistra, sopra le celle, col fondo del foglio", () => {
    for (const part of ["tb-rowhead", "tb-corner"]) {
      const rule = declarations(`.cm-editor .cm-content .tb-grid .${part}`);
      expect(rule.position, part).toBe("sticky");
      expect(rule.left, part).toBe("0");
      expect(rule["z-index"], part).toBe("3");
      expect(rule.background, part).toBe("var(--doc-bg)");
      // Nascosti con l'opacità perderebbero anche il fondo che copre.
      expect(rule.opacity, part).toBe("1");
    }
  });

  it("a riposo si nascondono col colore, e il fondo che copre resta squadrato", () => {
    expect(declarations(".cm-editor .cm-content .tb-grid:not(:focus-within) .tb-rowhead").color).toBe("transparent");
    expect(declarations(".cm-editor .cm-content .tb-grid:not(:focus-within) .tb-corner").color).toBe("transparent");
    // Più peso dell'angolo arrotondato di `document.css`
    // (`.markdown-rendered table > :last-child > tr:last-child > :first-child`).
    expect(declarations(".cm-editor .cm-content .tb-frame .tb-grid .tb-rowhead")["border-radius"]).toBe("0");
    expect(declarations(".cm-editor .cm-content .tb-frame .tb-grid .tb-corner")["border-radius"]).toBe("0");
  });

  it("la regola ferma viene dopo quella che rende relative le intestazioni", () => {
    const relative = RULES.findIndex((r) => r.selectors.includes(".cm-editor .cm-content .tb-grid .tb-rowhead") && /position:\s*relative/.test(r.body));
    const sticky = RULES.findIndex((r) => r.selectors.includes(".cm-editor .cm-content .tb-grid .tb-rowhead") && /position:\s*sticky/.test(r.body));
    expect(relative).toBeGreaterThanOrEqual(0);
    expect(sticky).toBeGreaterThan(relative);
  });
});
