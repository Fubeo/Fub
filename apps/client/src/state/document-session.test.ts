import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DocumentSessionCollection,
  type DocumentSessionApi,
} from "./document-session";

function fakeApi(): DocumentSessionApi {
  return {
    readDocument: vi.fn(async (id) => ({ text: `${id}: disco`, revision: "rev-1" })),
    writeDocument: vi.fn(async () => "rev-2"),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
  };
}

describe("ownership delle DocumentSession", () => {
  let api: DocumentSessionApi;
  let nextTimer: number;
  let clearTimeout = vi.fn();

  beforeEach(() => {
    api = fakeApi();
    nextTimer = 0;
    clearTimeout = vi.fn();
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => ++nextTimer),
      clearTimeout,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("costruisce una sola sessione per documento e la riusa", async () => {
    const sessions = new DocumentSessionCollection(api);

    await sessions.read("nota.md");
    const first = sessions.get("nota.md");
    sessions.acceptEditorChange("nota.md", "testo nuovo");

    expect(first).toBeDefined();
    expect(sessions.get("nota.md")).toBe(first);
    expect(sessions.inspect("nota.md")).toMatchObject({
      id: "nota.md",
      text: "testo nuovo",
      dirty: true,
    });
  });

  it("non espone stato mutabile e chiude la sessione cancellando i timer", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "testo non salvato");

    const retained = sessions.get("nota.md");
    const snapshot = sessions.inspect("nota.md");
    expect(retained).toBeDefined();
    expect(snapshot?.lifecycle).toBe("open");
    expect(snapshot?.dirty).toBe(true);

    if (!snapshot || !retained) throw new Error("sessione non costruita");
    Object.assign(snapshot, { text: "manomesso" });
    expect(retained.text()).toBe("testo non salvato");

    sessions.close("nota.md");

    expect(sessions.get("nota.md")).toBeUndefined();
    expect(retained.snapshot().lifecycle).toBe("closed");
    retained.acceptEditorChange("non deve rientrare");
    expect(retained.text()).toBe("testo non salvato");
    expect(clearTimeout).toHaveBeenCalledTimes(2);
  });

  it("tiene la sospensione dentro la sessione corretta", async () => {
    const sessions = new DocumentSessionCollection(api);
    await Promise.all([sessions.read("a.md"), sessions.read("b.md")]);
    sessions.acceptEditorChange("a.md", "a sporco");
    sessions.acceptEditorChange("b.md", "b sporco");

    expect(sessions.beginDeletion("a.md")).toBe(true);
    expect(sessions.inspect("a.md")?.suspended).toBe(true);
    expect(sessions.inspect("b.md")?.suspended).toBe(false);

    sessions.cancelDeletion("a.md");
    expect(sessions.inspect("a.md")?.suspended).toBe(false);
    expect(sessions.inspect("b.md")?.suspended).toBe(false);
  });
});

