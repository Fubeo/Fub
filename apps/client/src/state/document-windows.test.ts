import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "./store";
import { closeDocumentWindowByLabel, openCurrentInNewWindow, pendingDocumentWindows } from "./document-windows";

const fixture = vi.hoisted(() => ({
  api: {
    onDocumentWindowClosed: vi.fn(),
    onDocumentWindowCloseRequested: vi.fn(),
    openDocumentWindow: vi.fn(),
    closeDocumentWindow: vi.fn(),
  },
  sessions: {
    get: vi.fn(),
    flush: vi.fn(),
    flushDraft: vi.fn(),
    isDirty: vi.fn(),
    saveState: vi.fn(),
  },
  attach: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../host/ipc", () => ({ api: fixture.api }));
vi.mock("./document-session", () => ({ documentSessions: fixture.sessions }));
vi.mock("./document-bridge", () => ({ attachRemoteSurface: fixture.attach }));
vi.mock("./layout", () => ({ activeDoc: () => null }));
vi.mock("../ui/notify", () => ({ notify: fixture.notify }));
vi.mock("../i18n/strings", () => ({ t: (key: string) => key }));

const owner = { snapshot: () => ({ lifecycle: "open" }) };
let serial = 0;
type WindowEvent = { label: string; surface: string };
const events: { destroyed?: (event: WindowEvent) => void } = {};
let dispose = vi.fn(async () => {});
let freeze = vi.fn(async () => {});
let thaw = vi.fn();

async function nextTurn(): Promise<void> {
  for (let n = 0; n < 8; n++) await Promise.resolve();
}

describe("native document-window close barrier", () => {
  let label: string;
  beforeEach(() => {
    serial++;
    label = `window-${serial}`;
    state.vaultRoot = "vault";
    state.currentDoc = `note-${serial}.md`;
    events.destroyed = undefined;
    fixture.notify.mockReset();
    fixture.sessions.get.mockReturnValue(owner);
    fixture.sessions.flush.mockReset().mockResolvedValue(false);
    fixture.sessions.flushDraft.mockReset().mockResolvedValue(undefined);
    fixture.sessions.isDirty.mockReturnValue(false);
    fixture.sessions.saveState.mockReturnValue(null);
    freeze = vi.fn(async () => {});
    thaw = vi.fn();
    dispose = vi.fn(async () => {});
    fixture.attach.mockReset().mockImplementation(async (doc: string, vault: string) => ({
      request: { surface: "document", channel: `channel-${serial}`, document: doc, vault, session: `session-${serial}`, surfaceId: `surface-${serial}` },
      handle: { surfaceId: `surface-${serial}`, channel: `channel-${serial}`, freeze, thaw, dispose },
    }));
    fixture.api.onDocumentWindowClosed.mockReset().mockImplementation(async (handler: (event: WindowEvent) => void) => {
      events.destroyed = handler;
      return () => { events.destroyed = undefined; };
    });
    fixture.api.onDocumentWindowCloseRequested.mockReset().mockImplementation(async () => () => {});
    fixture.api.openDocumentWindow.mockReset().mockImplementation(async () => ({ label }));
    fixture.api.closeDocumentWindow.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    state.vaultRoot = "";
    state.currentDoc = null;
    expect(pendingDocumentWindows()).not.toContain(label);
  });

  it("attende save in corso, poi destruction nativa prima di rilasciare", async () => {
    await openCurrentInNewWindow();
    let completeSave: (dirty: boolean) => void = () => {};
    fixture.sessions.flush.mockImplementationOnce(() => new Promise<boolean>((resolve) => { completeSave = resolve; }));
    const first = closeDocumentWindowByLabel(label);
    const repeated = closeDocumentWindowByLabel(label);
    await nextTurn();
    expect(fixture.api.closeDocumentWindow).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    completeSave(false);
    await nextTurn();
    expect(fixture.api.closeDocumentWindow).toHaveBeenCalledTimes(1);
    expect(pendingDocumentWindows()).toContain(label);
    expect(dispose).not.toHaveBeenCalled();
    events.destroyed?.({ label, surface: "document" });
    await expect(Promise.all([first, repeated])).resolves.toEqual([true, true]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("un flush dirty vieta la chiusura e permette un nuovo tentativo", async () => {
    await openCurrentInNewWindow();
    fixture.sessions.flush.mockResolvedValueOnce(true);
    await expect(closeDocumentWindowByLabel(label)).resolves.toBe(false);
    expect(fixture.api.closeDocumentWindow).not.toHaveBeenCalled();
    expect(pendingDocumentWindows()).toContain(label);
    expect(thaw).toHaveBeenCalledOnce();
    const retried = closeDocumentWindowByLabel(label);
    await nextTurn();
    expect(fixture.api.closeDocumentWindow).toHaveBeenCalledTimes(1);
    events.destroyed?.({ label, surface: "document" });
    await expect(retried).resolves.toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
