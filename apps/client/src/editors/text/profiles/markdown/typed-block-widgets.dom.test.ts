// @vitest-environment happy-dom
// Una formula `$$` o un diagramma mermaid scritti a mano in fondo alla nota,
// tasto per tasto come la tastiera: la Live tiene un solo disegno accanto
// alla sorgente, non uno per ogni battuta (IMP-6101, IMP-6102).
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import type { SettingEntry } from "../../../../host/contract";
import { settings } from "../../../../host/query";
import { mountMarkdownSurface, type MarkdownSurface } from "./surface";

vi.mock("../../../../host/query", () => ({ settings: vi.fn() }));
vi.mock("katex", () => ({ default: { render(tex: string, el: HTMLElement) { el.textContent = `«${tex}»`; } } }));
vi.mock("katex/dist/katex.min.css", () => ({}));

function toggle(key: string, value: boolean): SettingEntry {
  return {
    spec: { key, label: key, description: "", group: "Editor", scope: "machine", kind: { kind: "toggle", default: true }, program_writable: false },
    value,
    source: "machine",
  };
}

const mounted: { ed: MarkdownSurface; parent: HTMLElement }[] = [];
afterEach(() => {
  for (const note of mounted.splice(0)) {
    note.ed.destroy();
    note.parent.remove();
  }
  vi.mocked(settings).mockReset();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function note(doc: string): Promise<{ view: EditorView; ed: MarkdownSurface; parent: HTMLElement }> {
  vi.mocked(settings).mockResolvedValue([toggle("editor.vim", false)]);
  const parent = document.createElement("div");
  document.body.append(parent);
  const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: "Nota.md", parent }, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  mounted.push({ ed, parent });
  ed.buffer.setDoc(doc);
  await settle();
  await settle();
  const view = EditorView.findFromDOM(parent)!;
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  return { view, ed, parent };
}

/// Un tasto alla volta: i tasti della Live, poi i gestori della battuta,
/// poi la battuta, come fa CodeMirror con la tastiera.
async function type(view: EditorView, text: string, each?: () => void): Promise<void> {
  for (const ch of text) {
    const key = ch === "\n" ? "Enter" : ch;
    if (!runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor")) {
      const { from, to } = view.state.selection.main;
      const insert = () => view.state.update(view.state.replaceSelection(ch), { userEvent: "input.type", scrollIntoView: true });
      if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, ch, insert))) view.dispatch(insert());
    }
    await settle();
    each?.();
  }
}

describe("i disegni accanto alla sorgente scritta a mano in fondo alla nota", () => {
  it("la formula `$$` ha un solo disegno mentre si scrive, e nessun residuo dopo Invio", async () => {
    const { view, ed, parent } = await note("Paragrafo.\n\n");
    let most = 0;
    await type(view, "$$c = \\frac{ordini}{visite}$$", () => {
      most = Math.max(most, parent.querySelectorAll(".cm-fub-math-live").length);
    });
    expect(most).toBeLessThanOrEqual(1);
    await type(view, "\n");
    expect(ed.buffer.getDoc()).toBe("Paragrafo.\n\n$$c = \\frac{ordini}{visite}$$\n");
    // Fuori dal blocco la formula è resa una volta sola, senza LaTeX a metà.
    expect(parent.querySelectorAll(".cm-fub-math-live").length).toBe(0);
    const blocks = [...parent.querySelectorAll<HTMLElement>(".cm-content .math-block")];
    expect(blocks.map((block) => block.dataset.tex)).toEqual(["c = \\frac{ordini}{visite}"]);
  });

  it("il diagramma mermaid ha un solo disegno mentre si scrive", async () => {
    const { view, ed, parent } = await note("Paragrafo.\n\n");
    let most = 0;
    await type(view, "```mermaid\nflowchart TD\nA[Start] --> B[End]", () => {
      most = Math.max(most, parent.querySelectorAll(".cm-fub-diagram-live").length);
    });
    expect(ed.buffer.getDoc()).toContain("flowchart TD\nA[Start] --> B[End]");
    expect(most).toBeLessThanOrEqual(1);
    expect(parent.querySelectorAll(".cm-fub-diagram-live").length).toBeLessThanOrEqual(1);
  });
});
