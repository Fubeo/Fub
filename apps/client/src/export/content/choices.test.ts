// Le scelte del Contenuto lette dal profilo (T74): un valore sconosciuto vale
// come quello di serie; link e tabelle sono variabili CSS, il resto entra
// nelle regolazioni che rifanno l'impaginazione.

import { describe, expect, it } from "vitest";
import { layoutChanged } from "../paginate/slices";
import { defaultProfile, printSettingsOf, type ExportProfile } from "../profile";
import { contentChoicesOf, contentLayoutOf } from "./choices";
import { contentLookVariables } from "./look";

function withContent(next: Partial<ExportProfile["contenuto"]>): ExportProfile {
  const base = defaultProfile();
  return { ...base, contenuto: { ...base.contenuto, ...next } };
}

describe("le scelte del Contenuto", () => {
  it("di serie: niente proprietà né commenti, link colorati, tabelle a linee", () => {
    expect(contentChoicesOf(defaultProfile().contenuto)).toEqual({
      properties: "nessuna",
      comments: "no",
      links: "colorati",
      doneTasks: true,
      folds: "aperti",
      cards: "anteprima",
      tables: "linee",
      codeNumbers: false,
    });
  });

  it("un valore che questa versione non conosce vale come quello di serie", () => {
    const choices = contentChoicesOf(withContent({ proprieta: "a-colori", commenti: "volanti", tabelle: "3d" }).contenuto);
    expect([choices.properties, choices.comments, choices.tables]).toEqual(["nessuna", "no", "linee"]);
  });

  it("«ripeti l'intestazione» delle Interruzioni sta con le scelte del contenuto", () => {
    const base = defaultProfile();
    expect(contentLayoutOf(base).repeatHeader).toBe(true);
    expect(contentLayoutOf({ ...base, interruzioni: { ...base.interruzioni, ripeti_intestazione: false } }).repeatHeader).toBe(false);
  });

  it("i commenti rifanno l'impaginazione, i link e le tabelle no", () => {
    const before = printSettingsOf(defaultProfile());
    expect(layoutChanged(before.layout, printSettingsOf(withContent({ commenti: "margine" })).layout)).toBe(true);
    expect(layoutChanged(before.layout, printSettingsOf(withContent({ compiti_fatti: false })).layout)).toBe(true);
    const links = printSettingsOf(withContent({ link: "sottolineati", tabelle: "griglia" }));
    expect(layoutChanged(before.layout, links.layout)).toBe(false);
    expect(links.look.colors["--print-link-line"]).toBe("underline");
    expect(links.look.colors["--print-table-vrule"]).toBe("var(--doc-rule-soft)");
  });
});

describe("link e tabelle sulle pagine", () => {
  it("link colorati, sottolineati, come il testo", () => {
    expect(contentLookVariables({ links: "colorati", tables: "linee" })).toMatchObject({ "--print-link-color": "var(--doc-link)", "--print-link-line": "none" });
    expect(contentLookVariables({ links: "sottolineati", tables: "linee" })).toMatchObject({ "--print-link-color": "var(--doc-link)", "--print-link-line": "underline" });
    expect(contentLookVariables({ links: "come-il-testo", tables: "linee" })).toMatchObject({ "--print-link-color": "currentColor", "--print-link-line": "none" });
  });

  it("tabelle a linee, a righe alterne, a griglia: cambiano i colori dei fili, non la loro larghezza", () => {
    const lines = contentLookVariables({ links: "colorati", tables: "linee" });
    expect(lines).toMatchObject({ "--print-table-vrule": "transparent", "--print-table-hrule": "var(--doc-rule-soft)", "--print-table-stripe": "transparent" });
    const stripes = contentLookVariables({ links: "colorati", tables: "righe-alterne" });
    expect(stripes["--print-table-hrule"]).toBe("transparent");
    expect(stripes["--print-table-stripe"]).toContain("--print-table-head");
    const grid = contentLookVariables({ links: "colorati", tables: "griglia" });
    expect(grid).toMatchObject({ "--print-table-vrule": "var(--doc-rule-soft)", "--print-table-frame": "var(--doc-rule)", "--print-table-hrule": "var(--doc-rule-soft)" });
  });
});
