// Il presidio del catalogo dei comandi dei fogli, come quello della barra
// (`ribbon/strings.test.ts`): gli stessi nomi fra graffe in ogni lingua,
// nessuna voce vuota, chiavi che la shell non ha, niente gergo.
import { describe, expect, it } from "vitest";
import { gergoIn } from "../../../i18n/gergo";
import { catalogFor as shellCatalogFor } from "../../../i18n/strings";
import { CATALOG_COMMANDS } from "./commands";
import { fogliStrings, t } from "./strings";
import { COMMANDS_IT } from "./strings/commands";
import { FIELDS_IT } from "./strings/fields";
import { PALETTE_IT } from "./strings/palette";
import { RESULT_IT } from "./strings/result";

const IT = fogliStrings.catalogFor("it");
const EN = fogliStrings.catalogFor("en");

function templateArguments(template: string): string[] {
  return [...template.matchAll(/\{\{|\}\}|\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe("il catalogo dei comandi dei fogli", () => {
  it("ha un inglese suo", () => {
    expect(EN).not.toBe(IT);
    expect(IT["fogli.cmd.home.bold"]).toBe("Grassetto");
    expect(EN["fogli.cmd.home.bold"]).toBe("Bold");
  });

  it("ha le stesse chiavi e gli stessi argomenti in ogni lingua", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(IT).sort());
    for (const key of Object.keys(IT)) {
      expect(templateArguments(EN[key]!), `«${key}» chiede argomenti diversi in inglese`).toEqual(templateArguments(IT[key]!));
    }
  });

  it("non ha voci vuote, né chiavi che la shell ha già", () => {
    const shell = shellCatalogFor("it");
    for (const key of Object.keys(IT)) {
      expect(key.startsWith("fogli."), `«${key}» non comincia con fogli.`).toBe(true);
      expect(IT[key]!.trim(), `«${key}» è vuota in italiano`).not.toBe("");
      expect(EN[key]!.trim(), `«${key}» è vuota in inglese`).not.toBe("");
      expect(shell[key], `«${key}» sta anche nel catalogo della shell`).toBeUndefined();
    }
  });

  it("non ha chiavi che il catalogo dei comandi non usa", () => {
    const used = new Set(CATALOG_COMMANDS.flatMap((command) => [command.titolo, ...command.campi.map((field) => `fogli.campo.${field.nome}`)]));
    for (const key of Object.keys(IT)) {
      if (key.startsWith("fogli.cmd.") || key.startsWith("fogli.campo.")) expect(used.has(key), `«${key}» non serve`).toBe(true);
    }
  });

  it("parla la lingua di chi scrive", () => {
    for (const [key, text] of Object.entries(IT)) {
      expect(gergoIn(text).map((voce) => voce.parola.source), `«${key}»: ${text}`).toEqual([]);
      expect(/craft/i.test(text) || /craft/i.test(EN[key]!), `«${key}» nomina un altro programma`).toBe(false);
    }
  });

  it("non ripete una chiave in due aree di `strings/`", () => {
    // Nel letterale unico il compilatore rifiutava una chiave doppia; con le
    // aree ricomposte per spread l'ultima vincerebbe in silenzio.
    const areas = [PALETTE_IT, COMMANDS_IT, FIELDS_IT, RESULT_IT];
    const count = areas.reduce((sum, area) => sum + Object.keys(area).length, 0);
    expect(count).toBe(Object.keys(IT).length);
  });

  it("risponde con `t`", () => {
    expect(t("fogli.form.error.required", { label: "Colore" })).toBe("«Colore» non può restare vuoto.");
  });
});
