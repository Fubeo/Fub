import { describe, expect, it } from "vitest";
import { FORMAT_ICON, formatKindOf, formatTagOf } from "./format-kind";
import { icon } from "./icons";

describe("la specie di un documento", () => {
  it("viene dall'estensione, in qualunque maiuscola, e un file sconosciuto non ne ha", () => {
    const cases: [string, string | null, string | null][] = [
      ["Documenti/Prova.docx", "word", "WORD"],
      ["Vecchio.DOC", "word", "WORD 97"],
      ["lettera.rtf", "word", "RTF"],
      ["Verbale.odt", "odt", "ODT"],
      ["conti/Bilancio.xlsx", "sheet", "EXCEL"],
      ["modello.xltm", "sheet", "EXCEL"],
      ["Lavagna.canvas", "drawing", null],
      ["schizzo.svg", "drawing", "SVG"],
      ["Note/Diario.md", "note", null],
      ["foto.png", null, null],
      ["senza-estensione", null, null],
      [".nascosto", null, null],
      ["Guida.pdf#page=2", null, null],
    ];
    for (const [id, kind, tag] of cases) {
      expect([id, formatKindOf(id), formatTagOf(id)]).toEqual([id, kind, tag]);
    }
  });

  it("ogni specie ha un'icona del set, e sono tutte diverse", () => {
    const names = Object.values(FORMAT_ICON);
    for (const name of names) expect(icon(name), name).not.toBe("");
    expect(new Set(names).size).toBe(names.length);
  });
});
