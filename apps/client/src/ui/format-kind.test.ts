import { describe, expect, it } from "vitest";
import { FORMAT_ICON, RAW_EXTENSIONS, formatKindOf, formatTagOf, isRawPhoto } from "./format-kind";
import { icon } from "./icons";
// Il contratto di `fub.craft` si legge come testo, col `?raw` di Vite (vedi
// `editors/spatial/draw-settings-mirror.test.ts`).
import CONTRACT_RS from "../../../../crates/fub-format-craft/src/contract.rs?raw";

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
      ["Disegni/logo.vectorcraft", "drawing", "VECTORCRAFT"],
      ["Progetti/Sito.FIGCRAFT", "drawing", "FIGCRAFT"],
      ["Foto/ritocco.pcraft", "photo", "PHOTOCRAFT"],
      ["Foto/IMG_0001.CR3.xmp", "photo", "XMP"],
      ["Foto/IMG_0001.xmp", "photo", "XMP"],
      ["Note/Diario.md", "note", null],
      ["Foto/IMG.CR3", "photo", "CR3"],
      ["Foto/img.nef", "photo", "NEF"],
      ["scatto.Dng", "photo", "DNG"],
      ["foto.png", null, null],
      ["senza-estensione", null, null],
      [".nascosto", null, null],
      ["Guida.pdf#page=2", null, null],
    ];
    for (const [id, kind, tag] of cases) {
      expect([id, formatKindOf(id), formatTagOf(id)]).toEqual([id, kind, tag]);
    }
  });

  it("le foto RAW sono quelle del contratto di fub.craft, in qualunque maiuscola", () => {
    const found = /const RAW_EXTENSIONS: \[&str; \d+\] = \[([^\]]+)\];/.exec(CONTRACT_RS);
    expect(found, "RAW_EXTENSIONS in contract.rs").not.toBeNull();
    const rust = [...found![1]!.matchAll(/"([^"]+)"/g)].map((each) => each[1]);
    expect(RAW_EXTENSIONS).toEqual(rust);
    expect(isRawPhoto("IMG.CR3")).toBe(true);
    expect(isRawPhoto("Foto/img.nef")).toBe(true);
    expect(isRawPhoto("Foto/IMG_0001.CR3.xmp")).toBe(false);
    expect(isRawPhoto("foto.jpg")).toBe(false);
    expect(isRawPhoto("cr3")).toBe(false);
  });

  it("ogni specie ha un'icona del set, e sono tutte diverse", () => {
    const names = Object.values(FORMAT_ICON);
    for (const name of names) expect(icon(name), name).not.toBe("");
    expect(new Set(names).size).toBe(names.length);
  });
});
