// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

interface EngineChange {
  readonly text: string;
  readonly operation: unknown;
  readonly origin: string;
}

interface EngineOptions {
  onChange(change: EngineChange): void;
  onSelectionChange(): void;
}

const harness = vi.hoisted(() => ({
  onChange: null as ((change: EngineChange) => void) | null,
  syncDoc: vi.fn(),
  setDoc: vi.fn(),
  undo: vi.fn(() => false),
  redo: vi.fn(() => false),
  getDoc: vi.fn(() => ""),
  focus: vi.fn(),
  revealByteOffset: vi.fn(),
  selections: vi.fn(() => ({
    primary: { start: 0, end: 0, text: "" },
    secondary: [],
  })),
  reconfigure: vi.fn(),
  destroy: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock("../editors/text/engine", () => ({
  createTextEngine: (_parent: HTMLElement, options: EngineOptions) => {
    harness.onChange = options.onChange;
    return {
      setDoc: harness.setDoc,
      syncDoc: harness.syncDoc,
      undo: harness.undo,
      redo: harness.redo,
      getDoc: harness.getDoc,
      focus: harness.focus,
      revealByteOffset: harness.revealByteOffset,
      selections: harness.selections,
      reconfigure: harness.reconfigure,
      destroy: harness.destroy,
      setTheme: harness.setTheme,
    };
  },
}));

import { createEditor, type EditorOptions } from "./editor";

function options(onChange: EditorOptions["onChange"]): EditorOptions {
  return {
    onChange,
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  };
}

describe("adapter legacy dell'editor Markdown", () => {
  it("riduce la modifica dell'engine al testo del contratto legacy", () => {
    const changes: string[] = [];
    const ed = createEditor(document.createElement("div"), options((text: string) => changes.push(text)));

    harness.onChange?.({
      text: "testo aggiornato",
      operation: { beforeLength: 0, afterLength: 16, edits: [] },
      origin: "input",
    });

    expect(changes).toEqual(["testo aggiornato"]);
    ed.destroy();
  });

  it("inoltra al motore la firma stringa di syncDoc", () => {
    const ed = createEditor(document.createElement("div"), options(() => {}));

    ed.syncDoc("testo remoto");

    expect(harness.syncDoc).toHaveBeenCalledWith("testo remoto");
    ed.destroy();
  });
});
