// «Apri con» un'app Craft e l'anteprima fatta dalla CLI nell'host finto: senza
// le opzioni le tre porte non sono servite, come in un'app vecchia che non ha
// i comandi; con le opzioni rispondono, e ogni chiamata resta nel registro,
// perché i test della shell provano che una via senza gesto non chiama mai
// `craftRender`.
import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/craft-preview.json";
import { readCraftPreview } from "./craft";
import { createFakeHost } from "./fake";

describe("le porte Craft dell'host finto", () => {
  it("senza opzioni rifiutano, e la chiamata resta nel registro", async () => {
    const host = createFakeHost({});
    const api = host.module.api;
    await expect(api.externalEditors(null)).rejects.toThrow(/externalEditors/);
    await expect(api.openWith("a.vectorcraft", "vectorcraft")).rejects.toThrow(/openWith/);
    await expect(api.craftRender("a.vectorcraft", "large")).rejects.toThrow(/craftRender/);
    expect(host.atGate("externalEditors").map((call) => call.args)).toEqual([[null]]);
    expect(host.atGate("openWith").map((call) => call.args)).toEqual([["a.vectorcraft", "vectorcraft", null]]);
    expect(host.atGate("craftRender").map((call) => call.args)).toEqual([["a.vectorcraft", "large"]]);
  });

  it("con le opzioni rispondono ciò che il banco dà, e contano le chiamate", async () => {
    const preview = readCraftPreview(fixture.samples[0]);
    expect(preview).not.toBeNull();
    const host = createFakeHost({
      externalEditors: (doc) => Promise.resolve(doc === null ? [] : [
        { id: "pdfcraft", name: "PdfCraft", opens: ["pdf"], installed: true, running: false },
      ]),
      openWith: (_path, editor, page) => Promise.resolve({ editor, how: page === null ? "new_process" : "in_running" }),
      craftRender: () => Promise.resolve({ ...preview!, queued: true }),
    });
    const api = host.module.api;
    expect(await api.externalEditors(null)).toEqual([]);
    expect((await api.externalEditors("a.pdf")).map((editor) => editor.id)).toEqual(["pdfcraft"]);
    expect(await api.openWith("a.pdf", "pdfcraft", 3)).toEqual({ editor: "pdfcraft", how: "in_running" });
    expect(await api.openWith("a.pdf", "pdfcraft")).toEqual({ editor: "pdfcraft", how: "new_process" });
    expect((await api.craftRender("a.vectorcraft", "small")).queued).toBe(true);
    await api.craftRender("a.vectorcraft", "large");
    expect(host.atGate("craftRender").map((call) => call.args)).toEqual([
      ["a.vectorcraft", "small"],
      ["a.vectorcraft", "large"],
    ]);
  });
});
