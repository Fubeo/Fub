// Le attese che non spostano il testo (UX-019): una scheda che carica è già
// alta quanto la sua vista, e il posto di una nota riportata che arriva
// tiene l'altezza ricordata. Il banco ha misurato il salto (la scheda di un
// disegno da 80 a 394 px, la riga sotto giù di 450 px); qui si tengono le
// regole che lo tolgono.
import { describe, expect, it } from "vitest";
import cards from "./skin/live-cards.css?raw";
import blocks from "./skin/document-blocks.css?raw";

/// Le dichiarazioni delle regole che hanno `selector` fra i loro selettori.
function declarations(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1]!.split(",").some((each) => each.trim() === selector)) continue;
    for (const line of rule[2]!.split(";")) {
      const [name, ...value] = line.split(":");
      if (name && value.length > 0) out[name.trim()] = value.join(":").trim();
    }
  }
  return out;
}

describe("la scheda che carica", () => {
  const loading = '.live-card[data-card-state="loading"]';

  it("non si accorcia a una riga: tiene l'altezza della vista", () => {
    const body = declarations(cards, `${loading} .live-card-body`);
    expect(body.height).toBeUndefined();
    expect(body["min-height"]).toBeUndefined();
    expect(declarations(cards, ".live-card-body").height).toBe("360px");
  });

  it("un'altezza scritta nell'embed vale già mentre carica", () => {
    const written = declarations(cards, `${loading}[data-card-height="set"] .live-card-body`);
    expect(written.height).toBe(declarations(cards, '.live-card[data-card-state="view"][data-card-height="set"]:not([data-card-full="true"]) .live-card-body').height);
  });

  it("mostrata come riga resta una riga", () => {
    expect(declarations(cards, `${loading}[data-card-display="row"] .live-card-body`).height).toBe("auto");
  });
});

describe("il posto di una nota riportata che arriva", () => {
  it("tiene l'altezza ricordata, misurata sul bordo", () => {
    const pending = declarations(blocks, ".embed[data-embed-pending]");
    expect(pending["box-sizing"]).toBe("border-box");
    expect(pending["min-height"]).toBe("var(--embed-reserve, 0)");
  });

  it("nella Scrittura che si scrive, la prima volta almeno il vassoio con una riga", () => {
    expect(declarations(blocks, '.cm-content[contenteditable="true"] .embed[data-embed-pending]')["min-height"])
      .toBe("var(--embed-reserve, calc(44px + 1lh))");
  });
});
