// I suggerimenti dei campi documento della palette (#237 R06): una nota fuori
// dalla finestra dei primi documenti si trova scrivendone il nome, e il vault
// non attraversa mai il ponte per intero.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../host/contract";
import { api } from "../host/ipc";

// Il resto dell'host della palette (salvare, i comandi della superficie) vive
// con la shell montata: qui conta soltanto la domanda dei suggerimenti.
vi.mock("./document-controller", () => ({ focusedSurfaceCommands: () => [] }));
vi.mock("./document-session", () => ({ flushPendingSave: async () => [] }));
vi.mock("../ui/intents", () => ({ applyIntent: () => undefined }));

import { DOCUMENT_WINDOW, paletteHost } from "./palette-host";

/// Un vault da 5.000 note, che risponde come l'indice: le voci a finestre, i
/// documenti per nome.
const VAULT = Array.from({ length: 5000 }, (_, i) => `Archivio/nota-${String(i).padStart(4, "0")}.md`);

function answer(query: IndexQuery): IndexResult {
  if (query.kind === "entries") {
    const { offset, limit } = query.page ?? { offset: 0, limit: VAULT.length };
    return {
      kind: "entries",
      value: {
        items: VAULT.slice(offset, offset + limit)
          .map((id) => ({ id, kind: "document", size: 1, mtime: 0, content: null })),
        offset,
        total: VAULT.length,
      },
    } as never;
  }
  if (query.kind === "documents") {
    const predicate = query.matching.any[0]!.all[0]!.predicate;
    if (predicate.kind !== "text" || !predicate.fields.includes("name")) throw new Error("non è una domanda per nome");
    const found = VAULT.filter((doc) => doc.includes(predicate.text));
    const { offset, limit } = query.page ?? { offset: 0, limit: VAULT.length };
    return {
      kind: "documents",
      value: { items: found.slice(offset, offset + limit).map((doc) => ({ doc })), offset, total: found.length },
    } as never;
  }
  throw new Error(`domanda inattesa: ${query.kind}`);
}

afterEach(() => vi.restoreAllMocks());

describe("i documenti che la palette suggerisce", () => {
  it("una nota oltre la finestra si trova scrivendone il nome, senza chiedere il vault intero", async () => {
    const asked: IndexQuery[] = [];
    vi.spyOn(api, "queryIndex").mockImplementation(async (query: IndexQuery) => {
      asked.push(query);
      return answer(query);
    });

    const window = await paletteHost.listDocuments();
    expect(window).toHaveLength(DOCUMENT_WINDOW);
    expect(window).not.toContain("Archivio/nota-4999.md");

    expect(await paletteHost.listDocuments("nota-4999")).toEqual(["Archivio/nota-4999.md"]);

    // Ogni domanda ha la sua finestra, e nessuna supera quella dei suggerimenti.
    expect(asked.map((query) => query.kind)).toEqual(["entries", "documents"]);
    for (const query of asked) {
      const page = (query as { page?: { limit: number } | null }).page;
      expect(page?.limit).toBeLessThanOrEqual(DOCUMENT_WINDOW);
    }
  });

  it("del testo fatto di soli spazi è un campo vuoto: torna la finestra", async () => {
    vi.spyOn(api, "queryIndex").mockImplementation(async (query: IndexQuery) => answer(query));
    expect(await paletteHost.listDocuments("   ")).toHaveLength(DOCUMENT_WINDOW);
  });

  it("un vault che non risponde non suggerisce niente, e non rompe il campo", async () => {
    vi.spyOn(api, "queryIndex").mockRejectedValue(new Error("chiuso"));
    expect(await paletteHost.listDocuments("nota")).toEqual([]);
  });
});
