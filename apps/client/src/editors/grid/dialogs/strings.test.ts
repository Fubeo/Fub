// Il presidio del catalogo delle finestre, come quello della barra
// (`ribbon/strings.test.ts`): gli stessi nomi fra graffe in ogni lingua,
// nessuna voce vuota, chiavi che la shell non ha.
import { describe, expect, it } from "vitest";
import { catalogFor as shellCatalogFor } from "../../../i18n/strings";
import { dialogStrings, t } from "./strings";

const IT = dialogStrings.catalogFor("it");
const EN = dialogStrings.catalogFor("en");

function templateArguments(template: string): string[] {
  return [...template.matchAll(/\{\{|\}\}|\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe("il catalogo delle finestre", () => {
  it("ha un inglese suo", () => {
    expect(EN).not.toBe(IT);
    expect(IT["grid.dialog.format.title"]).toBe("Formato celle");
    expect(EN["grid.dialog.format.title"]).toBe("Format Cells");
  });

  it("ha le stesse chiavi in ogni lingua", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(IT).sort());
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
      expect(key.startsWith("grid.dialog."), `«${key}» non comincia con grid.dialog.`).toBe(true);
      expect(shell[key], `«${key}» sta anche nel catalogo della shell`).toBeUndefined();
    }
  });

  it("risponde con `t`", () => {
    expect(t("grid.dialog.column", { column: "B" })).toBe("Colonna B");
  });
});
