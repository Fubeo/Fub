// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { acceptCompletion, completionStatus, currentCompletions, setSelectedCompletion, startCompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine } from "../../engine";
import { markdownCompletions } from "./completions";
import type { VaultBlockPort } from "./blocks/vault-blocks";
import { markdownGrammar } from "./grammar";

function editor() {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [
      markdown({ base: markdownGrammar }),
      markdownCompletions({
        searchNotes: async () => [],
        listTags: async () => [{ name: "progetti/fub/alfa", count: 1 }],
      }),
    ],
  });
  const view = EditorView.findFromDOM(parent)!;
  return { engine, view };
}

function tab(view: EditorView): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
}

async function popup(view: EditorView): Promise<void> {
  startCompletion(view);
  await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
}

function escape(view: EditorView): boolean {
  return view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

describe("Esc e il completamento", () => {
  it("con un completamento ancora in attesa, senza menu a vista, Esc passa a chi ospita l'editor", () => {
    const { engine, view } = editor();
    try {
      engine.setDoc("");
      view.dispatch({ changes: { from: 0, insert: "Riletta" }, selection: EditorSelection.cursor(7), userEvent: "input.type" });
      expect(completionStatus(view.state)).toBe("pending");
      // Non prevenuto: la sbirciata lo riceve libero e si chiude.
      expect(escape(view)).toBe(true);
      expect(completionStatus(view.state)).toBeNull();
    } finally {
      engine.destroy();
    }
  });

  it("col menu a vista Esc lo chiude e resta dell'editor", async () => {
    const { engine, view } = editor();
    try {
      engine.setDoc("nota #pro");
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      await popup(view);
      expect(escape(view)).toBe(false);
      expect(completionStatus(view.state)).toBeNull();
    } finally {
      engine.destroy();
    }
  });
});

describe("Tab nel completamento dei tag", () => {
  it("completa un segmento alla volta e tiene aperto il popup; senza popup rientra", async () => {
    const { engine, view } = editor();
    try {
      engine.setDoc("nota #pro");
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      await popup(view);
      tab(view);
      expect(engine.getDoc()).toBe("nota #progetti/");
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
      tab(view);
      expect(engine.getDoc()).toBe("nota #progetti/fub/");
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      tab(view);
      expect(engine.getDoc()).toBe("nota #progetti/fub/alfa");
      expect(completionStatus(view.state)).toBeNull();
      engine.setDoc("riga");
      view.dispatch({ selection: EditorSelection.cursor(0) });
      tab(view);
      expect(engine.getDoc()).not.toBe("riga");
      expect(engine.getDoc().trim()).toBe("riga");
    } finally {
      engine.destroy();
    }
  });
});

// `[[^^parole` (E13, T31): la scelta dà l'id al blocco se manca e scrive
// `[[Nota#^id]]`; se l'id non si scrive, il link non si scrive. La porta è
// finta: il comando vero lo provano `fub-features` (`sync_block_tests.rs`).
describe("[[^^ cerca i blocchi del vault", () => {
  const RIUNIONE = "# Riunione\n\nLe chiavi le tiene Sara.\n\n- Chiavi di riserva ^riserva\n- Altro\n";

  function vaultEditor(port: Partial<VaultBlockPort>) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const full: VaultBlockPort = {
      notes: vi.fn(async () => [{ doc: "Riunioni/Riunione.md", text: RIUNIONE }]),
      current: () => "Diario.md",
      source: vi.fn(async () => RIUNIONE),
      giveId: vi.fn(async () => null),
      notify: vi.fn(),
      ...port,
    };
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        markdownCompletions({ searchNotes: async () => [], listTags: async () => [], vaultBlocks: full }),
      ],
    });
    const view = EditorView.findFromDOM(parent)!;
    return { engine, view, port: full };
  }

  /// Scrive `typed`, aspetta il menu e sceglie la voce `label`.
  async function choose(view: EditorView, engine: ReturnType<typeof createTextEngine>, typed: string, label: string): Promise<void> {
    engine.setDoc(typed);
    view.dispatch({ selection: EditorSelection.cursor(typed.endsWith("]]") ? typed.length - 2 : typed.length) });
    await popup(view);
    await vi.waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toContain(label));
    const index = currentCompletions(view.state).findIndex((option) => option.label === label);
    view.dispatch({ effects: setSelectedCompletion(index) });
    // Il completamento non accetta un tasto appena aperto (`interactionDelay`).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(acceptCompletion(view)).toBe(true);
  }

  it("un blocco con l'id: nessuna scrittura, il link col suo id", async () => {
    const { engine, view, port } = vaultEditor({});
    try {
      await choose(view, engine, "vedi [[^^chiavi riserva", "Chiavi di riserva");
      await vi.waitFor(() => expect(engine.getDoc()).toBe("vedi [[Riunione#^riserva]]"));
      expect(port.notes).toHaveBeenCalledWith("chiavi riserva");
      expect(port.giveId).not.toHaveBeenCalled();
      expect(view.state.selection.main.head).toBe(view.state.doc.length);
    } finally {
      engine.destroy();
    }
  });

  it("un blocco senza id: il comando gli dà l'id, poi il link con quell'id", async () => {
    const { engine, view, port } = vaultEditor({});
    try {
      await choose(view, engine, "vedi [[^^sara]]", "Le chiavi le tiene Sara.");
      await vi.waitFor(() => expect(engine.getDoc()).toMatch(/^vedi \[\[Riunione#\^[a-z0-9]{6}\]\]$/));
      const id = /\^([a-z0-9]{6})/.exec(engine.getDoc())![1];
      const at = new TextEncoder().encode("# Riunione\n\n").length;
      expect(port.giveId).toHaveBeenCalledWith({
        doc: "Riunioni/Riunione.md",
        at: [at, at + "Le chiavi le tiene Sara.".length],
        text: "Le chiavi le tiene Sara.",
        id,
      });
    } finally {
      engine.destroy();
    }
  });

  it("il conflitto: la nota è cambiata, l'id non entra e il link non si scrive", async () => {
    const giveId = vi.fn(async () => ({ reason: "«Riunione» è cambiata", readOnly: false }));
    const { engine, view, port } = vaultEditor({ giveId });
    try {
      await choose(view, engine, "vedi [[^^sara", "Le chiavi le tiene Sara.");
      await vi.waitFor(() => expect(port.notify).toHaveBeenCalledWith("Il link al blocco non si è scritto: «Riunione» è cambiata"));
      expect(engine.getDoc()).toBe("vedi [[^^sara");
      expect(completionStatus(view.state)).toBeNull();
    } finally {
      engine.destroy();
    }
  });
});
