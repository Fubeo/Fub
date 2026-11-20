import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "./store";
import { closeDocumentWindowByLabel, drainDocumentWindows, openCurrentInNewWindow, pendingDocumentWindows } from "./document-windows";
import { DocumentWindowUnsupported } from "./document-bridge";
import { declareShell, DESKTOP_CAPABILITIES, MOBILE_CAPABILITIES, type ClientShell } from "../platform/capabilities";

const MOBILE_SHELL: ClientShell = { id: "mobile", capabilities: MOBILE_CAPABILITIES };
const DESKTOP_SHELL: ClientShell = { id: "desktop", capabilities: DESKTOP_CAPABILITIES };

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
  showsBytes: vi.fn(() => false),
}));
vi.mock("../host/ipc", () => ({ api: fixture.api }));
vi.mock("./document-session", () => ({ documentSessions: fixture.sessions }));
vi.mock("./document-bridge", () => ({
  attachRemoteSurface: fixture.attach,
  DocumentWindowUnsupported: class extends Error {},
}));
vi.mock("./document-controller", () => ({ showsFileBytes: fixture.showsBytes, textProfileFor: () => "markdown" }));
vi.mock("./layout", () => ({ activeDoc: () => null }));
vi.mock("../ui/notify", () => ({ notify: fixture.notify }));
vi.mock("../i18n/strings", () => ({ t: (key: string) => key }));

