// @vitest-environment happy-dom
// Il testo scritto in una cella della griglia entra nella sessione del
// documento mentre si scrive, come ogni battuta del testo: buffer, sporco,
// bozza. Prima arrivava soltanto all'uscita dalla cella, e una chiusura non
// pulita lo perdeva con la barra ferma su «Salvato» (IMP-6100).
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { DocumentSessionCollection, DRAFT_MS, type DocumentSessionApi } from "../../../../state/document-session";
import type { DocumentSource } from "../../../../host/contract";
import { mountMarkdownSurface, type MarkdownSurface } from "./surface";

const NOTE = "Paragrafo.\n\n| A | B |\n| --- | --- |\n|  |  |\n";
const ID = "notes/tabella.md";

function fakeApi(text: string): DocumentSessionApi {
  const api: DocumentSessionApi = {
    readDocument: vi.fn(async (): Promise<DocumentSource> => ({ text, revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" })),
    openDocument: vi.fn((id: string) => api.readDocument(id)),
    writeDocument: vi.fn(async () => "rev-2"),
    resourceWrite: vi.fn(async () => ({ revision: "rev-byte" })),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
    documentClosed: vi.fn(async () => {}),
  };
  return api;
}

const mounted: { ed: MarkdownSurface; parent: HTMLElement }[] = [];

afterEach(() => {
  for (const { ed, parent } of mounted.splice(0)) {
    ed.destroy();
    parent.remove();
  }
  vi.useRealTimers();
});

async function setup() {
  const api = fakeApi(NOTE);
  const sessions = new DocumentSessionCollection(api);
  await sessions.read(ID);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: ID, parent }, {
    onChange: (change) => {
      expect(sessions.acceptSurfaceChange(ID, "riquadro", change)).toEqual({ kind: "accepted" });
    },
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  mounted.push({ ed, parent });
  ed.buffer.setDoc(sessions.text(ID)!);
  sessions.attachSurface(ID, {
    id: "riquadro",
    sync: (update) => ed.buffer.syncDoc(update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text),
  });
  const view = EditorView.findFromDOM(parent)!;
  const grid = parent.querySelector<HTMLElement>(".tb-grid")!;
  return { api, sessions, ed, parent, view, grid };
}

function press(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/// Una lettera scritta nel campo della cella, come la scrive il browser.
function typeInto(input: HTMLInputElement, text: string): void {
  for (const char of text) {
    input.value += char;
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: char, bubbles: true }));
  }
}

function cellInput(parent: HTMLElement): HTMLInputElement {
  const input = parent.querySelector<HTMLInputElement>(".tb-input");
  if (!input) throw new Error("nessuna cella aperta");
  return input;
}

describe("la cella della griglia e la sessione del documento", () => {
  it("ogni battuta nella cella arriva al buffer e sporca la sessione prima di uscire", async () => {
    const { sessions, ed, parent, grid } = await setup();
    grid.focus();
    press(grid, "ArrowDown");
    // «P» sulla cella scelta la apre e comincia a scrivere.
    press(grid, "P");
    const input = cellInput(parent);
    typeInto(input, "rova");
    // La cella è ancora aperta: nessuna uscita, nessun Invio.
    expect(parent.querySelector(".tb-input")).toBe(input);
    const row = (text: string) => `Paragrafo.\n\n| A | B |\n| --- | --- |\n| ${text} |  |\n`;
    expect(ed.buffer.getDoc()).toBe(row("Prova"));
    expect(sessions.text(ID)).toBe(row("Prova"));
    expect(sessions.get(ID)!.dirty).toBe(true);
    // Il campo resta lo stesso, col cursore in fondo: si continua a scrivere.
    expect(document.activeElement).toBe(input);
    typeInto(input, " cella");
    expect(sessions.text(ID)).toBe(row("Prova cella"));
    expect(parent.querySelector(".tb-input")).toBe(input);
  });

  it("il salvataggio parte mentre la cella è aperta, e solo allora la sessione è pulita", async () => {
    const { api, sessions, parent, grid } = await setup();
    vi.useFakeTimers();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "X");
    typeInto(cellInput(parent), "yz");
    expect(sessions.get(ID)!.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(DRAFT_MS + 50);
    // La cadenza della sessione ha portato al file il testo della cella
    // ancora aperta: «Salvato» adesso dice il vero.
    expect(api.writeDocument).toHaveBeenCalled();
    expect(vi.mocked(api.writeDocument).mock.lastCall![1]).toBe("Paragrafo.\n\n| A | B |\n| --- | --- |\n| Xyz |  |\n");
    expect(sessions.get(ID)!.dirty).toBe(false);
    expect(parent.querySelector(".tb-input")).not.toBeNull();
  });

  it("Escape rimette la tabella di prima, byte per byte", async () => {
    const { sessions, parent, grid } = await setup();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "Q");
    const input = cellInput(parent);
    typeInto(input, "ui");
    expect(sessions.text(ID)).toContain("| Qui |");
    press(input, "Escape");
    expect(parent.querySelector(".tb-input")).toBeNull();
    expect(sessions.text(ID)).toBe(NOTE);
  });

  it("la conferma registra le battute della cella in un solo passo d'annulla", async () => {
    const { sessions, ed, parent, grid } = await setup();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "U");
    const input = cellInput(parent);
    typeInto(input, "no");
    press(input, "Tab");
    expect(sessions.text(ID)).toBe("Paragrafo.\n\n| A | B |\n| --- | --- |\n| Uno |  |\n");
    // Una sola battuta di annulla toglie la parola intera.
    expect(ed.undo()).toBe(true);
    expect(sessions.text(ID)).toBe(NOTE);
    expect(ed.undo()).toBe(false);
    expect(ed.redo()).toBe(true);
    expect(sessions.text(ID)).toBe("Paragrafo.\n\n| A | B |\n| --- | --- |\n| Uno |  |\n");
  });
});
