// `vault_health` dell'host finto: i soli collegamenti rotti, come li direbbe
// l'indice. Serve al banco e ai test della scrivania.
import { describe, expect, it } from "vitest";
import { createFakeHost } from "./fake";

describe("vault_health nell'host finto", () => {
  it("trova i wikilink senza nota e lascia stare quelli che puntano a una nota", async () => {
    const api = createFakeHost({
      file: { "Idee.md": "vedi [[Progetto]] e [[Assente|alias]]", "Progetto.md": "ok", "cartella/Altra.md": "[[Idee]] [[Nulla#titolo]]" },
    }).module.api;
    const result = await api.queryIndex({ kind: "vault_health", check: "broken_links" });
    expect(result.kind === "vault_health" && result.value.items.map((issue) => [issue.doc, issue.detail])).toEqual([
      ["cartella/Altra.md", "Nulla"],
      ["Idee.md", "Assente"],
    ]);
  });

  it("gli altri controlli non trovano niente", async () => {
    const api = createFakeHost({ file: { "a.md": "[[b]]" } }).module.api;
    const result = await api.queryIndex({ kind: "vault_health", check: "orphan_documents" });
    expect(result.kind === "vault_health" && result.value.items).toEqual([]);
  });
});
