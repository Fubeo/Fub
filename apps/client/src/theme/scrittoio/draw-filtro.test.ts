// Il filtro dell'albero della scheda Livelli: la ricerca e il tipo stanno nella
// stessa riga alti quanto i campi del kit (`--control-h`), e non a 44 px come
// prima. Il banco misura la riga a schermo; qui si tiene ferma la regola, perché
// nessun DOM finto calcola l'altezza. La regola sta nella pelle e vince sulla
// struttura, che fissa `min-height: 44px` ai due, perché il selettore è doppio.
import { describe, expect, it } from "vitest";

import draw from "./skin/draw.css?raw";

const CSS = draw.replace(/\/\*[\s\S]*?\*\//g, "");
// Senza il blocco `pointer: coarse`, che ha la sua regola a parte.
const BASE = CSS.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "");

function declarations(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, selectors, body] of BASE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors!.split(",").map((s) => s.trim()).includes(selector)) continue;
    for (const [, name, value] of body!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) found[name!] = value!.trim();
  }
  return found;
}

describe("il filtro dell'albero dei livelli", () => {
  it("la ricerca e il tipo sono alti quanto i campi del kit, nella stessa riga", () => {
    for (const part of [".draw-objects-search", ".draw-objects-kind"]) {
      const rule = declarations(`.draw-objects-filter ${part}`);
      expect(rule.height, part).toBe("var(--control-h)");
      expect(rule["min-height"], part).toBe("0");
      expect(rule["box-sizing"], part).toBe("border-box");
    }
  });

  it("col dito restano bersagli da 44 px", () => {
    const coarse = CSS.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(coarse).toMatch(/\.draw-objects-filter \.draw-objects-search,\s*\.draw-objects-filter \.draw-objects-kind\s*\{\s*min-height:\s*44px;/);
  });
});
