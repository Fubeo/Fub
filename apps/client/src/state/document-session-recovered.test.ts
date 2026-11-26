// Le bozze recuperate all'avvio per documenti che nessuna scheda ha aperto: la
// sessione nasce dalla bozza, non da una lettura, e prima del primo
// salvataggio deve sapere che file è (#514). Un giornale di celle salvato
// senza saperlo restava nel buffer e la griglia lo riapplicava sui byte che lo
// contenevano già; un file senza formato andava alla porta dei documenti, che
// lo rifiuta sempre.
import { describe, expect, it, vi } from "vitest";

import { DocumentSessionCollection, type DocumentSessionApi } from "./document-session";
import type { DocumentSource, DraftInfo, PluginError } from "../host/contract";
import { gridJournalText, recordGridJournal } from "./grid-journal";

type Kind = "markdown" | "xlsx" | "formatless";

function sourceOf(kind: Kind, revision: string): DocumentSource {
  switch (kind) {
    case "markdown":
      return { text: "disco\n", revision, format_id: "markdown", source_kind: "text", text_kind: "source" };
    case "xlsx":
      return { text: "", revision, format_id: "xlsx", source_kind: "bytes", text_kind: "grid_journal" };
    case "formatless":
      return { text: "disco\n", revision, format_id: null, source_kind: "text", text_kind: "source" };
  }
}

/**
 * Un disco finto che si comporta come il kernel: un file senza formato non
 * passa da `writeDocument` (`no_provider`), un giornale di celle si applica ai
 * byte e cambia la revisione. `applied` conta i giornali applicati.
 */
function port(files: Map<string, Kind>, options: { failRead?: Set<string> } = {}) {
  const revisions = new Map<string, string>([...files.keys()].map((id) => [id, `rev-${id}`]));
  const applied: string[] = [];
  const read = vi.fn(async (id: string): Promise<DocumentSource> => {
    if (options.failRead?.has(id)) throw { kind: "io", message: "lettura fallita" } satisfies PluginError;
    const kind = files.get(id);
    if (!kind) throw { kind: "not_found", message: `«${id}» non c'è` } satisfies PluginError;
    return sourceOf(kind, revisions.get(id)!);
  });
  const api: DocumentSessionApi = {
    readDocument: read,
    openDocument: vi.fn((id: string) => read(id)),
    writeDocument: vi.fn(async (id: string, text: string) => {
      const kind = files.get(id) ?? "markdown";
      if (kind === "formatless") throw { kind: "unserved", message: "nessun formato serve il file" } satisfies PluginError;
      if (kind === "xlsx" && text !== "") applied.push(text);
      const next = `rev-${id}-${applied.length}-${text.length}`;
      revisions.set(id, next);
      files.set(id, kind);
      return next;
    }),
    resourceWrite: vi.fn(async (id: string) => {
      const next = `rev-byte-${id}`;
      revisions.set(id, next);
      return { revision: next };
    }),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
    documentClosed: vi.fn(async () => {}),
  };
  return { api, applied };
}

const draft = (doc: string, text: string, exists = true): DraftInfo => ({
  doc,
  at: 1,
  base: exists ? `rev-${doc}` : null,
  exists,
  current: exists ? `rev-${doc}` : null,
  text,
});

/** Il recupero dell'avvio, come lo fa `recoverDrafts`. */
async function recover(sessions: DocumentSessionCollection, drafts: DraftInfo[]): Promise<void> {
  const rejoined = sessions.rejoin(await sessions.withoutSuperseded(drafts));
  for (const found of rejoined) await sessions.flush(found.doc);
}

const JOURNAL = gridJournalText(
  recordGridJournal({ entries: [], commands: [] }, { sheet: "s1", row: "r0", column: "c0" }, "1", "2"),
);

describe("bozze recuperate senza una scheda aperta (#514)", () => {
  it("il giornale di una cartella si applica una volta sola: dopo il salvataggio il buffer è vuoto", async () => {
    const { api, applied } = port(new Map([["conti.xlsx", "xlsx"]]));
    const sessions = new DocumentSessionCollection(api);

    await recover(sessions, [draft("conti.xlsx", JOURNAL)]);

    expect(applied).toEqual([JOURNAL]);
    expect(sessions.inspect("conti.xlsx")).toMatchObject({ text: "", dirty: false });
    // La scheda che si apre dopo riceve il giornale vuoto sui byte nuovi: la
    // griglia non ha niente da riapplicare.
    const surface = await sessions.readForSurface("conti.xlsx");
    expect(surface.text).toBe("");
    expect(surface.revision).toBe(sessions.inspect("conti.xlsx")?.base.kind === "descends_from"
      ? (sessions.inspect("conti.xlsx")!.base as { value: string }).value
      : "?");
    expect(api.discardDraft).toHaveBeenCalledWith("conti.xlsx");
  });

  it("un file senza formato si salva a byte, non dalla porta dei documenti", async () => {
    const { api } = port(new Map([["appunti.txt", "formatless"]]));
    const sessions = new DocumentSessionCollection(api);

    await recover(sessions, [draft("appunti.txt", "testo recuperato\n")]);

    expect(api.writeDocument).not.toHaveBeenCalled();
    expect(api.resourceWrite).toHaveBeenCalledWith(
      "appunti.txt",
      new TextEncoder().encode("testo recuperato\n"),
      "rev-appunti.txt",
    );
    expect(sessions.inspect("appunti.txt")).toMatchObject({ dirty: false, result: "ok" });
  });

  it("la descrizione letta per scartare le bozze superate non si rilegge", async () => {
    const { api } = port(new Map([["appunti.txt", "formatless"]]));
    const sessions = new DocumentSessionCollection(api);

    await recover(sessions, [draft("appunti.txt", "testo recuperato\n")]);

    expect(api.readDocument).toHaveBeenCalledTimes(1);
    expect(api.openDocument).not.toHaveBeenCalled();
  });

  it("se il file non si lascia descrivere la bozza resta bozza: niente scrittura alla cieca", async () => {
    const { api, applied } = port(new Map([["conti.xlsx", "xlsx"]]), { failRead: new Set(["conti.xlsx"]) });
    const sessions = new DocumentSessionCollection(api);

    await recover(sessions, [draft("conti.xlsx", JOURNAL)]);

    expect(api.writeDocument).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
    expect(sessions.inspect("conti.xlsx")).toMatchObject({ text: JOURNAL, dirty: true, result: "fallito" });
    expect(api.discardDraft).not.toHaveBeenCalled();
    expect(api.saveDraft).toHaveBeenCalledWith("conti.xlsx", JOURNAL, "rev-conti.xlsx");
  });

  it("una nota che non c'è più si ricrea dalla bozza, come prima", async () => {
    const { api } = port(new Map());
    const sessions = new DocumentSessionCollection(api);

    await recover(sessions, [draft("sparita.md", "testo di una nota tolta\n", false)]);

    expect(api.writeDocument).toHaveBeenCalledWith(
      "sparita.md",
      "testo di una nota tolta\n",
      { kind: "dictated" },
      null,
      expect.any(String),
    );
    expect(sessions.inspect("sparita.md")).toMatchObject({ dirty: false, result: "ok" });
  });
});
