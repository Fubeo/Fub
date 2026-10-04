// Il presidio del catalogo del disegno. La metà che il compilatore non vede,
// come per il catalogo della shell (`i18n/strings.test.ts`): gli stessi nomi
// fra graffe in ogni lingua, nessuna voce vuota. In più, le chiavi del
// disegno non sono anche della shell: una chiave in due cataloghi si
// tradurrebbe due volte, e una delle due copie sarebbe morta.
import { describe, expect, it } from "vitest";
import { catalogFor as shellCatalogFor } from "../../i18n/strings";
import { drawStrings, plural, t } from "./strings";

const IT = drawStrings.catalogFor("it");
const EN = drawStrings.catalogFor("en");

/// I nomi fra graffe di un modello, come in `i18n/strings.test.ts`.
function templateArguments(template: string): string[] {
  return [...template.matchAll(/\{\{|\}\}|\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe("il catalogo del disegno", () => {
  it("ha un inglese suo", () => {
    expect(EN).not.toBe(IT);
    expect(IT["draw.toolbar"]).toBe("Strumenti di disegno");
    expect(EN["draw.toolbar"]).toBe("Drawing tools");
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
      expect(key.startsWith("draw."), `«${key}» non comincia con draw.`).toBe(true);
      expect(shell[key], `«${key}» sta anche nel catalogo della shell`).toBeUndefined();
    }
  });

  it("risponde con `t` e `plural`", () => {
    expect(t("draw.grouped", { count: 3 })).toBe("Gruppo di 3 oggetti.");
    expect(plural(1, "draw.duplicated.one", "draw.duplicated.other")).not.toContain("{");
  });
});