describe("decisioni del ciclo di vita della sessione", () => {
  let api: DocumentSessionApi;
  let nextTimer = 0;

  beforeEach(() => {
    api = fakeApi();
    nextTimer = 0;
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => ++nextTimer),
      clearTimeout: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("consuma l'eco prima di qualunque ricarica", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "prima versione");
    await sessions.flush("nota.md");
    sessions.acceptEditorChange("nota.md", "seconda versione");

    const reads = vi.mocked(api.readDocument).mock.calls.length;
    const outcome = await sessions.handleExternalChange("nota.md", {
      actor: { kind: "user" },
      batch: null,
    });

    expect(outcome).toEqual({ kind: "echo" });
    expect(sessions.inspect("nota.md")?.echoes).toBe(0);
    expect(vi.mocked(api.readDocument).mock.calls).toHaveLength(reads);
  });

  it("lascia il buffer autorevole e restituisce un warning per un cambio sporco", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "testo locale");
    const reads = vi.mocked(api.readDocument).mock.calls.length;

    const outcome = await sessions.handleExternalChange("nota.md", {
      actor: { kind: "watcher" },
      batch: null,
    });

    expect(outcome).toEqual({ kind: "warning", cause: "altra_app" });
    expect(sessions.text("nota.md")).toBe("testo locale");
    expect(vi.mocked(api.readDocument).mock.calls).toHaveLength(reads);
  });

  it("aggiorna la sessione prima di restituire una ricarica pulita", async () => {
    const source = { text: "contenuto esterno", revision: "rev-2" };
    api.readDocument = vi
      .fn()
      .mockResolvedValueOnce({ text: "contenuto iniziale", revision: "rev-1" })
      .mockResolvedValueOnce(source);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");

    const outcome = await sessions.handleExternalChange("nota.md", {
      actor: { kind: "kernel" },
      batch: "batch-1",
    });

    expect(outcome).toEqual({ kind: "reloaded", text: source.text, changed: true });
    expect(sessions.inspect("nota.md")).toMatchObject({
      text: source.text,
      base: { kind: "descends_from", value: source.revision },
      dirty: false,
    });
  });

  it("la ricarica forzata pulisce e aggiorna il testo autorevole", async () => {
    const source = { text: "versione ripristinata", revision: "rev-3" };
    api.readDocument = vi.fn(async () => source);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "modifica da scartare");

    const outcome = await sessions.forceReload("nota.md");

    expect(outcome).toEqual({ kind: "reloaded", text: source.text, changed: true });
    expect(sessions.inspect("nota.md")).toMatchObject({
      text: source.text,
      dirty: false,
      result: "ok",
    });
  });

  it("sposta keep/discard nel proprietario autorevole", async () => {
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "testo locale");
    await sessions.flush("nota.md");
    expect(sessions.inspect("nota.md")?.result).toBe("conflitto");

    const outcome = await sessions.resolveConflict("nota.md", "theirs");

    expect(outcome.kind).toBe("discarded");
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: false, result: "ok" });
  });

  it("rinomina senza duplicare l'owner e rifiuta una destinazione occupata", async () => {
    const sessions = new DocumentSessionCollection(api);
    await Promise.all([sessions.read("a.md"), sessions.read("b.md")]);
    sessions.acceptEditorChange("a.md", "a sporco");
    const first = sessions.get("a.md");
    const renamed = sessions.rename("a.md", "c.md");

    expect(renamed).toEqual({ kind: "renamed", from: "a.md", to: "c.md" });
    expect(sessions.get("c.md")).toBe(first);
    expect(sessions.get("a.md")).toBeUndefined();
    expect(sessions.inspect("c.md")).toMatchObject({ dirty: true, suspended: false });
    expect(sessions.rename("a.md", "c.md")).toEqual({
      kind: "already-renamed",
      from: "a.md",
      to: "c.md",
    });

    expect(sessions.rename("c.md", "b.md")).toEqual({
      kind: "collision",
      from: "c.md",
      to: "b.md",
    });
    expect(sessions.get("c.md")).toBe(first);
    expect(sessions.get("b.md")).not.toBe(first);
  });

  it("non rilascia una sessione riusata mentre il flush è in volo", async () => {
    let startWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      startWrite = resolve;
    });
    let finishWrite!: (revision: string) => void;
    const writeFinished = new Promise<string>((resolve) => {
      finishWrite = resolve;
    });
    api.writeDocument = vi.fn(async () => {
      startWrite();
      return writeFinished;
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "prima battuta");
    const retained = sessions.get("nota.md");
    if (!retained) throw new Error("sessione non costruita");

    const releasing = sessions.release("nota.md");
    await writeStarted;
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "battuta durante il rilascio");
    finishWrite("rev-2");

    expect(await releasing).toEqual({ kind: "active" });
    expect(sessions.get("nota.md")).toBe(retained);
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: true });
  });

  it("chiude prima che una lettura lenta possa ricreare la sessione", async () => {
    let releaseRead!: (source: { text: string; revision: string }) => void;
    api.readDocument = vi.fn(
      () =>
        new Promise<{ text: string; revision: string }>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const sessions = new DocumentSessionCollection(api);
    const pending = sessions.read("lenta.md");
    expect(sessions.close("lenta.md")).toEqual({ kind: "missing" });
    releaseRead({ text: "non deve diventare owner", revision: "rev-1" });

    await pending;
    expect(sessions.get("lenta.md")).toBeUndefined();
  });
  it("chiude anche un buffer sporco quando il documento sparisce fuori", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("sparita.md");
    sessions.acceptEditorChange("sparita.md", "lavoro da non resuscitare");
    const retained = sessions.get("sparita.md");
    if (!retained) throw new Error("sessione non costruita");

    expect(sessions.handleExternalRemoval("sparita.md")).toEqual({
      kind: "removed",
      dirty: true,
    });
    expect(retained.snapshot().lifecycle).toBe("closed");
    expect(sessions.get("sparita.md")).toBeUndefined();
    await Promise.resolve();
    expect(vi.mocked(api.writeDocument).mock.calls).toHaveLength(0);
  });


  it("riserva l'identità durante la cancellazione e non ricrea il buffer", async () => {
    let startDelete!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      startDelete = resolve;
    });
    let finishDelete!: () => void;
    const deleteFinished = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const readDocument = vi.mocked(api.readDocument);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "testo da eliminare");
    sessions.beginDeletion("nota.md");

    const deleting = sessions.delete("nota.md", async () => {
      startDelete();
      await deleteFinished;
    });
    await deleteStarted;
    const pendingRead = sessions.read("nota.md");
    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(sessions.get("nota.md")).toBeUndefined();

    finishDelete();
    expect(await deleting).toEqual({ kind: "deleted", dirty: true });
    await expect(pendingRead).rejects.toThrow("deleted");
    expect(sessions.get("nota.md")).toBeUndefined();
    expect(vi.mocked(api.writeDocument)).not.toHaveBeenCalled();
  });

  it("rifiuta la lettura già in volo quando la cancellazione riesce", async () => {
    let releaseRead!: (source: { text: string; revision: string }) => void;
    api.readDocument = vi.fn(
      () =>
        new Promise<{ text: string; revision: string }>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const sessions = new DocumentSessionCollection(api);
    const pendingRead = sessions.read("nota.md");

    let startDelete!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      startDelete = resolve;
    });
    let finishDelete!: () => void;
    const deleteFinished = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const deleting = sessions.delete("nota.md", async () => {
      startDelete();
      await deleteFinished;
    });
    await deleteStarted;
    releaseRead({ text: "testo non più valido", revision: "rev-1" });
    finishDelete();

    expect(await deleting).toEqual({ kind: "deleted", dirty: false });
    await expect(pendingRead).rejects.toThrow("deleted");
    expect(sessions.get("nota.md")).toBeUndefined();
  });

  it("ripristina lo stesso owner se la cancellazione fallisce mentre si legge", async () => {
    let startDelete!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      startDelete = resolve;
    });
    let rejectDelete!: (error: Error) => void;
    const deleteFinished = new Promise<void>((_, reject) => {
      rejectDelete = reject;
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "testo da conservare");
    const retained = sessions.get("nota.md");
    if (!retained) throw new Error("sessione non costruita");

    const deleting = sessions.delete("nota.md", async () => {
      startDelete();
      await deleteFinished;
    });
    await deleteStarted;
    const pendingRead = sessions.read("nota.md");
    rejectDelete(new Error("cancellazione rifiutata"));

    await expect(deleting).rejects.toThrow("cancellazione rifiutata");
    await expect(pendingRead).resolves.toBe("testo da conservare");
    expect(sessions.get("nota.md")).toBe(retained);
    expect(sessions.inspect("nota.md")).toMatchObject({ lifecycle: "open", dirty: true });
  });

  it("invalida timer e coda prima della cancellazione", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    sessions.acceptEditorChange("nota.md", "testo da eliminare");
    const retained = sessions.get("nota.md");
    if (!retained) throw new Error("sessione non costruita");

    sessions.beginDeletion("nota.md");
    const deleted = sessions.delete("nota.md", async () => {});

    expect(retained.snapshot().lifecycle).toBe("closed");
    expect(sessions.get("nota.md")).toBeUndefined();
    await deleted;
    expect(vi.mocked(api.writeDocument).mock.calls).toHaveLength(0);
    expect(vi.mocked(api.discardDraft).mock.calls).toHaveLength(1);
  });
});
