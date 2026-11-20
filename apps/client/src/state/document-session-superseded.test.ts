// Le bozze col testo del file sul disco (IMP-1801): dopo una chiusura veloce
// con un salvataggio in volo, il file ha già il testo nuovo ma la bozza porta
// la revisione di prima. Non è un conflitto: la bozza si toglie. Una bozza
// diversa dal disco resta, senza eccezioni.
import { describe, expect, it, vi } from "vitest";

import { DocumentSessionCollection, type DocumentSessionApi } from "./document-session";
import type { DocumentSource } from "../host/contract";

function port(disk: Map<string, string>, failRead = new Set<string>()): DocumentSessionApi {
  const api: DocumentSessionApi = {
    readDocument: vi.fn(async (id: string): Promise<DocumentSource> => {
      if (failRead.has(id)) throw new Error("lettura fallita");
      return { text: disk.get(id) ?? "", revision: `rev-${id}`, format_id: "markdown", source_kind: "text", text_kind: "source" };
    }),
    openDocument: vi.fn((id: string, _open: string, ...vault: [string?]) => api.readDocument(id, ...vault)),
    writeDocument: vi.fn(async () => "rev-2"),
    resourceWrite: vi.fn(async () => ({ revision: "rev-byte" })),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
    documentClosed: vi.fn(async () => {}),
  };
  return api;
}

const draft = (doc: string, text: string, exists = true) => ({
  doc,
  at: 1,
  base: "rev-vecchia",
  exists,
  current: `rev-${doc}`,
  text,
});

describe("bozze col testo del disco (IMP-1801)", () => {
  it("la bozza uguale al file si toglie e non rientra; quella diversa resta intatta", async () => {
    const disk = new Map([
      ["uguale.md", "testo salvato\n"],
      ["diversa.md", "testo sul disco\n"],
    ]);
    const api = port(disk);
    const sessions = new DocumentSessionCollection(api);

    const kept = await sessions.withoutSuperseded([
      draft("uguale.md", "testo salvato\n"),
      draft("diversa.md", "testo mio, non salvato\n"),
    ]);

    expect(kept.map((d) => d.doc)).toEqual(["diversa.md"]);
    expect(api.discardDraft).toHaveBeenCalledTimes(1);
    expect(api.discardDraft).toHaveBeenCalledWith("uguale.md");
    expect(sessions.rejoin(kept).map((d) => d.doc)).toEqual(["diversa.md"]);
    expect(sessions.inspect("uguale.md")).toBeUndefined();
    expect(sessions.inspect("diversa.md")).toMatchObject({ text: "testo mio, non salvato\n", dirty: true });
  });

  it("una lettura che fallisce, una nota sparita o una sessione già aperta tengono la bozza", async () => {
    const api = port(new Map([["aperta.md", "x\n"], ["illeggibile.md", "y\n"]]), new Set(["illeggibile.md"]));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("aperta.md");
    const drafts = [draft("aperta.md", "x\n"), draft("illeggibile.md", "y\n"), draft("sparita.md", "", false)];

    expect(await sessions.withoutSuperseded(drafts)).toEqual(drafts);
    expect(api.discardDraft).not.toHaveBeenCalled();
  });

  it("uno spazio o un a capo di differenza basta a tenerla", async () => {
    const api = port(new Map([["nota.md", "riga\n"]]));
    const sessions = new DocumentSessionCollection(api);
    expect(await sessions.withoutSuperseded([draft("nota.md", "riga")])).toHaveLength(1);
    expect(api.discardDraft).not.toHaveBeenCalled();
  });

  it("uno scarto che non riesce non fa rientrare la bozza uguale al disco", async () => {
    const api = port(new Map([["uguale.md", "t\n"]]));
    vi.mocked(api.discardDraft).mockRejectedValueOnce(new Error("disco pieno"));
    const sessions = new DocumentSessionCollection(api);
    expect(await sessions.withoutSuperseded([draft("uguale.md", "t\n")])).toEqual([]);
  });
});
