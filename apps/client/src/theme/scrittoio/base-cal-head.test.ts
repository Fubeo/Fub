// Al telefono la scelta della data del calendario della Base si stringeva
// accanto al mese e ai tre bottoni fino a «cons…» (350 px di testa, 71 px di
// menu per «consegna»). Ora va a capo su una riga sua. La misura vera l'ha
// guardata il banco (scena `mobile-base-calendario`, due luci: menu largo 84
// px, nome intero); qui si tiene la regola, dentro la sola domanda del
// telefono, perché al computer la scelta resta in fondo alla stessa riga.
import { describe, expect, it } from "vitest";
import editors from "./skin/editors.css?raw";

/// Il corpo della domanda `@container sheet (max-width: 560px)` che porta il
/// calendario in colonna.
function phoneBlock(text: string): string {
  const start = text.search(/@container sheet \(max-width: 560px\)\s*\{\s*\.base-cal-grid\b/);
  expect(start, "la domanda del telefono del calendario").toBeGreaterThan(-1);
  let depth = 0;
  for (let index = text.indexOf("{", start); index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  return text.slice(start);
}

/// Le dichiarazioni della regola il cui selettore è esattamente `selector`.
function declarations(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1]!.split(",").some((each) => each.trim() === selector)) continue;
    for (const line of rule[2]!.split(";")) {
      const [name, ...value] = line.split(":");
      if (name && value.length > 0) out[name.trim()] = value.join(":").trim();
    }
  }
  return out;
}

describe("la scelta della data del calendario, al telefono", () => {
  const css = editors.replace(/\/\*[\s\S]*?\*\//g, "");
  const phone = phoneBlock(css);

  it("la testa va a capo", () => {
    expect(declarations(phone, ".base-cal-head")["flex-wrap"]).toBe("wrap");
  });

  it("la scelta prende una riga sua, senza la spinta a destra", () => {
    const key = declarations(phone, ".base-cal-head > .base-view-key");
    expect(key.flex).toMatch(/\b100%$/);
    expect(key["margin-left"]).toBe("0");
  });

  it("al computer resta in fondo alla riga del mese", () => {
    const outside = css.replace(phone, "");
    expect(declarations(outside, ".base-cal-head")["flex-wrap"]).toBeUndefined();
    expect(declarations(outside, ".base-cal-head > .base-view-key")["margin-left"]).toBe("auto");
  });
});
