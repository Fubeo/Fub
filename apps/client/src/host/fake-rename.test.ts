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

// L'organizzazione (icone, appuntate, ordine, spazi) il finto la tiene come il
// kernel: la rinomina di una nota, quella da un'altra app e lo spostamento di
// una cartella la portano con sé. Un finto che la perde a ogni rinomina fa
// sparire l'appuntata dalla scrivania, e il banco mostrerebbe un difetto che
// l'host vero non ha.
describe("l'organizzazione nell'host finto", () => {
  const ORG = {
    icons: { "Cucina/Pane.md": "🍞" },
    pinned: ["Cucina/Pane.md", "Diario.md"],
    order: {},
    spaces: [],
  };

  async function organizationOf(api: ReturnType<typeof createFakeHost>["module"]["api"]) {
    const result = await api.queryIndex({ kind: "organization" });
    if (result.kind !== "organization") throw new Error(`risposta inattesa: ${result.kind}`);
    return result.value;
  }

  it("risponde quella del vault con cui è nato", async () => {
    const { module } = createFakeHost({ file: FILE, organization: ORG });
    expect(await organizationOf(module.api)).toEqual(ORG);
  });

  it("una nota appuntata e rinominata da Fub resta appuntata col nome nuovo, con la sua icona", async () => {
    const { module } = createFakeHost({ file: FILE, organization: ORG });
    await module.api.invokeCommand("note.rename", { doc: "Cucina/Pane.md", to: "Cucina/Pagnotta.md" }, "apply");

    const org = await organizationOf(module.api);
    expect(org.pinned).toEqual(["Cucina/Pagnotta.md", "Diario.md"]);
    expect(org.icons).toEqual({ "Cucina/Pagnotta.md": "🍞" });
  });

  it("una nota appuntata rinominata da un'altra app resta appuntata col nome nuovo", async () => {
    const host = createFakeHost({ file: FILE, organization: ORG });

    host.renameFromOutside("Diario.md", "Archivio/Diario.md");

    expect((await organizationOf(host.module.api)).pinned).toEqual(["Cucina/Pane.md", "Archivio/Diario.md"]);
  });

  it("spostare una cartella porta con sé le appuntate che stanno dentro", async () => {
    const { module } = createFakeHost({ file: FILE, organization: ORG });
    await module.api.invokeCommand("folder.rename", { folder: "Cucina", to: "Dispensa" }, "apply");

    expect((await organizationOf(module.api)).pinned).toEqual(["Dispensa/Pane.md", "Diario.md"]);
  });

  it("un'appuntata messa nel finto resta quando si rilegge l'organizzazione", async () => {
    const { module } = createFakeHost({ file: FILE, organization: ORG });
    await module.api.setPinned("Senza.md", true);

    expect((await organizationOf(module.api)).pinned).toEqual(["Cucina/Pane.md", "Diario.md", "Senza.md"]);
  });
});