const owner = { id: "nota.md", snapshot: () => ({ lifecycle: "open" }) };
let serial = 0;
type WindowEvent = { label: string; surface: string };
const events: { destroyed?: (event: WindowEvent) => void } = {};
let dispose = vi.fn(async () => {});
let freeze = vi.fn(async () => {});
let thaw = vi.fn();
let ownerClosed = (): boolean => false;

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
    ownerClosed = () => false;
    fixture.attach.mockReset().mockImplementation(async (doc: string, vault: string) => ({
      request: { surface: "document", channel: `channel-${serial}`, document: doc, vault, session: `session-${serial}`, surfaceId: `surface-${serial}`, profile: "markdown" },
      handle: { surfaceId: `surface-${serial}`, channel: `channel-${serial}`, freeze, thaw, dispose, ownerClosed: () => ownerClosed() },
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

  // I byte di un media non hanno un buffer da condividere; una tela o un foglio
  // hanno una superficie che la finestra non sa montare. In tutti e due i casi
  // la shell lo dice, invece di aprire una finestra sbagliata.
  it("un documento senza superficie di testo resta nella finestra principale", async () => {
    fixture.showsBytes.mockReturnValueOnce(true);
    await openCurrentInNewWindow("foto.png");
    expect(fixture.attach).not.toHaveBeenCalled();
    expect(fixture.notify).toHaveBeenCalledWith("windows.not_text", "info");

    fixture.attach.mockRejectedValueOnce(new DocumentWindowUnsupported("lavagna.canvas"));
    await openCurrentInNewWindow("lavagna.canvas");
    expect(fixture.api.openDocumentWindow).not.toHaveBeenCalled();
    expect(fixture.notify).toHaveBeenLastCalledWith("windows.not_text", "info");
  });

  // Una piattaforma con una finestra sola non ne apre altre, da qualunque voce
  // ci si arrivi: niente superficie remota, niente richiesta al backend.
  it("senza multipleWindows nessuna finestra viene chiesta", async () => {
    declareShell(MOBILE_SHELL);
    try {
      await openCurrentInNewWindow("nota.md");
      expect(fixture.attach).not.toHaveBeenCalled();
      expect(fixture.api.openDocumentWindow).not.toHaveBeenCalled();
      expect(fixture.notify).toHaveBeenCalledWith("windows.unavailable", "info");
    } finally {
      declareShell(DESKTOP_SHELL);
    }
  });

  // La rinomina sposta la stessa sessione sotto un altro id: la finestra
  // resta sua, si salva col nome nuovo e si chiude.
  it("una rinomina non scollega la finestra dalla sua sessione", async () => {
    const doc = state.currentDoc!;
    const renamed = { id: doc, snapshot: () => ({ lifecycle: "open" }) };
    fixture.sessions.get.mockImplementation((id: string) => (id === renamed.id ? renamed : undefined));
    await openCurrentInNewWindow();
    renamed.id = `rinominata-${serial}.md`;

    const closing = closeDocumentWindowByLabel(label);
    await nextTurn();
    expect(freeze).toHaveBeenCalledOnce();
    expect(fixture.sessions.flush).toHaveBeenCalledWith(renamed.id);
    expect(fixture.api.closeDocumentWindow).toHaveBeenCalledTimes(1);
    events.destroyed?.({ label, surface: "document" });
    await expect(closing).resolves.toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(fixture.notify).not.toHaveBeenCalled();
  });

  // Audit #513, scenario B: la finestra muore da sola (crash, chiusa dal
  // sistema). La sessione della finestra principale ha il testo: si salva da
  // lì, la finestra si lascia, e chi usa Fub sa che le ultime battute non
  // confermate dalla finestra possono mancare. Niente blocco per sempre.
  it("una finestra morta da sola si lascia dopo il salvataggio, e il cambio di vault riparte", async () => {
    await openCurrentInNewWindow();
    events.destroyed?.({ label, surface: "document" });
    await nextTurn();
    await nextTurn();
    expect(fixture.sessions.flush).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(pendingDocumentWindows()).not.toContain(label);
    expect(fixture.notify).toHaveBeenCalledWith("windows.closed_alone", "guasto");
    await expect(drainDocumentWindows()).resolves.toBe(true);
    expect(fixture.api.closeDocumentWindow).not.toHaveBeenCalled();
  });

  it("una finestra morta da sola con il salvataggio non confermato si lascia lo stesso e lo dice", async () => {
    await openCurrentInNewWindow();
    fixture.sessions.flush.mockResolvedValueOnce(true);
    events.destroyed?.({ label, surface: "document" });
    await nextTurn();
    await nextTurn();
    expect(fixture.sessions.flushDraft).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(pendingDocumentWindows()).not.toContain(label);
    expect(fixture.notify).toHaveBeenCalledWith("windows.closed_alone_unsaved", "guasto");
    await expect(drainDocumentWindows()).resolves.toBe(true);
  });

  it("una finestra morta mentre si apriva si lascia anche lei", async () => {
    fixture.api.openDocumentWindow.mockImplementationOnce(async () => {
      events.destroyed?.({ label, surface: "document" });
      return { label };
    });
    await openCurrentInNewWindow();
    await nextTurn();
    await nextTurn();
    expect(dispose).toHaveBeenCalledOnce();
    expect(pendingDocumentWindows()).not.toContain(label);
    await expect(drainDocumentWindows()).resolves.toBe(true);
  });

  // Il cambio di vault chiesto mentre la finestra morta si sta ancora
  // lasciando aspetta il suo salvataggio invece di dire di no.
  it("lo svuotamento aspetta la finestra morta che si sta lasciando", async () => {
    await openCurrentInNewWindow();
    let completeSave: (dirty: boolean) => void = () => {};
    fixture.sessions.flush.mockImplementationOnce(() => new Promise<boolean>((resolve) => { completeSave = resolve; }));
    events.destroyed?.({ label, surface: "document" });
    await nextTurn();
    const draining = drainDocumentWindows();
    await nextTurn();
    expect(dispose).not.toHaveBeenCalled();
    completeSave(false);
    await expect(draining).resolves.toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });

  // Audit #513, scenario A: la nota della finestra è stata cancellata. Non
  // c'è niente da salvare: la finestra si chiude, con un avviso, sia dalla
  // sua X sia quando si cambia vault o si chiude Fub.
  it("la finestra di una nota cancellata si chiude senza salvare, con un avviso", async () => {
    let gone = false;
    const doc = state.currentDoc!;
    const deleted = { id: doc, snapshot: () => ({ lifecycle: gone ? "closed" : "open" }) };
    fixture.sessions.get.mockImplementation((id: string) => (id === doc && !gone ? deleted : undefined));
    ownerClosed = () => gone;
    await openCurrentInNewWindow();
    gone = true;

    const closing = closeDocumentWindowByLabel(label);
    await nextTurn();
    expect(freeze).not.toHaveBeenCalled();
    expect(fixture.sessions.flush).not.toHaveBeenCalled();
    expect(fixture.api.closeDocumentWindow).toHaveBeenCalledTimes(1);
    events.destroyed?.({ label, surface: "document" });
    await expect(closing).resolves.toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(fixture.notify).toHaveBeenCalledWith("windows.closed_gone", "info");
  });

  // Rilasciata, anche la sessione salvata di una finestra si chiude: non per
  // questo la nota «non esiste più».
  it("lo svuotamento di una finestra viva salva e non dice che la nota è sparita", async () => {
    let released = false;
    ownerClosed = () => released;
    dispose = vi.fn(async () => { released = true; });
    await openCurrentInNewWindow();
    fixture.api.closeDocumentWindow.mockImplementationOnce(async () => {
      queueMicrotask(() => events.destroyed?.({ label, surface: "document" }));
    });

    await expect(drainDocumentWindows()).resolves.toBe(true);
    expect(freeze).toHaveBeenCalledOnce();
    expect(fixture.sessions.flush).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(fixture.notify).not.toHaveBeenCalled();
  });

  it("lo svuotamento chiude la finestra di una nota cancellata", async () => {
    let gone = false;
    const doc = state.currentDoc!;
    const deleted = { id: doc, snapshot: () => ({ lifecycle: gone ? "closed" : "open" }) };
    fixture.sessions.get.mockImplementation((id: string) => (id === doc && !gone ? deleted : undefined));
    ownerClosed = () => gone;
    await openCurrentInNewWindow();
    gone = true;
    fixture.api.closeDocumentWindow.mockImplementationOnce(async () => {
      queueMicrotask(() => events.destroyed?.({ label, surface: "document" }));
    });

    await expect(drainDocumentWindows()).resolves.toBe(true);
    expect(freeze).not.toHaveBeenCalled();
    expect(fixture.sessions.flush).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
