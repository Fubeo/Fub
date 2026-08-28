import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DocumentSessionCollection,
  type DocumentSessionApi,
  type DocumentSurface,
  type DocumentSurfaceUpdate,
  type DocumentSessionEvent,
  type SurfaceEdit,
} from "./document-session";
import { operationFromText } from "../editor/text-operation";

function fakeApi(): DocumentSessionApi {
  return {
    readDocument: vi.fn(async (id) => ({ text: `${id}: disco`, revision: "rev-1" })),
    writeDocument: vi.fn(async () => "rev-2"),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
  };
}
function acceptText(
  sessions: DocumentSessionCollection,
  id: string,
  text: string,
  surface = "test-surface",
): void {
  const before = sessions.text(id);
  if (before === undefined) throw new Error(`sessione assente: ${id}`);
  expect(
    sessions.acceptSurfaceChange(id, surface, {
      text,
      operation: operationFromText(before, text),
    }),
  ).toEqual({ kind: "accepted" });
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
    acceptText(sessions, "nota.md", "testo nuovo");

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
    acceptText(sessions, "nota.md", "testo non salvato");

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
    expect(
      retained.acceptSurfaceChange(
        "test-surface",
        { text: "non deve rientrare", operation: operationFromText("testo non salvato", "non deve rientrare") },
      ),
    ).toEqual({ kind: "untracked" });
    expect(retained.text()).toBe("testo non salvato");
    expect(clearTimeout).toHaveBeenCalledTimes(2);
  });

  it("tiene la cancellazione in sospeso dentro la sessione corretta", async () => {
    const sessions = new DocumentSessionCollection(api);
    await Promise.all([sessions.read("a.md"), sessions.read("b.md")]);
    acceptText(sessions, "a.md", "a sporco");
    acceptText(sessions, "b.md", "b sporco");

    expect(sessions.beginDeletion("a.md")).toBe(true);
    expect(sessions.inspect("a.md")?.pendingDeletion).toBe(true);
    expect(sessions.inspect("a.md")?.suspended).toBe(true);
    expect(sessions.inspect("b.md")?.pendingDeletion).toBe(false);

    sessions.cancelDeletion("a.md");
    expect(sessions.inspect("a.md")?.pendingDeletion).toBe(false);
    expect(sessions.inspect("b.md")?.pendingDeletion).toBe(false);
  });
  it("rifiuta il secondo inizio e notifica inizio e annullamento", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("pulita.md");
    const events: DocumentSessionEvent[] = [];
    sessions.subscribe((event) => {
      events.push(event);
    });

    expect(sessions.beginDeletion("pulita.md")).toBe(true);
    expect(sessions.beginDeletion("pulita.md")).toBe(false);
    expect(sessions.inspect("pulita.md")).toMatchObject({
      dirty: false,
      pendingDeletion: true,
      suspended: true,
    });

    sessions.cancelDeletion("pulita.md");
    expect(sessions.inspect("pulita.md")?.pendingDeletion).toBe(false);
    expect(events.filter((event) => event.kind === "deletion-changed")).toEqual([
      { kind: "deletion-changed", id: "pulita.md", pending: true },
      { kind: "deletion-changed", id: "pulita.md", pending: false },
    ]);
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
    acceptText(sessions, "nota.md", "prima versione");
    await sessions.flush("nota.md");
    acceptText(sessions, "nota.md", "seconda versione");

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
    acceptText(sessions, "nota.md", "testo locale");
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
    acceptText(sessions, "nota.md", "modifica da scartare");

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
    acceptText(sessions, "nota.md", "testo locale");
    await sessions.flush("nota.md");
    expect(sessions.inspect("nota.md")?.result).toBe("conflitto");

    const outcome = await sessions.resolveConflict("nota.md", "theirs");

    expect(outcome.kind).toBe("discarded");
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: false, result: "ok" });
  });

  it("rinomina senza duplicare l'owner e rifiuta una destinazione occupata", async () => {
    const sessions = new DocumentSessionCollection(api);
    await Promise.all([sessions.read("a.md"), sessions.read("b.md")]);
    acceptText(sessions, "a.md", "a sporco");
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
    acceptText(sessions, "nota.md", "prima battuta");
    const retained = sessions.get("nota.md");
    if (!retained) throw new Error("sessione non costruita");

    const releasing = sessions.release("nota.md");
    await writeStarted;
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "battuta durante il rilascio");
    finishWrite("rev-2");

    expect(await releasing).toEqual({ kind: "active" });
    expect(sessions.get("nota.md")).toBe(retained);
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: true });
  });

  it("una apertura prenotata prima del flush tiene vivo lo stesso owner", async () => {
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
    acceptText(sessions, "nota.md", "prima battuta");
    const owner = sessions.get("nota.md");
    if (!owner) throw new Error("sessione non costruita");

    const releasing = sessions.release("nota.md");
    await writeStarted;
    const releaseIntent = sessions.retain("nota.md");
    finishWrite("rev-2");

    expect(await releasing).toEqual({ kind: "active" });
    expect(sessions.get("nota.md")).toBe(owner);

    releaseIntent();
    expect(await sessions.release("nota.md")).toEqual({
      kind: "closed",
      dirty: false,
    });
    releaseIntent();
    expect(sessions.get("nota.md")).toBeUndefined();
  });

  it("il rilascio attende la bozza già in fila senza accodarne una seconda", async () => {
    api.writeDocument = vi.fn(async () => {
      throw new Error("disco pieno");
    });
    let startDraft!: () => void;
    const draftStarted = new Promise<void>((resolve) => {
      startDraft = resolve;
    });
    let finishDraft!: () => void;
    const draftFinished = new Promise<void>((resolve) => {
      finishDraft = resolve;
    });
    api.saveDraft = vi.fn(async () => {
      startDraft();
      await draftFinished;
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo da proteggere");

    const releasing = sessions.release("nota.md");
    await draftStarted;
    expect(vi.mocked(api.saveDraft)).toHaveBeenCalledTimes(1);

    finishDraft();
    expect(await releasing).toEqual({ kind: "closed", dirty: true });
    expect(vi.mocked(api.saveDraft)).toHaveBeenCalledTimes(1);
  });

  it("ritenta una bozza fallita mentre l'owner resta vivo", async () => {
    let attempts = 0;
    api.saveDraft = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error("bozza non disponibile");
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo da ritentare");

    await sessions.flushDraft("nota.md");
    await sessions.flushDraft("nota.md");

    expect(vi.mocked(api.saveDraft)).toHaveBeenCalledTimes(2);
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

  it("il rilascio invalida una lettura lenta senza creare un owner orfano", async () => {
    let releaseRead!: (source: { text: string; revision: string }) => void;
    api.readDocument = vi.fn(
      () =>
        new Promise<{ text: string; revision: string }>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const sessions = new DocumentSessionCollection(api);
    const pending = sessions.read("lenta.md");

    expect(await sessions.release("lenta.md")).toEqual({ kind: "missing" });
    releaseRead({ text: "non deve diventare owner", revision: "rev-1" });

    expect(await pending).toBe("non deve diventare owner");
    expect(sessions.get("lenta.md")).toBeUndefined();
  });
  it("chiude anche un buffer sporco quando il documento sparisce fuori", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("sparita.md");
    acceptText(sessions, "sparita.md", "lavoro da non resuscitare");
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

  it("una rimozione esterna chiude prima che un salvataggio accodato possa partire", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("sparita.md");
    acceptText(sessions, "sparita.md", "non deve resuscitare");
    const owner = sessions.get("sparita.md");
    if (!owner) throw new Error("sessione non costruita");

    const pendingSave = sessions.flush("sparita.md");
    expect(sessions.handleExternalRemoval("sparita.md")).toEqual({
      kind: "removed",
      dirty: true,
    });

    await pendingSave;
    expect(vi.mocked(api.writeDocument)).not.toHaveBeenCalled();
    expect(owner.snapshot()).toMatchObject({
      lifecycle: "closed",
      text: "non deve resuscitare",
    });
    expect(sessions.get("sparita.md")).toBeUndefined();
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
    acceptText(sessions, "nota.md", "testo da eliminare");
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
    acceptText(sessions, "nota.md", "testo da conservare");
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

  it("un rilascio sospeso durante una cancellazione chiude l'owner riaperto se resta orfano", async () => {
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
    acceptText(sessions, "nota.md", "testo da conservare");
    const owner = sessions.get("nota.md");
    if (!owner) throw new Error("sessione non costruita");

    const deleting = sessions.delete("nota.md", async () => {
      startDelete();
      await deleteFinished;
    });
    await deleteStarted;
    const releasing = sessions.release("nota.md");
    rejectDelete(new Error("cancellazione rifiutata"));

    await expect(deleting).rejects.toThrow("cancellazione rifiutata");
    expect(await releasing).toEqual({ kind: "closed", dirty: false });
    expect(sessions.get("nota.md")).toBeUndefined();
    expect(owner.snapshot().lifecycle).toBe("closed");
  });

  it("sospende una scrittura già accodata prima del comando distruttivo", async () => {
    const timers: Array<() => void> = [];
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void) => {
        timers.push(callback);
        return ++nextTimer;
      }),
      clearTimeout: vi.fn(),
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "scrittura da annullare");
    timers[0]!();
    expect(sessions.beginDeletion("nota.md")).toBe(true);

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
    expect(vi.mocked(api.writeDocument)).not.toHaveBeenCalled();
    finishDelete();
    await deleting;
  });

  it("invalida timer e coda prima della cancellazione", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo da eliminare");
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
  it("consente la cancellazione di un documento non aperto", async () => {
    const sessions = new DocumentSessionCollection(api);
    let called = false;

    expect(
      await sessions.delete("mai-aperto.md", async () => {
        called = true;
      }),
    ).toEqual({ kind: "deleted", dirty: false });
    expect(called).toBe(true);
    expect(sessions.get("mai-aperto.md")).toBeUndefined();
  });
  it("non rilascia né chiude l'owner mentre la conferma è pendente", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("pendente.md");
    const owner = sessions.get("pendente.md");
    if (!owner) throw new Error("sessione non costruita");

    expect(sessions.beginDeletion("pendente.md")).toBe(true);
    expect(await sessions.release("pendente.md")).toEqual({ kind: "active" });
    expect(sessions.close("pendente.md")).toEqual({ kind: "active" });
    expect(sessions.get("pendente.md")).toBe(owner);
    expect(sessions.inspect("pendente.md")).toMatchObject({
      lifecycle: "open",
      pendingDeletion: true,
    });

    sessions.cancelDeletion("pendente.md");
    expect(sessions.close("pendente.md")).toEqual({ kind: "closed", dirty: false });
  });

  it("conserva l'owner pendente attraverso rinomina e annullamento", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("prima.md");
    const owner = sessions.get("prima.md");
    if (!owner) throw new Error("sessione non costruita");

    expect(sessions.beginDeletion("prima.md")).toBe(true);
    expect(sessions.rename("prima.md", "dopo.md")).toEqual({
      kind: "renamed",
      from: "prima.md",
      to: "dopo.md",
    });
    expect(sessions.isDeletionPending("prima.md")).toBe(true);
    expect(sessions.isDeletionPending("dopo.md")).toBe(true);

    sessions.cancelDeletion("prima.md");
    expect(sessions.get("dopo.md")).toBe(owner);
    expect(sessions.isDeletionPending("prima.md")).toBe(false);
    expect(sessions.isDeletionPending("dopo.md")).toBe(false);
  });

  it("un fallimento dopo la rinomina riapre lo stesso owner e usa il nuovo path", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("prima.md");
    acceptText(sessions, "prima.md", "testo da conservare");
    const owner = sessions.get("prima.md");
    if (!owner) throw new Error("sessione non costruita");

    sessions.beginDeletion("prima.md");
    sessions.rename("prima.md", "dopo.md");
    let calledWith = "";
    const deleting = sessions.delete("prima.md", async (id) => {
      calledWith = id;
      throw new Error("cancellazione rifiutata");
    });

    await expect(deleting).rejects.toThrow("cancellazione rifiutata");
    expect(calledWith).toBe("dopo.md");
    expect(sessions.get("dopo.md")).toBe(owner);
    expect(sessions.inspect("dopo.md")).toMatchObject({
      lifecycle: "open",
      pendingDeletion: false,
      dirty: true,
      text: "testo da conservare",
    });
    acceptText(sessions, "dopo.md", "testo dopo il rifiuto");
  });

  it("arma la persistenza prima di un observer changed che lancia", async () => {
    const timers: Array<() => void> = [];
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void) => {
        timers.push(callback);
        return ++nextTimer;
      }),
      clearTimeout: vi.fn(),
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("observer.md");
    api.writeDocument = vi.fn(async () => {
      throw new Error("scrittura rifiutata");
    });
    let throwOnce = true;
    sessions.subscribe((event) => {
      if (event.kind === "changed" && throwOnce) {
        throwOnce = false;
        throw new Error("observer guasto");
      }
    });

    const before = sessions.text("observer.md");
    if (before === undefined) throw new Error("sessione non costruita");
    expect(() =>
      sessions.acceptSurfaceChange("observer.md", "test-surface", {
        text: "testo osservato",
        operation: operationFromText(before, "testo osservato"),
      }),
    ).toThrow("observer guasto");
    expect(sessions.inspect("observer.md")).toMatchObject({ dirty: true, text: "testo osservato" });
    expect(timers).toHaveLength(2);

    timers[0]!();
    timers[1]!();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(vi.mocked(api.writeDocument)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveDraft)).toHaveBeenCalledTimes(1);
  });
});


