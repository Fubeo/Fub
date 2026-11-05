// @vitest-environment happy-dom
// Il testo di una scheda prima della sua pausa e le bozze di recupero (A17):
// la tela vera (motore + nucleo .wasm) attaccata alla sessione vera, su un
// host finto che tiene file e bozze, con l'orologio finto.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DRAFT_MS, DocumentSessionCollection, type DocumentSessionApi } from "./document-session";
import { toRecover } from "./drafts";
import type { DocumentSource, DraftInfo } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import { CARD_PAUSE_MS } from "../editors/canvas/engine";
import { mountCanvasSurface } from "../editors/canvas/surface";
import { canvasCoreReady, openCoreNow } from "../editors/canvas/wasm/core";

const BOARD = "board.canvas";

function boardSource(): string {
  return JSON.stringify({
    nodes: [
      { id: "t", type: "text", x: 40, y: 40, width: 240, height: 140, text: "" },
      { id: "u", type: "text", x: 400, y: 40, width: 240, height: 140, text: "" },
    ],
    edges: [],
  });
}

interface Draft {
  readonly text: string;
  readonly base: string | null;
  readonly at: number;
}

/** Un host che ricorda file, revisioni e bozze, e le conta. */
function fakeHost(files: Record<string, string>) {
  const disk = new Map(Object.entries(files));
  const revisions = new Map([...disk.keys()].map((id) => [id, 1]));
  const drafts = new Map<string, Draft>();
  const draftLog: Array<Draft & { readonly doc: string }> = [];
  const writes: Array<{ readonly doc: string; readonly text: string }> = [];
  const revision = (id: string): string => `rev-${revisions.get(id) ?? 0}`;
  const api: DocumentSessionApi = {
    readDocument: async (id): Promise<DocumentSource> => ({
      text: disk.get(id) ?? "",
      revision: revision(id),
      format_id: "canvas",
      source_kind: "text",
      text_kind: "source",
    }),
    writeDocument: async (id, text) => {
      writes.push({ doc: id, text });
      disk.set(id, text);
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
      return revision(id);
    },
    resourceWrite: async () => ({ revision: "rev-byte" }),
    saveDraft: async (id, text, base) => {
      const draft = { text, base, at: Date.now() };
      drafts.set(id, draft);
      draftLog.push({ doc: id, ...draft });
    },
    discardDraft: async (id) => {
      drafts.delete(id);
    },
    // La chiave di apertura non conta qui: aprire è leggere, chiudere niente.
    openDocument: (id, _open, ...vault) => api.readDocument(id, ...vault),
    documentClosed: async () => {},
  };
  const listDrafts = (): DraftInfo[] =>
    [...drafts].map(([doc, draft]) => ({
      doc,
      at: draft.at,
      base: draft.base,
      exists: disk.has(doc),
      current: disk.has(doc) ? revision(doc) : null,
      text: draft.text,
    }));
  return { api, disk, drafts, draftLog, writes, listDrafts };
}

interface Pane {
  readonly surface: EditorSurface;
  readonly parent: HTMLElement;
  detach(): void;
}

/** Monta la tela e la attacca alla sessione come fa il controller. */
async function openPane(sessions: DocumentSessionCollection, paneId: string): Promise<Pane> {
  const text = await sessions.read(BOARD);
  const parent = document.createElement("div");
  document.body.append(parent);
  const surface = mountCanvasSurface("canvas", { paneId, documentId: BOARD, parent }, {
    onChange: (pane, change) => {
      sessions.acceptSurfaceChange(BOARD, pane, change);
    },
    onSelectionChange: () => {},
  });
  const buffer = surface.buffer!;
  buffer.setDoc(text);
  const dispose = sessions.attachSurface(BOARD, {
    id: paneId,
    sync: (update) => buffer.syncDoc(update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text),
    pendingText: () => buffer.pendingText?.() ?? null,
    commitPending: () => buffer.commitPending?.(),
    watchPending: (listener) => buffer.watchPending!(listener),
  });
  return {
    surface,
    parent,
    detach: () => {
      buffer.commitPending?.();
      dispose();
    },
  };
}

function openField(parent: HTMLElement, id: string): HTMLTextAreaElement {
  parent.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  return parent.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
}

function type(input: HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function cardOf(text: string, id = "t"): string | undefined {
  const core = openCoreNow(text);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return core.model().nodes.find((node) => node.id === id)?.text;
  } finally {
    core.close();
  }
}

