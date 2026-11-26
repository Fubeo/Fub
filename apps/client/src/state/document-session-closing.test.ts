// Le prove di `DocumentSession`: il giornale di Excel, le chiavi di apertura, la cadenza delle bozze, i tratti della sessione.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentSessionCollection, type DocumentSessionApi, type DocumentSurface, type DocumentSurfaceUpdate } from "./document-session";
import { type DocumentUpdate, type TextOperation } from "../editors/core/text-operation";
import { RangeSurface, type RangeStatus } from "../editors/core/range-surface";
import { parseSectionAnchor } from "../editors/core/section-anchor";
import type { DocumentSource } from "../host/contract";
import { gridJournalText } from "./grid-journal";
import { createFakeHost, type FakeHost } from "../host/fake";
import { acceptText, fakeApi } from "./document-session-test-support";

describe("il giornale di una cartella di Excel", () => {
  let api: DocumentSessionApi;
  const journal = (...cells: Array<[row: string, before: string, after: string]>) =>
    gridJournalText({ entries: cells.map(([row, before, after]) => ({ sheet: "s1", row, column: "c1", before, after })), commands: [] });

  beforeEach(() => {
    api = fakeApi();
    vi.mocked(api.readDocument).mockImplementation(async (id): Promise<DocumentSource> => ({
      text: "",
      revision: id.endsWith(".xlsx") ? "sha256:uno" : "rev-1",
      format_id: id.endsWith(".xlsx") ? "xlsx" : "markdown",
      source_kind: id.endsWith(".xlsx") ? "bytes" : "text",
      text_kind: id.endsWith(".xlsx") ? "grid_journal" : "source",
    }));
    vi.stubGlobal("setTimeout", vi.fn(() => 1));
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function recording(log: DocumentSurfaceUpdate[]): DocumentSurface {
    return { id: "griglia", sync: (update) => log.push(update) };
  }

  it("salvato, il giornale è nei byte: il testo torna vuoto e la griglia lo riceve", async () => {
    vi.mocked(api.writeDocument).mockResolvedValueOnce("sha256:due");
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("conti.xlsx");
    const log: DocumentSurfaceUpdate[] = [];
    sessions.attachSurface("conti.xlsx", recording(log));
    const written = journal(["r1", "800", "900"]);
    acceptText(sessions, "conti.xlsx", written, "altra");
    await sessions.flush("conti.xlsx");

    expect(api.writeDocument).toHaveBeenCalledWith("conti.xlsx", written, { kind: "descends_from", value: "sha256:uno" }, null, expect.any(String));
    expect(sessions.inspect("conti.xlsx")).toMatchObject({
      text: "",
      dirty: false,
      result: "ok",
      base: { kind: "descends_from", value: "sha256:due" },
    });
    // La griglia si riapre sui byte nuovi: riceve il testo per intero.
    expect(log[log.length - 1]).toEqual({ kind: "text", text: "" });
    expect(api.discardDraft).toHaveBeenCalledWith("conti.xlsx");
  });

  it("ciò che si scrive durante il salvataggio si riporta sui byte nuovi, e resta da salvare", async () => {
    let finish!: (revision: string) => void;
    vi.mocked(api.writeDocument).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("conti.xlsx");
    const log: DocumentSurfaceUpdate[] = [];
    sessions.attachSurface("conti.xlsx", recording(log));
    acceptText(sessions, "conti.xlsx", journal(["r1", "800", "900"]), "altra");
    const saving = sessions.flush("conti.xlsx");
    await Promise.resolve();
    // Durante il salvataggio: B2 cambia ancora, e B3 entra.
    acceptText(sessions, "conti.xlsx", journal(["r1", "800", "950"], ["r2", "1", "2"]), "altra");
    finish("sha256:due");
    await saving;

    const rebased = journal(["r1", "900", "950"], ["r2", "1", "2"]);
    expect(sessions.inspect("conti.xlsx")).toMatchObject({
      text: rebased,
      dirty: true,
      base: { kind: "descends_from", value: "sha256:due" },
    });
    expect(log[log.length - 1]).toEqual({ kind: "text", text: rebased });
  });

  it("una rilettura pulita su byte nuovi riapre la griglia anche se il giornale resta vuoto", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("conti.xlsx");
    const log: DocumentSurfaceUpdate[] = [];
    sessions.attachSurface("conti.xlsx", recording(log));
    expect(await sessions.reloadIfClean("conti.xlsx")).toMatchObject({ kind: "reloaded", changed: false });
    expect(log).toEqual([]);

    vi.mocked(api.readDocument).mockResolvedValueOnce({
      text: "", revision: "sha256:altra", format_id: "xlsx", source_kind: "bytes", text_kind: "grid_journal",
    });
    expect(await sessions.reloadIfClean("conti.xlsx")).toMatchObject({ kind: "reloaded", changed: true });
    expect(log).toEqual([{ kind: "text", text: "" }]);
    expect(sessions.inspect("conti.xlsx")?.base).toEqual({ kind: "descends_from", value: "sha256:altra" });
  });

  it("un testo di sorgente non è un giornale: la stessa rilettura vuota non cambia niente", async () => {
    vi.mocked(api.readDocument).mockResolvedValue({
      text: "", revision: "rev-altra", format_id: "markdown", source_kind: "text", text_kind: "source",
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: DocumentSurfaceUpdate[] = [];
    sessions.attachSurface("nota.md", recording(log));
    vi.mocked(api.readDocument).mockResolvedValueOnce({
      text: "", revision: "rev-terza", format_id: "markdown", source_kind: "text", text_kind: "source",
    });
    expect(await sessions.reloadIfClean("nota.md")).toMatchObject({ kind: "reloaded", changed: false });
    expect(log).toEqual([]);
  });
});

describe("chiusura della chiave di apertura", () => {
  function keyedApi(): DocumentSessionApi & { documentClosed: ReturnType<typeof vi.fn> } {
    const api = fakeApi() as DocumentSessionApi & { documentClosed: ReturnType<typeof vi.fn> };
    api.readDocument = vi.fn(async (id): Promise<DocumentSource> => ({
      text: `${id}: proiezione`,
      revision: "rev-1",
      format_id: id.endsWith(".docx") ? "docx" : "markdown",
      source_kind: "text",
      text_kind: "source",
    }));
    return api;
  }

  it("la chiude quando la sessione esce davvero, e non prima", async () => {
    const api = keyedApi();
    const sessions = new DocumentSessionCollection(api, () => "/vault");
    await sessions.read("Lettera.docx");
    const key = vi.mocked(api.openDocument).mock.calls[0]?.[1];
    const intent = sessions.retain("Lettera.docx");

    expect(await sessions.release("Lettera.docx")).toEqual({ kind: "active" });
    expect(api.documentClosed).not.toHaveBeenCalled();

    intent();
    expect(await sessions.release("Lettera.docx")).toEqual({ kind: "closed", dirty: false });
    expect(api.documentClosed).toHaveBeenCalledTimes(1);
    expect(api.documentClosed).toHaveBeenCalledWith(key, "/vault");
  });

  it("la chiude anche per una nota, e un errore dell'host non cambia la chiusura", async () => {
    const api = keyedApi();
    api.documentClosed.mockRejectedValue(new Error("host spento"));
    const sessions = new DocumentSessionCollection(api, () => null);
    await sessions.read("nota.md");
    await sessions.read("Lettera.docx");
    const [noteKey, letterKey] = vi.mocked(api.openDocument).mock.calls.map((call) => call[1]);

    expect(await sessions.release("nota.md")).toEqual({ kind: "closed", dirty: false });
    expect(api.documentClosed).toHaveBeenCalledWith(noteKey);
    expect(await sessions.release("Lettera.docx")).toEqual({ kind: "closed", dirty: false });
    expect(api.documentClosed).toHaveBeenCalledWith(letterKey);
    expect(api.documentClosed).toHaveBeenCalledTimes(2);
    expect(sessions.get("Lettera.docx")).toBeUndefined();
  });
});

describe("ogni documento che la shell apre si chiude (chiavi di apertura)", () => {
  const VAULT = "/vault";
  let host: FakeHost;
  let api: DocumentSessionApi;
  let sessions: DocumentSessionCollection;

  function lettere(n: number): Record<string, string> {
    return Object.fromEntries(Array.from({ length: n }, (_, i) => [`Lettera-${i}.docx`, `lettera ${i}`]));
  }
  function setup(file: Record<string, string> = lettere(1)): void {
    host = createFakeHost({ root: VAULT, file });
    // Una copia delle porte: i banchi che costruiscono l'ordine dell'host
    // sostituiscono una porta senza toccare il modulo del finto.
    api = { ...host.module.api };
    sessions = new DocumentSessionCollection(api, () => VAULT);
  }
  /// Le chiavi che la shell ha passato a `openDocument`, in ordine.
  const openedKeys = (): string[] => host.atGate("openDocument").map((call) => call.args[1] as string);
  const closedKeys = (): string[] => host.atGate("documentClosed").map((call) => call.args[0] as string);
  /// Una porta la cui chiamata arriva all'host solo quando il banco lo dice:
  /// l'host segna la chiave **dopo** che la shell ha già chiuso la sessione.
  function late<K extends "openDocument" | "writeDocument">(name: K): () => void {
    const real = api[name] as (...args: unknown[]) => Promise<unknown>;
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    let armed = true;
    (api as unknown as Record<string, unknown>)[name] = vi.fn((...args: unknown[]) => {
      if (!armed) return real(...args);
      armed = false;
      return arrived.then(() => real(...args));
    });
    return arrive;
  }
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => setup());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("due riquadri sullo stesso documento: una sessione, una chiave", async () => {
    await Promise.all([sessions.read("Lettera-0.docx"), sessions.read("Lettera-0.docx")]);
    await sessions.read("Lettera-0.docx");
    await settle();
    expect(host.openKeys(VAULT)).toBe(1);

    sessions.close("Lettera-0.docx");
    await settle();
    expect(host.openKeys(VAULT)).toBe(0);
  });

  it("chiusa e riaperta subito: due chiavi, la vecchia chiusa", async () => {
    await sessions.read("Lettera-0.docx");
    sessions.close("Lettera-0.docx");
    await sessions.read("Lettera-0.docx");
    await settle();

    const [first, second] = openedKeys();
    expect(first).not.toBe(second);
    expect(closedKeys()).toEqual([first]);
    expect(host.openKeys(VAULT)).toBe(1);
  });

  it("closeAll con dieci documenti aperti chiude dieci chiavi", async () => {
    setup(lettere(10));
    for (let i = 0; i < 10; i++) await sessions.read(`Lettera-${i}.docx`);
    expect(host.openKeys(VAULT)).toBe(10);

    sessions.closeAll();
    await settle();
    expect(host.openKeys(VAULT)).toBe(0);
    expect(new Set(closedKeys()).size).toBe(10);
  });

  it("una cancellazione confermata chiude la chiave", async () => {
    await sessions.read("Lettera-0.docx");
    await expect(sessions.delete("Lettera-0.docx", async () => {})).resolves.toMatchObject({ kind: "deleted" });
    await settle();
    expect(host.openKeys(VAULT)).toBe(0);
  });

  it("una cancellazione fallita lascia la sessione e la sua chiave", async () => {
    await sessions.read("Lettera-0.docx");
    await expect(
      sessions.delete("Lettera-0.docx", async () => {
        throw new Error("cestino pieno");
      }),
    ).rejects.toThrow("cestino pieno");
    await settle();
    expect(sessions.get("Lettera-0.docx")).toBeDefined();
    expect(host.openKeys(VAULT)).toBe(1);
    expect(closedKeys()).toEqual([]);
  });

  it("un file tolto da fuori chiude la chiave", async () => {
    await sessions.read("Lettera-0.docx");
    sessions.handleExternalRemoval("Lettera-0.docx");
    await settle();
    expect(host.openKeys(VAULT)).toBe(0);
  });

  it("un file rinominato da fuori tiene la chiave, e il salvataggio la passa", async () => {
    await sessions.read("Lettera-0.docx");
    const [key] = openedKeys();
    host.renameFromOutside("Lettera-0.docx", "Spostata.docx");
    expect(sessions.rename("Lettera-0.docx", "Spostata.docx")).toMatchObject({ kind: "renamed" });
    const write = vi.spyOn(api, "writeDocument");
    acceptText(sessions, "Spostata.docx", "lettera riscritta");
    await sessions.flush("Spostata.docx");

    expect(write).toHaveBeenCalledWith("Spostata.docx", "lettera riscritta", expect.anything(), VAULT, key);
    expect(closedKeys()).toEqual([]);
    expect(host.openKeys(VAULT)).toBe(1);
    sessions.close("Spostata.docx");
    await settle();
    expect(closedKeys()).toEqual([key]);
    expect(host.openKeys(VAULT)).toBe(0);
  });

  it("una lettura che fallisce chiude subito la sua chiave", async () => {
    host.fault("openDocument", "disco staccato");
    await expect(sessions.read("Lettera-0.docx")).rejects.toThrow("disco staccato");
    await settle();
    expect(openedKeys()).toHaveLength(1);
    expect(closedKeys()).toEqual(openedKeys());
    expect(host.openKeys(VAULT)).toBe(0);
  });

  it("una lettura scartata (il vault è cambiato) chiude subito la sua chiave", async () => {
    let vault = VAULT;
    sessions = new DocumentSessionCollection(api, () => vault);
    const arrive = late("openDocument");
    const reading = sessions.read("Lettera-0.docx");
    vault = "/altro";
    arrive();
    await reading;
    await settle();
    expect(sessions.get("Lettera-0.docx")).toBeUndefined();
    expect(closedKeys()).toEqual(openedKeys());
    expect(host.openKeys(VAULT)).toBe(0);
  });

  it("una rilettura che arriva all'host dopo la chiusura richiude la chiave", async () => {
    await sessions.read("Lettera-0.docx");
    const arrive = late("openDocument");
    const reloading = sessions.reloadIfClean("Lettera-0.docx");
    await vi.waitFor(() => expect(api.openDocument).toHaveBeenCalledTimes(1));
    sessions.closeAll();
    await settle();
    expect(host.openKeys(VAULT)).toBe(0);

    arrive();
    await reloading.catch(() => {});
    await settle();
    expect(host.openKeys(VAULT)).toBe(0);
  });

  it("un salvataggio che arriva all'host dopo la chiusura richiude la chiave", async () => {
    await sessions.read("Lettera-0.docx");
    acceptText(sessions, "Lettera-0.docx", "ultima riga");
    const arrive = late("writeDocument");
    const saving = sessions.flush("Lettera-0.docx");
    await vi.waitFor(() => expect(api.writeDocument).toHaveBeenCalledTimes(1));
    sessions.closeAll();
    await settle();
    expect(host.openKeys(VAULT)).toBe(0);

    arrive();
    await saving.catch(() => {});
    await settle();
    // La scrittura è arrivata davvero all'host, sotto la chiave chiusa.
    expect(host.atGate("writeDocument")).toHaveLength(1);
    expect(host.openKeys(VAULT)).toBe(0);
  });

  it("una nota e una cartella di Excel passano la chiave, e l'host la ignora", async () => {
    setup({ "nota.md": "testo", "conti.xlsx": "" });
    const write = vi.spyOn(api, "writeDocument");
    await sessions.read("nota.md");
    await sessions.read("conti.xlsx");
    const [noteKey, gridKey] = openedKeys();
    expect(noteKey).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(gridKey).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(noteKey).not.toBe(gridKey);

    acceptText(sessions, "nota.md", "testo nuovo");
    await sessions.flush("nota.md");
    acceptText(sessions, "conti.xlsx", gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c1", before: "", after: "1" }], commands: [] }));
    await sessions.flush("conti.xlsx");
    expect(write).toHaveBeenCalledWith("nota.md", "testo nuovo", expect.anything(), VAULT, noteKey);
    expect(write).toHaveBeenCalledWith("conti.xlsx", expect.any(String), expect.anything(), VAULT, gridKey);
    expect(host.openKeys(VAULT)).toBe(0);

    sessions.closeAll();
    await settle();
    expect(closedKeys().sort()).toEqual([noteKey, gridKey].sort());
  });

  it("un documento di videoscrittura passa la chiave anche quando salva", async () => {
    const write = vi.spyOn(api, "writeDocument");
    await sessions.read("Lettera-0.docx");
    const [key] = openedKeys();
    acceptText(sessions, "Lettera-0.docx", "lettera riscritta");
    await sessions.flush("Lettera-0.docx");
    expect(write).toHaveBeenCalledWith("Lettera-0.docx", "lettera riscritta", expect.anything(), VAULT, key);
    expect(host.openKeys(VAULT)).toBe(1);
  });

  it("una bozza ripristinata senza lettura ha la sua chiave, e la chiude", async () => {
    sessions.restore("Lettera-0.docx", "dalla bozza", null);
    sessions.closeAll();
    await settle();
    expect(openedKeys()).toEqual([]);
    expect(closedKeys()).toHaveLength(1);
    expect(closedKeys()[0]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("senza randomUUID la chiave viene da getRandomValues", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => real.getRandomValues(bytes) });
    await sessions.read("Lettera-0.docx");
    const [key] = openedKeys();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(host.openKeys(VAULT)).toBe(1);
    sessions.close("Lettera-0.docx");
    await settle();
    expect(host.openKeys(VAULT)).toBe(0);
  });
});

describe("la cadenza delle bozze", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("in una nota scritta senza fermarsi: una bozza al secondo, e il salvataggio aspetta la pausa", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    let text = "";
    for (let key = 0; key < 30; key++) {
      text += "a";
      acceptText(sessions, "nota.md", text);
      await vi.advanceTimersByTimeAsync(100);
    }
    const drafts = vi.mocked(api.saveDraft).mock.calls;
    expect(drafts.map(([, draft]) => draft.length)).toEqual([10, 20, 30]);
    expect(api.writeDocument).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(api.writeDocument).toHaveBeenCalledTimes(1);
  });

  it("una bozza ancora in volo non ne accoda una seconda uguale", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    let release!: () => void;
    api.saveDraft = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const big = "x".repeat(4 * 1_048_576);
    for (let key = 0; key < 10; key++) {
      acceptText(sessions, "nota.md", `${big}${key}`);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    // La chiusura chiede la bozza dello stesso testo mentre quella è in volo.
    const flushed = sessions.flushDraft("nota.md");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    release();
    await flushed;
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
  });
});

describe("la bozza non aspetta una scrittura lenta (#485)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /// Una scrittura del file che non finisce finché il test non la libera;
  /// le seguenti finiscono subito, o mai con `stuckAfter`.
  function slowWrite(api: DocumentSessionApi, stuckAfter = false): (revision: string) => void {
    let release!: (revision: string) => void;
    api.writeDocument = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }))
      .mockImplementation(() => (stuckAfter ? new Promise<string>(() => {}) : Promise.resolve("rev-3")));
    return (revision) => release(revision);
  }

  it("la bozza di una battuta arriva all'host mentre la scrittura è ancora in volo, con la base di quella scrittura", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const release = slowWrite(api);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "salvato");
    void sessions.flush("nota.md");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.writeDocument).toHaveBeenCalledTimes(1);

    acceptText(sessions, "nota.md", "salvato e battuta nuova");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.saveDraft).toHaveBeenLastCalledWith("nota.md", "salvato e battuta nuova", "rev-1");
    expect(api.discardDraft).not.toHaveBeenCalled();

    // Dopo la scrittura lenta parte quella della battuta: solo quando il suo
    // testo è sul disco la bozza se ne va.
    release("rev-2");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.writeDocument).toHaveBeenCalledTimes(2);
    expect(api.discardDraft).toHaveBeenCalledTimes(1);
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: false, text: "salvato e battuta nuova" });
  });

  it("il salvataggio che finisce dopo una bozza più nuova non la toglie: la riscrive sulla base nuova", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    // La scrittura del testo nuovo resta in volo: il disco ha solo «vecchio».
    const release = slowWrite(api, true);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "vecchio");
    void sessions.flush("nota.md");
    await vi.advanceTimersByTimeAsync(0);
    acceptText(sessions, "nota.md", "nuovo");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);

    release("rev-2");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.discardDraft).not.toHaveBeenCalled();
    // La cadenza riscrive la stessa bozza sulla revisione appena scritta, e
    // nessuno la toglie finché il suo testo non è sul disco.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(api.saveDraft).toHaveBeenLastCalledWith("nota.md", "nuovo", "rev-2");
    expect(api.discardDraft).not.toHaveBeenCalled();
  });

  it("una bozza ancora in volo quando il salvataggio finisce non passa sopra allo scarto, né lo scarto a lei", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const release = slowWrite(api);
    const order: string[] = [];
    let finishDraft!: () => void;
    api.saveDraft = vi.fn((_id: string, text: string) => {
      order.push(`bozza:${text}`);
      return new Promise<void>((resolve) => {
        finishDraft = () => {
          order.push(`bozza scritta:${text}`);
          resolve();
        };
      });
    });
    api.discardDraft = vi.fn(async () => {
      order.push("scarto");
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo");
    void sessions.flush("nota.md");
    await vi.advanceTimersByTimeAsync(0);
    acceptText(sessions, "nota.md", "testo in più");
    await vi.advanceTimersByTimeAsync(1_000);
    // Si torna al testo in salvataggio: alla fine della scrittura il buffer è
    // pulito, e lo scarto parte solo dopo la bozza ancora in volo.
    acceptText(sessions, "nota.md", "testo");
    release("rev-2");
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["bozza:testo in più"]);
    finishDraft();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["bozza:testo in più", "bozza scritta:testo in più", "scarto"]);
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: false });
  });

  it("il salvataggio che finisce col testo della bozza la toglie", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const release = slowWrite(api);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "lo stesso testo");
    await vi.advanceTimersByTimeAsync(400);
    expect(api.writeDocument).toHaveBeenCalledTimes(1);
    // La bozza dello stesso testo parte mentre il file si scrive.
    await vi.advanceTimersByTimeAsync(600);
    expect(api.saveDraft).toHaveBeenCalledWith("nota.md", "lo stesso testo", "rev-1");
    expect(api.discardDraft).not.toHaveBeenCalled();

    release("rev-2");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.discardDraft).toHaveBeenCalledTimes(1);
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: false });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("durante la scrittura lenta la bozza tiene la sua cadenza: niente chiamata per battuta", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    slowWrite(api);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "a");
    void sessions.flush("nota.md");
    await vi.advanceTimersByTimeAsync(0);
    let text = "a";
    for (let key = 0; key < 30; key++) {
      text += "b";
      acceptText(sessions, "nota.md", text);
      await vi.advanceTimersByTimeAsync(100);
    }
    const drafts = vi.mocked(api.saveDraft).mock.calls;
    expect(drafts.map(([, draft]) => draft.length)).toEqual([11, 21, 31]);
    expect(api.writeDocument).toHaveBeenCalledTimes(1);
  });
});

