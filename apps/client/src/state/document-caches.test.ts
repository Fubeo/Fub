import { describe, expect, it } from "vitest";
import { invalidateDocumentCaches, registerDocumentCache, renameInDocumentCaches } from "./document-caches";

describe("le cache dei documenti", () => {
  it("avvertono chi è iscritto, e non più dopo che si è tolto", () => {
    const seen: string[] = [];
    const stop = registerDocumentCache({
      invalidate: (id) => seen.push(`invalida ${id}`),
      rename: (from, to) => seen.push(`rinomina ${from} ${to}`),
    });
    invalidateDocumentCaches("a.md");
    renameInDocumentCaches("a.md", "b.md");
    stop();
    invalidateDocumentCaches("c.md");
    expect(seen).toEqual(["invalida a.md", "rinomina a.md b.md"]);
  });
});
