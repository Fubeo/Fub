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

    expect(sessions.suspendSave("a.md")).toBe(true);
    expect(sessions.inspect("a.md")?.suspended).toBe(true);
    expect(sessions.inspect("b.md")?.suspended).toBe(false);

    sessions.resumeSave("a.md");
    expect(sessions.inspect("a.md")?.suspended).toBe(false);
    expect(sessions.inspect("b.md")?.suspended).toBe(false);
  });
});
