// Le righe dell'albero non si scelgono come testo (IMP-004): un triplo clic
// sul nome di una cartella lo lasciava evidenziato. La regola sta nella
// struttura e non nella pelle, perché WebKitGTK legge soltanto
// `-webkit-user-select`, e il filtro dei temi non lo lascia passare.
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

describe("le righe dell'albero non sono testo da scegliere", () => {
  it("la riga non si sceglie, anche in WebKitGTK", () => {
    const row = declarations(structure, ".tree-row");
    expect(row["-webkit-user-select"]).toBe("none");
    expect(row["user-select"]).toBe("none");
  });

  it("il campo della rinomina, dentro la riga, si sceglie", () => {
    const input = declarations(structure, ".tree-row input");
    expect(input["-webkit-user-select"]).toBe("text");
    expect(input["user-select"]).toBe("text");
  });
});
