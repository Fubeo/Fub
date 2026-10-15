// Il presidio del catalogo della galleria. La metà che il compilatore non vede,
// come per il catalogo della shell (`i18n/strings.test.ts`) e quello del
// disegno: gli stessi nomi fra graffe in ogni lingua, nessuna voce vuota, e
// chiavi che la shell e il disegno non hanno. In più, una riga per ogni modello
// che la galleria sa mostrare.
import { describe, expect, it } from "vitest";
import { catalogFor as shellCatalogFor } from "../../../i18n/strings";
import { drawStrings } from "../strings";
import { TEMPLATE_IDS } from "./content";
import { galleryStrings, t } from "./strings";

const IT = galleryStrings.catalogFor("it");
const EN = galleryStrings.catalogFor("en");

/// I nomi fra graffe di un modello, come in `i18n/strings.test.ts`.
function templateArguments(template: string): string[] {
  return [...template.matchAll(/\{\{|\}\}|\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe("il catalogo della galleria", () => {
  it("ha un inglese suo", () => {
    expect(EN).not.toBe(IT);
    expect(IT["draw.new.title"]).toBe("Nuovo disegno");
    expect(EN["draw.new.title"]).toBe("New drawing");
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
      expect(key.startsWith("draw.new."), `«${key}» non comincia con draw.new.`).toBe(true);
      expect(shell[key], `«${key}» sta anche nel catalogo della shell`).toBeUndefined();
      expect(draw[key], `«${key}» sta anche nel catalogo del disegno`).toBeUndefined();
    }
  });

  it("ha una riga per «Vuoto» e per ognuno dei modelli con un file", () => {
    for (const id of ["blank", ...TEMPLATE_IDS]) {
      expect(IT[`draw.new.note.${id}`], id).toBeDefined();
      expect(EN[`draw.new.note.${id}`], id).toBeDefined();
    }
  });

  it("risponde con `t`, anche con un nome fra graffe", () => {
    expect(t("draw.new.vault.in_folder", { folder: "Modelli" })).toContain("«Modelli»");
    expect(t("draw.new.create")).toBe("Crea");
  });
});
