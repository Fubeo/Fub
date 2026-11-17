// Il «+» della striscia resta a vista quando la striscia scorre (IMP-014):
// stava dopo l'ultima linguetta, e con la striscia piena finiva sotto l'elenco
// o oltre il bordo del foglio. Si ferma accanto all'elenco, che è largo 24 px.
// La misura vera l'ha guardata il banco, a 1280 e a 800: qui si tiene la regola.
import { describe, expect, it } from "vitest";
import structure from "./structure.css?raw";

/// Le dichiarazioni della regola il cui selettore è esattamente `selector`.
function declarations(css: string, selector: string): Record<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1]!.split(",").some((each) => each.trim() === selector)) continue;
    for (const line of rule[2]!.split(";")) {
      const [name, ...value] = line.split(":");
      if (name && value.length > 0) out[name.trim()] = value.join(":").trim();
    }
  }
  return out;
}

describe("il «+» della striscia", () => {
  it("si ferma accanto all'elenco, sopra le linguette che scorrono", () => {
    const plus = declarations(structure, ".pane-tabs > .tab-new");
    expect(plus.position).toBe("sticky");
    expect(plus.right).toContain("24px");
    expect(plus["z-index"]).toBe("1");
    const menu = declarations(structure, ".pane-tabs > [data-tab-menu]");
    expect(menu.position).toBe("sticky");
    expect(menu.right).toBe("0");
  });

  it("senza l'elenco si ferma sul bordo", () => {
    expect(declarations(structure, ".pane-tabs:has(> [data-tab-menu][hidden]) > .tab-new").right).toBe("0");
  });
});
