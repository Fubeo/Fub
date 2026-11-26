import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentSessionCollection, type DocumentSessionApi, type DocumentSessionEvent } from "./document-session";
import { operationFromText } from "../editors/core/text-operation";
import type { DocumentSource } from "../host/contract";
import { acceptText, fakeApi } from "./document-session-test-support";

describe("ownership delle DocumentSession", () => {
  let api: DocumentSessionApi;
  let nextTimer: number;
  let clearTimeout = vi.fn();

  beforeEach(() => {
    api = fakeApi();
    nextTimer = 0;
    clearTimeout = vi.fn();
    vi.stubGlobal("setTimeout", vi.fn(() => ++nextTimer));
    vi.stubGlobal("clearTimeout", clearTimeout);
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

  it("porta il formato autorevole alla superficie senza sostituire una bozza", async () => {
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => ({
      text: "testo sul disco",
      revision: "rev-1",
      format_id: "plain",
      source_kind: "text", text_kind: "source",
    }));
    const sessions = new DocumentSessionCollection(api);
    sessions.restore("nota.txt", "bozza non salvata", { kind: "dictated" });

    await expect(sessions.readForSurface("nota.txt")).resolves.toEqual({
      text: "bozza non salvata",
      formatId: "plain",
      sourceKind: "text",
      revision: "rev-1",
    });
    expect(api.readDocument).toHaveBeenCalledTimes(1);
  });

  it("rende leggibile una bozza orfana con il fallback testuale", async () => {
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => {
      throw new Error("sorgente rimossa");
    });
    const sessions = new DocumentSessionCollection(api);
    sessions.restore("orfana.md", "unica copia", { kind: "dictated" });

    await expect(sessions.readForSurface("orfana.md")).resolves.toEqual({
      text: "unica copia",
      formatId: null,
      sourceKind: "text",
      revision: "",
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
    vi.stubGlobal("setTimeout", vi.fn(() => ++nextTimer));
    vi.stubGlobal("clearTimeout", vi.fn());
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
    const source = { text: "contenuto esterno", revision: "rev-2", format_id: "markdown", source_kind: "text", text_kind: "source" };
    api.readDocument = vi
      .fn()
      .mockResolvedValueOnce({ text: "contenuto iniziale", revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" })
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

  it("la scrittura annunciata da un comando ricarica in silenzio, una volta sola", async () => {
    let disk = "views: []\n";
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => ({ text: disk, revision: `rev-${disk.length}`, format_id: "base", source_kind: "text", text_kind: "source" }));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("Opere.base");
    const gesture = { actor: { kind: "user" }, batch: "batch-7" } as const;

    sessions.expectWrite("Opere.base");
    disk = "views:\n  - name: Tabella\n";
    expect(await sessions.handleExternalChange("Opere.base", gesture)).toEqual({ kind: "reloaded", text: disk, changed: true, quiet: true });
    expect(sessions.text("Opere.base")).toBe(disk);
    // L'annuncio è consumato: il cambio dopo si dice.
    disk = "views:\n  - name: Bacheca\n";
    expect(await sessions.handleExternalChange("Opere.base", gesture)).toEqual({ kind: "reloaded", text: disk, changed: true });
  });

  it("un annuncio ritirato, un'altra app o il kernel non zittiscono niente", async () => {
    let disk = "a\n";
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => ({ text: disk, revision: `rev-${disk}`, format_id: "base", source_kind: "text", text_kind: "source" }));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("Opere.base");

    const withdraw = sessions.expectWrite("Opere.base");
    withdraw();
    disk = "b\n";
    expect(await sessions.handleExternalChange("Opere.base", { actor: { kind: "user" }, batch: "batch-1" })).toEqual({ kind: "reloaded", text: disk, changed: true });

    sessions.expectWrite("Opere.base");
    disk = "c\n";
    expect(await sessions.handleExternalChange("Opere.base", { actor: { kind: "watcher" }, batch: null })).toEqual({ kind: "reloaded", text: disk, changed: true });
    disk = "d\n";
    expect(await sessions.handleExternalChange("Opere.base", { actor: { kind: "kernel" }, batch: "batch-2" })).toEqual({ kind: "reloaded", text: disk, changed: true });
    // L'annuncio di prima è ancora lì, per l'evento del suo comando.
    disk = "e\n";
    expect(await sessions.handleExternalChange("Opere.base", { actor: { kind: "user" }, batch: "batch-3" })).toMatchObject({ kind: "reloaded", quiet: true });
  });

  it("a buffer sporco la scrittura annunciata avvisa come sempre, e il testo locale resta", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("Opere.base");
    acceptText(sessions, "Opere.base", "testo locale");
    sessions.expectWrite("Opere.base");

    const outcome = await sessions.handleExternalChange("Opere.base", { actor: { kind: "user" }, batch: "batch-1" });

    expect(outcome).toEqual({ kind: "warning", cause: "riscrittura" });
    expect(sessions.text("Opere.base")).toBe("testo locale");
  });

  it("un annuncio scade: dopo dieci secondi il cambio si dice", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const sessions = new DocumentSessionCollection(api);
      await sessions.read("Opere.base");
      sessions.expectWrite("Opere.base");
      now.mockReturnValue(11_001);
      const outcome = await sessions.handleExternalChange("Opere.base", { actor: { kind: "user" }, batch: "batch-1" });
      expect(outcome).not.toHaveProperty("quiet");
    } finally { now.mockRestore(); }
  });

  // IMP-109: un'azione di view non sa se ha scritto; dopo la risposta accorcia
  // la scadenza invece di ritirare, perché l'evento può arrivare dopo.
  it("un ritiro con attesa zittisce l'evento che arriva entro l'attesa, non quello dopo", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      let disk = "a\n";
      api.readDocument = vi.fn(async (): Promise<DocumentSource> => ({ text: disk, revision: `rev-${disk}`, format_id: "markdown", source_kind: "text", text_kind: "source" }));
      const sessions = new DocumentSessionCollection(api);
      await sessions.read("index.md");
      const gesture = { actor: { kind: "user" }, batch: "batch-1" } as const;

      sessions.expectWrite("index.md")(1_500);
      now.mockReturnValue(2_400);
      disk = "b\n";
      expect(await sessions.handleExternalChange("index.md", gesture)).toMatchObject({ kind: "reloaded", quiet: true });

      sessions.expectWrite("index.md")(1_500);
      now.mockReturnValue(4_000);
      disk = "c\n";
      expect(await sessions.handleExternalChange("index.md", gesture)).toEqual({ kind: "reloaded", text: disk, changed: true });
    } finally { now.mockRestore(); }
  });

  it("la ricarica forzata mette in bozza il testo sporco, poi aggiorna il testo autorevole", async () => {
    const source: DocumentSource = { text: "versione ripristinata", revision: "rev-3", format_id: "markdown", source_kind: "text", text_kind: "source" };
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "modifica locale");
    api.readDocument = vi.fn(async () => source);

    const outcome = await sessions.forceReload("nota.md");

    // Il testo della persona non sparisce: è nella bozza, scritta prima di
    // leggere il disco, e il recupero lo ritrova.
    expect(api.saveDraft).toHaveBeenCalledWith("nota.md", "modifica locale", "rev-1");
    expect(vi.mocked(api.saveDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.readDocument).mock.invocationCallOrder[0]!,
    );
    expect(api.discardDraft).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "reloaded", text: source.text, changed: true });
    expect(sessions.inspect("nota.md")).toMatchObject({
      text: source.text,
      dirty: false,
      result: "ok",
    });
  });

  it("una ricarica forzata con la bozza fallita non legge il disco e lascia il testo", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "modifica locale");
    api.saveDraft = vi.fn(async () => {
      throw new Error("disco pieno");
    });
    const reads = vi.mocked(api.readDocument).mock.calls.length;

    const outcome = await sessions.forceReload("nota.md");

    expect(outcome).toEqual({ kind: "unavailable" });
    expect(api.saveDraft).toHaveBeenCalledWith("nota.md", "modifica locale", "rev-1");
    expect(vi.mocked(api.readDocument).mock.calls.length).toBe(reads);
    expect(sessions.inspect("nota.md")).toMatchObject({
      text: "modifica locale",
      dirty: true,
      result: "ok",
      saveState: "non_salvato",
    });
  });

  it("una ricarica forzata di un testo pulito non scrive bozze", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");

    const outcome = await sessions.forceReload("nota.md");

    expect(outcome).toEqual({ kind: "reloaded", text: "nota.md: disco", changed: false });
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("una ricarica forzata fallita lascia testo e stato com'erano", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "modifica locale");
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => {
      throw new Error("disco non leggibile");
    });

    const outcome = await sessions.forceReload("nota.md");

    expect(outcome).toEqual({ kind: "unavailable" });
    expect(sessions.inspect("nota.md")).toMatchObject({
      text: "modifica locale",
      dirty: true,
      result: "ok",
      saveState: "non_salvato",
    });
  });

  it("«usa disco» con la lettura fallita tiene aperti il conflitto e la bozza", async () => {
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo locale");
    await sessions.flush("nota.md");
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => {
      throw new Error("disco non leggibile");
    });

    const outcome = await sessions.resolveConflict("nota.md", "theirs");

    expect(outcome).toEqual({ kind: "discarded", reload: { kind: "unavailable" }, kept: false });
    expect(sessions.inspect("nota.md")).toMatchObject({
      text: "testo locale",
      dirty: true,
      result: "conflitto",
    });
    expect(api.discardDraft).not.toHaveBeenCalled();
  });

  it("«usa disco» col testo in salvo e la lettura fallita lo dice, e ripetuto non lo conserva due volte", async () => {
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo locale");
    await sessions.flush("nota.md");
    const read = api.readDocument;
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => {
      throw new Error("disco non leggibile");
    });
    const keep = vi.fn(async () => {});

    const first = await sessions.resolveConflict("nota.md", "theirs", keep);

    expect(first).toEqual({ kind: "discarded", reload: { kind: "unavailable" }, kept: true });
    expect(sessions.inspect("nota.md")).toMatchObject({ text: "testo locale", result: "conflitto" });

    api.readDocument = read;
    const second = await sessions.resolveConflict("nota.md", "theirs", keep);

    expect(second).toMatchObject({ kind: "discarded", reload: { kind: "reloaded" }, kept: true });
    expect(keep).toHaveBeenCalledTimes(1);
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: false, result: "ok" });
  });

  it("«usa disco» ripetuto dopo un tasto conserva il testo nuovo", async () => {
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo locale");
    await sessions.flush("nota.md");
    const read = api.readDocument;
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => {
      throw new Error("disco non leggibile");
    });
    const keep = vi.fn(async (_text: string) => {});
    await sessions.resolveConflict("nota.md", "theirs", keep);
    acceptText(sessions, "nota.md", "testo locale e altro");
    api.readDocument = read;

    await sessions.resolveConflict("nota.md", "theirs", keep);

    expect(keep.mock.calls.map(([text]) => text)).toEqual(["testo locale", "testo locale e altro"]);
  });

  it("«usa disco» scarta il mio testo solo dopo che è stato messo in salvo", async () => {
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo locale");
    await sessions.flush("nota.md");
    const order: string[] = [];
    const read = api.readDocument;
    api.readDocument = vi.fn(async (id: string) => {
      order.push("lettura");
      return read(id);
    });
    const keep = vi.fn(async (text: string) => {
      order.push(`conservato: ${text}`);
      // Mentre si conserva il testo è ancora lì, e il conflitto pure.
      expect(sessions.inspect("nota.md")).toMatchObject({ text: "testo locale", result: "conflitto" });
    });

    const outcome = await sessions.resolveConflict("nota.md", "theirs", keep);

    expect(outcome.kind).toBe("discarded");
    expect(order).toEqual(["conservato: testo locale", "lettura"]);
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: false, result: "ok" });
  });

  it("«usa disco» con la conservazione fallita non scarta niente", async () => {
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo locale");
    await sessions.flush("nota.md");
    const reads = vi.mocked(api.readDocument).mock.calls.length;
    const refused = { kind: "io", message: "spazio dati non scrivibile" };

    const outcome = await sessions.resolveConflict("nota.md", "theirs", async () => {
      throw refused;
    });

    expect(outcome).toEqual({ kind: "keep-failed", error: refused });
    expect(vi.mocked(api.readDocument).mock.calls.length).toBe(reads);
    expect(api.discardDraft).not.toHaveBeenCalled();
    expect(sessions.inspect("nota.md")).toMatchObject({
      text: "testo locale",
      dirty: true,
      result: "conflitto",
    });
  });

  it("un tasto premuto mentre si conserva il testo lascia aperto il conflitto", async () => {
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo locale");
    await sessions.flush("nota.md");

    const outcome = await sessions.resolveConflict("nota.md", "theirs", async () => {
      acceptText(sessions, "nota.md", "testo locale e altro");
    });

    expect(outcome).toEqual({ kind: "discarded", reload: { kind: "stale" }, kept: true });
    expect(sessions.inspect("nota.md")).toMatchObject({ text: "testo locale e altro", result: "conflitto" });
    expect(api.discardDraft).not.toHaveBeenCalled();
  });

  it("una bozza incerta rientra ferma: niente autosave, niente flush, finché non si sceglie", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");

    const rejoined = sessions.rejoin([
      { doc: "nota.md", at: 1, base: null, exists: true, current: "rev-1", text: "testo vecchio" },
    ]);

    expect(rejoined).toHaveLength(1);
    expect(sessions.inspect("nota.md")).toMatchObject({
      text: "testo vecchio",
      dirty: true,
      result: "conflitto",
    });
    expect(setTimeout).not.toHaveBeenCalled();
    await sessions.flushPendingSave();
    await sessions.flush("nota.md");
    expect(api.writeDocument).not.toHaveBeenCalled();

    // «Mantieni il mio» è la scelta esplicita che detta.
    await sessions.resolveConflict("nota.md", "mine");
    expect(api.writeDocument).toHaveBeenCalledWith("nota.md", "testo vecchio", { kind: "dictated" }, null, expect.any(String));
  });

  it("un ascoltatore asincrono che fallisce non fa fallire il salvataggio", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sessions = new DocumentSessionCollection(api);
    sessions.subscribe((event) =>
      event.kind === "saved" ? Promise.reject(new Error("ridisegno fallito")) : undefined,
    );
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo locale");

    await expect(sessions.flush("nota.md")).resolves.toBe(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: false, result: "ok" });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("saved"), expect.any(Error));
    error.mockRestore();
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
    // Il salvataggio è fallito: la sessione resta viva, e con lei il testo.
    expect(await releasing).toEqual({ kind: "unsaved" });
    expect(vi.mocked(api.saveDraft)).toHaveBeenCalledTimes(1);
    expect(sessions.inspect("nota.md")).toMatchObject({ lifecycle: "open", text: "testo da proteggere", dirty: true });
  });

  // IMP-135: un link messo su un .docx si sta ancora scrivendo quando arriva
  // «Remove link». La scrittura in volo che il formato rifiuta non lascia la
  // sessione «in corso»: dice l'errore, e la modifica arrivata intanto si
  // scrive dopo, sulla stessa coda, finché non è sul disco.
  it("una scrittura rifiutata con una modifica arrivata intanto dice l'errore, e la modifica si salva", async () => {
    let refuse!: (error: Error) => void;
    const writes: string[] = [];
    api.writeDocument = vi.fn((_id: string, text: string) => {
      writes.push(text);
      if (writes.length === 1) {
        return new Promise<string>((_resolve, reject) => {
          refuse = reject;
        });
      }
      return Promise.resolve("rev-3");
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.docx");
    acceptText(sessions, "nota.docx", "con il link");

    const first = sessions.flush("nota.docx");
    await vi.waitFor(() => expect(writes).toEqual(["con il link"]));
    expect(sessions.inspect("nota.docx")?.result).toBe("in_corso");
    acceptText(sessions, "nota.docx", "senza il link");
    const second = sessions.flush("nota.docx");

    refuse(Object.assign(new Error("non si rilegge uguale"), { kind: "internal" }));
    await first;
    await second;
    expect(writes).toEqual(["con il link", "senza il link"]);
    expect(sessions.inspect("nota.docx")).toMatchObject({ result: "ok", dirty: false, text: "senza il link" });
  });

  it("un buffer che non si salva si chiude solo scartandolo, con la sua bozza", async () => {
    api.writeDocument = vi.fn(async () => {
      throw new Error("permesso negato");
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "lavoro non salvato");

    expect(await sessions.release("nota.md")).toEqual({ kind: "unsaved" });
    expect(sessions.get("nota.md")).toBeDefined();

    expect(sessions.discardUnsaved("nota.md")).toEqual({ kind: "closed", dirty: true });
    expect(sessions.get("nota.md")).toBeUndefined();
    await vi.waitFor(() => expect(vi.mocked(api.discardDraft)).toHaveBeenCalledWith("nota.md"));
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
    let releaseRead!: (source: DocumentSource) => void;
    api.readDocument = vi.fn(
      () =>
        new Promise<DocumentSource>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const sessions = new DocumentSessionCollection(api);
    const pending = sessions.read("lenta.md");
    expect(sessions.close("lenta.md")).toEqual({ kind: "missing" });
    releaseRead({ text: "non deve diventare owner", revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" });

    await pending;
    expect(sessions.get("lenta.md")).toBeUndefined();
  });

  it("il rilascio invalida una lettura lenta senza creare un owner orfano", async () => {
    let releaseRead!: (source: DocumentSource) => void;
    api.readDocument = vi.fn(
      () =>
        new Promise<DocumentSource>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const sessions = new DocumentSessionCollection(api);
    const pending = sessions.read("lenta.md");

    expect(await sessions.release("lenta.md")).toEqual({ kind: "missing" });
    releaseRead({ text: "non deve diventare owner", revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" });

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
      text: "lavoro da non resuscitare",
    });
    expect(retained.snapshot().lifecycle).toBe("closed");
    expect(sessions.get("sparita.md")).toBeUndefined();
    await Promise.resolve();
    // Il file non si ricrea da solo, ma il lavoro resta in bozza.
    expect(vi.mocked(api.writeDocument).mock.calls).toHaveLength(0);
    // Con la sua base: al recupero è «orfana», non «nuova», e non risorge da sola.
    expect(vi.mocked(api.saveDraft)).toHaveBeenCalledWith("sparita.md", "lavoro da non resuscitare", expect.any(String));
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
      text: "non deve resuscitare",
    });

    await pendingSave;
    expect(vi.mocked(api.writeDocument)).not.toHaveBeenCalled();
    expect(owner.snapshot()).toMatchObject({
      lifecycle: "closed",
      text: "non deve resuscitare",
    });
    expect(sessions.get("sparita.md")).toBeUndefined();
  });

  it("ricreata la nota, la bozza della rimozione si scarta dopo la sua scrittura (IMP-047)", async () => {
    let finishDraft!: () => void;
    vi.mocked(api.saveDraft).mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDraft = resolve;
    }));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("sparita.md");
    acceptText(sessions, "sparita.md", "lavoro ricreato");
    sessions.handleExternalRemoval("sparita.md");

    const discarding = sessions.discardRemovedDraft("sparita.md", undefined, "lavoro ricreato");
    await Promise.resolve();
    expect(vi.mocked(api.discardDraft)).not.toHaveBeenCalled();
    finishDraft();
    await discarding;
    expect(vi.mocked(api.discardDraft)).toHaveBeenCalledWith("sparita.md");
  });

  it("una sessione riaperta sull'id col suo testo non salvato tiene la sua bozza", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("sparita.md");
    acceptText(sessions, "sparita.md", "lavoro ricreato");
    sessions.handleExternalRemoval("sparita.md");
    await sessions.read("sparita.md");
    acceptText(sessions, "sparita.md", "lavoro ricreato e poi altro");

    await sessions.discardRemovedDraft("sparita.md", undefined, "lavoro ricreato");
    expect(vi.mocked(api.discardDraft)).not.toHaveBeenCalled();
  });

  describe("«Ricrea la nota» e la riapertura (IMP-047)", () => {
    // Le bozze sul disco del vault finto, e il file com'è adesso: la
    // riapertura le ritrova come il recupero all'avvio (`recoverDrafts`).
    let drafts: Map<string, { text: string; base: string | null }>;
    let disk: { text: string; revision: string };

    beforeEach(() => {
      drafts = new Map();
      disk = { text: "testo di prima", revision: "rev-cancellata" };
      vi.mocked(api.saveDraft).mockImplementation(async (id, text, base) => {
        drafts.set(id, { text, base });
      });
      vi.mocked(api.discardDraft).mockImplementation(async (id) => {
        drafts.delete(id);
      });
      api.readDocument = vi.fn(async (): Promise<DocumentSource> => ({ text: disk.text, revision: disk.revision, format_id: "markdown", source_kind: "text", text_kind: "source" }));
      vi.mocked(api.writeDocument).mockImplementation(async (_id, text, base) => {
        if (base.kind === "descends_from" && base.value !== disk.revision) {
          throw { kind: "conflict", message: "revisione superata" };
        }
        disk = { text, revision: `rev-${text.length}` };
        return disk.revision;
      });
    });

    /// Cancellata da fuori con «nuovo» non salvato: la bozza parte con la base
    /// del file cancellato. Torna il testo da ricreare.
    async function removeDirty(sessions: DocumentSessionCollection): Promise<string> {
      await sessions.read("sparita.md");
      acceptText(sessions, "sparita.md", "testo di prima e nuovo");
      const outcome = sessions.handleExternalRemoval("sparita.md");
      if (outcome.kind !== "removed" || outcome.text === undefined) throw new Error("nessun testo da ricreare");
      await Promise.resolve();
      expect(drafts.get("sparita.md")).toEqual({ text: "testo di prima e nuovo", base: "rev-cancellata" });
      return outcome.text;
    }

    /// Ciò che il recupero fa alla riapertura: le bozze rimaste rientrano, e
    /// la sessione prova a salvare. Torna l'esito di quel salvataggio.
    async function reopen(sessions: DocumentSessionCollection): Promise<string | undefined> {
      const found = [...drafts].map(([doc, draft]) => ({
        doc,
        at: 1,
        base: draft.base,
        exists: true,
        current: disk.revision,
        text: draft.text,
      }));
      for (const draft of sessions.rejoin(found)) await sessions.flush(draft.doc);
      return sessions.inspect("sparita.md")?.saveState ?? undefined;
    }

    it("col testo della bozza la bozza se ne va, e alla riapertura non c'è conflitto", async () => {
      const sessions = new DocumentSessionCollection(api);
      const text = await removeDirty(sessions);
      // «Ricrea la nota»: il file torna col testo, su una revisione nuova.
      disk = { text, revision: "rev-ricreata" };
      await sessions.discardRemovedDraft("sparita.md", undefined, text);
      expect(drafts.has("sparita.md")).toBe(false);

      const fresh = new DocumentSessionCollection(api);
      expect(await reopen(fresh)).toBeUndefined();
      expect(vi.mocked(api.writeDocument)).not.toHaveBeenCalled();
    });

    it("con la nota già riaperta, pulita sul testo ricreato, la bozza se ne va lo stesso", async () => {
      const sessions = new DocumentSessionCollection(api);
      const text = await removeDirty(sessions);
      disk = { text, revision: "rev-ricreata" };
      await sessions.read("sparita.md");
      expect(sessions.inspect("sparita.md")).toMatchObject({ dirty: false, text });

      await sessions.discardRemovedDraft("sparita.md", undefined, text);
      expect(drafts.has("sparita.md")).toBe(false);
    });

    it("quando il file torna con un altro testo la bozza resta, e alla riapertura il conflitto è vero", async () => {
      const sessions = new DocumentSessionCollection(api);
      const text = await removeDirty(sessions);
      // Il file è tornato, ma non col testo della bozza.
      disk = { text: "testo di prima, rifatto da un'altra parte", revision: "rev-altra" };
      await sessions.discardRemovedDraft("sparita.md", undefined, disk.text);
      expect(drafts.get("sparita.md")).toEqual({ text, base: "rev-cancellata" });

      const fresh = new DocumentSessionCollection(api);
      expect(await reopen(fresh)).toBe("conflitto");
      expect(fresh.inspect("sparita.md")).toMatchObject({ text, dirty: true });
      // Niente è stato coperto: il disco ha ancora l'altro testo.
      expect(disk.text).toBe("testo di prima, rifatto da un'altra parte");
    });

    it("con la nota riaperta su un altro testo la bozza resta", async () => {
      const sessions = new DocumentSessionCollection(api);
      const text = await removeDirty(sessions);
      disk = { text: "un altro testo", revision: "rev-altra" };
      await sessions.read("sparita.md");

      await sessions.discardRemovedDraft("sparita.md", undefined, text);
      expect(drafts.get("sparita.md")?.text).toBe(text);
    });
  });

  it("«Ricrea» sul primo avviso non cancella la bozza di una rimozione più nuova", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("sparita.md");
    acceptText(sessions, "sparita.md", "primo testo");
    sessions.handleExternalRemoval("sparita.md");
    // La nota torna (da fuori), si riapre, si scrive altro e sparisce di nuovo:
    // la bozza su disco adesso tiene il testo nuovo.
    await sessions.read("sparita.md");
    acceptText(sessions, "sparita.md", "testo più nuovo");
    sessions.handleExternalRemoval("sparita.md");

    // «Ricrea» del primo avviso: la nota torna col primo testo, ma la bozza è
    // della seconda rimozione e resta.
    await sessions.discardRemovedDraft("sparita.md", undefined, "primo testo");
    expect(vi.mocked(api.discardDraft)).not.toHaveBeenCalled();

    // «Ricrea» del secondo avviso: è la sua bozza, e si scarta.
    await sessions.discardRemovedDraft("sparita.md", undefined, "testo più nuovo");
    expect(vi.mocked(api.discardDraft)).toHaveBeenCalledWith("sparita.md");
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
    let releaseRead!: (source: DocumentSource) => void;
    api.readDocument = vi.fn(
      () =>
        new Promise<DocumentSource>((resolve) => {
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
    releaseRead({ text: "testo non più valido", revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" });
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
    vi.stubGlobal("setTimeout", vi.fn((callback: () => void) => {
      timers.push(callback);
      return ++nextTimer;
    }));
    vi.stubGlobal("clearTimeout", vi.fn());
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
    vi.stubGlobal("setTimeout", vi.fn((callback: () => void) => {
      timers.push(callback);
      return ++nextTimer;
    }));
    vi.stubGlobal("clearTimeout", vi.fn());
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
