// @vitest-environment happy-dom
//
// L'aspetto `file` del documento (Pagina e Lettura): ogni paragrafo ha il
// carattere, la misura e il colore del file risolti, e li disegna la
// meccanica di `structure.css`, non la pelle.
//
// Il valore sta sull'elemento come variabile di dato (`--file-*`): sul
// paragrafo se il suo stile ne dice uno, sulla radice per il documento.
// happy-dom non risolve `var()`, quindi la prova è in due metà: il DOM porta
// un valore per ogni paragrafo, e la regola di `look-file` lo legge.
import { afterEach, describe, expect, it } from "vitest";
import projectionFixture from "../../__fixtures__/rich-projection.json";
import structure from "../../theme/scrittoio/structure.css?raw";
import { RichEngine } from "./engine";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

/// Il corpo della regola il cui selettore, fra le virgole, è `selector`.
function declarations(selector: string): Record<string, string> {
  const css = structure.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1]!.split(",").some((part) => part.trim() === selector)) continue;
    for (const declaration of rule[2]!.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) out[declaration[1]!] = declaration[2]!.trim();
  }
  return out;
}

describe("il documento sulla carta del file", () => {
  it("ogni paragrafo del docx del banco ha carattere, misura e colore risolti", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
    engines.push(engine);
    engine.setDoc(projectionFixture.source);
    const root = parent.querySelector<HTMLElement>(".rich-content")!;
    const paragraphs = [...parent.querySelectorAll<HTMLElement>(".rich-para")];
    expect(paragraphs.length).toBeGreaterThan(3);
    const own = (element: HTMLElement, name: string) => element.style.getPropertyValue(name) || root.style.getPropertyValue(name);
    for (const paragraph of paragraphs) {
      const where = paragraph.textContent?.slice(0, 24) ?? "";
      expect(own(paragraph, "--file-font"), where).not.toBe("");
      expect(own(paragraph, "--file-size"), where).toMatch(/^\d+(\.\d+)?pt$/);
      // Il colore del file, o l'automatico: l'inchiostro della carta.
      const color = own(paragraph, "--file-color");
      if (color) expect(color, where).toMatch(/^#[0-9a-f]{6}$/);
      expect(paragraph.style.fontFamily, where).toBe("");
      expect(paragraph.style.fontSize, where).toBe("");
      expect(paragraph.style.color, where).toBe("");
    }
  });

  it("la regola di look-file legge il valore del file, con il ripiego di un documento nuovo", () => {
    const para = declarations(".look-file .rich-para");
    expect(para["font-family"]).toMatch(/^var\(--file-font, /);
    expect(para["font-size"]).toBe("var(--file-size, 11pt)");
    expect(para["line-height"]).toMatch(/^var\(--file-line, /);
    expect(para["margin-block"]).toBe("var(--file-before, 0) var(--file-after, 8pt)");
    expect(declarations(".look-file .rich-para").color).toBe("var(--file-color, var(--doc-fg, #14161a))");
    expect(declarations('.look-file .rich-content [data-rich-color="auto"]').color).toBe("var(--doc-fg, #14161a)");
    expect(declarations(".look-file .rich-content mark")["background-color"]).toBe("var(--file-hl, #ffff00)");
    // Nell'adattato si legge la versione portata sulla carta del tema.
    expect(declarations(".look-adattato .rich-tint[data-tint-color]").color).toBe("var(--file-color-a, currentColor)");
    expect(declarations(".look-adattato .rich-tint[data-tint-hl]")["background-color"]).toBe("var(--file-hl-a, transparent)");
    // In Scrittura nessuna regola legge i valori del file.
    for (const rule of structure.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (rule[1]!.includes("look-tema")) expect(rule[2], rule[1]).not.toContain("--file-");
    }
  });
});
