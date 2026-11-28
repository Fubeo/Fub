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

async function setup(note = NOTE) {
  const api = fakeApi(note);
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

  it("ogni riga aggiunta col Tab si toglie con un annulla, il primo compreso (IMP-6105)", async () => {
    const { sessions, ed, parent, view } = await setup();
    const rows = (text: string) => text.split("\n").filter((line) => line.startsWith("|")).length;
    expect(rows(sessions.text(ID)!)).toBe(3);
    // Come col mouse: il clic sulla prima cella la sceglie.
    const first = parent.querySelector<HTMLElement>(".tb-grid .tb-cell")!;
    first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    first.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
    first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    // Quattro celle: tre Tab vanno all'ultima, il quarto aggiunge una riga;
    // due Tab la attraversano e il terzo ne aggiunge un'altra.
    for (let n = 0; n < 7; n++) press(document.activeElement as HTMLElement, "Tab");
    expect(rows(sessions.text(ID)!)).toBe(5);
    // Il clic fuori dalla tabella, poi Ctrl+Z.
    view.focus();
    expect(ed.undo()).toBe(true);
    expect(rows(sessions.text(ID)!)).toBe(4);
    expect(ed.undo()).toBe(true);
    expect(rows(sessions.text(ID)!)).toBe(3);
    expect(sessions.text(ID)).toBe(NOTE);
  });

  // Le battute della cella stavano fuori dalla cronologia e la conferma le
  // toglieva rimettendo la tabella intera: l'annulla di un passo di prima che
  // copre la tabella non la toglieva più, e la lasciava incollata al testo
  // («/tabella 9x3| Colonna 1 |…», IMP-6105).
  describe("l'annulla dei passi di prima della cella (IMP-6105)", () => {
    const BEFORE = "Paragrafo.\n/tabella\n";
    const TABLE = "| A | B |\n| --- | --- |\n|  |  |\n";
    const ONE = "Paragrafo.\n| A | B |\n| --- | --- |\n| Uno |  |\n";

    /// «/tabella» diventa la tabella con un passo d'annulla dell'editor.
    async function inserted() {
      const made = await setup(BEFORE);
      made.view.dispatch({ changes: { from: 11, to: 20, insert: TABLE }, userEvent: "input" });
      expect(made.sessions.text(ID)).toBe(`Paragrafo.\n${TABLE}`);
      const grid = made.parent.querySelector<HTMLElement>(".tb-grid")!;
      grid.focus();
      press(grid, "ArrowDown");
      return { ...made, grid };
    }

    it("dopo la conferma della cella, il secondo annulla toglie la tabella intera", async () => {
      const { sessions, ed, parent, grid } = await inserted();
      press(grid, "U");
      typeInto(cellInput(parent), "no");
      press(cellInput(parent), "Tab");
      expect(sessions.text(ID)).toBe(ONE);
      expect(ed.undo()).toBe(true);
      expect(sessions.text(ID)).toBe(`Paragrafo.\n${TABLE}`);
      expect(ed.undo()).toBe(true);
      expect(sessions.text(ID)).toBe(BEFORE);
      expect(ed.buffer.getDoc()).toBe(BEFORE);
      // Il ripeti rimette i due passi, nello stesso ordine.
      expect(ed.redo()).toBe(true);
      expect(sessions.text(ID)).toBe(`Paragrafo.\n${TABLE}`);
      expect(ed.redo()).toBe(true);
      expect(sessions.text(ID)).toBe(ONE);
    });

    it("una cella lasciata con Escape non resta da nessuna parte: l'annulla toglie la tabella", async () => {
      const { sessions, ed, parent, grid } = await inserted();
      press(grid, "Q");
      typeInto(cellInput(parent), "ui");
      press(cellInput(parent), "Escape");
      expect(sessions.text(ID)).toBe(`Paragrafo.\n${TABLE}`);
      expect(ed.undo()).toBe(true);
      expect(sessions.text(ID)).toBe(BEFORE);
      expect(ed.undo()).toBe(false);
    });

    it("dopo Escape, Ripeti rimette le battute lasciate, una alla volta", async () => {
      const { sessions, ed, parent, grid } = await inserted();
      press(grid, "Q");
      typeInto(cellInput(parent), "u");
      press(cellInput(parent), "Escape");
      expect(ed.redo()).toBe(true);
      expect(sessions.text(ID)).toBe("Paragrafo.\n| A | B |\n| --- | --- |\n| Q |  |\n");
      expect(ed.redo()).toBe(true);
      expect(sessions.text(ID)).toBe("Paragrafo.\n| A | B |\n| --- | --- |\n| Qu |  |\n");
      expect(ed.redo()).toBe(false);
    });

    it("due celle confermate sono due passi, poi viene la tabella", async () => {
      const { sessions, ed, parent, grid } = await inserted();
      press(grid, "U");
      typeInto(cellInput(parent), "no");
      press(cellInput(parent), "Tab");
      press(document.activeElement as HTMLElement, "D");
      typeInto(cellInput(parent), "ue");
      press(cellInput(parent), "Enter");
      expect(sessions.text(ID)).toBe("Paragrafo.\n| A | B |\n| --- | --- |\n| Uno | Due |\n");
      expect(ed.undo()).toBe(true);
      expect(sessions.text(ID)).toBe(ONE);
      expect(ed.undo()).toBe(true);
      expect(sessions.text(ID)).toBe(`Paragrafo.\n${TABLE}`);
      expect(ed.undo()).toBe(true);
      expect(sessions.text(ID)).toBe(BEFORE);
    });
  });
});
