// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SessionModule from "./document-session";
import { operationFromText, type TextOperation } from "../editors/core/text-operation";
import { state } from "./store";
import { documentSessions } from "./document-session";
import { attachChildBridge, attachRemoteSurface, DocumentWindowUnsupported, isRemoteMessage, setDocumentWindowNavigation, type ChildBridge, type MirroredTheme, type RemoteSurfaceHandle } from "./document-bridge";
import { mount } from "../theme/loader";
import { emit } from "./store";

vi.mock("./document-session", async (importOriginal) => {
  const real = await importOriginal<typeof SessionModule>();
  return {
    ...real,
    documentSessions: new real.DocumentSessionCollection({
      readDocument: async (id) => ({
        text: id.includes("crlf") ? "\ufeffa\r\nb" : "abc",
        revision: "disk-1", format_id: "plain", source_kind: "text",
      }),
      writeDocument: async () => "disk-2",
      saveDraft: async () => {},
      discardDraft: async () => {},
    }),
  };
});

class MemoryChannel {
  static peers = new Map<string, Set<MemoryChannel>>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  private closed = false;
  constructor(readonly name: string) {
    const peers = MemoryChannel.peers.get(name) ?? new Set<MemoryChannel>();
    peers.add(this);
    MemoryChannel.peers.set(name, peers);
  }
  postMessage(data: unknown): void {
    for (const peer of MemoryChannel.peers.get(this.name) ?? []) if (peer !== this) {
      const copy = structuredClone(data);
      queueMicrotask(() => { if (!peer.closed) peer.onmessage?.({ data: copy } as MessageEvent<unknown>); });
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const peers = MemoryChannel.peers.get(this.name);
    peers?.delete(this);
    if (peers?.size === 0) MemoryChannel.peers.delete(this.name);
  }
}

const PLAIN = (): string => "plain-text";

async function settle(): Promise<void> {
  for (let n = 0; n < 12; n++) await Promise.resolve();
}

describe("document-window protocol", () => {
  let children: ChildBridge[];
  let handles: RemoteSurfaceHandle[];
  let number = 0;
  let uuid = 0;
  const observeState = vi.fn();
  beforeEach(() => {
    observeState.mockClear();
    vi.stubGlobal("BroadcastChannel", MemoryChannel);
    uuid = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` });
    state.vaultRoot = "protocol-vault";
    children = [];
    handles = [];
    number++;
  });
  afterEach(async () => {
    for (const child of children) expect(child.dispose()).toBe(true);
    for (const handle of handles) await handle.dispose();
    expect(MemoryChannel.peers.size).toBe(0);
    state.vaultRoot = "";
    vi.unstubAllGlobals();
  });

  it("conserva l'ultima battuta, aspetta ack e mantiene history remota tipizzata", async () => {
    const doc = `${number}-pending.md`;
    const first = await attachRemoteSurface(doc, state.vaultRoot, PLAIN);
    const second = await attachRemoteSurface(doc, state.vaultRoot, PLAIN);
    handles.push(first.handle, second.handle);
    expect(first.request.session).toBe(second.request.session);
    expect(first.request.channel).not.toBe(second.request.channel);
    let firstText = "";
    let secondText = "";
    const incoming: (TextOperation | null)[] = [];
    children.push(attachChildBridge(first.request, (text) => { firstText = text; }, () => firstText, observeState));
    children.push(attachChildBridge(second.request, (text, operation) => {
      secondText = text;
      incoming.push(operation);
    }, () => secondText, observeState));
    await settle();
    expect([firstText, secondText]).toEqual(["abc", "abc"]);
    const operation = operationFromText(firstText, "a😀bc");
    firstText = "a😀bc";
    children[0].sendEdit(firstText, operation);
    await first.handle.freeze();
    expect(observeState).toHaveBeenCalledWith({ kind: "frozen" });
    await settle();
    expect(documentSessions.text(doc)).toBe("a😀bc");
    expect(secondText).toBe("a😀bc");
    expect(incoming[incoming.length - 1]).toEqual(operation);
    expect(await documentSessions.flush(doc)).toBe(false);
    expect(documentSessions.isDirty(doc)).toBe(false);
  });

  it("preserva BOM, CRLF e offset UTF-16 durante un edit remoto", async () => {
    const doc = `${number}-crlf.md`;
    const { request, handle } = await attachRemoteSurface(doc, state.vaultRoot, PLAIN);
    handles.push(handle);
    let text = "";
    children.push(attachChildBridge(request, (next) => { text = next; }, () => text, observeState));
    await settle();
    expect(text).toBe("\ufeffa\r\nb");
    const after = "\ufeffa\r\nb😀";
    const operation = operationFromText(text.replace(/\r\n/g, "\n"), after.replace(/\r\n/g, "\n"));
    text = after;
    children[0].sendEdit(after, operation);
    await handle.freeze();
    expect(documentSessions.text(doc)).toBe(after);
  });

  it("rifiuta messaggi malformati e replay, senza applicare l'operazione due volte", async () => {
    const doc = `${number}-replay.md`;
    const { request, handle } = await attachRemoteSurface(doc, state.vaultRoot, PLAIN);
    handles.push(handle);
    let text = "";
    children.push(attachChildBridge(request, (value) => { text = value; }, () => text, observeState));
    await settle();
    const attacker = new MemoryChannel(request.channel);
    const id = { v: 1, doc, vault: request.vault, session: request.session, surfaceId: request.surfaceId };
    const malformed = { ...id, kind: "operation", epoch: "old", seq: 1, base: 0, revision: 1,
      operation: { beforeLength: 3, afterLength: 7, edits: [{ from: -1, to: 0, deleted: "", inserted: "BAD!" }] } };
    expect(isRemoteMessage(malformed)).toBe(false);
    attacker.postMessage(malformed);
    const edit = operationFromText(text, "abcd");
    text = "abcd";
    children[0].sendEdit(text, edit);
    await settle();
    expect(documentSessions.text(doc)).toBe("abcd");
    // Replaying the already accepted seq under a stale epoch cannot mutate the owner.
    attacker.postMessage({ ...id, kind: "operation", epoch: "old", seq: 1, base: 0, revision: 1, operation: edit });
    await settle();
    expect(documentSessions.text(doc)).toBe("abcd");
    attacker.close();
  });

  it("mantiene entrambi gli intenti se due superfici cambiano lo stesso intervallo", async () => {
    const doc = `${number}-overlap.md`;
    const first = await attachRemoteSurface(doc, state.vaultRoot, PLAIN);
    const second = await attachRemoteSurface(doc, state.vaultRoot, PLAIN);
    handles.push(first.handle, second.handle);
    let left = "", right = "";
    let conflict = "";
    children.push(attachChildBridge(first.request, (value) => { left = value; }, () => left, observeState));
    children.push(attachChildBridge(second.request, (value) => { right = value; }, () => right,
      (change) => { if (change.kind === "error") conflict = change.reason ?? ""; }));
    await settle();
    const leftEdit = operationFromText(left, "aXc");
    const rightEdit = operationFromText(right, "aYc");
    left = "aXc";
    right = "aYc";
    children[0].sendEdit(left, leftEdit);
    children[1].sendEdit(right, rightEdit);
    await settle();
    expect(documentSessions.text(doc)).toBe("aXc");
    expect(right).toBe("aYc");
    expect(conflict).toMatch(/sovrapposte|Conflitto/);
    expect(children[1].dispose()).toBe(false);
    children[1].resolveConflict("mine");
    await settle();
    expect(documentSessions.text(doc)).toBe("aYc");
    expect(right).toBe("aYc");
  });

  // La finestra a parte non ha IPC: il profilo lo decide il registro della
  // finestra principale prima di aprirla, e un documento senza superficie di
  // testo non apre niente e non lascia un prestito appeso.
  it("porta il profilo risolto e rifiuta un documento che non è testo", async () => {
    const board = `${number}-lavagna.canvas`;
    await expect(attachRemoteSurface(board, state.vaultRoot, () => null)).rejects.toBeInstanceOf(DocumentWindowUnsupported);
    // Nessun prestito appeso e nessun canale aperto: la sessione letta per
    // decidere si può chiudere.
    expect((await documentSessions.release(board)).kind).toBe("closed");
    expect(MemoryChannel.peers.size).toBe(0);

    const doc = `${number}-profilo.md`;
    const opened = await attachRemoteSurface(doc, state.vaultRoot, (source) => `${source.formatId}-${source.sourceKind}`);
    handles.push(opened.handle);
    expect(opened.request.profile).toBe("plain-text");
  });

  it("manda il tema montato al saluto e a ogni cambio, e riporta i link cliccati", async () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.contrast = "normal";
    mount(":root { --x: 1; }", "foglio");
    const doc = `${number}-tema.md`;
    const opened = await attachRemoteSurface(doc, state.vaultRoot, PLAIN);
    handles.push(opened.handle);
    const themes: MirroredTheme[] = [];
    let text = "";
    children.push(attachChildBridge(opened.request, (next) => { text = next; }, () => text, observeState, (theme) => themes.push(theme)));
    await settle();
    expect(themes).toEqual([{ light: "dark", contrast: "normal", layers: [{ layer: "foglio", text: ":root { --x: 1; }" }] }]);

    document.documentElement.dataset.theme = "light";
    mount(":root { --y: 2; }", "pelle");
    emit("theme");
    await settle();
    expect(themes[1]).toEqual({ light: "light", contrast: "normal", layers: [
      { layer: "foglio", text: ":root { --x: 1; }" }, { layer: "pelle", text: ":root { --y: 2; }" },
    ] });

    const navigate = vi.fn();
    setDocumentWindowNavigation({ navigate });
    children[0].navigate({ kind: "wikilink", page: "Altra", heading: null, block: "abc" });
    await settle();
    expect(navigate).toHaveBeenCalledWith({ kind: "wikilink", page: "Altra", heading: null, block: "abc" }, doc);
    setDocumentWindowNavigation(null);

    await opened.handle.dispose();
    handles.pop();
    emit("theme");
    await settle();
    expect(themes).toHaveLength(2);
    for (const el of document.head.querySelectorAll("style[data-fub]")) el.remove();
  });
});
