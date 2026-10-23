// Il presidio del catalogo della barra, come quello del disegno
// (`editors/spatial/strings.test.ts`): gli stessi nomi fra graffe in ogni
// lingua, nessuna voce vuota, chiavi che la shell non ha.
import { describe, expect, it } from "vitest";
import { catalogFor as shellCatalogFor } from "../../../i18n/strings";
import { ribbonStrings, t } from "./strings";

const IT = ribbonStrings.catalogFor("it");
const EN = ribbonStrings.catalogFor("en");

function templateArguments(template: string): string[] {
  return [...template.matchAll(/\{\{|\}\}|\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe("il catalogo della barra", () => {
  it("ha un inglese suo", () => {
    expect(EN).not.toBe(IT);
    expect(IT["ribbon.tab.insert"]).toBe("Inserisci");
    expect(EN["ribbon.tab.insert"]).toBe("Insert");
  });

  it("chiede gli stessi argomenti in ogni lingua, chiave per chiave", () => {
    for (const key of Object.keys(IT)) {
      expect(templateArguments(EN[key]!), `«${key}» chiede argomenti diversi in inglese`).toEqual(templateArguments(IT[key]!));
    }
  });

  it("non ha voci vuote", () => {
    for (const key of Object.keys(IT)) {
      expect(IT[key]!.trim(), `«${key}» è vuota in italiano`).not.toBe("");
      expect(EN[key]!.trim(), `«${key}» è vuota in inglese`).not.toBe("");
    }
  });

  it("ha chiavi sue, che la shell non ha", () => {
    const shell = shellCatalogFor("it");
    for (const key of Object.keys(IT)) {
      expect(key.startsWith("ribbon."), `«${key}» non comincia con ribbon.`).toBe(true);
      expect(shell[key], `«${key}» sta anche nel catalogo della shell`).toBeUndefined();
    }
  });

  it("risponde con `t`", () => {
    expect(t("ribbon.color.lighter", { name: "Colore 1", percent: 40 })).toBe("Colore 1, più chiaro 40%");
  });
});
