// Che cosa si apre dentro Fub: le estensioni di ogni editor che si può
// spegnere vengono dalla stessa tabella che decide «solo come file».
import { describe, expect, it } from "vitest";
import { editorFiles, uisForFile, UI_CANVAS, UI_GRID, UI_MEDIA, UI_RICH, UI_TEXT } from "./component-surfaces";

describe("gli editor e i loro file", () => {
  it("le note per prime, poi un editor per riga con le sue estensioni", () => {
    expect(editorFiles()).toEqual([
      { ui: UI_TEXT, extensions: ["md"] },
      { ui: UI_CANVAS, extensions: ["canvas"] },
      { ui: UI_MEDIA, extensions: ["pdf"] },
      { ui: UI_RICH, extensions: ["docx", "odt", "rtf", "doc", "dot"] },
      { ui: UI_GRID, extensions: ["xlsx", "xlsm", "xltx", "xltm"] },
    ]);
  });

  it("ogni estensione di una riga è un file che chiede proprio quell'editor", () => {
    for (const { ui, extensions } of editorFiles()) {
      if (ui === UI_TEXT) continue;
      for (const extension of extensions) expect(uisForFile(`a/file.${extension}`)).toEqual([ui]);
    }
    // Le annotazioni di un PDF chiedono due pezzi: non fanno riga.
    expect(editorFiles().some((row) => row.extensions.includes("fubann"))).toBe(false);
    expect(uisForFile("a/file.md")).toEqual([]);
  });
});
