// @vitest-environment happy-dom
// La superficie su un tratto con tre editor veri: due riquadri interi e una
// trasclusione, ognuno col suo `TextEngine` e la sua cronologia nativa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { createTextEngine, type TextEngine } from "./engine";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../state/document-session";
import type { DocumentSource } from "../../host/contract";
import { RangeSurface } from "../core/range-surface";

const NOTE = "# Diario\n\n## Riunione\n\nPunto uno.\n\n## Altro\n\nFine.\n";

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

interface Mounted {
  readonly engine: TextEngine;
  readonly view: EditorView;
}

function mount(text: string, onChange: Parameters<typeof createTextEngine>[1]["onChange"]): Mounted {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const engine = createTextEngine(parent, { onChange, onSelectionChange: () => {} });
  engine.setDoc(text);
  const view = EditorView.findFromDOM(parent);
  if (!view) throw new Error("editor non montato");
  return { engine, view };
}

/// Una battuta come la fa la persona: una transazione che la cronologia registra.
function type(view: EditorView, at: number, insert: string): void {
  view.dispatch({ changes: { from: at, insert }, userEvent: "input.type" });
}

describe("la superficie su un tratto con editor veri", () => {
  const engines: TextEngine[] = [];

  beforeEach(() => {
    vi.stubGlobal("setTimeout", vi.fn(() => 1));
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  afterEach(() => {
    for (const engine of engines.splice(0)) engine.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function setup() {
    const sessions = new DocumentSessionCollection(fakeApi(NOTE));
    await sessions.read("nota.md");
    const session = sessions.get("nota.md")!;
    const pane = (id: string): Mounted => {
      const mounted = mount(session.text(), (change) => {
        expect(sessions.acceptSurfaceChange("nota.md", id, change)).toEqual({ kind: "accepted" });
      });
      engines.push(mounted.engine);
      sessions.attachSurface("nota.md", { id, sync: (update) => mounted.engine.syncDoc(update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text) });
      return mounted;
    };
    const a = pane("riquadro-a");
    const b = pane("riquadro-b");
    const range = RangeSurface.open(session, { id: "trasclusione", anchor: { kind: "heading", heading: "Riunione" } })!;
    const inner = mount(range.text(), (change) => {
      expect(range.write(change)).toEqual({ kind: "accepted" });
    });
    engines.push(inner.engine);
    range.connect({ sync: (update) => inner.engine.syncDoc(update), setReadOnly: (readOnly) => inner.engine.setReadOnly(readOnly) });
    return { sessions, a, b, range, inner };
  }

  it("le modifiche si scambiano fra tre editor e l'annulla di ognuno resta suo", async () => {
    const { sessions, a, b, range, inner } = await setup();

    // La trasclusione scrive in fondo al suo tratto.
    type(inner.view, inner.view.state.doc.length, " Detto qui.");
    // A scrive dentro lo stesso tratto, B nella sezione dopo.
    type(a.view, a.view.state.doc.toString().indexOf("Punto uno."), "Prima. ");
    type(b.view, b.view.state.doc.length, "Coda.\n");

    const all = "# Diario\n\n## Riunione\n\nPrima. Punto uno. Detto qui.\n\n## Altro\n\nFine.\nCoda.\n";
    expect(sessions.text("nota.md")).toBe(all);
    expect(a.engine.getDoc()).toBe(all);
    expect(b.engine.getDoc()).toBe(all);
    expect(inner.engine.getDoc()).toBe("## Riunione\n\nPrima. Punto uno. Detto qui.");

    // L'annulla della trasclusione toglie soltanto la sua battuta.
    expect(inner.engine.undo()).toBe(true);
    const undone = "# Diario\n\n## Riunione\n\nPrima. Punto uno.\n\n## Altro\n\nFine.\nCoda.\n";
    expect(sessions.text("nota.md")).toBe(undone);
    expect(a.engine.getDoc()).toBe(undone);
    expect(b.engine.getDoc()).toBe(undone);
    expect(inner.engine.getDoc()).toBe("## Riunione\n\nPrima. Punto uno.");
    // E non ha altro: le battute di A e B non sono sue.
    expect(inner.engine.undo()).toBe(false);
    expect(sessions.text("nota.md")).toBe(undone);

    // L'annulla di A toglie la sua, che la trasclusione riceve.
    expect(a.engine.undo()).toBe(true);
    expect(inner.engine.getDoc()).toBe("## Riunione\n\nPunto uno.");
    expect(range.status()).toBe("live");
    range.destroy();
  });

  it("il titolo rinominato in un riquadro mette la trasclusione in sola lettura", async () => {
    const { a, range, inner } = await setup();
    const at = a.view.state.doc.toString().indexOf("Riunione");
    a.view.dispatch({ changes: { from: at, to: at + "Riunione".length, insert: "Incontro" }, userEvent: "input.type" });

    expect(range.status()).toBe("lost");
    expect(inner.view.state.readOnly).toBe(true);
    expect(inner.engine.getDoc()).toBe("## Riunione\n\nPunto uno.");
    range.destroy();
  });
});