describe("le superfici sottoscritte alla sessione", () => {
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

  /// Una superficie di prova che registra ciò che la sessione le manda.
  function recordingSurface(
    id: string,
    log: { surface: string; update: DocumentSurfaceUpdate }[],
  ): DocumentSurface {
    return {
      id,
      sync: (update) => log.push({ surface: id, update }),
    };
  }

  function editFor(before: string, after: string): SurfaceEdit {
    return { text: after, operation: operationFromText(before, after) };
  }

  it("diffonde l'operazione accettata ai pari, mai alla sorgente, una volta sola", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    sessions.attachSurface("nota.md", recordingSurface("riquadro-b", log));

    const before = "nota.md: disco";
    const outcome = sessions.acceptSurfaceChange(
      "nota.md",
      "riquadro-a",
      editFor(before, `${before} due`),
    );

    expect(outcome).toEqual({ kind: "accepted" });
    expect(sessions.inspect("nota.md")).toMatchObject({ text: `${before} due`, dirty: true });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ surface: "riquadro-b", update: { kind: "operation" } });
    // Salvataggio e bozza: i due ritardi sono della sessione, armati una volta.
    expect(nextTimer).toBe(2);
  });

  it("ristabilizza la sorgente su una preimmagine stantia senza mutare la sessione", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    sessions.attachSurface("nota.md", recordingSurface("riquadro-b", log));

    // Forma corretta, preimmagine stantia: al posto 13 la sessione ha «o»,
    // l'operazione dichiara di togliere «z» — un'altra superficie ha battuto
    // nel frattempo, o il disco è cambiato sotto.
    const stale: SurfaceEdit = {
      text: "nota.md: discX",
      operation: {
        beforeLength: "nota.md: disco".length,
        afterLength: "nota.md: discX".length,
        edits: [{ from: 13, to: 14, deleted: "z", inserted: "X" }],
      },
    };
    const outcome = sessions.acceptSurfaceChange("nota.md", "riquadro-a", stale);

    expect(outcome).toEqual({ kind: "realigned", text: "nota.md: disco" });
    expect(sessions.inspect("nota.md")).toMatchObject({ text: "nota.md: disco", dirty: false });
    expect(log).toHaveLength(0);
  });

  it("ristabilizza la sorgente anche se l'operazione regge ma il risultato non è quello dichiarato", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const authoritative = "nota.md: disco";
    // L'operazione, applicata al testo autorevole, produce «disc0»; la
    // sorgente dichiara di essere arrivata a «disc9»: il risultato non è
    // ciò che l'operazione costruisce, e la sessione non lo prende.
    const lies: SurfaceEdit = {
      text: "nota.md: disc9",
      operation: {
        beforeLength: authoritative.length,
        afterLength: "nota.md: disc0".length,
        edits: [{ from: 13, to: 14, deleted: "o", inserted: "0" }],
      },
    };

    const outcome = sessions.acceptSurfaceChange("nota.md", "riquadro-a", lies);

    expect(outcome).toEqual({ kind: "realigned", text: authoritative });
    expect(sessions.inspect("nota.md")?.text).toBe(authoritative);
    expect(nextTimer).toBe(0);
  });
  it("confronta preimmagine e atteso sulla stessa normalizzazione di terminatori", async () => {
    api.readDocument = vi.fn(async () => ({ text: "riga1\r\nriga2\n", revision: "rev-1" }));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));

    const outcome = sessions.acceptSurfaceChange(
      "nota.md",
      "riquadro-a",
      editFor("riga1\nriga2\n", "riga1\nriga2\nX"),
    );

    expect(outcome).toEqual({ kind: "accepted" });
    expect(sessions.inspect("nota.md")?.text).toBe("riga1\nriga2\nX");
  });

  it("attacca due volte la stessa identità una volta sola, e il disposer è indempiente", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    const disposeFirst = sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    const disposeSecond = sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));

    sessions.acceptSurfaceChange("nota.md", "riquadro-b", editFor("nota.md: disco", "uno"));
    // La rimontata con la stessa identità rimpiazza: una registrazione, una
    // diffusione — non due superfici che ricevono la stessa cosa due volte.
    expect(log).toHaveLength(1);

    disposeFirst();
    sessions.acceptSurfaceChange("nota.md", "riquadro-b", editFor("uno", "due"));
    expect(log).toHaveLength(2);

    disposeSecond();
    disposeSecond();
    sessions.acceptSurfaceChange("nota.md", "riquadro-b", editFor("due", "tre"));
    expect(log).toHaveLength(2);
  });

  it("la rinomina tiene le superfici sullo stesso owner e il disposer segue la nuova chiave", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("a.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    const dispose = sessions.attachSurface("a.md", recordingSurface("riquadro-a", log));
    const owner = sessions.get("a.md");

    sessions.rename("a.md", "c.md");

    expect(sessions.get("c.md")).toBe(owner);
    const peer = recordingSurface("riquadro-b", log);
    sessions.attachSurface("c.md", peer);
    dispose();
    const outcome = sessions.acceptSurfaceChange(
      "c.md",
      "riquadro-b",
      editFor("a.md: disco", "spostato"),
    );
    expect(outcome).toEqual({ kind: "accepted" });
    expect(log).toHaveLength(0);
    expect(sessions.inspect("c.md")?.text).toBe("spostato");
  });

  it("la chiusura svuota le sottoscrizioni: nessuna superficie resta abbonata", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    const surface = recordingSurface("riquadro-a", log);
    sessions.attachSurface("nota.md", surface);
    const owner = sessions.get("nota.md");
    if (!owner) throw new Error("sessione non costruita");

    sessions.close("nota.md");

    // Attaccare a una sessione chiusa non mette niente in piedi...
    expect(owner.attachSurface(surface)()).toBeUndefined();
    // ...e portare una modifica a una sessione chiusa non tocca nessuno.
    const outcome = sessions.acceptSurfaceChange(
      "nota.md",
      "riquadro-a",
      editFor("nota.md: disco", "tarocco"),
    );
    expect(outcome).toEqual({ kind: "untracked" });
    expect(log).toHaveLength(0);
  });

  it("una cancellazione fallita riapre lo stesso owner con le superfici attaccate", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("a.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("a.md", recordingSurface("riquadro-a", log));
    const owner = sessions.get("a.md");

    const failing = sessions.delete("a.md", async () => {
      throw new Error("il disco rifiuta");
    });
    await expect(failing).rejects.toThrow("il disco rifiuta");

    // La chiusura era provvisoria: le superfici non sono state staccate, o
    // la seconda di due riquadri resterebbe orfana dopo un ripensamento.
    expect(sessions.get("a.md")).toBe(owner);
    const outcome = sessions.acceptSurfaceChange(
      "a.md",
      "riquadro-a",
      editFor("a.md: disco", "ancora vivo"),
    );
    expect(outcome).toEqual({ kind: "accepted" });
  });

  it("una cancellazione riuscita non lascia superfici sottoscritte", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("a.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("a.md", recordingSurface("riquadro-a", log));

    await sessions.delete("a.md", async () => {});

    expect(
      sessions.acceptSurfaceChange("a.md", "riquadro-a", editFor("a.md: disco", "fantasma")),
    ).toEqual({ kind: "untracked" });
    expect(sessions.attachSurface("a.md", recordingSurface("riquadro-a", log))()).toBeUndefined();
    expect(log).toHaveLength(0);
  });

  it("la sostituzione autorevole raggiunge ogni superficie una volta sola, in testo pieno", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    sessions.attachSurface("nota.md", recordingSurface("riquadro-b", log));

    api.readDocument = vi.fn(async () => ({ text: "testo nuovo dal disco", revision: "rev-2" }));
    const reloaded = await sessions.reloadIfClean("nota.md");
    expect(reloaded).toMatchObject({ kind: "reloaded", changed: true });
    expect(log.map((entry) => entry.surface).sort()).toEqual(["riquadro-a", "riquadro-b"]);
    expect(log.every((entry) => entry.update.kind === "text")).toBe(true);

    // Il disco non è cambiato davvero: nessuna superficie viene risincronizzata.
    log.length = 0;
    await sessions.reloadIfClean("nota.md");
    expect(log).toHaveLength(0);

    // La bozza rientrata è un'altra sostituzione autorevole: testo pieno a tutti.
    sessions.restore("nota.md", "testo della bozza", { kind: "descends_from", value: "rev-2" });
    expect(log.map((entry) => entry.surface).sort()).toEqual(["riquadro-a", "riquadro-b"]);
    expect(log[0]?.update).toEqual({ kind: "text", text: "testo della bozza" });
    expect(log[1]?.update).toEqual({ kind: "text", text: "testo della bozza" });
  });
});