describe("una superficie su un tratto della sessione (T29a)", () => {
  let api: DocumentSessionApi;
  const NOTE = "# Diario\n\n## Riunione\n\nPunto uno.\n\n## Altro\n\nFine.\n";

  beforeEach(() => {
    api = fakeApi();
    vi.stubGlobal("setTimeout", vi.fn(() => 1));
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function open(text = NOTE): Promise<DocumentSessionCollection> {
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => ({ text, revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" }));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    return sessions;
  }

  function edit(before: string, from: number, to: number, inserted: string): { text: string; operation: TextOperation } {
    const text = `${before.slice(0, from)}${inserted}${before.slice(to)}`;
    return {
      text,
      operation: {
        beforeLength: before.length,
        afterLength: text.length,
        edits: [{ from, to, deleted: before.slice(from, to), inserted }],
      },
    };
  }

  /// Un riquadro intero: tiene il suo testo e lo aggiorna con ciò che arriva.
  function pane(sessions: DocumentSessionCollection, id: string) {
    const surface = {
      id,
      text: sessions.text("nota.md")!,
      sync(update: DocumentSurfaceUpdate) {
        surface.text = update.text;
      },
      type(from: number, to: number, inserted: string) {
        const change = edit(surface.text, from, to, inserted);
        surface.text = change.text;
        expect(sessions.acceptSurfaceChange("nota.md", id, change)).toEqual({ kind: "accepted" });
      },
    };
    sessions.attachSurface("nota.md", surface);
    return surface;
  }

  /// La vista locale del tratto: un annulla suo, fatto soltanto delle sue
  /// battute; ciò che arriva dalla sessione non vi entra.
  function rangeOn(sessions: DocumentSessionCollection, anchor: string, id = "trasclusione") {
    const session = sessions.get("nota.md")!;
    const parsed = parseSectionAnchor(anchor);
    if (!parsed) throw new Error("àncora non valida");
    const range = RangeSurface.open(session, { id, anchor: parsed });
    if (!range) throw new Error("àncora assente");
    const statuses: RangeStatus[] = [];
    range.watchStatus((status) => statuses.push(status));
    const view = {
      text: range.text(),
      readOnly: false,
      synced: [] as DocumentUpdate[],
      undo: [] as TextOperation[],
      sync(update: DocumentUpdate) {
        view.synced.push(update);
        view.text = update.text;
      },
      setReadOnly(readOnly: boolean) {
        view.readOnly = readOnly;
      },
      type(from: number, to: number, inserted: string) {
        const change = edit(view.text, from, to, inserted);
        view.text = change.text;
        view.undo.push(change.operation);
        return range.write(change);
      },
    };
    range.connect(view);
    return { range, view, statuses };
  }

  it("tre superfici, due intere e una ristretta, si scambiano le modifiche senza perderne", async () => {
    const sessions = await open();
    const a = pane(sessions, "riquadro-a");
    const b = pane(sessions, "riquadro-b");
    const { range, view } = rangeOn(sessions, "#Riunione");
    expect(view.text).toBe("## Riunione\n\nPunto uno.");
    const connected = view.synced.length;

    // A scrive prima del tratto: il tratto si sposta, la vista non riceve niente.
    a.type("# Diario".length, "# Diario".length, " di bordo");
    expect(view.synced).toHaveLength(connected);
    expect(range.text()).toBe("## Riunione\n\nPunto uno.");

    // B scrive dentro il tratto: la vista riceve l'operazione, nelle sue coordinate.
    const inside = sessions.text("nota.md")!.indexOf("Punto uno.") + "Punto uno.".length;
    b.type(inside, inside, " Punto due.");
    expect(view.text).toBe("## Riunione\n\nPunto uno. Punto due.");
    expect(view.synced[view.synced.length - 1]?.operation?.edits).toEqual([
      { from: 23, to: 23, deleted: "", inserted: " Punto due." },
    ]);

    // La ristretta scrive: entra nella sessione e arriva ai due riquadri.
    expect(view.type(view.text.length, view.text.length, "\nPunto tre.")).toEqual({ kind: "accepted" });
    // A scrive dopo il tratto, nella sezione dopo.
    a.type(a.text.length, a.text.length, "Coda.\n");

    const final = "# Diario di bordo\n\n## Riunione\n\nPunto uno. Punto due.\nPunto tre.\n\n## Altro\n\nFine.\nCoda.\n";
    expect(sessions.text("nota.md")).toBe(final);
    expect(a.text).toBe(final);
    expect(b.text).toBe(final);
    expect(range.text()).toBe("## Riunione\n\nPunto uno. Punto due.\nPunto tre.");
    expect(view.text).toBe(range.text());
    // L'annulla locale ha soltanto la battuta della ristretta.
    expect(view.undo).toHaveLength(1);
    expect(view.undo[0]!.edits[0]!.inserted).toBe("\nPunto tre.");
    expect(sessions.inspect("nota.md")).toMatchObject({ dirty: true });
    range.destroy();
  });

  it("le modifiche della ristretta vanno nella coda della sessione, che la chiusura svuota", async () => {
    const sessions = await open();
    pane(sessions, "riquadro-a");
    const { range, view, statuses } = rangeOn(sessions, "#Riunione");
    view.type(view.text.length, view.text.length, "\nScritto nella trasclusione.");

    expect(await sessions.release("nota.md")).toEqual({ kind: "closed", dirty: false });
    expect(vi.mocked(api.writeDocument).mock.lastCall?.[1]).toBe(
      "# Diario\n\n## Riunione\n\nPunto uno.\nScritto nella trasclusione.\n\n## Altro\n\nFine.\n",
    );
    expect(range.status()).toBe("closed");
    expect(statuses).toEqual(["closed"]);
    expect(view.readOnly).toBe(true);
    expect(view.type(0, 0, "dopo")).toEqual({ kind: "refused" });
    expect(view.text).toBe("## Riunione\n\nPunto uno.\nScritto nella trasclusione.");
  });

  it("il titolo rinominato da un'altra superficie ferma la ristretta sull'ultimo testo", async () => {
    const sessions = await open();
    const a = pane(sessions, "riquadro-a");
    const { range, view, statuses } = rangeOn(sessions, "#Riunione");
    const heading = a.text.indexOf("Riunione");

    a.type(heading, heading + "Riunione".length, "Incontro");

    expect(range.status()).toBe("lost");
    expect(statuses).toEqual(["lost"]);
    expect(view.readOnly).toBe(true);
    expect(range.text()).toBe("## Riunione\n\nPunto uno.");
    expect(range.span()).toBeNull();
    // Più niente arriva alla vista ferma, e niente parte da lei.
    a.type(0, 0, "x");
    expect(view.text).toBe("## Riunione\n\nPunto uno.");
    const before = sessions.text("nota.md");
    expect(view.type(0, 0, "y")).toEqual({ kind: "refused" });
    expect(view.text).toBe("## Riunione\n\nPunto uno.");
    expect(sessions.text("nota.md")).toBe(before);
  });

  it("un titolo uguale altrove non prende il posto di quello tolto", async () => {
    const sessions = await open("## Riunione\n\nPrima.\n\n## Riunione\n\nSeconda.\n");
    const a = pane(sessions, "riquadro-a");
    const { range } = rangeOn(sessions, "#Riunione");
    expect(range.text()).toBe("## Riunione\n\nPrima.");

    a.type(0, "## Riunione\n\nPrima.\n\n".length, "");

    expect(range.status()).toBe("lost");
    expect(range.text()).toBe("## Riunione\n\nPrima.");
  });

  it("il blocco cancellato da un'altra superficie ferma la ristretta", async () => {
    const sessions = await open("Prima riga.\n\nIl blocco citato. ^cit\n\nDopo.\n");
    const a = pane(sessions, "riquadro-a");
    const { range, view } = rangeOn(sessions, "#^cit");
    expect(view.text).toBe("Il blocco citato. ^cit");

    const start = a.text.indexOf("Il blocco");
    a.type(start, start + "Il blocco citato. ^cit\n\n".length, "");

    expect(range.status()).toBe("lost");
    expect(view.readOnly).toBe(true);
    expect(range.text()).toBe("Il blocco citato. ^cit");
  });

  it("l'àncora tolta dalla ristretta stessa la lascia scrivibile, e torna", async () => {
    const sessions = await open();
    const a = pane(sessions, "riquadro-a");
    const { range, view, statuses } = rangeOn(sessions, "#Riunione");

    // La persona cancella tutto il tratto: un tratto vuoto, senza àncora.
    expect(view.type(0, view.text.length, "")).toEqual({ kind: "accepted" });
    expect(range.status()).toBe("unanchored");
    expect(range.text()).toBe("");
    // Un'altra superficie scrive altrove: il tratto vuoto non si perde.
    a.type(a.text.length, a.text.length, "Coda.");
    expect(range.status()).toBe("unanchored");
    // Ci riscrive dentro, titolo compreso.
    expect(view.type(0, 0, "## Riunione\n\nDi nuovo.")).toEqual({ kind: "accepted" });
    expect(range.status()).toBe("live");
    expect(statuses).toEqual(["unanchored", "live"]);
    expect(sessions.text("nota.md")).toBe("# Diario\n\n## Riunione\n\nDi nuovo.\n\n## Altro\n\nFine.\nCoda.");
    expect(a.text).toBe(sessions.text("nota.md"));
  });

  it("un cambio dal disco mentre si scrive: ricarica seguita a buffer pulito, conflitto a buffer sporco", async () => {
    const sessions = await open();
    const { range, view } = rangeOn(sessions, "#Riunione");

    // Pulito: il disco cambia intorno e la ristretta resta sul suo tratto.
    vi.mocked(api.readDocument).mockResolvedValueOnce({
      text: "# Diario\n\nPremessa.\n\n## Riunione\n\nPunto uno.\n\n## Altro\n\nFine cambiata.\n",
      revision: "rev-2",
      format_id: "markdown",
      source_kind: "text",
      text_kind: "source",
    });
    expect(await sessions.handleExternalChange("nota.md", { actor: { kind: "watcher" }, batch: null })).toMatchObject({ kind: "reloaded" });
    expect(range.status()).toBe("live");
    expect(range.text()).toBe("## Riunione\n\nPunto uno.");
    expect(range.span()?.from).toBe("# Diario\n\nPremessa.\n\n".length);

    // Sporco: la ristretta scrive, il disco cambia: conflitto, il buffer resta.
    view.type(view.text.length, view.text.length, "\nNuovo.");
    expect(await sessions.handleExternalChange("nota.md", { actor: { kind: "watcher" }, batch: null })).toEqual({ kind: "warning", cause: "altra_app" });
    expect(view.type(view.text.length, view.text.length, " Ancora.")).toEqual({ kind: "accepted" });
    expect(sessions.text("nota.md")).toContain("Punto uno.\nNuovo. Ancora.\n\n## Altro");
    range.destroy();
  });

  it("un tratto col solo titolo in fondo alla nota, coi terminatori CRLF del file", async () => {
    const sessions = await open("# Diario\r\n\r\n## Vuota");
    const a = pane(sessions, "riquadro-a");
    const { range, view } = rangeOn(sessions, "#Vuota");
    expect(view.text).toBe("## Vuota");

    expect(view.type(view.text.length, view.text.length, "\n\nRiga.")).toEqual({ kind: "accepted" });
    expect(sessions.text("nota.md")).toBe("# Diario\r\n\r\n## Vuota\r\n\r\nRiga.");
    expect(range.text()).toBe("## Vuota\n\nRiga.");
    expect(a.text).toBe(sessions.text("nota.md"));
    range.destroy();
  });

  it("ogni ascoltatore ha il suo smaltimento: distrutta, la ristretta non riceve né scrive", async () => {
    const sessions = await open();
    const a = pane(sessions, "riquadro-a");
    const { range, view, statuses } = rangeOn(sessions, "#Riunione");
    const connected = view.synced.length;
    range.destroy();
    range.destroy();

    const inside = a.text.indexOf("Punto uno.");
    a.type(inside, inside, "Nuovo. ");
    expect(view.synced).toHaveLength(connected);
    expect(statuses).toEqual(["closed"]);
    expect(range.status()).toBe("closed");
    expect(view.type(0, 0, "z")).toEqual({ kind: "refused" });
    expect(sessions.text("nota.md")).toBe(a.text);
  });
});
