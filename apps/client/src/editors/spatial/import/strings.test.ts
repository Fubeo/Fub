// Il presidio del catalogo dell'importazione. La metà che il compilatore non
// vede, come per il catalogo della shell (`i18n/strings.test.ts`) e quello
// della galleria: gli stessi nomi fra graffe in ogni lingua, nessuna voce
// vuota, e chiavi che la shell e il disegno non hanno.
import { describe, expect, it } from "vitest";
import { catalogFor as shellCatalogFor } from "../../../i18n/strings";
import { drawStrings } from "../strings";
import { importStrings, plural, t } from "./strings";

const IT = importStrings.catalogFor("it");
const EN = importStrings.catalogFor("en");

/// I nomi fra graffe di un modello, come in `i18n/strings.test.ts`.
function templateArguments(template: string): string[] {
  return [...template.matchAll(/\{\{|\}\}|\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe("il catalogo dell'importazione", () => {
  it("ha un inglese suo", () => {
    expect(EN).not.toBe(IT);
    expect(IT["draw.import.title"]).toBe("Importa disegno");
    expect(EN["draw.import.title"]).toBe("Import drawing");
  });

  it("chiede gli stessi argomenti in ogni lingua, chiave per chiave", () => {
    for (const key of Object.keys(IT)) {
      expect(templateArguments(EN[key]!), `«${key}» chiede argomenti diversi in inglese`).toEqual(templateArguments(IT[key]!));
    }
    expect(Object.keys(EN).sort()).toEqual(Object.keys(IT).sort());
  });

  it("non ha voci vuote, e l'inglese non è l'italiano ricopiato", () => {
    for (const key of Object.keys(IT)) {
      expect(IT[key]!.trim(), `«${key}» è vuota in italiano`).not.toBe("");
      expect(EN[key]!.trim(), `«${key}» è vuota in inglese`).not.toBe("");
    }
    const same = Object.keys(IT).filter((key) => IT[key] === EN[key]);
    expect(same, "voci uguali nelle due lingue: tradotte?").toEqual([]);
  });

  it("ha chiavi sue, che né la shell né il disegno hanno", () => {
    const shell = shellCatalogFor("it");
    const draw = drawStrings.catalogFor("it");
    for (const key of Object.keys(IT)) {
      expect(key.startsWith("draw.import."), `«${key}» non comincia con draw.import.`).toBe(true);
      expect(shell[key], `«${key}» sta anche nel catalogo della shell`).toBeUndefined();
      expect(draw[key], `«${key}» sta anche nel catalogo del disegno`).toBeUndefined();
    }
  });

  it("ha il singolare e il plurale di ogni frase che conta", () => {
    for (const key of Object.keys(IT)) {
      const pair = key.endsWith(".one") ? `${key.slice(0, -".one".length)}.other` : key.endsWith(".other") ? `${key.slice(0, -".other".length)}.one` : null;
      if (pair !== null) expect(IT[pair], `«${key}» non ha la sua coppia`).toBeDefined();
      if (key.endsWith(".other")) expect(IT[key], `«${key}» non dice il numero`).toContain("{count}");
    }
  });

  it("risponde con `t` e `plural`, anche con un nome fra graffe", () => {
    expect(t("draw.import.from", { file: "rete.drawio", program: "draw.io" })).toBe("Da «rete.drawio», un disegno di draw.io.");
    expect(plural(1, "draw.import.count.shapes.one", "draw.import.count.shapes.other")).toBe("1 forma");
    expect(plural(3, "draw.import.count.shapes.one", "draw.import.count.shapes.other")).toBe("3 forme");
  });
});