beforeAll(async () => {
  await canvasCoreReady();
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("il testo di una scheda nelle bozze di recupero", () => {
  it("3 s di tasti a 100 ms in una scheda: tre bozze col testo del campo di quel momento, nessuna scrittura del file", async () => {
    const host = fakeHost({ [BOARD]: boardSource() });
    const sessions = new DocumentSessionCollection(host.api);
    const pane = await openPane(sessions, "p");
    const input = openField(pane.parent, "t");
    const field = new Map<number, string>();
    const saveDraft = host.api.saveDraft;
    host.api.saveDraft = async (...args) => {
      field.set(host.draftLog.length, input.value);
      await saveDraft(...args);
    };
    const start = Date.now();
    for (let key = 0; key < 30; key++) {
      type(input, `${input.value}${key % 10}`);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(Date.now() - start).toBe(3_000);
    expect(host.draftLog).toHaveLength(3);
    host.draftLog.forEach((draft, index) => {
      expect(cardOf(draft.text)).toBe(field.get(index));
      expect(draft.base).toBe("rev-1");
    });
    expect(host.draftLog.map((draft) => cardOf(draft.text)!.length)).toEqual([10, 20, 30]);
    expect(host.writes).toHaveLength(0);
    expect(sessions.isDirty(BOARD)).toBe(false);
    pane.surface.destroy();
  });

  it("chiusura brusca durante la pausa: la sessione nuova offre la bozza con «Ciao mondo» e la rimette nella lavagna", async () => {
    const host = fakeHost({ [BOARD]: boardSource() });
    const sessions = new DocumentSessionCollection(host.api);
    const pane = await openPane(sessions, "p");
    const input = openField(pane.parent, "t");
    const typed: Array<{ readonly at: number; readonly text: string }> = [];
    const start = Date.now();
    for (const char of "Ciao mondo") {
      type(input, input.value + char);
      typed.push({ at: Date.now() - start, text: input.value });
      await vi.advanceTimersByTimeAsync(100);
    }
    // A 1 s la bozza è partita, e la pausa della scheda non è finita.
    expect(Date.now() - start).toBe(1_000);
    expect(host.draftLog).toHaveLength(1);
    expect(cardOf(pane.surface.buffer!.getDoc())).toBe("");
    await vi.advanceTimersByTimeAsync(100);
    expect(Date.now() - start).toBe(1_100);
    expect(host.writes).toHaveLength(0);
    // Il processo muore: niente si chiude, nessun timer arriva in fondo.
    vi.clearAllTimers();
    document.body.replaceChildren();

    const next = new DocumentSessionCollection(host.api);
    const offered = toRecover(host.listDrafts());
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ doc: BOARD, base: "rev-1", current: "rev-1" });
    expect(cardOf(offered[0]!.text)).toBe("Ciao mondo");
    const reopened = await openPane(next, "p");
    next.restore(BOARD, offered[0]!.text, { kind: "descends_from", value: offered[0]!.base! });
    expect(cardOf(reopened.surface.buffer!.getDoc())).toBe("Ciao mondo");
    expect(next.isDirty(BOARD)).toBe(true);

    // Ciò che si è scritto dopo l'ultima bozza: al più DRAFT_MS di tasti.
    const lastDraft = host.draftLog[host.draftLog.length - 1]!.at - start;
    const lost = typed.filter((key) => key.at > lastDraft);
    expect(lost.length * 100).toBeLessThanOrEqual(DRAFT_MS);
    expect(lost).toHaveLength(0);
    reopened.surface.destroy();
  });

  it("due riquadri con testo tenuto: si registrano entrambi, poi la bozza è il testo della sessione", async () => {
    const host = fakeHost({ [BOARD]: boardSource() });
    const sessions = new DocumentSessionCollection(host.api);
    const left = await openPane(sessions, "a");
    const right = await openPane(sessions, "b");
    type(openField(left.parent, "t"), "Sinistra");
    // Due campi aperti insieme, come in due finestre: il fuoco non passa dall'uno all'altro.
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    type(openField(right.parent, "u"), "Destra");
    focus.mockRestore();
    await vi.advanceTimersByTimeAsync(CARD_PAUSE_MS - 50);
    expect(sessions.isDirty(BOARD)).toBe(false);
    // Un'altra battuta in ciascuno, e la cadenza della bozza arriva prima della pausa.
    await vi.advanceTimersByTimeAsync(DRAFT_MS - CARD_PAUSE_MS);
    type(left.parent.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!, "Sinistra!");
    type(right.parent.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!, "Destra!");
    await vi.advanceTimersByTimeAsync(100);
    expect(host.draftLog).toHaveLength(1);
    const draft = host.draftLog[0]!.text;
    expect(cardOf(draft, "t")).toBe("Sinistra!");
    expect(cardOf(draft, "u")).toBe("Destra!");
    expect(sessions.text(BOARD)).toBe(draft);
    expect(left.surface.buffer!.getDoc()).toBe(draft);
    expect(right.surface.buffer!.getDoc()).toBe(draft);
    left.surface.destroy();
    right.surface.destroy();
  });

  it("un salvataggio riuscito non butta la bozza se resta testo tenuto", async () => {
    const host = fakeHost({ [BOARD]: boardSource() });
    const discard = vi.spyOn(host.api, "discardDraft");
    const sessions = new DocumentSessionCollection(host.api);
    const pane = await openPane(sessions, "p");
    const input = openField(pane.parent, "t");
    type(input, "Primo");
    await vi.advanceTimersByTimeAsync(CARD_PAUSE_MS);
    expect(sessions.isDirty(BOARD)).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    type(input, "Primo e");
    // Il salvataggio di «Primo» arriva mentre « e» è ancora nel campo.
    await vi.advanceTimersByTimeAsync(100);
    expect(host.writes.map((write) => cardOf(write.text))).toEqual(["Primo"]);
    expect(sessions.isDirty(BOARD)).toBe(false);
    for (const text of ["Primo e se", "Primo e secon", "Primo e secondo"]) {
      await vi.advanceTimersByTimeAsync(50);
      type(input, text);
      await vi.advanceTimersByTimeAsync(50);
    }
    // La cadenza arriva a 1 s, con la sessione pulita e il testo ancora nel campo.
    await vi.advanceTimersByTimeAsync(100);
    expect(sessions.isDirty(BOARD)).toBe(false);
    expect(discard).not.toHaveBeenCalled();
    const draft = host.drafts.get(BOARD);
    expect(draft && cardOf(draft.text)).toBe("Primo e secondo");
    expect(draft?.base).toBe("rev-2");
    pane.surface.destroy();
  });

  it("il testo che il nucleo non prende: la bozza tiene l'ultimo testo accettato, e il registro lo dice", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const host = fakeHost({ [BOARD]: boardSource() });
      const sessions = new DocumentSessionCollection(host.api);
      const pane = await openPane(sessions, "p");
      const input = openField(pane.parent, "t");
      for (const char of "Ciao mondo") {
        type(input, input.value + char);
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(host.draftLog).toHaveLength(1);
      expect(cardOf(host.drafts.get(BOARD)!.text)).toBe("Ciao mondo");
      type(input, "x".repeat(1_048_577));
      await vi.advanceTimersByTimeAsync(DRAFT_MS);
      expect(host.draftLog).toHaveLength(1);
      expect(cardOf(host.drafts.get(BOARD)!.text)).toBe("Ciao mondo");
      expect(warn).toHaveBeenCalled();
      expect(host.writes).toHaveLength(0);
      pane.surface.destroy();
    } finally {
      warn.mockRestore();
    }
  });

  it("chiudere la finestra durante la pausa registra il testo, e un cambio esterno nella pausa è un conflitto", async () => {
    const host = fakeHost({ [BOARD]: boardSource() });
    const sessions = new DocumentSessionCollection(host.api);
    const pane = await openPane(sessions, "p");
    type(openField(pane.parent, "t"), "Prima di chiudere");
    expect(await sessions.flushBeforeClose()).toEqual([]);
    expect(cardOf(host.disk.get(BOARD)!)).toBe("Prima di chiudere");

    type(pane.parent.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!, "Mio testo");
    host.disk.set(BOARD, boardSource().replace('"text":""', '"text":"da fuori"'));
    const outcome = await sessions.handleExternalChange(BOARD, { actor: { kind: "watcher" }, batch: null });
    expect(outcome).toEqual({ kind: "warning", cause: "altra_app" });
    expect(sessions.isDirty(BOARD)).toBe(true);
    expect(cardOf(sessions.text(BOARD)!)).toBe("Mio testo");
    pane.surface.destroy();
  });

  it("una superficie distrutta fra l'avviso e la bozza non lascia testo tenuto", async () => {
    const host = fakeHost({ [BOARD]: boardSource() });
    const sessions = new DocumentSessionCollection(host.api);
    const pane = await openPane(sessions, "p");
    type(openField(pane.parent, "t"), "Quasi");
    pane.detach();
    pane.surface.destroy();
    expect(sessions.get(BOARD)!.hasPending()).toBe(false);
    expect(cardOf(sessions.text(BOARD)!)).toBe("Quasi");
    expect(sessions.isDirty(BOARD)).toBe(true);
    // La bozza armata dall'avviso trova il testo nella sessione, non nella superficie.
    await vi.advanceTimersByTimeAsync(DRAFT_MS);
    expect(host.writes.map((write) => cardOf(write.text))).toEqual(["Quasi"]);
    expect(sessions.isDirty(BOARD)).toBe(false);
  });
});
