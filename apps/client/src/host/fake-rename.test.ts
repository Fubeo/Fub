// `note.rename` dell'host finto: come il comando vero, la rinomina si porta
// dietro i wikilink che nominavano la nota. Serve al giro sul banco
// (`bench/giro/scrivere.mjs`), che rinomina una nota dall'albero e guarda il
// testo delle altre.
import { describe, expect, it } from "vitest";
import { createFakeHost } from "./fake";

const FILE = {
  "Guida/Ricette.md": "# Ricette\n\nVedi [[Pane]].",
  "Cucina/Pane.md": "# Pane\n\nQui: [[Pane#Impasto]].",
  "Diario.md": [
    "[[Pane]], [[Pane|il pane]], [[Pane#Forno|cuocere]], ![[Pane]],",
    "[[Pane.md]], [[Cucina/Pane]], [[Cucina/Pane.md#Forno]],",
    "[[Panettone]], [[Altro/Pane]], [[#Pane]], `[testo](Cucina/Pane.md)`.",
  ].join("\n"),
  "Senza.md": "Niente link qui.",
};

describe("note.rename nell'host finto", () => {
  it("riscrive i wikilink che nominavano la nota, nella forma in cui erano", async () => {
    const host = createFakeHost({ file: FILE });
    const { api } = host.module;
    await api.invokeCommand("note.rename", { doc: "Cucina/Pane.md", to: "Cucina/Pagnotta.md" }, "apply");

    expect((await api.readDocument("Diario.md")).text).toBe([
      "[[Pagnotta]], [[Pagnotta|il pane]], [[Pagnotta#Forno|cuocere]], ![[Pagnotta]],",
      "[[Pagnotta.md]], [[Cucina/Pagnotta]], [[Cucina/Pagnotta.md#Forno]],",
      // Un altro nome, una pagina che non c'è, un titolo della nota stessa e
      // un link Markdown restano com'erano.
      "[[Panettone]], [[Altro/Pane]], [[#Pane]], `[testo](Cucina/Pane.md)`.",
    ].join("\n"));
    expect((await api.readDocument("Guida/Ricette.md")).text).toBe("# Ricette\n\nVedi [[Pagnotta]].");
    // La nota stessa si porta dietro il suo link a sé.
    expect((await api.readDocument("Cucina/Pagnotta.md")).text).toBe("# Pane\n\nQui: [[Pagnotta#Impasto]].");
    await expect(api.readDocument("Cucina/Pane.md")).rejects.toThrow();
  });

  it("le note riscritte cambiano revisione e lo dicono; le altre no", async () => {
    const host = createFakeHost({ file: FILE });
    const { api } = host.module;
    const before = await api.readDocument("Senza.md");
    const diario = await api.readDocument("Diario.md");
    const events: unknown[] = [];
    await host.module.onKernelEvent((notice) => events.push(notice.event));

    await api.invokeCommand("note.rename", { doc: "Cucina/Pane.md", to: "Cucina/Pagnotta.md" }, "apply");

    expect(events).toEqual([
      { type: "document_renamed", from: "Cucina/Pane.md", to: "Cucina/Pagnotta.md" },
      { type: "document_changed", id: "Guida/Ricette.md" },
      { type: "document_changed", id: "Diario.md" },
    ]);
    expect((await api.readDocument("Diario.md")).revision).not.toBe(diario.revision);
    expect(await api.readDocument("Senza.md")).toEqual(before);
  });
});
